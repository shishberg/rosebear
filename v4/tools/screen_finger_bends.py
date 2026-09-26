"""Bounded beam-mode screen of real legacy end frames and a transverse coupon."""
import sys,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'v4'),str(ROOT/'output_v4/tools/python39')]
import numpy as np
from rosebear.beam_review import solve

g=json.loads((ROOT/'output_v4/geometry.json').read_text());c=json.loads((ROOT/'v4/mechanical/chassis.json').read_text());config=json.loads((ROOT/'v4/config.json').read_text())
keys={k['id']:k for k in c['keys']};results=[]
for a,b in zip(g['fingers'][0]['strips'],g['fingers'][0]['strips'][1:]):
 span=b['cx']-b['half_w']-a['cx']-a['half_w'];r=span/4;climb=b['neck_y']-a['neck_y']
 straight=max(0,a['neck_len']-2*math.pi*r,abs(climb));up=(straight+climb)/2;down=(straight-climb)/2
 pts=[(0,0,0)]
 def arc(cx,cy,a0,a1):
  for t in np.linspace(math.radians(a0),math.radians(a1),17)[1:]:pts.append((cx+r*math.cos(t),cy+r*math.sin(t),0))
 arc(0,r,-90,0)
 if up>1e-8:pts.append((r,r+up,0))
 arc(2*r,r+up,180,0)
 if down>1e-8:pts.append((3*r,r+up-down,0))
 arc(4*r,r+up-down,180,270)
 ka=keys['matrix_'+a['column']+'_bottom'];kb=keys['matrix_'+b['column']+'_bottom']
 mirror=np.diag([-1,1,1]);local=np.diag([-1,1,1])
 A=mirror@np.array(ka['axes']).T@local;B=mirror@np.array(kb['axes']).T@local
 neutral=c['config']['plate_thickness']-config['plate_top_to_pcb_mm']-.3
 wa=mirror@np.array(ka['origin'])+A@np.array([a['half_w'],a['neck_y']-a['key_ys'][0],neutral])
 wb=mirror@np.array(kb['origin'])+B@np.array([-b['half_w'],b['neck_y']-b['key_ys'][0],neutral])
 R=A.T@B;t=math.acos(np.clip((np.trace(R)-1)/2,-1,1))
 rotation=t/(2*math.sin(t))*np.array([R[2,1]-R[1,2],R[0,2]-R[2,0],R[1,0]-R[0,1]])
 motion=np.r_[A.T@(wb-wa)-np.array(pts[-1]),rotation]
 result=solve(pts,motion,1.69,.6)
 results.append({'name':a['column']+' to '+b['column'],'kind':'existing finger bridge','end_motion_mm_radians':motion.tolist(),**result})
p=ROOT/'output_v4/finger-bend-coupon/report.json'
if p.exists():
 coupon=json.loads(p.read_text());pts=[[*p,0] for p in coupon['centerline']]
 for label,motion in [('Y rotation only',[0,0,0,0,math.radians(5),0]),('5 mm step and Y rotation',[0,0,5,0,math.radians(5),0])]:
  results.append({'name':'transverse coupon: '+label,'kind':'benchmark, different attachment locations from existing finger board','end_motion_mm_radians':motion,**solve(pts,motion,3.6,.6)})
out={'status':'mechanism screen only; no manufacturing acceptance threshold',
 'assumptions':{'E_MPa':20000,'G_MPa':8000,'material':'unqualified isotropic surrogate, not measured laminate properties','model':'small-displacement Euler-Bernoulli beam with Saint-Venant rectangular torsion approximation','excluded':['root notch stresses','copper/FR4 anisotropy and damage','large rotations','contact and chassis clearance','fatigue']},'results':results}
(ROOT/'output_v4/finger-bend-screen.json').write_text(json.dumps(out,indent=2)+'\n')
for r in results:print(r['name'],{k:round(r[k],3) for k in ['max_normal_strain_percent','torsion_shear_indicator_percent','max_node_rotation_deg']})
