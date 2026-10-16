import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  defaults,
  clone,
  validateProject,
  componentFrames,
  tentFrame,
  ROWS,
  type Project,
  type MeshData,
  type V3,
  type Cluster,
} from './geometry';
import { hardware } from './parts';
import type { BuildResult, Report, Highlight } from './solid';
import type { Wiring } from './wiring';
import { setupMarks } from './marks';
import { setupHand } from './hand-prototype';
import { disposeChildren, placeCamera, clientToNdc, worldToClient } from './three-util';
import { reportLines, prettyKey } from './report-lines';
import { prototypeOverrides } from './prototype-overrides';
import './style.css';
const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
const STORAGE = 'rosebear-chassis-editor:v2';
// The view, view toggles and opacity: browser conveniences, kept apart from the project.
const VIEW_STORAGE = 'rosebear-chassis-editor:view';
const TOGGLES = ['edit', 'caps', 'parts', 'wires', 'adapter', 'base', 'bounds', 'edges'];
$('app').innerHTML =
  `<header><div><h1>Rosebear / chassis editor</h1><p>Right hand · C64 chassis</p></div><span id="save-state">Local project</span></header><main><aside>
<section><h2>Key layout</h2><label><input id="edit" type="checkbox" checked> Show handles</label><div id="selection" aria-live="polite"></div><button id="undo">Undo</button><button id="redo">Redo</button><button id="reset">Reset model</button></section>
<section><h2>View</h2><label><input id="caps" type="checkbox"> Keycaps</label><label><input id="parts" type="checkbox" checked> Tiles and components</label><label><input id="wires" type="checkbox" checked> Wiring and pads</label><label><input id="adapter" type="checkbox" checked> Adapter and ribbons</label><label><input id="base" type="checkbox" checked> Bottom section</label><label><input id="bounds" type="checkbox"> Show bounding box</label><label><input id="edges" type="checkbox"> Show wireframe</label><small id="size">Size: waiting for the chassis</small><label>Chassis opacity<input id="opacity" type="range" min="0.1" max="1" step="0.05" value="1"></label><button id="rebuild">Rebuild & check</button></section>
<section><h2>Clearance checks</h2><label>Keycap bottom at full press (mm above the switch plane) <input id="bottom-out" type="number" min="0" max="20" step="0.1"></label><label><input id="show-failures" type="checkbox" checked> Highlight failures in 3D</label><small id="fit-legend"></small><button id="all-failures">Show all failures</button><div id="fit-focus" aria-live="polite"></div><div id="fit-badge">Starting geometry engine…</div><ul id="fit-list"></ul><button id="report" disabled>Save report</button></section>
<section><h2>Wiring</h2><div id="wiring-summary"></div><details><summary>Matrix and ribbon pins</summary><table id="matrix-table"></table></details><details><summary>Cut list</summary><table id="cut-list"></table></details></section>
<section><h2>Project</h2><button class="primary" id="export">Save project</button><button id="import">Open project</button><input id="file" type="file" accept=".json,application/json" hidden><button id="stl" disabled>Export review STL</button><button id="stl-base" disabled>Export bottom section STL</button><div id="load-error"></div><details><summary>All configuration</summary><textarea id="config" aria-label="Configuration"></textarea><button id="apply-config">Apply configuration</button></details></section></aside>
<div id="viewport"><div id="viewbar">${['3D', 'Top', 'Underside', 'Front', 'Inner'].map((v) => `<button data-view="${v}">${v}</button>`).join('')}</div><div id="view-state">Loading model…</div></div></main>`;
/** How each failure kind is drawn in the 3D view; the legend lists one kind per colour. */
const KIND_STYLE: Record<Highlight['kind'], { color: number; order: number }> = {
  rest: { color: 0xff303e, order: 6 },
  hardware: { color: 0xff303e, order: 6 },
  travel: { color: 0xffa124, order: 5 },
  room: { color: 0xffa124, order: 6 },
  opening: { color: 0xf16bd8, order: 6 },
  seat: { color: 0xf16bd8, order: 6 },
  loose: { color: 0xf16bd8, order: 6 },
  wire: { color: 0x40e0ff, order: 6 },
  solder: { color: 0x40e0ff, order: 6 },
};
const LEGEND: [Highlight['kind'], string][] = [
  ['rest', 'Red: at-rest / hardware collision'],
  ['travel', 'Orange: travel + clearance collision'],
  ['opening', 'Pink: opening / switch-seat defect / loose piece'],
  ['wire', 'Cyan: wire into the chassis / blocked soldering access'],
];
$('fit-legend').replaceChildren(
  ...LEGEND.flatMap(([kind, text], i) => {
    const span = document.createElement('span');
    span.textContent = text;
    span.style.color = '#' + KIND_STYLE[kind].color.toString(16).padStart(6, '0');
    return i ? [document.createElement('br'), span] : [span];
  }),
);
const setBadge = (kind: '' | 'pass' | 'fail', text: string) => {
  $('fit-badge').className = kind;
  $('fit-badge').textContent = text;
};
let project = clone(defaults),
  loadProblem = '';
try {
  const saved = localStorage.getItem(STORAGE);
  if (saved) {
    const p = JSON.parse(saved);
    validateProject(p);
    project = p;
    $('save-state').textContent = 'Restored local autosave';
  }
} catch (e) {
  loadProblem = 'Could not restore autosave: ' + String(e);
}
$('load-error').textContent = loadProblem;
const undo: Project[] = [],
  redo: Project[] = [];
let hasShell = false,
  selected = '';
// PROTOTYPE ?hand (hand-prototype.ts): lays the keys out from its state
// (project.hand) and redraws the hand after each edit, and builds the case
// only when asked (the generator can't follow many hand layouts).
let handLayout: (() => void) | undefined,
  handUpdate: (() => void) | undefined,
  handCase: (() => boolean) | undefined;
let revision = 0,
  solidRevision = -1,
  report: Report | undefined,
  busy = false,
  pending = false,
  timer: ReturnType<typeof setTimeout> | undefined,
  timeout: ReturnType<typeof setTimeout> | undefined;
const viewport = $('viewport'),
  scene = new T.Scene();
scene.background = new T.Color('#101d25');
const camera = new T.OrthographicCamera(-120, 120, 100, -100, 0.1, 1500);
camera.up.set(0, 0, 1);
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = T.SRGBColorSpace;
viewport.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.target.set(-20, -25, 20);
controls.minZoom = 0.3;
controls.maxZoom = 8;
scene.add(new T.HemisphereLight(0xc7e8ed, 0x45585f, 2));
const light = new T.DirectionalLight(0xffffff, 2.5);
light.position.set(-60, -100, 180);
scene.add(light);
const material = new T.MeshStandardMaterial({ color: 0xb1cfca, roughness: 0.8, side: T.FrontSide });
const shell = new T.Mesh(new T.BufferGeometry(), material);
scene.add(shell);
// The case's edges: wherever its faces meet at more than a degree.
const edges = new T.LineSegments(
  new T.BufferGeometry(),
  new T.LineBasicMaterial({ color: 0x24343a }),
);
edges.visible = false;
scene.add(edges);
function setEdges() {
  edges.geometry.dispose();
  // Until the first chassis arrives the case has no geometry to draw edges of.
  edges.geometry =
    edges.visible && shell.geometry.getAttribute('position')
      ? new T.EdgesGeometry(shell.geometry, 1)
      : new T.BufferGeometry();
}
const basePlate = new T.Mesh(
  new T.BufferGeometry(),
  new T.MeshStandardMaterial({ color: 0x7f9a96, roughness: 0.8 }),
);
scene.add(basePlate);
// The port panel's dark insert.
const trim = new T.Mesh(
  new T.BufferGeometry(),
  new T.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.6 }),
);
scene.add(trim);
// The box the size readout measures: case, bottom section and trim.
const bounds = new T.Box3Helper(new T.Box3(), 0xffd36b);
bounds.visible = false;
scene.add(bounds);
function measure() {
  const box = bounds.box.makeEmpty();
  for (const m of [shell, basePlate, trim]) box.expandByObject(m);
  const s = box.getSize(new T.Vector3());
  $('size').textContent = box.isEmpty()
    ? 'Size: no chassis'
    : `Size: ${s.x.toFixed(1)} W × ${s.y.toFixed(1)} D × ${s.z.toFixed(1)} H mm`;
  bounds.visible = $('bounds').matches(':checked') && !box.isEmpty();
}
const parts = new T.Group();
scene.add(parts);
const wires = new T.Group();
scene.add(wires);
const failures = new T.Group();
scene.add(failures);
let focusedFailure: string | undefined;
function clearFailures() {
  disposeChildren(failures);
  focusedFailure = undefined;
  $('fit-focus').textContent = '';
  render();
}
function updateFailures(items: Highlight[]) {
  clearFailures();
  for (const item of items) {
    const { color, order } = KIND_STYLE[item.kind];
    const mesh = new T.Mesh(
      geometry(item.mesh, false),
      new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
        side: T.FrontSide,
      }),
    );
    mesh.name = item.name;
    mesh.userData.kind = item.kind;
    mesh.renderOrder = order;
    failures.add(mesh);
  }
  failureVisibility();
}
function failureVisibility() {
  failures.visible = $('show-failures').matches(':checked');
  for (const mesh of failures.children)
    mesh.visible = focusedFailure === undefined || mesh.name === focusedFailure;
  $('fit-focus').textContent = focusedFailure ? `Showing: ${prettyKey(focusedFailure)}` : '';
  document
    .querySelectorAll<HTMLButtonElement>('#fit-list button')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.failure === focusedFailure)));
  render();
}
function focusFailure(name?: string) {
  focusedFailure = name;
  $<HTMLInputElement>('show-failures').checked = true;
  failureVisibility();
}
$('show-failures').onchange = failureVisibility;
$('all-failures').onclick = () => focusFailure();

// Handles. Each has a world position and a drag rule that edits the project.
// A key handle ignores sideways movement; the X offset field moves a column.
type Cfg = Project['config'];
type ClusterKey = 'thumb' | 'thumb_extra';
const clusterOf = (c: Cfg, k: ClusterKey) =>
  (c.geometry as unknown as Record<ClusterKey, Cluster | undefined>)[k];
const clusters = (c: Cfg) =>
  (['thumb', 'thumb_extra'] as ClusterKey[]).filter((k) => clusterOf(c, k));
const tentRotation = (c: Cfg) => {
  const t = tentFrame(c);
  t.setPosition(0, 0, 0);
  return t;
};
const toLayout = (c: Cfg, d: T.Vector3) => d.clone().applyMatrix4(tentRotation(c).invert());
const world = (c: Cfg, p: number[]) => new T.Vector3(...(p as V3)).applyMatrix4(tentFrame(c));
const TURN = 40;
function handles(p: Project) {
  const c = p.config,
    frames = componentFrames(c),
    out: { id: string; kind: 'key' | 'cluster' | 'turn'; at: T.Vector3 }[] = [];
  for (const [n, m] of Object.entries(frames))
    if (n.startsWith('matrix_'))
      out.push({ id: 'key:' + n, kind: 'key', at: new T.Vector3().setFromMatrixPosition(m) });
  for (const k of clusters(c)) {
    const cl = clusterOf(c, k)!,
      root = new T.Vector3(...(cl.position_mm as V3)),
      a = (cl.rotation_deg[2] * Math.PI) / 180;
    out.push({ id: 'cluster:' + k, kind: 'cluster', at: world(c, root.toArray()) });
    // In front of the cluster centre, in layout plan, along the cluster's own -Y.
    out.push({
      id: 'turn:' + k,
      kind: 'turn',
      at: world(c, [root.x + Math.sin(a) * TURN, root.y - Math.cos(a) * TURN, root.z]),
    });
  }
  return out;
}
// The layout axis nearest the view direction is left unchanged, so a drag in
// the top view never changes a height, whatever the tent.
function dragTo(
  base: Project,
  id: string,
  delta: T.Vector3,
  start: T.Vector3,
  view: T.Vector3,
): Project {
  const p = clone(base),
    c = p.config,
    d = toLayout(c, delta),
    v = toLayout(c, view),
    axis = [0, 1, 2].reduce(
      (a, i) => (Math.abs(v.getComponent(i)) > Math.abs(v.getComponent(a)) ? i : a),
      0,
    );
  d.setComponent(axis, 0);
  if (id.startsWith('key:')) {
    const [, col, row] = id.slice(4).split('_'),
      column = c.geometry.columns.find((x) => x.name === col)!;
    column.heights_mm[ROWS.indexOf(row as (typeof ROWS)[number])] += d.z;
    column.offset_mm[1] += d.y;
  } else if (id.startsWith('cluster:')) {
    const cl = clusterOf(c, id.slice(8) as ClusterKey)!;
    cl.position_mm = cl.position_mm.map((x, i) => x + d.getComponent(i));
  } else if (id.startsWith('turn:')) {
    const cl = clusterOf(c, id.slice(5) as ClusterKey)!,
      o = world(c, cl.position_mm),
      s = toLayout(c, start.clone().sub(o)),
      e = toLayout(c, start.clone().add(delta).sub(o));
    cl.rotation_deg[2] += ((Math.atan2(e.y, e.x) - Math.atan2(s.y, s.x)) * 180) / Math.PI;
  }
  return p;
}
// Number fields for the selected handle: [label, path into the config].
type Field = [string, (string | number)[]];
function fields(id: string): { title: string; list: Field[] } {
  if (id.startsWith('key:')) {
    const [, col] = id.slice(4).split('_'),
      i = project.config.geometry.columns.findIndex((x) => x.name === col),
      b = ['geometry', 'columns', i];
    return {
      title: `${col} column`,
      list: [
        ['X offset mm', [...b, 'offset_mm', 0]],
        ['Stagger mm', [...b, 'offset_mm', 1]],
        ...ROWS.map((r, j) => [`${r} key height mm`, [...b, 'heights_mm', j]] as Field),
        ['Sideways tilt °', [...b, 'roll_deg']],
        ['Splay °', [...b, 'rotation_deg', 2]],
      ],
    };
  }
  if (id.startsWith('cluster:') || id.startsWith('turn:')) {
    const k = id.split(':')[1],
      b = ['geometry', k];
    return {
      title: k === 'thumb' ? 'thumb cluster' : 'extra thumb row',
      list: [
        ['Centre X mm', [...b, 'position_mm', 0]],
        ['Centre Y mm', [...b, 'position_mm', 1]],
        ['Centre Z mm', [...b, 'position_mm', 2]],
        ['Angle °', [...b, 'rotation_deg', 2]],
        ['Tilt about X °', [...b, 'rotation_deg', 0]],
        ['Tilt about Y °', [...b, 'rotation_deg', 1]],
        ['Arc radius mm', [...b, 'arc', 'radius_mm']],
        ['Key spacing °', [...b, 'arc', 'step_deg']],
        ['Well ° per key', [...b, 'arc', 'well_deg']],
      ],
    };
  }
  return { title: '', list: [] };
}
const getAt = (o: unknown, path: (string | number)[]) =>
  path.reduce((x: any, k) => x?.[k], o) as number;
const setAt = (o: unknown, path: (string | number)[], v: number) => {
  const last = path.at(-1)!;
  (path.slice(0, -1).reduce((x: any, k) => x[k], o) as any)[last] = v;
};
function updateSelection() {
  const box = $('selection');
  let { title, list } = fields(selected);
  // The selected column or cluster can vanish (Apply configuration, Undo).
  if (list.some(([, path]) => !Number.isFinite(getAt(project.config, path)))) {
    selected = '';
    ({ title, list } = fields(selected));
  }
  // ?hand lays the keys out itself, so a field edit would only be overwritten.
  if (!title || handLayout) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<strong>${title}</strong><small>+X pinky, +Y away, +Z up, before tenting</small><div class="params">${list.map(([label], i) => `<label>${label}<input type="number" step="0.5" data-field="${i}"></label>`).join('')}</div>`;
  box.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
    const path = list[Number(input.dataset.field)][1];
    input.value = String(+getAt(project.config, path).toFixed(3));
    input.onchange = () => {
      const v = Number(input.value);
      try {
        if (!Number.isFinite(v)) throw Error('Not a number');
        const next = clone(project);
        setAt(next.config, path, v);
        commit(next);
      } catch (e) {
        $('load-error').textContent = String(e);
        input.value = String(getAt(project.config, path));
      }
    };
  });
}
const handleColors = { key: 0xffd48b, cluster: 0x60dfff, turn: 0xff8fd8 };
const handleGroup = new T.Group();
scene.add(handleGroup);
function updateHandles() {
  disposeChildren(handleGroup);
  const hs = handles(project);
  for (const [kind, color] of Object.entries(handleColors)) {
    const ps = hs.filter((h) => h.kind === kind);
    const pts = new T.Points(
      new T.BufferGeometry().setAttribute(
        'position',
        new T.Float32BufferAttribute(
          ps.flatMap((h) => h.at.toArray()),
          3,
        ),
      ),
      new T.PointsMaterial({
        color,
        size: 10,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    pts.renderOrder = 11;
    handleGroup.add(pts);
  }
  const sel = hs.find((h) => h.id === selected);
  if (sel) {
    const pts = new T.Points(
      new T.BufferGeometry().setAttribute(
        'position',
        new T.Float32BufferAttribute(sel.at.toArray(), 3),
      ),
      new T.PointsMaterial({
        color: 0xffffff,
        size: 15,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    pts.renderOrder = 12;
    handleGroup.add(pts);
  }
  // Lines from each cluster's centre to its turn handle.
  const lines: number[] = [];
  for (const k of clusters(project.config)) {
    const a = hs.find((h) => h.id === 'cluster:' + k)!,
      b = hs.find((h) => h.id === 'turn:' + k)!;
    lines.push(...a.at.toArray(), ...b.at.toArray());
  }
  const seg = new T.LineSegments(
    new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(lines, 3)),
    new T.LineBasicMaterial({ color: 0xff8fd8, depthTest: false, transparent: true, opacity: 0.7 }),
  );
  seg.renderOrder = 10;
  handleGroup.add(seg);
  handleGroup.visible = $('edit').matches(':checked') && !handLayout;
  render();
}

let originalIndices = new Uint32Array(),
  scheduled = false;
const geometry = (data: MeshData, sharp: boolean) => {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(data.positions, 3));
  g.setIndex(new T.BufferAttribute(data.indices, 1));
  if (!sharp) {
    g.computeVertexNormals();
    return g;
  }
  const result = toCreasedNormals(g, Math.PI / 6);
  if (result !== g) g.dispose();
  if (!result.index)
    result.setIndex(
      new T.BufferAttribute(
        Uint32Array.from({ length: result.getAttribute('position').count }, (_, i) => i),
        1,
      ),
    );
  return result;
};
function setMesh(mesh: T.Mesh, data: MeshData) {
  mesh.geometry.dispose();
  mesh.geometry = geometry(data, true);
}
function setShell(r: BuildResult) {
  hasShell = true;
  setMesh(shell, r.mesh);
  setMesh(basePlate, r.base);
  setMesh(trim, r.trim);
  setEdges();
  measure();
  if (panel !== r.panel) {
    panel = r.panel;
    updateHardware();
  }
  originalIndices = (shell.geometry.getIndex()!.array as Uint32Array).slice();
  render();
}
function render() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (material.opacity < 1 && originalIndices.length) {
      camera.updateMatrixWorld();
      const pos = shell.geometry.getAttribute('position'),
        m = camera.matrixWorldInverse.elements,
        depth = new Float64Array(originalIndices.length / 3);
      for (let i = 0; i < depth.length; i++)
        for (let j = 0; j < 3; j++) {
          const v = originalIndices[i * 3 + j];
          depth[i] += m[2] * pos.getX(v) + m[6] * pos.getY(v) + m[10] * pos.getZ(v);
        }
      const order = Array.from(depth.keys()).sort((a, b) => depth[a] - depth[b]),
        indices = new Uint32Array(originalIndices.length);
      order.forEach((f, i) => indices.set(originalIndices.subarray(f * 3, f * 3 + 3), i * 3));
      const index = shell.geometry.getIndex()!;
      (index.array as Uint32Array).set(indices);
      index.needsUpdate = true;
    }
    renderer.render(scene, camera);
  });
}
controls.addEventListener('change', render);
function resize() {
  const w = viewport.clientWidth,
    h = viewport.clientHeight;
  renderer.setSize(w, h);
  camera.left = (-100 * w) / h;
  camera.right = (100 * w) / h;
  camera.top = 100;
  camera.bottom = -100;
  camera.updateProjectionMatrix();
  render();
}
new ResizeObserver(resize).observe(viewport);
function preset(name: string) {
  const offsets: Record<string, [V3, V3]> = {
    '3D': [
      [-140, -170, 150],
      [0, 0, 1],
    ],
    Top: [
      [0, 0, 250],
      [0, 1, 0],
    ],
    Underside: [
      [0, 0, -250],
      [0, -1, 0],
    ],
    Front: [
      [0, -250, 0],
      [0, 0, 1],
    ],
    Inner: [
      [-250, 0, 0],
      [0, 0, 1],
    ],
  };
  const [offset, up] = offsets[name] ?? offsets['3D'];
  placeCamera(camera, controls, {
    position: controls.target
      .clone()
      .add(new T.Vector3(...offset))
      .toArray(),
    target: controls.target.toArray(),
    up,
    zoom: 1,
  });
  render();
}
document
  .querySelectorAll<HTMLButtonElement>('[data-view]')
  .forEach((b) => (b.onclick = () => preset(b.dataset.view!)));
preset('3D');
const colors: Record<string, number> = {
  pcb: 0x268878,
  components: 0x303b43,
  switch: 0x667e86,
  keycaps: 0xd7d8bd,
  adapter: 0x2f6f4f,
  ribbon: 0xd9b45a,
  pads: 0xd8c27a,
  glue: 0xf2e6a0,
};
/** Wire colours by net group. */
const wireColors: Record<string, number> = {
  row: 0x4aa3ff,
  column: 0x5ee08a,
  data: 0xf7f7f7,
  power: 0xff4d4d,
  ground: 0x222222,
};
const ADAPTER_GROUPS = ['adapter', 'ribbon'];
// The port panel's end face as last built: the ribbon is drawn out through it.
let panel: number | undefined;
// A box tapering from size (x, y at its bottom, z its height, centred) to a
// top face of top (x, y).
const taperedBox = (size: number[], top: number[]) => {
  const g = new T.BoxGeometry(1, 1, size[2]),
    p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const up = p.getZ(i) > 0;
    p.setXY(i, p.getX(i) * (up ? top[0] : size[0]), p.getY(i) * (up ? top[1] : size[1]));
  }
  g.computeVertexNormals();
  return g;
};
function updateHardware() {
  disposeChildren(parts);
  for (const p of hardware(project, undefined, panel)) {
    const g = p.cylinder
        ? new T.CylinderGeometry(p.cylinder, p.cylinder, p.size[2], 48).rotateX(Math.PI / 2)
        : p.top
          ? taperedBox(p.size, p.top)
          : new T.BoxGeometry(...p.size),
      o = new T.Mesh(g, new T.MeshStandardMaterial({ color: colors[p.group], roughness: 0.8 }));
    g.translate(...p.center);
    o.applyMatrix4(new T.Matrix4().fromArray(p.matrix));
    o.userData.group = p.group;
    o.name = p.name;
    parts.add(o);
  }
  visibility();
}
/**
 * Each wire as a tube: a cylinder along each segment and a ball at each bend,
 * merged by colour. The worker routes the wires with each chassis build, so
 * they stay as last built until the next one.
 */
let routed: Wiring | undefined;
function updateWiring(w: Wiring) {
  routed = w;
  disposeChildren(wires);
  const pieces: Record<string, T.BufferGeometry[]> = {};
  const up = new T.Vector3(0, 1, 0);
  for (const wire of w.wires) {
    const r = wire.diameter / 2,
      list = (pieces[wire.group] ??= []);
    wire.points.forEach((p, i) => {
      list.push(new T.SphereGeometry(r, 6, 4).translate(...p));
      if (!i) return;
      const a = new T.Vector3(...wire.points[i - 1]),
        b = new T.Vector3(...p),
        d = b.clone().sub(a);
      list.push(
        new T.CylinderGeometry(r, r, d.length(), 6, 1, true)
          .applyQuaternion(new T.Quaternion().setFromUnitVectors(up, d.clone().normalize()))
          .translate(...a.add(b).multiplyScalar(0.5).toArray()),
      );
    });
  }
  for (const [group, list] of Object.entries(pieces)) {
    const g = mergeGeometries(list.map((x) => x.toNonIndexed()));
    list.forEach((x) => x.dispose());
    const o = new T.Mesh(
      g,
      new T.MeshStandardMaterial({ color: wireColors[group] ?? 0xffffff, roughness: 0.6 }),
    );
    o.name = group + ' wires';
    wires.add(o);
  }
  showWiring(w);
}
function showWiring(w: Wiring) {
  const total = w.wires.reduce((t, x) => t + x.length, 0);
  $('wiring-summary').innerHTML =
    `<small>${w.wires.length} wires, ${w.nets.reduce((t, n) => t + n.joints, 0)} solder joints, ${(total / 1000).toFixed(2)} m cut length per hand, including ${project.config.wiring.service_loop_mm} mm service loop on each feed and ${project.config.wiring.end_allowance_mm} mm at each end.</small>`;
  const nice = (k: string) => prettyKey(k.replace(/^(matrix|thumb)_/, ''));
  const pin = (net: string) => w.nets.find((n) => n.name === net)?.pin ?? '';
  $('matrix-table').innerHTML =
    '<tr><th>Key</th><th>Row</th><th>Column</th></tr>' +
    w.matrix
      .map(
        (m) =>
          `<tr><td>${nice(m.key)}</td><td>${m.row} (pin ${pin(m.row)})</td><td>${m.column} (pin ${pin(m.column)})</td></tr>`,
      )
      .join('');
  $('cut-list').innerHTML =
    '<tr><th>Net</th><th>Pin</th><th>Wires</th><th>Joints</th><th>Cut m</th></tr>' +
    w.nets
      .map(
        (n) =>
          `<tr><td>${n.name}</td><td>${n.pin}</td><td>${n.wires}</td><td>${n.joints}</td><td>${(n.length / 1000).toFixed(2)}</td></tr>`,
      )
      .join('');
}
function visibility() {
  for (const o of parts.children)
    o.visible =
      o.userData.group === 'keycaps'
        ? $('caps').matches(':checked')
        : o.userData.group === 'switch'
          ? false
          : o.userData.group === 'pads'
            ? $('wires').matches(':checked')
            : ADAPTER_GROUPS.includes(o.userData.group)
              ? $('adapter').matches(':checked')
              : $('parts').matches(':checked');
  wires.visible = $('wires').matches(':checked');
  basePlate.visible = $('base').matches(':checked') && (!handCase || handCase());
  bounds.visible = $('bounds').matches(':checked') && !bounds.box.isEmpty();
  if (edges.visible !== $('edges').matches(':checked')) {
    edges.visible = !edges.visible;
    setEdges();
  }
  handleGroup.visible = $('edit').matches(':checked') && !handLayout;
  render();
}
function autosave() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(project));
    $('save-state').textContent = 'Autosaved locally';
  } catch {
    $('save-state').textContent = 'Autosave unavailable — save a project file';
  }
}
function snapshot() {
  undo.push(clone(project));
  if (undo.length > 60) undo.shift();
  redo.length = 0;
  historyButtons();
}
function historyButtons() {
  $<HTMLButtonElement>('undo').disabled = !undo.length;
  $<HTMLButtonElement>('redo').disabled = !redo.length;
}
/** One undoable change: the new project replaces the old, the inputs follow and a build is scheduled. Throws, changing nothing, if it is invalid. */
function commit(next: Project, deselect = false) {
  validateProject(next);
  snapshot();
  project = next;
  if (deselect) selected = '';
  refreshInputs();
  edited();
}
function markStale() {
  clearFailures();
  revision++;
  solidRevision = -1;
  report = undefined;
  $<HTMLButtonElement>('stl').disabled = true;
  $<HTMLButtonElement>('stl-base').disabled = true;
  $<HTMLButtonElement>('report').disabled = true;
  setBadge('', 'Not checked for this edit');
  $('fit-list').replaceChildren();
  $('view-state').textContent = hasShell
    ? 'Editing — showing the previous chassis until rebuild'
    : 'Editing — first chassis is pending';
}
function preview() {
  try {
    handLayout?.();
    componentFrames(project.config);
    updateHardware();
    updateHandles();
    handUpdate?.();
    parts.visible = true;
  } catch (e) {
    parts.visible = false;
    render();
    $('view-state').textContent = String(e) + ' — undo to recover';
  }
}
function edited() {
  markStale();
  preview();
  autosave();
  clearTimeout(timer);
  timer = setTimeout(requestBuild, 250);
}
function refreshInputs() {
  $<HTMLInputElement>('bottom-out').value = String(
    project.config.switch.keycap_bottom_above_plate_mm - project.config.switch.travel_mm,
  );
  $<HTMLTextAreaElement>('config').value = JSON.stringify(project.config, null, 2);
  updateSelection();
}
// What the worker is building: the saved report records exactly this.
let inFlight: { id: number; project: Project } | undefined, evaluated: Project | undefined;
let worker: Worker,
  workerBuilds = 0;
// A safety net: a fresh worker takes over every 8 builds, in case a build leaves
// geometry-engine memory behind that its own cleanup missed.
function startWorker() {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  workerBuilds = 0;
  worker.onmessage = (e: MessageEvent<BuildResult & { id: number; error?: string }>) => {
    clearTimeout(timeout);
    busy = false;
    if (++workerBuilds >= 8) restartWorker();
    if (e.data.id === revision) {
      if (e.data.error) {
        setBadge('fail', 'Invalid geometry');
        $('view-state').textContent = e.data.error + ' — edit or undo to recover';
        $('fit-list').replaceChildren();
      } else {
        setShell(e.data);
        updateWiring(e.data.wiring);
        updateFailures(e.data.highlights);
        report = e.data.report;
        if (inFlight?.id === e.data.id) evaluated = inFlight.project;
        solidRevision = revision;
        showReport(report);
        $<HTMLButtonElement>('stl').disabled = false;
        $<HTMLButtonElement>('stl-base').disabled = false;
        $<HTMLButtonElement>('report').disabled = false;
        $('view-state').textContent =
          `Chassis rebuilt in ${(report.milliseconds / 1000).toFixed(2)} s`;
      }
    }
    if (pending) {
      pending = false;
      requestBuild();
    }
  };
  worker.onerror = (e) => {
    clearTimeout(timeout);
    busy = false;
    pending = false;
    setBadge('fail', 'Geometry worker failed');
    $('view-state').textContent = e.message;
    restartWorker();
  };
}
function restartWorker() {
  worker.terminate();
  startWorker();
}
function requestBuild() {
  clearTimeout(timer);
  for (const o of [shell, trim]) o.visible = !handCase || handCase();
  visibility();
  if (handCase && !handCase()) {
    $('view-state').textContent = 'Case not built (prototype: tick Build the case)';
    return;
  }
  if (drag || busy) {
    pending = true;
    return;
  }
  pending = false;
  busy = true;
  const id = revision;
  setBadge('', 'Building chassis & checking fit…');
  const sent = prototypeOverrides(project, location.search);
  inFlight = { id, project: sent };
  worker.postMessage({ id, project: sent });
  timeout = setTimeout(() => {
    busy = false;
    pending = false;
    restartWorker();
    setBadge('fail', 'Rebuild timed out');
    $('view-state').textContent =
      'Worker stopped after 30 seconds. Undo the last change or try Rebuild again.';
  }, 30000);
}
function showReport(r: Report) {
  setBadge(
    r.passed ? 'pass' : 'fail',
    r.passed ? 'Clearance checks PASS' : 'Clearance checks FAIL',
  );
  const list = $('fit-list');
  list.replaceChildren();
  for (const { text, name } of reportLines(r)) {
    const li = document.createElement('li');
    if (name) {
      const b = document.createElement('button');
      b.textContent = text;
      b.dataset.failure = name;
      b.setAttribute('aria-pressed', 'false');
      b.onclick = () => focusFailure(name);
      li.append(b);
    } else li.textContent = text;
    list.append(li);
  }
}
function step(from: Project[], to: Project[]) {
  const p = from.pop();
  if (!p) return;
  to.push(clone(project));
  project = p;
  historyButtons();
  refreshInputs();
  edited();
}
$('undo').onclick = () => step(undo, redo);
$('redo').onclick = () => step(redo, undo);
$('reset').onclick = () => commit(clone(defaults));
for (const id of TOGGLES)
  $(id).onchange = () => {
    visibility();
    saveView();
  };
$('opacity').oninput = () => {
  material.opacity = Number($<HTMLInputElement>('opacity').value);
  material.transparent = material.opacity < 1;
  material.depthWrite = !material.transparent;
  material.needsUpdate = true;
  render();
  saveView();
};
let viewTimer: ReturnType<typeof setTimeout> | undefined;
controls.addEventListener('change', () => {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(saveView, 300);
});
function saveView() {
  try {
    localStorage.setItem(
      VIEW_STORAGE,
      JSON.stringify({
        camera: {
          position: camera.position.toArray(),
          target: controls.target.toArray(),
          up: camera.up.toArray(),
          zoom: camera.zoom,
        },
        toggles: Object.fromEntries(TOGGLES.map((id) => [id, $<HTMLInputElement>(id).checked])),
        opacity: Number($<HTMLInputElement>('opacity').value),
      }),
    );
  } catch {}
}
// Restores what saveView stored, skipping anything malformed. A mark in the URL
// sets its own camera, so the stored one is left alone then.
function restoreView() {
  let v: any;
  try {
    v = JSON.parse(localStorage.getItem(VIEW_STORAGE) ?? 'null');
  } catch {
    return;
  }
  if (!v || typeof v !== 'object') return;
  const vec = (a: unknown) =>
    Array.isArray(a) && a.length === 3 && a.every((n) => Number.isFinite(n));
  const c = v.camera;
  if (
    !new URLSearchParams(location.search).has('mark') &&
    c &&
    vec(c.position) &&
    vec(c.target) &&
    vec(c.up) &&
    Number.isFinite(c.zoom)
  ) {
    placeCamera(camera, controls, {
      ...c,
      zoom: Math.min(controls.maxZoom, Math.max(controls.minZoom, c.zoom)),
    });
  }
  if (v.toggles && typeof v.toggles === 'object')
    for (const id of TOGGLES)
      if (typeof v.toggles[id] === 'boolean') $<HTMLInputElement>(id).checked = v.toggles[id];
  visibility();
  const o = v.opacity;
  if (Number.isFinite(o) && o >= 0.1 && o <= 1) {
    $<HTMLInputElement>('opacity').value = String(o);
    $('opacity').dispatchEvent(new Event('input'));
  }
}
$('rebuild').onclick = requestBuild;
$('bottom-out').onchange = () => {
  const n = Number($<HTMLInputElement>('bottom-out').value);
  if (!Number.isFinite(n) || n < 0 || n > 20) {
    refreshInputs();
    return;
  }
  const next = clone(project);
  next.config.switch.keycap_bottom_above_plate_mm = next.config.switch.travel_mm + n;
  commit(next);
};
$('apply-config').onclick = () => {
  try {
    const next = clone(project);
    next.config = JSON.parse($<HTMLTextAreaElement>('config').value);
    commit(next);
    $('load-error').textContent = '';
  } catch (e) {
    $('load-error').textContent = String(e);
  }
};
function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export').onclick = () =>
  download('rosebear-chassis-project.json', JSON.stringify(project, null, 2), 'application/json');
$('report').onclick = () => {
  if (solidRevision === revision && report && evaluated)
    download(
      'rosebear-clearance-report.json',
      JSON.stringify({ report, evaluatedProject: evaluated }, null, 2),
      'application/json',
    );
};
const exportStl = (id: string, name: string, mesh: T.Mesh) =>
  ($(id).onclick = () => {
    if (solidRevision !== revision) return;
    download(
      name,
      new STLExporter().parse(mesh, { binary: true }) as DataView<ArrayBuffer>,
      'application/octet-stream',
    );
  });
exportStl('stl', 'rosebear-right-review.stl', shell);
exportStl('stl-base', 'rosebear-right-bottom.stl', basePlate);
$('import').onclick = () => $<HTMLInputElement>('file').click();
$('file').onchange = async () => {
  const input = $<HTMLInputElement>('file'),
    file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw Error('Project file exceeds 2 MB');
    const next = JSON.parse(await file.text());
    commit(next, true);
    $('load-error').textContent = '';
  } catch (e) {
    $('load-error').textContent = String(e);
  } finally {
    input.value = '';
  }
};
const ray = new T.Raycaster(),
  pointer = new T.Vector2();
let drag:
  | {
      plane: T.Plane;
      start: T.Vector3;
      point: T.Vector3;
      id: string;
      changed: boolean;
      base: Project;
    }
  | undefined;
function cursor(e: PointerEvent) {
  ray.setFromCamera(clientToNdc(renderer.domElement, e.clientX, e.clientY, pointer), camera);
}
const screen = (p: T.Vector3) => worldToClient(renderer.domElement, camera, p);
renderer.domElement.addEventListener(
  'pointerdown',
  (e) => {
    if (e.button !== 0 || !$('edit').matches(':checked') || handLayout || marks.painting()) return;
    let best = 13,
      hit: ReturnType<typeof handles>[number] | undefined;
    for (const h of handles(project)) {
      const s = screen(h.at),
        d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
      if (s.visible && d < best) {
        best = d;
        hit = h;
      }
    }
    if (!hit) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    selected = hit.id;
    updateSelection();
    updateHandles();
    cursor(e);
    const plane = new T.Plane().setFromNormalAndCoplanarPoint(
        camera.getWorldDirection(new T.Vector3()),
        hit.at,
      ),
      start = ray.ray.intersectPlane(plane, new T.Vector3());
    if (!start) return;
    drag = {
      plane,
      start,
      point: hit.at.clone(),
      id: hit.id,
      changed: false,
      base: clone(project),
    };
    controls.enabled = false;
    renderer.domElement.setPointerCapture(e.pointerId);
    render();
  },
  true,
);
renderer.domElement.addEventListener(
  'pointermove',
  (e) => {
    if (!drag) return;
    e.stopImmediatePropagation();
    cursor(e);
    const hit = ray.ray.intersectPlane(drag.plane, new T.Vector3());
    if (!hit) return;
    const delta = hit.sub(drag.start);
    if (
      drag.point
        .clone()
        .add(delta)
        .toArray()
        .some((x) => Math.abs(x) > 1000)
    )
      return;
    let next: Project;
    try {
      next = dragTo(
        drag.base,
        drag.id,
        delta,
        drag.point,
        camera.getWorldDirection(new T.Vector3()),
      );
      validateProject(next);
    } catch {
      return;
    }
    if (!drag.changed) {
      snapshot();
      clearTimeout(timer);
    }
    markStale();
    project = next;
    drag.changed = true;
    preview();
    updateSelection();
  },
  true,
);
function endDrag(e: PointerEvent, cancel = false) {
  if (!drag) return;
  e.stopImmediatePropagation();
  if (cancel && drag.changed) {
    const previous = undo.pop();
    if (previous) project = previous;
    historyButtons();
    preview();
  }
  const changed = drag.changed;
  drag = undefined;
  controls.enabled = true;
  refreshInputs();
  autosave();
  if (changed) requestBuild();
}
renderer.domElement.addEventListener('pointerup', (e) => endDrag(e), true);
renderer.domElement.addEventListener('pointercancel', (e) => endDrag(e, true), true);
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input,textarea,select')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    $(e.shiftKey ? 'redo' : 'undo').click();
  }
});
// Used by browser tests to inspect the exact state behind visible controls.
Object.assign(window, {
  rosebearEditor: {
    getProject: () => clone(project),
    getRevision: () => revision,
    getSolidRevision: () => solidRevision,
    getSelected: () => selected,
    getVisible: () => ({ shell: shell.visible, base: basePlate.visible, trim: trim.visible }),
    handleScreen: (id: string) => {
      const h = handles(project).find((h) => h.id === id);
      if (!h) throw Error('No handle ' + id);
      return screen(h.at);
    },
    getWiring: () => routed,
    getHardware: () =>
      parts.children.map((o) => ({
        name: o.name,
        group: o.userData.group,
        visible: o.visible,
        matrix: o.matrix.elements.slice(),
      })),
    getHighlights: () =>
      failures.children.map((m) => ({
        name: m.name,
        kind: m.userData.kind,
        visible: failures.visible && m.visible,
        triangles: (m as T.Mesh).geometry.getIndex()!.count / 3,
        color: ((m as T.Mesh).material as T.MeshBasicMaterial).color.getHex(),
      })),
  },
});
// Review marks painted on the model, saved by the dev server (vite.config.ts),
// so only there.
const marks = !import.meta.env.DEV
  ? { painting: () => false }
  : setupMarks({
      scene,
      camera,
      controls,
      renderer,
      targets: () => [
        [shell, 'shell'],
        [basePlate, 'bottom section'],
        [trim, 'trim'],
        ...parts.children.map((o): [T.Object3D, string] => [o, o.userData.group ?? 'other']),
      ],
      render,
    });
if (import.meta.env.DEV && new URLSearchParams(location.search).has('hand'))
  ({
    layout: handLayout,
    update: handUpdate,
    buildCase: handCase,
  } = setupHand({
    scene,
    camera,
    dom: renderer.domElement,
    orbit: controls,
    project: () => project,
    snapshot,
    edited,
    render,
  }));
restoreView();
historyButtons();
refreshInputs();
preview();
startWorker();
requestBuild();
resize();
