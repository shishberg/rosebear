// PROTOTYPE. Question: How should the Skeletyl support its hanging rib ends?
// Variants switchable via ?ends= on the editor.
//
// ?ends=arch (span arch): the hanging ends ride on arches, as a bridge's deck
// on its arch. Each arch is an upright web a wall thick (wall - 0.1), standing
// under the ends it carries. Its top (the extrados) runs under their bottoms,
// INTO up into them. At a foot it curves down in plan and elevation, from
// level to upright, to land square across the rail, just inside the outline.
// Its underside (the intrados) is a multifoil arch: half-elliptical lobes
// springing upright from the rail's inner edge (or from inside a drop), a lobe
// under each front, meeting in cusps that hang CUSP below the arch ring under
// the gaps between fronts. Each lobe is raised as high as keeps the ring at
// least RING deep, so the web is a slender band at the crowns and deepens into
// a big rampant lobe toward each foot. The floor beneath stays open for the
// wires.
//
// The finger fronts side by side share one arch. Its top runs straight under
// each front (sloping a little, POKE at most, as its neighbours' heights do)
// between anchors INSET in from the front's sides. Between fronts it is a cubic
// tangent to both, which may leave or join a run up to CUT back, turn more
// sharply (STIFF) or sag to clear the keys; where it can't, the run parts. At a
// run's end, a front that drops is an abutment: the arch runs on under its
// bottom, inside the drop, and springs there. A hanging front at the end
// carries the arch on down to the rail, by the shortest clear way in a fan
// about straight on (or to the nearest rail). If neither works the arch is
// cantilevered from its other foot, its last lobe sweeping up to a tapered
// nose. Every other hanging end (the thumb rows', and any front left out) gets
// a half arch of its own. Its crown runs under the end's whole bottom, the way
// it goes; from there it comes down to the nearest rail it can reach clear,
// with a quarter-elliptical lobe under it and a nose at the crown end.
//
// Clearance: every stretch of top is first tested as a band RING deep, then
// each station of the web is probed for how far down its faces stay clear. The
// intrados humps smoothly over anything that comes higher than the arch, and
// the whole web's faces are tested again at the end. A web that isn't clear is
// left out (the run's fronts then get half arches of their own).
import type { Manifold } from 'manifold-3d';
import { add, cross, dot, scale, sub, unit, type V3 } from '../geometry';
import {
  INTO,
  type EndsFrame,
  type EndsKit,
  type RailSpot,
  type RibEnd,
} from '../skeletyl-ends.prototype';

/** The arch ring's least depth (mm) between the extrados and the intrados. */
const RING = 4;
/** The anchors under a front are at least INSET (mm) in from its sides, further in steps of INSET_STEP where a key is in the way, along at least SHORTEST of it. */
const [INSET, INSET_STEP, SHORTEST] = [3, 2, 4];
/** The most (mm) the top rises into, or drops below, a front's bottom at its anchors. */
const POKE = 1.5;
/** A link between fronts sags in steps of this much (mm) to clear the keys. */
const SAG = 1.5;
/** A link may leave or join a run up to CUT (mm) back from its anchor. */
const CUT = 8;
/** How stiffly a link holds its ends' headings (see curve), in the order tried. */
const STIFF = [1, 1.6, 2.2];
/** How many ways down to the rail each end of a run tries (the shortest clear). */
const TRIES = 4;
/** The ways a run's foot may go, turned from straight on by up to FAN (radians) in FAN_STEPS steps each way. */
const [FAN, FAN_STEPS] = [Math.PI / 2.5, 5];
/** Sections are at most STEP (mm) apart in plan, and closer where the extrados is steep. */
const STEP = 1;
/** Face points for the clear test are at most this far (mm) apart. */
const PROBE = 1.6;
/** A hump over something under the top falls 3 mm in this far (mm) each side. */
const HUMP = 3;
/** How far (mm) the cusps hang below the arch ring. */
const CUSP = 3;
/** How far back (mm) from a free end its intrados sweeps up to the nose. */
const TAPER = 8;
const Z: V3 = [0, 0, 1];

/** A web's top edge: plan points (z 0), the cumulative plan distance `s` along them, and the top's height at each. */
type Path = { p: V3[]; s: number[]; z: number[] };
/** How a web ends: on the rail or inside a drop, the intrados springing `spring` along the path (from its start); or free (the intrados's crown there). */
type Foot = { kind: 'rail' | 'drop'; spring: number } | { kind: 'free' };
/** A web: its top, and its intrados's height by distance along it. */
type Web = { path: Path; intrados: (u: number) => number };

export function arch(kit: EndsKit, frame: EndsFrame): Manifold[] {
  const { fronts, wall, rail, toPinky } = frame;
  const base = rail.height - INTO;
  const w = wall - 0.1;
  const n = fronts.length;
  const clear = (web: Web) => frame.clear(faces(webSections(web, w)));
  const band = (path: Path): Web => {
    const top = topOf(path);
    return { path, intrados: (u) => top(u) - RING };
  };

  // How the top runs under each front: along it toward the pinky, sloping as
  // its neighbours' heights do, POKE at most above or below the bottom at the
  // anchors (as the beam).
  const tops = fronts.map((e) => add(e.centre, [0, 0, INTO]));
  const halves = fronts.map((e) => dist(e.bottom.outer[0], e.bottom.outer[1]) / 2);
  const dirs = fronts.map((e, i) => {
    const [p, q] = [tops[Math.max(0, i - 1)], tops[Math.min(n - 1, i + 1)]];
    const most = POKE / (halves[i] - INSET);
    const slope = Math.max(-most, Math.min(most, (q[2] - p[2]) / plan2(sub(q, p))));
    return add(scale(e.across, dot(e.across, toPinky) < 0 ? -1 : 1), [0, 0, slope]);
  });
  // Under each front: as little in from each side as keeps a band clear.
  const under = fronts.map((_, i) => {
    const [c, half] = [tops[i], halves[i]];
    const insets = [];
    for (let x = INSET; x <= 2 * half - SHORTEST - INSET; x += INSET_STEP)
      for (let y = INSET; x + y <= 2 * half - SHORTEST; y += INSET_STEP) insets.push([x, y]);
    insets.sort((p, q) => p[0] + p[1] - q[0] - q[1]);
    for (const [x, y] of insets) {
      const [a, b] = [add(c, scale(dirs[i], x - half)), add(c, scale(dirs[i], half - y))];
      const run = curve(a, dirs[i], b, dirs[i], 0);
      if (clear(band(run))) return run;
    }
  });
  // Between neighbouring fronts: leaving one's run and joining the next's as
  // near their ends as it can (a run cut back by up to CUT), as little sagged
  // and stiffened as clears the keys; or none. `cut` is how far each run is
  // cut back.
  const links = fronts.slice(1).map((_, i) => {
    const [u, v] = [under[i], under[i + 1]];
    if (!u || !v) return undefined;
    const cuts = [];
    for (let x = 0; x <= Math.min(CUT, u.s.at(-1)! - SHORTEST); x += INSET_STEP)
      for (let y = 0; y <= Math.min(CUT, v.s.at(-1)! - SHORTEST); y += INSET_STEP)
        cuts.push([x, y]);
    cuts.sort((p, q) => p[0] + p[1] - q[0] - q[1]);
    for (let s = 0; s <= 12; s += SAG)
      for (const [x, y] of cuts)
        for (const stiff of STIFF) {
          const a = add(point(u, -1), scale(dirs[i], -x));
          const b = add(point(v, 0), scale(dirs[i + 1], y));
          const path = curve(a, dirs[i], b, dirs[i + 1], s, stiff);
          if (Math.min(...path.z) - RING < base + 2) continue;
          if (clear(band(path))) return { path, cut: [x, y] };
        }
  });
  // Front k's run, cut back for its links (in a run of fronts i to j).
  const runOf = (k: number, i: number, j: number) => {
    const [u, x, y] = [under[k]!, k > i ? links[k - 1]!.cut[1] : 0, k < j ? links[k]!.cut[0] : 0];
    const d = dirs[k];
    return curve(add(point(u, 0), scale(d, x)), d, add(point(u, -1), scale(d, -y)), d, 0);
  };
  // The ways down from the top's end A (heading `way` in plan, rising
  // `slope` per mm) to the rail whose bands are clear, shortest first: a fan
  // of ways about straight on, and to the nearest rail.
  const descents = (A: V3, way: V3, slope: number) => {
    const ways = [...Array(2 * FAN_STEPS + 1).keys()].map((k) =>
      turn(way, (FAN * (k - FAN_STEPS)) / FAN_STEPS),
    );
    return [...ways.map((h) => frame.railAlong(A, h)), frame.railNear(A)]
      .flatMap((R) => descent(A, way, slope, R, wall, base) ?? [])
      .sort((p, q) => length(p) - length(q))
      .filter((f) => clear(band(f)))
      .slice(0, TRIES);
  };
  /**
   * The web along `path` with `feet`, its intrados fitted (see archOf) above
   * whatever of the keys is under its top: at each station, how far down
   * from the top its faces stay clear. None if no arch fits or it's not clear.
   */
  const fit = (path: Path, feet: [Foot, Foot], cusps: number[] = []): Web | undefined => {
    const top = topOf(path);
    const lowest = stations(path, top).map((u) => {
      const { p, d } = along(path, u);
      const nrm = scale(cross(Z, d), w / 2);
      const T = top(u);
      const down = (depth: number) =>
        [...Array(Math.ceil(depth / 0.6) + 1).keys()].flatMap((k) => {
          const z = T - Math.min(depth, k * 0.6);
          return [add(p, nrm), sub(p, nrm)].map((q): V3 => [q[0], q[1], z]);
        });
      let [lo, hi] = [0, T - base + 1];
      if (frame.clear(down(hi))) return [u, base - 1];
      while (hi - lo > 0.3) {
        const mid = (lo + hi) / 2;
        if (frame.clear(down(mid))) lo = mid;
        else hi = mid;
      }
      return [u, T - lo];
    });
    const intrados = archOf(feet, path.s.at(-1)!, base, top, lowest, cusps);
    const web = intrados && { path, intrados };
    return web && clear(web) ? web : undefined;
  };

  const webs: Web[] = [];
  const carried = new Set<RibEnd>();
  // The fronts in runs: consecutive fronts the top passes under, joined by
  // clear links.
  for (let i = 0; i < n; i++) {
    if (!under[i]) continue;
    let j = i;
    while (j < n - 1 && links[j] && under[j + 1]) j++;
    const run = fronts.slice(i, j + 1);
    if (run.some((f) => f.finish === 'hang')) {
      const web = span(i, j);
      if (web) {
        webs.push(web);
        run.forEach((f) => carried.add(f));
      }
    }
    i = j;
  }
  // The web under fronts i to j: at each end into its drop, or down to the
  // rail, or free (in that order of preference, the shortest way down first).
  // None if no arch fits with a foot at either end.
  function span(i: number, j: number): Web | undefined {
    const runs = [...Array(j - i + 1).keys()].map((k) => runOf(i + k, i, j));
    const pieces = runs.flatMap((run, k) => [...(k ? [links[i + k - 1]!.path] : []), run]);
    const middle = join(pieces);
    // The intrados's cusps: midway along each link, from the start of middle.
    const cusps = pieces.flatMap((piece, k) => {
      const before = pieces.slice(0, k).reduce((sum, p) => sum + p.s.at(-1)!, 0);
      return k % 2 ? [before + piece.s.at(-1)! / 2] : [];
    });
    // Each end's options: [the way down (none into a drop or free), its foot].
    const options = ([0, 1] as const).map((side) => {
      const [k, run] = side ? [j, runs.at(-1)!] : [i, runs[0]];
      const free: [Path | undefined, Foot] = [undefined, { kind: 'free' }];
      // In a drop the arch springs where the top passes out from under it.
      if (fronts[k].finish === 'drop')
        return [
          [undefined, { kind: 'drop', spring: run.s.at(-1)! }] as [Path | undefined, Foot],
          free,
        ];
      const way = side ? dirs[k] : scale(dirs[k], -1);
      const downs = descents(point(middle, side ? -1 : 0), plan(way), Math.min(0, way[2]));
      return [
        ...downs.map((d): [Path | undefined, Foot] => [d, { kind: 'rail', spring: wall - 0.2 }]),
        free,
      ];
    });
    for (const [d0, f0] of options[0])
      for (const [d1, f1] of options[1]) {
        if (f0.kind === 'free' && f1.kind === 'free') continue;
        const path = join([...(d0 ? [reverse(d0)] : []), middle, ...(d1 ? [d1] : [])]);
        const L = path.s.at(-1)!;
        // Springs are measured in from each end.
        const feet = [f0, f1].map((f, side): Foot =>
          f.kind === 'free' ? f : { ...f, spring: side ? L - f.spring : f.spring },
        );
        const offset = d0 ? d0.s.at(-1)! : 0;
        const web = fit(
          path,
          [feet[0], feet[1]],
          cusps.map((c) => c + offset),
        );
        if (web) return web;
      }
  }

  // The rest of the hanging ends: a half arch each, its crown under the
  // end's bottom, down to the nearest rail it can reach clear.
  for (const e of frame.hanging.filter((x) => !carried.has(x))) {
    const top = add(e.centre, [0, 0, INTO]);
    const ways = [...Array(24).keys()].map((k) => turn([1, 0, 0], (k * Math.PI) / 12));
    const tries = [...ways.map((h) => frame.railAlong(top, h)), frame.railNear(top)].flatMap(
      (R) => {
        const h = plan(sub(R.centre, top));
        // The crown runs under the bottom's whole extent this way.
        const W = dist(e.bottom.outer[0], e.bottom.outer[1]);
        const half = (Math.abs(dot(h, e.across)) * W + Math.abs(dot(h, e.out)) * wall) / 2 - 0.5;
        const crown = curve(add(top, scale(h, -half)), h, add(top, scale(h, half)), h, 0);
        const d = descent(point(crown, -1), h, 0, R, wall, base);
        return d ? [join([crown, d])] : [];
      },
    );
    for (const path of tries.sort((p, q) => length(p) - length(q))) {
      if (!clear(band(path))) continue;
      const web = fit(path, [
        { kind: 'free' },
        { kind: 'rail', spring: path.s.at(-1)! - (wall - 0.2) },
      ]);
      if (web) {
        webs.push(web);
        break;
      }
    }
  }
  return webs.map((web) => kit.sweep(webSections(web, w)));
}

/**
 * The top from A (heading `way` in plan, rising `slope` per mm) curving down
 * to land upright on rail spot R, arriving square across it, its end just
 * inside the outline: in plan a cubic tangent to both headings, in elevation
 * a cubic from A's slope to straight down. None if it would turn back.
 */
function descent(
  A: V3,
  way: V3,
  slope: number,
  R: RailSpot,
  wall: number,
  base: number,
): Path | undefined {
  const F = add(R.centre, scale(R.out, wall / 2 - 0.5));
  const Ap: V3 = [A[0], A[1], 0];
  const run = dist2(Ap, F);
  if (run < 2 || dot(sub(F, Ap), way) <= 0 || dot(sub(F, Ap), R.out) <= 0) return undefined;
  const N = 80;
  const pl = [...Array(N + 1).keys()].map((j) =>
    hermite(Ap, scale(way, run), F, scale(R.out, run), j / N),
  );
  for (let j = 1; j < N; j++)
    if (dot(sub(pl[j + 1], pl[j]), sub(pl[j], pl[j - 1])) <= 0) return undefined;
  const s = cumulative(pl);
  const L = s.at(-1)!;
  // The elevation: (distance along, height), a cubic from A to the rail.
  const drop = A[2] - base;
  const prof = [...Array(N + 1).keys()].map((j) => {
    const q = hermite(
      [0, A[2], 0],
      [1.2 * L, 1.2 * L * slope, 0],
      [L, base, 0],
      [0, -1.2 * drop, 0],
      j / N,
    );
    return [Math.max(0, Math.min(L, q[0])), q[1]];
  });
  return { p: pl, s, z: s.map((u) => interp(prof, u)) };
}

/** The top of a path, by distance along it. */
function topOf(path: Path) {
  const rows = path.s.map((x, i) => [x, path.z[i]]);
  return (u: number) => interp(rows, u);
}
/** Where a web's sections go along its path: every STEP, and closer where the top is steep. */
function stations(path: Path, top: (u: number) => number): number[] {
  const L = path.s.at(-1)!;
  const us = [0];
  while (us.at(-1)! < L - 1e-6) {
    const u = us.at(-1)!;
    let h = Math.min(STEP, L - u);
    while (h > 0.1 && Math.abs(top(u + h) - top(u)) > 1.2) h /= 2;
    us.push(Math.min(L, u + h));
  }
  return us;
}

/** A web's sections: at each station a vertical rectangle `w` thick square to the path, from its top down to the intrados. */
function webSections(web: Web, w: number): V3[][] {
  const { path, intrados } = web;
  const top = topOf(path);
  return stations(path, top).map((u) => {
    const { p, d } = along(path, u);
    const nrm = cross(Z, d);
    const T = top(u);
    const B = Math.min(intrados(u), T - 0.8);
    const [l, r] = [add(p, scale(nrm, w / 2)), add(p, scale(nrm, -w / 2))];
    return [
      [l[0], l[1], T],
      [r[0], r[1], T],
      [r[0], r[1], B],
      [l[0], l[1], B],
    ];
  });
}

/**
 * The intrados, by distance along the web (length L): a multifoil arch, a
 * lobe between each two of its knots: its feet (springing upright from
 * `base` on the rail or inside a drop) and its cusps (hanging CUSP below the
 * ring, under the links between fronts). Each lobe is half an ellipse on the
 * chord between its knots, raised as high as keeps it at least RING below
 * the top (less where the top comes down to a foot: half its height above
 * base there); a lobe ending at a free end is a quarter, level there. Where
 * something under the top (`lowest`, by station) comes higher, the intrados
 * rises over it in a smooth hump; at a free end it sweeps up to a tapered
 * nose. None if it can't keep 0.8 mm below the top.
 */
function archOf(
  feet: [Foot, Foot],
  L: number,
  base: number,
  top: (u: number) => number,
  lowest: number[][],
  cusps: number[],
): ((u: number) => number) | undefined {
  const [f0, f1] = feet;
  const a = f0.kind === 'free' ? 0 : f0.spring;
  const b = f1.kind === 'free' ? L : f1.spring;
  const most = (u: number) => top(u) - Math.min(RING, (top(u) - base) / 2);
  const knots = [a, ...cusps.filter((c) => c > a + 4 && c < b - 4), b];
  // Each knot's height: a foot's base, a cusp's CUSP below the ring; a free
  // end's, its neighbour's (the lobe's chord level).
  const zs = knots.map((u, k) =>
    (k === 0 && f0.kind !== 'free') || (k === knots.length - 1 && f1.kind !== 'free')
      ? base
      : Math.max(base, most(u) - CUSP),
  );
  if (f0.kind === 'free') zs[0] = zs[1] ?? base;
  if (f1.kind === 'free') zs[zs.length - 1] = zs.at(-2) ?? base;
  if (knots.length === 2 && (f0.kind === 'free') !== (f1.kind === 'free')) zs.fill(base);
  const lobes = knots.slice(1).map((u1, k) => {
    const [u0, z0, z1] = [knots[k], zs[k], zs[k + 1]];
    // The lobe's shape (0 at its knots, 1 at its crown) from t, 0 to 1 along it.
    const crownAt =
      k === 0 && f0.kind === 'free' ? 0 : k === knots.length - 2 && f1.kind === 'free' ? 1 : 0.5;
    const shape = (t: number) => {
      const r = crownAt === 0.5 ? 2 * t - 1 : crownAt - t;
      return Math.sqrt(Math.max(0, 1 - r * r));
    };
    const chord = (t: number) => z0 + (z1 - z0) * t;
    const ts = [...Array(121).keys()].map((j) => j / 120);
    const rise = Math.min(
      ...ts.map((t) => {
        const f = shape(t);
        return f > 0.05 ? (most(u0 + (u1 - u0) * t) - chord(t)) / f : Infinity;
      }),
    );
    return { u0, u1, at: (t: number) => chord(t) + Math.max(0, rise) * shape(t) };
  });
  const arch = (u: number) => {
    if (u <= a) return f0.kind === 'free' ? lobes[0].at(0) : base;
    if (u >= b) return f1.kind === 'free' ? lobes.at(-1)!.at(1) : base;
    const lobe = lobes.find((l) => u <= l.u1) ?? lobes.at(-1)!;
    return lobe.at((u - lobe.u0) / (lobe.u1 - lobe.u0));
  };
  // Humps over what's under the top: a parabola falling 3 mm HUMP each side.
  const high = lowest.filter(([, z]) => z > base);
  const hump = (u: number) =>
    Math.max(base, ...high.map(([v, z]) => z + 0.3 - ((u - v) / HUMP) ** 2 * 3));
  if (high.some(([v]) => hump(v) > top(v) - 0.8)) return undefined;
  // At a free end the intrados sweeps up, a quarter ellipse TAPER long, to
  // end 1.2 mm under the top: a tapered nose rather than a cut end.
  const nose = (u: number) => {
    const ends = [f0.kind === 'free' ? u : Infinity, f1.kind === 'free' ? L - u : Infinity];
    const d = Math.min(...ends);
    const end = ends[0] <= ends[1] ? 0 : L;
    const k = Math.min(TAPER, (b - a) / 2);
    if (d >= k) return -Infinity;
    const [from, to] = [arch(end ? L - k : k), top(end) - 1.2];
    return from + (to - from) * (1 - Math.sqrt(Math.max(0, 1 - (1 - d / k) ** 2)));
  };
  return (u: number) => Math.max(arch(u), hump(u), nose(u));
}

/** A stretch of top from a heading da to b heading db (3D, the z part the rise per mm), sagging by s in the middle; `stiff` above 1 holds the headings longer and turns more sharply between. */
function curve(a: V3, da: V3, b: V3, db: V3, s: number, stiff = 1): Path {
  const k = dist(a, b) * stiff;
  const N = Math.max(4, Math.ceil(k / 0.5));
  const pts = [...Array(N + 1).keys()].map((j) => {
    const t = j / N;
    return add(hermite(a, scale(da, k), b, scale(db, k), t), [0, 0, -s * 16 * (t * (1 - t)) ** 2]);
  });
  const p = pts.map((q): V3 => [q[0], q[1], 0]);
  return { p, s: cumulative(p), z: pts.map((q) => q[2]) };
}

/** Paths joined end to end (each starting where the last ended). */
function join(paths: Path[]): Path {
  const p: V3[] = [];
  const z: number[] = [];
  for (const path of paths) {
    const skip = p.length ? 1 : 0;
    p.push(...path.p.slice(skip));
    z.push(...path.z.slice(skip));
  }
  return { p, s: cumulative(p), z };
}
function reverse(path: Path): Path {
  const p = [...path.p].reverse();
  return { p, s: cumulative(p), z: [...path.z].reverse() };
}
/** A path's point (3D, on its top) at index i (negative from the end). */
function point(path: Path, i: number): V3 {
  const j = i < 0 ? path.p.length + i : i;
  return [path.p[j][0], path.p[j][1], path.z[j]];
}
/** Where along a path distance u is, and its plan heading there. */
function along(path: Path, u: number): { p: V3; d: V3 } {
  const { p, s } = path;
  let i = 1;
  while (i < s.length - 1 && s[i] < u) i++;
  // Skip repeated points, for a heading.
  let k = i;
  while (k < p.length - 1 && dist2(p[k], p[i - 1]) < 1e-9) k++;
  const f = (u - s[i - 1]) / (s[i] - s[i - 1] || 1);
  return { p: lerp(p[i - 1], p[i], Math.max(0, Math.min(1, f))), d: plan(sub(p[k], p[i - 1])) };
}
function cumulative(p: V3[]): number[] {
  const s = [0];
  for (let i = 1; i < p.length; i++) s.push(s[i - 1] + dist2(p[i - 1], p[i]));
  return s;
}
/** Linear interpolation in a table of [x, y] rows, x ascending. */
function interp(rows: number[][], x: number): number {
  if (x <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i++)
    if (x <= rows[i][0]) {
      const [[x0, y0], [x1, y1]] = [rows[i - 1], rows[i]];
      return x1 > x0 ? y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) : y1;
    }
  return rows.at(-1)![1];
}

/** Points over a sweep's faces (the four sides between each two sections, and the end caps' corners), at most PROBE apart, for the clear test. */
function faces(sections: V3[][]): V3[] {
  const out: V3[] = [];
  sections.slice(1).forEach((t, i) => {
    const s = sections[i];
    s.forEach((p, j) => {
      const [q, p2, q2] = [s[(j + 1) % 4], t[j], t[(j + 1) % 4]];
      const nf = Math.max(1, Math.ceil(dist(p, q) / PROBE));
      const ng = Math.max(1, Math.ceil(dist(p, p2) / PROBE));
      for (let f = 0; f < nf; f++)
        for (let g = 0; g < ng; g++)
          out.push(lerp(lerp(p, q, f / nf), lerp(p2, q2, f / nf), g / ng));
    });
  });
  return [...out, ...sections.at(-1)!];
}

/** A cubic Hermite curve from p0 to p1 with tangents m0 and m1. */
function hermite(p0: V3, m0: V3, p1: V3, m1: V3, t: number): V3 {
  const [t2, t3] = [t * t, t * t * t];
  const w = [2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t, -2 * t3 + 3 * t2, t3 - t2];
  return [p0, m0, p1, m1].reduce((sum, v, i) => add(sum, scale(v, w[i])), [0, 0, 0] as V3);
}
/** Plan vector h turned by angle a (radians) about z. */
const turn = (h: V3, a: number): V3 => [
  h[0] * Math.cos(a) - h[1] * Math.sin(a),
  h[0] * Math.sin(a) + h[1] * Math.cos(a),
  0,
];
const plan = (v: V3): V3 => unit([v[0], v[1], 0]);
const plan2 = (v: V3) => Math.hypot(v[0], v[1]);
const lerp = (p: V3, q: V3, f: number) => add(p, scale(sub(q, p), f));
const dist = (p: V3, q: V3) => Math.hypot(...sub(p, q));
const dist2 = (p: V3, q: V3) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const length = (path: Path) => path.s.at(-1)! + Math.abs(path.z[0] - path.z.at(-1)!);
