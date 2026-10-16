// One bin of the case: its lofted body, finishing cuts (grill, badge, trough,
// parting line) and wells; `joined` lofts a bin together with its apron's deck.
import type { CrossSection, Manifold, Vec3 } from 'manifold-3d';
import { prism, slab } from '../manifold-util';
import { END, GROOVE, LIFT, PART, SPLIT, type Bin, type BinParts, type Kit } from './common';
import { apronDeck, binSurface, binWell } from './deck';
import { LOFT_POINTS, largest, loft, mesh, samples, toSegment, trace, type Trace } from './loft';
import {
  BACK_ROUND,
  BULL,
  DECK_SLOPE,
  END_STEPS,
  PX,
  RAKE,
  UNDER_H0,
  UNDER_H1,
  arc,
  backAndUnder,
  binDepths,
  bullnose,
  bullnoseRound,
  crossings,
  endStations,
  flatTop,
  midCount,
  midStation,
  nearAbove,
  rampToFlatTop,
  round,
  slope,
  smoothstep,
  type Section,
} from './sections';

// The wall between the decks is lofted every millimetre where it's lower than this.
const FADE = 2;
// How far the wall round a well reaches down from the deck.
const WELL_WALL = 16;
// The solid of a bin and its apron's: lofted through this bin's sections from
// its low end on, and the apron's own sections past there, on planes that
// turn from square across the apron bin at its far end to square across this
// one where they meet. There the apron's section is the lower part of this
// bin's (they share the outline from the deck in front of this well round the
// front and along the bottom) and the rest of this bin's is its end face.
// yB: where its deck starts to rise to the flat top; yR: its back foot.
function joined(
  k: Kit,
  A: ReturnType<typeof apronDeck>,
  a: Bin,
  section: (x: number) => Section,
  [x0, x1]: [number, number],
  yB: number,
  yR: number,
) {
  const CS = k.wasm.CrossSection;
  const { yB: tB, yC: tC, yG: tG } = binDepths(A.wb, a),
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
        { dir, yE, zf } = bullnose(z, yf),
        [wB, wG, wC] = [tB, tG, tC].map(wOf),
        sB = slope(z, wB),
        zT = flatTop([wB, z(wB)], sB, wG),
        wR = wC + (zT - PART) * RAKE,
        ys = [wOf(A.vW)];
      for (let y = yE + 0.5; y < wB; y += 1) ys.push(y);
      ys.sort((p, q) => p - q);
      const pts: [number, number][] = [
        [yf, PART],
        ...bullnoseRound([yf, zf], dir),
        [yE, z(yE)],
        ...ys
          .filter((y, i) => i === 0 || y - ys[i - 1] > 0.05)
          .map((y): [number, number] => [y, z(y)]),
        ...rampToFlatTop([wB, z(wB)], sB, wG, zT),
        ...backAndUnder(zT, wR, yf, wC),
      ];
      return {
        pts,
        yf,
        wR,
        wOf,
        // The section's highest point at w.
        top: (w: number) => Math.max(...crossings(pts, w)),
        place: (w: number, zz: number): Vec3 => [O[0] - w * sp, O[1] + w * cp, zz],
      };
    },
    outline = (pts: [number, number][], off: number) =>
      new CS([[...pts].reverse()]).offset(-off, 'Round', 2, 24),
    // The marks along the front, the same on both bins' sections: the
    // bullnose's end, the apron well's front edge, the gutter and the ends
    // of the rounded underside.
    frontMarks = (pts: [number, number][], yf: number, yW: number) => {
      return [
        nearAbove(pts, yf + BULL * 0.99),
        nearAbove(pts, yW),
        [yf, PART],
        [yf, UNDER_H1],
        [yf + UNDER_H0, 0],
      ] as [number, number][];
    },
    // An outline moved inward by e, except along the stretch from a round to b
    // (counter-clockwise), which the apron's outline t shares. Where the
    // moved part meets t it follows t, so this bin's end stops against the
    // apron's surface. The points are densified first so it moves in evenly.
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
        // The nearest edge of F to p, and its distance.
        nearest = ([y, z]: [number, number]) =>
          F.map((p, i) => {
            const { ey, ez } = toSegment(p, F[(i + 1) % F.length], y, z);
            return { i, d: Math.hypot(ey, ez) };
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
      quarter = arc(ri > 0 ? END_STEPS + 1 : 1),
      xj = x0 + inset,
      { lo, hi } = endStations(x0, x1, ri, quarter),
      // This bin's stations [x, inset]: rounded in at the low end, where
      // it's joined to the apron's section (inset at least half a millimetre
      // more there, so the face between them has some height everywhere).
      fs: [number, number][] = lo.map(([x, off], i) => [x, i ? off : Math.max(END, inset + 0.5)]),
      mid = midCount(x0, x1),
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
      const x = midStation(x0, x1, mid, i);
      if (x >= x0 + END + DENSE && fine.every((f) => Math.abs(f - x) > 0.5)) fs.push([x, inset]);
    }
    for (const x of fine) fs.push([x, inset]);
    fs.sort((p, q) => p[0] - q[0]);
    fs.push(...hi);
    const fRings = fs.map(([x, off]) => {
      const pts = section(x),
        T = apronSection([x, 0], 0),
        br = A.breaks(x),
        // The wall's top round, from its own ends, so it lines up from one
        // section to the next.
        marks = [
          ...frontMarks(pts, T.yf, br[0]),
          nearAbove(pts, br[2]),
          nearAbove(pts, yB),
          ...pts.round!,
        ];
      // Away from the apron (and at the pinky end) the whole outline rounds in.
      // The deck corner's mark must be where the wall's foot round leaves the
      // apron's deck; anywhere else, the foot round lofts onto the deck as a
      // fan of twisted facets between the last rounded-in section and the
      // first full one.
      if (off <= inset + 1e-6 || x > (x0 + x1) / 2)
        return {
          x,
          outline: outline(pts, off),
          marks: [...marks, pts.foot!, [T.wR - 41 * PX, 0]] as [number, number][],
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
        phi: A.t * (1 - smoothstep(f)),
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
    // Points per run: the spacing LOFT_POINTS round a middle section gives,
    // each run as many as its longest section needs (the wall between the
    // decks is tall at the low end and gone in the middle). The apron's runs
    // along the shared outline match this bin's.
    const n = LOFT_POINTS,
      fT = fRings.map((r) => trace(r.outline, [yR, PART], r.marks)),
      tT = tRings.map((r) => trace(r.outline, [r.T.wR, PART], r.marks)),
      ref = fT[Math.floor(fT.length / 2)],
      step = ref.L[ref.L.length - 1] / n,
      most = (ts: Trace[]) =>
        ts[0].L.slice(1).map((_, i) =>
          Math.max(2, ...ts.map((t) => Math.round((t.L[i + 1] - t.L[i]) / step))),
        ),
      perF = most(fT),
      // A run's index from its starting mark's: the number of marks up to and
      // at it (where the wall is gone its marks coincide with its foot's, and
      // the run starts after them all).
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
export function breadbin(k0: Kit, o: Bin, carried: boolean): BinParts {
  const ang = o.angle ?? 0,
    { k, keyWell, wb } = binWell(k0, o),
    M = k.wasm.Manifold,
    CS = k.wasm.CrossSection;
  // The front face is vertical above and below the gutter; the bullnose rolls
  // it into the deck; the deck follows the keys and rises behind them into a
  // flat top over the grill; the back is two flat faces meeting at the gutter,
  // the top one raked forward, the bottom one vertical. The well's size sets
  // the proportions; the bin's depth and height follow it, not the photo.
  const grilled = !o.noGrill,
    x0 = wb.min[0] - o.side,
    x1 = wb.max[0] + o.side,
    yF = wb.min[1] - o.front,
    { yB, yC, yG } = binDepths(wb, o);
  // Front edge at x: straight across, or along the apron bin's front edge.
  let front = (x: number) => (void x, yF);
  // yN: where the bullnose meets the deck (the furthest back); flatStart: where
  // the flat top over the grill begins; yR: the back foot, set by the highest
  // section.
  let yR: number, yN: number, flatStart: number;
  let body: (inset: number) => Manifold;
  let apronOf: ReturnType<typeof apronDeck> | undefined;
  {
    // Every section across the bin is one continuous outline. Across the well
    // the deck is the key surface along that section; in front of it the deck
    // angles down into the bullnose; behind it a cubic carries the deck up into
    // the flat top over the grill, which with the back and the underside is the
    // same in every section. Sections past the end columns repeat the end
    // column's section.
    const held = binSurface(k0, o),
      at = (x: number) => ({
        z: (y: number) => held(x, y),
        s: (y: number) => slope((v) => held(x, v), y),
      }),
      xs = Array.from({ length: 41 }, (_, i) => wb.min[0] + ((wb.max[0] - wb.min[0]) * i) / 40),
      // Each section's own flat-top height, so it doesn't have to dip to meet it.
      top = (x: number) => flatTop([yB, at(x).z(yB)], at(x).s(yB), yG),
      zG = Math.max(...xs.map(top));
    yR = yC + (zG - PART) * RAKE;
    flatStart = yG + 0.4;
    // In front of the well the deck angles down towards the front from the
    // well's front edge, rolling over the bullnose into the vertical front
    // face; a 2 mm rounding at the well's edge joins it to the key surface.
    const lF = Math.hypot(1, DECK_SLOPE),
      fwd: [number, number] = [1 / lF, DECK_SLOPE / lF],
      yW = wb.min[1],
      // With an apron: the deck at (x, y), in this bin's frame (with no angle
      // of its own, the world's). In front of the apron's well it falls away to
      // the front, as a bin's own front does.
      apron = o.apron && apronDeck(k0, o.apron, keyWell, (x, y) => at(x).z(y), DECK_SLOPE),
      section = (x: number): Section => {
        if (apron) {
          const yf = apron.front(x),
            z = (y: number) => apron.z(x, y),
            d0 = at(x),
            { dir, yE, zf } = bullnose(z, yf),
            zT = top(x),
            y0 = yE + 0.5,
            [yA, yc, yW] = apron.breaks(x),
            // The wall between the decks: the apron's deck stops at its foot,
            // it rises square to it and rolls over (up to 5 mm round) onto a
            // strip falling to the front from this well's edge. Where the
            // decks meet level it's gone.
            zc = apron.deck(x, yc),
            zW = d0.z(yW),
            zS = Math.max(zc, zW - DECK_SLOPE * (yW - yc)),
            rise = zS - zc,
            R = Math.min(5, 0.6 * rise, 0.6 * (yW - yc)),
            f = Math.min(1, 0.2 * rise),
            sc = slope((y) => apron.deck(x, y), yc),
            lc = Math.hypot(1, sc),
            lS = Math.hypot(yW - yc, zW - zS),
            ys = [yA];
          for (let y = y0; y < yB; y += 1) ys.push(y);
          ys.sort((p, q) => p - q);
          const at2 = (y: number): [number, number] => [y, y < yc ? apron.deck(x, y) : d0.z(y)],
            pts: [number, number][] = [
              [yf, PART],
              ...bullnoseRound([yf, zf], dir),
              [yE, z(yE)],
              ...ys.filter((y) => y < yc - f - 0.05).map(at2),
              ...round([[yc, zc], [-1 / lc, -sc / lc], [0, 1], f, 0.55, f, 0.55]),
              ...round([[yc, zS], [0, -1], [(yW - yc) / lS, (zW - zS) / lS], R, 0.55, R, 0.55]),
              [yW, zW],
              ...ys.filter((y) => y > yW + 0.05).map(at2),
              ...rampToFlatTop([yB, z(yB)], at(x).s(yB), yG, zT),
              ...backAndUnder(zT, yC + (zT - PART) * RAKE, yf, yC),
            ];
          // Without a wall its corners are one point.
          return Object.assign(
            pts.filter(
              (p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.01,
            ),
            {
              round: [
                [yc, zS - R],
                [yc + (R * (yW - yc)) / lS, zS + (R * (zW - zS)) / lS],
              ] as [number, number][],
              foot: [yc - f / lc, zc - (f * sc) / lc] as [number, number],
              rise,
            },
          );
        }
        const d = at(x),
          zT = top(x),
          W: [number, number] = [yW, d.z(yW)],
          C: [number, number] = [yF, W[1] - DECK_SLOPE * (yW - yF)],
          sW = d.s(yW),
          lW = Math.hypot(1, sW),
          deck: [number, number][] = [];
        for (let y = yW + 2 / lW + 1; y < yB; y += 1) deck.push([y, d.z(y)]);
        // Clockwise from the front gutter; reversed below.
        return [
          [yF, PART],
          ...bullnoseRound(C, fwd),
          ...round([W, [-fwd[0], -fwd[1]], [1 / lW, sW / lW], 2, 0.5, 2, 0.5]),
          ...deck,
          ...rampToFlatTop([yB, d.z(yB)], d.s(yB), yG, zT),
          ...backAndUnder(zT, yC + (zT - PART) * RAKE, yF, yC),
        ];
      };
    yN = yF + BULL * fwd[0];
    if (apron) front = apron.front;
    body = (inset: number) => {
      const ri = END - inset,
        { lo, hi } = endStations(x0, x1, ri, arc(END_STEPS + 1)),
        mid = midCount(x0, x1),
        stations = [
          ...lo,
          ...Array.from({ length: Math.max(0, mid - 1) }, (_, i): [number, number] => [
            midStation(x0, x1, mid, i + 1),
            inset,
          ]),
          ...hi,
        ];
      return loft(
        k,
        stations.map(([x, off]) => ({
          x,
          outline: new CS([section(x).reverse()]).offset(-off, 'Round', 2, 24),
        })),
        [yR, PART],
      );
    };
    if (apron) body = joined(k, apron, o.apron!, section, [x0, x1], yB, yR);
    apronOf = apron || undefined;
  }
  const shell = body(0),
    bb = shell.boundingBox(),
    // The part of a plan shape's prism within d (vertically) of the shell's
    // top: the shell lowered by d, taken away, rather than the prism cut to
    // the shell, so no face of the cut lies on the shell's (coincident faces
    // leave slivers).
    near = (cs: CrossSection, d: number) => prism(cs).subtract(shell.translate([0, 0, -d])),
    slabOf = (z0: number, z1: number) => slab(M, bb, 20, z0, z1 - z0);
  // The top case's finishing cuts: grill (with its badge), trough and parting line.
  const cuts = () => {
    // Grill: grooves across the flat top between its two roundings, out through
    // both ends.
    const grooves: CrossSection[] = [],
      gTop = yC - BACK_ROUND - 0.4;
    let gBottom = gTop;
    if (grilled)
      for (let y = gTop; y - 1.2 > flatStart; y -= 2.4) {
        grooves.push(CS.square([x1 - x0 + 4, 1.2]).translate([x0 - 2, y - 1.2]));
        gBottom = y - 1.2;
      }
    // Badge, as on the C64's top: a pill-shaped recess in the grill with raised
    // stripes on its floor. Floor and stripe tops are the shell lowered, like
    // the grooves, so no cut face lies on another face.
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
      // With an apron, the trough doesn't cross the wall between the decks: the
      // apron's stops flush against the wall, this bin's runs on over the strip
      // above the wall to its foot and falls off the wall's rounded top edge,
      // as the grill does off the ends.
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
    const parting = slabOf(SPLIT, PART + GROOVE).subtract(body(0.8));
    return { grill, trough, parting };
  };
  const finishing = carried ? undefined : cuts();
  // The well is open down through the case to the foot of its wall, which
  // reaches WELL_WALL down from the deck (and stops short of the parting line).
  const below = M.union([
      shell.translate([0, 0, -WELL_WALL - (o.lift ?? LIFT) + LIFT]),
      slabOf(-1, PART + 3),
    ]),
    keep = prism(keyWell.offset(k.cfg.chassis.skin_mm, 'Miter')).subtract(below);
  const back = (m: Manifold) => m.rotate([0, 0, ang]);
  const finished =
      finishing &&
      back(
        (finishing.grill ? shell.subtract(finishing.grill) : shell)
          .subtract(finishing.trough)
          .subtract(finishing.parting),
      ),
    wells = back(prism(keyWell).subtract(below)),
    well = keyWell.rotate(ang),
    cavity = finishing && back(body(k.cfg.chassis.skin_mm));
  return {
    main: finished && cavity && { shell: finished, cavity },
    wells,
    well,
    keep: back(keep),
    x0,
  };
}
