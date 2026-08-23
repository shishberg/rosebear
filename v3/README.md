# rosebear v3 — direct-wired passive modules

Generates the five-board layout from `v2-p4-pod.md`: one ESP32-P4 pod plus four
passive modules (2× finger cluster, 2× thumb cluster), direct-wired, no matrix
and no diodes.

## Commands

```
baml test            # geometry golden test, ribbon and pod invariants
baml run build       # emit all five boards + DRC         -> ../output_v3/
baml run build_leds  # same, with per-key LEDs            -> ../output_v3/leds/
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

`baml run build` — five boards, KiCad 10 format, DRC clean apart from:

| board | `build` | `build_leds` |
|---|---|---|
| `finger_l` | **0** | 1 |
| `finger_r` | **0** | 2 |
| `thumb_l` | **0** | 9 |
| `thumb_r` | **0** | 13 |
| `pod` | 2 | 2 |

Unconnected items are **0 everywhere, both variants**.

- `pod`: 2 × `lib_footprint_mismatch` on the SKQG buttons. Deliberate: the
  emitter moves every reference designator to the fab layer, and the library
  copy of that part keeps its on silkscreen. Nothing to fabricate differs.
- LED variant: 1–2 × `tracks_crossing` per finger board where the chain's head
  and tail leave the connector stack, and 9–13 on the thumb boards, which is a
  placement problem rather than a routing one — see *Known gaps*.

For scale: the same DRC over the ergogen-generated v2 board reports **139
violations, 108 of them `copper_edge_clearance`** — copper too close to the
board edge. Drawing the outline around the finished routing avoids that class
entirely.

The pod comes out **74.1 × 90.3mm**.

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
| `COLUMN_EXIT` | 13mm | The exit line is common to the whole board but the columns are staggered, so 6mm below the *lowest* key was only 5mm below the highest column's bottom key -- above its LED's own dout row, which put the fan-in diagonals straight through the chain. |
| finger connectors on the inboard edge | — | The pod sits between the halves, so both cables leave toward the middle rather than doubling back around the board. Turning the connector through a right angle also turns the fan-in: a straight run per net would approach contacts 1mm apart at a hundredth of that across the runs, so each net drops at its own exit x to its contact's row and turns in square. |

Freerouting was considered and isn't installed (no JRE, no jar). It would be
the wrong tool anyway: it can't exploit the fact that we own the pinout, and
its result isn't reproducible. The pod board is a different matter and will
likely want it.

## Per-key LEDs

`build_leds` fits an SK6812MINI-E under every key, reverse-mounted so it shines
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

The base build spends five SD-domain pins and one UART pin, and **leaves JTAG
and the strapping pin alone**. Both buttons are on the left socket rather than
one per side: buttons are ranked across the pair, and with LEDs fitted the right
socket has exactly one pin spare — the strapping pin. Ranking matters twice
over; taking spares in header order also put a button on JTAG while three SD
pins sat unused beside it.

IO51 already drives an on-board RGB LED and IO35 is already the BOOT button;
neither is broken out, so both come free.

`baml run pinout` prints the assignment with the concessions marked.

### Known gaps

- **The LED variant's thumb chain still crosses itself** — 9 violations on
  `thumb_l`, 13 on `thumb_r`, all in the chain, none unconnected. The *parts*
  are now placed correctly (that was the mirrored-rotation bug, and it is
  covered by a test); what is left is that the chain router has two shapes,
  along a column and between columns, and a thumb cluster is neither. Its three
  keys are one column each, on an arc, one of them a 1.5u turned 90° to its
  neighbours — so every hop is a "between columns" traverse, and those are
  quoted in each key's own frame, which on this cluster points three different
  ways.

  Several cluster-specific shapes were tried and measured: a bus row under the
  cluster in board coordinates (collapses to nothing where the arc turns
  steeply), and a run parallel to the arc at a fixed radius from each key
  (lands on the hotswap socket of whichever key it passes, since the socket
  reaches 7.7mm out and the gap between keys is 22mm). Both are recorded here
  rather than left in the tree.

  What actually decides it is a placement question: the 1.5u thumb key turned
  90° has no clear side. Either it takes a different LED position from its
  neighbours, or the cluster's keys move. That is a call about the case, not
  about the router.
- **The finger chain's head and tail cross where they leave the connectors** —
  1 violation on `finger_l`, 2 on `finger_r`. Both ends of the chain leave the
  connector stack on the back into the same corridor. Swapping which one takes
  the inner standoff slot was tried and is worse; it wants a proper ordering
  rule rather than a guess.
- **The LED variant runs a 0.2mm copper-to-edge rule.** Not our routing: the
  KiCad `SK6812MINI-E_..._ReverseMount` footprint mills the window the light
  comes up through and puts the LED's own four pads 0.239mm from the edge of
  it. `build.baml` writes a `.kicad_pro` per board carrying the rule; the base
  variant keeps 0.5mm. Worth checking against a fab before ordering.
- **Connector placement is derived, not designed.** A finger half stacks both
  connectors on the edge facing the pod, below the key field, pod link first.
  Below the key field is forced — every column escapes onto one line under the
  lowest key, so the contacts have to be reachable from it — but how far
  outboard they stand still wants deciding against the case. The thumb clusters
  keep the bottom edge: their link runs to the finger board, which is outboard
  of them, so "toward the pod" is the wrong way for a three-key board.
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
