// A bin's side profile: the bullnose, the ramp to the flat top, the back and
// the underside, and the stations the lofts stand on.
import { END, PART, type Bin } from './common';
import { bezier } from './loft';

// The side profile is fitted to a photo of the C64 whose gutter is 118 px up,
// scaled so the gutter lands on PART. Rounded parts keep the photo's size.
export const PX = PART / 118;
export const BULL = 104 * PX; // the bullnose's length along the deck
const BULL_HANDLE = 93 * PX; // its handle down the front face
// The front underside's round: its handles' lengths.
export const [UNDER_H0, UNDER_H1] = [113 * PX, 116 * PX];
export const BACK_ROUND = 60 * PX; // the back's top corner rounding, which the flat top leaves room for
export const RAKE = Math.tan((7.2 * Math.PI) / 180); // the back's top face leans forward by this slope
export const DECK_SLOPE = Math.tan((7.5 * Math.PI) / 180); // the C64's deck falls to the front at this slope
// A corner where two straight runs meet, rounded by a cubic: [corner, unit
// direction back along the previous run, unit direction along the next run,
// handle lengths and fractions along each].
type Round = [[number, number], [number, number], [number, number], number, number, number, number];
// A bin's section across x. With an apron: round: the ends of the top round of
// the wall between the decks (one point where there's no wall); foot: where
// the round at its foot leaves the apron's deck; rise: the wall's height.
export type Section = [number, number][] & {
  round?: [number, number][];
  foot?: [number, number];
  rise?: number;
};
export const smoothstep = (t: number) => t * t * (3 - 2 * t);
// The case's ends round in over a quarter circle sampled at END_STEPS + 1
// angles; arc(n) is the first n of them.
export const END_STEPS = 8;
export const arc = (n: number) =>
  Array.from({ length: n }, (_, i) => (i / END_STEPS) * (Math.PI / 2));
// The lofts' stations round the low end, then the high end back (each [x,
// inset]), for an end rounding of radius ri.
export const endStations = (x0: number, x1: number, ri: number, angles: number[]) => ({
  lo: angles.map((p): [number, number] => [x0 + END - ri * Math.cos(p), END - ri * Math.sin(p)]),
  hi: [...angles]
    .reverse()
    .map((p): [number, number] => [x1 - END + ri * Math.cos(p), END - ri * Math.sin(p)]),
});
// The i-th of mid stations (about every 5 mm) between the ends' roundings.
export const midStation = (x0: number, x1: number, mid: number, i: number) =>
  x0 + END + ((x1 - x0 - 2 * END) * i) / mid;
export const midCount = (x0: number, x1: number) => Math.ceil((x1 - x0 - 2 * END) / 5);
// A rounded corner drawn as a cubic.
export const round = ([C, u, v, L0, f0, L1, f1]: Round) =>
  bezier(
    [L0, f0 * L0, f1 * L1, L1].map((l, i) => {
      const d = i < 2 ? u : v;
      return [C[0] + d[0] * l, C[1] + d[1] * l] as [number, number];
    }),
  );
const RAKE_LEN = Math.hypot(RAKE, 1);
// The back's top corner, the back foot and the rounded underside at the front:
// the same for every bin, given the grill top's height zG, the back foot's y
// yR, the front's yf and the back's yc.
export const backAndUnder = (
  zG: number,
  yR: number,
  yf: number,
  yc: number,
): [number, number][] => [
  ...round([[yc, zG], [-1, 0], [RAKE / RAKE_LEN, -1 / RAKE_LEN], BACK_ROUND, 0.45, 68 * PX, 0.37]),
  [yR, PART],
  ...round([[yR, 0], [0, 1], [-1, 0], 69 * PX, 0.23, 41 * PX, 0.22]),
  ...round([[yf, 0], [1, 0], [0, 1], UNDER_H0, 0.43, UNDER_H1, 0.31]),
];
// The slope of f at y, by a central difference.
export const slope = (f: (y: number) => number, y: number) => (f(y + 0.01) - f(y - 0.01)) / 0.02;
// Where the bullnose ends on the deck z, BULL back from the front yf, along the
// deck's slope there: its direction, its end's y and the height zf where its
// front-face line meets that slope.
export function bullnose(z: (y: number) => number, yf: number) {
  const s = slope(z, yf + BULL),
    ls = Math.hypot(1, s),
    dir: [number, number] = [1 / ls, s / ls],
    yE = yf + BULL * dir[0];
  return { dir, yE, zf: z(yE) - (yE - yf) * s };
}
// The bullnose's round, from the front face's corner C along dir.
export const bullnoseRound = (C: [number, number], dir: [number, number]) =>
  round([C, [0, -1], dir, Math.min(BULL_HANDLE, C[1] - PART), 0.41, BULL, 0.3]);
// A bin's flat top over the grill: the highest the deck reaches at B on its own
// slope sB, over at most 6 mm.
export const flatTop = (B: [number, number], sB: number, yG: number) =>
  B[1] + Math.max(0, sB) * Math.min(yG - B[0], 6);
// The cubic carrying the deck from B (slope sB) up into the flat top at height
// zT, which starts at yG.
export function rampToFlatTop(B: [number, number], sB: number, yG: number, zT: number) {
  const h = 0.4 * (yG - B[0]),
    lB = Math.hypot(1, sB);
  return bezier([B, [B[0] + h / lB, B[1] + (h * sB) / lB], [yG - h, zT], [yG, zT]]);
}
// Where a bin's deck rises to the flat top (yB: 3 mm past the well, room for
// the trough), the back's top corner (yC) and where the flat top starts (yG):
// long enough for three grill grooves (the C64 has six).
export function binDepths(wb: { max: number[] }, o: Bin) {
  const yB = wb.max[1] + 3,
    yC = wb.max[1] + o.back;
  return { yB, yC, yG: Math.min(yB + 6, yC - BACK_ROUND - (o.noGrill ? 1 : 7)) };
}
// Where the outline poly crosses the vertical line at x.
export const crossings = (poly: [number, number][], x: number) =>
  poly.flatMap((p, i) => {
    const q = poly[(i + 1) % poly.length];
    return (p[0] - x) * (q[0] - x) <= 0 && p[0] !== q[0]
      ? [p[1] + ((q[1] - p[1]) * (x - p[0])) / (q[0] - p[0])]
      : [];
  });
// The point of an outline above the parting line nearest y along it.
export const nearAbove = (pts: [number, number][], y: number) =>
  pts.reduce((p, q) => (Math.abs(q[0] - y) < Math.abs(p[0] - y) && q[1] > PART ? q : p));
