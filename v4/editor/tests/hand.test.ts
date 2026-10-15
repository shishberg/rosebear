// PROTOTYPE ?hand: the hand check (hand-prototype.ts) against the keyboard,
// the printed test frame (hand-frame.ts) included.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import { clone, defaults } from '../src/geometry';
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
const withThumb = (s: Settings, thumb: Partial<Settings['thumb']>): Settings => ({
  ...structuredClone(s),
  thumb: { ...s.thumb, ...thumb },
});

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
});
test('Dactyl fit, the thumb nudged across and down: pressing the near key, it touches the home key', () => {
  const r = layout(withThumb(hand.DACTYL, { sweep: -7, abduct: 10 }));
  assert.ok(r.r.handHits.some((x) => x.a === 'thumb' && x.b === 'thumb home'));
});
// Natural's printed frame: the index brushed the thumb cluster, which the
// model doesn't (yet) reproduce. Reported, not asserted.
test('Natural', (t) => report(t, layout(hand.NATURAL)));

const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
const reaching = (mix: number) => hand.wayOf({ ...structuredClone(hand.DACTYL), reachMix: mix });
// The reach mix slider's range near its low end, where the MCP curls as the PIP straightens.
const MIXES = [hand.MIX_MIN, -0.3, -0.2, -0.1, 0, 0.4, 1, 3];

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
/** How far settings `s` put the finger keys from the Dactyl's, relative to the
 * middle home key, before tenting: squared, per 2 mm and per 3° (0.05 in the
 * facing). Infinite where a row is out of reach. */
function offDactyl(s: Settings) {
  const h = hand.solveHand(s),
    caps = hand.capsOf(clone(defaults).config, h, false),
    R = hand.turnOf(s),
    at = (k: (typeof caps)[number]) => new T.Vector3().setFromMatrixPosition(k.top),
    o = at(caps.find((k) => k.name === 'matrix_middle_home')!),
    keys = caps
      .filter((k) => k.name.startsWith('matrix_'))
      .map((k) => {
        const name = k.name.slice(7),
          p = at(k).sub(o).applyMatrix4(R),
          n = new T.Vector3().setFromMatrixColumn(k.top, 2).transformDirection(R),
          [p0, n0] = DM[name].map((v) => new T.Vector3(...v));
        return {
          name,
          mm: p.distanceTo(p0),
          cost:
            p.sub(p0).divideScalar(2).lengthSq() + n.clone().sub(n0).divideScalar(0.05).lengthSq(),
          tilt: tilt(n),
          dm: tilt(n0),
        };
      }),
    short = Object.values(h.poses).some((P) => P.some((p) => p.short > 0.5));
  return { cost: short ? Infinity : keys.reduce((a, k) => a + k.cost, 0), keys };
}
const shaped = (curl: number, mix: number): Settings => ({
  ...structuredClone(hand.DACTYL),
  curl: { index: curl, middle: curl, ring: curl, pinky: curl },
  reachMix: mix,
});

/** Why settings `s` aren't valid (the keycaps and the hand; the frame too if `frame`). */
function wrongOf(s: Settings, frame = false) {
  if (frame) return hand.problems(layout(s).r);
  const c = clone(defaults).config;
  hand.applyHand(c, s, hand.anchorOf(c));
  return hand.problems(hand.check(c, s));
}

test("Dactyl fit: of the valid layouts, the finger curl and reach mix that put the finger keys closest to the Dactyl's", (t) => {
  const r2 = (v: number) => Math.round(v * 100) / 100,
    costs = new Map<string, number>(),
    cost = (c: number, m: number) => {
      const k = `${c} ${m}`;
      if (!costs.has(k)) costs.set(k, offDactyl(shaped(c, m)).cost);
      return costs.get(k)!;
    },
    oks = new Map<string, boolean>(),
    ok = (c: number, m: number) => {
      const k = `${c} ${m}`;
      if (!oks.has(k)) oks.set(k, !wrongOf(shaped(c, m)).length);
      return oks.get(k)!;
    },
    /** From `p`, to the closest point within a curl degree and 0.02 of reach
     * mix (valid, if asked), until none is closer. */
    descend = (p: { c: number; m: number }, valid: boolean) => {
      for (let moved = true; moved;) {
        moved = false;
        const near = [];
        for (let dc = -1; dc <= 1; dc++)
          for (let dm = -2; dm <= 2; dm++) near.push({ c: p.c + dc, m: r2(p.m + dm / 100) });
        for (const q of near
          .filter((q) => q.m >= hand.MIX_MIN && q.c >= -30 && q.c <= 40)
          .sort((x, y) => cost(x.c, x.m) - cost(y.c, y.m))) {
          if (cost(q.c, q.m) >= cost(p.c, p.m)) break;
          if (!valid || ok(q.c, q.m)) {
            p = q;
            moved = true;
            break;
          }
        }
      }
      return p;
    },
    // A grid over the sliders' ranges, closest first. The valid layouts are
    // scattered, so the search starts from the five closest valid ones.
    grid: { c: number; m: number }[] = [];
  for (let c = -30; c <= 40; c += 2)
    for (let m = -40; m <= 300; m += m < 60 ? 5 : 50) grid.push({ c, m: m / 100 });
  grid.sort((a, b) => cost(a.c, a.m) - cost(b.c, b.m));
  const starts = [];
  for (const p of grid) if (starts.length < 5 && ok(p.c, p.m)) starts.push(p);
  const closest = descend(grid[0], false),
    best = starts.map((p) => descend(p, true)).sort((x, y) => cost(x.c, x.m) - cost(y.c, y.m))[0],
    say = (p: { c: number; m: number }) =>
      `curl ${p.c}, reach mix ${p.m}, cost ${cost(p.c, p.m).toFixed(0)}`;
  t.diagnostic(`closest: ${say(closest)}; ${wrongOf(shaped(closest.c, closest.m)).join('; ')}`);
  t.diagnostic(`closest valid: ${say(best)}`);
  for (const k of offDactyl(shaped(best.c, best.m)).keys)
    t.diagnostic(
      `${k.name}: ${k.mm.toFixed(1)} mm off; faces you ${k.tilt.toFixed(1)}° (Dactyl ${k.dm.toFixed(1)}°)`,
    );
  // At each reach mix, the closest curl and the closest valid one, and how the
  // middle column's keys face: below 0 they turn far more from row to row
  // than the Dactyl's 15°; flatter, the bottom keys run into others.
  const faces = (p: { c: number; m: number }) => {
    const K = Object.fromEntries(offDactyl(shaped(p.c, p.m)).keys.map((k) => [k.name, k]));
    return `middle top / home / bottom face you ${['top', 'home', 'bottom'].map((r) => K[`middle_${r}`].tilt.toFixed(0)).join(' / ')}°`;
  };
  for (const m of [-0.3, -0.2, -0.1, 0, 0.2, best.m, 0.4]) {
    const curls = [];
    for (let c = -30; c <= 40; c++) curls.push({ c, m });
    curls.sort((x, y) => cost(x.c, x.m) - cost(y.c, y.m));
    const v = curls.find((p) => ok(p.c, p.m));
    t.diagnostic(
      `mix ${m}: closest ${say(curls[0])}, ${faces(curls[0])}, ${wrongOf(shaped(curls[0].c, m))[0] ?? 'valid'}; closest valid ${v ? `${say(v)}, ${faces(v)}` : 'none'}`,
    );
  }
  assert.deepEqual(wrongOf(shaped(best.c, best.m), true), []);
  assert.deepEqual([hand.DACTYL.curl.middle, hand.DACTYL.reachMix], [best.c, best.m]);
});
