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

/// Grow a convex outline by a uniform margin, to leave room around the keys
/// for the board edge.
///
/// This is an edge-normal offset -- every edge moves out by exactly `margin`,
/// and each vertex lands where its two shifted edges meet. Pushing vertices
/// out from the centroid instead is not uniform: an edge far from the centroid
/// and nearly radial barely moves, and anything measured against the offset
/// line (the finger/thumb gap is) comes out thinner than asked for.
function expand_hull(hull: Vec2[], margin: float) -> Vec2[] {
    let n = hull.length();
    if (n < 3) {
        return hull;
    }
    // Shoelace sign says which side of an edge is out.
    let area = 0.0;
    let i = 0;
    while (i < n) {
        let a = hull.at(i) ?? Vec2 { x: 0.0, y: 0.0 };
        let b = hull.at(
            if (i + 1 < n) {
                i + 1
            } else {
                0
            },
        )
            ?? Vec2 { x: 0.0, y: 0.0 };
        area = area + (a.x * b.y - b.x * a.y);
        i = i + 1;
    }
    let k = if (area > 0.0) {
        1.0
    } else {
        0.0 - 1.0
    };
    let out: Vec2[] = [];
    i = 0;
    while (i < n) {
        let prev = hull.at(
            if (i > 0) {
                i - 1
            } else {
                n - 1
            },
        )
            ?? Vec2 { x: 0.0, y: 0.0 };
        let cur = hull.at(i) ?? Vec2 { x: 0.0, y: 0.0 };
        let next = hull.at(
            if (i + 1 < n) {
                i + 1
            } else {
                0
            },
        )
            ?? Vec2 { x: 0.0, y: 0.0 };
        out.push(offset_corner(prev, cur, next, k * margin));
        i = i + 1;
    }
    out
}

/// Where a vertex lands when both its edges shift out by `m` (signed by the
/// polygon's winding). Falls back to a plain normal push when the edges are
/// parallel.
function offset_corner(prev: Vec2, cur: Vec2, next: Vec2, m: float) -> Vec2 {
    let d1 = Vec2 { x: cur.x - prev.x, y: cur.y - prev.y };
    let d2 = Vec2 { x: next.x - cur.x, y: next.y - cur.y };
    let l1 = d1.x.hypot(d1.y);
    let l2 = d2.x.hypot(d2.y);
    if (l1 == 0.0 || l2 == 0.0) {
        return cur;
    }
    let a1 = Vec2 { x: cur.x + d1.y / l1 * m, y: cur.y - d1.x / l1 * m };
    let a2 = Vec2 { x: cur.x + d2.y / l2 * m, y: cur.y - d2.x / l2 * m };
    let denom = d1.x * d2.y - d1.y * d2.x;
    if (denom.abs() < 0.000001) {
        return a1;
    }
    // Solve a1 + t*d1 = a2 + u*d2 for t.
    let t = ((a2.x - a1.x) * d2.y - (a2.y - a1.y) * d2.x) / denom;
    Vec2 { x: a1.x + t * d1.x, y: a1.y + t * d1.y }
}

/// The box the LED chain can reach around one key, in that key's own frame.
function led_reach_corners(k: PlacedKey) -> Vec2[] {
    let c = to_kicad(k.pos());
    let out: Vec2[] = [];
    for (let sx in [0.0 - 1.0, 1.0]) {
        // South of a key the halo reaches past the exit row, not just past the
        // crossing row: the crossing runs close in, but the tail leaves on the
        // exit row and the hull has to hold both. Drawing it to the crossing
        // row instead pulls the south edge up against the thumb board's
        // expanded hull, and the notch stops being a single bite out of it.
        for (let sy in [0.0 - 9.5, LED_EXIT_Y() + 5.0]) {
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

/// Board edge to board edge across the finger->thumb ribbon.
function LINK_GAP() -> float {
    3.0
}

/// How far behind its contacts a link connector's board area runs: body plus
/// the one row of standoff vias `route_passthroughs` keeps inside it.
function LINK_BODY_DEPTH() -> float {
    5.0
}

/// How far below the cluster's top corner the thumb link's centre sits.
///
/// Deeper costs thumb-board area; shallower squeezes the finger side of the
/// pocket against the column above it until the connector body hits that
/// column's bottom key.
function LINK_SINK() -> float {
    3.5
}

/// Contact row to clipped board edge, on the finger side of the link.
function LINK_PAD_EDGE() -> float {
    2.5
}

/// Where the finger->thumb link pair stands. One computation, called from
/// both boards, so the two connectors agree by construction.
class LinkSpot {
    x: float,
    finger_y: float,
    thumb_y: float,
}

function link_spot(
    id: string,
    ways: int,
    inboard: float,
) -> LinkSpot throws baml.errors.InvalidArgument {
    let hand = if (id.ends_with("_r")) {
        "r"
    } else {
        "l"
    };
    let mods = partition_modules(all_keys());
    let fingers = find_module(mods, `finger_${hand}`).keys;
    let thumbs = find_module(mods, `thumb_${hand}`).keys;
    let hw = ((ways * 1.0) + 6.0) / 2.0;

    // The cluster's top corner fixes the whole vertical chain: thumb link
    // centre, thumb board edge, the clip line that becomes the finger board's
    // edge, and the finger link centre -- each a declared clearance apart.
    let top = thumbs.reduce(
        (a, k) -> {
            key_corners(k).reduce(
                (b, c) -> {
                    if (c.y < b) {
                        c.y
                    } else {
                        b
                    }
                },
                a,
            )
        },
        1000000.0,
    );
    let thumb_y = top + LINK_SINK();
    let pocket_edge = thumb_y - 5.0 - thumb_board_margin();
    let clip = pocket_edge - LINK_GAP();
    let finger_y = clip - 0.91 - LINK_PAD_EDGE();

    // Over the middle of the cluster, walking inboard past anything either
    // connector body would hit. The corridor east of the finger columns and
    // above the thumb cluster's home key is the one place both boards are
    // clear: the home key sits well south of the key nearest the fingers, so
    // the fan rows reach the contacts without crossing any key's hardware.
    //
    // The dodge is measured against each key's real footprint within the
    // connector's own y-band, not its bounding box -- a splayed key's box
    // corner reaches into the band long before the key itself does, and the
    // box test walks the connector past the whole cluster.
    let x = thumbs.reduce(
        (a, k) -> {
            a + to_kicad(k.pos()).x
        },
        0.0,
    )
        / (thumbs.length() * 1.0);
    let f_top = finger_y - LINK_BODY_DEPTH();
    let f_bot = finger_y + 5.0;
    let t_top = thumb_y - 5.0;
    let t_bot = thumb_y + LINK_BODY_DEPTH();
    let pass = 0;
    while (pass < 4) {
        for (let k in fingers.concat(thumbs)) {
            let cs = key_corners(k);
            for (let e in [band_extent(cs, f_top, f_bot), band_extent(cs, t_top, t_bot)]) {
                if (e.hit && x + hw + 1.0 > e.x1 && x - hw - 1.0 < e.x2) {
                    x
                        = if (inboard > 0.0) {
                            e.x2 + hw + 1.0
                        } else {
                            e.x1 - hw - 1.0
                        };
                }
            }
        }
        pass = pass + 1;
    }
    LinkSpot { x: x, finger_y: finger_y, thumb_y: thumb_y }
}

/// A thumb board hugs its keys tighter than a finger board: its outline is
/// half of the link gap's budget, and the cluster has no fan band to cover.
function thumb_board_margin() -> float {
    2.0
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
        // side on the way to the connector, and under the bottom of a column
        // on the way to the next one. Feed those corners into the hull too
        // rather than hoping the margin covers them.
        // A thumb board is exempt: its chain hops straight from key to key on
        // the back, inside the footprints' own boxes, so the halo would only
        // swell the board -- and shove the clip pocket into the finger board's
        // connector strip.
        if (f.per_key_leds && !m.id.starts_with("thumb")) {
            for (let c in led_reach_corners(k)) {
                corners.push(c);
            }
        }
    }

    // Connector edges contribute to the hull so the board grows to contain
    // them.
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
    // A finger half stands its pod link on the inboard edge, level with the
    // middle of its keys, contacts outward so the cable leaves toward the pod
    // between the halves. The finger->thumb and thumb->finger connectors are
    // a FACING PAIR: same x, one on each board, contacts toward each other
    // across the link gap, in the pocket just outboard of the cluster's
    // nearest key -- so the ribbon between them is a straight few millimetres.
    //
    // Nothing here is a free choice once the cable directions are fixed. A
    // connector's contacts face the way its cable leaves; the fan therefore
    // has to arrive from behind them, under the body; and the order the
    // contacts run in is what makes that fan planar. See `route_fanin`.

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
    let mean_key_y = m.keys.reduce(
        (a, k) -> {
            a + to_kicad(k.pos()).y
        },
        0.0,
    )
        / (m.keys.length() * 1.0);

    // The pod link and the thumb link now share the inboard side, so the pod
    // link's contact row -- and the lanes that serve it -- must end clear
    // above the thumb-link pocket, or the low lanes run through J2's pads.
    let pocket_top = links.reduce(
        (a, r) -> {
            if (r.from_module == "pod") {
                a
            } else {
                let spot = link_spot(m.id, r.signals.length(), inboard);
                let t = spot.finger_y - LINK_BODY_DEPTH();
                if (t < a) {
                    t
                } else {
                    a
                }
            }
        },
        1000000.0,
    );

    let ci = 1;
    for (let r in links) {
        let ways = r.signals.length();
        let side_mount = r.from_module == "pod";
        let at = if (side_mount) {
            let cap = pocket_top - ((ways - 1) * 1.0) / 2.0 - 1.5;
            let y = if (cap < mean_key_y) {
                cap
            } else {
                mean_key_y
            };
            Vec2 { x: key_edge + inboard * bus_reach(ways), y: y }
        } else {
            let spot = link_spot(m.id, ways, inboard);
            if (m.id.starts_with("thumb")) {
                Vec2 { x: spot.x, y: spot.thumb_y }
            } else {
                Vec2 { x: spot.x, y: spot.finger_y }
            }
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
            // The link pair keeps its standoff vias inside the body: one
            // depth, one per contact x. See `route_passthroughs`.
            LINK_BODY_DEPTH()
        };
        // The from-end of a ribbon assigns its pads from the reversed list --
        // see `from_end_signals`. On this module that is the thumb link's
        // finger-side connector; the pod link's from-end is on the pod.
        let pad_sigs = if (r.from_module == m.id) {
            from_end_signals(r.signals)
        } else {
            r.signals
        };
        comps.push(connector_component(`J${ci}`, pad_sigs, at, ar));
        for (let c in connector_corners(ways, at, ar, back)) {
            corners.push(c);
        }
        ci = ci + 1;
    }

    let hull = expand_hull(
        convex_hull(corners),
        if (m.id.starts_with("thumb")) {
            thumb_board_margin()
        } else {
            board_margin(f)
        },
    );

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
    // Thumb boards first: each finger board's outline is then clipped against
    // its thumb sibling grown by the link gap. The finger hull is convex and
    // the cluster tucks in under the splayed columns, so without the clip the
    // hull sweeps over it -- this notch is what lets two separate coplanar
    // boards share the corner.
    let thumbs = mods
        .filter((m) -> {
            m.id.starts_with("thumb")
        })
        .map((m) -> {
            route_board(build_board(m, ribbons, f), m, f)
        });
    let boards: Board[] = [];
    for (let m in mods) {
        if (m.id.starts_with("thumb")) {
            boards.push(find_board(thumbs, m.id));
        } else {
            let b = route_board(build_board(m, ribbons, f), m, f);
            let sib = find_board(thumbs, `thumb_${hand_of(m.id)}`);
            let outline = clip_outline(b.outline, expand_hull(sib.outline, LINK_GAP()));
            boards.push(
                Board {
                    id: b.id,
                    components: b.components,
                    outline: outline,
                    tracks: b.tracks,
                    vias: b.vias,
                    zones: board_zones(outline, f),
                },
            );
        }
    }
    // The pod is a module in the wiring but not in the layout -- it has no keys
    // to partition -- so it is built rather than derived.
    boards.push(build_pod_board(ribbons, f));
    boards
}

function hand_of(id: string) -> string {
    if (id.ends_with("_r")) {
        "r"
    } else {
        "l"
    }
}

function find_board(bs: Board[], id: string) -> Board throws baml.errors.InvalidArgument {
    bs.find((b) -> {
        b.id == id
    })
        ?? throw baml.errors.InvalidArgument { message: `no board '${id}'` }
}
