// Prints a fingerprint of the chassis for several configs (body, base, solid,
// trim, wiring, hardware placements, digests of every report check value and the
// failure lists) and of Swung in's ?hand settings (key frames, check problems, a digest
// of the check's numbers, test frame). A refactor that should
// not change the geometry must leave every line unchanged. Usage: npm run
// fingerprint > before.txt, change the code, npm run fingerprint > after.txt,
// diff the two.
import Module from 'manifold-3d';
import { createHash } from 'node:crypto';
import { componentFrames, defaults, clone, type Config } from '../src/geometry';
import { buildChassis } from '../src/chassis';
import { freeAfter } from '../src/manifold-util';
import { hardware } from '../src/parts';
import { buildSolid, type Report } from '../src/solid';
import { buildFrame } from '../src/hand/frame';
import { _test as hand } from '../src/hand';

type Layout = { roll_deg?: number };
const variants: Record<string, (c: Config) => void> = {
  default: () => {},
  // A margin that beats the tile pocket, so it binds.
  margin: (c) => {
    c.chassis.plate_margin_mm = 2.5;
  },
  splay: (c) => {
    (c.geometry.columns as { rotation_deg: number[] }[])[2].rotation_deg = [0, 0, 6];
  },
  override: (c) => {
    (c.geometry.key_overrides as Record<string, unknown>).matrix_ring_home = {
      offset_mm: [0.8, -1, 1],
      rotation_deg: [3, 0, 4],
    };
  },
  clearance: (c) => {
    Object.assign(c.switch.keycap_clearance_overrides_mm as Record<string, number>, {
      matrix_index_home: 0.9,
      matrix_pinky_top: 0.6,
      thumb_home: 1.8,
    });
  },
  thumbs: (c) => {
    // Both thumb clusters moved and turned together, so they stay clear of each other.
    for (const t of [
      c.geometry.thumb,
      (c.geometry as { thumb_extra: Pick<typeof c.geometry.thumb, 'position_mm' | 'rotation_deg'> })
        .thumb_extra,
    ]) {
      t.position_mm[0] += 4;
      t.rotation_deg[2] += 5;
    }
  },
  roll: (c) => {
    for (const col of c.geometry.columns as Layout[]) col.roll_deg = (col.roll_deg ?? 0) + 6;
  },
  noextra: (c) => {
    delete (c.geometry as { thumb_extra?: unknown }).thumb_extra;
  },
  tile: (c) => {
    c.tile.size_mm[0] = 18;
    c.tile.clearance_mm = 0.5;
    c.switch.seat_outer_mm = [16.2, 16.2];
  },
};
const hash = (positions: ArrayLike<number>, indices?: ArrayLike<number>) => {
  const h = createHash('sha1');
  h.update(Buffer.from(Float32Array.from(positions, (v) => Math.round(v * 1e4) / 1e4).buffer));
  if (indices) h.update(Buffer.from(Uint32Array.from(indices).buffer));
  return h.digest('hex').slice(0, 12);
};
const describe = (m: {
  volume(): number;
  getMesh(): { vertProperties: Float32Array; triVerts: Uint32Array; numTri: number };
}) => {
  const mesh = m.getMesh();
  return `${m.volume().toFixed(4)} ${mesh.numTri} ${hash(mesh.vertProperties, mesh.triVerts)}`;
};

const r2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
/** Short stable digest of any JSON-able value. */
const digest = (v: unknown) =>
  createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 10);
/** A value as JSON with every number rounded to `places` decimals, for digests. */
const rounded = (v: unknown, places: number) =>
  JSON.stringify(v, (_, x) =>
    typeof x === 'number' ? Math.round(x * 10 ** places) / 10 ** places : x,
  );
/** `n` and the list itself when short, else `n` and its hash. */
const listed = (items: string[]) =>
  items.length < 10 ? `${items.length}[${items.join(',')}]` : `${items.length}#${digest(items)}`;

const failures = (r: Report) =>
  [
    [
      'seats',
      r.seats
        .filter((x) => !x.passed)
        .map((x) => `${x.name}:${r2(x.missing)}/${r2(x.excess)}/${r2(x.clipBlocked)}`),
    ],
    [
      'open',
      r.openings
        .filter((x) => x.blocked > 0 || x.covered < 9 || x.removed <= 0.001)
        .map((x) => `${x.name}:${r2(x.removed)}/${r2(x.covered)}/${r2(x.blocked)}`),
    ],
    [
      'caps',
      r.keycaps.filter((x) => !x.passed).map((x) => `${x.name}:${r2(x.atRest)}/${r2(x.swept)}`),
    ],
    ['gaps', r.capGaps.map((x) => `${x.between}:${r2(x.gap)}`)],
    ['pieces', r.pieces.map(r2)],
    ['foot', r.footprint.map(r2)],
    ['room', r.roomCuts.map((x) => `${x.name}:${r2(x.volume)}`)],
    ['hw', r.hardware.map((x) => `${x.name}:${r2(x.volume)}`)],
    ['wire', r.wires.map((x) => `${x.name}:${r2(x.volume)}`)],
    ['cross', r.crossings],
  ]
    .map(([k, v]) => `${k} ${listed((v as string[]).slice().sort())}`)
    .concat(
      // Every measured entry, passing or not.
      [
        ['seatsAll', r.seats],
        ['openAll', r.openings],
        ['capsAll', r.keycaps],
      ].map(([k, v]) => `${k as string} ${(v as unknown[]).length}#${digest(rounded(v, 2))}`),
    )
    .join(' | ');

const wasm = await Module();
wasm.setup();
for (const [name, change] of Object.entries(variants)) {
  const cfg = clone(defaults.config);
  change(cfg);
  freeAfter(wasm, () => {
    // buildSolid doesn't return the chassis body, so it is built here for its volumes.
    const chassis = buildChassis(wasm, cfg, componentFrames(cfg));
    const project = { version: 2 as const, config: cfg };
    const solid = buildSolid(wasm, project);
    const w = solid.wiring.wires;
    console.log(
      name.padEnd(9),
      'body',
      describe(chassis.body),
      '| base',
      describe(chassis.base),
      '| solid',
      solid.report.volume.toFixed(4),
      hash(solid.mesh.positions),
      solid.report.passed,
    );
    console.log(
      ' '.repeat(9),
      'trim',
      describe(chassis.trim),
      '| wires',
      w.length,
      r2(w.reduce((a, x) => a + x.length, 0)),
      digest(
        rounded(
          w.map((x) => [x.net, x.from, x.to, x.points]),
          3,
        ),
      ),
      '| hardware',
      digest(rounded(hardware(project, undefined, solid.panel), 3)),
    );
    console.log(' '.repeat(9), failures(solid.report));
  });
}

// Swung in's ?hand settings and three variants that run other code paths
// (the extra keys, the 1.5u + 2×1u cluster, rows from the press mix), each
// laid out, checked with the printed test frame, and the frame built.
const S = hand.SWUNG_IN;
const handCases: [string, typeof S][] = [
  ['Swung in', S],
  ['extra', { ...structuredClone(S), extra: { ...S.extra!, on: true } }],
  ['1.5u', { ...structuredClone(S), cluster: '1.5u + 2×1u' }],
  ['press', { ...structuredClone(S), from: 'press' }],
];
for (const [name, s] of handCases)
  freeAfter(wasm, () => {
    const c = clone(defaults.config),
      anchor = hand.anchorOf(c);
    hand.applyHand(c, s, anchor);
    const frames = componentFrames(c),
      frame = buildFrame(wasm, c, !!s.extra?.on),
      toHand = hand.worldOf(c, anchor, s).invert(),
      r = hand.check(c, s, undefined, { mesh: frame.mesh, toHand }),
      problems = hand.problems(r),
      numbers = rounded(
        {
          row: r.h.row.map((k) => [k.miss, k.roll, k.away, k.press, k.q]),
          short: Object.values(r.h.poses).map((p) => p.map((x) => x.short)),
          rest: [r.short, r.pastJoints, r.backOfThumb, r.pressAway, r.innerShort],
          hits: [r.capHits, r.handHits],
          wristOff: r.wristOff,
          height: r.height,
        },
        3,
      ),
      keys = Object.entries(frames).map(([k, m]) => [
        k,
        ...m.elements.map((v) => Math.round(v * 1e4) / 1e4),
      ]);
    console.log(
      name.padEnd(9),
      'keys',
      keys.length,
      digest(keys),
      '| problems',
      listed(problems),
      '| check',
      digest(numbers),
      '| frame',
      frame.volume.toFixed(4),
      frame.mesh.indices.length / 3,
      hash(frame.mesh.positions, frame.mesh.indices),
      'pieces',
      frame.pieces,
    );
    console.log(
      ' '.repeat(9),
      'faults',
      listed(frame.faults),
      '| warnings',
      listed(frame.warnings),
      '| truss',
      frame.truss.length,
      '| leftOut',
      frame.websLeftOut.length,
    );
  });
