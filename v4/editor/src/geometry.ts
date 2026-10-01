import { Matrix4, Vector3 } from 'three';
import defaultConfig from './default-config.json';
export type V3 = [number, number, number];
export type Config = typeof defaultConfig;
export interface Project {
  version: 2;
  config: Config;
}
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}
export const defaults: Project = { version: 2, config: defaultConfig };
export const clone = <T>(v: T): T => structuredClone(v);
export const add = (a: number[], b: number[]): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: number[], b: number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: number[], b: number[]): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const unit = (a: number[]): V3 => {
  const n = Math.hypot(...a);
  if (n < 1e-10) throw Error('Zero-length direction');
  return a.map((x) => x / n) as V3;
};
export function frame(origin: number[] = [0, 0, 0], angles: number[] = [0, 0, 0]) {
  const a = angles.map((x) => (x * Math.PI) / 180);
  return new Matrix4()
    .makeRotationZ(a[2])
    .multiply(new Matrix4().makeRotationY(a[1]))
    .multiply(new Matrix4().makeRotationX(a[0]))
    .setPosition(...(origin as V3));
}
export const point = (m: Matrix4, p: number[]) =>
  new Vector3(...(p as V3)).applyMatrix4(m).toArray() as V3;
export type Pose = { name?: string; offset_mm?: number[]; rotation_deg?: number[] };
export type Cluster = {
  position_mm: number[];
  rotation_deg: number[];
  keys: Pose[];
  arc: { radius_mm: number; step_deg: number; well_deg: number };
};
export const ROWS = ['top', 'home', 'bottom'] as const;
/** Layout coordinates are before tenting: +Y away from the user, +Z up. The tent
 * (a rotation about Y) and the mount lift are applied last, to every frame. */
export const tentFrame = (cfg: Config) => {
  const t = frame([0, 0, 0], [0, cfg.geometry.tent_deg, 0]);
  t.elements[14] = cfg.geometry.mount_lift_mm;
  return t;
};
/** Finger column: its keys sit at row_pitch spacing in Y (plus the column's
 * stagger, offset_mm[1]) at the three heights given. Each key tilts along the
 * column to follow the parabola through those three heights, and sideways by
 * roll_deg. rotation_deg then turns the whole key about its own centre. */
export function columnFrames(cfg: Config, ci: number) {
  const g = cfg.geometry,
    col = g.columns[ci],
    x = (ci - 2) * g.column_pitch_mm + col.offset_mm[0],
    ys = ROWS.map((_, ri) => (1 - ri) * g.row_pitch_mm + col.offset_mm[1]),
    zs = col.heights_mm;
  // Slope of the parabola through the three (y,z) points: derivative of the Lagrange form.
  const dz = (y: number) => {
    let s = 0;
    for (let j = 0; j < 3; j++) {
      let d = 0;
      for (let k = 0; k < 3; k++)
        if (k !== j) {
          let p = 1 / (ys[j] - ys[k]);
          for (let m = 0; m < 3; m++) if (m !== j && m !== k) p *= (y - ys[m]) / (ys[j] - ys[m]);
          d += p;
        }
      s += zs[j] * d;
    }
    return s;
  };
  const dx = Math.tan((col.roll_deg * Math.PI) / 180);
  return ROWS.map((_, ri) => {
    const dy = dz(ys[ri]),
      normal = unit([-dx, -dy, 1]),
      across = unit([1, 0, dx]),
      along = cross(normal, across);
    return new Matrix4()
      .makeBasis(new Vector3(...across), new Vector3(...along), new Vector3(...normal))
      .setPosition(x, ys[ri], zs[ri])
      .multiply(frame([0, 0, col.offset_mm[2]], col.rotation_deg));
  });
}
/** Thumb cluster: keys fan along an arc of radius radius_mm, step_deg apart,
 * centred on position_mm. Each key also tilts toward the cluster's middle by
 * well_deg per key step, rising so its centre stays on a circle through the
 * middle of the cluster. */
export function clusterFrames(c: Cluster) {
  const root = frame(c.position_mm, c.rotation_deg),
    n = c.keys.length,
    R = c.arc.radius_mm;
  return c.keys.map((key, i) => {
    const t = i - (n - 1) / 2,
      angle = t * c.arc.step_deg,
      a = (angle * Math.PI) / 180,
      w = t * c.arc.well_deg,
      rise = Math.abs(R * Math.sin(a)) * Math.tan(((Math.abs(w) / 2) * Math.PI) / 180);
    return root
      .clone()
      .multiply(frame([R * Math.sin(a), R * (Math.cos(a) - 1), rise], [0, 0, -angle]))
      .multiply(frame([0, 0, 0], [0, -w, 0]))
      .multiply(frame(key.offset_mm, key.rotation_deg));
  });
}
/**
 * Which way a finger tile slides onto its tile rests, as a sign along its key's
 * y axis: back (+1), toward the socket, except in the bottom row, which has no
 * room in front for that past the front swept end and slides forward (-1).
 */
export const slideToward = (key: string) =>
  key.startsWith('matrix_') && key.endsWith('_bottom') ? -1 : 1;
export function componentFrames(cfg: Config) {
  const g = cfg.geometry,
    n: Record<string, Matrix4> = {};
  g.columns.forEach((col, ci) =>
    columnFrames(cfg, ci).forEach((m, ri) => {
      const name = `matrix_${col.name}_${ROWS[ri]}`,
        over = (g.key_overrides as Record<string, Pose>)[name] || {};
      n[name] = m.multiply(frame(over.offset_mm, over.rotation_deg));
    }),
  );
  for (const c of [g.thumb, (g as { thumb_extra?: Cluster }).thumb_extra])
    if (c) clusterFrames(c).forEach((m, i) => (n['thumb_' + c.keys[i].name] = m));
  n.trackpad = frame(cfg.trackpad.position_mm, cfg.trackpad.rotation_deg);
  const tent = tentFrame(cfg);
  for (const key in n) n[key].premultiply(tent);
  // The trackpad housing is symmetric about its frame's xz plane, and its mount
  // tongue points along +x: turn the frame about the pad's normal so +x points
  // at the key it is mounted to, seen along that normal.
  const toward = n[cfg.trackpad.mount_toward];
  if (toward) {
    const f = n.trackpad,
      local = new Vector3().setFromMatrixPosition(toward).applyMatrix4(f.clone().invert());
    f.multiply(frame([0, 0, 0], [0, 0, (Math.atan2(local.y, local.x) * 180) / Math.PI]));
  }
  // The adapter lies on the bottom plate, so it is placed in world coordinates.
  const a = cfg.adapter;
  n.adapter = frame(
    [a.position_mm[0], a.position_mm[1], cfg.chassis.base_thickness_mm + a.standoff_mm],
    [0, 0, a.rotation_deg],
  );
  return n;
}
/**
 * Bring a project saved by an earlier editor up to date: sections added since
 * are filled in from the defaults, and the adapter, which changed meaning in
 * schema 2, is replaced.
 */
export function migrate(c: Record<string, any>) {
  const d = defaultConfig as Record<string, any>;
  if (!(c.schema >= 2)) {
    c.adapter = clone(d.adapter);
    c.schema = 2;
  }
  const fill = (to: Record<string, any>, from: Record<string, any>) => {
    for (const [k, v] of Object.entries(from))
      if (!(k in to)) to[k] = clone(v);
      else if (
        v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        to[k] &&
        typeof to[k] === 'object'
      )
        fill(to[k], v);
  };
  for (const k of ['tile', 'adapter', 'ribbon', 'trackpad', 'wiring', 'chassis'])
    if (!c[k]) c[k] = clone(d[k]);
    else fill(c[k], d[k]);
}
export function validateProject(p: unknown): asserts p is Project {
  const a = p as Project;
  if (!a || a.version !== 2 || !a.config)
    throw Error('Not a Rosebear editor project (version 2 required).');
  const check = (x: unknown): void => {
    if (typeof x === 'number' && (!Number.isFinite(x) || Math.abs(x) > 1000))
      throw Error('Configuration numbers must be finite and within ±1000.');
    if (x && typeof x === 'object') Object.values(x).forEach(check);
  };
  check(a.config);
  migrate(a.config);
  const c = a.config;
  if (!c.geometry || !c.switch || !c.tile || !c.trackpad || !c.adapter)
    throw Error('Missing component configuration');
  if (
    c.geometry.columns?.length !== 5 ||
    c.geometry.columns.some(
      (col) =>
        col.heights_mm?.length !== 3 ||
        col.offset_mm?.length !== 3 ||
        col.rotation_deg?.length !== 3 ||
        !Number.isFinite(col.roll_deg),
    )
  )
    throw Error(
      'Each of the five columns needs three heights, an offset, a rotation and a roll angle.',
    );
  for (const cl of [c.geometry.thumb, (c.geometry as { thumb_extra?: Cluster }).thumb_extra])
    if (cl) {
      if (
        !cl.keys?.length ||
        cl.position_mm?.length !== 3 ||
        cl.rotation_deg?.length !== 3 ||
        !(cl.arc?.radius_mm > 0) ||
        !Number.isFinite(cl.arc.step_deg) ||
        !Number.isFinite(cl.arc.well_deg)
      )
        throw Error('Invalid thumb cluster');
    }
  componentFrames(c);
}
