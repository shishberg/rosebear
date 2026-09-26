"""Conservative local grid completion for nets left open by the DSN router.

Only supported island areas may receive new copper or vias. KiCad DRC remains
mandatory; this is a completion adapter, not a replacement for native checks.
"""
import heapq,math
import numpy as np
import pcbnew as pcb
from scipy import ndimage
from shapely.geometry import Point,LineString,box
from shapely.affinity import rotate,translate
from shapely.ops import unary_union,nearest_points
from shapely import contains_xy,prepare
from .pcb import xy,vec,net,track,save,drc


def pos(p):
    x,y=xy(p);return x,-y

def pad_shape(p):
    x,y=pos(p.GetPosition());w,h=xy(p.GetSize())
    if p.GetShape()==pcb.PAD_SHAPE_CIRCLE:return Point(x,y).buffer(w/2)
    # Targets must follow the real pad boundary too: using its bounding box
    # can terminate a route in empty space at a rounded corner.
    if p.GetShape()==pcb.PAD_SHAPE_ROUNDRECT:
        r=p.GetRoundRectCornerRadius()/1e6
        poly=box(-w/2+r,-h/2+r,w/2-r,h/2-r).buffer(r)
    elif p.GetShape()==pcb.PAD_SHAPE_OVAL:
        r=min(w,h)/2
        poly=LineString([(-max(0,w/2-r),-max(0,h/2-r)),(max(0,w/2-r),max(0,h/2-r))]).buffer(r)
    else:poly=box(-w/2,-h/2,w/2,h/2)
    return translate(rotate(poly,p.GetOrientationDegrees(),origin=(0,0)),x,y)

def shapes(b):
    copper=[];holes=[]
    for f in b.GetFootprints():
        for p in f.Pads():
            if p.GetAttribute()==pcb.PAD_ATTRIB_NPTH:
                holes.append(Point(pos(p.GetPosition())).buffer(p.GetDrillSize().x/2e6));continue
            poly=pad_shape(p)
            layers=[l for l,k in enumerate([pcb.F_Cu,pcb.B_Cu]) if p.IsOnLayer(k)]
            copper.append((p.GetNetname(),layers,poly))
    for t in b.GetTracks():
        if isinstance(t,pcb.PCB_VIA):copper.append((t.GetNetname(),[0,1],Point(pos(t.GetPosition())).buffer(t.GetWidth(pcb.F_Cu)/2e6)))
        else:copper.append((t.GetNetname(),[0 if t.GetLayer()==pcb.F_Cu else 1],LineString([pos(t.GetStart()),pos(t.GetEnd())]).buffer(t.GetWidth()/2e6)))
    return copper,unary_union(holes)

def components(copper,name):
    polygons=[]
    for layer in range(2):
        geom=unary_union([p for n,ls,p in copper if n==name and layer in ls]).buffer(.00001)
        if geom.is_empty:continue
        polygons += [(layer,p) for p in ([geom] if geom.geom_type=='Polygon' else geom.geoms)]
    groups=list(range(len(polygons)))
    def root(i):
        while groups[i]!=i:i=groups[i]
        return i
    for n,ls,p in copper:
        if n!=name or len(ls)!=2:continue
        ids=[i for i,(l,q) in enumerate(polygons) if q.intersects(p)]
        for i in ids[1:]:groups[root(i)]=root(ids[0])
    result={}
    for i,item in enumerate(polygons):result.setdefault(root(i),[]).append(item)
    return list(result.values())

def prune_orphans(board,names):
    """Discard isolated route fragments with neither a pad nor fixed copper."""
    copper,_=shapes(board);removed=[]
    for name in names:
        anchors=[]
        for f in board.GetFootprints():
            for p in f.Pads():
                if p.GetNetname()==name:
                    anchors.append(([i for i,l in enumerate([pcb.F_Cu,pcb.B_Cu]) if p.IsOnLayer(l)],pad_shape(p)))
        for t in board.GetTracks():
            if t.GetNetname()!=name or not t.IsLocked():continue
            if isinstance(t,pcb.PCB_VIA):anchors.append(([0,1],Point(pos(t.GetPosition())).buffer(t.GetWidth(pcb.F_Cu)/2e6)))
            else:anchors.append(([0 if t.GetLayer()==pcb.F_Cu else 1],LineString([pos(t.GetStart()),pos(t.GetEnd())]).buffer(t.GetWidth()/2e6)))
        for group in components(copper,name):
            if any(l in ls and poly.intersects(a) for l,poly in group for ls,a in anchors):continue
            for t in list(board.GetTracks()):
                if t.GetNetname()!=name or t.IsLocked():continue
                if isinstance(t,pcb.PCB_VIA):ls=[0,1];shape=Point(pos(t.GetPosition()))
                else:ls=[0 if t.GetLayer()==pcb.F_Cu else 1];shape=LineString([pos(t.GetStart()),pos(t.GetEnd())])
                if any(l in ls and p.intersects(shape) for l,p in group):board.Remove(t);t.thisown=False;removed.append(t)
    return removed



def join_point(board,name,layer,point,exclude=None):
    """Terminate on a conductor centre, rather than just grazing its edge."""
    p=Point(point)
    for f in board.GetFootprints():
        for pad in f.Pads():
            if pad.GetNetname()==name and pad.IsOnLayer(layer) and pad_shape(pad).covers(p):return point
    candidates=[]
    for t in board.GetTracks():
        if t.GetNetname()!=name or (exclude and t.m_Uuid.AsString()==exclude):continue
        if isinstance(t,pcb.PCB_VIA):
            target=Point(pos(t.GetPosition()));radius=t.GetWidth(pcb.F_Cu)/2e6
        elif t.GetLayer()==layer:
            line=LineString([pos(t.GetStart()),pos(t.GetEnd())]);target=line.interpolate(line.project(p));radius=t.GetWidth()/2e6
        else:continue
        distance=p.distance(target)
        if distance<1e-6:return point
        if distance<=radius+.0001:candidates.append((distance,(target.x,target.y)))
    return min(candidates)[1] if candidates else point


def finish(board,g,path,root,config,max_connections=30):
    from .job_guard import ProgressLimit
    limits=config['router']
    budget=ProgressLimit(limits.get('completion_timeout_seconds',300),limits.get('no_progress_seconds',120),limits.get('no_progress_iterations',25))
    # Laser apertures are true board cutouts, while PTH pads can be entered by copper.
    from .thumb_checks import holes as board_holes
    all_holes=board_holes(board);copper,npth=shapes(board)
    pth=unary_union([Point(pos(p.GetPosition())).buffer(p.GetDrillSize().x/2e6+.01) for f in board.GetFootprints() for p in f.Pads() if p.GetAttribute()==pcb.PAD_ATTRIB_PTH and p.GetDrillSize().x])
    cutouts=all_holes.difference(pth).difference(npth.buffer(.01))
    islands=unary_union(list(g['islands'].values()));pitch=g.get('routing_grid_mm',.05)
    via_diameter=config['rules']['via_diameter_mm'];via_radius=via_diameter/2
    lo=np.floor(np.array(islands.bounds[:2])/pitch)*pitch-pitch;hi=np.array(islands.bounds[2:])+pitch
    xs=np.arange(lo[0],hi[0],pitch);ys=np.arange(lo[1],hi[1],pitch);xx,yy=np.meshgrid(xs,ys);H,W=xx.shape
    def mask(p):
        prepare(p)
        return contains_xy(p,xx,yy)
    history=[];ripups=0;removed_items=[];priority=None
    for iteration in range(max_connections):
        budget.check_time()
        for t in list(board.GetTracks()):
            if not isinstance(t,pcb.PCB_VIA) and t.GetStart()==t.GetEnd():
                board.Remove(t);t.thisown=False;removed_items.append(t)
        save(board,path,config,root);report=drc(path)
        print('Completion',g['hand'],iteration,'unconnected',len(report['unconnected']),flush=True)
        dangling_count=sum(v['type'] in ('track_dangling','via_dangling') for v in report['violations'])
        budget.observe((len(report['unconnected']),dangling_count))
        if any(v['type'] in ('shorting_items','tracks_crossing','clearance') for v in report['violations']):raise RuntimeError('Fix copper conflicts before completing open nets')
        if not report['unconnected']:
            if g.get('allow_open_fixed_ends'):return board,history
            dangling={i['uuid'] for v in report['violations'] if v['type'] in ('track_dangling','via_dangling') for i in v['items']}
            # Grid searches end inside copper. Make those junctions exact
            # before pruning, so native dangling checks cannot peel a useful
            # connection away one tiny segment at a time.
            joined=0
            for t in list(board.GetTracks()):
                if t.IsLocked() or isinstance(t,pcb.PCB_VIA) or t.m_Uuid.AsString() not in dangling:continue
                for getter,setter in [(t.GetStart,t.SetStart),(t.GetEnd,t.SetEnd)]:
                    old=pos(getter());new=join_point(board,t.GetNetname(),t.GetLayer(),old,t.m_Uuid.AsString())
                    if math.dist(old,new)>1e-6:setter(vec(new[0],-new[1]));joined+=1
            if joined:continue
            pruned=0
            for t in list(board.GetTracks()):
                if str(t.m_Uuid.AsString()) in dangling and not t.IsLocked():board.Remove(t);t.thisown=False;removed_items.append(t);pruned+=1
            if pruned:continue
            if g.get('allow_open_fixed_ends'):return board,history
            snapped=False
            for fixed in board.GetTracks():
                if fixed.m_Uuid.AsString() not in dangling or not fixed.IsLocked():continue
                for target in [fixed.GetStart(),fixed.GetEnd()]:
                    if not islands.buffer(-.1).covers(Point(pos(target))):continue
                    options=[]
                    for t in board.GetTracks():
                        if t.IsLocked() or isinstance(t,pcb.PCB_VIA) or t.GetNetname()!=fixed.GetNetname() or t.GetLayer()!=fixed.GetLayer():continue
                        for end,p in [('start',t.GetStart()),('end',t.GetEnd())]:
                            distance=math.dist(xy(p),xy(target))
                            if 1e-5<distance<.4:options.append((distance,t,end,p))
                    for _,t,end,old in sorted(options,key=lambda o:o[0]):
                        setter=t.SetStart if end=='start' else t.SetEnd;setter(target);save(board,path,config,root);trial=drc(path)
                        if not trial['unconnected'] and not any(v['type'] not in ('track_dangling','via_dangling') for v in trial['violations']):snapped=True;break
                        setter(old)
                    if snapped:break
                if snapped:break
            if snapped:continue
            return board,history
        if g.get('prune_orphans'):
            import re
            names={m[1] for item in report['unconnected'] for m in [re.search(r'\[([^]]+)\]',item['items'][0]['description'])] if m}
            pruned=prune_orphans(board,names);removed_items.extend(pruned)
            if pruned:
                print('Pruned orphan copper',len(pruned),flush=True);continue
        copper,npth=shapes(board);progress=False
        names=[]
        for item in report['unconnected']:
            import re
            m=re.search(r'\[([^]]+)\]',item['items'][0]['description'])
            if m and m[1] not in names:names.append(m[1])
        if g.get('vary_route_order') and ripups:
            import hashlib
            names.sort(key=lambda n:(0 if n==priority else 1,hashlib.sha256((str(ripups)+':'+n).encode()).hexdigest()))
        else:names.sort(key=lambda n:-1 if n==priority else 0 if n=='GND' else 1)
        for name in names:
            groups=components(copper,name)
            if len(groups)<2:continue
            width=g.get('routing_width_mm',.15);radius=width/2;clear=config['rules']['clearance_mm']+.005
            edge=config['rules']['edge_clearance_mm'];hole=config['rules']['hole_clearance_mm']
            freebase=islands.buffer(-edge-radius-.025).difference(cutouts.buffer(edge+radius+.025)).difference(npth.buffer(hole+radius+.025))
            viabase=islands.buffer(-edge-via_radius-.025).difference(cutouts.buffer(edge+via_radius+.025)).difference(npth.buffer(hole+via_radius+.025))
            allowed=[];via=[]
            for layer in range(2):
                obstacles=unary_union([p for n,ls,p in copper if n!=name and layer in ls])
                allowed.append(mask(freebase.difference(obstacles.buffer(clear+radius))))
                via.append(mask(viabase.difference(obstacles.buffer(clear+via_radius))))
            allowed=np.array(allowed);via=via[0]&via[1]
            reach=None
            if g.get('routing_reachability'):
                labels0,n0=ndimage.label(allowed[0]);labels1,n1=ndimage.label(allowed[1])
                parents=list(range(n0+n1+1))
                def find(i):
                    while parents[i]!=i:
                        parents[i]=parents[parents[i]];i=parents[i]
                    return i
                for encoded in np.unique(labels0[via].astype(np.int64)*(n1+1)+labels1[via]):
                    a=int(encoded//(n1+1));b=int(encoded%(n1+1))+n0
                    if a and b!=n0:parents[find(b)]=find(a)
                roots=np.array([find(i) for i in range(len(parents))])
                reach=np.array([roots[labels0],np.where(labels1,roots[labels1+n0],0)])
            own=[unary_union([p for l,p in group]) for group in groups]
            pairs=sorted((own[a].distance(own[b]),a,b) for a in range(len(groups)) for b in range(a+1,len(groups)))
            for _,ia,ib in pairs:
                start=np.zeros_like(allowed);goal=np.zeros_like(allowed)
                for layer,p in groups[ia]:start[layer]|=mask(p)
                for layer,p in groups[ib]:goal[layer]|=mask(p)
                start &= allowed;goal &= allowed
                if reach is not None:
                    common=np.intersect1d(np.unique(reach[start]),np.unique(reach[goal]))
                    common=common[common!=0]
                    if not len(common):continue
                    viable=np.isin(reach,common);start &= viable;goal &= viable
                print('Search',name,'sources',int(start.sum()),'targets',int(goal.sum()),flush=True)
                if not start.any() or not goal.any():continue
                # Euclidean distance to any target copper gives a consistent lower bound.
                heuristic=ndimage.distance_transform_edt(~goal.any(axis=0))
                costs=np.full(allowed.shape,np.inf);parent={};queue=[]
                for l,y,x in np.argwhere(start):
                    costs[l,y,x]=0;idx=(int(l),int(y),int(x));heapq.heappush(queue,(heuristic[y,x],0,idx))
                end=None
                searched=0
                while queue:
                    searched+=1
                    if searched%4096==0:budget.check_time()
                    _,cost,node=heapq.heappop(queue);l,y,x=node
                    if cost!=costs[node]:continue
                    if goal[node]:end=node;break
                    moves=[(l,y+dy,x+dx,math.sqrt(2) if dx and dy else 1) for dx,dy in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]]
                    if via[y,x]:moves.append((1-l,y,x,g.get('via_cost_mm',35*pitch)/pitch))
                    for nl,ny,nx,extra in moves:
                        if not (0<=ny<H and 0<=nx<W) or not allowed[nl,ny,nx]:continue
                        if nl==l and ny!=y and nx!=x and not (allowed[l,y,nx] and allowed[l,ny,x]):continue
                        new=cost+extra;nxt=(nl,ny,nx)
                        if new+1e-9<costs[nxt]:
                            costs[nxt]=new;parent[nxt]=node;heapq.heappush(queue,(new+heuristic[ny,nx],new,nxt))
                if end is None:continue
                route=[end]
                while route[-1] in parent:route.append(parent[route[-1]])
                route.reverse();pts=[];layer=route[0][0]
                first=route[0];last=route[-1]
                first_xy=(round(xs[first[2]],6),round(ys[first[1]],6))
                last_xy=(round(xs[last[2]],6),round(ys[last[1]],6))
                start_join=join_point(board,name,pcb.F_Cu if first[0]==0 else pcb.B_Cu,first_xy)
                end_join=join_point(board,name,pcb.F_Cu if last[0]==0 else pcb.B_Cu,last_xy)
                if start_join!=first_xy:pts.append((start_join[0],-start_join[1]))
                for l,y,x in route:
                    point=(round(xs[x],6),round(-ys[y],6))
                    if l!=layer:
                        track(board,list(LineString(pts).simplify(.000001).coords) if len(pts)>1 else pts,'F.Cu' if layer==0 else 'B.Cu',name,width);pts=[point];layer=l
                        v=pcb.PCB_VIA(board);v.SetPosition(vec(*point));v.SetWidth(round(via_diameter*1e6));v.SetDrill(300000);v.SetLayerPair(pcb.F_Cu,pcb.B_Cu);v.SetNet(net(board,name));board.Add(v)
                    else:pts.append(point)
                if end_join!=last_xy:pts.append((end_join[0],-end_join[1]))
                track(board,list(LineString(pts).simplify(.000001).coords) if len(pts)>1 else pts,'F.Cu' if layer==0 else 'B.Cu',name,width)
                history.append({'net':name,'grid_steps':len(route),'pitch_mm':pitch});progress=True;break
            if progress:break
        if not progress:
            # A route can trap an adjacent flex terminal before the router gets
            # to it. Rip up only nearby, unlocked island copper and try again.
            candidates=[]
            for name in names:
                groups=components(copper,name)
                for line in g['bridge_tracks']:
                    if line['net']!=name:continue
                    for point in [line['points'][0],line['points'][-1]]:
                        pt=Point(point)
                        area=next((p for p in g['islands'].values() if p.covers(pt)),None)
                        if area is None:continue
                        near=sum(any(poly.intersects(area) for _,poly in group) for group in groups)
                        if near>1:
                            local_area=min((sum(poly.intersection(area).area for _,poly in group) for group in groups if any(poly.covers(pt) for _,poly in group)),default=1e6)
                            candidates.append((name,point,local_area))
            if ripups>=g.get('max_ripups',6) or not candidates:raise RuntimeError('Island completion cannot find a legal path: '+str(names))
            candidates.sort(key=lambda c:(names.index(c[0]),c[2]))
            name,point,_=candidates[0];removed=0;rip_shape=Point(point)
            if g.get('corridor_ripup') and ripups>=1:
                area=next((p for p in g['islands'].values() if p.covers(Point(point))),None)
                groups=components(copper,name)
                source=next((unary_union([p for _,p in group]).intersection(area) for group in groups if any(p.buffer(.0001).covers(Point(point)) for _,p in group)),None)
                if source is not None:
                    targets=[unary_union([p for _,p in group]).intersection(area) for group in groups if not any(p.buffer(.0001).covers(Point(point)) for _,p in group)]
                    targets=[p for p in targets if not p.is_empty]
                    if targets:
                        a,z=nearest_points(source,min(targets,key=lambda p:source.distance(p)))
                        rip_shape=LineString([a,z])
            reset_area=None
            if g.get('reset_trapped_island') and ripups and ripups%4==0:
                reset_area=next((p for p in g['islands'].values() if p.covers(Point(point))),None)
            for t in list(board.GetTracks()):
                if t.IsLocked() or t.GetNetname()==name:continue
                shape=Point(pos(t.GetPosition())) if isinstance(t,pcb.PCB_VIA) else LineString([pos(t.GetStart()),pos(t.GetEnd())])
                if (reset_area is not None and shape.intersects(reset_area)) or shape.distance(rip_shape)<g.get('ripup_radius_mm',1.5):
                    board.Remove(t);t.thisown=False;removed_items.append(t);removed+=1
            if not removed:raise RuntimeError('No removable island copper at '+str(point))
            history.append({'ripup_near':point,'net':name,'removed_items':removed});ripups+=1;priority=name
            print('Local rip-up',name,point,removed,flush=True)
    raise RuntimeError('Too many completion connections')
