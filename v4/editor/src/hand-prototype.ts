/**
 * PROTOTYPE ?hand=A|B|C — throwaway. The measured left hand (v4/hand/left-hand.json,
 * mirrored into the right half's layout axes) drawn in the editor, and three ways
 * it could drive the key layout:
 *
 *   A  Row poses as joint angles: each row is a change of MCP and PIP angle from
 *      the resting pose, shared by every finger. Keys go where the fingertips land.
 *   B  Rows as reach in mm: each row is a distance along each finger and a lift.
 *      The hand solves the joint angles to get there and reports them.
 *   C  The hand as a gauge: the layout stays as edited by hand. The hand fits the
 *      home row and reports the joint angles each key needs.
 *
 * A and B rewrite the finger columns and the thumb arc on every slider move
 * (Undo restores). Nothing here is saved apart from the layout it writes.
 *
 * Model: each finger is a chain MCP–PIP–DIP–pad from the resting pose. Flexion is
 * a rotation about the joint's axis (horizontal, across the finger); the DIP
 * follows the PIP at 2/3. Abduction turns the whole finger about the vertical
 * through its MCP. The palm is a sketch, not measured. The thumb is drawn at rest
 * only: its base joint wasn't located, so it can't be posed.
 */
import * as T from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import hand from '../../hand/left-hand.json';
import { columnFrames, tentFrame, ROWS, type Project, type Config, type V3 } from './geometry';

type Host = {
  scene: T.Scene;
  project: () => Project;
  snapshot: () => void;
  edited: () => void;
  render: () => void;
};
const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
type Finger = (typeof FINGERS)[number];
type Row = (typeof ROWS)[number];
const SCALE: Record<Finger, number> = { index: 1, middle: 1, ring: 0.95, pinky: 0.85 };
/** The finger that types each column; the inner column is the index finger turned in. */
const TYPIST: Record<string, Finger> = {
  inner: 'index',
  index: 'index',
  middle: 'middle',
  ring: 'ring',
  pinky: 'pinky',
};
/** Degrees from the resting pose. mcp, pip: + curls. abd: + turns toward the thumb. */
type Pose = { abd: number; mcp: number; pip: number };
const ZERO: Pose = { abd: 0, mcp: 0, pip: 0 };
const V = (p: number[]) => new T.Vector3(...(p as V3));
const Z = new T.Vector3(0, 0, 1);
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const capTop = (c: Config) => c.switch.keycap_bottom_above_plate_mm + c.switch.keycap_mm[2];

// ---------------------------------------------------------------- hand model
type Chain = { mcp: T.Vector3; pip: T.Vector3; dip: T.Vector3; pad: T.Vector3; tip: T.Vector3 };
const rest = Object.fromEntries(
  FINGERS.map((f) => {
    const r = hand.fingers[f].rest,
      mcp = V(r.joints.mcp),
      dip = V(r.joints.dip),
      heading = V(r.joints.pip).sub(mcp).setZ(0).normalize(),
      p = rad(r.segment_pitch_deg[2]), // pitches are downward from level
      tip = dip
        .clone()
        .addScaledVector(heading, Math.cos(p) * hand.fingers[f].segment_mm.dip_pad)
        .addScaledVector(Z, -Math.sin(p) * hand.fingers[f].segment_mm.dip_pad);
    return [
      f,
      { mcp, pip: V(r.joints.pip), dip, pad: V(r.pad), tip, heading } as Chain & {
        heading: T.Vector3;
      },
    ];
  }),
) as Record<Finger, Chain & { heading: T.Vector3 }>;

function pose(f: Finger, q: Pose): Chain {
  const r = rest[f],
    across = new T.Vector3().crossVectors(r.heading, Z).normalize(), // + about this lifts the tip
    c = {
      mcp: r.mcp.clone(),
      pip: r.pip.clone(),
      dip: r.dip.clone(),
      pad: r.pad.clone(),
      tip: r.tip.clone(),
    },
    bend = (about: T.Vector3, a: number, pts: T.Vector3[]) =>
      pts.forEach((p) => p.sub(about).applyAxisAngle(across, -rad(a)).add(about));
  bend(c.mcp, q.mcp, [c.pip, c.dip, c.pad, c.tip]);
  bend(c.pip, q.pip, [c.dip, c.pad, c.tip]);
  bend(c.dip, (q.pip * 2) / 3, [c.pad, c.tip]);
  for (const p of [c.pip, c.dip, c.pad, c.tip])
    p.sub(c.mcp).applyAxisAngle(Z, rad(q.abd)).add(c.mcp);
  return c;
}

/** Joint angles that put the pad on target (hand frame), least change from rest. */
function reach(f: Finger, target: T.Vector3, start: Pose = ZERO, freeAbd = true) {
  let q = [start.abd, start.mcp, start.pip];
  const res = (x: number[]) => {
    const d = pose(f, { abd: x[0], mcp: x[1], pip: x[2] }).pad.sub(target);
    return [d.x, d.y, d.z, 0.02 * x[0], 0.02 * x[1], 0.02 * x[2]];
  };
  for (let it = 0; it < 60; it++) {
    const r0 = res(q),
      J = [0, 1, 2].map((j) => {
        const x = q.slice();
        x[j] += 0.01;
        return res(x).map((v, i) => (v - r0[i]) / 0.01);
      });
    if (!freeAbd) J[0] = J[0].map(() => 0);
    // (JᵀJ + μI) δ = −Jᵀr, 3×3 by Cramer.
    const A = [0, 1, 2].map((a) =>
        [0, 1, 2].map((b) => J[a].reduce((s, v, i) => s + v * J[b][i], 0) + (a === b ? 1e-3 : 0)),
      ),
      g = [0, 1, 2].map((a) => -J[a].reduce((s, v, i) => s + v * r0[i], 0)),
      det = (m: number[][]) =>
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
        m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]),
      D = det(A),
      step = [0, 1, 2].map(
        (k) => det(A.map((row, i) => row.map((v, j) => (j === k ? g[i] : v)))) / D,
      );
    // Scale the step to at most 10° and halve it until the miss shrinks.
    const cost = (x: number[]) => res(x).reduce((s, v) => s + v * v, 0),
      c0 = cost(q);
    let k = Math.min(1, 10 / (Math.hypot(...step) || 1)),
      next = q;
    for (let h = 0; h < 12; h++, k /= 2) {
      next = q.map((v, i) => v + k * step[i]);
      if (cost(next) < c0) break;
    }
    if (Math.hypot(...next.map((v, i) => v - q[i])) < 1e-4) break;
    q = next;
  }
  const p: Pose = { abd: q[0], mcp: q[1], pip: q[2] };
  return { pose: p, miss: pose(f, p).pad.distanceTo(target) };
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
palmSkin.opacity = 0.3;
const dot = (c: number) =>
  new T.MeshBasicMaterial({ color: c, depthTest: false, transparent: true });
function capsule(a: T.Vector3, b: T.Vector3, r: number) {
  const len = a.distanceTo(b),
    m = new T.Mesh(new T.CapsuleGeometry(r, Math.max(len, 0.01), 4, 12), skin);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}
const thumbRest = {
  mcp: V(hand.thumb.rest.joints.mcp),
  ip: V(hand.thumb.rest.joints.ip),
  pad: V(hand.thumb.rest.pad),
};
const arc = hand.thumb.arc_through_prints_1_to_4;
const printAngle = (k: string) => {
  const p = (hand.measured.thumb_prints as Record<string, number[]>)[k];
  return deg(Math.atan2(p[1] - arc.centre[1], p[0] - arc.centre[0]));
};

function drawHand(group: T.Group, chains: Record<Finger, Chain>) {
  group.clear();
  for (const f of FINGERS) {
    const c = chains[f],
      s = SCALE[f];
    group.add(
      capsule(c.mcp, c.pip, 9.5 * s),
      capsule(c.pip, c.dip, 8 * s),
      capsule(c.dip, c.tip, 7 * s),
    );
    const pad = new T.Mesh(new T.SphereGeometry(1.6), dot(0xff5050));
    pad.position.copy(c.pad);
    group.add(pad);
  }
  const t = thumbRest,
    padAxis = t.pad.clone().setZ(9);
  group.add(capsule(t.mcp, t.ip, 10.5), capsule(t.ip, padAxis, 9));
  // Palm: a sketch through the knuckles to a wrist about 85 mm behind them.
  const m = chains.middle.mcp,
    wrist = m.clone().add(new T.Vector3(-8, -85, -12)),
    hull: T.Vector3[] = [];
  for (const f of FINGERS) {
    const k = chains[f].mcp;
    hull.push(k.clone().setZ(k.z + 8 * SCALE[f]), k.clone().setZ(k.z - 14 * SCALE[f]));
  }
  for (const dx of [-28, 28])
    for (const dz of [-14, 14]) hull.push(wrist.clone().add(new T.Vector3(dx, 0, dz)));
  hull.push(t.mcp.clone().setZ(t.mcp.z + 6), t.mcp.clone().setZ(t.mcp.z - 10));
  group.add(new T.Mesh(new ConvexGeometry(hull), palmSkin));
  // Thumb prints 1–5 and the arc through 1–4, on the surface the fingertips rest on.
  for (const [k, p] of Object.entries(hand.measured.thumb_prints)) {
    const d = new T.Mesh(
      new T.SphereGeometry(k === '1' ? 2.2 : 1.5),
      dot(k === '5' ? 0x8899aa : 0xffd060),
    );
    d.position.set(p[0], p[1], 0);
    group.add(d);
  }
  const from = printAngle('2') - 15,
    to = printAngle('4') + 15,
    pts = Array.from({ length: 41 }, (_, i) => {
      const a = rad(from + ((to - from) * i) / 40);
      return new T.Vector3(
        arc.centre[0] + arc.radius_mm * Math.cos(a),
        arc.centre[1] + arc.radius_mm * Math.sin(a),
        0,
      );
    });
  group.add(
    new T.Line(
      new T.BufferGeometry().setFromPoints(pts),
      new T.LineDashedMaterial({
        color: 0xffd060,
        dashSize: 3,
        gapSize: 2,
        depthTest: false,
        transparent: true,
      }),
    ).computeLineDistances(),
  );
}

// ---------------------------------------------------------------- writing the layout
/** Put each finger key's cap-top centre at the given layout point, facing as the
 * column's parabola does. Heights and stagger take the column's share; the
 * rest goes in key_overrides. */
function placeColumns(c: Config, tops: Record<string, T.Vector3[]>, splay: Record<string, number>) {
  const g = c.geometry,
    h = capTop(c),
    over = g.key_overrides as Record<string, { offset_mm?: number[]; rotation_deg?: number[] }>;
  g.columns.forEach((col, ci) => {
    const P = tops[col.name];
    if (!P) return;
    col.rotation_deg = [0, 0, Math.round(splay[col.name] * 10) / 10];
    col.offset_mm = [P[1].x - (ci - 2) * g.column_pitch_mm, P[1].y, 0];
    col.heights_mm = P.map((p) => p.z - h);
    for (let it = 0; it < 4; it++) {
      ROWS.forEach((r) => delete over[`matrix_${col.name}_${r}`]);
      const frames = columnFrames(c, ci),
        seat = frames.map((m, ri) => {
          const n = new T.Vector3().setFromMatrixColumn(m, 2);
          return P[ri].clone().addScaledVector(n, -h);
        });
      col.heights_mm = seat.map((s) => Math.round(s.z * 100) / 100);
      const again = columnFrames(c, ci);
      ROWS.forEach((r, ri) => {
        const local = seat[ri].clone().applyMatrix4(again[ri].clone().invert());
        over[`matrix_${col.name}_${r}`] = {
          offset_mm: local.toArray().map((v) => Math.round(v * 100) / 100),
        };
      });
    }
  });
}
/** The thumb row on the measured arc: its middle key's cap top at `at` degrees
 * around the arc's centre, keys `spacing` mm apart along it. Keeps the
 * cluster's tilt. */
function placeThumb(c: Config, H: T.Vector3, at: number, spacing: number, radius: number) {
  const t = c.geometry.thumb,
    ctr = new T.Vector3(arc.centre[0], arc.centre[1], 0).add(H),
    top = ctr
      .clone()
      .add(new T.Vector3(Math.cos(rad(at)), Math.sin(rad(at)), 0).multiplyScalar(radius));
  t.rotation_deg = [t.rotation_deg[0], t.rotation_deg[1], Math.round((at - 90) * 10) / 10];
  const root = new T.Matrix4()
    .makeRotationZ(rad(t.rotation_deg[2]))
    .multiply(new T.Matrix4().makeRotationY(rad(t.rotation_deg[1])))
    .multiply(new T.Matrix4().makeRotationX(rad(t.rotation_deg[0])));
  const up = new T.Vector3(0, 0, capTop(c)).applyMatrix4(root);
  t.position_mm = top
    .sub(up)
    .toArray()
    .map((v) => Math.round(v * 100) / 100);
  t.arc.radius_mm = radius;
  t.arc.step_deg = Math.round(deg(2 * Math.asin(Math.min(1, spacing / (2 * radius)))) * 100) / 100;
}

// ---------------------------------------------------------------- UI
const VARIANTS = {
  A: 'Row poses as joint angles',
  B: 'Rows as reach in mm',
  C: 'Hand as a gauge',
} as const;
type Variant = keyof typeof VARIANTS;

export function setupHand(host: Host) {
  const variant = (new URLSearchParams(location.search).get('hand')?.toUpperCase() ??
    'A') as Variant;
  if (!(variant in VARIANTS)) return;
  const group = new T.Group(),
    handGroup = new T.Group();
  group.matrixAutoUpdate = false;
  group.add(handGroup);
  group.renderOrder = 10;
  host.scene.add(group);

  // The hand's origin (the middle fingertip at rest) sits on the middle home keycap.
  const cfg = () => host.project().config;
  const homeTop = (c: Config, col: string) => {
    const ci = c.geometry.columns.findIndex((k) => k.name === col),
      m = columnFrames(c, ci)[1],
      o = (c.geometry.key_overrides as Record<string, { offset_mm?: number[] }>)[
        `matrix_${col}_home`
      ];
    return V([0, 0, capTop(c)])
      .add(V(o?.offset_mm ?? [0, 0, 0]))
      .applyMatrix4(m);
  };
  const keyTop = (c: Config, col: string, ri: number) => {
    const ci = c.geometry.columns.findIndex((k) => k.name === col),
      m = columnFrames(c, ci)[ri],
      o = (c.geometry.key_overrides as Record<string, { offset_mm?: number[] }>)[
        `matrix_${col}_${ROWS[ri]}`
      ];
    return V(o?.offset_mm ?? [0, 0, 0])
      .add(V([0, 0, capTop(c)]))
      .applyMatrix4(m);
  };
  const H = homeTop(cfg(), 'middle');

  const s = {
    showRow: 'home' as Row,
    indexOnInner: false,
    inner: 18, // A: abduction for the inner column, degrees
    innerMm: -20, // B: the inner column's sideways shift, mm
    turn: true,
    // The hand (wrist and forearm) slides along the fingers for a row: a fingertip
    // on the home plane can only get about 5 mm further out than it rests.
    slide: { top: 10, home: 0, bottom: 0 } as Record<Row, number>,
    A: { top: { mcp: 0, pip: -11 }, bottom: { mcp: -8, pip: 30 } },
    B: { top: { reach: 20, lift: 6 }, bottom: { reach: -19, lift: 4 }, scaled: true },
    thumb: { at: Math.round(printAngle('1')), spacing: 19.5, radius: arc.radius_mm },
  };

  // Poses per column and row, in the hand frame, for the current variant.
  type Solved = { pose: Pose; pad: T.Vector3; miss: number };
  let solved: Record<string, Solved[]> = {};
  function solve() {
    const c = cfg();
    solved = {};
    for (const col of c.geometry.columns.map((k) => k.name)) {
      const f = TYPIST[col],
        abdA = col === 'inner' ? s.inner : 0;
      solved[col] = ROWS.map((r, ri) => {
        const slid = new T.Vector3(0, s.slide[r], 0);
        if (variant === 'A') {
          const q = {
            abd: abdA,
            ...(r === 'home' ? { mcp: 0, pip: 0 } : s.A[r as 'top' | 'bottom']),
          };
          return { pose: q, pad: pose(f, q).pad.add(slid), miss: 0 };
        }
        let target: T.Vector3;
        if (variant === 'B') {
          const row = r === 'home' ? { reach: 0, lift: 0 } : s.B[r as 'top' | 'bottom'],
            k = s.B.scaled
              ? hand.fingers[f].segment_mm.mcp_pip / hand.fingers.middle.segment_mm.mcp_pip
              : 1;
          target = rest[f].pad
            .clone()
            .addScaledVector(rest[f].heading, row.reach * k)
            .add(new T.Vector3(col === 'inner' ? s.innerMm : 0, 0, row.lift));
        } else target = keyTop(c, col, ri).sub(H);
        const guess = r === 'home' ? ZERO : { abd: 0, ...(r === 'top' ? s.A.top : s.A.bottom) },
          { pose: q, miss } = reach(f, target.sub(slid), guess, variant === 'C' || col === 'inner');
        return { pose: q, pad: pose(f, q).pad.add(slid), miss };
      });
    }
  }

  function apply() {
    const c = cfg(),
      tops: Record<string, T.Vector3[]> = {},
      splay: Record<string, number> = {};
    for (const col of Object.keys(solved)) {
      tops[col] = solved[col].map((x) => x.pad.clone().add(H));
      const f = TYPIST[col],
        home = pose(f, solved[col][1].pose),
        d = home.pad.clone().sub(home.mcp);
      splay[col] = s.turn ? deg(Math.atan2(-d.x, d.y)) : 0;
    }
    placeColumns(c, tops, splay);
    placeThumb(c, H, s.thumb.at, s.thumb.spacing, s.thumb.radius);
  }

  function update() {
    if (variant === 'C') {
      // The hand fits the home row (index to pinky) in plan and height.
      const c = cfg(),
        mean = new T.Vector3();
      for (const f of FINGERS) mean.add(homeTop(c, f).sub(rest[f].pad));
      H.copy(mean.divideScalar(4));
    }
    solve();
    const ri = ROWS.indexOf(s.showRow),
      chains = Object.fromEntries(
        FINGERS.map((f) => {
          const col = f === 'index' && s.indexOnInner ? 'inner' : f;
          return [f, pose(f, solved[col][ri].pose)];
        }),
      ) as Record<Finger, Chain>;
    drawHand(handGroup, chains);
    handGroup.position.y = s.slide[s.showRow];
    group.matrix.copy(tentFrame(cfg())).multiply(new T.Matrix4().makeTranslation(H));
    group.matrixWorldNeedsUpdate = true;
    report();
    host.render();
  }

  // ------------------------------------------------ panel
  const sec = document.createElement('section');
  sec.innerHTML = `<h2>Prototype: hand · ${variant}</h2><p><strong>${VARIANTS[variant]}</strong></p><small>${
    {
      A: 'Each row is a change of joint angles from your resting pose, the same for every finger. The keys go where the fingertips land. Moving a slider rewrites the finger columns and the thumb row (Undo restores).',
      B: 'Each row is a distance along each finger and a lift, in mm. The hand solves the joint angles to get there (table below). Moving a slider rewrites the finger columns and the thumb row (Undo restores).',
      C: 'Your layout is left alone. The hand sits on the home row and the table gives the joint change each key asks for. Edit keys with the handles as usual.',
    }[variant]
  }</small><div id="hp-controls"></div><pre id="hp-report" style="font-size:10px;line-height:1.35;white-space:pre;overflow-x:auto;background:#0b161c;padding:6px;margin:8px 0 0"></pre>`;
  document.querySelector('aside')!.prepend(sec);
  const box = sec.querySelector('#hp-controls')!;
  let touched = false;
  const change = () => {
    if (variant !== 'C') {
      if (!touched) host.snapshot();
      touched = true;
      solve();
      apply();
      host.edited(); // preview → update()
    } else update();
  };
  const heading = (t: string) =>
    box.insertAdjacentHTML(
      'beforeend',
      `<h3 style="font-size:12px;margin:10px 0 2px;color:#b7c4c6">${t}</h3>`,
    );
  function slider(
    label: string,
    get: () => number,
    set: (v: number) => void,
    min: number,
    max: number,
    step = 1,
  ) {
    const l = document.createElement('label');
    l.style.cssText =
      'display:grid;grid-template-columns:1fr 46px;gap:2px 6px;align-items:center;margin:3px 0';
    l.innerHTML = `<span>${label}</span><output></output><input type="range" min="${min}" max="${max}" step="${step}" style="grid-column:1/3;width:100%">`;
    const i = l.querySelector('input')!,
      o = l.querySelector('output')!;
    i.value = String(get());
    o.textContent = String(get());
    i.addEventListener('input', () => {
      set(+i.value);
      o.textContent = i.value;
      change();
    });
    i.addEventListener('change', () => (touched = false));
    box.append(l);
  }
  function check(label: string, get: () => boolean, set: (v: boolean) => void) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" ${get() ? 'checked' : ''}> ${label}`;
    l.querySelector('input')!.addEventListener('change', (e) => {
      set((e.target as HTMLInputElement).checked);
      touched = false;
      change();
      touched = false;
    });
    box.append(l);
  }
  const rowPick = document.createElement('div');
  rowPick.innerHTML =
    'Show the hand on: ' +
    ROWS.map(
      (r) =>
        `<label style="display:inline"><input type="radio" name="hp-row" value="${r}" ${r === s.showRow ? 'checked' : ''}> ${r}</label>`,
    ).join(' ');
  rowPick.addEventListener('change', (e) => {
    s.showRow = (e.target as HTMLInputElement).value as Row;
    update();
  });
  box.append(rowPick);
  const showOnly = (fn: () => void) => () => {
    fn();
    update();
  };
  const l = document.createElement('label');
  l.innerHTML = `<input type="checkbox"> index finger on the inner column`;
  l.querySelector('input')!.addEventListener('change', (e) =>
    showOnly(() => (s.indexOnInner = (e.target as HTMLInputElement).checked))(),
  );
  box.append(l);

  const slideSlider = (r: 'top' | 'bottom') =>
    slider(
      'hand slides forward (mm)',
      () => s.slide[r],
      (v) => (s.slide[r] = v),
      -20,
      30,
    );
  if (variant === 'A') {
    for (const r of ['top', 'bottom'] as const) {
      heading(`${r} row (degrees from rest; + curls)`);
      slideSlider(r);
      slider(
        'MCP (knuckle)',
        () => s.A[r].mcp,
        (v) => (s.A[r].mcp = v),
        -40,
        40,
      );
      slider(
        'PIP (DIP follows at ⅔)',
        () => s.A[r].pip,
        (v) => (s.A[r].pip = v),
        -40,
        70,
      );
    }
    heading('inner column');
    slider(
      'index turned toward the thumb (°)',
      () => s.inner,
      (v) => (s.inner = v),
      0,
      35,
    );
  }
  if (variant === 'B') {
    for (const r of ['top', 'bottom'] as const) {
      heading(`${r} row (mm from the home key)`);
      slideSlider(r);
      slider(
        'fingertip moves along the finger (total)',
        () => s.B[r].reach,
        (v) => (s.B[r].reach = v),
        -40,
        40,
      );
      slider(
        'lift',
        () => s.B[r].lift,
        (v) => (s.B[r].lift = v),
        -15,
        25,
      );
    }
    check(
      'scale reach with finger length',
      () => s.B.scaled,
      (v) => (s.B.scaled = v),
    );
    heading('inner column');
    slider(
      'sideways from the index (mm)',
      () => s.innerMm,
      (v) => (s.innerMm = v),
      -30,
      -14,
    );
  }
  if (variant === 'C')
    for (const r of ['top', 'bottom'] as const) {
      heading(`${r} row`);
      slideSlider(r);
    }
  if (variant !== 'C') {
    check(
      'turn each column to its finger',
      () => s.turn,
      (v) => (s.turn = v),
    );
    heading('hand on the board (mm, layout)');
    slider(
      'X',
      () => Math.round(H.x),
      (v) => (H.x = v),
      H.x - 40,
      H.x + 40,
    );
    slider(
      'Y',
      () => Math.round(H.y),
      (v) => (H.y = v),
      H.y - 40,
      H.y + 40,
    );
    slider(
      'Z (fingertips above the layout origin)',
      () => Math.round(H.z),
      (v) => (H.z = v),
      H.z - 20,
      H.z + 30,
    );
    heading('thumb row on the measured arc');
    slider(
      `middle key position (° around the arc; print 1 at ${Math.round(printAngle('1'))})`,
      () => s.thumb.at,
      (v) => (s.thumb.at = v),
      60,
      200,
    );
    slider(
      'key spacing along the arc (mm)',
      () => s.thumb.spacing,
      (v) => (s.thumb.spacing = v),
      17,
      30,
      0.5,
    );
    slider(
      `arc radius (mm; measured ${arc.radius_mm})`,
      () => s.thumb.radius,
      (v) => (s.thumb.radius = v),
      35,
      130,
      0.5,
    );
  }

  function report() {
    const c = cfg(),
      pad = (v: number | string, n = 6) => String(v).padStart(n),
      lines: string[] = [];
    lines.push(
      `hand origin (layout) ${H.toArray()
        .map((v) => v.toFixed(1))
        .join(', ')}`,
    );
    lines.push('');
    lines.push('key           abd   mcp   pip   miss');
    for (const col of Object.keys(solved))
      solved[col].forEach((x, ri) =>
        lines.push(
          `${(col + ' ' + ROWS[ri]).padEnd(13)}${pad(x.pose.abd.toFixed(0))}${pad(x.pose.mcp.toFixed(0))}${pad(x.pose.pip.toFixed(0))}${pad(x.miss.toFixed(1), 7)}${x.miss > 1 ? ' ✗' : ''}`,
        ),
      );
    lines.push('(degrees from rest; + curls / + toward thumb;');
    lines.push(' miss: mm the fingertip falls short)');
    lines.push('');
    lines.push('cap tops, mm   home x  home y  top Δy  Δz  bottom Δy  Δz');
    for (const col of Object.keys(solved)) {
      const t = [0, 1, 2].map((ri) => keyTop(c, col, ri));
      lines.push(
        `${col.padEnd(13)}${pad(t[1].x.toFixed(1), 8)}${pad(t[1].y.toFixed(1), 8)}${pad((t[0].y - t[1].y).toFixed(1), 8)}${pad((t[0].z - t[1].z).toFixed(1), 5)}${pad((t[2].y - t[1].y).toFixed(1), 11)}${pad((t[2].z - t[1].z).toFixed(1), 5)}`,
      );
    }
    const th = c.geometry.thumb,
      ctr = new T.Vector3(arc.centre[0], arc.centre[1]).add(H);
    lines.push('');
    lines.push(`thumb arc r ${th.arc.radius_mm}  step ${th.arc.step_deg}°`);
    if (variant === 'C') {
      // How far each thumb key's cap top is from the measured arc, in plan.
      const n = th.keys.length;
      th.keys.forEach((k, i) => {
        const a = rad((i - (n - 1) / 2) * th.arc.step_deg),
          R = th.arc.radius_mm,
          root = new T.Matrix4()
            .makeRotationZ(rad(th.rotation_deg[2]))
            .multiply(new T.Matrix4().makeRotationY(rad(th.rotation_deg[1])))
            .multiply(new T.Matrix4().makeRotationX(rad(th.rotation_deg[0])))
            .setPosition(...(th.position_mm as V3)),
          p = V([R * Math.sin(a), R * (Math.cos(a) - 1), capTop(c)]).applyMatrix4(root),
          off = Math.hypot(p.x - ctr.x, p.y - ctr.y) - arc.radius_mm;
        lines.push(
          `  ${k.name.padEnd(5)} ${off >= 0 ? 'outside' : 'inside '} the arc by ${Math.abs(off).toFixed(1)} mm, ${(p.z - H.z).toFixed(1)} mm above the fingertips`,
        );
      });
    }
    sec.querySelector('#hp-report')!.textContent = lines.join('\n');
  }

  // ------------------------------------------------ the variant switcher
  const keys = Object.keys(VARIANTS) as Variant[],
    go = (d: number) => {
      const q = new URLSearchParams(location.search);
      q.set('hand', keys[(keys.indexOf(variant) + d + keys.length) % keys.length]);
      location.search = q.toString();
    },
    bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:50;display:flex;gap:10px;align-items:center;background:#fff;color:#111;border-radius:999px;padding:6px 10px;box-shadow:0 4px 16px #0008;font:600 13px system-ui';
  bar.innerHTML = `<button data-d="-1">←</button><span>${variant} · ${VARIANTS[variant]}</span><button data-d="1">→</button>`;
  bar.querySelectorAll('button').forEach((b) => {
    b.style.cssText =
      'border:0;color:#111;font:600 14px system-ui;background:#e4e4e4;border-radius:999px;padding:3px 9px;cursor:pointer';
    b.addEventListener('click', () => go(+b.dataset.d!));
  });
  document.body.append(bar);
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input,textarea,select,[contenteditable]')) return;
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  });

  return update;
}
