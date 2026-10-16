// Each wire's candidate routes, nearest the tiles first, and its place in the wire port.
import { isThumb, point, type V3 } from '../geometry';
import { WIRING, distance, type Edge, type Env, type Lane, type Pad } from './common';
import type { Spec } from './specs';
import { edgeToward, ownEdge } from './port';
import type { pathsIn } from './paths';
import { tubeOf } from './tubes';
import type { Option } from './negotiate';

type Paths = ReturnType<typeof pathsIn>;

export const diameterOf = (env: Env, s: Spec) =>
  ['power', 'ground'].includes(s.net.group)
    ? env.cfg.wiring.power_wire_mm
    : env.cfg.wiring.signal_wire_mm;

const crossesPort = (s: Spec) =>
  typeof s.a === 'number' ? isThumb(s.b.key) : isThumb(s.a.key) !== isThumb(s.b.key);

/**
 * The depths a wire may run at below a tile, nearest first, by what its leg
 * on that tile does: out over the pad's own edge (a hop, just under the
 * tile), along the pads' strip past other pads (under their drops), or
 * across the tile under its parts.
 */
const legDepths = (env: Env, p: Pad, [axis, sign]: Edge, d: number) => {
  const r = d / 2;
  // Along the strip, a wire runs a step deeper for each pad it passes under
  // on its way to the edge.
  const passes = env.cfg.tile.pads.list.filter(
    (q) => Math.sign(q.at_mm[1]) === Math.sign(p.xy[1]) && sign * (q.at_mm[0] - p.xy[0]) > 1e-6,
  ).length;
  const from =
    axis === 1 && sign === Math.sign(p.xy[1])
      ? WIRING.hopDepth
      : axis === 0
        ? WIRING.stripDepth + passes * WIRING.stripStep
        : env.componentDepth + r + WIRING.depthMargin;
  return [...Array(WIRING.depthChoices).keys()].map(
    (k) => Math.max(from, r + WIRING.depthMargin) + k * WIRING.depthStep,
  );
};

/** The edge a spec's end `a` or `b` leaves its tile by, by default. */
const edgeOf = (env: Env, s: Spec, end: 'a' | 'b'): Edge => {
  const { frames, port } = env;
  const p = (end === 'a' ? s.a : s.b) as Pad;
  const other = end === 'a' ? s.b : s.a;
  if (typeof other === 'number')
    return isThumb(p.key) ? edgeToward(frames, p.key, port.outside) : ownEdge(p);
  if (isThumb(p.key) !== isThumb(other.key))
    return edgeToward(frames, p.key, isThumb(p.key) ? port.outside : port.inside);
  return edgeToward(frames, p.key, point(frames[other.key], [0, 0, 0]));
};

/**
 * A place in the wire port for each wire through it, on the side its two ends
 * lie, so the wires through it do not cross there. Returns each such spec's
 * index in `specs` and its place's index in the grid.
 */
export function assignPlaces(
  env: Env,
  specs: Spec[],
  ends: { a: Pad | V3; b: Pad }[],
  leg: Paths['leg'],
) {
  const { port, frames } = env;
  const { side, places } = env.grid;
  const placeUV = (p: V3) => [p[0] * side[0] + p[1] * side[1], p[2]];
  const toward2 = (from: V3, to: V3) => {
    const u = (to[0] - from[0]) * side[0] + (to[1] - from[1]) * side[1];
    const v = to[2] - from[2];
    const l = Math.hypot(u, v) || 1;
    return [u / l, v / l];
  };
  const throughs = specs.map((_, i) => i).filter((i) => crossesPort(specs[i]));
  const prefer = new Map(
    throughs.map((i) => {
      const s = specs[i];
      // Where each end's leg leaves its tile, at its nearest depth.
      const exit = (p: Pad, to: V3) => {
        const edge = edgeToward(frames, p.key, to);
        return leg(p, edge, legDepths(env, p, edge, diameterOf(env, s))[0]).points.at(-1)!;
      };
      const t = (isThumb(s.b.key) ? ends[i].b : ends[i].a) as Pad;
      const f =
        typeof s.a === 'number'
          ? (ends[i].a as V3)
          : exit((isThumb(s.b.key) ? ends[i].a : ends[i].b) as Pad, port.inside);
      const a = toward2(port.outside, exit(t, port.outside));
      const b = toward2(port.inside, f);
      return [i, [a[0] + b[0], a[1] + b[1]]];
    }),
  );
  const fit = (i: number, p: V3) => {
    const [u, v] = placeUV(p);
    const [a, b] = prefer.get(i)!;
    return u * a + v * b;
  };
  const placeOf = new Map<number, number>();
  const taken = new Set<number>();
  const strength = (i: number) => Math.hypot(...prefer.get(i)!);
  for (const i of [...throughs].sort((x, y) => strength(y) - strength(x))) {
    let best = -1;
    places.forEach((p, k) => {
      if (!taken.has(k) && (best < 0 || fit(i, p) > fit(i, places[best]))) best = k;
    });
    if (best < 0) break;
    taken.add(best);
    placeOf.set(i, best);
  }
  // Swap places between two wires while that suits them better.
  for (let changed = true; changed;) {
    changed = false;
    for (const i of placeOf.keys())
      for (const j of placeOf.keys()) {
        const [pi, pj] = [places[placeOf.get(i)!], places[placeOf.get(j)!]];
        if (fit(i, pj) + fit(j, pi) > fit(i, pi) + fit(j, pj) + 1e-9) {
          const k = placeOf.get(i)!;
          placeOf.set(i, placeOf.get(j)!);
          placeOf.set(j, k);
          changed = true;
        }
      }
  }
  return placeOf;
}

interface Candidate {
  lane: Lane;
  place: V3;
  rank: number;
}

/**
 * A spec's lanes, nearest the tiles first. `own` is its place in the port;
 * `wide` tries every place and depth.
 */
function candidates(env: Env, s: Spec, own: number | undefined, wide: boolean) {
  const { frames, port, hole } = env;
  const portPlaces = env.grid.places;
  const d = diameterOf(env, s);
  const isFeed = typeof s.a === 'number';
  const through = crossesPort(s);
  const db = legDepths(env, s.b, edgeOf(env, s, 'b'), d);
  const da = isFeed ? db : legDepths(env, s.a as Pad, edgeOf(env, s, 'a'), d);
  const out: Candidate[] = [];
  // Its own place in the port first, then the places next to it.
  const tries: V3[] =
    own === undefined
      ? [[0, 0, 0]]
      : [...portPlaces]
          .sort((x, y) => distance(x, portPlaces[own]) - distance(y, portPlaces[own]))
          .slice(0, wide ? portPlaces.length : WIRING.placeChoices);
  const sides = WIRING.edgeAsides.slice(0, WIRING.portAsides);
  const depthTries = wide ? WIRING.depthChoices : WIRING.longDepths;
  // A feed leaves by its pad's own edge or by the edge facing its hole.
  const home = ownEdge(s.b);
  const toward = isFeed ? edgeToward(frames, s.b.key, hole[s.a as number]) : home;
  const edges = toward[0] === home[0] && toward[1] === home[1] ? [home] : [home, toward];
  if (isFeed && !through)
    for (const [e, edge] of edges.entries()) {
      const depths = legDepths(env, s.b, edge, d);
      for (let i = 0; i < depthTries; i++)
        for (const level of WIRING.loomLevels)
          for (const aside of WIRING.asides)
            out.push({
              lane: { da: depths[i], db: depths[i], aside, level, edge },
              place: [0, 0, 0],
              rank: i + 2 * e,
            });
    }
  // Through the port, the thumb's leg leaves by the edge facing the port or
  // by its pad's own edge.
  const t = (isFeed || isThumb(s.b.key) ? s.b : s.a) as Pad;
  const facingPort = edgeToward(frames, t.key, port.outside);
  const thumbEdges = [facingPort, ownEdge(t)].filter(
    (e, k, all) => !k || e[0] !== all[0][0] || e[1] !== all[0][1],
  );
  if (isFeed)
    for (const [e, edge] of thumbEdges.entries()) {
      const depths = legDepths(env, t, edge, d);
      for (let i = 0; i < depthTries; i++)
        for (const level of WIRING.loomLevels.slice(0, WIRING.portLoomLevels))
          for (let y = 0; y < sides.length; y++)
            for (const [n, place] of tries.entries())
              out.push({
                lane: { da: depths[i], db: depths[i], aside: 0, asideB: sides[y], level, edge },
                place,
                rank: i + (y ? 1 : 0) + (n ? 1 : 0) + 2 * e,
              });
    }
  else if (through)
    for (const [e, edge] of thumbEdges.entries()) {
      const dt = legDepths(env, t, edge, d);
      const [d1, d2] = t === s.a ? [dt, db] : [da, dt];
      for (let i = 0; i < d1.length; i++)
        for (let j = 0; j < d2.length; j++)
          for (let x = 0; x < sides.length; x++)
            for (let y = 0; y < sides.length; y++)
              for (const [n, place] of tries.entries())
                out.push({
                  lane: { da: d1[i], db: d2[j], aside: sides[x], asideB: sides[y], edge },
                  place,
                  rank: i + j + (x ? 1 : 0) + (y ? 1 : 0) + (n ? 1 : 0) + 2 * e,
                });
    }
  else
    for (let i = 0; i < da.length; i++)
      for (let j = 0; j < db.length; j++)
        for (let x = 0; x < WIRING.edgeAsides.length; x++)
          for (let y = 0; y < WIRING.edgeAsides.length; y++)
            out.push({
              lane: {
                da: da[i],
                db: db[j],
                aside: WIRING.edgeAsides[x],
                asideB: WIRING.edgeAsides[y],
              },
              place: [0, 0, 0],
              rank: i + j + (x ? 1 : 0) + (y ? 1 : 0),
            });
  return out.sort((x, y) => x.rank - y.rank);
}

/**
 * Each wire's routes as options, without those that run into a tile (unless
 * all do) or shift out past the tile's pocket. A wire may also end on the
 * tile's other pad of the same name (the tile joins its two + pads, and its
 * two G pads), unshifted.
 */
export function optionsOf(
  env: Env,
  paths: Paths,
  specs: Spec[],
  ends: { a: Pad | V3; b: Pad }[],
  padsOf: (key: string, name: string) => Pad[],
  placeOf: Map<number, number>,
  wide: boolean,
): Option[][] {
  const others = (end: Pad | number): (Pad | number)[] =>
    typeof end === 'number' ? [] : padsOf(end.key, end.name).filter((p) => p !== end);
  return specs.map((s, i) => {
    const d = diameterOf(env, s);
    const all = [s.a, ...others(s.a)].flatMap((a, ka) =>
      [s.b, ...others(s.b)].flatMap((b, kb) =>
        candidates(env, { ...s, a, b: b as Pad }, placeOf.get(i), wide).flatMap(
          ({ lane, place, rank }) => {
            const { points, strayed, stuck } = paths.route(
              ka ? (a as Pad) : ends[i].a,
              kb ? (b as Pad) : ends[i].b,
              lane,
              place,
              d / 2,
            );
            if (strayed) return [];
            return {
              tube: tubeOf(points, d),
              rank: rank + (ka ? WIRING.otherPad : 0) + (kb ? WIRING.otherPad : 0),
              blocked: stuck || paths.hitsTiles(points, d / 2),
            };
          },
        ),
      ),
    );
    const clear = all.filter((o) => !o.blocked);
    return (clear.length ? clear : all.map((o) => ({ ...o, rank: o.rank + WIRING.blockedRank })))
      .sort((x, y) => x.rank - y.rank)
      .slice(0, WIRING.optionLimit);
  });
}
