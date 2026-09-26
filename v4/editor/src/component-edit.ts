import {Vector3} from 'three';
import {clone,componentFrames,frame,type Project,type V3} from './geometry';
export const platformWeights:Record<string,number>={well_inner_front:1,well_inner_low:1,well_inner_upper:.35,thumb_join_outer:1,thumb_join_far:.5,thumb_outer_side:.25};
export function moveComponent(base:Project,target:string,delta:V3):Project{
 const p=clone(base),cfg=p.config,tent=frame([0,0,0],[0,cfg.geometry.tent_deg,0]),local=new Vector3(...delta).applyMatrix4(tent.invert()).toArray();
 if(target==='trackball_group'){
  for(const part of [cfg.trackball,cfg.adapter])part.position_mm=part.position_mm.map((x,i)=>x+local[i]);
  p.cage.positions_mm=p.cage.positions_mm.map((v,i)=>{const name=p.cage.control_ids[i].replace('top:',''),weight=name.startsWith('ball_')?1:platformWeights[name]??0;return v.map((x,j)=>x+delta[j]*weight) as V3});
 }else if(target==='thumb_cluster'){
  cfg.geometry.thumb.position_mm=cfg.geometry.thumb.position_mm.map((x,i)=>x+local[i]);
  p.cage.positions_mm=p.cage.positions_mm.map((v,i)=>p.cage.control_ids[i].startsWith('top:thumb_')&&p.cage.control_ids[i]!=='top:thumb_well_join'?v.map((x,j)=>x+delta[j]) as V3:v);
 }else{
  const nominal=componentFrames(cfg)[target];if(!nominal)throw Error('Unknown component');
  type Pose={name?:string;offset_mm?:number[];rotation_deg?:number[]};
  let pose:Pose;
  if(target.startsWith('thumb_'))pose=(cfg.geometry.thumb.keys as Pose[]).find(k=>'thumb_'+k.name===target)!;
  else{const overrides=cfg.geometry.key_overrides as Record<string,Pose>;pose=overrides[target]??(overrides[target]={})}
  if(!pose)throw Error('Unknown switch');
  const own=frame(pose.offset_mm,pose.rotation_deg),parent=nominal.clone().multiply(own.invert()),inverse=parent.invert();
  const world=new Vector3().setFromMatrixPosition(nominal).add(new Vector3(delta[0],delta[1],0));
  pose.offset_mm=world.applyMatrix4(inverse).toArray();
 }
 return p;
}
