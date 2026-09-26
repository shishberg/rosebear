"""Trackball-placement comparisons, each with its own anchored perimeter."""
import copy
import json
from pathlib import Path
import numpy as np
from .chassis import frame, layout
from .chassis_surface import WellSurface


def anchored_outline(cfg, points, names):
    anchors,_=layout(cfg)
    for name in ['adapter','trackball']:
        item=cfg[name];anchors[name]=frame(item['position_mm'],item['rotation_deg'])
    controls=[]
    for xy,name in zip(points,names):
        pose=anchors[name];z=WellSurface.plane(pose,*xy)
        offset=(np.linalg.inv(pose)@np.r_[xy,z,1])[:3]
        controls.append({'anchor':name,'offset_mm':np.round(offset,4).tolist()})
    cfg['surface']['outline_controls']=controls


def comparison_configs(base):
    results=[('current','Front trackball · inner FFC',copy.deepcopy(base))]
    original=WellSurface(base).outline_points().tolist()
    for code,title in [('ffc_back','Inner trackball · FFC farther back'),('ffc_below','Inner trackball · FFC underneath')]:
        cfg=copy.deepcopy(base)
        # At -30 degrees the right edge rises toward the finger well. Keep
        # the mounting plane low enough that it cannot canopy adjacent caps.
        cfg['trackball']['position_mm']=[-76,-30,1]
        cfg['trackball']['rotation_deg']=[0,-30,0]
        cfg['trackball']['opening_depth_below_mm']=14
        cfg['shell']['fasteners_xy_mm'][3]=[-82,-50]
        cfg['adapter']['position_mm']=[-76,10,-9] if code=='ffc_back' else [-76,-30,-17]
        cfg['switch']['cutout_depth_overrides_mm']={'matrix_inner_bottom':14}
        cfg['ribbon']['exit_y_mm']=cfg['adapter']['position_mm'][1]
        cfg['surface']['palm_reference']={'position_mm':[0,-54,6],'rotation_deg':[0,0,0]}
        cfg['surface']['thumb_bridge_relief']={'center_mm':[-18,-38],'radii_mm':[9,4],'drop_mm':4}
        cfg['surface']['trackball_patch']={'shape':'well_join','join_x_mm':[14,21],'bottom_y_mm':-15,'bottom_slope':.5,'bottom_slope_start_x_mm':12,'bottom_blend_mm':4,'upper_blend_y_mm':[30,44],'mesh_pitch_mm':1.1,'sampling_radius_mm':35}
        points=original[:9]+[[-7,-43],[-10,-65]]+original[11:18]
        names=[c['anchor'] for c in base['surface']['outline_controls'][:9]]+['thumb_near','thumb_near']+[c['anchor'] for c in base['surface']['outline_controls'][11:18]]
        if code=='ffc_back':
            points += [[-90,-44],[-90,-16],[-88,-13],[-87,9],[-87,27],[-66,30]]
            names += ['trackball','trackball','trackball','adapter','adapter','matrix_inner_top']
        else:
            points += [[-90,-44],[-90,-16],[-88,-13],[-86,-9],[-65,6],[-63,28]]
            names += ['trackball','trackball','trackball','adapter','matrix_inner_home','matrix_inner_top']
        anchored_outline(cfg,points,names)
        cfg['surface']['outline_controls'][10]={'anchor':'thumb_near','pcb_edge':[1,-1]}
        cfg['surface']['outline_controls'][11:18]=copy.deepcopy(base['surface']['outline_controls'][11:18])
        results.append((code,title,cfg))
    return results


def save_configs(base, directory):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    for code,title,cfg in comparison_configs(base):
        (directory/(code+'.json')).write_text(json.dumps(cfg,indent=2)+'\n')


def assemble_comparison(base, output):
    """One offline selector; only the selected model gets GPU buffers."""
    import os
    import zipfile
    from .chassis import PALETTE
    from .chassis_view import write_viewer
    output=Path(output);datasets=[];summary=[]
    for code,label,cfg in comparison_configs(base):
        directory=output if code=='current' else output/'variants'/code
        if json.loads((directory/'config.json').read_text()) != cfg:
            raise ValueError('Stale comparison geometry: '+code)
        report=json.loads((directory/'report.json').read_text())
        relative='' if code=='current' else 'variants/'+code+'/'
        datasets.append({'id':code,'label':label,'directory':relative,'objects':json.loads((directory/'viewer-data.json').read_text()),'report':report})
        summary.append({'id':code,'label':label,'directory':relative,'warnings':report['warnings'],'parts':report['parts']})
    temporary=output/'preview.next.html'
    write_viewer(temporary,datasets[0]['objects'],datasets[0]['report'],PALETTE,variants=datasets)
    os.replace(temporary,output/'preview.html')
    (output/'comparison.json').write_text(json.dumps(summary,indent=2)+'\n')
    archive=output/'comparison.next.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for file in sorted(output.rglob('*')):
            if file.is_file() and file.suffix!='.zip':z.write(file,file.relative_to(output))
    os.replace(archive,output/'rosebear-chassis-prototype.zip')
    print('Created three-arrangement selector: '+str(output/'preview.html'),flush=True)


def build_comparison(base, output):
    from .chassis import build
    output=Path(output)
    for code,label,cfg in comparison_configs(base):
        print('Arrangement: '+label,flush=True)
        build(cfg,output if code=='current' else output/'variants'/code)
    assemble_comparison(base,output)
