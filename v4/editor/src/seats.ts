import type { Config } from './geometry';

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
