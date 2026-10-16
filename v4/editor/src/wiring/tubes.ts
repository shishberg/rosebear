// Wires as tubes: the test for two wires passing into each other.
import type { V3 } from '../geometry';
import { WIRING, type Wire } from './common';

/** The squared closest distance between two segments, from their end coordinates. */
function segmentDistance2(
  px: number,
  py: number,
  pz: number,
  qx: number,
  qy: number,
  qz: number,
  rx: number,
  ry: number,
  rz: number,
  sx: number,
  sy: number,
  sz: number,
) {
  const d1x = qx - px,
    d1y = qy - py,
    d1z = qz - pz;
  const d2x = sx - rx,
    d2y = sy - ry,
    d2z = sz - rz;
  const wx = px - rx,
    wy = py - ry,
    wz = pz - rz;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * wx + d2y * wy + d2z * wz;
  const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
  let t1: number;
  let t2: number;
  if (a < 1e-12 && e < 1e-12) return wx * wx + wy * wy + wz * wz;
  if (a < 1e-12) {
    t1 = 0;
    t2 = clamp(f / e);
  } else {
    const c = d1x * wx + d1y * wy + d1z * wz;
    if (e < 1e-12) {
      t2 = 0;
      t1 = clamp(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      t1 = denom > 1e-12 ? clamp((b * f - c * e) / denom) : 0;
      t2 = (b * t1 + f) / e;
      if (t2 < 0) {
        t2 = 0;
        t1 = clamp(-c / a);
      } else if (t2 > 1) {
        t2 = 1;
        t1 = clamp((b - c) / a);
      }
    }
  }
  const x = wx + d1x * t1 - d2x * t2;
  const y = wy + d1y * t1 - d2y * t2;
  const z = wz + d1z * t1 - d2z * t2;
  return x * x + y * y + z * z;
}

/**
 * A wire's path with its bounding box, grown by its radius, and its segments
 * as flat end coordinates (six per segment) with their own boxes.
 */
export interface Tube {
  points: V3[];
  radius: number;
  lo: number[];
  hi: number[];
  ends: Float64Array;
  boxes: Float64Array;
}
export const tubeOf = (points: V3[], diameter: number): Tube => {
  const r = diameter / 2;
  const lo = [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k])) - r);
  const hi = [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k])) + r);
  const n = points.length - 1;
  const ends = new Float64Array(n * 6);
  const boxes = new Float64Array(n * 6);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      const a = points[i][k];
      const b = points[i + 1][k];
      ends[i * 6 + k] = a;
      ends[i * 6 + 3 + k] = b;
      boxes[i * 6 + k] = Math.min(a, b) - r;
      boxes[i * 6 + 3 + k] = Math.max(a, b) + r;
    }
  return { points, radius: r, lo, hi, ends, boxes };
};
/** Whether two wires pass into each other. Wires may touch. */
export const touches = (a: Tube, b: Tube) => {
  const t = WIRING.touch;
  if ([0, 1, 2].some((k) => a.lo[k] > b.hi[k] - t || b.lo[k] > a.hi[k] - t)) return false;
  const limit = (a.radius + b.radius - t) ** 2;
  const A = a.ends;
  const B = b.ends;
  const ba = a.boxes;
  const bb = b.boxes;
  for (let i = 0; i < A.length; i += 6)
    for (let j = 0; j < B.length; j += 6) {
      if (
        ba[i] > bb[j + 3] - t ||
        bb[j] > ba[i + 3] - t ||
        ba[i + 1] > bb[j + 4] - t ||
        bb[j + 1] > ba[i + 4] - t ||
        ba[i + 2] > bb[j + 5] - t ||
        bb[j + 2] > ba[i + 5] - t
      )
        continue;
      if (
        segmentDistance2(
          A[i],
          A[i + 1],
          A[i + 2],
          A[i + 3],
          A[i + 4],
          A[i + 5],
          B[j],
          B[j + 1],
          B[j + 2],
          B[j + 3],
          B[j + 4],
          B[j + 5],
        ) < limit
      )
        return true;
    }
  return false;
};

/** Pairs of wires that pass into each other, by index. */
export function crossings(wires: Wire[]) {
  const tubes = wires.map((w) => tubeOf(w.points, w.diameter));
  const out: [number, number][] = [];
  for (let i = 0; i < tubes.length; i++)
    for (let j = i + 1; j < tubes.length; j++) if (touches(tubes[i], tubes[j])) out.push([i, j]);
  return out;
}
