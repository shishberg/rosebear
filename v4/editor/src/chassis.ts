// Chassis: Skeletyl-style construction with swept ends, built from the key poses.
// Each finger column is a ladder of switch plates.
// Across the back and across the front of the columns runs one swept end: a
// quarter round swept along a smooth curve through the column ends, then a wall
// to the base. Round-bottomed slots part the columns down to half that wall's
// height. The thumb rows use the same construction, running left to right. The
// outside edges without a swept end are walls, one segment under each key,
// parted by U slots. Low ribs join the thumb rows and the fingers along the
// base. Nothing is built into a tile pocket. The whole case stands on a flat
// base plate cut to its own footprint. Terms:
//  tile       the small bought PCB under each switch (hotswap socket, LED, diode);
//  tile pocket the space under a plate kept clear for the tile and its parts;
//  plate      the square frame a switch clips into, T thick, G mm past the
//             switch seat on each side (the tile below may reach past it);
//  ladder     a row of plates joined edge to edge;
//  swept end  one quarter round swept along a curve through a row of keys' end
//             edges, then a wall to the base;
//  wall       a slab from a key's plate edge that follows the plate's tilt down
//             past the tile pocket, just outside it, then drops vertically to
//             the base. The plate widens to meet it.
import type { Manifold, ManifoldToplevel, Vec3 } from 'manifold-3d';
import { Matrix4 } from 'three';
import { point, ROWS, type Config } from './geometry';

export const isKey = (name: string) => name.startsWith('thumb_') || name.startsWith('matrix_');
export const capSize = (c: Config, n: string) =>
  ((c.switch.keycap_overrides_mm as Record<string, number[]>)[n] || c.switch.keycap_mm) as Vec3;
export interface ChassisResult {
  body: Manifold;
  base: Manifold;
  pod: Manifold;
  pocketCut: Manifold;
}
type Edge = [number, number][];
interface Curve {
  dm: [number, number];
  ax: [number, number];
  F: (a: number) => number;
  corners: { a: number; f: number; z: number; c: number }[];
}

export function buildChassis(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
): ChassisResult {
  const M = wasm.Manifold,
    CS = wasm.CrossSection,
    ch = cfg.chassis,
    T = ch.plate_thickness_mm,
    G = ch.plate_margin_mm,
    W = ch.wall_mm,
    R = ch.end_radius_mm,
    CUT = ch.end_cut_mm;
  const g = cfg.geometry,
    COLS = g.columns.map((c) => c.name),
    names = Object.keys(frames).filter(isKey);
  const byX = (ns: string[]) => ns.sort((a, b) => frames[a].elements[12] - frames[b].elements[12]);
  const base3 = byX(g.thumb.keys.map((k) => 'thumb_' + k.name)),
    xt = byX(
      ((g as { thumb_extra?: { keys: { name: string }[] } }).thumb_extra?.keys ?? []).map(
        (k) => 'thumb_' + k.name,
      ),
    );
  // Tile pockets: the tile, its components and the switch body under every key,
  // below the plate, in key coordinates.
  const tl = cfg.tile,
    sw = cfg.switch,
    tz =
      tl.plate_top_to_pcb_top_mm +
      tl.size_mm[2] +
      Math.max(0, ...tl.components.map((c) => c.size_mm[2] / 2 - c.center_mm[2])) +
      tl.component_clearance_mm,
    pk = [tl.size_mm[0] / 2 + tl.clearance_mm, tl.size_mm[1] / 2 + tl.clearance_mm],
    cw = sw.cutout_mm.map((x) => x + sw.cutout_clearance_mm);
  // Walls, by key: the side (local axis a, sign s) and how far past the keycap
  // outline its inner and outer faces are (g0, g1). The plate reaches g1 there.
  const walled = new Map<string, { a: number; s: number; g0: number; g1: number }[]>();
  const axisOf = (e: Edge) => (e[0][0] === e[1][0] ? 0 : 1);
  const gr = (n: string, sx: number, sy: number): [number, number] => {
    const g: [number, number] = [G, G];
    for (const w of walled.get(n) ?? []) if ((w.a ? sy : sx) === w.s) g[w.a] = w.g1;
    return g;
  };
  // World point on a key plate: sx,sy in -1..1 across the plate, z along the normal,
  // grown past the switch seat's outline by grow, or [x, y] grows.
  const so = sw.seat_outer_mm ?? [16.6, 16.6];
  const at = (
    n: string,
    sx: number,
    sy: number,
    z = 0,
    grow: number | [number, number] = 0,
  ): Vec3 => {
    const [gx, gy] = typeof grow === 'number' ? [grow, grow] : grow;
    return point(frames[n], [sx * (so[0] / 2 + gx), sy * (so[1] / 2 + gy), z]);
  };
  const place = (m: Manifold, f: Matrix4) => m.transform(f.elements as never);
  const down = (p: Vec3, z = 0): Vec3 => [p[0], p[1], z];
  const floorOf = (ps: Vec3[]) => [...ps, ...ps.map((p) => down(p, 1))];
  // Plate edge facing a world XY direction, as two corner sign pairs.
  const edgeFacing = (n: string, dir: [number, number]): Edge => {
    const m = frames[n].elements,
      edges: Edge[] = [
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
    const score = (e: Edge) => {
      const sx = (e[0][0] + e[1][0]) / 2,
        sy = (e[0][1] + e[1][1]) / 2;
      return (m[0] * sx + m[4] * sy) * dir[0] + (m[1] * sx + m[5] * sy) * dir[1];
    };
    return edges.reduce((a, b) => (score(b) > score(a) ? b : a));
  };
  // Solid strip along a plate edge: z0..z1 along the normal, grown g0..g1 outward,
  // running to the plate's corners, or grown along to `along`. Its points are
  // grouped by corner, four each.
  const strip = (
    n: string,
    e: Edge,
    z0: number,
    z1: number,
    g0: number,
    g1: number,
    along?: number,
  ): Vec3[] => {
    const a = axisOf(e);
    return e.flatMap(([sx, sy]) => {
      const o = along ?? gr(n, sx, sy)[1 - a];
      return [z0, z1].flatMap((z) => [g0, g1].map((q) => at(n, sx, sy, z, a ? [o, q] : [q, o])));
    });
  };
  // Register a wall on the side of key n facing dir, its inner face just outside
  // the tile pocket.
  const addWall = (n: string, dir: [number, number]) => {
    const e = edgeFacing(n, dir),
      a = axisOf(e),
      g0 = pk[a] + 0.25 - so[a] / 2;
    walled.set(n, [...(walled.get(n) ?? []), { a, s: e[0][a], g0, g1: g0 + W }]);
  };
  const wallOn = (n: string, e: Edge) =>
    (walled.get(n) ?? []).find((w) => w.a === axisOf(e) && w.s === e[0][axisOf(e)]);
  const toward = (a: string, b: string): [number, number] => {
    const p = frames[a].elements,
      q = frames[b].elements;
    return [q[12] - p[12], q[13] - p[13]];
  };
  const ladder = (ns: string[]) => {
    const parts: Manifold[] = [];
    for (const n of ns)
      parts.push(
        M.hull(
          [-1, 1].flatMap((sx) =>
            [-1, 1].flatMap((sy) => [0, -T].map((z) => at(n, sx, sy, z, gr(n, sx, sy)))),
          ),
        ),
      );
    for (let i = 0; i + 1 < ns.length; i++) {
      const a = ns[i],
        b = ns[i + 1];
      parts.push(
        M.hull([
          ...strip(a, edgeFacing(a, toward(a, b)), 0, -T, 0, G),
          ...strip(b, edgeFacing(b, toward(b, a)), 0, -T, 0, G),
        ]),
      );
    }
    return M.union(parts);
  };
  const rollDir = (n: string, e: Edge): [number, number] => {
    const alongX = e[0][0] === e[1][0],
      sy = alongX ? e[0][0] : e[0][1],
      o = point(frames[n], [0, 0, 0]),
      a = point(frames[n], alongX ? [sy, 0, 0] : [0, sy, 0]),
      l = Math.hypot(a[0] - o[0], a[1] - o[1]);
    return [(a[0] - o[0]) / l, (a[1] - o[1]) / l];
  };
  // Smooth plan curve across the facing edges of a row of end keys, in axes dm
  // (the mean direction the ends face) and ax across it: f = F(a), a quadratic
  // least-squares fit through the end corners pushed out by R, then moved out
  // until the quarter round starts past every tile pocket (the plates reach out
  // flat to meet it) and is at least R-CUT past every plate corner.
  const curveThrough = (ends: string[], facing: [number, number]): Curve => {
    const edges = ends.map((n) => edgeFacing(n, facing));
    const ds = ends.map((n, i) => rollDir(n, edges[i])),
      s = ds.reduce((a, d) => [a[0] + d[0], a[1] + d[1]], [0, 0]),
      l = Math.hypot(s[0], s[1]);
    const dm: [number, number] = [s[0] / l, s[1] / l],
      ax: [number, number] = [-dm[1], dm[0]];
    const corners = ends.flatMap((n, c) =>
      edges[c].map(([sx, sy]) => {
        const p = at(n, sx, sy, 0, gr(n, sx, sy));
        return { a: p[0] * ax[0] + p[1] * ax[1], f: p[0] * dm[0] + p[1] * dm[1], z: p[2], c };
      }),
    );
    // Normal equations for f+R = c0 + c1 a + c2 a^2.
    const S = (pa: number, pf = 0) =>
        corners.reduce((t, q) => t + q.a ** pa * (pf ? q.f + R : 1), 0),
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
      pockets = ends.flatMap((n, c) =>
        edges[c].flatMap(([sx, sy]) =>
          [-T, -tz].map((z) => point(frames[n], [sx * pk[0], sy * pk[1], z])),
        ),
      );
    const shift = Math.max(
      0,
      ...corners.map((q) => q.f + R - CUT - F0(q.a)),
      ...pockets.map((p) => {
        const a = p[0] * ax[0] + p[1] * ax[1];
        return p[0] * dm[0] + p[1] * dm[1] + 0.1 + R - F0(a);
      }),
    );
    return { dm, ax, F: (a) => F0(a) + shift, corners };
  };
  const P = (cv: Curve, a: number, f: number, z: number): Vec3 => [
    cv.ax[0] * a + cv.dm[0] * f,
    cv.ax[1] * a + cv.dm[1] * f,
    z,
  ];
  // Swept end: the quarter round's top follows the end keys' heights (linear
  // between corners). Each key's surface continues flat out to it. With slots,
  // round-bottomed slots part neighbouring keys down to half the wall height.
  // Returns the swept end, a cap for each of its two open ends (points: the
  // quarter round W thick, down to the base) and its footprint along the base.
  const sweptEnd = (cv: Curve, ends: string[], facing: [number, number], slots: boolean) => {
    const cs = [...cv.corners].sort((x, y) => x.a - y.a),
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
    // Flat continuation of each end key out to the swept end, 0.5 mm into it.
    ends.forEach((n, ci) => {
      const ed = edgeFacing(n, facing),
        q = cv.corners.filter((x) => x.c === ci);
      sweep.push(
        M.hull([
          ...ed.flatMap(([sx, sy]) => [
            at(n, sx, sy, 0, gr(n, sx, sy)),
            at(n, sx, sy, -W, gr(n, sx, sy)),
          ]),
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
    const caps = [
      [a0, 1],
      [a1, -1],
    ].map(([a, s]) =>
      floorOf(
        [0, 1, 2, 3, 4, 5, 6].flatMap((j) =>
          [0, W].map((da) => prof(a + s * da, ((j / 6) * Math.PI) / 2, R)),
        ),
      ),
    );
    return { end, caps, foot: as.map((a) => P(cv, a, cv.F(a) - W / 2, 1)) };
  };
  // Walls: the inner and pinky columns' outer sides, the thumb rows' fronts, and
  // the back of an extra thumb row close in front of the main one.
  const corners = (ns: string[], d: [number, number]) =>
    ns.flatMap((n) => edgeFacing(n, d).map(([sx, sy]) => at(n, sx, sy, 0, G)));
  const close =
    base3.length > 0 &&
    xt.length > 0 &&
    Math.min(
      ...corners(base3, [0, -1]).flatMap((p) =>
        corners(xt, [0, 1]).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])),
      ),
    ) < 15;
  for (const [c, d] of [
    [0, [-1, 0]],
    [COLS.length - 1, [1, 0]],
  ] as [number, [number, number]][])
    for (const r of ROWS) addWall(`matrix_${COLS[c]}_${r}`, d);
  for (const n of [...base3, ...xt]) addWall(n, [0, -1]);
  if (close) for (const n of xt) addWall(n, [0, 1]);
  const parts: Manifold[] = [];
  for (const c of COLS) parts.push(ladder(ROWS.map((r) => `matrix_${c}_${r}`)));
  // Swept ends across the back (e=0, top row) and front (e=1, bottom row) of the columns.
  const ends = [0, 1].map((e) => {
    const ns = COLS.map((c) => `matrix_${c}_${e ? 'bottom' : 'top'}`),
      f: [number, number] = [0, e ? -1 : 1];
    return sweptEnd(curveThrough(ns, f), ns, f, true);
  });
  // Thumb rows: a ladder whose two ends (left, then right) roll over as swept ends.
  const rowEnds = [base3, xt].map((row) => {
    if (!row.length) return [];
    parts.push(ladder(row));
    return row.length > 1
      ? [
          [row[0], row[1]],
          [row.at(-1)!, row.at(-2)!],
        ].map(([n, m]) => {
          const d = toward(m, n);
          return sweptEnd(curveThrough([n], d), [n], d, false);
        })
      : [];
  });
  for (const s of [...ends, ...rowEnds.flat()]) parts.push(s.end);
  // A run of walls along one side of a row of keys: one segment per key, joined
  // at the base and at the plate, with a U slot between neighbours from half
  // height up to just under the plates. An end segment takes in the cap that
  // closes the quarter round of a swept end beside it. Each segment follows its
  // plate's tilt down to the tile pocket's depth, then drops to the base.
  const used = new Set<Vec3[]>();
  const wallRun = (ns: string[], dir: [number, number], caps: Vec3[][]) => {
    // Each segment is two hulls, the tilted part and the drop, so neither
    // reaches into the tile pocket on a rolled key.
    const segs = ns.map((n) => {
      const e = edgeFacing(n, dir),
        w = wallOn(n, e)!,
        bot = strip(n, e, -tz, -tz, w.g0, w.g1),
        a = axisOf(e);
      return {
        long: strip(n, e, 0, -tz, w.g0, w.g1, pk[1 - a] + 0.25 - so[1 - a] / 2),
        side: strip(n, e, 0, -tz, w.g0, w.g1),
        under: strip(n, e, -T, -T, w.g0, w.g1),
        bot,
        base: bot.map((p) => down(p, 1)),
      };
    });
    const pieces = segs.flatMap((s) => [M.hull(s.side), M.hull([...s.bot, ...s.base])]),
      slots: Manifold[] = [];
    // The half of a segment's point list at one corner: the one nearest point c.
    const nearTo = (c: Vec3 | number[], ps: Vec3[]) => {
      const d = (k: number) => Math.hypot(ps[k][0] - c[0], ps[k][1] - c[1]);
      return d(0) < d(ps.length / 2) ? ps.slice(0, ps.length / 2) : ps.slice(ps.length / 2);
    };
    for (const i of new Set([0, ns.length - 1]))
      for (const cap of caps)
        if (
          !used.has(cap) &&
          Math.min(...segs[i].side.map((p) => Math.hypot(p[0] - cap[0][0], p[1] - cap[0][1]))) < 8
        ) {
          used.add(cap);
          // The cap's quarter round (14 points, the last two at its foot) joins the
          // tilted part, carried along past the tile pocket; its drop to the base
          // joins the segment's drop.
          const s = segs[i],
            c = cap[0],
            top = cap.slice(0, 14);
          pieces.push(
            M.hull([...nearTo(c, s.side), ...nearTo(c, s.long)]),
            M.hull([...nearTo(c, s.long), ...top]),
            M.hull([...nearTo(c, s.bot), ...nearTo(c, s.base), ...top.slice(12), ...cap.slice(14)]),
          );
        }
    // The four points of each list nearest key j, for key i: its corner there.
    const near = (i: number, j: number, ps: Vec3[]) =>
      nearTo([frames[ns[j]].elements[12], frames[ns[j]].elements[13]], ps);
    for (let i = 0; i + 1 < ns.length; i++) {
      const a = segs[i],
        b = segs[i + 1],
        joint = [...near(i, i + 1, a.side), ...near(i + 1, i, b.side)];
      pieces.push(
        M.hull(joint),
        M.hull([
          ...near(i, i + 1, a.bot),
          ...near(i, i + 1, a.base),
          ...near(i + 1, i, b.bot),
          ...near(i + 1, i, b.base),
        ]),
      );
      // No slot where the two edges are offset across the wall (a 1.5u key beside
      // 1u keys): the joint is then a diagonal wall. The slot is 2 hw wide, centred
      // between the two keys; its top follows the plates' undersides between their
      // corners, 0.8 mm below them.
      const hw = 3,
        ua = near(i, i + 1, a.under),
        ub = near(i + 1, i, b.under),
        pa = ua[1],
        pb = ub[1],
        l = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
      const tops = [0.5 - hw / l, 0.5 + hw / l].flatMap((t) =>
          ua.map(
            (p, q) =>
              [
                p[0] + (ub[q][0] - p[0]) * t,
                p[1] + (ub[q][1] - p[1]) * t,
                p[2] + (ub[q][2] - p[2]) * t - 0.8,
              ] as Vec3,
          ),
        ),
        zb = Math.min(...tops.map((p) => p[2])) / 2;
      const wn = [ua[1][0] - ua[0][0], ua[1][1] - ua[0][1]],
        wl = Math.hypot(wn[0], wn[1]) || 1;
      if (zb < hw + 2 || Math.abs((pb[0] - pa[0]) * wn[0] + (pb[1] - pa[1]) * wn[1]) / wl > 4)
        continue;
      const m = [0, 1].map((k) => (pa[k] + pb[k]) / 2),
        tu = [(pb[0] - pa[0]) / l, (pb[1] - pa[1]) / l],
        nu = [-tu[1], tu[0]];
      // Wide enough to pass through both the tilted part and the drop, which sits
      // further out on a rolled key.
      const across =
        Math.max(
          ...[...joint, ...near(i, i + 1, a.bot), ...near(i + 1, i, b.bot)].map((p) =>
            Math.abs((p[0] - m[0]) * nu[0] + (p[1] - m[1]) * nu[1]),
          ),
        ) + 1;
      slots.push(
        M.hull([
          M.cylinder(2 * across, hw, hw, 32, true)
            .rotate([90, 0, 0])
            .rotate([0, 0, (Math.atan2(tu[1], tu[0]) * 180) / Math.PI])
            .translate([m[0], m[1], zb]),
          ...tops.flatMap((p) =>
            [-1, 1].map(
              (b) => [p[0] + nu[0] * b * across, p[1] + nu[1] * b * across, p[2]] as Vec3,
            ),
          ),
        ]),
      );
    }
    const run = M.union(pieces);
    return slots.length ? run.subtract(M.union(slots)) : run;
  };
  for (const c of [0, COLS.length - 1])
    parts.push(
      wallRun(
        ROWS.map((r) => `matrix_${COLS[c]}_${r}`),
        [c ? 1 : -1, 0],
        ends.flatMap((s) => s.caps),
      ),
    );
  [base3, xt].forEach((row, i) => {
    if (row.length)
      parts.push(
        wallRun(
          row,
          [0, -1],
          rowEnds[i].flatMap((s) => s.caps),
        ),
      );
  });
  if (close)
    parts.push(
      wallRun(
        xt,
        [0, 1],
        rowEnds[1].flatMap((s) => s.caps),
      ),
    );
  // Caps on swept ends with no wall beside them.
  for (const cap of [...ends, ...rowEnds.flat()].flatMap((s) => s.caps))
    if (!used.has(cap)) parts.push(M.hull(cap));
  // Ribs along the base, so the footprint is connected without the bottom plate:
  // the main thumb row's right end to the fingers' front, and the thumb rows'
  // ends to each other. Each runs between the closest points of two footprints.
  // Ends are round and centred on the walls' mid-lines, clear of the footprints'
  // ends, so they stay inside the walls.
  const rib = (A: Vec3[], B: Vec3[], h = 6) => {
    let best: [Vec3, Vec3] = [A[1], B[1]],
      d = Infinity;
    for (const p of A.slice(1, -1))
      for (const q of B.slice(1, -1)) {
        const x = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (x < d) {
          d = x;
          best = [p, q];
        }
      }
    return M.hull(best.map((p) => M.cylinder(h - 1, W / 2, W / 2, 24).translate([p[0], p[1], 1])));
  };
  const [mainEnds, extraEnds] = rowEnds;
  if (mainEnds.length) {
    parts.push(rib(mainEnds[1].foot, ends[1].foot));
    if (close && extraEnds.length)
      for (const i of [0, 1]) parts.push(rib(mainEnds[i].foot, extraEnds[i].foot));
  }
  // Tile pockets: clear the tile, its components and the switch body under every
  // key, below the plate, from anything that reaches up under them.
  const pockets = M.union(
    names.flatMap((n) => [
      place(
        M.cube([2 * pk[0], 2 * pk[1], tz - T], true).translate([0, 0, -(tz + T) / 2]),
        frames[n],
      ),
      place(M.cube([cw[0], cw[1], 13 - T], true).translate([0, 0, -(13 + T) / 2]), frames[n]),
    ]),
  );
  const built = M.union(parts),
    walls = built.subtract(pockets);
  // Base plate: the footprint of everything built, holes filled, so it is flush with the walls.
  const area = (p: [number, number][]) =>
    p.reduce((t, q, i) => {
      const r = p[(i + 1) % p.length];
      return t + q[0] * r[1] - r[0] * q[1];
    }, 0);
  const plan = CS.union(
    walls
      .project()
      .toPolygons()
      .filter((p) => area(p as [number, number][]) > 0)
      .map((p) => new CS([p])),
  );
  const base = plan.extrude(ch.base_thickness_mm);
  const pod = trackpadPod(wasm, cfg, frames, G, at),
    pocketCut = built.add(pod).intersect(pockets);
  let body = walls.add(pod);
  // Room above each plate: the switch hole, the switch housing's rim up to the
  // keycap's lowest point, and the keycap with its clearance above that.
  const low = Math.max(0, sw.keycap_bottom_above_plate_mm - sw.travel_mm);
  for (const n of names) {
    const c = capSize(cfg, n),
      m = (sw.keycap_clearance_overrides_mm as Record<string, number>)[n] ?? sw.keycap_clearance_mm;
    body = body
      .subtract(place(M.cube([14, 14, 20], true), frames[n]))
      .subtract(
        place(
          M.cube([c[0] + 2 * m + 0.2, c[1] + 2 * m + 0.2, 60], true).translate([0, 0, low + 30]),
          frames[n],
        ),
      );
    if (low > 0.1)
      body = body.subtract(
        place(M.cube([so[0], so[1], low], true).translate([0, 0, low / 2]), frames[n]),
      );
  }
  return { body, base, pod, pocketCut };
}
// Cirque trackpad in a printed pod on the inner side, held by a bracket to the
// two corners of the far thumb key nearest to it. The bracket takes in the
// plate's full thickness at each corner, above the tile pocket.
function trackpadPod(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
  G: number,
  at: (n: string, sx: number, sy: number, z?: number, grow?: number) => Vec3,
) {
  const M = wasm.Manifold,
    t = cfg.trackpad,
    f = frames.trackpad,
    r = t.diameter_mm / 2 + t.clearance_mm,
    ro = r + t.pod_wall_mm,
    T = cfg.chassis.plate_thickness_mm;
  // The pod's rim top is the frame's origin; the pad sits on the recess floor.
  const recess = t.thickness_mm + t.top_below_rim_mm;
  let pod = M.cylinder(t.pod_depth_mm, ro, ro, 64)
    .translate([0, 0, -t.pod_depth_mm])
    .subtract(M.cylinder(recess + 1, r, r, 64).translate([0, 0, -recess]))
    .transform(f.elements as never);
  const c = point(f, [0, 0, -4]),
    dist = (p: Vec3) => Math.hypot(p[0] - c[0], p[1] - c[1]);
  const near = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
    .map(([sx, sy]) => ({ sx, sy, p: at('thumb_far', sx, sy) }))
    .sort((a, b) => dist(a.p) - dist(b.p))
    .slice(0, 2);
  const rim = near.map(({ p }) => {
    const d = [p[0] - c[0], p[1] - c[1]],
      l = Math.hypot(d[0], d[1]);
    return [c[0] + (d[0] / l) * (ro - 2.5), c[1] + (d[1] / l) * (ro - 2.5), c[2]] as Vec3;
  });
  return pod.add(
    M.hull([
      ...rim.flatMap((p) => [p, [p[0], p[1], p[2] - 4] as Vec3]),
      ...near.flatMap(({ sx, sy }) => [
        at('thumb_far', sx, sy, 0, G),
        at('thumb_far', sx, sy, -T, G),
      ]),
    ]),
  );
}
/** The trackpad itself, for display. */
export const trackpadPart = (
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
) => {
  const t = cfg.trackpad;
  return wasm.Manifold.cylinder(t.thickness_mm, t.diameter_mm / 2, t.diameter_mm / 2, 64)
    .translate([0, 0, -t.top_below_rim_mm - t.thickness_mm + 0.01])
    .transform(frames.trackpad.elements as never);
};
