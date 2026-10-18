// PROTOTYPE. Question: How should the Skeletyl support its hanging rib ends?
// Variants switchable via ?ends= on the editor.
//
// ?ends=arch: not built yet (a stub: it adds nothing). The contract it builds
// to, EndsFrame, and the rules are in skeletyl-ends.prototype.ts; beam.prototype.ts
// is a worked example.
import type { Manifold } from 'manifold-3d';
import type { EndsFrame, EndsKit } from '../skeletyl-ends.prototype';

export function arch(_kit: EndsKit, _frame: EndsFrame): Manifold[] {
  return [];
}
