# v3-flex — a segmented board for a curved key well

Rosebear's key boards become **one flat PCB per half, cut into per-column
strips joined by serpentine necks**, bent into a Dactyl Manuform key well at
assembly. The board stays rigid 0.6mm FR4 and is its own stiffener — compliance
is cut in, not bought as material. This is BastardKB's construction, measured
from `Bastardkb/Dactyl-Manuform-PCB-Plate`.

Wiring changes from direct-wired to a **6x3 diode matrix per half** at the same
time, because on a segmented board direct wiring makes the conductor count
accumulate along the strips and a matrix keeps it constant.

## Decisions already taken

These are settled. Do not re-litigate them or re-derive the alternatives.

| Decision | Why |
|---|---|
| Rigid 0.6mm FR4 with cut hinges, **not** flex or rigid-flex | Pure flex (0.07–0.45mm at JLC) cannot hold an MX switch without a stiffener behind every one, which is rigid-flex; JLC does not quote rigid-flex as a standard product. Cut hinges are a bog-standard rigid order. |
| **Diode matrix**, 6 cols x 3 rows per half, thumb as the 6th column | 18 GPIO back for I2C/trackball/spares; worst neck carries 8 traces instead of 15; pod ribbon 20-way to 11. Costs 36 SOD-123. |
| Strips run along **columns**, necks absorb the inter-column step | A column is a pure cylinder and unrolls exactly; the well as a whole does not. |
| **Glue** holds the board in the case | No mounting bosses, no screws, therefore **no mounting holes eating into 16.5mm strips**. |
| Hinge/ligament/slot dimensions stay at BastardKB's measured values | No bend coupon has been ordered and none is planned. Their board is the only field-proven data. |
| `PCB_DEPTH` stays a **parameter**, not a measurement to chase | The case is provisional: Toto's layout will be tweaked, and may be replaced by something lower-profile like a Skeletyl. Case geometry must enter the model in exactly one place. |

## State as of this plan

`cd v3 && baml test` — **73 passing**. `make v3` builds the existing five boards
unchanged (pod shows 2 pre-existing `lib_footprint_mismatch` warnings on its
buttons, unrelated).

Everything below is behind flags, so the direct-wired v3 boards still build
byte-identically.

New files:

- **`well.baml`** — the key well, and the flat pitch it develops to. `Well`
  carries alpha/beta/cap pitches/`pcb_depth`/`column_offsets`. `well_toto()` is
  Toto's, read from `../dactyl-keyboard/src/run_config.json`. **This is the only
  file that knows about a case.** Swapping to a Skeletyl means one new
  `well_*()` function, nothing else.
- **`config_dactyl.baml`** — the 36-key layout at the developed pitch. Splay and
  hand-tuned stagger dropped; stagger is dactyl's `column_offsets` differenced
  (ergogen's stagger is cumulative, dactyl's are absolute). `dactyl_left_keys()`
  / `dactyl_all_keys()`. `config_rosebear.baml` is untouched so the ergogen
  4.0.4 golden keeps its meaning.
- **`flex.baml`** — `Strip`, `strips_of`, `hinge_ys`, `hinge_slots`,
  `flex_ring`, `neck_edges`, `meander_*`, `traces_per_ligament`,
  `ligaments_for`, `FlexParams`/`flex_defaults()`.
- **`matrix.baml`** — `matrix_col`/`matrix_row`/`col_net`/`row_net`/
  `switch_diode_net`, `matrix_signals`, `matrix_neck_traces` vs
  `direct_neck_traces`, `DIODE_FOOTPRINT`.
- **`paper.baml`** — a 1:1 print-out proof. It found two real defects when
  rendered but tests nothing paper can actually answer. **Delete it** unless a
  use appears; the two defects it found now have regression tests in
  `flex.baml` (`every key's footprint lands on its strip`, `every diode lands on
  its strip`).

Modified: `features.baml` (+`matrix: bool`, `features_matrix()`,
`features_matrix_leds()`), `ribbon.baml` (`ribbon_signals` branches on
`f.matrix`; `is_matrix_pinout` makes the pinout reorderings identities),
`netlist.baml` (`switch_component` takes `Features`; `diode_component`,
`diode_offset`, `DIODE_REACH`), `netlist_test.baml` (call sites).

### The numbers, so they need not be re-derived

Derived in `well.baml` from Toto (alpha 15 deg/row, beta 5 deg/col, mount 18x18,
extra 1.0/2.5, `cap_top_height` 17.8, `pcb_depth` 22.8):

```
cap-surface radius   row 72.782327    col 234.987253
developed pitch      row 25.023395    col 22.496182     <- the flat board's pitch
pitch at cap surface row 19.054369    col 20.506506     <- NOT the board's pitch
sensitivity          row 0.2617994 mm of pitch per mm of pcb_depth; col 0.0872665
```

The well is **concave** — centre of curvature above the board — so the caps sit
at the smallest radius and the PCB, further out, spans a *longer* arc. The board
is therefore **bigger** than the key grid. The 19.054 figure is the arc at the
keycap surface and is not a board dimension; do not confuse the two.

Strips: 22.496 pitch − 6.0 gap = **16.496mm** wide (BastardKB's are 15.8).
Hinges: alpha 15 deg over a `MAX_HINGE_DEG` 8.0 budget → **2 rows per inter-key
gap at 7.5 deg each**, at the midpoint ±2mm. Ligaments: 2.0mm carries 10 traces
at 0.135/0.15 over 2 layers. Necks: 1.5 cycles of 1.6mm amplitude across the 6mm
gap = 11.7mm of material to absorb the largest `column_offsets` step (5.0mm at
the inner column; 4.5mm at the middle).

Matrix vs direct, per half: 9 vs 18 signals, 11-way vs 20-way pod ribbon, 5-way
vs 4-way finger→thumb (the one link a matrix widens), worst neck 8 vs 15.

---

## 3. Emit the outline

**Goal:** `flex_ring` and the hinge slots reach a `.kicad_pcb` so KiCad's DRC
sees the real board. Today they are tested geometry that nothing writes out.

`Board.outline` is a single `Vec2[]` and there is nowhere to put interior cuts.

1. Add `cuts: Vec2[][]` to `Board` (`netlist.baml:23`). Update every
   construction site: `netlist.baml` (2), `route.baml:1515`, `pod.baml:680`,
   `panel.baml:137` (`translate_board` — must translate cuts too) and
   `panel.baml:270` (`merge_boards` — must concatenate them).
2. `emit.baml`: `edge_cuts(outline, uuid_base)` already emits one closed
   polygon on `Edge.Cuts`. Call it once per entry in `cuts` with distinct uuid
   bases. `emit_board` (528) and `emit_panel` (481) both need it.
3. Add `flex_board(m, w, p, f) -> Board` (new, in `flex.baml` or a
   `flex_board.baml`) that sets `outline: flex_ring(...)` and
   `cuts: strip_hinge_cuts(...)` for every strip.
4. **`route.baml:enclose` must not run on a flex board.** It grows the hull
   around finished routing, which would swallow the gaps between strips and
   turn the ring back into a blob. Gate it on the variant: on a flex board the
   outline is authoritative and the *router* must stay inside it, which is the
   inverse of the current contract.

**Done when:** a `finger_l` flex board opens in KiCad showing five strips,
necks and slots, and `kicad-cli pcb drc` reports a valid single board outline.

**Watch for:** KiCad rejects overlapping Edge.Cuts contours rather than uniting
them. `flex_ring` is deliberately one ring for that reason and has a
self-intersection test — keep it.

## 5. Rewrite `route.baml` for the matrix

**Goal:** copper for `features_matrix()`. This is the largest job. The current
router is written for per-key nets and a fan band, neither of which survives.

What goes away: `band_groups` (395), `bus_lane` (494), `route_fanin` (839),
`route_thumb_fanin` (889), and the `BUS_*`/`FAN_DEPTH`/`LANE_*` constants
(51–125). `column_of` (245) parses a column out of a per-key net name and has
nothing to parse in `COL_L_PINKY`/`ROW_L_TOP`.

What replaces it, per strip:

- **Column line** runs the length of the strip on the front, joining pad 1 of
  every switch in that column. It crosses this strip's own hinge rows and then
  continues inboard through every neck to the connector.
- **Row lines** run *across* the board through the necks, one per row, joining
  each key's diode cathode. Three of them cross every neck.
- **Switch→diode** is a short local hop on the back, inside one island, between
  the switch's pad 2 and the diode's pad 2 (`switch_diode_net`).

Trace budget per neck is `matrix_neck_traces(keys, i)` = 3 rows + (i+1) columns,
worst case 8 at the inboard end. Two 2mm ligaments carry 10, so it closes — but
see #6 before assuming the pour can share the crossing.

Also to revisit once nets change:

- `ribbon.baml`'s `mirror_pinout`/`reverse_rows`/`band_pinout` are currently
  identities for matrix pinouts (`is_matrix_pinout`). **The correct contact
  order is an open question** and belongs with this router: whatever order makes
  the fan at the connector planar. Decide it here and delete the guard.
- `netlist.baml:link_spot` and the connector placement assume a convex hull.
  The pod link now lands on the inner strip.
- `pod.baml`'s pin *assignment* already works for matrix nets (there is a test),
  but its fan geometry is written for the direct-wired pinout.

**Done when:** `build_boards(features_matrix())` routes, DRC-clean, zero
unconnected, on the flex outline from #3.

## 6. Flex routing rules, as checks

**Goal:** the constraints that make a folded board survive, enforced rather than
remembered. Write these as BAML tests over the routed board, in the same style
as the existing `no two nets cross on the same layer`.

1. **The ground pour must be broken at every hinge row.** This is the one that
   bites. `route.baml:board_zones` (1231) pours over the whole outline; a solid
   pour across a ligament is a stiffener and a crack starter. The pour has to
   stop short of each hinge row and reconnect only through the ligaments — and
   those stitches compete with signal traces for the same 2mm. Budget them:
   `ligaments_for` currently sizes for signals only.
2. **No via inside a hinge row or a neck.** A via is a rigid plated barrel in a
   part that folds.
3. **Traces cross a fold perpendicular to it**, within some tolerance — a trace
   at a shallow angle to the fold sees far more strain per unit length.
4. **Trace width in flex zones is `FLEX_TRACE_W` (0.135)**, not the board's
   general `TRACE_W`, and copper-to-edge is `FLEX_EDGE_CLEAR` (0.3) not 0.2/0.5.
5. **Nothing rigid straddles a fold.** Already true for diodes by construction
   (`diode_offset` puts them toward the column centre, in the 7.5–10.5mm band);
   generalise it to any footprint courtyard vs any hinge row.

**Done when:** each rule is a named failing-if-violated test, and #5's output
passes all of them.

## 7. Thumb cluster

**Goal:** the thumb board gets the same treatment. It is currently the only part
still on v2 geometry.

- `config_dactyl.baml:dactyl_thumb_zone()` just returns `thumb_zone()`. Toto's
  thumbs are MINIDOX, whose placement is separate arithmetic in
  dactyl-keyboard — it is not a continuation of the finger well, so there was
  nothing to derive it from. Either port that arithmetic into `well.baml` as a
  `ThumbWell`, or keep the measured geometry and say so explicitly.
- Segment it as **two rigid islands joined by serpentines**, which is what
  BastardKB does for five thumb keys and what the near-planar cluster wants —
  not three strips. `strips_of` assumes one column per strip and will need a
  sibling that groups keys into islands by proximity instead.
- The thumb keys are already the matrix's 6th column, so the finger→thumb link
  carries 1 column + 3 rows = 4 signals + GND.

**Done when:** the thumb board emits a segmented outline and routes under
`features_matrix()`, passing #6's rules.

---

## Order

3 → 5 → 6 → 7. #3 unblocks everything (you cannot check routing against an
outline that is not emitted). #6's pour rule may push back on #5's trace budget,
so expect one iteration between them. #7 is independent of #5 once #3 lands, if
you want to parallelise.
