import {Euler,Matrix4} from 'three';
import {platformWeights} from './component-edit';
import {clone,componentFrames,frame,point,type Project,type V3} from './geometry';
export const arrangements={baseline:'Original thumb / ball placement',tilt:'Thumbs tilted toward you 15°',shift:'Ball / FFC platform moved +Y 10 mm',both:'Thumb tilt + platform shift'};
export type Arrangement=keyof typeof arrangements;
export function arrangement(base:Project,id:Arrangement):Project{
 const p=clone(base);delete p.comparison;
 if(id==='baseline')return p;
 const before=componentFrames(base.config),thumb=p.config.geometry.thumb;
 if(id==='tilt'||id==='both'){
  // Rotate around world X: positive X points the normals toward the user (-Y).
  const tent=frame([0,0,0],[0,p.config.geometry.tent_deg,0]);
  const rotation=tent.clone().invert().multiply(new Matrix4().makeRotationX(Math.PI/12)).multiply(tent).multiply(frame([0,0,0],thumb.rotation_deg));
  const a=new Euler().setFromRotationMatrix(rotation,'ZYX');thumb.rotation_deg=[a.x,a.y,a.z].map(x=>x*180/Math.PI);
 }
 if(id==='shift'||id==='both')for(const part of [p.config.trackball,p.config.adapter])part.position_mm[1]+=10;
 const after=componentFrames(p.config),thumbMove=after.thumb_home.clone().multiply(before.thumb_home.clone().invert()),ballMove=after.trackball.clone().multiply(before.trackball.clone().invert());
 const lift=after.matrix_middle_home.elements[14]-before.matrix_middle_home.elements[14];
 // Move the shared well edge and wall junction with the platform as well.
 p.cage.positions_mm=p.cage.positions_mm.map((v,i)=>{
  const name=p.cage.control_ids[i],short=name.replace('top:','');
  if(name.startsWith('top:ball_'))return point(ballMove,v);
  const out=name.startsWith('top:thumb_')&&name!=='top:thumb_well_join'?point(thumbMove,v):[v[0],v[1],v[2]+lift] as V3;
  if(id==='shift'||id==='both')out[1]+=10*(platformWeights[short]??0);
  return out;
 });
 return p;
}
