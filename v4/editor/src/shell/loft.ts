// Lofting: an outline traced and resampled into rings of points, and the
// solid through those rings.
import type { CrossSection, Vec3 } from 'manifold-3d';
import type { Kit } from './common';

// Points round a loft's outline.
export const LOFT_POINTS = 240;
// A cubic Bézier through four control points, sampled at 13 points.
export function bezier(P: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12,
      w = [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
    out.push([0, 1].map((j) => w.reduce((q, wi, m) => q + wi * P[m][j], 0)) as [number, number]);
  }
  return out;
}
// The point on segment pq nearest (y, z): how far along it, and its offset from (y, z).
export function toSegment(p: [number, number], q: [number, number], y: number, z: number) {
  const [dy, dz] = [q[0] - p[0], q[1] - p[1]],
    l2 = dy * dy + dz * dz,
    f = l2 ? Math.min(1, Math.max(0, ((y - p[0]) * dy + (z - p[1]) * dz) / l2)) : 0;
  return { f, ey: p[0] + f * dy - y, ez: p[1] + f * dz - z };
}
// A cross-section's biggest polygon (the outline; holes have negative area).
export function largest(cs: CrossSection) {
  const area = (q: [number, number][]) =>
    q.reduce((t, p, i) => {
      const r = q[(i + 1) % q.length];
      return t + p[0] * r[1] - r[0] * p[1];
    }, 0);
  return cs
    .toPolygons()
    .map((q) => q.map(([y, z]) => [y, z] as [number, number]))
    .reduce((p, q) => (area(q) > area(p) ? q : p));
}
// An outline traced for a loft: its points from the one nearest anchor, their
// distances round it, and the marks' distances (sorted, between 0 and the
// whole length).
export function trace(
  outline: CrossSection,
  anchor: [number, number],
  marks: [number, number][] = [],
) {
  const poly = largest(outline),
    d = poly.map((p) => (p[0] - anchor[0]) ** 2 + (p[1] - anchor[1]) ** 2),
    i0 = d.indexOf(Math.min(...d)),
    pts = [...poly.slice(i0), ...poly.slice(0, i0)],
    m = pts.length,
    cum = [0];
  for (let i = 1; i <= m; i++) {
    const p = pts[i - 1],
      q = pts[i % m];
    cum.push(cum[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  // Each mark's distance round the outline: at the nearest point on it
  // (between vertices too: an inset outline's flat runs have none inside).
  const at = marks.map(([y, z]) => {
    let best = Infinity,
      t = 0;
    for (let i = 0; i < m; i++) {
      const { f, ey, ez } = toSegment(pts[i], pts[(i + 1) % m], y, z),
        e = ey ** 2 + ez ** 2;
      if (e < best) [best, t] = [e, cum[i] + f * (cum[i + 1] - cum[i])];
    }
    return t;
  });
  return { pts, cum, at, L: [0, ...[...at].sort((p, q) => p - q), cum[m]] };
}
export type Trace = ReturnType<typeof trace>;
// Points per run between marks, n in all, shared out by the runs' lengths.
function shares(L: number[], n: number) {
  const per = L.slice(1).map((l, i) => Math.max(2, Math.round((n * (l - L[i])) / L[L.length - 1])));
  per[per.length - 1] += n - per.reduce((t, c) => t + c, 0);
  return per;
}
// A traced outline resampled: per[i] points along the i-th run, evenly by length.
export function samples({ pts, cum, L }: Trace, per: number[]) {
  const m = pts.length,
    ts = per.flatMap((c, i) =>
      Array.from({ length: c }, (_, s) => L[i] + ((L[i + 1] - L[i]) * s) / c),
    ),
    out: [number, number][] = [];
  for (let s = 0, j = 0; s < ts.length; s++) {
    const t = ts[s];
    while (j < m - 1 && cum[j + 1] < t) j++;
    const p = pts[j],
      q = pts[(j + 1) % m],
      f = (t - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
  }
  return out;
}
// A closed solid through (y, z) outlines standing at stations along x: each
// outline is resampled to the same number of points, evenly by length from
// the point nearest anchor, consecutive outlines are joined point to point,
// and the first and last are capped. Marks (the same number on every
// outline: hard corners, say) are matched up too: each run between marks gets
// the same number of points on every outline, spaced evenly along it.
export function loft(
  k: Kit,
  rings: { x: number; outline: CrossSection; marks?: [number, number][] }[],
  anchor: [number, number],
  n = LOFT_POINTS,
) {
  const tr = rings.map((r) => trace(r.outline, anchor, r.marks)),
    per = shares(tr[0].L, n);
  return mesh(
    k,
    tr.map((t, i) => ({
      pts: samples(t, per),
      place: (y: number, z: number): Vec3 => [rings[i].x, y, z],
    })),
  );
}
// The solid through rings of points (counter-clockwise in each ring's own
// plane), each placed in 3D by its own map (given the point and its index).
// Each group's consecutive rings are joined point to point, and its ends
// capped unless it says not. share: a ring's points that are another's (its
// point index to the vertex's). extra: more faces, as polygons of [ring,
// point] (counter-clockwise in the first ring's plane, facing back along it).
export function mesh(
  k: Kit,
  rings: {
    pts: [number, number][];
    place: (w: number, z: number, j: number) => Vec3;
    share?: Map<number, number>;
  }[],
  groups: { rings: number[]; open?: [boolean, boolean] }[] = [{ rings: rings.map((_, i) => i) }],
  extra: [number, number][][] = [],
) {
  const verts: number[] = [],
    tris: number[] = [],
    base: number[] = [];
  let nv = 0;
  for (const r of rings) {
    base.push(nv);
    r.pts.forEach(([w, z], j) => verts.push(...r.place(w, z, j)));
    nv += r.pts.length;
  }
  const id = (r: number, j: number) => rings[r].share?.get(j) ?? base[r] + j;
  for (const { rings: g, open = [false, false] } of groups) {
    for (let i = 0; i + 1 < g.length; i++) {
      const [ra, rb] = [g[i], g[i + 1]],
        n = rings[ra].pts.length;
      for (let j = 0; j < n; j++) {
        const a = id(ra, j),
          b = id(ra, (j + 1) % n),
          c = id(rb, (j + 1) % n),
          d = id(rb, j);
        tris.push(a, b, c, a, c, d);
      }
    }
    const [f, l] = [g[0], g[g.length - 1]];
    if (!open[0])
      for (const [p, q, r] of k.wasm.triangulate([rings[f].pts]))
        tris.push(id(f, p), id(f, r), id(f, q));
    if (!open[1])
      for (const [p, q, r] of k.wasm.triangulate([rings[l].pts]))
        tris.push(id(l, p), id(l, q), id(l, r));
  }
  for (const poly of extra) {
    const at = poly.map(([r, j]) => rings[r].pts[j]);
    for (const [p, q, r] of k.wasm.triangulate([at]))
      tris.push(id(...poly[p]), id(...poly[r]), id(...poly[q]));
  }
  const m = new k.wasm.Manifold(
    new k.wasm.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(verts),
      triVerts: new Uint32Array(tris),
    }),
  );
  if (m.status() !== 'NoError') throw new Error(`loft: ${m.status()}`);
  return m;
}
