/** Mechanical acceptance is separate from tests of the checker itself. */
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import { defaults, clone, validateProject } from '../src/geometry';
import { buildSolid } from '../src/solid';
const project = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
  : clone(defaults);
validateProject(project);
const wasm = await Module();
wasm.setup();
const { report } = buildSolid(wasm, project);
console.log(report.passed ? 'CLEARANCE PASS' : 'CLEARANCE FAIL');
for (const s of report.seats)
  if (!s.passed) console.log(`${s.name}: switch seat or clip relief fails`);
for (const k of report.keycaps)
  if (!k.passed)
    console.log(
      `${k.name}: at rest ${k.atRest.toFixed(3)} mm³; travel + ${k.margin} mm clearance ${k.swept.toFixed(3)} mm³`,
    );
if (report.pieces.length > 1)
  console.log(`${report.pieces.length} pieces without the bottom plate`);
if (report.footprint.length > 1) console.log(`${report.footprint.length} separate footprints`);
if (report.pocketCut > 0.01)
  console.log(`parts reach ${report.pocketCut.toFixed(2)} mm³ into the tile pockets`);
for (const c of report.roomCuts)
  console.log(`${c.name}: keycap room cut ${c.volume.toFixed(2)} mm³ out of the chassis`);
for (const o of report.openings)
  if (o.covered < 9 || o.blocked || o.removed <= 0.001)
    console.log(`${o.name}: opening incomplete`);
for (const w of report.walls)
  if (!w.passed)
    console.log(
      `${w.name}: ${w.gaps.length} gaps through the wall (${w.gaps.map((a) => a.toFixed(2)).join(', ')} mm²), ${w.blindCutouts} blind cutouts`,
    );
for (const x of report.hardware)
  if (x.group !== 'keycaps') console.log(`${x.name}: ${x.volume.toFixed(3)} mm³ hardware overlap`);
for (const w of report.wires)
  console.log(`${w.name}: wire runs ${w.volume.toFixed(3)} mm³ into the chassis`);
for (const c of report.crossings) console.log(`${c} run into each other`);
for (const p of report.solder)
  console.log(`${p.name}: soldering iron's way blocked, ${p.volume.toFixed(3)} mm³`);
const h = report.housing;
if (h.pieces !== 1) console.log(`trackpad housing is ${h.pieces} pieces`);
if (h.fit > 0.05) console.log(`trackpad housing overlaps the chassis by ${h.fit.toFixed(3)} mm³`);
if (h.slide > 0.05)
  console.log(`trackpad housing hits the chassis by ${h.slide.toFixed(3)} mm³ as it slides off`);
const wr = report.wiring;
console.log(`wiring: ${wr.wires} wires, ${wr.joints} joints, ${(wr.length / 1000).toFixed(2)} m`);
process.exitCode = report.passed ? 0 : 1;
