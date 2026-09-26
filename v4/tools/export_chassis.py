#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rosebear.mechanical import export, write_json

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("source", type=Path)
    p.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "mechanical/chassis.json")
    args = p.parse_args()
    write_json(args.output, export(args.source))
    print(args.output)
