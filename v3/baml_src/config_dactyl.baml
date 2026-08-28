// The rosebear layout retargeted to a Dactyl Manuform key well.
//
// Same 36 keys as `config_rosebear.baml`, but the flat pitch is DERIVED from
// the well in `well.baml` rather than chosen for a flat board. This is the
// layout a segmented flex board is cut from: laid out flat, bent into the well
// at assembly.
//
// The v2/v3 layout in `config_rosebear.baml` is untouched and still drives the
// existing five boards. This is a second layout, not a replacement, so the
// ergogen parity golden keeps its meaning and the routed boards keep building.

/// The well every dimension here comes from.
function ROSEBEAR_WELL() -> Well {
    well_toto()
}

/// Ergogen `stagger` is CUMULATIVE -- each column shifts relative to the
/// running position -- where dactyl's `column_offsets` are absolute. Difference
/// them so the two agree.
function well_staggers(w: Well) -> float[] {
    let out: float[] = [];
    let prev = 0.0;
    for (let c in w.columns) {
        out.push(c.along - prev);
        prev = c.along;
    }
    out
}

function dactyl_rows(w: Well) -> RowSpec[] {
    let pitch = developed_row_pitch(w);
    [
        RowSpec { name: "bottom", padding: pitch, rotate: 0.0, width: KEY_W(), height: KEY_H() },
        RowSpec { name: "home", padding: pitch, rotate: 0.0, width: KEY_W(), height: KEY_H() },
        RowSpec { name: "top", padding: pitch, rotate: 0.0, width: KEY_W(), height: KEY_H() },
    ]
}

/// The finger matrix, unrolled.
///
/// No splay and no hand-tuned stagger. Both are gone on purpose: the well
/// expresses the same ergonomics as column curvature and per-column offsets, so
/// the flat layout is a plain grid plus the four offsets dactyl already
/// specifies. `beta` does not appear as a rotation here at all -- a column tilt
/// has no in-plane component once unrolled; it is already paid for in the
/// column pitch being an arc length.
function dactyl_matrix_zone() -> ZoneSpec {
    let w = ROSEBEAR_WELL();
    let spread = developed_col_pitch(w);
    let staggers = well_staggers(w);
    let cols: ColumnSpec[] = [];
    let i = 0;
    for (let c in w.columns) {
        cols.push(
            ColumnSpec {
                name: c.name,
                spread: spread,
                stagger: staggers.at(i) ?? 0.0,
                splay: 0.0,
                origin: origin0(),
                rows: dactyl_rows(w),
            },
        );
        i = i + 1;
    }
    ZoneSpec {
        name: "matrix",
        anchor: AnchorSpec { ref: null, shift: Vec2 { x: 50.0, y: -100.0 }, rotate: 0.0 },
        columns: cols,
    }
}

/// The thumb cluster, carried over unchanged.
///
/// Toto's thumbs are MINIDOX, whose placement is its own arithmetic in
/// dactyl-keyboard and not a continuation of the finger well -- so there is
/// nothing here to derive it from yet, and inventing a derivation would be
/// worse than reusing the geometry that already fits. The cluster is nearly
/// planar in any case, which is why BastardKB gets away with two rigid islands
/// for five keys.
function dactyl_thumb_zone() -> ZoneSpec {
    thumb_zone()
}

function dactyl_zones() -> ZoneSpec[] {
    [dactyl_matrix_zone(), dactyl_thumb_zone()]
}

function dactyl_left_keys() -> PlacedKey[] throws baml.errors.InvalidArgument {
    render_zones(dactyl_zones(), false, "")
}

function dactyl_all_keys() -> PlacedKey[] throws baml.errors.InvalidArgument {
    dactyl_left_keys().concat(mirror_keys(dactyl_left_keys(), MIRROR_AXIS(), "mirror_"))
}

// -------------------------------------------------------------------- tests

test "the dactyl layout has the same 36 keys as the flat one" {
    assert.equal(dactyl_left_keys().length(), 18);
    assert.equal(dactyl_all_keys().length(), 36)
}

test "row and column pitch come from the well, not from a literal" {
    let w = ROSEBEAR_WELL();
    let keys = dactyl_left_keys();
    let b = find_placed(keys, "matrix_middle_bottom");
    let h = find_placed(keys, "matrix_middle_home");
    let t = find_placed(keys, "matrix_middle_top");
    // Rows advance by the developed arc length, 25.02mm on Toto.
    assert.approx_equal(h.y - b.y, developed_row_pitch(w), 0.000001);
    assert.approx_equal(t.y - h.y, developed_row_pitch(w), 0.000001);

    let ring = find_placed(keys, "matrix_ring_bottom");
    let mid = find_placed(keys, "matrix_middle_bottom");
    assert.approx_equal(mid.x - ring.x, developed_col_pitch(w), 0.000001)
}

test "the board is bigger than the flat layout it replaces" {
    // The well is concave, so the developed board spans more than the flat
    // one. If this ever inverts, the depth sign is wrong.
    let w = ROSEBEAR_WELL();
    assert.is_true(developed_row_pitch(w) > PY());
    assert.is_true(developed_col_pitch(w) > PX())
}

test "columns are square to each other -- no splay survives the unroll" {
    for (let k in dactyl_left_keys()) {
        if (k.zone == "matrix") {
            assert.approx_equal(k.r, 0.0, 0.000001);
        }
    }
}

test "column offsets reproduce dactyl's absolute offsets" {
    let keys = dactyl_left_keys();
    let base = find_placed(keys, "matrix_pinky_bottom");
    // dactyl column_offsets y: pinky 0, ring 0, middle +2.82, index 0, inner -6.
    assert.approx_equal(find_placed(keys, "matrix_ring_bottom").y - base.y, 0.0, 0.000001);
    assert.approx_equal(find_placed(keys, "matrix_middle_bottom").y - base.y, 2.82, 0.000001);
    assert.approx_equal(find_placed(keys, "matrix_index_bottom").y - base.y, 0.0, 0.000001);
    assert.approx_equal(find_placed(keys, "matrix_inner_bottom").y - base.y, 0.0 - 6.0, 0.000001)
}
