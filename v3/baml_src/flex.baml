// Cutting a flat board so it can be bent into a key well.
//
// The board stays rigid 0.6mm FR4 -- it is its own stiffener, which is what
// lets an MX switch mount to it. Compliance is CUT IN, not bought as material:
//
//   * a column becomes a narrow STRIP, which bends along its length;
//   * across each strip, rows of SLOTS leave narrow LIGAMENTS that act as
//     hinges, so the column's curvature is taken in a few discrete folds;
//   * between strips, a serpentine NECK carries the traces across and absorbs
//     the out-of-surface step between adjacent columns.
//
// This is BastardKB's construction (Dactyl-Manuform-PCB-Plate), measured: 15.8mm
// strips 5.7-7.7mm apart, hinge rows every half key pitch, 1.0mm slots leaving
// three ~2mm ligaments, and 6 traces through one neck at 0.135mm.
//
// Nothing here writes down a hinge count or a ligament count. Both fall out --
// the hinges from the well's `alpha`, the ligaments from how many traces have
// to cross.

// --------------------------------------------------------------- fabrication

/// Trace width in the flex zones.
///
/// Deliberately not the board's general trace width: a trace that crosses a
/// hinge is on a part that bends, and BastardKB's 0.135mm is the field-proven
/// figure. Wider is stiffer and more likely to lift; narrower gains little.
function FLEX_TRACE_W() -> float {
    0.135
}

/// Copper-to-copper spacing in the flex zones.
function FLEX_TRACE_SPACE() -> float {
    0.15
}

/// Copper to board edge. A cut edge in a bending region is where cracks start,
/// so this is wider than the usual 0.2mm.
function FLEX_EDGE_CLEAR() -> float {
    0.3
}

/// How far the widest switch footprint's copper reaches either side of its key
/// centre.
///
/// Kailh hotswap socket, terminal 2: its pad runs out to x = -8.36 in the key's
/// own frame, 1.24mm further than terminal 1 reaches the other way. The SOCKET,
/// not the keycap, is what decides how narrow a column strip can be. It is also
/// why BastardKB's 15.8mm strips are not a width to copy: their plate takes a
/// soldered MX switch, whose two through-holes sit at +/-3.81 and fit anywhere.
///
/// `the strip is as wide as the switch socket needs` checks this against the
/// installed footprint, so a library change fails the build.
function SWITCH_HALF_SPAN() -> float {
    8.36
}

/// Narrowest a column strip can be and still carry a switch.
function min_strip_width() -> float {
    2.0 * (SWITCH_HALF_SPAN() + BOARD_EDGE_CLEAR())
}

/// Copper layers available to cross a hinge.
///
/// Both, and that is a compromise worth naming: on a bend only the neutral
/// axis is strain-free, and a 2-layer board puts copper on both surfaces
/// instead. BastardKB does the same and survives, because the folds are
/// one-time sets rather than repeated flexing.
function FLEX_LAYERS() -> int {
    2
}

/// Traces that fit across a ligament of width `w`.
function traces_per_ligament(w: float) -> int {
    let usable = w - 2.0 * FLEX_EDGE_CLEAR();
    if (usable < FLEX_TRACE_W()) {
        return 0;
    }
    let pitch = FLEX_TRACE_W() + FLEX_TRACE_SPACE();
    // A nanometre of slack. `width_for_traces` is the exact inverse of this,
    // and without it the round trip loses a trace to the last bit of a float:
    // a neck sized for eight came back carrying six.
    let n = ((usable - FLEX_TRACE_W()) / pitch + 1.0 + 0.000001).floor();
    let i = n.iround() catch_all (e) {
        _ => 0
    };
    i * FLEX_LAYERS()
}

/// Ligaments needed to get `n` traces across a hinge row.
function ligaments_for(n: int, lig_w: float) -> int {
    let per = traces_per_ligament(lig_w);
    if (per < 1) {
        return 0;
    }
    let need = ((n * 1.0) / (per * 1.0)).ceil();
    let i = need.iround() catch_all (e) {
        _ => 1
    };
    // Two is the floor regardless of the trace count: one ligament is a hinge
    // that also twists, and the strip has to stay square to its neighbours.
    if (i < 2) {
        2
    } else {
        i
    }
}

// ------------------------------------------------------------------ geometry

class FlexParams {
    /// Edge-to-edge gap between adjacent column strips. The necks live here.
    gap: float,
    /// Strip overhang past the outermost key of a column.
    ///
    /// Has to cover the switch's own footprint, not just reach it: at 4mm the
    /// paper proof left the top and bottom keys' 14mm plate cut-outs hanging
    /// over the end of the strip with nothing to solder to.
    end_margin: float,
    /// Width of a hinge slot -- the cut itself.
    slot_w: float,
    /// Material left between two slots of the same hinge row.
    ligament_w: float,
    /// Distance between the two hinge rows serving one inter-key gap.
    hinge_spacing: float,
    /// Keep-out around a switch centre that a hinge row must not enter.
    switch_clear: float,
    /// Floor on a neck's perpendicular width. The actual width is whatever
    /// its traces need -- see `neck_width`.
    neck_w: float,
}

/// Gap between adjacent strips, and so the width of every neck's home.
///
/// Derived, not chosen: the strips have to be wide enough for the switch
/// sockets, the column pitch is fixed by the well, and the necks get whatever
/// is left. On Toto that is 22.496 less 17.72, so 4.78mm.
function default_gap() -> float {
    developed_col_pitch(ROSEBEAR_WELL()) - min_strip_width()
}

/// Defaults, tracking the measured BastardKB board where there is a number to
/// track and the well where there is not.
function flex_defaults() -> FlexParams {
    FlexParams {
        gap: default_gap(),
        end_margin: 9.0,
        slot_w: 1.0,
        ligament_w: 2.0,
        hinge_spacing: 4.0,
        switch_clear: 7.5,
        neck_w: 1.0,
    }
}

/// One column of the board, as a strip that bends along its length.
class Strip {
    column: string,
    /// Centreline of the strip.
    cx: float,
    /// Half the strip width.
    half_w: float,
    /// Extent along the column, low to high.
    y0: float,
    y1: float,
    /// Key centres along the column, ascending.
    key_ys: float[],
}

/// Strip width for a given column pitch: the pitch less the gap the necks need.
function strip_width(w: Well, p: FlexParams) -> float {
    developed_col_pitch(w) - p.gap
}

/// Cut a module's keys into one strip per column.
///
/// Assumes the columns are square to each other, which the unrolled layout
/// guarantees -- `config_dactyl.baml` drops splay precisely so this holds.
///
/// Returned west to east, whichever hand: the right half is the left mirrored,
/// so its columns run the other way along x and `flex_ring`, which walks the
/// strips in order, would fold the outline back through itself. Sorting here
/// rather than at the call site keeps that a property of a strip list.
function strips_of(keys: PlacedKey[], w: Well, p: FlexParams) -> Strip[] {
    let half_w = strip_width(w, p) / 2.0;
    let out: Strip[] = [];
    for (let cname in COLUMN_ORDER()) {
        let ks = keys.filter((k) -> {
            k.column == cname
        });
        if (ks.length() > 0) {
            let ys = ks
                .map((k) -> {
                    k.y
                })
                .sort_by((a, b) -> {
                    if (a < b) {
                        0 - 1
                    } else {
                        1
                    }
                });
            let lo = ys.at(0) ?? 0.0;
            let hi = ys.at(ys.length() - 1) ?? 0.0;
            let cx = ks.reduce(
                (a, k) -> {
                    a + k.x
                },
                0.0,
            )
                / (ks.length() * 1.0);
            out.push(
                Strip {
                    column: cname,
                    cx: cx,
                    half_w: half_w,
                    y0: lo - p.end_margin,
                    y1: hi + p.end_margin,
                    key_ys: ys,
                },
            );
        }
    }
    out.sort_by((a, b) -> {
        if (a.cx < b.cx) {
            0 - 1
        } else {
            1
        }
    })
}

/// Conductors that have to cross one hinge row inside a strip.
///
/// Not the same question as `matrix_neck_traces`. Within a strip the traffic is
/// whatever has to reach a key BEYOND the hinge: the strip's own column line,
/// the row lines for the keys past it, and a ground stitch. The neck lands
/// level with the middle of the strip, so the worst hinge is the one nearest
/// the neck and it carries half the rows.
function strip_hinge_traces(n_rows: int) -> int {
    1 + n_rows / 2 + 1
}

// -------------------------------------------------------------------- hinges

/// Where the hinge rows fall along a strip.
///
/// `hinges_per_gap` rows in each inter-key gap, spread symmetrically about the
/// midpoint. Two rows sharing 15 degrees is the whole point: one row would be
/// double what 0.6mm FR4 is known to take.
function hinge_ys(s: Strip, w: Well, p: FlexParams) -> float[] {
    let out: float[] = [];
    let n = hinges_per_gap(w);
    let i = 0;
    while (i + 1 < s.key_ys.length()) {
        let a = s.key_ys.at(i) ?? 0.0;
        let b = s.key_ys.at(i + 1) ?? 0.0;
        let mid = (a + b) / 2.0;
        let span = (n - 1) * 1.0 * p.hinge_spacing;
        let j = 0;
        while (j < n) {
            out.push(mid - span / 2.0 + (j * 1.0) * p.hinge_spacing);
            j = j + 1;
        }
        i = i + 1;
    }
    out
}

/// Distance from a key centre to the nearest hinge CUT.
///
/// The hinge rows sit symmetrically about the midpoint between two keys, so the
/// nearest one is half the row pitch in, less half the spread of the rows in
/// the gap -- and then less half a slot width, because what a part has to clear
/// is the edge of the cut, not its centreline.
function nearest_hinge_cut(w: Well, p: FlexParams) -> float {
    let mid = developed_row_pitch(w) / 2.0;
    let spread = ((hinges_per_gap(w) - 1) * 1.0) * p.hinge_spacing;
    mid - spread / 2.0 - p.slot_w / 2.0
}

/// A stadium -- a rectangle with semicircular ends -- as a closed polygon.
///
/// Slot ends are rounded rather than square because a square internal corner
/// in a part that bends is a crack starter. This is the same job the drilled
/// circles do at the ends of BastardKB's slots.
function stadium(x0: float, x1: float, y: float, w: float, segs: int) -> Vec2[] {
    let r = w / 2.0;
    let out: Vec2[] = [];
    // Right cap, from the bottom round to the top.
    let i = 0;
    while (i <= segs) {
        let t = 0.0 - 90.0 + 180.0 * (i * 1.0) / (segs * 1.0);
        let a = deg_to_rad(t);
        out.push(Vec2 { x: x1 + r * a.cos(), y: y + r * a.sin() });
        i = i + 1;
    }
    // Left cap, from the top round to the bottom.
    let j = 0;
    while (j <= segs) {
        let t = 90.0 + 180.0 * (j * 1.0) / (segs * 1.0);
        let a = deg_to_rad(t);
        out.push(Vec2 { x: x0 + r * a.cos(), y: y + r * a.sin() });
        j = j + 1;
    }
    out
}

/// Across-strip length of one gap in a hinge row.
///
/// Slots and ligaments share the strip width equally, which is close to what
/// BastardKB drew (15.8mm strip, three 2mm ligaments, four ~2.45mm slots).
function hinge_slot_len(s: Strip, n_lig: int, p: FlexParams) -> float {
    (2.0 * s.half_w - (n_lig * 1.0) * p.ligament_w) / ((n_lig + 1) * 1.0)
}

/// The INTERIOR slots of one hinge row.
///
/// `n_lig` ligaments across a strip means `n_lig + 1` gaps between them, but
/// only the `n_lig - 1` in the middle are holes. The two outermost open through
/// the strip's edge -- that is what makes a hinge row a row of ligaments rather
/// than a perforated sheet -- so they are notches in the outline walk instead,
/// and `edge_notch` draws them. Emitting them here as separate contours put
/// each one exactly tangent to the board edge, which KiCad reads as a
/// self-intersecting outline: 83 violations on the first board that emitted.
function hinge_slots(s: Strip, y: float, n_lig: int, p: FlexParams) -> Vec2[][] {
    let slot_len = hinge_slot_len(s, n_lig, p);
    let out: Vec2[][] = [];
    if (slot_len <= p.slot_w) {
        return out;
    }
    let i = 1;
    while (i < n_lig) {
        let x = s.cx - s.half_w + (i * 1.0) * (slot_len + p.ligament_w);
        out.push(stadium(x + p.slot_w / 2.0, x + slot_len - p.slot_w / 2.0, y, p.slot_w, 4));
        i = i + 1;
    }
    out
}

/// One end cut of a hinge row, as vertices spliced into the outline walk.
///
/// Cut in from the strip edge at `x`, `depth` deep and `p.slot_w` wide, with a
/// rounded inner end -- a square internal corner in a part that bends is a
/// crack starter, which is the same job the drilled circles do at the ends of
/// BastardKB's slots.
///
/// `inward` is +1 when the material lies to the +x side of the edge; `up` is
/// +1 when the walk is running in +y. The arc has to sweep through the inward
/// direction, not away from it, which is what the product of the two decides.
function edge_notch(
    x: float,
    inward: float,
    y: float,
    depth: float,
    up: float,
    p: FlexParams,
    segs: int,
) -> Vec2[] {
    let r = p.slot_w / 2.0;
    let cx = x + inward * (depth - r);
    let t0 = 0.0 - 90.0 * up;
    let sweep = 180.0 * up * inward;
    let out: Vec2[] = [];
    out.push(Vec2 { x: x, y: y - up * r });
    let i = 0;
    while (i <= segs) {
        let a = deg_to_rad(t0 + sweep * (i * 1.0) / (segs * 1.0));
        out.push(Vec2 { x: cx + r * a.cos(), y: y + r * a.sin() });
        i = i + 1;
    }
    out.push(Vec2 { x: x, y: y + up * r });
    out
}

/// Walk one side of a strip from `ya` to `yb`, notching it at every hinge row
/// on the way.
///
/// Emits the notches and the far end, but NOT `(x, ya)`: the caller has always
/// just emitted that point, as the end of a neck or the corner of a strip, and
/// a repeated vertex is a zero-length segment on Edge.Cuts.
function edge_walk_to(
    x: float,
    inward: float,
    ya: float,
    yb: float,
    ys: float[],
    depth: float,
    p: FlexParams,
    segs: int,
) -> Vec2[] {
    let up = if (yb >= ya) {
        1.0
    } else {
        0.0 - 1.0
    };
    let r = p.slot_w / 2.0;
    let hits = ys
        .filter((y) -> {
            (y - ya) * up > r && (yb - y) * up > r
        })
        .sort_by((a, b) -> {
            if ((a - b) * up < 0.0) {
                0 - 1
            } else {
                1
            }
        });
    let out: Vec2[] = [];
    for (let y in hits) {
        for (let q in edge_notch(x, inward, y, depth, up, p, segs)) {
            out.push(q);
        }
    }
    out.push(Vec2 { x: x, y: yb });
    out
}

/// Every hinge slot on a strip.
function strip_hinge_cuts(s: Strip, w: Well, p: FlexParams, n_traces: int) -> Vec2[][] {
    let n_lig = ligaments_for(n_traces, p.ligament_w);
    let out: Vec2[][] = [];
    for (let y in hinge_ys(s, w, p)) {
        for (let poly in hinge_slots(s, y, n_lig, p)) {
            out.push(poly);
        }
    }
    out
}

// --------------------------------------------------------------------- necks
//
// A neck is NOT a short tab across the gap. It is a serpentine that runs a
// long way ALONG the gap and comes back, because the length is the whole
// point: a neck between two columns has to take an out-of-plane step of up to
// 5mm, and a fold is a guided cantilever whose strain goes as 1/length^2.
//
// A 6mm tab taking a 5mm step would see about 25% surface strain. BastardKB's
// necks, facing the same stock Dactyl Manuform column offsets, measure 33 to
// 70mm of centreline -- long vertical ribs about 1mm wide running up and down
// the gap with 0.5mm turns. That is where the numbers below come from.

/// Board thickness. 0.6mm is BastardKB's stock and the thinnest ordinary rigid
/// FR4; the fold strain is linear in it, so this is not a free choice.
function FLEX_THICKNESS() -> float {
    0.6
}

/// Surface strain a one-time fold is allowed to put on the copper.
///
/// Not a datasheet figure -- back-computed from BastardKB's SHORTEST neck,
/// which takes the same 5mm step this board does over about 33mm of
/// centreline. Treating that as a guided cantilever gives kappa = 6d/L^2 and a
/// surface strain of (t/2)*kappa, which works out at 0.83%. It is the only
/// number here with a shipped board behind it, and everything else about the
/// necks is derived from it.
function MAX_FOLD_STRAIN() -> float {
    0.0083
}

/// Centreline length a neck needs to take a `d` mm out-of-plane step.
///
/// Guided cantilever -- both ends clamped parallel, offset by d -- so the peak
/// curvature is 6d/L^2 and the surface sees (t/2) times that. Solved for L.
function neck_length_for_step(d: float) -> float {
    (3.0 * FLEX_THICKNESS() * d.abs() / MAX_FOLD_STRAIN()).sqrt()
}

/// Length a neck needs for the relative TILT between two columns.
///
/// The floor, for a gap with no step at all: adjacent columns still sit `beta`
/// apart, and the neck has to bend through that. A pure bend rather than a
/// guided offset, so kappa is just theta/L.
function neck_length_for_tilt(w: Well) -> float {
    FLEX_THICKNESS() * deg_to_rad(w.beta) / (2.0 * MAX_FOLD_STRAIN())
}

/// Centreline length of the neck between two named columns.
function neck_length(w: Well, a: string, b: string) -> float {
    let step = neck_length_for_step(step_between(w, a, b));
    let tilt = neck_length_for_tilt(w);
    if (step > tilt) {
        step
    } else {
        tilt
    }
}

/// Minimum width for `n` traces side by side, on `FLEX_LAYERS` layers.
///
/// The inverse of `traces_per_ligament`, and checked against it: a neck sized
/// by this must come back as carrying at least the traces it was sized for.
function width_for_traces(n: int) -> float {
    let per_layer = ((n * 1.0) / (FLEX_LAYERS() * 1.0)).ceil();
    let k = per_layer.iround() catch_all (e) {
        _ => n
    };
    if (k < 1) {
        return 2.0 * FLEX_EDGE_CLEAR();
    }
    (k * 1.0) * FLEX_TRACE_W() + ((k - 1) * 1.0) * FLEX_TRACE_SPACE() + 2.0 * FLEX_EDGE_CLEAR()
}

/// Perpendicular width of a neck carrying `n` traces, never below the floor in
/// the params.
function neck_width(p: FlexParams, n: int) -> float {
    let need = width_for_traces(n);
    if (need > p.neck_w) {
        need
    } else {
        p.neck_w
    }
}

/// Turn radius of a neck's serpentine, on the centreline.
///
/// The serpentine crosses the gap in exactly four quarter-turns' worth of
/// sideways travel -- in, over, back, out -- so the radius is a quarter of the
/// gap. Wider turns would not fit; tighter ones would need more of them and
/// leave the inner edge with no radius at all.
function neck_radius(span: float) -> float {
    span / 4.0
}

/// Straight run of each of a neck's two legs, for a given total length.
///
/// Total centreline is the two quarter-turns, the half-turn and the two legs:
/// 2*(pi*r/2) + pi*r + 2*leg.
function neck_leg(span: float, total: float) -> float {
    let r = neck_radius(span);
    let turns = 6.283185307179586 * r;
    let leg = (total - turns) / 2.0;
    if (leg < 0.0) {
        0.0
    } else {
        leg
    }
}

/// Sample an arc of `r` about `c`, from `t0` to `t1` degrees, dropping the
/// first point so it splices onto whatever ended there.
function arc_pts(c: Vec2, r: float, t0: float, t1: float, segs: int, skip_first: bool) -> Vec2[] {
    let out: Vec2[] = [];
    let i = if (skip_first) {
        1
    } else {
        0
    };
    while (i <= segs) {
        let a = deg_to_rad(t0 + (t1 - t0) * (i * 1.0) / (segs * 1.0));
        out.push(Vec2 { x: c.x + r * a.cos(), y: c.y + r * a.sin() });
        i = i + 1;
    }
    out
}

/// A neck's centreline, west to east, sampled.
///
/// Quarter-turn up out of the strip, a leg north, a half-turn over, a leg back
/// south, a quarter-turn out into the next strip. Tangent-continuous
/// throughout, which is what lets `offset_path` take a finite-difference normal
/// and get a constant-width band out of it.
function neck_centreline(x0: float, x1: float, y: float, leg: float, segs: int) -> Vec2[] {
    let r = neck_radius(x1 - x0);
    let top = y + r + leg;
    let out: Vec2[] = [];
    for (let q in arc_pts(Vec2 { x: x0, y: y + r }, r, 0.0 - 90.0, 0.0, segs, false)) {
        out.push(q);
    }
    if (leg > 0.0) {
        out.push(Vec2 { x: x0 + r, y: top });
    }
    for (let q in arc_pts(Vec2 { x: x0 + 2.0 * r, y: top }, r, 180.0, 0.0, segs, true)) {
        out.push(q);
    }
    if (leg > 0.0) {
        out.push(Vec2 { x: x0 + 3.0 * r, y: y + r });
    }
    for (let q in arc_pts(Vec2 { x: x1, y: y + r }, r, 180.0, 270.0, segs, true)) {
        out.push(q);
    }
    out
}

/// Developed length of a sampled path.
function path_length(pts: Vec2[]) -> float {
    let len = 0.0;
    let i = 0;
    while (i + 1 < pts.length()) {
        let a = vec_at(pts, i);
        let b = vec_at(pts, i + 1);
        len = len + (b.x - a.x).hypot(b.y - a.y);
        i = i + 1;
    }
    len
}

/// A neck's two edges: the upper one left to right, the lower one right to
/// left, so they concatenate into a boundary walk.
class NeckEdges {
    upper: Vec2[],
    lower: Vec2[],
}

/// One side of a neck, drawn directly rather than offset from the centreline.
///
/// Every element is an arc or a straight, so the offset of each is exact: an
/// arc offsets to a concentric arc, a straight to a parallel straight. Taking a
/// finite-difference normal off a sampled centreline instead put the neck's
/// endpoint 26 microns INSIDE the strip it attaches to, which is a
/// self-intersecting outline and a rejected board.
///
/// `side` is +1 for the left-hand edge of the west-to-east walk and -1 for the
/// right. A left-turning arc offsets inward on its left, a right-turning one
/// outward, which is the whole of the sign logic below.
function neck_side(
    x0: float,
    x1: float,
    y: float,
    leg: float,
    width: float,
    side: float,
    segs: int,
) -> Vec2[] {
    let r = neck_radius(x1 - x0);
    let h = side * width / 2.0;
    let top = y + r + leg;
    let out: Vec2[] = [];
    // In: a quarter turn to the left, out of the strip and up the gap.
    for (let q in arc_pts(Vec2 { x: x0, y: y + r }, r - h, 0.0 - 90.0, 0.0, segs, false)) {
        out.push(q);
    }
    // North, up the gap. Heading +y, so the left-hand edge is the -x one.
    // A gap with no step needs no leg at all, and then the two turns meet
    // directly -- pushing a zero-length straight there would repeat a vertex,
    // which Edge.Cuts reads as a degenerate self-intersecting segment.
    if (leg > 0.0) {
        out.push(Vec2 { x: x0 + r - h, y: top });
    }
    // Over: a half turn to the right.
    for (let q in arc_pts(Vec2 { x: x0 + 2.0 * r, y: top }, r + h, 180.0, 0.0, segs, true)) {
        out.push(q);
    }
    // And back south, so now the left-hand edge is the +x one.
    if (leg > 0.0) {
        out.push(Vec2 { x: x0 + 3.0 * r + h, y: y + r });
    }
    // Out: a quarter turn to the left, into the next strip.
    for (let q in arc_pts(Vec2 { x: x1, y: y + r }, r - h, 180.0, 270.0, segs, true)) {
        out.push(q);
    }
    out
}

function neck_edges(
    x0: float,
    x1: float,
    y: float,
    leg: float,
    width: float,
    segs: int,
) -> NeckEdges {
    NeckEdges {
        upper: neck_side(x0, x1, y, leg, width, 1.0, segs),
        lower: neck_side(x0, x1, y, leg, width, 0.0 - 1.0, segs).reverse(),
    }
}

// ---------------------------------------------------------------- the outline

/// The middle of a strip's KEYS.
///
/// Not the middle of the strip: a strip carrying a connector runs on past its
/// last key in a tail, and letting that pull the neck down would land it on a
/// hinge row.
function strip_key_mid(s: Strip) -> float {
    let n = s.key_ys.length();
    if (n == 0) {
        (s.y0 + s.y1) / 2.0
    } else {
        ((s.key_ys.at(0) ?? 0.0) + (s.key_ys.at(n - 1) ?? 0.0)) / 2.0
    }
}

/// Where the neck between two strips sits along the column.
///
/// Level with the middle row, which is a rigid part of both strips. A neck at
/// an end would be a long lever on a strip that is already hinged, and would
/// twist rather than bend; a neck at a hinge row would attach to the ligaments
/// themselves.
function neck_y(a: Strip, b: Strip) -> float {
    (strip_key_mid(a) + strip_key_mid(b)) / 2.0
}

/// The gap a neck spans: edge of one strip to edge of the next.
function neck_span(a: Strip, b: Strip) -> float {
    (b.cx - b.half_w) - (a.cx + a.half_w)
}

/// Half a neck's width, which is its half-height where it meets a strip edge:
/// the centreline leaves the strip horizontally, so there the normal is
/// vertical.
function neck_half(w: Well, a: Strip, b: Strip, p: FlexParams, n_traces: int) -> float {
    neck_width(p, n_traces) / 2.0
}

/// The neck between two strips, as its two edges.
function strip_neck(
    w: Well,
    a: Strip,
    b: Strip,
    p: FlexParams,
    n_traces: int,
    segs: int,
) -> NeckEdges {
    let span = neck_span(a, b);
    neck_edges(
        a.cx + a.half_w,
        b.cx - b.half_w,
        neck_y(a, b),
        neck_leg(span, neck_length(w, a.column, b.column)),
        neck_width(p, n_traces),
        segs,
    )
}

function strip_at(ss: Strip[], i: int) -> Strip {
    ss.at(i) ?? Strip { column: "", cx: 0.0, half_w: 0.0, y0: 0.0, y1: 0.0, key_ys: [] }
}

/// The board's single closed Edge.Cuts contour: strips joined by necks, each
/// strip's sides notched at every hinge row.
///
/// One ring, not a polygon per strip. KiCad wants a board to be one closed
/// contour, and overlapping outlines fail DRC rather than uniting -- so the
/// walk goes up the outside of every strip and back along the underside of
/// every neck, and the outermost hinge cuts are part of that walk rather than
/// separate holes tangent to it.
function flex_ring(
    ss: Strip[],
    w: Well,
    p: FlexParams,
    n_traces: int,
    neck_traces: int,
    samples: int,
) -> Vec2[] {
    let out: Vec2[] = [];
    let n = ss.length();
    if (n == 0) {
        return out;
    }
    let n_lig = ligaments_for(n_traces, p.ligament_w);

    // Outbound, west to east: up the left of each strip, across its top, down
    // its right to the next neck, then out along the neck's upper edge. Only
    // the first strip starts from its own bottom corner -- the others are
    // entered from a neck, part way up, and drawing their bottom corner here
    // would fold the ring back on itself.
    let i = 0;
    while (i < n) {
        let s = strip_at(ss, i);
        let xl = s.cx - s.half_w;
        let xr = s.cx + s.half_w;
        let depth = hinge_slot_len(s, n_lig, p);
        let ys = hinge_ys(s, w, p);
        let lo = if (i == 0) {
            out.push(Vec2 { x: xl, y: s.y0 });
            s.y0
        } else {
            let r = strip_at(ss, i - 1);
            neck_y(r, s) + neck_half(w, r, s, p, neck_traces)
        };
        for (let q in edge_walk_to(xl, 1.0, lo, s.y1, ys, depth, p, 4)) {
            out.push(q);
        }
        out.push(Vec2 { x: xr, y: s.y1 });
        if (i + 1 < n) {
            let t = strip_at(ss, i + 1);
            let y = neck_y(s, t);
            for (
                let q in edge_walk_to(
                    xr,
                    0.0 - 1.0,
                    s.y1,
                    y + neck_half(w, s, t, p, neck_traces),
                    ys,
                    depth,
                    p,
                    4,
                )
            ) {
                out.push(q);
            }
            // The neck's upper edge starts exactly where that walk ended.
            let up = strip_neck(w, s, t, p, neck_traces, samples).upper;
            for (let q in up.slice(1, up.length())) {
                out.push(q);
            }
        } else {
            for (let q in edge_walk_to(xr, 0.0 - 1.0, s.y1, s.y0, ys, depth, p, 4)) {
                out.push(q);
            }
        }
        i = i + 1;
    }

    // Return, east to west: along the bottom of each strip, up its left edge to
    // the neck, back under the neck, then down the far strip's right edge to
    // its own bottom. The walk ends one vertex short of where it started, and
    // that missing edge is the first strip's underside.
    let j = n - 1;
    while (j >= 1) {
        let s = strip_at(ss, j);
        let r = strip_at(ss, j - 1);
        let y = neck_y(r, s);
        let half = neck_half(w, r, s, p, neck_traces);
        out.push(Vec2 { x: s.cx - s.half_w, y: s.y0 });
        for (
            let q in edge_walk_to(
                s.cx - s.half_w,
                1.0,
                s.y0,
                y - half,
                hinge_ys(s, w, p),
                hinge_slot_len(s, n_lig, p),
                p,
                4,
            )
        ) {
            out.push(q);
        }
        // The neck's lower edge starts exactly where that walk ended.
        let down = strip_neck(w, r, s, p, neck_traces, samples).lower;
        for (let q in down.slice(1, down.length())) {
            out.push(q);
        }
        for (
            let q in edge_walk_to(
                r.cx + r.half_w,
                0.0 - 1.0,
                y - half,
                r.y0,
                hinge_ys(r, w, p),
                hinge_slot_len(r, n_lig, p),
                p,
                4,
            )
        ) {
            out.push(q);
        }
        j = j - 1;
    }
    out
}

// -------------------------------------------------------------------- tests

function test_strips() -> Strip[] throws baml.errors.InvalidArgument {
    let keys = dactyl_left_keys().filter((k) -> {
        k.zone == "matrix"
    });
    strips_of(keys, ROSEBEAR_WELL(), flex_defaults())
}

test "a strip per column, sized by the column pitch" {
    let w = ROSEBEAR_WELL();
    let p = flex_defaults();
    let ss = test_strips();
    assert.equal(ss.length(), 5);
    // The strip is what the switch socket needs; the gap is the remainder.
    assert.approx_equal(strip_width(w, p), min_strip_width(), 0.000001);
    assert.approx_equal(strip_width(w, p), 17.72, 0.000001);
    assert.approx_equal(p.gap, 4.776182, 0.000001);
    for (let s in ss) {
        assert.equal(s.key_ys.length(), 3);
        assert.approx_equal(s.half_w * 2.0, strip_width(w, p), 0.000001);
    }
}

test "strips do not touch -- the gap is real" {
    let ss = test_strips();
    let p = flex_defaults();
    let i = 0;
    while (i + 1 < ss.length()) {
        let a = ss.at(i)?.cx ?? 0.0;
        let b = ss.at(i + 1)?.cx ?? 0.0;
        let hw = ss.at(i)?.half_w ?? 0.0;
        assert.approx_equal(b - a - 2.0 * hw, p.gap, 0.000001);
        i = i + 1;
    }
}

test "four hinge rows per column, none of them through a switch" {
    let w = ROSEBEAR_WELL();
    let p = flex_defaults();
    let ss = test_strips();
    let s = ss.at(2) ?? Strip { column: "", cx: 0.0, half_w: 0.0, y0: 0.0, y1: 0.0, key_ys: [] };
    // Two inter-key gaps, two hinge rows each.
    let ys = hinge_ys(s, w, p);
    assert.equal(ys.length(), 4);
    for (let y in ys) {
        for (let k in s.key_ys) {
            assert.is_true((y - k).abs() >= p.switch_clear);
        }
    }
}

test "hinge rows sit inside the strip, not off its ends" {
    let w = ROSEBEAR_WELL();
    let p = flex_defaults();
    for (let s in test_strips()) {
        for (let y in hinge_ys(s, w, p)) {
            assert.is_true(y > s.y0);
            assert.is_true(y < s.y1);
        }
    }
}

test "a 2mm ligament carries ten traces, so a matrix needs two" {
    // 2.0 - 2*0.3 clear = 1.4 usable; (1.4 - 0.135)/0.285 + 1 = 5 per layer.
    assert.equal(traces_per_ligament(2.0), 10);
    // A matrix column strip crosses 3 row lines plus its own column line.
    assert.equal(ligaments_for(4, 2.0), 2);
    // Direct wiring puts every outboard column's signals through the same
    // hinge; the count climbs and so does the ligament count.
    assert.equal(ligaments_for(15, 2.0), 2);
    assert.equal(ligaments_for(21, 2.0), 3);
    // Never fewer than two, however little has to cross.
    assert.equal(ligaments_for(0, 2.0), 2);
    assert.equal(ligaments_for(1, 2.0), 2)
}

test "a hinge row is slots and ligaments across the whole strip" {
    let p = flex_defaults();
    let ss = test_strips();
    let s = strip_at(test_strips(), 0);
    // Three ligaments means four gaps, of which the two end ones open through
    // the strip edge and belong to the outline -- so two are holes.
    let slots = hinge_slots(s, 0.0, 3, p);
    assert.equal(slots.length(), 2);
    // Slots and ligaments together account for the full strip width.
    let slot_len = hinge_slot_len(s, 3, p);
    assert.approx_equal(4.0 * slot_len + 3.0 * p.ligament_w, 2.0 * s.half_w, 0.000001);
    // And the cut stays inside the strip.
    for (let poly in slots) {
        for (let q in poly) {
            assert.is_true(q.x >= s.cx - s.half_w - 0.000001);
            assert.is_true(q.x <= s.cx + s.half_w + 0.000001);
        }
    }
}

test "a neck is long enough that a 5mm fold does not crack it" {
    let w = ROSEBEAR_WELL();
    let p = flex_defaults();
    // The largest step is 5mm, at the inner column.
    assert.approx_equal(max_column_step(w), 5.0, 0.000001);
    // Which needs about 33mm of centreline -- BastardKB's shortest neck,
    // which is where MAX_FOLD_STRAIN was calibrated from.
    let l = neck_length_for_step(5.0);
    assert.is_true(l > 32.0);
    assert.is_true(l < 34.0);
    // A neck the width of the gap would be five times too short, and strain
    // goes as 1/L^2 -- so about thirty times over budget. This is the error
    // the serpentine exists to fix.
    assert.is_true(l > 5.0 * p.gap)
}

test "neck length falls out of the step, and never below the tilt floor" {
    let w = ROSEBEAR_WELL();
    // A gap with no step still has to bend through beta.
    assert.approx_equal(neck_length(w, "pinky", "ring"), neck_length_for_tilt(w), 0.000001);
    assert.is_true(neck_length_for_tilt(w) > 3.0);
    // And the gaps that carry a step are far longer than that.
    assert.is_true(neck_length(w, "index", "inner") > 30.0);
    assert.approx_equal(neck_length(w, "index", "inner"), neck_length_for_step(5.0), 0.000001);
    // Direction does not matter: the right half is the left mirrored.
    assert.approx_equal(
        neck_length(w, "inner", "index"),
        neck_length(w, "index", "inner"),
        0.000001,
    )
}

test "a neck's drawn centreline is the length it was asked for" {
    let w = ROSEBEAR_WELL();
    let p = flex_defaults();
    let want = neck_length(w, "index", "inner");
    let leg = neck_leg(p.gap, want);
    let got = path_length(neck_centreline(0.0, p.gap, 0.0, leg, 64));
    assert.approx_equal(got, want, 0.01)
}

test "a neck is wide enough for the traces crossing it, and no wider" {
    let p = flex_defaults();
    let keys = dactyl_left_keys();
    // The worst neck carries 8: three row lines plus five column lines.
    let n = matrix_neck_traces(keys, 4);
    assert.equal(n, 8);
    let width = neck_width(p, n);
    // 1.59mm: four traces a side over two layers, plus edge clearance.
    assert.is_true(width > 1.5);
    assert.is_true(width < 1.7);
    // And the sizing is self-consistent -- a neck sized for n carries n.
    assert.is_true(traces_per_ligament(width) >= n)
}

test "a neck's turns are wide enough that its inner edge does not fold" {
    let p = flex_defaults();
    let r = neck_radius(p.gap);
    let half = neck_width(p, 8) / 2.0;
    // Normal-offsetting a curve folds when the offset exceeds the radius of
    // curvature. The turn radius has to beat the half-width, with room over.
    assert.is_true(r > half);
    assert.is_true(r - half > 0.3)
}

test "the outline is one closed ring covering every strip" {
    let p = flex_defaults();
    let ss = test_strips();
    let ring = flex_ring(ss, ROSEBEAR_WELL(), p, 4, 8, 16);
    assert.is_true(ring.length() > 20);
    // Every strip's four corners are inside the ring's bounding box.
    let min_x = ring.reduce(
        (a, q) -> {
            if (q.x < a) {
                q.x
            } else {
                a
            }
        },
        100000.0,
    );
    let max_x = ring.reduce(
        (a, q) -> {
            if (q.x > a) {
                q.x
            } else {
                a
            }
        },
        0.0 - 100000.0,
    );
    let first = ss.at(0) ?? Strip { column: "", cx: 0.0, half_w: 0.0, y0: 0.0, y1: 0.0, key_ys: [] };
    let last = ss.at(ss.length() - 1)
        ?? Strip { column: "", cx: 0.0, half_w: 0.0, y0: 0.0, y1: 0.0, key_ys: [] };
    assert.approx_equal(min_x, first.cx - first.half_w, 0.000001);
    assert.approx_equal(max_x, last.cx + last.half_w, 0.000001)
}

test "the ring does not self-intersect" {
    let p = flex_defaults();
    let ring = flex_ring(test_strips(), ROSEBEAR_WELL(), p, 4, 8, 16);
    let n = ring.length();
    let i = 0;
    while (i < n) {
        let a = vec_at(ring, i);
        let b = vec_at(ring, (i + 1) % n);
        let j = i + 2;
        while (j < n) {
            // Skip the pair that shares a vertex with edge i.
            if (!(i == 0 && j == n - 1)) {
                let c = vec_at(ring, j);
                let d = vec_at(ring, (j + 1) % n);
                assert.is_true(seg_cross(a, b, c, d) == null);
            }
            j = j + 1;
        }
        i = i + 1;
    }
}

test "the strip is as wide as the switch socket needs, and no wider" {
    let w = ROSEBEAR_WELL();
    let p = flex_defaults();
    // The strip is sized by the socket's own land pattern, checked against the
    // installed footprint by `switch_pad_span_matches_library`.
    assert.approx_equal(SWITCH_HALF_SPAN(), 8.36, 0.000001);
    // And every millimetre the strip does not need goes to the neck.
    assert.approx_equal(strip_width(w, p) + p.gap, developed_col_pitch(w), 0.000001);
    // Which still leaves a gap the neck's turns fit in, with the inner edge of
    // a turn keeping a real radius.
    assert.is_true(neck_radius(p.gap) - neck_width(p, 8) / 2.0 > 0.2)
}

test "every key's footprint lands on its strip" {
    // The defect the paper proof found: a 4mm end margin left the outer keys'
    // 14mm plate cut-outs hanging off the end of the strip.
    let w = ROSEBEAR_WELL();
    let p = flex_defaults();
    let half = KEY_H() / 2.0;
    for (let s in test_strips()) {
        for (let y in s.key_ys) {
            assert.is_true(y - half >= s.y0);
            assert.is_true(y + half <= s.y1);
        }
        // And across the strip, which is the tighter of the two.
        assert.is_true(strip_width(w, p) >= KEY_W() * 0.9);
    }
}

test "every diode lands on its strip" {
    // The other defect the paper proof found: diodes all on the same side put
    // the top row's off the end of the board.
    let w = ROSEBEAR_WELL();
    let p = flex_defaults();
    let keys = dactyl_left_keys().filter((k) -> {
        k.zone == "matrix"
    });
    let half = 0.8;
    for (let s in test_strips()) {
        for (let k in keys) {
            if (k.column == s.column) {
                // `diode_offset` is in the key's frame, where +y points the
                // opposite way to the layout's.
                let dy = k.y - diode_offset(k).y;
                assert.is_true(dy - half >= s.y0);
                assert.is_true(dy + half <= s.y1);
                // And never on top of the switch it belongs to.
                assert.is_true((dy - k.y).abs() - half >= p.switch_clear);
            }
        }
    }
}
