import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { Matrix4 } from 'three';
import { defaults, clone, componentFrames } from '../src/geometry';
import { box, freeAfter } from '../src/manifold-util';
import { RegionIndex } from '../src/regions';
import { clipBox, seatBox, seatSwitches } from '../src/seats';
import { checkOpenings, checkSeats, keyRegions, makeProbe, type Keys } from '../src/solid';

const wasm = await Module();
wasm.setup();
const M = wasm.Manifold;
const bounds = (m: { boundingBox(): { min: number[]; max: number[] } }) => m.boundingBox();
const near = (a: number[], b: number[]) => a.forEach((x, i) => assert(Math.abs(x - b[i]) < 1e-9));

test('a region index cuts the same overlap as the whole shape, wherever the envelope sits', () => {
  freeAfter(wasm, () => {
    const target = M.cylinder(40, 30, 30, 48, true);
    const tilt = new Matrix4().makeRotationY(0.4).setPosition(5, 2, 1);
    const flat = new Matrix4().makeTranslation(-20, 0, 0);
    const index = new RegionIndex(
      M,
      [
        { frame: tilt, half: [6, 6], group: 'a' },
        { frame: flat, half: [6, 6], group: 'a' },
      ],
      10,
      0.1,
    );
    const envelopes = [
      // inside the tilted region, tilted with it
      box(M, [8, 8, 8]).transform(tilt.elements as never),
      // inside the second
      box(M, [10, 10, 4]).transform(flat.elements as never),
      // a corner exactly on the second region's edge
      box(M, [12, 12, 20]).transform(flat.elements as never),
      // a corner just past it
      box(M, [12.02, 12, 20]).transform(flat.elements as never),
      // taller than any region
      box(M, [4, 4, 25]).transform(flat.elements as never),
      // in neither
      box(M, [4, 4, 4]).translate([25, 0, 0]),
    ];
    envelopes.forEach((e, i) => {
      const whole = target.intersect(e).volume();
      const cut = index.within(target, e).intersect(e).volume();
      assert(Math.abs(whole - cut) < 1e-9, `envelope ${i}: ${whole} vs ${cut}`);
    });
    // Regions answer for what they hold, and the rest is tested against the whole.
    assert.notEqual(index.within(target, envelopes[0]), target);
    assert.notEqual(index.within(target, envelopes[2]), target);
    assert.equal(index.within(target, envelopes[3]), target);
    assert.equal(index.within(target, envelopes[4]), target);
    assert.equal(index.within(target, envelopes[5]), target);
    // A region's piece is cut once per target.
    assert.equal(index.within(target, envelopes[1]), index.within(target, envelopes[1]));
  });
});

test('seat and clip boxes sit under the plate plane, inset as asked', () => {
  freeAfter(wasm, () => {
    const cfg = defaults.config;
    const id = new Matrix4();
    const [ox, oy] = cfg.switch.seat_outer_mm;
    const t = cfg.switch.clip_land_thickness_mm;
    const seat = bounds(seatBox(M, cfg, id));
    near(seat.min, [-ox / 2, -oy / 2, -t]);
    near(seat.max, [ox / 2, oy / 2, 0]);
    const grown = bounds(seatBox(M, cfg, id, { xy: -0.02, z: 1 }));
    near(grown.min, [-ox / 2 + 0.01, -oy / 2 + 0.01, -t - 0.5]);
    const clip = bounds(clipBox(M, cfg, id, 1));
    const shrunk = bounds(clipBox(M, cfg, id, 1, 0.01));
    // Pulled in at both ends and the top, flush at the bottom.
    near([shrunk.min[1] - clip.min[1], clip.max[1] - shrunk.max[1]], [0.01, 0.01]);
    near([clip.max[2] - shrunk.max[2], shrunk.min[2] - clip.min[2]], [0.01, 0]);
    // The reliefs are on opposite sides of the hole.
    near(
      bounds(clipBox(M, cfg, id, -1))
        .min.map((v) => -v)
        .slice(1, 2),
      [clip.max[1]],
    );
  });
});

// One key in a slab, so the checks run without a chassis.
const setup = () => {
  const cfg = clone(defaults).config;
  const m = componentFrames(cfg).matrix_index_home;
  const keys: Keys = [['matrix_index_home', m]];
  const probe = makeProbe(M, new RegionIndex(M, keyRegions(cfg, keys), 30, 0.1));
  const slab = (z0: number, z1: number) =>
    box(M, [60, 60, z1 - z0], [0, 0, (z0 + z1) / 2]).transform(m.elements as never);
  return { cfg, m, keys, probe, slab };
};

test('seats and openings pass on a seated slab and fail, with highlights, where they should', () => {
  freeAfter(wasm, () => {
    const { cfg, m, keys, probe, slab } = setup();
    const seated = seatSwitches(M, cfg, slab(-1.5, 0), [m]);
    const opened = checkOpenings(probe, cfg, keys, seated.body, seated.openings);
    assert(opened.openings[0].passed);
    assert.equal(opened.highlights.length, 0);
    const cut = seated.body.subtract(M.union([...seated.reliefs, ...seated.openings]));
    const ok = checkSeats(probe, cfg, keys, cut);
    assert(ok.seats[0].passed, JSON.stringify(ok.seats));
    assert.equal(ok.highlights.length, 0);

    // No chassis at all: the openings are uncovered, and the seats are not there.
    const none = M.cube([1, 1, 1]).translate([500, 500, 500]);
    const empty = checkOpenings(probe, cfg, keys, none, seated.openings);
    assert.equal(empty.openings[0].covered, 0);
    assert.equal(empty.openings[0].passed, false);
    assert.deepEqual(
      empty.highlights.map((h) => h.kind),
      ['opening'],
    );
    const bare = checkSeats(probe, cfg, keys, none);
    assert(bare.seats[0].missing > 1);
    assert.deepEqual(
      bare.highlights.map((h) => h.kind),
      ['seat'],
    );

    // A slab left thick: material above the seat's plane, and in the clip reliefs.
    const thick = checkSeats(probe, cfg, keys, slab(-5, 3));
    assert(thick.seats[0].excess > 1 && thick.seats[0].clipBlocked > 0);
    assert.equal(thick.seats[0].passed, false);
    assert.deepEqual(
      thick.highlights.map((h) => h.kind),
      ['seat', 'seat', 'seat'],
    );

    // Material below the opening, inside a probe, blocks it.
    const solid = checkOpenings(probe, cfg, keys, slab(-12, 3), seated.openings);
    assert.equal(solid.openings[0].blocked, 9);
    assert.equal(solid.openings[0].passed, false);
  });
});
