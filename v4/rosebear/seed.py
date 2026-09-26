"""Use legacy geometry as a library, not the active routing architecture."""
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path
from .mechanical import well, write_json


def baml_literal(value):
    if isinstance(value, list):
        return "[" + ",".join(baml_literal(v) for v in value) + "]"
    if isinstance(value, dict):
        cls = "WellColumn" if "name" in value else "Well"
        return cls + " {" + ",".join(k + ":" + baml_literal(v) for k, v in value.items()) + "}"
    return json.dumps(float(value) if isinstance(value, (int, float)) else value)


def cache_key(root,chassis,config):
    paths=sorted((root/'v3/baml_src').rglob('*.baml'))+sorted((root/'v3/footprints').rglob('*.kicad_mod'))+[root/'v4/tools/seed.baml',root/'v3/baml.toml',root/'v4/rosebear/mechanical.py',Path(__file__)]
    digest=hashlib.sha256(json.dumps({'chassis':chassis,'config':config},sort_keys=True).encode())
    for p in [p for p in paths if p.is_file()]: digest.update(str(p.relative_to(root)).encode()); digest.update(p.read_bytes())
    return digest.hexdigest()


def verify_cache(root,out,chassis,config):
    path=out/'geometry.sha256'
    if not path.exists() or path.read_text().strip()!=cache_key(root,chassis,config):
        raise ValueError('Stale geometry cache: rebuild without --reuse-geometry')


def replace_once(pattern,replacement,text):
    text,count=re.subn(pattern,replacement,text)
    if count!=1: raise ValueError('Expected exactly one staging override: '+pattern)
    return text


def generate(root, out, chassis, config):
    stage = out / "geometry"
    stage.mkdir(parents=True, exist_ok=True)
    if (stage/"baml_src").exists(): shutil.rmtree(stage/"baml_src")
    shutil.copytree(root / "v3/baml_src", stage / "baml_src")
    shutil.copy2(root / "v3/baml.toml", stage / "baml.toml")
    shutil.copytree(root / "v3/footprints", stage / "footprints", dirs_exist_ok=True)
    shutil.copy2(root / "v4/tools/seed.baml", stage / "baml_src/seed.baml")
    # Only the staging project changes: legacy outputs and golden tests remain intact.
    p = stage / "baml_src/config_dactyl.baml"
    text = replace_once(r"    well_toto\(\)", "    " + baml_literal(well(chassis, config)), p.read_text())
    p.write_text(text)
    p = stage / "baml_src/flex_board.baml"
    text = replace_once(r"function FLEX_TAIL\(\) -> float \{[^}]*\}", "function FLEX_TAIL() -> float { 5.0 }", p.read_text())
    p.write_text(text)
    p = stage / 'baml_src/netlist.baml'
    p.write_text(replace_once(r'function DIODE_REACH\(\) -> float \{[^}]*\}', 'function DIODE_REACH() -> float { 8.2 }', p.read_text()))
    p = stage / 'baml_src/route_matrix.baml'
    p.write_text(replace_once(r'function swd_turn\([^}]*?\n\}', 'function swd_turn(s: Strip, k: PlacedKey, w: Well, p: FlexParams) -> float { -0.85 }', p.read_text()))
    result = subprocess.run(["baml", "run", "--output-format", "json", "seed_export"], cwd=stage, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr + result.stdout)
    data = json.loads(result.stdout)
    write_json(out / "geometry.json", data)
    (out/"geometry.sha256").write_text(cache_key(root,chassis,config)+"\n")
    (out / "pinout.txt").write_text(data["pinout"] + "\n")
    return data, stage / "seed"
