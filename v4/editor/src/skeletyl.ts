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
// part has its own ends: a round where it clears what the other keys hold
// (their tiles, switches and keycap rooms), else flush with the plate.
// The outline is a rounded ring round the free ends' feet (where their drops
// would meet the floor) and the outer sides of the first and last columns'
// and the thumb rows' plates and tile pockets: their convex hull, dug in a
// little, then rounded and carried out by `flare`, so walls down those sides
// can flare out clear of the tiles. The ends whose feet are near it drop to
// the floor, each foot carried on along the end in a curve to the outline,
// where that clears the other keys; the rest stop at the bottom of their
// rounds. One rail round the outline, on the floor, joins the ribs into one
// piece, and where neighbouring columns both drop, close, a band fills
// between their drops up to the lower round.
// Nothing is cut out: chassis.ts adds the glue pads and the base, and the
// checks report anything that runs into the tiles or the keycaps.
// PROTOTYPE: chassis.walls (?walls=) adds walls under the outer sides, built
// by skeletyl-walls.prototype.ts from a WallSide per side; "none" adds none.
// PROTOTYPE: chassis.ends (?ends=) adds supports under the hanging ends, built
// by skeletyl-ends.prototype.ts from one EndsFrame; "none" adds none.
//
// Terms, as in chassis.ts, and:
//  rib      a run of keys along one key axis, swept as one solid;
//  station  one cross-section of a rib: its top and underside at both sides;
//  end      a rib's lip and round past its end key, with a drop to the floor
//           if it stands on the outline;
//  foot     where an end's drop would meet the floor straight down, on its
//           outer face (before it is carried out to the outline);
//  band     the wall filling between neighbouring columns' drops.
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import type { Matrix4 } from 'three';
import {
  add,
  cross,
  dot,
  isKey,
  keycapEnvelope,
  ROWS,
  scale,
  sub,
  type Config,
  type V3,
} from './geometry';
import {
  plateHalfWidths,
  PLATES,
  tilePocketDepth,
  tilePocketHalf,
  type HalfWidths,
} from './plates';
import { mesh } from './shell/loft';
import { switchHole } from './seats';
import { outline } from './hand/frame';
import { skeletylWalls, type WallPoint, type WallSide } from './skeletyl-walls.prototype';
import { railHelpers, skeletylEnds, type EndsFrame, type RibEnd } from './skeletyl-ends.prototype';

/** Construction sizes in mm. */
export const SIZES = {
  /** The ends and the rail are this thick, unless chassis.wall_mm says. */
  wall: 2.4,
  /** The ends' rounds have this outer radius, unless chassis.end_radius_mm says. */
  endRadius: 5,
  /** An end's lip is at least this long, and grows by lipStep until its round and drop clear the end key's tile pocket and switch body by endGap. Rounds, drops and bands keep endGap from what the other keys hold too, or are not built. */
  lip: 1,
  lipStep: 0.1,
  endGap: 0.3,
  /** Stations inside each web, round each end's round, and along each foot's curve. */
  webSteps: 8,
  roundSteps: 8,
  footSteps: 6,
  /** The outline digs in this far at most (plan), before it is rounded. */
  digDeepest: 12,
  /** The outline stands this far out (plan) from the feet and the outer sides' plates and tile pockets it is built round: room for walls to flare out. */
  flare: 5,
  /** The outline's corners in are rounded to this radius (plan); its corners out to flare. */
  corner: 10,
  /** Segments per full turn of the outline's rounding. */
  cornerSegments: 72,
  /** An end drops to the floor if the outline is at most this far out along the end from the nearer of its feet (plan); its foot carries out that far. */
  reach: 12,
  /** A foot carried out starts to curve out this high per mm it carries out (1.5: 45° at its steepest), lower if its round is low. */
  footRise: 1.5,
  /** Neighbouring columns' drops at the same end are banded together where their facing feet are at most this far apart (plan); */
  bandGap: 15,
  /** the band reaches this far into each drop. */
  bandInto: 0.5,
  /** PROTOTYPE ?walls=: a wall side has points this many steps across each plate. */
  plateSteps: 5,
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
/** A rib: which run it is from, its keys in order, and whether each end (first, last) is where the run parted. */
interface Rib {
  run: number;
  keys: RibKey[];
  parted: [boolean, boolean];
}
/** How a rib's end finishes: flush with the plate's edge, a round alone, or a round and a drop to the floor, its foot carried on along the end this far (plan) to the outline. */
type End = 'flush' | 'hang' | { out: number };
/** A point on one side of a rib: [top, underside]; on a drop, [outer face, inner face]. */
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
const lerp = (p: V3, q: V3, f: number) => add(p, scale(sub(q, p), f));

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
  keyRuns.forEach((run, r) => {
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
      out.push({ run: r, keys: part, parted: [parted, i < keys.length] });
      part = [keys[i]];
      parted = true;
    }
  });
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
 * plane through that axis, until it is vertical. A dropping end drops from
 * there, and its foot curves out along the end to the outline (its `out`),
 * meeting the floor at 45° (or flatter, if the round is low). The lip is as
 * short as lets the round's inner face, and the drop's below it, clear the
 * tile pocket and switch body by endGap. Nothing goes below the floor.
 */
function endSide(d: Dims, k: RibKey, u: number, s: number, end: End): Pair[] {
  const path: Pair[] = [[corner(d, k, u, s, 0), corner(d, k, u, s, -d.plate)]];
  if (end === 'flush') return path;
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
  if (end !== 'hang') {
    // The drop, and its foot: from `rise` up the outer face curves out by
    // the end's `out` along h, leaving the drop and meeting the floor upright
    // (out (3f² - 2f³) out at rise (1 - f) up), the inner face thickening to
    // stay a wall's thickness in from it, square to the curve.
    const [top, under] = path.at(-1)!;
    const rise = Math.max(0, Math.min(SIZES.footRise * Math.abs(end.out), 0.9 * top[2]));
    const at = (p: V3, z: number): V3 => [p[0], p[1], z];
    path.push([at(top, rise), at(under, rise)]);
    for (let j = 1; j <= SIZES.footSteps; j++) {
      const f = j / SIZES.footSteps;
      const p = add(at(top, rise * (1 - f)), scale(h, end.out * (3 * f * f - 2 * f ** 3)));
      const slope = rise > 0 ? (6 * end.out * f * (1 - f)) / rise : 0;
      path.push([p, add(p, scale(sub(under, top), Math.hypot(1, slope)))]);
    }
  }
  return path.map((pair) => pair.map((p) => [p[0], p[1], Math.max(0, p[2])]) as Pair);
}

/**
 * One side of a rib, from its first end's foot (or round, or plate edge) to
 * its last's. `over` (if given) is filled with what each point is on: a key's
 * name over its plate, "" over a web, undefined on an end.
 */
function ribSide(d: Dims, rib: Rib, s: number, ends: End[], over?: (string | undefined)[]): Pair[] {
  const keys = rib.keys;
  const path = endSide(d, keys[0], -1, s, ends[0]).reverse();
  const on: (string | undefined)[] = path.map(() => undefined);
  on[on.length - 1] = keys[0].name;
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
      for (let j = 1; j < SIZES.webSteps; j++) {
        path.push([top(j / SIZES.webSteps), under(j / SIZES.webSteps)]);
        on.push('');
      }
      path.push([corner(d, k, -1, s, 0), corner(d, k, -1, s, -d.plate)]);
      on.push(k.name);
    }
    path.push([corner(d, k, 1, s, 0), corner(d, k, 1, s, -d.plate)]);
    on.push(k.name);
  });
  const last = endSide(d, keys.at(-1)!, 1, s, ends[1]).slice(1);
  path.push(...last);
  over?.push(...on, ...last.map(() => undefined));
  return path;
}

const square: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
/** The solid through stations, each joined to the next, the first and last closed. */
const solid = (wasm: ManifoldToplevel, cfg: Config, stations: Station[]) =>
  mesh(
    { wasm, cfg, frames: {} },
    stations.map((st) => ({ pts: square, place: (_w: number, _z: number, j: number) => st[j] })),
  );

/** A rib's solid. */
function ribSolid(wasm: ManifoldToplevel, cfg: Config, d: Dims, rib: Rib, ends: End[]) {
  const [left, right] = [-1, 1].map((s) => ribSide(d, rib, s, ends));
  return solid(
    wasm,
    cfg,
    left.map((l, i): Station => [l[1], right[i][1], right[i][0], l[0]]),
  );
}

/** A rib's end key and which way its end faces along it (end 0: first, 1: last). */
const endKey = (rib: Rib, end: number): [RibKey, number] =>
  end ? [rib.keys.at(-1)!, 1] : [rib.keys[0], -1];

/** The feet of a rib's end, if it dropped straight down: its outer face's foot at each side. */
const feet = (d: Dims, rib: Rib, end: number) =>
  [-1, 1].map((s): V3 => {
    const p = endSide(d, ...endKey(rib, end), s, 'hang').at(-1)![0];
    return [p[0], p[1], 0];
  });

/**
 * The outline, counter-clockwise: round the feet's convex hull, dug in at most
 * digDeepest, and the outer sides' plates' and tile pockets' hulls, rounded to
 * `corner` out and in and standing flare out from them (at a sharp corner a
 * little less).
 */
function rounded(wasm: ManifoldToplevel, d: Dims, feet: V3[], sides: V3[][]) {
  const R = SIZES.corner;
  const plan = (ps: V3[]) => ps.map((p) => [p[0], p[1]] as [number, number]);
  const round = (c: CrossSection, by: number) => c.offset(by, 'Round', 2, SIZES.cornerSegments);
  const area = wasm.CrossSection.union([
    new wasm.CrossSection([plan(outline(feet, d.wall, SIZES.digDeepest))], 'NonZero'),
    ...sides.map((side) => wasm.CrossSection.hull([plan(side)])),
  ]);
  // Out by flare and R and back by R: everywhere at least flare out, the
  // corners out rounded to flare about the area's corners, the corners in to R.
  // (Rounding the corners out wider would bring them in closer than flare.)
  return round(round(area, SIZES.flare + R), -R)
    .toPolygons()
    .map((p) => p.map((q) => [q[0], q[1]] as [number, number]))
    .reduce((x, y) => (area2(y) > area2(x) ? y : x));
}
/** How far the ring is from p along plan direction h: the first crossing ahead if p is inside it, else the nearest. */
function toRing(ring: [number, number][], p: V3, h: V3) {
  const hits = ring.flatMap((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const e = [b[0] - a[0], b[1] - a[1]];
    const w = [a[0] - p[0], a[1] - p[1]];
    const den = h[0] * e[1] - h[1] * e[0];
    const f = (h[1] * w[0] - h[0] * w[1]) / den;
    return Math.abs(den) > 1e-12 && f >= 0 && f < 1 ? [(w[0] * e[1] - w[1] * e[0]) / den] : [];
  });
  const ahead = hits.filter((t) => t > 0);
  return ahead.length % 2
    ? Math.min(...ahead)
    : hits.reduce((x, y) => (Math.abs(y) < Math.abs(x) ? y : x), Infinity);
}
/** Twice a plan polygon's signed area. */
const area2 = (p: number[][]) =>
  p.reduce((sum, q, i) => {
    const r = p[(i + 1) % p.length];
    return sum + q[0] * r[1] - r[0] * q[1];
  }, 0);

/** Points over the faces of the solid between two sides (from station `from` on): across at quarters, at each station and halfway to the next. */
const samples = (left: Pair[], right: Pair[], from = 0) =>
  left.flatMap((l, i) =>
    i < from
      ? []
      : [0, 1].flatMap((j) =>
          [0, 0.25, 0.5, 0.75, 1].flatMap((f) => {
            const p = lerp(l[j], right[i][j], f);
            return i > from ? [p, lerp(p, lerp(left[i - 1][j], right[i - 1][j], f), 0.5)] : [p];
          }),
        ),
  );

/**
 * What key n holds, as boxes in its own coordinates ([centre, half-widths]),
 * as the hardware check has them: its tile and the tile's components, its
 * switch body, and its keycap's room, from the plate up, the cap's base wide.
 */
function keyBoxes(cfg: Config, n: string): [V3, V3][] {
  const { switch: sw, tile } = cfg;
  const pcb = -tile.plate_top_to_pcb_top_mm;
  const half = (size: number[]) => size.map((x) => x / 2) as V3;
  const env = keycapEnvelope(cfg, n, { clampFloor: true });
  const cap = env.z0 + env.height;
  return [
    [[0, 0, pcb - tile.size_mm[2] / 2], half(tile.size_mm)],
    ...tile.components.map((c): [V3, V3] => [
      [c.center_mm[0], c.center_mm[1], c.center_mm[2] + pcb],
      half(c.size_mm),
    ]),
    [[0, 0, sw.body_mm[2] / 2 - sw.body_below_plate_mm], half(sw.body_mm)],
    [
      [0, 0, cap / 2],
      [env.base[0] / 2, env.base[1] / 2, cap / 2],
    ],
  ];
}

/** Whether points stay endGap clear of what every key but `except` holds. */
function clearOfKeys(cfg: Config, frames: Record<string, Matrix4>, points: V3[], except?: string) {
  return Object.keys(frames)
    .filter((n) => isKey(n) && n !== except)
    .every((n) => {
      const e = frames[n].elements;
      const boxes = keyBoxes(cfg, n);
      return points.every((p) => {
        const q = sub(p, [e[12], e[13], e[14]]);
        const local = [0, 4, 8].map((i) => dot(q, [e[i], e[i + 1], e[i + 2]]));
        return boxes.every(([c, h]) =>
          local.some((x, i) => Math.abs(x - c[i]) > h[i] + SIZES.endGap),
        );
      });
    });
}

/** Whether a rib's end can finish as `kind`: what it adds past the plate's edge is clear of the other keys. */
function endClear(
  cfg: Config,
  d: Dims,
  frames: Record<string, Matrix4>,
  rib: Rib,
  end: number,
  kind: End,
) {
  const [k, u] = endKey(rib, end);
  const [left, right] = [-1, 1].map((s) => endSide(d, k, u, s, kind));
  return clearOfKeys(cfg, frames, samples(left, right, 1), k.name);
}

/** One side of a dropping end, from the bottom of its round to the floor. */
const dropSide = (d: Dims, rib: Rib, end: number, s: number, kind: End) =>
  endSide(d, ...endKey(rib, end), s, kind).slice(SIZES.roundSteps + 1);
/** A point on a drop side at height z, its outer and inner faces. */
function dropAt(side: Pair[], z: number): Pair {
  const i = Math.max(0, side.findIndex((p) => p[0][2] <= z) - 1);
  const [p, q] = [side[i], side[i + 1] ?? side[i]];
  const f = p[0][2] - q[0][2] > 1e-9 ? (p[0][2] - z) / (p[0][2] - q[0][2]) : 0;
  return [lerp(p[0], q[0], f), lerp(p[1], q[1], f)];
}

/**
 * The band between two neighbouring columns' drops at the same end (each a
 * rib and its end's kind): their facing sides joined at each height either
 * has a station at, from the floor up to the lower one's round, each reaching
 * bandInto into its drop. None if they are far apart, or it would hit a key.
 */
function band(
  wasm: ManifoldToplevel,
  cfg: Config,
  d: Dims,
  frames: Record<string, Matrix4>,
  end: number,
  pair: [Rib, End][],
) {
  const sides = pair.map(([rib, kind], i) => {
    const [k, o] = [rib, pair[1 - i][0]].map((r) => endKey(r, end)[0]);
    const s = Math.sign(dot(k.c, sub(o.o, k.o)));
    const into = scale([...unitPlan(k.c), 0] as V3, -s * SIZES.bandInto);
    return dropSide(d, rib, end, s, kind).map((p) => p.map((q) => add(q, into)) as Pair);
  });
  const feetApart = Math.hypot(...sub(sides[0].at(-1)![0], sides[1].at(-1)![0]));
  if (feetApart > SIZES.bandGap) return [];
  const top = Math.min(...sides.map((side) => side[0][0][2]));
  const levels = [...new Set(sides.flatMap((side) => side.map((p) => p[0][2])))]
    .filter((z) => z <= top)
    .sort((x, y) => x - y)
    .filter((z, i, all) => !i || z - all[i - 1] > 0.01);
  const [left, right] = sides.map((side) => levels.map((z) => dropAt(side, z)));
  if (levels.length < 2 || !clearOfKeys(cfg, frames, samples(left, right))) return [];
  const stations = levels.map((_, i): Station => {
    const st: Station = [left[i][0], left[i][1], right[i][1], right[i][0]];
    return area2(st) > 0 ? st : (st.reverse() as Station);
  });
  return [solid(wasm, cfg, stations)];
}

/** How far below the plate top the openings check probes each switch hole's column (solid.ts CHECKS.probeHeight / 2). */
const OPENING_PROBE_DEPTH = 12;

/**
 * PROTOTYPE ?walls= and ?ends=: what every key holds (keyBoxes) and its
 * switch hole's column as far down as the openings check probes it, each box
 * in its key's frame and grown by endGap; with whether a point is clear of
 * them all, and how far out along a plan direction from a point everything is.
 */
function keySpace(cfg: Config, frames: Record<string, Matrix4>) {
  const hole = switchHole(cfg).map((x) => x / 2);
  const column: [V3, V3] = [
    [0, 0, -OPENING_PROBE_DEPTH / 2],
    [hole[0], hole[1], OPENING_PROBE_DEPTH / 2],
  ];
  const boxes = Object.keys(frames)
    .filter(isKey)
    .flatMap((n) => {
      const e = frames[n].elements;
      const o: V3 = [e[12], e[13], e[14]];
      const axes = [0, 4, 8].map((i): V3 => [e[i], e[i + 1], e[i + 2]]);
      return [...keyBoxes(cfg, n), column].map(([c, h]) => ({
        o,
        axes,
        c,
        h: h.map((x) => x + SIZES.endGap),
      }));
    });
  const clear = (points: V3[]) =>
    points.every((p) =>
      boxes.every((b) => b.axes.some((a, i) => Math.abs(dot(sub(p, b.o), a) - b.c[i]) > b.h[i])),
    );
  // The last x up to `reach` where from + x out is in a box, by each box's slabs.
  const room = (from: V3, out: V3, reach: number) => {
    let last = 0;
    for (const b of boxes) {
      let [lo, hi] = [-Infinity, Infinity];
      b.axes.forEach((a, i) => {
        const [at, rate] = [dot(sub(from, b.o), a) - b.c[i], dot(out, a)];
        if (Math.abs(rate) < 1e-12) {
          if (Math.abs(at) > b.h[i]) [lo, hi] = [Infinity, -Infinity];
          return;
        }
        const [p, q] = [(-b.h[i] - at) / rate, (b.h[i] - at) / rate];
        [lo, hi] = [Math.max(lo, Math.min(p, q)), Math.min(hi, Math.max(p, q))];
      });
      if (lo <= hi && hi >= 0 && lo <= reach) last = Math.max(last, hi);
    }
    return last >= reach ? Infinity : last;
  };
  return { clear, room };
}

/**
 * PROTOTYPE ?walls=: rib's outer side (s) as a WallSide for the wall
 * variants (skeletyl-walls.prototype.ts documents each field). Its points are
 * the rib's side as built (ribSide), outward is across the rib at each, and the
 * rail is found straight out along it.
 */
function wallSide(
  cfg: Config,
  d: Dims,
  frames: Record<string, Matrix4>,
  rib: Rib,
  ends: End[],
  s: number,
  name: string,
  ring: [number, number][],
  innerRing: [number, number][],
): WallSide {
  const labels: (string | undefined)[] = [];
  const sides = [ribSide(d, rib, s, ends, labels), ribSide(d, rib, -s, ends)];
  // Points across each plate too, between its corners (exact: it is a slab).
  const on: (string | undefined)[] = [];
  const [side, other] = sides.map((path) =>
    path.flatMap((pair, i): Pair[] => {
      const next = path[i + 1];
      if (!labels[i] || labels[i] !== labels[i + 1]) return [pair];
      return [...Array(SIZES.plateSteps).keys()].map(
        (j) => pair.map((p, m) => lerp(p, next[m], j / SIZES.plateSteps)) as Pair,
      );
    }),
  );
  labels.forEach((l, i) =>
    on.push(...Array(l && l === labels[i + 1] ? SIZES.plateSteps : 1).fill(l)),
  );
  const flat = (p: number[]): V3 => [p[0], p[1], 0];
  const points = side.map(([top, under], i): WallPoint => {
    const out = flat(unitPlan(sub(under, other[i][1])));
    const at = (r: [number, number][]) => flat(add(under, scale(out, toRing(r, under, out))));
    const [inner, outerEdge] = [at(innerRing), at(ring)];
    const key = on[i] || undefined;
    return {
      top,
      under,
      out,
      over: on[i] === undefined ? 'end' : key ? 'key' : 'web',
      key,
      rail: { inner, centre: lerp(inner, outerEdge, 0.5), outer: outerEdge },
    };
  });
  const keys = rib.keys.map((k) => ({
    name: k.name,
    from: on.indexOf(k.name),
    to: on.lastIndexOf(k.name),
  }));
  const space = keySpace(cfg, frames);
  const room = (from: V3, out: V3) => space.room(from, out, toRing(ring, from, out));
  const finish = (e: End) => (typeof e === 'object' ? 'drop' : e);
  return {
    name,
    points,
    keys,
    ends: [finish(ends[0]), finish(ends[1])],
    wall: d.wall,
    railHeight: SIZES.railHeight,
    outline: ring,
    clear: space.clear,
    room,
  };
}

/**
 * PROTOTYPE ?ends=: the frame as an EndsFrame for the end-support variants
 * (skeletyl-ends.prototype.ts documents each field): every rib end as built
 * (endSide), the rail, and the key space.
 */
function endsFrame(
  cfg: Config,
  d: Dims,
  frames: Record<string, Matrix4>,
  all: Rib[],
  ends: End[][],
  named: string[],
  ring: [number, number][],
  innerRing: [number, number][],
): EndsFrame {
  const columns = cfg.geometry.columns.length;
  const flat = (p: number[]): V3 => [...unitPlan(p), 0] as V3;
  const list = all.flatMap((rib, i) =>
    [0, 1].map((e): RibEnd => {
      const [k, u] = endKey(rib, e);
      const kind = ends[i][e];
      const finish = typeof kind === 'object' ? 'drop' : kind;
      const sides = [-1, 1].map((s) => endSide(d, k, u, s, kind)) as [Pair[], Pair[]];
      const at = finish === 'flush' ? 0 : SIZES.roundSteps + 1;
      const [outer, inner] = [0, 1].map((j) => [sides[0][at][j], sides[1][at][j]]) as [
        [V3, V3],
        [V3, V3],
      ];
      const centre = scale([...outer, ...inner].reduce(add), 1 / 4);
      return {
        rib: named[i],
        group: rib.run < columns ? 'finger' : 'thumb',
        ...(rib.run < columns ? { column: rib.run } : {}),
        key: k.name,
        at: e ? 'last' : 'first',
        parted: rib.parted[e],
        finish,
        out: flat(scale(k.a, u)),
        across: flat(k.c),
        bottom: { outer, inner },
        centre,
        height: centre[2],
        sides,
      };
    }),
  );
  const fronts = [...Array(columns).keys()].map((c) =>
    list.find((x) => x.column === c && x.at === 'first')!,
  );
  const toPinky = flat(sub(fronts.at(-1)!.centre, fronts[0].centre));
  // Square to toPinky, on the side the fronts face.
  const square = flat(cross(toPinky, [0, 0, 1]));
  const facing = fronts.reduce((sum, f) => sum + dot(f.out, square), 0) >= 0 ? 1 : -1;
  const space = keySpace(cfg, frames);
  return {
    ends: list,
    hanging: list.filter((x) => x.finish === 'hang'),
    fronts,
    columns,
    toPinky,
    toFront: scale(square, facing),
    wall: d.wall,
    rail: { height: SIZES.railHeight, inner: innerRing, outer: ring },
    ...railHelpers(ring, d.wall),
    clear: space.clear,
    room: (from, out) => space.room(from, out, toRing(ring, from, out)),
  };
}

/**
 * The frame: the ribs, the bands between their drops, and the rail round the
 * outline that the ends standing on it drop to. It stands on z = 0.
 */
export function skeletyl(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
): { frame: Manifold; outline: [number, number][] } {
  const d = dims(cfg);
  const keyRuns = runs(cfg, frames);
  const all = ribs(d, frames, keyRuns);
  const columns = cfg.geometry.columns.length;
  // The outer sides: each key's plate and tile pocket edges on the side away
  // from the keys' middle, on the first and last columns and the thumb rows.
  const keys = all.flatMap((r) => r.keys);
  const middle = [0, 1].map((i) => keys.reduce((sum, k) => sum + k.o[i], 0) / keys.length);
  const outward = (rib: Rib) =>
    Math.sign(
      rib.keys.reduce(
        (sum, k) => sum + k.c[0] * (k.o[0] - middle[0]) + k.c[1] * (k.o[1] - middle[1]),
        0,
      ),
    );
  const outer = (rib: Rib) => rib.run === 0 || rib.run >= columns - 1;
  const outerSide = (rib: Rib) => {
    const s = outward(rib);
    const [pocket, depth] = d.keepClear[0];
    return rib.keys.flatMap((k) =>
      [-1, 1].flatMap((u) => [
        corner(d, k, u, s, 0),
        corner(d, k, u, s, -d.plate),
        keyPoint(k, pocket, u, s, -depth),
      ]),
    );
  };
  const free = (rib: Rib) => [0, 1].filter((e) => !rib.parted[e]);
  const ring = rounded(
    wasm,
    d,
    all.flatMap((rib) => free(rib).flatMap((e) => feet(d, rib, e))),
    all.filter(outer).map(outerSide),
  );
  const kind = (rib: Rib, e: number): End => {
    if (rib.parted[e]) return endClear(cfg, d, frames, rib, e, 'hang') ? 'hang' : 'flush';
    const [k, u] = endKey(rib, e);
    const h = [...unitPlan(scale(k.a, u)), 0] as V3;
    const drop = { out: Math.min(...feet(d, rib, e).map((p) => toRing(ring, p, h))) };
    return drop.out <= SIZES.reach && endClear(cfg, d, frames, rib, e, drop) ? drop : 'hang';
  };
  const ends = all.map((rib) => [0, 1].map((e) => kind(rib, e)));
  const solids = all.map((rib, i) => ribSolid(wasm, cfg, d, rib, ends[i]));
  // The bands: neighbouring columns' first ribs at the front, last at the back.
  const bands = [0, 1].flatMap((e) =>
    [...Array(columns - 1).keys()].flatMap((c) => {
      const pair = [c, c + 1].map((run): [Rib, End] => {
        const i = all.flatMap((r, j) => (r.run === run ? [j] : [])).at(e ? -1 : 0)!;
        return [all[i], ends[i][e]];
      });
      return pair.every(([, kind]) => typeof kind === 'object')
        ? band(wasm, cfg, d, frames, e, pair)
        : [];
    }),
  );
  const area = new wasm.CrossSection([ring], 'NonZero');
  const inside = area.offset(-d.wall, 'Round');
  const rail = area.subtract(inside).extrude(SIZES.railHeight);
  // The ribs' names (as the wall and end variants have them), and the rail's inner edge.
  const named = all.map((rib) => {
    const n =
      rib.run < columns
        ? cfg.geometry.columns[rib.run].name
        : rib.run === columns
          ? 'thumb'
          : 'thumb extra';
    const same = all.filter((r) => r.run === rib.run);
    return same.length > 1 ? `${n} #${same.indexOf(rib) + 1}` : n;
  });
  const innerRing = () =>
    inside
      .toPolygons()
      .map((p) => p.map((q) => [q[0], q[1]] as [number, number]))
      .reduce((x, y) => (area2(y) > area2(x) ? y : x));
  // PROTOTYPE ?walls= (skeletyl-walls.prototype.ts): walls under the outer sides.
  const walls = skeletylWalls(wasm, cfg, (cfg.chassis as { walls?: string }).walls ?? 'none', () =>
    all.flatMap((rib, i) =>
      outer(rib)
        ? [wallSide(cfg, d, frames, rib, ends[i], outward(rib), named[i], ring, innerRing())]
        : [],
    ),
  );
  // PROTOTYPE ?ends= (skeletyl-ends.prototype.ts): supports under the hanging ends.
  const supports = skeletylEnds(wasm, cfg, (cfg.chassis as { ends?: string }).ends ?? 'none', () =>
    endsFrame(cfg, d, frames, all, ends, named, ring, innerRing()),
  );
  return {
    frame: wasm.Manifold.union([...solids, ...bands, rail, ...walls, ...supports]),
    outline: ring,
  };
}
