// Chassis: Skeletyl-style construction with swept ends, built from the key poses.
// Each finger column is a ladder of switch plates with skirts down each side.
// Across the back and across the front of the columns runs one swept end: a
// quarter round swept along a smooth curve through the column ends, then a wall
// to the base. Round-bottomed slots part the columns down to half that wall's
// height. The thumb rows use the same construction, running left to right, and
// sit on front walls that follow their well. The whole case stands on a flat
// base plate cut to its own footprint. Terms:
//  plate      the square frame a switch clips into, T thick, the keycap plus
//             0.75 + G mm per side;
//  skirt      a thin wall hanging D below a plate edge;
//  ladder     a row of plates joined edge to edge, with skirts;
//  swept end  one quarter round swept along a curve through a row of keys' end
//             edges, then a wall to the base.
import type {Manifold,ManifoldToplevel,Vec3} from 'manifold-3d';
import {Matrix4} from 'three';
import {point,ROWS,type Config} from './geometry';

export const isKey=(name:string)=>name.startsWith('thumb_')||name.startsWith('matrix_');
export const capSize=(c:Config,n:string)=>((c.switch.keycap_overrides_mm as Record<string,number[]>)[n]||c.switch.keycap_mm) as Vec3;
export interface ChassisResult {body:Manifold;base:Manifold;pod:Manifold}
type Edge=[number,number][];
interface Curve {dm:[number,number];ax:[number,number];F:(a:number)=>number;corners:{a:number;f:number;z:number;c:number}[]}

export function buildChassis(wasm:ManifoldToplevel,cfg:Config,frames:Record<string,Matrix4>):ChassisResult{
 const M=wasm.Manifold,CS=wasm.CrossSection,ch=cfg.chassis,T=ch.plate_thickness_mm,G=ch.plate_margin_mm,D=ch.skirt_depth_mm,W=ch.wall_mm,R=ch.end_radius_mm,CUT=ch.end_cut_mm;
 const g=cfg.geometry,COLS=g.columns.map(c=>c.name),names=Object.keys(frames).filter(isKey);
 const byX=(ns:string[])=>ns.sort((a,b)=>frames[a].elements[12]-frames[b].elements[12]);
 const base3=byX(g.thumb.keys.map(k=>'thumb_'+k.name)),xt=byX(((g as {thumb_extra?:{keys:{name:string}[]}}).thumb_extra?.keys??[]).map(k=>'thumb_'+k.name));
 const half=(n:string,grow=0)=>{const c=capSize(cfg,n);return [c[0]/2+.75+grow,c[1]/2+.75+grow]};
 // World point on a key plate: sx,sy in -1..1 across the plate, z along the normal.
 const at=(n:string,sx:number,sy:number,z=0,grow=0):Vec3=>{const [hx,hy]=half(n,grow);return point(frames[n],[sx*hx,sy*hy,z])};
 const place=(m:Manifold,f:Matrix4)=>m.transform(f.elements as never);
 const down=(p:Vec3,z=0):Vec3=>[p[0],p[1],z];
 const floorOf=(ps:Vec3[])=>[...ps,...ps.map(p=>down(p,1))];
 // A keycap's travel envelope, as the clearance check builds it: the cap plus
 // its margin, from rest down by the travel.
 const capSweep=(n:string)=>{const z=capSize(cfg,n),s=cfg.switch,m=(s.keycap_clearance_overrides_mm as Record<string,number>)[n]??s.keycap_clearance_mm;
  return place(M.cube([z[0]+2*m,z[1]+2*m,z[2]+s.travel_mm],true).translate([0,0,s.keycap_bottom_above_plate_mm-s.travel_mm+(z[2]+s.travel_mm)/2]),frames[n])};
 // Plate edge facing a world XY direction, as two corner sign pairs.
 const edgeFacing=(n:string,dir:[number,number]):Edge=>{
  const m=frames[n].elements,edges:Edge[]=[[[1,-1],[1,1]],[[-1,-1],[-1,1]],[[-1,1],[1,1]],[[-1,-1],[1,-1]]];
  const score=(e:Edge)=>{const sx=(e[0][0]+e[1][0])/2,sy=(e[0][1]+e[1][1])/2;return (m[0]*sx+m[4]*sy)*dir[0]+(m[1]*sx+m[5]*sy)*dir[1]};
  return edges.reduce((a,b)=>score(b)>score(a)?b:a);
 };
 // Solid strip along a plate edge: z0..z1 along the normal, grown g0..g1 outward.
 const strip=(n:string,e:Edge,z0:number,z1:number,g0:number,g1:number):Vec3[]=>e.flatMap(([sx,sy])=>[z0,z1].flatMap(z=>[g0,g1].map(q=>at(n,sx,sy,z,q))));
 const toward=(a:string,b:string):[number,number]=>{const p=frames[a].elements,q=frames[b].elements;return [q[12]-p[12],q[13]-p[13]]};
 const ladder=(ns:string[],sides:[number,number][])=>{
  const parts:Manifold[]=[];
  for(const n of ns)parts.push(place(M.cube([half(n,G)[0]*2,half(n,G)[1]*2,T],true).translate([0,0,-T/2]),frames[n]));
  for(let i=0;i+1<ns.length;i++){const a=ns[i],b=ns[i+1];parts.push(M.hull([...strip(a,edgeFacing(a,toward(a,b)),0,-T,0,G),...strip(b,edgeFacing(b,toward(b,a)),0,-T,0,G)]))}
  // One flat skirt per key, so no twisted faces between keys at different angles.
  for(const d of sides)for(const n of ns)parts.push(M.hull(strip(n,edgeFacing(n,d),0,-D,G-1.2,G)));
  return M.union(parts);
 };
 // Opening through a wall facing roughly along world x or y, with rounded corners of radius r.
 const roundedWindow=(quad:Vec3[],r:number,axis:'x'|'y')=>{
  const c=[0,1,2].map(i=>quad.reduce((a,p)=>a+p[i],0)/quad.length);
  return M.hull(quad.map(p=>{const d=[c[0]-p[0],c[1]-p[1],c[2]-p[2]],l=Math.hypot(...d)||1,q=p.map((v,i)=>v+d[i]/l*r*1.2);
   return M.cylinder(60,r,r,32,true).rotate(axis==='x'?[0,90,0]:[90,0,0]).translate(q as Vec3)}));
 };
 const rollDir=(n:string,e:Edge):[number,number]=>{
  const alongX=e[0][0]===e[1][0],sy=alongX?e[0][0]:e[0][1],o=point(frames[n],[0,0,0]),a=point(frames[n],alongX?[sy,0,0]:[0,sy,0]),l=Math.hypot(a[0]-o[0],a[1]-o[1]);
  return [(a[0]-o[0])/l,(a[1]-o[1])/l];
 };
 // Smooth plan curve across the facing edges of a row of end keys, in axes dm
 // (the mean direction the ends face) and ax across it: f = F(a), a quadratic
 // least-squares fit through the end corners pushed out by R, then moved out
 // until it is at least R-CUT past every corner (so the plates reach CUT mm
 // into the quarter round).
 const curveThrough=(ends:string[],facing:[number,number]):Curve=>{
  const edges=ends.map(n=>edgeFacing(n,facing));
  const ds=ends.map((n,i)=>rollDir(n,edges[i])),s=ds.reduce((a,d)=>[a[0]+d[0],a[1]+d[1]],[0,0]),l=Math.hypot(s[0],s[1]);
  const dm:[number,number]=[s[0]/l,s[1]/l],ax:[number,number]=[-dm[1],dm[0]];
  const corners=ends.flatMap((n,c)=>edges[c].map(([sx,sy])=>{const p=at(n,sx,sy,0,G);return {a:p[0]*ax[0]+p[1]*ax[1],f:p[0]*dm[0]+p[1]*dm[1],z:p[2],c}}));
  // Normal equations for f+R = c0 + c1 a + c2 a^2.
  const S=(pa:number,pf=0)=>corners.reduce((t,q)=>t+q.a**pa*(pf?q.f+R:1),0),A=[[S(0),S(1),S(2)],[S(1),S(2),S(3)],[S(2),S(3),S(4)]],b=[S(0,1),S(1,1),S(2,1)];
  const det=(m:number[][])=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  // One key: its edge is square to the roll, so the curve is a straight line along it.
  const cf=ends.length<2?[S(0,1)/S(0),0,0]:[0,1,2].map(j=>det(A.map((r,i)=>r.map((v,jj)=>jj===j?b[i]:v)))/det(A));
  const F0=(a:number)=>cf[0]+cf[1]*a+cf[2]*a*a,shift=Math.max(0,...corners.map(q=>q.f+R-CUT-F0(q.a)));
  return {dm,ax,F:a=>F0(a)+shift,corners};
 };
 const P=(cv:Curve,a:number,f:number,z:number):Vec3=>[cv.ax[0]*a+cv.dm[0]*f,cv.ax[1]*a+cv.dm[1]*f,z];
 // Swept end: the quarter round's top follows the end keys' heights (linear
 // between corners). Each key's surface continues flat out to it. With slots,
 // round-bottomed slots part neighbouring keys down to half the wall height.
 const sweptEnd=(cv:Curve,ends:string[],facing:[number,number],slots:boolean)=>{
  const cs=[...cv.corners].sort((x,y)=>x.a-y.a),a0=cs[0].a,a1=cs.at(-1)!.a;
  const zs=(a:number)=>{for(let i=0;i+1<cs.length;i++)if(a<=cs[i+1].a){const t=(a-cs[i].a)/((cs[i+1].a-cs[i].a)||1);return cs[i].z*(1-t)+cs[i+1].z*t}return cs.at(-1)!.z};
  const as=[...new Set([...cs.map(q=>q.a),...Array.from({length:Math.ceil((a1-a0)/3)},(_,i)=>a0+i*3)])].sort((x,y)=>x-y);
  const prof=(a:number,th:number,r:number)=>P(cv,a,cv.F(a)-R+r*Math.sin(th),zs(a)-R+r*Math.cos(th));
  const sweep:Manifold[]=[];
  for(let i=0;i+1<as.length;i++){const [p,q]=[as[i],as[i+1]];
   for(let j=0;j<6;j++){const t0=j/6*Math.PI/2,t1=(j+1)/6*Math.PI/2;sweep.push(M.hull([p,q].flatMap(a=>[prof(a,t0,R),prof(a,t0,R-W),prof(a,t1,R),prof(a,t1,R-W)])))}
   sweep.push(M.hull([p,q].flatMap(a=>[prof(a,Math.PI/2,R),prof(a,Math.PI/2,R-W)]).flatMap(v=>[v,down(v,1)])))}
  // Flat continuation of each end key out to the swept end, 0.5 mm into it.
  ends.forEach((n,ci)=>{const ed=edgeFacing(n,facing),q=cv.corners.filter(x=>x.c===ci);
   sweep.push(M.hull([...ed.flatMap(([sx,sy])=>[at(n,sx,sy,0,G),at(n,sx,sy,-W,G)]),...q.flatMap(x=>[P(cv,x.a,cv.F(x.a)-R+.5,x.z),P(cv,x.a,cv.F(x.a)-R+.5,x.z-W)])]))});
  let end=M.union(sweep);
  if(slots)for(let ci=0;ci+1<ends.length;ci++){
   const side=(c:number,o:number)=>{const m=cv.corners.filter(x=>x.c===o).reduce((t,x)=>t+x.a/2,0);return cv.corners.filter(x=>x.c===c).sort((x,y)=>Math.abs(x.a-m)-Math.abs(y.a-m))[0]},l=side(ci,ci+1),r=side(ci+1,ci),am=(l.a+r.a)/2,hw=Math.max(1.5,Math.abs(r.a-l.a)/2);
   const zj=1+(Math.min(zs(l.a),zs(r.a))-R-1)/2,f0=Math.min(cv.F(l.a),cv.F(r.a))-R-.2,f1=Math.max(cv.F(l.a),cv.F(r.a))+3;
   // Round-bottomed slot: a cylinder along dm at the bottom, hulled with the top.
   const cyl=(f:number)=>M.sphere(hw,16).translate(P(cv,am,f,zj+hw));
   end=end.subtract(M.hull([cyl(f0),cyl(f1),...[f0,f1].flatMap(f=>[-hw,hw].map(da=>P(cv,am+da,f,120)))]));
  }
  return end;
 };
 const parts:Manifold[]=[];
 for(const c of COLS)parts.push(ladder(ROWS.map(r=>`matrix_${c}_${r}`),[[1,0],[-1,0]]));
 // Outer side wall under the pinky column, with a slot.
 const pinky=ROWS.map(r=>`matrix_${COLS.at(-1)}_${r}`),side=pinky.flatMap(n=>strip(n,edgeFacing(n,[1,0]),-D+1,-D,G-2,G));
 const xs=side.map(p=>p[0]),ys=side.map(p=>p[1]),x=Math.max(...xs),y0=Math.min(...ys)+12,y1=Math.max(...ys)-12;
 parts.push(M.hull(floorOf(side)).subtract(M.hull([y0,y1].map(y=>M.cylinder(20,4.5,4.5,32,true).rotate([0,90,0]).translate([x,y,10])))));
 // Inner wall under the inner column: a frame with a rounded opening under each
 // key. It starts from the skirt bottoms, since tilted keys hang past their plate.
 const inner=ROWS.map(r=>`matrix_${COLS[0]}_${r}`);
 let innerWall=M.hull(floorOf(inner.flatMap(n=>strip(n,edgeFacing(n,[-1,0]),-D,-D,G-1.2,G))));
 for(const n of inner){const e=edgeFacing(n,[-1,0]),[p,q]=[at(n,e[0][0],e[0][1]*.62,-D,G),at(n,e[1][0],e[1][1]*.62,-D,G)];
  innerWall=innerWall.subtract(roundedWindow([[p[0],p[1],p[2]-4],[q[0],q[1],q[2]-4],[q[0],q[1],11],[p[0],p[1],11]],3.5,'x'))}
 parts.push(innerWall);
 // Support joining the inner column to the thumb row, trimmed under the keycaps:
 // it rises from the thumb row to the inner column, into the travel of thumb
 // keycaps that overhang their plates.
 const ib=inner[2],support=M.hull(floorOf([...strip(ib,edgeFacing(ib,[0,-1]),-D,-D,G-1.2,G),...base3.flatMap(n=>strip(n,edgeFacing(n,[0,1]),-D,-D,G-1.2,G))].filter(p=>p[0]<-30)));
 parts.push(support.subtract(M.union([...base3,...inner].map(capSweep))));
 // Thumb rows: a ladder whose two ends roll over as swept ends, on a front wall
 // that follows the row's well, one piece per pair of neighbouring keys, with a
 // rounded window level with the lowest key's front edge, 4 mm below it.
 for(const row of [base3,xt].filter(r=>r.length)){
  parts.push(ladder(row,[[0,1],[0,-1]]));
  if(row.length>1)for(const [n,m] of [[row[0],row[1]],[row.at(-1)!,row.at(-2)!]]){const d=toward(m,n);parts.push(sweptEnd(curveThrough([n],d),[n],d,false))}
  const front=row.flatMap(n=>strip(n,edgeFacing(n,[0,-1]),-T,-T,G-2,G));
  let wall=row.length>1?M.union(row.slice(1).map((n,i)=>M.hull(floorOf([row[i],n].flatMap(q=>strip(q,edgeFacing(q,[0,-1]),-T,-T,G-2,G)))))):M.hull(floorOf(front));
  if(row.length>1){
   const topAt=(n:string)=>{const e=edgeFacing(n,[0,-1]);return at(n,(e[0][0]+e[1][0])/2,(e[0][1]+e[1][1])/2,-T,G-1)};
   const ta=topAt(row[0]),tb=topAt(row.at(-1)!),zl=Math.min(...row.map(n=>topAt(n)[2]));
   const quad:Vec3[]=[[ta[0],ta[1],zl-4],[tb[0],tb[1],zl-4],[tb[0],tb[1],10],[ta[0],ta[1],10]];
   wall=wall.subtract(roundedWindow(quad,4,'y').intersect(M.hull(floorOf(front.map(p=>[p[0],p[1],p[2]-3] as Vec3)))));
  }
  parts.push(wall);
 }
 // A thumb row close in front of the main one gets a back wall too, following
 // its well, and a low web joins that wall to the main row's front wall across
 // the few millimetres between them, up to half height.
 if(xt.length){
  const back=(n:string)=>strip(n,edgeFacing(n,[0,1]),-T,-T,G-2,G),a=base3.flatMap(n=>strip(n,edgeFacing(n,[0,-1]),-T,-T,G-2,G)),b=xt.flatMap(back);
  const d=(p:Vec3,ps:Vec3[])=>Math.min(...ps.map(q=>Math.hypot(p[0]-q[0],p[1]-q[1])));
  if(Math.min(...a.map(p=>d(p,b)))<15){
   parts.push(M.union(xt.length>1?xt.slice(1).map((n,i)=>M.hull(floorOf([...back(xt[i]),...back(n)]))):[M.hull(floorOf(b))]));
   // Only the facing stretches of the two walls, so the web stays narrow.
   const zj=1+(Math.min(...b.map(p=>p[2]))-1)/2,near=[...a.filter(p=>d(p,b)<15),...b.filter(p=>d(p,a)<15)];
   parts.push(M.hull(near.flatMap(p=>[[p[0],p[1],1],[p[0],p[1],zj]] as Vec3[])));
  }
 }
 // Swept ends across the back (e=0, top row) and front (e=1, bottom row) of the columns.
 for(const e of [0,1]){const ends=COLS.map(c=>`matrix_${c}_${e?'bottom':'top'}`),f:[number,number]=[0,e?-1:1];parts.push(sweptEnd(curveThrough(ends,f),ends,f,true))}
 // Tile pockets: the walls are hulls between keys at different heights, so their
 // tops can reach up under a tile. Clear the tile, its components and the switch
 // body under every key, below the plate.
 const tl=cfg.tile,sw=cfg.switch,tz=tl.plate_top_to_pcb_top_mm+tl.size_mm[2]+Math.max(0,...tl.components.map(c=>c.size_mm[2]/2-c.center_mm[2]))+tl.component_clearance_mm,tw=tl.size_mm[0]+2*tl.clearance_mm,th=tl.size_mm[1]+2*tl.clearance_mm,cw=sw.cutout_mm.map(x=>x+sw.cutout_clearance_mm);
 const pockets=M.union(names.flatMap(n=>[place(M.cube([tw,th,tz-T],true).translate([0,0,-(tz+T)/2]),frames[n]),place(M.cube([cw[0],cw[1],13-T],true).translate([0,0,-(13+T)/2]),frames[n])]));
 const walls=M.union(parts).subtract(pockets);
 // Base plate: the footprint of everything built, holes filled, so it is flush with the walls.
 const area=(p:[number,number][])=>p.reduce((t,q,i)=>{const r=p[(i+1)%p.length];return t+q[0]*r[1]-r[0]*q[1]},0);
 const plan=CS.union(walls.project().toPolygons().filter(p=>area(p as [number,number][])>0).map(p=>new CS([p])));
 const base=plan.extrude(ch.base_thickness_mm);
 const pod=trackpadPod(wasm,cfg,frames,at);
 let body=walls.add(pod);
 // Room above each plate for the keycap, and the switch hole.
 for(const n of names){const [hx,hy]=half(n,-.25);body=body.subtract(place(M.cube([14,14,20],true),frames[n])).subtract(place(M.cube([hx*2,hy*2,60],true).translate([0,0,30]),frames[n]))}
 return {body,base,pod};
}
// Cirque trackpad in a printed pod on the inner side, held by a bracket to the
// two corners of the far thumb key nearest to it. The bracket reaches below each
// corner along the key's own normal, 0.8 mm inside the plate edge, so it joins
// the key's skirt even on a tilted key.
function trackpadPod(wasm:ManifoldToplevel,cfg:Config,frames:Record<string,Matrix4>,at:(n:string,sx:number,sy:number,z?:number,grow?:number)=>Vec3){
 const M=wasm.Manifold,t=cfg.trackpad,f=frames.trackpad,r=t.diameter_mm/2+t.clearance_mm,ro=r+t.pod_wall_mm,T=cfg.chassis.plate_thickness_mm;
 // The pod's rim top is the frame's origin; the pad sits on the recess floor.
 const recess=t.thickness_mm+t.top_below_rim_mm;
 let pod=M.cylinder(t.pod_depth_mm,ro,ro,64).translate([0,0,-t.pod_depth_mm]).subtract(M.cylinder(recess+1,r,r,64).translate([0,0,-recess])).transform(f.elements as never);
 const c=point(f,[0,0,-4]),dist=(p:Vec3)=>Math.hypot(p[0]-c[0],p[1]-c[1]);
 const near=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sy])=>({sx,sy,p:at('thumb_far',sx,sy)})).sort((a,b)=>dist(a.p)-dist(b.p)).slice(0,2);
 const rim=near.map(({p})=>{const d=[p[0]-c[0],p[1]-c[1]],l=Math.hypot(d[0],d[1]);return [c[0]+d[0]/l*(ro-2.5),c[1]+d[1]/l*(ro-2.5),c[2]] as Vec3});
 return pod.add(M.hull([...rim.flatMap(p=>[p,[p[0],p[1],p[2]-4] as Vec3]),...near.flatMap(({sx,sy})=>[at('thumb_far',sx,sy,-T,.8),at('thumb_far',sx,sy,-T-4,.8)])]));
}
/** The trackpad itself, for display. */
export const trackpadPart=(wasm:ManifoldToplevel,cfg:Config,frames:Record<string,Matrix4>)=>{const t=cfg.trackpad;return wasm.Manifold.cylinder(t.thickness_mm,t.diameter_mm/2,t.diameter_mm/2,64).translate([0,0,-t.top_below_rim_mm-t.thickness_mm+.01]).transform(frames.trackpad.elements as never)};
