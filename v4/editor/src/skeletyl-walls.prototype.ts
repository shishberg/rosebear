// PROTOTYPE. Question: Which wall design should the Skeletyl have? Variants
// switchable via ?walls= on the editor (chassis.walls; prototype-overrides.ts),
// cycled with the bar at the bottom of the dev editor (prototype-switcher.ts).
//
// The hook: skeletyl.ts describes each outer side of the frame (the first and
// last finger columns' and the thumb rows' sides away from the keys' middle)
// as a WallSide, plain data, and unions whatever the selected variant builds
// for it into the frame. A variant is one function in its own file under
// skeletyl-walls/, `(kit, side) => Manifold[]`, called once per side; it reads
// nothing else of skeletyl.ts. "none" (the default) builds no walls: the frame
// exactly as without this hook. A variant may also ask for the outline to take
// in more floor for its walls to stand on (REACHES): the frame is then built
// again with the outline taking it in, and the variant called on that.
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { Config, V3 } from './geometry';
import type { Pose, Span } from './skeletyl';
import { add, cross, dot, scale, sub } from './geometry';
import { mesh } from './shell/loft';
import { flare } from './skeletyl-walls/flare.prototype';
import { arches } from './skeletyl-walls/arches.prototype';
import { truss } from './skeletyl-walls/truss.prototype';
import { bones } from './skeletyl-walls/bones.prototype';
import { pillars, ribLimbsReach, wishbone } from './skeletyl-walls/rib-limbs.prototype';

/** The wall designs, in the switcher's order: the ?walls= key and a short name. */
export const WALL_DESIGNS = [
  { key: 'none', name: 'open frame' },
  { key: 'flare', name: 'bell skirt' },
  { key: 'arches', name: 'viaduct' },
  { key: 'truss', name: 'triangulated' },
  { key: 'bones', name: 'organic struts' },
  { key: 'wishbone', name: 'forked rib legs' },
  { key: 'pillars', name: 'rib pillars' },
] as const;

/**
 * One point along an outer side, in order along the rib (all coordinates in
 * mm, world, z up, the floor at z = 0).
 */
export interface WallPoint {
  /** The rib's outer side here: its top edge and its underside edge. Over plates and webs they are the plate's top and underside at its outer edge (`under` is plate_thickness_mm below `top` along the key's normal, so not straight under it on a tilted key). On an end they are its lip's and round's outer and inner faces, and down a drop its outer and inner faces (side by side, at the same height). */
  top: V3;
  under: V3;
  /** Outward in plan (unit, z 0): across the rib here, away from the keys' middle. */
  out: V3;
  /** What the point is on: a key's plate (`key` names it), a web between two plates, or an end (lip, round, drop). */
  over: 'key' | 'web' | 'end';
  key?: string;
  /** The rail straight out from `under` along `out`, on the floor (z 0): its inner edge, centreline and outer edge (the outline). Its top is side.railHeight up. Where the side is already on the rail (a drop's landing) these are close to `under` or behind it. */
  rail: { inner: V3; centre: V3; outer: V3 };
}

/**
 * One outer side of the frame: everything a wall variant needs to build a
 * wall from the rib's outer edge down to the rail round the outline, clear of
 * the keys. The contract between skeletyl.ts and the variants.
 */
export interface WallSide {
  /** Which rib: the column's name (e.g. "inner", "pinky") or "thumb", with " #2" etc. if the run parted into several ribs. */
  name: string;
  /** Along the side, from its first end to its last: first end's landing (or round's bottom, or the plate's corner if flush) up and over its round and lip, along the plates (each split into 5 between its corners) and webs, and over the last end down to its landing. */
  points: WallPoint[];
  /** The keys under the side, in order, each with the points over its plate: from (its first plate corner) to (its far corner), inclusive. Between one key's `to` and the next's `from` is a web; before the first `from` and after the last `to` are the ends. A post between keys stands on a web, an arch spans a key. */
  keys: { name: string; from: number; to: number }[];
  /** How each end (first, last) finishes: "drop" (the end drops to the floor: the rib carried on down onto the rail, straight down or bending out along the end, landing square on it), "hang" (a round, stopping above the floor, at its last point), or "flush" (the run parted there: the side stops at the plate's corner). A drop's points go down, near one above another, so a wall swept along the side can't follow them: it can stop at the bottom of the round, flush with the drop's outer face, as flare does. */
  ends: ['drop' | 'hang' | 'flush', 'drop' | 'hang' | 'flush'];
  /** PROTOTYPE ?ends=flow: an end (first, last) that carries on into another rib as a web is "flush" in `ends`, and `points` stop at its plate's corner; this is that web's side, as points are, from the corner (`points`' first or last, again) on to the plate edge it lands on. Empty for the other ends. */
  carried: [WallPoint[], WallPoint[]];
  /** The wall thickness the frame is built to (its ends and rail), mm. */
  wall: number;
  /** The rail's height, mm (it is `wall` wide, inside the outline). */
  railHeight: number;
  /** The outline (plan, counter-clockwise): the rail's outer edge. It runs round the outer sides' plates and tile pockets with no room set aside for a wall: a wall stands on the rail, or over it, under the plate's edge. */
  outline: [number, number][];
  /** Whether points stay clear (by 0.3 mm) of every key's tile and its components, switch body and keycap room (from the plate up), as the hardware and keycap checks have them, and of each switch hole's column 12 mm down (the openings check). Test a wall's faces with it (points over them, a few mm apart), not only its edges. */
  clear: (points: V3[]) => boolean;
  /** How far out in plan from `from` (at its height), along plan direction `out`, a point must be for it and every point further out to the outline to be clear (as `clear`; exact, from the boxes): 0 if all of them are, Infinity if the outline itself isn't. */
  room: (from: V3, out: V3) => number;
}

/** What a variant builds with. */
export interface WallKit {
  wasm: ManifoldToplevel;
  cfg: Config;
  /**
   * The watertight solid through cross-sections, each joined to the next
   * point to point, the first and last capped: every section has the same
   * number of points, in the same order round it, and is roughly planar (it
   * is triangulated in its own plane for the caps). Either winding works.
   */
  sweep: (sections: V3[][]) => Manifold;
  /** The ribs' own construction (skeletyl.ts), for walls built as ribs are. */
  rib: RibKit;
  /** Every side the design is called on in this build, in order (so walls on one can keep clear of another's). */
  sides: WallSide[];
}

/**
 * The ribs' construction, as skeletyl.ts has it: a rib's solid along spans
 * (laneSolid), each a stretch of it swept between two poses (poseSpan; its
 * sides the poses' sides o·s) or straight between two stations (lineSpan; a
 * pose's stations are sidesOf it), and the ends' round's radius.
 */
export interface RibKit {
  solid: (spans: Span[]) => Manifold;
  poseSpan: (a: Pose, b: Pose, o: number) => Span;
  lineSpan: (p: [[V3, V3], [V3, V3]], q: [[V3, V3], [V3, V3]]) => Span;
  sidesOf: (q: Pose, o: number) => [[V3, V3], [V3, V3]];
  radius: number;
  /** The rail's top at plan point (x, y): railHeight, or lower where it dips to meet a low drop. */
  railTop: (x: number, y: number) => number;
  /** The faces standing on the outline that it is cut back to (the drops'), each [a, b, outward] as Reach's faces. */
  standing: V3[][];
  /** PROTOTYPE ?ends=tie, flow: where the floor tie meets the rail and is filleted into it (plan polygons, the tie and tieRound and the rail's width round it); none without a tie. */
  tie: [number, number][][];
}

/** A wall design: the walls for one side. Each solid should reach a little (0.2 mm or so) into the rib and the rail so the union joins them. */
export type WallVariant = (kit: WallKit, side: WallSide) => Manifold[];

/**
 * What a design asks of the outline: plan polygons (either winding) it must
 * take in as they are, the rail included, for its walls to stand on
 * (floors); and the faces its walls stand on the outline with, each [a, b,
 * outward] (a and b plan, outward a plan unit vector), that the outline is
 * cut back to as it is to the drops' faces, so that rounding its corners in
 * doesn't fill in past them. Asked on the outline without them; the design is
 * then called on the outline with them, so it must ask only for floor it will
 * then stand on.
 */
export interface Reach {
  floors: [number, number][][];
  faces: V3[][];
}
/** What a design asks of the outline for one side. */
export type WallReach = (kit: WallKit, side: WallSide) => Reach;

/** The variants by key (exported so a probe can add its own). */
export const VARIANTS: Record<string, WallVariant> = {
  flare,
  arches,
  truss,
  bones,
  wishbone,
  pillars,
};
/** The variants that ask the outline for more floor. */
export const REACHES: Record<string, WallReach> = {
  wishbone: (kit, side) => ribLimbsReach(kit, side, true),
  pillars: (kit, side) => ribLimbsReach(kit, side, false),
};

const wallKit = (wasm: ManifoldToplevel, cfg: Config, rib: RibKit, sides: WallSide[]): WallKit => ({
  wasm,
  cfg,
  sweep: (sections) => sweep(wasm, cfg, sections),
  rib,
  sides,
});

/** The walls of design `key` for every side (none for "none"). */
export function skeletylWalls(
  wasm: ManifoldToplevel,
  cfg: Config,
  key: string,
  sides: () => WallSide[],
  rib: RibKit,
): Manifold[] {
  if (key === 'none') return [];
  const variant = VARIANTS[key];
  if (!variant) throw Error(`Unknown walls "${key}": one of ${WALL_DESIGNS.map((w) => w.key)}`);
  const kit = wallKit(wasm, cfg, rib, sides());
  return kit.sides.flatMap((side) => variant(kit, side));
}

/** What design `key` asks of the outline for every side (REACHES), if anything. */
export function skeletylReach(
  wasm: ManifoldToplevel,
  cfg: Config,
  key: string,
  sides: () => WallSide[],
  rib: RibKit,
): Reach {
  const reach = REACHES[key];
  if (!reach) return { floors: [], faces: [] };
  const kit = wallKit(wasm, cfg, rib, sides());
  const each = kit.sides.map((side) => reach(kit, side));
  return { floors: each.flatMap((r) => r.floors), faces: each.flatMap((r) => r.faces) };
}

/** A section's normal by Newell's method: the polygon winds counter-clockwise round it. */
function newell(pts: V3[]): V3 {
  const n: V3 = [0, 0, 0];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  });
  return scale(n, 1 / Math.hypot(...n));
}
const centroid = (pts: V3[]) => scale(pts.reduce(add), 1 / pts.length);

/** The sweep the walls' kit hands its variants (WallKit.sweep). */
function sweep(wasm: ManifoldToplevel, cfg: Config, sections: V3[][]) {
  // Wind every section counter-clockwise seen from ahead, as mesh() wants.
  const ahead = sub(centroid(sections[1]), centroid(sections[0]));
  const secs =
    dot(newell(sections[0]), ahead) < 0 ? sections.map((s) => [...s].reverse()) : sections;
  return mesh(
    { wasm, cfg, frames: {} },
    secs.map((sec) => {
      // The section in its own plane, for the caps.
      const n = newell(sec);
      const u = cross(Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], n);
      const uu = scale(u, 1 / Math.hypot(...u));
      const v = cross(n, uu);
      const c = centroid(sec);
      return {
        pts: sec.map((p) => [dot(sub(p, c), uu), dot(sub(p, c), v)] as [number, number]),
        place: (_w: number, _z: number, j: number) => sec[j],
      };
    }),
  );
}
