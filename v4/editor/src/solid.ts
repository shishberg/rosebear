import type { Manifold, ManifoldToplevel, Mat4 } from 'manifold-3d';
import {Matrix4} from 'three';
import {seatSettings} from './seats';
import {buildChassis,capSize,isKey,trackpadPart} from './chassis';
import {componentFrames,validateProject,type V3,type MeshData,type Project} from './geometry';
export {capSize,isKey};
export interface Part {name:string;group:string;size:V3;center:V3;matrix:number[];cylinder?:number}
export function hardware(project:Project,nodes=componentFrames(project.config)):Part[]{
 const cfg=project.config,parts:Part[]=[],t=cfg.tile,s=cfg.switch,z=-t.plate_top_to_pcb_top_mm;
 const add=(name:string,group:string,size:number[],center:number[],m:Matrix4,cylinder?:number)=>parts.push({name,group,size:size as V3,center:center as V3,matrix:m.elements.slice(),cylinder});
 for(const [name,m] of Object.entries(nodes))if(isKey(name)){
  add(name,'pcb',t.size_mm,[0,0,z-t.size_mm[2]/2],m);
  for(const c of t.components)add(name+': '+c.name,'components',c.size_mm,[c.center_mm[0],c.center_mm[1],c.center_mm[2]+z],m);
  add(name,'switch',s.body_mm,[0,0,s.body_mm[2]/2-s.body_below_plate_mm],m);
  const cap=capSize(cfg,name);add(name,'keycaps',cap,[0,0,s.keycap_bottom_above_plate_mm+cap[2]/2],m);
 }
 const tp=cfg.trackpad;add('Trackpad','trackpad',[tp.diameter_mm,tp.diameter_mm,tp.thickness_mm],[0,0,-tp.top_below_rim_mm-tp.thickness_mm/2+.01],nodes.trackpad,tp.diameter_mm/2);
 const a=cfg.adapter;add('FFC PCB','adapter',a.board_mm,[0,0,-a.board_mm[2]/2],nodes.adapter);add('FFC connector','adapter',[a.board_mm[0]-4,a.board_mm[1]/2,a.component_height_mm],[0,0,a.component_height_mm/2],nodes.adapter);
 return parts;
}
export interface Clearance {name:string;size:V3;margin:number;travel:number;atRest:number;swept:number;passed:boolean}
export interface SeatCheck {name:string;missing:number;excess:number;clipBlocked:number;passed:boolean}
export interface Report {seats:SeatCheck[];passed:boolean;keycaps:Clearance[];capGaps:{between:string;gap:number}[];pieces:number[];hardware:{name:string;group:string;volume:number}[];openings:{name:string;removed:number;covered:number;blocked:number}[];volume:number;triangles:number;milliseconds:number;notes:string[]}
export interface Highlight {name:string;kind:'rest'|'travel'|'hardware'|'opening'|'seat'|'loose';mesh:MeshData}
export interface BuildResult {mesh:MeshData;base:MeshData;trackpad:MeshData;report:Report;highlights:Highlight[]}
function meshData(solid:Manifold):MeshData {
 const raw=solid.getMesh(),positions=new Float32Array(raw.vertProperties.length/raw.numProp*3);
 for(let i=0;i<positions.length/3;i++)for(let j=0;j<3;j++)positions[i*3+j]=raw.vertProperties[i*raw.numProp+j];
 return {positions,indices:new Uint32Array(raw.triVerts)};
}
export function buildSolid(wasm:ManifoldToplevel,project:Project):BuildResult{
 validateProject(project);const start=performance.now(),cfg=project.config,nodes=componentFrames(cfg),all=new Set<Manifold>(),keep=(m:Manifold)=>{all.add(m);return m},M=wasm.Manifold;
 const highlights:Highlight[]=[];
 const collision=(body:Manifold,envelope:Manifold,name:string,kind:Highlight['kind'])=>{const hit=body.intersect(envelope);try{const v=Math.max(0,hit.volume());if(v>.05)highlights.push({name,kind,mesh:meshData(hit)});return v}finally{hit.delete()}};
 const box=(size:number[],center:number[]=[0,0,0])=>keep(keep(M.cube(size as V3,true)).translate(center as V3));
 const place=(m:Manifold,pose:Matrix4)=>keep(m.transform(pose.elements as Mat4));
 const volume=(a:Manifold,b:Manifold)=>{const hit=a.intersect(b);try{return Math.max(0,hit.volume())}finally{hit.delete()}};
 try{
  const chassis=buildChassis(wasm,cfg,nodes);keep(chassis.body);keep(chassis.base);keep(chassis.pod);let body=chassis.body;
  if(body.status()!=='NoError')throw Error('Invalid chassis: '+body.status());
  const {outer,thickness}=seatSettings(cfg),seatPlates:Manifold[]=[],seatTrims:Manifold[]=[],clipCuts:Manifold[]=[];
  for(const [name,m] of Object.entries(nodes))if(isKey(name)){
   seatPlates.push(place(box([...outer,thickness],[0,0,-thickness/2]),m));
   seatTrims.push(place(box([...outer,7],[0,0,3.5]),m),place(box([...outer,7-thickness],[0,0,(-7-thickness)/2]),m));
   const s=cfg.switch,y=s.cutout_mm[1]+s.cutout_clearance_mm;
   for(const sign of [-1,1])clipCuts.push(place(box([s.clip_width_mm,s.clip_relief_depth_mm+.2,3],[0,sign*(y/2+s.clip_relief_depth_mm/2-.05),-thickness-1.5]),m));
  }
  // Crisp flat seats: trim the plate above and below each mounting footprint,
  // then fill it so the switch lip is continuously supported.
  body=keep(keep(body.subtract(keep(M.union(seatTrims)))).add(keep(M.union(seatPlates))));
  const cuts:Manifold[]=[...clipCuts],openings:Report['openings']=[];
  const record=(name:string,cutter:Manifold,size:number[],pose:Matrix4,low:number,high:number)=>{
   let covered=0,blocked=0;
   for(const x of [-size[0]/2+.25,0,size[0]/2-.25])for(const y of [-size[1]/2+.25,0,size[1]/2-.25]){
    const probe=place(box([.3,.3,24],[x,y,0]),pose),hit=keep(body.intersect(probe));
    if(hit.volume()>.001){covered++;const punch=place(box([.4,.4,high-low],[x,y,(high+low)/2]),pose),rest=keep(hit.subtract(punch));if(rest.volume()>.001)blocked++}
   }
   const removed=volume(body,cutter);if(covered<9||blocked||removed<=.001)highlights.push({name,kind:'opening',mesh:meshData(cutter)});openings.push({name,removed,covered,blocked});cuts.push(cutter);
  };
  for(const [name,m] of Object.entries(nodes))if(isKey(name)){
   const size=cfg.switch.cutout_mm.map(x=>x+cfg.switch.cutout_clearance_mm),low=-cfg.switch.body_below_plate_mm-.5,high=12;
   record(name,place(box([...size,high-low],[0,0,(high+low)/2]),m),size,m,low,high);
  }
  const cut=keep(body.subtract(keep(M.union(cuts))));if(cut.status()!=='NoError'||cut.volume()<=0)throw Error('Cutouts produced an invalid solid: '+cut.status());
  // The base plate is a separate print, so every piece above it must hold together.
  const pieces=cut.decompose().map(keep).filter(p=>p.volume()>50).sort((a,b)=>b.volume()-a.volume());
  pieces.slice(1).forEach((p,i)=>highlights.push({name:`loose piece ${i+1}`,kind:'loose',mesh:meshData(p)}));
  const result=keep(cut.add(chassis.base));
  const seats:SeatCheck[]=[];
  for(const [name,m] of Object.entries(nodes))if(isKey(name)){
   const size=cfg.switch.cutout_mm.map(x=>x+cfg.switch.cutout_clearance_mm);
   const ring=keep(place(box([...outer,thickness],[0,0,-thickness/2]),m).subtract(place(box([...size,10]),m)));
   const missingSolid=keep(ring.subtract(result)),missing=Math.max(0,missingSolid.volume());
   const outside=keep(place(box([outer[0]-.02,outer[1]-.02,thickness+1],[0,0,-thickness/2]),m).subtract(place(box([...outer,thickness+.02],[0,0,-thickness/2]),m)));
   const excess=collision(result,outside,name,'seat');
   let clipBlocked=0;const y=size[1],s=cfg.switch;
   for(const sign of [-1,1])clipBlocked+=collision(result,place(box([s.clip_width_mm,s.clip_relief_depth_mm+.18,2.99],[0,sign*(y/2+s.clip_relief_depth_mm/2-.05),-thickness-1.505]),m),name,'seat');
   if(missing>.05)highlights.push({name,kind:'seat',mesh:meshData(missingSolid)});
   seats.push({name,missing,excess,clipBlocked,passed:missing<=.05&&excess<=.05&&clipBlocked<=.05});
  }
  const overlaps:Report['hardware']=[];
  for(const p of hardware(project,nodes))if(['pcb','components','trackpad','adapter'].includes(p.group)){
   const shape=p.cylinder?keep(keep(M.cylinder(p.size[2],p.cylinder,p.cylinder,64,true)).translate(p.center)):box(p.size,p.center);
   const v=collision(result,place(shape,new Matrix4().fromArray(p.matrix)),p.name,'hardware');if(v>.05)overlaps.push({name:p.name,group:p.group,volume:v});
  }
  const keycaps:Clearance[]=[],rests:Record<string,Manifold>={};
  for(const [name,m] of Object.entries(nodes))if(isKey(name)){
   const size=capSize(cfg,name),s=cfg.switch,margin=(s.keycap_clearance_overrides_mm as Record<string,number>)[name]??s.keycap_clearance_mm,low=s.keycap_bottom_above_plate_mm-s.travel_mm;
   const rest=rests[name]=place(box(size,[0,0,s.keycap_bottom_above_plate_mm+size[2]/2]),m);
   const sweep=place(box([size[0]+2*margin,size[1]+2*margin,size[2]+s.travel_mm],[0,0,low+(size[2]+s.travel_mm)/2]),m);
   const atRest=collision(result,rest,name,'rest'),swept=collision(result,sweep,name,'travel');keycaps.push({name,size,margin,travel:s.travel_mm,atRest,swept,passed:atRest<=.05&&swept<=.05});
  }
  // Closest distance between the resting keycaps of the finger columns, the thumb row and the extra thumb row.
  const g=cfg.geometry,extra=((g as {thumb_extra?:{keys:{name:string}[]}}).thumb_extra?.keys??[]).map(k=>'thumb_'+k.name);
  const groups:[string,string[]][]=[['fingers',Object.keys(rests).filter(n=>n.startsWith('matrix_'))],['thumbs',g.thumb.keys.map(k=>'thumb_'+k.name)],['extra thumbs',extra]];
  const unions=groups.filter(([,ns])=>ns.length).map(([label,ns])=>[label,keep(M.union(ns.map(n=>rests[n])))] as const),capGaps:Report['capGaps']=[];
  for(let i=0;i<unions.length;i++)for(let j=i+1;j<unions.length;j++){const gap=unions[i][1].minGap(unions[j][1],40);if(gap<40)capGaps.push({between:`${unions[i][0]} – ${unions[j][0]}`,gap})}
  // The chassis and its bottom plate are separate prints, sent separately.
  const mesh=meshData(cut);
  const passed=seats.every(s=>s.passed)&&keycaps.every(k=>k.passed)&&overlaps.length===0&&pieces.length===1&&capGaps.every(c=>c.gap>0)&&openings.every(o=>o.removed>.001&&o.covered===9&&o.blocked===0);
  return {mesh,base:meshData(chassis.base),trackpad:meshData(keep(trackpadPart(wasm,cfg,nodes))),highlights,report:{seats,passed,keycaps,capGaps,pieces:pieces.map(p=>p.volume()),hardware:overlaps,openings,volume:result.volume(),triangles:mesh.indices.length/3,milliseconds:performance.now()-start,notes:['Component/keycap envelopes are conservative boxes.','Flat seats and clip reliefs are generated. PCB retainers remain unimplemented. Minimum thickness and global self-intersections are not certified.']}};
 }finally{for(const m of [...all].reverse())m.delete()}
}
