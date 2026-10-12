# Key tiles, wiring and ribbon

**The first prototype uses no custom PCBs:** bought RGB key tiles, a perfboard
pod and generic 24-way 0.5 mm FFC adapters at all four ribbon ends. The ribbon
pinout, the handwiring and the pod circuit below apply to it. The custom
breakout and pod boards, and the custom key tiles, are for a later build (see
[Custom boards](#custom-boards-later-build)).
[Design status](design-status.md) lists the decisions and open questions, and
takes precedence over this document.

## Purchased key tiles for all 36 keys

The first prototype uses the 50-board AliExpress RGB pack (A$43.99 before
any checkout tax, free shipping), bought, for all 36 keys. Connect them by
their signal labels (C, R, G, +, DI, DO).

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

## Handwiring

The chassis editor's **Wiring** panel shows the wiring on the current layout
(see the [editor guide](../editor/README.md#wiring)). Three independent systems
share the tiles; insulate crossings, which are not electrical joins.

1. Each half is a **4 × 5 matrix**: the three finger rows RT, RH and RB, plus
   the thumb row RX, over the five finger columns. Each of the five thumbs sits
   on a finger column: x2 on C0 pinky, near on C1 ring, x1 on C2 middle, home on
   C3 index, far on C4 inner. A thumb's column wire runs to its column's
   adapter pad, not along the finger column, so two wires share each column
   pad.
2. Join each tile's **R** pad to its row and **C** pad to its column. On the
   custom tile: COL → switch → diode anode, diode cathode → ROW (COL2ROW).
3. RGB is a separate serial chain: adapter RGB → first DI; DO → next DI;
   continue through all 20 keys. Leave the final DO unconnected. Start with the
   thumbs, then snake through the columns in alternating directions, to keep
   runs short.
4. All LEDs connect to the same +5 V and GND buses, electrically in parallel.
   The two `+` pads are connected on each tile; the two `G` pads are connected.
   These allow one incoming and one outgoing power wire without a splice.
5. The Cirque trackpad has its own 12-way FFC to the pod and does not use the
   hand ribbon, so pins 14–19 are spare.

### Effort

Per half, with individual jumpers: 10 column links + 16 row links + 14 matrix
feeds (one per finger column, one per finger row, one for RX, and one per
thumb) = 40 matrix wires; 19 RGB links + one feed = 20 data wires; two buses
with 19 links + one feed each = 40 power wires. Total **100 wire segments and
200 soldered ends per half**. The editor's **Wiring** panel lists them with
provisional cut lengths (about 5.9 m per half, including a 40 mm service loop
on each feed so the bottom section and its adapter can be lifted off).
Continuous stripped row/column buses can reduce the number of separate pieces.

Use 28–30 AWG for matrix/data and 26 AWG for power. Clamp the harness near the
adapter instead of hanging its weight from solder pads. The tile is rigid: the
*wires*, not the PCB, follow the keywell curvature. Each tile is glued up
against four pads under its plate, so neither the wiring nor its solder joints
hold it in place.

## Ribbon pinout

The pod has the same pin-number contract on each hand connector. Specify a
cable/installation giving pin 1 → pin 1 through pin 24 → pin 24; confirm
contact-side orientation and continuity before power. Do not assume an
arbitrary same-side/opposite-side cable is correct solely from the connector
names. This is a removable interconnect, not a hot-plug design.

| Pin | Function |
|---:|---|
| 1 | GND |
| 2 | RGB data, buffered to 5 V at pod |
| 3 | GND |
| 4, 5, 6 | RT, RH, RB |
| 7, 8, 9, 10, 11 | C0 pinky, C1 ring, C2 middle, C3 index, C4 inner |
| 12 | RX, the thumb row |
| 13 | GND |
| 14–19 | Spare |
| 20 | GND |
| 21, 22, 23 | +5 V LED power, connected in parallel |
| 24 | GND |

Repeated power/ground pins are electrically common; connect the key buses to
convenient ones.

## Pod and power

The RGB data lines use the `rgb` group in [`pod.json`](../pod.json), driven
via an SN74AHCT125 (DIP SN74AHCT125N on the perfboard pod, SOIC
SN74AHCT125D on the custom pod) powered from the LED 5 V rail, with 330-ohm
output resistors, input pulldowns and local decoupling. Unused buffer inputs
are grounded and unused outputs disabled.

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

## Custom boards (later build)

Files are in `output_v4/key-quotes/`. They lag the ribbon pinout above (see
[design status](design-status.md)).

Both custom boards use the same 24-way, 1 mm-pitch, bottom-contact FFC
connector, the JUSHUO AFA07-S24FCA-00 (LCSC-stocked). Breakout wire pads
W1–W24 correspond directly to connector pins. Mounting tabs of the connector
are grounded.

### Uploads to compare

Use two copper layers, 1.6 mm FR4, 1 oz copper, green soldermask and lead-free
HASL for the first comparison. Each ZIP contains Gerbers, plated/nonplated
drills and the job file; upload one ZIP as one order line. Do not upload the
entire directory as one design.

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

### Common boards — additional order lines, not alternatives

| ZIP | Buy | Use | Spare | Function |
|---|---:|---:|---:|---|
| `hand_breakout-gerbers.zip` | 5 | 2 | 3 | Identical ribbon-to-wire breakout for each half |
| `pod_rgb-gerbers.zip` | 5 | 1 | 4 | ESP32-P4 carrier, two ribbons and RGB level shifting |

Thus compare `key option + breakout batch + pod batch + assembly + parts +
shipping + checkout tax`. The pod does not include the plug-in WT9932P4-TINY
module, USB cable, FFC cables, switches, keycaps or chassis.

For these small quantities, compare hand-fitting the common boards against
factory assembly; their extra setup fees can matter more than key assembly.
The pod's module sockets are through-hole parts, unlike the key board's four
underside SMD components.

### Assembly files and limits

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

Regenerate with KiCad's Python: `v4/tools/build_key_quotes.py` (supervised,
bounded router). Optional build arguments: `keys`, `hand_breakout`, `pod_rgb`.

## Sources

- [JLC assembly capabilities](https://jlcpcb.com/capabilities/pcb-assembly-capabilities)
- [JLC assembly charges](https://jlcpcb.com/help/article/pcb-assembly-price)
- [JLC mouse-bite guidance](https://jlcpcb.com/blog/mouse-bite-panelization-guide)
- [JUSHUO AFA07-S24FCA-00 datasheet](https://www.lcsc.com/datasheet/lcsc_datasheet_2304140030_JUSHUO-AFA07-S04FCA-00_C262710.pdf)
- [SK6812MINI-E Rev.02 drawing and pinout](https://cdn-shop.adafruit.com/product-files/4960/4960_SK6812MINI-E_REV02_EN.pdf)
- [TI SN74AHCT125](https://www.ti.com/product/SN74AHCT125)
