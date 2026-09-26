#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path
sys.path[:0]=[str(Path(__file__).resolve().parents[1]),str(Path(__file__).resolve().parents[2]/'output_v4/tools/python39')]
import wx
wx.Log.SetLogLevel(wx.LOG_Error)
app=wx.App(False)
suite=unittest.defaultTestLoader.discover(str(Path(__file__).resolve().parents[1]/'tests'))
sys.exit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
