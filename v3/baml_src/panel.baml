// All five boards in one file, in the positions they take on the desk.
//
// Not a panel for fabrication -- see the README; panelization is a separate
// job. This is a viewing aid, and it exists because a board that is the wrong
// size, or a connector pointing at nothing, is obvious in the assembly and
// invisible one board at a time. The four key boards keep their own
// coordinates, which already come from one layout and so are already in their
// true relative positions; only the pod, which has no place in the key
// geometry, gets moved.
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

/// The five boards laid out as they sit in use.
///
/// The key boards are left alone: they were placed from one layout, so
/// finger_l already knows where thumb_l is. The pod is centred between the
/// hands and dropped below them, which is roughly where a cable of any sane
/// length would let it sit.
function panel_boards(bs: Board[]) -> Board[] {
    let keys = bs.filter((b) -> {
        b.id != "pod"
    });
    let kb = union_box(keys);
    bs.map((b) -> {
        if (b.id == "pod") {
            let pb = board_box(b);
            translate_board(
                b,
                Vec2 {
                    x: (kb.min.x + kb.max.x) / 2.0 - (pb.min.x + pb.max.x) / 2.0,
                    y: kb.max.y + PANEL_GAP() - pb.min.y,
                },
            )
        } else {
            b
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
