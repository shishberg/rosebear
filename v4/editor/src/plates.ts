// The key plates' extents, shared by the chassis (which builds them) and the
// wiring (which keeps wires out of them).
import type { Matrix4 } from 'three';
import type { Config } from './geometry';
import { seatSettings } from './seats';

/** Sizes in mm, in key coordinates. */
export const PLATES = {
  /** A plate edge with no neighbour reaches this far out, to the wall round its well. */
  wellReach: 12,
  /** Keys are neighbours across an edge when their centres are at most this far past twice the plate half-width apart. */
  neighbourGap: 8,
  /** The reaches and the joins between plates are this thick: a skin, holding no switch. */
  reachThickness: 2,
};

/** Half-widths along a key's x and y axes. */
export type HalfWidths = [number, number];

/** The plates' half-widths: plate_margin past the seat, and always far enough to cover the tile and its clearance. */
export function plateHalfWidths(cfg: Config): HalfWidths {
  const seat = seatSettings(cfg).outer;
  const tile = cfg.tile;
  return [0, 1].map((i) =>
    Math.max(seat[i] / 2 + cfg.chassis.plate_margin_mm, tile.size_mm[i] / 2 + tile.clearance_mm),
  ) as HalfWidths;
}

/**
 * The plates of keys ns, one sheet: which keys are neighbours across which
 * edge (pairs: [n, m, axis, sign] for n's edge facing m), and how far each
 * key's edges reach past its plate ([axis][side], side 0 for -, 1 for +):
 * wellReach where there is no neighbour, 0 where there is.
 */
export function plateEdges(cfg: Config, frames: Record<string, Matrix4>, ns: string[]) {
  const plateHalf = plateHalfWidths(cfg);
  const centre = (n: string) => [frames[n].elements[12], frames[n].elements[13]];
  /** Unit plan direction of key n's axis (0: x, 1: y). */
  const axisDir = (n: string, axis: number) => {
    const e = frames[n].elements;
    const l = Math.hypot(e[axis * 4], e[axis * 4 + 1]);
    return [e[axis * 4] / l, e[axis * 4 + 1] / l];
  };
  /** Which of key n's edges faces key m: [axis, sign], if m is beside it across that edge. */
  const across = (n: string, m: string): [number, number] | undefined => {
    const [cn, cm] = [centre(n), centre(m)];
    const d = [cm[0] - cn[0], cm[1] - cn[1]];
    for (const axis of [0, 1]) {
      const u = axisDir(n, axis);
      const v = axisDir(n, 1 - axis);
      const out = d[0] * u[0] + d[1] * u[1];
      const side = d[0] * v[0] + d[1] * v[1];
      if (
        Math.abs(out) > plateHalf[axis] &&
        Math.abs(out) < 2 * plateHalf[axis] + PLATES.neighbourGap &&
        Math.abs(side) < plateHalf[1 - axis]
      )
        return [axis, Math.sign(out)];
    }
    return undefined;
  };
  const reach: Record<string, number[][]> = {};
  const pairs: [string, string, number, number][] = [];
  for (const n of ns) {
    reach[n] = [
      [PLATES.wellReach, PLATES.wellReach],
      [PLATES.wellReach, PLATES.wellReach],
    ];
    for (const m of ns)
      if (m !== n) {
        const a = across(n, m);
        if (a) {
          reach[n][a[0]][a[1] > 0 ? 1 : 0] = 0;
          pairs.push([n, m, a[0], a[1]]);
        }
      }
  }
  return { reach, pairs, across };
}
