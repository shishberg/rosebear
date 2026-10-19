// PROTOTYPE. Question: Which wall design should the Skeletyl have? Variants
// switchable via ?walls= on the editor.
//
// ?walls=pillars (rib pillars) and ?walls=wishbone (forked rib legs): limbs
// built as the ribs are, out of the outer side of each key's plate and down to
// the rail. A limb is the rib carried on sideways: it leaves the plate's outer
// edge in the plate (its top and underside the plate's own, so it is the
// plate's surface carried on), runs a short lip, turns down in one round of
// the ends' radius about the plate's edge (thinning from the plate to a wall,
// as an end does), so it doesn't twist, and runs down, its top now its outer
// face, to stand on the rail, its faces flush with the rail's: a rib's end
// turned to the side. Where the plate's edge isn't level, the round leaves it
// leaning along the side, and a second round, in its outer face, turns it
// upright. Its section is the rib's (laneSolid), so its edges are crisp, and
// every bend is one way, once: no blends, nothing curving out and back.
// A pillar is that, 6 mm wide, under the middle of each key's plate (one per
// plate, as arches has a pier under each); a wishbone's trunk is 8 mm wide
// and, partway down, forks into two legs 4 mm wide, each leaving the trunk on
// a slant along the side (past the viewer's crease angle, so it shows as a
// crease), turning back to upright in one round and standing on the rail.
// Below its rounds a wishbone is all in its outer face's plane, so it is drawn
// there as one shape (trunk and legs) and stood up the wall thick: the fork is
// a crisp crotch and a crisp kink each side, where the sections meet in the
// plane. Where there is no height for a fork, or a fork would come near a
// limb before it, it is a pillar.
//
// The limb comes straight down where its round puts it, at least the lip and
// the round out from the plate's edge, or further out if that clears the keys
// (tiles, switch bodies, keycap rooms and switch holes' columns: side.clear).
// Limbs are placed for every side at once, each clear of those before it, of
// the sides' ends (lips, rounds, drops and webs carried on), of the faces
// standing on the outline (drops and bands), of the tie and of the rail where
// it dips to a low drop. Where the outline doesn't reach out to a limb (it
// runs close under the plates' edges), the limb asks for it to (REACHES in
// skeletyl-walls.prototype.ts): the floor under its feet, out to their outer
// faces and on past them along the side, and on to the next limb's where that
// runs on nearly straight; and its feet's outer faces, for the outline to be
// cut back to. So the outline runs out along just that stretch, along the
// limbs' outer faces and the rail under them, and the limb comes straight
// down to it rather than curving back in.
import type { Manifold } from 'manifold-3d';
import { add, cross, dot, scale, sub, type V3 } from '../geometry';
import type { Pose, Span } from '../skeletyl';
import type { Reach, WallKit, WallSide } from '../skeletyl-walls.prototype';

/**
 * Sizes in mm: half the width (along the side) of a pillar, a wishbone's
 * trunk and each of its legs; how far a limb starts inside its plate; the
 * least lip past the plate's edge; the least straight run down to the rail;
 * how far past its feet (along the side: more than the rail is wide, so that
 * the rail's inner edge turns clear of them) and in from the plate's edge the
 * floor it asks for runs; the least gap between neighbouring limbs; the most
 * a wishbone's foot is out from its trunk's middle.
 */
const S = {
  pillar: 3,
  trunk: 4,
  leg: 2,
  into: 0.5,
  lip: 1,
  upright: 1,
  margin: 2.5,
  back: 6,
  gap: 2,
  spread: 7,
};
/** How much further out (mm) than the least a limb may come down, tried in turn, to clear the keys. */
const FURTHER = [0, 1, 2, 3, 4, 6, 8];
/** A leg's slant off upright (degrees), least first (over the viewer's 30° crease, so its side doesn't shade into the trunk's); how far down from the trunk's round to the rail the fork is, at least. */
const SLANTS = [35, 40, 45, 50, 55, 60];
const FORK = 0.4;
/** The gap side.clear keeps (mm), and a hair more. */
const GAP = 0.31;
/** The most a limb leans along the side under a sloping edge (radians), and the least it is turned upright for. */
const LEAN = (50 * Math.PI) / 180;
const STRAIGHT = 1e-4;
/** The least a pillar's straight run down to the rail (mm), where there is no height for more. */
const SHORT = 0.2;
/** How far a wishbone's rib comes straight down under its rounds before the trunk's shape takes over. */
const LAP = 1;
/** The most times the first pass places the limbs again on the outline with their floors in. */
const ROUNDS = 4;
/** The longest floor between neighbouring limbs (mm), and the most the outline turns outward at either end of it (radians). */
const BRIDGE = 30;
const BEND = (11 * Math.PI) / 180;
const DOWN: V3 = [0, 0, -1];

/** A limb: its solids' spans (the trunk, then any legs), the floor it stands on and its plan (plan polygons). */
interface Limb {
  pieces: Span[][];
  /** Its solid. */
  make: (kit: WallKit) => Manifold;
  floor: [number, number][];
  plan: [number, number][];
  /** Its feet's outer face: the middle (plan), along the side, outward, and how far along each way the floor runs. */
  foot: { g: V3; c: V3; w: V3; E: number };
  /** How far out from its plate's edge (plan) its outer face is. */
  X: number;
}

/** ?walls=wishbone: a forked limb under each key's plate (a pillar where it can't fork). */
export const wishbone = (kit: WallKit, side: WallSide) =>
  solids(kit, limbs(kit, side, true, false).limbs);
/** ?walls=pillars: a limb under each key's plate. */
export const pillars = (kit: WallKit, side: WallSide) =>
  solids(kit, limbs(kit, side, false, false).limbs);
/**
 * What the limbs ask of the outline (WallReach): floor under each limb's
 * feet, and between neighbouring limbs' where that runs on from both nearly
 * straight (bridges), so the outline runs along the side rather than in and
 * out; and their feet's outer faces, along the floor's width, for the
 * outline to be cut back to (so that it runs on under them exactly).
 */
export const ribLimbsReach = (kit: WallKit, side: WallSide, forked: boolean): Reach => {
  const { limbs: all, floors } = limbs(kit, side, forked, true);
  const faces = all.map(({ foot: { g, c, w, E } }) => [
    sub(g, scale(c, E)),
    add(g, scale(c, E)),
    w,
  ]);
  return { floors, faces };
};

function solids(kit: WallKit, limbs: Limb[]): Manifold[] {
  return limbs.map(({ make }) => make(kit));
}

/** Every side's limbs, worked out once per build (kit), forked or not, on the first pass or not. */
const made = new WeakMap<
  WallKit,
  Map<string, Map<WallSide, { limbs: Limb[]; floors: [number, number][][] }>>
>();

/**
 * Side's limbs, and the floor they ask for. They are placed for every side
 * at once, so a limb keeps clear of those on other sides too. On the first
 * pass (`reach`) the outline is the one without their floor, so the floors
 * are placed, the outline taken as it will be with them in, and the limbs
 * placed again on that until no limb moves: so that on the second pass, on
 * the outline built with them in, each limb comes down where its floor's
 * outer edge is.
 */
function limbs(kit: WallKit, side: WallSide, forked: boolean, reach: boolean) {
  const key = `${forked} ${reach}`;
  const byKit = made.get(kit) ?? made.set(kit, new Map()).get(kit)!;
  if (!byKit.has(key)) byKit.set(key, everyLimb(kit, forked, reach));
  return byKit.get(key)!.get(side) ?? { limbs: [], floors: [] };
}

function everyLimb(kit: WallKit, forked: boolean, reach: boolean) {
  const outline = kit.sides[0]?.outline ?? [];
  let rings = [outline];
  let got = place(kit, forked, rings, reach ? 'wide' : 'under');
  for (let round = 0; reach && round < ROUNDS; round++) {
    const floors = [...got.values()].flatMap((g) => g.floors);
    const section = new kit.wasm.CrossSection([outline, ...floors], 'NonZero');
    rings = section.toPolygons().map((r) => r.map((v): [number, number] => [v[0], v[1]]));
    const again = place(kit, forked, rings, 'floor');
    const moved = [...again].some(([side, g]) => {
      const was = got.get(side)!.limbs;
      return (
        g.limbs.length !== was.length || g.limbs.some((l, i) => Math.abs(l.X - was[i].X) > 1e-6)
      );
    });
    got = again;
    if (!moved) break;
  }
  return got;
}

/** Each side's limbs on the outline `rings`, in order, each kept clear of those before it. */
function place(kit: WallKit, forked: boolean, rings: [number, number][][], span: Span_) {
  const all: Limb[] = [];
  // The sides' ends (lips, rounds, drops, and webs carried on): a limb keeps clear of them too.
  const ends = kit.sides.flatMap((s) =>
    [...s.points.filter((p) => p.over === 'end'), ...s.carried.flat()].flatMap((p) =>
      [p.top, p.under].map((q): [number, number] => [q[0], q[1]]),
    ),
  );
  // And its floor keeps clear of the faces standing on the outline (drops and bands).
  const standing = kit.rib.standing.map(([a, b]) =>
    [a, b].map((p): [number, number] => [p[0], p[1]]),
  );
  // And of where the tie (if any) is filleted into the rail.
  const { CrossSection } = kit.wasm;
  const tie = kit.rib.tie.length ? new CrossSection(kit.rib.tie, 'NonZero') : undefined;
  const clear = (limb: Limb) =>
    all.every((l) => apart(l.plan, limb.plan, S.gap)) &&
    ends.every((q) => apart(limb.plan, [q], S.gap)) &&
    standing.every((f) => apart(limb.floor, f, S.gap)) &&
    !(tie && tie.intersect(new CrossSection([limb.floor], 'NonZero').offset(S.gap)).area() > 1e-6);
  return new Map(
    kit.sides.map((side) => {
      const { points, keys } = side;
      // Each key's plate: its outer top edge's middle.
      const plates = keys.map((k) => ({ k, o: lerp(points[k.from].top, points[k.to].top, 0.5) }));
      const got: Limb[] = [];
      plates.forEach((plate, i) => {
        // A wishbone's feet reach at most halfway to the next plate's middle, less half the gap.
        const room = [plates[i - 1], plates[i + 1]]
          .filter((q) => q)
          .map((q) => plan(sub(q.o, plate.o)) / 2 - S.leg - S.gap / 2);
        const spread = Math.min(S.spread, ...room);
        const tries = forked && spread >= S.leg + S.gap / 2 ? [spread, 0] : [0];
        for (const reach of tries) {
          const limb = limbAt(kit, side, plate.k, reach, rings, span);
          if (limb && clear(limb)) {
            got.push(limb);
            all.push(limb);
            return;
          }
        }
      });
      return [side, { limbs: got, floors: [...got.map((l) => l.floor), ...bridges(side, got)] }];
    }),
  );
}

/**
 * Where along the side the outline is measured, out from under a limb's
 * feet: past its floor's ends (the first pass's outline, without the
 * floors); along its floor (with them); or under the feet (the second pass).
 */
type Span_ = 'wide' | 'floor' | 'under';

/**
 * The limb out of key k's plate, forked with its feet `spread` out from its
 * middle (a pillar if 0): the first of FURTHER that clears; or none.
 */
function limbAt(
  kit: WallKit,
  side: WallSide,
  k: WallSide['keys'][number],
  spread: number,
  rings: [number, number][][],
  measure: Span_,
): Limb | undefined {
  const { points, railHeight: rail, wall } = side;
  const [t0, t1, u0] = [points[k.from].top, points[k.to].top, points[k.from].under];
  const thick = len(sub(t0, u0));
  // The plate: its normal, outward across its edge in its plane, and along
  // its edge (so that C × c = N).
  const N = unit(sub(t0, u0));
  let C = unit(cross(unit(sub(t1, t0)), N));
  if (dot(C, points[k.from].out) < 0) C = scale(C, -1);
  const c = cross(N, C);
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
  const half = spread ? S.trunk : S.pillar;
  const lean = Math.acos(Math.max(-1, Math.min(1, -dv)));
  const o = lerp(t0, t1, 0.5);
  if (cw < 0.3 || lean > LEAN || half + S.into > len(sub(t1, t0)) / 2) return undefined;
  // The round: the ends' radius, through the turn from C to d; and the
  // second, in the face, from d to straight down: the ends' radius on its inner side.
  const R = kit.rib.radius;
  const T = R * Math.tan(Math.acos(Math.max(-1, Math.min(1, dot(C, d)))) / 2);
  const Tb = lean > STRAIGHT ? (R + half) * Math.tan(lean / 2) : 0;
  // Along the side from where the outer face's top is over to the feet's middle.
  const uf = (T + Tb) * du;
  // How far out it reaches along the side (the floor), from the feet's middle.
  const reach = spread ? spread + S.leg : half;
  const E = reach + S.margin;
  // Along the side (from the edge's middle) to where the outer face's top is, X out.
  const along = (X: number) => (X / cw) * dot(C, a);
  // How far out (plan, along w from the plate's edge's middle) it comes
  // down: the least the lip and round need, or as far out as the outline
  // runs by its feet, if further.
  const least = (T + S.lip) * cw;
  const span = { wide: E + 2, floor: E, under: half }[measure];
  const n = Math.ceil(span * 2) * 2;
  const under = (X: number) =>
    Math.max(
      ...Array.from({ length: n + 1 }, (_, j) => {
        const p = add(o, scale(a, along(X) + uf - span + (2 * span * j) / n));
        return toRings(rings, sub(p, scale(w, S.back)), w) - S.back;
      }),
    );
  // (Where the feet are depends a little on how far out they are.)
  let outline = under(least);
  outline = under(Math.max(least, outline));
  if (!(outline < Infinity)) return undefined;
  for (const more of FURTHER) {
    const X = Math.max(least, outline) + more;
    const limb = build(X);
    if (limb && side.clear(limb.over)) return limb.limb;
  }
  return undefined;

  /** The limb coming down X out: it, and points over it. */
  function build(X: number) {
    const L = X / cw;
    const corner = add(o, scale(C, L));
    // Under the feet's middle, on the outer face.
    const g = add([o[0], o[1], 0], add(scale(w, X), scale(a, along(X) + uf)));
    // A pose on the outer face at u along it from the feet's middle and
    // height v, heading (du, dv), `h` wide.
    const upright = (u: number, v: number, hu: number, hv: number, h: number): Pose => {
      const tt = unit(add(scale(a, hu), [0, 0, hv]));
      return {
        p: add(add(g, scale(a, u)), [0, 0, v]),
        t: tt,
        c: cross(w, tt),
        n: w,
        half: h,
        thick: wall,
      };
    };
    const P0: Pose = { p: sub(o, scale(C, S.into)), t: C, c, n: N, half, thick };
    const P1: Pose = { ...P0, p: add(o, scale(C, L - T)) };
    const P2 = upright(T * du - uf, corner[2] + T * dv, du, dv, half);
    const P3 = Tb ? upright(0, P2.p[2] + Tb * dv - Tb, 0, -1, half) : P2;
    const top = P3.p[2];
    if (top < rail + (spread ? S.upright : SHORT)) return undefined;
    const { lineSpan, poseSpan, sidesOf } = kit.rib;
    const line = (p: Pose, q: Pose) => lineSpan(sidesOf(p, 1), sidesOf(q, 1));
    const head = [line(P0, P1), poseSpan(P1, P2, 1), ...(Tb ? [poseSpan(P2, P3, 1)] : [])];
    let pieces: Span[][];
    let make: (kit: WallKit) => Manifold;
    if (!spread) {
      pieces = [[...head, line(P3, upright(0, rail, 0, -1, half))]];
      make = (kit) => kit.rib.solid(pieces[0]);
    } else {
      // The rib comes on down LAP straight under its rounds, and what stands
      // under it starts half way along that, so that they are one, meeting
      // level (where it is exact), rather than touching.
      const P4 = upright(0, top - LAP, 0, -1, half);
      const legs = fork(P4.p[2]);
      if (!legs) return undefined;
      const rib = [...head, line(P3, P4)];
      pieces = [[...head, line(P3, upright(0, legs.bottom, 0, -1, half))], ...legs.spans];
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
          .transform([a[0], a[1], a[2], 0, 0, 0, 1, 0, w[0], w[1], w[2], 0, t[0], t[1], t[2], 1]);
        return Manifold.union([kit.rib.solid(rib), body]);
      };
    }
    // In plan: u along the side from the feet's middle and v in from their outer face.
    const at = (u: number, v: number): [number, number] => {
      const p = sub(add(g, scale(a, u)), scale(w, v));
      return [p[0], p[1]];
    };
    // The floor: under its feet, from their outer faces in past the plate's edge.
    const floor = [at(E, 0), at(-E, 0), at(-E, X + S.back), at(E, X + S.back)];
    const plate = (s: number): [number, number] => {
      const p = add(sub(o, scale(C, S.into)), scale(c, s * half));
      return [p[0], p[1]];
    };
    const planOf = [
      at(reach, 0),
      at(-reach, 0),
      plate(-Math.sign(dot(c, a)) || -1),
      plate(Math.sign(dot(c, a)) || 1),
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
    const rails = Array.from({ length: steps + 1 }, (_, j) => -E + (2 * E * j) / steps).flatMap(
      (u) =>
        [0, wall].flatMap((x) =>
          [0.1, rail].map((z) => add(add(g, scale(a, u)), add(scale(w, -x), [0, 0, z]))),
        ),
    );
    // It stands on the rail where it is level (not where it dips to a low drop).
    if (rails.some((p) => kit.rib.railTop(p[0], p[1]) < rail - 1e-3)) return undefined;
    // The keycap's room stands on the plate's top, which the limb carries on
    // out: so (as a rib's ends are not tested against their own key) its
    // points are tested no nearer under that plane than the gap kept.
    const floorOf = (p: V3) => sub(p, scale(N, Math.max(0, dot(sub(p, o), N) + GAP)));
    return {
      limb: { pieces, make, floor, plan: planOf, foot: { g, c: a, w, E }, X },
      over: [...over.map(floorOf), ...rails],
    };

    /**
     * The legs from the trunk at height up to `top` down to the rail: the
     * slant (least that fits), the fork's height, the trunk's bottom, and
     * each leg's spans; none if they don't fit.
     */
    function fork(top: number) {
      const [H, h] = [S.trunk, S.leg];
      for (const deg of SLANTS) {
        const slant = (deg * Math.PI) / 180;
        const [ca, sa] = [Math.cos(slant), Math.sin(slant)];
        // Along the leg's inner side from the crotch to the corner over its foot, and the round's reach.
        const sq = (spread - h * ca) / sa;
        const Tl = R * Math.tan(slant / 2);
        if (sq - Tl < 0.5) continue;
        // The fork no lower than its legs need, nor than FORK of the way down.
        const need = sq * ca - h * sa + Tl + S.upright;
        const zf = rail + Math.max(need, FORK * (top - rail));
        // The trunk stops a little under where each leg's outer side
        // crosses its side, inside both legs; each leg starts inside it.
        if ((2 * h) / ca - H - 0.3 <= 0) continue;
        const bottom = zf + ((2 * h) / ca - H - 0.3) / Math.tan(slant);
        const s0 = (bottom - zf + 0.3) / ca;
        if (zf + 2 * h * sa + s0 * ca > top - 0.3) continue;
        const spans = [-1, 1].map((sg) => {
          // The leg's middle at s along its inner side from the crotch.
          const mid = (s: number): [number, number] => [
            sg * (h * ca + s * sa),
            zf + h * sa - s * ca,
          ];
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
        return { bottom, spans: spans.map((x) => x.spans), paths: spans.map((x) => x.path) };
      }
      return undefined;
    }
  }
}

/**
 * Floor between neighbouring limbs' (in order along the side), from one's
 * outer face's end to the next's, where the outline turns there by no more
 * than BEND outward (so the outline's rounding of that hollow stays off the
 * feet) and the rail along it is clear.
 */
function bridges(side: WallSide, limbs: Limb[]): [number, number][][] {
  return limbs.slice(1).flatMap((b, i) => {
    const [A, B] = [limbs[i].foot, b.foot];
    // Each one's end toward the other, and the floor's outer edge between them.
    const toward = (f: Limb['foot'], q: V3) => (dot(sub(q, f.g), f.c) < 0 ? -1 : 1);
    const end = (f: Limb['foot'], s: number, back = 0) =>
      add(add(f.g, scale(f.c, s * f.E)), scale(f.w, -back));
    const [sa, sb] = [toward(A, B.g), toward(B, A.g)];
    const [p, q] = [end(A, sa), end(B, sb)];
    const run = sub(q, p);
    if (plan(run) > BRIDGE || plan(run) < 1e-3) return [];
    const d = unit(run);
    // Along each one's outer face, on toward the other: the edge must run on
    // that way, and turn outward (a hollow) by no more than BEND.
    const on = [dot(d, scale(A.c, sa)), dot(scale(d, -1), scale(B.c, sb))];
    const out = [dot(d, A.w), dot(scale(d, -1), B.w)];
    if (on.some((x) => x <= 0) || out.some((x, j) => x > on[j] * Math.tan(BEND))) return [];
    const m = Math.ceil(plan(run));
    const rails = Array.from({ length: m + 1 }, (_, j) => j / m).flatMap((f) =>
      [0, side.wall].flatMap((x) =>
        [0.1, side.railHeight].map((z) =>
          add(add(lerp(p, q, f), scale(unit(lerp(A.w, B.w, f)), -x)), [0, 0, z]),
        ),
      ),
    );
    if (!side.clear(rails)) return [];
    const [pi, qi] = [end(A, sa, S.back), end(B, sb, S.back)];
    return [[p, q, qi, pi].map((v): [number, number] => [v[0], v[1]])];
  });
}

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
const plan = (v: V3) => Math.hypot(v[0], v[1]);
