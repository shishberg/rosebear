// PROTOTYPE, throwaway: alternative chassis shapes for the right hand.
// Every variant uses the same key poses (componentFrames from the default
// config) so only the chassis differs. Visual comparison only: no clearance
// checks, no tile pockets, no wiring space, not printable as-is.
import type {CrossSection,Manifold,ManifoldToplevel,Vec3} from 'manifold-3d';
import {Matrix4} from 'three';
import {point,type Config} from '../geometry';
import {capSize,isKey} from '../solid';

export interface Kit {wasm:ManifoldToplevel;cfg:Config;frames:Record<string,Matrix4>}
export interface Variant {key:string;name:string;blurb:string;build:(k:Kit)=>Manifold}

const T=3; // plate thickness
const COLS=['inner','index','middle','ring','pinky'],ROWS=['top','home','bottom'];
const keys=(f:Record<string,Matrix4>)=>Object.keys(f).filter(isKey);
const thumbs=(k:Kit)=>keys(k.frames).filter(n=>n.startsWith('thumb_')).sort((a,b)=>k.frames[a].elements[12]-k.frames[b].elements[12]);
const half=(k:Kit,n:string,grow=0)=>{const c=capSize(k.cfg,n);return [c[0]/2+.75+grow,c[1]/2+.75+grow]};
// World point on a key plate: sx,sy in -1..1 across the plate, z along the normal.
const at=(k:Kit,n:string,sx:number,sy:number,z=0,grow=0):Vec3=>{const [hx,hy]=half(k,n,grow);return point(k.frames[n],[sx*hx,sy*hy,z])};
const corners=(k:Kit,n:string,grow=0)=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>at(k,n,x,y,0,grow));
const place=(m:Manifold,f:Matrix4)=>m.transform(f.elements as never);
const down=(p:Vec3,z=0):Vec3=>[p[0],p[1],z];

// Plate with a 14 mm switch cutout, in the key's frame.
function plate(k:Kit,n:string,grow=0){
 const M=k.wasm.Manifold,[hx,hy]=half(k,n,grow);
 const body=M.cube([hx*2,hy*2,T],true).translate([0,0,-T/2]).subtract(M.cube([14,14,T*4],true));
 return place(body,k.frames[n]);
}
const plates=(k:Kit,grow=0)=>k.wasm.Manifold.union(keys(k.frames).map(n=>plate(k,n,grow)));
// Plate edge facing a world XY direction, as two corner sign pairs.
function edgeFacing(k:Kit,n:string,dir:[number,number]){
 const m=k.frames[n].elements,edges:[number,number][][]=[[[1,-1],[1,1]],[[-1,-1],[-1,1]],[[-1,1],[1,1]],[[-1,-1],[1,-1]]];
 const score=(e:[number,number][])=>{const sx=(e[0][0]+e[1][0])/2,sy=(e[0][1]+e[1][1])/2;return (m[0]*sx+m[4]*sy)*dir[0]+(m[1]*sx+m[5]*sy)*dir[1]};
 return edges.reduce((a,b)=>score(b)>score(a)?b:a);
}

// Bowyer-Watson Delaunay over plate corners, dropping large triangles so the
// roof follows the layout's concave outline (an alpha shape).
function delaunay(pts:[number,number][]){
 type Tri=[number,number,number];
 const big=1e4,all=[...pts,[-big,-big],[big,-big],[0,big]] as [number,number][],n=pts.length;
 let tris:Tri[]=[[n,n+1,n+2]];
 const circ=(t:Tri)=>{const [a,b,c]=t.map(i=>all[i]),d=2*(a[0]*(b[1]-c[1])+b[0]*(c[1]-a[1])+c[0]*(a[1]-b[1]));
  const ux=((a[0]**2+a[1]**2)*(b[1]-c[1])+(b[0]**2+b[1]**2)*(c[1]-a[1])+(c[0]**2+c[1]**2)*(a[1]-b[1]))/d,uy=((a[0]**2+a[1]**2)*(c[0]-b[0])+(b[0]**2+b[1]**2)*(a[0]-c[0])+(c[0]**2+c[1]**2)*(b[0]-a[0]))/d;
  return {x:ux,y:uy,r:Math.hypot(a[0]-ux,a[1]-uy)}};
 pts.forEach((p,i)=>{
  const bad=tris.filter(t=>{const c=circ(t);return Math.hypot(p[0]-c.x,p[1]-c.y)<c.r});
  const edges=new Map<string,[number,number]>();
  for(const t of bad)for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],key=a<b?a+','+b:b+','+a;edges.has(key)?edges.delete(key):edges.set(key,[a,b])}
  tris=tris.filter(t=>!bad.includes(t));for(const [a,b] of edges.values())tris.push([a,b,i]);
 });
 return tris.filter(t=>t.every(i=>i<n)).map(t=>({t,r:circ(t).r}));
}

interface Roof {pts:Vec3[];top:Vec3[];tris:[number,number,number][];boundary:[number,number][];normal:Map<number,[number,number]>}
function roof(k:Kit,alpha=17,grow=0):Roof{
 const names=keys(k.frames),top=names.flatMap(n=>corners(k,n,grow)),pts=names.flatMap(n=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>at(k,n,x,y,-T,grow)));
 const kept=delaunay(top.map(p=>[p[0],p[1]])).filter(x=>x.r<alpha).map(x=>x.t);
 const count=new Map<string,{e:[number,number];other:number;n:number}>();
 for(const t of kept)for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],key=a<b?a+','+b:b+','+a,e=count.get(key);e?e.n++:count.set(key,{e:[a,b],other:t[(j+2)%3],n:1})}
 const boundary:[number,number][]=[],normal=new Map<number,[number,number]>();
 for(const {e:[a,b],other,n} of count.values()){if(n!==1)continue;boundary.push([a,b]);
  const dx=top[b][0]-top[a][0],dy=top[b][1]-top[a][1],l=Math.hypot(dx,dy);let nx=dy/l,ny=-dx/l;
  if((top[other][0]-top[a][0])*nx+(top[other][1]-top[a][1])*ny>0){nx=-nx;ny=-ny}
  for(const v of [a,b]){const o=normal.get(v)||[0,0];normal.set(v,[o[0]+nx,o[1]+ny])}}
 for(const [v,[x,y]] of normal){const l=Math.hypot(x,y)||1;normal.set(v,[x/l,y/l])}
 return {pts,top,tris:kept,boundary,normal};
}
// Continuous faceted web through every plate corner.
const web=(k:Kit,r:Roof)=>k.wasm.Manifold.union(r.tris.map(t=>k.wasm.Manifold.hull(t.flatMap(i=>[r.top[i],r.pts[i]]))));
function walls(k:Kit,r:Roof,out:number,drop:number,w=2){
 const M=k.wasm.Manifold,off=(i:number,d:number,z:number):Vec3=>{const n=r.normal.get(i)!,p=r.pts[i];return [p[0]+n[0]*d,p[1]+n[1]*d,z]};
 return M.union(r.boundary.flatMap(([a,b])=>{
  const za=r.pts[a][2]-drop,zb=r.pts[b][2]-drop;
  return [M.hull([r.top[a],r.top[b],r.pts[a],r.pts[b],off(a,out,za),off(b,out,zb),off(a,out+w,za),off(b,out+w,zb),off(a,out+w,r.top[a][2]-.5),off(b,out+w,r.top[b][2]-.5)]),
          M.hull([off(a,out,za),off(b,out,zb),off(a,out+w,za),off(b,out+w,zb),off(a,out,0),off(b,out,0),off(a,out+w,0),off(b,out+w,0)])];
 }));
}
// Plan-view footprint of the layout, closed across the gaps between keys.
function footprint(k:Kit,grow:number,close=8){
 const CS=k.wasm.CrossSection,names=keys(k.frames);
 const cs=CS.union(names.map(n=>new CS([corners(k,n,1).map(p=>[p[0],p[1]] as [number,number])])));
 return cs.offset(close,'Round',2,24).offset(-close+grow,'Round',2,24);
}
function hexHoles(k:Kit,region:ReturnType<typeof footprint>,z:number,h:number){
 const M=k.wasm.Manifold,holes:Manifold[]=[],b=region.bounds();
 for(let y=b.min[1],row=0;y<b.max[1];y+=9,row++)for(let x=b.min[0]+(row%2)*5.2;x<b.max[0];x+=10.4)holes.push(M.cylinder(h+2,4.6,4.6,6).rotate([0,0,30]).translate([x,y,z-1]));
 return M.union(holes).intersect(region.offset(-5,'Round').extrude(h+4).translate([0,0,z-2]));
}

// Cirque TM040040 (40 mm) in a printed pod, clipped to the inner side.
export function cirque(k:Kit,link:'bracket'|'none'='bracket'){
 const M=k.wasm.Manifold,f=k.frames.trackball.clone().premultiply(new Matrix4().makeTranslation(-8,0,0));
 let pod=place(M.cylinder(7,22.5,22.5,64).translate([0,0,-6.5]).subtract(M.cylinder(2,20.4,20.4,64).translate([0,0,-.5])),f);
 if(link==='bracket'){
  const c=point(f,[0,0,-4]),near=['matrix_inner_home','matrix_inner_bottom','thumb_far'].flatMap(n=>corners(k,n)).sort((a,b)=>Math.hypot(a[0]-c[0],a[1]-c[1])-Math.hypot(b[0]-c[0],b[1]-c[1])).slice(0,2);
  const rim=near.map(p=>{const d=[p[0]-c[0],p[1]-c[1]],l=Math.hypot(d[0],d[1]);return point(f,[0,0,0]).map((v,i)=>i<2?c[i]+d[i]/l*20:c[2]) as Vec3});
  pod=pod.add(M.hull([...rim.flatMap(p=>[p,[p[0],p[1],p[2]-4] as Vec3]),...near.flatMap(p=>[[p[0],p[1],p[2]-T] as Vec3,[p[0],p[1],p[2]-T-4] as Vec3])]));
 }
 return pod;
}
export const cirquePad=(k:Kit)=>place(k.wasm.Manifold.cylinder(1,20,20,64).translate([0,0,-1.4]),k.frames.trackball.clone().premultiply(new Matrix4().makeTranslation(-8,0,0)));


function faceted(k:Kit,pockets:boolean){

   const M=k.wasm.Manifold,CS=k.wasm.CrossSection,pts=(names:string[])=>names.flatMap(n=>corners(k,n,.5));
   // Convex lump over some keys, down to a chamfered foot.
   const lump=(names:string[])=>{const cs=CS.hull(names.map(n=>new CS([corners(k,n,1).map(p=>[p[0],p[1]] as [number,number])]))),ring=(d:number,z:number)=>cs.offset(d,'Miter').toPolygons().flat().map(([x,y])=>[x,y,z] as Vec3);return M.hull([...pts(names),...ring(2,0),...ring(4,4)])};
   const fingers=COLS.flatMap(c=>ROWS.map(r=>`matrix_${c}_${r}`)),base=thumbs(k).filter(n=>!n.startsWith('thumb_x')),extra=thumbs(k).filter(n=>n.startsWith('thumb_x'));
   let body=M.union([lump(fingers),lump(base),lump(['matrix_inner_bottom','matrix_index_bottom',...base]),...(extra.length?[lump(extra),lump([...extra,'matrix_middle_bottom','matrix_index_bottom'])]:[])]);
   if(pockets)for(const n of keys(k.frames)){const [hx,hy]=half(k,n,-.25);body=body.subtract(place(M.cube([hx*2,hy*2,60],true).translate([0,0,30]),k.frames[n])).subtract(place(M.cube([14,14,20],true),k.frames[n]))}
   return body;
}
// Round creases (minSmoothness gives sharp edges a small fillet), then recut
// the switch holes and keycap clearance so they stay crisp.
function soften(k:Kit,m:Manifold,angle:number,smooth:number,levels:number){
 return cutKeys(k,m.smoothOut(angle,smooth).refine(levels));
}
function cutKeys(k:Kit,m:Manifold){
 const M=k.wasm.Manifold;
 for(const n of keys(k.frames)){const [hx,hy]=half(k,n,-.25);m=m.subtract(place(M.cube([14,14,20],true),k.frames[n])).subtract(place(M.cube([hx*2,hy*2,60],true).translate([0,0,30]),k.frames[n]))}
 return m;
}
type Edge=[number,number][];
// Solid strip along a plate edge: z0..z1 along the normal, grown g0..g1 outward.
const strip=(k:Kit,n:string,e:Edge,z0:number,z1:number,g0:number,g1:number):Vec3[]=>e.flatMap(([sx,sy])=>[z0,z1].flatMap(z=>[g0,g1].map(g=>at(k,n,sx,sy,z,g))));
const toward=(k:Kit,a:string,b:string):[number,number]=>{const p=k.frames[a].elements,q=k.frames[b].elements;return [q[12]-p[12],q[13]-p[13]]};
function ladder(k:Kit,names:string[],G:number,D:number,sides:[number,number][]){
 const M=k.wasm.Manifold,parts:Manifold[]=[];
 for(const n of names)parts.push(place(M.cube([half(k,n,G)[0]*2,half(k,n,G)[1]*2,T],true).translate([0,0,-T/2]),k.frames[n]));
 for(let i=0;i+1<names.length;i++){const a=names[i],b=names[i+1];parts.push(M.hull([...strip(k,a,edgeFacing(k,a,toward(k,a,b)),0,-T,0,G),...strip(k,b,edgeFacing(k,b,toward(k,b,a)),0,-T,0,G)]))}
 // One flat skirt per key, so no twisted faces between keys at different angles.
 for(const d of sides)for(const n of names)parts.push(M.hull(strip(k,n,edgeFacing(k,n,d),0,-D,G-1.2,G)));
 return M.union(parts);
}
// Opening through a wall facing roughly along world x or y: rounded corners
// of radius r, placed inside the given quad corners.
function roundedWindow(k:Kit,quad:Vec3[],r:number,axis:'x'|'y'){
 const M=k.wasm.Manifold,c=[0,1,2].map(i=>quad.reduce((a,p)=>a+p[i],0)/quad.length);
 return M.hull(quad.map(p=>{const d=[c[0]-p[0],c[1]-p[1],c[2]-p[2]],l=Math.hypot(...d)||1,q=p.map((v,i)=>v+d[i]/l*r*1.2);
  return M.cylinder(60,r,r,32,true).rotate(axis==='x'?[0,90,0]:[90,0,0]).translate(q as Vec3)}));
}
// Quarter-round end on a column: continues the plate top over an arc of
// radius R away from the key (local y sign sy), then drops to the tray.
function endCap(k:Kit,n:string,e:Edge,G:number,R=9,w=2.4){
 // The edge's shared corner sign picks the local axis the cap rolls along.
 const M=k.wasm.Manifold,alongX=e[0][0]===e[1][0],sy=alongX?e[0][0]:e[0][1],[ha,hb]=half(k,n,G),[hx,hy]=alongX?[hb,ha]:[ha,hb],steps=6,parts:Manifold[]=[];
 const pt=(x:number,th:number,r:number)=>{const a=sy*(hy+r*Math.sin(th)),z=-R+r*Math.cos(th);return point(k.frames[n],alongX?[a,x,z]:[x,a,z]) as Vec3};
 const ring=(th:number)=>[-hx,hx].flatMap(x=>[pt(x,th,R),pt(x,th,R-w)]);
 for(let i=0;i<steps;i++)parts.push(M.hull([...ring(i/steps*Math.PI/2),...ring((i+1)/steps*Math.PI/2)]));
 const last=ring(Math.PI/2);parts.push(M.hull([...last,...last.map(p=>down(p,1))]));
 // Every arc step, since on a tilted key the arc reaches farthest in plan partway round.
 capFloors.push(Array.from({length:steps+1},(_,i)=>ring(i/steps*Math.PI/2)).flat().map(p=>[p[0],p[1]] as [number,number]));
 return M.union(parts);
}
let capFloors:[number,number][][]=[];
// Convex hull of loose 2D points (monotone chain). new CrossSection([pts]) treats
// the points as an outline, and its fill rule drops parts of a self-crossing one.
function hull2(ps:[number,number][]):[number,number][]{
 const s=[...ps].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),x=(o:number[],a:number[],b:number[])=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
 const half=(pts:[number,number][])=>{const h:[number,number][]=[];for(const p of pts){while(h.length>1&&x(h[h.length-2],h[h.length-1],p)<=0)h.pop();h.push(p)}h.pop();return h};
 return [...half(s),...half(s.reverse())];
}
// Debug: ?only=a,b keeps just the named Skeletyl parts; ?nocut=1 skips recutting keys.
const qp=typeof location==='undefined'?new URLSearchParams():new URLSearchParams(location.search),only=qp.get('only')?.split(',');
export let skelOutside:string[]=[];
export const noCut=qp.get('nocut')==='1';
function skeletyl(k:Kit){
 capFloors=[];const M=k.wasm.Manifold,CS=k.wasm.CrossSection,G=1.4,D=8,all:Manifold[]=[],tags:string[]=[];let tag='';
 // Plan outline of each column or thumb row with its rolled ends, for the tray ledge.
 const outlines:CrossSection[]=[],outline=(names:string[],caps:number)=>outlines.push(new CS([hull2([...names.flatMap(n=>corners(k,n,G)).map(p=>[p[0],p[1]] as [number,number]),...capFloors.slice(-caps).flat()])]));
 const parts={push:(...ms:Manifold[])=>{if(!only||only.includes(tag))for(const m of ms){all.push(m);tags.push(tag)}}};
 const floorOf=(ps:Vec3[])=>[...ps,...ps.map(p=>down(p,1))];
 for(const c of COLS){
  const col=ROWS.map(r=>`matrix_${c}_${r}`);tag='ladder';parts.push(ladder(k,col,G,D,[[1,0],[-1,0]]));
  // Column ends roll over in a quarter round, then drop to the tray.
  tag='cap';parts.push(endCap(k,col[0],edgeFacing(k,col[0],[0,1]),G),endCap(k,col[2],edgeFacing(k,col[2],[0,-1]),G));
  outline(col,2);
 }
 // Outer side wall with a slot.
 const pinky=ROWS.map(r=>`matrix_pinky_${r}`),side=pinky.flatMap(n=>strip(k,n,edgeFacing(k,n,[1,0]),-D+1,-D,G-2,G));
 let wall=M.hull(floorOf(side));
 const xs=side.map(p=>p[0]),ys=side.map(p=>p[1]),x=Math.max(...xs),y0=Math.min(...ys)+12,y1=Math.max(...ys)-12;
 wall=wall.subtract(M.hull([y0,y1].map(y=>M.cylinder(20,4.5,4.5,32,true).rotate([0,90,0]).translate([x,y,10]))));
 tag='outer';parts.push(wall);
 // Inner support: a solid wall under the inner column, joined to the thumb rows.
 const inner=ROWS.map(r=>`matrix_inner_${r}`);
 // Start from the skirt bottoms: the inner keys tilt, so their tiles hang past the plate edge.
 // A frame rather than a solid wall: a rounded opening under each key, posts
 // between keys where the column joins sit.
 let innerWall=M.hull(floorOf(inner.flatMap(n=>strip(k,n,edgeFacing(k,n,[-1,0]),-D,-D,G-1.2,G))));
 for(const n of inner){const e=edgeFacing(k,n,[-1,0]),[p,q]=[at(k,n,e[0][0],e[0][1]*.62,-D,G),at(k,n,e[1][0],e[1][1]*.62,-D,G)];
  innerWall=innerWall.subtract(roundedWindow(k,[[p[0],p[1],p[2]-4],[q[0],q[1],q[2]-4],[q[0],q[1],11],[p[0],p[1],11]],3.5,'x'));}
 tag='inner';parts.push(innerWall);
 const base3=thumbs(k).filter(n=>!n.startsWith('thumb_x'));
 tag='support';parts.push(M.hull(floorOf([...strip(k,'matrix_inner_bottom',edgeFacing(k,'matrix_inner_bottom',[0,-1]),-D,-D,G-1.2,G),...base3.flatMap(n=>strip(k,n,edgeFacing(k,n,[0,1]),-D,-D,G-1.2,G))].filter(p=>p[0]<-30))));
 // Thumb rows on a front gusset with a triangular window.
 for(const g of [thumbs(k).filter(n=>!n.startsWith('thumb_x')),thumbs(k).filter(n=>n.startsWith('thumb_x'))].filter(g=>g.length)){
  tag='tladder';parts.push(ladder(k,g,G,D,[[0,1],[0,-1]]));
  tag='tcap';if(g.length>1)parts.push(endCap(k,g[0],edgeFacing(k,g[0],toward(k,g[1],g[0])),G),endCap(k,g.at(-1)!,edgeFacing(k,g.at(-1)!,toward(k,g.at(-2)!,g.at(-1)!)),G));
  outline(g,g.length>1?2:0);
  const front=g.flatMap(n=>strip(k,n,edgeFacing(k,n,[0,-1]),-T,-T,G-2,G));
  let gusset=M.hull(floorOf(front));
  if(g.length>1){
   // Window follows the sloping top of the wall, 4 mm below it, above the rim.
   const a=g[0],b=g.at(-1)!,topAt=(n:string,t:number)=>{const e=edgeFacing(k,n,[0,-1]),p=at(k,n,e[0][0]*(1-t)+e[1][0]*t,e[0][1]*(1-t)+e[1][1]*t,-T,G-1);return p};
   const ta=topAt(a,.5),tb=topAt(b,.5),quad:Vec3[]=[[ta[0],ta[1],ta[2]-4],[tb[0],tb[1],tb[2]-4],[tb[0],tb[1],10],[ta[0],ta[1],10]];
   gusset=gusset.subtract(roundedWindow(k,quad,4,'y').intersect(M.hull(floorOf(front.map(p=>[p[0],p[1],p[2]-3] as Vec3)))));}
  tag='gusset';parts.push(gusset);
 }
 // Tray outline: convex outlines of the fingers, thumbs and the joins
 // between them (rolled ends included), rounded.
 const flat=(ps:Vec3[])=>ps.map(p=>[p[0],p[1]] as [number,number]);
 const fingers=COLS.flatMap(c=>ROWS.map(r=>`matrix_${c}_${r}`)),xt=thumbs(k).filter(n=>n.startsWith('thumb_x'));
 const near=(names:string[])=>capFloors.filter(c=>names.some(n=>{const e=k.frames[n].elements;return c.some(p=>Math.hypot(p[0]-e[12],p[1]-e[13])<24)})).flat();
 const blob=(names:string[])=>new CS([hull2([...flat(names.flatMap(n=>corners(k,n,G))),...near(names)])]);
 const groups:string[][]=[fingers,base3,['matrix_inner_bottom','matrix_index_bottom',...base3],...(xt.length?[xt,[...xt,'matrix_middle_bottom','matrix_index_bottom']]:[])];
 const fp=CS.union(groups.map(blob)).offset(3,'Round',2,32).offset(8,'Round',2,32).offset(-8,'Round',2,32);
 tag='rim';parts.push(fp.extrude(7).subtract(fp.offset(-3.5,'Round').extrude(9).translate([0,0,2])));
 // Ledge: a 2 mm floor above the removable base, from the rim in to 2 mm
 // under the column walls, so the case is one piece without the base.
 // Islands boxed in by columns, touching no rim, are dropped.
 const band=fp.subtract(fp.offset(-3.5,'Round'));
 tag='ledge';parts.push(CS.union(fp.offset(-1).subtract(CS.union(outlines).offset(-2,'Round')).decompose().filter(c=>c.intersect(band).area()>1)).extrude(4));
 // Check: anything outside the rim outline, other than the Cirque housing, is a defect.
 const inTray=fp.extrude(300).translate([0,0,-1]);
 skelOutside=all.flatMap((m,i)=>m.subtract(inTray).decompose().filter(p=>p.volume()>1).map(p=>{const b=p.boundingBox();return `${tags[i]} ${(p.volume()/1000).toFixed(2)}cm³ @ ${b.min.map((v,j)=>((v+b.max[j])/2).toFixed(0)).join(',')}`}));
 tag='cirque';parts.push(cirque(k));
 return M.union(all);
}
function machined(k:Kit){
 const M=k.wasm.Manifold,r=roof(k,26,6),fp=footprint(k,4,12).offset(-6,'Round',2,24).offset(6,'Round',2,24);
 const under=M.union(r.tris.map(t=>M.hull(t.flatMap(i=>[r.top[i],down(r.top[i],0)]))));
 let body=under.intersect(fp.extrude(200));
 body=body.subtract(under.translate([0,0,-4]).intersect(fp.offset(-2.5,'Round').extrude(200).translate([0,0,2.5])));
 for(const n of keys(k.frames)){const [hx,hy]=half(k,n,-.25);body=body.subtract(place(M.cube([hx*2,hy*2,60],true).translate([0,0,30]),k.frames[n]))}
 return M.union([body,plates(k),cirque(k)]);
}

export const variants:Variant[]=[
 {key:'skeletyl',name:'Skeletyl construction',
  blurb:'The Skeletyl\'s construction on the Rosebear key poses: each column is its own curved ladder of switch frames with side skirts, with slits between columns. Column ends roll over in a quarter round and drop into a low rim tray on a flat base. A framed wall under the inner column, with a rounded opening under each key, supports the column and joins the thumb rows. The outer side wall has a slot, and the thumb row sits on a front wall with a rounded window. A 2 mm floor ledge runs from the rim in under the column walls, so the case is one piece without the bottom plate.',
  build:k=>noCut?skeletyl(k):cutKeys(k,skeletyl(k))},
 {key:'soft-web',name:'Soft-edged webbed well',
  blurb:'The webbed well below, with every crease rounded: shallow folds become smooth curves, sharper edges keep a visible line with a small fillet. Flat faces stay flat.',
  build:k=>{const r=roof(k),base=footprint(k,3);return k.wasm.Manifold.union([soften(k,k.wasm.Manifold.union([web(k,r),plates(k),walls(k,r,1,3)]),40,.35,3),base.extrude(2).subtract(hexHoles(k,base,0,2)),cirque(k)])}},
 {key:'machined',name:'Machined tray',
  blurb:'Vertical walls on a plan outline with large rounded corners, cut off at the top by the faceted key surface, like a CNC-milled case: straight sides and round corners in plan, crisp planes on top. Keys sit in shallow pockets.',
  build:k=>machined(k)},
 {key:'pebble',name:'Pebble facets',
  blurb:'The faceted block with its facets blended: large flat faces remain, and the edges between them are rounded. Between the moulded shell and the sharp block.',
  build:k=>{
   // Trim the blend back to just above the key surface so keys are not buried.
   const M=k.wasm.Manifold,r=roof(k,26,8),cap=M.union(r.tris.map(t=>M.hull(t.flatMap(i=>[r.top[i],down(r.top[i],0)])))).translate([0,0,1.5]);
   return soften(k,soften(k,faceted(k,false),35,.5,3).intersect(cap),35,.3,1).add(cirque(k))}},
 {key:'dactyl',name:'Dactyl-Manuform webbed well',
  blurb:'Generic Dactyl-Manuform construction: separate switch plates joined by a faceted web through their corners, thin walls close to the key well, and a flat base with hexagonal cutouts.',
  build:k=>{const r=roof(k),base=footprint(k,3);return k.wasm.Manifold.union([web(k,r),plates(k),walls(k,r,1,3),base.extrude(2).subtract(hexHoles(k,base,0,2)),cirque(k)])}},
 {key:'ribs',name:'Column ribs',
  blurb:'Each key column sits on vertical ribs in the gaps between columns, running front to back and following the column\'s curve down to a flat base. The sides stay open, so the tile wiring is visible and reachable. The thumbs get front and back ribs of their own.',
  build:k=>{
   const M=k.wasm.Manifold,parts:Manifold[]=[plates(k,.7)];
   const rib=(chain:{n:string;dir:[number,number]}[][],w=1.6)=>{for(const seg of chain)for(let i=0;i+1<seg.length;i++){const ps=seg.slice(i,i+2).flatMap(({n,dir})=>edgeFacing(k,n,dir).flatMap(([sx,sy])=>[at(k,n,sx,sy,-T/2,.4),at(k,n,sx,sy,-T-w,.4)]));parts.push(M.hull([...ps,...ps.map(p=>down(p,0)),...ps.map(p=>down(p,2))]))}};
   for(let c=0;c<=COLS.length;c++){
    const seg:{n:string;dir:[number,number]}[]=[];
    for(const row of ROWS){if(c>0)seg.push({n:`matrix_${COLS[c-1]}_${row}`,dir:[1,0]});if(c<COLS.length)seg.push({n:`matrix_${COLS[c]}_${row}`,dir:[-1,0]})}
    rib([seg]);
   }
   const tg=[thumbs(k).filter(n=>!n.startsWith('thumb_x')),thumbs(k).filter(n=>n.startsWith('thumb_x'))].filter(g=>g.length);
   for(const g of tg)rib([g.map(n=>({n,dir:[0,-1] as [number,number]})),g.map(n=>({n,dir:[0,1] as [number,number]}))]);
   const base=footprint(k,4);parts.push(base.extrude(3).subtract(base.offset(-9,'Round').extrude(5).translate([0,0,-1])),cirque(k));
   return M.union(parts)}},
 {key:'faceted',name:'Faceted block',
  blurb:'One solid, flat-faceted body: the convex hull of the finger plates, of the thumb plates, and of a bridge between them, each down to a chamfered footprint. The keys sit in shallow pockets cut from the hull. Reads as a machined or low-poly object rather than a moulded one.',
  build:k=>faceted(k,true).add(cirque(k))},
 {key:'floating',name:'Floating plate on legs',
  blurb:'Only the webbed key surface, with no walls: a single curved plate held up by four slim tapered legs. The underside and wiring are fully open, the plate is the only large print, and the legs can be reprinted to change height and tenting.',
  build:k=>{
   const M=k.wasm.Manifold,r=roof(k),parts:Manifold[]=[web(k,r),plates(k)];
   const legs:[string,number,number][]=[['matrix_pinky_top',1,1],['matrix_pinky_bottom',1,-1],['matrix_inner_top',-1,1],['thumb_home',-1,-1]];
   for(const [n,sx,sy] of legs){const p=at(k,n,sx*.7,sy*.7,-T);parts.push(M.hull([M.cylinder(1,3,3,24).translate([p[0],p[1],p[2]-1]),M.cylinder(3,6,6,32).translate([p[0]+sx*4,p[1]+sy*4,0])]))}
   parts.push(cirque(k));return M.union(parts)}},
];
