"""Extract the placement functions actually used by the chassis generator.

The exporter executes only selected, reviewed geometry functions, with numeric
transforms in place of CAD solids. It does not import/run the generator or need
CadQuery. Store the exported inputs and source hashes for offline rebuilds.
"""
import ast
import hashlib
import json
import math
from pathlib import Path

COLUMNS = ["inner", "index", "middle", "ring", "pinky"]
ROWS = ["top", "home", "bottom"]
THUMBS = {"near": "minidox_thumb_tr_place", "home": "minidox_thumb_tl_place", "far": "minidox_thumb_ml_place"}


def add(a, b):
    return [x + y for x, y in zip(a, b)]


def rotate(p, angles):
    x, y, z = p
    a, b, c = [math.radians(v) for v in angles]
    y, z = y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a)
    x, z = x * math.cos(b) + z * math.sin(b), -x * math.sin(b) + z * math.cos(b)
    x, y = x * math.cos(c) - y * math.sin(c), x * math.sin(c) + y * math.cos(c)
    return [x, y, z]


def export(source):
    source = Path(source)
    code = (source / "src/dactyl_manuform.py").read_text()
    config_bytes = (source / "src/run_config.json").read_bytes()
    cfg = json.loads(config_bytes)
    if (cfg["ncols"], cfg["nrows"], cfg["thumb_style"], cfg["column_style"]) != (5, 3, "MINIDOX", "standard"):
        raise ValueError("This adapter supports the inspected 5x3 standard MINIDOX chassis only")
    if cfg["reduced_inner_cols"] or cfg["reduced_outer_cols"]:
        raise ValueError("Reduced columns need a separate topology adapter")
    prefix = "undercut" if "UNDERCUT" in cfg["plate_style"] or "NOTCH" in cfg["plate_style"] else "nub" if "NUB" in cfg["plate_style"] else "hole"
    mw = cfg[prefix + "_keyswitch_width"] + 2 * cfg["plate_rim"]
    mh = cfg[prefix + "_keyswitch_height"] + 2 * cfg["plate_rim"]
    cap = cfg["plate_thickness"] + cfg["sa_profile_key_height"]
    env = dict(cfg, mount_width=mw, mount_height=mh,
               centerrow=cfg["nrows"] - cfg["centerrow_offset"], lastrow=cfg["nrows"] - 1,
               row_radius=(mh + cfg["extra_height"]) / 2 / math.sin(cfg["alpha"] / 2) + cap,
               column_radius=(mw + cfg["extra_width"]) / 2 / math.sin(cfg["beta"] / 2) + cap,
               debugprint=lambda *args: None, translate=add, add_translate=add, rotate=rotate,
               rotate_around_x=lambda p, a: rotate(p, [math.degrees(a), 0, 0]),
               rotate_around_y=lambda p, a: rotate(p, [0, math.degrees(a), 0]))
    names = {"apply_key_geometry", "key_position", "column_offset", "thumborigin", *THUMBS.values()}
    funcs = [n for n in ast.parse(code).body if isinstance(n, ast.FunctionDef) and n.name in names]
    if {n.name for n in funcs} != names:
        raise ValueError("Chassis placement API changed")
    # Keep the exact upstream transform order. No CAD bootstrap or file writes.
    exec(compile(ast.Module(body=funcs, type_ignores=[]), "chassis-placement", "exec"), env)
    keys = []
    for ci, col in enumerate(COLUMNS):
        for ri, row in enumerate(ROWS):
            fn = lambda p, c=ci, r=ri: env["key_position"](p, c, r)
            keys.append(pose("matrix_" + col + "_" + row, col, row, fn))
    for name, func in THUMBS.items():
        angle_key = {"near": "tr", "home": "tl", "far": "ml"}[name]
        angle = cfg["thumb_plate_" + angle_key + "_rotation"]
        # minidox_thumb() rotates the square switch plate -90 degrees first.
        fn = lambda p, f=func, a=angle: env[f](rotate(p, [0, 0, a - 90]))
        keys.append(pose("thumb_" + name, "thumb", {"near": "bottom", "home": "home", "far": "top"}[name], fn))
    return {"schema": 1, "source": "dactyl-keyboard/src/run_config.json",
            "source_sha256": hashlib.sha256(config_bytes).hexdigest(),
            "generator_sha256": hashlib.sha256(code.encode()).hexdigest(),
            "placement_source": "\n\n".join(ast.get_source_segment(code, n) for n in funcs),
            "config": cfg, "keys": keys,
            "mount_width": mw, "mount_height": mh, "cap_top_height": cap,
            "row_radius": env["row_radius"], "column_radius": env["column_radius"]}


def pose(name, column, row, fn):
    origin = list(fn([0, 0, 0]))
    axes = [[v - o for v, o in zip(fn(unit), origin)] for unit in ([1, 0, 0], [0, 1, 0], [0, 0, 1])]
    return {"id": name, "column": column, "row": row, "origin": origin, "axes": axes}


def transform(key, local, hand="r"):
    p = [key["origin"][i] + sum(key["axes"][j][i] * local[j] for j in range(3)) for i in range(3)]
    if hand == "l":
        p[0] = -p[0]
    return p


def well(chassis, config):
    cfg = chassis["config"]
    z = cfg["plate_thickness"] - config["plate_top_to_pcb_mm"]
    cols = []
    for ci, name in reversed(list(enumerate(COLUMNS))):
        x, along, normal = cfg["column_offsets"][ci]
        if x != 0:
            raise ValueError("Nonzero column x offsets need a development adapter")
        cols.append({"name": name, "along": along, "normal": normal})
    return {"alpha": math.degrees(cfg["alpha"]), "beta": math.degrees(cfg["beta"]),
            "cap_pitch_row": chassis["mount_height"] + cfg["extra_height"],
            "cap_pitch_col": chassis["mount_width"] + cfg["extra_width"],
            "pcb_depth": chassis["cap_top_height"] - z, "columns": cols}


def write_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
