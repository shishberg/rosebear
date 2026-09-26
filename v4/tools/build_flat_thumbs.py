import sys,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'v4'),str(ROOT/'output_v4/tools/python39')]
from rosebear.job_guard import guard_entry
guard_entry(ROOT,__file__)
import wx
wx.Log.SetLogLevel(wx.LOG_Error);app=wx.App(False)
from rosebear import flat_thumb,pcb,finger_artifacts,mechanical
s=flat_thumb.spec(ROOT);config=json.loads((ROOT/'v4/config.json').read_text());config['pcb_thickness_mm']=config['thumb_pcb_thickness_mm']
report={}
for hand in ['r','l']:
 b,shape=flat_thumb.make(ROOT,s,hand);out=ROOT/'output_v4/flat-thumbs';path=out/('thumb_'+hand+'.kicad_pcb');pcb.save(b,path,config,ROOT)
 check=pcb.drc(path);report[hand]={**pcb.metrics(b),'drc':check};print(hand,report[hand],flush=True)
 if check['violations'] or check['unconnected']:continue
 finger_artifacts.export(b,path,out/('fabrication/thumb_'+hand))
 report['prototype_'+hand]=flat_thumb.export_prototype(s,shape,out/'prototype',hand)
mechanical.write_json(ROOT/'output_v4/flat-thumbs/report.json',report)
sys.exit(any(report[h]['drc']['violations'] or report[h]['drc']['unconnected'] for h in ['r','l']))
