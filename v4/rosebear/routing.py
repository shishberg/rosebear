"""Local, replaceable DSN/SES router with protected bend copper."""
import hashlib
import json
import os
import subprocess
from pathlib import Path
import pcbnew as pcb
from .pcb import load_board, save, signature, metrics, xy, intersects_box

JAR_SHA256 = "251101c3eeac22d7e7dfcf6796603279e5d1000283eb82d8f093780f7afc6aa9"


def route(path, root, out, config, prepare_dsn=None):
    board=load_board(str(path))
    # Loading a PCB alone does not load its .kicad_pro netclass rules.
    rules=config['rules']; settings=board.GetDesignSettings()
    settings.m_MinClearance=round(rules['clearance_mm']*1e6)
    settings.m_CopperEdgeClearance=round(rules['edge_clearance_mm']*1e6)
    settings.m_HoleClearance=round(rules['hole_clearance_mm']*1e6)
    for nc in board.GetAllNetClasses().values():
        nc.SetClearance(round(rules['clearance_mm']*1e6)); nc.SetTrackWidth(round(config['router'].get('track_width_mm',max(.2,rules['track_width_mm']))*1e6))
        nc.SetViaDiameter(round(rules['via_diameter_mm']*1e6)); nc.SetViaDrill(round(rules['via_drill_mm']*1e6))
    protected={signature(t) for t in board.GetTracks() if t.IsLocked() and not isinstance(t,pcb.PCB_VIA)}
    jar=Path(os.environ.get('FREEROUTING_JAR',str(out/'tools/freerouting-2.4.1.jar')))
    if not jar.exists() or hashlib.sha256(jar.read_bytes()).hexdigest()!=JAR_SHA256:
        raise RuntimeError('Pinned Freerouting JAR missing or checksum mismatch; run v4/tools/setup_router.py')
    java=Path(os.environ.get('FREEROUTING_JAVA',str(out/'tools/jdk-25.0.4.1+1-jre/Contents/Home/bin/java')))
    if not java.exists(): raise RuntimeError('Portable Java missing; run v4/tools/setup_router.py')
    dsn=path.with_suffix('.dsn'); ses=path.with_suffix('.ses')
    if not pcb.ExportSpecctraDSN(board,str(dsn)): raise RuntimeError('DSN export failed')
    if prepare_dsn: prepare_dsn(dsn)
    # Keep prior output from masquerading as this run's result.
    if ses.exists(): ses.unlink()
    cmd=[str(java),'-Djava.awt.headless=true','-Dfreerouting.logging.file.enabled=false','-jar',str(jar),
         '--gui.enabled=false','--api_server.enabled=false','-da','-dl',
         '--user_data_path='+str(path.parent/(path.stem+'-router-state')),
         '-de',str(dsn),'-do',str(ses),'-mp',str(config['router']['passes']),'-mt','1',
         '-is','sequential','--router.fanout.enabled='+str(config['router'].get('fanout',False)).lower()]
    with path.with_suffix('.router.log').open('w') as log:
        try:
            result=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,timeout=config['router']['timeout_seconds'])
        except subprocess.TimeoutExpired:
            raise RuntimeError('Router timed out: '+str(path))
    if result.returncode or not ses.exists(): raise RuntimeError('Routing failed; see '+str(path.with_suffix('.router.log')))
    if not pcb.ImportSpecctraSES(board,str(ses)): raise RuntimeError('SES import failed')
    actual={signature(t) for t in board.GetTracks() if not isinstance(t,pcb.PCB_VIA)}
    if not protected.issubset(actual): raise RuntimeError('Router changed protected bend crossings')
    save(board,path,config,root)
    return board


def check_bends(board, regions, fixed=None):
    errors=[];widths={}
    for line in fixed or []:
        for a,b in zip(line['points'],line['points'][1:]):
            a,b=sorted([tuple(round(x,6) for x in a),tuple(round(x,6) for x in b)])
            widths[(line['net'],line['layer'],a,b)]=line['width']
    for t in board.GetTracks():
        if isinstance(t,pcb.PCB_VIA):
            x,y=xy(t.GetPosition()); r=t.GetWidth(pcb.F_Cu)/2e6
            if any(intersects_box((x,y),(x,y),[b[0]-r,b[1]-r,b[2]+r,b[3]+r]) for b in regions):
                errors.append('via in bend: '+str((x,y)))
        elif any(intersects_box(xy(t.GetStart()),xy(t.GetEnd()),b) for b in regions):
            allowed_width=widths.get(signature(t),.135)
            if abs(t.GetWidth()/1e6-allowed_width)>1e-6:
                # Ends may be trimmed inside a rigid island; the original
                # straight conductor still bounds the permitted wider copper.
                from shapely.geometry import LineString
                segment=LineString([xy(t.GetStart()),xy(t.GetEnd())])
                permitted=any(line['net']==t.GetNetname() and line['layer']==t.GetLayerName()
                              and abs(line['width']-t.GetWidth()/1e6)<1e-6
                              and LineString(line['points']).buffer(.000002).covers(segment) for line in fixed or [])
                if not permitted:errors.append('wrong bend trace width')
            for box in regions:
                if box[1]>-999 and intersects_box(xy(t.GetStart()),xy(t.GetEnd()),box):
                    a,b=xy(t.GetStart()),xy(t.GetEnd())
                    if abs(a[0]-b[0])>1e-5: errors.append('trace crosses hinge obliquely')
    for f in board.GetFootprints():
        for shape in f.GraphicalItems():
            if shape.GetLayer() in (pcb.F_Fab,pcb.B_Fab) and isinstance(shape,pcb.PCB_SHAPE):
                if shape.GetShape()==pcb.SHAPE_T_SEGMENT and any(intersects_box(xy(shape.GetStart()),xy(shape.GetEnd()),b) for b in regions):
                    errors.append('component body outline in bend: '+f.GetReference())
    return sorted(set(errors))
