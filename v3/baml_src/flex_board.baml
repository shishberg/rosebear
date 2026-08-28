// Assembling a segmented board: strips, cuts, parts and connectors.
//
// `flex.baml` is the geometry -- where a strip is, where its hinges fall, what
// shape a neck is. This is where that geometry becomes a `Board`: the ring
// becomes the outline, the hinge slots become interior Edge.Cuts contours, and
// the switches, diodes and FFC connectors get placed on it.
//
// The contract inverts from the rigid boards. There, `route_board` grows the
// outline around whatever copper the router laid down (`enclose`). Here the
// outline is authoritative and the router has to stay inside it -- growing a
// hull around the traces would swallow the gaps between the strips and turn
// the board back into a blob.

/// Extra strip length past the last key, to stand a connector on.
///
/// A connector is a rigid part and cannot cross a hinge, so it goes in the
/// tail beyond the outermost key where the strip is continuous. Long enough
/// for the widest link plus a margin either side; `a connector fits the strip
/// it stands on` checks it against the derived ribbon widths rather than
/// trusting this number.
function FLEX_TAIL() -> float {
    34.0
}

/// Clearance from the end of a tail to the connector body.
function FLEX_TAIL_MARGIN() -> float {
    2.5
}

/// Which column strip a link's connector stands on.
///
/// Both of them stand on the inboard-most column, stacked along its tail. They
/// used to sit on neighbouring strips, which is tidier to look at and wrong to
/// route: the thumb link's nets all arrive from the pod link, so putting the
/// two on different strips sends four conductors back out across a neck and
/// then in again. Named rather than indexed: `strips_of` returns west to east,
/// which is a different end of the list for each hand, and the answer is not.
function link_column(from_pod: bool) -> string {
    let cols = COLUMN_ORDER();
    cols.at(cols.length() - 1) ?? "inner"
}

/// Does this strip carry a connector, and so need a tail?
function strip_has_link(col: string) -> bool {
    col == link_column(true) || col == link_column(false)
}

/// A module's strips, with tails under the strips that carry connectors.
///
/// Ergogen coordinates, y up -- so the tail extends `y0` DOWN, which is the
/// inboard, cluster-facing end of the column once `to_kicad` flips it.
function flex_strips(m: Module, w: Well, p: FlexParams) -> Strip[] {
    strips_of(m.keys, w, p).map((s) -> {
        Strip {
            column: s.column,
            cx: s.cx,
            half_w: s.half_w,
            y0: if (strip_has_link(s.column)) {
                s.y0 - FLEX_TAIL()
            } else {
                s.y0
            },
            y1: s.y1,
            key_ys: s.key_ys,
        }
    })
}

function find_strip(ss: Strip[], col: string) -> Strip throws baml.errors.InvalidArgument {
    ss.find((s) -> {
        s.column == col
    })
        ?? throw baml.errors.InvalidArgument { message: `no strip for column '${col}'` }
}

// ------------------------------------------------------------------ contours

/// A polygon in ergogen coordinates, as KiCad sees it.
function to_kicad_poly(poly: Vec2[]) -> Vec2[] {
    poly.map((q) -> {
        to_kicad(q)
    })
}

/// How finely each of a neck's four turns is sampled into line segments.
///
/// Edge.Cuts has arcs, but emitting them would mean a second primitive in
/// `edge_cuts` and a second uuid scheme; at this density the chord error on a
/// 1.2mm turn is under a micron, which is below what the board file can even
/// express.
function NECK_SAMPLES() -> int {
    24
}

/// Conductors that have to get across one hinge row. Sets the ligament count,
/// and so the size of every hinge cut.
function flex_hinge_traces() -> int {
    strip_hinge_traces(MATRIX_ROWS().length())
}

/// Conductors crossing the busiest neck. Sets every neck's width.
///
/// One width for all of them rather than one per gap: the difference is a
/// couple of tenths of a millimetre and a neck is the last place to want two
/// numbers that look alike.
function flex_neck_traces(m: Module) -> int {
    let n = 0;
    let i = 0;
    while (i + 1 < COLUMN_ORDER().length()) {
        let t = matrix_neck_traces(m.keys, i);
        if (t > n) {
            n = t;
        }
        i = i + 1;
    }
    n
}

/// The board's single closed outline, in KiCad coordinates.
function flex_outline(ss: Strip[], w: Well, p: FlexParams, m: Module) -> Vec2[] {
    to_kicad_poly(flex_ring(ss, w, p, flex_neck_traces(m), NECK_SAMPLES()))
}

/// Every interior contour on the board: the hinge slots, in KiCad coordinates.
function flex_cuts(ss: Strip[], w: Well, p: FlexParams) -> Vec2[][] {
    let out: Vec2[][] = [];
    for (let s in ss) {
        for (let poly in strip_hinge_cuts(s, w, p)) {
            out.push(to_kicad_poly(poly));
        }
    }
    out
}

// ---------------------------------------------------------------- connectors

/// Where a link connector stands on its strip, and which way it faces.
///
/// The pod link is side-mounted: contacts inboard, body lying ALONG the strip,
/// so a wide connector needs tail length rather than strip width -- 17mm of
/// board for an 11-way part, against a strip only 16.5mm across. The thumb
/// link is narrow enough to sit across the strip and points at the cluster,
/// which is off the inboard end.
class LinkStand {
    at: Vec2,
    r: float,
}

function link_stand(s: Strip, hand: string, from_pod: bool, ways: int) -> LinkStand {
    // Toward the pod: the right of the left half, the left of the right half.
    let inboard = if (hand == "r") {
        0.0 - 1.0
    } else {
        1.0
    };
    // The tail's outer end, in KiCad coordinates -- ergogen y0 is the far end
    // of the column, which the flip puts at the bottom of the board.
    let end = to_kicad(Vec2 { x: s.cx, y: s.y0 }).y;
    // The thumb link takes the very end of the tail; the pod link stacks north
    // of it with a margin between the two bodies.
    let thumb_y = end - FLEX_TAIL_MARGIN() - FFC_BODY_FRONT();
    if (from_pod) {
        // Side-mounted: contacts inboard, body lying ALONG the strip, so a
        // wide connector needs tail length rather than strip width. 270 points
        // the contacts east, 90 west; `ffc_pad_local` puts them at local -y.
        LinkStand {
            at: Vec2 {
                x: s.cx,
                y: thumb_y - FFC_BODY_BACK() - FLEX_TAIL_MARGIN() - ffc_body_half(ways),
            },
            r: if (inboard > 0.0) {
                270.0
            } else {
                90.0
            },
        }
    } else {
        // Contacts pointing off the end of the tail, at the cluster below.
        LinkStand { at: Vec2 { x: s.cx, y: thumb_y }, r: 180.0 }
    }
}

// --------------------------------------------------------------------- board

/// One half's finger board, cut into strips, placed and routed.
function flex_board(
    m: Module,
    ribbons: Ribbon[],
    f: Features,
) -> Board throws baml.errors.InvalidArgument {
    let w = ROSEBEAR_WELL();
    let p = flex_defaults();
    let ss = flex_strips(m, w, p);

    let comps: Component[] = [];
    let ordered = led_chain(m);
    let i = 1;
    for (let k in ordered) {
        comps.push(switch_component(k, i, f));
        comps.push(diode_component(k, i));
        i = i + 1;
    }

    let incoming = ribbons.filter((r) -> {
        r.to_module == m.id
    });
    let outgoing = ribbons.filter((r) -> {
        r.from_module == m.id
    });
    let ci = 1;
    for (let r in incoming.concat(outgoing)) {
        let from_pod = r.from_module == "pod";
        let s = find_strip(ss, link_column(from_pod));
        let stand = link_stand(s, m.hand, from_pod, r.signals.length());
        // The from-end of a ribbon assigns its pads from the reversed list --
        // see `from_end_signals`.
        let pad_sigs = if (r.from_module == m.id) {
            from_end_signals(r.signals)
        } else {
            r.signals
        };
        comps.push(connector_component(`J${ci}`, pad_sigs, stand.at, stand.r));
        ci = ci + 1;
    }

    let outline = flex_outline(ss, w, p, m);
    let placed = Board {
        id: m.id,
        components: comps,
        outline: outline,
        cuts: flex_cuts(ss, w, p),
        tracks: [],
        vias: [],
        zones: [],
    };
    let cu = route_flex(placed, m, ss, w);
    Board {
        id: placed.id,
        components: placed.components,
        outline: placed.outline,
        cuts: placed.cuts,
        tracks: cu.tracks,
        vias: cu.vias,
        zones: board_zones(outline, f),
    }
}

/// Every board of the segmented variant.
///
/// The thumb clusters are still built as rigid boards here; #7 segments them.
function build_flex_boards(f: Features) -> Board[] throws baml.errors.InvalidArgument {
    let mods = partition_modules(layout_keys(f));
    let ribbons = build_ribbons(mods, f);
    let boards: Board[] = [];
    for (let m in mods) {
        if (m.id.starts_with("thumb")) {
            boards.push(build_board(m, ribbons, f));
        } else {
            boards.push(flex_board(m, ribbons, f));
        }
    }
    boards.push(build_pod_board(ribbons, f));
    boards
}
