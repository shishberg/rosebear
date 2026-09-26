"""Assembly graph, mechanical transforms, and review artifacts.

Flat fabrication coordinates and assembled coordinates are distinct. Individual
thumb tiles use the corresponding switch's full 3D frame. Finger rigid islands
use their key frames; bend material is represented separately, never as a
coplanar assembly hull.
"""
import itertools
import json
import math
from .mechanical import transform, write_json
from .pcb import xy, pad_of


def dot(a,b): return sum(x*y for x,y in zip(a,b))
def sub(a,b): return [x-y for x,y in zip(a,b)]
def cross(a,b): return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]


def board_frame(key,hand,z):
    # A physical PCB needs a proper rotation, not a reflected land pattern.
    # On the left reverse local x after reflecting the chassis in world x.
    origin=transform(key,[0,0,z],hand)
    axes=[]
    for j in range(3):
        local=[0,0,z]; local[j]+=1
        axis=sub(transform(key,local,hand),origin)
        axes.append([-v for v in axis] if hand=='l' and j==0 else axis)
    return {'origin':origin,'axes':axes}


def world(frame,local):
    return [frame['origin'][i]+sum(frame['axes'][j][i]*local[j] for j in range(3)) for i in range(3)]


def box_corners(frame,bounds):
    return [world(frame,p) for p in itertools.product(*[(bounds[i],bounds[i+3]) for i in range(3)])]


def boxes_intersect(a,b,clearance=0):
    axes=a['frame']['axes']+b['frame']['axes']
    axes += [cross(x,y) for x in a['frame']['axes'] for y in b['frame']['axes']]
    for axis in axes:
        norm=math.sqrt(dot(axis,axis))
        if norm<1e-9: continue
        axis=[x/norm for x in axis]
        aa=[dot(p,axis) for p in a['corners']]; bb=[dot(p,axis) for p in b['corners']]
        if max(aa)+clearance<=min(bb) or max(bb)+clearance<=min(aa): return False
    return True


def build(chassis,config,geometry,boards,out,thumb_geometries=None):
    z=chassis['config']['plate_thickness']-config['plate_top_to_pcb_mm']
    keys={k['id']:k for k in chassis['keys']}
    result={'schema':1,'units':'mm','source_sha256':chassis['source_sha256'],
            'plate_top_to_pcb_mm':config['plate_top_to_pcb_mm'],
            'pcb_plane_in_plate_frame_mm':z,'modules':{},'wires':[],'checks':[],
            'mechanical_status':'nominal model; physical fit and bend durability require assembly verification'}
    solids=[]
    for hand in ['l','r']:
        s=next(s for s in geometry['fingers'] if s['id']=='finger_'+hand)
        b=boards['finger_'+hand]
        module={'rigid_islands':[],'pads':{}}
        for k in s['keys']:
            kid='matrix_'+k['column']+'_'+k['row']
            frame=board_frame(keys[kid],hand,z)
            module['rigid_islands'].append({'key':kid,'flat_center':[k['x'],-k['y']],'frame':frame})
            # Body of the rigid switch island, not a fictitious whole flat board.
            bounds=[-8.86,-8.9,-config['pcb_thickness_mm'],8.86,8.9,0]
            solids.append({'id':hand+'_'+kid,'frame':frame,'bounds':bounds,'corners':box_corners(frame,bounds)})
        bottom=next(k for k in module['rigid_islands'] if k['key']=='matrix_inner_bottom')
        for f in b.GetFootprints():
            if f.GetReference().startswith('W'):
                p=pad_of(f,1); px,py=xy(p.GetPosition())
                owner=bottom
                cx,cy=owner['flat_center']
                # KiCad y goes down while the switch's local y goes up.
                pos=world(owner['frame'],[px-cx,-(py-cy),0])
                module['pads'][f.GetReference()+'/1']={'net':p.GetNetname(),'at':pos}
        result['modules']['finger_'+hand]=module
        if 'flat_thumb' in chassis:
            name='thumb_'+hand;b=boards[name]
            frame=board_frame(chassis['flat_thumb'],hand,z)
            pads={}
            for f in b.GetFootprints():
                if f.GetReference().startswith('W'):
                    p=pad_of(f,1);x,y=xy(p.GetPosition())
                    pads[f.GetReference()+'/1']={'net':p.GetNetname(),'at':world(frame,[x,-y,0])}
            result['modules'][name]={'construction':'flat rigid three-key PCB','frame':frame,'pads':pads}
            for which in ['near','home','far']:
                result['modules'][name+'_'+which]={'frame':board_frame(keys['thumb_'+which],hand,z),'pads':{}}
            rect=b.GetBoardEdgesBoundingBox()
            bounds=[rect.GetX()/1e6,-rect.GetBottom()/1e6,-config['thumb_pcb_thickness_mm'],rect.GetRight()/1e6,-rect.GetY()/1e6,0]
            solids.append({'id':name,'frame':frame,'bounds':bounds,'corners':box_corners(frame,bounds)})
            for fp,tp in [('W4','W1'),('W3','W2'),('W2','W3'),('W1','W4')]:wire(result,'finger_'+hand,fp+'/1',name,tp+'/1',config)
        else:
            for which in ['near','home','far']:
                name='thumb_'+hand+'_'+which; b=boards.get(name)
                connected=thumb_geometries is not None
                frame=board_frame(keys['thumb_'+which],hand,z)
                pads={}
                for f in ([] if connected else b.GetFootprints()):
                    if f.GetReference().startswith('W'):
                        p=pad_of(f,1); x,y=xy(p.GetPosition())
                        pads[f.GetReference()+'/1']={'net':p.GetNetname(),'at':world(frame,[x,-y,0])}
                result['modules'][name]={'frame':frame,'pads':pads}
                bounds=[-8.9,-11.5,-config.get('thumb_pcb_thickness_mm',1.6),8.9,8,0]
                solids.append({'id':name,'frame':frame,'bounds':bounds,'corners':box_corners(frame,bounds)})
            if thumb_geometries is not None:
                from .thumb_geometry import folded
                g=thumb_geometries[hand];pads={}
                for f in boards['thumb_'+hand].GetFootprints():
                    if not f.GetReference().startswith('W'):continue
                    p=pad_of(f,1);x,y=xy(p.GetPosition());pads[f.GetReference()+'/1']={'net':p.GetNetname(),'at':folded(g,'home',[[x,-y]],g['spec']['flex_thickness_mm']/2)[0].tolist()}
                result['modules']['thumb_'+hand]={'construction':'one connected FPC, three stiffened key areas','pads':pads}
                for fp,tp in [('W4','W1'),('W3','W2'),('W2','W3'),('W1','W4')]:wire(result,'finger_'+hand,fp+'/1','thumb_'+hand,tp+'/1',config)
            else:
                for fingerpad,which in [('W4','near'),('W3','home'),('W2','far')]:
                    wire(result,'finger_'+hand,fingerpad+'/1','thumb_'+hand+'_'+which,'W1/1',config)
                wire(result,'finger_'+hand,'W1/1','thumb_'+hand+'_near','W2/1',config)
                wire(result,'thumb_'+hand+'_near','W2/1','thumb_'+hand+'_home','W2/1',config)
                wire(result,'thumb_'+hand+'_home','W2/1','thumb_'+hand+'_far','W2/1',config)
    from .mount import integrate
    integrate(result,solids,config,out,chassis)
    # Test independently rotated bodies, including thumbs against finger islands.
    overlaps=[]
    for a,b in itertools.combinations(solids,2):
        ah=a['id'].split('_')[1] if a['id'].startswith('thumb') else a['id'][0]
        bh=b['id'].split('_')[1] if b['id'].startswith('thumb') else b['id'][0]
        if ah==bh and boxes_intersect(a,b): overlaps.append([a['id'],b['id']])
    result['checks'].append({'name':'rigid PCB island intersections','failures':overlaps})
    # The original thick plate reaches below the nominal MX PCB seating plane.
    # Generate a clearance subtraction for the updated printed chassis.
    result['required_chassis_changes']={'pcb_relief_depth_mm':max(0,z)+0.3,
                                        'wire_channels':'route wires within the case with a service loop and strain relief'}
    write_json(out/'assembly.json',result)
    if 'firmware' in result: write_json(out/'firmware-pinout.json',result['firmware'])
    scad=['// Generated nominal PCB seating and clearance tool. Units: mm.',
          '// mode="boards" previews rigid islands. mode="relief" is a subtraction tool.',
          'mode="boards";', 'module geometry(mode="boards") {']
    for s in solids:
        f=s['frame']; m=[[f['axes'][j][i] for j in range(3)]+[f['origin'][i]] for i in range(3)]+[[0,0,0,1]]
        lo=s['bounds'][:3]; size=[s['bounds'][i+3]-lo[i] for i in range(3)]
        scad += ['// '+s['id'],'multmatrix('+json.dumps(m)+')',
                 'if(mode=="boards") color("seagreen") translate('+json.dumps(lo)+') cube('+json.dumps(size)+');',
                 'else translate(['+str(lo[0]-.3)+','+str(lo[1]-.3)+',-3]) cube(['+str(size[0]+.6)+','+str(size[1]+.6)+',3.3]);']
    scad += ['}', 'module pcb_islands() { geometry("boards"); }', 'module pcb_reliefs() { geometry("relief"); }', 'geometry(mode);']
    (out/'assembly.scad').write_text('\n'.join(scad)+'\n')
    if 'flat_thumb' in chassis:
        f=result['modules']['thumb_r']['frame']
        m=[[f['axes'][j][i] for j in range(3)]+[f['origin'][i]] for i in range(3)]+[[0,0,0,1]]
        (out/'chassis-right.scad').write_text('// New thumb fit assembly, not a complete chassis. The old case is only a reference.\nuse <assembly.scad>\nuse <trackball-carrier.scad>\npcb_islands(); assembled_carrier();\nmultmatrix('+json.dumps(m)+') {\n import("mechanical/flat-thumb/thumb-pcb-support-ring.stl");\n translate([0,0,3.5]) import("mechanical/flat-thumb/thumb-switch-plate.stl");\n}\n')
        result['required_chassis_changes']['thumb_seats']='Replace example thumb seats with the shared coplanar layout; no claim of old-case drop-in fit.'

    lines=['# Thumb wiring','', ('One four-conductor matrix harness per connected thumb cluster. No wires between thumb keys.' if thumb_geometries is not None or 'flat_thumb' in chassis else 'Four conductors leave each finger PCB: one row wire per thumb key and a shared column. Daisy-chain the column through W2 on all three tiles. Use a continuous stripped/tinned section or two fine conductors at the near and home column pads, with chassis strain relief. Each rigid tile has its own socket and diode.'),'',
           '| From | To | Net | Suggested cut length |','|---|---|---|---:|']
    for w in result['wires']:
        lines.append('| '+w['from']+' | '+w['to']+' | '+w['net']+' | '+str(w['cut_length_mm'])+' mm |')
    lines+=['','Lengths are straight-line distance plus assembly slack; check the actual path through the case.',
            'Support the wire at the chassis before it reaches a solder pad. Do not strain a cut ligament.']
    if 'trackball_wiring' in result:
        lines += ['', '# Right trackball: direct pod harness', '', '| Pod pad | Trackball pad | Net | Module pin | GPIO |', '|---|---|---|---:|---:|']
        for w in result['trackball_wiring']:
            lines.append('| {pod_pad} | {trackball_pad} | {net} | {module_header_pin} | {gpio} |'.format(**w))
        lines += ['', 'Use seven flexible wires. Measure the pod-to-module path in the assembled case; pod placement is not modeled.', 'Four direction pulse inputs plus a click switch, all active low. Calibrate direction mapping in firmware.']
    result.setdefault('firmware',{})['lighting']={'enabled':False,'freed_gpios':[30,31]}
    write_json(out/'firmware-pinout.json',result['firmware'])
    write_json(out/'assembly.json',result)
    (out/'wiring.md').write_text('\n'.join(lines)+'\n')
    return result


def wire(result,a,pa,b,pb,config,net_pair=None):
    x=result['modules'][a]['pads'][pa]; y=result['modules'][b]['pads'][pb]
    if net_pair is not None:
        if (x['net'],y['net'])!=net_pair:raise ValueError('Incorrect harness net mapping')
    elif x['net']!=y['net']: raise ValueError('Harness shorts different nets')
    result['wires'].append({'from':a+':'+pa,'to':b+':'+pb,'net':x['net'],
                            'cut_length_mm':math.ceil(math.dist(x['at'],y['at'])+config['wire_slack_mm'])})
