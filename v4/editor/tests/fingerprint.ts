// Prints a fingerprint of the chassis for several configs: volume, triangle count
// and a hash of the mesh. A refactor that should not change the geometry must
// leave every line unchanged. Usage: npm run fingerprint > before.txt, change the
// code, npm run fingerprint > after.txt, diff the two.
import Module from 'manifold-3d';
import { createHash } from 'node:crypto';
import { componentFrames, defaults, clone, type Config } from '../src/geometry';
import { buildChassis } from '../src/chassis';
import { buildSolid, freeAfter } from '../src/solid';

type Layout = { roll_deg?: number };
const variants: Record<string, (c: Config) => void> = {
  default: () => {},
  margin: (c) => {
    c.chassis.plate_margin_mm = 1.6;
    c.chassis.wall_mm = 3;
  },
  thumbs: (c) => {
    // Both thumb clusters moved and turned together, so they stay clear of each other.
    for (const t of [
      c.geometry.thumb,
      (c.geometry as { thumb_extra: typeof c.geometry.thumb }).thumb_extra,
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

const wasm = await Module();
wasm.setup();
for (const [name, change] of Object.entries(variants)) {
  const cfg = clone(defaults.config);
  change(cfg);
  freeAfter(wasm, () => {
    const chassis = buildChassis(wasm, cfg, componentFrames(cfg));
    const solid = buildSolid(wasm, { version: 2, config: cfg });
    console.log(
      name.padEnd(8),
      'body',
      describe(chassis.body),
      '| base',
      describe(chassis.base),
      '| solid',
      solid.report.volume.toFixed(4),
      hash(solid.mesh.positions),
      solid.report.passed,
    );
  });
}
