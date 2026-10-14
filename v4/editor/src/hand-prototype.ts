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
 * point. The readout gives the other mix. The inner column is left out of the
 * readout: it's reached with the wrist.
 * Thumb: a ball joint at the assumed CMC, hinges at the MCP and IP. Its home
 * pose is set by joint angles; it presses like a finger, curling the MCP and
 * IP (with as much CMC abduction blended in as a slider says), and the CMC
 * reaches between keys, square to the press at each one.
 * The palm is a sketch.
 */
import * as T from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import hand from '../../hand/left-hand.json';
import { columnFrames, frame, ROWS, tentFrame, type Project, type Config, type V3 } from './geometry';

type Host = {
  scene: T.Scene;
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
const TYPIST: Record<string, Finger> = {
  inner: 'index',
  index: 'index',
  middle: 'middle',
  ring: 'ring',
  pinky: 'pinky',
};
const V = (p: number[]) => new T.Vector3(...(p as V3));
const Z = new T.Vector3(0, 0, 1);
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const capTop = (c: Config) => c.switch.keycap_bottom_above_plate_mm + c.switch.keycap_mm[2];

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
type Chain = { mcp: T.Vector3; pip: T.Vector3; dip: T.Vector3; pad: T.Vector3; ball: T.Vector3; tip: T.Vector3 };
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
    return [f, { mcp, pip: V(r.joints.pip), dip, pad: V(r.pad), ball: V(r.pad).addScaledVector(Z, TIP_R(f)), tip, heading }];
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
  for (const p of [c.pip, c.dip, c.pad, c.ball, c.tip]) p.sub(c.mcp).applyAxisAngle(Z, rad(abd)).add(c.mcp);
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
/** The wrist, where the palm sketch ends (not measured): turning the hand
 * toward the thumb here carries the fingertips sideways much further than
 * turning a finger at its knuckle. */
const WRIST = rest.middle.mcp.clone().add(new T.Vector3(-8, -85, -12));
/** The pose with the whole hand turned `a` degrees toward the thumb at the wrist. */
function atWrist(p: Pose, a: number): Pose {
  const q = (v: T.Vector3) => v.clone().sub(WRIST).applyAxisAngle(Z, rad(a)).add(WRIST),
    c = p.chain;
  return {
    ...p,
    chain: { mcp: q(c.mcp), pip: q(c.pip), dip: q(c.dip), pad: q(c.pad), ball: q(c.ball), tip: q(c.tip) },
    t: p.t.clone().applyAxisAngle(Z, rad(a)),
    n: p.n.clone().applyAxisAngle(Z, rad(a)),
  };
}
/** To press straight along −n: degrees the PIP and DIP straighten (together)
 * per degree the MCP flexes. Jindrich et al. 2004 measured about 1.4. */
function pressRatio(f: Finger, abd: number, p: Pose) {
  const { vm, vp, ip } = rates(f, abd, p.mcp, p.pip);
  // a·vm + b·vp is square to t: a ∝ vp·t, b ∝ −vm·t.
  return (vm.dot(p.t) * ip) / vp.dot(p.t);
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
};
/** How far the thumb's MCP and IP go, degrees: a guess (they hyperextend a little). */
const inRange = (q: number[]) => q[3] >= -10 && q[3] <= 90 && q[4] >= -20 && q[4] <= 90;
/** The 1u row of a 1.5u + 2×1u cluster: `gap` mm from the 1.5u along the pad's
 * path (+ curled), reached like a finger between rows: MCP degrees per IP
 * degree as set, or square to the press. */
type TwoRows = { gap: number; from: string; reachMix: number };
/** The thumb row in the hand frame, far key first (far = away from the
 * fingers). Each key faces against the press. Between keys the thumb moves as
 * one piece at the CMC (the pad on a sphere round it), square to both the
 * press and the line from the CMC at each point, `spacing` mm along the pad's
 * path. Frames: z out of the cap, x toward the near key. */
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
    walk = (sign: number, from = qh, dist = spacing) => {
      let q = from,
        v = along(q);
      for (let left = dist; left > 1e-6; ) {
        const step = Math.min(0.25, left),
          r = thumb(q).pad.sub(C),
          turn = new T.Matrix4().makeRotationAxis(
            r.clone().cross(v).normalize(),
            (sign * step) / r.length(),
          ),
          e = new T.Euler().setFromRotationMatrix(turn.multiply(rotQ(q)), 'ZYX');
        q = [deg(e.z), deg(e.y), deg(e.x), q[3], q[4]];
        v = along(q, v);
        left -= step;
      }
      return q;
    };
  // 1.5u + 2×1u: the 1u row is a finger's step from the 1.5u (MCP and IP),
  // and its two keys sit either side of that point along the row.
  let qs = [walk(1), qh, walk(-1)],
    short = 0,
    /** The cluster's keys face square to the row and to the step's path. */
    paths: (T.Vector3 | undefined)[] = [undefined, undefined, undefined];
  if (two) {
    const pad = (q: number[]) => thumb(q).pad,
      /** The joints' step and the pad's way along the path, at q. */
      way = (q: number[], prev?: number[]) => {
        const p0 = pad(q),
          vm = pad([...q.slice(0, 3), q[3] + 0.1, q[4]]).sub(p0).divideScalar(0.1),
          vi = pad([...q.slice(0, 4), q[4] + 0.1]).sub(p0).divideScalar(0.1),
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
    qs = [walk(1, q, spacing / 2), qh, walk(-1, q, spacing / 2)];
    // The 1u keys: the CMC carries the path's direction round with the thumb.
    const back = rotQ(q).invert();
    paths = qs.map((qk, i) => (i === 1 ? t0 : w.dir.clone().transformDirection(rotQ(qk).multiply(back))));
  }
  return qs.map((q, i) => {
    const pad = thumb(q).pad,
      pressed = press(q).negate(),
      x = along(q).negate(),
      t = paths[i],
      z = t ? x.clone().cross(t).normalize() : pressed.clone();
    if (z.dot(pressed) < 0) z.negate();
    const xx = x.addScaledVector(z, -x.dot(z)).normalize(),
      m = new T.Matrix4().makeBasis(xx, new T.Vector3().crossVectors(z, xx), z).setPosition(pad);
    /** Degrees the press is off square to the key. */
    return { pad, q, frame: m, short, off: deg(z.angleTo(pressed)) };
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
  group.add(capsule(C, th.M, 11), capsule(th.M, th.I, 10.5), capsule(th.I, th.axis, cmc.pad_below_distal_axis_mm));
  const wrist = WRIST,
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
 * `normal`. The column takes the home key's place and splay; each key's own
 * offset and tilt go in key_overrides. */
type KeyTop = { top: T.Vector3; normal: T.Vector3 };
function placeColumns(c: Config, keys: Record<string, KeyTop[]>, splay: Record<string, number>) {
  const g = c.geometry,
    h = capTop(c),
    over = g.key_overrides as Record<string, { offset_mm?: number[]; rotation_deg?: number[] }>;
  g.columns.forEach((col, ci) => {
    const K = keys[col.name];
    col.rotation_deg = [0, 0, Math.round(splay[col.name] * 10) / 10];
    col.offset_mm = [K[1].top.x - (ci - 2) * g.column_pitch_mm, K[1].top.y, 0];
    col.heights_mm = K.map((k) => r2(k.top.z - h));
    const frames = columnFrames(c, ci);
    ROWS.forEach((r, ri) => {
      const z = K[ri].normal,
        x = new T.Vector3().setFromMatrixColumn(frames[ri], 0),
        xx = x.addScaledVector(z, -x.dot(z)).normalize(),
        m = frames[ri]
          .clone()
          .invert()
          .multiply(
            new T.Matrix4()
              .makeBasis(xx, new T.Vector3().crossVectors(z, xx), z)
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
    seats = tops.map((m) => m.clone().multiply(new T.Matrix4().makeTranslation(0, 0, -capTop(c)))),
    e = new T.Euler().setFromRotationMatrix(seats[1], 'ZYX');
  t.position_mm = new T.Vector3().setFromMatrixPosition(seats[1]).toArray().map(r2);
  t.rotation_deg = [e.x, e.y, e.z].map((v) => r2(deg(v)));
  t.arc = { ...t.arc, step_deg: 0, well_deg: 0 };
  const inv = frame(t.position_mm, t.rotation_deg).invert();
  (t.keys as { name: string; offset_mm?: number[]; rotation_deg?: number[] }[]).forEach((key, i) => {
    const m = inv
        .clone()
        .multiply(seats[i])
        .multiply(frame([0, 0, 0], keyTurn(key.name, two))),
      ke = new T.Euler().setFromRotationMatrix(m, 'ZYX');
    key.offset_mm = new T.Vector3().setFromMatrixPosition(m).toArray().map(r2);
    key.rotation_deg = [ke.x, ke.y, ke.z].map((v) => r2(deg(v)));
  });
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
    o = (c0.geometry.key_overrides as Record<string, { offset_mm?: number[]; rotation_deg?: number[] }>)
      .matrix_middle_home,
    // Through the key's own tilt too, or every reload moves the anchor.
    anchor = V([0, 0, capTop(c0)]).applyMatrix4(
      columnFrames(c0, mi)[1].multiply(frame(o?.offset_mm, o?.rotation_deg)),
    );

  // The closest fit to the Dactyl Manuform (DM_right): every hand slider at
  // once, least squares over all 18 keys' cap tops (per 2 mm) and facings (per
  // 3°), relative to the middle home key, before tenting. The finger keys come
  // out 2–3 mm off in the middle and ring columns, 6–13 mm in the inner, index
  // and pinky (the Dactyl raises its outer columns into a bowl, which these
  // sliders can't); the thumb's home key within 2 mm, its end keys 15–19 mm
  // (its row runs more toward you than the Dactyl's). Earlier defaults: tent
  // 20, curls 25, inner/top/bottom 18, reach mix 0.4, the thumb at rest
  // pressed from the CMC (all 0 but cmc 3), spacing 19.5. The inner column
  // turns 80% at the wrist (refitted to the Dactyl's inner keys: 10°; turned
  // at the knuckle alone it fits at 23° with the bottom keys 11 mm apart).
  const s = {
    tent: 15,
    roll: 4,
    wrist: 12,
    bend: -2,
    curl: { index: 15, middle: 16, ring: 13, pinky: 11 } as Record<Finger, number>,
    inner: 10,
    innerWrist: 0.8,
    top: 17,
    bottom: 15,
    from: 'reach',
    reachMix: 0.4,
    pressMix: 1.4,
    thumb: { sweep: 11, abduct: 41, twist: -90, curl: -24, mix: -2.1, cmc: 0.2 } as ThumbPose,
    spacing: 24.5,
    cluster: '1×3',
    // The 1u row, a key's depth from the 1.5u, on the curled side, reached
    // square to the press. (A reach mix like the fingers' 0.4 moves the thumb's
    // pad mostly along its press, onto the 1.5u.)
    two: { gap: 19.5, from: 'press', reachMix: 0.4 } as TwoRows,
    row: 'home' as Row,
    thumbOn: 'home',
  };
  const defaults = structuredClone(s);
  const twoRows = () => (s.cluster === '1×3' ? undefined : s.two),
    thumbKeys = () => thumbRow(s.thumb, s.spacing, twoRows());

  /** The hand's turn on the board. */
  const turn = () =>
    new T.Matrix4()
      .makeRotationZ(rad(-s.bend))
      .multiply(new T.Matrix4().makeRotationX(rad(-s.wrist)))
      .multiply(new T.Matrix4().makeRotationY(rad(s.roll)));
  /** Hand frame → layout. */
  const toLayout = () =>
    new T.Matrix4()
      .makeTranslation(anchor)
      .multiply(turn())
      .multiply(new T.Matrix4().makeTranslation(rowPose('middle', s.curl.middle, 0, 0, way).chain.pad.negate()));

  /** The reach: either as set, or square to the press as set. */
  const way: Way = (r) => {
    if (s.from === 'reach') return [s.reachMix, 1];
    const press = r.vm.clone().addScaledVector(r.vp, -s.pressMix / r.ip);
    return [r.vp.dot(press), -r.vm.dot(press)];
  };
  // Each column: every row's pose and its key.
  function solve() {
    const poses: Record<string, Pose[]> = {};
    for (const col of cfg().geometry.columns.map((k) => k.name)) {
      const f = TYPIST[col],
        inner = col === 'inner',
        // The inner column: the index turned in, part at the wrist, the rest at its knuckle.
        abd = inner ? s.inner * (1 - s.innerWrist) : 0;
      poses[col] = ROWS.map((r) => {
        const p = rowPose(f, s.curl[f], abd, r === 'top' ? s.top : r === 'bottom' ? -s.bottom : 0, way);
        return inner ? atWrist(p, s.inner * s.innerWrist) : p;
      });
    }
    return { poses };
  }

  function apply() {
    const c = cfg(),
      { poses } = solve(),
      L = toLayout(),
      keys: Record<string, KeyTop[]> = {},
      splay: Record<string, number> = {};
    c.geometry.tent_deg = s.tent;
    for (const col of Object.keys(poses)) {
      keys[col] = poses[col].map((p) => ({
        top: p.chain.pad.clone().applyMatrix4(L),
        normal: p.n.clone().transformDirection(L),
      }));
      // The column runs the way the fingertip travels, bottom key to top, seen
      // from above. (Knuckle to fingertip points steeply down when curled, so
      // a little roll swung it, and the keys, ~2° per degree.)
      const d = poses[col][0].chain.pad.clone().sub(poses[col][2].chain.pad).transformDirection(L);
      splay[col] = deg(Math.atan2(-d.x, d.y));
    }
    placeColumns(c, keys, splay);
    placeThumb(
      c,
      thumbKeys().map((k) => L.clone().multiply(k.frame)),
      !!twoRows(),
    );
  }

  const note = document.createElement('p');
  function update() {
    const c = cfg(),
      { poses } = solve(),
      ri = ROWS.indexOf(s.row),
      L = toLayout();
    const row = thumbKeys(),
      two = !!twoRows(),
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
    // Per finger (not the inner column): what each row asks of the joints.
    const sign = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}`,
      misses = FINGERS.flatMap((f) =>
        ROWS.map((r, ri) => [r, poses[f][ri].short] as const)
          .filter(([, m]) => m > 0.5)
          .map(([r, m]) => `${f} ${r} by ${m.toFixed(0)} mm`),
      );
    note.innerHTML =
      (misses.length ? `Out of reach: ${misses.join(', ')}.` : 'Every row in reach.') +
      '<br>From home to the top / bottom row, degrees (+ curls); then to press, how far the PIP and DIP straighten per MCP degree on the top / home / bottom key (Jindrich measured 1.4). Keys tilt (+ far edge down) top / home / bottom:<br>' +
      FINGERS.map((f) => {
        const [t, h, b] = poses[f],
          d = (p: Pose) => `MCP ${sign(p.mcp - h.mcp)} PIP ${sign(p.pip - h.pip)}`,
          pr = poses[f].map((p) => pressRatio(f, 0, p).toFixed(1)).join(' / '),
          tilt = poses[f]
            .map((p) => {
              const n = p.n.clone().transformDirection(L);
              return sign(deg(Math.atan2(n.y, n.z)));
            })
            .join(' / ');
        return `${f}: ${d(t)} / ${d(b)}; press ${pr}; keys ${tilt}°`;
      }).join('<br>') +
      `<br>Inner column from the index column, top / home / bottom (centre to centre): ${ROWS.map((_, ri) =>
        poses.inner[ri].chain.pad.distanceTo(poses.index[ri].chain.pad).toFixed(1),
      ).join(' / ')} mm.` +
      (() => {
        const at = row[1].pad.clone().applyMatrix4(L).sub(anchor),
          n = new T.Vector3().setFromMatrixColumn(row[1].frame, 2).transformDirection(L),
          m = poses.middle[1].n.clone().transformDirection(L),
          dir = row[0].pad.clone().sub(row[2].pad).transformDirection(L);
        return (
          `<br>Thumb home key from the middle home key: ${sign(at.x)} toward the pinky, ${sign(at.y)} away, ${sign(at.z)} up (mm). ` +
          `It faces ${deg(n.angleTo(Z)).toFixed(0)}° from straight up, toward the thumb side turned ${sign(deg(Math.atan2(-n.y, -n.x)))}° toward you (${deg(n.angleTo(m)).toFixed(0)}° from the middle home key). ` +
          `Dactyl's: −49, −54, −11 mm; 37° from up, turned +33° toward you (38°). ` +
          `The row runs ${sign(deg(Math.atan2(dir.y, -dir.x)))}° from straight across (+ far key away from you), ${sign(deg(Math.asin(dir.z)))}° up toward the far key. ` +
          (() => {
            const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180,
              [f, h] = [row[0].q, row[1].q];
            if (two) {
              const g = row[0].pad.clone().add(row[2].pad).multiplyScalar(0.5).sub(row[1].pad).applyMatrix4(new T.Matrix4().extractRotation(L)),
                n0 = new T.Vector3().setFromMatrixColumn(row[1].frame, 2),
                n1 = new T.Vector3().setFromMatrixColumn(row[0].frame, 2).add(new T.Vector3().setFromMatrixColumn(row[2].frame, 2)).normalize();
              return `Pressed ${row[1].off.toFixed(0)}° off square to the 1.5u, ${row[0].off.toFixed(0)}° / ${row[2].off.toFixed(0)}° to the 1u keys. ` + (row[0].short > 0.5 ? `The 1u row is out of reach by ${row[0].short.toFixed(0)} mm (the MCP or IP at its limit). ` : '') + `The 1u row from the 1.5u: MCP ${sign(f[3] - h[3])}° IP ${sign(f[4] - h[4])}° (+ curls); its centre is ${sign(g.x)} toward the pinky, ${sign(g.y)} away, ${sign(g.z)} up (mm), and its keys face ${deg(n1.angleTo(n0)).toFixed(0)}° from the 1.5u. Between the two 1u keys the CMC sweeps ${sign(wrap(row[2].q[0] - f[0]))}°.`;
            }
            return `To reach the far key the CMC sweeps ${sign(wrap(h[0] - f[0]))}°, abducts ${sign(wrap(f[1] - h[1]))}° and twists ${sign(wrap(f[2] - h[2]))}°.`;
          })()
        );
      })();
    // How tall the board stands: from the highest keycap corner down to the
    // lowest switch body's bottom, plus the base under it.
    const world = tentFrame(c),
      sw = c.switch,
      caps = (c.switch as { keycap_overrides_mm?: Record<string, number[]> }).keycap_overrides_mm ?? {},
      tallest = { z: -Infinity, key: '' },
      fingers = { z: -Infinity, key: '' },
      noFar = { z: -Infinity, key: '' },
      lowest = { z: Infinity, key: '' },
      corners = (m: T.Matrix4, w: number, d: number, zs: number[], into: { z: number; key: string }, key: string, hi: boolean) => {
        for (const x of [-w / 2, w / 2])
          for (const y of [-d / 2, d / 2])
            for (const z of zs) {
              const p = new T.Vector3(x, y, z).applyMatrix4(m);
              if (hi ? p.z > into.z : p.z < into.z) Object.assign(into, { z: p.z, key });
            }
      },
      cap = (key: string, top: T.Matrix4) => {
        const [w, d, h] = caps[key] ?? sw.keycap_mm,
          m = world.clone().multiply(top),
          seat = -h - sw.keycap_bottom_above_plate_mm;
        corners(m, w, d, [-h, 0], tallest, key, true);
        if (key.startsWith('matrix_')) corners(m, w, d, [-h, 0], fingers, key, true);
        if (key !== 'thumb_far' || two) corners(m, w, d, [-h, 0], noFar, key, true);
        corners(m, sw.body_mm[0], sw.body_mm[1], [seat - sw.body_below_plate_mm], lowest, key, false);
      };
    for (const col of Object.keys(poses))
      poses[col].forEach((p, ri) => {
        const z = p.n.clone().transformDirection(L),
          x = new T.Vector3(1, 0, 0).addScaledVector(z, -z.x).normalize();
        cap(
          `matrix_${col}_${ROWS[ri]}`,
          new T.Matrix4()
            .makeBasis(x, new T.Vector3().crossVectors(z, x), z)
            .setPosition(p.chain.pad.clone().applyMatrix4(L)),
        );
      });
    row.forEach((k, i) => {
      const name = ['far', 'home', 'near'][i];
      cap(
        `thumb_${name}`,
        L.clone()
          .multiply(k.frame)
          .multiply(frame([0, 0, 0], keyTurn(name, two))),
      );
    });
    const name = (k: string) => k.replace(/^matrix_/, '').replace('_', ' '),
      base = (c as { chassis?: { base_thickness_mm?: number } }).chassis?.base_thickness_mm ?? 2;
    note.innerHTML += `<br>Height: ${(tallest.z - lowest.z + base).toFixed(0)} mm from the base to the highest keycap corner (${name(tallest.key)}; lowest switch: ${name(lowest.key)}); the finger keys alone: ${(fingers.z - lowest.z + base).toFixed(0)} mm${two ? '' : `; without the far thumb key: ${(noFar.z - lowest.z + base).toFixed(0)} mm`}. Keyboard tray: 66 mm.` +
      // As measured on the Dactyl Manuform (12.7–12.8° on every row at its nominal 15°).
      `<br>Index to pinky cap tops slope (+ pinky side lower), top / home / bottom: ${ROWS.map((_, ri) => {
        const at = (col: string) => poses[col][ri].chain.pad.clone().applyMatrix4(L).applyMatrix4(world),
          d = at('pinky').sub(at('index'));
        return deg(Math.atan2(-d.z, Math.hypot(d.x, d.y))).toFixed(1);
      }).join(' / ')}°. Dactyl Manuform: 12.8° (15° tent).`;
    host.render();
  }

  // Controls.
  const sec = document.createElement('section'),
    box = document.createElement('div');
  sec.innerHTML = `<h2>Prototype: hand</h2><small>The keys follow your measured hand. Sliders rewrite the layout; Undo restores it.</small>`;
  sec.append(box, note);
  note.style.cssText = 'color:#ffd36b;min-height:1em';
  document.querySelector('aside')!.prepend(sec);
  let touched = false;
  const change = () => {
    if (!touched) host.snapshot();
    touched = true;
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
      i.value = out.textContent = String(get());
      i.disabled = !on();
      l.style.opacity = on() ? '' : '0.4';
    };
    show();
    shows.push(show);
    i.addEventListener('input', () => {
      set(+i.value);
      out.textContent = i.value;
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
  }
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
  heading('Hand on the board (degrees)');
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
    'wrist: + bent toward the pinky',
    () => s.bend,
    (v) => (s.bend = v),
    -25,
    25,
  );
  heading('Curl at home (degrees: + curled, − straighter)');
  for (const f of FINGERS)
    slider(
      f,
      () => s.curl[f],
      (v) => (s.curl[f] = v),
      -30,
      40,
    );
  slider(
    'inner column: index turned in',
    () => s.inner,
    (v) => (s.inner = v),
    5,
    35,
  );
  slider(
    'inner column: share turned at the wrist (0 = the index alone, at its knuckle; 1 = the whole hand)',
    () => s.innerWrist,
    (v) => (s.innerWrist = v),
    0,
    1,
    0.05,
  );
  heading('Rows (mm from home, along the keyboard)');
  const fromBox = document.createElement('div');
  box.append(fromBox);
  slider(
    'reach mix: MCP degrees per PIP degree between rows (+ both curl, − opposite)',
    () => s.reachMix,
    (v) => (s.reachMix = v),
    -1,
    3,
    0.1,
    () => s.from === 'reach',
  );
  slider(
    'press mix: PIP+DIP degrees straightened per MCP degree flexed',
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
  heading('Thumb row');
  slider(
    'sweep: + across toward the fingers (CMC, degrees from rest)',
    () => s.thumb.sweep,
    (v) => (s.thumb.sweep = v),
    -80,
    30,
  );
  slider(
    'abduction: + down, away from the palm (CMC)',
    () => s.thumb.abduct,
    (v) => (s.thumb.abduct = v),
    -30,
    60,
  );
  slider(
    'twist: + pad turned to face down (CMC)',
    () => s.thumb.twist,
    (v) => (s.thumb.twist = v),
    -90,
    90,
  );
  slider(
    'curl: MCP and IP, degrees past rest',
    () => s.thumb.curl,
    (v) => (s.thumb.curl = v),
    -30,
    50,
  );
  slider(
    'press: IP degrees per MCP degree (− straightens)',
    () => s.thumb.mix,
    (v) => (s.thumb.mix = v),
    -3,
    3,
    0.1,
  );
  slider(
    'press: CMC abduction degrees per MCP degree (0 = like a finger)',
    () => s.thumb.cmc,
    (v) => (s.thumb.cmc = v),
    0,
    3,
    0.1,
  );
  slider(
    'key spacing (mm)',
    () => s.spacing,
    (v) => (s.spacing = v),
    17,
    30,
    0.5,
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
  slider(
    '1u row: mm from the 1.5u along the pad\'s path (+ curled, − straighter)',
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
    '1u row reach mix: MCP degrees per IP degree',
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
  // Back to the defaults, keeping which keys the hand is shown on; one Undo step.
  const reset = document.createElement('button');
  reset.textContent = 'Reset hand';
  reset.addEventListener('click', () => {
    const twoFrom = s.two.from;
    Object.assign(s, structuredClone(defaults), { row: s.row, thumbOn: s.thumbOn, from: s.from, cluster: s.cluster });
    s.two.from = twoFrom;
    shows.forEach((f) => f());
    change();
    touched = false;
  });
  sec.insertBefore(reset, box);

  const caseBox = document.createElement('label');
  caseBox.innerHTML = '<input type="checkbox"> Build the case (often fails on these layouts)';
  const caseOn = caseBox.querySelector('input')!;
  caseOn.addEventListener('change', host.rebuild);
  box.append(caseBox);

  // Lay the keys out from the hand straight away (Undo restores the old layout).
  change();
  touched = false;
  return { update, buildCase: () => caseOn.checked };
}
