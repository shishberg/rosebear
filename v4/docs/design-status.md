# Design status: decisions and open questions

The current state of the v4 design. When another doc disagrees with this one, this one is correct, and the other doc needs fixing. Update this file whenever a decision is made or a new question comes up.

The first prototype needs no custom PCB order. The generated breakout and pod boards in `output_v4/key-quotes/` are kept for a later, tidier build. They lag the decisions below: they still label ribbon pin 12 C5 and pins 14–19 as trackball signals (`RIBBON` in `v4/tools/build_key_quotes.py`).

## Construction

The first prototype uses **individual 1U key tiles for all 36 keys**, bought as the 50-board AliExpress RGB pack (per-key RGB LED, hotswap socket, diode). Each half is hand-wired to a generic 24-way 0.5 mm **FFC adapter** board, and FFC ribbons connect the hands to the central **pod**: a perfboard carrying the WT9932P4-TINY (ESP32-P4), the level shifter, and two more of the same adapters. The chassis is edited in the [browser editor](../editor/README.md).

[Key PCB quote options](key-pcb-quote-options.md) describes the tiles, the ribbon pinout, the wiring and the custom breakout and pod boards for the later build.

## Decided

| Decision | Detail |
|---|---|
| Key tiles for all 36 keys | Bought RGB tiles. The custom tile Gerbers remain as a fallback. |
| LED power from the module's 5V pin | USB-powered through the WT9932P4-TINY header 5V pin (J_R pin 27), which sits after the module's USB power path (Q1/Q2 and D4 on its schematic). No separate LED supply. `pod.json` lists it as `+5V` in the `rgb` group. |
| Total draw must fit a laptop USB port | If the design needs more than a laptop's USB port provides, cut features rather than add power. The ESP32-P4 module takes roughly 100–150 mA at 5V (datasheet Table 5-7, about 65–125 mA at 3.3V at 360 MHz with peripherals, plus USB PHY and on-module LEDs, through the module's DC-DC). On a 500 mA USB 2.0 port that leaves about 300 mA for LEDs, enforced by a firmware brightness cap. |
| FFC ribbon from each hand to the pod | The ribbon plugs into proper connectors at both ends, so no loose wires pull on solder joints. The hands and the pod can be assembled separately and plugged together. The pinout is unchanged (see [key PCB quote options](key-pcb-quote-options.md#ribbon-pinout)). |
| First prototype: perfboard pod and generic FFC adapters, no custom PCBs | A custom PCB order has the longest turnaround and can't be changed once made, while the pod wiring will still change (for example if the Cirque replaces the trackball). The pod is a perfboard with the module in 2.54 mm sockets. Any AliExpress FFC breakout works if it is 0.5 mm pitch and has at least 24 ways; buy four of the same one, so the contact side only has to be worked out once. The custom breakout and pod stay as the later version once the pinout settles. |
| 0.5 mm pitch ribbon for the prototype | A 24-way 0.5 mm cable is about 13 mm wide instead of 25 mm, leaving more room to adjust the angle between the hands and the pod. Current is fine: each hand draws at most about 150 mA of LED current over three 5V conductors, about 50 mA each against a typical 0.5 A rating, with about 50 mV drop over 30 cm. The custom boards still use 1.0 mm; revisit that when they are built. |
| No bulk capacitor on the hand side | A 470 µF capacitor per breakout would put about 940 µF on USB 5V at plug-in (the USB spec allows 10 µF). Any LED decoupling belongs near the LEDs: see the per-column capacitor question. |
| Keep the SN74AHCT125 level shifter | Shifts the two 3.3V RGB data lines to 5V for the LEDs. The perfboard pod uses the DIP SN74AHCT125N; the custom pod uses the SOIC SN74AHCT125D. Keep the 330 Ω series resistors, 100k pulldowns and 100 nF decoupling. |
| Pod pin map lives in `v4/pod.json` | The only hand-edited pin map. See the README's pod pin map section. |
| FFC connector on the custom boards: JUSHUO AFA07-S24FCA-00 | 24-way, 1.0 mm pitch, bottom contact, stock KiCad footprint, stocked at LCSC. Body about 31 mm wide and 2.5 mm tall. The custom breakout is 36 × 33 mm. |
| Chassis: C64-styled case | A Commodore 64 style breadbin, generated from the key layout by the [editor](../editor/README.md). The default is the tape-deck prototype: the finger keys in a turned bin with a plane deck, a six-groove grill and badge, the thumbs in a block in front like the C64's tape deck, and a parting line all round. The bottom section, a separate print, is the case's shell below the parting line and carries the adapter. The keys stand on a faceted floor: one sheet in the finger well running out to its wall, squares and strips under the main thumbs. Other case shapes are prototypes selected with `?box=`. |
| Tiles are glued under the plates | Each tile is glued up against four L-shaped pads under its plate's corners, which set its height. The glue takes the push of a switch going into its hotswap socket. |
| Each hand is a 4 × 5 matrix | The finger rows RT, RH and RB plus the thumb row RX, over the five finger columns. Each thumb sits on a finger column (x2 C0, near C1, x1 C2, home C3, far C4) and its column wire runs to that column's adapter pad. Ribbon pin 12 carries RX. See [key PCB quote options](key-pcb-quote-options.md#handwiring). |
| Adapter on the bottom section, ribbon out the port panel | The hand's FFC adapter sits on pegs on the case's bottom section, under the finger well's inner end. The ribbon makes a half loop from the connector, is cable-tied to a landing, and leaves through a slot in the port panel on the inner end. Each feed wire to the adapter has a 40 mm service loop (spare slack wire), so the bottom section can be lifted off without pulling on solder joints. Positions and sizes are provisional until the adapter is bought. |
| Pointing-device overlay, if Cirque | Flat overlay with a raised rim or ridge to find it by feel, not a dished one. |

## Open

| Question | Notes |
|---|---|
| Pointing device | Leaning strongly towards a Cirque TM040040 trackpad (I2C) in place of the BlackBerry-style trackball, which gums up. Not final. Switching means a `cirque` group in `pod.json`, a housing and overlay design. The TM040040 has its own 12-pin 0.5 mm FFC connector, so it can plug straight into the pod wherever it is mounted, and placements can be tried without rebuilding the chassis. The editor's chassis has no mount for it; if chosen, it needs a place on the C64 case. |
| Pod microcontroller | The FFC ribbons make the pod replaceable: any pod that provides the ribbon pinout works. The ESP32-P4 is more than a keyboard needs; it may stay only for collecting keypress data for the modtap prediction model. A later pod could use an RP2040 (26 GPIO: 18 matrix + 2 RGB + 3 Cirque fits; 3.3V logic, so it keeps the level shifter; 264 KB RAM is enough for a small quantised model) or an ATmega32U4 (18 GPIO, so the two hands' C0–C5 must be joined on the pod into a 6 × 6 matrix; 5V logic, no level shifter; 2.5 KB RAM limits prediction to something like logistic regression or a small decision tree). For the model to move between chips, its features should be key timestamps, not anything specific to the P4. |
| Adapter and tile pad sizes | The editor models the wiring from provisional sizes: a 26 × 36 mm adapter with 2 × 12 holes and a 16 mm connector, and tile pads read from a photo. Measure the bought adapter and tiles and update the editor's config; its checks then show whether the mount, landing, wires and soldering access still fit. (The custom breakout is 36 × 33 mm with a connector about 31 mm wide and 2.5 mm tall.) |
| Pod and firmware matrix | Ribbon pin 12 is a row (RX). The pod pin map and firmware matrix need updating to scan 4 rows × 5 columns per hand. |
| FFC cable length and contact type | Length depends on pod placement. With the same adapter at both ends, choose same-side or opposite-side contacts so pin 1 meets pin 1. |
| Per-column capacitors on the tiles | Test a short column of tiles first; add one hand-wired ceramic capacitor per column (12 total) only if testing shows it helps. Value not chosen. |
| Tile diode direction | The listing's variant is "RGB diode R2C", suggesting ROW2COL, while the custom tile is COL2ROW. Measure with a multimeter and set firmware to match. |
| Tile LED part | Unidentified. Its data threshold and current per LED set the real brightness cap. Test a short column at the intended wire length. |
