"""Sampled full-mesh clearance analysis and finite-bend review meshes."""
import hashlib,json,math
import numpy as np
import trimesh
from scipy.spatial import Delaunay
from scipy import ndimage
from shapely.geometry import Point,Polygon
from shapely.ops import unary_union
from shapely import contains_xy,prepare
from .thumb_geometry import folded,frame


def sample(poly,pitch=.5):
    lo=np.array(poly.bounds[:2]);hi=np.array(poly.bounds[2:]);xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+pitch,pitch),np.arange(lo[1],hi[1]+pitch,pitch));p=np.c_[xx.ravel(),yy.ravel()]
    inside=contains_xy(poly,p[:,0],p[:,1]);boundary=np.array(poly.exterior.coords[:-1]);points=[p[inside],boundary]
    for ring in poly.interiors:points.append(np.array(ring.coords[:-1]))
    return np.unique(np.round(np.concatenate(points),7),axis=0)

def solid(g,piece,bottom,top,pitch=.7):
    poly=piece['polygon'];points=sample(poly,pitch);tri=Delaunay(points).simplices
    domain=poly.buffer(1e-7);prepare(domain)
    tri=np.array([t for t in tri if domain.covers(Polygon(points[t]))]);n=len(points)
    vertices=np.r_[folded(g,piece['owner'],points,bottom,piece['kind']),folded(g,piece['owner'],points,top,piece['kind'])]
    faces=list(tri[:,::-1])+list(tri+n)
    edges={}
    for face in tri:
        for a,b in zip(face,np.roll(face,-1)):
            k=tuple(sorted((a,b)));edges[k]=edges.get(k,0)+1
    for (a,b),count in edges.items():
        if count==1:faces.extend([[a,b,b+n],[a,b+n,a+n]])
    m=trimesh.Trimesh(vertices=vertices,faces=faces,process=True);trimesh.repair.fix_normals(m)
    return m

def cap_hits(chassis,points,clearance=.0,hand='r'):
    hits=[]
    for key in chassis['keys']:
        o,R=frame(key,hand,0);p=(points-o)@R
        if np.any((np.abs(p[:,0])<=9+clearance)&(np.abs(p[:,1])<=9+clearance)&(p[:,2]>=chassis['config']['plate_thickness']-clearance)&(p[:,2]<=chassis['cap_top_height']+clearance)):hits.append(key['id'])
    return hits

def analyze(g,chassis,out,mesh_path,config):
    out.mkdir(parents=True,exist_ok=True);scene=trimesh.Scene();checks=[];cloud=[];cutters=[]
    # Strip metal and stiffeners are modeled separately. Switch and wire holes
    # are supplied by the board adapter in g['holes'].
    holes=g.get('holes',Polygon())
    for i,piece in enumerate(g['pieces']):
        poly=piece['polygon'].difference(holes)
        if poly.is_empty:continue
        if poly.geom_type!='Polygon':parts=list(poly.geoms)
        else:parts=[poly]
        for j,poly in enumerate(parts):
            part={**piece,'polygon':poly}
            top=g['spec']['flex_thickness_mm']/2
            if piece['kind']=='island':top+=g['spec']['stiffener_thickness_mm']
            bottom=-g['spec']['flex_thickness_mm']/2
            mesh=solid(g,part,bottom,top);mesh.visual.face_colors=[47,151,103,255] if piece['kind']=='island' else [224,167,46,255]
            scene.add_geometry(mesh,node_name=f'{piece["kind"]}_{piece["owner"]}_{i}_{j}')
            pts=sample(poly,.4)
            for z in [bottom,top]:cloud.append((f'{piece["kind"]}_{piece["owner"]}',folded(g,piece['owner'],pts,z,piece['kind'])))
            # Clearance tool for a controlled seating pocket in the printed case.
            relief={**part,'polygon':poly.buffer(.3)}
            cutters.append(solid(g,relief,bottom-1,top+.3))
    for component in g.get('components',[]):
        part={'owner':component['owner'],'kind':'island','polygon':component['polygon']}
        mesh=solid(g,part,component['bottom'],component['top']);mesh.visual.face_colors=[55,63,72,255]
        scene.add_geometry(mesh,node_name=component['name'])
        pts=sample(component['polygon'],.4)
        for z in [component['bottom'],component['top']]:cloud.append(('component_'+component['owner'],folded(g,component['owner'],pts,z)))
        relief={**part,'polygon':component['polygon'].buffer(.3)}
        cutters.append(solid(g,relief,component['bottom']-.3,component['top']+.3))
    merged=np.concatenate([p for _,p in cloud]);checks.append({'name':'Thumb boards vs keycap envelopes','failures':cap_hits(chassis,merged,.2,g['hand'])})
    # Conservative envelopes for neighbouring switch housings and hotswap sockets.
    hardware=[]
    for label,pts in cloud:
        owner=label.split('_',1)[1]
        for key in chassis['keys']:
            if key['id']=='thumb_'+owner:continue
            o,R=frame(key,g['hand'],0);p=(pts-o)@R
            for name,lo,hi in [('switch',[-7,-7,.1],[7,7,5.1]),('socket',[-8.8,1,-3.5],[7.5,6.5,-.5])]:
                hit=np.all((p>=np.array(lo)-.15)&(p<=np.array(hi)+.15),axis=1)
                if np.any(hit):hardware.append([label,key['id'],name])
    checks.append({'name':'Thumb PCB/components vs neighbouring switch/socket envelopes, 0.15 mm margin','failures':hardware})
    if g['hand']=='r' and config['trackball']['enabled']:
        key=next(k for k in chassis['keys'] if k['id']==config['trackball']['anchor'])
        o,R=frame(key,'r',chassis['config']['plate_thickness']-config['plate_top_to_pcb_mm']);o=o+R@np.array(config['trackball']['offset_mm'])
        p=(merged-o)@R;hit=np.all((p>=np.array([-16,-13,-5])-.3)&(p<=np.array([16,13,7])+.3),axis=1)
        checks.append({'name':'Thumb PCB/components vs trackball carrier envelope, 0.3 mm margin','failures':p[hit][:5].tolist()})
        carrier=trimesh.creation.box(extents=[32,26,12]);M=np.eye(4);M[:3,:3]=R;M[:3,3]=o+R@np.array([0,0,1]);carrier.apply_transform(M);carrier.visual.face_colors=[115,82,176,90];scene.add_geometry(carrier,node_name='trackball_clearance_envelope')
    scene.export(str(out/'thumb-folded.glb'));trimesh.util.concatenate(cutters).export(str(out/'thumb-relief.stl'))
    # Exact finite-radius return to the key frames.
    errors={}
    for name,pose in g['poses'].items():
        p=np.array(g['islands'][name].exterior.coords[:-1]);local=(p-pose['center'])@pose['rotation'];expected=np.array([pose['world_origin']+pose['world_axes']@np.r_[v,0] for v in local]);actual=folded(g,name,p)
        errors[name]=float(np.max(np.linalg.norm(actual-expected,axis=1)))
    checks.append({'name':'key-frame placement error below 0.001 mm','errors_mm':errors,'failures':[n for n,e in errors.items() if e>.001]})
    result={'checks':checks,'mesh_source':str(mesh_path),'mesh_sha256':hashlib.sha256(mesh_path.read_bytes()).hexdigest(),
            'sampling_pitch_mm':.4,'status':'digital prototype; source chassis needs generated reliefs and a physical fit test'}
    case=trimesh.load(mesh_path,process=True);result['source_mesh_watertight']=bool(case.is_watertight)
    if g['hand']=='l':
        case.apply_transform(np.diag([-1,1,1,1]));result['source_mesh_transform']='mirror right source mesh across world X=0'
    # Retain the original base wall/screw-hole profile while lowering the
    # bottom datum enough to clear the far-key components.
    section=case.section(plane_normal=[0,0,1],plane_origin=[0,0,.5])
    ring=Polygon()
    for loop in section.discrete:
        if np.linalg.norm(loop[0]-loop[-1])>1e-6:raise ValueError('Open chassis base section')
        poly=Polygon(loop[:,:2])
        if not poly.is_valid:raise ValueError('Invalid chassis base contour')
        ring=ring.symmetric_difference(poly)
    height=g['spec']['case_base_extension_mm'];base_parts=[]
    dummy={'home_origin':np.zeros(3),'home_axes':np.eye(3)}
    for poly in ([ring] if ring.geom_type=='Polygon' else ring.geoms):
        base_parts.append(solid(dummy,{'owner':'home','kind':'island','polygon':poly},-height,0,pitch=1.5))
    base=trimesh.util.concatenate(base_parts)
    if not base.is_watertight:raise ValueError('Generated base extension is not watertight')
    base.export(str(out/'case-base-extension.stl'))
    min_z=float(merged[:,2].min());bottom_clearance=min_z+height
    checks.append({'name':'component clearance above proposed bottom datum >= 1 mm','clearance_mm':bottom_clearance,'failures':[] if bottom_clearance>=1 else ['bottom interference']})
    result['base_extension']={'height_mm':height,'original_component_min_z_mm':min_z,'proposed_bottom_z_mm':-height,'clearance_mm':bottom_clearance,'source_section_z_mm':.5,'mesh_watertight':True}
    base.visual.face_colors=[120,135,145,255];scene.add_geometry(base,node_name='case_base_extension')
    case.visual.face_colors=[180,190,205,70];scene.add_geometry(case,node_name='existing_chassis');scene.export(str(out/'thumb-in-chassis.glb'))
    # Voxelize the full source surface. This tolerates the source STL's small
    # non-manifold defects; uncertainty is recorded rather than claiming exact CAD clearance.
    cache=out.parent/('chassis-voxels-'+result['mesh_sha256'][:16]+'-'+g['hand']+'.npz');pitch=.3
    source_cache=out.parent/('chassis-voxels-'+result['mesh_sha256'][:16]+'-r.npz')
    if cache.exists() or (g['hand']=='l' and source_cache.exists()):
        d=np.load(cache if cache.exists() else source_cache);occupancy=d['occupancy'];transform=d['transform']
        if g['hand']=='l' and not cache.exists():transform=np.diag([-1,1,1,1])@transform
    else:
        vox=case.voxelized(pitch).fill();occupancy=vox.matrix;transform=vox.transform;np.savez_compressed(cache,occupancy=occupancy,transform=transform)
    inv=np.linalg.inv(transform);distance=ndimage.distance_transform_edt(~occupancy)*pitch
    clashes=[]
    for name,pts in cloud:
        ijk=np.rint(trimesh.transform_points(pts,inv)).astype(int);valid=np.all((ijk>=0)&(ijk<np.array(occupancy.shape)),axis=1);ix=ijk[valid]
        near=distance[tuple(ix.T)]<.3
        if np.any(near):clashes.append({'part':name,'sample_count':int(np.sum(near)),'example_points_mm':pts[valid][near][:6].tolist()})
    result['original_chassis_surface_screen']={'voxel_pitch_mm':pitch,'required_clearance_mm':.3,'clashes':clashes,
        'interpretation':'Conflicts require the supplied seating/bridge relief; voxel screening is approximate and does not qualify wall strength.'}
    from .thumb_artifacts import folded_drawing
    folded_drawing(out/'thumb-folded.glb',out/'thumb-folded.svg')
    (out/'mechanical-report.json').write_text(json.dumps(result,indent=2)+'\n')
    mirrored='mirror([1,0,0]) ' if g['hand']=='l' else ''
    (out/'chassis-thumb-relief.scad').write_text('// Proposed chassis: 2 mm base extension and component/bridge relief.\ndifference() { union() { '+mirrored+'import("'+str(mesh_path)+'"); import("case-base-extension.stl"); } import("thumb-relief.stl"); }\n')
    return result
