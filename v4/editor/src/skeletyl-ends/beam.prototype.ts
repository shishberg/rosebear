// PROTOTYPE. Question: How should the Skeletyl support its hanging rib ends?
// Variants switchable via ?ends= on the editor.
//
// ?ends=beam (cross beam): one beam across the hand under the finger columns'
// fronts, like a lintel, from the inner column to the pinky's, and at each
// end carried on outward, curving down to land upright on the rail. It runs
// under the bottom of each front's round (its top INTO up into it, or into
// the drop where a front drops). Each other hanging end (the thumb rows', and
// any front the beam can't reach) gets a short strut: straight down off its
// round, then curving into the beam where that's nearest and clear, else onto
// the rail.
//
// The beam is a wall thick and DEPTH deep, swept along its centreline. Under
// each front it runs straight along the front, sloping a little (POKE at
// most) as its neighbours' heights do, between two anchors INSET in from the
// front's sides (further in where a key is in the way). Between neighbouring
// fronts a link joins one's anchor to the next's, a Hermite cubic tangent to
// both runs, so staggered columns are joined by an S in the gap between them.
// Where a link would hit a key it sags (lower in its middle, level at its
// ends) until it clears; if it can't, the beam parts there. Each part ends in
// a leg down to the rail where its end front hangs and the leg is clear (else
// a strut, if one is), and is kept only if it stands on something (a leg, or
// a front that drops). A strut is a wall thick along its end's `out` and
// STRUT wide across it, turning to stand across the rail where it lands.
import type { Manifold } from 'manifold-3d';
import { add, cross, dot, scale, sub, unit, type V3 } from '../geometry';
import { INTO, type EndsFrame, type EndsKit, type RibEnd } from '../skeletyl-ends.prototype';

/** The beam's depth and a strut's width (mm); the least height (mm) anything stays above the floor except on the rail. */
const [DEPTH, STRUT, FLOOR] = [4, 5, 2];
/** Sections per span (under a front, or between two), per leg, per strut. */
const [SPAN, LEG, STRUT_STEPS] = [12, 12, 10];
/** The beam meets each front at least INSET (mm) in from its sides, further in steps of INSET_STEP where a key is in the way, along at least SHORTEST of it. */
const [INSET, INSET_STEP, SHORTEST] = [3, 2, 4];
/** The most (mm) the beam rises into, or drops below, a front's bottom at its anchors, sloping as its neighbours' heights do. */
const POKE = 1.5;
/** A span sags in steps of this much (mm) to clear the keys. */
const SAG = 1.5;
const Z: V3 = [0, 0, 1];

/** A point along a bar's centreline: where, the horizontal direction its width runs along, and its width and depth there. */
type Station = { c: V3; ref: V3; w: number; d: number };

export function beam(kit: EndsKit, frame: EndsFrame): Manifold[] {
  const { fronts, wall, rail, toPinky } = frame;
  const top = rail.height - INTO;
  const n = fronts.length;
  // Where the beam's centre would be under each front's middle, its top INTO
  // up into the bottom, and the front's half-width.
  const C = fronts.map((e) => add(e.centre, [0, 0, INTO - DEPTH / 2]));
  const halves = fronts.map((e) => dist(e.bottom.outer[0], e.bottom.outer[1]) / 2);
  // How the beam runs under each front: along it toward the pinky, sloping
  // (rise per mm) as its neighbours' heights do, but no more than takes it
  // POKE above or below the bottom at the anchors.
  const dirs = fronts.map((e, i) => {
    const [p, q] = [C[Math.max(0, i - 1)], C[Math.min(n - 1, i + 1)]];
    const most = POKE / (halves[i] - INSET);
    const slope = Math.max(-most, Math.min(most, (q[2] - p[2]) / plan2(sub(q, p))));
    return add(scale(e.across, dot(e.across, toPinky) < 0 ? -1 : 1), [0, 0, slope]);
  });
  const clear = (st: Station[]) => frame.clear(faces(bar(st)));
  // The beam from a heading da to b heading db (plan), sagging by s in the middle.
  const curve = (a: V3, da: V3, b: V3, db: V3, s: number): Station[] => {
    const [m0, m1] = [scale(da, dist(a, b)), scale(db, dist(a, b))];
    return [...Array(SPAN + 1).keys()].map((j) => {
      const t = j / SPAN;
      const c = add(hermite(a, m0, b, m1, t), [0, 0, -s * 16 * (t * (1 - t)) ** 2]);
      const ref = cross(Z, plan(hermiteTangent(a, m0, b, m1, t)));
      return { c, ref, w: wall, d: DEPTH };
    });
  };
  // Under each front, straight along it between its two anchors, on its inner
  // side and its pinky side: under its bottom, as little in from each side as
  // keeps it clear (INSET at least), through C. None if no stretch of it at
  // least SHORTEST long is clear.
  const under = fronts.map((_, i) => {
    const [c, half] = [C[i], halves[i]];
    const insets = [];
    for (let x = INSET; x <= 2 * half - SHORTEST - INSET; x += INSET_STEP)
      for (let y = INSET; x + y <= 2 * half - SHORTEST; y += INSET_STEP) insets.push([x, y]);
    insets.sort((p, q) => p[0] + p[1] - q[0] - q[1]);
    for (const [x, y] of insets) {
      const [a, b] = [add(c, scale(dirs[i], x - half)), add(c, scale(dirs[i], half - y))];
      const st = curve(a, dirs[i], b, dirs[i], 0);
      if (clear(st)) return st;
    }
  });
  const anchors = under.map((st) => (st ? [st[0].c, st.at(-1)!.c] : []));
  // Between neighbouring fronts, sagged as little as clears the keys (and
  // keeps off the floor), or none.
  const links = fronts.slice(1).map((_, i) => {
    if (!under[i] || !under[i + 1]) return undefined;
    for (let s = 0; ; s += SAG) {
      const st = curve(anchors[i][1], dirs[i], anchors[i + 1][0], dirs[i + 1], s);
      if (Math.min(...st.map((x) => x.c[2])) - DEPTH / 2 < FLOOR) return undefined;
      if (clear(st)) return st;
    }
  });
  // A leg from anchor A on outward along `way` (as the beam runs there),
  // curving down onto the rail.
  const leg = (A: V3, way: V3): Station[] | undefined => {
    const out = plan(way);
    const R = frame.railAlong(A, out);
    const L: V3 = [R.centre[0], R.centre[1], top];
    const run = dot(sub(L, A), out);
    if (run < 0) return undefined;
    const [m0, m1] = [scale(way, run * 1.2), scale(Z, -(A[2] - L[2]) * 1.2)];
    const st = [...Array(LEG + 1).keys()].map((j): Station => {
      const t = j / LEG;
      // The depth narrows to fit across the rail as the leg comes down onto it.
      const d = DEPTH + (wall - 2 * INTO - DEPTH) * t ** 3;
      return { c: hermite(A, m0, L, m1, t), ref: cross(Z, out), w: wall, d };
    });
    return clear(st) ? st : undefined;
  };
  // The parts: runs of fronts the beam can pass under, joined by clear links,
  // with a leg down to the rail at each end whose front hangs, where the leg
  // is clear (else a strut to the rail, below). A part is kept if it carries a
  // front that hangs and stands on something: a leg, or a front that drops.
  const parts: { from: number; to: number; stations: Station[] }[] = [];
  const legless: RibEnd[] = [];
  for (let i = 0; i < n; i++) {
    if (!under[i]) continue;
    let j = i;
    while (j < n - 1 && links[j] && under[j + 1]) j++;
    let stations = [...Array(j - i + 1).keys()].flatMap((k) => [
      ...(k ? links[i + k - 1]!.slice(1) : []),
      ...(k ? under[i + k]!.slice(1) : under[i]!),
    ]);
    let grounded = fronts.slice(i, j + 1).some((f) => f.finish === 'drop');
    const unlegged = [];
    if (fronts[i].finish === 'hang') {
      const l = leg(anchors[i][0], scale(dirs[i], -1));
      if (l) [stations, grounded] = [[...l.reverse(), ...stations.slice(1)], true];
      else if (j > i) unlegged.push(fronts[i]);
    }
    if (fronts[j].finish === 'hang') {
      const l = leg(anchors[j][1], dirs[j]);
      if (l) [stations, grounded] = [[...stations, ...l.slice(1)], true];
      else if (j > i) unlegged.push(fronts[j]);
    }
    const carries = fronts.slice(i, j + 1).some((f) => f.finish === 'hang');
    if (carries && grounded) {
      parts.push({ from: i, to: j, stations });
      legless.push(...unlegged);
    }
    i = j;
  }
  const solids = parts.map((p) => kit.sweep(bar(p.stations)));
  // The rest of the hanging ends get struts, aimed at the beam's centreline or
  // the rail; a part's end that got no leg, at the rail.
  const onBeam = parts.flatMap((p) => p.stations.map((s) => s.c));
  const carried = new Set(parts.flatMap((p) => fronts.slice(p.from, p.to + 1)));
  const struts = [
    ...frame.hanging.filter((e) => !carried.has(e)).map((e) => strut(frame, e, onBeam, top)),
    ...legless.map((e) => strut(frame, e, [], top)),
  ];
  return [...solids, ...struts.flatMap((s) => (s ? [kit.sweep(bar(s))] : []))];
}

/**
 * The strut under hanging end e: straight down off the bottom of its round,
 * then curving to the shortest clear of: into the beam's centreline where
 * it's nearest, onto the rail nearest, onto the rail straight out along the
 * end. None if none is clear.
 */
function strut(frame: EndsFrame, e: RibEnd, onBeam: V3[], top: number): Station[] | undefined {
  const S = add(e.centre, [0, 0, INTO]);
  /** From S, leaving straight down, to L arriving along `arrive`; its wall thickness along `from` turning to `to`; its width across narrowing to `last` at L. */
  const path = (L: V3, arrive: V3, from: V3, to: V3, last: number) => {
    const k = dist(S, L);
    const [m0, m1] = [scale(Z, -k), scale(unit(arrive), k)];
    return [...Array(STRUT_STEPS + 1).keys()].map((j): Station => {
      const t = j / STRUT_STEPS;
      return {
        c: hermite(S, m0, L, m1, t),
        ref: unit(add(scale(from, 1 - t), scale(to, t))),
        w: frame.wall - 0.1,
        d: STRUT + (last - STRUT) * t ** 3,
      };
    });
  };
  const toRail = (R: { centre: V3; out: V3 }) =>
    path([R.centre[0], R.centre[1], top], scale(Z, -1), e.out, R.out, frame.wall - 2 * INTO);
  const near = onBeam.reduce<V3 | undefined>(
    (best, q) => (!best || dist(q, S) < dist(best, S) ? q : best),
    undefined,
  );
  const tries = [
    ...(near && near[2] < S[2] ? [path(near, sub(near, S), e.out, e.out, STRUT)] : []),
    toRail(frame.railNear(S)),
    toRail(frame.railAlong(S, e.out)),
  ].sort((a, b) => length(a) - length(b));
  return tries.find((st) => frame.clear(faces(bar(st))));
}

/** A bar's sections: at each station a rectangle square to the centreline, `w` along ref (made square to it) and `d` across. */
function bar(stations: Station[]): V3[][] {
  return stations.map((s, i) => {
    const p = stations[Math.max(0, i - 1)].c;
    const q = stations[Math.min(stations.length - 1, i + 1)].c;
    const T = unit(sub(q, p));
    const N = unit(sub(s.ref, scale(T, dot(s.ref, T))));
    const U = cross(T, N);
    return CORNERS.map(([a, b]) => add(s.c, add(scale(N, (a * s.w) / 2), scale(U, (b * s.d) / 2))));
  });
}
const CORNERS = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/** Points over a sweep's side faces, for the clear test. */
function faces(sections: V3[][]): V3[] {
  const grid = [0, 0.25, 0.5, 0.75];
  return sections.slice(1).flatMap((t, i) =>
    sections[i].flatMap((p, j) => {
      const s = sections[i];
      const [q, p2, q2] = [s[(j + 1) % 4], t[j], t[(j + 1) % 4]];
      return grid.flatMap((f) => grid.map((g) => lerp(lerp(p, q, f), lerp(p2, q2, f), g)));
    }),
  );
}

/** A cubic Hermite curve from p0 to p1 with tangents m0 and m1, and its derivative. */
function hermite(p0: V3, m0: V3, p1: V3, m1: V3, t: number): V3 {
  const [t2, t3] = [t * t, t * t * t];
  const w = [2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t, -2 * t3 + 3 * t2, t3 - t2];
  return [p0, m0, p1, m1].reduce((sum, v, i) => add(sum, scale(v, w[i])), [0, 0, 0] as V3);
}
function hermiteTangent(p0: V3, m0: V3, p1: V3, m1: V3, t: number): V3 {
  const w = [6 * t * t - 6 * t, 3 * t * t - 4 * t + 1, -6 * t * t + 6 * t, 3 * t * t - 2 * t];
  return [p0, m0, p1, m1].reduce((sum, v, i) => add(sum, scale(v, w[i])), [0, 0, 0] as V3);
}
const plan = (v: V3): V3 => unit([v[0], v[1], 0]);
const plan2 = (v: V3) => Math.hypot(v[0], v[1]);
const lerp = (p: V3, q: V3, f: number) => add(p, scale(sub(q, p), f));
const dist = (p: V3, q: V3) => Math.hypot(...sub(p, q));
const length = (st: Station[]) => st.slice(1).reduce((sum, s, i) => sum + dist(s.c, st[i].c), 0);
