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
/// `ROW_TOP`, which runs northernmost so that the pod's contact order and the
/// bus order come out consistent -- see `conn_lane_u`.
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

/// Lane depth for contact `i` of a connector, as an inboard offset.
///
/// The contacts sit at 0.91; the lanes stack behind them, pitched so a via can
/// sit on one while its neighbours run past. Depth goes by the contact's
/// POSITION, not its number: a lane running to a southern contact has to sit
/// inboard of every lane above it, or it cuts through their stubs on the way
/// in. The two hands turn the connector round, so contact 1 is the north end on
/// one board and the south end on the other.
function conn_lane_u(c: Component, i: int) -> float {
    let ways = link_ways(c);
    let rank = if (contact_at(c, 1).y > contact_at(c, ways).y) {
        ways - i
    } else {
        i - 1
    };
    2.0 + (rank * 1.0) * flex_via_pitch()
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
// Everything else follows from that, including which way round the connector's
// contacts have to run; see `band_pinout`.

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
/// connectors stand on -- the lane behind the contact that takes it.
function lane_exit_u(s: Strip, pc: Component?, net: string) -> float {
    if (s.column == inner_column()) {
        if let c: Component = pc {
            let i = contact_of(c, net);
            if (i > 0) {
                return conn_lane_u(c, i);
            }
        }
    }
    s.half_w
}

/// One strip's share of the bus: every lane that passes through or starts here.
function route_flex_bus(b: Board, s: Strip, dir: float) -> Copper {
    let hand = board_hand(b);
    let pc = pod_link(b);
    let kb = strip_key_y(s, 0);
    let rank = col_rank(s.column);
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
        let u1 = lane_exit_u(s, pc, net);
        let y = kb + col_lane_y(cname);
        if (cname == inner_column() && u0 < 0.0) {
            // The inboard column's drop lands on the OUTBOARD side of this
            // hand's strip -- the socket does not mirror, so its pad 1 is east
            // on both boards while the connectors are east on one and west on
            // the other. From there the line has to cross the row taps on their
            // way down to the bus, so it goes under them on the back.
            out = add_copper(out, via_copper(at_u(s, dir, u0, y), net));
            out = add_copper(out, lane_run(s, dir, u0, u1, y, "B.Cu", net));
            out = add_copper(out, via_copper(at_u(s, dir, u1, y), net));
        } else {
            out = add_copper(out, lane_run(s, dir, u0, u1, y, "F.Cu", net));
        }
        r = r + 1;
    }

    // Row lines, on the back. Every strip carries all three, and each jogs from
    // its lane out to the neck band at the strip edge -- the band is where the
    // necks are, and it is one band for the rows and the columns both.
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
        if (s.column == inner_column()) {
            pts.push(at_u(s, dir, lane_exit_u(s, pc, net), y));
        } else {
            pts.push(at_u(s, dir, bus_jog_u(), y));
            pts.push(at_u(s, dir, s.half_w - bus_flat_u(), by));
            pts.push(at_u(s, dir, s.half_w, by));
        }
        out = add_copper(out, run_copper(pts, "B.Cu", net));
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

/// KiCad y of the clear line just north of a connector's body.
function link_north_y(c: Component) -> float {
    c.y - ffc_body_half(link_ways(c)) - 1.0
}

function pad_net_at(c: Component, i: int) -> string {
    (c.pads.at(i - 1) ?? Pad { pad: "", net: "" }).net
}

/// The bus into the pod link's contacts.
///
/// Each lane runs inboard to the depth of the contact that takes it, then
/// straight south and in. The depths are ordered so that a lane which has to
/// reach a southern contact sits inboard of every lane above it -- see
/// `conn_lane_u`.
function route_pod_fan(b: Board, s: Strip, dir: float) -> Copper {
    let out = no_copper();
    let pc = pod_link(b);
    if let c: Component = pc {
        let hand = board_hand(b);
        let kb = strip_key_y(s, 0);

        // Every column arrives on a front lane: straight down and in.
        let r = 0;
        while (r < COLUMN_ORDER().length()) {
            let net = flex_col_net(hand, COLUMN_ORDER().at(r) ?? "");
            let i = contact_of(c, net);
            if (i > 0) {
                let u = conn_lane_u(c, i);
                let q = contact_at(c, i);
                out
                    = add_copper(
                        out,
                        run_copper(
                            [
                                at_u(s, dir, u, kb + col_lane_y(COLUMN_ORDER().at(r) ?? "")),
                                at_u(s, dir, u, q.y),
                                q,
                            ],
                            "F.Cu",
                            net,
                        ),
                    );
            }
            r = r + 1;
        }

        // Rows surface where their back lane ends and run down the front. The
        // run carries on past the contact to the via that feeds the thumb link.
        for (let rn in MATRIX_ROWS()) {
            let net = flex_row_net(hand, rn);
            let i = contact_of(c, net);
            if (i > 0) {
                let u = conn_lane_u(c, i);
                let y = kb + bus_b_y(row_rank(rn));
                let q = contact_at(c, i);
                out = add_copper(out, via_copper(at_u(s, dir, u, y), net));
                out
                    = add_copper(
                        out,
                        run_copper(
                            [
                                at_u(s, dir, u, y),
                                at_u(s, dir, u, link_north_y(c)),
                                at_u(s, dir, u, q.y),
                                q,
                            ],
                            "F.Cu",
                            net,
                        ),
                    );
            }
        }

        // Ground: the contact row is solid, so the pour cannot reach in from
        // the side. It gets a lane of its own back up into the tail.
        let gi = contact_of(c, "GND");
        if (gi > 0) {
            let u = conn_lane_u(c, gi);
            let q = contact_at(c, gi);
            out
                = add_copper(
                    out,
                    run_copper([q, at_u(s, dir, u, q.y), at_u(s, dir, u, link_north_y(c))], "F.Cu", "GND"),
                );
            out = add_copper(out, via_copper(at_u(s, dir, u, link_north_y(c)), "GND"));
        }
    }
    out
}

/// The nets the thumb link takes off the pod link, north contact first.
///
/// North first is shallowest lane first, and the fan peels off in that order.
/// Contact NUMBER would do on one hand and be backwards on the other.
function thumb_fan_nets(p: Component, t: Component) -> string[] {
    let ways = link_ways(p);
    let north_first = contact_at(p, 1).y < contact_at(p, ways).y;
    let out: string[] = [];
    let k = 0;
    while (k < ways) {
        let i = if (north_first) {
            k + 1
        } else {
            ways - k
        };
        let n = pad_net_at(p, i);
        if (n != "GND" && contact_of(t, n) > 0) {
            out.push(n);
        }
        k = k + 1;
    }
    out
}

/// The run on from the pod link down to the thumb link.
///
/// On the back, because the front south of the pod link is full of that
/// connector's own contact stubs. The lanes come down in pod-contact order and
/// peel off one at a time -- the shallowest lane first, to the furthest
/// contact -- so no run ever has to cross one that has already turned.
function route_thumb_fan(b: Board, s: Strip, dir: float) -> Copper {
    let out = no_copper();
    let pc = pod_link(b);
    let tc = thumb_link(b);
    if let p: Component = pc {
        if let t: Component = tc {
            let nets = thumb_fan_nets(p, t);
            let vy = t.y - FFC_BODY_BACK() - 1.0;
            let y0 = vy - 1.0 - ((nets.length() - 1) * 1.0) * flex_lane_pitch();
            let idx = 0;
            for (let net in nets) {
                let pi = contact_of(p, net);
                let ti = contact_of(t, net);
                let u = conn_lane_u(p, pi);
                let q = contact_at(t, ti);
                let cu = dir * (q.x - s.cx);
                let ty = y0 + (idx * 1.0) * flex_lane_pitch();
                // One via per lane, stepped north as the lanes get deeper: a
                // row of them across the lane pitch would have their pads
                // touching.
                let top = at_u(s, dir, u, link_north_y(p) - (idx * 1.0) * flex_via_gap());
                if (!net.starts_with("ROW_")) {
                    // A column line for the cluster: nothing brought it here
                    // but the pod link itself, so it starts at that contact. A
                    // row line is already on this lane, on its way south to its
                    // own contact.
                    let pq = contact_at(p, pi);
                    out = add_copper(out, run_copper([pq, at_u(s, dir, u, pq.y), top], "F.Cu", net));
                }
                out = add_copper(out, via_copper(top, net));
                out
                    = add_copper(
                        out,
                        run_copper(
                            [top, at_u(s, dir, u, ty), at_u(s, dir, cu, ty), at_u(s, dir, cu, vy)],
                            "B.Cu",
                            net,
                        ),
                    );
                out = add_copper(out, via_copper(at_u(s, dir, cu, vy), net));
                out = add_copper(out, run_copper([at_u(s, dir, cu, vy), q], "F.Cu", net));
                idx = idx + 1;
            }
            // Ground, as at the pod link: in from its contact and back north.
            let gi = contact_of(t, "GND");
            if (gi > 0) {
                let q = contact_at(t, gi);
                let cu = dir * (q.x - s.cx);
                out = add_copper(out, run_copper([q, at_u(s, dir, cu, vy)], "F.Cu", "GND"));
                out = add_copper(out, via_copper(at_u(s, dir, cu, vy), "GND"));
            }
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
