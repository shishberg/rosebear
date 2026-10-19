// PROTOTYPE. Question: How should the Skeletyl support its hanging rib ends?
// Variants switchable via ?ends= on the editor (chassis.ends;
// prototype-overrides.ts), cycled with the second bar at the bottom of the dev
// editor (prototype-switcher.ts; the ↑ and ↓ keys).
//
// What needs support: the ends that hang, a round that turns the rib down and
// stops in mid-air: the finger columns' fronts that face the thumbs (those not
// near enough the outline to drop to it) and some thumb row ends. The floor
// between the finger and thumb sections is free to build on: the tiles go in
// from above, soldered together, so something low across it is fine, with
// most of the space above it open and a few supports wires can be worked round.
//
// The variants are built by skeletyl.ts itself, from its own parts, so they
// look like the rest of the frame (see "PROTOTYPE ?ends=" there):
//  - none: the ends left hanging (the frame as without this switch).
//  - tie: a floor tie, a bar of the rail's own section across the floor
//    under the hanging ends, rail to rail, each leg turning (rounded) to meet
//    the rail square and filleted into it like the outline's corners in. The
//    hanging ends that can drop onto it clear of the keys become ordinary
//    drops (bending along the end where the tie is off from straight down,
//    landing square on it, clear of its bends and junctions), banded to their
//    neighbours.
//  - flow: a thumb row's end carried on into a column's front as one rib
//    (a sweep from the row's end plate edge to the front's, tangent to both:
//    the front then flush), each row end and front once, nearest first, where
//    it clears the other keys and doesn't fold back. Then each finger front
//    still hanging near a thumb key's plate carries on as a web (like a web
//    between keys in a rib) to that plate's facing edge, so the finger rib and
//    the thumb rib are one, with no round there. The tie takes the rest.
//
// Two more variants, "join" (only the finger fronts' webs to the thumbs) and
// "both" (join, then the tie), were dropped: flow does what they did and
// more. They are in git history, last at commit 0acbf48.

/** The end supports, in the switcher's order: the ?ends= key and a short name. */
export const END_SUPPORTS = [
  { key: 'none', name: 'hanging ends' },
  { key: 'tie', name: 'floor tie' },
  { key: 'flow', name: 'thumbs flow into columns, then join, then tie' },
] as const;
