#!/usr/bin/env python3
"""Remove provably avoidable layer hops; accept changes only after native DRC."""
import sys,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'v4'),str(ROOT/'output_v4/tools/python39')]
import wx,pcbnew as pcb
from shapely.geometry import LineString,Point
from shapely.ops import unary_union
from rosebear import thumb_finish,thumb_geometry,thumb_pcb,thumb_checks,route_cache
from rosebear.pcb import load_board, save,drc,metrics,xy
wx.Log.SetLogLevel(wx.LOG_Error);app=wx.App(False)
c=json.loads((ROOT/'v4/config.json').read_text());s=json.loads((ROOT/'v4/thumb_cluster.json').read_text());nc={**c,'rules':s['rules'],'pcb_thickness_mm':s['flex_thickness_mm']};ch=json.loads((ROOT/'v4'/c['chassis']).read_text())
for hand in sys.argv[1:] or ['l','r']:
    path=ROOT/'output_v4/connected-thumbs'/('thumb_'+hand+'.kicad_pcb');b=load_board(str(path));before=metrics(b);copper,_=thumb_finish.shapes(b);kept=[]
    for name in sorted({n for n,ls,p in copper if n}):
        geom=unary_union([p for n,ls,p in copper if n==name and 0 in ls]);parts=[geom] if geom.geom_type=='Polygon' else list(geom.geoms)
        obstacles=unary_union([p for n,ls,p in copper if n!=name and 1 in ls])
        for part in parts:
            traces=[t for t in b.GetTracks() if not isinstance(t,pcb.PCB_VIA) and t.GetNetname()==name and t.GetLayer()==pcb.F_Cu and part.intersects(Point(thumb_finish.pos(t.GetStart())))]
            vias=[v for v in b.GetTracks() if isinstance(v,pcb.PCB_VIA) and v.GetNetname()==name and part.covers(Point(thumb_finish.pos(v.GetPosition())))]
            if not traces or not vias:continue
            if any(LineString([thumb_finish.pos(t.GetStart()),thumb_finish.pos(t.GetEnd())]).distance(obstacles)<t.GetWidth()/2e6+s['rules']['clearance_mm']+.01 for t in traces):continue
            for t in traces:t.SetLayer(pcb.B_Cu)
            for v in vias:b.Remove(v);v.thisown=False;kept.append(v)
            save(b,path,nc,ROOT);result=drc(path)
            if result['violations'] or result['unconnected']:
                for t in traces:t.SetLayer(pcb.F_Cu)
                for v in vias:b.Add(v)
            else:print(hand,'removed',len(vias),'vias from',name,flush=True)
    # Merge only straight, degree-two joins; never alter protected flex traces.
    changed=True
    while changed:
        changed=False;ends={}
        for t in b.GetTracks():
            if isinstance(t,pcb.PCB_VIA) or t.IsLocked():continue
            for p in [t.GetStart(),t.GetEnd()]:ends.setdefault((t.GetNetname(),t.GetLayer(),t.GetWidth(),xy(p)),[]).append(t)
        for key,items in ends.items():
            if len(items)!=2:continue
            a,d=items;join=key[-1];pa=xy(a.GetStart()) if xy(a.GetEnd())==join else xy(a.GetEnd());pd=xy(d.GetStart()) if xy(d.GetEnd())==join else xy(d.GetEnd())
            av=(pa[0]-join[0],pa[1]-join[1]);dv=(pd[0]-join[0],pd[1]-join[1])
            if abs(av[0]*dv[1]-av[1]*dv[0])>1e-8 or av[0]*dv[0]+av[1]*dv[1]>=0:continue
            from rosebear.pcb import vec
            a.SetStart(vec(*pa));a.SetEnd(vec(*pd));b.Remove(d);d.thisown=False;kept.append(d);changed=True;break
    save(b,path,nc,ROOT);result=drc(path)
    if result['violations'] or result['unconnected']:raise RuntimeError(result)
    g=thumb_geometry.build(ch,c,s,hand);seed=thumb_pcb.make(ROOT,g);b=load_board(str(path));errors=thumb_checks.validate(b,g)
    if errors:raise RuntimeError(errors)
    route_cache.capture(b,nc,ROOT/'v4/routes'/('thumb_'+hand+'.json'));print(hand,before,'->',metrics(b),flush=True)
