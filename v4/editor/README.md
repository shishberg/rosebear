# Rosebear chassis editor

The right-hand chassis editing loop runs entirely in **TypeScript + Three.js

- Manifold WebAssembly**. No Python server or export/rebuild handoff is required.
  KiCad/PCB generation stays in the existing offline v4 pipeline.

The editor edits the **key layout**; the chassis is generated from it. The
construction is the C64-styled case chosen from the shape prototypes (see
[design status](../docs/design-status.md)).

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

The default heights and tilts reproduce the previous paraboloid surface, so the
finger keys sit where the Python generator put them.

**Thumb clusters** (`geometry.thumb`, and the optional `geometry.thumb_extra`, the
pair tucked in front of it). The keys fan along an arc:

| Parameter                       | Meaning                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `position_mm`                   | The cluster's centre: the middle of the arc.                                                                                                  |
| `rotation_deg`                  | `[tilt about X, tilt about Y, angle]`. The angle turns the cluster in plan.                                                                   |
| `arc.radius_mm`, `arc.step_deg` | The arc's radius and the angle between neighbouring keys. Key spacing is about `2 × radius × sin(step / 2)`.                                  |
| `arc.well_deg`                  | Each key tilts toward the middle of the cluster by this much per key step, rising so it stays on a circle (a well, as in the finger columns). |
| `keys`                          | Key names in order along the arc, each with an optional `offset_mm` and `rotation_deg` (the middle thumb key is turned 90° for its 1.5u cap). |

`chassis` holds the plate thickness and margin, the wall thickness and the
base thickness. The case's own sizes are named at the top of `shell.ts`.

## Use

- Drag a handle **parallel to the current view**. The layout axis nearest the view
  direction is left unchanged, so the Top view moves things in plan and the Front
  and Inner views change heights.
  - **Gold**, one per finger key: up and down sets that key's height; along the
    column sets the column's stagger. Move a column sideways with its X offset field.
  - **Cyan**: a thumb cluster's centre. **Pink**: turns a thumb cluster about its centre.
- Clicking a handle shows every parameter of its column or cluster as number
  fields. **All configuration** shows and edits the full JSON.
- Drag empty space to orbit, right-drag to pan, wheel to zoom.
- Parts and keycaps follow while dragging. The previous chassis stays visible
  until the rebuild after release finishes. Stale results are labelled;
  STL/report export is disabled until the chassis is current.
- Undo/Redo (Cmd/Ctrl-Z and Shift-Z also work) and Reset model. Reset can be undone.
- Changes autosave to LocalStorage. **Save project** downloads a JSON file;
  **Open project** validates and restores one. Projects from the earlier
  cage-based editor (version 1) are not accepted.
- **Export review STL** exports the case without the bottom section. It is a
  review export, not a claim that the model is mechanically qualified.
  **Export bottom section STL** exports the bottom section, a separate print.
- **Wiring and pads** shows the wires as tubes coloured by net group, and the
  pads. The wires are routed with each chassis build, so while you edit they
  stay as last built. **Adapter and ribbons** shows the adapter and both
  ribbons; turn it off to see the wiring behind them. The **Wiring** panel
  lists each key's row and column, and a cut list per net.
- **Show bounding box** outlines the box around the case, bottom section and
  trim; the View panel gives its width (X), depth (Y) and height (Z) in mm,
  updated with each chassis build.
- Projects saved before the wiring was added load with the default adapter,
  ribbon, pads and wiring.

## Construction

`chassis.ts` builds the chassis from the key poses, on the case from `shell.ts`:

- **Case**: a Commodore 64 style "breadbin". The finger keys sit in one well;
  the thumb row's deck is carried on in front of it as part of the same solid,
  with the thumbs in their own well. The deck follows a surface fitted through
  the key plates. A bullnose runs along the front, a grill and badge across the
  back, and a groove all round is the **parting line**. The case is hollow and
  each well is open through it, with a wall down from the deck round it. A
  rounded wall stands between the thumb deck and the finger well.
- **Bottom section**: the case below the parting line, a separate print. It
  carries the **adapter mount**: a boss with a peg through each of the
  adapter's two mounting holes, beside the connector, and two rests under its
  solder-hole end.
- **Port panel**: a rounded recess in the finger bin's inner end, straddling
  the parting line, with a dark **trim** insert (a separate part) at its back.
  The main ribbon leaves through a slot in it. The insert also holds the
  ribbon. A neck round the slot passes through the wall, where the two halves
  close on it. Inside the case it carries the ribbon's **landing**, a block on
  the bottom plate with two tunnels across it for cable ties that pass over the
  ribbon. The landing reaches below the neck, so a pull on the ribbon bears on
  the wall. The landing is 10 mm long from the wall, so the adapter stands far
  enough in for its loop to clear it.
- **Tile**: the bought 1U key PCB under each switch (see [the v4 README](../README.md)),
  provisionally 19 × 19 mm. Its **tile pocket** is the space under the plate kept
  clear for the tile, its parts and the switch body, open below to the hollow so
  the tiles can be soldered with the bottom section off.
- **Plate**: the square a switch clips into, 3 mm thick. It reaches 0.9 mm
  past the 15.8 mm switch seat on each side, or to the edge of the tile pocket if
  that is further, so the plate always covers the tile.
- **Plate sheet**: in each well the plates make one sheet. Each plate joins its
  neighbours edge to edge, and reaches out on its other edges to the well's
  wall. The reaches and joins are 2 mm thick, so wires can pass under them.
  Neither well's sheet runs under the other's.
- **Rooms**: the case is cut back under the plates, straight down from 8 mm
  past each plate's open edges, so the tiles, their solder pads and the wires
  have room inside the wall round the well.
- **Skirts**: where a cut-back room would open the deck's wall, a skirt 1.2 mm
  thick and up to 10 mm deep runs round the well's edge to close it. Skirts stop
  3.6 mm above the parting line, keep clear of the tiles, the soldering iron's
  way to each pad and the wires, and are dropped where a piece would be left
  loose.
- **Glue pads**: each tile is glued up against four L-shaped pads under its
  plate's corners, outside the switch's seat. The pads set its height, and the
  glue holds it when a switch is pressed into its socket.
- Above each plate the chassis is kept clear of the switch housing's rim (the
  seat footprint, up to the keycap's lowest point) and of the keycap's travel.
- **Wire port**: the thumb wires reach the finger well through a round way
  (`wiring.port_diameter_mm`, 5 mm) in front of the gap between the inner and
  index columns' bottom keys, inside the case's hollow.

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
  The middle thumb uses its **27.525 × 18 × 9 mm** cap, **4 mm travel** and
  **2.5 mm clearance**. The keycap bottom at full press is set 2 mm above the seat.
  Each keycap's room is cut out of the chassis before this check, so it fails
  only when the room is smaller than the keycap's travel; the keycap room check
  below reports chassis that was in the way.
- Without the bottom section the case must be one piece; loose pieces over
  0.5 mm³ are listed and highlighted. It must also hold together along the
  parting line: a section 1.5 mm above it must be one connected area. Separate footprints are listed and highlighted.
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
A rebuild takes about 2.2 s in the browser: about 0.5 s to loft the shell while the
wires are routed alongside, then about 1.5 s for the chassis and the checks. The checks
cut each probe against the case near its key, not the whole case. Each build frees every geometry object it made, so
memory stays flat from one build to the next.

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
project and its variants.

Construction sizes that are not in the config are named in `SIZES` at the top of
`chassis.ts`, the case's at the top of `shell.ts`, and the plate sheet's in
`plates.ts`; the checks' sizes and limits are in `CHECKS` in `solid.ts`.

`test:fit` optionally takes a saved project file and exits nonzero whenever a
check fails. `tests/python-reference.json` is a frozen fixture from the previous
Python implementation; the tests use its finger key poses.
