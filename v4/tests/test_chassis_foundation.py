"""Subdivision/topology invariants, independent of manufacturing booleans."""
import copy
import json
from pathlib import Path
import unittest
import numpy as np
from rosebear.chassis_foundation import subdivision_matrix,refine,make_cage,evaluate_cage,topology_report,offset_shell,opening_shell
from rosebear.chassis_variants import comparison_configs

ROOT=Path(__file__).resolve().parents[1]

class FoundationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base=json.loads((ROOT/'chassis.json').read_text())
        cls.cfg=comparison_configs(cls.base)[2][2]
        cls.spec=json.loads((ROOT/'chassis-foundation.json').read_text())
        cls.result=make_cage(cls.cfg,cls.spec,'ffc_below')

    def test_subdivision_preserves_affine_positions(self):
        q=np.array([[0,1,2,3]])
        S,out=subdivision_matrix(q,4)
        np.testing.assert_allclose(np.asarray(S.sum(axis=1)).ravel(),1)
        points=np.array([[0.,0,0],[1,0,0],[1,1,0],[0,1,0]])
        offset=np.array([3,-4,7])
        np.testing.assert_allclose(S@(points+offset),S@points+offset)
        np.testing.assert_allclose((S@points)[0],[.125,.125,0])
        np.testing.assert_allclose((S@points)[4],[.5,.5,0])

    def test_full_surface_has_only_the_open_bottom_boundary(self):
        cage,v,q,tags,*_=self.result
        report=topology_report(v,q,tags)
        self.assertEqual(report['boundary_loops'],1)
        self.assertEqual(report['connected_components'],1)
        self.assertEqual(report['folded_top_quads'],0)
        self.assertLess(report['open_bottom_z_range_mm'],1e-9)
        self.assertFalse(report['thickness_generated'])

    def test_control_mesh_json_round_trip_is_exact(self):
        cage,v,q,tags,*_=self.result
        p,f,t=evaluate_cage(json.loads(json.dumps(cage)))
        np.testing.assert_allclose(v,p,atol=1e-12)
        np.testing.assert_array_equal(q,f)
        self.assertEqual(list(tags),list(t))

    def test_control_edit_changes_surface_without_changing_topology(self):
        cage,v,q,tags,*_=self.result
        edited=copy.deepcopy(cage);i=edited['control_ids'].index('top:well_middle_low')
        edited['positions_mm'][i][2]+=2
        p,f,t=evaluate_cage(edited)
        np.testing.assert_array_equal(f,q)
        delta=p[:,2]-v[:,2]
        self.assertGreater(delta.max(),.1)
        self.assertLessEqual(delta.max(),2)
        self.assertGreater(np.count_nonzero(delta),1)
        self.assertGreater(np.count_nonzero(delta==0),1)

    def test_legacy_height_patches_do_not_affect_new_surface(self):
        changed=copy.deepcopy(self.cfg)
        changed['surface']['trackball_patch']={'shape':'nonsense'}
        changed['surface']['thumb_bridge_relief']={'drop_mm':1000}
        changed['surface']['palm_reference']={'position_mm':[0,0,999],'rotation_deg':[0,0,0]}
        changed['surface']['outline_controls']=[]
        cage,*_=make_cage(changed,self.spec,'ffc_below')
        np.testing.assert_allclose(cage['positions_mm'],self.result[0]['positions_mm'],atol=1e-8)

    def test_primary_mount_samples_are_covered_with_bounded_height_error(self):
        cage,v,q,tags,nodes,targets,names,residual,missing=self.result
        self.assertEqual(missing,[])
        mount_errors=[abs(e) for name,e in zip(names,residual) if name!='adapter']
        self.assertLess(max(mount_errors),1.7)
        self.assertLess(np.sqrt(np.mean(np.square(mount_errors))),.4)
        self.assertGreater(min(e for name,e in zip(names,residual) if name=='adapter'),-.1)

    def test_cut_shell_is_connected_and_openings_are_clear(self):
        import manifold3d as mf
        from rosebear.chassis import box,place
        cage,v,q,tags,nodes,*_=self.result
        shell,report=opening_shell(self.cfg,self.spec,v,q,nodes,cage)
        self.assertTrue(shell.is_watertight)
        self.assertTrue(shell.is_winding_consistent)
        self.assertEqual(report['connected_components'],1)
        self.assertEqual(len(report['openings']),20)
        self.assertTrue(all(o['removed_volume_mm3']>0 for o in report['openings']))
        self.assertFalse(any(w['kind'].startswith('cutout_') for w in report['warnings']))
        body=mf.Manifold(mf.Mesh64(np.asarray(shell.vertices,dtype=np.float64),np.asarray(shell.faces,dtype=np.uint64)))
        # An interior probe along every actual mounting axis must be unobstructed.
        for name,M in nodes.items():
            if not name.startswith(('thumb_','matrix_')) and name!='trackball':continue
            probe=place(box([1,1,12],[0,0,0]),M)
            self.assertLess((body^probe).volume(),1e-6,name)
        # Known middle-thumb envelope interference must remain visible in the report.
        self.assertTrue(any(c['group']=='keycaps' and c['component']=='thumb_home' for c in report['hardware_overlaps']))
        self.assertFalse(report['minimum_thickness_certified'])

    def test_sparse_controls_are_not_a_hidden_dense_edit_grid(self):
        from rosebear.chassis_cage import expand_cage
        cage,*_=self.result
        self.assertEqual(cage['schema'],2)
        self.assertEqual(len(cage['control_ids']),38)
        self.assertTrue(all(key.startswith('top:') for key in cage['control_ids']))
        p,q,ids,tags=expand_cage(cage)
        self.assertEqual(len(p)-len(cage['control_ids']),66)
        # Editing an outline control also moves its derived wall: it is not a
        # second set of independently saved positions disguised by the viewer.
        edited=copy.deepcopy(cage);i=edited['control_ids'].index('top:thumb_outer_front')
        edited['positions_mm'][i][0]-=1
        p2,*_=expand_cage(edited)
        self.assertGreater(np.max(abs(p2[38:]-p[38:])),.1)

    def test_sparse_fairness_preserves_affine_planes(self):
        from rosebear.chassis_cage import fairness_rows
        cage,*_=self.result;xy=np.asarray(cage['positions_mm'])[:,:2]
        L=fairness_rows(xy)
        np.testing.assert_allclose(L@(3+xy[:,0]*.2-xy[:,1]*.4),0,atol=1e-10)

    def test_generated_wall_controls_cannot_be_overridden(self):
        spec=copy.deepcopy(self.spec);spec['overrides']={'ffc_below':{'side:0:000':[0,0,0]}}
        with self.assertRaisesRegex(ValueError,'Unknown control IDs'):make_cage(self.cfg,spec,'ffc_below')

    def test_bad_control_id_is_rejected(self):
        spec=copy.deepcopy(self.spec);spec['overrides']={'ffc_below':{'unknown':[0,0,0]}}
        with self.assertRaisesRegex(ValueError,'Unknown control IDs'):make_cage(self.cfg,spec,'ffc_below')

if __name__=='__main__':unittest.main()
