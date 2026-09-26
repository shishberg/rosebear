"""Reproducible rigid-key quote boards, separate from the v4 production build."""
import sys, json, math, csv, subprocess, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'v4'),str(ROOT/'output_v4/tools/python39')]
from rosebear.job_guard import guard_entry
guard_entry(ROOT,__file__)
import wx
wx.Log.SetLogLevel(wx.LOG_Error)
app=wx.App(False)
import pcbnew as pcb
from rosebear import pcb as p, pod_pins
OUT=ROOT/'output_v4/key-quotes'
OUT.mkdir(parents=True,exist_ok=True)
CFG=json.loads((ROOT/'v4/config.json').read_text())
PINS=pod_pins.load()
CFG['pcb_thickness_mm']=1.6
CFG['rules'].update(clearance_mm=.2,track_width_mm=.2,edge_clearance_mm=.2)

def clone(old):
    raw=old.Duplicate(False) if isinstance(old,pcb.FOOTPRINT) else old.Duplicate()
    kind=type(old).__name__
    result=getattr(pcb,'Cast_to_'+kind)(raw)
    raw.thisown=False
    result.thisown=False
    return result

def part(b,lib,ref,pos,nets,value,angle=0,back=True):
    f=p.footprint(b,ROOT,lib,ref,pos,nets,angle,back)
    f.SetValue(value)
    return f

def wire(b,ref,name,pos,diam=2.0,drill=1.0):
    f=p.footprint(b,ROOT,'rosebear_v4:Wire_D2_Drill1',ref,pos,{'1':name})
    f.SetValue(name)
    f.Reference().SetVisible(False);f.Value().SetVisible(False)
    return f

def via(b,pos,name):
    v=pcb.PCB_VIA(b);v.SetPosition(p.vec(*pos));v.SetWidth(600000);v.SetDrill(300000)
    v.SetViaType(pcb.VIATYPE_THROUGH);v.SetLayerPair(pcb.F_Cu,pcb.B_Cu);v.SetNet(p.net(b,name));b.Add(v)

def make_key():
    b=pcb.BOARD()
    s=part(b,'rosebear:SW_Hotswap_Kailh_MX_1.00u_PCB','SW1',(0,0),{'1':'COL','2':'SW_DIODE'},'CPG151101S11',back=False)
    # Save a local footprint with switch-body graphics on Fab, leaving labels legible.
    for g in s.GraphicalItems():
        if g.GetLayer()==pcb.F_SilkS:g.SetLayer(pcb.F_Fab)
    s.SetFPIDAsString('rosebear_v4:Key_Socket_MX')
    pcb.FootprintSave(str(ROOT/'v4/footprints/rosebear_v4.pretty'),s)
    # Footprint contains B.Cu socket lands and the switch locating holes.
    d=part(b,'Diode_SMD:D_SOD-123','D1',(-6,5.3),{'1':'ROW','2':'SW_DIODE'},'1N4148W',90)
    led=part(b,'LED_SMD:LED_SK6812MINI-E_3.2x2.8mm_P1.5mm_ReverseMount','LED1',(0,4.8),{'1':'+5V','2':'DOUT','3':'GND','4':'DIN'},'SK6812MINI-E')
    c=part(b,'Capacitor_SMD:C_0805_2012Metric','C1',(6,5.3),{'1':'+5V','2':'GND'},'100nF 16V X7R',90)
    pads={'ROW':(-6.8,8.8),'COL':(0,-7.2),'DIN':(2.8,8.8),'DOUT':(-2.8,8.8),'+5V':(-7.8,1.8),'GND':(7.8,1.8)}
    fs={}
    for i,(n,pos) in enumerate(pads.items(),1):fs[n]=wire(b,'W'+str(i),n,pos)
    # Dedicated second power pads avoid putting two power wires into one hole.
    fs['+5V_OUT']=wire(b,'W7','+5V',(-7.8,-6.8))
    fs['GND_OUT']=wire(b,'W8','GND',(7.8,8.8))
    p.outline(b,[(-9.5,-8.5),(9.5,-8.5),(9.5,10.5),(-9.5,10.5)])
    # Signal routing is completed by the bounded router; power paths are explicit.
    pos=lambda f,n:p.xy(p.pad_of(f,n).GetPosition())
    v=(-4.2,2.6);a=pos(led,1)
    p.track(b,[a,(-4.2,a[1]),v],'B.Cu','+5V',.4,True);via(b,v,'+5V')
    p.track(b,[pads['+5V'],(-6,2.6),v,(4.5,2.6),(7.3,5.4),(7.3,6.25)],'F.Cu','+5V',.5,True)
    via(b,(7.3,6.25),'+5V');p.track(b,[(7.3,6.25),pos(c,1)],'B.Cu','+5V',.5,True)
    p.track(b,[pads['+5V'],(-8.6,1.0),(-8.6,-6),(-7.8,-6.8)],'F.Cu','+5V',.6,True)
    p.track(b,[pads['GND'],(7.4,2.2),(7.4,4.35),pos(c,2),(4.4,4.35),(4.4,5.55),pos(led,3)],'B.Cu','GND',.4,True)
    p.track(b,[pads['GND'],(8.6,2.6),(8.6,8),(7.8,8.8)],'F.Cu','GND',.6,True)
    for n,(x,y) in pads.items():
        text={'ROW':'R','COL':'C','DIN':'DI','DOUT':'DO','+5V':'+','GND':'G'}[n]
        p.label(b,text,(x,y-1.5 if y>7 else y+1.5),.8)
    p.label(b,'G',(7.8,7.3),.8);p.label(b,'+',(-7.8,-5.3),.8)
    return b

def save(b,name):
    path=OUT/name/(name+'.kicad_pcb');p.save(b,path,CFG,ROOT);return path

def route(b,name):
    from rosebear.routing import route as run
    path=save(b,name)
    config=json.loads(json.dumps(CFG));config['router'].update(passes=8,timeout_seconds=120,track_width_mm=.25)
    b=run(path,ROOT,ROOT/'output_v4',config)
    if name in ['hand_breakout','pod_rgb']:
        bounds=(-17.5,-5.5,17.5,26.5) if name=='hand_breakout' else (59.5,48.5,140.5,144.5)
        for layer in [pcb.F_Cu,pcb.B_Cu]:
            z=pcb.ZONE(b);z.SetLayer(layer);z.SetNet(p.net(b,'GND'));z.SetLocalClearance(200000);z.SetMinThickness(200000)
            z.SetPadConnection(pcb.ZONE_CONNECTION_FULL)
            poly=z.Outline();poly.NewOutline()
            x0,y0,x1,y1=bounds
            for x,y in [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]:poly.Append(round(x*1e6),round(y*1e6))
            b.Add(z)
    return b

def validate(b,name):
    path=save(b,name);result=p.drc(path)
    (path.parent/'drc-summary.json').write_text(json.dumps(result,indent=2)+'\n')
    print(name,'DRC',len(result['violations']),'unconnected',len(result['unconnected']),flush=True)
    for v in result['violations'][:15]:print(v['type'],v['description'],[x['description'] for x in v.get('items',[])],flush=True)
    if result['violations'] or result['unconnected']:raise RuntimeError('DRC failed '+name)
    return path

RIBBON=['GND','RGB','GND','RT','RH','RB','C0','C1','C2','C3','C4','C5',
        'GND','3V3','UP','DOWN','LEFT','RIGHT','BTN','GND','+5V','+5V','+5V','GND']
# LCSC-stocked. Pins 1-24 sit toward the cable end at local y=FFC_PAD_Y.
FFC='Connector_FFC-FPC:JUSHUO_AFA07-S24FCA-00_1x24-1MP_P1.0mm_Horizontal'
FFC_PART='AFA07-S24FCA-00'
FFC_PAD_Y=-3.375

def ribbon_nets(hand=None):
    if hand is None:return {str(i):n for i,n in enumerate(RIBBON,1)}|{'MP':'GND'}
    matrix={'RT':'ROW_'+hand+'_TOP','RH':'ROW_'+hand+'_HOME','RB':'ROW_'+hand+'_BOTTOM'}
    matrix.update({'C'+str(i):'COL_'+hand+'_'+n for i,n in enumerate(['PINKY','RING','MIDDLE','INDEX','INNER','THUMB'])})
    result={}
    for i,n in enumerate(RIBBON,1):
        if n in matrix:v=matrix[n]
        elif n=='RGB':v='RGB_'+hand
        elif n in ['UP','DOWN','LEFT','RIGHT','BTN']:v='TB_'+n if hand=='R' else ''
        else:v=n
        result[str(i)]=v
    result['MP']='GND'
    return result

def make_breakout():
    b=pcb.BOARD()
    part(b,FFC,'J1',(0,0),ribbon_nets(),FFC_PART,back=False)
    for i,n in enumerate(RIBBON,1):
        x=(i-12.5)*1.27;y=7 if i%2 else 12
        wire(b,'W'+str(i),n,(x,y))
        p.label(b,str(i),(x,y+1.6),.8)
    # A leaded bulk capacitor is easy to fit after breaking out the power bus.
    part(b,'Capacitor_THT:CP_Radial_D8.0mm_P3.50mm','C1',(-1.75,21),{'1':'+5V','2':'GND'},'470uF 10V',back=False)
    for i,x in enumerate([-15,15],1):
        f=part(b,'MountingHole:MountingHole_2.2mm_M2','H'+str(i),(x,22),{},'M2',back=False)
        f.SetAttributes(pcb.FP_EXCLUDE_FROM_POS_FILES|pcb.FP_EXCLUDE_FROM_BOM)
    p.outline(b,[(-18,-6),(18,-6),(18,27),(-18,27)])
    p.label(b,'24-WAY HAND / A',(0,16),.8)
    p.track(b,[(8.5,FFC_PAD_Y),(10.5,FFC_PAD_Y),(10.5,-4.9),(16.3,-4.9),(16.3,17),(-1.75,17),(-1.75,21)],'F.Cu','+5V',.6,True)
    p.track(b,[(10.795,7),(16.3,7)],'F.Cu','+5V',.6,True)
    p.track(b,[(12.065,12),(12.065,10),(16.3,10)],'F.Cu','+5V',.6,True)
    return b

def make_pod():
    # Reuse verified module-header pin numbers and button connections, rebuilding
    # the carrier around larger ribbons rather than mislabelling the LED-free pod.
    seed=p.load_board(ROOT/'output_v4/seeded/pod.kicad_pcb')
    b=pcb.BOARD()
    for old in seed.GetFootprints():
        if old.GetReference() not in ['J_L','J_R','SW1','SW2','H1','H2','H3','H4']:continue
        if old.GetReference().startswith('SW'):
            part(b,old.GetFPIDAsString(),old.GetReference(),p.xy(old.GetPosition()),
                 {q.GetNumber():q.GetNetname() for q in old.Pads()},old.GetValue(),old.GetOrientationDegrees(),old.IsFlipped())
            continue
        f=clone(old);b.Add(f)
        for q in f.Pads():q.SetNet(p.net(b,q.GetNetname()) if q.GetNetname() else None)
    fps={f.GetReference():f for f in b.GetFootprints()}
    # Spare lines no longer needed. RGB gets the two previously reserved GPIOs.
    for h in ['L','R']:p.pad_of(fps['J_'+h],1).SetNet(None)
    for n,(h,pin,_) in pod_pins.group_pins(PINS,'rgb').items():p.pad_of(fps[h],pin).SetNet(p.net(b,n))
    # Place each connector so its pad row lands at x=65.09 / 134.91.
    for h,x,a in [('L',65.09-FFC_PAD_Y,90),('R',134.91+FFC_PAD_Y,-90)]:
        f=part(b,FFC,'J'+('1' if h=='L' else '2'),(x,100),ribbon_nets(h),FFC_PART,a,False)
        points=[p.xy(p.pad_of(f,i).GetPosition()) for i in [21,22,23]]
        p.track(b,points,'F.Cu','+5V',.6,True)
        xx=62 if h=='L' else 138
        p.track(b,[(94,54),(72 if h=='L' else 128,54),(xx,64),(xx,points[-1][1]),points[-1]],'F.Cu','+5V',.8,True)
    # LED power comes from the module's USB 5V header pin (pod.json rgb group).
    # The module's own power path sits upstream of that pin, so nothing backfeeds.
    h,pin,_=pod_pins.group_pins(PINS,'rgb')['+5V']
    fivev=p.xy(p.pad_of(fps[h],pin).GetPosition())
    p.track(b,[fivev,(fivev[0],54),(94,54)],'F.Cu','+5V',.8,True)
    unets={'1':'GND','2':'RGB_L_3V3','3':'RGB_L_DRV','4':'GND','5':'RGB_R_3V3','6':'RGB_R_DRV','7':'GND',
           '8':'','9':'GND','10':'+5V','11':'','12':'GND','13':'+5V','14':'+5V'}
    part(b,'Package_SO:SOIC-14_3.9x8.7mm_P1.27mm','U1',(104,58),unets,'SN74AHCT125D')
    for i,(h,x) in enumerate([('L',86),('R',119)],1):
        part(b,'Resistor_SMD:R_0805_2012Metric','R'+str(i),(x,57),{'1':'RGB_'+h+'_DRV','2':'RGB_'+h},'330R')
        part(b,'Resistor_SMD:R_0805_2012Metric','R'+str(i+2),(x,61),{'1':'RGB_'+h+'_3V3','2':'GND'},'100k')
    part(b,'Capacitor_SMD:C_0805_2012Metric','C1',(109,64),{'1':'+5V','2':'GND'},'100nF 16V X7R')
    p.track(b,[(94,54),(98,54),(98,65),(106.5,65),(108.05,65.5)],'F.Cu','+5V',.4,True)
    via(b,(108.05,65.5),'+5V');p.track(b,[(108.05,65.5),(108.05,64),(106.475,61.81)],'B.Cu','+5V',.4,True)
    p.track(b,[(106.475,56.73),(108.5,56.73),(108.5,60.54),(106.475,60.54),(106.475,61.81)],'B.Cu','+5V',.25,True)
    p.track(b,[(86.9125,57),(88.5,57),(88.5,64),(60.5,64),(60.5,110.5),(63.5,110.5)],'B.Cu','RGB_L',.25,True)
    via(b,(63.5,110.5),'RGB_L');p.track(b,[(63.5,110.5),(65.09,110.5)],'F.Cu','RGB_L',.25,True)
    p.outline(b,[(59,48),(141,48),(141,145),(59,145)])
    p.label(b,'ROSEBEAR POD / KEY A',(100,143),1)
    return b

def panel(key,nx,ny):
    from shapely.geometry import box
    from shapely.ops import unary_union
    b=pcb.BOARD();pitch=21;w=nx*19+(nx-1)*2;h=ny*19+(ny-1)*2
    # Five-mm rails and two-mm routing lanes. Each tile remains electrically isolated.
    shapes=[box(-7,-7,w+7,h+7).difference(box(-2,-2,w+2,h+2))]
    for iy in range(ny):
        for ix in range(nx):
            k=iy*nx+ix+1;dx=ix*pitch+9.5;dy=iy*pitch+8.5
            for old in key.GetFootprints():
                f=clone(old);f.SetReference(old.GetReference()+'_'+str(k));b.Add(f);f.Move(p.vec(dx,dy))
                for q in f.Pads():q.SetNet(p.net(b,'K%d_%s'%(k,q.GetNetname())) if q.GetNetname() else None)
            for old in key.GetTracks():
                t=clone(old);b.Add(t);t.Move(p.vec(dx,dy));t.SetNet(p.net(b,'K%d_%s'%(k,old.GetNetname())))
            for old in key.GetDrawings():
                if old.GetLayer()==pcb.Edge_Cuts:continue
                d=clone(old);b.Add(d);d.Move(p.vec(dx,dy))
            x0=ix*pitch;y0=iy*pitch
            shapes.append(box(x0,y0,x0+19,y0+19))
            # Two tabs per vertical tile edge, with drill perforations along each cut line.
            for side in [0,19]:
                for ty in [5,14]:
                    x=x0+side;y=y0+ty
                    shapes.append(box(x-2,y-2,x+2,y+2))
                    for j in range(5):
                        f=pcb.FOOTPRINT(b);f.SetReference('MH_%d_%d_%d_%d'%(k,side,ty,j));b.Add(f)
                        f.SetAttributes(pcb.FP_EXCLUDE_FROM_POS_FILES|pcb.FP_EXCLUDE_FROM_BOM);f.Reference().SetVisible(False);f.Value().SetVisible(False)
                        q=pcb.PAD(f);q.SetAttribute(pcb.PAD_ATTRIB_NPTH);q.SetShape(pcb.PAD_SHAPE_CIRCLE)
                        q.SetSize(p.vec(.5,.5));q.SetDrillSize(p.vec(.5,.5));q.SetLayerSet(pcb.LSET.AllCuMask());q.SetPosition(p.vec(x,y+(j-2)*.8));f.Add(q)
    shape=unary_union(shapes)
    if shape.geom_type!='Polygon':raise RuntimeError('Disconnected panel frame')
    for ring in [shape.exterior]+list(shape.interiors):p.outline(b,list(ring.coords)[:-1])
    for i,(x,y) in enumerate([(-4.5,-4.5),(w+4.5,-4.5),(-4.5,h+4.5)],1):
        part(b,'Fiducial:Fiducial_1mm_Mask2mm','FID'+str(i),(x,y),{},'FIDUCIAL',back=True)
    return b

def export(b,name):
    path=OUT/name/(name+'.kicad_pcb');folder=path.parent;gerber=folder/'gerbers';gerber.mkdir(exist_ok=True)
    for f in gerber.glob('*.drl'):f.unlink()
    commands=[['gerbers','--layers','F.Cu,B.Cu,F.Mask,B.Mask,F.Paste,B.Paste,F.Silkscreen,B.Silkscreen,Edge.Cuts','-o',str(gerber)+'/',str(path)],
              ['drill','--excellon-separate-th','--excellon-oval-format','route','-o',str(gerber)+'/',str(path)],
              ['svg','--mode-single','--page-size-mode','2','--exclude-drawing-sheet','--layers','F.Silkscreen,B.Cu,Edge.Cuts','-o',str(folder/'layout.svg'),str(path)]]
    for args in commands:subprocess.run([str(p.CLI),'pcb','export']+args,check=True,capture_output=True,timeout=60)
    with zipfile.ZipFile(OUT/(name+'-gerbers.zip'),'w',zipfile.ZIP_DEFLATED) as z:
        for f in sorted(gerber.iterdir()):z.write(f,f.name)
    group={};placements=[]
    for f in b.GetFootprints():
        ref=f.GetReference()
        if ref.startswith(('W','MH','H','FID')):continue
        group.setdefault((f.GetValue(),f.GetFPIDAsString()),[]).append(ref)
        x,y=p.xy(f.GetPosition());rot=f.GetOrientationDegrees();side='bottom' if f.IsFlipped() else 'top'
        if ref.startswith('SW') and f.GetValue()=='CPG151101S11':
            # Switch-centre origin is NOT the socket pickup centre. Datasheet body
            # centre estimate is explicit; vendor must confirm in placement preview.
            x-=.635;y-=3.81;side='bottom';rot=0
        placements.append([ref,'%.4fmm'%x,'%.4fmm'%(-y),side,'%.2f'%rot])
    with (folder/'bom.csv').open('w',newline='') as f:
        w=csv.writer(f);w.writerow(['Comment','Designator','Footprint','LCSC Part #'])
        for (val,fp),refs in sorted(group.items()):w.writerow([val,','.join(sorted(refs)),fp,''])
    with (folder/'positions.csv').open('w',newline='') as f:
        w=csv.writer(f);w.writerow(['Designator','Mid X','Mid Y','Layer','Rotation']);w.writerows(sorted(placements))
    rect=b.GetBoardEdgesBoundingBox()
    return {'name':name,'width_mm':round(rect.GetWidth()/1e6-.05,3),'height_mm':round(rect.GetHeight()/1e6-.05,3),'components':len(placements),'metrics':p.metrics(b)}

def audit_quote_set():
    """Check architectural invariants that a geometric DRC cannot establish."""
    report={}
    for name,count in [('key_single',1),('key_panel_8',8),('key_panel_9',9),('key_panel_10',10)]:
        b=p.load_board(OUT/name/(name+'.kicad_pcb'));fps={f.GetReference():f for f in b.GetFootprints()}
        for k in range(1,count+1):
            suffix='' if count==1 else '_'+str(k)
            prefix='' if count==1 else 'K'+str(k)+'_'
            expected={'SW1':{'1':'COL','2':'SW_DIODE'},'D1':{'1':'ROW','2':'SW_DIODE'},
                      'LED1':{'1':'+5V','2':'DOUT','3':'GND','4':'DIN'},'C1':{'1':'+5V','2':'GND'},
                      'W1':{'1':'ROW'},'W2':{'1':'COL'},'W3':{'1':'DIN'},'W4':{'1':'DOUT'},
                      'W5':{'1':'+5V'},'W6':{'1':'GND'},'W7':{'1':'+5V'},'W8':{'1':'GND'}}
            for ref,nets in expected.items():
                for num,net in nets.items():assert p.pad_of(fps[ref+suffix],num).GetNetname()==prefix+net,(name,ref,num)
            if count>1:
                assert all(q.GetNetname().startswith(prefix) for ref in expected for q in fps[ref+suffix].Pads() if q.GetNetname()),name
        assert len([f for f in fps if f.startswith('LED')])==count
        with (OUT/name/'positions.csv').open() as f:rows=list(csv.DictReader(f))
        assert len(rows)==4*count and len({r['Designator'] for r in rows})==4*count
        assert all(r['Layer']=='bottom' for r in rows)
        report[name]={'keys':count,'assembly_components':4*count,'independent_tile_nets':True,'pinout_checked':True}
    breakout=p.load_board(OUT/'hand_breakout/hand_breakout.kicad_pcb')
    fps={f.GetReference():f for f in breakout.GetFootprints()}
    for i,n in enumerate(RIBBON,1):
        assert p.pad_of(fps['J1'],i).GetNetname()==n
        assert p.pad_of(fps['W'+str(i)],1).GetNetname()==n
    pod=p.load_board(OUT/'pod_rgb/pod_rgb.kicad_pcb');fps={f.GetReference():f for f in pod.GetFootprints()}
    for h,j in [('L','J1'),('R','J2')]:
        for pin,n in ribbon_nets(h).items():
            if pin!='MP':assert p.pad_of(fps[j],pin).GetNetname()==n,(j,pin,n)
    for n,(h,pin,_) in pod_pins.group_pins(PINS,'rgb').items():assert p.pad_of(fps[h],pin).GetNetname()==n
    assert 'J3' not in fps # LED power comes only from the module's USB 5V pin.
    report['common']={'ribbon_pinout_checked':True,'module_rgb_pins_match_pod_json':True,'led_5v_from_module_usb':True}
    (OUT/'electrical-audit.json').write_text(json.dumps(report,indent=2)+'\n')

if __name__=='__main__':
    selected=sys.argv[1:]
    if selected==['export-only']:
        names=['key_single','key_panel_8','key_panel_9','key_panel_10','hand_breakout','pod_rgb']
        results=[]
        for name in names:
            d=json.loads((OUT/name/'drc-summary.json').read_text())
            assert not d['violations'] and not d['unconnected'],name
            b=p.load_board(OUT/name/(name+'.kicad_pcb'))
            results.append(export(b,name))
        (OUT/'manifest.json').write_text(json.dumps(results,indent=2)+'\n')
        audit_quote_set()
        sys.exit(0)
    results=[]
    if not selected or 'keys' in selected:
        key=route(make_key(),'key_single');validate(key,'key_single');results.append(export(key,'key_single'))
        for nx,ny in [(4,2),(3,3),(5,2)]:
            name='key_panel_'+str(nx*ny);b=panel(key,nx,ny);validate(b,name);results.append(export(b,name))
    for name,fn in [('hand_breakout',make_breakout),('pod_rgb',make_pod)]:
        if selected and name not in selected:continue
        b=route(fn(),name);validate(b,name);results.append(export(b,name))
    manifest=OUT/'manifest.json'
    previous=json.loads(manifest.read_text()) if manifest.exists() else []
    previous=[v for v in previous if v['name'] not in {v['name'] for v in results}]
    manifest.write_text(json.dumps(previous+results,indent=2)+'\n')
