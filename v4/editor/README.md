# Rosebear chassis editor

The right-hand chassis editor runs entirely in the browser, in **TypeScript,
Three.js and Manifold WebAssembly**. KiCad/PCB generation stays in the offline
v4 pipeline.

The editor edits the **key layout**; the chassis is generated from it: a
C64-styled case (see [design status](../docs/design-status.md)). The default
case is the tape-deck prototype; the others are under
[Case shapes](#case-shapes).

The wiring, the tile pads, the FFC adapter and the ribbon dimensions are
**provisional**: the pads are read from a photo of the bought
tiles, and the adapter is a generic 24-way FFC breakout on perfboard. Each is
marked `provisional` in the configuration. See [Wiring](#wiring).

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

| Parameter      | Meaning                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `heights_mm`   | Heights of the top, home and bottom keys. Each key tilts along the column to follow the parabola through the three heights.             |
| `offset_mm`    | `[X offset, stagger, 0]`. Keys sit `column_pitch_mm` apart in X and `row_pitch_mm` apart in Y; the stagger moves the whole column in Y. |
| `roll_deg`     | Sideways tilt: the slope across the column. Positive rises toward the pinky.                                                            |
| `rotation_deg` | Turns each key about its own centre; `[0,0,a]` splays the column by `a`.                                                                |

**Thumb clusters** (`geometry.thumb`, and the optional `geometry.thumb_extra`, the
pair beside it, in front of the middle and ring columns). A cluster's keys can
fan along an arc; the defaults set `step_deg` and `well_deg` to 0 and place each
key by its own `offset_mm` and `rotation_deg`. The thumb row runs
`near` (next to the finger keys), `home`, then `far` (furthest from them, at
the front):

| Parameter                       | Meaning                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `position_mm`                   | The cluster's centre: the middle of the arc.                                                                                                  |
| `rotation_deg`                  | `[tilt about X, tilt about Y, angle]`. The angle turns the cluster in plan.                                                                   |
| `arc.radius_mm`, `arc.step_deg` | The arc's radius and the angle between neighbouring keys. Key spacing is about `2 × radius × sin(step / 2)`.                                  |
| `arc.well_deg`                  | Each key tilts toward the middle of the cluster by this much per key step, rising so it stays on a circle (a well, as in the finger columns). |
| `keys`                          | Key names in order along the arc, each with an optional `offset_mm` and `rotation_deg`.                                                        |

`chassis` holds the plate thickness and margin and the base thickness
(`wall_mm` is not used). The case's own sizes, its 2 mm wall among them, are
named at the top of `shell.ts`.

## Use

- Drag a handle **parallel to the current view**. The layout axis nearest the view
  direction is left unchanged, so the Top view moves things in plan and the Front
  and Inner views change heights.
  - **Gold**, one per finger key: up and down sets that key's height; along the
    column sets the column's stagger. Move a column sideways with its X offset field.
  - **Green**, on a thumb keycap: moves that key alone. Once it is selected,
    drag the **violet** tip of its stalk to tilt the key about its keycap's
    centre, and the **pink** arm to spin it about its own axis.
  - **Cyan**: a thumb cluster's centre. **Pink**: turns a thumb cluster about its centre.
- Clicking a handle shows every parameter of its column, cluster or key as
  number fields. **All configuration** shows and edits the full JSON.
- Drag empty space to orbit, right-drag to pan, wheel to zoom. The view bar
  has 3D, Top, Underside, Front and Inner views.
- The view, the View checkboxes and the chassis opacity are remembered in this
  browser across reloads (a `?mark=` link still sets its own view).
- **Case shape (prototype)** in the View panel picks the case (see
  [Case shapes](#case-shapes)); the choice is kept in the URL as `?box=`.
- **Old Dactyl's keys, ghosted** overlays the keys of the Dactyl Manuform in
  use (`v4/mechanical/dactyl-keys.json`), best-fitted to this design's finger
  keys. **Show wireframe** draws the chassis edges.
- **Keycap bottom at full press** sets the keycap's lowest point above the
  switch seat, for the clearance checks.
- Parts and keycaps follow while dragging. The previous chassis stays visible
  until the rebuild after release finishes. Stale results are labelled;
  STL/report export is disabled until the chassis is current.
- Undo/Redo (Cmd/Ctrl-Z and Shift-Z also work) and Reset model. Reset can be undone.
- Changes autosave to LocalStorage; the dev server also mirrors the autosave,
  with the page's query, to `v4/editor/autosave/project.json` (gitignored).
  **Save project** downloads a JSON file; **Open project** validates and
  restores one. Older projects are migrated (`migrate` in `geometry.ts`);
  version 1 files are refused.
- **Export review STL** exports the case without the bottom section or the
  trim. **Export bottom section STL** exports the bottom section, a separate
  print. The port panel's trim insert has no export. **Save report** downloads
  the clearance report as JSON.
- **Marks**: press M to paint on the model where something looks wrong (hold
  Alt to orbit), add a note and save. The dev server writes each mark, with a
  screenshot, the camera, the commit and the autosaved design, to
  `v4/editor/marks/` (gitignored). `?mark=<id>` opens on a mark's view;
  `?marks=0` hides saved marks.
- **Wiring and pads** shows the wires as tubes coloured by net group, and the
  pads. The wires are routed with each chassis build, so while you edit they
  stay as last built. **Adapter and ribbons** shows the adapter and both
  ribbons; turn it off to see the wiring behind them. The **Wiring** panel
  lists each key's row and column, and a cut list per net.
- **Show bounding box** outlines the box around the case, bottom section and
  trim; the View panel gives its width (X), depth (Y) and height (Z) in mm,
  updated with each chassis build.

## Construction

`chassis.ts` builds the chassis from the key poses, on the case from `shell.ts`:

- **Case** (tape-deck, the default): a Commodore 64 style "breadbin" round the
  finger keys, turned a quarter so the C64's side profile runs across X: the
  bullnose along the pinky end, the flat top with the grill (six grooves) and
  badge towards the inner end, and the port panel on the inner end. Its deck is
  one plane fitted through the finger plates. The thumbs sit in a separate
  block in front of it, like the C64's tape deck: a level top 3 mm below the
  bin's deck, its front rounded over, the thumbs' well a slot in it with a
  window through the front, and a square lip round the window. A groove all
  round, 13 mm up, is the **parting line**. The case is hollow and each well is
  open through it, with a wall down from the deck round it.
- **Bottom section**: the case's shell below the parting line, plus the
  **adapter mount**, a separate print. The mount is a boss with a peg through
  each of the adapter's two mounting holes, beside the connector, and two rests
  under its solder-hole end. Everything else below the parting line (plates,
  floors, skirts, glue pads, and the tape-deck lip, which reaches 4 mm below
  the line into a cutout in the bottom section's front) stays with the case.
- **Port panel**: a notch in the bottom section on the finger bin's inner end,
  up to the parting line and square there, its opening chamfered 1 mm at 45°
  round its outside edge. A dark **trim** insert (a separate part) sits at its
  back, and the main ribbon leaves through a slot in it. A neck round the slot
  passes through the wall, where the two halves close on it. Inside the case
  the insert carries the ribbon's **landing**, a block standing on the bottom
  section with two tunnels across it for cable ties that pass over the ribbon.
  The landing reaches below the neck, so a pull on the ribbon bears on the
  wall. It is 10 mm long from the wall, so the adapter stands far enough in for
  its loop to clear it.
- **Tile**: the bought 1U key PCB under each switch (see [the v4 README](../README.md)),
  provisionally 19 × 19 mm. Its **tile pocket** is the space under the plate kept
  clear for the tile, its parts and the switch body, open below to the hollow so
  the tiles can be soldered with the bottom section off.
- **Plate**: the square a switch clips into, 3 mm thick. It reaches 0.9 mm
  past the 15.8 mm switch seat on each side, or to the edge of the tile pocket if
  that is further, so the plate always covers the tile.
- **Floor**: the plates are part of a faceted floor, as thick as the plate
  (3 mm). In the finger well it is one sheet: a flat square 0.8 mm past each
  key's seat, straight strips between neighbours, a patch where four keys meet,
  and the outer keys' strips carried on level out to the wall round the well.
  The main thumbs have the same squares and strips, with no run-out to a wall;
  the extra thumbs have a sheet whose run-out stops short of the main thumbs'
  rooms. Neither well's floor runs under the other's.
- **Rooms**: the case is cut back under the plates, straight down from 8 mm
  past each plate's open edges, so the tiles, their solder pads and the wires
  have room inside the wall round the well.
- **Skirts**: where a cut-back room would open the deck's wall, a skirt 1.2 mm
  thick and up to 10 mm deep runs round the well's edge to close it. Skirts stop
  3.6 mm above the parting line, keep clear of the tiles, the soldering iron's
  way to each pad and the wires, and are dropped where a piece would be left
  loose. The main thumbs have no skirt.
- **Glue pads**: each tile is glued up against four L-shaped pads under its
  plate's corners, outside the switch's seat. The pads set its height, and the
  glue holds it when a switch is pressed into its socket.
- Above each plate the chassis is kept clear of the switch housing's rim (the
  seat footprint, up to the keycap's lowest point) and of the keycap's travel.
- **Wire port**: the thumb wires reach the finger well through a round way
  (`wiring.port_diameter_mm`, 5 mm) in front of the gap between the inner and
  index columns' bottom keys, inside the case's hollow.

### Case shapes

**Case shape (prototype)** in the View panel, or `?box=` in the URL, picks the
case; tape-deck, the default, leaves no `?box=`. The others are
`turned-narrow` (one turned bin round all the keys, the grill beside the index
column), `left-grill-narrow` (bullnose at the front, the flat top and grill
across the inner end) and `joined` (the earlier shape: a deck fitted through
the plates, the thumb deck carried on in front as part of the same solid, a
port panel recess straddling the parting line 10 mm up). `?recess=mm` sets
the deck's height above the plates. These are prototypes; their code is marked
`PROTOTYPE` in `shell.ts`.

**Shape prototypes**: `/prototype-shapes.html` on the dev server
(`src/prototype-shapes/`) builds a case on the default config's keys with
none of the editor's wiring or fit checks, for trying shapes quickly. ←/→ or
`?variant=` picks the shape: `c64-joined-badge` (the joined C64, its own copy,
the thumb deck along the line fitted through every thumb), `tape-deck` or
`turned-narrow` (the C64 case carried to the front round the thumbs, no tape
deck); the last two are the editor's chassis with that case. It reports loose pieces, keycap hits and the gaps between
key groups; M paints marks, as in the editor.

**Main thumbs held by (prototype)**, or `?held=`, braces the main thumbs to the
case; without it they hang off one small contact. Each plate edge with no
neighbour is carried level out, or straight down, whichever is shorter, to
4 mm into the case or the window's lip within 25 mm, never above the plate's
top. `walls`: the whole edge, 5 mm deep; every key passes the support check.
`ribs`: a 5 mm rib at each end of the edge, 8 mm below the plate; near fails,
because a rib meets the 3 mm plate only across its edge (about 15 mm² a rib).
Both stay clear of the keycap rooms, the tiles' and irons' ways and the wires
(`chassis.thumb_support`).

## Wiring

`wiring.ts` models the hand wiring from these provisional assumptions:

- **Tile pads**: four on each of the tile's edges parallel to its socket, at
  x = −7, −2.5, 2.5 and 7 mm, 1.2 × 1.8 mm, on the underside. Back edge: C, G, +,
  DO. Front edge: R, G, +, DI. The two G pads are joined on the tile, and so are
  the two + pads.
- **Matrix**: each hand is 4 rows × 5 columns. The finger rows are RT, RH and RB
  (ribbon pins 4–6); the five thumbs are row RX (pin 12). Columns C0–C4 (pins
  7–11) run pinky to inner. Each thumb sits on a finger column: x2 on C0, near on
  C1, x1 on C2, home on C3, far on C4. A thumb's column wire goes to its
  column's adapter hole, so two wires share each column hole. Pins 14–19 are
  spare.
- **Ribbon pins**: 1, 3, 13, 20 and 24 GND; 2 LED data; 21–23 +5 V. The adapter
  has 2 × 12 holes at 2.54 mm; pin n is in column ⌊(n − 1) / 2⌋, even pins on the
  row nearest the board edge.
- **Chains**: each finger column chains its C pads top → home → bottom; each row
  chains its R pads across the columns; LED data runs DO → DI through
  `wiring.led_order` (the thumbs, then the columns in alternating directions);
  +5 V and GND daisy-chain every tile. Each chain has one **feed**, a wire from
  its nearer end to its adapter hole.
- **Paths**: wires run close under the tiles. Each end leaves its tile by a
  **leg**, in the key's frame: 0.6 mm down from the pad, an optional shift
  sideways, down to the leg's depth, then straight out to the tile edge facing
  where the wire goes. A leg over the pad's own edge runs 0.6 mm below the tile;
  one along the row of pads runs from 2.7 mm down, 0.9 mm deeper for each pad it
  passes under; one across the tile runs just under its parts. A wire between
  two tiles joins its two legs with a straight run. Where that would run into a
  plate or its reach, it steps back under the higher tile and drops, or turns a
  corner in plan, or runs under both ends.
- **Wire port**: thumb wires reach the fingers through the wire port. Each takes
  its own place in a hexagonal grid across the port, 1.02 mm apart, chosen to
  suit the directions its two ends lie in. A thumb's wires gather just off its
  edge facing the port, each offset as its place, so they run to the port side
  by side. Feeds run down to a **loom** 10 mm above the bottom section, then
  across to the adapter.
- **Routing**: each wire has many candidate routes (depths, shifts, the other
  pad of the same name for +5 V and GND, port places and loom levels). Routes
  that run into a tile, its parts or a plate, or that shift out past the
  tile's pocket, are dropped. The wires then negotiate: each takes its cheapest
  route given the others, and routes that meet another wire cost more each
  round until none meet. Pairs that still meet are repaired together with the
  wires most in their way. Routing runs in a worker of its own
  (`wiring-worker.ts`) while the build worker lofts the shell, so the wires
  follow an edit when the chassis rebuilds.
- **Wire**: 30 AWG (0.6 mm) for signals, 26 AWG (0.9 mm) for power and ground.
- **Cut length**: each wire's path plus 5 mm at each end. A feed also has a
  40 mm **service loop**: spare wire left slack so the bottom section, with the
  adapter on it, can be lifted off and set beside the body without pulling on a
  solder joint.

The default hand has 100 wires, 200 solder joints and about 6 m of wire.

The **main ribbon** is a 24-way 0.5 mm FFC, 12.5 mm wide. From the adapter's
connector it makes a half loop of radius 4 mm, lies on the landing where it is
tied down, and leaves through the port panel's slot.


## Clearance checks

`solid.ts` adds flat switch seats and clip reliefs, cuts the switch openings, and
checks the result:

- Each switch has a crisp, planar 15.8 × 15.8 mm seat (`switch.seat_outer_mm`,
  0.1 mm clear of a 15.6 mm switch housing rim), 1.5 mm thick, with the
  14.15 mm opening; two 5 mm-wide underside reliefs give the spring clips room.
  Seats are checked for a complete plate ring, material outside their planes and
  clip obstructions.
- Each opening is probed at nine points.
- Tiles, tile components, the pads, the FFC adapter with its connector and
  latch room, and the main ribbon must not overlap the chassis or the bottom
  section. The adapter and the ribbon must not overlap the port insert either.
- **Wires**: each wire, as a tube of its diameter, must miss the chassis, the
  bottom section and every other wire (wires may touch).
  Wires that hit are listed and highlighted cyan.
- **Solder access**: with the bottom section off, a 2 mm round iron's way 8 mm
  straight down from each pad, along the key's normal, must miss the chassis.
  Blocked pads are listed and highlighted cyan.
- Keycaps at rest and over their full travel plus clearance must not touch it.
  The middle thumb uses its **28 × 18.5 × 11 mm** cap, **4 mm travel** and
  **2.5 mm clearance**. The keycap bottom at full press is set 2 mm above the seat.
  Each keycap's room is cut out of the chassis before this check, so it fails
  only when the room is smaller than the keycap's travel; the keycap room check
  below reports chassis that was in the way.
- Without the bottom section the case must be one piece; loose pieces over
  0.5 mm³ are listed and highlighted. It must also hold together along the
  parting line: a section 1.5 mm above it must be one connected area. Separate footprints are listed and highlighted.
- Every key's seat must be held to the case: the narrowest cross-section of
  solid between the seat and the case's outside wall at the parting line (a
  minimum cut on a 0.75 mm voxel grid, `support.ts`) must be at least 60 mm².
  Keys held by less are listed with their section, and the cut is highlighted.
- No chassis may be built where a keycap goes. Each keycap's room (the keycap
  and its clearance from its lowest point up, and the switch housing's rim below
  that) is cut out of the chassis, and whatever it removed is listed and
  highlighted orange.
- The closest distance between resting keycaps of the finger columns, the thumb
  row and the extra thumb row is listed; touching fails.

Failures are highlighted in the viewport: red for at-rest or hardware overlap,
orange for the keycap travel envelope and for chassis cut away by a keycap's room, pink for opening, seat or loose-piece
defects, cyan for wires and blocked solder access. Click a result to isolate it, or **Show all failures**.

Envelopes are conservative boxes, not measured parts. PCB retainers, minimum wall
thickness and global self-intersections are not checked. Passing does not qualify
a print.

`worker.ts` rebuilds outside the UI thread. Results carry revision IDs, so a stale
result cannot replace a newer edit. A 30-second watchdog stops a stuck worker, and a
fresh worker takes over every eight builds to release geometry-engine memory.
The wires are routed in their own worker while the shell is lofted. The checks
cut each probe against the case near its key, not the whole case. Each build
frees every geometry object it made, so memory stays flat from one build to the
next.

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
project and its variants. `test:fit` and `fingerprint` build the tape-deck case,
as the browser does by default.

Construction sizes that are not in the config are named in `SIZES` at the top of
`chassis.ts`, the case's at the top of `shell.ts`, and the plates' in
`plates.ts`; the checks' sizes and limits are in `CHECKS` in `solid.ts`.

`test:fit` optionally takes a saved project file and exits nonzero whenever a
check fails. `tests/python-reference.json` is a frozen fixture from the previous
Python implementation; the tests use its finger key poses.
