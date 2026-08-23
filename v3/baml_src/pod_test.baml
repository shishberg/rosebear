// Pod invariants.
//
// The pod is the one board whose correctness is not visible: a key board that
// is wired wrong looks wrong, and a pod that is wired wrong looks exactly like
// one that is right. These are the checks that stand in for that.

function pod_sides() -> string[] {
    ["l", "r"]
}

function header_for(hand: string) -> HeaderPin[] {
    if (hand == "l") {
        HEADER_LEFT()
    } else {
        HEADER_RIGHT()
    }
}

function side_for(hand: string) -> float {
    if (hand == "l") {
        0.0 - 1.0
    } else {
        1.0
    }
}

function legs_for(hand: string, f: Features) -> PodLeg[] throws baml.errors.InvalidArgument {
    let ribbons = build_ribbons(partition_modules(all_keys()), f);
    let r = pod_ribbon(ribbons, hand);
    let side = side_for(hand);
    let gpio = r.signals.filter((s) -> {
        needs_gpio(s)
    });
    let pins = choose_pins(header_for(hand), gpio.length());
    let conn = connector_component("J", r.signals, pod_connector_pos(r.signals.length(), side), pod_connector_angle(side));
    pod_legs(conn, socket_component(side, []), r.signals, pins, side)
}

/// How many conductors this hand's pod ribbon carries.
function ribbon_ways(hand: string, f: Features) -> int throws baml.errors.InvalidArgument {
    pod_ribbon(build_ribbons(partition_modules(all_keys()), f), hand).width()
}

test "both headers are 27 ways and the socket footprint matches" {
    assert.equal(HEADER_LEFT().length(), HEADER_WAYS());
    assert.equal(HEADER_RIGHT().length(), HEADER_WAYS());
    // Pin 1 at the footprint origin, pin 27 one full span along it. If a KiCad
    // update re-origins this part the module lands 66mm off the board.
    let text = baml.fs.read(footprint_file(SOCKET_FOOTPRINT()));
    assert.is_true(text.split(`(at 0 0)`).length() > 1);
    assert.is_true(text.split(`(at 0 ${fmt(header_span())})`).length() > 1)
}

test "every pin name appears once" {
    // A typo that duplicates a pin name would quietly wire two keys together.
    let seen: string[] = [];
    for (let hand in pod_sides()) {
        for (let p in header_for(hand)) {
            if (is_gpio(p)) {
                assert.is_true(!seen.includes(p.name));
                seen.push(p.name);
            }
        }
    }
    // 47 of the module's GPIO reach the headers.
    assert.equal(seen.length(), 47)
}

/// The staircase, which is the whole reason this board routes without a search.
///
/// A pin escapes sideways into the lane at its own contact's x and runs down
/// it. That only works if the pin furthest from the connector gets the
/// outermost lane -- otherwise a sideways run crosses a lane that already has
/// copper at that height, and two nets short.
test "contacts and pins run in step, so no two escapes cross" {
    for (let f in [features_base(), features_leds()]) {
        for (let hand in pod_sides()) {
            // Ascending contact height must mean ascending pin height. Any
            // inversion is a net dragged across the whole channel.
            let ordered = legs_for(hand, f).sort_by((a, b) -> {
                if (a.contact.y < b.contact.y) {
                    0 - 1
                } else if (a.contact.y > b.contact.y) {
                    1
                } else {
                    0
                }
            });
            let prev = 0.0;
            let first = true;
            for (let l in ordered) {
                assert.is_true(first || l.pin.y > prev);
                prev = l.pin.y;
                first = false;
            }
        }
    }
}

test "the two halves of a pod fan never overlap, so they can share lanes" {
    // This is what makes the channel half as wide as the ribbon. If the halves
    // ever met in y, two nets on the same lane would short.
    for (let f in [features_base(), features_leds()]) {
        for (let hand in pod_sides()) {
            let legs = legs_for(hand, f);
            let down_max = 0.0 - 100000.0;
            let up_min = 100000.0;
            for (let l in legs) {
                if (pod_reaches_down(l)) {
                    if (l.contact.y > down_max) {
                        down_max = l.contact.y;
                    }
                } else {
                    if (l.contact.y < up_min) {
                        up_min = l.contact.y;
                    }
                    if (l.pin.y < up_min) {
                        up_min = l.pin.y;
                    }
                }
            }
            assert.is_true(down_max < up_min);
        }
    }
}

test "the channel is wide enough for the half that actually needs it" {
    // `pod_lanes` guesses half the ribbon plus one, and the connector is
    // placed from that guess. If a real split is wider, lanes run out past the
    // contacts they are meant to reach.
    for (let f in [features_base(), features_leds()]) {
        for (let hand in pod_sides()) {
            let legs = legs_for(hand, f);
            assert.is_true(pod_half_width(legs) <= pod_lanes(ribbon_ways(hand, f)));
        }
    }
}

test "every signal that needs a GPIO gets its own pin" {
    for (let f in [features_base(), features_leds()]) {
        let nets: string[] = [];
        let pins: string[] = [];
        for (let hand in pod_sides()) {
            for (let l in legs_for(hand, f)) {
                assert.is_true(!nets.includes(l.net));
                nets.push(l.net);
                let key = `${hand}${l.pin_no}`;
                assert.is_true(!pins.includes(key));
                pins.push(key);
                assert.is_true(l.pin_no > 0);
            }
        }
        // 36 keys and a spare conductor per hand, plus a data line each with
        // LEDs fitted.
        assert.is_true(nets.length() >= 38);
    }
}

/// Concessions are ordered, and the worst one is never made.
///
/// A key on a strapping pin is a keyboard that boots into download mode if you
/// happen to be resting a finger on it.
test "no button lands on a strapping or JTAG pin" {
    for (let f in [features_base(), features_leds()]) {
        let ribbons = build_ribbons(partition_modules(all_keys()), f);
        let btns = pod_button_pins(ribbons, f);
        assert.equal(btns.length(), 2);
        for (let b in btns) {
            assert.is_true(!STRAP_PINS().includes(b.pin.name));
            assert.is_true(!JTAG_PINS().includes(b.pin.name));
        }
    }
}

test "no key lands on a strapping pin" {
    for (let f in [features_base(), features_leds()]) {
        for (let hand in pod_sides()) {
            let hdr = header_for(hand);
            for (let l in legs_for(hand, f)) {
                let name = (
                    hdr
                        .find((p) -> {
                            p.pin == l.pin_no
                        })
                        ?.name
                )
                    ?? "";
                assert.is_true(!STRAP_PINS().includes(name));
            }
        }
    }
}

/// Pads and traces have to come from one assignment.
///
/// They did not, once: the pads were filled in ribbon order and the traces in
/// contact order, which shorted nineteen nets on a board that otherwise looked
/// entirely reasonable.
test "socket pads carry the nets their traces carry" {
    let b = build_pod_board(build_ribbons(partition_modules(all_keys()), features_base()), features_base());
    for (let sock in b.components) {
        if (sock.ref.starts_with("J_")) {
            let n = 1;
            while (n <= HEADER_WAYS()) {
                let net = (
                    sock.pads
                        .find((p) -> {
                            p.pad == `${n}`
                        })
                        ?.net
                )
                    ?? "";
                if (net.starts_with("KEY_")) {
                    let pos = socket_pin_pos(sock, n);
                    // Some track on this pad's net must actually start there.
                    let hit = b.tracks.find((t) -> {
                        t.net == net
                            && (t.start.x - pos.x).abs() < 0.001
                            && (t.start.y - pos.y).abs() < 0.001
                    });
                    assert.is_true(hit != null);
                }
                n = n + 1;
            }
        }
    }
}

// ------------------------------------------------------------- planarity
//
// The pod's whole claim is that it routes without a search because nothing can
// cross. That claim is worth checking directly rather than inferring it from
// the arguments in the comments -- the button lanes nested the wrong way round
// once, and the reasoning that got them wrong read perfectly well.

function seg_side(a: Vec2, b: Vec2, p: Vec2) -> float {
    (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
}

/// Do two segments properly cross? Shared endpoints and touching do not count:
/// tracks on one net meet at their ends by design.
function segments_cross(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2) -> bool {
    let d1 = seg_side(a1, a2, b1);
    let d2 = seg_side(a1, a2, b2);
    let d3 = seg_side(b1, b2, a1);
    let d4 = seg_side(b1, b2, a2);
    ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0))
        && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
}

test "no two nets cross on the same layer" {
    for (let f in [features_base(), features_leds()]) {
        let b = build_pod_board(build_ribbons(partition_modules(all_keys()), f), f);
        let n = b.tracks.length();
        let i = 0;
        while (i < n) {
            let t = b.tracks.at(i)
                ?? Track {
                    start: Vec2 { x: 0.0, y: 0.0 },
                    end: Vec2 { x: 0.0, y: 0.0 },
                    width: 0.0,
                    layer: "",
                    net: "",
                };
            let j = i + 1;
            while (j < n) {
                let u = b.tracks.at(j)
                    ?? Track {
                        start: Vec2 { x: 0.0, y: 0.0 },
                        end: Vec2 { x: 0.0, y: 0.0 },
                        width: 0.0,
                        layer: "",
                        net: "",
                    };
                if (t.layer == u.layer && t.net != u.net) {
                    assert.is_true(!segments_cross(t.start, t.end, u.start, u.end));
                }
                j = j + 1;
            }
            i = i + 1;
        }
    }
}
