import json,unittest
from pathlib import Path
import numpy as np
from rosebear import thumb_geometry
ROOT=Path(__file__).resolve().parents[2]

class ConnectedThumbGeometry(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c=json.loads((ROOT/'v4/config.json').read_text());cls.s=json.loads((ROOT/'v4/thumb_cluster.json').read_text());cls.ch=json.loads((ROOT/'v4'/cls.c['chassis']).read_text())
    def test_finite_radius_returns_actual_key_frames(self):
        for hand in ['l','r']:
            g=thumb_geometry.build(self.ch,self.c,self.s,hand)
            for name,p in g['poses'].items():
                flat=np.array(g['islands'][name].exterior.coords[:-1]);local=(flat-p['center'])@p['rotation']
                expected=np.array([p['world_origin']+p['world_axes']@np.r_[v,0] for v in local])
                np.testing.assert_allclose(thumb_geometry.folded(g,name,flat),expected,atol=1e-8)
    def test_one_outline_and_constant_length_bends(self):
        for hand in ['l','r']:
            g=thumb_geometry.build(self.ch,self.c,self.s,hand)
            self.assertEqual(g['outline'].geom_type,'Polygon');self.assertTrue(g['outline'].is_valid)
            for name,h in g['hinges'].items():
                self.assertGreaterEqual(h['radius'],10)
                self.assertAlmostEqual(h['arc_length'],h['radius']*abs(h['angle']))
                start=h['center']-h['tangent_setback']*h['normal']
                pp=np.array([start+t*h['arc_length']*h['normal'] for t in np.linspace(0,1,101)])
                for fraction in [0,.5,1]:
                    folded=thumb_geometry.folded(g,name,pp,kind='bend',fraction=fraction)
                    self.assertAlmostEqual(float(np.linalg.norm(np.diff(folded,axis=0),axis=1).sum()),h['arc_length'],places=5)
    def test_stiffener_seating_datum(self):
        g=thumb_geometry.build(self.ch,self.c,self.s,'r')
        top=g['neutral_z']+self.s['flex_thickness_mm']/2+self.s['stiffener_thickness_mm']
        self.assertAlmostEqual(top,self.ch['config']['plate_thickness']-self.c['plate_top_to_pcb_mm'])
    def test_bridge_avoids_other_key_islands(self):
        for hand in ['l','r']:
            g=thumb_geometry.build(self.ch,self.c,self.s,hand)
            for p in g['pieces']:
                if p['kind']=='island':continue
                for name,island in g['islands'].items():
                    if name==p['owner']:continue
                    self.assertLess(p['polygon'].intersection(island).area,.001,(hand,p['kind'],p['owner'],name))
    def test_loaded_boards_survive_new_native_board(self):
        import tempfile,pcbnew as pcb
        from rosebear.pcb import outline,save,load_board
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'ownership.kicad_pcb';original=pcb.BOARD()
            outline(original,[(0,0),(10,0),(10,10),(0,10)]);save(original,path,self.c,ROOT)
            first=load_board(path);second=load_board(path);unrelated=pcb.BOARD()
            self.assertGreater(first.GetBoardEdgesBoundingBox().GetWidth(),0)
            self.assertEqual(first.GetBoardEdgesBoundingBox().GetWidth(),second.GetBoardEdgesBoundingBox().GetWidth())

    def test_cached_boards_obey_electrical_and_flex_contracts(self):
        import pcbnew as pcb
        from rosebear import thumb_pcb,thumb_checks,route_cache
        cfg={**self.c,'rules':self.s['rules'],'pcb_thickness_mm':self.s['flex_thickness_mm']}
        for hand in ['l','r']:
            g=thumb_geometry.build(self.ch,self.c,self.s,hand);board=thumb_pcb.make(ROOT,g)
            import tempfile
            from rosebear.pcb import load_board,save
            with tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/'thumb.kicad_pcb';save(board,path,cfg,ROOT);board=load_board(str(path))
            route_cache.replace(board,cfg,ROOT/'v4/routes'/('thumb_'+hand+'.json'))
            self.assertEqual(thumb_checks.validate(board,g),[])
            # A wrong diode assignment must fail independently of routing.
            diode=next(f for f in board.GetFootprints() if f.GetReference()=='D1')
            from rosebear.pcb import pad_of,net
            pad_of(diode,1).SetNet(net(board,'WRONG_ROW'))
            self.assertIn('diode pinout near',thumb_checks.validate(board,g))
if __name__=='__main__':unittest.main()
