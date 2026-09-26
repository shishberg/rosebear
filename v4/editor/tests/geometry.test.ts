import {test} from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {Vector3} from 'three';
import {defaults,clone,expand,refine,componentFrames,validateProject} from '../src/geometry';
import {buildSolid} from '../src/solid';
import ref from './python-reference.json';
import {mountedFrames} from '../src/mounts';
import {moveComponent} from '../src/component-edit';
test('subdivision and component frames match the Python reference',()=>{
 const s=refine(expand(defaults.cage),2);assert.deepEqual(s.quads,ref.quads);assert.equal(s.positions.length,ref.positions.length);
 let max=0;s.positions.forEach((p,i)=>p.forEach((x,k)=>max=Math.max(max,Math.abs(x-ref.positions[i][k]))));assert(max<1e-9,`Surface deviation ${max}`);
 for(const [key,m] of Object.entries(componentFrames(defaults.config)))m.elements.forEach((x,i)=>assert(Math.abs(x-(ref.frames as Record<string,number[]>)[key][i])<1e-9,key));
});
test('boundary edits regenerate walls and invalid input is rejected',()=>{
 const p=clone(defaults),before=expand(p.cage);p.cage.positions_mm[0][0]-=2;const after=expand(p.cage);assert.notDeepEqual(before.positions.slice(38),after.positions.slice(38));
 p.cage.positions_mm[0][0]=NaN;assert.throws(()=>validateProject(p),/finite/);
});
test('flat seats support tilted switches, clips have clearance, and cap interference remains detectable',async()=>{
 const wasm=await Module();wasm.setup();const r=buildSolid(wasm,clone(defaults));
 console.log('WASM build',r.report.milliseconds.toFixed(0)+' ms','volume',r.report.volume);
 assert(r.report.volume>0);assert.equal(r.report.seats.length,18);assert(r.report.seats.every(s=>s.passed));
 const mounted=new wasm.Manifold(new wasm.Mesh({numProp:3,vertProperties:r.mesh.positions,triVerts:r.mesh.indices}));
 try{
  for(const [name,m] of Object.entries(mountedFrames(defaults)))if(name.startsWith('matrix_')||name.startsWith('thumb_')){
   const inverse=m.clone().invert();
   // Ray through four lip locations measures both physical faces, including
   // the rotated middle thumb. These are not bounding-box volume assertions.
   for(const [x,y] of [[7.7,0],[-7.7,0],[0,7.7],[0,-7.7]]){
    const a=new Vector3(x,y,1).applyMatrix4(m).toArray(),b=new Vector3(x,y,-3).applyMatrix4(m).toArray();
    const hits=mounted.rayCast(a,b);assert.equal(hits.length,2,name);
    const heights=hits.map(h=>new Vector3(...h.position).applyMatrix4(inverse).z).sort((a,b)=>b-a);
    assert(Math.abs(heights[0])<1e-4,name);assert(Math.abs(heights[1]+1.5)<1e-4,name);
   }
  }
 }finally{mounted.delete()}
 assert.equal(r.report.openings.length,20);assert(r.report.openings.every(o=>o.removed>0&&o.covered===9&&o.blocked===0));
 const middle=r.report.keycaps.find(k=>k.name==='thumb_home')!;
 assert.deepEqual(middle.size,[27.525,18,9]);assert.equal(middle.travel,4);assert.equal(middle.margin,2.5);
 assert(middle.atRest>.05);assert(middle.swept>middle.atRest);assert.equal(middle.passed,false);assert.equal(r.report.passed,false);
 for(const kind of ['rest','travel'] as const){
  const h=r.highlights.find(h=>h.name==='thumb_home'&&h.kind===kind)!;assert(h,'Missing collision geometry');
  const solid=new wasm.Manifold(new wasm.Mesh({numProp:3,vertProperties:h.mesh.positions,triVerts:h.mesh.indices}));
  try{assert.equal(solid.status(),'NoError');assert(Math.abs(solid.volume()-(kind==='rest'?middle.atRest:middle.swept))<.01)}finally{solid.delete()}
 }
 const corrected=r;
 assert.equal(defaults.config.switch.keycap_bottom_above_plate_mm-defaults.config.switch.travel_mm,2);
 assert(corrected.report.keycaps.find(k=>k.name==='thumb_home')!.passed===false);
 // The detector must also accept a genuinely clear placement, not always fail.
 const clear=clone(defaults);clear.config.switch.keycap_bottom_above_plate_mm=200;
 const r2=buildSolid(wasm,clear);assert(r2.report.keycaps.every(k=>k.passed));assert(!r2.highlights.some(h=>h.kind==='rest'||h.kind==='travel'));
});
test('layout comparisons carry hardware and the platform wall together',async()=>{
 const {arrangement}=await import('../src/variants');const original=clone(defaults),base=componentFrames(original.config);
 const wasm=await Module();wasm.setup();
 for(const id of ['tilt','shift','both'] as const){
  const p=arrangement(original,id),nodes=componentFrames(p.config),r=buildSolid(wasm,p).report;
  assert.equal(r.seats.length,18);assert(r.seats.every(s=>s.passed));assert(r.openings.every(o=>o.covered===9));
  if(id!=='tilt'){
   for(const name of ['trackball','adapter']){assert(Math.abs(nodes[name].elements[13]-base[name].elements[13]-10)<1e-8);assert(Math.abs(nodes[name].elements[12]-base[name].elements[12])<1e-8)}
   for(const name of ['top:ball_front','top:ball_back','top:well_inner_front','top:well_inner_low']){const i=p.cage.control_ids.indexOf(name);assert.equal(p.cage.positions_mm[i][1]-original.cage.positions_mm[i][1],10)}
  }
  if(id!=='shift'){
   const normal=new Vector3(0,0,1).transformDirection(nodes.thumb_home),expected=new Vector3(0,0,1).transformDirection(base.thumb_home).applyAxisAngle(new Vector3(1,0,0),Math.PI/12);assert(normal.distanceTo(expected)<1e-8);
  }
  if(id==='both')assert(r.keycaps.find(k=>k.name==='thumb_home')!.passed);
 }
 assert.deepEqual(original,defaults);
});
test('surface changes carry switch assemblies while preserving layout XY and heading',()=>{
 const p=clone(defaults),before=mountedFrames(p);
 p.cage.positions_mm=p.cage.positions_mm.map(([x,y,z])=>[x,y,z+5]);p.cage.wall_settings.base_z_mm+=5;p.cage.wall_settings.wall_lower_ring_z_mm+=5;
 const raised=mountedFrames(p);
 for(const name of Object.keys(before).filter(n=>n.startsWith('matrix_')||n.startsWith('thumb_'))){
  assert(Math.abs(raised[name].elements[14]-before[name].elements[14]-5)<1e-6,name);
  for(const i of [0,1,2,4,5,6,8,9,10,12,13])assert(Math.abs(raised[name].elements[i]-before[name].elements[i])<1e-6,name);
 }
 assert.deepEqual(raised.trackball.elements,before.trackball.elements);
 // Changing one roof control must affect tilt as well as height.
 const shaped=clone(defaults);shaped.cage.positions_mm[shaped.cage.control_ids.indexOf('top:well_middle_upper')][2]+=4;
 const mounted=mountedFrames(shaped).matrix_middle_home,old=before.matrix_middle_home;
 assert(Math.abs(mounted.elements[14]-old.elements[14])>.05);
 assert(new Vector3(...mounted.elements.slice(8,11)).distanceTo(new Vector3(...old.elements.slice(8,11)))>.005);
 const nominal=componentFrames(shaped.config).thumb_home,actual=mountedFrames(shaped).thumb_home;
 assert(Math.abs(Math.atan2(actual.elements[1],actual.elements[0])-Math.atan2(nominal.elements[1],nominal.elements[0]))<1e-8);
});
test('component moves preserve assemblies and projection rejects missing roof',()=>{
 const before=mountedFrames(defaults),moved=moveComponent(defaults,'thumb_home',[2,1,8]),after=mountedFrames(moved);
 assert.deepEqual(moved.cage,defaults.cage);assert(Math.abs(after.thumb_home.elements[12]-before.thumb_home.elements[12]-2)<1e-8);assert(Math.abs(after.thumb_home.elements[13]-before.thumb_home.elements[13]-1)<1e-8);
 const translated=moveComponent(defaults,'trackball_group',[1,2,3]),group=mountedFrames(translated);
 for(const name of ['trackball','adapter'])for(let i=0;i<3;i++)assert(Math.abs(group[name].elements[12+i]-before[name].elements[12+i]-[1,2,3][i])<1e-8);
 assert.deepEqual(group.matrix_middle_home.elements.slice(12,14),before.matrix_middle_home.elements.slice(12,14));
 const i=translated.cage.control_ids.indexOf('top:ball_front');assert.deepEqual(translated.cage.positions_mm[i],defaults.cage.positions_mm[i].map((x,j)=>x+[1,2,3][j]));
 assert.throws(()=>mountedFrames(moveComponent(defaults,'matrix_middle_home',[500,0,0])),/outside the roof/);
});
