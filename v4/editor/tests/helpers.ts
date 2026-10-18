import type Module from 'manifold-3d';
import type { Config, MeshData, Project } from '../src/geometry';
import preSwungConfig from './pre-swung-config.json';

type Wasm = Awaited<ReturnType<typeof Module>>;

/** A Manifold from a MeshData. */
export const solidOf = (wasm: Wasm, m: MeshData) =>
  new wasm.Manifold(
    new wasm.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices }),
  );

/** The layout before Swung in became the default: src/default-config.json as
 * it was then (pre-swung-config.json). For tests about something other than
 * the layout (the C64 chassis, the wire router, negative checks) that need a
 * layout that passes, and for tests about that layout itself (the Python
 * reference poses, the thumb arc and well). A fresh copy each call. */
export const preSwung = (): Project => ({
  version: 2,
  config: structuredClone(preSwungConfig) as unknown as Config,
});
