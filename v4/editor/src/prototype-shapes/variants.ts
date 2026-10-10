// PROTOTYPE, throwaway: alternative chassis shapes for the right hand.
// Every variant uses the same key poses (componentFrames from the default
// config) so only the chassis differs. Visual comparison only: no clearance
// checks, no tile pockets, no wiring space, not printable as-is.
import type { CrossSection, Manifold, ManifoldToplevel, Vec3 } from 'manifold-3d';
import { Matrix4 } from 'three';
import { point, type Config } from '../geometry';
import { capSize, isKey } from '../solid';

export interface Kit {
  wasm: ManifoldToplevel;
  cfg: Config;
  frames: Record<string, Matrix4>;
}
export interface Variant {
  key: string;
  name: string;
  blurb: string;
  build: (k: Kit) => Manifold;
  // Shell and keycap colours, where a shape wants its own.
  color?: number;
  capColor?: number;
  // No trackpad: the viewer leaves the pad out too.
  noPad?: boolean;
  // Height of the split between the case and its bottom section (default: the lowest 2 mm).
  split?: number;
}

const T = 3; // plate thickness
// Swept ends: how far the outermost key's plate may reach into the quarter round.
const CUT = 4;
const COLS = ['inner', 'index', 'middle', 'ring', 'pinky'],
  ROWS = ['top', 'home', 'bottom'];
const keys = (f: Record<string, Matrix4>) => Object.keys(f).filter(isKey);
const thumbs = (k: Kit) =>
  keys(k.frames)
    .filter((n) => n.startsWith('thumb_'))
    .sort((a, b) => k.frames[a].elements[12] - k.frames[b].elements[12]);
const half = (k: Kit, n: string, grow = 0) => {
  const c = capSize(k.cfg, n);
  return [c[0] / 2 + 0.75 + grow, c[1] / 2 + 0.75 + grow];
};
// World point on a key plate: sx,sy in -1..1 across the plate, z along the normal.
const at = (k: Kit, n: string, sx: number, sy: number, z = 0, grow = 0): Vec3 => {
  const [hx, hy] = half(k, n, grow);
  return point(k.frames[n], [sx * hx, sy * hy, z]);
};
const corners = (k: Kit, n: string, grow = 0) =>
  [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => at(k, n, x, y, 0, grow));
const place = (m: Manifold, f: Matrix4) => m.transform(f.elements as never);
const down = (p: Vec3, z = 0): Vec3 => [p[0], p[1], z];
// A keycap's travel envelope, as the editor's clearance check builds it: the cap
// plus its margin, from rest down by the travel.
const capSweep = (k: Kit, n: string) => {
  const z = capSize(k.cfg, n),
    s = k.cfg.switch,
    g = (s.keycap_clearance_overrides_mm as Record<string, number>)[n] ?? s.keycap_clearance_mm;
  return place(
    k.wasm.Manifold.cube([z[0] + 2 * g, z[1] + 2 * g, z[2] + s.travel_mm], true).translate([
      0,
      0,
      s.keycap_bottom_above_plate_mm - s.travel_mm + (z[2] + s.travel_mm) / 2,
    ]),
    k.frames[n],
  );
};

// Plate with a 14 mm switch cutout, in the key's frame.
function plate(k: Kit, n: string, grow = 0) {
  const M = k.wasm.Manifold,
    [hx, hy] = half(k, n, grow);
  const body = M.cube([hx * 2, hy * 2, T], true)
    .translate([0, 0, -T / 2])
    .subtract(M.cube([14, 14, T * 4], true));
  return place(body, k.frames[n]);
}
const plates = (k: Kit, grow = 0) =>
  k.wasm.Manifold.union(keys(k.frames).map((n) => plate(k, n, grow)));
// Plate edge facing a world XY direction, as two corner sign pairs.
function edgeFacing(k: Kit, n: string, dir: [number, number]) {
  const m = k.frames[n].elements,
    edges: [number, number][][] = [
      [
        [1, -1],
        [1, 1],
      ],
      [
        [-1, -1],
        [-1, 1],
      ],
      [
        [-1, 1],
        [1, 1],
      ],
      [
        [-1, -1],
        [1, -1],
      ],
    ];
  const score = (e: [number, number][]) => {
    const sx = (e[0][0] + e[1][0]) / 2,
      sy = (e[0][1] + e[1][1]) / 2;
    return (m[0] * sx + m[4] * sy) * dir[0] + (m[1] * sx + m[5] * sy) * dir[1];
  };
  return edges.reduce((a, b) => (score(b) > score(a) ? b : a));
}

// Bowyer-Watson Delaunay over plate corners, dropping large triangles so the
// roof follows the layout's concave outline (an alpha shape).
function delaunay(pts: [number, number][]) {
  type Tri = [number, number, number];
  const big = 1e4,
    all = [...pts, [-big, -big], [big, -big], [0, big]] as [number, number][],
    n = pts.length;
  let tris: Tri[] = [[n, n + 1, n + 2]];
  const circ = (t: Tri) => {
    const [a, b, c] = t.map((i) => all[i]),
      d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    const ux =
        ((a[0] ** 2 + a[1] ** 2) * (b[1] - c[1]) +
          (b[0] ** 2 + b[1] ** 2) * (c[1] - a[1]) +
          (c[0] ** 2 + c[1] ** 2) * (a[1] - b[1])) /
        d,
      uy =
        ((a[0] ** 2 + a[1] ** 2) * (c[0] - b[0]) +
          (b[0] ** 2 + b[1] ** 2) * (a[0] - c[0]) +
          (c[0] ** 2 + c[1] ** 2) * (b[0] - a[0])) /
        d;
    return { x: ux, y: uy, r: Math.hypot(a[0] - ux, a[1] - uy) };
  };
  pts.forEach((p, i) => {
    const bad = tris.filter((t) => {
      const c = circ(t);
      return Math.hypot(p[0] - c.x, p[1] - c.y) < c.r;
    });
    const edges = new Map<string, [number, number]>();
    for (const t of bad)
      for (let j = 0; j < 3; j++) {
        const a = t[j],
          b = t[(j + 1) % 3],
          key = a < b ? a + ',' + b : b + ',' + a;
        edges.has(key) ? edges.delete(key) : edges.set(key, [a, b]);
      }
    tris = tris.filter((t) => !bad.includes(t));
    for (const [a, b] of edges.values()) tris.push([a, b, i]);
  });
  return tris.filter((t) => t.every((i) => i < n)).map((t) => ({ t, r: circ(t).r }));
}

interface Roof {
  pts: Vec3[];
  top: Vec3[];
  tris: [number, number, number][];
  boundary: [number, number][];
  normal: Map<number, [number, number]>;
}
function roof(k: Kit, alpha = 17, grow = 0): Roof {
  const names = keys(k.frames),
    top = names.flatMap((n) => corners(k, n, grow)),
    pts = names.flatMap((n) =>
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([x, y]) => at(k, n, x, y, -T, grow)),
    );
  const kept = delaunay(top.map((p) => [p[0], p[1]]))
    .filter((x) => x.r < alpha)
    .map((x) => x.t);
  const count = new Map<string, { e: [number, number]; other: number; n: number }>();
  for (const t of kept)
    for (let j = 0; j < 3; j++) {
      const a = t[j],
        b = t[(j + 1) % 3],
        key = a < b ? a + ',' + b : b + ',' + a,
        e = count.get(key);
      e ? e.n++ : count.set(key, { e: [a, b], other: t[(j + 2) % 3], n: 1 });
    }
  const boundary: [number, number][] = [],
    normal = new Map<number, [number, number]>();
  for (const {
    e: [a, b],
    other,
    n,
  } of count.values()) {
    if (n !== 1) continue;
    boundary.push([a, b]);
    const dx = top[b][0] - top[a][0],
      dy = top[b][1] - top[a][1],
      l = Math.hypot(dx, dy);
    let nx = dy / l,
      ny = -dx / l;
    if ((top[other][0] - top[a][0]) * nx + (top[other][1] - top[a][1]) * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    for (const v of [a, b]) {
      const o = normal.get(v) || [0, 0];
      normal.set(v, [o[0] + nx, o[1] + ny]);
    }
  }
  for (const [v, [x, y]] of normal) {
    const l = Math.hypot(x, y) || 1;
    normal.set(v, [x / l, y / l]);
  }
  return { pts, top, tris: kept, boundary, normal };
}
// Continuous faceted web through every plate corner.
const web = (k: Kit, r: Roof) =>
  k.wasm.Manifold.union(
    r.tris.map((t) => k.wasm.Manifold.hull(t.flatMap((i) => [r.top[i], r.pts[i]]))),
  );
function walls(k: Kit, r: Roof, out: number, drop: number, w = 2) {
  const M = k.wasm.Manifold,
    off = (i: number, d: number, z: number): Vec3 => {
      const n = r.normal.get(i)!,
        p = r.pts[i];
      return [p[0] + n[0] * d, p[1] + n[1] * d, z];
    };
  return M.union(
    r.boundary.flatMap(([a, b]) => {
      const za = r.pts[a][2] - drop,
        zb = r.pts[b][2] - drop;
      return [
        M.hull([
          r.top[a],
          r.top[b],
          r.pts[a],
          r.pts[b],
          off(a, out, za),
          off(b, out, zb),
          off(a, out + w, za),
          off(b, out + w, zb),
          off(a, out + w, r.top[a][2] - 0.5),
          off(b, out + w, r.top[b][2] - 0.5),
        ]),
        M.hull([
          off(a, out, za),
          off(b, out, zb),
          off(a, out + w, za),
          off(b, out + w, zb),
          off(a, out, 0),
          off(b, out, 0),
          off(a, out + w, 0),
          off(b, out + w, 0),
        ]),
      ];
    }),
  );
}
// Plan-view footprint of the layout, closed across the gaps between keys.
function footprint(k: Kit, grow: number, close = 8) {
  const CS = k.wasm.CrossSection,
    names = keys(k.frames);
  const cs = CS.union(
    names.map((n) => new CS([corners(k, n, 1).map((p) => [p[0], p[1]] as [number, number])])),
  );
  return cs.offset(close, 'Round', 2, 24).offset(-close + grow, 'Round', 2, 24);
}
function hexHoles(k: Kit, region: ReturnType<typeof footprint>, z: number, h: number) {
  const M = k.wasm.Manifold,
    holes: Manifold[] = [],
    b = region.bounds();
  for (let y = b.min[1], row = 0; y < b.max[1]; y += 9, row++)
    for (let x = b.min[0] + (row % 2) * 5.2; x < b.max[0]; x += 10.4)
      holes.push(
        M.cylinder(h + 2, 4.6, 4.6, 6)
          .rotate([0, 0, 30])
          .translate([x, y, z - 1]),
      );
  return M.union(holes).intersect(
    region
      .offset(-5, 'Round')
      .extrude(h + 4)
      .translate([0, 0, z - 2]),
  );
}

// Cirque TM040040 (40 mm) in a printed pod, clipped to the inner side.
export function cirque(k: Kit, link: 'bracket' | 'none' = 'bracket') {
  const M = k.wasm.Manifold,
    f = k.frames.trackpad.clone().multiply(new Matrix4().makeTranslation(0, 0, -0.5));
  let pod = place(
    M.cylinder(7, 22.5, 22.5, 64)
      .translate([0, 0, -6.5])
      .subtract(M.cylinder(2, 20.4, 20.4, 64).translate([0, 0, -0.5])),
    f,
  );
  if (link === 'bracket') {
    const c = point(f, [0, 0, -4]),
      dist = (p: Vec3) => Math.hypot(p[0] - c[0], p[1] - c[1]);
    const near = ['thumb_far']
      .flatMap((n) =>
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([sx, sy]) => ({ n, sx, sy, p: at(k, n, sx, sy) })),
      )
      .sort((a, b) => dist(a.p) - dist(b.p))
      .slice(0, 2);
    const rim = near.map(({ p }) => {
      const d = [p[0] - c[0], p[1] - c[1]],
        l = Math.hypot(d[0], d[1]);
      return point(f, [0, 0, 0]).map((v, i) => (i < 2 ? c[i] + (d[i] / l) * 20 : c[2])) as Vec3;
    });
    // Anchored to the two corners of the far thumb key nearest the pod (the
    // inner column's corners left it loose once the thumbs moved), below each
    // corner along the key's own normal, 0.6 mm inside the
    // plate edge, so the bracket reaches into the key's wall even on a tilted key.
    pod = pod.add(
      M.hull([
        ...rim.flatMap((p) => [p, [p[0], p[1], p[2] - 4] as Vec3]),
        ...near.flatMap(({ n, sx, sy }) => [
          at(k, n, sx, sy, -T, 0.8),
          at(k, n, sx, sy, -T - 4, 0.8),
        ]),
      ]),
    );
  }
  return pod;
}
export const cirquePad = (k: Kit) =>
  place(
    k.wasm.Manifold.cylinder(1, 20, 20, 64).translate([0, 0, -1.4]),
    k.frames.trackpad.clone().multiply(new Matrix4().makeTranslation(0, 0, -0.5)),
  );

function faceted(k: Kit, pockets: boolean) {
  const M = k.wasm.Manifold,
    CS = k.wasm.CrossSection,
    pts = (names: string[]) => names.flatMap((n) => corners(k, n, 0.5));
  // Convex lump over some keys, down to a chamfered foot.
  const lump = (names: string[]) => {
    const cs = CS.hull(
        names.map((n) => new CS([corners(k, n, 1).map((p) => [p[0], p[1]] as [number, number])])),
      ),
      ring = (d: number, z: number) =>
        cs
          .offset(d, 'Miter')
          .toPolygons()
          .flat()
          .map(([x, y]) => [x, y, z] as Vec3);
    return M.hull([...pts(names), ...ring(2, 0), ...ring(4, 4)]);
  };
  const fingers = COLS.flatMap((c) => ROWS.map((r) => `matrix_${c}_${r}`)),
    base = thumbs(k).filter((n) => !n.startsWith('thumb_x')),
    extra = thumbs(k).filter((n) => n.startsWith('thumb_x'));
  let body = M.union([
    lump(fingers),
    lump(base),
    lump(['matrix_inner_bottom', 'matrix_index_bottom', ...base]),
    ...(extra.length
      ? [lump(extra), lump([...extra, 'matrix_middle_bottom', 'matrix_index_bottom'])]
      : []),
  ]);
  if (pockets)
    for (const n of keys(k.frames)) {
      const [hx, hy] = half(k, n, -0.25);
      body = body
        .subtract(place(M.cube([hx * 2, hy * 2, 60], true).translate([0, 0, 30]), k.frames[n]))
        .subtract(place(M.cube([14, 14, 20], true), k.frames[n]));
    }
  return body;
}
// Round creases (minSmoothness gives sharp edges a small fillet), then recut
// the switch holes and keycap clearance so they stay crisp.
function soften(k: Kit, m: Manifold, angle: number, smooth: number, levels: number) {
  return cutKeys(k, m.smoothOut(angle, smooth).refine(levels));
}
function cutKeys(k: Kit, m: Manifold) {
  const M = k.wasm.Manifold;
  for (const n of keys(k.frames)) {
    const [hx, hy] = half(k, n, -0.25);
    m = m
      .subtract(place(M.cube([14, 14, 20], true), k.frames[n]))
      .subtract(place(M.cube([hx * 2, hy * 2, 60], true).translate([0, 0, 30]), k.frames[n]));
  }
  return m;
}
type Edge = [number, number][];
// Solid strip along a plate edge: z0..z1 along the normal, grown g0..g1 outward.
const strip = (
  k: Kit,
  n: string,
  e: Edge,
  z0: number,
  z1: number,
  g0: number,
  g1: number,
): Vec3[] =>
  e.flatMap(([sx, sy]) => [z0, z1].flatMap((z) => [g0, g1].map((g) => at(k, n, sx, sy, z, g))));
const toward = (k: Kit, a: string, b: string): [number, number] => {
  const p = k.frames[a].elements,
    q = k.frames[b].elements;
  return [q[12] - p[12], q[13] - p[13]];
};
function ladder(k: Kit, names: string[], G: number, D: number, sides: [number, number][]) {
  const M = k.wasm.Manifold,
    parts: Manifold[] = [];
  for (const n of names)
    parts.push(
      place(
        M.cube([half(k, n, G)[0] * 2, half(k, n, G)[1] * 2, T], true).translate([0, 0, -T / 2]),
        k.frames[n],
      ),
    );
  for (let i = 0; i + 1 < names.length; i++) {
    const a = names[i],
      b = names[i + 1];
    parts.push(
      M.hull([
        ...strip(k, a, edgeFacing(k, a, toward(k, a, b)), 0, -T, 0, G),
        ...strip(k, b, edgeFacing(k, b, toward(k, b, a)), 0, -T, 0, G),
      ]),
    );
  }
  // One flat skirt per key, so no twisted faces between keys at different angles.
  for (const d of sides)
    for (const n of names) parts.push(M.hull(strip(k, n, edgeFacing(k, n, d), 0, -D, G - 1.2, G)));
  return M.union(parts);
}
// Opening through a wall facing roughly along world x or y: rounded corners
// of radius r, placed inside the given quad corners.
function roundedWindow(k: Kit, quad: Vec3[], r: number, axis: 'x' | 'y') {
  const M = k.wasm.Manifold,
    c = [0, 1, 2].map((i) => quad.reduce((a, p) => a + p[i], 0) / quad.length);
  return M.hull(
    quad.map((p) => {
      const d = [c[0] - p[0], c[1] - p[1], c[2] - p[2]],
        l = Math.hypot(...d) || 1,
        q = p.map((v, i) => v + (d[i] / l) * r * 1.2);
      return M.cylinder(60, r, r, 32, true)
        .rotate(axis === 'x' ? [0, 90, 0] : [90, 0, 0])
        .translate(q as Vec3);
    }),
  );
}
// Quarter-round end on a column: continues the plate top over an arc of
// radius R away from the key (local y sign sy), then drops to the tray.
// fit: pick each side's radius from a function giving that side's arc end for a radius.
function endCap(
  k: Kit,
  n: string,
  e: Edge,
  G: number,
  R = 9,
  w = 2.4,
  fit?: (end: (r: number) => Vec3) => number,
) {
  // The edge's shared corner sign picks the local axis the cap rolls along.
  const M = k.wasm.Manifold,
    alongX = e[0][0] === e[1][0],
    sy = alongX ? e[0][0] : e[0][1],
    [ha, hb] = half(k, n, G),
    [hx, hy] = alongX ? [hb, ha] : [ha, hb],
    steps = 6,
    parts: Manifold[] = [];
  const pt = (x: number, th: number, r: number, Rc: number) => {
    const a = sy * (hy + r * Math.sin(th)),
      z = -Rc + r * Math.cos(th);
    return point(k.frames[n], alongX ? [a, x, z] : [x, a, z]) as Vec3;
  };
  const Rs = [-hx, hx].map((x) => (fit ? fit((r) => pt(x, Math.PI / 2, r, r)) : R));
  const ring = (th: number) =>
    [-hx, hx].flatMap((x, j) => [pt(x, th, Rs[j], Rs[j]), pt(x, th, Rs[j] - w, Rs[j])]);
  for (let i = 0; i < steps; i++)
    parts.push(
      M.hull([...ring(((i / steps) * Math.PI) / 2), ...ring((((i + 1) / steps) * Math.PI) / 2)]),
    );
  // Overlap the plate by 0.5 mm: a face-to-face touch does not join the solids.
  const inset = (x: number, z: number) =>
    point(k.frames[n], alongX ? [sy * (hy - 0.5), x, z] : [x, sy * (hy - 0.5), z]) as Vec3;
  parts.push(M.hull([...ring(0), ...[-hx, hx].flatMap((x) => [inset(x, 0), inset(x, -w)])]));
  // The drop to the tray is built later, once the tray outline is known.
  const o = point(k.frames[n], [0, 0, 0]),
    a = point(k.frames[n], alongX ? [sy, 0, 0] : [0, sy, 0]),
    l = Math.hypot(a[0] - o[0], a[1] - o[1]);
  capDrops.push({ ring: ring(Math.PI / 2), dir: [(a[0] - o[0]) / l, (a[1] - o[1]) / l] });
  // Every arc step, since on a tilted key the arc reaches farthest in plan partway round.
  capFloors.push(
    Array.from({ length: steps + 1 }, (_, i) => ring(((i / steps) * Math.PI) / 2))
      .flat()
      .map((p) => [p[0], p[1]] as [number, number]),
  );
  return M.union(parts);
}
let capFloors: [number, number][][] = [],
  capDrops: Drop[] = [];
// sides: the vertical wall's two side edges once built, outer and inner face, at the top of the wall.
// ring: the cap's last arc step, [outer,inner] at one side then the other. dir: plan direction the cap rolls.
interface Drop {
  ring: Vec3[];
  dir: [number, number];
  sides?: { o: Vec3; i: Vec3 }[];
}
// Convex hull of loose 2D points (monotone chain). new CrossSection([pts]) treats
// the points as an outline, and its fill rule drops parts of a self-crossing one.
function hull2(ps: [number, number][]): [number, number][] {
  const s = [...ps].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    x = (o: number[], a: number[], b: number[]) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (pts: [number, number][]) => {
    const h: [number, number][] = [];
    for (const p of pts) {
      while (h.length > 1 && x(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(s), ...half(s.reverse())];
}
// Debug: ?only=a,b keeps just the named Skeletyl parts; ?nocut=1 skips recutting keys.
const qp =
    typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search),
  only = qp.get('only')?.split(',');
export let skelOutside: string[] = [],
  skelHits: string[] = [];
// Debug: ?hl=a,b draws the named Skeletyl part tags in orange (none by default).
const hl = qp.get('hl')?.split(',') ?? [];
export let skelHighlight: Manifold[] = [],
  skelHighlightInfo: string[] = [];
export const noCut = qp.get('nocut') === '1';
// Smooth plan curve across one end of the finger columns (e 0: back, 1: front),
// in axes dm (the mean direction the column ends face) and ax across it:
// f = F(a), a quadratic least-squares fit through each column's end corners
// pushed out by R, then moved out until it is at least Rmin past every corner.
interface Curve {
  dm: [number, number];
  ax: [number, number];
  F: (a: number) => number;
  corners: { a: number; f: number; z: number; c: number }[];
}
function rollDir(k: Kit, n: string, e: Edge): [number, number] {
  const alongX = e[0][0] === e[1][0],
    sy = alongX ? e[0][0] : e[0][1],
    o = point(k.frames[n], [0, 0, 0]),
    a = point(k.frames[n], alongX ? [sy, 0, 0] : [0, sy, 0]),
    l = Math.hypot(a[0] - o[0], a[1] - o[1]);
  return [(a[0] - o[0]) / l, (a[1] - o[1]) / l];
}
function endCurve(k: Kit, e: 0 | 1, G: number, R: number, Rmin: number): Curve {
  return curveThrough(
    k,
    COLS.map((c) => `matrix_${c}_${e ? 'bottom' : 'top'}`),
    [0, e ? -1 : 1],
    G,
    R,
    Rmin,
  );
}
// The same fit through the edges of any row of keys that face one way.
function curveThrough(
  k: Kit,
  ends: string[],
  facing: [number, number],
  G: number,
  R: number,
  Rmin: number,
): Curve {
  const edges = ends.map((n) => edgeFacing(k, n, facing));
  const ds = ends.map((n, i) => rollDir(k, n, edges[i])),
    s = ds.reduce((a, d) => [a[0] + d[0], a[1] + d[1]], [0, 0]),
    l = Math.hypot(s[0], s[1]);
  const dm: [number, number] = [s[0] / l, s[1] / l],
    ax: [number, number] = [-dm[1], dm[0]];
  const corners = ends.flatMap((n, c) =>
    edges[c].map(([sx, sy]) => {
      const p = at(k, n, sx, sy, 0, G);
      return { a: p[0] * ax[0] + p[1] * ax[1], f: p[0] * dm[0] + p[1] * dm[1], z: p[2], c };
    }),
  );
  // Normal equations for f+R = c0 + c1 a + c2 a^2.
  const S = (pa: number, pf = 0) => corners.reduce((t, q) => t + q.a ** pa * (pf ? q.f + R : 1), 0),
    A = [
      [S(0), S(1), S(2)],
      [S(1), S(2), S(3)],
      [S(2), S(3), S(4)],
    ],
    b = [S(0, 1), S(1, 1), S(2, 1)];
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  // One key: its edge is square to the roll, so the curve is a straight line along it.
  const cf =
    ends.length < 2
      ? [S(0, 1) / S(0), 0, 0]
      : [0, 1, 2].map(
          (j) => det(A.map((r, i) => r.map((v, jj) => (jj === j ? b[i] : v)))) / det(A),
        );
  const F0 = (a: number) => cf[0] + cf[1] * a + cf[2] * a * a,
    shift = Math.max(0, ...corners.map((q) => q.f + Rmin - F0(q.a)));
  return { dm, ax, F: (a) => F0(a) + shift, corners };
}
interface SkelOpts {
  rim: 'tray' | 'bridged';
  drop: 'square' | 'angled' | 'fitted' | 'swept';
  thumbFront?: 'gusset' | 'swept';
}
function skeletyl(k: Kit, o: SkelOpts = { rim: 'tray', drop: 'square' }) {
  // Original: convex tray 3 mm past the caps with a 3.5 mm rim. Angled: the
  // tray hugs the columns, 1 mm past the end walls, with a 2 mm rim.
  const margin = o.drop === 'angled' ? 1 : 3,
    rimW = o.drop === 'angled' ? 2 : 3.5;
  capFloors = [];
  capDrops = [];
  skelHighlight = [];
  skelHighlightInfo = [];
  const M = k.wasm.Manifold,
    CS = k.wasm.CrossSection,
    G = 1.4,
    D = 8,
    all: Manifold[] = [],
    tags: string[] = [];
  let tag = '';
  // Plan points of a key: plate corners and skirt bottoms (tilted keys hang past their plate).
  const keyPts = (n: string) =>
    [
      ...corners(k, n, G),
      ...[
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([x, y]) => at(k, n, x, y, -D, G)),
    ].map((p) => [p[0], p[1]] as [number, number]);
  // Plan outline of each column or thumb row with its rolled ends and end walls,
  // built once the end walls are known. Columns come first.
  const specs: { names: string[]; lo: number; hi: number }[] = [],
    outline = (names: string[], caps: number) =>
      specs.push({ names, lo: capFloors.length - caps, hi: capFloors.length });
  const parts = {
    push: (...ms: Manifold[]) => {
      if (!only || only.includes(tag))
        for (const m of ms) {
          all.push(m);
          tags.push(tag);
        }
    },
  };
  const floorOf = (ps: Vec3[]) => [...ps, ...ps.map((p) => down(p, 1))];
  const W = 2.4,
    curves =
      o.drop === 'fitted'
        ? [endCurve(k, 0, G, 9, 6), endCurve(k, 1, G, 9, 6)]
        : o.drop === 'swept'
          ? [endCurve(k, 0, G, 9, 9 - CUT), endCurve(k, 1, G, 9, 9 - CUT)]
          : undefined;
  const P = (cv: Curve, a: number, f: number, z: number): Vec3 => [
    cv.ax[0] * a + cv.dm[0] * f,
    cv.ax[1] * a + cv.dm[1] * f,
    z,
  ];
  // Swept end: one quarter round of radius 9 swept along a curve through the
  // facing edges of a row of end keys, its top following their heights (linear
  // between corners), then a wall to the base. Each key's surface continues flat
  // out to it. With slots, round-bottomed slots part neighbouring keys down to
  // half the wall height.
  const sweptEnd = (cv: Curve, ends: string[], facing: [number, number], slots: boolean) => {
    const R = 9,
      cs = [...cv.corners].sort((x, y) => x.a - y.a),
      a0 = cs[0].a,
      a1 = cs.at(-1)!.a;
    const zs = (a: number) => {
      for (let i = 0; i + 1 < cs.length; i++)
        if (a <= cs[i + 1].a) {
          const t = (a - cs[i].a) / (cs[i + 1].a - cs[i].a || 1);
          return cs[i].z * (1 - t) + cs[i + 1].z * t;
        }
      return cs.at(-1)!.z;
    };
    const as = [
      ...new Set([
        ...cs.map((q) => q.a),
        ...Array.from({ length: Math.ceil((a1 - a0) / 3) }, (_, i) => a0 + i * 3),
      ]),
    ].sort((x, y) => x - y);
    const prof = (a: number, th: number, r: number) =>
      P(cv, a, cv.F(a) - R + r * Math.sin(th), zs(a) - R + r * Math.cos(th));
    const sweep: Manifold[] = [];
    for (let i = 0; i + 1 < as.length; i++) {
      const [p, q] = [as[i], as[i + 1]];
      for (let j = 0; j < 6; j++) {
        const t0 = ((j / 6) * Math.PI) / 2,
          t1 = (((j + 1) / 6) * Math.PI) / 2;
        sweep.push(
          M.hull(
            [p, q].flatMap((a) => [
              prof(a, t0, R),
              prof(a, t0, R - W),
              prof(a, t1, R),
              prof(a, t1, R - W),
            ]),
          ),
        );
      }
      sweep.push(
        M.hull(
          [p, q]
            .flatMap((a) => [prof(a, Math.PI / 2, R), prof(a, Math.PI / 2, R - W)])
            .flatMap((v) => [v, down(v, 1)]),
        ),
      );
    }
    // Flat continuation of each column's end key out to the swept end, 0.5 mm into it.
    ends.forEach((n, ci) => {
      const ed = edgeFacing(k, n, facing),
        q = cv.corners.filter((x) => x.c === ci);
      sweep.push(
        M.hull([
          ...ed.flatMap(([sx, sy]) => [at(k, n, sx, sy, 0, G), at(k, n, sx, sy, -W, G)]),
          ...q.flatMap((x) => [
            P(cv, x.a, cv.F(x.a) - R + 0.5, x.z),
            P(cv, x.a, cv.F(x.a) - R + 0.5, x.z - W),
          ]),
        ]),
      );
    });
    let end = M.union(sweep);
    if (slots)
      for (let ci = 0; ci + 1 < ends.length; ci++) {
        const side = (c: number, o: number) => {
            const m = cv.corners.filter((x) => x.c === o).reduce((t, x) => t + x.a / 2, 0);
            return cv.corners
              .filter((x) => x.c === c)
              .sort((x, y) => Math.abs(x.a - m) - Math.abs(y.a - m))[0];
          },
          l = side(ci, ci + 1),
          r = side(ci + 1, ci),
          am = (l.a + r.a) / 2,
          hw = Math.max(1.5, Math.abs(r.a - l.a) / 2);
        const zj = 1 + (Math.min(zs(l.a), zs(r.a)) - R - 1) / 2,
          f0 = Math.min(cv.F(l.a), cv.F(r.a)) - R - 0.2,
          f1 = Math.max(cv.F(l.a), cv.F(r.a)) + 3;
        // Round-bottomed slot: a cylinder along dm at the bottom, hulled with the top.
        const cyl = (f: number) => M.sphere(hw, 16).translate(P(cv, am, f, zj + hw));
        end = end.subtract(
          M.hull([
            cyl(f0),
            cyl(f1),
            ...[f0, f1].flatMap((f) => [-hw, hw].map((da) => P(cv, am + da, f, 120))),
          ]),
        );
      }
    capFloors.push(
      as
        .flatMap((a) => [prof(a, Math.PI / 2, R), prof(a, Math.PI / 4, R)])
        .map((p) => [p[0], p[1]] as [number, number]),
    );
    return end;
  };
  for (const c of COLS) {
    const col = ROWS.map((r) => `matrix_${c}_${r}`);
    tag = 'ladder';
    parts.push(
      ladder(k, col, G, D, [
        [1, 0],
        [-1, 0],
      ]),
    );
    // Column ends roll over in a quarter round, then drop to the tray. Fitted:
    // each side's radius is chosen so the arc ends on the end curve. Swept: no
    // per-column ends; one rolled end is swept along each curve below.
    const fitTo = (cv: Curve) => (end: (r: number) => Vec3) => {
      let r = 9;
      for (let i = 0; i < 4; i++) {
        const g = (r: number) => {
            const p = end(r),
              a = p[0] * cv.ax[0] + p[1] * cv.ax[1];
            return p[0] * cv.dm[0] + p[1] * cv.dm[1] - cv.F(a);
          },
          g0 = g(r),
          d = (g(r + 0.5) - g0) / 0.5;
        r -= g0 / d;
      }
      return Math.max(r, 3);
    };
    tag = 'cap';
    if (o.drop !== 'swept')
      parts.push(
        endCap(k, col[0], edgeFacing(k, col[0], [0, 1]), G, 9, 2.4, curves && fitTo(curves[0])),
        endCap(k, col[2], edgeFacing(k, col[2], [0, -1]), G, 9, 2.4, curves && fitTo(curves[1])),
      );
    outline(col, o.drop === 'swept' ? 0 : 2);
  }
  // Outer side wall with a slot.
  const pinky = ROWS.map((r) => `matrix_pinky_${r}`),
    side = pinky.flatMap((n) => strip(k, n, edgeFacing(k, n, [1, 0]), -D + 1, -D, G - 2, G));
  let wall = M.hull(floorOf(side));
  const xs = side.map((p) => p[0]),
    ys = side.map((p) => p[1]),
    x = Math.max(...xs),
    y0 = Math.min(...ys) + 12,
    y1 = Math.max(...ys) - 12;
  wall = wall.subtract(
    M.hull(
      [y0, y1].map((y) =>
        M.cylinder(20, 4.5, 4.5, 32, true).rotate([0, 90, 0]).translate([x, y, 10]),
      ),
    ),
  );
  tag = 'outer';
  parts.push(wall);
  // Inner support: a solid wall under the inner column, joined to the thumb rows.
  const inner = ROWS.map((r) => `matrix_inner_${r}`);
  // Start from the skirt bottoms: the inner keys tilt, so their tiles hang past the plate edge.
  // A frame rather than a solid wall: a rounded opening under each key, posts
  // between keys where the column joins sit.
  let innerWall = M.hull(
    floorOf(inner.flatMap((n) => strip(k, n, edgeFacing(k, n, [-1, 0]), -D, -D, G - 1.2, G))),
  );
  for (const n of inner) {
    const e = edgeFacing(k, n, [-1, 0]),
      [p, q] = [at(k, n, e[0][0], e[0][1] * 0.62, -D, G), at(k, n, e[1][0], e[1][1] * 0.62, -D, G)];
    innerWall = innerWall.subtract(
      roundedWindow(
        k,
        [
          [p[0], p[1], p[2] - 4],
          [q[0], q[1], q[2] - 4],
          [q[0], q[1], 11],
          [p[0], p[1], 11],
        ],
        3.5,
        'x',
      ),
    );
  }
  tag = 'inner';
  parts.push(innerWall);
  const base3 = thumbs(k).filter((n) => !n.startsWith('thumb_x'));
  const support = M.hull(
    floorOf(
      [
        ...strip(
          k,
          'matrix_inner_bottom',
          edgeFacing(k, 'matrix_inner_bottom', [0, -1]),
          -D,
          -D,
          G - 1.2,
          G,
        ),
        ...base3.flatMap((n) => strip(k, n, edgeFacing(k, n, [0, 1]), -D, -D, G - 1.2, G)),
      ].filter((p) => p[0] < -30),
    ),
  );
  // Trimmed under the keycaps: the hull rises from the thumb row to the inner
  // column, into the travel of the thumb keycaps that overhang their plates.
  tag = 'support';
  parts.push(
    o.thumbFront === 'swept'
      ? support.subtract(M.union([...base3, ...inner].map((n) => capSweep(k, n))))
      : support,
  );
  // Thumb rows on a front gusset with a triangular window.
  for (const g of [
    thumbs(k).filter((n) => !n.startsWith('thumb_x')),
    thumbs(k).filter((n) => n.startsWith('thumb_x')),
  ].filter((g) => g.length)) {
    tag = 'tladder';
    parts.push(
      ladder(k, g, G, D, [
        [0, 1],
        [0, -1],
      ]),
    );
    const sweepEnds = o.thumbFront === 'swept' && g.length > 1;
    tag = 'tcap';
    if (g.length > 1 && !sweepEnds)
      parts.push(
        endCap(k, g[0], edgeFacing(k, g[0], toward(k, g[1], g[0])), G),
        endCap(k, g.at(-1)!, edgeFacing(k, g.at(-1)!, toward(k, g.at(-2)!, g.at(-1)!)), G),
      );
    if (sweepEnds) {
      // Swept ends: the thumb row runs left to right, so like a finger column it
      // rolls over at its two ends, built by the same swept-end code as the columns.
      tag = 'tcap';
      for (const [n, m] of [
        [g[0], g[1]],
        [g.at(-1)!, g.at(-2)!],
      ]) {
        const d = toward(k, m, n);
        parts.push(sweptEnd(curveThrough(k, [n], d, G, 9, 9 - CUT), [n], d, false));
      }
    }
    outline(g, g.length > 1 ? 2 : 0);
    const front = g.flatMap((n) => strip(k, n, edgeFacing(k, n, [0, -1]), -T, -T, G - 2, G));
    // Swept thumbs: the wall follows the row's well, one piece per pair of
    // neighbouring keys, so its top doesn't bridge above the lower middle key.
    let gusset = sweepEnds
      ? M.union(
          g
            .slice(1)
            .map((n, i) =>
              M.hull(
                floorOf(
                  [g[i], n].flatMap((q) =>
                    strip(k, q, edgeFacing(k, q, [0, -1]), -T, -T, G - 2, G),
                  ),
                ),
              ),
            ),
        )
      : M.hull(floorOf(front));
    if (g.length > 1) {
      // Window follows the sloping top of the wall, 4 mm below it, above the rim.
      // Swept thumbs: level with the lowest key's front edge, 4 mm below it.
      const a = g[0],
        b = g.at(-1)!,
        topAt = (n: string, t: number) => {
          const e = edgeFacing(k, n, [0, -1]),
            p = at(
              k,
              n,
              e[0][0] * (1 - t) + e[1][0] * t,
              e[0][1] * (1 - t) + e[1][1] * t,
              -T,
              G - 1,
            );
          return p;
        };
      const ta = topAt(a, 0.5),
        tb = topAt(b, 0.5),
        zl = Math.min(...g.map((n) => topAt(n, 0.5)[2]));
      if (sweepEnds) {
        ta[2] = zl;
        tb[2] = zl;
      }
      const quad: Vec3[] = [
        [ta[0], ta[1], ta[2] - 4],
        [tb[0], tb[1], tb[2] - 4],
        [tb[0], tb[1], 10],
        [ta[0], ta[1], 10],
      ];
      gusset = gusset.subtract(
        roundedWindow(k, quad, 4, 'y').intersect(
          M.hull(floorOf(front.map((p) => [p[0], p[1], p[2] - 3] as Vec3))),
        ),
      );
    }
    tag = 'gusset';
    parts.push(gusset);
  }
  // Swept thumbs: a thumb row close in front of the main one gets a back wall
  // too, following its well, and a low web joins that wall to the main row's
  // front wall across the few millimetres between them, up to half height.
  const xt0 = thumbs(k).filter((n) => n.startsWith('thumb_x'));
  if (o.thumbFront === 'swept' && xt0.length) {
    const back = (n: string) => strip(k, n, edgeFacing(k, n, [0, 1]), -T, -T, G - 2, G),
      a = base3.flatMap((n) => strip(k, n, edgeFacing(k, n, [0, -1]), -T, -T, G - 2, G)),
      b = xt0.flatMap(back);
    const d = (p: Vec3, ps: Vec3[]) =>
      Math.min(...ps.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
    if (Math.min(...a.map((p) => d(p, b))) < 15) {
      tag = 'tback';
      parts.push(
        M.union(
          xt0.length > 1
            ? xt0.slice(1).map((n, i) => M.hull(floorOf([...back(xt0[i]), ...back(n)])))
            : [M.hull(floorOf(b))],
        ),
      );
      // Only the facing stretches of the two walls, so the web stays narrow.
      const zj = 1 + (Math.min(...b.map((p) => p[2])) - 1) / 2,
        near = [...a.filter((p) => d(p, b) < 15), ...b.filter((p) => d(p, a) < 15)];
      tag = 'tjoin';
      parts.push(
        M.hull(
          near.flatMap(
            (p) =>
              [
                [p[0], p[1], 1],
                [p[0], p[1], zj],
              ] as Vec3[],
          ),
        ),
      );
    }
  }
  // End walls from each rolled end down to the tray. Square: straight down from
  // the arc. Angled: column end walls turn about the vertical axis to run along
  // the line through the neighbouring column ends, pushed out just far enough to
  // clear the arc on both sides. Where the wall stands out past the arc, its top
  // drops at 45 degrees from the arc end instead of leaving a flat shelf. Column c's back and front ends are drops 2c and 2c+1.
  const mid = (d: Drop) => [(d.ring[0][0] + d.ring[2][0]) / 2, (d.ring[0][1] + d.ring[2][1]) / 2];
  tag = 'drop';
  capDrops.forEach((d, i) => {
    if (o.drop !== 'angled') {
      parts.push(M.hull([...d.ring, ...d.ring.map((p) => down(p, 1))]));
      d.sides = [
        { o: d.ring[0], i: d.ring[1] },
        { o: d.ring[2], i: d.ring[3] },
      ];
      return;
    }
    let nrm = d.dir;
    if (i < COLS.length * 2) {
      const c = i >> 1,
        e = i & 1,
        a = mid(capDrops[Math.max(0, c - 1) * 2 + e]),
        b = mid(capDrops[Math.min(COLS.length - 1, c + 1) * 2 + e]),
        l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      nrm = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
      if (nrm[0] * d.dir[0] + nrm[1] * d.dir[1] < 0) nrm = [-nrm[0], -nrm[1]];
    }
    const dot = (p: number[], q: number[]) => p[0] * q[0] + p[1] * q[1],
      outer = [d.ring[0], d.ring[2]],
      reach = Math.max(...outer.map((p) => dot(p, nrm)));
    const wall = outer.flatMap((p) => {
      const t = (reach - dot(p, nrm)) / dot(d.dir, nrm),
        h: Vec3 = [p[0] + d.dir[0] * t, p[1] + d.dir[1] * t, p[2] - t];
      return [h, [h[0] - nrm[0] * 2.4, h[1] - nrm[1] * 2.4, h[2]] as Vec3];
    });
    parts.push(M.hull([...d.ring, ...wall]), M.hull([...wall, ...wall.map((p) => down(p, 1))]));
    capFloors[i].push(...wall.map((p) => [p[0], p[1]] as [number, number]));
    d.sides = [
      { o: wall[0], i: wall[1] },
      { o: wall[2], i: wall[3] },
    ];
  });
  // Bridged: neighbouring columns' end walls are one wall in their lower half.
  // Where the columns are staggered, the shorter column's end wall carries on
  // across the gap to the longer column's side line, and a wall along that side
  // runs out to the longer column's end wall.
  const joins: Manifold[] = [];
  if (o.rim === 'bridged' && (o.drop === 'square' || o.drop === 'angled'))
    for (let c = 0; c + 1 < COLS.length; c++)
      for (const e of [0, 1]) {
        const a = capDrops[c * 2 + e],
          b = capDrops[(c + 1) * 2 + e];
        const sub = (p: number[], q: number[]) => [p[0] - q[0], p[1] - q[1]],
          len = (v: number[]) => Math.hypot(v[0], v[1]),
          unit = (v: number[]) => {
            const l = len(v);
            return [v[0] / l, v[1] / l];
          };
        // Facing side of each wall: the one nearer the other column's wall.
        const face = (x: Drop, y: Drop) => {
          const m = [
              (y.sides![0].o[0] + y.sides![1].o[0]) / 2,
              (y.sides![0].o[1] + y.sides![1].o[1]) / 2,
            ],
            j = len(sub(x.sides![0].o, m)) < len(sub(x.sides![1].o, m)) ? 0 : 1;
          return { f: x.sides![j], other: x.sides![1 - j] };
        };
        const fa = face(a, b),
          fb = face(b, a),
          dm = unit([a.dir[0] + b.dir[0], a.dir[1] + b.dir[1]]);
        const along = (p: number[]) => p[0] * dm[0] + p[1] * dm[1],
          [L, S, fl, fs] = along(fa.f.o) > along(fb.f.o) ? [a, b, fa, fb] : [b, a, fb, fa];
        const zTop = Math.min(fa.f.o[2], fb.f.o[2]),
          zj = 1 + (zTop - 1) / 2;
        // C: where the shorter wall's outer face line meets the longer column's side line.
        const u = unit(sub(fs.f.o, fs.other.o)),
          p0 = fs.f.o,
          q0 = fl.f.o,
          dl = L.dir,
          den = u[0] * dl[1] - u[1] * dl[0];
        const t = ((q0[0] - p0[0]) * dl[1] - (q0[1] - p0[1]) * dl[0]) / den,
          C = [p0[0] + u[0] * t, p0[1] + u[1] * t];
        const inS = [-S.dir[0] * W, -S.dir[1] * W],
          inL = unit(sub(fl.other.o, fl.f.o)).map((v) => v * W);
        const col = (ps: number[][]) =>
          ps.flatMap(
            (p) =>
              [
                [p[0], p[1], 1],
                [p[0], p[1], zj],
              ] as Vec3[],
          );
        // Across the gap, from 1 mm inside the shorter column's wall to past the corner,
        // so it overlaps both that wall and the side piece.
        const sO = [fs.f.o[0] - u[0], fs.f.o[1] - u[1]],
          sI = [fs.f.i[0] - u[0], fs.f.i[1] - u[1]];
        const Cx = [C[0] + u[0] * W, C[1] + u[1] * W];
        joins.push(M.hull(col([sO, sI, Cx, [Cx[0] + inS[0], Cx[1] + inS[1]]])));
        // Along the longer column's side, from a wall's thickness behind the corner
        // (overlapping the piece across the gap) into its end wall.
        const lEnd = [fl.f.o[0] - (dl[0] * W) / 2, fl.f.o[1] - (dl[1] * W) / 2];
        const Ci = [C[0] - dl[0] * W, C[1] - dl[1] * W];
        joins.push(
          M.hull(
            col([Ci, [Ci[0] + inL[0], Ci[1] + inL[1]], lEnd, [lEnd[0] + inL[0], lEnd[1] + inL[1]]]),
          ),
        );
      }
  // Fitted: one wall along each end curve, through every column's end corners,
  // from the base to half the end walls' height, joins the columns' lower halves.
  if (o.drop === 'fitted')
    for (const e of [0, 1]) {
      const cv = curves![e],
        pts = COLS.flatMap((_, c) => {
          const d = capDrops[c * 2 + e];
          return [d.ring[0], d.ring[2]];
        })
          .map((p) => ({ p, a: p[0] * cv.ax[0] + p[1] * cv.ax[1] }))
          .sort((x, y) => x.a - y.a);
      for (let i = 0; i + 1 < pts.length; i++)
        joins.push(
          M.hull(
            [pts[i], pts[i + 1]].flatMap(({ p }) => {
              const zj = 1 + (p[2] - 1) / 2,
                q: Vec3 = [p[0] - cv.dm[0] * W, p[1] - cv.dm[1] * W, 0];
              return [
                [p[0], p[1], 1],
                [p[0], p[1], zj],
                [q[0], q[1], 1],
                [q[0], q[1], zj],
              ] as Vec3[];
            }),
          ),
        );
    }
  // Swept: one quarter round of radius 9 swept along each end curve, its top
  // following the column ends' heights (linear between corners), then a wall
  // to the base. Each column's key surface continues flat out to it. Slots with
  // round bottoms part the columns down to half the wall height.
  if (o.drop === 'swept')
    for (const e of [0, 1]) {
      tag = 'cap';
      parts.push(
        sweptEnd(
          curves![e],
          COLS.map((c) => `matrix_${c}_${e ? 'bottom' : 'top'}`),
          [0, e ? -1 : 1],
          true,
        ),
      );
    }
  tag = 'join';
  parts.push(...joins);
  const outlines = specs.map(
    (sp) => new CS([hull2([...sp.names.flatMap(keyPts), ...capFloors.slice(sp.lo, sp.hi).flat()])]),
  );
  // Tray outline. Original: convex outlines of the fingers, thumbs and the joins
  // between them (rolled ends included), rounded. Angled: the fingers part is the
  // column outlines closed across the slits, so the tray follows the column ends.
  const fingers = COLS.flatMap((c) => ROWS.map((r) => `matrix_${c}_${r}`)),
    xt = thumbs(k).filter((n) => n.startsWith('thumb_x'));
  const near = (names: string[]) =>
    capFloors
      .filter((c) =>
        names.some((n) => {
          const e = k.frames[n].elements;
          return c.some((p) => Math.hypot(p[0] - e[12], p[1] - e[13]) < 24);
        }),
      )
      .flat();
  const blob = (names: string[]) => new CS([hull2([...names.flatMap(keyPts), ...near(names)])]);
  const groups: string[][] = [
    fingers,
    base3,
    ['matrix_inner_bottom', 'matrix_index_bottom', ...base3],
    ...(xt.length ? [xt, [...xt, 'matrix_middle_bottom', 'matrix_index_bottom']] : []),
  ];
  const fp =
    o.drop === 'angled'
      ? CS.union([
          CS.union(outlines.slice(0, COLS.length))
            .offset(4, 'Round', 2, 32)
            .offset(-4, 'Round', 2, 32),
          ...groups.slice(1).map(blob),
        ])
          .offset(margin, 'Round', 2, 32)
          .offset(3, 'Round', 2, 32)
          .offset(-3, 'Round', 2, 32)
      : CS.union(groups.map(blob))
          .offset(margin, 'Round', 2, 32)
          .offset(8, 'Round', 2, 32)
          .offset(-8, 'Round', 2, 32);
  // Base outline: the tray, or for bridged columns the key outlines closed across the slits.
  // Fitted and swept: the footprint of everything built, holes filled, so the base is flush.
  const solidPlan = (m: Manifold) => {
    const area = (p: [number, number][]) =>
      p.reduce((t, q, i) => {
        const r = p[(i + 1) % p.length];
        return t + q[0] * r[1] - r[0] * q[1];
      }, 0);
    return CS.union(
      m
        .project()
        .toPolygons()
        .filter((p) => area(p as [number, number][]) > 0)
        .map((p) => new CS([p])),
    );
  };
  const base =
    o.drop === 'fitted' || o.drop === 'swept'
      ? solidPlan(M.union(all))
      : o.rim === 'tray' || o.drop === 'angled'
        ? fp
        : CS.union([...outlines, support.project(), ...joins.map((j) => j.project())])
            .offset(5, 'Round', 2, 32)
            .offset(-5, 'Round', 2, 32);
  if (o.rim === 'tray') {
    tag = 'rim';
    parts.push(fp.extrude(7).subtract(fp.offset(-rimW, 'Round').extrude(9).translate([0, 0, 2])));
    // Ledge: a 2 mm floor above the removable base, from the rim in to 2 mm
    // under the column walls, so the case is one piece without the base.
    // Islands boxed in by columns, touching no rim, are dropped.
    const band = fp.subtract(fp.offset(-rimW, 'Round'));
    tag = 'ledge';
    parts.push(
      CS.union(
        fp
          .offset(-1)
          .subtract(CS.union(outlines).offset(-2, 'Round'))
          .decompose()
          .filter((c) => c.intersect(band).area() > 1),
      ).extrude(4),
    );
  } else {
    tag = 'base';
    parts.push(base.extrude(2));
  }
  // Check: anything outside the base outline, other than the Cirque housing, is a defect.
  const inTray = base.extrude(300).translate([0, 0, -1]);
  skelOutside = all.flatMap((m, i) =>
    m
      .subtract(inTray)
      .decompose()
      .filter((p) => p.volume() > 1)
      .map((p) => {
        const b = p.boundingBox();
        return `${tags[i]} ${(p.volume() / 1000).toFixed(2)}cm³ @ ${b.min.map((v, j) => ((v + b.max[j]) / 2).toFixed(0)).join(',')}`;
      }),
  );
  all.forEach((m, i) => {
    if (!hl.includes(tags[i])) return;
    skelHighlight.push(m);
    const b = m.boundingBox();
    skelHighlightInfo.push(
      `${tags[i]} ${m.volume().toFixed(0)}mm³ ${b.max.map((v, j) => (v - b.min[j]).toFixed(1)).join('×')} @ ${b.min.map((v, j) => ((v + b.max[j]) / 2).toFixed(0)).join(',')}`,
    );
  });
  tag = 'cirque';
  parts.push(cirque(k));
  // Debug: which parts each keycap's travel envelope hits.
  skelHits = keys(k.frames).flatMap((n) => {
    const e = capSweep(k, n);
    return all.flatMap((m, i) => {
      const v = m.intersect(e).volume();
      return v > 0.05 ? [`${n}×${tags[i]} ${v.toFixed(0)}`] : [];
    });
  });
  return M.union(all);
}
// Carved shell: one continuous skin through every key plate's corners, walls
// straight down to the base, then a slit between each pair of neighbouring
// columns from the top down to half the end walls' height, so the columns are
// separate above and one wall below.
function carved(k: Kit) {
  const M = k.wasm.Manifold,
    CS = k.wasm.CrossSection,
    r = roof(k, 17, 1.4);
  let shell = M.union([web(k, r), plates(k, 1.4), walls(k, r, 0, 3, 2.4)]);
  const slits: Manifold[] = [];
  for (let c = 0; c + 1 < COLS.length; c++) {
    // Gap centre at each row: middle of the two facing plate edges.
    const mids = ROWS.map((row) => {
      const a = `matrix_${COLS[c]}_${row}`,
        b = `matrix_${COLS[c + 1]}_${row}`,
        ps = [
          ...edgeFacing(k, a, [1, 0]).map(([x, y]) => at(k, a, x, y, 0, 1.4)),
          ...edgeFacing(k, b, [-1, 0]).map(([x, y]) => at(k, b, x, y, 0, 1.4)),
        ];
      return [0, 1, 2].map((i) => ps.reduce((t, p) => t + p[i] / 4, 0));
    });
    const out = (p: number[], q: number[]) => {
      const d = [p[0] - q[0], p[1] - q[1]],
        l = Math.hypot(d[0], d[1]);
      return [p[0] + (d[0] / l) * 20, p[1] + (d[1] / l) * 20, p[2]];
    };
    const line = [out(mids[0], mids[1]), ...mids, out(mids[2], mids[1])];
    // Half the end walls' height, held from outside the wall to the end key's
    // centre so the floor stays level through the wall; under the home key the
    // skin is higher than either, so the lower value is enough there.
    const zb = [mids[0][2], mids[2][2]].map((z) => 1 + (z - T - 1) / 2),
      zAt = (i: number) => (i <= 1 ? zb[0] : i >= line.length - 2 ? zb[1] : Math.min(...zb));
    for (let i = 0; i + 1 < line.length; i++) {
      const [p, q] = [line[i], line[i + 1]],
        d = [q[0] - p[0], q[1] - p[1]],
        l = Math.hypot(d[0], d[1]),
        nx = (-d[1] / l) * 0.8,
        ny = (d[0] / l) * 0.8;
      slits.push(
        M.hull(
          [
            [p, i],
            [q, i + 1],
          ].flatMap(([v, j]) =>
            [-1, 1].flatMap((sg) =>
              [zAt(j as number), 120].map(
                (z) => [(v as number[])[0] + nx * sg, (v as number[])[1] + ny * sg, z] as Vec3,
              ),
            ),
          ),
        ),
      );
    }
  }
  // Keep the slits clear of the thumb keys.
  const thumbZone = M.union(
    thumbs(k).map((n) =>
      place(M.cube([...half(k, n, 4).map((v) => v * 2), 200] as Vec3, true), k.frames[n]),
    ),
  );
  shell = shell.subtract(M.union(slits).subtract(thumbZone));
  const area = (p: [number, number][]) =>
    p.reduce((t, q, i) => {
      const s = p[(i + 1) % p.length];
      return t + q[0] * s[1] - s[0] * q[1];
    }, 0);
  const base = CS.union(
    shell
      .project()
      .toPolygons()
      .filter((p) => area(p as [number, number][]) > 0)
      .map((p) => new CS([p])),
  );
  return M.union([shell, base.extrude(2), cirque(k)]);
}
function machined(k: Kit) {
  const M = k.wasm.Manifold,
    r = roof(k, 26, 6),
    fp = footprint(k, 4, 12).offset(-6, 'Round', 2, 24).offset(6, 'Round', 2, 24);
  const under = M.union(r.tris.map((t) => M.hull(t.flatMap((i) => [r.top[i], down(r.top[i], 0)]))));
  let body = under.intersect(fp.extrude(200));
  body = body.subtract(
    under
      .translate([0, 0, -4])
      .intersect(fp.offset(-2.5, 'Round').extrude(200).translate([0, 0, 2.5])),
  );
  for (const n of keys(k.frames)) {
    const [hx, hy] = half(k, n, -0.25);
    body = body.subtract(
      place(M.cube([hx * 2, hy * 2, 60], true).translate([0, 0, 30]), k.frames[n]),
    );
  }
  return M.union([body, plates(k), cirque(k)]);
}

// Rounds each corner of a closed polygon with its own radius (0 keeps it sharp).
function fillet(pts: [number, number][], r: number[], seg = 12): [number, number][] {
  const out: [number, number][] = [],
    unit = (x: number, y: number): [number, number] => {
      const l = Math.hypot(x, y);
      return [x / l, y / l];
    };
  pts.forEach((p, i) => {
    const a = pts[(i + pts.length - 1) % pts.length],
      b = pts[(i + 1) % pts.length];
    if (!r[i]) return void out.push(p);
    const u = unit(a[0] - p[0], a[1] - p[1]),
      v = unit(b[0] - p[0], b[1] - p[1]),
      th = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) / 2,
      t = r[i] / Math.tan(th),
      w = unit(u[0] + v[0], u[1] + v[1]),
      c = [p[0] + (w[0] * r[i]) / Math.sin(th), p[1] + (w[1] * r[i]) / Math.sin(th)],
      a1 = Math.atan2(p[1] + u[1] * t - c[1], p[0] + u[0] * t - c[0]),
      a2 = Math.atan2(p[1] + v[1] * t - c[1], p[0] + v[0] * t - c[0]);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    for (let j = 0; j <= seg; j++)
      out.push([
        c[0] + r[i] * Math.cos(a1 + (d * j) / seg),
        c[1] + r[i] * Math.sin(a1 + (d * j) / seg),
      ]);
  });
  return out;
}
// Commodore 64 "breadbin": a rectangular wedge whose deck follows a plane fitted
// through the key plates, a bullnose front edge, a rounded underside at the
// front, a rear chamfer with grill grooves running out through both ends, a
// parting line all round, and the keys in a rectilinear well with a shallow
// moat (a thin trough) round it. The trackpad gets its own well, as the
// C64's function keys do.
interface Bin {
  keys: string[];
  // Plan rotation of the bin about z, degrees; its front faces local -y.
  angle?: number;
  side: number; // case past the wells at each end
  front: number; // case past the wells at the front, bullnose included
  back: number; // case past the wells at the grill (the back, or the left end)
  corner: number; // corner radius of the trough in plan
  // Where the grill goes: across the back (as on the C64) or down the left end.
  grill?: 'back' | 'left';
}
// Height of the parting line between the top case and the bottom section.
const PART = 10;
const WALL = 2; // case wall, deck and floor thickness
interface BinParts {
  shell: Manifold; // solid case with trough, grill and parting line cut, wells not yet cut
  wells: Manifold; // well prisms, cut from every bin's shell
  inside: Manifold; // well floors and key pedestals, solid
  cavity: Manifold; // the case's hollow, before anything is kept back from it
  keep: Manifold; // kept solid inside the hollow: well walls, floor and pedestal walls
  open: Manifold; // opened through what is kept: inside each pedestal, down to the bottom
}
function breadbin(k0: Kit, o: Bin): BinParts {
  const ang = o.angle ?? 0,
    rot = new Matrix4().makeRotationZ((-ang * Math.PI) / 180),
    frames = Object.fromEntries(
      Object.entries(k0.frames).map(([n, f]) => [n, rot.clone().multiply(f)]),
    ),
    k: Kit = { ...k0, frames },
    M = k.wasm.Manifold,
    CS = k.wasm.CrossSection,
    names = o.keys;
  // Least-squares plane z = a + bx + cy through the plate corners.
  const P = names.flatMap((n) => corners(k, n)),
    S = [0, 0, 0, 0, 0, 0, 0, 0, 0],
    R = [0, 0, 0];
  for (const [x, y, z] of P) {
    const r = [1, x, y];
    for (let i = 0; i < 3; i++) {
      R[i] += r[i] * z;
      for (let j = 0; j < 3; j++) S[i * 3 + j] += r[i] * r[j];
    }
  }
  const det = (m: number[]) =>
      m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6]),
    [a, b, c] = [0, 1, 2].map((i) => {
      const m = [...S];
      for (let j = 0; j < 3; j++) m[j * 3 + i] = R[j];
      return det(m) / det(S);
    }),
    LIFT = 3; // deck above the fitted plate plane: below the keycaps' lowest travel
  // Well: axis-aligned boxes round each key's cap travel, merged and closed
  // across the gaps between them so the outline steps like the C64's.
  const box = (cs: CrossSection) => {
      const bb = cs.bounds();
      return CS.square([bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]]).translate(bb.min);
    },
    keyWell = CS.union(names.map((n) => box(capSweep(k, n).project()).offset(1.2, 'Miter')))
      .offset(11, 'Miter')
      .offset(-11, 'Miter')
      .offset(-2, 'Round', 2, 24)
      .offset(2, 'Round', 2, 24),
    wb = keyWell.bounds();
  // Side profile, fitted to a side-on photo of the C64 and scaled so its gutter
  // (118 px up the photo) lands on the parting line. Every rounded part keeps
  // the photo's size and shape: a corner where two straight runs meet, rounded
  // by a cubic whose handles reach back along each run (handle lengths in px).
  // The front face is vertical above and below the gutter; the bullnose rolls
  // it into the deck; the deck rises at the keys' own angle (5 degrees at
  // least) into a flat top over the grill; the back is two flat faces meeting
  // at the gutter, the top one raked 7.2 degrees forward, the bottom one
  // vertical. The well's size sets the proportions; the bin's depth and height
  // follow it, not the photo.
  const left = o.grill === 'left',
    PX = PART / 118, // mm per px
    RAKE = Math.tan((7.2 * Math.PI) / 180),
    x0 = wb.min[0] - (left ? o.back : o.side),
    x1 = wb.max[0] + o.side,
    xr = (x0 + x1) / 2,
    // The deck pivots about the well's middle so the keys keep their depth there.
    ym = (wb.min[1] + wb.max[1]) / 2,
    rise = Math.max(c, Math.tan((5 * Math.PI) / 180)),
    deck = (y: number) => a + b * xr + c * ym + rise * (y - ym) + LIFT,
    dl = Math.hypot(1, rise),
    along: [number, number] = [1 / dl, rise / dl],
    yF = wb.min[1] - o.front,
    // The back's top corner, the flat top over the grill in front of it, and
    // where the flat meets the deck: just behind the well, or further forward
    // when there's no grill and the flat is no longer than its two roundings.
    yC = wb.max[1] + (left ? o.side : o.back),
    yG = Math.min(wb.max[1] + 2, yC - 81 * PX),
    zG = deck(yG),
    yR = yC + (zG - PART) * RAKE,
    bk = Math.hypot(RAKE, 1),
    // [corner, towards previous run, towards next run, handle lengths, handle fractions]
    rounds: [
      [number, number],
      [number, number],
      [number, number],
      number,
      number,
      number,
      number,
    ][] = [
      // Bullnose, no lower than the gutter.
      [[yF, deck(yF)], [0, -1], along, Math.min(93 * PX, deck(yF) - PART), 0.41, 104 * PX, 0.3],
      // Deck into the flat top over the grill.
      [[yG, zG], [-along[0], -along[1]], [1, 0], 81 * PX, 0.3, 16 * PX, 0.19],
      // Flat top over the back face.
      [[yC, zG], [-1, 0], [RAKE / bk, -1 / bk], 60 * PX, 0.45, 68 * PX, 0.37],
    ],
    under: typeof rounds = [
      // Back foot.
      [[yR, 0], [0, 1], [-1, 0], 69 * PX, 0.23, 41 * PX, 0.22],
      // Rounded underside at the front, up to the gutter.
      [[yF, 0], [1, 0], [0, 1], 113 * PX, 0.43, 116 * PX, 0.31],
    ],
    round = ([C, u, v, L0, f0, L1, f1]: (typeof rounds)[number]) => {
      const P = [L0, f0 * L0, f1 * L1, L1].map((l, i) => {
          const d = i < 2 ? u : v;
          return [C[0] + d[0] * l, C[1] + d[1] * l];
        }),
        out: [number, number][] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12,
          w = [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
        out.push(
          [0, 1].map((j) => w.reduce((q, wi, m) => q + wi * P[m][j], 0)) as [number, number],
        );
      }
      return out;
    },
    yN = yF + rounds[0][5] * along[0],
    tent = b / (deck((yF + yR) / 2) - PART),
    // Clockwise in (y, z) from the front gutter; CrossSection keeps only
    // counter-clockwise outlines, so it's reversed.
    prof: [number, number][] = [
      [yF, PART],
      ...rounds.flatMap(round),
      [yR, PART],
      ...under.flatMap(round),
    ],
    outline = new CS([prof.reverse()]);
  // The profile run across the bin, its top section tented to follow the keys, its ends
  // rounded all round: slices shrink in towards each end along a quarter circle.
  const END = 4,
    body = (inset: number) => {
      const ri = END - inset,
        slice = (x: number, off: number) => {
          const f = 1 + tent * (x - xr);
          return outline
            .offset(-off, 'Round', 2, 24)
            .toPolygons()
            .flat()
            .map(([u, w]) => [x, u, w > PART ? PART + (w - PART) * f : w] as Vec3);
        },
        steps = [0, 1, 2, 3, 4, 5, 6].map((i) => (i / 6) * (Math.PI / 2)),
        endL = steps.map((p) => slice(x0 + END - ri * Math.cos(p), END - ri * Math.sin(p))),
        endR = steps.map((p) => slice(x1 - END + ri * Math.cos(p), END - ri * Math.sin(p))),
        hulls: Manifold[] = [M.hull([...endL[6], ...endR[6]])];
      for (let i = 0; i < 6; i++)
        hulls.push(M.hull([...endL[i], ...endL[i + 1]]), M.hull([...endR[i], ...endR[i + 1]]));
      return M.union(hulls);
    };
  const shell = body(0),
    skin = (d: number) => shell.subtract(shell.translate([0, 0, -d])),
    prism = (cs: CrossSection) => cs.extrude(400).translate([0, 0, -1]),
    slab = (z0: number, z1: number) =>
      M.cube([x1 - x0 + 40, yR - yF + 40, z1 - z0]).translate([x0 - 20, yF - 20, z0]);
  // Grill: grooves across the flat top between its two roundings, out through
  // both ends; or down the left end, out through the front and back.
  const grooves: CrossSection[] = [];
  let gEnd = x0;
  if (left)
    for (let x = x0 + 3.4; x < wb.min[0] - 5; x += 3.6) {
      grooves.push(CS.square([1.6, yR - yF + 4]).translate([x - 1.6, yF - 2]));
      gEnd = x;
    }
  else
    for (let y = yC - rounds[2][3] - 0.4; y - 1.2 > yG + rounds[1][5] + 0.4; y -= 2.4)
      grooves.push(CS.square([x1 - x0 + 4, 1.2]).translate([x0 - 2, y - 1.2]));
  const grill = prism(CS.union(grooves)).intersect(skin(1.2));
  // Trough: 0.8 mm wide and 1 mm deep, following the case outline on the deck:
  // in from the ends, just behind the bullnose, between the well and the flat top.
  const rx0 = left ? gEnd + 1.5 : x0 + END + 1,
    ry0 = yN + 1,
    rx1 = x1 - END - 1,
    ry1 = wb.max[1] + 1.6,
    ring = (d: number) =>
      CS.square([rx1 - rx0 - 2 * d, ry1 - ry0 - 2 * d])
        .translate([rx0 + d, ry0 + d])
        .offset(-Math.max(0.1, o.corner - d), 'Round', 2, 32)
        .offset(Math.max(0.1, o.corner - d), 'Round', 2, 32),
    trough = prism(ring(0).subtract(ring(0.8))).intersect(skin(1));
  // Parting line between the top and bottom halves, 0.8 mm deep.
  const parting = shell.subtract(body(0.8)).intersect(slab(PART - 0.6, PART + 0.6));
  // Inside the key well: a floor 14 mm under the deck, and each key on its own
  // pedestal rising out of it, as the C64's keys rise out of the dark well.
  // The floor stays above the parting line, so the bottom section is just a tray.
  const floor = M.union([shell.translate([0, 0, -14]), slab(-1, PART + WALL)]),
    below = M.union([shell.translate([0, 0, -14 - WALL]), slab(-1, PART)]),
    pedestals = M.union(
      names.map((n) => M.hull(corners(k, n).flatMap((p) => [p, at(k, n, 0, 0, -T), down(p, 0)]))),
    ),
    // Each pedestal's inside, from under its plate down through the floor.
    bores = M.union(
      names.map((n) =>
        M.hull(
          [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].flatMap(([sx, sy]) => {
            const p = at(k, n, sx, sy, -T, -1.6);
            return [p, down(p, WALL)];
          }),
        ),
      ),
    ),
    // Solid in the hollow: the well's wall and floor, and the pedestal walls.
    keep = M.union([
      prism(keyWell.offset(WALL, 'Miter')).subtract(below),
      pedestals.intersect(prism(keyWell)).subtract(below),
    ]);
  const back = (m: Manifold) => m.rotate([0, 0, ang]);
  return {
    shell: back(shell.subtract(trough).subtract(grill).subtract(parting)),
    wells: back(prism(keyWell)),
    inside: back(
      M.union([
        floor.intersect(shell).intersect(prism(keyWell)),
        pedestals.intersect(prism(keyWell)).subtract(below),
      ]),
    ),
    cavity: back(body(WALL)),
    keep: back(keep),
    open: back(bores),
  };
}
function c64(k: Kit, bins: Bin[]) {
  const M = k.wasm.Manifold,
    parts = bins.map((o) => breadbin(k, o)),
    hollow = M.union(parts.map((p) => p.cavity))
      .subtract(M.union(parts.map((p) => p.keep)))
      .add(M.union(parts.map((p) => p.open)));
  return M.union([
    M.union(parts.map((p) => p.shell))
      .subtract(M.union(parts.map((p) => p.wells)))
      .add(M.union(parts.map((p) => p.inside)))
      .subtract(hollow),
    plates(k),
  ]);
}
const thumbKeys = (k: Kit) => thumbs(k),
  fingerKeys = (k: Kit) => keys(k.frames).filter((n) => n.startsWith('matrix_'));
// The thumb row's direction in plan, from the far key to the near key.
function thumbAngle(k: Kit) {
  const [p, q] = [k.frames.thumb_far.elements, k.frames.thumb_near.elements];
  return (Math.atan2(q[13] - p[13], q[12] - p[12]) * 180) / Math.PI;
}

export const variants: Variant[] = [
  {
    key: 'skeletyl',
    name: 'Skeletyl construction',
    blurb:
      "The Skeletyl's construction on the Rosebear key poses: each column is its own curved ladder of switch frames with side skirts, with slits between columns. Column ends roll over in a quarter round and drop into a low rim tray on a flat base. A framed wall under the inner column, with a rounded opening under each key, supports the column and joins the thumb rows. The outer side wall has a slot, and the thumb row sits on a front wall with a rounded window. A 2 mm floor ledge runs from the rim in under the column walls, so the case is one piece without the bottom plate.",
    build: (k) => (noCut ? skeletyl(k) : cutKeys(k, skeletyl(k))),
  },
  {
    key: 'skel-bridged',
    name: 'Skeletyl, bridged columns',
    blurb:
      "The Skeletyl construction without the shared tray, as the original Skeletyl does it: neighbouring columns' end walls are separate in their upper half and one wall in their lower half, back and front. Where columns are staggered, the lower wall steps along the side of the longer column. No rim and no lip: the base plate stops flush with the walls.",
    build: (k) => {
      const o: SkelOpts = { rim: 'bridged', drop: 'square' };
      return noCut ? skeletyl(k, o) : cutKeys(k, skeletyl(k, o));
    },
  },
  {
    key: 'skel-angled',
    name: 'Skeletyl, angled end walls',
    blurb:
      "The Skeletyl tray, but each column end's vertical wall is turned about the vertical axis to run along the line through the neighbouring column ends, instead of square to the column. Where a wall stands out past the rolled end, its top slopes down at 45 degrees. The tray then follows the column ends instead of a convex outline: 1 mm past the end walls with a 2 mm rim, where the original is 3 mm past the rolled ends with a 3.5 mm rim.",
    build: (k) => {
      const o: SkelOpts = { rim: 'tray', drop: 'angled' };
      return noCut ? skeletyl(k, o) : cutKeys(k, skeletyl(k, o));
    },
  },
  {
    key: 'skel-both',
    name: 'Skeletyl, bridged and angled',
    blurb:
      "Both changes: neighbouring columns' end walls joined in their lower half, no rim, and the end walls turned to follow the neighbouring column ends, on a flat base 1 mm past them.",
    build: (k) => {
      const o: SkelOpts = { rim: 'bridged', drop: 'angled' };
      return noCut ? skeletyl(k, o) : cutKeys(k, skeletyl(k, o));
    },
  },
  {
    key: 'skel-fitted',
    name: 'Skeletyl, fitted rolls',
    blurb:
      "Each column keeps its own rolled end, but the roll's radius varies across the column so that every column ends on one smooth curve across the back, and another across the front. A wall along each curve, from the base to half the end walls' height, joins the columns' lower halves. No rim or lip.",
    build: (k) => {
      const o: SkelOpts = { rim: 'bridged', drop: 'fitted' };
      return noCut ? skeletyl(k, o) : cutKeys(k, skeletyl(k, o));
    },
  },
  {
    key: 'skel-swept',
    name: 'Skeletyl, one swept end',
    blurb:
      "One rolled end swept along a smooth curve across the back, and another across the front, its top following the column ends' heights. Each column's key surface continues flat out to it. Round-bottomed slots part the columns down to half the end wall height, so they are separate above and one wall below. No rim or lip.",
    build: (k) => {
      const o: SkelOpts = { rim: 'bridged', drop: 'swept' };
      return noCut ? skeletyl(k, o) : cutKeys(k, skeletyl(k, o));
    },
  },
  {
    key: 'skel-swept-thumbs',
    name: 'Skeletyl, swept ends, thumbs too',
    blurb:
      'As "one swept end", and the thumb row uses the same construction as a finger column: the row runs left to right, and its two ends roll over and drop to the base, built by the same swept-end code as the columns. The front wall under the thumb row follows the row\'s well. With the +2 tucked below, that row gets a back wall as well and a low web joins it to the thumb row\'s front wall.',
    build: (k) => {
      const o: SkelOpts = { rim: 'bridged', drop: 'swept', thumbFront: 'swept' };
      return noCut ? skeletyl(k, o) : cutKeys(k, skeletyl(k, o));
    },
  },
  {
    key: 'carved',
    name: 'Carved shell',
    blurb:
      "One continuous skin through every key plate's corners, with walls straight down to the base, then a slit between each pair of neighbouring columns from the top down to half the end walls' height. The columns are cut out of one shape rather than built separately and joined. No rim or lip.",
    build: (k) => (noCut ? carved(k) : cutKeys(k, carved(k))),
  },
  {
    key: 'soft-web',
    name: 'Soft-edged webbed well',
    blurb:
      'The webbed well below, with every crease rounded: shallow folds become smooth curves, sharper edges keep a visible line with a small fillet. Flat faces stay flat.',
    build: (k) => {
      const r = roof(k),
        base = footprint(k, 3);
      return k.wasm.Manifold.union([
        soften(k, k.wasm.Manifold.union([web(k, r), plates(k), walls(k, r, 1, 3)]), 40, 0.35, 3),
        base.extrude(2).subtract(hexHoles(k, base, 0, 2)),
        cirque(k),
      ]);
    },
  },
  {
    key: 'machined',
    name: 'Machined tray',
    blurb:
      'Vertical walls on a plan outline with large rounded corners, cut off at the top by the faceted key surface, like a CNC-milled case: straight sides and round corners in plan, crisp planes on top. Keys sit in shallow pockets.',
    build: (k) => machined(k),
  },
  {
    key: 'pebble',
    name: 'Pebble facets',
    blurb:
      'The faceted block with its facets blended: large flat faces remain, and the edges between them are rounded. Between the moulded shell and the sharp block.',
    build: (k) => {
      // Trim the blend back to just above the key surface so keys are not buried.
      const M = k.wasm.Manifold,
        r = roof(k, 26, 8),
        cap = M.union(
          r.tris.map((t) => M.hull(t.flatMap((i) => [r.top[i], down(r.top[i], 0)]))),
        ).translate([0, 0, 1.5]);
      return soften(k, soften(k, faceted(k, false), 35, 0.5, 3).intersect(cap), 35, 0.3, 1).add(
        cirque(k),
      );
    },
  },
  {
    key: 'dactyl',
    name: 'Dactyl-Manuform webbed well',
    blurb:
      'Generic Dactyl-Manuform construction: separate switch plates joined by a faceted web through their corners, thin walls close to the key well, and a flat base with hexagonal cutouts.',
    build: (k) => {
      const r = roof(k),
        base = footprint(k, 3);
      return k.wasm.Manifold.union([
        web(k, r),
        plates(k),
        walls(k, r, 1, 3),
        base.extrude(2).subtract(hexHoles(k, base, 0, 2)),
        cirque(k),
      ]);
    },
  },
  {
    key: 'ribs',
    name: 'Column ribs',
    blurb:
      "Each key column sits on vertical ribs in the gaps between columns, running front to back and following the column's curve down to a flat base. The sides stay open, so the tile wiring is visible and reachable. The thumbs get front and back ribs of their own.",
    build: (k) => {
      const M = k.wasm.Manifold,
        parts: Manifold[] = [plates(k, 0.7)];
      const rib = (chain: { n: string; dir: [number, number] }[][], w = 1.6) => {
        for (const seg of chain)
          for (let i = 0; i + 1 < seg.length; i++) {
            const ps = seg
              .slice(i, i + 2)
              .flatMap(({ n, dir }) =>
                edgeFacing(k, n, dir).flatMap(([sx, sy]) => [
                  at(k, n, sx, sy, -T / 2, 0.4),
                  at(k, n, sx, sy, -T - w, 0.4),
                ]),
              );
            parts.push(M.hull([...ps, ...ps.map((p) => down(p, 0)), ...ps.map((p) => down(p, 2))]));
          }
      };
      for (let c = 0; c <= COLS.length; c++) {
        const seg: { n: string; dir: [number, number] }[] = [];
        for (const row of ROWS) {
          if (c > 0) seg.push({ n: `matrix_${COLS[c - 1]}_${row}`, dir: [1, 0] });
          if (c < COLS.length) seg.push({ n: `matrix_${COLS[c]}_${row}`, dir: [-1, 0] });
        }
        rib([seg]);
      }
      const tg = [
        thumbs(k).filter((n) => !n.startsWith('thumb_x')),
        thumbs(k).filter((n) => n.startsWith('thumb_x')),
      ].filter((g) => g.length);
      for (const g of tg)
        rib([
          g.map((n) => ({ n, dir: [0, -1] as [number, number] })),
          g.map((n) => ({ n, dir: [0, 1] as [number, number] })),
        ]);
      const base = footprint(k, 4);
      parts.push(
        base.extrude(3).subtract(base.offset(-9, 'Round').extrude(5).translate([0, 0, -1])),
        cirque(k),
      );
      return M.union(parts);
    },
  },
  {
    key: 'faceted',
    name: 'Faceted block',
    blurb:
      'One solid, flat-faceted body: the convex hull of the finger plates, of the thumb plates, and of a bridge between them, each down to a chamfered footprint. The keys sit in shallow pockets cut from the hull. Reads as a machined or low-poly object rather than a moulded one.',
    build: (k) => faceted(k, true).add(cirque(k)),
  },
  {
    key: 'floating',
    name: 'Floating plate on legs',
    blurb:
      'Only the webbed key surface, with no walls: a single curved plate held up by four slim tapered legs. The underside and wiring are fully open, the plate is the only large print, and the legs can be reprinted to change height and tenting.',
    build: (k) => {
      const M = k.wasm.Manifold,
        r = roof(k),
        parts: Manifold[] = [web(k, r), plates(k)];
      const legs: [string, number, number][] = [
        ['matrix_pinky_top', 1, 1],
        ['matrix_pinky_bottom', 1, -1],
        ['matrix_inner_top', -1, 1],
        ['thumb_home', -1, -1],
      ];
      for (const [n, sx, sy] of legs) {
        const p = at(k, n, sx * 0.7, sy * 0.7, -T);
        parts.push(
          M.hull([
            M.cylinder(1, 3, 3, 24).translate([p[0], p[1], p[2] - 1]),
            M.cylinder(3, 6, 6, 32).translate([p[0] + sx * 4, p[1] + sy * 4, 0]),
          ]),
        );
      }
      parts.push(cirque(k));
      return M.union(parts);
    },
  },
  {
    key: 'c64',
    name: 'Commodore 64 breadbin',
    blurb:
      "The C64's case on the Rosebear key poses: a rectangular wedge whose deck tilts to follow the key plates, with a big bullnose along the front edge, a rounded underside at the front, and a parting line all round. The keys sit in one stepped, squared-off well with a thin trough on the deck following the case outline. No trackpad. Grill grooves run across the back and out through both ends, and the top end edges are slightly rounded. The bottom section is everything below the parting line.",
    build: (k) => {
      const m = c64(k, [
        {
          keys: keys(k.frames),
          side: 10,
          front: 22,
          back: 24,
          corner: 4,
        },
      ]);
      return noCut ? m : cutKeys(k, m);
    },
    color: 0xd8ccae,
    capColor: 0x4b3a2e,
    noPad: true,
    split: PART,
  },
  {
    key: 'c64-clusters',
    name: 'C64 breadbins, one per cluster',
    blurb:
      "The C64 styling at the current chassis's footprint: the finger keys and the thumb row each get their own small breadbin, cut tight round the well, each with its own deck tilted to its keys, bullnose front, slightly rounded top end edges, grill grooves (across the back of the finger bin, down the outer end of the thumb bin), parting line and a thin trough on the deck following its outline. No trackpad. The thumb bin is turned to run along the thumb row. The bottom section is everything below the parting line. Where bins overlap they merge, and every bin's well is cut through the others.",
    build: (k) => {
      const tight = { side: 6, front: 13, back: 16, corner: 2 },
        m = c64(k, [
          { keys: fingerKeys(k), ...tight },
          { keys: thumbKeys(k), angle: thumbAngle(k), ...tight, grill: 'left' },
        ]);
      return noCut ? m : cutKeys(k, m);
    },
    color: 0xd8ccae,
    capColor: 0x4b3a2e,
    noPad: true,
    split: PART,
  },
];
