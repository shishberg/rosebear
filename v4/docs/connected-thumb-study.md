# Connected thumb cluster: mechanical assessment

## Recommendation

Keep the finger PCB and thumb cluster separate. Replace the loose thumb tiles with **one connected circuit per thumb cluster**, using three supported key areas and localized bends outboard of the keys. Include the LED supply, ground and data chain in the circuit. The study identifies bend locations; it does not yet supply a connected, routed thumb PCB.

A polyimide flex circuit with stiffened key areas is the construction to investigate first. It gives an integrated connection without asking ordinary 0.6 mm FR4 to bend at an assumed safe radius. Component placement and stiffener openings must accommodate the underside hotswap sockets, diodes and reverse-mount LEDs. Neither fabrication price nor this stackup's suitability has been confirmed. A manufacturer's rigid-flex alternative can be compared if the stiffened-flex assembly proves unsuitable.

The separate tile files in the current build are **superseded prototypes**, retained as electrical/footprint references. They are not the intended final thumb architecture.

## What the geometry establishes

Calculated from `v4/mechanical/chassis.json`, including the PCB seating datum:

| Adjacent keys | Change in plane normal | Full frame rotation, including sideways skew |
|---|---:|---:|
| Near / home | 4.90° | 16.29° |
| Home / far | 9.51° | 17.43° |

The normal angle alone does not describe the placement. However, the sideways skew need not become torsion in a short PCB neck: the key areas can have different rotations in the flat artwork.

The script intersects each adjacent pair of PCB planes and unfolds near/far onto the home plane. Inverse rotation restores all key-area corners with numerical error below 1e-8 mm. This verifies the ideal geometric transformation, not material behavior or assembly tolerances.

Those ideal rotation axes cross parts of the existing near/far tile envelopes. A crease running straight across the gap is unsuitable. A **localized bend farther along the same axis**, outside the key areas, avoids putting the crease through the switch area. It does not require the whole key island to be creased along that infinite line.

Both sides have candidate bend locations. In the home key's flat coordinate system, the negative-x candidates are approximately:

| Connection | Bend center x | Bend center y |
|---|---:|---:|
| Home / near | −12.0 mm | +8.34 mm |
| Home / far | −12.0 mm | −23.66 mm |

These positions pass a conservative local clearance screen against all three unfolded PCB rectangles, using a **3.6 mm bridge-width allowance**, **2 mm illustrative bend radius**, and **0.8 mm transition margin**. The radius is an input for screening, not a qualified manufacturing rule. The outboard arms connecting the key areas to these bend locations still need an outline, routing, finite-radius development, folded clearance checks and assembly-motion checks.

The left cluster can use the corresponding reflected assembly geometry. Land patterns must preserve physical handedness, as in the existing assembly transform code.

## Why ordinary thin FR4 is not established as the answer

Würth's [SEMI.flex rules](https://www.we-online.com/files/pdf1/design-rules-semiflex-cbt-en-v1.pdf) describe specially thinned bending regions, typically about 0.20 mm thick, with process-specific 4–5 mm minimum radii and controlled installation bending. Those rules do not qualify this project's uniform 0.6 mm FR4.

Their [flex design guide](https://www.we-online.com/files/pdf1/design-guide-flex-solutions-cbt-en.pdf) distinguishes polyimide flex with local stiffeners from rigid-flex and semi-flex constructions. The construction and bending requirements need to be specified together. This assessment has not obtained a fabricator's approval or quotation.

## LED and harness contract

Assuming the existing matrix and addressable RGB approach, one terminal thumb cluster needs:

- Three row signals and the shared thumb column.
- LED supply, ground and data-in.
- Data-out only if another device follows the cluster in the LED chain.

That is **seven conductors at the cluster boundary**, or eight with a returning LED data signal. Inside the cluster, the PCB carries LED power, ground and the data chain; there are no individual wire jumpers between keys. LED voltage, current budget, copper widths and the source of LED data must be restored consistently on the finger/pod design as well. The current v4 generated PCBs remain LED-free.

## Trackball correction found during this assessment

The prior trackball offset `[0, -28, 7]` in the home thumb's frame moved it along the thumb row. Its carrier intersected the far key's conservative keycap envelope, despite passing the PCB-only check.

The configuration now uses `[28, 0, 7]`, moving the carrier to the side. A new regression check screens the carrier against all right-side keycaps using 18 × 18 mm bounding boxes from plate top to configured cap height. It rejects the old position and accepts the revised position. This is still a conservative-envelope check, not validation against actual cap meshes or the complete chassis. The support arm was updated to meet the carrier edge facing the anchor plate. Outboard thumb bridges on negative local x are the starting option, opposite the revised trackball placement.

## Reproduce and inspect

```sh
python3 v4/tools/assess_thumbs.py
```

- `output_v4/thumb-study/geometry.json`: key polygons, hinge axes, candidate bend locations and unfold/refold checks.
- `output_v4/thumb-study/unfolded.svg`: dimensionally scaled flat study.

The diagram deliberately shows bend locations without pretending the missing connecting arms form a verified PCB. Before replacing `thumb_*` production outputs, complete the outboard arm geometry, resolve the flex stackup/stiffeners with a fabricator, restore LED routing and check the complete assembly. The assessment supports this direction; it does not yet establish a fabrication-ready connected thumb cluster.
