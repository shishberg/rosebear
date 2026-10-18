// What wires keep out of, and the test for a wire's segment against it.
import type { Matrix4 } from 'three';
import { isThumb, point, tilePartCentre, type V3 } from '../geometry';
import { PLATES, plateEdges, plateHalfWidths } from '../plates';
import { WIRING, distance, type Env } from './common';

/** A box in a key's frame that wires must keep out of. */
interface Obstacle {
  inverse: Matrix4;
  lo: V3;
  hi: V3;
  /** World bounding box. */
  wlo: number[];
  whi: number[];
  /** The last search that tested it. */
  seen?: number;
}

export interface Obstacles {
  /** Each tile from its underside up, and its parts with their clearance. */
  tiles: Obstacle[];
  /**
   * Where a wire climbs between keys at different heights: the plates with the
   * reach of an edge that has no neighbour.
   */
  plates: Obstacle[];
  /** Whether a wire of radius r along a to b comes within r of an obstacle (the tiles, by default). */
  blocked: (a: V3, b: V3, r: number, among?: Obstacle[]) => boolean;
}

export function obstaclesOf(env: Env, keys: string[]): Obstacles {
  const { cfg, frames, padZ } = env;
  const tile = cfg.tile;
  const tiles: Obstacle[] = [];
  const plates: Obstacle[] = [];
  const plateHalf = plateHalfWidths(cfg);
  const [hx, hy] = env.half;
  const c = tile.component_clearance_mm;
  const reach: Record<string, number[][]> = Object.assign(
    {},
    plateEdges(cfg, frames, keys.filter(isThumb)).reach,
    plateEdges(
      cfg,
      frames,
      keys.filter((k) => !isThumb(k)),
    ).reach,
  );
  for (const key of keys) {
    const m = frames[key];
    const inverse = m.clone().invert();
    const box = (lo: V3, hi: V3, list = tiles) => {
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
        point(m, [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]),
      );
      list.push({
        inverse,
        lo,
        hi,
        wlo: [0, 1, 2].map((k) => Math.min(...corners.map((p) => p[k]))),
        whi: [0, 1, 2].map((k) => Math.max(...corners.map((p) => p[k]))),
      });
    };
    box([-hx, -hy, padZ], [hx, hy, 0]);
    // Each plate with its edges' reach, as the chassis builds it, and each
    // reach run on along its edge into the gap beside a neighbour, where the
    // join between their reaches fills it.
    const r = reach[key];
    const pt = -cfg.chassis.plate_thickness_mm;
    const lo = (axis: number): number => -plateHalf[axis] - r[axis][0];
    const hi = (axis: number): number => plateHalf[axis] + r[axis][1];
    box([-plateHalf[0], -plateHalf[1], pt], [plateHalf[0], plateHalf[1], 0], plates);
    box([lo(0), lo(1), -PLATES.reachThickness], [hi(0), hi(1), 0], plates);
    for (const axis of [0, 1])
      for (const side of [0, 1]) {
        if (!r[axis][side]) continue;
        const along = 1 - axis;
        const a: V3 = [0, 0, -PLATES.reachThickness];
        const b: V3 = [0, 0, 0];
        a[axis] = side ? plateHalf[axis] : lo(axis);
        b[axis] = side ? hi(axis) : -plateHalf[axis];
        a[along] = lo(along) - (r[along][0] ? 0 : PLATES.neighbourGap / 2);
        b[along] = hi(along) + (r[along][1] ? 0 : PLATES.neighbourGap / 2);
        box(a, b, plates);
      }
    for (const p of tile.components) {
      const at = tilePartCentre(cfg, p);
      box(
        at.map((x, k) => x - p.size_mm[k] / 2 - c) as V3,
        at.map((x, k) => x + p.size_mm[k] / 2 + c) as V3,
      );
    }
  }

  // The obstacles in a grid of square cells in plan, each in every cell its
  // box overlaps, so a segment is only tested against those near it.
  const CELL = WIRING.gridCell;
  type Grid = { x0: number; y0: number; nx: number; ny: number; cells: Obstacle[][] };
  const grids = new Map<Obstacle[], Grid>();
  let stamp = 0;
  const gridOf = (list: Obstacle[]) => {
    let g = grids.get(list);
    if (g) return g;
    const x0 = Math.min(...list.map((o) => o.wlo[0]));
    const y0 = Math.min(...list.map((o) => o.wlo[1]));
    const nx = Math.floor((Math.max(...list.map((o) => o.whi[0])) - x0) / CELL) + 1;
    const ny = Math.floor((Math.max(...list.map((o) => o.whi[1])) - y0) / CELL) + 1;
    const cells: Obstacle[][] = Array.from({ length: nx * ny }, () => []);
    for (const o of list)
      for (let i = Math.floor((o.wlo[0] - x0) / CELL); i <= Math.floor((o.whi[0] - x0) / CELL); i++)
        for (
          let j = Math.floor((o.wlo[1] - y0) / CELL);
          j <= Math.floor((o.whi[1] - y0) / CELL);
          j++
        )
          cells[i * ny + j].push(o);
    grids.set(list, (g = { x0, y0, nx, ny, cells }));
    return g;
  };
  // Called millions of times while routing: no arrays or closures in it.
  const la = [0, 0, 0];
  const lb = [0, 0, 0];
  const hit = (
    o: Obstacle,
    a: V3,
    b: V3,
    lo0: number,
    lo1: number,
    lo2: number,
    hi0: number,
    hi1: number,
    hi2: number,
    steps: number,
    limit: number,
    reach: number,
  ) => {
    const { wlo, whi } = o;
    if (
      lo0 > whi[0] ||
      hi0 < wlo[0] ||
      lo1 > whi[1] ||
      hi1 < wlo[1] ||
      lo2 > whi[2] ||
      hi2 < wlo[2]
    )
      return false;
    const e = o.inverse.elements;
    for (let k = 0; k < 3; k++) {
      la[k] = e[k] * a[0] + e[4 + k] * a[1] + e[8 + k] * a[2] + e[12 + k];
      lb[k] = e[k] * b[0] + e[4 + k] * b[1] + e[8 + k] * b[2] + e[12 + k];
    }
    const { lo, hi } = o;
    // No sample can come nearer than the gap on any one axis.
    if (
      Math.min(la[0], lb[0]) - hi[0] >= reach ||
      lo[0] - Math.max(la[0], lb[0]) >= reach ||
      Math.min(la[1], lb[1]) - hi[1] >= reach ||
      lo[1] - Math.max(la[1], lb[1]) >= reach ||
      Math.min(la[2], lb[2]) - hi[2] >= reach ||
      lo[2] - Math.max(la[2], lb[2]) >= reach
    )
      return false;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let d = 0;
      for (let k = 0; k < 3; k++) {
        const x = la[k] + (lb[k] - la[k]) * t;
        const g = Math.max(lo[k] - x, 0, x - hi[k]);
        d += g * g;
      }
      if (d < limit) return true;
    }
    return false;
  };
  const blocked = (a: V3, b: V3, r: number, among = tiles) => {
    const lo0 = Math.min(a[0], b[0]) - r;
    const lo1 = Math.min(a[1], b[1]) - r;
    const lo2 = Math.min(a[2], b[2]) - r;
    const hi0 = Math.max(a[0], b[0]) + r;
    const hi1 = Math.max(a[1], b[1]) + r;
    const hi2 = Math.max(a[2], b[2]) + r;
    const steps = Math.max(1, Math.ceil(distance(a, b) / WIRING.sample));
    const limit = (r - WIRING.touch) ** 2;
    const reach = Math.sqrt(limit);
    const g = gridOf(among);
    const i0 = Math.max(0, Math.floor((lo0 - g.x0) / CELL));
    const i1 = Math.min(g.nx - 1, Math.floor((hi0 - g.x0) / CELL));
    const j0 = Math.max(0, Math.floor((lo1 - g.y0) / CELL));
    const j1 = Math.min(g.ny - 1, Math.floor((hi1 - g.y0) / CELL));
    stamp++;
    for (let ci = i0; ci <= i1; ci++)
      for (let cj = j0; cj <= j1; cj++)
        for (const o of g.cells[ci * g.ny + cj]) {
          if (o.seen === stamp) continue;
          o.seen = stamp;
          if (hit(o, a, b, lo0, lo1, lo2, hi0, hi1, hi2, steps, limit, reach)) return true;
        }
    return false;
  };
  return { tiles, plates, blocked };
}
