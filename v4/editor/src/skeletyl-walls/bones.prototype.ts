// PROTOTYPE. Question: Which wall design should the Skeletyl have? Variants
// switchable via ?walls= on the editor.
//
// ?walls=bones (organic struts): branching limbs, like tree roots or the struts
// inside a bird's bone, carry each outer side down to the rail. A limb stands
// under the middle of each web between neighbouring keys, under the middle of
// each web an end carries on in into another rib (?ends=flow), and a
// little in from each end that neither drops to the floor itself nor carries
// on. It leaves the rib down and out, bows outward, and halfway to the rail
// forks in two (a Y); the branches curve apart along the side and land upright
// on the rail, spreading the load along it. Neighbouring limbs' branches meet
// on the rail halfway between them, so the openings alternate: a round arch
// under each fork, a narrowing gap between forks.
//
// Each branch is one tube swept from the rib to the rail (trunk and branch
// together, the two branches sharing the trunk) through elliptical sections
// across a cubic Bézier centreline, 3.2 mm thick under the rib, 2.4 at the
// fork, 2.2 mid-branch and 2.6 over the rail. Its ends are fillets: each
// point round the tube's last section runs on along a cubic to a rim drawn on
// the surface it meets, arriving along that surface, so the tube flares into
// it tangent to it all round with no edge. Under the rib the rim is on the
// rib's outer face, up to near its top, and round its underside edge a little
// way under it; on the rail it is across its top and over both edges a little
// way down its sides. Past the rim the tube's end is buried in the rib or the
// rail, so the union leaves only the flare. Where a key's tile is in the way (a
// rolled key) the tube is pushed out by as much as `room` says, smoothly. If
// that would part a foot from the rail, or the tube still isn't clear, the
// limb tries a smaller fillet and a little along the side; failing that the
// branch is left out, and the limb if both are.
import type { Manifold } from 'manifold-3d';
import { add, cross, dot, scale, sub, unit, type V3 } from '../geometry';
import type { WallKit, WallSide } from '../skeletyl-walls.prototype';

/** Tube radii (mm) under the rib, at the fork, mid-branch and over the rail. */
const R = { rib: 1.6, fork: 1.2, mid: 1.1, rail: 1.1 };
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
/** The fillets' sizes to try, largest first. */
const SCALES = [1, 0.75, 0.5];
/** Sections through each fillet; how far its arrivals' handles reach (× its chord); the radius (mm) the rib's and the rail's edges are taken rounded to, inside them, for the fillets to wrap round. */
const [FILLET, HANDLE, EDGE] = [12, 0.45, 0.5];
/** The most an arrival's handle reaches back towards the rim's middle (× how far out the rim is there). */
const ARRIVE = 0.7;
/** In mm: how far a fillet's end is buried in the rib or the rail, and how far under it the fillet arrives; how far in from a free end its limb stands; the least height of the rib over the rail for a limb; how far out (plan) the rail may be from a carried-on web for it to have a limb. */
const [INTO, SINK, INSET, LEAST, FAR] = [0.3, 0.1, 4.5, 6, 10];
/** The most a branch spreads (× the limb's height); how far (mm) the tube's top may be pushed out for the keys. */
const [SPREAD, PUSH] = [0.6, 1.5];
/** How far (mm) along the side from its place a limb may go to find room, first choices first. */
const SLIDE = [0, -3, 3, -6, 6];
/** Sections along a trunk and a branch; sides round each tube; how many sections before the fork a second branch starts, at what size. */
const [TRUNK, BRANCH, SIDES, FORK, SHRINK] = [16, 14, 32, 5, 0.7];
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
  const carried = (a: number, b: number) => {
    const m = at(middle(a, b));
    return plan(sub(m.rail, m.under)) <= FAR ? [middle(a, b)] : [];
  };
  const anchors = [
    ...(c0.length ? carried(first, from) : side.ends[0] !== 'drop' ? [s[first] + INSET] : []),
    ...keys.slice(1).map((k, i) => middle(keys[i].to + shift, k.from + shift)),
    ...(c1.length ? carried(to, last) : side.ends[1] !== 'drop' ? [s[last] - INSET] : []),
  ];
  return anchors.flatMap((x, j) => {
    const here = at(x);
    const h = here.top[2] - side.railHeight;
    if (h < LEAST) return [];
    // Each branch reaches halfway to the neighbouring limb (or the side's end).
    const reach = (n: number) => Math.min(SPREAD * h, Math.abs(n - x) / 2);
    const feet = [x - reach(anchors[j - 1] ?? -1e3), x + reach(anchors[j + 1] ?? 1e3)];
    // The largest fillets, as near x, that leave the most branches clear;
    // failing any, a single post straight down.
    let best: V3[][][] = [];
    for (const d of SLIDE)
      for (const k of SCALES) {
        const y = limb(side, at, x + d, feet, k);
        if (y.length > best.length) best = y;
        if (best.length === 2) return best.map((r) => kit.sweep(r));
      }
    for (const d of best.length ? [] : SLIDE)
      for (const k of SCALES) {
        const y = limb(side, at, x + d, [x + d], k);
        if (y.length) return y.map((r) => kit.sweep(r));
      }
    return best.map((r) => kit.sweep(r));
  });
}

/** One Y at x along the side, its fillets `k` × full size: a trunk forking to a branch to each foot, each branch with the trunk the sections of one tube, rib to rail. */
function limb(
  side: WallSide,
  at: (x: number) => Spot,
  x: number,
  feetX: number[],
  k: number,
): V3[][][] {
  const spot = at(x);
  const out = spot.out;
  const feet = feetX.map(at);
  // The tube's top: out from the rib's outer underside edge, square to it
  // (down and out, between its outer face and its underside).
  const rib = ribRim(at, x, k);
  const corner = rib.chart(0, 0).n;
  // (Nearer on a short limb, to leave room under it.)
  const off = Math.min(ROOT.off, (spot.under[2] - side.railHeight) / 4) * k;
  const root = add(spot.under, scale(corner, off));
  // The branches' ends over the rail, lower on a short limb.
  const above = Math.min(FOOT.above * k, (root[2] - side.railHeight) / 5);
  const tops = feet.map(({ rail: c }): V3 => [c[0], c[1], side.railHeight + above]);
  const mid = lerp(tops[0], tops.at(-1)!, 0.5);
  // The fork: halfway down to them, most of the way out to the rail; leaving it towards the feet.
  const fz = mid[2] + (root[2] - mid[2]) * 0.6;
  const fork: V3 = [...lerp(root, mid, 0.6).slice(0, 2), fz] as V3;
  const tf = unit(add(unit(sub(mid, root)), scale(UP, -0.5)));
  const L = Math.hypot(...sub(fork, root)) / 3;
  // Leaving the rib halfway between square to its edge and straight for the
  // fork, as a bough leaves a trunk.
  const t0 = unit(add(corner, unit(sub(fork, root))));
  const trunk = curve([root, add(root, scale(t0, L)), sub(fork, scale(tf, L)), fork], TRUNK);
  const trunkNodes = trunk.map((n, i): Node => {
    const r = R.rib + (R.fork - R.rib) * ease(i / TRUNK);
    return { ...n, x: out, a: r, b: r };
  });
  const paths = tops.map((top) => {
    const M = Math.hypot(...sub(top, fork)) / 3;
    // Landing upright, its handle no higher than the fork so it doesn't loop.
    const up = Math.min(1.2 * M, 0.8 * (fork[2] - top[2]));
    const branch = curve([fork, add(fork, scale(tf, M)), add(top, scale(UP, up)), top], BRANCH);
    const nodes = branch.slice(1).map((n, i): Node => {
      const u = (i + 1) / BRANCH;
      const [r0, r1, v] = u < 0.5 ? [R.fork, R.mid, 2 * u] : [R.mid, R.rail, 2 * u - 1];
      const r = r0 + (r1 - r0) * ease(v);
      return { ...n, x: out, a: r, b: r };
    });
    // Each section's first point carried on from the last's (not turned to a
    // fixed direction, which spins the sections where the tube runs along it).
    let x = out;
    return [...trunkNodes, ...nodes].map((n) => {
      x = unit(sub(x, scale(n.t, dot(x, n.t))));
      return { ...n, x };
    });
  });
  // Push each section out as far as a key's tile needs (smoothed along the
  // path); the trunk by the most either path needs, so the two agree.
  const pushes = paths.map((nodes) => smooth(nodes.map((n) => need(side, n, out))));
  const trunkPush = trunk.map((_, i) => Math.max(...pushes.map((p) => p[i])));
  const tubes = paths.flatMap((nodes, f) => {
    const push = pushes[f].map((p, i) => (i <= TRUNK ? trunkPush[i] : p));
    // Not if it would leave its fillet into the rib too long or its foot off the rail.
    if (push[0] > PUSH || push.at(-1)! > 0.01) return [];
    const rings = nodes.map((n, i) => ring({ ...n, c: add(n.c, scale(out, push[i])) }));
    const ends = [
      fillet(rings[0], scale(nodes[0].t, -1), rib).reverse(),
      fillet(rings.at(-1)!, nodes.at(-1)!.t, railRim(side, at, feetX[f], k)),
    ];
    const tube = [...ends[0], ...rings, ...ends[1]];
    // Not if it bends tighter than it is thick (its inner side would fold
    // back); the fillets' buried ends are in the rib and the rail: test the
    // rest is clear.
    return !folds(rings) && side.clear(over(tube.slice(1, -1))) ? [tube] : [];
  });
  // The trunk once: a second branch starts inside it, short of the fork,
  // growing to full size just past it (the two sharing a surface would leave
  // the union slivers).
  const start = FILLET + 1 + TRUNK - FORK;
  return tubes.map((tube, f) =>
    f
      ? tube.slice(start).map((sec, i) => {
          const c = centroid(sec);
          const g = 1 - (1 - SHRINK) * Math.max(0, 1 - i / (2 * FORK));
          return sec.map((p) => add(c, scale(sub(p, c), g)));
        })
      : tube,
  );
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

/** How far out a section must move for its tube to clear the keys (0 if it is clear). */
function need(side: WallSide, n: Node, out: V3) {
  const m = Math.max(...ring(n).map((q) => (side.clear([q]) ? 0 : side.room(q, out))));
  return m > 0 ? m + 0.1 : 0;
}

/** A path's pushes, each spread to its neighbours (tapering over 3 sections) so the tube bends out smoothly. */
const smooth = (p: number[]) =>
  p.map((_, i) => Math.max(...p.map((q, j) => q * Math.max(0, 1 - Math.abs(i - j) / 4))));

/** A section's points: an ellipse square to the tangent, `a` across and `b` along the side. */
function ring(n: Node): V3[] {
  const A = unit(sub(n.x, scale(n.t, dot(n.x, n.t))));
  const B = cross(n.t, A);
  return Array.from({ length: SIDES }, (_, j) => {
    const th = (2 * Math.PI * j) / SIDES;
    return add(n.c, add(scale(A, n.a * Math.cos(th)), scale(B, n.b * Math.sin(th))));
  });
}

/** Points over a tube's surface, a millimetre or so apart, for `clear`. */
const over = (rings: V3[][]) =>
  rings.slice(1).flatMap((s, i) =>
    s.flatMap((q, j) => {
      const [p, p2, q2] = [rings[i][j], rings[i][(j + 1) % SIDES], s[(j + 1) % SIDES]];
      return GRID.flatMap((f) => GRID.map((g) => lerp(lerp(p, p2, f), lerp(q, q2, f), g)));
    }),
  );

/** A cubic Bézier through control points `c`, sampled at n + 1 points with tangents. */
const curve = (c: V3[], n: number) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    const w = [(1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u * u * (1 - u), u ** 3];
    const d = [-3 * (1 - u) ** 2, 3 * (1 - u) * (1 - 3 * u), 3 * u * (2 - 3 * u), 3 * u * u];
    const mix = (k: number[]) => c.reduce<V3>((acc, p, j) => add(acc, scale(p, k[j])), [0, 0, 0]);
    return { c: mix(w), t: unit(mix(d)) };
  });

const lerp = (p: V3, q: V3, f: number) => add(p, scale(sub(q, p), f));
const plan = (v: V3) => Math.hypot(v[0], v[1]);
const ease = (u: number) => u * u * (3 - 2 * u);
const centroid = (pts: V3[]) => scale(pts.reduce(add), 1 / pts.length);
const GRID = [0, 0.25, 0.5, 0.75];
