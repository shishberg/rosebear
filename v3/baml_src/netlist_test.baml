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

/// The pod sits between the halves, so both cables should leave toward the
/// middle -- and the angle that does that is also the angle that keeps the
/// fan-in planar, because it decides which end of the connector contact 1 is
/// at. Getting it backwards is not a cosmetic error.
test "a finger half's ribbon connectors face the pod, and its fan-in stays planar" {
    for (let f in [features_base(), features_leds()]) {
        let mods = partition_modules(all_keys());
        let ribbons = build_ribbons(mods, f);
        for (let hand in ["l", "r"]) {
            let m = find_module(mods, `finger_${hand}`);
            let b = build_board(m, ribbons, f);
            let keys_x = m.keys.map((k) -> {
                to_kicad(k.pos()).x
            });
            let conns = b.components.filter((c) -> {
                is_connector(c)
            });
            assert.equal(conns.length(), 2);
            for (let c in conns) {
                if (hand == "l") {
                    // Right edge, contacts turned to face the keys.
                    assert.equal(c.r, 90.0);
                    for (let x in keys_x) {
                        assert.is_true(c.x > x);
                    }
                } else {
                    assert.equal(c.r, 270.0);
                    for (let x in keys_x) {
                        assert.is_true(c.x < x);
                    }
                }
            }
            // Every contact is below the escape line, so no fan-in run doubles
            // back over the key field to reach one.
            let exit_y = lowest_signal_pad(b.components) + COLUMN_EXIT();
            for (let l in collect_legs(b, exit_y)) {
                assert.is_true(l.target.y > exit_y);
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
            for (let t in b.tracks) {
                assert.is_true(point_in_hull(b.outline, t.start));
                assert.is_true(point_in_hull(b.outline, t.end));
            }
            for (let v in b.vias) {
                assert.is_true(point_in_hull(b.outline, v.at));
            }
        }
    }
}
