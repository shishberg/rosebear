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
// exactly as without this hook.
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { Config, V3 } from './geometry';
import { add, cross, dot, scale, sub } from './geometry';
import { mesh } from './shell/loft';
import { flare } from './skeletyl-walls/flare.prototype';
import { arches } from './skeletyl-walls/arches.prototype';
import { truss } from './skeletyl-walls/truss.prototype';
import { bones } from './skeletyl-walls/bones.prototype';

/** The wall designs, in the switcher's order: the ?walls= key and a short name. */
export const WALL_DESIGNS = [
  { key: 'none', name: 'open frame' },
  { key: 'flare', name: 'bell skirt' },
  { key: 'arches', name: 'viaduct' },
  { key: 'truss', name: 'triangulated' },
  { key: 'bones', name: 'organic struts' },
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
  /** What the point is on: a key's plate (`key` names it), a web between two plates, or an end (lip, round, drop, foot). */
  over: 'key' | 'web' | 'end';
  key?: string;
  /** The rail straight out from `under` along `out`, on the floor (z 0): its inner edge, centreline and outer edge (the outline). Its top is side.railHeight up. Where the side is already on or past the rail (a drop's foot) these are close to `under` or behind it. */
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
  /** Along the side, from its first end to its last: first end's foot (or round's bottom, or the plate's corner if flush) up and over its round and lip, along the plates (each split into 5 between its corners) and webs, and over the last end down to its foot. */
  points: WallPoint[];
  /** The keys under the side, in order, each with the points over its plate: from (its first plate corner) to (its far corner), inclusive. Between one key's `to` and the next's `from` is a web; before the first `from` and after the last `to` are the ends. A post between keys stands on a web, an arch spans a key. */
  keys: { name: string; from: number; to: number }[];
  /** How each end (first, last) finishes: "drop" (the end drops to the floor, its foot carried out onto the rail), "hang" (a round, stopping above the floor, at its last point), or "flush" (the run parted there: the side stops at the plate's corner). A drop's points go straight down, one above another, so a wall swept along the side can't follow them: it can stop at the bottom of the round, flush with the drop's outer face, as flare does. */
  ends: ['drop' | 'hang' | 'flush', 'drop' | 'hang' | 'flush'];
  /** The wall thickness the frame is built to (its ends and rail), mm. */
  wall: number;
  /** The rail's height, mm (it is `wall` wide, inside the outline). */
  railHeight: number;
  /** The outline (plan, counter-clockwise): the rail's outer edge. It is meant to stand 5 mm out from the outer sides' plates and tile pockets, but on some layouts (Swung in's inner column) it is barely out from them, leaving a wall no room. */
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
}

/** A wall design: the walls for one side. Each solid should reach a little (0.2 mm or so) into the rib and the rail so the union joins them. */
export type WallVariant = (kit: WallKit, side: WallSide) => Manifold[];

/** The variants by key (exported so a probe can add its own). */
export const VARIANTS: Record<string, WallVariant> = { flare, arches, truss, bones };

/** The walls of design `key` for every side (none for "none"). */
export function skeletylWalls(
  wasm: ManifoldToplevel,
  cfg: Config,
  key: string,
  sides: () => WallSide[],
): Manifold[] {
  if (key === 'none') return [];
  const variant = VARIANTS[key];
  if (!variant) throw Error(`Unknown walls "${key}": one of ${WALL_DESIGNS.map((w) => w.key)}`);
  const kit: WallKit = { wasm, cfg, sweep: (sections) => sweep(wasm, cfg, sections) };
  return sides().flatMap((side) => variant(kit, side));
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

/** The sweep the walls' and the ends' kits hand their variants (WallKit.sweep). */
export function sweep(wasm: ManifoldToplevel, cfg: Config, sections: V3[][]) {
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
