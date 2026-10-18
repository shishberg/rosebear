// The Skeletyl-style chassis (chassis.style "skeletyl"): an open frame of ribs
// standing on a rail, built from the key poses.
//
// A rib is a run of keys along one key axis: each finger column, front to
// back, and each thumb row, along it. Each rib is one solid, swept through
// stations: at each, a cross-section of four points, the rib's top and
// underside at both its sides (the plates' edges across the keys). Over a key
// the rib is the key's plate, an exact slab the switch seat is cut into.
// Between neighbouring keys a web sweeps the rib from one plate's edge to the
// next (`sweep`: each side along a cubic tangent to both plates, a circular
// arc where it can be). Past each end key a short
// lip carries the plate on along its own axis, and a round sweeps it over and
// down to vertical; the round (where the end rises) or else the lip is as big
// as it must be for the round, and the drop under it, to clear the end key's
// tile pocket and switch body. Where the next
// key's plate edge isn't past this one's along either key's axis (the plates
// overlap in plan, or a web would fold back) the rib parts there, and each
// part has its own ends: a round where it clears what the other keys hold
// (their tiles, switches and keycap rooms), else flush with the plate.
// The outline is a ring round the free ends' feet (where their drops would
// meet the floor straight down) and the outer sides of the first and last
// columns' and the thumb rows' plates and tile pockets: their convex hull,
// dug in a little, its corners in rounded but where a drop or a band stands
// on it. The ends whose feet are near it drop to the floor: the rib carried
// on from the bottom of its round down to the rail, as one sweep (as between
// keys), straight down where the outline runs under it, else bending out
// along the end to it, and landing square on it (across along it), where that
// clears the other keys; the rest stop at the bottom of their rounds. One
// rail round the outline, on the floor, joins the ribs into one piece, and
// where neighbouring columns both drop, close, a band fills between their
// drops up to the lower round.
// Nothing is cut out: chassis.ts adds the glue pads and the base, and the
// checks report anything that runs into the tiles or the keycaps.
// PROTOTYPE: chassis.walls (?walls=) adds walls under the outer sides, built
// by skeletyl-walls.prototype.ts from a WallSide per side; "none" adds none.
// PROTOTYPE: chassis.ends (?ends=) supports the hanging ends from the frame's
// own parts (skeletyl-ends.prototype.ts lists the variants): "tie" adds a floor
// tie to the rail, across under them, and drops the ends that can onto it
// (landing square on it, clear of its bends and of where it meets the rail);
// "join" carries a finger front on in a web to a thumb key's plate; "both"
// joins where it can and ties the rest; "flow" first carries a thumb row's end
// on into a column's front as one rib, then joins and ties as "both"; "none"
// leaves them hanging.
//
// Terms, as in chassis.ts, and:
//  rib      a run of keys along one key axis, swept as one solid;
//  station  one cross-section of a rib: its top and underside at both sides;
//  end      a rib's lip and round past its end key, with a drop to the floor
//           if it stands on the outline;
//  drop     the rib carried on down from the bottom of an end's round to the
//           floor (the rail or the tie), its outer face its top;
//  foot     where an end's drop would meet the floor straight down, on its
//           outer face at each side;
//  band     the wall filling between neighbouring columns' drops;
//  tie      PROTOTYPE ?ends=: a bar of the rail's section across the floor,
//           rail to rail, that hanging ends drop onto;
//  pose     where a rib passes and how it lies there: its top's middle, its
//           heading and across, its width and thickness (Pose);
//  join     PROTOTYPE ?ends=: a finger front carried on in a web to a thumb
//           key's plate edge instead of a round; a thumb row's end carried
//           on into a column's front (flow) is one too.
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import type { Matrix4 } from 'three';
import {
  add,
  cross,
  dot,
  isKey,
  keycapEnvelope,
  ROWS,
  scale,
  sub,
  type Config,
  type V3,
} from './geometry';
import {
  plateHalfWidths,
  PLATES,
  tilePocketDepth,
  tilePocketHalf,
  type HalfWidths,
} from './plates';
import { mesh } from './shell/loft';
import { switchHole } from './seats';
import { outline } from './hand/frame';
import { skeletylWalls, type WallPoint, type WallSide } from './skeletyl-walls.prototype';
import { END_SUPPORTS } from './skeletyl-ends.prototype';

/** Construction sizes in mm. */
export const SIZES = {
  /** The ends and the rail are this thick, unless chassis.wall_mm says. */
  wall: 2.4,
  /** The ends' rounds have at least this outer radius, unless chassis.end_radius_mm says. */
  endRadius: 5,
  /** An end's lip is at least this long. Its round (where the end rises off the plate) or else its lip grows by lipStep until the round and the drop clear the end key's tile pocket and switch body by endGap. Rounds, drops and bands keep endGap from what the other keys hold too, or are not built. */
  lip: 1,
  lipStep: 0.1,
  endGap: 0.3,
  /** Stations inside each web, round each end's round, and down each drop (for the checks, the bands and the walls; the drop itself is meshed finer, as a joined end is). */
  webSteps: 8,
  roundSteps: 8,
  dropSteps: 8,
  /** The outline digs in this far at most (plan), before it is rounded. */
  digDeepest: 12,
  /** The outline's corners in are rounded to this radius (plan), but where a drop or a band stands on it; its corners out are left sharp (a drop's corner stands on one). */
  corner: 10,
  /** Segments per full turn of the outline's rounding. */
  cornerSegments: 72,
  /** An end drops to the floor if the outline is at most this far out along the end from where the middle of its drop would meet the floor straight down (plan); its drop bends out that far. */
  reach: 12,
  /** Neighbouring columns' drops at the same end are banded together where their facing landings (on the floor) are at most this far apart (plan); */
  bandGap: 15,
  /** the band reaches this far into each drop. */
  bandInto: 0.5,
  /** PROTOTYPE ?walls=: a wall side has points this many steps across each plate. */
  plateSteps: 5,
  /** The rail round the outline: its height. */
  railHeight: 6,
  /** PROTOTYPE ?ends=: a column's front joins a thumb key's plate edge at most this far off (plan, middle to middle), its web reaching joinInto into the plate (and a drop joinInto up into its round); the tie's bends and its fillets into the rail are rounded to tieRound (plan), and a drop on the tie stands at least tieRound (along it) from where it bends or from the rail's inner edge. */
  joinReach: 20,
  joinInto: 0.5,
  tieRound: 5,
  /** A drop's and (PROTOTYPE ?ends=) a joined end's surfaces are meshed in triangles about this big (sweepSolid). */
  joinMesh: 1,
} as const;

/** A key in a rib: its plate's centre, the key axis the rib runs along, across it, and its normal (right-handed: a = c × n). */
interface RibKey {
  name: string;
  o: V3;
  a: V3;
  c: V3;
  n: V3;
  /** Which key axis a is (0: x, 1: y). */
  axis: number;
}
/** A rib: which run it is from, its keys in order, and whether each end (first, last) is where the run parted. */
interface Rib {
  run: number;
  keys: RibKey[];
  parted: [boolean, boolean];
}
/** How a rib's end finishes: flush with the plate's edge, a round alone, a round and a drop to the floor (on the rail or the tie), landing as the pose `land`, or (PROTOTYPE ?ends=) a web joining it to another key's plate. */
type End = 'flush' | 'hang' | { land: Pose } | { join: Join };
/** PROTOTYPE ?ends=: where a joined end's rib lands: on a plate edge of `key`, as a pose heading into that plate (its sides those of the end's own, heading out), carried on `into` mm past it. */
interface Join {
  key: string;
  land: Pose;
  into: number;
}
const isDrop = (e: End): e is { land: Pose } => typeof e === 'object' && 'land' in e;
const isJoin = (e: End): e is { join: Join } => typeof e === 'object' && 'join' in e;
/** A point on one side of a rib: [top, underside]; on a drop, [outer face, inner face]. */
type Pair = [V3, V3];
/** A station: [left underside, right underside, right top, left top]. */
type Station = [V3, V3, V3, V3];

/** The sizes the ribs are built from, in mm. */
function dims(cfg: Config) {
  const c = cfg.chassis as { wall_mm?: number; end_radius_mm?: number };
  const sw = cfg.switch;
  return {
    plate: cfg.chassis.plate_thickness_mm,
    wall: c.wall_mm ?? SIZES.wall,
    radius: c.end_radius_mm ?? SIZES.endRadius,
    plateHalf: plateHalfWidths(cfg),
    /** What an end keeps clear under its key: the tile pocket and the switch body, as [half-widths, depth below the plate top]. */
    keepClear: [
      [tilePocketHalf(cfg), tilePocketDepth(cfg)],
      [
        sw.cutout_mm.map((x) => (x + sw.cutout_clearance_mm) / 2) as HalfWidths,
        PLATES.switchBelowPlate,
      ],
    ] as [HalfWidths, number][],
  };
}
type Dims = ReturnType<typeof dims>;

const along = (k: RibKey, h: HalfWidths) => h[k.axis];
const across = (k: RibKey, h: HalfWidths) => h[1 - k.axis];
/** A point under or on key k: u and s along and across (in half-widths `half`), z along the normal. */
const keyPoint = (k: RibKey, half: HalfWidths, u: number, s: number, z: number) =>
  add(
    add(k.o, scale(k.a, u * along(k, half))),
    add(scale(k.c, s * across(k, half)), scale(k.n, z)),
  );
/** A point on key k's plate: u and s are -1 or 1 for its edges along and across. */
const corner = (d: Dims, k: RibKey, u: number, s: number, z: number) =>
  keyPoint(k, d.plateHalf, u, s, z);
const unitPlan = (v: number[]) => {
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l];
};
const lerp = (p: V3, q: V3, f: number) => add(p, scale(sub(q, p), f));
const unit = (v: V3) => scale(v, 1 / Math.hypot(...v));

/**
 * Where a rib passes and how it lies there: `p` is the middle of its top,
 * heading along unit `t`, across along unit `c` (square to t; side s, -1 or 1,
 * is s·half out along c), its underside `thick` below the top along -n, where
 * n = t × c. Over a key's plate edge: p the edge's middle, t and c the key's
 * a and c (so n is the key's normal), half the plate's half-width across and
 * thick the plate's. n is given where it isn't t × c: at the top of a drop,
 * where the end's round has turned the rib over to head straight down but
 * across it is still the plate's across, tilted (dropTop).
 */
interface Pose {
  p: V3;
  t: V3;
  c: V3;
  half: number;
  thick: number;
  n?: V3;
}
const normalOf = (q: Pose) => q.n ?? cross(q.t, q.c);
/** Side s of a pose: [top, underside]. */
const poseSide = (q: Pose, s: number): Pair => {
  const top = add(q.p, scale(q.c, s * q.half));
  return [top, sub(top, scale(normalOf(q), q.thick))];
};
/** The same pose, heading the other way (its sides swap; n stays). */
const flip = (q: Pose): Pose => ({ ...q, t: scale(q.t, -1), c: scale(q.c, -1) });
/** Pose q carried straight on along its heading by `length`. */
const ahead = (q: Pose, length: number): Pose => ({ ...q, p: add(q.p, scale(q.t, length)) });
/** The pose at plate edge u (-1 or 1 along) of key k, heading along k.a. */
const edgePose = (d: Dims, k: RibKey, u: number): Pose => ({
  p: keyPoint(k, d.plateHalf, u, 0, 0),
  t: k.a,
  c: k.c,
  half: across(k, d.plateHalf),
  thick: d.plate,
});

/**
 * The rib from pose a to pose b: the `steps` poses after a, up to and
 * including b. Each of its sides' tops runs along the cubic leaving a's side
 * along a.t and arriving at b's along b.t, its handles by default those that
 * make a circular arc of the turn between a.t and b.t (a third of the chord
 * when straight; poses on a circle about an axis across them sweep that arc),
 * or `reach` mm at each end, given for the middle and scaled to each side's
 * chord. So in a tight turn the rib fans about its inner side rather than
 * folding back over it, and it twists only as the two poses differ. Its
 * normal turns at an even rate from a's to b's (as the heading does round an
 * arc), the underside thick below the top along it; thick goes smoothly from
 * a's to b's.
 */
function sweep(a: Pose, b: Pose, steps: number, reach?: [number, number]): Pose[] {
  const at = sweepAt(a, b, reach);
  return [...Array(steps).keys()].map((i) => at((i + 1) / steps));
}

/** The rib from pose a to pose b (as `sweep`), as its pose at f along: a at 0, b at 1. */
function sweepAt(a: Pose, b: Pose, reach?: [number, number]): (f: number) => Pose {
  const turn = Math.acos(Math.max(-1, Math.min(1, dot(a.t, b.t))));
  const arc = turn < 1e-6 ? 1 / 3 : ((2 / 3) * Math.tan(turn / 4)) / Math.sin(turn / 2);
  const middle = Math.hypot(...sub(b.p, a.p));
  // Side s's top at f along.
  const side = (s: number) => {
    const [A, B] = [a, b].map((q) => poseSide(q, s)[0]);
    const chord = Math.hypot(...sub(B, A));
    const [ra, rb] = reach
      ? reach.map((r) => (r * chord) / (middle || 1))
      : [arc * chord, arc * chord];
    const ctrl = [A, add(A, scale(a.t, ra)), sub(B, scale(b.t, rb)), B];
    const sum = (w: number[]) => ctrl.reduce((x, q, m) => add(x, scale(q, w[m])), [0, 0, 0] as V3);
    return (f: number) => sum([(1 - f) ** 3, 3 * f * (1 - f) ** 2, 3 * f * f * (1 - f), f ** 3]);
  };
  const [left, right] = [side(-1), side(1)];
  const [na, nb] = [a, b].map(normalOf);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(na, nb))));
  const normal = (f: number) =>
    angle < 1e-6 ? na : add(scale(na, Math.sin((1 - f) * angle)), scale(nb, Math.sin(f * angle)));
  const smooth = (f: number) => 3 * f * f - 2 * f ** 3;
  return (f: number): Pose => {
    if (f <= 0) return a;
    if (f >= 1) return b;
    const [l, r] = [left(f), right(f)];
    const c = unit(sub(r, l));
    const n = normal(f);
    return {
      p: lerp(l, r, 0.5),
      t: unit(cross(c, n)),
      c,
      half: Math.hypot(...sub(r, l)) / 2,
      thick: a.thick + (b.thick - a.thick) * smooth(f),
      n,
    };
  };
}

/**
 * The runs of keys the ribs are made from, in order: each finger column front
 * to back, and each thumb row along it. Extra thumb keys that carry on past
 * one end of the thumb row (beside it, not in front) join it as one row.
 */
function runs(cfg: Config, frames: Record<string, Matrix4>) {
  const layout = cfg.geometry as Config['geometry'] & {
    thumb_extra?: { keys: { name: string }[] };
  };
  const centre = (n: string) => [frames[n].elements[12], frames[n].elements[13]];
  const byX = (ns: string[]) => ns.sort((a, b) => centre(a)[0] - centre(b)[0]);
  const mainRow = byX(layout.thumb.keys.map((k) => 'thumb_' + k.name));
  const extra = byX((layout.thumb_extra?.keys ?? []).map((k) => 'thumb_' + k.name));
  const columns = layout.columns.map((c) =>
    [...ROWS].reverse().map((r) => `matrix_${c.name}_${r}`),
  );
  if (mainRow.length < 2 || !extra.length)
    return [...columns, mainRow, extra].filter((r) => r.length);
  const [a, b] = [centre(mainRow[0]), centre(mainRow.at(-1)!)];
  const dir = unitPlan([b[0] - a[0], b[1] - a[1]]);
  const rowAlong = (n: string) => (centre(n)[0] - a[0]) * dir[0] + (centre(n)[1] - a[1]) * dir[1];
  const end = rowAlong(mainRow.at(-1)!);
  const beside = extra.every((n) => rowAlong(n) > end) || extra.every((n) => rowAlong(n) < 0);
  const thumbs = beside
    ? [[...mainRow, ...extra].sort((p, q) => rowAlong(p) - rowAlong(q))]
    : [mainRow, extra];
  return [...columns, ...thumbs];
}

/**
 * The ribs: each run's keys, each along the key axis that best follows the run
 * there, parted between neighbours that can't be webbed.
 */
function ribs(d: Dims, frames: Record<string, Matrix4>, keyRuns: string[][]): Rib[] {
  const out: Rib[] = [];
  keyRuns.forEach((run, r) => {
    const keys = run.map((name, i): RibKey => {
      const e = frames[name].elements;
      const p = frames[run[Math.max(0, i - 1)]].elements;
      const q = frames[run[Math.min(run.length - 1, i + 1)]].elements;
      // A lone key runs along its own x.
      const dir = run.length > 1 ? [q[12] - p[12], q[13] - p[13]] : [e[0], e[1]];
      const best = [0, 1]
        .flatMap((axis) => [1, -1].map((sign) => ({ axis, sign })))
        .reduce((x, y) => {
          const score = (c: { axis: number; sign: number }) =>
            c.sign * (e[c.axis * 4] * dir[0] + e[c.axis * 4 + 1] * dir[1]);
          return score(y) > score(x) ? y : x;
        });
      const a = [0, 1, 2].map((j) => best.sign * e[best.axis * 4 + j]) as V3;
      const n: V3 = [e[8], e[9], e[10]];
      return { name, o: [e[12], e[13], e[14]], a, c: cross(n, a), n, axis: best.axis };
    });
    let part = [keys[0]];
    let parted = false;
    for (let i = 1; i <= keys.length; i++) {
      if (i < keys.length && webbable(d, keys[i - 1], keys[i])) {
        part.push(keys[i]);
        continue;
      }
      out.push({ run: r, keys: part, parted: [parted, i < keys.length] });
      part = [keys[i]];
      parted = true;
    }
  });
  return out;
}

/** Whether keys p and q (next along the rib) can be webbed: each plate's facing edge is past the other's, along the other's axis. */
function webbable(d: Dims, p: RibKey, q: RibKey) {
  const past = (k: RibKey, other: RibKey, sign: number) =>
    [-1, 1].every((s) =>
      [0, -d.plate].every(
        (z) => sign * dot(sub(corner(d, other, -sign, s, z), k.o), k.a) > along(k, d.plateHalf),
      ),
    );
  return past(p, q, 1) && past(q, p, -1);
}

/** Whether plan point [x, z] is inside polygon `ring`. */
function inside(ring: number[][], [x, z]: number[]) {
  let odd = false;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    if (a[1] > z !== b[1] > z && x < a[0] + ((z - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
      odd = !odd;
  });
  return odd;
}
const add2 = (p: number[], q: number[]) => [p[0] + q[0], p[1] + q[1]];
/** How far [x, z] is from the polyline `line` (in the same plane). */
const fromLine = (line: number[][], [x, z]: number[]) =>
  Math.min(...line.slice(1).map((b, i) => gap([line[i], b], [x, z, 0])));

/**
 * The lip and round past key k's plate edge u (-1 or 1 along): each side's
 * path (its pose side s, -1 or 1; the rib's side u·s) out from the plate's
 * corner, [top, underside]. The lip carries the plate on along its own axis,
 * thinning to a wall; the round sweeps it over and down until it heads
 * straight down, where a drop can stand under it. Each side turns on the
 * same arc, in the upright plane along the end, so the end doesn't twist: it
 * keeps the plate's tilt across, as the drop under it does. They are as small as
 * lets the inner faces, and a drop straight down from them, clear the end
 * key's tile pocket and switch body by endGap. Where the end rises off the
 * plate the round grows for that (from the end radius), so it rolls over in a
 * wider arc rather than running on up the plate's slope; where it is level or
 * falls, the lip grows.
 */
function endRound(d: Dims, k: RibKey, u: number) {
  const edge = u > 0 ? edgePose(d, k, u) : flip(edgePose(d, k, u));
  const t = edge.t;
  const h = [...unitPlan(t), 0] as V3;
  const [cos, sin] = [Math.hypot(t[0], t[1]), t[2]];
  // The round's outward direction where its tangent is at angle a up from h.
  const out = (a: number): V3 => add(scale(h, -Math.sin(a)), [0, 0, Math.cos(a)]);
  const start = Math.atan2(sin, cos);
  // Each side's path: from its corner, a lip L long, then a round of radius R
  // about a centre under the lip's end.
  const build = (L: number, R: number) => (s: number) => {
    const corner = poseSide(edge, s);
    const centre = sub(add(corner[0], scale(t, L)), scale(out(start), R));
    const round = [...Array(SIZES.roundSteps + 1).keys()].map((j): Pair => {
      const a = start + ((-Math.PI / 2 - start) * j) / SIZES.roundSteps;
      return [add(centre, scale(out(a), R)), add(centre, scale(out(a), R - d.wall))];
    });
    return [corner, ...round];
  };
  // In the plate's own plane (along t and n from its edge's middle, seen
  // along c): the room under each side is under the plate (its underside
  // inside), the lip's and the round's inner face, and straight down from its
  // end; what must stay clear is the pocket's and switch body's edge under it.
  const n = cross(t, edge.c);
  const plane = (p: V3) => [dot(sub(p, edge.p), t), dot(sub(p, edge.p), n)];
  const down = plane(add(edge.p, [0, 0, -1e3]));
  const keep = d.keepClear.flatMap(([half, depth]) =>
    [-d.plate, -depth].map((z) => plane(keyPoint(k, half, u, 0, z))),
  );
  const clear = (sides: (s: number) => Pair[]) =>
    [-1, 1].every((s) => {
      const face = sides(s).map(([, under]) => plane(under));
      const end = face.at(-1)!;
      const under = (x: number) => [x, -d.plate + 0.01];
      const line = [...face.slice(1), add2(end, down)];
      const room = [under(-100), under(0), ...line, add2(under(-100), down)];
      return keep.every((p) => inside(room, p) && fromLine(line, p) >= SIZES.endGap);
    });
  let [L, R] = [SIZES.lip, d.radius];
  while (!clear(build(L, R)) && L < 50 && R < 50) {
    if (sin > 0) R += SIZES.lipStep;
    else L += SIZES.lipStep;
  }
  return build(L, R);
}

/**
 * One side (s, -1 or 1 across) of the end of key k that faces u (-1 or 1
 * along), from the plate's corner out. A flush end stops there. A joined end
 * (PROTOTYPE ?ends=join) runs on as a cubic web to its landing on a thumb
 * plate's edge, then a little into that plate. Otherwise its lip and round
 * (endRound) turn it over and down until it is vertical. A dropping end runs
 * on from there down to its landing, swept as between keys: straight down,
 * or bending out to the rail or along the tie and turning to lie along it.
 * Nothing goes below the floor.
 */
function endSide(d: Dims, k: RibKey, u: number, s: number, end: End): Pair[] {
  const path: Pair[] = [[corner(d, k, u, s, 0), corner(d, k, u, s, -d.plate)]];
  if (end === 'flush') return path;
  if (isJoin(end)) {
    // PROTOTYPE ?ends=: the rib on to the other plate's edge, as between
    // keys, then on into that plate. Heading out, the end's side s is its
    // pose's side u·s.
    const { land, into } = end.join;
    const from = u > 0 ? edgePose(d, k, u) : flip(edgePose(d, k, u));
    // A station every 5° of its turn, at least as many as a web's.
    const turn = Math.acos(Math.max(-1, Math.min(1, dot(from.t, land.t))));
    const poses = sweep(from, land, Math.max(SIZES.webSteps, Math.ceil(turn / (Math.PI / 36))));
    if (into > 0) poses.push(ahead(land, into));
    path.push(...poses.map((q) => poseSide(q, u * s)));
    return path;
  }
  path.push(...endRound(d, k, u)(u * s).slice(1));
  if (isDrop(end))
    path.push(...sweep(dropTop(d, k, u), end.land, SIZES.dropSteps).map((q) => poseSide(q, u * s)));
  return path.map((pair) => pair.map((p) => [p[0], p[1], Math.max(0, p[2])]) as Pair);
}

/**
 * The top of the drop under the end of key k that faces u (-1 or 1 along):
 * the bottom of its round, heading straight down. Its sides are the round's,
 * so across it is the plate's across, tilted as the plate is (one side lower),
 * and its underside (inner face) is a wall in from its top (outer face),
 * straight back along the end.
 */
function dropTop(d: Dims, k: RibKey, u: number): Pose {
  const round = endRound(d, k, u);
  const [l, r] = [-1, 1].map((s) => round(s).at(-1)![0]);
  return {
    p: lerp(l, r, 0.5),
    t: [0, 0, -1],
    c: unit(sub(r, l)),
    half: Math.hypot(...sub(r, l)) / 2,
    thick: d.wall,
    n: [...unitPlan(scale(k.a, u)), 0] as V3,
  };
}

/** Where a drop from `top` lands: its outer face's middle at q on the floor, heading straight down, across along plan direction `along` (the rail or the tie it stands on), as wide in plan as its top. */
function landing(top: Pose, q: V3, along: number[]): Pose {
  const a = [...unitPlan(along), 0] as V3;
  return {
    p: [q[0], q[1], 0],
    t: [0, 0, -1],
    c: dot(a, top.c) < 0 ? scale(a, -1) : a,
    half: top.half * Math.hypot(top.c[0], top.c[1]),
    thick: top.thick,
  };
}
/** Where a drop from `top` would land straight down. */
const straightDown = (top: Pose) => landing(top, top.p, top.c);

/**
 * One side of a rib, from where its first end's drop lands (or its round, or
 * plate edge) to its last's. `over` (if given) is filled with what each point is on: a key's
 * name over its plate, "" over a web, undefined on an end.
 */
function ribSide(d: Dims, rib: Rib, s: number, ends: End[], over?: (string | undefined)[]): Pair[] {
  const keys = rib.keys;
  const path = endSide(d, keys[0], -1, s, ends[0]).reverse();
  const on: (string | undefined)[] = path.map(() => undefined);
  on[on.length - 1] = keys[0].name;
  keys.forEach((k, i) => {
    if (i > 0) {
      // The web from the last key's plate's edge to this one's.
      const web = sweep(edgePose(d, keys[i - 1], 1), edgePose(d, k, -1), SIZES.webSteps);
      web.forEach((q, j) => {
        path.push(poseSide(q, s));
        on.push(j < web.length - 1 ? '' : k.name);
      });
    }
    path.push([corner(d, k, 1, s, 0), corner(d, k, 1, s, -d.plate)]);
    on.push(k.name);
  });
  const last = endSide(d, keys.at(-1)!, 1, s, ends[1]).slice(1);
  path.push(...last);
  over?.push(...on, ...last.map(() => undefined));
  return path;
}

const square: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
/** The solid through stations, each joined to the next, the first and last closed. */
const solid = (wasm: ManifoldToplevel, cfg: Config, stations: Station[]) =>
  mesh(
    { wasm, cfg, frames: {} },
    stations.map((st) => ({ pts: square, place: (_w: number, _z: number, j: number) => st[j] })),
  );

/** A rib's solid. A drop, and (PROTOTYPE ?ends=) a joined end, is a solid of its own (sweepSolid), the rib stopping at the bottom of the round or flush at its plate edge. */
function ribSolid(wasm: ManifoldToplevel, cfg: Config, d: Dims, rib: Rib, ends: End[]) {
  const short = ends.map((e) => (isJoin(e) ? 'flush' : isDrop(e) ? 'hang' : e));
  const [left, right] = [-1, 1].map((s) => ribSide(d, rib, s, short));
  const body = solid(
    wasm,
    cfg,
    left.map((l, i): Station => [l[1], right[i][1], right[i][0], l[0]]),
  );
  const swept = ends.flatMap((e, i) => {
    const [k, u] = endKey(rib, i);
    // A joined end runs on into the plates it joins (at least joinInto,
    // inside the plate's slab) and a drop up into its round, so that each
    // overlaps what it joins rather than only meeting it face to face.
    if (isJoin(e)) {
      const from = u > 0 ? edgePose(d, k, u) : flip(edgePose(d, k, u));
      const { land, into } = e.join;
      return [sweepSolid(wasm, from, land, SIZES.joinInto, Math.max(into, SIZES.joinInto))];
    }
    return isDrop(e) ? [sweepSolid(wasm, dropTop(d, k, u), e.land, SIZES.joinInto, 0)] : [];
  });
  return swept.length ? wasm.Manifold.union([body, ...swept]) : body;
}

/**
 * The solid of the sweep from pose a to pose b (sweepAt), carried straight on
 * `back` before a and `on` past b, meshed evenly. A rib's stations each run
 * straight across its whole width, and round a tight turn its outer side runs
 * several times as far as its inner, or as it twists its sides run across, so
 * the quads between stations would be long slivers, or fold, and shade as
 * streaks. Instead the cross-section's outline is cut into lanes about
 * joinMesh apart (across the top and the underside, down the sides), each lane
 * runs along the rib with points about joinMesh apart along its own length,
 * and neighbouring lanes are stitched with triangles, each advancing
 * whichever lane is behind (along the rib). Each point lies on its station's
 * straight line across, so it is the same surface as the stations', sampled
 * finer.
 */
function sweepSolid(wasm: ManifoldToplevel, a: Pose, b: Pose, back: number, on: number): Manifold {
  const at = sweepAt(a, b);
  // The pose g along: the sweep from 0 to 1, and before and after it straight on.
  const pose = (g: number) =>
    g < 0 ? ahead(a, back * g) : g <= 1 ? at(g) : ahead(b, on * (g - 1));
  const spans = [...(back > 0 ? [-1] : []), 0, 1, ...(on > 0 ? [2] : [])];
  const h = SIZES.joinMesh;
  // The lanes, round the cross-section: the top from side -1 to 1, down side
  // 1, the underside back, up side -1.
  const m = Math.ceil((2 * Math.max(a.half, b.half)) / h);
  const v = Math.ceil(Math.max(a.thick, b.thick) / h);
  const lanes: ((q: Pose) => V3)[] = [];
  // Across (0 at side -1, 1 at side 1) and down (0 top, 1 underside).
  const lane = (across: number, down: number) => (q: Pose) => {
    const [[lt, lu], [rt, ru]] = [-1, 1].map((s) => poseSide(q, s));
    return lerp(lerp(lt, rt, across), lerp(lu, ru, across), down);
  };
  for (let j = 0; j <= m; j++) lanes.push(lane(j / m, 0));
  for (let j = 1; j < v; j++) lanes.push(lane(1, j / v));
  for (let j = m; j >= 0; j--) lanes.push(lane(j / m, 1));
  for (let j = v - 1; j > 0; j--) lanes.push(lane(0, j / v));
  // Each lane's points, about h apart along it, and along the sweep at least
  // one every 5° its heading or normal turns, as the stations are (the inner
  // lanes run little way while the rib twists round them): [g, point].
  const turn = (p: V3, q: V3) => Math.acos(Math.max(-1, Math.min(1, dot(p, q))));
  const steps = Math.ceil(
    Math.max(turn(a.t, b.t), turn(normalOf(a), normalOf(b))) / (Math.PI / 36),
  );
  const fine = 128;
  const points = lanes.map((path) =>
    spans.slice(1).flatMap((g1, i) => {
      const g0 = spans[i];
      const dense = [...Array(fine + 1).keys()].map((j) => path(pose(g0 + ((g1 - g0) * j) / fine)));
      const run = [0];
      dense.slice(1).forEach((p, j) => run.push(run[j] + Math.hypot(...sub(p, dense[j]))));
      const n = Math.max(1, Math.ceil(run[fine] / h), g0 === 0 ? steps : 0);
      return [...Array(n + 1).keys()].slice(i ? 1 : 0).map((j): [number, V3] => {
        const want = (run[fine] * j) / n;
        let after = 1;
        while (after < fine && run[after] < want) after++;
        const f = (want - run[after - 1]) / (run[after] - run[after - 1] || 1);
        const g = g0 + ((g1 - g0) * (after - 1 + Math.min(1, Math.max(0, f)))) / fine;
        return [g, path(pose(g))];
      });
    }),
  );
  const verts: number[] = [];
  const ids = points.map((lane) => lane.map(([, p]) => verts.push(...p) / 3 - 1));
  const tris: number[] = [];
  // Neighbouring lanes stitched, oriented outward: going round the lanes is
  // going from top (n) to side 1 (c), so a triangle from a lane ahead (t) to
  // the next faces t × c = n out on the top, and so on round.
  ids.forEach((A, l) => {
    const B = ids[(l + 1) % ids.length];
    const [ga, gb] = [points[l], points[(l + 1) % ids.length]].map((lane) => lane.map(([g]) => g));
    let [i, j] = [0, 0];
    while (i < A.length - 1 || j < B.length - 1) {
      if (j === B.length - 1 || (i < A.length - 1 && ga[i + 1] <= gb[j + 1])) {
        tris.push(A[i], A[i + 1], B[j]);
        i++;
      } else {
        tris.push(A[i], B[j + 1], B[j]);
        j++;
      }
    }
  });
  // The two ends closed, facing back along the rib and on along it.
  [0, 1].forEach((last) => {
    const q = pose(last ? spans.at(-1)! : spans[0]);
    const ring = ids.map((lane) => (last ? lane.at(-1)! : lane[0]));
    const plan = ring.map((id): [number, number] => {
      const p = sub(verts.slice(id * 3, id * 3 + 3) as V3, q.p);
      return [dot(p, q.c), dot(p, normalOf(q))];
    });
    const ccw = area2(plan) > 0;
    const order = ring.map((_, i) => (ccw ? i : ring.length - 1 - i));
    for (const [x, y, z] of wasm.triangulate([order.map((i) => plan[i])])) {
      // Seen from along +t the plan is wound counter-clockwise, so it faces on.
      const tri = [x, y, z].map((i) => ring[order[i]]);
      tris.push(...(last ? tri : [tri[0], tri[2], tri[1]]));
    }
  });
  const solid = new wasm.Manifold(
    new wasm.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(verts),
      triVerts: new Uint32Array(tris),
    }),
  );
  if (solid.status() !== 'NoError') throw new Error(`sweepSolid: ${solid.status()}`);
  return solid;
}

/** A rib's end key and which way its end faces along it (end 0: first, 1: last). */
const endKey = (rib: Rib, end: number): [RibKey, number] =>
  end ? [rib.keys.at(-1)!, 1] : [rib.keys[0], -1];

/** The feet of a rib's end, if it dropped straight down: its outer face's foot at each side. */
const feet = (d: Dims, rib: Rib, end: number) =>
  [-1, 1].map((s): V3 => {
    const p = endSide(d, ...endKey(rib, end), s, 'hang').at(-1)![0];
    return [p[0], p[1], 0];
  });

/**
 * The outline, counter-clockwise: round the feet's convex hull, dug in at most
 * digDeepest, and the outer sides' plates' and tile pockets' hulls, its
 * corners in rounded to `corner` (trimmed back where drops stand on it).
 */
function rounded(wasm: ManifoldToplevel, d: Dims, feet: V3[], sides: V3[][]) {
  const plan = (ps: V3[]) => ps.map((p) => [p[0], p[1]] as [number, number]);
  const round = (c: CrossSection, by: number) => c.offset(by, 'Round', 2, SIZES.cornerSegments);
  const area = wasm.CrossSection.union([
    new wasm.CrossSection([plan(outline(feet, d.wall, SIZES.digDeepest))], 'NonZero'),
    ...sides.map((side) => wasm.CrossSection.hull([plan(side)])),
  ]);
  // Out by R and back: the corners in rounded to R, the corners out kept.
  return largest(round(round(area, SIZES.corner), -SIZES.corner));
}
/** The largest of a cross-section's polygons. */
const largest = (c: CrossSection) =>
  c
    .toPolygons()
    .map((p) => p.map((q) => [q[0], q[1]] as [number, number]))
    .reduce((x, y) => (area2(y) > area2(x) ? y : x));
/**
 * The outline cut back to the faces standing on it, each [a, b, outward]
 * (plan): what rounding its corners in filled in past them, so that the rail
 * runs straight under the drops and bands that stand on it.
 */
function trimmed(wasm: ManifoldToplevel, ring: [number, number][], faces: V3[][]) {
  if (!faces.length) return ring;
  const D = SIZES.corner;
  const cut = faces.map(
    ([a, b, o]) =>
      new wasm.CrossSection(
        [
          [a, b, add(b, scale(o, D)), add(a, scale(o, D))].map(
            (p) => [p[0], p[1]] as [number, number],
          ),
        ],
        'NonZero',
      ),
  );
  return largest(new wasm.CrossSection([ring], 'NonZero').subtract(wasm.CrossSection.union(cut)));
}
/** The outline's edge nearest p: along it and outward (plan, unit; it runs counter-clockwise). */
function ringAt(ring: number[][], p: V3): [V3, V3] {
  const [a, b] = ring
    .map((x, i) => [x, ring[(i + 1) % ring.length]])
    .reduce((x, y) => (gap(y, p) < gap(x, p) ? y : x));
  const along = [...unitPlan([b[0] - a[0], b[1] - a[1]]), 0] as V3;
  return [along, [along[1], -along[0], 0]];
}
/** How far (plan) p is from the segment [a, b]. */
function gap([a, b]: number[][], p: V3) {
  const e = [b[0] - a[0], b[1] - a[1]];
  const f = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * e[0] + (p[1] - a[1]) * e[1]) / (e[0] ** 2 + e[1] ** 2 || 1)),
  );
  return Math.hypot(a[0] + e[0] * f - p[0], a[1] + e[1] * f - p[1]);
}
/** How far along plan direction h from p each crossing of the ring is (behind is negative). */
const crossings = (ring: number[][], p: V3, h: V3) =>
  ring.flatMap((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const e = [b[0] - a[0], b[1] - a[1]];
    const w = [a[0] - p[0], a[1] - p[1]];
    const den = h[0] * e[1] - h[1] * e[0];
    const f = (h[1] * w[0] - h[0] * w[1]) / den;
    return Math.abs(den) > 1e-12 && f >= 0 && f < 1 ? [(w[0] * e[1] - w[1] * e[0]) / den] : [];
  });
/** How far the ring is from p along plan direction h: the first crossing ahead if p is inside it, else the nearest. */
function toRing(ring: [number, number][], p: V3, h: V3) {
  const hits = crossings(ring, p, h);
  const ahead = hits.filter((t) => t > 0);
  return ahead.length % 2
    ? Math.min(...ahead)
    : hits.reduce((x, y) => (Math.abs(y) < Math.abs(x) ? y : x), Infinity);
}
/** Twice a plan polygon's signed area. */
const area2 = (p: number[][]) =>
  p.reduce((sum, q, i) => {
    const r = p[(i + 1) % p.length];
    return sum + q[0] * r[1] - r[0] * q[1];
  }, 0);

/** Points over the faces of the solid between two sides (from station `from` on): across at quarters, at each station and halfway to the next. */
const samples = (left: Pair[], right: Pair[], from = 0) =>
  left.flatMap((l, i) =>
    i < from
      ? []
      : [0, 1].flatMap((j) =>
          [0, 0.25, 0.5, 0.75, 1].flatMap((f) => {
            const p = lerp(l[j], right[i][j], f);
            return i > from ? [p, lerp(p, lerp(left[i - 1][j], right[i - 1][j], f), 0.5)] : [p];
          }),
        ),
  );

/**
 * What key n holds, as boxes in its own coordinates ([centre, half-widths]),
 * as the hardware check has them: its tile and the tile's components, its
 * switch body, and its keycap's room, from the plate up, the cap's base wide.
 */
function keyBoxes(cfg: Config, n: string): [V3, V3][] {
  const { switch: sw, tile } = cfg;
  const pcb = -tile.plate_top_to_pcb_top_mm;
  const half = (size: number[]) => size.map((x) => x / 2) as V3;
  const env = keycapEnvelope(cfg, n, { clampFloor: true });
  const cap = env.z0 + env.height;
  return [
    [[0, 0, pcb - tile.size_mm[2] / 2], half(tile.size_mm)],
    ...tile.components.map((c): [V3, V3] => [
      [c.center_mm[0], c.center_mm[1], c.center_mm[2] + pcb],
      half(c.size_mm),
    ]),
    [[0, 0, sw.body_mm[2] / 2 - sw.body_below_plate_mm], half(sw.body_mm)],
    [
      [0, 0, cap / 2],
      [env.base[0] / 2, env.base[1] / 2, cap / 2],
    ],
  ];
}

/** Whether points stay endGap clear of what every key but `except` holds. */
function clearOfKeys(cfg: Config, frames: Record<string, Matrix4>, points: V3[], except?: string) {
  return Object.keys(frames)
    .filter((n) => isKey(n) && n !== except)
    .every((n) => {
      const e = frames[n].elements;
      const boxes = keyBoxes(cfg, n);
      return points.every((p) => {
        const q = sub(p, [e[12], e[13], e[14]]);
        const local = [0, 4, 8].map((i) => dot(q, [e[i], e[i + 1], e[i + 2]]));
        return boxes.every(([c, h]) =>
          local.some((x, i) => Math.abs(x - c[i]) > h[i] + SIZES.endGap),
        );
      });
    });
}

/** Whether a rib's end can finish as `kind`: what it adds past the plate's edge is clear of the other keys. */
function endClear(
  cfg: Config,
  d: Dims,
  frames: Record<string, Matrix4>,
  rib: Rib,
  end: number,
  kind: End,
) {
  const [k, u] = endKey(rib, end);
  const [left, right] = [-1, 1].map((s) => endSide(d, k, u, s, kind));
  return clearOfKeys(cfg, frames, samples(left, right, 1), k.name);
}

/** One side of a dropping end, from the bottom of its round to the floor. */
const dropSide = (d: Dims, rib: Rib, end: number, s: number, kind: End) =>
  endSide(d, ...endKey(rib, end), s, kind).slice(SIZES.roundSteps + 1);
/** A point on a drop side at height z (or its top, if z is above it), its outer and inner faces. */
function dropAt(side: Pair[], z: number): Pair {
  const i = Math.max(0, side.findIndex((p) => p[0][2] <= z) - 1);
  const [p, q] = [side[i], side[i + 1] ?? side[i]];
  const f = p[0][2] - q[0][2] > 1e-9 ? Math.max(0, (p[0][2] - z) / (p[0][2] - q[0][2])) : 0;
  return [lerp(p[0], q[0], f), lerp(p[1], q[1], f)];
}

/**
 * The band between two neighbouring columns' drops at the same end (each a
 * rib and its end's kind): their facing sides joined at each height either
 * has a station at, from the floor up to the lower one's round, each reaching
 * bandInto into its drop. None if they are far apart, or it would hit a key.
 */
function band(
  wasm: ManifoldToplevel,
  cfg: Config,
  d: Dims,
  frames: Record<string, Matrix4>,
  end: number,
  pair: [Rib, End][],
) {
  const sides = pair.map(([rib, kind], i) => {
    const [k, o] = [rib, pair[1 - i][0]].map((r) => endKey(r, end)[0]);
    const s = Math.sign(dot(k.c, sub(o.o, k.o)));
    const into = scale([...unitPlan(k.c), 0] as V3, -s * SIZES.bandInto);
    return dropSide(d, rib, end, s, kind).map((p) => p.map((q) => add(q, into)) as Pair);
  });
  const apart = Math.hypot(...sub(sides[0].at(-1)![0], sides[1].at(-1)![0]));
  if (apart > SIZES.bandGap) return [];
  const top = Math.min(...sides.map((side) => side[0][0][2]));
  const levels = [...new Set(sides.flatMap((side) => side.map((p) => p[0][2])))]
    .filter((z) => z <= top)
    .sort((x, y) => x - y)
    .filter((z, i, all) => !i || z - all[i - 1] > 0.01);
  const [left, right] = sides.map((side) => levels.map((z) => dropAt(side, z)));
  if (levels.length < 2 || !clearOfKeys(cfg, frames, samples(left, right))) return [];
  const stations = levels.map((_, i): Station => {
    const st: Station = [left[i][0], left[i][1], right[i][1], right[i][0]];
    return area2(st) > 0 ? st : (st.reverse() as Station);
  });
  return [solid(wasm, cfg, stations)];
}

/** How far below the plate top the openings check probes each switch hole's column (solid.ts CHECKS.probeHeight / 2). */
const OPENING_PROBE_DEPTH = 12;

/**
 * PROTOTYPE ?walls= and ?ends=: what every key holds (keyBoxes) and its
 * switch hole's column as far down as the openings check probes it, each box
 * in its key's frame and grown by endGap; with whether a point is clear of
 * them all, and how far out along a plan direction from a point everything is.
 */
function keySpace(cfg: Config, frames: Record<string, Matrix4>) {
  const hole = switchHole(cfg).map((x) => x / 2);
  const column: [V3, V3] = [
    [0, 0, -OPENING_PROBE_DEPTH / 2],
    [hole[0], hole[1], OPENING_PROBE_DEPTH / 2],
  ];
  const boxes = Object.keys(frames)
    .filter(isKey)
    .flatMap((n) => {
      const e = frames[n].elements;
      const o: V3 = [e[12], e[13], e[14]];
      const axes = [0, 4, 8].map((i): V3 => [e[i], e[i + 1], e[i + 2]]);
      return [...keyBoxes(cfg, n), column].map(([c, h]) => ({
        o,
        axes,
        c,
        h: h.map((x) => x + SIZES.endGap),
      }));
    });
  const clear = (points: V3[]) =>
    points.every((p) =>
      boxes.every((b) => b.axes.some((a, i) => Math.abs(dot(sub(p, b.o), a) - b.c[i]) > b.h[i])),
    );
  // The last x up to `reach` where from + x out is in a box, by each box's slabs.
  const room = (from: V3, out: V3, reach: number) => {
    let last = 0;
    for (const b of boxes) {
      let [lo, hi] = [-Infinity, Infinity];
      b.axes.forEach((a, i) => {
        const [at, rate] = [dot(sub(from, b.o), a) - b.c[i], dot(out, a)];
        if (Math.abs(rate) < 1e-12) {
          if (Math.abs(at) > b.h[i]) [lo, hi] = [Infinity, -Infinity];
          return;
        }
        const [p, q] = [(-b.h[i] - at) / rate, (b.h[i] - at) / rate];
        [lo, hi] = [Math.max(lo, Math.min(p, q)), Math.min(hi, Math.max(p, q))];
      });
      if (lo <= hi && hi >= 0 && lo <= reach) last = Math.max(last, hi);
    }
    return last >= reach ? Infinity : last;
  };
  return { clear, room };
}

/**
 * PROTOTYPE ?walls=: rib's outer side (s) as a WallSide for the wall
 * variants (skeletyl-walls.prototype.ts documents each field). Its points are
 * the rib's side as built (ribSide), outward is across the rib at each, and the
 * rail is found straight out along it.
 */
function wallSide(
  cfg: Config,
  d: Dims,
  frames: Record<string, Matrix4>,
  rib: Rib,
  ends: End[],
  s: number,
  name: string,
  ring: [number, number][],
  innerRing: [number, number][],
): WallSide {
  const labels: (string | undefined)[] = [];
  const sides = [ribSide(d, rib, s, ends, labels), ribSide(d, rib, -s, ends)];
  // Points across each plate too, between its corners (exact: it is a slab).
  const on: (string | undefined)[] = [];
  const [side, other] = sides.map((path) =>
    path.flatMap((pair, i): Pair[] => {
      const next = path[i + 1];
      if (!labels[i] || labels[i] !== labels[i + 1]) return [pair];
      return [...Array(SIZES.plateSteps).keys()].map(
        (j) => pair.map((p, m) => lerp(p, next[m], j / SIZES.plateSteps)) as Pair,
      );
    }),
  );
  labels.forEach((l, i) =>
    on.push(...Array(l && l === labels[i + 1] ? SIZES.plateSteps : 1).fill(l)),
  );
  const flat = (p: number[]): V3 => [p[0], p[1], 0];
  const points = side.map(([top, under], i): WallPoint => {
    const out = flat(unitPlan(sub(under, other[i][1])));
    const at = (r: [number, number][]) => flat(add(under, scale(out, toRing(r, under, out))));
    const [inner, outerEdge] = [at(innerRing), at(ring)];
    const key = on[i] || undefined;
    return {
      top,
      under,
      out,
      over: on[i] === undefined ? 'end' : key ? 'key' : 'web',
      key,
      rail: { inner, centre: lerp(inner, outerEdge, 0.5), outer: outerEdge },
    };
  });
  const keys = rib.keys.map((k) => ({
    name: k.name,
    from: on.indexOf(k.name),
    to: on.lastIndexOf(k.name),
  }));
  const space = keySpace(cfg, frames);
  const room = (from: V3, out: V3) => space.room(from, out, toRing(ring, from, out));
  const finish = (e: End) => (isDrop(e) ? 'drop' : isJoin(e) ? 'flush' : e);
  return {
    name,
    points,
    keys,
    ends: [finish(ends[0]), finish(ends[1])],
    wall: d.wall,
    railHeight: SIZES.railHeight,
    outline: ring,
    clear: space.clear,
    room,
  };
}

/** PROTOTYPE ?ends=: whether points are clear of what every key but those `except` holds and of their switch holes' columns (keySpace). */
const clearOf = (
  cfg: Config,
  frames: Record<string, Matrix4>,
  points: V3[],
  except: string[] = [],
) =>
  keySpace(
    cfg,
    Object.fromEntries(Object.entries(frames).filter(([n]) => !except.includes(n))),
  ).clear(points);

/**
 * PROTOTYPE ?ends=: whether a rib's end can drop as `kind` onto the tie: its
 * drop (below the round, which it has anyway) is clear of the other keys,
 * tested every mm or so down it.
 */
function dropClear(
  cfg: Config,
  d: Dims,
  frames: Record<string, Matrix4>,
  rib: Rib,
  end: number,
  kind: End,
) {
  const [left, right] = [-1, 1].map((s) => dropSide(d, rib, end, s, kind));
  const top = Math.max(left[0][0][2], right[0][0][2]);
  const levels = [...Array(Math.ceil(top) + 1).keys()].map((j) => (top * j) / Math.ceil(top));
  const [l, r] = [left, right].map((side) => levels.map((z) => dropAt(side, z)));
  return clearOf(cfg, frames, samples(l, r), [endKey(rib, end)[0].name]);
}

/**
 * PROTOTYPE ?ends=join: a column's front (rib's first end) joined to a thumb
 * key's plate: a web from the front's plate edge to the nearest thumb plate
 * edge it can reach without folding back (each edge past the other, as
 * between keys) or running into the other keys, landing the rib's width
 * along that edge, centred where the front's corners meet it, but kept on it.
 * None if it can reach none, or only one turned more than 60° from it.
 */
function joinTo(
  cfg: Config,
  d: Dims,
  frames: Record<string, Matrix4>,
  rib: Rib,
  thumbs: RibKey[],
): { join: Join } | undefined {
  const [k, u] = endKey(rib, 0);
  const w = across(k, d.plateHalf);
  const out = scale(k.a, u);
  const options = thumbs.flatMap((t) =>
    [0, 1].flatMap((axis) =>
      [-1, 1].flatMap((sign) => {
        // t's plate edge `sign` along its key axis (axis 0) or across it (1).
        const [v, e] = axis ? [t.c, t.a] : [t.a, t.c];
        const [hv, he] = axis
          ? [across(t, d.plateHalf), along(t, d.plateHalf)]
          : [along(t, d.plateHalf), across(t, d.plateHalf)];
        const into = scale(v, -sign);
        const mid = add(t.o, scale(v, sign * hv));
        const at = [-1, 1].map((s) => dot(sub(corner(d, k, u, s, 0), mid), e));
        if (Math.abs(at[1] - at[0]) < w) return [];
        const centre = Math.max(-Math.max(0, he - w), Math.min(he - w, (at[0] + at[1]) / 2));
        // Landing the front's side s (its pose's side u·s, heading out) toward
        // where that side's corner meets the edge.
        const land: Pose = {
          p: add(mid, scale(e, centre)),
          t: into,
          c: scale(e, u * Math.sign(at[1] - at[0])),
          half: w,
          thick: d.plate,
        };
        // In plan, every point of the landing ahead of every point of the
        // front's edge, along the front, and every point of that edge short
        // of the landing, along the way in.
        const edge = [-1, 1].flatMap((s) => [0, -d.plate].map((z) => corner(d, k, u, s, z)));
        const to = [-1, 1].flatMap((s) => poseSide(land, s));
        const [h, g] = [out, into].map((v) => [...unitPlan(v), 0] as V3);
        const past = edge.every((a) =>
          to.every((b) => dot(sub(b, a), h) > 0 && dot(sub(b, a), g) > 0),
        );
        if (!past) return [];
        const join = { join: { key: t.name, land, into: SIZES.joinInto } };
        const [left, right] = [-1, 1].map((s) => endSide(d, k, u, s, join));
        if (!clearOf(cfg, frames, samples(left, right, 1), [k.name, t.name])) return [];
        const from = lerp(left[0][0], right[0][0], 0.5);
        const length = Math.hypot(...sub(land.p, from).slice(0, 2));
        return length <= SIZES.joinReach ? [{ join, length }] : [];
      }),
    ),
  );
  return options.sort((x, y) => x.length - y.length)[0]?.join;
}

/**
 * PROTOTYPE ?ends=flow: a thumb row's end (rib `row`, end e) carried on into a
 * column's front (`column`'s first end) as one rib: from the row end's plate
 * edge, a sweep to the front's plate edge, arriving along the column, the
 * front then flush. With how long it is (plan, edge to edge) and the other
 * keys it runs into (keySpace), but for those the two plate edges it joins
 * already run into (the layout's doing, which the checks report). None if it
 * would fold back on itself.
 */
function flowTo(
  cfg: Config,
  d: Dims,
  frames: Record<string, Matrix4>,
  row: Rib,
  e: number,
  column: Rib,
): { end: { join: Join }; length: number; hits: string[] } | undefined {
  const [k, u] = endKey(row, e);
  const front = column.keys[0];
  const end = { join: { key: front.name, land: edgePose(d, front, -1), into: 0 } };
  const [left, right] = [-1, 1].map((s) => endSide(d, k, u, s, end));
  // Each station wholly ahead of the one before (beyond the plane it lies
  // in, heading on) and that one wholly behind it: it doesn't fold back.
  const plane = (m: number): [V3, V3] => {
    const [l, r] = [left[m], right[m]];
    return [lerp(l[0], r[1], 0.5), unit(cross(sub(r[0], l[0]), sub(l[0], l[1])))];
  };
  const on = left.slice(1).every((_, m) => {
    const [[o0, n0], [o1, n1]] = [plane(m), plane(m + 1)];
    return (
      [left[m + 1], right[m + 1]].flat().every((q) => dot(sub(q, o0), n0) > 0) &&
      [left[m], right[m]].flat().every((q) => dot(sub(q, o1), n1) < 0)
    );
  });
  if (!on) return undefined;
  // What it runs into, but for what the two plate edges it joins already do.
  const into = (points: V3[]) =>
    Object.keys(frames).filter((n) => isKey(n) && !keySpace(cfg, { [n]: frames[n] }).clear(points));
  const already = into([0, left.length - 1].flatMap((m) => [left[m], right[m]].flat()));
  const hits = into(samples(left, right, 1)).filter((n) => !already.includes(n));
  const length = Math.hypot(...sub(end.join.land.p, edgePose(d, k, u).p).slice(0, 2));
  return { end, length, hits };
}

/**
 * PROTOTYPE ?ends=tie: the floor tie, as the plan of a strip the rail's width
 * (the rail extrudes it with its own section), and the hanging ends that drop
 * onto it (changed in `ends`). It runs through where each hanging end that
 * could drop straight down clear of the keys would stand, in order across the
 * hand, and on at each end to the rail, as clear of the keys: straight on if
 * it meets the rail near square, or else turned square into it a little short
 * of it; or else straight on past the end's drop by tieRound and turned as
 * little as clears (toward where the ends face first), then square into the
 * rail as before. Its bends are rounded. Then each of those ends drops onto
 * it, landing square on it: across along it, its outer face on the tie's far
 * side. Where the rail is closer to an end drop than tieRound from its side,
 * the drops land moved along the tie away from it, bending to meet it, so that
 * none lands in the tie's fillets into the rail. None if no hanging end could
 * drop.
 */
function floorTie(
  wasm: ManifoldToplevel,
  cfg: Config,
  d: Dims,
  frames: Record<string, Matrix4>,
  all: Rib[],
  ends: End[][],
  ring: [number, number][],
) {
  const R = SIZES.tieRound;
  const spots = all.flatMap((rib, i) =>
    [0, 1].flatMap((e) => {
      if (ends[i][e] !== 'hang') return [];
      const top = dropTop(d, ...endKey(rib, e));
      const down = straightDown(top);
      if (!dropClear(cfg, d, frames, rib, e, { land: down })) return [];
      // Where it would stand: its drop's middle, half a wall in from its outer face.
      const h = top.n!;
      return [{ i, e, top, h, half: down.half, down, stand: sub(down.p, scale(h, d.wall / 2)) }];
    }),
  );
  if (!spots.length) return undefined;
  // Across the hand: along the line through the two farthest apart.
  const pairs = spots.flatMap((p, i) => spots.slice(i + 1).map((q) => [p.stand, q.stand]));
  const [p0, p1] = pairs.reduce(
    (x, y) => (Math.hypot(...sub(y[0], y[1])) > Math.hypot(...sub(x[0], x[1])) ? y : x),
    [spots[0].stand, add(spots[0].stand, spots[0].top.c)],
  );
  const dir = [...unitPlan(sub(p1, p0)), 0] as V3;
  // Whether the tie from p to q is clear of the keys.
  const clear = (p: V3, q: V3) => {
    const n = Math.ceil(Math.hypot(...sub(q, p)) / 2);
    const side = [...unitPlan([p[1] - q[1], q[0] - p[0]]), 0] as V3;
    const points = [...Array(n + 1).keys()].flatMap((j) =>
      [-1, 1].flatMap((s) =>
        [0, SIZES.railHeight].map((z) =>
          add(add(lerp(p, q, j / n), scale(side, (s * d.wall) / 2)), [0, 0, z]),
        ),
      ),
    );
    return clearOf(cfg, frames, points);
  };
  // In order, leaving out any it can't run on to clear of the keys.
  const order = [...spots]
    .sort((p, q) => dot(p.stand, dir) - dot(q.stand, dir))
    .reduce(
      (kept: typeof spots, x) =>
        !kept.length || clear(kept.at(-1)!.stand, x.stand) ? [...kept, x] : kept,
      [],
    );
  // Along the tie at each drop, the way the drops are in order.
  const tangent = order.map((_, m): V3 =>
    order.length < 2
      ? dir
      : ([
          ...unitPlan(
            sub(order[Math.min(m + 1, order.length - 1)].stand, order[Math.max(m - 1, 0)].stand),
          ),
          0,
        ] as V3),
  );
  const facing = order.reduce((sum, x) => add(sum, x.h), [0, 0, 0] as V3);
  // The tie on from the drop x at one end, heading out, to the rail's middle,
  // its drop moved `moved` toward that end: the points after x's stand, and
  // how far too close to the rail it leaves the drop.
  const toRail = (x: (typeof spots)[number], out: V3, moved: number): [V3[], number] => {
    const toward = Math.sign(cross(out, facing)[2]) || 1;
    const past = x.half + moved + R;
    for (const j of [0, 1, 2, 3, 4, 5, 6].flatMap((j) => (j ? [j, -j] : [0]))) {
      const [c, sn] = [
        Math.cos((toward * j * Math.PI) / 12),
        Math.sin((toward * j * Math.PI) / 12),
      ];
      const v: V3 = [out[0] * c - out[1] * sn, out[0] * sn + out[1] * c, 0];
      const from = j ? add(x.stand, scale(out, past)) : x.stand;
      const S = toRing(ring, from, v);
      if (!(S > 0 && S < Infinity)) continue;
      const n = ringAt(ring, add(from, scale(v, S)))[1];
      const cos = dot(v, n);
      if (cos < 0.25) continue;
      // Turned square into the rail where it is 2R and a wall short of it.
      const s = S - (2 * R + d.wall) / cos;
      const square = cos < Math.cos(Math.PI / 12) && s >= (j ? R : past);
      if (j && !square) continue;
      const corner = add(from, scale(v, s));
      const legs = square
        ? [corner, add(corner, scale(n, toRing(ring, corner, n) - d.wall / 2))]
        : [add(from, scale(v, S - d.wall / 2 / cos))];
      const path = [x.stand, ...(j ? [from] : []), ...legs];
      if (!path.slice(1).every((q, m) => clear(path[m], q))) continue;
      return [path.slice(1), j || square ? 0 : Math.max(0, past - (S - d.wall / cos))];
    }
    // Else straight on anyway.
    const S = toRing(ring, x.stand, out);
    return [[add(x.stand, scale(out, S - d.wall / 2))], Math.max(0, past - (S - d.wall))];
  };
  const back =
    order.length > 1
      ? ([...unitPlan(sub(order[0].stand, order[1].stand)), 0] as V3)
      : scale(dir, -1);
  const on = order.length > 1 ? tangent.at(-1)! : dir;
  const [first, short0] = toRail(order[0], back, 0);
  const [last, short1] = toRail(order.at(-1)!, on, short0);
  const path = [...first.reverse(), ...order.map((x) => x.stand), ...last];
  // The centreline, each bend rounded (a quadratic between its tangent points).
  const line = path.flatMap((p, i): V3[] => {
    if (!i || i === path.length - 1) return [p];
    const [a, b] = [path[i - 1], path[i + 1]];
    const t = Math.min(R, Math.hypot(...sub(p, a)) / 2, Math.hypot(...sub(b, p)) / 2);
    const [s, e] = [a, b].map((q) => add(p, scale([...unitPlan(sub(q, p)), 0] as V3, t)));
    return [...Array(SIZES.roundSteps + 1).keys()].map((j) => {
      const f = j / SIZES.roundSteps;
      return lerp(lerp(s, p, f), lerp(p, e, f), f);
    });
  });
  const disc = (p: V3) =>
    [...Array(16).keys()].map((j): [number, number] => {
      const a = (j * Math.PI) / 8;
      return [p[0] + (Math.cos(a) * d.wall) / 2, p[1] + (Math.sin(a) * d.wall) / 2];
    });
  const strip = wasm.CrossSection.union(
    line.slice(1).map((p, j) => wasm.CrossSection.hull([[...disc(line[j]), ...disc(p)]])),
  );
  // The drops, each moved along the tie away from the end the rail is too
  // close to, its outer face on the tie's far side.
  const moved = short0 - short1;
  order.forEach((x, m) => {
    const along = tangent[m];
    const across = scale(
      [along[1], -along[0], 0] as V3,
      Math.sign(dot([along[1], -along[0], 0], x.h)) || 1,
    );
    const q = add(add(x.stand, scale(along, moved)), scale(across, d.wall / 2));
    const drop = { land: landing(x.top, q, along) };
    if (
      Math.hypot(...sub(q, x.down.p)) <= SIZES.reach &&
      dropClear(cfg, d, frames, all[x.i], x.e, drop)
    )
      ends[x.i][x.e] = drop;
  });
  return strip;
}

/**
 * The frame: the ribs, the bands between their drops, and the rail round the
 * outline that the ends standing on it drop to. It stands on z = 0.
 */
export function skeletyl(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
): { frame: Manifold; outline: [number, number][] } {
  const d = dims(cfg);
  const keyRuns = runs(cfg, frames);
  const all = ribs(d, frames, keyRuns);
  const columns = cfg.geometry.columns.length;
  // The outer sides: each key's plate and tile pocket edges on the side away
  // from the keys' middle, on the first and last columns and the thumb rows.
  const keys = all.flatMap((r) => r.keys);
  const middle = [0, 1].map((i) => keys.reduce((sum, k) => sum + k.o[i], 0) / keys.length);
  const outward = (rib: Rib) =>
    Math.sign(
      rib.keys.reduce(
        (sum, k) => sum + k.c[0] * (k.o[0] - middle[0]) + k.c[1] * (k.o[1] - middle[1]),
        0,
      ),
    );
  const outer = (rib: Rib) => rib.run === 0 || rib.run >= columns - 1;
  const outerSide = (rib: Rib) => {
    const s = outward(rib);
    const [pocket, depth] = d.keepClear[0];
    return rib.keys.flatMap((k) =>
      [-1, 1].flatMap((u) => [
        corner(d, k, u, s, 0),
        corner(d, k, u, s, -d.plate),
        keyPoint(k, pocket, u, s, -depth),
      ]),
    );
  };
  const free = (rib: Rib) => [0, 1].filter((e) => !rib.parted[e]);
  const rough = rounded(
    wasm,
    d,
    all.flatMap((rib) => free(rib).flatMap((e) => feet(d, rib, e))),
    all.filter(outer).map(outerSide),
  );
  const kind = (rib: Rib, e: number): End => {
    if (rib.parted[e]) return endClear(cfg, d, frames, rib, e, 'hang') ? 'hang' : 'flush';
    // Straight down onto the outline, or bending out along the end to it.
    const top = dropTop(d, ...endKey(rib, e));
    const out = toRing(rough, top.p, top.n!);
    if (!(Math.abs(out) <= SIZES.reach)) return 'hang';
    const q = add(top.p, scale(top.n!, out));
    const drop = { land: landing(top, q, ringAt(rough, q)[0]) };
    return endClear(cfg, d, frames, rib, e, drop) ? drop : 'hang';
  };
  const ends = all.map((rib) => [0, 1].map((e) => kind(rib, e)));
  // Neighbouring columns' first ribs at the front (end 0), last at the back (1).
  const neighbours = [0, 1].flatMap((e) =>
    [...Array(columns - 1).keys()].map((c) => ({
      e,
      pair: [c, c + 1].map((run) =>
        all.flatMap((r, j) => (r.run === run ? [j] : [])).at(e ? -1 : 0)!,
      ),
    })),
  );
  // The outline cut back to the drops on it and the bands to be between them,
  // each band from one's outer corner to the other's facing it.
  const lands = (i: number, e: number) => {
    const end = ends[i][e];
    return isDrop(end) ? end.land : undefined;
  };
  const faces = [
    ...all.flatMap((_, i) =>
      [0, 1].flatMap((e) => {
        const l = lands(i, e);
        return l ? [[...[-1, 1].map((s) => poseSide(l, s)[0]), normalOf(l)]] : [];
      }),
    ),
    ...neighbours.flatMap(({ e, pair }) => {
      const [a, b] = pair.map((i) => lands(i, e));
      if (!a || !b) return [];
      const facing = (l: Pose, o: Pose) =>
        [-1, 1]
          .map((s) => poseSide(l, s)[0])
          .reduce((x, y) => (gap([o.p, o.p], y) < gap([o.p, o.p], x) ? y : x));
      const [p, q] = [facing(a, b), facing(b, a)];
      if (Math.hypot(...sub(q, p)) > SIZES.bandGap) return [];
      const o = [...unitPlan([q[1] - p[1], p[0] - q[0]]), 0] as V3;
      return [[p, q, dot(o, add(normalOf(a), normalOf(b))) < 0 ? scale(o, -1) : o]];
    }),
  ];
  const ring = trimmed(wasm, rough, faces);
  // PROTOTYPE ?ends= (skeletyl-ends.prototype.ts): the columns' hanging fronts
  // joined to the thumbs, and the floor tie that the hanging ends drop onto.
  const support = (cfg.chassis as { ends?: string }).ends ?? 'none';
  if (!END_SUPPORTS.some((x) => x.key === support))
    throw Error(`Unknown ends "${support}": one of ${END_SUPPORTS.map((x) => x.key)}`);
  if (support === 'flow') {
    // Each thumb row's hanging end carried on into a hanging column front,
    // clear of the other keys, nearest first, each used once.
    const fronts = all.flatMap((rib, i) =>
      rib.run < columns && all.findIndex((r) => r.run === rib.run) === i && ends[i][0] === 'hang'
        ? [i]
        : [],
    );
    const options = all
      .flatMap((rib, i) =>
        rib.run < columns
          ? []
          : [0, 1].flatMap((e) =>
              ends[i][e] === 'hang' || ends[i][e] === 'flush'
                ? fronts.flatMap((j) => {
                    const flow = flowTo(cfg, d, frames, rib, e, all[j]);
                    return flow && !flow.hits.length ? [{ i, e, j, ...flow }] : [];
                  })
                : [],
            ),
      )
      .sort((x, y) => x.length - y.length);
    for (const x of options)
      if (!isJoin(ends[x.i][x.e]) && ends[x.j][0] === 'hang') {
        ends[x.i][x.e] = x.end;
        ends[x.j][0] = 'flush';
      }
  }
  if (support === 'join' || support === 'both' || support === 'flow') {
    const thumbs = all.filter((rib) => rib.run >= columns).flatMap((rib) => rib.keys);
    all.forEach((rib, i) => {
      const front = rib.run < columns && all.findIndex((r) => r.run === rib.run) === i;
      if (front && ends[i][0] === 'hang')
        ends[i][0] = joinTo(cfg, d, frames, rib, thumbs) ?? 'hang';
    });
  }
  const tie =
    support === 'tie' || support === 'both' || support === 'flow'
      ? floorTie(wasm, cfg, d, frames, all, ends, ring)
      : undefined;
  const solids = all.map((rib, i) => ribSolid(wasm, cfg, d, rib, ends[i]));
  // The bands between neighbouring columns' drops.
  const bands = neighbours.flatMap(({ e, pair }) => {
    const sides = pair.map((i): [Rib, End] => [all[i], ends[i][e]]);
    return sides.every(([, kind]) => isDrop(kind)) ? band(wasm, cfg, d, frames, e, sides) : [];
  });
  const area = new wasm.CrossSection([ring], 'NonZero');
  const inside = area.offset(-d.wall, 'Round');
  const loop = area.subtract(inside);
  // PROTOTYPE ?ends=tie: the tie is part of the rail, filleted into it where
  // they meet (and round its bends) as the outline's corners in are rounded.
  const R = SIZES.tieRound;
  const railPlan = tie
    ? loop.add(tie).add(
        loop
          .add(tie)
          .offset(R, 'Round', 2, SIZES.cornerSegments)
          .offset(-R, 'Round', 2, SIZES.cornerSegments)
          .intersect(tie.offset(R + d.wall)),
      )
    : loop;
  const rail = railPlan.extrude(SIZES.railHeight);
  // The ribs' names (as the wall variants have them), and the rail's inner edge.
  const named = all.map((rib) => {
    const n =
      rib.run < columns
        ? cfg.geometry.columns[rib.run].name
        : rib.run === columns
          ? 'thumb'
          : 'thumb extra';
    const same = all.filter((r) => r.run === rib.run);
    return same.length > 1 ? `${n} #${same.indexOf(rib) + 1}` : n;
  });
  const innerRing = () =>
    inside
      .toPolygons()
      .map((p) => p.map((q) => [q[0], q[1]] as [number, number]))
      .reduce((x, y) => (area2(y) > area2(x) ? y : x));
  // PROTOTYPE ?walls= (skeletyl-walls.prototype.ts): walls under the outer sides.
  const walls = skeletylWalls(wasm, cfg, (cfg.chassis as { walls?: string }).walls ?? 'none', () =>
    all.flatMap((rib, i) =>
      outer(rib)
        ? [
            wallSide(
              cfg,
              d,
              frames,
              rib,
              // PROTOTYPE ?ends=join: the walls take a joined end as flush.
              ends[i].map((e) => (isJoin(e) ? 'flush' : e)),
              outward(rib),
              named[i],
              ring,
              innerRing(),
            ),
          ]
        : [],
    ),
  );
  return {
    frame: wasm.Manifold.union([...solids, ...bands, rail, ...walls]),
    outline: ring,
  };
}
