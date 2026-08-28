// What a folded board has to obey, checked rather than remembered.
//
// The rest of the test suite asks whether the geometry is what was intended.
// These ask the different question: whether the copper the router laid can
// survive being bent. Every one of them is a rule that costs nothing to keep
// and ruins a board to break, and none of them is visible in a DRC report --
// KiCad has no idea which parts of this outline fold.
//
// All five run over the routed boards themselves, not over the functions that
// build them, so a future router that lays copper some other way still answers
// to them.

/// The bounding box of a polygon. `Box` is `panel.baml`'s, which is the same
/// pair of corners these checks want: a hinge slot is a horizontal stadium and
/// a strip is a vertical band, so overlap in x and y is the whole question.
function poly_box(poly: Vec2[]) -> Box {
    let big = 1000000.0;
    Box {
        min: Vec2 {
            x: poly.reduce(
                (a, p) -> {
                    if (p.x < a) {
                        p.x
                    } else {
                        a
                    }
                },
                big,
            ),
            y: poly.reduce(
                (a, p) -> {
                    if (p.y < a) {
                        p.y
                    } else {
                        a
                    }
                },
                big,
            ),
        },
        max: Vec2 {
            x: poly.reduce(
                (a, p) -> {
                    if (p.x > a) {
                        p.x
                    } else {
                        a
                    }
                },
                0.0 - big,
            ),
            y: poly.reduce(
                (a, p) -> {
                    if (p.y > a) {
                        p.y
                    } else {
                        a
                    }
                },
                0.0 - big,
            ),
        },
    }
}

function box_grow(b: Box, d: float) -> Box {
    Box {
        min: Vec2 { x: b.min.x - d, y: b.min.y - d },
        max: Vec2 { x: b.max.x + d, y: b.max.y + d },
    }
}

function boxes_overlap(a: Box, b: Box) -> bool {
    a.min.x < b.max.x && b.min.x < a.max.x && a.min.y < b.max.y && b.min.y < a.max.y
}

function box_holds(b: Box, p: Vec2) -> bool {
    p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y
}

/// The segmented finger boards, routed. The thumb clusters are still rigid --
/// #7 segments them -- so they have no folds for these rules to be about.
function flex_finger_boards() -> Board[] throws baml.errors.InvalidArgument {
    build_flex_boards(features_flex()).filter((b) -> {
        b.id.starts_with("finger")
    })
}

/// The strips a finger board was cut from.
function board_strips(b: Board) -> Strip[] throws baml.errors.InvalidArgument {
    let f = features_flex();
    let m = partition_modules(layout_keys(f)).find((x) -> {
        x.id == b.id
    })
        ?? throw baml.errors.InvalidArgument { message: `no module '${b.id}'` };
    flex_strips(m, ROSEBEAR_WELL(), flex_defaults())
}

/// The band of x a strip occupies. Everything outside every band is a neck.
function strip_band(s: Strip) -> Box {
    Box {
        min: Vec2 { x: s.cx - s.half_w, y: 0.0 - 1000000.0 },
        max: Vec2 { x: s.cx + s.half_w, y: 1000000.0 },
    }
}

/// Is `p` on a strip rather than in a neck?
function on_a_strip(ss: Strip[], p: Vec2) -> bool {
    ss.find((s) -> {
        box_holds(strip_band(s), p)
    })
        != null
}

test "no copper plane crosses a hinge row, or reaches into a neck" {
    // The rule that bites. A solid pour over a ligament is a stiffener exactly
    // where the board is meant to give, and a crack starter at the cut edge
    // that starts it. `flex_zones` keeps the pour on the tail; this is what
    // says so about the board that came out.
    for (let b in flex_finger_boards()) {
        let ss = board_strips(b);
        assert.is_true(b.zones.length() > 0);
        for (let z in b.zones) {
            let zb = poly_box(z.outline);
            for (let cut in b.cuts) {
                assert.is_true(!boxes_overlap(zb, box_grow(poly_box(cut), FLEX_EDGE_CLEAR())));
            }
            // And inside one strip's width, so none of it is in a neck.
            assert.is_true(on_a_strip(ss, zb.min) && on_a_strip(ss, zb.max));
        }
    }
}

test "no via sits in a hinge row or a neck" {
    // A via is a rigid plated barrel. Put one in a part that folds and the
    // barrel is the stress riser the fold cracks at.
    for (let b in flex_finger_boards()) {
        let ss = board_strips(b);
        assert.is_true(b.vias.length() > 0);
        let r = FLEX_VIA_PAD() / 2.0 + FLEX_EDGE_CLEAR();
        for (let v in b.vias) {
            for (let cut in b.cuts) {
                assert.is_true(
                    !boxes_overlap(box_grow(poly_box(cut), r), box_grow(poly_box([v.at]), r)),
                );
            }
            assert.is_true(on_a_strip(ss, v.at));
        }
    }
}

/// The tangent of the widest angle a trace may leave the fold's normal at.
///
/// A fold's strain is spread over the length of trace inside the bend, so a
/// trace at an angle sees the same displacement over a shorter run of copper:
/// 30 degrees costs about 15%, and past that it climbs quickly. Nothing this
/// router lays is anywhere near it -- every hinge crossing is a straight run
/// up a lane -- so this is a guard on the next router, not on this one.
function MAX_FOLD_SKEW_TAN() -> float {
    0.5774
}

test "every trace crosses a fold square to it" {
    // Per strip, because a fold is a strip-wide line and a track out in a neck
    // shares nothing with it but a y coordinate.
    for (let b in flex_finger_boards()) {
        for (let s in board_strips(b)) {
            let band = strip_band(s);
            for (let cut in b.cuts) {
                let cb = poly_box(cut);
                let cy = (cb.min.y + cb.max.y) / 2.0;
                if (box_holds(band, Vec2 { x: (cb.min.x + cb.max.x) / 2.0, y: cy })) {
                    for (let tr in b.tracks) {
                        let lo = if (tr.start.y < tr.end.y) {
                            tr.start.y
                        } else {
                            tr.end.y
                        };
                        let hi = if (tr.start.y > tr.end.y) {
                            tr.start.y
                        } else {
                            tr.end.y
                        };
                        let dx = tr.end.x - tr.start.x;
                        let dy = tr.end.y - tr.start.y;
                        if (lo < cy && cy < hi) {
                            // Where it meets the fold. Only the crossings on
                            // this strip are this fold's business.
                            let at = tr.start.x + dx * (cy - tr.start.y) / dy;
                            if (box_holds(band, Vec2 { x: at, y: cy })) {
                                assert.is_true(dx.abs() <= dy.abs() * MAX_FOLD_SKEW_TAN());
                            }
                        }
                    }
                }
            }
        }
    }
}

test "flex copper is laid to the flex rules, not the board's general ones" {
    // Width first, on the copper itself.
    for (let b in flex_finger_boards()) {
        assert.is_true(b.tracks.length() > 0);
        for (let t in b.tracks) {
            assert.approx_equal(t.width, FLEX_TRACE_W(), 0.000001);
        }
    }
    // Then clearance and copper-to-edge, which are DRC's job -- so what there
    // is to check is that the project file actually asks DRC for them. KiCad
    // drops a net_settings block with no schema version on it silently and
    // checks the fine geometry against the coarse defaults instead, which is
    // how 499 clearance violations once read as none.
    let text = design_rules(features_flex()).concat(net_class(features_flex())).join("\n");
    assert.is_true(contains(text, `"min_copper_edge_clearance": ${FLEX_EDGE_CLEAR()}`));
    assert.is_true(contains(text, `"min_track_width": ${FLEX_TRACE_W()}`));
    assert.is_true(contains(text, `"min_clearance": ${FLEX_TRACE_SPACE()}`));
    assert.is_true(contains(text, `"version": 4`));
    // And the rigid variants are left on the rigid numbers.
    let rigid = design_rules(features_base()).join("\n");
    assert.is_true(contains(rigid, `"min_copper_edge_clearance": ${BOARD_EDGE_CLEAR()}`));
    assert.is_true(!contains(rigid, "min_track_width"))
}

/// How far a part's own copper and drills reach along the column it stands on.
///
/// Switches carry their declared keep-out, which `four hinge rows per column,
/// none of them through a switch` holds the hinge rows to and
/// `switch footprint agrees with the geometry the router assumes` holds the
/// library to. A diode is turned across the column, so along it the part is
/// only as deep as one pad. A connector stands in the tail, and takes the
/// larger of its two dimensions rather than working out which way it faces.
function part_reach_along(c: Component, p: FlexParams) -> float {
    if (c.ref.starts_with("SW")) {
        p.switch_clear
    } else if (c.ref.starts_with("D")) {
        DIODE_PAD_HALF()
    } else {
        let back = FFC_BODY_BACK();
        let half = ffc_body_half(c.pads.length() - 1);
        if (half > back) {
            half
        } else {
            back
        }
    }
}

test "nothing rigid straddles a fold" {
    // True of the diodes by construction -- `diode_offset` puts them in the
    // 7.5-to-10.5mm band, toward the middle of their column -- but the paper
    // proof caught a version where it was not, and construction is not a check.
    let p = flex_defaults();
    for (let b in flex_finger_boards()) {
        for (let c in b.components) {
            let reach = part_reach_along(c, p) + p.slot_w / 2.0 + FLEX_EDGE_CLEAR();
            for (let cut in b.cuts) {
                let cb = poly_box(cut);
                let cy = (cb.min.y + cb.max.y) / 2.0;
                if (c.x > cb.min.x - reach && c.x < cb.max.x + reach) {
                    assert.is_true((c.y - cy).abs() > reach);
                }
            }
        }
    }
}
