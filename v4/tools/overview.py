#!/usr/bin/env python3
"""Isolate KiCad native ownership for the combined-board review stage."""
import sys,json,faulthandler
from pathlib import Path
faulthandler.enable();ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'v4'))
import wx,pcbnew as pcb
from rosebear import overview
from rosebear.pcb import load_board
wx.Log.SetLogLevel(wx.LOG_Error);app=wx.App(False)
out=Path(sys.argv[1]);names=sys.argv[2:];config=json.loads((ROOT/'v4/config.json').read_text())
boards={name:load_board(str(out/(name+'.kicad_pcb'))) for name in names}
overview.build(boards,out/'all.kicad_pcb',config,ROOT)
check=load_board(str(out/'all.kicad_pcb'))
assert len(list(check.GetFootprints()))==sum(len(list(b.GetFootprints())) for b in boards.values())
print('Verified overview groups:',len(list(check.Groups())),flush=True)
