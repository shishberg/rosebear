import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { Vector3 } from 'three';
import {
  defaults,
  clone,
  componentFrames,
  validateProject,
  capClearance,
  keycapEnvelope,
  keyGroups,
  tileUnderside,
} from '../src/geometry';
import { hardware } from '../src/parts';
import { tilePocketDepth } from '../src/plates';
import { freeAfter } from '../src/manifold-util';
import { buildSolid, buildSolidAsync } from '../src/solid';
import { buildChassis, gluePads } from '../src/chassis';
import { shell } from '../src/shell';
import { crossings, holes, nets, wiring } from '../src/wiring';
import { solidOf } from './helpers';

const wasm = await Module();
wasm.setup();
const pos = (m: { elements: number[] }) => new Vector3(...m.elements.slice(12, 15));
const normal = (m: { elements: number[] }) => new Vector3(...m.elements.slice(8, 11));
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
test('a project saved with fields since removed, or without ones every build reads, still loads', () => {
  const p = clone(defaults) as any;
  p.config.units = 'mm and degrees';
  p.config.chassis.wall_mm = 2.4;
  p.config.switch.cutout_depth_overrides_mm = { matrix_inner_bottom: 14 };
  Object.assign(p.config.tile, { support_width_mm: 1.6, retaining_tie_y_mm: 0 });
  for (const k of ['seat_outer_mm', 'travel_mm', 'keycap_clearance_mm']) delete p.config.switch[k];
  p.config.chassis.base_thickness_mm = 2.5;
  delete p.config.chassis.skin_mm;
  validateProject(p);
  assert.deepEqual(p.config.switch.seat_outer_mm, defaults.config.switch.seat_outer_mm);
  assert.equal(p.config.switch.travel_mm, defaults.config.switch.travel_mm);
  assert.equal(p.config.switch.keycap_clearance_mm, defaults.config.switch.keycap_clearance_mm);
  assert.equal(p.config.chassis.skin_mm, 2.5);
  assert(!('base_thickness_mm' in p.config.chassis));
});
test("the tile pocket and the drawn parts measure the tile's parts from the board's top", () => {
  // A part's center_mm[2] is from the board's top (its switch side): the
  // socket sits on the underside, so the pocket reaches the plate's depth to
  // the board, the board, the socket and the parts' clearance below the plate top.
  const t = defaults.config.tile;
  const socket = t.components.find((p) => p.name === 'hotswap socket')!;
  const depth = t.plate_top_to_pcb_top_mm + t.size_mm[2] + socket.size_mm[2];
  assert(Math.abs(socket.center_mm[2] + t.size_mm[2] + socket.size_mm[2] / 2) < 1e-9);
  assert(Math.abs(tilePocketDepth(defaults.config) - depth - t.component_clearance_mm) < 1e-9);
  const drawn = hardware(defaults).filter(
    (p) => p.group === 'components' && p.name.startsWith('matrix_index_home: '),
  );
  assert.equal(drawn.length, t.components.length);
  const lowest = Math.min(...drawn.map((p) => p.center[2] - p.size[2] / 2));
  assert(Math.abs(lowest + depth) < 1e-9);
  // The measured tile: 5 mm to the board, 1.6 mm board, 1.9 mm socket, 0.3 mm clearance.
  assert(Math.abs(tilePocketDepth(defaults.config) - 8.8) < 1e-9);
});
test("the glue pads keep off the tile's corner notches and the holes near its edges", () => {
  const t = defaults.config.tile;
  const { boxes } = gluePads(defaults.config);
  assert(boxes.length > 0);
  const keep = t.pads.ring_mm / 2;
  for (const b of boxes) {
    const lo = [0, 1].map((k) => b.center[k] - b.size[k] / 2);
    const hi = [0, 1].map((k) => b.center[k] + b.size[k] / 2);
    // Every point of the pad is on the tile: inside its edges, and outside each
    // corner's notch.
    for (const k of [0, 1])
      assert(lo[k] >= -t.size_mm[k] / 2 - 1e-9 && hi[k] <= t.size_mm[k] / 2 + 1e-9);
    for (const cx of [-1, 1])
      for (const cy of [-1, 1]) {
        const corner = [(cx * t.size_mm[0]) / 2, (cy * t.size_mm[1]) / 2];
        const nearest = [0, 1].map((k) => Math.min(Math.max(corner[k], lo[k]), hi[k]));
        assert(
          Math.hypot(nearest[0] - corner[0], nearest[1] - corner[1]) >=
            t.corner_notch_radius_mm - 1e-9,
        );
      }
    // And clear of every hole's ring.
    for (const h of t.pads.list.filter((h) => h.hole)) {
      const nearest = [0, 1].map((k) => Math.min(Math.max(h.at_mm[k], lo[k]), hi[k]));
      assert(Math.hypot(nearest[0] - h.at_mm[0], nearest[1] - h.at_mm[1]) > keep, h.name);
    }
  }
});
test('a project on the provisional tile loads with the measured one, and its nets with its holes', () => {
  const p = clone(defaults) as any;
  const c = p.config;
  c.schema = 5;
  c.tile.provisional = true;
  c.tile.size_mm = [19, 19, 1.6];
  c.tile.pads = { size_mm: [1.2, 1.8], list: [{ name: 'DI', at_mm: [7, -8.6] }] };
  const old: Record<string, string[]> = { DATA: ['DI', 'DO'], '+5V': ['+', '+'], GND: ['G', 'G'] };
  for (const n of c.wiring.nets) if (old[n.name]) n.pads = old[n.name];
  validateProject(p);
  assert.deepEqual(p.config, defaults.config);
});
test('shared per-key helpers', () => {
  const c = defaults.config;
  assert.equal(capClearance(c, 'thumb_home'), c.switch.keycap_clearance_overrides_mm.thumb_home);
  assert.equal(capClearance(c, 'matrix_index_home'), c.switch.keycap_clearance_mm);
  assert.equal(tileUnderside(c), -(c.tile.plate_top_to_pcb_top_mm + c.tile.size_mm[2]));
  const g = keyGroups(c);
  assert.deepEqual(
    [...g.fingers, ...g.thumbs, ...g.extra].sort(),
    Object.keys(componentFrames(c))
      .filter((n) => n !== 'adapter')
      .sort(),
  );
});
test('thumb clusters fan on an arc and tilt into a well', () => {
  // Swung in places each thumb key itself, with no arc; here its row is put
  // back on an arc of 11° steps with a 12° well, each key at its place on it.
  const p = clone(defaults),
    th = p.config.geometry.thumb;
  th.arc = { ...th.arc, step_deg: 11, well_deg: 12 };
  for (const k of th.keys) {
    k.offset_mm = [0, 0, 0];
    k.rotation_deg = k.name === 'home' ? [0, 0, -90] : [0, 0, 0];
  }
  const f = componentFrames(p.config);
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
// The C64 shell, the chassis these checks were written for, on Swung in.
const c64 = () => {
  const p = clone(defaults);
  p.config.chassis.style = 'c64';
  return p;
};
test("the C64 chassis on Swung in: flat seats where they pass, failing Swung in's known checks", () => {
  // The C64 case was built for the layout before Swung in and doesn't fit it:
  // Swung in's thumb keys sit under the finger keys and low, so seats,
  // keycap rooms, hardware and wires fail, and the case is two pieces on
  // eight footprints. Pinned, so a change shows up; the seats that pass are
  // still flat, and the seating still leaves the plates' edges alone.
  const p = c64(),
    r = buildSolid(wasm, p),
    failing = (xs: { name: string; passed: boolean }[]) =>
      xs.filter((x) => !x.passed).map((x) => x.name);
  console.log(
    'WASM build',
    r.report.milliseconds.toFixed(0) + ' ms',
    'volume',
    r.report.volume.toFixed(0),
  );
  assert.equal(r.report.seats.length, 20);
  const badSeats = failing(r.report.seats);
  assert.deepEqual(badSeats, ['matrix_pinky_bottom', 'thumb_far', 'thumb_near', 'thumb_x2']);
  assert.equal(r.report.pieces.length, 2);
  assert.equal(r.report.footprint.length, 8);
  assert.deepEqual(
    r.report.roomCuts.map((c) => c.name),
    [
      'matrix_middle_top',
      'matrix_middle_home',
      'matrix_ring_top',
      'matrix_ring_home',
      'matrix_ring_bottom',
      'matrix_pinky_home',
      'matrix_pinky_bottom',
      'thumb_x1',
      'thumb_x2',
    ],
  );
  assert.deepEqual(
    r.report.hardware.map((h) => h.name),
    ['matrix_pinky_bottom', 'Ribbon 7', 'Ribbon 8', 'Ribbon 9', 'Ribbon 10'],
  );
  assert.equal(r.report.wires.length, 9);
  assert.deepEqual(failing(r.report.keycaps), ['thumb_x1']);
  assert.deepEqual(
    r.report.capGaps.filter((g) => !(g.gap > 0)).map((g) => g.between),
    ['fingers – extra thumbs'],
  );
  assert(r.report.openings.length > 0 && r.report.openings.every((o) => o.passed));
  assert.equal(r.report.passed, false);
  const mounted = solidOf(wasm, r.mesh);
  try {
    for (const [name, m] of Object.entries(componentFrames(p.config)))
      if ((name.startsWith('matrix_') || name.startsWith('thumb_')) && !badSeats.includes(name)) {
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
    // match the chassis before seating. This guards the order in seatSwitches:
    // fill first, then trim (the reverse cuts a wedge from a plate's edge).
    const chassis = buildChassis(wasm, p.config, componentFrames(p.config)).body;
    for (const [name, m] of Object.entries(componentFrames(p.config)))
      if (name.startsWith('matrix_') && !badSeats.includes(name))
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
// The bottom section must be one piece: a mount that floats off the floor splits it.
const basePieces = (cfg: typeof defaults.config) =>
  freeAfter(wasm, () => {
    const pieces = buildChassis(wasm, cfg, componentFrames(cfg)).base.decompose();
    const big = pieces.filter((p) => p.volume() > 0.5).length;
    pieces.forEach((p) => p.delete());
    return big;
  });
test('a thicker skin builds the case in one piece, the adapter mount reaching the floor', () => {
  // On the Skeletyl, the case alone (the checks are the default's, pinned
  // below): the C64 case on Swung in throws with a 3 mm skin ("joined: 2
  // shared runs" in shell/bin.ts).
  const p = clone(defaults);
  p.config.chassis.skin_mm = 3;
  const [body, base] = freeAfter(wasm, () => {
    const built = buildChassis(wasm, p.config, componentFrames(p.config));
    return [built.body, built.base].map((m) => {
      const pieces = m.decompose(),
        big = pieces.filter((x) => x.volume() > 0.5).length;
      pieces.forEach((x) => x.delete());
      return big;
    });
  });
  assert.equal(body, 1);
  assert.equal(base, 1);
  assert.throws(
    () =>
      validateProject({
        ...clone(defaults),
        config: { ...p.config, chassis: { ...p.config.chassis, skin_mm: 1.5 } },
      }),
    /skin_mm/,
  );
});
test("the default (Swung in) Skeletyl builds one piece, failing only Swung in's known checks", () => {
  // Swung in's thumb x1 sits under the home and near keys and x2 under the
  // pinky and ring bottom keys: the extra thumbs' keycaps touch the fingers'.
  // Its failures are pinned, so a change shows up; everything else passes.
  const r = buildSolid(wasm, clone(defaults)).report,
    failing = (xs: { name: string; passed: boolean }[]) =>
      xs.filter((x) => !x.passed).map((x) => x.name);
  assert.equal(r.pieces.length, 1);
  assert.equal(r.footprint.length, 1);
  assert.equal(r.seats.length, 20);
  assert.deepEqual(failing(r.seats), ['matrix_pinky_bottom', 'thumb_near', 'thumb_x2']);
  assert.deepEqual(failing(r.keycaps), ['matrix_pinky_bottom', 'thumb_x1', 'thumb_x2']);
  assert.deepEqual(
    r.roomCuts.map((c) => c.name),
    ['matrix_pinky_bottom', 'thumb_x1', 'thumb_x2'],
  );
  assert(r.openings.length > 0);
  assert.deepEqual(failing(r.openings), ['thumb_home', 'thumb_near']);
  assert.deepEqual(
    r.hardware.map((h) => h.name),
    ['matrix_pinky_bottom'],
  );
  assert.deepEqual(r.wires, []);
  assert.deepEqual(r.crossings, [
    'RB: ring_bottom to pinky_bottom and +5V: pinky_bottom to ring_bottom',
  ]);
  assert.deepEqual(
    r.capGaps.filter((g) => !(g.gap > 0)).map((g) => g.between),
    ['fingers – extra thumbs'],
  );
  assert.equal(r.passed, false);
});
test('the default bottom section is one piece, the adapter mount on its floor', () => {
  assert.equal(basePieces(defaults.config), 1);
});
test('the checker reports keycap collisions', () => {
  // Keycaps that press 2 mm into the plate must fail, with matching highlight geometry.
  const low = clone(defaults);
  low.config.switch.keycap_bottom_above_plate_mm = low.config.switch.travel_mm - 2;
  const r = buildSolid(wasm, low),
    home = r.report.keycaps.find((k) => k.name === 'thumb_home')!;
  assert.deepEqual(home.size, [28, 18.5, 11]);
  assert.equal(home.margin, 2.5);
  assert(home.swept > 0.05);
  assert.equal(home.passed, false);
  assert.equal(r.report.passed, false);
  const h = r.highlights.find((h) => h.name === 'thumb_home' && h.kind === 'travel')!;
  assert(h, 'Missing collision geometry');
  const solid = solidOf(wasm, h.mesh);
  try {
    assert.equal(solid.status(), 'NoError');
    assert(Math.abs(solid.volume() - home.swept) < 0.01);
  } finally {
    solid.delete();
  }
});
test('the checker reports chassis built where a keycap goes', () => {
  // The thumb cluster moved 5 mm toward the fingers: the middle bottom key's
  // room cuts into the chassis (Swung in's own room cuts are at the pinky
  // bottom key and the extra thumbs).
  const close = clone(defaults);
  close.config.geometry.thumb.position_mm[1] += 5;
  const r = buildSolid(wasm, close);
  const cut = r.report.roomCuts.find((c) => c.name === 'matrix_middle_bottom');
  assert(cut && cut.volume > 10);
  assert.equal(r.report.passed, false);
  assert(
    r.highlights.some((h) => h.kind === 'room' && h.name === 'matrix_middle_bottom keycap room'),
  );
});
test("the wiring joins each net's pads and adapter hole, for a 4 × 5 matrix", () => {
  const cfg = defaults.config;
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
  // One wire to a tile's hole or pad: two don't fit a hole.
  const ends = w.wires.flatMap((x) => [x.points[0], x.points.at(-1)!]);
  for (const p of w.pads)
    assert(ends.filter((e) => near(e, p.at)).length <= 1, `${p.key} ${p.name} at ${p.xy}`);
  const crossed = (w: ReturnType<typeof wiring>) =>
    crossings(w.wires).map(
      ([a, b]) =>
        `${w.wires[a].net} ${w.wires[a].from}-${w.wires[a].to} × ${w.wires[b].net} ${w.wires[b].from}-${w.wires[b].to}`,
    );
  // On Swung in (the default) one wire runs into another, between the pinky
  // and ring bottom keys. Pinned, so a change shows up.
  assert.deepEqual(crossed(w), [
    'RB matrix_ring_bottom-matrix_pinky_bottom × +5V matrix_pinky_bottom-matrix_ring_bottom',
  ]);
  // Every wire's underside stays the floor's skin above the base: its
  // centreline at least skin_mm plus its radius above z = 0.
  for (const x of w.wires)
    for (const p of x.points)
      assert(
        p[2] >= cfg.chassis.skin_mm + x.diameter / 2 - 1e-9,
        `${x.net} ${x.from}-${x.to} at z ${p[2].toFixed(3)}`,
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
test('objects made with `new` inside freeAfter are freed too', () => {
  type Freed = { isDeleted(): boolean };
  let m!: Freed, c!: Freed;
  freeAfter(wasm, () => {
    const cube = wasm.Manifold.cube([1, 1, 1]).getMesh();
    m = new wasm.Manifold(cube) as unknown as Freed;
    c = new wasm.CrossSection([
      [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    ]) as unknown as Freed;
    assert(!m.isDeleted() && !c.isDeleted());
  });
  assert(m.isDeleted() && c.isDeleted());
});
test('a failed wire router rejects the build, and the next build still runs', async () => {
  await assert.rejects(
    buildSolidAsync(wasm, clone(defaults), () => Promise.reject(Error('router crashed'))),
    /router crashed/,
  );
  const r = await buildSolidAsync(wasm, clone(defaults), async (c) => wiring(c));
  assert.equal(r.report.wiring.wires, 100);
  assert.equal(r.report.pieces.length, 1);
});
test('a shell that throws while the router is still working leaves no unhandled rejection', async () => {
  const unhandled: unknown[] = [];
  const note = (e: unknown) => unhandled.push(e);
  process.on('unhandledRejection', note);
  const real = wasm.Manifold;
  wasm.Manifold = new Proxy(real, {
    construct() {
      throw Error('shell failed');
    },
  });
  try {
    await assert.rejects(
      buildSolidAsync(
        wasm,
        c64(),
        () => new Promise((_, no) => setTimeout(() => no(Error('router crashed')), 10)),
      ),
      /shell failed/,
    );
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    wasm.Manifold = real;
    process.off('unhandledRejection', note);
  }
  assert.deepEqual(unhandled, []);
});

test('keycapEnvelope: the measured cap grown by its clearance, down to where it is pressed', () => {
  const c = defaults.config,
    close = (a: number[], b: number[]) => a.forEach((x, i) => assert(Math.abs(x - b[i]) < 1e-9));
  const t = keycapEnvelope(c, 'thumb_home');
  close(t.base, [33, 23.5]);
  close(t.top, [28.5, 19]);
  close([t.z0, t.height, t.floor], [6, 13.5, 2.5]);
  const m = keycapEnvelope(c, 'matrix_index_home');
  close(m.base, [19.1, 19.1]);
  close(m.top, [14.6, 14.6]);
  close([m.z0, m.height, m.floor], [6, 11.3, 2.5]);
  const bare = keycapEnvelope(c, 'matrix_index_home', { clearance: 0 });
  close([...bare.base, ...bare.top, bare.height], [18.5, 18.5, 14, 14, 11]);
  const deep = clone(defaults).config;
  deep.switch.travel_mm = 8;
  assert.equal(keycapEnvelope(deep, 'matrix_index_home').floor, -2);
  assert.equal(keycapEnvelope(deep, 'matrix_index_home', { clampFloor: true }).floor, 0);
});
test('a wide keycap clearance fails the C64 swept check by the taper, not the at-rest one', () => {
  // The index bottom key, which passes at the usual clearance (on Swung in
  // the C64's thumb x1 fails at rest already).
  const p = c64();
  p.config.switch.keycap_clearance_mm = 6;
  const r = buildSolid(wasm, p),
    k = r.report.keycaps.find((x) => x.name === 'matrix_index_bottom')!;
  assert.equal(k.atRest, 0);
  assert(Math.abs(k.swept - 12.84) < 0.05, String(k.swept));
  assert.equal(r.report.passed, false);
});
test("the shell builds the same case when the thumb row's end keys are renamed", () => {
  const p = clone(defaults),
    names = { far: 'left', near: 'right' } as Record<string, string>;
  for (const k of p.config.geometry.thumb.keys) k.name = names[k.name] ?? k.name;
  validateProject(p);
  const volume = (c: typeof p.config) =>
    freeAfter(wasm, () => shell({ wasm, cfg: c, frames: componentFrames(c) }).body.volume());
  assert.equal(volume(p.config), volume(defaults.config));
});
