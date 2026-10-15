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
 * - Posts stand from the matrix's corner keys, its middle column's top and
 *   bottom keys and each thumb key down to rails on the floor that join them.
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
  /** The posts' square, in the key's corner. */
  post: 4,
  /** How far out from the ring's corner a post may stand to clear a keycap or switch. */
  postOut: [0, 4, 8],
  /** The floor rails: width and height. */
  rail: [3, 2],
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
    const solids: Manifold[] = keys.map((n) => hull(box(n, hp, 0, -FRAME.lip))),
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

    // The posts: down from the lowest corner of the key's ring whose post
    // stays clear of every switch and keycap, or failing that from a corner
    // further out (a key facing sideways or down has its own keycap under
    // it), or failing that the one that clashes least.
    const middle = Math.floor(cols.length / 2),
      ends = [0, middle, cols.length - 1],
      feet: Record<string, number[]> = {},
      corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [sx, sy])),
      /** A post down from key n's ring at one of `at` corners, the first that's clear. */
      post = (n: string, at: number[][]) => {
        const block = (sx: number, sy: number, o: number) =>
            [sx * (pocket[0] + o), sx * (pocket[0] + o + FRAME.post)].flatMap((x) =>
              [sy * (pocket[1] + o), sy * (pocket[1] + o + FRAME.post)].flatMap((y) =>
                [0, -FRAME.lip].map((z) => point(frames[n], [x, y, z])),
              ),
            ),
          posts = FRAME.postOut.flatMap((o) =>
            at
              .map(([sx, sy]) => {
                const ps = block(sx, sy, o);
                return {
                  ps,
                  low: lowest(ps),
                  post: union([hull(down(ps)), hull([...block(sx, sy, 0), ...ps])]),
                };
              })
              .sort((a, b) => a.low - b.low),
          ),
          clash = posts.map((p) => keep(p.post.intersect(keepOut)).volume()),
          best =
            posts[clash.findIndex((v) => v < 0.05)] ?? posts[clash.indexOf(Math.min(...clash))];
        solids.push(best.post);
        return [0, 1].map((k) => best.ps.reduce((s, p) => s + p[k], 0) / best.ps.length);
      };
    for (const n of new Set([
      ...ends.flatMap((ci) => [grid(ci, 0), grid(ci, ROWS.length - 1)]),
      ...thumbs,
    ]))
      feet[n] = post(n, corners);
    // The rails: round the matrix's posts, along the thumb keys', and from
    // the thumb keys to the nearest two of the matrix's.
    const [w, h] = FRAME.rail,
      rail = (a: number[], b: number[]) =>
        hull(
          [a, b].flatMap(([x, y]) =>
            [-1, 1].flatMap((sx) =>
              [-1, 1].flatMap((sy) =>
                [floor, floor + h].map((z) => [x + (sx * w) / 2, y + (sy * w) / 2, z] as Vec3),
              ),
            ),
          ),
        ),
      loop = [
        ...ends.map((ci) => grid(ci, 0)),
        ...[...ends].reverse().map((ci) => grid(ci, ROWS.length - 1)),
      ],
      gap = (n: string, m: string) => Math.hypot(feet[n][0] - feet[m][0], feet[n][1] - feet[m][1]);
    loop.forEach((n, i) => solids.push(rail(feet[n], feet[loop[(i + 1) % loop.length]])));
    thumbs.slice(1).forEach((n, i) => solids.push(rail(feet[thumbs[i]], feet[n])));
    if (thumbs.length) {
      const pairs = thumbs
          .flatMap((t) => loop.map((m) => [t, m]))
          .sort(([a, b], [p, q]) => gap(a, b) - gap(p, q)),
        second = pairs.find(([, m]) => m !== pairs[0][1]) ?? pairs[0];
      // The closest two pairs, and each thumb key to its closest.
      const struts = new Set([
        pairs[0],
        second,
        ...thumbs.map((t) => pairs.find(([a]) => a === t)!),
      ]);
      for (const [t, m] of struts) solids.push(rail(feet[t], feet[m]));
    }

    // Pressing a keycap anywhere on its top pushes along the switch: where
    // that line meets the floor has to be within the rails, or the frame rocks.
    // Where a corner's isn't, a post goes down from that corner of the key,
    // railed to the nearest two feet; if its line still lands outside (a
    // tilted key's lands well out from under it), a rail runs out to it.
    const spots = Object.values(feet),
      tryAt = new Set<string>(),
      footprint = () =>
        convex(
          spots.flatMap(([x, y]) =>
            corners.map(([sx, sy]) => [x + (sx * w) / 2, y + (sy * w) / 2]),
          ),
        ),
      outside = () => {
        const fp = footprint();
        return presses(cfg, frames, keys, floor)
          .map((p) => ({ ...p, by: -inside(fp, p.at) }))
          .filter((p) => p.by > -FRAME.inside)
          .sort((a, b) => b.by - a.by);
      },
      nearest = (p: number[], k: number) =>
        [...spots]
          .sort(
            (a, b) => Math.hypot(a[0] - p[0], a[1] - p[1]) - Math.hypot(b[0] - p[0], b[1] - p[1]),
          )
          .slice(0, k);
    for (let out = outside(), i = 0; out.length && i < 40; out = outside(), i++) {
      const p = out[0],
        id = `${p.key} ${p.corner}`;
      if (!tryAt.has(id)) {
        tryAt.add(id);
        const foot = post(p.key, [p.corner]);
        for (const q of nearest(foot, 2)) solids.push(rail(foot, q));
        spots.push(foot);
      } else {
        const [q] = nearest(p.at, 1);
        solids.push(rail(q, p.at));
        spots.push(p.at);
      }
    }

    const solid = keep(union(solids).subtract(keep(keepOut.subtract(lands))));

    // What's wrong: a switch or keycap that reaches a seat, or the frame.
    const faults: string[] = [],
      seats = (r: Manifold, but = '') =>
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
