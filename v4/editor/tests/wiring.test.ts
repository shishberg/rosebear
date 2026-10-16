import assert from 'node:assert/strict';
import { test } from 'node:test';
import { negotiate, type Option } from '../src/wiring/negotiate';
import { portGrid } from '../src/wiring/port';
import { tubeOf } from '../src/wiring/tubes';
import type { Port } from '../src/wiring/common';

const option = (a: number[], b: number[], rank: number): Option => ({
  tube: tubeOf([a, b] as [number, number, number][], 0.6),
  rank,
});

test('negotiation moves a wire off a crossing when its other option is cheap enough', () => {
  const options = [
    // A run along x, or the same run 5 mm away at one more rank.
    [option([0, 0, 0], [10, 0, 0], 0), option([0, 5, 0], [10, 5, 0], 1)],
    // A run across it, or one out of the way at five more.
    [option([5, -5, 0], [5, 2, 0], 0), option([20, -5, 0], [20, 2, 0], 5)],
  ];
  assert.deepEqual(negotiate(options, false), { left: 0, choice: [1, 0] });
  assert.deepEqual(negotiate(options, true), { left: 0, choice: [1, 0] });
});

test('negotiation reports the wires that cannot avoid each other', () => {
  const options = [
    [option([0, 0, 0], [10, 0, 0], 0)],
    [option([5, -5, 0], [5, 2, 0], 0)],
    [option([0, 20, 0], [10, 20, 0], 0)],
  ];
  assert.deepEqual(negotiate(options, true), { left: 2, choice: [0, 0, 0] });
});

test('the wire port grid is a hexagonal lattice that reaches the whole circle', () => {
  const port: Port = { centre: [0, 0, 0], outside: [0, -10, 0], inside: [0, 10, 0], diameter: 0 };
  const pitch = 1.02;
  for (const room of [1, 2, 4.5, 9, 14]) {
    const { places } = portGrid(port, room, pitch);
    assert(places.every((p) => Math.hypot(Math.hypot(p[0], p[1]), p[2]) <= room + 1e-6));
    // Rows 0.866 pitches apart, offset by half a pitch on alternate rows: count the lattice points
    // inside the circle directly, over a range far wider than any port.
    let count = 0;
    for (let row = -30; row <= 30; row++)
      for (let col = -30; col <= 30; col++)
        if (
          Math.hypot((col + (row % 2 ? 0.5 : 0)) * pitch, row * pitch * Math.sqrt(0.75)) <=
          room + 1e-9
        )
          count++;
    assert.equal(places.length, count, `room ${room}`);
  }
  // A wide port has places more than four rows from the middle.
  assert(portGrid(port, 9, pitch).places.some((p) => Math.abs(p[2]) > 4 * pitch * Math.sqrt(0.75)));
});
