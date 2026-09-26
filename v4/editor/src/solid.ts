import type { Manifold, ManifoldToplevel, Mat4 } from 'manifold-3d';
import {Matrix4} from 'three';
import {seatSettings} from './seats';
import {mountedFrames} from './mounts';
import {componentFrames,point,solidMesh,validateProject,type Config,type V3,type MeshData,type Project} from './geometry';
export interface Part {name:string;group:string;size:V3;center:V3;matrix:number[];sphere?:number}
export const isKey=(name:string)=>name.startsWith('thumb_')||name.startsWith('matrix_');
export const capSize=(c:Config,n:string)=>((c.switch.keycap_overrides_mm as Record<string,number[]>)[n]||c.switch.keycap_mm) as V3;
export function hardware(project:Project,nodes=mountedFrames(project)):Part[]{
 const cfg=project.config,parts:Part[]=[],t=cfg.tile,s=cfg.switch,z=-t.plate_top_to_pcb_top_mm;
 const add=(name:string,group:string,size:number[],center:number[],m:Matrix4,sphere?:number)=>parts.push({name,group,size:size as V3,center:center as V3,matrix:m.elements.slice(),sphere});
 for(const [name,m] of Object.entries(nodes))if(isKey(name)){
  add(name,'pcb',t.size_mm,[0,0,z-t.size_mm[2]/2],m);
  for(const c of t.components)add(name+': '+c.name,'components',c.size_mm,[c.center_mm[0],c.center_mm[1],c.center_mm[2]+z],m);
  add(name,'switch',s.body_mm,[0,0,s.body_mm[2]/2-s.body_below_plate_mm],m);
  const cap=capSize(cfg,name);add(name,'keycaps',cap,[0,0,s.keycap_bottom_above_plate_mm+cap[2]/2],m);
 }
 const b=cfg.trackball,bt=-b.board_top_below_deck_mm,m=nodes.trackball;
 add('Trackball PCB','trackball',b.board_mm,[0,0,bt-b.board_mm[2]/2],m);
 add('Rear components','trackball',[b.board_mm[0],b.board_mm[1],b.rear_component_depth_mm],[0,0,bt-b.board_mm[2]-b.rear_component_depth_mm/2],m);
 add('Housing','trackball',b.housing_mm,[0,0,bt+b.housing_mm[2]/2],m);
 add('Ball','ball',[0,0,0],[0,0,bt+b.ball_center_above_board_mm],m,b.ball_diameter_mm/2);
 const a=cfg.adapter;add('FFC PCB','adapter',a.board_mm,[0,0,-a.board_mm[2]/2],nodes.adapter);add('FFC connector','adapter',[a.board_mm[0]-4,a.board_mm[1]/2,a.component_height_mm],[0,0,a.component_height_mm/2],nodes.adapter);
 return parts;
}
export interface Clearance {name:string;size:V3;margin:number;travel:number;atRest:number;swept:number;passed:boolean}
export interface SeatCheck {name:string;missing:number;excess:number;clipBlocked:number;passed:boolean}
export interface Report {seats:SeatCheck[];passed:boolean;keycaps:Clearance[];hardware:{name:string;group:string;volume:number}[];openings:{name:string;removed:number;covered:number;blocked:number}[];volume:number;triangles:number;milliseconds:number;notes:string[]}
export interface Highlight {name:string;kind:'rest'|'travel'|'hardware'|'opening'|'seat';mesh:MeshData}
export interface BuildResult {mesh:MeshData;report:Report;highlights:Highlight[]}
function meshData(solid:Manifold):MeshData {
 const raw=solid.getMesh(),positions=new Float32Array(raw.vertProperties.length/raw.numProp*3);
 for(let i=0;i<positions.length/3;i++)for(let j=0;j<3;j++)positions[i*3+j]=raw.vertProperties[i*raw.numProp+j];
 return {positions,indices:new Uint32Array(raw.triVerts)};
}
export function buildSolid(wasm:ManifoldToplevel,project:Project):BuildResult{
 validateProject(project);const start=performance.now(),cfg=project.config,nodes=mountedFrames(project),all=new Set<Manifold>(),keep=(m:Manifold)=>{all.add(m);return m},M=wasm.Manifold;
 const highlights:Highlight[]=[];
 const collision=(body:Manifold,envelope:Manifold,name:string,kind:Highlight['kind'])=>{const hit=body.intersect(envelope);try{const v=Math.max(0,hit.volume());if(v>.05)highlights.push({name,kind,mesh:meshData(hit)});return v}finally{hit.delete()}};
 const box=(size:number[],center:number[]=[0,0,0])=>keep(keep(M.cube(size as V3,true)).translate(center as V3));
 const place=(m:Manifold,pose:Matrix4)=>keep(m.transform(pose.elements as Mat4));
 const volume=(a:Manifold,b:Manifold)=>{const hit=a.intersect(b);try{return Math.max(0,hit.volume())}finally{hit.delete()}};
 const rounded=(size:number[],center:number[],radius:number)=>{
  const [x,y,z]=size,r=Math.min(radius,x/2-.01,y/2-.01),parts:Manifold[]=[];
  for(const sx of [-1,1])for(const sy of [-1,1])parts.push(keep(keep(M.cylinder(z,r,r,24,true)).translate([sx*(x/2-r),sy*(y/2-r),0])));
  return keep(keep(M.hull(parts)).translate(center as V3));
 };
 try{
  const data=solidMesh(project.cage,project.thickness);let body=keep(new M(new wasm.Mesh({numProp:3,vertProperties:data.positions,triVerts:data.indices})));
  if(body.status()!=='NoError')throw Error('Invalid shell: '+body.status());
  const {outer,thickness}=seatSettings(cfg),seatPlates:Manifold[]=[],seatTrims:Manifold[]=[],clipCuts:Manifold[]=[];
  for(const [name,m] of Object.entries(nodes))if(isKey(name)){
   seatPlates.push(place(box([...outer,thickness],[0,0,-thickness/2]),m));
   seatTrims.push(place(box([...outer,7],[0,0,3.5]),m),place(box([...outer,7-thickness],[0,0,(-7-thickness)/2]),m));
   const s=cfg.switch,y=s.cutout_mm[1]+s.cutout_clearance_mm;
   for(const sign of [-1,1])clipCuts.push(place(box([s.clip_width_mm,s.clip_relief_depth_mm+.2,3],[0,sign*(y/2+s.clip_relief_depth_mm/2-.05),-thickness-1.5]),m));
  }
  // Crisp flat seats: trim the curved shell above and below each mounting
  // footprint, then fill the plate so the switch lip is continuously supported.
  body=keep(keep(body.subtract(keep(M.union(seatTrims)))).add(keep(M.union(seatPlates))));
  const cuts:Manifold[]=[...clipCuts],openings:Report['openings']=[];
  const record=(name:string,cutter:Manifold,size?:number[],pose?:Matrix4,low=-6,high=12)=>{
   let covered=0,blocked=0;
   if(size&&pose)for(const x of [-size[0]/2+.25,0,size[0]/2-.25])for(const y of [-size[1]/2+.25,0,size[1]/2-.25]){
    const probe=place(box([.3,.3,24],[x,y,0]),pose),hit=keep(body.intersect(probe));
    if(hit.volume()>.001){covered++;const punch=place(box([.4,.4,high-low],[x,y,(high+low)/2]),pose),rest=keep(hit.subtract(punch));if(rest.volume()>.001)blocked++}
   }
   const removed=volume(body,cutter);if(covered<9&&size||blocked||removed<=.001)highlights.push({name,kind:'opening',mesh:meshData(cutter)});openings.push({name,removed,covered:size?covered:removed>.001?9:0,blocked});cuts.push(cutter);
  };
  for(const [name,m] of Object.entries(nodes))if(isKey(name)){
   const size=cfg.switch.cutout_mm.map(x=>x+cfg.switch.cutout_clearance_mm),low=-cfg.switch.body_below_plate_mm-.5,high=12;
   record(name,place(box([...size,high-low],[0,0,(high+low)/2]),m),size,m,low,high);
  }
  const tb=cfg.trackball,low=-tb.opening_depth_below_mm,high=10;
  record('trackball',place(rounded([...tb.opening_mm,high-low],[0,0,(high+low)/2],tb.opening_radius_mm),nodes.trackball),tb.opening_mm,nodes.trackball,low,high);
  const ad=cfg.adapter,anchor=point(nodes.adapter,[0,-ad.board_mm[1]/2,ad.component_height_mm/2]);let xmin=Infinity;for(let i=0;i<data.positions.length/6;i++)xmin=Math.min(xmin,data.positions[i*3]);xmin-=2;
  const end=anchor[0]+1,[w,h]=cfg.ribbon.opening_mm;
  record('ribbon',rounded([end-xmin,w,h],[(xmin+end)/2,anchor[1],anchor[2]],Math.min(cfg.ribbon.edge_radius_mm,h/2-.01)));
  const result=keep(body.subtract(keep(M.union(cuts))));if(result.status()!=='NoError'||result.volume()<=0)throw Error('Cutouts produced an invalid solid: '+result.status());
  const pieces=result.decompose();const count=pieces.length;pieces.forEach(p=>p.delete());if(count!==1)throw Error(`Finished shell has ${count} disconnected pieces. A switch seat may be separated from the wall, or a cutout may have cut material free. Undo or move the surrounding wall controls closer to the mounting area.`);
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
  for(const p of hardware(project,nodes))if(['pcb','components','trackball','adapter','keycaps'].includes(p.group)){
   const part=place(box(p.size,p.center),new Matrix4().fromArray(p.matrix)),v=p.group==='keycaps'?volume(result,part):collision(result,part,p.name,'hardware');if(v>.05)overlaps.push({name:p.name,group:p.group,volume:v});
  }
  const keycaps:Clearance[]=[];
  for(const [name,m] of Object.entries(nodes))if(isKey(name)){
   const size=capSize(cfg,name),s=cfg.switch,margin=(s.keycap_clearance_overrides_mm as Record<string,number>)[name]??s.keycap_clearance_mm,low=s.keycap_bottom_above_plate_mm-s.travel_mm;
   const rest=place(box(size,[0,0,s.keycap_bottom_above_plate_mm+size[2]/2]),m);
   const sweep=place(box([size[0]+2*margin,size[1]+2*margin,size[2]+s.travel_mm],[0,0,low+(size[2]+s.travel_mm)/2]),m);
   const atRest=collision(result,rest,name,'rest'),swept=collision(result,sweep,name,'travel');keycaps.push({name,size,margin,travel:s.travel_mm,atRest,swept,passed:atRest<=.05&&swept<=.05});
  }
  const mesh=meshData(result);
  return {mesh,highlights,report:{seats,passed:seats.every(s=>s.passed)&&keycaps.every(k=>k.passed)&&overlaps.length===0&&openings.every(o=>o.removed>.001&&o.covered===9&&o.blocked===0),keycaps,hardware:overlaps,openings,volume:result.volume(),triangles:mesh.indices.length/3,milliseconds:performance.now()-start,notes:['Component/keycap envelopes are conservative boxes.','Flat seats and clip reliefs are generated. PCB retainers remain unimplemented. Minimum thickness and global self-intersections are not certified.']}};
 }finally{for(const m of [...all].reverse())m.delete()}
}
