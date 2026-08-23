"""Generate Kailh MX hotswap-socket footprints.

Copper geometry comes from ergogen's own `mx.js` (vendored in this repo at
node_modules/ergogen/src/footprints/mx.js), which is the community-standard
Kailh CPG151101S11 land pattern.  Everything else -- silkscreen, courtyard,
fab -- is lifted from KiCad's SW_Cherry_MX_*_PCB so the outlines stay real.

The origin moves to the KEY CENTRE (the stem hole), unlike KiCad's footprint
which puts it at pin 1.  Every dimension below is quoted from the key centre in
both sources, so this is the frame the numbers are already written in.
"""
import os, re, sys

KICAD = "/Applications/KiCad/KiCad.app/Contents/SharedSupport/footprints/Button_Switch_Keyboard.pretty"
OUT = "footprints/rosebear.pretty"

# KiCad's footprint has its origin at pin 1, which sits at key centre +(2.54,-5.08).
# Shifting every coordinate by this puts the origin on the key centre.
DX, DY = 2.54, -5.08

SIZES = ["1.00u", "1.25u", "1.50u", "1.75u", "2.00u", "2.25u", "2.75u"]

# --- from ergogen mx.js, hotswap branch -------------------------------------
# Enlarged clearance holes for the switch pins.
PIN_HOLES = [(2.54, -5.08), (-3.81, -2.54)]
PIN_HOLE_D = 3.0
# Socket terminals, on the back.  Each sits outboard of the switch pin it grips:
# pad 1 (the key's signal) beside the pin at (2.54,-5.08), pad 2 (ground)
# beside the pin at (-3.81,-2.54).
SOCKET = [("1", 5.842, -5.08), ("2", -7.085, -2.54)]
SOCKET_W, SOCKET_H = 2.55, 2.5

num = re.compile(r'-?\d+\.?\d*')

def shift_line(line):
    """Translate the (x y[ angle]) of a coordinate group on this line."""
    def one(m):
        head, body = m.group(1), m.group(2)
        vals = body.split()
        if len(vals) < 2:
            return m.group(0)
        try:
            x = float(vals[0]) + DX
            y = float(vals[1]) + DY
        except ValueError:
            return m.group(0)
        rest = " ".join(vals[2:])
        return f"({head} {x:g} {y:g}" + (f" {rest}" if rest else "") + ")"
    return re.sub(r'\((at|start|end|center|mid|xy) ([^()]*?)\)', one, line)

def gen(size):
    src = open(f"{KICAD}/SW_Cherry_MX_{size}_PCB.kicad_mod").read()
    out, skip, depth = [], False, 0
    for line in src.split("\n"):
        stripped = line.strip()
        if skip:
            depth += line.count("(") - line.count(")")
            if depth <= 0:
                skip = False
            continue
        # Drop the two through-hole switch pins; the socket replaces them.
        if stripped.startswith('(pad "1" thru_hole') or stripped.startswith('(pad "2" thru_hole'):
            skip = True
            depth = line.count("(") - line.count(")")
            continue
        if stripped.startswith('(footprint '):
            out.append(f'(footprint "SW_Hotswap_Kailh_MX_{size}_PCB"')
            continue
        if stripped.startswith('(descr '):
            out.append('\t(descr "Cherry MX keyswitch, {} keycap, Kailh CPG151101S11 hotswap socket on the back. Copper from ergogen mx.js; outlines from KiCad SW_Cherry_MX_{}_PCB.")'.format(size, size))
            continue
        out.append(shift_line(line))

    pads = []
    for (x, y) in PIN_HOLES:
        pads.append(f'''\t(pad "" np_thru_hole circle
\t\t(at {x:g} {y:g})
\t\t(size {PIN_HOLE_D:g} {PIN_HOLE_D:g})
\t\t(drill {PIN_HOLE_D:g})
\t\t(layers "*.Cu" "*.Mask")
\t)''')
    for (name, x, y) in SOCKET:
        pads.append(f'''\t(pad "{name}" smd rect
\t\t(at {x:g} {y:g})
\t\t(size {SOCKET_W:g} {SOCKET_H:g})
\t\t(layers "B.Cu" "B.Paste" "B.Mask")
\t)''')

    text = "\n".join(out)
    # Splice the new pads in just before the closing paren of the footprint.
    i = text.rstrip().rfind("\n)")
    text = text[:i] + "\n" + "\n".join(pads) + text[i:]
    open(f"{OUT}/SW_Hotswap_Kailh_MX_{size}_PCB.kicad_mod", "w").write(text)

os.makedirs(OUT, exist_ok=True)
for s in SIZES:
    gen(s)
print("wrote", len(SIZES), "footprints")
