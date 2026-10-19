// Each check must fail on a deliberately broken layout, so none can become a no-op.
// They start from Swung in (the default), which fails some checks of its own
// (pinned in geometry.test.ts); the break here fails them at other keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { clone, defaults } from '../src/geometry';
import { buildSolid } from '../src/solid';

const wasm = await Module();
wasm.setup();

test('the middle column pushed 8 mm into the ring column fails seats, openings, pieces and hardware there', () => {
  // (Moving the thumb cluster off the fingers, as this test did before Swung
  // in, now fails the wire router instead: no route keeps the thumbs' wires
  // above the base.) The wire check's failures are pinned on the C64 case in
  // geometry.test.ts: the Skeletyl's router keeps the wires clear of it.
  const p = clone(defaults);
  p.config.geometry.columns[2].offset_mm[0] += 8;
  const r = buildSolid(wasm, p).report;
  assert.equal(r.passed, false);
  const failing = (xs: { name: string; passed: boolean }[]) =>
      xs.filter((x) => !x.passed).map((x) => x.name),
    pushed = (n: string) => /^matrix_(middle|ring)_/.test(n);
  const seats = failing(r.seats);
  for (const c of ['middle', 'ring'])
    for (const row of ['top', 'home', 'bottom'])
      assert(seats.includes(`matrix_${c}_${row}`), `matrix_${c}_${row}`);
  const openings = failing(r.openings);
  for (const n of [
    'matrix_middle_top',
    'matrix_middle_bottom',
    'matrix_ring_top',
    'matrix_ring_bottom',
  ])
    assert(openings.includes(n), n);
  assert(r.pieces.length > 1, 'a loose piece where the columns meet');
  // Beyond Swung in's own (the pinky bottom key's tile), only the pushed keys.
  const hw = r.hardware.filter((h) => h.name !== 'matrix_pinky_bottom');
  assert(hw.some((h) => h.name === 'matrix_ring_top' && h.group === 'pcb'));
  assert(hw.every((h) => pushed(h.name)));
});
