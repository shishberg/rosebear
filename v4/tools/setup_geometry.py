#!/usr/bin/env python3
"""Install geometry wheels separately from KiCad's bundled Python environment."""
import os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
python=Path(os.environ.get('KICAD_PYTHON','/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3'))
version=subprocess.check_output([str(python),'-c','import sys;print(str(sys.version_info.major)+"."+str(sys.version_info.minor))'],text=True).strip()
if version!='3.9':raise SystemExit('These geometry wheel pins are validated with KiCad Python 3.9; update the dependency setup for '+version)
subprocess.run([sys.executable,'-m','pip','install','--target',str(ROOT/'output_v4/tools/python39'),'--python-version','3.9','--platform','macosx_12_0_arm64','--platform','macosx_11_0_arm64','--implementation','cp','--abi','cp39','--only-binary=:all:',
 'numpy==1.26.4','shapely==2.0.7','trimesh==4.6.13','scipy==1.13.1','rtree==1.4.0','networkx==3.2.1','mapbox-earcut==1.0.3','manifold3d==3.0.1'],check=True)
