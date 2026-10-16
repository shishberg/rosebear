/** Mechanical acceptance is separate from tests of the checker itself. */
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import { defaults, clone, validateProject } from '../src/geometry';
import { buildSolid } from '../src/solid';
import { reportLines } from '../src/report-lines';
const project = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
  : clone(defaults);
validateProject(project);
const wasm = await Module();
wasm.setup();
const { report } = buildSolid(wasm, project);
console.log(report.passed ? 'CLEARANCE PASS' : 'CLEARANCE FAIL');
for (const l of reportLines(report)) console.log(l.text);
const wr = report.wiring;
console.log(`wiring: ${wr.wires} wires, ${wr.joints} joints, ${(wr.length / 1000).toFixed(2)} m`);
process.exitCode = report.passed ? 0 : 1;
