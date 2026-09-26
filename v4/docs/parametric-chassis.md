# Parametric chassis — individual key tiles

**Frozen legacy implementation.** Active work has moved to the [shared-surface foundation](chassis-foundation.md), with inner trackball / FFC underneath as primary. The patched-shell revisions below are historical.

This is the current chassis **starting point** for 18 individual RGB hotswap key boards per hand, an external MCU pod, an FFC adapter per half, and a small ICSH044A trackball module beside the right thumbs. It generates actual solid geometry directly from parameters; there is no manually edited CAD master or dependency on the neighbouring Dactyl project.

Style reference: [BastardKB Skeletyl](https://github.com/Bastardkb/Skeletyl): a compact sculpted key well, close perimeter and separate bottom cover. This generator is new code and does not reuse its mesh, CAD geometry or key layout. Revision 02 has a configurable 5 mm rounded plan perimeter, a curved 1.2 mm upper rim, and rounded switch-frame corners. Inter-column decks remain solid. Revision 04 replaces those faceted key-to-key lofts with the continuous analytic surface described below.

## Revision 16: continuous inner-trackball junction and lower thumb bridge (current)

The inner variants use one mounting-plane patch joined directly into the finger well. Its palm edge slopes toward the finger-well corner; the shared side and upper transition have continuous quintic blends, eliminating the valley around the former rectangular island. The redundant outer outline control that produced the small lower-side bump is removed. The module's board pocket remains enclosed, including a 1 mm outer material reserve beyond its clearance.

The unused front-ball palm plane drops from 13 to 6 mm in these variants. A compact, smooth 4 mm relief centred at `[-18,-38]` lowers the remaining crest above the near/rightmost thumb key without lowering the PCB perimeter. The thumb boss moves to anchor `[-82,-50]`, between trackball and outer thumb, clear of the FFC strain-relief landing; its matching base hole follows it.

New `trackball_wall_clearance` diagnostics test the PCB pocket against the filled curved body in 3D. `screw_ribbon_conflict` checks the screw path against the tie-off landing. Regression tests reproduce both old failures. PCB tie ears overlap the seat by 0.1 mm to avoid edge-only joins in curved regions. The local thumb relief uses 0.75 mm sampling. The recorded numerical cavity filter also removes enclosed voids below 0.002 mm³ only when all their dimensions are below 1 mm; larger cavities remain.

## Revision 15: rectangular inner-trackball platform

The two inner-trackball arrangements use a rounded-rectangle surface patch based on the module's actual 22 × 28 mm PCB dimensions, with 2 mm corners and a 4 mm blend. The old elliptical blend extended into the thumb area; the new patch ends at Y = −48 mm. Local 1 mm surface sampling resolves the shorter transition. The perimeter beside the module has a straight section with small corner transitions. The front-trackball placement remains the reference arrangement.

The module pocket now reserves clearance for rear components as well as the PCB, and the inner variants' housing cutter extends 14 mm below the mounting plane through the adjacent sloped skin. Board rails and retention tie slots remain. The small low platform beside the FFC exit is the cable-tie strain-relief landing, distinct from the adapter shelf.

## Revision 14: PCB-relative thumb perimeter in every arrangement

The palm and outer thumb wall now follows the actual PCB edges in all three arrangements. `pcb_edge` controls use each board's dimensions and frame at PCB mid-thickness, including the sideways centre PCB. `surface.thumb_wall_gap_mm` sets the nominal 2 mm inner gap, with another 2 mm for wall material. The generator compensates for tenting and the shoulder height to place the vertical skirt against the underside hardware, rather than offsetting the switch plane. Smooth transitions remain; sampled edge-centre gaps are approximately 1.8–2.2 mm after subtracting wall thickness from the projected outer boundary distance.

The thumb screw anchor moves from `[-84,-67]` to `[-84,-40]` (+27 mm Y), clearing the trimmed outer thumb corner. The corresponding shell boss and base hole move together. The centre thumb still retains its 1.5u keycap and full-travel clearance.

## Revision 13: lower inner trackball and clearance diagnostics

Both inner-trackball variants lower the mounting plane by 14 mm, keeping the −30° Y tilt. The local surface patch shrinks from 30 × 34 mm radii to 24 × 26 mm; the inner perimeter moves inward by up to 6 mm. The right edge joins the finger well without a canopy over the inner-bottom and thumb keycaps. The FFC underneath moves down by 10 mm to keep clearance below the module. The resulting alternative shells are about 40 mm tall, excluding the separate base.

The near/rightmost thumb corner gains clearance, while the perimeter below the middle thumb moves inward by 3 mm. The centre key's 1.5u front-to-back envelope and 2.5 mm travel clearance remain unchanged. FFC shelf material is clipped to the body envelope.

New `key_access` warnings test the vertical approach volume above each cap, detecting overhead shell material even without direct cap contact. This catches the three obstructions in the previous inner-trackball geometry. New `pcb_wall_clearance` warnings check that a PCB pocket leaves an outer material reserve (`tile.outer_wall_reserve_mm`, default 1 mm, beyond the configured PCB clearance), before pocket subtraction can hide a thin-wall problem. These are geometric checks, not ergonomic or print qualification.

## Revision 12: three arrangements in one viewer

The **Arrangement** selector in `preview.html` switches between:

1. Front trackball / inner FFC: ball below the finger columns; FFC on the inner side.
2. Inner trackball / FFC farther back: ball at `[-76, -30, 1]`, with **−30° Y rotation**; FFC at `[-76, 10, -9]`.
3. Inner trackball / FFC underneath: same ball pose; FFC at `[-76, -30, -17]`.

Coordinates are untented millimetres. Each alternative has a separately anchored outline; the old ball area is trimmed away and the inner wall expands around the moved modules. A localized mounting patch follows the relocated ball without tilting the entire palm surface. Adapter brackets meet that surface and remain inside the body. The inner-bottom switch cutout is extended to 14 mm below its seat where the raised shell would otherwise block it. Ball access is checked with the 16 mm fingertip probe and the module's rear component envelope participates in collision checks.

These are comparison prototypes; the lower platform and reduced outline are described in revision 13 above.

The selector defaults to Front trackball / inner FFC, preserves camera/layers, and changes report/config/STL links to match the selection. It is self-contained and works offline. Only the selected arrangement has GPU buffers; switching frees the previous buffers. Individual exports are in `variants/ffc_back/` and `variants/ffc_below/`. The top-level archive contains all three arrangements and the selector.

`make v4-chassis` now rebuilds the comparison. The CLI's `--compare` does the same; `--compare-only` assembles the UI from matching existing exports. A normal CLI build still generates one configuration. Variant definitions are in `v4/rosebear/chassis_variants.py`; `v4/chassis-variants/*.json` are editable snapshots, and each output also includes its exact config.

## Revision 11: clipped key supports and tighter rear edge

Key seats/PCB retainers are now intersected with the filled curved-body envelope, just like the trackball rails. This removes the outer thumb support's protruding corner. Rear controls at the middle, ring and pinky columns move 2 mm toward the user, with a 1 mm shift at the outer rear corner. These remain local hardware-relative offsets.

The geometry report records numerical slivers removed after booleans. In addition to the existing positive-volume speck filter, a negative/zero-volume part below 0.001 mm³ is removed as a numerical cavity sliver. The volume is recorded in the report; larger cavity boundaries remain intact. Boolean simplification now uses 0.001 mm tolerance.

## Revision 10: perimeter anchored to hardware

`surface.outline_controls` replaces the default absolute outline coordinates. Each control has an `anchor` (a key name, `trackball` or `adapter`) and an `offset_mm` in that component's **local frame**. Consequently offsets rotate with their key/cluster/module. Optional `point_mm: [x,y]` controls stay absolute. The older `outline_mm` format is still accepted for existing configurations.

Corner controls follow the outer finger and thumb keys; the middle rear control follows `matrix_middle_top`. Trackball and ribbon-adapter controls follow their module poses. The thumb outline is tightened to follow the corrected top-down rotation, with a shallower front edge toward the near thumb and an inset outer-side transition. The periodic smoothed shape-preserving curve and 7 mm shoulder are retained. Trackball rails are clipped to the filled outer-body envelope, so their ends cannot project through the curved shoulder when those controls move. The well itself remains analytic, independent of key positions; only its boundary follows these anchors.

Resolved untented XY controls are written to `report.json` under each hand's placement data as `outline_controls_resolved_xy_mm`. To add clearance, edit an anchor's local offset; to relocate a cluster, edit its pose and rebuild. The fit warnings still check the resulting geometry—anchors do not guarantee that an arbitrarily changed layout fits, and excessive changes can make the perimeter cross itself.

## Revision 09: corrected rotation and concealed trackball rails

Axes: **X left–right, Y front–back, Z floor–ceiling**. Positive Z is counterclockwise from above. The thumb cluster's mistaken +15° Y change is reverted; its configuration is now `[5, -24, 15]`, restoring its earlier tilt and applying the requested 15° top-down rotation. Its centre switch/PCB remains independently 90° clockwise. The front corner is locally extended 1–2 mm to enclose the rotated outer key's retainer.

The trackball rails now end 2.5 mm below the deck, with shorter rounded ends. They retain the underside board and tie passages without their former raised rectangular lips. Tie slots are subtracted after all unions so the surrounding skin cannot refill them. Regression checks cover the absence of raised rail material and open tie slots.

## Revision 08: closer perimeter

The outer/front thumb controls move inward by approximately 3–4 mm, reducing the unused apron below and to the left of the right thumb keys. The edge above the middle finger column moves in by 1.58 mm (adjacent controls by 0.5 mm). The top middle PCB has about 4.8 mm to the projected outer silhouette; this is not all free space, as it includes the rounded wall/support region. A small local allowance encloses the trackball rail corner. The thumb cluster receives a further +15° rotation about Y (−24° → −9°), around its configured centre. Its 1.5u cap clearance, the overall 10° tent and raised trackball are retained. The centre thumb switch and its complete PCB/socket/diode assembly rotate 90° clockwise on the right (mirrored on the left). Its cap dimensions are now local 27.525 × 18 mm, so the physical long dimension still runs front-to-back; the 2.5 mm clearance rotates with the assembly.

## Revision 07: lower, tighter and clearer

The default tent is **10°**, down from 15°. Automatic lift still preserves the configured underside clearance. The trackball mounting plane is **13 mm** above the untented reference, up from 6 mm, so its height follows the finger/thumb junction rather than the key PCBs. The board remains underneath the raised surface.

The outline uses a periodic **shape-preserving cubic Hermite curve (PCHIP)**, replacing the overshooting periodic cubic spline. Uniform arc-length samples receive a periodic Gaussian smoothing pass with `surface.perimeter_smoothing_mm = 2.5`, softening corners without spline bulges. Back-edge controls approximately follow a constant height of the paraboloid, avoiding the earlier waves. The 7 mm shoulder radius is retained.

The thumb row moves 4 mm toward the user while keeping the shared arc and closer spacing. The centre cap remains **18 × 27.525 mm**, front-to-back. It now has an explicit **2.5 mm clearance margin on all four sides** (23 × 32.525 mm reserved area), checked over the complete 4 mm switch travel against the shell and other hardware. `switch.keycap_clearance_overrides_mm` controls this independently from physical cap dimensions; other caps retain 0.3 mm shell clearance. A dedicated regression test checks the centre-cap margin, not just nominal non-overlap.

## Revision 06: continuous parametric body

The well, shoulder and skirt are now a **single indexed shell mesh**, with an inner surface and an open underside. Cutouts are subtracted from this body and retention features are added inside it. The separate swept rim and wall union have been removed. Earlier revision descriptions below are historical.

The plan boundary is a closed periodic cubic spline through `surface.outline_mm`, with centripetal parameter spacing. It is sampled using `surface.perimeter_samples` (900 by default). The shoulder follows an analytic circular profile along the spline's inset curve: `XY = C(u) + N(u) r sin(v)` and `Z = well_height(XY) - r(1-cos(v))`. It meets the well tangentially and turns into the vertical skirt at 90°. Shared vertex indices join the patches rather than overlapping separate solids. `shell.rim_radius_mm` is now **7 mm**; `surface.shoulder_samples` controls the cross-section resolution (21 by default). The inner shoulder uses the reduced radius to preserve the side wall. This is a sampled parametric model, not a NURBS export.

Thumb centres share a 130 mm circular arc at 10° intervals (about 22.7 mm centre spacing, previously 25 mm). All positions and tangent yaw angles derive from `geometry.thumb.arc`. The array runs from the inner/negative-X `far` key through `home` to `near`. The cluster tilt lowers the innermost key even after the overall 15° tent. Optional per-key local offsets/rotations remain available, but the defaults have none. The centre cap is confirmed **18 × 27.525 × 9 mm**, long dimension front-to-back.

### Fit warnings

Every generation writes structured findings to `report.json`, a readable `warnings.txt`, and the terminal. The viewer shows the warning count and links to the report. Valid meshes with fit warnings are exported for review; warnings are not a print-ready certificate.

- **Missing/partial cutouts:** nine columns at the centre, edges and corners are intersected with the continuous body *before* supports are added. This detects a switch, trackball or ribbon opening missing the body or only partly crossing it.
- **Insufficient cut depth:** exact solid intersections check whether the finite cutter reaches through nearby material within a 24 mm local slab.
- **Overlaps:** nominal hardware versus shell/base, hardware belonging to different assemblies, and the entire swept keycap travel against shell/other hardware.
- **Outside enclosure:** supports and internal component envelopes are checked against the body's projected silhouette.

Cutout coverage is a sampled check; it can miss narrow unsupported regions between probes. Hardware models are provisional bounding envelopes. Internal overlaps within one key or module are intentionally excluded, since its simplified parts can overlap by design. Wire bend radius, assembly insertion paths, tolerances and strength need separate physical checks. A geometrically invalid or disconnected printable solid stops publication rather than replacing working output.

Regression tests include deliberately missed, partial and too-shallow cutouts, plus the thumb arc, clip lands, retainer passages, ball access, and 0°/15°/25° tenting.

## Revision 05: tighter outline and recessed rounding

The perimeter is trimmed around the thumb row, outer fingers and upper inner corner. The FFC adapter pocket still determines the inner-side bulge. The rim is now a **4 mm circular roll-down into the wall**, instead of a raised semicircular bead. Additional contour samples resolve that radius independently of the interior mesh spacing. The bottom cover and screw supports follow the tighter outline.

The centre-thumb envelope is provisionally **18 × 27.525 × 9 mm**, with 1.5u running front-to-back; orientation was subsequently confirmed. The full envelope is shown in `keycaps.png` and checked through switch travel. This remains configurable through `switch.keycap_overrides_mm.thumb_home`.

The trackball pose is now `[5, -54, 6]`: 7 mm toward the user, 6 mm higher and 2 mm outward from revision 04, measured before overall tenting. Its breakout is rotated 90° so its shorter dimension runs front-to-back. The surrounding surface blends to the raised mounting plane. A 16 mm spherical fingertip probe overlapping the ball crown clears the shell and keycaps; actual comfort and the purchased module dimensions still require a physical check.

This generator was written independently, without importing the Dactyl generator. The separate bottom cover was an added design choice, not an inherited dependency.

## Revision 04: surface first

The shell is now generated from an analytic height field. In the finger region:

`z = z0 + (x-x0)^2/(2*Rx) + (y-y0)^2/(2*Ry) + c*(x-x0)*(y-y0)`

Optional X/Y slopes tilt this surface. Smooth quintic blends join it to the flat thumb plane, trackball mounting plane and FFC adapter roof. These blends have continuous first and second derivatives. The left adapter patch stops before the thumb row; the outer-finger side retains its bowl farther toward the palm. These are explicit geometric regions, not fits through switch centres.

Finger XY locations sample this surface. Each switch frame's local Z is the normalized `[-dz/dx, -dz/dy, 1]`; its local X follows the surface's X tangent. The switch aperture, clip relief, PCB supports and full-travel cap clearance use that frame. Small planar seats remain where a real flat switch housing needs to clip in. The thumb row retains its explicitly configured flat plane and fan angles.

The rounded plan boundary is authored separately in `surface.outline_mm`. The rim follows the analytic height along that boundary as a **single continuous sweep**. The former nearest-key height selection, per-key outline construction, hulls between key plates, and per-post wall unions are removed. Moving a key or changing its seating depth does not reshape the well or perimeter. Larger position changes can require editing the independent outline to keep the hardware enclosed; validation catches protrusions rather than automatically distorting the case.

### Surface parameters

- `surface.radii_mm`: X/Y curvature radii (250 and 78 mm initially). Larger means flatter; `null` makes that axis flat.
- `surface.origin_mm`, `tilt_deg`, `cross_coefficient_per_mm`: bowl origin, independent slopes and optional XY cross term.
- `surface.palm_blend_y_mm`: transition from the finger bowl to the palm/thumb region.
- `surface.thumb_blend_x_mm`: thumb-plane to trackball-plane blend.
- `surface.adapter_blend_x_mm`, `adapter_blend_y_mm`: bounded adapter roof blend.
- `surface.outer_palm_shift_mm`, `outer_palm_blend_x_mm`: keep the ring/pinky well intact farther toward the palm.
- `surface.outline_mm`: independent, untented XY boundary control polygon; revision 06 uses it as periodic spline controls.
- `surface.mesh_pitch_mm`: surface sampling resolution. This is a triangulated approximation of the analytic surface, not a NURBS/STEP model. The validated default is 2.5 mm; finer sampling can expose boolean slivers and is not automatically safer. The generator rejects non-watertight results before publishing them.

The old row/column well-angle and reference-height fields are replaced by surface radii. Row/column pitch is now projected XY spacing: 24.5 and 23 mm initially. Column XY stagger samples a different point on the same surface. Optional column Z offsets and rotations, or per-key local overrides, deliberately depart from the surface frame; defaults have no such departures. These exceptions do not alter the surface itself.

`preview.html` has an **Uncut design surface** layer. `design-surface.png` and `r/l-design-surface.glb` show that reference without apertures. Hide the shell/hardware layers to inspect it in the interactive viewer. Generated base/shell files and the existing make commands retain their names.

Tests cover analytic curvature, key positions and normals, surface independence from key depth/stagger, flat and tented generation, the retained thumb layout, and mechanical clearances. The overall minimum lift also accounts for the entire surface underside, not just component bottoms.

## Revision 03 thumb row

All three thumb switch centres are collinear in their shared plane, spaced 25 mm apart. The near/home/far yaw offsets are now -10°/0°/+10°, reversing the earlier fan so their axes spread away from a palm-side thumb pivot. Revision 03 used a **27.525 × 18 × 9 mm** nominal 1.5u keycap envelope along the row; revision 05 turns it front-to-back provisionally. `switch.keycap_overrides_mm.thumb_home` drives the preview, shell clearance and full-travel checks on both hands. The one-unit PCB/socket stays unchanged. `keycaps.png` shows the whole layout with keycaps fitted.

Shell/base STLs use ASCII encoding to retain double-precision coordinates at curved-surface intersections, and are reloaded to verify watertightness.

## Revision 02 placement

The right-hand FFC adapter sits on the inner/left side and is rotated to face the external pod between the halves; the left-hand exit is mirrored inward. Exit height automatically follows the adapter connector when `ribbon.height_above_base_mm` is null. Revision 02 placed the trackball below the finger columns at `[3, -47, 0]`; revision 05 updates that pose as described above, keeping the breakout underneath. The thumb cluster moved +21.5 mm in X (one column pitch) from the initial study. The skirt now encloses the PCB guide/tie ears, checked against the exterior outline.

The trackball opening is a rounded **11.5 × 10.1 mm** aperture around an EVQWJN005-scale housing; the 22 × 28 mm breakout stays below the deck. The size reference is the [Panasonic EVQWJN005 drawing](https://www.alldatasheet.com/html-pdf/1643682/PANASONIC/EVQWJN005/1143/2/EVQWJN005.html). It is a housing-size reference, not a confirmed drawing of the purchased ICSH044A module. Its actual protruding housing, ball height and PCB-to-housing stack still need measurement.

## Open and regenerate

From the Rosebear repository:

```sh
make v4-chassis
make v4-chassis-test
```

Edit **`v4/chassis.json`** and rebuild. Generated files are in **`output_v4/chassis/`**. `config.json` in that output is a snapshot, not the default input. A custom input/output is also supported:

```sh
"/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3" \
  v4/tools/build_chassis.py --config /path/to/variant.json --output /path/to/output
```

The local geometry packages in `output_v4/tools/python39` supply NumPy, Manifold and trimesh. The generator uses the existing bounded, low-priority, single-worker process guard. **It does not import pcbnew, launch KiCad, or run any router.** Each generation is built in a temporary directory and published only after the mesh checks finish. Collision findings are reported, not silently fixed by changing your chosen key positions.

| File | Use |
|---|---|
| `preview.html` | Offline WebGL viewer: orbit, zoom, left/right selection, layer toggles and lowered base |
| `perspective.png`, `top.png`, `underside.png`, `inner-side.png`, `keycaps.png` | Static views of the actual generated right-hand meshes |
| `perspective.svg`, `top.svg`, `underside.svg`, `inner-side.svg`, `keycaps.svg` | Captioned review sheets embedding those depth-tested renders |
| `r-shell.stl`, `l-shell.stl` | Separate hand shells |
| `r-base.stl`, `l-base.stl` | Matching removable bottom covers |
| `switch-pcb-fit-coupon.stl` | One complete switch seat, PCB guides and tie ears |
| `r-assembly.glb`, `l-assembly.glb` | Shell, base and simplified hardware as separate coloured scene objects |
| `r-frames.json`, `l-frames.json` | World transforms of every switch and accessory roof |
| `report.json` | Config hash, mesh checks, component/travel overlaps and actual base screw/exit positions |
| `rosebear-chassis-prototype.zip` | Complete review package |

The viewer needs WebGL but no server, external JavaScript or network connection. Static renders are independently generated with a depth buffer. The viewer's JavaScript has a syntax check; browser interaction was not verified in this environment because browser control was unavailable.

## Coordinate system and parameters

All distances are millimetres; all angles are degrees. In the right hand, **+X goes toward the pinky, +Y away from the palm, +Z up**. A switch's plate-top datum is its local Z=0; the PCB top is normally Z=-5. Euler rotations apply X, then Y, then Z. The right-hand layout is tented around Y, then automatically raised until the lowest component or retention ear clears the base. Positive tenting raises the inner side. The left shell is reflected across X=0; purchased component previews keep proper, unmirrored board frames.

| Config section | Controls |
|---|---|
| `geometry.row_pitch_mm`, `column_pitch_mm` | Projected XY sampling pitch on the design surface |
| `geometry.columns[]` | Independent XYZ column offsets and XYZ rotations |
| `geometry.key_overrides` | Per-finger-key local XYZ offsets and rotations, keyed by e.g. `matrix_index_bottom` |
| `geometry.thumb` | Whole-cluster position/orientation plus independent XYZ offsets and rotations for all three thumb keys; Z rotation controls splay |
| `geometry.tent_deg` | Overall tent angle; includes both fingers and thumbs |
| `switch` | Aperture dimensions, print clearance, clip width/land thickness/undercut, switch body, default/per-key keycap sizes, resting height and full travel |
| `tile` | PCB width/height/thickness, plate-to-PCB distance, each component's XYZ envelope, fit clearance, guide dimensions and retention slots |
| `shell` | Frame dimensions, structural deck and side-wall thickness, shoulder radius, underside clearance, base, screw pilots and feet recesses |
| `wiring` | Width/depth of shallow open underside grooves between seats |
| `adapter` | FFC adapter PCB envelope, component/solder clearance, full position/orientation, shelf fit and retaining tie width |
| `ribbon` | Inner-exit Y, opening width/height, rounded corners, optional exit-height override and inner strain-relief landing depth |
| `trackball` | Left/right enable, XYZ position and orientation, board/housing/ball dimensions, separate housing-sized aperture and corner radius, rear component clearance, carrier fit, optional measured mounting-hole coordinates |

Example: an individual finger key override is `"matrix_index_bottom": {"offset_mm": [0, -1, 0.5], "rotation_deg": [0, 0, 3]}`. Offsets are in that key's local frame. Thumb offsets are in the common thumb-cluster frame. Default thumb rotations only change yaw, so all three share a plane.

The current topology is five columns × three rows plus three thumbs. Key names and `shell.extra_links` define wiring-groove paths; they no longer define the shell surface or its outline. Changing key count requires adapting topology; this first generator does not claim arbitrary layouts. Large parameter changes may create overlaps or invalid geometry. Read the new report and inspect the result after each change.

`shell.fasteners_xy_mm` are desired locations in the untented XY layout. The generator projects them onto an inset perimeter and reports their actual positions. They are not an exact coordinate drilling contract. Key/accessory frames are 4×4 transforms; mirrored left mechanical frames have negative determinant and must not be used to mirror a purchased footprint.

## Switches, boards, wiring and assembly

1. **Switch clips:** the 14 mm nominal aperture gets the configurable fit allowance. North/south undercuts leave nominal **1.5 mm lands** for the switch housing's own spring clips. The surrounding deck is 3 mm thick. These are the snap seats the MX clips engage; the chassis does not add extra switch latches.
2. **PCB location:** four short guides locate each 1U board's corners. Small ledges above the board set its seating depth; the switch pins and hotswap socket provide electrical alignment.
3. **PCB retention:** two rigid slotted ears per seat accept a small cable tie routed under the PCB. This supports the board against unplugging a switch. There are no delicate PCB snap fingers or 36 tiny retaining screws. The tie corridor is adjustable and must be checked against actual pads/components; it is not a clamping surface for the socket or LED. Do not cinch against an SMD part.
4. **Wiring:** shallow underside grooves follow neighbouring seats. The underside remains open while wiring, and the base is removable. These grooves provide paths, not enclosed conduits or a guarantee that every harness bundle fits. Leave service loops at each tile, keep the clip reliefs clear, and use the retention straps as local wire anchors only where accessible.
5. **FFC adapter:** a generic shelf, side guides and strap slots sit in the inner-side cavity. Component and solder envelopes are reserved above it. The adapter is rotated so the ribbon exits left from the right half (and right from the left half), toward the pod. It passes through a rounded side slot; an internal landing is available for a retention loop. The exact cable routing to that landing remains a physical-fit check. Keep a gentle cable bend; the configured landing depth is **reserved space, not a qualified minimum bend radius** for an unspecified FFC. Connector pin count, pitch, contact side and cable length remain an electrical/purchasing decision.
6. **Trackball:** the right side includes a small housing-sized window below the finger columns. The 22×28 mm module sits underneath, in board guide rails with tie retention. No mounting-hole pattern is invented; populate `mount_holes_xy_mm` only after measuring a module. Default dimensions are an envelope study, not a reproduction of the actual ball mechanism. Changing its pose regenerates its carrier and connecting deck.
7. **Base:** four perimeter bosses take M2-size self-tapping screws into nominal 1.7 mm pilots, with 2.3 mm clearance holes in the cover. Screw diameter/pilot/length need a print coupon check; choose a length that does not bottom out. Round underside recesses locate adhesive feet; feet must stand proud of screw heads. The model does not include screws or rubber feet.

## What is measured, what is provisional

The AliExpress 1U RGB PCB drawing has no usable dimensioned datasheet. Its **19×19×1.6 mm board**, socket/LED/diode sizes and positions are provisional. The **30×16 mm FFC adapter** is a placeholder for an off-the-shelf part that has not been selected. The trackball board starts at the discussed **22×28 mm envelope**, but housing dimensions, ball height, rear components, connector and fixings require measurement. All are explicit config fields, with provisional flags.

The small fit coupon uses the same switch-seat and PCB-guide code as the shell. **Print it first**, with a real switch and populated key PCB. Check clip engagement/release, socket seating, actual solder-pad access, board removal, the retaining-tie path and print shrinkage. Adjust the config from that result before a full print. Cable and trackball fit need their own physical checks when the actual parts are available.

## Validation and remaining work

Generation checks positive-volume, single-body, watertight shells and bases. It checks shell/component intersections, component intersections across different keys/accessories, keycap resting clearance and swept full-travel envelopes. These are exact solid intersections of **simplified envelopes**, not a clearance certificate for the purchased hardware. The regression suite checks clip-land thickness/relief, all retaining-slot passages, local offsets, flat thumb normals, flat-well spacing, meshes at 0° and 25° tenting in addition to the default 15° build, inward ribbon direction, underside trackball placement and absence of exterior protrusions.

Still to refine after dimensional/ergonomic review: real hardware measurements; fastener/retention print fits; wall and bridge strength; blend-region ergonomics and surface sampling resolution; slicer orientation/supports; soldering-tool access; actual wire bundles and ribbon bends. No flex PCB is required. This shell is a starting model, not a physically tested or production-ready print.

This standalone branch of the pipeline does **not** overwrite the old `output_v4/chassis-right.scad` or imported `layout-chassis.json`. Those describe earlier board architectures. The new `r/l-frames.json` are the authoritative placement outputs for this study; the older physical handwiring drawing has not yet been reprojected onto them.
