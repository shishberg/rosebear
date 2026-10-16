// The C64-styled shell for the right hand, on the key poses: a "breadbin"
// whose deck follows the keys, with the finger keys in one well and the thumb
// row's deck carried on in front of it as part of the same solid, a grill and
// badge across the back, a parting line all round and a port panel on the
// inner end where the ribbon leaves. The case is hollow; the keys' wells are
// open through it, each with a wall down from the deck round it. The plates
// the switches clip into are added by chassis.ts.
import type { CrossSection, Manifold } from 'manifold-3d';
import type { Matrix4 } from 'three';
import { isKey, isThumb, keyGroups } from '../geometry';
import { prism } from '../manifold-util';
import { breadbin } from './bin';
import { SPLIT, type Bin, type Kit } from './common';
import { portPanel } from './port';

export type { Kit };
const keys = (f: Record<string, Matrix4>) => Object.keys(f).filter(isKey);
const thumbs = (k: Kit) =>
  keys(k.frames)
    .filter(isThumb)
    .sort((a, b) => k.frames[a].elements[12] - k.frames[b].elements[12]);
export interface Shell {
  // The case, hollow, with the wells open through it and the port panel cut.
  body: Manifold;
  // The port panel's dark insert, a separate part, with the ribbon's landing.
  trim: Manifold;
  // The ribbon's slot through the port panel.
  slot: Manifold;
  // The port panel's end face, in world x.
  panel: number;
  // Each well's outline in plan.
  wells: CrossSection[];
  // The parting line's groove bottom: the case above it, the bottom section below.
  split: number;
  // Inside the case's skin: its hollow and its wells, with the walls round
  // the wells, which room under the plates may cut back.
  inside: Manifold;
}
function c64(k: Kit, bins: Bin[]): Shell {
  const M = k.wasm.Manifold,
    // A bin that's another's apron is part of that bin's solid: only its
    // well is its own.
    parts = bins.map((o) =>
      breadbin(
        k,
        o,
        bins.some((b) => b.apron === o),
      ),
    ),
    mains = parts.flatMap((p) => (p.main ? [p.main] : [])),
    hollow = M.union(mains.map((m) => m.cavity)).subtract(M.union(parts.map((p) => p.keep)));
  // Each bin that isn't carried stops at the outline of those before it, so its
  // deck, trough and grill don't run on through them.
  const CS = k.wasm.CrossSection,
    shells = mains.map((m, i) =>
      i
        ? m.shell.subtract(prism(CS.union(mains.slice(0, i).map((q) => q.shell.project()))))
        : m.shell,
    );
  const body = M.union(shells)
    .subtract(M.union(parts.map((p) => p.wells)))
    .subtract(hollow);
  const i = Math.max(
      0,
      bins.findIndex((o) => o.ports),
    ),
    x0 = parts[i].x0,
    { body: cased, trim, slot } = portPanel(k, body, x0);
  return {
    body: cased,
    trim,
    slot,
    panel: x0,
    wells: parts.map((p) => p.well),
    split: SPLIT,
    inside: M.union([...mains.map((m) => m.cavity), ...parts.map((p) => p.wells)]),
  };
}
const fingerKeys = (k: Kit) => keys(k.frames).filter((n) => n.startsWith('matrix_'));
// The thumb row's direction in plan, from its first key to its last.
function thumbAngle(k: Kit) {
  const row = keyGroups(k.cfg).thumbs,
    [p, q] = [k.frames[row[0]].elements, k.frames[row[row.length - 1]].elements];
  return (Math.atan2(q[13] - p[13], q[12] - p[12]) * 180) / Math.PI;
}
/**
 * The shell for the key poses: the finger keys in one bin, with the thumb
 * row's bin (every thumb key) carried on in front of it as one solid, a grill
 * with a C64 badge across the finger bin's back and the port panel on its
 * inner end.
 */
export function shell(k: Kit) {
  const tight = { side: 6, front: 13, corner: 2 },
    lift = (k.cfg.chassis as { deck_lift?: number }).deck_lift,
    thumb: Bin = {
      keys: thumbs(k),
      angle: thumbAngle(k),
      ...tight,
      back: 12,
      noGrill: true,
      lift,
    };
  return c64(k, [
    {
      keys: fingerKeys(k),
      ...tight,
      back: 20,
      ports: true,
      apron: thumb,
      badge: 0.7,
      lift,
    },
    thumb,
  ]);
}
