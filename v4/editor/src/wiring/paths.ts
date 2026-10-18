// A wire's route: its legs off the tiles, the joins between legs, the way
// through the wire port, and the feeds' run to the adapter.
import { isThumb, point, add, type V3 } from '../geometry';
import { WIRING, distance, type Edge, type Env, type Lane, type Pad } from './common';
import { edgeToward, ownEdge } from './port';
import type { Obstacles } from './obstacles';

const clean = (points: V3[]) => points.filter((x, i) => !i || distance(x, points[i - 1]) > 1e-6);

/** From p across at height z to q's plan position, its middle shifted `aside` in plan. */
const across = (p: V3, q: V3, z: number, aside: number): V3[] => {
  const p1: V3 = [p[0], p[1], z];
  const q1: V3 = [q[0], q[1], z];
  const dx = q1[0] - p1[0];
  const dy = q1[1] - p1[1];
  const l = Math.hypot(dx, dy);
  if (!aside || l < 1e-6) return [p1, q1];
  const o = [(-dy / l) * aside, (dx / l) * aside];
  const at = (t: number): V3 => [p1[0] + dx * t + o[0], p1[1] + dy * t + o[1], z];
  return [p1, at(1 / 3), at(2 / 3), q1];
};

/** A leg, and whether its shift took it out past its tile's pocket, into the chassis. */
interface Leg {
  points: V3[];
  stray: boolean;
}
/** A run through the wire port: its points, and whether its leg strayed. */
interface PortRun {
  points: V3[];
  stray: boolean;
}
/**
 * A route, whether a leg strayed, whether a join between two keys' legs found
 * no way past the plates, and whether it runs lower than the floor allows.
 */
interface Route {
  points: V3[];
  strayed: boolean;
  stuck: boolean;
  low: boolean;
}

/** The ways a wire can be routed in `env`, with the legs and joins they share cached. */
export function pathsIn(env: Env, { blocked, plates }: Obstacles) {
  const { cfg, frames, padZ, loomZ, floorZ, half, port, grid } = env;
  const { side, axis, axisLength, places } = grid;
  const pitch = WIRING.portPitch;
  const toward = (key: string, to: V3) => edgeToward(frames, key, to);

  /**
   * A pad's way off its tile, in the tile's frame: just under the tile,
   * `aside` along the edge it heads for (axis, sign), down to `depth`, then
   * straight out to that edge. `keep` is the wire's radius: a shift further
   * out than the pocket's edge less that strays.
   */
  const makeLeg = (p: Pad, [axis, sign]: Edge, depth: number, aside: number, keep: number): Leg => {
    // Shift aside just under the tile first, so the wire's way down is clear
    // of the pad's line, where other wires run past.
    const hop = Math.min(depth, WIRING.hopDepth);
    const start: V3 = [p.xy[0], p.xy[1], padZ - hop];
    const shifted: V3 = [...start];
    shifted[1 - axis] += aside;
    const stray = Math.abs(shifted[1 - axis]) > half[1 - axis] - keep;
    const down: V3 = [shifted[0], shifted[1], padZ - depth];
    const out: V3 = [...down];
    out[axis] = sign * half[axis];
    // A shift in from the pad's own edge, toward the tile's parts, waits
    // until the wire is below them.
    const own = ownEdge(p, half);
    const inward = own[0] === 1 - axis && aside * own[1] < 0;
    const turn: V3 = inward ? [start[0], start[1], padZ - depth] : shifted;
    const points = [p.at, ...[start, turn, down, out].map((x) => point(frames[p.key], x))];
    return { points, stray };
  };
  // Many lanes share a leg: each is made once, so routes share its points
  // (and what is known about the segments between them). Callers copy before
  // changing one.
  const legs = new Map<Pad, Map<string, Leg>>();
  const leg = (p: Pad, edge: Edge, depth: number, aside = 0, keep = 0): Leg => {
    let mine = legs.get(p);
    if (!mine) legs.set(p, (mine = new Map()));
    const key = `${edge[0]} ${edge[1]} ${depth} ${aside} ${keep}`;
    let made = mine.get(key);
    if (!made) mine.set(key, (made = makeLeg(p, edge, depth, aside, keep)));
    return made;
  };

  /** A thumb pad's way out through the wire port, ending inside the finger columns. */
  const throughPort = (p: Pad, lane: Lane, place: V3, keep: number, aside = 0): PortRun => {
    const out = leg(p, lane.edge ?? toward(p.key, port.outside), lane.da, aside, keep);
    // The thumb's wires gather just off its edge facing the port, each at its
    // place's offset, so they run to the port side by side.
    const [axis, sign] = toward(p.key, port.outside);
    const centre: V3 = [0, 0, padZ - WIRING.gatherDepth];
    centre[axis] = sign * (half[axis] + WIRING.gatherOut);
    // Turn the place's offset to lie across the run from the port, the same
    // way round.
    const at = point(frames[p.key], centre);
    const run = [at[0] - port.outside[0], at[1] - port.outside[1]];
    const l = Math.hypot(run[0], run[1]);
    let across2 = [-run[1] / l, run[0] / l];
    if (across2[0] * side[0] + across2[1] * side[1] < 0) across2 = [-across2[0], -across2[1]];
    const u = place[0] * side[0] + place[1] * side[1];
    const gather: V3 = [at[0] + across2[0] * u, at[1] + across2[1] * u, at[2] + place[2]];
    return {
      points: [...out.points, gather, add(port.outside, place), add(port.inside, place)],
      stray: out.stray,
    };
  };
  /**
   * Where a wire turns after the port, on the finger side: a wire turning down
   * goes further on from a higher place, so it passes over the lower places'
   * turns, and a wire turning up goes further on from a lower place.
   */
  const lowest = Math.min(...places.map((p) => p[2]));
  const highest = Math.max(...places.map((p) => p[2]));
  const beyondPort = (place: V3, up = false): V3 => {
    const rise = up ? highest - place[2] : place[2] - lowest;
    const on = WIRING.beyondStep * Math.round(rise / (pitch * Math.sqrt(0.75)));
    return add(port.inside, [
      place[0] + (axis[0] / axisLength) * on,
      place[1] + (axis[1] / axisLength) * on,
      place[2],
    ]);
  };

  const CLEAR = 1;
  const BLOCKED = 2;
  // From a higher leg's run out to its tile's edge, the places to climb down
  // from: along the run, then stepped back toward its key's centre.
  const climbs = new Map<
    V3[],
    { runs: V3[]; tops: V3[]; ups: Uint8Array; downs: Map<number, Uint8Array> }
  >();
  const climbOf = (h: V3[], own: V3) => {
    let c = climbs.get(h);
    if (c) return c;
    const [from, to] = [h.at(-2)!, h.at(-1)!];
    const runs: V3[] = [];
    const tops: V3[] = [];
    for (let back = 0; back <= WIRING.climbBack; back += WIRING.climbBackStep)
      for (let t = 1; t >= 0; t -= WIRING.climbRunStep) {
        const run: V3 = [0, 1, 2].map((k) => from[k] + (to[k] - from[k]) * t) as V3;
        const d = Math.hypot(own[0] - run[0], own[1] - run[1]) || 1;
        runs.push(run);
        tops.push([
          run[0] + ((own[0] - run[0]) / d) * back,
          run[1] + ((own[1] - run[1]) / d) * back,
          run[2],
        ]);
      }
    climbs.set(h, (c = { runs, tops, ups: new Uint8Array(runs.length), downs: new Map() }));
    return c;
  };
  /**
   * The way between two keys' legs: straight across, or where that runs into a
   * tile or plate, down from the higher one first.
   */
  const join = (p: V3[], q: V3[], ca: V3, cb: V3): { points: V3[]; stuck: boolean } => {
    const done = (points: V3[]) => ({ points, stuck: false });
    // Straight across between the legs' ends, or, where that runs into a
    // tile (a key much higher than its neighbour, beside it), straight down
    // from the higher end first, then across.
    const [pe, qe] = [p.at(-1)!, q.at(-1)!];
    const r = cfg.wiring.power_wire_mm / 2;
    const clear = (a: V3, b: V3) => !blocked(a, b, r) && !blocked(a, b, r, plates);
    const qr = [...q].reverse();
    if (clear(pe, qe)) return done(clean([...p, ...qr]));
    // Down from the higher key's leg as it heads out under its tile: from
    // the last place along its run to the edge where the way down misses the
    // lower key's tile and plate, or failing that, from a step back in under
    // the higher tile toward its centre; then across.
    const [h, l, own] = pe[2] > qe[2] ? [p, q, cb] : [q, p, ca];
    const end = l.at(-1)!;
    // The places to climb from, and which ways down from them are clear, are
    // the same for every lower leg the higher one meets: found once.
    const c = climbOf(h, own);
    let downs = c.downs.get(end[2]);
    if (!downs) c.downs.set(end[2], (downs = new Uint8Array(c.runs.length)));
    for (let i = 0; i < c.runs.length; i++) {
      const [run, top] = [c.runs[i], c.tops[i]];
      if (!c.ups[i]) c.ups[i] = clear(run, top) ? CLEAR : BLOCKED;
      if (c.ups[i] === BLOCKED) continue;
      const foot: V3 = [top[0], top[1], end[2]];
      if (!downs[i]) downs[i] = clear(top, foot) ? CLEAR : BLOCKED;
      if (downs[i] === BLOCKED) continue;
      if (clear(foot, end)) {
        const way = [...h.slice(0, -1), run, top, foot, ...[...l].reverse()];
        return done(clean(h === p ? way : way.reverse()));
      }
    }
    // Or round a corner in plan, along one key's edge and then the other's.
    const mid = (pe[2] + qe[2]) / 2;
    for (const c of [
      [pe[0], qe[1], mid],
      [qe[0], pe[1], mid],
    ] as V3[])
      if (clear(pe, c) && clear(c, qe)) return done(clean([...p, c, ...qr]));
    // Or under both ends: down from each, and across below them.
    for (let d = 1; d <= WIRING.climbUnder; d += WIRING.climbUnderStep) {
      const z = Math.max(Math.min(pe[2], qe[2]) - d, loomZ);
      const [a, b]: V3[] = [
        [pe[0], pe[1], z],
        [qe[0], qe[1], z],
      ];
      if (clear(pe, a) && clear(a, b) && clear(b, qe)) return done(clean([...p, a, b, ...qr]));
    }
    return { points: clean([...p, ...qr]), stuck: true };
  };
  // Many lanes share the same two legs, and the way between them.
  const joins = new Map<V3[], Map<V3[], { points: V3[]; stuck: boolean }>>();
  const joined = (p: V3[], q: V3[], ca: V3, cb: V3) => {
    let mine = joins.get(p);
    if (!mine) joins.set(p, (mine = new Map()));
    let j = mine.get(q);
    if (!j) mine.set(q, (j = join(p, q, ca, cb)));
    return j;
  };

  /**
   * A route for a wire of radius `keep` in `lane`, through the wire port at
   * `place`. `a` is a pad, or for a feed the point at the adapter's hole.
   */
  const routeOf = (
    a: Pad | V3,
    b: Pad,
    lane: Lane,
    place: V3,
    keep: number,
  ): Omit<Route, 'low'> => {
    if (Array.isArray(a)) {
      let strayed: boolean;
      let path: V3[];
      if (isThumb(b.key)) {
        const t = throughPort(b, lane, place, keep, lane.asideB);
        [path, strayed] = [[...t.points, beyondPort(place)], t.stray];
      } else {
        const l = leg(b, lane.edge ?? ownEdge(b, half), lane.da, lane.aside, keep);
        [path, strayed] = [l.points, l.stray];
      }
      const end = path.at(-1)!;
      const z = loomZ + (lane.level ?? 0) * WIRING.loomStep;
      const points = clean([...path, ...across(end, a, Math.min(z, end[2]), lane.aside), a]);
      return { points: points.reverse(), strayed, stuck: false };
    }
    if (isThumb(a.key) === isThumb(b.key)) {
      const ca = point(frames[b.key], [0, 0, 0]);
      const cb = point(frames[a.key], [0, 0, 0]);
      const p = leg(a, toward(a.key, ca), lane.da, lane.aside, keep);
      const q = leg(b, toward(b.key, cb), lane.db, lane.asideB ?? lane.aside, keep);
      const j = joined(p.points, q.points, ca, cb);
      return { points: j.points, strayed: p.stray || q.stray, stuck: j.stuck };
    }
    // The lane's first depth and aside are for a's leg, the second for b's.
    const [t, f] = isThumb(a.key) ? [a, b] : [b, a];
    const [dt, df] = t === a ? [lane.da, lane.db] : [lane.db, lane.da];
    const [st, sf] = t === a ? [lane.aside, lane.asideB] : [lane.asideB, lane.aside];
    const path = throughPort(t, { ...lane, da: dt }, place, keep, st);
    const fl = leg(f, toward(f.key, port.inside), df, sf, keep);
    const q = [...fl.points].reverse();
    const points = clean([
      ...path.points,
      beyondPort(place, q[0][2] > place[2] + port.inside[2]),
      ...q,
    ]);
    return {
      points: isThumb(a.key) ? points : points.reverse(),
      strayed: path.stray || fl.stray,
      stuck: false,
    };
  };

  /**
   * A route for a wire of radius `keep`, as routeOf, and whether it runs too
   * low: its underside below the floor's top anywhere. Its segments are
   * straight, so its points are its lowest.
   */
  const route = (a: Pad | V3, b: Pad, lane: Lane, place: V3, keep: number): Route => {
    const r = routeOf(a, b, lane, place, keep);
    return { ...r, low: r.points.some((p) => p[2] - keep < floorZ - 1e-9) };
  };

  // Many routes share segments (their legs), so each segment is tested once.
  const tested = new Map<number, Map<V3, Map<V3, boolean>>>();
  /** Whether a route runs into a tile or its parts (its drops at the pads excepted). */
  const hitsTiles = (points: V3[], r: number) => {
    let byR = tested.get(r);
    if (!byR) tested.set(r, (byR = new Map()));
    for (let i = 2; i < points.length - 1; i++) {
      const [p, q] = [points[i - 1], points[i]];
      let from = byR.get(p);
      if (!from) byR.set(p, (from = new Map()));
      let hit = from.get(q);
      if (hit === undefined) from.set(q, (hit = blocked(p, q, r)));
      if (hit) return true;
    }
    return false;
  };
  return { leg, route, hitsTiles };
}
