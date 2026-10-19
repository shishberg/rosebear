// PROTOTYPE. Question: Which wall design should the Skeletyl have? Variants
// switchable via ?walls= on the editor.
//
// ?walls=pillars (rib pillars) and ?walls=wishbone (forked rib legs): limbs
// built as the ribs are, out of the outer side of the webs between
// neighbouring keys and down to the rail. A limb is the rib carried on
// sideways: it leaves the web's outer edge at its middle, in the rib's plane
// there, runs a short lip, turns down in one round of the ends' radius about
// that edge (thinning from the rib to a wall, as an end does), so it doesn't
// twist, and runs down, its top now its outer face, to stand on the rail, its
// faces flush with the rail's: a rib's end turned to the side. Where the edge
// isn't level, the round leaves it leaning along the side, and a second
// round, in its outer face, turns it upright. Its section is the rib's
// (laneSolid), so its edges are crisp, and every bend is one way, once.
//
// It starts from the web's own outer edge, as the rib's mesh has it
// (WallSide.webs): its top and underside there are the edge's own points
// across its width, so it shares the rib's edges rather than cutting across
// its triangles. Its sides there are upright (square to the edge in plan),
// so they stand square on the web's face, and each stands SNAP clear of the
// face's points. It starts S.into back inside the rib, and blends into the
// lip over BLEND steps, leaving the edge along its sides.
//
// Leaving at a web, between two keys' plates, a limb keeps out of the tiles
// and switches and leaves the plates' outer edges open. So it is no wider than
// the web: its sides stay S.edge in from the plates' corners. A pillar is 6 mm
// wide and a wishbone's trunk 8 mm, or as wide as the web leaves room for; a
// web too short for a limb 4 mm wide (a leg's width) gets none, and a side
// with no such web has none: its ends already stand on the rail or hang, as
// without walls. On Swung in the inner and pinky columns each have two webs
// with room (5.7 to 7 mm long), the thumb rows none.
//
// A wishbone's trunk, partway down, forks into two legs 4 mm wide, each
// leaving the trunk at one slant, SLANT (45°) off upright, turning back to
// upright in one round and standing on the rail. Each foot is SPREAD (9 mm)
// out from the trunk's middle, no further than halfway to the next web, or
// as near that as clears (down to LEAST); the fork is then as high as the
// legs need to reach their feet at SLANT, each standing upright S.upright
// first: so its height follows from the spread wanted at the feet. Narrower
// pairs are tried, so that it forks lower, where it doesn't fit under the
// trunk's round; where none does, it is a pillar, and where no pillar
// clears, there is none. Below its rounds a wishbone is all in its outer
// face's plane, so it is drawn there as one shape (trunk and legs) and stood
// up the wall thick: the fork is a crisp crotch and a crisp kink each side.
//
// A limb in the main ribbon's way (WallKit.ribbon: it crosses the side
// within S.widest of the web's middle, or within a pillar's width for
// pillars) forks over it, on pillars too: its opening centred on the ribbon,
// its legs' inner faces RIBBON_GAP clear of it each side, and each leg
// standing upright to RIBBON_GAP over its top before it slants. Those are
// placed first, since where their feet go is the ribbon's to say. On Swung
// in the ribbon leaves under the inner column's web between its home and top
// keys.
//
// The limb comes straight down where its round puts it, at least the lip and
// the round out from the web's edge, or further out if that clears the keys
// (tiles, switch bodies, keycap rooms and switch holes' columns: side.clear).
// Limbs are placed for every side at once, each clear of those before it, of
// the sides' ends (lips, rounds, drops and webs carried on), of the faces
// standing on the outline (drops), of the tie, of the rail where it dips to a
// low drop, and of the ribbon. They stand on the straightened outline: placed
// first on the outline without them, each at least as far out as it runs
// across its feet, they ask for their feet (REACHES in
// skeletyl-walls.prototype.ts), which its hull takes in before it is
// straightened, so a straight run passes along them. Placed again on that,
// each comes down where the run meets its feet, its foot turned along the run
// (up to TURN): a pillar twisting to it all the way down, a wishbone's trunk
// over TWIST under its rounds. So each foot stands flush on the run, and the
// rail needs no step out. On Swung in the inner column's limbs can't come
// down inside the outline (their lip and round alone reach 5 to 6 mm past
// it), so its inner side runs that much further out along them.
import type { Manifold } from 'manifold-3d';
import { add, cross, dot, scale, sub, type V3 } from '../geometry';
import type { Pose, Span } from '../skeletyl';
import type { Reach, WallKit, WallSide } from '../skeletyl-walls.prototype';

/**
 * Sizes in mm: half the width (along the side) of a pillar, a wishbone's
 * trunk and each of its legs, at most (a pillar or trunk is narrower where
 * the web is short); how far a limb starts inside the rib; the least it
 * stays in from the plates' corners at the web's ends, along the edge; the
 * least lip past the web's edge; the least a wishbone's leg stands upright
 * over the rail before it slants; how
 * far past its feet (along the side: more than the rail is wide) and in from
 * the web's edge the floor round them runs, which keeps clear of the drops
 * and the tie; the least gap between neighbouring limbs; and the
 * furthest a wishbone's foot is out from its trunk's middle (over the ribbon).
 */
const S = {
  pillar: 3,
  trunk: 4,
  leg: 2,
  into: 0.5,
  edge: 0.5,
  lip: 1,
  upright: 1,
  margin: 2.5,
  back: 6,
  gap: 2,
  widest: 14,
};
/** How much further out (mm) than the least a limb may come down, tried in turn, to clear the keys. */
const FURTHER = [0, 1, 2, 3, 4, 6, 8];
/**
 * Every wishbone leg's slant off upright (degrees): well past the viewer's
 * 30° crease, so its side doesn't shade into the trunk's, and as far out as
 * down, so that a wide spread forks low, under even the short pinky webs.
 */
const SLANT = 45;
/**
 * A wishbone's legs' spread (mm, each foot's middle from the trunk's) where
 * there is room: half the 24 mm between the inner column's two webs, less
 * half the gap and a leg, so that two wishbones there each take their half.
 */
const SPREAD = 9;
/** The least spread: a leg's width and half the gap past the trunk's middle. */
const LEAST = 3;
/** How finely (mm) the ribbon's crossing of a limb's feet is found. */
const RIBBON_STEP = 0.05;
/**
 * A limb's root: how near (mm) its sides come to the edge's points, at
 * least; how far inside the rib's top and underside it starts (more than the
 * mesh's chords stand off its surface there); how far out past the edge its
 * sides stay upright; and its lanes about this far apart down its sides (the
 * ribs' SIZES.ribMesh).
 */
const SNAP = 0.15;
const SINK = 0.05;
const RISE = 0.3;
/** The least steps from a limb's root to its lip's end. */
const BLEND = 8;
/** The steepest web edge (radians) a limb's root's sides stand upright on. */
const UPRIGHT = (5 * Math.PI) / 180;
const MESH = 2;
/** The gap side.clear keeps (mm), and a hair more. */
const GAP = 0.31;
/** The most a limb leans along the side under a sloping edge (radians), and the least it is turned upright for. */
const LEAN = (50 * Math.PI) / 180;
const STRAIGHT = 1e-4;
/** The least a pillar's straight run down to the rail (mm), where there is no height for more. */
const SHORT = 0.2;
/** How far a wishbone's rib comes straight down under its rounds before the trunk's shape takes over. */
const LAP = 1;
const DOWN: V3 = [0, 0, -1];
/**
 * On the outline with the feet in, a limb's foot turns to stand along the
 * straight run under it, if that runs straight (within FLUSH, mm) across its
 * feet and is turned no more than TURN (radians) off square to it: its face
 * twists to it on the way down, as a drop's does, so it stands flush.
 */
const TURN = (5 * Math.PI) / 180;
const FLUSH = 0.02;
/** How far down (mm) a wishbone's trunk turns to the run under its rounds, before its rib comes on straight (LAP). */
const TWIST = 1;

/**
 * A limb: its solids' spans (the trunk, then any legs), the floor round its
 * feet that keeps clear of drops and the tie, its plan, and its feet (the
 * outer face's bottom edge and the rail's width in: what it asks the
 * outline's hull to take in) (plan polygons).
 */
interface Limb {
  pieces: Span[][];
  /** Its solid. */
  make: (kit: WallKit) => Manifold;
  floor: [number, number][];
  plan: [number, number][];
  feet: [number, number][];
  /** Its feet's outer face: the floor's middle (plan), along the side, outward, and how far along each way the floor runs. */
  foot: { g: V3; c: V3; w: V3; E: number };
  /** How far out from its web's edge (plan) its outer face is. */
  X: number;
  /** If it forks: the crotch's height over the rail, its legs' spreads, and whether it forks over the ribbon. */
  fork?: { height: number; legs: [number, number]; kind: Kind };
}

/** A web along a side: the points over it, from one plate's corner (from) to the next's (to), and its outer edge as the rib's mesh has it (WallSide.webs). */
interface Web {
  from: number;
  to: number;
  edge: { top: V3[]; under: V3[]; face: V3[][] };
}

/** What a limb keeps clear of besides the keys and the ribbon: in plan (`free`), and all of it (`clear`). */
interface Avoid {
  free: (plan: [number, number][]) => boolean;
  clear: (limb: Limb) => boolean;
}

/** ?walls=wishbone: a forked limb at each web (a pillar where it can't fork). */
export const wishbone = (kit: WallKit, side: WallSide) =>
  solids(kit, limbs(kit, side, true, false));
/** ?walls=pillars: a limb at each web. */
export const pillars = (kit: WallKit, side: WallSide) =>
  solids(kit, limbs(kit, side, false, false));
/** Side's limbs as built (wishbone if forked, else pillars): where each forks, and how. */
export const limbForks = (kit: WallKit, side: WallSide, forked: boolean) =>
  limbs(kit, side, forked, false).map(({ fork, foot, X, feet }) => ({ fork, foot, X, feet }));
/**
 * What the limbs ask of the outline (WallReach): their feet, for its hull to
 * take in, so that its straight runs pass along them and each foot stands
 * flush on the rail, with no floor stepping out under it.
 */
export const ribLimbsReach = (kit: WallKit, side: WallSide, forked: boolean): Reach => ({
  feet: limbs(kit, side, forked, true).map((l) => l.feet),
});

function solids(kit: WallKit, limbs: Limb[]): Manifold[] {
  return limbs.map(({ make }) => make(kit));
}

/** Every side's limbs, worked out once per build (kit), forked or not, on the first pass or not. */
const made = new WeakMap<WallKit, Map<string, Map<WallSide, Limb[]>>>();

/**
 * Side's limbs. They are placed for every side at once, so a limb keeps
 * clear of those on other sides too. On the first pass (`reach`) the outline
 * is the one without their feet, and each limb comes down at least as far
 * out as that runs across its feet; on the second the outline's hull has
 * taken in their feet, so it runs along them, and each comes down where it
 * meets it (the nearest across its feet): where it asked.
 */
function limbs(kit: WallKit, side: WallSide, forked: boolean, reach: boolean) {
  const key = `${forked} ${reach}`;
  const byKit = made.get(kit) ?? made.set(kit, new Map()).get(kit)!;
  if (!byKit.has(key))
    byKit.set(key, place(kit, forked, [kit.sides[0]?.outline ?? []], reach ? 'reach' : 'stand'));
  return byKit.get(key)!.get(side) ?? [];
}

/** Each side's limbs on the outline `rings`, one at each web in order, each kept clear of those before it. */
function place(kit: WallKit, forked: boolean, rings: [number, number][][], span: Span_) {
  const all: Limb[] = [];
  // The sides' ends (lips, rounds, drops, and webs carried on): a limb keeps clear of them too.
  const ends = kit.sides.flatMap((s) =>
    [...s.points.filter((p) => p.over === 'end'), ...s.carried.flat()].flatMap((p) =>
      [p.top, p.under].map((q): [number, number] => [q[0], q[1]]),
    ),
  );
  // And its floor keeps clear of the faces standing on the outline (drops).
  const standing = kit.rib.standing.map(([a, b]) =>
    [a, b].map((p): [number, number] => [p[0], p[1]]),
  );
  // And of where the tie (if any) is filleted into the rail.
  const { CrossSection } = kit.wasm;
  const tie = kit.rib.tie.length ? new CrossSection(kit.rib.tie, 'NonZero') : undefined;
  const free = (plan: [number, number][]) =>
    all.every((l) => apart(l.plan, plan, S.gap)) && ends.every((q) => apart(plan, [q], S.gap));
  const clear = (limb: Limb) =>
    free(limb.plan) &&
    standing.every((f) => apart(limb.floor, f, S.gap)) &&
    !(tie && tie.intersect(new CrossSection([limb.floor], 'NonZero').offset(S.gap)).area() > 1e-6);
  // A limb in the ribbon's way (within a wishbone's widest spread of its
  // web's middle, or a pillar's width) forks over it. Those are placed first,
  // since where their feet go is the ribbon's to say; then the rest, each web
  // in order, clear of them: a wishbone forks where it can, and is a pillar
  // where it can't.
  const within = forked ? S.widest : S.pillar;
  const webs = kit.sides.flatMap((side) =>
    side.keys.slice(1).map((k, i) => ({
      side,
      web: { from: side.keys[i].to, to: k.from, edge: side.webs[i] },
    })),
  );
  const at = new Map<(typeof webs)[number], Limb>();
  const passes: Kind[][] = [['over'], forked ? ['fork', 'pillar'] : ['pillar']];
  for (const kinds of passes)
    for (const x of webs)
      for (const kind of at.has(x) ? [] : kinds) {
        const limb = limbAt(kit, x.side, x.web, kind, within, rings, span, { free, clear });
        if (limb) {
          at.set(x, limb);
          all.push(limb);
          break;
        }
      }
  return new Map(
    kit.sides.map((side) => [
      side,
      webs.filter((x) => x.side === side && at.has(x)).map((x) => at.get(x)!),
    ]),
  );
}

/**
 * How the outline is measured across a limb's feet: the furthest it runs out
 * (the first pass, the outline without the feet: the feet stand on or past
 * it everywhere), or the nearest (the second, its hull through the feet:
 * where it meets them).
 */
type Span_ = 'reach' | 'stand';

/**
 * What a limb at a web is: a pillar; a fork, its legs SPREAD out each way or
 * as near that as clears; or a fork over the ribbon, its opening centred on it
 * (only where the ribbon crosses the side within `within` of the web's
 * middle, else none).
 */
type Kind = 'pillar' | 'fork' | 'over';

/**
 * The limb out of `web`'s middle, of `kind`: the first that clears (keys,
 * ribbon and `avoid`) coming down each of FURTHER out, of its legs' spreads
 * (if forked) widest first; or none.
 */
function limbAt(
  kit: WallKit,
  side: WallSide,
  web: Web,
  kind: Kind,
  within: number,
  rings: [number, number][][],
  measure: Span_,
  avoid: Avoid,
): Limb | undefined {
  const forked = kind !== 'pillar';
  const { points, railHeight: rail, wall } = side;
  // The rib's top and underside at f along the side's points (between two if f falls between).
  const along_ = (f: number, k: 'top' | 'under') => {
    const j = Math.min(Math.floor(f), points.length - 2);
    return lerp(points[j][k], points[j + 1][k], f - j);
  };
  const m = (web.from + web.to) / 2;
  const o = along_(m, 'top');
  const u0 = along_(m, 'under');
  const thick = len(sub(o, u0));
  // The rib at the web's middle: its normal, outward across its edge in its
  // plane, and along its edge (so that C × c = N).
  const N = unit(sub(o, u0));
  const e = sub(along_(Math.min(m + 1, web.to), 'top'), along_(Math.max(m - 1, web.from), 'top'));
  let C = unit(cross(unit(e), N));
  if (dot(C, points[Math.round(m)].out) < 0) C = scale(C, -1);
  const c = cross(N, C);
  // As wide as it may be, S.edge in from the plates' corners along the edge.
  // (Measured level, as its root's upright sides are: rootOf.)
  const level = sidesOf(c);
  const room =
    Math.min(...[web.from, web.to].map((j) => Math.abs(dot(sub(points[j].top, o), level)))) -
    S.edge;
  const half = Math.min(forked ? S.trunk : S.pillar, room);
  if (half < S.leg) return undefined;
  const start = rootOf(web.edge, o, C, c, half);
  // The limb's outer face, once it has turned down, is upright through the
  // edge: w out of it (level), along it level (a), and d down it square to
  // the edge. The round turns it from C to d about the edge, so it doesn't
  // twist; where the edge isn't level, d leans along the side, and a second
  // round, in the face, turns it upright.
  let w = unit([c[1], -c[0], 0]);
  if (dot(w, C) < 0) w = scale(w, -1);
  const a = cross(w, DOWN);
  const d = cross(c, w);
  const cw = dot(C, w);
  const [du, dv] = [dot(d, a), d[2]];
  const lean = Math.acos(Math.max(-1, Math.min(1, -dv)));
  if (cw < 0.3 || lean > LEAN) return undefined;
  // The round: the ends' radius, through the turn from C to d; and the
  // second, in the face, from d to straight down: the ends' radius on its inner side.
  const R = kit.rib.radius;
  const T = R * Math.tan(Math.acos(Math.max(-1, Math.min(1, dot(C, d)))) / 2);
  const Tb = lean > STRAIGHT ? (R + half) * Math.tan(lean / 2) : 0;
  // Along the side from where the outer face's top is over to the trunk's foot's middle.
  const uf = (T + Tb) * du;
  // Along the side (from the edge's middle) to where the outer face's top is, X out.
  const along = (X: number) => (X / cw) * dot(C, a);
  // Under the trunk's foot's middle, on the outer face, X out.
  const under = (X: number) => add([o[0], o[1], 0], add(scale(w, X), scale(a, along(X) + uf)));
  // Along the side from there, how far its feet reach each way (legs' spreads, or 0 for a pillar).
  const reachOf = ([sl, sr]: [number, number]) =>
    forked ? [-(sl + S.leg), sr + S.leg] : [-half, half];
  // How far out (plan, along w from the web's edge's middle) it comes
  // down: the least the lip and round need, or as far out as the outline
  // runs across its feet (measure), if further.
  const least = (T + S.lip) * cw;
  // How far out the outline is (along w) at points along the side across
  // the feet, X out: [u, out] from lo to hi.
  const acrossAt = (X: number, legs: [number, number]) => {
    const [lo, hi] = reachOf(legs);
    const n = Math.ceil(hi - lo) * 2;
    return Array.from({ length: n + 1 }, (_, j): [number, number] => {
      const u = lo + ((hi - lo) * j) / n;
      const p = add(o, scale(a, along(X) + uf + u));
      return [u, toRings(rings, sub(p, scale(w, S.back)), w) - S.back];
    });
  };
  // On the outline with the feet in, the straight run they stand on, if
  // there is one (TURN, FLUSH): how far out it is under the trunk's middle,
  // and how much further per mm along the side.
  const runAt = (X: number, legs: [number, number]) => {
    if (measure !== 'stand') return undefined;
    const pts = acrossAt(X, legs);
    const [[u0, x0], [u1, x1]] = [pts[0], pts.at(-1)!];
    const k = (x1 - x0) / (u1 - u0);
    const at = x0 - k * u0;
    return Math.abs(k) <= Math.tan(TURN) && pts.every(([u, x]) => Math.abs(at + k * u - x) <= FLUSH)
      ? { X: at, k }
      : undefined;
  };
  const outlineAt = (X: number, legs: [number, number]) => {
    const out = acrossAt(X, legs).map(([, x]) => x);
    if (measure === 'reach') return Math.max(...out);
    return runAt(X, legs)?.X ?? Math.min(...out);
  };
  // (Where the feet are depends a little on how far out they are.)
  const outlineOf = (legs: [number, number]) =>
    outlineAt(Math.max(least, outlineAt(least, legs)), legs);
  // Its feet's outer faces' bottom edge, along the side from under the
  // trunk's middle, and its inner faces' (a wall in).
  // (Turned along a run k further out per mm along the side: along it, and
  // out of it.)
  const turned = (k: number): [V3, V3] => {
    const fa = unit(add(a, scale(w, k)));
    return [fa, cross(DOWN, fa)];
  };
  const feet = (g: V3, u: number, v = 0, k = 0): V3 => {
    const [fa, fw] = turned(k);
    return add(add(g, scale(fa, u)), [-fw[0] * v, -fw[1] * v, rail]);
  };
  // Whether a foot (a leg's, at u) is clear: in plan, and of the ribbon.
  const clearAt = (g: V3, u: number, k = 0) => {
    const corners = [
      [u - S.leg, 0],
      [u + S.leg, 0],
      [u + S.leg, wall],
      [u - S.leg, wall],
    ];
    const n = Math.ceil(2 * S.leg);
    const edge = Array.from({ length: n + 1 }, (_, j) =>
      [0, wall].map((v) => feet(g, u - S.leg + (2 * S.leg * j) / n, v, k)),
    ).flat();
    return (
      avoid.free(
        corners.map(([x, v]): [number, number] => {
          const q = feet(g, x, v, k);
          return [q[0], q[1]];
        }),
      ) && kit.ribbon(edge)
    );
  };
  // Over the ribbon: where along the side (from under the trunk's middle)
  // it crosses the feet (grown by RIBBON_GAP, so its edges are where the
  // feet's inner faces may stand), and its top there; none if it doesn't
  // cross within `within`.
  const ribbonAt = (g: V3, k: number) => {
    const us: number[] = [];
    let top = -Infinity;
    for (let u = -within - S.widest; u <= within + S.widest; u += RIBBON_STEP) {
      const t = Math.max(...[0, wall].map((v) => kit.ribbonTop(feet(g, u, v, k))));
      if (t > -Infinity) [us.push(u), (top = Math.max(top, t))];
    }
    if (!us.length) return undefined;
    const [lo, hi] = [us[0] - RIBBON_STEP, us.at(-1)! + RIBBON_STEP];
    return hi < -within || lo > within ? undefined : { lo, hi, top };
  };
  // A fork over the ribbon: its opening centred on it, as wide as the
  // ribbon and its gaps, or wider if the ribbon is off to one side of the
  // trunk (so that each leg still leaves it at least LEAST out).
  const overAt = (g: V3, k = 0) => {
    const r = ribbonAt(g, k);
    if (!r) return undefined;
    const [rc, hw] = [(r.lo + r.hi) / 2, (r.hi - r.lo) / 2];
    const H = Math.max(hw, LEAST - S.leg + Math.abs(rc));
    const legs: [number, number] = [H + S.leg - rc, H + S.leg + rc];
    return legs.every((x) => x <= S.widest) && clearAt(g, -legs[0], k) && clearAt(g, legs[1], k)
      ? { legs, stand: Math.max(S.upright, r.top + 0.05 - rail) }
      : undefined;
  };
  // A fork's legs: each SPREAD out, or no further than halfway to the next
  // web along the side (less half the gap between limbs, and the leg), and
  // in from there as far as its foot needs to be clear; then each pair
  // narrower in turn, both legs at most `s` out, so that the fork comes lower.
  const spreadsAt = (g: V3): [number, number][] => {
    const webs = side.keys
      .slice(1)
      .map((k, i) => (side.keys[i].to + k.from) / 2)
      .filter((f) => f !== m)
      .map((f) => dot(sub(along_(f, 'top'), o), a));
    const [sl, sr] = [-1, 1].map((sg) => {
      const next = Math.min(...webs.filter((x) => sg * x > 0).map((x) => sg * x));
      const most = Math.min(SPREAD, next / 2 - S.gap / 2 - S.leg);
      for (let x = most; x >= LEAST; x -= 0.5) if (clearAt(g, sg * x)) return x;
      return undefined;
    });
    if (sl === undefined || sr === undefined) return [];
    const out: [number, number][] = [];
    for (let x = Math.max(sl, sr); x >= LEAST; x -= 0.5)
      out.push([Math.min(sl, x), Math.min(sr, x)]);
    return out;
  };
  let outline = outlineOf([SPREAD, SPREAD]);
  if (!(outline < Infinity)) return undefined;
  // Each of its legs' spreads to try (one for a pillar), and how high its
  // legs stand upright before they slant.
  let tries: { legs: [number, number]; stand: number }[] = [{ legs: [0, 0], stand: 0 }];
  if (forked) {
    const g = under(Math.max(least, outline));
    if (kind === 'over') {
      const over = overAt(g);
      if (!over) return undefined;
      tries = [over];
    } else tries = spreadsAt(g).map((legs) => ({ legs, stand: S.upright }));
  }
  // Each spread at each of FURTHER out in turn; on the second pass, every
  // spread standing on the run first (where it asked), narrower if its foot,
  // turned along the run, comes nearer a neighbour than it did, before any
  // further out.
  const order =
    measure === 'reach'
      ? tries.flatMap((t) => FURTHER.map((more) => ({ ...t, more })))
      : FURTHER.flatMap((more) => tries.map((t) => ({ ...t, more })));
  for (const { legs, stand, more } of order) {
    const out = forked ? outlineOf(legs) : outline;
    if (!(out < Infinity)) continue;
    const X = Math.max(least, out) + more;
    // (Over the ribbon, the legs as it crosses where they come down.)
    let at = kind === 'over' ? overAt(under(X)) : { legs, stand };
    if (!at) continue;
    // Standing on the run, turned along it (and over the ribbon, the legs
    // as it crosses where they then come down).
    const k = more || X !== out ? 0 : (runAt(X, at.legs)?.k ?? 0);
    if (k && kind === 'over') at = overAt(under(X), k);
    if (!at) continue;
    const limb = build(X, at.legs, at.stand, k);
    if (limb && kit.ribbon(limb.raw) && avoid.clear(limb.limb) && side.clear(limb.over))
      return limb.limb;
  }
  return undefined;

  /**
   * The limb coming down X out, its legs (if forked) [sl, sr] out each way,
   * standing upright `stand` above the rail, its foot turned along a run k
   * further out per mm along the side: it, and points over it (as
   * side.clear tests them, and as they are).
   */
  function build(X: number, [sl, sr]: [number, number], stand: number, k: number) {
    const L = X / cw;
    const corner = add(o, scale(C, L));
    // Under the trunk's foot's middle, on the outer face.
    const g = under(X);
    // Below its rounds, the outer face turned about the upright through g to
    // run along the run: along it, and out of it.
    const [fa, fw] = turned(k);
    // A pose on the outer face (turned, unless [a, w]) at u along it from
    // the feet's middle and height v, heading (du, dv), `h` wide.
    const upright = (
      u: number,
      v: number,
      hu: number,
      hv: number,
      h: number,
      [ea, ew]: V3[] = [fa, fw],
    ): Pose => {
      const tt = unit(add(scale(ea, hu), [0, 0, hv]));
      return {
        p: add(add(g, scale(ea, u)), [0, 0, v]),
        t: tt,
        c: cross(ew, tt),
        n: ew,
        half: h,
        thick: wall,
      };
    };
    const P0: Pose = { p: sub(o, scale(C, S.into)), t: C, c, n: N, half, thick };
    const P1: Pose = { ...P0, p: add(o, scale(C, L - T)) };
    const P2 = upright(T * du - uf, corner[2] + T * dv, du, dv, half, [a, w]);
    const P3 = Tb ? upright(0, P2.p[2] + Tb * dv - Tb, 0, -1, half, [a, w]) : P2;
    const top = P3.p[2];
    if (top < rail + (forked ? S.upright : SHORT)) return undefined;
    const { lineSpan, poseSpan, sidesOf } = kit.rib;
    const line = (p: Pose, q: Pose) => lineSpan(sidesOf(p, 1), sidesOf(q, 1));
    // From P3 (square to the side) to a pose turned to the run: ruled, its
    // lanes meshed every ribMesh or so, as they twist.
    const twist = (p: Pose, q: Pose): Span => (k ? { ...line(p, q), straight: false } : line(p, q));
    const head = [line(P0, P1), poseSpan(P1, P2, 1), ...(Tb ? [poseSpan(P2, P3, 1)] : [])];
    let pieces: Span[][];
    let forkAt: number | undefined;
    let make: (kit: WallKit) => Manifold;
    if (!forked) {
      pieces = [[...head, twist(P3, upright(0, rail, 0, -1, half))]];
      make = (kit) => limbSolid(kit, start, pieces[0].slice(1));
    } else {
      // Turned to the run (if it is turned) TWIST down; then the rib comes
      // on down LAP straight, and what stands under it starts half way along
      // that, so that they are one, meeting level (where it is exact), in
      // one plane, rather than touching.
      const Pt = k ? upright(0, top - TWIST, 0, -1, half) : P3;
      const trunk = [...head, ...(k ? [twist(P3, Pt)] : [])];
      const P4 = upright(0, Pt.p[2] - LAP, 0, -1, half);
      const legs = fork(P4.p[2], stand);
      if (!legs) return undefined;
      forkAt = legs.zf;
      const rib = [...trunk, line(Pt, P4)];
      pieces = [[...trunk, line(Pt, upright(0, legs.bottom, 0, -1, half))], ...legs.spans];
      // Under that, all of it is in the outer face's plane: so it is that
      // shape (the trunk on down to where the legs leave it, and the legs) in
      // the plane, drawn and joined there and stood up the wall thick, the
      // rib standing on it. So its sides meet in the plane, crisply, with no
      // faces lying on one another.
      make = (kit) => {
        const { CrossSection, Manifold } = kit.wasm;
        const z4 = P4.p[2] + LAP / 2;
        const shape = CrossSection.union(
          [
            [
              [-half, legs.bottom - z4],
              [half, legs.bottom - z4],
              [half, 0],
              [-half, 0],
            ] as [number, number][],
            ...legs.paths.map((path) =>
              band(
                path.map(({ p, t }): Station => ({ p: [p[0], p[1] - z4], t })),
                S.leg,
              ),
            ),
          ].map((ring) => new CrossSection([ring], 'NonZero')),
        );
        // Stood up the wall thick: (u, v, e) to P4 + u a + (v + LAP / 2) z +
        // e w, e from -wall to 0 (its outer face at e = 0, so that its edges
        // there come out exactly on the rib's).
        const t = add(P4.p, [0, 0, LAP / 2]);
        const body = shape
          .extrude(wall)
          .translate([0, 0, -wall])
          .transform([
            fa[0],
            fa[1],
            fa[2],
            0,
            0,
            0,
            1,
            0,
            fw[0],
            fw[1],
            fw[2],
            0,
            t[0],
            t[1],
            t[2],
            1,
          ]);
        return Manifold.union([limbSolid(kit, start, rib.slice(1)), body]);
      };
    }
    // In plan: u along the side from the feet's middle and v in from their outer face.
    const at = (u: number, v: number): [number, number] => {
      const p = sub(add(g, scale(fa, u)), scale(fw, v));
      return [p[0], p[1]];
    };
    // How far its feet reach each way along the side, and the floor: under
    // them, from their outer faces in past the web's edge, and S.margin on
    // past them each way.
    const [lo, hi] = reachOf([sl, sr]);
    const [fm, E] = [(lo + hi) / 2, (hi - lo) / 2 + S.margin];
    const floor = [at(fm + E, 0), at(fm - E, 0), at(fm - E, X + S.back), at(fm + E, X + S.back)];
    const root = (s: number): [number, number] => {
      const p = add(sub(o, scale(C, S.into)), scale(c, s * half));
      return [p[0], p[1]];
    };
    const planOf = [
      at(hi, 0),
      at(lo, 0),
      root(-Math.sign(dot(c, a)) || -1),
      root(Math.sign(dot(c, a)) || 1),
    ];
    // Points over it: each span's sides every mm or so, and the rail under it.
    const over = pieces.flat().flatMap((s) => {
      const [l, r] = [s.at(0), s.at(1)].map((x) => x[0][0]);
      const m = Math.max(2, Math.ceil(len(sub(l, r)) + s.steps * 2));
      return Array.from({ length: m + 1 }, (_, j) => s.at(j / m)).flatMap(([p, q]) =>
        [0, 0.25, 0.5, 0.75, 1].flatMap((f) => [lerp(p[0], q[0], f), lerp(p[1], q[1], f)]),
      );
    });
    const steps = Math.ceil(2 * E);
    const rails = Array.from({ length: steps + 1 }, (_, j) => fm - E + (2 * E * j) / steps).flatMap(
      (u) =>
        [0, wall].flatMap((x) =>
          [0.1, rail].map((z) => add(add(g, scale(fa, u)), add(scale(fw, -x), [0, 0, z]))),
        ),
    );
    // It stands on the rail where it is level (not where it dips to a low drop).
    if (rails.some((p) => kit.rib.railTop(p[0], p[1]) < rail - 1e-3)) return undefined;
    // The keycap's room stands on the plate's top, which the web curves up
    // to and the limb carries on out: so (as a rib's ends are not tested
    // against their own key) its points are tested no nearer under that
    // plane than the gap kept.
    const floorOf = (p: V3) => sub(p, scale(N, Math.max(0, dot(sub(p, o), N) + GAP)));
    return {
      limb: {
        pieces,
        make,
        floor,
        plan: planOf,
        feet: [at(hi, 0), at(lo, 0), at(lo, wall), at(hi, wall)],
        foot: { g: add(g, scale(fa, fm)), c: fa, w: fw, E },
        X,
        fork:
          forkAt === undefined
            ? undefined
            : { height: forkAt - rail, legs: [sl, sr] as [number, number], kind },
      },
      over: [...over.map(floorOf), ...rails],
      raw: over,
    };

    /**
     * The legs from the trunk at height up to `top` down to the rail, at
     * SLANT, standing upright `stand` above it: the fork's height, the
     * trunk's bottom, and each leg's spans and its middle's path in the
     * outer face's plane; none if they don't fit under `top`.
     */
    function fork(top: number, stand: number) {
      const [H, h] = [half, S.leg];
      const slant = (SLANT * Math.PI) / 180;
      const [ca, sa] = [Math.cos(slant), Math.sin(slant)];
      // Along each leg's inner side from the crotch to the corner over its foot, and the round's reach.
      const spreads = [sl, sr];
      const sqs = spreads.map((s) => (s - h * ca) / sa);
      const Tl = R * Math.tan(slant / 2);
      if (sqs.some((sq) => sq - Tl < 0.5)) return undefined;
      // The fork as high as its legs need to reach their feet at SLANT
      // (each standing upright `stand` first), the wider's: so its height
      // follows from the spread wanted at the feet.
      const zf = rail + Math.max(...sqs.map((sq) => sq * ca - h * sa + Tl + stand));
      // The trunk stops a little under where each leg's outer side
      // crosses its side, inside both legs; each leg starts inside it, its
      // end's corners a little inside the trunk's sides (a narrow trunk
      // stops lower, so that they are).
      if ((2 * h) / ca - H - 0.3 <= 0) return undefined;
      const s0 = Math.min(((2 * h) / ca - H - 0.3) / sa + 0.3 / ca, (H - 0.3) / sa);
      const bottom = Math.min(zf + ((2 * h) / ca - H - 0.3) / Math.tan(slant), zf + s0 * ca - 0.3);
      if (bottom <= zf) return undefined;
      if (zf + 2 * h * sa + s0 * ca > top - 0.3) return undefined;
      const spans = [-1, 1].map((sg, i) => {
        const [spread, sq] = [spreads[i], sqs[i]];
        // The leg's middle at s along its inner side from the crotch.
        const mid = (s: number): [number, number] => [sg * (h * ca + s * sa), zf + h * sa - s * ca];
        const [u0, v0] = mid(-s0);
        const [u1, v1] = mid(sq - Tl);
        const [, vq] = mid(sq);
        const L0 = upright(u0, v0, sg * sa, -ca, h);
        const L1 = upright(u1, v1, sg * sa, -ca, h);
        const L2 = upright(sg * spread, vq - Tl, 0, -1, h);
        const L3 = upright(sg * spread, rail, 0, -1, h);
        // Its middle in the plane, and which way it heads there.
        const slope: [number, number] = [sg * sa, -ca];
        const path: Station[] = [
          { p: [u0, v0], t: slope },
          ...arc([u1, v1], slope, [sg * spread, vq - Tl], [0, -1]),
          { p: [sg * spread, rail], t: [0, -1] },
        ];
        return { spans: [line(L0, L1), poseSpan(L1, L2, 1), line(L2, L3)], path };
      });
      return { zf, bottom, spans: spans.map((x) => x.spans), paths: spans.map((x) => x.path) };
    }
  }
}

/**
 * Where a limb starts: its web's outer edge's own points (as the rib's mesh
 * has them) across the limb's width, its top's and its underside's, each from
 * its side -1 to its side 1, and its sides' ends there. Its sides there are
 * upright (each in an upright plane square to the edge in plan), so that they
 * stand square on the web's edge face as on a flat one; each is at most
 * `half` out from the web's middle, and in from there as far as keeps it
 * SNAP clear of the edge's points. The same points again S.into back inside
 * the rib, SINK inside its top and underside (where it starts), and RISE out
 * past the edge (its sides still upright, its top and underside still the
 * web's carried on), from where it turns to the lip's section.
 */
interface Root {
  top: V3[];
  under: V3[];
  rings: [V3[], V3[]][];
  /** Which way it heads out of the web (level across the edge), and the lip's way (C). */
  out: V3;
  ahead: V3;
}
function rootOf(
  edge: { top: V3[]; under: V3[]; face: V3[][] },
  o: V3,
  C: V3,
  c: V3,
  half: number,
): Root {
  // Level along the edge, out square to that, and up square to both.
  const h = sidesOf(c);
  const out = unit(sub(C, scale(h, dot(C, h))));
  const up = cross(out, h);
  const lines = [edge.top, edge.under].map((line) =>
    line.map((p) => ({ p, x: dot(sub(p, o), h) })).sort((a, b) => a.x - b.x),
  );
  // Each side as far out as it may be, SNAP clear of the face's points (so
  // that where it crosses the face it cuts no sliver off a triangle there).
  const marks = edge.face.flat().map((p) => dot(sub(p, o), h));
  const sideAt = (sg: number) => {
    for (let x = half; x > 0; x -= 0.05)
      if (marks.every((q) => Math.abs(q - sg * x) >= SNAP)) return sg * x;
    return sg * half;
  };
  const [lo, hi] = [sideAt(-1), sideAt(1)];
  const [top, under] = lines.map((pts) => {
    const at = (x: number): V3 => {
      const j = pts.findIndex((q) => q.x > x);
      const [a, b] = [pts[j - 1], pts[j]];
      return lerp(a.p, b.p, (x - a.x) / (b.x - a.x));
    };
    return [at(lo), ...pts.filter((q) => q.x > lo && q.x < hi).map((q) => q.p), at(hi)];
  });
  const moved = (along: number, k: number) => (p: V3) =>
    add(add(p, scale(out, along)), scale(up, k));
  return {
    top,
    under,
    out,
    ahead: C,
    rings: [
      [top.map(moved(-S.into, -SINK)), under.map(moved(-S.into, SINK))],
      [top, under],
      [top.map(moved(RISE, 0)), under.map(moved(RISE, 0))],
    ],
  };
}

/**
 * A limb's solid, meshed as the ribs are (kit.rib.mesh), from its root
 * inside the rib, out through the web's edge (its points exactly the
 * edge's, so that the limb's top and underside run on from the web's along
 * the very edges the web's mesh has there, rather than near them), and on
 * along `spans` (from the first's start, the lip's end). Its lanes across the
 * top and the underside run through the edge's points, each kept at its place
 * across the limb, and down its sides as the ribs' (one every MESH or so).
 */
function limbSolid(kit: WallKit, root: Root, spans: Span[]): Manifold {
  const { along, mesh } = kit.rib;
  const [K, J] = [root.top.length - 1, root.under.length - 1];
  // Each point's place across, 0 at side -1 and 1 at side 1.
  const across = (line: V3[]) => {
    const d = unit(sub(line.at(-1)!, line[0]));
    const x = line.map((p) => dot(sub(p, line[0]), d));
    return x.map((v, k) => (k === 0 ? 0 : k === x.length - 1 ? 1 : v / x.at(-1)!));
  };
  const [at, au] = [across(root.top), across(root.under)];
  type Ring = { top: V3[]; under: V3[] };
  const ringOf = ([l, r]: [[V3, V3], [V3, V3]]): Ring => ({
    top: at.map((a) => lerp(l[0], r[0], a)),
    under: au.map((a) => lerp(l[1], r[1], a)),
  });
  const thick = Math.max(
    len(sub(root.top[0], root.under[0])),
    ...spans.map((s) => s.at(1)[0]).map(([t, u]) => len(sub(t, u))),
  );
  const v = Math.max(1, Math.ceil(thick / MESH));
  // Round the cross-section: the top from side -1 to 1, down side 1, the underside back, up side -1.
  const lanesOf = (g: Ring): V3[] => [
    ...g.top,
    ...Array.from({ length: v - 1 }, (_, j) => lerp(g.top[K], g.under[J], (j + 1) / v)),
    ...[...g.under].reverse(),
    ...Array.from({ length: v - 1 }, (_, j) => lerp(g.top[0], g.under[0], 1 - (j + 1) / v)),
  ];
  const rings = root.rings.map(([top, under]) => lanesOf({ top, under }));
  const lip = lanesOf(ringOf(spans[0].at(0)));
  const r = rings.length - 1;
  // From the root's last ring to the lip's end, each lane on one smooth
  // curve, leaving the root along its sides and arriving along the lip, so
  // that the sides turn from upright to the lip's gradually.
  const blend = (i: number) => {
    const [p, q] = [rings[r][i], lip[i]];
    const D = len(sub(q, p));
    const [m0, m1] = [scale(root.out, D), scale(root.ahead, D)];
    return (f: number): V3 => {
      const [f2, f3] = [f * f, f * f * f];
      return add(
        add(scale(p, 2 * f3 - 3 * f2 + 1), scale(m0, f3 - 2 * f2 + f)),
        add(scale(q, -2 * f3 + 3 * f2), scale(m1, f3 - f2)),
      );
    };
  };
  // The lanes down the sides (between the top's and the underside's) skip
  // the ring on the edge: the side runs on in one plane from inside the rib
  // to past its face, and the union cuts it where it crosses the face, with
  // no point of its own just off that face (the face is ruled between its
  // lanes' points, not along the side).
  const mid = (i: number) => (i > K && i < K + v) || i > K + v + J;
  const lanes = rings[0].map((_, i) => [
    ...rings.flatMap((g, k): [number, V3][] => (k === 1 && mid(i) ? [] : [[k, g[i]]])),
    ...along(blend(i), false, BLEND)
      .slice(1)
      .map(([f, p]): [number, V3] => [r + f, p]),
    ...spans.flatMap((span, s) =>
      along((f) => lanesOf(ringOf(span.at(f)))[i], span.straight, span.steps)
        .slice(1)
        .map(([f, p]): [number, V3] => [r + 1 + s + f, p]),
    ),
  ]);
  const [top, under] = root.rings[0];
  return mesh(lanes, [
    [
      [top[0], under[0]],
      [top[K], under[J]],
    ],
    spans.at(-1)!.at(1),
  ]);
}

/** Square to a limb's root's sides: level along the edge if the edge is within UPRIGHT of level, else along it (c). */
const sidesOf = (c: V3) => (Math.abs(c[2]) < Math.sin(UPRIGHT) ? unit([c[0], c[1], 0]) : c);

/** A point on a path in a plane, and which way (unit) the path heads there. */
interface Station {
  p: [number, number];
  t: [number, number];
}

/**
 * A round in a plane from p (heading t) to q (heading s): a circular arc,
 * from p to q inclusive, a station every 3 degrees or so.
 */
function arc(
  p: [number, number],
  t: [number, number],
  q: [number, number],
  s: [number, number],
): Station[] {
  const turn = Math.acos(Math.max(-1, Math.min(1, t[0] * s[0] + t[1] * s[1])));
  const left = t[0] * s[1] - t[1] * s[0] > 0 ? 1 : -1;
  // The centre: square to t from p, the radius off.
  const r = Math.hypot(q[0] - p[0], q[1] - p[1]) / (2 * Math.sin(turn / 2));
  const c = [p[0] - left * t[1] * r, p[1] + left * t[0] * r];
  const n = Math.max(1, Math.ceil(turn / ((3 * Math.PI) / 180)));
  return Array.from({ length: n + 1 }, (_, j) => {
    const f = (left * turn * j) / n;
    const [x, y] = [Math.cos(f), Math.sin(f)];
    const tt: [number, number] = [t[0] * x - t[1] * y, t[0] * y + t[1] * x];
    return j === n
      ? { p: q, t: s }
      : { p: [c[0] + left * tt[1] * r, c[1] - left * tt[0] * r], t: tt };
  });
}

/** The band `h` either side of a path in a plane (a polygon), its ends square to it. */
function band(path: Station[], h: number): [number, number][] {
  const side = (k: number) =>
    path.map(({ p, t }): [number, number] => [p[0] - k * t[1] * h, p[1] + k * t[0] * h]);
  return [...side(1), ...side(-1).reverse()];
}

/** Whether convex plan polygons a and b are at least `gap` apart (separating axes). */
function apart(a: [number, number][], b: [number, number][], gap: number) {
  return [a, b].some((poly) =>
    poly.some((p, i) => {
      const q = poly[(i + 1) % poly.length];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l < 1e-9) return false;
      const n = [(q[1] - p[1]) / l, -(q[0] - p[0]) / l];
      const proj = (r: [number, number][]) => r.map((v) => v[0] * n[0] + v[1] * n[1]);
      const [pa, pb] = [proj(a), proj(b)];
      return Math.min(...pb) - Math.max(...pa) >= gap || Math.min(...pa) - Math.max(...pb) >= gap;
    }),
  );
}

/** How far the rings' edge is from p along plan direction h: the first crossing ahead, if p is inside them. */
function toRings(rings: [number, number][][], p: V3, h: V3) {
  const ahead = rings.flatMap((ring) =>
    ring.flatMap((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const e = [b[0] - a[0], b[1] - a[1]];
      const q = [a[0] - p[0], a[1] - p[1]];
      const den = h[0] * e[1] - h[1] * e[0];
      if (Math.abs(den) < 1e-12) return [];
      const f = (h[1] * q[0] - h[0] * q[1]) / den;
      const t = (q[0] * e[1] - q[1] * e[0]) / den;
      return f >= 0 && f < 1 && t > 0 ? [t] : [];
    }),
  );
  return ahead.length % 2 ? Math.min(...ahead) : Infinity;
}

const len = (v: V3) => Math.hypot(...v);
const unit = (v: V3) => scale(v, 1 / len(v));
const lerp = (p: V3, q: V3, f: number) => add(p, scale(sub(q, p), f));
