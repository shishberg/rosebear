"""Flat review layout of the separately manufactured boards."""
import pcbnew as pcb
from .pcb import net, save, vec


def build(boards, path, config, root):
    combined=pcb.BOARD()
    # Keep SWIG proxies alive until serialization has finished.
    copies=[]
    rows=[['finger_l','finger_r'],
          (['thumb_l','thumb_r'] if 'thumb_l' in boards else ['thumb_'+h+'_'+k for h in ['l','r'] for k in ['near','home','far']]),
          ['pod','trackball']]
    y=25
    for row in rows:
        x=20; height=0
        for name in row:
            if name not in boards: continue
            print('Overview placing '+name,flush=True)
            source=boards[name]; box=source.GetBoardEdgesBoundingBox()
            offset=vec(x-box.GetLeft()/1e6,y-box.GetTop()/1e6)
            group=pcb.PCB_GROUP(combined); group.SetName(name); combined.Add(group)
            copies.append(group)
            def remap(item):
                old=item.GetNetname()
                item.SetNet(net(combined,name+'::'+old) if old else combined.FindNet(0))
            items=list(source.GetFootprints())+list(source.GetTracks())+list(source.GetDrawings())+list(source.Zones())
            for original in items:
                raw=original.Duplicate(False) if isinstance(original,pcb.FOOTPRINT) else original.Duplicate()
                item=pcb.Cast_to_FOOTPRINT(raw) if isinstance(original,pcb.FOOTPRINT) else raw
                raw.thisown=False
                item.thisown=False
                item.SetParent(combined)
                if isinstance(item,pcb.FOOTPRINT):
                    item.SetReference(name+'_'+item.GetReference())
                    for pad in item.Pads(): remap(pad)
                elif isinstance(item,(pcb.PCB_TRACK,pcb.ZONE)):
                    remap(item)
                item.Move(offset); combined.Add(item); group.AddItem(item)
                copies.extend([raw,item])
            label=pcb.PCB_TEXT(combined); label.SetText(name)
            label.SetPosition(vec(x+box.GetWidth()/2e6,y-4)); label.SetLayer(pcb.Dwgs_User)
            label.SetTextSize(vec(1.5,1.5)); label.SetTextThickness(200000)
            combined.Add(label); group.AddItem(label); copies.append(label)
            x+=box.GetWidth()/1e6+16
            height=max(height,box.GetHeight()/1e6)
        y+=height+16
    title=pcb.PCB_TEXT(combined)
    title.SetText('ROSEBEAR V4 — BOARD OVERVIEW\nSeparate boards; see wiring.md for harness connections')
    title.SetPosition(vec(110,12)); title.SetLayer(pcb.Dwgs_User)
    title.SetTextSize(vec(1.5,1.5)); title.SetTextThickness(200000)
    combined.Add(title); copies.append(title)
    save(combined,path,config,root)
    return combined
