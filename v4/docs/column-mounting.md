# Finger column mounting requirements

> **Paused (2026-09-26).** The first prototype uses bought RGB key tiles for all 36 keys; see [design status](design-status.md). This document describes the paused flex finger board design and is kept as reference.

Design direction recorded 2026-09-16. This is the mounting contract for the column redesign, not a claim that the current legacy finger files already implement it.

## Construction and bending

Separate column boards remove inter-column FR4 bending. They do not remove the approximately 15-degree bend between successive keys within a column. The intended column construction is polyimide flex between locally stiffened switch areas. Ordinary rigid FR4 must not be substituted for that construction.

The column geometry study finds the same within-column transforms for all five columns. A trial development with 18 mm long rigid areas gave approximately 24 mm bend radii and a 24.2 mm developed key pitch. Those measurements establish geometric feasibility only: that trial's 0.15 mm flex / 1.45 mm stiffener assumptions are not a released or JLCPCB-selectable stackup. Recalculate the development using the selected supported stackup and the final component/stiffener boundaries before generating fabrication files.

The column must be flexible during installation but must not rely on its free-standing spring shape to locate the keys. No springback force or fatigue life has been established. The chassis carries the mechanical loads after installation.

## Retention and load paths

1. Each switch clips into a dedicated flat switch seat in the curved upper chassis/plate. The seats establish switch position and angle.
2. Each stiffened PCB area sits in a locating pocket below its switch. Side stops constrain sideways movement; a seating shoulder establishes the PCB height. Provide clearance for the actual board, stiffener and print tolerances.
3. A removable lower retainer captures all three stiffened areas. Use two accessible screws into chassis bosses at the ends of the column, with local support lands at every switch. Screw shoulders or hard stops limit clamping travel: screw torque must not crush the PCB stack or determine its installed bend.
4. Support the plastic hotswap socket housings from below where the component geometry allows it. Provide relief for solder joints, diode bodies and switch pins. This prevents switch insertion from relying solely on socket solder joints to react the load.
5. Leave clearance around both flexible spans. Rounded transition surfaces may guide them, but no sharp edge, screw, pressure pad or retention clip may clamp a bend. Include the formed spans in the collision model.
6. Anchor the insulated inter-column wires to the chassis, leaving service loops. Pulling a harness must not pull on a PCB solder pad or twist a flex span.

Normal keypress load: keycap → switch housing → upper switch plate → chassis. PCB retention and socket backing principally control seating, handling and switch insertion/removal loads. The flexible span provides electrical continuity and accommodates geometry; it is not the spring or fastener holding the column in place.

## Assembly and service

Fit the switches into the upper plate, bring the column PCB onto their pins while supporting the socket bodies, then install the lower retainer onto its hard stops. Verify full seating before tightening. Remove the retainer to access the PCB and wiring. Avoid adhesives as the primary means of column retention.

## Required checks before calling the mounting complete

- Match the actual switch clip plate thickness and pin-to-PCB seating datum.
- Select a manufacturable FPC/stiffener stack and include its tolerance in the locating pockets.
- Check support lands against the actual socket, diode, solder and drill envelopes.
- Check the complete column and retainer against neighbouring columns, wiring and the thumb region.
- Check formed bend radii and clearances using the selected stackup.
- Print a column mounting sample and check retention, switch insertion and removal, and wire strain relief with actual parts.

JLCPCB lists polyimide FPC and FR4 stiffeners separately; this is flex with local stiffeners, not a rigid-flex multilayer fabrication process. See [JLCPCB flex capabilities](https://jlcpcb.com/capabilities/flex-pcb-capabilities).
