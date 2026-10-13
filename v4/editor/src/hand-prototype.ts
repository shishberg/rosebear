/**
 * PROTOTYPE ?hand — throwaway. The measured left hand (v4/hand/left-hand.json,
 * mirrored into the right half's layout axes) drawn in the editor, laying out
 * the keys: each home key goes under its fingertip, the top and bottom rows
 * where the fingertip lands when it reaches forward or pulls back, and the
 * thumb row where the thumb sweeps, each key facing the way the thumb curls. Opening the page and every
 * slider move rewrite the finger columns and the thumb row (Undo restores).
 *
 * Fingers: chains MCP–PIP–DIP–pad from the resting pose. Curl bends the PIP,
 * the MCP by 0.4 of that and the DIP by 2/3. A row's reach is shared between
 * the fingers (least joint movement, so the row rises or drops as it must) and
 * the whole hand sliding (which keeps the row level).
 * Thumb: a ball joint at the assumed CMC, hinges at the MCP and IP.
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
type Chain = { mcp: T.Vector3; pip: T.Vector3; dip: T.Vector3; pad: T.Vector3; tip: T.Vector3 };
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
    return [f, { mcp, pip: V(r.joints.pip), dip, pad: V(r.pad), tip, heading }];
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
      tip: r.tip.clone(),
    },
    bend = (about: T.Vector3, a: number, pts: T.Vector3[]) =>
      pts.forEach((p) => p.sub(about).applyAxisAngle(across, -rad(a)).add(about));
  bend(c.mcp, mcp, [c.pip, c.dip, c.pad, c.tip]);
  bend(c.pip, pip, [c.dip, c.pad, c.tip]);
  bend(c.dip, (pip * 2) / 3, [c.pad, c.tip]);
  for (const p of [c.pip, c.dip, c.pad, c.tip]) p.sub(c.mcp).applyAxisAngle(Z, rad(abd)).add(c.mcp);
  return c;
}
const curled = (f: Finger, curl: number, abd = 0) => finger(f, 0.4 * curl, curl, abd);

/** The pose that moves the fingertip `dist` mm along the finger from home with
 * the least joint movement, rising or dropping as it must. Also how far short it falls. */
function rowPose(f: Finger, curl: number, abd: number, dist: number) {
  const home = curled(f, curl, abd).pad,
    dir = rest[f].heading.clone().applyAxisAngle(Z, rad(abd)),
    res = ([m, p]: number[]) => {
      const d = finger(f, 0.4 * curl + m, curl + p, abd).pad.sub(home);
      return [(d.dot(dir) - dist) / 0.5, m / 30, p / 30];
    },
    [m, p] = fit(res, [0, 0]),
    c = finger(f, 0.4 * curl + m, curl + p, abd);
  return { chain: c, short: dist - c.pad.clone().sub(home).dot(dir) };
}

// ---------------------------------------------------------------- thumb
const cmc = hand.thumb.assumed_cmc,
  C = V(cmc.cmc),
  TL = [cmc.metacarpal_mm, hand.thumb.segment_mm.mcp_ip, hand.thumb.segment_mm.ip_pad],
  thumbRest = cmc.poses['1'];
/** q = yaw, pitch, roll (the CMC), mcp, ip: as in v4/hand/tools/thumb_cmc.py. */
function thumb(q: number[]) {
  const R = new T.Matrix4()
      .makeRotationZ(rad(q[0]))
      .multiply(new T.Matrix4().makeRotationY(rad(q[1])))
      .multiply(new T.Matrix4().makeRotationX(rad(q[2]))),
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
/** The joint angles that put the pad on `target` with the least change from rest. */
const reachQ = (target: T.Vector3, from = thumbRest) =>
  fit(
    (q) => [
      ...thumb(q)
        .pad.sub(target)
        .toArray()
        .map((v) => v / 0.5),
      ...q.map((v, i) => (v - thumbRest[i]) / 30),
    ],
    from,
  );
/** Which way the pad moves as the MCP and IP curl together: the way a key is pressed. */
const pressDir = (q: number[]) =>
  thumb([q[0], q[1], q[2], q[3] + 1, q[4] + 1])
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
/** The thumb row in the hand frame, far key first. The home key's pad is `at`
 * degrees round the measured arc. The row leaves it square to the way the
 * thumb presses, turned `tilt` degrees toward that way (+ the far key deeper),
 * and curves as tightly as the measured arc. Each key's frame has z out of the
 * cap (from up at `face` 0 to against the press at 1) and x toward the near key. */
function thumbRow(at: number, spacing: number, tilt: number, face: number) {
  const home = arcPoint(at),
    qh = reachQ(home),
    p = pressDir(qh),
    a = rad(at),
    tangent = new T.Vector3(-Math.sin(a), Math.cos(a), 0), // toward prints 3 and 4: far
    flat = tangent.addScaledVector(p, -tangent.dot(p)).normalize(),
    sweep = flat.multiplyScalar(Math.cos(rad(tilt))).addScaledVector(p, Math.sin(rad(tilt))),
    inward = V([arc.centre[0], arc.centre[1], home.z]).sub(home),
    k = inward.addScaledVector(sweep, -inward.dot(sweep)).normalize(),
    R = arc.radius_mm;
  return [1, 0, -1].map((n) => {
    const th = (n * spacing) / R,
      pad = home
        .clone()
        .addScaledVector(sweep, R * Math.sin(th))
        .addScaledVector(k, R * (1 - Math.cos(th))),
      q = reachQ(pad, qh),
      z = Z.clone().lerp(pressDir(q).negate(), face).normalize(),
      x = sweep
        .clone()
        .multiplyScalar(-Math.cos(th))
        .addScaledVector(k, -Math.sin(th)),
      xx = x.addScaledVector(z, -x.dot(z)).normalize(),
      m = new T.Matrix4().makeBasis(xx, new T.Vector3().crossVectors(z, xx), z).setPosition(pad);
    return { pad, q, frame: m };
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
      capsule(c.dip, c.tip, 7 * s),
    );
  }
  group.add(capsule(C, th.M, 11), capsule(th.M, th.I, 10.5), capsule(th.I, th.axis, cmc.pad_below_distal_axis_mm));
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
/** Put each finger key's cap-top centre at the given layout point. Heights and
 * stagger take the column's share; the rest goes in key_overrides. */
function placeColumns(c: Config, tops: Record<string, T.Vector3[]>, splay: Record<string, number>) {
  const g = c.geometry,
    h = capTop(c),
    over = g.key_overrides as Record<string, { offset_mm?: number[] }>;
  g.columns.forEach((col, ci) => {
    const P = tops[col.name];
    col.rotation_deg = [0, 0, Math.round(splay[col.name] * 10) / 10];
    col.offset_mm = [P[1].x - (ci - 2) * g.column_pitch_mm, P[1].y, 0];
    col.heights_mm = P.map((p) => p.z - h);
    for (let it = 0; it < 4; it++) {
      ROWS.forEach((r) => delete over[`matrix_${col.name}_${r}`]);
      const seat = columnFrames(c, ci).map((m, ri) =>
        P[ri].clone().addScaledVector(new T.Vector3().setFromMatrixColumn(m, 2), -h),
      );
      col.heights_mm = seat.map((s) => Math.round(s.z * 100) / 100);
      const frames = columnFrames(c, ci);
      ROWS.forEach((r, ri) => {
        const local = seat[ri].clone().applyMatrix4(frames[ri].clone().invert());
        over[`matrix_${col.name}_${r}`] = {
          offset_mm: local.toArray().map((v) => Math.round(v * 100) / 100),
        };
      });
    }
  });
}
// chassis.json turns the home key a quarter turn in its place; keep that.
const KEY_TURN: Record<string, number[]> = { home: [0, 0, -90] };
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Put the thumb keys' cap tops on the given frames (layout, far key first). The
 * cluster's root goes on the home key's seat and each key gets its own offset and
 * turn, so the arc's step and well are zeroed. */
function placeThumb(c: Config, tops: T.Matrix4[]) {
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
        .multiply(frame([0, 0, 0], KEY_TURN[key.name] ?? [0, 0, 0])),
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
    o = (c0.geometry.key_overrides as Record<string, { offset_mm?: number[] }>).matrix_middle_home,
    anchor = V(o?.offset_mm ?? [0, 0, 0])
      .add(V([0, 0, capTop(c0)]))
      .applyMatrix4(columnFrames(c0, mi)[1]);

  const s = {
    tent: c0.geometry.tent_deg,
    roll: 0,
    wrist: 0,
    bend: 0,
    curl: { index: 0, middle: 0, ring: 0, pinky: 0 } as Record<Finger, number>,
    inner: 18,
    top: 18,
    bottom: 18,
    share: 50,
    thumbAt: Math.round(printAngle('1')),
    spacing: 19.5,
    tilt: 0,
    face: 50,
    row: 'home' as Row,
    thumbOn: 'home',
  };

  /** Hand frame → layout, for a hand slid `slide` mm along its fingers. */
  const toLayout = (slide = 0) => {
    const R = new T.Matrix4()
        .makeRotationZ(rad(-s.bend))
        .multiply(new T.Matrix4().makeRotationX(rad(-s.wrist)))
        .multiply(new T.Matrix4().makeRotationY(rad(s.roll))),
      home = curled('middle', s.curl.middle).pad;
    return new T.Matrix4()
      .makeTranslation(anchor)
      .multiply(R)
      .multiply(
        new T.Matrix4().makeTranslation(
          home
            .clone()
            .negate()
            .add(new T.Vector3(0, slide, 0)),
        ),
      );
  };

  // Each row: every finger's pose, and how far the hand slides.
  function solve() {
    const out: Record<string, Chain[]> = {},
      slide: Record<Row, number> = { top: 0, home: 0, bottom: 0 };
    const cols = cfg().geometry.columns.map((k) => k.name);
    for (const [r, dist] of [
      ['top', s.top],
      ['bottom', -s.bottom],
    ] as const) {
      const own = (dist * s.share) / 100,
        shorts = cols.map(
          (col) =>
            rowPose(TYPIST[col], s.curl[TYPIST[col]], col === 'inner' ? s.inner : 0, own).short,
        );
      slide[r] = dist - own + (dist > 0 ? Math.max(0, ...shorts) : Math.min(0, ...shorts));
    }
    for (const col of cols) {
      const f = TYPIST[col],
        abd = col === 'inner' ? s.inner : 0;
      out[col] = ROWS.map((r) =>
        r === 'home'
          ? curled(f, s.curl[f], abd)
          : rowPose(f, s.curl[f], abd, (r === 'top' ? s.top : -s.bottom) - slide[r]).chain,
      );
    }
    return { chains: out, slide };
  }

  function apply() {
    const c = cfg(),
      { chains, slide } = solve(),
      tops: Record<string, T.Vector3[]> = {},
      splay: Record<string, number> = {};
    c.geometry.tent_deg = s.tent;
    for (const col of Object.keys(chains)) {
      tops[col] = chains[col].map((ch, ri) =>
        ch.pad.clone().applyMatrix4(toLayout(slide[ROWS[ri]])),
      );
      const h = chains[col][1],
        d = h.pad.clone().sub(h.mcp).transformDirection(toLayout());
      splay[col] = deg(Math.atan2(-d.x, d.y));
    }
    placeColumns(c, tops, splay);
    const L = toLayout();
    placeThumb(
      c,
      thumbRow(s.thumbAt, s.spacing, s.tilt, s.face / 100).map((k) => L.clone().multiply(k.frame)),
    );
  }

  const note = document.createElement('p');
  function update() {
    const c = cfg(),
      { chains, slide } = solve(),
      ri = ROWS.indexOf(s.row),
      L = toLayout(slide[s.row]);
    // The thumb on its key, which stays put while the hand slides for a row.
    let th = thumb(thumbRest);
    if (s.thumbOn !== 'rest') {
      const k = thumbRow(s.thumbAt, s.spacing, s.tilt, s.face / 100)[
          ['far', 'home', 'near'].indexOf(s.thumbOn)
        ],
        pad = k.pad.clone().applyMatrix4(L.clone().invert().multiply(toLayout()));
      th = thumb(reachQ(pad, k.q));
    }
    const shown = Object.fromEntries(FINGERS.map((f) => [f, chains[f][ri]])) as Record<
      Finger,
      Chain
    >;
    drawHand(handGroup, shown, th);
    handGroup.matrix.copy(L);
    group.matrix.copy(tentFrame(c));
    group.matrixWorldNeedsUpdate = true;
    // Per row: how far the hand slides, and how far the keys rise or drop from home.
    note.textContent = (['top', 'bottom'] as const)
      .map((r) => {
        const ri = ROWS.indexOf(r),
          dz = Object.values(chains).map((ch) => ch[ri].pad.z - ch[1].pad.z),
          [lo, hi] = [Math.min(...dz), Math.max(...dz)].map((v) => v.toFixed(0)),
          moved = Math.abs(slide[r]).toFixed(0);
        return `${r === 'top' ? 'Top' : 'Bottom'} row: hand slides ${moved} mm, keys ${lo === hi ? lo : `${lo} to ${hi}`} mm from home height.`;
      })
      .join(' ');
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
      'display:grid;grid-template-columns:1fr 40px;gap:0 6px;align-items:center;margin:2px 0';
    l.innerHTML = `<span>${label}</span><output style="text-align:right"></output><input type="range" min="${min}" max="${max}" step="${step}" style="grid-column:1/3;width:100%">`;
    const i = l.querySelector('input')!,
      out = l.querySelector('output')!;
    i.value = out.textContent = String(get());
    i.addEventListener('input', () => {
      set(+i.value);
      out.textContent = i.value;
      change();
    });
    i.addEventListener('change', () => (touched = false));
    box.append(l);
  }
  function radios(label: string, options: string[], get: () => string, set: (v: string) => void) {
    const d = document.createElement('div');
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
    box.append(d);
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
  heading('Rows (mm from home, along each finger)');
  slider(
    'reached by the fingers (%): the hand slides the rest',
    () => s.share,
    (v) => (s.share = v),
    0,
    100,
    5,
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
    'home key: degrees round the measured arc',
    () => s.thumbAt,
    (v) => (s.thumbAt = v),
    60,
    200,
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
    'row tilt: + far key pressed deeper',
    () => s.tilt,
    (v) => (s.tilt = v),
    -40,
    40,
  );
  slider(
    'keys face (%): 0 up, 100 the way the thumb curls',
    () => s.face,
    (v) => (s.face = v),
    0,
    100,
    5,
  );

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
