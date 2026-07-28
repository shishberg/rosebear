# v2 concept: ESP32-P4 pod + passive modules

Design sketch from a brainstorm that started as a GPT-autocomplete keyboard
(see `mezzacomic/docs/keyboard-v2-esp32p4.md` for the model/compute side and
the autocomplete interaction sketch) and turned into a physical architecture.
This is a **different path entirely** from `v2.md` (which was the tail end of
an earlier brainstorm) — see "Relation to v2.md" below.

## Concept

One smart **pod** in the middle; everything else is passive copper.

- **Pod:** ESP32-P4 dev board + OLED + status LED + the model. Free-floating,
  placed wherever gaze wants — solves OLED centrality without a unibody.
- **2× finger cluster:** 15 keys each, fully passive PCB (switches only, no
  diodes, no components).
- **2× thumb cluster:** 3 keys each, passive, **daisy-chained off its finger
  board** (short ~10cm ribbon hop) so it can be angled independently without a
  home run to the pod.
- **Ribbons:** FFC. Pod→finger 20-way each (15 finger + 3 thumb pass-through +
  ground + spare); finger→thumb 4-way.

5 boards, 4 ribbons. Rare but not extreme: commercial boards can't ship this
(cable management, support burden); as a personal ergogen project it's the
"adjust everything until it's right, then it's one firmware" design. Every
module is independently reprintable — new thumb angle = one small case.

## Platform: WT9932P4-TINY

ESP32-P4: dual RISC-V @ 400MHz, FPU, PIE 128-bit SIMD (int8-friendly), 768KB
SRAM, two USB OTG controllers. The WT9932P4-TINY board specifically: both USB
controllers on real Type-C connectors, 16MB flash / 32MB PSRAM, RGB LED,
boot/reset, ~50 GPIO, 69×28mm, none of the C6/ethernet/camera baggage of other
P4 dev boards.

16MB flash is not the model-size constraint — generation is
memory-bandwidth-bound (every token reads every weight; PSRAM ≈100–200MB/s, so
a 15MB int8 model caps around ~10 tok/s regardless of SIMD). A model sized for
snappy autocomplete is well under 16MB.

Verify on schematic before ordering (for the MITM/host use of the second
port): VBUS routing *out* of the host-side port, and Rp CC pull-ups for host
role (moot with a USB-A keyboard + adapter).

## Direct-wired, not matrix

36 keys, ~50 GPIO — the only argument for a matrix is pin scarcity, which
doesn't exist here.

- Passive boards stay *actually* passive (matrix puts a diode per key back on
  every module).
- 20-way vs 9-way FFC is the same cable family and price class.
- No driven scan edges crossing ribbons; per-pin interrupts instead of a scan
  loop; trivial wake-on-any-key — pleasant when the CPU's day job is
  inference.
- NKRO by construction, firmware is "read 36 inputs".
- RMK supports direct-pin scanning.

Escape hatch: a future module that busts the GPIO budget (numpad, per-key RGB)
gets a matrix *on that module only*; nothing here forecloses it.

## Ribbons: interference and protection

Switch lines are quasi-DC — no length limit at desk scale (30–50cm fine). The
one real mechanism is noise pickup on high-impedance open-switch lines.
Layered defenses, in order of need:

1. Firmware debounce (RMK default: integrating, 20ms) — a glitch must
   persist milliseconds to register. Eats nearly everything.
2. Ground conductor per ribbon.
3. External 4.7–10kΩ pull-ups at the pod (internal ≈45kΩ) — colocate with the
   ESD resistors.

**ESD is the bigger real risk:** 36 unbuffered MCU pins on human-adjacent
connectors. Series ~100Ω on every line at the pod, TVS on ribbon headers —
pennies, non-optional.

**Keep fast signals off the ribbons.** OLED (I2C) and LED live on the pod, so
nothing with µs edges runs alongside high-Z switch lines. If a future rev
wants per-cluster LEDs, that data line gets its own grounded neighbor.

## Geometry and tenting

Get splay/angles right first **as though it's a unibody** — the ribbons are
not a tenting mechanism. No torque on connectors; tenting is only rotation in
the axis of the connector. 20-way and 10-way ribbons sit differently on the
desk and twist differently; the design assumes neither is asked to twist.

## Relation to v2.md

`v2.md`'s dual-mode design (BLE portable mode, nRF52840 per half, battery,
hardware-gated LED rail) is a different path from a different session, and
this design deliberately doesn't attempt it:

- ESP32-P4 has no radio (hence all the dev boards pairing it with an
  ESP32-C6). Wireless would mean a companion chip via ESP-Hosted.
- Passive modules preclude BLE split entirely — there's nothing on the far
  side to radio with.
- **Ruling: wired-only is fine.** This thing runs a 400MHz dual-core doing
  continuous inference; it was never a battery keyboard anyway.
- Per-key RGB (v2.md home mode) conflicts with the keep-fast-signals-off-
  ribbons rule; possible later but needs its own conductors and the ESD/noise
  story reworked.

## Open questions

- RMK (or bare Embassy + esp-hal) maturity on ESP32-P4 — spike before any PCB.
- WT9932P4-TINY schematic checks (VBUS out, CC pull-ups) if the MITM spike
  happens on the same board.
- FFC connector selection: locking, mounting orientation, insertion cycles.
- Pod enclosure: dev-board-in-a-case vs eventual carrier PCB.

## Starting point if picked up

1. P4 dev board: port the mezzacomic `pico-gpt` engine, benchmark PIE int8
   matmul — one number sizes the model.
2. RMK/Embassy HID spike on the P4.
3. Ergogen: current 36-key layout re-cut as 4 passive modules + pod, angles
   locked as-if-unibody.
