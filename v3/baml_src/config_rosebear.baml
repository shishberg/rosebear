// The rosebear 36-key layout: 5x3 finger matrix + 3 thumb keys per half.
//
// This replaces `v2/config.yaml`'s `points:` section. Values that were unit
// expressions there (`kx`, `1.08 kx`, `0.5 ky`) are resolved here against the
// constants below, so a typo is a compile error rather than a runtime surprise.
//
// The geometry is deliberately unchanged from v2 -- per v2-p4-pod.md, the
// layout is "re-cut as 4 passive modules + pod, angles locked as-if-unibody".
// What changed is everything downstream: no matrix, no diodes, direct wiring.

function KX() -> float {
    19.0
}

function KY() -> float {
    19.0
}

/// Key pitch including the 2mm inter-key gap (ergogen's `px`/`py`).
function PX() -> float {
    21.0
}

function PY() -> float {
    21.0
}

/// Default keycap footprint (ergogen's $default_width/height).
function KEY_W() -> float {
    18.0
}

function KEY_H() -> float {
    18.0
}

function std_row(name: string) -> RowSpec {
    RowSpec { name: name, padding: PY(), rotate: 0.0, width: KEY_W(), height: KEY_H() }
}

/// Finger rows, bottom-to-top -- the order ergogen walks them.
function finger_rows() -> RowSpec[] {
    [std_row("bottom"), std_row("home"), std_row("top")]
}

function origin0() -> Vec2 {
    Vec2 { x: 0.0, y: 0.0 }
}

function matrix_zone() -> ZoneSpec {
    ZoneSpec {
        name: "matrix",
        anchor: AnchorSpec { ref: null, shift: Vec2 { x: 50.0, y: -100.0 }, rotate: 0.0 },
        columns: [
            ColumnSpec {
                name: "pinky",
                spread: PX(),
                stagger: 0.0,
                splay: 5.0,
                origin: origin0(),
                rows: finger_rows(),
            },
            ColumnSpec {
                name: "ring",
                spread: 20.52,
                stagger: 9.5,
                splay: -5.0,
                origin: origin0(),
                rows: finger_rows(),
            },
            ColumnSpec {
                name: "middle",
                spread: 20.52,
                stagger: 5.0,
                splay: 0.0,
                origin: origin0(),
                rows: finger_rows(),
            },
            ColumnSpec {
                name: "index",
                spread: PX(),
                stagger: -7.6,
                splay: 0.0,
                origin: origin0(),
                rows: finger_rows(),
            },
            ColumnSpec {
                name: "inner",
                spread: PX(),
                stagger: -3.8,
                splay: 0.0,
                origin: origin0(),
                rows: finger_rows(),
            },
        ],
    }
}

function thumb_zone() -> ZoneSpec {
    ZoneSpec {
        name: "thumb",
        // Hangs off the inner column's bottom key, half a key left and a key
        // and a half down.
        anchor: AnchorSpec {
            ref: "matrix_inner_bottom",
            shift: Vec2 { x: 0.0 - 0.5 * KX(), y: 0.0 - 1.5 * KY() },
            rotate: 0.0,
        },
        columns: [
            ColumnSpec {
                name: "near",
                spread: 0.0,
                stagger: 0.0,
                splay: -15.0,
                origin: origin0(),
                rows: [
                    RowSpec {
                        name: "thumb",
                        padding: PY(),
                        rotate: 0.0,
                        width: KEY_W(),
                        height: KEY_H(),
                    },
                ],
            },
            ColumnSpec {
                name: "home",
                spread: 22.04,
                stagger: -1.9,
                splay: -15.0,
                origin: origin0(),
                // The 1.5u thumb key, turned 90 degrees.
                rows: [
                    RowSpec {
                        name: "thumb",
                        padding: PY(),
                        rotate: 90.0,
                        width: 1.5 * KX(),
                        height: KEY_H(),
                    },
                ],
            },
            ColumnSpec {
                name: "far",
                spread: 21.85,
                stagger: -2.85,
                splay: -15.0,
                origin: origin0(),
                rows: [
                    RowSpec {
                        name: "thumb",
                        padding: PY(),
                        rotate: 0.0,
                        width: KEY_W(),
                        height: KEY_H(),
                    },
                ],
            },
        ],
    }
}

function rosebear_zones() -> ZoneSpec[] {
    [matrix_zone(), thumb_zone()]
}

// ------------------------------------------------------------------ halves

/// Mirror keys about the vertical line x = axis, producing the opposite hand.
/// Each half is its own PCB, so the axis only sets absolute coordinates; the
/// board origin is normalised per module at emit time.
function mirror_keys(keys: PlacedKey[], axis: float, name_prefix: string) -> PlacedKey[] {
    keys.map((k) -> {
        PlacedKey {
            name: `${name_prefix}${k.zone}_${k.column}_${k.row}`,
            zone: k.zone,
            column: k.column,
            row: k.row,
            x: 2.0 * axis - k.x,
            y: k.y,
            r: 0.0 - k.r,
            width: k.width,
            height: k.height,
            mirrored: true,
        }
    })
}

/// Distance from the layout origin to mirror across. Sets how far apart the
/// two halves sit in the combined view; irrelevant to the per-module boards.
function MIRROR_AXIS() -> float {
    200.0
}

function left_keys() -> PlacedKey[] throws baml.errors.InvalidArgument {
    render_zones(rosebear_zones(), false, "")
}

function right_keys() -> PlacedKey[] throws baml.errors.InvalidArgument {
    mirror_keys(left_keys(), MIRROR_AXIS(), "mirror_")
}

function all_keys() -> PlacedKey[] throws baml.errors.InvalidArgument {
    left_keys().concat(right_keys())
}

// ------------------------------------------------------------------ golden
// Expected values are ergogen 4.0.4's own output for v2/config.yaml, captured
// at full precision. This is the differential test that lets us retire ergogen.

/// KiCad stores coordinates as integer nanometres, so 1e-6 mm is the finest
/// distinction the board file can represent. Ergogen rotates via a polar
/// round-trip (makerjs `atan2` -> `fromPolar`) where we use the rotation matrix
/// directly; the two differ in the last couple of bits over chained rotations,
/// which is below what any board can express.
function EPS_MM() -> float {
    0.000001
}

function assert_key(
    keys: PlacedKey[],
    name: string,
    x: float,
    y: float,
    r: float,
) -> void throws baml.errors.InvalidArgument {
    let k = find_placed(keys, name);
    assert.approx_equal(k.x, x, EPS_MM());
    assert.approx_equal(k.y, y, EPS_MM());
    assert.approx_equal(k.r, r, EPS_MM())
}

test "layout matches ergogen 4.0.4 exactly" {
    let keys = left_keys();
    assert.equal(keys.length(), 18);

    assert_key(keys, "matrix_pinky_bottom", 50.0, -100.0, 5.0);
    assert_key(keys, "matrix_pinky_home", 48.1697294, -79.07991129999999, 5.0);
    assert_key(keys, "matrix_pinky_top", 46.3394588, -58.15982259999999, 5.0);

    assert_key(keys, "matrix_ring_bottom", 69.6139356, -88.7477145, 0.0);
    assert_key(keys, "matrix_ring_home", 69.6139356, -67.7477145, 0.0);
    assert_key(keys, "matrix_ring_top", 69.6139356, -46.7477145, 0.0);

    assert_key(keys, "matrix_middle_bottom", 90.1339356, -83.7477145, 0.0);
    assert_key(keys, "matrix_middle_home", 90.1339356, -62.7477145, 0.0);
    assert_key(keys, "matrix_middle_top", 90.1339356, -41.7477145, 0.0);

    assert_key(keys, "matrix_index_bottom", 111.1339356, -91.3477145, 0.0);
    assert_key(keys, "matrix_index_home", 111.1339356, -70.3477145, 0.0);
    assert_key(keys, "matrix_index_top", 111.1339356, -49.347714499999995, 0.0);

    assert_key(keys, "matrix_inner_bottom", 132.1339356, -95.1477146, 0.0);
    assert_key(keys, "matrix_inner_home", 132.1339356, -74.1477146, 0.0);
    assert_key(keys, "matrix_inner_top", 132.1339356, -53.1477146, 0.0);

    // The thumb cluster: cross-zone anchoring plus a 90-degree key.
    assert_key(keys, "thumb_near_thumb", 122.6339356, -123.6477146, -15.0);
    assert_key(keys, "thumb_home_thumb", 143.4311846, -131.1873454, 60.0);
    assert_key(keys, "thumb_far_thumb", 160.9288397, -144.5805179, -45.0)
}

test "the 1.5u thumb key keeps its size" {
    let k = find_placed(left_keys(), "thumb_home_thumb");
    assert.approx_equal(k.width, 28.5, EPS_MM())
}

test "mirroring produces an opposite hand" {
    let all = all_keys();
    assert.equal(all.length(), 36);

    let l = find_placed(all, "matrix_pinky_bottom");
    let r = find_placed(all, "mirror_matrix_pinky_bottom");
    assert.approx_equal(r.x, 2.0 * MIRROR_AXIS() - l.x, EPS_MM());
    assert.approx_equal(r.y, l.y, EPS_MM());
    assert.approx_equal(r.r, 0.0 - l.r, EPS_MM());
    assert.is_true(r.mirrored)
}
