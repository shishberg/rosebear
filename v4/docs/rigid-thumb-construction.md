> Superseded by [flat thumb construction](flat-thumb-construction.md). Historical separate-tile design.

# Rigid thumb key PCBs

Current design: three separate 17.8 × 19.5 mm, 1.6 mm FR4 tiles per hand. No flex bridges, stiffeners, LEDs or lighting support components. Each tile carries one MX hotswap socket, one SOD-123 diode, a ROW pad (W1) and COL pad (W2). The routing uses zero vias. One universal artwork serves all six positions.

## Wiring

| Finger pad | Thumb destination |
|---|---|
| W4 | Near W1 (bottom row) |
| W3 | Home W1 (home row) |
| W2 | Far W1 (top row) |
| W1 | Near W2, then home W2, then far W2 (shared column) |

The row leads remain independent. Only the shared column is connected between tiles. Near and home COL pads accept an incoming and outgoing fine conductor, or a stripped/tinned section of a continuous wire. Pads have a 1 mm drilled hole; verify the selected wire pair fits before assembly. Restrain the insulated wires in the chassis; leave slack between differently angled keys and do not load a solder joint mechanically.

## Case fit

The generated model maps each tile directly into its key's full 3D frame. No unfolding or flex-radius model is used. The 1.6 mm board and socket envelopes reach approximately 1.405 mm below the original base datum. The proposed case uses a 3 mm base extension, leaving approximately 1.595 mm to the new bottom datum, plus generated PCB/component relief pockets.

The original case is not a verified drop-in fit. The source mesh is not watertight, so the surface screen is approximate. Print a fit prototype and check wall thickness, bottom-plate attachment, socket retention, wire paths and strain relief before making a final set. The small right trackball and its separate harness remain.
