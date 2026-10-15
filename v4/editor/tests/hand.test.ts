// PROTOTYPE ?hand: the hand check (hand-prototype.ts) against the keyboard,
// the printed test frame (hand-frame.ts) included.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
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
