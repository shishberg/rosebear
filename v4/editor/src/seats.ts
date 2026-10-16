import type { Manifold } from 'manifold-3d';
import type { Matrix4 } from 'three';
import type { Config } from './geometry';
import { box, place, type Factory } from './manifold-util';

export function seatSettings(cfg: Config) {
  const s = cfg.switch,
    outer = s.seat_outer_mm,
    thickness = s.clip_land_thickness_mm;
  if (
    outer.length !== 2 ||
    outer.some(
      (x, i) => !Number.isFinite(x) || x < s.cutout_mm[i] + s.cutout_clearance_mm + 1 || x > 25,
    ) ||
    !Number.isFinite(thickness) ||
    thickness < 0.8 ||
    thickness > 3
  )
    throw Error('Invalid switch seat dimensions');
  if (
    s.clip_width_mm <= 0 ||
    s.clip_width_mm >= Math.min(...s.cutout_mm) ||
    s.clip_relief_depth_mm <= 0 ||
    s.clip_relief_depth_mm > 3
  )
    throw Error('Invalid switch clip relief dimensions');
  return { outer, thickness };
}

/** Sizes of the seat's fill, trims and clip reliefs, in mm. */
const SEAT = {
  /** Each seat is trimmed flat this far above and below its plane. */
  trim: 7,
  /** Clip reliefs: this tall below the seat, reaching this far into the switch hole and this far past clip_relief_depth_mm. */
  reliefHeight: 3,
  reliefIntoHole: 0.15,
  reliefPastDepth: 0.05,
  /** Each opening is clear from this far below the switch body to this height above the plate. */
  openingBelowBody: 0.5,
  openingTop: 12,
} as const;

/** The switch hole: the cutout with its clearance. */
export const switchHole = (cfg: Config) =>
  cfg.switch.cutout_mm.map((x) => x + cfg.switch.cutout_clearance_mm);

/** z of an opening's lowest and highest point, in key coordinates. */
export const openingSpan = (cfg: Config) => ({
  bottom: -cfg.switch.body_below_plate_mm - SEAT.openingBelowBody,
  top: SEAT.openingTop,
});

/** The seat's slab under the plate plane, in key coordinates; `xy` and `z` grow (or shrink) its size. */
export const seatBox = (M: Factory, cfg: Config, m: Matrix4, { xy = 0, z = 0 } = {}) => {
  const { outer, thickness } = seatSettings(cfg);
  return place(box(M, [outer[0] + xy, outer[1] + xy, thickness + z], [0, 0, -thickness / 2]), m);
};

/** A clip relief on one side (`sign`) of the hole; `inset` pulls its ends and its top in. */
export const clipBox = (M: Factory, cfg: Config, m: Matrix4, sign: number, inset = 0) => {
  const sw = cfg.switch;
  const { thickness } = seatSettings(cfg);
  const depth = sw.clip_relief_depth_mm + SEAT.reliefIntoHole + SEAT.reliefPastDepth;
  const y = switchHole(cfg)[1] / 2 - SEAT.reliefIntoHole + depth / 2;
  return place(
    box(
      M,
      [sw.clip_width_mm, depth - 2 * inset, SEAT.reliefHeight - inset],
      [0, sign * y, -thickness - SEAT.reliefHeight / 2 - inset / 2],
    ),
    m,
  );
};

/** A switch opening's cutter, in key coordinates. */
export const openingCutter = (M: Factory, cfg: Config, m: Matrix4) => {
  const { bottom, top } = openingSpan(cfg);
  return place(box(M, [...switchHole(cfg), top - bottom], [0, 0, (top + bottom) / 2]), m);
};

/**
 * Flat seats on the body: each mounting footprint is filled so the switch lip
 * is continuously supported, then the plate above and below it is trimmed.
 * Fill before trimming: trimming first puts the trimmed faces exactly on the
 * fill's faces, where Manifold's union drops material elsewhere. Returns the
 * seated body, the clip reliefs and the openings (one per key) to cut from it.
 */
export function seatSwitches(M: Factory, cfg: Config, body: Manifold, keys: Matrix4[]) {
  const { outer, thickness } = seatSettings(cfg);
  const fills: Manifold[] = [];
  const trims: Manifold[] = [];
  const reliefs: Manifold[] = [];
  for (const m of keys) {
    fills.push(seatBox(M, cfg, m));
    trims.push(
      place(box(M, [...outer, SEAT.trim], [0, 0, SEAT.trim / 2]), m),
      place(box(M, [...outer, SEAT.trim - thickness], [0, 0, (-SEAT.trim - thickness) / 2]), m),
    );
    for (const sign of [-1, 1]) reliefs.push(clipBox(M, cfg, m, sign));
  }
  return {
    body: body.add(M.union(fills)).subtract(M.union(trims)),
    reliefs,
    openings: keys.map((m) => openingCutter(M, cfg, m)),
  };
}
