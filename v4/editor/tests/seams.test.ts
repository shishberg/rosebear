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
 *    of FUSED_SLIVERS). Both stand straight down: the outline steps in 0.5 mm
 *    from the index's face to the middle's at the junction (rail). On tie, one more: the inner's and index's front drops
 *    stand side by side on the tie, about 1.6 mm apart.
 *  - rib: a rib's own seams where it is cut (the joined ends, the switch
 *    seats' trims meeting a rounded end) and its sweep's own slivers, the
 *    thumb row's and the extra keys' among them. The union triangulates a rib
 *    differently with every change near it, though the rib is unchanged
 *    triangle for triangle: on flow, the thumb row's low front foot shows 3
 *    creases and ledges of the rail's unsubdivided dip under it (footKey).
 *  - rail: the rail's own corners where its outline turns tighter than the
 *    mesh (the straight outline's corners, and its one turn in, at the front),
 *    and
 *    the tie's strip and fillets meeting it. The outline turns in at each
 *    drop's corners and runs straight on to the next (trimmed), so it has
 *    a corner at each side of a drop standing in from the hull (the ring's
 *    and pinky's backs, the pinky's front), each a spot or two where the
 *    rail's top and bottom are triangulated, and a 0.5 mm step between the
 *    index's and middle's back drops (a ledge and a gap). The rail is level
 *    round a low drop's foot as a piece of its own (Dip.patch), which leaves
 *    a sliver or a shading where its sides meet the rest.
 *  - rail+rib: where a column front hangs joined into a thumb plate (flow),
 *    the rail's inner edge passing under a rib's sweep near its foot, the
 *    foot of the index and middle back drops' junction (where it passes
 *    through flush, at the bottom of the same line) and of the index's
 *    beside the inner's. The rail's inner edge also bends round the
 *    junction's step (rail). The extra keys' front drop and the pinky's
 *    meet the rail where it dips to them. Every drop's foot is keyed into the
 *    rail or tie (footKey), so no foot meets it edge to edge; on tie the
 *    drops stand wholly on the tie, clear of its bends and fillets by tieGap.
 *  - tie and flow, every walls: re-pinned when the drops on the tie were
 *    moved clear of the tie's fillet into the rail on its sharper side,
 *    where the tie meets the rail off square (floorTie): the inner front
 *    drop's end had stood about 1 mm into it, and more with pillars or
 *    wishbone, the rail further out. The inner front drop stands further
 *    along the tie, and the rail, the tie and the ribs near it are cut
 *    differently: fewer spots on tie, as many on flow, moved between classes.
 *  - rail+wall, rib+wall, wall (flare): the flare walls reach 0.2 mm into the
 *    rib and the rail (the WallSide contract), so they meet them near tangent,
 *    and stand at railHeight even where the rail dips to a low drop. At a
 *    hanging end the skirt stops short of the round's last point, so it never
 *    lies on the round's face.
 *  - arches, truss and bones: their walls' classes (rail+wall, rib+wall,
 *    wall, and rail+rib+wall) are pinned as they stand, from when they joined
 *    this test, again when the extra keys went into the default (their
 *    row an outer side with walls of its own), and again when the outline
 *    went straight (the walls at the back corners and the pinky's front
 *    corner, standing on its rail, reshaped with it), and again when the
 *    drops stopped twisting (the outline stepping in at the drops and
 *    running straight from their corners, so the walls along the pinky and
 *    the back stand differently; on arches the piers and the solid walls
 *    between them became one sweep, which removes most of their spots):
 *    their prototypes' own joints (piers and crowns, struts, limbs'
 *    fillets), not the frame's.
 *  - pillars and wishbone: the outline's hull takes in the limbs' feet, so
 *    its inner side runs straight along them, 5 to 6 mm further out than
 *    without them, and turns in to the inner column's front drops where
 *    they stand: the rail's corners and its meeting with those drops and the thumbs'
 *    (rail, rail+rib) are cut differently there. rib+wall: each limb's root
 *    stands on its web's own outer edge, its sides upright; where the web
 *    slopes (the pinky's, 28°, and the inner home and top keys', 24°) the
 *    sides meet its sloping face square, which the check counts as creases
 *    (it lets only square creases onto level or upright faces pass), with a
 *    sliver or a shading where a side crosses the face between the mesh's
 *    points. rail+wall (pillars): the inner bottom and home keys' pillar,
 *    turned 0.8° to stand along the run, its inner face and the rail's inner
 *    side a few microns apart. wall (pillars): one sliver of no area on a
 *    straight edge of the inner home and top keys' fork, where the rib's
 *    straight end (LAP) lies in the fork's shape, its corner on the shape's
 *    edge (on wishbone that fork is turned to the run, and its rib twists
 *    to it first, which leaves none).
 */
const PINS: Record<string, Record<string, number>> = {
  'none/none': {
    rail: 15,
    'rail+rib': 8,
    rib: 30,
    'rib+rib': 6,
  },
  'none/tie': {
    rail: 15,
    'rail+rib': 8,
    rib: 32,
    'rib+rib': 7,
  },
  'none/flow': {
    rail: 14,
    'rail+rib': 8,
    rib: 28,
    'rib+rib': 4,
  },
  'flare/none': {
    rail: 16,
    'rail+rib': 5,
    'rail+rib+wall': 9,
    'rail+wall': 29,
    rib: 27,
    'rib+rib': 6,
    'rib+wall': 48,
    wall: 28,
  },
  'flare/tie': {
    rail: 17,
    'rail+rib': 5,
    'rail+rib+wall': 10,
    'rail+wall': 30,
    rib: 29,
    'rib+rib': 7,
    'rib+wall': 48,
    wall: 28,
  },
  'flare/flow': {
    rail: 16,
    'rail+rib': 5,
    'rail+rib+wall': 9,
    'rail+wall': 29,
    rib: 25,
    'rib+rib': 4,
    'rib+wall': 40,
    wall: 26,
  },
  'arches/none': {
    rail: 15,
    'rail+rib': 8,
    'rail+wall': 2,
    rib: 30,
    'rib+rib': 6,
    'rib+wall': 14,
    wall: 2,
  },
  'arches/tie': {
    rail: 15,
    'rail+rib': 8,
    'rail+wall': 2,
    rib: 32,
    'rib+rib': 7,
    'rib+wall': 14,
    wall: 2,
  },
  'arches/flow': {
    rail: 14,
    'rail+rib': 8,
    'rail+wall': 1,
    rib: 29,
    'rib+rib': 4,
    'rib+wall': 8,
    wall: 4,
  },
  'truss/none': {
    rail: 18,
    'rail+rib': 6,
    'rail+rib+wall': 7,
    'rail+wall': 32,
    rib: 26,
    'rib+rib': 6,
    'rib+wall': 36,
    wall: 79,
  },
  'truss/tie': {
    rail: 19,
    'rail+rib': 6,
    'rail+rib+wall': 7,
    'rail+wall': 36,
    rib: 27,
    'rib+rib': 7,
    'rib+wall': 36,
    wall: 94,
  },
  'truss/flow': {
    rail: 17,
    'rail+rib': 6,
    'rail+rib+wall': 7,
    'rail+wall': 39,
    rib: 25,
    'rib+rib': 4,
    'rib+wall': 37,
    wall: 80,
  },
  'bones/none': {
    rail: 19,
    'rail+rib': 8,
    'rail+wall': 40,
    rib: 30,
    'rib+rib': 6,
    'rib+wall': 16,
    wall: 21,
  },
  'bones/tie': {
    rail: 20,
    'rail+rib': 8,
    'rail+wall': 40,
    rib: 32,
    'rib+rib': 7,
    'rib+wall': 16,
    wall: 21,
  },
  'bones/flow': {
    rail: 17,
    'rail+rib': 8,
    'rail+wall': 37,
    rib: 28,
    'rib+rib': 4,
    'rib+wall': 21,
    wall: 15,
  },
  'pillars/none': {
    rail: 18,
    'rail+rib': 9,
    'rail+wall': 1,
    rib: 29,
    'rib+rib': 6,
    'rib+wall': 7,
    wall: 1,
  },
  'pillars/tie': {
    rail: 22,
    'rail+rib': 9,
    'rail+wall': 1,
    rib: 31,
    'rib+rib': 7,
    'rib+wall': 7,
    wall: 1,
  },
  'pillars/flow': {
    rail: 17,
    'rail+rib': 9,
    'rail+wall': 1,
    rib: 27,
    'rib+rib': 4,
    'rib+wall': 8,
    wall: 1,
  },
  'wishbone/none': {
    rail: 18,
    'rail+rib': 9,
    rib: 29,
    'rib+rib': 6,
    'rib+wall': 7,
  },
  'wishbone/tie': {
    rail: 21,
    'rail+rib': 9,
    rib: 31,
    'rib+rib': 7,
    'rib+wall': 7,
  },
  'wishbone/flow': {
    rail: 16,
    'rail+rib': 9,
    rib: 27,
    'rib+rib': 4,
    'rib+wall': 8,
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
