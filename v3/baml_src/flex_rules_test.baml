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

/// A routed flex board with the cut it was made by: the strips, the frame they
/// are stated in, and how many conductors its necks were cut for.
///
/// Two shapes of board answer to these rules and they do not describe
/// themselves the same way. A finger board's strips are columns in board
/// coordinates; a thumb cluster's islands are rectangles in the cluster's own
/// frame, which is the only frame they are rectangles in. So the rules work in
/// whatever frame the strips came in, and each board says how to get there.
class FlexCut {
    board: Board,
    strips: Strip[],
    frame: Frame,
    neck_traces: int,
}

/// Every routed flex board, finger and thumb.
function flex_cut_boards() -> FlexCut[] throws baml.errors.InvalidArgument {
    let f = features_flex();
    let p = flex_defaults();
    let out: FlexCut[] = [];
    for (let b in build_flex_boards(f)) {
        // The pod is a rigid board that happens to ship in the flex variant.
        // Nothing on it folds, so none of this is about it.
        if (!b.id.starts_with("finger") && !b.id.starts_with("thumb")) {
            continue;
        }
        let m = partition_modules(layout_keys(f)).find((x) -> {
            x.id == b.id
        })
            ?? throw baml.errors.InvalidArgument { message: `no module '${b.id}'` };
        if (b.id.starts_with("finger")) {
            out.push(
                FlexCut {
                    board: b,
                    strips: flex_strips(m, ROSEBEAR_WELL(), p),
                    frame: board_frame(),
                    neck_traces: flex_neck_traces(m),
                },
            );
        } else if (b.id.starts_with("thumb")) {
            out.push(
                FlexCut {
                    board: b,
                    strips: thumb_islands(m, p),
                    frame: thumb_frame(m),
                    neck_traces: thumb_neck_traces(),
                },
            );
        }
    }
    out
}

/// The frame a board's own coordinates are already in.
///
/// `in_frame` reads a KiCad point, so the identity has to undo the y flip that
/// reading does: a frame mirrored in y, composed with the mirror, is nothing.
function board_frame() -> Frame {
    Frame { o: Vec2 { x: 0.0, y: 0.0 }, c: 1.0, s: 0.0, r: 0.0, flip: 0.0 - 1.0 }
}

/// A point off the board, in the frame its strips are stated in.
function in_frame(c: FlexCut, p: Vec2) -> Vec2 {
    into_frame(c.frame, to_kicad(p))
}

function in_frame_poly(c: FlexCut, ps: Vec2[]) -> Vec2[] {
    ps.map((p) -> {
        in_frame(c, p)
    })
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
    for (let c in flex_cut_boards()) {
        let b = c.board;
        assert.is_true(b.zones.length() > 0);
        for (let z in b.zones) {
            let zb = poly_box(in_frame_poly(c, z.outline));
            for (let cut in b.cuts) {
                assert.is_true(
                    !boxes_overlap(zb, box_grow(poly_box(in_frame_poly(c, cut)), FLEX_EDGE_CLEAR())),
                );
            }
            // And inside one strip's width, so none of it is in a neck.
            assert.is_true(on_a_strip(c.strips, zb.min) && on_a_strip(c.strips, zb.max));
        }
    }
}

test "no via sits in a hinge row or a neck" {
    // A via is a rigid plated barrel. Put one in a part that folds and the
    // barrel is the stress riser the fold cracks at.
    for (let c in flex_cut_boards()) {
        let b = c.board;
        assert.is_true(b.vias.length() > 0);
        let r = FLEX_VIA_PAD() / 2.0 + FLEX_EDGE_CLEAR();
        for (let v in b.vias) {
            let at = in_frame(c, v.at);
            for (let cut in b.cuts) {
                assert.is_true(
                    !boxes_overlap(box_grow(poly_box(in_frame_poly(c, cut)), r), box_grow(poly_box([at]), r)),
                );
            }
            assert.is_true(on_a_strip(c.strips, at));
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
    for (let c in flex_cut_boards()) {
        let b = c.board;
        for (let s in c.strips) {
            let band = strip_band(s);
            for (let cut in b.cuts) {
                let cb = poly_box(in_frame_poly(c, cut));
                let cy = (cb.min.y + cb.max.y) / 2.0;
                if (box_holds(band, Vec2 { x: (cb.min.x + cb.max.x) / 2.0, y: cy })) {
                    for (let tr in b.tracks) {
                        let a = in_frame(c, tr.start);
                        let e = in_frame(c, tr.end);
                        let lo = if (a.y < e.y) {
                            a.y
                        } else {
                            e.y
                        };
                        let hi = if (a.y > e.y) {
                            a.y
                        } else {
                            e.y
                        };
                        let dx = e.x - a.x;
                        let dy = e.y - a.y;
                        if (lo < cy && cy < hi) {
                            // Where it meets the fold. Only the crossings on
                            // this strip are this fold's business.
                            let at = a.x + dx * (cy - a.y) / dy;
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
    for (let c in flex_cut_boards()) {
        assert.is_true(c.board.tracks.length() > 0);
        for (let t in c.board.tracks) {
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
    for (let cut in flex_cut_boards()) {
        for (let c in cut.board.components) {
            let at = in_frame(cut, Vec2 { x: c.x, y: c.y });
            let reach = part_reach_along(c, p) + p.slot_w / 2.0 + FLEX_EDGE_CLEAR();
            for (let row in cut.board.cuts) {
                let cb = poly_box(in_frame_poly(cut, row));
                let cy = (cb.min.y + cb.max.y) / 2.0;
                if (at.x > cb.min.x - reach && at.x < cb.max.x + reach) {
                    assert.is_true((at.y - cy).abs() > reach);
                }
            }
            // And the necks, which the hinge rows say nothing about: a part
            // that overhangs a serpentine is a part glued to the one thing on
            // the board that has to move.
            assert.is_true(on_a_strip(cut.strips, at));
        }
    }
}

test "no neck carries more conductors than it was cut for" {
    // The neck's width is chosen from a trace count, and then the router lays
    // whatever it lays. This is the check that the two agree -- and the reason
    // the cluster is cut `{near, home} | {far}` rather than the other way, which
    // would send a third line over the seam.
    for (let c in flex_cut_boards()) {
        let i = 1;
        while (i < c.strips.length()) {
            let a = strip_at(c.strips, i - 1);
            let b = strip_at(c.strips, i);
            // Midway across the gap, where the board is only the neck.
            let gap = (a.cx + a.half_w + (b.cx - b.half_w)) / 2.0;
            let nets: string[] = [];
            for (let t in c.board.tracks) {
                let p = in_frame(c, t.start);
                let q = in_frame(c, t.end);
                let lo = if (p.x < q.x) {
                    p.x
                } else {
                    q.x
                };
                let hi = if (p.x > q.x) {
                    p.x
                } else {
                    q.x
                };
                if (lo <= gap && gap <= hi && !nets.includes(t.net)) {
                    nets.push(t.net);
                }
            }
            assert.is_true(nets.length() <= c.neck_traces);
            i = i + 1;
        }
    }
}
