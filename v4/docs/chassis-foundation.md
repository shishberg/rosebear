# Shared-surface chassis foundation

**The active editor is now [TypeScript + Manifold WASM](../editor/README.md).**
This document describes the retained Python reference generator; its statements about browser editing refer to the earlier static viewer.

The FFC adapter here is a placeholder, and the trackball is left from an earlier plan: v4 has no pointing device. The adapter box is smaller than the designed 36 × 33 mm breakout and its 31 mm connector. See [design status](design-status.md).

## Active design

**Inner trackball / FFC underneath** is primary. The other arrangements remain
paused in `output_v4/chassis/`.

The current model has **38 authored shape controls**, reduced from 225. These
are named points around the finger well, thumb row, ball shelf and their joins.
They define one connected roof cage with broad faces over the well and four
additional controls each around the tilted ball platform and steep thumb join.

The roof boundary generates **66 wall vertices** from shoulder width, lower-wall
height and base height. Those vertices are not separately editable or saved as
independent positions. The complete subdivision cage therefore contains 104
vertices; the surface's thousands of display vertices come from subdivision.
This is an actual change in shape representation, not just a hidden dense grid.

## Construction and fit

`chassis_cage.py` places the sparse roof controls relative to projected component
bounds and key frames. It constructs named quad faces across the whole roof.
`chassis_foundation.py` fits their heights globally to mounting samples and
normals, with affine-preserving curvature stencils for fairness. It does not
assemble separate overlapping well, thumb or trackball surfaces.

The roof and generated wall rows share edges in one Catmull–Clark subdivision
mesh. Regular regions have a bicubic B-spline limit; irregular vertices do not
justify a uniform C2 claim. Four subdivision steps tessellate the surface without
adding authored controls. See the [OpenSubdiv surface overview](https://opensubdiv.org/docs/subdivision_surfaces.html).

The sparse fit's maximum mounting-height error is about **1.57 mm** (RMS 0.35 mm),
compared with 1.06 mm for the previous 225-point cage. The 30-point core trial had a 3.11 mm maximum error; four ball controls reduced
it to 2.31 mm, and four thumb-join controls further reduced it to 1.57 mm. These deviations are reported with
the same 1 mm warning threshold; reducing controls has not made mechanical fit
qualified. Exact mounting lands and clearance work remain necessary.

The shell uses a second generated inner cage: roof controls move down and wall
controls inward, smoothly blended by subdivision. Nominal directional thickness
is 2 mm. This is not an exact distance offset or a certified minimum thickness.
A direct normal offset was rejected because it folded near the concave palm edge.

The review shell includes 18 switch openings, a trackball housing window and the
inward ribbon exit beside the underneath adapter. Clips, PCB retainers, trackball
mounts and screw bosses are still pending. Hardware and full-travel keycap
intersections are reported, including remaining thumb-area fit problems. Left
preview is provisional and omits the ball opening; it is not independently fitted.

## Review and regenerate

```sh
make v4-chassis
make v4-chassis-test
node v4/tests/check_foundation_viewer.js output_v4/chassis-foundation/preview.html
```

Open `output_v4/chassis-foundation/preview.html`.

- **Shape controls (x-ray)** shows the 38 authored points and their roof edges.
  Generated wall rows are absent from this editing overlay by design.
- **Exterior opacity** defaults to 1. Opaque shell and hardware write depth.
  At lower opacity, opaque hardware is drawn first, followed by shell triangles
  sorted back-to-front with depth testing on and depth writes off.
- The explicitly enabled control overlay draws through the shell. It is separate
  from material transparency.
- Keycaps, PCBs and other hardware can be toggled to inspect the cutouts.

Triangle-centroid sorting is a conventional transparency approximation, not an
order-independent transparency renderer. Intersecting transparent faces can still
require a more advanced technique. It removes the previous unsorted blending
pass in which even full-opacity surfaces did not write depth.

The browser cannot drag points yet. The rendering tests check draw states and
triangle order in several camera poses; they do not replace an actual browser/GPU
visual check.

## Files and editing contract

- `v4/chassis.json`: component dimensions and mounting geometry.
- `v4/rosebear/chassis_variants.py`: primary trackball and FFC poses.
- `v4/chassis-foundation.json`: sparse topology, roof clearance, shoulder/wall
  settings, fairness, subdivision and warning thresholds.
- `v4/rosebear/chassis_cage.py`: feature layout and generated-wall rules.

Each arrangement exports `control-mesh.json`, `report.json`, `config.json`,
`cut-shell-review.obj`, `uncut-exterior.obj`, viewer data and review images.
The cut OBJ is a review solid; the uncut OBJ preserves the open exterior. Neither
is a qualified manufacturing export.

**Schema 2 control files** contain the 38 XYZ positions, stable named IDs, roof
quads, wall-generation parameters and subdivision level. They do not contain a
second dense editable grid. Moving a boundary point regenerates the adjoining
wall. Old schema 1 full-cage files can still be evaluated and replayed.

Positions are world millimetres after tenting: +Y away from the user, +Z up.
To apply an absolute position override, use e.g.:

```json
{"overrides": {"ffc_below": {"top:thumb_outer_front": [x, y, z]}}}
```

Or edit an exported control JSON and replay it:

```sh
"${KICAD_PYTHON:-/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3}" \
  v4/tools/build_chassis.py --foundation --control-mesh /path/to/control-mesh.json
```

Replay preserves authored positions, derives the walls and recomputes all reports.
A hardware-config fingerprint rejects stale control files. Unknown IDs, including
attempts to override generated wall points, are rejected. Keep edited files outside
the output directory, which is replaced by regeneration.

## Validation and remaining work

Checks cover subdivision weights/affine invariance, control serialization/replay,
shared topology, wall regeneration after boundary edits, target coverage, cutout
coverage/depth, local inner-skin folds, watertightness and solid connectivity.
The fit tests allow the explicitly reported sparse-surface error; they do not
claim submillimetre mounting accuracy.

Global self-intersection and minimum-thickness certification remain open, along
with mounting retention and the reported hardware clearances. A watertight mesh
alone does not establish that it can be assembled or printed successfully.
