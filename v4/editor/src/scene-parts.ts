// Meshes for the hardware, wiring and handles, and the visibility toggles
// that decide which of them show.
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hardware } from './parts';
import type { BuildResult } from './solid';
import type { Wiring } from './wiring';
import { disposeChildren } from './three-util';
import { prettyKey } from './report-lines';
import { handles, clusters } from './handles';
import { $, S } from './state';
import {
  shell,
  basePlate,
  trim,
  edges,
  bounds,
  parts,
  wires,
  handleGroup,
  setEdges,
  setMesh,
  measure,
  render,
  captureFaceOrder,
} from './viewer';

const handleColors = { key: 0xffd48b, cluster: 0x60dfff, turn: 0xff8fd8 };
export function updateHandles() {
  disposeChildren(handleGroup);
  const hs = handles(S.project);
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
  const sel = hs.find((h) => h.id === S.selected);
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
  for (const k of clusters(S.project.config)) {
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
  handleGroup.visible = $('edit').matches(':checked') && !S.handLayout;
  render();
}

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
export function updateHardware() {
  disposeChildren(parts);
  for (const p of hardware(S.project, undefined, panel)) {
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
export function updateWiring(w: Wiring) {
  S.routed = w;
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
    `<small>${w.wires.length} wires, ${w.nets.reduce((t, n) => t + n.joints, 0)} solder joints, ${(total / 1000).toFixed(2)} m cut length per hand, including ${S.project.config.wiring.service_loop_mm} mm service loop on each feed and ${S.project.config.wiring.end_allowance_mm} mm at each end.</small>`;
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
export function visibility() {
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
  basePlate.visible = $('base').matches(':checked') && (!S.handCase || S.handCase());
  bounds.visible = $('bounds').matches(':checked') && !bounds.box.isEmpty();
  if (edges.visible !== $('edges').matches(':checked')) {
    edges.visible = !edges.visible;
    setEdges();
  }
  handleGroup.visible = $('edit').matches(':checked') && !S.handLayout;
  render();
}
export function setShell(r: BuildResult) {
  S.hasShell = true;
  setMesh(shell, r.mesh);
  setMesh(basePlate, r.base);
  setMesh(trim, r.trim);
  setEdges();
  measure();
  if (panel !== r.panel) {
    panel = r.panel;
    updateHardware();
  }
  captureFaceOrder();
  render();
}
