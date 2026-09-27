// PROTOTYPE, throwaway: alternative chassis shapes for the right hand.
// Every variant uses the same key poses (componentFrames from the default
// config) so only the chassis differs. Visual comparison only: no clearance
// checks, no tile pockets, no wiring space, not printable as-is.
import type {Manifold,ManifoldToplevel,Vec3} from 'manifold-3d';
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
 const M=k.wasm.Manifold,f=k.frames.trackball;
 let pod=place(M.cylinder(7,22.5,22.5,64).translate([0,0,-6.5]).subtract(M.cylinder(2,20.4,20.4,64).translate([0,0,-.5])),f);
 if(link==='bracket'){
  const c=point(f,[0,0,-4]),near=['matrix_inner_home','matrix_inner_bottom','thumb_far'].flatMap(n=>corners(k,n)).sort((a,b)=>Math.hypot(a[0]-c[0],a[1]-c[1])-Math.hypot(b[0]-c[0],b[1]-c[1])).slice(0,2);
  const rim=near.map(p=>{const d=[p[0]-c[0],p[1]-c[1]],l=Math.hypot(d[0],d[1]);return point(f,[0,0,0]).map((v,i)=>i<2?c[i]+d[i]/l*20:c[2]) as Vec3});
  pod=pod.add(M.hull([...rim.flatMap(p=>[p,[p[0],p[1],p[2]-4] as Vec3]),...near.flatMap(p=>[[p[0],p[1],p[2]-T] as Vec3,[p[0],p[1],p[2]-T-4] as Vec3])]));
 }
 return pod;
}
export const cirquePad=(k:Kit)=>place(k.wasm.Manifold.cylinder(1,20,20,64).translate([0,0,-1.4]),k.frames.trackball);

export const variants:Variant[]=[
 {key:'skeletyl',name:'Skeletyl-style webbed well',
  blurb:'Dactyl-Manuform construction as used by the Bastard Keyboards Skeletyl: separate switch plates joined by a faceted web through their corners, thin walls hugging the key well, and a flat base with Voronoi-style cutouts (here hexagons). Uses the Rosebear layout, not the Skeletyl\'s own curvature and tenting.',
  build:k=>{const r=roof(k),base=footprint(k,3);return k.wasm.Manifold.union([web(k,r),plates(k),walls(k,r,1,3),base.extrude(2).subtract(hexHoles(k,base,0,2)),cirque(k)])}},
 {key:'ribs',name:'Column ribs',
  blurb:'Each key column sits on vertical ribs in the gaps between columns, running front to back and following the column\'s curve down to a flat base. The sides stay open, so the tile wiring is visible and reachable. The thumbs get front and back ribs of their own.',
  build:k=>{
   const M=k.wasm.Manifold,parts:Manifold[]=[plates(k,.7)];
   const rib=(chain:{n:string;dir:[number,number]}[][],w=1.6)=>{for(const seg of chain)for(let i=0;i+1<seg.length;i++){const ps=seg.slice(i,i+2).flatMap(({n,dir})=>edgeFacing(k,n,dir).flatMap(([sx,sy])=>[at(k,n,sx,sy,-T,.7),at(k,n,sx,sy,-T-w,.7)]));parts.push(M.hull([...ps,...ps.map(p=>down(p,0)),...ps.map(p=>down(p,2))]))}};
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
  build:k=>{
   const M=k.wasm.Manifold,CS=k.wasm.CrossSection,pts=(names:string[])=>names.flatMap(n=>corners(k,n,.5));
   // Convex lump over some keys, down to a chamfered foot.
   const lump=(names:string[])=>{const cs=CS.hull(names.map(n=>new CS([corners(k,n,1).map(p=>[p[0],p[1]] as [number,number])]))),ring=(d:number,z:number)=>cs.offset(d,'Miter').toPolygons().flat().map(([x,y])=>[x,y,z] as Vec3);return M.hull([...pts(names),...ring(2,0),...ring(4,4)])};
   const fingers=COLS.flatMap(c=>ROWS.map(r=>`matrix_${c}_${r}`)),base=thumbs(k).filter(n=>!n.startsWith('thumb_x')),extra=thumbs(k).filter(n=>n.startsWith('thumb_x'));
   let body=M.union([lump(fingers),lump(base),lump(['matrix_inner_bottom','matrix_index_bottom',...base]),...(extra.length?[lump(extra),lump([...extra,'matrix_middle_bottom','matrix_index_bottom'])]:[])]);
   for(const n of keys(k.frames)){const [hx,hy]=half(k,n,-.25);body=body.subtract(place(M.cube([hx*2,hy*2,60],true).translate([0,0,30]),k.frames[n])).subtract(place(M.cube([14,14,20],true),k.frames[n]))}
   return body.add(cirque(k));
  }},
 {key:'pedestals',name:'Pedestals',
  blurb:'Every key stands on its own vertical prism down to a shared base slab, with a gap between neighbours. The curve of the key well shows as a stepped skyline. Each pedestal can be hollow for its tile, and single keys could be reprinted at a different height.',
  build:k=>{
   const M=k.wasm.Manifold,parts:Manifold[]=[];
   for(const n of keys(k.frames)){const c=corners(k,n,.2),b=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>at(k,n,x,y,-T,.2));parts.push(M.hull([...c,...b,...c.map(p=>down(p,2))]).subtract(place(M.cube([14,14,T*4],true),k.frames[n])))}
   parts.push(footprint(k,4,10).extrude(3),cirque(k));
   return M.union(parts)}},
 {key:'floating',name:'Floating plate on legs',
  blurb:'Only the webbed key surface, with no walls: a single curved plate held up by four slim tapered legs. The underside and wiring are fully open, the plate is the only large print, and the legs can be reprinted to change height and tenting.',
  build:k=>{
   const M=k.wasm.Manifold,r=roof(k),parts:Manifold[]=[web(k,r),plates(k)];
   const legs:[string,number,number][]=[['matrix_pinky_top',1,1],['matrix_pinky_bottom',1,-1],['matrix_inner_top',-1,1],['thumb_home',-1,-1]];
   for(const [n,sx,sy] of legs){const p=at(k,n,sx*.7,sy*.7,-T);parts.push(M.hull([M.cylinder(1,3,3,24).translate([p[0],p[1],p[2]-1]),M.cylinder(3,6,6,32).translate([p[0]+sx*4,p[1]+sy*4,0])]))}
   parts.push(cirque(k));return M.union(parts)}},
];
