// A bin's deck: the key surface fitted through the plates, the well outline,
// and the apron bin's deck carried on in front.
import type { CrossSection, Vec3 } from 'manifold-3d';
import { Matrix4 } from 'three';
import { capSize, keycapEnvelope, point } from '../geometry';
import { place } from '../manifold-util';
import { LIFT, type Bin, type Kit } from './common';
import { crossings, smoothstep } from './sections';

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
// A keycap's travel envelope for the well's plan: straight-sided round the
// tapered cap (its base, with the cap's clearance), from pressed to the cap's
// top; the top is deliberately not grown by the clearance.
const capSweep = (k: Kit, n: string) => {
  const e = keycapEnvelope(k.cfg, n),
    top = e.z0 + capSize(k.cfg, n)[2];
  return place(
    k.wasm.Manifold.cube([e.base[0], e.base[1], top - e.floor], true).translate([
      0,
      0,
      (top + e.floor) / 2,
    ]),
    k.frames[n],
  );
};
// The width over which a bin's key surface eases from its fit to level.
const HOLD = 10;
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
// across the gaps between them so the outline steps like the C64's, its
// corners square like the C64's.
export function binWell(k0: Kit, o: Bin) {
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
      .offset(-11, 'Miter');
  return { k, keyWell, wb: keyWell.bounds(), P: o.keys.flatMap((n) => corners(k, n)) };
}
// A curved bin's key surface in its own frame: a quadratic fitted through the
// plates, centred on the bin, and held level past the outermost key centres
// (in front of the front row, behind the back row, beyond the end columns),
// rather than climbing on with the fit into a raised lip, back top or end.
// Front and back hold at the same height: the lower of the two rows'. (The
// well is cut out of the deck, so this only shapes the rim round it.)
export function binSurface(k0: Kit, o: Bin) {
  const { k, wb, P } = binWell(k0, o),
    fitted = curvedDeck(
      P,
      (wb.min[0] + wb.max[0]) / 2,
      (wb.min[1] + wb.max[1]) / 2,
      o.lift ?? LIFT,
    ),
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
export function apronDeck(
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
      const ys = polygonsOf(cs).flatMap((poly) => crossings(poly, x));
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
      return smoothstep(t) * Math.max(0, own(x, fore(x)) - base(x, back(x)));
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
