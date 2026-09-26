# Flat three-key thumb PCB

> **Paused (2026-09-26).** The first prototype uses bought RGB key tiles for all 36 keys; see [design status](design-status.md). This document describes the paused flat thumb PCB design and is kept as reference.

Current layout is defined by `v4/flat_thumb.json`. The whole cluster has one adjustable 3D pose; each key has an in-plane position and fan angle. All three switch normals remain parallel. The default outer keys fan by -10/+10 degrees around the middle key. Left and right boards preserve proper hotswap land patterns rather than mirroring a socket footprint.

Each 1.6 mm FR4 board has three hotswap sockets, three SOD-123 diodes, and four 1 mm drilled wire pads in the home–far inter-key gap. No lighting or inter-key wires. Three vias connect the individual diode rows to front copper; the column bus is on the back. Routing remains deterministic and native DRC rejects unsupported placement changes.

| Finger board | Thumb board | Function |
|---|---|---|
| W4 | W1 / N | Near, bottom matrix row |
| W3 | W2 / H | Home matrix row |
| W2 | W3 / F | Far, top matrix row |
| W1 | W4 / C | Shared thumb column |

Current defaults shift the cluster 5 mm away from the example finger well and position the custom trackball 30 mm sideways from home, to clear conservative envelopes. These are editable prototype choices. The example chassis is not a required final shape. The ICSH044A module is no longer planned; the pointing device is open (see [design status](design-status.md)).

## Outputs

- `output_v4/seeded/thumb_l.kicad_pcb`, `thumb_r.kicad_pcb`: current connected flat boards.
- `output_v4/fabrication/thumb_l/`, `thumb_r/`: per-hand Gerbers, drill files, BOM and layout.
- `output_v4/seeded/all.kicad_pcb`: six-board review overview: fingers, thumbs, pod, custom trackball.
- `output_v4/layout-chassis.json`: effective coplanar thumb switch frames used by the assembly.
- `output_v4/mechanical/flat-thumb/thumb-switch-plate.stl`: printable 1.5 mm switch clip plate with 14 mm openings.
- `output_v4/mechanical/flat-thumb/thumb-pcb-support-ring.stl`: printable alignment spacer, 3.5 mm high.
- `output_v4/chassis-right.scad`: assembled fit preview, not a finished case.

Print the plate and spacer separately. Files without a suffix are right-hand; `-l.stl` files are left-hand. Use the matching pair because the board outlines and wire escapes differ. Temporarily clamp the PCB at the spacer bottom with switches seated in the plate, giving 5 mm from PCB top to plate top. The ring is an alignment tool, not a final retention mechanism. Check socket seating, wire access, switch clips, keycap movement and reach. A watertight STL is a printable mesh check, not proof that a printed part fits the selected switches.

The full new chassis, final PCB retention and socket-support features still follow the fit trial. Old rigid-tile fit models and old-case reliefs are historical and must not be used for this cluster.
