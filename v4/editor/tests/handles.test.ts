import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { clone, defaults } from '../src/geometry';
import { handles, dragTo, fields, getAt, setAt, clusters } from '../src/handles';

const cfg = defaults.config;
const top = new T.Vector3(0, 0, -1);

test('getAt and setAt follow a path into the config', () => {
  const o = { a: [{ b: 1 }, { b: 2 }] };
  assert.equal(getAt(o, ['a', 1, 'b']), 2);
  setAt(o, ['a', 0, 'b'], 7);
  assert.equal(o.a[0].b, 7);
  assert.equal(getAt(o, ['x', 'y']), undefined);
});

test('every handle has a field list that resolves to numbers', () => {
  const hs = handles(defaults);
  assert.ok(hs.some((h) => h.kind === 'key'));
  assert.equal(hs.filter((h) => h.kind === 'turn').length, clusters(cfg).length);
  for (const h of hs) {
    const { title, list } = fields(h.id, cfg);
    assert.ok(title, h.id);
    for (const [, path] of list) assert.ok(Number.isFinite(getAt(cfg, path)), h.id + path);
  }
  assert.deepEqual(fields('nothing', cfg), { title: '', list: [] });
});

test('dragging a key handle in the side view changes height and stagger, not the input', () => {
  const key = handles(defaults).find((h) => h.kind === 'key')!;
  const [, col] = key.id.slice(4).split('_');
  const before = clone(defaults);
  const next = dragTo(defaults, key.id, new T.Vector3(0, 2, 3), key.at, new T.Vector3(1, 0, 0));
  const c = next.config.geometry.columns.find((x) => x.name === col)!;
  const c0 = before.config.geometry.columns.find((x) => x.name === col)!;
  assert.deepEqual(defaults, before);
  assert.notDeepEqual(c.heights_mm, c0.heights_mm);
  assert.notEqual(c.offset_mm[1], c0.offset_mm[1]);
  assert.equal(c.offset_mm[0], c0.offset_mm[0]);
});

test('dragging a key handle along the view axis leaves the project unchanged', () => {
  const key = handles(defaults).find((h) => h.kind === 'key')!;
  const next = dragTo(defaults, key.id, new T.Vector3(0, 0, 5), key.at, top);
  assert.deepEqual(next, defaults);
});
