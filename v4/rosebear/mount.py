"""Parametric prototype carrier: native trackball housing retained above its PCB."""
import json
from .assembly import world, box_corners, boxes_intersect, board_frame
from .trackball import WIRES, POD_PINS, GPIO


def carrier_cap_hits(chassis,frame,bounds):
    carrier={'frame':frame,'corners':box_corners(frame,bounds)}
    hits=[]
    cap_bounds=[-9,-9,chassis['config']['plate_thickness'],9,9,chassis['cap_top_height']]
    for key in chassis['keys']:
        cap_frame=board_frame(key,'r',0)
        cap={'frame':cap_frame,'corners':box_corners(cap_frame,cap_bounds)}
        if boxes_intersect(carrier,cap): hits.append(key['id'])
    return hits


def integrate(result,solids,config,out,chassis):
    cfg=config['trackball']
    if not cfg['enabled']: return
    if cfg['hand']!='r' or cfg['anchor'] not in ('thumb_near','thumb_home','thumb_far'):
        raise ValueError('Trackball requires a right thumb anchor')
    anchor=result['modules']['thumb_r_'+cfg['anchor'].removeprefix('thumb_')]['frame']
    frame={'origin':world(anchor,cfg['offset_mm']),'axes':anchor['axes']}
    bounds=[-10,-11,-config['pcb_thickness_mm'],10,11,0]
    body={'id':'trackball_r','frame':frame,'bounds':bounds,'corners':box_corners(frame,bounds)}
    envelope=[-16,-13,-5,16,13,7]
    housing={'frame':frame,'corners':box_corners(frame,envelope)}
    failures=[]
    for s in solids:
        if (s['id'].startswith('r_') or s['id'].startswith('thumb_r')) and boxes_intersect(housing,s): failures.append(['trackball carrier',s['id']])
    result['checks'].append({'name':'trackball carrier against nominal PCB islands','failures':failures})
    result['checks'].append({'name':'trackball carrier against conservative 18 mm keycap envelopes',
                             'failures':carrier_cap_hits(chassis,frame,envelope)})
    solids.append(body)
    result['modules']['trackball']={'frame':frame,'bounds':bounds,'carrier_bounds':envelope,
                                   'fit_status':'prototype: verify ball height, retention and magnetic switching with actual parts'}
    result['trackball_wiring']=[{'net':n,'pod_pad':'WT'+str(i)+'/1','trackball_pad':'W'+str(i)+'/1',
                               'module_header_pin':POD_PINS[n],'gpio':GPIO.get(n)} for i,n in enumerate(WIRES,1)]
    result['firmware']={'trackball':{'supply_v':3.3,'inputs':GPIO,'active_low':True,
                                    'motion':'four independent direction pulse inputs, not quadrature',
                                    'click':'debounced active-low switch','rotation':'calibrate direction mapping after mounting'}}
    m=[[frame['axes'][j][i] for j in range(3)]+[frame['origin'][i]] for i in range(3)]+[[0,0,0,1]]
    # Board plane is z=0. Its underside is supported on a ledge at -0.6;
    # 3 mm component space is left below, with an open cable exit.
    scad='''// Prototype carrier for the small BlackBerry-style module. Units: mm.
// Tune housing_height using actual parts BEFORE printing a chassis.
// Fasteners: four M2 through bolts; add nuts outside the carrier.
part="assembly"; // assembly, base, lid
board_thickness=PCBTHICK;
housing_height=5;
ball_diameter=BALLDIAM;
module base() {
 difference() {
  union() {
   translate([-12,-13,-5]) cube([24,26,5-board_thickness]);
   for(x=[-14,14],y=[-8,8]) translate([x,y,-5]) cylinder(h=5-board_thickness,r=2,$fn=32);
  }
  // Underside component pocket and board edge recess.
  translate([-9,-10,-3.8]) cube([18,20,7]);
  translate([-10.25,-11.25,-board_thickness]) cube([20.5,22.5,8]);
  translate([-5,-14,-3.8]) cube([10,5,5]);
  for(x=[-14,14],y=[-8,8]) translate([x,y,-6]) cylinder(h=15,r=1.15,$fn=24);
 }
}
module lid() {
 difference() {
  union() {
   translate([-12,-13,-board_thickness]) cube([24,26,housing_height+1+board_thickness]);
   for(x=[-14,14],y=[-8,8]) translate([x,y,-board_thickness]) cylinder(h=housing_height+1+board_thickness,r=2,$fn=32);
  }
  // Clear the Hall sensors and stock trackball housing underneath the roof.
  translate([-10.25,-11.25,-1]) cube([20.5,22.5,housing_height+1]);
  translate([0,0,-1]) cylinder(h=12,d=ball_diameter+0.8,$fn=64);
  translate([-5,-14,-1]) cube([10,5,4]);
  for(x=[-14,14],y=[-8,8]) translate([x,y,-1]) cylinder(h=15,r=1.15,$fn=24);
 }
}
module carrier() { base(); lid(); }
module assembled_carrier() { multmatrix(FRAME) carrier(); }
if(part=="base") base();
else if(part=="lid") translate([0,0,housing_height+1]) rotate([180,0,0]) lid();
else assembled_carrier();
'''.replace('PCBTHICK',str(config['pcb_thickness_mm'])).replace('BALLDIAM',str(cfg['ball_diameter_mm'])).replace('FRAME',json.dumps(m))
    (out/'trackball-carrier.scad').write_text(scad)
    offset=cfg['offset_mm']
    # Reach back to the outer rim of the anchor key plate. Offset is in the
    # anchor's frame, so the foot stays fixed when the carrier is adjusted.
    foot=[-offset[0],-9-offset[1],2-offset[2]]
    # Start the support on the carrier edge facing the anchor plate.
    reach=min(12/abs(foot[0]) if foot[0] else float('inf'),13/abs(foot[1]) if foot[1] else float('inf'))
    start=[foot[0]*reach,foot[1]*reach,-5]
    arm_size=[2,8,2] if abs(start[0])>=11.9 else [8,2,2]
    arm_lo=[start[0]-arm_size[0]/2,start[1]-arm_size[1]/2,start[2]]
    wrapper = ['// Prototype: review the union against your actual chassis mesh.',
               'use <assembly.scad>', 'use <trackball-carrier.scad>',
               'chassis_right_stl="../../dactyl-keyboard/things/DM_right.stl";',
               'module trackball_support() { multmatrix('+json.dumps(m)+') hull() {',
               'translate('+json.dumps(arm_lo)+') cube('+json.dumps(arm_size)+');',
               'translate('+json.dumps([foot[0]-4,foot[1]-1,foot[2]])+') cube([8,2,2]);', '}}',
               'difference() { union() { import(chassis_right_stl);',
               'multmatrix('+json.dumps(m)+') base(); trackball_support(); } pcb_reliefs(); }',
               '// Print the lid separately using trackball-carrier.scad part="lid".']
    (out/'chassis-right.scad').write_text('\n'.join(wrapper)+'\n')
