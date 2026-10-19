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
// columns' and the thumb rows' plates and tile pockets, taking in where any
// key's switch hole column or tile comes down near the floor (the rail keeps
// clear of them, as the openings and hardware checks want): their convex
// hull, so it runs straight from foot to foot. It turns in only over open
// floor, a pocket nothing stands in, wide and deep enough (between the
// thumbs and the fingers' fronts), and there once, in one crisp corner
// (straightened). A low end's round is as tight as clears, so its drop's
// foot stands as high as it can; where it still stands below the rail's
// top, the rail dips to it. The ends whose feet are near the outline drop to
// the floor: the rib carried on from the bottom of its round down to the
// rail, as one sweep (as between keys), its across and its width as at the
// bottom of its round all the way down, its foot square: it never twists or
// splays. It stands straight down, or bends out in the end's own plane
// (along the end's heading) as far as the nearer corner of its outer face is
// from the outline, where that is at most reach; the outline then also turns
// in to its outer face and runs straight on from its corners (trimmed), so
// the drop stands flush on the rail, where that clears the other keys;
// the rest stop at the bottom of their rounds. Each rib, ends and all, is
// meshed as one surface. One
// rail round the outline, on the floor, joins the ribs into one piece; each
// drop stands on it alone, but two drops of different ribs standing too
// close for a clean slit are fused (PROTOTYPE): each is widened on its facing
// side into the other, so the union joins them along a line, and the rail
// runs on under the pair, not in between them (fused). PROTOTYPE: small bridges tie neighbouring ribs
// together up at the plates: where two keys of different ribs face each other
// across a narrow gap, a short slab of the plate's section spans it between
// their plates' facing edges, flush with both plates' tops (bridges).
// Nothing is cut out: chassis.ts adds the glue pads and the base, and the
// checks report anything that runs into the tiles or the keycaps.
// PROTOTYPE: chassis.walls (?walls=) adds walls under the outer sides, built
// by skeletyl-walls.prototype.ts from a WallSide per side; "none" adds none.
// PROTOTYPE: chassis.ends (?ends=) supports the hanging ends from the frame's
// own parts (skeletyl-ends.prototype.ts lists the variants): "tie" adds a floor
// tie to the rail, across under them, and drops the ends that can onto it
// (landing square on it, clear of its bends and of where it meets the rail);
// "flow" first carries a thumb row's end on into a column's front as one rib,
// then carries each column front still hanging on in a web to a thumb key's
// plate where it can, and ties the rest as "tie"; "none" leaves them hanging.
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
//  fused    PROTOTYPE: two drops of different ribs widened into each other
//           on their facing sides, where they stand within fuseGap;
//  bridge   PROTOTYPE: a short slab across the gap between two ribs, from one
//           key's plate edge to a facing key's, flush with their tops;
//  tie      PROTOTYPE ?ends=: a bar of the rail's section across the floor,
//           rail to rail, that hanging ends drop onto;
//  pose     where a rib passes and how it lies there: its top's middle, its
//           heading and across, its width and thickness (Pose);
//  join     PROTOTYPE ?ends=flow: a finger front carried on in a web to a
//           thumb key's plate edge instead of a round; a thumb row's end
//           carried on into a column's front is one too.
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
  tilePartCentre,
  tileTop,
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
import { switchHole } from './seats';
import { outline } from './hand/frame';
import {
  skeletylReach,
  skeletylWalls,
  type Reach,
  type RibKit,
  type WallPoint,
  type WallSide,
} from './skeletyl-walls.prototype';
import { END_SUPPORTS } from './skeletyl-ends.prototype';
import type { Wire } from './wiring';

/** Construction sizes in mm. */
export const SIZES = {
  /** The ends and the rail are this thick, unless chassis.wall_mm says. */
  wall: 2.4,
  /** The ends' rounds have at least this outer radius, unless chassis.end_radius_mm says. */
  endRadius: 5,
  /** An end's lip is at least this long. Its round (where the end rises off the plate) or else its lip grows by lipStep until the round and the drop clear the end key's tile pocket and switch body by endGap. Rounds and drops keep endGap from what the other keys hold too, or are not built. */
  lip: 1,
  lipStep: 0.1,
  endGap: 0.3,
  /** A low end's round (one whose lower side would end less than dropBend above railHeight) is tightened by lipStep at a time until it ends that high, as far as it still clears and its inner face keeps at least this radius (endRound). */
  endInner: 0.5,
  /** Stations inside each web, round each end's round, and down each drop (for the checks and the walls; the drop itself is meshed finer, as a joined end is). */
  webSteps: 8,
  roundSteps: 8,
  dropSteps: 8,
  /** The area the outline is drawn round digs in this far at most (plan) between the feet. */
  digDeepest: 12,
  /**
   * The outline runs straight between the feet (the area's convex hull), but
   * turns in once over a pocket (where the hull spans floor the area doesn't
   * cover) that nothing stands in (no drop with both feet in it, no wall's
   * foot), wider across its mouth than pocketMouth and deeper than
   * pocketDepth (straightened). A foot is in a pocket within pocketFoot of
   * its edge.
   */
  pocketMouth: 30,
  pocketDepth: 2,
  pocketFoot: 0.5,
  /** The outline turns exactly at a drop's corner if it turns within this of it, or runs within this of it (trimmed). */
  cornerSnap: 0.2,
  /**
   * Where the outline is cut back to a drop's face, it runs straight from
   * each of the face's corners on to what it must take in, each foot taken
   * as a square speck this far (plan) to each side of it (trimmed).
   */
  footSpeck: 0.01,
  /** Segments per full turn of a rounded offset (round what the outline keeps clear of, and the tie's). */
  cornerSegments: 72,
  /** An end drops to the floor if the outline is at most this far out along the end (plan) from where its drop's outer face would meet the floor straight down, at that face's nearer corner; its drop bends out that far, in the end's own plane, so that corner meets the outline (kind in skeletyl). */
  reach: 12,
  /** PROTOTYPE ?walls=: a wall side has points this many steps across each plate. */
  plateSteps: 5,
  /** The rail round the outline: its height. */
  railHeight: 6,
  /** A drop's foot runs at least this far below where its round ends (footHeight); where the rail dips to meet it, it rises again over dipRun times the dip (railDip). */
  dropBend: 1,
  dipRun: 2.5,
  /** The rail is meshed this fine (mm) where it dips, but not where it is level round a drop's foot, where the foot's own edges lie: points of its own there, a hair off the foot's edge, the union leaves specks of no volume at (railDip). */
  dipMesh: 0.5,
  /** A drop's foot is keyed this far into the rail (or the tie) under it, and as far up into the drop, inside both (footKey), so the two overlap rather than only meet face to face. */
  footInto: 0.5,
  /** PROTOTYPE ?ends=: a column's front joins a thumb key's plate edge at most this far off (plan, middle to middle), its web reaching joinInto into the plate; the tie's bends and its fillets into the rail are rounded to tieRound (plan), and a drop on the tie stands at least tieRound and tieGap (along it) from where it bends or from the rail's inner edge, clear of where the bend's or the fillet's round starts rather than on it. */
  joinReach: 20,
  joinInto: 0.5,
  tieRound: 5,
  tieGap: 0.5,
  /** A rib's surface is meshed in triangles about this big (ribSolid). */
  ribMesh: 2,
  /**
   * PROTOTYPE bridges: a bridge is bridgeWidth wide along the plates' edges,
   * the plate's thickness less bridgeSkin at its top and its underside,
   * reaches bridgeInto into each plate and runs straight on bridgeOut out of
   * each before it bends (bridges). One spans
   * the gap between two keys of different ribs whose plates' facing edges
   * face each other (turned at most bridgeTurn degrees from square on, in
   * plan, their plates at most that from each other) along at least
   * bridgeWidth and bridgeInset more at each end, where the gap (edge to edge,
   * at the bridge's middle) is bridgeLeast to bridgeGap and rises or falls out
   * of the plates at most bridgeSlope (mm per mm across), and where it keeps
   * endGap from what the keys hold and wireGap from the wires (tested at
   * points about bridgeProbe apart through it).
   */
  bridgeWidth: 4,
  bridgeInset: 1,
  bridgeInto: 0.5,
  bridgeSkin: 0.001,
  bridgeOut: 0.3,
  bridgeTurn: 30,
  bridgeLeast: 0.5,
  bridgeGap: 8,
  bridgeSlope: 1,
  wireGap: 0.5,
  bridgeProbe: 0.5,
  /**
   * PROTOTYPE: two drops of different ribs whose facing sides stand within
   * fuseGap of each other (across, where their faces overlap at least
   * fuseDepth in depth), too narrow a slit to print cleanly, are fused: each
   * is widened on that side by half the widest gap and fuseInto, so the two
   * overlap and the union joins them, from their feet up for as long as they
   * stand that close (measured every fuseStep up), and the widening runs out
   * over fuseRamp above that (fused).
   */
  fuseGap: 1.5,
  fuseInto: 0.4,
  fuseDepth: 0.5,
  fuseStep: 0.25,
  fuseRamp: 1,
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
/** How a rib's end finishes: flush with the plate's edge, a round alone, a round and a drop to the floor (on the rail or the tie), landing as the pose `land` (PROTOTYPE: and widened where it is fused to a neighbour's, `widen`), or (PROTOTYPE ?ends=) a web joining it to another key's plate. */
type End = 'flush' | 'hang' | { land: Pose; widen?: Widen[] } | { join: Join };
/** PROTOTYPE: how far a fused drop's side `side` (its landing pose's side, -1 or 1), and its round's, is widened at height z (fused). */
interface Widen {
  side: number;
  at: (z: number) => number;
}
/** PROTOTYPE ?ends=: where a joined end's rib lands: on a plate edge of `key`, as a pose heading into that plate (its sides those of the end's own, heading out), carried on `into` mm past it. */
interface Join {
  key: string;
  land: Pose;
  into: number;
}
const isDrop = (e: End): e is { land: Pose; widen?: Widen[] } =>
  typeof e === 'object' && 'land' in e;
const isJoin = (e: End): e is { join: Join } => typeof e === 'object' && 'join' in e;
/** A point on one side of a rib: [top, underside]; on a drop, [outer face, inner face]. */
type Pair = [V3, V3];

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
export interface Pose {
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
 * arc), the underside thick below the top along it (n unit and square to
 * across, so the section is the rib's own all the way); thick goes smoothly
 * from a's to b's.
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
  // Which way the normal points f along (slerp's direction; it is made unit,
  // and square to across, below).
  const normal = (f: number) =>
    angle < 1e-6 ? na : add(scale(na, Math.sin((1 - f) * angle)), scale(nb, Math.sin(f * angle)));
  const smooth = (f: number) => 3 * f * f - 2 * f ** 3;
  return (f: number): Pose => {
    if (f <= 0) return a;
    if (f >= 1) return b;
    const [l, r] = [left(f), right(f)];
    const c = unit(sub(r, l));
    const towards = normal(f);
    const n = unit(sub(towards, scale(c, dot(towards, c))));
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
 * falls, the lip grows. A low end's round (one ending less than dropBend
 * above the rail) is then tightened, as far as it still clears, so that its
 * drop's foot stands as high as it can and the rail dips to it as little. Its
 * `at` is side s at f along the round (0 at its top, where the lip ends, 1 at
 * its bottom), and `turn` how far it turns.
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
  const build = (L: number, R: number) => {
    const at = (s: number, f: number): Pair => {
      const centre = sub(add(poseSide(edge, s)[0], scale(t, L)), scale(out(start), R));
      const a = start + (-Math.PI / 2 - start) * f;
      return [add(centre, scale(out(a), R)), add(centre, scale(out(a), R - d.wall))];
    };
    const path = (s: number): Pair[] => [
      poseSide(edge, s),
      ...[...Array(SIZES.roundSteps + 1).keys()].map((j) => at(s, j / SIZES.roundSteps)),
    ];
    return Object.assign(path, { at, turn: Math.PI / 2 + start });
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
  // A low end: its round tightened, by lipStep at a time, until its lower
  // side ends dropBend above the rail, as long as it still clears and its
  // inner face keeps endInner of radius.
  const low = (r: number) => Math.min(...[-1, 1].map((s) => build(L, r).at(s, 1)[0][2]));
  const high = SIZES.railHeight + SIZES.dropBend;
  const least = d.wall + SIZES.endInner;
  while (low(R) < high && R - SIZES.lipStep >= least - 1e-9 && clear(build(L, R - SIZES.lipStep)))
    R -= SIZES.lipStep;
  return build(L, R);
}

/**
 * One side (s, -1 or 1 across) of the end of key k that faces u (-1 or 1
 * along), from the plate's corner out. A flush end stops there. A joined end
 * (PROTOTYPE ?ends=flow) runs on as a cubic web to its landing on a thumb
 * plate's edge, then a little into that plate. Otherwise its lip and round
 * (endRound) turn it over and down until it is vertical. A dropping end runs
 * on from there down to its landing, swept as between keys: straight down,
 * or bending out in its own plane to the rail, or along the tie and turning
 * to lie along it.
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
  if (isDrop(end)) {
    const [top, foot] = dropPoses(d, k, u, end.land);
    path.push(...[...sweep(top, foot, SIZES.dropSteps), end.land].map((q) => poseSide(q, u * s)));
    if (end.widen?.some((x) => x.side === u * s)) {
      const other = endSide(d, k, u, -s, { land: end.land });
      return path
        .map((p, i) => widenPair(p, other[i], widthAt(end, u * s, p[0][2])))
        .map(aboveFloor);
    }
  }
  return path.map(aboveFloor);
}

/** PROTOTYPE: how far a fused drop's side `side` (its landing's pose side) is widened at height z (fused). */
const widthAt = (end: { widen?: Widen[] }, side: number, z: number) =>
  (end.widen ?? []).filter((x) => x.side === side).reduce((sum, x) => sum + x.at(z), 0);
/** Side pair p, across from the other side's pair o at the same station, carried w on out across, away from o. */
const widenPair = (p: Pair, o: Pair, w: number): Pair => {
  if (!w) return p;
  const across = unit(sub(p[0], o[0]));
  return p.map((x) => add(x, scale(across, w))) as Pair;
};

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
 * How high the foot of the drop under the end of key k that faces u runs
 * straight down onto the floor, and so how high the rail (or the tie) is
 * under it: railHeight, or, where the round's lower side ends less than
 * dropBend above that, dropBend below where it ends. So whatever its height
 * the drop's outer face is flush with the rail's over the rail's whole height
 * there, one face, and it bends (or its round turns) only above the rail; the
 * rail dips to meet a low one (railDip).
 */
function footHeight(d: Dims, k: RibKey, u: number) {
  return Math.min(SIZES.railHeight, roundLow(d, k, u) - SIZES.dropBend);
}
/** How high the lower side of the round at the end of key k that faces u ends. */
function roundLow(d: Dims, k: RibKey, u: number) {
  const round = endRound(d, k, u);
  return Math.min(...[-1, 1].map((s) => round(s).at(-1)![0][2]));
}
/**
 * The drop under the end of key k that faces u, landing as `land`: its top
 * (dropTop) and the top of its foot (footHeight up), where its outer face
 * stands flush on the rail's (or the tie's) rather than meeting the rail's
 * top a little in from its edge; the drop bends above it.
 */
function dropPoses(d: Dims, k: RibKey, u: number, land: Pose): [Pose, Pose] {
  return [dropTop(d, k, u), ahead(land, -footHeight(d, k, u))];
}
/**
 * The key of the drop under the end of key k that faces u, landing as
 * `land`: a block footInto down into the rail (or the tie) under its foot and
 * as far up into the drop (to its section there, as it bends), narrowed by as
 * much on every side (in from its outer and inner faces and its sides), so
 * that it lies inside both and they
 * overlap by that much, rather than only meet on the foot's level. Its faces
 * cross that level square, well in from the edges where the drop's faces
 * carry on the rail's. None for a foot too low to key.
 */
function footKey(wasm: ManifoldToplevel, d: Dims, k: RibKey, u: number, land: Pose) {
  const [top, foot] = dropPoses(d, k, u, land);
  const into = Math.min(SIZES.footInto, foot.p[2] / 2);
  if (!(into > 0)) return [];
  const narrowed = (q: Pose): Pose => ({
    ...q,
    p: sub(q.p, scale(normalOf(q), into)),
    half: q.half - into,
    thick: q.thick - 2 * into,
  });
  // Up in the drop: where it is `into` above its foot, as it bends there
  // (the foot of a low drop is only dropBend below its round).
  const at = sweepAt(top, foot);
  let [lo, hi] = [0, 1];
  for (let j = 0; j < 30; j++) {
    const m = (lo + hi) / 2;
    if (at(m).p[2] > foot.p[2] + into) lo = m;
    else hi = m;
  }
  const ends = [at(lo), ahead(foot, into)].map(narrowed);
  return [wasm.Manifold.hull(ends.flatMap((q) => [-1, 1].flatMap((s) => poseSide(q, s))))];
}
/** Where the rail dips to meet a low drop: its top at a plan point, whether the point is near enough to be on the dip (or just past it) but not where it is level, and (plan) the level ground under the foot (patch). */
interface Dip {
  top: (x: number, y: number) => number;
  near: (x: number, y: number) => boolean;
  patch: [number, number][];
}
/**
 * The rail's (and the tie's) top where a drop landing as `land` stands on it
 * lower than railHeight, at `height` (footHeight): level at that height under
 * the drop's foot and a mm round it (so the rail stands square to the
 * drop's faces where they meet), rising on a
 * smooth step (half a cosine wave) to railHeight dipRun times the dip out,
 * the same every way out from the foot (by plan distance from it), so it
 * follows the rail round a corner, and leaves and meets the level tangent.
 * The rail is bent to it (dipped), not cut, so its top stays one smooth
 * surface: a cut would cross the rail's top at a slant, a crease, or graze it,
 * which the union leaves slivers along.
 */
function railDip(land: Pose, height: number): Dip {
  const H = SIZES.railHeight;
  const run = SIZES.dipRun * (H - height);
  // The foot's level, as its mesh has it (laneSolid's are single precision).
  const level = Math.fround(height);
  const [c, n] = [land.c, normalOf(land)];
  const [c0, c1, n0, n1] = [-land.half - 1, land.half + 1, -land.thick - 1, 1];
  // Where a point is (plan): along the foot and out of its outer face.
  const at = (x: number, y: number) => {
    const v = [x - land.p[0], y - land.p[1]];
    return [v[0] * land.c[0] + v[1] * land.c[1], v[0] * n[0] + v[1] * n[1]];
  };
  // How far (plan) a point is out from the foot.
  const out = (x: number, y: number) => {
    const [c, m] = at(x, y);
    return Math.hypot(Math.max(c0 - c, 0, c - c1), Math.max(n0 - m, 0, m - n1));
  };
  return {
    top: (x, y) => {
      const o = out(x, y);
      return o >= run ? H : level + ((H - level) * (1 - Math.cos((Math.PI * o) / run))) / 2;
    },
    near: (x, y) => {
      const o = out(x, y);
      return o > 0 && o < run + SIZES.dipMesh;
    },
    // Halfway out into the level mm round the foot, where the top is level.
    patch: [
      [c0 / 2 - land.half / 2, n0 / 2 - land.thick / 2],
      [c1 / 2 + land.half / 2, n0 / 2 - land.thick / 2],
      [c1 / 2 + land.half / 2, n1 / 2],
      [c0 / 2 - land.half / 2, n1 / 2],
    ].map(([u, m]) => [land.p[0] + c[0] * u + n[0] * m, land.p[1] + c[1] * u + n[1] * m]),
  };
}
/** A pair kept above the floor. */
const aboveFloor = (pair: Pair) => pair.map((p) => [p[0], p[1], Math.max(0, p[2])]) as Pair;

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

/**
 * A stretch of a rib's path: both its sides ([side -1, side 1], each [top,
 * underside]) at f along it (0 to 1), whether each line along it is straight
 * (over a plate, along a lip, down a drop's foot) and how many steps it takes
 * at least (one per 5° its heading or normal turns).
 */
export interface Span {
  at: (f: number) => [Pair, Pair];
  straight?: boolean;
  steps: number;
}
const turnOf = (p: V3, q: V3) => Math.acos(Math.max(-1, Math.min(1, dot(p, q))));
const stepsOf = (turn: number) => Math.ceil(turn / (Math.PI / 36));
/** Both sides of pose q, the rib's side s its side o·s. */
const sidesOf = (q: Pose, o: number): [Pair, Pair] => [poseSide(q, -o), poseSide(q, o)];
/** The rib swept from pose a to pose b (sweepAt), the rib's side s its poses' side o·s. */
const poseSpan = (a: Pose, b: Pose, o: number): Span => {
  const at = sweepAt(a, b);
  return {
    at: (f) => sidesOf(at(f), o),
    steps: stepsOf(Math.max(turnOf(a.t, b.t), turnOf(normalOf(a), normalOf(b)))),
  };
};
/** The rib swept from pose a to pose b (as poseSpan), its steps one per 5° its top's middle turns along the way, not just end to end (an S turns and turns back). */
const bendSpan = (a: Pose, b: Pose): Span => {
  const at = sweepAt(a, b);
  const p = [...Array(65).keys()].map((j) => at(j / 64).p);
  const ways = p.slice(1).map((q, j) => unit(sub(q, p[j])));
  const turn = ways.slice(1).reduce((sum, w, j) => sum + turnOf(w, ways[j]), 0);
  return { at: (f) => sidesOf(at(f), 1), steps: stepsOf(turn) };
};
/** Straight from sides p to sides q. */
const lineSpan = (p: [Pair, Pair], q: [Pair, Pair]): Span => ({
  at: (f) => p.map((pair, i) => pair.map((x, j) => lerp(x, q[i][j], f))) as [Pair, Pair],
  straight: true,
  steps: 1,
});
const reversed = (span: Span): Span => ({ ...span, at: (f) => span.at(1 - f) });
/** Both sides of key k's plate at its edge u (-1 or 1 along). */
const plateSides = (d: Dims, k: RibKey, u: number) =>
  [-1, 1].map((s): Pair => [corner(d, k, u, s, 0), corner(d, k, u, s, -d.plate)]) as [Pair, Pair];

/**
 * The spans of the end of key k that faces u (-1 or 1 along), from its
 * plate's corners out, as endSide has its sides: a joined end's web and on
 * into the plate it joins (at least joinInto, inside that plate's slab, so it
 * overlaps it rather than only meeting it face to face); else the lip, the
 * round and a drop's bend, down to the top of its foot (dropPoses), kept
 * above the floor. The drop stands there on the rail (or the tie), whose top
 * is level at that height under it (footHeight), its own faces carrying on
 * the drop's: their faces meet only on that level, rather than overlapping
 * down to the floor, two near-coplanar faces the union leaves slivers
 * between. Inside, the two overlap: the drop is keyed into the rail
 * (footKey).
 */
function endSpans(d: Dims, k: RibKey, u: number, end: End): Span[] {
  if (end === 'flush') return [];
  if (isJoin(end)) {
    const from = u > 0 ? edgePose(d, k, u) : flip(edgePose(d, k, u));
    const { land, into } = end.join;
    const on = ahead(land, Math.max(into, SIZES.joinInto));
    return [poseSpan(from, land, u), lineSpan(sidesOf(land, u), sidesOf(on, u))];
  }
  const round = endRound(d, k, u);
  const arc = (f: number) => [-1, 1].map((s) => round.at(u * s, f)) as [Pair, Pair];
  const spans: Span[] = [
    lineSpan(plateSides(d, k, u), arc(0)),
    { at: arc, steps: stepsOf(round.turn) },
  ];
  if (isDrop(end)) {
    const [top, foot] = dropPoses(d, k, u, end.land);
    spans.push(poseSpan(top, foot, u));
    // PROTOTYPE: fused, its side (and its round's and lip's) widened.
    if (end.widen?.length) {
      const widen = (sides: [Pair, Pair]) =>
        sides.map((p, j) => widenPair(p, sides[1 - j], widthAt(end, u * (2 * j - 1), p[0][2]))) as [
          Pair,
          Pair,
        ];
      // (A span it doesn't reach is left as it is.)
      const reaches = (span: Span) =>
        [0, 0.5, 1].some((f) =>
          span.at(f).some((p, j) => widthAt(end, u * (2 * j - 1), p[0][2]) > 0),
        );
      return spans.map((span) =>
        reaches(span)
          ? {
              ...span,
              straight: false,
              at: (f) => widen(span.at(f).map(aboveFloor) as [Pair, Pair]),
            }
          : { ...span, at: (f) => span.at(f).map(aboveFloor) as [Pair, Pair] },
      );
    }
  }
  return spans.map((span) => ({ ...span, at: (f) => span.at(f).map(aboveFloor) as [Pair, Pair] }));
}

/**
 * A rib's solid: one surface along its whole path, from its first end's
 * landing (or round, or plate edge) over each plate and web to its last's,
 * so that where a round turns into its drop, or a web into a plate, it runs
 * on as one mesh with no seam (each drop or joined end had been a solid of
 * its own, overlapping the round it hung from). A joined end overlaps the
 * plate it joins and the union takes it; a drop stands on the rail (or the
 * tie), meeting it on the level top of its foot (endSpans), and is keyed
 * into it there (footKey, a solid of its own in the frame's union, so that
 * the rib's own mesh goes into it as it is). Meshed in lanes (laneSolid).
 */
function ribSolid(wasm: ManifoldToplevel, d: Dims, rib: Rib, ends: End[]): Manifold {
  return laneSolid(wasm, ribSpans(d, rib, ends), 'ribSolid');
}

/** A rib's spans, end to end: its ends', its plates' and its webs' (ribSolid). */
function ribSpans(d: Dims, rib: Rib, ends: End[]): Span[] {
  const keys = rib.keys;
  return [
    ...endSpans(d, keys[0], -1, ends[0]).reverse().map(reversed),
    ...keys.flatMap((k, i) => [
      ...(i ? [poseSpan(edgePose(d, keys[i - 1], 1), edgePose(d, k, -1), 1)] : []),
      lineSpan(plateSides(d, k, -1), plateSides(d, k, 1)),
    ]),
    ...endSpans(d, keys.at(-1)!, 1, ends[1]),
  ];
}

/** A lane of laneSolid's: across (0 at side -1, 1 at side 1) and down (0 top, 1 underside). */
const laneAt =
  (across: number, down: number) =>
  ([l, r]: [Pair, Pair]) =>
    lerp(lerp(l[0], r[0], across), lerp(l[1], r[1], across), down);
/**
 * A lane's points along one span, as laneSolid meshes it: [f, point], f how
 * far along the span (its ends, if straight; else about ribMesh apart along
 * the lane, and at least the span's steps).
 */
const laneAlong = (span: Span, path: (sides: [Pair, Pair]) => V3) =>
  alongOf((f) => path(span.at(f)), span.straight, span.steps);
/** How many lanes laneSolid cuts spans' cross-section into: across the top (and the underside), and down the sides. */
function laneCounts(spans: Span[]): [number, number] {
  const h = SIZES.ribMesh;
  const stations = spans.flatMap((span) => [span.at(0), span.at(1)]);
  const m = Math.ceil(Math.max(...stations.map(([l, r]) => Math.hypot(...sub(r[0], l[0])))) / h);
  const v = Math.ceil(Math.max(...stations.map(([l]) => Math.hypot(...sub(l[0], l[1])))) / h);
  return [m, v];
}
/** The points of a lane at(f) (f from 0 to 1) as laneAlong has them. */
function alongOf(
  path: (f: number) => V3,
  straight: boolean | undefined,
  steps: number,
): [number, V3][] {
  const h = SIZES.ribMesh;
  const fine = 128;
  const at = (f: number): [number, V3] => [f, path(f)];
  if (straight) return [at(0), at(1)];
  const dense = [...Array(fine + 1).keys()].map((j) => path(j / fine));
  const run = [0];
  dense.slice(1).forEach((p, j) => run.push(run[j] + Math.hypot(...sub(p, dense[j]))));
  const n = Math.max(1, Math.ceil(run[fine] / h), steps);
  return [...Array(n + 1).keys()].map((j) => {
    const want = (run[fine] * j) / n;
    let after = 1;
    while (after < fine && run[after] < want) after++;
    const f = (want - run[after - 1]) / (run[after] - run[after - 1] || 1);
    return at((after - 1 + Math.min(1, Math.max(0, f))) / fine);
  });
}

/**
 * The solid along spans, end to end, meshed evenly. A rib's stations each run
 * straight across its whole width, and round a tight turn its outer side runs
 * several times as far as its inner, or as it twists its sides run across, so
 * the quads between stations would be long slivers, or fold, and shade as
 * streaks. Instead the cross-section's outline is cut into lanes about
 * ribMesh apart (across the top and the underside, down the sides), each lane
 * runs along the spans with points about ribMesh apart along its own length
 * (and at least each span's steps; a straight span needs none between its
 * ends), and neighbouring lanes are stitched with triangles, each advancing
 * whichever lane is behind. Each point lies on its station's straight line
 * across, so it is the same surface as the stations', sampled finer. The
 * spans head along t with side 1 along c from side -1 and the top along
 * n = t × c from the underside, so that it faces out.
 */
function laneSolid(wasm: ManifoldToplevel, spans: Span[], what: string): Manifold {
  // The lanes, round the cross-section: the top from side -1 to 1, down side
  // 1, the underside back, up side -1.
  const [m, v] = laneCounts(spans);
  const lanes = [
    ...[...Array(m + 1).keys()].map((j) => laneAt(j / m, 0)),
    ...[...Array(v - 1).keys()].map((j) => laneAt(1, (j + 1) / v)),
    ...[...Array(m + 1).keys()].map((j) => laneAt(1 - j / m, 1)),
    ...[...Array(v - 1).keys()].map((j) => laneAt(0, 1 - (j + 1) / v)),
  ];
  // Each lane's points: [g, point], g its span's index and how far along it.
  const points = lanes.map((path) =>
    spans.flatMap((span, i) =>
      laneAlong(span, path)
        .slice(i ? 1 : 0)
        .map(([f, p]): [number, V3] => [i + f, p]),
    ),
  );
  return laneMesh(wasm, points, [spans[0].at(0), spans.at(-1)!.at(1)], what);
}

/**
 * laneSolid's mesh of its lanes' points ([g, point], g how far along, each
 * lane round the cross-section in turn: the top from side -1 to 1, down side
 * 1, the underside back, up side -1), its ends' stations (`ends`, first and
 * last, for the ends' planes and which way they face).
 */
function laneMesh(
  wasm: ManifoldToplevel,
  points: [number, V3][][],
  ends: [[Pair, Pair], [Pair, Pair]],
  what: string,
): Manifold {
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
  // The two ends closed, facing back along the rib and on along it: seen
  // along the rib, across (c) and up (n) wind counter-clockwise, as c × n = t.
  [0, 1].forEach((last) => {
    const [l, r] = ends[last];
    const c = unit(sub(r[0], l[0]));
    const up = sub(l[0], l[1]);
    const n = unit(sub(up, scale(c, dot(up, c))));
    const ring = ids.map((lane) => (last ? lane.at(-1)! : lane[0]));
    const plan = ring.map((id): [number, number] => {
      const p = sub(verts.slice(id * 3, id * 3 + 3) as V3, l[0]);
      return [dot(p, c), dot(p, n)];
    });
    const ccw = area2(plan) > 0;
    const order = ring.map((_, i) => (ccw ? i : ring.length - 1 - i));
    for (const [x, y, z] of wasm.triangulate([order.map((i) => plan[i])])) {
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
  if (solid.status() !== 'NoError') throw new Error(`${what}: ${solid.status()}`);
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
 * The outline, counter-clockwise, before it is trimmed to the drops: straight
 * round an area (straightened), the feet's convex hull dug in at most
 * digDeepest, the outer sides' plates' and tile pockets' hulls, and each of
 * `keep` (plan points) and the rail's width round it, so the rail stays out
 * of them; and (PROTOTYPE ?walls=) each of `walls` (plan polygons): a wall's
 * foot, which the hull takes in, so that a straight run passes along it.
 * With what it must still take in where it is trimmed (firm): the outer
 * sides, `keep`, `walls` and each of the feet (a speck), but not the floor
 * between the feet.
 */
function outlined(
  wasm: ManifoldToplevel,
  d: Dims,
  feet: V3[],
  sides: V3[][],
  keep: V3[][],
  walls: [number, number][][] = [],
) {
  const plan = (ps: V3[]) => ps.map((p) => [p[0], p[1]] as [number, number]);
  const round = (c: CrossSection, by: number) => c.offset(by, 'Round', 2, SIZES.cornerSegments);
  const firm = [
    ...sides.map((side) => wasm.CrossSection.hull([plan(side)])),
    ...keep.map((ps) => round(wasm.CrossSection.hull([plan(ps)]), d.wall)),
  ];
  const area = wasm.CrossSection.union([
    new wasm.CrossSection([plan(outline(feet, d.wall, SIZES.digDeepest))], 'NonZero'),
    ...firm,
  ]);
  const stand = walls.map((poly) => new wasm.CrossSection([poly], 'NonZero'));
  // Each foot, as a speck.
  const specks = feet.map((p) =>
    wasm.CrossSection.square([2 * SIZES.footSpeck, 2 * SIZES.footSpeck], true).translate([
      p[0],
      p[1],
    ]),
  );
  return {
    ring: straightened(
      wasm,
      stand.length ? area.add(wasm.CrossSection.union(stand)) : area,
      feet,
      stand,
    ),
    firm: wasm.CrossSection.union([...firm, ...stand, ...specks]),
  };
}
/**
 * The area's convex hull, but where the hull spans a pocket (a stretch where
 * the area turns in) that nothing stands in (no drop with both feet, `feet`
 * in pairs, on its edge; none of `walls`' feet), both wider than pocketMouth and
 * deeper than pocketDepth, turned in once there: from each end of the
 * pocket's mouth, straight on to the area (tangent to it, the farthest it can
 * run toward the other end without crossing it), the two lines meeting in one
 * corner.
 */
function straightened(
  wasm: ManifoldToplevel,
  area: CrossSection,
  feet: V3[],
  walls: CrossSection[],
) {
  const hull = area.hull();
  const edges = largest(hull).map((a, i, all) => [a, all[(i + 1) % all.length]]);
  const onHull = (p: number[]) => edges.some((e) => gap(e, [p[0], p[1], 0]) < 1e-3);
  const notches = hull
    .subtract(area)
    .decompose()
    .flatMap((pocket) => {
      const ring = largest(pocket);
      // The mouth: the run of its points on the hull (start a, end b), and
      // the rest, the area's edge across the pocket from b round to a.
      const on = ring.map(onHull);
      const start = on.findIndex((x, i) => x && !on[(i + ring.length - 1) % ring.length]);
      if (start < 0) return [];
      const turned = [...ring.slice(start), ...ring.slice(0, start)];
      const flags = [...on.slice(start), ...on.slice(0, start)];
      const n = flags.findIndex((x) => !x);
      if (n < 2) return [];
      const [a, b] = [turned[0], turned[n - 1]];
      const chain = turned.slice(n);
      const mouth = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const depth = Math.max(...chain.map((p) => gap([a, b], [p[0], p[1], 0])));
      // Whether something stands in it: a drop (both its feet on the
      // pocket's edge and off the hull, not one at the mouth's end) or a
      // wall's foot (overlapping it).
      const near = (p: V3, es: number[][][], by: number) => es.some((e) => gap(e, p) < by);
      const sides = ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);
      const stands =
        feet.some(
          (p, i) =>
            i % 2 === 0 &&
            [p, feet[i + 1]].every(
              (q) => near(q, sides, SIZES.pocketFoot) && !near(q, edges, SIZES.cornerSnap),
            ),
        ) || walls.some((f) => f.intersect(pocket).area() > SIZES.pocketFoot ** 2);
      if (stands || mouth <= SIZES.pocketMouth || depth <= SIZES.pocketDepth) return [];
      // From each end, the line through the chain's point nearest in angle to
      // the mouth: none of the chain is on the mouth's side of it.
      const tangent = (o: number[], to: number[]) => {
        const m = Math.atan2(to[1] - o[1], to[0] - o[0]);
        const off = (p: number[]) => {
          let x = Math.atan2(p[1] - o[1], p[0] - o[0]) - m;
          while (x > Math.PI) x -= 2 * Math.PI;
          while (x < -Math.PI) x += 2 * Math.PI;
          return Math.abs(x);
        };
        return chain.reduce((x, y) => (off(y) < off(x) ? y : x));
      };
      const [ta, tb] = [tangent(a, b), tangent(b, a)];
      // Where the two lines meet.
      const [e, f] = [
        [ta[0] - a[0], ta[1] - a[1]],
        [tb[0] - b[0], tb[1] - b[1]],
      ];
      const den = e[0] * f[1] - e[1] * f[0];
      if (Math.abs(den) < 1e-12) return [];
      const s = ((b[0] - a[0]) * f[1] - (b[1] - a[1]) * f[0]) / den;
      const v: [number, number] = [a[0] + s * e[0], a[1] + s * e[1]];
      return [
        new wasm.CrossSection([[a, v, b]], 'Positive').add(
          new wasm.CrossSection([[a, b, v]], 'Positive'),
        ),
      ];
    });
  return largest(notches.length ? hull.subtract(wasm.CrossSection.union(notches)) : hull);
}
/** The largest of a cross-section's polygons. */
const largest = (c: CrossSection) =>
  c
    .toPolygons()
    .map((p) => p.map((q) => [q[0], q[1]] as [number, number]))
    .reduce((x, y) => (area2(y) > area2(x) ? y : x));
/**
 * The outline cut back to the faces standing on it, each [a, b, outward]
 * (plan), wherever it runs out past one, so that each drop stands on it as it
 * lands, square to its own end, and the outline turns to meet it: the floor
 * in front of the face (between the lines out from its ends) is cut away, and
 * from each of the face's ends the outline runs straight on to what it must
 * still take in (`firm`), turning only there: the shortest way round `firm`
 * that keeps out of what is cut away (its convex hull, relative to that).
 * Its points within cornerSnap of a face's end are moved onto it, and a
 * face's end within cornerSnap of a run is put into it, so that where the
 * outline turns at (or runs past) a drop's corner it does so exactly there,
 * rather than a few hundredths past it, a ledge at the drop's foot.
 * PROTOTYPE: it takes in each of `keep` (plan polygons) after it is cut:
 * where two fused drops overlap, the foot of the junction, so that it runs on
 * round the one in front there.
 */
function trimmed(
  wasm: ManifoldToplevel,
  ring: [number, number][],
  firm: CrossSection,
  faces: V3[][],
  keep: [number, number][][] = [],
) {
  if (!faces.length) return ring;
  const section = (p: number[][]) =>
    new wasm.CrossSection([p.map((q) => [q[0], q[1]] as [number, number])], 'NonZero');
  const whole = section(ring);
  // In front of each face, out to where the outline runs: the strip out from
  // it, as far as the part of it inside the outline that touches the face
  // runs out and a mm on (so that the cut runs out through the outline,
  // rather than along it, which would leave a hair of it).
  const strip = ([a, b, o]: V3[], out: number) =>
    section([a, b, add(b, scale(o, out)), add(a, scale(o, out))]);
  const fronts = faces.flatMap((face) => {
    const [a, , o] = face;
    const skin = strip(face, 0.01);
    return whole
      .intersect(strip(face, 1e3))
      .decompose()
      .filter((piece) => piece.intersect(skin).area() > 1e-6)
      .map((piece) => {
        const out = piece
          .toPolygons()
          .flat()
          .map((p) => (p[0] - a[0]) * o[0] + (p[1] - a[1]) * o[1]);
        return strip(face, Math.max(...out) + 1);
      });
  });
  const ends = faces.flatMap(([a, b]) => [a, b]);
  const near = (p: number[], q: number[], by: number) => Math.hypot(p[0] - q[0], p[1] - q[1]) < by;
  let cut = whole;
  if (fronts.length) {
    const ccw = largest(whole.subtract(wasm.CrossSection.union(fronts)));
    // Pulled taut from the points the cut made: each point that turns out
    // and isn't a face's end goes, the outline running straight past it, or
    // round only what is firm in the corner it would cut (its ear: the convex
    // hull of that and its neighbours), and its neighbours are looked at
    // again. A point whose ear another point of the outline comes into
    // stays.
    const turn = (o: number[], p: number[], q: number[]) =>
      (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
    const work = ccw.filter((q) => !ring.some((r) => near(q, r, 1e-6)));
    for (let guard = 0; work.length && guard < 1e4; guard++) {
      const v = work.pop()!;
      const i = ccw.indexOf(v);
      if (i < 0 || ends.some((e) => near(v, e, SIZES.cornerSnap))) continue;
      const [u, w] = [ccw[(i + ccw.length - 1) % ccw.length], ccw[(i + 1) % ccw.length]];
      if (turn(u, v, w) < 0) continue;
      const into = (p: number[]) =>
        p !== u &&
        p !== v &&
        p !== w &&
        [turn(u, v, p), turn(v, w, p), turn(w, u, p)].every((x) => x > -1e-9);
      if (ccw.some(into)) continue;
      const held = section([u, v, w]).intersect(firm);
      const round = held.area() < 1e-9 ? [] : hullBetween(wasm, held, u, w);
      if (!round || (round.length === 1 && near(round[0], v, 1e-6))) continue;
      ccw.splice(i, 1, ...round);
      work.push(u, w);
    }
    cut = section(ccw);
  }
  const snapped = largest(
    keep.length ? wasm.CrossSection.union([cut, ...keep.map((p) => section(p))]) : cut,
  )
    .map((q): [number, number] => {
      const e = ends.find((p) => near(p, q, SIZES.cornerSnap));
      return e ? [e[0], e[1]] : q;
    })
    .filter((q, i, all) => {
      const r = all[(i + 1) % all.length];
      return q[0] !== r[0] || q[1] !== r[1];
    });
  // A face's end within cornerSnap of an edge (a straight run passing a
  // drop's corner a hair in or out) becomes a point of it, so the run meets
  // the foot's corner exactly.
  return through(snapped, ends, SIZES.cornerSnap);
}
/** The convex hull of `held` and points u and w, from u round to w (counter-clockwise, neither included); undefined if either isn't on it. */
function hullBetween(
  wasm: ManifoldToplevel,
  held: CrossSection,
  u: [number, number],
  w: [number, number],
) {
  const hull = largest(wasm.CrossSection.hull([...held.toPolygons(), [u, w]]));
  const ccw = area2(hull) < 0 ? hull.reverse() : hull;
  const at = (p: number[]) => ccw.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6);
  const [i, j] = [at(u), at(w)];
  if (i < 0 || j < 0) return undefined;
  return [...ccw.slice(i + 1), ...ccw.slice(0, i + 1)].slice(
    0,
    (j - i - 1 + ccw.length) % ccw.length,
  );
}
/** Polygon `poly` with each of `pts` within `tol` of one of its edges (and not already a point of it) put in as a point of that edge. */
function through(poly: [number, number][], pts: number[][], tol: number) {
  return poly.flatMap((q, i) => {
    const r = poly[(i + 1) % poly.length];
    const len2 = (r[0] - q[0]) ** 2 + (r[1] - q[1]) ** 2;
    return [
      q,
      ...pts
        .map((e) => ({
          e,
          t: ((e[0] - q[0]) * (r[0] - q[0]) + (e[1] - q[1]) * (r[1] - q[1])) / len2,
        }))
        .filter(
          ({ e, t }) =>
            t > 0 &&
            t < 1 &&
            gap([q, r], [e[0], e[1], 0]) < tol &&
            Math.hypot(e[0] - q[0], e[1] - q[1]) > 1e-3 &&
            Math.hypot(e[0] - r[0], e[1] - r[1]) > 1e-3,
        )
        .sort((x, y) => x.t - y.t)
        .map(({ e }): [number, number] => [e[0], e[1]]),
    ];
  });
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
  const pcb = tileTop(cfg);
  const half = (size: number[]) => size.map((x) => x / 2) as V3;
  const env = keycapEnvelope(cfg, n, { clampFloor: true });
  const cap = env.z0 + env.height;
  return [
    [[0, 0, pcb - tile.size_mm[2] / 2], half(tile.size_mm)],
    ...tile.components.map((c): [V3, V3] => [tilePartCentre(cfg, c), half(c.size_mm)]),
    [[0, 0, sw.body_mm[2] / 2 - sw.body_below_plate_mm], half(sw.body_mm)],
    [
      [0, 0, cap / 2],
      [env.base[0] / 2, env.base[1] / 2, cap / 2],
    ],
  ];
}

/** Whether points stay endGap clear of what every key but `except` holds and of its switch hole's column (holeColumn). */
function clearOfKeys(cfg: Config, frames: Record<string, Matrix4>, points: V3[], except?: string) {
  return Object.keys(frames)
    .filter((n) => isKey(n) && n !== except)
    .every((n) => {
      const e = frames[n].elements;
      const boxes = [...keyBoxes(cfg, n), holeColumn(cfg)];
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

/** How far below the plate top the openings check probes each switch hole's column (solid.ts CHECKS.probeHeight / 2). */
const OPENING_PROBE_DEPTH = 12;

/** A key's switch hole's column as far down as the openings check probes it, in its own coordinates ([centre, half-widths]). */
function holeColumn(cfg: Config): [V3, V3] {
  const hole = switchHole(cfg).map((x) => x / 2);
  return [
    [0, 0, -OPENING_PROBE_DEPTH / 2],
    [hole[0], hole[1], OPENING_PROBE_DEPTH / 2],
  ];
}

/**
 * The part of each key's switch hole's column (holeColumn), and of its tile
 * and the tile's parts (keyBoxes), grown by endGap, that comes below height z:
 * each box's corners there and where its edges cross z. The rail (z its
 * height) must stay out of these: a straight run of it can pass under a low
 * key's tile beside its column.
 */
function columnsBelow(cfg: Config, frames: Record<string, Matrix4>, z: number): V3[][] {
  const tile = 1 + cfg.tile.components.length;
  return Object.keys(frames)
    .filter(isKey)
    .flatMap((n) =>
      [holeColumn(cfg), ...keyBoxes(cfg, n).slice(0, tile)].map((box) => [n, box] as const),
    )
    .flatMap(([n, [c, h]]) => {
      const e = frames[n].elements;
      const at = (q: V3): V3 => {
        const [x, y, w] = q.map((v, i) => c[i] + v * (h[i] + SIZES.endGap));
        return [0, 1, 2].map((i) => e[12 + i] + x * e[i] + y * e[4 + i] + w * e[8 + i]) as V3;
      };
      // Corner i has its x, y, z at the high side where bit 2, 1, 0 is set.
      const corners = [...Array(8).keys()].map((i) =>
        at([i & 4 ? 1 : -1, i & 2 ? 1 : -1, i & 1 ? 1 : -1]),
      );
      const cuts = [...Array(8).keys()].flatMap((i) =>
        [1, 2, 4]
          .filter((b) => !(i & b))
          .flatMap((b) => {
            const [p, q] = [corners[i], corners[i | b]];
            if ((p[2] - z) * (q[2] - z) >= 0) return [];
            return [lerp(p, q, (z - p[2]) / (q[2] - p[2]))];
          }),
      );
      const below = [...corners.filter((p) => p[2] <= z), ...cuts];
      return below.length > 2 ? [below] : [];
    });
}

/**
 * PROTOTYPE ?walls=, ?ends= and bridges: what every key holds (keyBoxes) and its
 * switch hole's column (holeColumn), each box in its key's frame and grown by
 * endGap; with whether a point is clear of them all, and how far out along a
 * plan direction from a point everything is. For the keys `pressed` (PROTOTYPE
 * bridges), the keycap's room starts where its cap comes down to, pressed
 * (its bottom less the switch's travel), rather than at the plate.
 */
function keySpace(cfg: Config, frames: Record<string, Matrix4>, pressed: string[] = []) {
  const column = holeColumn(cfg);
  const boxes = Object.keys(frames)
    .filter(isKey)
    .flatMap((n) => {
      const e = frames[n].elements;
      const o: V3 = [e[12], e[13], e[14]];
      const axes = [0, 4, 8].map((i): V3 => [e[i], e[i + 1], e[i + 2]]);
      const held = keyBoxes(cfg, n);
      if (pressed.includes(n)) {
        const [c, h] = held.pop()!;
        const low = keycapEnvelope(cfg, n, { clampFloor: true }).floor;
        const top = c[2] + h[2];
        held.push([
          [c[0], c[1], (low + top) / 2],
          [h[0], h[1], (top - low) / 2],
        ]);
      }
      return [...held, column].map(([c, h]) => ({
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
 * rail is found straight out along it. A joined end (PROTOTYPE ?ends=flow) is
 * flush to the walls, its web's side handed over apart (carried).
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
  const all = side.map(([top, under], i): WallPoint => {
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
  // A joined end's web, from the plate's corner on, apart from the points.
  const [n0, n1] = [0, 1].map((e) =>
    isJoin(ends[e])
      ? endSide(d, e ? rib.keys.at(-1)! : rib.keys[0], e ? 1 : -1, s, ends[e]).length - 1
      : 0,
  );
  const points = all.slice(n0, all.length - n1);
  const carried: [WallPoint[], WallPoint[]] = [
    n0 ? all.slice(0, n0 + 1).reverse() : [],
    n1 ? all.slice(all.length - 1 - n1) : [],
  ];
  const keys = rib.keys.map((k) => ({
    name: k.name,
    from: on.indexOf(k.name) - n0,
    to: on.lastIndexOf(k.name) - n0,
  }));
  const space = keySpace(cfg, frames);
  const room = (from: V3, out: V3) => space.room(from, out, toRing(ring, from, out));
  const finish = (e: End) => (isDrop(e) ? 'drop' : isJoin(e) ? 'flush' : e);
  // Each web's outer face, as the rib's mesh has it (ribSolid's web spans,
  // laneSolid's lanes): every lane down it, from its top edge to its underside's.
  const across = s > 0 ? 1 : 0;
  const v = laneCounts(ribSpans(d, rib, ends))[1];
  const webs = rib.keys.slice(1).map((k, i) => {
    const span = poseSpan(edgePose(d, rib.keys[i], 1), edgePose(d, k, -1), 1);
    const face = [...Array(v + 1).keys()].map((j) =>
      laneAlong(span, laneAt(across, j / v)).map(([, p]) => p),
    );
    return { top: face[0], under: face[v], face };
  });
  return {
    name,
    points,
    keys,
    webs,
    ends: [finish(ends[0]), finish(ends[1])],
    carried,
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
 * PROTOTYPE ?ends=flow: a column's front (rib's first end) joined to a thumb
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
  if (!unfolded(left, right)) return undefined;
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
 * of it; or else straight on past the end's drop by tieRound and tieGap and turned as
 * little as clears (toward where the ends face first), then square into the
 * rail as before. Its bends are rounded. Then each of those ends drops onto
 * it, landing square on it: across along it, its outer face on the tie's far
 * side. Where the rail is closer to an end drop than tieRound and tieGap from its side
 * (more where the tie meets it off square on the side the drop's face is on),
 * the drops land moved along the tie away from it, bending to meet it, so that
 * none lands in the tie's fillets into the rail; where the rail is that close
 * at both ends, so that no one move clears both, the end drop farther from
 * its neighbour along the tie is left hanging, and the tie is planned again
 * without it. None if no hanging end could drop.
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
  const found = all.flatMap((rib, i) =>
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
  // Planned again without an end drop wherever the tie's ends meet the rail
  // too close to its drops for any one shift.
  let spots = found;
  for (;;) {
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
    // Meeting the rail off square (cos), how much nearer the drop the fillet
    // on the tie's sharper side starts than R short of where the tie's
    // middle meets the rail's inner edge: that side meets it a half wall's
    // tan sooner, and the fillet, in the sharper corner, touches it R
    // cot(half that corner) before. Where that is the side the drop's outer
    // face is on, its end would stand in the fillet otherwise.
    const skew = (cos: number) => {
      const off = Math.acos(Math.min(1, cos));
      return (d.wall / 2) * Math.tan(off) + R / Math.tan(Math.PI / 4 - off / 2) - R;
    };
    // The tie on from the drop x at one end, heading out, to the rail's middle,
    // its drop moved `moved` toward that end: the points after x's stand, and
    // how far too close to the rail it leaves the drop.
    const toRail = (x: (typeof spots)[number], out: V3, moved: number): [V3[], number] => {
      const toward = Math.sign(cross(out, facing)[2]) || 1;
      const past = x.half + moved + R + SIZES.tieGap;
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
        // (The drop's outer face is on the tie's side toward x.h: the
        // sharper one if the rail's normal leans that way.)
        const side: V3 = [v[1], -v[0], 0];
        const sharp = dot(side, n) * dot(side, x.h) > 0 ? skew(cos) : 0;
        return [path.slice(1), j || square ? 0 : Math.max(0, past - (S - d.wall / cos) + sharp)];
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
    // The drops moved toward the last end as far as the first end needs, or
    // if that leaves the last end short, toward the first as far as it needs,
    // the first end routed again for that.
    let [first, short0] = toRail(order[0], back, 0);
    const [last, short1] = toRail(order.at(-1)!, on, short0);
    if (short1 > 0 && !short0) [first, short0] = toRail(order[0], back, short1);
    if (short1 > 0 && short0 > 0) {
      // Neither will do: the end drop farther from its neighbour along the
      // tie is left out, so the tie is the shorter for it.
      const gap = (m: number, n: number) =>
        order.length > 1 ? Math.hypot(...sub(order.at(m)!.stand, order.at(n)!.stand)) : 0;
      const worst = gap(-1, -2) >= gap(0, 1) ? order.at(-1)! : order[0];
      spots = spots.filter((x) => x !== worst);
      continue;
    }
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
    const moved = short1 > 0 ? -short1 : short0;
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
}

/** Whether the stations of a stretch of rib (its sides, [top, underside] at each) run on without folding back: each wholly ahead of the one before (beyond the plane it lies in, heading on), and that one wholly behind it. */
function unfolded(left: Pair[], right: Pair[]) {
  const plane = (m: number): [V3, V3] => {
    const [l, r] = [left[m], right[m]];
    return [lerp(l[0], r[1], 0.5), unit(cross(sub(r[0], l[0]), sub(l[0], l[1])))];
  };
  return left.slice(1).every((_, m) => {
    const [[o0, n0], [o1, n1]] = [plane(m), plane(m + 1)];
    return (
      [left[m + 1], right[m + 1]].flat().every((q) => dot(sub(q, o0), n0) > 0) &&
      [left[m], right[m]].flat().every((q) => dot(sub(q, o1), n1) < 0)
    );
  });
}

/** How far point p is from the segment a to b. */
function fromSegment(p: V3, a: V3, b: V3) {
  const e = sub(b, a);
  const f = Math.max(0, Math.min(1, dot(sub(p, a), e) / (dot(e, e) || 1)));
  return Math.hypot(...sub(add(a, scale(e, f)), p));
}

/**
 * PROTOTYPE: the bridges between neighbouring ribs, each with the two keys it
 * joins. The rule: for each two keys of different runs, P and Q, take each
 * one's plate's side facing the other. Where those two sides face each other
 * (bridgeTurn) and run alongside each other far enough to hold a bridge
 * (bridgeWidth, and bridgeInset more at each end), one bridge goes at the
 * middle of the stretch they share (along their edges' mean direction), where
 * the gap between them there is bridgeLeast to bridgeGap and the plates are
 * no more than bridgeSlope out of line across it. It is a sweep from P's
 * plate edge to Q's (as a web between keys: leaving and arriving in each
 * plate's own plane, tangent to its top and its underside), bridgeWidth wide
 * and the plate's thickness, so its top runs on from each plate's top and its
 * sides stand square on the plates' edges. Where it meets a plate it is one
 * with it, not a seam: it runs on into the plate bridgeInto, wholly inside
 * the plate's slab there (bridgeSkin in from its top and its underside, far
 * more than the mesh's rounding), and it runs straight on bridgeOut out of
 * the plate before it bends, so no point of its mesh is on the plate's edge.
 * The union then only crosses faces cleanly, rather than meeting them along
 * an edge or a plane, where it would leave slivers. Left out where it would
 * fold, come within endGap of what the keys hold (P's and Q's keycaps only as
 * low as they are pressed: the bridge is under their plates' tops beside
 * them) or wireGap of a wire.
 */
function bridges(
  wasm: ManifoldToplevel,
  cfg: Config,
  d: Dims,
  frames: Record<string, Matrix4>,
  all: Rib[],
  wires: Wire[],
): { keys: [string, string]; solid: Manifold }[] {
  const keys = all.flatMap((rib) => rib.keys.map((k) => ({ k, run: rib.run })));
  const half = SIZES.bridgeWidth / 2;
  const square = Math.cos((SIZES.bridgeTurn * Math.PI) / 180);
  const plan = (v: V3) => [...unitPlan(v), 0] as V3;
  const segments = wires.flatMap((w) =>
    w.points.slice(1).map((q, i) => ({ a: w.points[i], b: q, r: w.diameter / 2 })),
  );
  return keys.flatMap(({ k: P, run }, i) =>
    keys.slice(i + 1).flatMap(({ k: Q, run: other }) => {
      if (run === other) return [];
      // Each plate's side facing the other key, out of it.
      const [sP, sQ] = [Math.sign(dot(P.c, sub(Q.o, P.o))), Math.sign(dot(Q.c, sub(P.o, Q.o)))];
      if (dot(plan(scale(P.c, sP)), plan(scale(Q.c, sQ))) > -square) return [];
      if (dot(P.n, Q.n) < square) return [];
      // The stretch both edges run along, along their mean direction e.
      const e = unit(add(P.a, scale(Q.a, Math.sign(dot(P.a, Q.a)) || 1)));
      const span = (k: RibKey, s: number) =>
        [-1, 1].map((u) => dot(corner(d, k, u, s, 0), e)).sort((x, y) => x - y);
      const [p, q] = [span(P, sP), span(Q, sQ)];
      const [lo, hi] = [
        Math.max(p[0], q[0]) + half + SIZES.bridgeInset,
        Math.min(p[1], q[1]) - half - SIZES.bridgeInset,
      ];
      if (lo > hi) return [];
      const m = (lo + hi) / 2;
      // The pose on key k's edge facing s, at m along e, heading out of it
      // (head 1) or into it (-1); across along k.a, the way that makes its
      // top face up out of the plate.
      const at = (k: RibKey, s: number, head: number): Pose => {
        const edge = keyPoint(k, d.plateHalf, 0, s, -SIZES.bridgeSkin);
        const t = scale(k.c, s * head);
        return {
          p: add(edge, scale(k.a, (m - dot(edge, e)) / dot(k.a, e))),
          t,
          c: dot(cross(t, k.a), k.n) > 0 ? k.a : scale(k.a, -1),
          half,
          thick: d.plate - 2 * SIZES.bridgeSkin,
        };
      };
      const [a, b] = [at(P, sP, 1), at(Q, sQ, -1)];
      const gap = Math.hypot(...sub(b.p, a.p));
      if (dot(a.c, b.c) <= 0 || gap > SIZES.bridgeGap) return [];
      if (dot(sub(b.p, a.p), a.t) < SIZES.bridgeLeast) return [];
      if (dot(sub(b.p, a.p), b.t) < SIZES.bridgeLeast) return [];
      // How far each plate's edge is out of the other's plane, against the
      // way across: the bridge's mean slope out of the plates.
      const off = (Math.abs(dot(sub(b.p, a.p), P.n)) + Math.abs(dot(sub(a.p, b.p), Q.n))) / 2;
      if (off > SIZES.bridgeSlope * Math.sqrt(Math.max(0, gap ** 2 - off ** 2))) return [];
      // Straight on bridgeOut from each plate's edge, then swept between, its
      // stations every bridgeProbe or so.
      const [a1, b1] = [ahead(a, SIZES.bridgeOut), ahead(b, -SIZES.bridgeOut)];
      const poses = [a, a1, ...sweep(a1, b1, Math.ceil(gap / SIZES.bridgeProbe)), b];
      const [left, right] = [-1, 1].map((s) => poses.map((x) => poseSide(x, s)));
      if (!unfolded(left, right)) return [];
      if (!keySpace(cfg, frames, [P.name, Q.name]).clear(samples(left, right))) return [];
      // Points through it, about bridgeProbe apart, each wire kept wireGap off.
      const across = Math.ceil(SIZES.bridgeWidth / SIZES.bridgeProbe);
      const down = Math.ceil(d.plate / SIZES.bridgeProbe);
      const inside = left.flatMap((l, j) =>
        [...Array(across + 1).keys()].flatMap((x) =>
          [...Array(down + 1).keys()].map((z) =>
            lerp(
              lerp(l[0], right[j][0], x / across),
              lerp(l[1], right[j][1], x / across),
              z / down,
            ),
          ),
        ),
      );
      const reach = Math.max(...inside.map((x) => Math.hypot(...sub(x, a.p))));
      const near = segments.filter((w) => fromSegment(a.p, w.a, w.b) < reach + w.r + SIZES.wireGap);
      if (near.some((w) => inside.some((x) => fromSegment(x, w.a, w.b) < w.r + SIZES.wireGap)))
        return [];
      const spans = [
        lineSpan(sidesOf(ahead(a, -SIZES.bridgeInto), 1), sidesOf(a1, 1)),
        bendSpan(a1, b1),
        lineSpan(sidesOf(b1, 1), sidesOf(ahead(b, SIZES.bridgeInto), 1)),
      ];
      return [
        { keys: [P.name, Q.name] as [string, string], solid: laneSolid(wasm, spans, 'bridge') },
      ];
    }),
  );
}

const planDir = (v: number[]) => [...unitPlan(v), 0] as V3;

/** PROTOTYPE: two drops fused (fused): the drops (rib, end), each one's facing side (its landing's pose side), how far each is widened on it, and up to what height before that runs out. */
interface Fusion {
  drops: [number, number][];
  sides: number[];
  w: number;
  top: number;
}

/**
 * PROTOTYPE: the drops of different ribs that fuse, so that they are built
 * overlapping rather than all but touching, a slit too narrow to print. At
 * each height (every fuseStep, from the higher foot up) each drop's facing
 * side is cut there (its outer and inner face's edges, down its drop and
 * round), and the gap across between them (along the first's across, at
 * the ends of the depth they share) taken where they share at least
 * fuseDepth of depth. Two drops fuse if that gap is at most fuseGap at
 * their feet; they stand that close up to the last height it still is.
 * Each is widened on its facing side by half the widest gap and fuseInto,
 * so the two overlap by twice fuseInto at least and the union joins them
 * along a crisp line, as any two ribs meet.
 */
function fusions(d: Dims, all: Rib[], ends: End[][]): Fusion[] {
  const drops = all.flatMap((_, i) =>
    [0, 1].flatMap((e): [number, number][] => (isDrop(ends[i][e]) ? [[i, e]] : [])),
  );
  const land = ([i, e]: number[]) => (ends[i][e] as { land: Pose }).land;
  // The pose side of landing l nearer o's middle.
  const facing = (l: Pose, o: Pose) =>
    [-1, 1].reduce((x, y) =>
      gap([o.p, o.p], poseSide(l, y)[0]) < gap([o.p, o.p], poseSide(l, x)[0]) ? y : x,
    );
  // Where a line, from its last point back, first crosses height z.
  const crossing = (line: V3[], z: number) => {
    for (let i = line.length - 1; i > 0; i--) {
      const [p, q] = [line[i], line[i - 1]];
      if ((p[2] - z) * (q[2] - z) <= 0 && p[2] !== q[2])
        return lerp(p, q, (z - p[2]) / (q[2] - p[2]));
    }
    return undefined;
  };
  return drops.flatMap((x, m) =>
    drops.slice(m + 1).flatMap((y): Fusion[] => {
      if (x[0] === y[0]) return [];
      const [a, b] = [land(x), land(y)];
      const sides = [facing(a, b), facing(b, a)];
      const lines = [x, y].map(([i, e], j) => {
        const [k, u] = endKey(all[i], e);
        const path = endSide(d, k, u, u * sides[j], { land: [a, b][j] });
        return [path.map((p) => p[0]), path.map((p) => p[1])];
      });
      const out = normalOf(a);
      const across = scale(planDir(a.c), sides[0]);
      const gapAt = (z: number) => {
        const cuts = lines.map((ls) => ls.map((l) => crossing(l, z)));
        if (cuts.flat().some((p) => !p)) return Infinity;
        // Each cut as [depth, across] at its two ends.
        const [A, B] = cuts.map((c) => c.map((p) => [dot(p!, out), dot(p!, across)]));
        const lo = Math.max(...[A, B].map((s) => Math.min(s[0][0], s[1][0])));
        const hi = Math.min(...[A, B].map((s) => Math.max(s[0][0], s[1][0])));
        if (hi - lo < SIZES.fuseDepth) return Infinity;
        const at = (s: number[][], t: number) =>
          Math.abs(s[1][0] - s[0][0]) < 1e-9
            ? (s[0][1] + s[1][1]) / 2
            : s[0][1] + ((t - s[0][0]) * (s[1][1] - s[0][1])) / (s[1][0] - s[0][0]);
        return Math.max(...[lo, hi].map((t) => at(B, t) - at(A, t)));
      };
      const foot = Math.max(...[x, y].map(([i, e]) => footHeight(d, ...endKey(all[i], e))));
      let [widest, top] = [-Infinity, foot];
      for (let z = foot + 0.01; z < 200; z += SIZES.fuseStep) {
        const g = gapAt(z);
        if (!(g <= SIZES.fuseGap)) break;
        widest = Math.max(widest, g);
        top = z;
      }
      if (widest === -Infinity) return [];
      return [{ drops: [x, y], sides, w: Math.max(0, widest) / 2 + SIZES.fuseInto, top }];
    }),
  );
}

/**
 * The frame: the ribs, the rail round the outline that the ends standing on
 * it drop to, and (PROTOTYPE) the bridges between neighbouring ribs, which
 * keep clear of `wires`. It stands on z = 0. PROTOTYPE ?walls=: the outline
 * also takes in `reach`, what the walls ask of it, and is cut back to the
 * faces they stand on it with (a design that asks is built twice: first to
 * ask, on the outline without).
 */
export function skeletyl(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
  wires: Wire[],
  reach: Reach = { feet: [] },
): {
  frame: Manifold;
  outline: [number, number][];
  /** The solids the frame is the union of, named, for the seam check (tests/seams.ts): each rib (by its run's name), bridge (by the keys it joins), the rail, the tie (its strip and fillets) and each wall. Made when called. */
  parts: () => { name: string; solid: Manifold }[];
  /** Each drop, for the seam test: its rib's name and end (0 front, 1 back), its landing (the outer face's bottom edge: p its middle, c along it, n out of it, half its half-length), where its round's lower side ends (low) and how high its foot, and the rail under it, is (foot, footHeight). */
  drops: {
    name: string;
    e: number;
    p: V3;
    c: V3;
    n: V3;
    half: number;
    low: number;
    foot: number;
    free: [number, number];
  }[];
  /** PROTOTYPE: each fused pair of drops, by their ribs' names and end (fused). */
  fused: { names: string[]; e: number[]; w: number; top: number }[];
} {
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
  const { ring: rough, firm } = outlined(
    wasm,
    d,
    all.flatMap((rib) => free(rib).flatMap((e) => feet(d, rib, e))),
    all.filter(outer).map(outerSide),
    columnsBelow(cfg, frames, SIZES.railHeight),
    reach.feet,
  );
  const kind = (rib: Rib, e: number): End => {
    if (rib.parted[e]) return endClear(cfg, d, frames, rib, e, 'hang') ? 'hang' : 'flush';
    // Straight down, or bent out along the end (in its own plane) until the
    // nearer corner of its outer face meets the outline; the outline then
    // turns in to the rest of it (trimmed).
    const top = dropTop(d, ...endKey(rib, e));
    const down = straightDown(top);
    const out = Math.max(
      0,
      Math.min(...[-1, 1].map((s) => toRing(rough, poseSide(down, s)[0], top.n!))),
    );
    if (!(out <= SIZES.reach)) return 'hang';
    const drop = { land: landing(top, add(top.p, scale(top.n!, out)), top.c) };
    return endClear(cfg, d, frames, rib, e, drop) ? drop : 'hang';
  };
  const ends = all.map((rib) => [0, 1].map((e) => kind(rib, e)));
  // PROTOTYPE: the drops standing all but touching, widened to overlap.
  const fuses = fusions(d, all, ends);
  for (const f of fuses)
    f.drops.forEach(([i, e], j) => {
      const end = ends[i][e] as { land: Pose; widen?: Widen[] };
      const at = (z: number) => f.w * Math.max(0, Math.min(1, 1 - (z - f.top) / SIZES.fuseRamp));
      ends[i][e] = { ...end, widen: [...(end.widen ?? []), { side: f.sides[j], at }] };
    });
  // Each drop's outer face at its foot (as widened), out square to it, and
  // (PROTOTYPE) across each fused junction, the foot of its widening and as
  // far back again.
  const drops = all.flatMap((_, i) => [0, 1].map((e) => ends[i][e]).filter(isDrop));
  const faces = drops.map((l) => [
    ...[-1, 1].map((s) => add(poseSide(l.land, s)[0], scale(l.land.c, s * widthAt(l, s, 0)))),
    normalOf(l.land),
  ]);
  const plan = (ps: V3[]) => ps.map((p) => [p[0], p[1]] as [number, number]);
  // A foot back from its outer face (as widened, from a to b).
  const footOf = (l: { land: Pose }, a: V3, b: V3) => {
    const n = scale(normalOf(l.land), l.land.thick);
    return plan([a, b, sub(b, n), sub(a, n)]);
  };
  const joins = drops.flatMap((l) =>
    (l.widen ?? []).map(({ side }) => {
      const [o, w] = [poseSide(l.land, side)[0], widthAt(l, side, 0)];
      const [a, b] = [-w, w].map((x) => add(o, scale(l.land.c, side * x)));
      return footOf(l, a, b);
    }),
  );
  // The outline cut back to the drops on it, turning in to them, round their
  // feet and what else it takes in, and taking in the fused junctions' feet,
  // so that it runs on round the one in front there.
  const ring = trimmed(
    wasm,
    rough,
    wasm.CrossSection.union([
      firm,
      ...drops.map(
        (l, i) => new wasm.CrossSection([footOf(l, faces[i][0], faces[i][1])], 'NonZero'),
      ),
    ]),
    faces,
    joins,
  );
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
  if (support === 'flow') {
    // Then each column front still hanging joined to a thumb plate.
    const thumbs = all.filter((rib) => rib.run >= columns).flatMap((rib) => rib.keys);
    all.forEach((rib, i) => {
      const front = rib.run < columns && all.findIndex((r) => r.run === rib.run) === i;
      if (front && ends[i][0] === 'hang')
        ends[i][0] = joinTo(cfg, d, frames, rib, thumbs) ?? 'hang';
    });
  }
  const tie =
    support === 'tie' || support === 'flow'
      ? floorTie(wasm, cfg, d, frames, all, ends, ring)
      : undefined;
  const area = new wasm.CrossSection([ring], 'NonZero');
  const inside = area.offset(-d.wall, 'Round');
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
  // PROTOTYPE ?walls= (skeletyl-walls.prototype.ts): the outer sides, and
  // the frame again taking in what the walls ask of the outline, if they do.
  const wallsKey = (cfg.chassis as { walls?: string }).walls ?? 'none';
  const wallSides = () =>
    all.flatMap((rib, i) =>
      outer(rib)
        ? [wallSide(cfg, d, frames, rib, ends[i], outward(rib), named[i], ring, innerRing())]
        : [],
    );
  // Where a drop stands lower than railHeight, the rail dips to meet it.
  const dips = all.flatMap((rib, i) =>
    [0, 1].flatMap((e) => {
      const end = ends[i][e];
      if (!isDrop(end)) return [];
      const h = footHeight(d, ...endKey(rib, e));
      return h < SIZES.railHeight ? [railDip(end.land, h)] : [];
    }),
  );
  const ribKit: RibKit = {
    solid: (spans) => laneSolid(wasm, spans, 'wall'),
    poseSpan,
    lineSpan,
    sidesOf,
    along: alongOf,
    mesh: (lanes, ends) => laneMesh(wasm, lanes, ends, 'wall'),
    radius: d.radius,
    railTop: (x, y) => Math.min(SIZES.railHeight, ...dips.map((dip) => dip.top(x, y))),
    standing: faces,
    tie: tie
      ? tie
          .offset(SIZES.tieRound + d.wall, 'Round', 2, SIZES.cornerSegments)
          .toPolygons()
          .map((p) => p.map((q) => [q[0], q[1]] as [number, number]))
      : [],
  };
  if (!reach.feet.length) {
    const more = skeletylReach(wasm, cfg, wallsKey, wallSides, ribKit);
    if (more.feet.length) return skeletyl(wasm, cfg, frames, wires, more);
  }
  const solids = all.map((rib, i) => ribSolid(wasm, d, rib, ends[i]));
  // Each drop keyed into the rail (or the tie) under it (footKey), by rib.
  const keyed = all.map((rib, i) =>
    ends[i].flatMap((end, e) => (isDrop(end) ? footKey(wasm, d, ...endKey(rib, e), end.land) : [])),
  );
  // PROTOTYPE: the bridges between neighbouring ribs' keys.
  const bridged = bridges(wasm, cfg, d, frames, all, wires);
  const loop = area.subtract(inside);
  // PROTOTYPE ?ends=tie: the tie is part of the rail, filleted into it where
  // they meet (and round its bends).
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
  // The rail (or a part of it, `plan`) stood up railHeight and bent down to
  // them: its outline given points every dipMesh round each (but where it is
  // level round the foot), so that its top has the room to follow the dip,
  // and its top's points lowered to it, the points down its sides in
  // proportion (its bottom stays). Bent rather than cut, its top stays one
  // surface, with no seam to slip in a sliver. The level ground under each
  // foot (Dip.patch) is stood up on its own and the two unioned, so that its
  // top is drawn from its own points alone, all level: drawn with the rest,
  // a triangle could run from a corner of the foot over it to a point out on
  // the dip, tilting the top under the foot, which the union leaves specks
  // along.
  const dipped = (plan: CrossSection) => {
    const H = SIZES.railHeight;
    if (!dips.length) return plan.extrude(H);
    const patches = wasm.CrossSection.union(
      dips.map((dip) => new wasm.CrossSection([dip.patch], 'NonZero')),
    );
    return wasm.Manifold.union(
      [plan.subtract(patches), plan.intersect(patches)].filter((p) => !p.isEmpty()).map(bent),
    );
  };
  const bent = (plan: CrossSection) => {
    const H = SIZES.railHeight;
    const top = (x: number, y: number) => Math.min(...dips.map((dip) => dip.top(x, y)));
    const near = (x: number, y: number) => dips.some((dip) => dip.near(x, y));
    const corners = faces.flatMap(([a, b]) => [a, b]);
    // (Simplified first: the outline's offsets leave points a few nm apart,
    // which extrude alone merges but a warped mesh keeps, as slivers.)
    // Simplifying also drops a point a hundredth or so off the line of its
    // neighbours, as the outline has where it runs straight past a drop's
    // corner (trimmed): such points are put back, so the rail's edge turns
    // under the foot's corner rather than a hair past it.
    const fine = plan
      .simplify()
      .toPolygons()
      .map((poly) => through(poly as [number, number][], corners, SIZES.cornerSnap))
      .map((poly) =>
        poly.flatMap((a, i) => {
          const b = poly[(i + 1) % poly.length];
          const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / SIZES.dipMesh));
          return [...Array(n).keys()].flatMap((j): [number, number][] => {
            const q: [number, number] = [
              a[0] + ((b[0] - a[0]) * j) / n,
              a[1] + ((b[1] - a[1]) * j) / n,
            ];
            return !j || near(...q) ? [q] : [];
          });
        }),
      );
    return new wasm.CrossSection(fine, 'NonZero').extrude(H).warp((v) => {
      const t = top(v[0], v[1]);
      v[2] = v[2] >= H ? t : (v[2] * t) / H;
    });
  };
  const rail = dipped(railPlan);
  // PROTOTYPE ?walls= (skeletyl-walls.prototype.ts): walls under the outer sides.
  const walls = skeletylWalls(wasm, cfg, wallsKey, wallSides, ribKit);
  return {
    frame: wasm.Manifold.union([
      ...solids,
      ...keyed.flat(),
      ...bridged.map((b) => b.solid),
      rail,
      ...walls,
    ]),
    outline: ring,
    parts: () => [
      ...solids.map((solid, i) => ({ name: named[i], solid })),
      ...keyed.flatMap((keys, i) => keys.map((solid) => ({ name: named[i], solid }))),
      ...bridged.map((b) => ({ name: `bridge ${b.keys.join('–')}`, solid: b.solid })),
      { name: 'rail', solid: dipped(loop) },
      ...(tie ? [{ name: 'tie', solid: dipped(railPlan.subtract(loop)) }] : []),
      ...walls.map((solid, i) => ({ name: `wall ${i + 1}`, solid })),
    ],
    fused: fuses.map((f) => ({
      names: f.drops.map(([i]) => named[i]),
      e: f.drops.map(([, e]) => e),
      w: f.w,
      top: f.top,
    })),
    drops: all.flatMap((rib, i) =>
      [0, 1].flatMap((e) => {
        const end = ends[i][e];
        if (!isDrop(end)) return [];
        const [k, u] = endKey(rib, e);
        const l = end.land;
        return [
          {
            name: named[i],
            e,
            p: l.p,
            c: l.c,
            n: normalOf(l),
            half: l.half,
            low: roundLow(d, k, u),
            foot: footHeight(d, k, u),
            free: [-l.half + widthAt(end, -1, 0), l.half - widthAt(end, 1, 0)] as [number, number],
          },
        ];
      }),
    ),
  };
}
