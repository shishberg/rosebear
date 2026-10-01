# Rosebear chassis editor

The right-hand chassis editing loop runs entirely in **TypeScript + Three.js

- Manifold WebAssembly**. No Python server or export/rebuild handoff is required.
  KiCad/PCB generation stays in the existing offline v4 pipeline.

The editor edits the **key layout**; the chassis is generated from it. The
construction is the swept Skeletyl shape chosen from the
[shape prototypes](src/prototype-shapes/) (see [design status](../docs/design-status.md)).

The wiring, the tile pads, the FFC adapter, the ribbons and the Cirque TM040040
dimensions are **provisional**: the pads are read from a photo of the bought
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

`trackpad.position_mm` and `rotation_deg` place the Cirque pod. `chassis` holds
the construction's dimensions: plate thickness and margin, wall thickness, the
swept end's radius, how far the end plates may reach into it (`end_cut_mm`), the
base plate thickness and the walls' pattern (`wall_pattern`: `"hex"`, the
default, or `"solid"`).

## Use

- Drag a handle **parallel to the current view**. The layout axis nearest the view
  direction is left unchanged, so the Top view moves things in plan and the Front
  and Inner views change heights.
  - **Gold**, one per finger key: up and down sets that key's height; along the
    column sets the column's stagger. Move a column sideways with its X offset field.
  - **Cyan**: a thumb cluster's centre. **Pink**: turns a thumb cluster about its centre.
  - **Purple**: the trackpad.
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
  **Export trackpad housing STL** exports the trackpad housing, a separate print.
- **Wiring and pads** shows the wires as tubes coloured by net group, and the
  pads. The wires are routed with each chassis build, so while you edit they
  stay as last built. **Adapter and ribbons** shows the adapter and both
  ribbons; turn it off to see the wiring behind them. The **Wiring** panel
  lists each key's row and column, and a cut list per net.
- Projects saved before the wiring was added load with the default adapter,
  ribbon, pads and wiring.

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
  as the plate. The curve spans the end keys' plates, and on past a wall beside
  it to the wall's outer face. Where two columns' lines
  overlap, the outer one is used; across a gap between them the curve changes
  smoothly from one line to the next. Round-bottomed slots part the columns down
  to half the wall height.
- The thumb rows are ladders whose two ends roll over the same way.
- **Walls** stand on the inner and pinky columns' outer sides, the main thumb
  row's back and the thumb rows' fronts. When the extra thumb pair is close in
  front, the main row's front, which faces it, has no wall. A wall stands just
  outside the plate edges, wall_mm thick, so the tile pockets stay inside it
  and a walled side is wall_mm wider than an open one. Each key has its own wall
  segment, joined to its neighbours'.
  The segment follows the plate's tilt down to the tile pocket's depth, then
  drops vertically to the base. A U cutout under each key, the tile pocket's
  width, runs from the plate's underside to just below the pocket, with 2 mm
  round bottom corners. What remains is a post between each pair of keys and a
  strip along the base. Above the plate's underside the wall is whole, from key
  to key. With the hex pattern, the wall is opened into struts
  wall_mm wide: each post comes down to a hexagon centred under it, with
  upright sides under the key centres, and struts run from the hexagons down
  to the base strip. The struts slope at 30° and pass 0.5 mm under the tile
  pockets' corners, so the upright sides are as long as the wall allows. Where a key's upright
  side would be shorter than wall_mm, the pattern is cut off at the base
  strip instead: the key has no strut below it, and the hexagons either side
  run down to the strip. In the default layout the pinky column and the extra
  thumb pair's walls are cut off this way; the inner column and the main thumb
  row's front have whole hexagons. The half hexagons inside a run's end posts
  are cut only where a cap closes the wall's end. At each end of a swept
  end, a cap closes the quarter round; where a wall runs beside the cap, the two
  are joined. A cap with no wall beside it closes the round only down to the
  plate's underside, leaving the tile pocket open.
- **Tile rests** (prototype; `chassis.tile_rests: false` turns them off): pressing
  a switch into its hotswap socket pushes the tile down. A foot 1.5 mm thick
  reaches 1.5 mm under a tile's side edge, 0.1 mm below it, cut back around the
  tile's parts. In the finger columns, most tiles go up 7.5 mm in front of their
  place and slide back onto their feet, so the feet are only under the back of
  the side edges, from 2.3 mm behind the centre: under the socket. The bottom
  row faces the same way as the others, but the front swept end leaves no room
  in front of it, so its tiles go up behind their place and slide forward onto
  feet under the front of the side edges. Those feet are not under the socket,
  so pressing a switch in would lever the tile's back end down about them. A
  lid from the plate to 0.2 mm above each side edge, past the feet (from 6.5 mm
  in front of the centre to the tile's front end), holds the front end down and
  stops it tipping. The feet stop 1.5 mm short of the lids (at 5 mm), so with
  the body printed on its base nothing stands under a lid: there is no slot to
  fill with support, and the lid's underside is clear down to the bed. In each
  row a web joins neighbouring columns' plates along their feet; in the outer
  columns the feet under the walled edge hang from the wall. Where the wall
  between two keys comes inside a tile's way in, the way is cut out of it. In
  the thumb rows the rests hang between
  neighbouring keys along the row and past its end keys.
  A foot stops short of a soldering iron's way to a pad beside it
  (see Wiring). A thumb key turned across its row (the home thumb) would have
  pads along the row, so it has no rest there; two short hangers under each of
  its other two edges hold it instead.
- Ribs 6 mm tall join along the base: both ends of the main thumb row to the
  fingers' front, and, when the rows are close, the ends of the two thumb rows to
  each other.
- Above each plate the chassis is kept clear of the switch housing's rim (the
  seat footprint, up to the keycap's lowest point) and of the keycap's travel.
- **Trackpad housing**, a separate print: a round cup with a recess the pad sits
  in, a cavity under the pad for its 4.1 mm of back-side parts (the pad rests on
  its part-free outer ring), a slot in the floor for its 12-way cable, and a
  dovetail tongue. It is symmetric about the plane through the tongue, and the
  pad is turned so its connector lies on that plane, so the mirrored left hand's
  mount takes the same housing. The tongue points at the far thumb key
  (`trackpad.mount_toward`). A **mount** block on the body, joined to that key's
  two nearest plate corners, has the matching slot, open at the top: the housing
  slides down into it along the pad's normal, and a screw up through the mount's
  floor holds the tongue.
- The bottom plate is the footprint of everything above, 2 mm thick, and is a
  separate print. The editor hides it by default; **Bottom plate** shows it. It
  carries the **adapter mount**: a boss with a peg through each of the adapter's
  two mounting holes, beside the connector, and two rests under its solder-hole
  end. Between the connector and the inner wall is the ribbon's **landing**, a
  block with two tunnels across it for cable ties that pass over the ribbon.
- **Ribbon notch**: the main ribbon leaves through a notch in the inner wall's
  base strip, just above the bottom plate.
- **Wire port**: the thumb wires reach the finger columns through a round hole
  (`wiring.port_diameter_mm`, 5 mm) along the slot between the inner and index
  columns' front swept ends, at the height of the slot's round bottom, and on
  through the thumb row's back wall.

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
  two tiles joins its two legs with a straight run.
- **Wire port**: thumb wires reach the fingers through the wire port. Each takes
  its own place in a hexagonal grid across the port, 1.02 mm apart, chosen to
  suit the directions its two ends lie in. A thumb's wires gather just off its
  edge facing the port, each offset as its place, so they run to the port side
  by side. Feeds run down to a **loom** 10 mm above the bottom plate, then
  across to the adapter.
- **Routing**: each wire has many candidate routes (depths, shifts, the other
  pad of the same name for +5 V and GND, port places and loom levels). Routes
  that run into a tile, its parts or its rests, or that shift out past the
  tile's pocket, are dropped. The wires then negotiate: each takes its cheapest
  route given the others, and routes that meet another wire cost more each
  round until none meet. Pairs that still meet are repaired together with the
  wires most in their way. Routing runs in the build worker, so the wires
  follow an edit when the chassis rebuilds.
- **Wire**: 30 AWG (0.6 mm) for signals, 26 AWG (0.9 mm) for power and ground.
- **Cut length**: each wire's path plus 5 mm at each end. A feed also has a
  40 mm **service loop**: spare wire left slack so the bottom plate, with the
  adapter on it, can be lifted off and set beside the body without pulling on a
  solder joint.

The default hand has 100 wires, 200 solder joints and about 6 m of wire.

The **main ribbon** is a 24-way 0.5 mm FFC, 12.5 mm wide. From the adapter's
connector it makes a half loop of radius 4 mm, lies on the landing where it is
tied down, and leaves through the notch. The **trackpad cable** is a separate
12-way FFC, 6.5 mm wide, from the pad's connector down through the housing's
floor slot.


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
  plate. The trackpad, its parts and its cable must also miss the housing.
- **Wires**: each wire, as a tube of its diameter, must miss the chassis, the
  bottom plate, the trackpad housing and every other wire (wires may touch).
  Wires that hit are listed and highlighted cyan.
- **Solder access**: with the bottom plate off, a 2 mm round iron's way 8 mm
  straight down from each pad, along the key's normal, must miss the chassis.
  Blocked pads are listed and highlighted cyan.
- **Trackpad housing**: one piece, clear of the body and the bottom plate where
  it sits, and clear of the body as it slides up off its mount.
- Keycaps at rest and over their full travel plus clearance must not touch it.
  The middle thumb uses its **27.525 × 18 × 9 mm** cap, **4 mm travel** and
  **2.5 mm clearance**. The keycap bottom at full press is set 2 mm above the seat.
  Each keycap's room is cut out of the chassis before this check, so it fails
  only when the room is smaller than the keycap's travel; the keycap room check
  below reports chassis that was in the way.
- Without the bottom plate the chassis must be one piece; loose pieces over
  0.5 mm³ are listed and highlighted. The walls must also meet along the base: a section 1.5 mm up
  must be one connected area. Separate footprints are listed and highlighted.
- No part of the chassis may reach into a tile pocket, so every tile can be
  placed and soldered. Any overlap is listed, and the pieces with volume are
  highlighted red.
- Every wall must be solid apart from its U cutouts, and every cutout must go
  through. The check looks straight through each wall segment, from the
  neighbouring keys' centres on either side (the view's ends count as solid),
  taking in only the wall's own thickness: any hole in that view that is not the key's cutout or one of its
  hex pattern openings, and that no designed opening passes through (a
  neighbouring key's wall can turn across the view), is a gap, and a
  cutout with no hole is blind (something fills it or stands close behind it).
  Gaps and blind cutouts are listed and highlighted pink.
- No chassis may be built where a keycap goes. Each keycap's room (the keycap
  and its clearance from its lowest point up, and the switch housing's rim below
  that) is cut out of the chassis, and whatever it removed is listed and
  highlighted orange.
- The tests also check that every finger tile has a clear way in past the tile
  rests (up 3 mm from below, 7.5 mm in front of its place, then back) that
  misses the chassis and the other tiles.
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
