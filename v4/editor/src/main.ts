// Entry point: wires the editor's modules together, installs the test hooks,
// the marks tool and the ?hand prototype, then starts the first build.
import './style.css';
import * as T from 'three';
import { clone } from './geometry';
import { setupMarks } from './marks';
import { setupHand } from './hand';
import { S } from './state';
import {
  scene,
  camera,
  controls,
  renderer,
  shell,
  basePlate,
  trim,
  parts,
  failures,
  render,
  resize,
} from './viewer';
import { snapshot, historyButtons, refreshInputs, preview, edited } from './project-store';
import { startWorker, requestBuild } from './build-client';
import { restoreView } from './view-store';
import { marksHook, screen } from './interaction';
import { handles } from './handles';
import './project-io';

// Used by browser tests to inspect the exact state behind visible controls.
Object.assign(window, {
  rosebearEditor: {
    getProject: () => clone(S.project),
    getRevision: () => S.revision,
    getSolidRevision: () => S.solidRevision,
    getSelected: () => S.selected,
    getVisible: () => ({ shell: shell.visible, base: basePlate.visible, trim: trim.visible }),
    handleScreen: (id: string) => {
      const h = handles(S.project).find((h) => h.id === id);
      if (!h) throw Error('No handle ' + id);
      return screen(h.at);
    },
    getWiring: () => S.routed,
    getHardware: () =>
      parts.children.map((o) => ({
        name: o.name,
        group: o.userData.group,
        visible: o.visible,
        matrix: o.matrix.elements.slice(),
      })),
    getHighlights: () =>
      failures.children.map((m) => ({
        name: m.name,
        kind: m.userData.kind,
        visible: failures.visible && m.visible,
        triangles: (m as T.Mesh).geometry.getIndex()!.count / 3,
        color: ((m as T.Mesh).material as T.MeshBasicMaterial).color.getHex(),
      })),
    getMarks: () => marks.shown(),
  },
});
// Review marks painted on the model, saved by the dev server (vite.config.ts),
// so only there. ?hand adds its own parts once it's set up.
let handTargets = (): [T.Object3D, string][] => [];
const marks = !import.meta.env.DEV
  ? { painting: () => false, shown: () => [] }
  : setupMarks({
      scene,
      camera,
      controls,
      renderer,
      targets: () => [
        [shell, 'shell'],
        [basePlate, 'bottom section'],
        [trim, 'trim'],
        ...parts.children.map((o): [T.Object3D, string] => [o, o.userData.group ?? 'other']),
        ...handTargets(),
      ],
      render,
    });
if (import.meta.env.DEV && new URLSearchParams(location.search).has('hand'))
  ({
    layout: S.handLayout,
    update: S.handUpdate,
    buildCase: S.handCase,
    targets: handTargets,
  } = setupHand({
    scene,
    camera,
    dom: renderer.domElement,
    orbit: controls,
    project: () => S.project,
    snapshot,
    edited,
    render,
  }));
marksHook.painting = () => marks.painting();
restoreView();
historyButtons();
refreshInputs();
preview();
startWorker();
requestBuild();
resize();
