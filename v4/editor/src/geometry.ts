import { Matrix4, Vector3 } from 'three';
import defaultConfig from './default-config.json';
import defaultCage from './default-cage.json';
export type V3 = [number,number,number];
export type Quad = [number,number,number,number];
export type Config = typeof defaultConfig;
export interface Cage {schema:number; construction:string; control_ids:string[]; positions_mm:V3[]; quads:Quad[]; subdivisions:number; wall_settings:{shoulder_width_mm:number;wall_lower_ring_z_mm:number;base_z_mm:number}; [key:string]:unknown}
export interface Project {version:1;cage:Cage;config:Config;thickness:number;comparison?:{active:string;designs:Record<string,{cage:Cage;config:Config;thickness:number}>}}
export interface Surface {positions:V3[];quads:Quad[];tags:string[]}
export interface MeshData {positions:Float32Array;indices:Uint32Array}
export const defaults:Project={version:1,cage:defaultCage as unknown as Cage,config:defaultConfig,thickness:2};
export const clone=<T>(v:T):T=>structuredClone(v);
export const add=(a:number[],b:number[]):V3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub=(a:number[],b:number[]):V3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const cross=(a:number[],b:number[]):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const dot=(a:number[],b:number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const unit=(a:number[]):V3=>{const n=Math.hypot(...a);if(n<1e-10)throw Error('Collapsed control edge');return a.map(x=>x/n) as V3};
export function frame(origin:number[]=[0,0,0],angles:number[]=[0,0,0]){const a=angles.map(x=>x*Math.PI/180);return new Matrix4().makeRotationZ(a[2]).multiply(new Matrix4().makeRotationY(a[1])).multiply(new Matrix4().makeRotationX(a[0])).setPosition(...origin as V3)}
export const point=(m:Matrix4,p:number[])=>new Vector3(...p as V3).applyMatrix4(m).toArray() as V3;
export function componentFrames(cfg:Config){
 const g=cfg.geometry,s=cfg.surface,n:Record<string,Matrix4>={};
 type Pose={name?:string;offset_mm?:number[];rotation_deg?:number[]};
 g.columns.forEach((col,ci)=>['top','home','bottom'].forEach((row,ri)=>{
  const x=(ci-2)*g.column_pitch_mm+col.offset_mm[0],y=(1-ri)*g.row_pitch_mm+col.offset_mm[1],u=x-s.origin_mm[0],v=y-s.origin_mm[1],[rx,ry]=s.radii_mm,[tx,ty]=s.tilt_deg.map(x=>Math.tan(x*Math.PI/180)),c=s.cross_coefficient_per_mm;
  const z=s.origin_mm[2]+(rx?u*u/(2*rx):0)+(ry?v*v/(2*ry):0)+c*u*v+u*tx+v*ty,dx=(rx?u/rx:0)+c*v+tx,dy=(ry?v/ry:0)+c*u+ty;
  const normal=unit([-dx,-dy,1]),across=unit([1,0,dx]),along=cross(normal,across),m=new Matrix4().makeBasis(new Vector3(...across),new Vector3(...along),new Vector3(...normal)).setPosition(x,y,z);
  const name=`matrix_${col.name}_${row}`,over=(g.key_overrides as Record<string,Pose>)[name]||{};
  n[name]=m.multiply(frame([0,0,col.offset_mm[2]],col.rotation_deg)).multiply(frame(over.offset_mm,over.rotation_deg));
 }));
 const root=frame(g.thumb.position_mm,g.thumb.rotation_deg),arc=g.thumb.arc;
 (g.thumb.keys as Pose[]).forEach((key,i)=>{const angle=(i-1)*arc.step_deg,a=angle*Math.PI/180;n['thumb_'+key.name]=root.clone().multiply(frame([arc.radius_mm*Math.sin(a),arc.radius_mm*(Math.cos(a)-1),0],[0,0,-angle])).multiply(frame(key.offset_mm,key.rotation_deg))});
 for(const key of ['trackball','adapter'] as const)n[key]=frame(cfg[key].position_mm,cfg[key].rotation_deg);
 const tent=frame([0,0,0],[0,g.tent_deg,0]);for(const key in n)n[key].premultiply(tent);
 const lift=g.mount_lift_mm??defaultConfig.geometry.mount_lift_mm;for(const m of Object.values(n))m.elements[14]+=lift;
 return n;
}
export function boundary(quads:Quad[]){
 const edges=new Map<string,[number,number][]>();
 for(const f of quads)for(let k=0;k<4;k++){const a=f[k],b=f[(k+1)%4],key=a<b?`${a},${b}`:`${b},${a}`;if(!edges.has(key))edges.set(key,[]);edges.get(key)!.push([a,b])}
 if([...edges.values()].some(e=>e.length===2&&e[0][0]===e[1][0]))throw Error('Inconsistent face winding');
 const pairs=[...edges.values()].filter(e=>e.length===1).map(e=>e[0]);if([...edges.values()].some(e=>e.length>2))throw Error('Non-manifold cage');
 const next=new Map(pairs),start=pairs[0]?.[0],out:number[]=[];if(start===undefined||next.size!==pairs.length)throw Error('Invalid boundary');let v=start;
 do{if(out.includes(v)||!next.has(v))throw Error('Branched boundary');out.push(v);v=next.get(v)!}while(v!==start);
 if(out.length!==pairs.length)throw Error('Multiple boundary loops');return out;
}
export function expand(cage:Cage):Surface{
 const b=boundary(cage.quads),ring=b.map(i=>cage.positions_mm[i]),r=cage.wall_settings.shoulder_width_mm;
 const outer=ring.map((p,i)=>{const t=sub(ring[(i+1)%ring.length],ring[(i+ring.length-1)%ring.length]),n=unit([t[1],-t[0],0]);return [p[0]+n[0]*r,p[1]+n[1]*r]});
 const positions=clone(cage.positions_mm),quads=clone(cage.quads),tags=quads.map(()=> 'top');let old=b;
 for(let row=0;row<3;row++){
  const next=ring.map((_,i)=>positions.length+i);
  positions.push(...outer.map((p,i)=>[p[0],p[1],row===0?ring[i][2]-r*.65:row===1?cage.wall_settings.wall_lower_ring_z_mm:cage.wall_settings.base_z_mm] as V3));
  for(let i=0;i<b.length;i++){const j=(i+1)%b.length;quads.push([old[j],old[i],next[i],next[j]]);tags.push(row===0?'shoulder':'wall')}old=next;
 }
 return {positions,quads,tags};
}
interface Step {offsets:Uint32Array;columns:Uint32Array;weights:Float64Array;quads:Quad[];tags:string[]}
const cache=new Map<string,Step[]>();
function step(quads:Quad[],n:number,tags:string[]):Step{
 const edges=new Map<string,{v:[number,number];faces:number[];id:number}>(),vf:number[][]=Array.from({length:n},()=>[]),ve:Set<string>[]=Array.from({length:n},()=>new Set());
 quads.forEach((f,fi)=>{for(const v of f)vf[v].push(fi);for(let k=0;k<4;k++){const a=f[k],b=f[(k+1)%4],v:[number,number]=a<b?[a,b]:[b,a],key=v.join(',');if(!edges.has(key))edges.set(key,{v,faces:[],id:n+quads.length+edges.size});edges.get(key)!.faces.push(fi);ve[a].add(key);ve[b].add(key)}});
 const rows:Map<number,number>[]=Array.from({length:n+quads.length+edges.size},()=>new Map()),put=(r:number,c:number,w:number)=>rows[r].set(c,(rows[r].get(c)||0)+w);
 for(let v=0;v<n;v++){
  const es=[...ve[v]].map(k=>edges.get(k)!),b=es.filter(e=>e.faces.length===1),d=es.length;
  if(b.length){if(b.length!==2)throw Error('Non-manifold subdivision boundary');put(v,v,.75);for(const e of b)put(v,e.v[0]===v?e.v[1]:e.v[0],.125)}
  else{put(v,v,(d-3)/d);for(const fi of vf[v])for(const q of quads[fi])put(v,q,1/(d*vf[v].length*4));for(const e of es)for(const q of e.v)put(v,q,1/(d*d))}
 }
 quads.forEach((f,i)=>f.forEach(v=>put(n+i,v,.25)));
 for(const e of edges.values()){if(e.faces.length===1)for(const v of e.v)put(e.id,v,.5);else if(e.faces.length===2){for(const v of e.v)put(e.id,v,.25);for(const fi of e.faces)for(const v of quads[fi])put(e.id,v,1/16)}else throw Error('Non-manifold subdivision edge')}
 const out:Quad[]=[],outTags:string[]=[],edge=(a:number,b:number)=>edges.get(a<b?`${a},${b}`:`${b},${a}`)!.id;
 quads.forEach((f,fi)=>f.forEach((v,k)=>{out.push([v,edge(v,f[(k+1)%4]),n+fi,edge(f[(k+3)%4],v)]);outTags.push(tags[fi])}));
 const offsets=[0],columns:number[]=[],weights:number[]=[];for(const row of rows){for(const [c,w] of row){columns.push(c);weights.push(w)}offsets.push(columns.length)}
 return {offsets:new Uint32Array(offsets),columns:new Uint32Array(columns),weights:new Float64Array(weights),quads:out,tags:outTags};
}
export function refine(surface:Surface,levels:number):Surface{
 const key=JSON.stringify([surface.positions.length,surface.quads,levels]);let steps=cache.get(key);
 if(!steps){steps=[];let q=surface.quads,n=surface.positions.length,t=surface.tags;for(let i=0;i<levels;i++){const s=step(q,n,t);steps.push(s);q=s.quads;n=s.offsets.length-1;t=s.tags}if(cache.size>4)cache.clear();cache.set(key,steps)}
 let p=surface.positions;for(const s of steps){const next:V3[]=Array.from({length:s.offsets.length-1},()=>[0,0,0]);for(let r=0;r<next.length;r++)for(let j=s.offsets[r];j<s.offsets[r+1];j++){const v=p[s.columns[j]],w=s.weights[j];next[r][0]+=w*v[0];next[r][1]+=w*v[1];next[r][2]+=w*v[2]}p=next}
 return {positions:p,quads:steps.at(-1)?.quads||surface.quads,tags:steps.at(-1)?.tags||surface.tags};
}
export function triangles(quads:Quad[]){return quads.flatMap(f=>[f[0],f[1],f[2]]).concat(quads.flatMap(f=>[f[0],f[2],f[3]]))}
export function normals(p:V3[],indices:number[]){const out:V3[]=p.map(()=>[0,0,0]);for(let i=0;i<indices.length;i+=3){const [a,b,c]=indices.slice(i,i+3),n=cross(sub(p[b],p[a]),sub(p[c],p[a]));for(const j of [a,b,c])out[j]=add(out[j],n)}return out.map(unit)}
export function surfaceMesh(s:Surface):MeshData{return {positions:new Float32Array(s.positions.flat()),indices:new Uint32Array(triangles(s.quads))}}
export function solidMesh(cage:Cage,thickness:number):MeshData{
 const coarse=expand(cage),outer=refine(coarse,cage.subdivisions),innerCoarse=clone(coarse),nr=cage.positions_mm.length,nb=(coarse.positions.length-nr)/3;
 for(let i=0;i<nr;i++)innerCoarse.positions[i][2]-=thickness;
 for(let row=0;row<3;row++)for(let i=0;i<nb;i++){const k=nr+row*nb+i,t=sub(coarse.positions[nr+row*nb+(i+1)%nb],coarse.positions[nr+row*nb+(i+nb-1)%nb]),inward=unit([-t[1],t[0],0]);innerCoarse.positions[k][0]+=inward[0]*thickness;innerCoarse.positions[k][1]+=inward[1]*thickness;if(row===0)innerCoarse.positions[k][2]-=thickness*.65}
 const inner=refine(innerCoarse,cage.subdivisions),b=boundary(outer.quads),n=outer.positions.length,tri=triangles(outer.quads),out=tri.slice();
 for(const i of b)inner.positions[i][2]=outer.positions[i][2];
 for(let i=0;i<tri.length;i+=3){const [a,bb,c]=tri.slice(i,i+3),normal=cross(sub(outer.positions[bb],outer.positions[a]),sub(outer.positions[c],outer.positions[a])),ni=cross(sub(inner.positions[bb],inner.positions[a]),sub(inner.positions[c],inner.positions[a]));if(dot(normal,ni)<=0)throw Error('Inner shell folds. Undo or move the nearby controls further apart.');out.push(c+n,bb+n,a+n)}
 for(let i=0;i<b.length;i++){const a=b[i],bb=b[(i+1)%b.length];out.push(bb,a,a+n,bb,a+n,bb+n)}
 for(let i=0;i<outer.quads.length;i++)if(outer.tags[i]!=='wall'){const [a,b,c,d]=outer.quads[i].map(k=>outer.positions[k]);const area=cross(sub(b,a),sub(c,a))[2]+cross(sub(c,a),sub(d,a))[2];if(area<=0)throw Error('Roof or rim folds. Undo or move the nearby controls further apart.')}
 return {positions:new Float32Array([...outer.positions,...inner.positions].flat()),indices:new Uint32Array(out)};
}
export function validateProject(p:unknown):asserts p is Project{
 const a=p as Project;if(!a||a.version!==1||a.cage?.schema!==2||a.cage.construction!=='sparse_roof_derived_walls')throw Error('Not a Rosebear editor project (version 1, cage schema 2 required).');
 const c=a.cage;if(c.positions_mm.length!==c.control_ids.length||c.positions_mm.length>200||new Set(c.control_ids).size!==c.control_ids.length)throw Error('Invalid control IDs');
 if(c.positions_mm.some(v=>!Array.isArray(v)||v.length!==3||v.some(x=>!Number.isFinite(x)||Math.abs(x)>1000)))throw Error('Control coordinates must be finite millimetres within ±1000.');
 if(c.quads.length===0||c.quads.length>300||c.quads.some(f=>f.length!==4||f.some(v=>!Number.isInteger(v)||v<0||v>=c.positions_mm.length)))throw Error('Invalid control faces');
 if(new Set(c.quads.flat()).size!==c.positions_mm.length)throw Error('Unused control vertices');
 if(!Number.isInteger(c.subdivisions)||c.subdivisions<1||c.subdivisions>4||!Number.isFinite(a.thickness)||a.thickness<.5||a.thickness>6)throw Error('Invalid detail or thickness');
 for(const x of Object.values(c.wall_settings))if(!Number.isFinite(x)||Math.abs(x)>200)throw Error('Invalid wall settings');
 const check=(x:unknown):void=>{if(typeof x==='number'&&!Number.isFinite(x))throw Error('Non-finite configuration');if(x&&typeof x==='object')Object.values(x).forEach(check)};check(a.config);
 if(!a.config?.geometry||!a.config?.switch||!a.config?.tile||!a.config?.trackball||!a.config?.adapter)throw Error('Missing component configuration');
 if(a.comparison){const ids=['baseline','tilt','shift','both'];if(!ids.includes(a.comparison.active)||!a.comparison.designs||!a.comparison.designs.baseline||Object.keys(a.comparison.designs).some(id=>!ids.includes(id)))throw Error('Invalid layout comparison');for(const design of Object.values(a.comparison.designs))validateProject({version:1,cage:design.cage,config:design.config,thickness:design.thickness})}
 boundary(c.quads);componentFrames(a.config);
}
