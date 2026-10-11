import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildSolidAsync } from './solid';
import { wiring, type Wiring } from './wiring';
import type { Config, Project } from './geometry';
const engine = Module({ locateFile: () => wasmUrl }).then((m) => {
  m.setup();
  return m;
});
// The wires are routed in a worker of their own, alongside the build (here,
// if this browser can't start one from a worker).
const router =
  typeof Worker === 'undefined'
    ? undefined
    : new Worker(new URL('./wiring-worker.ts', import.meta.url), { type: 'module' });
const routing = new Map<number, { resolve: (w: Wiring) => void; reject: (e: Error) => void }>();
let routes = 0;
if (router)
  router.onmessage = (e: MessageEvent<{ id: number; wiring?: Wiring; error?: string }>) => {
    const r = routing.get(e.data.id);
    routing.delete(e.data.id);
    if (e.data.error !== undefined) r?.reject(Error(e.data.error));
    else r?.resolve(e.data.wiring!);
  };
const route = (cfg: Config): Promise<Wiring> => {
  if (!router) return Promise.resolve(wiring(cfg));
  const id = ++routes;
  return new Promise((resolve, reject) => {
    routing.set(id, { resolve, reject });
    router.postMessage({ id, cfg });
  });
};
self.onmessage = async (e: MessageEvent<{ id: number; project: Project }>) => {
  const { id, project } = e.data;
  try {
    const result = await buildSolidAsync(await engine, project, route);
    self.postMessage(
      { id, ...result },
      {
        transfer: [
          result.mesh,
          result.base,
          result.trim,
          ...result.highlights.map((h) => h.mesh),
        ].flatMap((m) => [m.positions.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer]),
      },
    );
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
