# v4/editor cleanup plan

A cleanup of the chassis editor and the `?hand` prototype: duplicated logic,
layered patches, dead code, and long or stale comments and docs. It is built
from four read-only audits made on 16 Oct 2026 at `5824e3f`.

**Scope.** Most of the work is refactoring. Behaviour changes are allowed only
for:

- clear bugs, and
- places that should obviously compute the same thing but don't.

Each behaviour change is listed in its task, gets its own commit where
practical, and reports its effect on the fingerprint.

Line numbers are from `5824e3f` and drift as tasks land. Find code by its
function name.

## Ground rules for every task

- **Safety net:**
  - `npm test` (about 20 s).
  - `npx tsc --noEmit`.
  - `npm run fingerprint` (geometry; extended in T0). Save its output before
    the change and diff it after.
  - `npm run test:browser` and `npm run test:hand` for any change to `main.ts`,
    `marks.ts`, `hand-prototype.ts` UI code or `index.html`.
- **The fingerprint decides what counts as a refactor.** It must be
  byte-identical after a pure refactor. Where a change unavoidably reorders
  boolean operations (the mesh hash changes but the volume doesn't), say so
  and show that the volumes and check results are unchanged.
- **Test-driven.** If the existing tests and the fingerprint would not notice
  the refactor breaking something, add the test first, watch it pass on the
  old code, then refactor. Write bug fixes test-first where a node test can
  reach them: the test fails before the fix and passes after.
- **Comments:**
  - Say why, not what.
  - Don't tell the code's history ("was", "now", "before X…"); history goes in
    commit messages.
  - Keep one short doc comment per exported function or type.
  - While touching a function, trim its comments to that standard.
- **Formatting.** Run Prettier (`npm run format`) on the touched files.
- **Review and commits.** Implementers don't commit. An Opus reviewer checks
  each change, then the orchestrator commits with a `v4: editor cleanup: ...`
  message.

## Phase 0: safety net

### T0. Extend the fingerprint and fix its dead variant

The fingerprint doesn't cover enough for the later refactors.

- **Remove the dead `margin` variant.** Its output is identical to `default`:
  - `chassis.wall_mm` is read nowhere.
  - A 1.6 mm margin never beats the tile pocket.

  Replace it with a margin that binds (for example `plate_margin_mm = 2.5`).
- **Add variants:**
  - a splayed or rotated finger column (`rotation_deg [0,0,6]` on one column);
  - a renamed-free `key_overrides` case, if the schema allows one;
  - one with `keycap_clearance_overrides_mm` set.
- **Per variant, also print:**
  - the trim mesh (volume, triangle count, hash);
  - the wiring: wire count, total length rounded to 0.01 mm, and a hash of
    every wire's points rounded to 1e-3;
  - a hash of the `hardware()` part placements;
  - the report's per-check failure lists: names and rounded volumes of the
    seats, openings, pieces, footprints, room cuts, hardware hits, wire hits,
    crossings and blocked solder pads, plus the cap gaps, as one compact
    sorted line or a hash plus counts.
- **Add a hand section.** For each `?hand` preset (Dactyl fit, Natural,
  Yours), print:
  - the rounded key frames from `applyHand` (`componentFrames` of the written
    config);
  - the `check()` problem list;
  - `buildFrame`'s volume, triangle count, mesh hash, piece count, faults and
    warnings.

  Add the same for one 1.5u thumb layout and one `from: 'press'` setting, so
  those code paths run.
- **Build each variant once.** The standalone `buildChassis` call duplicates
  the work. Use the body that `buildSolid` builds if it is reachable without a
  behaviour change. Otherwise keep the call, but note it.
- **Keep the output deterministic.** Run it twice and diff the two outputs.

## Phase 1: clear bugs and divergences

These are small, high-value and independent of the big refactors.

### T1. Editor UI bugs (`main.ts`, `marks.ts`, `vite.config.ts`, `fit-check.ts`)

1. **The "Bottom section" checkbox is overridden after every build.**
   `setShell` (main.ts about 764) sets `basePlate.visible = !handCase || handCase()`
   directly. Move the hand-case gate into `visibility()`.
2. **The selection panel throws** when a selected cluster disappears, for
   example `thumb_extra` removed by Apply configuration, Undo or Redo. `fields()`
   paths then resolve to undefined. Clear `selected` when its paths no longer
   resolve. Apply's partial state (snapshot taken, `edited()` never run) must
   not happen.
3. **`fields()` finds a column's index in `defaults`**, while `dragTo` finds it
   by name in the project. Look it up in the project.
4. **The opening pass rule is written four times.** solid.ts and fit-check.ts
   use `<= CHECKS.empty`, main.ts `< 0.001`. Add `passed` to each
   `report.openings` entry in solid.ts and read it everywhere.
5. **`fit-check.ts` can print CLEARANCE FAIL with no reason** because it never
   prints `capGaps`. Also, its `group !== 'keycaps'` filter is dead.
6. **`marks.ts` leaks GPU memory.** `redraw()` clears without disposing, and
   rebuilds every stroke on every pointermove. Dispose the meshes, and rebuild
   only the stroke being drawn.
7. **Saved marks would be committed.** Add `v4/editor/marks/` to `.gitignore`.
8. **The marks POST handler doesn't guard against bad JSON.** Wrap its
   `JSON.parse` in try and answer 400.
9. **In `?hand`, column and cluster handles and number fields record undo steps
   that `handLayout()` then overwrites.** Hide those handles and fields in
   `?hand` mode.

### T2. Hand prototype bugs (`hand-prototype.ts`, `hand-frame.ts`)

1. **Four ways of computing the angle round the thumb arc.**
   - The four: `printAngle`, `aroundOf` (wraps below −90°), `thumbRow`'s miss
     term (about 693) and the row's `around` (about 737).
   - Past 180° the unwrapped ones add a false miss ("out of reach") and show
     negative degrees.
   - Use one `aroundOf` everywhere. The presets must not move; check with the
     T0 hand fingerprint.
2. **The press animation keeps running** when "Thumb on" switches to rest
   while "pressing" is ticked (about 1786). Stop it.
3. **Stale UI and doc text:**
   - The Dactyl button title says the wrist is 63.1 mm up; the preset has 56.0.
   - The `DACTYL` doc says 12 mm and 24 mm; the code has 13 and 24.5.
   - The header says two presets; there are three.
   - The `touch` docstring still says the touching point moves toward the IP
     when the tip is up.
4. **`stateOf` checks types but not values.** `row: "foo"` crashes `draw`.
   Validate the enums and ranges.
5. **The basic "key spacing" slider clamps to 17–30**, while Advanced allows
   up to 40. Use one range.
6. **The cap height comes from two sources.** `capHeight(c)` uses the global
   `keycap_mm[2]`, while the check uses per-key `capSize(c, name)[2]`. Use the
   per-key size everywhere. They are equal today.
7. **Rename `check(..., frame)`**, which shadows the imported `frame()`.

### T3. Workers (`worker.ts`, `solid.ts` `buildSolidAsync`)

1. **No `router.onerror`.** A crashed routing worker hangs the build until the
   30 s watchdog. Reject the build with the error instead.
2. **Unhandled rejection.** If `shell()` throws, the `routed` promise has no
   rejection handler.
3. **The README and main.ts disagree on memory.** The README says every build
   frees everything; main.ts says builds leak and recycles the worker every 8
   builds. Find out which is true, and fix the comment or the README.

## Phase 2: one source of truth

### T4. Shared helpers in `geometry.ts` and `plates.ts`, and the dead fallbacks

- **`capClearance(cfg, name)`** next to `capSize`. It replaces the
  `keycap_clearance_overrides_mm[n] ?? keycap_clearance_mm` lookups in shell,
  chassis and solid (twice), and in `hand-prototype` `capBoxes`. `capBoxes`
  ignores overrides; check whether on purpose, and if not, use the helper.
- **`tileUnderside(cfg)`**: the pad z `-(plate_top_to_pcb_top + size[2])`.
  It replaces the copies in chassis, solid and wiring (twice).
- **The tile pocket half-width `size/2 + clearance`** (chassis, plates,
  wiring): one helper in plates.ts.
- **`isThumb` and key filters.** Use geometry's `isKey` and an `isThumb`.
  wiring.ts and chassis.ts reimplement them.
- **`keyGroups(cfg)`**: the extra-thumb set and key groups. They are built
  twice in solid.ts, and there `groups` is shadowed.
- **Export plates.ts `axisDir` and its centre helper.** Delete chassis
  `planDir` and `centre`. Use them in wiring `facing` where the maths is the
  same.
- **Remove the `??` fallbacks for fields Config always has.**
  - The fallbacks: `travel_mm ?? 4` (×3), `keycap_clearance_mm ?? 0.3`,
    `base_thickness_mm ?? 2`, and `seat_outer_mm ?? [16.6,…]` in seats.ts
    against `?? [15.8,…]` in hand-frame.
  - If an old project can lack a field, `migrate` must fill it from the
    defaults. Test this with a project missing `seat_outer_mm`.
- **The floor thickness is defined twice.** The shell's floor is `WALL`
  (shell.ts), while the adapter and landing use `chassis.base_thickness_mm`.
  Both are 2. Make the shell's floor read `base_thickness_mm`; the fingerprint
  stays identical.
- **`chassis.wall_mm` is dead.** The shell's wall is a fixed `WALL = 2`.
  - Remove `wall_mm` from the default config, the README and the variants.
    Keep it accepted when loading.
  - Don't wire it to the shell: that would change geometry (2.4 against 2).
- **Remove the other dead config fields:**
  - `switch.cutout_depth_overrides_mm`;
  - `tile.support_width_mm` and `tile.support_corner_length_mm`;
  - the three `tile.retaining_tie_*` fields;
  - `units`.

  Old projects that have them must still load.
- **Remove the `export { capSize, isKey }` re-exports** from chassis.ts and
  solid.ts.

### T5. One keycap envelope

There are four keycap envelopes:

| Where | Shape |
|---|---|
| shell `capSweep` | Straight box, plan only |
| chassis `keycapRoom`/`capGoes` | Taper from rest; box from `max(0, rest − travel)` |
| solid sweep | Taper from `rest − margin/2`; bottom not clamped |
| hand-frame room and hand-prototype `capBoxes` | Box with its own margins |

Make one `keycapEnvelope(cfg, name, opts)` builder, and one plain-numbers
description of it for the non-Manifold users. Each caller passes only
deliberate differences: clearance, the clamp at 0, and the frame's generous
margin.

- **Find out whether solid's `margin/2` z-shift is deliberate**, with
  `git log -S`. If it isn't, align it with chassis. That changes only check
  numbers, which the report fingerprint shows. Never change it silently.
- **Do not remove the at-rest and swept keycap checks** (the audit found
  `atRest` is always 0 by construction). That is an owner decision; see Out of
  scope.

## Phase 3: shared Manifold and mesh utilities, and dead code

### T6. `manifold-util.ts` and a single memory scope

- **Move the repeated Manifold idioms into `manifold-util.ts`:**
  - `prism` (`extrude(400).translate([0,0,-1])`, 5 copies);
  - the `slab` round a bounding box (4 copies);
  - `place` (3 copies);
  - the tapered box (solid and chassis);
  - wire `capsules` (solid and chassis);
  - `meshData` (solid and hand-frame).
- **Memory: keep only `freeAfter`.**
  - Add `freeAfterAsync` for `buildSolidAsync`.
  - Remove the hand-tracked `all`/`keep` in solid `build` and `made`/`keep` in
    hand-frame where `freeAfter` covers them.
  - Remove the manual `.delete()` calls that become redundant.
- **Break the type cycle:** move `Part` and `hardware()` to `parts.ts`, so
  wiring.ts no longer imports from solid.ts.
- **Use geometry.ts's vector helpers** in hand-frame instead of its local
  `add`/`unit`/`dot` and inline cross products. Use `Matrix4.makeBasis`.

### T7. Dead code

Check each item with grep (src, tests, configs) before removing it.

- **Unused exports:**
  - wiring: `segmentDistance` (the function), and the export keyword only on
    `WIRING`, `isThumb`, `wirePort`, `ribbonPath` and `landingEnd`;
  - chassis: `narrowPlates`, `facetFloor` and `SIZES` (export keyword);
  - geometry: `clusterFrames` and `migrate` (export keyword);
  - hand-frame: `FRAME`, `frameKeys`, `presses`, `convex`, `inside` and
    `clearOf`, if unused outside the file.
- **hand-prototype:**
  - `fit` (the Gauss–Newton solver, unused);
  - the `_test` entries no test uses;
  - `Host.rebuild`;
  - `innerColumn`'s `slide`/`place`, which are never read;
  - `heightOf`'s single-field object;
  - the `touch` dead `: TL[2]` branch.
- **hand-frame:** `thumbs`, `down`.
- **wiring:** `Obstacle.name`, which is written and never read.
- **solid:**
  - `Report.notes`, which is also stale;
  - `Clearance.travel`;
  - inline the one-call `record()`.
- **main.ts test hooks with no callers:** `getBuildRequests`, `getShellId`,
  `getReport`, `getSelected`, `viewNormal` and `lookFrom`. Grep the Playwright
  specs first.
- **main.ts:** the duplicate BufferGeometryUtils import.
- **marks.ts:**
  - `shown()`;
  - the `variant`/`thumbs` plumbing and the "other variant" redirect left from
    the shape-prototype viewer. The editor always passes chassis/editor.
- **CSS:** `.coords` and the `select` rules, if unused.
- **Tests:** the orphan comment at geometry.test.ts 11–13.
- **From the T1 review:**
  - marks.ts writes the same dispose loop twice; make it one helper.
  - On pointerup, marks.ts doesn't need a full redraw.
  - geometry.test.ts has an openings assert made redundant by `passed`.
- **tsconfig:** turn on `noUnusedLocals` and `noUnusedParameters` if the tree
  then compiles clean. Fix the four it finds.

## Phase 4: per-file deduplication and patch removal

### T8. `chassis.ts`

1. **The corner-fill search builds 32 hulls for 8 real quads.** 16 of them are
   degenerate 3-key hulls inside a real one.
   - Enumerate each quad once, requiring `diag[1] !== n`.
   - Volume and checks unchanged; the mesh hash may change. Report it.
2. **Duplicates to merge:**
   - `offPlate` is `box(n, span(n,0), span(n,1), zs)`;
   - `keepClear` re-implements `down()`;
   - the skirt-minus-well-offset is written twice.
3. **The switch hole is cut twice at different sizes.**
   - chassis cuts `cutout_mm` (14). solid.ts refills the seat and re-cuts at
     `cutout + clearance` (14.15).
   - If no consumer of `buildChassis().body` needs the 14 mm hole (fingerprint
     only, hand-frame?), drop the chassis cut, or cut once at the final size.
   - The solid hash must stay identical; the body hash may change.
4. **Move the `sheet` closure into plates.ts**, which already holds
   `plateEdges`. Extract `pockets()`, `skirts()` and `keycapRooms()` from
   `buildChassis`.
5. **Doc comments:**
   - Move the stranded "Construction sizes…" doc onto `SIZES`.
   - Fix the misordered `skirtWireClear`/`skirtPiece` doc.
6. **Not done; see Out of scope, item 10.** Separate commit: the tile pocket depth formula.
   - chassis treats `tile.components[].center_mm[2]` as measured from the
     tile's underside (it adds `size_mm[2]`). `hardware()`, wiring and the
     config measure it from the tile top. The pocket ends up 1.6 mm deeper
     than its own definition.
   - Use the same convention as `hardware()`. Report the geometry delta and
     confirm all checks still pass on every variant.
   - If any check newly fails, stop and leave it for the owner.

### T9. `shell.ts`: deduplication

1. **The carried thumb bin builds geometry that is thrown away:** `parting`,
   `cavity`, the trough boolean and the shell subtract chain. `c64()` discards
   them. Build them only when used. Fingerprint identical; faster builds.
2. **Three near-copy section builders** (plain, apron-carrying,
   `apronSection`). Extract:
   - `slope(f, y)` (the central difference, 5 copies);
   - `bullnose(z, yf)`;
   - `rampToFlatTop(z, yB, yG, zT)`;
   - `binDepths(wb, o)` (`yB/tB`, `yG/tG`).
3. **Repeated primitives.** Extract and reuse:
   - `stations(x0, x1, inset, extra)` (the end-rounding stations, 2 copies);
   - the nearest point on a segment (`trace`, `junctions`);
   - the vertical-line crossing (`span`, `top`);
   - the `near(y)` closure (2 copies);
   - smoothstep (2 copies);
   - `n = 240` (2 copies).
4. **Name the magic numbers:**
   - the photo constants (`104*PX`, `60*PX`, `93*PX`);
   - the port panel numbers;
   - the `PART − 0.6` split, shared with the parting slab.

   They go at the top with the other case sizes, as the README claims.
5. **`largest()` picks an outline by vertex count; `trace()` picks by area.**
   Use area. The fingerprint must stay identical; if it changes, investigate
   before keeping the change.
6. **`thumbAngle` reads `frames.thumb_far` and `thumb_near` by name.** A
   renamed thumb key crashes it. Use the cluster's first and last keys.
7. **Declare `HOLD` before its use.**
8. **Comments:** remove the duplicate loft comment (131–136 = 202–207) and trim
   the long narrating ones (the audit lists 77–84, 485–494, 682–690, 778–784,
   937–942, 996–1000, 1011–1014 and 1163–1168).

### T10. `shell.ts`: split into modules

`breadbin()` is about 720 lines, with `joined()` nested inside it. After T9,
split it into:

- `src/shell/loft.ts`: `trace`, `shares`, `samples`, `loft`, `mesh`, `bezier`;
- `deck.ts`: `curvedDeck`, `binWell`, `binSurface`, `apronDeck`;
- `sections.ts`;
- `bin.ts`: `breadbin`, `joined`;
- `port.ts`: panel, neck, landing, ties;
- `index.ts`, which keeps the public `shell()` API.

The move only; no logic changes. Fingerprint identical.

### T11. `solid.ts`

1. **Seat construction belongs with construction.**
   - The seat fill, trims, clip reliefs and switch openings are construction,
     not checks. Move them into seats.ts, behind a `seatSwitches(...)` the
     build calls.
   - Merge the duplicated seat-slab and clip boxes into `seatBox(m, inset)` and
     `clipBox(m, sign, inset)`.
2. **Split `build()` (about 550 lines)** into one function per check, each
   returning `{report part, highlights}`. Make the region cutting a small
   `RegionIndex`, and state its rationale once (it is repeated three times
   now).
3. **Move the magic numbers into `CHECKS`:** the probe sizes 0.3, 0.4 and 24,
   the ring hole height 10 and the region pad 0.1.
4. **Comments:**
   - Remove the history of the wedge bug (about 464–468).
   - Merge the two doc lines on `trim`.

### T12. `wiring.ts`

1. **Mutable side-channel flags.** `strayed`, `stuck`, `keep` (really the wire
   radius) and `wide` are shared through closures; `wide` is read before it is
   declared. Pass them as parameters and return values. Remove the `places_`
   alias.
2. **Magic numbers go into `WIRING`, one doc line per field:**
   - `GRID = 6`, `rank + 100`, `edgeAsides.slice(0,3)`, `loomLevels.slice(0,7)`
     and `r + 0.1`;
   - the climb steps;
   - `Math.max(1.5,…)` and `foot = 1`;
   - the ribbon offsets.

   Split the compound `WIRING` docs that describe 6–7 fields in one sentence.
3. **The port grid is hard-coded to ±4.** Derive the range from `room/pitch`,
   making sure it covers at least ±4 for the default. The routes must stay
   identical.
4. **Split the ~990-line `wiring()` closure** into `src/wiring/`:
   - `tubes.ts`;
   - `obstacles.ts`;
   - `paths.ts` (legs, joins, climbs, port places);
   - `candidates.ts`;
   - `negotiate.ts`, which is pure, with a unit test of negotiation on a small
     synthetic case;
   - `adapter.ts` (holes, ribbon, landing, `adapterParts`, `padParts`);
   - `index.ts`.
5. **Fix the stale comments:**
   - The header says the wiring has "no geometry engine so it redraws while
     dragging"; routing runs in the worker now.
   - The comment at about 949–952 describes the old one-at-a-time layering.
   - The orphan `blocked` doc.

### T13. Hand prototype: helpers and duplication (`hand-prototype.ts`)

1. **Bisection is hand-written six times**, with different iteration counts:
   `innerColumn`, `thumbAt` lowered and swing, `thumbAlong`, the `thumbRow`
   1.5u bend and `mixFor`.
   - Write `bisect(f, target, lo, hi, n)` → `{x, clamped}` and
     `bracketThenBisect`. Put them in `src/hand/solve.ts`.
   - Keep each call's iteration count so the results are identical.
2. **Smaller duplicates:**
   - the row distance `r==='top'?…` (3 copies) → `rowDistance(s, r)`;
   - `['far','home','near']` (10 copies) → `THUMB_ROW` constant;
   - Euler → rounded degrees (3 copies);
   - the inline override type (3 copies; rename the clashing `Pose`);
   - `mapChain` for the chain transforms (3 copies);
   - line 201's copy of `dipOf`;
   - the column-frame build (`capsOf` and `applyHand`/`placeColumns`).
3. **Tests must not copy source.** Export `carry` and `thumbPart` instead of
   the copies in hand.test.ts.
4. **`capName` is the same as hand-frame `label`.** Keep one.
5. **The thumb-row solver: leave the algorithm alone.** The presets are fitted
   to its numerics. Only:
   - make each fixed-point loop report non-convergence (a returned flag,
     surfaced as a readout warning, not a thrown error);
   - document the miss re-add.
6. **Gather the scattered tolerances into one `TOL` table.**
7. **Solve once per edit.** `solveHand` runs twice per edit. Cache it by state
   if that is trivial; otherwise skip.
8. **Comments.** Cut about half of the ~396 comment lines:
   - the 43-line header (it says what `solveHand` does twice);
   - the preset docs' fitting history (`DACTYL`, `NATURAL`, `YOURS`);
   - `twistAt`, `thumbAt` and `thumbRow` (cut to the formula and citations);
   - `placeColumns` and `applyHand` history.
   - Shorten the paragraph-long test names in hand.test.ts.
   - Fix the "reported, not asserted" comment that the test contradicts.

### T14. Hand prototype: split, and a declarative panel

`hand-prototype.ts` (about 2300 lines) splits into `src/hand/`:

- `model.ts` (finger chain, row poses, thumb kinematics, `touch`, `keyAt`,
  `thumbRow`);
- `check.ts` (caps, boxes, SAT, `partHits`, `reachHits`, `check`, `problems`);
- `layout.ts` (Settings, presets, `solveHand`, `mixFor`/`wayOf`, `place*`,
  `anchorOf`/`layoutOf`);
- `panel.ts` (`setupHand`);
- `index.ts` with `setupHand` and `_test`.

`hand-frame.ts` moves in as `hand/frame.ts`.

**The panel.** Its 20+ slider, radio and checkbox calls become one declarative
table of `{key, label, min, max, step, basic?}`. That also keeps the basic and
Advanced ranges from drifting apart.

**Tests.** Update the imports. Browser tests (`test:hand`) must pass.

### T15. Hand frame (`hand-frame.ts`, `hand/frame.ts` after T14)

1. **The keep-out boxes are written twice:** analytically in `clearOf` and as
   Manifolds in `buildFrame`. Build both from one
   `keepOutBoxes(cfg, key) → [half, z0, z1][]`.
2. **`extend(reach, ok, step, max)` replaces the three bracket-extend loops**
   (legs, gap nodes, posts) and the raise loop where it fits. Name the
   `bracket*12` / `most` limit once.
3. **The 30° steep test is written twice.** Keep one.
4. **Make `Node` a tagged union** (corner, gap, plate) so the `!` assertions
   go.
5. **Split `buildFrame` (about 585 lines) into named stages:** `keepOut`,
   `joinsAndWebs`, `legs`, `truss`, `rails`, `tipWarnings`, `thinWebs` and
   `faults`.
6. **Comments:** explain the truss once (it is now explained in the header and
   again at 399–410).
7. **Tests:**
   - a `frameStl` mirror and winding test;
   - a positive `capHits` test (two keys that overlap must be reported).

   Add them before the change.

### T16. `main.ts`: deduplication

1. **Repeated helpers:**
   - `commit(next, opts)` for validate, snapshot, assign, refresh, edited
     (6 copies). Undo and Redo share one `step(from, to)`.
   - `disposeChildren(obj)` (3 copies).
   - `placeCamera(...)` (4 copies, one in marks.ts).
   - `setBadge(kind, text)` (6 copies).
   - `restartWorker()` (2 copies).
   - one STL export handler.
   - the screen↔NDC maths shared with marks.ts.
   - `prettyKey(name)`.
2. **One `KIND_STYLE` table** generates the failure legend and the mesh
   colours. The CSS legend colours differ from the mesh colours today: pick the
   mesh colours. The README's colour list should match.
3. **One `reportLines(report)` for `showReport` and `fit-check.ts`.**
4. **The prototype URL overrides** (`?plates`, `?slope`, `?recess`) go behind
   one typed `prototypeOverrides(config)`. The saved report's
   `evaluatedProject` must be the project actually built.

### T17. `main.ts`: split

Split along these seams:

- `viewer.ts` (scene, camera, render, view persistence);
- `handles.ts` (handles, `dragTo`, `fields`, `getAt`/`setAt`), pure enough for
  node unit tests, which get added;
- `build-client.ts` (worker lifecycle, watchdog, revisions);
- `report-view.ts`;
- `project-store.ts` (project, undo/redo, commit, autosave, import/export);
- `scene-parts.ts` (hardware and wiring meshes and tables).

Move the HTML string from main.ts into `index.html`. Browser tests must pass.

## Phase 5: tests, docs, formatting

### T18. Test housekeeping

- **hand.test.ts:** memoise each preset's layout and frame, which are built
  about 4 times now.
- **geometry.test.ts:**
  - set up `Module()` once;
  - share the MeshData → Manifold wrapper.
- **Browser specs:** share one `project()` helper.
- **A test for the `?hand` build-case gate on the base:** `getVisible().base`
  is false while the case is off.
- **Coverage:** add negative tests for checks that have none, so none can
  silently become a no-op: seats, openings, pieces, hardware, wire vs chassis,
  solder. Use small deliberate breakages of the default config.

### T19. Docs and formatting

- **v4/editor/README.md, fix:**
  - the mangled opening ("TypeScript + Three.js + Manifold");
  - the stale thumb keycap (28 × 18.5 × 11, tapering to 14 × 14; 3.5 mm
    travel; 2.5 mm at full press);
  - the `wall_mm` mention;
  - the margin note;
  - the rebuild timing claim (drop it, or re-measure it);
  - the memory claim (per T3);
  - the pads-checked claim. Pads are not in the hardware check; fix the doc,
    or add pads to the check if the default and every variant still pass.
- **README cuts:** the repeated Python-reference paragraph, and the repeated
  stale-label lines.
- **README additions (short):**
  - `?hand` (dev only, `npm run test:hand`);
  - marks (M to paint, dev only, `marks/`);
  - the prototype URL flags;
  - `CLEANUP-PLAN.md` status.
- **Move the Construction and Wiring sections** (about 110 lines, chassis
  design rather than editor use) to `v4/docs/editor-chassis.md`, linked from
  the README. Keep the README to Run, Use, Checks and Validation.
- **Root README.md:** fix the stale "38 shape controls" line.
- **A short `?hand` design note** in `v4/hand/README.md`, or an editor doc, so
  the commit messages aren't its only documentation.
- **Formatting:** bring `style.css`, `index.html` and the Playwright configs
  under `npm run format` and format them.

### T20. Final comment sweep

Read every src file once more for history narration, restated code and stale
claims left after T1–T19.

## Out of scope: owner decisions

The audits raised these. They change behaviour or need a design call, so they
are listed but not done.

1. **The `?plates=narrow|facets`, `?slope` and `?recess` prototypes**: about
   150 untested lines threaded through `sheet()`. The router also doesn't know
   about them. Drop them, or keep them?
2. **The at-rest and swept keycap checks in solid.ts can barely fail.**
   - The chassis already carved each keycap room, so `atRest` is always 0, and
     `swept` fails only when a pressed cap goes below the plate, which the UI
     rejects.
   - They cost about 40 booleans per build.
   - Option: replace them with config validation plus `roomCuts`.
3. **`chassis.wall_mm`**: wire it to the shell's wall (a geometry change,
   2.4 mm against 2 mm), or keep it removed (T4).
4. **The wire tubes in the checks are under-sized** (8-segment spheres), so
   they under-report contact.
5. **The thumb well wall's depth** follows the thumb bin's own deck, not the
   apron deck that is actually built. It needs checking visually.
6. **Joins assume `across()` is symmetric.** No current layout breaks it.
7. **The `thumbs` fingerprint variant already fails its checks.** Is that
   intended, or should the variant be adjusted?
8. **The thumb-row solver** is three nested fixed-point and bisection layers.
   It could become one joint solve, but the presets would need refitting.
9. **The bottom section is never checked for loose pieces.** A floating
   adapter mount would pass every check. T4 added a test for the default and a
   3 mm skin, but the report doesn't check it.
10. **The tile pocket is 1.6 mm deeper than its own definition.**
    - chassis.ts measures `tile.components[].center_mm[2]` from the tile's
      underside, where parts.ts, wiring and the config measure it from the top.
      The pocket comes out 11.0 mm deep; its definition gives 9.4.
    - T8 tried the fix. It is unchanged on every variant except `thumbs`: there
      it adds 13 mm³, and a ring-bottom to pinky-bottom wire newly clips the
      case by 0.13 mm. So the fix was not kept.
    - To apply it, either accept that failure or give the wire room.
11. **`?hand` documentation** lives mostly in very long commit messages.
12. **A seat 19 mm or wider fails to build ("Invalid chassis:
    InvalidConstruction").**
    - `gluePads` in chassis.ts runs each glue leg from
      `seat/2 + glueSeatGap` to `tile.size_mm/2`. Once the seat is wider than
      about 18.8 mm, that leg has no length.
    - The seat-size setting allows up to 25 mm.
    - Either validate (reject a seat wider than `tile − 2·glueSeatGap`), or
      leave out legs that have no room.
    - Found during T11. It already fails at HEAD.
13. **The `?hand` solver doesn't say when a loop fails to converge.** This was
    T13 item 5.
    - The loops are `keyAt`, the `thumbRow` home-key settle and the extra
      keys' Newton loop.
    - `thumbRow` already adds an unsettled residual to `miss`, so it shows as
      "short".
    - A visible flag would be a new readout, not a refactor, so T13 left it
      out.

## Status

| Task | Status | Commit |
|---|---|---|
| T0 | done | |
| T1 | done | |
| T2 | done | |
| T3 | done | |
| T4 | done | |
| T5 | done | |
| T6 | done | |
| T7 | done | |
| T8 | done | |
| T9 | done | |
| T10 | done | |
| T11 | done | |
| T12 | done | |
| T13 | done | |
| T14 | pending | |
| T15 | pending | |
| T16 | done | |
| T17 | done | |
| T18 | pending | |
| T19 | pending | |
| T20 | pending | |
