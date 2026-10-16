// The port panel on the case's inner end: the recess, the dark insert with its
// neck, the ribbon's landing and the tie tunnels, and the ribbon's slot.
import type { Manifold } from 'manifold-3d';
import { landingBox } from '../wiring';
import { PART, type Kit } from './common';

// The port insert's neck stands this far out round the ribbon's slot; its tie
// tunnels are centred this far in from the landing's ends, their tops this far
// under its top.
const [NECK, TIE_IN, TIE_BRIDGE] = [1.5, 2.75, 1];
// The port panel's recess: its extent along y from the ribbon, its z about the
// parting line, its corner radius and its depth into the end face; the ribbon's
// slot height through it.
const PANEL = { y: [-12, 36], z: [-6, 7], R: 3, D: 1.5, slot: 3 };
/**
 * The port panel, as on the C64's right side: a rounded recess in the end face
 * at x0 with a dark insert at its back, straddling the parting line, with the
 * ribbon's slot through it. Returns the case, the insert and the slot.
 */
export function portPanel(k: Kit, body: Manifold, x0: number) {
  const M = k.wasm.Manifold,
    r = k.cfg.ribbon,
    land = landingBox(k.cfg),
    a = k.frames.adapter.elements,
    ry = a[13],
    rz = a[14] + land.top + r.thickness_mm / 2,
    [y0, y1] = PANEL.y.map((d) => ry + d),
    [z0, z1] = PANEL.z.map((d) => PART + d),
    { R, D } = PANEL,
    face = (from: number, to: number) =>
      M.hull(
        [
          [y0 + R, z0 + R],
          [y1 - R, z0 + R],
          [y0 + R, z1 - R],
          [y1 - R, z1 - R],
        ].map(([y, z]) =>
          M.cylinder(to - from, R, R, 24)
            .rotate([0, 90, 0])
            .translate([from, y, z]),
        ),
      ),
    skin = k.cfg.chassis.skin_mm,
    w = r.width_mm + 2 * r.notch_clearance_mm,
    slot = M.cube([skin + 1, w, PANEL.slot]).translate([x0 - 1, ry - w / 2, rz - PANEL.slot / 2]),
    // The insert holds the ribbon: a neck round the slot through the wall
    // behind it, and inside the case the landing, on the bottom plate, where
    // cable ties through two tunnels across it tie the ribbon down. The
    // landing reaches below the neck, so a pull on the ribbon bears on the
    // wall; the halves close on the neck across the parting line.
    neck = M.cube([skin - D, w + 2 * NECK, PANEL.slot + 2 * NECK]).translate([
      x0 + D,
      ry - w / 2 - NECK,
      rz - PANEL.slot / 2 - NECK,
    ]),
    lx = x0 + skin,
    landing = M.cube([land.length, land.width, land.top - land.bottom]).translate([
      lx,
      ry - land.width / 2,
      a[14] + land.bottom,
    ]),
    [tw, th] = r.tie_slot_mm,
    ties = M.union(
      [lx + TIE_IN, lx + land.length - TIE_IN].map((x) =>
        M.cube([tw, land.width + 2, th], true).translate([
          x,
          ry,
          a[14] + land.top - TIE_BRIDGE - th / 2,
        ]),
      ),
    );
  const cased = body.subtract(face(x0 - 1, x0 + D)).subtract(neck);
  return {
    body: cased,
    // Less the case, where the wall's fillet meets the floor under the landing.
    trim: M.union([face(x0 + D - 0.4, x0 + D), neck, landing])
      .subtract(slot)
      .subtract(ties)
      .subtract(cased),
    slot,
  };
}
