// The trackball, on the right finger board.
//
// A Blackberry-style jog ball is a purely mechanical part: a ball on two
// spindles, each spindle carrying magnets. Nothing about it is electrical. The
// board does the sensing -- four hall switches under the spindle ends read the
// magnets going past, and a dome under the centre reads the click. So the
// "module" is five components of our own around one 11x9 hole-pattern, not a
// part with a pinout.
//
// Everything here is placed and routed by hand-quoted coordinates rather than
// derived, and that is a deliberate exception to the rest of this pipeline.
// The corridor from the pod link to the site is a single path through a board
// that is already full: it threads the one gap between the inner column's
// light window and the thumb board's pocket, and there is no family of such
// paths to parameterise over. The numbers are all justified against the
// geometry they clear, in the comments below.

// --------------------------------------------------------------- placement

/// Where the ball sits: below the ring and middle columns, clear of the bottom
/// row and well east of the thumb board's pocket.
///
/// The ring column stands at x=330.39 and the middle at x=309.87, so this is
/// between them; the bottom keys of the two reach y=88.75 at the furthest, and
/// their LEDs' light windows y=97.9, so 112 leaves the whole site south of the
/// key field. It used to sit a column further inboard, between index and
/// middle, hard against the thumb board's pocket; out here the pocket is
/// nowhere near it and the corridor's last leg is the only thing that got
/// longer.
function TRACKBALL_AT() -> Vec2 {
    Vec2 { x: 320.0, y: 112.0 }
}

/// Half the spacing of the four hall switches, on both axes.
///
/// The spindle magnets sit at the corners of the unit, so the sensors do too.
/// Matches the SparkFun Trackballer reference, whose halls are at 3.9-4.3 out
/// on each axis.
function TB_HALL_OFF() -> float {
    4.0
}

/// The hall switches are on the BACK.
///
/// They have to be: the ball unit occupies the whole 11x9 front footprint, and
/// the magnets read perfectly well through 1.6mm of FR4. It also happens to be
/// where the supply is -- the back pour of a board with LEDs fitted IS the
/// supply rail -- so each hall's VDD pad needs no copper at all.
function TB_HALL_FOOTPRINT() -> string {
    "Package_TO_SOT_SMD:SOT-23"
}

/// A continuous-time, open-drain hall switch: A1104 / AH3366 / DRV5033 class.
///
/// Continuous-time matters. The micropower parts sample at a few hundred hertz
/// to save current, and a ball flicked hard turns its spindle faster than that
/// -- the sampled part drops counts and the pointer jumps backwards. Open
/// drain matters too: the part runs off the 5V pour while the ESP32-P4's pull-
/// up holds the line at 3.3V, and only an open-drain output survives that.
function TB_HALL_VALUE() -> string {
    "A1104"
}

function TB_CAP_FOOTPRINT() -> string {
    "Capacitor_SMD:C_0402_1005Metric"
}

/// The four hall positions, in the order their nets are listed.
///
/// Which physical corner carries which of the four movement lines is a
/// firmware question, not a board one -- the four are read as two quadrature
/// pairs whichever way round they are wired. So the assignment here is chosen
/// for the routing: it is the one order that lets the five lanes peel off the
/// bundle without crossing, innermost lane to nearest target. See
/// `route_trackball`.
function tb_hall_pos(i: int) -> Vec2 {
    let c = TRACKBALL_AT();
    let d = TB_HALL_OFF();
    if (i == 0) {
        // TB_UP: north-west.
        Vec2 { x: c.x - d, y: c.y - d }
    } else if (i == 1) {
        // TB_DOWN: south-west.
        Vec2 { x: c.x - d, y: c.y + d }
    } else if (i == 2) {
        // TB_LEFT: south-east.
        Vec2 { x: c.x + d, y: c.y + d }
    } else {
        // TB_RIGHT: north-east.
        Vec2 { x: c.x + d, y: c.y - d }
    }
}

/// Each hall is turned so its output pad faces AWAY from the ball's centre.
///
/// SOT-23 puts pin 3 alone on one side; facing it outward means every lane
/// reaches its pad from the outside of the cluster and none has to thread
/// between the ball's two mounting spigots.
function tb_hall_angle(i: int) -> float {
    if (i == 0 || i == 1) {
        180.0
    } else {
        0.0
    }
}

/// The four movement nets, in hall order. The button is not here: it lands on
/// the dome, not on a hall.
function tb_hall_nets() -> string[] {
    ["TB_UP", "TB_DOWN", "TB_LEFT", "TB_RIGHT"]
}

/// Supply decoupling for the four halls: two 100nF parts just north of the
/// unit, where the back is otherwise empty.
///
/// North rather than beside each hall, because beside each hall is either
/// under the ball's spigot holes or in the lane bundle. Four hall switches
/// drawing a few milliamps each share a pair of caps happily.
function tb_cap_pos(i: int) -> Vec2 {
    let c = TRACKBALL_AT();
    if (i == 0) {
        Vec2 { x: c.x - 1.0, y: c.y - 7.2 }
    } else {
        Vec2 { x: c.x + 2.0, y: c.y - 7.2 }
    }
}

/// Turned so both ground pads face the shared via between them.
function tb_cap_angle(i: int) -> float {
    if (i == 0) {
        0.0
    } else {
        180.0
    }
}

/// Where the two caps' ground pads reach the front pour.
function TB_CAP_GND_VIA() -> Vec2 {
    let c = TRACKBALL_AT();
    Vec2 { x: c.x + 0.5, y: c.y - 7.2 }
}

/// The ball, the dome, four halls and two caps.
function trackball_components(f: Features) -> Component[] {
    let comps: Component[] = [];
    if (!f.trackball) {
        return comps;
    }
    let c = TRACKBALL_AT();
    // The ball itself: two mounting spigots and a courtyard, no pads.
    comps.push(
        Component {
            ref: "TB1",
            footprint: "rosebear:Trackball_BB_11x9",
            x: c.x,
            y: c.y,
            r: 0.0,
            layer: "F.Cu",
            pads: [],
        },
    );
    // The click, under the ball's centre, on the front where the ball is.
    comps.push(
        Component {
            ref: "TBSW1",
            footprint: "rosebear:SW_Dome_4mm",
            x: c.x,
            y: c.y,
            r: 0.0,
            layer: "F.Cu",
            pads: [Pad { pad: "1", net: "TB_BTN" }, Pad { pad: "2", net: "GND" }],
        },
    );
    let i = 0;
    for (let net in tb_hall_nets()) {
        let p = tb_hall_pos(i);
        comps.push(
            Component {
                ref: `TBH${i + 1}`,
                footprint: TB_HALL_FOOTPRINT(),
                x: p.x,
                y: p.y,
                r: tb_hall_angle(i),
                layer: "B.Cu",
                pads: [
                    // Pin 1 is the supply, and the back pour is the supply, so
                    // it needs no copper of its own.
                    Pad { pad: "1", net: LED_VDD_NET() },
                    Pad { pad: "2", net: "GND" },
                    Pad { pad: "3", net: net },
                ],
            },
        );
        i = i + 1;
    }
    let j = 0;
    while (j < 2) {
        let p = tb_cap_pos(j);
        comps.push(
            Component {
                ref: `TBC${j + 1}`,
                footprint: TB_CAP_FOOTPRINT(),
                x: p.x,
                y: p.y,
                r: tb_cap_angle(j),
                layer: "B.Cu",
                pads: [Pad { pad: "1", net: LED_VDD_NET() }, Pad { pad: "2", net: "GND" }],
            },
        );
        j = j + 1;
    }
    comps
}

/// True for the one board the trackball is fitted to.
function has_trackball(id: string, f: Features) -> bool {
    f.trackball && id == "finger_r"
}

// ----------------------------------------------------------------- routing
//
// The corridor, west to east, and why each number is what it is.
//
// The five nets land on the pod link's five southernmost contacts, at
// x=228.71 and y=80.81..84.81 -- `ribbon_signals` pushes them last precisely
// so they arrive below every key net's contact and their lanes leave without
// crossing the fan.
//
// They cannot leave eastward on the front: the three thumb pass-throughs run
// down the front at x=232.6..233.9 across exactly that band of y. So each net
// steps 2.2mm behind its contact -- the same standoff the LED data head uses
// -- and drops to the back, where those lanes do not exist below y=95.4.
//
// On the back they run east at their own contact's y to their own turning x,
// then surface at x=247.0..249.8. That strip is past the last of the pod
// link's own bus lanes (the outermost is at x=241.7) and past the thumb
// link's east mounting pad (x=244.8), and the front there is empty board all
// the way down to the pocket.
//
// Down the front to a staging row each, east, then a single parallel step
// south onto the final rows at y=104.3..106.3. Those five rows are the whole
// problem in one number. The strip south of the key field is bounded north by
// the LED chain's own copper -- the inner column's front hop row at y=103.75
// and the index-to-inner crossing at y=103.35 on the back -- and south by the
// thumb board's pocket, whose edge runs from (244.6,106.1) to (287.6,107.8).
// Under the inner column that leaves 2.3mm, and five lanes at 0.5mm pitch fit
// in it with a quarter of a millimetre at each end. Nothing else fits there
// at all, which is why the whole bundle is on one layer and why the step onto
// these rows lands at x=262, where the pocket edge has sloped far enough
// south to admit the outermost of them and the inner column's LED corner is
// still ahead. See `TB_STEP_X0`.
//
// Two orders are forced and they are the same one. The southernmost contact
// takes the westernmost turn (or its drop crosses the run of the net below
// it), and the westernmost turn takes the southernmost row (or its row
// crosses the drop of every net east of it). So contacts, drops and rows all
// run in step, north to south, and the bundle is planar by the same argument
// as every other fan on these boards.

/// The five nets in contact order, north to south, at the pod link.
///
/// `TRACKBALL_NETS` is the ribbon push order and the tail is reversed onto the
/// right hand's contacts, so this is that list read forwards.
function tb_lane_nets() -> string[] {
    TRACKBALL_NETS()
}

/// Lane pitch through the corridor. Trace plus clearance plus a quarter of a
/// millimetre; five of these is what fits under the inner column.
function TB_PITCH() -> float {
    0.5
}

/// Where lane `k` (0 = northernmost contact) turns south off the back run and
/// surfaces. Westernmost for the southernmost contact.
function tb_drop_x(k: int) -> float {
    249.8 - (k * 1.0) * 0.7
}

/// The staging row lane `k` runs east on, west of the pinch.
function tb_stage_y(k: int) -> float {
    101.2 + (k * 1.0) * TB_PITCH()
}

/// The final row lane `k` runs east on, through the pinch and up to the site.
function tb_row_y(k: int) -> float {
    104.3 + (k * 1.0) * TB_PITCH()
}

/// Where lane `k` turns south again, on the site's west flank.
///
/// Quoted off the site rather than absolutely: the final rows run east under
/// the key field for as far as the ball is from the pinch, and the flank has to
/// follow it. 5.8mm west of centre clears the ball's west spigot.
///
/// The northern rows turn furthest east, which is the same nesting once more:
/// a northern row that turned west of a southern one would drop straight
/// through it.
function tb_flank_x(k: int) -> float {
    TRACKBALL_AT().x - 5.8 - (k * 1.0) * 0.8
}

/// Where the step from the staging rows to the final rows begins and ends.
///
/// Two ends, two different constraints, and between them the length is set by
/// a third.
///
/// The east end has to clear the corner the inner column's LED turns: it comes
/// down the front at x=263.37 and turns east at y=103.75. The step lands at
/// x=262, west of that corner, so the only thing that passes it is the final
/// row itself, running east 0.55mm south of the hop row.
///
/// The east end also has to be far enough east that the pocket edge -- which
/// runs south-east across this strip -- has dropped clear of the outermost
/// row at y=106.3. That wants x >= 257.9; 262 clears it by 0.36mm against a
/// 0.2mm rule.
///
/// The length is the binding one. Five parallel diagonals 0.5mm apart in y sit
/// only `0.5 * dx/len` apart measured square to themselves, so a short steep
/// step pinches them together: over the 3.1mm drop the run has to be at least
/// 6.4mm for 0.25mm-wide traces to keep 0.2mm. Nine millimetres leaves 0.22mm,
/// and the strip between x=248 and the LED's corner holds nothing else, so
/// there is no reason to be stingy with it.
function TB_STEP_X0() -> float {
    253.0
}

function TB_STEP_X1() -> float {
    262.0
}

/// How far behind its contact a lane drops to the back. The pod link's own
/// data head uses the same standoff, and for the same reason: it is past the
/// contacts and short of every bus lane.
function TB_CONTACT_STANDOFF() -> float {
    2.2
}

/// The bundle from the pod link to the site's west flank: identical for all
/// five nets but for their own row.
function route_tb_trunk(
    conns: Component[],
    k: int,
    net: string,
    out: Track[],
    vias: Via[],
) -> void {
    if let r: ContactRef = find_contact_ref(conns, net) {
        let c = r.comp;
        let pad = comp_to_global(c, ffc_pad_local(r.pin, c.pads.length() - 1));
        let n = conn_normal(c);
        // Behind the contact and through to the back, clear of the front
        // lanes that run down past it.
        let w = along(pad, n, TB_CONTACT_STANDOFF());
        out.push(seg(pad, w, net));
        vias.push(Via { at: w, net: net });
        // East on the back at the contact's own height, then up to the front
        // clear of the pod link's outermost bus lane.
        let dx = tb_drop_x(k);
        let d = Vec2 { x: dx, y: pad.y };
        out.push(back(w, d, net));
        vias.push(Via { at: d, net: net });
        // Down the front to the staging row, east to the step, across, and
        // east again on the final row.
        let s = Vec2 { x: dx, y: tb_stage_y(k) };
        let s2 = Vec2 { x: TB_STEP_X0(), y: tb_stage_y(k) };
        let f1 = Vec2 { x: TB_STEP_X1(), y: tb_row_y(k) };
        let f2 = Vec2 { x: tb_flank_x(k), y: tb_row_y(k) };
        for (let e in [[d, s], [s, s2], [s2, f1], [f1, f2]]) {
            out.push(seg(vec_at(e, 0), vec_at(e, 1), net));
        }
    }
}

/// Where each lane leaves the flank, and where it ends.
///
/// The bundle turns south along the site's west side with the button's lane
/// innermost, and the lanes peel off inward in the order they are passed: the
/// button first, at the ball's centre; then the two west halls; then the two
/// east ones, reached the long way round the south and east sides. Peeling
/// inward-first is what keeps it planar -- a lane that peeled outward would
/// have to cross every lane still running past it.
function route_tb_leg(k: int, net: string, out: Track[], vias: Via[]) -> void {
    let c = TRACKBALL_AT();
    let fx = tb_flank_x(k);
    let top = Vec2 { x: fx, y: tb_row_y(k) };
    if (k == 0) {
        // The button, straight to the dome's centre pad. It comes in north of
        // the ball's west spigot and turns down between the dome's two skirt
        // pads, which are the only way in to the middle of that land.
        let a = Vec2 { x: fx, y: c.y - 2.6 };
        let b = Vec2 { x: c.x, y: c.y - 2.6 };
        let z = Vec2 { x: c.x, y: c.y };
        for (let e in [[top, a], [a, b], [b, z]]) {
            out.push(seg(vec_at(e, 0), vec_at(e, 1), net));
        }
        return;
    }
    // The four halls: down the flank, round to the pad's own side, and
    // through to the back where the hall is.
    let p = tb_hall_pos(k - 1);
    let out_pad = tb_hall_out_pad(k - 1);
    if (k == 1 || k == 2) {
        // West halls: the flank runs straight down past them, so the lane
        // simply stops level with its pad and changes layer there.
        let v = Vec2 { x: fx, y: p.y };
        out.push(seg(top, v, net));
        vias.push(Via { at: v, net: net });
        out.push(back(v, out_pad, net));
        return;
    }
    // East halls: round the south side and back up the east. The south run
    // clears the ball's body and the two caps; the east run clears the halls'
    // own pads by nearly a millimetre.
    let sy = if (k == 3) {
        c.y + 7.6
    } else {
        c.y + 8.4
    };
    let ex = if (k == 3) {
        out_pad.x
    } else {
        c.x + 6.6
    };
    let a = Vec2 { x: fx, y: sy };
    let b = Vec2 { x: ex, y: sy };
    let v = if (k == 3) {
        Vec2 { x: ex, y: p.y + 1.3 }
    } else {
        Vec2 { x: ex, y: p.y }
    };
    for (let e in [[top, a], [a, b], [b, v]]) {
        out.push(seg(vec_at(e, 0), vec_at(e, 1), net));
    }
    vias.push(Via { at: v, net: net });
    out.push(back(v, out_pad, net));
}

/// The global position of hall `i`'s output pad.
function tb_hall_out_pad(i: int) -> Vec2 {
    let p = tb_hall_pos(i);
    let d = if (tb_hall_angle(i) > 90.0) {
        0.0 - 0.9375
    } else {
        0.9375
    };
    Vec2 { x: p.x + d, y: p.y }
}

/// Hall `i`'s ground pad, which is on the back with the part.
function tb_hall_gnd_pad(i: int) -> Vec2 {
    let p = tb_hall_pos(i);
    // Pins 1 and 2 share the far side from pin 3; on the back the footprint is
    // mirrored, which puts pin 2 on the ball's side of the part's own axis.
    let dx = if (tb_hall_angle(i) > 90.0) {
        0.9375
    } else {
        0.0 - 0.9375
    };
    let dy = if (tb_hall_angle(i) > 90.0) {
        0.95
    } else {
        0.0 - 0.95
    };
    Vec2 { x: p.x + dx, y: p.y + dy }
}

/// Ties the halls' and caps' ground pads to the front pour.
///
/// The back of a board with LEDs fitted is the supply plane, so ground is only
/// on the front and every ground pad down here needs a via of its own -- the
/// same treatment `route_ground_vias` gives the sockets and the LEDs. Each
/// stub runs away from the ball's centre, into the strip between the hall and
/// the nearest spigot hole.
function route_tb_ground(out: Track[], vias: Via[]) -> void {
    let i = 0;
    while (i < 4) {
        let g = tb_hall_gnd_pad(i);
        let p = tb_hall_pos(i);
        // Away from the part, on the side its ground pin already faces.
        let sy = if (g.y > p.y) {
            1.0
        } else {
            0.0 - 1.0
        };
        let v = Vec2 { x: g.x, y: g.y + sy * 1.45 };
        out.push(back(g, v, "GND"));
        vias.push(Via { at: v, net: "GND" });
        i = i + 1;
    }
    // The two caps share one via between them.
    let v = TB_CAP_GND_VIA();
    let j = 0;
    while (j < 2) {
        let p = tb_cap_pos(j);
        let dx = if (tb_cap_angle(j) > 90.0) {
            0.0 - 0.48
        } else {
            0.48
        };
        out.push(back(Vec2 { x: p.x + dx, y: p.y }, v, "GND"));
        j = j + 1;
    }
    vias.push(Via { at: v, net: "GND" });
}

/// The whole trackball corridor and site.
function route_trackball(b: Board, f: Features, out: Track[], vias: Via[]) -> void {
    if (!has_trackball(b.id, f)) {
        return;
    }
    let conns = b.components.filter((c) -> {
        is_connector(c)
    });
    let k = 0;
    for (let net in tb_lane_nets()) {
        route_tb_trunk(conns, k, net, out, vias);
        route_tb_leg(k, net, out, vias);
        k = k + 1;
    }
    route_tb_ground(out, vias);
}
