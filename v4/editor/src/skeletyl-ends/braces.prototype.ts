// PROTOTYPE. Question: How should the Skeletyl support its hanging rib ends?
// Variants switchable via ?ends= on the editor.
//
// ?ends=braces (diagonal braces): each hanging end gets one straight brace
// from under its bottom, running down at about 45° to the nearest solid thing
// it can reach clear of the keys, like the knee brace under a shelf: the rail
// (a foot along its top), a dropped end (its lip, round or drop), the side of
// a thumb key's plate (the thumb ribs stand low in front of the finger
// columns' fronts, carried on their drops and braces), or, in later passes,
// an end braced already or its brace, so braces chain and meet in triangles.
// A brace is the hull of two rectangles: its section, WIDTH by DEPTH, at the
// top (its upper edge INTO up into the end's bottom, which may lean) and a pad
// inside what it lands on. Where it leaves the end a gusset fillets the joint:
// the hull of a pad on the bottom, SPREAD wide, and the brace's section GUSSET
// down it (narrower, or only on the bottom's back, where that's what clears).
// A brace shorter than 1.5 GUSSET is all gusset: one hull from end to landing.
//
// Choosing: anchors along the end's bottom (ANCHOR apart, and up to BACK in
// toward its key) and landing spots (STEP apart) are paired, and each pair
// costs its length if its slope is GOOD (prints without support, and braces
// rather than props), SLACK times that if only OK, and a TIE (short) may be at
// any slope down from level (it bridges). Cheapest first, the first whose
// axis, then whose faces (points FACE apart) are clear of the keys wins. An end
// that finds nothing is left hanging.
import type { Manifold } from 'manifold-3d';
import {
  add,
  componentFrames,
  cross,
  dot,
  isThumb,
  point,
  scale,
  sub,
  unit,
  type Config,
  type V3,
} from '../geometry';
import { plateHalfWidths } from '../plates';
import { INTO, type EndsFrame, type EndsKit, type RibEnd } from '../skeletyl-ends.prototype';

/** A brace's section (mm): its width, square to it in plan, and its depth, square to that. */
const [WIDTH, DEPTH] = [4, 3];
/** The gusset: how far down the brace it reaches, and how wide it spreads along the end's bottom (mm). */
const [GUSSET, SPREAD] = [6, 10];
/** A foot on the rail runs this long along it (mm); a pad in what a brace lands on is this big. */
const [FOOT, PAD] = [6, 3];
/**
 * The brace's slope below level (degrees): the range it should be in (prints
 * without support, and braces rather than props), and the range it may be in
 * at a cost (its length counts SLACK times over). A brace at most TIE long may
 * be at any slope down from level (it bridges).
 */
const [GOOD, OK, SLACK, TIE]: [[number, number], [number, number], number, number] = [
  [38, 68],
  [30, 80],
  1.5,
  8,
];
/** A pad in a plate's side keeps this far (mm) in from its top and underside. */
const PLATE_IN = 0.35;
/** Least height (mm) of anything off the rail. */
const FLOOR = 2;
/** Spacing (mm) of the landing spots sampled on the rail and over the ends, of the points the clear test samples over each face, and of the anchors along an end's bottom. */
const [STEP, FACE, ANCHOR] = [2.5, 1.2, 2];
/** How far back (mm, toward its key) from the middle of an end's bottom a brace may start. */
const BACK = [0, 0.8, 1.6];
const Z: V3 = [0, 0, 1];

/** Somewhere a brace can land: the point its axis aims at, the points (inside what it lands on) its hull reaches to, and what it is. */
type Landing = { at: V3; pad: V3[]; on: string };
/** A brace as built: its end, landing, axis ends and solids. */
type Brace = { end: RibEnd; on: string; top: V3; foot: V3; solids: Manifold[] };

/** What the last build did, for probes: each hanging end and what it landed on (or "-"). */
export const bracesReport: string[] = [];

export function braces(kit: EndsKit, frame: EndsFrame): Manifold[] {
  const hull = (pts: V3[]) => kit.wasm.Manifold.hull(pts);
  const fixed = [
    ...railLandings(frame),
    ...frame.ends.filter((e) => e.finish === 'drop').flatMap(endLandings),
    ...plateLandings(kit.cfg),
  ];
  const built: Brace[] = [];
  let todo = [...frame.hanging];
  // Ends land on the rail or a drop where they can; then the rest try the
  // ends braced already and their braces, until nothing changes.
  for (let pass = 0; todo.length && pass < 4; pass++) {
    const more = built.flatMap((b) => [...braceLandings(b), ...endLandings(b.end)]);
    const left: RibEnd[] = [];
    for (const e of todo) {
      const b = brace(frame, hull, e, [...fixed, ...more]);
      if (b) built.push(b);
      else left.push(e);
    }
    if (left.length === todo.length) break;
    todo = left;
  }
  bracesReport.length = 0;
  for (const e of frame.hanging) {
    const b = built.find((x) => x.end === e);
    bracesReport.push(
      `${e.rib} ${e.at}: ${b ? `${b.on}, ${dist(b.top, b.foot).toFixed(1)} mm at ${slope(sub(b.foot, b.top)).toFixed(0)}°` : '-'}`,
    );
  }
  return built.flatMap((b) => b.solids);
}

/** What a brace along v costs (its length, more if its slope is only OK), or undefined if it isn't allowed. */
function cost(v: V3): number | undefined {
  const [len, a] = [norm(v), slope(v)];
  if (a >= GOOD[0] && a <= GOOD[1]) return len;
  if (len <= TIE && a >= 0) return len;
  if (a >= OK[0] && a <= OK[1]) return len * SLACK;
  return undefined;
}

/** The cheapest clear brace from end e to one of the landings. */
function brace(
  frame: EndsFrame,
  hull: (pts: V3[]) => Manifold,
  e: RibEnd,
  landings: Landing[],
): Brace | undefined {
  const half = dist(e.bottom.outer[0], e.bottom.outer[1]) / 2;
  const anchors: V3[] = [];
  const most = half - WIDTH / 2 - INTO;
  for (let s = 0; s <= most + ANCHOR - 0.01; s += ANCHOR)
    for (const back of BACK)
      anchors.push(
        ...(s ? [-1, 1] : [0]).map((k) =>
          onBottom(
            e,
            add(e.centre, add(scale(e.across, k * Math.min(s, most)), scale(e.out, -back))),
          ),
        ),
      );
  const tries = anchors
    .filter((A) => frame.clear([add(A, [0, 0, -1])]))
    .flatMap((A) =>
      landings.flatMap((L) => {
        const c = cost(sub(L.at, A));
        return c === undefined ? [] : [{ A, L, c }];
      }),
    );
  tries.sort((a, b) => a.c - b.c);
  for (const { A, L } of tries) {
    // Cheap first: the axis, short of the landing, then the faces.
    const [S, len] = [add(A, [0, 0, -DEPTH / 2]), norm(sub(L.at, A))];
    const axis = [...Array(Math.max(0, Math.floor(len - PAD))).keys()].map((k) =>
      lerp(S, L.at, k / len),
    );
    if (!frame.clear(axis)) continue;
    const solids = build(hull, e, A, L).find((o) => o.every((m) => frame.clear(faces(m))));
    if (solids) return { end: e, on: L.on, top: A, foot: L.at, solids };
  }
  return undefined;
}

/**
 * The brace from anchor A (on end e's bottom) to landing L, with its gusset,
 * spread SPREAD along the bottom, else only its own width, else only on the
 * back of the bottom: the options, best first. A short brace is all gusset:
 * one hull from the end to its landing.
 */
function build(hull: (pts: V3[]) => Manifold, e: RibEnd, A: V3, L: Landing): Manifold[][] {
  const d = unit(sub(L.at, A));
  const h = Math.abs(d[2]) > 0.999 ? e.across : unit(cross(d, Z));
  const u = cross(h, d);
  const top = add(A, [0, 0, INTO]);
  // The section, its upper edge at `at`; at the top, that edge's corners stand
  // INTO up into the bottom (which may lean).
  const section = (at: V3, first = false) =>
    [1, -1].flatMap((k) => {
      const side = add(at, scale(h, (k * WIDTH) / 2));
      return [first ? add(onBottom(e, side), [0, 0, INTO]) : side, add(side, scale(u, -DEPTH))];
    });
  const wall = depth(e) - 0.4;
  const half = dist(e.bottom.outer[0], e.bottom.outer[1]) / 2;
  const s = dot(sub(A, e.centre), e.across);
  // A pad on the bottom, INTO up into it, `spread` wide but not past its
  // sides, from its back to `front` (1 its front, 0 its middle).
  const pad = ([spread, front]: number[]) =>
    [Math.max(s - spread / 2, -half + INTO), Math.min(s + spread / 2, half - INTO)].flatMap((k) =>
      [front, -1].map((j) =>
        add(onBottom(e, add(e.centre, add(scale(e.across, k), scale(e.out, (j * wall) / 2)))), [
          0,
          0,
          INTO,
        ]),
      ),
    );
  const pads = [
    [SPREAD, 1],
    [WIDTH, 1],
    [WIDTH, 0],
    [WIDTH, -0.6],
  ].map(pad);
  if (norm(sub(L.at, A)) < GUSSET * 1.5)
    return pads.map((p) => [hull([...p, ...section(top, true), ...L.pad])]);
  const strut = hull([...section(top, true), ...L.pad]);
  const below = section(add(top, scale(d, GUSSET)));
  return pads.map((p) => [strut, hull([...p, ...section(top, true), ...below])]);
}

/** Point p (in plan) on end e's bottom, which may lean: the plane through its corners. */
function onBottom(e: RibEnd, p: V3): V3 {
  const [o0, o1] = e.bottom.outer;
  const n = cross(sub(o1, o0), sub(e.bottom.inner[0], o0));
  return [p[0], p[1], o0[2] - (n[0] * (p[0] - o0[0]) + n[1] * (p[1] - o0[1])) / n[2]];
}

/** An end's wall thickness: the depth of its bottom. */
const depth = (e: RibEnd) => dist(e.bottom.outer[0], e.bottom.inner[0]);

/** Spots along the rail's centreline, STEP apart: land on its top with a foot along it. */
function railLandings(frame: EndsFrame): Landing[] {
  const { outer, height } = frame.rail;
  const out: Landing[] = [];
  const spots: V3[] = [];
  let carry = 0;
  outer.forEach((a, i) => {
    const b = outer[(i + 1) % outer.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (; carry < l; carry += STEP) {
      const f = carry / l;
      spots.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 0]);
    }
    carry -= l;
  });
  // The foot is FOOT long, shorter where the rail curves, so it keeps on it.
  const onRail = (q: V3) => inRing(outer, q) && !inRing(frame.rail.inner, q);
  for (const p of spots) {
    const R = frame.railNear(p);
    const along = cross(Z, R.out);
    const w = frame.wall / 2 - INTO;
    const base: V3 = [R.centre[0], R.centre[1], height - INTO];
    const pad = [FOOT, FOOT / 2, WIDTH / 2]
      .map((l) =>
        [1, -1].flatMap((k) =>
          [1, -1].map((j) => add(base, add(scale(along, (k * l) / 2), scale(R.out, j * w)))),
        ),
      )
      .find((corners) => corners.every(onRail));
    if (pad) out.push({ at: [R.centre[0], R.centre[1], height], on: 'rail', pad });
  }
  return out;
}

/** Whether plan point p is inside the ring. */
function inRing(ring: [number, number][], p: V3) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = [ring[i], ring[j]];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

/**
 * Spots over end e as built, from its plate's corner over its lip and round
 * (and down its drop, if it drops), STEP apart across it: land in it with a
 * pad inside it.
 */
function endLandings(e: RibEnd): Landing[] {
  const out: Landing[] = [];
  const [s0, s1] = e.sides;
  const width = dist(e.bottom.outer[0], e.bottom.outer[1]);
  for (let i = 0; i < s0.length; i++) {
    const [a, b] = [s0[i], s1[i]];
    const thick = dist(a[0], a[1]);
    if (thick < 2 * INTO + 0.4) continue;
    const n = unit(sub(a[0], a[1]));
    const along = unit(sub(s0[Math.min(i + 1, s0.length - 1)][0], s0[Math.max(i - 1, 0)][0]));
    const [m0, m1] = [lerp(a[0], a[1], 0.5), lerp(b[0], b[1], 0.5)];
    const steps = Math.max(1, Math.round((width - PAD) / STEP));
    for (let k = 0; k <= steps; k++) {
      const f = (PAD / 2 + ((width - PAD) * k) / steps) / width;
      const c = lerp(m0, m1, f);
      if (c[2] < FLOOR + PAD) continue;
      out.push({
        at: c,
        on: `${e.rib} ${e.finish === 'drop' ? 'drop' : 'end'}`,
        pad: box(c, e.across, n, [PAD / 2, thick / 2 - INTO, PAD / 2], along),
      });
    }
  }
  return out;
}

/**
 * Spots along the sides of the thumb keys' plates (the thumb ribs stand low
 * in front of the finger columns' fronts, and are carried on drops and
 * braces), STEP apart: land in a plate's side with a pad just inside it.
 */
function plateLandings(cfg: Config): Landing[] {
  const frames = componentFrames(cfg);
  const half = plateHalfWidths(cfg);
  const t = cfg.chassis.plate_thickness_mm;
  const [z0, z1] = [-t + PLATE_IN, -PLATE_IN];
  const out: Landing[] = [];
  for (const n of Object.keys(frames).filter(isThumb))
    for (const i of [0, 1])
      for (const sign of [-1, 1]) {
        const j = 1 - i;
        const local = (a: number, b: number, z: number) => {
          const v = [0, 0, z];
          [v[i], v[j]] = [a, b];
          return point(frames[n], v as V3);
        };
        const edge = sign * half[i];
        for (let s = -(half[j] - PAD / 2); s <= half[j] - PAD / 2 + 0.01; s += STEP) {
          const pad = [edge - sign * 0.05, edge - sign * 0.6].flatMap((a) =>
            [s - PAD / 2, s + PAD / 2].flatMap((b) => [z0, z1].map((z) => local(a, b, z))),
          );
          out.push({ at: local(edge, s, -t / 2), on: `${n} plate`, pad });
        }
      }
  return out;
}

/** Spots along a brace built already: land in it with a small pad inside it. */
function braceLandings(b: Brace): Landing[] {
  const out: Landing[] = [];
  const d = unit(sub(b.foot, b.top));
  const h = unit(cross(d, Z));
  const u = cross(h, d);
  for (let t = 0.3; t <= 0.75; t += 0.05) {
    const c = lerp(add(b.top, scale(u, -DEPTH / 2)), b.foot, t);
    out.push({
      at: c,
      on: `${b.end.rib} brace`,
      pad: box(c, h, u, [WIDTH / 2 - INTO, DEPTH / 2 - INTO, 1]),
    });
  }
  return out;
}

/** The corners of a box centred at c, half-sizes r along a, b and n (a × b if not given). */
function box(c: V3, a: V3, b: V3, r: V3, n: V3 = unit(cross(a, b))): V3[] {
  return [1, -1].flatMap((i) =>
    [1, -1].flatMap((j) =>
      [1, -1].map((k) =>
        add(c, add(scale(a, i * r[0]), add(scale(b, j * r[1]), scale(n, k * r[2])))),
      ),
    ),
  );
}

/** Points over a solid's faces, about FACE apart. */
function faces(m: Manifold): V3[] {
  const mesh = m.getMesh();
  const P = (i: number): V3 => {
    const k = mesh.triVerts[i] * mesh.numProp;
    return [mesh.vertProperties[k], mesh.vertProperties[k + 1], mesh.vertProperties[k + 2]];
  };
  const pts: V3[] = [];
  for (let t = 0; t < mesh.triVerts.length; t += 3) {
    const [a, b, c] = [P(t), P(t + 1), P(t + 2)];
    const n = Math.max(1, Math.ceil(Math.max(dist(a, b), dist(b, c), dist(c, a)) / FACE));
    for (let i = 0; i <= n; i++)
      for (let j = 0; i + j <= n; j++)
        pts.push(add(a, add(scale(sub(b, a), i / n), scale(sub(c, a), j / n))));
  }
  return pts;
}

/** How steeply v falls (degrees below level). */
const slope = (v: V3) => (Math.atan2(-v[2], Math.hypot(v[0], v[1])) * 180) / Math.PI;
const lerp = (p: V3, q: V3, f: number) => add(p, scale(sub(q, p), f));
const norm = (v: V3) => Math.sqrt(dot(v, v));
const dist = (p: V3, q: V3) => norm(sub(p, q));
