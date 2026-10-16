// The ?hand layout: Settings and the presets, solving the hand's poses from them,
// and writing the keys they give into a config.
import * as T from 'three';
import {
  columnFrames,
  defaults,
  frame,
  ROWS,
  tentFrame,
  type Cluster,
  type Config,
  type Pose as KeyOverride,
} from '../geometry';
import { bisect } from './solve';
import {
  C,
  type Extra,
  FINGERS,
  type Finger,
  type Pose,
  type Row,
  type ThumbPose,
  type TwoRows,
  V,
  type Way,
  capHeight,
  deg,
  extraKeys,
  innerColumn,
  rad,
  rowPose,
  thumbRow,
} from './model';

type KeyTop = { top: T.Vector3; normal: T.Vector3; up: T.Vector3 };
/** Put each finger key's cap-top centre at the given layout point, facing
 * `normal`, its y up the column (`up`, square to the normal, as the checks
 * have it). The column takes the home key's place and splay; each key's own
 * offset and tilt go in key_overrides. */
function placeColumns(c: Config, keys: Record<string, KeyTop[]>, splay: Record<string, number>) {
  const g = c.geometry,
    over = g.key_overrides as Record<string, KeyOverride>;
  g.columns.forEach((col, ci) => {
    const K = keys[col.name];
    col.rotation_deg = [0, 0, Math.round(splay[col.name] * 10) / 10];
    col.offset_mm = [K[1].top.x - (ci - 2) * g.column_pitch_mm, K[1].top.y, 0];
    col.heights_mm = K.map((k, i) => r2(k.top.z - capHeight(c, `matrix_${col.name}_${ROWS[i]}`)));
    const frames = columnFrames(c, ci);
    ROWS.forEach((r, ri) => {
      const name = `matrix_${col.name}_${r}`,
        z = K[ri].normal,
        m = frames[ri]
          .clone()
          .invert()
          .multiply(
            capFrame(K[ri].top.clone().addScaledVector(z, -capHeight(c, name)), z, K[ri].up),
          );
      over[name] = { offset_mm: positionOf(m), rotation_deg: eulerDeg(m) };
    });
  });
}
// chassis.json turns the home key a quarter turn in its place; keep that in
// the 1×3. In the 1.5u + 2×1u cluster the 1.5u lies along the row.
export const keyTurn = (name: string, two: boolean) =>
  name === 'home' && !two ? [0, 0, -90] : [0, 0, 0];
const r2 = (v: number) => Math.round(v * 100) / 100;
const positionOf = (m: T.Matrix4) => new T.Vector3().setFromMatrixPosition(m).toArray().map(r2);
/** The matrix's rotation as ZYX Euler angles in degrees, rounded as the config stores them. */
const eulerDeg = (m: T.Matrix4) => {
  const e = new T.Euler().setFromRotationMatrix(m, 'ZYX');
  return [e.x, e.y, e.z].map((v) => r2(deg(v)));
};
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
  );
  t.position_mm = positionOf(seats[root]);
  t.rotation_deg = eulerDeg(seats[root]);
  t.arc = { ...t.arc, step_deg: 0, well_deg: 0 };
  const inv = frame(t.position_mm, t.rotation_deg).invert();
  t.keys.forEach((key, i) => {
    const m = inv
      .clone()
      .multiply(seats[i])
      .multiply(frame([0, 0, 0], turn(key.name!)));
    key.offset_mm = positionOf(m);
    key.rotation_deg = eulerDeg(m);
  });
}

// ---------------------------------------------------------------- the layout from the settings
export type Settings = {
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
export const turnOf = (s: Settings) =>
  new T.Matrix4()
    .makeRotationZ(rad(-s.bend))
    .multiply(new T.Matrix4().makeRotationX(rad(-s.pitch)))
    .multiply(new T.Matrix4().makeRotationY(rad(s.roll)));
/** The lowest reach mix (the MCP curling as the PIP straightens). Toward -0.5
 * the two cancel: the fingertip hardly moves along the board, and the path
 * turns straight down or doubles back. */
export const MIX_MIN = -0.4,
  /** The highest: the MCP curling 3° per degree at the PIP. */
  MIX_MAX = 3;
/** How high the wrist is held (Settings.wristHeight) at a finger curl and a
 * reach mix (MCP degrees per PIP degree between rows). The reach sets which
 * way the home key faces, and so, with the fingertip on it, how high the hand
 * is over it: the more the MCP curls as the PIP does, the higher (the more
 * it straightens, the lower). */
export function wristHeightAt(curl: number, mix: number) {
  const p = rowPose('middle', curl, 0, 0, () => [mix, 1]);
  return C.clone().sub(p.chain.pad).dot(p.n);
}
const mixes = new Map<string, { mix: number; off: number }>();
/** The reach mix that holds the wrist `height` mm up at a finger curl (the
 * middle finger's), by bisection: the height rises with the mix. `off`: how
 * far the height is past what the reach mixes allow (0: none). */
export function mixFor(curl: number, height: number) {
  const key = `${curl} ${height}`;
  let r = mixes.get(key);
  if (!r) {
    const at = (m: number) => wristHeightAt(curl, m),
      { x, clamped } = bisect(at, height, MIX_MIN, MIX_MAX, 30);
    r = { mix: x, off: clamped ? height - at(x) : 0 };
    mixes.set(key, r);
  }
  return r;
}
/** The reach between rows: from the wrist height, or square to the press as set. */
export const wayOf =
  (s: Settings): Way =>
  (r) => {
    if (s.from === 'reach') return [mixFor(s.curl.middle, s.wristHeight).mix, 1];
    const press = r.vm.clone().addScaledVector(r.vp, -s.pressMix / r.ip);
    return [r.vp.dot(press), -r.vm.dot(press)];
  };
/** Signed mm a row is from the home row (top rows away from you). */
export const rowDistance = (s: Settings, r: Row) =>
  r === 'top' ? s.top : r === 'bottom' ? -s.bottom : 0;
export const twoOf = (s: Settings) => (s.cluster === '1×3' ? undefined : s.two);
/** The last solution: an edit asks for it twice (the layout, then the check). */
let solved: { key: string; h: ReturnType<typeof solve> } | undefined;
/** Every column's poses (the inner column's too) and the thumb row, in the hand frame. */
export function solveHand(s: Settings) {
  const key = JSON.stringify(s);
  if (solved?.key !== key) solved = { key, h: solve(s) };
  return solved.h;
}
function solve(s: Settings) {
  const way = wayOf(s),
    poses: Record<string, Pose[]> = {};
  for (const f of FINGERS)
    poses[f] = ROWS.map((r) => rowPose(f, s.curl[f], 0, rowDistance(s, r), way));
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
export type Solved = ReturnType<typeof solveHand>;
/** The thumb's keys by name: the row's, then the extra keys. */
export const THUMB_ROW = ['far', 'home', 'near'];
export const thumbKeysOf = (h: Solved) => [
  ...h.row.map((k, i) => ({ name: THUMB_ROW[i], k })),
  ...h.extra.map((k, i) => ({ name: `x${i + 1}`, k })),
];
/** A cap's frame at `pos`: z out of the cap, y the direction `up` made square to z. */
export const capFrame = (pos: T.Vector3, normal: T.Vector3, up: T.Vector3) => {
  const z = normal.clone(),
    y = up.clone().addScaledVector(z, -up.dot(z)).normalize();
  return new T.Matrix4().makeBasis(new T.Vector3().crossVectors(y, z), y, z).setPosition(pos);
};
// ---------------------------------------------------------------- presets
/** Near the Dactyl Manuform (DM_right), reaching as seen on it. Fitted by a
 * test (tests/hand.test.ts): of the valid layouts, the one whose keys are
 * closest to the Dactyl's. Valid with the 1×3 cluster, the frame too. */
export const DACTYL: Settings = {
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
/** The least change from the resting hand that makes a valid layout: nearly
 * at rest, the board tented 1° (the steep top rows of an uncurled hand use up
 * the tray). The thumb as at rest in the photos, its keys as close as the
 * keycaps allow. */
export const NATURAL: Settings = {
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
/** Set by hand in the editor from the Dactyl fit, the thumb then refitted so
 * its keys touch the thumb where it reaches them first, and so the tiles
 * clear. The far and near keys keep the home key's y, tilted toward their
 * press (parallel). */
export const YOURS: Settings = {
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
/** Yours with the thumb keeping its resting bend on every key (no curl), each
 * key pressed with the pad. */
export const NO_CURL: Settings = {
  ...structuredClone(YOURS),
  thumb: { around: 116, drop: 16, reach: { palmar: 1.1, curl: 0 }, press: -20, parallel: true },
  spacing: 25,
};
/** Everything the panel sets: the layout's settings, what the hand is shown
 * doing and which parts of the panel are open. One state, kept in the project
 * (so Undo, the autosave and Save project carry all of it), the keys always
 * laid out from it. */
export type HandState = Settings & {
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
export const START: HandState = {
  ...structuredClone(DACTYL),
  // Valid on Yours: closer, x1 meets the near key; pressed with the side of
  // the thumb (its nail about upright), x1 21° off square, x2 7°.
  extra: { on: false, south: 37, tilt: 32, lower: 3, press: -33 },
  row: 'home',
  thumbOn: 'home',
  pressing: false,
  handle: 'hand',
  advanced: false,
  frameOn: false,
  buildCase: false,
};
/** The values each text setting takes. */
export const CHOICES: Record<string, readonly string[]> = {
  row: ROWS,
  thumbOn: ['rest', 'far', 'home', 'near', 'x1', 'x2'],
  from: ['reach', 'press'],
  cluster: ['1×3', '1.5u + 2×1u'],
  handle: ['hand', 'off'],
};
/** A saved state (a project's, or pasted) on top of the start: each setting
 * it has of the same type (a number a finite one, a text one of its choices);
 * anything else (renamed since, say) starts over. */
export function stateOf(v: unknown): HandState {
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
/** The settings (degrees) that `apply` makes of a rotation, nearest `prev`:
 * of the two ways to write it with the middle angle, the one that moves least. */
export function nearest(e: T.Euler, prev: number[]) {
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
export function anchorOf(c0: Config) {
  const mi = c0.geometry.columns.findIndex((k) => k.name === 'middle'),
    o = (c0.geometry.key_overrides as Record<string, KeyOverride>).matrix_middle_home;
  // Through the key's own tilt too, or every reload moves the anchor.
  return V([0, 0, capHeight(c0, 'matrix_middle_home')]).applyMatrix4(
    columnFrames(c0, mi)[1].multiply(frame(o?.offset_mm, o?.rotation_deg)),
  );
}
/** Hand frame → layout. */
export const layoutOf = (anchor: T.Vector3, s: Settings) =>
  new T.Matrix4()
    .makeTranslation(anchor)
    .multiply(turnOf(s))
    .multiply(
      new T.Matrix4().makeTranslation(
        rowPose('middle', s.curl.middle, 0, 0, wayOf(s)).chain.pad.negate(),
      ),
    );
/** Hand frame → the editor's world (the tented board), once `c` has the hand's keys. */
export const worldOf = (c: Config, anchor: T.Vector3, s: Settings) =>
  tentFrame(c).multiply(layoutOf(anchor, s));
/** Write the hand's keys and tent into config `c`. */
export function applyHand(c: Config, s: Settings, anchor: T.Vector3) {
  const { poses, row, extra } = solveHand(s),
    L = layoutOf(anchor, s),
    keys: Record<string, KeyTop[]> = {},
    splay: Record<string, number> = {};
  c.geometry.tent_deg = s.tent;
  for (const col of Object.keys(poses)) {
    // Seen from above, the way the fingertip travels, bottom key to top (the
    // knuckle-to-fingertip direction swings with roll when curled).
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
