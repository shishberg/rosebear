import type Module from 'manifold-3d';
import type { MeshData } from '../src/geometry';

type Wasm = Awaited<ReturnType<typeof Module>>;

/** A Manifold from a MeshData. */
export const solidOf = (wasm: Wasm, m: MeshData) =>
  new wasm.Manifold(
    new wasm.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices }),
  );
