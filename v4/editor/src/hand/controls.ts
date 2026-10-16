// The ?hand panel's sliders, radios and checkboxes as one table of specs (the
// basic and Advanced boxes share each setting's range) and the renderer that builds them.
import { FINGERS } from './model';
import { CHOICES, type HandState } from './layout';

/** [min, max, step] of the settings the panel has twice. */
const RANGE: Record<string, [number, number, number]> = {
  curl: [-30, 40, 1],
  top: [5, 35, 1],
  bottom: [5, 35, 1],
  innerGap: [18, 30, 0.5],
  spacing: [17, 40, 0.5],
};
const rangeOf = (key: string): [number, number, number] | undefined =>
  RANGE[key.startsWith('curl.') ? 'curl' : key];

type Path<T> = {
  [K in keyof T & string]: T[K] extends object ? `${K}.${Path<T[K]>}` : K;
}[keyof T & string];
/** A setting is a path into the state ('thumb.reach.palmar'). */
type Key = Path<HandState>;
type Spec =
  | { kind: 'heading'; text: string }
  /** A ready-made element (buttons, the test frame's readout), by name. */
  | { kind: 'slot'; name: string }
  | {
      kind: 'slider';
      key: Key;
      label: string;
      /** Default: the setting's RANGE. */
      min?: number;
      max?: number;
      step?: number;
      /** Whether it does anything with the other settings as they are. */
      on?: (s: HandState) => boolean;
    }
  /** One slider for several settings: it shows their mean and moves them all
   * by the same amount, each kept in its own range. */
  | { kind: 'together'; keys: Key[]; label: string; min: number; max: number; step: number }
  | {
      kind: 'radios';
      key: Key;
      label: string;
      options: readonly string[];
      /** What each option is called, where not its value. */
      names?: Record<string, string>;
    }
  | { kind: 'check'; key: Key; label: string };

const slider = (
  key: Key,
  label: string,
  min?: number,
  max?: number,
  step?: number,
  on?: (s: HandState) => boolean,
): Spec => ({ kind: 'slider', key, label, min, max, step, on });
const checkbox = (key: Key, label: string): Spec => ({ kind: 'check', key, label });
const radios = (
  key: Key,
  label: string,
  options: readonly string[],
  names?: Record<string, string>,
): Spec => ({ kind: 'radios', key, label, options, names });
const heading = (text: string): Spec => ({ kind: 'heading', text });
const slot = (name: string): Spec => ({ kind: 'slot', name });
const curls = FINGERS.map((f) => `curl.${f}` as const);
const extraOn = (s: HandState) => s.extra.on;

export const BASIC: Spec[] = [
  slot('presets'),
  slot('share'),
  radios('row', 'Fingers on', CHOICES.row),
  radios('thumbOn', 'Thumb on', CHOICES.thumbOn),
  checkbox('pressing', 'Show the thumb pressing it (its last 15 mm onto the key)'),
  radios('handle', 'Rotation handle:', CHOICES.handle),
  heading('Basic'),
  { kind: 'together', keys: curls, label: 'finger curl (°, + curled)', min: -30, max: 40, step: 1 },
  slider(
    'wristHeight',
    "wrist height (mm, the thumb's CMC above the home row)",
    -30,
    130,
    0.5,
    (s) => s.from === 'reach',
  ),
  {
    kind: 'together',
    keys: ['top', 'bottom', 'innerGap', 'spacing'],
    label: 'key spacing (mm, every gap)',
    min: 12,
    max: 30,
    step: 0.5,
  },
  slider(
    'thumb.around',
    'thumb keys round the arc (°, + away from the fingers; rest 112, swept in 92)',
    70,
    180,
  ),
  slider('thumb.drop', 'thumb keys below the home row (mm)', -20, 50, 0.5),
  slider(
    'thumb.reach.palmar',
    'thumb reach: palmar abduction per degree of radial abduction (+ lowers it swinging out)',
    -2,
    2,
    0.05,
  ),
  slider('thumb.reach.curl', 'thumb reach: curl per degree of radial abduction', -2, 2, 0.05),
  slider(
    'thumb.press',
    'thumb press: from palmar abduction (0°) toward curling (90°; − straightening)',
    -90,
    90,
  ),
  checkbox(
    'thumb.parallel',
    "Far and near thumb keys' edges parallel to the home key's (tilted only along the row)",
  ),
  radios('cluster', 'Thumb keys', CHOICES.cluster),
  checkbox(
    'extra.on',
    "Extra thumb keys x1, x2: a second row under the gaps, toward the thumb's base",
  ),
  slider(
    'extra.south',
    "extra thumb keys: mm from the row toward the thumb's base (centre to centre, across the faces)",
    15,
    60,
    0.5,
    extraOn,
  ),
  slider(
    'extra.tilt',
    "extra thumb keys: tilt from the row (° about it, + facing the thumb's base and palm)",
    -30,
    90,
    1,
    extraOn,
  ),
  slider(
    'extra.lower',
    'extra thumb keys: lower (mm, along the keycap normal)',
    -5,
    10,
    0.5,
    extraOn,
  ),
  slider(
    'extra.along',
    'extra thumb keys: slide along the row (mm, + toward the far key)',
    -20,
    20,
    0.5,
    extraOn,
  ),
  checkbox('advanced', 'Advanced settings'),
  checkbox('buildCase', 'Build the case (often fails)'),
  checkbox('frameOn', 'Test frame (print this way up, with supports)'),
  slot('frame'),
];

export const ADVANCED: Spec[] = [
  heading('Hand on the board (°)'),
  slider('tent', 'tent', 0, 45),
  slider('roll', 'roll: + pinky side down', -30, 30),
  slider('pitch', 'pitch: + far edge down', -25, 25),
  slider('bend', 'wrist bend: + toward the pinky', -25, 25),
  heading('Curl at home (°, + curled)'),
  ...FINGERS.map((f) => slider(`curl.${f}`, f)),
  slider('innerGap', 'inner column gap (mm)'),
  slider('innerAngle', 'inner column angle (°, + to thumb)', -10, 30),
  heading('Rows (mm from home)'),
  radios('from', 'Rows reached from the', CHOICES.from, {
    reach: 'wrist height',
    press: 'press mix',
  }),
  slider('pressMix', 'press mix: PIP+DIP° per MCP°', -1, 4, 0.1, (s) => s.from === 'press'),
  slider('top', 'top: forward'),
  slider('bottom', 'bottom: back'),
  heading('Thumb'),
  slider('spacing', 'key spacing (mm)'),
  slider('two.gap', '1u row gap (mm, + toward the palm)', -35, 35, 0.5, (s) => s.cluster !== '1×3'),
];

/** What the controls need of the panel. */
export type Ctl = {
  s: () => HandState;
  /** Change the state, one Undo step (a drag is one). */
  edit: (f: (s: HandState) => void) => void;
  /** Whether a drag has taken its Undo step. */
  hold: (on: boolean) => void;
  /** Every control's refresh from the state. */
  shows: (() => void)[];
};

type Tree = Record<string, any>;
const get = (s: HandState, key: Key): any => key.split('.').reduce((o, k) => o[k], s as Tree);
const set = (s: HandState, key: Key, v: unknown) => {
  const path = key.split('.'),
    last = path.pop()!;
  (path.reduce((o, k) => o[k], s as Tree) as Tree)[last] = v;
};

/** Build `specs` into `box`; `slots` has the elements the `slot` specs name. */
export function render(
  box: HTMLElement,
  specs: Spec[],
  slots: Record<string, HTMLElement>,
  ctl: Ctl,
) {
  const { s, edit, hold, shows } = ctl;
  function slider(
    label: string,
    value: () => number,
    to: (v: number) => void,
    min: number,
    max: number,
    step = 1,
    on = () => true,
  ) {
    const l = document.createElement('label');
    l.style.cssText =
      'display:grid;grid-template-columns:1fr 40px;gap:0 6px;align-items:center;margin:2px 0';
    l.innerHTML = `<span>${label}</span><output style="text-align:right"></output><input type="range" min="${min}" max="${max}" step="${step}" style="grid-column:1/3;width:100%">`;
    const i = l.querySelector('input')!,
      out = l.querySelector('output')!;
    const show = () => {
      out.textContent = String(Math.round(value() * 100) / 100);
      i.value = String(value());
      i.disabled = !on();
      l.style.opacity = on() ? '' : '0.4';
    };
    show();
    shows.push(show);
    i.addEventListener('input', () => {
      edit(() => to(+i.value));
      hold(true);
    });
    i.addEventListener('change', () => hold(false));
    box.append(l);
  }
  for (const spec of specs) {
    if (spec.kind === 'heading')
      box.insertAdjacentHTML(
        'beforeend',
        `<h3 style="font-size:12px;margin:12px 0 2px;color:#b7c4c6">${spec.text}</h3>`,
      );
    else if (spec.kind === 'slot') box.append(slots[spec.name]);
    else if (spec.kind === 'slider') {
      const [lo, hi, st] = rangeOf(spec.key) ?? [],
        { key, on } = spec;
      if ((spec.min ?? lo) === undefined || (spec.max ?? hi) === undefined)
        throw Error(`No range for ${key}`);
      slider(
        spec.label,
        () => get(s(), key),
        (v) => set(s(), key, v),
        spec.min ?? lo!,
        spec.max ?? hi!,
        spec.step ?? st,
        on && (() => on(s())),
      );
    } else if (spec.kind === 'together') {
      const mean = () =>
        Math.round((spec.keys.reduce((t, k) => t + get(s(), k), 0) / spec.keys.length) * 10) / 10;
      slider(
        spec.label,
        mean,
        (v) => {
          const d = v - mean();
          for (const k of spec.keys) {
            const [lo, hi] = rangeOf(k)!;
            set(s(), k, Math.min(hi, Math.max(lo, Math.round((get(s(), k) + d) * 10) / 10)));
          }
        },
        spec.min,
        spec.max,
        spec.step,
      );
    } else if (spec.kind === 'radios') {
      const { key, names = {} } = spec,
        d = document.createElement('div');
      d.style.margin = '4px 0';
      d.innerHTML =
        spec.label +
        ' ' +
        spec.options
          .map(
            (v) =>
              `<label style="display:inline;margin-right:6px"><input type="radio" value="${v}" ${v === get(s(), key) ? 'checked' : ''}>${names[v] ?? v}</label>`,
          )
          .join('');
      d.addEventListener('change', (e) =>
        edit(() => set(s(), key, (e.target as HTMLInputElement).value)),
      );
      shows.push(() =>
        d.querySelectorAll('input').forEach((x) => (x.checked = x.value === get(s(), key))),
      );
      box.append(d);
    } else {
      const { key } = spec,
        l = document.createElement('label');
      l.innerHTML = `<input type="checkbox"> ${spec.label}`;
      l.style.display = 'block';
      const i = l.querySelector('input')!;
      i.addEventListener('change', () => edit(() => set(s(), key, i.checked)));
      shows.push(() => (i.checked = !!get(s(), key)));
      box.append(l);
    }
  }
}
