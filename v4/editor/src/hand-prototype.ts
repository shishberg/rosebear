/**
 * PROTOTYPE ?hand — throwaway. The measured left hand (v4/hand/left-hand.json,
 * mirrored into the right half's layout axes) drawn in the editor, laying out
 * the keys: each home key goes under its fingertip, the top and bottom rows
 * where the fingertip lands when it reaches forward or pulls back, and the
 * thumb row where the thumb reaches by pivoting at its base, each key facing
 * the way the thumb presses it or its pad, as set. Opening the page and every
 * slider move rewrite the finger columns and the thumb row (Undo restores).
 *
 * Fingers: chains MCP–PIP–DIP–pad from the resting pose. Curl at home bends
 * the PIP, the MCP by 0.4 of that and the DIP by 2/3. At every key, reaching
 * (between rows) is along the keyboard and pressing is square to it, at that
 * point, and each row is set as its distance from home, centre to centre.
 * Either the reach mix is set (MCP degrees per PIP degree; negative, the MCP
 * curls as the PIP straightens) and the fingertip's path is the keyboard, or
 * the press mix is set (PIP+DIP degrees
 * straightened per MCP degree) and the finger reaches square to it at every
 * point (Jindrich et al. 2004 measured a press mix of about 1.4).
 * Thumb: a ball joint at the assumed CMC, hinges at the MCP and IP. Its home
 * pose is set by joint angles; it presses by curling the MCP and IP, by
 * swinging the whole thumb at the CMC, or a blend, as set (curling alone
 * makes the keys stand nearly on edge and runs the row along the MCP/IP
 * hinge), and the CMC reaches between keys, square to the press at each one,
 * the MCP and IP curling toward the near key (straightening toward the far)
 * as set, and twisting about the metacarpal as set. Each key lines up with
 * the row through it and faces the press (straight down) or the pad (parallel
 * to the last bone: flat under the pad, the press then off square).
 * The palm is a sketch.
 * Settings: two presets (near the Dactyl Manuform, valid and tuned by eye; the least
 * change from the resting hand that makes a valid layout), a rotation handle
 * (the hand on the board at the middle home key, or the thumb at its CMC), a
 * few basic sliders that move several settings together, and the rest under
 * Advanced. The readout says first whether the layout is valid: no keycap
 * hits another (pressed to the bottom against one at rest), no part of the
 * hand (palm included) goes into the keyboard (the keycaps and the printed
 * test frame) reaching for any key, except into that key (reachHits), every
 * key is in reach, the thumb presses no key more than SIDE° off square and
 * the board fits the 66 mm tray.
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
  type MeshData,
  type V3,
} from './geometry';
import type { ManifoldToplevel } from 'manifold-3d';
import { buildFrame, frameStl, type FrameResult } from './hand-frame';

/** The geometry kernel, here on the page for the test frame (it builds in tens
 * of ms). Its file is found through Vite only here, so tests can load this module. */
let kernel: Promise<ManifoldToplevel> | undefined;
const manifold = () =>
  (kernel ??= import('manifold-3d').then(async (m) => {
    const { default: wasmUrl } = await import('manifold-3d/manifold.wasm?url');
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
/** Walk the fingertip (+ away from you) from home along the path `way` gives,
 * step by step, until the key is `dist` mm from the home key, centre to
 * centre. The path is the keyboard: each key lies along it and faces square
 * off it, at that point. */
function rowPose(f: Finger, curl: number, abd: number, dist: number, way: Way): Pose {
  const h = rest[f].heading.clone().applyAxisAngle(Z, rad(abd)),
    flat = -PIP_BEND[f];
  let m = 0.4 * curl,
    p = curl;
  /** The keyboard under the fingertip as it is: which way it runs (`t`) and faces
   * (`n`), the key's centre (where the ball touches it, its lowest point along
   * the press), and the joint steps per mm the ball moves along it. */
  const here = () => {
    const r = rates(f, abd, m, p),
      [a, b] = way(r),
      w = r.vm.clone().multiplyScalar(a).addScaledVector(r.vp, b),
      k = (w.dot(h) < 0 ? -1 : 1) / w.length(),
      t = w.multiplyScalar(k),
      n = Z.clone().multiplyScalar(t.dot(h)).addScaledVector(h, -t.dot(Z)).normalize(),
      chain = finger(f, m, p, abd);
    chain.pad = chain.ball.clone().addScaledVector(n, -TIP_R(f));
    return { chain, t, n, dm: a * k, dp: b * k };
  };
  let k = here();
  const home = k.chain.pad.clone(),
    left = () => Math.abs(dist) - k.chain.pad.distanceTo(home);
  // The key moves further than the ball where the path bends (it's below the
  // ball), so the steps shrink as the key nears its place.
  for (let i = 0; i < 8000 && left() > 1e-3; i++) {
    const step = Math.min(0.25, left() / 2) * Math.sign(dist);
    if (p + k.dp * step < flat) break;
    m += k.dm * step;
    p += k.dp * step;
    k = here();
  }
  return { chain: k.chain, mcp: m, pip: p, short: Math.max(0, left()), t: k.t, n: k.n };
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
  return {
    poses: at(hi),
    slide: hi,
    limited: hi >= lim[1] - 0.01 || hi <= lim[0] + 0.01,
    /** Any index pose carried over to the inner column. */
    place: (p: Pose) => moved(p, p.chain.mcp, angle, side.clone().multiplyScalar(hi)),
    /** An index pose `t` of the way over (0–1), and how far the arm has carried the hand. */
    placeAt: (p: Pose, t: number) =>
      moved(p, p.chain.mcp, angle * t, side.clone().multiplyScalar(hi * t)),
    carry: (t: number) => side.clone().multiplyScalar(hi * t),
  };
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
/** Which way the pad moves as the thumb presses: a blend of curling (the MCP,
 * and the IP `mix` times as much) and the whole thumb moving at the CMC
 * (`cmcDir`: 0 abducts it, down and away from the palm; + toward the fingers),
 * `byCmc` of the way from the one to the other. Curling alone moves the pad
 * square to the MCP and IP's hinge, so the row (square to the press and to the
 * line from the CMC) would always run along that hinge. */
const pressDir = (q: number[], t: Pick<ThumbPose, 'mix' | 'byCmc' | 'cmcDir'>) => {
  const p0 = thumb(q).pad,
    a = rad(t.cmcDir ?? 0),
    w = t.byCmc ?? 0,
    curl = thumb([q[0], q[1], q[2], q[3] + 1, q[4] + t.mix])
      .pad.sub(p0)
      .normalize(),
    whole = thumb([q[0] - Math.sin(a), q[1] + Math.cos(a), q[2], q[3], q[4]])
      .pad.sub(p0)
      .normalize();
  return curl
    .multiplyScalar(1 - w)
    .addScaledVector(whole, w)
    .normalize();
};
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
  /** The press (pressDir): IP degrees per MCP degree as it curls; how much of
   * it is the whole thumb moving at the CMC (0–1); which way the CMC moves it
   * (degrees: 0 abducted, down and away from the palm; + toward the fingers). */
  mix: number;
  byCmc?: number;
  cmcDir?: number;
  /** Along the row, MCP and IP degrees per key: + curls toward the near key
   * and straightens toward the far one (0: the CMC alone moves). */
  bend?: number;
  /** What each key faces: the press ('press', so it goes straight down), or
   * the pad ('pad': parallel to the last bone, so the pad lands flat; the
   * press may then come at it from the side). */
  facing?: 'press' | 'pad';
  /** Along the row, degrees the thumb twists about the metacarpal per key (+
   * pad down toward the near key), as it does when it opposes. */
  roll?: number;
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
    press = (q: number[]) => pressDir(q, t),
    /** Along the row, away from the fingers. */
    along = (q: number[], prev?: T.Vector3) => {
      const v = thumb(q).pad.sub(C).cross(press(q)).normalize();
      return (prev ? v.dot(prev) < 0 : v.x > 0) ? v.negate() : v;
    },
    bend = t.bend ?? 0,
    /** `dist` mm round the CMC, curling `curl` degrees on the way and
     * twisting `tw` about the metacarpal (+ pad down). */
    walk = (sign: number, from: number[], dist: number, curl: number, tw = 0) => {
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
        q = [
          deg(e.z),
          deg(e.y),
          deg(e.x) + (tw * step) / dist,
          clamp(mcp, MCP_RANGE),
          clamp(ip, IP_RANGE),
        ];
        v = along(q, v);
        left -= step;
      }
      return { q, stiff: Math.max(Math.abs(mcp - q[3]), Math.abs(ip - q[4])) };
    },
    roll = t.roll ?? 0,
    /** The key `gap` mm (centre to centre) from `from`'s pad, away from the
     * fingers (sign +1) or toward them, the thumb curling `curl` and twisting
     * `tw` degrees. */
    key = (sign: number, from: number[], gap: number, curl: number, tw = 0) => {
      const p0 = thumb(from).pad,
        at = (d: number) => walk(sign, from, d, curl, tw),
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
  let ends = [key(1, qh, spacing, -bend, -roll), key(-1, qh, spacing, bend, roll)],
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
    ends = [
      key(1, q, spacing / 2, -bend / 2, -roll / 2),
      key(-1, q, spacing / 2, bend / 2, roll / 2),
    ];
    // The 1u keys: the CMC carries the path's direction round with the thumb.
    const back = rotQ(q).invert();
    paths = [ends[0].q, qh, ends[1].q].map((qk, i) =>
      i === 1 ? t0 : w.dir.clone().transformDirection(rotQ(qk).multiply(back)),
    );
  }
  const stiff = [ends[0].stiff, 0, ends[1].stiff],
    qs = [ends[0].q, qh, ends[1].q],
    pads = qs.map((q) => thumb(q).pad),
    /** Each key lines up with the row through it, as the finger keys do with
     * their column: x along the line from its neighbour (the 1u row's, on a
     * 1.5u + 2×1u cluster), not the CMC's sweep alone, which the row leaves
     * as soon as the MCP and IP bend along it. */
    line = (i: number) =>
      two || i === 1 ? pads[2].clone().sub(pads[0]) : pads[i / 2 + 1].clone().sub(pads[i / 2]);
  return qs.map((q, i) => {
    const pad = pads[i],
      pressed = press(q).negate(),
      x = line(i).normalize(),
      p = paths[i],
      // Facing the pad: out of the cap toward the thumb's last bone.
      z =
        t.facing === 'pad'
          ? thumb(q).axis.sub(pad).normalize()
          : p
            ? x.clone().cross(p).normalize()
            : pressed.clone();
    if (t.facing !== 'pad' && z.dot(pressed) < 0) z.negate();
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
  // The same shapes the check uses.
  for (const part of [
    ...FINGERS.map((f) => fingerPart(f, { chain: chains[f], n: Z } as Pose, [])),
    thumbPart(th, []),
  ])
    for (const [a, b, r] of part.segs) group.add(capsule(a, b, r));
  const mcp = Object.fromEntries(FINGERS.map((f) => [f, chains[f].mcp])) as Record<
    Finger,
    T.Vector3
  >;
  group.add(new T.Mesh(new ConvexGeometry(palmPoints(mcp, th)), palmSkin));
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
/** The lowest reach mix (the MCP curling as the PIP straightens). Toward -0.5
 * the two cancel: the fingertip hardly moves along the board, and the path
 * turns straight down or doubles back. */
const MIX_MIN = -0.4;
/** The reach between rows: either as set, or square to the press as set. */
const wayOf =
  (s: Settings): Way =>
  (r) => {
    if (s.from === 'reach') return [Math.max(MIX_MIN, s.reachMix), 1];
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
// ---------------------------------------------------------------- the hand against the keyboard
/** How far off square to a key the thumb may press it, degrees: a guess
 * (the stem binds and the press feels sideways past it). */
const SIDE = 20;
/** A part of the hand: capsules (segments of a radius) or a convex hull (the
 * palm), and the keys it may touch. */
type Part = {
  who: string;
  segs: [a: T.Vector3, b: T.Vector3, r: number][];
  hull?: T.Vector3[];
  may: string[];
};
/** Finger f, `down` mm along -n (pressing), moved by `by`. */
const fingerPart = (f: Finger, p: Pose, may: string[], down = 0, by = new T.Vector3()): Part => {
  const c = p.chain,
    s = SCALE[f],
    v = (x: T.Vector3) => x.clone().addScaledVector(p.n, -down).add(by);
  return {
    who: f,
    segs: [
      [v(c.mcp), v(c.pip), 9.5 * s],
      [v(c.pip), v(c.dip), 8 * s],
      [v(c.dip), v(c.ball), TIP_R(f)],
    ],
    may,
  };
};
type Thumb = ReturnType<typeof thumb>;
const thumbPart = (th: Thumb, may: string[], by = new T.Vector3()): Part => {
  const v = (x: T.Vector3) => x.clone().add(by);
  return {
    who: 'thumb',
    segs: [
      [v(C), v(th.M), 11],
      [v(th.M), v(th.I), 10.5],
      [v(th.I), v(th.axis), cmc.pad_below_distal_axis_mm],
    ],
    may,
  };
};
/** The palm (a sketch): a hull over the thumb's CMC and metacarpal head, the
 * knuckles and the wrist. */
function palmPoints(mcp: Record<Finger, T.Vector3>, th: Thumb) {
  const wrist = mcp.middle.clone().add(new T.Vector3(-8, -85, -12)),
    out: T.Vector3[] = [C.clone(), th.M.clone()];
  for (const f of FINGERS) {
    const k = mcp[f];
    out.push(k.clone().setZ(k.z + 8 * SCALE[f]), k.clone().setZ(k.z - 14 * SCALE[f]));
  }
  for (const dx of [-28, 28])
    for (const dz of [-14, 14]) out.push(wrist.clone().add(new T.Vector3(dx, 0, dz)));
  return out;
}
/** The keyboard in the hand frame: the keycaps at rest, and the printed
 * frame's faces (each with its bounds). */
type Tri = { t: T.Triangle; box: T.Box3 };
type Board = { caps: Cap[]; tris: Tri[] };
/** A mesh's faces, carried into the hand frame by `m`. */
function trisOf(mesh: MeshData, m: T.Matrix4): Tri[] {
  const p = mesh.positions,
    v = (i: number) => new T.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).applyMatrix4(m),
    out: Tri[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const t = new T.Triangle(v(mesh.indices[i]), v(mesh.indices[i + 1]), v(mesh.indices[i + 2]));
    out.push({ t, box: new T.Box3().setFromPoints([t.a, t.b, t.c]) });
  }
  return out;
}
/** How far a point is outside a tapered keycap (0 inside; near enough,
 * measured square to its axis at the nearest height). */
function outsideOf(k: Cap) {
  const inv = k.top.clone().invert();
  return (p: T.Vector3) => {
    const l = p.clone().applyMatrix4(inv),
      down = Math.min(Math.max(-l.z, 0), k.size[2]),
      half = halfAt(k, down);
    return Math.hypot(
      Math.max(0, Math.abs(l.x) - half[0]),
      Math.max(0, Math.abs(l.y) - half[1]),
      -l.z - down,
    );
  };
}
const corners = (b: Box) =>
  [-1, 1].flatMap((i) =>
    [-1, 1].flatMap((j) =>
      [-1, 1].map((k) =>
        b.c
          .clone()
          .addScaledVector(b.u[0], i * b.e[0])
          .addScaledVector(b.u[1], j * b.e[1])
          .addScaledVector(b.u[2], k * b.e[2]),
      ),
    ),
  );
/** The palm's face normals and edge directions (every pair of points: more
 * axes than it needs, which only costs time). */
function hullAxes(ps: T.Vector3[]) {
  const faces: T.Vector3[] = [],
    edges: T.Vector3[] = [];
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      edges.push(ps[j].clone().sub(ps[i]).normalize());
      for (let k = j + 1; k < ps.length; k++) {
        const n = ps[j].clone().sub(ps[i]).cross(ps[k].clone().sub(ps[i]));
        if (n.lengthSq() < 1e-9) continue;
        n.normalize();
        const d = ps.map((p) => n.dot(p.clone().sub(ps[i])));
        if (Math.max(...d) < 1e-6 || Math.min(...d) > -1e-6) faces.push(n);
      }
    }
  return { faces, edges };
}
/** How far two convex point sets overlap (mm, along the best of `axes`; 0 when apart). */
function convexOverlap(a: T.Vector3[], b: T.Vector3[], axes: T.Vector3[]) {
  let least = Infinity;
  for (const ax of axes) {
    let a0 = Infinity,
      a1 = -Infinity,
      b0 = Infinity,
      b1 = -Infinity;
    for (const p of a) {
      const d = ax.dot(p);
      a0 = Math.min(a0, d);
      a1 = Math.max(a1, d);
    }
    for (const p of b) {
      const d = ax.dot(p);
      b0 = Math.min(b0, d);
      b1 = Math.max(b1, d);
    }
    least = Math.min(least, a1 - b0, b1 - a0);
    if (least <= 0) return 0;
  }
  return least;
}
/** The palm against a convex piece with face normals `n` and edge directions `e`. */
function palmOverlap(
  palm: T.Vector3[],
  ax: ReturnType<typeof hullAxes>,
  piece: T.Vector3[],
  n: T.Vector3[],
  e: T.Vector3[],
) {
  const axes = [...ax.faces, ...n];
  for (const p of ax.edges)
    for (const q of e) {
      const x = p.clone().cross(q);
      if (x.lengthSq() > 1e-9) axes.push(x.normalize());
    }
  return convexOverlap(palm, piece, axes);
}
/** What a part passes into, deepest first per thing: keycaps it may not
 * touch, and the frame (named by the keycap nearest the spot). */
function partHits(board: Board, part: Part): Hit[] {
  const deepest: Record<string, number> = {},
    hit = (b: string, d: number) => {
      if (d > 1e-3 && !(deepest[b] >= d)) deepest[b] = d;
    },
    centre = (k: Cap) => new T.Vector3().setFromMatrixPosition(k.top),
    frameAt = (p: T.Vector3) =>
      `the frame by ${capName(
        board.caps.reduce((a, b) =>
          p.distanceToSquared(centre(b)) < p.distanceToSquared(centre(a)) ? b : a,
        ).name,
      )}`;
  // Each capsule, sampled at least every mm along its length.
  for (const [a, b, r] of part.segs) {
    const n = Math.max(2, Math.ceil(a.distanceTo(b))),
      pts = Array.from({ length: n + 1 }, (_, i) => a.clone().lerp(b, i / n)),
      reach = new T.Box3().setFromPoints([a, b]).expandByScalar(r);
    for (const k of board.caps) {
      if (part.may.includes(k.name)) continue;
      const c = new T.Vector3().setFromMatrixPosition(k.top),
        far = Math.hypot(...k.size) / 2 + r;
      if (new T.Line3(a, b).closestPointToPoint(c, true, new T.Vector3()).distanceTo(c) > far)
        continue;
      const out = outsideOf(k);
      for (const p of pts) hit(capName(k.name), r - out(p));
    }
    const q = new T.Vector3();
    for (const { t, box } of board.tris) {
      if (!box.intersectsBox(reach)) continue;
      for (const p of pts) {
        const d = r - t.closestPointToPoint(p, q).distanceTo(p);
        if (d > 1e-3) hit(frameAt(q), d);
      }
    }
  }
  if (part.hull) {
    const palm = part.hull,
      ax = hullAxes(palm),
      bounds = new T.Box3().setFromPoints(palm);
    for (const k of board.caps) {
      if (part.may.includes(k.name)) continue;
      for (const b of capBoxes(k, 0)) {
        const cs = corners(b);
        if (!bounds.intersectsBox(new T.Box3().setFromPoints(cs))) continue;
        hit(capName(k.name), palmOverlap(palm, ax, cs, b.u, b.u));
      }
    }
    for (const { t, box } of board.tris) {
      if (!box.intersectsBox(bounds)) continue;
      const n = t.getNormal(new T.Vector3());
      if (n.lengthSq() < 0.5) continue;
      const e = [t.b.clone().sub(t.a), t.c.clone().sub(t.b), t.a.clone().sub(t.c)].map((x) =>
          x.normalize(),
        ),
        d = palmOverlap(palm, ax, [t.a, t.b, t.c], [n], e);
      if (d > 1e-3) hit(frameAt(t.getMidpoint(new T.Vector3())), d);
    }
  }
  return Object.entries(deepest).map(([b, depth]) => ({ a: part.who, b, depth }));
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
/** A hit, and what the hand was doing. */
type Reach = Hit & { during: string };
/** How far the reaching digit moves between looks, mm. */
const STEP = 2;
/** The hand reaching each key in turn: no part of it may pass into the
 * keyboard (the keycaps at rest, the printed frame) except the key it reaches
 * for. The other digits rest on their home keys, the only keys they may
 * touch. The reaching digit may touch the key it leaves on the way, then only
 * the key, resting on it and pressing it. To reach the inner column the arm
 * carries the whole hand sideways. Pressing, the thumb's last two bones move
 * with the key (near enough, however it presses). */
function reachHits(c: Config, s: Settings, h: Solved, board: Board) {
  const travel = (c.switch as { travel_mm?: number }).travel_mm ?? 4,
    way = wayOf(s),
    homes = Object.fromEntries(FINGERS.map((f) => [f, h.poses[f][1]])) as Record<Finger, Pose>,
    mcps = Object.fromEntries(FINGERS.map((f) => [f, homes[f].chain.mcp])) as Record<
      Finger,
      T.Vector3
    >,
    thHome = thumb(h.row[1].q),
    thumbKeys = ['far', 'home', 'near'].map((k) => `thumb_${k}`),
    found: Record<string, Reach> = {},
    add = (part: Part, during: string) => {
      for (const x of partHits(board, part))
        if (!(found[x.a + x.b]?.depth >= x.depth)) found[x.a + x.b] = { ...x, during };
    },
    palm = (th: Thumb, by = new T.Vector3()): Part => ({
      who: 'palm',
      segs: [],
      hull: palmPoints(mcps, th).map((p) => p.add(by)),
      may: [],
    }),
    /** Every digit but `but` resting, and the palm, carried `by`. */
    rest = (but: string, during: string, by?: T.Vector3) => {
      for (const f of FINGERS)
        if (f !== but) add(fingerPart(f, homes[f], [`matrix_${f}_home`], 0, by), during);
      if (but !== 'thumb') add(thumbPart(thHome, ['thumb_home'], by), during);
      if (but !== 'thumb') add(palm(thHome, by), during);
    },
    /** The reaching digit on the way (`at(t)`, 0 < t < 1, `len` mm in all), then on the key and pressing it. */
    reach = (key: string, len: number, at: (t: number) => Part, onKey: (down: number) => Part) => {
      const n = Math.ceil(len / STEP),
        name = capName(key);
      for (let i = 1; i < n; i++) add(at(i / n), `reaching for ${name}`);
      add(onKey(0), `on ${name}`);
      add(onKey(travel), `pressing ${name}`);
    };
  rest('', 'at home');
  // The finger keys, each finger with the rest of the hand at home.
  for (const f of FINGERS)
    ROWS.forEach((r, ri) => {
      const key = `matrix_${f}_${r}`,
        dist = r === 'top' ? s.top : r === 'bottom' ? -s.bottom : 0;
      reach(
        key,
        Math.abs(dist),
        (t) => fingerPart(f, rowPose(f, s.curl[f], 0, dist * t, way), [`matrix_${f}_home`, key]),
        (down) => fingerPart(f, h.poses[f][ri], [key], down),
      );
    });
  // The inner column: the arm carries the hand toward it as the index reaches.
  ROWS.forEach((r, ri) => {
    const key = `matrix_inner_${r}`,
      dist = r === 'top' ? s.top : r === 'bottom' ? -s.bottom : 0,
      index = (t: number) => h.inner.placeAt(rowPose('index', s.curl.index, 0, dist * t, way), t),
      may = ['matrix_index_home', key],
      len = homes.index.chain.pad.distanceTo(h.poses.inner[ri].chain.pad);
    reach(
      key,
      len,
      (t) => {
        rest('index', `while the index reaches for ${capName(key)}`, h.inner.carry(t));
        return fingerPart('index', index(t), may);
      },
      (down) => {
        if (!down) rest('index', `while the index is on ${capName(key)}`, h.inner.carry(1));
        return fingerPart('index', h.poses.inner[ri], [key], down);
      },
    );
  });
  // The thumb keys: the thumb's joints move evenly from home to the key.
  h.row.forEach((k, i) => {
    const key = thumbKeys[i],
      qs = (t: number) => h.row[1].q.map((v, j) => v + (k.q[j] - v) * t),
      z = new T.Vector3().setFromMatrixColumn(k.frame, 2);
    reach(
      key,
      k.pad.distanceTo(h.row[1].pad),
      (t) => {
        const th = thumb(qs(t));
        add(palm(th), `while the thumb reaches for ${capName(key)}`);
        return thumbPart(th, ['thumb_home', key]);
      },
      (down) => {
        const th = thumb(k.q),
          by = z.clone().multiplyScalar(-down);
        if (!down) add(palm(th), `while the thumb is on ${capName(key)}`);
        return thumbPart({ ...th, I: th.I.clone().add(by), axis: th.axis.clone().add(by) }, [key]);
      },
    );
  });
  return Object.values(found);
}
/** What's wrong with a layout: keycaps hitting, the hand through the
 * keyboard (the printed frame too, given its mesh and its way into the hand
 * frame), rows out of reach, the thumb past its joints, and the board's height. */
function check(
  c: Config,
  s: Settings,
  h = solveHand(s),
  frame?: { mesh: MeshData; toHand: T.Matrix4 },
) {
  const two = !!twoOf(s),
    caps = capsOf(c, h, two);
  return {
    h,
    caps,
    capHits: capHits(c, caps),
    handHits: reachHits(c, s, h, {
      caps,
      tris: frame ? trisOf(frame.mesh, frame.toHand) : [],
    }),
    frameChecked: !!frame,
    short: [
      ...FINGERS.flatMap((f) => ROWS.map((r, ri) => [`${f} ${r}`, h.poses[f][ri].short] as const)),
      ...(two ? [['thumb 1u row', h.row[0].short] as const] : []),
    ].filter(([, m]) => m > 0.5),
    /** The arm can't carry the hand far enough sideways for the inner column. */
    innerShort: h.inner.limited,
    stiff: h.row
      .map((k, i) => [['far', 'home', 'near'][i], k.stiff] as const)
      .filter(([, d]) => d > 0.5),
    /** Thumb keys pressed further than SIDE off square (the stem binds). */
    side: h.row
      .map((k, i) => [['far', 'home', 'near'][i], k.off] as const)
      .filter(([, d]) => d > SIDE),
    height: heightOf(c, caps, deskOf(s)),
  };
}

// ---------------------------------------------------------------- presets
/** Near the Dactyl Manuform (DM_right) from Natural: tented 15° like the
 * Dactyl, the finger curl and reach mix that put the finger keys' cap tops
 * and facings closest to its keys, of the valid layouts (15°, 0.29: the
 * fitting is a test, in tests/hand.test.ts; its home keys face you 13°, the
 * Dactyl's 7.5°: closer, the bottom keys run into the thumb keys or each
 * other), the thumb pressing by swinging at the CMC toward the fingers (which lays its
 * keys 30–40° flatter; curling alone stands them nearly on edge) and turned
 * forward from rest by eye (sweep -1.9, abduction 7.6, twist 6.6); the gaps
 * tuned by eye on a printed frame: rows closer, the inner column further out,
 * the thumb keys further apart.
 * The fingers come out 3–8 mm off the Dactyl's in the index, middle and ring
 * columns, more in the inner and pinky (the Dactyl raises its outer columns
 * into a bowl, which these settings can't). Valid with the 1×3 cluster, 65 mm
 * tall (the tented finger keys set it). */
const DACTYL: Settings = {
  tent: 15,
  roll: 0,
  wrist: 0,
  bend: 0,
  curl: { index: 15, middle: 15, ring: 15, pinky: 15 },
  innerGap: 20.5,
  innerAngle: 0,
  top: 17.7,
  bottom: 17.7,
  from: 'reach',
  reachMix: 0.29,
  pressMix: 1.4,
  thumb: { sweep: -1.9, abduct: 7.6, twist: 6.6, curl: 0, mix: 1, byCmc: 1, cmcDir: 25, bend: 0 },
  spacing: 24.5,
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
 * keycaps (18.5 mm, tapering to 14, 11 high): 65 mm tall. Fitted before the
 * check followed the hand reaching each key: carried by the arm toward the
 * inner column, the resting middle finger now goes 3 mm into the index home
 * key. (On its printed frame the index brushed the thumb cluster, which the
 * model doesn't reproduce.) */
const NATURAL: Settings = {
  tent: 1,
  roll: 0,
  wrist: 0,
  bend: 0,
  curl: { index: 0, middle: 0, ring: 0, pinky: 0 },
  innerGap: 18.8,
  innerAngle: 0,
  top: 19.1,
  bottom: 19.1,
  from: 'reach',
  reachMix: 0.4,
  pressMix: 1.4,
  thumb: { sweep: 0, abduct: 0, twist: 0, curl: 0, mix: 1, byCmc: 0, cmcDir: 0, bend: 0 },
  spacing: 22.1,
  cluster: '1×3',
  two: { gap: 19.5, from: 'press', reachMix: 0.4 },
};
const TRAY = 66;
/** Why a checked layout isn't valid, as the readout says it (none: valid). */
const problems = (r: ReturnType<typeof check>) => [
  ...r.capHits.map((x) => `${capName(x.a)} hits ${capName(x.b)} (${x.depth.toFixed(1)} mm)`),
  ...r.handHits.map((x) => `${x.a} ${x.during}: into ${x.b} (${x.depth.toFixed(1)} mm)`),
  ...r.short.map(([k, m]) => `${k} out of reach (${m.toFixed(0)} mm)`),
  ...r.stiff.map(([k, d]) => `thumb ${k} out of reach (MCP/IP ${d.toFixed(0)}° past limit)`),
  ...r.side.map(([k, d]) => `thumb ${k} pressed ${d.toFixed(0)}° off square (${SIDE}° at most)`),
  ...(r.innerShort ? ['inner column out of reach'] : []),
  ...(r.height.all > TRAY ? [`${r.height.all.toFixed(1)} mm tall (tray ${TRAY} mm)`] : []),
];
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

/** Where the hand goes: the middle home keycap's top in config `c0` stays
 * where it is; everything else follows the hand. */
function anchorOf(c0: Config) {
  const mi = c0.geometry.columns.findIndex((k) => k.name === 'middle'),
    o = (
      c0.geometry.key_overrides as Record<string, { offset_mm?: number[]; rotation_deg?: number[] }>
    ).matrix_middle_home;
  // Through the key's own tilt too, or every reload moves the anchor.
  return V([0, 0, capHeight(c0)]).applyMatrix4(
    columnFrames(c0, mi)[1].multiply(frame(o?.offset_mm, o?.rotation_deg)),
  );
}
/** Hand frame → layout. */
const layoutOf = (anchor: T.Vector3, s: Settings) =>
  new T.Matrix4()
    .makeTranslation(anchor)
    .multiply(turnOf(s))
    .multiply(
      new T.Matrix4().makeTranslation(
        rowPose('middle', s.curl.middle, 0, 0, wayOf(s)).chain.pad.negate(),
      ),
    );
/** Hand frame → the editor's world (the tented board), once `c` has the hand's keys. */
const worldOf = (c: Config, anchor: T.Vector3, s: Settings) =>
  tentFrame(c).multiply(layoutOf(anchor, s));
/** Write the hand's keys and tent into config `c`. */
function applyHand(c: Config, s: Settings, anchor: T.Vector3) {
  const { poses, row } = solveHand(s),
    L = layoutOf(anchor, s),
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

// ---------------------------------------------------------------- the panel
export function setupHand(host: Host) {
  const group = new T.Group(),
    handGroup = new T.Group();
  group.matrixAutoUpdate = false;
  handGroup.matrixAutoUpdate = false;
  group.add(handGroup);
  host.scene.add(group);
  const cfg = () => host.project().config,
    anchor = anchorOf(cfg());
  // The frame is part of the keyboard the hand is checked against, so it's
  // built with every change once the kernel is here.
  let wasm: ManifoldToplevel | undefined;

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

  const toLayout = () => layoutOf(anchor, s),
    apply = () => applyHand(cfg(), s, anchor);

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
    try {
      draw();
    } catch (e) {
      note.innerHTML = `<div style="color:#ff9a8a">Couldn't check: ${e instanceof Error ? e.message : e}</div>`;
      throw e;
    }
  }
  function draw() {
    const c = cfg(),
      built = wasm && buildFrame(wasm, c),
      r = check(
        c,
        s,
        undefined,
        built && { mesh: built.mesh, toHand: worldOf(c, anchor, s).invert() },
      ),
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
    const wrong = problems(r);
    note.innerHTML = wrong.length
      ? `<div style="color:#ff9a8a">Not valid:<ul style="margin:2px 0;padding-left:18px">${wrong.map((w) => `<li>${w}</li>`).join('')}</ul></div>`
      : r.frameChecked
        ? `<div style="color:#9be39b">Valid (${r.height.all.toFixed(0)} mm tall).</div>`
        : 'Checking…';
    showFrame(built);
    host.render();
  }

  // Controls.
  const sec = document.createElement('section'),
    basic = document.createElement('div'),
    advanced = document.createElement('div');
  sec.innerHTML = '<h2>Prototype: hand</h2>';
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
    /** The value at a slider position, and back (min, max and step are positions). */
    scale = { at: (i: number) => i, of: (v: number) => v },
  ) {
    const l = document.createElement('label');
    l.style.cssText =
      'display:grid;grid-template-columns:1fr 40px;gap:0 6px;align-items:center;margin:2px 0';
    l.innerHTML = `<span>${label}</span><output style="text-align:right"></output><input type="range" min="${min}" max="${max}" step="${step}" style="grid-column:1/3;width:100%">`;
    const i = l.querySelector('input')!,
      out = l.querySelector('output')!;
    const show = () => {
      out.textContent = String(Math.round(get() * 100) / 100);
      i.value = String(scale.of(get()));
      i.disabled = !on();
      l.style.opacity = on() ? '' : '0.4';
    };
    show();
    shows.push(show);
    i.addEventListener('input', () => {
      set(scale.at(+i.value));
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
        ? 'The least change from your resting hand (fitted under an earlier check).'
        : 'Near the Dactyl Manuform: the finger curl and reach mix closest to its keys (15°, 0.29), the thumb pressing at the CMC and the gaps tuned on a printed frame.';
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
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(JSON.stringify(s));
    copy.textContent = 'Copied';
    setTimeout(() => (copy.textContent = 'Copy settings'), 1500);
  });
  paste.textContent = 'Paste settings';
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
  let shownFrame: FrameResult | undefined;
  function showFrame(r = shownFrame) {
    shownFrame = r;
    frameView.visible = frameOn.checked && !!r;
    rightStl.disabled = leftStl.disabled = !frameOn.checked || !r;
    if (!frameOn.checked || !r) {
      frameNote.textContent = '';
      return host.render();
    }
    const g = new T.BufferGeometry();
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
  frameOn.addEventListener('change', () => showFrame());
  const saveFrame = (left: boolean) => {
    const r = shownFrame!,
      a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([frameStl(r.mesh, r.floor, left).buffer as ArrayBuffer]));
    a.download = `rosebear-hand-frame-${left ? 'left' : 'right'}.stl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  rightStl.onclick = () => saveFrame(false);
  leftStl.onclick = () => saveFrame(true);
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
  // Hundredths from MIX_MIN to 0.4, then tenths to 3.
  slider(
    'reach mix: MCP° per PIP°',
    () => s.reachMix,
    (v) => (s.reachMix = v),
    Math.round(MIX_MIN * 100),
    66,
    1,
    () => s.from === 'reach',
    {
      at: (i) => (i <= 40 ? i / 100 : 0.4 + (i - 40) / 10),
      of: (v) => (v <= 0.4 ? v * 100 : 40 + (v - 0.4) * 10),
    },
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
    'press by the whole thumb at the CMC (0: curling only, 1: CMC only)',
    () => s.thumb.byCmc ?? 0,
    (v) => (s.thumb.byCmc = v),
    0,
    1,
    0.05,
  );
  slider(
    'CMC press direction: 0 down (abducting), + toward the fingers',
    () => s.thumb.cmcDir ?? 0,
    (v) => (s.thumb.cmcDir = v),
    -180,
    180,
  );
  slider(
    'curling press: IP° per MCP° (− straightens the IP)',
    () => s.thumb.mix,
    (v) => (s.thumb.mix = v),
    -3,
    3,
    0.01,
    () => (s.thumb.byCmc ?? 0) < 1,
  );
  radios(
    'Keys face the',
    ['press', 'pad'],
    () => s.thumb.facing ?? 'press',
    (v) => {
      s.thumb.facing = v as 'press' | 'pad';
      change();
    },
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
    'row: MCP and IP curl per key (+ curls toward the near key)',
    () => s.thumb.bend ?? 0,
    (v) => (s.thumb.bend = v),
    -40,
    40,
  );
  slider(
    'row: twist per key (+ pad down toward the near key)',
    () => s.thumb.roll ?? 0,
    (v) => (s.thumb.roll = v),
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
  void manifold().then((w) => {
    wasm = w;
    update();
  });
  return { update, buildCase: () => caseOn.checked };
}

/** For scripts that fit presets (in the browser, through Vite). */
export const _test = {
  T,
  fit,
  thumb,
  rotQ,
  pressDir,
  thumbRow,
  C,
  thumbRest,
  solveHand,
  capsOf,
  check,
  reachHits,
  partHits,
  palmPoints,
  anchorOf,
  applyHand,
  worldOf,
  trisOf,
  TRAY,
  rowPose,
  wayOf,
  innerColumn,
  moved,
  turnOf,
  deskOf,
  NATURAL,
  DACTYL,
  MIX_MIN,
  problems,
};
