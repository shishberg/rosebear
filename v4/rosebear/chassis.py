"""Parametric, millimetre-native manifold solids for handwired MX key tiles.

Plate top is local Z=0. X points toward the pinky on the right hand; Y
points away from the palm. Euler rotations apply X, then Y, then Z.
No geometry or source code from Skeletyl is imported.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
import zipfile

import manifold3d as mf
import numpy as np
import trimesh
from shapely.geometry import Polygon, Point, LineString, MultiPoint
from shapely.ops import unary_union, nearest_points


def rotation(degrees):
    x, y, z = np.radians(degrees)
    cx, cy, cz = np.cos([x, y, z]); sx, sy, sz = np.sin([x, y, z])
    return np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]) @ np.array(
        [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]) @ np.array(
        [[1, 0, 0], [0, cx, -sx], [0, sx, cx]])


def frame(origin=(0, 0, 0), angles=(0, 0, 0)):
    M = np.eye(4); M[:3, :3] = rotation(angles); M[:3, 3] = origin
    return M


def points(M, p):
    return np.asarray(p) @ M[:3, :3].T + M[:3, 3]


def place(solid, M):
    return solid.transform(M[:3, :])


def box(size, center=(0, 0, 0)):
    return mf.Manifold.cube(size, True).translate(center)


def rounded_box(size, center=(0, 0, 0), radius=1):
    x, y, z = size
    r = min(radius, x/2-.01, y/2-.01)
    return hull([cylinder(r, -z/2, z/2, [sx*(x/2-r), sy*(y/2-r)])
                 for sx in [-1, 1] for sy in [-1, 1]]).translate(center)


def cylinder(radius, z0, z1, xy=(0, 0)):
    return mf.Manifold.cylinder(z1-z0, radius, radius, 24).translate([*xy, z0])


def union(solids):
    return mf.Manifold.batch_boolean(solids, mf.OpType.Add) if solids else mf.Manifold()


def hull(solids):
    return mf.Manifold.batch_hull(solids)


def mesh(solid):
    raw = solid.to_mesh64()
    result = trimesh.Trimesh(vertices=np.asarray(raw.vert_properties)[:, :3],
                            faces=np.asarray(raw.tri_verts), process=True)
    # Coincident boolean vertices can merge into a collapsed triangle during
    # conversion. Remove only faces with repeated vertex indices (zero area).
    f = result.faces
    result.update_faces((f[:,0] != f[:,1]) & (f[:,1] != f[:,2]) & (f[:,2] != f[:,0]))
    # A collapsed boolean sliver can also become two identical triangles with
    # opposite winding. They enclose no material; cancel only those exact pairs.
    f = result.faces
    _, inverse, counts = np.unique(np.sort(f,axis=1),axis=0,return_inverse=True,return_counts=True)
    keep = np.ones(len(f),dtype=bool)
    for group in np.flatnonzero(counts == 2):
        a,b = np.flatnonzero(inverse == group)
        pa,pb = result.vertices[f[a]],result.vertices[f[b]]
        if np.dot(np.cross(pa[1]-pa[0],pa[2]-pa[0]),np.cross(pb[1]-pb[0],pb[2]-pb[0])) < 0:
            keep[[a,b]] = False
    result.update_faces(keep)
    result.remove_unreferenced_vertices()
    return result


def corners(size, z=0):
    x, y = np.asarray(size[:2])/2
    return [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]


def layout(cfg):
    from .chassis_surface import WellSurface
    surface = WellSurface(cfg)
    g = cfg['geometry']; keys = {}; links = []
    for ci, col in enumerate(g['columns']):
        x = (ci-2)*g['column_pitch_mm']+col['offset_mm'][0]
        for ri, row in enumerate(['top', 'home', 'bottom']):
            y = (1-ri)*g['row_pitch_mm']+col['offset_mm'][1]
            name = 'matrix_'+col['name']+'_'+row
            M = surface.frame(x,y) @ frame([0,0,col['offset_mm'][2]], col['rotation_deg'])
            q = g['key_overrides'].get(name, {})
            M = M @ frame(q.get('offset_mm', [0, 0, 0]), q.get('rotation_deg', [0, 0, 0]))
            keys[name] = M
            if ri:
                links.append(('matrix_'+col['name']+'_'+['top', 'home'][ri-1], name))
            if ci:
                links.append(('matrix_'+g['columns'][ci-1]['name']+'_'+row, name))
    t = g['thumb']; cluster = frame(t['position_mm'], t['rotation_deg'])
    for i, k in enumerate(t['keys']):
        name = 'thumb_'+k['name']
        arc = t['arc']
        angle = math.radians((i-1)*arc['step_deg'])
        offset = [arc['radius_mm']*math.sin(angle),arc['radius_mm']*(math.cos(angle)-1),0]
        keys[name] = cluster @ frame(offset,[0,0,-math.degrees(angle)]) @ frame(k.get('offset_mm',[0,0,0]),k.get('rotation_deg',[0,0,0]))
        if i:
            links.append(('thumb_'+t['keys'][i-1]['name'], name))
    links += [tuple(x) for x in cfg['shell']['extra_links']]
    return keys, links


def validate(cfg):
    if cfg['schema'] != 1:
        raise ValueError('Unsupported chassis config schema')
    g = cfg['geometry']; s = cfg['shell']; t = cfg['tile']; sw = cfg['switch']
    if len(g['columns']) != 5 or len(g['thumb']['keys']) != 3:
        raise ValueError('Current connectivity supports five columns and three thumbs')
    if not 0 < sw['clip_land_thickness_mm'] <= s['deck_thickness_mm']:
        raise ValueError('Switch clip land must fit in the structural deck')
    if min(s['seat_outer_mm']) <= max(sw['cutout_mm']) + 2*sw['clip_relief_depth_mm']:
        raise ValueError('Switch frame is too narrow for clip relief')
    if min(t['size_mm']) <= 0 or min(s['wall_mm'], s['base_thickness_mm']) <= 0:
        raise ValueError('Board, wall and base dimensions must be positive')
    if s['rim_radius_mm'] <= s['wall_mm']:
        raise ValueError('Shoulder radius must exceed wall thickness')
    if g['thumb']['arc']['radius_mm'] <= 0 or not 0 < g['thumb']['arc']['step_deg'] < 90:
        raise ValueError('Thumb arc needs a positive radius and step between 0 and 90 degrees')
    surface = cfg['surface']
    if surface['type'] != 'blended_paraboloid': raise ValueError('Unsupported surface type')
    if any(r is not None and r <= 0 for r in surface['radii_mm']):
        raise ValueError('Surface radii must be positive, or null for a flat axis')
    if surface['mesh_pitch_mm'] <= 0: raise ValueError('Surface mesh pitch must be positive')
    if not -35 <= g['tent_deg'] <= 45:
        raise ValueError('Tenting outside the supported prototype range (-35..45 degrees)')


def key_seat(cfg):
    """Structural ring, two 1.5mm clip lands and tie-retained PCB corner guides."""
    s = cfg['shell']; sw = cfg['switch']; t = cfg['tile']
    w, h = s['seat_outer_mm']; d = s['deck_thickness_mm']
    solids = [rounded_box([w, h, d], [0, 0, -d/2], 1.3)]
    bw, bh, bt = t['size_mm']; gap = t['clearance_mm']; support = t['support_width_mm']
    length = t['support_corner_length_mm']; pcbz = -t['plate_top_to_pcb_top_mm']
    # Four shallow stops above the PCB; guides run outside its corners.
    for sx in [-1, 1]:
        for sy in [-1, 1]:
            cx = sx*(bw/2 + gap + support/2)
            cy = sy*(bh/2-length/2)
            solids += [box([support, length, -pcbz+bt-d+0.1], [cx, cy, (pcbz-bt-d)/2]),
                       box([support+gap+0.8, length, 0.8], [sx*(bw/2+support/2-0.4), cy, pcbz+0.4])]
    # Rigid slotted ears accept a small cable tie under each board, avoiding fragile snap arms.
    tiey = t['retaining_tie_y_mm']; earx = bw/2+gap+support/2
    earbottom = pcbz-bt-2.4
    slots = []
    for sx in [-1, 1]:
        solids.append(box([support+0.8, t['retaining_tie_width_mm']+3, -d-earbottom+.1],
                          [sx*earx, tiey, (earbottom-d)/2+.05]))
        slots.append(box([support+3, t['retaining_tie_width_mm']+0.6, t['retaining_tie_thickness_mm']+0.6],
                         [sx*earx, tiey, pcbz-bt-0.7]))
    return union(solids)-union(slots)


def key_cuts(cfg, name=None):
    sw = cfg['switch']; d = cfg['shell']['deck_thickness_mm']
    x, y = np.array(sw['cutout_mm'])+sw['cutout_clearance_mm']
    below = sw.get('cutout_depth_overrides_mm',{}).get(name,sw['body_below_plate_mm']+0.5)
    # Stop below the switch body. An infinite local-Z punch would also pierce
    # the palm skirt where a curved bottom-row switch points toward the wall.
    cuts = [box([x, y, below+25], [0, 0, (25-below)/2])]
    # Undercut at north/south edges leaves thin lands for the switch's own spring clips.
    for sy in [-1, 1]:
        cuts.append(box([sw['clip_width_mm'], sw['clip_relief_depth_mm']+0.2, d+4],
                        [0, sy*(y/2+sw['clip_relief_depth_mm']/2-0.05),
                         -sw['clip_land_thickness_mm']-(d+4)/2]))
    return union(cuts)


def keycap_size(cfg, name=None):
    return cfg['switch'].get('keycap_overrides_mm', {}).get(name, cfg['switch']['keycap_mm'])


def tile_hardware(cfg, name=None):
    t = cfg['tile']; sw = cfg['switch']; z = -t['plate_top_to_pcb_top_mm']
    result = [('pcb', box(t['size_mm'], [0, 0, z-t['size_mm'][2]/2]))]
    for c in t['components']:
        result.append(('components', box(c['size_mm'], np.array(c['center_mm'])+[0, 0, z])))
    result.append(('switch', box(sw['body_mm'], [0, 0, sw['body_mm'][2]/2-sw['body_below_plate_mm']])))
    cap = keycap_size(cfg, name)
    result.append(('keycaps', box(cap, [0, 0, sw['keycap_bottom_above_plate_mm']+cap[2]/2])))
    return result


def cutout_warnings(body, pose, size, depth, name):
    """Probe centre/edges/corners of a cutout against the uncut body.

    Coverage is sampled (nine columns); depth checks use exact solid boolean
    intersections within a 24 mm local slab, avoiding the distant base/skirt.
    """
    findings = []; covered = 0; too_deep = 0
    for x in [-size[0]/2+.25,0,size[0]/2-.25]:
        for y in [-size[1]/2+.25,0,size[1]/2-.25]:
            column = place(box([.3,.3,24],[x,y,0]),pose)
            hit = body ^ column
            if hit.volume() > .001:
                covered += 1
                cutter = place(box([.4,.4,depth[1]-depth[0]],[x,y,sum(depth)/2]),pose)
                if (hit-cutter).volume() > .001: too_deep += 1
    if covered < 9:
        findings.append({'kind':'cutout_misses_shell' if covered == 0 else 'cutout_partial_intersection',
                         'component':name,'covered_samples':covered,'total_samples':9,
                         'message':'Move the cutout or extend the shell surface to support the complete opening.'})
    if too_deep:
        findings.append({'kind':'cutout_depth','component':name,'blocked_samples':too_deep,
                         'message':'The finite cutter does not reach through all nearby shell material.'})
    return findings


def extrude_polygon(poly, height, z=0):
    return mf.CrossSection([list(poly.exterior.coords)[:-1]], mf.FillRule.EvenOdd).extrude(height).translate([0, 0, z])


def key_access_warnings(shell, hardware):
    """Catch a canopy above a cap even when it does not touch the cap itself."""
    warnings = []
    for group, name, cap in hardware:
        if group != 'keycaps': continue
        height = max(1., shell.bounding_box()[5]-cap.bounding_box()[2]+10.)
        approach = hull([cap, cap.translate([0,0,height])])-cap
        volume = (approach ^ shell).volume()
        if volume > .02:
            warnings.append({'kind':'key_access','component':name,'overlap_mm3':round(volume,3),
                             'message':'Shell obstructs vertical access above the keycap.'})
    return warnings


def make_hand(cfg, hand):
    from .chassis_surface import WellSurface, ShoulderBelowBase
    surface = WellSurface(cfg)
    skin, boundary = surface.skin()
    keys, keylinks = layout(cfg); s = cfg['shell']; t = cfg['tile']; tb = cfg['trackball']; ad = cfg['adapter']
    nodes = dict(keys)
    ball_enabled = tb['enabled_'+('right' if hand == 'r' else 'left')]
    if ball_enabled:
        nodes['trackball'] = frame(tb['position_mm'], tb['rotation_deg'])
    # Accessory mounts use explicit poses; their planes are surface blend targets.
    adapter = frame(ad['position_mm'], ad['rotation_deg'])
    nodes['adapter'] = adapter @ frame([0, 0, ad['component_height_mm']+ad['solder_clearance_mm']+s['deck_thickness_mm']])
    if cfg['surface'].get('trackball_patch'):
        nodes['adapter'][2,3] = float(surface.height(*adapter[:2,3]))
    tent = frame(angles=[0, cfg['geometry']['tent_deg'], 0])
    nodes = {n: tent @ M for n, M in nodes.items()}; adapter = tent @ adapter
    # Auto lift: the lowest complete hardware envelope or keeper ear gets bottom clearance.
    lows = []
    lows.extend(mesh(place(skin,tent)).vertices[:,2])
    for n in keys:
        M = nodes[n]
        lows.extend(points(M, corners(t['size_mm'], -t['plate_top_to_pcb_top_mm']-t['size_mm'][2]-3))[:, 2])
        for group, part in tile_hardware(cfg, n):
            if group != 'keycaps': lows.extend(mesh(place(part, M)).vertices[:, 2])
    lows.extend(points(adapter, corners(ad['board_mm'], -ad['board_mm'][2]-2))[:, 2])
    if ball_enabled:
        lows.extend(points(nodes['trackball'], corners(tb['board_mm'], -tb['board_top_below_deck_mm']-tb['board_mm'][2]-tb['rear_component_depth_mm']))[:, 2])
    lift = s['base_thickness_mm']+s['bottom_clearance_mm']-min(lows)
    for M in nodes.values(): M[2, 3] += lift
    adapter[2, 3] += lift
    basez = s['base_thickness_mm']+s['base_gap_mm']
    surface_pose = tent.copy(); surface_pose[2,3] = lift
    try:
        skin_world, perimeter = surface.body(surface_pose,basez)
    except ShoulderBelowBase as error:
        # Steep accessory patches can lower the inner shoulder between samples
        # used for the initial lift. Include that actual rim before closing it.
        extra=basez+s['bottom_clearance_mm']-error.minimum
        lift+=extra;surface_pose[2,3]+=extra;adapter[2,3]+=extra
        for M in nodes.values():M[2,3]+=extra
        skin_world, perimeter = surface.body(surface_pose,basez)
    # Tenting a rounded shoulder gives a small, legitimate overhang beyond its
    # vertical skirt. The cover and enclosure checks follow the full silhouette.
    contours = mf.CrossSection(skin_world.project().to_polygons(),mf.FillRule.Positive).to_polygons()
    poly = max((Polygon(p) for p in contours),key=lambda p:p.area)
    if not poly.is_valid: raise ValueError('Surface overhangs in the selected tent orientation')
    envelope,_ = surface.body(surface_pose,basez,filled=True)
    solids = [skin_world]; cuts = []; hardware = []; fit_warnings = []
    for name in keys:
        # A PCB pocket can carve away a thin outer wall without leaving any
        # nominal collision. Reserve material beyond the pocket before cutting.
        bw,bh,bt=t['size_mm']
        reserve=t.get('outer_wall_reserve_mm',1.)+t['clearance_mm']
        pocket_margin=place(box([bw+2*reserve,bh+2*reserve,bt],
                               [0,0,-t['plate_top_to_pcb_top_mm']-bt/2]),nodes[name])
        outside=(pocket_margin-envelope).volume()
        if outside > .02:
            fit_warnings.append({'kind':'pcb_wall_clearance','component':name,'outside_mm3':round(outside,3),
                                 'message':'PCB pocket leaves less than the configured outer wall reserve.'})
        fit_warnings += cutout_warnings(skin_world,nodes[name],cfg['switch']['cutout_mm'],
                                        [-cfg['switch'].get('cutout_depth_overrides_mm',{}).get(name,cfg['switch']['body_below_plate_mm']+.5),25],name)
    if ball_enabled:
        bw,bh,bt=tb['board_mm']
        margin=tb['clearance_mm']+tb.get('outer_wall_reserve_mm',1.)
        reserve=place(box([bw+2*margin,bh+2*margin,bt],
                          [0,0,-tb['board_top_below_deck_mm']-bt/2]),nodes['trackball'])
        outside=(reserve-envelope).volume()
        if outside > .02:
            fit_warnings.append({'kind':'trackball_wall_clearance','outside_mm3':round(outside,3),
                                 'message':'Trackball PCB pocket breaches the curved body or leaves insufficient enclosing material.'})
        fit_warnings += cutout_warnings(skin_world,nodes['trackball'],tb['opening_mm'],[-tb.get('opening_depth_below_mm',6),6],'trackball')
    for n in keys:
        M = nodes[n]
        # The continuous skin supplies the seat's top face. Keep the supporting
        # ring just below it, avoiding coincident faces in flat thumb regions.
        seat = key_seat(cfg) ^ box([50,50,30],[0,0,-15.05])
        solids.append(place(seat, M) ^ envelope); cuts.append(place(key_cuts(cfg,n), M))
        for group, part in tile_hardware(cfg,n): hardware.append((group,n,place(part,M)))
    # Wiring grooves are local underside features; they no longer define the skin.
    for a,b in keylinks:
        pa = nodes[a][:3,3].copy(); pb = nodes[b][:3,3].copy()
        w = cfg['wiring']['channel_width_mm']; dep = cfg['wiring']['channel_depth_mm']
        pa -= nodes[a][:3,2]*s['deck_thickness_mm']
        pb -= nodes[b][:3,2]*s['deck_thickness_mm']
        cuts.append(hull([box([w,w,2*dep],pa),box([w,w,2*dep],pb)]))
    # The board envelope remains empty. Corner seats support insertion from below;
    # ties supply retention, rather than relying on electrical switch pins alone.
    for n in keys:
        M = nodes[n]; bw, bh, bt = t['size_mm']; pz = -t['plate_top_to_pcb_top_mm']
        cuts.append(place(box([bw+2*t['clearance_mm']+0.02, bh+2*t['clearance_mm']+0.02, bt+0.05], [0, 0, pz-bt/2-0.025]), M))
        for component in t['components']:
            center = np.array(component['center_mm'])+[0, 0, pz]
            if hand == 'l': center[0] *= -1
            cuts.append(place(box(np.array(component['size_mm'])+2*t['component_clearance_mm'], center), M))
        sw = cfg['switch']; cap = keycap_size(cfg, n)
        # Clearance for a fully depressed cap, not just its rest position.
        cap_bottom = sw['keycap_bottom_above_plate_mm']-sw['travel_mm']
        margin = sw.get('keycap_clearance_overrides_mm',{}).get(n,sw.get('keycap_clearance_mm',.3))
        cuts.append(place(box([cap[0]+2*margin, cap[1]+2*margin, 25], [0, 0, cap_bottom+12.5]), M))
        # Apply slots after all webs/walls have been united; a neighboring deck
        # must not silently refill the retention passages on a curved column.
        for sx in [-1, 1]:
            earx = bw/2+t['clearance_mm']+t['support_width_mm']/2
            cuts.append(place(box([t['support_width_mm']+3, t['retaining_tie_width_mm']+.6, t['retaining_tie_thickness_mm']+.6],
                                  [sx*earx, t['retaining_tie_y_mm'], pz-bt-.7]), M))
    # Generic adapter shelf, edge guides and strap slots: no invented mounting-hole pattern.
    aw, ah, at = ad['board_mm']; shelfz = -at-1
    shelf = box([aw+4, ah+4, 2], [0, 0, shelfz])
    for sx in [-1, 1]:
        shelf += box([1.5, ah+4, at+2], [sx*(aw/2+ad['clearance_mm']+0.75), 0, -at/2])
        shelf -= box([1.5, ad['retaining_tie_width_mm']+0.7, 5], [sx*(aw/2+1.1), 0, shelfz])
    shelf = place(shelf, adapter)
    # Two narrow brackets join shelf ends to its roof without enclosing solder terminals.
    for sx in [-1, 1]:
        a = points(adapter, [[sx*(aw/2+1.2), ah/2, shelfz]])[0]
        b = points(nodes['adapter'], [[sx*(aw/2+1.2), ah/2, -1.5]])[0]
        if cfg['surface'].get('trackball_patch'):
            local=points(frame(ad['position_mm'],ad['rotation_deg']),[[sx*(aw/2+1.2),ah/2,0]])[0]
            local[2]=float(surface.height(local[0],local[1]))-1.5
            b=points(surface_pose,[local])[0]
        solids.append(hull([box([2, 3, 2], a), box([2, 3, 2], b)]) ^ envelope)
    solids.append(shelf ^ envelope)
    hardware.append(('adapter', 'FFC adapter', place(box(ad['board_mm'], [0, 0, -at/2]), adapter)))
    hardware.append(('adapter', 'FFC connector envelope', place(box([aw-4, ah/2, ad['component_height_mm']], [0, 0, ad['component_height_mm']/2]), adapter)))
    cuts.append(place(box([aw+2*ad['clearance_mm'], ah+2*ad['clearance_mm'], at+0.1], [0, 0, -at/2+0.05]), adapter))
    cuts.append(place(box([aw-3, ah/2+1, ad['component_height_mm']+0.5], [0, 0, (ad['component_height_mm']+0.5)/2]), adapter))
    if ball_enabled:
        M = nodes['trackball']; bw, bh, bt = tb['board_mm']; pz = -tb['board_top_below_deck_mm']
        # Open housing window, board pocket, and ledges with tie slots on the long sides.
        below=tb.get('opening_depth_below_mm',6)
        cuts.append(place(rounded_box([*tb['opening_mm'], below+6], [0, 0, (6-below)/2], tb['opening_radius_mm']), M))
        # Housing enters from underneath; the PCB remains entirely below the deck.
        cuts.append(place(box([tb['housing_mm'][0]+2*tb['clearance_mm'], tb['housing_mm'][1]+2*tb['clearance_mm'], tb['housing_mm'][2]+.5],
                              [0, 0, pz+tb['housing_mm'][2]/2]), M))
        for sx in [-1, 1]:
            rail_top = -tb.get('rail_top_below_deck_mm',2.5)
            rail = rounded_box([3, bh+2*tb.get('rail_end_allowance_mm',.5), rail_top-pz+bt],
                               [sx*(bw/2+tb['clearance_mm']+0.5),0,(pz-bt+rail_top)/2],1.4)
            # Cut after all unions so the shell cannot refill a strap passage.
            cuts.append(place(box([6,3.2,1.6],[sx*(bw/2+tb['clearance_mm']+0.5),0,pz-bt+.9]),M))
            solids.append(place(rail, M) ^ envelope)
        cuts.append(place(box([bw+2*tb['clearance_mm'], bh+2*tb['clearance_mm'], bt+0.1], [0, 0, pz-bt/2]), M))
        rear=tb['rear_component_depth_mm']+tb['clearance_mm']
        cuts.append(place(box([bw+2*tb['clearance_mm'],bh+2*tb['clearance_mm'],rear],
                              [0,0,pz-bt-rear/2]),M))
        for xy in tb['mount_holes_xy_mm']:
            cuts.append(place(cylinder(tb['mount_hole_mm']/2, pz-bt-3, 2, xy), M))
        hardware.append(('trackball', 'ICSH044A board envelope', place(box(tb['board_mm'], [0, 0, pz-bt/2]), M)))
        hardware.append(('trackball','trackball rear component envelope',place(box([bw,bh,tb['rear_component_depth_mm']],[0,0,pz-bt-tb['rear_component_depth_mm']/2]),M)))
        hardware.append(('trackball', 'trackball housing', place(box(tb['housing_mm'], [0, 0, pz+tb['housing_mm'][2]/2]), M)))
        hardware.append(('ball', 'ball', place(mf.Manifold.sphere(tb['ball_diameter_mm']/2, 32).translate([0, 0, pz+tb['ball_center_above_board_mm']]), M)))
    # Inner-facing exit: local -Y points left on the right hand, right on the left.
    rb = cfg['ribbon']; exit_y = rb['exit_y_mm']
    line = poly.intersection(LineString([(-500, exit_y), (500, exit_y)]))
    if line.is_empty: raise ValueError('Ribbon exit misses the chassis; change exit_y_mm')
    rx = line.bounds[0]; rw, rh = rb['opening_mm']; rr = min(rb['edge_radius_mm'], rh/2)
    exit_frame = frame([rx, exit_y, basez], [0, 0, -90])
    exit_height = rb['height_above_base_mm']
    if exit_height is None:
        exit_height = points(adapter, [[0, -ad['board_mm'][1]/2, ad['component_height_mm']/2]])[0][2]-basez
    cutter = hull([mf.Manifold.cylinder(30, rr, rr, 20).rotate([90, 0, 0]).translate([sx*(rw/2-rr), 15, exit_height+sz*(rh/2-rr)]) for sx in [-1, 1] for sz in [-1, 1]])
    cuts.append(place(cutter, exit_frame))
    fit_warnings += cutout_warnings(skin_world,frame([rx,exit_y,basez+exit_height],[90,0,-90]),
                                    rb['opening_mm'],[-15,15],'ribbon exit')
    # A broad inner landing for a cable tie provides FFC strain relief at the exit.
    landing = rounded_box([rw+4, rb['bend_space_mm']+3, 2], [0, (rb['bend_space_mm']+3)/2, 2], 1)
    for sx in [-1, 1]:
        landing -= box([3.2, 1.6, 5], [sx*(rw/2-1), 3, 2])
    landing=place(landing, exit_frame) ^ extrude_polygon(poly.buffer(-.02),200)
    solids.append(landing)
    # Screw bosses use explicit pre-tent XY config points, snapped to the nearest inside wall.
    base_poly = poly
    inner = poly.buffer(-s['boss_diameter_mm']/2+0.6)
    if inner.geom_type != 'Polygon': raise ValueError('Shell too narrow for base bosses')
    boss_xy = []
    for xy in s['fasteners_xy_mm']:
        q = Point([xy[0]*math.cos(math.radians(cfg['geometry']['tent_deg'])), xy[1]])
        p = nearest_points(inner.exterior, q)[0]; p = np.array(p.coords[0]); boss_xy.append(p)
        screw=cylinder(s['fastener_clearance_mm']/2,basez-1,basez+s['boss_height_mm'],p)
        if (screw ^ landing).volume() > .02:
            fit_warnings.append({'kind':'screw_ribbon_conflict','position_xy_mm':p.tolist(),
                                 'message':'Screw path intersects the ribbon strain-relief landing.'})
        boss = cylinder(s['boss_diameter_mm']/2, basez, basez+s['boss_height_mm'], p)
        near = np.array(nearest_points(poly.exterior, Point(p))[0].coords[0])
        solids += [hull([boss, cylinder(s['wall_mm']/2, basez, basez+s['boss_height_mm'], near)]) ^ extrude_polygon(poly.buffer(-.02),200)]
        cuts.append(cylinder(s['fastener_pilot_mm']/2, basez-1, basez+s['boss_height_mm']-1, p))
    # 10 µm simplification avoids sub-float32 slivers in binary STL export;
    # this is well below the configured print-fit clearances.
    shell = (union(solids)-union(cuts)).set_tolerance(cfg['surface'].get('boolean_tolerance_mm',.01))
    # Intersecting tilted cutters can leave sub-print-resolution slivers. Keep
    # every substantive body so the connectivity check still catches real faults.
    # Materialize the boolean before splitting disconnected cavity surfaces.
    shell = mf.Manifold(shell.to_mesh64())
    fragments = shell.decompose()
    def numerical_sliver(part):
        volume = part.volume()
        # Preserve real cavity boundaries. Tangent booleans can leave a
        # sub-0.002-mm3, sub-millimetre cavity whose boundary merges into the shell.
        return 0 < volume < .01 or (-.002 < volume <= 0 and max(np.array(part.bounding_box()[3:])-np.array(part.bounding_box()[:3])) < 1)
    slivers = [numerical_sliver(p) for p in fragments]
    removed_slivers = [p.volume() for p,drop in zip(fragments,slivers) if drop]
    shell = mf.Manifold.compose([p for p,drop in zip(fragments,slivers) if not drop])
    base = extrude_polygon(base_poly, s['base_thickness_mm'])
    for p in boss_xy:
        base -= cylinder(s['fastener_clearance_mm']/2, -1, s['base_thickness_mm']+1, p)
        base -= cylinder(s['feet_diameter_mm']/2, -0.1, s['feet_recess_mm'], p)
    # Reflect the complete mechanical half, but show purchased boards with proper (unmirrored) frames.
    if hand == 'l':
        reflect = np.diag([-1., 1., 1., 1.]); shell = place(shell, reflect); base = place(base, reflect)
        hardware = [(group, name, place(part, reflect)) for group, name, part in hardware if group not in ('pcb', 'components')]
        for n in keys:
            M = reflect @ nodes[n] @ np.diag([-1., 1., 1., 1.])
            for group, part in tile_hardware(cfg, n):
                if group in ('pcb', 'components'): hardware.append((group, n, place(part, M)))
        nodes = {n: reflect @ M for n, M in nodes.items()}
    return shell, base, hardware, nodes, {'outline_controls_resolved_xy_mm': surface.outline_points().tolist(), 'fit_warnings': fit_warnings, 'lift_mm': lift, 'removed_sliver_volumes_mm3': removed_slivers, 'ribbon_exit_xy_mm': [rx*(-1 if hand == 'l' else 1), exit_y], 'ribbon_exit_z_mm': float(basez+exit_height), 'ribbon_outward_direction': [-1 if hand == 'r' else 1, 0, 0], 'perimeter_xy_mm': [[x*(-1 if hand == 'l' else 1), y] for x,y in base_poly.exterior.coords], 'base_bosses_xy_mm': [[float(p[0])*(-1 if hand == 'l' else 1), float(p[1])] for p in boss_xy]}


PALETTE = {'shell': '#b7d0d4', 'base': '#54747c', 'pcb': '#238c74', 'components': '#29323b', 'switch': '#b6afa0', 'keycaps': '#eee4cf', 'adapter': '#daae57', 'trackball': '#935ea6', 'ball': '#d75551', 'surface': '#769daf'}


def serialize_mesh(m):
    return {'v': np.round(m.vertices, 3).tolist(), 'f': m.faces.tolist()}


def build(cfg, out):
    """Publish a complete generation only after all geometry checks finish."""
    out = Path(out); out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.chassis-', dir=str(out.parent)) as temp:
        staging = Path(temp)
        _build(cfg, staging)
        doc = Path(__file__).resolve().parents[1]/'docs/parametric-chassis.md'
        if doc.exists(): (staging/'README.md').write_text(doc.read_text())
        with zipfile.ZipFile(staging/'rosebear-chassis-prototype.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(staging.iterdir()):
                if path.suffix != '.zip': archive.write(path, path.name)
        out.mkdir(parents=True, exist_ok=True)
        for path in staging.iterdir(): os.replace(path, out/path.name)
    print('Created '+str(out), flush=True)


def _build(cfg, out):
    validate(cfg); out = Path(out); out.mkdir(parents=True, exist_ok=True)
    config_bytes = (json.dumps(cfg, indent=2)+'\n').encode(); (out/'config.json').write_bytes(config_bytes)
    report = {'status': 'dimensional prototype; physical fit not qualified', 'construction': 'parametric well and spline shoulder/skirt in one indexed shell, then cutouts', 'surface': cfg['surface'], 'config_sha256': hashlib.sha256(config_bytes).hexdigest(), 'parts': {}, 'collisions': [], 'warnings': [], 'placement': {}}
    viewer = []; scenes = {}
    for hand in ['r', 'l']:
        print('Building '+hand+' chassis...', flush=True)
        shell, base, hardware, nodes, placement = make_hand(cfg, hand)
        footprint = Polygon(placement['perimeter_xy_mm']).buffer(.05)
        if not footprint.covers(MultiPoint(mesh(shell).vertices[:,:2])):
            placement['fit_warnings'].append({'kind':'support_outside_shell','message':'A shell support protrudes beyond the continuous body silhouette.'})
        for group,name,part in hardware:
            if group in ('pcb','components','adapter','trackball') and not footprint.covers(MultiPoint(mesh(part).vertices[:,:2])):
                placement['fit_warnings'].append({'kind':'component_outside_shell','component':name,'group':group,'message':'Component envelope extends beyond the case silhouette.'})
        report['placement'][hand] = placement
        report['warnings'] += [dict(w,hand=hand) for w in placement['fit_warnings']]
        from .chassis_surface import WellSurface
        pose = frame([0,0,placement['lift_mm']], [0,cfg['geometry']['tent_deg'],0])
        reference, _ = WellSurface(cfg).body(pose,cfg['shell']['base_thickness_mm']+cfg['shell']['base_gap_mm'])
        if hand == 'l': reference = place(reference,np.diag([-1.,1.,1.,1.]))
        reference_mesh = mesh(reference)
        viewer.append({'hand':hand,'group':'surface','name':'Uncut design surface',**serialize_mesh(reference_mesh)})
        reference_mesh.visual.face_colors = trimesh.visual.color.hex_to_rgba(PALETTE['surface'])
        reference_mesh.export(str(out/(hand+'-design-surface.glb')))
        scene = trimesh.Scene(); scenes[hand] = scene
        for name, solid in [('shell', shell), ('base', base)]:
            m = mesh(solid); path = out/(hand+'-'+name+'.stl')
            # Preserve the mesh's double-precision coordinates. Binary STL
            # quantizes close rounded-surface intersections to float32.
            path.write_text(trimesh.exchange.stl.export_stl_ascii(m))
            parts = m.split(only_watertight=False)
            report['parts'][path.name] = {'watertight': bool(m.is_watertight), 'positive_volume': bool(m.volume > 0), 'connected_bodies': len(parts), 'bounds_mm': np.round(m.bounds, 3).tolist(), 'volume_cm3': round(m.volume/1000, 2), 'triangles': len(m.faces)}
            if not m.is_watertight or m.volume <= 0 or len(parts) != 1:
                raise ValueError('Invalid printable solid '+path.name+': '+str(report['parts'][path.name]))
            exported = trimesh.load(path, force='mesh')
            report['parts'][path.name]['stl_roundtrip_watertight'] = bool(exported.is_watertight)
            if not exported.is_watertight or len(exported.split()) != 1:
                raise ValueError('STL serialization lost watertightness: '+path.name)
            viewer.append({'hand': hand, 'group': name, 'name': name, **serialize_mesh(m)})
            m.visual.face_colors = trimesh.visual.color.hex_to_rgba(PALETTE[name]); scene.add_geometry(m, node_name=name)
        report['warnings'] += [dict(w,hand=hand) for w in key_access_warnings(shell,hardware)]
        # Exact solid overlap for shell vs nominal hardware; intended PCB top contact has zero volume.
        for group, name, solid in hardware:
            overlap = (shell ^ solid).volume()
            if overlap > 0.02:
                report['collisions'].append({'hand': hand, 'component': name, 'group': group, 'shell_overlap_mm3': round(overlap, 3)})
            base_overlap = (base ^ solid).volume()
            if base_overlap > .02: report['collisions'].append({'hand':hand,'component':name,'group':group,'base_overlap_mm3':round(base_overlap,3)})
            m = mesh(solid); viewer.append({'hand': hand, 'group': group, 'name': name, **serialize_mesh(m)})
            m.visual.face_colors = trimesh.visual.color.hex_to_rgba(PALETTE[group]); scene.add_geometry(m, node_name=group+'_'+name)
        def owner(group, name):
            if group in ('trackball', 'ball'): return 'trackball'
            if group == 'adapter': return 'adapter'
            return name
        for i, (ga, a, pa) in enumerate(hardware):
            for gb, b, pb in hardware[i+1:]:
                if owner(ga, a) == owner(gb, b): continue
                volume = (pa ^ pb).volume()
                if volume > .02: report['collisions'].append({'hand': hand, 'hardware': [ga+': '+a, gb+': '+b], 'overlap_mm3': round(volume, 3)})
        for group, name, cap in hardware:
            if group != 'keycaps': continue
            swept = hull([cap, cap.translate(-nodes[name][:3, 2]*cfg['switch']['travel_mm'])])
            volume = (swept ^ shell).volume()
            if volume > .02: report['collisions'].append({'hand': hand, 'travel_envelope': name, 'shell_overlap_mm3': round(volume, 3)})
            margin = cfg['switch'].get('keycap_clearance_overrides_mm',{}).get(name,0)
            if margin:
                size = keycap_size(cfg,name); bottom = cfg['switch']['keycap_bottom_above_plate_mm']-cfg['switch']['travel_mm']
                space = place(box([size[0]+2*margin,size[1]+2*margin,size[2]+cfg['switch']['travel_mm']],
                                  [0,0,bottom+(size[2]+cfg['switch']['travel_mm'])/2]),nodes[name])
                if (space ^ shell).volume() > .02:
                    report['warnings'].append({'kind':'keycap_clearance','hand':hand,'component':name,'message':'Shell enters the configured keycap clearance margin.'})
                for other_group,other_name,other in hardware:
                    if other_name != name and (space ^ other).volume() > .02:
                        report['warnings'].append({'kind':'keycap_clearance','hand':hand,'component':name,'other':other_name,'message':'Other hardware enters the configured keycap clearance margin.'})
            for gb, b, pb in hardware:
                if b == name: continue
                volume = (swept ^ pb).volume()
                if volume > .02: report['collisions'].append({'hand': hand, 'travel_envelope': name, 'other_hardware': gb+': '+b, 'overlap_mm3': round(volume, 3)})
        if 'trackball' in nodes:
            tb=cfg['trackball'];crown=-tb['board_top_below_deck_mm']+tb['ball_center_above_board_mm']+tb['ball_diameter_mm']/2
            finger=place(mf.Manifold.sphere(8,32).translate([0,0,crown+7]),nodes['trackball'])
            if (finger ^ shell).volume() > .02:
                report['warnings'].append({'kind':'trackball_access','hand':hand,'message':'Shell obstructs the 16 mm fingertip access probe.'})
            for group,name,part in hardware:
                if group not in ('trackball','ball') and (finger ^ part).volume() > .02:
                    report['warnings'].append({'kind':'trackball_access','hand':hand,'component':name,'message':'Hardware obstructs the 16 mm fingertip access probe.'})
        scene.export(str(out/(hand+'-assembly.glb')))
        (out/(hand+'-frames.json')).write_text(json.dumps({n: M.tolist() for n, M in nodes.items()}, indent=2)+'\n')
    # One-key coupon includes the exact same clip, corner guide and strap geometry.
    coupon = key_seat(cfg)-key_cuts(cfg); cm = mesh(coupon); cm.apply_translation([0, 0, -cm.bounds[0, 2]])
    cm.export(out/'switch-pcb-fit-coupon.stl')
    report['parts']['switch-pcb-fit-coupon.stl'] = {'watertight': bool(cm.is_watertight), 'connected_bodies': len(cm.split())}
    report['warnings'] += [dict(w,kind='component_overlap',message='Nominal hardware or key travel overlaps another solid.') for w in report['collisions']]
    (out/'warnings.txt').write_text('\n'.join(json.dumps(w) for w in report['warnings'])+'\n' if report['warnings'] else 'No fit warnings. Dimensions and physical assembly still require verification.\n')
    (out/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    from .chassis_view import write_viewer, write_views
    (out/'viewer-data.json').write_text(json.dumps(viewer,separators=(',',':')))
    write_viewer(out/'preview.html', viewer, report, PALETTE)
    write_views(out, viewer, PALETTE)
    for warning in report['warnings']: print('WARNING: '+json.dumps(warning),flush=True)
    print(str(len(report['warnings']))+' fit warnings. See report.json and warnings.txt.',flush=True)
