"""Route island copper around fixed flex conductors using temporary DSN terminals."""
import re
import pcbnew as pcb
from shapely.geometry import Polygon
from .pcb import load_board, net,vec,save
from . import routing


def route(board,g,path,root,out,config):
    from .pcb import footprint,outline,track,xy
    import numpy as np
    from shapely.geometry import Point,LineString
    keep=[];copper=[]
    for index,name in enumerate(['near','home','far'],1):
        pose=g['poses'][name];center=vec(pose['center'][0],-pose['center'][1]);angle=pose['angle_deg']
        part=pcb.BOARD();refs={prefix+str(index) for prefix in ['SW','D']}
        if name=='home':refs.update(['W'+str(i) for i in range(1,5)])
        for fp in board.GetFootprints():
            if fp.GetReference() not in refs:continue
            x,y=xy(fp.GetPosition());loc=(np.array([x,-y])-pose['center'])@pose['rotation']
            pinmap={p.GetNumber():p.GetNetname() for p in fp.Pads() if p.GetNumber()}
            dup=footprint(part,root,fp.GetFPIDAsString(),fp.GetReference(),(round(loc[0],4),round(-loc[1],4)),pinmap,back=fp.IsFlipped())
            dup.SetValue(fp.GetValue())
        poly=g['islands'][name]
        coords=(np.array(poly.exterior.coords[:-1])-pose['center'])@pose['rotation']
        outline(part,[(round(x,4),round(-y,4)) for x,y in coords])
        # Include the portions of the fixed buses inside this key area. Without
        # these obstacles a locally valid route can short the arriving bridge.
        for line in g['bridge_tracks']:
            clipped=LineString(line['points']).intersection(poly.buffer(-.6))
            parts=[] if clipped.is_empty else ([clipped] if clipped.geom_type=='LineString' else list(clipped.geoms))
            for stub in parts:
                if stub.geom_type!='LineString':continue
                pp=(np.array(stub.coords)-pose['center'])@pose['rotation']
                track(part,[(round(x,4),round(-y,4)) for x,y in pp],'B.Cu',line['net'],line['width'],locked=True)
        for i,line in enumerate(g['bridge_tracks']):
            for j,point in enumerate([line['points'][0],line['points'][-1]]):
                if not poly.buffer(.001).covers(Point(point)):continue
                loc=(np.array(point)-pose['center'])@pose['rotation']
                fp=pcb.FOOTPRINT(part);fp.SetFPIDAsString('rosebear_v4:RoutingTerminal_'+str(round(line['width']*1000)));fp.SetReference('PORT_'+str(i)+'_'+str(j));fp.SetPosition(vec(loc[0],-loc[1]));part.Add(fp)
                pad=pcb.PAD(fp);pad.SetNumber('1');pad.SetAttribute(pcb.PAD_ATTRIB_SMD);pad.SetShape(pcb.PAD_SHAPE_CIRCLE);pad.SetSize(vec(line['width'],line['width']));pad.SetPosition(fp.GetPosition());layers=pcb.LSET();layers.AddLayer(pcb.B_Cu);pad.SetLayerSet(layers);pad.SetNet(net(part,line['net']));fp.Add(pad)
        island_path=path.parent/'islands'/(path.stem+'_'+name+'.kicad_pcb')
        save(part,island_path,config,root)
        routed=routing.route(island_path,root,out,config,lambda dsn: edge_clearance(dsn,config))
        keep.extend([part,routed])
        for t in routed.GetTracks():
            if t.IsLocked():continue
            t.Move(center);t.Rotate(center,pcb.EDA_ANGLE(angle,pcb.DEGREES_T))
            if isinstance(t,pcb.PCB_VIA):
                copper.append({'via':xy(t.GetPosition()),'diameter':t.GetWidth(pcb.F_Cu),'drill':t.GetDrillValue(),'net':t.GetNetname()})
            else:copper.append({'points':[xy(t.GetStart()),xy(t.GetEnd())],'layer':t.GetLayerName(),'net':t.GetNetname(),'width':t.GetWidth()/1e6})
    # Reopen the authoritative placement once, then add serialized island copper.
    board=load_board(str(path))
    for c in copper:
        if 'via' in c:
            v=pcb.PCB_VIA(board);v.SetPosition(vec(*c['via']));v.SetWidth(c['diameter']);v.SetDrill(c['drill']);v.SetLayerPair(pcb.F_Cu,pcb.B_Cu);v.SetNet(net(board,c['net']));board.Add(v)
        else:track(board,c['points'],c['layer'],c['net'],c['width'])
    save(board,path,config,root)
    board._router_keep=keep
    return board


def edge_clearance(path,config):
    """Compensate DSN's generic copper clearance at edges and NPTH apertures."""
    margin=(config['rules']['edge_clearance_mm']-config['rules']['clearance_mm'])*1000
    text=path.read_text()
    def polygon(match):
        prefix,values=match.groups();values=[float(x) for x in values.split()]
        poly=Polygon(list(zip(values[::2],values[1::2])))
        poly=poly.buffer(-margin if prefix.startswith('(path pcb') else margin,join_style=2)
        if poly.geom_type!='Polygon':raise ValueError('Router clearance offset split an outline')
        return prefix+' '.join(str(round(v,3)) for p in poly.exterior.coords for v in p)+')'
    text=re.sub(r'(\(path pcb 0\s+)([-+0-9.eE\s]+)\)',polygon,text)
    text=re.sub(r'(?<=keepout "" )(\(polygon signal 0\s+)([-+0-9.eE\s]+)\)',polygon,text)
    text=re.sub(r'(\(keepout "" \(circle [FB]\.Cu )([0-9.]+)',lambda m:m[1]+str(float(m[2])+2*margin),text)
    path.write_text(text)
