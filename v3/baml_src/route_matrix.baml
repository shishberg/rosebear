// Copper for a diode matrix on a segmented board.
//
// `route.baml` routes the direct-wired boards, where every key has its own net
// with exactly two pads and the whole board is one fan-in. A matrix is a
// different problem: nine nets, each with six to sixteen pads, spread across
// five strips that are joined only by 1.6mm necks. Nothing about the fan-in
// router survives, so this is a second router rather than a rewrite of it --
// the direct-wired boards still ship, and their parity tests still pin it.
//
// The whole topology is forced by two facts about the footprints:
//
//   * A Kailh socket's clearance drills shut out BOTH layers to 5.93mm either
//     side of a key. Past a key, the only lanes are the two bands between that
//     and the strip edge -- and on the BACK even those are blocked, by the
//     socket's own pads. So every run ALONG a column is on the FRONT, and the
//     hinge ligaments sit in those bands because a ligament anywhere else is a
//     ligament no trace can cross.
//
//   * Everything the footprint owns lies NORTH of the key centre (the pads,
//     the socket relief, the stem hole all sit at KiCad y <= 0). South of the
//     bottom key the strip is clear across its full width, on both layers.
//
// So the board is wired as a bus in the tail below the bottom key -- four
// column lines on the front, three row lines on the back -- with every tap
// dropping into it from the north. A tap crosses only its own layer's lanes,
// and each group is ordered so that the lane a tap has to reach is the
// northernmost one present where it drops. That is the whole routing argument:
// no search, no rip-up, and no crossing anywhere.
//
// The bus ends where the shelf begins. The pod link stands halfway up the
// inboard column rather than off the end of the tail, so the last stretch of
// every lane is a climb north out of the bus and across a hinge row -- which
// is a second, smaller planarity problem with its own layer split. See "the
// shelf" below.

// ------------------------------------------------------------------ metrics

/// Via drill and pad. 0.3/0.6 is the smallest ordinary through via.
function FLEX_VIA_DRILL() -> float {
    0.3
}

function FLEX_VIA_PAD() -> float {
    0.6
}

/// Centre-to-centre spacing of two vias side by side.
function flex_via_gap() -> float {
    FLEX_VIA_PAD() + FLEX_TRACE_SPACE() + FLEX_LANE_SLACK()
}

/// Spacing that lets a via sit on one lane while its neighbour runs past.
///
/// Pad radius, the clearance rule, and half a trace. Every lane that carries a
/// via is pitched at this instead of `flex_lane_pitch`.
function flex_via_pitch() -> float {
    FLEX_VIA_PAD() / 2.0 + FLEX_TRACE_SPACE() + FLEX_TRACE_W() / 2.0 + 0.05
}

// ------------------------------------------------------------- the tail bus
//
// All of these are distances SOUTH of the bottom key, in KiCad coordinates.
// The channel runs from the switch's southern extent (the 4mm stem hole, at
// 2.0) to the strip's south edge (`end_margin`, 9.0).

/// The three rows where a row tap turns from the west lane band into the
/// middle of the strip. Northernmost first, which is `ROW_BOTTOM` -- the tap
/// that has the least far to come is the one that turns first, so the two
/// behind it pass south of its corner rather than through it.
function tap_row_y(j: int) -> float {
    2.6 + (j * 1.0) * 0.35
}

/// Where the row taps drop into the bus, measured in from the west edge.
function tap_via_x(j: int) -> float {
    3.0 + (j * 1.0) * flex_via_pitch()
}

/// The west lane band a row tap comes down, measured in from the key centre.
function tap_lane_x(j: int) -> float {
    lane_band_lo() + 0.17 + (j * 1.0) * flex_via_pitch()
}

/// The east lane band a column line comes down.
function col_lane_x() -> float {
    lane_band_lo() + 0.57
}

/// Back-side lane for the switch-to-diode hop, in from the key centre.
///
/// West of the socket's own pad 2 rather than through the middle of it: the
/// row tap's via sits in the west band at the diode's own row, and the hop has
/// to pass it on the same layer.
function swd_lane_x() -> float {
    strip_half_w() - 0.41
}

/// Half a strip, which every x offset above is measured against.
function strip_half_w() -> float {
    strip_width(ROSEBEAR_WELL(), flex_defaults()) / 2.0
}

/// The inboard column's lane, north of everything else in the bus.
///
/// It is the one column line that never crosses a neck: it is already on the
/// strip the connectors stand on, so it joins the bus straight off its own
/// keys. Coming in at the north end is what keeps it out of the way -- south of
/// the row taps' corners, north of every via the rows drop through.
function inner_bus_y() -> float {
    tap_row_y(MATRIX_ROWS().length() - 1) + 0.6
}

/// The row lines' bus lanes, south of the bottom key. `j` counts from
/// `ROW_TOP`, which runs northernmost -- the order the climbs off the bus are
/// ranked by, see `shelf_nets`.
function bus_b_y(j: int) -> float {
    inner_bus_y()
        + FLEX_VIA_PAD() / 2.0
        + FLEX_TRACE_SPACE()
        + FLEX_TRACE_W() / 2.0
        + (j * 1.0) * flex_via_pitch()
}

/// The northernmost column lane: clear of the last via the rows drop through.
function bus_f_y0() -> float {
    bus_b_y(MATRIX_ROWS().length() - 1)
        + FLEX_VIA_PAD() / 2.0
        + FLEX_TRACE_SPACE()
        + FLEX_TRACE_W() / 2.0
}

/// Column lines that get a bus lane: every finger column but the inboard one,
/// whose line goes straight to the connector standing on its own strip.
function bus_cols() -> int {
    COLUMN_ORDER().length() - 1
}

/// The column lines' bus lanes, by rank from the OUTBOARD end.
///
/// The column that joins the bus last runs northernmost, so each tap in turn
/// drops onto the northernmost lane present where it drops and crosses none of
/// the others. That single rule is what makes the bus planar.
function bus_f_y(rank: int) -> float {
    bus_f_y0() + ((bus_cols() - 1 - rank) * 1.0) * flex_lane_pitch()
}

/// How far south of the bottom key a neck attaches: the middle of the column
/// lines' band, so those need no jog at the strip edge and only the three row
/// lines converge into the neck.
function band_offset() -> float {
    bus_f_y0() + ((bus_cols() - 1) * 1.0) * flex_lane_pitch() / 2.0
}

/// Where the row lines leave their bus lanes to converge into a neck.
function bus_jog_u() -> float {
    tap_via_x(MATRIX_ROWS().length() - 1) + FLEX_VIA_PAD() / 2.0 - FLEX_TRACE_W() / 2.0
}

/// A neck lane's offset from the neck centreline, in KiCad y.
function neck_offset_f(rank: int) -> float {
    bus_f_y(rank) - band_offset()
}

/// Pitch of the row lanes where they cross a neck.
///
/// Wider than their pitch on the strip. A neck is sized by the front, which has
/// four column lanes to fit; the back has only three rows to put in the same
/// width, and spreading them costs nothing. It buys the jog its margin: the run
/// from the bus out to the band climbs two millimetres in four, and two lanes
/// on a slope sit closer across than their spacing suggests.
function neck_row_pitch() -> float {
    ((bus_cols() - 1) * 1.0) * flex_lane_pitch() / ((MATRIX_ROWS().length() - 1) * 1.0)
}

function neck_offset_b(j: int) -> float {
    ((j * 1.0) - ((MATRIX_ROWS().length() - 1) * 1.0) / 2.0) * neck_row_pitch()
}

// ----------------------------------------------------------------- the shelf
//
// The pod link stands beside the inboard column's home key, halfway up the
// board, on a shelf of ligament hung off the strip's inboard edge. So every
// conductor it takes has to climb north out of the tail bus, past the bottom
// key and across a hinge row, and the shelf is the only place a trace can do
// that: it is a band of material wide enough for all ten, with a slot either
// side of it so the fold still happens.
//
// A climb crosses every bus lane north of where it starts, on whatever layer
// the bus is running on. So on this one strip the bus is put entirely on the
// FRONT -- the row lines surface for it -- and the climbs go up the BACK.
//
// That leaves one thing to arrange. The via at the foot of a climb has to be
// clear of every bus lane, and the column lanes are pitched too tight to fit
// one between them, so a lane cannot simply turn where it ends. Each runs
// inboard to its own depth on the front, drops south to a via row below the
// whole bus, and only turns north on the far side of it.
//
// The depths are then forced: a lane that turns north at `u` is cut by any bus
// lane south of it that reaches past `u`, so they run in bus order -- the
// southernmost lane shallowest, the northernmost deepest. Ground and the
// cluster's column line touch the bus at neither end (one starts in the tail
// pour, the other at the thumb link), so they take the two depths left over.
//
// Nothing constrains the connector's pinout any more: each lane carries its
// own via and steps in to its contact on the front, and two stubs at different
// contacts are at different heights and cannot meet.

/// The shelf's climb lanes, shallowest first.
function shelf_nets(hand: string) -> string[] {
    let out: string[] = [];
    let r = 0;
    while (r < COLUMN_ORDER().length() - 1) {
        out.push(flex_col_net(hand, COLUMN_ORDER().at(r) ?? ""));
        r = r + 1;
    }
    for (let rn in MATRIX_ROWS()) {
        out.push(flex_row_net(hand, rn));
    }
    out.push(flex_col_net(hand, inner_column()));
    out.push("GND");
    out.push(flex_col_net(hand, "thumb"));
    out
}

/// A net's climb lane, or -1 if it has none.
function shelf_rank(hand: string, net: string) -> int {
    let ns = shelf_nets(hand);
    let r = index_of_str(ns, net);
    if ((ns.at(r) ?? "") != net) {
        0 - 1
    } else {
        r
    }
}

/// How deep a climb runs, as an inboard offset from the strip centre.
///
/// The band `shelf_band_w` sizes, laid out from its outboard edge. Rank -1 --
/// a net with no climb -- stops at the strip edge, which is what a bus lane on
/// every other strip does anyway.
function shelf_lane_u(rank: int) -> float {
    if (rank < 0) {
        return strip_half_w();
    }
    strip_half_w()
        + flex_defaults().slot_w
        + flex_lane_clear()
        + FLEX_TRACE_W() / 2.0
        + (rank * 1.0) * flex_via_pitch()
}

function shelf_u(hand: string, net: string) -> float {
    shelf_lane_u(shelf_rank(hand, net))
}

/// Where a climb turns north: south of every bus lane, so the via at the foot
/// of one is clear of all of them.
///
/// Every other lane a via further south again. `flex_via_pitch` buys a via
/// room beside a TRACE, which is a smaller thing than room beside another via,
/// so a straight row of ten would short end to end.
function shelf_via_y(s: Strip, rank: int) -> float {
    let step = if (rank - (rank / 2) * 2 == 0) {
        0.0
    } else {
        flex_via_gap()
    };
    strip_key_y(s, 0) + bus_f_y(0) + flex_via_pitch() + step
}

/// A line's rank among those that surface on the inboard strip, from the
/// south: the three rows, then the inboard column, whose lane is north of all
/// of them.
function bus_surface_rank(hand: string, net: string) -> int {
    for (let rn in MATRIX_ROWS()) {
        if (flex_row_net(hand, rn) == net) {
            return index_of_str(MATRIX_ROWS(), rn);
        }
    }
    MATRIX_ROWS().length()
}

/// Where a line surfaces on the inboard strip.
///
/// Inboard of every row tap's drop -- on the right hand those land INSIDE the
/// strip, because the socket does not mirror -- and outboard of the shelf, so
/// the front run that carries it the rest of the way crosses nothing. The
/// ranks step deeper going north, far enough apart for a row of vias, and that
/// way round so that a line surfacing north of another never runs out over its
/// via.
function bus_surface_u(rank: int) -> float {
    tap_via_x(MATRIX_ROWS().length() - 1) + 1.0 + (rank * 1.0) * flex_via_gap()
}

/// KiCad y of a net's bus lane on this strip, or -- for the two nets that
/// never reach the bus at all -- the foot of its own climb, so that the run
/// down to it comes out empty.
function bus_lane_y(s: Strip, hand: string, net: string) -> float {
    let kb = strip_key_y(s, 0);
    for (let cname in COLUMN_ORDER()) {
        if (flex_col_net(hand, cname) == net) {
            return kb + col_lane_y(cname);
        }
    }
    for (let rn in MATRIX_ROWS()) {
        if (flex_row_net(hand, rn) == net) {
            return kb + bus_b_y(row_rank(rn));
        }
    }
    shelf_via_y(s, shelf_rank(hand, net))
}

// ------------------------------------------------------------------ indices

/// A column's rank in the bus, counting from the outboard end.
function col_rank(name: string) -> int {
    index_of_str(COLUMN_ORDER(), name)
}

/// A row's rank, counting from `ROW_TOP` -- the reverse of `MATRIX_ROWS`.
function row_rank(name: string) -> int {
    MATRIX_ROWS().length() - 1 - index_of_str(MATRIX_ROWS(), name)
}

// ------------------------------------------------------------------ tracks

function flex_seg(a: Vec2, b: Vec2, layer: string, net: string) -> Track {
    Track { start: a, end: b, width: FLEX_TRACE_W(), layer: layer, net: net }
}

/// A polyline as a run of segments, dropping any zero-length step.
function flex_run(pts: Vec2[], layer: string, net: string) -> Track[] {
    let out: Track[] = [];
    let i = 0;
    while (i + 1 < pts.length()) {
        let a = vec_at(pts, i);
        let b = vec_at(pts, i + 1);
        if ((b.x - a.x).abs() > 0.000001 || (b.y - a.y).abs() > 0.000001) {
            out.push(flex_seg(a, b, layer, net));
        }
        i = i + 1;
    }
    out
}

function flex_via(at: Vec2, net: string) -> Via {
    Via { at: at, net: net }
}

// ------------------------------------------------------------------- frames
//
// The two halves are mirror images, but the Kailh footprint is not: both hands
// use the same part, so pad 1 is east of every key and pad 2 west of it on
// both boards. What DOES mirror is which end of the row of strips the
// connectors stand on. So x offsets taken from a key are absolute, and x
// offsets taken from the connector are measured in this frame: `u` is the
// distance INBOARD of a strip's centre line, positive toward the pod.

/// +1 if the inboard column lies east, -1 if west.
function hand_dir(ss: Strip[]) -> float {
    let inner = ss.find((s) -> {
        s.column == link_column(true)
    });
    let outer = ss.find((s) -> {
        s.column == (COLUMN_ORDER().at(0) ?? "pinky")
    });
    if let a: Strip = inner {
        if let b: Strip = outer {
            return if (a.cx > b.cx) {
                1.0
            } else {
                0.0 - 1.0
            };
        }
    }
    1.0
}

/// A point `u` inboard of strip `s`, at KiCad height `y`.
function at_u(s: Strip, dir: float, u: float, y: float) -> Vec2 {
    Vec2 { x: s.cx + dir * u, y: y }
}

/// KiCad y of a strip's southernmost key -- the bottom row, whichever hand.
function strip_key_y(s: Strip, i: int) -> float {
    0.0 - (s.key_ys.at(i) ?? 0.0)
}

/// KiCad y of the neck's centreline where it meets this strip.
function strip_band_y(s: Strip) -> float {
    strip_key_y(s, 0) + band_offset()
}

/// Which contact of `c` carries `net`, 1-based, or 0 if none does.
/// Which contact on a connector carries `net`, or 0.
///
/// Contacts only: the last pad on an FFC part is the mounting peg, which is
/// tied to ground and would otherwise answer for the ground CONDUCTOR and send
/// whatever was looking for it one position too far along the row.
function contact_of(c: Component, net: string) -> int {
    let out = 0;
    let i = 1;
    for (let q in c.pads) {
        if (q.net == net && i <= link_ways(c)) {
            out = i;
        }
        i = i + 1;
    }
    out
}

function contact_at(c: Component, i: int) -> Vec2 {
    comp_to_global(c, ffc_pad_local(i, link_ways(c)))
}

/// The connectors on a board, pod link first.
function flex_links(b: Board) -> Component[] {
    b.components.filter((c) -> {
        is_connector(c)
    })
}

/// The pod link. It is the only one carrying the inboard column's line.
function pod_link(b: Board) -> Component? {
    flex_links(b).find((c) -> {
        contact_of(
            c,
            `COL_${board_hand(b).to_upper_case()}_${(COLUMN_ORDER().at(COLUMN_ORDER().length() - 1) ?? "inner").to_upper_case()}`,
        )
            > 0
    })
}

/// The thumb link: the other one.
function thumb_link(b: Board) -> Component? {
    flex_links(b).find((c) -> {
        contact_of(c, `COL_${board_hand(b).to_upper_case()}_THUMB`) > 0
            && contact_of(
                c,
                `COL_${board_hand(b).to_upper_case()}_${(COLUMN_ORDER().at(COLUMN_ORDER().length() - 1) ?? "inner").to_upper_case()}`,
            )
                == 0
    })
}

function board_hand(b: Board) -> string {
    if (b.id.ends_with("_r")) {
        "r"
    } else {
        "l"
    }
}

function link_ways(c: Component) -> int {
    c.pads.length() - 1
}

// ------------------------------------------------------------------- copper

class Copper {
    tracks: Track[],
    vias: Via[],
}

function no_copper() -> Copper {
    Copper { tracks: [], vias: [] }
}

function add_copper(a: Copper, b: Copper) -> Copper {
    Copper { tracks: a.tracks.concat(b.tracks), vias: a.vias.concat(b.vias) }
}

function run_copper(pts: Vec2[], layer: string, net: string) -> Copper {
    Copper { tracks: flex_run(pts, layer, net), vias: [] }
}

function via_copper(at: Vec2, net: string) -> Copper {
    Copper { tracks: [], vias: [flex_via(at, net)] }
}

// ----------------------------------------------------------- per-key copper

/// Half the height of a diode's own pads, across the part.
function DIODE_PAD_HALF() -> float {
    0.6
}

/// How far past a diode the switch-to-diode hop turns.
///
/// The hop cannot share the diode's row -- the row tap runs west out of the
/// cathode along it -- so it goes round, through the band between the diode's
/// pads and the hinge cut beyond them. That band is two thirds of a millimetre
/// and a trace with clearance either side needs nearly all of it, so the hop
/// takes the exact middle rather than a round number.
function swd_turn(s: Strip, k: PlacedKey, w: Well, p: FlexParams) -> float {
    let near = DIODE_REACH() + DIODE_PAD_HALF() + FLEX_TRACE_SPACE() + FLEX_TRACE_W() / 2.0;
    let far = key_cut_reach(s, k.y, w, p) - FLEX_EDGE_CLEAR() - FLEX_TRACE_W() / 2.0;
    (near + far) / 2.0 - DIODE_REACH()
}

function find_by_net(comps: Component[], prefix: string, net: string) -> Component? {
    comps.find((c) -> {
        c.ref.starts_with(prefix)
            && c.pads.find((q) -> {
                q.net == net
            })
                != null
    })
}

/// One key's local copper: the stub onto its column line, the hop from its
/// switch to its diode, and the tap that carries its row line to the west
/// lane band and down the strip.
function route_flex_key(b: Board, s: Strip, k: PlacedKey, w: Well, p: FlexParams) -> Copper {
    let swd = switch_diode_net(k);
    let sw = find_by_net(b.components, "SW", swd);
    let d = find_by_net(b.components, "D", swd);
    let out = no_copper();
    if let sc: Component = sw {
        if let dc: Component = d {
            let p1 = comp_to_global(sc, MX_SIGNAL_PAD());
            let p2 = comp_to_global(sc, MX_GND_PAD());
            let drow = comp_to_global(dc, Vec2 { x: 0.0 - 1.65, y: 0.0 });
            let dswd = comp_to_global(dc, Vec2 { x: 1.65, y: 0.0 });
            let kb = strip_key_y(s, 0);

            // The column line comes down the east lane band on the front and
            // drops onto pad 1, which is on the back like every socket pad.
            let cv = Vec2 { x: sc.x + col_lane_x(), y: p1.y };
            out = add_copper(out, via_copper(cv, col_net(k)));
            out = add_copper(out, run_copper([cv, p1], "B.Cu", col_net(k)));

            // Switch to diode, on the back, round the far side of the diode:
            // its own row is taken by the row tap running west out of it.
            let reach = swd_turn(s, k, w, p);
            let turn = if (dc.y < sc.y) {
                dc.y - reach
            } else {
                dc.y + reach
            };
            let lane = sc.x - swd_lane_x();
            out
                = add_copper(
                    out,
                    run_copper(
                        [
                            p2,
                            Vec2 { x: lane, y: p2.y },
                            Vec2 { x: lane, y: turn },
                            Vec2 { x: dswd.x, y: turn },
                            dswd,
                        ],
                        "B.Cu",
                        swd,
                    ),
                );

            // The row tap: west out of the diode's cathode, up to the front,
            // down the west lane band, then in to the bus.
            let ri = index_of_str(MATRIX_ROWS(), matrix_row(k));
            let rj = row_rank(matrix_row(k));
            let tv = Vec2 { x: sc.x - tap_lane_x(ri), y: drow.y };
            let bv = Vec2 { x: s.cx - tap_via_x(ri), y: kb + bus_b_y(rj) };
            out = add_copper(out, run_copper([drow, tv], "B.Cu", row_net(k)));
            out = add_copper(out, via_copper(tv, row_net(k)));
            out
                = add_copper(
                    out,
                    run_copper(
                        [
                            tv,
                            Vec2 { x: tv.x, y: kb + tap_row_y(ri) },
                            Vec2 { x: bv.x, y: kb + tap_row_y(ri) },
                            bv,
                        ],
                        "F.Cu",
                        row_net(k),
                    ),
                );
            out = add_copper(out, via_copper(bv, row_net(k)));
        }
    }
    out
}

// ------------------------------------------------------------------ the bus
//
// Everything a column gathers ends up in the tail, in two stacks of lanes: the
// row lines on the back, the column lines on the front. The order of the stack
// is not free. A column's line arrives from the north down its own strip, so it
// has to land on the NORTHERNMOST lane present or cross the ones already
// there -- which puts the outboard columns south and the inboard ones north.
// Everything else follows from that, including the order of the climbs onto
// the shelf; see `shelf_nets`.

function inner_column() -> string {
    COLUMN_ORDER().at(COLUMN_ORDER().length() - 1) ?? "inner"
}

function flex_col_net(hand: string, col: string) -> string {
    `COL_${hand.to_upper_case()}_${col.to_upper_case()}`
}

function flex_row_net(hand: string, row: string) -> string {
    `ROW_${hand.to_upper_case()}_${row.to_upper_case()}`
}

/// A straight run along a strip, given inboard offsets rather than absolute x.
function lane_run(
    s: Strip,
    dir: float,
    u0: float,
    u1: float,
    y: float,
    layer: string,
    net: string,
) -> Copper {
    run_copper([at_u(s, dir, u0, y), at_u(s, dir, u1, y)], layer, net)
}

/// A column line's lane in the bus, as an offset south of the bottom key.
function col_lane_y(cname: string) -> float {
    if (cname == inner_column()) {
        inner_bus_y()
    } else {
        bus_f_y(col_rank(cname))
    }
}

/// KiCad y at which a column's line stops descending and turns inboard.
function col_drop_y(s: Strip) -> float {
    strip_key_y(s, 0) + col_lane_y(s.column)
}

/// How much of a row line's jog into the neck runs flat.
///
/// The diagonal would otherwise finish on the corner where the strip edge turns
/// into the neck, and a diagonal cuts that corner: it comes closer to it than
/// its own endpoint does. Levelling off first means the last thing the corner
/// sees is a horizontal at the neck's own lane height.
function bus_flat_u() -> float {
    0.5
}

/// The vertical that gathers a column's keys and drops onto the bus.
function route_col_drop(b: Board, s: Strip) -> Copper {
    let x = s.cx + col_lane_x();
    let ktop = strip_key_y(s, s.key_ys.length() - 1);
    run_copper(
        [Vec2 { x: x, y: ktop + MX_SIGNAL_PAD().y }, Vec2 { x: x, y: col_drop_y(s) }],
        "F.Cu",
        flex_col_net(board_hand(b), s.column),
    )
}

/// Where a bus lane leaves a strip: the inboard edge, or -- on the strip the
/// pod link stands on -- the depth on the shelf at which its climb turns north.
function lane_exit_u(s: Strip, hand: string, net: string) -> float {
    if (s.column == inner_column()) {
        return shelf_u(hand, net);
    }
    s.half_w
}

/// One strip's share of the bus: every lane that passes through or starts here.
function route_flex_bus(b: Board, s: Strip, dir: float) -> Copper {
    let hand = board_hand(b);
    let kb = strip_key_y(s, 0);
    let rank = col_rank(s.column);
    let inner = s.column == inner_column();
    let out = no_copper();

    // Column lines, on the front. One lane per column at or outboard of here;
    // this strip's own starts where its drop lands, the rest cross the strip.
    let r = 0;
    while (r <= rank) {
        let cname = COLUMN_ORDER().at(r) ?? "";
        let net = flex_col_net(hand, cname);
        let u0 = if (r == rank) {
            dir * col_lane_x()
        } else {
            0.0 - s.half_w
        };
        let u1 = lane_exit_u(s, hand, net);
        let y = kb + col_lane_y(cname);
        if (cname == inner_column() && u0 < 0.0) {
            // The inboard column's drop lands on the OUTBOARD side of this
            // hand's strip -- the socket does not mirror, so its pad 1 is east
            // on both boards while the connectors are east on one and west on
            // the other. From there the line has to cross the row taps on their
            // way down to the bus, so it goes under them on the back -- and
            // comes up again before the shelf, whose climbs are on the back
            // too.
            let us = bus_surface_u(bus_surface_rank(hand, net));
            out = add_copper(out, via_copper(at_u(s, dir, u0, y), net));
            out = add_copper(out, lane_run(s, dir, u0, us, y, "B.Cu", net));
            out = add_copper(out, via_copper(at_u(s, dir, us, y), net));
            out = add_copper(out, lane_run(s, dir, us, u1, y, "F.Cu", net));
        } else {
            out = add_copper(out, lane_run(s, dir, u0, u1, y, "F.Cu", net));
        }
        r = r + 1;
    }

    // Row lines, on the back. Every strip carries all three, and each jogs from
    // its lane out to the neck band at the strip edge -- the band is where the
    // necks are, and it is one band for the rows and the columns both.
    //
    // On the inboard strip the line surfaces instead of jogging: what it has to
    // reach from here is a climb up the shelf, and those are on the back.
    for (let rn in MATRIX_ROWS()) {
        let ri = index_of_str(MATRIX_ROWS(), rn);
        let rj = row_rank(rn);
        let net = flex_row_net(hand, rn);
        let y = kb + bus_b_y(rj);
        let by = kb + band_offset() + neck_offset_b(rj);
        let pts: Vec2[] = [];
        if (rank == 0) {
            // Outboard-most strip: the line starts at its own tap.
            pts.push(at_u(s, dir, 0.0 - dir * tap_via_x(ri), y));
        } else {
            pts.push(at_u(s, dir, 0.0 - s.half_w, by));
            pts.push(at_u(s, dir, 0.0 - s.half_w + bus_flat_u(), by));
            pts.push(at_u(s, dir, 0.0 - bus_jog_u(), y));
        }
        if (inner) {
            let us = bus_surface_u(bus_surface_rank(hand, net));
            pts.push(at_u(s, dir, us, y));
            out = add_copper(out, run_copper(pts, "B.Cu", net));
            out = add_copper(out, via_copper(at_u(s, dir, us, y), net));
            out = add_copper(out, lane_run(s, dir, us, lane_exit_u(s, hand, net), y, "F.Cu", net));
        } else {
            pts.push(at_u(s, dir, bus_jog_u(), y));
            pts.push(at_u(s, dir, s.half_w - bus_flat_u(), by));
            pts.push(at_u(s, dir, s.half_w, by));
            out = add_copper(out, run_copper(pts, "B.Cu", net));
        }
    }
    out
}

// ------------------------------------------------------------------- necks

/// A conductor's path across a neck, at a signed KiCad offset from the band.
///
/// Offset from the centreline the same way the outline's own edges are: as a
/// true parallel curve, arc by arc. A finite-difference normal off the sampled
/// centreline is good to a few microns in the straights and wrong by more than
/// a trace width in the turns.
function neck_trace(w: Well, a: Strip, c: Strip, off: float, segs: int) -> Vec2[] {
    let y0 = strip_neck_y(a);
    let y1 = strip_neck_y(c);
    // Ergogen y is up; KiCad y is down.
    let e = 0.0 - off;
    let side = if (e < 0.0) {
        0.0 - 1.0
    } else {
        1.0
    };
    to_kicad_poly(
        neck_side(
            a.cx + a.half_w,
            c.cx - c.half_w,
            y0,
            neck_leg_pair(neck_span(a, c), a.neck_len, y0, y1),
            2.0 * e.abs(),
            side,
            segs,
        ),
    )
}

/// Every conductor crossing every neck.
///
/// All three rows cross all of them; a column line crosses only the necks
/// inboard of its own strip, which is what makes the front stack grow by one
/// lane per column as it goes.
function route_flex_necks(b: Board, ss: Strip[], w: Well) -> Copper {
    let hand = board_hand(b);
    let out = no_copper();
    let i = 0;
    while (i + 1 < ss.length()) {
        let a = strip_at(ss, i);
        let c = strip_at(ss, i + 1);
        let ra = col_rank(a.column);
        let rc = col_rank(c.column);
        let hi = if (ra > rc) {
            ra
        } else {
            rc
        };
        for (let rn in MATRIX_ROWS()) {
            out
                = add_copper(
                    out,
                    run_copper(
                        neck_trace(w, a, c, neck_offset_b(row_rank(rn)), NECK_SAMPLES()),
                        "B.Cu",
                        flex_row_net(hand, rn),
                    ),
                );
        }
        let r = 0;
        while (r < hi) {
            out
                = add_copper(
                    out,
                    run_copper(
                        neck_trace(w, a, c, neck_offset_f(r), NECK_SAMPLES()),
                        "F.Cu",
                        flex_col_net(hand, COLUMN_ORDER().at(r) ?? ""),
                    ),
                );
            r = r + 1;
        }
        i = i + 1;
    }
    out
}

// -------------------------------------------------------------- the fan-in

/// How far a horizontal FFC connector's courtyard reaches behind its origin,
/// away from the contacts, and in front of it past them.
function FFC_BODY_BACK() -> float {
    4.69
}

function FFC_BODY_FRONT() -> float {
    1.91
}

/// Half the body length of a `ways`-way horizontal FFC connector.
function ffc_body_half(ways: int) -> float {
    (ways * 1.0) / 2.0 + 3.8
}

/// The climb up the shelf into the pod link.
///
/// Each lane leaves its bus lane on the front, runs inboard to its own depth,
/// drops to the via row below the bus and turns north on the back. It crosses
/// the hinge row between the bottom key and the home key inside the shelf's
/// ligament, comes up level with the contact that takes it, and steps in.
///
/// Ground and the cluster's column line have no bus lane to leave: they start
/// at the via row itself, where the tail pour and `route_thumb_fan` meet them.
function route_pod_fan(b: Board, s: Strip, dir: float) -> Copper {
    let out = no_copper();
    let pc = pod_link(b);
    if let c: Component = pc {
        let hand = board_hand(b);
        let rank = 0;
        for (let net in shelf_nets(hand)) {
            let i = contact_of(c, net);
            if (i > 0) {
                let u = shelf_lane_u(rank);
                let q = contact_at(c, i);
                let by = bus_lane_y(s, hand, net);
                let foot = at_u(s, dir, u, shelf_via_y(s, rank));
                let head = at_u(s, dir, u, q.y);
                // Ground and the cluster's column line reach the foot of their
                // climb along the back, from the thumb link; there is nothing
                // on the front to turn over, and a via there would be dangling.
                if ((by - foot.y).abs() > 0.000001) {
                    out = add_copper(out, run_copper([at_u(s, dir, u, by), foot], "F.Cu", net));
                    out = add_copper(out, via_copper(foot, net));
                }
                out
                    = add_copper(out, run_copper([foot, at_u(s, dir, u, climb_top(c, net, q))], "B.Cu", net));
                out = add_copper(out, via_copper(head, net));
                out = add_copper(out, run_copper([head, q], "F.Cu", net));
            }
            rank = rank + 1;
        }
        out = add_copper(out, route_link_pegs(c, s, dir, shelf_u(hand, "GND")));
    }
    out
}

/// How far north a climb runs: to the contact that takes it, or -- for ground
/// -- past that to the mounting peg beyond, which the same lane has to reach.
function climb_top(c: Component, net: string, q: Vec2) -> float {
    if (net != "GND") {
        return q.y;
    }
    let ways = link_ways(c);
    let a = comp_to_global(c, ffc_mp_local(1.0, ways)).y;
    let z = comp_to_global(c, ffc_mp_local(0.0 - 1.0, ways)).y;
    let n = if (a < z) {
        a
    } else {
        z
    };
    if (n < q.y) {
        n
    } else {
        q.y
    }
}

/// A horizontal FFC's mounting peg, in footprint coordinates.
///
/// Both Molex 200528 parts put it 2.3mm out past the end contact and 1.79
/// behind the row -- an SMD pad on the front, tied to ground.
function ffc_mp_local(sign: float, ways: int) -> Vec2 {
    Vec2 { x: sign * ((ways * 1.0) / 2.0 + 2.3), y: 1.79 }
}

/// Ground onto a connector's two mounting pegs.
///
/// The pegs sit wide of the contacts, past either end of the fan, so nothing
/// the fan does reaches them. On the tail the pour picks them up; on the shelf
/// there is no pour, and the only ground within reach is the climb running up
/// the back a fraction of a millimetre away. So: a via under each peg and a
/// stub across to the lane. That the lane is the deepest but one is what keeps
/// the stub clear of everything else -- only the cluster's column line runs
/// inboard of it, and the pegs fall short of that.
function route_link_pegs(c: Component, s: Strip, dir: float, u: float) -> Copper {
    let out = no_copper();
    let ways = link_ways(c);
    for (let sign in [0.0 - 1.0, 1.0]) {
        let mp = comp_to_global(c, ffc_mp_local(sign, ways));
        out = add_copper(out, via_copper(mp, "GND"));
        out = add_copper(out, run_copper([mp, at_u(s, dir, u, mp.y)], "B.Cu", "GND"));
    }
    out
}

/// The thumb link's five nets, off the foot of the shelf.
///
/// The link sits at the end of the tail, south of everything; its nets are
/// already on the shelf, or on their way onto it. Each runs north off its
/// contact on the front, past the body, and turns onto the back to reach its
/// climb -- so the deepest lane peels first and the runs behind it stop short.
/// That is the same rule as the shelf itself, read from the other end.
function route_thumb_fan(b: Board, s: Strip, dir: float) -> Copper {
    let out = no_copper();
    let tc = thumb_link(b);
    if let t: Component = tc {
        let hand = board_hand(b);
        let ns = shelf_nets(hand);
        // The peels stack SOUTH of the shelf's via rows, not north of the
        // connector body. North of the via rows every lane is already climbing,
        // and a run out to a deep one would cut every climb shallower than it.
        // South there is nothing but the connector, whose own copper is all on
        // the front -- so the peels lie under it, and only the verticals off
        // its contacts have anything to dodge.
        let taken = 0;
        for (let net in ns) {
            if (contact_of(t, net) > 0) {
                taken = taken + 1;
            }
        }
        let y0 = shelf_via_y(s, 1) + flex_via_gap() + ((taken - 1) * 1.0) * flex_via_pitch();
        let idx = 0;
        let k = ns.length() - 1;
        while (k >= 0) {
            let net = ns.at(k) ?? "";
            let i = contact_of(t, net);
            if (i > 0) {
                let u = shelf_lane_u(k);
                let q = contact_at(t, i);
                // One via per peel, stepped north as the lanes get shallower:
                // a row of them at one height would have their pads touching.
                let pv = Vec2 { x: q.x, y: y0 - (idx * 1.0) * flex_via_pitch() };
                out = add_copper(out, run_copper([q, pv], "F.Cu", net));
                out = add_copper(out, via_copper(pv, net));
                out
                    = add_copper(
                        out,
                        run_copper(
                            [pv, at_u(s, dir, u, pv.y), at_u(s, dir, u, shelf_via_y(s, k))],
                            "B.Cu",
                            net,
                        ),
                    );
                idx = idx + 1;
            }
            k = k - 1;
        }
    }
    out
}

// -------------------------------------------------------------------- board

/// Every conductor on a segmented finger board.
function route_flex(b: Board, m: Module, ss: Strip[], w: Well) -> Copper {
    let dir = hand_dir(ss);
    let out = no_copper();
    for (let s in ss) {
        for (
            let k in m.keys.filter((k) -> {
                k.column == s.column
            })
        ) {
            out = add_copper(out, route_flex_key(b, s, k, w, flex_defaults()));
        }
        out = add_copper(out, route_col_drop(b, s));
        out = add_copper(out, route_flex_bus(b, s, dir));
    }
    out = add_copper(out, route_flex_necks(b, ss, w));
    let inner = ss.find((s) -> {
        s.column == inner_column()
    });
    if let s: Strip = inner {
        out = add_copper(out, route_pod_fan(b, s, dir));
        out = add_copper(out, route_thumb_fan(b, s, dir));
    }
    out
}
