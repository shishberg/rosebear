import json,unittest
from pathlib import Path
import pcbnew as pcb
from rosebear.pcb import finger,net,pad_of,bend_regions,vec
from rosebear import validate,routing
ROOT=Path(__file__).resolve().parents[2]

class MatrixOnlyTests(unittest.TestCase):
    def test_fingers_have_only_switches_diodes_and_matrix_connections(self):
        for seed in json.loads((ROOT/'output_v4/geometry.json').read_text())['fingers']:
            board,_=finger(ROOT,ROOT/'output_v4/geometry/seed',seed,'seeded')
            self.assertEqual(validate.validate({seed['id']:board}),[])
            extra=pcb.FOOTPRINT(board);extra.SetReference('CL1');board.Add(extra)
            self.assertTrue(validate.validate({seed['id']:board}))

    def test_paired_kerfs_protect_the_strip_between_them(self):
        seed={'strips':[{'cx':0,'half_w':9,'ext_e':0,'ext_w':0}],
              'cuts':[[{'x':-5,'y':y},{'x':5,'y':y+1}] for y in [0,4,24,28]]}
        regions=bend_regions(seed)
        self.assertEqual(regions,[[-9,0,9,5],[-9,24,9,29]])
        b=pcb.BOARD();via=pcb.PCB_VIA(b);via.SetPosition(vec(7,2.5));via.SetWidth(600000);via.SetDrill(300000);b.Add(via)
        self.assertTrue(routing.check_bends(b,regions))
