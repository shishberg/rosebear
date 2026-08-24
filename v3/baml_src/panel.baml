// All five boards in one file, in the positions they take on the desk.
//
// Not a panel for fabrication -- see the README; panelization is a separate
// job. This is a viewing aid, and it exists because a board that is the wrong
// size, or a connector pointing at nothing, is obvious in the assembly and
// invisible one board at a time. Each hand keeps its own internal coordinates,
// which come from one layout and so are already in their true relative
// positions; the pod goes between the halves, and the halves slide apart just
// enough to make room for it.
//
// Shared net names -- GND, the thumb pass-throughs, the LED rails -- meet
// across boards here, so KiCad's ratsnest draws the ribbons that would
// otherwise be invisible.

class Box {
    min: Vec2,
    max: Vec2,
}

function shift(p: Vec2, d: Vec2) -> Vec2 {
    Vec2 { x: p.x + d.x, y: p.y + d.y }
}

function board_box(b: Board) -> Box {
    let big = 1000000.0;
    Box {
        min: Vec2 {
            x: b.outline.reduce(
                (a, p) -> {
                    if (p.x < a) {
                        p.x
                    } else {
                        a
                    }
                },
                big,
            ),
            y: b.outline.reduce(
                (a, p) -> {
                    if (p.y < a) {
                        p.y
                    } else {
                        a
                    }
                },
                big,
            ),
        },
        max: Vec2 {
            x: b.outline.reduce(
                (a, p) -> {
                    if (p.x > a) {
                        p.x
                    } else {
                        a
                    }
                },
                0.0 - big,
            ),
            y: b.outline.reduce(
                (a, p) -> {
                    if (p.y > a) {
                        p.y
                    } else {
                        a
                    }
                },
                0.0 - big,
            ),
        },
    }
}

function union_box(bs: Board[]) -> Box {
    let big = 1000000.0;
    let boxes = bs.map((b) -> {
        board_box(b)
    });
    Box {
        min: Vec2 {
            x: boxes.reduce(
                (a, k) -> {
                    if (k.min.x < a) {
                        k.min.x
                    } else {
                        a
                    }
                },
                big,
            ),
            y: boxes.reduce(
                (a, k) -> {
                    if (k.min.y < a) {
                        k.min.y
                    } else {
                        a
                    }
                },
                big,
            ),
        },
        max: Vec2 {
            x: boxes.reduce(
                (a, k) -> {
                    if (k.max.x > a) {
                        k.max.x
                    } else {
                        a
                    }
                },
                0.0 - big,
            ),
            y: boxes.reduce(
                (a, k) -> {
                    if (k.max.y > a) {
                        k.max.y
                    } else {
                        a
                    }
                },
                0.0 - big,
            ),
        },
    }
}

/// Clearance between the key boards and the pod in the combined view.
function PANEL_GAP() -> float {
    15.0
}

/// Move a whole board, copper and all.
///
/// Refs are prefixed with the board's id because five boards' worth of `SW1`
/// in one file is five different parts with one name.
function translate_board(b: Board, d: Vec2) -> Board {
    Board {
        id: b.id,
        components: b.components.map((c) -> {
            Component {
                ref: `${b.id}-${c.ref}`,
                footprint: c.footprint,
                x: c.x + d.x,
                y: c.y + d.y,
                r: c.r,
                layer: c.layer,
                pads: c.pads,
            }
        }),
        outline: b.outline.map((p) -> {
            shift(p, d)
        }),
        tracks: b.tracks.map((t) -> {
            Track {
                start: shift(t.start, d),
                end: shift(t.end, d),
                width: t.width,
                layer: t.layer,
                net: t.net,
            }
        }),
        vias: b.vias.map((v) -> {
            Via { at: shift(v.at, d), net: v.net }
        }),
        zones: b.zones.map((z) -> {
            Zone {
                net: z.net,
                layer: z.layer,
                outline: z.outline.map((p) -> {
                    shift(p, d)
                }),
            }
        }),
    }
}

/// How far above the halves' vertical centre the pod sits. A little high
/// reads right -- the ribbons leave the finger boards above their midline --
/// but not so high it rides up past the key fields.
function POD_LIFT() -> float {
    8.0
}

/// The five boards laid out as they sit in use.
///
/// The pod sits *between* the halves, level with them and a touch high. Each
/// hand keeps its own internal geometry -- finger_l already knows where
/// thumb_l is -- but the two halves slide apart symmetrically when the pod
/// needs more room than the layout leaves between them.
function panel_boards(bs: Board[]) -> Board[] {
    let lefts = bs.filter((b) -> {
        b.id.ends_with("_l")
    });
    let rights = bs.filter((b) -> {
        b.id.ends_with("_r")
    });
    let lb = union_box(lefts);
    let rb = union_box(rights);
    let pod = bs.find((b) -> {
        b.id == "pod"
    });
    let pb = if let p: Board = pod {
        board_box(p)
    } else {
        Box { min: Vec2 { x: 0.0, y: 0.0 }, max: Vec2 { x: 0.0, y: 0.0 } }
    };
    let need = (pb.max.x - pb.min.x) + 2.0 * PANEL_GAP();
    let gap = rb.min.x - lb.max.x;
    let spread = if (need > gap) {
        (need - gap) / 2.0
    } else {
        0.0
    };
    let mid_x = (lb.max.x + rb.min.x) / 2.0;
    let mid_y = (
        if (lb.min.y < rb.min.y) {
            lb.min.y
        } else {
            rb.min.y
        }
            + if (lb.max.y > rb.max.y) {
                lb.max.y
            } else {
                rb.max.y
            }
    )
        / 2.0;
    bs.map((b) -> {
        if (b.id == "pod") {
            translate_board(
                b,
                Vec2 {
                    x: mid_x - (pb.min.x + pb.max.x) / 2.0,
                    y: mid_y - POD_LIFT() - (pb.min.y + pb.max.y) / 2.0,
                },
            )
        } else if (b.id.ends_with("_l")) {
            translate_board(b, Vec2 { x: 0.0 - spread, y: 0.0 })
        } else {
            translate_board(b, Vec2 { x: spread, y: 0.0 })
        }
    })
}

/// One board carrying every board's copper, for the emitter's net table.
function merge_boards(bs: Board[]) -> Board {
    let out = Board { id: "all", components: [], outline: [], tracks: [], vias: [], zones: [] };
    for (let b in bs) {
        for (let c in b.components) {
            out.components.push(c);
        }
        for (let t in b.tracks) {
            out.tracks.push(t);
        }
        for (let v in b.vias) {
            out.vias.push(v);
        }
        for (let z in b.zones) {
            out.zones.push(z);
        }
    }
    out
}
