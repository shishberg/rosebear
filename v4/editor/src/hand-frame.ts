/**
 * PROTOTYPE ?hand — throwaway. A test frame for the hand layout: a wireframe
 * that holds each switch where the layout puts it, to print and try for feel;
 * no wiring room, walls or bottom. Print it with the slicer's (tree) supports.
 *
 * - Each key: a plate ring round its switch hole, with a lip down its outside
 *   edge to stiffen it. Under the plate, the switch's clips have the pocket.
 * - Neighbours (the finger matrix's rows and columns, the thumb keys, and any
 *   thumb and finger keys that come close) are joined by a web between their
 *   facing edges, and the matrix's four-key corners are filled.
 * - A space frame holds them up. The keys joined by webs are one piece (the
 *   finger matrix, the thumb cluster), each held at its outer corners: each
 *   such corner on three struts to a triangle of floor corners, a
 *   tetrahedron. The floor's corners, round the keys, are triangulated by
 *   rails; where a pressed keycap would tip the frame, an outrigger reaches
 *   out past the press.
 * - Every switch (down past its pins), keycap (pressed to rest) and switch top
 *   is cut out of all of it except the switch seats (the clip land round each
 *   hole); where that leaves one hitting a seat or the frame, the result says
 *   so.
 */
import type { Manifold, ManifoldToplevel, Vec3 } from 'manifold-3d';
import {
  capSize,
  capTop,
  componentFrames,
  point,
  ROWS,
  type Config,
  type MeshData,
} from './geometry';

/** Sizes in mm. */
export const FRAME = {
  /** The plate ring past the switch pocket. */
  wall: 1.6,
  /** How far the ring's outside lip reaches down from the plate top. */
  lip: 3,
  /** Below the switch body: MX pins (3.3 mm) clear of the desk. */
  pins: 3.5,
  /** The clip land round each hole that nothing else may cut, past the pocket. */
  land: 0.8,
  /** Keys whose plates are this close (edge to edge) or closer are joined. */
  joinGap: 10,
  /** The floor rails: width and height. */
  rail: [3, 2],
  /** The struts' square. */
  strut: 2.4,
  /** Between a strut and a switch or keycap. */
  strutClear: 0.3,
  /** Key corners this close are one node of the truss. */
  merge: 6,
  /** The least distance between the corners a piece stands on, and (half
   * it) between floor corners. */
  spacing: 25,
  /** Round the keycap (pressed to rest) and the switch's top housing. */
  capMargin: 0.5,
  /** How far inside the rails' footprint every press must land. */
  inside: 1,
};

export type FrameResult = {
  /** In the editor's world frame; the floor is at `floor`. */
  mesh: MeshData;
  floor: number;
  /** Width, depth and height. */
  size: Vec3;
  pieces: number;
  /** What's wrong: seats cut, keycaps hitting the frame. */
  faults: string[];
  /** In cm³, without supports. */
  volume: number;
};

/** The keys the hand lays out: the finger matrix and the thumb row. */
export function frameKeys(cfg: Config) {
  return [
    ...cfg.geometry.columns.flatMap((c) => ROWS.map((r) => `matrix_${c.name}_${r}`)),
    ...cfg.geometry.thumb.keys.map((k) => `thumb_${k.name}`),
  ];
}

const label = (n: string) => n.replace(/^matrix_/, '').replace('_', ' ');

/** Where pressing each corner of each key's cap top pushes the frame: the
 * press, along the switch, met with the floor (keys facing within 80° of
 * sideways only; one facing further pushes the frame along the desk). */
export function presses(
  cfg: Config,
  frames: ReturnType<typeof componentFrames>,
  keys: string[],
  floor: number,
) {
  return keys.flatMap((key) => {
    const e = frames[key].elements,
      n = [e[8], e[9], e[10]],
      half = capTop(cfg, key).map((x) => x / 2),
      top = cfg.switch.keycap_bottom_above_plate_mm + capSize(cfg, key)[2];
    if (n[2] < Math.cos((80 * Math.PI) / 180)) return [];
    return [-1, 1].flatMap((sx) =>
      [-1, 1].map((sy) => {
        const p = point(frames[key], [sx * half[0], sy * half[1], top]),
          k = (p[2] - floor) / n[2];
        return { key, corner: [sx, sy], at: [p[0] - n[0] * k, p[1] - n[1] * k] };
      }),
    );
  });
}
/** The convex hull of points in the plane, anticlockwise. */
export function convex(ps: number[][]) {
  const s = [...ps].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    turn = (o: number[], a: number[], b: number[]) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]),
    half = (pts: number[][]) => {
      const h: number[][] = [];
      for (const p of pts) {
        while (h.length > 1 && turn(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
        h.push(p);
      }
      return h.slice(0, -1);
    };
  return [...half(s), ...half(s.reverse())];
}
/** How far point p is inside a convex polygon (anticlockwise), mm; negative outside. */
export function inside(poly: number[][], p: number[]) {
  return Math.min(
    ...poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length],
        l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / l;
    }),
  );
}

/** A convex polygon (anticlockwise) grown by `by`, its corners mitred, then
 * with any corner nearer than `gap` to the last one kept dropped. */
export function outline(poly: number[][], by: number, gap: number) {
  const n = poly.length,
    out = poly.map((p, i) => {
      const a = poly[(i + n - 1) % n],
        b = poly[(i + 1) % n],
        u = [p[0] - a[0], p[1] - a[1]],
        v = [b[0] - p[0], b[1] - p[1]],
        lu = Math.hypot(...u),
        lv = Math.hypot(...v),
        // The outward normals of the two edges, and their mitre.
        nu = [u[1] / lu, -u[0] / lu],
        nv = [v[1] / lv, -v[0] / lv],
        m = [nu[0] + nv[0], nu[1] + nv[1]],
        k = by / Math.max(0.2, m[0] * nu[0] + m[1] * nu[1]);
      return [p[0] + m[0] * k, p[1] + m[1] * k];
    }),
    kept: number[][] = [];
  for (const p of out)
    if (
      !kept.length ||
      Math.hypot(p[0] - kept[kept.length - 1][0], p[1] - kept[kept.length - 1][1]) >= gap
    )
      kept.push(p);
  // Dropping a corner cuts the polygon in a little; grow it back.
  return convex(kept);
}
/** A polygon's area (anticlockwise: positive). */
export const area = (poly: number[][]) =>
  poly.reduce((t, a, i) => {
    const b = poly[(i + 1) % poly.length];
    return t + (a[0] * b[1] - b[0] * a[1]) / 2;
  }, 0);
/** The Delaunay triangles of points in the plane (Bowyer–Watson), as index triples. */
export function delaunay(ps: number[][]) {
  const n = ps.length,
    big = 1e5,
    pts = [...ps, [-big, -big], [big, -big], [0, big]],
    circle = (t: number[]) => {
      const [a, b, c] = t.map((i) => pts[i]),
        d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])),
        s = (p: number[]) => p[0] * p[0] + p[1] * p[1],
        x = (s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d,
        y = (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d;
      return { x, y, r2: (a[0] - x) ** 2 + (a[1] - y) ** 2 };
    };
  let tris = [{ t: [n, n + 1, n + 2], c: circle([n, n + 1, n + 2]) }];
  for (let i = 0; i < n; i++) {
    const p = pts[i],
      bad = tris.filter(({ c }) => (p[0] - c.x) ** 2 + (p[1] - c.y) ** 2 < c.r2),
      edges = new Map<string, number[]>();
    for (const { t } of bad)
      for (const e of [
        [t[0], t[1]],
        [t[1], t[2]],
        [t[2], t[0]],
      ]) {
        const k = `${Math.min(...e)} ${Math.max(...e)}`;
        if (edges.has(k)) edges.delete(k);
        else edges.set(k, e);
      }
    tris = tris.filter((x) => !bad.includes(x));
    for (const [a, b] of edges.values()) tris.push({ t: [a, b, i], c: circle([a, b, i]) });
  }
  return tris.map(({ t }) => t).filter((t) => t.every((i) => i < n));
}
/** Whether a strut of radius `r` from a to b clears every switch (its hole,
 * and its pocket down past the pins) and keycap (pressed to rest, with the
 * switch top under it): each a box in its key's frame. */
export function clearOf(
  cfg: Config,
  frames: ReturnType<typeof componentFrames>,
  keys: string[],
  r: number,
) {
  const sw = cfg.switch,
    plate = sw.clip_land_thickness_mm,
    pocket = (sw.seat_outer_mm ?? [15.8, 15.8]).map((x) => x / 2),
    hole = sw.cutout_mm.map((x) => (x + sw.cutout_clearance_mm) / 2),
    deep = -(sw.body_below_plate_mm + FRAME.pins),
    sb = sw.keycap_bottom_above_plate_mm,
    pressed = sb - sw.travel_mm,
    boxes = keys.map((n) => {
      const cap = capSize(cfg, n).map((x) => x / 2 + FRAME.capMargin);
      return {
        inv: frames[n].clone().invert(),
        boxes: [
          [hole, -plate - 0.5, 0.5],
          [pocket, deep, -plate],
          [cap, pressed, sb + cap[2] * 2],
          [pocket, 0.05, pressed],
        ].map(([s, z0, z1]) => {
          const h = s as number[];
          return [
            [-h[0] - r, -h[1] - r, (z0 as number) - r],
            [h[0] + r, h[1] + r, (z1 as number) + r],
          ];
        }),
      };
    });
  return (a: Vec3, b: Vec3) => {
    const steps = Math.ceil(Math.hypot(...a.map((x, i) => x - b[i])));
    for (const k of boxes)
      for (let i = 0; i <= steps; i++) {
        const p = point(
          k.inv,
          a.map((x, j) => x + ((b[j] - x) * i) / steps),
        );
        if (k.boxes.some(([lo, hi]) => p.every((x, j) => x > lo[j] && x < hi[j]))) return false;
      }
    return true;
  };
}

export function buildFrame(wasm: ManifoldToplevel, cfg: Config): FrameResult {
  const M = wasm.Manifold,
    made: Manifold[] = [],
    keep = (m: Manifold) => (made.push(m), m),
    hull = (ps: Vec3[]) => keep(M.hull(ps)),
    union = (ms: Manifold[]) => keep(M.union(ms)),
    sw = cfg.switch,
    frames = componentFrames(cfg),
    keys = frameKeys(cfg),
    thumbs = keys.filter((n) => n.startsWith('thumb_')),
    plate = sw.clip_land_thickness_mm,
    pocket = (sw.seat_outer_mm ?? [15.8, 15.8]).map((x) => x / 2),
    hp = pocket.map((x) => x + FRAME.wall),
    hole = sw.cutout_mm.map((x) => (x + sw.cutout_clearance_mm) / 2),
    deep = -(sw.body_below_plate_mm + FRAME.pins),
    at = (n: string, x: number, y: number, z: number) => point(frames[n], [x, y, z]),
    box = (n: string, h: number[], z0: number, z1: number) =>
      [-1, 1].flatMap((sx) =>
        [-1, 1].flatMap((sy) => [z0, z1].map((z) => at(n, sx * h[0], sy * h[1], z))),
      ),
    axis = (n: string, i: number) => frames[n].elements.slice(i * 4, i * 4 + 3),
    lowest = (ps: Vec3[]) => Math.min(...ps.map((p) => p[2])),
    floor = Math.min(...keys.map((n) => lowest(box(n, hp, deep, deep)))),
    down = (ps: Vec3[], z = floor) => [...ps, ...ps.map((p) => [p[0], p[1], z] as Vec3)],
    centre = (n: string) => frames[n].elements.slice(12, 15),
    dist3 = (n: string, m: string) => Math.hypot(...centre(n).map((x, i) => x - centre(m)[i])),
    /** Key n's ring edge facing key m: its two corners, at the top and the lip's bottom. */
    edge = (n: string, m: string) => {
      const d = centre(m).map((x, i) => x - centre(n)[i]),
        out = [0, 1].map((i) => axis(n, i).reduce((s, x, k) => s + x * d[k], 0)),
        ax = Math.abs(out[0]) / hp[0] > Math.abs(out[1]) / hp[1] ? 0 : 1,
        s = Math.sign(out[ax]) || 1;
      return [-1, 1].flatMap((t) =>
        [0, -FRAME.lip].map((z) =>
          ax === 0 ? at(n, s * hp[0], t * hp[1], z) : at(n, t * hp[0], s * hp[1], z),
        ),
      );
    };

  try {
    // Each key: its ring and lip (the hole and pocket are cut out below).
    const faults: string[] = [],
      solids: Manifold[] = keys.map((n) => hull(box(n, hp, 0, -FRAME.lip))),
      joined: [string, string][] = [];
    // The joins: the finger matrix by rows and columns; thumb keys and
    // anything else whose plates come within joinGap.
    const cols = cfg.geometry.columns.map((c) => c.name),
      grid = (ci: number, ri: number) => `matrix_${cols[ci]}_${ROWS[ri]}`;
    cols.forEach((_, ci) =>
      ROWS.forEach((_, ri) => {
        if (ci + 1 < cols.length) joined.push([grid(ci, ri), grid(ci + 1, ri)]);
        if (ri + 1 < ROWS.length) joined.push([grid(ci, ri), grid(ci, ri + 1)]);
      }),
    );
    const near = 2 * Math.max(...hp) + FRAME.joinGap;
    keys.forEach((n, i) =>
      keys.slice(i + 1).forEach((m) => {
        if ((n.startsWith('thumb_') || m.startsWith('thumb_')) && dist3(n, m) < near)
          joined.push([n, m]);
      }),
    );
    for (const [n, m] of joined) solids.push(hull([...edge(n, m), ...edge(m, n)]));
    // The matrix's four-key corners: the corner of each nearest the middle.
    for (let ci = 0; ci + 1 < cols.length; ci++)
      for (let ri = 0; ri + 1 < ROWS.length; ri++) {
        const four = [grid(ci, ri), grid(ci + 1, ri), grid(ci, ri + 1), grid(ci + 1, ri + 1)],
          mid = [0, 1].map((k) => four.reduce((s, n) => s + centre(n)[k], 0) / 4),
          corner = (n: string) =>
            box(n, hp, 0, 0).reduce((a, b) =>
              Math.hypot(a[0] - mid[0], a[1] - mid[1]) < Math.hypot(b[0] - mid[0], b[1] - mid[1])
                ? a
                : b,
            ),
          pts = four.map(corner);
        solids.push(hull([...pts, ...pts.map((p) => [p[0], p[1], p[2] - plate] as Vec3)]));
      }

    // What the frame keeps out of: each switch's hole and its pocket down
    // past the pins, and each keycap's room pressed to rest with the switch
    // top under it. Nothing cuts a clip land.
    const sb = sw.keycap_bottom_above_plate_mm,
      pressed = sb - sw.travel_mm,
      outer = pocket.map((x) => x + FRAME.land),
      through = (n: string, z = -plate - 0.5) => box(n, hole, z, 0.5),
      land = Object.fromEntries(
        keys.map((n) => [n, hull(box(n, outer, -plate, 0)).subtract(hull(through(n, -plate - 1)))]),
      ),
      lands = union(Object.values(land)),
      switchAt = (n: string) => union([hull(through(n)), hull(box(n, pocket, -plate, deep))]),
      room = Object.fromEntries(
        keys.map((n) => {
          const cap = capSize(cfg, n).map((x) => x / 2 + FRAME.capMargin);
          return [
            n,
            [hull(box(n, cap, pressed, sb + cap[2] * 2)), hull(box(n, pocket, 0.05, pressed))],
          ];
        }),
      ),
      keepOut = union(keys.flatMap((n) => [switchAt(n), ...room[n]]));

    // The space frame. Its top nodes are the keys' ring corners at the lip's
    // bottom (corners of neighbouring keys that meet are one node, with a knot
    // joining them); its floor nodes, the corners of an outline that every
    // keycap corner's press lands inside (so the frame can't rock). Struts
    // that would pass through a switch or a keycap aren't used.
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [sx, sy])),
      [w, h] = FRAME.rail,
      rail = (a: number[], b: number[]) =>
        hull(
          [a, b].flatMap(([x, y]) =>
            corners.flatMap(([sx, sy]) =>
              [floor, floor + h].map((z) => [x + (sx * w) / 2, y + (sy * w) / 2, z] as Vec3),
            ),
          ),
        ),
      r = FRAME.strut / 2,
      strut = (a: Vec3, b: Vec3) =>
        hull(
          [a, b].flatMap((p) =>
            corners.flatMap(([sx, sy]) =>
              [-r, r].map((dz) => [p[0] + sx * r, p[1] + sy * r, p[2] + dz] as Vec3),
            ),
          ),
        ),
      nodes: { p: Vec3; of: { key: string; p: Vec3; q: Vec3 }[] }[] = [];
    for (const key of keys)
      for (const [sx, sy] of corners) {
        const c = {
            key,
            p: at(key, sx * hp[0], sy * hp[1], -FRAME.lip),
            q: at(key, sx * hp[0], sy * hp[1], 0),
          },
          m = nodes.find((m) => Math.hypot(...m.p.map((x, i) => x - c.p[i])) < FRAME.merge);
        if (!m) nodes.push({ p: c.p, of: [c] });
        else {
          m.of.push(c);
          m.p = [0, 1, 2].map((i) => m.of.reduce((t, o) => t + o.p[i], 0) / m.of.length) as Vec3;
        }
      }
    for (const m of nodes) if (m.of.length > 1) solids.push(hull(m.of.flatMap((o) => [o.p, o.q])));
    // The keys joined by webs are one piece, stiff as a plate.
    const piece = Object.fromEntries(keys.map((k) => [k, k])),
      root = (k: string): string => (piece[k] === k ? k : root(piece[k]));
    for (const [a, b] of joined) piece[root(a)] = root(b);
    // The floor: the corners of an outline round every key node from above
    // and the presses (keycap corners pushed along their switches) that meet
    // the floor less than `spacing` outside them; and any added under a
    // corner, below.
    const tops = convex(nodes.map((m) => [m.p[0], m.p[1]])),
      flat = outline(
        convex([
          ...tops,
          ...presses(cfg, frames, keys, floor)
            .map((p) => p.at)
            .filter((p) => inside(tops, p) > -FRAME.spacing),
        ]),
        FRAME.inside + 1,
        FRAME.spacing / 2,
      ),
      foot = (i: number) => [flat[i][0], flat[i][1], floor + h / 2] as Vec3;
    // Each piece stands on its outer corners (those round it from above, at
    // least `spacing` apart): each corner on three struts to a triangle of
    // floor corners it clears, a tetrahedron. A corner with no clear triangle
    // is skipped; three that aren't in a line hold a piece, so where fewer
    // stand, its other corners, furthest out first, are tried.
    const clear = clearOf(cfg, frames, keys, r + FRAME.strutClear),
      tetra = (m: (typeof nodes)[number], drop = true): boolean => {
        const under = [m.p[0], m.p[1]],
          near = flat
            .map((p, i) => ({ i, d: Math.hypot(p[0] - under[0], p[1] - under[1]) }))
            .sort((a, b) => a.d - b.d)
            .filter(({ i }) => clear(m.p, foot(i)))
            .slice(0, 10)
            .map(({ i }) => i);
        let best: { t: number[]; score: number; in: number } | undefined;
        for (let a = 0; a < near.length; a++)
          for (let b = a + 1; b < near.length; b++)
            for (let c = b + 1; c < near.length; c++) {
              const t = [near[a], near[b], near[c]],
                tri = convex(t.map((i) => flat[i]));
              if (tri.length < 3 || area(tri) < FRAME.spacing ** 2 / 4) continue;
              // Round the point under the corner (to 5 mm in), then short.
              const at = Math.min(5, inside(tri, under)),
                score =
                  at * 10 -
                  t.reduce((l, i) => l + Math.hypot(...foot(i).map((x, k) => x - m.p[k])), 0);
              if (!best || score > best.score) best = { t, score, in: at };
            }
        // None round it: a floor corner under it, if it clears.
        if ((!best || best.in < 0) && drop && clear(m.p, [...under, floor + h / 2] as Vec3)) {
          flat.push(under);
          return tetra(m, false);
        }
        if (best) for (const i of best.t) solids.push(strut(m.p, foot(i)));
        return !!best;
      },
      spread = (ps: Vec3[]) =>
        ps.some((a, i) =>
          ps.slice(i + 1).some((b, j) =>
            ps.slice(i + j + 2).some((c) => {
              const u = a.map((x, k) => b[k] - x),
                v = a.map((x, k) => c[k] - x);
              return (
                Math.hypot(
                  u[1] * v[2] - u[2] * v[1],
                  u[2] * v[0] - u[0] * v[2],
                  u[0] * v[1] - u[1] * v[0],
                ) > 50
              );
            }),
          ),
        );
    for (const r of new Set(keys.map(root))) {
      const own = nodes.filter((m) => m.of.some((o) => root(o.key) === r)),
        mid = [0, 1].map((k) => own.reduce((t, m) => t + m.p[k], 0) / own.length),
        out = (m: (typeof nodes)[number]) => Math.hypot(m.p[0] - mid[0], m.p[1] - mid[1]),
        round = convex(own.map((m) => [m.p[0], m.p[1], own.indexOf(m)])).map((p) => own[p[2]]),
        apart: typeof nodes = [];
      for (const m of [...round].sort((a, b) => out(b) - out(a)))
        if (apart.every((n) => Math.hypot(n.p[0] - m.p[0], n.p[1] - m.p[1]) >= FRAME.spacing))
          apart.push(m);
      const held = apart.filter((m) => tetra(m)).map((m) => m.p);
      for (const m of own.filter((m) => !apart.includes(m)).sort((a, b) => out(b) - out(a)))
        if (!spread(held) && tetra(m)) held.push(m.p);
      if (!spread(held))
        faults.push(
          `${keys
            .filter((k) => root(k) === r)
            .map(label)
            .join(', ')}: fewer than three corners stand on struts`,
        );
    }
    // The floor rails: its corners triangulated.
    const seen = new Set<string>();
    for (const t of delaunay(flat))
      for (const [a, b] of [
        [t[0], t[1]],
        [t[1], t[2]],
        [t[2], t[0]],
      ]) {
        const k = `${Math.min(a, b)} ${Math.max(a, b)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        solids.push(rail(flat[a], flat[b]));
      }
    // Where a press still meets the floor outside it, the frame would tip:
    // an outrigger, the furthest out
    // first, a little past it, railed to the two floor corners nearest.
    const body = flat.length,
      mid = [0, 1].map((k) => flat.reduce((t, p) => t + p[k], 0) / body);
    for (const p of presses(cfg, frames, keys, floor)
      .map((p) => p.at)
      .sort((a, b) => inside(convex(flat), a) - inside(convex(flat), b))) {
      if (inside(convex(flat), p) >= FRAME.inside) continue;
      const d = [p[0] - mid[0], p[1] - mid[1]],
        l = Math.hypot(...d),
        o = [0, 1].map((k) => p[k] + (d[k] / l) * 3 * (FRAME.inside + 1));
      for (const q of flat
        .slice(0, body)
        .sort((a, b) => Math.hypot(a[0] - o[0], a[1] - o[1]) - Math.hypot(b[0] - o[0], b[1] - o[1]))
        .slice(0, 2))
        solids.push(rail(o, q));
      flat.push(o);
    }
    const footprint = convex(
        flat.flatMap(([x, y]) => corners.map(([sx, sy]) => [x + (sx * w) / 2, y + (sy * w) / 2])),
      ),
      outside = () =>
        presses(cfg, frames, keys, floor).filter((p) => inside(footprint, p.at) < FRAME.inside);

    const solid = keep(union(solids).subtract(keep(keepOut.subtract(lands))));

    // What's wrong: a switch or keycap that reaches a seat, or the frame.
    const seats = (r: Manifold, but = '') =>
      keys
        .filter((m) => m !== but && keep(r.intersect(land[m])).volume() > 0.05)
        .map((m) => `${label(m)}'s seat`);
    for (const n of keys) {
      const hits = seats(switchAt(n), n);
      if (hits.length) faults.push(`${label(n)} switch hits ${hits.join(', ')}`);
      room[n].forEach((r, i) => {
        const hit = keep(solid.intersect(r)).volume();
        if (hit > 0.05)
          faults.push(
            `${label(n)} ${['keycap', 'switch top'][i]} hits ${seats(r).join(', ') || 'the frame'} (${hit.toFixed(1)} mm³)`,
          );
      });
    }
    for (const key of new Set(outside().map((p) => p.key)))
      faults.push(`pressing ${label(key)} rocks the frame`);
    // Flush cuts leave zero-volume slivers; leave them out.
    const parts = solid.decompose();
    made.push(...parts);
    const real = parts.filter((p) => p.volume() > 1),
      out = union(real),
      bb = out.boundingBox(),
      raw = out.getMesh(),
      positions = new Float32Array((raw.vertProperties.length / raw.numProp) * 3);
    for (let i = 0; i < positions.length / 3; i++)
      for (let j = 0; j < 3; j++) positions[i * 3 + j] = raw.vertProperties[i * raw.numProp + j];
    return {
      mesh: { positions, indices: new Uint32Array(raw.triVerts) },
      floor,
      size: [0, 1, 2].map((i) => bb.max[i] - bb.min[i]) as Vec3,
      pieces: real.length,
      faults,
      volume: out.volume() / 1000,
    };
  } finally {
    for (const m of new Set(made)) m.delete();
  }
}

/** Binary STL of a mesh, mirrored in x (the left half) if asked, its floor at z = 0. */
export function frameStl(mesh: MeshData, floor: number, mirror: boolean) {
  const tris = mesh.indices.length / 3,
    out = new DataView(new ArrayBuffer(84 + tris * 50));
  out.setUint32(80, tris, true);
  const v = (i: number) => [
    (mirror ? -1 : 1) * mesh.positions[i * 3],
    mesh.positions[i * 3 + 1],
    mesh.positions[i * 3 + 2] - floor,
  ];
  for (let t = 0; t < tris; t++) {
    // Mirroring turns the triangles inside out; swap two corners back.
    const [a, b, c] = [0, 1, 2].map((k) => v(mesh.indices[t * 3 + k])),
      ps = mirror ? [a, c, b] : [a, b, c],
      u = [0, 1, 2].map((k) => ps[1][k] - ps[0][k]),
      w = [0, 1, 2].map((k) => ps[2][k] - ps[0][k]),
      nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]],
      l = Math.hypot(...nn) || 1,
      o = 84 + t * 50;
    [...nn.map((x) => x / l), ...ps.flat()].forEach((x, k) => out.setFloat32(o + k * 4, x, true));
  }
  return out;
}
