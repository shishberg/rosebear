// Chassis: the C64-styled shell (shell.ts) with the key plates in its wells,
// built from the key poses.
// The shell is a hollow case parted along a groove all round: the case above
// it, and the bottom section below, which is the base the adapter stands on.
// In each well the plates make one sheet: each key's plate, joined to its
// neighbours' edge to edge, and reaching out on its other edges to the wall
// round the well. Under every plate a tile pocket is kept clear, open below
// to the hollow, so the tiles can be soldered from below with the base off.
// Each tile is glued up against four L-shaped pads under its plate's corners,
// outside the switch's seat; the pads set its height, and the glue holds it
// when a switch is pressed into its socket. The ribbon leaves through the port
// panel on the finger bin's inner end.
//
// Terms:
//  tile         the small bought PCB under each switch (hotswap socket, LED, diode);
//  tile pocket  the space under a plate kept clear for the tile and its parts;
//  plate        the square a switch clips into, plate_thickness_mm thick and
//               plate_margin_mm past the switch seat on each side, or further if
//               needed to cover the tile and its clearance;
//  glue pad     an L under a plate corner that a tile's top is glued to;
//  well         an opening through the shell's deck that a group of keys sits in.
//
// Coordinates: "key coordinates" are a key's own frame, with the origin at the
// plate top's centre, x and y across the plate and z along its normal (up is
// positive). A "half-width" is a distance from the key's centre along its x or y
// axis. "Plan" means the world XY plane.
import type { CrossSection, Manifold, ManifoldToplevel, Vec3 } from 'manifold-3d';
import { Matrix4 } from 'three';
import {
  keycapEnvelope,
  isKey,
  isThumb,
  point,
  tileUnderside,
  type Config,
  type KeycapEnvelope,
} from './geometry';
import { seatSettings } from './seats';
import {
  PLATES,
  axisDir,
  plateEdges,
  plateHalfWidths,
  planCentre,
  tilePocketHalf,
  type HalfWidths,
} from './plates';
import { shell } from './shell';
import { wiring, type Wiring } from './wiring';

export interface ChassisResult {
  /** The case above the parting line, with the plates. */
  body: Manifold;
  /** The bottom section, below the parting line, with the adapter's mount. */
  base: Manifold;
  /** The port panel's dark insert, a separate part, with the ribbon's landing. */
  trim: Manifold;
  /** The port panel's end face, in world x. */
  panel: number;
  /** Where the case and the bottom section part. */
  split: number;
  /** For each key, the chassis its keycap's room (and the switch rim's) had to remove. */
  roomCuts: { name: string; cut: Manifold }[];
}

/** A keycap's envelope as a solid in key coordinates: the taper from its rest
 * height, and under it the base's footprint down to the floor. `box: false`
 * leaves the taper alone. */
export function keycapSolid(M: ManifoldToplevel['Manifold'], e: KeycapEnvelope, box = true) {
  const [x, y] = [e.base[0] / 2, e.base[1] / 2],
    taper = M.extrude(
      [
        [
          [-x, -y],
          [x, -y],
          [x, y],
          [-x, y],
        ],
      ],
      e.height,
      0,
      0,
      [e.top[0] / e.base[0], e.top[1] / e.base[1]],
    ).translate([0, 0, e.z0]);
  return box
    ? taper.add(
        M.cube([2 * x, 2 * y, e.z0 - e.floor], true).translate([0, 0, (e.z0 + e.floor) / 2]),
      )
    : taper;
}

/**
 * Construction sizes that are not in the config, in mm. Distances are in key
 * coordinates unless noted.
 */
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

export const SIZES = {
  /** The skirt round each well's edge, under its plates, is this thick (plan), */
  skirt: 1.2,
  /** and reaches this far down. */
  skirtDepth: 10,
  /** Skirts start this far up into the reach above them, */
  skirtInto: 0.5,
  /** stop this far above the parting line, */
  skirtFoot: 3.6,
  /** keep this far clear of a wire, and keep only pieces joined to the rest by at least this much (mm³), */
  skirtPiece: 0.5,
  skirtWireClear: 0.3,
  /** and keep this far clear of a tile's edge (plan): its edge pads, and a soldering iron's way up to them. */
  skirtClear: 1.5,
  /** Under a plate edge with no neighbour, the room for the tile's edge pads, their wires and a soldering iron reaches this far past the plate. */
  underRoom: 8,
  /** The plates reach this far into the wall round their well (plan). */
  wellInto: 0.5,
  /** At a corner where four keys meet, each key's share of the fill reaches this far in from its plate corner. */
  cornerFill: 3,
  /** The switch body and pins below the plate top: kept clear under the switch hole. */
  switchBelowPlate: 13,
  /** The keycap's room is this much wider than the cap plus its clearance, in total. */
  keycapRoomExtra: 0.2,
  /** Heights cut above the plate: the switch hole's and the keycap room's. */
  switchHoleHeight: 20,
  keycapRoomHeight: 60,
  /** Glue pads: each leg of the L runs in from the tile's edge to this far from the centre along it. */
  glueFrom: 4,
  /** Glue pads stay this far outside the switch seat, so nothing stands in its trim. */
  glueSeatGap: 0.1,
  /** Glue pads reach this far up into the plate. */
  glueInto: 0.3,
  /** The glue between a pad and the tile's top. */
  glueLayer: 0.15,
  /** The adapter's rests stand this far in from its hole edge. */
  adapterRestIn: 7,
} as const;

/**
 * The glue pads under a key's plate, in key coordinates: four Ls, one under
 * each corner, from the plate's underside down to the glue on the tile's top.
 * Each is two boxes, [centre, size].
 */
export function gluePads(cfg: Config) {
  const tile = cfg.tile;
  const seat = seatSettings(cfg).outer;
  const plate = cfg.chassis.plate_thickness_mm;
  const top = -plate + SIZES.glueInto;
  const bottom = -tile.plate_top_to_pcb_top_mm + SIZES.glueLayer;
  const boxes: { center: Vec3; size: Vec3 }[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const axis of [0, 1]) {
        // One leg runs along the tile's edge facing axis, from glueFrom out to the edge.
        const edge = tile.size_mm[axis] / 2;
        const inner = seat[axis] / 2 + SIZES.glueSeatGap;
        const along = tile.size_mm[1 - axis] / 2;
        const lo: number[] = [];
        const hi: number[] = [];
        lo[axis] = inner;
        hi[axis] = edge;
        lo[1 - axis] = SIZES.glueFrom;
        hi[1 - axis] = along;
        const s = [sx, sy];
        boxes.push({
          center: [(s[0] * (lo[0] + hi[0])) / 2, (s[1] * (lo[1] + hi[1])) / 2, (top + bottom) / 2],
          size: [hi[0] - lo[0], hi[1] - lo[1], top - bottom],
        });
      }
  return { boxes, top, bottom };
}

export function buildChassis(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
  // The wires and the shell, when the caller has made them already.
  wired: Wiring = wiring(cfg, frames),
  built = shell({ wasm, cfg, frames }),
): ChassisResult {
  const M = wasm.Manifold;
  const plateThickness = cfg.chassis.plate_thickness_mm;
  const keyNames = Object.keys(frames).filter(isKey);
  const tile = cfg.tile;
  const sw = cfg.switch;
  const place = (m: Manifold, f: Matrix4) => m.transform(f.elements as never);
  // Tile pocket: the tile, its components and the switch body, below the plate.
  const pocketDepth =
    -tileUnderside(cfg) +
    Math.max(0, ...tile.components.map((c) => c.size_mm[2] / 2 - c.center_mm[2])) +
    tile.component_clearance_mm;
  const pocketHalf = tilePocketHalf(cfg);
  const seat = seatSettings(cfg).outer;
  const seatHalf: HalfWidths = [seat[0] / 2, seat[1] / 2];
  const plateHalf = plateHalfWidths(cfg);
  const pockets = M.union(
    keyNames.flatMap((n) => [
      place(
        M.cube(
          [2 * pocketHalf[0], 2 * pocketHalf[1], pocketDepth - plateThickness],
          true,
        ).translate([0, 0, -(pocketDepth + plateThickness) / 2]),
        frames[n],
      ),
      place(
        M.cube(
          [
            sw.cutout_mm[0] + sw.cutout_clearance_mm,
            sw.cutout_mm[1] + sw.cutout_clearance_mm,
            SIZES.switchBelowPlate - plateThickness,
          ],
          true,
        ).translate([0, 0, -(SIZES.switchBelowPlate + plateThickness) / 2]),
        frames[n],
      ),
    ]),
  );

  const [fingerWell, thumbWell] = built.wells;

  // The plates, one sheet in each well.
  const keyPoint = (n: string, x: number, y: number, z: number): Vec3 =>
    point(frames[n], [x, y, z]);
  const sheet = (
    ns: string[],
    well: CrossSection,
    narrow?: ReturnType<typeof narrowPlates>,
    facets = false,
  ) => {
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
    // Where four keys meet, the hole between their corners filled.
    for (const n of ns) {
      const nb = pairs.filter((p) => p[0] === n);
      for (const p of nb)
        for (const q of nb)
          if (p[2] === 0 && q[2] === 1) {
            const diag = pairs.find(
              (r) => r[0] === p[1] && pairs.some((s) => s[0] === q[1] && s[1] === r[1]),
            );
            if (!diag) continue;
            const four = [n, p[1], q[1], diag[1]];
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
                  return [0, SIZES.cornerFill].flatMap((ix) =>
                    [0, SIZES.cornerFill].flatMap((iy) =>
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
        ].map((zs) =>
          M.hull(
            span(n, 0).flatMap((x) =>
              span(n, 1).flatMap((y) => zs.map((z) => keyPoint(n, x, y, z))),
            ),
          ),
        ),
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
    const down = (ps: Vec3[], depth = 80) =>
      ps.flatMap((p) => [p, [p[0], p[1], p[2] - depth] as Vec3]);
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
    const clip = well.offset(SIZES.wellInto, 'Miter').extrude(400).translate([0, 0, -1]);
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
        rooms: room(SIZES.underRoom).intersect(underside),
        below,
        top: floor,
        skirt: column(PLATES.wellReach, SIZES.skirtInto - plateThickness, SIZES.skirtDepth)
          .intersect(clip)
          .subtract(
            well
              .offset(SIZES.wellInto - SIZES.skirt, 'Miter')
              .extrude(400)
              .translate([0, 0, -1]),
          ),
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
      rooms: room(SIZES.underRoom),
      // Everything under the sheet: its plates and reaches, out to its well,
      // and everything under its top.
      below: column(PLATES.wellReach).intersect(clip),
      top: column(PLATES.wellReach, 0).intersect(clip),
      // Round the well's edge, under the sheet: where the sheet stands above
      // what is outside the well, its skirt closes the step.
      skirt: column(
        PLATES.wellReach,
        SIZES.skirtInto - (narrow ? plateThickness : PLATES.reachThickness),
        SIZES.skirtDepth,
      )
        .intersect(clip)
        .subtract(
          well
            .offset(SIZES.wellInto - SIZES.skirt, 'Miter')
            .extrude(400)
            .translate([0, 0, -1]),
        ),
    };
  };
  const [fingers, thumbs] = [
    sheet(
      keyNames.filter((n) => n.startsWith('matrix_')),
      fingerWell,
      narrowPlates(cfg),
      facetFloor(cfg),
    ),
    sheet(keyNames.filter(isThumb), thumbWell),
  ];
  // Each tile, its edge pads and a soldering iron's way up to them (along the
  // key's axis): kept clear of the skirts.
  const tileBottom = tileUnderside(cfg);
  const keepClear = M.union(
    keyNames.map((n) => {
      const [hx, hy] = pocketHalf.map((h) => h + SIZES.skirtClear);
      return M.hull(
        [-plateThickness, tileBottom, tileBottom - cfg.wiring.solder_access_mm[1]].flatMap((z) =>
          [-hx, hx].flatMap((x) =>
            [-hy, hy].flatMap((y) => {
              const p = point(frames[n], [x, y, z]);
              return [p, [p[0], p[1], p[2] - 80] as Vec3];
            }),
          ),
        ),
      );
    }),
  );
  // Skirts stop short of the parting line, as the walls round the wells do.
  const aboveFoot = M.cube([1000, 1000, 400]).translate([
    -500,
    -500,
    built.split + SIZES.skirtFoot,
  ]);
  const bounds = built.body.boundingBox();
  const aboveSplit = M.cube([1000, 1000, bounds.max[2] - built.split + 1]).translate([
    -500,
    -500,
    built.split,
  ]);
  // The case, open under the plates.
  const case_ = built.body.subtract(
    M.union([fingers.rooms, thumbs.rooms]).intersect(aboveSplit).intersect(built.inside),
  );
  const sheets = M.union([fingers.cores, thumbs.cores, fingers.rest, thumbs.rest, case_]);
  // Each skirt stops on the other sheet, is notched where the wires pass (with
  // clearance), and any piece of one the notches leave standing on its own is
  // dropped.
  const unnotched = M.union([
    fingers.skirt.subtract(thumbs.top),
    thumbs.skirt.subtract(fingers.top),
  ])
    .intersect(aboveFoot)
    .subtract(keepClear);
  // Only the wires' segments that come near a skirt notch it: a union of every
  // segment would cost more than everything else here.
  const near = unnotched.decompose().map((p) => p.boundingBox());
  const wireWays = M.union(
    wired.wires.flatMap((w) => {
      const r = w.diameter / 2 + SIZES.skirtWireClear;
      return w.points.slice(1).flatMap((q, i) => {
        const p = w.points[i];
        const reaches = near.some((b) =>
          [0, 1, 2].every(
            (k) => Math.min(p[k], q[k]) - r <= b.max[k] && Math.max(p[k], q[k]) + r >= b.min[k],
          ),
        );
        return reaches ? [M.hull([p, q].map((c) => M.sphere(r, 8).translate(c as Vec3)))] : [];
      });
    }),
  );
  const skirts = M.union(
    unnotched
      .subtract(wireWays)
      .decompose()
      .filter((p) => p.intersect(sheets).volume() > SIZES.skirtPiece),
  );
  // Neither well's reaches and joins run on in under the other's sheet.
  const plates = M.union([
    fingers.cores,
    thumbs.cores,
    fingers.rest.subtract(thumbs.below),
    thumbs.rest.subtract(fingers.below),
    skirts,
  ]);
  const solid = case_.add(plates);
  const glue = gluePads(cfg);
  const pads = M.union(
    keyNames.flatMap((n) =>
      glue.boxes.map((b) => place(M.cube(b.size, true).translate(b.center), frames[n])),
    ),
  );
  const uncarved = solid.subtract(pockets).add(pads);
  // Room above each plate: the switch hole, the switch housing's rim up to the
  // keycap's lowest point, and the keycap with its clearance above that (a
  // box, the cap's base wide, well above it). What it removes from where the
  // rim and the keycap go (tapered as measured, from pressed to rest, with its
  // clearance) is kept for the checks: it is chassis that was built where a
  // keycap goes. (The box's corners above the cap's taper are not.)
  const capLowest = Math.max(0, sw.keycap_bottom_above_plate_mm - sw.travel_mm);
  const roomCuts: { name: string; cut: Manifold }[] = [];
  const cutters: Manifold[] = [];
  for (const n of keyNames) {
    const env = keycapEnvelope(cfg, n, { clampFloor: true });
    const room = place(
      M.cube(
        [
          env.base[0] + SIZES.keycapRoomExtra,
          env.base[1] + SIZES.keycapRoomExtra,
          SIZES.keycapRoomHeight,
        ],
        true,
      ).translate([0, 0, capLowest + SIZES.keycapRoomHeight / 2]),
      frames[n],
    );
    const rim =
      capLowest > 0.1
        ? place(
            M.cube([seat[0], seat[1], capLowest], true).translate([0, 0, capLowest / 2]),
            frames[n],
          )
        : undefined;
    const keycapRoom = rim ? room.add(rim) : room;
    const capGoes = place(keycapSolid(M, env), frames[n]);
    roomCuts.push({ name: n, cut: uncarved.intersect(rim ? capGoes.add(rim) : capGoes) });
    cutters.push(
      place(M.cube([...sw.cutout_mm, SIZES.switchHoleHeight] as Vec3, true), frames[n]),
      keycapRoom,
    );
  }
  // All at once: one boolean against the whole case, not two per key.
  const whole = uncarved.subtract(M.union(cutters));
  // The case above the parting groove's bottom, and the bottom section below
  // it with the adapter's mount, less the ribbon's slot.
  const bb = whole.boundingBox();
  const below = M.cube([
    bb.max[0] - bb.min[0] + 40,
    bb.max[1] - bb.min[1] + 40,
    built.split + 1,
  ]).translate([bb.min[0] - 20, bb.min[1] - 20, -1]);
  const base = whole
    .intersect(below)
    .add(adapterMount(wasm, cfg, frames))
    .subtract(built.slot);
  return {
    body: whole.subtract(below),
    base,
    trim: built.trim,
    panel: built.panel,
    split: built.split,
    roomCuts,
  };
}

/**
 * The adapter's mount on the bottom section: a boss with a peg through each of
 * its mounting holes and two rests under its other end. Each reaches half a
 * millimetre into the floor.
 */
function adapterMount(wasm: ManifoldToplevel, cfg: Config, frames: Record<string, Matrix4>) {
  const M = wasm.Manifold;
  const a = cfg.adapter;
  const [bx, by, bz] = a.board_mm;
  const into = 0.5;
  const post = (x: number, y: number, d: number, top: number) =>
    M.cylinder(top + a.standoff_mm + into, d / 2, d / 2, 32).translate([
      x,
      y,
      -a.standoff_mm - into,
    ]);
  return M.union([
    ...a.mounting_holes_mm.flatMap(([x, y]) => [
      post(x, y, a.boss_diameter_mm, 0),
      post(x, y, a.peg_diameter_mm, bz + a.peg_above_mm),
    ]),
    ...[-1, 1].map((s) =>
      post(bx / 2 - SIZES.adapterRestIn, s * (by / 2 - 2), a.rest_diameter_mm, 0),
    ),
  ]).transform(frames.adapter.elements as never);
}
