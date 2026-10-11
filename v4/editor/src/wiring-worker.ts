// Routes the wires for the build worker, while it lofts the case's shell.
import { wiring } from './wiring';
import type { Config } from './geometry';
self.onmessage = (e: MessageEvent<{ id: number; cfg: Config }>) => {
  const { id, cfg } = e.data;
  try {
    self.postMessage({ id, wiring: wiring(cfg) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
