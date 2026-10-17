import { clone, type Project } from './geometry';

/**
 * PROTOTYPE URL overrides of the chassis settings, for trying a variant
 * without editing the project: `?plates=narrow[&slope=deg]|facets` (plates.ts)
 * and `?recess=mm`, the finger and thumb decks this far above the key surface
 * (Bin.lift in shell/common.ts), and `?chassis=c64|skeletyl`. Returns the project to build, which is the
 * one the report records.
 */
export function prototypeOverrides(p: Project, search: string): Project {
  const q = new URLSearchParams(search),
    out = clone(p),
    chassis = out.config.chassis as {
      plate_style?: string;
      plate_slope?: number;
      deck_lift?: number;
      style?: string;
    };
  if (q.get('plates')) chassis.plate_style = q.get('plates')!;
  if (q.get('slope')) chassis.plate_slope = +q.get('slope')!;
  if (q.get('recess')) chassis.deck_lift = +q.get('recess')!;
  if (q.get('chassis')) chassis.style = q.get('chassis')!;
  return out;
}
