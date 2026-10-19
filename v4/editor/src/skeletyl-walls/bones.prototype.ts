// PROTOTYPE. Question: Which wall design should the Skeletyl have? Variants
// switchable via ?walls= on the editor.
//
// ?walls=bones (organic struts): branching limbs, like tree roots or the struts
// inside a bird's bone, carry each outer side down to the rail. A limb stands
// under the middle of each web between neighbouring keys, under the middle of
// each web an end carries on in into another rib (?ends=flow), and a
// little in from each end that neither drops to the floor itself nor carries
// on. It leaves the rib down and out, bows outward, and partway to the rail
// forks in two (a Y); the branches curve apart along the side and land upright
// on the rail, spreading the load along it. Neighbouring limbs' branches meet
// on the rail halfway between them, so the openings alternate: a round arch
// under each fork, a narrowing gap between forks.
//
// Each limb is one solid, meshed whole: a trunk from the rib to the fork and a
// branch from there to each foot, round tubes along cubic Bézier centrelines,
// 3.2 mm thick under the rib, 2.7 at the fork, 2 to 2.2 along the branches.
// Over its last stretch the trunk widens across the fork, each side as far
// and as fast as its branch's outer side heads that way. At the fork the
// trunk's end is cut in two along a crotch, an arc across it bowing on ahead;
// each half (the crotch with the trunk's side its branch leaves from) runs on
// into its branch's tube, each point along a cubic: the trunk's side leaving
// along the widening (its outer side short of its chord by as much as it
// arrives past it, so it bends one way only), the crotch's points sideways,
// the two halves opposite ways; each point's path is then faired. So the
// branches part from one surface, with a rounded saddle between them, and
// nothing is shared but the crotch. Its ends are fillets: each point round the tube's last section runs
// on along a cubic to a rim drawn on the surface it meets, arriving along that
// surface, so the tube flares into it tangent to it all round with no edge.
// Under the rib the rim is on the rib's outer face, up to near its top, and
// round its underside edge a little way under it; on the rail it is across its
// top and over both edges a little way down its sides. Past the rim the tube's
// end is buried in the rib or the rail, so the union leaves only the flare.
//
// A limb's path is chosen, never pushed round what is in its way: each
// branch is one bend, heading for its foot in plan from the fork and landing
// upright, and the trunk (or a post, all the way to the rail) may not turn
// back on itself more than WAVE. Of a few starts along the side, spreads of
// its feet, bows of its fork outward and sizes of its fillets it takes the
// first, by preference, that is smooth so and clear of the keys as it stands,
// with no bend tighter than the tube, no section dented and each branch on
// its own side of the fork. Failing any, a single post (no fork) from a few
// starts; failing that, the limb is left out.
import type { Manifold } from 'manifold-3d';
import { add, cross, dot, scale, sub, unit, type V3 } from '../geometry';
import type { WallKit, WallSide } from '../skeletyl-walls.prototype';

/** Tube radii (mm): under the rib, the trunk at the fork, a branch just past it, and over the rail. */
const R = { rib: 1.6, fork: 1.35, branch: 1, rail: 1.1 };
/**
 * The fillets (mm, before `scale`): where the tube starts under the rib's
 * outer underside edge (below it, and out from its outer face to the tube's
 * middle, × the tube's radius), and its rim on the rib: half as long along the
 * side, how far below the rib's top it stops and how far it reaches under the
 * rib; the tube ends above the rail, and its rim there: half as long along the
 * rail, and how far down the rail's sides it reaches.
 */
const ROOT = { off: 3.5, along: 4, up: 2, top: 0.5, under: 1.5 };
const FOOT = { above: 2.5, along: 3, down: 1 };
/** Sections through each fillet; how far its arrivals' handles reach (× its chord); the radius (mm) the rib's and the rail's edges are taken rounded to, inside them, for the fillets to wrap round. */
const [FILLET, HANDLE, EDGE] = [12, 0.45, 0.5];
/** The most an arrival's handle reaches back towards the rim's middle (× how far out the rim is there). */
const ARRIVE = 0.7;
/** In mm: how far a fillet's end is buried in the rib or the rail, and how far under it the fillet arrives; how far in from a free end its limb stands; the least height of the rib over the rail for a limb; how far out (plan) the rail may be from a carried-on web for it to have a limb. */
const [INTO, SINK, INSET, LEAST, FAR] = [0.3, 0.1, 4.5, 6, 10];
/**
 * The fork: the most of the drop from it to a foot a branch makes before it
 * turns down (it leaves no steeper than the trunk's line, if that is
 * shallower); how far on (× the trunk's radius there) the crotch's middle is,
 * and the most to where each branch's tube begins (or 40% of the way to its
 * foot); sections between; the points' handles there (× how far each goes);
 * the most a section between may turn back at a point (sine, × its sides).
 */
const [LAND, CROTCH, SPLIT, PARTS, KAPPA, DENT] = [0.4, 0.7, 5, 10, 0.55, 0.1];
/** The most a trunk, or a post to the rail, may turn back against the way it bends (radians). */
const WAVE = (15 * Math.PI) / 180;
/**
 * The choices for a limb's path, first choices first: how far (mm) along the
 * side from its place it starts; how far its feet reach (× halfway to the
 * next limb's, or the most a limb spreads, SPREAD × its height); how far out
 * its fork is (× the way, in plan, from its top to between its feet); its
 * fillets' size.
 */
const SLIDE = [0, -3, 3, -6, 6];
const [SPREAD, REACH] = [0.6, [1, 0.75, 0.5]];
const BOW: [number, number][] = [
  [0.6, 0],
  [0.3, 0],
  [0, 0],
  [0, 1],
  [0, 2],
];
const SCALES = [1, 0.75, 0.5];
/** Sections along a trunk and a branch; sides round each tube (even: the crotch takes half the trunk's). */
const [TRUNK, BRANCH, SIDES] = [16, 20, 32];
const UP: V3 = [0, 0, 1];

/** A place along the side: the rib's outer top and underside edges, outward, and the rail's centreline there and outward across it. */
type Spot = { top: V3; under: V3; out: V3; rail: V3; across: V3 };
/** A tube's section: centre, tangent, the direction (square to the tangent) of its first point, and radius that way and across it. */
type Node = { c: V3; t: V3; x: V3; a: number; b: number };
/**
 * A surface a tube ends on, unfolded: the point u along and s across it (mm),
 * its outward normal there and the way s grows along it (unit, in it).
 */
type Chart = (u: number, s: number) => { p: V3; n: V3; ds: V3 };
/** An end's fillet: the surface, along it (unit), its rim (centre s, half-sizes along u and s). */
type Rim = { chart: Chart; along: V3; s: number; U: number; S: number };
/**
 * A limb's sections, SIDES points each, all the same way round: the trunk's
 * from its buried end in the rib to the fork; each branch's on from there to
 * its buried end in the rail; and the crotch's points between the branches
 * (empty for a post, whose one branch runs on from the trunk's end). A
 * branch's first section is half the trunk's end (the half its way, from the
 * trunk's first point round) and the crotch.
 */
type Limb = { trunk: V3[][]; branches: V3[][][]; crotch: V3[] };

export function bones(kit: WallKit, side: WallSide): Manifold[] {
  const { keys } = side;
  if (!keys.length) return [];
  // The side's points with the webs its ends carry on in, if any.
  const [c0, c1] = side.carried;
  const shift = Math.max(0, c0.length - 1);
  const points = [...c0.slice(1).reverse(), ...side.points, ...c1.slice(1)];
  // Distance along the side in plan, and the side anywhere between its keys' outer corners (or carried webs' ends).
  const s = [0];
  points.slice(1).forEach((p, i) => s.push(s[i] + plan(sub(p.under, points[i].under))));
  const [from, to] = [keys[0].from + shift, keys.at(-1)!.to + shift];
  const [first, last] = [c0.length ? 0 : from, c1.length ? points.length - 1 : to];
  const at = (x: number): Spot => {
    x = Math.min(s[last], Math.max(s[first], x));
    let i = first;
    while (i < last - 1 && s[i + 1] < x) i++;
    const [p, q, f] = [points[i], points[i + 1], (x - s[i]) / (s[i + 1] - s[i] || 1)];
    const [out, rail] = [unit(lerp(p.out, q.out, f)), lerp(p.rail.centre, q.rail.centre, f)];
    // Across the rail: square to it in plan, outward.
    const d = sub(q.rail.centre, p.rail.centre);
    const across: V3 = plan(d) < 1e-6 ? out : unit([d[1], -d[0], 0]);
    if (dot(across, out) < 0) across.forEach((v, k) => (across[k] = -v));
    return { top: lerp(p.top, q.top, f), under: lerp(p.under, q.under, f), out, rail, across };
  };
  // A limb under each web's middle between keys; in from each end that
  // neither drops nor carries on; and under the middle of each web an end
  // carries on in, if it runs along the outline there (the rail under it,
  // not across the frame from a web inside it).
  const middle = (a: number, b: number) => (s[a] + s[b]) / 2;
  const near = (x: number) => {
    const m = at(x);
    return plan(sub(m.rail, m.under)) <= FAR;
  };
  const carried = (a: number, b: number) => (near(middle(a, b)) ? [middle(a, b)] : []);
  const anchors = [
    ...(c0.length ? carried(first, from) : side.ends[0] !== 'drop' ? [s[first] + INSET] : []),
    ...keys.slice(1).map((k, i) => middle(keys[i].to + shift, k.from + shift)),
    ...(c1.length ? carried(to, last) : side.ends[1] !== 'drop' ? [s[last] - INSET] : []),
  ];
  return anchors.flatMap((x, j) => {
    const h = at(x).top[2] - side.railHeight;
    if (h < LEAST) return [];
    // Each branch reaches at most halfway to the neighbouring limb (or the side's end).
    const reach = (n: number) => Math.min(SPREAD * h, Math.abs(n - x) / 2);
    const most = [-reach(anchors[j - 1] ?? -1e3), reach(anchors[j + 1] ?? 1e3)];
    // Its fillets' rims within the side (past its ends `at` would fold them).
    const [lo, hi] = [s[first], s[last]];
    const fits = (v: number, half: number) => v - half >= lo && v + half <= hi;
    const inside = (v: number, half: number) => Math.min(hi - half, Math.max(lo + half, v));
    for (const d of SLIDE)
      for (const r of REACH)
        for (const bow of BOW)
          for (const k of SCALES) {
            if (!fits(x + d, ROOT.along * k)) continue;
            const feet = most.map((m) => inside(x + r * m, FOOT.along * k));
            if (!feet.every(near)) continue;
            const y = limb(side, at, x + d, feet, k, bow);
            if (y) return [solid(kit, y)];
          }
    for (const d of SLIDE)
      for (const bow of BOW)
        for (const k of SCALES) {
          if (!fits(x + d, ROOT.along * k) || !fits(x + d, FOOT.along * k)) continue;
          const y = limb(side, at, x + d, [x + d], k, bow);
          if (y) return [solid(kit, y)];
        }
    return [];
  });
}

/**
 * The limb at x along the side, its fillets `k` × full size and its fork
 * `bow` of the way out: a Y to the feet at feetX along the side (a post if
 * one), or nothing if it isn't smooth and clear.
 */
function limb(
  side: WallSide,
  at: (x: number) => Spot,
  x: number,
  feetX: number[],
  k: number,
  bow: [number, number],
): Limb | null {
  const spot = at(x);
  // The tube's top: out from the rib's outer underside edge, square to it
  // (down and out, between its outer face and its underside).
  const rib = ribRim(at, x, k);
  const corner = rib.chart(0, 0).n;
  // (Nearer on a short limb, to leave room under it.)
  const off = Math.min(ROOT.off, (spot.under[2] - side.railHeight) / 4) * k;
  const root = add(spot.under, scale(corner, off));
  // The branches' ends over the rail, lower on a short limb.
  const above = Math.min(FOOT.above * k, (root[2] - side.railHeight) / 5);
  const tops = feetX.map((f): V3 => {
    const c = at(f).rail;
    return [c[0], c[1], side.railHeight + above];
  });
  const mid = lerp(tops[0], tops.at(-1)!, 0.5);
  // The fork: 40% of the way down to them, `bow` of the way out; through it
  // halfway between the ways from the root and on to the feet.
  const fz = mid[2] + (root[2] - mid[2]) * 0.6;
  const fork: V3 = [...add(lerp(root, mid, bow[0]), scale(spot.out, bow[1])).slice(0, 2), fz] as V3;
  const tf = unit(add(unit(sub(fork, root)), unit(sub(mid, fork))));
  // Across the fork, from the first branch's side to the second's (along
  // the side for a post), and square to that: the crotch's way.
  const forks = tops.length > 1;
  const e = unit(perp(forks ? sub(tops[1], tops[0]) : alongAt(at, x), tf));
  const b = unit(cross(e, tf));
  // The trunk's centreline, leaving the rib halfway between square to its
  // edge and straight for the fork, as a bough leaves a trunk.
  const L = Math.hypot(...sub(fork, root)) / 3;
  const t0 = unit(add(corner, unit(sub(fork, root))));
  const path = curve([root, add(root, scale(t0, L)), sub(fork, scale(tf, L)), fork], TRUNK);
  const length = path.slice(1).reduce((s, n, i) => s + Math.hypot(...sub(n.c, path[i].c)), 0);
  // Each branch's centreline is one bend: from the fork straight for its
  // foot in plan, as steep as the trunk (no steeper than leaves LAND of the
  // drop before it turns down), round to land upright (a quadratic through
  // the corner over the foot). A post's runs on along the trunk and lands
  // upright, its handle no higher than the fork so it doesn't loop. Then
  // each tube from where it is clear of the crotch (from the fork for a
  // post), and how far its start is on along tf (× KAPPA: the points'
  // handles on to it). Its outer side, from the trunk's side (widened W) to
  // the tube's, leaves turned as far short of its chord as it arrives past
  // it, so it bends one way only: Ec / Ft, how fast the trunk's side widens
  // at the fork (W found with it, a few rounds); Em, how far out its way
  // the tube's start is (× KAPPA).
  const slopes = tops.map((top) => {
    const to = sub(top, fork);
    const h = dot(tf, unit([to[0], to[1], 0]));
    const most = (LAND * (fork[2] - top[2])) / plan(to);
    return h > 0 ? Math.min(-tf[2] / h, most) : most;
  });
  if (forks && !slopes.every((v) => v > 0)) return null;
  const lines = tops.map((top, f) => {
    const ew = scale(e, forks ? (f ? 1 : -1) : 0);
    const to = sub(top, fork);
    const C: V3 = [top[0], top[1], fork[2] - plan(to) * slopes[f]];
    const M = Math.hypot(...to) / 3;
    const line = forks
      ? curve([fork, lerp(fork, C, 2 / 3), lerp(top, C, 2 / 3), top], BRANCH)
      : curve(
          [
            fork,
            add(fork, scale(tf, M)),
            add(top, scale(UP, Math.min(1.2 * M, 0.8 * (fork[2] - top[2])))),
            top,
          ],
          BRANCH,
        );
    const split = Math.min(SPLIT * R.fork, 0.4 * Math.hypot(...to));
    const K = forks ? line.findIndex((n) => Math.hypot(...sub(n.c, fork)) >= split) : 1;
    const go = sub(line[Math.max(K, 0)].c, fork);
    const Ft = KAPPA * dot(go, tf);
    if (!forks) return { ew, line, K, Ft, Ec: 0, Em: 0, W: 0 };
    const tk = line[K].t;
    const arrive = Math.atan2(dot(tk, ew), dot(tk, tf));
    const out = sub(add(go, scale(unit(perp(ew, tk)), R.branch)), scale(ew, R.fork));
    const cap = Math.min(R.fork, Math.max(0.2, dot(out, ew) / 2));
    let [g, W] = [Math.max(0, dot(out, ew)) / Math.max(dot(out, tf), 0.1), 0];
    for (let n = 0; n < 8; n++) {
      W = Math.min(cap, (g * length) / 4);
      const d = sub(out, scale(ew, W));
      g = Math.tan(Math.min(Math.max(0, 2 * Math.atan2(dot(d, ew), dot(d, tf)) - arrive), 1.4));
    }
    return { ew, line, K, Ft, Ec: Ft * g, Em: KAPPA * dot(go, ew), W };
  });
  if (lines.some(({ K }) => K < 1 || K > BRANCH - 4)) return null;
  // Not if the trunk (or a post, all the way) turns back on itself. The
  // trunk's sections' first points are carried back from b at the fork (each
  // on from the last, not turned to a fixed direction, which spins them where
  // the tube runs along it). Over its last stretch (at most half) it widens
  // across the fork, each side (-e, +e) by W, as fast at the fork as its
  // branch's outer side leaves (Ec / Ft), so that side leaves it along it.
  const through = forks ? path : [...path, ...lines[0].line.slice(1)];
  if (sway(through.map((n) => n.c)) > WAVE) return null;
  const xs = carry([...path].reverse(), b).reverse();
  const most = lines.map(({ Ft, Ec, W }) => {
    if (!forks) return { m: 0, q: 1 };
    const g = Ec / Math.max(Ft, 0.1);
    return { m: W, q: g > 1e-6 ? Math.min(0.5, (2 * W) / (g * length)) : 0.5 };
  });
  if (!forks) most.push(most[0]);
  const wide = (u: number, { m, q }: { m: number; q: number }) =>
    m * Math.max(0, (u - 1 + q) / q) ** 2;
  const trunk = path.map((n, i) => {
    const u = i / TRUNK;
    const r = R.rib + (R.fork - R.rib) * ease(u);
    const [lo, hi] = most.map((m) => r + wide(u, m));
    const A = unit(perp(xs[i], n.t));
    const B = cross(n.t, A);
    return Array.from({ length: SIDES }, (_, j) => {
      const [c, s] = [Math.cos((2 * Math.PI * j) / SIDES), Math.sin((2 * Math.PI * j) / SIDES)];
      return add(n.c, add(scale(A, r * c), scale(B, s * (s < 0 ? lo : hi))));
    });
  });
  if (folds(trunk)) return null;
  const rootFillet = fillet(trunk[0], scale(t0, -1), rib).reverse();
  if (!side.clear(over([...rootFillet.slice(1), ...trunk]))) return null;
  const end = trunk.at(-1)!;
  const across = most.map((m) => R.fork + wide(1, m));
  // The crotch: across the trunk's end from b to -b, bowing on along tf.
  const half = SIDES / 2;
  const crotch = Array.from({ length: half - 1 }, (_, i) => {
    const a = (Math.PI * (i + 1)) / half;
    return add(fork, add(scale(b, R.fork * Math.cos(a)), scale(tf, CROTCH * R.fork * Math.sin(a))));
  });
  const branches: V3[][][] = [];
  for (const [f, { ew, line, K, Ft, Ec, Em }] of lines.entries()) {
    // This branch's first section: the trunk's end on its side (from b round
    // its way to -b for the second, -b round to b for the first) and the
    // crotch back.
    const w = forks ? (f ? 1 : -1) : 0;
    const first = !forks
      ? end
      : f
        ? [...end.slice(0, half + 1), ...[...crotch].reverse()]
        : [...end.slice(half), end[0], ...crotch];
    // Its tube, its first point on b's side (on -b's for the first branch),
    // so its sections go round the same way as its first.
    const bx = carry(line.slice(K), scale(b, forks ? w : 1));
    const r0 = forks ? R.branch : R.fork;
    const tube = line.slice(K).map((n, i) => {
      const r = r0 + (R.rail - r0) * ease(i / (BRANCH - K));
      return ring({ ...n, x: bx[i], a: r, b: r });
    });
    // Between: each point of the first section on along a cubic to the
    // tube's first, each along the surface it leaves: the trunk's side on
    // along it as it widens (Ec, at its outermost) and round it towards the
    // crotch's ends, heading out as the tube's start does (Em) there; the
    // crotch sideways as far as it goes that way and along itself (towards
    // its ends), the other branch's the other way, so the two meet smoothly.
    // Each leaves as far on as it goes (× KAPPA) and arrives along the tube,
    // its handle KAPPA × how far it goes. Then each point's path is faired
    // from the second section to past the tube's start.
    const tk = line[K].t;
    const leave = first.map((p, j): V3 => {
      const go = sub(tube[0][j], p);
      const ft = KAPPA * Math.max(dot(go, tf), 0.1);
      if (j <= half) {
        const a = Math.PI * (j / half + (f ? 0 : 1));
        const [c, s] = [Math.cos(a), Math.sin(a)];
        const round = add(scale(b, -s * R.fork), scale(e, c * across[f]));
        const slide = Math.abs(c) < 1e-9 ? 0 : (w * Em * (1 - Math.abs(s))) / (c * across[f]);
        return scale(
          add(add(scale(tf, Ft), scale(ew, Ec * Math.abs(s))), scale(round, slide)),
          ft / Ft,
        );
      }
      const a = (Math.PI * (f ? SIDES - j : j - half)) / half;
      const along = unit(add(scale(b, -Math.sin(a)), scale(tf, CROTCH * Math.cos(a))));
      return add(scale(ew, KAPPA * Math.max(dot(go, ew), 0.1)), scale(along, ft * Math.cos(a)));
    });
    const parts = !forks
      ? []
      : Array.from({ length: PARTS - 1 }, (_, i) =>
          first.map((p, j) => {
            const q = tube[0][j];
            const h1 = KAPPA * Math.hypot(...sub(q, p));
            return bezier([p, add(p, leave[j]), sub(q, scale(tk, h1)), q], (i + 1) / PARTS);
          }),
        );
    const foot = fillet(tube.at(-1)!, line.at(-1)!.t, railRim(side, at, feetX[f], k));
    // Not if a section between dents in, or the tube bends tighter than it
    // is thick (its inner side would fold back); each branch on its own side
    // of the fork, and clear (the fillet's buried end is in the rail).
    const rings = [first, ...parts, ...tube];
    if (forks) fair(rings, PARTS + 6);
    if (!parts.every(convex) || folds(rings)) return null;
    const on = [...parts, ...tube, ...foot].flat();
    if (forks && on.some((p) => dot(sub(p, fork), ew) <= 0)) return null;
    if (!side.clear(over([...rings, ...foot.slice(0, -1)]))) return null;
    branches.push([...parts, ...tube, ...foot]);
  }
  return { trunk: [...rootFillet, ...trunk], branches, crotch: forks ? crotch : [] };
}

/**
 * A limb's solid: its sections joined point to point, the trunk's end joined
 * to each branch's first section (the crotch shared between them), and each
 * buried end closed by a fan from its middle.
 */
function solid(kit: WallKit, limb: Limb): Manifold {
  const verts: number[] = [];
  const tris: number[] = [];
  const put = (ps: V3[]) => ps.map((p) => verts.push(...p) / 3 - 1);
  const vert = (i: number): V3 => [verts[3 * i], verts[3 * i + 1], verts[3 * i + 2]];
  const loft = (rings: number[][]) =>
    rings.slice(1).forEach((b, i) => {
      const a = rings[i];
      a.forEach((_, j) => {
        const J = (j + 1) % a.length;
        tris.push(a[j], a[J], b[J], a[j], b[J], b[j]);
      });
    });
  const cap = (r: number[], last: boolean) => {
    const [c] = put([centroid(r.map(vert))]);
    r.forEach((_, j) => {
      const J = (j + 1) % r.length;
      tris.push(...(last ? [c, r[j], r[J]] : [c, r[J], r[j]]));
    });
  };
  const trunk = limb.trunk.map(put);
  cap(trunk[0], false);
  loft(trunk);
  const end = trunk.at(-1)!;
  const crotch = put(limb.crotch);
  const half = SIDES / 2;
  limb.branches.forEach((sections, f) => {
    const first = !crotch.length
      ? end
      : f
        ? [...end.slice(0, half + 1), ...[...crotch].reverse()]
        : [...end.slice(half), end[0], ...crotch];
    const rings = [first, ...sections.map(put)];
    loft(rings);
    cap(rings.at(-1)!, true);
  });
  // Facing out: the triangles turned if they enclose a negative volume.
  let v = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [p, q, r] = [tris[i], tris[i + 1], tris[i + 2]].map(vert);
    v += dot(p, cross(q, r));
  }
  if (v < 0)
    for (let i = 0; i < tris.length; i += 3)
      [tris[i + 1], tris[i + 2]] = [tris[i + 2], tris[i + 1]];
  const { Manifold, Mesh } = kit.wasm;
  const made = new Manifold(
    new Mesh({
      numProp: 3,
      vertProperties: new Float32Array(verts),
      triVerts: new Uint32Array(tris),
    }),
  );
  if (made.status() !== 'NoError') throw new Error(`bones: a limb is ${made.status()}`);
  return made;
}

/**
 * The fillet from a tube's last section `ring` (heading on along `t`) onto a
 * surface: each of its points on along a cubic, leaving along t and arriving
 * along the surface, straight out from the rim's middle, at the rim's point
 * the same way round (seen along t, so the fillet doesn't twist); then the
 * rim pushed INTO under the surface, to be the solid's end. The sections
 * after the ring, to that end.
 */
function fillet(ring: V3[], t: V3, rim: Rim): V3[][] {
  const c = centroid(ring);
  // The rim's u and s at its middle, square to t.
  const flat = (v: V3) => unit(sub(v, scale(t, dot(v, t))));
  const [eu, es] = [flat(rim.along), flat(rim.chart(0, rim.s).ds)];
  const ends = ring.map((p) => {
    const th = Math.atan2(dot(sub(p, c), eu), dot(sub(p, c), es));
    const [u, v] = [Math.sin(th), Math.cos(th)];
    const [cu, cs] = [rim.U * u, rim.s + rim.S * v];
    const q = rim.chart(cu, cs);
    // Straight out from the rim's middle, in the surface (along it here, as
    // it bends): the arrivals' handles back from the rim then trace smaller
    // rims, which don't fold where it turns tightly, at its ends along u.
    const d = sub(rim.chart(cu + 0.1, cs).p, rim.chart(cu - 0.1, cs).p);
    const du = Math.hypot(...d) > 1e-6 ? unit(d) : rim.along;
    const w = add(scale(du, rim.U * u), scale(q.ds, rim.S * v));
    const m = unit(sub(w, scale(q.n, dot(w, q.n))));
    const chord = Math.hypot(...sub(q.p, p)) * HANDLE;
    const back = Math.min(chord, ARRIVE * Math.hypot(rim.U * u, rim.S * v));
    const end = sub(q.p, scale(q.n, SINK));
    return { ctrl: [p, add(p, scale(t, chord)), sub(end, scale(m, back)), end], q };
  });
  const sections = Array.from({ length: FILLET }, (_, i) => {
    const f = (i + 1) / FILLET;
    const w = [(1 - f) ** 3, 3 * f * (1 - f) ** 2, 3 * f * f * (1 - f), f ** 3];
    return ends.map(({ ctrl }) => ctrl.reduce<V3>((a, p, j) => add(a, scale(p, w[j])), [0, 0, 0]));
  });
  return [...sections, ends.map(({ q }) => sub(q.p, scale(q.n, INTO)))];
}

/**
 * The rim under the rib at x along the side: the rib there unfolded, s up its
 * outer face from its underside edge (s > 0) and in under it (s < 0); centred
 * along it at x, from `under` in under the rib to `top` below the rib's top.
 */
function ribRim(at: (x: number) => Spot, x: number, k: number): Rim {
  const frame = (u: number) => {
    const q = at(x + u);
    const up = unit(sub(q.top, q.under));
    const along = alongAt(at, x + u);
    let out = unit(cross(along, up));
    if (dot(out, q.out) < 0) out = scale(out, -1);
    return { q, up, out, thick: Math.hypot(...sub(q.top, q.under)) };
  };
  const chart: Chart = (u, s) => {
    const { q, up, out } = frame(u);
    const c = corner(q.under, scale(out, -1), up, s);
    return { p: c.p, n: c.n, ds: c.dr };
  };
  const [hi, lo] = [Math.min(ROOT.up, frame(0).thick - ROOT.top) * k, -ROOT.under * k];
  return { chart, along: alongAt(at, x), s: (hi + lo) / 2, U: ROOT.along * k, S: (hi - lo) / 2 };
}

/**
 * The rim on the rail at a foot, x along the side: the rail there unfolded,
 * s across its top from its centreline (outward) and on down its sides;
 * centred on the centreline, reaching down each side.
 */
function railRim(side: WallSide, at: (x: number) => Spot, x: number, k: number): Rim {
  const half = side.wall / 2;
  const chart: Chart = (u, s) => {
    const { rail, across } = at(x + u);
    const e = Math.sign(s) || 1;
    // The edge on s's side, from the top (r < 0) down the side (r > 0).
    const edge = add(add(rail, scale(across, e * half)), scale(UP, side.railHeight));
    const c = corner(edge, scale(across, -e), scale(UP, -1), Math.abs(s) - half);
    return { p: c.p, n: c.n, ds: scale(c.dr, e) };
  };
  return { chart, along: alongAt(at, x, 'rail'), s: 0, U: FOOT.along * k, S: half + FOOT.down * k };
}

/**
 * A point r (mm) from the edge K between two faces square to each other, the
 * edge rounded to radius EDGE (inside it): on the first face for r < 0 (A is
 * along it, away from the edge), on the second for r > 0 (B); its outward
 * normal, and the way r grows.
 */
function corner(K: V3, A: V3, B: V3, r: number) {
  if (r <= -EDGE) return { p: add(K, scale(A, -r)), n: scale(B, -1), dr: scale(A, -1) };
  if (r >= EDGE) return { p: add(K, scale(B, r)), n: scale(A, -1), dr: B };
  const f = ((r + EDGE) / (2 * EDGE)) * (Math.PI / 2);
  const [c, s] = [Math.cos(f), Math.sin(f)];
  const round = add(K, scale(add(A, B), EDGE));
  return {
    p: sub(round, add(scale(B, EDGE * c), scale(A, EDGE * s))),
    n: scale(add(scale(B, c), scale(A, s)), -1),
    dr: sub(scale(B, s), scale(A, c)),
  };
}

/** The side's direction (plan, unit) at x along it, along the rib's edge or the rail. */
function alongAt(at: (x: number) => Spot, x: number, on: 'under' | 'rail' = 'under') {
  for (const d of [0.5, 2, 5]) {
    const v = sub(at(x + d)[on], at(x - d)[on]);
    if (plan(v) > 1e-6) return unit([v[0], v[1], 0]);
  }
  const o = at(x).out;
  return unit([-o[1], o[0], 0]);
}

/** Whether any point of a tube's rings steps back from one ring to the next (against the step of their middles). */
function folds(tube: V3[][]) {
  return tube.slice(1).some((sec, i) => {
    const step = sub(centroid(sec), centroid(tube[i]));
    return sec.some((p, j) => dot(sub(p, tube[i][j]), step) <= 0);
  });
}

/** Whether a section turns the same way at every point, seen along its mean normal (no point folds back across it). */
function convex(sec: V3[]) {
  const c = centroid(sec);
  const n = unit(
    sec.reduce<V3>(
      (a, p, i) => add(a, cross(sub(p, c), sub(sec[(i + 1) % sec.length], c))),
      [0, 0, 0],
    ),
  );
  return sec.every((p, i) => {
    const [u, v] = [
      sub(p, sec[(i + sec.length - 1) % sec.length]),
      sub(sec[(i + 1) % sec.length], p),
    ];
    return dot(cross(u, v), n) >= -DENT * Math.hypot(...u) * Math.hypot(...v);
  });
}

/**
 * Fairs each point's path through sections 2 to `to` - 1 in place, moving
 * each against its fourth difference along the path a little at a time, the
 * two sections at each end held, so the paths leave and arrive as before.
 */
function fair(rings: V3[][], to: number) {
  to = Math.min(to, rings.length - 2);
  for (let n = 0; n < 300; n++) {
    const d = rings.slice(2, to).map((sec, k) =>
      sec.map((p, j) => {
        const [a, b, c, e] = [rings[k][j], rings[k + 1][j], rings[k + 3][j], rings[k + 4][j]];
        return add(add(a, e), sub(scale(p, 6), scale(add(b, c), 4)));
      }),
    );
    d.forEach((sec, k) =>
      sec.forEach((v, j) => (rings[k + 2][j] = sub(rings[k + 2][j], scale(v, 0.1)))),
    );
  }
}

/** How much a path turns back and forth (radians): its total turning less the angle between its first and last steps (none for a single bend). */
function sway(path: V3[]) {
  const steps = path
    .slice(1)
    .map((p, i) => sub(p, path[i]))
    .filter((v) => Math.hypot(...v) > 1e-9);
  const turns = steps.slice(1).map((v, i) => {
    const n = cross(unit(steps[i]), unit(v));
    const s = Math.hypot(...n);
    return s < 1e-9 ? ([0, 0, 0] as V3) : scale(n, Math.asin(Math.min(1, s)) / s);
  });
  const sense = turns.reduce(add, [0, 0, 0]);
  if (Math.hypot(...sense) < 1e-9) return 0;
  const on = unit(sense);
  return turns.reduce((s, n) => s + Math.max(0, -dot(n, on)), 0);
}

/** Each section's first point's direction along a path, x at its start carried on (square to each tangent in turn). */
function carry(path: { t: V3 }[], x: V3) {
  return path.map((n) => (x = unit(perp(x, n.t))));
}

/** A section's points: an ellipse square to the tangent, `a` across and `b` along the side. */
function ring(n: Node): V3[] {
  const A = unit(sub(n.x, scale(n.t, dot(n.x, n.t))));
  const B = cross(n.t, A);
  return Array.from({ length: SIDES }, (_, j) => {
    const th = (2 * Math.PI * j) / SIDES;
    return add(n.c, add(scale(A, n.a * Math.cos(th)), scale(B, n.b * Math.sin(th))));
  });
}

/** Points over a tube's surface, for `clear`: its sections' (under a millimetre apart round them and along it). */
const over = (rings: V3[][]) => rings.flat();

/** A cubic Bézier through control points `c`, sampled at n + 1 points with tangents. */
const curve = (c: V3[], n: number) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    const w = [(1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u * u * (1 - u), u ** 3];
    const d = [-3 * (1 - u) ** 2, 3 * (1 - u) * (1 - 3 * u), 3 * u * (2 - 3 * u), 3 * u * u];
    const mix = (k: number[]) => c.reduce<V3>((acc, p, j) => add(acc, scale(p, k[j])), [0, 0, 0]);
    return { c: mix(w), t: unit(mix(d)) };
  });

/** A cubic Bézier through control points `c` at u. */
const bezier = (c: V3[], u: number) => {
  const w = [(1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u * u * (1 - u), u ** 3];
  return c.reduce<V3>((acc, p, j) => add(acc, scale(p, w[j])), [0, 0, 0]);
};

/** v less its part along unit t. */
const perp = (v: V3, t: V3) => sub(v, scale(t, dot(v, t)));
const lerp = (p: V3, q: V3, f: number) => add(p, scale(sub(q, p), f));
const plan = (v: V3) => Math.hypot(v[0], v[1]);
const ease = (u: number) => u * u * (3 - 2 * u);
const centroid = (pts: V3[]) => scale(pts.reduce(add), 1 / pts.length);
