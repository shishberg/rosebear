// The Skeletyl-style chassis (chassis.style "skeletyl"): an open frame of ribs
// standing on a rail, built from the key poses.
//
// A rib is a run of keys along one key axis: each finger column, front to
// back, and each thumb row, along it. Each rib is one solid, swept through
// stations: at each, a cross-section of four points, the rib's top and
// underside at both its sides (the plates' edges across the keys). Over a key
// the rib is the key's plate, an exact slab the switch seat is cut into.
// Between neighbouring keys a web carries the top and the underside from one
// plate to the next along cubics tangent to both. Past each end key a short
// lip carries the plate on along its own axis, and a round turns it down to
// vertical; the lip is as long as it must be for the round, and the drop
// under it, to clear the end key's tile pocket and switch body. Where the next
// key's plate edge isn't past this one's along either key's axis (the plates
// overlap in plan, or a web would fold back) the rib parts there, and each
// part has its own ends.
// The ends' feet, where their drops would meet the floor, are ringed by the
// outline: their convex hull, dug in a little. The ends standing on it drop
// to the floor; the rest stop at the bottom of their rounds. One rail round
// the outline, on the floor, joins the ribs into one piece. Nothing is cut
// out: chassis.ts adds the glue pads and the base, and the checks report
// anything that runs into the tiles or the keycaps.
//
// Terms, as in chassis.ts, and:
//  rib      a run of keys along one key axis, swept as one solid;
//  station  one cross-section of a rib: its top and underside at both sides;
//  end      a rib's lip and round past its end key, with a drop to the floor
//           if it stands on the outline;
//  foot     where an end's drop meets the floor, on its outer face.
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { Matrix4 } from 'three';
import { add, cross, dot, ROWS, scale, sub, type Config, type V3 } from './geometry';
import {
  plateHalfWidths,
  PLATES,
  tilePocketDepth,
  tilePocketHalf,
  type HalfWidths,
} from './plates';
import { mesh } from './shell/loft';
import { outline } from './hand/frame';

/** Construction sizes in mm. */
export const SIZES = {
  /** The ends and the rail are this thick, unless chassis.wall_mm says. */
  wall: 2.4,
  /** The ends' rounds have this outer radius, unless chassis.end_radius_mm says. */
  endRadius: 5,
  /** An end's lip is at least this long, and grows by lipStep until its round and drop clear the end key's tile pocket and switch body by endGap. */
  lip: 1,
  lipStep: 0.1,
  endGap: 0.3,
  /** Stations inside each web, and round each end's round. */
  webSteps: 8,
  roundSteps: 8,
  /** The outline digs in this far at most (plan). */
  digDeepest: 12,
  /** An end drops to the floor if either of its feet is this close to the outline (plan). */
  onOutline: 1.5,
  /** The rail round the outline: its height. */
  railHeight: 6,
} as const;

/** A key in a rib: its plate's centre, the key axis the rib runs along, across it, and its normal (right-handed: a = c × n). */
interface RibKey {
  name: string;
  o: V3;
  a: V3;
  c: V3;
  n: V3;
  /** Which key axis a is (0: x, 1: y). */
  axis: number;
}
/** A rib: its keys in order, and whether each end (first, last) is where a run parted. */
interface Rib {
  keys: RibKey[];
  parted: [boolean, boolean];
}
/** How a rib's end finishes: a round and a drop to the floor, a round alone, or flush with the plate's edge. */
type End = 'drop' | 'hang' | 'flush';
/** A point on one side of a rib: [top, underside]. */
type Pair = [V3, V3];
/** A station: [left underside, right underside, right top, left top]. */
type Station = [V3, V3, V3, V3];

/** The sizes the ribs are built from, in mm. */
function dims(cfg: Config) {
  const c = cfg.chassis as { wall_mm?: number; end_radius_mm?: number };
  const sw = cfg.switch;
  return {
    plate: cfg.chassis.plate_thickness_mm,
    wall: c.wall_mm ?? SIZES.wall,
    radius: c.end_radius_mm ?? SIZES.endRadius,
    plateHalf: plateHalfWidths(cfg),
    /** What an end keeps clear under its key: the tile pocket and the switch body, as [half-widths, depth below the plate top]. */
    keepClear: [
      [tilePocketHalf(cfg), tilePocketDepth(cfg)],
      [
        sw.cutout_mm.map((x) => (x + sw.cutout_clearance_mm) / 2) as HalfWidths,
        PLATES.switchBelowPlate,
      ],
    ] as [HalfWidths, number][],
  };
}
type Dims = ReturnType<typeof dims>;

const along = (k: RibKey, h: HalfWidths) => h[k.axis];
const across = (k: RibKey, h: HalfWidths) => h[1 - k.axis];
/** A point under or on key k: u and s along and across (in half-widths `half`), z along the normal. */
const keyPoint = (k: RibKey, half: HalfWidths, u: number, s: number, z: number) =>
  add(
    add(k.o, scale(k.a, u * along(k, half))),
    add(scale(k.c, s * across(k, half)), scale(k.n, z)),
  );
/** A point on key k's plate: u and s are -1 or 1 for its edges along and across. */
const corner = (d: Dims, k: RibKey, u: number, s: number, z: number) =>
  keyPoint(k, d.plateHalf, u, s, z);
const unitPlan = (v: number[]) => {
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l];
};

/**
 * The runs of keys the ribs are made from, in order: each finger column front
 * to back, and each thumb row along it. Extra thumb keys that carry on past
 * one end of the thumb row (beside it, not in front) join it as one row.
 */
function runs(cfg: Config, frames: Record<string, Matrix4>) {
  const layout = cfg.geometry as Config['geometry'] & {
    thumb_extra?: { keys: { name: string }[] };
  };
  const centre = (n: string) => [frames[n].elements[12], frames[n].elements[13]];
  const byX = (ns: string[]) => ns.sort((a, b) => centre(a)[0] - centre(b)[0]);
  const mainRow = byX(layout.thumb.keys.map((k) => 'thumb_' + k.name));
  const extra = byX((layout.thumb_extra?.keys ?? []).map((k) => 'thumb_' + k.name));
  const columns = layout.columns.map((c) =>
    [...ROWS].reverse().map((r) => `matrix_${c.name}_${r}`),
  );
  if (mainRow.length < 2 || !extra.length)
    return [...columns, mainRow, extra].filter((r) => r.length);
  const [a, b] = [centre(mainRow[0]), centre(mainRow.at(-1)!)];
  const dir = unitPlan([b[0] - a[0], b[1] - a[1]]);
  const rowAlong = (n: string) => (centre(n)[0] - a[0]) * dir[0] + (centre(n)[1] - a[1]) * dir[1];
  const end = rowAlong(mainRow.at(-1)!);
  const beside = extra.every((n) => rowAlong(n) > end) || extra.every((n) => rowAlong(n) < 0);
  const thumbs = beside
    ? [[...mainRow, ...extra].sort((p, q) => rowAlong(p) - rowAlong(q))]
    : [mainRow, extra];
  return [...columns, ...thumbs];
}

/**
 * The ribs: each run's keys, each along the key axis that best follows the run
 * there, parted between neighbours that can't be webbed.
 */
function ribs(d: Dims, frames: Record<string, Matrix4>, keyRuns: string[][]): Rib[] {
  const out: Rib[] = [];
  for (const run of keyRuns) {
    const keys = run.map((name, i): RibKey => {
      const e = frames[name].elements;
      const p = frames[run[Math.max(0, i - 1)]].elements;
      const q = frames[run[Math.min(run.length - 1, i + 1)]].elements;
      // A lone key runs along its own x.
      const dir = run.length > 1 ? [q[12] - p[12], q[13] - p[13]] : [e[0], e[1]];
      const best = [0, 1]
        .flatMap((axis) => [1, -1].map((sign) => ({ axis, sign })))
        .reduce((x, y) => {
          const score = (c: { axis: number; sign: number }) =>
            c.sign * (e[c.axis * 4] * dir[0] + e[c.axis * 4 + 1] * dir[1]);
          return score(y) > score(x) ? y : x;
        });
      const a = [0, 1, 2].map((j) => best.sign * e[best.axis * 4 + j]) as V3;
      const n: V3 = [e[8], e[9], e[10]];
      return { name, o: [e[12], e[13], e[14]], a, c: cross(n, a), n, axis: best.axis };
    });
    let part = [keys[0]];
    let parted = false;
    for (let i = 1; i <= keys.length; i++) {
      if (i < keys.length && webbable(d, keys[i - 1], keys[i])) {
        part.push(keys[i]);
        continue;
      }
      out.push({ keys: part, parted: [parted, i < keys.length] });
      part = [keys[i]];
      parted = true;
    }
  }
  return out;
}

/** Whether keys p and q (next along the rib) can be webbed: each plate's facing edge is past the other's, along the other's axis. */
function webbable(d: Dims, p: RibKey, q: RibKey) {
  const past = (k: RibKey, other: RibKey, sign: number) =>
    [-1, 1].every((s) =>
      [0, -d.plate].every(
        (z) => sign * dot(sub(corner(d, other, -sign, s, z), k.o), k.a) > along(k, d.plateHalf),
      ),
    );
  return past(p, q, 1) && past(q, p, -1);
}

/**
 * One side (s, -1 or 1 across) of the end of key k that faces u (-1 or 1
 * along), from the plate's corner out. A flush end stops there. Otherwise a
 * lip runs on along the key's axis, then the round turns down, in the upright
 * plane through that axis, until it is vertical, and a dropping end drops
 * from there to the floor. The lip is as short as lets the round's inner face,
 * and the drop's below it, clear the tile pocket and switch body by endGap.
 * Nothing goes below the floor.
 */
function endSide(d: Dims, k: RibKey, u: number, s: number, kind: End): Pair[] {
  const path: Pair[] = [[corner(d, k, u, s, 0), corner(d, k, u, s, -d.plate)]];
  if (kind === 'flush') return path;
  const R = d.radius;
  const inner = d.radius - d.wall;
  const E = path[0][0];
  const t = scale(k.a, u);
  const h = [...unitPlan(t), 0] as V3;
  const [cos, sin] = [Math.hypot(t[0], t[1]), t[2]];
  // What must stay clear, in the round's plane: out along h from E, and up.
  const keep = d.keepClear.flatMap(([half, depth]) =>
    [-1, 1].flatMap((sc) =>
      [-d.plate, -depth].map((z) => {
        const p = sub(keyPoint(k, half, u, sc, z), E);
        return [dot(p, h), p[2]];
      }),
    ),
  );
  // With a lip L long, the round's centre is at (cx, cz): a point is clear if
  // it is under the lip, inside the round, or inside the drop.
  const clear = (L: number) => {
    const cx = L * cos + R * sin;
    const cz = L * sin - R * cos;
    const room = inner - SIZES.endGap;
    return keep.every(
      ([x, z]) => x <= cx || (z >= cz ? Math.hypot(x - cx, z - cz) <= room : x <= cx + room),
    );
  };
  let L = SIZES.lip;
  while (!clear(L) && L < 50) L += SIZES.lipStep;
  // The round's outward direction where its tangent is at angle a up from h.
  const out = (a: number): V3 => add(scale(h, -Math.sin(a)), [0, 0, Math.cos(a)]);
  const start = Math.atan2(sin, cos);
  const centre = sub(add(E, scale(t, L)), scale(out(start), R));
  for (let j = 0; j <= SIZES.roundSteps; j++) {
    const a = start + ((-Math.PI / 2 - start) * j) / SIZES.roundSteps;
    path.push([add(centre, scale(out(a), R)), add(centre, scale(out(a), inner))]);
  }
  if (kind === 'drop') path.push(path.at(-1)!.map((p) => [p[0], p[1], 0]) as Pair);
  return path.map((pair) => pair.map((p) => [p[0], p[1], Math.max(0, p[2])]) as Pair);
}

/** One side of a rib, from its first end's foot (or round, or plate edge) to its last's. */
function ribSide(d: Dims, rib: Rib, s: number, ends: End[]): Pair[] {
  const keys = rib.keys;
  const path = endSide(d, keys[0], -1, s, ends[0]).reverse();
  keys.forEach((k, i) => {
    if (i > 0) {
      // The web from the last key's plate: its top and its underside, each a cubic.
      const p = keys[i - 1];
      const web = (z: number) => {
        const A = corner(d, p, 1, s, z);
        const B = corner(d, k, -1, s, z);
        const handle = Math.hypot(...sub(B, A)) / 3;
        const ctrl = [A, add(A, scale(p.a, handle)), sub(B, scale(k.a, handle)), B];
        return (f: number) => {
          const w = [(1 - f) ** 3, 3 * f * (1 - f) ** 2, 3 * f * f * (1 - f), f ** 3];
          return ctrl.reduce((sum, q, m) => add(sum, scale(q, w[m])), [0, 0, 0] as V3);
        };
      };
      const [top, under] = [web(0), web(-d.plate)];
      for (let j = 1; j < SIZES.webSteps; j++)
        path.push([top(j / SIZES.webSteps), under(j / SIZES.webSteps)]);
      path.push([corner(d, k, -1, s, 0), corner(d, k, -1, s, -d.plate)]);
    }
    path.push([corner(d, k, 1, s, 0), corner(d, k, 1, s, -d.plate)]);
  });
  path.push(...endSide(d, keys.at(-1)!, 1, s, ends[1]).slice(1));
  return path;
}

/** A rib's solid: its stations, each joined to the next, the first and last closed. */
function ribSolid(wasm: ManifoldToplevel, cfg: Config, d: Dims, rib: Rib, ends: End[]) {
  const [left, right] = [-1, 1].map((s) => ribSide(d, rib, s, ends));
  const stations = left.map((l, i): Station => [l[1], right[i][1], right[i][0], l[0]]);
  const square: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  return mesh(
    { wasm, cfg, frames: {} },
    stations.map((st) => ({ pts: square, place: (_w: number, _z: number, j: number) => st[j] })),
  );
}

/** The feet of a rib's end (0: first, 1: last), if it dropped: its outer face's foot at each side. */
const feet = (d: Dims, rib: Rib, end: number) =>
  [-1, 1].map((s) => {
    const k = end ? rib.keys.at(-1)! : rib.keys[0];
    return endSide(d, k, end ? 1 : -1, s, 'drop').at(-1)![0];
  });

/** Plan distance from p to the segment ab. */
const segmentDistance = (p: number[], a: number[], b: number[]) => {
  const v = [b[0] - a[0], b[1] - a[1]];
  const l = v[0] * v[0] + v[1] * v[1];
  const f = l && Math.max(0, Math.min(1, ((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1]) / l));
  return Math.hypot(p[0] - a[0] - f * v[0], p[1] - a[1] - f * v[1]);
};

/**
 * The frame: the ribs, and the rail round the outline that the ends standing
 * on it drop to. It stands on z = 0.
 */
export function skeletyl(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
): { frame: Manifold; outline: [number, number][] } {
  const d = dims(cfg);
  const all = ribs(d, frames, runs(cfg, frames));
  // Where a run parted, the ends face the other part's keys: there is no
  // room for a round there, so they are flush with the plate's edge.
  const free = (rib: Rib) => [0, 1].filter((e) => !rib.parted[e]);
  const ring = outline(
    all.flatMap((rib) => free(rib).flatMap((e) => feet(d, rib, e))),
    d.wall,
    SIZES.digDeepest,
  ).map((p) => [p[0], p[1]] as [number, number]);
  const onRing = (p: V3) =>
    ring.some((a, i) => segmentDistance(p, a, ring[(i + 1) % ring.length]) <= SIZES.onOutline);
  const kind = (rib: Rib, e: number): End =>
    rib.parted[e] ? 'flush' : feet(d, rib, e).some(onRing) ? 'drop' : 'hang';
  const solids = all.map((rib) =>
    ribSolid(
      wasm,
      cfg,
      d,
      rib,
      [0, 1].map((e) => kind(rib, e)),
    ),
  );
  const area = new wasm.CrossSection([ring], 'NonZero');
  const rail = area.subtract(area.offset(-d.wall, 'Miter')).extrude(SIZES.railHeight);
  return { frame: wasm.Manifold.union([...solids, rail]), outline: ring };
}
