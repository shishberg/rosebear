// PROTOTYPE ?hand: the hand check (src/hand/) against the keyboard,
// the printed test frame (src/hand/frame.ts) included.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import { clone, componentFrames, defaults, ROWS } from '../src/geometry';
import { buildFrame } from '../src/hand/frame';
import { _test as hand } from '../src/hand';

const { T } = hand;
const wasm = await Module();
wasm.setup();

type Settings = typeof hand.DACTYL;
/** Lay out the keys for settings `s`, build the frame and check the hand against both. */
function layout(s: Settings) {
  const c = clone(defaults).config,
    anchor = hand.anchorOf(c);
  hand.applyHand(c, s, anchor);
  const frame = buildFrame(wasm, c, !!s.extra?.on),
    toHand = hand.worldOf(c, anchor, s).invert(),
    started = performance.now(),
    r = hand.check(c, s, undefined, { mesh: frame.mesh, toHand }),
    ms = performance.now() - started;
  return { c, frame, toHand, r, ms };
}
const report = (t: TestContext, r: ReturnType<typeof layout>) => {
  t.diagnostic(`checked in ${r.ms.toFixed(0)} ms, ${r.frame.mesh.indices.length / 3} frame faces`);
  for (const x of r.r.handHits)
    t.diagnostic(`${x.a} ${x.during}: into ${x.b} (${x.depth.toFixed(1)} mm)`);
};

test('a part is caught going into a keycap or the frame, but not the keys it may touch', () => {
  const { r, frame, toHand } = layout(hand.DACTYL),
    board = { caps: r.caps, tris: [] as never[] },
    cap = r.caps.find((k) => k.name === 'matrix_middle_top')!,
    at = new T.Vector3().setFromMatrixPosition(cap.top),
    // A capsule down through the keycap's middle.
    through = (may: string[]) => ({
      who: 'probe',
      segs: [[at.clone().setZ(at.z + 30), at.clone().setZ(at.z - 5), 3]] as [
        InstanceType<typeof T.Vector3>,
        InstanceType<typeof T.Vector3>,
        number,
      ][],
      may,
    });
  assert.ok(hand.partHits(board, through([])).some((x) => x.b === 'middle top'));
  assert.ok(
    !hand.partHits(board, through(['matrix_middle_top'])).some((x) => x.b === 'middle top'),
  );
  // The palm as a small block round the keycap's top.
  const block = [-4, 4].flatMap((x) =>
    [-4, 4].flatMap((y) => [-2, 2].map((z) => at.clone().add(new T.Vector3(x, y, z)))),
  );
  assert.ok(
    hand
      .partHits(board, { who: 'palm', segs: [], hull: block, may: [] })
      .some((x) => x.b === 'middle top'),
  );
  // A capsule through one of the frame's faces.
  const tris = hand.trisOf(frame.mesh, toHand),
    face = tris[0].t.getMidpoint(new T.Vector3()),
    n = tris[0].t.getNormal(new T.Vector3()),
    probe = {
      who: 'probe',
      segs: [[face.clone().addScaledVector(n, 2), face.clone().addScaledVector(n, -2), 1]] as [
        InstanceType<typeof T.Vector3>,
        InstanceType<typeof T.Vector3>,
        number,
      ][],
      may: r.caps.map((k) => k.name),
    };
  assert.ok(
    hand.partHits({ caps: r.caps, tris }, probe).some((x) => x.b.startsWith('the frame by')),
  );
});

test('Dactyl fit: the hand reaches every key touching nothing else, and it fits the tray', (t) => {
  const r = layout(hand.DACTYL);
  report(t, r);
  assert.deepEqual(r.r.handHits, []);
  assert.deepEqual(r.r.capHits, []);
  assert.ok(r.r.height <= hand.TRAY, `${r.r.height.toFixed(1)} mm tall`);
  assert.deepEqual(hand.problems(r.r), []);
});
const withMix = (base: typeof hand.DACTYL, palmar: number, curl: number, press: number) => ({
  ...structuredClone(base),
  thumb: { ...base.thumb, reach: { palmar, curl }, press },
});

test('each thumb key faces against the press, its mix as set, the reach in its plane', () => {
  for (const [name, s] of [
    ['Dactyl fit', hand.DACTYL],
    ['Natural', hand.NATURAL],
    ['Dactyl fit, reach 0.3/0, press 30°', withMix(hand.DACTYL, 0.3, 0, 30)],
    ['Natural, reach 0/0.6, press -15°', withMix(hand.NATURAL, 0, 0.6, -15)],
  ] as const)
    hand.solveHand(s).row.forEach((k, i) => {
      const at = `${hand.THUMB_ROW[i]} (${name})`,
        n = new T.Vector3().setFromMatrixColumn(k.frame, 2),
        x = new T.Vector3().setFromMatrixColumn(k.frame, 0),
        point = hand.carry(k.q, k.at),
        deg = (r: number) => (r * 180) / Math.PI;
      assert.ok(k.miss < 0.01, `${at}: misses by ${k.miss.toFixed(2)}`);
      assert.ok(n.distanceTo(k.n) < 1e-9);
      // The press: the set mix of palmar abduction and curl, less some of the
      // reach's mix; the touching point sets off straight into the key.
      const reach = [1, s.thumb.reach.palmar, s.thumb.reach.curl],
        set = k.press.map((v, j) => v - k.press[0] * reach[j]);
      assert.ok(Math.abs(set[0]) < 1e-12);
      assert.ok(
        Math.abs(deg(Math.atan2(set[2], set[1])) - s.thumb.press) < 1e-6,
        `${at}: the press's mix`,
      );
      assert.ok(!k.away, `${at}: pressing moves the thumb off`);
      assert.ok(hand.pressed(k.q, 0, k.press).every((v, j) => Math.abs(v - k.q[j]) < 1e-9));
      const into = point(hand.pressed(k.q, 0.1, k.press)).sub(k.at);
      assert.ok(Math.abs(into.length() - 0.1) < 0.002, `${at}: 0.1 mm goes ${into.length()}`);
      assert.ok(deg(into.angleTo(n.clone().negate())) < 1, `${at}: the press sets off askew`);
      // The reach: swinging out by its mix, the touching point goes along the
      // key, toward the far key.
      const out = point(hand.moveBy(k.q, [1, s.thumb.reach.palmar, s.thumb.reach.curl], 0.05)).sub(
        k.at,
      );
      assert.ok(deg(out.angleTo(x.clone().negate())) < 1, `${at}: not along the reach`);
    });
});

test('the thumb keys: home at its place round the arc, the others the reach mix away, spacing apart', () => {
  for (const s of [hand.DACTYL, hand.NATURAL]) {
    const h = hand.solveHand(s),
      top = h.poses.middle[1].chain.pad.z,
      name = s === hand.DACTYL ? 'Dactyl fit' : 'Natural',
      [far, home, near] = h.row,
      q0 = hand.photoPose(s.thumb.around);
    assert.ok(home.miss < 0.01, `${name}: home misses by ${home.miss.toFixed(2)}`);
    // Its touching point the drop below the middle home key, at its place round the arc.
    assert.ok(Math.abs(home.at.z - (top - s.thumb.drop)) < 0.01, `${name}: home at ${home.at.z}`);
    assert.ok(Math.abs(home.around - s.thumb.around) < 0.05, `${name}: ${home.around}° round`);
    // The photos' bends for that place, and its turn about the metacarpal the
    // photos' and what comes with the swing.
    assert.ok(Math.abs(q0[3] - home.q[3]) < 1e-9 && Math.abs(q0[4] - home.q[4]) < 1e-9);
    assert.ok(
      Math.abs(
        home.q[2] - (q0[2] + hand.twistAt(home.q[0], home.q[1]) - hand.twistAt(q0[0], q0[1])),
      ) < 1e-9,
      `${name}: twist`,
    );
    // The far key swung out, the near back, each moved by the reach's mix.
    for (const [k, sign, which] of [
      [far, 1, 'far'],
      [near, -1, 'near'],
    ] as const) {
      const by = k.q[0] - home.q[0],
        want = hand.moveBy(home.q, [1, s.thumb.reach.palmar, s.thumb.reach.curl], by);
      assert.ok(Math.sign(by) === sign, `${name}: ${which} swung ${by.toFixed(1)}°`);
      assert.ok(
        want.every((v, j) => Math.abs(v - k.q[j]) < 1e-9),
        `${name}: ${which} isn't the reach's mix from home`,
      );
      assert.ok(k.miss < 0.01, `${name}: ${which} misses by ${k.miss.toFixed(2)}`);
      assert.ok(
        Math.abs(k.at.distanceTo(home.at) - s.spacing) < 0.05,
        `${name}: ${which} key ${k.at.distanceTo(home.at).toFixed(2)} mm from home`,
      );
    }
  }
});

test('1.5u + 2×1u: the thumb bent until it touches the gap from the 1.5u; the 1u keys half the spacing either side', () => {
  for (const gap of [19.5, 8]) {
    const s = { ...structuredClone(hand.DACTYL), cluster: '1.5u + 2×1u', two: { gap } },
      h = hand.solveHand(s),
      [a, home, b] = h.row,
      mid = h.row.mid,
      at = `gap ${gap}`;
    for (const k of h.row) assert.ok(k.miss < 0.01, `${at}: misses by ${k.miss.toFixed(2)}`);
    // One extra bend at the MCP and IP alike, more for a gap toward the palm
    // (the 1.5u's pose is the photos'), within the joints' range.
    const q0 = hand.photoPose(s.thumb.around),
      bend = mid.q[3] - q0[3];
    assert.ok(Math.abs(mid.q[4] - q0[4] - bend) < 1e-9, `${at}: bent alike`);
    assert.ok(Math.sign(bend) === Math.sign(gap), `${at}: bent ${bend.toFixed(1)}°`);
    assert.ok(mid.q[3] < 89 && mid.q[4] < 89, `${at}: at the joints' end`);
    assert.ok(
      Math.abs(mid.p.distanceTo(home.at) - Math.abs(gap)) < 0.05,
      `${at}: ${mid.p.distanceTo(home.at).toFixed(2)} mm from the 1.5u`,
    );
    for (const k of [a, b]) {
      const want = hand.moveBy(
        mid.q,
        [1, s.thumb.reach.palmar, s.thumb.reach.curl],
        k.q[0] - mid.q[0],
      );
      assert.ok(
        want.every((v, j) => Math.abs(v - k.q[j]) < 1e-9),
        `${at}: not the reach's mix`,
      );
      assert.ok(Math.abs(k.at.distanceTo(mid.p) - s.spacing / 2) < 0.05, `${at}: half the spacing`);
    }
  }
});

test("a reach or press that takes the thumb past its joints isn't valid", () => {
  // The photos' sweep has nearly 1° of curl per degree swung: back toward the
  // near key, it straightens the thumb past its joints.
  const s = withMix(hand.DACTYL, -0.3, 0.9, 0),
    c = clone(defaults).config;
  hand.applyHand(c, s, hand.anchorOf(c));
  const r = hand.check(c, s);
  assert.deepEqual(
    r.pastJoints.map((x) => x.key),
    ['thumb near'],
  );
  assert.ok(hand.problems(r).some((p) => p.startsWith('thumb near: the thumb')));
});
test("the photos' thumb poses put it on each print, above the paper", () => {
  for (const k of ['1', '2', '3', '4', '5']) {
    const th = hand.thumb((hand.cmcPoses as Record<string, number[]>)[k]),
      print = (hand.prints as Record<string, number[]>)[k],
      // The last section's lowest point across it at `p` on the bone: its
      // flat pad and round edges, either side of the bone.
      lowest = (p: InstanceType<typeof T.Vector3>) => {
        const g = new T.Vector3(0, 0, -1).addScaledVector(th.u, th.u.z).normalize(),
          across = Math.max(-1, Math.min(1, g.dot(th.side) / 0.05));
        return p
          .clone()
          .addScaledVector(th.side, across * hand.THUMB_EDGE)
          .addScaledVector(g, hand.THUMB_R);
      },
      at = lowest(th.axis);
    // To the fit's half mm.
    assert.ok(Math.abs(at.z) < 0.5, `print ${k}: the pad ${at.z.toFixed(2)} mm up`);
    assert.ok(Math.hypot(at.x - print[0], at.y - print[1]) < 0.5, `print ${k}: off the print`);
    // Nothing else in the paper (a mm into the skin allowed).
    for (const p of [th.I, th.end]) assert.ok(lowest(p).z > -1.1, `print ${k}: in the paper`);
    assert.ok(th.M.z > hand.THUMB_R && th.I.z > hand.THUMB_R, `print ${k}: a knuckle in the paper`);
  }
});

const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
/** Rows reached with the MCP curling `mix` degrees per PIP degree. */
const reaching =
  (mix: number): ReturnType<typeof hand.wayOf> =>
  () => [mix, 1];
// The reach mixes the wrist height gives, near the low end, where the MCP curls as the PIP straightens.
const MIXES = [hand.MIX_MIN, -0.3, -0.2, -0.1, 0, 0.4, 1, 3];

test('the wrist height rises with the reach mix, so each height is one reach (or past them all)', () => {
  for (const curl of [-15, 0, 15, 25, 40]) {
    let prev = -Infinity;
    for (let m = hand.MIX_MIN; m <= 3.001; m += 0.05) {
      const h = hand.wristHeightAt(curl, m);
      assert.ok(h > prev, `curl ${curl}, mix ${m.toFixed(2)}: ${h.toFixed(1)} mm`);
      prev = h;
    }
    for (const m of [-0.3, -0.2, 0, 0.29, 1]) {
      const r = hand.mixFor(curl, hand.wristHeightAt(curl, m));
      assert.ok(Math.abs(r.mix - m) < 1e-4 && r.off === 0, `curl ${curl}, mix ${m}`);
    }
    const top = hand.wristHeightAt(curl, 3);
    assert.ok(
      Math.abs(hand.mixFor(curl, top + 10).off - 10) < 1e-6,
      `curl ${curl}: 10 mm too high`,
    );
  }
});

test('every row is its set distance from home, centre to centre, or out of reach', () => {
  for (const mix of MIXES)
    for (const curl of [0, 14])
      for (const f of FINGERS)
        for (const d of [17.7, -17.7]) {
          const way = reaching(mix),
            home = hand.rowPose(f, curl, 0, 0, way),
            p = hand.rowPose(f, curl, 0, d, way),
            at = `${f}, curl ${curl}, mix ${mix}, ${d} mm`;
          if (p.short > 0.5) assert.ok(p.pip < -15, `${at}: short only where the finger is flat`);
          else assert.ok(Math.abs(p.chain.pad.distanceTo(home.chain.pad) - 17.7) < 0.05, at);
        }
});

test("down to the slider's lowest reach mix, the fingertip moves along the board between rows", () => {
  for (const mix of MIXES.filter((m) => m <= 0.4))
    for (const curl of [-15, 0, 14, 25])
      for (const f of FINGERS) {
        const way = reaching(mix),
          h = hand.rowPose(f, curl, 0, 0, way).t.clone().setZ(0).normalize();
        for (let d = -25; d <= 25; d += 2.5) {
          const along = hand.rowPose(f, curl, 0, d, way).t.dot(h);
          assert.ok(along > 0.15, `${f}, curl ${curl}, mix ${mix}, ${d} mm: ${along.toFixed(2)}`);
        }
      }
});

// The Dactyl Manuform's keys (tests/dactyl-keys.json says where from).
const DM = JSON.parse(readFileSync(new URL('./dactyl-keys.json', import.meta.url), 'utf8'))
  .keys as Record<string, [number[], number[]]>;
/** Degrees a key faces toward you (its far edge up), before tenting. */
const tilt = (n: InstanceType<typeof T.Vector3>) => (Math.atan2(-n.y, n.z) * 180) / Math.PI;
/** How far settings `s` put the keys (the thumb's too) from the Dactyl's,
 * relative to the middle home key, before tenting: squared, per 2 mm and per
 * 3° (0.05 in the facing; the thumb keys' place only). Infinite where a row
 * is out of reach. */
function offDactyl(s: Settings) {
  const h = hand.solveHand(s),
    caps = hand.capsOf(clone(defaults).config, h, false),
    R = hand.turnOf(s),
    at = (k: (typeof caps)[number]) => new T.Vector3().setFromMatrixPosition(k.top),
    o = at(caps.find((k) => k.name === 'matrix_middle_home')!),
    keys = caps.map((k) => {
      const name = k.name.replace(/^matrix_/, ''),
        p = at(k).sub(o).applyMatrix4(R),
        n = new T.Vector3().setFromMatrixColumn(k.top, 2).transformDirection(R),
        [p0, n0] = DM[name].map((v) => new T.Vector3(...v));
      return {
        name,
        mm: p.distanceTo(p0),
        angle: (Math.acos(Math.min(1, n.dot(n0))) * 180) / Math.PI,
        // The thumb keys by place alone: they face where a swing at the CMC
        // presses them straight, and the Dactyl's face you, which takes
        // straightening the thumb to press.
        cost:
          p.sub(p0).divideScalar(2).lengthSq() +
          (name.startsWith('thumb') ? 0 : n.clone().sub(n0).divideScalar(0.05).lengthSq()),
        tilt: tilt(n),
        dm: tilt(n0),
      };
    }),
    short = Object.values(h.poses).some((P) => P.some((p) => p.short > 0.5));
  return { cost: short ? Infinity : keys.reduce((a, k) => a + k.cost, 0), keys };
}
/** Why settings `s` aren't valid: the keycaps, the hand (against the frame
 * too), and the frame's own faults. */
function wrongOf(s: Settings) {
  const { r, frame } = layout(s);
  return [...hand.problems(r), ...frame.faults];
}

// The settings fitted, each moved half a step at a time: the finger curl (the
// wrist height following, to keep the reach), the hand's pitch on the board,
// the thumb keys' place round the arc and drop, and the gaps.
const FIT: [string, (s: Settings, d: number) => void][] = [
  ['finger curl', (s, d) => FINGERS.forEach((f) => (s.curl[f] += d))],
  ['pitch', (s, d) => (s.pitch += d)],
  ['thumb keys round the arc', (s, d) => (s.thumb.around += d)],
  ['thumb keys below the home row', (s, d) => (s.thumb.drop += d)],
  ['thumb key spacing', (s, d) => (s.spacing += d)],
  ['row gap', (s, d) => ((s.top += d), (s.bottom += d))],
  ['inner column gap', (s, d) => (s.innerGap += d)],
];
test("Dactyl fit: at the reach seen on the Dactyl, the valid layout whose keys are closest to the Dactyl's", (t) => {
  const s0 = hand.DACTYL,
    { mix } = hand.mixFor(s0.curl.middle, s0.wristHeight),
    cost0 = offDactyl(s0).cost;
  // Rows reached with the MCP curling -0.1° per PIP degree (the finger
  // straightening as the MCP bends), as seen on the Dactyl (-0.1 to -0.3).
  assert.ok(Math.abs(mix + 0.1) < 0.005, `reach mix ${mix.toFixed(3)}`);
  t.diagnostic(`wrist ${s0.wristHeight} mm, reach mix ${mix.toFixed(2)}, cost ${cost0.toFixed(0)}`);
  for (const k of offDactyl(s0).keys)
    t.diagnostic(
      `${k.name}: ${k.mm.toFixed(1)} mm off, facing ${k.angle.toFixed(0)}° off; faces you ${k.tilt.toFixed(1)}° (Dactyl ${k.dm.toFixed(1)}°)`,
    );
  assert.deepEqual(wrongOf(s0), []);
  // No half step in any one setting gives a valid layout closer to the Dactyl.
  for (const [name, move] of FIT)
    for (const d of [0.5, -0.5]) {
      const s = structuredClone(s0);
      move(s, d);
      s.wristHeight = hand.wristHeightAt(s.curl.middle, mix);
      const cost = offDactyl(s).cost;
      if (cost < cost0)
        assert.ok(
          wrongOf(s).length,
          `${name} ${d > 0 ? '+' : ''}${d}: valid and closer (${cost.toFixed(0)})`,
        );
    }
});

const PRESETS = [
  ['Dactyl fit', hand.DACTYL],
  ['Natural', hand.NATURAL],
  ['Yours', hand.YOURS],
  ['No curl', hand.NO_CURL],
] as const;
test('every preset is valid: the keycaps, the hand reaching each key, and the printed frame', () => {
  for (const [name, s] of PRESETS) assert.deepEqual(wrongOf(s), [], name);
});
test("keys whose tiles overlap aren't valid: the boards and the parts hanging under them", () => {
  const tiles = (s: Settings) => {
    const c = clone(defaults).config;
    hand.applyHand(c, s, hand.anchorOf(c));
    return hand
      .check(c, s)
      .tileHits.map((x) => `${x.a} ${x.b}`)
      .sort();
  };
  // Natural's inner column where it was, 18.8 mm from the index: the
  // keycaps clear, the tiles don't.
  assert.deepEqual(
    tiles({ ...structuredClone(hand.NATURAL), innerGap: 18.8 }),
    ROWS.map((r) => `matrix_index_${r} matrix_inner_${r}`).sort(),
  );
  assert.deepEqual(tiles(hand.NATURAL), []);
  // Yours's thumb as it was, each key facing its own press: the far and home
  // keys tilt together, so their boards (20 mm under the keycaps' tops) meet.
  assert.deepEqual(
    tiles({
      ...structuredClone(hand.YOURS),
      thumb: { around: 116.5, drop: 14.5, reach: { palmar: 0.5, curl: 0.55 }, press: -3 },
      spacing: 26.8,
    }),
    ['thumb_far thumb_home'],
  );
});
test("far and near thumb keys keep the home key's y, tilted only along the row", () => {
  const at = (s: Settings) => hand.solveHand(s).row,
    yours = at(hand.YOURS),
    own = at({ ...structuredClone(hand.YOURS), thumb: { ...hand.YOURS.thumb, parallel: false } }),
    [far, home, near] = yours,
    y = (k: (typeof yours)[number]) => new T.Vector3().setFromMatrixColumn(k.frame, 1);
  assert.equal(home.slant, 0);
  [far, near].forEach((k) => {
    // The home key's y, and square to it.
    assert.ok(y(k).angleTo(y(home)) < 1e-9);
    assert.ok(Math.abs(k.n.dot(y(home))) < 1e-9);
    assert.ok(k.n.angleTo(home.n) > (5 * Math.PI) / 180);
    assert.ok(k.slant < 20, `${k.slant}`);
    assert.ok(!k.away);
    assert.ok(Math.abs(k.at.distanceTo(home.at) - hand.YOURS.spacing) < 0.05);
  });
  // Tilted toward its press, the near key is pressed nearly square (all
  // three facing alike, 10° off).
  assert.ok(near.slant < 5, `${near.slant}`);
  assert.ok(own.every((k) => k.slant === 0));
});
test('the extra thumb keys hang off the row under its gaps, and exist only when on', () => {
  const on = {
      ...structuredClone(hand.YOURS),
      extra: { ...hand.START.extra, on: true },
    },
    { c, r, frame } = layout(on),
    anchor = hand.anchorOf(clone(defaults).config),
    world = hand.worldOf(c, anchor, on),
    f = componentFrames(c),
    row = r.h.row,
    base = hand.thumb(row[1].q).M,
    gaps = [
      [1, 2],
      [0, 1],
    ].map(([a, b]) => ({
      p: row[a].at.clone().add(row[b].at).multiplyScalar(0.5),
      n: row[a].n.clone().add(row[b].n).normalize(),
    })),
    // Each with `lower` 0, to see the lowering.
    up = hand.solveHand({ ...on, extra: { ...on.extra, lower: 0 } }).extra,
    // And slid 4 mm toward the near key.
    slid = hand.solveHand({ ...on, extra: { ...on.extra, along: -4 } }).extra,
    towardFar = row[0].at.clone().sub(row[2].at).normalize();
  assert.equal(r.h.extra.length, 2);
  // The row curves, so the two are moved apart to the row's spacing, lowered
  // or not.
  for (const ks of [r.h.extra, up])
    assert.ok(Math.abs(ks[0].at.distanceTo(ks[1].at) - on.spacing) < 0.01);
  r.h.extra.forEach((k, i) => {
    const name = `thumb_x${i + 1}`,
      gap = gaps[i];
    assert.ok(k.miss < 0.01, `${name}: ${k.miss} mm off`);
    // Facing `tilt` degrees off the gap's facing, turned toward the thumb's base.
    assert.ok(Math.abs(T.MathUtils.radToDeg(k.n.angleTo(gap.n)) - on.extra.tilt) < 1e-6, name);
    assert.ok(k.n.clone().sub(gap.n).dot(base.clone().sub(gap.p)) > 0, name);
    // Toward the thumb's base from the gap, about `south` mm across the faces.
    const d = k.at.clone().sub(gap.p);
    assert.ok(d.dot(base.clone().sub(gap.p)) > 0, `${name}: away from the thumb's base`);
    assert.ok(Math.abs(d.length() - on.extra.south) < 5, `${name}: ${d.length()} mm`);
    // `lower` mm down along its normal (and moved apart a little more).
    const down = k.at.clone().sub(up[i].at);
    assert.ok(Math.abs(down.dot(k.n) + on.extra.lower) < 0.1, `${name}: ${down.dot(k.n)}`);
    assert.ok(down.length() < on.extra.lower + 0.1, name);
    // Slid along the row (far to near), facing the same way.
    const by = slid[i].at.clone().sub(k.at);
    assert.ok(by.distanceTo(towardFar.clone().multiplyScalar(-4)) < 1e-6, name);
    assert.ok(slid[i].n.angleTo(k.n) < 1e-9, name);
    // The frame square to the face.
    assert.ok(Math.abs(new T.Vector3().setFromMatrixColumn(k.frame, 0).dot(k.n)) < 1e-9);
    // In the extra cluster where the hand puts it: its cap top straight up
    // from its seat (the layout rounds both to 0.01 mm and 0.01°).
    const seat = f[name],
      rise = k.at.clone().applyMatrix4(world).sub(new T.Vector3().setFromMatrixPosition(seat));
    assert.ok(rise.length() > 5);
    assert.ok(rise.angleTo(new T.Vector3().setFromMatrixColumn(seat, 2)) < 0.005, name);
    // Checked like the row's keys, and in the frame.
    assert.ok(r.caps.some((x) => x.name === name));
  });
  // Clear of each other and the row (and not checked for the back of the
  // thumb, though the thumb's tip, all the model presses with, meets them so).
  assert.ok(r.h.extra.every((k) => Math.abs(k.roll) > hand.BACK_OF_THUMB));
  assert.deepEqual(wrongOf(on), []);
  // No curl's own place for them is clear too.
  assert.deepEqual(wrongOf({ ...hand.NO_CURL, extra: { ...hand.NO_CURL.extra!, on: true } }), []);
  const off = layout(hand.YOURS);
  assert.ok(frame.volume > off.frame.volume + 0.5, 'the frame holds the extra keys');
  // Off: none, and the cluster as it was by default.
  assert.equal(off.r.h.extra.length, 0);
  assert.ok(!off.r.caps.some((x) => x.name.startsWith('thumb_x')));
  assert.deepEqual(
    (off.c.geometry as { thumb_extra?: unknown }).thumb_extra,
    (defaults.config.geometry as { thumb_extra?: unknown }).thumb_extra,
  );
});
test('on every preset the thumb rests on its keys without going into them (but for the soft pad)', () => {
  for (const [name, s] of PRESETS) {
    const c = clone(defaults).config;
    hand.applyHand(c, s, hand.anchorOf(c));
    const r = hand.check(c, s);
    r.h.row.forEach((k, i) => {
      const key = `thumb_${hand.THUMB_ROW[i]}`,
        cap = r.caps.find((x) => x.name === key)!,
        inv = cap.top.clone().invert(),
        th = hand.thumb(k.q),
        { segs } = hand.thumbPart(th, []);
      // How far any part of the thumb is below the keycap's top, over its top.
      let deep = 0;
      for (const [a, b, rad] of segs)
        for (let j = 0; j <= 40; j++) {
          const p = a
            .clone()
            .lerp(b, j / 40)
            .applyMatrix4(inv);
          if (Math.abs(p.x) < 7 && Math.abs(p.y) < 7) deep = Math.max(deep, rad - p.z);
        }
      assert.ok(deep < 0.8, `${name}, ${key}: ${deep.toFixed(1)} mm into the keycap`);
    });
  }
});
test("the test frame is one piece on legs under the plates' outer corners, flat on the floor, with no faults", (t) => {
  for (const [name, s] of PRESETS) {
    const { frame } = layout(s);
    t.diagnostic(
      `${name}: ${frame.pieces} piece(s), ${frame.volume.toFixed(1)} cm³, ${frame.size.map((x) => x.toFixed(0)).join('×')} mm; ${frame.faults.join('; ') || 'no faults'}; ${frame.warnings.join('; ') || 'no warnings'}`,
    );
    assert.equal(frame.pieces, 1);
    // Flat on the floor: nothing below it, and no overhang just above it
    // (the slicer would put a sliver of support under it): faces looking
    // down, under 1 mm up and not on the floor, joined where they share a
    // corner, none a printed line (0.4 mm) across or wider. (Booleans leave
    // the odd notch smaller than that, which prints as it is.)
    const P = frame.mesh.positions,
      I = frame.mesh.indices,
      v = (i: number) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2] - frame.floor],
      hover: number[][] = [];
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [I[t], I[t + 1], I[t + 2]].map(v),
        u = [0, 1, 2].map((k) => b[k] - a[k]),
        w = [0, 1, 2].map((k) => c[k] - a[k]),
        n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]],
        low = Math.min(a[2], b[2], c[2]);
      assert.ok(low > -0.01, `below the floor: ${low.toFixed(2)} mm`);
      if (n[2] < 0 && low >= 0.01 && Math.max(a[2], b[2], c[2]) < 1)
        hover.push([I[t], I[t + 1], I[t + 2]]);
    }
    const group = new Map<number, number>(),
      root = (i: number): number => {
        const g = group.get(i) ?? i;
        return g === i ? i : root(g);
      };
    for (const [a, b, c] of hover) for (const x of [b, c]) group.set(root(x), root(a));
    const patches = new Map<number, number[]>();
    for (const f of hover)
      for (const i of f) {
        const k = root(i),
          [x, y, z] = v(i),
          q = patches.get(k) ?? [Infinity, Infinity, -Infinity, -Infinity, Infinity];
        patches.set(k, [
          Math.min(q[0], x),
          Math.min(q[1], y),
          Math.max(q[2], x),
          Math.max(q[3], y),
          Math.min(q[4], z),
        ]);
      }
    for (const [x0, y0, x1, y1, low] of patches.values())
      assert.ok(
        Math.hypot(x1 - x0, y1 - y0) < 0.4,
        `${name}: an overhang ${Math.hypot(x1 - x0, y1 - y0).toFixed(1)} mm across, ${low.toFixed(2)} mm above the floor at ${x0.toFixed(0)}, ${y0.toFixed(0)}`,
      );
    // No faults: every leg clears every switch and keycap, nothing cut.
    assert.deepEqual(frame.faults, []);
  }
});

/** Whether point p is inside the frame's mesh: the faces straight above it, odd or even. */
function insideMesh(frame: ReturnType<typeof buildFrame>, p: number[]) {
  const P = frame.mesh.positions,
    I = frame.mesh.indices,
    // A little off any vertex or edge the mesh may have on the ray.
    [x, y] = [p[0] + 0.0137, p[1] + 0.0071];
  let n = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, d] = [I[t], I[t + 1], I[t + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    if (Math.max(a[2], b[2], d[2]) < p[2]) continue;
    const area = (u: number[], v: number[]) =>
        (v[0] - u[0]) * (y - u[1]) - (v[1] - u[1]) * (x - u[0]),
      [wa, wb, wd] = [area(b, d), area(d, a), area(a, b)],
      all = wa + wb + wd;
    if (Math.abs(all) < 1e-12 || !((wa > 0 && wb > 0 && wd > 0) || (wa < 0 && wb < 0 && wd < 0)))
      continue;
    if ((wa * a[2] + wb * b[2] + wd * d[2]) / all > p[2]) n++;
  }
  return n % 2 === 1;
}

test('a truss along each outside wall: diagonals from each side end to a foot, solid to the plate', (t) => {
  for (const s of [hand.DACTYL, hand.NATURAL]) {
    const { c, frame } = layout(s),
      name = s === hand.DACTYL ? 'Dactyl fit' : 'Natural',
      cols = c.geometry.columns.map((x) => x.name),
      thumbs = c.geometry.thumb.keys.map((k) => `thumb_${k.name}`),
      sideOf = (m: (typeof frame.truss)[number]) => `${m.key} ${m.side}`,
      // The finger matrix's outside sides: the top and bottom rows' (along
      // the column, + toward the top), the inner and pinky columns' (across).
      want = cols.flatMap((col, ci) =>
        ROWS.flatMap((row, ri) =>
          [
            ri === 0 && '1,1',
            ri === ROWS.length - 1 && '1,-1',
            ci === 0 && '0,-1',
            ci === cols.length - 1 && '0,1',
          ]
            .filter((x) => x)
            .map((x) => `matrix_${col}_${row} ${x}`),
        ),
      ),
      got = [...new Set(frame.truss.map(sideOf))];
    t.diagnostic(
      `${name}: ${frame.truss.filter((m) => m.node !== 'post').length} diagonals, ${frame.truss.filter((m) => m.node === 'post').length} posts`,
    );
    // Every outside side of the matrix has the truss under it, and nothing
    // else of it does; the thumb row, both its long sides and its ends.
    assert.deepEqual(got.filter((x) => x.startsWith('matrix_')).sort(), [...want].sort());
    assert.equal(got.filter((x) => x.startsWith('thumb_')).length, 2 * thumbs.length + 2);
    for (const k of thumbs)
      assert.ok(
        got.some((x) => x.startsWith(`${k} `)),
        `${k}: no truss under it`,
      );
    // Both ends of a side meet at one foot (a V), and every diagonal stands
    // 30° or more; where a side has only one, the other end is a corner's
    // leg (too low for one) or a post.
    for (const side of got) {
      const ms = frame.truss.filter((m) => sideOf(m) === side && m.node !== 'post');
      if (ms.length === 2) assert.deepEqual(ms[0].foot, ms[1].foot, `${side}: two feet`);
      for (const m of ms) {
        const run = Math.hypot(m.top[0] - m.foot[0], m.top[1] - m.foot[1]),
          deg = (Math.atan2(m.top[2] - m.foot[2], run) * 180) / Math.PI;
        assert.ok(deg >= 30, `${side} end ${m.end}: ${deg.toFixed(0)}°`);
      }
    }
    // Each gap along an outside edge (the matrix's outside rows' and
    // columns', and the thumb row's on both sides) is held: by a diagonal,
    // or a post.
    const gaps = new Set(
      frame.truss.filter((m) => m.node === 'gap' || m.node === 'post').map((m) => m.top.join()),
    );
    assert.equal(
      gaps.size,
      2 * (cols.length - 1) + 2 * (ROWS.length - 1) + 2 * (thumbs.length - 1),
      `${name}: gaps held`,
    );
    // Solid all along each, from just off the floor to where it leaves the
    // plate.
    for (const { key, side, end, top, foot } of frame.truss) {
      const l = Math.hypot(...top.map((x, i) => x - foot[i])),
        steps = Math.ceil(l);
      for (let i = 1; i < steps; i++) {
        const p = foot.map((x, k) => x + ((top[k] - x) * i) / steps);
        if (p[2] - frame.floor < 0.3) continue;
        assert.ok(
          insideMesh(frame, p),
          `${name}: ${key} ${side} end ${end}: not solid ${(i / steps).toFixed(2)} of the way up, at ${p.map((x) => x.toFixed(1))}`,
        );
      }
    }
  }
});

test('a web too thin to print is left out, the truss and the other webs holding its keys', () => {
  // The bottom row 16 mm from home: the pinky's bottom key sits well below
  // the ring's, so the web between them is a steep wall, a third of it too
  // thin to print.
  const { frame } = layout({ ...hand.DACTYL, bottom: 16 });
  assert.deepEqual(frame.websLeftOut, [['matrix_ring_bottom', 'matrix_pinky_bottom']]);
  assert.ok(
    frame.warnings.some((w) =>
      w.startsWith('the web between ring bottom and pinky bottom is left out'),
    ),
  );
  assert.equal(frame.pieces, 1);
  assert.deepEqual(frame.faults, []);
  // The presets have every web.
  for (const s of [hand.DACTYL, hand.NATURAL]) assert.deepEqual(layout(s).frame.websLeftOut, []);
});

test('the thumb keys move smoothly as each thumb setting changes, wherever the layout is free of thumb faults', () => {
  type S = typeof hand.DACTYL;
  const knobs: [string, (s: S, v: number) => void, number, number, number][] = [
    ['reach palmar', (s, v) => (s.thumb.reach.palmar = v), -2, 2, 0.05],
    ['reach curl', (s, v) => (s.thumb.reach.curl = v), -2, 2, 0.05],
    ['press', (s, v) => (s.thumb.press = v), -90, 90, 1],
    ['around', (s, v) => (s.thumb.around = v), 70, 180, 1],
    ['drop', (s, v) => (s.thumb.drop = v), -20, 50, 0.5],
    ['spacing', (s, v) => (s.spacing = v), 12, 40, 0.5],
  ];
  const jumps: string[] = [];
  for (const [name, base] of [
    ['Dactyl fit', hand.DACTYL],
    ['Natural', hand.NATURAL],
  ] as const)
    for (const [knob, set, lo, hi, step] of knobs) {
      let prev: { row: ReturnType<typeof hand.solveHand>['row']; fault: boolean } | undefined;
      for (let i = 0; lo + i * step <= hi + 1e-9; i++) {
        const v = Math.round((lo + i * step) * 100) / 100,
          s = structuredClone(base);
        set(s, v);
        const row = hand.solveHand(s).row,
          fault = row.some((k) => k.away || Math.abs(k.roll) > hand.BACK_OF_THUMB || k.miss > 0.01);
        if (prev && !fault && !prev.fault)
          row.forEach((k, j) => {
            const mm = k.at.distanceTo(prev!.row[j].at),
              turn = (k.n.angleTo(prev!.row[j].n) * 180) / Math.PI;
            if (mm > 4 || turn > 12)
              jumps.push(`${name}, ${knob} ${v}: ${mm.toFixed(1)} mm, ${turn.toFixed(0)}°`);
          });
        prev = { row, fault };
      }
    }
  assert.deepEqual(jumps, []);
});

test('a thumb key past 180° round the arc is that far round, with only its real miss', () => {
  const t = { ...hand.DACTYL.thumb, around: 185, drop: 0 },
    home = hand.thumbRow(t, 24, 0)[1];
  assert.ok(Math.abs(home.around - 185) < 0.05, `${home.around}° round`);
  // The miss is the thumb falling short of the photos' reach (14 mm), not a lap of the arc.
  assert.ok(home.miss < 20, `misses by ${home.miss.toFixed(0)} mm`);
});

test('a saved state with a value that is not a setting keeps the start for it', () => {
  const bad = hand.stateOf({
      row: 'foo',
      thumbOn: 'middle',
      cluster: 'none',
      from: 3,
      tent: Number.NaN,
      pitch: Infinity,
      spacing: 20,
      handle: 'off',
      thumb: { around: 'far', drop: 5 },
    }),
    start = hand.START;
  assert.equal(bad.row, start.row);
  assert.equal(bad.thumbOn, start.thumbOn);
  assert.equal(bad.cluster, start.cluster);
  assert.equal(bad.from, start.from);
  assert.equal(bad.tent, start.tent);
  assert.equal(bad.pitch, start.pitch);
  assert.equal(bad.thumb.around, start.thumb.around);
  // The valid ones still go in.
  assert.equal(bad.spacing, 20);
  assert.equal(bad.handle, 'off');
  assert.equal(bad.thumb.drop, 5);
});

test('a frame is built where two joined keys overlap or a bar has no length', () => {
  const base = {
    innerGap: 18.8,
    top: 19.1,
    bottom: 19.1,
    from: 'reach',
    pressMix: 1.4,
    cluster: '1×3',
    two: { gap: 19.5 },
  };
  const cases = [
    {
      // Two joined keys' facing edges coincide: no web axis to cut across.
      s: {
        tent: 41,
        roll: -8,
        pitch: 25,
        bend: -8,
        curl: { index: -30, middle: 40, ring: 40, pinky: 40 },
        innerAngle: -10,
        wristHeight: -21,
        thumb: { around: 167, drop: -20, reach: { palmar: 2, curl: 0.05 }, press: 10 },
        spacing: 40,
      },
      tris: 13156,
      pieces: 1,
    },
    {
      // Where the brackets once had a strut 1.2e-14 mm long, whose direction
      // was rounding noise.
      s: {
        tent: 45,
        roll: -7,
        pitch: -25,
        bend: 11,
        curl: { index: -30, middle: -30, ring: 17, pinky: 27 },
        innerAngle: 30,
        wristHeight: 108,
        thumb: { around: 155, drop: -16, reach: { palmar: 2, curl: -2 }, press: 82 },
        spacing: 32,
      },
      tris: 11198,
      pieces: 1,
    },
  ];
  for (const { s, tris, pieces } of cases) {
    const c = clone(defaults).config,
      settings = { ...structuredClone(hand.DACTYL), ...base, ...s } as unknown as Settings;
    settings.curl = { ...hand.DACTYL.curl, ...s.curl };
    settings.thumb = { ...hand.DACTYL.thumb, ...s.thumb, reach: s.thumb.reach };
    hand.applyHand(c, settings, hand.anchorOf(c));
    const f = buildFrame(wasm, c);
    assert.equal(f.mesh.indices.length / 3, tris);
    assert.equal(f.pieces, pieces);
  }
});
