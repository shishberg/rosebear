// PROTOTYPE, throwaway: the chassis shape (?variant=, one left; the others
// are in git history) and extra thumb-key placements (?thumbs=). Open /prototype-shapes.html on the editor
// dev server. Nothing here feeds the real editor; only painted marks are saved
// (marks.ts).
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import type { Manifold } from 'manifold-3d';
import { clone, componentFrames, defaults, frame } from '../geometry';
import { capSize, hardware } from '../solid';
import { variants, trim, type Kit } from './variants';
import { setupMarks } from './marks';

const all = variants;
// Extra thumb keys: horizontal, lower than the angled thumb plane. World mm.
const extras: Record<string, { name: string; keys: [number, number, number, number][] }> = {
  none: { name: '3 thumb keys', keys: [] },
  outer: {
    name: '+2 outer, under middle/ring, finger splay',
    keys: [
      [0.5, -51, 24, 0],
      [23.5, -50, 21, 0],
    ],
  },
  below: {
    name: '+2 tucked below, under the thumb gaps',
    keys: [
      [-49.2, -79.9, 22, 14],
      [-28.1, -74.5, 24, 14],
    ],
  },
};
// The thumb layout now lives in the editor config (thumb and thumb_extra), so
// componentFrames gives the "+2 tucked below" keys. "none" drops them; "outer"
// replaces them with its old world poses.
function thumbLayout(
  project: typeof defaults,
  frames: Record<string, T.Matrix4>,
  ex: { keys: [number, number, number, number][] },
  tk: string,
) {
  for (const n of Object.keys(frames))
    if (n.startsWith('thumb_x') && tk !== 'below') delete frames[n];
  if (tk === 'outer')
    ex.keys.forEach(([x, y, z, rz], i) => {
      frames['thumb_x' + (i + 1)] = frame([x, y, z], [0, 0, rz]);
    });
  void project;
  return frames;
}
const params = new URLSearchParams(location.search);
let vi = Math.max(
    0,
    all.findIndex((v) => v.key === params.get('variant')),
  ),
  ti = Math.max(0, Object.keys(extras).indexOf(params.get('thumbs') || 'none'));

document.body.style.cssText =
  'margin:0;font:14px system-ui,sans-serif;background:#1b2226;color:#e8ecec;overflow:hidden';
document.getElementById('app')!.innerHTML =
  `<div id="info" style="position:fixed;top:12px;left:12px;max-width:380px;background:#0009;padding:10px 14px;border-radius:8px;line-height:1.4">
<!-- PROTOTYPE · THROWAWAY · SAME KEY POSES IN EVERY SHAPE -->
<label style="display:block;font-size:12px"><input id="caps" type="checkbox" ${params.get('caps') === '0' ? '' : 'checked'}> keycaps</label><label style="display:block;font-size:12px"><input id="plate" type="checkbox" ${params.get('plate') === '0' ? '' : 'checked'}> bottom plate / bottom section</label></div>
<div id="bar" style="position:fixed;bottom:18px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center"></div>`;
// The description and build stats are kept out of the way, as HTML comments
// in the info panel: readable in the inspector, not over the model.
const [blurb, stats] = ['blurb', 'stats'].map((n) =>
  document.getElementById('info')!.appendChild(document.createComment(n)),
);
const note = (c: Comment, n: string, text: string) => (c.data = ` ${n}: ${text} `);
const bar = document.getElementById('bar')!;
function pill(id: string, onStep: (d: number) => void) {
  const el = document.createElement('div');
  el.style.cssText =
    'display:flex;align-items:center;gap:10px;background:#fff;color:#111;border-radius:999px;padding:6px 10px;box-shadow:0 4px 16px #0008;font-weight:600';
  el.innerHTML = `<button data-d="-1">←</button><span id="${id}" style="min-width:300px;text-align:center"></span><button data-d="1">→</button>`;
  el.querySelectorAll('button').forEach((b) => {
    b.style.cssText =
      'border:0;background:#eee;border-radius:999px;width:32px;height:28px;cursor:pointer';
    b.onclick = () => onStep(Number(b.dataset.d));
  });
  bar.append(el);
}
pill('vlabel', (d) => {
  vi = (vi + d + all.length) % all.length;
  show();
});
pill('tlabel', (d) => {
  const n = Object.keys(extras).length;
  ti = (ti + d + n) % n;
  show();
});
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input,textarea,[contenteditable]')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const d = e.key === 'ArrowLeft' ? -1 : 1;
    if (e.shiftKey) {
      const n = Object.keys(extras).length;
      ti = (ti + d + n) % n;
    } else vi = (vi + d + all.length) % all.length;
    show();
  }
});

const scene = new T.Scene(),
  camera = new T.PerspectiveCamera(35, 1, 1, 3000);
camera.up.set(0, 0, 1);
camera.position.set(
  ...((params.get('cam')?.split(',').map(Number) ?? [-160, -260, 230]) as [number, number, number]),
);
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
// ?look=x,y,z: the point the camera orbits and looks at (cam is then its position).
controls.target.set(
  ...((params.get('look')?.split(',').map(Number) ?? [-10, -15, 15]) as [number, number, number]),
);
controls.update();
scene.add(new T.HemisphereLight(0xdfeef0, 0x39464b, 1.6));
const sun = new T.DirectionalLight(0xffffff, 2.2);
sun.position.set(-80, -120, 200);
scene.add(sun);
const fill = new T.DirectionalLight(0xffffff, 0.6);
fill.position.set(120, 80, 60);
scene.add(fill);
const grid = new T.GridHelper(400, 40, 0x3a4a50, 0x2a353a);
grid.rotation.x = Math.PI / 2;
scene.add(grid);
const group = new T.Group();
scene.add(group);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
const marks = setupMarks({
  scene,
  camera,
  controls,
  renderer,
  targets: () => group.children.map((o) => [o, o.userData.kind ?? 'other']),
  view: () => ({
    variant: all[vi].key,
    thumbs: Object.keys(extras)[ti],
    query: location.search,
  }),
});

const toGeom = (m: Manifold) => {
  const mesh = m.getMesh(),
    g = new T.BufferGeometry(),
    p = new Float32Array(mesh.numVert * 3);
  for (let i = 0; i < mesh.numVert; i++)
    for (let j = 0; j < 3; j++) p[i * 3 + j] = mesh.vertProperties[i * mesh.numProp + j];
  g.setAttribute('position', new T.BufferAttribute(p, 3));
  g.setIndex(new T.BufferAttribute(mesh.triVerts, 1));
  return toCreasedNormals(g, Math.PI / 6);
};
const colors: Record<string, number> = {
  pcb: 0x268878,
  components: 0x303b43,
  keycaps: 0xd7d8bd,
  trackball: 0x9560b7,
  ball: 0xc35451,
  adapter: 0xd1a443,
};
// A fresh manifold instance per build: manifold's objects live in wasm memory
// that is never collected, so one shared instance runs out after a few big
// builds. Dropping the whole instance frees everything it made.
const engine = () =>
  Module({ locateFile: () => wasmUrl }).then((m) => {
    m.setup();
    return m;
  });
const cache = new Map<
  string,
  {
    clear: string[];
    trim?: T.BufferGeometry;
    pieces: string[];
    base: T.BufferGeometry;
    geom: T.BufferGeometry;
    frames: Record<string, T.Matrix4>;
    project: typeof defaults;
    ms: number;
    vol: number;
  }
>();

async function show() {
  const v = all[vi],
    tk = Object.keys(extras)[ti],
    ex = extras[tk];
  const url = new URL(location.href);
  url.searchParams.set('variant', v.key);
  url.searchParams.set('thumbs', tk);
  history.replaceState(null, '', url);
  document.getElementById('vlabel')!.textContent = `${vi + 1}/${all.length} · ${v.name}`;
  document.getElementById('tlabel')!.textContent = `Shift+←/→ · ${ex.name}`;
  note(blurb, 'blurb', v.blurb);
  note(stats, 'stats', 'Building…');
  const key = v.key + '|' + tk;
  if (!cache.has(key)) {
    const wasm = await engine(),
      t0 = performance.now(),
      project = clone(defaults);
    v.config?.(project.config);
    const frames = thumbLayout(project, componentFrames(project.config), ex, tk),
      kit: Kit = { wasm, cfg: project.config, frames },
      m: Manifold = v.build(kit);
    const split = v.split ?? 2,
      slab = wasm.Manifold.cube([2000, 2000, split + 1], true).translate([0, 0, (split - 1) / 2]);
    // Pieces above the base: more than one means something only touches the removable plate.
    const above = m.subtract(slab),
      pieces = above
        .decompose()
        .filter((p) => p.volume() > 50)
        .sort((a, b) => b.volume() - a.volume())
        .map((p) => {
          const b = p.boundingBox();
          return `${(p.volume() / 1000).toFixed(1)} @ ${b.min.map((v, i) => ((v + b.max[i]) / 2).toFixed(0)).join(',')}`;
        });
    // Keycap clearance, as the editor's report checks it: the cap's travel envelope
    // (cap plus margin, from rest down by the travel) must not touch the chassis.
    // Gaps: closest distance between the resting caps of different key groups.
    let clear: string[] = [];
    {
      const sw = project.config.switch,
        M = wasm.Manifold,
        keyNames = Object.keys(frames).filter(
          (n) => n.startsWith('thumb_') || n.startsWith('matrix_'),
        );
      const cap = (n: string, grow = 0, travel = 0) => {
        const z = capSize(project.config, n);
        return M.cube([z[0] + 2 * grow, z[1] + 2 * grow, z[2] + travel], true)
          .translate([0, 0, sw.keycap_bottom_above_plate_mm - travel + (z[2] + travel) / 2])
          .transform(frames[n].elements as never);
      };
      const hits = keyNames
        .map((n) => {
          const g =
              (sw.keycap_clearance_overrides_mm as Record<string, number>)[n] ??
              sw.keycap_clearance_mm,
            x = m.intersect(cap(n, g, sw.travel_mm)),
            vol = x.volume(),
            bb = x.boundingBox();
          return vol > 0.05
            ? `${n} ${vol.toFixed(0)} mm³ @ ${bb.min.map((q, i) => ((q + bb.max[i]) / 2).toFixed(0)).join(',')}`
            : '';
        })
        .filter(Boolean);
      const groups: [string, string[]][] = [
        ['fingers', keyNames.filter((n) => n.startsWith('matrix_'))],
        ['thumbs', keyNames.filter((n) => n.startsWith('thumb_') && !n.startsWith('thumb_x'))],
        ['extra thumbs', keyNames.filter((n) => n.startsWith('thumb_x'))],
      ];
      const u = groups.map(
          ([g, ns]) => [g, ns.length ? M.union(ns.map((n) => cap(n))) : undefined] as const,
        ),
        gaps: string[] = [];
      for (let i = 0; i < u.length; i++)
        for (let j = i + 1; j < u.length; j++) {
          const a = u[i][1],
            b = u[j][1];
          if (a && b) {
            const d = a.minGap(b, 40);
            if (d < 40) gaps.push(`${u[i][0]}–${u[j][0]} ${d.toFixed(1)} mm`);
          }
        }
      clear = [
        hits.length ? `keycaps hit the chassis: ${hits.join('; ')}` : 'no keycap hits the chassis',
        `closest caps: ${gaps.join(', ')}`,
      ];
    }
    cache.set(key, {
      clear,
      trim: trim.length ? toGeom(wasm.Manifold.union(trim)) : undefined,
      pieces,
      base: toGeom(m.intersect(slab)),
      geom: toGeom(above),
      frames,
      project,
      ms: performance.now() - t0,
      vol: m.volume() / 1000,
    });
  }
  const c = cache.get(key)!;
  if (all[vi] !== v || Object.keys(extras)[ti] !== tk) return;
  group.clear();
  const shellMat = new T.MeshStandardMaterial({
    color: v.color ?? 0x8f9ea4,
    roughness: 0.65,
    metalness: 0.05,
    side: T.DoubleSide,
  });
  // ?top=0 hides everything above the bottom plate / bottom section.
  const top = new T.Mesh(c.geom, shellMat);
  top.visible = params.get('top') !== '0';
  top.userData.kind = 'shell';
  group.add(top);
  const plate = new T.Mesh(c.base, shellMat);
  plate.userData.plate = true;
  plate.userData.kind = 'plate';
  plate.visible = (document.getElementById('plate') as HTMLInputElement).checked;
  group.add(plate);
  if (c.trim) {
    const trim = new T.Mesh(
      c.trim,
      new T.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.6 }),
    );
    trim.userData.kind = 'trim';
    group.add(trim);
  }
  for (const part of hardware(c.project, c.frames)) {
    if (['trackpad', 'adapter'].includes(part.group)) continue;
    if (part.group.startsWith('trackpad')) continue;
    if (part.group === 'switch') continue;
    const mesh = new T.Mesh(
      new T.BoxGeometry(...part.size),
      new T.MeshStandardMaterial({
        color: (part.group === 'keycaps' && v.capColor) || (colors[part.group] ?? 0x888888),
        roughness: 0.8,
      }),
    );
    mesh.position.set(...part.center);
    mesh.applyMatrix4(new T.Matrix4().fromArray(part.matrix));
    mesh.userData.caps = part.group === 'keycaps';
    mesh.userData.kind = part.group;
    mesh.visible =
      !mesh.userData.caps || (document.getElementById('caps') as HTMLInputElement).checked;
    group.add(mesh);
  }
  // ?fit=1: aim at the model and back off along the cam direction until it fits.
  if (params.get('fit') === '1') {
    const box = new T.Box3();
    group.children.forEach((o) => {
      if (o.visible) box.expandByObject(o);
    });
    const ctr = box.getCenter(new T.Vector3()),
      r = box.getBoundingSphere(new T.Sphere()).radius,
      v = T.MathUtils.degToRad(camera.fov) / 2,
      h = Math.atan(Math.tan(v) * camera.aspect),
      dir = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(ctr);
    camera.position.copy(ctr).addScaledVector(dir, (r / Math.sin(Math.min(v, h))) * 0.9);
    controls.update();
  }
  marks.shown();
  const nk = Object.keys(c.frames).filter(
    (n) => n.startsWith('thumb_') || n.startsWith('matrix_'),
  ).length;
  note(
    stats,
    'stats',
    `${nk} keys · solid volume ≈ ${c.vol.toFixed(0)} cm³ (walls not hollowed in every shape) · built in ${c.ms.toFixed(0)} ms · ${c.pieces.length === 1 ? 'one piece without the plate' : `${c.pieces.length} loose pieces without the plate (cm³ @ x,y,z: ${c.pieces.join('; ')})`}${c.clear.length ? ` · ${c.clear.join(' · ')}` : ''}`,
  );
}
document.getElementById('caps')!.onchange = () =>
  group.children.forEach((o) => {
    if (o.userData.caps) o.visible = (document.getElementById('caps') as HTMLInputElement).checked;
  });
document.getElementById('plate')!.onchange = () => {
  const on = (document.getElementById('plate') as HTMLInputElement).checked;
  grid.visible = on;
  group.children.forEach((o) => {
    if (o.userData.plate) o.visible = on;
  });
};
grid.visible = params.get('plate') !== '0';
show();
