// The seam check (tests/seams.ts) on Swung in, every ?walls= by ?ends= none,
// tie and flow: the frame builds as one piece on one footprint, every drop
// stands flush on the rail (but where a fused neighbour overlaps it), and the
// seams found between each class of parts (rib, bridge, rail or tie, wall)
// are no more than they were when pinned. A class's count can only fall: if
// it falls, lower its pin. No class with a bridge in it is pinned: bridges
// must meet the ribs cleanly. Two fused drops' ribs leave no gap or thin
// skin between them (no slit), and no more slivers than FUSED_SLIVERS.
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
 *  - rib+rib: the middle's and ring's front drops meet in a ledge, and the inner's and
 *    index's back drops shade each other's tops where they stand close. The
 *    index's and middle's back drops are fused (their facing corners 0.1 mm
 *    apart): widened into each other, they meet along one crisp line, the
 *    prouder face's side standing over the other's (the middle's below about
 *    19.5 mm, the index's above, where the faces pass through flush), one
 *    spot for the whole line; one sliver of no area near its top, where the
 *    index's widened side meets the middle's round as it turns away (a spot
 *    of FUSED_SLIVERS).
 *  - rib: a rib's own seams where it is cut (the joined ends, the switch
 *    seats' trims meeting a rounded end) and its sweep's own slivers, the
 *    thumb row's and the extra keys' among them. On flow, 4 or 5 more on the
 *    thumb row came with the fused drops, though that rib is unchanged
 *    triangle for triangle and far from them: the union's output is
 *    triangulated differently there.
 *  - rail: the rail's own corners where its outline turns tighter than the
 *    mesh (now also turning in round the corners between the back drops,
 *    where the bands stood), and the tie's strip and fillets meeting it
 *    (flow, at the thumbs).
 *  - rail+rib: where a column front hangs joined into a thumb plate (flow),
 *    the rail's inner edge passing under a rib's sweep near its foot, the
 *    foot of the index and middle back drops' junction (where it passes
 *    through flush, at the bottom of the same line) and of the index's
 *    beside the inner's. The rail's inner edge also bends round the
 *    junction's step (rail). The extra keys' front drop and the pinky's
 *    (which stands on the rail now that x2 is not under it) meet the rail
 *    where it dips to them. On tie, the inner's front drop stands only
 *    partly on the tie (ledges; see the flush test below) and the extra
 *    keys' back drop meets the tie in a thin skin.
 *  - rail+wall, rib+wall, wall (flare): the flare walls reach 0.2 mm into the
 *    rib and the rail (the WallSide contract), so they meet them near tangent,
 *    and stand at railHeight even where the rail dips to a low drop.
 *  - arches, truss and bones: their walls' classes (rail+wall, rib+wall,
 *    wall, and rail+rib+wall) are pinned as they stand, from when they joined
 *    this test and again when the extra keys went into the default (their
 *    row an outer side with walls of its own): their prototypes' own joints
 *    (piers and crowns, struts, limbs' fillets), not the frame's.
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
    rail: 11,
    'rail+rib': 14,
    rib: 33,
    'rib+rib': 6,
  },
  'none/tie': {
    rail: 12,
    'rail+rib': 18,
    rib: 36,
    'rib+rib': 6,
  },
  'none/flow': {
    rail: 14,
    'rail+rib': 15,
    rib: 31,
    'rib+rib': 4,
  },
  'flare/none': {
    rail: 13,
    'rail+rib': 11,
    'rail+rib+wall': 4,
    'rail+wall': 32,
    rib: 30,
    'rib+rib': 6,
    'rib+wall': 53,
    wall: 44,
  },
  'flare/tie': {
    rail: 16,
    'rail+rib': 15,
    'rail+rib+wall': 5,
    'rail+wall': 31,
    rib: 34,
    'rib+rib': 6,
    'rib+wall': 57,
    wall: 48,
  },
  'flare/flow': {
    rail: 16,
    'rail+rib': 14,
    'rail+rib+wall': 4,
    'rail+wall': 30,
    rib: 27,
    'rib+rib': 4,
    'rib+wall': 44,
    wall: 26,
  },
  'arches/none': {
    rail: 13,
    'rail+rib': 12,
    'rail+rib+wall': 5,
    'rail+wall': 11,
    rib: 33,
    'rib+rib': 6,
    'rib+wall': 22,
    wall: 11,
  },
  'arches/tie': {
    rail: 14,
    'rail+rib': 16,
    'rail+rib+wall': 5,
    'rail+wall': 11,
    rib: 36,
    'rib+rib': 6,
    'rib+wall': 22,
    wall: 11,
  },
  'arches/flow': {
    rail: 16,
    'rail+rib': 15,
    'rail+rib+wall': 5,
    'rail+wall': 8,
    rib: 32,
    'rib+rib': 4,
    'rib+wall': 16,
    wall: 13,
  },
  'truss/none': {
    rail: 14,
    'rail+rib': 11,
    'rail+rib+wall': 7,
    'rail+wall': 33,
    rib: 29,
    'rib+rib': 6,
    'rib+wall': 40,
    wall: 81,
  },
  'truss/tie': {
    rail: 14,
    'rail+rib': 14,
    'rail+rib+wall': 9,
    'rail+wall': 39,
    rib: 32,
    'rib+rib': 6,
    'rib+wall': 41,
    wall: 102,
  },
  'truss/flow': {
    rail: 19,
    'rail+rib': 11,
    'rail+rib+wall': 7,
    'rail+wall': 41,
    rib: 27,
    'rib+rib': 4,
    'rib+wall': 41,
    wall: 85,
  },
  'bones/none': {
    rail: 13,
    'rail+rib': 14,
    'rail+wall': 44,
    rib: 33,
    'rib+rib': 6,
    'rib+wall': 17,
    wall: 22,
  },
  'bones/tie': {
    rail: 14,
    'rail+rib': 18,
    'rail+wall': 41,
    rib: 36,
    'rib+rib': 6,
    'rib+wall': 17,
    wall: 18,
  },
  'bones/flow': {
    rail: 16,
    'rail+rib': 12,
    'rail+rib+wall': 1,
    'rail+wall': 35,
    rib: 31,
    'rib+rib': 4,
    'rib+wall': 27,
    wall: 15,
  },
  'pillars/none': {
    rail: 12,
    'rail+rib': 14,
    rib: 32,
    'rib+rib': 6,
  },
  'pillars/tie': {
    rail: 13,
    'rail+rib': 18,
    rib: 36,
    'rib+rib': 6,
  },
  'pillars/flow': {
    rail: 13,
    'rail+rib': 14,
    rib: 29,
    'rib+rib': 4,
  },
  'wishbone/none': {
    rail: 12,
    'rail+rib': 14,
    rib: 32,
    'rib+rib': 6,
    wall: 1,
  },
  'wishbone/tie': {
    rail: 13,
    'rail+rib': 18,
    rib: 36,
    'rib+rib': 6,
    wall: 1,
  },
  'wishbone/flow': {
    rail: 13,
    'rail+rib': 14,
    rib: 29,
    'rib+rib': 4,
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

/** Slivers allowed between two fused drops' ribs (see rib+rib above). */
const FUSED_SLIVERS = 1;

for (const walls of ['none', 'flare', 'arches', 'truss', 'bones', 'pillars', 'wishbone'])
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
      // Fused drops meet along a line: no gap, no thin skin, no slit.
      for (const f of r.fused) {
        const at = r.seams.filter((s) => f.names.every((n) => s.parts.includes(n)));
        const say = (k: string) =>
          `${f.names.join('+')}: ${k} ` +
          at.map((s) => `${s.kind} at ${s.at.map((x) => x.toFixed(1))}`).join('; ');
        assert.deepEqual(
          at.filter((s) => s.kind === 'gap' || s.kind === 'thin'),
          [],
          say('gap or slit'),
        );
        assert(at.filter((s) => s.kind === 'sliver').length <= FUSED_SLIVERS, say('slivers'));
      }
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
        // Where it is fused, its side runs into its neighbour's: only its own face is checked.
        for (let c = dr.free[0] + END; c <= dr.free[1] - END; c += 0.5) cs.push(c);
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
