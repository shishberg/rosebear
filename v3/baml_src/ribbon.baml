// FFC ribbons between modules.
//
// Widths are DERIVED, never written down. v2-p4-pod.md arrives at "20-way" by
// hand (15 finger + 3 thumb pass-through + ground + spare); that number appears
// nowhere here. Change a feature and every pinout, connector part and
// pass-through follows, because they all read from `ribbon_signals`.

class Ribbon {
    id: string,
    from_module: string,
    to_module: string,
    signals: Signal[],

    function width(self) -> int {
        self.signals.length()
    }
}

/// Per-contact current rating for 0.5mm-pitch FFC, in milliamps. Conservative:
/// datasheets quote 0.5A for 1.0mm pitch, less for finer.
function FFC_CONTACT_MA() -> float {
    400.0
}

/// FFC is made in standard way-counts; round a derived width up to one that can
/// actually be ordered.
function STANDARD_FFC_WAYS() -> int[] {
    [4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 30, 32, 34, 40, 45, 50]
}

function standard_ffc_way(n: int) -> int throws baml.errors.InvalidArgument {
    STANDARD_FFC_WAYS().find((w) -> {
        w >= n
    })
        ?? throw baml.errors.InvalidArgument {
            message: `no standard FFC wide enough for ${n} conductors`
        }
}

/// Conductors needed to carry `total_ma` without exceeding the contact rating.
/// Applies to both the supply and its return path.
function power_conductors(total_ma: float) -> int {
    if (total_ma <= 0.0) {
        0
    } else {
        let n = (total_ma / FFC_CONTACT_MA()).ceil();
        let i = n.iround() catch_all (e) {
            _ => 1
        };
        if (i < 1) {
            1
        } else {
            i
        }
    }
}

/// `n` conductors of the same rail.
///
/// They are parallel paths for one current, not `n` different signals, so they
/// share a net name. Numbering them would leave the pod with n-1 nets that have
/// a contact at each end and nothing joining them.
function repeated(name: string, n: int, kind: SignalKind) -> Signal[] {
    let out: Signal[] = [];
    let i = 0;
    while (i < n) {
        out.push(Signal { name: name, kind: kind });
        i = i + 1;
    }
    out
}

/// The signals crossing one ribbon.
///
/// `downstream_keys` are every key reached THROUGH this ribbon (so the
/// pod->finger ribbon counts the thumb keys it passes through), which is what
/// makes the pass-through and the LED power budget fall out automatically.
function ribbon_signals(
    local_keys: PlacedKey[],
    passthrough_keys: PlacedKey[],
    f: Features,
    led_tag: string,
    /// A spare conductor is cheap insurance on the pod link, which is long and
    /// awkward to replace. v2-p4-pod.md omits it on the short finger->thumb
    /// hop, and this follows that.
    include_spare: bool,
) -> Signal[] {
    let sigs: Signal[] = [];

    // One GPIO per key on the far board...
    for (let k in local_keys) {
        sigs.push(Signal { name: key_net(k), kind: SignalKind.Key });
    }
    // ...plus every key reached through it.
    for (let k in passthrough_keys) {
        sigs.push(Signal { name: key_net(k), kind: SignalKind.Key });
    }

    // Ground conductor per ribbon (v2-p4-pod.md, defence #2 against pickup).
    sigs.push(Signal { name: "GND", kind: SignalKind.Ground });

    if (f.per_key_leds) {
        let n_leds = local_keys.length() + passthrough_keys.length();
        let total_ma = (n_leds * 1.0) * f.led_ma_per_key;
        let n_power = power_conductors(total_ma);

        // The data line gets its own grounded neighbour. v2-p4-pod.md: "If a
        // future rev wants per-cluster LEDs, that data line gets its own
        // grounded neighbor." Emitted adjacent so the pinout honours it.
        //
        // A guard is ground -- that is the whole of its job -- so it carries the
        // ground net rather than a name of its own, and reaches the pour on
        // every board it crosses without needing a trace.
        sigs.push(Signal { name: "GND", kind: SignalKind.Ground });
        sigs.push(Signal { name: `LED_DATA_${led_tag}`, kind: SignalKind.LedData });
        sigs.push(Signal { name: "GND", kind: SignalKind.Ground });

        for (let s in repeated(LED_VDD_NET(), n_power, SignalKind.Power)) {
            sigs.push(s);
        }
        // The return path carries the same current as the supply, and is the
        // same ground everything else on the board returns through.
        for (let s in repeated("GND", n_power, SignalKind.Ground)) {
            sigs.push(s);
        }
    }

    if (include_spare) {
        sigs.push(Signal { name: `SPARE_${led_tag}`, kind: SignalKind.Spare });
    }
    sigs
}

/// Reverse the column order of a pinout.
///
/// Not cosmetic: `ribbon_signals` emits key signals in column order, and which
/// order the contacts have to run in is fixed by where the connector stands.
/// Get it wrong and the fan-in has to cross every net over every other.
///
/// The mirror reverses *columns*, not rows. A left-right mirror does not turn a
/// board upside down: the bottom key of a column is still its bottom key. The
/// switch footprint does not mirror either -- both hands use the same part --
/// so each column's escape channel still runs off the same side of its pads,
/// and its rows must stay in the order that channel can serve.
function mirror_pinout(sigs: Signal[]) -> Signal[] {
    let keys = sigs.filter((s) -> {
        s.kind == SignalKind.Key
    });
    let rest = sigs.filter((s) -> {
        s.kind != SignalKind.Key
    });

    // Columns, in the order they first appear.
    let cols: string[] = [];
    for (let s in keys) {
        let c = column_of(s.name);
        if (!contains_str(cols, c)) {
            cols.push(c);
        }
    }

    let out: Signal[] = [];
    let i = cols.length() - 1;
    while (i >= 0) {
        let c = cols.at(i) ?? "";
        for (let s in keys) {
            if (column_of(s.name) == c) {
                out.push(s);
            }
        }
        i = i - 1;
    }
    for (let s in rest) {
        out.push(s);
    }
    out
}

/// Column names in the order they first appear in a pinout.
function pinout_columns(keys: Signal[]) -> string[] {
    let cols: string[] = [];
    for (let s in keys) {
        let c = column_of(s.name);
        if (!contains_str(cols, c)) {
            cols.push(c);
        }
    }
    cols
}

/// Reverse the row order within each column, leaving the columns where they are.
///
/// The column channel puts a column's lowest key on its innermost lane, so one
/// column's exits run out across the board in the same direction as its rows
/// run up it. A bus that meets those exits from the far side needs the rows
/// turned round, and it needs that on both hands -- the mirror swaps which end
/// of the board the columns start from, but it does not turn a column upside
/// down.
function reverse_rows(sigs: Signal[]) -> Signal[] {
    let keys = sigs.filter((s) -> {
        s.kind == SignalKind.Key
    });
    let out: Signal[] = [];
    for (let c in pinout_columns(keys)) {
        for (
            let s in keys
                .filter((k) -> {
                    column_of(k.name) == c
                })
                .reverse()
        ) {
            out.push(s);
        }
    }
    for (
        let s in sigs.filter((s) -> {
            s.kind != SignalKind.Key
        })
    ) {
        out.push(s);
    }
    out
}

/// Whether a link's pinout runs inner column first.
///
/// Both links want their contact 1 on the column nearest their connector, and
/// the two connectors are at opposite ends of the board -- so the two links
/// disagree on which hand needs reversing, and each says so for itself.
///
/// The thumb link is met head-on across a parallel strip, where planarity just
/// means the contacts run the same way along the board as the keys do. Column
/// order does that on the left hand; the mirrored one reverses.
///
/// The pod link is the awkward one and is handled at the call site: it stands
/// on the inboard edge, so its contacts have to run in the order the fan band's
/// rows do, which is the whole key order backwards on the left hand.
function link_pinout(sigs: Signal[], reversed: bool) -> Signal[] {
    if (reversed) {
        mirror_pinout(sigs)
    } else {
        sigs
    }
}

function build_ribbons(mods: Module[], f: Features) -> Ribbon[] throws baml.errors.InvalidArgument {
    let out: Ribbon[] = [];
    for (let hand in ["l", "r"]) {
        let finger = find_module(mods, `finger_${hand}`);
        let thumb = find_module(mods, `thumb_${hand}`);

        // pod -> finger carries the finger keys and passes the thumb through.
        out.push(
            Ribbon {
                id: `pod_to_finger_${hand}`,
                from_module: "pod",
                to_module: finger.id,
                // Contact 1 takes the shallowest row of the fan band, and a
                // shallow row is one whose drop crosses nothing -- so contact 1
                // has to be the easternmost exit on the board and every contact
                // after it a step west. Rows reverse on both hands; columns
                // only on the left, where they already run west to east.
                //
                // Reversing the whole list there, rather than just its keys,
                // also puts the rails and the chain's data line at the shallow
                // end of the band on both hands. Those are the nets that leave
                // the band sideways for the key field, and from the shallow end
                // they pass over the pass-through runs instead of through them.
                signals: if (hand == "l") {
                    ribbon_signals(finger.keys, thumb.keys, f, hand.to_upper_case(), true).reverse()
                } else {
                    reverse_rows(ribbon_signals(finger.keys, thumb.keys, f, hand.to_upper_case(), true))
                },
            },
        );
        // finger -> thumb carries only the thumb keys.
        out.push(
            Ribbon {
                id: `finger_${hand}_to_thumb_${hand}`,
                from_module: finger.id,
                to_module: thumb.id,
                signals: link_pinout(ribbon_signals(thumb.keys, [], f, `T${hand.to_upper_case()}`, false), hand == "r"),
            },
        );
    }
    out
}

function find_ribbon(rs: Ribbon[], id: string) -> Ribbon throws baml.errors.InvalidArgument {
    rs.find((r) -> {
        r.id == id
    })
        ?? throw baml.errors.InvalidArgument { message: `no ribbon '${id}'` }
}

function key_signal_names(r: Ribbon) -> string[] {
    r.signals
        .filter((s) -> {
            s.kind == SignalKind.Key
        })
        .map((s) -> {
            s.name
        })
}
