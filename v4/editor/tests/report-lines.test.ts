import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../src/geometry';
import type { Report } from '../src/solid';
import { reportLines } from '../src/report-lines';
import { prototypeOverrides } from '../src/prototype-overrides';

const clean: Report = {
  seats: [{ name: 'a', missing: 0, excess: 0, clipBlocked: 0, passed: true }],
  passed: true,
  keycaps: [],
  capGaps: [{ between: 'a / b', gap: 1.26 }],
  pieces: [1000],
  footprint: [50],
  roomCuts: [],
  hardware: [],
  wires: [],
  solder: [],
  wiring: { wires: 12, joints: 3, length: 100 },
  crossings: [],
  openings: [],
  volume: 0,
  triangles: 0,
  milliseconds: 0,
};
test('a passing report lists its summary lines, none of them isolable', () => {
  assert.deepEqual(
    reportLines(clean).map((l) => l.text),
    [
      '1/1 flat switch seats pass thickness and clip-clearance checks.',
      'The case is one piece without the bottom section.',
      'The case holds together along the parting line without the bottom section.',
      'No chassis was built where a keycap goes.',
      'All 12 wires are clear of the chassis.',
      'No wire runs into another.',
      'Every pad can be reached with a soldering iron from below.',
      'Closest keycaps, a / b: 1.3 mm',
      'No chassis intersections with the checked hardware and keycap envelopes.',
    ],
  );
  assert.ok(reportLines(clean).every((l) => l.name === undefined));
});
test('a failing report lists every failure with the name that isolates it', () => {
  const bad: Report = {
    ...clean,
    passed: false,
    seats: [{ name: 'matrix_a_top', missing: 1, excess: 2, clipBlocked: 3, passed: false }],
    keycaps: [
      { name: 'thumb_home', size: [1, 1, 1], margin: 0.5, atRest: 1.5, swept: 2.5, passed: false },
    ],
    pieces: [5000, 2500],
    footprint: [50, 12.4],
    roomCuts: [{ name: 'thumb_far', volume: 3.25 }],
    hardware: [{ name: 'pcb_1', group: 'pcb', volume: 0.125 }],
    wires: [{ name: 'row_1', volume: 4 }],
    solder: [{ name: 'pad_a_1', volume: 1 }],
    crossings: ['w1 and w2'],
    openings: [{ name: 'matrix_b_top', removed: 0, covered: 7, blocked: 2, passed: false }],
    capGaps: [{ between: 'c / d', gap: 0 }],
  };
  assert.deepEqual(
    reportLines(bad).map((l) => [l.text, l.name]),
    [
      ['0/1 flat switch seats pass thickness and clip-clearance checks.', undefined],
      ['The case is 2 pieces without the bottom section.', undefined],
      ['loose piece 1: 2.5 cm³', 'loose piece 1'],
      ['The case meets the parting line in 2 separate pieces.', undefined],
      ['separate footprint 1: 12 mm²', 'separate footprint 1'],
      ['1 keycap rooms had to cut into the chassis.', undefined],
      ['thumb far: its keycap room cut 3.3 mm³ out of the chassis', 'thumb_far keycap room'],
      [
        'matrix_a_top: switch seat defect (1.00 mm³ missing, 2.00 mm³ outside seating planes, 3.00 mm³ clip obstruction)',
        'matrix_a_top',
      ],
      ['thumb home: 1.50 mm³ at rest; 2.50 mm³ through travel + 0.5 mm clearance', 'thumb_home'],
      ['pcb_1: 0.13 mm³ pcb/chassis overlap', 'pcb_1'],
      ['1 wires run into the chassis.', undefined],
      ['row_1: 4.00 mm³ into the chassis', 'row_1'],
      ['1 pairs of wires run into each other.', undefined],
      ['w1 and w2 run into each other', 'w1 and w2'],
      ['1 pads cannot be reached with a soldering iron.', undefined],
      ["pad a 1: soldering iron's way blocked", 'pad_a_1'],
      ['matrix_b_top: incomplete opening (7/9 probes, 2 blocked)', 'matrix_b_top'],
      ['Closest keycaps, c / d: touching', undefined],
    ],
  );
});
test('prototype overrides are applied to a copy and leave the project alone', () => {
  const p = { ...structuredClone(defaults) };
  const out = prototypeOverrides(p, '?plates=narrow&slope=55&recess=1.5');
  assert.deepEqual(
    { ...(out.config.chassis as object) },
    { ...(p.config.chassis as object), plate_style: 'narrow', plate_slope: 55, deck_lift: 1.5 },
  );
  assert.equal((p.config.chassis as { plate_style?: string }).plate_style, undefined);
  assert.deepEqual(prototypeOverrides(p, '?hand&mark=1'), p);
});
