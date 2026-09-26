"""Shared Catmull–Clark exterior with an offset shell and classified openings.

Mounting lands and retention details remain a subsequent mechanical-fit stage.
"""
import copy
import json
from pathlib import Path
import numpy as np
from scipy import sparse
from scipy.sparse.linalg import spsolve, lsqr
from scipy.spatial import cKDTree
from shapely.geometry import Polygon, MultiPoint, Point
from shapely.ops import unary_union
import trimesh
from .chassis_cage import sparse_roof,wall_mesh,fairness_rows,expand_cage
from .chassis import frame, points, place, box, tile_hardware, serialize_mesh, mesh, PALETTE


def component_frames(cfg):
    """Hardware placement is independent of the fitted exterior surface."""
    g=cfg['geometry'];spec=cfg['surface'];keys={}
    for ci,col in enumerate(g['columns']):
        for ri,row in enumerate(['top','home','bottom']):
            x=(ci-2)*g['column_pitch_mm']+col['offset_mm'][0]
            y=(1-ri)*g['row_pitch_mm']+col['offset_mm'][1]
            u=x-spec['origin_mm'][0];v=y-spec['origin_mm'][1];rx,ry=spec['radii_mm']
            tx,ty=np.tan(np.radians(spec['tilt_deg']));cross=spec['cross_coefficient_per_mm']
            z=spec['origin_mm'][2]+(u*u/(2*rx) if rx else 0)+(v*v/(2*ry) if ry else 0)+cross*u*v+u*tx+v*ty
            dx=(u/rx if rx else 0)+cross*v+tx;dy=(v/ry if ry else 0)+cross*u+ty
            normal=np.array([-dx,-dy,1.]);normal/=np.linalg.norm(normal)
            across=np.array([1.,0.,dx]);across/=np.linalg.norm(across)
            M=np.eye(4);M[:3,:3]=np.array([across,np.cross(normal,across),normal]).T;M[:3,3]=[x,y,z]
            name='matrix_'+col['name']+'_'+row;q=g['key_overrides'].get(name,{})
            keys[name]=M@frame([0,0,col['offset_mm'][2]],col['rotation_deg'])@frame(q.get('offset_mm',[0,0,0]),q.get('rotation_deg',[0,0,0]))
    thumb=g['thumb'];root=frame(thumb['position_mm'],thumb['rotation_deg']);arc=thumb['arc']
    for i,key in enumerate(thumb['keys']):
        angle=np.radians((i-1)*arc['step_deg']);r=arc['radius_mm']
        keys['thumb_'+key['name']]=root@frame([r*np.sin(angle),r*(np.cos(angle)-1),0],[0,0,-np.degrees(angle)])@frame(key.get('offset_mm',[0,0,0]),key.get('rotation_deg',[0,0,0]))
    for name in ['trackball','adapter']:keys[name]=frame(cfg[name]['position_mm'],cfg[name]['rotation_deg'])
    tent=frame(angles=[0,g['tent_deg'],0]);keys={name:tent@M for name,M in keys.items()}
    lowest=min((M@np.array([0,0,-12,1]))[2] for M in keys.values());lift=8-lowest
    for M in keys.values():M[2,3]+=lift
    return keys,lift


def hardware(cfg,nodes):
    result=[]
    for name,M in nodes.items():
        if name.startswith(('thumb_','matrix_')):
            result.extend((g,name,place(p,M)) for g,p in tile_hardware(cfg,name))
    tb=cfg['trackball'];w,d,t=tb['board_mm'];z=-tb['board_top_below_deck_mm'];M=nodes['trackball']
    result += [('trackball','Trackball PCB',place(box([w,d,t],[0,0,z-t/2]),M)),
               ('trackball','Rear components',place(box([w,d,tb['rear_component_depth_mm']],[0,0,z-t-tb['rear_component_depth_mm']/2]),M)),
               ('trackball','Housing',place(box(tb['housing_mm'],[0,0,z+tb['housing_mm'][2]/2]),M))]
    import manifold3d as mf
    result.append(('ball','Ball',place(mf.Manifold.sphere(tb['ball_diameter_mm']/2,24).translate([0,0,z+tb['ball_center_above_board_mm']]),M)))
    ad=cfg['adapter'];w,d,t=ad['board_mm'];M=nodes['adapter']
    result += [('adapter','FFC PCB',place(box([w,d,t],[0,0,-t/2]),M)),
               ('adapter','FFC connector',place(box([w-4,d/2,ad['component_height_mm']],[0,0,ad['component_height_mm']/2]),M))]
    return result


def footprint(cfg,nodes,spec):
    groups={}
    for name,M in nodes.items():
        if name.startswith(('matrix_','thumb_')):
            w,d,t=cfg['tile']['size_mm'];z=-cfg['tile']['plate_top_to_pcb_top_mm']-t/2
            group='thumb' if name.startswith('thumb_') else name.rsplit('_',1)[0]
        else:
            w,d,t=cfg[name]['board_mm'];z=-cfg[name].get('board_top_below_deck_mm',0)-t/2;group=name
        polygon=MultiPoint(points(M,[[sx*w/2,sy*d/2,z] for sx in [-1,1] for sy in [-1,1]])[:,:2]).convex_hull
        groups.setdefault(group,[]).append(polygon)
    outlines=[unary_union(polys).convex_hull.buffer(spec['outline_allowance_mm'],resolution=12) for polys in groups.values()]
    p=unary_union(outlines)
    close=spec['outline_fairing_mm'];p=p.buffer(close,resolution=12).buffer(-close,resolution=12)
    if p.geom_type!='Polygon':raise ValueError('Hardware groups do not form one footprint; revise placement or outline allowance')
    # Only the exterior defines this uncut design domain.
    return Polygon(p.exterior)


def perimeter_indices(nx,ny):
    idx=lambda i,j:j*(nx+1)+i
    return ([idx(i,0) for i in range(nx)]+[idx(nx,j) for j in range(ny)]+
            [idx(i,ny) for i in range(nx,0,-1)]+[idx(0,j) for j in range(ny,0,-1)])


def grid_domain(domain,nx,ny):
    """Harmonic quad-grid coordinates with one common boundary for all regions."""
    from shapely.geometry.polygon import orient
    ring=orient(domain,sign=1).exterior
    lo=np.array(domain.bounds[:2]);hi=np.array(domain.bounds[2:]);corners=[lo,[hi[0],lo[1]],hi,[lo[0],hi[1]]]
    ds=np.array([ring.project(Point(p)) for p in corners]);length=ring.length
    for i in range(1,4):
        while ds[i]<=ds[i-1]:ds[i]+=length
    if ds[-1]-ds[0]>=length:raise ValueError('Outline cannot be mapped to this quad grid without reordered corners')
    ds=np.r_[ds,ds[0]+length];boundary=perimeter_indices(nx,ny);n=(nx+1)*(ny+1)
    xy=np.zeros((n,2));offset=0
    for a,b,count in zip(ds[:-1],ds[1:],[nx,ny,nx,ny]):
        for t in np.linspace(a,b,count,endpoint=False):
            xy[boundary[offset]]=ring.interpolate(t%length).coords[0];offset+=1
    fixed=set(boundary);rows=[];cols=[];values=[];rhs=np.zeros((n,2))
    for j in range(ny+1):
        for i in range(nx+1):
            k=j*(nx+1)+i
            if k in fixed:rows.append(k);cols.append(k);values.append(1);rhs[k]=xy[k]
            else:
                rows.extend([k]*5);cols.extend([k,k-1,k+1,k-nx-1,k+nx+1]);values.extend([4,-1,-1,-1,-1])
    xy=spsolve(sparse.csr_matrix((values,(rows,cols)),shape=(n,n)),rhs)
    quads=[[j*(nx+1)+i,j*(nx+1)+i+1,(j+1)*(nx+1)+i+1,(j+1)*(nx+1)+i] for j in range(ny) for i in range(nx)]
    quads=np.array(quads)
    # Harmonic maps can fold at a concave outline. Untangle the control grid
    # with positive corner Jacobians; never hide folds by dropping triangles.
    from scipy.optimize import minimize
    tri=np.concatenate([quads[:,[0,1,3]],quads[:,[1,2,0]],quads[:,[2,3,1]],quads[:,[3,0,2]]])
    free=np.array([i for i in range(n) if i not in fixed]);lookup={int(v):i for i,v in enumerate(free)};seed=xy[free].copy()
    def area(values):
        p=xy.copy();p[free]=values.reshape(-1,2);a,b,c=p[tri[:,0]],p[tri[:,1]],p[tri[:,2]]
        return np.cross(b-a,c-a)-.2
    def jac(values):
        p=xy.copy();p[free]=values.reshape(-1,2);a,b,c=p[tri[:,0]],p[tri[:,1]],p[tri[:,2]]
        gradients=np.stack([np.c_[b[:,1]-c[:,1],c[:,0]-b[:,0]],np.c_[c[:,1]-a[:,1],a[:,0]-c[:,0]],np.c_[a[:,1]-b[:,1],b[:,0]-a[:,0]]],axis=1)
        result=np.zeros((len(tri),len(free)*2))
        for row,t in enumerate(tri):
            for corner,v in enumerate(t):
                if int(v) in lookup:j=lookup[int(v)]*2;result[row,j:j+2]+=gradients[row,corner]
        return result
    if np.min(area(seed.ravel()))<0:
        fit=minimize(lambda x:np.sum((x-seed.ravel())**2),seed.ravel(),jac=lambda x:2*(x-seed.ravel()),
                     constraints=[{'type':'ineq','fun':area,'jac':jac}],method='SLSQP',options={'maxiter':300,'ftol':1e-8})
        if not fit.success or np.min(area(fit.x)) < -1e-6:raise ValueError('Cannot form an unfolded control grid: '+fit.message)
        xy[free]=fit.x.reshape(-1,2)
    return xy,quads,boundary


def subdivision_matrix(quads,n):
    """One Catmull–Clark step, including the cubic open-boundary rule."""
    edge_faces={};vertex_faces=[[] for _ in range(n)];vertex_edges=[set() for _ in range(n)]
    for fi,f in enumerate(quads):
        for v in f:vertex_faces[v].append(fi)
        for a,b in zip(f,np.roll(f,-1)):
            e=tuple(sorted((int(a),int(b))));edge_faces.setdefault(e,[]).append(fi);vertex_edges[a].add(e);vertex_edges[b].add(e)
    edges=list(edge_faces);edge_id={e:n+len(quads)+i for i,e in enumerate(edges)};rows=[];cols=[];vals=[]
    def put(row,col,value):rows.append(row);cols.append(col);vals.append(value)
    for v in range(n):
        es=vertex_edges[v];boundary=[e for e in es if len(edge_faces[e])==1]
        if boundary:
            if len(boundary)!=2:raise ValueError('Non-manifold control boundary')
            put(v,v,.75)
            for e in boundary:put(v,e[0] if e[1]==v else e[1],.125)
        else:
            degree=len(es);put(v,v,(degree-3)/degree)
            for fi in vertex_faces[v]:
                for q in quads[fi]:put(v,q,1/(degree*len(vertex_faces[v])*4))
            for e in es:
                for q in e:put(v,q,1/(degree*degree))
    for fi,f in enumerate(quads):
        for v in f:put(n+fi,v,.25)
    for e in edges:
        row=edge_id[e];fs=edge_faces[e]
        if len(fs)==1:
            for v in e:put(row,v,.5)
        elif len(fs)==2:
            for v in e:put(row,v,.25)
            for fi in fs:
                for v in quads[fi]:put(row,v,1/16)
        else:raise ValueError('Non-manifold cage edge')
    out=[]
    for fi,f in enumerate(quads):
        for k,v in enumerate(f):out.append([v,edge_id[tuple(sorted((int(v),int(f[(k+1)%4]))))],n+fi,edge_id[tuple(sorted((int(f[(k-1)%4]),int(v))))]])
    return sparse.csr_matrix((vals,(rows,cols)),shape=(n+len(quads)+len(edges),n)),np.array(out)


def refine(quads,n,levels,tags):
    S=sparse.eye(n,format='csr');q=np.array(quads);tags=np.asarray(tags)
    for _ in range(levels):
        step,q=subdivision_matrix(q,S.shape[0]);S=step@S;tags=np.repeat(tags,4)
    return S,q,tags


def sample_rows(xy,faces,targets):
    triangles=np.concatenate([faces[:,:3],faces[:,[0,2,3]]]);p=xy[triangles];tree=cKDTree(p.mean(axis=1));rows=[];missing=[]
    for k,target in enumerate(targets):
        _,candidates=tree.query(target,k=min(80,len(triangles)));found=None
        for f in np.atleast_1d(candidates):
            a,b,c=p[f];matrix=np.stack([b-a,c-a],axis=1)
            if abs(np.linalg.det(matrix))<1e-10:continue
            v,w=np.linalg.solve(matrix,target-a);weights=np.array([1-v-w,v,w])
            if min(weights)>=-1e-7:found=(triangles[f],weights);break
        if found is None:missing.append(k);rows.append(sparse.csr_matrix((1,len(xy))))
        else:rows.append(sparse.csr_matrix((found[1],(np.zeros(3),found[0])),shape=(1,len(xy))))
    return sparse.vstack(rows),missing


def target_samples(cfg,nodes):
    positions=[];names=[]
    for name,M in nodes.items():
        if name.startswith(('matrix_','thumb_')):w=d=7.;z=0
        elif name=='trackball':w,d=np.array(cfg['trackball']['board_mm'][:2])/2;z=0
        else:
            w,d=np.array(cfg['adapter']['board_mm'][:2])/2;z=cfg['adapter']['component_height_mm']+cfg['shell']['deck_thickness_mm']+1
        for x,y in [(0,0),(-w,0),(w,0),(0,-d),(0,d),(-w,-d),(-w,d),(w,-d),(w,d)]:
            positions.append(points(M,[[x,y,z]])[0]);names.append(name)
    return np.array(positions),names


def make_cage(cfg,spec,arrangement):
    nodes,lift=component_frames(cfg);r=spec['shoulder_width_mm']
    sparse_mode=spec.get('topology')=='feature_cage'
    if sparse_mode:
        xy,top,boundary,ids=sparse_roof(cfg,nodes,spec)
    else:
        outline=footprint(cfg,nodes,spec);inner=outline.buffer(-r)
        if inner.geom_type!='Polygon':raise ValueError('Shoulder consumes the footprint')
        nx,ny=spec['grid'];xy,top,boundary=grid_domain(inner,nx,ny)
        ids=['top:%02d:%02d'%(j,i) for j in range(ny+1) for i in range(nx+1)]
    nt=len(xy);nb=len(boundary)
    # Rim and wall are rows of the SAME mesh; no separately evaluated join.
    ring=xy[boundary];tangent=np.roll(ring,-1,axis=0)-np.roll(ring,1,axis=0)
    normal=np.c_[tangent[:,1],-tangent[:,0]];normal/=np.linalg.norm(normal,axis=1)[:,None]
    outer=ring+normal*r
    vertices=np.c_[xy,np.zeros(nt)].tolist();roof_ids=list(ids)
    quads=top.tolist();tags=['top']*len(top);old=boundary
    # Boundary Z tied to the fitted deck for first shoulder row; lower rings
    # establish a vertical wall and planar open bottom in world coordinates.
    for row in range(3):
        new=list(range(len(vertices),len(vertices)+nb));vertices.extend(np.c_[outer,np.zeros(nb)].tolist())
        ids.extend('side:%d:%03d'%(row,i) for i in range(nb))
        for i in range(nb):j=(i+1)%nb;quads.append([old[j],old[i],new[i],new[j]]);tags.append('shoulder' if row==0 else 'wall')
        old=new
    vertices=np.array(vertices);S,faces,tags_fine=refine(quads,len(vertices),spec['subdivisions'],tags)
    P=sparse.lil_matrix((len(vertices),nt));P[:nt,:]=sparse.eye(nt);constant=np.zeros(len(vertices))
    for i,v in enumerate(boundary):P[nt+i,v]=1;constant[nt+i]=-r*.65
    constant[nt+nb:nt+2*nb]=spec['wall_lower_ring_z_mm'];constant[nt+2*nb:]=spec['base_z_mm'];P=P.tocsr()
    fine_xy=S@vertices[:,:2];targets,names=target_samples(cfg,nodes)
    B,missing=sample_rows(fine_xy,faces[tags_fine!='wall'],targets[:,:2]);A=B@S@P;rhs=targets[:,2]-B@S@constant
    # Global fairness penalizes neighbouring-control curvature. No local bump,
    # platform blend, thumb relief, or legacy sampled surface is used as input.
    if sparse_mode:
        L=fairness_rows(xy);row=L.shape[0]
    else:
        rr=[];cc=[];vv=[];row=0
        for j in range(ny+1):
            for i in range(nx+1):
                k=j*(nx+1)+i
                for a,b in ([(k-1,k+1)] if 0<i<nx else [])+([(k-nx-1,k+nx+1)] if 0<j<ny else []):
                    da=np.linalg.norm(xy[k]-xy[a]);db=np.linalg.norm(xy[b]-xy[k]);scale=np.sqrt((da+db)/2)
                    rr.extend([row]*3);cc.extend([a,k,b]);vv.extend([scale/da,-scale*(1/da+1/db),scale/db]);row+=1
        L=sparse.csr_matrix((vv,(rr,cc)),shape=(row,nt))
    normal_rows=[];normal_values=[]
    epsilon=.8
    for name,M in nodes.items():
        if name=='adapter':continue
        xy=M[:2,3]
        probes=np.array([xy+[epsilon,0],xy-[epsilon,0],xy+[0,epsilon],xy-[0,epsilon]])
        R,absent=sample_rows(fine_xy,faces[tags_fine!='wall'],probes)
        if absent:continue
        for a,b,axis in [(0,1,0),(2,3,1)]:
            derivative=(R[a]-R[b])/(2*epsilon)
            normal_rows.append(derivative@S@P)
            normal_values.append(-M[axis,2]/M[2,2]-(derivative@S@constant).item())
    N=sparse.vstack(normal_rows);normal_values=np.asarray(normal_values)
    nw=spec.get('normal_weight',40.)
    weights=np.full(len(targets),float(spec['mount_weight']));weights[np.array(names)=='adapter']=0;weights[missing]=0
    matrix=sparse.vstack([sparse.diags(weights)@A,nw*N,spec['fairing_weight']*L,.001*sparse.eye(nt)])
    values=np.r_[weights*rhs,nw*normal_values,np.zeros(row),np.full(nt,.001*np.mean(targets[:,2]))]
    solution=lsqr(matrix,values,atol=1e-10,btol=1e-10,iter_lim=3000)
    if solution[1] not in (1,2):raise ValueError('Surface fit failed to converge: '+str(solution[1]))
    # A stacked adapter requires clearance ABOVE it, not a second skin height
    # at the same XY as the trackball. Activate only violated lower bounds.
    for _ in range(8):
        errors=A@solution[0]-rhs
        active=(np.array(names)=='adapter')&(errors < -.01)
        if not np.any(active):break
        weights[active]=spec['mount_weight']
        matrix=sparse.vstack([sparse.diags(weights)@A,nw*N,spec['fairing_weight']*L,.001*sparse.eye(nt)])
        values=np.r_[weights*rhs,nw*normal_values,np.zeros(row),np.full(nt,.001*np.mean(targets[:,2]))]
        solution=lsqr(matrix,values,atol=1e-10,btol=1e-10,iter_lim=3000)
    vertices[:,2]=P@solution[0]+constant
    overrides=spec.get('overrides',{}).get(arrangement,{})
    unknown=set(overrides)-set(roof_ids if sparse_mode else ids)
    if unknown:raise ValueError('Unknown control IDs: '+str(sorted(unknown)))
    for i,key in enumerate(ids):
        if key in overrides:vertices[i]=overrides[key]
    cage={'schema':1,'units':'mm','coordinate_system':'right hand, tent applied; +Y away, +Z up',
          'scheme':'catmull_clark','boundary_rule':'cubic','arrangement':arrangement,
          'control_ids':ids,'positions_mm':vertices.tolist(),'quads':quads,'face_regions':list(tags),
          'subdivisions':spec['subdivisions'],'fitted_before_overrides':True,'source_config_sha256':__import__('hashlib').sha256(json.dumps(cfg,sort_keys=True).encode()).hexdigest()}
    if sparse_mode:
        cage.update(schema=2,construction='sparse_roof_derived_walls',
                    control_ids=roof_ids,positions_mm=vertices[:nt].tolist(),quads=top.tolist(),
                    face_regions=['top']*len(top),
                    wall_settings={k:spec[k] for k in ['shoulder_width_mm','wall_lower_ring_z_mm','base_z_mm']})
        # Regenerate the walls after authoring overrides, including XY edits.
        vertices,quads,_,tags=expand_cage(cage)
        S,faces,tags_fine=refine(quads,len(vertices),spec['subdivisions'],tags)
        B,missing=sample_rows((S@vertices)[:,:2],faces[tags_fine!='wall'],targets[:,:2])
    evaluated=S@vertices;residual=B@evaluated[:,2]-targets[:,2]
    return cage,evaluated,faces,tags_fine,nodes,targets,names,residual,missing


def evaluate_cage(cage):
    if cage['schema'] not in (1,2) or cage['scheme']!='catmull_clark' or cage.get('boundary_rule')!='cubic':raise ValueError('Unsupported control mesh')
    p=np.asarray(cage['positions_mm'],dtype=float)
    if p.shape!=(len(cage['control_ids']),3) or not np.isfinite(p).all():raise ValueError('Invalid control positions')
    if len(set(cage['control_ids']))!=len(p):raise ValueError('Duplicate control IDs')
    q=np.asarray(cage['quads'])
    if q.ndim!=2 or q.shape[1]!=4 or not np.issubdtype(q.dtype,np.integer) or q.min()<0 or q.max()>=len(p):raise ValueError('Invalid control topology')
    if not 1<=cage['subdivisions']<=4:raise ValueError('Subdivision level outside supported review range 1–4')
    p,q,ids,tags=expand_cage(cage)
    S,q,tags=refine(q,len(p),cage['subdivisions'],tags)
    return S@p,q,tags


def surface_mesh(vertices,quads):
    faces=np.concatenate([quads[:,:3],quads[:,[0,2,3]]]);return trimesh.Trimesh(vertices=vertices,faces=faces,process=False)


def topology_report(vertices,quads,tags):
    edges=np.sort(np.concatenate([quads[:,[0,1]],quads[:,[1,2]],quads[:,[2,3]],quads[:,[3,0]]]),axis=1)
    unique,counts=np.unique(edges,axis=0,return_counts=True);boundary=unique[counts==1]
    degree=np.bincount(boundary.ravel(),minlength=len(vertices));seen=set();loops=0;neighbors={}
    for a,b in boundary:neighbors.setdefault(a,[]).append(b);neighbors.setdefault(b,[]).append(a)
    for start in neighbors:
        if start in seen:continue
        loops+=1;todo=[start]
        while todo:
            k=todo.pop()
            if k in seen:continue
            seen.add(k);todo.extend(neighbors[k])
    m=surface_mesh(vertices,quads);f=quads[np.asarray(tags)!='wall'];p=vertices[f,:2]
    signed=np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0])+np.cross(p[:,2]-p[:,0],p[:,3]-p[:,0])
    report={'connected_components':len(m.split(only_watertight=False)),'boundary_loops':loops,
            'boundary_branch_vertices':int(np.sum((degree!=0)&(degree!=2))),'nonmanifold_edges':int(np.sum(counts>2)),
            'folded_top_quads':int(np.sum(signed<=0)),'roof_check_includes_shoulder':True,'degenerate_triangles':int(np.sum(m.area_faces<1e-10)),
            'open_bottom_z_range_mm':np.ptp(vertices[np.unique(boundary),2]).item(),
            'watertight':False,'thickness_generated':False,'cutouts_generated':False}
    if report['connected_components']!=1 or loops!=1 or any(report[k] for k in ['nonmanifold_edges','boundary_branch_vertices','folded_top_quads','degenerate_triangles']):
        raise ValueError('Invalid exterior topology: '+str(report))
    return report


def offset_shell(vertices,quads,thickness,cage):
    """Use a second shared cage for the inner skin, with a planar bottom rim.

    Roof controls move down; wall controls move horizontally inward. Subdivision
    blends their displacements across the shoulder without normal-offset folds.
    Thickness is directional and approximate, not a certified distance offset.
    """
    import manifold3d as mf
    exterior=surface_mesh(vertices,quads);n=len(vertices)
    cp,cq,cids,ctags=expand_cage(cage);delta=np.zeros_like(cp)
    for i,key in enumerate(cids):
        if key.startswith('top:'):delta[i,2]=-thickness
    for row in range(3):
        ids=[i for i,key in enumerate(cids) if key.startswith('side:%d:'%row)]
        ring=cp[ids,:2];tangent=np.roll(ring,-1,axis=0)-np.roll(ring,1,axis=0)
        inward=np.c_[-tangent[:,1],tangent[:,0]];inward/=np.linalg.norm(inward,axis=1)[:,None]
        delta[ids,:2]=inward*thickness
        if row==0:delta[ids,2]=-thickness*.65
    S,_,_=refine(cq,len(cp),cage['subdivisions'],ctags)
    inner=vertices+S@delta
    directed=np.concatenate([quads[:,[0,1]],quads[:,[1,2]],quads[:,[2,3]],quads[:,[3,0]]])
    _,inverse,counts=np.unique(np.sort(directed,axis=1),axis=0,return_inverse=True,return_counts=True)
    boundary=directed[counts[inverse]==1]
    inner[np.unique(boundary),2]=vertices[np.unique(boundary),2]
    f=exterior.faces;pi=inner[f]
    normals=np.cross(pi[:,1]-pi[:,0],pi[:,2]-pi[:,0])
    if np.any(np.einsum('ij,ij->i',normals,exterior.face_normals)<=0):
        raise ValueError('Offset folds locally; reduce thickness or revise the control surface')
    bridges=[]
    for a,b in boundary:bridges.extend([[b,a,a+n],[b,a+n,b+n]])
    solid_mesh=trimesh.Trimesh(vertices=np.vstack([vertices,inner]),faces=np.vstack([f,f[:,::-1]+n,bridges]),process=False)
    if not solid_mesh.is_watertight or not solid_mesh.is_winding_consistent or solid_mesh.volume<=0:
        raise ValueError('Invalid offset-shell topology')
    solid=mf.Manifold(mf.Mesh64(np.asarray(solid_mesh.vertices,dtype=np.float64),np.asarray(solid_mesh.faces,dtype=np.uint64)))
    if solid.status()!=mf.Error.NoError:raise ValueError('Offset-shell manifold conversion failed: '+str(solid.status()))
    return solid,{'nominal_directional_thickness_mm':thickness,'offset_inverted_triangles':0,
                  'offset_method':'shared inner cage; roof down, walls inward, bottom planar',
                  'global_self_intersections_checked':False,'minimum_thickness_certified':False}


def opening_shell(cfg,spec,vertices,quads,nodes,cage,ball_enabled=True):
    """Finite component punches through the new shell; no legacy shape unions."""
    from .chassis import rounded_box,union,cutout_warnings,keycap_size
    body,details=offset_shell(vertices,quads,spec.get('preview_thickness_mm',2.0),cage)
    cuts=[];openings=[];warnings=[]
    for name,M in nodes.items():
        if not name.startswith(('matrix_','thumb_')):continue
        size=np.asarray(cfg['switch']['cutout_mm'])+cfg['switch']['cutout_clearance_mm']
        low=-cfg['switch']['body_below_plate_mm']-.5;high=12.
        cutter=place(box([*size,high-low],[0,0,(high+low)/2]),M)
        warnings+=cutout_warnings(body,M,size,[low,high],name)
        cuts.append(cutter);openings.append({'component':name,'kind':'switch','size_mm':size.tolist(),'depth_local_mm':[low,high],'removed_volume_mm3':float((body^cutter).volume())})
    if ball_enabled:
        tb=cfg['trackball'];M=nodes['trackball'];low=-tb.get('opening_depth_below_mm',6);high=10.
        cutter=place(rounded_box([*tb['opening_mm'],high-low],[0,0,(high+low)/2],tb['opening_radius_mm']),M)
        warnings+=cutout_warnings(body,M,tb['opening_mm'],[low,high],'trackball')
        cuts.append(cutter);openings.append({'component':'trackball','kind':'housing_window','size_mm':tb['opening_mm'],'depth_local_mm':[low,high],'removed_volume_mm3':float((body^cutter).volume())})
    # World -X exit, aligned with the underneath adapter connector height/Y.
    # Stop inside the adapter: the punch cannot traverse the opposite wall.
    ad=cfg['adapter'];anchor=points(nodes['adapter'],[[0,-ad['board_mm'][1]/2,ad['component_height_mm']/2]])[0]
    xmin=vertices[:,0].min()-2;end=anchor[0]+1;w,h=cfg['ribbon']['opening_mm']
    cutter=rounded_box([end-xmin,w,h],[(xmin+end)/2,anchor[1],anchor[2]],min(cfg['ribbon']['edge_radius_mm'],h/2-.01))
    removed=float((body^cutter).volume())
    if removed<.01:warnings.append({'kind':'cutout_misses_shell','component':'ribbon'})
    cuts.append(cutter);openings.append({'component':'ribbon','kind':'inner_wall_exit','center_mm':anchor.tolist(),'size_mm':[w,h],'removed_volume_mm3':removed})
    result=body-union(cuts);m=mesh(result)
    if not m.is_watertight or not m.is_winding_consistent or m.volume<=0:raise ValueError('Cut shell failed solid validation')
    parts=m.split(only_watertight=False)
    if len(parts)!=1:raise ValueError('Cutouts detached shell material: %d components'%len(parts))
    # Do not disguise interference by automatically carving PCB/keycap pockets.
    # Report it so the next mechanical pass can distinguish seats from problems.
    collisions=[]
    for group,name,part in hardware(cfg,nodes):
        if group not in ('pcb','components','trackball','adapter','keycaps'):continue
        if not ball_enabled and group=='trackball':continue
        overlap=float((result^part).volume())
        if overlap>.05:collisions.append({'group':group,'component':name,'volume_mm3':round(overlap,3)})
    for name,M in nodes.items():
        if not name.startswith(('matrix_','thumb_')):continue
        cap=keycap_size(cfg,name);travel=cfg['switch']['travel_mm'];margin=cfg['switch'].get('keycap_clearance_overrides_mm',{}).get(name,cfg['switch'].get('keycap_clearance_mm',0))
        low=cfg['switch']['keycap_bottom_above_plate_mm']-travel
        swept=place(box([cap[0]+2*margin,cap[1]+2*margin,cap[2]+travel],[0,0,low+(cap[2]+travel)/2]),M)
        overlap=float((result^swept).volume())
        if overlap>.05:warnings.append({'kind':'keycap_travel_clearance','component':name,'volume_mm3':round(overlap,3)})
    details.update({'watertight':True,'connected_components':1,'volume_mm3':float(m.volume),'openings':openings,
                    'hardware_overlaps':collisions,'warnings':warnings,'mounting_retention_generated':False})
    return m,details


def build_foundation(base,spec,out,control_mesh=None):
    import os,tempfile
    from .chassis_variants import comparison_configs
    from .chassis_view import write_viewer,write_views
    out=Path(out);out.parent.mkdir(parents=True,exist_ok=True);datasets=[]
    with tempfile.TemporaryDirectory(prefix='.surface-foundation-',dir=out.parent) as temp:
        stage=Path(temp)
        for code,label,cfg in comparison_configs(base):
            if code not in spec.get('arrangements',['ffc_below']):continue
            print('Fitting shared surface: '+label,flush=True)
            cage,v,q,tags,nodes,targets,names,residual,missing=make_cage(cfg,spec,code)
            if control_mesh is not None:
                cage=copy.deepcopy(control_mesh)
                if cage['arrangement']!=code:raise ValueError('Control mesh arrangement does not match active design')
                import hashlib
                expected=hashlib.sha256(json.dumps(cfg,sort_keys=True).encode()).hexdigest()
                if cage.get('source_config_sha256')!=expected:raise ValueError('Control mesh hardware configuration is stale; regenerate before replay')
                v,q,tags=evaluate_cage(cage)
                B,missing=sample_rows(v[:,:2],q[tags!='wall'],targets[:,:2]);residual=B@v[:,2]-targets[:,2]
            report={'exterior_topology':topology_report(v,q,tags),'control_points':len(cage['control_ids']),'top_control_points':sum(key.startswith('top:') for key in cage['control_ids']),'derived_wall_points':len(expand_cage(cage)[0])-len(cage['control_ids'])};report['stage']='cutout review shell; retention and mechanical qualification pending'
            report['mount_samples']=[{'component':name,'target_mm':p.tolist(),'height_error_mm':float(e),'covered':i not in missing,'constraint':'minimum_roof_height' if name=='adapter' else 'mounting_plane'} for i,(name,p,e) in enumerate(zip(names,targets,residual))]
            report['maximum_mount_error_mm']=float(max(abs(e) for i,(name,e) in enumerate(zip(names,residual)) if i not in missing and name!='adapter'))
            report['warnings']=[{'kind':'mount_target_outside_surface','sample':int(i),'component':names[i]} for i in missing]
            report['warnings'] += [{'kind':'mount_fit','component':name,'height_error_mm':round(float(e),3)} for i,(name,e) in enumerate(zip(names,residual)) if i not in missing and (abs(e)>spec['mount_warning_mm'] if name!='adapter' else e < -spec['mount_warning_mm'])]
            report['mount_normal_errors']=[]
            for name,M in nodes.items():
                if name=='adapter':continue
                xy=M[:2,3];epsilon=.8
                probes=np.array([xy+[epsilon,0],xy-[epsilon,0],xy+[0,epsilon],xy-[0,epsilon]])
                R,absent=sample_rows(v[:,:2],q[tags!='wall'],probes)
                if absent:continue
                heights=R@v[:,2];normal=np.array([-(heights[0]-heights[1])/(2*epsilon),-(heights[2]-heights[3])/(2*epsilon),1.]);normal/=np.linalg.norm(normal)
                angle=float(np.degrees(np.arccos(np.clip(normal@M[:3,2],-1,1))))
                report['mount_normal_errors'].append({'component':name,'degrees':angle})
                if angle>spec.get('normal_warning_deg',8):report['warnings'].append({'kind':'mount_normal','component':name,'degrees':round(angle,2)})
            report['collisions']=[];objects=[];exterior=surface_mesh(v,q)
            print('  Offsetting shell and cutting component openings',flush=True)
            m,cut_report=opening_shell(cfg,spec,v,q,nodes,cage)
            report['cut_shell']=cut_report
            report['thickness_generated']=True;report['cutouts_generated']=True;report['watertight']=True
            report['warnings']+=cut_report['warnings']
            report['collisions']=[dict(c,hand='r') for c in cut_report['hardware_overlaps']]
            left,left_report=opening_shell(cfg,spec,v,q,nodes,cage,ball_enabled=cfg['trackball']['enabled_left'])
            report['left_cut_shell']=left_report
            for hand in ['r','l']:
                mm=(m if hand=='r' else left).copy()
                if hand=='l':mm.apply_transform(np.diag([-1,1,1,1]))
                objects.append({'hand':hand,'group':'shell','name':'Shared surface with component openings',**serialize_mesh(mm),'n':np.round(mm.vertex_normals,6).tolist()})
                vertices=np.array(cage['positions_mm']);vertices[:,0]*=1 if hand=='r' else -1
                edges=np.unique(np.sort(np.concatenate([np.array(cage['quads'])[:,[0,1]],np.array(cage['quads'])[:,[1,2]],np.array(cage['quads'])[:,[2,3]],np.array(cage['quads'])[:,[3,0]]]),axis=1),axis=0)
                objects.append({'hand':hand,'group':'cage','name':'Control edges','v':vertices.tolist(),'f':[],'lines':edges.tolist()})
                for group,name,part in hardware(cfg,nodes):
                    if hand=='l' and group in ('trackball','ball') and not cfg['trackball']['enabled_left']:continue
                    hm=mesh(part)
                    if hand=='l':hm.apply_transform(np.diag([-1,1,1,1]))
                    objects.append({'hand':hand,'group':group,'name':name,**serialize_mesh(hm)})
            directory=stage/code;directory.mkdir()
            for name,data in [('control-mesh.json',cage),('report.json',report),('config.json',cfg),('viewer-data.json',objects)]:
                (directory/name).write_text(json.dumps(data,indent=None if name=='viewer-data.json' else 2)+'\n')
            exterior.export(directory/'uncut-exterior.obj')
            m.export(directory/'cut-shell-review.obj')
            (directory/'README.md').write_text('Shared-surface cutout review. A nominal 2 mm shared inner cage creates the shell; switch, trackball housing and inner ribbon openings are cut from it. No mounting clips, PCB retainers or screw bosses yet. cut-shell-review.obj is a review solid, not a qualified manufacturing model. uncut-exterior.obj retains the fitted exterior. See report.json for fit and collision findings. Left preview is provisional.\n')
            palette=dict(PALETTE,cage='#f4be63')
            write_views(directory,[o for o in objects if o['group']!='cage']+[dict(o,group='surface') for o in objects if o['group']=='shell'],palette)
            datasets.append({'id':code,'label':label,'directory':code+'/','objects':objects,'report':report})
            print('  Maximum mounting deviation %.2f mm; %d review warnings'%(report['maximum_mount_error_mm'],len(report['warnings'])),flush=True)
        write_viewer(stage/'preview.html',datasets[0]['objects'],datasets[0]['report'],palette,variants=datasets,foundation=True)
        (stage/'foundation-config.json').write_text(json.dumps(spec,indent=2)+'\n')
        out.mkdir(parents=True,exist_ok=True)
        for source in stage.iterdir():
            if source.is_dir():
                target=out/source.name;target.mkdir(exist_ok=True)
                for file in source.iterdir():os.replace(file,target/file.name)
            else:os.replace(source,out/source.name)
    print('Created '+str(out/'preview.html'),flush=True)
