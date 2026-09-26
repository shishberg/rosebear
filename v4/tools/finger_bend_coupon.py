"""Transverse serpentine construction coupon; not a released finger-board outline."""
import sys,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'v4'),str(ROOT/'output_v4/tools/python39')]
from rosebear.job_guard import guard_entry
guard_entry(ROOT,__file__)
import wx
wx.Log.SetLogLevel(wx.LOG_Error);app=wx.App(False)
import pcbnew as pcb
import numpy as np
from shapely.geometry import LineString,box
from shapely.ops import unary_union
from rosebear import pcb as p,finger_artifacts
out=ROOT/'output_v4/finger-bend-coupon';out.mkdir(parents=True,exist_ok=True)
# Four tangent quarter-circle turns, with long transverse legs. Units mm.
points=[(0.,0.),(19.,0.)]
def arc(cx,cy,r,a,b):
 for t in np.linspace(math.radians(a),math.radians(b),25)[1:]:points.append((cx+r*math.cos(t),cy+r*math.sin(t)))
arc(19,-3,3,90,0);arc(19,-3,3,0,-90)
points.append((7.,-6.));arc(7,-9,3,90,180);arc(7,-9,3,180,270)
points.append((26.,-12.))
line=LineString(points);width=3.6
shape=unary_union([line.buffer(width/2,resolution=24),box(-12,-5,0,5),box(26,-17,38,-7)])
if shape.geom_type!='Polygon' or len(shape.interiors):raise ValueError('Invalid coupon outline')
b=pcb.BOARD()
for i in range(8):
 n='TEST_'+str(i+1);offset=(i-3.5)*.305
 path=line.parallel_offset(abs(offset),'left' if offset>=0 else 'right',join_style=1,resolution=24)
 coords=list(path.coords)
 if math.dist(coords[0],points[0])>math.dist(coords[-1],points[0]):coords.reverse()
 p.track(b,[(float(x),float(-y)) for x,y in coords],'F.Cu',n,.135)
for i in range(8):
 n='TEST_'+str(i+1);offset=(i-3.5)*.305
 for ref,x,y in [('A',-8,(i-3.5)*1.2),('B',34,-12+(i-3.5)*1.2)]:
  fp=pcb.FOOTPRINT(b);fp.SetReference(ref+str(i+1));fp.SetValue('PROBE');fp.Reference().SetVisible(False);fp.Value().SetVisible(False);b.Add(fp)
  pad=pcb.PAD(fp);pad.SetNumber('1');pad.SetAttribute(pcb.PAD_ATTRIB_SMD);pad.SetShape(pcb.PAD_SHAPE_RECT)
  pad.SetSize(p.vec(2,.8));pad.SetPosition(p.vec(x,-y));layers=pcb.LSET();layers.AddLayer(pcb.F_Cu);layers.AddLayer(pcb.F_Mask);pad.SetLayerSet(layers);pad.SetNet(p.net(b,n));fp.Add(pad)
  p.track(b,[(x,-y),(0 if ref=='A' else 26,-(offset if ref=='A' else -12+offset))],'F.Cu',n,.135)
p.outline(b,[(x,-y) for x,y in list(shape.exterior.coords)[:-1]])
c=json.loads((ROOT/'v4/config.json').read_text());c['pcb_thickness_mm']=.6
path=out/'transverse-coupon.kicad_pcb';p.save(b,path,c,ROOT);check=p.drc(path)
(out/'report.json').write_text(json.dumps({'status':'construction experiment, not mechanical qualification','width_mm':width,'centerline_length_mm':line.length,'tab_offset_mm':[26,-12],'centerline':points,'drc':check},indent=2)+'\n')
print('DRC violations='+str(len(check['violations']))+' unconnected='+str(len(check['unconnected'])),flush=True)
if check['violations'] or check['unconnected']:sys.exit(1)
finger_artifacts.export(b,path,out/'fabrication')
(out/'fabrication/README.md').write_text('# Finger bridge construction coupon\n\n0.6 mm two-layer FR4 trial; eight 0.135 mm conductors on F.Cu at 0.305 mm pitch. Exposed endpoint fingers are for continuity probing. This is a separate experiment, not a replacement full finger board. Long legs run transverse to columns; the short returns still need twist. Compare with the existing bridge at equivalent installed end translation and rotation before adopting this topology. No validated strain limit is claimed.\n')
