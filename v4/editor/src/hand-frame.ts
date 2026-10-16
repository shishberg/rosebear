/**
 * PROTOTYPE ?hand — throwaway. A test frame for the hand layout: a wireframe
 * that holds each switch where the layout puts it, to print and try for feel;
 * no wiring room, walls or bottom. Print it with the slicer's (tree) supports.
 *
 * - Each key: a plate ring round its switch hole, with a lip down its outside
 *   edge to stiffen it. Under the plate, the switch's clips have the pocket.
 * - Neighbours (the finger matrix's rows and columns, the thumb keys, and any
 *   thumb and finger keys that come close) are joined by a web between their
 *   facing walls, and the matrix's four-key corners are filled. Where one key
 *   sits well above the other, the web is a steep wall; it's a fault if
 *   most of it is too thin to print.
 * - Legs hold them up. Each plate of joined keys stands on its
 *   outer corners: from each, a bracket out and down clear of its switch,
 *   on a leg straight down. A rail runs round each plate's feet, and one
 *   ties the thumb's to the fingers'. A press that would push the frame
 *   well outside its base is a warning.
 * - Every switch (down past its pins), keycap (pressed to rest) and switch top
 *   is cut out of all of it except the switch seats (the clip land round each
 *   hole); where that leaves one hitting a seat or the frame, the result says
 *   so.
 */
import type { Manifold, ManifoldToplevel, Mat4, Vec3 } from 'manifold-3d';
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
  /** The thinnest a web may be: slicers drop thinner walls. */
  thin: 1.2,
  /** The floor rails: width and height. */
  rail: [3, 2],
  /** How far a corner's bracket reaches out past it, and down (more, in
   * these steps, up to five, until its leg misses everything). */
  bracket: 4,
  /** The struts' square. */
  strut: 2.4,
  /** Between a strut and a switch or keycap. */
  strutClear: 0.3,
  /** Round the keycap (pressed to rest) and the switch's top housing. */
  capMargin: 0.5,
  /** A press that pushes further than this outside the base (seen from the
   * keycap corner) warns that it may tip the frame. */
  tip: 10,
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
  /** What may be wrong: presses that may tip it. */
  warnings: string[];
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
        return { key, corner: [sx, sy], from: p, at: [p[0] - n[0] * k, p[1] - n[1] * k] };
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
    made: { delete(): void }[] = [],
    keep = <T extends { delete(): void }>(m: T) => (made.push(m), m),
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
    /** Which side of key n faces key m: its axis (0 across, 1 along the
     * column) and sign. */
    side = (n: string, m: string) => {
      const d = centre(m).map((x, i) => x - centre(n)[i]),
        out = [0, 1].map((i) => axis(n, i).reduce((s, x, k) => s + x * d[k], 0)),
        ax = Math.abs(out[0]) / hp[0] > Math.abs(out[1]) / hp[1] ? 0 : 1;
      return [ax, Math.sign(out[ax]) || 1];
    },
    /** Key n's wall facing key m (the ring's side, a wall thick, the
     * plate top to the lip's bottom): its corners. */
    edge = (n: string, m: string) => {
      const [ax, s] = side(n, m);
      return [hp, pocket].flatMap((d) =>
        [-1, 1].flatMap((t) =>
          [0, -FRAME.lip].map((z) =>
            ax === 0 ? at(n, s * d[0], t * hp[1], z) : at(n, t * hp[0], s * d[1], z),
          ),
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
    const webs = joined.map(([n, m]) => ({ n, m, web: hull([...edge(n, m), ...edge(m, n)]) }));
    solids.push(...webs.map((w) => w.web));
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

    // The legs. The keys joined by webs (the finger matrix, the thumb
    // cluster) are each one stiff plate, standing on its outer corners: those
    // whose key has no neighbour across either of the corner's sides. Each
    // corner has a bracket out past it along its row and down, clear of its
    // switch (a steep key's switch hangs under its corner), on a leg straight
    // down.
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [sx, sy])),
      [w, h] = FRAME.rail,
      /** A rectangular bar on the floor from a to b, past each end by half
       * its width so bars meeting at an angle overlap. */
      rail = (a: number[], b: number[]) => {
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]),
          d = [(b[0] - a[0]) / l, (b[1] - a[1]) / l],
          u = [-d[1], d[0]];
        return hull(
          [a, b].flatMap((p, e) =>
            [-1, 1].flatMap((s) =>
              [floor, floor + h].map(
                (z) =>
                  [
                    p[0] + ((e ? 1 : -1) * d[0] + s * u[0]) * (w / 2),
                    p[1] + ((e ? 1 : -1) * d[1] + s * u[1]) * (w / 2),
                    z,
                  ] as Vec3,
              ),
            ),
          ),
        );
      },
      r = FRAME.strut / 2,
      /** A square bar from a to b, one side level (a vertical one's ends are
       * level too, so a leg stands flat on the floor). */
      strut = (a: Vec3, b: Vec3) => {
        const d = b.map((x, i) => x - a[i]),
          l = Math.hypot(...d),
          f = d.map((x) => x / l),
          side = Math.hypot(f[0], f[1]) < 1e-6 ? [1, 0, 0] : [f[1], -f[0], 0],
          u = side.map((x) => x / Math.hypot(...side)),
          v = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
        return hull(
          [a, b].flatMap((p) =>
            corners.map(([su, sv]) => p.map((x, i) => x + r * (su * u[i] + sv * v[i])) as Vec3),
          ),
        );
      },
      /** Where bars meet: a cube a bar wide. */
      knot = (p: Vec3) =>
        hull(
          corners.flatMap(([sx, sy]) =>
            [-r, r].map((dz) => [p[0] + sx * r, p[1] + sy * r, p[2] + dz] as Vec3),
          ),
        ),
      clear = clearOf(cfg, frames, keys, r + FRAME.strutClear),
      sides = new Set(joined.flatMap(([n, m]) => [`${n} ${side(n, m)}`, `${m} ${side(m, n)}`])),
      legs = keys.flatMap((key) =>
        corners
          .filter(([sx, sy]) => !sides.has(`${key} ${[0, sx]}`) && !sides.has(`${key} ${[1, sy]}`))
          .map(([sx, sy]) => {
            // The bracket reaches out along the row and down until a leg
            // straight down from it misses everything.
            const reach = (b: number) => {
              const top = at(key, sx * (hp[0] + b), sy * hp[1], -FRAME.lip - b);
              return { top, foot: [top[0], top[1], floor] as Vec3 };
            };
            let b = FRAME.bracket;
            while (b < FRAME.bracket * 5 && !clear(reach(b).top, reach(b).foot)) b += FRAME.bracket;
            return {
              key,
              p: at(key, sx * hp[0], sy * hp[1], -FRAME.lip),
              q: at(key, sx * hp[0], sy * hp[1], 0),
              ...reach(b),
            };
          }),
      );
    for (const { key, p, q, top, foot } of legs) {
      if (!clear(top, foot))
        faults.push(`${label(key)}: the leg under its corner hits a switch or keycap`);
      solids.push(strut(p, top), strut(q, top), knot(top), strut(top, foot));
    }
    // The base: a rail round each plate's feet, and one from each plate's
    // to the nearest foot of those before it, so it prints as one piece.
    const piece = Object.fromEntries(keys.map((k) => [k, k])),
      root = (k: string): string => (piece[k] === k ? k : root(piece[k]));
    for (const [a, b] of joined) piece[root(a)] = root(b);
    const plates = [...new Set(keys.map(root))].map((g) => {
        const own = legs.filter((l) => root(l.key) === g).map((l) => l.foot),
          mid = [0, 1].map((k) => own.reduce((t, f) => t + f[k], 0) / own.length),
          turn = (f: Vec3) => Math.atan2(f[1] - mid[1], f[0] - mid[0]);
        return own.sort((a, b) => turn(a) - turn(b));
      }),
      gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    plates.forEach((own, i) => {
      if (own.length > 1)
        own.forEach((f, j) => {
          if (own.length > 2 || j === 0) solids.push(rail(f, own[(j + 1) % own.length]));
        });
      const before = plates.slice(0, i).flat(),
        tie = own
          .flatMap((a) => before.map((b) => ({ a, b, d: gap(a, b) })))
          .sort((x, y) => x.d - y.d)[0];
      if (tie) solids.push(rail(tie.a, tie.b));
    });
    // Pressing a keycap corner pushes along its switch; where that line meets
    // the floor outside the base, a hard enough press tips the frame. How far
    // out: the angle, seen from the corner, from that point to the base's
    // nearest edge.
    const base = convex(
        legs.flatMap(({ foot: [x, y] }) =>
          corners.map(([sx, sy]) => [x + (sx * w) / 2, y + (sy * w) / 2]),
        ),
      ),
      tips = presses(cfg, frames, keys, floor)
        .filter((p) => inside(base, p.at) < 0)
        .map((p) => {
          const edge = base
              .map((a, i) => {
                const b = base[(i + 1) % base.length],
                  d = [b[0] - a[0], b[1] - a[1]],
                  t = Math.max(
                    0,
                    Math.min(
                      1,
                      ((p.at[0] - a[0]) * d[0] + (p.at[1] - a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2),
                    ),
                  );
                return [a[0] + d[0] * t, a[1] + d[1] * t];
              })
              .sort(
                (a, b) =>
                  Math.hypot(a[0] - p.at[0], a[1] - p.at[1]) -
                  Math.hypot(b[0] - p.at[0], b[1] - p.at[1]),
              )[0],
            u = [p.at[0] - p.from[0], p.at[1] - p.from[1], floor - p.from[2]],
            v = [edge[0] - p.from[0], edge[1] - p.from[1], floor - p.from[2]],
            cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
          return { key: p.key, deg: (Math.acos(Math.min(1, cos)) * 180) / Math.PI };
        }),
      warnings = [...new Set(tips.map((t) => t.key))].flatMap((key) => {
        const deg = Math.max(...tips.filter((t) => t.key === key).map((t) => t.deg));
        return deg > FRAME.tip
          ? [
              `pressing ${label(key)} may tip the frame: it pushes ${deg.toFixed(0)}° outside the base`,
            ]
          : [];
      });

    // Nothing below the floor: the slicer would support it.
    const solid = keep(
      keep(union(solids).trimByPlane([0, 0, 1], floor)).subtract(keep(keepOut.subtract(lands))),
    );

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
    // Each web, cut across halfway between its keys: how much of it is too
    // thin to print (what's left when the thin parts are worn away and the
    // rest grown back).
    for (const { n, m, web } of webs) {
      const mid = (k: string, l: string) =>
          edge(k, l)
            .slice(0, 4)
            .reduce<number[]>((a, p) => a.map((x, i) => x + p[i] / 4), [0, 0, 0]),
        a = mid(n, m),
        b = mid(m, n),
        z = b.map((x, i) => x - a[i]),
        zl = Math.hypot(...z),
        Z = z.map((x) => x / zl),
        o = a.map((x, i) => (x + b[i]) / 2),
        t = Math.abs(Z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0],
        cross = (u: number[], v: number[]) => [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ],
        X0 = cross(t, Z),
        X = X0.map((x) => x / Math.hypot(...X0)),
        Y = cross(Z, X),
        dot = (u: number[]) => -u.reduce((s, x, i) => s + x * o[i], 0),
        T = [
          X[0],
          Y[0],
          Z[0],
          0,
          X[1],
          Y[1],
          Z[1],
          0,
          X[2],
          Y[2],
          Z[2],
          0,
          dot(X),
          dot(Y),
          dot(Z),
          1,
        ] as Mat4,
        across = keep(
          keep(keep(solid.transform(T)).slice(0)).intersect(keep(keep(web.transform(T)).slice(0))),
        ),
        r = FRAME.thin / 2,
        thick = keep(keep(across.offset(-r, 'Miter')).offset(r, 'Miter')).area(),
        all = across.area();
      if (thick < 0.8 * all)
        faults.push(
          `the web between ${label(n)} and ${label(m)} is too thin to print: ${(100 - (100 * thick) / all).toFixed(0)}% of it is under ${FRAME.thin} mm`,
        );
    }
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
      warnings,
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
