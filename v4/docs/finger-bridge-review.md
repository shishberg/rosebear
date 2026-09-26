# Finger inter-column bridge review

Status: mechanically unqualified. Electrical DRC and copper bend keepouts do not establish that the 0.6 mm FR4 bridges can take the chassis shape without damage.

## Imposed rotation

Using the exported chassis key frames, every adjacent pair of bottom finger keys differs by approximately 5 degrees around axis `(0, 0.991445, 0.130526)` expressed in the first key's frame. Here X is across columns, Y along a column and Z normal to the key. The dominant rotation is therefore about local Y; the small Z component reflects the bottom row's tilt. Mirroring the hand preserves the magnitude and the physical relationship to the column direction.

The long straight portions of the flat serpentine run along Y. Mechanically, their out-of-plane bending changes orientation about X, whereas rotation about their length involves torsion. The imposed movement therefore calls for a combination of twisting in the legs and bending in the turns and transitions. This is a kinematic inference, not a simulated deformation or stress result. It supports the concern about the design's assumed bending mode, but does not prove all strain will concentrate at the roots: twisting can also distribute along the legs.

## Why the index-to-inner bridge is short

| Bridge | Extra normal step | Requested length | Geometric centerline length |
|---|---:|---:|---:|
| Pinky–ring | 5 mm | 32.93 mm | 32.93 mm |
| Ring–middle | 4.5 mm | 31.24 mm | 31.24 mm |
| Middle–index | 4.5 mm | 31.24 mm | 31.24 mm |
| Index–inner | 0 mm | 3.15 mm | 6.80 mm |

The generator chooses the larger of a step-based length and a tilt-based length. Index and inner have the same normal offset, so their step term is zero and only the tilt term remains. The turns already consume 6.80 mm, more than the requested 3.15 mm, so this bridge has no added straight legs. The others have approximately 24–26 mm of straight legs. These lengths describe the flat centerline; the planar turn radius is not the installed 3D bend radius.

## Missing validation

`v3/baml_src/flex.baml` uses `sqrt(3*t*d/strain)` for a guided cantilever offset and `t*angle/(2*strain)` for pure bending. Its 0.83% strain allowance is a historical back-calculation, not a qualified allowable for this board's laminate and copper. Applying either scalar formula to total serpentine length does not evaluate torsion, curved-beam behavior, root stress, combined end translation and rotation, or chassis interference. Taking the maximum of the two lengths also does not evaluate their combined loading.

The current assembly preview places rigid islands in key frames; it does not solve the deformation of the connecting material. The bridge therefore has no demonstrated installed clearance or strain margin. A passing build must continue to mark manufacturing release false.

Recommendation: do not manufacture the current finger bridges as a validated design. First design the connection against both end frames and the available chassis volume, using the intended laminate and copper construction. Compare a bend-axis-aligned flexible connection with a short handwired column connection; qualify the chosen design with a representative assembly coupon before a whole keyboard. Merely lengthening the present loops is not a demonstrated fix. No finger architecture change is made by this review.

Reproduce the geometry measurements with `python3 v4/tools/audit_finger_bridges.py`; results are written to `output_v4/finger-bridge-audit.json`. This requires a current geometry build and performs no KiCad or router work.
