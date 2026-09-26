#!/usr/bin/env python3
"""Compatibility entry point for the current rigid thumb tile build."""
import os,sys
from pathlib import Path
os.execv(sys.executable,[sys.executable,str(Path(__file__).with_name('build.py')),'--board','thumbs']+sys.argv[1:])
