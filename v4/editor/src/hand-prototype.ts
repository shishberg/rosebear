/**
 * PROTOTYPE ?hand — throwaway. The measured left hand (v4/hand/left-hand.json,
 * mirrored into the right half's layout axes) drawn in the editor, laying out
 * the keys: each home key goes under its fingertip, the top and bottom rows
 * where the fingertip lands when it reaches forward or pulls back, and the
 * thumb row where the thumb reaches by pivoting at its base, each key facing
 * the way the thumb curls to press it. Opening the page and every
 * slider move rewrite the finger columns and the thumb row (Undo restores).
 *
 * Fingers: chains MCP–PIP–DIP–pad from the resting pose. Curl at home bends
 * the PIP, the MCP by 0.4 of that and the DIP by 2/3. At every key, reaching
 * (between rows) is along the keyboard and pressing is square to it, at that
 * point. Either the reach mix is set (MCP degrees per PIP degree) and the
 * fingertip's path is the keyboard, or the press mix is set (PIP+DIP degrees
 * straightened per MCP degree) and the finger reaches square to it at every
 * point (Jindrich et al. 2004 measured a press mix of about 1.4).
 * Thumb: a ball joint at the assumed CMC, hinges at the MCP and IP. Its home
 * pose is set by joint angles; it presses like a finger, curling the MCP and
 * IP (with as much CMC abduction blended in as a slider says), and the CMC
 * reaches between keys, square to the press at each one, the MCP and IP
 * curling toward the near key (straightening toward the far) as set.
 * The palm is a sketch.
 * Settings: two presets (the closest fit to the Dactyl Manuform; the least
 * change from the resting hand that makes a valid layout), a rotation handle
 * (the hand on the board at the middle home key, or the thumb at its CMC), a
 * few basic sliders that move several settings together, and the rest under
 * Advanced. The readout says first whether the layout is valid: no keycap
 * hits another (pressed to the bottom against one at rest), the hand passes
 * through no key, every key is in reach and the board fits the 66 mm tray.
 */
import * as T from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import hand from '../../hand/left-hand.json';
import {
  capSize,
  capTop,
  columnFrames,
  frame,
  ROWS,
  tentFrame,
  type Project,
  type Config,
  type V3,
} from './geometry';
import type { ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildFrame, frameStl } from './hand-frame';

/** The geometry kernel, here on the page for the test frame (it builds in tens of ms). */
let kernel: Promise<ManifoldToplevel> | undefined;
const manifold = () =>
  (kernel ??= import('manifold-3d').then(async (m) => {
    const w = await m.default({ locateFile: () => wasmUrl });
    w.setup();
    return w;
  }));

type Host = {
  scene: T.Scene;
  camera: T.Camera;
  /** The canvas, for the rotation handle. */
  dom: HTMLElement;
  /** The view's orbit controls, held still while the handle drags. */
  orbit: { enabled: boolean };
  project: () => Project;
  snapshot: () => void;
  edited: () => void;
  render: () => void;
  rebuild: () => void;
};
const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
type Finger = (typeof FINGERS)[number];
type Row = (typeof ROWS)[number];
const SCALE: Record<Finger, number> = { index: 1, middle: 1, ring: 0.95, pinky: 0.85 };
/** The fingertip's radius, as drawn. */
const TIP_R = (f: Finger) => 7 * SCALE[f];
const V = (p: number[]) => new T.Vector3(...(p as V3));
const Z = new T.Vector3(0, 0, 1);
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const capHeight = (c: Config) => c.switch.keycap_bottom_above_plate_mm + c.switch.keycap_mm[2];

/** Least squares by Gauss–Newton with backtracking. */
function fit(res: (x: number[]) => number[], x0: number[]) {
  let x = x0.slice();
  const n = x.length,
    cost = (v: number[]) => res(v).reduce((s, r) => s + r * r, 0);
  for (let it = 0; it < 80; it++) {
    const r0 = res(x),
      J = x.map((_, j) => {
        const y = x.slice();
        y[j] += 0.01;
        return res(y).map((v, i) => (v - r0[i]) / 0.01);
      }),
      A = J.map((a, i) =>
        J.map((b, j) => a.reduce((s, v, k) => s + v * b[k], 0) + (i === j ? 1e-6 : 0)),
      ),
      g = J.map((a) => -a.reduce((s, v, k) => s + v * r0[k], 0));
    // Solve A δ = g by elimination.
    const M = A.map((row, i) => [...row, g[i]]);
    for (let c = 0; c < n; c++) {
      const p = M.reduce(
        (b, row, i) => (i >= c && Math.abs(row[c]) > Math.abs(M[b][c]) ? i : b),
        c,
      );
      [M[c], M[p]] = [M[p], M[c]];
      for (let i = 0; i < n; i++)
        if (i !== c) {
          const f = M[i][c] / M[c][c];
          for (let k = c; k <= n; k++) M[i][k] -= f * M[c][k];
        }
    }
    const step = M.map((row, i) => row[n] / row[i]),
      c0 = cost(x);
    let k = Math.min(1, 10 / (Math.hypot(...step) || 1)),
      next = x;
    for (let h = 0; h < 12; h++, k /= 2) {
      next = x.map((v, i) => v + k * step[i]);
      if (cost(next) < c0) break;
    }
    if (Math.hypot(...next.map((v, i) => v - x[i])) < 1e-4) break;
    x = next;
  }
  return x;
}

// ---------------------------------------------------------------- fingers
/** pad: where the finger touches (at rest, the measured print; on a key, the
 * ball's lowest point along the press). ball: the fingertip's centre, a ball
 * of TIP_R fixed to the last segment, resting on the paper at the print. */
type Chain = {
  mcp: T.Vector3;
  pip: T.Vector3;
  dip: T.Vector3;
  pad: T.Vector3;
  ball: T.Vector3;
  tip: T.Vector3;
};
const rest = Object.fromEntries(
  FINGERS.map((f) => {
    const r = hand.fingers[f].rest,
      mcp = V(r.joints.mcp),
      dip = V(r.joints.dip),
      heading = V(r.joints.pip).sub(mcp).setZ(0).normalize(),
      p = rad(r.segment_pitch_deg[2]),
      L = hand.fingers[f].segment_mm.dip_pad,
      tip = dip
        .clone()
        .addScaledVector(heading, Math.cos(p) * L)
        .addScaledVector(Z, -Math.sin(p) * L);
    return [
      f,
      {
        mcp,
        pip: V(r.joints.pip),
        dip,
        pad: V(r.pad),
        ball: V(r.pad).addScaledVector(Z, TIP_R(f)),
        tip,
        heading,
      },
    ];
  }),
) as Record<Finger, Chain & { heading: T.Vector3 }>;

/** mcp, pip: degrees from rest, + curls. abd: + turns toward the thumb. */
function finger(f: Finger, mcp: number, pip: number, abd = 0): Chain {
  const r = rest[f],
    across = new T.Vector3().crossVectors(r.heading, Z).normalize(),
    c = {
      mcp: r.mcp.clone(),
      pip: r.pip.clone(),
      dip: r.dip.clone(),
      pad: r.pad.clone(),
      ball: r.ball.clone(),
      tip: r.tip.clone(),
    },
    bend = (about: T.Vector3, a: number, pts: T.Vector3[]) =>
      pts.forEach((p) => p.sub(about).applyAxisAngle(across, -rad(a)).add(about));
  bend(c.mcp, mcp, [c.pip, c.dip, c.pad, c.ball, c.tip]);
  bend(c.pip, pip, [c.dip, c.pad, c.ball, c.tip]);
  // The DIP follows the PIP, but straightens no further than straight (or its
  // resting angle, where pressing on the paper already bent it back).
  bend(c.dip, Math.max((pip * 2) / 3, Math.min(0, -DIP_BEND[f])), [c.pad, c.ball, c.tip]);
  for (const p of [c.pip, c.dip, c.pad, c.ball, c.tip])
    p.sub(c.mcp).applyAxisAngle(Z, rad(abd)).add(c.mcp);
  return c;
}
const curled = (f: Finger, curl: number, abd = 0) => finger(f, 0.4 * curl, curl, abd);

/** The resting PIP bend, so how far it can straighten before the finger is flat. */
const PIP_BEND = Object.fromEntries(
  FINGERS.map((f) => {
    const p = hand.fingers[f].rest.segment_pitch_deg;
    return [f, p[1] - p[0]];
  }),
) as Record<Finger, number>;
/** The resting DIP bend (negative where it was bent back). */
const DIP_BEND = Object.fromEntries(
  FINGERS.map((f) => {
    const p = hand.fingers[f].rest.segment_pitch_deg;
    return [f, p[2] - p[1]];
  }),
) as Record<Finger, number>;
type Pose = {
  chain: Chain;
  mcp: number;
  pip: number;
  /** How far short of the row the finger stops (it won't straighten past flat). */
  short: number;
  /** The keyboard here: along `t` (away from you), facing `n` (up, square to t). */
  t: T.Vector3;
  n: T.Vector3;
};
const dipOf = (f: Finger, pip: number) => Math.max((pip * 2) / 3, Math.min(0, -DIP_BEND[f]));
/** At a pose: how the fingertip moves per degree at the MCP, and per degree at the
 * PIP (the DIP following, `ip` degrees of PIP and DIP together). */
type Rates = { vm: T.Vector3; vp: T.Vector3; ip: number };
function rates(f: Finger, abd: number, m: number, p: number): Rates {
  const pad = (dm: number, dp: number) => finger(f, m + dm, p + dp, abd).ball,
    o = pad(0, 0);
  return {
    vm: pad(0.01, 0).sub(o).divideScalar(0.01),
    vp: pad(0, 0.01).sub(o).divideScalar(0.01),
    ip: 1 + (dipOf(f, p) - dipOf(f, p - 0.01)) / 0.01,
  };
}
/** How the MCP and PIP move together to reach between rows, at a pose. */
type Way = (r: Rates) => [mcp: number, pip: number];
/** Walk the fingertip `dist` mm (+ away from you) from home along the path `way`
 * gives, step by step. The path is the keyboard: each key lies along it and
 * faces square off it, at that point. */
function rowPose(f: Finger, curl: number, abd: number, dist: number, way: Way): Pose {
  const h = rest[f].heading.clone().applyAxisAngle(Z, rad(abd)),
    flat = -PIP_BEND[f];
  let m = 0.4 * curl,
    p = curl,
    left = Math.abs(dist),
    t = h;
  for (let i = 0; i < 4000; i++) {
    const r = rates(f, abd, m, p),
      [a, b] = way(r),
      w = r.vm.clone().multiplyScalar(a).addScaledVector(r.vp, b),
      k = (w.dot(h) < 0 ? -1 : 1) / w.length(); // joint step per mm the pad moves away
    t = w.multiplyScalar(k);
    if (left < 1e-6) break;
    const step = Math.min(0.25, left) * Math.sign(dist);
    if (p + b * k * step < flat) break;
    m += a * k * step;
    p += b * k * step;
    left -= Math.abs(step);
  }
  const n = Z.clone().multiplyScalar(t.dot(h)).addScaledVector(h, -t.dot(Z)).normalize();
  // It touches the key at the ball's lowest point along the press.
  const chain = finger(f, m, p, abd);
  chain.pad = chain.ball.clone().addScaledVector(n, -TIP_R(f));
  return { chain, mcp: m, pip: p, short: left, t, n };
}
/** The pose turned `a` degrees toward the thumb about a vertical axis through
 * `about` (at the knuckle, the same as rowPose's abduction, since the walk
 * turns with the finger), then moved by `by`. */
function moved(p: Pose, about: T.Vector3, a: number, by = new T.Vector3()): Pose {
  const q = (v: T.Vector3) => v.clone().sub(about).applyAxisAngle(Z, rad(a)).add(about).add(by),
    c = p.chain;
  return {
    ...p,
    chain: {
      mcp: q(c.mcp),
      pip: q(c.pip),
      dip: q(c.dip),
      pad: q(c.pad),
      ball: q(c.ball),
      tip: q(c.tip),
    },
    t: p.t.clone().applyAxisAngle(Z, rad(a)),
    n: p.n.clone().applyAxisAngle(Z, rad(a)),
  };
}
/** The inner column: the arm carries the hand sideways toward the thumb,
 * square to the index column, and the index turns `angle` degrees toward the
 * thumb at its knuckle (0 = parallel to the index column), until the closest
 * key is `gap` mm (centre to centre) from the index column's. */
function innerColumn(index: Pose[], gap: number, angle: number) {
  const d = index[0].chain.pad.clone().sub(index[2].chain.pad).setZ(0).normalize(),
    side = new T.Vector3(-d.y, d.x, 0),
    at = (m: number) =>
      index.map((p) => moved(p, p.chain.mcp, angle, side.clone().multiplyScalar(m))),
    // Signed: negative while the inner column is on the pinky side.
    gapAt = (m: number) =>
      Math.min(
        ...at(m).map(
          (p, i) =>
            p.chain.pad.distanceTo(index[i].chain.pad) *
            Math.sign(p.chain.pad.clone().sub(index[i].chain.pad).dot(side)),
        ),
      ),
    lim = [-40, 80];
  let [lo, hi] = lim;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (gapAt(m) < gap) lo = m;
    else hi = m;
  }
  return { poses: at(hi), slide: hi, limited: hi >= lim[1] - 0.01 || hi <= lim[0] + 0.01 };
}

// ---------------------------------------------------------------- thumb
const cmc = hand.thumb.assumed_cmc,
  C = V(cmc.cmc),
  TL = [cmc.metacarpal_mm, hand.thumb.segment_mm.mcp_ip, hand.thumb.segment_mm.ip_pad],
  thumbRest = cmc.poses['1'];
/** q = yaw, pitch, roll (the CMC), mcp, ip: as in v4/hand/tools/thumb_cmc.py. */
const rotQ = (q: number[]) =>
  new T.Matrix4()
    .makeRotationZ(rad(q[0]))
    .multiply(new T.Matrix4().makeRotationY(rad(q[1])))
    .multiply(new T.Matrix4().makeRotationX(rad(q[2])));
function thumb(q: number[]) {
  const R = rotQ(q),
    d = (a: number) => new T.Vector3(Math.cos(rad(a)), -Math.sin(rad(a)), 0).applyMatrix4(R),
    up = (a: number) => new T.Vector3(Math.sin(rad(a)), Math.cos(rad(a)), 0).applyMatrix4(R),
    M = C.clone().addScaledVector(d(0), TL[0]),
    I = M.clone().addScaledVector(d(q[3]), TL[1]),
    axis = I.clone().addScaledVector(d(q[3] + q[4]), TL[2]);
  return {
    M,
    I,
    axis,
    pad: axis.clone().addScaledVector(up(q[3] + q[4]), -cmc.pad_below_distal_axis_mm),
  };
}
/** Which way the pad moves as the thumb presses: the MCP curls, the IP `mix`
 * times as much, and the CMC abducts (down, away from the palm) `cmc` times as
 * much. */
const pressDir = (q: number[], mix: number, cmc: number) =>
  thumb([q[0], q[1] + cmc, q[2], q[3] + 1, q[4] + mix])
    .pad.sub(thumb(q).pad)
    .normalize();
const arc = hand.thumb.arc_through_prints_1_to_4;
const arcPoint = (a: number) =>
  new T.Vector3(
    arc.centre[0] + arc.radius_mm * Math.cos(rad(a)),
    arc.centre[1] + arc.radius_mm * Math.sin(rad(a)),
    0,
  );
const printAngle = (k: string) => {
  const p = (hand.measured.thumb_prints as Record<string, number[]>)[k];
  return deg(Math.atan2(p[1] - arc.centre[1], p[0] - arc.centre[0]));
};
type ThumbPose = {
  /** CMC degrees from rest: + across toward the fingers, + abducted (down,
   * away from the palm), + twisted to turn the pad down. */
  sweep: number;
  abduct: number;
  twist: number;
  /** MCP and IP, degrees past rest. */
  curl: number;
  /** The press: IP degrees per MCP degree, CMC abduction degrees per MCP degree. */
  mix: number;
  cmc: number;
  /** Along the row, MCP and IP degrees per key: + curls toward the near key
   * and straightens toward the far one (0: the CMC alone moves). */
  bend?: number;
};
/** How far the thumb's MCP and IP go, degrees: a guess (they hyperextend a little). */
const MCP_RANGE = [-10, 90],
  IP_RANGE = [-20, 90];
const inRange = (q: number[]) =>
  q[3] >= MCP_RANGE[0] && q[3] <= MCP_RANGE[1] && q[4] >= IP_RANGE[0] && q[4] <= IP_RANGE[1];
const clamp = (v: number, [lo, hi]: number[]) => Math.min(hi, Math.max(lo, v));
/** The 1u row of a 1.5u + 2×1u cluster: `gap` mm from the 1.5u along the pad's
 * path (+ curled), reached like a finger between rows: MCP degrees per IP
 * degree as set, or square to the press. */
type TwoRows = { gap: number; from: string; reachMix: number };
/** The thumb row in the hand frame, far key first (far = away from the
 * fingers). Each key faces against the press. Between keys the thumb moves as
 * one piece at the CMC (the pad on a sphere round it), square to both the
 * press and the line from the CMC at each point, while the MCP and IP curl
 * `bend` degrees on the way to the near key (straighten to the far), until the
 * key is `spacing` mm from the home key, centre to centre. Frames: z out of the
 * cap, x toward the near key. `stiff`: degrees the MCP or IP would have to go
 * past its limit (the key is then out of reach). */
function thumbRow(t: ThumbPose, spacing: number, two?: TwoRows) {
  const qh = [
      thumbRest[0] - t.sweep,
      thumbRest[1] + t.abduct,
      thumbRest[2] + t.twist,
      thumbRest[3] + t.curl,
      thumbRest[4] + t.curl,
    ],
    press = (q: number[]) => pressDir(q, t.mix, t.cmc),
    /** Along the row, away from the fingers. */
    along = (q: number[], prev?: T.Vector3) => {
      const v = thumb(q).pad.sub(C).cross(press(q)).normalize();
      return (prev ? v.dot(prev) < 0 : v.x > 0) ? v.negate() : v;
    },
    bend = t.bend ?? 0,
    /** `dist` mm round the CMC, curling `curl` degrees on the way. */
    walk = (sign: number, from: number[], dist: number, curl: number) => {
      let q = from,
        v = along(q),
        mcp = from[3],
        ip = from[4];
      for (let left = dist; left > 1e-6;) {
        const step = Math.min(0.25, left),
          r = thumb(q).pad.sub(C),
          turn = new T.Matrix4().makeRotationAxis(
            r.clone().cross(v).normalize(),
            (sign * step) / r.length(),
          ),
          e = new T.Euler().setFromRotationMatrix(turn.multiply(rotQ(q)), 'ZYX');
        mcp += (curl * step) / dist;
        ip += (curl * step) / dist;
        q = [deg(e.z), deg(e.y), deg(e.x), clamp(mcp, MCP_RANGE), clamp(ip, IP_RANGE)];
        v = along(q, v);
        left -= step;
      }
      return { q, stiff: Math.max(Math.abs(mcp - q[3]), Math.abs(ip - q[4])) };
    },
    /** The key `gap` mm (centre to centre) from `from`'s pad, away from the
     * fingers (sign +1) or toward them, the thumb curling `curl` degrees. */
    key = (sign: number, from: number[], gap: number, curl: number) => {
      const p0 = thumb(from).pad,
        at = (d: number) => walk(sign, from, d, curl),
        miss = (d: number) => thumb(at(d).q).pad.distanceTo(p0) - gap;
      // Secant on the distance round the CMC.
      let d0 = gap,
        f0 = miss(d0),
        d1 = Math.max(0.01, gap - f0);
      for (let i = 0; i < 8 && Math.abs(d1 - d0) > 0.01; i++) {
        const f1 = miss(d1),
          d2 = Math.max(0.01, f1 === f0 ? d1 : d1 - (f1 * (d1 - d0)) / (f1 - f0));
        [d0, f0, d1] = [d1, f1, d2];
      }
      return at(d1);
    };
  // 1.5u + 2×1u: the 1u row is a finger's step from the 1.5u (MCP and IP),
  // and its two keys sit either side of that point along the row.
  let ends = [key(1, qh, spacing, -bend), key(-1, qh, spacing, bend)],
    short = 0,
    /** The cluster's keys face square to the row and to the step's path. */
    paths: (T.Vector3 | undefined)[] = [undefined, undefined, undefined];
  if (two) {
    const pad = (q: number[]) => thumb(q).pad,
      /** The joints' step and the pad's way along the path, at q. */
      way = (q: number[], prev?: number[]) => {
        const p0 = pad(q),
          vm = pad([...q.slice(0, 3), q[3] + 0.1, q[4]])
            .sub(p0)
            .divideScalar(0.1),
          vi = pad([...q.slice(0, 4), q[4] + 0.1])
            .sub(p0)
            .divideScalar(0.1),
          p = press(q);
        let [a, b] = two.from === 'reach' ? [two.reachMix, 1] : [vi.dot(p), -vm.dot(p)];
        // Curling (or straightening) at the start; then on along the same path.
        if (prev ? a * prev[0] + b * prev[1] < 0 : (a + b) * two.gap < 0) [a, b] = [-a, -b];
        const w = vm.multiplyScalar(a).addScaledVector(vi, b);
        return { a, b, len: w.length(), dir: w.normalize() };
      };
    let q = qh,
      w = way(q),
      left = Math.abs(two.gap);
    const t0 = w.dir.clone();
    while (left > 1e-6) {
      const step = Math.min(0.25, left),
        k = step / w.len,
        next = [...q.slice(0, 3), q[3] + w.a * k, q[4] + w.b * k];
      if (!inRange(next)) break;
      q = next;
      w = way(q, [w.a, w.b]);
      left -= step;
    }
    short = left;
    // Each 1u key half the spacing from the row's point, so the two are spacing apart.
    ends = [key(1, q, spacing / 2, -bend / 2), key(-1, q, spacing / 2, bend / 2)];
    // The 1u keys: the CMC carries the path's direction round with the thumb.
    const back = rotQ(q).invert();
    paths = [ends[0].q, qh, ends[1].q].map((qk, i) =>
      i === 1 ? t0 : w.dir.clone().transformDirection(rotQ(qk).multiply(back)),
    );
  }
  const stiff = [ends[0].stiff, 0, ends[1].stiff];
  return [ends[0].q, qh, ends[1].q].map((q, i) => {
    const pad = thumb(q).pad,
      pressed = press(q).negate(),
      x = along(q).negate(),
      t = paths[i],
      z = t ? x.clone().cross(t).normalize() : pressed.clone();
    if (z.dot(pressed) < 0) z.negate();
    const xx = x.addScaledVector(z, -x.dot(z)).normalize(),
      m = new T.Matrix4().makeBasis(xx, new T.Vector3().crossVectors(z, xx), z).setPosition(pad);
    /** Degrees the press is off square to the key. */
    return { pad, q, frame: m, short, stiff: stiff[i], off: deg(z.angleTo(pressed)) };
  });
}

// ---------------------------------------------------------------- drawing
const skin = new T.MeshStandardMaterial({
  color: 0xe8b48f,
  roughness: 0.7,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
});
const palmSkin = skin.clone();
palmSkin.opacity = 0.25;
function capsule(a: T.Vector3, b: T.Vector3, r: number) {
  const m = new T.Mesh(new T.CapsuleGeometry(r, Math.max(a.distanceTo(b), 0.01), 4, 12), skin);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}
function drawHand(group: T.Group, chains: Record<Finger, Chain>, th: ReturnType<typeof thumb>) {
  group.clear();
  for (const f of FINGERS) {
    const c = chains[f],
      s = SCALE[f];
    group.add(
      capsule(c.mcp, c.pip, 9.5 * s),
      capsule(c.pip, c.dip, 8 * s),
      capsule(c.dip, c.ball, TIP_R(f)),
    );
  }
  group.add(
    capsule(C, th.M, 11),
    capsule(th.M, th.I, 10.5),
    capsule(th.I, th.axis, cmc.pad_below_distal_axis_mm),
  );
  const wrist = chains.middle.mcp.clone().add(new T.Vector3(-8, -85, -12)),
    hull: T.Vector3[] = [C.clone(), th.M.clone()];
  for (const f of FINGERS) {
    const k = chains[f].mcp;
    hull.push(k.clone().setZ(k.z + 8 * SCALE[f]), k.clone().setZ(k.z - 14 * SCALE[f]));
  }
  for (const dx of [-28, 28])
    for (const dz of [-14, 14]) hull.push(wrist.clone().add(new T.Vector3(dx, 0, dz)));
  group.add(new T.Mesh(new ConvexGeometry(hull), palmSkin));
  const from = printAngle('2') - 15,
    to = printAngle('4') + 15,
    pts = Array.from({ length: 41 }, (_, i) => arcPoint(from + ((to - from) * i) / 40));
  group.add(
    new T.Line(
      new T.BufferGeometry().setFromPoints(pts),
      new T.LineDashedMaterial({
        color: 0xffd060,
        dashSize: 3,
        gapSize: 2,
        transparent: true,
        depthTest: false,
      }),
    ).computeLineDistances(),
  );
}

// ---------------------------------------------------------------- writing the layout
/** Put each finger key's cap-top centre at the given layout point, facing
 * `normal`, its y up the column (`up`, square to the normal, as the checks
 * have it; not the editor column frame's, which carries the config's column
 * roll and turned the inner keys a few degrees from the index's). The column
 * takes the home key's place and splay; each key's own offset and tilt go in
 * key_overrides. */
type KeyTop = { top: T.Vector3; normal: T.Vector3; up: T.Vector3 };
function placeColumns(c: Config, keys: Record<string, KeyTop[]>, splay: Record<string, number>) {
  const g = c.geometry,
    h = capHeight(c),
    over = g.key_overrides as Record<string, { offset_mm?: number[]; rotation_deg?: number[] }>;
  g.columns.forEach((col, ci) => {
    const K = keys[col.name];
    col.rotation_deg = [0, 0, Math.round(splay[col.name] * 10) / 10];
    col.offset_mm = [K[1].top.x - (ci - 2) * g.column_pitch_mm, K[1].top.y, 0];
    col.heights_mm = K.map((k) => r2(k.top.z - h));
    const frames = columnFrames(c, ci);
    ROWS.forEach((r, ri) => {
      const z = K[ri].normal,
        y = K[ri].up.clone().addScaledVector(z, -K[ri].up.dot(z)).normalize(),
        m = frames[ri]
          .clone()
          .invert()
          .multiply(
            new T.Matrix4()
              .makeBasis(new T.Vector3().crossVectors(y, z), y, z)
              .setPosition(K[ri].top.clone().addScaledVector(z, -h)),
          ),
        e = new T.Euler().setFromRotationMatrix(m, 'ZYX');
      over[`matrix_${col.name}_${r}`] = {
        offset_mm: new T.Vector3().setFromMatrixPosition(m).toArray().map(r2),
        rotation_deg: [e.x, e.y, e.z].map((v) => r2(deg(v))),
      };
    });
  });
}
// chassis.json turns the home key a quarter turn in its place; keep that in
// the 1×3. In the 1.5u + 2×1u cluster the 1.5u lies along the row.
const keyTurn = (name: string, two: boolean) => (name === 'home' && !two ? [0, 0, -90] : [0, 0, 0]);
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Put the thumb keys' cap tops on the given frames (layout, far key first). The
 * cluster's root goes on the home key's seat and each key gets its own offset and
 * turn, so the arc's step and well are zeroed. */
function placeThumb(c: Config, tops: T.Matrix4[], two: boolean) {
  const t = c.geometry.thumb,
    seats = tops.map((m) =>
      m.clone().multiply(new T.Matrix4().makeTranslation(0, 0, -capHeight(c))),
    ),
    e = new T.Euler().setFromRotationMatrix(seats[1], 'ZYX');
  t.position_mm = new T.Vector3().setFromMatrixPosition(seats[1]).toArray().map(r2);
  t.rotation_deg = [e.x, e.y, e.z].map((v) => r2(deg(v)));
  t.arc = { ...t.arc, step_deg: 0, well_deg: 0 };
  const inv = frame(t.position_mm, t.rotation_deg).invert();
  (t.keys as { name: string; offset_mm?: number[]; rotation_deg?: number[] }[]).forEach(
    (key, i) => {
      const m = inv
          .clone()
          .multiply(seats[i])
          .multiply(frame([0, 0, 0], keyTurn(key.name, two))),
        ke = new T.Euler().setFromRotationMatrix(m, 'ZYX');
      key.offset_mm = new T.Vector3().setFromMatrixPosition(m).toArray().map(r2);
      key.rotation_deg = [ke.x, ke.y, ke.z].map((v) => r2(deg(v)));
    },
  );
}

// ---------------------------------------------------------------- the layout from the settings
type Settings = {
  /** Degrees: the board's tent, then the hand on it. */
  tent: number;
  roll: number;
  wrist: number;
  bend: number;
  curl: Record<Finger, number>;
  innerGap: number;
  innerAngle: number;
  top: number;
  bottom: number;
  from: string;
  reachMix: number;
  pressMix: number;
  thumb: ThumbPose;
  spacing: number;
  cluster: string;
  two: TwoRows;
};
/** The hand's turn on the (tented) board. */
const turnOf = (s: Settings) =>
  new T.Matrix4()
    .makeRotationZ(rad(-s.bend))
    .multiply(new T.Matrix4().makeRotationX(rad(-s.wrist)))
    .multiply(new T.Matrix4().makeRotationY(rad(s.roll)));
/** The reach between rows: either as set, or square to the press as set. */
const wayOf =
  (s: Settings): Way =>
  (r) => {
    if (s.from === 'reach') return [s.reachMix, 1];
    const press = r.vm.clone().addScaledVector(r.vp, -s.pressMix / r.ip);
    return [r.vp.dot(press), -r.vm.dot(press)];
  };
const twoOf = (s: Settings) => (s.cluster === '1×3' ? undefined : s.two);
/** Every column's poses (the inner column's too) and the thumb row, in the hand frame. */
function solveHand(s: Settings) {
  const way = wayOf(s),
    poses: Record<string, Pose[]> = {};
  for (const f of FINGERS)
    poses[f] = ROWS.map((r) =>
      rowPose(f, s.curl[f], 0, r === 'top' ? s.top : r === 'bottom' ? -s.bottom : 0, way),
    );
  const inner = innerColumn(poses.index, s.innerGap, s.innerAngle);
  poses.inner = inner.poses;
  return { poses, inner, row: thumbRow(s.thumb, s.spacing, twoOf(s)) };
}
type Solved = ReturnType<typeof solveHand>;
/** A keycap: its top's centre and frame (z out of the cap), its size at the
 * base, and its top face (x, y), smaller: it tapers. */
type Cap = { name: string; top: T.Matrix4; size: number[]; face: number[] };
const capName = (k: string) => k.replace(/^matrix_/, '').replace('_', ' ');
/** Every keycap in the hand frame. A finger key's y runs up its column. */
function capsOf(c: Config, h: Solved, two: boolean): Cap[] {
  const out: Cap[] = [];
  for (const col of Object.keys(h.poses)) {
    const P = h.poses[col],
      d = P[0].chain.pad.clone().sub(P[2].chain.pad);
    P.forEach((p, ri) => {
      const z = p.n.clone(),
        y = d.clone().addScaledVector(z, -d.dot(z)).normalize(),
        name = `matrix_${col}_${ROWS[ri]}`;
      out.push({
        name,
        top: new T.Matrix4()
          .makeBasis(new T.Vector3().crossVectors(y, z), y, z)
          .setPosition(p.chain.pad),
        size: capSize(c, name),
        face: capTop(c, name),
      });
    });
  }
  h.row.forEach((k, i) => {
    const name = `thumb_${['far', 'home', 'near'][i]}`;
    out.push({
      name,
      top: k.frame.clone().multiply(frame([0, 0, 0], keyTurn(name.slice(6), two))),
      size: capSize(c, name),
      face: capTop(c, name),
    });
  });
  return out;
}
/** A box: centre, unit axes, half-sizes. */
type Box = { c: T.Vector3; u: T.Vector3[]; e: number[] };
/** A keycap's half-size (x, y) `z` mm down from its top: the taper. */
const halfAt = (k: Cap, z: number) => {
  const t = Math.min(Math.max(z / k.size[2], 0), 1);
  return [0, 1].map((i) => (k.face[i] + (k.size[i] - k.face[i]) * t) / 2);
};
/** Slices the taper is checked in (each as wide as at its middle: within 0.15 mm). */
const SLICES = 8;
/** A keycap's room as boxes, `grow` mm bigger all round: the tapered cap, in
 * slices, and below it its base's footprint on down `below` mm (the travel). */
function capBoxes(k: Cap, grow: number, below = 0): Box[] {
  const u = [0, 1, 2].map((i) => new T.Vector3().setFromMatrixColumn(k.top, i)),
    box = (top: number, depth: number, half: number[]) => ({
      c: new T.Vector3(0, 0, -top - depth / 2).applyMatrix4(k.top),
      u,
      e: [half[0] + grow, half[1] + grow, depth / 2],
    }),
    h = k.size[2] / SLICES,
    out = Array.from({ length: SLICES }, (_, i) => box(i * h, h, halfAt(k, (i + 0.5) * h)));
  if (below > 0) out.push(box(k.size[2], below, halfAt(k, k.size[2])));
  return out;
}
const overlap = (a: Box[], b: Box[]) =>
  Math.max(...a.flatMap((x) => b.map((y) => boxOverlap(x, y))));
/** How far two boxes overlap (mm, along the axis that separates them best;
 * 0 when apart), by separating axes. */
function boxOverlap(a: Box, b: Box) {
  const d = b.c.clone().sub(a.c),
    axes = [...a.u, ...b.u];
  for (const p of a.u) for (const q of b.u) axes.push(p.clone().cross(q));
  let least = Infinity;
  for (const ax of axes) {
    if (ax.lengthSq() < 1e-9) continue;
    ax.normalize();
    const r = (x: Box) => x.u.reduce((s, u, i) => s + x.e[i] * Math.abs(u.dot(ax)), 0);
    least = Math.min(least, r(a) + r(b) - Math.abs(d.dot(ax)));
    if (least <= 0) return 0;
  }
  return least;
}
type Hit = { a: string; b: string; depth: number };
/** Keycaps that hit each other: either pressed to the bottom (plus the
 * keycap clearance; not the case's bigger room round the 1.5u) against the
 * other at rest. */
function capHits(c: Config, caps: Cap[]) {
  const sw = c.switch as { travel_mm?: number; keycap_clearance_mm?: number },
    travel = sw.travel_mm ?? 4,
    rest = caps.map((k) => capBoxes(k, 0)),
    pressed = caps.map((k) => capBoxes(k, sw.keycap_clearance_mm ?? 0.3, travel)),
    out: Hit[] = [];
  for (let i = 0; i < caps.length; i++)
    for (let j = i + 1; j < caps.length; j++) {
      const depth = Math.max(overlap(pressed[i], rest[j]), overlap(rest[i], pressed[j]));
      if (depth > 0) out.push({ a: caps[i].name, b: caps[j].name, depth });
    }
  return out;
}
/** The fingers (on `row`) and the thumb (on its `thumbOn` key): segments that
 * pass through a keycap at rest, more than 1 mm in. Not through the key the
 * digit is on: it lies on that one (the thumb along a 1.5u, its pad a point
 * under its axis wherever the key isn't square to it). */
function handHits(
  caps: Cap[],
  chains: Record<Finger, Chain>,
  th: ReturnType<typeof thumb>,
  row: string,
  thumbOn: string,
) {
  const segs: [string, T.Vector3, T.Vector3, number, string][] = FINGERS.flatMap((f) => {
    const c = chains[f],
      s = SCALE[f],
      own = `matrix_${f}_${row}`;
    return [
      [f, c.mcp, c.pip, 9.5 * s, own],
      [f, c.pip, c.dip, 8 * s, own],
      [f, c.dip, c.ball, TIP_R(f), own],
    ] as [string, T.Vector3, T.Vector3, number, string][];
  });
  const own = `thumb_${thumbOn}`;
  segs.push(
    ['thumb', C, th.M, 11, own],
    ['thumb', th.M, th.I, 10.5, own],
    ['thumb', th.I, th.axis, cmc.pad_below_distal_axis_mm, own],
  );
  const out: Hit[] = [];
  for (const k of caps) {
    const inv = k.top.clone().invert(),
      /** How far a point is outside the tapered cap (0 inside; near enough,
       * measured square to its axis at the nearest height). */
      outside = (p: T.Vector3) => {
        const l = p.clone().applyMatrix4(inv),
          down = Math.min(Math.max(-l.z, 0), k.size[2]),
          half = halfAt(k, down);
        return Math.hypot(
          Math.max(0, Math.abs(l.x) - half[0]),
          Math.max(0, Math.abs(l.y) - half[1]),
          -l.z - down,
        );
      },
      depth: Record<string, number> = {};
    for (const [who, a, b, r, own] of segs) {
      if (own === k.name) continue;
      for (let i = 0; i <= 12; i++)
        depth[who] = Math.max(depth[who] ?? 0, r - 1 - outside(a.clone().lerp(b, i / 12)));
    }
    for (const [who, d] of Object.entries(depth))
      if (d > 0) out.push({ a: who, b: k.name, depth: d });
  }
  return out;
}
/** How tall the board stands, hand frame turned onto the desk by `R`: from the
 * highest keycap corner down to the lowest switch body's bottom, plus the base. */
function heightOf(c: Config, caps: Cap[], R: T.Matrix4) {
  const sw = c.switch,
    base = (c as { chassis?: { base_thickness_mm?: number } }).chassis?.base_thickness_mm ?? 2;
  let high = -Infinity,
    low = Infinity;
  for (const k of caps) {
    const m = R.clone().multiply(k.top),
      seat = -k.size[2] - sw.keycap_bottom_above_plate_mm - sw.body_below_plate_mm;
    for (const [w, h] of [
      [k.size, -k.size[2]],
      [k.face, 0],
    ] as const)
      for (const x of [-w[0] / 2, w[0] / 2])
        for (const y of [-w[1] / 2, w[1] / 2])
          high = Math.max(high, new T.Vector3(x, y, h).applyMatrix4(m).z);
    for (const x of [-sw.body_mm[0] / 2, sw.body_mm[0] / 2])
      for (const y of [-sw.body_mm[1] / 2, sw.body_mm[1] / 2])
        low = Math.min(low, new T.Vector3(x, y, seat).applyMatrix4(m).z);
  }
  return { all: high - low + base };
}
/** The hand frame onto the desk (rotation only): the tent, then the hand's turn. */
const deskOf = (s: Settings) => frame([0, 0, 0], [0, s.tent, 0]).multiply(turnOf(s));
/** What's wrong with a layout: keycaps hitting, the hand through keys, rows
 * out of reach, the thumb past its joints, and the board's height. */
function check(c: Config, s: Settings, h = solveHand(s)) {
  const two = !!twoOf(s),
    caps = capsOf(c, h, two),
    // The fingers on each row in turn, the thumb on its far, home and near key with them.
    hands: Record<string, Hit> = {};
  ROWS.forEach((r, ri) => {
    const on = Object.fromEntries(FINGERS.map((f) => [f, h.poses[f][ri].chain])) as Record<
      Finger,
      Chain
    >;
    for (const x of handHits(caps, on, thumb(h.row[ri].q), r, ['far', 'home', 'near'][ri]))
      if (!(hands[x.a + x.b]?.depth > x.depth)) hands[x.a + x.b] = x;
  });
  return {
    h,
    caps,
    capHits: capHits(c, caps),
    handHits: Object.values(hands),
    short: [
      ...FINGERS.flatMap((f) => ROWS.map((r, ri) => [`${f} ${r}`, h.poses[f][ri].short] as const)),
      ...(two ? [['thumb 1u row', h.row[0].short] as const] : []),
    ].filter(([, m]) => m > 0.5),
    /** The arm can't carry the hand far enough sideways for the inner column. */
    innerShort: h.inner.limited,
    stiff: h.row
      .map((k, i) => [['far', 'home', 'near'][i], k.stiff] as const)
      .filter(([, d]) => d > 0.5),
    height: heightOf(c, caps, deskOf(s)),
  };
}

// ---------------------------------------------------------------- presets
/** The closest fit to the Dactyl Manuform (DM_right): least squares over all
 * 18 keys' cap tops (per 2 mm) and facings (per 3°), relative to the middle
 * home key, before tenting; the hand first, then the thumb with the hand
 * fixed. The finger keys come out 2–3 mm off in the middle and ring columns,
 * 6–11 mm in the inner, index and pinky (the Dactyl raises its outer columns
 * into a bowl, which these settings can't); the thumb's keys 2.5 (home), 8.5
 * (near) and 14 mm (far: further from the CMC than the thumb reaches, since
 * on the Dactyl you press its corner). The inner column is parallel to the
 * index, as on the Dactyl. Its keycaps are lower than ours, so with ours some
 * of its keys collide. */
const DACTYL: Settings = {
  tent: 15,
  roll: 5,
  wrist: 10,
  bend: -4,
  curl: { index: 17, middle: 17, ring: 14, pinky: 13 },
  innerGap: 19.5,
  innerAngle: 0,
  top: 17,
  bottom: 16,
  from: 'reach',
  reachMix: 0.4,
  pressMix: 1.4,
  thumb: { sweep: 9.9, abduct: 30.9, twist: -3.8, curl: -27.5, mix: -2.34, cmc: 0, bend: 10.6 },
  spacing: 19.5,
  cluster: '1×3',
  // The 1u row, a key's depth from the 1.5u, on the curled side, reached
  // square to the press. (A reach mix like the fingers' 0.4 moves the thumb's
  // pad mostly along its press, onto the 1.5u.)
  two: { gap: 19.5, from: 'press', reachMix: 0.4 },
};
/** As close to the resting hand as a valid layout allows: the least change
 * from rest (degrees, the hand on the board counted too), every gap as small
 * as the keycaps allow, over layouts where no keycap hits another (pressed
 * against one at rest), the hand passes through no key, every row is in reach
 * and the board fits the 66 mm keyboard tray. It comes out at rest: the
 * fingers and thumb as measured (the thumb pressing like a finger, IP with
 * the MCP), the board tented 1° (the steep top rows of an uncurled hand and
 * the thumb's near-vertical keys use up the tray). Fitted to the measured
 * keycaps (18.5 mm, tapering to 14, 11 high): 65 mm tall. */
const NATURAL: Settings = {
  tent: 1,
  roll: 0,
  wrist: 0,
  bend: 0,
  curl: { index: 0, middle: 0, ring: 0, pinky: 0 },
  innerGap: 18.8,
  innerAngle: 0,
  top: 17,
  bottom: 17,
  from: 'reach',
  reachMix: 0.4,
  pressMix: 1.4,
  thumb: { sweep: 0, abduct: 0, twist: 0, curl: 0, mix: 1, cmc: 0, bend: 0 },
  spacing: 22.1,
  cluster: '1×3',
  two: { gap: 19.5, from: 'press', reachMix: 0.4 },
};
const TRAY = 66;
/** The settings (degrees) that `apply` makes of a rotation, nearest `prev`:
 * of the two ways to write it with the middle angle, the one that moves least. */
function nearest(e: T.Euler, prev: number[]) {
  const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180,
    a = [deg(e.x), deg(e.y), deg(e.z)],
    mid = e.order[1] === 'X' ? 0 : 1,
    b = a.map((v, i) => wrap(i === mid ? 180 - v : v + 180)),
    off = (x: number[]) => x.reduce((s, v, i) => s + Math.abs(wrap(v - prev[i])), 0);
  return (off(a) <= off(b) ? a : b).map(
    (v, i) => Math.round((prev[i] + wrap(v - prev[i])) * 10) / 10,
  );
}

// ---------------------------------------------------------------- the panel
export function setupHand(host: Host) {
  const group = new T.Group(),
    handGroup = new T.Group();
  group.matrixAutoUpdate = false;
  handGroup.matrixAutoUpdate = false;
  group.add(handGroup);
  host.scene.add(group);
  const cfg = () => host.project().config;

  // The middle home keycap stays where it is; everything else follows the hand.
  const c0 = cfg(),
    mi = c0.geometry.columns.findIndex((k) => k.name === 'middle'),
    o = (
      c0.geometry.key_overrides as Record<string, { offset_mm?: number[]; rotation_deg?: number[] }>
    ).matrix_middle_home,
    // Through the key's own tilt too, or every reload moves the anchor.
    anchor = V([0, 0, capHeight(c0)]).applyMatrix4(
      columnFrames(c0, mi)[1].multiply(frame(o?.offset_mm, o?.rotation_deg)),
    );

  const s = {
    ...structuredClone(DACTYL),
    row: 'home' as Row,
    thumbOn: 'home',
    /** What the rotation handle turns. */
    handle: 'hand',
    advanced: false,
  };
  // The settings persist in this browser, so a reload keeps the layout they
  // made (the editor autosaves the keys, not these). Nested objects merge, so
  // a setting added since keeps its default.
  const SAVED = 'rosebear-hand-prototype';
  const restore = (j: string) => {
    const v = JSON.parse(j);
    for (const k of Object.keys(v) as (keyof typeof s)[])
      if (k in s)
        typeof s[k] === 'object'
          ? Object.assign(s[k] as object, v[k])
          : Object.assign(s, { [k]: v[k] });
  };
  try {
    restore(localStorage.getItem(SAVED) ?? '{}');
  } catch {
    // Start from the Dactyl fit.
  }

  /** Hand frame → layout. */
  const toLayout = () =>
    new T.Matrix4()
      .makeTranslation(anchor)
      .multiply(turnOf(s))
      .multiply(
        new T.Matrix4().makeTranslation(
          rowPose('middle', s.curl.middle, 0, 0, wayOf(s)).chain.pad.negate(),
        ),
      );

  function apply() {
    const c = cfg(),
      { poses, row } = solveHand(s),
      L = toLayout(),
      keys: Record<string, KeyTop[]> = {},
      splay: Record<string, number> = {};
    c.geometry.tent_deg = s.tent;
    for (const col of Object.keys(poses)) {
      // The column runs the way the fingertip travels, bottom key to top, seen
      // from above. (Knuckle to fingertip points steeply down when curled, so
      // a little roll swung it, and the keys, ~2° per degree.)
      const d = poses[col][0].chain.pad.clone().sub(poses[col][2].chain.pad).transformDirection(L);
      keys[col] = poses[col].map((p) => ({
        top: p.chain.pad.clone().applyMatrix4(L),
        normal: p.n.clone().transformDirection(L),
        up: d,
      }));
      splay[col] = deg(Math.atan2(-d.x, d.y));
    }
    placeColumns(c, keys, splay);
    placeThumb(
      c,
      row.map((k) => L.clone().multiply(k.frame)),
      !!twoOf(s),
    );
  }

  // The rotation handle: on the middle home key it turns the hand on the
  // board (roll, wrist, bend; the tent stays), on the thumb's CMC it turns
  // the thumb there (sweep, abduction, twist).
  const pivot = new T.Object3D(),
    gizmo = new TransformControls(host.camera, host.dom);
  gizmo.setMode('rotate');
  gizmo.setSpace('world');
  gizmo.setSize(0.6);
  host.scene.add(pivot, gizmo.getHelper());
  gizmo.addEventListener('change', () => host.render());
  gizmo.addEventListener('dragging-changed', (e) => {
    host.orbit.enabled = !e.value;
    if (!e.value) {
      touched = false;
      update();
    }
  });
  const rotation = (m: T.Matrix4) => new T.Matrix4().extractRotation(m);
  gizmo.addEventListener('objectChange', () => {
    const R = new T.Matrix4().makeRotationFromQuaternion(pivot.quaternion),
      tent = rotation(tentFrame(cfg()));
    if (s.handle === 'hand') {
      // turnOf: Rz(−bend) Rx(−wrist) Ry(roll).
      const [x, y, z] = nearest(
        new T.Euler().setFromRotationMatrix(tent.invert().multiply(R), 'ZXY'),
        [-s.wrist, s.roll, -s.bend],
      );
      Object.assign(s, { wrist: -x, roll: y, bend: -z });
    } else {
      // rotQ: Rz(yaw) Ry(pitch) Rx(roll), from rest.
      const base = tent.multiply(rotation(toLayout())),
        q = solveHand(s).row[1].q,
        [x, y, z] = nearest(new T.Euler().setFromRotationMatrix(base.invert().multiply(R), 'ZYX'), [
          q[2],
          q[1],
          q[0],
        ]),
        r1 = (v: number) => Math.round(v * 10) / 10;
      Object.assign(s.thumb, {
        sweep: r1(thumbRest[0] - z),
        abduct: r1(y - thumbRest[1]),
        twist: r1(x - thumbRest[2]),
      });
    }
    shows.forEach((f) => f());
    change();
  });
  function placeHandle(c: Config, L: T.Matrix4, home: number[]) {
    if (s.handle === 'off') {
      gizmo.detach();
      return;
    }
    if (gizmo.dragging) return;
    gizmo.attach(pivot);
    const world = tentFrame(c),
      m =
        s.handle === 'hand'
          ? world.clone().multiply(new T.Matrix4().makeTranslation(anchor)).multiply(turnOf(s))
          : world.clone().multiply(L).multiply(rotQ(home).setPosition(C));
    m.decompose(pivot.position, pivot.quaternion, pivot.scale);
    pivot.updateMatrixWorld();
  }

  const note = document.createElement('div');
  note.id = 'hand-note';
  function update() {
    const c = cfg(),
      r = check(c, s),
      { poses, row } = r.h,
      ri = ROWS.indexOf(s.row),
      L = toLayout(),
      th = thumb(
        s.thumbOn === 'rest' ? thumbRest : row[['far', 'home', 'near'].indexOf(s.thumbOn)].q,
      );
    const shown = Object.fromEntries(FINGERS.map((f) => [f, poses[f][ri].chain])) as Record<
      Finger,
      Chain
    >;
    drawHand(handGroup, shown, th);
    handGroup.matrix.copy(L);
    group.matrix.copy(tentFrame(c));
    group.matrixWorldNeedsUpdate = true;
    placeHandle(c, L, row[1].q);
    const wrong = [
      ...r.capHits.map((x) => `${capName(x.a)} hits ${capName(x.b)} (${x.depth.toFixed(1)} mm)`),
      ...r.handHits.map((x) => `${x.a} through ${capName(x.b)} (${x.depth.toFixed(1)} mm)`),
      ...r.short.map(([k, m]) => `${k} out of reach (${m.toFixed(0)} mm)`),
      ...r.stiff.map(([k, d]) => `thumb ${k} out of reach (MCP/IP ${d.toFixed(0)}° past limit)`),
      ...(r.innerShort ? ['inner column out of reach'] : []),
      ...(r.height.all > TRAY ? [`${r.height.all.toFixed(1)} mm tall (tray ${TRAY} mm)`] : []),
    ];
    note.innerHTML = wrong.length
      ? `<div style="color:#ff9a8a">Not valid:<ul style="margin:2px 0;padding-left:18px">${wrong.map((w) => `<li>${w}</li>`).join('')}</ul></div>`
      : `<div style="color:#9be39b">Valid (${r.height.all.toFixed(0)} mm tall).</div>`;
    host.render();
    queueFrame();
  }

  // Controls.
  const sec = document.createElement('section'),
    basic = document.createElement('div'),
    advanced = document.createElement('div');
  sec.innerHTML = `<h2>Prototype: hand</h2><small>The keys follow your measured hand.</small>`;
  sec.append(basic, advanced, note);
  note.style.cssText = 'margin:8px 0 0;min-height:1em;font-size:13px';
  document.querySelector('aside')!.prepend(sec);
  let box = basic,
    touched = false;
  const change = () => {
    if (!touched) host.snapshot();
    touched = true;
    try {
      localStorage.setItem(SAVED, JSON.stringify(s));
    } catch {
      // Not kept past a reload.
    }
    apply();
    host.edited(); // → preview → update()
  };
  const heading = (t: string) =>
    box.insertAdjacentHTML(
      'beforeend',
      `<h3 style="font-size:12px;margin:12px 0 2px;color:#b7c4c6">${t}</h3>`,
    );
  const shows: (() => void)[] = [];
  function slider(
    label: string,
    get: () => number,
    set: (v: number) => void,
    min: number,
    max: number,
    step = 1,
    /** Whether it does anything with the other settings as they are. */
    on = () => true,
  ) {
    const l = document.createElement('label');
    l.style.cssText =
      'display:grid;grid-template-columns:1fr 40px;gap:0 6px;align-items:center;margin:2px 0';
    l.innerHTML = `<span>${label}</span><output style="text-align:right"></output><input type="range" min="${min}" max="${max}" step="${step}" style="grid-column:1/3;width:100%">`;
    const i = l.querySelector('input')!,
      out = l.querySelector('output')!;
    const show = () => {
      i.value = out.textContent = String(Math.round(get() * 100) / 100);
      i.disabled = !on();
      l.style.opacity = on() ? '' : '0.4';
    };
    show();
    shows.push(show);
    i.addEventListener('input', () => {
      set(+i.value);
      shows.forEach((f) => f());
      change();
    });
    i.addEventListener('change', () => (touched = false));
    box.append(l);
  }
  function radios(
    label: string,
    options: string[],
    get: () => string,
    set: (v: string) => void,
    d = document.createElement('div'),
  ) {
    d.style.margin = '4px 0';
    d.innerHTML =
      label +
      ' ' +
      options
        .map(
          (v) =>
            `<label style="display:inline;margin-right:6px"><input type="radio" value="${v}" ${v === get() ? 'checked' : ''}>${v}</label>`,
        )
        .join('');
    d.addEventListener('change', (e) => {
      d.querySelectorAll('input').forEach((x) => (x.checked = x === e.target));
      set((e.target as HTMLInputElement).value);
      update();
    });
    if (!d.parentNode) box.append(d);
    return d;
  }
  /** One slider for several settings: it shows their mean and moves them all
   * by the same amount, each kept in its own range. */
  function together(
    label: string,
    parts: [get: () => number, set: (v: number) => void, min: number, max: number][],
    min: number,
    max: number,
    step: number,
  ) {
    const mean = () => Math.round((parts.reduce((t, [g]) => t + g(), 0) / parts.length) * 10) / 10;
    slider(
      label,
      mean,
      (v) => {
        const d = v - mean();
        for (const [g, st, lo, hi] of parts)
          st(Math.min(hi, Math.max(lo, Math.round((g() + d) * 10) / 10)));
      },
      min,
      max,
      step,
    );
  }

  // ---- basic
  const presets = document.createElement('div');
  presets.style.margin = '6px 0';
  presets.innerHTML = 'Start from: ';
  for (const [name, p] of [
    ['Dactyl fit', DACTYL],
    ['Natural', NATURAL],
  ] as const) {
    const b = document.createElement('button');
    b.textContent = name;
    b.title =
      name === 'Natural'
        ? 'The least change from your resting hand that is valid.'
        : 'The closest fit to the Dactyl Manuform.';
    // Every setting, keeping which keys the hand is shown on, how rows are
    // reached, the cluster and the handle; one Undo step.
    b.addEventListener('click', () => {
      const keep = {
          row: s.row,
          thumbOn: s.thumbOn,
          from: s.from,
          cluster: s.cluster,
          handle: s.handle,
          advanced: s.advanced,
        },
        twoFrom = s.two.from;
      Object.assign(s, structuredClone(p), keep);
      s.two.from = twoFrom;
      shows.forEach((f) => f());
      change();
      touched = false;
    });
    presets.append(b);
  }
  basic.append(presets);
  // To share a layout (paste it into a chat) or bring one back.
  const share = document.createElement('div');
  share.style.margin = '6px 0';
  const copy = document.createElement('button'),
    paste = document.createElement('button');
  copy.textContent = 'Copy settings';
  copy.title = 'Copy every hand setting as JSON.';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(JSON.stringify(s));
    copy.textContent = 'Copied';
    setTimeout(() => (copy.textContent = 'Copy settings'), 1500);
  });
  paste.textContent = 'Paste settings';
  paste.title = 'Paste settings from Copy settings.';
  paste.addEventListener('click', () => {
    const j = prompt('Paste the settings (JSON):');
    if (!j) return;
    try {
      restore(j);
    } catch (e) {
      alert('Not settings: ' + String(e));
      return;
    }
    advOn.checked = s.advanced;
    advanced.hidden = !s.advanced;
    shows.forEach((f) => f());
    change();
    touched = false;
  });
  share.append(copy, paste);
  basic.append(share);
  radios(
    'Fingers on',
    [...ROWS],
    () => s.row,
    (v) => (s.row = v as Row),
  );
  radios(
    'Thumb on',
    ['rest', ...cfg().geometry.thumb.keys.map((k) => k.name)],
    () => s.thumbOn,
    (v) => (s.thumbOn = v),
  );
  radios(
    'Rotation handle:',
    ['hand', 'thumb', 'off'],
    () => s.handle,
    (v) => (s.handle = v),
  );
  heading('Basic');
  together(
    'finger curl (°, + curled)',
    FINGERS.map((f) => [() => s.curl[f], (v: number) => (s.curl[f] = v), -30, 40]),
    -30,
    40,
    1,
  );
  together(
    'key spacing (mm, every gap)',
    [
      [() => s.top, (v) => (s.top = v), 5, 35],
      [() => s.bottom, (v) => (s.bottom = v), 5, 35],
      [() => s.innerGap, (v) => (s.innerGap = v), 18, 30],
      [() => s.spacing, (v) => (s.spacing = v), 17, 30],
    ],
    12,
    30,
    0.5,
  );
  slider(
    'thumb curl (°, + curled)',
    () => s.thumb.curl,
    (v) => (s.thumb.curl = v),
    -30,
    50,
  );
  radios(
    'Thumb keys',
    ['1×3', '1.5u + 2×1u'],
    () => s.cluster,
    (v) => {
      s.cluster = v;
      shows.forEach((f) => f());
      change();
    },
  );
  const advBox = document.createElement('label');
  advBox.innerHTML = '<input type="checkbox"> Advanced settings';
  advBox.style.display = 'block';
  const advOn = advBox.querySelector('input')!;
  advOn.addEventListener('change', () => {
    s.advanced = advOn.checked;
    advanced.hidden = !s.advanced;
  });
  advOn.checked = s.advanced;
  advanced.hidden = !s.advanced;
  const caseBox = document.createElement('label');
  caseBox.innerHTML = '<input type="checkbox"> Build the case (often fails)';
  caseBox.style.display = 'block';
  const caseOn = caseBox.querySelector('input')!;
  caseOn.addEventListener('change', host.rebuild);
  basic.append(advBox, caseBox);

  // The test frame (hand-frame.ts): switch holes on pillars, to print and try.
  const frameBox = document.createElement('div');
  frameBox.innerHTML =
    '<label style="display:block"><input type="checkbox"> Test frame (print this way up, with supports)</label>' +
    '<button>Right STL</button><button>Left STL</button><div style="font-size:13px"></div>';
  const frameOn = frameBox.querySelector('input')!,
    [rightStl, leftStl] = frameBox.querySelectorAll('button'),
    frameNote = frameBox.querySelector('div')!,
    frameView = new T.Mesh(
      new T.BufferGeometry(),
      new T.MeshStandardMaterial({
        color: '#c8b48c',
        roughness: 0.8,
        transparent: true,
        opacity: 0.85,
      }),
    );
  host.scene.add(frameView);
  basic.append(frameBox);
  let frameTimer: ReturnType<typeof setTimeout> | undefined;
  async function showFrame() {
    frameView.visible = frameOn.checked;
    rightStl.disabled = leftStl.disabled = !frameOn.checked;
    if (!frameOn.checked) {
      frameNote.textContent = '';
      return host.render();
    }
    const r = buildFrame(await manifold(), cfg()),
      g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(r.mesh.positions, 3));
    g.setIndex(new T.BufferAttribute(r.mesh.indices, 1));
    g.computeVertexNormals();
    frameView.geometry.dispose();
    frameView.geometry = g;
    const wrong = [...(r.pieces > 1 ? [`${r.pieces} separate pieces`] : []), ...r.faults];
    frameNote.innerHTML =
      `${r.size.map((x) => x.toFixed(0)).join(' × ')} mm` +
      `; ${r.volume.toFixed(0)} cm³ (${(r.volume * 1.24).toFixed(0)} g of PLA) before supports` +
      (wrong.length ? `<div style="color:#ff9a8a">${wrong.join('<br>')}</div>` : '');
    host.render();
  }
  const queueFrame = () => {
    clearTimeout(frameTimer);
    frameTimer = setTimeout(() => void showFrame(), 150);
  };
  frameOn.addEventListener('change', queueFrame);
  const saveFrame = async (left: boolean) => {
    const r = buildFrame(await manifold(), cfg()),
      a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([frameStl(r.mesh, r.floor, left).buffer as ArrayBuffer]));
    a.download = `rosebear-hand-frame-${left ? 'left' : 'right'}.stl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  rightStl.onclick = () => void saveFrame(false);
  leftStl.onclick = () => void saveFrame(true);
  rightStl.disabled = leftStl.disabled = true;

  // ---- advanced
  box = advanced;
  heading('Hand on the board (°)');
  slider(
    'tent',
    () => s.tent,
    (v) => (s.tent = v),
    0,
    45,
  );
  slider(
    'roll: + pinky side down',
    () => s.roll,
    (v) => (s.roll = v),
    -30,
    30,
  );
  slider(
    'wrist: + higher',
    () => s.wrist,
    (v) => (s.wrist = v),
    -25,
    25,
  );
  slider(
    'wrist bend: + toward the pinky',
    () => s.bend,
    (v) => (s.bend = v),
    -25,
    25,
  );
  heading('Curl at home (°, + curled)');
  for (const f of FINGERS)
    slider(
      f,
      () => s.curl[f],
      (v) => (s.curl[f] = v),
      -30,
      40,
    );
  slider(
    'inner column gap (mm)',
    () => s.innerGap,
    (v) => (s.innerGap = v),
    18,
    30,
    0.5,
  );
  slider(
    'inner column angle (°, + to thumb)',
    () => s.innerAngle,
    (v) => (s.innerAngle = v),
    -10,
    30,
  );
  heading('Rows (mm from home)');
  const fromBox = document.createElement('div');
  box.append(fromBox);
  slider(
    'reach mix: MCP° per PIP°',
    () => s.reachMix,
    (v) => (s.reachMix = v),
    -1,
    3,
    0.1,
    () => s.from === 'reach',
  );
  slider(
    'press mix: PIP+DIP° per MCP°',
    () => s.pressMix,
    (v) => (s.pressMix = v),
    -1,
    4,
    0.1,
    () => s.from === 'press',
  );
  radios(
    'Set the',
    ['reach', 'press'],
    () => s.from,
    (v) => {
      s.from = v;
      shows.forEach((f) => f());
      change();
    },
    fromBox,
  );
  slider(
    'top: forward',
    () => s.top,
    (v) => (s.top = v),
    5,
    35,
  );
  slider(
    'bottom: back',
    () => s.bottom,
    (v) => (s.bottom = v),
    5,
    35,
  );
  heading('Thumb (°)');
  slider(
    'sweep: + toward the fingers',
    () => s.thumb.sweep,
    (v) => (s.thumb.sweep = v),
    -80,
    30,
  );
  slider(
    'abduction: + away from the palm',
    () => s.thumb.abduct,
    (v) => (s.thumb.abduct = v),
    -30,
    60,
  );
  slider(
    'twist: + pad down',
    () => s.thumb.twist,
    (v) => (s.thumb.twist = v),
    -180,
    180,
  );
  slider(
    'press: IP°/MCP° (− straightens)',
    () => s.thumb.mix,
    (v) => (s.thumb.mix = v),
    -3,
    3,
    0.01,
  );
  slider(
    'key spacing (mm)',
    () => s.spacing,
    (v) => (s.spacing = v),
    17,
    30,
    0.5,
  );
  slider(
    'row bend (°/key, + curls near)',
    () => s.thumb.bend ?? 0,
    (v) => (s.thumb.bend = v),
    -40,
    40,
  );
  slider(
    '1u row gap (mm, + curled)',
    () => s.two.gap,
    (v) => (s.two.gap = v),
    -35,
    35,
    0.5,
    () => s.cluster !== '1×3',
  );
  const twoBox = document.createElement('div');
  box.append(twoBox);
  slider(
    '1u row reach mix: MCP° per IP°',
    () => s.two.reachMix,
    (v) => (s.two.reachMix = v),
    -1,
    3,
    0.1,
    () => s.cluster !== '1×3' && s.two.from === 'reach',
  );
  radios(
    'Reach the 1u row',
    ['press', 'reach'],
    () => s.two.from,
    (v) => {
      s.two.from = v;
      shows.forEach((f) => f());
      change();
    },
    twoBox,
  );

  // Lay the keys out from the hand straight away (Undo restores the old layout).
  change();
  touched = false;
  return { update, buildCase: () => caseOn.checked };
}
