// PROTOTYPE ?hand: the test frame's STL writer and the keycap-collision check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clone, defaults, type MeshData } from '../src/geometry';
import { frameStl } from '../src/hand/frame';
import { capHits } from '../src/hand/check';
import { _test as hand } from '../src/hand';

/** A unit-ish box (x 1..3, y 0..2, z 5..6) with outward, anticlockwise faces. */
const box: MeshData = (() => {
  const [x0, x1, y0, y1, z0, z1] = [1, 3, 0, 2, 5, 6],
    positions = new Float32Array(
      [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [z0, z1].flatMap((z) => [x, y, z]))),
    ),
    v = (x: number, y: number, z: number) => x * 4 + y * 2 + z,
    quad = (a: number, b: number, c: number, d: number) => [a, b, c, a, c, d],
    indices = new Uint32Array([
      ...quad(v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)),
      ...quad(v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)),
      ...quad(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)),
      ...quad(v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)),
      ...quad(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)),
      ...quad(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)),
    ]);
  return { positions, indices };
})();

/** Each triangle's stored normal, its vertices and the normal its winding gives. */
function triangles(dv: DataView) {
  const n = dv.getUint32(80, true);
  return Array.from({ length: n }, (_, t) => {
    const f = (k: number) => dv.getFloat32(84 + t * 50 + k * 4, true),
      normal = [f(0), f(1), f(2)],
      p = [0, 1, 2].map((i) => [f(3 + i * 3), f(4 + i * 3), f(5 + i * 3)]),
      u = [0, 1, 2].map((k) => p[1][k] - p[0][k]),
      w = [0, 1, 2].map((k) => p[2][k] - p[0][k]),
      wound = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    return { normal, p, wound };
  });
}

for (const mirror of [false, true])
  test(`frameStl ${mirror ? 'mirrored' : 'as is'}: floor at z = 0, outward winding, stored normals match`, () => {
    const dv = frameStl(box, 5, mirror),
      tris = triangles(dv),
      centre = [mirror ? -2 : 2, 1, 0.5];
    assert.equal(dv.byteLength, 84 + 12 * 50);
    assert.equal(tris.length, 12);
    const xs = tris.flatMap((t) => t.p.map((p) => p[0]));
    assert.deepEqual([Math.min(...xs), Math.max(...xs)], mirror ? [-3, -1] : [1, 3]);
    assert.equal(Math.min(...tris.flatMap((t) => t.p.map((p) => p[2]))), 0);
    for (const { normal, p, wound } of tris) {
      const l = Math.hypot(...wound),
        out = [0, 1, 2].map((k) => p[0][k] - centre[k]);
      assert.ok(
        wound.every((x, k) => Math.abs(x / l - normal[k]) < 1e-6),
        'normal follows winding',
      );
      assert.ok(wound.reduce((s, x, k) => s + x * out[k], 0) > 0, 'faces outward');
    }
  });

test('keycaps that overlap are reported, with how far; ones apart are not', () => {
  const c = clone(defaults).config,
    anchor = hand.anchorOf(c);
  hand.applyHand(c, hand.SWUNG_IN, anchor);
  const caps = hand.check(c, hand.SWUNG_IN, undefined).caps,
    cap = caps[0],
    twin = { ...cap, name: 'twin' },
    far = { ...cap, name: 'far', top: cap.top.clone().setPosition(1000, 1000, 1000) };
  assert.deepEqual(capHits(c, caps), []);
  const hits = capHits(c, [cap, twin]);
  assert.equal(hits.length, 1);
  assert.deepEqual([hits[0].a, hits[0].b], [cap.name, 'twin']);
  assert.ok(hits[0].depth > 1);
  assert.deepEqual(capHits(c, [cap, far]), []);
});
