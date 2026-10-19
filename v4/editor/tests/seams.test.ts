// The seam check (tests/seams.ts) on Swung in, ?walls= none, flare, pillars
// and wishbone by ?ends= none, tie and flow: the frame builds as one piece on one footprint,
// every drop stands flush on the rail, and the seams found between each class
// of parts (rib, bridge, rail or tie, wall) are no more than they were when
// pinned. A class's count can only fall: if it falls, lower its pin. No class
// with a bridge in it is pinned: bridges must meet the ribs cleanly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import type { CrossSection, Manifold } from 'manifold-3d';
import { clone, componentFrames, defaults } from '../src/geometry';
import { SIZES, skeletyl } from '../src/skeletyl';
import { wiring } from '../src/wiring';
import { skeletylSeams, type Seam } from './seams';

const wasm = await Module();
wasm.setup();

/** The class of junction a seam is in: the kinds of part meeting there. */
const kindOf = (name: string) =>
  name.startsWith('bridge')
    ? 'bridge'
    : name.startsWith('wall')
      ? 'wall'
      : name === 'rail' || name === 'tie'
        ? 'rail'
        : 'rib';
function classOf(s: Seam) {
  const kinds = [...new Set(s.parts.map(kindOf))].sort();
  const ribs = s.parts.filter((p) => kindOf(p) === 'rib').length;
  return kinds.length === 1 && kinds[0] === 'rib' && ribs > 1 ? 'rib+rib' : kinds.join('+') || '-';
}

/**
 * Spots per junction class, at most, on each walls/ends. What is left in each,
 * and why it isn't fixed:
 *  - rib+rib: the pinky's back drop and thumb #2 cross (a layout collision,
 *    not a junction to blend), and the thumb fork's ribs meet at their plates.
 *    The index and middle columns' back drops stand all but touching (their
 *    facing corners 0.1 mm apart, the middle's face 1 mm proud), so their
 *    sides meet in a slit; the band between them hid it (with its own seams)
 *    until the bands went. The inner's and index's back drops shade each
 *    other's tops where they stand close.
 *  - rib: a rib's own seams where it is cut (the joined ends, the switch
 *    seats' trims meeting a rounded end) and its sweep's own slivers.
 *  - rail: the rail's own corners where its outline turns tighter than the
 *    mesh (now also turning in round the corners between the back drops,
 *    where the bands stood), and the tie's strip and fillets meeting it
 *    (flow, at the thumbs).
 *  - rail+rib: where a column front hangs joined into a thumb plate (flow),
 *    the rail's inner edge passing under a rib's sweep near its foot, and the
 *    rail at the foot of the index and middle back drops' slit and of the
 *    index's beside the inner's.
 *  - rail+wall, rib+wall, wall (flare): the flare walls reach 0.2 mm into the
 *    rib and the rail (the WallSide contract), so they meet them near tangent,
 *    and stand at railHeight even where the rail dips to a low drop.
 *  - pillars and wishbone: no wall class but one. The rail's own corners are
 *    more (rail, rail+rib): the outline runs out under each limb's feet and
 *    turns back in past them, and that changes where it is resampled near the
 *    thumbs' low drops. wall (wishbone): one sliver of no area on a straight
 *    edge of the inner home key's trunk, where the rib's straight end (LAP)
 *    lies in the trunk's shape, its corner on the shape's edge: the corner
 *    and the edge differ by a rounding, and every way of meeting them tried
 *    (touching, inset by a hair, matched point for point) leaves as much or
 *    more elsewhere.
 */
const PINS: Record<string, Record<string, number>> = {
  'none/none': {
    rail: 8,
    'rail+rib': 6,
    rib: 27,
    'rib+rib': 14,
  },
  'none/tie': {
    rail: 8,
    'rail+rib': 7,
    rib: 29,
    'rib+rib': 15,
  },
  'none/flow': {
    rail: 12,
    'rail+rib': 7,
    rib: 27,
    'rib+rib': 12,
  },
  'flare/none': {
    rail: 8,
    'rail+rib': 5,
    'rail+rib+wall': 2,
    'rail+wall': 35,
    rib: 25,
    'rib+rib': 14,
    'rib+wall': 45,
    wall: 25,
  },
  'flare/tie': {
    rail: 9,
    'rail+rib': 6,
    'rail+rib+wall': 3,
    'rail+wall': 37,
    rib: 27,
    'rib+rib': 15,
    'rib+wall': 44,
    wall: 25,
  },
  'flare/flow': {
    rail: 13,
    'rail+rib': 6,
    'rail+rib+wall': 2,
    'rail+wall': 35,
    rib: 25,
    'rib+rib': 12,
    'rib+wall': 45,
    wall: 25,
  },
  'pillars/none': {
    rail: 10,
    'rail+rib': 7,
    rib: 27,
    'rib+rib': 14,
  },
  'pillars/tie': {
    rail: 14,
    'rail+rib': 8,
    rib: 29,
    'rib+rib': 15,
  },
  'pillars/flow': {
    rail: 13,
    'rail+rib': 8,
    rib: 27,
    'rib+rib': 12,
  },
  'wishbone/none': {
    rail: 9,
    'rail+rib': 7,
    rib: 27,
    'rib+rib': 14,
    wall: 1,
  },
  'wishbone/tie': {
    rail: 13,
    'rail+rib': 8,
    rib: 29,
    'rib+rib': 15,
    wall: 1,
  },
  'wishbone/flow': {
    rail: 13,
    'rail+rib': 8,
    rib: 27,
    'rib+rib': 12,
    wall: 1,
  },
};

/** Each drop's outer face is checked this far in from its ends, and this far in or out of it. */
const END = 0.3;
const OFF = 0.05;

const inside = (cs: CrossSection, x: number, y: number) =>
  cs
    .intersect(
      new wasm.CrossSection([
        [
          [x - 0.01, y - 0.01],
          [x + 0.01, y - 0.01],
          [x + 0.01, y + 0.01],
          [x - 0.01, y + 0.01],
        ],
      ]),
    )
    .area() > 1e-5;

for (const walls of ['none', 'flare', 'pillars', 'wishbone'])
  for (const ends of ['none', 'tie', 'flow']) {
    const key = `${walls}/${ends}`;
    const p = clone(defaults);
    Object.assign(p.config.chassis, { walls, ends });

    test(`Skeletyl ${key}: the seams by junction class are no more than pinned`, () => {
      const r = skeletylSeams(wasm, p.config);
      assert.equal(r.drawn.decompose().length, 1, 'one piece');
      assert.equal(
        new wasm.CrossSection([r.outline], 'NonZero').decompose().length,
        1,
        'one footprint',
      );
      const got: Record<string, number> = {};
      for (const s of r.seams) got[classOf(s)] = (got[classOf(s)] ?? 0) + 1;
      const pin = PINS[key] ?? {};
      const over = Object.entries(got).filter(([c, n]) => n > (pin[c] ?? 0));
      assert.deepEqual(
        over,
        [],
        `${key}: over the pins (class, spots): ${JSON.stringify(got)} vs ${JSON.stringify(pin)}\n` +
          r.seams
            .filter((s) => over.some(([c]) => c === classOf(s)))
            .map(
              (s) =>
                `  ${classOf(s)} ${s.kind} at ${s.at.map((x) => x.toFixed(1))} ${s.parts.join(' | ')}`,
            )
            .join('\n'),
      );
    });

    test(`Skeletyl ${key}: every drop's outer face is flush with the rail over its whole height`, () => {
      const frames = componentFrames(p.config);
      const built = skeletyl(wasm, p.config, frames, wiring(p.config, frames).wires);
      const parts = built.parts();
      const under: Manifold = wasm.Manifold.union(
        parts.filter((q) => q.name === 'rail' || q.name === 'tie').map((q) => q.solid),
      );
      assert(built.drops.length > 0);
      const bad: string[] = [];
      for (const dr of built.drops) {
        const at = (c: number, m: number): [number, number] => [
          dr.p[0] + c * dr.c[0] + m * dr.n[0],
          dr.p[1] + c * dr.c[1] + m * dr.n[1],
        ];
        const cs: number[] = [];
        for (let c = -dr.half + END; c <= dr.half - END; c += 0.5) cs.push(c);
        // The rail (or the tie) is level at the foot's height under it.
        const [over, below] = [under.slice(dr.foot + 0.02), under.slice(dr.foot - 0.02)];
        for (const c of cs) {
          if (inside(over, ...at(c, -0.5)))
            bad.push(`${dr.name} ${dr.e}: rail above its foot at ${c}`);
          if (!inside(below, ...at(c, -0.5)))
            bad.push(`${dr.name} ${dr.e}: rail not under its foot at ${c}`);
        }
        // Its foot runs at least dropBend below where its round ends.
        if (dr.foot > dr.low - SIZES.dropBend + 1e-6)
          bad.push(`${dr.name} ${dr.e}: foot ${dr.foot} too near the round's end ${dr.low}`);
        // The frame's face is the plane of its outer face, the floor to its foot.
        for (let z = 0.1; z < dr.foot - OFF; z += 0.5) {
          const s = built.frame.slice(z);
          for (const c of cs) {
            if (!inside(s, ...at(c, -OFF)))
              bad.push(`${dr.name} ${dr.e}: notch at c ${c.toFixed(1)}, z ${z}`);
            if (inside(s, ...at(c, OFF)))
              bad.push(`${dr.name} ${dr.e}: proud at c ${c.toFixed(1)}, z ${z}`);
          }
        }
      }
      assert.deepEqual(bad.slice(0, 20), []);
    });
  }
