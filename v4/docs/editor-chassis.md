# Editor chassis and wiring

How the [editor](../editor/README.md) builds the right hand's chassis and wires it. The
editor guide covers running it, the key layout parameters and the clearance
checks. The tile, its parts, holes and pads are measured from the bought tiles
(see [design status](design-status.md)). The wiring, the FFC adapter and the
ribbon dimensions here are **provisional**: the adapter is a generic 24-way FFC
breakout on perfboard. Each is marked `provisional` in the configuration. File
paths are relative to `v4/editor/`.

## Construction

The default chassis is the **Skeletyl** (`src/skeletyl.ts`, `chassis.style:
"skeletyl"`): a rib along each finger column and each thumb row, and one rail
round the outline on the floor. A rib is one swept solid: the key plates as
slabs, curved webs between them tangent to the plates, and a lip and round at
each end, clear of the tile pocket and the switch. PROTOTYPE: the outline
runs straight from foot to foot: it is the hull of where the ends would drop
straight down and of the outer sides of the first and last columns and the
thumb rows (their plates and tile pockets), with no margin past them, so the
rail is under their edges, taken out round any switch hole's column or tile
that comes down near the floor, so the rail keeps clear of it. Its corners out stay
sharp. Where a drop stands on it, it turns in to the drop's outer face and
runs straight on from the face's corners to the next thing it must take in.
Otherwise it turns in only over open
floor: where the hull bridges a pocket more than 30 mm across its mouth and
more than 2 mm deep that no drop or wall stands in, it turns in once, with one
crisp corner where the lines from the mouth's two ends, tangent to what lies
under, meet. On Swung in that is only between the thumbs and the finger
columns' fronts. An end of the rib that comes down low (whose round would end
less than 1 mm above the rail) has its round drawn as tight as still clears the tile pocket,
the switch and the keys, down to a radius of the wall plus 0.5 mm. An end near the outline
drops to the floor: the rib carried on down from its round as one sweep,
keeping the across and the width it has at the bottom of the round all the
way down to a square foot, so it never twists or splays. It stands straight down, or bends out in the end's own plane, along its
heading, until the nearer corner of its outer face meets the outline (on Swung
in only the ring column's back, 0.5 mm); an end whose outline is more than
12 mm out hangs. Its outer face is flush with the rail's
over the rail's whole height, and it bends or rounds only above it. The rail
is level everywhere, 6 mm high, and never dips: a low end, whose round,
drawn as tight as it clears, still ends less than 1 mm above the rail's top,
has no drop of its own. Standing on the outline, its round stops 0.5 mm over
the rail's top, and below that its section carries straight on down onto the
rail, its outer face the rail's outer face and its inner face the rail's
inner face (a full wall in), its sides in the round's own upright planes; the
outline turns in along its sides. Whatever of it comes lower (the round's
lower side, the lip, the plate's underside corner) is cut off level with the
rail's top, so it meets the rail along one crisp line, with no fill and no
fairing. On Swung in these are the fronts of the thumb row's far key and the
second extra key; under the second extra key's front the rail stands in the
band beside its plate's edge, over its tile pocket, and fuses into its glue
posts there (the tile, its glue and the switch stay clear). Ends further from
the outline hang. Each drop stands on the rail alone; between
neighbouring drops the rail runs straight on. PROTOTYPE: two drops of
different ribs whose facing sides stand within 1.5 mm of each other (too
narrow a slit to print cleanly) are **fused**: each is widened on that side
(its section, and its round's, made wider) by half the widest gap plus
0.4 mm, so the two overlap and the union joins them along one crisp line, as
any two ribs meet. The widening runs from their feet up as far as they stand
that close, measured every 0.25 mm, and runs out over 1 mm above that; there
is no fill and no fairing. The rail runs on under the pair without turning in
between them, taking in both widened feet, its outer edge stepping from one
face to the other where they meet (each face flush with it). On Swung in only the index and middle columns' back drops
fuse (0.13 mm apart at most, widened 0.47 mm each, up to 33.5 mm). PROTOTYPE: small **bridges**
tie neighbouring ribs together up at the plates. Where two keys of different
ribs face each other across a gap of 0.5 to 8 mm, along at least 6 mm of both
plates' edges, a 4 mm wide bridge of the plate's section spans the gap at the
middle of that stretch: a sweep from one plate's edge to the other's, flush
with both plates' tops and undersides, its sides square on their edges. It is
left out where its mean slope out of the plates is over 45°, or where it
would come near what the keys hold or near a wire (the router doesn't route
round the frame, so the bridges keep 0.5 mm off the routed wires). On Swung
in there are six: between the inner and index columns at every row, index
and middle at the home and bottom rows, and middle and ring at the home row.
Where two keys are too steep or too far round to
web, the rib is parted there, and each end is rounded if the round clears the
other keys' tiles, switches and keycaps, else stops flush at its plate. Drops
are left out where they would hit another key. Nothing is cut out
of the frame. The base plate inside
the outline is the bottom section; it carries the adapter mount and the
ribbon's landing. On Swung in the ribbon leaves on the inner side, along
−x at y ≈ 16 under the web between the inner home and top keys. It lies on the
landing at z ≈ 10, about 4 mm over the rail's top (z 6), so it passes over the
rail, not through it. The chassis cuts a notch for it 40 mm back from the
landing's out end, but that notch lies wholly outside the frame and cuts
nothing. The landing block (x −57.5 to −47.5, z 2 to 10) reaches about 7.6 mm
past the rail's outer edge (x −49.9 there) and overlaps the rail. PROTOTYPE:
`?walls=pillars|wishbone` stand limbs on the outer sides. Each leaves its rib
at the middle of the web between two neighbouring keys, starting from the
web's own outer edge as the rib's mesh has it, in the rib's section, 3.4 mm
wide (every limb and every part of one, root to feet). After a 0.5 mm lip it
turns down in one round as tight as its section allows (its inner face 0.5 mm
round, the ends' least: 3.5 mm on the outside, where the ends' rounds are 5)
and runs straight down onto the rail flush, so it stands as near under its
column as clears and a key press loads it down the limb more than across its
joint. A wishbone's
trunk forks into two legs, each slanting at 45° and standing 9 mm
from the trunk's middle (or as near as clears, and no further than halfway to
the next web), so the fork is as high as that spread needs; where no fork fits
under the trunk's round it is a pillar. A limb comes down as near its web as
clears, its legs narrower there before it goes further out. A limb in the main ribbon's way forks
over it (pillars too): its opening centred on the ribbon, 2 mm clear each side
and above. Every limb keeps clear of the keys, the drops, the tie and the
ribbon. The outline's hull takes in the limbs' feet, so it runs
straight along them, and each foot is turned along its run (up to 5°) so it
stands flush. On Swung in the inner column has a limb at both its webs: at the
bottom–home web a wishbone forking 7.7 mm over the rail, legs 7 mm out (a
pillar on pillars), and at the home–top web a fork over the ribbon, 17.1 mm
up, legs 9.1 and 11.3 mm out. Their rib rises 15° out of the column, so their
round turns 105°; they stand 4.9 to 5.0 mm out from their webs' edges (7.6 and
8.3 mm with the ends' radius and a 1 mm lip), 2.6 to 2.7 mm past the outline
without them, so the inner side runs that much further out (the footprint
3 mm wider). The pinky has a pillar at both its webs (too low to fork): they
leave falling 15° and would stand 3.0 to 3.1 mm out, but the outline there is
4.1 to 4.2 mm out, so they run on out to it. The thumbs' webs are
too short. The
assembly is soldered first and lifted in, so the frame has no wire ways and
the checks don't test the wires against it. The board's height to the keycaps'
tops shows under its size.

`chassis.style: "c64"` (or `?chassis=c64`) builds the C64 case below instead.
`src/chassis.ts` builds it from the key poses, on the case from `src/shell/`:

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
  the bottom section with two tunnels across it for cable ties that pass over the
  ribbon. The landing reaches below the neck, so a pull on the ribbon bears on
  the wall. The landing is 10 mm long from the wall, so the adapter stands far
  enough in for its loop to clear it.
- **Tile**: the bought 1U key PCB under each switch (see [the v4 README](../README.md)),
  17 × 17 × 1.6 mm with notched corners, its top 5 mm below the plate top. Its
  **tile pocket** is the space under the plate kept clear for the tile, its parts
  (the hotswap socket, 1.9 mm deep, is the deepest: the pocket reaches 8.8 mm below
  the plate top) and the switch body, open below to the hollow so the tiles can be
  soldered with the bottom section off. A part's `center_mm[2]` is measured from
  the board's top; `src/geometry.ts` has the helpers every use goes through.
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
- **Glue posts**: each tile is held under its plate by posts, on the Skeletyl
  and the C64 alike, and glued to them. The glue holds it when a switch is
  pressed into its socket.
  - In each corner a round post (1.35 mm radius) stands in the tile's corner
    notch, concentric with it and 0.15 mm clear of it, from the tile's
    underside up into the plate. It is the whole round wherever it is clear:
    along the rib it runs on into the leg on that edge (one solid with it),
    and across the rib it stops where the legs do, 0.15 mm inside the
    plate's side, so it doesn't widen the rib. Above the tile it only has to
    keep 0.1 mm off the switch body, which by default it clears (0.77 mm at
    the body's corner), so it stays round up to 0.3 mm under the plate.
    There the seat's trim, which thins the plate to the seat's 1.5 mm over
    its 15.8 mm footprint, takes the corner of the round inside that
    footprint off level: in the tile's corner notches the trim stops 0.3 mm
    past the plate's underside (`SEAT.trimUnder`), so it leaves the round
    below that.
  - Along the two edges that face along the key's rib (north and south on a
    finger key; every key's north and south on the C64), a leg stands 0.15 mm
    outside the tile. A leg is 1.6 mm thick (`postMin`: four 0.4 mm lines, two
    perimeters a side). It runs down from the plate to the tile's underside
    at each end of the edge, from the plate's side in to 6.25 mm from the
    centre, which keeps it clear of the edge pads and their wires. Between
    those ends it stops at the tile's top. There are no posts on the east and
    west edges, which would widen the ribs.
  - On each leg a shelf reaches in over the tile's top edge to the switch
    seat. It sets the tile's height: 0.15 mm of glue over the tile's top. The
    shelf keeps 0.5 mm off the ring of any hole near the edge, and is dropped
    where less than 1 mm is left.
  - The legs stand 1.4 mm out past the plate's edge. On the Skeletyl they go
    up into what is over them there, the web to the next key or the round of
    the rib's end, 0.3 mm (`glueInto`, as the shelves and corner posts go
    into the plate), so they join it on a surface rather than at a slit or a
    near-coincident face. Their tops follow its underside, sampled from the
    frame's mesh about every 0.25 mm (`postStep`) across the leg's
    footprint. A face steeper than 60° from the horizontal (`postUnder`) is
    a side of the frame, not an underside: where the frame is narrower than
    the plate, or its side leans over the leg on a tilted key, the leg's top
    stays at the underside's level instead of climbing it. Each sample
    takes the highest of its own and its neighbours', so where the underside
    steps down beside a leg's end (a wall or bone coming down) the leg runs
    up to the higher level over the step rather than closing a hollow under
    it. On the Skeletyl the legs, and with them the shelves and corner
    posts, stop 0.15 mm (`postEdgeIn`) inside the plate's sides all the way
    up. A leg
    within 1.5 mm of the frame or another key's post beside it is grown out
    into it, not leaving a slit too narrow to print (by default only on the
    thumbs), but not into the tie it stands on. In the C64's case the legs go
    up into the sheet.
  - Everything clears the switch's clip reliefs, and the posts stay inside the
    plate's sides.
- Above each plate the chassis is kept clear of the switch housing's rim (the
  seat footprint, up to the keycap's lowest point) and of the keycap's travel.
- **Wire port**: the thumb wires reach the finger well through a round way
  (`wiring.port_diameter_mm`, 5 mm) in front of the gap between the inner and
  index columns' bottom keys, inside the case's hollow.

## Wiring

`src/wiring/` models the hand wiring from these assumptions:

- **Tile holes and pads** (`tile.pads`, measured): through holes near the tile's
  sides, two C, two R, in and out, and V and G nearer the LED; a pad for each of
  in, out, V and G on both the socket and the LED edges, on the underside; and a
  spare C and R hole under the socket, which no wire uses. **One wire per hole or
  pad**: a 22 AWG wire fits a hole, two don't.
- **Matrix**: each hand is 4 rows × 5 columns. The finger rows are RT, RH and RB
  (ribbon pins 4–6); the five thumbs are row RX (pin 12). Columns C0–C4 (pins
  7–11) run pinky to inner. Each thumb sits on a finger column: x2 on C0, near on
  C1, x1 on C2, home on C3, far on C4. A thumb's column wire goes to its
  column's adapter hole, so two wires share each column hole. Pins 14–19 are
  spare.
- **Ribbon pins**: 1, 3, 13, 20 and 24 GND; 2 LED data; 21–23 +5 V. The adapter
  has 2 × 12 holes at 2.54 mm; pin n is in column ⌊(n − 1) / 2⌋, even pins on the
  row nearest the board edge.
- **Chains**: each finger column chains its C holes top → home → bottom; each row
  chains its R holes across the columns. A wire arrives at the tile's C (or R)
  hole nearer where it comes from, and the next leaves from the other. LED data
  runs out → in through `wiring.led_order` (the thumbs, then the columns in
  alternating directions). +5 V and GND daisy-chain every tile, arriving at the V
  (or G) hole or the LED-edge V (or G) pad, whichever is nearer, and leaving from
  the other. Each chain has one **feed**, a wire from its nearer end to its
  adapter hole.
- **Paths**: wires run close under the tiles. Each end leaves its tile by a
  **leg**, in the key's frame: 0.6 mm down from the pad, an optional shift
  sideways, down to the leg's depth, then straight out to the tile edge facing
  where the wire goes. A pad's own edge is the tile edge it is nearest. A leg over
  that edge runs 0.6 mm below the tile; one along it runs from 2.7 mm down, 0.9 mm
  deeper for each wired pad near the same edge it passes under; between two
  tiles it may also, last of its choices, shift out to the pad's own edge just
  inside the pocket and run along it 0.6 mm below the tile (the **rim**), which
  keeps it shallow where a low edge would take the run under the pads below the
  floor; one across the tile runs just under its parts. A wire between
  two tiles joins its two legs with a straight run. Where that would run into a
  plate or its reach, it steps back under the higher tile and drops, or turns a
  corner in plan, or runs under both ends.
- **Wire port**: thumb wires reach the fingers through the wire port. Each takes
  its own place in a hexagonal grid across the port, 1.02 mm apart, chosen to
  suit the directions its two ends lie in. A thumb's wires gather just off its
  edge facing the port, each offset as its place, so they run to the port side
  by side. Feeds run down to a **loom** 10 mm above the bottom section, then
  across to the adapter.
- **Routing**: each wire has many candidate routes (depths, shifts, port places
  and loom levels). Routes
  that run into a tile, its parts or a plate, that shift out past the
  tile's pocket, or whose underside runs below the base plate's top
  (`chassis.skin_mm` above z = 0) are dropped; a wire left with no route fails
  the routing. The wires then negotiate: each takes its cheapest
  route given the others, and routes that meet another wire cost more each
  round until none meet. Pairs that still meet are repaired together with the
  wires most in their way. Routing runs in a worker of its own
  (`src/wiring-worker.ts`) while the build worker lofts the shell, so the wires
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
