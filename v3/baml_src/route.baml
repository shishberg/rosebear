// Routing.
//
// These boards are not a general routing problem and don't want a general
// router. The topology is a fan-in: every key has exactly one signal net with
// exactly two pads -- its own switch pin and one contact on the ribbon
// connector -- and everything else is ground.
//
// Two facts make that trivially routable:
//
//   * Ground doesn't need traces at all. A pour on each side reaches every
//     switch pin (through-hole) and the connector's mounting pegs (SMD, front).
//
//   * We choose the connector pinout. `ribbon_signals` emits key signals in
//     column order, so if the columns are read off the board left to right the
//     nets fan in without a single crossing. That makes this a river-routing
//     problem, which has a closed-form answer -- no search, no rip-up, and a
//     deterministic result, which a stochastic autorouter could not give.
//
// The pod board will not be like this and will want Freerouting or hand
// routing; nothing here is meant to generalise to it.

class Track {
    start: Vec2,
    end: Vec2,
    width: float,
    layer: string,
    net: string,
}

class Via {
    at: Vec2,
    net: string,
}

class Zone {
    net: string,
    layer: string,
    outline: Vec2[],
}

function TRACE_W() -> float {
    0.25
}

/// Lane-to-lane spacing in a column channel.
///
/// Wide relative to the connector's 1.00mm pitch on purpose: the lanes and the
/// contacts stay in the same order, so the fan-in is monotone either way, and
/// the extra room is what keeps the diagonals clear of each other where the
/// bundle narrows.
function LANE_PITCH() -> float {
    1.8
}

/// Where a column's escape channel sits, in the key frame -- which the hotswap
/// footprint puts on the key centre.
///
/// The hotswap socket's own pads reach x=+7.12, and the next column's socket
/// starts around x=+10.6 on the back; on the front the nearest obstruction is
/// that column's 3mm pin clearance hole at about x=+13.7. Three lanes from
/// +7.8 therefore clear the socket at this end and the next column at the
/// other, on the layer they actually run on.
function LANE_X0() -> float {
    7.8
}

/// How far below the lowest key on the board the escape channels all end.
///
/// They must end on a *common* line. Two monotone sequences of points on two
/// parallel lines can always be joined without a crossing; exits at differing
/// heights lose that guarantee, and the staggered columns differ by ~25mm.
///
/// Deep enough to clear the LED chain as well. The line is common to the whole
/// board but the columns are staggered, so 6mm below the lowest key was only
/// 5mm below the highest column's bottom key -- above its LED's own dout row,
/// which put the fan-in diagonals straight through the chain.
function COLUMN_EXIT() -> float {
    13.0
}

/// Clearance kept between the fan-in bus and the connector contacts.
function BUS_GAP() -> float {
    2.5
}

// ------------------------------------------------------- footprint geometry
//
// Pad offsets are declared rather than parsed. `route_test.baml` asserts each
// one against the installed .kicad_mod, so a library change fails the build
// instead of quietly moving a trace off its pad.

/// Kailh hotswap socket, terminal 1 -- the key's own net. Surface pad, BACK.
function MX_SIGNAL_PAD() -> Vec2 {
    Vec2 { x: 5.842, y: 0.0 - 5.08 }
}

/// Kailh hotswap socket, terminal 2 -- tied to ground. Surface pad, BACK.
function MX_GND_PAD() -> Vec2 {
    Vec2 { x: 0.0 - 7.085, y: 0.0 - 2.54 }
}

/// Reverse-mount LED pads, in library coordinates. `comp_to_global` mirrors
/// them, because the LED is placed on the back.
function LED_VDD_PAD() -> Vec2 {
    Vec2 { x: 0.0 - 2.725, y: 0.75 }
}

function LED_DOUT_PAD() -> Vec2 {
    Vec2 { x: 0.0 - 2.725, y: 0.0 - 0.75 }
}

function LED_GND_PAD() -> Vec2 {
    Vec2 { x: 2.725, y: 0.0 - 0.75 }
}

function LED_DIN_PAD() -> Vec2 {
    Vec2 { x: 2.725, y: 0.75 }
}

/// Contact `i` (1-based) of a Molex 200528 of `ways` ways, in footprint
/// coordinates. 1.00mm pitch, centred, contacts on the key side of the body.
function ffc_pad_local(i: int, ways: int) -> Vec2 {
    Vec2 { x: (i * 1.0) - (((ways + 1) * 1.0) / 2.0), y: 0.0 - 0.91 }
}

// ------------------------------------------------------------------ frames

/// A footprint-local point in board coordinates.
///
/// KiCad applies the negation of a footprint's stored angle to its local
/// coordinates; see `local_to_board` in netlist.baml.
function comp_to_global(c: Component, v: Vec2) -> Vec2 {
    // A footprint on the back is mirrored about the x axis and its rotation
    // runs the other way; `embed_footprint` writes the board file to match, and
    // this has to agree with it or every trace to a back-side pad misses.
    let back = c.layer == "B.Cu";
    let w = if (back) {
        Vec2 { x: v.x, y: 0.0 - v.y }
    } else {
        v
    };
    let a = if (back) {
        c.r
    } else {
        0.0 - c.r
    };
    let p = rotate_about(w, a, Vec2 { x: 0.0, y: 0.0 });
    Vec2 { x: c.x + p.x, y: c.y + p.y }
}

/// Board coordinates into the frame of a column (origin and angle of its
/// bottom key), where the column runs straight up the -y axis whatever its
/// splay.
function to_frame(p: Vec2, origin: Vec2, r: float) -> Vec2 {
    rotate_about(Vec2 { x: p.x - origin.x, y: p.y - origin.y }, r, Vec2 { x: 0.0, y: 0.0 })
}

function from_frame(v: Vec2, origin: Vec2, r: float) -> Vec2 {
    let p = rotate_about(v, 0.0 - r, Vec2 { x: 0.0, y: 0.0 });
    Vec2 { x: origin.x + p.x, y: origin.y + p.y }
}

// --------------------------------------------------------------- the router

/// One key's signal, with everything the router needs about it.
/// Where a net leaves its column channel and enters the fan-in.
class Escape {
    net: string,
    p: Vec2,
}

class Leg {
    net: string,
    /// Column this key belongs to; keys sharing one are collinear.
    column: string,
    /// The switch's signal pad, in board coordinates.
    pad: Vec2,
    /// The switch footprint's placement, giving the column its axis.
    origin: Vec2,
    r: float,
    /// The connector contact this net lands on, and the outward normal of the
    /// connector it sits on -- the fan-in stops one `BUS_GAP` in front of the
    /// contact, which is a different direction on each board now.
    target: Vec2,
    normal: Vec2,
    /// Contact number, which is also this net's rank in the fan-in.
    pin: int,
    /// Where this net's escape channel ends and its fan-in run begins.
    exit_y: float,
}

/// The column a key net belongs to.
///
/// Key nets are `KEY_[MIRROR_]<zone>_<column>_<row>`, so the column is always
/// the second-to-last field -- counting from the front picks up "MATRIX" for
/// every mirrored key, collapsing the right hand into one 15-lane column.
function column_of(net: string) -> string {
    let parts = net.split("_");
    parts.at(parts.length() - 2) ?? ""
}

function is_switch(c: Component) -> bool {
    c.ref.starts_with("SW")
}

function is_connector(c: Component) -> bool {
    c.ref.starts_with("J")
}

/// Unit vector pointing out of the back of a connector, away from its
/// contacts.
///
/// The contacts face local -y, so behind is local +y. Everything that runs
/// *behind* the contacts -- the pass-through band, the chain's two link vias --
/// used to add to `y` directly, which was only right while every connector sat
/// flat along the bottom edge. The finger halves now stand theirs on the
/// inboard edge, turned 90 degrees, so "behind" is sideways there.
function conn_normal(c: Component) -> Vec2 {
    let o = comp_to_global(c, Vec2 { x: 0.0, y: 0.0 });
    let q = comp_to_global(c, Vec2 { x: 0.0, y: 1.0 });
    Vec2 { x: q.x - o.x, y: q.y - o.y }
}

/// `p` moved `d` along `n`. Negative `d` moves in front of the contacts.
function along(p: Vec2, n: Vec2, d: float) -> Vec2 {
    Vec2 { x: p.x + n.x * d, y: p.y + n.y * d }
}

/// The normal of whichever connector carries `net`.
function contact_normal(conns: Component[], net: string) -> Vec2 {
    for (let c in conns) {
        for (let p in c.pads) {
            if (p.pad != "MP" && p.net == net) {
                return conn_normal(c);
            }
        }
    }
    Vec2 { x: 0.0, y: 1.0 }
}

/// Where a net lands on a connector, if it lands on one at all.
function find_contact(conns: Component[], net: string) -> Vec2? {
    let hits: Vec2[] = [];
    for (let c in conns) {
        let ways = c.pads.length() - 1;
        let i = 1;
        for (let p in c.pads) {
            if (p.pad != "MP" && p.net == net) {
                hits.push(comp_to_global(c, ffc_pad_local(i, ways)));
            }
            if (p.pad != "MP") {
                i = i + 1;
            }
        }
    }
    hits.at(0)
}

function pin_index(conns: Component[], net: string) -> int {
    for (let c in conns) {
        let i = 1;
        for (let p in c.pads) {
            if (p.pad != "MP") {
                if (p.net == net) {
                    return i;
                }
                i = i + 1;
            }
        }
    }
    0
}

function collect_legs(b: Board, exit_y: float) -> Leg[] {
    let conns = b.components.filter((c) -> {
        is_connector(c)
    });
    let legs: Leg[] = [];
    for (let c in b.components) {
        if (is_switch(c)) {
            let net = (
                c.pads
                    .find((p) -> {
                        p.pad == "1"
                    })
                    ?.net
            )
                ?? "";
            if (net != "") {
                if let t: Vec2 = find_contact(conns, net) {
                    legs.push(
                        Leg {
                            net: net,
                            column: column_of(net),
                            pad: comp_to_global(c, MX_SIGNAL_PAD()),
                            origin: Vec2 { x: c.x, y: c.y },
                            r: c.r,
                            target: t,
                            normal: contact_normal(conns, net),
                            pin: pin_index(conns, net),
                            exit_y: exit_y,
                        },
                    );
                }
            }
        }
    }
    legs
}

function seg(a: Vec2, b: Vec2, net: string) -> Track {
    Track { start: a, end: b, width: TRACE_W(), layer: "F.Cu", net: net }
}

/// Escape every key in one column into its own lane, and run the lanes down
/// past the bottom key. Returns the point each net leaves the column at.
///
/// The column is straight in its own frame however it is splayed, so the lanes
/// stay parallel and no two can meet.
function route_column(legs: Leg[], out: Track[], vias: Via[]) -> Escape[] {
    let exits: Escape[] = [];
    if (legs.length() == 0) {
        return exits;
    }
    // The bottom key defines the frame; +y is down the column.
    let bottom = legs.reduce(
        (a, l) -> {
            if (l.pad.y > a.pad.y) {
                l
            } else {
                a
            }
        },
        legs.at(0)
            ?? Leg {
                net: "",
                column: "",
                pad: Vec2 { x: 0.0, y: 0.0 },
                origin: Vec2 { x: 0.0, y: 0.0 },
                r: 0.0,
                target: Vec2 { x: 0.0, y: 0.0 },
                pin: 0,
            },
    );
    let origin = bottom.origin;
    // A column of one key has no axis of its own to follow, and taking the
    // key's would send the channel off at whatever angle that key is turned to
    // -- the thumb cluster fans its keys by 15 degrees and turns one of them 90.
    // With nothing to run alongside, such a key escapes straight down the board.
    let r = if (legs.length() > 1) {
        bottom.r
    } else {
        0.0
    };

    // Lane order follows contact order, so lanes and contacts stay in step.
    let ordered = legs.sort_by((a, b) -> {
        a.pin - b.pin
    });

    let lane = 0;
    for (let l in ordered) {
        let local = to_frame(l.pad, origin, r);
        let lx = LANE_X0() + (lane * 1.0) * LANE_PITCH();
        let turn = from_frame(Vec2 { x: lx, y: local.y }, origin, r);
        // The channel is straight in the column frame, so it stays parallel to
        // the column however it is splayed; it leaves that frame on the shared
        // exit line.
        let down = from_frame(Vec2 { x: lx, y: local.y + 1.0 }, origin, r);
        let steps = (l.exit_y - turn.y) / (down.y - turn.y);
        let exit = Vec2 { x: turn.x + (down.x - turn.x) * steps, y: l.exit_y };
        // Sideways out of the socket, then down the channel to the exit line.
        //
        // The first leg of that is on the BACK: a hotswap terminal is a surface
        // pad on the back of the board, so nothing about this net exists on the
        // front until it has changed layer. It does that at the innermost lane,
        // which is the first place past the socket's own pads with room for a
        // via, and everything downstream is on the front as before.
        let entry = from_frame(Vec2 { x: LANE_X0(), y: local.y }, origin, r);
        out.push(back(l.pad, entry, l.net));
        vias.push(Via { at: entry, net: l.net });
        if (lane > 0) {
            out.push(seg(entry, turn, l.net));
        }
        out.push(seg(turn, exit, l.net));
        exits.push(Escape { net: l.net, p: exit });
        lane = lane + 1;
    }
    exits
}

/// Fan the column exits into the connector.
///
/// The exits lie on one horizontal line below the keys; the contacts lie on the
/// connector's own line. Two chords joining two disjoint arcs of a convex
/// region never cross exactly when the matching *reverses* the boundary order
/// -- the first exit takes the last contact. That is the whole planarity
/// argument, and it holds whichever way the connector faces.
///
/// While the connector lay flat along the bottom edge the two lines were
/// parallel, the reversal was the identity, and a straight run per net was the
/// natural shape. Standing it on the inboard edge turns the contact line
/// through a right angle, and two things follow.
///
/// The reversal now falls out of the rotation. A connector on the RIGHT is
/// turned 90 degrees, which lays contact 1 at the bottom and contact n at the
/// top, so ascending contact number still means ascending exit x. On the LEFT
/// it is turned 270 and the contacts run the other way, which is exactly the
/// mirrored board's requirement. The angle that points the cable off the board
/// is the angle that keeps the fan planar; there is nothing left to choose.
///
/// The straight run is no longer the right shape, though. Contacts a millimetre
/// apart along a vertical line, approached by a run that is itself nearly
/// vertical, are a millimetre apart *along* the runs and a fifth of that across
/// them -- two neighbours came within 0.08mm. So each net drops at its own exit
/// x to its own contact's row and turns in square. Adjacent drops are a lane
/// pitch apart and adjacent rows a contact pitch apart, both measured the short
/// way, and a row passing beneath another net's drop clears it by the pitch,
/// because a net whose contact is deeper is a net further from the connector.
function escape_of(es: Escape[], net: string) -> Vec2 {
    (
        es
            .find((e) -> {
                e.net == net
            })
            ?.p
    )
        ?? Vec2 { x: 0.0, y: 0.0 }
}

function route_fanin(legs: Leg[], exits: Escape[], out: Track[]) -> void {
    let ordered = legs.sort_by((a, b) -> {
        a.pin - b.pin
    });
    for (let l in ordered) {
        let e = escape_of(exits, l.net);
        if (l.normal.x.abs() > 0.5) {
            // Side-mounted: the contact line crosses the exit line, so turn the
            // corner. In square to the pad, which is also the direction the
            // ribbon pulls.
            let corner = Vec2 { x: e.x, y: l.target.y };
            out.push(seg(e, corner, l.net));
            out.push(seg(corner, l.target, l.net));
        } else {
            // Bottom-mounted, contacts parallel to the exit line: one straight
            // run, ending in a short stub square to the pad so it is never
            // approached at a shallow angle.
            let stub = along(l.target, l.normal, 0.0 - BUS_GAP());
            out.push(seg(e, stub, l.net));
            out.push(seg(stub, l.target, l.net));
        }
    }
}

/// How far in front of a connector a pass-through drops to the back.
///
/// Each pass-through gets its own standoff. Both connectors sit on the same
/// line, so a shared one would put every back-side run at the same height, all
/// three collinear and shorted together.
///
/// Measured *behind* the contacts, under the connector body, not in front of
/// them. In front is where the fan-in lands, and the pass-through contacts sit
/// right beside the inner column's, so the two would fight for the same few
/// millimetres. Behind the contacts is empty board that nothing else wants.
function VIA_STANDOFF() -> float {
    1.6
}

function via_standoff(n: int) -> float {
    VIA_STANDOFF() + (n * 1.0) * LANE_PITCH()
}

function VIA_DIA() -> float {
    0.6
}

/// Nets that arrive on one connector and leave on another.
///
/// The thumb cluster hangs off its finger board, so its three key nets cross
/// the finger board without touching a switch on it: pod -> J1 -> J2 -> thumb.
/// They are the one thing here that is not a fan-in, and the only place the
/// board needs its second layer.
function route_passthroughs(b: Board, f: Features, out: Track[], vias: Via[]) -> void {
    let conns = b.components.filter((c) -> {
        is_connector(c)
    });
    let n = if (f.per_key_leds) {
        LED_LINK_SLOTS()
    } else {
        0
    };
    for (let a in conns) {
        for (let z in conns) {
            if (a.ref < z.ref) {
                let ways_a = a.pads.length() - 1;
                let ways_z = z.pads.length() - 1;
                let ia = 1;
                for (let pa in a.pads) {
                    if (pa.pad != "MP") {
                        let iz = 1;
                        for (let pz in z.pads) {
                            if (pz.pad != "MP") {
                                if (pa.net == pz.net && pa.net.starts_with("KEY_")) {
                                    let pta = comp_to_global(a, ffc_pad_local(ia, ways_a));
                                    let ptz = comp_to_global(z, ffc_pad_local(iz, ways_z));
                                    let off = via_standoff(n);
                                    n = n + 1;
                                    let va = along(pta, conn_normal(a), off);
                                    let vz = along(ptz, conn_normal(z), off);
                                    // Out of the contact on the front, down to
                                    // the back, across behind the connectors,
                                    // and up again. The pour parts around them.
                                    out.push(seg(pta, va, pa.net));
                                    vias.push(Via { at: va, net: pa.net });
                                    out.push(
                                        Track {
                                            start: va,
                                            end: vz,
                                            width: TRACE_W(),
                                            layer: "B.Cu",
                                            net: pa.net,
                                        },
                                    );
                                    vias.push(Via { at: vz, net: pa.net });
                                    out.push(seg(vz, ptz, pa.net));
                                }
                                iz = iz + 1;
                            }
                        }
                        ia = ia + 1;
                    }
                }
            }
        }
    }
}

/// Ground is poured, not routed: a zone on each side.
function ground_zones(b: Board) -> Zone[] {
    [
        Zone { net: "GND", layer: "F.Cu", outline: b.outline },
        Zone { net: "GND", layer: "B.Cu", outline: b.outline },
    ]
}

/// The two pours on a key board.
///
/// The front is always ground. The back is ground too until per-key LEDs are
/// fitted, and then it becomes the LED supply instead -- 36 LEDs at 20mA is
/// 720mA, which wants a plane rather than a rail, and a plane is also the only
/// thing that reaches every LED without a comb of stubs weaving between the
/// hotswap sockets and the data chain.
///
/// The cost is two vias per key: with the back given over to the supply, the
/// socket's ground terminal and the LED's both have to reach the front pour.
/// `route_ground_vias` places them.
function board_zones(outline: Vec2[], f: Features) -> Zone[] {
    let back = if (f.per_key_leds) {
        LED_VDD_NET()
    } else {
        "GND"
    };
    [
        Zone { net: "GND", layer: "F.Cu", outline: outline },
        Zone { net: back, layer: "B.Cu", outline: outline },
    ]
}

/// The lowest switch signal pad on a board.
///
/// This is the one number the placement and the router have to agree on: it
/// fixes the escape line, and the connectors are placed relative to it so every
/// fan-in diagonal runs *away* from the key field.
function lowest_signal_pad(comps: Component[]) -> float {
    comps.reduce(
        (a, c) -> {
            if (is_switch(c)) {
                let p = comp_to_global(c, MX_SIGNAL_PAD());
                if (p.y > a) {
                    p.y
                } else {
                    a
                }
            } else {
                a
            }
        },
        0.0 - 100000.0,
    )
}

/// Clearance kept between a track or via and the board edge when the outline
/// is drawn around them. Half a trace plus the 0.5mm edge rule, rounded up.
function EDGE_HALO() -> float {
    1.0
}

/// Grow `hull` until it contains every track end and via, with `EDGE_HALO` to
/// spare.
///
/// The placement draws the hull from the keys and the connectors, which is
/// everything it knows about; the router then puts copper wherever the escapes
/// and the LED chain actually need to go. Rather than pad the first guess and
/// hope, take the hull the routing implies.
function enclose(hull: Vec2[], tracks: Track[], vias: Via[]) -> Vec2[] {
    let pts: Vec2[] = [];
    for (let p in hull) {
        pts.push(p);
    }
    let h = EDGE_HALO();
    let ends: Vec2[] = [];
    for (let t in tracks) {
        ends.push(t.start);
        ends.push(t.end);
    }
    for (let v in vias) {
        ends.push(v.at);
    }
    for (let e in ends) {
        // A square halo, so the hull clears the point from every direction.
        pts.push(Vec2 { x: e.x - h, y: e.y - h });
        pts.push(Vec2 { x: e.x + h, y: e.y - h });
        pts.push(Vec2 { x: e.x + h, y: e.y + h });
        pts.push(Vec2 { x: e.x - h, y: e.y + h });
    }
    convex_hull(pts)
}

function route_board(b: Board, m: Module, f: Features) -> Board {
    let tracks: Track[] = [];
    let vias: Via[] = [];

    // The escape line, below every key on the board.
    let lowest = lowest_signal_pad(b.components);
    let exit_y = lowest + COLUMN_EXIT();
    let legs = collect_legs(b, exit_y);

    // Group by column. Keys in a column share an axis, which is what lets the
    // escape channel be a straight line.
    let seen: string[] = [];
    for (let l in legs) {
        if (!contains_str(seen, l.column)) {
            seen.push(l.column);
        }
    }

    let all_exits: Escape[] = [];
    let all_legs: Leg[] = [];
    for (let col in seen) {
        let group = legs
            .filter((l) -> {
                l.column == col
            })
            .sort_by((a, b) -> {
                a.pin - b.pin
            });
        for (let e in route_column(group, tracks, vias)) {
            all_exits.push(e);
        }
        for (let l in group) {
            all_legs.push(l);
        }
    }
    route_fanin(all_legs, all_exits, tracks);

    route_passthroughs(b, f, tracks, vias);
    route_leds(b, m, f, lowest, tracks, vias);
    route_ground_vias(b, f, vias, tracks);
    route_supply_vias(b, f, vias, tracks);

    // The outline is redrawn around the finished routing rather than guessed
    // from the key positions, so a channel that reaches further than expected
    // takes the board edge with it instead of running off it.
    let outline = enclose(b.outline, tracks, vias);
    Board {
        id: b.id,
        components: b.components,
        outline: outline,
        tracks: tracks,
        vias: vias,
        zones: board_zones(outline, f),
    }
}

// ------------------------------------------------------------- per-key LEDs
//
// The chain is a path through 15 (or 3) reverse-mount LEDs on the back, and it
// is the only net on a key board that is not a fan-in. Two shapes carry it:
//
//   * Within a column, on the FRONT. Each hop leaves its LED's dout on the back,
//     vias up beside the LED, runs a single lane up the column between the
//     switch's stabiliser hole and the previous column's channel, and vias back
//     down beside the next LED's din. Consecutive hops share that lane and
//     never meet, because the dout via sits 1.25mm above the din via: hop `j`
//     ends where hop `j+1` has not started.
//
//   * Between columns, on the BACK. The front between two columns is the first
//     one's channel and cannot be crossed. The back can be, but only outside
//     the key field -- so a transition leaves the column at whichever end the
//     chain reached, runs out past the last key, crosses, and comes back in.
//     Boustrophedon ordering is what makes that work: consecutive columns are
//     always entered and left at the same end.

function is_led(c: Component) -> bool {
    c.ref.starts_with("LED")
}

function pad_net(c: Component, name: string) -> string {
    (
        c.pads
            .find((p) -> {
                p.pad == name
            })
            ?.net
    )
        ?? ""
}

/// A point in the frame of the key an LED sits on.
///
/// The LED is placed at `LED_OFFSET` from the key centre in the key's own
/// frame, so undoing that offset recovers the frame every constant below is
/// quoted in -- the same one the hotswap footprint is drawn in.
function led_key_pt(led: Component, v: Vec2) -> Vec2 {
    // `led_component` stores -r on the LED, so the key's frame is +led.r here.
    let off = rotate_about(LED_OFFSET(), led.r, Vec2 { x: 0.0, y: 0.0 });
    let p = rotate_about(v, led.r, Vec2 { x: 0.0, y: 0.0 });
    Vec2 { x: led.x - off.x + p.x, y: led.y - off.y + p.y }
}

/// Where a hop leaves an LED for the front. Left of the LED, clear of its pads.
function LED_DOUT_VIA() -> Vec2 {
    Vec2 { x: 0.0 - 4.5, y: 5.75 }
}

/// The corner the din stub turns at, so the approach never runs down x=+2.725
/// -- which is where the LED's ground pad sits.
function LED_DIN_ELBOW() -> Vec2 {
    Vec2 { x: 4.5, y: 4.25 }
}

/// The row a hop leaves its LED on, clear of the LED's own Edge.Cuts window.
///
/// That window is the hole the light comes up through. It is board edge as far
/// as DRC is concerned, so nothing may run within half a millimetre of it, and
/// it sits directly between the dout pad and the lane.
function LED_DOUT_ROW() -> float {
    8.6
}

/// Where a hop comes back down to an LED's din. Which side of `LED_DOUT_ROW`
/// depends on which way the column runs, and that is the whole reason
/// consecutive hops can share one lane.
///
/// A hop occupies the lane between the row its source leaves on and the row
/// its target arrives on. The next hop starts one row-pitch further along. For
/// the two spans to miss each other, the arrival row must be PAST the
/// departure row in the direction the chain is travelling -- so a column
/// running down the board arrives above where it left, and one running up
/// arrives below.
function LED_DIN_VIA(down: bool) -> Vec2 {
    if (down) {
        LED_DIN_ELBOW()
    } else {
        Vec2 { x: 4.5, y: 10.0 }
    }
}

/// True when the chain runs down the board from `src` to `dst`, measured along
/// the column's own axis rather than the board's.
function led_hop_down(src: Component, dst: Component) -> bool {
    let axis = rotate_about(Vec2 { x: 0.0, y: 1.0 }, src.r, Vec2 { x: 0.0, y: 0.0 });
    (dst.x - src.x) * axis.x + (dst.y - src.y) * axis.y > 0.0
}

/// The front lane an intra-column hop runs up: between this key's stabiliser
/// hole (x=+5.93) and the previous column's outermost channel lane (x=-7.6 of
/// this key, which is +11.4 of that one).
function LED_LANE_X() -> float {
    6.9
}

/// The back lane a transition runs out on, in the corridor between the
/// columns' hotswap sockets -- past this key's socket (x=+7.12) and short of
/// the next column's (x=+10.6).
function LED_BUS_X() -> float {
    9.5
}

/// The row a transition leaves its LED on. Below the ground-pad via, and above
/// the pin clearance hole of the key below.
function LED_EXIT_Y() -> float {
    13.0
}

/// How far past the end key a transition crosses: over the top, or under the
/// bottom. Both are outside the key field, which is the only place the back is
/// free all the way across.
function LED_OVER_Y() -> float {
    0.0 - 14.0
}

function LED_UNDER_Y() -> float {
    16.0
}

/// Where the LED's ground pad reaches the front pour. Below and inboard, which
/// is the one direction that clears the light window, the din stub, the dout
/// row and the transition row all at once.
function LED_GND_VIA() -> Vec2 {
    Vec2 { x: 1.0, y: 10.5 }
}

/// Where the hotswap socket's ground terminal reaches the front pour.
function MX_GND_VIA() -> Vec2 {
    Vec2 { x: 0.0 - 6.5, y: 0.0 - 10.5 }
}

/// The lane the last LED's dout takes out past the end of the key field, on
/// its way down to the connector.
function LED_TAIL_X() -> float {
    11.5
}

/// One LED to the next within a column, on the front.
function route_led_hop(
    src: Component,
    dst: Component,
    net: string,
    out: Track[],
    vias: Via[],
) -> void {
    let din = LED_DIN_VIA(led_hop_down(src, dst));
    let a = led_key_pt(src, LED_DOUT_VIA());
    out.push(back(comp_to_global(src, LED_DOUT_PAD()), a, net));
    vias.push(Via { at: a, net: net });

    let a2 = led_key_pt(src, Vec2 { x: LED_DOUT_VIA().x, y: LED_DOUT_ROW() });
    let a3 = led_key_pt(src, Vec2 { x: LED_LANE_X(), y: LED_DOUT_ROW() });
    let b3 = led_key_pt(dst, Vec2 { x: LED_LANE_X(), y: din.y });
    let z = led_key_pt(dst, din);
    out.push(seg(a, a2, net));
    out.push(seg(a2, a3, net));
    out.push(seg(a3, b3, net));
    out.push(seg(b3, z, net));
    vias.push(Via { at: z, net: net });
    route_din_stub(dst, z, net, out);
}

/// Down the elbow into the din pad. Shared by both hop shapes.
function route_din_stub(dst: Component, from: Vec2, net: string, out: Track[]) -> void {
    let e = led_key_pt(dst, LED_DIN_ELBOW());
    let p = comp_to_global(dst, LED_DIN_PAD());
    if (from.x != e.x || from.y != e.y) {
        out.push(back(from, e, net));
    }
    out.push(back(e, p, net));
}

/// A column change, on the back, around the end of the key field.
///
/// `sign` is -1 to cross over the top of the columns and +1 to cross under the
/// bottom -- whichever end the chain reached, which is the same end for both
/// columns because the chain snakes.
function route_led_transition(
    src: Component,
    dst: Component,
    net: string,
    sign: float,
    out: Track[],
) -> void {
    let cy = if (sign < 0.0) {
        LED_OVER_Y()
    } else {
        LED_UNDER_Y()
    };
    let p0 = comp_to_global(src, LED_DOUT_PAD());
    let p1 = led_key_pt(src, Vec2 { x: LED_DOUT_PAD().x, y: LED_EXIT_Y() });
    let p2 = led_key_pt(src, Vec2 { x: LED_BUS_X(), y: LED_EXIT_Y() });
    let p3 = led_key_pt(src, Vec2 { x: LED_BUS_X(), y: cy });
    let q3 = led_key_pt(dst, Vec2 { x: LED_BUS_X(), y: cy });
    let q2 = led_key_pt(dst, Vec2 { x: LED_BUS_X(), y: LED_EXIT_Y() });
    let q1 = led_key_pt(dst, Vec2 { x: LED_DIN_ELBOW().x, y: LED_EXIT_Y() });
    // The two columns are staggered, so their ends are not level. Crossing on
    // the straight line between them cuts the corner of whichever key sticks
    // out further; crossing at the extreme of the two clears both.
    let ex = if (sign < 0.0) {
        if (p3.y < q3.y) {
            p3.y
        } else {
            q3.y
        }
    } else if (p3.y > q3.y) {
        p3.y
    } else {
        q3.y
    };
    let m1 = Vec2 { x: p3.x, y: ex };
    let m2 = Vec2 { x: q3.x, y: ex };
    for (let e in [[p0, p1], [p1, p2], [p2, p3], [p3, m1], [m1, m2], [m2, q3], [q3, q2], [q2, q1]]) {
        let a = vec_at(e, 0);
        let z = vec_at(e, 1);
        if (a.x != z.x || a.y != z.y) {
            out.push(back(a, z, net));
        }
    }
    route_din_stub(dst, q1, net, out);
}

/// The ribbon's data conductor into the first LED, on the back.
///
/// Out past the pass-throughs first. They run on the back too, in a band
/// between the two connectors, and a straight line from the contact to the key
/// field crosses every one of them.
function route_led_head(
    contact: Vec2,
    normal: Vec2,
    dst: Component,
    outward: float,
    net: string,
    out: Track[],
    vias: Via[],
) -> void {
    let v = along(contact, normal, via_standoff(0));
    out.push(seg(contact, v, net));
    vias.push(Via { at: v, net: net });
    let p = led_key_pt(dst, Vec2 { x: outward * LED_TAIL_X(), y: LED_EXIT_Y() });
    let q = led_key_pt(dst, Vec2 { x: LED_DIN_ELBOW().x, y: LED_EXIT_Y() });
    out.push(back(v, p, net));
    out.push(back(p, q, net));
    route_din_stub(dst, q, net, out);
}

/// The last LED's dout out to the ribbon, on the back.
///
/// It leaves the key field sideways -- away from the previous column, where
/// there is no next column and nothing to cross -- runs down past the
/// pass-through band, and only then turns in to the connector.
function route_led_tail(
    src: Component,
    contact: Vec2,
    normal: Vec2,
    outward: float,
    bottom_y: float,
    net: string,
    out: Track[],
    vias: Via[],
) -> void {
    let v = along(contact, normal, via_standoff(1));
    let p0 = comp_to_global(src, LED_DOUT_PAD());
    let p1 = led_key_pt(src, Vec2 { x: LED_DOUT_PAD().x, y: LED_EXIT_Y() });
    let p2 = led_key_pt(src, Vec2 { x: outward * LED_TAIL_X(), y: LED_EXIT_Y() });
    // Down the outside of the key field before turning in. The last column is
    // whichever end of the chain is furthest from the connector, so the direct
    // line to it runs the length of that column.
    let p3 = Vec2 { x: p2.x, y: bottom_y + LED_UNDER_Y() };
    for (let e in [[p0, p1], [p1, p2], [p2, p3], [p3, v]]) {
        out.push(back(vec_at(e, 0), vec_at(e, 1), net));
    }
    vias.push(Via { at: v, net: net });
    out.push(seg(v, contact, net));
}

/// How many standoff slots behind the connectors the chain's two link vias
/// claim, before the pass-throughs get any.
///
/// In FRONT of the pass-through band, not behind it. The band runs across the
/// back between the two connectors; a link via behind it has to cross every
/// track in it to reach the key field, and going around means running along
/// the connector row and off the side of the board.
function LED_LINK_SLOTS() -> int {
    2
}

function route_leds(
    b: Board,
    m: Module,
    f: Features,
    bottom_y: float,
    out: Track[],
    vias: Via[],
) -> void {
    if (!f.per_key_leds) {
        return;
    }
    let leds = b.components.filter((c) -> {
        is_led(c)
    });
    let cols = led_chain(m).map((k) -> {
        k.column
    });
    let n = leds.length();
    if (n == 0) {
        return;
    }
    let conns = b.components.filter((c) -> {
        is_connector(c)
    });
    // Sideways out of the key field means away from its middle: the first and
    // last columns of the chain are its outermost, so that side is empty board.
    let mid = leds.reduce(
        (a, c) -> {
            a + c.x
        },
        0.0,
    )
        / (n * 1.0);

    let first = leds.at(0) ?? no_component();
    let head = pad_net(first, "4");

    if let t: Vec2 = find_contact(conns, head) {
        route_led_head(t, contact_normal(conns, head), first, sign_away(first.x, mid), head, out, vias);
    }

    let j = 0;
    while (j < n - 1) {
        let src = leds.at(j) ?? no_component();
        let dst = leds.at(j + 1) ?? no_component();
        let net = pad_net(src, "2");
        if ((cols.at(j) ?? "") == (cols.at(j + 1) ?? "")) {
            route_led_hop(src, dst, net, out, vias);
        } else {
            // Which end of the column the chain reached. The LED before this
            // one is the one it came from, so if that one is lower down the
            // board this column ran upward and the chain is at its top.
            let prev = leds.at(j - 1) ?? src;
            let sign = if (prev.y > src.y) {
                0.0 - 1.0
            } else {
                1.0
            };
            route_led_transition(src, dst, net, sign, out);
        }
        j = j + 1;
    }

    let last = leds.at(n - 1) ?? no_component();
    let tail = pad_net(last, "2");
    if let t: Vec2 = find_contact(conns, tail) {
        route_led_tail(last, t, contact_normal(conns, tail), sign_away(last.x, mid), bottom_y, tail, out, vias);
    }
}

function sign_away(x: float, mid: float) -> float {
    if (x > mid) {
        1.0
    } else {
        0.0 - 1.0
    }
}

/// Drops every supply contact to the plane it feeds.
///
/// The ribbon's LED_VDD conductors land on the connector's front pads, and the
/// supply itself is the back pour, so each one needs a via of its own -- the
/// mirror image of `route_ground_vias`.
function route_supply_vias(b: Board, f: Features, vias: Via[], out: Track[]) -> void {
    if (!f.per_key_leds) {
        return;
    }
    for (let c in b.components) {
        if (is_connector(c)) {
            let ways = c.pads.length() - 1;
            let i = 1;
            for (let p in c.pads) {
                if (p.pad != "MP") {
                    if (p.net == LED_VDD_NET()) {
                        let pad = comp_to_global(c, ffc_pad_local(i, ways));
                        let v = along(pad, conn_normal(c), via_standoff(0));
                        out.push(seg(pad, v, p.net));
                        vias.push(Via { at: v, net: p.net });
                    }
                    i = i + 1;
                }
            }
        }
    }
}

/// Ties every back-side ground pad to the front pour.
///
/// Needed even without LEDs, and that is a consequence of going hotswap: a
/// soldered switch is two plated through-holes, one of them ground, and those
/// alone stitched the two pours together at every key. A hotswap key has no
/// plated hole at all, so without these the front and back ground zones are
/// two separate islands of the same net.
///
/// With LEDs fitted the back is the supply plane instead, and the LED's own
/// ground pad needs the same treatment.
function route_ground_vias(b: Board, f: Features, vias: Via[], out: Track[]) -> void {
    for (let c in b.components) {
        if (is_switch(c)) {
            let v = comp_to_global(c, MX_GND_VIA());
            out.push(back(comp_to_global(c, MX_GND_PAD()), v, "GND"));
            vias.push(Via { at: v, net: "GND" });
        }
        if (is_led(c) && f.per_key_leds) {
            let v = led_key_pt(c, LED_GND_VIA());
            out.push(back(comp_to_global(c, LED_GND_PAD()), v, "GND"));
            vias.push(Via { at: v, net: "GND" });
        }
    }
}

/// BAML has no `contains` on string[]; this is the missing membership test.
function contains_str(xs: string[], s: string) -> bool {
    xs.find((x) -> {
        x == s
    })
        != null
}
