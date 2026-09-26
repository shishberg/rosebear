"""KiCad adapter. Native footprints/pads are authoritative; no pad-coordinate parser."""
import json
import math
import os
import subprocess
from pathlib import Path
import pcbnew as pcb

KICAD = Path(os.environ.get("KICAD_ROOT", "/Applications/KiCad/KiCad.app/Contents"))
LIB = KICAD / "SharedSupport/footprints"
CLI = Path(os.environ.get("KICAD_CLI", str(KICAD / "MacOS/kicad-cli")))


def load_board(path):
    # The convenience pcbnew.LoadBoard reinitializes the scripting application;
    # constructing another BOARD can then invalidate its loaded board pointers.
    # The direct I/O API supports independently owned, simultaneous boards.
    return pcb.PCB_IO_MGR.Load(pcb.PCB_IO_MGR.KICAD_SEXP,str(path))


def vec(x, y):
    return pcb.VECTOR2I(round(x * 1e6), round(y * 1e6))


def xy(p):
    return (p.x / 1e6, p.y / 1e6)


def net(board, name):
    n = board.FindNet(name)
    if not n:
        n = pcb.NETINFO_ITEM(board, name)
        board.Add(n)
    return n


def footprint(board, root, libid, ref, pos, nets, angle=0, back=False):
    lib, name = libid.split(":")
    directory = (root / "v3/footprints/rosebear.pretty" if lib == "rosebear" else
                 root / "v4/footprints/rosebear_v4.pretty" if lib == "rosebear_v4" else LIB / (lib + ".pretty"))
    fp = pcb.FootprintLoad(str(directory), name)
    if not fp:
        raise ValueError("Footprint not found: " + libid)
    fp.SetFPIDAsString(libid)
    fp.SetReference(ref)
    board.Add(fp)
    fp.SetPosition(vec(*pos))
    if back:
        fp.Flip(fp.GetPosition(), False)
    fp.Reference().SetLayer(pcb.B_Fab if back else pcb.F_Fab)
    fp.Value().SetLayer(pcb.B_Fab if back else pcb.F_Fab)
    fp.SetOrientationDegrees(angle)
    for pad in fp.Pads():
        if pad.GetNumber() in nets:
            pad.SetNet(net(board, nets[pad.GetNumber()]))
    return fp


def pad_of(fp, number):
    return next(p for p in fp.Pads() if p.GetNumber() == str(number))


def track(board, points, layer, name, width=0.135, locked=False):
    for a, b in zip(points, points[1:]):
        if math.dist(a, b) < 1e-6:
            continue
        t = pcb.PCB_TRACK(board)
        t.SetStart(vec(*a)); t.SetEnd(vec(*b))
        t.SetLayer(pcb.F_Cu if layer == "F.Cu" else pcb.B_Cu)
        t.SetWidth(round(width * 1e6)); t.SetNet(net(board, name)); t.SetLocked(locked)
        board.Add(t)


def outline(board, points):
    for a, b in zip(points, points[1:] + points[:1]):
        e = pcb.PCB_SHAPE(board)
        e.SetShape(pcb.SHAPE_T_SEGMENT); e.SetStart(vec(*a)); e.SetEnd(vec(*b))
        e.SetLayer(pcb.Edge_Cuts); e.SetWidth(50000); board.Add(e)


def wirepad(board, root, ref, name, pos):
    fp = footprint(board, root, "TestPoint:TestPoint_THTPad_D2.0mm_Drill1.0mm", ref, pos, {"1": name})
    fp.SetValue(name)
    return fp


def label(board, text, pos, size=0.8):
    item = pcb.PCB_TEXT(board)
    item.SetText(text); item.SetPosition(vec(*pos)); item.SetLayer(pcb.F_SilkS)
    item.SetTextSize(vec(size, size)); item.SetTextThickness(120000)
    board.Add(item)


def signature(t):
    a, b = sorted([xy(t.GetStart()), xy(t.GetEnd())])
    return (t.GetNetname(), t.GetLayerName(), tuple(round(x, 6) for x in a), tuple(round(x, 6) for x in b))


def baml_signature(t):
    a, b = sorted([(t["start"]["x"], t["start"]["y"]), (t["end"]["x"], t["end"]["y"])])
    return (t["net"], t["layer"], tuple(round(x, 6) for x in a), tuple(round(x, 6) for x in b))


def bend_regions(seed):
    # Full-width hinge bands, plus every inter-column gap. Protect both copper layers.
    regions = []
    ss = sorted(seed["strips"], key=lambda s: s["cx"])
    for cut in seed["cuts"]:
        lo, hi = min(p["y"] for p in cut), max(p["y"] for p in cut)
        cx = sum(p["x"] for p in cut) / len(cut)
        s = min(ss, key=lambda s: abs(s["cx"] - cx))
        regions.append([s["cx"]-s["half_w"]-s["ext_w"], lo,
                        s["cx"]+s["half_w"]+s["ext_e"], hi])
    # The pair of kerfs is one bend assembly. The floating strip between
    # them is not an extra routing island or a place for vias.
    merged=[]
    for x0,x1 in sorted({(q[0],q[2]) for q in regions}):
        bands=sorted([q[:] for q in regions if q[0]==x0 and q[2]==x1],key=lambda q:q[1])
        for q in bands:
            if merged and merged[-1][0]==x0 and merged[-1][2]==x1 and q[1]-merged[-1][3]<=3.01:
                merged[-1][3]=max(merged[-1][3],q[3])
            else:merged.append(q)
    regions=merged
    for a, b in zip(ss, ss[1:]):
        regions.append([a["cx"]+a["half_w"]+a["ext_e"]-0.5, -1000,
                        b["cx"]-b["half_w"]-b["ext_w"]+0.5, 1000])
    return regions


def intersects_box(a, b, box):
    # Liang-Barsky segment clipping, including boundary touch.
    lo, hi = 0.0, 1.0
    for i in range(2):
        d = b[i] - a[i]
        if abs(d) < 1e-12:
            if a[i] < box[i] or a[i] > box[i+2]:
                return False
        else:
            t0, t1 = sorted([(box[i]-a[i])/d, (box[i+2]-a[i])/d])
            lo, hi = max(lo, t0), min(hi, t1)
            if lo > hi:
                return False
    return True


def add_bend_keepout(board, box):
    x0, y0, x1, y1 = box
    z = pcb.ZONE(board); z.SetIsRuleArea(True)
    z.SetLayerSet(pcb.LSET.AllCuMask()); z.SetDoNotAllowVias(True)
    z.SetDoNotAllowTracks(False); z.SetDoNotAllowPads(True)
    # KiCad's whole-footprint check includes remote fab labels; body/courtyard
    # geometry is checked separately, while actual pads remain prohibited here.
    z.SetDoNotAllowFootprints(False); z.SetDoNotAllowZoneFills(True)
    poly = z.Outline(); poly.NewOutline()
    for x, y in [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]:
        poly.Append(round(x*1e6), round(y*1e6))
    board.Add(z)


def finger(root, seedpath, seed, mode):
    b = load_board(str(seedpath / (seed["id"] + ".kicad_pcb")))
    # KiCad's SWIG wrappers must outlive removal from native containers.
    b._removed = list(b.Zones())
    for z in b._removed: b.Remove(z)
    fps = list(b.GetFootprints())
    b._removed.extend(fps)
    for f in fps:
        if f.GetReference() == "J2": b.Remove(f)
    regions = bend_regions(seed)
    obsolete = {baml_signature(t) for t in seed["thumb_fan"]["tracks"]}
    neck_segments = {baml_signature(t) for t in seed["neck"]["tracks"]}
    oldvias = {(v["net"], round(v["at"]["x"],6), round(v["at"]["y"],6)) for v in seed["thumb_fan"]["vias"]}
    tracks = list(b.GetTracks())
    b._removed.extend(tracks)
    for t in tracks:
        via = isinstance(t, pcb.PCB_VIA)
        if via:
            x,y = xy(t.GetPosition()); remove = (t.GetNetname(),round(x,6),round(y,6)) in oldvias
        else:
            remove = signature(t) in obsolete
        protected = not via and (signature(t) in neck_segments or any(
            box[1]>-999 and intersects_box(xy(t.GetStart()), xy(t.GetEnd()), box) and
            abs(t.GetStart().x-t.GetEnd().x)<5 for box in regions))
        if remove or (mode=='fresh' and not protected):
            b.Remove(t)
            t.thisown=False
        else: t.SetLocked(protected)
    for box in regions: add_bend_keepout(b, box)
    # Four wires, independently labelled; no connector body, mounting pegs or ground bus.
    inner = next(s for s in seed["strips"] if s["column"] == "inner")
    y = -inner["key_ys"][0] + 10.2
    hand = seed["id"][-1].upper()
    names = ["COL_"+hand+"_THUMB", "ROW_"+hand+"_TOP", "ROW_"+hand+"_HOME", "ROW_"+hand+"_BOTTOM"]
    for i,name in enumerate(names):
        direction=1 if hand=='L' else -1
        x = inner["cx"] + direction*(i-1.5)*3.2
        wirepad(b, root, "W"+str(i+1), name, (x,y))
        label(b, ["CT","RT","RH","RB"][i], (x,y-1.8))
        if mode=='seeded':
            foot=seed['wire_feet'][i]
            turn=y+2.6-i*0.305
            track(b,[(x,y),(x,turn),(foot['x'],turn),(foot['x'],foot['y'])], 'B.Cu',name)
    # The only ground pads are now the pod connector's contacts and anchors.
    # Its legacy climb used to end in the removed thumb connector's ground pour.
    if mode=='seeded':
        j=next(f for f in fps if f.GetReference()=='J1')
        south=max(p.GetPosition().y for p in j.Pads() if p.GetNetname()=='GND')
        for t in list(b.GetTracks()):
            if not isinstance(t,pcb.PCB_VIA) and t.GetNetname()=='GND' and t.GetStart().x==t.GetEnd().x:
                if t.GetStart().y>south: t.SetStart(pcb.VECTOR2I(t.GetStart().x,south))
                if t.GetEnd().y>south: t.SetEnd(pcb.VECTOR2I(t.GetEnd().x,south))
    return b, regions


def thumb(root, hand=None, which=None):
    b = pcb.BOARD()
    col = "COL" if hand is None else "COL_"+hand.upper()+"_THUMB"
    row = "ROW" if hand is None else "ROW_"+hand.upper()+"_"+{"near":"BOTTOM","home":"HOME","far":"TOP"}[which]
    swd = "SW_DIODE" if hand is None else "SWD_"+hand.upper()+"_THUMB_"+which.upper()
    # Switch origin is the stem centre. The board is rigid and seats in that key's frame.
    sw = footprint(b,root,"rosebear:SW_Hotswap_Kailh_MX_1.00u_PCB","SW1",(0,0),{"1":col,"2":swd})
    d = footprint(b,root,"Diode_SMD:D_SOD-123","D1",(0,8.8),{"1":row,"2":swd},back=True)
    w1 = wirepad(b,root,"W1",row,(-5.5,9.8))
    w2 = wirepad(b,root,"W2",col,(5.5,9.8))
    outline(b,[(-8.9,-8),(8.9,-8),(8.9,11.5),(-8.9,11.5)])
    a=xy(pad_of(sw,2).GetPosition()); z=xy(pad_of(d,2).GetPosition())
    track(b,[a,(-8,a[1]),(-8,7),(z[0],7),z],"B.Cu",swd,0.25)
    a=xy(pad_of(d,1).GetPosition()); z=xy(pad_of(w1,1).GetPosition())
    track(b,[a,(z[0],a[1]),z],"B.Cu",row,0.25)
    a=xy(pad_of(sw,1).GetPosition()); z=xy(pad_of(w2,1).GetPosition())
    track(b,[a,(7.8,a[1]),(7.8,z[1]),z],"B.Cu",col,0.25)
    label(b,"ROW",(-5.5,7.7)); label(b,"COL",(5.5,7.7))
    label(b,"THUMB KEY" if hand is None else hand.upper()+" "+which.upper(),(0,2.9))
    return b


def save(board, path, config, root):
    path.parent.mkdir(parents=True, exist_ok=True)
    board.GetDesignSettings().SetBoardThickness(round(config["pcb_thickness_mm"]*1e6))
    board.SetFileName(str(path))
    pcb.PCB_IO_MGR.Save(pcb.PCB_IO_MGR.KICAD_SEXP,str(path),board)
    rules=config["rules"]
    pro={"meta":{"filename":path.with_suffix('.kicad_pro').name,"version":3},
         "board":{"design_settings":{"rules":{"min_clearance":rules["clearance_mm"],"min_hole_clearance":rules["hole_clearance_mm"],"min_copper_edge_clearance":rules["edge_clearance_mm"],"min_track_width":rules["track_width_mm"],"min_via_diameter":rules["via_diameter_mm"],"min_through_hole_diameter":rules["via_drill_mm"]}}},
         "net_settings":{"meta":{"version":4},"classes":[{"name":"Default","clearance":rules["clearance_mm"],"track_width":rules["track_width_mm"],"via_diameter":rules["via_diameter_mm"],"via_drill":rules["via_drill_mm"]}]}}
    path.with_suffix('.kicad_pro').write_text(json.dumps(pro,indent=2)+"\n")
    (path.parent/'fp-lib-table').write_text('(fp_lib_table (version 7)'+''.join(
        ' (lib (name "'+lib+'")(type "KiCad")(uri "'+str(directory)+'")(options "")(descr "Rosebear footprints"))'
        for lib,directory in [('rosebear',root/'v3/footprints/rosebear.pretty'),('rosebear_v4',root/'v4/footprints/rosebear_v4.pretty')])+')\n')


def drc(path):
    report=path.with_suffix('.drc.json')
    result=subprocess.run([str(CLI),'pcb','drc','--format','json','--refill-zones','--save-board','-o',str(report),str(path)],capture_output=True,text=True,timeout=60)
    if result.returncode or not report.exists():
        raise RuntimeError(result.stderr+result.stdout)
    data=json.loads(report.read_text())
    accepted=[]; violations=[]
    for v in data.get('violations',[]):
        refs=[i['description'] for i in v.get('items',[])]
        if (path.stem=='pod' and v['type']=='lib_footprint_mismatch' and v['severity']=='warning'
            and refs in (['Footprint SW1'],['Footprint SW2'])
            and "'SW_SPST_SKQG_WithoutStem'" in v['description'] and len(accepted)<2): accepted.append(v)
        else: violations.append(v)
    return {'violations':violations,'accepted_legacy_warnings':accepted,'unconnected':data.get('unconnected_items',[])}


def metrics(board):
    ts=list(board.GetTracks())
    return {'vias':sum(isinstance(t,pcb.PCB_VIA) for t in ts),
            'length_mm':round(sum(math.dist(xy(t.GetStart()),xy(t.GetEnd())) for t in ts if not isinstance(t,pcb.PCB_VIA)),3),
            'segments':sum(not isinstance(t,pcb.PCB_VIA) for t in ts)}
