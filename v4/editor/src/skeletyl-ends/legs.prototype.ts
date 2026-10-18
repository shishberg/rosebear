// PROTOTYPE. Question: How should the Skeletyl support its hanging rib ends?
// Variants switchable via ?ends= on the editor.
//
// ?ends=legs (standing legs): each hanging end stands on its own leg, and
// nothing else: no beams, no cross members. A leg leaves the bottom of the
// end's round straight down (its top INTO up into it) and lands upright on
// the rail (its foot INTO down into the rail's top). Where the rail is right
// under the end it is a straight post; otherwise it is a gentle S in the
// vertical plane through its top and foot, like a cabriole leg: vertical at
// both ends, leaning out in its middle.
//
// A leg is a flat bar: a wall thick along the end's `out` at its top (the
// end's own wall, so it carries straight on down from it) and 7 mm wide
// across it, twisting as it comes down to stand across the rail at its foot
// (a little thinner than the rail, so it stays on it) and widening to 11 mm
// along it, so it stands on a long pad (WIDTHS; narrower ones where a full
// one won't fit). A foot is kept inside the rail's band in plan.
//
// Each end's candidates are its cheapest clear legs (by plan reach, foot
// from top) over rail spots every SPOT mm round the outline, the top's place
// across the end (OFFSETS) and a few S shapes (some stay upright longer at the
// top, some at the foot). Then each end takes one, kept APART from the others
// (no shared feet, no crossings): every order of the ends is tried, each end
// taking its cheapest leg apart from those already taken, and the order that
// stands the most ends, then the cheapest, wins. Ends far from the rail get
// long, low, leaning legs: the rail is where it is, and nothing else may
// stand on the floor.
import type { Manifold } from 'manifold-3d';
import { add, cross, dot, scale, sub, unit, type V3 } from '../geometry';
import {
  INTO,
  type EndsFrame,
  type EndsKit,
  type RailSpot,
  type RibEnd,
} from '../skeletyl-ends.prototype';

/** Leg widths (mm) to try, widest first: at the top (across the end) and at the foot (along the rail). */
const WIDTHS: [number, number][] = [
  [7, 11],
  [5, 8],
  [4, 5],
];
/** Rail spots this far apart (mm) round the outline; feet no further than FAR (mm) in plan from their tops. */
const [SPOT, FAR] = [2, 90];
/** Where across the end (mm off its middle) a leg's top may stand. */
const OFFSETS = [0, -3, 3, -6, 6];
/** S shapes: how long (as a share of the leg's drop) its tangent is at the top and at the foot. Longer stays upright longer there. */
const SHAPES: [number, number][] = [
  [1, 1],
  [1.6, 0.6],
  [0.6, 1.6],
];
/** How far apart (mm) legs keep, roughly (each its own: no two share a foot or cross). */
const APART = 1.5;
/** How many clear legs to find under each end, of each width; legs whose tops and feet are both within ALIKE (mm) count as one; a narrower width costs as NARROWER (mm) more reach. */
const [KEEP, ALIKE, NARROWER] = [10, 4, 10];
/** Sections per leg. */
const STEPS = 16;
const Z: V3 = [0, 0, 1];

/** A point along a bar's centreline: where, the horizontal direction its thickness `w` runs along, and its width `d` across that. */
type Station = { c: V3; ref: V3; w: number; d: number };

export function legs(kit: EndsKit, frame: EndsFrame): Manifold[] {
  const spots = railSpots(frame);
  const options = frame.hanging.map((e) => candidates(frame, e, spots));
  frame.hanging.forEach((e, i) => {
    if (!options[i].length)
      console.warn(`legs: no clear leg under ${e.rib}'s ${e.at} end (${e.key})`);
  });
  return choose(options).map((st) => kit.sweep(bar(st)));
}

/** A clear leg under one end, and what it costs: its plan reach, more if narrower. */
type Leg = { st: Station[]; cost: number };

/**
 * One leg per end, apart from each other: each end in turn takes its
 * cheapest leg apart from those already taken, trying every order of the ends
 * and keeping the one that stands the most ends, then the cheapest.
 */
function choose(options: Leg[][]): Station[][] {
  let best = { n: -1, cost: Infinity, legs: [] as Station[][] };
  for (const order of permutations(options.map((_, i) => i))) {
    const taken: Leg[] = [];
    for (const i of order) {
      const l = options[i].find((o) => taken.every((t) => apart(o.st, t.st)));
      if (l) taken.push(l);
    }
    const cost = taken.reduce((sum, l) => sum + l.cost, 0);
    if (taken.length > best.n || (taken.length === best.n && cost < best.cost))
      best = { n: taken.length, cost, legs: taken.map((l) => l.st) };
  }
  return best.legs;
}
function permutations(xs: number[]): number[][] {
  return xs.length <= 1
    ? [xs]
    : xs.flatMap((x, i) =>
        permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]),
      );
}

/** Whether leg a keeps APART (mm) clear of leg b, centreline to centreline less their half-widths. */
function apart(a: Station[], b: Station[]): boolean {
  const size = (s: Station) => Math.max(s.w, s.d) / 2;
  return a.every((p) => b.every((q) => dist(p.c, q.c) > size(p) + size(q) + APART));
}

/** The cheapest clear legs under hanging end e (up to KEEP of each width, cheapest first; not two nearly alike). */
function candidates(frame: EndsFrame, e: RibEnd, spots: RailSpot[]): Leg[] {
  const foot = frame.rail.height - INTO;
  const half = dist(e.bottom.outer[0], e.bottom.outer[1]) / 2;
  return WIDTHS.flatMap(([top, wide], wi) => {
    const tries: { cost: number; S: V3; L: V3; make: () => Station[] }[] = [];
    for (const o of OFFSETS) {
      if (Math.abs(o) + top / 2 > half) continue;
      const S = add(add(e.centre, scale(e.across, o)), [0, 0, INTO]);
      for (const R of spots) {
        const L: V3 = [R.centre[0], R.centre[1], foot];
        const d = plan2(sub(L, S));
        if (d > FAR) continue;
        SHAPES.forEach((shape, si) => {
          // Shortest first; narrower costs more; then nearer the middle, then the plainer S.
          const cost = d + wi * NARROWER + Math.abs(o) * 0.05 + si * 0.01;
          tries.push({ cost, S, L, make: () => stations(frame, e, S, R, L, shape, top, wide) });
        });
      }
    }
    tries.sort((a, b) => a.cost - b.cost);
    const kept: (Leg & { S: V3; L: V3 })[] = [];
    for (const t of tries) {
      if (kept.length >= KEEP) break;
      if (kept.some((k) => dist(k.L, t.L) < ALIKE && dist(k.S, t.S) < ALIKE)) continue;
      const st = t.make();
      // The centreline first: most tries fail there, cheaply.
      if (!onRail(frame, st) || !frame.clear(st.map((x) => x.c))) continue;
      if (frame.clear(faces(bar(st)))) kept.push({ ...t, st });
    }
    return kept;
  }).sort((a, b) => a.cost - b.cost);
}

/** The leg from S (leaving straight down) to L on rail spot R (arriving straight down). */
function stations(
  frame: EndsFrame,
  e: RibEnd,
  S: V3,
  R: RailSpot,
  L: V3,
  [k0, k1]: [number, number],
  top: number,
  wide: number,
): Station[] {
  const h = S[2] - L[2];
  const [m0, m1] = [scale(Z, -h * k0), scale(Z, -h * k1)];
  // The thickness turns from along the end's out to across the rail (either
  // way round: a rectangle doesn't mind), whichever is the smaller turn.
  const to = dot(e.out, R.out) < 0 ? scale(R.out, -1) : R.out;
  const thin = frame.wall - 2 * INTO - 0.1;
  return [...Array(STEPS + 1).keys()].map((j): Station => {
    const t = j / STEPS;
    const s = t * t * (3 - 2 * t);
    return {
      c: hermite(S, m0, L, m1, t),
      ref: unit(add(scale(e.out, 1 - s), scale(to, s))),
      w: frame.wall + (thin - frame.wall) * s,
      d: top + (wide - top) * s,
    };
  });
}

/** Whether a leg's foot (its sections less than a mm above the rail's top) is on the rail's band in plan. */
function onRail(frame: EndsFrame, st: Station[]): boolean {
  const low = frame.rail.height + 1;
  return bar(st)
    .filter((_, i) => st[i].c[2] < low)
    .every((sec) =>
      sec.every((p) => {
        const R = frame.railNear(p);
        const o = dot(sub([p[0], p[1], 0], R.outer), R.out);
        return o <= 0.01 && o >= -frame.wall - 0.01;
      }),
    );
}

/** Rail spots round the outline, about SPOT apart. */
function railSpots(frame: EndsFrame): RailSpot[] {
  const ring = frame.rail.outer;
  const out: RailSpot[] = [];
  let at = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (; at < l; at += SPOT) {
      const f = at / l;
      out.push(frame.railNear([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 0]));
    }
    at -= l;
  });
  return out;
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

/** A cubic Hermite curve from p0 to p1 with tangents m0 and m1. */
function hermite(p0: V3, m0: V3, p1: V3, m1: V3, t: number): V3 {
  const [t2, t3] = [t * t, t * t * t];
  const w = [2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t, -2 * t3 + 3 * t2, t3 - t2];
  return [p0, m0, p1, m1].reduce((sum, v, i) => add(sum, scale(v, w[i])), [0, 0, 0] as V3);
}
const plan2 = (v: V3) => Math.hypot(v[0], v[1]);
const lerp = (p: V3, q: V3, f: number) => add(p, scale(sub(q, p), f));
const dist = (p: V3, q: V3) => Math.hypot(...sub(p, q));
