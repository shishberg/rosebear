import json,unittest
from pathlib import Path
import numpy as np
import pcbnew as pcb
from rosebear.pcb import thumb,xy,pad_of
from rosebear import rigid_thumb
from rosebear.thumb_geometry import folded,frame
ROOT=Path(__file__).resolve().parents[2]

class RigidThumbTests(unittest.TestCase):
    def test_all_positions_use_the_same_two_pad_zero_via_layout(self):
        universal=thumb(ROOT)
        def shape(b):return sorted((xy(t.GetStart()),xy(t.GetEnd()),t.GetLayer(),t.GetWidth()) for t in b.GetTracks())
        for h in ['l','r']:
            for key,row in [('near','BOTTOM'),('home','HOME'),('far','TOP')]:
                b=thumb(ROOT,h,key);fps={f.GetReference():f for f in b.GetFootprints()}
                self.assertEqual(set(fps),{'SW1','D1','W1','W2'})
                self.assertEqual(pad_of(fps['W1'],1).GetNetname(),'ROW_'+h.upper()+'_'+row)
                self.assertEqual(pad_of(fps['W2'],1).GetNetname(),'COL_'+h.upper()+'_THUMB')
                self.assertFalse(any(isinstance(t,pcb.PCB_VIA) for t in b.GetTracks()))
                self.assertEqual(shape(b),shape(universal))

    def test_tiles_follow_full_key_frames_without_any_bridges(self):
        config=json.loads((ROOT/'v4/config.json').read_text());chassis=json.loads((ROOT/'v4/mechanical/chassis.json').read_text())
        for hand in ['l','r']:
            boards={'thumb_'+hand+'_'+k:thumb(ROOT,hand,k) for k in ['near','home','far']}
            g=rigid_thumb.geometry(chassis,config,hand,boards)
            self.assertEqual(len(g['pieces']),3);self.assertTrue(all(p['kind']=='island' for p in g['pieces']))
            for key,pose in g['poses'].items():
                source=next(k for k in chassis['keys'] if k['id']=='thumb_'+key)
                o,R=frame(source,hand,chassis['config']['plate_thickness']-config['plate_top_to_pcb_mm'])
                points=np.array([[0,0],[5,-4],[-8,7]])
                actual=folded(g,key,points+pose['center'],config['thumb_pcb_thickness_mm']/2)
                np.testing.assert_allclose(actual,np.array([o+R@np.r_[p,0] for p in points]),atol=1e-9)
