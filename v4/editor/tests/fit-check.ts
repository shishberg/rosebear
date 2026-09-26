/** Mechanical acceptance is separate from tests of the checker itself. */
import {readFileSync} from 'node:fs';
import Module from 'manifold-3d';
import {defaults,clone,validateProject} from '../src/geometry';
import {buildSolid} from '../src/solid';
const project=process.argv[2]?JSON.parse(readFileSync(process.argv[2],'utf8')):clone(defaults);validateProject(project);
const wasm=await Module();wasm.setup();const {report}=buildSolid(wasm,project);
console.log(report.passed?'CLEARANCE PASS':'CLEARANCE FAIL');
for(const s of report.seats)if(!s.passed)console.log(`${s.name}: switch seat or clip relief fails`);
for(const k of report.keycaps)if(!k.passed)console.log(`${k.name}: at rest ${k.atRest.toFixed(3)} mm³; travel + ${k.margin} mm clearance ${k.swept.toFixed(3)} mm³`);
for(const o of report.openings)if(o.covered<9||o.blocked||o.removed<=.001)console.log(`${o.name}: opening incomplete`);
for(const h of report.hardware)if(h.group!=='keycaps')console.log(`${h.name}: ${h.volume.toFixed(3)} mm³ hardware overlap`);
process.exitCode=report.passed?0:1;
