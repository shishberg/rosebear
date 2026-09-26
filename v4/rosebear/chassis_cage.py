"""Sparse, feature-aligned roof topology and procedurally derived wall rows.

The authored roof is one connected quad mesh. Named positions are anchored to
hardware bounds, not samples of a rectangular parameter grid. Walls are derived
from the same boundary and participate in the same subdivision evaluation.
"""
import numpy as np
from scipy import sparse
from scipy.spatial import cKDTree
from .chassis import points


def ordered_boundary(quads):
    edges={}
    for f in quads:
        for a,b in zip(f,np.roll(f,-1)):
            edges.setdefault(tuple(sorted((int(a),int(b)))),[]).append((int(a),int(b)))
    boundary=[es[0] for es in edges.values() if len(es)==1]
    if any(len(es)>2 for es in edges.values()):raise ValueError('Nonmanifold roof cage')
    next_vertex=dict(boundary)
    if len(next_vertex)!=len(boundary):raise ValueError('Branched roof boundary')
    start=boundary[0][0];out=[start];v=next_vertex[start]
    while v!=start:
        if v in out or v not in next_vertex:raise ValueError('Invalid roof boundary')
        out.append(v);v=next_vertex[v]
    if len(out)!=len(boundary):raise ValueError('Roof needs one boundary loop')
    return out


def sparse_roof(cfg,nodes,spec):
    """Thirty core controls plus optional ball-land and thumb-join controls."""
    margin=spec.get('roof_clearance_mm',5.)
    tile=cfg['tile'];w,d,t=tile['size_mm'];z=-tile['plate_top_to_pcb_top_mm']-t/2
    def bounds(name,size=None,zplane=z):
        a,b=(size or [w,d])[:2]
        xy=points(nodes[name],[[sx*a/2,sy*b/2,zplane] for sx in [-1,1] for sy in [-1,1]])[:,:2]
        return np.r_[xy.min(axis=0),xy.max(axis=0)]
    fingers=np.array([bounds(n) for n in nodes if n.startswith('matrix_')])
    thumbs=np.array([bounds('thumb_'+n) for n in ['far','home','near']])
    ball=bounds('trackball',cfg['trackball']['board_mm'],-cfg['trackball']['board_top_below_deck_mm'])
    left=fingers[:,0].min()-margin;right=fingers[:,2].max()+margin
    front=fingers[:,1].min()-margin;back=fingers[:,3].max()+margin
    outer=ball[0]-margin
    # Rows run palm to fingertips. Three thumb spans join four well spans;
    # the extra left-hand face is the ball shelf, with no overlapping patches.
    xs=[outer,left,nodes['matrix_index_home'][0,3],thumbs[2,2]+margin,
        nodes['matrix_ring_home'][0,3]+4,right]
    xy={};names={}
    def put(i,j,x,y,label):xy[i,j]=[float(x),float(y)];names[i,j]='top:'+label
    thumb_low=thumbs[:,1].min()-margin
    thumb_high=thumbs[:,3].max()+margin
    # Front and middle thumb rows follow its rotated PCB envelope.
    front_x=[thumbs[0,0]-margin, nodes['thumb_far'][0,3], nodes['thumb_home'][0,3],thumbs[2,2]+margin]
    for i in range(4):
        yy=thumb_low+(front_x[i]-front_x[0])*.19
        put(i,0,front_x[i],yy,['thumb_outer_front','thumb_far_front','thumb_home_front','thumb_inner_front'][i])
    mid_y=float(np.mean([nodes['thumb_'+n][1,3] for n in ['far','home','near']]))
    for i,x in enumerate([outer,nodes['thumb_far'][0,3],nodes['thumb_home'][0,3],thumbs[2,2]+margin]):
        put(i,1,x,mid_y+(x-nodes['thumb_home'][0,3])*.16,
            ['thumb_outer_side','thumb_far','thumb_home','thumb_inner_side'][i])
    for i,x in enumerate(xs):
        y=front
        if i==0:y=min(ball[1]-margin,thumb_high)
        if i==1:y=nodes['matrix_inner_bottom'][1,3]-d/2-margin
        if i==2:y=nodes['matrix_index_bottom'][1,3]-d/2-margin
        if i==3:y=bounds('matrix_middle_bottom')[1]-margin
        if i==4:y=bounds('matrix_ring_bottom')[1]-margin
        put(i,2,x,y,['ball_front','well_inner_front','well_index_front','thumb_well_join','well_ring_front','well_outer_front'][i])
    for i,x in enumerate(xs):
        # Ball back edge climbs into the inner well rather than forming a notch.
        y=ball[3]+margin if i==0 else -cfg['geometry']['row_pitch_mm']*(9/24.5)
        put(i,3,x,y,['ball_back','well_inner_low','well_index_low','well_middle_low','well_ring_low','well_outer_low'][i])
    for j,y in [(4,cfg['geometry']['row_pitch_mm']*(12/24.5)),(5,back)]:
        for i in range(1,6):
            x=xs[i]
            if i==3:x=nodes['matrix_middle_home'][0,3]
            yy=y
            if j==5:
                if i==1:yy=bounds('matrix_inner_top')[3]+margin
                if i==5:yy=bounds('matrix_pinky_top')[3]+margin
            put(i,j,x,yy,'well_'+['','inner','index','middle','ring','outer'][i]+('_upper' if j==4 else '_back'))
    if spec.get('thumb_join_row',False):
        # A single extra loop at the steep thumb/well transition, rather than
        # adding rows over the entire shallow finger well.
        xy={(i,2*j):p for (i,j),p in xy.items()};names={(i,2*j):label for (i,j),label in names.items()}
        for i in range(4):
            xy[i,3]=((np.asarray(xy[i,2])+np.asarray(xy[i,4]))/2).tolist()
            names[i,3]='top:thumb_join_'+['outer','far','home','inner'][i]
        levels=sorted(set(j for i,j in xy));remap={j:k for k,j in enumerate(levels)}
        xy={(i,remap[j]):p for (i,j),p in xy.items()};names={(i,remap[j]):label for (i,j),label in names.items()}
    coords=sorted(xy,key=lambda p:(p[1],p[0]));idx={p:i for i,p in enumerate(coords)};quads=[]
    for i,j in coords:
        corners=[(i,j),(i+1,j),(i+1,j+1),(i,j+1)]
        if all(p in idx for p in corners):quads.append([idx[p] for p in corners])
    p=np.array([xy[k] for k in coords]);labels=[names[k] for k in coords]
    if spec.get('ball_control_ring',False):
        ball_row=3 if spec.get('thumb_join_row',False) else 2
        outer_face=[idx[k] for k in [(0,ball_row),(1,ball_row),(1,ball_row+1),(0,ball_row+1)]]
        quads.remove(outer_face)
        polygon=p[outer_face];center=polygon.mean(axis=0)
        added=center+.68*(polygon-center);start=len(p);p=np.vstack([p,added]);inner=list(range(start,start+4))
        labels.extend('top:ball_'+name for name in ['outer_front_land','inner_front_land','inner_back_land','outer_back_land'])
        quads.append(inner)
        for k in range(4):
            j=(k+1)%4;quads.append([outer_face[k],outer_face[j],inner[j],inner[k]])
    q=np.asarray(quads,dtype=int)
    # A crossed control face is never repaired by deleting faces.
    for f in q:
        for k in range(4):
            a,b,c=p[f[k]],p[f[(k+1)%4]],p[f[(k-1)%4]]
            if np.cross(b-a,c-a)<=0:raise ValueError('Sparse roof face folds: '+str([labels[v] for v in f]))
    return p,q,ordered_boundary(q),labels


def wall_mesh(roof,quads,ids,settings):
    """Derive all wall vertices from the authored boundary; no saved wall edits."""
    roof=np.asarray(roof,dtype=float);boundary=ordered_boundary(quads)
    ring=roof[boundary];tangent=np.roll(ring[:,:2],-1,axis=0)-np.roll(ring[:,:2],1,axis=0)
    normal=np.c_[tangent[:,1],-tangent[:,0]];normal/=np.linalg.norm(normal,axis=1)[:,None]
    r=settings['shoulder_width_mm'];outer=ring[:,:2]+normal*r
    vertices=roof.tolist();faces=np.asarray(quads).tolist();labels=list(ids);tags=['top']*len(faces);old=boundary
    for row in range(3):
        z=ring[:,2]-r*.65 if row==0 else np.full(len(ring),settings['wall_lower_ring_z_mm'] if row==1 else settings['base_z_mm'])
        new=list(range(len(vertices),len(vertices)+len(ring)))
        vertices.extend(np.c_[outer,z].tolist());labels.extend('side:%d:%03d'%(row,i) for i in range(len(ring)))
        for i in range(len(ring)):
            j=(i+1)%len(ring);faces.append([old[j],old[i],new[i],new[j]]);tags.append('shoulder' if row==0 else 'wall')
        old=new
    return np.asarray(vertices),np.asarray(faces),labels,tags,boundary


def fairness_rows(xy):
    """Local quadratic curvature stencils; affine planes have zero penalty."""
    rows=[];tree=cKDTree(xy)
    for i,p in enumerate(xy):
        _,ids=tree.query(p,k=min(10,len(xy)));ids=np.asarray([k for k in ids if k!=i])
        d=xy[ids]-p;scale=np.mean(np.linalg.norm(d,axis=1));d/=scale
        basis=np.c_[d,d[:,0]**2/2,d[:,0]*d[:,1],d[:,1]**2/2]
        coeff=np.linalg.pinv(basis,rcond=1e-5)[2:]/scale
        for values in coeff:
            row=np.zeros(len(xy));row[ids]=values;row[i]=-values.sum();rows.append(row)
    return sparse.csr_matrix(np.asarray(rows))


def expand_cage(cage):
    if cage['schema']==1:
        return np.asarray(cage['positions_mm']),np.asarray(cage['quads']),list(cage['control_ids']),list(cage['face_regions'])
    if cage['schema']!=2 or cage.get('construction')!='sparse_roof_derived_walls':raise ValueError('Unsupported control mesh construction')
    p,q,ids,tags,_=wall_mesh(cage['positions_mm'],cage['quads'],cage['control_ids'],cage['wall_settings'])
    return p,q,ids,tags
