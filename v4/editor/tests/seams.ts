// The seam check: where the parts of a unioned solid meet badly, found on its
// mesh as the editor draws it (viewer.ts: creased normals at 30°, each corner's
// normal the plain mean of its faces' within 30°). What it finds, each a spot
// (findings within a few mm of each other, of one kind), with the parts that
// meet there:
//  - sliver: a triangle a few hundredths of a mm across, as a union leaves
//    where two surfaces meet near tangent or near an edge of either;
//  - ledge: a strip of one smooth face under ledgeWidth across between two
//    creases (a step, a lip standing proud, a sliver of a face left showing);
//  - crease: an edge over 30° that no single part has (two parts meeting at an
//    angle) and that isn't square (a part standing square on a flat face);
//  - gap / thin: two faces facing each other closer than gapDepth, across air
//    (a crack between parts that don't quite meet) or across material (a skin
//    where they barely overlap);
//  - shading: a corner whose drawn normal is swung over shadeAngle from the
//    surface's by slivers among its faces (each counts as much as a big one).
// What is meant is told by where it is: on a cut (a face not on any part,
// such as a switch hole or a pad), along a part's own edge (a plate's edges,
// a rib's, the rail's), or square, a part standing on another's flat face.
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { componentFrames, isKey, type Config } from '../src/geometry';
import { skeletyl } from '../src/skeletyl';
import { buildChassis, gluePosts, postAxes, type PostFit } from '../src/chassis';
import { openingSpan, seatSettings, seatSwitches } from '../src/seats';
import { plateHalfWidths } from '../src/plates';
import { wiring } from '../src/wiring';

type V3 = [number, number, number];

/** Thresholds, mm and degrees. */
export const SEAMS = {
  /** A point is on a surface within this. */
  on: 0.01,
  /** A triangle less than this high (twice its area over its longest edge) is a sliver. */
  sliver: 0.02,
  /** A face narrower than this between two creases is a ledge. */
  ledgeWidth: 1,
  /** Its two creases run within this of each other's direction (degrees). */
  alongside: 20,
  /** Faces meeting at more than this are a crease (the viewer's). */
  crease: 30,
  /** A crease within this of 90° between a flat face and a part standing on it is square. */
  square: 10,
  /** Faces facing each other closer than this are a gap (air) or thin (material). */
  gapDepth: 0.2,
  /** A sliver whose normal is this far or more from a face beside it (and under the crease angle) sways that face's drawn normal. */
  sway: 2,
  /** A corner's drawn normal more than this from the area-weighted one is a shading artifact (on faces at least shadeArea big, mm²). */
  shadeAngle: 5,
  shadeArea: 0.05,
  /** Findings of a kind within this of each other are one spot. */
  spot: 3,
  /**
   * A glue post's leg goes up into the frame over it (the web, the rib's
   * end); the union splits the frame's faces along where they meet, and the
   * slivers, narrow strips and wedges that leaves within this of the leg are
   * the join's, meant as the leg is.
   */
  postMeet: 0.5,
};

export type SeamKind = 'sliver' | 'ledge' | 'crease' | 'gap' | 'thin' | 'shading';
export interface Seam {
  kind: SeamKind;
  /** Its middle, and its extent (the box round its findings). */
  at: V3;
  size: V3;
  /** How many findings (triangles, edges, corners). */
  count: number;
  /** The parts meeting there. */
  parts: string[];
  /** The worst measure: height (sliver), width (ledge), angle (crease, shading), depth (gap, thin). */
  worst: number;
}

interface Mesh {
  pos: Float32Array | number[];
  tri: Uint32Array | number[];
}
export const meshOf = (m: Manifold): Mesh => {
  const g = m.getMesh();
  const np = g.numProp;
  const pos = new Float32Array(g.numVert * 3);
  for (let i = 0; i < g.numVert; i++)
    for (let k = 0; k < 3; k++) pos[i * 3 + k] = g.vertProperties[i * np + k];
  return { pos, tri: g.triVerts };
};

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => scale(a, 1 / (len(a) || 1));
const deg = (c: number) => (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;

/** The point of triangle abc nearest p (Ericson, Real-Time Collision Detection 5.1.5). */
function nearest(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
    return add(b, scale(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const den = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * den), scale(ac, vc * den)));
}
/** How far p is from segment ab. */
function toSegment(p: V3, a: V3, b: V3) {
  const ab = sub(b, a);
  const f = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return len(sub(p, add(a, scale(ab, f))));
}

/** Items (each a box) bucketed in a grid of cells `cell` mm, to find those near a point. */
class Grid {
  cells = new Map<string, number[]>();
  constructor(
    private cell: number,
    boxes: [V3, V3][],
  ) {
    boxes.forEach(([lo, hi], i) => {
      const [a, b] = [lo, hi].map((p) => p.map((x) => Math.floor(x / cell)));
      for (let x = a[0]; x <= b[0]; x++)
        for (let y = a[1]; y <= b[1]; y++)
          for (let z = a[2]; z <= b[2]; z++) {
            const k = `${x},${y},${z}`;
            const l = this.cells.get(k);
            if (l) l.push(i);
            else this.cells.set(k, [i]);
          }
    });
  }
  /** Items whose boxes may come within r of p. */
  near(p: V3, r: number) {
    const [a, b] = [-r, r].map((o) => p.map((x) => Math.floor((x + o) / this.cell)));
    const out = new Set<number>();
    for (let x = a[0]; x <= b[0]; x++)
      for (let y = a[1]; y <= b[1]; y++)
        for (let z = a[2]; z <= b[2]; z++)
          for (const i of this.cells.get(`${x},${y},${z}`) ?? []) out.add(i);
    return out;
  }
}

/** A mesh's triangles and their creases, with what's near a point. */
class Surface {
  v: V3[];
  t: [number, number, number][];
  grid: Grid;
  /** Its own creases (edges over SEAMS.crease), as segments. */
  creases: [V3, V3][];
  creaseGrid: Grid;
  constructor(m: Mesh) {
    this.v = [];
    for (let i = 0; i < m.pos.length; i += 3) this.v.push([m.pos[i], m.pos[i + 1], m.pos[i + 2]]);
    this.t = [];
    for (let i = 0; i < m.tri.length; i += 3) this.t.push([m.tri[i], m.tri[i + 1], m.tri[i + 2]]);
    this.grid = new Grid(
      2,
      this.t.map((t) => box(t.map((i) => this.v[i]))),
    );
    const edges = edgeFaces(this.t);
    const n = this.t.map((t) => normal(t.map((i) => this.v[i]) as [V3, V3, V3]));
    const cos = Math.cos((SEAMS.crease * Math.PI) / 180);
    this.creases = [];
    for (const [key, fs] of edges) {
      if (fs.length !== 2 || dot(n[fs[0]], n[fs[1]]) > cos) continue;
      const [a, b] = key.split(',').map(Number);
      this.creases.push([this.v[a], this.v[b]]);
    }
    this.creaseGrid = new Grid(2, this.creases.map(box));
  }
  /** Whether p is within r of the surface. */
  on(p: V3, r = SEAMS.on) {
    for (const i of this.grid.near(p, r)) {
      const [a, b, c] = this.t[i].map((j) => this.v[j]);
      if (len(sub(p, nearest(p, a, b, c))) <= r) return true;
    }
    return false;
  }
  /** Whether p is within r of one of its own creases. */
  onCrease(p: V3, r = SEAMS.on) {
    for (const i of this.creaseGrid.near(p, r))
      if (toSegment(p, ...this.creases[i]) <= r) return true;
    return false;
  }
}

const box = (ps: V3[]): [V3, V3] => [
  [0, 1, 2].map((k) => Math.min(...ps.map((p) => p[k]))) as V3,
  [0, 1, 2].map((k) => Math.max(...ps.map((p) => p[k]))) as V3,
];
const normal = ([a, b, c]: [V3, V3, V3]) => unit(cross(sub(b, a), sub(c, a)));
/** Each edge (its vertices, low first) and the faces on it. */
function edgeFaces(t: [number, number, number][]) {
  const out = new Map<string, number[]>();
  t.forEach((f, i) =>
    [0, 1, 2].forEach((k) => {
      const [a, b] = [f[k], f[(k + 1) % 3]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const l = out.get(key);
      if (l) l.push(i);
      else out.set(key, [i]);
    }),
  );
  return out;
}

/** The ray from p along unit d: how far until it crosses triangle abc (Möller–Trumbore), or Infinity. */
function rayHit(p: V3, d: V3, a: V3, b: V3, c: V3) {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const h = cross(d, e2);
  const det = dot(e1, h);
  if (Math.abs(det) < 1e-12) return Infinity;
  const s = sub(p, a);
  const u = dot(s, h) / det;
  if (u < 0 || u > 1) return Infinity;
  const q = cross(s, e1);
  const v = dot(d, q) / det;
  if (v < 0 || u + v > 1) return Infinity;
  const t = dot(e2, q) / det;
  return t > 1e-6 ? t : Infinity;
}

/**
 * The seams of `mesh` (the solid as drawn), its parts the solids it is the
 * union of (named) and, if it was cut after (switch holes, pads), the union
 * before that (`frame`): a face on no part is a cut's, and meant.
 */
export function seams(
  mesh: Mesh,
  parts: { name: string; mesh: Mesh }[],
  cutsFrom?: Mesh,
  meant: (p: V3) => boolean = () => false,
  raw?: { kind: SeamKind; p: V3; parts: string[]; worst: number }[],
): Seam[] {
  const S = new Surface(mesh);
  const P = parts.map((p) => ({ name: p.name, s: new Surface(p.mesh) }));
  const frame = cutsFrom ? new Surface(cutsFrom) : undefined;
  const { v, t } = S;
  const corners = (f: number) => t[f].map((i) => v[i]) as [V3, V3, V3];
  const n = t.map((_, f) => normal(corners(f)));
  const area = t.map((_, f) => {
    const [a, b, c] = corners(f);
    return len(cross(sub(b, a), sub(c, a))) / 2;
  });
  const middle = (f: number) => scale(corners(f).reduce(add), 1 / 3);
  const partsAt = (p: V3, r = SEAMS.on) => P.filter((x) => x.s.on(p, r)).map((x) => x.name);
  // A face is a cut's if it isn't on the frame (nor on a part).
  const cut = t.map((_, f) => {
    const m = middle(f);
    return frame ? !frame.on(m) : !P.some((x) => x.s.on(m));
  });
  const edges = edgeFaces(t);
  const cos = Math.cos((SEAMS.crease * Math.PI) / 180);
  const found: { kind: SeamKind; p: V3; parts: string[]; worst: number }[] = [];

  // The faces at each vertex.
  const at = new Map<number, number[]>();
  t.forEach((tri, f) => tri.forEach((i) => (at.get(i) ?? at.set(i, []).get(i)!).push(f)));
  // Slivers: those whose normal sways a drawn normal (within the crease
  // angle of a face beside them, but not along with it). One with no area
  // has no normal and is drawn as nothing.
  t.forEach((tri, f) => {
    if (cut[f] || area[f] < 1e-9) return;
    const [a, b, c] = corners(f);
    const long = Math.max(len(sub(b, a)), len(sub(c, b)), len(sub(a, c)));
    const high = (2 * area[f]) / (long || 1);
    if (high >= SEAMS.sliver) return;
    const sways = tri.some((i) =>
      at.get(i)!.some((g) => {
        if (g === f || area[g] < 1e-9) return false;
        const c = dot(n[g], n[f]);
        return c > cos && c < Math.cos((SEAMS.sway * Math.PI) / 180);
      }),
    );
    if (sways)
      found.push({ kind: 'sliver', p: middle(f), parts: partsAt(middle(f), 0.05), worst: high });
  });

  // Creases: those no part has, that aren't square onto a flat face.
  const creaseList: { a: number; b: number; faces: number[] }[] = [];
  const isFlat = (f: number) =>
    // On a part's face that is flat round here: the rail's top or sides, a
    // plate, a drop's foot: horizontal or vertical.
    Math.abs(n[f][2]) > 0.999 || Math.abs(n[f][2]) < 0.001;
  for (const [key, fs] of edges) {
    if (fs.length !== 2 || dot(n[fs[0]], n[fs[1]]) > cos) continue;
    const [a, b] = key.split(',').map(Number);
    creaseList.push({ a, b, faces: fs });
    if (fs.some((f) => cut[f])) continue;
    const m = scale(add(v[a], v[b]), 0.5);
    if (P.some((x) => x.s.onCrease(m))) continue;
    const angle = deg(dot(n[fs[0]], n[fs[1]]));
    if (Math.abs(angle - 90) < SEAMS.square && fs.some(isFlat)) continue;
    found.push({ kind: 'crease', p: m, parts: partsAt(m, 0.05), worst: angle });
  }

  // Ledges: from each crease, straight across the face beside it (in its
  // plane, square to the crease) to the next crease of the same smooth face.
  const group = smoothGroups(t.length, edges, n, cos);
  const creaseGrid = new Grid(
    1,
    creaseList.map((e) => box([v[e.a], v[e.b]])),
  );
  creaseList.forEach((e, ei) => {
    const [A, B] = [v[e.a], v[e.b]];
    const m = scale(add(A, B), 0.5);
    for (const f of e.faces) {
      if (cut[f]) continue;
      const g = group[f];
      // Into face f, square to the edge, in its plane.
      const along = unit(sub(B, A));
      let d = unit(cross(n[f], along));
      if (dot(d, sub(middle(f), m)) < 0) d = scale(d, -1);
      let best = Infinity;
      let other = -1;
      for (const j of creaseGrid.near(m, SEAMS.ledgeWidth)) {
        if (j === ei) continue;
        const o = creaseList[j];
        if (o.a === e.a || o.a === e.b || o.b === e.a || o.b === e.b) continue;
        if (!o.faces.some((x) => group[x] === g)) continue;
        // Where the ray m + s·d comes closest to segment o.
        const [P0, P1] = [v[o.a], v[o.b]];
        const u = sub(P1, P0);
        // A ledge runs between creases alongside each other; two that meet
        // at an angle are a corner's (a face tapering to its tip), not one.
        if (Math.abs(dot(unit(u), along)) < Math.cos((SEAMS.alongside * Math.PI) / 180)) continue;
        const w = sub(m, P0);
        const [aa, bb, cc, dd, ee] = [dot(d, d), dot(d, u), dot(u, u), dot(d, w), dot(u, w)];
        const den = aa * cc - bb * bb;
        if (Math.abs(den) < 1e-9) continue;
        const s = (bb * ee - cc * dd) / den;
        const q = (aa * ee - bb * dd) / den;
        if (s <= 1e-4 || q < 0 || q > 1) continue;
        const miss = len(sub(add(m, scale(d, s)), add(P0, scale(u, q))));
        if (miss > 0.05 + 0.1 * s) continue;
        if (s < best) [best, other] = [s, j];
      }
      if (best < SEAMS.ledgeWidth && best >= SEAMS.on) {
        const o = creaseList[other];
        const q = scale(add(v[o.a], v[o.b]), 0.5);
        const names = [...new Set([...partsAt(m, 0.05), ...partsAt(q, 0.05)])];
        found.push({ kind: 'ledge', p: add(m, scale(d, best / 2)), parts: names, worst: best });
      }
    }
  });

  // Gaps and thin skins: from each face's middle, out and in along its normal.
  const nearFaces = (f: number) => new Set(t[f]);
  t.forEach((tri, f) => {
    if (cut[f] || area[f] < 1e-4) return;
    const m = middle(f);
    for (const [kind, sign] of [
      ['gap', 1],
      ['thin', -1],
    ] as const) {
      const d = scale(n[f], sign);
      let best = Infinity;
      const mine = nearFaces(f);
      for (const j of S.grid.near(add(m, scale(d, SEAMS.gapDepth / 2)), SEAMS.gapDepth)) {
        if (j === f || t[j].some((x) => mine.has(x))) continue;
        best = Math.min(best, rayHit(m, d, ...corners(j)));
      }
      if (best < SEAMS.gapDepth) found.push({ kind, p: m, parts: partsAt(m, 0.05), worst: best });
    }
    void tri;
  });

  // Shading: each corner's drawn normal (the plain mean of its faces' within
  // the crease angle) against the area-weighted mean.
  t.forEach((tri, f) => {
    if (cut[f] || area[f] < SEAMS.shadeArea) return;
    for (const i of tri) {
      const fs = at.get(i)!.filter((g) => dot(n[g], n[f]) > cos);
      const plain = unit(fs.reduce((s, g) => add(s, n[g]), [0, 0, 0] as V3));
      const weighted = unit(fs.reduce((s, g) => add(s, scale(n[g], area[g])), [0, 0, 0] as V3));
      const off = deg(dot(plain, weighted));
      if (off > SEAMS.shadeAngle)
        found.push({ kind: 'shading', p: v[i], parts: partsAt(v[i], 0.05), worst: off });
    }
  });

  const kept = found.filter((x) => !meant(x.p));
  raw?.push(...kept);
  return spots(kept);
}

/** Faces joined across edges under the crease angle: each face's group. */
function smoothGroups(count: number, edges: Map<string, number[]>, n: V3[], cos: number) {
  const up = [...Array(count).keys()];
  const root = (x: number): number => (up[x] === x ? x : (up[x] = root(up[x])));
  for (const fs of edges.values())
    if (fs.length === 2 && dot(n[fs[0]], n[fs[1]]) > cos) up[root(fs[0])] = root(fs[1]);
  return up.map((_, i) => root(i));
}

/** Findings of a kind within SEAMS.spot of each other, as one spot each. */
function spots(found: { kind: SeamKind; p: V3; parts: string[]; worst: number }[]): Seam[] {
  const up = found.map((_, i) => i);
  const root = (x: number): number => (up[x] === x ? x : (up[x] = root(up[x])));
  const grid = new Grid(
    SEAMS.spot,
    found.map((x) => [x.p, x.p]),
  );
  found.forEach((x, i) => {
    for (const j of grid.near(x.p, SEAMS.spot))
      if (found[j].kind === x.kind && len(sub(found[j].p, x.p)) <= SEAMS.spot)
        up[root(i)] = root(j);
  });
  const by = new Map<number, typeof found>();
  found.forEach((x, i) => (by.get(root(i)) ?? by.set(root(i), []).get(root(i))!).push(x));
  return [...by.values()].map((xs) => {
    const [lo, hi] = box(xs.map((x) => x.p));
    const small = xs[0].kind === 'crease' || xs[0].kind === 'shading' ? -1 : 1;
    return {
      kind: xs[0].kind,
      at: scale(add(lo, hi), 0.5).map((x) => +x.toFixed(2)) as V3,
      size: sub(hi, lo).map((x) => +x.toFixed(2)) as V3,
      count: xs.length,
      parts: [...new Set(xs.flatMap((x) => x.parts))].sort(),
      worst: xs.map((x) => x.worst).reduce((a, b) => (small * a < small * b ? a : b)),
    };
  });
}

/**
 * The Skeletyl's seams for a config, on the solid the editor draws (the frame
 * with its pads, the switches seated and their holes cut, as buildSolid makes
 * it), its parts the frame's (skeletyl().parts).
 */
export function skeletylSeams(
  wasm: ManifoldToplevel,
  cfg: Config,
  raw?: Parameters<typeof seams>[4],
) {
  const frames = componentFrames(cfg);
  const wired = wiring(cfg, frames);
  const built = skeletyl(wasm, cfg, frames, wired.wires);
  const chassis = buildChassis(wasm, cfg, frames, wired);
  const M = wasm.Manifold;
  const named = Object.entries(frames).filter(([n]) => isKey(n));
  const keys = named.map(([, m]) => m);
  const seated = seatSwitches(M, cfg, chassis.body, keys);
  const drawn = seated.body.subtract(M.union([...seated.reliefs, ...seated.openings]));
  const parts = built.parts().map((p) => ({ name: p.name, mesh: meshOf(p.solid) }));
  // What is meant, in each key's own coordinates: its plate (its edges, the
  // seat's step under it), the seat's trims above and below it and the switch
  // hole's opening (each in the seat's outer footprint), and the glue posts
  // (as their rib runs: their legs, shelves and corner posts' squares; round
  // a leg that goes up into the frame, postMeet).
  const plate = cfg.chassis.plate_thickness_mm;
  const half = plateHalfWidths(cfg);
  const outer = seatSettings(cfg).outer.map((x) => x / 2);
  const { bottom, top } = openingSpan(cfg);
  const g = 0.1;
  const zones: [V3, V3][] = [
    [
      [-half[0] - g, -half[1] - g, -plate - g],
      [half[0] + g, half[1] + g, g],
    ],
    [
      [-outer[0] - g, -outer[1] - g, Math.min(bottom, -7) - g],
      [outer[0] + g, outer[1] + g, Math.max(top, 7) + g],
    ],
  ];
  const postZones = (axis: number, fit: PostFit) => {
    const posts = gluePosts(cfg, axis, fit);
    return [
      ...posts.boxes.map((b): [V3, V3] => [
        b.center.map((c, i) => c - b.size[i] / 2 - g) as V3,
        b.center.map((c, i) => c + b.size[i] / 2 + g) as V3,
      ]),
      ...posts.legs.flat().map((b): [V3, V3] => {
        const m = fit.over ? SEAMS.postMeet : g;
        return [
          b.center.map((c, i) => c - b.size[i] / 2 - m) as V3,
          b.center.map((c, i) => c + b.size[i] / 2 + m) as V3,
        ];
      }),
      ...posts.corners.map(([x, y]): [V3, V3] => [
        [x - posts.radius - g, y - posts.radius - g, posts.bottom - g],
        [x + posts.radius + g, y + posts.radius + g, posts.top + g],
      ]),
    ];
  };
  const axes = postAxes(cfg, frames);
  const local = named.map(([n, m]) => {
    const e = m.elements;
    const to = (p: V3) => {
      const q = [p[0] - e[12], p[1] - e[13], p[2] - e[14]];
      return [0, 4, 8].map((i) => q[0] * e[i] + q[1] * e[i + 1] + q[2] * e[i + 2]);
    };
    return { to, zones: [...zones, ...postZones(axes[n], chassis.postFits[n])] };
  });
  const meant = (p: V3) =>
    local.some(({ to, zones }) => {
      const q = to(p);
      return zones.some(([lo, hi]) => q.every((x, i) => x >= lo[i] && x <= hi[i]));
    });
  return {
    seams: seams(meshOf(drawn), parts, meshOf(built.frame), meant, raw),
    drawn,
    outline: built.outline,
    triangles: drawn.numTri(),
    frameTriangles: built.frame.numTri(),
    /** The fused pairs of drops (PROTOTYPE, skeletyl().fused). */
    fused: built.fused,
  };
}
