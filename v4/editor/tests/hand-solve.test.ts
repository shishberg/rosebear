import test from 'node:test';
import assert from 'node:assert/strict';
import { bisect, bracketThenBisect, halve } from '../src/hand-solve';

test('halve keeps the side the root is on', () => {
  const [lo, hi] = halve((x) => x < 3, 0, 10, 40);
  assert.ok(Math.abs(lo - 3) < 1e-9 && Math.abs(hi - 3) < 1e-9);
});
test('bisect finds the target, or the end it is past', () => {
  const f = (x: number) => x * x;
  assert.ok(Math.abs(bisect(f, 4, 0, 10, 40).x - 2) < 1e-9);
  assert.deepEqual(bisect(f, 400, 0, 10, 40), { x: 10, clamped: true });
  assert.deepEqual(bisect(f, -1, 0, 10, 40), { x: 0, clamped: true });
});
test('bracketThenBisect steps out either way, then bisects the last step', () => {
  assert.ok(Math.abs(bracketThenBisect((x) => x < 7.3, 2, 90, 30) - 7.3) < 1e-6);
  assert.ok(Math.abs(bracketThenBisect((x) => x > -7.3, -2, 90, 30) + 7.3) < 1e-6);
  assert.ok(Math.abs(bracketThenBisect(() => true, 2, 90, 30) - 90) < 1e-6);
});
test('edge cases', () => {
  assert.deepEqual(
    bisect((x) => x, 0, 0, 10, 40),
    { x: 0, clamped: true },
  );
  assert.equal(
    bracketThenBisect(() => false, 2, 90, 30),
    0,
  );
  assert.deepEqual(
    halve(() => false, 1, 5, 10),
    [1, 1 + (5 - 1) / 2 ** 10],
  );
});
