import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { Vector3 } from 'three';
import { defaults, clone, componentFrames, validateProject } from '../src/geometry';
import { buildSolid } from '../src/solid';
import { buildChassis } from '../src/chassis';
import { oldKeyFrames } from '../src/ghost';
import { crossings, holes, nets, wiring } from '../src/wiring';
import ref from './python-reference.json';
const pos = (m: { elements: number[] }) => new Vector3(...m.elements.slice(12, 15));
const normal = (m: { elements: number[] }) => new Vector3(...m.elements.slice(8, 11));
// The joined C64 chassis (box_style joined) with the thumbs where it was laid out
// for, before the tape-deck's thumbs moved in the defaults, and the keycap
// sizes it was laid out for, before they were measured: the checker's
// passing case.
const joined = () => {
  const p = clone(defaults),
    g = p.config.geometry,
    c = p.config.chassis as { box_style?: string },
    s = p.config.switch as Omit<typeof p.config.switch, 'keycap_top_mm'> & {
      keycap_top_mm?: number[];
    };
  Object.assign(s, { keycap_mm: [18, 18, 9], travel_mm: 4 });
  delete s.keycap_top_mm;
  s.keycap_overrides_mm.thumb_home = [27.525, 18, 9];
  Object.assign(g.thumb, {
    position_mm: [-42.56, -60.704, 0],
    rotation_deg: [5, -24, 15],
    keys: [{ name: 'far' }, { name: 'home', rotation_deg: [0, 0, -90] }, { name: 'near' }],
  });
  g.thumb.arc = { radius_mm: 130, step_deg: 11, well_deg: 12 };
  g.thumb_extra!.position_mm = [13.5015, -52, 1.0416];
  g.thumb_extra!.keys = [
    { name: 'x1', offset_mm: [-11.5, -0.5, 1.5] },
    { name: 'x2', offset_mm: [11.5, 0.5, -1.5] },
  ];
  c.box_style = 'joined';
  return p;
};
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
  const plain = joined().config,
    f = componentFrames(plain),
    th = plain.geometry.thumb;
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
  // The extra pair share the cluster's tilt.
  assert(normal(f.thumb_x1).angleTo(normal(f.thumb_x2)) < 1e-6);
  const none = clone(defaults);
  delete (none.config.geometry as { thumb_extra?: unknown }).thumb_extra;
  assert(!componentFrames(none.config).thumb_x1);
});
test('the default tape-deck chassis: one piece on one footprint, flat seats, and clear keycaps and hardware; with walls raised round the slot, every key is held', async () => {
  // (Its near thumb's wires and pads are still open: the key is being placed.)
  const wasm = await Module();
  wasm.setup();
  const r = buildSolid(wasm, clone(defaults));
  assert.equal(r.report.seats.length, 20);
  assert(r.report.seats.every((s) => s.passed));
  assert.equal(r.report.pieces.length, 1);
  assert.equal(r.report.footprint.length, 1);
  assert.deepEqual(r.report.roomCuts, []);
  assert.deepEqual(r.report.hardware, []);
  assert(r.report.keycaps.every((k) => k.passed));
  assert(r.report.capGaps.every((g) => g.gap > 0));
  assert(r.report.openings.every((o) => o.removed > 0 && o.covered === 9 && o.blocked === 0));
  // Without anything holding them, the main thumbs hang off one small contact.
  assert.deepEqual(
    r.report.support.map((s) => s.name),
    ['thumb_far', 'thumb_home', 'thumb_near'],
  );
  const walled = clone(defaults);
  (walled.config.chassis as { thumb_support?: string }).thumb_support = 'walls';
  const w = buildSolid(wasm, walled).report;
  assert.deepEqual(w.support, []);
  assert.equal(w.pieces.length, 1);
  assert.equal(w.footprint.length, 1);
  assert.deepEqual(w.roomCuts, []);
  assert.deepEqual(w.hardware, []);
  assert(w.seats.every((s) => s.passed) && w.keycaps.every((k) => k.passed));
});
test('the joined C64 passes all but support: one piece on one footprint, clear of the tile pockets, flat seats, clear keycaps, hardware and wires, and reachable pads; its main thumbs hang off one small contact', async () => {
  const wasm = await Module();
  wasm.setup();
  const p = joined(),
    r = buildSolid(wasm, p);
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
  assert.deepEqual(r.report.roomCuts, []);
  assert.deepEqual(r.report.hardware, []);
  assert.deepEqual(r.report.wires, []);
  assert.deepEqual(r.report.solder, []);
  assert.deepEqual(
    r.report.support.map((s) => s.name),
    ['thumb_far', 'thumb_home', 'thumb_near'],
  );
  assert(r.report.keycaps.every((k) => k.passed));
  assert(r.report.capGaps.every((g) => g.gap > 0));
  assert(r.report.openings.every((o) => o.removed > 0 && o.covered === 9 && o.blocked === 0));
  const mounted = new wasm.Manifold(
    new wasm.Mesh({ numProp: 3, vertProperties: r.mesh.positions, triVerts: r.mesh.indices }),
  );
  try {
    for (const [name, m] of Object.entries(componentFrames(p.config)))
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
    const chassis = buildChassis(wasm, p.config, componentFrames(p.config)).body;
    for (const [name, m] of Object.entries(componentFrames(p.config)))
      if (name.startsWith('matrix_'))
        for (const side of [-1, 1])
          for (const y of [-6, 0, 6]) {
            const a = new Vector3(side * 11, y, -0.5).applyMatrix4(m).toArray(),
              b = new Vector3(side * 8, y, -0.5).applyMatrix4(m).toArray();
            const first = (s: typeof mounted) =>
              Math.min(99, ...s.rayCast(a, b).map((h) => h.distance));
            // Where the plate runs on into a bridge to the next column, the ray
            // starts inside both bodies and there is no edge to compare; one
            // mesh may still have an internal seam there that the other lacks.
            const probe = wasm.Manifold.cube([0.1, 0.1, 0.1], true).translate(a);
            const inside = [mounted, chassis].every((s) => s.intersect(probe).volume() > 5e-4);
            if (inside) continue;
            assert(Math.abs(first(mounted) - first(chassis)) < 1e-3, `${name} ${side} ${y}`);
          }
  } finally {
    mounted.delete();
  }
});
test('the checker reports keycap collisions', async () => {
  const wasm = await Module();
  wasm.setup();
  // Keycaps that press 2 mm into the plate must fail, with matching highlight geometry.
  const low = joined();
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
});
test('the checker reports chassis built where a keycap goes', async () => {
  const wasm = await Module();
  wasm.setup();
  // The thumb cluster moved 10 mm toward the fingers: the 1.5u key's room cuts
  // into the fingers' front swept end.
  const close = joined();
  close.config.geometry.thumb.position_mm[1] += 10;
  const r = buildSolid(wasm, close);
  const home = r.report.roomCuts.find((c) => c.name === 'thumb_home');
  assert(home && home.volume > 10);
  assert.equal(r.report.passed, false);
  assert(r.highlights.some((h) => h.kind === 'room' && h.name === 'thumb_home keycap room'));
});
test("the wiring joins each net's pads and adapter hole, for a 4 × 5 matrix", () => {
  const cfg = joined().config;
  const frames = componentFrames(cfg);
  const w = wiring(cfg, frames);
  const keys = Object.keys(frames).filter((n) => n.startsWith('matrix_') || n.startsWith('thumb_'));
  assert.equal(keys.length, 20);
  // Every key sits on one of four rows and one of five columns, each pair once.
  assert.equal(new Set(w.matrix.map((m) => m.row)).size, 4);
  assert.equal(new Set(w.matrix.map((m) => m.column)).size, 5);
  assert.equal(new Set(w.matrix.map((m) => `${m.row} ${m.column}`)).size, 20);
  const hole = holes(cfg, frames);
  // Two wires on one pad or hole sit side by side on it, up to 0.5 mm off its centre.
  const near = (a: number[], b: number[]) => Math.hypot(...a.map((x, i) => x - b[i])) < 0.51;
  for (const net of nets(cfg)) {
    const wires = w.wires.filter((x) => x.net === net.name);
    // Each pad named for the net, and the hole, is an end of some wire.
    const ends = wires.flatMap((x) => [x.points[0], x.points.at(-1)!]);
    const pads = w.pads.filter((p) => net.pads.includes(p.name));
    const used = pads.filter((p) => ends.some((e) => near(e, p.at)));
    const perKey = new Set(used.map((p) => p.key));
    assert.equal(perKey.size, net.chains ? net.chains.flat().length : 20, net.name);
    assert(
      ends.some((e) => near(e, hole[net.pin])),
      `${net.name} reaches pin ${net.pin}`,
    );
    // A tree over the keys and the hole: a link between neighbours in each chain, and a feed per chain.
    assert.equal(wires.length, perKey.size, net.name);
    assert.equal(wires.filter((x) => x.feed).length, net.chains?.length ?? 1, net.name);
  }
  assert.equal(w.wires.length, 100);
  // No wire runs into another.
  assert.deepEqual(
    crossings(w.wires).map(
      ([a, b]) =>
        `${w.wires[a].net} ${w.wires[a].from}-${w.wires[a].to} × ${w.wires[b].net} ${w.wires[b].from}-${w.wires[b].to}`,
    ),
    [],
  );
  assert.equal(
    w.nets.reduce((s, n) => s + n.joints, 0),
    200,
  );
});
test('a project saved before the wiring loads with the default adapter, ribbon and wiring', () => {
  const p = clone(defaults);
  const c = p.config as Record<string, any>;
  delete c.schema;
  delete c.ribbon;
  delete c.wiring;
  delete c.tile.pads;
  c.adapter = { position_mm: [0, 0], rotation_deg: 0, board_mm: [30, 16, 1.6] };
  validateProject(p);
  assert.deepEqual(p.config, defaults.config);
});
test('the old Dactyl ghost fits its finger keys onto the design and carries its thumbs', () => {
  const { frames, rms } = oldKeyFrames(defaults.config),
    now = componentFrames(defaults.config);
  assert.equal(Object.keys(frames).length, 18);
  assert(rms < 6, String(rms));
  // Every old finger key lands near this design's same key, and the thumbs in front.
  for (const n of Object.keys(frames).filter((n) => n.startsWith('matrix_')))
    assert(pos(frames[n]).distanceTo(pos(now[n])) < 8, n);
  for (const n of ['thumb_near', 'thumb_home', 'thumb_far']) assert(pos(frames[n]).y < -35, n);
});
