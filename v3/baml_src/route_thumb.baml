// Routing the cluster.
//
// Six nets on eleven pads, and every one of them has to get past a switch
// socket. The plan is one sentence long: everything runs in lanes across the
// cluster's own frame, and the two things that have to cross each other cross
// on different layers.
//
// Reading the near island north to south:
//
//   the connector, contacts facing the fingers
//   the FAN BAND      -- three row lines peeling off behind the connector
//   the switches
//   the MAIN BAND     -- the column line, then the three row lines again,
//                        ordered so each turns off without crossing the rest
//   the via row       -- where each row line drops to the back
//   the diodes
//   the SOUTH LANE    -- the switch-to-diode hops, round the outside
//
// and one corridor running north to south between the first two keys, which is
// the only place on the island clear on both layers for the full depth of the
// board.
//
// The order the lanes sit in is forced, not chosen. A lane peeling off early
// must lie on the side everything else is leaving from, or the ones still
// running cross it -- so in the main band the row that stops first (the near
// key's) is the deepest, and in the fan band the contact furthest east takes
// the shallowest lane. Between them the corridor slots have to run in the same
// order as the contacts do. That fixes the connector's pinout as surely as the
// cable does, and `link_pinout` already delivers it.

/// A path in the cluster frame, as copper.
function thumb_run(f: Frame, pts: Vec2[], layer: string, net: string) -> Copper {
    run_copper(
        pts.map((q) -> {
            frame_to_kicad(f, q)
        }),
        layer,
        net,
    )
}

function thumb_via(f: Frame, q: Vec2, net: string) -> Copper {
    via_copper(frame_to_kicad(f, q), net)
}

/// The link connector on a thumb board.
function thumb_link_of(b: Board) -> Component? {
    thumb_link_of_comps(b.components)
}

function thumb_link_of_comps(cs: Component[]) -> Component? {
    cs.find((c) -> {
        c.ref.starts_with("J")
    })
}

/// A contact's position in the cluster frame.
function thumb_contact(f: Frame, c: Component, net: string) -> Vec2 {
    into_frame(f, to_kicad(contact_at(c, contact_of(c, net))))
}

/// How far a seam-crossing conductor stands off the island edge it leaves from.
///
/// The two of them leave on different layers but from the same few millimetres
/// of board, and one of them ends in a via; a via's pad is what sets the step.
function thumb_seam_step() -> float {
    FLEX_VIA_PAD() / 2.0 + FLEX_TRACE_SPACE() + FLEX_TRACE_W() / 2.0 + 0.1
}

/// The centreline of the seam's neck, in the cluster frame.
function thumb_neck_path(a: Strip, c: Strip) -> Vec2[] {
    let y0 = strip_neck_y(a);
    let y1 = strip_neck_y(c);
    neck_centreline(
        a.cx + a.half_w,
        c.cx - c.half_w,
        y0,
        neck_leg_pair(neck_span(a, c), a.neck_len, y0, y1),
        NECK_SAMPLES(),
    )
}

// ----------------------------------------------------------------- one key

/// One key's local copper: the hop from its switch to its diode, and the row
/// line that reaches its diode's cathode.
///
/// The hop is the only thing that crosses the band on the back, and it does it
/// the long way round -- out of pad 2 along its own row until it is clear of
/// the socket, south past the diodes, and back up into the anode -- so it never
/// meets a row line's via or the stub below it. On a key whose pad-2 ray comes
/// out of the NORTH of the footprint it takes the shorter way round the side
/// first, because going straight south from there would cross the drills.
function route_thumb_key(
    b: Board,
    f: Frame,
    ks: PlacedKey[],
    link: Component,
    k: PlacedKey,
    i: int,
) -> Copper throws baml.errors.InvalidArgument {
    let swd = switch_diode_net(k);
    let out = no_copper();
    if let sc: Component = find_by_net(b.components, "SW", swd) {
        if let dc: Component = find_by_net(b.components, "D", swd) {
            let p2 = frame_pad(f, sc, MX_GND_PAD());
            let esc = thumb_pad2_escape(f, k);
            let anode = frame_pad(f, dc, Vec2 { x: 1.65, y: 0.0 });
            let sv = thumb_south_v(f, ks);
            let box = box_grow(key_frame_box(f, k), thumb_escape_clear());
            // Round the side the DIODE is on: the shorter way, and the way
            // that keeps the leg along the hop lane clear of this key's own
            // column stub, which comes up on the far side.
            let turn = if (esc.y >= box.max.y) {
                if (anode.x < (box.min.x + box.max.x) / 2.0) {
                    box.min.x
                } else {
                    box.max.x
                }
            } else {
                esc.x
            };
            out
                = add_copper(
                    out,
                    thumb_run(
                        f,
                        [
                            p2,
                            esc,
                            Vec2 { x: turn, y: esc.y },
                            Vec2 { x: turn, y: sv },
                            Vec2 { x: anode.x, y: sv },
                            anode,
                        ],
                        "B.Cu",
                        swd,
                    ),
                );
            out = add_copper(out, route_thumb_row(b, f, ks, link, k, i, dc));
        }
    }
    out
}

/// One row line, contact to cathode.
///
/// Down the fan band behind the connector, down its slot in the corridor, east
/// or west along its own lane in the main band, and down to a via beside its
/// diode. All of it on the front: the back down here belongs to the hops and to
/// the column line, and the two layers only meet at the via. The far key's row
/// is the one that also has to cross the seam, which it does through the neck.
function route_thumb_row(
    b: Board,
    f: Frame,
    ks: PlacedKey[],
    link: Component,
    k: PlacedKey,
    i: int,
    dc: Component,
) -> Copper throws baml.errors.InvalidArgument {
    let net = row_net(k);
    let uc = thumb_link_stand_u(f, ks);
    let ways = link_ways(link);
    let c = thumb_contact(f, link, net);
    let j = thumb_fan_lanes() - 1 - i;
    let fv = thumb_fan_v(f, ks, uc, ways, j);
    let cu = thumb_corridor_u(f, ks, i + 1);
    let mv = thumb_lane_v(f, ks, j);
    let cath = frame_pad(f, dc, Vec2 { x: 0.0 - 1.65, y: 0.0 });
    let vv = thumb_via_v(f, ks);

    let out = thumb_run(f, [c, Vec2 { x: c.x, y: fv }, Vec2 { x: cu, y: fv }, Vec2 { x: cu, y: mv }], "F.Cu", net);
    // Across the seam first, if the diode is on the far island.
    let seam = route_thumb_row_seam(b, f, k, mv, cu, net);
    out = add_copper(out, seam.cu);
    out
        = add_copper(
            out,
            thumb_run(f, [seam.at, Vec2 { x: cath.x, y: mv }, Vec2 { x: cath.x, y: vv }], "F.Cu", net),
        );
    out = add_copper(out, thumb_via(f, Vec2 { x: cath.x, y: vv }, net));
    add_copper(out, thumb_run(f, [Vec2 { x: cath.x, y: vv }, cath], "B.Cu", net))
}

/// A row line's crossing of the seam, if it has one.
///
/// `at` is where the line rejoins its lane on the far side, so the caller can
/// carry on east from there; on the near island it comes back unchanged.
class SeamRun {
    at: Vec2,
    cu: Copper,
}

function route_thumb_row_seam(
    b: Board,
    f: Frame,
    k: PlacedKey,
    mv: float,
    cu: float,
    net: string,
) -> SeamRun throws baml.errors.InvalidArgument {
    let none = SeamRun { at: Vec2 { x: cu, y: mv }, cu: no_copper() };
    if (thumb_island_of(k.column) == 0) {
        return none;
    }
    let ss = thumb_islands(module_of_board(b), flex_defaults());
    let a = strip_at(ss, 0);
    let c = strip_at(ss, 1);
    let step = thumb_seam_step();
    let xa = a.cx + a.half_w;
    let xb = c.cx - c.half_w;
    let ny = strip_neck_y(a);
    // Down to the neck on the near side and back up on the far side, on the
    // front. The column line makes the same crossing on the back, at the same
    // centreline; the neck is only two conductors wide and this is what those
    // two are.
    let out = thumb_run(
        f,
        [
            Vec2 { x: cu, y: mv },
            Vec2 { x: xa - step, y: mv },
            Vec2 { x: xa - step, y: ny },
            Vec2 { x: xa, y: ny },
        ],
        "F.Cu",
        net,
    );
    out = add_copper(out, thumb_run(f, thumb_neck_path(a, c), "F.Cu", net));
    out
        = add_copper(
            out,
            thumb_run(
                f,
                [Vec2 { x: xb, y: ny }, Vec2 { x: xb + step, y: ny }, Vec2 { x: xb + step, y: mv }],
                "F.Cu",
                net,
            ),
        );
    SeamRun { at: Vec2 { x: xb + step, y: mv }, cu: out }
}

/// The module a board was built from.
function module_of_board(b: Board) -> Module throws baml.errors.InvalidArgument {
    find_module(partition_modules(layout_keys(features_flex())), b.id)
}

/// The connector's u, which several lanes are measured from.
function thumb_link_stand_u(f: Frame, ks: PlacedKey[]) -> float {
    thumb_key_u(f, ks, 0)
}

// -------------------------------------------------------------- the column

/// The column line: one contact, three socket pads, two islands.
///
/// It leaves the contact row sideways, past the end of the connector, drops to
/// the back, and never leaves it -- that is where the socket pads are, and the
/// front over the same ground is spoken for by the fan band, the pour and the
/// row lanes.
///
/// On each island it is a ladder: an over band north of the switches, a lane
/// south of everything, and one rung joining them. Each key hangs off whichever
/// rail its approach ray points at -- see `thumb_pad1_from_north` -- and on a
/// cluster this splayed the three keys do not agree. The south lane is also
/// what carries the line to the seam, because the neck is the only way across
/// and the neck is at the bottom of the board.
function route_thumb_col(
    b: Board,
    f: Frame,
    ks: PlacedKey[],
    link: Component,
) -> Copper throws baml.errors.InvalidArgument {
    let net = thumb_col_net(ks);
    let c = thumb_contact(f, link, net);
    let uw = thumb_col_exit_u(f, link, c);
    let cv = thumb_col_v(f, ks);
    let ss = thumb_islands(module_of_board(b), flex_defaults());
    let a = strip_at(ss, 0);
    let d = strip_at(ss, 1);
    let step = thumb_seam_step();
    let ny = strip_neck_y(a);

    // Out along the contact row, past the connector, and down to the back.
    let out = thumb_run(f, [c, Vec2 { x: uw, y: c.y }], "F.Cu", net);
    out = add_copper(out, thumb_via(f, Vec2 { x: uw, y: c.y }, net));

    // The near island: the rung is the corridor between the first two keys,
    // and the connector's own drop joins the over band at the top of it.
    out
        = add_copper(
            out,
            route_thumb_col_island(
                b,
                f,
                ks,
                0,
                thumb_corridor_u(f, ks, 0),
                cv,
                [Vec2 { x: uw, y: c.y }],
                [Vec2 { x: a.cx + a.half_w - step, y: cv }],
            ),
        );
    // Across the seam, on the back at the neck's centreline. The far key's row
    // makes the same crossing on the front; those are the two conductors the
    // neck is cut for.
    out
        = add_copper(
            out,
            thumb_run(
                f,
                [
                    Vec2 { x: a.cx + a.half_w - step, y: cv },
                    Vec2 { x: a.cx + a.half_w - step, y: ny },
                    Vec2 { x: a.cx + a.half_w, y: ny },
                ],
                "B.Cu",
                net,
            ),
        );
    out = add_copper(out, thumb_run(f, thumb_neck_path(a, d), "B.Cu", net));
    out
        = add_copper(
            out,
            thumb_run(
                f,
                [
                    Vec2 { x: d.cx - d.half_w, y: ny },
                    Vec2 { x: d.cx - d.half_w + step, y: ny },
                    Vec2 { x: d.cx - d.half_w + step, y: cv },
                ],
                "B.Cu",
                net,
            ),
        );
    // The far island: the rung is a climb up its outboard side.
    add_copper(
        out,
        route_thumb_col_island(
            b,
            f,
            ks,
            1,
            thumb_climb_u(f, thumb_island_keys(ks, 1)),
            cv,
            [],
            [Vec2 { x: d.cx - d.half_w + step, y: cv }],
        ),
    )
}

/// One island's share of the column line: the two rails, the rung between them,
/// and a stub onto each key's column pad.
///
/// `north_ends` and `south_ends` are points the caller has already put copper
/// at -- the connector's drop, the two sides of the seam -- so each rail is
/// drawn wide enough to reach the ones that belong to it. A rail with nothing
/// on it is not drawn at all, and neither is the rung: an island whose keys all
/// face south is reached along the lane alone.
function route_thumb_col_island(
    b: Board,
    f: Frame,
    ks: PlacedKey[],
    island: int,
    rung_u: float,
    cv: float,
    north_ends: Vec2[],
    south_ends: Vec2[],
) -> Copper {
    let mine = thumb_island_keys(ks, island);
    let ov = thumb_over_v(f, mine);
    let net = thumb_col_net(ks);
    let out = no_copper();
    let north: float[] = [];
    let south: float[] = [];
    for (let e in north_ends) {
        north.push(e.x);
        out = add_copper(out, thumb_run(f, [e, Vec2 { x: e.x, y: ov }], "B.Cu", net));
    }
    for (let e in south_ends) {
        south.push(e.x);
    }
    for (let k in mine) {
        if let sc: Component = find_by_net(b.components, "SW", switch_diode_net(k)) {
            let app = thumb_pad1_escape(f, k);
            let p1 = frame_pad(f, sc, MX_SIGNAL_PAD());
            let north_fed = thumb_pad1_from_north(f, k);
            let rail = if (north_fed) {
                ov
            } else {
                cv
            };
            if (north_fed) {
                north.push(app.x);
            } else {
                south.push(app.x);
            }
            out = add_copper(out, thumb_run(f, [Vec2 { x: app.x, y: rail }, app, p1], "B.Cu", net));
        }
    }
    // The rung stands on both rails, so it only counts toward a rail's extent
    // once the other rail exists to justify it.
    if (north.length() > 0) {
        north.push(rung_u);
        south.push(rung_u);
        out
            = add_copper(
                out,
                thumb_run(f, [Vec2 { x: rung_u, y: ov }, Vec2 { x: rung_u, y: cv }], "B.Cu", net),
            );
    }
    add_copper(add_copper(out, span_run(f, north, ov, net)), span_run(f, south, cv, net))
}

/// One rail: a straight run at `v` covering every u hung off it.
function span_run(f: Frame, us: float[], v: float, net: string) -> Copper {
    if (us.length() < 2) {
        return no_copper();
    }
    let lo = us.reduce(
        (a, u) -> {
            if (u < a) {
                u
            } else {
                a
            }
        },
        1000000.0,
    );
    let hi = us.reduce(
        (a, u) -> {
            if (u > a) {
                u
            } else {
                a
            }
        },
        0.0 - 1000000.0,
    );
    thumb_run(f, [Vec2 { x: lo, y: v }, Vec2 { x: hi, y: v }], "B.Cu", net)
}

/// The cluster's single column net.
function thumb_col_net(ks: PlacedKey[]) -> string {
    if let k: PlacedKey = ks.at(0) {
        return col_net(k);
    }
    ""
}

/// Where the column line leaves the contact row.
///
/// Sideways, past the end of the connector, because it is the outermost contact
/// on the side away from ground and everything between it and the keys is
/// either the pour or the fan band. Past the mounting peg as well: that is the
/// widest thing on the part.
function thumb_col_exit_u(f: Frame, link: Component, c: Vec2) -> float {
    let reach = ffc_body_half(link_ways(link)) + FLEX_TRACE_SPACE() + FLEX_TRACE_W() / 2.0;
    let o = into_frame(f, to_kicad(Vec2 { x: link.x, y: link.y }));
    if (c.x < o.x) {
        o.x - reach
    } else {
        o.x + reach
    }
}

// -------------------------------------------------------------- the ground

/// Ground: a pour over the GND end of the connector, and one hop to the peg at
/// the other end.
///
/// The pour can only take one end -- see `thumb_zones` -- so the far mounting
/// peg reaches it on the back, along the pegs' own row, where the only other
/// thing is the column line and that is south of here.
function route_thumb_ground(f: Frame, ks: PlacedKey[], link: Component) -> Copper {
    let half = ffc_mp_x(link_ways(link));
    let w = frame_pad(f, link, Vec2 { x: 0.0 - half, y: FFC_MP_Y() });
    let e = frame_pad(f, link, Vec2 { x: half, y: FFC_MP_Y() });
    let g = thumb_contact(f, link, "GND");
    let o = into_frame(f, to_kicad(Vec2 { x: link.x, y: link.y }));
    // The peg on the ground contact's own side, and the one the fan cuts off.
    let near = if ((g.x > o.x) == (w.x > o.x)) {
        w
    } else {
        e
    };
    let far = if ((g.x > o.x) == (w.x > o.x)) {
        e
    } else {
        w
    };
    let up = Vec2 { x: near.x, y: near.y + FFC_MP_Y() + FLEX_VIA_PAD() };
    let out = thumb_run(f, [g, Vec2 { x: g.x, y: near.y }, near], "F.Cu", "GND");
    out = add_copper(out, thumb_run(f, [near, up], "F.Cu", "GND"));
    out = add_copper(out, thumb_via(f, up, "GND"));
    out = add_copper(out, thumb_run(f, [up, Vec2 { x: far.x, y: up.y }, far], "B.Cu", "GND"));
    add_copper(out, thumb_via(f, far, "GND"))
}

/// Mounting-peg pads on the horizontal FFC part, in footprint-local
/// coordinates: `smd rect` either side of the body, front side only.
function ffc_mp_x(ways: int) -> float {
    (ways * 1.0) / 2.0 + 2.3
}

function FFC_MP_Y() -> float {
    1.79
}

// --------------------------------------------------------------- the board

function route_thumb(b: Board, m: Module) -> Copper throws baml.errors.InvalidArgument {
    let f = thumb_frame(m);
    let ks = thumb_keys(m);
    let out = no_copper();
    if let link: Component = thumb_link_of(b) {
        let i = 0;
        for (let k in ks) {
            out = add_copper(out, route_thumb_key(b, f, ks, link, k, i));
            i = i + 1;
        }
        out = add_copper(out, route_thumb_col(b, f, ks, link));
        out = add_copper(out, route_thumb_ground(f, ks, link));
    }
    out
}
