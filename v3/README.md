# rosebear v3 — direct-wired passive modules

Generates the five-board layout from `v2-p4-pod.md`: one ESP32-P4 pod plus four
passive modules (2× finger cluster, 2× thumb cluster), direct-wired, no matrix
and no diodes.

## Commands

```
baml test            # geometry golden test, ribbon and pod invariants
baml run build       # emit all five boards + DRC         -> ../output_v3/
baml run pinout      # the pod's GPIO assignment, for firmware
baml run pinout_leds # same, with per-key LEDs
```

Builds are deterministic: same config in, byte-identical boards out (UUIDs are
derived, not random).

## Layout

| file | contents |
|---|---|
| `geometry.baml` | `Vec2`, rotation primitive |
| `layout.baml` | `Point`, rotation stack, the zone walk |
| `config_rosebear.baml` | the 36-key layout, and the golden test |
| `features.baml` | variants, module partition, LED chain ordering |
| `ribbon.baml` | FFC pinouts — derived, never hardcoded |
| `netlist.baml` | components, nets, board outline |
| `route.baml` | copper on the key boards: escapes, fan-in, the LED chain |
| `pod.baml` | the pod board: module pinout, sockets, buttons, its own routing |
| `emit.baml` | `.kicad_pcb` emission |
| `build.baml` | entry points |

The config is BAML source, not YAML. There is no config parser and no schema
validation because the compiler does that job — `spread: 1.08 kx` was a string
mathjs evaluated at runtime; it is now `spread: 20.52`, and a typo fails to
build.

## Relationship to ergogen

The placement engine is a port of ergogen's `render_zone`, and
`config_rosebear.baml` carries a golden test asserting it reproduces ergogen
4.0.4's output for all 18 keys of a half to within 1e-6 mm (KiCad's own
nanometre resolution).

Ergogen remains a **dev-only** dependency, used solely as the test oracle via
`../v3/src/golden.ts`. Nothing at runtime depends on it, and it can be deleted
once you are happy with the port. The ~150 lines here replace 471 lines of
`points.js` + `point.js`; the difference is almost entirely ergogen's five-level
key inheritance, which the flat schema does not need.

## Ribbon widths are derived

`v2-p4-pod.md` works out "20-way" by hand (15 finger + 3 thumb pass-through +
ground + spare). That number appears nowhere in the code — `ribbon_signals`
computes it, and a test asserts the derivation reproduces the doc's 20 and 4.

Turning on per-key LEDs therefore costs one bool:

| | pod→finger | finger→thumb |
|---|---|---|
| base | 20-way | 4-way |
| `per_key_leds` | 25 → Molex 200528-0250 | 9 → 200528-0090 |

The growth is not just +1 data line: the doc's own rule ("that data line gets
its own grounded neighbor") is encoded, so each data conductor is flanked by
ground, and LED supply/return conductors are sized from the current budget.

### The cable reverses the pinout

A plain same-side FFC between two connectors that face each other joins the
contact rows by *position*: the conductors cannot cross, and the facing turns
one row around, so contact 1 of one connector lands on contact N of the other.
Nothing in the toolchain models the cable — the combined view joins nets by
name — so getting this wrong is invisible to DRC and costs a board spin. Two
things encode it:

- Each ribbon's `signals` list is the TO end's contact order; the FROM end
  (the pod for the pod links, the finger board for the thumb links) assigns
  its pads from the same list **reversed** (`from_end_signals`), rails and
  spares included.
- `evaluate.py` checks the physical mapping on `all.kicad_pcb`: for every
  link it pairs each contact with the far contact at the same position along
  the row and asserts they carry one net, and that the two rows line up
  (a flat cable cannot shear sideways — the panel slides the pod so the pod
  link's rows are level with the finger boards').

The audit that introduced this found all four links cross-wired end to end,
and the pod's two FFC connectors mounted with their cable openings facing the
pod's centre instead of the hand they serve (the Molex 200528 takes its cable
in over its own solder pads; the BackFlip actuator is at the rear).

## Placement

Two bugs found here were each enough to scrap a board, and both passed a visual
check and a clean DRC first:

- The KiCad `SW_Cherry_MX_*_PCB` footprints put their origin at **pad 1**, not
  the key centre — ergogen's own MX footprint puts it at the centre. Placing
  the origin at the key position shifted every switch by (−2.54, +5.08) mm.
- KiCad negates a footprint's stored rotation. Emitting `−r` (which reads
  correctly) turned every splayed key the wrong way; ergogen emits `+r`.

`netlist_test.baml` now checks the emitted key centres against ergogen's own
generated board, coordinate for coordinate, and checks the centre offset against
the installed `.kicad_mod` so a KiCad update can't move it silently.

## Status

`baml run build` — five boards, KiCad 10 format, per-key LEDs fitted (the
no-LED option is simply not populating them — same PCB), DRC clean apart from:

| board | violations |
|---|---|
| `finger_l` | **0** |
| `finger_r` | **0** |
| `thumb_l` | **0** |
| `thumb_r` | **0** |
| `pod` | 2 |

Unconnected items are **0 everywhere**.

- `pod`: 2 × `lib_footprint_mismatch` on the SKQG buttons. Deliberate: the
  emitter moves every reference designator to the fab layer, and the library
  copy of that part keeps its on silkscreen. Nothing to fabricate differs.
The two `pod` items are the only violations left.

For scale: the same DRC over the ergogen-generated v2 board reports **139
violations, 108 of them `copper_edge_clearance`** — copper too close to the
board edge. Drawing the outline around the finished routing avoids that class
entirely.

Board sizes: finger **156 × 110mm** (148cm² of actual outline), thumb
**66 × 51mm** (24cm²), pod **80 × 92mm**. The LED chain's halo reaches past
the keycaps to the sides and below, and the hull is drawn to hold it.

## All five boards in one file

`baml run build` also writes `../output_v3/all.kicad_pcb`: every board in one
file, in the positions they take on
the desk. The four key boards keep their own coordinates — they come from one
layout, so `finger_l` already knows where `thumb_l` is — and only the pod, which
has no place in the key geometry, is moved: centred between the hands, at the
height that puts its ribbon connectors' contact rows level with the finger
boards' — a straight cable cannot enter two rows at different heights.

It is not a fabrication panel. It is a viewing aid, and it earns its keep: a
board that is the wrong size, an outline that overlaps its neighbour, a
connector pointing away from the board it feeds are all obvious in the assembly
and invisible one board at a time. It found the outline overlap in *Known gaps*
within a minute of existing.

Shared net names — `GND`, the thumb pass-throughs, the LED rails — meet across
boards here, so KiCad's ratsnest draws the ribbons that are otherwise invisible.
Refs are prefixed with the board id, since five boards' worth of `SW1` in one
file is five different parts with one name. `emit_board` is `emit_panel` of a
one-board list, so the single boards and the combined view cannot drift apart.

## Routing

Not a general routing problem, and it doesn't get a general router. The
topology is a fan-in: each key has one net with exactly two pads -- its switch
pin and one ribbon contact -- and everything else is ground.

- **Ground is poured, not routed.** A zone on each side. The front is needed
  for the FFC connector's surface-mount mounting pegs, the back for everything
  else. `kicad-cli pcb drc --refill-zones --save-board` computes the fill, so
  the board that ships has the copper DRC actually checked.
- **Signals are river-routed.** Each key escapes sideways into a lane in the
  channel between its column and the next, the lanes run down the column to a
  line shared by the whole board, and each exit turns in to its contact.

  Planarity is a counting argument, not a search. Two chords joining two
  disjoint arcs of a convex region never cross exactly when the matching
  *reverses* the boundary order — first exit to last contact. `ribbon_signals`
  emits key signals in column order and *we choose the pinout*, so the exits
  are sorted; the connector's angle decides which end of it contact 1 sits at,
  and the angle that points the cable at the pod is the angle that satisfies
  the reversal. There is nothing left to choose, and nothing to search.
- **The outline is drawn last.** The placement guesses a hull from the keys and
  the connectors, which is all it knows; `enclose` then redraws it around every
  track and via the router actually laid. This is what took the last
  `copper_edge_clearance` violations off the boards, and it means a channel
  that reaches further than expected takes the board edge with it rather than
  running off it.
- **Pass-throughs use the back.** The three thumb nets cross the finger board
  without touching a switch on it. They drop through vias behind the connector
  contacts, run on B.Cu, and come back up; the pour parts around them.

Three constants are load-bearing and were found by measurement, not taste:

| constant | value | why |
|---|---|---|
| `LANE_PITCH` | 1.8mm | Two diagonals offset horizontally by *s* are only `s·cos θ` apart perpendicular. The widest fan-in here runs at 76° from vertical, so 1.0mm of lane pitch became 0.24mm of actual clearance -- a short. |
| `CONNECTOR_SIDE_OFFSET` | 8mm | How far outboard of the key field a finger half's connectors stand — the room the fan-in gets to spread into before it turns square onto the 1.00mm contacts. |
| the exit line | fitted | The escape channels must all end on one common horizontal line -- two monotone point sequences on parallel lines join without crossing, and per-column exit heights lose that. `finger_exit_line` puts it as low as every constraint allows: each column's top signal pad and each key's ground-stitch via, by their own clearances. The tallest column binds, so the line sits just above the middle column (0.9mm past its keycap edge) and the bus rows stack north of it -- only rows that actually ride the band get a slot, so the tail contacts of the 25-way link add no height. The LED chain stays out of the way entirely: its column transitions thread the field on the exit row and each key's north strip instead of crossing over the top of the columns. |
| finger connectors on the inboard edge | — | The pod sits between the halves, so both cables leave toward the middle rather than doubling back around the board. Turning the connector through a right angle also turns the fan-in: a straight run per net would approach contacts 1mm apart at a hundredth of that across the runs, so each net drops at its own exit x to its contact's row and turns in square. |

Freerouting was considered and isn't installed (no JRE, no jar). It would be
the wrong tool anyway: it can't exploit the fact that we own the pinout, and
its result isn't reproducible. The pod board is a different matter and will
likely want it.

## Per-key LEDs

The build fits an SK6812MINI-E under every key, reverse-mounted so it shines
up through a milled window. The chain is the only net on a key board that is not
a fan-in, and it drove the layer plan.

**The back becomes the supply plane.** 36 LEDs at 20mA is 720mA, which wants a
plane rather than a rail — and a plane is the only thing that reaches every LED
without a comb of stubs weaving between the hotswap sockets and the data chain.
The front stays ground. The cost is two vias per key: with the back given over
to the supply, the socket's ground terminal and the LED's both have to reach the
front pour.

**The chain runs in two shapes.** Within a column it goes on the *front*: out of
the LED's dout on the back, via up beside it, one lane up the column between the
switch's stabiliser hole and the previous column's channel, and back down beside
the next LED's din. Consecutive hops share that lane and never meet, because the
arrival row is past the departure row *in the direction the chain is
travelling* — so a column running down the board arrives above where it left,
and one running up arrives below. Getting that backwards is a 1.25mm overlap that
looks fine and shorts.

Between columns it goes on the *back*, because the front between two columns is
the first one's channel and cannot be crossed. The back can be, but only outside
the key field — so a transition leaves the column at whichever end the chain
reached, runs out past the last key, crosses at the extreme of the two staggered
ends, and comes back in. Boustrophedon ordering is what makes that work:
consecutive columns are always entered and left at the same end.

The chain's two link vias sit *in front of* the thumb pass-through band rather
than behind it — behind, they would have to cross every track in it.

**South of a key is one shared corridor.** The hotswap socket keeps all its
hardware north of its key's centre, so the only clear lane across a key runs
south of the LED — and three things want it: the under-the-bottom crossing
between two columns, the tail on its way out, and the LED's own ground drop.
The drop therefore goes straight down off the ground pad and stops
(`LED_GND_VIA`), instead of hooking out across the corridor; the crossing and
the tail then share the row (`LED_UNDER_Y`). The old deep crossing row is
unusable anyway: the thumb board's notch is cut out of the south edge, and a
crossing that dropped past it fell off the board.

Which row the tail leaves on depends on which way out it goes, because the two
sides of a key close off at different depths — the din stub comes down to the
elbow on one side, the next socket's ground hook reaches up past the exit row
on the other. The footprints do not mirror, so that is a per-hand choice, not a
mirrored one.

**The head runs in the column's frame, not the board's.** It leaves the pod
link on that contact's own bus lane, crosses the empty north on the back, and
comes down the outside of the first column. The columns are splayed: a plain
vertical drop at the entry point's x walks across the key frame as it climbs —
into the socket pads on one hand and the transition lanes on the other — while
a line parallel to the column holds its offset all the way. That line cannot
reach the north row, which is up where the hull narrows into its corner, so the
run turns onto it on a short diagonal.

**The thumb cluster gets its own chain shape.** Its three keys are one column
each on an arc, so neither the along-a-column nor the between-columns shape
fits. Each hop runs straight from the source's dout to an approach point out
along the destination's din row; when the exit corner and the travel direction
disagree the hop swings around the source's hardware, and on the mirrored hand
that swing goes over the front, because two back-side swings fence each other
in. The chain starts at the far key so its head enters without crossing the
cluster.

**The pass-through strip nests by travel distance.** Each pass lane drops to
its own row of the strip and then runs along it to its contact; a lane that
crosses the whole strip has to pass under every vertical dropping into it, so
it takes the deepest row and the shortest hop the shallowest. Which end of the
thumb link the keys sit at depends on the hand *and* on how wide the link got,
so the order is read off the pads rather than assumed. The chain's own link
contact can land in the middle of that band — the lanes are placed off the pod
link and the contact off the thumb link — and where it does, its drop leans out
to the far side of the band before diving.

**An LED stores the negation of its key's angle.** It is on the back, so KiCad
mirrors it: the stored angle is applied to coordinates that have already been
flipped about the x axis. Store the key's own angle and the part's pads swing
away from the key's axis at *twice* the rate — invisible on a finger column
splayed 5°, and by the time the 1.5u thumb key reaches 60° the data pad has come
right back round onto the switch's 4mm stem hole, 2.37mm from a hole with a 2mm
radius. That one sign was most of the thumb boards' violations. There is a test
that pins every LED pad's position in its key's frame across all 36 keys.

## The pod

The module is a WT9932P4-TINY: 68.59 × 28mm, two 27-pin rows 2.54mm pitch and
**25.40mm apart**, Ø1.05mm holes. Measured out of `WT9932P4-TINY_3D_V1.1.step`
rather than read off a drawing; two `PinSocket_1x27_P2.54mm_Vertical` seat it
exactly. Pinout from `..._pinout_V1.3.1.png`, cross-checked against J6/J7 in
`..._SCH_V1.3.pdf`.

Mounted long-axis up with the USB connectors at the far edge, which turns it 180°
from the datasheet drawing: the row drawn on the right lands on the left, and
the pin drawn at the top becomes pin 1 at the bottom, nearest the connectors.

### Why it routes without a search

Same reason the key boards do, one layer deeper:

- **Each hand is served by the socket on its own side.** The two fans never
  meet and neither has to cross the module. Both hands need 19 pins with the
  base variant and 20 with LEDs; the sockets carry 26 and 21 GPIO.
- **The ribbons leave sideways**, left and right, so a connector's contacts
  stack *up* the board in the same axis as the pins they serve: a 27-pin column
  at 2.54mm against a 20-contact column at 1.00mm, offset in x. Every net is one
  horizontal out of the socket, one vertical along a lane, one horizontal into
  its contact — no diagonals at all.
- **The fan splits into two halves that share one set of lanes.** The contacts
  are packed tighter than the pins, so pins above the middle reach *down* to
  their contacts and pins below reach *up*. Within a half, the pin whose
  contact is furthest away takes the outermost lane; that is enough to make
  each half planar, and the halves never overlap in y, so they can reuse the
  same lanes. The channel is therefore only **half as wide as the ribbon**.

  The proof is two lines. For nets *i* and *j* of the same half, in ascending
  order of height, a crossing needs one net's horizontal to meet the other's
  vertical, which happens only if q*ᵢ* lies between p*ⱼ* and q*ⱼ*. In the half
  that reaches down q*ⱼ* > p*ⱼ* > p*ᵢ*; in the half that reaches up
  q*ᵢ* < p*ᵢ* < p*ⱼ*. Neither can. `pod_test.baml` checks the monotone pairing,
  the half-widths and the disjointness, and then checks planarity
  geometrically anyway.

The connectors sit on the left and right edges, so the board is **74mm wide and
the finger ribbons leave sideways**, one per hand, toward the boards they serve.
The mounting holes moved to the strips past each end of the module — the sides
are escape channel for most of the board's height, and those strips are also the
only places a screw head clears the module, which stands 8mm off the board on
its headers.

The buttons and the LED supply are the exceptions, and they go on the back: the
front between the sockets is pour and the front outside them is the channels.
Both use the same discipline — come up a clear lane, turn in square at the
target pin — because approaching a column of 2.54mm through-holes on a diagonal
shaves every pad it passes. Two buttons sharing a socket nest, and the staircase
runs the *other* way there: they sit inboard, so the lane nearest the pin column
is the one every other run has to cross, and it drops to the back furthest down
the board. That is the sort of argument that reads fine and is wrong half the
time, so `pod_test.baml` checks planarity geometrically — every pair of tracks
on a layer, both variants — rather than trusting the reasoning.

### Spending the GPIO

`v2-p4-pod.md` says pin scarcity doesn't exist here. True, but by a narrower
margin than it reads: 47 pins reach the headers and only **33 are unencumbered,
against 36 keys**. So some has to be spent, and `pin_cost` orders the
concessions rather than letting position decide:

| cost | pins | what it costs |
|---|---|---|
| 1 | IO39/40/43–48 | needs `LDO_VO4` enabled — free in practice, there is no SD card |
| 2 | IO37/38 | the UART0 console; USB-CDC still works |
| 3 | IO2/3/4 | hardware JTAG |
| 4 | IO36 | strapping — a key held at boot changes boot mode |

The assignment spends five SD-domain pins and one UART pin, and **leaves JTAG
and the strapping pin alone**. Both buttons are on the left socket rather than
one per side: buttons are ranked across the pair, and with LEDs fitted the right
socket has exactly one pin spare — the strapping pin. Ranking matters twice
over; taking spares in header order also put a button on JTAG while three SD
pins sat unused beside it.

IO51 already drives an on-board RGB LED and IO35 is already the BOOT button;
neither is broken out, so both come free.

`baml run pinout` prints the assignment with the concessions marked.

### Known gaps

- **The boards run a 0.2mm copper-to-edge rule.** Not our routing: the
  KiCad `SK6812MINI-E_..._ReverseMount` footprint mills the window the light
  comes up through and puts the LED's own four pads 0.239mm from the edge of
  it. `build.baml` writes a `.kicad_pro` per board carrying the rule. Worth
  checking against a fab before ordering.
- **Connector placement is derived, not designed.** Every connector now points
  its cable at the board it feeds, and that single rule fixes the rest: the pod
  link stands on the inboard edge level with the switches, cable out toward the
  middle of the keyboard; the finger board's thumb link sits below the innermost
  column facing down, where the cluster is; the thumb board's own connector sits
  above its keys facing up. Turning a connector also decides which end of it
  contact 1 is at, so the pinouts follow from the placement rather than being
  chosen — see *Routing*. What is still undecided against the case is how far
  outboard each one stands.
- **The finger and thumb outlines overlap.** `../output_v3/all.kicad_pcb` puts
  all five boards in one file at their real relative positions, and shows that
  the finger board's convex hull sweeps over two of the three thumb switches:
  the thumb cluster tucks in under the splayed columns, and a hull drawn round
  the finger keys covers it. Two separate coplanar PCBs cannot do that. The
  finger outline needs clipping back around the cluster, which makes it the
  first non-convex outline in the pipeline.
- **The pod board is generated but hand-designed.** Nothing about it falls out
  of the key layout, so unlike the key boards its geometry is chosen rather than
  derived. The one thing that *is* derived is the part that matters: which GPIO
  each key lands on. See "The pod" below.
- **Choc (PG1350) is not available.** Stock KiCad has MX only; Choc would need
  a third-party footprint library registered.
- **Panelization is not attempted.** Deferred deliberately.

## Hotswap

Switches are not soldered in. Each key gets a **Kailh CPG151101S11 socket on the
back**, and the switch drops into it.

KiCad ships no hotswap land pattern, so `footprints/gen_hotswap.py` generates
one: copper from ergogen's own `mx.js` (vendored in this repo under
`node_modules/`, which is where the community-standard numbers live), outlines
from KiCad's `SW_Cherry_MX_*_PCB`, and the origin moved to the stem hole — which
is the frame both sources already quote their numbers in, so
`SWITCH_CENTRE_IN_FOOTPRINT` is now zero. `build.baml` writes an `fp-lib-table`
beside the boards so DRC can resolve `rosebear:`.

It is a routing decision as much as a mechanical one, and it changed three
things:

- **A key's two terminals are surface pads on the back**, not through-holes. So
  an escape cannot start on the front: it leaves the socket on the back, crosses
  to the channel, and vias up at the innermost lane. Everything downstream is
  unchanged.
- **The ground pours stopped being connected to each other.** A soldered switch
  is two plated holes, one of them ground, and those alone stitched front to
  back at every key. A hotswap key has no plated hole at all, so without a
  deliberate via per key the two GND zones are two islands of the same net —
  which DRC reported the moment the footprint changed.
- **The back got crowded**, which is what forced the LED layer plan below.

## The MCP's role

Board files come from `baml run build` — reproducible, no agent required. The
KiCad MCP is for the judgement work: looking at the board, DRC triage, routing,
and connector placement experiments. Decisions made there get committed back
into the BAML config as explicit values, so the boards stay regenerable.
