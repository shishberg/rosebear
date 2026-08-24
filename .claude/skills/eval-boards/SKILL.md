---
name: eval-boards
description: Evaluate the v3 keyboard boards in output_v3 against the project's design goals — render them, look at them critically, and run the programmatic checks. Use as the check half of a fix loop after any pipeline change.
---

# Evaluate the generated boards

This is a design review, not just a test run. The output is five PCBs a person
will pay to fabricate and then live with; the question is always "would I send
this to a fab and screw it to a desk?" — not "did the checks pass". Render the
boards, look at them with the goals below in mind, and say what's wrong even
when everything is green.

## What this thing is

A 36-key split keyboard (rosebear), re-cut as **five separate flat PCBs**:
per hand a 15-key finger board and a 3-key thumb board, plus one central pod
carrying the ESP32-P4. The key boards are passive — direct-wired keys, one
conductor per key, no matrix. FFC ribbons join them: pod→finger (20-way) each
side, finger→thumb (4-way) each side. Design source: `v2-p4-pod.md`; the
pipeline is `v3/baml_src/` (BAML), and `output_v3/` is generated — never edit
it. A `per_key_leds` variant adds reverse-mount LEDs and wider ribbons in
`output_v3/leds/`.

## The goals, in priority order

1. **It must physically work flat on a desk.** The boards are coplanar and
   separate: no two outlines may overlap, and every ribbon must be able to
   run from its connector to its partner's — the finger↔thumb pair directly
   facing each other across a small gap, the pod links leaving the inboard
   edges toward the pod, which sits between the halves.
2. **Electrically correct.** DRC-clean (the pod's two deliberate
   `lib_footprint_mismatch` excepted), zero unconnected items, every key on
   exactly one conductor, thumb pass-through consistent end to end.
3. **Compact.** Board area is cost and desk space. A board should hug its
   keys, connectors and routing — a large empty region means a placement
   constant is wrong or a hull is sweeping over nothing. Call it out.
4. **The layout is sacred.** Key positions come from the ergogen layout and
   are locked "as-if-unibody". Never judge a key position; judge everything
   the pipeline placed around the keys.
5. **Modules stay independently replaceable.** A new thumb angle should mean
   reprinting one small board. Anything that couples the boards beyond their
   ribbon (overlapping outlines, copper reaching across) breaks the point of
   the split.

## How to inspect

1. Rebuild from `v3/` (relative footprint paths): `cd v3 && baml test &&
   baml run build && baml run build_leds`. A failing invariant test comes
   first; output from a failing build is stale and not worth looking at.
2. Run the programmatic pass: `python3 v3/tools/evaluate.py` (add `--no-drc`
   while iterating, `--render` to get PNGs). It covers overlap, connector
   facing, copper containment, pod placement and DRC. A geometry FAIL is a
   pipeline bug — fix `v3/baml_src/`, never the output.
3. **Render and actually look** — `output_v3/all.png` (and `leds/all.png`),
   plus a close-up of any board you changed. Read the picture against the
   goals; the checker cannot see ugliness. Ask, at minimum:
   - Could each ribbon really be plugged in? Trace the cable path with your
     eyes: connector → gap → partner. Anything in the way? Does a cable have
     to fold back on itself?
   - Where is the empty board? Whose constant would shrink it?
   - Do the fans and buses look like calm parallel rivers, or do runs make
     long detours, hug pads at silly angles, or squeeze through gaps that
     one tolerance bump would close?
   - Are connectors at board edges with their contacts pointing the way the
     cable leaves? A connector buried mid-board is wrong even if DRC passes.
   - Symmetry: the right hand should read as a clean mirror of the left.
     An asymmetry is a sign bug, not a style choice.
   - With LEDs: does the chain snake sensibly (short hops, no crossings of
     its own column runs)? Do its ends land near the connectors they feed?
4. Report like a reviewer: lead with anything that would block fabrication,
   then correctness risks, then size/beauty. Name the board, the place, and
   the pipeline constant or function you suspect. "thumb_l: J1 body overhangs
   the outline by 2mm — `connector_corners` back too small" beats "looks off".

## Thresholds and exceptions

Numeric thresholds (gaps, ranges) live at the top of `v3/tools/evaluate.py`;
deliberate DRC exceptions in its `DRC_ALLOWED`, each needing a reason. If a
check and the design intent disagree, the intent wins — change the check, and
say so.
