/**
 * PROTOTYPE ?hand — throwaway. A test frame for the hand layout: switch holes
 * and what holds them up, to print and try for feel; no wiring room, ports or
 * bottom. It prints the right way up with no supports, whatever the layout:
 *
 * - Everything solid stands straight down from the key plates to a flat
 *   bottom (each piece is a convex hull with its own shadow on the floor), so
 *   its outside faces are vertical or face up.
 * - A cut leaves a ceiling only where it is level (a bridge), steep (45° or
 *   more), or small (the clip ledge round each switch hole): a switch pocket
 *   under a plate tilted past 45°, or a keycap's room (pressed to rest, with
 *   the switch top under it) under anything, gets a level roof where its own
 *   would be too shallow. Each switch's shaft runs on down, open at the bottom.
 * - The cuts stop at every switch seat (the clip land round the hole), and the
 *   shafts at what holds a seat up too, so a seat is never cut or left hanging
 *   over a shaft; where that leaves a switch or keycap hitting the frame, the
 *   result says so.
 *
 * Neighbours (the finger columns' rows and columns, the thumb keys, and any
 * thumb and finger keys that come close) are joined by a wall between their
 * facing plate edges, and the matrix's four-key corners are filled. Groups
 * that still stand apart get a bar along the floor.
 */
import type { Manifold, ManifoldToplevel, Vec3 } from 'manifold-3d';
import { capSize, componentFrames, point, ROWS, type Config, type MeshData } from './geometry';

/** Sizes in mm. */
export const FRAME = {
  /** Pillar wall round the switch pocket. */
  wall: 1.6,
  /** Below the switch body: MX pins (3.3 mm) clear of the desk. */
  pins: 3.5,
  /** The clip land round each hole that nothing else may cut, past the pocket. */
  land: 0.8,
  /** Keys whose plates are this close (edge to edge) or closer are joined. */
  joinGap: 10,
  /** The floor bars joining groups that stand apart. */
  bar: 10,
  /** Round the keycap (pressed to rest) and the switch's top housing. */
  capMargin: 0.5,
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
  /** Separate groups joined by floor bars. */
  bars: number;
};

/** The keys the hand lays out: the finger matrix and the thumb row. */
export function frameKeys(cfg: Config) {
  return [
    ...cfg.geometry.columns.flatMap((c) => ROWS.map((r) => `matrix_${c.name}_${r}`)),
    ...cfg.geometry.thumb.keys.map((k) => `thumb_${k.name}`),
  ];
}

const label = (n: string) => n.replace(/^matrix_/, '').replace('_', ' ');

export function buildFrame(wasm: ManifoldToplevel, cfg: Config): FrameResult {
  const M = wasm.Manifold,
    made: Manifold[] = [],
    keep = (m: Manifold) => (made.push(m), m),
    hull = (ps: Vec3[]) => keep(M.hull(ps)),
    union = (ms: Manifold[]) => keep(M.union(ms)),
    sw = cfg.switch,
    frames = componentFrames(cfg),
    keys = frameKeys(cfg),
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
    /**
     * A box in key n's frame (half-widths h, from z0 to z1) to cut, with a
     * level roof over it if any face of it facing up is too shallow to print
     * under (less than 45° from the horizontal): that face's corners lifted to
     * the highest of them. The roof can rise through the key's own plate; the
     * cuts all stop at the clip lands. Returns the box's corners and the
     * lifted ones.
     */
    roofed = (n: string, h: number[], z0: number, z1: number) => {
      const c = (sx: number, sy: number, z: number) => at(n, sx * h[0], sy * h[1], z),
        faces: [number, Vec3[]][] = [
          ...[-1, 1].flatMap((s): [number, Vec3[]][] => [
            [s * axis(n, 0)[2], [-1, 1].flatMap((t) => [c(s, t, z0), c(s, t, z1)])],
            [s * axis(n, 1)[2], [-1, 1].flatMap((t) => [c(t, s, z0), c(t, s, z1)])],
          ]),
          [Math.sign(z1 - z0) * axis(n, 2)[2], box(n, h, z1, z1)],
        ],
        shallow = faces.filter(([up]) => up > Math.SQRT1_2).flatMap(([, ps]) => ps),
        top = Math.max(...shallow.map((p) => p[2]));
      return {
        corners: box(n, h, z0, z1),
        lifted: shallow.map((p) => [p[0], p[1], top] as Vec3),
      };
    },
    lowest = (ps: Vec3[]) => Math.min(...ps.map((p) => p[2])),
    floor = Math.min(...keys.map((n) => lowest(box(n, hp, deep, deep)))),
    down = (ps: Vec3[], z = floor) => [...ps, ...ps.map((p) => [p[0], p[1], z] as Vec3)],
    centre = (n: string) => frames[n].elements.slice(12, 15),
    dist3 = (n: string, m: string) => Math.hypot(...centre(n).map((x, i) => x - centre(m)[i])),
    plan = (n: string, m: string) =>
      Math.hypot(centre(n)[0] - centre(m)[0], centre(n)[1] - centre(m)[1]),
    /** Key n's plate edge facing key m: its two corners, top and bottom. */
    edge = (n: string, m: string) => {
      const d = centre(m).map((x, i) => x - centre(n)[i]),
        out = [0, 1].map((i) => axis(n, i).reduce((s, x, k) => s + x * d[k], 0)),
        ax = Math.abs(out[0]) / hp[0] > Math.abs(out[1]) / hp[1] ? 0 : 1,
        s = Math.sign(out[ax]) || 1;
      return [-1, 1].flatMap((t) =>
        [0, -plate].map((z) =>
          ax === 0 ? at(n, s * hp[0], t * hp[1], z) : at(n, t * hp[0], s * hp[1], z),
        ),
      );
    };

  try {
    // Each key: its pocket (roofed if steep) and the pillar round it, high
    // enough over the roof to keep a wall.
    const pockets = Object.fromEntries(keys.map((n) => [n, roofed(n, pocket, -plate, deep)])),
      solids: Manifold[] = keys.map((n) =>
        hull(
          down([
            ...box(n, hp, 0, deep),
            ...pockets[n].lifted.map((p) => [p[0], p[1], p[2] + FRAME.wall] as Vec3),
          ]),
        ),
      ),
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
    for (const [n, m] of joined) solids.push(hull(down([...edge(n, m), ...edge(m, n)])));
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
        solids.push(hull(down([...pts, ...pts.map((p) => [p[0], p[1], p[2] - plate] as Vec3)])));
      }
    // Groups the joins leave apart (or overlapping shadows join): bar each to
    // its nearest keys in the rest.
    const group = new Map(keys.map((n) => [n, n])),
      root = (n: string): string => (group.get(n) === n ? n : root(group.get(n)!));
    for (const [n, m] of joined) group.set(root(n), root(m));
    keys.forEach((n, i) =>
      keys.slice(i + 1).forEach((m) => {
        if (plan(n, m) < 2 * Math.min(...hp)) group.set(root(n), root(m));
      }),
    );
    let bars = 0;
    for (;;) {
      const main = keys.filter((n) => root(n) === root(keys[0])),
        rest = keys.filter((n) => root(n) !== root(keys[0]));
      if (!rest.length) break;
      let [a, b] = [rest[0], main[0]];
      for (const n of rest) for (const m of main) if (plan(n, m) < plan(a, b)) [a, b] = [n, m];
      const c = main.filter((m) => m !== b).sort((p, q) => plan(a, p) - plan(a, q))[0],
        foot = (n: string) => box(n, hp, 0, 0).map((p) => [p[0], p[1], floor + FRAME.bar] as Vec3);
      solids.push(hull(down([...foot(a), ...foot(b), ...(c ? foot(c) : [])])));
      group.set(root(a), root(b));
      bars++;
    }

    // The cuts. Each switch: its hole through the plate and its pocket, and
    // the shaft on down from the pocket, open at the bottom. Each keycap's room
    // pressed to rest, and the switch top under it. Pockets and rooms are
    // roofed. They all stop at every key's clip land (round its hole), and the
    // shafts at what's straight under a land too, so no land is cut or left
    // hanging over a shaft. Where that leaves a switch or keycap hitting the
    // frame, the result says so.
    const sb = sw.keycap_bottom_above_plate_mm,
      pressed = sb - sw.travel_mm,
      outer = pocket.map((x) => x + FRAME.land),
      through = (n: string, z = -plate - 0.5) => box(n, hole, z, 0.5),
      land = Object.fromEntries(
        keys.map((n) => [n, hull(box(n, outer, -plate, 0)).subtract(hull(through(n, -plate - 1)))]),
      ),
      /** The land's four sides: [x0, x1, y0, y1]. */
      strips = [-1, 1].flatMap((s) => [
        [s * hole[0], s * outer[0], -outer[1], outer[1]],
        [-hole[0], hole[0], s * hole[1], s * outer[1]],
      ]),
      under = keys.map((n) =>
        keep(
          union(
            strips.map(([x0, x1, y0, y1]) =>
              hull(
                down(
                  [x0, x1].flatMap((x) =>
                    [y0, y1].flatMap((y) => [0, -plate].map((z) => at(n, x, y, z))),
                  ),
                  floor - 1,
                ),
              ),
            ),
          ),
        )
          // Behind the plate only: under a plate that faces a little down,
          // straight down runs out in front of it, where its own switch top is.
          .intersect(hull(box(n, [400, 400], 0, -400))),
      ),
      lands = union(Object.values(land)),
      guard = union([lands, ...under]),
      room = Object.fromEntries(
        keys.map((n) => {
          const cap = capSize(cfg, n).map((x) => x / 2 + FRAME.capMargin);
          return [n, [roofed(n, cap, pressed, sb + cap[2] * 2), roofed(n, pocket, 0.05, pressed)]];
        }),
      ),
      cuts = keys.map((n) => {
        const p = pockets[n];
        return union([
          keep(union([hull(through(n)), hull([...p.corners, ...p.lifted])]).subtract(lands)),
          keep(hull(down([...p.corners, ...p.lifted], floor - 1)).subtract(guard)),
          keep(union(room[n].map((r) => hull([...r.corners, ...r.lifted]))).subtract(lands)),
        ]);
      });
    const solid = keep(union(solids).subtract(union(cuts)));

    // What's wrong: a switch or keycap that reaches a seat, or the frame.
    const faults: string[] = [],
      seats = (r: Manifold, but = '') =>
        keys
          .filter((m) => m !== but && keep(r.intersect(land[m])).volume() > 0.05)
          .map((m) => `${label(m)}'s seat`);
    for (const n of keys) {
      const hits = seats(union([hull(through(n)), hull(pockets[n].corners)]), n);
      if (hits.length) faults.push(`${label(n)} switch hits ${hits.join(', ')}`);
      room[n].forEach((part, i) => {
        const r = hull(part.corners),
          hit = keep(solid.intersect(r)).volume();
        if (hit > 0.05)
          faults.push(
            `${label(n)} ${['keycap', 'switch top'][i]} hits ${seats(r).join(', ') || 'the frame'} (${hit.toFixed(1)} mm³)`,
          );
      });
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
      bars,
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
