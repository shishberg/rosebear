// Hand wiring, adapter and ribbons: plain geometry from the key frames, with no
// geometry engine, so the editor can redraw it while a handle is dragged.
//
// Terms:
//  pad      a solder pad on a tile's underside (tile.pads);
//  hole     one of the adapter's 24 through holes; hole n carries ribbon pin n;
//  depth    how far below its tile's underside a wire leaves a pad; it runs
//           straight from that point on one tile to that on the next;
//  chain    keys joined one to the next by a net's wires (wiring.nets[].chains);
//  feed     the wire from a chain's end to its adapter hole;
//  loom     the height above the bottom plate at which feeds run to the adapter;
//  wire port  where thumb wires pass from under the thumb well to under the
//           finger well: a straight round way in front of the gap between the
//           inner and index columns' bottom keys, inside the case's hollow;
//  slack loop  the arch the ribbon makes between the connector and the landing,
//           so a pull held by the ties never reaches the connector.
import { Matrix4, Vector3 } from 'three';
import { componentFrames, point, type Config, type V3 } from './geometry';
import { PLATES, plateEdges, plateHalfWidths } from './plates';
import type { Part } from './solid';

export interface NetSpec {
  name: string;
  pin: number;
  group: string;
  /** The pad a wire arrives at on each key, and the pad the next wire leaves from. */
  pads: string[];
  /** Keys in wiring order; each chain has its own feed. Default: [led_order]. */
  chains?: string[][];
  /** The feed goes to the first key of each chain (LED data flows DI to DO). */
  directed?: boolean;
}
export interface Pad {
  key: string;
  name: string;
  /** The pad's world point, its point in its key's frame (x, y), and its key's downward normal. */
  at: V3;
  xy: [number, number];
  down: V3;
}
export interface Wire {
  net: string;
  group: string;
  from: string;
  to: string;
  points: V3[];
  diameter: number;
  /** Cut length: along the path, plus end allowances and, on a feed, the service loop. */
  length: number;
  feed: boolean;
}
export interface NetSummary {
  name: string;
  pin: number;
  group: string;
  wires: number;
  joints: number;
  length: number;
}
export interface Wiring {
  pads: Pad[];
  wires: Wire[];
  nets: NetSummary[];
  /** Each key's row and column net, and their pins. */
  matrix: { key: string; row: string; column: string }[];
}

/** Extra sizes for the wiring, in mm, that are not in the config. */
export const WIRING = {
  /** The wire port's inside end is this far inside the plate corners. */
  slotInside: 3,
  /** The wire port runs halfway down from this far under the lower of its two plate corners to the base. */
  portBelow: 9,
  /**
   * A thumb's wires through the port gather this far out from its edge facing
   * the port, and this far below the tile, each offset as its place in the port.
   */
  gatherOut: 2,
  gatherDepth: 4,
  /** On the finger side, wires turn this much further on from the port per row of places. */
  beyondStep: 1,
  /**
   * Depths below a tile's underside a wire runs at: from hopDepth for a hop
   * over the pad's own edge, from stripDepth along the pads' strip (under the
   * other pads' drops), or from just under the tile's parts
   * across the tile; then depthChoices steps of depthStep deeper.
   */
  hopDepth: 0.6,
  /** Between keys at different heights, how far in under the higher tile a wire may step back to find its way down. */
  climbBack: 12,
  /** Failing that, how far below the lower of the two legs' ends a wire may run across under both. */
  climbUnder: 6,
  stripDepth: 2.7,
  stripStep: 0.9,
  depthStep: 0.7,
  depthChoices: 4,
  /** Feeds run to the adapter at their own levels in the loom, this far apart. */
  loomStep: 1,
  loomLevels: [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, 6, 7, 8],
  /** Sideways shifts of a feed's run to the adapter, in plan, to get past other wires. */
  asides: [0, 1, -1, 2, -2],
  /** Shifts along the tile edge a wire crosses to the next tile. */
  edgeAsides: [0, 0.9, -0.9, 1.6, -1.6, 0.45, -0.45],
  /**
   * Negotiating the routes: rounds at most (and without fewer wires meeting),
   * the cost of meeting another wire
   * (against 1 per step away from the nearest option), its growth each round,
   * the cost added to an option for each round it met another wire, how many
   * of its cheapest options a meeting wire clears the way for and at what
   * cost to the wires in the way, and the options a wire keeps.
   */
  rounds: 150,
  stall: 60,
  penalty: 4,
  penaltyGrowth: 1.3,
  historyCost: 1,
  blockerOptions: 24,
  blockerCost: 0.5,
  optionLimit: 3000,
  /**
   * Then repairing in small groups: passes at most, how many of the wires most
   * in a pair's way join it, and the search steps each group may take. If any
   * still meet when routing with every choice, negotiating starts again this
   * many times.
   */
  repairPasses: 6,
  repairBlockers: 4,
  repairWork: 5000000,
  restarts: 3,
  /** The cost of ending a wire on the tile's other pad of the same name. */
  otherPad: 2,
  /** Wires may touch: they count as passing into each other only past this much (mm). */
  touch: 0.02,
  /** Centre spacing of two wires on one pad (along it) or one adapter hole (across the row). */
  padShare: 0.9,
  holeShare: 1,
  /**
   * Centre spacing of the wires through the wire port, and how many places
   * nearest its own a wire tries.
   */
  portPitch: 1.02,
  placeChoices: 13,
  /** Feeds and wires through the port try only this many of the depths. */
  longDepths: 2,
  /** Wires are checked against the tiles and their parts every this many mm along. */
  sample: 0.3,
  /** Ribbon segments per half turn of the slack loop. */
  loopSteps: 8,
} as const;

const length = (ps: V3[]) =>
  ps.reduce((t, p, i) => (i ? t + Math.hypot(...p.map((x, j) => x - ps[i - 1][j])) : t), 0);
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mid = (a: number[], b: number[]): V3 => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  (a[2] + b[2]) / 2,
];

export const nets = (cfg: Config) => cfg.wiring.nets as NetSpec[];
export const isThumb = (key: string) => key.startsWith('thumb_');

/** The adapter's holes, in world coordinates on the board's top: hole n carries ribbon pin n. */
export function holes(cfg: Config, frames = componentFrames(cfg)) {
  const a = cfg.adapter;
  const [bx, , bz] = a.board_mm;
  const out: Record<number, V3> = {};
  for (let pin = 1; pin <= 24; pin++) {
    // Pins pair across the two rows, even pins on the row nearest the edge.
    const j = Math.floor((pin - 1) / 2);
    const x = bx / 2 - a.hole_rows_from_edge_mm[pin % 2 ? 1 : 0];
    out[pin] = point(frames.adapter, [x, (j - 5.5) * a.hole_pitch_mm, bz]);
  }
  return out;
}

/**
 * The plate edge of a key's frame that faces a plan direction: the key axis
 * (0 for x, 1 for y) and its sign.
 */
const facing = (m: Matrix4, dir: number[]) => {
  const e = m.elements;
  const options: [0 | 1, number][] = [
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
  ];
  const score = ([axis, sign]: [0 | 1, number]) =>
    sign * (e[axis * 4] * dir[0] + e[axis * 4 + 1] * dir[1]);
  return options.reduce((a, b) => (score(b) > score(a) ? b : a));
};

/**
 * The wire port from under the thumb row to under the finger columns: a
 * straight round way out in front of the gap between the inner and index
 * columns' bottom keys, below them. `outside` is its end under the thumb tiles, `inside`
 * its end inside the finger columns, `centre` where it crosses the line
 * between the two keys' plate corners.
 */
export function wirePort(cfg: Config, frames = componentFrames(cfg)) {
  const plateHalf = plateHalfWidths(cfg);
  const [a, b] = ['inner', 'index'].map((c) => `matrix_${c}_bottom`);
  const corner = (n: string, other: string) => {
    const m = frames[n];
    const [axis, sign] = facing(m, [0, -1]);
    const toward = point(frames[other], [0, 0, 0]);
    const options = [-1, 1].map((s) => {
      const v = [0, 0, 0];
      v[axis] = sign * plateHalf[axis];
      v[1 - axis] = s * plateHalf[1 - axis];
      return point(m, v);
    });
    return options.sort((p, q) => distance(p, toward) - distance(q, toward))[0];
  };
  const [pa, pb] = [corner(a, b), corner(b, a)];
  const centre = mid(pa, pb);
  const halfWidth = Math.max(1.5, Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) / 2);
  const foot = 1;
  const z = foot + (Math.min(pa[2], pb[2]) - WIRING.portBelow - foot) / 2 + halfWidth;
  // Outward: the mean of the two keys' front edge directions, in plan.
  const out = [a, b]
    .map((n) => {
      const [axis, sign] = facing(frames[n], [0, -1]);
      const e = frames[n].elements;
      return [sign * e[axis * 4], sign * e[axis * 4 + 1]];
    })
    .reduce((s, d) => [s[0] + d[0], s[1] + d[1]], [0, 0]);
  const l = Math.hypot(out[0], out[1]);
  const at = (d: number): V3 => [centre[0] + (out[0] / l) * d, centre[1] + (out[1] / l) * d, z];
  return {
    centre: at(0),
    outside: at(cfg.wiring.port_length_mm),
    inside: at(-WIRING.slotInside),
    diameter: cfg.wiring.port_diameter_mm,
  };
}

/** The closest distance between segments pq and rs. */
export function segmentDistance(p: V3, q: V3, r: V3, s: V3) {
  return Math.sqrt(
    segmentDistance2(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2], s[0], s[1], s[2]),
  );
}
/** The squared closest distance between two segments, from their end coordinates. */
function segmentDistance2(
  px: number,
  py: number,
  pz: number,
  qx: number,
  qy: number,
  qz: number,
  rx: number,
  ry: number,
  rz: number,
  sx: number,
  sy: number,
  sz: number,
) {
  const d1x = qx - px,
    d1y = qy - py,
    d1z = qz - pz;
  const d2x = sx - rx,
    d2y = sy - ry,
    d2z = sz - rz;
  const wx = px - rx,
    wy = py - ry,
    wz = pz - rz;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * wx + d2y * wy + d2z * wz;
  const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
  let t1: number;
  let t2: number;
  if (a < 1e-12 && e < 1e-12) return wx * wx + wy * wy + wz * wz;
  if (a < 1e-12) {
    t1 = 0;
    t2 = clamp(f / e);
  } else {
    const c = d1x * wx + d1y * wy + d1z * wz;
    if (e < 1e-12) {
      t2 = 0;
      t1 = clamp(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      t1 = denom > 1e-12 ? clamp((b * f - c * e) / denom) : 0;
      t2 = (b * t1 + f) / e;
      if (t2 < 0) {
        t2 = 0;
        t1 = clamp(-c / a);
      } else if (t2 > 1) {
        t2 = 1;
        t1 = clamp((b - c) / a);
      }
    }
  }
  const x = wx + d1x * t1 - d2x * t2;
  const y = wy + d1y * t1 - d2y * t2;
  const z = wz + d1z * t1 - d2z * t2;
  return x * x + y * y + z * z;
}

/**
 * A wire's path with its bounding box, grown by its radius, and its segments
 * as flat end coordinates (six per segment) with their own boxes.
 */
interface Tube {
  points: V3[];
  radius: number;
  lo: number[];
  hi: number[];
  ends: Float64Array;
  boxes: Float64Array;
}
const tubeOf = (points: V3[], diameter: number): Tube => {
  const r = diameter / 2;
  const lo = [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k])) - r);
  const hi = [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k])) + r);
  const n = points.length - 1;
  const ends = new Float64Array(n * 6);
  const boxes = new Float64Array(n * 6);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      const a = points[i][k];
      const b = points[i + 1][k];
      ends[i * 6 + k] = a;
      ends[i * 6 + 3 + k] = b;
      boxes[i * 6 + k] = Math.min(a, b) - r;
      boxes[i * 6 + 3 + k] = Math.max(a, b) + r;
    }
  return { points, radius: r, lo, hi, ends, boxes };
};
/** Whether two wires pass into each other. Wires may touch. */
const touches = (a: Tube, b: Tube) => {
  const t = WIRING.touch;
  if ([0, 1, 2].some((k) => a.lo[k] > b.hi[k] - t || b.lo[k] > a.hi[k] - t)) return false;
  const limit = (a.radius + b.radius - t) ** 2;
  const A = a.ends;
  const B = b.ends;
  const ba = a.boxes;
  const bb = b.boxes;
  for (let i = 0; i < A.length; i += 6)
    for (let j = 0; j < B.length; j += 6) {
      if (
        ba[i] > bb[j + 3] - t ||
        bb[j] > ba[i + 3] - t ||
        ba[i + 1] > bb[j + 4] - t ||
        bb[j + 1] > ba[i + 4] - t ||
        ba[i + 2] > bb[j + 5] - t ||
        bb[j + 2] > ba[i + 5] - t
      )
        continue;
      if (
        segmentDistance2(
          A[i],
          A[i + 1],
          A[i + 2],
          A[i + 3],
          A[i + 4],
          A[i + 5],
          B[j],
          B[j + 1],
          B[j + 2],
          B[j + 3],
          B[j + 4],
          B[j + 5],
        ) < limit
      )
        return true;
    }
  return false;
};

/** Pairs of wires that pass into each other, by index. */
export function crossings(wires: Wire[]) {
  const tubes = wires.map((w) => tubeOf(w.points, w.diameter));
  const out: [number, number][] = [];
  for (let i = 0; i < tubes.length; i++)
    for (let j = i + 1; j < tubes.length; j++) if (touches(tubes[i], tubes[j])) out.push([i, j]);
  return out;
}

/** How a wire runs. */
interface Lane {
  /** Depths below the first and second tiles. */
  da: number;
  db: number;
  /** Shift along the tile edge a wire crosses, or in plan for a feed's run to the adapter. */
  aside: number;
  /** Between tiles: the shift along the second tile's edge. */
  asideB?: number;
  /**
   * The edge a leg leaves its tile by, if not the usual one: for a feed, its
   * finger pad's leg; through the port, its thumb pad's leg.
   */
  edge?: [0 | 1, number];
  /** For a feed: its level in the loom, in steps of loomStep from loom_height_mm. */
  level?: number;
}

/** A box in a key's frame that wires must keep out of. */
interface Obstacle {
  name?: string;
  inverse: Matrix4;
  lo: V3;
  hi: V3;
  /** World bounding box. */
  wlo: number[];
  whi: number[];
  /** The last search that tested it. */
  seen?: number;
}

export function wiring(cfg: Config, frames = componentFrames(cfg)): Wiring {
  const w = cfg.wiring;
  const tile = cfg.tile;
  const padZ = -(tile.plate_top_to_pcb_top_mm + tile.size_mm[2]);
  const loomZ = cfg.chassis.base_thickness_mm + w.loom_height_mm;
  const keys = Object.keys(frames).filter((n) => n.startsWith('matrix_') || isThumb(n));
  const downOf = (key: string): V3 => {
    const e = frames[key].elements;
    return [-e[8], -e[9], -e[10]];
  };
  const pads: Pad[] = keys.flatMap((key) =>
    tile.pads.list.map((p) => ({
      key,
      name: p.name,
      at: point(frames[key], [p.at_mm[0], p.at_mm[1], padZ]),
      xy: [p.at_mm[0], p.at_mm[1]] as [number, number],
      down: downOf(key),
    })),
  );
  const hole = holes(cfg, frames);
  const port = wirePort(cfg, frames);

  // What wires keep out of: each tile from its underside up, and its parts
  // with their clearance.
  const obstacles: Obstacle[] = [];
  // And, where a wire climbs between keys at different heights, the plates
  // with the reach of an edge that has no neighbour.
  const plates: Obstacle[] = [];
  const plateHalf = plateHalfWidths(cfg);
  const [hx, hy] = tile.size_mm.map((x) => x / 2 + tile.clearance_mm);
  const c = tile.component_clearance_mm;
  const tileTop = -tile.plate_top_to_pcb_top_mm;
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
    const box = (lo: V3, hi: V3, list = obstacles) => {
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
        point(m, [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]),
      );
      list.push({
        name: `${key} ${obstacles.length}`,
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
    for (const p of tile.components)
      box(
        p.center_mm.map((x, k) => x + (k === 2 ? tileTop : 0) - p.size_mm[k] / 2 - c) as V3,
        p.center_mm.map((x, k) => x + (k === 2 ? tileTop : 0) + p.size_mm[k] / 2 + c) as V3,
      );
  }
  /** Whether a wire's segment comes within r of an obstacle. */
  // The obstacles in a grid of square cells in plan, each in every cell its
  // box overlaps, so a segment is only tested against those near it.
  const GRID = 6;
  type Grid = { x0: number; y0: number; nx: number; ny: number; cells: Obstacle[][] };
  const grids = new Map<Obstacle[], Grid>();
  let stamp = 0;
  const gridOf = (list: Obstacle[]) => {
    let g = grids.get(list);
    if (g) return g;
    const x0 = Math.min(...list.map((o) => o.wlo[0]));
    const y0 = Math.min(...list.map((o) => o.wlo[1]));
    const nx = Math.floor((Math.max(...list.map((o) => o.whi[0])) - x0) / GRID) + 1;
    const ny = Math.floor((Math.max(...list.map((o) => o.whi[1])) - y0) / GRID) + 1;
    const cells: Obstacle[][] = Array.from({ length: nx * ny }, () => []);
    for (const o of list)
      for (let i = Math.floor((o.wlo[0] - x0) / GRID); i <= Math.floor((o.whi[0] - x0) / GRID); i++)
        for (
          let j = Math.floor((o.wlo[1] - y0) / GRID);
          j <= Math.floor((o.whi[1] - y0) / GRID);
          j++
        )
          cells[i * ny + j].push(o);
    grids.set(list, (g = { x0, y0, nx, ny, cells }));
    return g;
  };
  // Called millions of times while routing: no arrays or closures in it.
  const la = [0, 0, 0];
  const lb = [0, 0, 0];
  const blocked = (a: V3, b: V3, r: number, among = obstacles) => {
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
    const i0 = Math.max(0, Math.floor((lo0 - g.x0) / GRID));
    const i1 = Math.min(g.nx - 1, Math.floor((hi0 - g.x0) / GRID));
    const j0 = Math.max(0, Math.floor((lo1 - g.y0) / GRID));
    const j1 = Math.min(g.ny - 1, Math.floor((hi1 - g.y0) / GRID));
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
    {
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
    }
    return false;
  };

  // First the wires' ends: which pads and holes each net's wires join.
  interface Spec {
    net: NetSpec;
    from: string;
    to: string;
    a: Pad | number;
    b: Pad;
  }
  const specs: Spec[] = [];
  const padsOf = (key: string, name: string) =>
    pads.filter((p) => p.key === key && p.name === name);
  const nearest = (options: Pad[], to: V3) =>
    options.reduce((a, b) => (distance(a.at, to) <= distance(b.at, to) ? a : b));
  for (const net of nets(cfg)) {
    for (const listed of net.chains ?? [w.led_order]) {
      const chain = listed.filter((k) => frames[k]);
      if (!chain.length) continue;
      // An undirected chain is fed from whichever end is nearer its hole.
      const first = (k: string) => padsOf(k, net.pads[0])[0]?.at ?? point(frames[k], [0, 0, 0]);
      if (
        !net.directed &&
        distance(first(chain.at(-1)!), hole[net.pin]) < distance(first(chain[0]), hole[net.pin])
      )
        chain.reverse();
      let from = hole[net.pin];
      let previous: Pad | undefined;
      chain.forEach((key, i) => {
        const options = padsOf(key, net.pads[0]);
        if (!options.length) throw Error(`Tile has no ${net.pads[0]} pad for ${net.name}`);
        const arrive = nearest(options, from);
        specs.push(
          previous
            ? { net, from: previous.key, to: key, a: previous, b: arrive }
            : { net, from: `hole ${net.pin}`, to: key, a: net.pin, b: arrive },
        );
        // Leave from a different pad of the same name, if the tile has one,
        // nearest the next key.
        const next = chain[i + 1];
        const outs = padsOf(key, net.pads[1]);
        const others = outs.filter((p) => p !== arrive);
        previous = next
          ? nearest(others.length ? others : outs, point(frames[next], [0, 0, 0]))
          : undefined;
        from = previous?.at ?? from;
      });
    }
  }

  // Two wires on one pad sit side by side along it, the one heading further
  // along the pad on that side; two on one hole sit side by side across the
  // hole row.
  const otherEnd = (s: Spec, end: Pad | number): V3 => {
    const e = end === s.b ? s.a : s.b;
    return typeof e === 'number' ? hole[e] : e.at;
  };
  const users = new Map<Pad | number, Spec[]>();
  for (const s of specs) for (const e of [s.a, s.b]) users.set(e, [...(users.get(e) ?? []), s]);
  const alongOf = (end: Pad | number): V3 => {
    const e = typeof end === 'number' ? frames.adapter.elements : frames[end.key].elements;
    return [e[4], e[5], e[6]];
  };
  const shift = (s: Spec, end: Pad | number) => {
    const list = users.get(end)!;
    if (list.length < 2) return 0;
    const along = alongOf(end);
    const at = typeof end === 'number' ? hole[end] : end.at;
    const reach = (x: Spec) => {
      const o = otherEnd(x, end);
      return (o[0] - at[0]) * along[0] + (o[1] - at[1]) * along[1] + (o[2] - at[2]) * along[2];
    };
    const sorted = [...list].sort((x, y) => reach(x) - reach(y));
    const share = typeof end === 'number' ? WIRING.holeShare : WIRING.padShare;
    return (sorted.indexOf(s) - (list.length - 1) / 2) * share;
  };
  const moved = (p: V3, along: V3, by: number): V3 => [
    p[0] + along[0] * by,
    p[1] + along[1] * by,
    p[2] + along[2] * by,
  ];
  const shiftedPad = (p: Pad, by: number): Pad => ({
    ...p,
    at: moved(p.at, alongOf(p), by),
    xy: [p.xy[0], p.xy[1] + by],
  });
  const ends = specs.map((s) => ({
    a:
      typeof s.a === 'number'
        ? moved(hole[s.a], alongOf(s.a), shift(s, s.a))
        : shiftedPad(s.a, shift(s, s.a)),
    b: shiftedPad(s.b, shift(s, s.b)),
  }));

  // Places in the wire port: a hexagonal grid across it.
  const axis = [port.inside[0] - port.outside[0], port.inside[1] - port.outside[1]];
  const axisLength = Math.hypot(axis[0], axis[1]);
  const side = [-axis[1] / axisLength, axis[0] / axisLength];
  const room = port.diameter / 2 - w.power_wire_mm / 2;
  const places: V3[] = [];
  const places_ = places;
  const pitch = WIRING.portPitch;
  for (let row = -4; row <= 4; row++)
    for (let col = -4; col <= 4; col++) {
      const u = (col + (row % 2 ? 0.5 : 0)) * pitch;
      const v = row * pitch * Math.sqrt(0.75);
      if (Math.hypot(u, v) <= room + 1e-9) places.push([side[0] * u, side[1] * u, v]);
    }
  places.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

  /** From p across at height z to q's plan position, its middle shifted `aside` in plan. */
  const across = (p: V3, q: V3, z: number, aside: number): V3[] => {
    const p1: V3 = [p[0], p[1], z];
    const q1: V3 = [q[0], q[1], z];
    const dx = q1[0] - p1[0];
    const dy = q1[1] - p1[1];
    const l = Math.hypot(dx, dy);
    if (!aside || l < 1e-6) return [p1, q1];
    const o = [(-dy / l) * aside, (dx / l) * aside];
    const at = (t: number): V3 => [p1[0] + dx * t + o[0], p1[1] + dy * t + o[1], z];
    return [p1, at(1 / 3), at(2 / 3), q1];
  };
  /** The edge of a key's tile that faces a world point, in plan: its axis and sign. */
  const edgeToward = (key: string, to: V3) => {
    const c = point(frames[key], [0, 0, 0]);
    return facing(frames[key], [to[0] - c[0], to[1] - c[1]]);
  };
  const half = [hx, hy];
  // Set when a leg's shift takes it out past its tile's pocket, into the chassis.
  let strayed = false;
  // Set when a join between two keys' legs finds no way past the plates.
  let stuck = false;
  let keep = 0;
  /**
   * A pad's way off its tile, in the tile's frame: just under the tile,
   * `aside` along the edge it heads for (axis, sign), down to `depth`, then
   * straight out to that edge.
   */
  const makeLeg = (p: Pad, [axis, sign]: [0 | 1, number], depth: number, aside: number) => {
    // Shift aside just under the tile first, so the wire's way down is clear
    // of the pad's line, where other wires run past.
    const hop = Math.min(depth, WIRING.hopDepth);
    const start: V3 = [p.xy[0], p.xy[1], padZ - hop];
    const shifted: V3 = [...start];
    shifted[1 - axis] += aside;
    const stray = Math.abs(shifted[1 - axis]) > half[1 - axis] - keep;
    const down: V3 = [shifted[0], shifted[1], padZ - depth];
    const out: V3 = [...down];
    out[axis] = sign * half[axis];
    // A shift in toward the tile's parts waits until the wire is below them.
    const inward = axis === 0 && aside * Math.sign(p.xy[1]) < 0;
    const turn: V3 = inward ? [start[0], start[1], padZ - depth] : shifted;
    const points = [p.at, ...[start, turn, down, out].map((x) => point(frames[p.key], x))];
    return { points, stray };
  };
  // Many lanes share a leg: each is made once, so routes share its points
  // (and what is known about the segments between them). Callers copy before
  // changing one.
  const legs = new Map<Pad, Map<string, { points: V3[]; stray: boolean }>>();
  const leg = (p: Pad, edge: [0 | 1, number], depth: number, aside = 0): V3[] => {
    let mine = legs.get(p);
    if (!mine) legs.set(p, (mine = new Map()));
    const key = `${edge[0]} ${edge[1]} ${depth} ${aside} ${keep}`;
    let made = mine.get(key);
    if (!made) mine.set(key, (made = makeLeg(p, edge, depth, aside)));
    if (made.stray) strayed = true;
    return made.points;
  };
  /** A pad's own edge: the one it sits beside. */
  const ownEdge = (p: Pad): [0 | 1, number] => [1, Math.sign(p.xy[1]) || 1];
  const clean = (points: V3[]) => points.filter((x, i) => !i || distance(x, points[i - 1]) > 1e-6);
  /** A thumb pad's way out through the wire port, ending inside the finger columns. */
  const throughPort = (p: Pad, lane: Lane, place: V3, aside = 0): V3[] => {
    const out = leg(p, lane.edge ?? edgeToward(p.key, port.outside), lane.da, aside);
    // The thumb's wires gather just off its edge facing the port, each at its
    // place's offset, so they run to the port side by side.
    const [axis, sign] = edgeToward(p.key, port.outside);
    const centre: V3 = [0, 0, padZ - WIRING.gatherDepth];
    centre[axis] = sign * (half[axis] + WIRING.gatherOut);
    // Turn the place's offset to lie across the run from the port, the same
    // way round.
    const at = point(frames[p.key], centre);
    const run = [at[0] - port.outside[0], at[1] - port.outside[1]];
    const l = Math.hypot(run[0], run[1]);
    let across2 = [-run[1] / l, run[0] / l];
    if (across2[0] * side[0] + across2[1] * side[1] < 0) across2 = [-across2[0], -across2[1]];
    const u = place[0] * side[0] + place[1] * side[1];
    const gather: V3 = [at[0] + across2[0] * u, at[1] + across2[1] * u, at[2] + place[2]];
    return [...out, gather, add3(port.outside, place), add3(port.inside, place)];
  };
  /**
   * Where a wire turns after the port, on the finger side: a wire turning down
   * goes further on from a higher place, so it passes over the lower places'
   * turns, and a wire turning up goes further on from a lower place.
   */
  const lowest = Math.min(...places.map((p) => p[2]));
  const highest = Math.max(...places.map((p) => p[2]));
  const beyondPort = (place: V3, up = false): V3 => {
    const rise = up ? highest - place[2] : place[2] - lowest;
    const on = WIRING.beyondStep * Math.round(rise / (pitch * Math.sqrt(0.75)));
    return add3(port.inside, [
      place[0] + (axis[0] / axisLength) * on,
      place[1] + (axis[1] / axisLength) * on,
      place[2],
    ]);
  };
  /**
   * The way between two keys' legs: straight across, or where that runs into a
   * tile or plate, down from the higher one first.
   */
  const joins = new Map<V3[], Map<V3[], { points: V3[]; stuck: boolean }>>();
  const done = (points: V3[]) => ({ points, stuck: false });
  // From a higher leg's run out to its tile's edge, the places to climb down
  // from: along the run, then stepped back toward its key's centre.
  const CLEAR = 1;
  const BLOCKED = 2;
  const climbs = new Map<
    V3[],
    { runs: V3[]; tops: V3[]; ups: Uint8Array; downs: Map<number, Uint8Array> }
  >();
  const climbOf = (h: V3[], own: V3) => {
    let c = climbs.get(h);
    if (c) return c;
    const [from, to] = [h.at(-2)!, h.at(-1)!];
    const runs: V3[] = [];
    const tops: V3[] = [];
    for (let back = 0; back <= WIRING.climbBack; back += 1)
      for (let t = 1; t >= 0; t -= 0.05) {
        const run: V3 = [0, 1, 2].map((k) => from[k] + (to[k] - from[k]) * t) as V3;
        const d = Math.hypot(own[0] - run[0], own[1] - run[1]) || 1;
        runs.push(run);
        tops.push([
          run[0] + ((own[0] - run[0]) / d) * back,
          run[1] + ((own[1] - run[1]) / d) * back,
          run[2],
        ]);
      }
    climbs.set(h, (c = { runs, tops, ups: new Uint8Array(runs.length), downs: new Map() }));
    return c;
  };
  const join = (p: V3[], q: V3[], ca: V3, cb: V3): { points: V3[]; stuck: boolean } => {
    // Straight across between the legs' ends, or, where that runs into a
    // tile (a key much higher than its neighbour, beside it), straight down
    // from the higher end first, then across.
    const [pe, qe] = [p.at(-1)!, q.at(-1)!];
    const r = w.power_wire_mm / 2;
    const clear = (a: V3, b: V3) => !blocked(a, b, r) && !blocked(a, b, r, plates);
    const qr = [...q].reverse();
    if (clear(pe, qe)) return done(clean([...p, ...qr]));
    // Down from the higher key's leg as it heads out under its tile: from
    // the last place along its run to the edge where the way down misses the
    // lower key's tile and plate, or failing that, from a step back in under
    // the higher tile toward its centre; then across.
    const [h, l, own] = pe[2] > qe[2] ? [p, q, cb] : [q, p, ca];
    const end = l.at(-1)!;
    // The places to climb from, and which ways down from them are clear, are
    // the same for every lower leg the higher one meets: found once.
    const c = climbOf(h, own);
    let downs = c.downs.get(end[2]);
    if (!downs) c.downs.set(end[2], (downs = new Uint8Array(c.runs.length)));
    for (let i = 0; i < c.runs.length; i++) {
      const [run, top] = [c.runs[i], c.tops[i]];
      if (!c.ups[i]) c.ups[i] = clear(run, top) ? CLEAR : BLOCKED;
      if (c.ups[i] === BLOCKED) continue;
      const foot: V3 = [top[0], top[1], end[2]];
      if (!downs[i]) downs[i] = clear(top, foot) ? CLEAR : BLOCKED;
      if (downs[i] === BLOCKED) continue;
      if (clear(foot, end)) {
        const way = [...h.slice(0, -1), run, top, foot, ...[...l].reverse()];
        return done(clean(h === p ? way : way.reverse()));
      }
    }
    // Or round a corner in plan, along one key's edge and then the other's.
    const mid = (pe[2] + qe[2]) / 2;
    for (const c of [
      [pe[0], qe[1], mid],
      [qe[0], pe[1], mid],
    ] as V3[])
      if (clear(pe, c) && clear(c, qe)) return done(clean([...p, c, ...qr]));
    // Or under both ends: down from each, and across below them.
    for (let d = 1; d <= WIRING.climbUnder; d += 1) {
      const z = Math.max(Math.min(pe[2], qe[2]) - d, loomZ);
      const [a, b]: V3[] = [
        [pe[0], pe[1], z],
        [qe[0], qe[1], z],
      ];
      if (clear(pe, a) && clear(a, b) && clear(b, qe)) return done(clean([...p, a, b, ...qr]));
    }
    return { points: clean([...p, ...qr]), stuck: true };
  };
  /** A route for a wire in `lane`, through the wire port at `place`. */
  const route = (a: Pad | V3, b: Pad, lane: Lane, place: V3): V3[] => {
    if (Array.isArray(a)) {
      const path = isThumb(b.key)
        ? [...throughPort(b, lane, place, lane.asideB), beyondPort(place)]
        : leg(b, lane.edge ?? ownEdge(b), lane.da, lane.aside);
      const end = path.at(-1)!;
      const z = loomZ + (lane.level ?? 0) * WIRING.loomStep;
      return clean([...path, ...across(end, a, Math.min(z, end[2]), lane.aside), a]).reverse();
    }
    if (isThumb(a.key) === isThumb(b.key)) {
      const ca = point(frames[b.key], [0, 0, 0]);
      const cb = point(frames[a.key], [0, 0, 0]);
      const p = leg(a, edgeToward(a.key, ca), lane.da, lane.aside);
      const q = leg(b, edgeToward(b.key, cb), lane.db, lane.asideB ?? lane.aside);
      // Many lanes share the same two legs, and the way between them.
      let mine = joins.get(p);
      if (!mine) joins.set(p, (mine = new Map()));
      let joined = mine.get(q);
      if (!joined) mine.set(q, (joined = join(p, q, ca, cb)));
      if (joined.stuck) stuck = true;
      return joined.points;
    }
    // The lane's first depth and aside are for a's leg, the second for b's.
    const [t, f] = isThumb(a.key) ? [a, b] : [b, a];
    const [dt, df] = t === a ? [lane.da, lane.db] : [lane.db, lane.da];
    const [st, sf] = t === a ? [lane.aside, lane.asideB] : [lane.asideB, lane.aside];
    const path = throughPort(t, { ...lane, da: dt }, place, st);
    const q = [...leg(f, edgeToward(f.key, port.inside), df, sf)].reverse();
    const points = clean([...path, beyondPort(place, q[0][2] > place[2] + port.inside[2]), ...q]);
    return isThumb(a.key) ? points : points.reverse();
  };
  const crossesPort = (s: Spec) =>
    typeof s.a === 'number' ? isThumb(s.b.key) : isThumb(s.a.key) !== isThumb(s.b.key);
  /** Whether a route runs into a tile or its parts (its drops at the pads excepted). */
  // Many routes share segments (their legs), so each segment is tested once.
  const tested = new Map<number, Map<V3, Map<V3, boolean>>>();
  const hitsTiles = (points: V3[], r: number) => {
    let byR = tested.get(r);
    if (!byR) tested.set(r, (byR = new Map()));
    for (let i = 2; i < points.length - 1; i++) {
      const [p, q] = [points[i - 1], points[i]];
      let from = byR.get(p);
      if (!from) byR.set(p, (from = new Map()));
      let hit = from.get(q);
      if (hit === undefined) from.set(q, (hit = blocked(p, q, r)));
      if (hit) return true;
    }
    return false;
  };

  // Lay the wires one at a time, shortest first (they have the fewest ways to
  // go), each in the first lane (and port place) where it misses the tiles and
  // every wire laid before it. Then lay them again with the wires that hit
  // something first, until none do or the passes run out.
  const diameterOf = (s: Spec) =>
    ['power', 'ground'].includes(s.net.group) ? w.power_wire_mm : w.signal_wire_mm;
  const componentDepth = Math.max(
    ...tile.components.map((p) => -(p.center_mm[2] + tileTop - p.size_mm[2] / 2) + padZ + c),
  );
  /**
   * The depths a wire may run at below a tile, nearest first, by what its leg
   * on that tile does: out over the pad's own edge (a hop, just under the
   * tile), along the pads' strip past other pads (under their drops), or
   * across the tile under its parts.
   */
  const legDepths = (p: Pad, [axis, sign]: [0 | 1, number], d: number) => {
    const r = d / 2;
    // Along the strip, a wire runs a step deeper for each pad it passes under
    // on its way to the edge.
    const passes = tile.pads.list.filter(
      (q) => Math.sign(q.at_mm[1]) === Math.sign(p.xy[1]) && sign * (q.at_mm[0] - p.xy[0]) > 1e-6,
    ).length;
    const from =
      axis === 1 && sign === Math.sign(p.xy[1])
        ? WIRING.hopDepth
        : axis === 0
          ? WIRING.stripDepth + passes * WIRING.stripStep
          : componentDepth + r + 0.1;
    return [...Array(WIRING.depthChoices).keys()].map(
      (k) => Math.max(from, r + 0.1) + k * WIRING.depthStep,
    );
  };
  const edgeOf = (s: Spec, end: 'a' | 'b'): [0 | 1, number] => {
    const p = (end === 'a' ? s.a : s.b) as Pad;
    const other = end === 'a' ? s.b : s.a;
    if (typeof other === 'number')
      return isThumb(p.key) ? edgeToward(p.key, port.outside) : ownEdge(p);
    if (isThumb(p.key) !== isThumb(other.key))
      return edgeToward(p.key, isThumb(p.key) ? port.outside : port.inside);
    return edgeToward(p.key, point(frames[other.key], [0, 0, 0]));
  };
  // Each wire through the port has a place of its own, on the side its two
  // ends lie, so the wires through it do not cross there.
  const placeUV = (p: V3) => [p[0] * side[0] + p[1] * side[1], p[2]];
  const toward2 = (from: V3, to: V3) => {
    const u = (to[0] - from[0]) * side[0] + (to[1] - from[1]) * side[1];
    const v = to[2] - from[2];
    const l = Math.hypot(u, v) || 1;
    return [u / l, v / l];
  };
  const throughs = specs.map((_, i) => i).filter((i) => crossesPort(specs[i]));
  const prefer = new Map(
    throughs.map((i) => {
      const s = specs[i];
      // Where each end's leg leaves its tile, at its nearest depth.
      const exit = (p: Pad, to: V3) => {
        const edge = edgeToward(p.key, to);
        return leg(p, edge, legDepths(p, edge, diameterOf(s))[0]).at(-1)!;
      };
      const t = (isThumb(s.b.key) ? ends[i].b : ends[i].a) as Pad;
      const f =
        typeof s.a === 'number'
          ? (ends[i].a as V3)
          : exit((isThumb(s.b.key) ? ends[i].a : ends[i].b) as Pad, port.inside);
      const a = toward2(port.outside, exit(t, port.outside));
      const b = toward2(port.inside, f);
      return [i, [a[0] + b[0], a[1] + b[1]]];
    }),
  );
  const fit = (i: number, p: V3) => {
    const [u, v] = placeUV(p);
    const [a, b] = prefer.get(i)!;
    return u * a + v * b;
  };
  const placeOf = new Map<number, number>();
  {
    const taken = new Set<number>();
    const strength = (i: number) => Math.hypot(...prefer.get(i)!);
    for (const i of [...throughs].sort((x, y) => strength(y) - strength(x))) {
      let best = -1;
      places.forEach((p, k) => {
        if (!taken.has(k) && (best < 0 || fit(i, p) > fit(i, places[best]))) best = k;
      });
      if (best < 0) break;
      taken.add(best);
      placeOf.set(i, best);
    }
    // Swap places between two wires while that suits them better.
    for (let changed = true; changed;) {
      changed = false;
      for (const i of placeOf.keys())
        for (const j of placeOf.keys()) {
          const [pi, pj] = [places[placeOf.get(i)!], places[placeOf.get(j)!]];
          if (fit(i, pj) + fit(j, pi) > fit(i, pi) + fit(j, pj) + 1e-9) {
            const k = placeOf.get(i)!;
            placeOf.set(i, placeOf.get(j)!);
            placeOf.set(j, k);
            changed = true;
          }
        }
    }
  }
  const candidates = (s: Spec, own: number | undefined) => {
    const d = diameterOf(s);
    const isFeed = typeof s.a === 'number';
    const through = crossesPort(s);
    const db = legDepths(s.b, edgeOf(s, 'b'), d);
    const da = isFeed ? db : legDepths(s.a as Pad, edgeOf(s, 'a'), d);
    const out: { lane: Lane; place: V3; rank: number }[] = [];
    // Its own place in the port first, then the places next to it.
    const places: V3[] =
      own === undefined
        ? [[0, 0, 0]]
        : [...places_]
            .sort((x, y) => distance(x, places_[own]) - distance(y, places_[own]))
            .slice(0, wide ? places_.length : WIRING.placeChoices);
    const sides = WIRING.edgeAsides.slice(0, 3);
    // A feed leaves by its pad's own edge or by the edge facing its hole.
    const home = ownEdge(s.b);
    const toward = isFeed ? edgeToward(s.b.key, hole[s.a as number]) : home;
    const edges = toward[0] === home[0] && toward[1] === home[1] ? [home] : [home, toward];
    if (isFeed && !through)
      for (const [e, edge] of edges.entries()) {
        const depths = legDepths(s.b, edge, d);
        for (let i = 0; i < (wide ? WIRING.depthChoices : WIRING.longDepths); i++)
          for (const level of WIRING.loomLevels)
            for (const aside of WIRING.asides)
              out.push({
                lane: { da: depths[i], db: depths[i], aside, level, edge },
                place: [0, 0, 0],
                rank: i + 2 * e,
              });
      }
    // Through the port, the thumb's leg leaves by the edge facing the port or
    // by its pad's own edge.
    const t = (isFeed || isThumb(s.b.key) ? s.b : s.a) as Pad;
    const facingPort = edgeToward(t.key, port.outside);
    const thumbEdges = [facingPort, ownEdge(t)].filter(
      (e, k, all) => !k || e[0] !== all[0][0] || e[1] !== all[0][1],
    );
    if (isFeed)
      for (const [e, edge] of thumbEdges.entries()) {
        const depths = legDepths(t, edge, d);
        for (let i = 0; i < (wide ? WIRING.depthChoices : WIRING.longDepths); i++)
          for (const level of WIRING.loomLevels.slice(0, 7))
            for (let y = 0; y < sides.length; y++)
              for (const [n, place] of places.entries())
                out.push({
                  lane: {
                    da: depths[i],
                    db: depths[i],
                    aside: 0,
                    asideB: sides[y],
                    level,
                    edge,
                  },
                  place,
                  rank: i + (y ? 1 : 0) + (n ? 1 : 0) + 2 * e,
                });
      }
    else if (through)
      for (const [e, edge] of thumbEdges.entries()) {
        const dt = legDepths(t, edge, d);
        const [d1, d2] = t === s.a ? [dt, db] : [da, dt];
        for (let i = 0; i < d1.length; i++)
          for (let j = 0; j < d2.length; j++)
            for (let x = 0; x < sides.length; x++)
              for (let y = 0; y < sides.length; y++)
                for (const [n, place] of places.entries())
                  out.push({
                    lane: { da: d1[i], db: d2[j], aside: sides[x], asideB: sides[y], edge },
                    place,
                    rank: i + j + (x ? 1 : 0) + (y ? 1 : 0) + (n ? 1 : 0) + 2 * e,
                  });
      }
    else
      for (let i = 0; i < da.length; i++)
        for (let j = 0; j < db.length; j++)
          for (let x = 0; x < WIRING.edgeAsides.length; x++)
            for (let y = 0; y < WIRING.edgeAsides.length; y++)
              out.push({
                lane: {
                  da: da[i],
                  db: db[j],
                  aside: WIRING.edgeAsides[x],
                  asideB: WIRING.edgeAsides[y],
                },
                place: [0, 0, 0],
                rank: i + j + (x ? 1 : 0) + (y ? 1 : 0),
              });
    return out.sort((x, y) => x.rank - y.rank);
  };
  // Each wire's candidate routes, nearest the tiles first, without those that
  // run into a tile (unless all do).
  interface Option {
    tube: Tube;
    rank: number;
  }
  // A wire may also end on the tile's other pad of the same name (the tile
  // joins its two + pads, and its two G pads), unshifted.
  const others = (end: Pad | number): (Pad | number)[] =>
    typeof end === 'number' ? [] : padsOf(end.key, end.name).filter((p) => p !== end);
  // Route with the usual choices first; if wires still meet, again with every
  // place in the port and every depth, and keep the better.
  let wide = false;
  const solve = () => {
    const options: Option[][] = specs.map((s, i) => {
      const d = diameterOf(s);
      const all = [s.a, ...others(s.a)].flatMap((a, ka) =>
        [s.b, ...others(s.b)].flatMap((b, kb) =>
          candidates({ ...s, a, b: b as Pad }, placeOf.get(i)).flatMap(({ lane, place, rank }) => {
            strayed = false;
            stuck = false;
            keep = d / 2;
            const points = route(
              ka ? (a as Pad) : ends[i].a,
              kb ? (b as Pad) : ends[i].b,
              lane,
              place,
            );
            if (strayed) return [];
            return {
              tube: tubeOf(points, d),
              rank: rank + (ka ? WIRING.otherPad : 0) + (kb ? WIRING.otherPad : 0),
              blocked: stuck || hitsTiles(points, d / 2),
            };
          }),
        ),
      );
      const clear = all.filter((o) => !o.blocked);
      return (clear.length ? clear : all.map((o) => ({ ...o, rank: o.rank + 100 })))
        .sort((x, y) => x.rank - y.rank)
        .slice(0, WIRING.optionLimit);
    });
    // Wires whose options can meet.
    const reach = options.map((list) => ({
      lo: [0, 1, 2].map((k) => Math.min(...list.map((o) => o.tube.lo[k]))),
      hi: [0, 1, 2].map((k) => Math.max(...list.map((o) => o.tube.hi[k]))),
    }));
    const near = specs.map((_, i) =>
      specs
        .map((_, j) => j)
        .filter(
          (j) =>
            j !== i &&
            [0, 1, 2].every(
              (k) => reach[i].lo[k] <= reach[j].hi[k] && reach[j].lo[k] <= reach[i].hi[k],
            ),
        ),
    );
    const ids = new Map<Tube, number>();
    options.flat().forEach((o, k) => ids.set(o.tube, k));
    const count = ids.size;
    const memo = new Map<number, boolean>();
    const meets = (a: Tube, b: Tube) => {
      const x = ids.get(a)!;
      const y = ids.get(b)!;
      const key = x < y ? x * count + y : y * count + x;
      let v = memo.get(key);
      if (v === undefined) memo.set(key, (v = touches(a, b)));
      return v;
    };
    // Negotiate: each wire in turn takes its cheapest option, given the others'
    // current choices. Meeting another wire costs `penalty`, which grows each
    // round, plus what that option has cost in earlier rounds. After the first
    // round only the wires that meet another are moved, until none do.
    const choice = options.map(() => 0);
    let history = options.map((list) => list.map(() => 0));
    const meetsAny = (i: number) =>
      near[i].some((j) => meets(options[i][choice[i]].tube, options[j][choice[j]].tube));
    const negotiate = (order: number[]) => {
      choice.fill(0);
      history = options.map((list) => list.map(() => 0));
      let penalty = WIRING.penalty;
      let moving = order;
      // Stop when the number meeting has not fallen for a while.
      let fewest = Infinity;
      let since = 0;
      for (let round = 0; round < WIRING.rounds && moving.length && since < WIRING.stall; round++) {
        for (const i of moving) {
          let best = Infinity;
          const list = options[i];
          for (let k = 0; k < list.length; k++) {
            // Options are in order of rank, and history only adds.
            if (list[k].rank >= best) break;
            let cost = list[k].rank + history[i][k];
            for (const j of near[i]) {
              if (cost >= best) break;
              if (meets(list[k].tube, options[j][choice[j]].tube)) cost += penalty;
            }
            if (cost < best) {
              best = cost;
              choice[i] = k;
            }
          }
        }
        const meeting = specs.map((_, i) => i).filter(meetsAny);
        if (meeting.length < fewest) {
          fewest = meeting.length;
          since = 0;
        } else since++;
        // A wire that meets another pays for its choice next round; so does each
        // wire in the way of its cheapest other options, so it moves aside.
        const next = new Set(meeting);
        for (const i of meeting) {
          history[i][choice[i]] += WIRING.historyCost;
          const cheapest = options[i]
            .map((o, k) => ({ k, cost: o.rank + history[i][k] }))
            .sort((x, y) => x.cost - y.cost)
            .slice(0, WIRING.blockerOptions);
          for (const { k } of cheapest)
            for (const j of near[i])
              if (meets(options[i][k].tube, options[j][choice[j]].tube)) {
                history[j][choice[j]] += WIRING.blockerCost;
                next.add(j);
              }
        }
        penalty *= WIRING.penaltyGrowth;
        moving = [...next];
      }
    };
    // Then repair what is left in small groups: two wires that meet, then
    // those two and the wire most in their way, each take the options that
    // together meet the fewest other wires, if that is fewer than now.
    const repair = (group: number[]) => {
      const inGroup = new Set(group);
      const outside = (i: number, k: number) => {
        let n = 0;
        for (const j of near[i])
          if (!inGroup.has(j) && meets(options[i][k].tube, options[j][choice[j]].tube)) n++;
        return n;
      };
      const lists = group.map((g) =>
        options[g]
          .map((o, k) => ({ k, n: outside(g, k), rank: o.rank }))
          .sort((x, y) => x.n - y.n || x.rank - y.rank),
      );
      const rest = lists.map((_, d) => lists.slice(d + 1).reduce((t, l) => t + l[0].n, 0));
      const mutual = (d: number, k: number, chosen: number[]) => {
        let n = 0;
        for (let e = 0; e < d; e++)
          if (meets(options[group[d]][k].tube, options[group[e]][chosen[e]].tube)) n++;
        return n;
      };
      const now = group.map((g) => choice[g]);
      let best = group.reduce((t, g, d) => t + outside(g, now[d]) + mutual(d, now[d], now), 0);
      let pick: number[] | undefined;
      let work = WIRING.repairWork;
      const chosen: number[] = [];
      const search = (d: number, n: number) => {
        if (d === group.length) {
          best = n;
          pick = [...chosen];
          return;
        }
        for (const o of lists[d]) {
          if (n + o.n + rest[d] >= best || --work < 0) break;
          const m = n + o.n + mutual(d, o.k, chosen);
          if (m + rest[d] >= best) continue;
          chosen[d] = o.k;
          search(d + 1, m);
        }
      };
      search(0, 0);
      if (!pick) return false;
      group.forEach((g, d) => (choice[g] = pick![d]));
      return true;
    };
    const repairAll = () => {
      for (let pass = 0; pass < WIRING.repairPasses; pass++) {
        let improved = false;
        for (const i of specs.map((_, i) => i).filter(meetsAny))
          for (const j of near[i]) {
            if (!meets(options[i][choice[i]].tube, options[j][choice[j]].tube)) continue;
            if (repair([i, j])) {
              improved = true;
              continue;
            }
            // The wire in the way of most of the pair's options.
            const inWay = new Map<number, number>();
            for (const g of [i, j])
              for (const o of options[g])
                for (const k of near[g])
                  if (k !== i && k !== j && meets(o.tube, options[k][choice[k]].tube))
                    inWay.set(k, (inWay.get(k) ?? 0) + 1);
            const ways = [...inWay].sort((x, y) => y[1] - x[1]).map(([k]) => k);
            // Each of the wires most in the way with the pair, then two of them.
            const top = ways.slice(0, WIRING.repairBlockers);
            const groups = [
              ...top.map((k) => [i, j, k]),
              ...top.flatMap((k, n) => top.slice(n + 1).map((m) => [i, j, k, m])),
            ];
            for (const g of groups)
              if (repair(g)) {
                improved = true;
                break;
              }
          }
        if (!improved) break;
      }
    };
    // If some still meet, start again with those wires placed first, and keep
    // the best of the tries.
    let order = specs.map((_, i) => i);
    let best: { left: number; choice: number[] } | undefined;
    for (let attempt = 0; attempt <= (wide ? WIRING.restarts : 0); attempt++) {
      negotiate(order);
      repairAll();
      const meeting = specs.map((_, i) => i).filter(meetsAny);
      if (!best || meeting.length < best.left) best = { left: meeting.length, choice: [...choice] };
      if (!meeting.length) break;
      const first = new Set(meeting);
      order = [...meeting, ...order.filter((i) => !first.has(i))];
    }
    return { left: best!.left, paths: best!.choice.map((k, i) => options[i][k].tube.points) };
  };
  let solved = solve();
  if (solved.left) {
    wide = true;
    const again = solve();
    if (again.left < solved.left) solved = again;
  }
  const paths = solved.paths;

  const wires: Wire[] = specs.map((s, i) => {
    const isFeed = typeof s.a === 'number';
    return {
      net: s.net.name,
      group: s.net.group,
      from: s.from,
      to: s.to,
      points: paths[i],
      diameter: diameterOf(s),
      length: length(paths[i]) + 2 * w.end_allowance_mm + (isFeed ? w.service_loop_mm : 0),
      feed: isFeed,
    };
  });
  const summaries: NetSummary[] = nets(cfg).map((net) => {
    const own = wires.filter((x) => x.net === net.name);
    return {
      name: net.name,
      pin: net.pin,
      group: net.group,
      wires: own.length,
      joints: 2 * own.length,
      length: own.reduce((t, x) => t + x.length, 0),
    };
  });
  const netFor = (key: string, group: string) =>
    nets(cfg).find((n) => n.group === group && (n.chains ?? []).some((c) => c.includes(key)))
      ?.name ?? '';
  return {
    pads,
    wires,
    nets: summaries,
    matrix: keys.map((key) => ({ key, row: netFor(key, 'row'), column: netFor(key, 'column') })),
  };
}

/** A box part along a segment: x along it, y along `across`, z the cross product. */
const segmentPart = (
  name: string,
  group: string,
  a: V3,
  b: V3,
  across: V3,
  width: number,
  thickness: number,
): Part => {
  const x = new Vector3(...b).sub(new Vector3(...a));
  const len = x.length();
  x.normalize();
  const z = new Vector3().crossVectors(x, new Vector3(...across)).normalize();
  const y = new Vector3().crossVectors(z, x);
  const m = new Matrix4().makeBasis(x, y, z).setPosition(...mid(a, b));
  return {
    name,
    group,
    size: [len, width, thickness],
    center: [0, 0, 0],
    matrix: m.elements.slice(),
  };
};

/**
 * The ribbon's centre line, in the adapter's frame: out of the connector's
 * mouth, over the slack loop, down onto the landing and out through the wall.
 */
export function ribbonPath(cfg: Config) {
  const a = cfg.adapter;
  const r = cfg.ribbon;
  const [bx, , bz] = a.board_mm;
  const mouthX = -bx / 2 + a.connector_inset_mm;
  const mouthZ = bz + a.connector_mm[2] / 2;
  const loopFrom = mouthX - 2;
  const loopTo = loopFrom - 2 * r.loop_radius_mm;
  const landing = landingBox(cfg);
  const onLanding = landing.top + r.thickness_mm / 2 + 0.05;
  const points: V3[] = [[mouthX, 0, mouthZ]];
  // The loop: a half turn up and over, from loopFrom to loopTo.
  for (let i = 0; i <= WIRING.loopSteps; i++) {
    const t = (i / WIRING.loopSteps) * Math.PI;
    points.push([
      (loopFrom + loopTo) / 2 + r.loop_radius_mm * Math.cos(t),
      0,
      mouthZ + r.loop_radius_mm * Math.sin(t),
    ]);
  }
  points.push(
    [landing.from + 0.5, 0, onLanding],
    [landing.to, 0, onLanding],
    [landing.to - r.outside_mm, 0, onLanding],
  );
  return points;
}

/**
 * The landing on the bottom plate, in the adapter's frame (x from `from` down
 * to `to`, z from the plate's top down to `bottom` up to `top`).
 */
export function landingBox(cfg: Config) {
  const a = cfg.adapter;
  const r = cfg.ribbon;
  const from = -a.board_mm[0] / 2 + a.connector_inset_mm - 3 - 2 * r.loop_radius_mm;
  return {
    from,
    to: from - r.landing_mm[0],
    width: r.landing_mm[1],
    bottom: -a.standoff_mm,
    top: -a.standoff_mm + r.landing_mm[2],
  };
}

/** The adapter, its connector and the ribbon, as parts for display and the checks. */
export function adapterParts(cfg: Config, frames = componentFrames(cfg)): Part[] {
  const a = cfg.adapter;
  const r = cfg.ribbon;
  const f = frames.adapter;
  const parts: Part[] = [];
  const [bx, by, bz] = a.board_mm;
  const box = (name: string, group: string, size: V3, center: V3, m: Matrix4 = f) =>
    parts.push({ name, group, size, center, matrix: m.elements.slice() });
  parts.push({
    name: 'Adapter board',
    group: 'adapter',
    size: [bx, by, bz],
    center: [0, 0, bz / 2],
    matrix: f.elements.slice(),
    holes: a.mounting_holes_mm.map((h) => ({ at: h, diameter: a.mounting_hole_diameter_mm })),
  });
  const c = a.connector_mm;
  const cx = -bx / 2 + a.connector_inset_mm + c[0] / 2;
  box('Adapter connector', 'adapter', [c[0], c[1], c[2]], [cx, 0, bz + c[2] / 2]);
  box(
    'Adapter connector latch room',
    'adapter',
    [c[0], c[1], a.latch_room_mm],
    [cx, 0, bz + c[2] + a.latch_room_mm / 2],
  );
  const path = ribbonPath(cfg).map((p) => point(f, p));
  const across = point(f, [0, 1, 0]).map((x, i) => x - f.elements[12 + i]) as V3;
  for (let i = 0; i + 1 < path.length; i++)
    parts.push(
      segmentPart(
        `Ribbon ${i + 1}`,
        'ribbon',
        path[i],
        path[i + 1],
        across,
        r.width_mm,
        r.thickness_mm,
      ),
    );
  return parts;
}

/** The pads on every tile, as thin boxes on the tile's underside. */
export function padParts(cfg: Config, frames = componentFrames(cfg)): Part[] {
  const tile = cfg.tile;
  const z = -(tile.plate_top_to_pcb_top_mm + tile.size_mm[2]) - 0.05;
  return Object.keys(frames)
    .filter((n) => n.startsWith('matrix_') || isThumb(n))
    .flatMap((key) =>
      tile.pads.list.map((p) => ({
        name: `${key}: ${p.name} pad`,
        group: 'pads',
        size: [...tile.pads.size_mm, 0.1] as V3,
        center: [p.at_mm[0], p.at_mm[1], z] as V3,
        matrix: frames[key].elements.slice(),
      })),
    );
}
