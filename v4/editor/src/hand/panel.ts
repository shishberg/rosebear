// The ?hand panel: the hand drawn on the board, the rotation handle, the test
// frame's view and the readout; its controls are built from controls.ts.
import * as T from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { ManifoldToplevel } from 'manifold-3d';
import { defaults, ROWS, tentFrame, type Config, type Project } from '../geometry';
import { ADVANCED, BASIC, render, type Ctl } from './controls';
import { drawHand } from './draw';
import { buildFrame, frameStl, type FrameResult } from './frame';
import {
  anchorOf,
  applyHand,
  layoutOf,
  mixFor,
  nearest,
  stateOf,
  thumbKeysOf,
  turnOf,
  worldOf,
  type HandState,
} from './layout';
import { check, problems } from './check';
import {
  FINGERS,
  PRINT_POSES,
  pressed,
  thumb,
  thumbRest,
  type Chain,
  type Finger,
  type Mix,
} from './model';

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
  let height = '';
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
    // The height, valid or not, here and (the case not built) under the view.
    height = `${r.height.toFixed(1)} mm tall`;
    if (!s().buildCase) document.getElementById('view-state')!.textContent = height;
    note.innerHTML =
      `<div>${height}</div>` +
      (wrong.length
        ? `<div style="color:#ff9a8a">Not valid:<ul style="margin:2px 0;padding-left:18px">${wrong.map((w) => `<li>${w}</li>`).join('')}</ul></div>`
        : r.frameChecked
          ? `<div style="color:#9be39b">Valid.</div>`
          : 'Checking…');
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
  /** Whether a drag (a slider's, the handle's) has taken its Undo step. */
  let touched = false;
  /** Change the state, one Undo step (a drag is one). */
  const edit = (f: (s: HandState) => void) => {
    if (!touched) host.snapshot();
    f(s());
    host.edited(); // → layout(), the editor's redraw, update()
  };
  const shows: (() => void)[] = [],
    ctl: Ctl = { s, edit, hold: (on) => (touched = on), shows };

  // ---- basic
  // To share the settings (paste them into a chat) or bring them back.
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
  // The test frame (frame.ts): switch holes on pillars, to print and try.
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
  render(basic, BASIC, { share, frame: frameBox }, ctl);
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

  render(advanced, ADVANCED, {}, ctl);

  void manifold().then((w) => {
    wasm = w;
    update();
  });
  return {
    layout,
    update,
    buildCase: () => s().buildCase,
    /** How tall the board stands, for the view's status line. */
    height: () => height,
    /** What marks may be painted on, and what each is. */
    targets: (): [T.Object3D, string][] => [[frameView, 'test frame']],
  };
}
