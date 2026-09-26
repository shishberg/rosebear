# Reference PCB review and revised mechanical brief

> **Paused (2026-09-26).** The first prototype uses bought RGB key tiles for all 36 keys; see [design status](design-status.md). This document describes the paused flex finger and flat thumb PCB design and is kept as reference.

Reviewed 2026-09-16. This records the next design direction; the generated rigid single-key thumb boards remain the previous build, not an implementation of the proposed flat cluster.

## Design constraints clarified by Dave

- `../dactyl-keyboard` is an example of the existing keyboard, not a fixed chassis target. Spacing will change, and the chassis may be redesigned within reasonable ergonomic limits to suit the PCB.
- Skeletyl is a reference for the general direction, not a geometry specification. Keep two separate halves.
- A single flat thumb PCB per hand is a candidate: the cluster can tilt as a whole relative to the finger well.
- Keep three thumb keys, MX hotswap, no LEDs, handwired finger-to-thumb connection, and the small trackball beside the right thumb keys.

## Sources inspected

Local reference clones are under `output_v4/references/`. Inspected source PCB footprint placements, repository photographs and READMEs; no native KiCad process or routing job was needed.

| Reference | Inspected revision | Findings |
|---|---|---|
| [Dactyl-Manuform-PCB-Plate](https://github.com/Bastardkb/Dactyl-Manuform-PCB-Plate) | `17d9e74289d7e69a5254b03f810cfa9941a5e33c` | Thin 0.6 mm board, breakable from up to 6×6 to 5×3. The photograph shows transverse runs in the inter-column connections, rather than our long, predominantly column-parallel legs. |
| [Dactyl-Manuform-PCB-Thumb-cluster](https://github.com/Bastardkb/Dactyl-Manuform-PCB-Thumb-cluster) | `f72cd96265f24526a2e341061692937ef39432b2` | Five keys: a broad three-key section and a two-key section joined by a narrow connection. README specifies 0.6 mm and calls it flexible. |
| [TBK-Mini-PCB-thumb-cluster](https://github.com/Bastardkb/TBK-Mini-PCB-thumb-cluster) | `9db9c36e99de4f6d85ffb36b79f40684c183ac8e` | Three-key continuous board; the directly relevant thumb reference linked by Skeletyl's BOM. README specifies 0.6 or 0.8 mm and calls it flexible. RGB circuitry is irrelevant to our no-lighting design. |
| [Skeletyl](https://github.com/Bastardkb/Skeletyl) | Online README and electronics BOM | Standard build already has separate mirrored halves. Useful as a compact sculpted case reference. No case dimensions imported. |

The TBK three-key PCB centers are `(74.0664,76.4032)`, `(94.2848,74.5744)` and `(116.078,77.5716)` mm, with footprint rotations `10,0,-16` degrees. Adjacent pitches are approximately 20.30 and 22.00 mm. These rotations are in-plane fan angles, not evidence of installed out-of-plane tilt. The same three placements occur in the five-key reference.

These references support a connected thumb topology, but a flat KiCad file or photograph cannot prove its installed PCB remains unbent. The authors explicitly describe thin flexible boards. Our rigid proposal instead requires the new chassis switch seats to be coplanar by construction.

## What the old example actually requires

At the exported thumb home key's plate datum, the other centers in its local frame are:

| Key | X | Y | Z |
|---|---:|---:|---:|
| Near | 3.252 | 21.754 | -1.081 |
| Home | 0 | 0 | 0 |
| Far | 1.639 | -22.814 | -0.909 |

The centers are only about 1 mm away from the home-key plane, despite pairwise switch-normal differences of approximately 4.90°, 9.51° and 14.13°. Thus preserving approximate reach while making the switch seats coplanar is worth exploring. These measurements describe the exported example only, not a measurement of Dave's physical keyboard. Moving centers onto this plane alone does not settle keycap clearance, switch orientation or comfort.

## Recommendation

Use one broad, flat rigid three-key PCB per hand, with adjustable in-plane key positions and fan angles. Start with 1.6 mm FR4 as a prototype construction, subject to socket seating and case clearance. Use continuous board material between keys, three diodes, and four accessible wire pads for the existing three rows and shared column. The column connections become copper on this board, eliminating the inter-tile wire joints. Place the pads on the finger-facing side after checking harness access.

Define the cluster by a 2D layout plus one 3D position/orientation for the entire cluster. Generate both PCB placements and chassis switch seats from that definition. A flat cluster can still have substantial tilt relative to the finger well. Keep the trackball placement adjustable beside it and check the ball/carrier against the thumb's movement and keycaps.

Move layout ownership into Rosebear rather than treating the imported chassis as an immutable source. Retain its exported geometry as a comparison preset. Share layout parameters between board generation, case generation, clearances and wiring so changes remain consistent.

For fingers, compare the reference's transverse inter-column runs against the actual relative key frames and available case volume. A transverse straight run has a different relationship to the required Y rotation than our column-parallel legs. That is a useful design lead, not proof of a strain margin. Keep the existing finger bridge qualification issue open; do not transfer a strain allowance merely because both boards are nominally 0.6 mm thick.

Next implementation should produce a flat-cluster layout and a small printable thumb plate/socket-support prototype from the same parameters, with the small trackball beside it. Settle reach and spacing before rebuilding the full chassis. Existing tile fabrication files are not the proposed cluster artwork.
