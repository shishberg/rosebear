/**
 * PROTOTYPE ?hand — throwaway. A test frame for the hand layout: a wireframe
 * that holds each switch where the layout puts it, to print and try for feel;
 * no wiring room, walls or bottom. Print it with the slicer's (tree) supports.
 *
 * - Each key: a plate ring round its switch hole, with a lip down its outside
 *   edge to stiffen it. Under the plate, the switch's clips have the pocket.
 * - Neighbours (the finger matrix's rows and columns, the thumb keys, and any
 *   thumb and finger keys that come close) are joined by a web between their
 *   facing walls, and the matrix's four-key corners are filled. Where one key
 *   sits well above the other, the web is a steep wall; one too thin to print is
 *   left out, the truss and the other webs holding its keys (a fault if the
 *   frame comes apart without it).
 * - Legs hold them up. Each plate of joined keys stands on its
 *   outer corners: from each, a bracket out and down clear of its switch,
 *   on a leg straight down. Where a bar leaves a plate it widens to a
 *   column in the plate's corner, the strut's width, from the plate top down
 *   the lip (between two keys, halfway between their corners'): the plate
 *   takes the whole of it, and nothing stands above the plate or off it. A truss stiffens each outside wall between
 *   them, |\/\/\/|: under each key along it, a diagonal from each end of
 *   its side (the corner's leg, or the web to the next key, on a bracket
 *   like a corner's where the switches hang out past the wall) down to one
 *   foot under the side's middle, moved out until both clear the switches;
 *   where the plate's too low for a diagonal of 30° or more, a post. A
 *   rail runs round each plate's outline, from foot to foot; where the
 *   thumb's and fingers' keys are one plate, another runs between them,
 *   round the thumb's side facing the fingers. A foot on neither has no
 *   rail to stand on, so its legs, diagonals and posts are left out. A rail
 *   ties the thumb's plate to the fingers' where they're apart. A press that would push the frame well outside its base is a
 *   warning.
 * - Every switch (down past its pins), keycap (pressed to rest) and switch top
 *   is cut out of all of it except the switch seats (the clip land round each
 *   hole); where that leaves one hitting a seat or the frame, the result says
 *   so.
 */
import type { Manifold, ManifoldToplevel, Vec3 } from 'manifold-3d';
import { Matrix4, Vector3 } from 'three';
import { meshData, freeAfter, place as moved } from '../manifold-util';
import {
  add,
  capSize,
  cross,
  dot,
  scale,
  sub,
  unit,
  keycapEnvelope,
  capTop,
  componentFrames,
  isThumb,
  point,
  ROWS,
  type Cluster,
  type Config,
  type MeshData,
} from '../geometry';

/** Sizes in mm. */
const FRAME = {
  /** The plate ring past the switch pocket. */
  wall: 1.6,
  /** How far the ring's outside lip reaches down from the plate top. */
  lip: 3,
  /** Below the switch body: MX pins (3.3 mm) clear of the desk. */
  pins: 3.5,
  /** The clip land round each hole that nothing else may cut, past the pocket. */
  land: 0.8,
  /** Keys whose plates are this close (edge to edge) or closer are joined. */
  joinGap: 10,
  /** The thinnest a web may be: slicers drop thinner walls. */
  thin: 1.2,
  /** The floor rails: width and height. */
  rail: [3, 2],
  /** How far a corner's bracket reaches out past it, and down (more, in
   * these steps, up to twelve, until its leg misses everything). */
  bracket: 4,
  /** The struts' square. */
  strut: 2.4,
  /** Between a strut and a switch or keycap. */
  strutClear: 0.3,
  /** Round the keycap (pressed to rest) and the switch's top housing. */
  capMargin: 0.5,
  /** A press that pushes further than this outside the base (seen from the
   * keycap corner) warns that it may tip the frame. */
  tip: 10,
};

/** The room round key `n`'s keycap, pressed to rest and a margin above it. */
const capRoom = (cfg: Config, n: string) => {
  const e = keycapEnvelope(cfg, n, { clearance: FRAME.capMargin });
  return {
    half: e.base.map((x) => x / 2),
    from: e.floor,
    to: e.z0 + e.height + FRAME.capMargin,
  };
};

export type FrameResult = {
  /** In the editor's world frame; the floor is at `floor`. */
  mesh: MeshData;
  floor: number;
  /** Width, depth and height. */
  size: Vec3;
  pieces: number;
  /** What's wrong: seats cut, keycaps hitting the frame. */
  faults: string[];
  /** What may be wrong: presses that may tip it; and the webs left out. */
  warnings: string[];
  /** In cm³, without supports. */
  volume: number;
  /** The truss's members along the plates' outside walls: the key each
   * is under, its side (axis, 0 across or 1 along the column, and sign) and
   * which end of it (-1 or 1) it leaves the plate at. A diagonal leaves from
   * a corner's leg, the gap to the next key along, or the plate itself; a
   * post (a gap too low for a diagonal) goes straight down. Where it leaves
   * (its top) and its foot. */
  truss: {
    key: string;
    side: [number, number];
    end: number;
    node: 'corner' | 'gap' | 'plate' | 'post';
    top: Vec3;
    foot: Vec3;
  }[];
  /** The webs left out, too thin to print: the keys each was between. */
  websLeftOut: [string, string][];
  /** The floor rails, from foot to foot. */
  rails: [Vec3, Vec3][];
};

/** The keys the hand lays out: the finger matrix and the thumb row, and the
 * extra thumb keys if `extra`. */
function frameKeys(cfg: Config, extra: boolean) {
  const g = cfg.geometry as { thumb_extra?: Cluster } & typeof cfg.geometry;
  return [
    ...g.columns.flatMap((c) => ROWS.map((r) => `matrix_${c.name}_${r}`)),
    ...[g.thumb, ...(extra && g.thumb_extra ? [g.thumb_extra] : [])].flatMap((cl) =>
      cl.keys.map((k) => `thumb_${k.name}`),
    ),
  ];
}

export const label = (n: string) => n.replace(/^matrix_/, '').replace('_', ' ');

/** Where pressing each corner of each key's cap top pushes the frame: the
 * press, along the switch, met with the floor (keys facing within 80° of
 * sideways only; one facing further pushes the frame along the desk). */
function presses(
  cfg: Config,
  frames: ReturnType<typeof componentFrames>,
  keys: string[],
  floor: number,
) {
  return keys.flatMap((key) => {
    const e = frames[key].elements,
      n = [e[8], e[9], e[10]],
      half = capTop(cfg, key).map((x) => x / 2),
      top = cfg.switch.keycap_bottom_above_plate_mm + capSize(cfg, key)[2];
    if (n[2] < Math.cos((80 * Math.PI) / 180)) return [];
    return [-1, 1].flatMap((sx) =>
      [-1, 1].map((sy) => {
        const p = point(frames[key], [sx * half[0], sy * half[1], top]),
          k = (p[2] - floor) / n[2];
        return { key, corner: [sx, sy], from: p, at: [p[0] - n[0] * k, p[1] - n[1] * k] };
      }),
    );
  });
}
/** The convex hull of points in the plane, anticlockwise. */
function convex(ps: number[][]) {
  const s = [...ps].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    turn = (o: number[], a: number[], b: number[]) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]),
    half = (pts: number[][]) => {
      const h: number[][] = [];
      for (const p of pts) {
        while (h.length > 1 && turn(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
        h.push(p);
      }
      return h.slice(0, -1);
    };
  return [...half(s), ...half(s.reverse())];
}
/** How far point p is inside a convex polygon (anticlockwise), mm; negative outside. */
function inside(poly: number[][], p: number[]) {
  return Math.min(
    ...poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length],
        l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / l;
    }),
  );
}

/** The farthest, mm, a bracket reaches out and down, a gap node is raised, and a
 * truss foot stands out from its wall. */
const REACH = FRAME.bracket * 12;

/** Raise `b` from `b0` by `step` until `ok(b)` or `max`; the `b` it stops at. */
function extend(b0: number, ok: (b: number) => boolean, step = FRAME.bracket, max = REACH) {
  let b = b0;
  while (b < max && !ok(b)) b += step;
  return b;
}

/** Whether a diagonal from `p` down to the floor point `f` stands 30° or more. */
const steepFrom = (p: Vec3, f: Vec3, floor: number) =>
  p[2] - floor > Math.tan(Math.PI / 6) * Math.hypot(p[0] - f[0], p[1] - f[1]);

/** The boxes (half x/y, z from, z to; in the key's frame) the frame keeps out
 * of: the switch's hole, its pocket down past the pins, the keycap's room
 * pressed to rest, and the switch top under it. */
type KeepOut = [half: number[], z0: number, z1: number];
function keepOutBoxes(cfg: Config, n: string): KeepOut[] {
  const sw = cfg.switch,
    plate = sw.clip_land_thickness_mm,
    pocket = sw.seat_outer_mm.map((x) => x / 2),
    hole = sw.cutout_mm.map((x) => (x + sw.cutout_clearance_mm) / 2),
    deep = -(sw.body_below_plate_mm + FRAME.pins),
    pressed = sw.keycap_bottom_above_plate_mm - sw.travel_mm,
    room = capRoom(cfg, n);
  return [
    [hole, -plate - 0.5, 0.5],
    [pocket, -plate, deep],
    [room.half, room.from, room.to],
    [pocket, 0.05, pressed],
  ];
}

/** Whether a strut of radius `r` from a to b clears every switch and keycap
 * (the keep-out boxes of each key, in its frame). The Manifold hulls are built
 * from the same boxes, in either z order, so this takes the min and max z. */
function clearOf(
  cfg: Config,
  frames: ReturnType<typeof componentFrames>,
  keys: string[],
  r: number,
) {
  const boxes = keys.map((n) => ({
    inv: frames[n].clone().invert(),
    boxes: keepOutBoxes(cfg, n).map(([h, z0, z1]) => [
      [-h[0] - r, -h[1] - r, Math.min(z0, z1) - r],
      [h[0] + r, h[1] + r, Math.max(z0, z1) + r],
    ]),
  }));
  return (a: Vec3, b: Vec3) => {
    const steps = Math.ceil(Math.hypot(...a.map((x, i) => x - b[i])));
    for (const k of boxes)
      for (let i = 0; i <= steps; i++) {
        const p = point(
          k.inv,
          a.map((x, j) => x + ((b[j] - x) * i) / steps),
        );
        if (k.boxes.some(([lo, hi]) => p.every((x, j) => x > lo[j] && x < hi[j]))) return false;
      }
    return true;
  };
}

/** `extra`: the extra thumb keys are the hand's too. */
export function buildFrame(wasm: ManifoldToplevel, cfg: Config, extra = false): FrameResult {
  return freeAfter(wasm, () => makeFrame(wasm, cfg, extra));
}

/** What every stage works from: the keys, their frames and the plate geometry. */
function setup(wasm: ManifoldToplevel, cfg: Config, extra: boolean) {
  const sw = cfg.switch,
    frames = componentFrames(cfg),
    keys = frameKeys(cfg, extra),
    pocket = sw.seat_outer_mm.map((x) => x / 2),
    hp = pocket.map((x) => x + FRAME.wall),
    deep = -(sw.body_below_plate_mm + FRAME.pins),
    at = (n: string, x: number, y: number, z: number) => point(frames[n], [x, y, z]),
    box = (n: string, h: number[], z0: number, z1: number) =>
      [-1, 1].flatMap((sx) =>
        [-1, 1].flatMap((sy) => [z0, z1].map((z) => at(n, sx * h[0], sy * h[1], z))),
      ),
    axis = (n: string, i: number) => frames[n].elements.slice(i * 4, i * 4 + 3),
    lowest = (ps: Vec3[]) => Math.min(...ps.map((p) => p[2])),
    centre = (n: string) => frames[n].elements.slice(12, 15),
    /** Which side of key n faces key m: its axis (0 across, 1 along the
     * column) and sign. */
    side = (n: string, m: string) => {
      const d = sub(centre(m), centre(n)),
        out = [0, 1].map((i) => dot(axis(n, i), d)),
        ax = Math.abs(out[0]) / hp[0] > Math.abs(out[1]) / hp[1] ? 0 : 1;
      return [ax, Math.sign(out[ax]) || 1];
    };
  return {
    M: wasm.Manifold,
    cfg,
    frames,
    keys,
    plate: sw.clip_land_thickness_mm,
    pocket,
    hp,
    hole: sw.cutout_mm.map((x) => (x + sw.cutout_clearance_mm) / 2),
    deep,
    at,
    box,
    axis,
    centre,
    floor: Math.min(...keys.map((n) => lowest(box(n, hp, deep, deep)))),
    dist3: (n: string, m: string) => Math.hypot(...centre(n).map((x, i) => x - centre(m)[i])),
    corners: [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [sx, sy])),
    /** Key n's corner (sx, sy) where a bar leaves it: the strut's square
     * inside the plate's corner, from the plate top to the lip's bottom. */
    column: (n: string, [sx, sy]: number[]) =>
      [0, 1].flatMap((i) =>
        [0, 1].flatMap((j) =>
          [0, -FRAME.lip].map((z) =>
            at(n, sx * (hp[0] - i * FRAME.strut), sy * (hp[1] - j * FRAME.strut), z),
          ),
        ),
      ),
    side,
    /** Key n's wall facing key m (the ring's side, a wall thick, the
     * plate top to the lip's bottom): its corners. */
    edge: (n: string, m: string) => {
      const [ax, s] = side(n, m);
      return [hp, pocket].flatMap((d) =>
        [-1, 1].flatMap((t) =>
          [0, -FRAME.lip].map((z) =>
            ax === 0 ? at(n, s * d[0], t * hp[1], z) : at(n, t * hp[0], s * d[1], z),
          ),
        ),
      );
    },
  };
}
type Ctx = ReturnType<typeof setup>;
type Web = { n: string; m: string; web: Manifold };

function makeFrame(wasm: ManifoldToplevel, cfg: Config, extra: boolean) {
  const c = setup(wasm, cfg, extra),
    faults: string[] = [],
    { joined, webs, solids } = joinsAndWebs(c),
    keep = keepOut(c),
    bars = barTools(c),
    sides = joinedSides(c, joined),
    allLegs = buildLegs(c, bars, sides),
    allTruss = buildTruss(c, bars, joined, sides, allLegs),
    plan = planRails(c, joined, [...allLegs, ...allTruss]),
    legs = { legs: allLegs.filter((l) => plan.kept.has(l.foot)) },
    truss = { truss: allTruss.filter((m) => plan.kept.has(m.foot)) },
    built = barsOf(c, bars, legs.legs, allLegs, truss.truss);
  faults.push(...built.faults);
  solids.push(...built.solids, ...plan.rails.map(([a, b]) => bars.rail(a, b)));
  const warnings = tipWarnings(c, [...legs.legs, ...truss.truss]);

  // Nothing below the floor: the slicer would support it. The webs go in
  // last: one too thin to print is left out (a hole) if the frame holds
  // together without it, the truss and the other webs holding its keys.
  const joints = c.M.union(solids),
    body = c.M.union([joints, ...pads(c, joints, [...legs.legs, ...truss.truss])]),
    cut = keep.keepOut.subtract(keep.lands),
    build = (ws: Web[]) =>
      c.M.union([body, ...ws.map((x) => x.web)])
        .trimByPlane([0, 0, 1], c.floor)
        .subtract(cut),
    whole = build(webs),
    thinned = dropThinWebs(c, build, webs, whole),
    { solid, left } = thinned;
  faults.push(...thinned.faults, ...keyFaults(c, keep, solid));
  warnings.push(...thinned.warnings);

  const real = piecesOf(solid),
    out = c.M.union(real),
    bb = out.boundingBox(),
    mesh = meshData(out);
  return {
    mesh,
    floor: c.floor,
    size: [0, 1, 2].map((i) => bb.max[i] - bb.min[i]) as Vec3,
    pieces: real.length,
    faults,
    warnings,
    volume: out.volume() / 1000,
    truss: truss.truss.map(({ key, side, end, node, foot, post }) => ({
      key,
      side,
      end,
      node: post ? ('post' as const) : node.kind,
      top: node.top,
      foot,
    })),
    websLeftOut: left.map(({ n, m }) => [n, m] as [string, string]),
    rails: plan.rails,
  };
}

/** The pieces of a solid, leaving out the zero-volume slivers flush cuts leave. */
const piecesOf = (s: Manifold) => s.decompose().filter((p) => p.volume() > 1);

/** Each key's ring and lip, the joins (the finger matrix by rows and columns;
 * thumb keys and anything else whose plates come within joinGap) with a web
 * each, and the matrix's four-key corners, the corner of each nearest the
 * middle. The hole and pocket are cut out later. */
function joinsAndWebs(c: Ctx) {
  const { M, keys, hp, plate, box, centre, edge, dist3, cfg } = c,
    solids: Manifold[] = keys.map((n) => M.hull(box(n, hp, 0, -FRAME.lip))),
    joined: [string, string][] = [],
    cols = cfg.geometry.columns.map((x) => x.name),
    grid = (ci: number, ri: number) => `matrix_${cols[ci]}_${ROWS[ri]}`;
  cols.forEach((_, ci) =>
    ROWS.forEach((_, ri) => {
      if (ci + 1 < cols.length) joined.push([grid(ci, ri), grid(ci + 1, ri)]);
      if (ri + 1 < ROWS.length) joined.push([grid(ci, ri), grid(ci, ri + 1)]);
    }),
  );
  const near = 2 * Math.max(...hp) + FRAME.joinGap;
  keys.forEach((n, i) =>
    keys.slice(i + 1).forEach((m) => {
      if ((isThumb(n) || isThumb(m)) && dist3(n, m) < near) joined.push([n, m]);
    }),
  );
  const webs: Web[] = joined.map(([n, m]) => ({
    n,
    m,
    web: M.hull([...edge(n, m), ...edge(m, n)]),
  }));
  for (let ci = 0; ci + 1 < cols.length; ci++)
    for (let ri = 0; ri + 1 < ROWS.length; ri++) {
      const four = [grid(ci, ri), grid(ci + 1, ri), grid(ci, ri + 1), grid(ci + 1, ri + 1)],
        mid = [0, 1].map((k) => four.reduce((s, n) => s + centre(n)[k], 0) / 4),
        corner = (n: string) =>
          box(n, hp, 0, 0).reduce((a, b) =>
            Math.hypot(a[0] - mid[0], a[1] - mid[1]) < Math.hypot(b[0] - mid[0], b[1] - mid[1])
              ? a
              : b,
          ),
        pts = four.map(corner);
      solids.push(M.hull([...pts, ...pts.map((p) => [p[0], p[1], p[2] - plate] as Vec3)]));
    }
  return { joined, webs, solids };
}

/** What the frame keeps out of (see keepOutBoxes). Nothing cuts a clip land:
 * the land round each hole, past the pocket. */
function keepOut(c: Ctx) {
  const { M, keys, pocket, plate, box, hole, cfg } = c,
    outer = pocket.map((x) => x + FRAME.land),
    through = (n: string, z = -plate - 0.5) => box(n, hole, z, 0.5),
    land = Object.fromEntries(
      keys.map((n) => [
        n,
        M.hull(box(n, outer, -plate, 0)).subtract(M.hull(through(n, -plate - 1))),
      ]),
    ),
    lands = M.union(Object.values(land)),
    hulls = (n: string, from: number, to?: number) =>
      keepOutBoxes(cfg, n)
        .slice(from, to)
        .map(([h, z0, z1]) => M.hull(box(n, h, z0, z1))),
    switchAt = (n: string) => M.union(hulls(n, 0, 2)),
    room = Object.fromEntries(keys.map((n) => [n, hulls(n, 2)])),
    keepOut = M.union(keys.flatMap((n) => [switchAt(n), ...room[n]]));
  return { land, lands, switchAt, room, keepOut };
}

/** The bars: a floor rail, a square strut, a knot where struts meet, and
 * whether a strut clears the switches and keycaps. */
function barTools(c: Ctx) {
  const { M, cfg, frames, keys, corners, floor } = c,
    [w, h] = FRAME.rail,
    r = FRAME.strut / 2,
    /** The corners of a square bar's end at b, from a, one side level (a
     * vertical one's too, so a leg stands flat on the floor). */
    end = (a: Vec3, b: Vec3) => {
      const d = sub(b, a),
        f = d.map((x) => x / Math.hypot(...d)),
        side = Math.hypot(f[0], f[1]) < 1e-6 ? [1, 0, 0] : [f[1], -f[0], 0],
        u = side.map((x) => x / Math.hypot(...side)),
        v = cross(f, u);
      return corners.map(([su, sv]) => b.map((x, i) => x + r * (su * u[i] + sv * v[i])) as Vec3);
    },
    /** The corners of a level square at b, square to the world, so the bars
     * meeting at a foot share it. */
    flat = (_a: Vec3, b: Vec3) =>
      corners.map(([sx, sy]) => [b[0] + sx * r, b[1] + sy * r, b[2]] as Vec3);
  return {
    /** A rectangular bar on the floor from a to b, past each end by half
     * its width so bars meeting at an angle overlap. */
    rail: (a: number[], b: number[]) => {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]),
        d = [(b[0] - a[0]) / l, (b[1] - a[1]) / l],
        u = [-d[1], d[0]];
      return M.hull(
        [a, b].flatMap((p, e) =>
          [-1, 1].flatMap((s) =>
            [floor, floor + h].map(
              (z) =>
                [
                  p[0] + ((e ? 1 : -1) * d[0] + s * u[0]) * (w / 2),
                  p[1] + ((e ? 1 : -1) * d[1] + s * u[1]) * (w / 2),
                  z,
                ] as Vec3,
            ),
          ),
        ),
      );
    },
    /** A square bar from a to b; down to the floor (`foot`), it stands on a
     * level square there (a slanted end would hang just above the floor). */
    strut: (a: Vec3, b: Vec3, foot = false): Manifold[] =>
      // A bar of rounding-noise length still has a direction; only none at all has no bar.
      a.every((x, i) => x === b[i]) ? [] : [M.hull([...end(b, a), ...(foot ? flat : end)(a, b)])],
    /** A bar from a plate to b, as `strut`: from the plate's corner column
     * (`anchor`) to the bar's square at b. */
    fan: (anchor: Vec3[], b: Vec3, foot = false) => {
      const mid = anchor.reduce((s, p) => add(s, p), [0, 0, 0]).map((x) => x / anchor.length);
      return M.hull([...anchor, ...(foot ? flat : end)(mid as Vec3, b)]);
    },
    knot: (p: Vec3) =>
      M.hull(
        corners.flatMap(([sx, sy]) =>
          [-r, r].map((dz) => [p[0] + sx * r, p[1] + sy * r, p[2] + dz] as Vec3),
        ),
      ),
    clear: clearOf(cfg, frames, keys, r + FRAME.strutClear),
  };
}
type Bars = ReturnType<typeof barTools>;

/** The sides that face a joined neighbour, as `"key axis,sign"`. */
const joinedSides = (c: Ctx, joined: [string, string][]) =>
  new Set(joined.flatMap(([n, m]) => [`${n} ${c.side(n, m)}`, `${m} ${c.side(m, n)}`]));

/** The legs, on each plate's outer corners (see the header): the corners whose
 * key has no neighbour across either of its sides. */
function buildLegs(c: Ctx, { clear }: Bars, sides: Set<string>) {
  const { keys, corners, hp, at, floor } = c;
  return keys.flatMap((key) =>
    corners
      .filter(([sx, sy]) => !sides.has(`${key} ${[0, sx]}`) && !sides.has(`${key} ${[1, sy]}`))
      .map(([sx, sy]) => {
        const reach = (b: number) => {
            const top = at(key, sx * (hp[0] + b), sy * hp[1], -FRAME.lip - b);
            return { top, foot: [top[0], top[1], floor] as Vec3 };
          },
          b = extend(FRAME.bracket, (b) => clear(reach(b).top, reach(b).foot));
        return { key, corner: [sx, sy], ...reach(b) };
      }),
  );
}

type Leg = ReturnType<typeof buildLegs>[number];
/** A truss node: a leg's top (`corner`), a spot on a plate's corner (`plate`),
 * or a gap between two keys' walls (`gap`), which can move out and down on a
 * bracket `b` mm along `reach`, from `home` halfway down the wall's edge. A
 * bar from it that leaves the plate widens to `anchor`, the corner's column
 * (a gap's: halfway between its keys'). */
type Fixed = { kind: 'corner' | 'plate'; top: Vec3; anchor: Vec3[] };
type Gap = {
  kind: 'gap';
  top: Vec3;
  b: number;
  home: Vec3;
  anchor: Vec3[];
  reach: (b: number) => Vec3;
};
type Node = Fixed | Gap;
type Span = {
  key: string;
  side: [number, number];
  out: number[];
  ends: { t: number; node: Node }[];
};
type Member = { key: string; side: [number, number]; end: number; node: Node; foot: Vec3 };

/** Whether a node is on the plate, not out on a bracket or a leg. */
const onPlate = (node: Node) => node.kind === 'plate' || (node.kind === 'gap' && !node.b);

/** Move a gap's node out on its bracket by another step. */
const raise = (g: Gap) => {
  g.b += FRAME.bracket;
  g.top = g.reach(g.b);
};

/** The truss (see the header). Its top chord is the plate's edge, its bottom
 * chord the rail, its ends the corner legs. A gap's node sits halfway down the
 * web's outside wall, or out on a bracket where a diagonal from there can't
 * miss the switches. */
function buildTruss(
  c: Ctx,
  { clear }: Bars,
  joined: [string, string][],
  sides: Set<string>,
  legs: Leg[],
) {
  const { keys, hp, axis, at, floor, side, column } = c,
    /** Which corner of a key is at end `t` of its side `ax`, `s`. */
    signs = (ax: number, s: number, t: number) => (ax === 0 ? [s, t] : [t, s]),
    /** Key n's plate corner at end `t` of its side `ax`, `s`. */
    cornerOf = (n: string, ax: number, s: number, t: number, z: number) => {
      const [sx, sy] = signs(ax, s, t);
      return at(n, sx * hp[0], sy * hp[1], z);
    },
    nodes = new Map<string, Node>(),
    end = (n: string, ax: number, s: number, t: number) => `${n} ${ax} ${s} ${t}`;
  for (const { key, corner, top } of legs) {
    const [sx, sy] = corner,
      node: Fixed = { kind: 'corner', top, anchor: column(key, corner) };
    nodes.set(end(key, 0, sx, sy), node);
    nodes.set(end(key, 1, sy, sx), node);
  }
  // The gaps: between two joined keys, along a side of each that has no
  // neighbour, facing the same way.
  for (const [n, m] of joined) {
    const [a, sa] = side(n, m),
      [a2, sa2] = side(m, n);
    for (const t of [-1, 1]) {
      const outN = axis(n, 1 - a).map((x) => x * t),
        t2 = Math.sign(dot(axis(m, 1 - a2), outN));
      if (
        sides.has(`${n} ${[1 - a, t]}`) ||
        Math.abs(dot(axis(m, 1 - a2), outN)) < 0.5 ||
        sides.has(`${m} ${[1 - a2, t2]}`)
      )
        continue;
      const mid = (z: number) =>
          add(cornerOf(n, a, sa, t, z), cornerOf(m, a2, sa2, t2, z)).map((x) => x / 2) as Vec3,
        out = unit(add(outN, scale(axis(m, 1 - a2), t2))),
        down = unit(add(axis(n, 2), axis(m, 2)).map((x) => -x)),
        home = mid(-FRAME.lip / 2),
        reach = (b: number) => add(mid(-FRAME.lip), scale(add(out, down), b)),
        b = extend(0, (b) => (b ? clear(reach(b), reach(b)) : clear(home, home))),
        node: Gap = {
          kind: 'gap',
          top: b ? reach(b) : home,
          b,
          home,
          anchor: column(n, signs(a, sa, t)).map(
            (p, i) => add(p, column(m, signs(a2, sa2, t2))[i]).map((x) => x / 2) as Vec3,
          ),
          reach,
        };
      nodes.set(end(n, 1 - a, t, sa), node);
      nodes.set(end(m, 1 - a2, t2, sa2), node);
    }
  }
  // Each key's outside sides, and the nodes at their ends.
  const spans: Span[] = keys.flatMap((n) =>
    [0, 1].flatMap((ax) =>
      [-1, 1].flatMap((s) =>
        sides.has(`${n} ${[ax, s]}`)
          ? []
          : [
              {
                key: n,
                side: [ax, s] as [number, number],
                out: unit([...axis(n, ax).slice(0, 2), 0].map((x) => x * s)),
                ends: [-1, 1].map((t) => ({
                  t,
                  node:
                    nodes.get(end(n, ax, s, t)) ??
                    ({
                      kind: 'plate',
                      top: cornerOf(n, ax, s, t, -FRAME.lip / 2),
                      anchor: column(n, signs(ax, s, t)),
                    } satisfies Fixed),
                })),
              },
            ],
      ),
    ),
  );
  /** A span's foot `d` out from under the middle of its ends. */
  const footOf = ({ ends, out }: Span, d: number) => {
      const mid = add(ends[0].node.top, ends[1].node.top).map((x) => x / 2);
      return [mid[0] + out[0] * d, mid[1] + out[1] * d, floor] as Vec3;
    },
    /** The ends whose diagonal stands 30° or more, with the nodes on the
     * wall and the foot under it. */
    used = new Map(
      spans.map((span) => {
        const f = footOf(span, 0);
        return [span, span.ends.filter(({ node }) => steepFrom(node.top, f, floor))];
      }),
    ),
    /** How far out the nearest foot both diagonals clear from is, if any. */
    place = (span: Span) => {
      for (let d = 0; d <= REACH; d++) {
        const f = footOf(span, d);
        if (used.get(span)!.every((e) => clear(e.node.top, f))) return d;
      }
    };
  // Where a span's diagonals can't both clear, or only from a foot more
  // than two bracket steps out (a tilted key's switch hangs out past its
  // wall), move the gaps' nodes at its ends further out on their brackets
  // (those that can't clear alone first), and again, until they do or reach
  // as far as a corner's.
  for (let round = 0; round < 12; round++) {
    let moved = false;
    for (const span of spans) {
      if ((place(span) ?? REACH) <= FRAME.bracket * 2) continue;
      const gaps = used
          .get(span)!
          .flatMap((e) => (e.node.kind === 'gap' && e.node.b < REACH ? [e.node] : [])),
        alone = gaps.filter(
          (g) => ![...Array(REACH + 1).keys()].some((d) => clear(g.top, footOf(span, d))),
        );
      for (const g of alone.length ? alone : gaps) {
        raise(g);
        moved = true;
      }
    }
    if (!moved) break;
  }
  // A side with nowhere out from it to stand a foot clear of every switch
  // and keycap (it faces other keys close by, as a thumb key's end can the
  // finger keys) has no diagonals: its ends are held by its leg or its
  // web, and a gap's node left loose gets a post.
  const diagonals = spans.flatMap((span) => {
      const d = place(span);
      if (d === undefined) return [];
      const foot = footOf(span, d);
      return used
        .get(span)!
        .filter((e) => steepFrom(e.node.top, foot, floor))
        .map(({ t, node }) => ({
          key: span.key,
          side: span.side,
          end: t,
          node,
          foot,
          post: false,
        }));
    }),
    // A gap left with no diagonal (where the plate is low, or one would
    // have to reach so far out to clear that it lay flatter): a post
    // straight down from it, as on a leg.
    held = new Set(diagonals.map((m) => m.node)),
    posts = [
      ...new Map(
        spans.flatMap((span) =>
          span.ends.flatMap(({ t, node }) =>
            node.kind === 'gap' && !held.has(node)
              ? [[node, { key: span.key, side: span.side, end: t, node }] as const]
              : [],
          ),
        ),
      ).values(),
    ].map((m) => {
      const { node } = m,
        pos = (b: number) => (b ? node.reach(b) : node.home),
        below = (p: Vec3) => [p[0], p[1], floor] as Vec3;
      node.b = extend(0, (b) => clear(pos(b), below(pos(b))));
      node.top = pos(node.b);
      return { ...m, foot: below(node.top), post: true };
    }),
    truss: (Member & { post: boolean })[] = [...diagonals, ...posts];
  return truss;
}
type Truss = ReturnType<typeof buildTruss>[number];

/** The legs' and truss's bars, and where one hits a switch or keycap. A
 * corner's bracket stays wherever a diagonal leaves from it, its leg left
 * out or not (`all`: every leg, `legs` those kept). */
function barsOf(c: Ctx, bars: Bars, legs: Leg[], all: Leg[], truss: Truss[]) {
  const { column } = c,
    { clear, strut, fan, knot } = bars,
    faults: string[] = [],
    solids: Manifold[] = [],
    from = new Set(truss.map((m) => m.node.top));
  for (const { key, corner, top, foot } of all) {
    const kept = legs.some((l) => l.foot === foot);
    if (!kept && !from.has(top)) continue;
    if (kept && !clear(top, foot))
      faults.push(`${label(key)}: the leg under its corner hits a switch or keycap`);
    solids.push(fan(column(key, corner), top), knot(top), ...(kept ? strut(top, foot, true) : []));
  }
  for (const { key, node, foot, post } of truss) {
    if (!clear(node.top, foot))
      faults.push(
        `${label(key)}: ${post ? 'a post' : 'a diagonal'} under its side hits a switch or keycap`,
      );
    solids.push(...(onPlate(node) ? [fan(node.anchor, foot, true)] : strut(node.top, foot, true)));
  }
  // A gap's bracket: from its column out to its node.
  for (const node of new Set(truss.map((m) => m.node)))
    if (node.kind === 'gap' && node.b) solids.push(fan(node.anchor, node.top), knot(node.top));
  return { faults, solids };
}

/** The feet round a plate's outline, in order: their convex hull, dug in to
 * each foot inside it near an edge (the one nearest an edge, where the edge is
 * more than twice as long as the foot is from its nearer end, or the foot is
 * within a rail's `width` of it; no further than `deepest` from the edge; and
 * the ring doesn't cross itself), as far as it goes. The feet left inside are
 * under the keys. (The Skeletyl chassis's outline too.) */
export function outline(feet: Vec3[], width: number = FRAME.rail[0], deepest = Infinity) {
  const gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1]),
    /** How far p is from the segment a b, in plan. */
    off = (p: Vec3, a: Vec3, b: Vec3) => {
      const d = [b[0] - a[0], b[1] - a[1]],
        l2 = d[0] ** 2 + d[1] ** 2,
        t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2)) : 0;
      return Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t);
    },
    turn = (o: Vec3, a: Vec3, b: Vec3) =>
      Math.sign((a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])),
    /** Whether segments a b and c d cross (not just meet at an end). */
    cross2 = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) =>
      turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0,
    ring = convex(feet) as Vec3[],
    inside = feet.filter((f) => !ring.includes(f)),
    edge = (i: number) => [ring[i], ring[(i + 1) % ring.length]] as const;
  for (let dug = true; dug && ring.length > 2;) {
    dug = false;
    for (let i = 0; i < ring.length && !dug; i++) {
      const [a, b] = edge(i),
        near = inside
          .map((p) => ({ p, d: off(p, a, b) }))
          .filter(({ p, d }) => ring.every((_, j) => j === i || off(p, ...edge(j)) >= d))
          .sort((x, y) => x.d - y.d)[0];
      if (
        !near ||
        near.d > deepest ||
        (near.d > width && gap(a, b) <= 2 * Math.min(gap(a, near.p), gap(b, near.p)))
      )
        continue;
      const { p } = near;
      if (
        ring.some((_, j) => {
          const [c, d] = edge(j);
          return j !== i && (cross2(a, p, c, d) || cross2(p, b, c, d));
        })
      )
        continue;
      ring.splice(i + 1, 0, p);
      inside.splice(inside.indexOf(p), 1);
      dug = true;
    }
  }
  return ring;
}

/** The floor rails (see the header), and the feet they reach: a rail round
 * each plate's outline; where the thumb's and fingers' keys are one plate, one
 * between them, round the thumb's outline where it's inside the plate's, taking
 * in the feet within a rail's width of it; and one from each plate's feet to
 * the nearest of those before it, so it prints as one piece. */
function planRails(c: Ctx, joined: [string, string][], members: { key: string; foot: Vec3 }[]) {
  const { keys } = c,
    rails: [Vec3, Vec3][] = [],
    kept = new Set<Vec3>(),
    piece = Object.fromEntries(keys.map((k) => [k, k])),
    root = (k: string): string => (piece[k] === k ? k : root(piece[k]));
  for (const [a, b] of joined) piece[root(a)] = root(b);
  // (A span's diagonals share their foot.)
  const plates = [...new Set(keys.map(root))].map((g) => [
      ...new Set(members.filter((l) => root(l.key) === g).map((l) => l.foot)),
    ]),
    thumb = new Set(members.filter((l) => isThumb(l.key)).map((l) => l.foot)),
    gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  plates.forEach((own, i) => {
    const ring = own.length > 2 ? outline(own) : own,
      seams =
        own.length > 2
          ? seamsOf(
              ring,
              own,
              own.filter((f) => thumb.has(f)),
            )
          : [];
    if (ring.length > 1)
      ring.forEach((f, j) => {
        if (ring.length > 2 || j === 0) rails.push([f, ring[(j + 1) % ring.length]]);
      });
    for (const s of seams) s.slice(1).forEach((f, j) => rails.push([s[j], f]));
    for (const f of [...ring, ...seams.flat()]) kept.add(f);
    const before = plates
        .slice(0, i)
        .flat()
        .filter((f) => kept.has(f)),
      tie = own
        .filter((f) => kept.has(f))
        .flatMap((a) => before.map((b) => ({ a, b, d: gap(a, b) })))
        .sort((x, y) => x.d - y.d)[0];
    if (tie) rails.push([tie.a, tie.b]);
  });
  return { rails, kept };
}

/** Where the thumb's keys and the fingers' are one plate (outline `ring`, its
 * feet `own`), the rails between them: the thumb's outline (from its feet,
 * `thumb`) where it leaves the plate's, from a foot on that to the next, each
 * a path of feet; then each other foot inside within a rail's width of one,
 * taken into it. */
function seamsOf(ring: Vec3[], own: Vec3[], thumb: Vec3[]) {
  if (thumb.length < 3 || thumb.length === own.length) return [];
  const t = outline(thumb),
    on = new Set(ring),
    next = (a: Vec3, b: Vec3) => {
      const i = ring.indexOf(a),
        j = ring.indexOf(b);
      return Math.abs(i - j) === 1 || Math.abs(i - j) === ring.length - 1;
    },
    start = t.findIndex((f) => on.has(f)),
    seams: Vec3[][] = [];
  if (start < 0) return [];
  let path = [t[start]];
  for (let k = 1; k <= t.length; k++) {
    const f = t[(start + k) % t.length];
    path.push(f);
    if (!on.has(f)) continue;
    if (path.length > 2 || !next(path[0], f)) seams.push(path);
    path = [f];
  }
  const off = (p: Vec3, a: Vec3, b: Vec3) => {
      const d = [b[0] - a[0], b[1] - a[1]],
        l2 = d[0] ** 2 + d[1] ** 2,
        u = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2)) : 0;
      return Math.hypot(p[0] - a[0] - d[0] * u, p[1] - a[1] - d[1] * u);
    },
    taken = new Set([...ring, ...seams.flat()]);
  for (const p of own.filter((f) => !taken.has(f))) {
    const best = seams
      .flatMap((s, si) => s.slice(1).map((b, j) => ({ si, j, d: off(p, s[j], b) })))
      .sort((x, y) => x.d - y.d)[0];
    if (best && best.d <= FRAME.rail[0]) seams[best.si].splice(best.j + 1, 0, p);
  }
  return seams;
}

/** A pad under each foot: what's there of the bars and rails, near the
 * floor, filled down to it, so the bars meeting there leave nothing hanging
 * just above the floor (the slicer would put a sliver of support under it). */
function pads(c: Ctx, bars: Manifold, members: { foot: Vec3 }[]) {
  const { M, floor } = c,
    [up, round] = [1.2, 4];
  return [...new Set(members.map((m) => m.foot.join()))].map((k) => {
    const [x, y] = k.split(',').map(Number),
      near = bars.intersect(
        M.cube([2 * round, 2 * round, up], true).translate([x, y, floor + up / 2]),
      );
    return M.hull([near, near.translate([0, 0, -up])]).trimByPlane([0, 0, 1], floor);
  });
}

/** Pressing a keycap corner pushes along its switch; where that line meets
 * the floor outside the base, a hard enough press tips the frame. How far
 * out: the angle, seen from the corner, from that point to the base's
 * nearest edge. */
function tipWarnings(c: Ctx, feet: { foot: Vec3 }[]) {
  const { cfg, frames, keys, floor, corners } = c,
    [w] = FRAME.rail,
    base = convex(
      feet.flatMap(({ foot: [x, y] }) =>
        corners.map(([sx, sy]) => [x + (sx * w) / 2, y + (sy * w) / 2]),
      ),
    ),
    tips = presses(cfg, frames, keys, floor)
      .filter((p) => inside(base, p.at) < 0)
      .map((p) => {
        const edge = base
            .map((a, i) => {
              const b = base[(i + 1) % base.length],
                d = [b[0] - a[0], b[1] - a[1]],
                t = Math.max(
                  0,
                  Math.min(
                    1,
                    ((p.at[0] - a[0]) * d[0] + (p.at[1] - a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2),
                  ),
                );
              return [a[0] + d[0] * t, a[1] + d[1] * t];
            })
            .sort(
              (a, b) =>
                Math.hypot(a[0] - p.at[0], a[1] - p.at[1]) -
                Math.hypot(b[0] - p.at[0], b[1] - p.at[1]),
            )[0],
          u = [p.at[0] - p.from[0], p.at[1] - p.from[1], floor - p.from[2]],
          v = [edge[0] - p.from[0], edge[1] - p.from[1], floor - p.from[2]],
          cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
        return { key: p.key, deg: (Math.acos(Math.min(1, cos)) * 180) / Math.PI };
      });
  return [...new Set(tips.map((t) => t.key))].flatMap((key) => {
    const deg = Math.max(...tips.filter((t) => t.key === key).map((t) => t.deg));
    return deg > FRAME.tip
      ? [`pressing ${label(key)} may tip the frame: it pushes ${deg.toFixed(0)}° outside the base`]
      : [];
  });
}

/** Each web, cut across halfway between its keys: how much of it is too thin
 * to print (what's left when the thin parts are worn away and the rest grown
 * back). */
function thinWebs(c: Ctx, whole: Manifold, webs: Web[]) {
  const { edge } = c;
  return webs.flatMap((w) => {
    const { n, m, web } = w,
      mid = (k: string, l: string) =>
        edge(k, l)
          .slice(0, 4)
          .reduce<number[]>((a, p) => a.map((x, i) => x + p[i] / 4), [0, 0, 0]),
      a = mid(n, m),
      b = mid(m, n),
      z = sub(b, a);
    // Keys whose facing edges coincide have no web to cut across.
    if (Math.hypot(...z) < 1e-10) return [];
    const Z = unit(z),
      o = a.map((x, i) => (x + b[i]) / 2),
      t = Math.abs(Z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0],
      X = unit(cross(t, Z)),
      Y = cross(Z, X),
      // The frame that has the web's axis as z, from the world: the basis's transpose.
      T = new Matrix4()
        .makeBasis(new Vector3(...X), new Vector3(...Y), new Vector3(...Z))
        .transpose()
        .setPosition(-dot(X, o), -dot(Y, o), -dot(Z, o)),
      across = moved(whole, T).slice(0).intersect(moved(web, T).slice(0)),
      r = FRAME.thin / 2,
      thick = across.offset(-r, 'Miter').offset(r, 'Miter').area(),
      all = across.area();
    return thick < 0.8 * all ? [{ w, under: (100 - (100 * thick) / all).toFixed(0) }] : [];
  });
}

/** Leave out each too-thin web the frame holds together without; a fault
 * where it comes apart. */
function dropThinWebs(c: Ctx, build: (ws: Web[]) => Manifold, webs: Web[], whole: Manifold) {
  const left: Web[] = [],
    faults: string[] = [],
    warnings: string[] = [];
  let solid = whole,
    pieces = piecesOf(whole).length;
  for (const {
    w,
    w: { n, m },
    under,
  } of thinWebs(c, whole, webs)) {
    const why = `${under}% of it is under ${FRAME.thin} mm`,
      without = build(webs.filter((x) => x !== w && !left.includes(x))),
      apart = piecesOf(without).length;
    if (apart > pieces)
      faults.push(
        `the web between ${label(n)} and ${label(m)} is too thin to print (${why}), and the frame comes apart without it`,
      );
    else {
      left.push(w);
      [solid, pieces] = [without, apart];
      warnings.push(`the web between ${label(n)} and ${label(m)} is left out: ${why}`);
    }
  }
  return { solid, left, faults, warnings };
}

/** What's wrong: a switch or keycap that reaches a seat, or the frame. */
function keyFaults(c: Ctx, keep: ReturnType<typeof keepOut>, solid: Manifold) {
  const { keys } = c,
    { land, switchAt, room } = keep,
    faults: string[] = [],
    seats = (r: Manifold, but = '') =>
      keys
        .filter((m) => m !== but && r.intersect(land[m]).volume() > 0.05)
        .map((m) => `${label(m)}'s seat`);
  for (const n of keys) {
    const hits = seats(switchAt(n), n);
    if (hits.length) faults.push(`${label(n)} switch hits ${hits.join(', ')}`);
    room[n].forEach((r, i) => {
      const hit = solid.intersect(r).volume();
      if (hit > 0.05)
        faults.push(
          `${label(n)} ${['keycap', 'switch top'][i]} hits ${seats(r).join(', ') || 'the frame'} (${hit.toFixed(1)} mm³)`,
        );
    });
  }
  return faults;
}

/** Binary STL of a mesh, mirrored in x (the left half) if asked, its floor at z = 0. */
export function frameStl(mesh: MeshData, floor: number, mirror: boolean) {
  const tris = mesh.indices.length / 3,
    out = new DataView(new ArrayBuffer(84 + tris * 50));
  out.setUint32(80, tris, true);
  const v = (i: number) => [
    (mirror ? -1 : 1) * mesh.positions[i * 3],
    mesh.positions[i * 3 + 1],
    mesh.positions[i * 3 + 2] - floor,
  ];
  for (let t = 0; t < tris; t++) {
    // Mirroring turns the triangles inside out; swap two corners back.
    const [a, b, c] = [0, 1, 2].map((k) => v(mesh.indices[t * 3 + k])),
      ps = mirror ? [a, c, b] : [a, b, c],
      u = [0, 1, 2].map((k) => ps[1][k] - ps[0][k]),
      w = [0, 1, 2].map((k) => ps[2][k] - ps[0][k]),
      nn = cross(u, w),
      l = Math.hypot(...nn) || 1,
      o = 84 + t * 50;
    [...nn.map((x) => x / l), ...ps.flat()].forEach((x, k) => out.setFloat32(o + k * 4, x, true));
  }
  return out;
}
