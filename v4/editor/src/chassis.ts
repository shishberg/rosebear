// Chassis: Skeletyl-style construction with swept ends, built from the key poses.
// Each finger column is a ladder of switch plates.
// Across the back and across the front of the columns runs one swept end: a
// quarter round swept along a smooth curve through the column ends, then a wall
// to the base. Round-bottomed slots part the columns down to half that wall's
// height. The thumb rows use the same construction, running left to right. The
// outside edges without a swept end are walls, one segment under each key,
// parted by U slots. Low ribs join the thumb rows and the fingers along the
// base. Nothing is built into a tile pocket. The whole case stands on a flat
// base plate cut to its own footprint.
//
// Terms:
//  tile         the small bought PCB under each switch (hotswap socket, LED, diode);
//  tile pocket  the space under a plate kept clear for the tile and its parts;
//  plate        the square frame a switch clips into, plate_thickness_mm thick and
//               plate_margin_mm past the switch seat on each side (the tile below
//               may reach past it);
//  ladder       a row of plates joined edge to edge;
//  swept end    one quarter round swept along a curve through a row of keys' end
//               edges, then a wall to the base;
//  wall         a slab from a key's plate edge that follows the plate's tilt down
//               past the tile pocket, just outside it, then drops vertically to
//               the base. The plate widens to meet it.
//
// Coordinates: "key coordinates" are a key's own frame, with the origin at the
// plate top's centre, x and y across the plate and z along its normal (up is
// positive). A "half-width" is a distance from the key's centre along its x or y
// axis. "Plan" means the world XY plane.
import type { Manifold, ManifoldToplevel, Vec3 } from 'manifold-3d';
import { Matrix4 } from 'three';
import { point, ROWS, type Config } from './geometry';

export const isKey = (name: string) => name.startsWith('thumb_') || name.startsWith('matrix_');
export const capSize = (c: Config, n: string) =>
  ((c.switch.keycap_overrides_mm as Record<string, number[]>)[n] || c.switch.keycap_mm) as Vec3;
export interface ChassisResult {
  body: Manifold;
  base: Manifold;
  pod: Manifold;
  pocketCut: Manifold;
}

/** A plan vector or direction, [x, y] in world coordinates. */
type Plan = [number, number];
/** A pair of half-widths, [x, y] in key coordinates. */
type HalfWidths = [number, number];
/** A plate corner, as signs (+1 or -1) along the key's x and y axes. */
type Corner = [number, number];
/** A plate edge: its two corners. Both share the sign on the axis the edge faces. */
type Edge = [Corner, Corner];
/** The key axis (0 for x, 1 for y) an edge faces along. */
const facingAxis = (edge: Edge) => (edge[0][0] === edge[1][0] ? 0 : 1);

/** A wall strip's four points at one corner of its edge. */
interface StripEnd {
  topInner: Vec3;
  topOuter: Vec3;
  bottomInner: Vec3;
  bottomOuter: Vec3;
}
/** A wall strip along a plate edge: its ends at the edge's two corners. */
type Strip = [StripEnd, StripEnd];
const endPoints = (e: StripEnd) => [e.topInner, e.topOuter, e.bottomInner, e.bottomOuter];
const stripPoints = (s: Strip) => s.flatMap(endPoints);
const mapStrip = (s: Strip, f: (p: Vec3) => Vec3) =>
  s.map((e) => ({
    topInner: f(e.topInner),
    topOuter: f(e.topOuter),
    bottomInner: f(e.bottomInner),
    bottomOuter: f(e.bottomOuter),
  })) as Strip;
const planDistance = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
/** The end of a strip nearest a plan point. */
const endNearest = (s: Strip, p: number[]) =>
  planDistance(s[0].topInner, p) < planDistance(s[1].topInner, p) ? s[0] : s[1];

/** A wall on one side of a key: which side, and its faces' half-widths. */
interface Wall {
  axis: number;
  side: number;
  inner: number;
  outer: number;
}

/**
 * A smooth plan curve across the facing edges of a row of end keys. Positions
 * on it are given as `s`, the distance along `side`, and `out`, the distance
 * along `outward`.
 */
interface EndCurve {
  /** Unit vector: the mean direction the end keys face. */
  outward: Plan;
  /** Unit vector across it. */
  side: Plan;
  /** How far out the quarter round's outer face is, at position s. */
  outerAt: (s: number) => number;
  /** The end keys' plate corners on the curve's side, by end key index. */
  corners: { s: number; out: number; z: number; key: number }[];
}

/**
 * The cap closing one open end of a swept end: the quarter round's profile,
 * wall_mm thick, and the same points dropped to the base.
 */
interface Cap {
  /** Seven angles from the top down, two points (inner, outer) at each. */
  round: Vec3[];
  onBase: Vec3[];
}
const capPoints = (cap: Cap) => [...cap.round, ...cap.onBase];

interface SweptEnd {
  solid: Manifold;
  caps: Cap[];
  /** Points along the base on the wall's mid-line, for ribs. */
  baseLine: Vec3[];
}

/** One key's wall, as strips along its plate edge. */
interface WallSegment {
  /** The tilted part: from the plate top down to the tile pocket's depth. */
  tilted: Strip;
  /** The tilted part, carried along the edge to just past the tile pocket. */
  tiltedLong: Strip;
  /** At the plate's underside. */
  underPlate: Strip;
  /** At the tile pocket's depth, where the drop to the base starts. */
  dropTop: Strip;
  /** dropTop, moved down to the base. */
  onBase: Strip;
}

export function buildChassis(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
): ChassisResult {
  const M = wasm.Manifold;
  const CS = wasm.CrossSection;
  const chassis = cfg.chassis;
  const plateThickness = chassis.plate_thickness_mm;
  const plateMargin = chassis.plate_margin_mm;
  const wallThickness = chassis.wall_mm;
  const endRadius = chassis.end_radius_mm;
  const endCut = chassis.end_cut_mm;
  const layout = cfg.geometry;
  const columns = layout.columns.map((c) => c.name);
  const keyNames = Object.keys(frames).filter(isKey);
  const byX = (ns: string[]) => ns.sort((a, b) => frames[a].elements[12] - frames[b].elements[12]);
  const thumbRow = byX(layout.thumb.keys.map((k) => 'thumb_' + k.name));
  const extraRow = byX(
    ((layout as { thumb_extra?: { keys: { name: string }[] } }).thumb_extra?.keys ?? []).map(
      (k) => 'thumb_' + k.name,
    ),
  );
  const columnKeys = (c: string) => ROWS.map((r) => `matrix_${c}_${r}`);

  // Sizes in key coordinates.
  const tile = cfg.tile;
  const sw = cfg.switch;
  // Tile pocket: the tile, its components and the switch body, below the plate.
  const pocketDepth =
    tile.plate_top_to_pcb_top_mm +
    tile.size_mm[2] +
    Math.max(0, ...tile.components.map((c) => c.size_mm[2] / 2 - c.center_mm[2])) +
    tile.component_clearance_mm;
  const pocketHalf: HalfWidths = [
    tile.size_mm[0] / 2 + tile.clearance_mm,
    tile.size_mm[1] / 2 + tile.clearance_mm,
  ];
  const switchHole = sw.cutout_mm.map((x) => x + sw.cutout_clearance_mm);
  const seat = sw.seat_outer_mm ?? [16.6, 16.6];
  const seatHalf: HalfWidths = [seat[0] / 2, seat[1] / 2];
  const plateHalf: HalfWidths = [seatHalf[0] + plateMargin, seatHalf[1] + plateMargin];

  const wallsByKey = new Map<string, Wall[]>();
  /** Half-widths of key n's plate toward a corner: out to a wall's outer face on a walled side. */
  const plateHalfAt = (n: string, [sx, sy]: Corner): HalfWidths => {
    const half: HalfWidths = [plateHalf[0], plateHalf[1]];
    for (const w of wallsByKey.get(n) ?? [])
      if ((w.axis ? sy : sx) === w.side) half[w.axis] = w.outer;
    return half;
  };
  /** World point on key n: toward a corner by the given half-widths, z along the normal. */
  const keyPoint = (n: string, [sx, sy]: Corner, z: number, half: HalfWidths): Vec3 =>
    point(frames[n], [sx * half[0], sy * half[1], z]);
  const keyCentre = (n: string): Plan => [frames[n].elements[12], frames[n].elements[13]];
  const place = (m: Manifold, f: Matrix4) => m.transform(f.elements as never);
  const atHeight = (p: Vec3, z = 0): Vec3 => [p[0], p[1], z];
  const withBase = (ps: Vec3[]) => [...ps, ...ps.map((p) => atHeight(p, 1))];

  /** The plate edge of key n that faces a plan direction. */
  const edgeFacing = (n: string, dir: Plan): Edge => {
    const m = frames[n].elements;
    const edges: Edge[] = [
      [
        [1, -1],
        [1, 1],
      ],
      [
        [-1, -1],
        [-1, 1],
      ],
      [
        [-1, 1],
        [1, 1],
      ],
      [
        [-1, -1],
        [1, -1],
      ],
    ];
    const score = (e: Edge) => {
      const sx = (e[0][0] + e[1][0]) / 2;
      const sy = (e[0][1] + e[1][1]) / 2;
      return (m[0] * sx + m[4] * sy) * dir[0] + (m[1] * sx + m[5] * sy) * dir[1];
    };
    return edges.reduce((a, b) => (score(b) > score(a) ? b : a));
  };
  /**
   * A strip along a plate edge: from zTop down to zBottom along the key normal,
   * and from half-width `inner` to `outer` across the edge. Along the edge it
   * runs to the plate's corners, or to half-width `along`.
   */
  const strip = (
    n: string,
    edge: Edge,
    zTop: number,
    zBottom: number,
    inner: number,
    outer: number,
    along?: number,
  ): Strip => {
    const axis = facingAxis(edge);
    return edge.map((corner) => {
      const alongHalf = along ?? plateHalfAt(n, corner)[1 - axis];
      const at = (z: number, across: number) =>
        keyPoint(n, corner, z, axis ? [alongHalf, across] : [across, alongHalf]);
      return {
        topInner: at(zTop, inner),
        topOuter: at(zTop, outer),
        bottomInner: at(zBottom, inner),
        bottomOuter: at(zBottom, outer),
      };
    }) as Strip;
  };
  /** Register a wall on the side of key n facing dir, its inner face just outside the tile pocket. */
  const addWall = (n: string, dir: Plan) => {
    const edge = edgeFacing(n, dir);
    const axis = facingAxis(edge);
    const inner = pocketHalf[axis] + 0.25;
    wallsByKey.set(n, [
      ...(wallsByKey.get(n) ?? []),
      { axis, side: edge[0][axis], inner, outer: inner + wallThickness },
    ]);
  };
  const wallAt = (n: string, edge: Edge) =>
    (wallsByKey.get(n) ?? []).find(
      (w) => w.axis === facingAxis(edge) && w.side === edge[0][facingAxis(edge)],
    );
  const planToward = (a: string, b: string): Plan => {
    const p = keyCentre(a);
    const q = keyCentre(b);
    return [q[0] - p[0], q[1] - p[1]];
  };
  /** A row of plates joined edge to edge. */
  const ladder = (ns: string[]) => {
    const parts: Manifold[] = [];
    for (const n of ns)
      parts.push(
        M.hull(
          [-1, 1].flatMap((sx) =>
            [-1, 1].flatMap((sy) =>
              [0, -plateThickness].map((z) => keyPoint(n, [sx, sy], z, plateHalfAt(n, [sx, sy]))),
            ),
          ),
        ),
      );
    // The gap between neighbours: each side's strip from its seat edge to its plate edge.
    const gapSide = (n: string, other: string) => {
      const edge = edgeFacing(n, planToward(n, other));
      const axis = facingAxis(edge);
      return stripPoints(strip(n, edge, 0, -plateThickness, seatHalf[axis], plateHalf[axis]));
    };
    for (let i = 0; i + 1 < ns.length; i++)
      parts.push(M.hull([...gapSide(ns[i], ns[i + 1]), ...gapSide(ns[i + 1], ns[i])]));
    return M.union(parts);
  };
  /** Unit plan vector from key n's centre toward the middle of one of its edges. */
  const edgeDirection = (n: string, edge: Edge): Plan => {
    const facesX = edge[0][0] === edge[1][0];
    const sign = facesX ? edge[0][0] : edge[0][1];
    const o = point(frames[n], [0, 0, 0]);
    const a = point(frames[n], facesX ? [sign, 0, 0] : [0, sign, 0]);
    const l = planDistance(a, o);
    return [(a[0] - o[0]) / l, (a[1] - o[1]) / l];
  };
  /**
   * The curve for a swept end across the facing edges of a row of end keys: a
   * quadratic least-squares fit through the end corners pushed out by the end
   * radius, then moved out until the quarter round starts past every tile pocket
   * (the plates reach out flat to meet it) and is at least radius - end_cut
   * past every plate corner.
   */
  const endCurve = (ends: string[], facing: Plan): EndCurve => {
    const edges = ends.map((n) => edgeFacing(n, facing));
    const sum = ends
      .map((n, i) => edgeDirection(n, edges[i]))
      .reduce((a, d) => [a[0] + d[0], a[1] + d[1]], [0, 0]);
    const l = Math.hypot(sum[0], sum[1]);
    const outward: Plan = [sum[0] / l, sum[1] / l];
    const side: Plan = [-outward[1], outward[0]];
    const alongSide = (p: number[]) => p[0] * side[0] + p[1] * side[1];
    const alongOut = (p: number[]) => p[0] * outward[0] + p[1] * outward[1];
    const corners = ends.flatMap((n, key) =>
      edges[key].map((corner) => {
        const p = keyPoint(n, corner, 0, plateHalfAt(n, corner));
        return { s: alongSide(p), out: alongOut(p), z: p[2], key };
      }),
    );
    // Normal equations for out + radius = c0 + c1 s + c2 s^2.
    const moment = (power: number, ofOut = false) =>
      corners.reduce((t, q) => t + q.s ** power * (ofOut ? q.out + endRadius : 1), 0);
    const A = [
      [moment(0), moment(1), moment(2)],
      [moment(1), moment(2), moment(3)],
      [moment(2), moment(3), moment(4)],
    ];
    const b = [moment(0, true), moment(1, true), moment(2, true)];
    const det = (m: number[][]) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    // One key: its edge is square to the roll, so the curve is a straight line along it.
    const coef =
      ends.length < 2
        ? [moment(0, true) / moment(0), 0, 0]
        : [0, 1, 2].map(
            (j) => det(A.map((r, i) => r.map((v, jj) => (jj === j ? b[i] : v)))) / det(A),
          );
    const fitted = (s: number) => coef[0] + coef[1] * s + coef[2] * s * s;
    const pocketCorners = ends.flatMap((n, key) =>
      edges[key].flatMap((corner) =>
        [-plateThickness, -pocketDepth].map((z) => keyPoint(n, corner, z, pocketHalf)),
      ),
    );
    const shift = Math.max(
      0,
      ...corners.map((q) => q.out + endRadius - endCut - fitted(q.s)),
      ...pocketCorners.map((p) => alongOut(p) + 0.1 + endRadius - fitted(alongSide(p))),
    );
    return { outward, side, outerAt: (s) => fitted(s) + shift, corners };
  };
  const curvePoint = (curve: EndCurve, s: number, out: number, z: number): Vec3 => [
    curve.side[0] * s + curve.outward[0] * out,
    curve.side[1] * s + curve.outward[1] * out,
    z,
  ];
  /**
   * A swept end along a curve. The quarter round's top follows the end keys'
   * heights (linear between corners). Each key's surface continues flat out to
   * it. With slots, round-bottomed slots part neighbouring keys down to half the
   * wall height.
   */
  const sweptEnd = (
    curve: EndCurve,
    ends: string[],
    facing: Plan,
    withSlots: boolean,
  ): SweptEnd => {
    const sorted = [...curve.corners].sort((x, y) => x.s - y.s);
    const sStart = sorted[0].s;
    const sEnd = sorted.at(-1)!.s;
    const topAt = (s: number) => {
      for (let i = 0; i + 1 < sorted.length; i++)
        if (s <= sorted[i + 1].s) {
          const t = (s - sorted[i].s) / (sorted[i + 1].s - sorted[i].s || 1);
          return sorted[i].z * (1 - t) + sorted[i + 1].z * t;
        }
      return sorted.at(-1)!.z;
    };
    // Where the sweep is sampled: every corner, and every 3 mm between.
    const stations = [
      ...new Set([
        ...sorted.map((q) => q.s),
        ...Array.from({ length: Math.ceil((sEnd - sStart) / 3) }, (_, i) => sStart + i * 3),
      ]),
    ].sort((x, y) => x - y);
    /** A point on the quarter round at s: angle from the top, distance from its centre. */
    const roundPoint = (s: number, angle: number, r: number) =>
      curvePoint(
        curve,
        s,
        curve.outerAt(s) - endRadius + r * Math.sin(angle),
        topAt(s) - endRadius + r * Math.cos(angle),
      );
    const inner = endRadius - wallThickness;
    const pieces: Manifold[] = [];
    for (let i = 0; i + 1 < stations.length; i++) {
      const pair = [stations[i], stations[i + 1]];
      for (let j = 0; j < 6; j++) {
        const from = ((j / 6) * Math.PI) / 2;
        const to = (((j + 1) / 6) * Math.PI) / 2;
        pieces.push(
          M.hull(
            pair.flatMap((s) => [
              roundPoint(s, from, endRadius),
              roundPoint(s, from, inner),
              roundPoint(s, to, endRadius),
              roundPoint(s, to, inner),
            ]),
          ),
        );
      }
      // The wall from the bottom of the round down to the base.
      pieces.push(
        M.hull(
          pair
            .flatMap((s) => [
              roundPoint(s, Math.PI / 2, endRadius),
              roundPoint(s, Math.PI / 2, inner),
            ])
            .flatMap((p) => [p, atHeight(p, 1)]),
        ),
      );
    }
    // Flat continuation of each end key out to the swept end, 0.5 mm into it.
    ends.forEach((n, key) => {
      const edge = edgeFacing(n, facing);
      const onCurve = curve.corners.filter((x) => x.key === key);
      pieces.push(
        M.hull([
          ...edge.flatMap((corner) => [
            keyPoint(n, corner, 0, plateHalfAt(n, corner)),
            keyPoint(n, corner, -wallThickness, plateHalfAt(n, corner)),
          ]),
          ...onCurve.flatMap((x) => [
            curvePoint(curve, x.s, curve.outerAt(x.s) - endRadius + 0.5, x.z),
            curvePoint(curve, x.s, curve.outerAt(x.s) - endRadius + 0.5, x.z - wallThickness),
          ]),
        ]),
      );
    });
    let solid = M.union(pieces);
    if (withSlots)
      for (let key = 0; key + 1 < ends.length; key++) {
        // The corner of end key k nearest end key `other`.
        const cornerToward = (k: number, other: number) => {
          const mid = curve.corners.filter((x) => x.key === other).reduce((t, x) => t + x.s / 2, 0);
          return curve.corners
            .filter((x) => x.key === k)
            .sort((x, y) => Math.abs(x.s - mid) - Math.abs(y.s - mid))[0];
        };
        const left = cornerToward(key, key + 1);
        const right = cornerToward(key + 1, key);
        const sMid = (left.s + right.s) / 2;
        const halfWidth = Math.max(1.5, Math.abs(right.s - left.s) / 2);
        const bottomZ = 1 + (Math.min(topAt(left.s), topAt(right.s)) - endRadius - 1) / 2;
        const outFrom = Math.min(curve.outerAt(left.s), curve.outerAt(right.s)) - endRadius - 0.2;
        const outTo = Math.max(curve.outerAt(left.s), curve.outerAt(right.s)) + 3;
        // Round-bottomed slot: balls at the bottom, hulled with the top.
        const ball = (out: number) =>
          M.sphere(halfWidth, 16).translate(curvePoint(curve, sMid, out, bottomZ + halfWidth));
        solid = solid.subtract(
          M.hull([
            ball(outFrom),
            ball(outTo),
            ...[outFrom, outTo].flatMap((out) =>
              [-halfWidth, halfWidth].map((ds) => curvePoint(curve, sMid + ds, out, 120)),
            ),
          ]),
        );
      }
    const caps = [
      [sStart, 1],
      [sEnd, -1],
    ].map(([s, sign]) => {
      const round = [0, 1, 2, 3, 4, 5, 6].flatMap((j) =>
        [0, wallThickness].map((ds) =>
          roundPoint(s + sign * ds, ((j / 6) * Math.PI) / 2, endRadius),
        ),
      );
      return { round, onBase: round.map((p) => atHeight(p, 1)) };
    });
    return {
      solid,
      caps,
      baseLine: stations.map((s) => curvePoint(curve, s, curve.outerAt(s) - wallThickness / 2, 1)),
    };
  };

  // Walls: the inner and pinky columns' outer sides, the thumb rows' fronts, and
  // the back of an extra thumb row close in front of the main one.
  const facingCorners = (ns: string[], dir: Plan) =>
    ns.flatMap((n) => edgeFacing(n, dir).map((corner) => keyPoint(n, corner, 0, plateHalf)));
  const extraRowClose =
    thumbRow.length > 0 &&
    extraRow.length > 0 &&
    Math.min(
      ...facingCorners(thumbRow, [0, -1]).flatMap((p) =>
        facingCorners(extraRow, [0, 1]).map((q) => planDistance(p, q)),
      ),
    ) < 15;
  const outerColumns: [string, Plan][] = [
    [columns[0], [-1, 0]],
    [columns.at(-1)!, [1, 0]],
  ];
  for (const [c, dir] of outerColumns) for (const n of columnKeys(c)) addWall(n, dir);
  for (const n of [...thumbRow, ...extraRow]) addWall(n, [0, -1]);
  if (extraRowClose) for (const n of extraRow) addWall(n, [0, 1]);

  const parts: Manifold[] = [];
  for (const c of columns) parts.push(ladder(columnKeys(c)));
  // Swept ends across the back (top row) and front (bottom row) of the columns.
  const fingerEnds = (['top', 'bottom'] as const).map((row) => {
    const ns = columns.map((c) => `matrix_${c}_${row}`);
    const facing: Plan = [0, row === 'bottom' ? -1 : 1];
    return sweptEnd(endCurve(ns, facing), ns, facing, true);
  });
  // Thumb rows: a ladder whose two ends (left, then right) roll over as swept ends.
  const thumbRowEnds = [thumbRow, extraRow].map((row) => {
    if (!row.length) return [];
    parts.push(ladder(row));
    if (row.length < 2) return [];
    return [
      [row[0], row[1]],
      [row.at(-1)!, row.at(-2)!],
    ].map(([n, neighbour]) => {
      const facing = planToward(neighbour, n);
      return sweptEnd(endCurve([n], facing), [n], facing, false);
    });
  });
  for (const s of [...fingerEnds, ...thumbRowEnds.flat()]) parts.push(s.solid);

  // A run of walls along one side of a row of keys: one segment per key, joined
  // at the base and at the plate, with a U slot between neighbours from half
  // height up to just under the plates. An end segment takes in the cap that
  // closes the quarter round of a swept end beside it. Each segment follows its
  // plate's tilt down to the tile pocket's depth, then drops to the base.
  const usedCaps = new Set<Cap>();
  const wallRun = (ns: string[], dir: Plan, caps: Cap[]) => {
    // Each segment is two hulls, the tilted part and the drop, so neither
    // reaches into the tile pocket on a rolled key.
    const segments: WallSegment[] = ns.map((n) => {
      const edge = edgeFacing(n, dir);
      const wall = wallAt(n, edge)!;
      const axis = facingAxis(edge);
      const dropTop = strip(n, edge, -pocketDepth, -pocketDepth, wall.inner, wall.outer);
      return {
        tilted: strip(n, edge, 0, -pocketDepth, wall.inner, wall.outer),
        tiltedLong: strip(
          n,
          edge,
          0,
          -pocketDepth,
          wall.inner,
          wall.outer,
          pocketHalf[1 - axis] + 0.25,
        ),
        underPlate: strip(n, edge, -plateThickness, -plateThickness, wall.inner, wall.outer),
        dropTop,
        onBase: mapStrip(dropTop, (p) => atHeight(p, 1)),
      };
    });
    const pieces = segments.flatMap((s) => [
      M.hull(stripPoints(s.tilted)),
      M.hull([...stripPoints(s.dropTop), ...stripPoints(s.onBase)]),
    ]);
    const slots: Manifold[] = [];
    for (const i of new Set([0, ns.length - 1]))
      for (const cap of caps) {
        const s = segments[i];
        const anchor = cap.round[0];
        if (
          usedCaps.has(cap) ||
          Math.min(...stripPoints(s.tilted).map((p) => planDistance(p, anchor))) >= 8
        )
          continue;
        usedCaps.add(cap);
        // The cap's quarter round joins the tilted part, carried along past the
        // tile pocket; its drop to the base joins the segment's drop.
        const near = (strip: Strip) => endPoints(endNearest(strip, anchor));
        pieces.push(
          M.hull([...near(s.tilted), ...near(s.tiltedLong)]),
          M.hull([...near(s.tiltedLong), ...cap.round]),
          M.hull([...near(s.dropTop), ...near(s.onBase), ...cap.round.slice(-2), ...cap.onBase]),
        );
      }
    for (let i = 0; i + 1 < ns.length; i++) {
      const a = segments[i];
      const b = segments[i + 1];
      // The end of each strip at the joint: the one toward the other key.
      const atA = (strip: Strip) => endNearest(strip, keyCentre(ns[i + 1]));
      const atB = (strip: Strip) => endNearest(strip, keyCentre(ns[i]));
      const joint = [...endPoints(atA(a.tilted)), ...endPoints(atB(b.tilted))];
      pieces.push(
        M.hull(joint),
        M.hull([
          ...endPoints(atA(a.dropTop)),
          ...endPoints(atA(a.onBase)),
          ...endPoints(atB(b.dropTop)),
          ...endPoints(atB(b.onBase)),
        ]),
      );
      // No slot where the two edges are offset across the wall (a 1.5u key beside
      // 1u keys): the joint is then a diagonal wall. The slot is 2 halfWidth wide,
      // centred between the two keys; its top follows the plates' undersides
      // between their corners, 0.8 mm below them.
      const halfWidth = 3;
      const underA = atA(a.underPlate);
      const underB = atB(b.underPlate);
      const pa = underA.topOuter;
      const pb = underB.topOuter;
      const gap = planDistance(pb, pa) || 1;
      const pointsA = endPoints(underA);
      const pointsB = endPoints(underB);
      const tops = [0.5 - halfWidth / gap, 0.5 + halfWidth / gap].flatMap((t) =>
        pointsA.map(
          (p, q) =>
            [
              p[0] + (pointsB[q][0] - p[0]) * t,
              p[1] + (pointsB[q][1] - p[1]) * t,
              p[2] + (pointsB[q][2] - p[2]) * t - 0.8,
            ] as Vec3,
        ),
      );
      // The round bottom's centre, at half the slot top's lowest height.
      const roundZ = Math.min(...tops.map((p) => p[2])) / 2;
      const wallNormal = [
        underA.topOuter[0] - underA.topInner[0],
        underA.topOuter[1] - underA.topInner[1],
      ];
      const offsetAcross =
        Math.abs((pb[0] - pa[0]) * wallNormal[0] + (pb[1] - pa[1]) * wallNormal[1]) /
        (Math.hypot(wallNormal[0], wallNormal[1]) || 1);
      if (roundZ < halfWidth + 2 || offsetAcross > 4) continue;
      const mid = [0, 1].map((k) => (pa[k] + pb[k]) / 2);
      const alongWall = [(pb[0] - pa[0]) / gap, (pb[1] - pa[1]) / gap];
      const acrossWall = [-alongWall[1], alongWall[0]];
      // Deep enough to pass through both the tilted part and the drop, which
      // sits further out on a rolled key.
      const halfDepth =
        Math.max(
          ...[...joint, ...endPoints(atA(a.dropTop)), ...endPoints(atB(b.dropTop))].map((p) =>
            Math.abs((p[0] - mid[0]) * acrossWall[0] + (p[1] - mid[1]) * acrossWall[1]),
          ),
        ) + 1;
      slots.push(
        M.hull([
          M.cylinder(2 * halfDepth, halfWidth, halfWidth, 32, true)
            .rotate([90, 0, 0])
            .rotate([0, 0, (Math.atan2(alongWall[1], alongWall[0]) * 180) / Math.PI])
            .translate([mid[0], mid[1], roundZ]),
          ...tops.flatMap((p) =>
            [-1, 1].map(
              (sign) =>
                [
                  p[0] + acrossWall[0] * sign * halfDepth,
                  p[1] + acrossWall[1] * sign * halfDepth,
                  p[2],
                ] as Vec3,
            ),
          ),
        ]),
      );
    }
    const run = M.union(pieces);
    return slots.length ? run.subtract(M.union(slots)) : run;
  };
  const fingerCaps = fingerEnds.flatMap((s) => s.caps);
  for (const [c, dir] of outerColumns) parts.push(wallRun(columnKeys(c), dir, fingerCaps));
  [thumbRow, extraRow].forEach((row, i) => {
    if (row.length)
      parts.push(
        wallRun(
          row,
          [0, -1],
          thumbRowEnds[i].flatMap((s) => s.caps),
        ),
      );
  });
  if (extraRowClose)
    parts.push(
      wallRun(
        extraRow,
        [0, 1],
        thumbRowEnds[1].flatMap((s) => s.caps),
      ),
    );
  // Caps on swept ends with no wall beside them.
  for (const cap of [...fingerEnds, ...thumbRowEnds.flat()].flatMap((s) => s.caps))
    if (!usedCaps.has(cap)) parts.push(M.hull(capPoints(cap)));

  // Ribs along the base, so the footprint is connected without the bottom plate:
  // the main thumb row's right end to the fingers' front, and the thumb rows'
  // ends to each other. Each runs between the closest points of two base lines.
  // Ends are round and centred on the walls' mid-lines, clear of the lines'
  // ends, so they stay inside the walls.
  const rib = (lineA: Vec3[], lineB: Vec3[], height = 6) => {
    let best: [Vec3, Vec3] = [lineA[1], lineB[1]];
    let bestDistance = Infinity;
    for (const p of lineA.slice(1, -1))
      for (const q of lineB.slice(1, -1)) {
        const d = planDistance(p, q);
        if (d < bestDistance) {
          bestDistance = d;
          best = [p, q];
        }
      }
    return M.hull(
      best.map((p) =>
        M.cylinder(height - 1, wallThickness / 2, wallThickness / 2, 24).translate([p[0], p[1], 1]),
      ),
    );
  };
  const [thumbEnds, extraEnds] = thumbRowEnds;
  if (thumbEnds.length) {
    parts.push(rib(thumbEnds[1].baseLine, fingerEnds[1].baseLine));
    if (extraRowClose && extraEnds.length)
      for (const i of [0, 1]) parts.push(rib(thumbEnds[i].baseLine, extraEnds[i].baseLine));
  }

  // Tile pockets: clear the tile, its components and the switch body under every
  // key, below the plate, from anything that reaches up under them.
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
        M.cube([switchHole[0], switchHole[1], 13 - plateThickness], true).translate([
          0,
          0,
          -(13 + plateThickness) / 2,
        ]),
        frames[n],
      ),
    ]),
  );
  const built = M.union(parts);
  const cleared = built.subtract(pockets);
  // Base plate: the footprint of everything built, holes filled, so it is flush with the walls.
  const signedArea = (p: [number, number][]) =>
    p.reduce((t, q, i) => {
      const r = p[(i + 1) % p.length];
      return t + q[0] * r[1] - r[0] * q[1];
    }, 0);
  const footprint = CS.union(
    cleared
      .project()
      .toPolygons()
      .filter((p) => signedArea(p as [number, number][]) > 0)
      .map((p) => new CS([p])),
  );
  const base = footprint.extrude(chassis.base_thickness_mm);
  const pod = trackpadPod(wasm, cfg, frames, keyPoint, seatHalf, plateHalf);
  const pocketCut = built.add(pod).intersect(pockets);
  let body = cleared.add(pod);
  // Room above each plate: the switch hole, the switch housing's rim up to the
  // keycap's lowest point, and the keycap with its clearance above that.
  const capLowest = Math.max(0, sw.keycap_bottom_above_plate_mm - sw.travel_mm);
  for (const n of keyNames) {
    const cap = capSize(cfg, n);
    const clearance =
      (sw.keycap_clearance_overrides_mm as Record<string, number>)[n] ?? sw.keycap_clearance_mm;
    body = body
      .subtract(place(M.cube([14, 14, 20], true), frames[n]))
      .subtract(
        place(
          M.cube([cap[0] + 2 * clearance + 0.2, cap[1] + 2 * clearance + 0.2, 60], true).translate([
            0,
            0,
            capLowest + 30,
          ]),
          frames[n],
        ),
      );
    if (capLowest > 0.1)
      body = body.subtract(
        place(
          M.cube([seat[0], seat[1], capLowest], true).translate([0, 0, capLowest / 2]),
          frames[n],
        ),
      );
  }
  return { body, base, pod, pocketCut };
}

// Cirque trackpad in a printed pod on the inner side, held by a bracket to the
// two corners of the far thumb key nearest to it. The bracket takes in the
// plate's full thickness at each corner, above the tile pocket.
function trackpadPod(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
  keyPoint: (n: string, corner: Corner, z: number, half: HalfWidths) => Vec3,
  seatHalf: HalfWidths,
  plateHalf: HalfWidths,
) {
  const M = wasm.Manifold;
  const t = cfg.trackpad;
  const f = frames.trackpad;
  const padRadius = t.diameter_mm / 2 + t.clearance_mm;
  const podRadius = padRadius + t.pod_wall_mm;
  const plateThickness = cfg.chassis.plate_thickness_mm;
  // The pod's rim top is the frame's origin; the pad sits on the recess floor.
  const recess = t.thickness_mm + t.top_below_rim_mm;
  const pod = M.cylinder(t.pod_depth_mm, podRadius, podRadius, 64)
    .translate([0, 0, -t.pod_depth_mm])
    .subtract(M.cylinder(recess + 1, padRadius, padRadius, 64).translate([0, 0, -recess]))
    .transform(f.elements as never);
  const centre = point(f, [0, 0, -4]);
  const nearest = (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as Corner[]
  )
    .map((corner) => ({ corner, p: keyPoint('thumb_far', corner, 0, seatHalf) }))
    .sort((a, b) => planDistance(a.p, centre) - planDistance(b.p, centre))
    .slice(0, 2);
  const rim = nearest.map(({ p }) => {
    const d = [p[0] - centre[0], p[1] - centre[1]];
    const l = Math.hypot(d[0], d[1]);
    return [
      centre[0] + (d[0] / l) * (podRadius - 2.5),
      centre[1] + (d[1] / l) * (podRadius - 2.5),
      centre[2],
    ] as Vec3;
  });
  return pod.add(
    M.hull([
      ...rim.flatMap((p) => [p, [p[0], p[1], p[2] - 4] as Vec3]),
      ...nearest.flatMap(({ corner }) => [
        keyPoint('thumb_far', corner, 0, plateHalf),
        keyPoint('thumb_far', corner, -plateThickness, plateHalf),
      ]),
    ]),
  );
}

/** The trackpad itself, for display. */
export const trackpadPart = (
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
) => {
  const t = cfg.trackpad;
  return wasm.Manifold.cylinder(t.thickness_mm, t.diameter_mm / 2, t.diameter_mm / 2, 64)
    .translate([0, 0, -t.top_below_rim_mm - t.thickness_mm + 0.01])
    .transform(frames.trackpad.elements as never);
};
