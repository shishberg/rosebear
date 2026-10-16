import { clone, type Project } from './geometry';

/**
 * PROTOTYPE URL overrides of the chassis settings, for trying a variant
 * without editing the project: `?plates=narrow[&slope=deg]` (plates.ts) and
 * `?recess=mm`, the finger deck this far above the plates' tops (shell/common.ts
 * Bin.lift). Returns the project to build, which is the one the report records.
 */
export function prototypeOverrides(p: Project, search: string): Project {
  const q = new URLSearchParams(search),
    out = clone(p),
    chassis = out.config.chassis as {
      plate_style?: string;
      plate_slope?: number;
      deck_lift?: number;
    };
  if (q.get('plates')) chassis.plate_style = q.get('plates')!;
  if (q.get('slope')) chassis.plate_slope = +q.get('slope')!;
  if (q.get('recess')) chassis.deck_lift = +q.get('recess')!;
  return out;
}
