// The pod board: the ESP32-P4 module, its two ribbon connectors and the user
// buttons.
//
// Nothing about this board falls out of the key layout, so unlike the key
// modules it has to be designed rather than derived. What it does have is a
// pinout we get to choose, and that is enough to make it planar for the same
// reason the key boards are.
//
// The shape of the argument:
//
//   * The module is two 27-pin rows 25.4mm apart, with the USB connectors at
//     one end. Mount it long-axis up, USB toward the far edge of the keyboard,
//     and each hand's ribbon connector sits below the socket on its own side.
//
//   * A hand's signals are served entirely by the socket on that side, so the
//     two fans never meet and neither has to cross the module.
//
//   * The ribbons leave sideways, so a connector's contacts stack up the board
//     in the same axis as the socket pins it serves: a 27-pin column at 2.54mm
//     against a 20-contact column at 1.00mm, offset in x. Every net is one
//     horizontal out of the socket, one vertical along a lane, and one
//     horizontal into its contact.
//
//   * That is planar without a search, but it needs the lanes assigned in two
//     halves. The contacts are packed tighter than the pins, so the pins above
//     the middle reach DOWN to their contacts and the ones below reach UP.
//     Within each half, the pin whose contact is furthest away takes the
//     outermost lane; the halves never overlap in y, so they share one set of
//     lanes and the channel is only half as wide as the ribbon.
//
//     Proof, for two nets i and j of the same half with pin heights p and
//     contact heights q, both in ascending order: a crossing needs one net's
//     horizontal to meet the other's vertical, which happens only if q_i lies
//     between p_j and q_j (or the mirror). In the half that reaches down,
//     q_j > p_j > p_i for every j > i, so it never does; in the half that
//     reaches up, q_i < p_i < p_j. Hence the rule.

// ------------------------------------------------------------------ the part
//
// Header pinout of the WT9932P4-TINY, from
// `datasheets/WT9932P4-TINY/WT9932P4-TINY_pinout_V1.3.1.png`, cross-checked
// against J6/J7 in `..._SCH_V1.3.pdf`.

class HeaderPin {
    /// 1-based position along the socket, counting from the end AWAY from the
    /// USB connectors -- which, mounted USB-up, is the end nearest the ribbon
    /// connectors.
    pin: int,
    /// Silkscreen name on the module: "IO15", "GND", "5V", "3V3", "VO4".
    name: string,
}

function header_pins(names: string[]) -> HeaderPin[] {
    let out: HeaderPin[] = [];
    let i = 1;
    for (let n in names) {
        out.push(HeaderPin { pin: i, name: n });
        i = i + 1;
    }
    out
}

/// The socket on the left of the pod board.
///
/// Mounting the module with USB up turns it 180 degrees from the datasheet
/// drawing, so the row drawn on the right lands on the left, and the pin drawn
/// at the top becomes pin 1 at the bottom.
function HEADER_LEFT() -> HeaderPin[] {
    header_pins(
        [
            "IO15",
            "IO14",
            "IO13",
            "IO12",
            "IO11",
            "IO10",
            "IO9",
            "IO6",
            "IO5",
            "IO4",
            "IO3",
            "IO2",
            "IO54",
            "IO53",
            "IO52",
            "IO50",
            "IO49",
            "IO48",
            "IO47",
            "IO46",
            "IO45",
            "IO44",
            "IO43",
            "IO40",
            "IO41",
            "IO42",
            "GND",
        ],
    )
}

function HEADER_RIGHT() -> HeaderPin[] {
    header_pins(
        [
            "IO16",
            "IO17",
            "IO18",
            "IO19",
            "IO20",
            "IO21",
            "IO22",
            "IO23",
            "GND",
            "IO39",
            "IO38",
            "IO37",
            "IO36",
            "GND",
            "IO34",
            "IO33",
            "IO32",
            "IO26",
            "IO27",
            "IO28",
            "IO29",
            "IO30",
            "IO31",
            "VO4",
            "3V3",
            "GND",
            "5V",
        ],
    )
}

/// What a pin costs to spend on a key, in things given up. 0 is free.
///
/// 47 pins reach the headers and 33 of them are free, against 36 keys, so some
/// of this has to be spent -- `v2-p4-pod.md`'s "pin scarcity doesn't exist
/// here" is true but by a narrower margin than it reads. Ordering the
/// concessions rather than picking pins by position is the whole reason this
/// function exists.
function pin_cost(name: string) -> int {
    if (contains_str(SD_DOMAIN_PINS(), name)) {
        // Powered from LDO_VO4, which firmware must enable. Free in practice:
        // there is no SD card on this keyboard.
        1
    } else if (contains_str(UART0_PINS(), name)) {
        // Costs the serial console. USB-CDC still works, so this is a real but
        // survivable loss.
        2
    } else if (contains_str(JTAG_PINS(), name)) {
        // Costs hardware debug.
        3
    } else if (contains_str(STRAP_PINS(), name)) {
        // Worst of the four: a key held down at power-on would change the boot
        // mode. Spent last, and on this layout never spent at all.
        4
    } else {
        0
    }
}

function SD_DOMAIN_PINS() -> string[] {
    ["IO39", "IO40", "IO43", "IO44", "IO45", "IO46", "IO47", "IO48"]
}

function UART0_PINS() -> string[] {
    ["IO37", "IO38"]
}

function JTAG_PINS() -> string[] {
    ["IO2", "IO3", "IO4"]
}

function STRAP_PINS() -> string[] {
    ["IO36"]
}

function is_gpio(p: HeaderPin) -> bool {
    p.name.starts_with("IO")
}

function no_pin() -> HeaderPin {
    HeaderPin { pin: 0, name: "" }
}

/// Take `n` pins from a socket: cheapest concession first, then sorted back
/// into pin order.
///
/// Both halves matter. Ranking by cost decides WHICH pins are spent; sorting
/// them back into pin order is what keeps the escape a staircase, because the
/// fan assigns contacts to pins in position order.
function choose_pins(hdr: HeaderPin[], n: int) -> HeaderPin[] throws baml.errors.InvalidArgument {
    let gpio = hdr.filter((p) -> {
        is_gpio(p)
    });
    if (gpio.length() < n) {
        throw baml.errors.InvalidArgument {
            message: `socket has ${gpio.length()} GPIO but ${n} signals need one`
        };
    }
    let ranked = gpio.sort_by((a, b) -> {
        let d = pin_cost(a.name) - pin_cost(b.name);
        if (d != 0) {
            d
        } else {
            a.pin - b.pin
        }
    });
    let taken: HeaderPin[] = [];
    let i = 0;
    while (i < n) {
        taken.push(ranked.at(i) ?? no_pin());
        i = i + 1;
    }
    taken.sort_by((a, b) -> {
        a.pin - b.pin
    })
}

/// Pins a socket still has free after `taken`, cheapest concession first.
///
/// Ranked, not just listed: a button is as much of a claim on a pin as a key
/// is, and taking them in header order spends a JTAG pin while three SD-domain
/// pins sit unused beside it.
function spare_pins(hdr: HeaderPin[], taken: HeaderPin[]) -> HeaderPin[] {
    let used = taken.map((p) -> {
        p.name
    });
    hdr
        .filter((p) -> {
            is_gpio(p) && !contains_str(used, p.name)
        })
        .sort_by((a, b) -> {
            let d = pin_cost(a.name) - pin_cost(b.name);
            if (d != 0) {
                d
            } else {
                a.pin - b.pin
            }
        })
}

// ---------------------------------------------------------------- mechanical
//
// Measured off `WT9932P4-TINY_3D_V1.1.step`, not read off a drawing.

function HEADER_ROW_SPACING() -> float {
    25.4
}

function HEADER_PITCH() -> float {
    2.54
}

function HEADER_WAYS() -> int {
    27
}

function MODULE_LEN() -> float {
    68.59
}

function MODULE_WIDTH() -> float {
    28.0
}

function SOCKET_FOOTPRINT() -> string {
    "Connector_PinSocket_2.54mm:PinSocket_1x27_P2.54mm_Vertical"
}

function BUTTON_FOOTPRINT() -> string {
    "Button_Switch_SMD:SW_SPST_SKQG_WithoutStem"
}

/// SKQG pad 1, the terminal carrying the button's GPIO. The part has two tabs
/// per terminal; either will do, and this is the outboard one.
function BUTTON_SIGNAL_PAD() -> Vec2 {
    Vec2 { x: 3.1, y: 0.0 - 1.85 }
}

function MOUNTING_HOLE_FOOTPRINT() -> string {
    "MountingHole:MountingHole_2.2mm_M2"
}

/// Gap between the socket pin row and the innermost escape lane.
///
/// Has to clear the socket's own pads, not just the trace: a 2.54mm header pad
/// is about 1.7mm across, so 1mm here would leave a few hundredths of a
/// millimetre of real clearance.
function CHANNEL_CLEARANCE() -> float {
    2.0
}

/// Gap between the outermost escape lane and the connector's contacts.
function POD_CONNECTOR_OFFSET() -> float {
    2.5
}

/// Lane-to-lane spacing in a pod escape channel.
function POD_LANE_PITCH() -> float {
    1.0
}

/// How many lanes a channel of `n` conductors needs.
///
/// Half, because the two halves of the fan share them -- plus one, because the
/// split is by where each pin's contact lands rather than by counting, and a
/// tighter or looser connector moves it by a conductor or two. `pod_test.baml`
/// checks the real split against this.
function pod_lanes(n: int) -> int {
    (n + 1) / 2 + 1
}

/// Where the buttons and the mounting holes sit, past the end of the module.
function POD_END_OFFSET() -> float {
    38.0
}

/// Where the module's centre lands, in board coordinates. Arbitrary -- each
/// board is its own file -- but keeps the pod in the same quadrant as the rest.
function POD_CENTRE() -> Vec2 {
    Vec2 { x: 100.0, y: 100.0 }
}

function header_span() -> float {
    ((HEADER_WAYS() - 1) * 1.0) * HEADER_PITCH()
}

/// The socket component's placement. `side` is -1 for the left socket, +1 for
/// the right.
///
/// The footprint runs pin 1 to pin 27 along its local +y and we want them
/// running up the board, so the socket is turned 180 degrees and its origin --
/// pin 1 -- sits at the bottom.
function socket_component(side: float, pads: Pad[]) -> Component {
    let c = POD_CENTRE();
    Component {
        ref: if (side < 0.0) {
            "J_L"
        } else {
            "J_R"
        },
        footprint: SOCKET_FOOTPRINT(),
        x: c.x + side * HEADER_ROW_SPACING() / 2.0,
        y: c.y + header_span() / 2.0,
        r: 180.0,
        layer: "F.Cu",
        pads: pads,
    }
}

function socket_pin_pos(sock: Component, pin: int) -> Vec2 {
    comp_to_global(sock, Vec2 { x: 0.0, y: ((pin - 1) * 1.0) * HEADER_PITCH() })
}

// -------------------------------------------------------------------- wiring

/// A signal that gets a trace on the pod: one header pin, one ribbon contact.
class PodLeg {
    net: string,
    /// Header pin number, so the socket's pads and its traces are cut from the
    /// one assignment. Deriving them separately -- pads in ribbon order, traces
    /// in contact order -- silently shorts every net on the side.
    pin_no: int,
    pin: Vec2,
    contact: Vec2,
}

/// Signals that need a GPIO and therefore a trace.
///
/// Ground does not: every ground conductor in the ribbon carries the net the
/// board is poured with, so it reaches the pour through the connector's own
/// contact. Power is routed separately, on the back.
function needs_gpio(s: Signal) -> bool {
    s.kind == SignalKind.Key
        || s.kind == SignalKind.LedData
        || s.kind == SignalKind.Spare
        || s.kind == SignalKind.Trackball
}

function contains_int(xs: int[], n: int) -> bool {
    xs.find((x) -> {
        x == n
    })
        != null
}

/// GPIO a socket can spend without touching the strapping pin -- the one
/// concession `pin_cost` orders last and this board never makes.
function socket_capacity(hdr: HeaderPin[]) -> int {
    hdr
        .filter((p) -> {
            is_gpio(p) && pin_cost(p.name) < 4
        })
        .length()
}

/// Pad numbers on a pod connector that its own socket cannot serve.
///
/// With the trackball fitted the right ribbon asks for more GPIO than its
/// socket has short of the strapping pin, so the overflow is served from the
/// other socket. It has to come off the highest-numbered pads -- the
/// southernmost contacts -- because those are the only ones a trace from
/// across the board can reach without crossing the fan: around the south end
/// of the socket and up the outboard side of the connector, where the only
/// other copper is the supply drop well to the north.
function cross_pad_numbers(sigs: Signal[], hdr: HeaderPin[]) -> int[] {
    let need = sigs
        .filter((s) -> {
            needs_gpio(s)
        })
        .length();
    let cap = socket_capacity(hdr);
    let out: int[] = [];
    if (need <= cap) {
        return out;
    }
    let i = sigs.length();
    while (i >= 1 && out.length() < need - cap) {
        let s = sigs.at(i - 1) ?? Signal { name: "", kind: SignalKind.Ground };
        if (needs_gpio(s)) {
            out.push(i);
        }
        i = i - 1;
    }
    out
}

/// The pins a socket spends on its own ribbon, cross-served pads excluded.
function socket_taken(
    hdr: HeaderPin[],
    sigs: Signal[],
) -> HeaderPin[] throws baml.errors.InvalidArgument {
    let n = sigs
        .filter((s) -> {
            needs_gpio(s)
        })
        .length()
        - cross_pad_numbers(sigs, hdr).length();
    choose_pins(hdr, n)
}

/// Distance from the socket's pin column to lane `k`, counting outward.
function pod_lane_x(side: float, k: int) -> float {
    let c = POD_CENTRE();
    c.x + side * (HEADER_ROW_SPACING() / 2.0 + CHANNEL_CLEARANCE() + (k * 1.0) * POD_LANE_PITCH())
}

/// Where a hand's ribbon connector sits: out past its own escape channel, on
/// the edge of the board, cable leaving sideways.
///
/// The cable enters this part over its own solder pads -- the BackFlip
/// actuator is at the rear -- so the contacts sit on the *outboard* side, 0.91
/// past the origin, and the body stands between them and the channel. The
/// mounting pegs land 1.79 inboard of the origin; this offset keeps them
/// clear of the outermost lane.
function pod_connector_pos(ways: int, side: float) -> Vec2 {
    let outer = pod_lane_x(side, pod_lanes(ways) - 1);
    Vec2 { x: outer + side * (POD_CONNECTOR_OFFSET() + 0.91), y: POD_CENTRE().y }
}

/// Turned so the contacts stack up the board and the cable-entry side -- the
/// contact side of the footprint, local -y -- faces outward, at the hand the
/// ribbon goes to.
function pod_connector_angle(side: float) -> float {
    if (side < 0.0) {
        90.0
    } else {
        270.0
    }
}

/// The connector body, for the board outline. Rotated with it, so the long
/// side runs up the board rather than across it.
function pod_connector_corners(ways: int, at: Vec2) -> Vec2[] {
    rect_corners(at, 5.0, ((ways * 1.0) + 6.0) / 2.0)
}

/// Match a hand's signals to its socket's pins.
///
/// Both columns run up the board, so this is a monotone matching: sort the
/// contacts by height, sort the pins by height, and pair them off. Any other
/// pairing would need a net to cross the whole channel.
function pod_legs(
    conn: Component,
    sock: Component,
    sigs: Signal[],
    pins: HeaderPin[],
    side: float,
    /// Pads served from the other socket -- see `cross_pad_numbers`.
    skip_pads: int[],
) -> PodLeg[] {
    let ways = conn.pads.length() - 1;
    let routed: PodLeg[] = [];
    let i = 1;
    for (let s in sigs) {
        if (needs_gpio(s) && !contains_int(skip_pads, i)) {
            routed.push(
                PodLeg {
                    net: s.name,
                    pin_no: 0,
                    pin: Vec2 { x: 0.0, y: 0.0 },
                    contact: comp_to_global(conn, ffc_pad_local(i, ways)),
                },
            );
        }
        i = i + 1;
    }
    // Highest contact first.
    let ordered = routed.sort_by((a, b) -> {
        if (a.contact.y < b.contact.y) {
            0 - 1
        } else if (a.contact.y > b.contact.y) {
            1
        } else {
            0
        }
    });
    // Highest pin first. The socket is turned 180 degrees, so pin 27 is at the
    // top and pin 1 at the bottom; ascending height is descending pin number.
    let by_height = pins.sort_by((a, b) -> {
        b.pin - a.pin
    });
    let out: PodLeg[] = [];
    let j = 0;
    for (let l in ordered) {
        let p = by_height.at(j) ?? no_pin();
        out.push(
            PodLeg {
                net: l.net,
                pin_no: p.pin,
                pin: socket_pin_pos(sock, p.pin),
                contact: l.contact,
            },
        );
        j = j + 1;
    }
    out
}

/// The half of a fan whose pins reach DOWN the board to their contacts.
///
/// These are the pins above the middle: the contacts are packed tighter than
/// the pins, so a pin near the top of the socket meets a contact well below it.
function pod_reaches_down(l: PodLeg) -> bool {
    l.contact.y > l.pin.y
}

/// Sideways out of the socket, up or down its lane, sideways into the contact.
///
/// Three segments, no diagonal. See the argument at the top of the file for
/// why nothing here can cross -- and `no two nets cross on the same layer` in
/// `pod_test.baml`, which checks it rather than taking its word for it.
function route_pod_side(legs: PodLeg[], side: float, out: Track[]) -> void {
    // Both halves are already in ascending order of height.
    let down = legs.filter((l) -> {
        pod_reaches_down(l)
    });
    let up = legs.filter((l) -> {
        !pod_reaches_down(l)
    });
    // The pin whose contact is furthest away gets the outermost lane: the top
    // of the down half, the bottom of the up half.
    let n = down.length();
    let k = 0;
    for (let l in down) {
        route_pod_leg(l, side, n - 1 - k, out);
        k = k + 1;
    }
    let j = 0;
    for (let l in up) {
        route_pod_leg(l, side, j, out);
        j = j + 1;
    }
}

function route_pod_leg(l: PodLeg, side: float, lane: int, out: Track[]) -> void {
    let x = pod_lane_x(side, lane);
    let a = Vec2 { x: x, y: l.pin.y };
    let b = Vec2 { x: x, y: l.contact.y };
    out.push(seg(l.pin, a, l.net));
    out.push(seg(a, b, l.net));
    out.push(seg(b, l.contact, l.net))
}

/// The bigger of the two halves, which is what the channel has to be wide
/// enough for.
function pod_half_width(legs: PodLeg[]) -> int {
    let d = legs
        .filter((l) -> {
            pod_reaches_down(l)
        })
        .length();
    let u = legs.length() - d;
    if (d > u) {
        d
    } else {
        u
    }
}

/// The left-socket pins that serve the right connector's overflow pads.
///
/// Taken from what the left socket has spare after its own ribbon and the
/// buttons, cheapest concession first -- with the trackball fitted that is
/// IO40 (SD domain) and the three JTAG pins. Returned northernmost pin first,
/// which is the order `route_pod_cross` nests them in.
function pod_cross_pins(
    n: int,
    left_taken: HeaderPin[],
    btns: ButtonPin[],
) -> HeaderPin[] throws baml.errors.InvalidArgument {
    let btn_names = btns
        .filter((b) -> {
            b.side < 0.0
        })
        .map((b) -> {
            b.pin.name
        });
    let avail = spare_pins(HEADER_LEFT(), left_taken).filter((p) -> {
        !contains_str(btn_names, p.name)
    });
    if (avail.length() < n) {
        throw baml.errors.InvalidArgument {
            message: `cross-socket overflow needs ${n} pins but the left socket has ${avail.length()} spare`
        };
    }
    let taken: HeaderPin[] = [];
    let i = 0;
    while (i < n) {
        taken.push(avail.at(i) ?? no_pin());
        i = i + 1;
    }
    // The socket is turned 180 degrees, so descending pin number is ascending
    // y: highest pin first puts the northernmost pin first.
    taken.sort_by((a, b) -> {
        b.pin - a.pin
    })
}

/// Match the overflow pads to their left-socket pins.
///
/// The pairing is fixed by the route's nesting (see `route_pod_cross`): the
/// northernmost pin takes the outermost mid-lane, the shallowest row and the
/// innermost outboard lane, which lands it on the southernmost pad. So pins
/// north-first pair with pads south-first.
function pod_cross_legs(
    conn_r: Component,
    sock_l: Component,
    sigs_r: Signal[],
    pads: int[],
    pins: HeaderPin[],
) -> PodLeg[] {
    let ways = conn_r.pads.length() - 1;
    let south_first = pads.sort_by((a, b) -> {
        b - a
    });
    let out: PodLeg[] = [];
    let k = 0;
    for (let p in pins) {
        let pad = south_first.at(k) ?? 0;
        let s = sigs_r.at(pad - 1) ?? Signal { name: "", kind: SignalKind.Ground };
        out.push(
            PodLeg {
                net: s.name,
                pin_no: p.pin,
                pin: socket_pin_pos(sock_l, p.pin),
                contact: comp_to_global(conn_r, ffc_pad_local(pad, ways)),
            },
        );
        k = k + 1;
    }
    out
}

/// Route the overflow legs: left socket pins to right-connector pads, all on
/// the front, around the south end of the right socket.
///
/// Each leg is five segments: east out of its pin, south down a mid-lane
/// between the module's sockets, east along a row below the right socket's
/// bottom pin, north up an outboard lane east of the connector's contacts, and
/// west into its pad. Planarity is the same nesting argument as the fan,
/// applied three times: the northernmost pin takes the outermost mid-lane (its
/// exit crosses nobody's lane), the shallowest row (nobody's lane passes its
/// end), and the innermost outboard lane paired with the southernmost pad
/// (nobody's entry crosses its climb). Legs are given northernmost pin first.
///
/// The mid-lanes run just east of SW2 -- which `build_pod_board` moves inboard
/// when the overflow exists -- and west of the right socket's pads; the rows
/// clear the socket's bottom pad and the button's; the outboard lanes clear
/// the contacts on one side and the supply drop's via stays north of every
/// climb. A pin abreast of the stitching vias jogs south before running east.
function route_pod_cross(legs: PodLeg[], out: Track[]) -> void {
    let c = POD_CENTRE();
    let k = 0;
    for (let l in legs) {
        let mid = Vec2 { x: c.x + 10.2 - (k * 1.0) * 0.6, y: c.y + 34.6 + (k * 1.0) * 0.6 };
        let outb = l.contact.x + 1.68 + (k * 1.0) * 0.6;
        let exit_y = if ((l.pin.y - (c.y - 26.0)).abs() < 2.0) {
            c.y - 23.8
        } else {
            l.pin.y
        };
        if (exit_y != l.pin.y) {
            let jog = Vec2 { x: l.pin.x + 2.7, y: l.pin.y };
            out.push(seg(l.pin, jog, l.net));
            out.push(seg(jog, Vec2 { x: jog.x, y: exit_y }, l.net));
            out.push(seg(Vec2 { x: jog.x, y: exit_y }, Vec2 { x: mid.x, y: exit_y }, l.net));
        } else {
            out.push(seg(l.pin, Vec2 { x: mid.x, y: exit_y }, l.net));
        }
        out.push(seg(Vec2 { x: mid.x, y: exit_y }, mid, l.net));
        out.push(seg(mid, Vec2 { x: outb, y: mid.y }, l.net));
        out.push(seg(Vec2 { x: outb, y: mid.y }, Vec2 { x: outb, y: l.contact.y }, l.net));
        out.push(seg(Vec2 { x: outb, y: l.contact.y }, l.contact, l.net));
        k = k + 1;
    }
}

/// Stitch the copper under the module to the back.
///
/// Each escape channel is a wall of about twenty parallel traces running most
/// of the height of the board, and between the two of them the front pour is
/// nearly fenced off from the rest. It escapes over the top of the channels,
/// but only just; these tie it to the back pour, which nothing cuts.
function pod_stitching_vias() -> Via[] {
    let c = POD_CENTRE();
    [
        Via { at: Vec2 { x: c.x - 6.0, y: c.y - 26.0 }, net: "GND" },
        Via { at: Vec2 { x: c.x + 6.0, y: c.y - 26.0 }, net: "GND" },
        Via { at: Vec2 { x: c.x - 6.0, y: c.y + 26.0 }, net: "GND" },
        Via { at: Vec2 { x: c.x + 6.0, y: c.y + 26.0 }, net: "GND" },
    ]
}

function find_header_pin(hdr: HeaderPin[], name: string) -> HeaderPin {
    hdr.find((p) -> {
        p.name == name
    })
        ?? no_pin()
}

// --------------------------------------------------------------- the board

function POD_ID() -> string {
    "pod"
}

function pod_ribbon(ribbons: Ribbon[], hand: string) -> Ribbon throws baml.errors.InvalidArgument {
    find_ribbon(ribbons, `pod_to_finger_${hand}`)
}

function build_pod_board(
    ribbons: Ribbon[],
    f: Features,
) -> Board throws baml.errors.InvalidArgument {
    let c = POD_CENTRE();
    let left_r = pod_ribbon(ribbons, "l");
    let right_r = pod_ribbon(ribbons, "r");

    // The pod is the from-end of both ribbons, so its pads are assigned from
    // the reversed lists -- see `from_end_signals`. `pod_legs` gets the same
    // list, so contact i and pad i agree on their net.
    let sigs_l = from_end_signals(left_r.signals);
    let sigs_r = from_end_signals(right_r.signals);

    // Pads a socket cannot serve are served from across the board; with the
    // trackball fitted that is four of the right connector's tail.
    let cross_pads = cross_pad_numbers(sigs_r, HEADER_RIGHT());
    let left_pins = socket_taken(HEADER_LEFT(), sigs_l);
    let right_pins = socket_taken(HEADER_RIGHT(), sigs_r);

    // Ribbon contacts take a GPIO each; the buttons take what is left. Which
    // side they take it from is decided by cost, not by symmetry: with LEDs
    // fitted the right socket has exactly one pin spare and it is the strapping
    // pin, so a button per side would put one there. Both can share a socket --
    // see `route_buttons` for why that still routes.
    let btns = button_pins(spare_pins(HEADER_LEFT(), left_pins), spare_pins(HEADER_RIGHT(), right_pins), 2);

    // Socket pads. Every pin the module grounds is tied to the pour; the rails
    // it supplies are left alone unless something on this board wants them.
    let want_5v = left_r.signals.concat(right_r.signals).find((s) -> {
        s.kind == SignalKind.Power
    })
        != null;
    // A socket's pin positions do not depend on its nets, so the geometry is
    // built first, the assignment is made against it, and the pads are cut from
    // that assignment.
    let sock_l = socket_component(0.0 - 1.0, []);
    let sock_r = socket_component(1.0, []);

    let conn_l = connector_component(
        "J1",
        sigs_l,
        pod_connector_pos(left_r.signals.length(), 0.0 - 1.0),
        pod_connector_angle(0.0 - 1.0),
    );
    let conn_r = connector_component("J2", sigs_r, pod_connector_pos(right_r.signals.length(), 1.0), pod_connector_angle(1.0));

    let legs_l = pod_legs(conn_l, sock_l, sigs_l, left_pins, 0.0 - 1.0, []);
    let legs_r = pod_legs(conn_r, sock_r, sigs_r, right_pins, 1.0, cross_pads);
    let cross = pod_cross_legs(conn_r, sock_l, sigs_r, cross_pads, pod_cross_pins(cross_pads.length(), left_pins, btns));
    let sock_l2 = socket_component(0.0 - 1.0, socket_pads(HEADER_LEFT(), legs_l.concat(cross), btns, 0.0 - 1.0, want_5v));
    let sock_r2 = socket_component(1.0, socket_pads(HEADER_RIGHT(), legs_r, btns, 1.0, want_5v));

    // Buttons sit past the end of the module, which is the only part of the
    // board a finger can reach once the module is seated on its sockets. The
    // ribbons leave sideways, so nothing else wants this strip. SW2 moves
    // inboard when the cross legs exist: their mid-lanes need the strip just
    // east of it.
    let btn_y = c.y + POD_END_OFFSET();
    let sw_l = button_component("SW1", Vec2 { x: c.x - 7.0, y: btn_y }, "BTN1");
    let sw_r_x = if (cross.length() > 0) {
        c.x + 4.0
    } else {
        c.x + 7.0
    };
    let sw_r = button_component("SW2", Vec2 { x: sw_r_x, y: btn_y }, "BTN2");

    let comps = [sock_l2, sock_r2, conn_l, conn_r, sw_l, sw_r];

    // Outline: the module body, the connectors and the buttons.
    let corners: Vec2[] = [];
    for (let p in rect_corners(c, MODULE_WIDTH() / 2.0, MODULE_LEN() / 2.0)) {
        corners.push(p);
    }
    for (let p in pod_connector_corners(left_r.signals.length(), comp_at(conn_l))) {
        corners.push(p);
    }
    for (let p in pod_connector_corners(right_r.signals.length(), comp_at(conn_r))) {
        corners.push(p);
    }
    for (let p in rect_corners(Vec2 { x: c.x, y: btn_y }, 12.0, 4.0)) {
        corners.push(p);
    }
    // The cross legs' rows and outboard lanes run through the board's SE
    // notch, between the button strip and the right connector; fill it.
    if (cross.length() > 0) {
        for (let p in rect_corners(Vec2 { x: c.x + 34.0, y: c.y + 27.0 }, 5.5, 10.5)) {
            corners.push(p);
        }
    }

    // The LED supply rail runs past the top of the module, above the escape
    // channels, which reach no higher than the topmost pin.
    let rail_y = c.y - POWER_RAIL_OFFSET();
    if (want_5v) {
        for (let p in rect_corners(Vec2 { x: c.x, y: rail_y }, comp_at(conn_r).x - c.x, 0.5)) {
            corners.push(p);
        }
    }

    let mounts = pod_mounting_holes();
    for (let m in mounts) {
        comps.push(m);
        for (let p in rect_corners(comp_at(m), 3.0, 3.0)) {
            corners.push(p);
        }
    }

    let outline = expand_hull(convex_hull(corners), BOARD_MARGIN());

    // Routing.
    let tracks: Track[] = [];
    route_pod_side(legs_l, 0.0 - 1.0, tracks);
    route_pod_side(legs_r, 1.0, tracks);
    route_pod_cross(cross, tracks);

    let vias = pod_stitching_vias();
    route_buttons([sw_l, sw_r], btns, sock_l, sock_r, tracks, vias);

    if (want_5v) {
        route_pod_power([conn_l, conn_r], sock_r, rail_y, tracks, vias);
    }

    let b = Board {
        id: POD_ID(),
        components: comps,
        outline: outline,
        tracks: tracks,
        vias: vias,
        zones: [],
    };
    Board {
        id: b.id,
        components: b.components,
        outline: b.outline,
        tracks: b.tracks,
        vias: b.vias,
        zones: ground_zones(b),
    }
}

function rect_corners(at: Vec2, hw: float, hh: float) -> Vec2[] {
    [
        Vec2 { x: at.x - hw, y: at.y - hh },
        Vec2 { x: at.x + hw, y: at.y - hh },
        Vec2 { x: at.x + hw, y: at.y + hh },
        Vec2 { x: at.x - hw, y: at.y + hh },
    ]
}

/// Socket pads, taken straight from the routing assignment.
///
/// Pins the module grounds are tied to the pour; the rails it supplies are left
/// alone unless something on this board wants one; every other pin carries
/// whatever `pod_legs` decided it carries, and unused pins get no net at all.
function socket_pads(
    hdr: HeaderPin[],
    legs: PodLeg[],
    btns: ButtonPin[],
    side: float,
    want_5v: bool,
) -> Pad[] {
    let pads: Pad[] = [];
    for (let p in hdr) {
        let btn_net = button_net_for(btns, side, p);
        let net = if (p.name == "GND") {
            "GND"
        } else if (p.name == "5V" && want_5v) {
            LED_VDD_NET()
        } else if (btn_net != "") {
            btn_net
        } else {
            (
                legs
                    .find((l) -> {
                        l.pin_no == p.pin
                    })
                    ?.net
            )
                ?? ""
        };
        if (net != "") {
            pads.push(Pad { pad: `${p.pin}`, net: net });
        }
    }
    pads
}

function button_component(ref: string, at: Vec2, net: string) -> Component {
    Component {
        ref: ref,
        footprint: BUTTON_FOOTPRINT(),
        x: at.x,
        y: at.y,
        r: 0.0,
        layer: "F.Cu",
        // The other terminal goes to the pour, like every switch on this board.
        pads: [Pad { pad: "1", net: net }, Pad { pad: "2", net: "GND" }],
    }
}

/// The SKQG's two tabs per terminal are two islands of copper.
///
/// The real part bridges them inside the switch body; a board file has no way
/// to know that, so terminal 1 arrives as two pads with one net and nothing
/// joining them. Terminal 2 is grounded and the pour joins it for free.
function BUTTON_LINK_PAD() -> Vec2 {
    Vec2 { x: 0.0 - 3.1, y: 0.0 - 1.85 }
}

/// How far inboard of the socket a button's run turns up the board.
///
/// The run has to reach a pin in the middle of a column of 2.54mm
/// through-holes. Approaching on a diagonal shaves every pad it passes; coming
/// up a clear lane and turning in square means the only copper near the column
/// is a short stub at the target pin's own height.
function PIN_APPROACH() -> float {
    4.0
}

/// A button and the pin it reaches.
class ButtonPin {
    /// -1 for the left socket, +1 for the right.
    side: float,
    pin: HeaderPin,
}

/// The `n` cheapest spare pins across both sockets.
///
/// Ranked across the pair rather than one per side. Taking one from each puts a
/// button on whatever that side happens to have left, which in the LED variant
/// is the strapping pin -- the one concession worth never making.
function button_pins(left: HeaderPin[], right: HeaderPin[], n: int) -> ButtonPin[] {
    let all: ButtonPin[] = [];
    for (let p in left) {
        all.push(ButtonPin { side: 0.0 - 1.0, pin: p });
    }
    for (let p in right) {
        all.push(ButtonPin { side: 1.0, pin: p });
    }
    let ranked = all.sort_by((a, b) -> {
        let d = pin_cost(a.pin.name) - pin_cost(b.pin.name);
        if (d != 0) {
            d
        } else {
            a.pin.pin - b.pin.pin
        }
    });
    let out: ButtonPin[] = [];
    let i = 0;
    while (i < n && i < ranked.length()) {
        out.push(ranked.at(i) ?? ButtonPin { side: 0.0, pin: no_pin() });
        i = i + 1;
    }
    // Within a socket, lower pins are served by inner lanes; see `route_buttons`.
    out.sort_by((a, b) -> {
        a.pin.pin - b.pin.pin
    })
}

function side_pin(btns: ButtonPin[], side: float, nth: int) -> HeaderPin {
    (
        btns
            .filter((b) -> {
                b.side == side
            })
            .at(nth)
            ?.pin
    )
        ?? no_pin()
}

/// Buttons reach their pins on the back.
///
/// The front between the sockets is pour and the front outside them is the
/// escape channels; the back under the module is empty, and a header pin is
/// through-hole, so each run needs one via at the button and none at the pin.
///
/// Two buttons may share a socket, and then they nest. The staircase runs the
/// other way here: the buttons sit *inboard* of the socket, so a run reaching
/// the lane nearest the pin column has to cross every lane outboard of it. The
/// nearest lane therefore drops to the back furthest down the board, and each
/// lane further out drops 2mm shallower, so every crossing happens below the
/// bottom of the lane being crossed.
function route_buttons(
    sws: Component[],
    btns: ButtonPin[],
    sock_l: Component,
    sock_r: Component,
    out: Track[],
    vias: Via[],
) -> void {
    let n_l = btns
        .filter((b) -> {
            b.side < 0.0
        })
        .length();
    let n_r = btns.length() - n_l;
    let lanes_l = 0;
    let lanes_r = 0;
    let i = 0;
    for (let b in btns) {
        let sw = sws.at(i) ?? sws.at(0) ?? no_component();
        let sock = if (b.side < 0.0) {
            sock_l
        } else {
            sock_r
        };
        let rank = if (b.side < 0.0) {
            lanes_l
        } else {
            lanes_r
        };
        let n = if (b.side < 0.0) {
            n_l
        } else {
            n_r
        };
        route_button(sw, socket_pin_pos(sock, b.pin.pin), b.side, rank, n - 1 - rank, `BTN${i + 1}`, out, vias);
        if (b.side < 0.0) {
            lanes_l = lanes_l + 1;
        } else {
            lanes_r = lanes_r + 1;
        }
        i = i + 1;
    }
}

function no_component() -> Component {
    Component { ref: "", footprint: "", x: 0.0, y: 0.0, r: 0.0, layer: "F.Cu", pads: [] }
}

function route_button(
    sw: Component,
    pin: Vec2,
    side: float,
    /// Lane index, counting outward from the pin column.
    rank: int,
    /// How far down the board this run drops to the back. Inner lanes drop
    /// deepest; see `route_buttons`.
    depth: int,
    net: string,
    out: Track[],
    vias: Via[],
) -> void {
    let pad = comp_to_global(sw, BUTTON_SIGNAL_PAD());
    out.push(seg(pad, comp_to_global(sw, BUTTON_LINK_PAD()), net));

    let v = Vec2 { x: pad.x, y: pad.y - 1.5 + (depth * 1.0) * 2.0 };
    out.push(seg(pad, v, net));
    vias.push(Via { at: v, net: net });

    let lane = pin.x - side * (PIN_APPROACH() + (rank * 1.0) * 2.0);
    out.push(back(v, Vec2 { x: lane, y: v.y }, net));
    out.push(back(Vec2 { x: lane, y: v.y }, Vec2 { x: lane, y: pin.y }, net));
    out.push(back(Vec2 { x: lane, y: pin.y }, pin, net))
}

function back(a: Vec2, b: Vec2, net: string) -> Track {
    Track { start: a, end: b, width: TRACE_W(), layer: "B.Cu", net: net }
}

/// How far above the module's centre the LED supply rail runs.
///
/// Past the top of the escape channels -- no lane reaches higher than the
/// topmost pin -- and clear of the mounting holes.
function POWER_RAIL_OFFSET() -> float {
    42.0
}

/// The LED supply, when the LED variant is built.
///
/// One rail however many conductors the ribbon gives it, and one pin to reach:
/// 5V, at the top of the right socket. Each supply contact drops to the back
/// beside its own connector, runs up the outside of its channel to a rail
/// above the module, and comes in along that rail. The whole path is on the
/// back, where the only other copper is the buttons -- and they are at the
/// other end of the board.
function route_pod_power(
    conns: Component[],
    sock_r: Component,
    rail_y: float,
    out: Track[],
    vias: Via[],
) -> void {
    let pin = socket_pin_pos(sock_r, find_header_pin(HEADER_RIGHT(), "5V").pin);
    let net = LED_VDD_NET();
    let any = false;
    for (let conn in conns) {
        let side = if (conn.x < POD_CENTRE().x) {
            0.0 - 1.0
        } else {
            1.0
        };
        // Outboard of the contacts, where the channel is not.
        let lane = conn.x + side * 2.0;
        let ways = conn.pads.length() - 1;
        let i = 1;
        for (let p in conn.pads) {
            if (p.pad != "MP") {
                if (p.net == net) {
                    let pad = comp_to_global(conn, ffc_pad_local(i, ways));
                    let v = Vec2 { x: pad.x + side * 2.0, y: pad.y };
                    out.push(seg(pad, v, net));
                    vias.push(Via { at: v, net: net });
                    out.push(back(v, Vec2 { x: lane, y: rail_y }, net));
                    out.push(back(Vec2 { x: lane, y: rail_y }, Vec2 { x: pin.x, y: rail_y }, net));
                    any = true;
                }
                i = i + 1;
            }
        }
    }
    if (any) {
        out.push(back(Vec2 { x: pin.x, y: rail_y }, pin, net));
    }
}

/// M2 past each end of the module.
///
/// Off the ends rather than the sides now that the ribbons leave sideways: the
/// sides are escape channel for most of the board's height, and the two strips
/// past the module are the only copper-free ground left. They are also the
/// only places a screw head clears the module, which stands 8mm off the board
/// on its headers.
function pod_mounting_holes() -> Component[] {
    let c = POD_CENTRE();
    let out: Component[] = [];
    let i = 1;
    for (let sx in [0.0 - 1.0, 1.0]) {
        for (let sy in [0.0 - 1.0, 1.0]) {
            out.push(
                Component {
                    ref: `H${i}`,
                    footprint: MOUNTING_HOLE_FOOTPRINT(),
                    x: c.x + sx * 22.0,
                    y: c.y + sy * POD_END_OFFSET(),
                    r: 0.0,
                    layer: "F.Cu",
                    pads: [],
                },
            );
            i = i + 1;
        }
    }
    out
}

function comp_at(c: Component) -> Vec2 {
    Vec2 { x: c.x, y: c.y }
}

// ------------------------------------------------------------------- report
//
// The pin assignment is the pod's real output: it is what firmware has to be
// told, and it is chosen here rather than written down anywhere.

function pod_pinout(f: Features) -> string throws baml.errors.InvalidArgument {
    let mods = partition_modules(all_keys());
    let ribbons = build_ribbons(mods, f);
    let btns = pod_button_pins(ribbons, f);
    let lines: string[] = [];
    for (let hand in ["l", "r"]) {
        let r = pod_ribbon(ribbons, hand);
        let hdr = if (hand == "l") {
            HEADER_LEFT()
        } else {
            HEADER_RIGHT()
        };
        let side = if (hand == "l") {
            0.0 - 1.0
        } else {
            1.0
        };
        let gpio = r.signals.filter((s) -> {
            needs_gpio(s)
        });
        let sigs = from_end_signals(r.signals);
        let cross_pads = cross_pad_numbers(sigs, hdr);
        let pins = socket_taken(hdr, sigs);
        let sock = socket_component(side, []);
        let conn = connector_component("J", sigs, pod_connector_pos(r.signals.length(), side), pod_connector_angle(side));
        let legs = pod_legs(conn, sock, sigs, pins, side, cross_pads);

        lines.push(`${hand.to_upper_case()} socket -- ${gpio.length()} signals`);
        for (
            let l in legs.sort_by((a, b) -> {
                a.pin_no - b.pin_no
            })
        ) {
            let name = (
                hdr
                    .find((p) -> {
                        p.pin == l.pin_no
                    })
                    ?.name
            )
                ?? "?";
            let cost = pin_cost(name);
            let note = if (cost == 0) {
                ""
            } else {
                `  <- ${concession(name)}`
            };
            lines.push(`  pin ${l.pin_no}\t${name}\t${l.net}${note}`);
        }
        let left_over = spare_pins(hdr, pins);
        let mine = btns.filter((b) -> {
            b.side == side
        });
        for (let b in mine) {
            let note = if (pin_cost(b.pin.name) == 0) {
                ""
            } else {
                `  <- ${concession(b.pin.name)}`
            };
            lines.push(
                `  pin ${b.pin.pin}\t${b.pin.name}\t${button_net_for(btns, side, b.pin)}${note}`,
            );
        }
        let taken_btn = mine.map((b) -> {
            b.pin.name
        });
        // Overflow from the OTHER socket's connector, served by this one.
        let cross_names: string[] = [];
        if (hand == "l") {
            let sigs_r = from_end_signals(pod_ribbon(ribbons, "r").signals);
            let pads_r = cross_pad_numbers(sigs_r, HEADER_RIGHT());
            if (pads_r.length() > 0) {
                let cpins = pod_cross_pins(pads_r.length(), pins, btns);
                let south_first = pads_r.sort_by((a, b) -> {
                    b - a
                });
                let k = 0;
                for (let p in cpins) {
                    let pad = south_first.at(k) ?? 0;
                    let net = (sigs_r.at(pad - 1)?.name) ?? "?";
                    let note = if (pin_cost(p.name) == 0) {
                        ""
                    } else {
                        `  <- ${concession(p.name)}`
                    };
                    lines.push(`  pin ${p.pin}\t${p.name}\t${net} (right ribbon pad ${pad})${note}`);
                    cross_names.push(p.name);
                    k = k + 1;
                }
            }
        }
        lines.push(
            `  unused: ${left_over.filter((p) -> { !contains_str(taken_btn, p.name) && !contains_str(cross_names, p.name) }).map((p) -> { p.name }).join(", ")}`,
        );
        lines.push("");
    }
    lines.join("\n")
}

function concession(name: string) -> string {
    if (contains_str(SD_DOMAIN_PINS(), name)) {
        "needs LDO_VO4 enabled (SD-card domain)"
    } else if (contains_str(UART0_PINS(), name)) {
        "costs the UART0 console"
    } else if (contains_str(JTAG_PINS(), name)) {
        "costs hardware JTAG"
    } else if (contains_str(STRAP_PINS(), name)) {
        "STRAPPING PIN -- a key held at boot changes boot mode"
    } else {
        ""
    }
}

function pinout() -> string throws baml.errors.InvalidArgument {
    pod_pinout(features_base())
}

function pinout_leds() -> string throws baml.errors.InvalidArgument {
    pod_pinout(features_leds())
}

function pinout_trackball() -> string throws baml.errors.InvalidArgument {
    pod_pinout(features_trackball())
}

/// Which button, if any, is wired to this pin. Buttons are numbered in the
/// order `button_pins` returns them, which is the order they are placed.
function button_net_for(btns: ButtonPin[], side: float, p: HeaderPin) -> string {
    let i = 0;
    for (let b in btns) {
        if (b.side == side && b.pin.pin == p.pin && p.pin != 0) {
            return `BTN${i + 1}`;
        }
        i = i + 1;
    }
    ""
}

/// The buttons' pins, chosen the same way `build_pod_board` chooses them.
function pod_button_pins(
    ribbons: Ribbon[],
    f: Features,
) -> ButtonPin[] throws baml.errors.InvalidArgument {
    let spares: HeaderPin[][] = [];
    for (let hand in ["l", "r"]) {
        let hdr = header_for(hand);
        let sigs = from_end_signals(pod_ribbon(ribbons, hand).signals);
        spares.push(spare_pins(hdr, socket_taken(hdr, sigs)));
    }
    button_pins(spares.at(0) ?? [], spares.at(1) ?? [], 2)
}
