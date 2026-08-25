#!/usr/bin/env python3
"""Evaluate the generated boards in output_v3/.

This is the check half of a fix loop: run it after every pipeline change and
read the scorecard. It checks the things DRC has no rule for -- boards that
overlap each other, connectors that don't face the board their cable goes to,
copper outside its own outline -- and it also runs DRC itself so one command
answers "did I break anything".

Usage:
    python3 v3/tools/evaluate.py            # geometry + DRC
    python3 v3/tools/evaluate.py --no-drc   # geometry only (fast, ~instant)
    python3 v3/tools/evaluate.py --render   # also render all.kicad_pcb to PNG

Exit code 0 when every check passes, 1 otherwise.
"""

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "output_v3")

BOARDS = ["finger_l", "finger_r", "thumb_l", "thumb_r", "pod"]
# Boards joined by a ribbon whose two connectors must face each other
# directly across a gap. (The pod's links leave sideways; their full
# conductor mapping is checked in check_ribbons, on the combined view.)
LINK_PAIRS = [("finger_l", "thumb_l"), ("finger_r", "thumb_r")]
# The FFC links: (connector A, connector B, axis the contacts pair on).
# axis 0 pairs by x (a vertical gap), axis 1 by y (a sideways one).
RIBBONS = [
    ("finger_l-J1", "pod-J1", 1),
    ("finger_r-J1", "pod-J2", 1),
    ("finger_l-J2", "thumb_l-J1", 0),
    ("finger_r-J2", "thumb_r-J1", 0),
]
# How far a contact may sit from its partner across the cable, mm. The
# conductors of a flat ribbon are parallel, so the two rows must line up.
RIBBON_ALIGN_TOL = 0.1
# Minimum clearance between any two board outlines, mm.
MIN_BOARD_GAP = 2.0
# The facing link connectors: contact-row to contact-row distance, mm.
LINK_GAP_RANGE = (2.0, 18.0)
# DRC violations that are deliberate, per board: pod uses hand-grown
# footprints that differ from the library versions.
DRC_ALLOWED = {"pod": {"lib_footprint_mismatch": 2}}


# ---------------------------------------------------------------- geometry


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def seg_seg_dist(p1, p2, p3, p4):
    """Minimum distance between segments p1-p2 and p3-p4."""
    if segs_intersect(p1, p2, p3, p4):
        return 0.0
    return min(
        pt_seg_dist(p1, p3, p4),
        pt_seg_dist(p2, p3, p4),
        pt_seg_dist(p3, p1, p2),
        pt_seg_dist(p4, p1, p2),
    )


def pt_seg_dist(p, a, b):
    ax, ay = b[0] - a[0], b[1] - a[1]
    l2 = ax * ax + ay * ay
    if l2 == 0:
        return dist(p, a)
    t = max(0.0, min(1.0, ((p[0] - a[0]) * ax + (p[1] - a[1]) * ay) / l2))
    return dist(p, (a[0] + t * ax, a[1] + t * ay))


def segs_intersect(p1, p2, p3, p4):
    def orient(a, b, c):
        v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        return 0 if abs(v) < 1e-12 else (1 if v > 0 else -1)

    o1, o2 = orient(p1, p2, p3), orient(p1, p2, p4)
    o3, o4 = orient(p3, p4, p1), orient(p3, p4, p2)
    if o1 != o2 and o3 != o4:
        return True
    return False


def point_in_poly(p, poly):
    """Ray cast; works for non-convex polygons."""
    x, y = p
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xi:
                inside = not inside
    return inside


def polys_overlap(a, b):
    """True when polygon interiors intersect (not mere touching)."""
    for i in range(len(a)):
        for j in range(len(b)):
            if segs_intersect(a[i], a[(i + 1) % len(a)], b[j], b[(j + 1) % len(b)]):
                return True
    return point_in_poly(centroid(a), b) or point_in_poly(centroid(b), a)


def poly_gap(a, b):
    """Minimum boundary distance between two disjoint polygons."""
    best = float("inf")
    for i in range(len(a)):
        for j in range(len(b)):
            best = min(
                best,
                seg_seg_dist(a[i], a[(i + 1) % len(a)], b[j], b[(j + 1) % len(b)]),
            )
    return best


def centroid(poly):
    return (
        sum(p[0] for p in poly) / len(poly),
        sum(p[1] for p in poly) / len(poly),
    )


def poly_area(poly):
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def bbox(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


# ------------------------------------------------------------------ parsing


class Board:
    def __init__(self, name):
        self.name = name
        self.outline = []       # [(x, y)] closed loop
        self.connectors = []    # [{"ref", "ways", "x", "y", "r"}]
        self.tracks = []        # [((x1,y1),(x2,y2))]
        self.vias = []          # [(x, y)]


def parse_board(path, name):
    text = open(path).read()
    b = Board(name)

    segs = [
        ((float(a), float(c)), (float(d), float(e)))
        for a, c, d, e in re.findall(
            r"\(gr_line\s*\(start ([-\d.]+) ([-\d.]+)\)\s*\(end ([-\d.]+) ([-\d.]+)\)",
            text,
        )
    ]
    b.outline = chain_loop(segs)

    for block in re.split(r'\(footprint "', text)[1:]:
        fpname = block.split('"')[0]
        at = re.search(r"\(at ([-\d.]+) ([-\d.]+)(?: ([-\d.]+))?\)", block)
        ref = re.search(r'\(property "Reference" "([^"]+)"', block)
        if not at or not ref:
            continue
        ways = re.search(r"_1x(\d+)-", fpname)
        if "FFC-FPC" in fpname and ways:
            b.connectors.append(
                {
                    "ref": ref.group(1),
                    "ways": int(ways.group(1)),
                    "x": float(at.group(1)),
                    "y": float(at.group(2)),
                    "r": float(at.group(3) or 0),
                }
            )

    for m in re.finditer(
        r"\(segment\s*\(start ([-\d.]+) ([-\d.]+)\)\s*\(end ([-\d.]+) ([-\d.]+)\)",
        text,
    ):
        b.tracks.append(
            (
                (float(m.group(1)), float(m.group(2))),
                (float(m.group(3)), float(m.group(4))),
            )
        )
    for m in re.finditer(r"\(via\s*\(at ([-\d.]+) ([-\d.]+)\)", text):
        b.vias.append((float(m.group(1)), float(m.group(2))))
    return b


def chain_loop(segs):
    """Chain edge-cut segments into one loop (largest if several)."""
    loops, remaining = [], list(segs)
    while remaining:
        s, e = remaining.pop(0)
        loop = [s, e]
        while True:
            for i, (a, z) in enumerate(remaining):
                if dist(a, loop[-1]) < 1e-6:
                    loop.append(z)
                    remaining.pop(i)
                    break
                if dist(z, loop[-1]) < 1e-6:
                    loop.append(a)
                    remaining.pop(i)
                    break
            else:
                break
        if len(loop) > 2 and dist(loop[0], loop[-1]) < 1e-6:
            loop.pop()
        loops.append(loop)
    loops.sort(key=len, reverse=True)
    return loops[0] if loops else []


def conn_normal(c):
    """Unit vector out of the back of a connector (away from the contacts).

    KiCad applies the negation of the stored angle, so local +y maps to
    (sin r, cos r)."""
    a = math.radians(c["r"])
    return (math.sin(a), math.cos(a))


def contact_centre(c):
    n = conn_normal(c)
    return (c["x"] - 0.91 * n[0], c["y"] - 0.91 * n[1])


# ------------------------------------------------------------------- checks


class Card:
    def __init__(self):
        self.lines = []
        self.failed = 0

    def check(self, ok, label, detail=""):
        mark = "PASS" if ok else "FAIL"
        if not ok:
            self.failed += 1
        self.lines.append(f"  [{mark}] {label}" + (f" -- {detail}" if detail else ""))

    def note(self, label):
        self.lines.append(f"  [    ] {label}")


def load_variant(outdir):
    boards = {}
    for name in BOARDS:
        path = os.path.join(outdir, f"{name}.kicad_pcb")
        if os.path.exists(path):
            boards[name] = parse_board(path, name)
    return boards


def check_geometry(card, boards):
    # Every pair of boards keeps its distance. The four key boards share one
    # layout frame; the pod's own file has an arbitrary origin, so its
    # position is only meaningful in the combined file -- see check_panel.
    names = [n for n in boards if boards[n].outline and n != "pod"]
    for i, a in enumerate(names):
        for z in names[i + 1 :]:
            pa, pz = boards[a].outline, boards[z].outline
            if polys_overlap(pa, pz):
                card.check(False, f"outlines {a}/{z}", "OVERLAP")
            else:
                g = poly_gap(pa, pz)
                card.check(
                    g >= MIN_BOARD_GAP, f"outlines {a}/{z}", f"gap {g:.1f}mm"
                )

    # The linked connectors face each other across the gap.
    for fname, tname in LINK_PAIRS:
        if fname not in boards or tname not in boards:
            continue
        f, t = boards[fname], boards[tname]
        if not t.connectors:
            card.check(False, f"link {fname}->{tname}", "thumb has no connector")
            continue
        tc = t.connectors[0]
        # The finger board's thumb link is the connector with the same
        # way-count as the thumb board's one connector.
        fcs = [c for c in f.connectors if c["ways"] == tc["ways"]]
        if not fcs:
            card.check(False, f"link {fname}->{tname}", "no matching finger connector")
            continue
        fc = fcs[0]
        nf, nt = conn_normal(fc), conn_normal(tc)
        anti = nf[0] * nt[0] + nf[1] * nt[1]
        card.check(anti < -0.99, f"link {fname}->{tname} antiparallel", f"dot {anti:.2f}")
        cf, ct = contact_centre(fc), contact_centre(tc)
        d = (ct[0] - cf[0], ct[1] - cf[1])
        gap = math.hypot(*d)
        facing = (-nf[0] * d[0] - nf[1] * d[1]) / gap if gap > 0 else 0
        card.check(facing > 0.98, f"link {fname}->{tname} facing", f"cos {facing:.2f}")
        across = abs(d[0] * nf[1] - d[1] * nf[0])
        card.check(across < 1.0, f"link {fname}->{tname} aligned", f"offset {across:.2f}mm")
        lo, hi = LINK_GAP_RANGE
        card.check(lo <= gap <= hi, f"link {fname}->{tname} gap", f"{gap:.1f}mm")

    # Copper stays on its own board...
    names = names + (["pod"] if "pod" in boards else [])
    for name in names:
        b = boards[name]
        bad = sum(
            1
            for t in b.tracks
            for p in t
            if not point_in_poly(p, b.outline)
        ) + sum(1 for v in b.vias if not point_in_poly(v, b.outline))
        card.check(bad == 0, f"copper inside {name}", f"{bad} points outside" if bad else "")

    # ...and out of everyone else's.
    for fname, tname in LINK_PAIRS:
        if fname not in boards or tname not in boards:
            continue
        for a, z in [(fname, tname), (tname, fname)]:
            bad = sum(
                1
                for t in boards[a].tracks
                for p in t
                if point_in_poly(p, boards[z].outline)
            )
            card.check(bad == 0, f"{a} copper out of {z}", f"{bad} points inside" if bad else "")

    # Sizes, for the record.
    for name in names:
        x1, y1, x2, y2 = bbox(boards[name].outline)
        card.note(
            f"{name}: {x2 - x1:.0f} x {y2 - y1:.0f}mm, "
            f"{poly_area(boards[name].outline) / 100:.0f}cm2"
        )


def panel_contacts(text):
    """Every FFC connector in all.kicad_pcb: ref -> [(pad, x, y, net)].

    The DRC never sees the ribbons -- the combined view joins nets by name and
    no model of the cable exists anywhere -- so a link whose two ends disagree
    is invisible to every other check. This parse feeds the one that catches
    it."""
    out = {}
    for block in re.split(r'\(footprint "', text)[1:]:
        if "FFC-FPC" not in block.split('"')[0]:
            continue
        at = re.search(r"\(at ([-\d.]+) ([-\d.]+)(?: ([-\d.]+))?\)", block)
        ref = re.search(r'\(property "Reference" "([^"]+)"', block)
        if not at or not ref:
            continue
        fx, fy = float(at.group(1)), float(at.group(2))
        a = math.radians(float(at.group(3) or 0))
        c, sn = math.cos(a), math.sin(a)
        pads = []
        for pm in re.finditer(r'\(pad "(\d+)" [^(]*\n\s*\(at ([-\d.]+) ([-\d.]+)', block):
            px, py = float(pm.group(2)), float(pm.group(3))
            rest = block[pm.end():]
            net = re.search(r'\(net "([^"]*)"\)', rest[:400])
            pads.append((int(pm.group(1)), fx + px * c + py * sn,
                         fy - px * sn + py * c, net.group(1) if net else None))
        out[ref.group(1)] = sorted(pads)
    return out


def check_ribbons(card, text):
    """A straight, same-side FFC joins its two connectors by position: the
    conductors cannot cross, so the contact at one end lands on whichever
    contact of the other end shares its place along the row. Every such pair
    must carry one net, and the rows must line up for the cable to enter both."""
    conns = panel_contacts(text)
    for a, b, axis in RIBBONS:
        if a not in conns or b not in conns:
            card.check(False, f"ribbon {a}<->{b}", "connector missing")
            continue
        bad, worst = 0, 0.0
        for pa in conns[a]:
            best = min(conns[b], key=lambda p: abs(p[1 + axis] - pa[1 + axis]))
            off = abs(best[1 + axis] - pa[1 + axis])
            worst = max(worst, off)
            if pa[3] != best[3] or off > RIBBON_ALIGN_TOL:
                bad += 1
        card.check(bad == 0, f"ribbon {a}<->{b}",
                   f"{len(conns[a])} conductors, {bad} miswired, "
                   f"worst offset {worst:.2f}mm")


def check_panel(card, outdir, boards):
    """Checks on all.kicad_pcb, the one frame the pod's position exists in."""
    path = os.path.join(outdir, "all.kicad_pcb")
    if not os.path.exists(path):
        card.check(False, "panel", "all.kicad_pcb missing")
        return
    text = open(path).read()
    segs = [
        ((float(a), float(c)), (float(d), float(e)))
        for a, c, d, e in re.findall(
            r"\(gr_line\s*\(start ([-\d.]+) ([-\d.]+)\)\s*\(end ([-\d.]+) ([-\d.]+)\)",
            text,
        )
    ]
    loops, remaining = [], list(segs)
    while remaining:
        s, e = remaining.pop(0)
        loop = [s, e]
        while True:
            for i, (a, z) in enumerate(remaining):
                if dist(a, loop[-1]) < 1e-6:
                    loop.append(z)
                    remaining.pop(i)
                    break
                if dist(z, loop[-1]) < 1e-6:
                    loop.append(a)
                    remaining.pop(i)
                    break
            else:
                break
        if len(loop) > 2 and dist(loop[0], loop[-1]) < 1e-6:
            loop.pop()
        loops.append(loop)
    check_ribbons(card, text)
    card.check(len(loops) == len(boards), "panel outline count",
               f"{len(loops)} loops for {len(boards)} boards")

    # Match loops to boards by shape (translation moves them, area doesn't).
    named = {}
    for name, b in boards.items():
        want = poly_area(b.outline)
        hit = min(loops, key=lambda lo: abs(poly_area(lo) - want))
        if abs(poly_area(hit) - want) < 1.0:
            named[name] = hit

    keys = [n for n in named if n != "pod"]
    for i, a in enumerate(keys):
        for z in keys[i + 1 :]:
            ok = not polys_overlap(named[a], named[z])
            card.check(ok, f"panel {a}/{z}", "" if ok else "OVERLAP")
    if "pod" in named:
        for a in keys:
            if polys_overlap(named[a], named["pod"]):
                card.check(False, f"panel {a}/pod", "OVERLAP")
            else:
                g = poly_gap(named[a], named["pod"])
                card.check(g >= MIN_BOARD_GAP, f"panel {a}/pod", f"gap {g:.1f}mm")
        # The pod sits BETWEEN the halves, roughly level with the keys.
        px, py = centroid(named["pod"])
        lx = max(p[0] for n in named for p in named[n] if n.endswith("_l"))
        rx = min(p[0] for n in named for p in named[n] if n.endswith("_r"))
        card.check(lx < px < rx, "pod between the halves",
                   f"pod x {px:.0f}, hands end {lx:.0f}/{rx:.0f}")
        if keys:
            y1 = min(p[1] for n in keys for p in named[n])
            y2 = max(p[1] for n in keys for p in named[n])
            card.check(y1 < py < y2, "pod level with the boards",
                       f"pod y {py:.0f}, boards span {y1:.0f}..{y2:.0f}")


def kicad_cli():
    for p in [
        shutil.which("kicad-cli"),
        "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
        "/Applications/KiCad/kicad-cli.app/Contents/MacOS/kicad-cli",
    ]:
        if p and os.path.exists(p):
            return p
    return None


def check_band_fit(card, outdir):
    """The fan band must hug the key field, not float above it.

    The finger boards' escape channels all end on one horizontal exit line and
    the bus rows stack north of it. The line is fitted to the TALLEST column,
    so above that column the deepest row that serves it sits at BUS_GAP plus
    its forced nesting depth -- about 8mm with 25-way links. Anything much
    beyond that means the fit regressed (a fixed exit depth, phantom rows for
    contacts that never ride the band, ...) and the board is carrying empty
    copper-free space above the keys again.

    This check exists because a render at panel zoom hides 10-20mm of vertical
    slack, and DRC has no rule against wasted board. Measured per column, on
    F.Cu only -- back-layer LED runs cross this region legitimately.
    """
    for name in ("finger_l", "finger_r"):
        path = os.path.join(outdir, f"{name}.kicad_pcb")
        if not os.path.isfile(path):
            continue
        text = open(path).read()
        keys = []
        for block in re.split(r'\(footprint "', text)[1:]:
            fpname = block.split('"')[0]
            at = re.search(r"\(at ([-\d.]+) ([-\d.]+)", block)
            if "MX" in fpname.upper() and at:
                keys.append((float(at.group(1)), float(at.group(2))))
        segs = [
            (float(a), float(c), float(d), float(e))
            for a, c, d, e, in re.findall(
                r'\(segment\s+\(start ([-\d.]+) ([-\d.]+)\)\s+'
                r'\(end ([-\d.]+) ([-\d.]+)\)\s+\(width [\d.]+\)\s+'
                r'\(layer "F\.Cu"\)',
                text,
            )
        ]
        cols = []
        for k in sorted(keys):
            if cols and k[0] - cols[-1][-1][0] < 10:
                cols[-1].append(k)
            else:
                cols.append([k])
        gaps = []
        for c in cols:
            xc = sum(k[0] for k in c) / len(c)
            top = min(k[1] for k in c) - 9.5  # keycap top edge
            band = None
            for step in range(39):  # sample across the keycap width
                x = xc - 9.5 + step * 0.5
                for x1, y1, x2, y2 in segs:
                    lo, hi = min(x1, x2), max(x1, x2)
                    if lo <= x <= hi and hi - lo > 0.5:
                        y = y1 + (y2 - y1) * ((x - x1) / (x2 - x1))
                        if y < top - 0.05 and (band is None or y > band):
                            band = y
            gaps.append((top, top - band if band is not None else None))
        # The line is fitted to the TALLEST column (smallest keycap-top y);
        # that is where the fit binds and where a regression shows first.
        tall = min(gaps, key=lambda g: g[0], default=None)
        detail = "/".join(
            "-" if g is None else f"{g:.1f}" for _, g in gaps
        )
        ok = tall is not None and tall[1] is not None and tall[1] <= 6.0
        card.check(
            ok,
            f"band hugs {name}",
            f"gap to keycaps per column {detail}mm "
            + (
                f"(tallest column {tall[1]:.1f}, limit 6)"
                if tall and tall[1] is not None
                else "(no band over the tallest column)"
            ),
        )


def check_drc(card, outdir, variant):
    cli = kicad_cli()
    if not cli:
        card.check(False, "kicad-cli", "not found")
        return
    for name in BOARDS:
        path = os.path.join(outdir, f"{name}.kicad_pcb")
        if not os.path.exists(path):
            continue
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
            report = tf.name
        try:
            subprocess.run(
                [cli, "pcb", "drc", "--format", "json", "--refill-zones",
                 "-o", report, path],
                capture_output=True,
                check=False,
            )
            data = json.load(open(report))
        finally:
            os.unlink(report)
        allowed = DRC_ALLOWED.get(name, {})
        bad = {}
        for v in data.get("violations", []):
            bad[v["type"]] = bad.get(v["type"], 0) + 1
        for typ, n in allowed.items():
            if bad.get(typ, 0) <= n:
                bad.pop(typ, None)
        unconnected = len(data.get("unconnected_items", []))
        ok = not bad and unconnected == 0
        detail = []
        if bad:
            detail.append(", ".join(f"{k} x{v}" for k, v in bad.items()))
        if unconnected:
            detail.append(f"{unconnected} unconnected")
        card.check(ok, f"DRC {name}", "; ".join(detail))


def render(outdir, variant):
    cli = kicad_cli()
    src = os.path.join(outdir, "all.kicad_pcb")
    if not cli or not os.path.exists(src):
        return None
    pdf = os.path.join(outdir, "all.pdf")
    png = os.path.join(outdir, "all.png")
    subprocess.run(
        [cli, "pcb", "export", "pdf", "--mode-single",
         "-l", "F.Cu,B.Cu,Edge.Cuts,F.Silkscreen", "-o", pdf, src],
        capture_output=True,
        check=False,
    )
    if sys.platform == "darwin":
        subprocess.run(
            ["sips", "-s", "format", "png", "-z", "1300", "1850", pdf, "--out", png],
            capture_output=True,
            check=False,
        )
        return png
    return pdf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-drc", action="store_true")
    ap.add_argument("--render", action="store_true")
    args = ap.parse_args()

    card = Card()
    outdir = OUT
    if not os.path.isdir(outdir):
        card.check(False, "output", f"{outdir} missing")
    else:
        boards = load_variant(outdir)
        check_geometry(card, boards)
        check_panel(card, outdir, boards)
        check_band_fit(card, outdir)
        if not args.no_drc:
            check_drc(card, outdir, "")
        if args.render:
            p = render(outdir, "boards")
            if p:
                card.note(f"render: {p}")

    print("\n".join(card.lines))
    print(f"\n{'FAIL' if card.failed else 'PASS'}: {card.failed} check(s) failed")
    return 1 if card.failed else 0


if __name__ == "__main__":
    sys.exit(main())
