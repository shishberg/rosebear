import copy
import json
import math
import unittest
from pathlib import Path
from rosebear.mechanical import rotate, transform, well

ROOT=Path(__file__).resolve().parents[1]


class MechanicalTests(unittest.TestCase):
    def setUp(self):
        self.chassis=json.loads((ROOT/'mechanical/chassis.json').read_text())
        self.config=json.loads((ROOT/'config.json').read_text())

    def test_all_keys_exported_once(self):
        keys=self.chassis['keys']
        self.assertEqual(len(keys),18)
        self.assertEqual(len({k['id'] for k in keys}),18)
        self.assertEqual(len({(k['column'],k['row']) for k in keys}),18)

    def test_frames_are_orthonormal(self):
        for k in self.chassis['keys']:
            for i,a in enumerate(k['axes']):
                for j,b in enumerate(k['axes']):
                    self.assertAlmostEqual(sum(x*y for x,y in zip(a,b)),int(i==j),places=10)

    def test_thumb_keys_have_different_normals(self):
        ns=[k['axes'][2] for k in self.chassis['keys'] if k['column']=='thumb']
        for a,b in zip(ns,ns[1:]):
            self.assertGreater(math.dist(a,b),.01)

    def test_column_names_match_chassis_column_indices(self):
        w=well(self.chassis,self.config)
        self.assertEqual(w['columns'][0]['name'],'pinky')
        self.assertEqual(w['columns'][0]['along'],-6)
        self.assertEqual(w['columns'][0]['normal'],5)
        self.assertEqual(w['columns'][-1]['name'],'inner')
        self.assertEqual(w['columns'][-1]['along'],0)

    def test_pcb_depth_uses_plate_top_datum(self):
        self.assertAlmostEqual(well(self.chassis,self.config)['pcb_depth'],17.7)
        changed=copy.deepcopy(self.config); changed['plate_top_to_pcb_mm']+=1
        self.assertAlmostEqual(well(self.chassis,changed)['pcb_depth']-well(self.chassis,self.config)['pcb_depth'],1)

    def test_thumb_transform_order_matches_chassis(self):
        # TR uses [14,-15,10], then thumborigin + [-15,-10,5].
        # Plate placement applies local -90 degrees first; this must not rotate
        # the origin offset, and must not be approximated by an in-plane angle.
        k=next(k for k in self.chassis['keys'] if k['id']=='thumb_near')
        expected=rotate(rotate([1,0,0],[0,0,-90]),[14,-15,10])
        for actual,wanted in zip(k['axes'][0],expected): self.assertAlmostEqual(actual,wanted,places=10)

    def test_left_position_is_mirrored_right_position(self):
        k=self.chassis['keys'][0]
        r=transform(k,[2,3,4],'r'); l=transform(k,[2,3,4],'l')
        self.assertEqual(r,[-l[0],l[1],l[2]])

if __name__=='__main__':unittest.main()
