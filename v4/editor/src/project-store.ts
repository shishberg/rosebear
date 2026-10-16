// The project and its history: load, autosave, undo/redo, commit, and the
// inputs that edit it (selected-handle fields, clearance, config JSON).
import { defaults, clone, validateProject, componentFrames, type Project } from './geometry';
import { $, S } from './state';
import { render, parts } from './viewer';
import { updateHardware, updateHandles } from './scene-parts';
import { setBadge, clearFailures } from './report-view';
import { requestBuild } from './build-client';
import { fields, getAt, setAt } from './handles';

const STORAGE = 'rosebear-chassis-editor:v2';
let loadProblem = '';
try {
  const saved = localStorage.getItem(STORAGE);
  if (saved) {
    const p = JSON.parse(saved);
    validateProject(p);
    S.project = p;
    $('save-state').textContent = 'Restored local autosave';
  }
} catch (e) {
  loadProblem = 'Could not restore autosave: ' + String(e);
}
$('load-error').textContent = loadProblem;
export function updateSelection() {
  const box = $('selection');
  let { title, list } = fields(S.selected, S.project.config);
  // The selected column or cluster can vanish (Apply configuration, Undo).
  if (list.some(([, path]) => !Number.isFinite(getAt(S.project.config, path)))) {
    S.selected = '';
    ({ title, list } = fields(S.selected, S.project.config));
  }
  // ?hand lays the keys out itself, so a field edit would only be overwritten.
  if (!title || S.handLayout) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<strong>${title}</strong><small>+X pinky, +Y away, +Z up, before tenting</small><div class="params">${list.map(([label], i) => `<label>${label}<input type="number" step="0.5" data-field="${i}"></label>`).join('')}</div>`;
  box.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
    const path = list[Number(input.dataset.field)][1];
    input.value = String(+getAt(S.project.config, path).toFixed(3));
    input.onchange = () => {
      const v = Number(input.value);
      try {
        if (!Number.isFinite(v)) throw Error('Not a number');
        const next = clone(S.project);
        setAt(next.config, path, v);
        commit(next);
      } catch (e) {
        $('load-error').textContent = String(e);
        input.value = String(getAt(S.project.config, path));
      }
    };
  });
}
export function autosave() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(S.project));
    $('save-state').textContent = 'Autosaved locally';
  } catch {
    $('save-state').textContent = 'Autosave unavailable — save a project file';
  }
}
export function snapshot() {
  S.undo.push(clone(S.project));
  if (S.undo.length > 60) S.undo.shift();
  S.redo.length = 0;
  historyButtons();
}
export function historyButtons() {
  $<HTMLButtonElement>('undo').disabled = !S.undo.length;
  $<HTMLButtonElement>('redo').disabled = !S.redo.length;
}
/** One undoable change: the new project replaces the old, the inputs follow and a build is scheduled. Throws, changing nothing, if it is invalid. */
export function commit(next: Project, deselect = false) {
  validateProject(next);
  snapshot();
  S.project = next;
  if (deselect) S.selected = '';
  refreshInputs();
  edited();
}
export function markStale() {
  clearFailures();
  S.revision++;
  S.solidRevision = -1;
  S.report = undefined;
  $<HTMLButtonElement>('stl').disabled = true;
  $<HTMLButtonElement>('stl-base').disabled = true;
  $<HTMLButtonElement>('report').disabled = true;
  setBadge('', 'Not checked for this edit');
  $('fit-list').replaceChildren();
  $('view-state').textContent = S.hasShell
    ? 'Editing — showing the previous chassis until rebuild'
    : 'Editing — first chassis is pending';
}
export function preview() {
  try {
    S.handLayout?.();
    componentFrames(S.project.config);
    updateHardware();
    updateHandles();
    S.handUpdate?.();
    parts.visible = true;
  } catch (e) {
    parts.visible = false;
    render();
    $('view-state').textContent = String(e) + ' — undo to recover';
  }
}
export function edited() {
  markStale();
  preview();
  autosave();
  clearTimeout(S.timer);
  S.timer = setTimeout(requestBuild, 250);
}
export function refreshInputs() {
  $<HTMLInputElement>('bottom-out').value = String(
    S.project.config.switch.keycap_bottom_above_plate_mm - S.project.config.switch.travel_mm,
  );
  $<HTMLTextAreaElement>('config').value = JSON.stringify(S.project.config, null, 2);
  updateSelection();
}
function step(from: Project[], to: Project[]) {
  const p = from.pop();
  if (!p) return;
  to.push(clone(S.project));
  S.project = p;
  historyButtons();
  refreshInputs();
  edited();
}
$('undo').onclick = () => step(S.undo, S.redo);
$('redo').onclick = () => step(S.redo, S.undo);
$('reset').onclick = () => commit(clone(defaults));
$('bottom-out').onchange = () => {
  const n = Number($<HTMLInputElement>('bottom-out').value);
  if (!Number.isFinite(n) || n < 0 || n > 20) {
    refreshInputs();
    return;
  }
  const next = clone(S.project);
  next.config.switch.keycap_bottom_above_plate_mm = next.config.switch.travel_mm + n;
  commit(next);
};
$('apply-config').onclick = () => {
  try {
    const next = clone(S.project);
    next.config = JSON.parse($<HTMLTextAreaElement>('config').value);
    commit(next);
    $('load-error').textContent = '';
  } catch (e) {
    $('load-error').textContent = String(e);
  }
};
