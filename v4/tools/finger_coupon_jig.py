"""Print fixture for the transverse coupon's explicit combined-motion benchmark."""
import sys,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'output_v4/tools/python39'))
import trimesh
angle=math.radians(5)
# Exact mesh boolean of a base and two closed support blocks.
base=trimesh.creation.box([50,22,1]);base.apply_translation([13,-6,-5.5])
left=trimesh.creation.box([12,10,5]);left.apply_translation([-6,0,-2.5])
q=[(26,-17),(38,-17),(38,-7),(26,-7)]
v=[[x,y,z] for z in [-5,0] for x,y in q]
for i,(x,y) in enumerate(q):v[i+4]=[x,y,5-math.tan(angle)*(x-26)]
f=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]
right=trimesh.Trimesh(v,f,process=True)
mesh=trimesh.boolean.union([base,left,right],engine='manifold')
out=ROOT/'output_v4/finger-bend-coupon'
if not mesh.is_watertight:raise ValueError('Fixture has a nonmanifold edge')
mesh.export(out/'five-degree-five-mm-jig.stl')
(out/'jig.json').write_text(json.dumps({'watertight':True,'benchmark':'5 mm step and 5 degrees about Y','left_root':[0,0,0],'right_root':[26,-12,5],'right_surface_tilt_deg':5,'note':'PCB underside datums. Secure coupon end tabs with small clamps; do not glue or clamp the neck. This bench fixture is not a chassis fit assertion.'},indent=2)+'\n')
