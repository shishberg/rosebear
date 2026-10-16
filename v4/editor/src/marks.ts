// Marks: paint on the model where something looks wrong, for review.
// M toggles paint mode: drag to draw on the model (hold Alt to orbit). Each
// sample is the screen point and, where the ray hits the model, the world point
// and normal on it. Save sends the strokes, the camera, a note and a screenshot
// to the dev server, which writes them to marks/ (see vite.config.ts).
// Delete all removes every saved mark.
// ?mark=<id> opens on a saved mark's view; ?marks=0 hides the saved marks.
import * as T from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

type Hit = { p: number[]; n: number[]; on: string } | null;
type Stroke = { screen: number[][]; hits: Hit[] };
type Mark = {
  id: string;
  time: string;
  commit: string;
  note: string;
  camera: { position: number[]; target: number[]; up: number[]; fov?: number; zoom?: number };
  strokes: Stroke[];
};

const r1 = (v: number) => Math.round(v * 100) / 100;

export function setupMarks(o: {
  scene: T.Scene;
  camera: T.PerspectiveCamera | T.OrthographicCamera;
  controls: OrbitControls;
  renderer: T.WebGLRenderer;
  // The model's meshes, and what each is (shell, keycaps…).
  targets: () => [T.Object3D, string][];
  // Draws the scene again, where it isn't drawn every frame.
  render?: () => void;
}) {
  const render = o.render ?? (() => {});
  const { scene, camera, controls, renderer } = o;
  const canvas = renderer.domElement;
  const current = new T.Group(),
    saved = new T.Group();
  scene.add(current, saved);
  let strokes: Stroke[] = [],
    marks: Mark[] = [],
    painting = false,
    stroke: Stroke | undefined;

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;top:95px;right:12px;width:260px;background:#0009;padding:10px 12px;border-radius:8px;font-size:12px;line-height:1.5';
  panel.innerHTML = `<div style="display:flex;gap:6px;align-items:center"><button id="mk-paint">✎ Paint (M)</button><span id="mk-mode" style="color:#9aa"></span></div>
<div id="mk-edit" style="display:none;margin-top:6px"><textarea id="mk-note" rows="3" placeholder="What's wrong here (optional)" style="width:100%;box-sizing:border-box;font:12px system-ui"></textarea>
<div style="display:flex;gap:6px;margin-top:4px"><button id="mk-save">Save mark</button><button id="mk-undo">Undo stroke</button><button id="mk-clear">Clear</button></div></div>
<label style="display:block;margin-top:6px"><input id="mk-show" type="checkbox" ${new URLSearchParams(location.search).get('marks') === '0' ? '' : 'checked'}> show saved marks</label>
<div id="mk-all" style="display:none;margin-top:4px"><button id="mk-delall">Delete all</button></div>
<div id="mk-list" style="max-height:40vh;overflow:auto"></div>`;
  document.body.append(panel);
  const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
  panel.querySelectorAll('button').forEach((b) => {
    b.style.cssText = 'border:0;border-radius:6px;padding:3px 8px;cursor:pointer';
  });

  // A stroke as tubes along its runs of hits, lifted off the surface so it isn't
  // buried in it.
  function draw(s: Stroke, color: number, into: T.Group) {
    const meshes: T.Mesh[] = [],
      runs: T.Vector3[][] = [[]];
    for (const h of s.hits)
      if (h)
        runs[runs.length - 1].push(
          new T.Vector3(...h.p).addScaledVector(new T.Vector3(...h.n), 0.3),
        );
      else if (runs[runs.length - 1].length) runs.push([]);
    const mat = new T.MeshBasicMaterial({ color });
    for (const run of runs) {
      if (run.length === 1) run.push(run[0].clone().addScalar(0.01));
      if (run.length < 2) continue;
      const curve = new T.CatmullRomCurve3(run);
      const mesh = new T.Mesh(new T.TubeGeometry(curve, run.length * 2, 0.35, 6), mat);
      into.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }
  // Frees the GPU buffers; removing a mesh from its group alone leaves them.
  function free(m: T.Mesh) {
    m.geometry.dispose();
    (m.material as T.Material).dispose();
  }
  function empty(g: T.Group) {
    g.children.forEach((m) => free(m as T.Mesh));
    g.clear();
  }
  // The stroke being drawn is the only one that changes, so only it is rebuilt.
  let live: T.Mesh[] = [];
  const redraw = () => {
    empty(current);
    strokes.forEach((s) => draw(s, 0xff2a2a, current));
    live = [];
    render();
  };
  function redrawLive() {
    for (const m of live) {
      current.remove(m);
      free(m);
    }
    live = draw(stroke!, 0xff2a2a, current);
    render();
  }
  function showSaved() {
    empty(saved);
    saved.visible = $<HTMLInputElement>('mk-show').checked;
    for (const m of marks) m.strokes.forEach((s) => draw(s, 0xffd21a, saved));
    $('mk-list').innerHTML = marks.length
      ? marks
          .map(
            (m) =>
              `<div style="margin-top:4px"><a href="#" data-go="${m.id}" style="color:#ffd21a">${m.id}</a> <a href="#" data-del="${m.id}" style="color:#f88" title="delete">×</a><br>${m.note ? m.note.replace(/</g, '&lt;') : '<i>no note</i>'}</div>`,
          )
          .join('')
      : '<div style="color:#9aa;margin-top:4px">No saved marks.</div>';
    $('mk-all').style.display = marks.length ? '' : 'none';
    render();
  }
  async function load() {
    marks = await fetch('/__marks').then((r) => r.json());
    showSaved();
  }
  function go(m: Mark) {
    camera.up.set(...(m.camera.up as [number, number, number]));
    if ('fov' in camera && m.camera.fov) camera.fov = m.camera.fov;
    if (!('fov' in camera) && m.camera.zoom) camera.zoom = m.camera.zoom;
    camera.position.set(...(m.camera.position as [number, number, number]));
    controls.target.set(...(m.camera.target as [number, number, number]));
    camera.updateProjectionMatrix();
    controls.update();
    render();
  }

  function setPaint(on: boolean) {
    painting = on;
    controls.enabled = !on;
    canvas.style.cursor = on ? 'crosshair' : '';
    $('mk-mode').textContent = on ? 'drag to draw · Alt+drag orbits' : '';
    $('mk-edit').style.display = on || strokes.length ? 'block' : 'none';
  }
  $('mk-paint').onclick = () => setPaint(!painting);
  $('mk-show').onchange = showSaved;
  $('mk-undo').onclick = () => {
    strokes.pop();
    redraw();
  };
  $('mk-clear').onclick = () => {
    strokes = [];
    redraw();
  };
  $('mk-list').onclick = async (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const m = marks.find((q) => q.id === (a.dataset.go ?? a.dataset.del));
    if (!m) return;
    if (a.dataset.go) go(m);
    else if (confirm(`Delete mark ${m.id}?`)) {
      await fetch('/__marks/' + m.id, { method: 'DELETE' });
      await load();
    }
  };
  $('mk-delall').onclick = async () => {
    if (!confirm(`Delete all ${marks.length} saved marks?`)) return;
    await fetch('/__marks', { method: 'DELETE' });
    await load();
  };
  $('mk-save').onclick = async () => {
    if (!strokes.length) return alert('Draw on the model first.');
    // Screenshot of the canvas as drawn, with this mark's strokes and without the saved ones.
    const was = saved.visible;
    saved.visible = false;
    renderer.render(scene, camera);
    const shot = canvas.toDataURL('image/png');
    saved.visible = was;
    render();
    const hits = strokes.flatMap((s) => s.hits).filter((h): h is NonNullable<Hit> => !!h),
      box = new T.Box3().setFromPoints(hits.map((h) => new T.Vector3(...h.p)));
    const body = {
      // The dev server names mark files by variant.
      variant: 'chassis',
      thumbs: 'editor',
      query: location.search,
      note: $<HTMLTextAreaElement>('mk-note').value.trim(),
      camera: {
        position: camera.position.toArray().map(r1),
        target: controls.target.toArray().map(r1),
        up: camera.up.toArray(),
        ...('fov' in camera ? { fov: camera.fov } : { zoom: camera.zoom }),
      },
      viewport: { width: canvas.clientWidth, height: canvas.clientHeight },
      // Where the hits are, world mm: a quick handle on the place.
      hits: hits.length
        ? {
            count: hits.length,
            on: [...new Set(hits.map((h) => h.on))],
            center: box.getCenter(new T.Vector3()).toArray().map(r1),
            min: box.min.toArray().map(r1),
            max: box.max.toArray().map(r1),
          }
        : { count: 0 },
      strokes,
      shot,
    };
    const res = await fetch('/__marks', { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) return alert('Saving failed: ' + res.status);
    strokes = [];
    $<HTMLTextAreaElement>('mk-note').value = '';
    redraw();
    setPaint(false);
    await load();
  };

  const ray = new T.Raycaster();
  function sample(e: PointerEvent) {
    const r = canvas.getBoundingClientRect(),
      u = (e.clientX - r.left) / r.width,
      v = (e.clientY - r.top) / r.height;
    ray.setFromCamera(new T.Vector2(u * 2 - 1, 1 - v * 2), camera);
    const targets = o.targets().filter(([obj]) => obj.visible),
      hit = ray.intersectObjects(
        targets.map(([obj]) => obj),
        false,
      )[0];
    let h: Hit = null;
    if (hit) {
      const n = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld);
      if (n.dot(ray.ray.direction) > 0) n.negate();
      h = {
        p: hit.point.toArray().map(r1),
        n: n.toArray().map((q) => Math.round(q * 1000) / 1000),
        on: targets.find(([obj]) => obj === hit.object)![1],
      };
    }
    stroke!.screen.push([Math.round(u * 1000) / 1000, Math.round(v * 1000) / 1000]);
    stroke!.hits.push(h);
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!painting || e.button !== 0 || e.altKey) return;
    canvas.setPointerCapture(e.pointerId);
    stroke = { screen: [], hits: [] };
    strokes.push(stroke);
    sample(e);
    live = [];
    redrawLive();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!stroke) return;
    sample(e);
    redrawLive();
  });
  canvas.addEventListener('pointerup', () => {
    if (stroke && !stroke.hits.some(Boolean)) {
      strokes.pop();
      redraw();
    }
    stroke = undefined;
  });
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input,textarea,[contenteditable]')) return;
    if (e.key === 'm' || e.key === 'M') setPaint(!painting);
    if (e.key === 'Alt' && painting) controls.enabled = true;
  });
  addEventListener('keyup', (e) => {
    if (e.key === 'Alt' && painting) controls.enabled = false;
  });

  const first = new URLSearchParams(location.search).get('mark');
  load().then(() => {
    const m = marks.find((q) => q.id === first);
    if (m) go(m);
  });
  return {
    painting: () => painting,
  };
}
