# Rosebear chassis editor

The right-hand chassis editing loop runs entirely in **TypeScript + Three.js
+ Manifold WebAssembly**. No Python server or export/rebuild handoff is required.
KiCad/PCB generation stays in the existing offline v4 pipeline.

The editor edits the **key layout**; the chassis is generated from it. The
construction is the swept Skeletyl shape chosen from the
[shape prototypes](src/prototype-shapes/) (see [design status](../docs/design-status.md)).

The trackpad pod and the `adapter` are placeholders. The Cirque TM040040 dimensions
are provisional. The provisional 30 × 16 mm adapter with a 26 mm, 4 mm tall
connector is smaller than the designed 36 × 33 mm breakout, and the swept chassis
doesn't place it yet: it sits where the old shell had it, and no ribbon opening is cut.

## Run

From the repository root:

```sh
npm --prefix v4/editor ci  # first install only
make v4-editor
```

Open **http://127.0.0.1:5177**. Keep that origin/port to retain the same browser
storage. Stop the server with Ctrl-C. `npm --prefix v4/editor run build` creates a
static `dist/` site; serve it over HTTP, not `file://`, so workers/WASM can load.
All runtime assets are local; there are no CDN or account dependencies.

## Key layout

All values are in **layout coordinates**: millimetres and degrees before the
whole hand is tented (`geometry.tent_deg`, a rotation about Y) and lifted
(`geometry.mount_lift_mm`). +X is toward the pinky, +Y away from you, +Z up.

**Finger columns** (`geometry.columns`, inner to pinky). Each column has:

| Parameter | Meaning |
|---|---|
| `heights_mm` | Heights of the top, home and bottom keys. Each key tilts along the column to follow the parabola through the three heights. |
| `offset_mm` | `[X offset, stagger, 0]`. Keys sit `column_pitch_mm` apart in X and `row_pitch_mm` apart in Y; the stagger moves the whole column in Y. |
| `roll_deg` | Sideways tilt: the slope across the column. Positive rises toward the pinky. |
| `rotation_deg` | Turns each key about its own centre; `[0,0,a]` splays the column by `a`. |

The default heights and tilts reproduce the previous paraboloid surface, so the
finger keys sit where the Python generator put them.

**Thumb clusters** (`geometry.thumb`, and the optional `geometry.thumb_extra`, the
pair tucked in front of it). The keys fan along an arc:

| Parameter | Meaning |
|---|---|
| `position_mm` | The cluster's centre: the middle of the arc. |
| `rotation_deg` | `[tilt about X, tilt about Y, angle]`. The angle turns the cluster in plan. |
| `arc.radius_mm`, `arc.step_deg` | The arc's radius and the angle between neighbouring keys. Key spacing is about `2 × radius × sin(step / 2)`. |
| `arc.well_deg` | Each key tilts toward the middle of the cluster by this much per key step, rising so it stays on a circle (a well, as in the finger columns). |
| `keys` | Key names in order along the arc, each with an optional `offset_mm` and `rotation_deg` (the middle thumb key is turned 90° for its 1.5u cap). |

`trackpad.position_mm` and `rotation_deg` place the Cirque pod. `chassis` holds
the construction's dimensions: plate thickness and margin, wall thickness, the
swept end's radius, how far the end plates may reach into it (`end_cut_mm`) and the
base plate thickness.

## Use

- Drag a handle **parallel to the current view**. The layout axis nearest the view
  direction is left unchanged, so the Top view moves things in plan and the Front
  and Inner views change heights.
  - **Gold**, one per finger key: up and down sets that key's height; along the
    column sets the column's stagger. Move a column sideways with its X offset field.
  - **Cyan**: a thumb cluster's centre. **Pink**: turns a thumb cluster about its centre.
  - **Purple**: the trackpad pod.
- Clicking a handle shows every parameter of its column, cluster or pod as number
  fields. **All configuration** shows and edits the full JSON.
- Drag empty space to orbit, right-drag to pan, wheel to zoom.
- Parts and keycaps follow while dragging. The previous chassis stays visible
  until the rebuild after release finishes. Stale results are labelled;
  STL/report export is disabled until the chassis is current.
- Undo/Redo (Cmd/Ctrl-Z and Shift-Z also work) and Reset model. Reset can be undone.
- Changes autosave to LocalStorage. **Save project** downloads a JSON file;
  **Open project** validates and restores one. Projects from the earlier
  cage-based editor (version 1) are not accepted.
- **Export review STL** exports the chassis without the bottom plate. It is a
  review export, not a claim that the model is mechanically qualified.

## Construction

`chassis.ts` builds the chassis from the key poses:

- **Tile**: the bought 1U key PCB under each switch (see [the v4 README](../README.md)),
  provisionally 19 × 19 mm. Its **tile pocket** is the space under the plate kept
  clear for the tile, its parts and the switch body.
- **Plate**: the square frame a switch clips into, 3 mm thick. It reaches 0.9 mm
  past the 15.8 mm switch seat on each side, or to the edge of the tile pocket if
  that is further, so the plate always covers the tile.
- **Ladder**: a column's plates joined edge to edge.
- **Swept end**: one quarter round (radius 9 mm) swept across the back and across
  the front of the fingers, then a wall to the base. Along each column's end it
  runs parallel to the plate edge, as close in as it can: the tile pocket and
  switch body must stay inside the round's hollow, and the round may start up to
  `end_cut_mm` inside the plate edge but not inside the switch seat. Where the
  round starts past the plate edge, the plate continues flat out to it, as thick
  as the plate. The curve spans the end keys' plates. Where two columns' lines
  overlap, the outer one is used; across a gap between them the curve changes
  smoothly from one line to the next. Round-bottomed slots part the columns down
  to half the wall height.
- The thumb rows are ladders whose two ends roll over the same way.
- **Walls** stand on the inner and pinky columns' outer sides and on the thumb
  rows' fronts. When the extra thumb pair is close in front, it gets a back wall
  as well. Each key has its own wall segment.
  The segment starts at the plate edge, just outside the key's tile pocket, and
  follows the plate's tilt down to the pocket's depth. It then drops vertically
  to the base. The plate widens to meet it. No wall reaches into a tile pocket. Neighbouring segments join at the plate and at the base, with a U slot
  between them from half height up to just under the plates. There is no slot
  where the edges are offset, as beside the 1.5u thumb key. At each end of a swept
  end, a cap closes the quarter round; where a wall runs beside the cap, the two
  are joined. A cap with no wall beside it closes the round only down to the
  plate's underside, leaving the tile pocket open.
- Ribs 6 mm tall join along the base: both ends of the main thumb row to the
  fingers' front, and, when the rows are close, the ends of the two thumb rows to
  each other.
- Above each plate the chassis is kept clear of the switch housing's rim (the
  seat footprint, up to the keycap's lowest point) and of the keycap's travel.
- The Cirque pod hangs from the far thumb key on a bracket fixed to the plate's
  two nearest corners.
- The bottom plate is the footprint of everything above, 2 mm thick, and is a
  separate print. The editor hides it by default; **Bottom plate** shows it.

## Clearance checks

`solid.ts` adds flat switch seats and clip reliefs, cuts the switch openings, and
checks the result:

- Each switch has a crisp, planar 15.8 × 15.8 mm seat (`switch.seat_outer_mm`,
  0.1 mm clear of a 15.6 mm switch housing rim), 1.5 mm thick, with the
  14.15 mm opening; two 5 mm-wide underside reliefs give the spring clips room.
  Seats are checked for a complete plate ring, material outside their planes and
  clip obstructions.
- Each opening is probed at nine points.
- Tiles, tile components, the trackpad and the FFC adapter must not overlap the chassis.
- Keycaps at rest and over their full travel plus clearance must not touch it.
  The middle thumb uses its **27.525 × 18 × 9 mm** cap, **4 mm travel** and
  **2.5 mm clearance**. The keycap bottom at full press is set 2 mm above the seat.
  Each keycap's room is cut out of the chassis before this check, so it fails
  only when the room is smaller than the keycap's travel; the keycap room check
  below reports chassis that was in the way.
- Without the bottom plate the chassis must be one piece; loose pieces are listed
  and highlighted. The walls must also meet along the base: a section 1.5 mm up
  must be one connected area. Separate footprints are listed and highlighted.
- No part of the chassis may reach into a tile pocket, so every tile can be
  placed and soldered. Any overlap is listed, and the pieces with volume are
  highlighted red.
- Every wall must be solid apart from its U slots, and every slot must go
  through. The check looks straight through each wall segment and each slot,
  taking in only the wall's own thickness: any hole in that view that is not a
  slot is a gap, and a slot with no hole is blind (something fills it or stands
  close behind it). Gaps and blind slots are listed and highlighted pink.
- No chassis may be built where a keycap goes. Each keycap's room (the keycap
  and its clearance from its lowest point up, and the switch housing's rim below
  that) is cut out of the chassis, and whatever it removed is listed and
  highlighted orange.
- The closest distance between resting keycaps of the finger columns, the thumb
  row and the extra thumb row is listed; touching fails.

Failures are highlighted in the viewport: red for at-rest or hardware overlap,
orange for the keycap travel envelope and for chassis cut away by a keycap's room, pink for opening, seat or loose-piece
defects. Click a result to isolate it, or **Show all failures**.

Envelopes are conservative boxes, not measured parts. PCB retainers, minimum wall
thickness and global self-intersections are not checked. Passing does not qualify
a print.

`worker.ts` rebuilds outside the UI thread. Results carry revision IDs, so a stale
result cannot replace a newer edit. A 30-second watchdog stops a stuck worker, and a
fresh worker takes over every eight builds to release geometry-engine memory.
A rebuild takes about 0.8 s on desktop Chrome.

## Validation

```sh
npm --prefix v4/editor test               # layout, chassis and checker tests
npm --prefix v4/editor run test:browser   # real Chrome workflow
npm --prefix v4/editor run test:fit       # mechanical acceptance of the default or a saved project
npm --prefix v4/editor run fingerprint    # geometry fingerprints, for refactors
npm --prefix v4/editor run format         # Prettier
```

A change meant to leave the geometry alone must leave `fingerprint`'s output
unchanged: save it before the change and diff it after. It builds the default
project and five variants (plate margin and wall, thumb position, column roll,
no extra thumb row, tile and seat size).

Construction sizes that are not in the config are named in `SIZES` at the top of
`chassis.ts`; the checks' sizes and limits are in `CHECKS` in `solid.ts`.

`test:fit` optionally takes a saved project file and exits nonzero whenever a
check fails. `tests/python-reference.json` is a frozen fixture from the previous
Python implementation; the tests use its finger key poses.
