"""Independent electrical and flex-area checks for connected thumb clusters."""
import math
import pcbnew as pcb
from shapely.geometry import Point,LineString
from shapely.ops import unary_union,polygonize
from .pcb import xy,signature


def holes(board):
    shapes=[]
    for f in board.GetFootprints():
        for pad in f.Pads():
            if pad.GetDrillSize().x:
                x,y=xy(pad.GetPosition());shapes.append(Point(x,-y).buffer(pad.GetDrillSize().x/2e6))
        lines=[]
        for sh in f.GraphicalItems():
            if sh.GetLayer()==pcb.Edge_Cuts:
                a=xy(sh.GetStart());b=xy(sh.GetEnd());lines.append(LineString([(a[0],-a[1]),(b[0],-b[1])]))
        shapes.extend(polygonize(lines))
    return unary_union(shapes)


def validate(board,g):
    errors=[];H=g['hand'].upper();fps={f.GetReference():f for f in board.GetFootprints()}
    def pins(ref):return {p.GetNumber():p.GetNetname() for p in fps[ref].Pads() if p.GetNumber()}
    for i,(name,row) in enumerate([('near','BOTTOM'),('home','HOME'),('far','TOP')],1):
        junction='SWD_'+H+'_'+name.upper()
        if pins('SW'+str(i))!={'1':'COL_'+H+'_THUMB','2':junction}:errors.append('switch pinout '+name)
        if pins('D'+str(i))!={'1':'ROW_'+H+'_'+row,'2':junction}:errors.append('diode pinout '+name)
    wires=['ROW_'+H+'_'+r for r in ['BOTTOM','HOME','TOP']]+['COL_'+H+'_THUMB']
    for i,n in enumerate(wires,1):
        if pins('W'+str(i))!={'1':n}:errors.append('harness pinout W'+str(i))
    if set(fps)!={'SW1','SW2','SW3','D1','D2','D3','W1','W2','W3','W4'}:errors.append('unexpected thumb components')
    safe=unary_union(list(g['islands'].values())).buffer(-.3)
    for t in board.GetTracks():
        if isinstance(t,pcb.PCB_VIA):
            x,y=xy(t.GetPosition())
            if not safe.covers(Point(x,-y).buffer(t.GetWidth(pcb.F_Cu)/2e6)):errors.append('via outside stiffened key area '+str((x,y)))
    # Check every specified crossing survived DRC's save without net reassignment.
    actual={signature(t) for t in board.GetTracks() if not isinstance(t,pcb.PCB_VIA)}
    for line in g['bridge_tracks']:
        for a,b in zip(line['points'],line['points'][1:]):
            a,b=sorted([(a[0],-a[1]),(b[0],-b[1])]);key=(line['net'],'B.Cu',tuple(a),tuple(b))
            if key not in actual:errors.append('changed flex crossing '+line['net']);break
    return sorted(set(errors))


def component_envelopes(board,g):
    """Dimensioned body allowances, explicitly approximate for passive packages."""
    import numpy as np
    from shapely.geometry import Polygon,box
    from shapely.affinity import rotate,translate
    result=[]
    for f in board.GetFootprints():
        ref=f.GetReference()
        if ref.startswith('W'):continue
        if ref.startswith('SW'):
            owner=['near','home','far'][int(ref[2:])-1];p=g['poses'][owner]
            poly=Polygon(np.array([[-8.8,1],[7.5,1],[7.5,6.5],[-8.8,6.5]])@p['rotation'].T+p['center'])
            result.append({'name':ref+'_socket','owner':owner,'polygon':poly,'bottom':-3.1,'top':-.1});continue
        w,h,height=3.0,1.6,1.5;bottom=-.1-height;top=-.1
        owner=['near','home','far'][int(ref[1:])-1]
        x,y=xy(f.GetPosition());poly=translate(rotate(box(-w/2,-h/2,w/2,h/2),f.GetOrientationDegrees(),origin=(0,0)),x,-y)
        result.append({'name':ref,'owner':owner,'polygon':poly,'bottom':bottom,'top':top})
    return result
