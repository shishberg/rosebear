// PROTOTYPE ?hand: the hand check (hand-prototype.ts) against the keyboard,
// the printed test frame (hand-frame.ts) included.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import { clone, componentFrames, defaults } from '../src/geometry';
import { buildFrame } from '../src/hand-frame';
import { _test as hand } from '../src/hand-prototype';

const { T } = hand;
const wasm = await Module();
wasm.setup();

type Settings = typeof hand.DACTYL;
/** Lay out the keys for settings `s`, build the frame and check the hand against both. */
function layout(s: Settings) {
  const c = clone(defaults).config,
    anchor = hand.anchorOf(c);
  hand.applyHand(c, s, anchor);
  const frame = buildFrame(wasm, c),
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
  assert.ok(r.r.height.all <= hand.TRAY, `${r.r.height.all.toFixed(1)} mm tall`);
  assert.deepEqual(hand.problems(r.r), []);
});
// Natural's printed frame: the index brushed the thumb cluster, which the
// model doesn't (yet) reproduce. Reported, not asserted.
test('Natural', (t) => report(t, layout(hand.NATURAL)));

test('each thumb key lies along the last bone in a plane through the CMC, and the thumb presses it straight down', () => {
  for (const s of [hand.DACTYL, hand.NATURAL])
    hand.solveHand(s).row.forEach((k, i) => {
      const at = `${['far', 'home', 'near'][i]} (${s === hand.DACTYL ? 'Dactyl fit' : 'Natural'})`,
        th = hand.thumb(k.q),
        n = new T.Vector3().setFromMatrixColumn(k.frame, 2);
      assert.ok(Math.abs(n.dot(th.u)) < 1e-6, `${at}: not along the last bone`);
      assert.ok(
        Math.abs(n.dot(k.at.clone().sub(hand.C))) < 1e-3,
        `${at}: its plane misses the CMC`,
      );
      // The point touching the key, carried with the last bone as the thumb presses.
      const side = (t: typeof th) => t.u.clone().cross(t.nail),
        rel = k.at.clone().sub(th.I),
        local = [rel.dot(th.u), rel.dot(th.nail), rel.dot(side(th))],
        point = (mm: number) => {
          const t = hand.thumb(hand.pressed(k.q, mm));
          return t.I.clone()
            .addScaledVector(t.u, local[0])
            .addScaledVector(t.nail, local[1])
            .addScaledVector(side(t), local[2]);
        };
      assert.deepEqual(hand.pressed(k.q, 0), k.q);
      // It sets off straight down the key's travel; a swing at the CMC then
      // carries it round an arc (about 85 mm across), sliding it a little
      // sideways on the cap over the key's 4 mm.
      const start = point(0.25).sub(k.at),
        off = (start.angleTo(n.clone().negate()) * 180) / Math.PI;
      assert.ok(off < 0.2, `${at}: sets off ${off.toFixed(2)}° from the key's travel`);
      const down = point(4).sub(k.at),
        slide = down.clone().addScaledVector(n, -down.dot(n)).length();
      assert.ok(
        Math.abs(-down.dot(n) - 4) < 0.05,
        `${at}: 4 mm goes ${(-down.dot(n)).toFixed(2)} down`,
      );
      assert.ok(slide < 0.15, `${at}: slides ${slide.toFixed(2)} mm on the cap`);
      // The animation's 15 mm back off the key.
      const back = point(-15).sub(k.at).length();
      assert.ok(Math.abs(back - 15) < 0.5, `${at}: 15 mm back moves ${back.toFixed(2)}`);
    });
});

test("the thumb keys: the photos' thumb pose for each place round the arc, straightened to the roll, swung back onto its place and lowered, the keys spacing apart", () => {
  for (const s of [hand.DACTYL, hand.NATURAL]) {
    const h = hand.solveHand(s),
      top = h.poses.middle[1].chain.pad.z,
      name = s === hand.DACTYL ? 'Dactyl fit' : 'Natural',
      arc = hand.arc;
    h.row.forEach((k, i) => {
      const at = `${['far', 'home', 'near'][i]} (${name})`;
      assert.ok(k.miss < 0.01, `${at}: misses by ${k.miss.toFixed(2)}`);
      // Its touching point the drop below the middle home key, its place round the arc.
      assert.ok(Math.abs(k.at.z - (top - s.thumb.drop)) < 0.01, `${at}: at ${k.at.z.toFixed(2)}`);
      const round = (Math.atan2(k.at.y - arc.centre[1], k.at.x - arc.centre[0]) * 180) / Math.PI;
      assert.ok(
        Math.abs(round - k.around) < 0.05,
        `${at}: ${round.toFixed(2)}° round, not ${k.around}`,
      );
      // On its outer edge as set.
      assert.ok(Math.abs(k.roll - s.thumb.roll) < 0.05, `${at}: rolled ${k.roll.toFixed(2)}°`);
      // The photos' pose for its place round the arc, the MCP and IP
      // straightened alike; its turn about the metacarpal the photos', and
      // what comes with the swing.
      const q0 = hand.photoPose(k.around);
      assert.ok(
        Math.abs(q0[3] - k.q[3] - k.straight) < 0.05 &&
          Math.abs(q0[4] - k.q[4] - k.straight) < 0.05,
        `${at}: bent ${k.q[3].toFixed(1)}/${k.q[4].toFixed(1)}, the photos ${q0[3].toFixed(1)}/${q0[4].toFixed(1)}`,
      );
      assert.ok(
        Math.abs(k.q[2] - (q0[2] + hand.twistAt(k.q[0], k.q[1]) - hand.twistAt(q0[0], q0[1]))) <
          1e-9,
        `${at}: twist`,
      );
    });
    // The home key `around` degrees round, and the others spacing from it.
    assert.equal(h.row[1].around, s.thumb.around);
    for (const i of [0, 2])
      assert.ok(
        Math.abs(h.row[i].at.distanceTo(h.row[1].at) - s.spacing) < 0.05,
        `${name}: ${i ? 'near' : 'far'} key ${h.row[i].at.distanceTo(h.row[1].at).toFixed(2)} mm from home`,
      );
  }
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
    assert.ok(Math.abs(at.z) < 0.2, `print ${k}: the pad ${at.z.toFixed(2)} mm up`);
    assert.ok(Math.hypot(at.x - print[0], at.y - print[1]) < 0.5, `print ${k}: off the print`);
    // Nothing else in the paper (a mm into the skin allowed).
    for (const p of [th.I, th.end]) assert.ok(lowest(p).z > -1.1, `print ${k}: in the paper`);
    assert.ok(th.M.z > hand.THUMB_R && th.I.z > hand.THUMB_R, `print ${k}: a knuckle in the paper`);
  }
});

test("a thumb key it can't press straight down with its pad isn't valid", () => {
  // The thumb straightened until the last bone points at the CMC, then past it.
  const q = (curl: number) => {
    const yaw = 123.1,
      pitch = 25.2;
    return [yaw, pitch, hand.twistAt(yaw, pitch), 32.3 + curl, 25.5 + curl];
  };
  assert.ok(hand.touch(q(-25)).miss > 0.5);
  assert.ok(Math.abs(hand.touch(q(-35)).roll) > 90);
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

test("the test frame is one piece on legs under the plates' outer corners, flat on the floor, with no faults", (t) => {
  for (const s of [hand.DACTYL, hand.NATURAL]) {
    const { frame } = layout(s);
    t.diagnostic(
      `${s === hand.DACTYL ? 'Dactyl fit' : 'Natural'}: ${frame.pieces} piece(s), ${frame.volume.toFixed(1)} cm³, ${frame.size.map((x) => x.toFixed(0)).join('×')} mm; ${frame.faults.join('; ') || 'no faults'}; ${frame.warnings.join('; ') || 'no warnings'}`,
    );
    assert.equal(frame.pieces, 1);
    // Flat on the floor: nothing below it, and no face looking down just
    // above it (the slicer would put a sliver of support under it).
    const P = frame.mesh.positions,
      I = frame.mesh.indices,
      v = (i: number) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2] - frame.floor];
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [I[t], I[t + 1], I[t + 2]].map(v),
        u = [0, 1, 2].map((k) => b[k] - a[k]),
        w = [0, 1, 2].map((k) => c[k] - a[k]),
        n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]],
        low = Math.min(a[2], b[2], c[2]);
      assert.ok(low > -0.01, `below the floor: ${low.toFixed(2)} mm`);
      // (Booleans leave the odd sliver of no area; the slicer ignores them.)
      if (n[2] < 0 && Math.hypot(...n) / 2 > 0.01 && Math.max(a[2], b[2], c[2]) < 1)
        assert.ok(
          low < 0.01,
          `a face looking down ${low.toFixed(2)} mm above the floor at ${a
            .slice(0, 2)
            .map((x) => x.toFixed(0))
            .join(', ')}`,
        );
    }
    // No faults: every leg clears every switch and keycap, nothing cut.
    assert.deepEqual(frame.faults, []);
  }
});
