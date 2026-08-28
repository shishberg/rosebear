// The thumb cluster, cut into two islands.
//
// A finger half is a row of columns and `strips_of` cuts it the obvious way:
// one strip per column, one fold between each neighbouring pair. The cluster is
// not that shape. Its three keys sit almost in a plane, splayed round the
// thumb's arc rather than stacked along a cylinder, and the only place it wants
// to fold is the one gap wide enough to put a serpentine in.
//
// So it is cut the way BastardKB cuts its five-key cluster: rigid islands
// joined by one neck. Everything below works in the cluster's OWN frame -- x
// along the near-to-far run, y across it -- where the islands are rectangles
// and `Strip`, `flex_ring` and `strip_neck` apply unchanged. The ring comes
// back out into board coordinates at the very end.

// -------------------------------------------------------------------- frames

/// A rotated frame, optionally handed the other way round.
///
/// `r` is the x axis's angle, carried because the parts standing in the frame
/// -- the connector, the diodes -- are placed by angle rather than by axis.
///
/// `flip` is -1 on a mirrored half and is what makes one description of the
/// cluster serve both hands. A mirror is not a rotation: the right cluster
/// turned to put its near-to-far run along +x has the finger board on the
/// wrong side of it and its keys splayed the wrong way, so a layout written in
/// that frame would need saying twice. Flipping the frame's y instead lands the
/// two hands on the SAME picture -- same island shapes, same lane order, same
/// side to leave for the fingers -- and pushes the difference into the two
/// places it belongs: the angle a part is placed at, and the order the
/// connector's contacts run in, which `link_pinout` already reverses for the
/// mirrored hand.
class Frame {
    o: Vec2,
    c: float,
    s: float,
    r: float,
    flip: float,
}

function frame_along(o: Vec2, to: Vec2, flip: float) -> Frame {
    let u = unit_from(o, to);
    Frame { o: o, c: u.x, s: u.y, r: angle_of(u), flip: flip }
}

/// A point in ergogen coordinates, in the frame.
function into_frame(f: Frame, p: Vec2) -> Vec2 {
    let dx = p.x - f.o.x;
    let dy = p.y - f.o.y;
    Vec2 { x: dx * f.c + dy * f.s, y: f.flip * (0.0 - dx * f.s + dy * f.c) }
}

/// A point in the frame, in ergogen coordinates.
function out_of_frame(f: Frame, q: Vec2) -> Vec2 {
    let qy = f.flip * q.y;
    Vec2 { x: f.o.x + q.x * f.c - qy * f.s, y: f.o.y + q.x * f.s + qy * f.c }
}

/// A footprint-local point, in the cluster frame.
function frame_pad(f: Frame, c: Component, v: Vec2) -> Vec2 {
    into_frame(f, to_kicad(comp_to_global(c, v)))
}

/// The angle a part standing in the frame is placed at, so that its local x
/// axis runs along +x of the frame.
///
/// Front and back differ by the mirror KiCad applies to a back-side footprint,
/// which is why `diode_component` stores a key's angle negated and
/// `switch_component` does not; the flip adds the cluster's own.
function frame_angle(f: Frame, front: bool) -> float {
    if (front) {
        if (f.flip > 0.0) {
            f.r
        } else {
            f.r + 180.0
        }
    } else {
        0.0 - f.r
    }
}

/// A point in the frame, in KiCad coordinates.
function frame_to_kicad(f: Frame, q: Vec2) -> Vec2 {
    to_kicad(out_of_frame(f, q))
}

// ------------------------------------------------------------------- cluster

/// The cluster's keys, near to far.
function thumb_keys(m: Module) -> PlacedKey[] {
    let out: PlacedKey[] = [];
    for (let cname in THUMB_ORDER()) {
        for (let k in m.keys) {
            if (k.column == cname) {
                out.push(k);
            }
        }
    }
    out
}

/// The cluster's frame: origin on the near key, x along the run to the far one.
///
/// Built from the key centres rather than from the splay in the config, so it
/// holds for either hand -- the mirrored cluster's keys give a mirrored frame,
/// and everything downstream is stated in it. Which is what keeps the islands
/// in near-to-far order for both hands, the way `strips_of` sorts west to east.
function thumb_frame(m: Module) -> Frame {
    let ks = thumb_keys(m);
    let flip = if (m.hand == "r") {
        0.0 - 1.0
    } else {
        1.0
    };
    let flat = Frame { o: Vec2 { x: 0.0, y: 0.0 }, c: 1.0, s: 0.0, r: 0.0, flip: flip };
    if (ks.length() < 2) {
        return flat;
    }
    if let a: PlacedKey = ks.at(0) {
        if let b: PlacedKey = ks.at(ks.length() - 1) {
            return frame_along(a.pos(), b.pos(), flip);
        }
    }
    flat
}

/// A key's switch footprint, as a box in the cluster frame.
///
/// The socket reaches `SWITCH_HALF_SPAN` across the key and
/// `SWITCH_HALF_DEPTH` along it. Turned by the key's angle relative to the
/// frame, that rectangle's own bounding box is what the island has to hold --
/// and on a cluster whose keys sit at 14, 89 and -16 degrees to the run, no two
/// keys present the same face.
function key_frame_box(f: Frame, k: PlacedKey) -> Box {
    let c = into_frame(f, k.pos());
    let a = deg_to_rad(f.flip * (k.r - f.r));
    let ca = a.cos().abs();
    let sa = a.sin().abs();
    let hu = SWITCH_HALF_SPAN() * ca + SWITCH_HALF_DEPTH() * sa;
    let hv = SWITCH_HALF_SPAN() * sa + SWITCH_HALF_DEPTH() * ca;
    Box { min: Vec2 { x: c.x - hu, y: c.y - hv }, max: Vec2 { x: c.x + hu, y: c.y + hv } }
}

/// The southernmost the switches reach, and so where the band below them
/// starts.
function thumb_keys_v_lo(f: Frame, ks: PlacedKey[]) -> float {
    ks.reduce(
        (a, k) -> {
            let b = key_frame_box(f, k).min.y;
            if (b < a) {
                b
            } else {
                a
            }
        },
        1000000.0,
    )
}

// --------------------------------------------------------------------- bands
//
// Everything that is not a key sits in one of two bands running the length of
// the cluster: the lanes just south of the switches, and the row of diodes
// south of those. Both are stated as offsets from `thumb_keys_v_lo`, so the
// cluster's own splay decides how deep the board has to be rather than a
// number chosen here.

/// Lanes across the cluster's south band: one per matrix row.
///
/// The rows run on the front and dive to a via each beside their diode. The
/// column line is not among them -- every one of its destinations is a socket
/// pad and those all face north, so it takes the back and goes over the top
/// instead; see `thumb_over_v`.
function thumb_band_lanes() -> int {
    MATRIX_ROWS().length()
}

/// Centre of band lane `j`, counting south from the switches.
function thumb_lane_v(f: Frame, ks: PlacedKey[], j: int) -> float {
    thumb_keys_v_lo(f, ks) - flex_lane_clear() - (j * 1.0) * flex_lane_pitch()
}

/// Half a SOD-123's reach along its own long axis: the pads sit 1.65 out and
/// are 0.9 long. Across it the part is `DIODE_PAD_HALF` deep.
function DIODE_HALF_LONG() -> float {
    1.65 + 0.45
}

/// Where the row of diodes sits, in the cluster frame.
///
/// South of every band lane by enough to stand each row lane's via in between:
/// a via in the band would block the lanes crossing over it, and a via south of
/// the diodes would put the stub that reaches the cathode across the diode.
function thumb_diode_v(f: Frame, ks: PlacedKey[]) -> float {
    let last = thumb_lane_v(f, ks, thumb_band_lanes() - 1);
    let via = last - FLEX_TRACE_W() / 2.0 - FLEX_TRACE_SPACE() - FLEX_VIA_PAD() / 2.0;
    via - FLEX_VIA_PAD() / 2.0 - FLEX_TRACE_SPACE() - DIODE_PAD_HALF()
}

/// Where a row lane turns into its diode's cathode.
function thumb_via_v(f: Frame, ks: PlacedKey[]) -> float {
    thumb_diode_v(f, ks) + DIODE_PAD_HALF() + FLEX_TRACE_SPACE() + FLEX_VIA_PAD() / 2.0
}

/// A footprint-local point on a key, in the cluster frame.
///
/// The same transform `comp_to_global` writes into the board file, stated in
/// the frame so the geometry can be worked out before the components exist.
///
/// Turn by the key's angle relative to the run, having mirrored the footprint's
/// y first -- once for KiCad's downward y, and again on a mirrored half, where
/// the part itself is laid out mirrored. That second one is the thing `flip`
/// does NOT absorb: the two hands' key BOXES come out identical and their pads
/// do not, so which side of a socket its column pad faces is a per-hand fact.
function key_local(f: Frame, k: PlacedKey, v: Vec2) -> Vec2 {
    let c = into_frame(f, k.pos());
    let a = deg_to_rad(f.flip * (k.r - f.r));
    let y = 0.0 - f.flip * v.y;
    Vec2 { x: c.x + v.x * a.cos() - y * a.sin(), y: c.y + v.x * a.sin() + y * a.cos() }
}

/// Clearance a track keeps from a switch footprint it is running past.
function thumb_escape_clear() -> float {
    FLEX_TRACE_SPACE() + FLEX_TRACE_W() / 2.0
}

/// Where a track leaving one of a switch's pads gets clear of the footprint.
///
/// Both socket pads sit inside the outline, so nothing reaches either across
/// open board; each is reached the way `col_lane_x` reaches pad 1 on a finger
/// strip, by running out along the pad's OWN row. That ray is clear of every
/// drill and of the other pad whichever way the key is turned -- pad 1 leaves
/// along local +x, pad 2 along local -x -- and this follows it until it is out
/// of the footprint's bounding box, so that whatever the track does next is
/// clear too.
///
/// Which SIDE of the box it comes out of is not a free choice, and the two
/// hands do not agree about it: a part on a mirrored half is laid out mirrored,
/// which reverses the ray while `flip` leaves the key box alone.
function thumb_pad_escape(f: Frame, k: PlacedKey, pad: Vec2, sign: float) -> Vec2 {
    let p = key_local(f, k, pad);
    let a = deg_to_rad(f.flip * (k.r - f.r));
    let e = Vec2 { x: sign * a.cos(), y: sign * a.sin() };
    let box = box_grow(key_frame_box(f, k), thumb_escape_clear());
    let tx = axis_exit(p.x, e.x, box.min.x, box.max.x);
    let ty = axis_exit(p.y, e.y, box.min.y, box.max.y);
    let t = if (tx < ty) {
        tx
    } else {
        ty
    };
    Vec2 { x: p.x + t * e.x, y: p.y + t * e.y }
}

/// How far along a ray it takes to leave one axis's slab, or a big number if it
/// never does.
function axis_exit(p: float, d: float, lo: float, hi: float) -> float {
    if (d > 0.000001) {
        (hi - p) / d
    } else if (d < 0.0 - 0.000001) {
        (lo - p) / d
    } else {
        1000000.0
    }
}

function thumb_pad1_escape(f: Frame, k: PlacedKey) -> Vec2 {
    thumb_pad_escape(f, k, MX_SIGNAL_PAD(), 1.0)
}

function thumb_pad2_escape(f: Frame, k: PlacedKey) -> Vec2 {
    thumb_pad_escape(f, k, MX_GND_PAD(), 0.0 - 1.0)
}

/// Which rail of the column ladder a key hangs off: the over band, or the lane
/// south of everything.
///
/// Whichever way pad 1's escape ray points. Feeding it from the other side
/// would mean crossing the footprint to get back to the pad.
function thumb_pad1_from_north(f: Frame, k: PlacedKey) -> bool {
    deg_to_rad(f.flip * (k.r - f.r)).sin() >= 0.0
}

/// The lane the column line takes the length of the cluster, on the back,
/// south of everything.
///
/// It has to get from the connector at the north end to the seam at the south,
/// and the seam is the only way onto the far island. South of the hop lane is
/// the one east-west line on the back that nothing crosses: the hops turn there
/// and stop, the diodes and their vias are north of it, and the row lanes are
/// on the front.
function thumb_col_v(f: Frame, ks: PlacedKey[]) -> float {
    thumb_south_v(f, ks) - flex_lane_pitch()
}

/// A key's diode, standing in the cluster's frame rather than the key's.
///
/// `diode_offset` puts a finger key's diode toward the middle of its column,
/// which is the right answer on a strip and a meaningless one here: the three
/// thumb keys point three different ways, and following each key's own frame
/// throws the 1.5u key's diode out into the seam between the islands. So the
/// cluster keeps its diodes in a row of its own, square to the near-to-far run,
/// south of every switch -- which is also where their row lines want to be.
function thumb_diode_component(f: Frame, ks: PlacedKey[], k: PlacedKey, index: int) -> Component {
    let at = frame_to_kicad(f, Vec2 { x: into_frame(f, k.pos()).x, y: thumb_diode_v(f, ks) });
    Component {
        ref: `D${index}`,
        footprint: DIODE_FOOTPRINT(),
        x: at.x,
        y: at.y,
        // Negated for the same reason `diode_component` negates the key's
        // angle: a back-side part is mirrored, so KiCad applies the negation of
        // the stored angle to already-flipped coordinates.
        r: frame_angle(f, false),
        layer: "B.Cu",
        pads: [Pad { pad: "1", net: row_net(k) }, Pad { pad: "2", net: switch_diode_net(k) }],
    }
}

// ------------------------------------------------------------------- islands

/// How the cluster is cut, near to far.
///
/// One fold, at the one gap wide enough to put a serpentine in and the one the
/// fewest conductors cross. `{near, home} | {far}` sends two lines over the
/// seam -- the far key's row and the column every key shares. Cutting the other
/// way would send three, and would put the connector on the island that has to
/// forward everything.
function THUMB_ISLANDS() -> string[][] {
    [["near", "home"], ["far"]]
}

/// Which island a thumb column lands on.
function thumb_island_of(col: string) -> int {
    let out = 0;
    let i = 0;
    for (let g in THUMB_ISLANDS()) {
        for (let c in g) {
            if (c == col) {
                out = i;
            }
        }
        i = i + 1;
    }
    out
}

/// Conductors crossing the seam: the far key's row line, and the shared column.
function thumb_neck_traces() -> int {
    2
}

/// The step the seam's neck has to fold through.
///
/// The finger necks take theirs from the well, which knows what each column
/// pair is offset by. Nothing knows that for the thumb: the cluster's 3D
/// placement is not in the model at all, and `dactyl_thumb_zone` carries the
/// v2 measured numbers rather than derived ones. So the seam takes the same
/// 5mm step the columns do, which is the largest fold on the board and
/// therefore the safe one to copy.
function THUMB_FOLD_STEP() -> float {
    5.0
}

/// The cluster as two rectangles in its own frame, near island first.
///
/// Each is the bounding box of everything standing on it -- switches, the
/// diodes in their row, and on the near island the connector -- grown by the
/// edge clearance. A rectangle wastes a little board over the splay, which is
/// the price of the islands being `Strip`s and inheriting the ring, the neck
/// and every rule that has already been written about them.
function thumb_islands(m: Module, p: FlexParams) -> Strip[] {
    let f = thumb_frame(m);
    let ks = thumb_keys(m);
    let dv = thumb_diode_v(f, ks);
    let sv = thumb_col_v(f, ks);
    let stand = thumb_link_stand(m);
    let out: Strip[] = [];
    let gi = 0;
    for (let g in THUMB_ISLANDS()) {
        let mine = thumb_island_keys(ks, gi);
        let ov = thumb_over_v(f, mine);
        let box = Box {
            min: Vec2 { x: 1000000.0, y: 1000000.0 },
            max: Vec2 { x: 0.0 - 1000000.0, y: 0.0 - 1000000.0 },
        };
        let ys: float[] = [];
        for (let k in mine) {
            let u = into_frame(f, k.pos()).x;
            box = box_union(box, key_frame_box(f, k));
            // The bands: the diodes and the column's south lane below the
            // switches, its over band above them, and the stub that reaches
            // each key's approach point from one or the other.
            box
                = box_union(
                    box,
                    Box {
                        min: Vec2 { x: u - DIODE_HALF_LONG(), y: sv - FLEX_TRACE_W() / 2.0 },
                        max: Vec2 { x: u + DIODE_HALF_LONG(), y: ov + FLEX_TRACE_W() / 2.0 },
                    },
                );
            for (let e in [thumb_pad1_escape(f, k), thumb_pad2_escape(f, k)]) {
                box
                    = box_union(
                        box,
                        Box {
                            min: Vec2 { x: e.x - FLEX_TRACE_W() / 2.0, y: e.y - FLEX_TRACE_W() / 2.0 },
                            max: Vec2 { x: e.x + FLEX_TRACE_W() / 2.0, y: e.y + FLEX_TRACE_W() / 2.0 },
                        },
                    );
            }
            ys.push(u);
        }
        if (gi == 0) {
            box = box_union(box, thumb_link_box(stand));
        } else {
            let cu = thumb_climb_u(f, mine);
            box
                = box_union(
                    box,
                    Box {
                        min: Vec2 { x: cu - FLEX_TRACE_W() / 2.0, y: sv },
                        max: Vec2 { x: cu + FLEX_TRACE_W() / 2.0, y: ov },
                    },
                );
        }
        // Room on the seam side for the two conductors that cross it: they
        // come down to the neck's height just inside the island edge, and the
        // switches must not be sitting where they do.
        let seamed = Box {
            min: Vec2 {
                x: if (gi > 0) {
                    box.min.x - thumb_seam_step()
                } else {
                    box.min.x
                },
                y: box.min.y,
            },
            max: Vec2 {
                x: if (gi < THUMB_ISLANDS().length() - 1) {
                    box.max.x + thumb_seam_step()
                } else {
                    box.max.x
                },
                y: box.max.y,
            },
        };
        let grown = box_grow(seamed, BOARD_EDGE_CLEAR());
        out.push(
            Strip {
                column: `island${gi}`,
                cx: (grown.min.x + grown.max.x) / 2.0,
                half_w: (grown.max.x - grown.min.x) / 2.0,
                y0: grown.min.y,
                y1: grown.max.y,
                key_ys: ys,
                // Both ends of the seam attach at the same height, low in the
                // islands, so the serpentine runs back NORTH up the seam and
                // stays inside the board's own extent instead of hanging 13mm
                // off the bottom of it.
                neck_y: 0.0,
                neck_len: neck_length_for_step(THUMB_FOLD_STEP()),
            },
        );
        gi = gi + 1;
    }
    thumb_seat_necks(out, p)
}

/// Put both islands' neck attachment at a height they can both reach.
///
/// `strip_neck` lets the two ends sit at different heights and absorbs the
/// difference into the legs, which is what a staggered pair of finger columns
/// needs. The seam has no such stagger, and a level neck is the shortest one.
function thumb_seat_necks(ss: Strip[], p: FlexParams) -> Strip[] {
    let lo = ss.reduce(
        (a, s) -> {
            if (s.y0 > a) {
                s.y0
            } else {
                a
            }
        },
        0.0 - 1000000.0,
    );
    let y = lo + neck_half(p, thumb_neck_traces()) + FLEX_EDGE_CLEAR();
    ss.map((s) -> {
        Strip {
            column: s.column,
            cx: s.cx,
            half_w: s.half_w,
            y0: s.y0,
            y1: s.y1,
            key_ys: s.key_ys,
            neck_y: y,
            neck_len: s.neck_len,
        }
    })
}

// ----------------------------------------------------------------- the link

/// Where the cluster's connector stands, in the cluster frame.
class ThumbStand {
    at: Vec2,
    /// Ergogen angle, the way `Component.r` carries it.
    r: float,
    ways: int,
}

/// Conductors on the finger->thumb ribbon: the cluster's own matrix lines plus
/// the ground conductor every ribbon carries.
///
/// Derived rather than read off the ribbon, because the islands are sized
/// before the ribbons are built; `the cluster's connector is the ribbon's own
/// width` holds the two together.
function thumb_link_ways(m: Module) -> int {
    matrix_signals(m.keys).length() + 1
}

/// How far north the switches reach under the connector, and so where the fan
/// band behind it starts.
function thumb_under_link_top(f: Frame, ks: PlacedKey[], uc: float, ways: int) -> float {
    let half = ffc_body_half(ways);
    ks.reduce(
        (a, k) -> {
            let b = key_frame_box(f, k);
            if (b.min.x < uc + half && uc - half < b.max.x && b.max.y > a) {
                b.max.y
            } else {
                a
            }
        },
        0.0 - 1000000.0,
    )
}

/// Lanes in the fan band behind the connector: one per row line.
function thumb_fan_lanes() -> int {
    MATRIX_ROWS().length()
}

/// Centre of fan lane `j`, counting south from the connector.
///
/// Lane 0 is the northernmost and belongs to the contact furthest east, so a
/// lane that has to reach past another leaves from behind it rather than across
/// it. That is the whole of the ordering rule, and it is why the connector's
/// contact order is not free: see `route_thumb_row`.
function thumb_fan_v(f: Frame, ks: PlacedKey[], uc: float, ways: int, j: int) -> float {
    thumb_under_link_top(f, ks, uc, ways)
        + BOARD_EDGE_CLEAR()
        + flex_lane_clear()
        + ((thumb_fan_lanes() - 1 - j) * 1.0) * flex_lane_pitch()
}

/// The lane the column line takes over the top of an island, on the back.
///
/// Every socket presents its column pad through a ray that leaves the footprint
/// sideways, and on most of them that ray points north; those keys are fed from
/// this band. It is on the back because that is where the socket pads are, and
/// because the front over the same ground is spoken for -- the fan band behind
/// the connector, the pour, the row lanes.
///
/// North of every switch on the island AND of every approach point on it, since
/// the stubs drop straight south out of this lane onto them.
function thumb_over_v(f: Frame, ks: PlacedKey[]) -> float {
    ks.reduce(
        (a, k) -> {
            let hi = highest([key_frame_box(f, k).max.y, thumb_pad1_escape(f, k).y, thumb_pad2_escape(f, k).y]);
            if (hi > a) {
                hi
            } else {
                a
            }
        },
        0.0 - 1000000.0,
    )
        + flex_lane_clear()
}

function highest(xs: float[]) -> float {
    xs.reduce(
        (a, x) -> {
            if (x > a) {
                x
            } else {
                a
            }
        },
        0.0 - 1000000.0,
    )
}

/// The keys on one island, near to far.
function thumb_island_keys(ks: PlacedKey[], i: int) -> PlacedKey[] {
    ks.filter((k) -> {
        thumb_island_of(k.column) == i
    })
}

/// Where the column line climbs from the south lane to an island's over band.
///
/// Only islands reached through the seam need one -- on the near island the
/// line comes down from the connector -- and it goes on the far side from the
/// seam, so the climb is not crowding the neck. Just outside the switches, with
/// the island's own edge clearance again beyond it.
function thumb_climb_u(f: Frame, ks: PlacedKey[]) -> float {
    ks.reduce(
        (a, k) -> {
            let e = highest([key_frame_box(f, k).max.x, thumb_pad1_escape(f, k).x, thumb_pad2_escape(f, k).x]);
            if (e > a) {
                e
            } else {
                a
            }
        },
        0.0 - 1000000.0,
    )
        + BOARD_EDGE_CLEAR()
}

/// The v the connector's body sits at: north of everything running behind it.
function thumb_link_v(f: Frame, ks: PlacedKey[]) -> float {
    thumb_over_v(f, thumb_island_keys(ks, 0)) + flex_lane_clear() + FFC_BODY_BACK()
}

/// The lane every switch-to-diode hop takes, south of the diode row.
///
/// A hop starts at a socket pad north of the band and ends at a diode anode
/// south of it, so it is the one thing on this board that has to cross the band
/// on the back. Taking it right round the outside of the diodes keeps it clear
/// of the row lanes' vias and their stubs, which are the only other back copper
/// down here.
function thumb_south_v(f: Frame, ks: PlacedKey[]) -> float {
    thumb_diode_v(f, ks) - DIODE_PAD_HALF() - FLEX_TRACE_SPACE() - FLEX_TRACE_W() / 2.0
}

function thumb_key_box_at(f: Frame, ks: PlacedKey[], i: int) -> Box {
    if let k: PlacedKey = ks.at(i) {
        return key_frame_box(f, k);
    }
    Box { min: Vec2 { x: 0.0, y: 0.0 }, max: Vec2 { x: 0.0, y: 0.0 } }
}

/// Where the lines that have to get south come down, west to east.
///
/// The one corridor on the near island clear on BOTH layers for the full depth
/// of the board: everywhere else is a socket's pads on the back or its drills
/// on both. Slot 0 is the column line's descent to the seam and the rest belong
/// to the row lines, one each, in the order their contacts run in -- which is
/// the order their lanes have to peel off in.
function thumb_corridor_slots() -> int {
    1 + thumb_fan_lanes()
}

function thumb_corridor_u(f: Frame, ks: PlacedKey[], j: int) -> float {
    let pad = BOARD_EDGE_CLEAR() + FLEX_VIA_PAD() / 2.0;
    let a = thumb_key_box_at(f, ks, 0).max.x + pad;
    let b = thumb_key_box_at(f, ks, 1).min.x - pad;
    a + (b - a) * ((j + 1) * 1.0) / ((thumb_corridor_slots() + 1) * 1.0)
}

/// The cluster's connector: north of the near key, contacts facing the fingers.
///
/// Over the near key because that is the end of the cluster the finger board
/// is at, so the ribbon between the two is a short straight hop; and north
/// because that is the direction the cable leaves in, and a connector's
/// contacts face the way its cable goes. It stands clear of the switch below it
/// rather than beside it: the cluster has no gap 12mm long anywhere between the
/// keys, and the front of the board north of the near key is empty.
function thumb_link_stand(m: Module) -> ThumbStand {
    let f = thumb_frame(m);
    let ks = thumb_keys(m);
    let ways = thumb_link_ways(m);
    let uc = thumb_key_u(f, ks, 0);
    ThumbStand { at: Vec2 { x: uc, y: thumb_link_v(f, ks) }, r: frame_angle(f, true), ways: ways }
}

/// The u of the `i`th key along the cluster, near to far.
function thumb_key_u(f: Frame, ks: PlacedKey[], i: int) -> float {
    if let k: PlacedKey = ks.at(i) {
        return into_frame(f, k.pos()).x;
    }
    0.0
}

/// The connector's courtyard, in the cluster frame.
function thumb_link_box(s: ThumbStand) -> Box {
    let half = ffc_body_half(s.ways);
    Box {
        min: Vec2 { x: s.at.x - half, y: s.at.y - FFC_BODY_BACK() },
        max: Vec2 { x: s.at.x + half, y: s.at.y + FFC_BODY_FRONT() },
    }
}

// -------------------------------------------------------------------- board

/// The cluster's outline: the two islands and their seam, in KiCad coordinates.
function thumb_outline(m: Module, ss: Strip[], p: FlexParams) -> Vec2[] {
    let f = thumb_frame(m);
    to_kicad_poly(
        flex_ring(ss, p, thumb_neck_traces(), NECK_SAMPLES()).map((q) -> {
            out_of_frame(f, q)
        }),
    )
}

/// The pour on a thumb board: ground behind the GND end of the connector.
///
/// The same rule the finger boards keep -- no copper plane over anything that
/// folds -- and here it costs even less. Under the matrix the cluster's only
/// ground is the link's own ground contact and its two mounting pegs, all three
/// within the connector's own footprint.
///
/// It takes the GND END of that footprint rather than all of it, because the
/// row lines leave straight south out of the middle of the contact row and a
/// pour they cut in half is two pieces of copper on one net with nothing
/// joining them. So it runs from halfway between the ground contact and its
/// neighbour out to the far end -- which holds the ground contact and the
/// mounting peg on that side. The other peg reaches it on the back; see
/// `route_thumb_ground`.
///
/// Front only. The Molex part's mounting pegs are surface pads on the front and
/// nothing else on this board is grounded, so a back pour would be copper with
/// no pad on it -- which is what KiCad calls isolated fill, and what it was
/// reporting before this said `F.Cu` alone.
function thumb_zones(f: Frame, s: ThumbStand, link: Component?) -> Zone[] {
    let b = thumb_link_box(s);
    let cut = if let c: Component = link {
        thumb_gnd_edge(f, c, s)
    } else {
        s.at.x
    };
    let lo = if (cut < s.at.x) {
        b.min.x
    } else {
        cut
    };
    let hi = if (cut < s.at.x) {
        cut
    } else {
        b.max.x
    };
    let poly = [
        Vec2 { x: lo, y: b.min.y },
        Vec2 { x: hi, y: b.min.y },
        Vec2 { x: hi, y: b.max.y },
        Vec2 { x: lo, y: b.max.y },
    ]
        .map((q) -> {
            to_kicad(out_of_frame(f, q))
        });
    [Zone { net: "GND", layer: "F.Cu", outline: poly }]
}

/// Halfway between the ground contact and the signal contact beside it: the
/// line the pour stops at, so no signal escape crosses it.
function thumb_gnd_edge(f: Frame, link: Component, s: ThumbStand) -> float {
    let n = link_ways(link);
    let g = contact_of(link, "GND");
    let other = if (g > 1) {
        g - 1
    } else {
        2
    };
    let gu = into_frame(f, to_kicad(contact_at(link, g))).x;
    let ou = into_frame(f, to_kicad(contact_at(link, other))).x;
    (gu + ou) / 2.0
}

/// One half's thumb cluster, cut into islands, placed and routed.
function thumb_flex_board(
    m: Module,
    ribbons: Ribbon[],
    f: Features,
) -> Board throws baml.errors.InvalidArgument {
    let p = flex_defaults();
    let fr = thumb_frame(m);
    let ks = thumb_keys(m);
    let ss = thumb_islands(m, p);

    let comps: Component[] = [];
    let i = 1;
    for (let k in led_chain(m)) {
        comps.push(switch_component(k, i, f));
        comps.push(thumb_diode_component(fr, ks, k, i));
        i = i + 1;
    }

    let stand = thumb_link_stand(m);
    let ci = 1;
    for (let r in ribbons) {
        if (r.to_module == m.id || r.from_module == m.id) {
            let pad_sigs = if (r.from_module == m.id) {
                from_end_signals(r.signals)
            } else {
                r.signals
            };
            comps.push(
                connector_component(`J${ci}`, pad_sigs, frame_to_kicad(fr, stand.at), stand.r),
            );
            ci = ci + 1;
        }
    }

    let b = Board {
        id: m.id,
        components: comps,
        outline: thumb_outline(m, ss, p),
        cuts: [],
        tracks: [],
        vias: [],
        zones: thumb_zones(fr, stand, thumb_link_of_comps(comps)),
    };
    let cu = route_thumb(b, m);
    Board {
        id: b.id,
        components: b.components,
        outline: b.outline,
        cuts: b.cuts,
        tracks: cu.tracks,
        vias: cu.vias,
        zones: b.zones,
    }
}
