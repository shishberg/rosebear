// The clearance report in the sidebar and the failure highlights in the 3D
// view: badge, legend, per-failure focus.
import * as T from 'three';
import type { Highlight, Report } from './solid';
import { reportLines, prettyKey } from './report-lines';
import { disposeChildren } from './three-util';
import { $ } from './state';
import { failures, geometry, render } from './viewer';

/** How each failure kind is drawn in the 3D view; the legend lists one kind per colour. */
const KIND_STYLE: Record<Highlight['kind'], { color: number; order: number }> = {
  rest: { color: 0xff303e, order: 6 },
  hardware: { color: 0xff303e, order: 6 },
  travel: { color: 0xffa124, order: 5 },
  room: { color: 0xffa124, order: 6 },
  opening: { color: 0xf16bd8, order: 6 },
  seat: { color: 0xf16bd8, order: 6 },
  loose: { color: 0xf16bd8, order: 6 },
  wire: { color: 0x40e0ff, order: 6 },
  solder: { color: 0x40e0ff, order: 6 },
};
const LEGEND: [Highlight['kind'], string][] = [
  ['rest', 'Red: at-rest / hardware collision'],
  ['travel', 'Orange: travel + clearance collision'],
  ['opening', 'Pink: opening / switch-seat defect / loose piece'],
  ['wire', 'Cyan: wire into the chassis / blocked soldering access'],
];
$('fit-legend').replaceChildren(
  ...LEGEND.flatMap(([kind, text], i) => {
    const span = document.createElement('span');
    span.textContent = text;
    span.style.color = '#' + KIND_STYLE[kind].color.toString(16).padStart(6, '0');
    return i ? [document.createElement('br'), span] : [span];
  }),
);
export const setBadge = (kind: '' | 'pass' | 'fail', text: string) => {
  $('fit-badge').className = kind;
  $('fit-badge').textContent = text;
};
let focusedFailure: string | undefined;
export function clearFailures() {
  disposeChildren(failures);
  focusedFailure = undefined;
  $('fit-focus').textContent = '';
  render();
}
export function updateFailures(items: Highlight[]) {
  clearFailures();
  for (const item of items) {
    const { color, order } = KIND_STYLE[item.kind];
    const mesh = new T.Mesh(
      geometry(item.mesh, false),
      new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
        side: T.FrontSide,
      }),
    );
    mesh.name = item.name;
    mesh.userData.kind = item.kind;
    mesh.renderOrder = order;
    failures.add(mesh);
  }
  failureVisibility();
}
function failureVisibility() {
  failures.visible = $('show-failures').matches(':checked');
  for (const mesh of failures.children)
    mesh.visible = focusedFailure === undefined || mesh.name === focusedFailure;
  $('fit-focus').textContent = focusedFailure ? `Showing: ${prettyKey(focusedFailure)}` : '';
  document
    .querySelectorAll<HTMLButtonElement>('#fit-list button')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.failure === focusedFailure)));
  render();
}
function focusFailure(name?: string) {
  focusedFailure = name;
  $<HTMLInputElement>('show-failures').checked = true;
  failureVisibility();
}
$('show-failures').onchange = failureVisibility;
$('all-failures').onclick = () => focusFailure();

export function showReport(r: Report) {
  setBadge(
    r.passed ? 'pass' : 'fail',
    r.passed ? 'Clearance checks PASS' : 'Clearance checks FAIL',
  );
  const list = $('fit-list');
  list.replaceChildren();
  for (const { text, name } of reportLines(r)) {
    const li = document.createElement('li');
    if (name) {
      const b = document.createElement('button');
      b.textContent = text;
      b.dataset.failure = name;
      b.setAttribute('aria-pressed', 'false');
      b.onclick = () => focusFailure(name);
      li.append(b);
    } else li.textContent = text;
    list.append(li);
  }
}
