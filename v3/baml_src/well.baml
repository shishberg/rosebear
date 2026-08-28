// The Dactyl Manuform key well, and the flat board that wraps onto it.
//
// A key well is not developable as a whole, but each COLUMN of it is: the
// column is a circular arc of constant radius, and an arc unrolls onto a
// straight line without stretching. So a board cut into per-column strips can
// be flat when made and curved when fitted, and the flat pitch it must be
// drawn at is the ARC LENGTH between keys -- not the chord, and not the
// keycap pitch.
//
// Everything here derives from the well's own parameters, taken from the
// dactyl-keyboard generator config that printed the case. Nothing downstream
// writes a pitch down; see `config_rosebear.baml`.

/// One column's displacement, in the well's own frame.
///
/// dactyl-keyboard's `column_offsets[c]` is `[x, y, z]` where y runs along the
/// column and z out of the well surface. x is unused by every stock profile
/// and is not modelled.
class WellColumn {
    name: string,
    /// Along the column axis. Survives the unroll as flat stagger.
    along: float,
    /// Out of the well surface. Does NOT survive the unroll -- it becomes a
    /// step between adjacent strips that the necks have to absorb.
    normal: float,
}

class Well {
    /// Degrees between adjacent rows, down a column (dactyl `alpha`).
    alpha: float,
    /// Degrees between adjacent columns, across the well (dactyl `beta`).
    beta: float,
    /// Key plate footprint plus the inter-key allowance -- dactyl's
    /// `mount_height + extra_height` and `mount_width + extra_width`. This is
    /// the spacing the well is built to achieve AT THE KEYCAP SURFACE.
    cap_pitch_row: float,
    cap_pitch_col: float,
    /// Keycap top to the PCB plane, measured outward from the centre of
    /// curvature. See `PCB_DEPTH` for why this is the one number to check.
    pcb_depth: float,
    columns: WellColumn[],
}

// ------------------------------------------------------------------- toto

/// Cap top down to the PCB plane.
///
/// The well is CONCAVE -- its centre of curvature is above the keyboard, so
/// the caps sit at the smallest radius and everything below them sits at a
/// larger one. A board further from the centre spans a longer arc, which is
/// why the PCB pitch comes out BIGGER than the 19mm keycap pitch, and why the
/// depth matters at all.
///
/// dactyl's `cap_top_height` (plate_thickness + sa_profile_key_height = 17.8
/// on Toto) reaches the plate origin; an MX PCB-mount switch puts the board
/// about another 5mm below that. The plate slab is 5.1 thick and its origin is
/// its midplane, so this is good to roughly +/-2.5mm -- worth a caliper before
/// ordering. `row_pitch_per_mm_depth` says what that uncertainty costs.
function PCB_DEPTH() -> float {
    22.8
}

/// Toto's well: `dactyl-keyboard/src/run_config.json`, 5x3, MINIDOX thumbs.
///
/// alpha 0.26179917 rad = 15 degrees/row, beta 0.08726639 rad = 5 degrees/col.
/// mount 18x18 (keyswitch 14 + 2*plate_rim 2), extra_height 1, extra_width 2.5.
function well_toto() -> Well {
    Well {
        alpha: 15.0,
        beta: 5.0,
        cap_pitch_row: 19.0,
        cap_pitch_col: 20.5,
        pcb_depth: PCB_DEPTH(),
        columns: [
            WellColumn { name: "pinky", along: 0.0, normal: 0.0 },
            WellColumn { name: "ring", along: 0.0, normal: 0.0 },
            WellColumn { name: "middle", along: 2.82, normal: 0.0 - 4.5 },
            WellColumn { name: "index", along: 0.0, normal: 0.0 },
            WellColumn { name: "inner", along: 0.0 - 6.0, normal: 5.0 },
        ],
    }
}

// ------------------------------------------------------------------ radii

/// Radius of the KEYCAP surface down a column.
///
/// Inverts dactyl's construction: it picks the radius that puts adjacent caps
/// exactly `cap_pitch_row` apart, `r = (pitch/2) / sin(alpha/2)`.
function cap_radius_row(w: Well) -> float {
    (w.cap_pitch_row / 2.0) / deg_to_rad(w.alpha / 2.0).sin()
}

/// Radius of the keycap surface across the columns.
function cap_radius_col(w: Well) -> float {
    (w.cap_pitch_col / 2.0) / deg_to_rad(w.beta / 2.0).sin()
}

/// Arc length between adjacent rows at the PCB plane: the flat row pitch.
function developed_row_pitch(w: Well) -> float {
    (cap_radius_row(w) + w.pcb_depth) * deg_to_rad(w.alpha)
}

/// Arc length between adjacent columns at the PCB plane: the flat column pitch.
function developed_col_pitch(w: Well) -> float {
    (cap_radius_col(w) + w.pcb_depth) * deg_to_rad(w.beta)
}

/// How much the row pitch moves per mm of error in `pcb_depth`.
///
/// The whole flat layout hangs off one measured number, so quantify it: this
/// is `d(pitch)/d(depth) = alpha` in radians, about 0.26mm per mm on Toto.
/// Columns are far flatter (beta is 5 degrees) and barely care.
function row_pitch_per_mm_depth(w: Well) -> float {
    deg_to_rad(w.alpha)
}

function col_pitch_per_mm_depth(w: Well) -> float {
    deg_to_rad(w.beta)
}

// ------------------------------------------------------------------ hinges

/// Most bend to ask of one hinge row, in degrees.
///
/// BastardKB's plate takes 15 degrees per key over two hinge rows per key
/// pitch, so about 7.5 degrees each, in 0.6mm FR4 on ~2mm ligaments. That is
/// the only field-proven number available, so it is the budget.
function MAX_HINGE_DEG() -> float {
    8.0
}

/// Hinge rows needed in the gap between two adjacent keys of a column.
///
/// A 3-row column has only two inter-key gaps, so all of `alpha` has to be
/// taken in each one. At 15 degrees that is two hinge rows per gap -- a single
/// row would be double the proven budget.
function hinges_per_gap(w: Well) -> int {
    let n = (w.alpha / MAX_HINGE_DEG()).ceil();
    let i = n.iround() catch_all (e) {
        _ => 1
    };
    if (i < 1) {
        1
    } else {
        i
    }
}

/// Bend actually asked of each hinge row.
function hinge_angle(w: Well) -> float {
    w.alpha / (hinges_per_gap(w) * 1.0)
}

/// Out-of-surface step between two adjacent columns, which is what sizes the
/// necks. Toto drops 4.5mm at the middle column and climbs 5mm at the inner.
function column_step(w: Well, i: int) -> float {
    let a = w.columns.at(i)?.normal ?? 0.0;
    let b = w.columns.at(i + 1)?.normal ?? 0.0;
    b - a
}

/// A named column's out-of-surface offset.
function well_normal(w: Well, name: string) -> float {
    w.columns
        .find((c) -> {
            c.name == name
        })
        ?.normal
        ?? 0.0
}

/// The step between two named columns, whichever order they are given in.
///
/// By name rather than by index: the right half is the left mirrored, so its
/// strips run the other way along x, and the step between two columns is not a
/// property of that ordering.
function step_between(w: Well, a: string, b: string) -> float {
    (well_normal(w, b) - well_normal(w, a)).abs()
}

/// The largest step any neck has to absorb.
function max_column_step(w: Well) -> float {
    let out = 0.0;
    let i = 0;
    while (i + 1 < w.columns.length()) {
        let s = column_step(w, i);
        let m = if (s < 0.0) {
            0.0 - s
        } else {
            s
        };
        if (m > out) {
            out = m;
        }
        i = i + 1;
    }
    out
}

// -------------------------------------------------------------------- tests

test "the developed pitch is bigger than the keycap pitch" {
    let w = well_toto();
    // Concave well: the board is further from the centre than the caps are.
    assert.is_true(developed_row_pitch(w) > w.cap_pitch_row);
    assert.is_true(developed_col_pitch(w) > w.cap_pitch_col)
}

test "developed pitch matches the dactyl well arithmetic" {
    let w = well_toto();
    // r_cap = 9.5 / sin(7.5deg) = 72.7823mm; arc = (72.7823 + 22.8) * 15deg.
    assert.approx_equal(cap_radius_row(w), 72.782327, 0.000001);
    assert.approx_equal(developed_row_pitch(w), 25.023395, 0.000001);
    // r_cap = 10.25 / sin(2.5deg) = 234.9873mm; arc = (234.9873 + 22.8) * 5deg.
    assert.approx_equal(cap_radius_col(w), 234.987253, 0.000001);
    assert.approx_equal(developed_col_pitch(w), 22.496182, 0.000001)
}

test "at zero depth the development is just the keycap pitch" {
    // Sanity check on the inversion: at the cap surface the arc between two
    // keys is the pitch the radius was chosen to produce.
    let w = well_toto();
    let flat = Well {
        alpha: w.alpha,
        beta: w.beta,
        cap_pitch_row: w.cap_pitch_row,
        cap_pitch_col: w.cap_pitch_col,
        pcb_depth: 0.0,
        columns: w.columns,
    };
    // Arc vs chord: the arc is longer by alpha^2/24, about 0.4% at 15 degrees.
    assert.approx_equal(developed_row_pitch(flat), 19.054369, 0.000001);
    assert.approx_equal(developed_col_pitch(flat), 20.506506, 0.000001)
}

test "one hinge row per gap would exceed the proven bend budget" {
    let w = well_toto();
    assert.equal(hinges_per_gap(w), 2);
    assert.approx_equal(hinge_angle(w), 7.5, 0.000001);
    assert.is_true(hinge_angle(w) <= MAX_HINGE_DEG())
}

test "depth error is the dominant risk on rows, not columns" {
    let w = well_toto();
    assert.approx_equal(row_pitch_per_mm_depth(w), 0.2617994, 0.000001);
    assert.approx_equal(col_pitch_per_mm_depth(w), 0.0872665, 0.000001);
    // A 2.5mm depth error moves the row pitch by two thirds of a millimetre
    // over a 3-row column -- worth measuring, not worth panicking about.
    assert.is_true(row_pitch_per_mm_depth(w) * 2.5 < 0.7)
}

test "the necks have to absorb a 5mm out-of-plane step" {
    let w = well_toto();
    assert.approx_equal(column_step(w, 1), 0.0 - 4.5, 0.000001);
    assert.approx_equal(column_step(w, 2), 4.5, 0.000001);
    assert.approx_equal(column_step(w, 3), 5.0, 0.000001);
    assert.approx_equal(max_column_step(w), 5.0, 0.000001)
}
