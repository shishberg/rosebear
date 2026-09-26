"""A surface-first shell: analytic height field, normal frames and a sampled skin.

Keys sample the analytic well; it is never fitted through their depths.
The independent perimeter curve uses hardware-relative control points so its
boundary follows layout changes without changing the underlying well.
"""
import math
import numpy as np
import manifold3d as mf
from scipy.spatial import Delaunay
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import gaussian_filter1d
from shapely.geometry import Polygon, Point


class ShoulderBelowBase(ValueError):
    def __init__(self, minimum):
        self.minimum=float(minimum)
        super().__init__('Curved shoulder intersects base')


def smoothstep(t):
    t = np.clip(t, 0, 1)
    return t*t*t*(t*(6*t-15)+10)


def ramp(value, limits):
    return smoothstep((value-limits[0])/(limits[1]-limits[0]))


class WellSurface:
    def __init__(self, cfg):
        from .chassis import frame
        self.cfg = cfg; self.spec = cfg['surface']
        self.thumb = frame(cfg['geometry']['thumb']['position_mm'], cfg['geometry']['thumb']['rotation_deg'])
        self.ball = frame(cfg['trackball']['position_mm'], cfg['trackball']['rotation_deg'])
        ref = self.spec.get('palm_reference')
        self.palm_reference = frame(ref['position_mm'],ref['rotation_deg']) if ref else self.ball
        ad = cfg['adapter']; self.adapter = frame(ad['position_mm'], ad['rotation_deg'])
        self.adapter[:3,3] += self.adapter[:3,2]*(ad['component_height_mm']+ad['solder_clearance_mm']+cfg['shell']['deck_thickness_mm'])

    @staticmethod
    def plane(M, x, y):
        n = M[:3,2]; p = M[:3,3]
        return p[2]-(n[0]*(x-p[0])+n[1]*(y-p[1]))/n[2]

    def height(self, x, y):
        s = self.spec; x = np.asarray(x); y = np.asarray(y)
        u = x-s['origin_mm'][0]; v = y-s['origin_mm'][1]
        rx, ry = s['radii_mm']
        z = np.zeros(np.broadcast(x,y).shape)+s['origin_mm'][2]
        if rx is not None: z = z+u*u/(2*rx)
        if ry is not None: z = z+v*v/(2*ry)
        z = z+s['cross_coefficient_per_mm']*u*v
        z = z+u*math.tan(math.radians(s['tilt_deg'][0]))+v*math.tan(math.radians(s['tilt_deg'][1]))
        # C2 blends preserve the deliberately flat thumb cluster and accessory
        # mounting planes while joining them smoothly to the finger well.
        tw = ramp(x,s['thumb_blend_x_mm'])
        palm = (1-tw)*self.plane(self.thumb,x,y)+tw*self.plane(self.palm_reference,x,y)
        # There is no thumb row under the ring/pinky: keep their whole switch
        # footprint on the paraboloid before descending into the palm surface.
        shift = -s['outer_palm_shift_mm']*ramp(x,s['outer_palm_blend_x_mm'])
        fw = ramp(y-shift,s['palm_blend_y_mm'])
        z = fw*z+(1-fw)*palm
        # The inner adapter patch ends before the thumb row, so the far thumb
        # remains in the same flat plane as the other two thumbs.
        aw = 1-(1-ramp(x,s['adapter_blend_x_mm']))*ramp(y,s['adapter_blend_y_mm'])
        z = aw*z+(1-aw)*self.plane(self.adapter,x,y)
        patch = s.get('trackball_patch')
        if patch:
            # A movable local mounting patch; its tilt does not tilt the rest
            # of the palm when the module moves to the inner side.
            if patch.get('shape') == 'well_join':
                # One continuous ramp into the finger well, rather than an
                # isolated rectangular island with a valley around its edge.
                dx=x-self.ball[0,3];dy=y-self.ball[1,3]
                bottom=patch['bottom_y_mm']+patch['bottom_slope']*np.maximum(dx-patch['bottom_slope_start_x_mm'],0)
                weight=(1-ramp(dx,patch['join_x_mm']))*ramp(dy,[bottom-patch['bottom_blend_mm'],bottom])*(1-ramp(dy,patch['upper_blend_y_mm']))
            elif patch.get('shape') == 'rounded_rectangle':
                # Measure in the mounting plane: a board-sized rectangle with
                # a short blend, rather than an elliptical apron into the thumbs.
                zball=self.plane(self.ball,x,y)
                delta=np.array(np.broadcast_arrays(x-self.ball[0,3],y-self.ball[1,3],zball-self.ball[2,3]))
                local=np.einsum('ji,j...->i...',self.ball[:3,:3],delta)
                half=np.array(self.cfg['trackball']['board_mm'][:2])/2+patch['margin_mm']
                radius=patch['corner_radius_mm']
                qx=np.abs(local[0])-half[0]+radius
                qy=np.abs(local[1])-half[1]+radius
                distance=np.sqrt(np.maximum(qx,0)**2+np.maximum(qy,0)**2)+np.minimum(np.maximum(qx,qy),0)-radius
                weight=1-ramp(distance,[0,patch['blend_mm']])
            else:
                u=(x-self.ball[0,3])/patch['radii_mm'][0]
                v=(y-self.ball[1,3])/patch['radii_mm'][1]
                weight=1-ramp(np.sqrt(u*u+v*v),[patch['flat_fraction'],1])
            z=(1-weight)*z+weight*self.plane(self.ball,x,y)
        relief=s.get('thumb_bridge_relief')
        if relief:
            u=(x-relief['center_mm'][0])/relief['radii_mm'][0]
            v=(y-relief['center_mm'][1])/relief['radii_mm'][1]
            z=z-relief['drop_mm']*(1-ramp(np.sqrt(u*u+v*v),[0,1]))
        return z

    def gradient(self, x, y):
        e = .001
        return np.array([(self.height(x+e,y)-self.height(x-e,y))/(2*e),
                         (self.height(x,y+e)-self.height(x,y-e))/(2*e)])

    def frame(self, x, y):
        dx, dy = self.gradient(x,y)
        normal = np.array([-dx,-dy,1.]); normal /= np.linalg.norm(normal)
        across = np.array([1.,0.,dx]); across /= np.linalg.norm(across)
        along = np.cross(normal,across)
        M = np.eye(4); M[:3,:3] = np.array([across,along,normal]).T
        M[:3,3] = [x,y,self.height(x,y)]
        return M

    def outline_points(self):
        """Resolve perimeter controls in the local frame of nearby hardware.

        Key frames sample height(), never domain(), so this does not fit the
        well to the keys or create a circular dependency.
        """
        if 'outline_controls' not in self.spec:
            return np.asarray(self.spec['outline_mm'],dtype=float)
        from .chassis import layout, frame
        anchors,_ = layout(self.cfg)
        for name in ['trackball','adapter']:
            item = self.cfg[name]
            anchors[name] = frame(item['position_mm'],item['rotation_deg'])
        resolved=[]
        for control in self.spec['outline_controls']:
            if 'point_mm' in control:
                resolved.append(control['point_mm'])
                continue
            name = control['anchor']
            if name not in anchors: raise ValueError('Unknown perimeter anchor: '+name)
            if 'pcb_edge' in control:
                # Specify the skirt against the underside PCB, after tenting.
                # The skirt is vertical in world Z, so its top edge must be
                # solved on the curved shoulder rather than the key plane.
                from scipy.optimize import brentq
                tent = frame(angles=[0,self.cfg['geometry']['tent_deg'],0])
                half = np.asarray(self.cfg['tile']['size_mm'][:2])/2
                margin = self.cfg['shell']['wall_mm']+self.spec.get('thumb_wall_gap_mm',2.)
                local = (np.asarray(control['pcb_edge'])*(half+margin)).tolist()
                local.append(-self.cfg['tile']['plate_top_to_pcb_top_mm']-self.cfg['tile']['size_mm'][2]/2)
                target = (tent @ anchors[name] @ np.r_[local,1])[:2]
                y = target[1]; radius = self.cfg['shell']['rim_radius_mm']
                def error(x):
                    return (tent @ np.array([x,y,float(self.height(x,y))-radius,1]))[0]-target[0]
                x = brentq(error,target[0]-50,target[0]+50)
                resolved.append([x,y])
                continue
            offset = control['offset_mm']
            if len(offset) == 2: offset = [*offset,0]
            resolved.append((anchors[name] @ np.r_[offset,1])[:2])
        return np.asarray(resolved,dtype=float)

    def domain(self):
        controls = self.outline_points()
        controls = np.vstack([controls,controls[0]])
        lengths = np.linalg.norm(np.diff(controls,axis=0),axis=1)**.5
        t = np.r_[0,np.cumsum(lengths)]
        # Repeated periods make the shape-preserving Hermite derivatives agree
        # at the seam. Unlike an interpolating cubic spline, this cannot bulge
        # beyond adjacent controls or invent waves on a straight section.
        period = t[-1]
        extended_t = np.r_[t[:-1]-period,t,t[1:]+period]
        extended_c = np.vstack([controls[:-1],controls,controls[1:]])
        curve = PchipInterpolator(extended_t,extended_c)
        points = curve(np.linspace(0,period,self.spec.get('perimeter_samples',720),endpoint=False))
        # Round tangent stops without cubic overshoot. Filter uniform arc-length
        # samples, so the smoothing parameter has a physical millimetre scale.
        closed = np.vstack([points,points[0]])
        arc = np.r_[0,np.cumsum(np.linalg.norm(np.diff(closed,axis=0),axis=1))]
        uniform = np.linspace(0,arc[-1],len(points),endpoint=False)
        points = np.c_[np.interp(uniform,arc,closed[:,0]),np.interp(uniform,arc,closed[:,1])]
        sigma = self.spec.get('perimeter_smoothing_mm',2.5)/(arc[-1]/len(points))
        if sigma > 0: points = gaussian_filter1d(points,sigma,axis=0,mode='wrap')
        p = Polygon(points)
        if not p.is_valid: raise ValueError('Parametric perimeter crosses itself')
        return p

    def tessellation(self, domain=None, shoulder_samples=True):
        """Triangulate the analytic well inside its sampled parametric boundary."""
        domain = self.domain() if domain is None else domain
        pitch = self.spec['mesh_pitch_mm']
        count = math.ceil(domain.exterior.length/min(pitch,.8))
        boundary = np.array([domain.exterior.interpolate(i/count,normalized=True).coords[0] for i in range(count)])
        domain = Polygon(boundary)
        xmin,ymin,xmax,ymax = domain.bounds
        inside = []
        safe = domain.buffer(-pitch*.35)
        for x in np.arange(xmin+pitch/2,xmax,pitch):
            for y in np.arange(ymin+pitch/2,ymax,pitch):
                if safe.contains(Point(x,y)): inside.append([x,y])
        patch=self.spec.get('trackball_patch',{})
        if patch.get('shape') in ('rounded_rectangle','well_join'):
            fine=patch.get('mesh_pitch_mm',pitch)
            reach=patch.get('sampling_radius_mm',max(self.cfg['trackball']['board_mm'][:2])/2+patch.get('margin_mm',0)+patch.get('blend_mm',4)+2)
            for x in np.arange(self.ball[0,3]-reach,self.ball[0,3]+reach,fine):
                for y in np.arange(self.ball[1,3]-reach,self.ball[1,3]+reach,fine):
                    if safe.contains(Point(x,y)): inside.append([x,y])
        relief=self.spec.get('thumb_bridge_relief')
        if relief:
            cx,cy=relief['center_mm'];rx,ry=relief['radii_mm']
            for x in np.arange(cx-rx-1,cx+rx+1,.75):
                for y in np.arange(cy-ry-1,cy+ry+1,.75):
                    if safe.contains(Point(x,y)): inside.append([x,y])
        # Sample the circular shoulder by angle: a coarse interior grid alone
        # gives the larger rim only one or two facets across its radius.
        r = self.cfg['shell']['rim_radius_mm']
        for angle in (np.linspace(math.pi/12,math.pi/2,6) if shoulder_samples else []):
            ring = domain.buffer(-r*(1-math.cos(angle)))
            if ring.is_empty: continue
            for part in ([ring] if ring.geom_type == 'Polygon' else ring.geoms):
                n = math.ceil(part.exterior.length/1.2)
                inside.extend([part.exterior.interpolate(i/n,normalized=True).coords[0] for i in range(n)])
        xy = np.unique(np.round(np.concatenate([boundary,np.asarray(inside)]),8),axis=0)
        faces = Delaunay(xy).simplices
        faces = np.array([f for f in faces if abs(np.cross(xy[f[1]]-xy[f[0]],xy[f[2]]-xy[f[0]])) > 1e-7
                          and domain.buffer(1e-8).covers(Polygon(xy[f]))])
        # A boundary edge must be on the authored outline. Reject holes caused
        # by an unsuitable unconstrained triangulation instead of exporting them.
        counts = {}
        for f in faces:
            if np.cross(xy[f[1]]-xy[f[0]],xy[f[2]]-xy[f[0]]) < 0: f[1],f[2] = f[2],f[1]
            for a,b in zip(f,np.roll(f,-1)):
                edge = tuple(sorted((a,b))); counts[edge] = counts.get(edge,0)+1
        edges = [e for e,n in counts.items() if n == 1]
        for a,b in edges:
            if domain.boundary.distance(Point((xy[a]+xy[b])/2)) > .001:
                raise ValueError('Surface tessellation left an interior boundary; decrease mesh_pitch_mm')
        return xy,faces,edges,boundary

    def skin(self):
        xy, faces, edges, boundary = self.tessellation()
        # Roll the surface DOWN into the wall, rather than adding a bead above
        # it. The circular profile has zero slope at the inner join and a
        # vertical tangent at the exterior boundary.
        r = self.cfg['shell']['rim_radius_mm']; domain = Polygon(boundary)
        distances = np.array([domain.boundary.distance(Point(p)) for p in xy])
        roll = r-np.sqrt(np.maximum(0,r*r-np.maximum(0,r-distances)**2))
        z = self.height(xy[:,0],xy[:,1])-roll; d = self.cfg['shell']['deck_thickness_mm']
        gradients = self.gradient(xy[:,0],xy[:,1])
        # Vertical separation chosen to give d mm along the local normal.
        thickness = d*np.sqrt(1+np.sum(gradients*gradients,axis=0))
        vertices = np.concatenate([np.c_[xy,z],np.c_[xy,z-thickness]])
        n = len(xy); triangles = [*faces.tolist(),*(faces[:,::-1]+n).tolist()]
        # Use directed top edges; their inverse belongs to the side surface.
        edge_set = {tuple(sorted(e)) for e in edges}
        for f in faces:
            for a,b in zip(f,np.roll(f,-1)):
                if tuple(sorted((a,b))) in edge_set:
                    triangles.extend([[b,a,a+n],[b,a+n,b+n]])
        import trimesh
        checked = trimesh.Trimesh(vertices=vertices,faces=triangles,process=True)
        checked.remove_unreferenced_vertices()
        solid = mf.Manifold(mf.Mesh64(np.asarray(checked.vertices,dtype=np.float64),np.asarray(checked.faces,dtype=np.uint64)))
        if solid.status() != mf.Error.NoError: raise ValueError('Invalid surface solid: '+str(solid.status()))
        return solid, np.c_[boundary,self.height(boundary[:,0],boundary[:,1])-r]

    def body(self, pose, basez, filled=False):
        """One indexed shell: well, circular shoulder, skirt and inner surface.

        The shoulder follows S(u,v) = (C(u)+N(u)*r*sin(v),
        h(C(u)+N(u)*r*sin(v))-r*(1-cos(v))). The inner surface
        uses deck thickness and the reduced radius. Shared vertex indices join
        every patch; no intersecting rim/wall solids or clipping at that seam.
        """
        from .chassis import points
        r = self.cfg['shell']['rim_radius_mm']
        wall = self.cfg['shell']['wall_mm']; deck = self.cfg['shell']['deck_thickness_mm']
        if r <= wall: raise ValueError('Shoulder radius must exceed wall thickness')
        domain = self.domain().buffer(-r)
        if domain.geom_type != 'Polygon' or domain.is_empty: raise ValueError('Shoulder radius consumes the well')
        xy, faces, edges, _ = self.tessellation(domain,False)
        # Recover the directed boundary directly from the triangulation.
        edge_set = {tuple(sorted(e)) for e in edges}; nxt = {}
        for f in faces:
            for a,b in zip(f,np.roll(f,-1)):
                if tuple(sorted((a,b))) in edge_set: nxt[a] = b
        boundary = [next(iter(nxt))]
        while nxt[boundary[-1]] != boundary[0]: boundary.append(nxt[boundary[-1]])
        ids = np.asarray(boundary); c = xy[ids]
        tangent = np.roll(c,-1,axis=0)-np.roll(c,1,axis=0)
        normals = np.c_[tangent[:,1],-tangent[:,0]]
        normals /= np.linalg.norm(normals,axis=1)[:,None]
        z = self.height(xy[:,0],xy[:,1]); gradients = self.gradient(xy[:,0],xy[:,1])
        thickness = deck*np.sqrt(1+np.sum(gradients*gradients,axis=0))
        verts = points(pose,np.c_[xy,z]).tolist()
        n = len(xy); triangles = faces.tolist()
        if not filled:
            verts += points(pose,np.c_[xy,z-thickness]).tolist()
            triangles += (faces[:,::-1]+n).tolist()
        outer = ids.tolist(); inner = (ids+n).tolist()
        def connect(a,b,reverse=False):
            for i in range(len(a)):
                j=(i+1)%len(a)
                fs=[[a[j],a[i],b[i]],[a[j],b[i],b[j]]]
                triangles.extend([f[::-1] for f in fs] if reverse else fs)
        for angle in np.linspace(0,math.pi/2,self.spec.get('shoulder_samples',17))[1:]:
            for inside in ([False] if filled else [False,True]):
                radius = r-wall if inside else r
                q = c+normals*radius*math.sin(angle)
                drop = (thickness[ids] if inside else 0)+radius*(1-math.cos(angle))
                v = points(pose,np.c_[q,self.height(q[:,0],q[:,1])-drop])
                new = list(range(len(verts),len(verts)+len(v))); verts.extend(v.tolist())
                connect(inner if inside else outer,new,inside)
                if inside: inner=new
                else: outer=new
        perimeter = np.asarray(verts)[outer,:2]
        minimum=np.asarray(verts)[outer if filled else outer+inner,2].min()
        if minimum <= basez: raise ShoulderBelowBase(minimum)
        for inside in ([False] if filled else [False,True]):
            old = inner if inside else outer
            v = np.asarray(verts)[old].copy()
            if np.any(v[:,2] <= basez): raise ValueError('Curved shoulder intersects base')
            v[:,2]=basez
            new=list(range(len(verts),len(verts)+len(v)));verts.extend(v.tolist())
            connect(old,new,inside)
            if inside: inner=new
            else: outer=new
        if filled:
            for a,b,c in mf.triangulate([np.asarray(verts)[outer,:2]]):
                triangles.append([outer[a],outer[c],outer[b]])
        else:
            connect(outer,inner)
        solid=mf.Manifold(mf.Mesh64(np.asarray(verts,dtype=np.float64),np.asarray(triangles,dtype=np.uint64)))
        if solid.status()!=mf.Error.NoError: raise ValueError('Invalid continuous body: '+str(solid.status()))
        return solid,perimeter
