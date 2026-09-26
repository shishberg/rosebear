# Rosebear chassis editor

The active right-hand chassis editing loop runs entirely in **TypeScript + Three.js
+ Manifold WebAssembly**. No Python server or export/rebuild handoff is required.
KiCad/PCB generation stays in the existing offline v4 pipeline.

The trackball and `adapter` are placeholders. The pointing device is open (a Cirque TM040040 trackpad is likely), and the provisional 30 × 16 mm adapter with a 26 mm, 4 mm tall connector is smaller than the designed 36 × 31 mm breakout and its 29–32 mm connector with latch clearance. See [design status](../docs/design-status.md).

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

## Use

- Drag one of the 38 gold points **parallel to the current view**, preserving its
  view-depth. The control cage and component poses update while dragging.
- Drag empty space to orbit, right-drag to pan, or use the view presets.
- Click a gold point in the viewport for exact XYZ edits. Coordinates are millimetres;
  +Y is away from the user and +Z is up.
- Release a point to rebuild the solid, cutouts and clearance tests automatically.
  The previous completed cut shell stays visible throughout dragging and while
  the worker rebuilds. It is replaced only when a valid result arrives. Stale
  results are labelled; STL/report export is disabled until the solid is current.
- Use Undo/Redo (Cmd/Ctrl-Z and Shift-Z also work), or Reset model. Reset itself
  can be undone. Clicking a point without moving it does not alter history.
- Changes autosave to LocalStorage. **Save project** downloads a durable JSON
  backup containing both cage and component configuration. **Open project**
  validates and restores it. Autosave failure is shown rather than silently ignored.
- The key layout defines world XY and heading. `mounts.ts` projects each key
  vertically onto the uncut subdivided roof; its height and surface normal
  determine the entire switch assembly. Editing the roof therefore moves the
  flat seat, cutout, PCB, components and keycap together. The initial fitted cage
  is model data; no Python fitting runs in the editor.
- Export review STL directly from the current browser-generated solid. This is
  explicitly a review export, not a claim that the model is mechanically qualified.

The primary model is the right hand with inner trackball / FFC underneath.
Other arrangements and independent left-hand fitting remain paused.

## Geometry and clearance

`geometry.ts` implements hardware frames, generated walls, Catmull–Clark
subdivision, inner skin, rim closure and local fold detection. Subdivision
stencils are cached by topology. The initial uncut preview uses three levels;
solid rebuilding uses the project's saved detail (four by default).

`solid.ts` constructs the switch, ball and ribbon punches, checks each opening
with nine probes, validates Manifold status/connectivity, and checks shell
intersections with hardware plus keycaps at rest and over their full travel.
The middle thumb uses its actual **27.525 × 18 × 9 mm**, rotated mounting frame,
**4 mm travel** and **2.5 mm configured clearance**. A collision fails the
clearance result; it is not counted as a passing-fit regression test.

The keycap bottom at full press is configured 2 mm above the switch seating
plane (6 mm at rest with 4 mm travel), based on the user’s conservative estimate.
The initial design still **fails clearance** around the thumb cluster. Surface-
following poses change the results from the earlier fixed-pose model. The editor makes those failures visible so they can be fixed by editing.
The conservative box envelopes are not measured hollow keycap models.

PCB retainers, global self-intersection checks and certified minimum wall
thickness are still outstanding. Passing the implemented clearance tests would
not by itself qualify a print.

`worker.ts` runs solid rebuilding outside the UI thread. Results carry revision
IDs; stale results cannot replace a newer edit. Requests coalesce to the latest
project, and a 30-second watchdog terminates a stuck worker. Manifold objects
are explicitly deleted after each build, including failures. No KiCad or Python
process is launched by this editor.

Opaque rendering writes depth. Transparent shell triangles are sorted in camera
space with depth writes disabled; the control cage is a deliberate x-ray overlay.

## Validation

```sh
npm --prefix v4/editor test               # geometry parity + checker regressions
npm --prefix v4/editor run test:browser   # real Chrome workflow / rendering
npm --prefix v4/editor run test:fit       # mechanical acceptance; currently exits 1
```

The fit command optionally accepts a saved project:

```sh
npm --prefix v4/editor run test:fit -- /path/to/rosebear-chassis-project.json
```

It returns a nonzero exit status whenever the checked clearances/openings fail.
It is separate from tests proving that the implementation correctly detects
known good and bad geometry.

`tests/python-reference.json` is a frozen numerical fixture from the previous
Python implementation. Tests check surface/pose parity, cutout coverage, solid
and the known 1.5u collision, plus a genuinely clear cap placement.
Ray tests through four lip positions on every switch verify the flat top and
1.5 mm underside, including the rotated middle thumb. The new seats deliberately
change the solid volume from the old Python model. Initial desktop Chrome rebuilds measured around 1.5–2 seconds per hand;
these are measured examples, not latency guarantees.

Browser tests cover top and oblique view-plane dragging, live updates, automatic
cutout rebuilding, stale-state export blocking, undo/redo, autosave/reload,
project downloads/imports and invalid-input recovery. They use installed Chrome
on macOS when present. Otherwise install Playwright Chromium, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a compatible browser executable.

### Clearance highlighting

Failures are highlighted directly in the viewport: red is actual at-rest or hardware overlap, orange is intersection with the keycap travel/clearance envelope, and pink marks an incomplete opening’s cutter envelope. Collision overlays show the intersecting material, including through an opaque shell. Click a clearance result to isolate that component, or **Show all failures** to restore all overlays. The highlight checkbox hides them. Editing clears obsolete highlights until the next successful rebuild. Overlays are view-only and are excluded from STL exports.

The **Keycap bottom at full press** field controls the vertical gap independently of lateral margins. Old browser autosaves with the previous 4 mm resting height and 4 mm travel are corrected to 6 mm resting height on load; cage edits are preserved. Imported project files keep their explicit dimensions.

### Switch mounting seats

Each switch has a crisp, planar 16.6 × 16.6 mm mounting footprint, with the
14.15 × 14.15 mm opening cut through it. Its top is local Z=0; the underside is
Z=−1.5 mm. The shell is trimmed to these planes and missing plate material is
filled, giving the switch lip continuous support. The footprint meets the curved
shell at a sharp edge; there is no sloped blend or fillet.

Two 5 mm-wide underside reliefs provide space for the switch’s existing spring
clips; these rotate with the switch (including the sideways middle thumb).
`switch.seat_outer_mm`, `clip_land_thickness_mm`, `clip_width_mm` and
`clip_relief_depth_mm` configure the geometry. Old projects without `seat_outer_mm`
use 16.6 × 16.6 mm. The generated solid is checked for a complete plate ring,
material outside its seating planes, clip-space obstructions and connectivity.
Seat defects are listed and highlighted in pink. Printing tolerances and clip
engagement still need verification with the actual switches.

### Layout comparison

The dropdown above Shape compares four layouts starting from your current model:

- Original thumb / ball placement.
- Thumbs tilted toward you by 15° about the chassis X axis.
- The trackball, FFC adapter, platform and surrounding wall moved 10 mm in +Y.
- Both changes together.

The thumb rotation carries its hardware, seats and thumb controls together; the
sideways middle switch remains sideways. The platform shift also moves the shared
inner-well edge and wall junction, with adjacent transition controls following by
smaller amounts. Finger switch XY positions stay fixed; their height and tilt
follow any surface change. The surrounding wall is
regenerated from the moved boundary controls. These are comparative starting
shapes, not automatically fitted or mechanically qualified designs.

Each option preserves its own edits. Switching is undoable, and the alternatives
travel with project exports and browser autosaves. On the supplied starting model,
the combined variant clears the middle-thumb keycap envelope, but reveals inner
bottom finger and rightmost-thumb PCB clearances that still need work. All four
variants pass the flat-seat checks; the tilted variants also flag a deep opening
probe near the rightmost thumb. User-edited starting shapes can have
different results; the live checks, including disconnected-shell rejection, apply.

### Surface-following mounts and component dragging

Switch XY locations are measured in the chassis world frame. At each location,
the uncut roof supplies height and an interpolated surface normal. The local X
axis retains its configured plan-view heading, including the sideways middle
thumb switch. The flat seating recess is then generated at that pose. Projection
never uses the already-cut solid, avoiding a feedback loop between the seat and
the surface. A key outside the roof produces an explicit error; it does not fall
back to a floating fixed mount.

Click or drag any cyan handle, PCB or keycap directly in the viewport. Both
**Edit control points** and **Drag components** can be enabled together; the nearest
handle wins when they are close. Neither selection uses a dropdown. Individual switches slide in
world XY and reproject onto the roof, so their motion may leave the viewport plane
as they follow the surface. Top view is simplest for adjusting spacing. Shift-drag a thumb key to move the whole thumb cluster and shell. Dragging either
the trackball or FFC moves their complete platform. These groups move in the
viewport plane, including their associated shell controls.

Trackball and FFC are an explicitly posed assembly, not individually projected
switches; this preserves their relative position and the ball's specified tilt.
`geometry.mount_lift_mm` fixes the chassis reference height so moving the assembly
vertically does not automatically shift the entire keyboard. Legacy projects use
the original default lift when this field is absent.

Drag edits preview immediately and rebuild the solid/checks on release. They use
the same undo/redo, autosave, project export and per-variant history as cage edits.
Collision checks currently compare component envelopes with the shell; they do
not certify component-to-component clearance after arbitrary layout changes.

The selected assembly has an x-ray outline: cyan PCB/housing edges and white
keycap edges. These remain visible even with component/keycap layers hidden and
update while dragging over the retained cut shell. Outlines are view-only and
are not part of STL exports. Rebuilding starts after mouse release; no new solid
build is launched while a drag is active.
