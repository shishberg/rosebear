> Superseded by [separate rigid thumb PCBs](rigid-thumb-construction.md). The flex construction below is historical and must not be manufactured for the current design.

> **Paused (2026-09-26).** The first prototype uses bought RGB key tiles for all 36 keys; see [design status](design-status.md). This document describes the paused thumb PCB design and is kept as reference.

# Connected thumb construction

## Selected construction

Use one two-layer polyimide FPC per thumb cluster, with three front-side FR4 stiffeners. Keep each thumb FPC separate from its finger PCB and handwire the junction. Each cluster has three switches, three diodes, and one four-wire matrix harness. The outboard flex bridges carry all inter-key signals; there are no inter-key wires or ribbon connectors.

The generator develops the actual chassis key planes, including their skew, into a flat pattern. Finite-radius cylindrical sections join the key planes; this is not a row of independent tiles connected by guessed straight lines. The bridge is on the opposite side from the right-hand trackball.

| Parameter | Selected value |
|---|---:|
| Finished FPC thickness, including coverlay | 0.20 mm |
| Copper | 35 µm, two layers |
| Front FR4 stiffeners | 0.40 mm nominal |
| Supported seating thickness | 0.60 mm nominal |
| Designed bend radius | 10 mm |
| Bridge width | 5 mm |
| Bridge signal / supply trace widths | 0.20 / 0.50 mm |
| Copper clearance / copper-to-edge | 0.15 / 0.30 mm |
| Standard via diameter / drill | 0.55 / 0.30 mm (some cached routes use 0.60 mm diameter) |
| Intended use | Static bend during installation |

Confirm whether the quoted finished stiffener thickness includes adhesive. The 0.60 mm seating datum must be maintained by the finished assembly, not merely by adding nominal material thicknesses. Stiffeners need the same switch and wire apertures as the FPC. Components are on B.Cu; stiffeners are on the front. Do not crease the bridges or put plated holes into their bend regions.

JLCPCB publishes 0.20 mm two-layer FPC and localized 0.40 mm FR4 stiffeners. Its generic multilayer bend guideline is at least ten times the finished flex thickness. Our 10 mm radius exceeds that 2 mm guideline, but the exact stackup, adhesive transition and assembled load still need fabricator review. [Published capabilities](https://jlcpcb.com/capabilities/flex-pcb-capabilities).

## Alternatives and cost

| Construction | Decision | Cost implication |
|---|---|---|
| Uniform thin FR4, bent between keys | Reject for this iteration: the material and copper fatigue limits were not qualified | Low bare-board price does not establish an acceptable bend |
| Milled semi-flex FR4 | Possible supplier-specific alternative; would require a new stackup and bend design | Additional machining and qualification |
| Rigid-flex | Technically possible, unnecessary for three locally supported key areas | Obtain a specialist quote; more complex stackup |
| FPC plus localized stiffeners | Selected | Two handed fabrication designs; three stiffeners on each |

Each cluster fits inside 100 × 100 mm. An advertised entry offer is **$25 for five flex PCBs**, not a quote for this assembly. Two handed designs would start at $50 under that offer before stiffeners, assembly, tax and shipping, if both qualify. Do not use this as a purchasing budget or assume a coupon applies. No files were uploaded and no order was placed. [Supplier offer](https://jlcpcb.com/RGE/FlexPCB).

Three stiffeners avoid the supplier's four-or-more-piece surcharge trigger, although other stiffener-area and processing charges can still apply. [Stiffener charges](https://jlcpcb.com/help/article/fpc-extra-charges).

## Electrical interface

RGB lighting, its capacitors and resistors, and the pod LED driver have been removed. No external LED supply or power bus is required. GPIO30/31 were unused at the time; they now carry RGB data for the key tiles.

| Thumb pad | Signal | Other end |
|---|---|---|
| W1 | Bottom thumb row | Finger W4 |
| W2 | Home thumb row | Finger W3 |
| W3 | Top thumb row | Finger W2 |
| W4 | Thumb column | Finger W1 |

Bundle the four matrix conductors as one harness and provide chassis strain relief. Each flex bridge carries its remote key's row and the shared thumb column. The trackball retains its separate seven-wire connection to the pod.

## Mechanical qualification

The far-thumb component allowance reaches approximately 0.11 mm below the original Z=0 base. The proposed case includes a 2 mm downward extension of the original base wall and screw-hole profile, giving approximately 1.89 mm clearance above the new bottom datum. The extension is generated from the closed chassis section at Z=0.5 mm and checked for a watertight mesh. Move any separate bottom plate to the new Z=-2 mm datum; its fastening and clearances still need the fit prototype.

Generated reports distinguish exact frame reconstruction from sampled collision checks. The existing chassis STL is not watertight, so its voxel test is an approximate surface screen. Generated reliefs are proposed chassis edits, not a claim that the unmodified case fits. Review remaining wall thickness and print a fit prototype before ordering assembled flex boards. Actual keycaps, sockets, stock trackball housing, magnet orientation and harness strain relief need physical verification.

