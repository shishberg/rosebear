// Pointer and keyboard editing: picking and dragging handles, and Ctrl+Z.
import * as T from 'three';
import { clone, validateProject, type Project } from './geometry';
import { clientToNdc, worldToClient } from './three-util';
import { $, S } from './state';
import { camera, controls, render, renderer } from './viewer';
import { updateHandles } from './scene-parts';
import { handles, dragTo } from './handles';
import { requestBuild } from './build-client';
import {
  snapshot,
  historyButtons,
  markStale,
  preview,
  updateSelection,
  refreshInputs,
  autosave,
} from './project-store';

/** Set by main once the marks tool exists; painting a mark takes the pointer. */
export const marksHook = { painting: () => false };
const ray = new T.Raycaster(),
  pointer = new T.Vector2();
function cursor(e: PointerEvent) {
  ray.setFromCamera(clientToNdc(renderer.domElement, e.clientX, e.clientY, pointer), camera);
}
export const screen = (p: T.Vector3) => worldToClient(renderer.domElement, camera, p);
renderer.domElement.addEventListener(
  'pointerdown',
  (e) => {
    if (e.button !== 0 || !$('edit').matches(':checked') || S.handLayout || marksHook.painting())
      return;
    let best = 13,
      hit: ReturnType<typeof handles>[number] | undefined;
    for (const h of handles(S.project)) {
      const s = screen(h.at),
        d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
      if (s.visible && d < best) {
        best = d;
        hit = h;
      }
    }
    if (!hit) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    S.selected = hit.id;
    updateSelection();
    updateHandles();
    cursor(e);
    const plane = new T.Plane().setFromNormalAndCoplanarPoint(
        camera.getWorldDirection(new T.Vector3()),
        hit.at,
      ),
      start = ray.ray.intersectPlane(plane, new T.Vector3());
    if (!start) return;
    S.drag = {
      plane,
      start,
      point: hit.at.clone(),
      id: hit.id,
      changed: false,
      base: clone(S.project),
    };
    controls.enabled = false;
    renderer.domElement.setPointerCapture(e.pointerId);
    render();
  },
  true,
);
renderer.domElement.addEventListener(
  'pointermove',
  (e) => {
    if (!S.drag) return;
    e.stopImmediatePropagation();
    cursor(e);
    const hit = ray.ray.intersectPlane(S.drag.plane, new T.Vector3());
    if (!hit) return;
    const delta = hit.sub(S.drag.start);
    if (
      S.drag.point
        .clone()
        .add(delta)
        .toArray()
        .some((x) => Math.abs(x) > 1000)
    )
      return;
    let next: Project;
    try {
      next = dragTo(
        S.drag.base,
        S.drag.id,
        delta,
        S.drag.point,
        camera.getWorldDirection(new T.Vector3()),
      );
      validateProject(next);
    } catch {
      return;
    }
    if (!S.drag.changed) {
      snapshot();
      clearTimeout(S.timer);
    }
    markStale();
    S.project = next;
    S.drag.changed = true;
    preview();
    updateSelection();
  },
  true,
);
function endDrag(e: PointerEvent, cancel = false) {
  if (!S.drag) return;
  e.stopImmediatePropagation();
  if (cancel && S.drag.changed) {
    const previous = S.undo.pop();
    if (previous) S.project = previous;
    historyButtons();
    preview();
  }
  const changed = S.drag.changed;
  S.drag = undefined;
  controls.enabled = true;
  refreshInputs();
  autosave();
  if (changed) requestBuild();
}
renderer.domElement.addEventListener('pointerup', (e) => endDrag(e), true);
renderer.domElement.addEventListener('pointercancel', (e) => endDrag(e, true), true);
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input,textarea,select')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    $(e.shiftKey ? 'redo' : 'undo').click();
  }
});
