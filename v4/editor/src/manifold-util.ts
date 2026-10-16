// Manifold idioms the shell, chassis, solid and hand frame share, and the
// scope that frees what a build makes.
import type { CrossSection, Manifold, ManifoldToplevel, Mat4, Vec3 } from 'manifold-3d';
import type { Matrix4 } from 'three';
import type { KeycapEnvelope, MeshData } from './geometry';

/** A plan shape's prism, run far above and below any part so cuts through it are clean. */
export const prism = (cs: CrossSection) => cs.extrude(400).translate([0, 0, -1]);

/** A slab round a box's plan, `margin` past it on every side, `height` tall from `z0`. */
export const slab = (
  M: ManifoldToplevel['Manifold'],
  bb: { min: number[]; max: number[] },
  margin: number,
  z0: number,
  height: number,
) =>
  M.cube([
    bb.max[0] - bb.min[0] + 2 * margin,
    bb.max[1] - bb.min[1] + 2 * margin,
    height,
  ]).translate([bb.min[0] - margin, bb.min[1] - margin, z0]);

/** `m` moved by a frame. */
export const place = (m: Manifold, f: Matrix4) => m.transform(f.elements as Mat4);

/** A wire's segment: the hull of a sphere at each end. */
export const capsule = (
  M: ManifoldToplevel['Manifold'],
  a: number[],
  b: number[],
  r: number,
  sides: number,
) => M.hull([a, b].map((c) => M.sphere(r, sides).translate(c as Vec3)));

/** A mesh's positions and triangles, without its other properties. */
export function meshData(solid: Manifold): MeshData {
  const raw = solid.getMesh();
  const positions = new Float32Array((raw.vertProperties.length / raw.numProp) * 3);
  for (let i = 0; i < positions.length / 3; i++)
    for (let j = 0; j < 3; j++) positions[i * 3 + j] = raw.vertProperties[i * raw.numProp + j];
  return { positions, indices: new Uint32Array(raw.triVerts) };
}

/** A keycap's envelope as a solid in key coordinates: the taper from its rest
 * height, and under it the base's footprint down to the floor. `box: false`
 * leaves the taper alone. */
export function keycapSolid(M: ManifoldToplevel['Manifold'], e: KeycapEnvelope, box = true) {
  const [x, y] = [e.base[0] / 2, e.base[1] / 2],
    taper = M.extrude(
      [
        [
          [-x, -y],
          [x, -y],
          [x, y],
          [-x, y],
        ],
      ],
      e.height,
      0,
      0,
      [e.top[0] / e.base[0], e.top[1] / e.base[1]],
    ).translate([0, 0, e.z0]);
  return box
    ? taper.add(
        M.cube([2 * x, 2 * y, e.z0 - e.floor], true).translate([0, 0, (e.z0 + e.floor) / 2]),
      )
    : taper;
}

// Every Manifold and CrossSection made during a scope, so it can free them all
// at the end. Unfreed, a build leaks most of a gigabyte of WebAssembly memory
// and the fourth one aborts.
type Handle = { delete(): void; isDeleted(): boolean };
let made: Set<Handle> | undefined;
const watched = new WeakSet<object>();
function watch(wasm: ManifoldToplevel) {
  if (watched.has(wasm)) return;
  watched.add(wasm);
  // wasm.Manifold wraps the real constructor, so its prototype isn't the one
  // the objects have; take that from an object of each kind.
  const samples = [wasm.Manifold.cube([1, 1, 1]), wasm.CrossSection.square([1, 1])];
  const protos = samples.map((x) => Object.getPrototypeOf(x) as Record<string, unknown>);
  for (const x of samples) x.delete();
  const ours = (x: unknown): boolean =>
    typeof x === 'object' && x !== null && protos.includes(Object.getPrototypeOf(x));
  const record = (x: unknown) => {
    if (!made) return;
    if (ours(x)) made.add(x as Handle);
    else if (Array.isArray(x)) for (const y of x) if (ours(y)) made.add(y as Handle);
  };
  const wrap = (o: Record<string, unknown>) => {
    for (const name of Object.getOwnPropertyNames(o)) {
      const f = o[name];
      if (
        typeof f !== 'function' ||
        name === 'constructor' ||
        name === 'delete' ||
        name === 'isDeleted'
      )
        continue;
      o[name] = function (this: unknown, ...args: unknown[]) {
        const r = f.apply(this, args);
        record(r);
        return r;
      };
    }
  };
  for (const c of [wasm.Manifold, wasm.CrossSection] as unknown as Record<string, unknown>[])
    wrap(c);
  for (const p of protos) wrap(p);
  // `new Manifold(...)` and `new CrossSection(...)` bypass the wrapped methods.
  const w = wasm as unknown as Record<string, unknown>;
  for (const k of ['Manifold', 'CrossSection'])
    w[k] = new Proxy(w[k] as new (...a: unknown[]) => object, {
      construct(t, args, nt) {
        const x = Reflect.construct(t, args, nt);
        record(x);
        return x;
      },
    });
}
function release() {
  for (const m of made!) if (!m.isDeleted()) m.delete();
  made = undefined;
}

/**
 * Runs `f`, then frees every Manifold and CrossSection made while it ran,
 * whatever it returns: copy out what must outlast it (meshes, numbers). Inside
 * another scope it joins that one.
 */
export function freeAfter<T>(wasm: ManifoldToplevel, f: () => T): T {
  watch(wasm);
  if (made) return f();
  made = new Set();
  try {
    return f();
  } finally {
    release();
  }
}

/** `freeAfter` for an async `f`; only one scope may be open across an await. */
export async function freeAfterAsync<T>(wasm: ManifoldToplevel, f: () => Promise<T>): Promise<T> {
  watch(wasm);
  if (made) throw Error('A build is already running');
  made = new Set();
  try {
    return await f();
  } finally {
    release();
  }
}
