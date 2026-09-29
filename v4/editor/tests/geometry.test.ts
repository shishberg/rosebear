import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { Vector3 } from 'three';
import { defaults, clone, componentFrames, validateProject } from '../src/geometry';
import { buildSolid, checkWalls } from '../src/solid';
import { buildChassis } from '../src/chassis';
import ref from './python-reference.json';
const pos = (m: { elements: number[] }) => new Vector3(...m.elements.slice(12, 15));
const normal = (m: { elements: number[] }) => new Vector3(...m.elements.slice(8, 11));
test('default column heights reproduce the Python reference finger poses', () => {
  // The heights and sideways tilts were taken from the old paraboloid surface, so
  // the finger keys sit where the Python generator put them.
  for (const [key, m] of Object.entries(componentFrames(defaults.config)))
    if (key.startsWith('matrix_'))
      m.elements.forEach((x, i) =>
        assert(Math.abs(x - (ref.frames as Record<string, number[]>)[key][i]) < 1e-3, key),
      );
});
test('column parameters move and tilt their keys, and invalid input is rejected', () => {
  const p = clone(defaults),
    before = componentFrames(p.config),
    mid = p.config.geometry.columns[2];
  mid.heights_mm[0] += 5;
  mid.offset_mm[1] += 2;
  const after = componentFrames(p.config);
  // Stagger moves the whole column; the raised top key also tilts its neighbours.
  for (const r of ['top', 'home', 'bottom'])
    assert(pos(after[`matrix_middle_${r}`]).distanceTo(pos(before[`matrix_middle_${r}`])) > 1.9, r);
  assert(normal(after.matrix_middle_home).distanceTo(normal(before.matrix_middle_home)) > 0.01);
  assert.deepEqual(after.matrix_ring_home.elements, before.matrix_ring_home.elements);
  mid.heights_mm[1] = NaN;
  assert.throws(() => validateProject(p), /finite/);
  assert.throws(() => validateProject({ version: 1 }), /version 2/);
});
test('thumb clusters fan on an arc and tilt into a well', () => {
  const f = componentFrames(defaults.config),
    th = defaults.config.geometry.thumb;
  const far = pos(f.thumb_far),
    home = pos(f.thumb_home),
    near = pos(f.thumb_near);
  assert(Math.abs(far.distanceTo(home) - near.distanceTo(home)) < 1e-6);
  assert(
    Math.abs(
      far.distanceTo(home) -
        (2 * th.arc.radius_mm * Math.sin((th.arc.step_deg * Math.PI) / 360)) /
          Math.cos((th.arc.well_deg * Math.PI) / 360),
    ) < 0.5,
  );
  // Each outer key tilts well_deg toward the middle one.
  for (const n of ['thumb_far', 'thumb_near']) {
    const a = (normal(f[n]).angleTo(normal(f.thumb_home)) * 180) / Math.PI;
    assert(Math.abs(a - th.arc.well_deg) < 0.01, n);
  }
  // The extra pair are level with each other.
  assert(Math.abs(pos(f.thumb_x1).z - pos(f.thumb_x2).z) < 0.5);
  const none = clone(defaults);
  delete (none.config.geometry as { thumb_extra?: unknown }).thumb_extra;
  assert(!componentFrames(none.config).thumb_x1);
});
test('default chassis passes: one piece on one footprint, clear of the tile pockets, flat seats, clear keycaps and hardware', async () => {
  const wasm = await Module();
  wasm.setup();
  const r = buildSolid(wasm, clone(defaults));
  console.log(
    'WASM build',
    r.report.milliseconds.toFixed(0) + ' ms',
    'volume',
    r.report.volume.toFixed(0),
  );
  assert.equal(r.report.seats.length, 20);
  assert(r.report.seats.every((s) => s.passed));
  assert.equal(r.report.pieces.length, 1);
  assert.equal(r.report.footprint.length, 1);
  assert(r.report.pocketCut <= 0.01, `tile pockets cut ${r.report.pocketCut} mm³`);
  assert.deepEqual(r.report.roomCuts, []);
  assert.deepEqual(r.report.hardware, []);
  assert(r.report.keycaps.every((k) => k.passed));
  assert(r.report.capGaps.every((g) => g.gap > 0));
  assert(r.report.openings.every((o) => o.removed > 0 && o.covered === 9 && o.blocked === 0));
  // A wall under each key: three on each outer finger column, three on the
  // thumb row's back and two on the extra thumb row's front.
  assert(r.report.walls.every((w) => w.passed));
  assert.equal(r.report.walls.length, 11);
  assert(r.report.passed);
  const mounted = new wasm.Manifold(
    new wasm.Mesh({ numProp: 3, vertProperties: r.mesh.positions, triVerts: r.mesh.indices }),
  );
  try {
    for (const [name, m] of Object.entries(componentFrames(defaults.config)))
      if (name.startsWith('matrix_') || name.startsWith('thumb_')) {
        const inverse = m.clone().invert();
        // Ray through four lip locations measures both faces of the seat.
        for (const [x, y] of [
          [7.7, 0],
          [-7.7, 0],
          [0, 7.7],
          [0, -7.7],
        ]) {
          const a = new Vector3(x, y, 1).applyMatrix4(m).toArray(),
            b = new Vector3(x, y, -3).applyMatrix4(m).toArray();
          const hits = mounted.rayCast(a, b);
          assert.equal(hits.length, 2, name);
          const heights = hits
            .map((h) => new Vector3(...h.position).applyMatrix4(inverse).z)
            .sort((a, b) => b - a);
          assert(Math.abs(heights[0]) < 1e-4, name);
          assert(Math.abs(heights[1] + 1.5) < 1e-4, name);
        }
      }
    // The seats only change the plate inside their footprint: its side edges
    // match the chassis before seating. (Trimming before filling once cut a
    // wedge from the index home plate's edge.)
    const chassis = buildChassis(wasm, defaults.config, componentFrames(defaults.config)).body;
    for (const [name, m] of Object.entries(componentFrames(defaults.config)))
      if (name.startsWith('matrix_'))
        for (const side of [-1, 1])
          for (const y of [-6, 0, 6]) {
            const a = new Vector3(side * 11, y, -0.5).applyMatrix4(m).toArray(),
              b = new Vector3(side * 8, y, -0.5).applyMatrix4(m).toArray();
            const first = (s: typeof mounted) =>
              Math.min(99, ...s.rayCast(a, b).map((h) => h.distance));
            assert(Math.abs(first(mounted) - first(chassis)) < 1e-3, `${name} ${side} ${y}`);
          }
  } finally {
    mounted.delete();
  }
});
test('the checker reports keycap collisions and loose pieces', async () => {
  const wasm = await Module();
  wasm.setup();
  // Keycaps that press 2 mm into the plate must fail, with matching highlight geometry.
  const low = clone(defaults);
  low.config.switch.keycap_bottom_above_plate_mm = low.config.switch.travel_mm - 2;
  const r = buildSolid(wasm, low),
    home = r.report.keycaps.find((k) => k.name === 'thumb_home')!;
  assert.deepEqual(home.size, [27.525, 18, 9]);
  assert.equal(home.margin, 2.5);
  assert(home.swept > 0.05);
  assert.equal(home.passed, false);
  assert.equal(r.report.passed, false);
  const h = r.highlights.find((h) => h.name === 'thumb_home' && h.kind === 'travel')!;
  assert(h, 'Missing collision geometry');
  const solid = new wasm.Manifold(
    new wasm.Mesh({ numProp: 3, vertProperties: h.mesh.positions, triVerts: h.mesh.indices }),
  );
  try {
    assert.equal(solid.status(), 'NoError');
    assert(Math.abs(solid.volume() - home.swept) < 0.01);
  } finally {
    solid.delete();
  }
  // An extra thumb row moved well away only touches the removable base plate.
  const apart = clone(defaults),
    x = (apart.config.geometry as { thumb_extra: { position_mm: number[] } }).thumb_extra;
  x.position_mm[1] -= 40;
  const r2 = buildSolid(wasm, apart);
  assert.equal(r2.report.pieces.length, 2);
  assert.equal(r2.report.footprint.length, 2);
  assert.equal(r2.report.passed, false);
  assert(r2.highlights.some((h) => h.kind === 'loose'));
});
test('the checker reports chassis built where a keycap goes', async () => {
  const wasm = await Module();
  wasm.setup();
  // The thumb cluster moved 10 mm toward the fingers: the 1.5u key's room cuts
  // into the fingers' front swept end.
  const close = clone(defaults);
  close.config.geometry.thumb.position_mm[1] += 10;
  const r = buildSolid(wasm, close);
  const home = r.report.roomCuts.find((c) => c.name === 'thumb_home');
  assert(home && home.volume > 10);
  assert.equal(r.report.passed, false);
  assert(r.highlights.some((h) => h.kind === 'room' && h.name === 'thumb_home keycap room'));
});
test('the wall check finds a gap through a wall and a cutout that does not go through', async () => {
  const wasm = await Module();
  wasm.setup();
  // Plain walls, so the slit goes through a solid post.
  const cfg = clone(defaults.config);
  cfg.chassis.wall_pattern = 'solid';
  const chassis = buildChassis(wasm, cfg, componentFrames(cfg));
  const pinky = chassis.wallWindows.filter((w) => w.name.startsWith('pinky column wall'));
  const home = pinky.find((w) => w.name === 'pinky column wall: matrix_pinky_home')!;
  const top = pinky.find((w) => w.name === 'pinky column wall: matrix_pinky_top')!;
  // A plan point on a window's mid-plane, at a distance along the wall.
  const at = (w: typeof home, along: number, z: number): [number, number, number] => {
    const across = (w.across[0] + w.across[1]) / 2;
    const [nx, ny] = w.normal;
    return [-ny * along + nx * across, nx * along + ny * across, z];
  };
  const turn = (m: ReturnType<typeof wasm.Manifold.cube>) =>
    m.rotate([0, 0, (Math.atan2(home.normal[1], home.normal[0]) * 180) / Math.PI]);
  // A slit 2 mm long and 0.5 mm high through the post between the top and home
  // keys, and the home key's cutout filled.
  const [homeAlong, homeZ] = home.cutouts[0];
  const slit = turn(wasm.Manifold.cube([30, 2, 0.5], true)).translate(
    at(home, (homeAlong + top.cutouts[0][0]) / 2, homeZ),
  );
  const fill = turn(wasm.Manifold.cube([30, 20.5, 16], true)).translate(at(home, homeAlong, homeZ));
  const damaged = chassis.body.subtract(slit).add(fill);
  const { checks, gapSolids } = checkWalls(wasm, damaged, pinky, chassis.wallOpenings);
  const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
  // The slit is inside both keys' windows.
  for (const w of [home, top]) {
    assert.equal(byName[w.name].gaps.length, 1, w.name);
    assert(Math.abs(byName[w.name].gaps[0] - 1) < 0.1, w.name);
  }
  assert.equal(byName[home.name].blindCutouts, 1);
  assert.equal(byName[top.name].blindCutouts, 0);
  assert.equal(
    gapSolids.length,
    checks.reduce((t, c) => t + c.gaps.length + c.blindCutouts, 0),
  );
  // The inner column's wall is tall enough for the hex pattern: the home key's
  // window sees its cutout, the openings above and below the hexagons, and the
  // two hexagons beside it. With the solid pattern it sees only the cutout.
  const innerHome = (c: typeof cfg) =>
    buildChassis(wasm, c, componentFrames(c)).wallWindows.find(
      (w) => w.name === 'inner column wall: matrix_inner_home',
    )!.cutouts.length;
  const hex = clone(cfg);
  hex.chassis.wall_pattern = 'hex';
  assert.equal(innerHome(hex), 5);
  assert.equal(innerHome(cfg), 1);
});
