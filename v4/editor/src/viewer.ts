// The three.js scene: camera, renderer, lights, the case meshes and the groups
// other modules fill, plus rendering, resizing and the camera presets.
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MeshData, V3 } from './geometry';
import { placeCamera } from './three-util';
import { $ } from './state';

const viewport = $('viewport');
export const scene = new T.Scene();
scene.background = new T.Color('#101d25');
export const camera = new T.OrthographicCamera(-120, 120, 100, -100, 0.1, 1500);
camera.up.set(0, 0, 1);
export const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = T.SRGBColorSpace;
viewport.prepend(renderer.domElement);
export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.target.set(-20, -25, 20);
controls.minZoom = 0.3;
controls.maxZoom = 8;
scene.add(new T.HemisphereLight(0xc7e8ed, 0x45585f, 2));
const light = new T.DirectionalLight(0xffffff, 2.5);
light.position.set(-60, -100, 180);
scene.add(light);
export const material = new T.MeshStandardMaterial({
  color: 0xb1cfca,
  roughness: 0.8,
  side: T.FrontSide,
});
export const shell = new T.Mesh(new T.BufferGeometry(), material);
scene.add(shell);
// The case's edges: wherever its faces meet at more than a degree.
export const edges = new T.LineSegments(
  new T.BufferGeometry(),
  new T.LineBasicMaterial({ color: 0x24343a }),
);
edges.visible = false;
scene.add(edges);
export function setEdges() {
  edges.geometry.dispose();
  // Until the first chassis arrives the case has no geometry to draw edges of.
  edges.geometry =
    edges.visible && shell.geometry.getAttribute('position')
      ? new T.EdgesGeometry(shell.geometry, 1)
      : new T.BufferGeometry();
}
export const basePlate = new T.Mesh(
  new T.BufferGeometry(),
  new T.MeshStandardMaterial({ color: 0x7f9a96, roughness: 0.8 }),
);
scene.add(basePlate);
// The port panel's dark insert.
export const trim = new T.Mesh(
  new T.BufferGeometry(),
  new T.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.6 }),
);
scene.add(trim);
// The box the size readout measures: case, bottom section and trim.
export const bounds = new T.Box3Helper(new T.Box3(), 0xffd36b);
bounds.visible = false;
scene.add(bounds);
export function measure() {
  const box = bounds.box.makeEmpty();
  for (const m of [shell, basePlate, trim]) box.expandByObject(m);
  const s = box.getSize(new T.Vector3());
  $('size').textContent = box.isEmpty()
    ? 'Size: no chassis'
    : `Size: ${s.x.toFixed(1)} W × ${s.y.toFixed(1)} D × ${s.z.toFixed(1)} H mm`;
  // How tall the board stands, to the keycaps' tops, with the bottom section and without.
  const top = box.max.z;
  const caps = new T.Box3();
  for (const o of parts.children) if (o.userData.group === 'keycaps') caps.expandByObject(o);
  const high = Math.max(top, caps.isEmpty() ? top : caps.max.z);
  const body = new T.Box3().expandByObject(shell);
  $('height').textContent = box.isEmpty()
    ? ''
    : `${(high - box.min.z).toFixed(1)} mm tall with keycaps, ${(high - body.min.z).toFixed(1)} without the bottom section`;
  bounds.visible = $('bounds').matches(':checked') && !box.isEmpty();
}
export const parts = new T.Group();
scene.add(parts);
export const wires = new T.Group();
scene.add(wires);
export const failures = new T.Group();
scene.add(failures);
export const handleGroup = new T.Group();
scene.add(handleGroup);
let originalIndices = new Uint32Array(),
  scheduled = false;
/** Keeps the case's triangle order, which transparency re-sorts by depth. */
export const captureFaceOrder = () => {
  originalIndices = (shell.geometry.getIndex()!.array as Uint32Array).slice();
};
export const geometry = (data: MeshData, sharp: boolean) => {
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
export function setMesh(mesh: T.Mesh, data: MeshData) {
  mesh.geometry.dispose();
  mesh.geometry = geometry(data, true);
}
export function render() {
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
export function resize() {
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
