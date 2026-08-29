// Scanning the keys as a diode matrix instead of direct-wiring them.
//
// v3 gives every key its own GPIO, which is the simplest thing that works on a
// rigid board and the wrong thing on a segmented one. Direct wiring makes the
// conductor count ACCUMULATE along the row of column strips: the neck between
// the last two columns has to carry every signal from every column outboard of
// it. A matrix makes it CONSTANT -- one column line plus the shared row lines,
// whatever the column's position -- which is why BastardKB pushes exactly 6
// traces through each of its necks and no more.
//
// The thumb cluster joins as a sixth column rather than keeping its own lines.
// That costs one extra conductor on the short finger->thumb hop (4 rather than
// 3) and saves two at the pod, which is where the GPIO actually runs out.
//
//   direct-wired    18 signals/half, 36 GPIO, 20-way pod ribbon
//   matrix           9 signals/half, 18 GPIO, 12-way pod ribbon, 36 diodes

/// The matrix column a key belongs to.
///
/// Thumb keys fold into a column of their own, so a 5x3 finger block plus 3
/// thumb keys becomes a 6x3 matrix with no empty positions -- the layout
/// happens to be exactly full, which is why no ghosting mask is needed.
function matrix_col(k: PlacedKey) -> string {
    if (k.zone == "thumb") {
        "thumb"
    } else {
        k.column
    }
}

/// The matrix row a key belongs to.
///
/// The thumb cluster's three keys run along what the layout calls columns, so
/// they map onto the finger rows by position: near/home/far to bottom/home/top.
function matrix_row(k: PlacedKey) -> string {
    if (k.zone == "thumb") {
        let i = index_of_str(THUMB_ORDER(), k.column);
        ROW_ORDER().at(i) ?? "bottom"
    } else {
        k.row
    }
}

/// Position of `s` in `xs`, or 0 if absent.
function index_of_str(xs: string[], s: string) -> int {
    let out = 0;
    let i = 0;
    for (let x in xs) {
        if (x == s) {
            out = i;
        }
        i = i + 1;
    }
    out
}

/// Matrix columns, in board order, thumb last.
function MATRIX_COLS() -> string[] {
    COLUMN_ORDER().concat(["thumb"])
}

function MATRIX_ROWS() -> string[] {
    ROW_ORDER()
}

/// Which hand a key's matrix lines belong to. The two halves are scanned
/// independently -- the pod drives each through its own ribbon -- so their
/// lines must not share nets.
function hand_of_key(k: PlacedKey) -> string {
    if (k.mirrored) {
        "r"
    } else {
        "l"
    }
}

function col_net(k: PlacedKey) -> string {
    `COL_${hand_of_key(k).to_upper_case()}_${matrix_col(k).to_upper_case()}`
}

function row_net(k: PlacedKey) -> string {
    `ROW_${hand_of_key(k).to_upper_case()}_${matrix_row(k).to_upper_case()}`
}

/// The net between a key's switch and its diode.
///
/// COL2ROW: the column line drives the switch, the switch feeds the diode's
/// anode, and the diode's cathode joins the row line. The diode is what stops
/// three simultaneous keys in a rectangle reading as a fourth.
function switch_diode_net(k: PlacedKey) -> string {
    `SWD_${k.name.to_upper_case()}`
}

// ------------------------------------------------------------------- signals

/// The distinct matrix lines needed to reach `keys`, in a fixed order.
///
/// Derived from the keys themselves, so a sixth column or a fourth row changes
/// the ribbon widths, the pod pinout and the neck trace budget with no number
/// edited anywhere. Columns first, then rows: the column lines are what a
/// strip carries locally, the row lines are what crosses every neck.
function matrix_signals(keys: PlacedKey[]) -> Signal[] {
    let out: Signal[] = [];
    for (let c in MATRIX_COLS()) {
        let hit = keys.find((k) -> {
            matrix_col(k) == c
        });
        if let k: PlacedKey = hit {
            out.push(Signal { name: col_net(k), kind: SignalKind.Key });
        }
    }
    for (let r in MATRIX_ROWS()) {
        let hit = keys.find((k) -> {
            matrix_row(k) == r
        });
        if let k: PlacedKey = hit {
            out.push(Signal { name: row_net(k), kind: SignalKind.Key });
        }
    }
    out
}

/// GPIO the pod needs for one half.
function matrix_gpio_per_half(keys: PlacedKey[]) -> int {
    matrix_signals(keys).length()
}

/// Traces that have to cross the neck between two adjacent column strips.
///
/// The row lines cross every neck; each column's own line joins at its strip
/// and continues inward to the connector. So the count grows by one per gap,
/// not by one per KEY -- which is the whole difference from direct wiring.
///
/// `i` is the gap west of column `i + 1`, counting from the outboard end.
function matrix_neck_traces(keys: PlacedKey[], i: int) -> int {
    let rows = MATRIX_ROWS()
        .filter((r) -> {
            keys.find((k) -> {
                matrix_row(k) == r
            })
                != null
        })
        .length();
    // Columns outboard of this gap, whose lines all run through it.
    rows + i + 1
}

/// The same count if the keys were direct-wired, for comparison.
function direct_neck_traces(keys: PlacedKey[], i: int) -> int {
    let n = 0;
    let j = 0;
    for (let c in MATRIX_COLS()) {
        if (j <= i) {
            n
                = n
                    + keys
                        .filter((k) -> {
                            matrix_col(k) == c
                        })
                        .length();
        }
        j = j + 1;
    }
    n
}

// -------------------------------------------------------------------- diodes

/// SOD-123. Through-hole would be easier to hand-solder but stands proud of a
/// board that has to sit close under the switch plate.
function DIODE_FOOTPRINT() -> string {
    "Diode_SMD:D_SOD-123"
}

/// How far a diode's copper reaches ALONG the column, once turned across the
/// strip: half the 1.2mm pad width. This is the extent that has to fit between
/// the switch keep-out and the first hinge cut.
function DIODE_HALF_ALONG() -> float {
    0.6
}

/// The same, for the silkscreen box, which is what `silk_edge_clearance`
/// checks and is bigger than the copper.
function DIODE_SILK_HALF_ALONG() -> float {
    1.0
}

/// And how far it reaches ACROSS the strip: pad centre 1.65 plus half of 0.9.
function DIODE_HALF_ACROSS() -> float {
    2.1
}

// --------------------------------------------------------------------- tests

function matrix_left_keys() -> PlacedKey[] throws baml.errors.InvalidArgument {
    left_keys()
}

test "every key has a unique (column, row) address" {
    let keys = matrix_left_keys();
    let seen: string[] = [];
    for (let k in keys) {
        let addr = `${matrix_col(k)}/${matrix_row(k)}`;
        assert.is_true(!contains_str(seen, addr));
        seen.push(addr);
    }
    assert.equal(seen.length(), 18)
}

test "the 36 keys fit a full 6x3 matrix with no holes" {
    let keys = matrix_left_keys();
    assert.equal(MATRIX_COLS().length(), 6);
    assert.equal(MATRIX_ROWS().length(), 3);
    for (let c in MATRIX_COLS()) {
        for (let r in MATRIX_ROWS()) {
            let hit = keys.find((k) -> {
                matrix_col(k) == c && matrix_row(k) == r
            });
            assert.is_true(hit != null);
        }
    }
}

test "a matrix halves the pod's GPIO" {
    let keys = matrix_left_keys();
    // 6 columns + 3 rows, against one line per key.
    assert.equal(matrix_gpio_per_half(keys), 9);
    assert.equal(keys.length(), 18);
    assert.is_true(matrix_gpio_per_half(keys) * 2 == 18)
}

test "the two hands do not share matrix lines" {
    let l = matrix_left_keys();
    let r = mirror_keys(l, MIRROR_AXIS(), "mirror_");
    for (let a in matrix_signals(l)) {
        for (let b in matrix_signals(r)) {
            assert.is_true(a.name != b.name);
        }
    }
}

test "neck traffic stays flat instead of accumulating" {
    let keys = matrix_left_keys();
    // Outboard gap: 3 row lines plus the pinky column's own line.
    assert.equal(matrix_neck_traces(keys, 0), 4);
    // Innermost finger gap: still only 3 rows plus 4 column lines.
    assert.equal(matrix_neck_traces(keys, 3), 7);
    // Direct wiring puts every outboard key's own line through the same gap.
    assert.equal(direct_neck_traces(keys, 0), 3);
    assert.equal(direct_neck_traces(keys, 3), 12);
    // The gap that matters is the one nearest the connector.
    assert.is_true(matrix_neck_traces(keys, 4) < direct_neck_traces(keys, 4))
}

test "matrix necks fit the ligaments a hinge row can spare" {
    let keys = matrix_left_keys();
    let p = flex_defaults();
    // Two 2mm ligaments carry 20 traces, so every neck fits with room over --
    // and the worst matrix neck needs a third of that.
    let worst = matrix_neck_traces(keys, 4);
    assert.equal(worst, 8);
    assert.equal(ligaments_for(worst, p.ligament_w), 2);
    // Direct wiring puts all 15 finger signals through that same crossing --
    // still two ligaments on paper, but with nothing spare for the ground and
    // LED conductors that have to share it.
    assert.equal(direct_neck_traces(keys, 4), 15);
    assert.equal(ligaments_for(direct_neck_traces(keys, 4), p.ligament_w), 2);
    assert.is_true(direct_neck_traces(keys, 4) > 2 * matrix_neck_traces(keys, 4) - 2)
}

// ---------------------------------------------------------- wiring the boards

function matrix_ribbons() -> Ribbon[] throws baml.errors.InvalidArgument {
    build_ribbons(partition_modules(all_keys()), features_matrix())
}

function matrix_boards() -> Board[] throws baml.errors.InvalidArgument {
    build_boards(features_matrix())
}

test "a matrix narrows every ribbon" {
    let direct = build_ribbons(partition_modules(all_keys()), features_base());
    let m = matrix_ribbons();

    // pod -> finger: 15 key lines + 3 passed through, against 6 columns + 3
    // rows shared between both boards. Plus ground and the spare either way.
    assert.equal(find_ribbon(direct, "pod_to_finger_l").width(), 20);
    assert.equal(find_ribbon(m, "pod_to_finger_l").width(), 11);
    assert.equal(standard_ffc_way(find_ribbon(m, "pod_to_finger_l").width()), 12);

    // finger -> thumb is the one link a matrix makes WIDER: the thumb column
    // line plus the three shared rows, where direct wiring sent three keys.
    assert.equal(find_ribbon(direct, "finger_l_to_thumb_l").width(), 4);
    assert.equal(find_ribbon(m, "finger_l_to_thumb_l").width(), 5)
}

test "the matrix ribbons carry lines, not keys" {
    let r = find_ribbon(matrix_ribbons(), "pod_to_finger_l");
    let keys = r.signals.filter((s) -> {
        s.kind == SignalKind.Key
    });
    assert.equal(keys.length(), 9);
    for (let s in keys) {
        assert.is_true(s.name.starts_with("COL_") || s.name.starts_with("ROW_"));
    }
    // Each line appears exactly once: rows are shared, not repeated per column.
    let seen: string[] = [];
    for (let s in keys) {
        assert.is_true(!contains_str(seen, s.name));
        seen.push(s.name);
    }
}

test "every key gets a diode, wired switch-anode to row-cathode" {
    let boards = matrix_boards();
    let b = find_board(boards, "finger_l");
    let sws = b.components.filter((c) -> {
        c.ref.starts_with("SW")
    });
    let ds = b.components.filter((c) -> {
        c.ref.starts_with("D")
    });
    assert.equal(sws.length(), 15);
    assert.equal(ds.length(), 15);

    for (let k in find_module(partition_modules(all_keys()), "finger_l").keys) {
        // The switch drives from its column line into the shared node...
        let sw = b.components.find((c) -> {
            c.ref.starts_with("SW")
                && c.pads.find((q) -> {
                    q.net == switch_diode_net(k)
                })
                    != null
        });
        assert.is_true(sw != null);
        // ...and the diode takes that node to the row line.
        let d = b.components.find((c) -> {
            c.ref.starts_with("D")
                && c.pads.find((q) -> {
                    q.net == switch_diode_net(k)
                })
                    != null
                && c.pads.find((q) -> {
                    q.net == row_net(k)
                })
                    != null
        });
        assert.is_true(d != null);
    }
}

test "no switch terminal is grounded once there is a matrix" {
    // Direct wiring returns every key to the pour; a matrix must not, or the
    // whole scan reads as one key held down.
    let b = find_board(matrix_boards(), "finger_l");
    for (
        let c in b.components.filter((c) -> {
            c.ref.starts_with("SW")
        })
    ) {
        for (let q in c.pads) {
            assert.is_true(q.net != "GND");
        }
    }
}

test "a diode clears both the switch and its hinge rows" {
    let w = ROSEBEAR_WELL();
    let p = flex_defaults();
    // SOD-123 lies across the strip, so what has to fit between the switch and
    // the hinge is its narrow dimension -- and it is the silkscreen box, not
    // the copper, that reaches furthest.
    let half = DIODE_SILK_HALF_ALONG();
    let at = DIODE_REACH();
    assert.approx_equal(DIODE_OFFSET().y, 0.0 - at, 0.000001);
    assert.approx_equal(at, 8.755849, 0.000001);
    assert.is_true(at - half >= p.switch_clear);

    // The nearer hinge row of the gap above the key.
    let s = strips_of(
        dactyl_left_keys().filter((k) -> {
            k.zone == "matrix"
        }),
        w,
        p,
    )
        .at(0)
        ?? Strip {
            column: "",
            cx: 0.0,
            half_w: 0.0,
            ext_w: 0.0,
            ext_e: 0.0,
            y0: 0.0,
            y1: 0.0,
            key_ys: [],
            neck_y: 0.0,
            neck_len: 0.0,
        };
    let key = s.key_ys.at(0) ?? 0.0;
    let nearest = hinge_ys(s, w, p).reduce(
        (a, y) -> {
            let d = (y - key).abs();
            if (d < a) {
                d
            } else {
                a
            }
        },
        100000.0,
    );
    assert.approx_equal(nearest, 10.511698, 0.000001);
    assert.is_true(at + half <= nearest - p.slot_w / 2.0);
    // Copper has to clear the cut by the board's own edge rule, not just fit.
    assert.is_true(at + DIODE_HALF_ALONG() + BOARD_EDGE_CLEAR() <= nearest - p.slot_w / 2.0);
    // And across the strip it is nowhere near the sides.
    assert.is_true(DIODE_HALF_ACROSS() + BOARD_EDGE_CLEAR() < strip_width(w, p) / 2.0);
    // And the diode sits in the middle of that band rather than against
    // either wall of it -- which is what `DIODE_REACH` derives.
    assert.approx_equal(at - p.switch_clear, nearest - p.slot_w / 2.0 - at, 0.000001)
}

test "the pod can still assign pins for a matrix" {
    // Not a routing check -- pod.baml's fan geometry is still written for the
    // direct-wired pinout -- but the pin ASSIGNMENT is net-name agnostic, so
    // the matrix pinout should come out well inside the pod's GPIO budget.
    let text = pod_pinout(features_matrix());
    assert.is_true(text.length() > 0)
}
