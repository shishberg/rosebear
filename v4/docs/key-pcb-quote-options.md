# Individual key PCB quote options

Quote/prototype revision A (2026-09-16), updated 2026-09-26. Files are in
`output_v4/key-quotes/`. This is the current construction for the first
prototype and replaces the paused LED-free `output_v4/seeded/` finger/thumb
boards. Do not mix the old 11-way ribbons with this 24-way design.

**The first prototype uses no custom PCBs:** a perfboard pod and generic
24-way 0.5 mm FFC adapters at all four ribbon ends. The ribbon pinout, the
handwiring and the pod circuit below still apply. The custom breakout and pod
boards are kept for a later build once the pinout settles.
[Design status](design-status.md) lists the decisions and open questions, and
takes precedence over this document.

## Purchased key tiles for all 36 keys

The first prototype uses the 50-board AliExpress RGB pack (A$43.99 before
any checkout tax, free shipping), bought, for all 36 keys. The custom-key ZIPs
are retained as a fallback. The pod and common breakout architecture still apply,
but connect purchased boards by their verified signal labels, not by the
custom tile's W1-W8 physical pad positions.

The listing's selected variant is **RGB diode R2C**. That suggests ROW2COL
polarity, whereas the custom PCB below is COL2ROW. Confirm the purchased diode
orientation with a multimeter and configure firmware accordingly; the same
row/column harness topology works in either direction. The RGB part and exact
power demand remain unidentified. Test a short column at the intended supply
and wiring length before assembling the full harness.

Open: whether the tiles need extra decoupling. Test a short column first and
add one hand-wired ceramic capacitor per column (12 total) only if testing
shows it helps; the value is not chosen. This is not equivalent to LED-local
decoupling.

## Physical handwiring layout

Open **handwiring-layout.html** for the physical underside layout with independent
row, column, LED data, power, ground and trackball layers. The matrix-only and
lighting-only buttons make it easier to trace individual paths. Static copies:
**handwiring-layout-plan.svg** and **handwiring-layout-tilted.svg**.
The earlier **handwiring.svg** remains the logical connectivity reference.

Key positions and orientations come from `output_v4/layout-chassis.json`, including
the flat thumb revision. Tile envelopes are nominal 19 mm; socket/LED bodies and
terminal zones are approximate representations of the purchased tiles, not a
confirmed pinout. This is a harness planning study, not a cut-length list or
chassis clearance validation. The tilted view changes the key projection to
expose depth; accessory envelopes remain fixed for comparison.

The 36 × 33 mm hand breakout is proposed in the palm-side space below the fingers;
the 22 × 28 mm purchased trackball breakout is proposed beside the thumbs. Neither
accessory mount has been incorporated into or checked against the chassis here.
The ribbon exits toward the palm and the separately housed central pod.

Main assembly concerns:

- **Breakout:** 12 key-harness leads plus seven trackball leads on the right.
  Leave it removable for soldering, keep leads clear of the FFC latch, and
  provide a chassis loom clamp. The drawn fan-out needs final dressing around
  the connector, not wires stretched over it.
- **Thumb transition:** seven conductors (three rows, thumb column, LED data,
  5 V and ground). Leave a service loop and secure both ends to the chassis.
- **Finger gaps:** row buses cross column/data/power wiring. Use insulated wire;
  line crossings in the drawing are not electrical junctions. Power terminals
  typically take both incoming and outgoing wires; confirm the bought pads can
  accommodate the chosen wire before cutting the whole loom.
- **Trackball:** the pointing device is open (a Cirque TM040040 trackpad is
  likely), so this loom is a placeholder. Its seven-wire loom follows the outer thumb edge, clear of the
  thumb key bodies, then returns to the breakout. Connector/pad locations on the
  bought trackball are still provisional.
- **Access:** solder and test small subassemblies before closing the chassis.
  Provide wiring space below the sockets and independently support every tile;
  neither wire tension nor solder joints should hold keys in place.

The drawing accounts for 90 wire segments per half (18 row, 18 column, 18 LED
data, 18 power and 18 ground), plus seven right-hand trackball leads. Continuous
stripped buses can reduce the number of cut pieces. It shows one right half;
the left uses mirrored key positions without trackball wiring. Purchased PCBs
are identical rather than mirrored, so check their physical terminal orientation
when placing the left set.

Regenerate with `python3 v4/tools/draw_key_wiring_layout.py`; no KiCad process or
autorouter is involved.

## Uploads to compare

Use two copper layers, 1.6 mm FR4, 1 oz copper, green soldermask and lead-free
HASL for the first comparison. There are no flex materials or stiffeners.
Each ZIP contains Gerbers, plated/nonplated drills and the job file; upload
one ZIP as one order line. Do not upload the entire directory as one design.

| ZIP | Quantity to quote | Delivery format | Keys supplied | Keys used / spare |
|---|---:|---|---:|---:|
| `key_single-gerbers.zip` | 50 | Single PCB | 50 | 36 / 14 |
| `key_panel_8-gerbers.zip` | 5 | Panel by customer, 4 x 2 | 40 | 36 / 4 |
| `key_panel_9-gerbers.zip` | 5 | Panel by customer, 3 x 3 | 45 | 36 / 9 |
| `key_panel_10-gerbers.zip` | 5 | Panel by customer, 5 x 2 | 50 | 36 / 14 |

The tile is 19 x 19 mm. The 8-, 9- and 10-key panels are 96 x 54,
75 x 75 and 117 x 54 mm respectively, including rails. The nine-key panel is
the first one to quote: both dimensions fit the usual 100 mm price boundary
and also exceed Standard assembly's 70 mm minimum. The ten-key panel gives
an equal-quantity comparison against 50 singles, but exceeds 100 mm.

The panels contain **one repeated design**, electrically isolated between
tiles. Declare one different design. They use drilled breakaway tabs (mouse
bites), not V-scoring. Request delivery still panelized. Tab remnants need
trimming after separation; support the tile while separating it.

Quote each key option both bare and with Economic assembly of all four
components per key. Panel quantities are panel counts, not individual-key
counts. If the service offers fewer assembled panels than fabricated panels,
four nine-key panels would populate exactly 36 keys, leaving one bare panel;
compare that only if the checkout supports that assembled quantity.

## Common boards — additional order lines, not alternatives

| ZIP | Buy | Use | Spare | Function |
|---|---:|---:|---:|---|
| `hand_breakout-gerbers.zip` | 5 | 2 | 3 | Identical ribbon-to-wire breakout for each half |
| `pod_rgb-gerbers.zip` | 5 | 1 | 4 | ESP32-P4 carrier, two ribbons and RGB level shifting |

Thus compare `key option + breakout batch + pod batch + assembly + parts +
shipping + checkout tax`. The pod does not include the plug-in WT9932P4-TINY
module, USB cable, FFC cables, switches, keycaps, chassis or purchased trackball.
No separate finger or thumb PCBs are required with individual key tiles.

For these small quantities, compare hand-fitting the common boards against
factory assembly; their extra setup fees can matter more than key assembly.
The pod's module sockets are through-hole parts, unlike the key board's four underside SMD components.

## Assembly files and limits

Each board folder has `bom.csv`, `positions.csv`, native KiCad files and a
`layout.svg`. The CSVs use JLC's BOM and placement column names. Each panel
has unique component references and a BOM covering every tile in that panel.
For the key boards, all four components are on the underside. The pod has
components on both sides, so quote **Standard/double-sided** assembly for a
fully assembled pod, or fit its few parts by hand. The breakout's only
component is its front SMD ribbon connector.

Wire holes, perforation holes, mounting holes and fiducials are not components
to buy. Each key has a CPG151101S11-compatible MX hotswap socket, 1N4148W
SOD-123 diode, reverse-mount SK6812MINI-E LED and 0805 100 nF/16 V X7R capacitor.

**These are quote files, not an approved assembly order.** The LCSC-number
column is intentionally blank: select actual stocked parts against the stated
packages; no unverified catalogue match is silently substituted. In particular,
the LED footprint follows the 3.2 x 2.8 mm SK6812MINI-E Rev.02 drawing. Similar
names are used for different LED packages/revisions. Require the matching
drawing, pinout and electrical limits before approving assembly.

The socket placement coordinates use an estimated body centre offset from
the switch stem centre (-0.635, -3.81 mm). It is an underside component even
though the compound switch footprint originates on the front of the PCB.
Confirm socket and LED rotation/side in the vendor placement preview. BOM/CPL
enable assembly quoting, but do not remove this placement-review step.

DRC checks copper, clearances, outline and connectivity. It does not prove
socket pickup orientation, factory assembly acceptance, panel tab strength,
physical chassis fit, or signal integrity over the chosen cable length.

## Handwiring

Open `handwiring.svg` beside this document. It separates three independent
systems so that crossed wires are not mistaken for electrical connections.
Dots indicate joins; undotted crossings are not joined.

1. Each half is a **4 × 5 matrix**: the three finger rows RT, RH and RB, plus
   the thumb row RX, over the five finger columns. Each of the five thumbs sits
   on a finger column: x2 on C0 pinky, near on C1 ring, x1 on C2 middle, home on
   C3 index, far on C4 inner. A thumb's column wire runs to its column's
   breakout pad, not along the finger column, so two wires share each column
   pad. (Earlier revisions had three thumbs as a sixth column, C5.)
2. Join each tile's **R** pad to its row bus and **C** pad to its column bus.
   On the PCB: COL → switch → diode anode, diode cathode → ROW. Use COL2ROW
   matrix scanning. The thumb boards can be physically rotated independently.
3. RGB is a separate serial chain: breakout RGB → first DI; DO → next DI;
   continue through all 20 keys. Leave the final DO unconnected. Start with the
   thumbs, then snake through the columns in alternating directions, to keep
   runs short.
4. All LEDs connect to the same +5 V and GND buses, electrically in parallel.
   The two `+` pads are connected on each tile; the two `G` pads are connected.
   These allow one incoming and one outgoing power wire without a splice.
5. The Cirque trackpad has its own 12-way FFC to the pod and does not use the
   hand ribbon, so pins 14–19 are spare.

### Effort and physical feasibility

Per half, with individual jumpers: 10 column links + 16 row links + 14 matrix
feeds (one per finger column, one per finger row, one for RX, and one per
thumb) = 40 matrix wires; 19 RGB links + one feed = 20 data wires; two buses
with 19 links + one feed each = 40 power wires. Total **100 wire segments and
200 soldered ends per half**. The chassis editor's **Wiring** panel lists them
with provisional cut lengths (about 6.4 m per half, including a 40 mm service
loop on each feed so the bottom plate and its adapter can be lifted off).
Continuous stripped row/column buses can reduce the number of separate pieces.

The 1 mm wire holes can be used for thin insulated matrix/data wire; check
that two conductors fit comfortably where a row or column loops through one
pad. Start with 28–30 AWG for matrix/data and 26 AWG for power buses. Wire
length depends on the final chassis. Keep small service loops, insulate
crossings, and clamp the harness near each breakout instead of hanging its
weight from solder pads. The tile is rigid: the *wires*, not the PCB, follow
the keywell curvature. Each socket needs a supporting seat/retainer in the
chassis; neither wiring nor its solder joints retain the key PCB.

This is a connectivity sketch, not proof of chassis clearance. Key-to-key
spacing, rear component/wire clearance, breakaway-tab trimming and access to
the ribbon latch still need a fit prototype.

## Ribbon pinout

Both breakout boards use the same 24-way, 1 mm-pitch, bottom-contact FFC
connector, the JUSHUO AFA07-S24FCA-00 (LCSC-stocked; it replaced the Molex
2005280240, whose minimum order is 9,000). The pod has the same pin-number contract on each
hand connector. Specify a cable/installation giving pin 1 → pin 1 through
pin 24 → pin 24; confirm contact-side orientation and continuity before power.
Do not assume an arbitrary same-side/opposite-side cable is correct solely
from the connector names. This is a removable interconnect, not a hot-plug design.

| Pin | Breakout label/function |
|---:|---|
| 1 | GND |
| 2 | RGB data, buffered to 5 V at pod |
| 3 | GND |
| 4, 5, 6 | RT, RH, RB |
| 7, 8, 9, 10, 11 | C0 pinky, C1 ring, C2 middle, C3 index, C4 inner |
| 12 | RX, the thumb row (was C5) |
| 13 | GND |
| 14–19 | Spare. They were the trackball's 3V3 and signals; the Cirque trackpad now has its own cable to the pod |
| 20 | GND |
| 21, 22, 23 | +5 V LED power, connected in parallel |
| 24 | GND |

Breakout wire pads W1–W24 correspond directly to connector pins. Repeated
power/ground pads are electrically common; connect the key bus and trackball
ground to convenient labelled pads. Mounting tabs of the connector are grounded.

## Pod and power

The pod keeps the main build's WT9932P4-TINY header assignments for matrix,
buttons and trackball (see `output_v4/pinout.txt`). The RGB data lines use the
`rgb` group in [`pod.json`](../pod.json), driven via an SN74AHCT125D powered
from the LED 5 V rail, with 330-ohm output resistors, input pulldowns and local
decoupling. Unused buffer inputs are grounded and unused outputs disabled.

**Decided: LED power comes from the module's 5 V header pin (J_R pin 27),**
which is fed from USB after the module's own power path (Q1/Q2 from USB1,
D4 from USB2 on the module schematic), so drawing from it does not backfeed
anything. The keyboard runs from one USB cable with no separate supply.
The pin is the `+5V` entry in the `rgb` group of [`pod.json`](../pod.json);
there is no separate LED power input.

The whole keyboard must fit a laptop USB port; if it does not, cut features
rather than add power. The module takes roughly 100–150 mA at 5 V, leaving
about **300 mA for all 36 LEDs** on a 500 mA USB 2.0 port. Firmware must cap
brightness to that. Full white is roughly 2.2 A, so the cap is always active.
The exact cap depends on the tile LED part, which is unidentified.
The ribbon has three parallel 5 V conductors and five grounds. Connector
contact ratings alone do not establish the cable rating; select cable length,
conductor cross-section and current rating accordingly and check voltage at
the farthest key.

## Sources

- [JLC assembly capabilities](https://jlcpcb.com/capabilities/pcb-assembly-capabilities)
- [JLC assembly charges](https://jlcpcb.com/help/article/pcb-assembly-price)
- [JLC mouse-bite guidance](https://jlcpcb.com/blog/mouse-bite-panelization-guide)
- [JUSHUO AFA07-S24FCA-00 datasheet](https://www.lcsc.com/datasheet/lcsc_datasheet_2304140030_JUSHUO-AFA07-S04FCA-00_C262710.pdf)
- [SK6812MINI-E Rev.02 drawing and pinout](https://cdn-shop.adafruit.com/product-files/4960/4960_SK6812MINI-E_REV02_EN.pdf)
- [TI SN74AHCT125](https://www.ti.com/product/SN74AHCT125)

Regenerate with KiCad's Python: `v4/tools/build_key_quotes.py` (supervised,
bounded router), then `python3 v4/tools/draw_key_wiring.py`. Optional build
arguments: `keys`, `hand_breakout`, `pod_rgb`.
