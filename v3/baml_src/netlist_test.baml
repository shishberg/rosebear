// Placement invariants.
//
// These exist because two placement bugs survived a visual check and a clean
// DRC run: the KiCad library switch footprint has its origin at pad 1 rather
// than at the key centre, and KiCad negates a footprint's stored rotation. Both
// produce a board that looks plausible and is wrong.

/// Check the switch footprint still puts the key centre where we think.
///
/// The 4mm hole is the switch stem: it is the key centre by definition, so its
/// offset from the footprint origin is the correction `switch_component`
/// applies. Matched as text so a regenerated -- or hand-edited -- footprint
/// fails here rather than on a fab's panel.
function stem_hole_offset_line() -> string {
    `(at ${fmt(SWITCH_CENTRE_IN_FOOTPRINT().x)} ${fmt(SWITCH_CENTRE_IN_FOOTPRINT().y)})`
}

function contains(hay: string, needle: string) -> bool {
    hay.split(needle).length() > 1
}

test "switch footprint agrees with the geometry the router assumes" {
    for (let u in ["1.00u", "1.25u", "1.50u", "1.75u"]) {
        let text = baml.fs.read(footprint_file(switch_footprint(KX() * u_of(u))));
        // The stem hole -- and so the key centre -- is the footprint origin.
        assert.is_true(contains(text, stem_hole_offset_line()));
        // Both socket terminals, where `route_column` and `route_ground_vias`
        // expect them, and on the back where the whole layer plan depends on
        // them being.
        assert.is_true(contains(text, `(at ${fmt(MX_SIGNAL_PAD().x)} ${fmt(MX_SIGNAL_PAD().y)})`));
        assert.is_true(contains(text, `(at ${fmt(MX_GND_PAD().x)} ${fmt(MX_GND_PAD().y)})`));
        assert.is_true(contains(text, `(layers "B.Cu" "B.Paste" "B.Mask")`));
        // And nothing through-hole carrying a net: a hotswap key has no pin to
        // solder, so a plated pad here would mean the wrong footprint.
        assert.is_true(!contains(text, `(pad "1" thru_hole`));
    }
}

/// The u-size a footprint name stands for, as a multiplier of one key unit.
function u_of(name: string) -> float {
    if (name == "1.25u") {
        1.25
    } else if (name == "1.50u") {
        1.5
    } else if (name == "1.75u") {
        1.75
    } else {
        1.0
    }
}

test "the LED footprint's pads are where the chain router thinks" {
    let text = baml.fs.read(footprint_file(LED_FOOTPRINT()));
    for (let p in [LED_VDD_PAD(), LED_DOUT_PAD(), LED_GND_PAD(), LED_DIN_PAD()]) {
        assert.is_true(contains(text, `(at ${fmt(p.x)} ${fmt(p.y)})`));
    }
}

/// Undo the placement: where does the key centre of an emitted switch actually
/// land? This is what a fab sees, as opposed to what we meant.
function emitted_key_centre(c: Component) -> Vec2 {
    // KiCad applies the negation of the stored angle to footprint-local coords.
    let off = rotate_about(SWITCH_CENTRE_IN_FOOTPRINT(), 0.0 - c.r, Vec2 { x: 0.0, y: 0.0 });
    Vec2 { x: c.x + off.x, y: c.y + off.y }
}

test "every emitted switch centre lands on its key, at its key's angle" {
    for (let k in all_keys()) {
        let c = switch_component(k, 1);
        let got = emitted_key_centre(c);
        let want = to_kicad(k.pos());
        assert.approx_equal(got.x, want.x, EPS_MM());
        assert.approx_equal(got.y, want.y, EPS_MM());
        // Ergogen stores +r; matching it keeps splay turning the same way.
        assert.approx_equal(c.r, k.r, EPS_MM());
    }
}

test "placement agrees with ergogen's own board for the pinky column" {
    // Verbatim from output_v2/pcbs/rosebear.kicad_pcb, which ergogen generated
    // from the same layout: (module MX ... (at 50 100 5)).
    let want = [
        Vec2 { x: 50.0, y: 100.0 },
        Vec2 { x: 48.1697294, y: 79.0799113 },
        Vec2 { x: 46.3394588, y: 58.1598226 },
    ];
    let keys = left_keys().filter((k) -> {
        k.name.starts_with("matrix_pinky_")
    });
    assert.equal(keys.length(), 3);
    let i = 0;
    for (let k in keys) {
        let c = switch_component(k, 1);
        let got = emitted_key_centre(c);
        let w = vec_at(want, i);
        assert.approx_equal(got.x, w.x, 0.0001);
        assert.approx_equal(got.y, w.y, 0.0001);
        assert.approx_equal(c.r, 5.0, 0.0001);
        i = i + 1;
    }
}

test "both hands group into the same columns" {
    // The right hand's nets carry a MIRROR field the left's do not; counting
    // fields from the front puts all 15 of its keys in one column, which the
    // router would then try to escape through a single channel.
    for (let net in ["KEY_MATRIX_INDEX_BOTTOM", "KEY_MIRROR_MATRIX_INDEX_BOTTOM"]) {
        assert.equal(column_of(net), "INDEX");
    }
    for (let net in ["KEY_THUMB_NEAR_THUMB", "KEY_MIRROR_THUMB_NEAR_THUMB"]) {
        assert.equal(column_of(net), "NEAR");
    }
}

// ------------------------------------------------- hotswap, LEDs, connectors

/// Where an LED's pad lands, measured in its own key's frame.
///
/// Constant across every key on the board when the LED is turned correctly, and
/// that is the whole point of the test below.
function led_pad_in_key_frame(k: PlacedKey, pad: Vec2) -> Vec2 {
    let led = led_component(k, 1, "IN", "OUT");
    let centre = to_kicad(k.pos());
    let p = comp_to_global(led, pad);
    rotate_about(Vec2 { x: p.x - centre.x, y: p.y - centre.y }, k.r, Vec2 { x: 0.0, y: 0.0 })
}

/// An LED is on the BACK, so KiCad mirrors it: its stored angle is applied to
/// coordinates that have already been flipped. Store the key's own angle and
/// the part's pads swing away from the key at twice the rate, which is fine on
/// a finger column splayed 5 degrees and puts the data pad 2.37mm from a 2mm
/// stem hole on the thumb key turned 90.
test "an LED sits the same way in its key however the key is turned" {
    let ref_key = find_placed(all_keys(), "matrix_pinky_top");
    for (let pad in [LED_VDD_PAD(), LED_DOUT_PAD(), LED_GND_PAD(), LED_DIN_PAD()]) {
        let want = led_pad_in_key_frame(ref_key, pad);
        for (let k in all_keys()) {
            let got = led_pad_in_key_frame(k, pad);
            assert.approx_equal(got.x, want.x, 0.001);
            assert.approx_equal(got.y, want.y, 0.001);
        }
        // And that constant position clears the stem hole, which is the key
        // centre and 2mm in radius.
        assert.is_true(want.x.hypot(want.y) > 3.0);
    }
}

/// Every cable should leave its board pointing at the board it goes to, and
/// the fan that feeds it should be planar. Those are the same requirement:
/// turning a connector to point its cable off the board also decides which end
/// of it contact 1 is at, and that is what the fan's planarity turns on.
///
/// A pair of runs in a bus never cross exactly when the lane order, the contact
/// order and the exit order all agree. Checking the three orderings is
/// therefore the whole planarity argument, and it is cheaper than looking for
/// intersections.
function monotone(xs: float[]) -> bool {
    let up = true;
    let down = true;
    let i = 1;
    while (i < xs.length()) {
        let a = xs.at(i - 1) ?? 0.0;
        let b = xs.at(i) ?? 0.0;
        if (b <= a) {
            up = false;
        }
        if (b >= a) {
            down = false;
        }
        i = i + 1;
    }
    up || down
}

test "each ribbon connector points its cable at the board it links to" {
    for (let f in [features_base(), features_leds()]) {
        let mods = partition_modules(all_keys());
        let ribbons = build_ribbons(mods, f);
        for (let hand in ["l", "r"]) {
            let inboard = if (hand == "l") {
                1.0
            } else {
                0.0 - 1.0
            };
            let m = find_module(mods, `finger_${hand}`);
            let b = build_board(m, ribbons, f);
            let conns = b.components.filter((c) -> {
                is_connector(c)
            });
            assert.equal(conns.length(), 2);

            let sgn = escape_side(b.id);
            let el = board_exit_line(b, sgn);

            for (let c in conns) {
                // A cable leaves the way the contacts face, which is the
                // opposite of the connector's own normal.
                let n = conn_normal(c);
                if (is_side_mounted(c)) {
                    // The pod link: out to the side, toward the middle of the
                    // keyboard, past every key on the board.
                    assert.is_true(0.0 - n.x * inboard > 0.5);
                    for (let k in m.keys) {
                        assert.is_true((c.x - to_kicad(k.pos()).x) * inboard > 0.0);
                    }
                } else {
                    // The thumb link: down the board, toward the cluster
                    // below the key field.
                    assert.is_true(0.0 - n.y > 0.5);
                }
            }

            // Lane, contact and exit orders agree, so nothing in the bus
            // crosses anything else in it.
            let legs = collect_legs(b, el, sgn)
                .filter((l) -> {
                    l.bus_off > 0.0
                })
                .sort_by((a, z) -> {
                    if (a.bus_off < z.bus_off) {
                        0 - 1
                    } else {
                        1
                    }
                });
            assert.equal(legs.length(), 15);
            assert.is_true(
                monotone(
                    legs.map((l) -> {
                        l.target.y
                    }),
                ),
            );
            let exits = board_exits(b, el, sgn);
            assert.is_true(
                monotone(
                    legs.map((l) -> {
                        escape_of(exits, l.net).x
                    }),
                ),
            );
        }
    }
}

test "a thumb cluster's connector faces back up at its finger board" {
    for (let f in [features_base(), features_leds()]) {
        let mods = partition_modules(all_keys());
        let ribbons = build_ribbons(mods, f);
        for (let hand in ["l", "r"]) {
            let m = find_module(mods, `thumb_${hand}`);
            let b = build_board(m, ribbons, f);
            let conns = b.components.filter((c) -> {
                is_connector(c)
            });
            assert.equal(conns.length(), 1);
            for (let c in conns) {
                // Contacts face up the board; the keys are all below it.
                assert.is_true(0.0 - conn_normal(c).y < 0.0 - 0.5);
                for (let k in m.keys) {
                    assert.is_true(c.y < to_kicad(k.pos()).y);
                }
            }
        }
    }
}

/// The placement draws the outline from the keys and the connectors, which is
/// everything it knows; the router then puts copper where the escapes and the
/// chain actually need to go. `enclose` redraws it around the result.
test "the board outline contains every track the router laid" {
    for (let f in [features_base(), features_leds()]) {
        for (let b in build_boards(f)) {
            // `point_in_poly`, not `point_in_hull`: the finger outline is
            // clipped around the thumb cluster and no longer convex.
            for (let t in b.tracks) {
                assert.is_true(point_in_poly(b.outline, t.start));
                assert.is_true(point_in_poly(b.outline, t.end));
            }
            for (let v in b.vias) {
                assert.is_true(point_in_poly(b.outline, v.at));
            }
        }
    }
}

/// The two halves of the ribbon joint, built independently, must meet.
test "the link connectors face each other across the gap" {
    for (let f in [features_base(), features_leds()]) {
        for (let hand in ["l", "r"]) {
            let boards = build_boards(f);
            let fb = find_board(boards, `finger_${hand}`);
            let tb = find_board(boards, `thumb_${hand}`);
            let fc = fb.components.find((c) -> {
                is_connector(c) && !is_side_mounted(c)
            })
                ?? no_component();
            let tc = tb.components.find((c) -> {
                is_connector(c)
            })
                ?? no_component();

            // Same x, contacts toward each other, a plug's worth of gap.
            assert.approx_equal(fc.x, tc.x, 0.001);
            assert.is_true(conn_normal(fc).y < 0.0 - 0.5);
            assert.is_true(conn_normal(tc).y > 0.5);
            let fy = comp_to_global(fc, ffc_pad_local(1, fc.pads.length() - 1)).y;
            let ty = comp_to_global(tc, ffc_pad_local(1, tc.pads.length() - 1)).y;
            assert.is_true(ty - fy > 2.0);
            assert.is_true(ty - fy < 18.0);

            // And the boards themselves stay apart: no outline vertex of one
            // inside the other. (The evaluator does the full polygon check;
            // this is the cheap in-pipeline guard.)
            for (let p in tb.outline) {
                assert.is_true(!point_in_poly(fb.outline, p));
            }
            for (let p in fb.outline) {
                assert.is_true(!point_in_poly(tb.outline, p));
            }
        }
    }
}
