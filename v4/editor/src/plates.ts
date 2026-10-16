// The key plates: their extents, shared with the wiring (which keeps wires
// out of them), and each well's sheet of plates, which the chassis builds on.
import type { CrossSection, ManifoldToplevel, Vec3 } from 'manifold-3d';
import type { Matrix4 } from 'three';
import { point, type Config } from './geometry';
import { down, prism } from './manifold-util';
import { seatSettings } from './seats';

/** Sizes in mm, in key coordinates. */
export const PLATES = {
  /** A plate edge with no neighbour reaches this far out, to the wall round its well. */
  wellReach: 12,
  /** Keys are neighbours across an edge when their centres are at most this far past twice the plate half-width apart. */
  neighbourGap: 8,
  /** The reaches and the joins between plates are this thick: a skin, holding no switch. */
  reachThickness: 2,
  /** The skirt round each well's edge, under its plates, is this thick (plan), */
  skirt: 1.2,
  /** and reaches this far down. */
  skirtDepth: 10,
  /** Skirts start this far up into the reach above them. */
  skirtInto: 0.5,
  /** Under a plate edge with no neighbour, the room for the tile's edge pads, their wires and a soldering iron reaches this far past the plate. */
  underRoom: 8,
  /** The plates reach this far into the wall round their well (plan). */
  wellInto: 0.5,
  /** At a corner where four keys meet, each key's share of the fill reaches this far in from its plate corner. */
  cornerFill: 3,
};

/** Half-widths along a key's x and y axes. */
export type HalfWidths = [number, number];

/** The tile pocket's half-widths: the tile and its clearance. */
export const tilePocketHalf = (cfg: Config): HalfWidths => [
  cfg.tile.size_mm[0] / 2 + cfg.tile.clearance_mm,
  cfg.tile.size_mm[1] / 2 + cfg.tile.clearance_mm,
];

/** The plates' half-widths: plate_margin past the seat, and always far enough to cover the tile pocket. */
export function plateHalfWidths(cfg: Config): HalfWidths {
  const seat = seatSettings(cfg).outer;
  const pocket = tilePocketHalf(cfg);
  return [0, 1].map((i) =>
    Math.max(seat[i] / 2 + cfg.chassis.plate_margin_mm, pocket[i]),
  ) as HalfWidths;
}

/** A key's centre in plan. */
export const planCentre = (m: Matrix4): [number, number] => [m.elements[12], m.elements[13]];

/** Unit plan direction of a key's axis (0: x, 1: y). */
export const axisDir = (m: Matrix4, axis: number): [number, number] => {
  const e = m.elements;
  const l = Math.hypot(e[axis * 4], e[axis * 4 + 1]);
  return [e[axis * 4] / l, e[axis * 4 + 1] / l];
};

/**
 * The plates of keys ns, one sheet: which keys are neighbours across which
 * edge (pairs: [n, m, axis, sign] for n's edge facing m), and how far each
 * key's edges reach past its plate ([axis][side], side 0 for -, 1 for +):
 * wellReach where there is no neighbour, 0 where there is.
 */
export function plateEdges(cfg: Config, frames: Record<string, Matrix4>, ns: string[]) {
  const plateHalf = plateHalfWidths(cfg);
  /** Which of key n's edges faces key m: [axis, sign], if m is beside it across that edge. */
  const across = (n: string, m: string): [number, number] | undefined => {
    const [cn, cm] = [planCentre(frames[n]), planCentre(frames[m])];
    const d = [cm[0] - cn[0], cm[1] - cn[1]];
    for (const axis of [0, 1]) {
      const u = axisDir(frames[n], axis);
      const v = axisDir(frames[n], 1 - axis);
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

/**
 * PROTOTYPE (?plates=narrow): each finger plate's top is flat only to rim
 * past its switch seat on edges facing the well's wall, then slopes down at
 * slope degrees to plate thickness - 1 below it; from there on to the wall,
 * the plate is only its bottom 1 mm.
 */
export function narrowPlates(cfg: Config) {
  const c = cfg.chassis as { plate_style?: string; plate_slope?: number };
  return c.plate_style === 'narrow' ? { rim: 0.8, slope: c.plate_slope ?? 60 } : undefined;
}

/**
 * PROTOTYPE (?plates=facets): the finger well's plates are one floor, 3 mm
 * thick, whose top is each key's plate-top plane carried on until it meets its
 * neighbours' (the highest of them at each point), so each key has its own flat
 * face with creases between them, out to the well's wall.
 */
export function facetFloor(cfg: Config) {
  return (cfg.chassis as { plate_style?: string }).plate_style === 'facets';
}

/**
 * One well's plates as a sheet. cores: the plates alone; rest: their reaches
 * and joins, clipped to the well; rooms: the open space under them for the
 * tiles; below / top: everything under the sheet's underside / top, to cut
 * the other sheet's overlap; skirt: closes the step round the well's edge.
 */
export function sheet(
  M: ManifoldToplevel['Manifold'],
  cfg: Config,
  frames: Record<string, Matrix4>,
  ns: string[],
  well: CrossSection,
  narrow?: ReturnType<typeof narrowPlates>,
  facets = false,
) {
  const plateThickness = cfg.chassis.plate_thickness_mm;
  const plateHalf = plateHalfWidths(cfg);
  const seat = seatSettings(cfg).outer;
  const seatHalf: HalfWidths = [seat[0] / 2, seat[1] / 2];
  const keyPoint = (n: string, x: number, y: number, z: number): Vec3 =>
    point(frames[n], [x, y, z]);
  const { reach, pairs, across } = plateEdges(cfg, frames, ns);
  const span = (n: string, axis: number) => [
    -plateHalf[axis] - reach[n][axis][0],
    plateHalf[axis] + reach[n][axis][1],
  ];
  const box = (n: string, xs: number[], ys: number[], zs = [0, -plateThickness]) =>
    M.hull(xs.flatMap((x) => ys.flatMap((y) => zs.map((z) => keyPoint(n, x, y, z)))));
  // PROTOTYPE narrow plates: the plate's full thickness stands only within
  // top (at its top) and foot (where its slope ends, drop down); everything
  // else of the plate and its reaches is its bottom 1 mm, drop down and below.
  const drop = plateThickness - 1;
  const run = narrow ? drop / Math.tan((narrow.slope * Math.PI) / 180) : 0;
  const top = (n: string, axis: number, past = 0) =>
    [0, 1].map(
      (i) =>
        (2 * i - 1) *
        (narrow && reach[n][axis][i] ? seatHalf[axis] + narrow.rim + past : plateHalf[axis]),
    );
  const foot = (n: string, axis: number) => top(n, axis, run);
  // The raised part, given what it spans across each axis at its top and foot.
  const raised = (n: string, at: (k: 0 | 1, axis: number) => number[]) =>
    M.hull(
      (
        [
          [0, 0],
          [-drop, 1],
          [-plateThickness, 1],
        ] as const
      ).flatMap(([z, k]) => at(k, 0).flatMap((x) => at(k, 1).map((y) => keyPoint(n, x, y, z)))),
    );
  const plate = (n: string, xs: number[], ys: number[]) =>
    narrow
      ? raised(n, (k, axis) => (k ? foot : top)(n, axis)).add(
          box(n, xs, ys, [-drop, -plateThickness]),
        )
      : box(n, xs, ys);
  const parts = ns.map((n) => plate(n, span(n, 0), span(n, 1)));
  // Between neighbours: each side's strip from its seat edge to its plate
  // edge, along the whole edge and its reach, hulled together. Narrow, only
  // the bottom 1 mm runs along the whole edge; above it, the strip spans
  // only what the plate's raised part does.
  const strip = (n: string, axis: number, sign: number, upper: boolean) => {
    const acrossEdge = [sign * seatHalf[axis], sign * plateHalf[axis]];
    if (narrow && upper)
      return raised(n, (k, a) => (a === axis ? acrossEdge : (k ? foot : top)(n, a)));
    const along = span(n, 1 - axis);
    const zs = narrow ? [-drop, -plateThickness] : undefined;
    return axis ? box(n, along, acrossEdge, zs) : box(n, acrossEdge, along, zs);
  };
  for (const [n, m, axis, sign] of pairs)
    if (n < m) {
      const back = across(m, n);
      if (back)
        for (const upper of narrow ? [false, true] : [false])
          parts.push(M.hull([strip(n, axis, sign, upper), strip(m, back[0], back[1], upper)]));
    }
  // Where four keys meet, the hole between their corners filled, once per quad.
  for (const n of ns) {
    const nb = pairs.filter((p) => p[0] === n);
    for (const p of nb)
      for (const q of nb)
        if (p[2] === 0 && q[2] === 1) {
          // r[1] !== n: p's way back to n would make a 3-key hull.
          const diag = pairs.find(
            (r) => r[0] === p[1] && r[1] !== n && pairs.some((s) => s[0] === q[1] && s[1] === r[1]),
          );
          if (!diag) continue;
          const four = [n, p[1], q[1], diag[1]];
          // Each quad is reached from all four corners; only its smallest key builds it.
          if (four.some((k) => k < n)) continue;
          const target = four
            .map((k) => planCentre(frames[k]))
            .reduce((t, c) => [t[0] + c[0] / 4, t[1] + c[1] / 4], [0, 0]);
          parts.push(
            M.hull(
              four.flatMap((k) => {
                // The plate corner nearest the four's middle, and in from it.
                const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [sx, sy]));
                const [sx, sy] = corners.reduce((a, b) => {
                  const pa = keyPoint(k, a[0] * plateHalf[0], a[1] * plateHalf[1], 0);
                  const pb = keyPoint(k, b[0] * plateHalf[0], b[1] * plateHalf[1], 0);
                  return Math.hypot(pb[0] - target[0], pb[1] - target[1]) <
                    Math.hypot(pa[0] - target[0], pa[1] - target[1])
                    ? b
                    : a;
                });
                return [0, PLATES.cornerFill].flatMap((ix) =>
                  [0, PLATES.cornerFill].flatMap((iy) =>
                    [0, -plateThickness].map((z) =>
                      keyPoint(k, sx * (plateHalf[0] - ix), sy * (plateHalf[1] - iy), z),
                    ),
                  ),
                );
              }),
            ),
          );
        }
  }
  // Joins and fills stay in the gaps: none of them reaches above or below
  // a plate (into its keycap's room, or under its tile).
  const offPlate = M.union(
    ns.flatMap((n) =>
      [
        [0, 100],
        [-plateThickness, -100],
      ].map((zs) => box(n, span(n, 0), span(n, 1), zs)),
    ),
  );
  // Under each plate, down to the parting line: the well's wall stops at
  // the plates, so the tiles' edge pads open into the case's hollow. `out`
  // is how far the room runs on past an edge with no neighbour.
  const under = (n: string, axis: number, out: number) =>
    [0, 1].map((i) => (2 * i - 1) * (plateHalf[axis] + (reach[n][axis][i] ? out : 0)));
  // Straight down from each plate's underside, and hulled across each pair of
  // neighbours so the room runs on past the gaps between their edges.
  const roomTop = (n: string, out: number, z = -plateThickness) =>
    under(n, 0, out).flatMap((x) => under(n, 1, out).map((y) => keyPoint(n, x, y, z)));
  // Each key's column alone; hulled across a pair it would rise above the
  // join between them where the keys dish, so that is only for the shell.
  const column = (out: number, z?: number, depth?: number) =>
    M.union(ns.map((n) => M.hull(down(roomTop(n, out, z), depth))));
  const room = (out: number) =>
    column(out).add(
      M.union(
        pairs
          .filter(([n, m]) => n < m)
          .map(([n, m]) => M.hull(down([...roomTop(n, out), ...roomTop(m, out)]))),
      ),
    );
  const clip = prism(well.offset(PLATES.wellInto, 'Miter'));
  const wellSkirt = (z: number) =>
    column(PLATES.wellReach, z, PLATES.skirtDepth)
      .intersect(clip)
      .subtract(prism(well.offset(PLATES.wellInto - PLATES.skirt, 'Miter')));
  if (facets) {
    // A flat square 0.8 mm past each key's seat, straight strips between
    // neighbours and a patch where four keys meet; past the outer keys the
    // strips carry on level out to the well's wall.
    const cell: Record<string, number[]> = { [ns[0]]: [0, 0] };
    const todo = [ns[0]];
    while (todo.length) {
      const n = todo.pop()!;
      for (const [a, m, axis, sign] of pairs)
        if (a === n && !cell[m]) {
          cell[m] = [...cell[n]];
          cell[m][axis] += sign;
          todo.push(m);
        }
    }
    const at = new Map(ns.map((n) => [cell[n].join(','), n]));
    const lo = [0, 1].map((i) => Math.min(...ns.map((n) => cell[n][i])));
    const hi = [0, 1].map((i) => Math.max(...ns.map((n) => cell[n][i])));
    const flatHalf = [seatHalf[0] + 0.8, seatHalf[1] + 0.8];
    const OUT = 40;
    // Corner (sx, sy) of the cell at c, as the floor's top and underside. A
    // cell past the keys borrows the nearest key's corner facing it, carried
    // level outwards.
    const corner = (c: number[], sx: number, sy: number): [Vec3, Vec3] | undefined => {
      const k = c.map((v, i) => Math.min(hi[i], Math.max(lo[i], v)));
      const n = at.get(k.join(','));
      if (!n) return undefined;
      const o = c.map((v, i) => Math.sign(v - k[i]));
      const q = [o[0] || sx, o[1] || sy];
      const push = [0, 1].map(
        (i) => OUT * (o[0] * axisDir(frames[n], 0)[i] + o[1] * axisDir(frames[n], 1)[i]),
      );
      return [0, -plateThickness].map((z) => {
        const p = keyPoint(n, q[0] * flatHalf[0], q[1] * flatHalf[1], z);
        return [p[0] + push[0], p[1] + push[1], p[2]] as Vec3;
      }) as [Vec3, Vec3];
    };
    const pieces: [Vec3, Vec3][][] = [];
    const add = (ps: ([Vec3, Vec3] | undefined)[]) => {
      if (ps.every((p) => p)) pieces.push(ps as [Vec3, Vec3][]);
    };
    for (let c = lo[0] - 1; c <= hi[0]; c++)
      for (let r = lo[1] - 1; r <= hi[1]; r++) {
        const [a, b, d, e] = [
          [c, r],
          [c + 1, r],
          [c, r + 1],
          [c + 1, r + 1],
        ];
        if (at.has(a.join(',')))
          add([corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1)]);
        add([corner(a, 1, -1), corner(a, 1, 1), corner(b, -1, 1), corner(b, -1, -1)]);
        add([corner(a, -1, 1), corner(a, 1, 1), corner(d, 1, -1), corner(d, -1, -1)]);
        add([corner(a, 1, 1), corner(b, -1, 1), corner(e, -1, -1), corner(d, 1, -1)]);
      }
    // Everything under the pieces' tops (or undersides).
    const beneath = (side: number) =>
      M.union(
        pieces.map((ps) => {
          const top = ps.map((p) => p[side]);
          return M.hull([...top, ...top.map((p) => [p[0], p[1], p[2] - 200] as Vec3)]);
        }),
      );
    const below = beneath(0).intersect(clip);
    const underside = beneath(1);
    const floor = below.subtract(underside);
    return {
      cores: floor,
      rest: floor,
      // Only under the floor: above its underside the room would cut the
      // well's wall away above the floor, leaving a slot.
      rooms: room(PLATES.underRoom).intersect(underside),
      below,
      top: floor,
      skirt: wellSkirt(PLATES.skirtInto - plateThickness),
    };
  }
  return {
    // The plates alone, and their reaches and joins, thinner.
    cores: M.union(
      ns.map((n) => plate(n, [-plateHalf[0], plateHalf[0]], [-plateHalf[1], plateHalf[1]])),
    ),
    rest: M.union(parts.slice(ns.length))
      .subtract(offPlate)
      .add(M.union(parts.slice(0, ns.length)))
      .intersect(clip)
      .subtract(column(PLATES.wellReach, narrow ? -plateThickness : -PLATES.reachThickness)),
    rooms: room(PLATES.underRoom),
    // Everything under the sheet: its plates and reaches, out to its well,
    // and everything under its top.
    below: column(PLATES.wellReach).intersect(clip),
    top: column(PLATES.wellReach, 0).intersect(clip),
    // Round the well's edge, under the sheet: where the sheet stands above
    // what is outside the well, its skirt closes the step.
    skirt: wellSkirt(PLATES.skirtInto - (narrow ? plateThickness : PLATES.reachThickness)),
  };
}
