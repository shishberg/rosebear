// Ribbon invariants. These are the cheap tests that stand between a config
// change and a wrong board.

function base_ribbons() -> Ribbon[] throws baml.errors.InvalidArgument {
    build_ribbons(partition_modules(all_keys()), features_base())
}

function led_ribbons() -> Ribbon[] throws baml.errors.InvalidArgument {
    build_ribbons(partition_modules(all_keys()), features_leds())
}

test "modules partition all 36 keys, none shared" {
    let mods = partition_modules(all_keys());
    assert.equal(mods.length(), 4);
    assert.equal(find_module(mods, "finger_l").keys.length(), 15);
    assert.equal(find_module(mods, "thumb_l").keys.length(), 3);
    assert.equal(find_module(mods, "finger_r").keys.length(), 15);
    assert.equal(find_module(mods, "thumb_r").keys.length(), 3);

    let total = mods.reduce(
        (a, m) -> {
            a + m.keys.length()
        },
        0,
    );
    assert.equal(total, 36)
}

test "derived widths reproduce the hand-derived numbers in v2-p4-pod.md" {
    let rs = base_ribbons();
    // "Pod->finger 20-way each (15 finger + 3 thumb pass-through + ground + spare)"
    assert.equal(find_ribbon(rs, "pod_to_finger_l").width(), 20);
    assert.equal(find_ribbon(rs, "pod_to_finger_r").width(), 20);
    // "finger->thumb 4-way"
    assert.equal(find_ribbon(rs, "finger_l_to_thumb_l").width(), 4);
    assert.equal(find_ribbon(rs, "finger_r_to_thumb_r").width(), 4)
}

test "thumb pass-through agrees at both ends" {
    // The failure this guards against costs a board spin: the pod drives a
    // thumb key on one conductor and the finger board passes a different one.
    let rs = base_ribbons();
    for (let hand in ["l", "r"]) {
        let pod_link = find_ribbon(rs, `pod_to_finger_${hand}`);
        let thumb_link = find_ribbon(rs, `finger_${hand}_to_thumb_${hand}`);
        let thumb_nets = key_signal_names(thumb_link);
        let pod_nets = key_signal_names(pod_link);
        assert.equal(thumb_nets.length(), 3);
        for (let n in thumb_nets) {
            assert.is_true(pod_nets.includes(n));
        }
    }
}

test "every key is reachable from the pod on exactly one conductor" {
    let rs = base_ribbons();
    let seen: string[] = [];
    for (let hand in ["l", "r"]) {
        for (let n in key_signal_names(find_ribbon(rs, `pod_to_finger_${hand}`))) {
            assert.is_true(!seen.includes(n));
            seen.push(n);
        }
    }
    assert.equal(seen.length(), 36);
    for (let k in all_keys()) {
        assert.is_true(seen.includes(key_net(k)));
    }
}

/// Rails are allowed more than one conductor; signals are not.
///
/// A rail's extra conductors are parallel paths for one current, so they share
/// its net -- see `repeated`. A repeated *signal* would be a real fault: two
/// contacts at each end that the pod would then have to join to itself.
test "no signal gets two conductors on a ribbon" {
    for (let r in led_ribbons()) {
        let seen: string[] = [];
        for (let s in r.signals) {
            if (s.kind != SignalKind.Ground && s.kind != SignalKind.Power) {
                assert.is_true(!seen.includes(s.name));
                seen.push(s.name);
            }
        }
    }
}

/// The rails must stay rails: one net each, however wide they get.
test "rail conductors share one net" {
    for (let r in led_ribbons()) {
        for (let s in r.signals) {
            if (s.kind == SignalKind.Ground) {
                assert.equal(s.name, "GND");
            }
            if (s.kind == SignalKind.Power) {
                assert.equal(s.name, LED_VDD_NET());
            }
        }
    }
}

test "enabling per-key LEDs widens the ribbons and stays orderable" {
    let base = base_ribbons();
    let led = led_ribbons();

    let pod_base = find_ribbon(base, "pod_to_finger_l").width();
    let pod_led = find_ribbon(led, "pod_to_finger_l").width();
    assert.is_true(pod_led > pod_base);

    // Every derived width must round up to a real orderable part.
    for (let r in led) {
        let w = standard_ffc_way(r.width());
        assert.is_true(w >= r.width());
    }

    // The pass-through still agrees with LEDs on -- the invariant holds across
    // the variant, which is the whole point of deriving it.
    let thumb_nets = key_signal_names(find_ribbon(led, "finger_l_to_thumb_l"));
    let pod_nets = key_signal_names(find_ribbon(led, "pod_to_finger_l"));
    for (let n in thumb_nets) {
        assert.is_true(pod_nets.includes(n));
    }
}

test "each LED data line is flanked by ground" {
    // v2-p4-pod.md: "that data line gets its own grounded neighbor".
    for (let r in led_ribbons()) {
        let sigs = r.signals;
        let i = 0;
        while (i < sigs.length()) {
            if (sigs.at(i)?.kind == SignalKind.LedData) {
                assert.is_true(i > 0);
                assert.equal(sigs.at(i - 1)?.kind, SignalKind.Ground);
                assert.equal(sigs.at(i + 1)?.kind, SignalKind.Ground);
            }
            i = i + 1;
        }
    }
}

test "LED chain visits every key on a module once" {
    let mods = partition_modules(all_keys());
    let finger = find_module(mods, "finger_l");
    let chain = led_chain(finger);
    assert.equal(chain.length(), 15);
    let seen: string[] = [];
    for (let k in chain) {
        assert.is_true(!seen.includes(k.name));
        seen.push(k.name);
    }

    let thumb = led_chain(find_module(mods, "thumb_l"));
    assert.equal(thumb.length(), 3)
}
