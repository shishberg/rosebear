// The ?hand model: the finger chains and their row poses, and the thumb's kinematics
// (touch, keyAt, thumbRow). Pure geometry on the measured hand; no layout or UI.
import * as T from 'three';
import hand from '../../../hand/left-hand.json';
import { capSize, ROWS, type Config, type V3 } from '../geometry';
import { bisect, bracketThenBisect, halve } from './solve';

export const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
export type Finger = (typeof FINGERS)[number];
export type Row = (typeof ROWS)[number];
export const SCALE: Record<Finger, number> = { index: 1, middle: 1, ring: 0.95, pinky: 0.85 };
/** The fingertip's radius, as drawn. */
export const TIP_R = (f: Finger) => 7 * SCALE[f];
export const V = (p: number[]) => new T.Vector3(...(p as V3));
/** Tolerances: below `degenerate` a vector has no direction; `settled` is how
 * little a fixed-point round may still move a key's facing; `coplanar` the
 * spread of a face's vertices along a normal; `mm` a length that counts
 * (a step's remaining distance, an overlap depth); `residual` a Newton
 * step's remaining error. */
export const TOL = { degenerate: 1e-9, settled: 1e-7, coplanar: 1e-6, mm: 1e-3, residual: 1e-4 };
export const Z = new T.Vector3(0, 0, 1);
export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;
/** Key `name`'s cap top above the plate. */
export const capHeight = (c: Config, name: string) =>
  c.switch.keycap_bottom_above_plate_mm + capSize(c, name)[2];

// ---------------------------------------------------------------- fingers
/** pad: where the finger touches (at rest, the measured print; on a key, the
 * ball's lowest point along the press). ball: the fingertip's centre, a ball
 * of TIP_R fixed to the last segment, resting on the paper at the print. */
export type Chain = {
  mcp: T.Vector3;
  pip: T.Vector3;
  dip: T.Vector3;
  pad: T.Vector3;
  ball: T.Vector3;
  tip: T.Vector3;
};
export const rest = Object.fromEntries(
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

const mapChain = (c: Chain, f: (v: T.Vector3) => T.Vector3): Chain => ({
  mcp: f(c.mcp),
  pip: f(c.pip),
  dip: f(c.dip),
  pad: f(c.pad),
  ball: f(c.ball),
  tip: f(c.tip),
});

/** mcp, pip: degrees from rest, + curls. abd: + turns toward the thumb. */
export function finger(f: Finger, mcp: number, pip: number, abd = 0): Chain {
  const r = rest[f],
    across = new T.Vector3().crossVectors(r.heading, Z).normalize(),
    c = mapChain(r, (v) => v.clone()),
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
export type Pose = {
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
export type Way = (r: Rates) => [mcp: number, pip: number];
/** Walk the fingertip (+ away from you) from home along the path `way` gives,
 * step by step, until the key is `dist` mm from the home key, centre to
 * centre. The path is the keyboard: each key lies along it and faces square
 * off it, at that point. */
export function rowPose(f: Finger, curl: number, abd: number, dist: number, way: Way): Pose {
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
  for (let i = 0; i < 8000 && left() > TOL.mm; i++) {
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
export function moved(p: Pose, about: T.Vector3, a: number, by = new T.Vector3()): Pose {
  const q = (v: T.Vector3) => v.clone().sub(about).applyAxisAngle(Z, rad(a)).add(about).add(by),
    c = p.chain;
  return {
    ...p,
    chain: mapChain(c, q),
    t: p.t.clone().applyAxisAngle(Z, rad(a)),
    n: p.n.clone().applyAxisAngle(Z, rad(a)),
  };
}
/** The inner column: the arm carries the hand sideways toward the thumb,
 * square to the index column, and the index turns `angle` degrees toward the
 * thumb at its knuckle (0 = parallel to the index column), until the closest
 * key is `gap` mm (centre to centre) from the index column's. */
export function innerColumn(index: Pose[], gap: number, angle: number) {
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
  const [, hi] = halve((m) => gapAt(m) < gap, lim[0], lim[1], 40);
  return {
    poses: at(hi),
    limited: hi >= lim[1] - 0.01 || hi <= lim[0] + 0.01,
    /** An index pose `t` of the way over (0–1). */
    placeAt: (p: Pose, t: number) =>
      moved(p, p.chain.mcp, angle * t, side.clone().multiplyScalar(hi * t)),
  };
}

// ---------------------------------------------------------------- thumb
export const cmc = hand.thumb.assumed_cmc,
  C = V(cmc.cmc),
  TL = [cmc.metacarpal_mm, hand.thumb.segment_mm.mcp_ip, hand.thumb.segment_mm.ip_pad],
  thumbRest = cmc.poses['1'],
  /** The last section: wider than deep, a flat pad THUMB_R below the bone
   * with round edges (radius THUMB_R), THUMB_W across (an estimate, not
   * measured; the fit of the assumed CMC uses the same shape); its end
   * THUMB_END past the IP (the traced outline's tip, photo A). */
  THUMB_R = cmc.pad_below_distal_axis_mm,
  THUMB_W = cmc.pad_width_mm,
  THUMB_END = hand.thumb.segment_mm.ip_end,
  /** How far each round edge's centre is from the bone, sideways. */
  THUMB_EDGE = THUMB_W / 2 - THUMB_R,
  /** The index knuckle, to tell the thumb's outer edge (away from it) from its inner. */
  INDEX_MCP = V(hand.fingers.index.rest.joints.mcp);
/** The thumb's turn about the metacarpal (q[2]) for a CMC swing to `yaw`,
 * `pitch`: it comes with the swing, so only the change from one swing to
 * another is used. From Crisco et al. 2015 (J Biomech Eng 137(10)): a swing of
 * θ from neutral turns the thumb θ·sin(ele), ele = 7.5° + 36.6°·cos(azi −
 * 130°), azi the swing's direction (0° adduction, 90° flexion). The frame is
 * mirrored, so the turn toward the palm is subtracted. */
export const twistAt = (yaw: number, pitch: number) => {
  const flex = thumbRest[0] - yaw,
    abd = pitch - thumbRest[1],
    th = Math.hypot(flex, abd);
  if (th < TOL.degenerate) return thumbRest[2];
  const ele = rad(7.5) + rad(36.6) * Math.cos(Math.atan2(flex, -abd) - rad(130));
  return thumbRest[2] - th * Math.sin(ele);
};
/** q = yaw, pitch, roll (the CMC), mcp, ip: as in v4/hand/tools/thumb_cmc.py. */
const rotQ = (q: number[]) =>
  new T.Matrix4()
    .makeRotationZ(rad(q[0]))
    .multiply(new T.Matrix4().makeRotationY(rad(q[1])))
    .multiply(new T.Matrix4().makeRotationX(rad(q[2])));
export function thumb(q: number[]) {
  const R = rotQ(q),
    d = (a: number) => new T.Vector3(Math.cos(rad(a)), -Math.sin(rad(a)), 0).applyMatrix4(R),
    up = (a: number) => new T.Vector3(Math.sin(rad(a)), Math.cos(rad(a)), 0).applyMatrix4(R),
    M = C.clone().addScaledVector(d(0), TL[0]),
    I = M.clone().addScaledVector(d(q[3]), TL[1]),
    u = d(q[3] + q[4]),
    nail = up(q[3] + q[4]),
    axis = I.clone().addScaledVector(u, TL[2]);
  return {
    M,
    I,
    axis,
    pad: axis.clone().addScaledVector(nail, -THUMB_R),
    /** The last bone's direction, square to it the nail's side, and across
     * the thumb. */
    u,
    nail,
    side: u.clone().cross(nail),
    /** Where the last section's centreline stops (round, its end THUMB_R on). */
    end: I.clone().addScaledVector(u, THUMB_END - THUMB_R),
  };
}
/** Where the thumb meets a key facing `n` (out of the cap; up by default, as
 * the paper was in the photos): the last section's point furthest into it
 * (flat pad, round edges, round end). Square to the pad that's the print
 * (ip_pad past the IP); the pad is soft, so as the key tilts across the bone
 * the touch moves to the flat's edge over about 15°, and tilted tip down, to
 * the round end. `roll`: degrees the nail tilts from parallel to the key, +
 * toward the outer edge (away from the index). */
export function touch(q: number[], n = Z) {
  const th = thumb(q),
    side = th.side,
    out = Math.sign(side.dot(th.axis.clone().sub(INDEX_MCP))) || 1,
    into = n.clone().negate(),
    soft = (x: number) => Math.max(-1, Math.min(1, x / Math.sin(rad(15)))),
    across = soft(into.dot(side)),
    along = Math.max(0, soft(into.dot(th.u)));
  return {
    p: th.axis
      .clone()
      .addScaledVector(th.u, along * (THUMB_END - THUMB_R - TL[2]))
      .addScaledVector(side, across * THUMB_EDGE)
      .addScaledVector(into, THUMB_R),
    n,
    roll: deg(n.angleTo(th.nail)) * Math.sign(-n.dot(side) * out),
  };
}
/** The thumb's three movements, degrees: radial abduction (the CMC swinging
 * it away from the index, across the palm's plane: q[0]), palmar abduction
 * (the CMC swinging it away from the palm, lowering it: q[1]) and the curl
 * (the MCP and IP bending alike). */
export type Mix = number[];
/** The thumb at `q` moved by `by` times `mix`, its turn about the metacarpal
 * coming with the swing (twistAt). */
export const moveBy = (q: number[], [r, p, c]: Mix, by = 1) => {
  const y = q[0] + r * by,
    d = q[1] + p * by;
  return [y, d, q[2] + twistAt(y, d) - twistAt(q[0], q[1]), q[3] + c * by, q[4] + c * by];
};
/** The thumb `mm` into a key from `q` (− back off it), moving by `press` (a
 * Mix per mm, keyAt). */
export const pressed = (q: number[], mm: number, press: Mix) => moveBy(q, press, mm);
/** A point on the last section at `q`, carried with it to other poses. */
export function carry(q: number[], p: T.Vector3) {
  const th = thumb(q),
    rel = p.clone().sub(th.I),
    local = [rel.dot(th.u), rel.dot(th.nail), rel.dot(th.side)];
  return (q: number[]) => {
    const th = thumb(q);
    return th.I.clone()
      .addScaledVector(th.u, local[0])
      .addScaledVector(th.nail, local[1])
      .addScaledVector(th.side, local[2]);
  };
}
export const arc = hand.thumb.arc_through_prints_1_to_4;
export const arcPoint = (a: number) =>
  new T.Vector3(
    arc.centre[0] + arc.radius_mm * Math.cos(rad(a)),
    arc.centre[1] + arc.radius_mm * Math.sin(rad(a)),
    0,
  );
/** Degrees round the arc of a point. Counted from -90° (the side of the centre opposite the
 * fingers) so the thumb's keys, which go past 180°, carry on to 270° instead of wrapping negative. */
const aroundOf = (p: { x: number; y: number }) => {
  const r = deg(Math.atan2(p.y - arc.centre[1], p.x - arc.centre[0]));
  return r < -90 ? r + 360 : r;
};
export const printAngle = (k: string) => {
  const [x, y] = (hand.measured.thumb_prints as Record<string, number[]>)[k];
  return aroundOf({ x, y });
};
/** Where the thumb keys go: on the arc the thumb's pad swept in the photos
 * (thumb.arc_through_prints_1_to_4, the prints at rest, swept in, swept out
 * and pulled back), lowered. */
export type ThumbPose = {
  /** Degrees round the arc (about its centre, from +x, + away from the
   * fingers) of the home key: the rest print is at 112°, swept in 92°, swept
   * out 140°, pulled back 168°. */
  around: number;
  /** mm the thumb keys' tops sit below the middle home key's top, in the
   * hand's frame (square to the surface the hand rested on in the photos,
   * where the thumb rested level with the fingertips). */
  drop: number;
  /** The reach from key to key, per degree of radial abduction: degrees of
   * palmar abduction (+ lowering the thumb as it swings out) and of curl. */
  reach: { palmar: number; curl: number };
  /** The press: degrees from palmar abduction alone (0) toward the curl
   * alone (90; − straightening), less as much of the reach mix as makes it
   * square to the reach. */
  press: number;
  /** The far and near keys keep the home key's y (the axis across the row,
   * along the edges the keys share), not turned about their own faces or
   * tilted across the row, instead of each facing against its own press;
   * each still tilts along the row, about y, as near square to its press as
   * that leaves. Their tiles' edges stay parallel to the home key's. */
  parallel?: boolean;
  /** Degrees the row turns, as one, about a line along it `pivot` mm under
   * the home key's top (+: toward the thumb's base, the keys' faces turning
   * with them, as round a dome), the thumb refitted to each key. */
  turn?: number;
  pivot?: number;
};
/** How far the thumb's MCP and IP go, degrees: a guess as the fit bounds them (they hyperextend a little). */
const MCP_RANGE = [-15, 90],
  IP_RANGE = [-20, 90];
const clamp = (v: number, [lo, hi]: number[]) => Math.min(hi, Math.max(lo, v));
/** The 1u row of a 1.5u + 2×1u cluster: `gap` mm from the 1.5u, the thumb
 * curled in under the hand (+, bent more) or away. */
export type TwoRows = { gap: number };
/** The photos' thumb poses (the assumed CMC's) by their prints' place round
 * the arc, interpolated between. Swept in, the swing carries on to SWEEP_IN
 * past the print, the bends held at the print's (the MCP and IP are as
 * straight as they go). Pulled back it stops at the print: further, the
 * metacarpal would point back past the CMC. Beyond those the pose is held,
 * and `past` says by how much (degrees). */
export const PRINT_POSES = ['2', '1', '3', '4']
  .map((k) => ({ a: printAngle(k), q: (cmc.poses as Record<string, number[]>)[k] }))
  .sort((x, y) => x.a - y.a);
const SWEEP_IN = 20,
  AROUND = [PRINT_POSES[0].a - SWEEP_IN, PRINT_POSES[PRINT_POSES.length - 1].a];
export function photoPose(a: number) {
  const P = PRINT_POSES,
    c = clamp(a, AROUND),
    next = P.findIndex((p) => p.a > c),
    i = next < 0 ? P.length - 2 : Math.max(0, next - 1),
    t = (c - P[i].a) / (P[i + 1].a - P[i].a);
  return Object.assign(
    P[i].q.map((v, j) => (t < 0 && j > 2 ? v : v + (P[i + 1].q[j] - v) * t)),
    { past: Math.abs(a - c) },
  );
}
/** The thumb's pose `a` degrees round the arc (photoPose), bent `bend` more
 * at the MCP and IP, swung across the palm until the key is back `a` degrees
 * round the arc, and abducted until the key is at height `z` in the hand
 * frame (abduction lowers the thumb and carries it toward you). `miss`: mm
 * short of `z` within ±40° of abduction, off the arc's place within ±60° of
 * swing, and along the arc past the photos (0: reached). `n`: which way the
 * key faces. */
function thumbAt(a: number, z: number, bend = 0, n = Z) {
  const b = photoPose(a),
    bent = (d = 0, y = 0) => [
      b[0] + y,
      b[1] + d,
      b[2] + twistAt(b[0] + y, b[1] + d) - twistAt(b[0], b[1]),
      clamp(b[3] + bend, MCP_RANGE),
      clamp(b[4] + bend, IP_RANGE),
    ],
    // Abducted to height `z`, swung `y` across the palm: the touch drops as
    // the thumb abducts, bisect.
    lowered = (y: number) => {
      const d = bisect((d) => -touch(bent(d, y), n).p.z, -z, -40, 40, 30);
      return bent(d.x, y);
    },
    aroundAt = (q: number[]) => aroundOf(touch(q, n).p);
  // The key goes round the arc as the thumb swings out: bisect.
  const q = lowered(bisect((y) => aroundAt(lowered(y)), a, -60, 60, 30).x),
    t = touch(q, n);
  return {
    q,
    miss: Math.abs(t.p.z - z) + (rad(Math.abs(aroundAt(q) - a)) + rad(b.past)) * arc.radius_mm,
    a,
  };
}
/** Per degree of radial abduction, the reach's mix of the thumb's movements. */
const reachMix = (t: ThumbPose): Mix => [1, t.reach.palmar, t.reach.curl];
/** The key the thumb touches at `q`: where (`p`), which way it faces (`n`,
 * out of the cap), the reach through it (`sweep`: which way the touching
 * point goes as the thumb moves by the reach mix) and the press (a Mix per mm
 * into the key). The press is `t.press`'s mix of palmar abduction and curl,
 * less as much of the reach mix as makes it square to the reach. The key
 * faces against it; where the thumb touches depends on the facing, so it's
 * settled round by round. `away`: the press moves the thumb off the key. */
function keyAt(q: number[], t: ThumbPose) {
  let n = Z.clone();
  for (let i = 0; ; i++) {
    const k = pressOn(q, t, n),
      next = k.d.clone().normalize().negate(),
      away = next.dot(n) < 0,
      moved = next.angleTo(n);
    if (!away) n = next;
    if (away || moved < TOL.settled || i === 40)
      return {
        p: k.tp.p,
        n,
        roll: k.tp.roll,
        sweep: k.r.normalize(),
        press: k.mix.map((v) => v / k.d.length()),
        away,
        slant: 0,
      };
  }
}
/** Where the thumb at `q` touches a key facing `n` (`tp`, touch), which way
 * that point goes per degree of the reach mix (`r`) and of the press (`d`,
 * the press `mix`: `t.press`'s share less as much of the reach as makes it
 * square to the reach). */
function pressOn(q: number[], t: ThumbPose, n: T.Vector3) {
  const reach = reachMix(t),
    share = [0, Math.cos(rad(t.press)), Math.sin(rad(t.press))],
    tp = touch(q, n),
    at = carry(q, tp.p),
    // How a twentieth of a degree of each movement carries the touching point.
    J = [0, 1, 2].map((j) =>
      at(
        moveBy(
          q,
          [0, 1, 2].map((k) => (k === j ? 1 : 0)),
          0.05,
        ),
      )
        .sub(tp.p)
        .divideScalar(0.05),
    ),
    along = (m: Mix) =>
      J[0].clone().multiplyScalar(m[0]).addScaledVector(J[1], m[1]).addScaledVector(J[2], m[2]),
    r = along(reach),
    k = along(share).dot(r) / r.lengthSq(),
    mix = share.map((v, j) => v - k * reach[j]);
  return { tp, r, mix, d: along(mix) };
}
/** The key the thumb at `q` touches facing `n` (a far or near key with the
 * home key's y), as keyAt: its press per mm into the key (along `n`; the
 * thumb goes in at an angle, `slant` degrees off square, and slides that much
 * more across it). */
function keyFacing(q: number[], t: ThumbPose, n: T.Vector3) {
  const k = pressOn(q, t, n),
    into = -k.d.dot(n);
  return {
    p: k.tp.p,
    n,
    roll: k.tp.roll,
    sweep: k.r.normalize(),
    press: k.mix.map((v) => v / Math.max(into, TOL.degenerate)),
    away: into <= 0,
    slant: deg(k.d.angleTo(n.clone().negate())),
  };
}
/** From the key `from` (the thumb at `from.q` touching it at `from.p`), the
 * thumb moved by the reach mix (sign +1: swinging out, away from the
 * fingers) until the key it touches is `gap` mm from `from`'s, centre to
 * centre (to the key facing `n(q)`, if given). `miss`: mm short, if 90° of
 * swing doesn't get there. */
function thumbAlong(
  from: { q: number[]; p: T.Vector3 },
  sign: number,
  gap: number,
  t: ThumbPose,
  n?: (q: number[]) => T.Vector3,
) {
  const at = (s: number) => moveBy(from.q, reachMix(t), s),
    off = (s: number) => {
      const q = at(s);
      return (n ? touch(q, n(q)) : keyAt(q, t)).p.distanceTo(from.p) - gap;
    };
  // Out in 2° steps until past `gap`, then bisect.
  const s = bracketThenBisect((x) => off(x) < 0, sign * 2, 90, 30);
  return { q: at(s), miss: Math.abs(off(s)) };
}
/** Degrees on its side past which a key meets the back of the thumb. */
export const BACK_OF_THUMB = 120;
/** Degrees the MCP or IP is past its range at `q`. */
export const pastJoints = (q: number[]) => {
  const past = (v: number, [lo, hi]: number[]) => Math.max(0, lo - v, v - hi);
  return Math.max(past(q[3], MCP_RANGE), past(q[4], IP_RANGE));
};
/** The thumb row in the hand frame, far key first (far = away from the
 * fingers). The home key where the thumb touches it `t.around` degrees round
 * the photos' arc, abducted until the key is `t.drop` mm below `top` (the
 * middle home key's top). The far and near keys `spacing` mm from it, centre
 * to centre, the thumb moved by the reach mix. On a 1.5u + 2×1u cluster the 1u
 * keys go either side, `spacing` / 2 from their middle, the thumb at the home
 * key's place bent more until their middle is `two.gap` mm from the 1.5u
 * (negative: straightened). Each key faces against the press (keyAt), or the
 * far and near keys as the home key (`t.parallel`). Frames: z out of the cap,
 * x toward the near key. `miss`: mm the thumb falls short of the key. */
export function thumbRow(t: ThumbPose, spacing: number, top: number, two?: TwoRows) {
  const z0 = top - t.drop;
  // The home key's place and height hold whichever way it faces, and the
  // thumb touches it where it does: settled round by round (halfway each
  // round after the first ten, in case it swings back and forth).
  let n = Z.clone(),
    home = thumbAt(t.around, z0, 0, n);
  for (let i = 0; i < 40; i++) {
    const next = keyAt(home.q, t).n,
      moved = next.angleTo(n);
    n = i < 10 ? next : n.clone().add(next).normalize();
    home = thumbAt(t.around, z0, 0, n);
    if (moved < TOL.settled) break;
  }
  const hp = keyAt(home.q, t).p;
  // thumbAt's miss was measured for the facing before the last round; add
  // what the settled facing leaves (its height and place round the arc).
  home = {
    ...home,
    miss: home.miss + Math.abs(hp.z - z0) + rad(Math.abs(aroundOf(hp) - t.around)) * arc.radius_mm,
  };
  let from = { q: home.q, p: hp },
    gap = spacing,
    f = 0;
  if (two) {
    // The bend that puts the 1u row's middle `gap` from the 1.5u: it moves in
    // under the hand as the thumb bends. Out in 5° steps (to the joints'
    // ends), then bisect.
    const mid = (b: number) => thumbAt(t.around, z0, b, n),
      off = (b: number) => touch(mid(b).q, n).p.distanceTo(hp) * Math.sign(b) - two.gap,
      k = Math.sign(two.gap) || 1;
    const b = bracketThenBisect((x) => off(x) * k < 0, 5 * k, 90, 25),
      m = mid(b);
    f = Math.abs(off(b));
    from = { q: m.q, p: touch(m.q, n).p };
    gap = spacing / 2;
  }
  const flat = thumbKey(home.q, home.miss, t),
    face = t.parallel ? flat : undefined,
    ends = [1, -1].map((k) => thumbAlong(from, k, gap, t, face && ((q) => hinged(q, t, face)))),
    row = [
      thumbKey(ends[0].q, ends[0].miss + f, t, face),
      flat,
      thumbKey(ends[1].q, ends[1].miss + f, t, face),
    ];
  if (!two) inLine(row[1], row[0].at, row[2].at);
  const [far, at, near] = t.turn ? turned(row, t) : row,
    keys = [far, near];
  // `mid`: where the far and near keys are measured from (on 1.5u + 2×1u,
  // their middle).
  return Object.assign([keys[0], at, keys[1]], { mid: from });
}
/** The row (far, home, near) turned `t.turn` degrees as one about the line
 * along the home key's x `t.pivot` mm under its top (+: toward the thumb's
 * base), the thumb's pose on each refitted to touch it there (reachKey). */
function turned(row: ThumbKey[], t: ThumbPose): ThumbKey[] {
  const home = row[1],
    x = new T.Vector3().setFromMatrixColumn(home.frame, 0),
    base = thumb(home.q).M,
    toward = Math.sign(new T.Vector3().crossVectors(x, home.n).dot(base.clone().sub(home.at))) || 1,
    R = new T.Matrix4().makeRotationAxis(x, rad(t.turn ?? 0) * toward),
    pivot = home.at.clone().addScaledVector(home.n, -(t.pivot ?? 0)),
    M = new T.Matrix4()
      .makeTranslation(pivot)
      .multiply(R)
      .multiply(new T.Matrix4().makeTranslation(pivot.clone().negate()));
  return row.map((k) => {
    const at = k.at.clone().applyMatrix4(M),
      n = k.n.clone().transformDirection(R),
      fit = reachKey(at, n, k.q, k.n),
      f = keyFacing(fit.q, t, n);
    return {
      slant: f.slant,
      at,
      q: fit.q,
      n,
      frame: M.clone().multiply(k.frame),
      miss: k.miss + fit.miss,
      roll: f.roll,
      around: aroundOf(at),
      press: f.press,
      away: f.away,
    };
  });
}
/** On the 1×3 the 1.5u home key lies across the row (its y): slide it along
 * its length until its centre is in line with the far and near keys'
 * (between `a` and `b`), not staggered by the arc's curve. The thumb still
 * touches it where it did (`at`), off its centre. */
function inLine(home: { at: T.Vector3; frame: T.Matrix4 }, a: T.Vector3, b: T.Vector3) {
  const line = b.clone().sub(a).normalize(),
    square = (v: T.Vector3) => v.addScaledVector(line, -v.dot(line)),
    off = square(a.clone().sub(home.at)),
    y = new T.Vector3().setFromMatrixColumn(home.frame, 1),
    across = square(y.clone()),
    s = across.lengthSq() > TOL.degenerate ? off.dot(across) / across.lengthSq() : 0;
  home.frame.setPosition(home.at.clone().addScaledVector(y, s));
}
/** Which way a far or near key at `q` faces, keeping `face`'s y (the home
 * key's): as it would facing its own press (keyAt), tilted across the row
 * back into the plane square to y. */
function hinged(q: number[], t: ThumbPose, face: { frame: T.Matrix4 }, axis = 1) {
  const y = new T.Vector3().setFromMatrixColumn(face.frame, axis),
    n = keyAt(q, t).n;
  return n.addScaledVector(y, -n.dot(y)).normalize();
}
/** The key the thumb touches at `q` (keyAt), square to the sweep: x along
 * it, toward the near key. Or, given the home key (`face`), the key with
 * its y, tilted along the row as near square to its own press as that
 * leaves (hinged, keyFacing). `at`: where the thumb touches the key (its cap
 * top's centre, but for the 1×3's home key: inLine). `slant`: degrees the press is off square to the key. */
function thumbKey(q: number[], miss: number, t: ThumbPose, face?: { frame: T.Matrix4 }, axis = 1) {
  const k = face ? keyFacing(q, t, hinged(q, t, face, axis)) : keyAt(q, t),
    x = face ? new T.Vector3().setFromMatrixColumn(face.frame, axis) : k.sweep.clone().negate(),
    m =
      axis === 1 && face
        ? new T.Matrix4().makeBasis(new T.Vector3().crossVectors(x, k.n), x, k.n)
        : new T.Matrix4().makeBasis(x, new T.Vector3().crossVectors(k.n, x), k.n);
  m.setPosition(k.p);
  return {
    slant: k.slant,
    at: k.p,
    q,
    n: k.n,
    frame: m,
    miss,
    roll: k.roll,
    around: aroundOf(k.p),
    press: k.press,
    away: k.away,
  };
}
type ThumbKey = ReturnType<typeof thumbKey>;
/** mm the thumb lifts off the row, halfway, on its way to an extra key. */
export const EXTRA_LIFT = 15;
/** The two extra thumb keys, if on: a second row hung off the thumb row
 * like the next key down a column, x1 under the gap between the home and
 * near keys, x2 under the one between the far and home keys. From the gap
 * (halfway between the two keys' cap tops, facing halfway between them, the
 * row along their shared x), the row's face carries on `south` / 2 mm
 * toward the thumb's base, then bends `tilt` degrees about the row (+: the
 * face turns toward the thumb's base and the palm) and carries on another
 * `south` / 2 mm to the key's centre, and sits `lower` mm down along its
 * face's normal (the thumb presses further to reach it). The row curves, so
 * hung off it the two close in, and turn to each other (lowered, closer
 * still); each then moves away from the other, along the line between them,
 * until they are as far apart as the row's keys (the gaps are closer). Last, the
 * two slide together `along` mm along the row (from the near key toward the
 * far; turned round the sweep instead they would barely move, sitting near
 * its centre). Set by those alone, not by
 * the thumb. The thumb's pose on each (for the checks and the readout) is the
 * one that touches its centre with the key facing that way, pressing as on
 * the row; `miss`: mm short of it. */
export type Extra = { on: boolean; south: number; tilt: number; lower: number; along: number };
export function extraKeys(row: ThumbKey[], t: ThumbPose, { south, tilt, lower, along }: Extra) {
  const base = thumb(row[1].q).M;
  const hung = [
    [1, 2],
    [0, 1],
  ].map(([a, b]) => {
    const A = row[a],
      B = row[b],
      col = (k: ThumbKey, i: number) => new T.Vector3().setFromMatrixColumn(k.frame, i),
      n = A.n.clone().add(B.n).normalize(),
      x = col(A, 0).add(col(B, 0)),
      p = A.at.clone().add(B.at).multiplyScalar(0.5);
    x.addScaledVector(n, -x.dot(n)).normalize();
    const y = new T.Vector3().crossVectors(n, x),
      out = y.multiplyScalar(Math.sign(base.clone().sub(p).dot(y)) || 1),
      th = rad(tilt),
      face = n.clone().multiplyScalar(Math.cos(th)).addScaledVector(out, Math.sin(th)),
      on = out.clone().multiplyScalar(Math.cos(th)).addScaledVector(n, -Math.sin(th)),
      at = p
        .clone()
        .addScaledVector(out, south / 2)
        .addScaledVector(on, south / 2);
    return { A, B, n, x, p, face, at };
  });
  for (const h of hung) h.at.addScaledVector(h.face, -lower);
  const [h1, h2] = hung,
    apart = h1.at.clone().sub(h2.at),
    keys = (row[0].at.distanceTo(row[1].at) + row[1].at.distanceTo(row[2].at)) / 2,
    spread = Math.max(0, keys - apart.length()) / 2;
  apart.normalize();
  h1.at.addScaledVector(apart, spread);
  h2.at.addScaledVector(apart, -spread);
  const slide = row[0].at.clone().sub(row[2].at).setLength(along);
  for (const h of hung) h.at.add(slide);
  return hung.map(({ A, B, n, x, face, at }) => {
    const frame = new T.Matrix4()
        .makeBasis(x, new T.Vector3().crossVectors(face, x), face)
        .setPosition(at),
      fit = reachKey(
        at,
        face,
        A.q.map((v, j) => (v + B.q[j]) / 2),
        n,
      ),
      k = keyFacing(fit.q, t, face);
    return {
      slant: k.slant,
      at,
      q: fit.q,
      n: face,
      frame,
      miss: fit.miss,
      roll: k.roll,
      around: aroundOf(at),
      press: k.press,
      away: k.away,
    };
  });
}
/** The thumb's pose touching `at` on a key facing `n`: its swing, lowering
 * and curl (radial and palmar abduction, the MCP and IP alike) from `q0`,
 * where it touches a key facing `n0`. Many poses touch the one point; this
 * follows one, moving the point and the facing there from `q0`'s in
 * twentieths, a few damped Newton steps (each at most 5°) on each, so it
 * changes smoothly as the key does. `miss`: mm short. */
function reachKey(at: T.Vector3, n: T.Vector3, q0: number[], n0: T.Vector3) {
  // From a straight thumb the steps may stall short of a key that needs it
  // curled: also start curled 30° and 60° at the MCP and IP, keeping the
  // closest (the least past the joints' ends first).
  const tries = [0, 30, 60].map((b) =>
    reachFrom(
      at,
      n,
      q0.map((v, j) => (j === 3 ? clamp(v + b, MCP_RANGE) : j === 4 ? clamp(v + b, IP_RANGE) : v)),
      n0,
    ),
  );
  const score = (r: { q: number[]; miss: number }) => Math.round(pastJoints(r.q)) * 1000 + r.miss;
  return tries.reduce((a, b) => (score(b) < score(a) - TOL.residual ? b : a));
}
function reachFrom(at: T.Vector3, n: T.Vector3, q0: number[], n0: T.Vector3) {
  const from = touch(q0, n0).p,
    pose = (u: number[]) => moveBy(q0, u);
  let u = [0, 0, 0],
    f = [0, 0, 0];
  for (let step = 1; step <= 20; step++) {
    const s = step / 20,
      to = from.clone().lerp(at, s),
      face = n0.clone().lerp(n, s).normalize(),
      off = (u: number[]) => touch(pose(u), face).p.sub(to).toArray();
    f = off(u);
    let lambda = 1e-3;
    for (let i = 0; i < 15 && Math.hypot(...f) > TOL.residual; i++) {
      const h = 0.05,
        J = [0, 1, 2].map((k) => {
          const e = [0, 0, 0];
          e[k] = h;
          const g = off(u.map((v, j) => v + e[j]));
          return g.map((v, j) => (v - f[j]) / h);
        }),
        // (Jᵀ J + λ) d = −Jᵀ f, J's rows per movement.
        M = [0, 1, 2].map((r) =>
          [0, 1, 2].map(
            (c) => J[r].reduce((a, v, j) => a + v * J[c][j], 0) + (r === c ? lambda : 0),
          ),
        ),
        g = [0, 1, 2].map((r) => -J[r].reduce((a, v, j) => a + v * f[j], 0));
      let d = solve3(M, g);
      const big = Math.hypot(...d);
      if (big > 5) d = d.map((v) => (v * 5) / big);
      const next = u.map((v, j) => v + d[j]),
        fn = off(next);
      // Never further past the joints' ends: from a straight thumb, bending
      // back would reach as well as curling.
      if (
        Math.hypot(...fn) < Math.hypot(...f) &&
        pastJoints(pose(next)) <= Math.max(pastJoints(pose(u)), TOL.residual)
      )
        [u, f, lambda] = [next, fn, lambda / 3];
      else lambda *= 4;
    }
  }
  return { q: pose(u), miss: Math.hypot(...f) };
}
/** M x = g for a 3×3 M (Cramer's rule). */
function solve3(M: number[][], g: number[]) {
  const det = (m: number[][]) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]),
    D = det(M);
  return [0, 1, 2].map((c) => det(M.map((r, i) => r.map((v, j) => (j === c ? g[i] : v)))) / D);
}
