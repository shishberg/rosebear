// The seam check (tests/seams.ts) on Swung in, ?walls= none and flare by
// ?ends= none, tie and flow: the frame builds as one piece on one footprint,
// every drop stands flush on the rail, and the seams found between each class
// of parts (rib, band, rail or tie, wall) are no more than they were when
// pinned. A class's count can only fall: if it falls, lower its pin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import type { CrossSection, Manifold } from 'manifold-3d';
import { clone, componentFrames, defaults } from '../src/geometry';
import { SIZES, skeletyl } from '../src/skeletyl';
import { skeletylSeams, type Seam } from './seams';

const wasm = await Module();
wasm.setup();

/** The class of junction a seam is in: the kinds of part meeting there. */
const kindOf = (name: string) =>
  name.startsWith('band')
    ? 'band'
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
 *  - band, band+rail, band+rib: the bands between neighbouring columns' back
 *    drops are to go (small bridges between adjacent ribs' keys replace them),
 *    so their junctions are left as they are.
 *  - rib+rib: the pinky's back drop and thumb #2 cross (a layout collision,
 *    not a junction to blend), and the thumb fork's ribs meet at their plates.
 *  - rib: a rib's own seams where it is cut (the joined ends, the switch
 *    seats' trims meeting a rounded end) and its sweep's own slivers.
 *  - rail: the rail's own corners where its outline turns tighter than the
 *    mesh, and the tie's strip and fillets meeting it (flow, at the thumbs).
 *  - rail+rib: where a column front hangs joined into a thumb plate (flow),
 *    and the rail's inner edge passing under a rib's sweep near its foot.
 *  - rail+wall, rib+wall, wall (flare): the flare walls reach 0.2 mm into the
 *    rib and the rail (the WallSide contract), so they meet them near tangent,
 *    and stand at railHeight even where the rail dips to a low drop.
 */
const PINS: Record<string, Record<string, number>> = {
  'none/none': {
    'band+rail': 2,
    'band+rail+rib': 6,
    'band+rib': 33,
    rail: 7,
    'rail+rib': 4,
    rib: 27,
    'rib+rib': 9,
  },
  'none/tie': {
    'band+rail': 2,
    'band+rail+rib': 6,
    'band+rib': 45,
    rail: 6,
    'rail+rib': 5,
    rib: 30,
    'rib+rib': 9,
  },
  'none/flow': {
    'band+rail': 2,
    'band+rail+rib': 6,
    'band+rib': 33,
    rail: 11,
    'rail+rib': 5,
    rib: 27,
    'rib+rib': 7,
  },
  'flare/none': {
    'band+rail': 2,
    'band+rail+rib': 6,
    'band+rib': 33,
    rail: 7,
    'rail+rib': 3,
    'rail+rib+wall': 2,
    'rail+wall': 35,
    rib: 25,
    'rib+rib': 9,
    'rib+wall': 45,
    wall: 25,
  },
  'flare/tie': {
    'band+rail': 2,
    'band+rail+rib': 6,
    'band+rib': 45,
    rail: 7,
    'rail+rib': 4,
    'rail+rib+wall': 3,
    'rail+wall': 37,
    rib: 28,
    'rib+rib': 9,
    'rib+wall': 44,
    wall: 25,
  },
  'flare/flow': {
    'band+rail': 2,
    'band+rail+rib': 6,
    'band+rib': 33,
    rail: 12,
    'rail+rib': 4,
    'rail+rib+wall': 2,
    'rail+wall': 35,
    rib: 25,
    'rib+rib': 7,
    'rib+wall': 45,
    wall: 25,
  },
};

/** Each drop's outer face is checked this far in from its ends, and this far in or out of it. */
const END = 0.3;
const OFF = 0.05;
/** Near a band, the drop's end is checked only this far in: the band's junction is left as it is. */
const BAND_END = 1;

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

for (const walls of ['none', 'flare'])
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
      const built = skeletyl(wasm, p.config, componentFrames(p.config));
      const parts = built.parts();
      const under: Manifold = wasm.Manifold.union(
        parts.filter((q) => q.name === 'rail' || q.name === 'tie').map((q) => q.solid),
      );
      const bands = parts.filter((q) => q.name.startsWith('band'));
      assert(built.drops.length > 0);
      const bad: string[] = [];
      for (const dr of built.drops) {
        const at = (c: number, m: number): [number, number] => [
          dr.p[0] + c * dr.c[0] + m * dr.n[0],
          dr.p[1] + c * dr.c[1] + m * dr.n[1],
        ];
        // How far in from each end to check: END, or BAND_END where a band meets that end.
        const end = [-1, 1].map((s) =>
          bands.some((b) => {
            const box = b.solid.boundingBox();
            const q = at(s * dr.half, 0);
            return q.every((x, i) => x > box.min[i] - 0.5 && x < box.max[i] + 0.5);
          })
            ? BAND_END
            : END,
        );
        const cs: number[] = [];
        for (let c = -dr.half + end[0]; c <= dr.half - end[1]; c += 0.5) cs.push(c);
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
