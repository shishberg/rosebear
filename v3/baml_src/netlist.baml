// Components and nets per module.
//
// Direct-wired per v2-p4-pod.md: one GPIO per key, no matrix, no diodes. Each
// switch bridges its own net to ground; the pod does the pull-up and reads 36
// inputs.

class Pad {
    pad: string,
    net: string,
}

class Component {
    ref: string,
    /// "Library:Footprint", resolved against the KiCad footprint path.
    footprint: string,
    x: float,
    y: float,
    r: float,
    layer: string,
    pads: Pad[],
}

class Board {
    id: string,
    components: Component[],
    /// Edge.Cuts polygon, already in KiCad coordinates.
    outline: Vec2[],
    /// Copper. Empty until `route_board` has run.
    tracks: Track[],
    /// Layer changes, used only by the pass-through nets.
    vias: Via[],
    /// Copper pours. Ground is poured rather than routed.
    zones: Zone[],
}

/// Switch footprint, chosen by key width.
///
/// Kailh hotswap: the switch drops into a socket soldered to the BACK of the
/// board rather than being soldered in itself. That is a routing decision as
/// much as a mechanical one -- a hotswap key's two terminals are surface pads
/// on the back, not through-holes, so neither one reaches the front pour and
/// neither one can start a trace on the front. See `route_column`.
///
/// KiCad ships no hotswap footprint; `footprints/gen_hotswap.py` generates this
/// family. Choc (PG1350) has neither and would need a third-party library.
function switch_footprint(width: float) -> string {
    let u = width / KX();
    let size = if (u >= 2.6) {
        "2.75u"
    } else if (u >= 2.1) {
        "2.25u"
    } else if (u >= 1.9) {
        "2.00u"
    } else if (u >= 1.6) {
        "1.75u"
    } else if (u >= 1.4) {
        "1.50u"
    } else if (u >= 1.15) {
        "1.25u"
    } else {
        "1.00u"
    };
    `${LOCAL_FOOTPRINT_LIB()}:SW_Hotswap_Kailh_MX_${size}_PCB`
}

function LED_FOOTPRINT() -> string {
    "LED_SMD:LED_SK6812MINI-E_3.2x2.8mm_P1.5mm_ReverseMount"
}

/// The Molex 200528 family covers every way-count from 4 to 30 continuously, so
/// the connector part is a pure function of the derived ribbon width.
function ffc_footprint(ways: int) -> string throws baml.errors.InvalidArgument {
    if (ways < 4 || ways > 30) {
        throw baml.errors.InvalidArgument {
            message: `no Molex 200528 FFC part for ${ways} ways (family covers 4..30)`
        };
    }
    let w2 = if (ways < 10) {
        `0${ways}`
    } else {
        `${ways}`
    };
    `Connector_FFC-FPC:Molex_200528-0${w2}0_1x${w2}-1MP_P1.00mm_Horizontal`
}

// ------------------------------------------------------------- coordinates

/// Ergogen's y axis points up; KiCad's points down.
function to_kicad(p: Vec2) -> Vec2 {
    Vec2 { x: p.x, y: 0.0 - p.y }
}

/// The four corners of a key's footprint, in KiCad coordinates.
function key_corners(k: PlacedKey) -> Vec2[] {
    let hw = k.width / 2.0;
    let hh = k.height / 2.0;
    let local = [
        Vec2 { x: 0.0 - hw, y: 0.0 - hh },
        Vec2 { x: hw, y: 0.0 - hh },
        Vec2 { x: hw, y: hh },
        Vec2 { x: 0.0 - hw, y: hh },
    ];
    let c = to_kicad(k.pos());
    // KiCad's y-flip reverses the sense of rotation.
    let rot = 0.0 - k.r;
    local.map((v) -> {
        let p = rotate_about(v, rot, Vec2 { x: 0.0, y: 0.0 });
        Vec2 { x: c.x + p.x, y: c.y + p.y }
    })
}

// ------------------------------------------------------------- convex hull

/// Indexed access with an unreachable fallback: every call site is guarded by
/// a length check, but BAML has no non-null assertion.
function vec_at(xs: Vec2[], i: int) -> Vec2 {
    xs.at(i) ?? Vec2 { x: 0.0, y: 0.0 }
}

function cross_z(o: Vec2, a: Vec2, b: Vec2) -> float {
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/// Andrew's monotone chain. Gives a far better board shape than a bounding box
/// for a splayed layout, without needing polygon boolean ops.
function convex_hull(pts: Vec2[]) -> Vec2[] {
    if (pts.length() < 3) {
        return pts;
    }
    let sorted = pts.sort_by((a, b) -> {
        if (a.x < b.x) {
            0 - 1
        } else if (a.x > b.x) {
            1
        } else if (a.y < b.y) {
            0 - 1
        } else if (a.y > b.y) {
            1
        } else {
            0
        }
    });

    let lower: Vec2[] = [];
    for (let p in sorted) {
        while (
            lower.length() >= 2
                && cross_z(vec_at(lower, lower.length() - 2), vec_at(lower, lower.length() - 1), p)
                    <= 0.0
        ) {
            lower.pop();
        }
        lower.push(p);
    }

    let upper: Vec2[] = [];
    for (let p in sorted.reverse()) {
        while (
            upper.length() >= 2
                && cross_z(vec_at(upper, upper.length() - 2), vec_at(upper, upper.length() - 1), p)
                    <= 0.0
        ) {
            upper.pop();
        }
        upper.push(p);
    }

    let hull: Vec2[] = [];
    let i = 0;
    while (i < lower.length() - 1) {
        hull.push(vec_at(lower, i));
        i = i + 1;
    }
    let j = 0;
    while (j < upper.length() - 1) {
        hull.push(vec_at(upper, j));
        j = j + 1;
    }
    hull
}

function centroid(pts: Vec2[]) -> Vec2 {
    let n = pts.length() * 1.0;
    let sx = pts.reduce(
        (a, p) -> {
            a + p.x
        },
        0.0,
    );
    let sy = pts.reduce(
        (a, p) -> {
            a + p.y
        },
        0.0,
    );
    Vec2 { x: sx / n, y: sy / n }
}

/// Push each hull vertex outward from the centroid, to leave room around the
/// keys for the board edge.
function expand_hull(hull: Vec2[], margin: float) -> Vec2[] {
    let c = centroid(hull);
    hull.map((p) -> {
        let dx = p.x - c.x;
        let dy = p.y - c.y;
        let d = dx.hypot(dy);
        if (d == 0.0) {
            p
        } else {
            Vec2 { x: p.x + dx / d * margin, y: p.y + dy / d * margin }
        }
    })
}

/// The box the LED chain can reach around one key, in that key's own frame.
function led_reach_corners(k: PlacedKey) -> Vec2[] {
    let c = to_kicad(k.pos());
    let out: Vec2[] = [];
    for (let sx in [0.0 - 1.0, 1.0]) {
        for (let sy in [LED_OVER_Y() - 3.0, LED_UNDER_Y() + 2.0]) {
            let v = local_to_board(Vec2 { x: sx * (LED_TAIL_X() + 1.0), y: sy }, k);
            out.push(Vec2 { x: c.x + v.x, y: c.y + v.y });
        }
    }
    out
}

function BOARD_MARGIN() -> float {
    4.0
}

/// With LEDs fitted the chain's transitions and its tail run outside the key
/// rectangle -- over the top of a column, or out past the last one -- so the
/// hull has to be drawn further out or they fall off the board edge.
function board_margin(f: Features) -> float {
    if (f.per_key_leds) {
        8.0
    } else {
        BOARD_MARGIN()
    }
}

/// How far past the muster line the thumb link sits.
///
/// Far enough that its own pass-through standoffs, which run back under its
/// body, stop short of the fan.
function THUMB_LINK_DROP() -> float {
    9.0
}

/// Approximate outline of an FFC connector, used to grow the board hull.
/// Molex 200528 is 1.0mm pitch with roughly 6mm of body either side of the
/// contacts, and about 10mm deep including the mounting pegs -- and the hull
/// has to cover the pass-through band behind it as well as the body, or the
/// tracks that run there fall off the edge.
function connector_corners(ways: int, at: Vec2, r: float, back: float) -> Vec2[] {
    let hw = ((ways * 1.0) + 6.0) / 2.0;
    let front = 5.0;
    let local = [
        Vec2 { x: 0.0 - hw, y: 0.0 - front },
        Vec2 { x: hw, y: 0.0 - front },
        Vec2 { x: hw, y: back },
        Vec2 { x: 0.0 - hw, y: back },
    ];
    local.map((p) -> {
        let q = rotate_about(p, 0.0 - r, Vec2 { x: 0.0, y: 0.0 });
        Vec2 { x: at.x + q.x, y: at.y + q.y }
    })
}

// ------------------------------------------------------------------ boards

/// Where the key centre sits inside the switch footprint.
///
/// KiCad's `SW_Cherry_MX_*_PCB` puts its origin at pad 1, with the 4mm stem
/// hole -- the actual key centre -- offset from it, so placing that footprint
/// at the key position shifted every switch by (-2.54, 5.08). The generated
/// hotswap footprints re-origin to the stem hole, which is the frame every
/// number in the Kailh land pattern is already quoted in, so the correction is
/// now zero -- kept as a function because it is still load-bearing, and
/// `switch_centre_offset_matches_library` still checks it against the file.
function SWITCH_CENTRE_IN_FOOTPRINT() -> Vec2 {
    Vec2 { x: 0.0, y: 0.0 }
}

/// Rotate a footprint-local vector into board space.
///
/// KiCad applies the negation of the stored angle to footprint-local
/// coordinates, and `to_kicad`'s y-flip already reverses the sense of
/// rotation; the two cancel, so a local offset turns by -k.r.
function local_to_board(v: Vec2, k: PlacedKey) -> Vec2 {
    rotate_about(v, 0.0 - k.r, Vec2 { x: 0.0, y: 0.0 })
}

function switch_component(k: PlacedKey, index: int) -> Component {
    let c = to_kicad(k.pos());
    // Place the origin so the *key centre* lands on the key position.
    let off = local_to_board(SWITCH_CENTRE_IN_FOOTPRINT(), k);
    Component {
        ref: `SW${index}`,
        footprint: switch_footprint(k.width),
        x: c.x - off.x,
        y: c.y - off.y,
        // Ergogen emits +r here and KiCad negates it internally; emitting -r
        // rotates every splayed key the wrong way.
        r: k.r,
        layer: "F.Cu",
        // Direct-wired: one side to its own GPIO net, the other to ground.
        pads: [Pad { pad: "1", net: key_net(k) }, Pad { pad: "2", net: "GND" }],
    }
}

/// Offset of the reverse-mount LED from the key centre, in the key's own frame.
/// Matches the ergogen sk6812mini_e footprint: the LED sits just south of
/// centre, between the switch pins, and shines up through the board.
function LED_OFFSET() -> Vec2 {
    Vec2 { x: 0.0, y: 5.0 }
}

function led_component(k: PlacedKey, index: int, din: string, dout: string) -> Component {
    let centre = to_kicad(k.pos());
    let off = local_to_board(LED_OFFSET(), k);
    let c = Vec2 { x: centre.x + off.x, y: centre.y + off.y };
    Component {
        ref: `LED${index}`,
        footprint: LED_FOOTPRINT(),
        x: c.x,
        y: c.y,
        // Turned the OTHER way to the switch, and that is not a sign slip.
        //
        // A back-side footprint is mirrored, so KiCad applies its negated angle
        // to coordinates that have already been flipped about the x axis. Store
        // the key's own angle and the part's axes swing away from the key's at
        // twice the rate: fine while the finger columns splay 5 degrees, and by
        // the time the 1.5u thumb key reaches 60 the LED's data pad has come
        // right back round onto the switch's 4mm stem hole -- 2.37mm from a
        // hole with a 2mm radius. Storing -r lines the part's contact axis up
        // with the key's whatever the key's angle, which is what makes the LED
        // sit the same way round in every key on the board.
        r: 0.0 - k.r,
        layer: "B.Cu",
        pads: [
            Pad { pad: "1", net: LED_VDD_NET() },
            Pad { pad: "2", net: dout },
            Pad { pad: "3", net: "GND" },
            Pad { pad: "4", net: din },
        ],
    }
}

/// Connector pads: conductor i carries signal i; the mounting pegs go to ground.
function ffc_pads(sigs: Signal[]) -> Pad[] {
    let pads: Pad[] = [];
    let i = 1;
    for (let s in sigs) {
        pads.push(Pad { pad: `${i}`, net: s.name });
        i = i + 1;
    }
    pads.push(Pad { pad: "MP", net: "GND" });
    pads
}

function connector_component(
    ref: string,
    sigs: Signal[],
    at: Vec2,
    r: float,
) -> Component throws baml.errors.InvalidArgument {
    Component {
        ref: ref,
        footprint: ffc_footprint(sigs.length()),
        x: at.x,
        y: at.y,
        r: r,
        layer: "F.Cu",
        pads: ffc_pads(sigs),
    }
}

function build_board(
    m: Module,
    ribbons: Ribbon[],
    f: Features,
) -> Board throws baml.errors.InvalidArgument {
    let comps: Component[] = [];

    // Switches, numbered along the LED chain so silkscreen order matches the
    // data order when LEDs are fitted.
    let ordered = led_chain(m);
    let i = 1;
    for (let k in ordered) {
        comps.push(switch_component(k, i));
        i = i + 1;
    }

    let incoming = ribbons.filter((r) -> {
        r.to_module == m.id
    });
    let outgoing = ribbons.filter((r) -> {
        r.from_module == m.id
    });
    let links = incoming.concat(outgoing);

    if (f.per_key_leds) {
        // The chain's two ends are the ribbon's own data conductors, not names
        // of this board's own. Inventing `LED_DATA_IN_FINGER_L` here left the
        // first LED on a one-pad net and the ribbon's `LED_DATA_L` on a net
        // with a contact at each end and no LED between them: 30 unconnected
        // items per board, and a chain that was never actually driven.
        let head = ribbon_led_data(incoming);
        let tail = ribbon_led_data(outgoing);
        let n = ordered.length();
        let j = 1;
        for (let k in ordered) {
            let din = if (j == 1) {
                head
            } else {
                `LED_N${m.id.to_upper_case()}_${j - 1}`
            };
            let dout = if (j == n) {
                tail
            } else {
                `LED_N${m.id.to_upper_case()}_${j}`
            };
            comps.push(led_component(k, j, din, dout));
            j = j + 1;
        }
    }

    // Key footprint corners drive the board outline.
    let corners: Vec2[] = [];
    for (let k in m.keys) {
        for (let c in key_corners(k)) {
            corners.push(c);
        }
        // With LEDs fitted the chain reaches past the keycaps -- out to the
        // side on the way to the connector, and over the end of a column on
        // the way to the next one. Feed those corners into the hull too rather
        // than hoping the margin covers them.
        if (f.per_key_leds) {
            for (let c in led_reach_corners(k)) {
                corners.push(c);
            }
        }
    }

    // Connectors go below the lowest key row rather than among the switches,
    // and their own outline contributes to the hull so the board grows to
    // contain them.
    let max_y = corners.reduce(
        (a, p) -> {
            if (p.y > a) {
                p.y
            } else {
                a
            }
        },
        0.0 - 100000.0,
    );
    let min_x = corners.reduce(
        (a, p) -> {
            if (p.x < a) {
                p.x
            } else {
                a
            }
        },
        100000.0,
    );
    let max_x = corners.reduce(
        (a, p) -> {
            if (p.x > a) {
                p.x
            } else {
                a
            }
        },
        0.0 - 100000.0,
    );

    // Where the connectors go, and it is the cables that decide it.
    //
    // A finger half stands its pod link on the edge facing the pod, alongside
    // the keys rather than below them, with its contacts on the outboard face
    // so the cable leaves toward the middle of the keyboard. Its thumb link
    // sits below the innermost column -- roughly where the thumb cluster is --
    // facing down, so that cable leaves toward the cluster. A thumb cluster's
    // one connector faces the other way, back up at the finger board.
    //
    // Nothing here is a free choice once the cable directions are fixed. A
    // connector's contacts face the way its cable leaves; the fan therefore has
    // to arrive from behind them, under the body; and the order the contacts
    // run in is what makes that fan planar. See `route_fanin`.
    let sgn = escape_side(m.id);
    let last_pad = last_signal_pad(comps, sgn);
    let exit_y = last_pad + sgn * COLUMN_EXIT();
    // The pod link's bus sets how deep the fan band is -- one row per
    // conductor -- and everything below the keys sits past it.
    let pod_ways = links.reduce(
        (a, r) -> {
            if (r.from_module == "pod") {
                r.signals.length()
            } else {
                a
            }
        },
        0,
    );
    let muster_y = exit_y
        + sgn
            * (
                if (pod_ways > 0) {
                    fan_depth(pod_ways)
                } else {
                    FAN_DEPTH()
                }
            );

    // Toward the pod: the right of the left half, the left of the right half.
    let inboard = if (m.id.ends_with("_r")) {
        0.0 - 1.0
    } else {
        1.0
    };
    let key_edge = if (inboard > 0.0) {
        max_x
    } else {
        min_x
    };
    // The key nearest the pod, which is where the thumb link hangs off.
    let inner_x = m.keys.reduce(
        (a, k) -> {
            let x = to_kicad(k.pos()).x;
            if (x * inboard > a * inboard) {
                x
            } else {
                a
            }
        },
        0.0 - 100000.0 * inboard,
    );

    let ci = 1;
    for (let r in links) {
        let ways = r.signals.length();
        let side_mount = r.from_module == "pod";
        let at = if (side_mount) {
            // The contact nearest the muster line sits level with the lowest
            // switch pad, so the connector stands beside the bottom rows.
            Vec2 {
                x: key_edge + inboard * bus_reach(ways),
                y: last_pad - (((ways - 1) * 1.0) / 2.0),
            }
        } else if (m.id.starts_with("thumb")) {
            Vec2 { x: (min_x + max_x) / 2.0, y: muster_y }
        } else {
            Vec2 { x: inner_x, y: muster_y + THUMB_LINK_DROP() }
        };
        // 90 and 270 point the contacts out to the side; 0 points them up the
        // board and 180 points them down.
        let ar = if (side_mount) {
            if (inboard > 0.0) {
                270.0
            } else {
                90.0
            }
        } else if (m.id.starts_with("thumb")) {
            0.0
        } else {
            180.0
        };
        let back = if (side_mount) {
            bus_reach(ways)
        } else {
            via_standoff(ways) + 2.0
        };
        comps.push(connector_component(`J${ci}`, r.signals, at, ar));
        for (let c in connector_corners(ways, at, ar, back)) {
            corners.push(c);
        }
        ci = ci + 1;
    }

    let hull = expand_hull(convex_hull(corners), board_margin(f));

    Board { id: m.id, components: comps, outline: hull, tracks: [], vias: [], zones: [] }
}

/// The LED data conductor on the first of `rs` that has one.
///
/// Empty when there is none: the thumb clusters end their chain, and the base
/// variant has no chain at all.
function ribbon_led_data(rs: Ribbon[]) -> string {
    for (let r in rs) {
        if let s: Signal = r.signals.find((x) -> {
            x.kind == SignalKind.LedData
        }) {
            return s.name;
        }
    }
    ""
}

function build_boards(f: Features) -> Board[] throws baml.errors.InvalidArgument {
    let mods = partition_modules(all_keys());
    let ribbons = build_ribbons(mods, f);
    let boards = mods.map((m) -> {
        route_board(build_board(m, ribbons, f), m, f)
    });
    // The pod is a module in the wiring but not in the layout -- it has no keys
    // to partition -- so it is built rather than derived.
    boards.push(build_pod_board(ribbons, f));
    boards
}
