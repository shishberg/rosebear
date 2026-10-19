// Regenerates src/default-config.json: Swung in (SWUNG_IN, src/hand/layout.ts)
// laid out by the hand model (applyHand) on the defaults before Swung in, as
// 6633480 made it. Only the layout comes from those old defaults (the tent,
// the columns, the key overrides and the thumb clusters, all applyHand
// writes, and the anchor it lays them out from); everything else is the
// current default's. The old defaults are read from git (tests/pre-swung-config.json,
// removed in c5249d9). Usage: npm run default-config (which formats the file
// too), then diff src/default-config.json.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Config } from '../src/geometry';
import { _test as hand } from '../src/hand';

const OLD = 'c5249d9^:v4/editor/tests/pre-swung-config.json',
  LAYOUT = ['tent_deg', 'columns', 'key_overrides', 'thumb', 'thumb_extra'],
  path = fileURLToPath(new URL('../src/default-config.json', import.meta.url)),
  old = JSON.parse(execFileSync('git', ['show', OLD], { encoding: 'utf8' })) as Config,
  c = JSON.parse(readFileSync(path, 'utf8')) as Config,
  g = c.geometry as Record<string, unknown>,
  og = old.geometry as Record<string, unknown>;
for (const k of LAYOUT) {
  if (k in og) g[k] = structuredClone(og[k]);
  else delete g[k];
}
hand.applyHand(c, hand.SWUNG_IN, hand.anchorOf(c));
writeFileSync(path, JSON.stringify(c, null, 2) + '\n');
console.log(`wrote ${path}`);
