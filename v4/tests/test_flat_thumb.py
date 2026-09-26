import json,unittest
from pathlib import Path
import numpy as np
from rosebear import flat_thumb,beam_review
ROOT=Path(__file__).resolve().parents[2]
class FlatThumbTests(unittest.TestCase):
 def test_shared_plane_and_spacing(self):
  s=flat_thumb.spec(ROOT);c=json.loads((ROOT/'v4/mechanical/chassis.json').read_text());out=flat_thumb.chassis_layout(c,s)
  keys=[k for k in out['keys'] if k['column']=='thumb'];o=np.array(out['flat_thumb']['origin']);normal=np.array(out['flat_thumb']['axes'][2])
  for k in keys:
   self.assertAlmostEqual(np.dot(np.array(k['origin'])-o,normal),0,places=9)
   np.testing.assert_allclose(k['axes'][2],normal,atol=1e-9)
  self.assertNotEqual(c['keys'],out['keys'])
 def test_in_plane_yaw_preserves_normal(self):
  s=flat_thumb.spec(ROOT);s['keys'][0]['yaw_deg']=12
  c=json.loads((ROOT/'v4/mechanical/chassis.json').read_text());out=flat_thumb.chassis_layout(c,s)
  k=next(k for k in out['keys'] if k['id']=='thumb_near')
  np.testing.assert_allclose(k['axes'][2],out['flat_thumb']['axes'][2],atol=1e-9)
class BeamScreenTests(unittest.TestCase):
 def test_guided_straight_beam_matches_analytic_bending(self):
  length=40.;thickness=.6;step=.2
  r=beam_review.solve([[x,0,0] for x in np.linspace(0,length,11)],[0,0,step,0,0,0],1.7,thickness)
  self.assertAlmostEqual(r['max_normal_strain_percent'],3*thickness*step/length**2*100,places=7)
 def test_pure_twist_does_not_report_bending(self):
  r=beam_review.solve([[x,0,0] for x in np.linspace(0,40,11)],[0,0,0,.01,0,0],1.7,.6)
  self.assertLess(r['max_normal_strain_percent'],1e-8)
  self.assertGreater(r['torsion_shear_indicator_percent'],0)
