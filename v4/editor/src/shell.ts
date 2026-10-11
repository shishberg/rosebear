// The C64-styled shell for the right hand, on the key poses: a "breadbin"
// whose deck follows the keys, with the finger keys in one well and the thumb
// row's deck carried on in front of it as part of the same solid, a grill and
// badge across the back, a parting line all round and a port panel on the
// inner end where the ribbon leaves. The case is hollow; the keys' wells are
// open through it, each with a wall down from the deck round it. The plates
// the switches clip into are added by chassis.ts.
import type { CrossSection, Manifold, ManifoldToplevel, Vec3 } from 'manifold-3d';
import { Matrix4 } from 'three';
import { capSize, isKey, point, type Config } from './geometry';
import { landingBox } from './wiring';

export interface Kit {
  wasm: ManifoldToplevel;
  cfg: Config;
  frames: Record<string, Matrix4>;
}
const keys = (f: Record<string, Matrix4>) => Object.keys(f).filter(isKey);
const thumbs = (k: Kit) =>
  keys(k.frames)
    .filter((n) => n.startsWith('thumb_'))
    .sort((a, b) => k.frames[a].elements[12] - k.frames[b].elements[12]);
// A key's half-widths for fitting the deck: the cap's, plus 0.75 mm.
const half = (k: Kit, n: string, grow = 0) => {
  const c = capSize(k.cfg, n);
  return [c[0] / 2 + 0.75 + grow, c[1] / 2 + 0.75 + grow];
};
// World point on a key: sx,sy in -1..1 across it (see half), z along the normal.
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

// Commodore 64 "breadbin": a wedge whose deck follows a surface fitted
// through the key plates, a bullnose front edge, a rounded underside at the
// front, a rear chamfer with grill grooves running out through both ends, a
// parting line all round, and the keys in a rectilinear well with a shallow
// moat (a thin trough) round it.
interface Bin {
  keys: string[];
  // Plan rotation of the bin about z, degrees; its front faces local -y.
  angle?: number;
  side: number; // case past the wells at each end
  front: number; // case past the wells at the front, bullnose included
  back: number; // case past the wells at the back, where the grill is
  corner: number; // corner radius of the trough in plan
  // No grill grooves across the back.
  noGrill?: boolean;
  // Grilled bins only: a C64 badge set into the grill, centred this far along
  // the bin from its low end (0 to 1). A pill-shaped recess as tall as the
  // grooves' band interrupts them, with five raised stripes on its floor.
  badge?: number;
  ports?: boolean; // a C64 port panel on the low-x end, where the ribbon leaves
  // Carry this other bin's deck (the thumb row's) on in
  // front of the well as part of this bin's sections, out to that bin's front
  // edge, so the two are one deck. Its surface runs back to its well's back
  // edge, then a straight run joins it to this bin's surface at the well's
  // front edge, with a hard angle at each end. The two are one solid: past
  // this bin's low end the other bin's sections carry on alone, turning to
  // square across it towards its far end.
  apron?: Bin;
}
// Height of the parting line between the top case and the bottom section.
const PART = 10;
const WALL = 2; // case wall, deck and floor thickness
// The port insert's neck stands this far out round the ribbon's slot; its tie
// tunnels are centred this far in from the landing's ends, their tops this far
// under its top.
const [NECK, TIE_IN, TIE_BRIDGE] = [1.5, 2.75, 1];
// The wall between the decks is lofted every millimetre where it's lower than this.
const FADE = 2;
// How far the wall round a well reaches down from the deck.
const WELL_WALL = 16;
interface BinParts {
  shell: Manifold; // solid case with trough, grill and parting line cut, wells not yet cut
  wells: Manifold; // the wells, cut from every bin's shell down to the foot of their walls
  well: CrossSection; // the well's outline in plan (world)
  cavity: Manifold; // the case's hollow, before anything is kept back from it
  keep: Manifold; // kept solid inside the hollow: the wall round the well
  x0: number; // the low end face (of an unturned bin)
}
// A corner where two straight runs meet, rounded by a cubic: [corner, unit
// direction back along the previous run, unit direction along the next run,
// handle lengths and fractions along each].
type Round = [[number, number], [number, number], [number, number], number, number, number, number];
// A bin's section across x; with an apron, round: the ends of the top round
// of the wall between the decks (one point where there's no wall).
// round: the wall's top round's ends; rise: the wall's height (between decks).
type Section = [number, number][] & { round?: [number, number][]; rise?: number };
// A cubic Bézier through four control points, sampled at 13 points.
function bezier(P: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12,
      w = [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
    out.push([0, 1].map((j) => w.reduce((q, wi, m) => q + wi * P[m][j], 0)) as [number, number]);
  }
  return out;
}
// A closed solid through (y, z) outlines standing at stations along x: each
// outline is resampled to the same number of points, evenly by length from
// the point nearest anchor, consecutive outlines are joined point to point,
// and the first and last are capped. Marks (the same number on every
// outline: hard corners, say) are matched up too: each run between marks gets
// the same number of points on every outline, spaced evenly along it.
// An outline traced for a loft: its points from the one nearest anchor, their
// distances round it, and the marks' distances (sorted, between 0 and the
// whole length).
function trace(outline: CrossSection, anchor: [number, number], marks: [number, number][] = []) {
  const area = (q: [number, number][]) =>
      q.reduce((t, p, i) => {
        const r = q[(i + 1) % q.length];
        return t + p[0] * r[1] - r[0] * p[1];
      }, 0),
    poly = outline
      .toPolygons()
      .map((q) => q.map(([y, z]) => [y, z] as [number, number]))
      .reduce((p, q) => (area(q) > area(p) ? q : p)),
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
      const p = pts[i],
        q = pts[(i + 1) % m],
        [dy, dz] = [q[0] - p[0], q[1] - p[1]],
        l2 = dy * dy + dz * dz,
        f = l2 ? Math.min(1, Math.max(0, ((y - p[0]) * dy + (z - p[1]) * dz) / l2)) : 0,
        e = (p[0] + f * dy - y) ** 2 + (p[1] + f * dz - z) ** 2;
      if (e < best) [best, t] = [e, cum[i] + f * (cum[i + 1] - cum[i])];
    }
    return t;
  });
  return { pts, cum, at, L: [0, ...[...at].sort((p, q) => p - q), cum[m]] };
}
type Trace = ReturnType<typeof trace>;
// Points per run between marks, n in all, shared out by the runs' lengths.
function shares(L: number[], n: number) {
  const per = L.slice(1).map((l, i) => Math.max(2, Math.round((n * (l - L[i])) / L[L.length - 1])));
  per[per.length - 1] += n - per.reduce((t, c) => t + c, 0);
  return per;
}
// A traced outline resampled: per[i] points along the i-th run, evenly by length.
function samples({ pts, cum, L }: Trace, per: number[]) {
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
function loft(
  k: Kit,
  rings: { x: number; outline: CrossSection; marks?: [number, number][] }[],
  anchor: [number, number],
  n = 240,
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
// plane), each placed in 3D by its own map. Each group's consecutive rings are
// joined point to point, and its ends capped unless it says not. share: a
// ring's points that are another's (its point index to the vertex's).
// extra: more faces, as polygons of [ring, point] (counter-clockwise in the
// first ring's plane, facing back along it).
function mesh(
  k: Kit,
  rings: {
    pts: [number, number][];
    place: (w: number, z: number) => Vec3;
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
    for (const [w, z] of r.pts) verts.push(...r.place(w, z));
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
// Least-squares quadratic z = f(x, y) through the points, centred on (xc, yc),
// raised by lift. The curvature terms are lightly damped so a single row of
// keys (no spread across it) still gives a sensible surface.
function curvedDeck(P: Vec3[], xc: number, yc: number, lift: number) {
  const basis = (x: number, y: number) => {
      const u = (x - xc) / 50,
        w = (y - yc) / 50;
      return [1, u, w, u * u, u * w, w * w];
    },
    A = [0, 1, 2, 3, 4, 5].map((i) =>
      [0, 0, 0, 0, 0, 0, 0].map((_, j) => (i === j && i > 2 ? 0.05 : 0)),
    );
  for (const [x, y, z] of P) {
    const r = basis(x, y);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) A[i][j] += r[i] * r[j];
      A[i][6] += r[i] * z;
    }
  }
  // Gauss-Jordan with partial pivoting on the augmented normal equations.
  for (let i = 0; i < 6; i++) {
    let p = i;
    for (let j = i + 1; j < 6; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
    [A[i], A[p]] = [A[p], A[i]];
    for (let j = 0; j < 6; j++) {
      if (j === i) continue;
      const f = A[j][i] / A[i][i];
      for (let m = i; m < 7; m++) A[j][m] -= f * A[i][m];
    }
  }
  const q = A.map((row, i) => row[6] / row[i]);
  return (x: number, y: number) => basis(x, y).reduce((t, r, i) => t + r * q[i], lift);
}
// A bin's own frame (turned by its angle, so its well runs along x) and its
// well: axis-aligned boxes round each key's cap travel, merged and closed
// across the gaps between them so the outline steps like the C64's.
function binWell(k0: Kit, o: Bin) {
  const rot = new Matrix4().makeRotationZ((-(o.angle ?? 0) * Math.PI) / 180),
    k: Kit = {
      ...k0,
      frames: Object.fromEntries(
        Object.entries(k0.frames).map(([n, f]) => [n, rot.clone().multiply(f)]),
      ),
    },
    CS = k.wasm.CrossSection,
    box = (cs: CrossSection) => {
      const bb = cs.bounds();
      return CS.square([bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]]).translate(bb.min);
    },
    keyWell = CS.union(o.keys.map((n) => box(capSweep(k, n).project()).offset(1.2, 'Miter')))
      .offset(11, 'Miter')
      .offset(-11, 'Miter')
      .offset(-2, 'Round', 2, 24)
      .offset(2, 'Round', 2, 24);
  return { k, keyWell, wb: keyWell.bounds(), P: o.keys.flatMap((n) => corners(k, n)) };
}
const LIFT = 3; // deck above the fitted key surface: below the keycaps' lowest travel
// A curved bin's key surface in its own frame: a quadratic fitted through the
// plates, centred on the bin, and held level past the outermost key centres
// (in front of the front row, behind the back row, beyond the end columns),
// rather than climbing on with the fit into a raised lip, back top or end.
// Front and back hold at the same height: the lower of the two rows'. (The
// well is cut out of the deck, so this only shapes the rim round it.)
function binSurface(k0: Kit, o: Bin) {
  const { k, wb, P } = binWell(k0, o),
    fitted = curvedDeck(P, (wb.min[0] + wb.max[0]) / 2, (wb.min[1] + wb.max[1]) / 2, LIFT),
    cs = o.keys.map((n) =>
      corners(k, n).reduce((t, p) => [t[0] + p[0] / 4, t[1] + p[1] / 4], [0, 0]),
    ),
    [px0, px1] = [Math.min(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[0]))],
    [py0, py1] = [Math.min(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[1]))];
  // Held with smooth clamps and a smooth minimum (each eased over its
  // width): a hard one leaves a crease in the deck along the line where it
  // takes hold.
  const smax = (a: number, b: number, w: number) => {
      const h = Math.max(w - Math.abs(a - b), 0) / w;
      return Math.max(a, b) + (h * h * w) / 4;
    },
    smin = (a: number, b: number, w: number) => -smax(-a, -b, w),
    clamp = (v: number, lo: number, hi: number) => smin(hi, smax(lo, v, HOLD), HOLD);
  return (x: number, y: number) => {
    const xc = clamp(x, px0, px1);
    return smin(smin(fitted(xc, clamp(y, py0, py1)), fitted(xc, py0), 1), fitted(xc, py1), 1);
  };
}
// The width over which a bin's key surface eases from its fit to level.
const HOLD = 10;
// An outline's polygons, read out of WebAssembly once: the loft asks for them
// at every sample along it.
const polygons = new WeakMap<CrossSection, ReturnType<CrossSection['toPolygons']>>();
const polygonsOf = (cs: CrossSection) => {
  let p = polygons.get(cs);
  if (!p) polygons.set(cs, (p = cs.toPolygons()));
  return p;
};
// The deck of a bin carrying another bin's (its apron's) deck in front of its
// well, in world coordinates (the carrying bin has no angle). own: the
// carrying bin's surface. front: the apron's front edge at x. breaks: where the
// deck turns along the section at x (the apron well's front and back edges and
// this well's front edge), so each turn is a hard angle.
function apronDeck(
  k0: Kit,
  a: Bin,
  well: CrossSection,
  own: (x: number, y: number) => number,
  FRONT: number,
) {
  const t = ((a.angle ?? 0) * Math.PI) / 180,
    [c, s] = [Math.cos(t), Math.sin(t)],
    { keyWell, wb } = binWell(k0, a),
    held = binSurface(k0, a),
    local = (x: number, y: number) => [x * c + y * s, -x * s + y * c],
    // The world y on the apron's line v (in its own frame) at x.
    line = (v: number, x: number) => (v + x * s) / c,
    vW = wb.min[1],
    base = (x: number, y: number) => {
      const [u, v] = local(x, y);
      return v >= vW ? held(u, v) : held(u, vW) - FRONT * (vW - v);
    },
    // Where the vertical line at x crosses a well's outline, lowest and highest.
    span = (cs: CrossSection, x: number) => {
      const ys: number[] = [];
      for (const poly of polygonsOf(cs))
        poly.forEach((p, i) => {
          const q = poly[(i + 1) % poly.length];
          if ((p[0] - x) * (q[0] - x) <= 0 && p[0] !== q[0])
            ys.push(p[1] + ((q[1] - p[1]) * (x - p[0])) / (q[0] - p[0]));
        });
      return ys.length ? [Math.min(...ys), Math.max(...ys)] : undefined;
    },
    // The apron well's back edge, and this well's front edge, at x: along
    // each well's hull, so the run between them doesn't twist at every step
    // in the wells' outlines (each bend in a hull is a crease across it).
    world = keyWell.rotate(a.angle ?? 0).hull(),
    hull = well.hull(),
    back = (x: number) => span(world, x)?.[1] ?? line(wb.max[1], x),
    // Past either end of this well, and over its rounded corners, its front
    // edge carries straight on (the well's lowest point would be a step).
    hb = hull.bounds(),
    fore = (x: number) => {
      const [lo, hi] = [hb.min[0] + 3, hb.max[0] - 3],
        e = Math.min(hi, Math.max(lo, x)),
        f0 = span(hull, e)![0];
      if (e === x) return f0;
      const d = x < lo ? 1 : -1;
      return f0 + ((span(hull, e + d)![0] - f0) / d) * (x - e);
    },
    // Towards its outer end (from the second-last key's centre to the last's,
    // and on past it) the apron's deck rises to this well's rim, so the two
    // decks meet level there.
    [xa, xb] = a.keys
      .map((n) => k0.frames[n].elements[12])
      .sort((p, q) => p - q)
      .slice(-2),
    lift = (x: number) => {
      const t = Math.min(1, Math.max(0, (x - xa) / (xb - xa)));
      return t * t * (3 - 2 * t) * Math.max(0, own(x, fore(x)) - base(x, back(x)));
    },
    deck = (x: number, y: number) => base(x, y) + lift(x),
    // The run between the wells at x, [from, to]: from the apron well's back
    // edge to this well's front edge, but never steeper than 45 degrees, so
    // where the wells come close or overlap (or the apron well has ended) it
    // starts further forward instead of making a step.
    run = (x: number) => {
      const [yT, yW] = [back(x), fore(x)],
        rise = Math.abs(own(x, yW) - deck(x, Math.min(yT, yW)));
      return [Math.max(line(vW, x) + 1, yW - Math.max(yW - yT, rise, 1)), yW];
    },
    // Where the apron's deck stops at x, at the foot of the wall up to this
    // bin's top: just in front of the apron's trough behind its well (so the
    // trough runs into the wall, and the apron's rise to its flat top stays
    // under it), but not in front of the run's start nor within a millimetre
    // of this well.
    foot = (x: number) => {
      const [yT, yW] = run(x);
      return Math.min(yW - 1, Math.max(yT, line(wb.max[1] + 0.6, x)));
    };
  return {
    t,
    c,
    s,
    wb,
    vW,
    deck,
    front: (x: number) => line(vW - a.front, x),
    // The apron well's front edge, the wall's foot and this well's front edge, at x.
    breaks: (x: number) => [line(vW, x), foot(x), run(x)[1]],
    z: (x: number, y: number) => {
      const [yT, yW] = run(x);
      if (y <= yT) return deck(x, y);
      if (y >= yW) return own(x, y);
      const f = (y - yT) / (yW - yT);
      return deck(x, yT) * (1 - f) + own(x, yW) * f;
    },
  };
}
function breadbin(k0: Kit, o: Bin): BinParts {
  const ang = o.angle ?? 0,
    { k, keyWell, wb } = binWell(k0, o),
    M = k.wasm.Manifold,
    CS = k.wasm.CrossSection;
  // Side profile, fitted to a side-on photo of the C64 and scaled so its gutter
  // (118 px up the photo) lands on the parting line. Every rounded part keeps
  // the photo's size and shape: a corner where two straight runs meet, rounded
  // by a cubic whose handles reach back along each run (handle lengths in px).
  // The front face is vertical above and below the gutter; the bullnose rolls
  // it into the deck; the deck follows the keys and rises behind them into a
  // flat top over the grill; the back is two flat faces meeting
  // at the gutter, the top one raked 7.2 degrees forward, the bottom one
  // vertical. The well's size sets the proportions; the bin's depth and height
  // follow it, not the photo.
  const grilled = !o.noGrill,
    PX = PART / 118, // mm per px
    RAKE = Math.tan((7.2 * Math.PI) / 180),
    bk = Math.hypot(RAKE, 1),
    END = 2, // rounding of the ends, all round
    x0 = wb.min[0] - o.side,
    x1 = wb.max[0] + o.side,
    yF = wb.min[1] - o.front,
    yC = wb.max[1] + o.back,
    // A rounded corner: [corner, towards previous run, towards next run,
    // handle lengths, handle fractions], drawn as a cubic.
    round = ([C, u, v, L0, f0, L1, f1]: Round) => {
      const P = [L0, f0 * L0, f1 * L1, L1].map((l, i) => {
        const d = i < 2 ? u : v;
        return [C[0] + d[0] * l, C[1] + d[1] * l] as [number, number];
      });
      return bezier(P);
    },
    // The back's top corner, the back foot and the rounded underside at the
    // front: the same for every bin, given the grill top's height.
    backAndUnder = (zG: number, yR: number, yf = yF, yc = yC): [number, number][] => [
      ...round([[yc, zG], [-1, 0], [RAKE / bk, -1 / bk], 60 * PX, 0.45, 68 * PX, 0.37]),
      [yR, PART],
      ...round([[yR, 0], [0, 1], [-1, 0], 69 * PX, 0.23, 41 * PX, 0.22]),
      ...round([[yf, 0], [1, 0], [0, 1], 113 * PX, 0.43, 116 * PX, 0.31]),
    ];
  // Front edge at x: straight across, or along the apron bin's front edge.
  let front = (x: number) => (void x, yF);
  // yN: where the bullnose meets the deck (the furthest back); flatStart:
  // where the flat top over the grill begins. zG and yR are the highest
  // section's.
  let yG: number, zG: number, yR: number, yN: number, flatStart: number;
  let body: (inset: number) => Manifold;
  let apronOf: ReturnType<typeof apronDeck> | undefined;
  {
    // Every section across the bin is one continuous outline.
    // Across the well the deck is the key surface (a quadratic fitted through
    // the plates) along that section; in front of it the deck angles down
    // into the photo's bullnose; behind it a cubic carries the deck up into the flat top
    // over the grill, which with the back and the underside is the same in
    // every section. Sections past the end columns repeat the end column's section.
    const held = binSurface(k0, o),
      at = (x: number) => ({
        z: (y: number) => held(x, y),
        s: (y: number) => (held(x, y + 0.01) - held(x, y - 0.01)) / 0.02,
      }),
      // The deck runs 3 mm past the well (room for the trough), then rises
      // into the flat top, which starts before the back corner's rounding.
      yB = wb.max[1] + 3,
      xs = Array.from({ length: 41 }, (_, i) => wb.min[0] + ((wb.max[0] - wb.min[0]) * i) / 40);
    // The flat top is long enough for three grill grooves (the C64 has six).
    yG = Math.min(yB + 6, yC - 60 * PX - (grilled ? 7 : 1));
    // Each section's own flat-top height: where its deck would reach on its
    // own slope (over at most 6 mm), so it doesn't have to dip to meet it.
    // The top follows the dish: each section's own height.
    const top = (x: number) => at(x).z(yB) + Math.max(0, at(x).s(yB)) * Math.min(yG - yB, 6);
    zG = Math.max(...xs.map(top));
    yR = yC + (zG - PART) * RAKE;
    flatStart = yG + 0.4;
    // In front of the well the deck angles down towards the front at the
    // C64's own deck angle (7.5 degrees) from the well's front edge, rolling
    // over the photo's bullnose into the vertical front face; a 2 mm rounding
    // at the well's edge joins it to the key surface.
    const FRONT = Math.tan((7.5 * Math.PI) / 180),
      lF = Math.hypot(1, FRONT),
      fwd: [number, number] = [1 / lF, FRONT / lF],
      yW = wb.min[1],
      // With an apron: the deck at (x, y), in this bin's frame (with no angle
      // of its own, the world's). In front of the apron's well it falls away
      // to the front at the C64's deck angle, as a bin's own front does.
      apron = o.apron && apronDeck(k0, o.apron, keyWell, (x, y) => at(x).z(y), FRONT),
      section = (x: number): Section => {
        if (apron) {
          const yf = apron.front(x),
            z = (y: number) => apron.z(x, y),
            d0 = at(x),
            // The bullnose ends on the deck 104 px back, along the deck's
            // slope there (the deck isn't straight along an angled section).
            L = 104 * PX,
            s = (z(yf + L + 0.01) - z(yf + L - 0.01)) / 0.02,
            ls = Math.hypot(1, s),
            dir: [number, number] = [1 / ls, s / ls],
            yE = yf + L * dir[0],
            zf = z(yE) - (yE - yf) * s,
            zT = top(x),
            y0 = yE + 0.5,
            [yA, yc, yW] = apron.breaks(x),
            // The wall between the decks: the apron's deck stops at its
            // foot, it rises square to it and rolls over (up to 5 mm round)
            // onto a strip falling to the front from this well's edge at
            // the C64's deck angle. Where the decks meet level it's gone.
            zc = apron.deck(x, yc),
            zW = d0.z(yW),
            zS = Math.max(zc, zW - FRONT * (yW - yc)),
            rise = zS - zc,
            R = Math.min(5, 0.6 * rise, 0.6 * (yW - yc)),
            f = Math.min(1, 0.2 * rise),
            sc = (apron.deck(x, yc + 0.01) - apron.deck(x, yc - 0.01)) / 0.02,
            lc = Math.hypot(1, sc),
            lS = Math.hypot(yW - yc, zW - zS),
            ys = [yA];
          for (let y = y0; y < yB; y += 1) ys.push(y);
          ys.sort((p, q) => p - q);
          const B: [number, number] = [yB, z(yB)],
            sB = at(x).s(yB),
            h = 0.4 * (yG - yB),
            lB = Math.hypot(1, sB),
            at2 = (y: number): [number, number] => [y, y < yc ? apron.deck(x, y) : d0.z(y)],
            pts: [number, number][] = [
              [yf, PART],
              ...round([[yf, zf], [0, -1], dir, Math.min(93 * PX, zf - PART), 0.41, L, 0.3]),
              [yE, z(yE)],
              ...ys.filter((y) => y < yc - f - 0.05).map(at2),
              ...round([[yc, zc], [-1 / lc, -sc / lc], [0, 1], f, 0.55, f, 0.55]),
              ...round([[yc, zS], [0, -1], [(yW - yc) / lS, (zW - zS) / lS], R, 0.55, R, 0.55]),
              [yW, zW],
              ...ys.filter((y) => y > yW + 0.05).map(at2),
              ...bezier([B, [yB + h / lB, B[1] + (h * sB) / lB], [yG - h, zT], [yG, zT]]),
              ...backAndUnder(zT, yC + (zT - PART) * RAKE, yf),
            ];
          // (Without a wall its corners are one point.)
          return Object.assign(
            pts.filter(
              (p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.01,
            ),
            {
              round: [
                [yc, zS - R],
                [yc + (R * (yW - yc)) / lS, zS + (R * (zW - zS)) / lS],
              ] as [number, number][],
              rise,
            },
          );
        }
        const d = at(x),
          zT = top(x),
          W: [number, number] = [yW, d.z(yW)],
          C: [number, number] = [yF, W[1] - FRONT * (yW - yF)],
          sW = d.s(yW),
          lW = Math.hypot(1, sW),
          deck: [number, number][] = [];
        for (let y = yW + 2 / lW + 1; y < yB; y += 1) deck.push([y, d.z(y)]);
        const B: [number, number] = [yB, d.z(yB)],
          sB = d.s(yB),
          h = 0.4 * (yG - yB),
          lB = Math.hypot(1, sB),
          rampUp = bezier([B, [yB + h / lB, B[1] + (h * sB) / lB], [yG - h, zT], [yG, zT]]);
        // Clockwise from the front gutter; reversed below.
        return [
          [yF, PART],
          ...round([C, [0, -1], fwd, Math.min(93 * PX, C[1] - PART), 0.41, 104 * PX, 0.3]),
          ...round([W, [-fwd[0], -fwd[1]], [1 / lW, sW / lW], 2, 0.5, 2, 0.5]),
          ...deck,
          ...rampUp,
          ...backAndUnder(zT, yC + (zT - PART) * RAKE),
        ];
      };
    yN = yF + 104 * PX * fwd[0];
    if (apron) front = apron.front;
    body = (inset: number) => {
      const ri = END - inset,
        stations: [number, number][] = [],
        N = 8;
      for (let i = 0; i <= N; i++) {
        const p = (i / N) * (Math.PI / 2);
        stations.push([x0 + END - ri * Math.cos(p), END - ri * Math.sin(p)]);
      }
      const mid = Math.ceil((x1 - x0 - 2 * END) / 5);
      for (let i = 1; i < mid; i++)
        stations.push([x0 + END + ((x1 - x0 - 2 * END) * i) / mid, inset]);
      for (let i = N; i >= 0; i--) {
        const p = (i / N) * (Math.PI / 2);
        stations.push([x1 - END + ri * Math.cos(p), END - ri * Math.sin(p)]);
      }
      return loft(
        k,
        stations.map(([x, off]) => ({
          x,
          outline: new CS([section(x).reverse()]).offset(-off, 'Round', 2, 24),
        })),
        [yR, PART],
      );
    };
    if (apron) body = joined(apron, o.apron!, section, yB, yR);
    apronOf = apron || undefined;
  }
  // A bin carrying another's deck (its apron's) is one solid with it: lofted
  // through this bin's sections, from its low end on, and the apron bin's own
  // sections past there, on planes that turn from square across the apron bin
  // at its far end to square across this one where they meet. There, the
  // apron's section is the lower part of this bin's: they share the outline
  // from the deck in front of this well round the front and along the
  // bottom, and the rest of this bin's section is its end face, rounded in
  // like any end. section: this bin's sections; yB: where its deck starts to
  // rise to the flat top; yR: its back foot.
  function joined(
    A: ReturnType<typeof apronDeck>,
    a: Bin,
    section: (x: number) => Section,
    yB: number,
    yR: number,
  ) {
    const tB = A.wb.max[1] + 3,
      tC = A.wb.max[1] + a.back,
      tG = Math.min(tB + 6, tC - 60 * PX - (a.noGrill ? 1 : 7)),
      // The apron bin's section on the vertical plane through O whose normal
      // is at phi (0: square across x; the apron's angle: square across it),
      // in w along the plane (y, when phi is 0) and z: the carried deck in
      // front, as in this bin's sections, then the apron bin's own rise into
      // its flat top, and its own back.
      apronSection = (O: [number, number], phi: number) => {
        const [sp, cp] = [Math.sin(phi), Math.cos(phi)],
          vO = -O[0] * A.s + O[1] * A.c,
          cd = Math.cos(A.t - phi),
          wOf = (v: number) => (v - vO) / cd,
          z = (w: number) => A.deck(O[0] - w * sp, O[1] + w * cp),
          yf = wOf(A.vW - a.front),
          L = 104 * PX,
          s = (z(yf + L + 0.01) - z(yf + L - 0.01)) / 0.02,
          ls = Math.hypot(1, s),
          dir: [number, number] = [1 / ls, s / ls],
          yE = yf + L * dir[0],
          zf = z(yE) - (yE - yf) * s,
          [wB, wG, wC] = [tB, tG, tC].map(wOf),
          sB = (z(wB + 0.01) - z(wB - 0.01)) / 0.02,
          zT = z(wB) + Math.max(0, sB) * Math.min(wG - wB, 6),
          wR = wC + (zT - PART) * RAKE,
          ys = [wOf(A.vW)];
        for (let y = yE + 0.5; y < wB; y += 1) ys.push(y);
        ys.sort((p, q) => p - q);
        const B: [number, number] = [wB, z(wB)],
          h = 0.4 * (wG - wB),
          lB = Math.hypot(1, sB),
          pts: [number, number][] = [
            [yf, PART],
            ...round([[yf, zf], [0, -1], dir, Math.min(93 * PX, zf - PART), 0.41, L, 0.3]),
            [yE, z(yE)],
            ...ys
              .filter((y, i) => i === 0 || y - ys[i - 1] > 0.05)
              .map((y): [number, number] => [y, z(y)]),
            ...bezier([B, [wB + h / lB, B[1] + (h * sB) / lB], [wG - h, zT], [wG, zT]]),
            ...backAndUnder(zT, wR, yf, wC),
          ];
        return {
          pts,
          yf,
          wR,
          wOf,
          // The section's highest point at w.
          top: (w: number) =>
            Math.max(
              ...pts.flatMap((p, i) => {
                const q = pts[(i + 1) % pts.length];
                return (p[0] - w) * (q[0] - w) <= 0 && p[0] !== q[0]
                  ? [p[1] + ((q[1] - p[1]) * (w - p[0])) / (q[0] - p[0])]
                  : [];
              }),
            ),
          place: (w: number, zz: number): Vec3 => [O[0] - w * sp, O[1] + w * cp, zz],
        };
      },
      outline = (pts: [number, number][], off: number) =>
        new CS([[...pts].reverse()]).offset(-off, 'Round', 2, 24),
      largest = (cs: CrossSection) =>
        cs
          .toPolygons()
          .reduce((p, q) => (q.length > p.length ? q : p))
          .map(([y, z]) => [y, z] as [number, number]),
      // The marks along the front, the same on both bins' sections: the
      // bullnose's end, the apron well's front edge, the gutter and the ends
      // of the rounded underside.
      frontMarks = (pts: [number, number][], yf: number, yW: number) => {
        const near = (y: number) =>
          pts.reduce((p, q) => (Math.abs(q[0] - y) < Math.abs(p[0] - y) && q[1] > PART ? q : p));
        return [
          near(yf + 104 * PX * 0.99),
          near(yW),
          [yf, PART],
          [yf, 116 * PX],
          [yf + 113 * PX, 0],
        ] as [number, number][];
      },
      // An outline moved inward by e, except along the stretch from a round
      // (counter-clockwise) to b, which the apron's outline t shares. The
      // rest moves in the whole way, and where it meets t (near a and near b)
      // the outline follows t instead: this bin's end rounds in fully and
      // stops against the apron's surface, as one solid meeting another.
      // Points are a few tenths of a millimetre apart first, so it moves in
      // evenly.
      shrinkAway = (
        poly: [number, number][],
        a: [number, number],
        b: [number, number],
        e: number,
        t: [number, number][],
      ) => {
        type P = [number, number];
        const m = poly.length,
          same = (p: P, q: P) => p[0] === q[0] && p[1] === q[1],
          ia = poly.findIndex((p) => same(p, a)),
          ib = poly.findIndex((p) => same(p, b)),
          free: P[] = [];
        // The free stretch, b round to a, made dense.
        for (let k = 0, i = ib; k < (ia - ib + m) % m; k++, i = (i + 1) % m) {
          const p = poly[i],
            q = poly[(i + 1) % m],
            steps = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.3));
          for (let j = 0; j < steps; j++)
            free.push([p[0] + ((q[0] - p[0]) * j) / steps, p[1] + ((q[1] - p[1]) * j) / steps]);
        }
        free.push(poly[ia]);
        // Inward (left, counter-clockwise) normal: the mean of the edges'
        // either side, lengthened to keep both edges e in (capped at sharp corners).
        const unit = (u: P, v: P): P => {
            const l = Math.hypot(v[0] - u[0], v[1] - u[1]);
            return [-(v[1] - u[1]) / l, (v[0] - u[0]) / l];
          },
          moved = free.map((p, i): P => {
            const n1 = unit(free[Math.max(0, i - 1)], free[Math.max(1, i)]),
              n2 = unit(free[Math.min(i, free.length - 2)], free[Math.min(i + 1, free.length - 1)]),
              n: P = [n1[0] + n2[0], n1[1] + n2[1]],
              c = (n[0] * n1[0] + n[1] * n1[1]) / Math.hypot(...n),
              k = e / Math.max(c, 1 / 3) / Math.hypot(...n);
            return [p[0] + n[0] * k, p[1] + n[1] * k];
          }),
          // The apron's outline inside this one: from b round to a.
          [tb, ta] = [b, a].map((p) => t.findIndex((q) => same(p, q))),
          inner: P[] = [];
        for (let i = tb; ; i = (i + 1) % t.length) {
          inner.push(t[i]);
          if (i === ta) break;
        }
        // Where the moved stretch crosses it: [along moved, along inner, point].
        const hits: [number, number, P][] = [];
        for (let i = 0; i + 1 < moved.length; i++)
          for (let j = 0; j + 1 < inner.length; j++) {
            const [p, q, r, s2] = [moved[i], moved[i + 1], inner[j], inner[j + 1]],
              d = (q[0] - p[0]) * (s2[1] - r[1]) - (q[1] - p[1]) * (s2[0] - r[0]);
            if (!d) continue;
            const u = ((r[0] - p[0]) * (s2[1] - r[1]) - (r[1] - p[1]) * (s2[0] - r[0])) / d,
              v = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
            if (u >= 0 && u < 1 && v >= 0 && v < 1)
              hits.push([i + u, j + v, [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]]);
          }
        hits.sort((h, g) => h[0] - g[0]);
        const [hb, ha] = [hits[0], hits[hits.length - 1]];
        if (hits.length < 2 || hb[1] > ha[1])
          throw new Error(`joined: the end's outline meets the apron's ${hits.length} times`);
        const kept: P[] = [];
        for (let k = 0, i = ia; k <= (ib - ia + m) % m; k++, i = (i + 1) % m) kept.push(poly[i]);
        return {
          // Where it meets the apron's outline, near a and near b.
          a: ha[2],
          b: hb[2],
          cs: new CS([
            [
              ...kept,
              ...inner.slice(1, Math.floor(hb[1]) + 1),
              hb[2],
              ...moved.slice(Math.floor(hb[0]) + 1, Math.floor(ha[0]) + 1),
              ha[2],
              ...inner.slice(Math.floor(ha[1]) + 1, -1),
            ],
          ]),
        };
      },
      // Where the apron's outline leaves this bin's (the apron's lies inside
      // it, on it from the deck corner round the front and bottom): the deck
      // corner, then the base corner. Both are added to this bin's outline as
      // points, so the stretch between them starts and ends on points of it.
      junctions = (F: [number, number][], T: CrossSection) => {
        const t = largest(T),
          // The nearest point to p on F: its edge and the point.
          nearest = ([y, z]: [number, number]) =>
            F.map((p, i) => {
              const q = F[(i + 1) % F.length],
                [dy, dz] = [q[0] - p[0], q[1] - p[1]],
                l2 = dy * dy + dz * dz,
                f = l2 ? Math.min(1, Math.max(0, ((y - p[0]) * dy + (z - p[1]) * dz) / l2)) : 0;
              return { i, d: Math.hypot(p[0] + f * dy - y, p[1] + f * dz - z) };
            }).reduce((a, b) => (b.d < a.d ? b : a)),
          on = t.map((p) => nearest(p).d < 1e-3),
          n = t.length,
          starts = t.flatMap((_, i) => (on[i] && !on[(i + n - 1) % n] ? [i] : [])),
          ends = t.flatMap((_, i) => (on[i] && !on[(i + 1) % n] ? [i] : []));
        if (starts.length !== 1) throw new Error(`joined: ${starts.length} shared runs`);
        const J = t[starts[0]],
          J2 = t[ends[0]],
          poly = [...F];
        // (The later edge first, so the earlier one's index still holds.)
        for (const [i, p] of [J, J2]
          .map((p) => [nearest(p).i, p] as const)
          .sort((a, b) => b[0] - a[0]))
          poly.splice(i + 1, 0, p);
        return { poly, J, J2, t };
      };
    return (inset: number) => {
      const ri = END - inset,
        N = 8,
        quarter = Array.from({ length: ri > 0 ? N + 1 : 1 }, (_, i) => (i / N) * (Math.PI / 2)),
        xj = x0 + inset,
        // This bin's stations [x, inset]: rounded in at the low end, where
        // it's joined to the apron's section (inset at least half a millimetre
        // more there, so the face between them has some height everywhere).
        fs: [number, number][] = quarter.map((p, i) => [
          x0 + END - ri * Math.cos(p),
          i ? END - ri * Math.sin(p) : Math.max(END, inset + 0.5),
        ]),
        mid = Math.ceil((x1 - x0 - 2 * END) / 5),
        // Every millimetre for the first 12 past the low end's rounding: the
        // wall between the decks is tallest there and changes fastest (this
        // well's front edge turns its corner), too fast for 5 mm steps.
        DENSE = 12;
      for (let d = 1; d < DENSE; d++) fs.push([x0 + END + d, inset]);
      // Every millimetre, too, where the wall is low and fading out (and a
      // millimetre either side): it shrinks to nothing where the decks meet
      // level, and 5 mm steps loft that as a fan of twisted slivers.
      const xs: number[] = [];
      for (let x = x0 + END + DENSE; x < x1 - END; x++) xs.push(x);
      const low = xs.map((x) => {
          const r = section(x).rise ?? 0;
          return r > 0 && r < FADE;
        }),
        fine = xs.filter((_, i) => low[i - 1] || low[i] || low[i + 1]);
      for (let i = 1; i < mid; i++) {
        const x = x0 + END + ((x1 - x0 - 2 * END) * i) / mid;
        if (x >= x0 + END + DENSE && fine.every((f) => Math.abs(f - x) > 0.5)) fs.push([x, inset]);
      }
      for (const x of fine) fs.push([x, inset]);
      fs.sort((p, q) => p[0] - q[0]);
      for (const p of [...quarter].reverse())
        fs.push([x1 - END + ri * Math.cos(p), END - ri * Math.sin(p)]);
      const fRings = fs.map(([x, off]) => {
        const pts = section(x),
          T = apronSection([x, 0], 0),
          br = A.breaks(x),
          near = (y: number) =>
            pts.reduce((p, q) => (Math.abs(q[0] - y) < Math.abs(p[0] - y) && q[1] > PART ? q : p)),
          // The wall's top round, from its own ends, so it lines up from one
          // section to the next.
          marks = [...frontMarks(pts, T.yf, br[0]), near(br[2]), near(yB), ...pts.round!];
        // Away from the apron (and at the pinky end) the whole outline rounds in.
        if (off <= inset + 1e-6 || x > (x0 + x1) / 2)
          return {
            x,
            outline: outline(pts, off),
            marks: [...marks, near(br[1]), [T.wR - 41 * PX, 0]] as [number, number][],
          };
        // At the index end, the stretch the apron carries on from (deck
        // corner round the front and bottom to the base corner) stays put;
        // the rest rounds in.
        const { poly, J, J2, t } = junctions(largest(outline(pts, inset)), outline(T.pts, inset));
        const end = shrinkAway(poly, J, J2, off - inset, t);
        return { x, outline: end.cs, marks: [...marks, end.a, end.b] };
      });
      // The apron bin's planes: through its middle line, square across it at
      // its far end (rounded in there), then turning to square across x at
      // the joint, a few millimetres apart.
      const um = (A.wb.min[1] + A.wb.max[1]) / 2,
        onMid = (u: number): [number, number] => [u * A.c - um * A.s, u * A.s + um * A.c],
        ux = A.wb.min[0] - a.side,
        us = ux + END,
        ue = (xj + um * A.s) / A.c,
        Mf = Math.ceil((ue - us) / 3),
        tp: { O: [number, number]; phi: number; off: number }[] = quarter.map((p) => ({
          O: onMid(ux + END - ri * Math.cos(p)),
          phi: A.t,
          off: END - ri * Math.sin(p),
        }));
      // The turn eases in and out: a section's shape depends on its plane's
      // angle, so turning at a steady rate and then stopping leaves a crease
      // where it stops.
      for (let i = 1; i < Mf; i++) {
        const f = i / Mf;
        tp.push({
          O: onMid(us + (ue - us) * f),
          phi: A.t * (1 - f * f * (3 - 2 * f)),
          off: inset,
        });
      }
      tp.push({ O: [xj, 0], phi: 0, off: inset });
      const [J, J2] = fRings[0].marks.slice(-2),
        vJ = -xj * A.s + J[0] * A.c,
        tRings = tp.map(({ O, phi, off }) => {
          const T = apronSection(O, phi),
            wJ = T.wOf(vJ);
          return {
            T,
            outline: outline(T.pts, off),
            marks: [...frontMarks(T.pts, T.yf, T.wOf(A.vW)), [wJ, T.top(wJ)], [T.wR, J2[1]]] as [
              number,
              number,
            ][],
          };
        });
      // Points per run, at the spacing n points round a middle section of
      // this bin gives, each run as many as its longest section needs (the
      // wall between the decks is tall at the low end and gone in the
      // middle); the apron's runs along the shared outline the same as
      // this bin's.
      const n = 240,
        fT = fRings.map((r) => trace(r.outline, [yR, PART], r.marks)),
        tT = tRings.map((r) => trace(r.outline, [r.T.wR, PART], r.marks)),
        ref = fT[Math.floor(fT.length / 2)],
        step = ref.L[ref.L.length - 1] / n,
        most = (ts: Trace[]) =>
          ts[0].L.slice(1).map((_, i) =>
            Math.max(2, ...ts.map((t) => Math.round((t.L[i + 1] - t.L[i]) / step))),
          ),
        perF = most(fT),
        // A run's index from its starting mark's: marks are sorted round from
        // the anchor, so it's the number of marks up to and at it (where the
        // wall between the decks is gone, its marks fall on the same spot as
        // its foot's, and the run starts after them all).
        run = (t: Trace, m: number) => t.L.slice(1, -1).filter((l) => l <= t.at[m]).length,
        nm = fRings[0].marks.length,
        [fj, fj2] = [run(ref, nm - 2), run(ref, nm - 1)],
        [tj, tj2] = [run(tT[tT.length - 1], 5), run(tT[tT.length - 1], 6)],
        perT = most(tT).map((c, i) => (i >= tj && i < tj2 ? perF[fj + i - tj] : c));
      if (fj2 - fj !== tj2 - tj) throw new Error('joined: shared runs differ');
      const start = (per: number[], r: number) => per.slice(0, r).reduce((t, c) => t + c, 0),
        [sF, sF2, sT, sT2] = [start(perF, fj), start(perF, fj2), start(perT, tj), start(perT, tj2)],
        nF = perF.reduce((t, c) => t + c, 0),
        nT = perT.reduce((t, c) => t + c, 0),
        ti = tRings.length - 1,
        fi = tRings.length,
        rings = [
          ...tRings.map((r, i) => ({ pts: samples(tT[i], perT), place: r.T.place })),
          ...fRings.map((r, i) => ({
            pts: samples(fT[i], perF),
            place: (y: number, z: number): Vec3 => [r.x, y, z],
          })),
        ];
      // The last apron section's shared points are the first of this bin's.
      const share = new Map<number, number>();
      // (Vertex numbers: mesh() numbers each ring's points in turn.)
      const base = rings.slice(0, fi).reduce((t, r) => t + r.pts.length, 0);
      for (let j = sT; j <= sT2; j++) share.set(j, base + sF + j - sT);
      (rings[ti] as { share?: Map<number, number> }).share = share;
      // The end face: this bin's first outline from the low junction round
      // the back to the deck one, then back along the apron's.
      const face: [number, number][] = [];
      for (let j = sF2; j < nF; j++) face.push([fi, j]);
      for (let j = 0; j <= sF; j++) face.push([fi, j]);
      for (let j = sT - 1; j >= 0; j--) face.push([ti, j]);
      for (let j = nT - 1; j > sT2; j--) face.push([ti, j]);
      return mesh(
        k,
        rings,
        [
          { rings: tRings.map((_, i) => i), open: [false, true] },
          { rings: fRings.map((_, i) => fi + i), open: [true, false] },
        ],
        [face],
      );
    };
  }
  const shell = body(0),
    bb = shell.boundingBox(),
    // The part of a plan shape's prism within d (vertically) of the shell's
    // top: the shell lowered by d, taken away, rather than the prism cut to
    // the shell, so no face of the cut lies on the shell's (coincident faces
    // leave slivers).
    near = (cs: CrossSection, d: number) => prism(cs).subtract(shell.translate([0, 0, -d])),
    prism = (cs: CrossSection) => cs.extrude(400).translate([0, 0, -1]),
    slab = (z0: number, z1: number) =>
      M.cube([bb.max[0] - bb.min[0] + 40, bb.max[1] - bb.min[1] + 40, z1 - z0]).translate([
        bb.min[0] - 20,
        bb.min[1] - 20,
        z0,
      ]);
  // Grill: grooves across the flat top between its two roundings, out through
  // both ends.
  const grooves: CrossSection[] = [],
    gTop = yC - 60 * PX - 0.4;
  let gBottom = gTop;
  if (grilled)
    for (let y = gTop; y - 1.2 > flatStart; y -= 2.4) {
      grooves.push(CS.square([x1 - x0 + 4, 1.2]).translate([x0 - 2, y - 1.2]));
      gBottom = y - 1.2;
    }
  // Badge, as on the C64's top: a pill-shaped recess 1 mm deep, 0.6 mm taller
  // than the grooves' band at each side, with the grooves stopping 1.2 mm short
  // of it. On its floor five raised stripes, 0.8 mm wide with 0.6 mm gaps, run
  // the pill's straight stretch with square ends, all lined up; their
  // tops stay 0.2 mm under the top around them. Floor and stripe tops are the
  // shell lowered, like the grooves, so no face of the cut lies on the shell's
  // or on another's.
  let pill: CrossSection | undefined, badge: Manifold | undefined;
  if (grilled && grooves.length && o.badge !== undefined) {
    const H = gTop - gBottom + 1.2,
      L = 25,
      r = H / 2,
      bx = x0 + (x1 - x0) * o.badge,
      by = (gTop + gBottom) / 2,
      [W, GAP] = [0.8, 0.6],
      pitch = W + GAP,
      run = L - 2 * r, // each stripe's length: out to the centres of the pill's rounds
      sy = by - (4 * pitch + W) / 2,
      stripes = CS.ofPolygons(
        [0, 1, 2, 3, 4].map((i) => {
          const [u, v] = [bx - run / 2, sy + i * pitch];
          return [
            [u, v],
            [u + run, v],
            [u + run, v + W],
            [u, v + W],
          ] as [number, number][];
        }),
      );
    pill = CS.hull([
      CS.circle(r, 32).translate([bx - L / 2 + r, by]),
      CS.circle(r, 32).translate([bx + L / 2 - r, by]),
    ]);
    badge = near(pill, 1).subtract(prism(stripes).intersect(shell.translate([0, 0, -0.2])));
  }
  // (An empty cut would empty the whole result, so a bin without grooves skips it.)
  const cut = grooves.length
      ? near(
          pill ? CS.union(grooves).subtract(pill.offset(1.2, 'Round', 2, 32)) : CS.union(grooves),
          1.2,
        )
      : undefined,
    grill = cut && badge ? cut.add(badge) : cut;
  // Trough: 0.8 mm wide and 1 mm deep, following the case outline on the deck:
  // in from the ends, just behind the bullnose, between the well and the flat top.
  // (With an apron, round both bins' outlines.)
  const rx0 = x0 + END + 1,
    ry0 = (x: number) => front(x) + yN - yF + 1,
    rx1 = x1 - END - 1,
    ry1 = wb.max[1] + 1.6,
    // A rectangle, turned by deg.
    rect = (u0: number, u1: number, v0: number, v1: number, deg = 0) =>
      CS.square([u1 - u0, v1 - v0])
        .translate([u0, v0])
        .rotate(deg),
    plan = (() => {
      if (!apronOf)
        return CS.ofPolygons([
          [
            [rx0, ry0(rx0)],
            [rx1, ry0(rx1)],
            [rx1, ry1],
            [rx0, ry1],
          ],
        ]);
      const a = o.apron!,
        A = apronOf,
        deg = (A.t * 180) / Math.PI,
        // The front line, in the apron bin's frame (it runs along it).
        vf = A.vW - a.front + (yN - yF + 1) * A.c;
      return rect(rx0, rx1, Math.min(front(x0), front(x1)) - 20, ry1)
        .add(rect(A.wb.min[0] - a.side + END + 1, 500, vf - 20, A.wb.max[1] + 1.6, deg))
        .intersect(rect(-500, 500, vf, 500, deg))
        .intersect(rect(-500, rx1, -500, 500));
    })(),
    ring = (d: number) =>
      plan
        .offset(-d, 'Miter')
        .offset(-Math.max(0.1, o.corner - d), 'Round', 2, 32)
        .offset(Math.max(0.1, o.corner - d), 'Round', 2, 32),
    band = ring(0).subtract(ring(0.8)),
    // With an apron, the trough doesn't run over the wall between the decks
    // at the inside corner: the apron's runs into the wall and stops flush
    // with it (cut back to the wall's outline a little above the deck, past
    // its foot's rounding), this bin's runs on over the strip above the wall
    // to the wall's foot, so it falls off the wall's rounded top edge as the
    // grill does off the ends.
    trough = near(
      (() => {
        if (!apronOf) return band;
        const yE = apronOf.breaks(rx0 + 0.4)[2] - 1.5,
          yL = front(x0) + 20,
          yc = apronOf.breaks(x0)[1],
          wall = shell.slice(apronOf.deck(x0, yc) + 1.3).intersect(rect(x0, rx0, yL, yE)),
          yF = apronOf.breaks(rx0 + 0.4)[1] + 0.1;
        return band.subtract(wall).subtract(rect(rx0, rx0 + 2, yL, yF));
      })(),
      1,
    );
  // Parting line between the top and bottom halves, 0.8 mm deep. (Cut as the
  // slab outside the inset body, so no face of the cut lies on the shell's.)
  const parting = slab(PART - 0.6, PART + 0.6).subtract(body(0.8));
  // The well is open down through the case to the foot of its wall, which
  // reaches WELL_WALL down from the deck (and stops short of the parting line).
  const below = M.union([shell.translate([0, 0, -WELL_WALL]), slab(-1, PART + 3)]),
    keep = prism(keyWell.offset(WALL, 'Miter')).subtract(below);
  const back = (m: Manifold) => m.rotate([0, 0, ang]);
  return {
    shell: back((grill ? shell.subtract(grill) : shell).subtract(trough).subtract(parting)),
    wells: back(prism(keyWell).subtract(below)),
    well: keyWell.rotate(ang),
    cavity: back(body(WALL)),
    keep: back(keep),
    x0,
  };
}
export interface Shell {
  // The case, hollow, with the wells open through it and the port panel cut.
  body: Manifold;
  // The port panel's dark insert, a separate part, with the ribbon's landing.
  trim: Manifold;
  // The ribbon's slot through the port panel.
  slot: Manifold;
  // The port panel's end face, in world x.
  panel: number;
  // Each well's outline in plan.
  wells: CrossSection[];
  // The parting line's groove bottom: the case above it, the bottom section below.
  split: number;
  // Inside the case's skin: its hollow and its wells, with the walls round
  // the wells, which room under the plates may cut back.
  inside: Manifold;
}
function c64(k: Kit, bins: Bin[]): Shell {
  const M = k.wasm.Manifold,
    parts = bins.map((o) => breadbin(k, o)),
    // A bin that's another's apron is part of that bin's solid: only its
    // well is its own.
    carried = (i: number) => bins.some((b) => b.apron === bins[i]),
    hollow = M.union(parts.filter((_, i) => !carried(i)).map((p) => p.cavity)).subtract(
      M.union(parts.map((p) => p.keep)),
    );
  // Each bin stops at the outline of the bins before it (the thumb bin at the
  // finger bin's walls), so its deck, trough and grill don't run on through them.
  const CS = k.wasm.CrossSection,
    shells = parts.flatMap((p, i) =>
      carried(i)
        ? []
        : i
          ? p.shell.subtract(
              CS.union(parts.slice(0, i).map((q) => q.shell.project()))
                .extrude(400)
                .translate([0, 0, -1]),
            )
          : p.shell,
    );
  const body = M.union(shells)
    .subtract(M.union(parts.map((p) => p.wells)))
    .subtract(hollow);
  // Port panel, as on the C64's right side: a rounded recess in the low end
  // face of the bin with the ports, with a dark insert at its back, straddling
  // the parting line, with the ribbon's slot through it.
  const i = Math.max(
      0,
      bins.findIndex((o) => o.ports),
    ),
    x0 = parts[i].x0,
    r = k.cfg.ribbon,
    land = landingBox(k.cfg),
    a = k.frames.adapter.elements,
    ry = a[13],
    rz = a[14] + land.top + r.thickness_mm / 2,
    [y0, y1, z0, z1, R, D] = [ry - 12, ry + 36, PART - 6, PART + 7, 3, 1.5],
    face = (from: number, to: number) =>
      M.hull(
        [
          [y0 + R, z0 + R],
          [y1 - R, z0 + R],
          [y0 + R, z1 - R],
          [y1 - R, z1 - R],
        ].map(([y, z]) =>
          M.cylinder(to - from, R, R, 24)
            .rotate([0, 90, 0])
            .translate([from, y, z]),
        ),
      ),
    w = r.width_mm + 2 * r.notch_clearance_mm,
    slot = M.cube([WALL + 1, w, 3]).translate([x0 - 1, ry - w / 2, rz - 1.5]),
    // The insert holds the ribbon: a neck round the slot through the wall
    // behind it, and inside the case the landing, on the bottom plate, where
    // cable ties through two tunnels across it tie the ribbon down. The
    // landing reaches below the neck, so a pull on the ribbon bears on the
    // wall; the halves close on the neck across the parting line.
    neck = M.cube([WALL - D, w + 2 * NECK, 3 + 2 * NECK]).translate([
      x0 + D,
      ry - w / 2 - NECK,
      rz - 1.5 - NECK,
    ]),
    lx = x0 + WALL,
    landing = M.cube([land.length, land.width, land.top - land.bottom]).translate([
      lx,
      ry - land.width / 2,
      a[14] + land.bottom,
    ]),
    [tw, th] = r.tie_slot_mm,
    ties = M.union(
      [lx + TIE_IN, lx + land.length - TIE_IN].map((x) =>
        M.cube([tw, land.width + 2, th], true).translate([
          x,
          ry,
          a[14] + land.top - TIE_BRIDGE - th / 2,
        ]),
      ),
    );
  const cased = body.subtract(face(x0 - 1, x0 + D)).subtract(neck);
  return {
    body: cased,
    // Less the case, where the wall's fillet meets the floor under the landing.
    trim: M.union([face(x0 + D - 0.4, x0 + D), neck, landing])
      .subtract(slot)
      .subtract(ties)
      .subtract(cased),
    slot,
    panel: x0,
    wells: parts.map((p) => p.well),
    split: PART - 0.6,
    inside: M.union([
      ...parts.filter((_, i) => !carried(i)).map((p) => p.cavity),
      ...parts.map((p) => p.wells),
    ]),
  };
}
const fingerKeys = (k: Kit) => keys(k.frames).filter((n) => n.startsWith('matrix_'));
// The thumb row's direction in plan, from the far key to the near key.
function thumbAngle(k: Kit) {
  const [p, q] = [k.frames.thumb_far.elements, k.frames.thumb_near.elements];
  return (Math.atan2(q[13] - p[13], q[12] - p[12]) * 180) / Math.PI;
}
/**
 * The shell for the key poses: the finger keys in one bin, with the thumb
 * row's bin (every thumb key) carried on in front of it as one solid, a grill
 * with a C64 badge across the finger bin's back and the port panel on its
 * inner end.
 */
export function shell(k: Kit) {
  const tight = { side: 6, front: 13, corner: 2 },
    thumb: Bin = {
      keys: thumbs(k),
      angle: thumbAngle(k),
      ...tight,
      back: 12,
      noGrill: true,
    };
  return c64(k, [
    { keys: fingerKeys(k), ...tight, back: 20, ports: true, apron: thumb, badge: 0.7 },
    thumb,
  ]);
}
