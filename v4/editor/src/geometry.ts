import { Matrix4, Vector3 } from 'three';
import defaultConfig from './default-config.json';
export type V3 = [number, number, number];
export type Config = typeof defaultConfig;
export interface Project {
  version: 2;
  config: Config;
  /** PROTOTYPE ?hand (src/hand/): its panel's state. */
  hand?: unknown;
}
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}
export const defaults: Project = { version: 2, config: defaultConfig };
export const clone = <T>(v: T): T => structuredClone(v);
export const add = (a: number[], b: number[]): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: number[], b: number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: number[], k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
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
export const isThumb = (name: string) => name.startsWith('thumb_');
export const isKey = (name: string) => isThumb(name) || name.startsWith('matrix_');
/** The keycap's clearance all round: its own, else the switch's. */
export const capClearance = (c: Config, n: string) =>
  (c.switch.keycap_clearance_overrides_mm as Record<string, number>)[n] ??
  c.switch.keycap_clearance_mm;
// The tile in key coordinates. Its parts' center_mm[2] is measured from the
// board's top (its switch side), so every use goes through these.
/** The z of the tile's top, its switch side. */
export const tileTop = (c: Config) => -c.tile.plate_top_to_pcb_top_mm;
/** The z of the tile's underside (where its pads are). */
export const tileUnderside = (c: Config) => tileTop(c) - c.tile.size_mm[2];
type TilePart = Config['tile']['components'][number];
/** A tile part's centre (the hotswap socket, LED or diode under the board). */
export const tilePartCentre = (c: Config, p: TilePart): V3 => [
  p.center_mm[0],
  p.center_mm[1],
  tileTop(c) + p.center_mm[2],
];
/** The z of the tile's lowest point: its underside, or the bottom of its lowest part. */
export const tileBottom = (c: Config) =>
  Math.min(
    tileUnderside(c),
    ...c.tile.components.map((p) => tilePartCentre(c, p)[2] - p.size_mm[2] / 2),
  );
/** Key names by group: the finger keys, the thumb row and the extra thumb row. */
export const keyGroups = (c: Config) => {
  const g = c.geometry as { thumb_extra?: Cluster } & typeof c.geometry,
    names = (cl?: Cluster) => (cl?.keys ?? []).map((k) => 'thumb_' + k.name);
  return {
    fingers: g.columns.flatMap((col) => ROWS.map((r) => `matrix_${col.name}_${r}`)),
    thumbs: names(g.thumb),
    extra: names(g.thumb_extra),
  };
};
export const capSize = (c: Config, n: string) =>
  ((c.switch.keycap_overrides_mm as Record<string, number[]>)[n] || c.switch.keycap_mm) as V3;
/** A keycap's top face: it tapers in from its base (capSize) by as much as
 * keycap_top_mm is smaller than keycap_mm, so a wider cap tapers alike. Without
 * keycap_top_mm the cap is a box. */
export const capTop = (c: Config, n: string): [number, number] => {
  const s = c.switch as { keycap_mm: number[]; keycap_top_mm?: number[] },
    size = capSize(c, n),
    top = s.keycap_top_mm ?? s.keycap_mm;
  return [0, 1].map((k) => size[k] - (s.keycap_mm[k] - top[k])) as [number, number];
};
/** A keycap's room in key coordinates: the taper (base to top, `height` tall)
 * from `z0` (its rest height over the plate), and under it the base's footprint
 * down to `floor` (where it is pressed). `clearance` grows it all round
 * (default: the key's own); `clampFloor` stops the floor at the plate. */
export const keycapEnvelope = (
  c: Config,
  n: string,
  o: { clearance?: number; clampFloor?: boolean } = {},
) => {
  const g = o.clearance ?? capClearance(c, n),
    cap = capSize(c, n),
    top = capTop(c, n),
    z0 = c.switch.keycap_bottom_above_plate_mm,
    pressed = z0 - c.switch.travel_mm;
  return {
    base: [cap[0] + 2 * g, cap[1] + 2 * g] as [number, number],
    top: [top[0] + 2 * g, top[1] + 2 * g] as [number, number],
    z0,
    height: cap[2] + g,
    floor: o.clampFloor ? Math.max(0, pressed) : pressed,
  };
};
export type KeycapEnvelope = ReturnType<typeof keycapEnvelope>;
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
function clusterFrames(c: Cluster) {
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
  const tent = tentFrame(cfg);
  for (const key in n) n[key].premultiply(tent);
  // The adapter stands on the bottom section, so it is placed in world coordinates.
  const a = cfg.adapter;
  n.adapter = frame(
    [a.position_mm[0], a.position_mm[1], cfg.chassis.skin_mm + a.standoff_mm],
    [0, 0, a.rotation_deg],
  );
  return n;
}
/**
 * Bring a project saved by an earlier editor up to date: sections added since
 * are filled in from the defaults, and the adapter, which changed meaning in
 * schema 2, is replaced. Schema 3 is the C64 chassis: the extra thumb keys
 * move out beside the thumb row, the adapter and ribbon move to the port
 * panel, and the trackpad is gone. Schema 4 moves the ribbon's landing onto
 * the port panel's insert. Schema 5 has the measured keycaps (18.5 mm square at
 * the base, 14 mm at the top, 11 mm high) and travel (3.5 mm), where a project
 * still has the earlier guesses.
 */
function migrate(c: Record<string, any>) {
  const d = defaultConfig as Record<string, any>;
  if (!(c.schema >= 2)) {
    c.adapter = clone(d.adapter);
    c.schema = 2;
  }
  if (!(c.schema >= 3)) {
    if (c.geometry) c.geometry.thumb_extra = clone(d.geometry.thumb_extra);
    for (const k of ['adapter', 'ribbon', 'wiring', 'chassis']) c[k] = clone(d[k]);
    delete c.trackpad;
    c.schema = 3;
  }
  if (!(c.schema >= 4)) {
    // Schema 4: the landing is on the port panel's insert, so the adapter
    // stands 4 mm further in to keep its loop clear of it (if not moved).
    const p = c.adapter?.position_mm;
    if (p && p[0] === -28 && p[1] === 16) c.adapter.position_mm = clone(d.adapter.position_mm);
    c.schema = 4;
  }
  if (!(c.schema >= 5)) {
    const s = c.switch,
      same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (s && same(s.keycap_mm, [18, 18, 9])) {
      s.keycap_mm = clone(d.switch.keycap_mm);
      s.keycap_top_mm = clone(d.switch.keycap_top_mm);
      if (same(s.keycap_overrides_mm?.thumb_home, [27.525, 18, 9]))
        s.keycap_overrides_mm.thumb_home = clone(d.switch.keycap_overrides_mm.thumb_home);
    }
    if (s?.travel_mm === 4) s.travel_mm = d.switch.travel_mm;
    c.schema = 5;
  }
  if (c.chassis && c.chassis.skin_mm === undefined && c.chassis.base_thickness_mm !== undefined)
    c.chassis.skin_mm = c.chassis.base_thickness_mm;
  delete c.chassis?.base_thickness_mm;
  // Switch fields every build reads. Not the whole section: its override tables
  // may be emptied on purpose.
  if (c.switch)
    for (const k of ['seat_outer_mm', 'travel_mm', 'keycap_clearance_mm'])
      if (c.switch[k] === undefined) c.switch[k] = clone(d.switch[k]);
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
  for (const k of ['tile', 'adapter', 'ribbon', 'wiring', 'chassis'])
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
  if (!c.geometry || !c.switch || !c.tile || !c.adapter)
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
  if (!(c.chassis.skin_mm > 1.5)) throw Error('chassis.skin_mm must exceed 1.5 mm.');
  componentFrames(c);
}
