// Shared DOM lookup and the editor's mutable state, in one object so every
// module reads and writes the same fields.
import type * as T from 'three';
import { clone, defaults, type Project } from './geometry';
import type { Report } from './solid';
import type { Wiring } from './wiring';

export const $ = <E extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as E;

/** A handle drag in progress. */
type Drag = {
  plane: T.Plane;
  start: T.Vector3;
  point: T.Vector3;
  id: string;
  changed: boolean;
  base: Project;
};

export const S = {
  project: clone(defaults),
  undo: [] as Project[],
  redo: [] as Project[],
  hasShell: false,
  selected: '',
  // PROTOTYPE ?hand (src/hand/): lays the keys out from its state
  // (project.hand) and redraws the hand after each edit, and builds the case
  // only when asked (the generator can't follow many hand layouts).
  handLayout: undefined as (() => void) | undefined,
  handUpdate: undefined as (() => void) | undefined,
  handCase: undefined as (() => boolean) | undefined,
  revision: 0,
  solidRevision: -1,
  report: undefined as Report | undefined,
  // What the worker built: the saved report records exactly this.
  evaluated: undefined as Project | undefined,
  timer: undefined as ReturnType<typeof setTimeout> | undefined,
  drag: undefined as Drag | undefined,
  // The wiring as last routed.
  routed: undefined as Wiring | undefined,
};
