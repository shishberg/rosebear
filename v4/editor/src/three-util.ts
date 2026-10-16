import * as T from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Frees a mesh's GPU buffers; removing it from its group alone leaves them. */
export function disposeMesh(o: T.Object3D) {
  const m = o as T.Mesh;
  m.geometry.dispose();
  (m.material as T.Material).dispose();
}
/** Removes and frees every child of a group of meshes, lines or points. */
export function disposeChildren(g: T.Object3D) {
  for (const o of [...g.children]) {
    g.remove(o);
    disposeMesh(o);
  }
}
/** Where the camera sits, what it looks at and which way is up. */
export interface CameraPose {
  position: ArrayLike<number>;
  target: ArrayLike<number>;
  up: ArrayLike<number>;
  zoom?: number;
  fov?: number;
}
/** Moves the camera and its orbit target. Zoom applies to an orthographic camera, fov to a perspective one. */
export function placeCamera(
  camera: T.OrthographicCamera | T.PerspectiveCamera,
  controls: OrbitControls,
  pose: CameraPose,
) {
  camera.up.fromArray(pose.up);
  camera.position.fromArray(pose.position);
  controls.target.fromArray(pose.target);
  if ('fov' in camera) {
    if (pose.fov) camera.fov = pose.fov;
  } else if (pose.zoom) camera.zoom = pose.zoom;
  camera.lookAt(controls.target);
  camera.updateProjectionMatrix();
  controls.update();
}
/** A pointer position over an element, as normalised device coordinates. */
export function clientToNdc(el: HTMLElement, x: number, y: number, out = new T.Vector2()) {
  const r = el.getBoundingClientRect();
  return out.set(((x - r.left) / r.width) * 2 - 1, (-(y - r.top) / r.height) * 2 + 1);
}
/** A world point as client pixels over an element, and whether it is within the view's depth. */
export function worldToClient(el: HTMLElement, camera: T.Camera, p: T.Vector3) {
  const r = el.getBoundingClientRect(),
    q = p.clone().project(camera);
  return {
    x: r.left + ((q.x + 1) * r.width) / 2,
    y: r.top + ((1 - q.y) * r.height) / 2,
    visible: q.z >= -1 && q.z <= 1,
  };
}
