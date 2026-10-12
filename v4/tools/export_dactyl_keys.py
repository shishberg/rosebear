#!/usr/bin/env python3
"""Export the key plates of a generated Dactyl Manuform (things/DM_right.scad).

The editor ghosts these over the design (src/ghost.ts) to compare against the
board in use. They come from the generated OpenSCAD rather than the
generator's code (as export_chassis.py does), so they are the board as it was
last generated: in ../dactyl-keyboard the thumbs there sit 5 mm further back
than the current code places them.

Each key plate is the generator's single_plate: a cube at least 18 mm across
and plate_thickness deep, lifted half its depth. The first 15 are the finger
keys, column by column (inner to pinky) and row by row (top to bottom); the
last three the MINIDOX thumbs, near (tr), home (tl) and far (ml).
"""
import argparse
import hashlib
import json
import math
import re
from pathlib import Path

COLUMNS = ['inner', 'index', 'middle', 'ring', 'pinky']
ROWS = ['top', 'home', 'bottom']
THUMBS = ['near', 'home', 'far']


def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def eye():
    return [[float(i == j) for j in range(4)] for i in range(4)]


def turn(axis, deg):
    """About one axis, as OpenSCAD's rotate."""
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    m = eye()
    i, j = [(1, 2), (2, 0), (0, 1)][axis]
    m[i][i], m[i][j], m[j][i], m[j][j] = c, -s, s, c
    return m


def nums(s):
    return [float(x) for x in re.findall(r'-?\d+(?:\.\d+)?(?:e-?\d+)?', s)]


def calls(src):
    """Each call as (name, args, '{' or ';'), and (None, None, '}') per close."""
    i, n = 0, len(src)
    while i < n:
        ch = src[i]
        if ch == '}':
            yield None, None, '}'
            i += 1
        elif ch.isalpha() or ch == '_':
            j = i
            while j < n and (src[j].isalnum() or src[j] == '_'):
                j += 1
            k = j
            while k < n and src[k].isspace():
                k += 1
            if k < n and src[k] == '(':
                depth, e = 0, k
                while True:
                    depth += {'(': 1, ')': -1}.get(src[e], 0)
                    if depth == 0:
                        break
                    e += 1
                f = e + 1
                while f < n and src[f].isspace():
                    f += 1
                end = src[f] if f < n else ';'
                yield src[i:j], src[k + 1:e], end
                i = f + 1 if end in '{;' else f
            else:
                i = j
        else:
            i += 1


def transform(name, args):
    t = eye()
    a = nums(args)
    if name == 'translate':
        for i in range(3):
            t[i][3] = a[i]
    elif name == 'rotate' and len(a) == 3:
        t = mul(turn(2, a[2]), mul(turn(1, a[1]), turn(0, a[0])))
    elif name == 'rotate' and len(a) == 1:
        t = turn(2, a[0])
    elif name == 'mirror':
        v = a[:3]
        n = math.hypot(*v)
        for i in range(3):
            for j in range(3):
                t[i][j] -= 2 * v[i] * v[j] / n / n
    elif name == 'multmatrix':
        t = [a[r * 4:r * 4 + 4] for r in range(4)]
    elif name in ('rotate', 'scale'):
        raise ValueError(f'{name}({args}) is not handled')
    return t


def plates(src, depth):
    stack, cur, out = [], eye(), []
    for name, args, end in calls(src):
        if end == '}':
            cur = stack.pop()
            continue
        if name == 'cube':
            size = nums(args)
            if len(size) == 3 and abs(size[2] - depth) < 1e-6 and min(size[:2]) >= 18 - 1e-6:
                origin = [cur[i][3] for i in range(3)]
                if all(math.dist(origin, p['at']) > 0.01 for p in out):
                    out.append({'at': origin, 'm': cur})
        if end == '{':
            stack.append(cur)
            cur = mul(cur, transform(name, args))
    return out


def export(scad, depth):
    text = scad.read_text()
    # (SolidPython appends the generator's settings in a block comment.)
    found = plates(re.sub(r'/\*.*?\*/', '', text, flags=re.S), depth)
    if len(found) != 18:
        raise ValueError(f'Expected 15 finger and 3 thumb plates, found {len(found)}')
    names = [f'matrix_{c}_{r}' for c in COLUMNS for r in ROWS] + [f'thumb_{t}' for t in THUMBS]
    keys = []
    for name, p in zip(names, found):
        m = p['m']
        # Each cube is centred depth/2 up: its frame's origin is the plate's underside.
        axes = [[m[r][c] for r in range(3)] for c in range(3)]
        origin = [m[r][3] - axes[2][r] * depth / 2 for r in range(3)]
        keys.append({'id': name, 'origin': origin, 'axes': axes})
    return {
        'schema': 1,
        'source': 'dactyl-keyboard/things/' + scad.name,
        'source_sha256': hashlib.sha256(text.encode()).hexdigest(),
        'plate_thickness': depth,
        'keys': keys,
    }


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('source', type=Path, help='the dactyl-keyboard checkout')
    p.add_argument('--scad', default='things/DM_right.scad')
    p.add_argument('--plate-thickness', type=float, default=5.1)
    p.add_argument('--output', type=Path,
                   default=Path(__file__).resolve().parents[1] / 'mechanical/dactyl-keys.json')
    a = p.parse_args()
    a.output.write_text(json.dumps(export(a.source / a.scad, a.plate_thickness), indent=2) + '\n')
    print(a.output)
