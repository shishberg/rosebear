// Each check must fail on a deliberately broken default, so none can become a no-op.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { defaults, clone } from '../src/geometry';
import { buildSolid } from '../src/solid';

const wasm = await Module();
wasm.setup();

test('a thumb cluster moved 40 mm off the fingers fails seats, openings, pieces, hardware, wires and solder', () => {
  const p = clone(defaults);
  p.config.geometry.thumb.position_mm[0] += 40;
  const r = buildSolid(wasm, p).report;
  assert.equal(r.passed, false);
  const failing = (xs: { name: string; passed: boolean }[]) =>
    xs.filter((x) => !x.passed).map((x) => x.name);
  for (const names of [failing(r.seats), failing(r.openings)]) {
    assert(names.includes('thumb_home'));
    assert(names.every((n) => n.startsWith('thumb_')));
  }
  assert(r.pieces.length > 1, 'the thumbs split off as loose pieces');
  assert(r.hardware.length > 0 && r.hardware.some((h) => h.name === 'thumb_home'));
  assert(r.hardware.every((h) => h.group === 'pcb'));
  assert(r.wires.length > 0);
  assert(r.solder.length > 0 && r.solder.every((s) => s.name.startsWith('thumb_')));
  assert(r.wires.every((w) => w.volume > 0) && r.solder.every((s) => s.volume > 0));
});
