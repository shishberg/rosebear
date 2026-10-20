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
 *    triangle for triangle. A low end (the thumb row's far key's front and
 *    the second extra key's) is cut off level with the rail's top (lowCut),
 *    and so is its plate's underside where that comes lower, beside the
 *    rail's inner edge: a shading each.
 *  - rail: the rail's own corners where its outline turns tighter than the
 *    mesh (the straight outline's corners, and its one turn in, at the front),
 *    and
 *    the tie's strip and fillets meeting it. The outline turns in at each
 *    drop's corners and runs straight on to the next (trimmed), so it has
 *    a corner at each side of a drop standing in from the hull (the ring's
 *    and pinky's backs, the pinky's front), each a spot or two where the
 *    rail's top and bottom are triangulated, and a 0.5 mm step between the
 *    index's and middle's back drops (a ledge and a gap). The rail is level
 *    everywhere, never dipping: under the second extra key's front it stands
 *    in the band beside its plate's edge, over the tile pocket, a sliver
 *    there.
 *  - rail+rib: where a column front hangs joined into a thumb plate (flow),
 *    the rail's inner edge passing under a rib's sweep near its foot, the
 *    foot of the index and middle back drops' junction (where it passes
 *    through flush, at the bottom of the same line) and of the index's
 *    beside the inner's. The rail's inner edge also bends round the
 *    junction's step (rail). The two low ends stand on the rail's top, their
 *    faces its faces (lowDrop, lowCut): the second extra key's lower side
 *    ends 0.28 mm in from where the outline turns in along it (a ledge), and
 *    its plate's underside meets the rail's top at 15° just inside its inner
 *    corner (a crease). Every other drop's foot is keyed into the
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
 *    rib and the rail (the WallSide contract), so they meet them near tangent.
 *    At a hanging end the skirt stops short of the round's last point, so it
 *    never lies on the round's face. At the thumb row's far key's low front
 *    the skirt stops two points short of where the round stops, where they
 *    stand nearly one over another, 0.06 mm in from the end's face: a crease,
 *    a gap, a thin skin, a 0.02 mm ledge and a sliver there.
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
 *    its inner side runs straight along them, 2.6 to 2.7 mm further out than
 *    without them, and turns in to the inner column's front drops where
 *    they stand: the rail's corners and its meeting with those drops and the thumbs'
 *    (rail, rail+rib) are cut differently there; and where the run passes
 *    the pinky's pillar's foot and the inner home and top keys' fork's back
 *    leg's, the rail's inner edge has two points 0.01 mm and a few nm apart,
 *    a sliver each (rail). rib+wall: each limb's root stands on its web's own
 *    outer edge, its sides upright; where the web slopes (the pinky's, 28°,
 *    and the inner home and top keys', 24°) the sides meet its sloping face
 *    square, which the check counts as creases (it lets only square creases
 *    onto level or upright faces pass). (The root's corners, on the edge
 *    between its points, are rounded to the floats just inside the rib:
 *    rounded out past it, each left a sliver of no area and a shading.)
 *    rail+wall (pillars/none): the inner bottom and home keys' pillar,
 *    turned 0.8° to stand along the run, its inner face and the rail's inner
 *    side a few microns apart. Re-pinned when the limbs turned down in rounds
 *    as tight as their section allows, after a 0.5 mm lip, nearest first,
 *    the inner column's standing 2.6 to 3.3 mm nearer their webs and the
 *    pinky's 0.4 mm, and a new pillar at the pinky's front web: the rail
 *    moved in with their feet, so its spots and the drops' near it moved
 *    (rail down 1 to 6, rail+rib down 1 and rib up 1 on pillars/none, where
 *    a thumb's shading near the rail's top no longer touches it, rib up 1 on
 *    pillars/tie, a sliver at the pinky's front drop's foot); rail+wall up 1
 *    or 2 (and wall down 1 on wishbone): the sliver of no area at the inner
 *    home and top keys' fork's foot, where a leg's inner face's bottom corner
 *    lies on the rail's inner top edge, is now a shading at its back leg's,
 *    and the new pinky front pillar, turned to stand along the run, has its
 *    inner face and the rail's inner side a few microns apart (not on tie).
 *  - glue posts: each leg goes 0.3 mm up into the web or the rib's end over
 *    it, its top following that underside, so the union splits the frame's
 *    faces along where they meet; what that leaves within postMeet of a leg
 *    is meant (as the leg is). Down: rib by 1 to 4 and rib+rib by 1 on every
 *    combination (spots that sat where the legs now are), rib+wall on truss
 *    and bones (by up to 8) and arches/flow. Up: flare's wall by 6 to 8 and
 *    rib+wall by 1 or 2 (its inner column's outer legs and the pinky's stand
 *    in under the walls, flush with the plate's side, and hide the middle of
 *    a wall's seam with the plate, which then counts as two spots), arches'
 *    wall by 1 or 2, truss's and bones/flow's by 1 (a wall coming down beside
 *    a leg's end), and rail by 1 on every tie (a sliver of no area on the tie
 *    1.2 mm below the pinky home's leg).
 *  - the level rail (PROTOTYPE): the rail no longer dips to a low end, which
 *    stands on its level top instead (lowDrop, lowCut), and the rail is the
 *    outline extruded as it is (simplified, the drops' corners put back), no
 *    longer cut into dipMesh lengths and warped. Down: rail by 1 to 6 on
 *    every combination but truss/flow, rail+rib by 1 on every combination,
 *    flare's rail+rib+wall by 5 or 6, truss's wall by 1 or 3, truss/flow's
 *    and bones/flow's rail+wall by 1. Up: flare's rail+wall by 4 to 8 and
 *    truss/none's by 1 (the walls' feet meeting the rail's plainer sides
 *    differently, along the sides and at the back), flare's rib+wall by 2
 *    or 3 and wall by 2 (where its skirt stops at the thumb row's far key's
 *    front, above).
 *  - round corner posts: each corner post is the whole round in its notch,
 *    one cut with its edge's legs and shelves, which now stop with the legs
 *    0.15 mm inside the plate's side below it too (not flush with it), and the
 *    seat's trim leaves the notches below the plate. Down: rib by 1 on every
 *    combination (a sliver on the ring's front end beside the pinky's bottom
 *    key; on flow, the index's crease beside the thumb row's near key's
 *    corner post), flare's wall by 1 to 3 (shadings and a sliver where its
 *    walls pass the inner bottom key's and the thumb row's near key's posts).
 */
const PINS: Record<string, Record<string, number>> = {
  'none/none': {
    rail: 11,
    'rail+rib': 7,
    rib: 25,
    'rib+rib': 5,
  },
  'none/tie': {
    rail: 10,
    'rail+rib': 7,
    rib: 27,
    'rib+rib': 6,
  },
  'none/flow': {
    rail: 10,
    'rail+rib': 7,
    rib: 25,
    'rib+rib': 4,
  },
  'flare/none': {
    rail: 15,
    'rail+rib': 5,
    'rail+rib+wall': 4,
    'rail+wall': 35,
    rib: 25,
    'rib+rib': 5,
    'rib+wall': 51,
    wall: 36,
  },
  'flare/tie': {
    rail: 12,
    'rail+rib': 5,
    'rail+rib+wall': 4,
    'rail+wall': 34,
    rib: 27,
    'rib+rib': 6,
    'rib+wall': 53,
    wall: 35,
  },
  'flare/flow': {
    rail: 12,
    'rail+rib': 5,
    'rail+rib+wall': 4,
    'rail+wall': 37,
    rib: 24,
    'rib+rib': 4,
    'rib+wall': 44,
    wall: 33,
  },
  'arches/none': {
    rail: 11,
    'rail+rib': 7,
    'rail+wall': 2,
    rib: 25,
    'rib+rib': 5,
    'rib+wall': 14,
    wall: 4,
  },
  'arches/tie': {
    rail: 10,
    'rail+rib': 7,
    'rail+wall': 2,
    rib: 27,
    'rib+rib': 6,
    'rib+wall': 14,
    wall: 4,
  },
  'arches/flow': {
    rail: 10,
    'rail+rib': 7,
    'rail+wall': 1,
    rib: 25,
    'rib+rib': 4,
    'rib+wall': 7,
    wall: 5,
  },
  'truss/none': {
    rail: 15,
    'rail+rib': 5,
    'rail+rib+wall': 7,
    'rail+wall': 33,
    rib: 23,
    'rib+rib': 5,
    'rib+wall': 35,
    wall: 79,
  },
  'truss/tie': {
    rail: 14,
    'rail+rib': 5,
    'rail+rib+wall': 7,
    'rail+wall': 36,
    rib: 25,
    'rib+rib': 6,
    'rib+wall': 33,
    wall: 91,
  },
  'truss/flow': {
    rail: 17,
    'rail+rib': 5,
    'rail+rib+wall': 7,
    'rail+wall': 38,
    rib: 24,
    'rib+rib': 4,
    'rib+wall': 31,
    wall: 81,
  },
  'bones/none': {
    rail: 14,
    'rail+rib': 7,
    'rail+wall': 40,
    rib: 26,
    'rib+rib': 5,
    'rib+wall': 9,
    wall: 20,
  },
  'bones/tie': {
    rail: 15,
    'rail+rib': 7,
    'rail+wall': 40,
    rib: 28,
    'rib+rib': 6,
    'rib+wall': 9,
    wall: 20,
  },
  'bones/flow': {
    rail: 13,
    'rail+rib': 7,
    'rail+wall': 36,
    rib: 26,
    'rib+rib': 4,
    'rib+wall': 13,
    wall: 16,
  },
  'pillars/none': {
    rail: 14,
    'rail+rib': 7,
    'rail+wall': 3,
    rib: 25,
    'rib+rib': 5,
    'rib+wall': 4,
  },
  'pillars/tie': {
    rail: 12,
    'rail+rib': 8,
    'rail+wall': 1,
    rib: 27,
    'rib+rib': 6,
    'rib+wall': 4,
  },
  'pillars/flow': {
    rail: 13,
    'rail+rib': 8,
    'rail+wall': 2,
    rib: 24,
    'rib+rib': 4,
    'rib+wall': 4,
  },
  'wishbone/none': {
    rail: 13,
    'rail+rib': 8,
    'rail+wall': 2,
    rib: 24,
    'rib+rib': 5,
    'rib+wall': 4,
  },
  'wishbone/tie': {
    rail: 15,
    'rail+rib': 8,
    'rail+wall': 1,
    rib: 26,
    'rib+rib': 6,
    'rib+wall': 4,
  },
  'wishbone/flow': {
    rail: 12,
    'rail+rib': 8,
    'rail+wall': 2,
    rib: 24,
    'rib+rib': 4,
    'rib+wall': 4,
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
      // The rail (and the tie) is level: railHeight high, the same plan all the way up.
      const H = SIZES.railHeight;
      assert(Math.abs(under.boundingBox().max[2] - H) < 1e-6, 'rail top at railHeight');
      const [foot, top] = [under.slice(0.02).area(), under.slice(H - 0.02).area()];
      assert(Math.abs(foot - top) < 1e-3 * foot, `rail level: ${foot} vs ${top} mm²`);
      for (const dr of built.drops) {
        const at = (c: number, m: number): [number, number] => [
          dr.p[0] + c * dr.c[0] + m * dr.n[0],
          dr.p[1] + c * dr.c[1] + m * dr.n[1],
        ];
        const cs: number[] = [];
        // Where it is fused, its side runs into its neighbour's: only its own face is checked.
        for (let c = dr.free[0] + END; c <= dr.free[1] - END; c += 0.5) cs.push(c);
        // The rail (or the tie) runs under its foot.
        const [over, below] = [under.slice(H + 0.02), under.slice(H - 0.02)];
        for (const c of cs) {
          if (inside(over, ...at(c, -0.5)))
            bad.push(`${dr.name} ${dr.e}: rail above its foot at ${c}`);
          if (!inside(below, ...at(c, -0.5)))
            bad.push(`${dr.name} ${dr.e}: rail not under its foot at ${c}`);
        }
        // Its foot runs at least dropBend below where its round ends, or
        // it is a low end, come down into the rail.
        if (!dr.into && H > dr.low - SIZES.dropBend + 1e-6)
          bad.push(`${dr.name} ${dr.e}: foot too near the round's end ${dr.low}`);
        if (dr.into && !(dr.low < H + SIZES.dropBend))
          bad.push(`${dr.name} ${dr.e}: into the rail, but its round ends at ${dr.low}`);
        // The frame's face is the plane of its outer face, the floor to its foot.
        for (let z = 0.1; z < H - OFF; z += 0.5) {
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
