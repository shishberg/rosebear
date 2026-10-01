// Chassis: Skeletyl-style construction with swept ends, built from the key poses.
// Each finger column is a ladder of switch plates.
// Across the back and across the front of the columns runs one swept end: a
// quarter round swept along a curve that follows each column's end as closely as
// the tile pockets allow, then a wall to the base. Round-bottomed slots part the columns down to half that wall's
// height. The thumb rows use the same construction, running left to right. The
// outside edges without a swept end are walls just outside the plate edges, with
// a U cutout under each key that shows its tile. Low ribs join the thumb rows and the fingers along the
// base. Nothing is built into a tile pocket. The whole case stands on a flat
// base plate cut to its own footprint.
//
// Terms:
//  tile         the small bought PCB under each switch (hotswap socket, LED, diode);
//  tile pocket  the space under a plate kept clear for the tile and its parts;
//  plate        the square frame a switch clips into, plate_thickness_mm thick and
//               plate_margin_mm past the switch seat on each side, or further if
//               needed to cover the tile and its clearance;
//  ladder       a row of plates joined edge to edge;
//  swept end    one quarter round swept along a curve through a row of keys' end
//               edges, then a wall to the base;
//  wall         a slab just outside a key's plate edge that follows the plate's
//               tilt down to the tile pocket's depth, then drops vertically to
//               the base. A U cutout under each key shows its tile;
//               posts between keys and a strip along the base remain. With
//               wall_pattern "hex", tall walls are opened further into
//               hexagonal struts.
//
// Coordinates: "key coordinates" are a key's own frame, with the origin at the
// plate top's centre, x and y across the plate and z along its normal (up is
// positive). A "half-width" is a distance from the key's centre along its x or y
// axis. "Plan" means the world XY plane.
import type { Manifold, ManifoldToplevel, Vec3 } from 'manifold-3d';
import { Matrix4 } from 'three';
import { point, ROWS, slideToward, type Config } from './geometry';
import { seatSettings } from './seats';
import { landingBox, wirePort } from './wiring';

export const isKey = (name: string) => name.startsWith('thumb_') || name.startsWith('matrix_');
export const capSize = (c: Config, n: string) =>
  ((c.switch.keycap_overrides_mm as Record<string, number[]>)[n] || c.switch.keycap_mm) as Vec3;
export interface ChassisResult {
  body: Manifold;
  base: Manifold;
  /** The trackpad housing, a separate print, and the way it slides up off its mount. */
  pod: Manifold;
  podSweep: Manifold;
  pocketCut: Manifold;
  /** For each key, the chassis its keycap's room (and the switch rim's) had to remove. */
  roomCuts: { name: string; cut: Manifold }[];
  wallWindows: WallWindow[];
  /** Every opening cut through the walls (cutouts and hex pattern openings). */
  wallOpenings: Manifold;
}
/**
 * A window through a wall, for the checks: the part of the wall seen when
 * looking along `normal` through the plan slab `across`, between `along`.
 * Both ranges are plan distances: along the wall's direction (-normal[1],
 * normal[0]) and along the normal. The wall should be solid there apart from
 * its U cutout.
 */
export interface WallWindow {
  name: string;
  normal: [number, number];
  along: [number, number];
  across: [number, number];
  /** The cutout centres inside the window, as [along, z]: each should be a hole through the wall. */
  cutouts: [number, number][];
}

/**
 * Construction sizes that are not in the config, in mm. Distances are in key
 * coordinates unless noted.
 */
export const SIZES = {
  /** Wall and base heights: walls stop this far above z = 0, inside the base plate. */
  wallFoot: 1,
  /** A wall's end, where it joins a swept end's cap, reaches this far past the tile pocket; a square wall cutout is this much larger than the pocket. */
  wallPocketGap: 0.25,
  /** A swept end's quarter round stays this far clear of the end keys' tile pockets and switch bodies (it has flat faces). */
  endPocketGap: 0.3,
  /** Each end key's flat continuation reaches this far into its swept end. */
  endOverlap: 0.5,
  /** A swept end is sampled at every end-key corner and at this spacing between (plan). */
  sweepStation: 3,
  /** Flat faces in each quarter round. */
  roundFaces: 6,
  /** Swept-end slots between columns: at least this half-width (plan). */
  endSlotMinHalfWidth: 1.5,
  /** Swept-end slots start this far inside the quarter round's centre and end this far past its face. */
  endSlotInside: 0.2,
  endSlotPast: 3,
  /** Wall cutouts (the U under each key): radius of the round bottom corners. */
  wallCutoutRadius: 2,
  /** A wall cutout reaches this far past both faces of the wall. */
  wallCutoutPast: 1.5,
  /** Hex wall pattern: the struts' slope from horizontal, in degrees. */
  hexSlope: 30,
  /** Hex wall pattern: openings smaller than this (mm², in the wall's plane) are left out. */
  hexMinOpening: 2,
  /** Hex wall pattern: the lowest hexagon corners are this many strut widths above the wall's foot. */
  hexLowCorner: 1.5,
  /** Hex wall pattern: struts stay this far below the tile pockets. */
  hexPocketGap: 0.5,
  /** Hex wall pattern: an opening reaches this far past both faces of the wall (plan). */
  hexPast: 6,
  /** A swept end's cap joins a wall segment whose tilted part comes within this distance (plan). */
  capReach: 8,
  /** The main thumb row has no front wall when the extra row's plates come this close to its own (plan). */
  closeRows: 15,
  /** Height of the ribs joining footprints along the base. */
  ribHeight: 6,
  /** The switch body and pins below the plate top: kept clear under the switch hole. */
  switchBelowPlate: 13,
  /** The keycap's room is this much wider than the cap plus its clearance, in total. */
  keycapRoomExtra: 0.2,
  /** Heights cut above the plate: the switch hole's and the keycap room's. */
  switchHoleHeight: 20,
  keycapRoomHeight: 60,
  /** PROTOTYPE tile rests: a thumb rest's width along the plate edge, how far a foot reaches under the tile, its thickness and its gap below the tile. */
  restWidth: 12,
  restUnder: 1.5,
  restThickness: 1.5,
  restGap: 0.1,
  /** A crossways thumb key's rests start this far either side of its edge's middle. */
  crosswaysFrom: 2,
  /** A rest past a thumb row's end key hangs from this far past its tile pocket. */
  restEndStem: 1.6,
  /**
   * A finger tile goes up this far in front of its place and slides back onto
   * its feet. Feet and webs stay this far clear of a tile's way in.
   */
  restSlide: 7.5,
  /** A finger tile comes up this far from below before it slides. */
  restRise: 3,
  restPathClear: 0.3,
  /** A foot reaches this far past the tile pocket into its web or wall. */
  restFootOut: 0.5,
  /**
   * A tile's way in is cut this far clear of the tile, above it (the foot is
   * restGap below), and a finger tile's lids are this far above it.
   */
  restPathAbove: 0.2,
  /** A foot ends this far short of a soldering iron's way to a pad. */
  padClear: 0.2,
  /** A pad within this distance of a tile's edge is along that edge. */
  padEdge: 2,
  /** The adapter's rests stand this far in from its hole edge. */
  adapterRestIn: 7,
  /** Tie tunnels: their centres this far in from the landing's ends, and their tops this far under its top. */
  tieIn: 2.75,
  tieBridge: 1,
  /** The ribbon notch reaches this far out from the landing. */
  notchLength: 40,
  /** The housing must slide this far up off its mount, along the pad's normal, without touching the body. */
  housingSlide: 30,
} as const;

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
  /** The range of s the swept end covers: from the first end corner to the last. */
  from: number;
  to: number;
  /** The height of the quarter round's top at position s. */
  topAt: (s: number) => number;
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
  /** The end key at this end of the swept end. */
  key: string;
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
  // PROTOTYPE tile rests: the top and bottom of the foot under a tile.
  const restsOn = (chassis as { tile_rests?: boolean }).tile_rests !== false;
  const restTop = -(tile.plate_top_to_pcb_top_mm + tile.size_mm[2]) - SIZES.restGap;
  const restBottom = restTop - SIZES.restThickness;
  const lidBottom = -tile.plate_top_to_pcb_top_mm + SIZES.restPathAbove;
  const pocketHalf: HalfWidths = [
    tile.size_mm[0] / 2 + tile.clearance_mm,
    tile.size_mm[1] / 2 + tile.clearance_mm,
  ];
  const switchHole = sw.cutout_mm.map((x) => x + sw.cutout_clearance_mm);
  const switchHoleHalf: HalfWidths = [switchHole[0] / 2, switchHole[1] / 2];
  const seat = seatSettings(cfg).outer;
  const seatHalf: HalfWidths = [seat[0] / 2, seat[1] / 2];
  // The plate reaches plate_margin past the seat, and always far enough to cover
  // the tile and its clearance.
  const plateHalf: HalfWidths = [
    Math.max(seatHalf[0] + plateMargin, pocketHalf[0]),
    Math.max(seatHalf[1] + plateMargin, pocketHalf[1]),
  ];

  /** World point on key n: toward a corner by the given half-widths, z along the normal. */
  const keyPoint = (n: string, [sx, sy]: Corner, z: number, half: HalfWidths): Vec3 =>
    point(frames[n], [sx * half[0], sy * half[1], z]);
  const keyCentre = (n: string): Plan => [frames[n].elements[12], frames[n].elements[13]];
  const place = (m: Manifold, f: Matrix4) => m.transform(f.elements as never);
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
        M.cube(
          [switchHole[0], switchHole[1], SIZES.switchBelowPlate - plateThickness],
          true,
        ).translate([0, 0, -(SIZES.switchBelowPlate + plateThickness) / 2]),
        frames[n],
      ),
    ]),
  );
  const atHeight = (p: Vec3, z = 0): Vec3 => [p[0], p[1], z];

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
      const alongHalf = along ?? plateHalf[1 - axis];
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
  /**
   * The U cutout in a wall under key n's edge: the tile pocket's width along the
   * wall, from the plate's underside down past the pocket's depth, with round
   * bottom corners that just take in the pocket's lower corners. It follows the
   * key's tilt and reaches past both faces of the wall.
   */
  const wallCutout = (n: string, edge: Edge) => {
    const axis = facingAxis(edge);
    const side = edge[0][axis];
    const r = SIZES.wallCutoutRadius;
    const along = pocketHalf[1 - axis];
    const across = [
      plateHalf[axis] - SIZES.wallCutoutPast,
      plateHalf[axis] + wallThickness + SIZES.wallCutoutPast,
    ];
    const at = (a: number, c: number, z: number) => {
      const v: Vec3 = [0, 0, z];
      v[1 - axis] = a;
      v[axis] = side * c;
      return point(frames[n], v);
    };
    const profile: [number, number][] = [
      [-along, -plateThickness],
      [along, -plateThickness],
      ...[-1, 1].flatMap((sign) =>
        Array.from({ length: 5 }, (_, i) => {
          const angle = (i / 4) * (Math.PI / 2);
          return [sign * (along - r + r * Math.cos(angle)), -pocketDepth - r * Math.sin(angle)] as [
            number,
            number,
          ];
        }),
      ),
    ];
    // The lower of a corner's points at the wall's two faces.
    const lowest = (a: number, depth: number) =>
      [plateHalf[axis], plateHalf[axis] + wallThickness]
        .map((c) => at(a, c, -depth))
        .reduce((p, q) => (p[2] < q[2] ? p : q));
    const gap = SIZES.wallPocketGap;
    const box: [number, number][] = [-1, 1].flatMap((sign) =>
      [-plateThickness, -pocketDepth - gap].map(
        (z) => [sign * (along + gap), z] as [number, number],
      ),
    );
    return {
      solid: M.hull(across.flatMap((c) => profile.map(([a, z]) => at(a, c, z)))),
      /** The tile pocket's shape through the wall, wallPocketGap larger, without the round bottom. */
      square: M.hull(across.flatMap((c) => box.map(([a, z]) => at(a, c, z)))),
      /** The cutout's centre, in the middle of the wall. */
      centre: at(0, plateHalf[axis] + wallThickness / 2, -(plateThickness + pocketDepth) / 2),
      /** The lowest points the wall's openings must stay clear of: the tile pocket's lower corners, carried out across the wall. */
      keepClear: [-1, 1].map((sign) => lowest(sign * along, pocketDepth)),
    };
  };
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
              [0, -plateThickness].map((z) => keyPoint(n, [sx, sy], z, plateHalf)),
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
   * The curve for a swept end across the facing edges of a row of end keys.
   * Along each key it runs parallel to the key's edge, as close as it can: the
   * tile pocket stays inside the quarter round's hollow (or under the flat
   * plate), and the plate corners reach at most end_cut into the round. Between
   * keys it changes smoothly from one key's line to the next.
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
        const p = keyPoint(n, corner, 0, plateHalf);
        return { s: alongSide(p), out: alongOut(p), z: p[2], key };
      }),
    );
    const sorted = [...corners].sort((x, y) => x.s - y.s);
    // The quarter round's top: the plate corners' heights, linear between them.
    const topAt = (s: number) => {
      for (let i = 0; i + 1 < sorted.length; i++)
        if (s <= sorted[i + 1].s) {
          const t = Math.max(0, (s - sorted[i].s) / (sorted[i + 1].s - sorted[i].s || 1));
          return sorted[i].z * (1 - t) + sorted[i + 1].z * t;
        }
      return sorted.at(-1)!.z;
    };
    /** The least outerAt(s) that keeps point p clear, where the round's top is at top. */
    const hollow = endRadius - wallThickness - SIZES.endPocketGap;
    const outerFor = (p: Vec3, top: number) => {
      const above = p[2] - (top - endRadius);
      if (above <= 0) return alongOut(p) + wallThickness + SIZES.endPocketGap;
      if (above < hollow) return alongOut(p) + endRadius - Math.sqrt(hollow ** 2 - above ** 2);
      return alongOut(p) + endRadius + SIZES.endPocketGap;
    };
    // Each key's points: its plate corners, which may reach end_cut into the round
    // but no further than the switch seat's edge, and the corners of its tile
    // pocket and switch body, which must stay clear of the round.
    const needs = ends.map((n, key) =>
      edges[key].flatMap((corner) => {
        const plate = keyPoint(n, corner, 0, plateHalf);
        return [
          { s: alongSide(plate), outer: alongOut(plate) + endRadius - endCut },
          {
            s: alongSide(plate),
            outer: alongOut(keyPoint(n, corner, 0, seatHalf)) + endRadius,
          },
          ...(
            [
              [-plateThickness, pocketHalf],
              [-pocketDepth, pocketHalf],
              [-plateThickness, switchHoleHalf],
              [-SIZES.switchBelowPlate, switchHoleHalf],
            ] as const
          ).map(([z, half]) => {
            const p = keyPoint(n, corner, z, half);
            return { s: alongSide(p), outer: outerFor(p, topAt(alongSide(p))) };
          }),
        ];
      }),
    );
    // Each key's line, parallel to its plate edge and just far enough out, across
    // its plate, tile pocket and switch body.
    const lines = ends.map((_, key) => {
      const [a, b] = corners.filter((q) => q.key === key);
      const slope = (b.out - a.out) / (b.s - a.s);
      const offset = Math.max(...needs[key].map((q) => q.outer - slope * q.s));
      const ss = needs[key].map((q) => q.s);
      return { from: Math.min(...ss), to: Math.max(...ss), slope, offset };
    });
    // The swept end runs from the first end corner to the last, and on past a
    // wall beside it, which stands outside the plate's edge, to the wall's face.
    const past = (corner: (typeof sorted)[number], sign: number) =>
      walled(ends[corner.key], [sign * side[0], sign * side[1]]) ? wallThickness : 0;
    const from = sorted[0].s - past(sorted[0], -1);
    const to = sorted.at(-1)!.s + past(sorted.at(-1)!, 1);
    // Each key's line holds across its plate, tile pocket and switch body. In the
    // gap between two keys' extents, where the slot between them is, the curve
    // changes from one line to the next along a smoothstep; where extents
    // overlap, the further-out line wins.
    const byFrom = [...lines].sort((a, b) => a.from - b.from);
    const lineAt = (k: (typeof lines)[number], s: number) => k.offset + k.slope * s;
    const joined = (s: number) => {
      const covering = lines.filter((k) => k.from <= s && s <= k.to);
      if (covering.length) return Math.max(...covering.map((k) => lineAt(k, s)));
      const before = byFrom.filter((k) => k.to < s).at(-1);
      const after = byFrom.find((k) => k.from > s);
      if (!before) return lineAt(after!, s);
      if (!after) return lineAt(before, s);
      const t = (s - before.to) / (after.from - before.to);
      const u = t * t * (3 - 2 * t);
      return lineAt(before, s) * (1 - u) + lineAt(after, s) * u;
    };
    // A safeguard: if the blend comes inside any point's need, move the curve out.
    const shift = Math.max(0, ...needs.flat().map((q) => q.outer - joined(q.s)));
    return {
      outward,
      side,
      from,
      to,
      outerAt: (s) => joined(s) + shift,
      topAt,
      corners,
    };
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
    const sStart = curve.from;
    const sEnd = curve.to;
    const topAt = curve.topAt;
    // Where the sweep is sampled: every corner, and every 3 mm between.
    const stations = [
      ...new Set([
        ...sorted.map((q) => q.s),
        ...Array.from(
          { length: Math.ceil((sEnd - sStart) / SIZES.sweepStation) },
          (_, i) => sStart + i * SIZES.sweepStation,
        ),
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
      for (let j = 0; j < SIZES.roundFaces; j++) {
        const from = ((j / SIZES.roundFaces) * Math.PI) / 2;
        const to = (((j + 1) / SIZES.roundFaces) * Math.PI) / 2;
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
            .flatMap((p) => [p, atHeight(p, SIZES.wallFoot)]),
        ),
      );
    }
    // Flat continuation of each end key out to the swept end, 0.5 mm into it.
    // Where the round starts under the plate, there is nothing to continue. It is
    // wall_mm thick along the key's normal, but never reaches below the plate's
    // underside plane, so it stays above the tile pocket.
    ends.forEach((n, key) => {
      const edge = edgeFacing(n, facing);
      const onCurve = curve.corners.filter((x) => x.key === key);
      const reach = (x: (typeof onCurve)[number]) =>
        curve.outerAt(x.s) - endRadius + SIZES.endOverlap;
      if (onCurve.every((x) => reach(x) <= x.out)) return;
      const e = frames[n].elements;
      const below = (p: Vec3): Vec3 => {
        const height = (p[0] - e[12]) * e[8] + (p[1] - e[13]) * e[9] + (p[2] - e[14]) * e[10];
        const t = Math.min(wallThickness, height + plateThickness);
        return [p[0] - t * e[8], p[1] - t * e[9], p[2] - t * e[10]];
      };
      const top = [
        ...edge.map((corner) => keyPoint(n, corner, 0, plateHalf)),
        ...onCurve.map((x) => curvePoint(curve, x.s, Math.max(x.out, reach(x)), x.z)),
      ];
      pieces.push(M.hull([...top, ...top.map(below)]));
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
        const halfWidth = Math.max(SIZES.endSlotMinHalfWidth, Math.abs(right.s - left.s) / 2);
        const bottomZ =
          SIZES.wallFoot +
          (Math.min(topAt(left.s), topAt(right.s)) - endRadius - SIZES.wallFoot) / 2;
        const outFrom =
          Math.min(curve.outerAt(left.s), curve.outerAt(right.s)) - endRadius - SIZES.endSlotInside;
        const outTo = Math.max(curve.outerAt(left.s), curve.outerAt(right.s)) + SIZES.endSlotPast;
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
    const caps = (
      [
        [sStart, 1, sorted[0].key],
        [sEnd, -1, sorted.at(-1)!.key],
      ] as const
    ).map(([s, sign, key]) => {
      const round = Array.from({ length: SIZES.roundFaces + 1 }, (_, j) => j).flatMap((j) =>
        [0, wallThickness].map((ds) =>
          roundPoint(s + sign * ds, ((j / SIZES.roundFaces) * Math.PI) / 2, endRadius),
        ),
      );
      return { round, onBase: round.map((p) => atHeight(p, SIZES.wallFoot)), key: ends[key] };
    });
    return {
      solid,
      caps,
      baseLine: stations.map((s) =>
        curvePoint(curve, s, curve.outerAt(s) - wallThickness / 2, SIZES.wallFoot),
      ),
    };
  };

  // Walls: the inner and pinky columns' outer sides, the main thumb row's back,
  // and the thumb rows' fronts. When the extra thumb row is close in front of the
  // main one, the main row's front, which faces it, has no wall.
  const facingCorners = (ns: string[], dir: Plan) =>
    ns.flatMap((n) => edgeFacing(n, dir).map((corner) => keyPoint(n, corner, 0, plateHalf)));
  const extraRowClose =
    thumbRow.length > 0 &&
    extraRow.length > 0 &&
    Math.min(
      ...facingCorners(thumbRow, [0, -1]).flatMap((p) =>
        facingCorners(extraRow, [0, 1]).map((q) => planDistance(p, q)),
      ),
    ) < SIZES.closeRows;
  const outerColumns: [string, Plan][] = [
    [columns[0], [-1, 0]],
    [columns.at(-1)!, [1, 0]],
  ];
  // The thumb rows' walls: name, keys, facing, and which row's swept ends they join.
  const thumbWalls: [string, string[], Plan, number][] = [
    ['thumb row back wall', thumbRow, [0, 1], 0],
    ['extra thumb row front wall', extraRow, [0, -1], 1],
  ];
  if (!extraRowClose) thumbWalls.push(['thumb row front wall', thumbRow, [0, -1], 0]);
  /** Whether key n's edge facing dir has a wall under it. */
  const walled = (n: string, dir: Plan) => {
    const edge = edgeFacing(n, dir);
    const runs: [string[], Plan][] = [
      ...outerColumns.map(([c, d]): [string[], Plan] => [columnKeys(c), d]),
      ...thumbWalls.map(([, ns, d]): [string[], Plan] => [ns, d]),
    ];
    return runs.some(
      ([ns, d]) =>
        ns.includes(n) &&
        edgeFacing(n, d).every((c, i) => c[0] === edge[i][0] && c[1] === edge[i][1]),
    );
  };

  // PROTOTYPE tile rests. Pressing a switch into its hotswap socket pushes the
  // tile down, and nothing else holds it. A web hangs from the plate beside
  // each tile, down past it; a foot at its bottom reaches under the tile's edge.
  // In the finger columns the webs bridge neighbouring columns under the keys'
  // side edges; in the thumb rows they hang between keys along the row.
  const tileRests = () => {
    /** Key n's share of a rest under its edge facing dir: from inside the plate, `reach` past the pocket, down to the foot. */
    const restSide = (n: string, dir: Plan, reach: number) => {
      const edge = edgeFacing(n, dir);
      const axis = facingAxis(edge);
      const side = edge[0][axis];
      const out = pocketHalf[axis] + reach;
      const under = pocketHalf[axis] - SIZES.restUnder;
      return [-1, 1].flatMap((a) =>
        (
          [
            [out, -plateThickness / 2],
            [out, restBottom],
            [under, restTop],
            [under, restBottom],
          ] as [number, number][]
        ).map(([c, z]) => {
          const v: Vec3 = [0, 0, z];
          v[1 - axis] = (a * SIZES.restWidth) / 2;
          v[axis] = side * c;
          return point(frames[n], v);
        }),
      );
    };
    /**
     * Points under key n's edge facing dir, in the key's frame: at each distance
     * `along` the edge (+ toward the key's back), each [distance out from the
     * key's centre, z] that `across` gives for the edge's axis.
     */
    const edgePoints = (
      n: string,
      dir: Plan,
      along: number[],
      across: (axis: 0 | 1) => [number, number][],
    ) => {
      const edge = edgeFacing(n, dir);
      const axis = facingAxis(edge);
      const side = edge[0][axis];
      return along.flatMap((a) =>
        across(axis).map(([c, z]) => {
          const v: Vec3 = [0, 0, z];
          v[1 - axis] = a;
          v[axis] = side * c;
          return point(frames[n], v);
        }),
      );
    };
    /** A foot under key n's edge facing dir, from `from` to `to` along it, reaching `out` past the pocket. */
    const foot = (n: string, dir: Plan, from: number, to: number, out: number) =>
      M.hull(
        edgePoints(n, dir, [from, to], (axis) => [
          [pocketHalf[axis] + out, -plateThickness / 2],
          [pocketHalf[axis] + out, restBottom],
          [pocketHalf[axis] - SIZES.restUnder, restTop],
          [pocketHalf[axis] - SIZES.restUnder, restBottom],
        ]),
      );
    /**
     * A lid over key n's edge facing dir, from `from` to `to` along it, from the
     * plate down to just above the tile, reaching `out` past the pocket. With the
     * foot below, it holds the tile's edge in a slot, so the tile cannot tip
     * about its feet when a switch is pressed into it.
     */
    const lid = (n: string, dir: Plan, from: number, to: number, out: number) =>
      M.hull(
        edgePoints(n, dir, [from, to], (axis) => [
          [pocketHalf[axis] + out, -plateThickness / 2],
          [pocketHalf[axis] + out, lidBottom],
          [pocketHalf[axis] - SIZES.restUnder, lidBottom],
          [pocketHalf[axis] - SIZES.restUnder, -plateThickness / 2],
        ]),
      );
    // A finger tile goes up restSlide to one side of its place and slides onto
    // its feet, so they can only be under the far end of its side edges, where
    // nothing was above them on its way up: the back (under the socket), or the
    // front in the bottom row. `ahead` is that end's sign along the key's y axis.
    const backFrom = tile.size_mm[1] / 2 - SIZES.restSlide + SIZES.restPathClear;
    // A foot ends short of the soldering iron's way straight down to any pad
    // beside it at that end.
    const [access] = cfg.wiring.solder_access_mm;
    const backTo = (ahead: number) =>
      Math.min(
        pocketHalf[1],
        ...tile.pads.list
          .filter(
            (p) =>
              ahead * p.at_mm[1] > backFrom &&
              Math.abs(p.at_mm[0]) + access / 2 > pocketHalf[0] - SIZES.restUnder,
          )
          .map((p) => ahead * p.at_mm[1] - access / 2 - SIZES.padClear),
      );
    /** Key n's feet along its side edges, as distances along its y axis. */
    const feetAlong = (n: string) => {
      const ahead = slideToward(n);
      return [ahead * backFrom, ahead * backTo(ahead)] as const;
    };
    /** Whether key n's edge facing dir has pads along it: a rest there would cover them. */
    const padded = (n: string, dir: Plan) => {
      const edge = edgeFacing(n, dir);
      const axis = facingAxis(edge);
      const side = edge[0][axis];
      return tile.pads.list.some(
        (p) => side * p.at_mm[axis] > tile.size_mm[axis] / 2 - SIZES.padEdge,
      );
    };
    /** The web between two keys' facing side edges, along their feet, from inside the plate (so it overlaps the plate rather than sharing its edge face) down to the feet. */
    const web = (a: string, b: string) =>
      M.hull(
        [
          [a, b],
          [b, a],
        ].flatMap(([n, other]) =>
          edgePoints(
            n,
            planToward(n, other),
            [feetAlong(n)[0], slideToward(n) * pocketHalf[1]],
            (axis) => [
              [pocketHalf[axis] - SIZES.restFootOut, -plateThickness / 2],
              [pocketHalf[axis], restBottom],
            ],
          ),
        ),
      );
    const rests: Manifold[] = [];
    const lids: Manifold[] = [];
    const clear = (n: string) => {
      // The tile, from the plate's underside down to the foot (a rest overlaps
      // the plate rather than sharing its edge face), its components with their
      // clearance, and the switch body.
      const c = tile.component_clearance_mm;
      const tileTop = -tile.plate_top_to_pcb_top_mm;
      return place(
        M.union([
          M.cube([2 * pocketHalf[0], 2 * pocketHalf[1], -plateThickness - restTop], true).translate(
            [0, 0, (restTop - plateThickness) / 2],
          ),
          ...tile.components.map((p) =>
            M.cube(p.size_mm.map((x) => x + 2 * c) as Vec3, true).translate([
              p.center_mm[0],
              p.center_mm[1],
              p.center_mm[2] + tileTop,
            ]),
          ),
          M.cube([switchHole[0], switchHole[1], SIZES.switchBelowPlate], true).translate([
            0,
            0,
            -SIZES.switchBelowPlate / 2,
          ]),
        ]),
        frames[n],
      );
    };
    // Finger columns: in each row a bridge between neighbouring columns' keys,
    // and feet hung from the outer columns' walls.
    for (const r of ROWS) {
      const ns = columns.map((c) => `matrix_${c}_${r}`);
      for (let i = 0; i + 1 < ns.length; i++) {
        rests.push(web(ns[i], ns[i + 1]));
        for (const [n, other] of [
          [ns[i], ns[i + 1]],
          [ns[i + 1], ns[i]],
        ]) {
          rests.push(foot(n, planToward(n, other), ...feetAlong(n), SIZES.restFootOut));
          lids.push(lid(n, planToward(n, other), ...feetAlong(n), SIZES.restFootOut));
        }
      }
      for (const [end, next] of [
        [ns[0], ns[1]],
        [ns.at(-1)!, ns.at(-2)!],
      ]) {
        rests.push(foot(end, planToward(next, end), ...feetAlong(end), SIZES.restFootOut));
        lids.push(lid(end, planToward(next, end), ...feetAlong(end), SIZES.restFootOut));
      }
    }
    // Thumb rows: rests between neighbouring keys along the row and past its
    // ends. A key whose edge along the row has pads (a key turned across the
    // row) has no rest there; it hangs from the plate under its other two
    // edges instead.
    const crossways = new Set<string>();
    const side = (n: string, dir: Plan, reach: number) => {
      if (!padded(n, dir)) return restSide(n, dir, reach);
      crossways.add(n);
      return [];
    };
    for (const ns of [thumbRow, extraRow].filter((r) => r.length)) {
      for (let i = 0; i + 1 < ns.length; i++) {
        const pair = [
          [ns[i], ns[i + 1]],
          [ns[i + 1], ns[i]],
        ];
        // Without its neighbour's share, a rest stands just outside the
        // pocket, as one past a row's end does, so the tile clearance does
        // not part it from the plate.
        const lone = pair.some(([n, other]) => padded(n, planToward(n, other)));
        const ps = pair.flatMap(([n, other]) =>
          side(n, planToward(n, other), lone ? SIZES.restEndStem : 0),
        );
        if (ps.length) rests.push(M.hull(ps));
      }
      if (ns.length > 1)
        for (const [end, next] of [
          [ns[0], ns[1]],
          [ns.at(-1)!, ns.at(-2)!],
        ]) {
          const [x, y] = planToward(next, end);
          const ps = side(end, [x, y], SIZES.restEndStem);
          if (ps.length) rests.push(M.hull(ps));
        }
    }
    // A crossways key hangs from its plate under each of its other two edges,
    // either side of the middle, where its wall's U cutout is: into the wall
    // like a finger foot, or on a stem just outside the pocket.
    for (const n of crossways) {
      const e = frames[n].elements;
      for (const sign of [-1, 1]) {
        const dir: Plan = [sign * e[0], sign * e[1]];
        if (padded(n, dir)) continue;
        const out = walled(n, dir) ? SIZES.restFootOut : SIZES.restEndStem;
        for (const s of [-1, 1])
          rests.push(
            M.hull(
              edgePoints(n, dir, [s * SIZES.crosswaysFrom, (s * SIZES.restWidth) / 2], (axis) => [
                [pocketHalf[axis] - SIZES.restFootOut, -plateThickness / 2],
                [pocketHalf[axis] + out, -plateThickness / 2],
                [pocketHalf[axis] + out, restBottom],
                [pocketHalf[axis] - SIZES.restUnder, restTop],
                [pocketHalf[axis] - SIZES.restUnder, restBottom],
              ]),
            ),
          );
      }
    }
    // The lids stand above the tiles, where clear() keeps the rests out.
    return M.union(rests)
      .subtract(M.union(keyNames.map(clear)))
      .add(M.union(lids));
  };
  /**
   * A sliding finger tile's way back onto its feet: the tile and its parts,
   * restPathClear larger (only restPathAbove above the tile, so the feet stay),
   * coming up restRise from below, restSlide to one side of its place, and swept
   * onto its feet (see slideToward). It is cut only in the walled columns, where it shaves the inside of
   * the wall between two keys.
   */
  const slidePaths = () => {
    const c = SIZES.restPathClear;
    const tileTop = -tile.plate_top_to_pcb_top_mm;
    const t = tile.size_mm;
    const boxes = [
      {
        size: [t[0] + 2 * c, t[1] + 2 * c, t[2] + SIZES.restPathAbove + SIZES.restGap / 2],
        centre: [0, 0, tileTop + (SIZES.restPathAbove - t[2] - SIZES.restGap / 2) / 2],
      },
      ...tile.components.map((p) => ({
        size: p.size_mm.map((x) => x + 2 * tile.component_clearance_mm),
        centre: [p.center_mm[0], p.center_mm[1], p.center_mm[2] + tileTop],
      })),
    ];
    return M.union(
      [columns[0], columns.at(-1)!].flatMap(columnKeys).flatMap((n) =>
        boxes.map(({ size, centre }) => {
          const b = M.cube(size as Vec3, true);
          const at = (dy: number, dz: number) =>
            b.translate([centre[0], centre[1] + dy, centre[2] + dz]);
          const from = -slideToward(n) * SIZES.restSlide;
          return place(
            M.union([
              M.hull([at(from, -SIZES.restRise), at(from, 0)]),
              M.hull([at(from, 0), at(0, 0)]),
            ]),
            frames[n],
          );
        }),
      ),
    );
  };

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

  /**
   * The hex pattern for a run of walls: openings that leave struts wall_mm
   * wide. Posts stand between keys (and just past each end key's tile pocket)
   * down to a hexagon centred under each post. The hexagons' upright sides are
   * under the key centres. Under each key, the opening above the hexagons takes
   * in the tile pocket and comes to a point at the upright side's top; the
   * opening below them comes to a point at its bottom and runs down to a strip
   * along the base.
   * The struts slope at hexSlope, from each upright side up to the posts beside
   * it, and pass just under the tile pocket's corners, so the upright sides are
   * as long as the wall allows. A post's top is midway between the heights its
   * two neighbours' slopes reach it at. Where a key's wall is too short for an
   * upright side wall_mm long above the lower slopes, the pattern is cut off at
   * the base strip: the hexagons beside it run down to the strip, and the
   * opening above them does too if its point would be below the strip.
   * Openings too small to leave a hole are left out. `capped` says whether
   * each end of the run (first key, last key) joins a swept end's cap, which
   * closes the wall's end outside the end post.
   * Returns the openings and, for each key, the openings its wall window
   * should see as holes (world points inside them) and their corners.
   */
  const hexOpenings = (
    dropTops: Strip[],
    cutouts: ReturnType<typeof wallCutout>[],
    capped: boolean[],
  ) => {
    const w = wallThickness;
    const n = dropTops.length;
    const toward = (a: Plan, b: Plan): Plan => {
      const l = planDistance(a, b) || 1;
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    };
    // Nodes: K under each key, P at each post (n + 1 of them, the ends just
    // past the end keys' tile pockets).
    const K = dropTops.map((s) => {
      const ps = stripPoints(s);
      return [0, 1].map((k) => ps.reduce((t, p) => t + p[k], 0) / ps.length) as Plan;
    });
    const endPost = (key: number, other: number): Plan => {
      if (n < 2) return K[key];
      const d = toward(K[other], K[key]);
      const along = pocketHalf[0] + SIZES.wallPocketGap + w / 2;
      return [K[key][0] + d[0] * along, K[key][1] + d[1] * along];
    };
    const P: Plan[] = [
      endPost(0, 1),
      ...K.slice(1).map((k, i) => [(K[i][0] + k[0]) / 2, (K[i][1] + k[1]) / 2] as Plan),
      endPost(n - 1, n - 2),
    ];
    const posts = (i: number) => [i, i + 1];
    const d = (i: number, j: number) => planDistance(K[i], P[j]);
    // A strut's upper face is this far above its centre line.
    const face = w / 2 / Math.cos((SIZES.hexSlope * Math.PI) / 180);
    // The points key i's struts toward post j must pass under: their heights
    // less the strut's clearance and half width, and their distances from K.
    const other = (i: number, j: number) => P[j === i ? i + 1 : i];
    const under = (i: number, j: number) =>
      cutouts[i].keepClear
        .filter((q) => planDistance(q, P[j]) <= planDistance(q, other(i, j)))
        .map((q) => ({
          z: q[2] - SIZES.hexPocketGap - face,
          c: Math.min(planDistance(K[i], q), d(i, j)),
        }));
    const low = SIZES.wallFoot + SIZES.hexLowCorner * w;
    // Openings stop here, half a strut above the wall's foot, leaving the base strip.
    const floor = SIZES.wallFoot + w / 2;
    const tan = Math.tan((SIZES.hexSlope * Math.PI) / 180);
    const sides = (i: number) => posts(i).flatMap((j) => under(i, j).map((q) => ({ j, ...q })));
    const upper = K.map((_, i) => Math.min(...sides(i).map((q) => q.z - q.c * tan)));
    const lower = K.map((_, i) => low + (posts(i).reduce((t, j) => t + d(i, j), 0) / 2) * tan);
    const top = P.map(() => 0);
    const setTops = () =>
      P.forEach((_, j) => {
        const reach = [j - 1, j]
          .filter((i) => i >= 0 && i < n)
          .map((i) => upper[i] + d(i, j) * tan);
        top[j] = reach.reduce((a, b) => a + b) / reach.length;
      });
    // Where a post's top is higher than a key's own slope reaches it, the strut
    // is steeper and may pass through the pocket's corner: lower that key's
    // upright side until it clears.
    setTops();
    for (let pass = 0; pass < 20; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++)
        for (const { j, z, c } of sides(i)) {
          const over = upper[i] + (top[j] - upper[i]) * (c / d(i, j)) - z;
          if (over > 1e-3) {
            upper[i] -= over / (1 - c / d(i, j) / 2);
            moved = true;
          }
        }
      setTops();
      if (!moved) break;
    }
    // Keys with the whole pattern; the others' hexagons are cut off at the strip.
    const whole = K.map((_, i) => upper[i] - lower[i] >= w);
    // Where a cut-off hexagon's side meets the strip: below both it and the upright's top.
    const bottom = (i: number) => (whole[i] ? lower[i] : Math.min(floor, upper[i]) - 1);
    // A plane polygon of (plan point, height) corners, cut off at the base strip,
    // inset by half a strut and pushed through the wall along its plan normal.
    const opening = (corners: [Plan, number][]) => {
      const u = toward(corners[0][0], corners[1][0]);
      const o = corners[0][0];
      const pts = corners.map(
        ([p, z]) => [(p[0] - o[0]) * u[0] + (p[1] - o[1]) * u[1], z] as [number, number],
      );
      const area = pts.reduce((t, q, k) => {
        const r = pts[(k + 1) % pts.length];
        return t + q[0] * r[1] - r[0] * q[1];
      }, 0);
      const shape = new CS([area > 0 ? pts : [...pts].reverse()])
        .intersect(CS.square([2000, 1000]).translate([-1000, floor]))
        .offset(-w / 2, 'Miter');
      if (shape.area() < SIZES.hexMinOpening) return undefined;
      // A point inside: the centroid of the (convex) opening.
      const loop = shape.toPolygons()[0] as [number, number][];
      let cx = 0;
      let cz = 0;
      let a2 = 0;
      loop.forEach((q, k) => {
        const r = loop[(k + 1) % loop.length];
        const cross = q[0] * r[1] - r[0] * q[1];
        a2 += cross;
        cx += (q[0] + r[0]) * cross;
        cz += (q[1] + r[1]) * cross;
      });
      cx /= 3 * a2;
      cz /= 3 * a2;
      const depth = 2 * (w + SIZES.hexPast);
      const normal: Plan = [u[1], -u[0]];
      const solid = shape
        .extrude(depth)
        .transform([
          u[0],
          u[1],
          0,
          0,
          0,
          0,
          1,
          0,
          normal[0],
          normal[1],
          0,
          0,
          o[0] - (normal[0] * depth) / 2,
          o[1] - (normal[1] * depth) / 2,
          0,
          1,
        ] as never);
      const inside: Vec3 = [o[0] + u[0] * cx, o[1] + u[1] * cx, cz];
      return {
        solid,
        inside,
        corners: corners.map(([p, z]) => [p[0], p[1], Math.max(z, floor)] as Vec3),
      };
    };
    const solids: Manifold[] = [];
    const holes: Vec3[][] = K.map(() => []);
    const reach: Vec3[][] = K.map(() => []);
    const add = (o: ReturnType<typeof opening>, keys: number[], inside?: Vec3) => {
      if (!o) return;
      solids.push(o.solid);
      for (const k of keys) {
        holes[k].push(inside ?? o.inside);
        reach[k].push(...o.corners);
      }
    };
    for (let i = 0; i < n; i++) {
      const high = Math.max(...cutouts[i].keepClear.map((p) => p[2])) + SIZES.switchBelowPlate + 5;
      add(
        opening([
          [P[i], high],
          [P[i + 1], high],
          [P[i + 1], top[i + 1]],
          [K[i], upper[i]],
          [P[i], top[i]],
        ]),
        [i],
        // It is cut off at the plate's underside, so its middle may be solid;
        // it is open where it meets the cutout.
        cutouts[i].centre,
      );
      if (whole[i])
        add(
          opening([
            [P[i], floor],
            [P[i + 1], floor],
            [P[i + 1], low],
            [K[i], lower[i]],
            [P[i], low],
          ]),
          [i],
        );
    }
    // Half hexagons inside the end posts, where a cap beside the end key
    // closes the wall's end.
    for (const [key, post, end] of [
      [0, 0, 0],
      [n - 1, n, 1],
    ])
      if ((post === 0 || n > 1) && capped[end])
        add(
          opening([
            [P[post], whole[key] ? low : bottom(key)],
            [K[key], bottom(key)],
            [K[key], upper[key]],
            [P[post], top[post]],
          ]),
          [key],
        );
    for (let j = 1; j < n; j++)
      add(
        opening([
          [K[j - 1], bottom(j - 1)],
          ...(whole[j - 1] && whole[j] ? [[P[j], low] as [Plan, number]] : []),
          [K[j], bottom(j)],
          [K[j], upper[j]],
          [P[j], top[j]],
          [K[j - 1], upper[j - 1]],
        ]),
        [j - 1, j],
      );
    return { solids, holes, reach };
  };

  // A run of walls along one side of a row of keys, just outside the plate
  // edges: one segment per key, joined to its neighbours. Each segment follows
  // its plate's tilt down to the tile pocket's depth, then drops to the base. A
  // U cutout under each key shows its tile, leaving a post between
  // neighbouring keys and a strip along the base. An end segment takes in the
  // cap that closes the quarter round of a swept end beside it.
  const usedCaps = new Set<Cap>();
  const wallWindows: WallWindow[] = [];
  const wallOpenings: Manifold[] = [];
  const wallRun = (name: string, ns: string[], dir: Plan, caps: Cap[]) => {
    // Each segment is two hulls, the tilted part and the drop, so neither
    // reaches into the tile pocket on a rolled key.
    const segments: WallSegment[] = ns.map((n) => {
      const edge = edgeFacing(n, dir);
      const axis = facingAxis(edge);
      // The wall stands outside the plate's edge, so the tile pockets stay inside it.
      const inner = plateHalf[axis];
      const outer = inner + wallThickness;
      const dropTop = strip(n, edge, -pocketDepth, -pocketDepth, inner, outer);
      return {
        tilted: strip(n, edge, 0, -pocketDepth, inner, outer),
        tiltedLong: strip(
          n,
          edge,
          0,
          -pocketDepth,
          inner,
          outer,
          pocketHalf[1 - axis] + SIZES.wallPocketGap,
        ),
        underPlate: strip(n, edge, -plateThickness, -plateThickness, inner, outer),
        dropTop,
        onBase: mapStrip(dropTop, (p) => atHeight(p, SIZES.wallFoot)),
      };
    });
    const pieces = segments.flatMap((s) => [
      M.hull(stripPoints(s.tilted)),
      M.hull([...stripPoints(s.dropTop), ...stripPoints(s.onBase)]),
    ]);
    const cutouts = ns.map((n) => wallCutout(n, edgeFacing(n, dir)));
    // The caps the end segments join: each within capReach of the segment and
    // not already joined to another run.
    const joins: [number, Cap][] = [];
    for (const i of new Set([0, ns.length - 1]))
      for (const cap of caps) {
        const anchor = cap.round[0];
        if (
          usedCaps.has(cap) ||
          Math.min(...stripPoints(segments[i].tilted).map((p) => planDistance(p, anchor))) >=
            SIZES.capReach
        )
          continue;
        usedCaps.add(cap);
        joins.push([i, cap]);
      }
    const hexOn = (chassis.wall_pattern ?? 'hex') === 'hex';
    const hex = hexOn
      ? hexOpenings(
          segments.map((s) => s.dropTop),
          cutouts,
          [0, ns.length - 1].map((i) => joins.some(([k]) => k === i)),
        )
      : { solids: [], holes: ns.map(() => []), reach: ns.map(() => []) };
    // The plan points each segment's window must take in: its own strips, the
    // cap it joins, the corners of its hex pattern openings, and on each joint
    // side the neighbouring key's centre, so the post between them is inside
    // the window.
    const ownPoints = segments.map((s) => [...stripPoints(s.tilted), ...stripPoints(s.onBase)]);
    const windowPoints = segments.map((s, i) => [
      ...ownPoints[i],
      ...hex.reach[i],
      ...[ns[i - 1], ns[i + 1]].filter((n) => n).map((n) => keyCentre(n)),
    ]);
    for (const [i, cap] of joins) {
      const s = segments[i];
      const anchor = cap.round[0];
      windowPoints[i].push(...cap.round);
      // The cap's quarter round joins the tilted part, carried along past the
      // tile pocket; its drop to the base joins the segment's drop. The two
      // hulls share the carried part's bottom edge, so no gap opens between
      // them. The round's hull also takes in the drop's outer top corner: on
      // a rolled key the tilted part leans, and without it the outer face
      // has a shallow groove along that shared edge. The round's inside may
      // hold the corner of the tile pocket, so the cap is shaped around it.
      const near = (strip: Strip) => endPoints(endNearest(strip, anchor));
      const longEnd = endNearest(s.tiltedLong, anchor);
      pieces.push(
        M.hull([...near(s.tilted), ...near(s.tiltedLong)]),
        M.hull([
          ...near(s.tiltedLong),
          endNearest(s.dropTop, anchor).topOuter,
          ...cap.round,
        ]).subtract(pockets),
        M.hull([
          longEnd.bottomInner,
          longEnd.bottomOuter,
          ...near(s.dropTop),
          ...near(s.onBase),
          ...cap.round.slice(-2),
          ...cap.onBase,
        ]).subtract(pockets),
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
    }
    segments.forEach((s, i) => {
      const under = s.underPlate[0];
      const out = [under.topOuter[0] - under.topInner[0], under.topOuter[1] - under.topInner[1]];
      const l = Math.hypot(out[0], out[1]);
      const normal: Plan = [out[0] / l, out[1] / l];
      const alongOf = (p: number[]) => p[0] * -normal[1] + p[1] * normal[0];
      const acrossOf = (p: number[]) => p[0] * normal[0] + p[1] * normal[1];
      const along = windowPoints[i].map(alongOf);
      // Across the wall, the window takes in only the segment's own thickness.
      const across = ownPoints[i].map(acrossOf);
      const range = (xs: number[]): [number, number] => [Math.min(...xs), Math.max(...xs)];
      wallWindows.push({
        name: `${name}: ${ns[i]}`,
        normal,
        along: range(along),
        across: range(across),
        cutouts: [cutouts[i].centre, ...hex.holes[i]].map((c) => [alongOf(c), c[2]]),
      });
    });
    // With the hex pattern a cutout needs no round bottom: the opening above
    // the hexagons comes down to a point under the tile pocket.
    // The openings reach up past the plate's underside; the wall above it stays
    // whole. Each key keeps it across its own span: past the post to each
    // neighbour, or on to the cap past an end key. Between two keys it is kept
    // above the line from one plate's underside to the other's.
    const inner = (n: string) => plateHalf[facingAxis(edgeFacing(n, dir))];
    const aboveUnderside = ns.map((n, i) => {
      const edge = edgeFacing(n, dir);
      const axis = facingAxis(edge);
      const side = edge[0][axis];
      const e = frames[n].elements;
      const l = Math.hypot(e[axis ? 0 : 4], e[axis ? 1 : 5]);
      const alongDir: Plan = [e[axis ? 0 : 4] / l, e[axis ? 1 : 5] / l];
      const middle = (k: number): Plan => {
        const ps = stripPoints(segments[k].tilted);
        return [0, 1].map((j) => ps.reduce((t, q) => t + q[j], 0) / ps.length) as Plan;
      };
      const alongOf = (q: Plan) => {
        const p = keyCentre(n);
        return (q[0] - p[0]) * alongDir[0] + (q[1] - p[1]) * alongDir[1];
      };
      // To the post between this key and a neighbour, and past it.
      const reach = (sign: number) => {
        const k = [i - 1, i + 1].find(
          (k) => k >= 0 && k < ns.length && alongOf(middle(k)) * sign > 0,
        );
        if (k === undefined) return plateHalf[1 - axis] + SIZES.capReach;
        const [a, b] = [middle(i), middle(k)];
        return Math.abs(alongOf([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) + wallThickness;
      };
      const corners = [-reach(-1), reach(1)].flatMap((a) =>
        [plateHalf[axis] - 1, plateHalf[axis] + wallThickness + 5].flatMap((c) =>
          [-plateThickness, 50].map((z) => {
            const v: Vec3 = [0, 0, z];
            v[1 - axis] = a;
            v[axis] = side * c;
            return point(frames[n], v);
          }),
        ),
      );
      return M.hull(corners);
    });
    const above = (n: string) =>
      strip(n, edgeFacing(n, dir), 50, -plateThickness, inner(n) - 1, inner(n) + wallThickness + 5);
    const joints = ns.slice(1).map((b, i) => {
      const a = ns[i];
      return M.hull([
        ...endPoints(endNearest(above(a), keyCentre(b))),
        ...endPoints(endNearest(above(b), keyCentre(a))),
      ]);
    });
    const openings = M.union([
      ...cutouts.map((c) => (hexOn ? c.square : c.solid)),
      ...hex.solids,
    ]).subtract(M.union([...aboveUnderside, ...joints]));
    wallOpenings.push(openings);
    return M.union(pieces).subtract(openings);
  };
  const fingerCaps = fingerEnds.flatMap((s) => s.caps);
  for (const [c, dir] of outerColumns)
    parts.push(wallRun(`${c} column wall`, columnKeys(c), dir, fingerCaps));
  for (const [name, row, dir, i] of thumbWalls)
    if (row.length)
      parts.push(
        wallRun(
          name,
          row,
          dir,
          thumbRowEnds[i].flatMap((s) => s.caps),
        ),
      );
  // Caps on swept ends with no wall beside them. The round's inside can hold the
  // corner of the end key's tile pocket, so a cap closes the round only down to
  // the plate's underside; below that the round's end is open.
  for (const cap of [...fingerEnds, ...thumbRowEnds.flat()].flatMap((s) => s.caps))
    if (!usedCaps.has(cap))
      parts.push(
        M.hull(cap.round).subtract(
          place(
            M.cube([200, 200, 100], true).translate([0, 0, -plateThickness - 50]),
            frames[cap.key],
          ),
        ),
      );

  // Ribs along the base, so the footprint is connected without the bottom plate
  // and its outline is closed: both ends of the main thumb row to the fingers'
  // front, and the thumb rows' ends to each other. Each runs between the closest points of two base lines.
  // Ends are round and centred on the walls' mid-lines, clear of the lines'
  // ends, so they stay inside the walls.
  const rib = (lineA: Vec3[], lineB: Vec3[], height = SIZES.ribHeight) => {
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
        M.cylinder(height - SIZES.wallFoot, wallThickness / 2, wallThickness / 2, 24).translate([
          p[0],
          p[1],
          SIZES.wallFoot,
        ]),
      ),
    );
  };
  const [thumbEnds, extraEnds] = thumbRowEnds;
  if (thumbEnds.length) {
    for (const end of thumbEnds) parts.push(rib(end.baseLine, fingerEnds[1].baseLine));
    if (extraRowClose && extraEnds.length)
      for (const i of [0, 1]) parts.push(rib(thumbEnds[i].baseLine, extraEnds[i].baseLine));
  }

  const built = M.union(parts);
  const cleared = restsOn
    ? built.subtract(pockets).add(tileRests()).subtract(slidePaths())
    : built.subtract(pockets);
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
  const base = footprint
    .extrude(chassis.base_thickness_mm)
    .add(adapterMount(wasm, cfg, frames))
    .subtract(landingTunnels(wasm, cfg, frames));
  // The plate's half-widths toward a corner, out to the face of a wall beside it.
  const toWallFace = (n: string, [sx, sy]: Corner): HalfWidths => {
    const past = (edge: Edge) => (walled(n, edgeDirection(n, edge)) ? wallThickness : 0);
    return [
      plateHalf[0] +
        past([
          [sx, -1],
          [sx, 1],
        ]),
      plateHalf[1] +
        past([
          [-1, sy],
          [1, sy],
        ]),
    ];
  };
  const mount = trackpadMount(wasm, cfg, frames, keyPoint, toWallFace);
  const { housing: pod, sweep: podSweep } = trackpadHousing(wasm, cfg, frames);
  const pocketCut = built.add(mount).intersect(pockets);
  // The ribbon leaves through a notch in the wall it crosses.
  const notch = ribbonNotch(wasm, cfg, frames);
  // The thumb wires pass into the finger columns through a round port.
  const port = portHole(wasm, cfg, frames);
  wallOpenings.push(notch, port);
  const uncarved = cleared.add(mount).subtract(notch).subtract(port);
  let body = uncarved;
  // Room above each plate: the switch hole, the switch housing's rim up to the
  // keycap's lowest point, and the keycap with its clearance above that. What the
  // rim's and keycap's room remove is kept for the checks: it is chassis that was
  // built where a keycap goes.
  const capLowest = Math.max(0, sw.keycap_bottom_above_plate_mm - sw.travel_mm);
  const roomCuts: { name: string; cut: Manifold }[] = [];
  for (const n of keyNames) {
    const cap = capSize(cfg, n);
    const clearance =
      (sw.keycap_clearance_overrides_mm as Record<string, number>)[n] ?? sw.keycap_clearance_mm;
    const room = place(
      M.cube(
        [
          cap[0] + 2 * clearance + SIZES.keycapRoomExtra,
          cap[1] + 2 * clearance + SIZES.keycapRoomExtra,
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
    roomCuts.push({ name: n, cut: uncarved.intersect(keycapRoom) });
    body = body
      .subtract(place(M.cube([...sw.cutout_mm, SIZES.switchHoleHeight] as Vec3, true), frames[n]))
      .subtract(keycapRoom);
  }
  return {
    body,
    base,
    pod,
    podSweep,
    pocketCut,
    roomCuts,
    wallWindows,
    wallOpenings: M.union(wallOpenings),
  };
}

/**
 * The Cirque trackpad's housing, a separate print: a round cup with a recess
 * the pad sits in, a cavity under the pad for its parts (it rests on its
 * part-free outer ring), a slot in the floor for its cable, and a dovetail
 * tongue along its frame's +x axis. All of it is symmetric about the frame's
 * xz plane, so the mirrored left hand's mount takes the same housing. The
 * housing slides down onto the mount along the pad's normal and is held by a
 * screw up through the mount's floor into the tongue.
 */
export function trackpadHousing(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
) {
  const M = wasm.Manifold;
  const t = cfg.trackpad;
  const g = housingSizes(wasm, cfg);
  const cavity = t.parts_diameter_mm / 2 + t.cavity_clearance_mm;
  const recess = t.thickness_mm + t.top_below_rim_mm;
  const cavityDepth = recess + t.parts_depth_mm + t.cavity_clearance_mm;
  const [slotX, slotY] = t.cable_slot_mm;
  const housing = M.cylinder(t.pod_depth_mm, g.radius, g.radius, 96)
    .translate([0, 0, -t.pod_depth_mm])
    .add(g.tongue(0))
    .subtract(M.cylinder(recess + 1, g.padRadius, g.padRadius, 96).translate([0, 0, -recess]))
    .subtract(M.cylinder(cavityDepth + 1, cavity, cavity, 96).translate([0, 0, -cavityDepth]))
    .subtract(
      M.cube([slotX, slotY, t.pod_depth_mm + 2], true).translate([
        -t.connector_from_centre_mm,
        0,
        -t.pod_depth_mm / 2,
      ]),
    )
    .subtract(
      M.cylinder(
        t.pod_depth_mm,
        t.mount.screw_hole_mm / 2,
        t.mount.screw_hole_mm / 2,
        24,
      ).translate([g.screwX, 0, -t.pod_depth_mm - 0.5]),
    );
  // The way it slides up off its mount, along the pad's normal: the cup's and
  // the tongue's outlines swept up.
  const sweep = M.union(
    [
      M.cylinder(t.pod_depth_mm, g.radius, g.radius, 96).translate([0, 0, -t.pod_depth_mm]),
      g.tongue(0),
    ].map((x) => M.hull([x, x.translate([0, 0, SIZES.housingSlide])])),
  );
  return {
    housing: housing.transform(frames.trackpad.elements as never),
    sweep: sweep.transform(frames.trackpad.elements as never),
  };
}

/** Housing and mount sizes, in the trackpad's frame. */
function housingSizes(wasm: ManifoldToplevel, cfg: Config) {
  const t = cfg.trackpad;
  const m = t.mount;
  const padRadius = t.diameter_mm / 2 + t.clearance_mm;
  const radius = padRadius + t.pod_wall_mm;
  // The tongue reaches back into the cup's wall, where its side faces are inside the cup.
  const root = Math.sqrt(radius ** 2 - (m.tongue_root_mm / 2) ** 2) - 1;
  const tip = radius + m.tongue_length_mm;
  return {
    padRadius,
    radius,
    tip,
    screwX: radius + m.tongue_length_mm / 2,
    /** The dovetail tongue, grown by `grow` on its sides and bottom, and carried `up` above the rim. */
    tongue: (grow: number, up = 0) => {
      const w = (x: number) => (x - root) / (tip - root);
      const half = (x: number) =>
        (m.tongue_root_mm / 2) * (1 - w(x)) + (m.tongue_tip_mm / 2) * w(x) + grow;
      const xs = [root - grow, tip + grow];
      return new wasm.CrossSection([
        xs
          .map((x) => [x, -half(x)] as [number, number])
          .concat([...xs].reverse().map((x) => [x, half(x)] as [number, number])),
      ])
        .extrude(t.pod_depth_mm + grow + up)
        .translate([0, 0, -t.pod_depth_mm - grow]);
    },
  };
}
/**
 * The housing's mount on the body: a block beside the housing with the
 * dovetail slot, open at the top, and a floor with a screw hole, joined to the
 * two corners of the key it is mounted to nearest the block.
 */
function trackpadMount(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
  keyPoint: (n: string, corner: Corner, z: number, half: HalfWidths) => Vec3,
  toWallFace: (n: string, corner: Corner) => HalfWidths,
) {
  const M = wasm.Manifold;
  const t = cfg.trackpad;
  const m = t.mount;
  const g = housingSizes(wasm, cfg);
  const f = frames.trackpad;
  const key = t.mount_toward;
  const plateThickness = cfg.chassis.plate_thickness_mm;
  const c = m.slot_clearance_mm;
  const bottom = -t.pod_depth_mm - c - m.floor_mm;
  const half = m.tongue_tip_mm / 2 + c + m.wall_mm;
  const block = [g.radius + c, g.tip + c + m.wall_mm].flatMap((x) =>
    [-half, half].flatMap((y) => [0, bottom].map((z) => point(f, [x, y, z]))),
  );
  const centre = point(f, [g.screwX, 0, bottom / 2]);
  const nearest = (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as Corner[]
  )
    .map((corner) => ({ corner, p: keyPoint(key, corner, 0, toWallFace(key, corner)) }))
    .sort((a, b) => planDistance(a.p, centre) - planDistance(b.p, centre))
    .slice(0, 2);
  const solid = M.hull([
    ...block,
    ...nearest.flatMap(({ corner }) => [
      keyPoint(key, corner, 0, toWallFace(key, corner)),
      keyPoint(key, corner, -plateThickness, toWallFace(key, corner)),
    ]),
  ]);
  const up = 40;
  const clear = M.union([
    g.tongue(c, up),
    M.cylinder(t.pod_depth_mm + c + up, g.radius + c, g.radius + c, 96).translate([
      0,
      0,
      -t.pod_depth_mm - c,
    ]),
    M.cylinder(m.floor_mm + 2, m.screw_clearance_mm / 2, m.screw_clearance_mm / 2, 24).translate([
      g.screwX,
      0,
      bottom - 1,
    ]),
  ]).transform(f.elements as never);
  return solid.subtract(clear);
}

/**
 * The adapter's mount on the bottom plate: a boss with a peg through each of
 * its mounting holes, two rests under its other end, and the ribbon's landing.
 * Each reaches half a millimetre into the plate.
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
  const landing = landingBox(cfg);
  return M.union([
    ...a.mounting_holes_mm.flatMap(([x, y]) => [
      post(x, y, a.boss_diameter_mm, 0),
      post(x, y, a.peg_diameter_mm, bz + a.peg_above_mm),
    ]),
    ...[-1, 1].map((s) =>
      post(bx / 2 - SIZES.adapterRestIn, s * (by / 2 - 2), a.rest_diameter_mm, 0),
    ),
    M.cube(
      [landing.from - landing.to, landing.width, landing.top - landing.bottom + into],
      false,
    ).translate([landing.to, -landing.width / 2, landing.bottom - into]),
  ]).transform(frames.adapter.elements as never);
}

/** Two tunnels across the landing for cable ties, which pass over the ribbon. */
function landingTunnels(wasm: ManifoldToplevel, cfg: Config, frames: Record<string, Matrix4>) {
  const landing = landingBox(cfg);
  const [w, h] = cfg.ribbon.tie_slot_mm;
  return wasm.Manifold.union(
    [landing.from - SIZES.tieIn, landing.to + SIZES.tieIn].map((x) =>
      wasm.Manifold.cube([w, landing.width + 2, h], true).translate([
        x,
        0,
        landing.top - SIZES.tieBridge - h / 2,
      ]),
    ),
  ).transform(frames.adapter.elements as never);
}

/** The notch the ribbon leaves through: from the landing outward, low over the bottom plate. */
function ribbonNotch(wasm: ManifoldToplevel, cfg: Config, frames: Record<string, Matrix4>) {
  const r = cfg.ribbon;
  const landing = landingBox(cfg);
  const width = r.width_mm + 2 * r.notch_clearance_mm;
  const top = landing.top + r.thickness_mm + r.notch_clearance_mm;
  const bottom = landing.bottom - cfg.chassis.base_thickness_mm - 1;
  return wasm.Manifold.cube([SIZES.notchLength, width, top - bottom], false)
    .translate([landing.to - SIZES.notchLength, -width / 2, bottom])
    .transform(frames.adapter.elements as never);
}

/** The round hole the thumb wires pass through into the finger columns. */
function portHole(wasm: ManifoldToplevel, cfg: Config, frames: Record<string, Matrix4>) {
  const port = wirePort(cfg, frames);
  const ball = wasm.Manifold.sphere(port.diameter / 2, 24);
  return wasm.Manifold.hull([port.inside, port.outside].map((p) => ball.translate(p as Vec3)));
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
