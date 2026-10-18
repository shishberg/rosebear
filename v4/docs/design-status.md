# Design status: decisions and open questions

The current state of the v4 design. When another doc disagrees with this one, this one is correct, and the other doc needs fixing. Update this file whenever a decision is made or a new question comes up.

The first prototype needs no custom PCB order. The generated breakout and pod boards in `output_v4/key-quotes/` match the decisions below and are kept for a later, tidier build.

## Construction

The first prototype uses **individual 1U key tiles for all 36 keys**, bought as the 50-board AliExpress RGB pack (per-key RGB LED, hotswap socket, diode). Each half is hand-wired to a generic 24-way 0.5 mm **FFC adapter** board, and FFC ribbons connect the hands to the central **pod**: a perfboard carrying the WT9932P4-TINY (ESP32-P4), the level shifter, and two more of the same adapters. The chassis is edited in the [browser editor](../editor/README.md).

Paused, kept as reference: the flex finger boards, flat thumb PCBs, LED-free pod and custom trackball board built by `make v4` into `output_v4/seeded/`. See the [v4 README](../README.md) for that pipeline. [Key PCB quote options](key-pcb-quote-options.md) describes the tiles, the ribbon pinout, the wiring and the custom breakout and pod boards for the later build.

## Decided

| Decision | Detail |
|---|---|
| Key tiles for all 36 keys | Bought RGB tiles. The custom tile Gerbers remain as a fallback. |
| The bought tile, measured | 17 × 17 mm, 1.6 mm thick, with a round notch of about 1.5 mm radius at each corner. MX switch, Kailh MX hotswap socket underneath. Below the board face: socket 1.9 mm, LED 1.1 mm, diode 0.8 mm, so the tile pocket reaches 8.8 mm below the plate top (5 mm to the board, the board, the socket and 0.3 mm clearance). Positions and sizes, to about ±0.3 mm, are in the editor's `tile` config: in the key's frame, from the stem centre seen from the switch side, y towards the socket edge. |
| Tile pads and holes | Through holes near the side edges: two C, two R, in and out (the in/out side), and V and G nearer the LED. Each hole takes one wire: a 22 AWG wire fits, two don't. On the parts side, in, out, V and G also have a pad on each of the socket and LED edges. A spare C hole and a spare R hole sit under the socket. Joined on the tile: both C holes, the spare C and the diode's cathode; both R holes, the spare R and one socket contact; the other socket contact to the diode's anode; each of in, out, V and G with its hole, both its edge pads and its LED lead. Matrix to LED nets is open, and so is V to G: the tiles have no capacitor. |
| Tile wiring: one wire per hole | A row or column wire arrives at one of a tile's two R (or C) holes and the next leaves from the other. +5 V and GND use the V (or G) hole and the LED-edge pad. LED data arrives at the in hole and leaves from the out hole. The editor routes the wires this way. |
| Tile diode direction: ROW2COL | Measured: R → switch → diode → C, the diode's cathode on C. Firmware scans `row2col`. (The custom tile is COL2ROW.) No v4 firmware config lives in this repo yet. |
| Tile LED pin order | SK6812MINI-E order: DIN top-left, VDD top-right, DOUT bottom-right, GND bottom-left. |
| Per-key RGB is back in | Supersedes the 2026-09-16 LED removal, which applied to the seeded boards. |
| LED power from the module's 5V pin | USB-powered through the WT9932P4-TINY header 5V pin (J_R pin 27), which sits after the module's USB power path (Q1/Q2 and D4 on its schematic). No separate LED supply. `pod.json` lists it as `+5V` in the `rgb` group. |
| Total draw must fit a laptop USB port | If the design needs more than a laptop's USB port provides, cut features rather than add power. The ESP32-P4 module takes roughly 100–150 mA at 5V (datasheet Table 5-7, about 65–125 mA at 3.3V at 360 MHz with peripherals, plus USB PHY and on-module LEDs, through the module's DC-DC). On a 500 mA USB 2.0 port that leaves about 300 mA for LEDs, enforced by a firmware brightness cap. |
| FFC ribbon from each hand to the pod | The ribbon plugs into proper connectors at both ends, so no loose wires pull on solder joints. The hands and the pod can be assembled separately and plugged together. The pinout is unchanged (see [key PCB quote options](key-pcb-quote-options.md#ribbon-pinout)). |
| First prototype: perfboard pod and generic FFC adapters, no custom PCBs | A custom PCB order has the longest turnaround and can't be changed once made, while the pod wiring will still change (for example if the Cirque replaces the trackball). The pod is a perfboard with the module in 2.54 mm sockets. Any AliExpress FFC breakout works if it is 0.5 mm pitch and has at least 24 ways; buy four of the same one, so the contact side only has to be worked out once. The custom breakout and pod stay as the later version once the pinout settles. |
| 0.5 mm pitch ribbon for the prototype | A 24-way 0.5 mm cable is about 13 mm wide instead of 25 mm, leaving more room to adjust the angle between the hands and the pod. Current is fine: each hand draws at most about 150 mA of LED current over three 5V conductors, about 50 mA each against a typical 0.5 A rating, with about 50 mV drop over 30 cm. The custom boards still use 1.0 mm; revisit that when they are built. |
| No capacitors on the hand side | No bulk capacitor: the 470 µF per breakout came from the separate-supply design and would put about 940 µF on USB 5V at plug-in (the USB spec allows 10 µF). No hand-wired ceramic per column either: at about 150 mA per half the tiles run without them. The pod's 100 nF across the level shifter stays. |
| Keep the SN74AHCT125 level shifter | Shifts the two 3.3V RGB data lines to 5V for the LEDs. The perfboard pod uses the DIP SN74AHCT125N; the custom pod uses the SOIC SN74AHCT125D. Keep the 330 Ω series resistors, 100k pulldowns and 100 nF decoupling. |
| Pod pin map lives in `v4/pod.json` | The only hand-edited pin map. See the README's pod pin map section. |
| FFC connector on the custom boards: JUSHUO AFA07-S24FCA-00 | Replaces the Molex 200528-0240 (minimum order 9,000). 24-way, 1.0 mm pitch, bottom contact, stock KiCad footprint, stocked at LCSC. Body about 31 mm wide and 2.5 mm tall. Pin 1 is on the same side as the Molex, so the ribbon pinout is unchanged. The breakout grew to 36 × 33 mm to fit its longer pads. |
| Chassis: C64-styled case | Chosen from the shape prototypes (variant `c64-joined-badge`; the prototype is at commit 4554010, and the other 22 variants at 5246f41). A Commodore 64 style breadbin: the finger keys in one well, the thumb row's deck carried on in front as part of the same solid, a grill and badge across the back, and a parting line all round. Below the parting line is the bottom section, a separate print carrying the adapter. In each well the plates make one sheet, reaching out to the well's wall. The [editor](../editor/README.md) generates it from the key layout. It replaces the swept Skeletyl construction. |
| Tiles are glued under the plates | The tile rests and bridges of the Skeletyl construction don't fit the C64 case's wells. Each tile is glued up against pads under its plate's corners, which set its height. The glue takes the push of a switch going into its hotswap socket. Whether to glue is decided at build time. If glued, the tile's rim is 1.5 mm, with the notched corners and six holes in it; the plate's underside sits 2 mm above the tile. The editor's glue pads keep off the notches and the holes. Outside the 15.8 mm switch seat, which they keep clear, only 0.5 mm of the 17 mm tile's rim is left for them. |
| Each hand is a 4 × 5 matrix | The finger rows RT, RH and RB plus the thumb row RX, over the five finger columns. Each thumb sits on a finger column (x2 C0, near C1, x1 C2, home C3, far C4) and its column wire runs to that column's adapter pad. Ribbon pin 12, formerly C5, carries RX. See [key PCB quote options](key-pcb-quote-options.md#handwiring). |
| Adapter on the bottom section, ribbon out the port panel | The hand's FFC adapter sits on pegs on the case's bottom section, under the finger well's inner end. The ribbon makes a half loop from the connector, is cable-tied to a landing, and leaves through a slot in the port panel on the inner end. Each feed wire to the adapter has a 40 mm service loop (spare slack wire), so the bottom section can be lifted off without pulling on solder joints. Positions and sizes are provisional until the adapter is bought. |
| Pointing-device overlay, if Cirque | Flat overlay with a raised rim or ridge to find it by feel, not a dished one. |

## Open

| Question | Notes |
|---|---|
| Pointing device | Leaning strongly towards a Cirque TM040040 trackpad (I2C) in place of the BlackBerry-style trackball, which gums up. Not final. Switching means a `cirque` group in `pod.json`, a housing and overlay design. The TM040040 has its own 12-pin 0.5 mm FFC connector, so it can plug straight into the pod wherever it is mounted, and placements can be tried without rebuilding the chassis. The editor's chassis has no mount for it; if chosen, it needs a place on the C64 case. |
| Pod microcontroller | The FFC ribbons make the pod replaceable: any pod that provides the ribbon pinout works. The ESP32-P4 is more than a keyboard needs; it may stay only for collecting keypress data for the modtap prediction model. A later pod could use an RP2040 (26 GPIO: 18 matrix + 2 RGB + 3 Cirque fits; 3.3V logic, so it keeps the level shifter; 264 KB RAM is enough for a small quantised model) or an ATmega32U4 (18 GPIO, so the two hands' C0–C5 must be joined on the pod into a 6 × 6 matrix; 5V logic, no level shifter; 2.5 KB RAM limits prediction to something like logistic regression or a small decision tree). For the model to move between chips, its features should be key timestamps, not anything specific to the P4. |
| Adapter size | The editor models the adapter from provisional sizes: 26 × 36 mm with 2 × 12 holes and a 16 mm connector. Measure the bought adapter and update the editor's config; its checks then show whether the mount, landing and wires still fit. (The tiles are measured; see above. The custom breakout is 36 × 33 mm with a connector about 31 mm wide and 2.5 mm tall.) |
| Pod and firmware matrix | Ribbon pin 12 is now a row (RX), not a column. The pod pin map and firmware matrix need updating to scan 4 rows × 5 columns per hand, `row2col`. |
| FFC cable length and contact type | Length depends on pod placement. With the same adapter at both ends, choose same-side or opposite-side contacts so pin 1 meets pin 1. |

## Bring-up

Checks on the bench with the first wired hand, not design questions.

| Check | Notes |
|---|---|
| Tile LED part | Unidentified, but wired in SK6812MINI-E pin order. Its data threshold and current per LED set the real brightness cap. Test a short column at the intended wire length. |
| No per-column capacitors | Decided: none on the hands (above), and the tiles have none (V to G measured open). Check the LEDs at the far end of each chain at the firmware's brightness cap. |
