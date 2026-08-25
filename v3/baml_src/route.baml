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

/// How far past the last signal pad a column's escape channels end.
///
/// A column's channels end on a common line of their own, one `BUS_GAP` short
/// of the column's band rows (`band_groups`); the planarity argument is the
/// group nesting, not a board-wide line.
///
/// Pad half-height + trace half-width + clearance past the pad centre: the
/// socket's signal pad is 2.5 tall, so its edge is 1.25 out and 1.6 clears it
/// by a quarter of a millimetre against a 0.2 rule. The LED chain never
/// reaches north of the keys -- its column transitions run through the field
/// on the exit row -- so both variants only need the line clear of the extreme
/// socket pad.
///
/// It was 3.5, which is what the pad wanted if you measured from its edge
/// rather than its centre and then rounded up twice. Nearly two millimetres
/// of that came straight off the top of every board, because this plus
/// `BUS_GAP` is where the fan band's deepest row sits.
function column_exit() -> float {
    1.6
}

/// Clearance kept between the fan-in bus and the connector contacts.
function BUS_GAP() -> float {
    2.5
}

/// How far behind the contacts the first bus lane runs.
///
/// Set by the connector's own mounting pegs, which are ground pads sitting
/// 2.05 to 3.35mm behind the contact line at each end of the body. A lane runs
/// the whole length of that line, so anything shallower than this shorts to
/// them -- and only at the two ends, which is exactly the kind of fault that
/// hides until DRC finds it.
function BUS_STANDOFF() -> float {
    3.9
}

/// Lane pitch in the inboard bus -- the band of parallel runs that carries the
/// fan up the board to a connector standing alongside the keys.
///
/// Tighter than `LANE_PITCH`, and it can be: these runs are parallel over their
/// whole length, so the only spacing that matters is this one. The column
/// channels get the wider pitch because their diagonals have to converge.
function BUS_PITCH() -> float {
    0.65
}

/// How deep the fan band is for a connector met head-on, which needs no bus.
function FAN_DEPTH() -> float {
    14.0
}

/// How deep the fan band is for a bus of `ways` conductors: one row each.
///
/// The exits all land on one line spread across the whole board; the bus is a
/// narrow band of parallel lanes at the inboard edge. Turning one into the
/// other is a bus corner, and a bus corner needs a row per conductor -- each
/// net drops to its own row, runs along it to its own lane, and only then turns
/// up the board. Try it with diagonals straight onto the lanes and the
/// diagonals cross the lanes, every one of them.
function fan_depth(ways: int) -> float {
    BUS_GAP() + (ways * 1.0) * BUS_PITCH() + 2.0
}

/// How far outboard of the key field a connector met by a bus stands.
function bus_reach(ways: int) -> float {
    BUS_STANDOFF() + (ways * 1.0) * BUS_PITCH() + 3.0
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
    /// The height of the shared exit line every escape channel ends on.
    exit_y: float,
    /// How far behind its contact this net's bus lane runs, and the row of the
    /// fan band it gets there along. Zero for a connector met head-on, which
    /// needs no bus at all.
    bus_off: float,
    bus_row: float,
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

/// Rank of a contact in the inboard bus: 0 for the contact nearest the fan
/// band, one more for every contact pitch away from it.
///
/// This is the whole lane assignment, and it is forced. A lane peels off the
/// bus to reach its contact, crossing every lane still running past it; the
/// only order in which that never happens is nearest-contact-on-nearest-lane,
/// so each lane ends before the next one needs to cross it.
function bus_rank(c: Component, pin: int, sgn: float) -> int {
    let ways = c.pads.length() - 1;
    let d = comp_to_global(c, ffc_pad_local(pin, ways)).y * sgn;
    let rank = 0;
    let i = 1;
    while (i <= ways) {
        if (comp_to_global(c, ffc_pad_local(i, ways)).y * sgn > d) {
            rank = rank + 1;
        }
        i = i + 1;
    }
    rank
}

/// One net's place in the bus: how far behind the contacts its lane runs, and
/// which row of the fan band it reaches that lane along.
///
/// The two orders are opposite, and that is the corner. The contact nearest the
/// band takes the lane nearest the contacts -- it has the least far to go -- and
/// therefore the row furthest into the band, because its lane has to run past
/// every other row to get there.
class BusLane {
    off: float,
    row: float,
}

/// One column's rows in the fan band. `base` is the group's deepest row --
/// the one nearest the keys -- and the column's other rows stack outward from
/// it a `BUS_PITCH` apart. The pseudo-column "LED" is the data head's single
/// back-side row, outward of every key group.
class BandGroup {
    column: string,
    base: float,
}

function find_group(groups: BandGroup[], col: string) -> BandGroup? {
    groups.find((g) -> {
        g.column == col
    })
}

/// Where `col`'s escape channels end: one `BUS_GAP` short of the deepest row
/// they must reach. A board with no band (a head-on connector) keeps the
/// shared exit line.
function group_exit(groups: BandGroup[], col: string, el: float, sgn: float) -> float {
    if let g: BandGroup = find_group(groups, col) {
        return g.base - sgn * BUS_GAP();
    }
    el
}

/// The mean x of a column's switches, for ordering columns by distance from
/// the connector.
function column_mid_x(b: Board, col: string) -> float {
    let sum = 0.0;
    let n = 0;
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
            if (net != "" && column_of(net) == col) {
                sum = sum + c.x;
                n = n + 1;
            }
        }
    }
    if (n == 0) {
        return 0.0;
    }
    sum / (n * 1.0)
}

/// The board's columns, nearest the side-mounted connector first.
///
/// The order the band's groups nest in, because a column's rows cross every
/// column nearer than it -- and the order that names the near column, the one
/// close enough to reach its contacts without joining the band at all.
function columns_near_first(b: Board) -> string[] {
    let scs = b.components.filter((c) -> {
        is_connector(c) && is_side_mounted(c)
    });
    if (scs.length() == 0) {
        return [];
    }
    let sc = scs.at(0) ?? no_component();
    let cols: string[] = [];
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
            if (net != "" && !contains_str(cols, column_of(net))) {
                cols.push(column_of(net));
            }
        }
    }
    cols.sort_by((a, z) -> {
        if ((column_mid_x(b, a) - sc.x).abs() < (column_mid_x(b, z) - sc.x).abs()) {
            0 - 1
        } else {
            1
        }
    })
}

/// The column that stands alongside the connector, if there is one.
///
/// Its contacts are the ones nearest the band, so `bus_rank` hands it the
/// outermost bus lanes -- the ones on the key side of every other lane, with
/// nothing but empty board between them and the column itself. That column has
/// no reason to escape north into the band and come back: it can cross the gap
/// on its own rows and turn straight in. See `route_near_column`.
///
/// The thumb cluster is excluded: its fan runs on the back and its contacts sit
/// on a row rather than a line, so there is no "alongside" to exploit.
///
/// So is a column whose escape via sits on the far side of the key from the
/// connector. The hotswap socket is not symmetric: the signal pad is out on one
/// side and the via that surfaces it is further out still, past the socket's
/// own pads. Where the connector is on that side -- the left hand's, whose
/// contacts face the key field across an empty strip -- the row leaves the via
/// already pointing at them. Where it is on the other -- the right hand's,
/// where the connector stands inboard of the innermost column -- a lateral row
/// would have to come back over the key it just left, straight through the
/// socket's leaf hole, and then cross the trackball's corridor to get to the
/// contacts. That column keeps the band.
function near_column(b: Board) -> string {
    if (b.id.starts_with("thumb")) {
        return "";
    }
    let cand = (columns_near_first(b).at(0)) ?? "";
    if (cand == "") {
        return "";
    }
    let conns = b.components.filter((c) -> {
        is_connector(c)
    });
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
            if (net != "" && column_of(net) == cand) {
                let pad = comp_to_global(c, MX_SIGNAL_PAD());
                let entry = from_frame(Vec2 { x: LANE_X0(), y: MX_SIGNAL_PAD().y }, Vec2 { x: c.x, y: c.y }, c.r);
                if let t: Vec2 = find_contact(conns, net) {
                    if ((entry.x - pad.x) * (t.x - pad.x) <= 0.0) {
                        return "";
                    }
                } else {
                    return "";
                }
            }
        }
    }
    cand
}

/// The fan band, packed toward the keys column by column.
///
/// One shared ladder of rows put the whole band at the tallest column's
/// height and gave every net its own slot, so the space over the tallest
/// column was mostly slots whose rows had already turned off toward the
/// connector -- centimetres of empty board. Instead each column's rows sit as
/// deep as their own path allows. A group's rows run from its column's drops
/// to the connector, over every column nearer than it, so a group clears
///
///   * the exit constraints of its own column and of every column it crosses
///     (signal-pad clearance, the ground stitch vias, the connector's top
///     contact), carried as a running outermost bound, and
///   * the previous group's rows, which it has to pass outside of to reach
///     the connector -- the same nesting that made the single ladder planar,
///     minus the empty slots.
///
/// Nearer the connector still means deeper, so drops, rows, lanes and
/// contacts keep exactly the relative order they had; only the padding
/// between groups is gone. The tail of the pod link -- pass-throughs, rails,
/// the spare -- leaves its contacts southward and never touches the band, so
/// it gets no rows at all.
function band_groups(b: Board, sgn: float) -> BandGroup[] {
    let groups: BandGroup[] = [];
    let scs = b.components.filter((c) -> {
        is_connector(c) && is_side_mounted(c)
    });
    if (scs.length() == 0) {
        return groups;
    }
    let sc = scs.at(0) ?? no_component();

    let ordered = columns_near_first(b);
    // The near column reaches its contacts sideways and takes no rows. Its
    // keys still constrain the band, though -- every other column's rows run
    // over its tiles to get to the connector -- so it stays in the loop for
    // the bounds and only skips the group.
    let near = near_column(b);

    // The bound every group shares: the connector's top contact, which every
    // row runs to.
    let ways = sc.pads.length() - 1;
    let a = comp_to_global(sc, ffc_pad_local(1, ways));
    let z = comp_to_global(sc, ffc_pad_local(ways, ways));
    let top = if ((a.y - z.y) * sgn > 0.0) {
        a
    } else {
        z
    };
    let line = top.y + sgn * (0.5 - BUS_GAP());

    let prev_top = 0.0;
    let first = true;
    for (let col in ordered) {
        let nk = 0;
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
                if (net != "" && column_of(net) == col) {
                    nk = nk + 1;
                    // The column's own exit clearance...
                    let p = comp_to_global(c, MX_SIGNAL_PAD());
                    let pc = p.y + sgn * column_exit();
                    if ((pc - line) * sgn > 0.0) {
                        line = pc;
                    }
                    // ...and its ground stitch via, kept 0.65 clear of the
                    // deepest row (`finger_exit_line` carries the twin bound).
                    let v = comp_to_global(c, MX_GND_VIA());
                    let vc = v.y + sgn * (0.65 - BUS_GAP());
                    if ((vc - line) * sgn > 0.0) {
                        line = vc;
                    }
                }
            }
        }
        if (col != near) {
            let cand = line + sgn * BUS_GAP();
            let stacked = prev_top + sgn * BUS_PITCH();
            let base = if (first) {
                cand
            } else {
                if ((stacked - cand) * sgn > 0.0) {
                    stacked
                } else {
                    cand
                }
            };
            groups.push(BandGroup { column: col, base: base });
            prev_top = base + sgn * (((nk - 1) * 1.0) * BUS_PITCH());
            first = false;
        }
    }
    groups.push(BandGroup { column: "LED", base: prev_top + sgn * BUS_PITCH() });
    groups
}

function bus_lane(
    c: Component,
    pin: int,
    exit_y: float,
    sgn: float,
    groups: BandGroup[],
) -> BusLane {
    let ways = c.pads.length() - 1;
    let rank = bus_rank(c, pin, sgn);
    let off = BUS_STANDOFF() + (rank * 1.0) * BUS_PITCH();
    let net = pad_net(c, `${pin}`);
    // The LED data head rides outward of every key group: it crosses the
    // whole board on the back, and the chain's column transitions poke up to
    // their crossing rows just south of the band -- outside the band is the
    // one place it clears them on its own layer.
    if (net.starts_with("LED_DATA")) {
        if let g: BandGroup = find_group(groups, "LED") {
            return BusLane { off: off, row: g.base };
        }
    }
    if (net.starts_with("KEY_")) {
        if let g: BandGroup = find_group(groups, column_of(net)) {
            // Within a column the contact nearest the keys keeps the row
            // nearest them -- the same relative order the single ladder gave,
            // which is the order the drops nest in at the column.
            let d = comp_to_global(c, ffc_pad_local(pin, ways)).y * sgn;
            let j = 0;
            let i = 1;
            while (i <= ways) {
                let n2 = pad_net(c, `${i}`);
                if (n2.starts_with("KEY_") && column_of(n2) == column_of(net)) {
                    if (comp_to_global(c, ffc_pad_local(i, ways)).y * sgn < d) {
                        j = j + 1;
                    }
                }
                i = i + 1;
            }
            return BusLane { off: off, row: g.base + sgn * ((j * 1.0) * BUS_PITCH()) };
        }
    }
    // No band group carries this net: sit just clear of the band, one pitch
    // short of where its deepest row would be.
    BusLane { off: off, row: exit_y + sgn * (BUS_GAP() - BUS_PITCH()) }
}

/// A connector contact, named by the part it is on rather than by position, so
/// the caller can ask for the bus lane that serves it.
class ContactRef {
    comp: Component,
    pin: int,
}

function find_contact_ref(conns: Component[], net: string) -> ContactRef? {
    for (let c in conns) {
        let i = 1;
        for (let p in c.pads) {
            if (p.pad != "MP") {
                if (p.net == net) {
                    return ContactRef { comp: c, pin: i };
                }
                i = i + 1;
            }
        }
    }
    null
}

/// True when a connector is stood on edge and met by a bus rather than head-on.
function is_side_mounted(c: Component) -> bool {
    conn_normal(c).x.abs() > 0.5
}

/// Where a net leaves a connector contact for the back, laying the front copper
/// that gets it there.
///
/// A connector the fan meets head-on gives each net its own standoff straight
/// behind the contacts. One stood on edge has the bus behind it instead, so the
/// net takes its bus lane out to the muster line and drops there, clear of the
/// fan and of every other lane.
function conn_drop(
    c: Component,
    pin: int,
    el: float,
    sgn: float,
    groups: BandGroup[],
    slot: int,
    net: string,
    out: Track[],
) -> Vec2 {
    let ways = c.pads.length() - 1;
    let pad = comp_to_global(c, ffc_pad_local(pin, ways));
    let n = conn_normal(c);
    if (is_side_mounted(c)) {
        // Down its own lane to its own row, and change layer there. Anywhere
        // deeper would mean crossing the rows in between.
        let bl = bus_lane(c, pin, el, sgn, groups);
        let lane = along(pad, n, bl.off);
        let v = Vec2 { x: lane.x, y: bl.row };
        out.push(seg(pad, lane, net));
        out.push(seg(lane, v, net));
        v
    } else {
        let v = along(pad, n, via_standoff(slot));
        out.push(seg(pad, v, net));
        v
    }
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

function collect_legs(b: Board, el: float, sgn: float) -> Leg[] {
    let conns = b.components.filter((c) -> {
        is_connector(c)
    });
    let groups = band_groups(b, sgn);
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
                            exit_y: group_exit(groups, column_of(net), el, sgn),
                            bus_off: leg_lane(conns, net, el, sgn, groups).off,
                            bus_row: leg_lane(conns, net, el, sgn, groups).row,
                        },
                    );
                }
            }
        }
    }
    legs
}

/// The bus lane of whichever contact carries `net`, or nothing if that
/// connector is met head-on.
function leg_lane(
    conns: Component[],
    net: string,
    el: float,
    sgn: float,
    groups: BandGroup[],
) -> BusLane {
    if let r: ContactRef = find_contact_ref(conns, net) {
        if (is_side_mounted(r.comp)) {
            return bus_lane(r.comp, r.pin, el, sgn, groups);
        }
    }
    BusLane { off: 0.0, row: 0.0 }
}

/// The unit vector pointing from `a` to `b`.
function unit_from(a: Vec2, b: Vec2) -> Vec2 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let l = dx.hypot(dy);
    if (l < 0.000001) {
        return Vec2 { x: 0.0, y: 0.0 };
    }
    Vec2 { x: dx / l, y: dy / l }
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
                normal: Vec2 { x: 0.0, y: 1.0 },
                pin: 0,
                exit_y: 0.0,
                bus_off: 0.0,
                bus_row: 0.0,
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

    // Lane order follows position up the column, and is not a free choice.
    // Every key steps out to the channel at the same innermost lane before
    // moving to its own, so the innermost lane has to belong to the key
    // closest to the exit line -- any other key's lane would run straight
    // through the step-out of the key below it.
    //
    // That fixes the pinout rather than the other way round: the contacts must
    // arrive in whatever order this leaves the exits in. See `link_pinout`.
    let ordered = legs.sort_by((a, b) -> {
        if ((b.pad.y - b.exit_y).abs() > (a.pad.y - a.exit_y).abs()) {
            0 - 1
        } else {
            1
        }
    });

    let lane = 0;
    for (let l in ordered) {
        let local = to_frame(l.pad, origin, r);
        let lx = LANE_X0() + (lane * 1.0) * LANE_PITCH();
        let turn = from_frame(Vec2 { x: lx, y: local.y }, origin, r);
        // The channel is straight in the column frame, so it stays parallel to
        // the column however it is splayed; it leaves that frame on its
        // column's exit line.
        let down = from_frame(Vec2 { x: lx, y: local.y + 1.0 }, origin, r);
        // Intersect the channel with the exit line.
        let steps = (l.exit_y - turn.y) / (down.y - turn.y);
        let exit = Vec2 { x: turn.x + (down.x - turn.x) * steps, y: turn.y + (down.y - turn.y) * steps };
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

/// Take the column that stands alongside the connector straight across to it.
///
/// Every other column has to escape north to the fan band, because the band is
/// the only place a row can cross the columns between it and the connector.
/// This one has no columns between: it is the connector's neighbour, and
/// `bus_rank` has already given its contacts the outermost bus lanes, the ones
/// on its own side of every other lane. Sending it north meant four and a half
/// centimetres up the board and three back down, per net, to reach a pad a
/// centimetre and a half away.
///
/// So each key crosses on its own row -- the row its pad already sits on --
/// turns at its own lane, and comes in square to its contact. Three claims
/// make that planar, and all three hold for the same reason: the lanes,
/// the rows and the contacts are in the same order.
///
///   * Lane against row. Lane order runs away from the connector as contact
///     order runs toward the band, and rows are the keys in that same order,
///     so a lane only ever crosses the rows of keys whose lanes are further
///     out still -- and those rows stop short of it.
///   * Lane against the run-in. A run-in leaves its lane heading for the
///     contacts, past every lane inboard of it; those lanes belong to contacts
///     nearer the band, so they have turned off before this contact's row.
///   * Row against row. They are the key rows, a key pitch apart.
///
/// The pad stub and its via are the column channel's, unchanged: a hotswap
/// terminal is on the back and has to surface before it goes anywhere.
function route_near_column(legs: Leg[], out: Track[], vias: Via[]) -> void {
    for (let l in legs) {
        let entry = from_frame(Vec2 { x: LANE_X0(), y: MX_SIGNAL_PAD().y }, l.origin, l.r);
        let lane = along(l.target, l.normal, l.bus_off);
        let turn = Vec2 { x: lane.x, y: entry.y };
        out.push(back(l.pad, entry, l.net));
        vias.push(Via { at: entry, net: l.net });
        out.push(seg(entry, turn, l.net));
        out.push(seg(turn, lane, l.net));
        out.push(seg(lane, l.target, l.net));
    }
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
            // Stood on edge, alongside the keys: a bus corner. Straight out of
            // the exit onto its own row of the fan band, along that row to its
            // own lane, up the lane level with its contact, and in square to
            // the pad.
            let lane = along(l.target, l.normal, l.bus_off);
            let drop = Vec2 { x: e.x, y: l.bus_row };
            let corner = Vec2 { x: lane.x, y: l.bus_row };
            out.push(seg(e, drop, l.net));
            out.push(seg(drop, corner, l.net));
            out.push(seg(corner, lane, l.net));
            out.push(seg(lane, l.target, l.net));
        } else {
            // Met head-on, contacts parallel to the escape line: one straight
            // run, ending in a short stub square to the pad so it is never
            // approached at a shallow angle.
            let stub = along(l.target, l.normal, BUS_GAP());
            out.push(seg(e, stub, l.net));
            out.push(seg(stub, l.target, l.net));
        }
    }
}

/// The thumb cluster's fan: contacts on one horizontal row, exits arriving
/// laterally along the board.
///
/// The head-on shape (one straight run per net) fails here: the contacts are a
/// millimetre apart and the runs arrive almost parallel to their row, so
/// neighbours converge to nothing. And a front-side bus corner fails too: the
/// strip between the contacts and the nearest key is walled off on the front
/// by the connector's mounting pegs on one side and the key's dowel holes on
/// the other, with no single height clear across both.
///
/// So the rows run on the back, where the connector has no copper at all.
/// Each net drops from the exit line, crosses the board on its own back-side
/// row tucked between the contact line and the nearest key's holes, turns up
/// at its own contact's x, and surfaces through a via nestled just behind the
/// contact -- the vias sit a contact pitch apart, so nothing shorts.
///
/// The nesting is forced the same way as every bus corner: the contact
/// furthest from the exits takes the deepest row, because its turn-in crosses
/// every shallower row and a shallower row must have ended (turned up at its
/// own contact, nearer the exits) before that x. Exits, rows and contacts all
/// run in the same order along the board or something crosses.
function route_thumb_fanin(
    legs: Leg[],
    exits: Escape[],
    exit_y: float,
    sgn: float,
    out: Track[],
    vias: Via[],
) -> void {
    if (legs.length() == 0) {
        return;
    }
    let n = legs.length() * 1.0;
    let mean_ex = exits.reduce(
        (a, e) -> {
            a + e.p.x
        },
        0.0,
    )
        / (
            if (exits.length() > 0) {
                exits.length() * 1.0
            } else {
                1.0
            }
        );
    let mean_cx = legs.reduce(
        (a, l) -> {
            a + l.target.x
        },
        0.0,
    )
        / n;
    // +1 when the exits lie to the right of the contacts.
    let away = if (mean_ex > mean_cx) {
        1.0
    } else {
        0.0 - 1.0
    };
    // Farthest contact first: rank 0 takes the deepest row.
    let ordered = legs.sort_by((a, b) -> {
        if (a.target.x * away < b.target.x * away) {
            0 - 1
        } else {
            1
        }
    });
    let i = 0;
    for (let l in ordered) {
        let e = escape_of(exits, l.net);
        // The shallowest row must still clear the surfacing vias, and the
        // deepest must clear the nearest key's dowel hole, which starts about
        // 2.7mm behind the contact line.
        let row = l.target.y - sgn * (THUMB_ROW_BASE() + ((legs.length() - 1 - i) * 1.0) * THUMB_ROW_PITCH());
        let up = Vec2 { x: l.target.x, y: row };
        // Through to the back at the exit, and back up right behind the
        // contact, clear of its neighbours by the contact pitch.
        let vt = Vec2 { x: l.target.x, y: l.target.y - sgn * THUMB_VIA_TUCK() };
        // The dive via steps 1mm along the exit line toward the contacts: the
        // escape delivering `e` surfaced through its own via a fraction north
        // of it, and diving straight back down there puts the two holes
        // nearly rim to rim.
        let ed = Vec2 {
            x: e.x
                + (
                    if (l.target.x > e.x) {
                        1.0
                    } else {
                        0.0 - 1.0
                    }
                ),
            y: e.y,
        };
        out.push(seg(e, ed, l.net));
        vias.push(Via { at: ed, net: l.net });
        for (let pair in [[ed, Vec2 { x: ed.x, y: row }], [Vec2 { x: ed.x, y: row }, up], [up, vt]]) {
            out.push(
                Track {
                    start: vec_at(pair, 0),
                    end: vec_at(pair, 1),
                    width: TRACE_W(),
                    layer: "B.Cu",
                    net: l.net,
                },
            );
        }
        vias.push(Via { at: vt, net: l.net });
        out.push(seg(vt, l.target, l.net));
        i = i + 1;
    }
}

/// The thumb fan's back-side geometry, all measured from the contact line.
///
/// The row band lives in the 2.7mm between the contacts and the mounting-peg
/// line of the connector's own footprint -- free on the back -- and must stay
/// north of the nearest key's Ø3 dowel hole. The tuck via sits between the
/// contact pads and the first row.
function THUMB_ROW_BASE() -> float {
    0.95
}

function THUMB_ROW_PITCH() -> float {
    0.5
}

function THUMB_VIA_TUCK() -> float {
    0.3
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

/// One net that arrives on one connector and leaves on another.
class PassThrough {
    net: string,
    a: Component,
    ia: int,
    z: Component,
    iz: int,
    /// How far the run has to travel across the board. Which end of the
    /// standoff stack it takes turns on this, and only on this.
    span: float,
}

function find_passthroughs(conns: Component[]) -> PassThrough[] {
    let out: PassThrough[] = [];
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
                                    out.push(
                                        PassThrough {
                                            net: pa.net,
                                            a: a,
                                            ia: ia,
                                            z: z,
                                            iz: iz,
                                            span: (pta.x - ptz.x).abs(),
                                        },
                                    );
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
    out
}

/// The pass-throughs in the order their lanes are laid out.
///
/// Bottom pod-link contact first: it takes the nearest lane, so each vertical
/// drop starts before the stub of the net below it reaches its x.
function sorted_passthroughs(conns: Component[]) -> PassThrough[] {
    find_passthroughs(conns).sort_by((p, q) -> {
        let pa = comp_to_global(p.a, ffc_pad_local(p.ia, p.a.pads.length() - 1));
        let qa = comp_to_global(q.a, ffc_pad_local(q.ia, q.a.pads.length() - 1));
        if (pa.y > qa.y) {
            0 - 1
        } else {
            1
        }
    })
}

/// The x each pass lane runs south at, in that order.
///
/// Read by the LED chain too: the lanes are placed off the pod link and the
/// chain's link contacts off the thumb link, so nothing stops the two from
/// wanting the same strip of board.
function pass_lane_xs(conns: Component[]) -> float[] {
    let out: float[] = [];
    let k = 0;
    for (let pt in sorted_passthroughs(conns)) {
        let pa = comp_to_global(pt.a, ffc_pad_local(pt.ia, pt.a.pads.length() - 1));
        out.push(along(pa, conn_normal(pt.a), BUS_STANDOFF() + (k * 1.0) * BUS_PITCH()).x);
        k = k + 1;
    }
    out
}

/// How far beyond the last pass contact the back-side descent band starts.
///
/// The turn-ups stand on the contacts themselves, so this has to clear a via:
/// via radius, trace half-width, and the rule.
function PASS_BAND_GAP() -> float {
    0.75
}

function PASS_BAND_PITCH() -> float {
    0.65
}

/// The x each pass-through comes down at on the back, in the same order.
///
/// Deliberately not the lane x. The lanes are placed off the pod link and the
/// contacts they serve are on the thumb link, and the two have no reason to
/// line up: widen the pod link's ribbon and it stands further outboard, which
/// slides the whole lane band sideways across the thumb link's contacts. Each
/// net traces a U -- down its lane, along its row, up at its contact -- and
/// two U's stay clear of each other only if their spans nest or miss entirely.
/// Let the band drift into the contacts and the spans interleave instead, and
/// then no assignment of rows is planar, because the shallower row of an
/// interleaved pair always crosses the other's descent. The LED-only build
/// cleared this by 0.209mm, which is to say it was luck rather than design.
///
/// So the descents get a band of their own, placed off the contacts they serve
/// rather than off the lanes they come from: just past the outermost pass
/// contact, on the side the rest of the connector is, where the back of the
/// board is nothing but the body's shadow. Every U then begins outside every
/// contact and ends on its own, so nearest-contact-on-nearest-descent nests
/// them by construction and the rows follow the same order.
/// Where the descent band stands: which contact it starts just outside of, and
/// which way it runs from there.
class PassBand {
    edge: float,
    side: float,
}

/// The pass contacts' own x, in `sorted_passthroughs` order.
function pass_contact_xs(conns: Component[]) -> float[] {
    let xs: float[] = [];
    for (let pt in sorted_passthroughs(conns)) {
        xs.push(comp_to_global(pt.z, ffc_pad_local(pt.iz, pt.z.pads.length() - 1)).x);
    }
    xs
}

function pass_band(conns: Component[]) -> PassBand {
    let ordered = sorted_passthroughs(conns);
    let xs = pass_contact_xs(conns);
    let n = xs.length();
    if (n == 0) {
        return PassBand { edge: 0.0, side: 1.0 };
    }
    let sum = 0.0;
    for (let x in xs) {
        sum = sum + x;
    }
    let mid = sum / (n * 1.0);
    // The pass contacts sit together at one end of the link, so the way to the
    // rest of it is the way with room: on the back, the body's own shadow.
    let zx = (ordered.at(0)?.z.x) ?? mid;
    let side = if (zx > mid) {
        1.0
    } else {
        0.0 - 1.0
    };
    let edge = mid;
    for (let x in xs) {
        if ((x - mid) * side > (edge - mid) * side) {
            edge = x;
        }
    }
    PassBand { edge: edge, side: side }
}

/// How far out a pass-through sits in the band: 0 for the contact nearest it.
///
/// One number does three jobs, and they are the same nesting seen three ways.
/// It picks the descent, so the widest U is outermost. It picks the row, so the
/// widest U is deepest and every narrower one has turned up before it passes.
/// And it picks the dive, so the run that jogs furthest across the back does it
/// furthest from the link, north of every descent it would otherwise cross.
function pass_ranks(conns: Component[]) -> int[] {
    let xs = pass_contact_xs(conns);
    let e = pass_band(conns).edge;
    let out: int[] = [];
    for (let x in xs) {
        out.push(
            xs
                .filter((q) -> {
                    (q - e).abs() < (x - e).abs()
                })
                .length(),
        );
    }
    out
}

function pass_descent_xs(conns: Component[]) -> float[] {
    let band = pass_band(conns);
    let out: float[] = [];
    for (let r in pass_ranks(conns)) {
        out.push(band.edge + band.side * (PASS_BAND_GAP() + (r * 1.0) * PASS_BAND_PITCH()));
    }
    out
}

/// How far from the thumb link each run drops to the back: 0 for the nearest.
///
/// Not the rank. The jog from the lane to the descent band runs over the band,
/// so a run has to make its jog clear of every descent already standing in the
/// way -- which means north of them, since a descent runs from its own dive
/// south. Order them by how far each descent is from the lanes and the run
/// with the longest jog goes first, above all the rest.
///
/// Which end that is depends on the hand: the lanes come off the pod link and
/// the band is placed off the thumb link, so on one half the jogs run outward
/// over the band and on the other they run back inward over it. Reading the
/// order off the two x's rather than off the contact order is what makes the
/// same code do both.
function pass_staggers(conns: Component[]) -> int[] {
    let lanes = pass_lane_xs(conns);
    let n = lanes.length();
    if (n == 0) {
        return [];
    }
    let sum = 0.0;
    for (let x in lanes) {
        sum = sum + x;
    }
    let ref = sum / (n * 1.0);
    let ds = pass_descent_xs(conns);
    let out: int[] = [];
    for (let d in ds) {
        out.push(
            ds
                .filter((q) -> {
                    (q - ref).abs() < (d - ref).abs()
                })
                .length(),
        );
    }
    out
}

/// Nets that arrive on one connector and leave on another.
///
/// The thumb cluster hangs off its finger board, so its three key nets cross
/// the finger board without touching a switch on it: pod -> J1 -> J2 -> thumb.
/// They are the one thing here that is not a fan-in, and the only place the
/// board needs its second layer.
///
/// Each takes its own lane out of the first connector, runs down it, and turns
/// once to reach its own standoff behind the second. A straight line between
/// the two would do neither: both ends are a millimetre-pitch row, so three
/// straight runs between them lie almost on top of one another.
///
/// The corner only stays clear if the longest run turns furthest from the
/// second connector. Turn the shortest one there instead and its cross-run
/// passes under the lane of every run that overshoots it.
function route_passthroughs(
    b: Board,
    f: Features,
    exit_y: float,
    sgn: float,
    out: Track[],
    vias: Via[],
) -> void {
    // The pod link stands on the inboard edge; the thumb link faces down at
    // the south edge. A pass net leaves the pod link along its own bus lane,
    // runs SOUTH past the connector body -- the lane x is unique to its
    // contact, and south of the connector nothing else wants it -- drops to
    // the back on its own row of the south strip, crosses under the inner
    // column, and comes up just behind the thumb link's contact.
    //
    // Two nested orders keep it planar, both forced. At the pod link the
    // bottom contact takes the nearest lane, so each vertical drop starts
    // before the stub of the net below it reaches its x. Along the strip the
    // bottom contact takes the deepest row, and at the thumb link the rows
    // turn up in the order the contacts run, each shallower row having ended
    // -- turned up at its own contact -- before the next one crosses.
    let conns = b.components.filter((c) -> {
        is_connector(c)
    });
    let ordered = sorted_passthroughs(conns);
    let lanes = pass_lane_xs(conns);
    let descents = pass_descent_xs(conns);
    let ranks = pass_ranks(conns);
    let staggers = pass_staggers(conns);
    let npass = ordered.length();
    let k = 0;
    for (let pt in ordered) {
        let ways_a = pt.a.pads.length() - 1;
        let pad_a = comp_to_global(pt.a, ffc_pad_local(pt.ia, ways_a));
        let na = conn_normal(pt.a);
        let lane = along(pad_a, na, BUS_STANDOFF() + (k * 1.0) * BUS_PITCH());
        // The strip: rows tucked between the thumb link's contacts and the
        // board edge. The contact nearest the descent band has the narrowest
        // U, so it takes the shallowest row and every one outside it nests a
        // row deeper, or the turn-ups cross the rows.
        let r = ranks.at(k) ?? 0;
        let row = pt.z.y + 1.85 - ((npass - 1 - r) * 1.0) * 0.65;
        // Off the front before the run reaches the thumb link's mounting
        // pegs, which sit right in the lane's path. Staggered so the vias
        // clear each other despite the lanes' sub-via pitch, and so the run
        // with furthest to jog crosses the back above the rest.
        let sg = staggers.at(k) ?? 0;
        let dive = Vec2 { x: lane.x, y: pt.z.y - LINK_BODY_DEPTH() - 0.5 - (sg * 1.0) * 0.9 };
        // Across the back to the descent band, then down it. The jog is what
        // decouples the lanes from the contacts; see `pass_descent_xs`.
        let dx = descents.at(k) ?? lane.x;
        let jog = Vec2 { x: dx, y: dive.y };
        let va = Vec2 { x: dx, y: row };
        out.push(seg(pad_a, lane, pt.net));
        out.push(seg(lane, dive, pt.net));
        vias.push(Via { at: dive, net: pt.net });
        out.push(Track { start: dive, end: jog, width: TRACE_W(), layer: "B.Cu", net: pt.net });
        out.push(Track { start: jog, end: va, width: TRACE_W(), layer: "B.Cu", net: pt.net });

        let ways_z = pt.z.pads.length() - 1;
        let pad_z = comp_to_global(pt.z, ffc_pad_local(pt.iz, ways_z));
        let nz = conn_normal(pt.z);
        // All the thumb-link standoffs sit at one depth: the verticals up to
        // them run at distinct x (one per contact), so unlike the old shared
        // line there is nothing to short against.
        let vz = along(pad_z, nz, VIA_STANDOFF() + 1.0);
        let turn = Vec2 { x: pad_z.x, y: row };
        for (let e in [[va, turn], [turn, vz]]) {
            out.push(
                Track {
                    start: vec_at(e, 0),
                    end: vec_at(e, 1),
                    width: TRACE_W(),
                    layer: "B.Cu",
                    net: pt.net,
                },
            );
        }
        vias.push(Via { at: vz, net: pt.net });
        out.push(seg(pad_z, vz, pt.net));
        k = k + 1;
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

/// Which side of the key field a board escapes to: +1 below, -1 above.
///
/// Every key board escapes over the top. A thumb cluster's cable goes back up
/// to its finger board, so up is where its connector is. The finger halves
/// used to escape downward -- and their fan band then sat exactly where the
/// thumb cluster tucks under the splayed columns, which is what made the two
/// boards overlap. Above the top row nothing else wants the space, and the
/// board's south edge can hug the bottom keys instead.
function escape_side(id: string) -> float {
    0.0 - 1.0
}

/// The last switch signal pad on the escape side of a board.
///
/// This is the one number the placement and the router have to agree on: it
/// fixes the escape line, and the connectors are placed relative to it so every
/// fan-in run leaves *away* from the key field.
function last_signal_pad(comps: Component[], sgn: float) -> float {
    comps.reduce(
        (a, c) -> {
            if (is_switch(c)) {
                let p = comp_to_global(c, MX_SIGNAL_PAD());
                if (p.y * sgn > a * sgn) {
                    p.y
                } else {
                    a
                }
            } else {
                a
            }
        },
        0.0 - 100000.0 * sgn,
    )
}

function lowest_signal_pad(comps: Component[]) -> float {
    last_signal_pad(comps, 1.0)
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

/// Every column's exits, without keeping the copper. Lets a test read the
/// order the fan-in actually has to serve.
function board_exits(b: Board, el: float, sgn: float) -> Escape[] {
    let tracks: Track[] = [];
    let vias: Via[] = [];
    let legs = collect_legs(b, el, sgn);
    let seen: string[] = [];
    for (let l in legs) {
        if (!contains_str(seen, l.column)) {
            seen.push(l.column);
        }
    }
    let out: Escape[] = [];
    for (let col in seen) {
        for (
            let e in route_column(
                legs.filter((l) -> {
                    l.column == col
                }),
                tracks,
                vias,
            )
        ) {
            out.push(e);
        }
    }
    out
}

/// The escape line of a board.
///
/// Finger halves: a fixed depth past the last key, past every key on the
/// board. Thumb clusters: pinned to the connector instead -- the connector
/// sits as tight over the keys as the link gap allows, and the exit line goes
/// between it and the keys, one fan row per contact plus working clearance.
function board_exit_line(b: Board, sgn: float) -> float {
    if (b.id.starts_with("thumb")) {
        if let c: Component = b.components.find((c) -> {
            is_connector(c)
        }) {
            let ways = c.pads.length() - 1;
            let cy = comp_to_global(c, ffc_pad_local(1, ways)).y;
            return cy - sgn * (BUS_GAP() + (ways * 1.0) * BUS_PITCH() + 0.5);
        }
    }
    finger_exit_line(b, sgn)
}

/// One constraint point per column: its extreme signal pad, pushed out by the
/// working clearance. The exit line must stay on the escape side of them all.
function column_exit_points(comps: Component[], sgn: float, ce: float) -> Vec2[] {
    let cols: string[] = [];
    for (let c in comps) {
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
                if (!contains_str(cols, column_of(net))) {
                    cols.push(column_of(net));
                }
            }
        }
    }
    let pts: Vec2[] = [];
    for (let col in cols) {
        let best = Vec2 { x: 0.0, y: 0.0 };
        let found = false;
        for (let c in comps) {
            if (is_switch(c)) {
                let net = (
                    c.pads
                        .find((p) -> {
                            p.pad == "1"
                        })
                        ?.net
                )
                    ?? "";
                if (net != "" && column_of(net) == col) {
                    let p = comp_to_global(c, MX_SIGNAL_PAD());
                    if (!found || (p.y - best.y) * sgn > 0.0) {
                        best = p;
                        found = true;
                    }
                }
            }
        }
        if (found) {
            pts.push(Vec2 { x: best.x, y: best.y + sgn * ce });
        }
    }
    pts
}

/// The finger boards' exit line: horizontal, as low as every constraint
/// allows.
///
/// The tallest column's constraint is the one that binds, so the band sits
/// just above the middle column and the shorter columns keep whatever margin
/// the stagger gives them. A sloped line could trade some of that margin
/// back, but it buys nothing where it matters -- the tallest column pins it
/// -- and horizontal keeps every clearance in the band a plain vertical
/// distance.
function finger_exit_line(b: Board, sgn: float) -> float {
    let pts = column_exit_points(b.components, sgn, column_exit());
    for (let c in b.components) {
        if (is_switch(c)) {
            // Every key's ground stitch via sits 6mm up the key, just past
            // the socket's own pads, where the bus rows want to run. Keep the
            // *shallowest* row (BUS_GAP out from the line) clear of it, which
            // bounds the line through the row's own offset.
            let v = comp_to_global(c, MX_GND_VIA());
            pts.push(Vec2 { x: v.x, y: v.y + sgn * (0.65 - BUS_GAP()) });
        }
        if (is_connector(c) && is_side_mounted(c)) {
            let ways = c.pads.length() - 1;
            let a = comp_to_global(c, ffc_pad_local(1, ways));
            let z = comp_to_global(c, ffc_pad_local(ways, ways));
            let top = if ((a.y - z.y) * sgn > 0.0) {
                a
            } else {
                z
            };
            pts.push(Vec2 { x: top.x, y: top.y + sgn * (0.5 - BUS_GAP()) });
        }
    }
    // Flat through the outermost point.
    pts.reduce(
        (a, p) -> {
            if ((p.y - a) * sgn > 0.0) {
                p.y
            } else {
                a
            }
        },
        (pts.at(0)?.y) ?? 0.0,
    )
}

function route_board(b: Board, m: Module, f: Features) -> Board {
    let tracks: Track[] = [];
    let vias: Via[] = [];

    // The escape line, past every key on the board.
    let sgn = escape_side(b.id);
    let lowest = last_signal_pad(b.components, sgn);
    let el = board_exit_line(b, sgn);
    let groups = band_groups(b, sgn);
    let legs = collect_legs(b, el, sgn);

    // Group by column. Keys in a column share an axis, which is what lets the
    // escape channel be a straight line.
    let seen: string[] = [];
    for (let l in legs) {
        if (!contains_str(seen, l.column)) {
            seen.push(l.column);
        }
    }

    let near = near_column(b);
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
        if (col == near) {
            // Straight across to the connector; it never joins the fan, so it
            // contributes neither exits nor legs to it.
            route_near_column(group, tracks, vias);
        } else {
            for (let e in route_column(group, tracks, vias)) {
                all_exits.push(e);
            }
            for (let l in group) {
                all_legs.push(l);
            }
        }
    }
    if (b.id.starts_with("thumb")) {
        route_thumb_fanin(all_legs, all_exits, el, sgn, tracks, vias);
    } else {
        route_fanin(all_legs, all_exits, tracks);
    }

    route_passthroughs(b, f, el, sgn, tracks, vias);
    route_leds(b, m, f, lowest, el, sgn, groups, tracks, vias);
    // After the LED chain, because the trackball's corridor is quoted against
    // where the chain's copper actually lands in the south strip.
    route_trackball(b, f, tracks, vias);
    route_ground_vias(b, f, vias, tracks);
    route_supply_vias(b, f, el, sgn, groups, vias, tracks);

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

/// The row a transition crosses a key tile on: just NORTH of the ground
/// stitch via (the socket's ground stub runs from pad to via right through
/// the strip between them, so the crossing cannot go there), and still south
/// of the fan band's deepest row.
///
/// It tracks the stitch via, which is why it moved four millimetres south
/// when the via did. The band came south with both of them, so the room
/// between this row and the band's deepest row is what it always was.
function LED_TOP_ROW() -> float {
    0.0 - 7.5
}

/// Under the bottom the chain crosses close in, between the ground via row
/// and the dout row: the board's south edge is cut back for the thumb board,
/// and the old deep band ran outside it. Nothing else is down there -- the
/// hotswap socket keeps all its hardware north of its key's centre -- so
/// close in costs nothing.
function LED_UNDER_Y() -> float {
    8.2
}

/// Where the LED's ground pad reaches the front pour.
///
/// Straight below the ground pad and no further: everything south of a key is
/// one shared corridor -- the under-the-bottom crossing and the tail both run
/// through it -- and a hook that reached out across it would fence both off.
/// Tucked between the pad row and that corridor, the drop is a stub.
function LED_GND_VIA() -> Vec2 {
    Vec2 { x: 2.73, y: 7.35 }
}

/// Where the hotswap socket's ground terminal reaches the front pour.
///
/// Straight up from the pad and no further than it has to be. It used to sit
/// at (-6.5,-10.5): eight millimetres of stub, laid on a slight diagonal, to
/// reach a spot 10.5mm up a key whose own hardware stops at 6.33. That cost
/// twice over, because the via is one of the two things the fan band has to
/// keep clear of -- so the band, and with it the whole north edge of the
/// board, stood off the tallest column at the height of a via nobody had put
/// anywhere in particular.
///
/// x is the pad's own, so the stub is a plain vertical run; the strip it runs
/// up is clear either side, the socket's 3mm hole ending at x=-5.31 and the
/// previous column's outermost channel lane at -9.12.
function MX_GND_VIA() -> Vec2 {
    Vec2 { x: 0.0 - 7.085, y: 0.0 - 6.0 }
}

/// The lane the last LED's dout takes out past the end of the key field, on
/// its way down to the connector.
function LED_TAIL_X() -> float {
    11.5
}

/// How far south of the head's own bus row the outboard channel starts.
///
/// Far enough that the diagonal onto it is clear of the hull's north-west
/// corner, which cuts across the channel's line above this.
function LED_HEAD_JOIN_Y() -> float {
    12.0
}

/// How far inboard of the channel the head leaves its bus row.
///
/// The diagonal has to start where the board is still wide -- the corner is
/// cut off above the channel -- and end outboard of the first column's
/// transition lane.
function LED_HEAD_JOIN_X() -> float {
    8.0
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

/// One thumb hop: LED to LED on the back where the field is open, over the
/// front where it is not.
///
/// The cluster's keys are three one-key columns, so the snake-and-transition
/// machinery would cross the field twice per hop. The LED pads are already on
/// the back, and when the dout corner faces the next key the hop simply runs
/// straight to its approach point.
///
/// The approach point sits out along the din row in the destination LED's own
/// frame: a straight run at the elbow can graze the ground pad one pad-pitch
/// from din, and aiming past it puts the incoming run on the din side of that
/// pad whatever direction it arrives from.
///
/// When the exit and the travel direction disagree (dot below one-half), the
/// hop must swing around the source key's hardware -- and on the mirrored
/// hand two such swings would fence each other in: each hop's exit drop and
/// east-west run box in the other's approach, and the dowel holes leave no
/// planar corridor. So the swing surfaces: down to a line just south of the
/// source key (the escape side is always north), along it past the
/// destination, and back down at the approach point -- on the front, which
/// above the fan band is nothing but pour and the keys' own holes.
function route_led_thumb_hop(
    src: Component,
    dst: Component,
    net: string,
    out: Track[],
    vias: Via[],
) -> void {
    let dout = comp_to_global(src, LED_DOUT_PAD());
    let a = led_key_pt(src, LED_DOUT_VIA());
    let f = comp_to_global(dst, THUMB_DIN_APPROACH());
    out.push(back(dout, a, net));
    let ex = unit_from(dout, a);
    let v = unit_from(a, f);
    if (ex.x * v.x + ex.y * v.y < 0.5) {
        let ys = led_key_pt(src, Vec2 { x: 0.0, y: 0.0 }).y + 8.3;
        let m1 = Vec2 { x: a.x, y: ys };
        let m2 = Vec2 {
            x: f.x
                + 6.5
                    * (
                        if (a.x > f.x) {
                            1.0
                        } else {
                            0.0 - 1.0
                        }
                    ),
            y: ys,
        };
        vias.push(Via { at: a, net: net });
        out.push(seg(a, m1, net));
        out.push(seg(m1, m2, net));
        out.push(seg(m2, f, net));
        vias.push(Via { at: f, net: net });
        route_din_stub(dst, f, net, out);
        return;
    }
    // The approach point sits out along the din row past the elbow. When the
    // run arrives from the elbow's side it goes by the elbow, on to the
    // approach point, and turns straight back through the angle it came in
    // at -- a hairpin closing to about 35 degrees.
    //
    // The overshoot itself has to stay: aim at the elbow instead and the run
    // lands on the destination LED's ground pad, which is what the approach
    // point exists to get outside of. What can go is the point of the
    // hairpin. Come into the approach point square to the row -- one corner
    // out at the turn, then in along the row -- and the same path is two
    // obtuse bends instead of one spike, for the price of a couple of
    // millimetres.
    let e = led_key_pt(dst, LED_DIN_ELBOW());
    if ((f.x - e.x) * (f.x - a.x) + (f.y - e.y) * (f.y - a.y) > 0.0) {
        let u = unit_from(e, f);
        let s = if ((a.x - f.x) * (0.0 - u.y) + (a.y - f.y) * u.x > 0.0) {
            THUMB_DIN_TURN()
        } else {
            0.0 - THUMB_DIN_TURN()
        };
        let q = Vec2 { x: f.x - s * u.y, y: f.y + s * u.x };
        out.push(back(a, q, net));
        out.push(back(q, f, net));
        route_din_stub(dst, f, net, out);
        return;
    }
    out.push(back(a, f, net));
    route_din_stub(dst, f, net, out);
}

/// How far square of the din row the hairpin's turn stands.
///
/// Far enough that the corner is a corner rather than a kink, and short enough
/// that the leg back in stays outside the destination LED's pads -- which the
/// approach point is already 4.7mm clear of along the row.
function THUMB_DIN_TURN() -> float {
    2.5
}

/// Where a thumb hop aims before turning in: on the din row, in the LED's own
/// frame (library coordinates -- `comp_to_global` mirrors the y), far enough
/// out that the incoming diagonal passes wide of the ground pad, its via, and
/// the din stub -- whatever direction it arrives from.
function THUMB_DIN_APPROACH() -> Vec2 {
    Vec2 { x: 9.2, y: 0.75 }
}

/// The thumb link's data contact into the cluster's first LED.
///
/// The drop goes through just behind the connector -- past the fan band's
/// rows, which hug the contact line -- and the run to the key crosses only
/// back-side pour from there.
function route_led_thumb_head(
    ref: ContactRef,
    el: float,
    sgn: float,
    groups: BandGroup[],
    dst: Component,
    net: string,
    out: Track[],
    vias: Via[],
) -> void {
    let v = conn_drop(ref.comp, ref.pin, el, sgn, groups, 1, net, out);
    vias.push(Via { at: v, net: net });
    let e = led_key_pt(dst, LED_DIN_ELBOW());
    let f = comp_to_global(dst, THUMB_DIN_APPROACH());
    if ((f.x - e.x) * (v.x - e.x) + (f.y - e.y) * (v.y - e.y) > 0.0) {
        // The din row points back toward the connector: run straight to the
        // approach point and turn in along the row. The straight run passes
        // clear of the first key's hardware on this hand.
        // A jog first: the straight run would cross the far key's escape
        // row and end on its surfacing via. Held at the approach point's x,
        // the crossing of that row lands in the gap between the row's end
        // and the next key's drop.
        let q = Vec2 { x: f.x, y: f.y - 5.1 };
        out.push(back(v, q, net));
        out.push(back(q, f, net));
        route_din_stub(dst, f, net, out);
        return;
    }
    // The row points away: straight at the elbow, the run clips the first
    // key's stem hole. The clear channel is the strip between that key's
    // hardware and the board edge -- hold the drop's x (nudged a touch toward
    // the edge) until almost level with the elbow, then cut across.
    let w = Vec2 {
        x: v.x
            + 0.2
                * (
                    if (v.x > e.x) {
                        1.0
                    } else {
                        0.0 - 1.0
                    }
                ),
        y: e.y - 4.8,
    };
    out.push(back(v, w, net));
    out.push(back(w, e, net));
    route_din_stub(dst, e, net, out);
}

/// A column change, on the back.
///
/// `sign` is -1 when the chain reached the TOP of both columns and +1 the
/// bottom -- the same end for both because the chain snakes.
///
/// At the bottom it crosses under the key field, close in: the thumb board's
/// notch is cut out of the south edge, and a run any deeper falls off the
/// board.
///
/// At the top it does NOT go over: an over-the-top run would fence the fan
/// band away from the keys and cost the whole board that height. It cannot
/// simply run across at the exit row either -- west of every key that has a
/// key below it, the lower socket's ground hook climbs right through that row
/// -- so both ends attach on their EAST sides, where the exit row is clear,
/// and the link between them runs up the shared corridor and across the
/// EASTERN key's north strip, the gap between its socket and its ground
/// stitch via. It threads the field; it never leaves it to the north.
function route_led_transition(
    src: Component,
    dst: Component,
    net: string,
    sign: float,
    out: Track[],
) -> void {
    let p0 = comp_to_global(src, LED_DOUT_PAD());
    if (sign < 0.0) {
        let p1 = led_key_pt(src, Vec2 { x: LED_DOUT_PAD().x, y: LED_EXIT_Y() });
        let p2 = led_key_pt(src, Vec2 { x: LED_BUS_X(), y: LED_EXIT_Y() });
        // The eastern key of the pair, whichever way the chain is going: its
        // north strip is the crossing, and the corridor between the columns
        // is its west flank.
        let e = if (src.x > dst.x) {
            src
        } else {
            dst
        };
        let n1 = led_key_pt(e, Vec2 { x: 0.0 - LED_BUS_X(), y: LED_TOP_ROW() });
        let n2 = led_key_pt(e, Vec2 { x: LED_BUS_X(), y: LED_TOP_ROW() });
        let m1 = if (src.x > dst.x) {
            n2
        } else {
            n1
        };
        let m2 = if (src.x > dst.x) {
            n1
        } else {
            n2
        };
        let q2 = led_key_pt(dst, Vec2 { x: LED_BUS_X(), y: LED_EXIT_Y() });
        let q1 = led_key_pt(dst, Vec2 { x: LED_DIN_ELBOW().x, y: LED_EXIT_Y() });
        for (let e2 in [[p0, p1], [p1, p2], [p2, m1], [m1, m2], [m2, q2], [q2, q1]]) {
            let a = vec_at(e2, 0);
            let z = vec_at(e2, 1);
            if (a.x != z.x || a.y != z.y) {
                out.push(back(a, z, net));
            }
        }
        route_din_stub(dst, q1, net, out);
        return;
    }
    let cy = LED_UNDER_Y();
    let p1 = led_key_pt(src, Vec2 { x: LED_DOUT_PAD().x, y: cy });
    let p2 = led_key_pt(src, Vec2 { x: LED_BUS_X(), y: cy });
    let q2 = led_key_pt(dst, Vec2 { x: LED_BUS_X(), y: cy });
    let q1 = led_key_pt(dst, Vec2 { x: LED_DIN_ELBOW().x, y: cy });
    // The two columns are staggered, so their ends are not level. Crossing on
    // the straight line between them cuts the corner of whichever key sticks
    // out further; crossing at the extreme of the two clears both.
    let ex = if (p2.y > q2.y) {
        p2.y
    } else {
        q2.y
    };
    let m1 = Vec2 { x: p2.x, y: ex };
    let m2 = Vec2 { x: q2.x, y: ex };
    for (let e in [[p0, p1], [p1, p2], [p2, m1], [m1, m2], [m2, q2], [q2, q1]]) {
        let a = vec_at(e, 0);
        let z = vec_at(e, 1);
        if (a.x != z.x || a.y != z.y) {
            out.push(back(a, z, net));
        }
    }
    route_din_stub(dst, q1, net, out);
}

/// The pod link's data contact into the chain's first LED.
///
/// The link stands on the inboard edge and the chain starts at the far,
/// outboard column, so the run crosses the whole board. Each leg uses the
/// layer that is empty there: a dive straight off the contact (under the
/// thumb pass lanes, which drop across the tail contacts' front corridor),
/// then the back the whole way: out to its own bus row -- north of every key
/// and of the whole chain -- across to the chain side, and down the outside
/// of the first column, where there is no neighbouring column to cross.
function route_led_head(
    ref: ContactRef,
    el: float,
    sgn: float,
    groups: BandGroup[],
    dst: Component,
    outward: float,
    net: string,
    out: Track[],
    vias: Via[],
) -> void {
    let c = ref.comp;
    let ways = c.pads.length() - 1;
    let pad = comp_to_global(c, ffc_pad_local(ref.pin, ways));
    let n = conn_normal(c);
    let w1 = along(pad, n, 2.2);
    out.push(seg(pad, w1, net));
    vias.push(Via { at: w1, net: net });
    let bl = bus_lane(c, ref.pin, el, sgn, groups);
    let l = along(pad, n, bl.off);
    out.push(back(w1, l, net));
    let r = Vec2 { x: l.x, y: bl.row };
    out.push(back(l, r, net));
    // Down the outside of the first column in the *column's* frame, not the
    // board's. The columns are splayed, so a plain vertical drop at the entry
    // point's x walks across the key frame as it climbs -- into the hotswap
    // pads on one hand and the transition lanes on the other -- while a line
    // parallel to the column holds its offset the whole way. That line cannot
    // reach the north row, which is up where the hull narrows into its corner,
    // so the run turns onto it on a diagonal from a point inboard of it.
    let p = led_key_pt(dst, Vec2 { x: outward * LED_TAIL_X(), y: LED_EXIT_Y() });
    let h = led_key_pt(dst, Vec2 { x: outward * LED_TAIL_X(), y: bl.row + LED_HEAD_JOIN_Y() - dst.y });
    let turn = Vec2 { x: h.x - outward * LED_HEAD_JOIN_X(), y: bl.row };
    out.push(back(r, turn, net));
    out.push(back(turn, h, net));
    out.push(back(h, p, net));
    let q = led_key_pt(dst, Vec2 { x: LED_DIN_ELBOW().x, y: LED_EXIT_Y() });
    out.push(back(p, q, net));
    route_din_stub(dst, q, net, out);
}

/// The chain's drop off its link contact, kept out of the pass-through lanes.
///
/// The lanes' x is set by the pod link and the contact's by the thumb link,
/// and on one hand the two land on top of each other -- the drop then runs
/// down the middle of the band, shorting every lane it crosses. Where that
/// happens it leans out to the far side of the band before diving, which is
/// the side the lanes are not coming from.
function led_link_drop(
    ref: ContactRef,
    el: float,
    sgn: float,
    groups: BandGroup[],
    slot: int,
    lanes: float[],
    net: string,
    out: Track[],
) -> Vec2 {
    let c = ref.comp;
    if (is_side_mounted(c) || lanes.length() == 0) {
        return conn_drop(c, ref.pin, el, sgn, groups, slot, net, out);
    }
    let pad = comp_to_global(c, ffc_pad_local(ref.pin, c.pads.length() - 1));
    let v = along(pad, conn_normal(c), via_standoff(slot));
    let close = lanes.filter((x) -> {
        (x - pad.x).abs() < LANE_CLEAR()
    });
    if (close.length() == 0) {
        out.push(seg(pad, v, net));
        return v;
    }
    let mid = lanes.reduce(
        (a, x) -> {
            a + x
        },
        0.0,
    )
        / (lanes.length() * 1.0);
    let far = if (pad.x > mid) {
        lanes.reduce(
            (a, x) -> {
                if (x > a) {
                    x
                } else {
                    a
                }
            },
            0.0 - 100000.0,
        )
            + LANE_CLEAR()
    } else {
        lanes.reduce(
            (a, x) -> {
                if (x < a) {
                    x
                } else {
                    a
                }
            },
            100000.0,
        )
            - LANE_CLEAR()
    };
    let lean = Vec2 { x: far, y: v.y };
    out.push(seg(pad, lean, net));
    lean
}

/// How far a drop stands off a lane it must not touch: past the lane's own
/// dive via, with room for the pour between them.
function LANE_CLEAR() -> float {
    1.8
}

/// The last LED's dout out to the ribbon, on the back.
///
/// It leaves the key field sideways -- away from the previous column, where
/// there is no next column and nothing to cross -- runs down past the
/// pass-through band, and only then turns in to the connector.
function route_led_tail(
    src: Component,
    ref: ContactRef,
    el: float,
    sgn: float,
    groups: BandGroup[],
    slot: int,
    outward: float,
    bottom_y: float,
    lanes: float[],
    net: string,
    out: Track[],
    vias: Via[],
) -> void {
    let v = led_link_drop(ref, el, sgn, groups, slot, lanes, net, out);
    let p0 = comp_to_global(src, LED_DOUT_PAD());
    // Which row it leaves on depends on which way out it goes, because the two
    // sides of a key are closed off at different depths. Out over the din side
    // the last hop's stub comes down to the elbow, and only the exit row is
    // south of it; out over the dout side the next socket's ground hook
    // reaches up past the exit row, and only the crossing row is north of it.
    // The footprints do not mirror, so which side that is depends on the hand.
    let row = if (outward > 0.0) {
        LED_EXIT_Y()
    } else {
        LED_UNDER_Y()
    };
    let p1 = led_key_pt(src, Vec2 { x: LED_DOUT_PAD().x, y: row });
    let p2 = led_key_pt(src, Vec2 { x: outward * LED_TAIL_X(), y: row });
    // Down the outside of the last column to the drop via's own row, then
    // straight across to it on the back -- south of the pass-through strip's
    // dive vias and north of the clip pocket, where nothing else runs.
    let p3 = Vec2 { x: p2.x, y: v.y };
    for (let e in [[p0, p1], [p1, p2], [p2, p3], [p3, v]]) {
        out.push(back(vec_at(e, 0), vec_at(e, 1), net));
    }
    vias.push(Via { at: v, net: net });
}

/// Which standoff slot the chain's two link vias claim.
///
/// Behind the pass-through band, not in front of it. The band runs across the
/// back between the two connectors, and the chain's two ends have to get past
/// it to the key field. The connectors face away from the keys, so their
/// standoffs run back toward the key field and the deepest slot is the one
/// nearest it -- a link via anywhere shallower crosses every track in the band.
function led_link_slot(b: Board, i: int) -> int {
    find_passthroughs(
        b.components.filter((c) -> {
            is_connector(c)
        }),
    )
        .length()
        + 1
        + i
}

function route_leds(
    b: Board,
    m: Module,
    f: Features,
    bottom_y: float,
    el: float,
    sgn: float,
    groups: BandGroup[],
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

    let thumb = b.id.starts_with("thumb");

    let first = leds.at(0) ?? no_component();
    let head = pad_net(first, "4");

    if let t: ContactRef = find_contact_ref(conns, head) {
        if (thumb) {
            route_led_thumb_head(t, el, sgn, groups, first, head, out, vias);
        } else {
            route_led_head(t, el, sgn, groups, first, sign_away(first.x, mid), head, out, vias);
        }
    }

    let j = 0;
    while (j < n - 1) {
        let src = leds.at(j) ?? no_component();
        let dst = leds.at(j + 1) ?? no_component();
        let net = pad_net(src, "2");
        if (thumb) {
            route_led_thumb_hop(src, dst, net, out, vias);
        } else if ((cols.at(j) ?? "") == (cols.at(j + 1) ?? "")) {
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
    if let t: ContactRef = find_contact_ref(conns, tail) {
        route_led_tail(
            last,
            t,
            el,
            sgn,
            groups,
            led_link_slot(b, 1),
            sign_away(last.x, mid),
            bottom_y,
            pass_lane_xs(conns),
            tail,
            out,
            vias,
        );
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
function route_supply_vias(
    b: Board,
    f: Features,
    el: float,
    sgn: float,
    groups: BandGroup[],
    vias: Via[],
    out: Track[],
) -> void {
    if (!f.per_key_leds) {
        return;
    }
    let k = 0;
    for (let c in b.components) {
        if (is_connector(c)) {
            let i = 1;
            for (let p in c.pads) {
                if (p.pad != "MP") {
                    if (p.net == LED_VDD_NET()) {
                        // The back pour IS this rail, so the drop only has to
                        // reach a via. Behind a head-on connector the first
                        // couple of millimetres belong to the fan band's rows
                        // and tuck vias (slot 2 clears them); a side-mounted
                        // link dives straight off the contact, before the
                        // thumb pass lanes cross its corridor.
                        if (is_side_mounted(c)) {
                            let ways2 = c.pads.length() - 1;
                            let pad2 = comp_to_global(c, ffc_pad_local(i, ways2));
                            let v2 = along(pad2, conn_normal(c), 2.2);
                            out.push(seg(pad2, v2, p.net));
                            vias.push(Via { at: v2, net: p.net });
                        } else {
                            vias.push(
                                Via {
                                    at: conn_drop(c, i, el, sgn, groups, 2, p.net, out),
                                    net: p.net,
                                },
                            );
                        }
                        k = k + 1;
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
            // On a thumb board the stitch stays beside the socket's ground
            // pad: the fan rows cross the near key's footprint on the back,
            // and the finger boards' longer stub, swung by the key's splay,
            // can end up running straight through them.
            let spot = if (b.id.starts_with("thumb")) {
                Vec2 { x: 0.0 - 9.2, y: 0.0 - 2.54 }
            } else {
                MX_GND_VIA()
            };
            let v = comp_to_global(c, spot);
            out.push(back(comp_to_global(c, MX_GND_PAD()), v, "GND"));
            vias.push(Via { at: v, net: "GND" });
        }
        if (is_led(c) && f.per_key_leds) {
            // On a thumb board the key-frame drop swings with the splay,
            // straight into the hop corridors; a short hook off the ground
            // pad in the LED's own frame stays clear of everything the hops
            // and the din approach use.
            let v = if (b.id.starts_with("thumb")) {
                comp_to_global(c, Vec2 { x: 2.73, y: 0.0 - 2.9 })
            } else {
                led_key_pt(c, LED_GND_VIA())
            };
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
