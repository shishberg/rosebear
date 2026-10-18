// PROTOTYPE. Question: How should the Skeletyl support its hanging rib ends?
// Variants switchable via ?ends= on the editor (chassis.ends;
// prototype-overrides.ts), cycled with the second bar at the bottom of the dev
// editor (prototype-switcher.ts; the ↑ and ↓ keys).
//
// The hook: skeletyl.ts describes the whole frame's rib ends, and the rail
// round the outline, as one EndsFrame, plain data and a few callbacks, and
// unions whatever the selected variant builds into the frame. A variant is one
// function in its own file under skeletyl-ends/, `(kit, frame) => Manifold[]`,
// called once for the whole frame (a beam or an arch spans several ends); it
// reads nothing else of skeletyl.ts. "none" (the default) builds nothing: the
// frame exactly as without this hook.
//
// What needs support: the ends that hang (finish "hang"): a round that turns
// the rib down and stops in mid-air. They are the finger columns' fronts that
// face the thumbs (those not near enough the outline to drop to it) and some
// thumb row ends (where the thumb row parted, as between near and x1, and its
// free ends away from the outline). They are in the interior, between the
// thumbs and the fingers, where the wires run by hand under the keys: keeping
// some floor clear there is nice, but support comes first.
//
// Rules for a variant (the frame's, as for the walls):
//  - Build only material that should exist: sweeps (kit.sweep), hulls
//    (kit.wasm.Manifold.hull), extrusions. No subtract, intersect or trim.
//  - Keep clear of every key's tile, switch and keycap room: test points over
//    the faces of what you build with frame.clear (a few mm apart), and use
//    frame.room to find how far out there's space.
//  - Join the frame: reach about INTO (0.3 mm) into the ends you support and
//    into the rail (or a drop, a rib) you land on, so the union is one piece.
//  - One footprint: the frame's section 1.5 mm above the floor must be one
//    connected area (the footprint check). So anything standing on the floor
//    must join the rail at floor level (e.g. a runner along the floor to the
//    rail, at least 2 mm tall), or stand only on the rail; anything else must
//    stay at least 2 mm above the floor.
//  - Stay inside the outline (frame.rail.outer) in plan.
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { Config, V3 } from './geometry';
import { sweep } from './skeletyl-walls.prototype';
import { beam } from './skeletyl-ends/beam.prototype';
import { arch } from './skeletyl-ends/arch.prototype';
import { legs } from './skeletyl-ends/legs.prototype';
import { braces } from './skeletyl-ends/braces.prototype';

/** The end supports, in the switcher's order: the ?ends= key and a short name. */
export const END_SUPPORTS = [
  { key: 'none', name: 'hanging ends' },
  { key: 'beam', name: 'cross beam' },
  { key: 'arch', name: 'span arch' },
  { key: 'legs', name: 'standing legs' },
  { key: 'braces', name: 'diagonal braces' },
] as const;

/** A point pair across an end's two sides: [side 0, side 1] (side 0 is -across of side 1). */
export type Across = [V3, V3];

/**
 * One end of one rib, as built (all coordinates in mm, world, z up, the floor
 * at z = 0). An end is the rib carried on past its end key: a lip along the
 * key's axis, then a round turning down until it is vertical (its outer face
 * facing `out`). From there a "drop" carries on straight down to the floor
 * (its foot curving out onto the rail); a "hang" stops there, in mid-air; a
 * "flush" end has no lip or round (the run parted and there was no room): the
 * rib stops at the plate's edge.
 */
export interface RibEnd {
  /** The rib, named as WallSide.name: a finger column's name ("inner", "index", "middle", "ring", "pinky"), "thumb" or "thumb extra", with " #2" etc. if the run parted into several ribs. */
  rib: string;
  /** Whether the rib is a finger column (`column` its index: 0 the inner side, frame.columns - 1 the pinky side) or a thumb row. */
  group: 'finger' | 'thumb';
  column?: number;
  /** The end key's name (e.g. "matrix_index_bottom", "thumb_near"). */
  key: string;
  /** Which end of the rib: "first" or "last". A finger column runs front to back, so its first end is its front, facing the thumbs. A thumb row runs along the row by x. */
  at: 'first' | 'last';
  /** Whether the run parted here (the next key's plate overlaps this one in plan, or a web would fold back): the run's next rib starts close by, often overlapping. */
  parted: boolean;
  /** How the end finishes (see above). The ends to support are those that "hang". */
  finish: 'hang' | 'drop' | 'flush';
  /** Plan unit vectors (z 0): `out` the way the end faces (along the end key's axis, away from the key); `across` from side 0 to side 1, square to the key's axis. */
  out: V3;
  across: V3;
  /**
   * The end's last free cross-section, four points at one height:
   * - hang: the bottom of the round, where the end stops above the floor. It
   *   is a horizontal rectangle, the full width of the rib (`across`) and a
   *   wall's thickness deep (`out`): its outer face's corners (`outer`) and,
   *   a wall's thickness back toward the key, its inner face's (`inner`).
   *   This is the rib's underside here: a support reaches up INTO into it.
   *   It clears the end key's tile pocket and switch body by 0.3 mm, so a
   *   support may come straight down from it (it is where a drop would go).
   * - drop: the same section, at the top of the drop (the drop goes on down
   *   from it, its outer face below `outer`, to the rail).
   * - flush: the plate's edge: `outer` its top corners, `inner` its underside
   *   corners (the end's face spans them).
   */
  bottom: { outer: Across; inner: Across };
  /** The middle of bottom's four points; `height` is its z, above the floor. */
  centre: V3;
  height: number;
  /** Each side's path (side 0, side 1) as built, as pairs: from the plate's corner [top, underside], over the lip and down the round [outer face, inner face], ending at `bottom` (for a drop, on down to its foot on the rail; for a flush end, only the plate's corner). The end's faces span between the two sides. */
  sides: [[V3, V3][], [V3, V3][]];
}

/** The rail at one place along it: its inner edge, centreline and outer edge (the outline), on the floor, and outward there (plan unit). Its top is frame.rail.height up. */
export interface RailSpot {
  inner: V3;
  centre: V3;
  outer: V3;
  out: V3;
}

/**
 * The whole frame, as an end-support variant sees it: the contract between
 * skeletyl.ts and the variants.
 */
export interface EndsFrame {
  /** Every rib's two ends, finger columns first (inner to pinky, front to back) then the thumb rows. */
  ends: RibEnd[];
  /** The ends that hang (finish "hang"), in the same order: what needs support. */
  hanging: RibEnd[];
  /** Each finger column's front (its first rib's first end), inner to pinky: `fronts[c]` is column c's. A front hangs or drops, never flush. */
  fronts: RibEnd[];
  /** How many finger columns there are. */
  columns: number;
  /** Plan unit vectors: `toPinky` across the hand, from the inner column toward the pinky's (the inner side is -toPinky); `toFront` along the columns, toward their fronts (the thumbs), square to toPinky. */
  toPinky: V3;
  toFront: V3;
  /** The wall thickness the frame is built to (its ends and rail), mm. */
  wall: number;
  /** The rail round the outline: `height` (mm) tall, on the floor, between `inner` (its inner edge) and `outer` (its outer edge, the outline), each a plan polygon, counter-clockwise. */
  rail: { height: number; inner: [number, number][]; outer: [number, number][] };
  /** The rail nearest p (in plan). */
  railNear: (p: V3) => RailSpot;
  /** The rail straight out from p along plan direction `dir` (the first crossing ahead if p is inside the outline). */
  railAlong: (p: V3, dir: V3) => RailSpot;
  /** Whether points stay clear (by 0.3 mm) of every key's tile and its components, switch body and keycap room (from the plate up), and of each switch hole's column 12 mm down (as the hardware, keycap and openings checks have them). Test the faces of what you build (points over them, a few mm apart), not only its edges. An end clears its own key, but on some layouts not the others' (on Swung in the ring front and x2's end sit in x2's keycap room and the pinky's tile, and the near thumb key's switch column reaches the middle front), so nothing clear can reach under those. */
  clear: (points: V3[]) => boolean;
  /** How far out in plan from `from` (at its height), along plan direction `out`, a point must be for it and every point further out to the outline to be clear (as `clear`; exact): 0 if all of them are, Infinity if the outline itself isn't. */
  room: (from: V3, out: V3) => number;
}

/** What a variant builds with. */
export interface EndsKit {
  wasm: ManifoldToplevel;
  cfg: Config;
  /**
   * The watertight solid through cross-sections, each joined to the next
   * point to point, the first and last capped: every section has the same
   * number of points, in the same order round it, and is roughly planar.
   * Either winding works. (The walls' sweep, skeletyl-walls.prototype.ts.)
   */
  sweep: (sections: V3[][]) => Manifold;
}

/** An end-support design: everything it adds to the frame, for the whole frame. Each solid should reach a little (INTO, 0.3 mm) into what it joins. */
export type EndsVariant = (kit: EndsKit, frame: EndsFrame) => Manifold[];

/** How far (mm) supports reach into what they join. */
export const INTO = 0.3;

/** The variants by key (exported so a probe can add its own). */
export const VARIANTS: Record<string, EndsVariant> = { beam, arch, legs, braces };

/** The supports of design `key` (none for "none"). */
export function skeletylEnds(
  wasm: ManifoldToplevel,
  cfg: Config,
  key: string,
  frame: () => EndsFrame,
): Manifold[] {
  if (key === 'none') return [];
  const variant = VARIANTS[key];
  if (!variant) throw Error(`Unknown ends "${key}": one of ${END_SUPPORTS.map((w) => w.key)}`);
  return variant({ wasm, cfg, sweep: (sections) => sweep(wasm, cfg, sections) }, frame());
}

type Ring = [number, number][];

/** The rail helpers for a frame whose rail is `wall` wide inside ring `outer` (the outline). */
export function railHelpers(outer: Ring, wall: number) {
  const spot = (edge: V3, out: V3): RailSpot => ({
    outer: edge,
    centre: add2(edge, out, -wall / 2),
    inner: add2(edge, out, -wall),
    out,
  });
  return {
    railNear(p: V3): RailSpot {
      let best = { d: Infinity, q: [0, 0] as number[], i: 0 };
      outer.forEach((a, i) => {
        const b = outer[(i + 1) % outer.length];
        const e = [b[0] - a[0], b[1] - a[1]];
        const l2 = e[0] * e[0] + e[1] * e[1] || 1;
        const f = Math.max(0, Math.min(1, ((p[0] - a[0]) * e[0] + (p[1] - a[1]) * e[1]) / l2));
        const q = [a[0] + e[0] * f, a[1] + e[1] * f];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < best.d) best = { d, q, i };
      });
      return spot([best.q[0], best.q[1], 0], normal(outer, best.i));
    },
    railAlong(p: V3, dir: V3): RailSpot {
      const h = unit2(dir);
      const t = toRing(outer, p, h);
      return spot(add2([p[0], p[1], 0], h, t), normal(outer, hitEdge(outer, p, h, t)));
    },
  };
}

const unit2 = (v: number[]): V3 => {
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l, 0];
};
const add2 = (p: V3, v: V3, k: number): V3 => [p[0] + v[0] * k, p[1] + v[1] * k, 0];
/** The outward normal of a counter-clockwise ring's edge i, averaged with its neighbours' (the ring is finely rounded). */
function normal(ring: Ring, i: number): V3 {
  const n = ring.length;
  const edge = (j: number) => {
    const [a, b] = [ring[(j + n) % n], ring[(j + n + 1) % n]];
    return unit2([b[1] - a[1], a[0] - b[0]]);
  };
  const s = [-1, 0, 1].map((k) => edge(i + k)).reduce((x, y) => [x[0] + y[0], x[1] + y[1], 0]);
  return unit2(s);
}
/** How far the ring is from p along plan direction h: the first crossing ahead if p is inside it, else the nearest (as skeletyl.ts's toRing). */
function toRing(ring: Ring, p: V3, h: V3) {
  const hits = crossings(ring, p, h).map((x) => x.t);
  const ahead = hits.filter((t) => t > 0);
  return ahead.length % 2
    ? Math.min(...ahead)
    : hits.reduce((x, y) => (Math.abs(y) < Math.abs(x) ? y : x), Infinity);
}
function crossings(ring: Ring, p: V3, h: V3) {
  return ring.flatMap((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const e = [b[0] - a[0], b[1] - a[1]];
    const w = [a[0] - p[0], a[1] - p[1]];
    const den = h[0] * e[1] - h[1] * e[0];
    const f = (h[1] * w[0] - h[0] * w[1]) / den;
    return Math.abs(den) > 1e-12 && f >= 0 && f < 1
      ? [{ t: (w[0] * e[1] - w[1] * e[0]) / den, i }]
      : [];
  });
}
const hitEdge = (ring: Ring, p: V3, h: V3, t: number) =>
  crossings(ring, p, h).reduce((x, y) => (Math.abs(y.t - t) < Math.abs(x.t - t) ? y : x)).i;
