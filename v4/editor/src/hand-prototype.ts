/**
 * PROTOTYPE ?hand — throwaway. The measured left hand (v4/hand/left-hand.json,
 * mirrored into the right half's layout axes) drawn in the editor, laying out
 * the keys: each home key goes under its fingertip, the top and bottom rows
 * where the fingertip lands when it reaches forward or pulls back, and the
 * thumb row where the thumb sits in the photos as it sweeps round, lowered,
 * each key along the thumb's last bone and pressed straight down. Opening
 * the page and every slider move rewrite the finger columns and the thumb row (Undo restores).
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
 * Thumb: a ball joint at the assumed CMC, hinges at the MCP and IP. Its pose
 * at each key starts from the photos': the pose that put the pad on each
 * print as it swept round (rest, swept in, out and back, all on one arc),
 * interpolated by the place round that arc. Each key is square to the sweep
 * round the arc (sweeping from key to key runs across the key tops) and
 * faces up, touching the last section's lowest point where it touched the
 * paper (touch; how far it lies on its side falls out, and the readout says
 * it); the thumb presses it straight down, swinging at
 * the CMC and bending at the MCP and IP together. The thumb swings round
 * until the key is at its place round the arc, then abducts at the CMC to
 * lower the key as set (which carries it toward you). The home key's place
 * round the arc and the drop are set; the far and near keys go further
 * round and back, the spacing from it. The thumb's turn about the metacarpal isn't
 * set: it comes with the CMC's swing (twistAt), as it does in the hand.
 * The palm is a sketch.
 * Settings: three presets (Dactyl fit, near the Dactyl Manuform and fitted by a test; Natural,
 * the least change from the resting hand that makes a valid layout; Yours, set by hand in
 * the editor from the Dactyl fit), a rotation handle
 * (the hand on the board at the middle home key, or the thumb at its CMC), a
 * few basic sliders that move several settings together, and the rest under
 * Advanced. The readout says first whether the layout is valid: no keycap
 * hits another (pressed to the bottom against one at rest), no part of the
 * hand (palm included) goes into the keyboard (the keycaps and the printed
 * test frame) reaching for any key, except into that key (reachHits), every
 * key is in reach and the board fits the 66 mm tray.
 */
import * as T from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import hand from '../../hand/left-hand.json';
import {
  capSize,
  capTop,
  columnFrames,
  componentFrames,
  defaults,
  frame,
  ROWS,
  tentFrame,
  type Cluster,
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
/** Key `name`'s cap top above the plate. */
const capHeight = (c: Config, name: string) =>
  c.switch.keycap_bottom_above_plate_mm + capSize(c, name)[2];

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
    limited: hi >= lim[1] - 0.01 || hi <= lim[0] + 0.01,
    /** An index pose `t` of the way over (0–1). */
    placeAt: (p: Pose, t: number) =>
      moved(p, p.chain.mcp, angle * t, side.clone().multiplyScalar(hi * t)),
  };
}

// ---------------------------------------------------------------- thumb
const cmc = hand.thumb.assumed_cmc,
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
 * `pitch`: not a movement of its own, it comes with the swing. (+q[2] turns
 * the pad away from the palm: the frame is mirrored, so the turn toward it,
 * which comes with flexing and abducting, is subtracted.) Only the change
 * from one swing to another is used, added to a pose's own turn. Crisco et al. 2015 ("The envelope of physiological motion of the
 * first carpometacarpal joint", J Biomech Eng 137(10)) measured it: a swing
 * of θ from neutral turns the thumb θ·sin(ele), where ele follows the swing's
 * direction (azi: 0° adduction, 90° flexion, 180° abduction) as a first-order
 * harmonic of amplitude 36.6°, peaking about +45° (azi 130°, the pad toward
 * the palm as the thumb crosses it) and -30° (azi -45°): 7.5° + 36.6°·cos(azi
 * − 130°), the offset and phase read off those peaks. About 0.6° per degree
 * flexing (sweep), 0.5° abducting, against them extending and adducting. From
 * rest, taken as neutral. */
const twistAt = (yaw: number, pitch: number) => {
  const flex = thumbRest[0] - yaw,
    abd = pitch - thumbRest[1],
    th = Math.hypot(flex, abd);
  if (th < 1e-9) return thumbRest[2];
  const ele = rad(7.5) + rad(36.6) * Math.cos(Math.atan2(flex, -abd) - rad(130));
  return thumbRest[2] - th * Math.sin(ele);
};
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
/** Where the thumb meets a key facing `n` (out of the cap toward the thumb;
 * straight up by default, as the paper was in the photos): the last
 * section's point furthest into it (its flat pad and round edges either side
 * of the bone, its round end). On a key square to the pad that's the print
 * (ip_pad past the IP); the pad is soft, so as the key tilts across the bone
 * where it bears moves to the flat's edge over about 15°, and as it tilts
 * along the bone tip down, to the round end (tip up it stays at the print).
 * `roll`: how far the nail tilts from parallel to the key, + toward the
 * outer edge (away from the index; 0: the key flat on the pad). */
function touch(q: number[], n = Z) {
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
type Mix = number[];
/** The thumb at `q` moved by `by` times `mix`, its turn about the metacarpal
 * coming with the swing (twistAt). */
const moveBy = (q: number[], [r, p, c]: Mix, by = 1) => {
  const y = q[0] + r * by,
    d = q[1] + p * by;
  return [y, d, q[2] + twistAt(y, d) - twistAt(q[0], q[1]), q[3] + c * by, q[4] + c * by];
};
/** The thumb `mm` into a key from `q` (− back off it), moving by `press` (a
 * Mix per mm, keyAt). */
const pressed = (q: number[], mm: number, press: Mix) => moveBy(q, press, mm);
/** A point on the last section at `q`, carried with it to other poses. */
function carry(q: number[], p: T.Vector3) {
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
const arc = hand.thumb.arc_through_prints_1_to_4;
const arcPoint = (a: number) =>
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
const printAngle = (k: string) => {
  const [x, y] = (hand.measured.thumb_prints as Record<string, number[]>)[k];
  return aroundOf({ x, y });
};
/** Where the thumb keys go: on the arc the thumb's pad swept in the photos
 * (thumb.arc_through_prints_1_to_4, the prints at rest, swept in, swept out
 * and pulled back), lowered. */
type ThumbPose = {
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
};
/** How far the thumb's MCP and IP go, degrees: a guess as the fit bounds them (they hyperextend a little). */
const MCP_RANGE = [-15, 90],
  IP_RANGE = [-20, 90];
const clamp = (v: number, [lo, hi]: number[]) => Math.min(hi, Math.max(lo, v));
/** The 1u row of a 1.5u + 2×1u cluster: `gap` mm from the 1.5u, the thumb
 * curled in under the hand (+, bent more) or away. */
type TwoRows = { gap: number };
/** The photos' thumb poses (the assumed CMC's) by their prints' place round
 * the arc, rest and swept in, out and back; between them, interpolated.
 * Swept in, the swing at the CMC carried on up to SWEEP_IN past the print (as
 * between it and rest), the bends held at the print's (there the MCP and IP
 * are as straight as they go): at rest the thumb sits nearly under the
 * index, further in than the print. Pulled back, not past the print: there
 * the metacarpal points across the hand, and further it'd point back past
 * the CMC. Beyond those, held, and `past` says by how much (degrees). */
const PRINT_POSES = ['2', '1', '3', '4']
  .map((k) => ({ a: printAngle(k), q: (cmc.poses as Record<string, number[]>)[k] }))
  .sort((x, y) => x.a - y.a);
const SWEEP_IN = 20,
  AROUND = [PRINT_POSES[0].a - SWEEP_IN, PRINT_POSES[PRINT_POSES.length - 1].a];
function photoPose(a: number) {
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
/** The thumb's pose `a` degrees round the arc (photoPose), bent `bend`
 * degrees more at the MCP and IP alike. Then the CMC swings it across the
 * palm until the key is back `a` degrees round the arc, and abducts it until
 * the key is at height `z` in the hand frame: the abduction lowers the thumb
 * and carries it toward you. Its turn about the metacarpal is the photos',
 * and what comes with the swing (twistAt). `miss`: mm short of `z` within
 * ±40° of abduction, off the arc's place within ±60° of swing, and along the
 * arc past the photos (0: reached). `n`: which way the key faces. */
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
      const zOf = (d: number) => touch(bent(d, y), n).p.z;
      let lo = -40,
        hi = 40;
      if (zOf(lo) < z) hi = lo;
      else if (zOf(hi) > z) lo = hi;
      else
        for (let i = 0; i < 30; i++) {
          const m = (lo + hi) / 2;
          if (zOf(m) > z) lo = m;
          else hi = m;
        }
      return bent((lo + hi) / 2, y);
    },
    aroundAt = (q: number[]) => aroundOf(touch(q, n).p);
  // The key goes round the arc as the thumb swings out: bisect.
  let y0 = -60,
    y1 = 60;
  if (aroundAt(lowered(y0)) > a) y1 = y0;
  else if (aroundAt(lowered(y1)) < a) y0 = y1;
  else
    for (let i = 0; i < 30; i++) {
      const m = (y0 + y1) / 2;
      if (aroundAt(lowered(m)) < a) y0 = m;
      else y1 = m;
    }
  const q = lowered((y0 + y1) / 2),
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
 * point goes as the thumb moves by the reach mix, swinging out), and the
 * press (a Mix per mm into the key). The press is `t.press`'s mix of palmar
 * abduction and curl, less as much of the reach mix as moves the touching
 * point along the reach, so it's square to the reach. The key faces against
 * it, the reach in its plane. Where the thumb touches depends on which way
 * the key faces (touch), so it's settled round by round. `away`: the press
 * moves the thumb off the key it touches (the key would have to be on the
 * thumb's other side). */
function keyAt(q: number[], t: ThumbPose) {
  let n = Z.clone();
  for (let i = 0; ; i++) {
    const k = pressOn(q, t, n),
      next = k.d.clone().normalize().negate(),
      away = next.dot(n) < 0,
      moved = next.angleTo(n);
    if (!away) n = next;
    if (away || moved < 1e-7 || i === 40)
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
    press: k.mix.map((v) => v / Math.max(into, 1e-9)),
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
  let lo = 0,
    hi = 0;
  while (Math.abs(hi) < 90 && off(hi) < 0) [lo, hi] = [hi, hi + sign * 2];
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (off(m) < 0) lo = m;
    else hi = m;
  }
  const s = (lo + hi) / 2;
  return { q: at(s), miss: Math.abs(off(s)) };
}
/** Degrees on its side past which a key meets the back of the thumb. */
const BACK_OF_THUMB = 120;
/** Degrees the MCP or IP is past its range at `q`. */
const pastJoints = (q: number[]) => {
  const past = (v: number, [lo, hi]: number[]) => Math.max(0, lo - v, v - hi);
  return Math.max(past(q[3], MCP_RANGE), past(q[4], IP_RANGE));
};
/** The thumb row in the hand frame, far key first (far = away from the
 * fingers). The home key where the thumb touches it in its pose `t.around`
 * degrees round the photos' arc (the resting position), abducted until the
 * key is `t.drop` mm below `top` (the middle home key's top). The far and
 * near keys `spacing` mm from it, centre to centre, the thumb moved by the
 * reach mix (swinging out or back). On a 1.5u + 2×1u cluster the 1u keys go
 * either side, `spacing` / 2 from their middle, the thumb at the home key's
 * place bent more at the MCP and IP (curling it in under the hand) until
 * their middle is `two.gap` mm from the 1.5u (negative: straightened, the
 * other way). Each key faces against the press, the reach in its plane
 * (keyAt), or the far and near keys as the home key (`t.parallel`). Frames: z out of the cap, x toward the near key. `miss`: mm the
 * thumb falls short of the key. */
function thumbRow(t: ThumbPose, spacing: number, top: number, two?: TwoRows) {
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
    if (moved < 1e-7) break;
  }
  const hp = keyAt(home.q, t).p;
  // Off its place round the arc or its height, if it didn't settle.
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
    let b0 = 0,
      b1 = 0;
    while (Math.abs(b1) < 90 && off(b1) * k < 0) [b0, b1] = [b1, b1 + 5 * k];
    for (let i = 0; i < 25; i++) {
      const m = (b0 + b1) / 2;
      if (off(m) * k < 0) b0 = m;
      else b1 = m;
    }
    const b = (b0 + b1) / 2,
      m = mid(b);
    f = Math.abs(off(b));
    from = { q: m.q, p: touch(m.q, n).p };
    gap = spacing / 2;
  }
  const at = thumbKey(home.q, home.miss, t),
    face = t.parallel ? at : undefined,
    ends = [1, -1].map((k) => thumbAlong(from, k, gap, t, face && ((q) => hinged(q, t, face)))),
    keys = [ends[0], ends[1]].map((k) => thumbKey(k.q, k.miss + f, t, face));
  // `mid`: where the far and near keys are measured from (on 1.5u + 2×1u,
  // their middle).
  return Object.assign([keys[0], at, keys[1]], { mid: from });
}
/** Which way a far or near key at `q` faces, keeping `face`'s y (the home
 * key's): as it would facing its own press (keyAt), tilted across the row
 * back into the plane square to y. */
function hinged(q: number[], t: ThumbPose, face: { frame: T.Matrix4 }) {
  const y = new T.Vector3().setFromMatrixColumn(face.frame, 1),
    n = keyAt(q, t).n;
  return n.addScaledVector(y, -n.dot(y)).normalize();
}
/** The key the thumb touches at `q` (keyAt), square to the sweep: x along
 * it, toward the near key. Or, given the home key (`face`), the key with
 * its y, tilted along the row as near square to its own press as that
 * leaves (hinged, keyFacing). `at`: where the thumb touches the key (its cap
 * top's centre). `slant`: degrees the press is off square to the key. */
function thumbKey(q: number[], miss: number, t: ThumbPose, face?: { frame: T.Matrix4 }) {
  const k = face ? keyFacing(q, t, hinged(q, t, face)) : keyAt(q, t),
    x = k.sweep.clone().negate(),
    y = face && new T.Vector3().setFromMatrixColumn(face.frame, 1),
    m = y
      ? new T.Matrix4().makeBasis(new T.Vector3().crossVectors(y, k.n), y, k.n).setPosition(k.p)
      : new T.Matrix4().makeBasis(x, new T.Vector3().crossVectors(k.n, x), k.n).setPosition(k.p);
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
const EXTRA_LIFT = 15;
/** The two extra thumb keys, if on: under the gaps between the thumb row's
 * keys (x1 between home and near, x2 between far and home), the thumb
 * halfway between the two keys' poses and curled `curl` degrees more at the
 * MCP and IP alike, which brings it in under the hand. Each faces against
 * its press (`press`, as the row's), the row's reach in its plane. */
type Extra = { on: boolean; curl: number; press: number };
const extraKeys = (row: ThumbKey[], t: ThumbPose, { curl, press }: Extra) =>
  [
    [1, 2],
    [0, 1],
  ].map(([a, b]) =>
    thumbKey(
      row[a].q.map((v, j) => (v + row[b].q[j]) / 2 + (j > 2 ? curl : 0)),
      0,
      { ...t, press },
    ),
  );

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
  // Redrawn every frame while the thumb presses, so the old shapes go.
  group.traverse((o) => {
    if (o instanceof T.Mesh || o instanceof T.Line) {
      o.geometry.dispose();
      if (o.material !== skin && o.material !== palmSkin) (o.material as T.Material).dispose();
    }
  });
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
    over = g.key_overrides as Record<string, { offset_mm?: number[]; rotation_deg?: number[] }>;
  g.columns.forEach((col, ci) => {
    const K = keys[col.name];
    col.rotation_deg = [0, 0, Math.round(splay[col.name] * 10) / 10];
    col.offset_mm = [K[1].top.x - (ci - 2) * g.column_pitch_mm, K[1].top.y, 0];
    col.heights_mm = K.map((k, i) => r2(k.top.z - capHeight(c, `matrix_${col.name}_${ROWS[i]}`)));
    const frames = columnFrames(c, ci);
    ROWS.forEach((r, ri) => {
      const name = `matrix_${col.name}_${r}`,
        z = K[ri].normal,
        y = K[ri].up.clone().addScaledVector(z, -K[ri].up.dot(z)).normalize(),
        m = frames[ri]
          .clone()
          .invert()
          .multiply(
            new T.Matrix4()
              .makeBasis(new T.Vector3().crossVectors(y, z), y, z)
              .setPosition(K[ri].top.clone().addScaledVector(z, -capHeight(c, name))),
          ),
        e = new T.Euler().setFromRotationMatrix(m, 'ZYX');
      over[name] = {
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
  placeCluster(c, c.geometry.thumb, tops, 1, (name) => keyTurn(name, two));
}
/** Put cluster `t`'s keys' cap tops on the given frames (layout, in its
 * keys' order), its root on key `root`'s seat. */
function placeCluster(
  c: Config,
  t: Cluster,
  tops: T.Matrix4[],
  root: number,
  turn: (name: string) => number[],
) {
  const seats = tops.map((m, i) =>
      m
        .clone()
        .multiply(new T.Matrix4().makeTranslation(0, 0, -capHeight(c, `thumb_${t.keys[i].name}`))),
    ),
    e = new T.Euler().setFromRotationMatrix(seats[root], 'ZYX');
  t.position_mm = new T.Vector3().setFromMatrixPosition(seats[root]).toArray().map(r2);
  t.rotation_deg = [e.x, e.y, e.z].map((v) => r2(deg(v)));
  t.arc = { ...t.arc, step_deg: 0, well_deg: 0 };
  const inv = frame(t.position_mm, t.rotation_deg).invert();
  (t.keys as { name: string; offset_mm?: number[]; rotation_deg?: number[] }[]).forEach(
    (key, i) => {
      const m = inv
          .clone()
          .multiply(seats[i])
          .multiply(frame([0, 0, 0], turn(key.name!))),
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
  pitch: number;
  bend: number;
  curl: Record<Finger, number>;
  innerGap: number;
  innerAngle: number;
  top: number;
  bottom: number;
  from: string;
  /** mm: how high the wrist is held over the keys: the thumb's CMC above the
   * middle home key's top, square to it. It sets how the fingers reach
   * between rows (mixFor). */
  wristHeight: number;
  pressMix: number;
  thumb: ThumbPose;
  spacing: number;
  cluster: string;
  /** The extra thumb keys (extraKeys); none if not set. */
  extra?: Extra;
  two: TwoRows;
};
/** The hand's turn on the (tented) board. */
const turnOf = (s: Settings) =>
  new T.Matrix4()
    .makeRotationZ(rad(-s.bend))
    .multiply(new T.Matrix4().makeRotationX(rad(-s.pitch)))
    .multiply(new T.Matrix4().makeRotationY(rad(s.roll)));
/** The lowest reach mix (the MCP curling as the PIP straightens). Toward -0.5
 * the two cancel: the fingertip hardly moves along the board, and the path
 * turns straight down or doubles back. */
const MIX_MIN = -0.4,
  /** The highest: the MCP curling 3° per degree at the PIP. */
  MIX_MAX = 3;
/** How high the wrist is held (Settings.wristHeight) at a finger curl and a
 * reach mix (MCP degrees per PIP degree between rows). The reach sets which
 * way the home key faces, and so, with the fingertip on it, how high the hand
 * is over it: the more the MCP curls as the PIP does, the higher (the more
 * it straightens, the lower). */
function wristHeightAt(curl: number, mix: number) {
  const p = rowPose('middle', curl, 0, 0, () => [mix, 1]);
  return C.clone().sub(p.chain.pad).dot(p.n);
}
const mixes = new Map<string, { mix: number; off: number }>();
/** The reach mix that holds the wrist `height` mm up at a finger curl (the
 * middle finger's), by bisection: the height rises with the mix. `off`: how
 * far the height is past what the reach mixes allow (0: none). */
function mixFor(curl: number, height: number) {
  const key = `${curl} ${height}`;
  let r = mixes.get(key);
  if (!r) {
    let lo = MIX_MIN,
      hi = MIX_MAX;
    const low = wristHeightAt(curl, lo),
      high = wristHeightAt(curl, hi);
    if (height <= low) r = { mix: lo, off: height - low };
    else if (height >= high) r = { mix: hi, off: height - high };
    else {
      for (let i = 0; i < 30; i++) {
        const m = (lo + hi) / 2;
        if (wristHeightAt(curl, m) < height) lo = m;
        else hi = m;
      }
      r = { mix: (lo + hi) / 2, off: 0 };
    }
    mixes.set(key, r);
  }
  return r;
}
/** The reach between rows: from the wrist height, or square to the press as set. */
const wayOf =
  (s: Settings): Way =>
  (r) => {
    if (s.from === 'reach') return [mixFor(s.curl.middle, s.wristHeight).mix, 1];
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
  const row = thumbRow(s.thumb, s.spacing, poses.middle[1].chain.pad.z, twoOf(s));
  return {
    poses,
    inner,
    row,
    extra: s.extra?.on ? extraKeys(row, s.thumb, s.extra) : [],
  };
}
type Solved = ReturnType<typeof solveHand>;
/** The thumb's keys by name: the row's, then the extra keys. */
const thumbKeysOf = (h: Solved) => [
  ...h.row.map((k, i) => ({ name: ['far', 'home', 'near'][i], k })),
  ...h.extra.map((k, i) => ({ name: `x${i + 1}`, k })),
];
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
  thumbKeysOf(h).forEach(({ name: n, k }) => {
    const name = `thumb_${n}`;
    out.push({
      name,
      top: k.frame.clone().multiply(frame([0, 0, 0], keyTurn(n, two))),
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
 * keycap clearance, not the per-key overrides, which are the case's bigger room
 * round the 1.5u) against the other at rest. */
function capHits(c: Config, caps: Cap[]) {
  const sw = c.switch,
    rest = caps.map((k) => capBoxes(k, 0)),
    pressed = caps.map((k) => capBoxes(k, sw.keycap_clearance_mm, sw.travel_mm)),
    out: Hit[] = [];
  for (let i = 0; i < caps.length; i++)
    for (let j = i + 1; j < caps.length; j++) {
      const depth = Math.max(overlap(pressed[i], rest[j]), overlap(rest[i], pressed[j]));
      if (depth > 0) out.push({ a: caps[i].name, b: caps[j].name, depth });
    }
  return out;
}
/** A key's tile (the board under its switch, and the parts hanging under
 * the board: hotswap socket, LED, diode) as boxes, `m` the key's frame. */
function tileBoxes(c: Config, m: T.Matrix4): Box[] {
  const t = c.tile,
    under = -(t.plate_top_to_pcb_top_mm + t.size_mm[2]),
    u = [0, 1, 2].map((i) => new T.Vector3().setFromMatrixColumn(m, i).normalize()),
    box = (at: number[], size: number[]) => ({
      c: new T.Vector3(...at).applyMatrix4(m),
      u,
      e: size.map((v) => v / 2),
    });
  return [
    box([0, 0, under + t.size_mm[2] / 2], t.size_mm),
    ...t.components.map((p) => box([p.center_mm[0], p.center_mm[1], under + p.center_mm[2]], p.size_mm)),
  ];
}
/** mm two tiles may overlap: edge to edge, as the layout rounds the keys' places (0.01 mm). */
const TILE_TOUCH = 0.05;
/** The keys' tiles that hit each other (the keys as laid out in `c`). */
function tileHits(c: Config, keys: string[]) {
  const f = componentFrames(c),
    tiles = keys.map((k) => tileBoxes(c, f[k])),
    out: Hit[] = [];
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const depth = overlap(tiles[i], tiles[j]);
      if (depth > TILE_TOUCH) out.push({ a: keys[i], b: keys[j], depth });
    }
  return out;
}
// ---------------------------------------------------------------- the hand against the keyboard
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
      // The last section's two round edges (with the flat between them).
      ...[-1, 1].map(
        (k) =>
          [
            v(th.I).addScaledVector(th.side, k * THUMB_EDGE),
            v(th.end).addScaledVector(th.side, k * THUMB_EDGE),
            THUMB_R,
          ] as [T.Vector3, T.Vector3, number],
      ),
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
    base = c.chassis.skin_mm;
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
  return high - low + base;
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
 * carries the index sideways while the other digits stay on their home keys
 * (so they're checked only at home). Pressing, the thumb's last two bones
 * move with the key (near enough, however it presses). */
function reachHits(c: Config, s: Settings, h: Solved, board: Board) {
  const travel = c.switch.travel_mm,
    way = wayOf(s),
    homes = Object.fromEntries(FINGERS.map((f) => [f, h.poses[f][1]])) as Record<Finger, Pose>,
    mcps = Object.fromEntries(FINGERS.map((f) => [f, homes[f].chain.mcp])) as Record<
      Finger,
      T.Vector3
    >,
    thHome = thumb(h.row[1].q),
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
    /** Every digit resting, and the palm. */
    rest = (during: string) => {
      for (const f of FINGERS) add(fingerPart(f, homes[f], [`matrix_${f}_home`]), during);
      add(thumbPart(thHome, ['thumb_home']), during);
      add(palm(thHome), during);
    },
    /** The reaching digit on the way (`at(t)`, 0 < t < 1, `len` mm in all), then on the key and pressing it. */
    reach = (key: string, len: number, at: (t: number) => Part, onKey: (down: number) => Part) => {
      const n = Math.ceil(len / STEP),
        name = capName(key);
      for (let i = 1; i < n; i++) add(at(i / n), `reaching for ${name}`);
      add(onKey(0), `on ${name}`);
      add(onKey(travel), `pressing ${name}`);
    };
  rest('at home');
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
  // The inner column: the arm carries the index toward it; the other digits stay home.
  ROWS.forEach((r, ri) => {
    const key = `matrix_inner_${r}`,
      dist = r === 'top' ? s.top : r === 'bottom' ? -s.bottom : 0,
      index = (t: number) => h.inner.placeAt(rowPose('index', s.curl.index, 0, dist * t, way), t),
      may = ['matrix_index_home', key],
      len = homes.index.chain.pad.distanceTo(h.poses.inner[ri].chain.pad);
    reach(
      key,
      len,
      (t) => fingerPart('index', index(t), may),
      (down) => fingerPart('index', h.poses.inner[ri], [key], down),
    );
  });
  // The thumb keys: the thumb's joints move evenly from home to the key; to
  // an extra key, off the row and down again on the way (backing off the
  // press, EXTRA_LIFT mm halfway), as it moves over the row.
  thumbKeysOf(h).forEach(({ name, k }) => {
    const key = `thumb_${name}`,
      lift = name.startsWith('x') ? EXTRA_LIFT : 0,
      qs = (t: number) =>
        pressed(
          h.row[1].q.map((v, j) => v + (k.q[j] - v) * t),
          -lift * Math.sin(Math.PI * t),
          h.row[1].press.map((v, j) => v + (k.press[j] - v) * t),
        );
    reach(
      key,
      k.at.distanceTo(h.row[1].at),
      (t) => {
        const th = thumb(qs(t));
        add(palm(th), `while the thumb reaches for ${capName(key)}`);
        return thumbPart(th, ['thumb_home', key]);
      },
      (down) => {
        const th = thumb(pressed(k.q, down, k.press));
        if (!down) add(palm(th), `while the thumb is on ${capName(key)}`);
        return thumbPart(th, [key]);
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
  built?: { mesh: MeshData; toHand: T.Matrix4 },
) {
  const two = !!twoOf(s),
    caps = capsOf(c, h, two),
    thumbs = thumbKeysOf(h).map(({ name, k }) => ({ key: `thumb ${name}`, k }));
  return {
    h,
    caps,
    capHits: capHits(c, caps),
    tileHits: tileHits(
      c,
      caps.map((k) => k.name),
    ),
    handHits: reachHits(c, s, h, {
      caps,
      tris: built ? trisOf(built.mesh, built.toHand) : [],
    }),
    frameChecked: !!built,
    short: [
      ...FINGERS.flatMap((f) => ROWS.map((r, ri) => [`${f} ${r}`, h.poses[f][ri].short] as const)),
      ...thumbs.map(({ key, k }) => [key, k.miss] as const),
    ].filter(([, m]) => m > 0.5),
    /** Thumb keys where the MCP or IP goes past its range (degrees), on the
     * key or pressing it to the bottom. */
    pastJoints: thumbs
      .map(({ key, k }) => ({
        key,
        past: Math.max(pastJoints(k.q), pastJoints(pressed(k.q, c.switch.travel_mm, k.press))),
      }))
      .filter((x) => x.past > 0.5),
    /** Thumb keys met with the back of the thumb: on its side past
     * BACK_OF_THUMB (in the photos it lay at about 100–107° on the paper). */
    backOfThumb: thumbs.flatMap(({ key, k }) =>
      Math.abs(k.roll) > BACK_OF_THUMB ? [{ key, roll: Math.abs(k.roll) }] : [],
    ),
    /** Thumb keys the press moves the thumb off. */
    pressAway: thumbs.flatMap(({ key, k }) => (k.away ? [key] : [])),
    /** The arm can't carry the hand far enough sideways for the inner column. */
    innerShort: h.inner.limited,
    /** mm the wrist height is past what any reach gives at this curl. */
    wristOff: s.from === 'reach' ? mixFor(s.curl.middle, s.wristHeight).off : 0,
    height: heightOf(c, caps, deskOf(s)),
  };
}

// ---------------------------------------------------------------- presets
/** Near the Dactyl Manuform (DM_right), at a reach seen on it: rows reached
 * with the MCP bending as the finger straightens, -0.1° per PIP degree,
 * which holds the wrist 56.0 mm up (the thumb's CMC over the middle home
 * key). Tented 15° like the Dactyl. The finger curl, the hand's pitch on the
 * board, the thumb keys' place round the arc, drop and spacing and the gaps
 * fitted together: of the valid layouts (the printed frame's faults
 * counted), the one whose keys (cap tops and facings; the thumb's by place
 * only) are closest to the Dactyl's, where no half step in any one of them
 * is closer and valid (a test, in tests/hand.test.ts). The rows come out
 * closer than tuned by eye on the printed frame (14.7 mm, was 17.7). The
 * thumb home key 124° round the arc (rest is 112°, swept out 140°), 13 mm
 * below the home row, the keys 24.5 mm apart. The reach and press as in
 * Natural. The thumb keys sit 5–24 mm from the Dactyl's, facing 50–58° off:
 * the Dactyl's face you. Valid with the 1×3
 * cluster, the printed frame too. */
const DACTYL: Settings = {
  tent: 15,
  roll: 0,
  pitch: 5.5,
  bend: 0,
  curl: { index: 10.5, middle: 10.5, ring: 10.5, pinky: 10.5 },
  innerGap: 19,
  innerAngle: 0,
  top: 14.7,
  bottom: 14.7,
  from: 'reach',
  wristHeight: 56.0,
  pressMix: 1.4,
  thumb: {
    around: 124,
    drop: 13,
    reach: { palmar: -0.3, curl: 0.3 },
    press: -45,
    parallel: false,
  },
  spacing: 24.5,
  cluster: '1×3',
  // The 1u row a key's depth inside the 1.5u, the thumb curled in under the
  // hand.
  two: { gap: 19.5 },
};
/** As close to the resting hand as a valid layout allows: the least change
 * from rest (degrees, the hand on the board counted too), every gap as small
 * as the keycaps allow, over layouts where no keycap hits another (pressed
 * against one at rest), the hand passes through no key, every row is in reach
 * and the board fits the 66 mm keyboard tray. It comes out nearly at rest:
 * the fingers as measured, the board tented 1° (the steep top rows of an
 * uncurled hand use up the tray). Fitted to the measured keycaps (18.5 mm,
 * tapering to 14, 11 high): 65 mm tall. Fitted before the check followed the
 * hand reaching each key, and valid under it. (On its
 * printed frame the index brushed the thumb cluster, which the model doesn't
 * reproduce.) The wrist 112.7 mm up, the reach as before the thumb's CMC was
 * refitted (mix 0.40). The thumb as at rest in the photos: the home key at
 * the rest print's place round the arc (112°), level with the home row, the
 * keys as close as that allows (23 mm: closer, the home and near keycaps
 * hit). The reach swings the thumb out with a little lowering and curl (per
 * degree, -0.3° of palmar abduction and 0.3° of curl: the photos' sweep had
 * nearly 1° of curl, which straightens the thumb past its joints toward the
 * near key); the press is palmar abduction and straightening alike (-45°),
 * which leaves the keys facing nearly up. The inner column 19.3 mm from the
 * index (was 18.8, as close as the keycaps allow), so the keys' tiles clear. */
const NATURAL: Settings = {
  tent: 1,
  roll: 0,
  pitch: 0,
  bend: 0,
  curl: { index: 0, middle: 0, ring: 0, pinky: 0 },
  innerGap: 19.3,
  innerAngle: 0,
  top: 19.1,
  bottom: 19.1,
  from: 'reach',
  wristHeight: 112.7,
  pressMix: 1.4,
  thumb: { around: 112, drop: 0, reach: { palmar: -0.3, curl: 0.3 }, press: -45 },
  spacing: 23,
  cluster: '1×3',
  two: { gap: 19.5 },
};
/** Set by hand in the editor from the Dactyl fit (saved 16 Oct 2026), the
 * thumb's settings then refitted to keep its keys where they were (within
 * 1.3–4.8 mm, facing 14–16° off) once the keys touched the thumb where it
 * reaches them first (the tip, where it points into them): the rows and inner
 * column a little further out than the Dactyl fit, the home key 116.5° round
 * the arc, the reach lowering and curling the thumb as it swings out, the
 * press mostly palmar abduction. Then, once the keys' tiles were checked
 * (the far and home tiles overlapped 1.9 mm), the home key 17 mm below the
 * home row (was 14.5). Then the far and near keys with the home key's y,
 * tilted along the row toward their press (17° and 14° from the home key),
 * the press back to -3° and the keys 26.5 mm apart (closer, their tiles
 * meet): the far key pressed 16° off square, the near 2°. (Each facing its
 * own press, the keys had to be 27.8 mm apart and the press -9°; all three
 * facing alike, 20.5 mm apart, the far key pressed 17° off square and the
 * near 10°.) */
const YOURS: Settings = {
  tent: 15,
  roll: 0,
  pitch: 5,
  bend: 0,
  curl: { index: 10.5, middle: 10.5, ring: 10.5, pinky: 10.5 },
  innerGap: 19.9,
  innerAngle: 0,
  top: 15.6,
  bottom: 15.6,
  from: 'reach',
  wristHeight: 56,
  pressMix: 1.4,
  thumb: {
    around: 116.5,
    drop: 17,
    reach: { palmar: 0.5, curl: 0.55 },
    press: -3,
    parallel: true,
  },
  spacing: 26.5,
  cluster: '1×3',
  two: { gap: 19.5 },
};
/** Yours with the thumb's keys near its (within 2.6–5.1 mm of where they
 * were before Yours was refitted for the tiles, facing 15–26° off), reached
 * without curling: the reach lowers the thumb as it swings out, so the thumb
 * keeps its resting bend (MCP 21°, IP 18°) on every key and presses each
 * with the pad (on Yours the far key is pressed with the tip, the thumb bent
 * 39° / 36° and on its side 76°). The press palmar abduction with a little
 * straightening (-20°). The far and near keys with the home key's y, tilted
 * along the row toward their press (14° and 8° from the home key), 25 mm
 * apart (closer, the far and home keys' tiles meet): the far key pressed 8°
 * off square, the near square (each facing its own press, they had to be
 * 29.5 mm apart; all three facing alike, 20.5 mm apart, 12° and 7° off). */
const NO_CURL: Settings = {
  ...structuredClone(YOURS),
  thumb: { around: 116, drop: 16, reach: { palmar: 1.1, curl: 0 }, press: -20, parallel: true },
  spacing: 25,
};
/** Everything the panel sets: the layout's settings, what the hand is shown
 * doing and which parts of the panel are open. One state, kept in the project
 * (so Undo, the autosave and Save project carry all of it), the keys always
 * laid out from it. */
type HandState = Settings & {
  extra: Extra;
  /** The row the fingers are shown on. */
  row: Row;
  /** The key the thumb is shown on ('rest': none). */
  thumbOn: string;
  /** Whether the thumb is shown pressing its key, over and over. */
  pressing: boolean;
  /** What the rotation handle turns ('off': none). */
  handle: string;
  advanced: boolean;
  /** Whether the test frame is shown. */
  frameOn: boolean;
  buildCase: boolean;
};
const START: HandState = {
  ...structuredClone(DACTYL),
  extra: { on: false, curl: 45, press: -25 },
  row: 'home',
  thumbOn: 'home',
  pressing: false,
  handle: 'hand',
  advanced: false,
  frameOn: false,
  buildCase: false,
};
/** The values each text setting takes. */
const CHOICES: Record<string, readonly string[]> = {
  row: ROWS,
  thumbOn: ['rest', 'far', 'home', 'near', 'x1', 'x2'],
  from: ['reach', 'press'],
  cluster: ['1×3', '1.5u + 2×1u'],
  handle: ['hand', 'off'],
};
/** A saved state (a project's, or pasted) on top of the start: each setting
 * it has of the same type (a number a finite one, a text one of its choices);
 * anything else (renamed since, say) starts over. */
function stateOf(v: unknown): HandState {
  const fill = (to: Record<string, unknown>, from: unknown) => {
    if (!from || typeof from !== 'object') return;
    for (const [k, x] of Object.entries(from)) {
      const d = to[k];
      if (d && typeof d === 'object') fill(d as Record<string, unknown>, x);
      else if (
        k in to &&
        typeof x === typeof d &&
        (typeof x !== 'number' || Number.isFinite(x)) &&
        (typeof x !== 'string' || !CHOICES[k] || CHOICES[k].includes(x))
      )
        to[k] = x;
    }
  };
  const s = structuredClone(START);
  fill(s, v);
  return s;
}
const TRAY = 66;
/** Why a checked layout isn't valid, as the readout says it (none: valid). */
const problems = (r: ReturnType<typeof check>) => [
  ...r.capHits.map((x) => `${capName(x.a)} hits ${capName(x.b)} (${x.depth.toFixed(1)} mm)`),
  ...r.tileHits.map(
    (x) => `${capName(x.a)}'s tile hits ${capName(x.b)}'s (${x.depth.toFixed(1)} mm)`,
  ),
  ...r.handHits.map((x) => `${x.a} ${x.during}: into ${x.b} (${x.depth.toFixed(1)} mm)`),
  ...r.short.map(([k, m]) => `${k} out of reach (${m.toFixed(0)} mm)`),
  ...r.pressAway.map((k) => `pressing ${k}, the thumb moves off it`),
  ...r.backOfThumb.map(
    (x) => `${x.key} meets the back of the thumb (on its side by ${x.roll.toFixed(0)}°)`,
  ),
  ...r.pastJoints.map(
    (x) => `${x.key}: the thumb's MCP or IP ${x.past.toFixed(0)}° past its range`,
  ),
  ...(r.innerShort ? ['inner column out of reach'] : []),
  ...(Math.abs(r.wristOff) > 0.5
    ? [
        `wrist ${Math.abs(r.wristOff).toFixed(0)} mm too ${r.wristOff > 0 ? 'high' : 'low'} for this curl`,
      ]
    : []),
  ...(r.height > TRAY ? [`${r.height.toFixed(1)} mm tall (tray ${TRAY} mm)`] : []),
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
  return V([0, 0, capHeight(c0, 'matrix_middle_home')]).applyMatrix4(
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
  const { poses, row, extra } = solveHand(s),
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
  // The extra keys where the hand puts them, else where they were by default.
  const g = c.geometry as { thumb_extra?: Cluster },
    d = (defaults.config.geometry as { thumb_extra?: Cluster }).thumb_extra;
  if (extra.length && g.thumb_extra)
    placeCluster(
      c,
      g.thumb_extra,
      extra.map((k) => L.clone().multiply(k.frame)),
      0,
      () => [0, 0, 0],
    );
  else if (d) g.thumb_extra = structuredClone(d);
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
    /** The state (layout() puts it in the project). */
    s = () => host.project().hand as HandState,
    // The middle home key's top, where the hand's middle fingertip rests.
    anchor = anchorOf(defaults.config);
  /** Every key from the state, whatever changed the project (a control,
   * Undo, an opened file): in ?hand the keys are the hand's. */
  function layout() {
    const p = host.project();
    p.hand = stateOf(p.hand);
    applyHand(p.config, s(), anchor);
  }
  layout();
  // The frame is part of the keyboard the hand is checked against, so it's
  // built with every change once the kernel is here.
  let wasm: ManifoldToplevel | undefined;

  const toLayout = () => layoutOf(anchor, s());

  // The rotation handle, on the middle home key, turns the hand on the
  // board (roll, pitch, bend; the tent stays).
  const pivot = new T.Object3D(),
    gizmo = new TransformControls(host.camera, host.dom);
  gizmo.setMode('rotate');
  gizmo.setSpace('world');
  gizmo.setSize(0.6);
  host.scene.add(pivot, gizmo.getHelper());
  gizmo.addEventListener('change', () => host.render());
  gizmo.addEventListener('dragging-changed', (e) => {
    host.orbit.enabled = !e.value;
    touched = false;
  });
  const rotation = (m: T.Matrix4) => new T.Matrix4().extractRotation(m);
  gizmo.addEventListener('objectChange', () => {
    const R = new T.Matrix4().makeRotationFromQuaternion(pivot.quaternion),
      tent = rotation(tentFrame(cfg()));
    // turnOf: Rz(−bend) Rx(−pitch) Ry(roll).
    const [x, y, z] = nearest(
      new T.Euler().setFromRotationMatrix(tent.invert().multiply(R), 'ZXY'),
      [-s().pitch, s().roll, -s().bend],
    );
    edit((s) => Object.assign(s, { pitch: -x, roll: y, bend: -z }));
    touched = true;
  });
  function placeHandle(c: Config) {
    if (s().handle === 'off') {
      gizmo.detach();
      return;
    }
    if (gizmo.dragging) return;
    gizmo.attach(pivot);
    const m = tentFrame(c).multiply(new T.Matrix4().makeTranslation(anchor)).multiply(turnOf(s()));
    m.decompose(pivot.position, pivot.quaternion, pivot.scale);
    pivot.updateMatrixWorld();
  }

  // The thumb pressing its key, over and over: its last 15 mm onto the key,
  // swinging at the CMC, then back.
  const APPROACH = 15,
    PERIOD = 3000;
  let frames: ReturnType<typeof thumb>[] = [],
    pressFingers: Record<Finger, Chain> | undefined,
    pressLoop = 0;
  function showPress(chains: Record<Finger, Chain>, q: number[], press: Mix) {
    cancelAnimationFrame(pressLoop);
    frames = [];
    if (!s().pressing || s().thumbOn === 'rest') return;
    pressFingers = chains;
    // 61 poses, 15 mm off the key to on it.
    for (let i = 0; i <= 60; i++) frames.push(thumb(pressed(q, -APPROACH * (1 - i / 60), press)));
    const tick = (now: number) => {
      // Down, a pause on the key, up, a pause off it.
      const u = (now % PERIOD) / PERIOD,
        v = u < 0.4 ? u / 0.4 : u < 0.5 ? 1 : u < 0.9 ? (0.9 - u) / 0.4 : 0,
        ease = (1 - Math.cos(Math.PI * v)) / 2;
      drawHand(handGroup, pressFingers!, frames[Math.round(ease * 60)]);
      host.render();
      pressLoop = requestAnimationFrame(tick);
    };
    pressLoop = requestAnimationFrame(tick);
  }

  const note = document.createElement('div');
  note.id = 'hand-note';
  function update() {
    shows.forEach((f) => f());
    advanced.hidden = !s().advanced;
    try {
      draw();
    } catch (e) {
      note.innerHTML = `<div style="color:#ff9a8a">Couldn't check: ${e instanceof Error ? e.message : e}</div>`;
      throw e;
    }
  }
  function draw() {
    const c = cfg(),
      built = wasm && buildFrame(wasm, c, s().extra.on),
      r = check(
        c,
        s(),
        undefined,
        built && { mesh: built.mesh, toHand: worldOf(c, anchor, s()).invert() },
      ),
      { poses } = r.h,
      ri = ROWS.indexOf(s().row),
      L = toLayout(),
      keys = thumbKeysOf(r.h),
      on = keys.find((x) => x.name === s().thumbOn)?.k,
      q = on ? on.q : thumbRest;
    const shown = Object.fromEntries(FINGERS.map((f) => [f, poses[f][ri].chain])) as Record<
      Finger,
      Chain
    >;
    drawHand(handGroup, shown, thumb(q));
    if (on) showPress(shown, q, on.press);
    else cancelAnimationFrame(pressLoop);
    handGroup.matrix.copy(L);
    group.matrix.copy(tentFrame(c));
    group.matrixWorldNeedsUpdate = true;
    placeHandle(c);
    const wrong = problems(r);
    note.innerHTML = wrong.length
      ? `<div style="color:#ff9a8a">Not valid:<ul style="margin:2px 0;padding-left:18px">${wrong.map((w) => `<li>${w}</li>`).join('')}</ul></div>`
      : r.frameChecked
        ? `<div style="color:#9be39b">Valid (${r.height.toFixed(0)} mm tall).</div>`
        : 'Checking…';
    // How far the thumb rolls onto its outer edge to meet each key (0: the
    // middle of the pad; 90: the side of the thumb).
    note.insertAdjacentHTML(
      'beforeend',
      `<div>Thumb keys round the arc: ${keys.map(({ name, k }) => `${name} ${k.around.toFixed(0)}°`).join(', ')} (the photos ${PRINT_POSES[0].a.toFixed(0)}–${PRINT_POSES[PRINT_POSES.length - 1].a.toFixed(0)}°). Bent at the MCP / IP: ${keys.map(({ k }) => `${k.q[3].toFixed(0)}° / ${k.q[4].toFixed(0)}°`).join(', ')} (at rest ${thumbRest[3].toFixed(0)}° / ${thumbRest[4].toFixed(0)}°). On its side by ${keys.map(({ k }) => `${k.roll.toFixed(0)}°`).join(', ')} (0: the pad flat on the key, 90: the nail upright). Pressed off square by ${keys.map(({ k }) => `${k.slant.toFixed(0)}°`).join(', ')}. Pressing 1 mm, radial abduction / palmar abduction / curl: ${keys.map(({ k }) => k.press.map((v) => `${v.toFixed(1)}°`).join(' / ')).join(', ')}.</div>`,
    );
    if (s().from === 'reach')
      note.insertAdjacentHTML(
        'beforeend',
        `<div>Between rows the MCP bends ${mixFor(s().curl.middle, s().wristHeight).mix.toFixed(2)}° per PIP degree (the reach mix).</div>`,
      );
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
    /** Whether a drag (a slider's, the handle's) has taken its Undo step. */
    touched = false;
  /** Change the state, one Undo step (a drag is one). */
  const edit = (f: (s: HandState) => void) => {
    if (!touched) host.snapshot();
    f(s());
    host.edited(); // → layout(), the editor's redraw, update()
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
      edit(() => set(scale.at(+i.value)));
      touched = true;
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
    /** What each option is called, where not its value. */
    names: Record<string, string> = {},
  ) {
    d.style.margin = '4px 0';
    d.innerHTML =
      label +
      ' ' +
      options
        .map(
          (v) =>
            `<label style="display:inline;margin-right:6px"><input type="radio" value="${v}" ${v === get() ? 'checked' : ''}>${names[v] ?? v}</label>`,
        )
        .join('');
    d.addEventListener('change', (e) => edit(() => set((e.target as HTMLInputElement).value)));
    shows.push(() => d.querySelectorAll('input').forEach((x) => (x.checked = x.value === get())));
    if (!d.parentNode) box.append(d);
    return d;
  }
  function checkbox(label: string, get: () => boolean, set: (v: boolean) => void) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox"> ${label}`;
    l.style.display = 'block';
    const i = l.querySelector('input')!;
    i.addEventListener('change', () => edit(() => set(i.checked)));
    shows.push(() => (i.checked = get()));
    box.append(l);
    return l;
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
  for (const [name, p, title] of [
    [
      'Dactyl fit',
      DACTYL,
      "Near the Dactyl Manuform, at a reach seen on it (the wrist 56.0 mm up): the finger curl, pitch, thumb keys' place on the arc and gaps whose keys come closest to its keys.",
    ],
    [
      'Natural',
      NATURAL,
      'The least change from your resting hand (fitted under an earlier check).',
    ],
    ['Yours', YOURS, 'Set by hand in the editor from the Dactyl fit (16 Oct).'],
    [
      'No curl',
      NO_CURL,
      'Yours with the thumb keys nearly where they were, the thumb reaching and pressing them without curling (pressing each with the pad).',
    ],
  ] as const) {
    const b = document.createElement('button');
    b.textContent = name;
    b.title = title;
    // Every layout setting, keeping how rows are reached and the cluster.
    b.addEventListener('click', () =>
      edit((s) => Object.assign(s, structuredClone(p), { from: s.from, cluster: s.cluster })),
    );
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
    await navigator.clipboard.writeText(JSON.stringify(s()));
    copy.textContent = 'Copied';
    setTimeout(() => (copy.textContent = 'Copy settings'), 1500);
  });
  paste.textContent = 'Paste settings';
  paste.addEventListener('click', () => {
    const j = prompt('Paste the settings (JSON):');
    if (!j) return;
    let v: unknown;
    try {
      v = JSON.parse(j);
    } catch (e) {
      alert('Not settings: ' + String(e));
      return;
    }
    edit((s) => Object.assign(s, stateOf(v)));
  });
  share.append(copy, paste);
  basic.append(share);
  radios(
    'Fingers on',
    [...CHOICES.row],
    () => s().row,
    (v) => (s().row = v as Row),
  );
  radios(
    'Thumb on',
    [...CHOICES.thumbOn],
    () => s().thumbOn,
    (v) => (s().thumbOn = v),
  );
  checkbox(
    'Show the thumb pressing it (its last 15 mm onto the key)',
    () => s().pressing,
    (v) => (s().pressing = v),
  );

  radios(
    'Rotation handle:',
    [...CHOICES.handle],
    () => s().handle,
    (v) => (s().handle = v),
  );
  heading('Basic');
  together(
    'finger curl (°, + curled)',
    FINGERS.map((f) => [() => s().curl[f], (v: number) => (s().curl[f] = v), -30, 40]),
    -30,
    40,
    1,
  );
  slider(
    "wrist height (mm, the thumb's CMC above the home row)",
    () => s().wristHeight,
    (v) => (s().wristHeight = v),
    -30,
    130,
    0.5,
    () => s().from === 'reach',
  );
  together(
    'key spacing (mm, every gap)',
    [
      [() => s().top, (v) => (s().top = v), 5, 35],
      [() => s().bottom, (v) => (s().bottom = v), 5, 35],
      [() => s().innerGap, (v) => (s().innerGap = v), 18, 30],
      [() => s().spacing, (v) => (s().spacing = v), 17, 40],
    ],
    12,
    30,
    0.5,
  );
  slider(
    'thumb keys round the arc (°, + away from the fingers; rest 112, swept in 92)',
    () => s().thumb.around,
    (v) => (s().thumb.around = v),
    70,
    180,
  );
  slider(
    'thumb keys below the home row (mm)',
    () => s().thumb.drop,
    (v) => (s().thumb.drop = v),
    -20,
    50,
    0.5,
  );
  slider(
    'thumb reach: palmar abduction per degree of radial abduction (+ lowers it swinging out)',
    () => s().thumb.reach.palmar,
    (v) => (s().thumb.reach.palmar = v),
    -2,
    2,
    0.05,
  );
  slider(
    'thumb reach: curl per degree of radial abduction',
    () => s().thumb.reach.curl,
    (v) => (s().thumb.reach.curl = v),
    -2,
    2,
    0.05,
  );
  slider(
    'thumb press: from palmar abduction (0°) toward curling (90°; − straightening)',
    () => s().thumb.press,
    (v) => (s().thumb.press = v),
    -90,
    90,
  );
  checkbox(
    "Far and near thumb keys' edges parallel to the home key's (tilted only along the row)",
    () => !!s().thumb.parallel,
    (v) => (s().thumb.parallel = v),
  );
  radios(
    'Thumb keys',
    [...CHOICES.cluster],
    () => s().cluster,
    (v) => (s().cluster = v),
  );
  checkbox(
    'Extra thumb keys x1, x2: under the gaps, the thumb curled more',
    () => s().extra.on,
    (v) => (s().extra.on = v),
  );
  slider(
    'extra thumb keys: curl (° more at the MCP and IP)',
    () => s().extra.curl,
    (v) => (s().extra.curl = v),
    0,
    90,
    1,
    () => s().extra.on,
  );
  slider(
    'extra thumb keys: press (as the thumb press)',
    () => s().extra.press,
    (v) => (s().extra.press = v),
    -90,
    90,
    1,
    () => s().extra.on,
  );
  checkbox(
    'Advanced settings',
    () => s().advanced,
    (v) => (s().advanced = v),
  );
  checkbox(
    'Build the case (often fails)',
    () => s().buildCase,
    (v) => (s().buildCase = v),
  );

  // The test frame (hand-frame.ts): switch holes on pillars, to print and try.
  checkbox(
    'Test frame (print this way up, with supports)',
    () => s().frameOn,
    (v) => (s().frameOn = v),
  );
  const frameBox = document.createElement('div');
  frameBox.innerHTML =
    '<button>Right STL</button><button>Left STL</button><div style="font-size:13px"></div>';
  const [rightStl, leftStl] = frameBox.querySelectorAll('button'),
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
    const on = s().frameOn;
    frameView.visible = on && !!r;
    rightStl.disabled = leftStl.disabled = !on || !r;
    if (!on || !r) {
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
      (wrong.length ? `<div style="color:#ff9a8a">${wrong.join('<br>')}</div>` : '') +
      (r.warnings.length ? `<div style="color:#e8c46a">${r.warnings.join('<br>')}</div>` : '');
    host.render();
  }
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
    () => s().tent,
    (v) => (s().tent = v),
    0,
    45,
  );
  slider(
    'roll: + pinky side down',
    () => s().roll,
    (v) => (s().roll = v),
    -30,
    30,
  );
  slider(
    'pitch: + far edge down',
    () => s().pitch,
    (v) => (s().pitch = v),
    -25,
    25,
  );
  slider(
    'wrist bend: + toward the pinky',
    () => s().bend,
    (v) => (s().bend = v),
    -25,
    25,
  );
  heading('Curl at home (°, + curled)');
  for (const f of FINGERS)
    slider(
      f,
      () => s().curl[f],
      (v) => (s().curl[f] = v),
      -30,
      40,
    );
  slider(
    'inner column gap (mm)',
    () => s().innerGap,
    (v) => (s().innerGap = v),
    18,
    30,
    0.5,
  );
  slider(
    'inner column angle (°, + to thumb)',
    () => s().innerAngle,
    (v) => (s().innerAngle = v),
    -10,
    30,
  );
  heading('Rows (mm from home)');
  const fromBox = document.createElement('div');
  box.append(fromBox);
  slider(
    'press mix: PIP+DIP° per MCP°',
    () => s().pressMix,
    (v) => (s().pressMix = v),
    -1,
    4,
    0.1,
    () => s().from === 'press',
  );
  radios(
    'Rows reached from the',
    [...CHOICES.from],
    () => s().from,
    (v) => (s().from = v),
    fromBox,
    { reach: 'wrist height', press: 'press mix' },
  );
  slider(
    'top: forward',
    () => s().top,
    (v) => (s().top = v),
    5,
    35,
  );
  slider(
    'bottom: back',
    () => s().bottom,
    (v) => (s().bottom = v),
    5,
    35,
  );
  heading('Thumb');
  slider(
    'key spacing (mm)',
    () => s().spacing,
    (v) => (s().spacing = v),
    17,
    40,
    0.5,
  );
  slider(
    '1u row gap (mm, + toward the palm)',
    () => s().two.gap,
    (v) => (s().two.gap = v),
    -35,
    35,
    0.5,
    () => s().cluster !== '1×3',
  );

  void manifold().then((w) => {
    wasm = w;
    update();
  });
  return { layout, update, buildCase: () => s().buildCase };
}

/** Internals for the tests and the fingerprint. */
export const _test = {
  T,
  thumb,
  pressed,
  moveBy,
  thumbRow,
  BACK_OF_THUMB,
  twistAt,
  photoPose,
  C,
  cmcPoses: cmc.poses,
  prints: hand.measured.thumb_prints,
  THUMB_R,
  THUMB_EDGE,
  solveHand,
  capsOf,
  check,
  partHits,
  anchorOf,
  applyHand,
  worldOf,
  trisOf,
  TRAY,
  rowPose,
  wayOf,
  turnOf,
  NATURAL,
  DACTYL,
  YOURS,
  NO_CURL,
  MIX_MIN,
  wristHeightAt,
  mixFor,
  problems,
  stateOf,
  START,
};
