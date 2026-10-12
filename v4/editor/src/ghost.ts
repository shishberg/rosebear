import { Matrix4, Quaternion, Vector3 } from 'three';
import dactyl from '../../mechanical/dactyl-keys.json';
import { componentFrames, type Config } from './geometry';

/**
 * The Dactyl Manuform in use's keys (mechanical/dactyl-keys.json, exported from
 * its generated OpenSCAD by tools/export_dactyl_keys.py), to ghost over the design.
 * Each frame is a key's plate top, like componentFrames'. The old board is set
 * where its 15 finger keys best fit this design's (least squares, turned and
 * moved but not stretched), so its thumbs sit where they were for the same
 * hand on the fingers.
 */
export function oldKeyFrames(cfg: Config) {
  const top = dactyl.plate_thickness,
    old: Record<string, Matrix4> = {};
  for (const k of dactyl.keys) {
    const [x, y, z] = k.axes.map((a) => new Vector3(...(a as [number, number, number])));
    old[k.id] = new Matrix4()
      .makeBasis(x, y, z)
      .setPosition(new Vector3(...(k.origin as [number, number, number])).addScaledVector(z, top));
  }
  const now = componentFrames(cfg),
    fingers = Object.keys(old).filter((n) => n.startsWith('matrix_') && now[n]),
    at = (m: Matrix4) => new Vector3().setFromMatrixPosition(m),
    fit = rigidFit(
      fingers.map((n) => at(old[n])),
      fingers.map((n) => at(now[n])),
    );
  return {
    frames: Object.fromEntries(Object.entries(old).map(([n, m]) => [n, m.premultiply(fit.m)])),
    rms: fit.rms,
  };
}

/** The rotation and translation taking points P nearest to Q (Horn's quaternion method). */
export function rigidFit(P: Vector3[], Q: Vector3[]) {
  const centre = (v: Vector3[]) => v.reduce((s, p) => s.add(p), new Vector3()).divideScalar(v.length),
    pc = centre(P),
    qc = centre(Q),
    S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  P.forEach((p, i) => {
    const a = p.clone().sub(pc).toArray(),
      b = Q[i].clone().sub(qc).toArray();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r * 3 + c] += a[r] * b[c];
  });
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S,
    N = [
      [xx + yy + zz, yz - zy, zx - xz, xy - yx],
      [yz - zy, xx - yy - zz, xy + yx, zx + xz],
      [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
      [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
    ],
    // Power iteration, shifted so the largest eigenvalue is the largest in size.
    shift = N.flat().reduce((s, v) => s + Math.abs(v), 0);
  let q = [1, 0, 0, 0];
  for (let it = 0; it < 500; it++) {
    const n = N.map((row, r) => row.reduce((s, v, c) => s + v * q[c], 0) + shift * q[r]),
      len = Math.hypot(...n);
    q = n.map((v) => v / len);
  }
  const rot = new Matrix4().makeRotationFromQuaternion(new Quaternion(q[1], q[2], q[3], q[0])),
    m = rot.setPosition(qc.clone().sub(pc.clone().applyMatrix4(rot)));
  const rms = Math.sqrt(
    P.reduce((s, p, i) => s + p.clone().applyMatrix4(m).distanceToSquared(Q[i]), 0) / P.length,
  );
  return { m, rms };
}
