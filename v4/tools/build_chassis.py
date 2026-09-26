#!/usr/bin/env python3
"""Generate the individual-key chassis, without loading KiCad or old PCB geometry."""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'v4'))
sys.path.insert(0, str(ROOT / 'output_v4/tools/python39'))

if __name__ == '__main__':
    from rosebear.job_guard import guard_entry
    guard_entry(ROOT, __file__)
    from rosebear.chassis import build
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT / 'v4/chassis.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'output_v4/chassis')
    parser.add_argument('--foundation-test',action='store_true',help='Test the shared-surface foundation')
    parser.add_argument('--foundation',action='store_true',help='Build the shared-control-mesh cutout study')
    parser.add_argument('--control-mesh',type=Path,help='Replay an exported shared control mesh without refitting its positions')
    parser.add_argument('--foundation-config',type=Path,default=ROOT/'v4/chassis-foundation.json')
    parser.add_argument('--test', action='store_true', help='Run chassis-only mechanical regression checks')
    parser.add_argument('--compare',action='store_true',help='Build current, FFC-back and FFC-below arrangements in one viewer')
    parser.add_argument('--compare-only',action='store_true',help='Assemble the comparison viewer from matching existing exports')
    args = parser.parse_args()
    if args.control_mesh and not args.foundation:parser.error("--control-mesh requires --foundation")
    if args.test or args.foundation_test:
        import unittest
        suite = unittest.defaultTestLoader.discover(str(ROOT/'v4/tests'), pattern='test_chassis_foundation.py' if args.foundation_test else 'test_chassis.py')
        sys.exit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
    config=json.loads(args.config.read_text())
    if args.foundation:
        from rosebear.chassis_foundation import build_foundation
        build_foundation(config,json.loads(args.foundation_config.read_text()),ROOT/'output_v4/chassis-foundation',json.loads(args.control_mesh.read_text()) if args.control_mesh else None)
    elif args.compare or args.compare_only:
        from rosebear.chassis_variants import build_comparison,assemble_comparison
        (assemble_comparison if args.compare_only else build_comparison)(config,args.output)
    else:
        build(config,args.output)
