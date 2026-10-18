import { clone, type Project } from './geometry';

/**
 * PROTOTYPE URL overrides of the chassis settings, for trying a variant
 * without editing the project: `?plates=narrow[&slope=deg]|facets` (plates.ts)
 * and `?recess=mm`, the finger and thumb decks this far above the key surface
 * (Bin.lift in shell/common.ts), `?chassis=c64|skeletyl`, and
 * `?walls=none|flare|arches|truss|bones`, the Skeletyl's wall design
 * (chassis.walls; skeletyl-walls.prototype.ts, cycled by the dev editor's
 * switcher bar; absent is none, the open frame), and
 * `?ends=none|tie|join|both`, how the Skeletyl supports its hanging rib
 * ends (chassis.ends; skeletyl-ends.prototype.ts, cycled by the second bar;
 * absent is none, the ends left hanging). Returns the project to build, which
 * is the one the report records.
 */
export function prototypeOverrides(p: Project, search: string): Project {
  const q = new URLSearchParams(search),
    out = clone(p),
    chassis = out.config.chassis as {
      plate_style?: string;
      plate_slope?: number;
      deck_lift?: number;
      style?: string;
      walls?: string;
      ends?: string;
    };
  if (q.get('plates')) chassis.plate_style = q.get('plates')!;
  if (q.get('slope')) chassis.plate_slope = +q.get('slope')!;
  if (q.get('recess')) chassis.deck_lift = +q.get('recess')!;
  if (q.get('chassis')) chassis.style = q.get('chassis')!;
  if (q.get('walls')) chassis.walls = q.get('walls')!;
  if (q.get('ends')) chassis.ends = q.get('ends')!;
  return out;
}
