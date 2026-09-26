import {Matrix4,Vector3} from 'three';
import {componentFrames,expand,refine,type Project} from './geometry';

let cachedKey='',cachedFrames:Record<string,Matrix4>|undefined;
const copyFrames=(frames:Record<string,Matrix4>)=>Object.fromEntries(Object.entries(frames).map(([name,m])=>[name,m.clone()]));

/** The layout fixes world XY and in-plane heading. The uncut roof supplies Z
 * and the normal. Seats and every part of a switch assembly use this same pose.
 * Trackball/FFC retain their explicit assembly poses. */
export function mountedFrames(project:Project):Record<string,Matrix4>{
 const key=JSON.stringify([project.cage,project.config]);if(key===cachedKey&&cachedFrames)return copyFrames(cachedFrames);
 const frames=componentFrames(project.config),surface=refine(expand(project.cage),project.cage.subdivisions);
 const tri:number[]=[];
 surface.quads.forEach((q,i)=>{if(surface.tags[i]==='top')tri.push(q[0],q[1],q[2],q[0],q[2],q[3])});
 // Only roof normals are needed. Vertices on the lower wall have no incident
 // roof triangles, so accumulate here rather than normalising unused vertices.
 const ns=surface.positions.map(()=>new Vector3()),a=new Vector3(),b=new Vector3(),c=new Vector3();
 for(let i=0;i<tri.length;i+=3){a.fromArray(surface.positions[tri[i]]);b.fromArray(surface.positions[tri[i+1]]).sub(a);c.fromArray(surface.positions[tri[i+2]]).sub(a);b.cross(c);for(let j=0;j<3;j++)ns[tri[i+j]].add(b)}
 ns.forEach(n=>n.normalize());
 for(const [name,frame] of Object.entries(frames)){
  if(!name.startsWith('matrix_')&&!name.startsWith('thumb_'))continue;
  const x=frame.elements[12],y=frame.elements[13];let hit:{z:number;normal:Vector3}|undefined;
  for(let i=0;i<tri.length;i+=3){
   const ids=tri.slice(i,i+3),[p,q,r]=ids.map(j=>surface.positions[j]);
   const determinant=(q[1]-r[1])*(p[0]-r[0])+(r[0]-q[0])*(p[1]-r[1]);if(Math.abs(determinant)<1e-12)continue;
   const u=((q[1]-r[1])*(x-r[0])+(r[0]-q[0])*(y-r[1]))/determinant,v=((r[1]-p[1])*(x-r[0])+(p[0]-r[0])*(y-r[1]))/determinant,w=1-u-v;
   if(Math.min(u,v,w)<-1e-7)continue;
   const z=u*p[2]+v*q[2]+w*r[2];
   if(hit&&Math.abs(hit.z-z)>.01)throw Error(`${name}: roof overlaps itself at this key position.`);
   hit={z,normal:ns[ids[0]].clone().multiplyScalar(u).addScaledVector(ns[ids[1]],v).addScaledVector(ns[ids[2]],w).normalize()};
  }
  if(!hit)throw Error(`${name}: key position is outside the roof. Move the wall outward or move the key layout inward.`);
  const n=hit.normal;if(n.z<.15)throw Error(`${name}: mounting surface is too steep or folded.`);
  // Preserve plan-view heading, including the middle thumb's 90° rotation.
  const across=new Vector3(frame.elements[0],frame.elements[1],0);across.z=-(n.x*across.x+n.y*across.y)/n.z;across.normalize();
  frames[name]=new Matrix4().makeBasis(across,new Vector3().crossVectors(n,across).normalize(),n).setPosition(x,y,hit.z);
 }
 cachedKey=key;cachedFrames=copyFrames(frames);return frames;
}
