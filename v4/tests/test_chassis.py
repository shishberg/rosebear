"""Mechanical invariants for the individual-key chassis (no KiCad imports)."""
import copy
import json
from pathlib import Path
import unittest

import numpy as np
import manifold3d as mf
from shapely.geometry import Polygon, MultiPoint, Point
from rosebear.chassis import frame, cutout_warnings, box, key_seat, key_cuts, layout, make_hand, mesh, place, validate, keycap_size, tile_hardware, key_access_warnings
from rosebear.chassis_surface import WellSurface

CONFIG = Path(__file__).resolve().parents[1]/'chassis.json'


class ChassisTests(unittest.TestCase):
    def setUp(self):
        self.cfg = json.loads(CONFIG.read_text())

    def test_flat_well_has_exact_pitch_and_orthonormal_frames(self):
        g = self.cfg['geometry']; self.cfg['surface']['radii_mm'] = [None,None]
        for c in g['columns']: c['offset_mm'] = [0, 0, 0]
        keys, _ = layout(self.cfg)
        self.assertEqual(len(keys), 18)
        self.assertAlmostEqual(keys['matrix_middle_top'][1, 3]-keys['matrix_middle_home'][1, 3], g['row_pitch_mm'])
        self.assertAlmostEqual(keys['matrix_pinky_home'][0, 3]-keys['matrix_ring_home'][0, 3], g['column_pitch_mm'])
        for M in keys.values(): np.testing.assert_allclose(M[:3, :3].T@M[:3, :3], np.eye(3), atol=1e-12)

    def test_individual_key_override_is_local_and_does_not_move_neighbors(self):
        original, _ = layout(self.cfg); name = 'matrix_middle_home'
        self.cfg['geometry']['key_overrides'][name] = {'offset_mm': [1, 2, 3], 'rotation_deg': [0, 0, 7]}
        changed, _ = layout(self.cfg)
        np.testing.assert_allclose(changed[name][:3, 3], original[name][:3, 3]+original[name][:3, :3]@[1, 2, 3])
        for n in original:
            if n != name: np.testing.assert_array_equal(original[n], changed[n])

    def test_thumb_splay_preserves_flat_cluster(self):
        keys, _ = layout(self.cfg)
        normals = [M[:3, 2] for n, M in keys.items() if n.startswith('thumb')]
        for n in normals[1:]: np.testing.assert_allclose(n, normals[0])

    def test_finger_frames_follow_surface_points_and_normals(self):
        surface = WellSurface(self.cfg); keys,_ = layout(self.cfg)
        for name,M in keys.items():
            if not name.startswith('matrix_'): continue
            x,y,z = M[:3,3]
            self.assertAlmostEqual(z, float(surface.height(x,y)), places=8)
            dx,dy = surface.gradient(x,y); normal = np.array([-dx,-dy,1.])
            normal /= np.linalg.norm(normal)
            np.testing.assert_allclose(M[:3,2],normal,atol=1e-9)

    def test_well_does_not_depend_on_key_depth_or_stagger(self):
        before = WellSurface(self.cfg)
        changed = copy.deepcopy(self.cfg)
        changed['geometry']['columns'][0]['offset_mm'] = [3,9,7]
        changed['geometry']['key_overrides']['matrix_middle_top'] = {'offset_mm':[2,0,8]}
        changed['geometry']['row_pitch_mm'] += 3
        after = WellSurface(changed)
        for x,y in [(-80,-20),(-45,30),(0,0),(50,-30),(-20,-48)]:
            self.assertEqual(before.height(x,y),after.height(x,y))
        self.assertFalse(before.domain().equals(after.domain()))

    def test_outline_anchors_follow_thumb_and_accessory_moves(self):
        before=WellSurface(self.cfg).outline_points()
        controls=self.cfg['surface']['outline_controls']
        for group in ['thumb','trackball','adapter']:
            cfg=copy.deepcopy(self.cfg)
            item=cfg['geometry']['thumb'] if group=='thumb' else cfg[group]
            item['position_mm'][0]+=4;item['position_mm'][1]-=3
            after=WellSurface(cfg).outline_points()
            selected=[i for i,c in enumerate(controls) if (c['anchor'].startswith('thumb_') if group=='thumb' else c['anchor']==group)]
            self.assertGreater(len(selected),0)
            fixed=[i for i in selected if 'pcb_edge' not in controls[i]]
            if fixed: np.testing.assert_allclose(after[fixed]-before[fixed],np.tile([4,-3],(len(fixed),1)),atol=1e-6)
            # PCB-relative controls compensate for tenting and local surface
            # height; compare their world-space skirt to the actual PCB edge.
            keys,_=layout(cfg);tent=frame(angles=[0,cfg['geometry']['tent_deg'],0])
            surface=WellSurface(cfg)
            for i in selected:
                if 'pcb_edge' not in controls[i]: continue
                half=np.array(cfg['tile']['size_mm'][:2])/2
                xy=np.array(controls[i]['pcb_edge'])*(half+cfg['shell']['wall_mm']+cfg['surface']['thumb_wall_gap_mm'])
                pcb_z=-cfg['tile']['plate_top_to_pcb_top_mm']-cfg['tile']['size_mm'][2]/2
                target=tent@keys[controls[i]['anchor']]@np.r_[xy,pcb_z,1]
                x,y=after[i]; actual=tent@np.array([x,y,surface.height(x,y)-cfg['shell']['rim_radius_mm'],1])
                np.testing.assert_allclose(actual[:2],target[:2],atol=1e-6)

    def test_surface_has_requested_paraboloid_curvature(self):
        s = WellSurface(self.cfg); rx,ry = self.cfg['surface']['radii_mm']
        x,y = 20,15
        self.assertAlmostEqual(float(s.height(x,y)),x*x/(2*rx)+y*y/(2*ry),places=9)
        np.testing.assert_allclose(s.gradient(x,y),[x/rx,y/ry],atol=1e-8)

    def test_thumb_centres_share_arc_and_follow_configured_tilt(self):
        keys,_ = layout(self.cfg); t=self.cfg['geometry']['thumb']
        cluster=frame(t['position_mm'],t['rotation_deg'])
        pts=np.array([(np.linalg.inv(cluster)@keys['thumb_'+n])[:3,3] for n in ['far','home','near']])
        r=t['arc']['radius_mm']
        np.testing.assert_allclose(np.linalg.norm(pts[:,:2]+[0,r],axis=1),r,atol=1e-8)
        self.assertLess(np.linalg.norm(pts[1]-pts[0]),25)
        tent=frame(angles=[0,self.cfg['geometry']['tent_deg'],0])
        heights=[(tent@keys['thumb_'+n])[2,3] for n in ['far','home','near']]
        expected = tent @ cluster
        for i,name in enumerate(['far','home','near']):
            self.assertAlmostEqual(heights[i],(expected @ np.r_[pts[i],1])[2])

    def test_cutout_warnings_detect_missing_partial_and_shallow_cutters(self):
        body=box([30,30,3],[0,0,-1.5])
        self.assertEqual(cutout_warnings(body,frame(),[14,14],[-5,10],'test'),[])
        missed=cutout_warnings(body,frame([100,0,0]),[14,14],[-5,10],'test')
        self.assertEqual(missed[0]['kind'],'cutout_misses_shell')
        partial=cutout_warnings(body,frame([12,0,0]),[14,14],[-5,10],'test')
        self.assertEqual(partial[0]['kind'],'cutout_partial_intersection')
        shallow=cutout_warnings(body,frame(),[14,14],[-1,10],'test')
        self.assertEqual(shallow[0]['kind'],'cutout_depth')

    def test_centre_thumb_has_15u_cap_and_neighbor_clearance(self):
        cap = keycap_size(self.cfg, 'thumb_home')
        self.assertAlmostEqual(cap[0], 18+19.05/2)
        cluster = frame(self.cfg['geometry']['thumb']['position_mm'],self.cfg['geometry']['thumb']['rotation_deg'])
        home = layout(self.cfg)[0]['thumb_home']
        local = np.linalg.inv(cluster) @ home
        np.testing.assert_allclose(local[:3,0],[0,-1,0],atol=1e-9)
        keys, _ = layout(self.cfg)
        caps = []
        for n in ['thumb_near','thumb_home','thumb_far']:
            local = next(part for group,part in tile_hardware(self.cfg,n) if group == 'keycaps')
            caps.append(place(local,keys[n]))
        self.assertLess((caps[0]^caps[1]).volume(), .001)
        self.assertLess((caps[1]^caps[2]).volume(), .001)

    def test_centre_thumb_has_explicit_clearance_through_full_travel(self):
        shell,_,hardware,nodes,_=make_hand(self.cfg,'r')
        sw=self.cfg['switch']; size=keycap_size(self.cfg,'thumb_home')
        margin=sw['keycap_clearance_overrides_mm']['thumb_home']
        self.assertGreaterEqual(margin,2.5)
        bottom=sw['keycap_bottom_above_plate_mm']-sw['travel_mm']
        height=size[2]+sw['travel_mm']
        space=place(box([size[0]+2*margin,size[1]+2*margin,height],[0,0,bottom+height/2]),nodes['thumb_home'])
        self.assertLess((space ^ shell).volume(),.02)
        for group,name,part in hardware:
            if name!='thumb_home':self.assertLess((space ^ part).volume(),.02,name)

    def test_clip_lands_have_material_above_and_relief_below(self):
        solid = key_seat(self.cfg)-key_cuts(self.cfg); sw = self.cfg['switch']
        y = (sw['cutout_mm'][1]+sw['cutout_clearance_mm'])/2+.4
        for sign in [-1, 1]:
            above = box([.3, .3, .3], [0, sign*y, -.7])
            below = box([.3, .3, .3], [0, sign*y, -2.1])
            self.assertAlmostEqual((solid ^ above).volume(), .027, places=5)
            self.assertAlmostEqual((solid ^ below).volume(), 0, places=6)

    def test_default_meshes_and_retaining_tie_slots(self):
        for hand in ['r', 'l']:
            shell, base, hardware, nodes, placement = make_hand(self.cfg, hand)
            for solid in [shell, base]:
                m = mesh(solid)
                self.assertTrue(m.is_watertight)
                self.assertEqual(len(m.split()), 1)
                self.assertGreater(m.volume, 0)
            for group, name, part in hardware:
                self.assertLess((shell ^ part).volume(), .02, (hand, group, name))
            t = self.cfg['tile']; x = t['size_mm'][0]/2+t['clearance_mm']+t['support_width_mm']/2
            z = -t['plate_top_to_pcb_top_mm']-t['size_mm'][2]-.7
            for name, M in nodes.items():
                if not name.startswith(('matrix_', 'thumb_')): continue
                for sign in [-1, 1]:
                    probe = place(box([t['support_width_mm']+.4, 1, .4], [sign*x, t['retaining_tie_y_mm'], z]), M)
                    self.assertLess((shell ^ probe).volume(), .01, (hand, name, sign))

    def test_zero_and_increased_tenting_regenerate(self):
        for angle in [0, 25]:
            cfg = copy.deepcopy(self.cfg); cfg['geometry']['tent_deg'] = angle
            shell, base, _, _, _ = make_hand(cfg, 'r')
            m = mesh(shell)
            self.assertTrue(m.is_watertight)
            self.assertEqual(len(m.split()), 1)
            self.assertGreaterEqual(m.bounds[0, 2], cfg['shell']['base_thickness_mm']-1e-5)

    def test_trackball_variant_layouts_and_valid_shells(self):
        from rosebear.chassis_variants import comparison_configs
        variants=comparison_configs(self.cfg)
        self.assertEqual([v[0] for v in variants],['current','ffc_back','ffc_below'])
        self.assertEqual(variants[0][2],self.cfg)
        for name,_,cfg in variants[1:]:
            self.assertEqual(cfg['trackball']['rotation_deg'],[0,-30,0])
            self.assertGreater(cfg['trackball']['position_mm'][1],cfg['geometry']['thumb']['position_mm'][1])
            if name=='ffc_back':self.assertGreater(cfg['adapter']['position_mm'][1],cfg['trackball']['position_mm'][1])
            else:self.assertLess(cfg['adapter']['position_mm'][2],cfg['trackball']['position_mm'][2])
            shell,base,hardware,nodes,info=make_hand(cfg,'r')
            self.assertTrue(mesh(shell).is_watertight)
            self.assertEqual(len(mesh(shell).split()),1)
            self.assertEqual(info['fit_warnings'],[])
            self.assertEqual(key_access_warnings(shell,hardware),[])
            for group,label,part in hardware:self.assertLess((shell ^ part).volume(),.02,(name,label))

    def test_key_access_detects_overhead_roof_without_cap_collision(self):
        cap=box([18,18,9],[0,0,10])
        roof=box([6,8,2],[6,0,26])
        self.assertLess((roof ^ cap).volume(),.001)
        warnings=key_access_warnings(roof,[('keycaps','test_key',cap)])
        self.assertEqual([w['component'] for w in warnings],['test_key'])
        self.assertEqual(warnings[0]['kind'],'key_access')
        self.assertEqual(key_access_warnings(roof.translate([30,0,0]),[('keycaps','test_key',cap)]),[])

    def test_pcb_wall_reserve_detects_previous_tight_thumb_corner(self):
        from rosebear.chassis_variants import comparison_configs, anchored_outline
        cfg=comparison_configs(self.cfg)[2][2]
        xy=WellSurface(cfg).outline_points().tolist()
        xy[9]=[-10,-43];xy[10]=[-12,-62]
        anchored_outline(cfg,xy,[c['anchor'] for c in cfg['surface']['outline_controls']])
        _,_,_,_,info=make_hand(cfg,'r')
        self.assertTrue(any(w['kind']=='pcb_wall_clearance' and w['component']=='thumb_near'
                            for w in info['fit_warnings']))

    def test_thumb_wall_tracks_pcb_edges_in_every_arrangement(self):
        from rosebear.chassis_variants import comparison_configs
        probes=[('thumb_near',[0,-9.5]),('thumb_home',[9.5,0]),
                ('thumb_far',[0,-9.5]),('thumb_far',[-9.5,0])]
        for arrangement,_,cfg in comparison_configs(self.cfg):
            _,_,_,nodes,info=make_hand(cfg,'r')
            outline=Polygon(info['perimeter_xy_mm'])
            for name,xy in probes:
                p=nodes[name]@np.array([*xy,-5.8,1])
                gap=outline.exterior.distance(Point(p[:2]))-cfg['shell']['wall_mm']
                self.assertGreater(gap,1.4,(arrangement,name,gap))
                self.assertLess(gap,2.7,(arrangement,name,gap))
            self.assertFalse(any(w['kind']=='screw_ribbon_conflict' for w in info['fit_warnings']))

    def test_inner_ball_patch_ends_before_thumb_row(self):
        from rosebear.chassis_variants import comparison_configs
        for _,_,cfg in comparison_configs(self.cfg)[1:]:
            surface=WellSurface(cfg)
            unpatched=copy.deepcopy(cfg);del unpatched['surface']['trackball_patch']
            reference=WellSurface(unpatched)
            for x,y in [(-76,-49),(-66,-50),(-60,-49)]:
                self.assertAlmostEqual(float(surface.height(x,y)),float(reference.height(x,y)),places=8)
            for x,y in [(-76,-30),(-76,-42),(-72,-40)]:
                self.assertAlmostEqual(float(surface.height(x,y)),float(surface.plane(surface.ball,x,y)),places=8)

    def test_trackball_enclosure_detects_old_platform_breach(self):
        from rosebear.chassis_variants import comparison_configs
        cfg=comparison_configs(self.cfg)[2][2]
        cfg['surface']['trackball_patch']={'shape':'rounded_rectangle','margin_mm':0.,
            'corner_radius_mm':2.,'blend_mm':4.,'mesh_pitch_mm':1.}
        _,_,_,_,info=make_hand(cfg,'r')
        self.assertTrue(any(w['kind']=='trackball_wall_clearance' for w in info['fit_warnings']))

    def test_screw_check_detects_old_ribbon_landing_conflict(self):
        from rosebear.chassis_variants import comparison_configs
        cfg=comparison_configs(self.cfg)[2][2]
        cfg['shell']['fasteners_xy_mm'][3]=[-84,-40]
        _,_,_,_,info=make_hand(cfg,'r')
        self.assertTrue(any(w['kind']=='screw_ribbon_conflict' for w in info['fit_warnings']))

    def test_inner_layout_drops_unused_front_ball_rise(self):
        from rosebear.chassis_variants import comparison_configs
        for _,_,cfg in comparison_configs(self.cfg)[1:]:
            old=copy.deepcopy(cfg)
            old['surface']['palm_reference']={'position_mm':[5,-54,13],'rotation_deg':[0,0,90]}
            self.assertLess(WellSurface(cfg).height(-8,-43),WellSurface(old).height(-8,-43)-5)
            unrelieved=copy.deepcopy(cfg);del unrelieved['surface']['thumb_bridge_relief']
            self.assertAlmostEqual(float(WellSurface(unrelieved).height(-18,-38)-WellSurface(cfg).height(-18,-38)),4.)

    def test_invalid_clip_thickness_rejected(self):
        self.cfg['switch']['clip_land_thickness_mm'] = 10
        with self.assertRaises(ValueError): validate(self.cfg)

    def test_trackball_has_clearance_for_fingertip_above_ball(self):
        shell, _, hardware, nodes, _ = make_hand(self.cfg, 'r')
        # A 16 mm rounded fingertip overlapping the ball's crown. This is a
        # geometric access check, not a prediction of individual comfort.
        tb = self.cfg['trackball']
        crown = -tb['board_top_below_deck_mm']+tb['ball_center_above_board_mm']+tb['ball_diameter_mm']/2
        probe = place(mf.Manifold.sphere(8,32).translate([0,0,crown+7]),nodes['trackball'])
        self.assertLess((probe ^ shell).volume(), .01)
        for group, name, part in hardware:
            if group == 'keycaps': self.assertLess((probe ^ part).volume(), .01, name)

    def test_key_supports_do_not_project_through_curved_exterior(self):
        shell,_,_,nodes,info=make_hand(self.cfg,'r')
        pose=frame([0,0,info['lift_mm']],[0,self.cfg['geometry']['tent_deg'],0])
        envelope,_=WellSurface(self.cfg).body(pose,self.cfg['shell']['base_thickness_mm']+self.cfg['shell']['base_gap_mm'],filled=True)
        outside=shell-envelope
        for name,M in nodes.items():
            if name.startswith(('matrix_','thumb_')):
                region=place(box([24,24,13],[0,0,-4]),M)
                self.assertLess((outside ^ region).volume(),.01,name)

    def test_trackball_supports_stay_below_deck_and_tie_slots_remain_open(self):
        shell,_,_,nodes,info=make_hand(self.cfg,'r');tb=self.cfg['trackball']
        pose=frame([0,0,info['lift_mm']],[0,self.cfg['geometry']['tent_deg'],0])
        body,_=WellSurface(self.cfg).body(pose,self.cfg['shell']['base_thickness_mm']+self.cfg['shell']['base_gap_mm'])
        added=shell-body
        envelope,_=WellSurface(self.cfg).body(pose,self.cfg['shell']['base_thickness_mm']+self.cfg['shell']['base_gap_mm'],filled=True)
        external=shell-envelope
        for sign in [-1,1]:
            x=sign*(tb['board_mm'][0]/2+tb['clearance_mm']+.5)
            region=place(box([3,tb['board_mm'][1]+1,12],[x,0,-3]),nodes['trackball'])
            self.assertLess((external ^ region).volume(),.01)
            above=place(box([3,tb['board_mm'][1]+1,2.4],[x,0,-1.2]),nodes['trackball'])
            self.assertLess((added ^ above).volume(),.01)
            z=-tb['board_top_below_deck_mm']-tb['board_mm'][2]+.9
            slot=place(box([5.8,3,1.4],[x,0,z]),nodes['trackball'])
            self.assertLess((shell ^ slot).volume(),.01)

    def test_inner_ribbon_exit_and_no_exterior_protrusions(self):
        for hand, direction in [('r', -1), ('l', 1)]:
            shell, base, hardware, nodes, info = make_hand(self.cfg, hand)
            self.assertEqual(info['ribbon_outward_direction'], [direction, 0, 0])
            outline = Polygon(info['perimeter_xy_mm']).buffer(.02)
            self.assertTrue(outline.covers(MultiPoint(mesh(shell).vertices[:, :2])))
            tb = self.cfg['trackball']
            if hand == 'r':
                self.assertLess(nodes['trackball'][1, 3], nodes['matrix_middle_bottom'][1, 3])
                pcb = next(part for group,name,part in hardware if name == 'ICSH044A board envelope')
                M = nodes['trackball']; local = (mesh(pcb).vertices-M[:3,3])@M[:3,:3]
                self.assertAlmostEqual(local[:,2].max(), -tb['board_top_below_deck_mm'], places=5)


if __name__ == '__main__': unittest.main()
