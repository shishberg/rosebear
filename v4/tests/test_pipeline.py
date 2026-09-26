import copy
import json
import tempfile
import unittest
from pathlib import Path
import pcbnew as pcb
from rosebear import trackball, route_cache, seed, validate, routing, assembly
from rosebear.pcb import load_board, pad_of, net, vec
ROOT=Path(__file__).resolve().parents[2]

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.config=json.loads((ROOT/'v4/config.json').read_text())

    def test_route_cache_matches_and_rejects_moved_sensor(self):
        board=trackball.make(ROOT,self.config)
        route_cache.apply(board,self.config,ROOT/'v4/routes/trackball.json')
        self.assertEqual(sum(isinstance(t,pcb.PCB_VIA) for t in board.GetTracks()),3)
        sensor=next(f for f in board.GetFootprints() if f.GetReference()=='U1')
        sensor.Move(vec(.1,0))
        with self.assertRaisesRegex(ValueError,'placement/rules changed'):
            route_cache.apply(board,self.config,ROOT/'v4/routes/trackball.json')

    def test_route_cache_rejects_rule_change(self):
        changed=copy.deepcopy(self.config); changed['rules']['clearance_mm']=.2
        with self.assertRaises(ValueError):
            route_cache.apply(trackball.make(ROOT,changed),changed,ROOT/'v4/routes/trackball.json')

    def test_staging_override_fails_on_missing_or_duplicate_function(self):
        for text in ['','foo foo']:
            with self.assertRaises(ValueError): seed.replace_once('foo','bar',text)

    def test_wrong_sensor_pinout_is_rejected(self):
        b=trackball.make(ROOT,self.config)
        pod=load_board(str(ROOT/'output_v4/seeded/pod.kicad_pcb'))
        self.assertEqual(validate.validate({'trackball':b,'pod':pod}),[])
        sensor=next(f for f in b.GetFootprints() if f.GetReference()=='U1')
        pad_of(sensor,2).SetNet(net(b,'GND'))
        self.assertIn('DRV5033 pinout mismatch U1',validate.validate({'trackball':b,'pod':pod}))

    def test_via_touching_bend_is_rejected(self):
        b=pcb.BOARD(); v=pcb.PCB_VIA(b); v.SetPosition(vec(1.2,0)); v.SetWidth(600000); v.SetDrill(300000); v.SetLayerPair(pcb.F_Cu,pcb.B_Cu); b.Add(v)
        self.assertTrue(routing.check_bends(b,[[-1,-1,1,1]]))

    def test_collision_detection_handles_rotated_bodies(self):
        a={'frame':{'origin':[0,0,0],'axes':[[1,0,0],[0,1,0],[0,0,1]]}}
        a['corners']=assembly.box_corners(a['frame'],[-1,-1,-1,1,1,1])
        b=copy.deepcopy(a); b['frame']['origin']=[1,0,0]
        b['corners']=assembly.box_corners(b['frame'],[-1,-1,-1,1,1,1])
        self.assertTrue(assembly.boxes_intersect(a,b))
        b['frame']['origin']=[3,0,0]; b['corners']=assembly.box_corners(b['frame'],[-1,-1,-1,1,1,1])
        self.assertFalse(assembly.boxes_intersect(a,b))

    def test_trackball_carrier_clears_keycaps_and_old_placement_does_not(self):
        from rosebear.mount import carrier_cap_hits
        chassis=json.loads((ROOT/'v4/mechanical/chassis.json').read_text())
        home=next(k for k in chassis['keys'] if k['id']=='thumb_home')
        anchor=assembly.board_frame(home,'r',chassis['config']['plate_thickness']-self.config['plate_top_to_pcb_mm'])
        def frame(offset): return {'origin':assembly.world(anchor,offset),'axes':anchor['axes']}
        bounds=[-16,-13,-5,16,13,7]
        self.assertIn('thumb_far',carrier_cap_hits(chassis,frame([0,-28,7]),bounds))
        self.assertEqual(carrier_cap_hits(chassis,frame(self.config['trackball']['offset_mm']),bounds),[])

    def test_geometry_cache_invalidates_config_change(self):
        chassis=json.loads((ROOT/'v4/mechanical/chassis.json').read_text())
        seed.verify_cache(ROOT,ROOT/'output_v4',chassis,self.config)
        changed=copy.deepcopy(self.config); changed['plate_top_to_pcb_mm']+=.1
        with self.assertRaisesRegex(ValueError,'Stale geometry'):
            seed.verify_cache(ROOT,ROOT/'output_v4',chassis,changed)
