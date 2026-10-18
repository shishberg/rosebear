# The `?hand` prototype

A throwaway tool in the [editor](../editor/README.md) for laying out the finger and
thumb keys from how a hand reaches them, instead of by eye. It is in dev builds only
(`make v4-editor`, then open `http://127.0.0.1:5177/?hand`). The code is in
`v4/editor/src/hand/`; file paths below are relative to `v4/editor/`.

## What it does

The measured left hand ([`v4/hand/left-hand.json`](../hand/left-hand.json), mirrored
into the right half's layout axes; see [the hand model](../hand/README.md)) is drawn
over the board. Every slider rewrites the finger columns, the thumb row and the extra
thumb keys in the project (`applyHand` writes the keys, `tent_deg` and `thumb_extra`), so Undo restores them and the normal editor then shows, checks and builds the
result. The readout says first whether the layout is valid, or lists what is wrong.

## The hand model

- **Fingers** (`src/hand/model.ts`): chains MCP, PIP, DIP and pad from the resting pose.
  At every key the reach between rows is along the keyboard and the press is square to
  it. Each row is set as its distance from home, centre to centre (`top`, `bottom`).
  The inner column is set by its gap from the index column and its angle from it, the arm
  carrying the hand sideways with the index turned at its knuckle.
- **Rows reached from** (Advanced): `wrist height` or `press mix`. With wrist height, the
  thumb's CMC is held that many mm above the middle home key's top, and the reach mix
  (MCP degrees per PIP degree between rows) follows from it and the finger curl
  (`mixFor`). With press mix, the path is set by PIP and DIP degrees per MCP degree
  (Jindrich et al. 2004 measured about 1.4).
- **Thumb**: a ball joint at an assumed CMC, hinges at the MCP and IP. The home key's pose
  is interpolated from the photographed poses round one arc (`thumbAt`); the far and near
  keys come from the reach mix (`thumbAlong`). Its turn about the metacarpal comes with
  the CMC's swing (`twistAt`, after Crisco et al. 2015).
  The thumb's reach between keys and its press are mixes of three movements: radial
  abduction, palmar abduction and curl. Each key faces against the press (`keyAt`).
  `thumbRow` places the far, home and near keys round the arc by `around`, `drop` and
  `spacing`. The `parallel` setting makes the far and near keys keep the home key's y,
  tilted along the row toward their press. In the `1×3` the 1.5u home key lies across
  the row and slides along its length to sit in line with the far and near keys'
  centres (`inLine`); the thumb still touches it where it did. `turn` and `pivot` turn
  the row as one about a line along it, `pivot` mm under the home key (+ toward the
  thumb's base, the faces turning with the keys, as round a dome), and the thumb's pose
  on each key is refitted (`turned`). Sliding round the arc turns the keys the other way.
- **Clusters**: `1×3`, or `1.5u + 2×1u`, where the two 1u keys form a second row whose
  middle is `two.gap` mm from the 1.5u key, each key `spacing` / 2 from that middle.
- **Extra thumb keys** x1 and x2 (optional, `extraKeys`): a second row hung off the thumb row
  like the next key down a column, x1 under the gap between the home and near keys and
  x2 under the one between the far and home keys. Each is carried from its gap toward the
  thumb's base, bent about the row, spread to the row's key spacing, lowered along its
  normal, and last the pair slides together along the row. They are placed by those
  settings alone, not by the thumb; the thumb's pose on each follows from the key, for
  the checks and readout only. They are pressed with the thumb's side or base, which the
  model doesn't have, so the back-of-thumb check skips them. Where each preset puts them
  is part of the preset (`EXTRA` unless it has its own).
- **Presets** (`src/hand/layout.ts`, the "Start from" buttons): `Dactyl fit` (near the Dactyl Manuform, fitted by a test
  to the valid layout whose keys are closest to it), `Natural` (the least change from
  the resting hand that is valid), `Yours` (set by hand in the editor from the Dactyl
  fit, then the thumb refitted), `No curl` (Yours with the thumb reaching and pressing
  without curling, the extra keys as last printed) and `Swung in` (No curl with the row
  turned toward the thumb's base, the home key about halfway to where x1 was; the
  editor's default project is Swung in).
  `tests/hand.test.ts` checks that each but Swung in is valid, with the test frame too;
  Swung in's warnings are the model's limits.

## The checks

`check` in `src/hand/check.ts` runs on every change, and `problems` words the failures:

- keycaps hitting each other (the tapered caps, in slices) and 19 mm tiles hitting each
  other (with the socket, LED and diode under them);
- any part of the hand going into any part of the keyboard (`reachHits`) while reaching for
  a key, except into that key: each key in turn, with the reaching digit checked on its
  way, on the key and pressing, and the palm. The other digits rest on their home keys,
  except when reaching the inner column, where the arm carries the index sideways and
  they are checked only at home;
- rows or thumb keys out of reach, the thumb's MCP or IP past its range, a press that
  moves the thumb off the key, a key met with the back of the thumb, the inner column
  out of reach, and a wrist height the finger curl can't give;
- the board's height against the 66 mm tray.

## The test frame

`src/hand/frame.ts`, shown with **Test frame**, builds a wireframe that holds each
switch where the layout puts it, to print and try for feel. It has no wiring room,
walls or bottom. Print it this way up with the slicer's tree supports; **Right STL** and
**Left STL** export it. Each key is a plate ring with a lip, and neighbours are joined
by webs between their facing walls. Each plate of joined keys stands on legs at its
outer corners, with a truss along each outside wall, a rail round the feet, and posts
where a diagonal would be too shallow. Switches, keycaps and switch tops are cut out
of it. The hand check also runs against the frame's mesh. Its header comment has the
full rules.

## The panel

`src/hand/panel.ts` builds the panel from a table of control specs in
`src/hand/controls.ts`: a Basic section and an Advanced one that shares its ranges, with
the preset buttons, Copy and Paste settings (the layout as JSON), choices of where the hand
and thumb are drawn, a pressing animation and a rotation handle that turns the hand. **Build
the case** builds the chassis from the layout, and often fails; until it's ticked, the
line under the view shows the board's height against the tray (the panel always does).
All of it is one state in
the project, so Undo, the autosave and Save project carry it.

## Running it

```sh
make v4-editor                  # then open http://127.0.0.1:5177/?hand
npm --prefix v4/editor run test:hand   # the ?hand browser tests, on port 5179
npm --prefix v4/editor test            # includes the hand model, solver and frame tests
```

The history of each decision is in the commit messages for `src/hand/` (earlier,
`src/hand-prototype.ts` and `src/hand-frame.ts`):
`git log --format='%h %s%n%b' -- v4/editor/src/hand`.
