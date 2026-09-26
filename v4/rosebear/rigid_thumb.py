"""Separate rigid thumb tiles mapped directly into their chassis key frames."""
import numpy as np
from shapely.geometry import Polygon,box
from shapely.ops import unary_union
from shapely.affinity import translate
from .thumb_geometry import frame
from .thumb_checks import holes


def geometry(chassis,config,hand,boards):
    thickness=config['thumb_pcb_thickness_mm']
    neutral=chassis['config']['plate_thickness']-config['plate_top_to_pcb_mm']-thickness/2
    poses={};islands={};components=[];apertures=[]
    for index,key in enumerate(['near','home','far']):
        center=np.array([index*30.,0.]);source=next(k for k in chassis['keys'] if k['id']=='thumb_'+key)
        origin,axes=frame(source,hand,neutral)
        poses[key]={'center':center,'rotation':np.eye(2),'world_origin':origin,'world_axes':axes}
        islands[key]=translate(box(-8.9,-11.5,8.9,8),center[0],0)
        board=boards['thumb_'+hand+'_'+key];apertures.append(translate(holes(board),center[0],0))
        components.extend([
            {'name':'SW_'+key,'owner':key,'polygon':translate(box(-8.8,1,7.5,6.5),center[0],0),'bottom':-thickness/2-3,'top':-thickness/2},
            {'name':'D_'+key,'owner':key,'polygon':translate(box(-1.5,-9.6,1.5,-8),center[0],0),'bottom':-thickness/2-1.5,'top':-thickness/2}])
    return {'rigid_tiles':True,'hand':hand,'poses':poses,'islands':islands,'pieces':[{'kind':'island','owner':key,'polygon':p} for key,p in islands.items()],
            'holes':unary_union(apertures),'components':components,
            'spec':{'flex_thickness_mm':thickness,'stiffener_thickness_mm':0,'case_base_extension_mm':3.0}}
