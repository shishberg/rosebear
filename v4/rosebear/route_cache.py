"""Reviewable copper snapshots, invalidated by placement or rule changes."""
import hashlib
import json
import pcbnew as pcb
from .pcb import xy, vec, track


def fingerprint(board, config):
    def q(v):return tuple(round(x,4) for x in xy(v))
    pads=[]
    for f in board.GetFootprints():
        for p in f.Pads():
            pads.append([f.GetReference(),p.GetNumber(),p.GetNetname(),q(p.GetPosition()),
                         q(p.GetSize()),q(p.GetDrillSize()),round(p.GetOrientationDegrees(),6),
                         p.GetShape(),p.GetLayerSet().FmtHex()])
    edges=sorted([str(d.GetShape())+':'+str(q(d.GetStart()))+':'+str(q(d.GetEnd()))
                  for d in list(board.GetDrawings())+[d for f in board.GetFootprints() for d in f.GraphicalItems()] if d.GetLayer()==pcb.Edge_Cuts])
    data={'pads':sorted(pads),'edges':edges,'rules':config['rules'],'thickness':config['pcb_thickness_mm']}
    return hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()


def capture(board,config,path):
    copper=[]
    for t in board.GetTracks():
        if isinstance(t,pcb.PCB_VIA):
            copper.append({'via':xy(t.GetPosition()),'diameter':t.GetWidth(pcb.F_Cu)/1e6,'drill':t.GetDrillValue()/1e6,'net':t.GetNetname()})
        else:
            copper.append({'start':xy(t.GetStart()),'end':xy(t.GetEnd()),'width':t.GetWidth()/1e6,
                           'layer':board.GetLayerName(t.GetLayer()),'net':t.GetNetname()})
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps({'schema':1,'placement_sha256':fingerprint(board,config),'copper':copper},indent=2)+'\n')


def apply(board,config,path):
    data=json.loads(path.read_text())
    if data['placement_sha256']!=fingerprint(board,config):
        raise ValueError('PCB placement/rules changed; reroute and review before updating '+str(path))
    from .pcb import net
    for c in data['copper']:
        if 'via' in c:
            v=pcb.PCB_VIA(board); v.SetPosition(vec(*c['via'])); v.SetWidth(round(c['diameter']*1e6))
            v.SetDrill(round(c['drill']*1e6)); v.SetLayerPair(pcb.F_Cu,pcb.B_Cu); v.SetNet(net(board,c['net'])); board.Add(v)
        else: track(board,[c['start'],c['end']],c['layer'],c['net'],c['width'])
    return board


def replace(board,config,path):
    # Snapshot contains all copper. Preserve pads, outlines and keepouts.
    removed=list(board.GetTracks())
    for item in removed:board.Remove(item);item.thisown=False
    apply(board,config,path);board._removed_copper=removed
    return board
