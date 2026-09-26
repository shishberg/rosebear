"""Native KiCad layout for a three-key connected FPC, with four matrix wires."""
import math
import numpy as np
import pcbnew as pcb
from shapely.geometry import Polygon,LineString
from shapely.ops import unary_union
from .pcb import footprint,wirepad,outline,label,track,vec,xy,pad_of


def make(root,g):
    b=pcb.BOARD();hand=g['hand'];H=hand.upper();side=1 if hand=='r' else -1
    def pt(name,local):
        p=g['poses'][name];v=p['center']+p['rotation']@np.array(local);return (round(v[0],4),round(-v[1],4))
    for i,name in enumerate(['near','home','far'],1):
        row='ROW_'+H+'_'+{'near':'BOTTOM','home':'HOME','far':'TOP'}[name];col='COL_'+H+'_THUMB';swd='SWD_'+H+'_'+name.upper();ang=g['poses'][name]['angle_deg']
        sw=footprint(b,root,'rosebear:SW_Hotswap_Kailh_MX_1.00u_PCB','SW'+str(i),pt(name,[0,0]),{'1':col,'2':swd},angle=ang)
        diode=footprint(b,root,'Diode_SMD:D_SOD-123','D'+str(i),pt(name,[0,-8.8]),{'1':row,'2':swd},angle=ang,back=True);diode.SetValue('1N4148W')
        label(b,name.upper(),pt(name,[0,2.9]),.8)
    # One solder harness lands on an integral, stiffened tab beside the home key.
    names=['ROW_'+H+'_BOTTOM','ROW_'+H+'_HOME','ROW_'+H+'_TOP','COL_'+H+'_THUMB']
    for i,name in enumerate(names,1):
        pos=[side*(12+(i-1)%2*3.5),6-((i-1)//2)*4]
        wirepad(b,root,'W'+str(i),name,pt('home',pos))
    tab=Polygon([(side*7.5,-10.5),(side*18,-10.5),(side*18,8),(side*7.5,8)])
    g['islands']['home']=unary_union([g['islands']['home'],tab]);g['pieces'][next(i for i,p in enumerate(g['pieces']) if p['kind']=='island' and p['owner']=='home')]['polygon']=g['islands']['home']
    g['outline']=unary_union([g['outline'],tab]).buffer(.002).buffer(-.002).simplify(.001,preserve_topology=True);outline(b,[(x,-y) for x,y in g['outline'].exterior.coords[:-1]])
    # Route every flex crossing explicitly on B.Cu. Only island copper is left to the router.
    g['bridge_tracks']=[]
    for name,branch in g['branches'].items():
        nets=(['ROW_'+H+'_BOTTOM','COL_'+H+'_THUMB'] if name=='near' else
              ['ROW_'+H+'_TOP','COL_'+H+'_THUMB'])
        widths=[g['spec']['signal_width_mm'] for n in nets]
        total=sum(widths)+.2*(len(nets)-1);cursor=-total/2
        for net,width in zip(nets,widths):
            offset=cursor+width/2;cursor+=width+.2
            path=branch['centerline'].parallel_offset(abs(offset),'left' if offset>=0 else 'right',resolution=16,join_style=1)
            points=[(round(x,4),round(-y,4)) for x,y in path.coords]
            track(b,points,'B.Cu',net,width,locked=True)
            g['bridge_tracks'].append({'net':net,'width':width,'points':[(x,-y) for x,y in points]})
    if hand=='l':
        # This adjacent same-net join must be made before other signals can
        # enclose it. The hotswap land pattern is asymmetric between hands.
        start=g['bridge_tracks'][1]['points'][0]
        switch=next(f for f in b.GetFootprints() if f.GetReference()=='SW2')
        x,y=xy(pad_of(switch,1).GetPosition());end=(x,-y)
        track(b,[(start[0],-start[1]),(end[0],-end[1])],'B.Cu','COL_L_THUMB',.15,locked=True)
        g['bridge_tracks'].append({'net':'COL_L_THUMB','width':.15,'points':[start,end],'purpose':'fixed local switch join'})
    for branch in g['branches'].values():
        z=pcb.ZONE(b);z.SetIsRuleArea(True);z.SetLayerSet(pcb.LSET.AllCuMask())
        z.SetDoNotAllowVias(True);z.SetDoNotAllowTracks(False);z.SetDoNotAllowPads(True);z.SetDoNotAllowFootprints(False);z.SetDoNotAllowZoneFills(True)
        poly=z.Outline();poly.NewOutline()
        for x,y in branch['bend'].exterior.coords[:-1]:poly.Append(round(x*1e6),round(-y*1e6))
        b.Add(z)
    # Manufacturing drawing: component-side copper is on the back; stiffeners on the front.
    for name,poly in g['islands'].items():
        coords=list(poly.exterior.coords)
        for a,c in zip(coords,coords[1:]):
            shape=pcb.PCB_SHAPE(b);shape.SetShape(pcb.SHAPE_T_SEGMENT);shape.SetStart(vec(a[0],-a[1]));shape.SetEnd(vec(c[0],-c[1]));shape.SetLayer(pcb.User_1);shape.SetWidth(100000);b.Add(shape)
    text=pcb.PCB_TEXT(b);text.SetText('FRONT STIFFENER 0.4 mm / FPC 0.2 mm\nBend R >= 10 mm; component side B.Cu');text.SetPosition(vec(0,43));text.SetLayer(pcb.Dwgs_User);text.SetTextSize(vec(1,1));b.Add(text)
    return b
