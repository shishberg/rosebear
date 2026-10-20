// Chassis: chassis.style "skeletyl" (the default) is the open Skeletyl-style
// frame (skeletyl.ts) on a flat base plate; "c64" is the C64-styled shell
// (shell/) with the key plates in its wells. Both are built from the key poses.
// The C64:
// The shell is a hollow case parted along a groove all round: the case above
// it, and the bottom section below, which is the base the adapter stands on.
// In each well the plates make one sheet: each key's plate, joined to its
// neighbours' edge to edge, and reaching out on its other edges to the wall
// round the well. Under every plate a tile pocket is kept clear, open below
// to the hollow, so the tiles can be soldered from below with the base off.
// The ribbon leaves through the port panel on the finger bin's inner end.
// Both: each tile is held by glue posts under its plate (gluePosts): at each
// corner a round post stands in the tile's corner notch, filling it (but for
// the fit) from the tile's underside up into the plate, and along the two
// edges that face along the key's rib (its north and south on a finger key) a
// leg stands just outside the tile, the corner posts running on into it, from
// the plate's underside down to the tile's underside. The posts locate the tile; a
// shelf on each leg, just over the tile's top edge, sets its height. The tile is
// glued to the shelves and to the legs along its edges, and the glue holds it
// when a switch is pressed into its socket. On the Skeletyl the legs run on
// out past the plate's edge and go up into the web or the rib's end over
// them, their tops following its underside; in the C64's case they go up into
// the sheet.
//
// Terms:
//  tile         the small bought PCB under each switch (hotswap socket, LED, diode);
//  tile pocket  the space under a plate kept clear for the tile and its parts;
//  plate        the square a switch clips into, plate_thickness_mm thick and
//               plate_margin_mm past the switch seat on each side, or further if
//               needed to cover the tile and its clearance;
//  glue post    what holds a tile under its plate: a corner post in each corner
//               notch, and a leg, with a shelf over the tile's top edge, along
//               each edge facing along the rib;
//  rib          (the Skeletyl's) a run of keys along one key axis: each finger
//               column, and each thumb row (skeletyl.ts);
//  well         an opening through the shell's deck that a group of keys sits in.
//
// Coordinates: "key coordinates" are a key's own frame, with the origin at the
// plate top's centre, x and y across the plate and z along its normal (up is
// positive). A "half-width" is a distance from the key's centre along its x or y
// axis. "Plan" means the world XY plane.
import type { Manifold, ManifoldToplevel, Mat4, Vec3 } from 'manifold-3d';
import { Matrix4 } from 'three';
import {
  keycapEnvelope,
  isKey,
  isThumb,
  point,
  tileTop,
  tileUnderside,
  type Config,
} from './geometry';
import { clipBox, seatSettings } from './seats';
import {
  facetFloor,
  narrowPlates,
  plateHalfWidths,
  PLATES,
  sheet,
  tilePocketDepth,
  tilePocketHalf,
} from './plates';
import { capsule, down, freeAllBut, keycapSolid, place, slab } from './manifold-util';
import { shell } from './shell';
import { ribAxes, skeletyl } from './skeletyl';
import { landingBox, wiring, type Wiring } from './wiring';

/** Which chassis to build: "skeletyl" (the default) or "c64". */
export const chassisStyle = (cfg: Config) =>
  (cfg.chassis as { style?: string }).style === 'c64' ? 'c64' : 'skeletyl';

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
  /** For each key, how its glue posts were fitted to what stands round them (posts()). */
  postFits: Record<string, PostFit>;
}

/**
 * Construction sizes that are not in the config, in mm. Distances are in key
 * coordinates unless noted.
 */
export const SIZES = {
  /** Skirts stop this far above the parting line, as the walls round the wells do. */
  skirtFoot: 3.6,
  /** A wire's notch in a skirt has a radius this much more than the wire's. */
  skirtWireClear: 0.3,
  /** A skirt piece the notches leave is kept only if it overlaps the sheets or the case by this much (mm³). */
  skirtPiece: 0.5,
  /** Skirts keep this far clear of a tile's edge (plan): its edge pads, and a soldering iron's way up to them. */
  skirtClear: 1.5,
  /** The keycap's room is this much wider than the cap plus its clearance, in total. */
  keycapRoomExtra: 0.2,
  /** The keycap room's height above the cap's lowest point. */
  keycapRoomHeight: 60,
  /**
   * Glue posts are at least this thick: a leg outward from the tile's edge, a
   * corner post across. Four 0.4 mm lines, two perimeters a side, the fewest a
   * 0.4 mm nozzle lays as a solid wall without gap fill; thinner prints as two
   * lines or a gap fill and snaps off.
   */
  postMin: 1.6,
  /** Glue posts stand this far off the tile's edges and its corner notches: the fit, which the glue fills. */
  postGap: 0.15,
  /**
   * Below the tile's top, a leg runs along its edge from the plate's side in
   * to this far from the centre: clear of the edge pads (the outermost's side
   * is 5.25 from it) and the wires that leave them across the edge.
   */
  postFrom: 6.25,
  /** A shelf stays this far clear of a tile hole's ring (a wire's end may stand through it). */
  glueHoleGap: 0.5,
  /** A piece of shelf left shorter than this between the holes is dropped. */
  glueMin: 1,
  /** Glue posts stay this far outside the switch seat, so nothing stands in its trim. */
  glueSeatGap: 0.1,
  /**
   * Glue posts reach this far up into the plate, and the legs this far up into
   * whatever is over them, following its underside: they meet it on a surface,
   * not at a slit or a near-coincident face.
   */
  glueInto: 0.3,
  /** The glue between a shelf and the tile's top. */
  glueLayer: 0.15,
  /** Sides of a corner post's round. */
  postSegments: 32,
  /** A post's boxes overlap this much where they meet, so no face is shared. */
  postOverlap: 0.05,
  /**
   * A leg whose outer face stands within postFill of the frame (or another
   * key's posts) beside it below the shelf, a slit too narrow to print
   * cleanly (as the Skeletyl fuses drops closer than fuseGap), is grown out
   * into it, postInto past where it is nearest.
   */
  postFill: 1.5,
  postInto: 0.4,
  /**
   * A grown leg keeps out of the room kept for another key's tile, posts and
   * switch: inside its legs, from this far under the tile (for its parts) up
   * to the plate's top.
   */
  postRoom: 2,
  /**
   * The posts go up into the plate up to this far inside its edge (along the
   * rib), clear of the crease where its underside turns into the web or the
   * round; and the legs, which run on past the edge, stop this far inside the
   * sides of what is over them, up in it.
   */
  postEdgeIn: 0.15,
  /**
   * On the Skeletyl, the underside over the legs (the plate's, and past its
   * edge the web's to the next key or the round of the rib's end) is sampled
   * about this far apart, along the rib and across it, for the legs' tops to
   * follow it glueInto up into it.
   */
  postStep: 0.25,
  /**
   * What a leg's top follows is an underside where its outward normal points
   * at least this much down (in key coordinates); a steeper face is a side of
   * the frame, which the leg's top meets at its edge instead of climbing it.
   */
  postUnder: 0.5,
  /** The adapter's rests stand this far in from its hole edge. */
  adapterRestIn: 7,
  /** Skeletyl tie tunnels: centres this far in from the landing's ends, tops this far under its top. */
  tieIn: 2.75,
  tieBridge: 1,
  /** The Skeletyl's ribbon notch reaches this far out from the landing. */
  notchLength: 40,
} as const;

/** A box in key coordinates: its centre and size. */
export interface KeyBox {
  center: Vec3;
  size: Vec3;
}

/**
 * What stands over a key's legs and band at one edge: the key z of its
 * underside (`z[i][j]`) over a grid of points, `al[i]` out from the centre
 * along the rib and `ac[j]` across it, as the frame's mesh has it (posts()).
 */
export interface Over {
  al: number[];
  ac: number[];
  z: number[][];
}

/** How a key's glue posts are fitted to what stands round them, at each edge along its rib ([the -1 edge's, the +1 edge's]: posts()). */
export interface PostFit {
  /** How far the leg is grown out along the rib. */
  grow: [number, number];
  /**
   * The underside over each edge's legs and band, which they follow glueInto
   * up into it (the Skeletyl's). Without it they go glueInto up into the
   * plate (the C64's sheet).
   */
  over?: [Over, Over];
}

/** Posts fitted to nothing: not grown, and up into the plate. */
export const plainFit: PostFit = { grow: [0, 0] };

/**
 * The glue posts under a key's plate, in key coordinates, for a key whose rib
 * runs along key axis `axis` (0: x, 1: y), on the two tile edges facing along
 * it (its north and south where that is y):
 * - a leg along each edge, postMin thick, postGap outside the tile's edge (a
 *   band, from glueInto up into what is over it down to glueLayer over the
 *   tile's top, the whole width of the plate), and at each end of the edge on
 *   down to the tile's underside, from the plate's side in to postFrom (clear
 *   of the edge pads and their wires). It stands 1.4 out past the plate's
 *   edge, under the web to the next key or the round of the rib's end, and
 *   goes up into that too: `fit` (PostFit, from posts()) has the underside
 *   over each edge's legs, and how far each is grown outward. The legs and
 *   band (`legs`, per edge) are boxes up to their highest; postSolid() shapes
 *   their tops;
 * - a shelf on each leg, from glueInto up into the plate (postEdgeIn inside
 *   its edge, and across stopping where the legs do: postSolid() cuts them
 *   as one) down to glueLayer over the tile's top, reaching in over
 *   the tile's top edge to the switch seat (and glueSeatGap): it sets the
 *   tile's height. It is broken where a hole is near the edge (glueHoleGap
 *   clear of its ring);
 * - a corner post in each corner's notch: a round, concentric with it,
 *   postGap smaller than it, from the tile's underside up into the plate
 *   (with its edge's legs, postSolid()). It is whole wherever it is clear:
 *   along the rib it runs on into its edge's leg, across it stops where the
 *   legs do (postEdgeIn inside the plate's side), and above the tile it keeps
 *   glueSeatGap off the switch body (by default it is clear of it). The
 *   seat's trim under the plate (seatSwitches) leaves it.
 * The glue (`glue`) is where the tile meets them: under the shelves, on its
 * top edge, and between its edges and the legs' ends.
 */
export function gluePosts(cfg: Config, axis: number, fit: PostFit = plainFit) {
  const grow = fit.grow;
  const tile = cfg.tile;
  const half = tile.size_mm.map((x) => x / 2);
  const across = 1 - axis;
  const top = -cfg.chassis.plate_thickness_mm + SIZES.glueInto;
  const bottom = tileUnderside(cfg);
  const tileTopZ = tileTop(cfg);
  const shelf = tileTopZ + SIZES.glueLayer;
  const notch = tile.corner_notch_radius_mm;
  const seat = seatSettings(cfg).outer.map((x) => x / 2 + SIZES.glueSeatGap);
  const plateHalf = plateHalfWidths(cfg);
  const side = plateHalf[across];
  const inner = half[axis] + SIZES.postGap;
  const thick = inner + SIZES.postMin;
  // How far out along the rib the posts go up into the plate: to its edge.
  const edge = Math.max(inner + SIZES.postOverlap, plateHalf[axis] - SIZES.postEdgeIn);
  const keep = tile.pads.ring_mm / 2 + SIZES.glueHoleGap;
  const holes = tile.pads.list.filter((h) => h.hole).map((h) => h.at_mm);
  // The tile's straight edge ends where its corner notches begin.
  const straight = half[across] - notch;
  const boxes: KeyBox[] = [];
  const legs: [KeyBox[], KeyBox[]] = [[], []];
  const glue: KeyBox[] = [];
  // A box over [along, across, z] ranges at edge s (-1 or 1) along: along
  // out from the centre, across as signed.
  const box = (s: number, al: number[], ac: number[], z: number[]): KeyBox => {
    const c: number[] = [];
    const size: number[] = [];
    c[axis] = (s * (al[0] + al[1])) / 2;
    size[axis] = al[1] - al[0];
    c[across] = (ac[0] + ac[1]) / 2;
    size[across] = ac[1] - ac[0];
    return {
      center: [c[0], c[1], (z[0] + z[1]) / 2],
      size: [size[0], size[1], z[1] - z[0]],
    };
  };
  for (const s of [-1, 1]) {
    const i = (s + 1) / 2;
    const outer = thick + grow[i];
    // The legs and band go up to the highest of what is over them, and
    // glueInto into it; postSolid() shapes their tops to it.
    const over = fit.over?.[i];
    const legTop = over ? Math.max(...over.z.flat()) + SIZES.glueInto : top;
    // Up in what is over them, they stop postEdgeIn inside its sides, which
    // run on from the plate's (a face flush with a side leaves a sheet of
    // nothing where it meets the side's edge); in the plate alone (the C64's
    // sheet) they are cut back there with the rest, above its underside.
    const end = over ? side - SIZES.postEdgeIn : side;
    legs[i].push(box(s, [inner, outer], [-end, end], [shelf, legTop]));
    for (const t of [-1, 1]) {
      const ac = [t * SIZES.postFrom, t * end].sort((a, b) => a - b);
      legs[i].push(box(s, [inner, outer], ac, [bottom, legTop]));
      const run = [t * SIZES.postFrom, t * straight].sort((a, b) => a - b);
      if (SIZES.postFrom < straight) glue.push(box(s, [half[axis], inner], run, [bottom, shelf]));
    }
    // The shelf, in the stretches clear of the holes.
    let runs: [number, number][] = [[-side, side]];
    for (const h of holes) {
      const al = s * h[axis];
      if (al + keep <= seat[axis] || al - keep >= half[axis]) continue;
      runs = runs.flatMap(([a, b]): [number, number][] => [
        [a, Math.min(b, h[across] - keep)],
        [Math.max(a, h[across] + keep), b],
      ]);
    }
    for (const [a, b] of runs) {
      // (None where the seat is as wide as the plate: the legs alone hold it.)
      if (b - a < SIZES.glueMin - 1e-9 || edge - seat[axis] < 1e-9) continue;
      boxes.push(box(s, [seat[axis], edge], [a, b], [shelf, top]));
      const [ga, gb] = [Math.max(a, -straight), Math.min(b, straight)];
      if (gb - ga > 1e-9 && half[axis] - seat[axis] > 1e-9)
        glue.push(box(s, [seat[axis], half[axis]], [ga, gb], [tileTopZ, shelf]));
    }
  }
  const corners = [-1, 1].flatMap((x) =>
    [-1, 1].map((y): [number, number] => [x * half[0], y * half[1]]),
  );
  return {
    /** The shelves. */
    boxes,
    /** Each edge's legs and band ([the -1 edge's, the +1 edge's]), up to their highest. */
    legs,
    /** How far across the rib each edge's legs (and its corner posts) reach, and how high the legs go. */
    legEnds: [0, 1].map((i) => legs[i][0].size[across] / 2) as [number, number],
    legTops: [0, 1].map((i) => legs[i][0].center[2] + legs[i][0].size[2] / 2) as [number, number],
    glue,
    /** The corner posts' centres (the notches'), and their radius. */
    corners,
    radius: notch - SIZES.postGap,
    /** How far from the centre the posts reach: across the rib (the plate's side), and along it. */
    reach: [side, thick + Math.max(...grow)] as [number, number],
    /** How far out along the rib each edge's leg starts and ends, before it is grown. */
    inner,
    outer: thick,
    /** How far out along the rib the posts go up into the plate. */
    edge,
    seat,
    top,
    shelf,
    bottom,
  };
}

/**
 * The solid under `over`'s underside raised by `dz`, in key coordinates at
 * edge s along key axis `axis`, from `floor` up: its grid's cells, each split
 * in two, run on flat (as at the grid's edge) a little past it, so whatever is
 * cut by it keeps its own sides.
 */
function underOver(
  wasm: ManifoldToplevel,
  over: Over,
  axis: number,
  s: number,
  dz: number,
  floor: number,
) {
  // (In along the rib, past the corner posts' rounds, which reach in
  // postGap and their radius inside the legs.)
  const pad = 2;
  const al = [over.al[0] - pad, ...over.al, over.al.at(-1)! + pad];
  const ac = [over.ac[0] - pad, ...over.ac, over.ac.at(-1)! + pad];
  const clamp = (i: number, n: number) => Math.min(Math.max(i - 1, 0), n - 1);
  const z = (i: number, j: number) =>
    over.z[clamp(i, over.al.length)][clamp(j, over.ac.length)] + dz;
  const [n, m] = [al.length, ac.length];
  const verts: number[] = [];
  const at = (a: number, c: number, h: number) => {
    const p: number[] = [];
    p[axis] = s * a;
    p[1 - axis] = c;
    p[2] = h;
    return verts.push(...p) / 3 - 1;
  };
  const up = al.map((a, i) => ac.map((c, j) => at(a, c, z(i, j))));
  const down = al.map((a) => ac.map((c) => at(a, c, floor)));
  const tris: number[] = [];
  // Each triangle turned to face `out`.
  const tri = (a: number, b: number, c: number, out: number[]) => {
    const p = [a, b, c].map((k) => verts.slice(3 * k, 3 * k + 3));
    const u = [0, 1, 2].map((k) => p[1][k] - p[0][k]);
    const v = [0, 1, 2].map((k) => p[2][k] - p[0][k]);
    const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    tris.push(
      ...(nrm[0] * out[0] + nrm[1] * out[1] + nrm[2] * out[2] >= 0 ? [a, b, c] : [a, c, b]),
    );
  };
  const quad = (a: number, b: number, c: number, d: number, out: number[]) => {
    tri(a, b, c, out);
    tri(a, c, d, out);
  };
  const dir = (dAl: number, dAc: number, dz: number) => {
    const d: number[] = [];
    d[axis] = s * dAl;
    d[1 - axis] = dAc;
    d[2] = dz;
    return d;
  };
  for (let i = 0; i + 1 < n; i++)
    for (let j = 0; j + 1 < m; j++) {
      quad(up[i][j], up[i + 1][j], up[i + 1][j + 1], up[i][j + 1], [0, 0, 1]);
      quad(down[i][j], down[i + 1][j], down[i + 1][j + 1], down[i][j + 1], [0, 0, -1]);
    }
  for (let i = 0; i + 1 < n; i++)
    for (const [j, d] of [
      [0, -1],
      [m - 1, 1],
    ])
      quad(up[i][j], up[i + 1][j], down[i + 1][j], down[i][j], dir(0, d, 0));
  for (let j = 0; j + 1 < m; j++)
    for (const [i, d] of [
      [0, -1],
      [n - 1, 1],
    ])
      quad(up[i][j], up[i][j + 1], down[i][j + 1], down[i][j], dir(d, 0, 0));
  const solid = new wasm.Manifold(
    new wasm.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(verts),
      triVerts: new Uint32Array(tris),
    }),
  );
  if (solid.status() !== 'NoError') throw new Error(`underOver: ${solid.status()}`);
  return solid;
}

/**
 * A key's glue posts as one solid, in key coordinates (gluePosts). Each
 * edge's legs, shelves and corner rounds are one union, cut once across (at
 * its legs' ends), at the tile's underside and at the top, so the rounds
 * share the legs' faces rather than meeting them on coincident ones. Where
 * `fit` has the underside over an edge's legs and band, their tops (and the
 * shelves' and rounds') follow it glueInto up into it (gluePosts has them
 * postEdgeIn inside the plate's sides).
 */
export function postSolid(
  wasm: ManifoldToplevel,
  cfg: Config,
  axis: number,
  fit: PostFit = plainFit,
) {
  const M = wasm.Manifold;
  const g = gluePosts(cfg, axis, fit);
  const across = 1 - axis;
  // Clear of the switch's clip reliefs, which are cut from the case but not
  // from its bottom section, where a low key's posts may stand.
  const reliefs = M.union([-1, 1].map((s) => clipBox(M, cfg, new Matrix4(), s)));
  // The switch body under the plate, glueSeatGap wider: all a corner post
  // keeps clear of above the tile (by default the rounds are clear of it).
  const sw = cfg.switch;
  const bodyBottom = -sw.body_below_plate_mm;
  const body = M.cube(
    [sw.body_mm[0] + 2 * SIZES.glueSeatGap, sw.body_mm[1] + 2 * SIZES.glueSeatGap, 20 - bodyBottom],
    true,
  ).translate([0, 0, (20 + bodyBottom) / 2]);
  // Up in the plate, postEdgeIn inside its sides too: a face flush with a
  // side leaves a sheet of nothing where it meets the side's edge.
  const plate = cfg.chassis.plate_thickness_mm;
  const sides = (floor: number, roof: number) =>
    M.union(
      [-1, 1].map((s) => {
        const size: number[] = [];
        const c: number[] = [];
        size[axis] = 2 * g.reach[1] + 4;
        c[axis] = 0;
        size[1 - axis] = 2;
        c[1 - axis] = s * (g.reach[0] - SIZES.postEdgeIn + 1);
        return M.cube([size[0], size[1], roof - floor], true).translate([
          c[0],
          c[1],
          (roof + floor) / 2,
        ]);
      }),
    );
  const flat: Manifold[] = [];
  const shaped: Manifold[] = [];
  g.legs.forEach((legs, i) => {
    const s = 2 * i - 1;
    const over = fit.over?.[i];
    const end = g.legEnds[i];
    // Fitted to what is over them, the edge's posts' tops are shaped by it
    // (underOver); in the plate alone they stop glueInto up in it.
    const roof = over ? g.legTops[i] + 2 : g.top;
    // Each of the edge's boxes (its legs and shelves) runs on 1 past the faces
    // the edge's one cut makes (across at its legs' ends, the tile's
    // underside, the top), so they and the corner posts that stand in them
    // share those faces, not just meet on them.
    const run = (b: KeyBox) => {
      const lo = b.center.map((c, k) => c - b.size[k] / 2);
      const hi = b.center.map((c, k) => c + b.size[k] / 2);
      if (hi[across] > end - 1e-9) hi[across] += 1;
      if (lo[across] < -end + 1e-9) lo[across] -= 1;
      if (lo[2] < g.bottom + 1e-9) lo[2] -= 1;
      if (hi[2] > g.top - 1e-9) hi[2] += 1;
      return M.cube(hi.map((x, k) => x - lo[k]) as Vec3).translate(lo as Vec3);
    };
    const shelves = g.boxes.filter((b) => Math.sign(b.center[axis]) === s);
    // The corner posts at this edge: the whole round of each (concentric with
    // its notch, postGap clear of it) from the tile's underside up into the
    // plate, merging into the leg it stands in along the rib, and kept clear
    // only of the switch body above the tile.
    const rounds = g.corners
      .filter((c) => Math.sign(c[axis]) === s)
      .map(([x, y]) =>
        M.cylinder(roof - g.bottom + 2, g.radius, g.radius, SIZES.postSegments).translate([
          x,
          y,
          g.bottom - 1,
        ]),
      );
    const size: number[] = [];
    size[axis] = 2 * g.reach[1] + 4;
    size[across] = 2 * end;
    const clip = M.cube([size[0], size[1], roof - g.bottom], true).translate([
      0,
      0,
      (roof + g.bottom) / 2,
    ]);
    const solid = M.union([
      ...[...legs, ...shelves].map(run),
      M.union(rounds).subtract(body),
    ]).intersect(clip);
    if (!over) return flat.push(solid);
    shaped.push(solid.intersect(underOver(wasm, over, axis, s, SIZES.glueInto, g.bottom - 1)));
  });
  return M.union([
    M.union(flat).subtract(sides(-plate + SIZES.postOverlap, g.top + 1)),
    ...shaped,
  ]).subtract(reliefs);
}

/**
 * Which key axis each key's glue posts face along: the Skeletyl's rib's
 * (ribAxes), and y (north and south) on every key of the C64, whose plates
 * make one sheet.
 */
export function postAxes(cfg: Config, frames: Record<string, Matrix4>) {
  const keys = Object.keys(frames).filter(isKey);
  if (chassisStyle(cfg) === 'c64') return Object.fromEntries(keys.map((n) => [n, 1]));
  return ribAxes(cfg, frames);
}

/**
 * Every key's glue posts, placed, each fitted (PostFit) to `around` (the
 * frame or case they are added to) and the other keys' posts: a leg whose
 * outer face stands within postFill of them beside it is grown out into them
 * (postFill, postInto: past where they are nearest, or where they are at its
 * foot if further), not into the room kept under another key's plate, nor
 * into what a leg stands on across its whole width (the tie). On the
 * Skeletyl each edge's legs and band follow the underside of what is over
 * them (the plate's, and past its edge the web's or the rib end's), sampled
 * every postStep or so from its mesh, glueInto up into it. In the C64's case
 * they go up into the sheet.
 */
function posts(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
  around: Manifold,
) {
  const M = wasm.Manifold;
  const axes = postAxes(cfg, frames);
  const keys = Object.keys(frames).filter(isKey);
  const plain = [0, 1].map((axis) => postSolid(wasm, cfg, axis));
  const target = around.add(M.union(keys.map((n) => place(plain[axes[n]], frames[n]))));
  const c64 = chassisStyle(cfg) === 'c64';
  const fits: Record<string, PostFit> = {};
  const solids: Manifold[] = [];
  // The room kept for a key's tile, posts and switch: inside its legs, from
  // below the tile's parts up to the plate's top.
  const bottom = tileUnderside(cfg);
  const inner = cfg.tile.size_mm.map((x) => x + 2 * SIZES.postGap);
  const room = M.cube([inner[0], inner[1], SIZES.postRoom - bottom], true).translate([
    0,
    0,
    (bottom - SIZES.postRoom) / 2,
  ]);
  for (const n of keys) {
    // (Freeing what each key's fitting makes on the way.)
    const own = freeAllBut(
      wasm,
      () => {
        const axis = axes[n];
        const g = gluePosts(cfg, axis);
        const inverse = new Matrix4().copy(frames[n]).invert().elements as Mat4;
        // A box over [along, across, z] ranges, in key coordinates.
        const box = (al: number[], ac: number[], z: number[]) => {
          const lo: number[] = [];
          const hi: number[] = [];
          [lo[axis], hi[axis]] = [Math.min(...al), Math.max(...al)];
          [lo[1 - axis], hi[1 - axis]] = [Math.min(...ac), Math.max(...ac)];
          return M.cube([hi[0] - lo[0], hi[1] - lo[1], z[1] - z[0]]).translate([
            lo[0],
            lo[1],
            z[0],
          ]);
        };
        const near = (m: Manifold, i: number, f: (v: number) => number) => {
          const mesh = m.getMesh();
          let best = Infinity;
          for (let j = i; j < mesh.vertProperties.length; j += mesh.numProp)
            best = Math.min(best, f(mesh.vertProperties[j]));
          return best;
        };
        const grow = [-1, 1].map((s) => {
          // What stands past the leg's outer face (from just off it), beside it
          // below the shelf.
          const probe = box(
            [s * (g.outer + 0.01), s * (g.outer + 0.01 + SIZES.postFill)],
            [-g.reach[0], g.reach[0]],
            [g.bottom, g.shelf],
          );
          const met = target.intersect(place(probe, frames[n])).transform(inverse);
          if (met.isEmpty()) return 0;
          // Out to where it is nearest, or where it is at the leg's foot if that
          // is further (it leans away from the leg going down).
          const foot = met.intersect(
            box(
              [s * g.outer, s * (g.outer + 0.02 + SIZES.postFill)],
              [-g.reach[0], g.reach[0]],
              [g.bottom, g.bottom + 0.1],
            ),
          );
          const at = (m: Manifold) => near(m, axis, (v) => s * v - g.outer);
          // Not into what a leg stands on (the tie, under its whole width): its
          // top left past the grown leg would be a ledge.
          const stands = [-1, 1].some((t) => {
            const under = around
              .intersect(
                place(
                  box(
                    [s * g.inner, s * g.outer],
                    [t * SIZES.postFrom, t * g.reach[0]],
                    [g.bottom, g.shelf],
                  ),
                  frames[n],
                ),
              )
              .transform(inverse);
            const w = 0.05;
            return (
              !under.isEmpty() &&
              near(under, 1 - axis, (v) => t * v) <= SIZES.postFrom + w &&
              near(under, 1 - axis, (v) => -t * v) <= -g.reach[0] + w
            );
          });
          if (stands) return 0;
          return Math.max(at(met), foot.isEmpty() ? 0 : at(foot)) + SIZES.postInto;
        }) as [number, number];
        // The underside over each edge's legs and band, from the shelf up, as
        // `around`'s mesh has it: where a vertical line through each point of a
        // grid over them first meets it (at the shelf where it is in it there).
        const overs = c64
          ? undefined
          : ([-1, 1].map((s, k): Over => {
              const spread = (a: number, b: number, at: number[]) => {
                const marks = [a, ...at.filter((x) => x > a && x < b), b];
                return marks
                  .slice(1)
                  .flatMap((x, i) => {
                    const p = marks[i];
                    const steps = Math.max(1, Math.ceil((x - p) / SIZES.postStep - 1e-9));
                    return [...Array(steps).keys()].map((j) => p + ((x - p) * j) / steps);
                  })
                  .concat([b]);
              };
              const plateHalf = plateHalfWidths(cfg)[axis];
              const out = g.outer + grow[k];
              const al = spread(g.inner, out, [g.edge, plateHalf, g.outer]);
              // (Across, postEdgeIn inside the plate's sides, where postSolid()
              // stops the legs up in what is over them.)
              const side = g.reach[0] - SIZES.postEdgeIn;
              const ac = spread(-side, side, [-SIZES.postFrom, SIZES.postFrom]);
              const reach = 0.1;
              const mesh = around
                .intersect(
                  place(
                    box(
                      [s * (g.inner - reach), s * (out + reach)],
                      [-g.reach[0] - reach, g.reach[0] + reach],
                      [g.shelf, 5],
                    ),
                    frames[n],
                  ),
                )
                .transform(inverse)
                .getMesh();
              const v = mesh.vertProperties;
              const tv = mesh.triVerts;
              const p = (k: number) => [
                s * v[k * mesh.numProp + axis],
                v[k * mesh.numProp + 1 - axis],
                v[k * mesh.numProp + 2],
              ];
              // Where a vertical line through each point crosses the frame's
              // faces: [z, how much the face's outward normal points up].
              const crossings = al.map(() => ac.map((): [number, number][] => []));
              // (The mirror and the swap of along and across turn the faces.)
              const turn = s * (axis === 0 ? 1 : -1);
              for (let t = 0; t < tv.length; t += 3) {
                const [a, b, c] = [tv[t], tv[t + 1], tv[t + 2]].map(p);
                const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
                if (Math.abs(det) < 1e-12) continue;
                const [d, f] = [b, c].map((q) => q.map((x, k) => x - a[k]));
                const cross = [d[1] * f[2] - d[2] * f[1], d[2] * f[0] - d[0] * f[2], det];
                const up = (turn * det) / Math.hypot(...cross);
                const lo = [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1])];
                const hi = [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1])];
                al.forEach((x, i) => {
                  if (x < lo[0] - 1e-6 || x > hi[0] + 1e-6) return;
                  ac.forEach((y, j) => {
                    if (y < lo[1] - 1e-6 || y > hi[1] + 1e-6) return;
                    const u = ((b[0] - x) * (c[1] - y) - (c[0] - x) * (b[1] - y)) / det;
                    const w = ((c[0] - x) * (a[1] - y) - (a[0] - x) * (c[1] - y)) / det;
                    const e = 1 - u - w;
                    if (Math.min(u, w, e) < -1e-6) return;
                    crossings[i][j].push([u * a[2] + w * b[2] + e * c[2], up]);
                  });
                });
              }
              // The underside over each point: where the line first goes into the
              // frame, or, where it is in the frame at the shelf (the rail, or a
              // wall a grown leg goes into), first goes back in after leaving it.
              // NaN where there is none, or where the line goes in through a side
              // (steeper than postUnder: the frame narrower there than the plate,
              // its side leaning over the leg where the key is tilted to it), or
              // stays in the frame all the way up.
              const z = crossings.map((r) =>
                r.map((list) => {
                  const sorted = list.sort((x, y) => x[0] - y[0]);
                  let k = 0;
                  if (sorted.length && sorted[0][0] < g.shelf + 1e-4) {
                    k = sorted.findIndex(([, up]) => up > 0);
                    if (k < 0) return NaN;
                    while (k < sorted.length && sorted[k][1] > 0) k++;
                  }
                  if (k >= sorted.length) return NaN;
                  const [h, up] = sorted[k];
                  return -up >= SIZES.postUnder ? h : NaN;
                }),
              );
              // Each such point takes the nearest point's that has an underside.
              const hits = z.flatMap((r, i) => r.flatMap((h, j) => (isNaN(h) ? [] : [[i, j, h]])));
              if (!hits.length) throw new Error(`glue posts: nothing over ${n}'s legs`);
              for (const [i, r] of z.entries())
                for (const [j, h] of r.entries())
                  if (isNaN(h)) {
                    const d = ([a, b]: number[]) => Math.hypot(al[a] - al[i], ac[b] - ac[j]);
                    r[j] = hits.reduce((p, q) => (d(q) < d(p) ? q : p))[2];
                  }
              // Each point then takes the highest of its own and its neighbours',
              // so where the underside steps down between two points (a wall or
              // bone coming down beside the leg's end) the leg's top runs up into
              // the higher side's level over the step, rather than sloping
              // across under it and closing a hollow there.
              const up = z.map((r, i) =>
                r.map((_, j) =>
                  Math.max(
                    ...[i - 1, i, i + 1].flatMap((a) =>
                      [j - 1, j, j + 1].map((b) => z[a]?.[b] ?? -Infinity),
                    ),
                  ),
                ),
              );
              return { al, ac, z: up };
            }) as [Over, Over]);
        fits[n] = overs ? { grow, over: overs } : { grow };
        const plainOwn = place(postSolid(wasm, cfg, axis, { ...fits[n], grow: [0, 0] }), frames[n]);
        if (!grow.some((x) => x > 0)) return plainOwn;
        // Grown, but not into the room kept under another key's plate. (One
        // cut of the grown posts, which hold the plain ones, rather than a
        // union of the two: their coincident faces left zero-volume slivers
        // where a wall crosses a leg's end.)
        const rooms = M.union(keys.filter((k) => k !== n).map((k) => place(room, frames[k])));
        return place(postSolid(wasm, cfg, axis, fits[n]), frames[n]).subtract(
          rooms.subtract(plainOwn),
        );
      },
      (m) => [m],
    );
    solids.push(own);
  }
  return { solid: M.union(solids), fits };
}

/** The space under every plate for its tile and the switch body: cut out of the case. */
function pockets(
  M: ManifoldToplevel['Manifold'],
  cfg: Config,
  frames: Record<string, Matrix4>,
  keyNames: string[],
) {
  const plateThickness = cfg.chassis.plate_thickness_mm;
  const sw = cfg.switch;
  // The tile, its components and the switch body, below the plate.
  const pocketDepth = tilePocketDepth(cfg);
  const pocketHalf = tilePocketHalf(cfg);
  return M.union(
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
            PLATES.switchBelowPlate - plateThickness,
          ],
          true,
        ).translate([0, 0, -(PLATES.switchBelowPlate + plateThickness) / 2]),
        frames[n],
      ),
    ]),
  );
}

/**
 * The skirts round both wells' edges, under their plates. Each stops on the
 * other sheet, is notched where the wires pass, and drops any piece the
 * notches leave standing on its own.
 */
function skirts(
  M: ManifoldToplevel['Manifold'],
  cfg: Config,
  frames: Record<string, Matrix4>,
  keyNames: string[],
  fingers: ReturnType<typeof sheet>,
  thumbs: ReturnType<typeof sheet>,
  case_: Manifold,
  split: number,
  wired: Wiring,
) {
  const plateThickness = cfg.chassis.plate_thickness_mm;
  // Each tile, its edge pads and a soldering iron's way up to them (along the
  // key's axis) stay clear.
  const tileBottom = tileUnderside(cfg);
  const [hx, hy] = tilePocketHalf(cfg).map((h) => h + SIZES.skirtClear);
  const keepClear = M.union(
    keyNames.map((n) => {
      return M.hull(
        down(
          [-plateThickness, tileBottom, tileBottom - cfg.wiring.solder_access_mm[1]].flatMap((z) =>
            [-hx, hx].flatMap((x) => [-hy, hy].map((y) => point(frames[n], [x, y, z]))),
          ),
        ),
      );
    }),
  );
  const aboveFoot = M.cube([1000, 1000, 400]).translate([-500, -500, split + SIZES.skirtFoot]);
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
        return reaches ? [capsule(M, p, q, r, 8)] : [];
      });
    }),
  );
  const sheetsAndCase = M.union([fingers.cores, thumbs.cores, fingers.rest, thumbs.rest, case_]);
  return M.union(
    unnotched
      .subtract(wireWays)
      .decompose()
      .filter((p) => p.intersect(sheetsAndCase).volume() > SIZES.skirtPiece),
  );
}

/**
 * Room above each plate: the switch hole, the switch housing's rim up to the
 * keycap's lowest point, and the keycap with its clearance above that (a box,
 * the cap's base wide, well above it). cutters removes it; roomCuts is what it
 * removes from where the rim and the keycap go (tapered as measured, from
 * pressed to rest, with its clearance), for the checks: chassis that stands
 * where a keycap goes. (The box's corners above the cap's taper are not.)
 */
function keycapRooms(
  M: ManifoldToplevel['Manifold'],
  cfg: Config,
  frames: Record<string, Matrix4>,
  keyNames: string[],
  uncarved: Manifold,
) {
  const sw = cfg.switch;
  const seat = seatSettings(cfg).outer;
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
    const capGoes = place(keycapSolid(M, env), frames[n]);
    roomCuts.push({ name: n, cut: uncarved.intersect(rim ? capGoes.add(rim) : capGoes) });
    cutters.push(rim ? room.add(rim) : room);
  }
  return { cutters, roomCuts };
}

export function buildChassis(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
  // The wires and the shell, when the caller has made them already.
  wired: Wiring = wiring(cfg, frames),
  given?: ReturnType<typeof shell>,
): ChassisResult {
  if (chassisStyle(cfg) === 'skeletyl') return skeletylChassis(wasm, cfg, frames, wired);
  const built = given ?? shell({ wasm, cfg, frames });
  const M = wasm.Manifold;
  const keyNames = Object.keys(frames).filter(isKey);
  const [fingerWell, thumbWell] = built.wells;
  const fingers = sheet(
    M,
    cfg,
    frames,
    keyNames.filter((n) => n.startsWith('matrix_')),
    fingerWell,
    narrowPlates(cfg),
    facetFloor(cfg),
  );
  const thumbs = sheet(M, cfg, frames, keyNames.filter(isThumb), thumbWell);
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
  // Neither well's reaches and joins run on in under the other's sheet.
  const plates = M.union([
    fingers.cores,
    thumbs.cores,
    fingers.rest.subtract(thumbs.below),
    thumbs.rest.subtract(fingers.below),
    skirts(M, cfg, frames, keyNames, fingers, thumbs, case_, built.split, wired),
  ]);
  const solid = case_.add(plates);
  const carved = solid.subtract(pockets(M, cfg, frames, keyNames));
  const held = freeAllBut(
    wasm,
    () => posts(wasm, cfg, frames, carved),
    (h) => [h.solid],
  );
  const uncarved = carved.add(held.solid);
  const { cutters, roomCuts } = keycapRooms(M, cfg, frames, keyNames, uncarved);
  // All at once: one boolean against the whole case, not two per key.
  const whole = uncarved.subtract(M.union(cutters));
  // The case above the parting groove's bottom, and the bottom section below
  // it with the adapter's mount, less the ribbon's slot.
  const below = slab(M, whole.boundingBox(), 20, -1, built.split + 1);
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
    postFits: held.fits,
  };
}

/**
 * The Skeletyl: its frame with the glue posts, on a base plate inside its
 * outline (skin_mm thick, the frame's rail standing on the floor in it). The
 * plate carries the adapter's mount and the ribbon's landing, which ends where
 * the ribbon leaves through a notch in the frame. The frame's bridges keep
 * clear of the wires.
 */
function skeletylChassis(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
  wired: Wiring,
): ChassisResult {
  const M = wasm.Manifold;
  const CS = wasm.CrossSection;
  const keyNames = Object.keys(frames).filter(isKey);
  const built = skeletyl(wasm, cfg, frames, wired.wires);
  const held = freeAllBut(
    wasm,
    () => posts(wasm, cfg, frames, built.frame),
    (h) => [h.solid],
  );
  const framed = built.frame.add(held.solid);
  // The base plate: inside the outline the frame stands on.
  const footprint = new CS([built.outline], 'NonZero');
  // The landing, in the adapter's frame, from `out` (where the ribbon leaves) in to its end.
  const r = cfg.ribbon;
  const land = landingBox(cfg);
  const out = land.end - land.length;
  const into = 0.5;
  const adapter = frames.adapter;
  const landing = place(
    M.cube([land.length, land.width, land.top - land.bottom + into]).translate([
      out,
      -land.width / 2,
      land.bottom - into,
    ]),
    adapter,
  );
  const [tw, th] = r.tie_slot_mm;
  const tunnels = place(
    M.union(
      [out + SIZES.tieIn, land.end - SIZES.tieIn].map((x) =>
        M.cube([tw, land.width + 2, th], true).translate([
          x,
          0,
          land.top - SIZES.tieBridge - th / 2,
        ]),
      ),
    ),
    adapter,
  );
  const base = footprint
    .extrude(cfg.chassis.skin_mm)
    .add(adapterMount(wasm, cfg, frames))
    .add(landing)
    .subtract(tunnels);
  // The ribbon's notch, from the landing out, low over the base plate.
  const width = r.width_mm + 2 * r.notch_clearance_mm;
  const top = land.top + r.thickness_mm + r.notch_clearance_mm;
  const bottom = land.bottom - cfg.chassis.skin_mm - 1;
  const notch = place(
    M.cube([SIZES.notchLength, width, top - bottom]).translate([
      out - SIZES.notchLength,
      -width / 2,
      bottom,
    ]),
    adapter,
  );
  const uncarved = framed.subtract(notch);
  // The keycap rooms are only checked: the frame is built clear of them.
  const { roomCuts } = keycapRooms(M, cfg, frames, keyNames, uncarved);
  const e = adapter.elements;
  return {
    body: uncarved,
    base,
    trim: M.union([]),
    // The landing's outer end, in world x (as the C64's panel face, for the ribbon's path).
    panel: e[12] + e[0] * out,
    // The frame stands 1 mm into the plate: its footprint just above the floor
    // must be one area, as the C64's just above its parting line.
    split: 0,
    roomCuts,
    postFits: held.fits,
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
  return place(
    M.union([
      ...a.mounting_holes_mm.flatMap(([x, y]) => [
        post(x, y, a.boss_diameter_mm, 0),
        post(x, y, a.peg_diameter_mm, bz + a.peg_above_mm),
      ]),
      ...[-1, 1].map((s) =>
        post(bx / 2 - SIZES.adapterRestIn, s * (by / 2 - 2), a.rest_diameter_mm, 0),
      ),
    ]),
    frames.adapter,
  );
}
