"""Finite-radius development of a connected thumb FPC with outboard bend strips."""
import math
import numpy as np
from shapely.geometry import Polygon,LineString,Point
from shapely.ops import unary_union,nearest_points


def unit(a):return a/np.linalg.norm(a)
def rotation(u,t):
    u=unit(np.asarray(u));x,y,z=u;K=np.array([[0,-z,y],[z,0,-x],[-y,x,0]])
    return np.eye(3)*math.cos(t)+(1-math.cos(t))*np.outer(u,u)+math.sin(t)*K

def frame(key,hand,z):
    axes=np.array(key['axes']).T;origin=np.array(key['origin'])+axes[:,2]*z
    if hand=='l':
        mirror=np.diag([-1,1,1]);origin=mirror@origin;axes=mirror@axes@np.diag([-1,1,1])
    return origin,axes

def polygon_coords(p):return [list(x) for x in p.exterior.coords[:-1]]

def build(chassis,config,spec,hand):
    # The switch seating datum is the top of the stiffener. Fold the FPC neutral plane.
    neutral=chassis['config']['plate_thickness']-config['plate_top_to_pcb_mm']-spec['stiffener_thickness_mm']-spec['flex_thickness_mm']/2
    keys={k['id'].removeprefix('thumb_'):k for k in chassis['keys'] if k['column']=='thumb'}
    home_o,home_R=frame(keys['home'],hand,neutral)
    local=np.array([[-8.9,-10.5],[8.9,-10.5],[8.9,8],[-8.9,8]])
    poses={};hinges={};islands={}
    for name,key in keys.items():
        o,R=frame(key,hand,neutral)
        if name=='home': M=np.eye(3);h=np.zeros(3);delta=np.zeros(2)
        else:
            n,m=home_R[:,2],R[:,2];projection=m-n*np.dot(m,n)
            h=home_o+projection*np.dot(m,o-home_o)/np.dot(projection,projection)
            axis=unit(np.cross(m,n));theta=math.acos(np.clip(np.dot(m,n),-1,1));M=rotation(axis,theta)
            flat_h=(home_R.T@(h-home_o))[:2];u=(home_R.T@axis)[:2];u=unit(u)
            normal=np.array([-u[1],u[0]])
            flat_o=(home_R.T@(h+M@(o-h)-home_o))[:2]
            if np.dot(flat_o,normal)<0:u=-u;normal=-normal
            world_axis=home_R[:,:2]@u
            phi=math.atan2(np.dot(world_axis,np.cross(n,m)),np.dot(n,m))
            radius=spec['bend_radius_mm'];q=radius*math.tan(abs(phi)/2);arc=radius*abs(phi)
            delta=normal*(arc-2*q)
            x=(-1 if hand=='r' else 1)*spec['bridge_outboard_x_mm']
            c=flat_h+u*(x-flat_h[0])/u[0]
            hinges[name]={'point':flat_h,'axis':u,'normal':normal,'center':c,'angle':phi,'radius':radius,
                          'tangent_setback':q,'arc_length':arc,'flat_shift':delta,'world_axis':world_axis,'world_point':h}
        flat_o=(home_R.T@((o if name=='home' else h+M@(o-h))-home_o))[:2]+delta
        flat_R=(home_R.T@M@R)[:2,:2]
        poly=Polygon(local@flat_R.T+flat_o)
        islands[name]=poly
        poses[name]={'center':flat_o,'rotation':flat_R,'world_origin':o,'world_axes':R,
                     'angle_deg':math.degrees(math.atan2(flat_R[1,0],flat_R[0,0]))}
    pieces=[{'kind':'island','owner':n,'polygon':p} for n,p in islands.items()];branches={}
    for name,h in hinges.items():
        c,n,u=h['center'],h['normal'],h['axis'];q,L=h['tangent_setback'],h['arc_length'];width=spec['bridge_width_mm']
        a=c-q*n;b=c+(L-q)*n
        # Each straight arm reaches the bend perpendicular to its axis.
        pa=a-3*n;pb=b+3*n
        side=-1 if hand=='r' else 1
        ea=poses['home']['center']+poses['home']['rotation']@np.array([side*(8 if hand=='l' else 7),5.8 if name=='near' else -7.0])
        eb=poses[name]['center']+poses[name]['rotation']@np.array([side*(8 if hand=='l' else 7),-7.0 if name=='near' else 5.8])
        xa=poses['home']['center']+poses['home']['rotation']@np.array([side*13,5.8 if name=='near' else -7.0])
        xb=poses[name]['center']+poses[name]['rotation']@np.array([side*13,-7.0 if name=='near' else 5.8])
        ac=LineString([ea,xa,pa,a]);bc=LineString([b,pb,xb,eb]);centerline=LineString([ea,xa,pa,a,b,pb,xb,eb])
        arms=[ac.buffer(width/2,cap_style=2,join_style=1,resolution=12),bc.buffer(width/2,cap_style=2,join_style=1,resolution=12)]
        bend=Polygon([a-u*width/2,a+u*width/2,b+u*width/2,b-u*width/2])
        pieces.extend([{'kind':'arm','owner':'home','polygon':arms[0]}, {'kind':'bend','owner':name,'polygon':bend}, {'kind':'arm','owner':name,'polygon':arms[1]}])
        branches[name]={'centerline':centerline,'bend':bend,'arms':arms}
    outline=unary_union([p['polygon'] for p in pieces]).buffer(.002).buffer(-.002).simplify(.001,preserve_topology=True)
    if outline.geom_type!='Polygon':raise ValueError('Thumb outline is disconnected')
    return {'hand':hand,'home_origin':home_o,'home_axes':home_R,'neutral_z':neutral,'poses':poses,'islands':islands,
            'hinges':hinges,'branches':branches,'pieces':pieces,'outline':outline,'spec':spec}

def folded(g,owner,points,z=0,kind='island',fraction=1):
    points=np.atleast_2d(points);out=[]
    if g.get('rigid_tiles'):
        pose=g['poses'][owner]
        return np.array([pose['world_origin']+pose['world_axes']@np.r_[(p-pose['center'])@pose['rotation'],z] for p in points])
    if owner=='home':return np.array([g['home_origin']+g['home_axes']@np.array([p[0],p[1],z]) for p in points])
    h=g['hinges'][owner];u,n=h['axis'],h['normal'];phi=h['angle']*fraction
    axis=g['home_axes'][:,:2]@u
    for p in points:
        if kind=='bend':
            s=np.dot(p-h['center'],n);v=np.dot(p-h['center'],u);travel=np.clip(s+h['tangent_setback'],0,h['arc_length'])
            # Keep neutral-axis length fixed throughout the assembly motion.
            alpha=phi*travel/h['arc_length']
            r=h['arc_length']/abs(phi) if abs(phi)>1e-12 else None
            advance=travel if r is None else r*math.sin(abs(alpha))
            rise=0 if r is None else math.copysign(r*(1-math.cos(alpha)),phi)
            start=h['center']-h['tangent_setback']*n
            local2=start+v*u+advance*n
            normal=g['home_axes']@np.array([-n[0]*math.sin(alpha),-n[1]*math.sin(alpha),math.cos(alpha)])
            out.append(g['home_origin']+g['home_axes']@np.array([local2[0],local2[1],rise])+normal*z)
        else:
            # Attach the island/arm rigidly to the end of the finite bend.
            b=h['center']+(h['arc_length']-h['tangent_setback'])*n
            end=folded(g,owner,[b],0,'bend',fraction)[0]
            rel=p-b
            out.append(end+rotation(axis,phi)@(g['home_axes']@np.array([rel[0],rel[1],z])))
    return np.array(out)
