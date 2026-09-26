"""One coplanar thumb layout drives copper, switch frames and fit prototypes."""
import copy,json,math
import numpy as np
from shapely.geometry import Polygon,box,Point
from shapely.ops import unary_union,triangulate
from shapely.affinity import affine_transform
from . import pcb as adapter
from .mechanical import rotate


def spec(root):
    s=json.loads((root/'v4/flat_thumb.json').read_text())
    if [k['name'] for k in s['keys']]!=['near','home','far']:raise ValueError('Expected near/home/far order')
    return s


def point(key,p,hand='r'):
    t=math.radians(key['yaw_deg']);x,y=p
    x,y=x*math.cos(t)-y*math.sin(t),x*math.sin(t)+y*math.cos(t)
    x+=key['center_mm'][0];y+=key['center_mm'][1]
    return np.array([x if hand=='r' else -x,y])


def polygon(key,p,hand='r'):
    return Polygon([point(key,q,hand) for q in p.exterior.coords])


def chassis_layout(chassis,s):
    c=copy.deepcopy(chassis);home=next(k for k in chassis['keys'] if k['id']=='thumb_home')
    A=np.array(home['axes']).T
    R=np.array([rotate(p,s['cluster_rotation_deg']) for p in np.eye(3)]).T
    A=A@R;o=np.array(home['origin'])+np.array(home['axes']).T@np.array(s['cluster_offset_mm'])
    for k in c['keys']:
        if k['column']!='thumb':continue
        q=next(q for q in s['keys'] if 'thumb_'+q['name']==k['id']);t=math.radians(q['yaw_deg'])
        Z=np.array([[math.cos(t),-math.sin(t),0],[math.sin(t),math.cos(t),0],[0,0,1]])
        k['origin']=(o+A@np.r_[q['center_mm'],0]).tolist();k['axes']=(A@Z).T.tolist()
    c['flat_thumb']={'origin':o.tolist(),'axes':A.T.tolist(),'layout':s}
    return c


def boundary(s,hand):
    islands=[polygon(k,box(-9.4,-12,9.4,8.5),hand) for k in s['keys']]
    rail=box(-8,-15,8,-10)
    return unary_union(islands+[rail]).convex_hull


def make(root,s,hand):
    import pcbnew as pcb
    b=pcb.BOARD();col='COL_'+hand.upper()+'_THUMB';side=1 if hand=='r' else -1
    # Proper land-pattern rotations on each hand, never reflected socket pads.
    def coord(k,p):
        center=point(k,(0,0),hand);t=math.radians(k['yaw_deg']*(1 if hand=='r' else -1))
        x,y=p;v=center+np.array([x*math.cos(t)-y*math.sin(t),x*math.sin(t)+y*math.cos(t)])
        return (float(v[0]),float(-v[1]))
    def via(p,n):
        v=pcb.PCB_VIA(b);v.SetPosition(adapter.vec(*p));v.SetWidth(600000);v.SetDrill(300000);v.SetViaType(pcb.VIATYPE_THROUGH);v.SetLayerPair(pcb.F_Cu,pcb.B_Cu);v.SetNet(adapter.net(b,n));b.Add(v)
    nodes=[]
    for i,k in enumerate(s['keys'],1):
        row='ROW_'+hand.upper()+'_'+k['row'];swd='SWD_'+hand.upper()+'_THUMB_'+k['name'].upper()
        angle=k['yaw_deg']*(1 if hand=='r' else -1)
        sw=adapter.footprint(b,root,'rosebear:SW_Hotswap_Kailh_MX_1.00u_PCB','SW'+str(i),coord(k,(0,0)),{'1':col,'2':swd},angle=angle)
        d=adapter.footprint(b,root,'Diode_SMD:D_SOD-123','D'+str(i),coord(k,(0,-8.8)),{'1':row,'2':swd},angle=angle,back=True)
        a=adapter.xy(adapter.pad_of(sw,2).GetPosition());z=adapter.xy(adapter.pad_of(d,2).GetPosition())
        adapter.track(b,[a,coord(k,(-8,3.75)),coord(k,(-8,-7)),coord(k,(1.65,-7)),z],'B.Cu',swd,.25)
        a=adapter.xy(adapter.pad_of(d,1).GetPosition());v=coord(k,(-4,-8.8));via(v,row)
        adapter.track(b,[a,v],'B.Cu',row,.25)
        wp=(-6.+(i-1)*4.,12.5)
        adapter.wirepad(b,root,'W'+str(i),row,wp)
        # Escape to the left of all switch drill holes before approaching harness.
        if i==1:route=[v,(-9.,v[1]),(-9.,wp[1]),wp]
        elif i==2:route=[v,wp]
        else:route=[v,(-8.,v[1]),(-8.,14.3),(wp[0],14.3),wp]
        adapter.track(b,route,'F.Cu',row,.25)
        a=adapter.xy(adapter.pad_of(sw,1).GetPosition());end=coord(k,(7.8,-10.5))
        adapter.track(b,[a,coord(k,(7.8,6.25)),end],'B.Cu',col,.25);nodes.append(end)
        adapter.label(b,k['name'].upper(),coord(k,(0,-2.9)))
    # Common column uses the right side of the broad board, clear of socket pads.
    bus=max(n[0] for n in nodes)+.8
    for n in nodes:adapter.track(b,[n,(bus,n[1])],'B.Cu',col,.25)
    adapter.track(b,[(bus,min(n[1] for n in nodes)),(bus,max(n[1] for n in nodes))],'B.Cu',col,.25)
    wp=(6.,12.5);adapter.wirepad(b,root,'W4',col,wp)
    for text,x in [('N',-6),('H',-2),('F',2),('C',6)]:adapter.label(b,text,(x,10.5),.8)
    adapter.track(b,[nodes[1],(bus,nodes[1][1]),(bus,wp[1]),wp],'B.Cu',col,.25)
    shape=boundary(s,hand)
    copper_points=[Point(adapter.xy(t.GetStart())[0],-adapter.xy(t.GetStart())[1]) for t in b.GetTracks()]
    copper_points += [Point(adapter.xy(t.GetEnd())[0],-adapter.xy(t.GetEnd())[1]) for t in b.GetTracks()]
    shape=unary_union([shape]+[p.buffer(1.5) for p in copper_points]).convex_hull
    adapter.outline(b,[(float(x),float(-y)) for x,y in list(shape.exterior.coords)[:-1]])
    return b,shape


def export_prototype(s,shape,out,hand='r'):
    """Watertight triangulated extrusion, no CAD GUI or native boolean worker."""
    import trimesh
    out.mkdir(parents=True,exist_ok=True)
    openings=[polygon(k,box(-s['switch_cutout_mm']/2,-s['switch_cutout_mm']/2,s['switch_cutout_mm']/2,s['switch_cutout_mm']/2),hand) for k in s['keys']]
    shape=shape.simplify(.02,preserve_topology=True)
    plate=shape.buffer(2,join_style=2).difference(unary_union(openings))
    def extrude(poly,height):
        mesh=trimesh.creation.extrude_polygon(poly,height,engine='earcut')
        if not mesh.is_watertight:raise ValueError('Prototype mesh is not watertight')
        return mesh
    mesh=extrude(plate,s['plate_thickness_mm']);mesh.export(out/('thumb-switch-plate'+('' if hand=='r' else '-l')+'.stl'))
    # Separate spacer rests on PCB front face, outside socket/stem envelopes.
    spacer=shape.buffer(2,join_style=2).difference(shape.buffer(s['fit_clearance_mm']))
    support=extrude(spacer,3.5);support.export(out/('thumb-pcb-support-ring'+('' if hand=='r' else '-l')+'.stl'))
    (out/'README.md').write_text('# Flat thumb fit coupon\n\nParts without a suffix are right-hand; -l files are left-hand. Use the matching hand: board outlines and wire escapes differ. All are shown in local flat coordinates. Print the switch plate and PCB support ring separately. Plate uses 14 mm square cutouts and 1.5 mm clip thickness. Ring is an alignment spacer, not a latched PCB retainer. Assemble over the matching PCB with temporary clamps; verify the 5 mm plate-top-to-PCB datum, switch clips, hotswap seating and wire access. Do not force an undersized print over a switch. This is a fit coupon, not a complete chassis.\n')
    return {'plate_watertight':bool(mesh.is_watertight),'support_watertight':bool(support.is_watertight)}
