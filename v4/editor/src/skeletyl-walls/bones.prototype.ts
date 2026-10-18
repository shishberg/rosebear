// PROTOTYPE. Question: Which wall design should the Skeletyl have? Variants
// switchable via ?walls= on the editor.
//
// ?walls=bones (organic struts): branching limbs, like tree roots or the struts
// inside a bird's bone, carry each outer side down to the rail. A limb leaves
// the rib's outer edge at the middle of each web between neighbouring keys,
// and a little in from each end that doesn't drop to the floor itself. It
// runs straight down off the rib, bows outward, and halfway to the rail forks
// in two (a Y); the branches curve apart along the side and land upright on
// the rail, spreading the load along it. Neighbouring limbs' branches meet on
// the rail halfway between them, so the openings alternate: a round arch under
// each fork, a narrowing gap between forks.
//
// Each branch is one tube swept from the rib to the rail (trunk and branch
// together, the two branches sharing the trunk) through elliptical sections
// across a cubic Bézier centreline. Tubes taper from 3.2 mm thick at the rib
// to 2.4 at the fork, 2.2 mid-branch and 3 at the rail, and flare wide along
// the side where they meet the rib and the rail, like fillets; on the rail
// they are no wider across than it is. Where a key's tile is in the way (a
// rolled key) the tube is pushed out by as much as `room` says, smoothly. If
// that would part a root from the rib or a foot from the rail, or the tube
// still isn't clear, the root tries lower on the rib and a little along it;
// failing that the branch is left out, and the limb if both are.
import type { Manifold } from 'manifold-3d';
import { add, cross, dot, scale, sub, unit, type V3 } from '../geometry';
import type { WallKit, WallSide } from '../skeletyl-walls.prototype';

/** Tube radii (mm) at the rib, the fork, mid-branch and on the rail. */
const R = { rib: 1.6, fork: 1.2, mid: 1.1, rail: 1.5 };
/** How much wider (× the radius) a tube flares along the side where it meets the rib or the rail, over what fraction of its trunk or branch. */
const [FLARE, FLARE_RUN] = [1.4, 0.35];
/** In mm: how far solids reach into the rib and the rail; how far in from a free end its limb stands; the least height of the rib over the rail for a limb. */
const [INTO, INSET, LEAST] = [0.3, 4.5, 6];
/** The most a branch spreads (× the limb's height); how steeply out (per mm down) a trunk leaves the rib. */
const [SPREAD, LEAVE] = [0.6, 0.7];
/** Where a root may go to find room, first choices first: how far down the rib's outer face (fractions), and how far (mm) along the side from its place. */
const ROOTS = [0.25, 0.5, 0.7];
const SLIDE = [0, -3, 3, -6, 6];
/** Sections along a trunk and a branch; sides round each tube. */
const [TRUNK, BRANCH, SIDES] = [10, 14, 10];
const UP: V3 = [0, 0, 1];

/** A place along the side: the rib's outer top and underside edges, outward, and the rail's centreline there and outward across it. */
type Spot = { top: V3; under: V3; out: V3; rail: V3; across: V3 };
/** A tube's section: centre, tangent, its across direction (in plan) and radius across and along the side. */
type Node = { c: V3; t: V3; x: V3; a: number; b: number };

export function bones(kit: WallKit, side: WallSide): Manifold[] {
  const { points, keys } = side;
  if (!keys.length) return [];
  // Distance along the side in plan, and the side anywhere between its keys' outer corners.
  const s = [0];
  points.slice(1).forEach((p, i) => s.push(s[i] + plan(sub(p.under, points[i].under))));
  const [first, last] = [keys[0].from, keys.at(-1)!.to];
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
  // A limb under each web's middle, and in from each end that doesn't drop.
  const anchors = [
    ...(side.ends[0] !== 'drop' ? [s[first] + INSET] : []),
    ...keys.slice(1).map((k, i) => s[Math.round((keys[i].to + k.from) / 2)]),
    ...(side.ends[1] !== 'drop' ? [s[last] - INSET] : []),
  ];
  return anchors.flatMap((x, j) => {
    const h = at(x).top[2] - side.railHeight;
    if (h < LEAST) return [];
    // Each branch reaches halfway to the neighbouring limb (or the side's end).
    const reach = (n: number) => Math.min(SPREAD * h, Math.abs(n - x) / 2);
    const feet = [at(x - reach(anchors[j - 1] ?? -1e3)), at(x + reach(anchors[j + 1] ?? 1e3))];
    // The root as high on the rib, and as near x, as leaves the most branches clear.
    let best: V3[][][] = [];
    for (const d of SLIDE)
      for (const f of ROOTS) {
        const y = limb(side, at(x + d), feet, f);
        if (y.length > best.length) best = y;
        if (best.length === 2) return best.map((r) => kit.sweep(r));
      }
    return best.map((r) => kit.sweep(r));
  });
}

/** One Y, its root fraction f down the rib's outer face: a trunk forking to a branch to each foot, each branch with the trunk the sections of one tube. */
function limb(side: WallSide, spot: Spot, feet: Spot[], f: number): V3[][][] {
  const out = spot.out;
  // The root reaches INTO into the rib.
  const root = add(lerp(spot.top, spot.under, f), scale(out, R.rib - INTO));
  const lands = feet.map(({ rail: c }): V3 => [c[0], c[1], side.railHeight - INTO]);
  const mid = lerp(lands[0], lands[1], 0.5);
  // The fork: halfway down, most of the way out to the rail; leaving it towards the feet.
  const fz = side.railHeight + (root[2] - side.railHeight) * 0.5;
  const fork: V3 = [...lerp(root, mid, 0.6).slice(0, 2), fz] as V3;
  const tf = unit(add(unit(sub(mid, root)), scale(UP, -0.5)));
  const L = Math.hypot(...sub(fork, root)) / 3;
  // Leaving the rib down and out, as a bough leaves a trunk.
  const t0 = unit(add(scale(UP, -1), scale(out, LEAVE)));
  const trunk = curve([root, add(root, scale(t0, L)), sub(fork, scale(tf, L)), fork], TRUNK);
  const trunkNodes = trunk.map((n, i): Node => {
    const r = R.rib + (R.fork - R.rib) * ease(i / TRUNK);
    return { ...n, x: out, a: r, b: flare(r, i / TRUNK) };
  });
  const paths = lands.map((land, k) => {
    const M = Math.hypot(...sub(land, fork)) / 3;
    const branch = curve(
      [fork, add(fork, scale(tf, M)), add(land, scale(UP, 1.2 * M)), land],
      BRANCH,
    );
    const nodes = branch.slice(1).map((n, i): Node => {
      const u = (i + 1) / BRANCH;
      const [r0, r1, v] = u < 0.5 ? [R.fork, R.mid, 2 * u] : [R.mid, R.rail, 2 * u - 1];
      const r = r0 + (r1 - r0) * ease(v);
      // Turning from across the side to across the rail, so the foot sits on it.
      const x = unit(lerp(out, feet[k].across, ease(u)));
      return { ...n, x, a: Math.min(r, side.wall / 2 - 0.05), b: flare(r, 1 - u) };
    });
    return [...trunkNodes, ...nodes];
  });
  // Push each section out as far as a key's tile needs (smoothed along the
  // path); the trunk by the most either path needs, so the two agree.
  const pushes = paths.map((nodes) => smooth(nodes.map((n) => need(side, n, out))));
  const trunkPush = trunk.map((_, i) => Math.max(...pushes.map((p) => p[i])));
  return paths.flatMap((nodes, k) => {
    const push = pushes[k].map((p, i) => (i <= TRUNK ? trunkPush[i] : p));
    // Not if it would leave the rib or its foot.
    if (push[0] > INTO / 2 || push.at(-1)! > 0.01) return [];
    const rings = nodes.map((n, i) => ring({ ...n, c: add(n.c, scale(out, push[i])) }));
    return side.clear(over(rings)) ? [rings] : [];
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

/** A section's radius along the side, `d` (a fraction) from where its tube meets the rib or the rail. */
const flare = (r: number, d: number) => r * (1 + FLARE * Math.max(0, 1 - d / FLARE_RUN) ** 2);
const lerp = (p: V3, q: V3, f: number) => add(p, scale(sub(q, p), f));
const plan = (v: V3) => Math.hypot(v[0], v[1]);
const ease = (u: number) => u * u * (3 - 2 * u);
const GRID = [0, 0.25, 0.5, 0.75];
