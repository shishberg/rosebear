import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildSolid } from './solid';
import type { Project } from './geometry';
const engine = Module({ locateFile: () => wasmUrl }).then((m) => {
  m.setup();
  return m;
});
self.onmessage = async (e: MessageEvent<{ id: number; project: Project }>) => {
  const { id, project } = e.data;
  try {
    const result = buildSolid(await engine, project);
    self.postMessage(
      { id, ...result },
      {
        transfer: [
          result.mesh,
          result.base,
          result.trackpad,
          ...result.highlights.map((h) => h.mesh),
        ].flatMap((m) => [m.positions.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer]),
      },
    );
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
