// The geometry worker: build requests, the 30 s watchdog, worker restarts, and
// what a finished build feeds into the view.
import type { BuildResult } from './solid';
import type { Project } from './geometry';
import { prototypeOverrides } from './prototype-overrides';
import { $, S } from './state';
import { shell, trim } from './viewer';
import { setShell, updateWiring, visibility } from './scene-parts';
import { setBadge, updateFailures, showReport } from './report-view';

let busy = false,
  pending = false,
  timeout: ReturnType<typeof setTimeout> | undefined;
let inFlight: { id: number; project: Project } | undefined;
let worker: Worker,
  workerBuilds = 0;
// A safety net: a fresh worker takes over every 8 builds, in case a build leaves
// geometry-engine memory behind that its own cleanup missed.
export function startWorker() {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  workerBuilds = 0;
  worker.onmessage = (e: MessageEvent<BuildResult & { id: number; error?: string }>) => {
    clearTimeout(timeout);
    busy = false;
    if (++workerBuilds >= 8) restartWorker();
    if (e.data.id === S.revision) {
      if (e.data.error) {
        setBadge('fail', 'Invalid geometry');
        $('view-state').textContent = e.data.error + ' — edit or undo to recover';
        $('fit-list').replaceChildren();
      } else {
        setShell(e.data);
        updateWiring(e.data.wiring);
        updateFailures(e.data.highlights);
        S.report = e.data.report;
        if (inFlight?.id === e.data.id) S.evaluated = inFlight.project;
        S.solidRevision = S.revision;
        showReport(S.report);
        $<HTMLButtonElement>('stl').disabled = false;
        $<HTMLButtonElement>('stl-base').disabled = false;
        $<HTMLButtonElement>('report').disabled = false;
        $('view-state').textContent =
          `Chassis rebuilt in ${(S.report.milliseconds / 1000).toFixed(2)} s`;
      }
    }
    if (pending) {
      pending = false;
      requestBuild();
    }
  };
  worker.onerror = (e) => {
    clearTimeout(timeout);
    busy = false;
    pending = false;
    setBadge('fail', 'Geometry worker failed');
    $('view-state').textContent = e.message;
    restartWorker();
  };
}
function restartWorker() {
  worker.terminate();
  startWorker();
}
export function requestBuild() {
  clearTimeout(S.timer);
  for (const o of [shell, trim]) o.visible = !S.handCase || S.handCase();
  visibility();
  if (S.handCase && !S.handCase()) {
    $('view-state').textContent = 'Case not built (prototype: tick Build the case)';
    return;
  }
  if (S.drag || busy) {
    pending = true;
    return;
  }
  pending = false;
  busy = true;
  const id = S.revision;
  setBadge('', 'Building chassis & checking fit…');
  const sent = prototypeOverrides(S.project, location.search);
  inFlight = { id, project: sent };
  worker.postMessage({ id, project: sent });
  timeout = setTimeout(() => {
    busy = false;
    pending = false;
    restartWorker();
    setBadge('fail', 'Rebuild timed out');
    $('view-state').textContent =
      'Worker stopped after 30 seconds. Undo the last change or try Rebuild again.';
  }, 30000);
}

$('rebuild').onclick = requestBuild;
