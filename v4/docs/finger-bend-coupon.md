# Finger bending revision: prototype gate

> **Paused (2026-09-26).** The first prototype uses bought RGB key tiles for all 36 keys; see [design status](design-status.md). This document describes the paused flex finger board design and is kept as reference.

The current production-sized finger files still contain the legacy column-parallel bridges. They are not mechanically released. The revised construction candidate is a separate eight-conductor transverse serpentine coupon, so its bending mechanism can be checked before changing the entire finger board.

## What changed

`v4/tools/finger_bend_coupon.py` creates a 3.6 mm wide neck with long transverse runs and 3 mm centerline turn radii. Eight 0.135 mm front-copper conductors have 0.305 mm pitch; the end tabs have exposed solder/probe lands. The routed coupon is 0.6 mm FR4 and has no vias. Short return sections remain, so the design still includes torsion; it does not assume every part undergoes pure bending.

`v4/tools/finger_coupon_jig.py` generates a watertight fixture with the right coupon support 5 mm higher and tilted 5 degrees about Y. Its tab spacing is 26 mm across and 12 mm along. This is an explicit bench benchmark, not the exact end placement of any existing bridge. It does not establish chassis fit.

## Numerical screen

`v4/tools/screen_finger_bends.py` now includes axial deformation, bending about both axes and torsion. The existing bridge end translations and rotations come from the actual exported chassis, with the left-hand coordinate transform accounted for. This replaces treating total path length as a sufficient mechanical argument.

The model uses an unqualified isotropic surrogate (E=20 GPa, G=8 GPa), small-displacement beam elements and rectangular-section torsion. It is checked against analytic guided-beam bending and pure twist. It omits root notches, laminate/copper details, damage, large-deformation effects and contact. The long existing bridges develop approximately 13–15 degrees of internal rotation in this linear screen, making quantitative reliance on their results especially inappropriate. No computed strain is an acceptance threshold or material qualification.

The coupon and existing bridges have different widths, lengths and attachment locations. Their numerical results must not be presented as a controlled performance comparison. The screen supports investigating the transverse construction; it does not prove that it can replace a bridge in the full board.

## Files and trial

- `output_v4/finger-bend-coupon/transverse-coupon.kicad_pcb`
- `output_v4/finger-bend-coupon/fabrication/`: Gerbers, drill and preview.
- `output_v4/finger-bend-coupon/five-degree-five-mm-jig.stl`
- `output_v4/finger-bend-screen.json`: assumptions, imposed motions and beam-screen results.

Manufacture a construction coupon in the proposed stackup before a whole finger PCB. Check all eight conductors before, during and after bringing the tabs onto the jig; clamp only the end tabs. Inspect roots and returns for cracks, lifting or permanent damage. Record the actual laminate, copper and finish. This checks an assembly operation, not repeated-flex life.

Before adopting the candidate, place its attachment tabs in a revised column layout, check the complete deformed neck against the case and neighbouring bridges, and validate that geometry using the actual stackup. Finger architecture remains an open prototype gate, not a completed mechanical fix.
