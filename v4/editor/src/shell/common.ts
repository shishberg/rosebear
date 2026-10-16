// Types and dimensions shared by the shell's modules: the kit, a bin's
// parameters and parts, and the parting line's height.
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import type { Matrix4 } from 'three';
import type { Config } from '../geometry';

export interface Kit {
  wasm: ManifoldToplevel;
  cfg: Config;
  frames: Record<string, Matrix4>;
}
// Commodore 64 "breadbin": a wedge whose deck follows a surface fitted
// through the key plates, a bullnose front edge, a rounded underside at the
// front, a rear chamfer with grill grooves running out through both ends, a
// parting line all round, and the keys in a rectilinear well with a shallow
// moat (a thin trough) round it.
export interface Bin {
  keys: string[];
  // Plan rotation of the bin about z, degrees; its front faces local -y.
  angle?: number;
  side: number; // case past the wells at each end
  front: number; // case past the wells at the front, bullnose included
  back: number; // case past the wells at the back, where the grill is
  corner: number; // corner radius of the trough in plan
  // No grill grooves across the back.
  noGrill?: boolean;
  // Grilled bins only: a C64 badge set into the grill, centred this far along
  // the bin from its low end (0 to 1). A pill-shaped recess as tall as the
  // grooves' band interrupts them, with five raised stripes on its floor.
  badge?: number;
  ports?: boolean; // a C64 port panel on the low-x end, where the ribbon leaves
  // Carry this other bin's deck (the thumb row's) on in front of the well, out
  // to its front edge, as one solid. Its surface runs back to its well's back
  // edge, then a straight run joins this bin's surface at the well's front
  // edge, with a hard angle at each end. Past this bin's low end only the
  // other bin's sections remain.
  apron?: Bin;
  // PROTOTYPE ?recess=mm: the deck this far above the fitted key surface
  // instead of LIFT, the well's wall reaching down as much further.
  lift?: number;
}
// Height of the parting line between the top case and the bottom section.
export const PART = 10;
// The parting groove reaches this far either side of PART; its bottom is where
// the top case ends and the bottom section starts.
export const GROOVE = 0.6;
export const SPLIT = PART - GROOVE;
export const END = 2; // rounding of the case's ends, all round
// Deck above the fitted key surface: below the keycaps' lowest travel.
export const LIFT = 3;
export interface BinParts {
  // Absent for a carried bin, whose deck is part of its carrier's solid.
  main?: {
    shell: Manifold; // solid case with trough, grill and parting line cut, wells not yet cut
    cavity: Manifold; // the case's hollow, before anything is kept back from it
  };
  wells: Manifold; // the wells, cut from every bin's shell down to the foot of their walls
  well: CrossSection; // the well's outline in plan (world)
  keep: Manifold; // kept solid inside the hollow: the wall round the well
  x0: number; // the low end face (of an unturned bin)
}
