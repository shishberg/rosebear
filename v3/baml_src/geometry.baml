// 2D geometry primitives for keyboard key placement.
//
// All angles are DEGREES at the API surface (matching ergogen configs and
// KiCad), converted to radians only inside trig calls.
//
// NOTE: every literal here is a float. BAML's `int / int` truncates, so mixing
// an int into this math would silently produce wrong geometry.

class Vec2 {
    x: float,
    y: float,
}

function deg_to_rad(deg: float) -> float {
    deg * 0.017453292519943295
}

/// Rotate `p` counter-clockwise about `origin` by `angle_deg`.
function rotate_about(p: Vec2, angle_deg: float, origin: Vec2) -> Vec2 {
    let a = deg_to_rad(angle_deg);
    let s = a.sin();
    let c = a.cos();
    let dx = p.x - origin.x;
    let dy = p.y - origin.y;
    Vec2 { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c }
}

test "rotate_about: 90deg about origin sends +x to +y" {
    let r = rotate_about(Vec2 { x: 1.0, y: 0.0 }, 90.0, Vec2 { x: 0.0, y: 0.0 });
    assert.approx_equal(r.x, 0.0, 0.000001);
    assert.approx_equal(r.y, 1.0, 0.000001)
}

test "rotate_about: rotation about a non-origin pivot" {
    let r = rotate_about(Vec2 { x: 2.0, y: 1.0 }, 180.0, Vec2 { x: 1.0, y: 1.0 });
    assert.approx_equal(r.x, 0.0, 0.000001);
    assert.approx_equal(r.y, 1.0, 0.000001)
}

/// True when `p` is inside the convex polygon `hull`, whose vertices run in a
/// consistent direction (`convex_hull` guarantees that).
///
/// Every edge has the interior on the same side, so one sign test per edge is
/// the whole of it.
function point_in_hull(hull: Vec2[], p: Vec2) -> bool {
    let n = hull.length();
    if (n < 3) {
        return false;
    }
    let pos = false;
    let neg = false;
    let i = 0;
    while (i < n) {
        let a = hull.at(i) ?? p;
        let b = hull.at((i + 1) % n) ?? p;
        let cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        if (cross > 0.000001) {
            pos = true;
        }
        if (cross < 0.0 - 0.000001) {
            neg = true;
        }
        i = i + 1;
    }
    !(pos && neg)
}

/// True when `p` is inside the (possibly non-convex) polygon `poly`.
/// Ray cast east; `point_in_hull` above stays for the convex fast path.
function point_in_poly(poly: Vec2[], p: Vec2) -> bool {
    let n = poly.length();
    if (n < 3) {
        return false;
    }
    let inside = false;
    let i = 0;
    while (i < n) {
        let a = poly.at(i) ?? p;
        let b = poly.at((i + 1) % n) ?? p;
        if ((a.y > p.y) != (b.y > p.y)) {
            let xi = a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y);
            if (p.x < xi) {
                inside = !inside;
            }
        }
        i = i + 1;
    }
    inside
}

/// Where segments a-b and c-d cross, if they do.
function seg_cross(a: Vec2, b: Vec2, c: Vec2, d: Vec2) -> Vec2? {
    let rx = b.x - a.x;
    let ry = b.y - a.y;
    let sx = d.x - c.x;
    let sy = d.y - c.y;
    let den = rx * sy - ry * sx;
    if (den.abs() < 0.0000001) {
        return null;
    }
    let t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
    let u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
    if (t < 0.0 || t > 1.0 || u < 0.0 || u > 1.0) {
        return null;
    }
    Vec2 { x: a.x + t * rx, y: a.y + t * ry }
}

/// `subject` minus `clip`: the board outline with the neighbour (grown by the
/// ribbon gap) carved out of it.
///
/// Handles the one shape this pipeline produces -- the clip polygon biting a
/// single notch out of the subject's boundary, crossing it exactly twice.
/// Anything else (no crossings, or a stranger overlap) returns the subject
/// unchanged and leaves the fault for the overlap checks to report.
/// A value wrapped into [0, m).
function wrapf(v: float, m: float) -> float {
    let d = v;
    while (d < 0.0) {
        d = d + m;
    }
    while (d >= m) {
        d = d - m;
    }
    d
}

/// Where a point on a polygon's boundary sits along it: vertex `j` is at
/// parameter `j`, a point a fraction `t` along edge `j` at `j + t`. Snaps to
/// the nearest edge, so a point computed by `seg_cross` lands exactly.
function path_param(poly: Vec2[], p: Vec2) -> float {
    let n = poly.length();
    let best = 0.0;
    let best_d = 1000000.0;
    let j = 0;
    while (j < n) {
        let a = vec_at(poly, j);
        let b = vec_at(poly, (j + 1) % n);
        let ex = b.x - a.x;
        let ey = b.y - a.y;
        let l2 = ex * ex + ey * ey;
        let t = if (l2 > 0.0) {
            ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2
        } else {
            0.0
        };
        let tc = if (t < 0.0) {
            0.0
        } else if (t > 1.0) {
            1.0
        } else {
            t
        };
        let qx = a.x + tc * ex - p.x;
        let qy = a.y + tc * ey - p.y;
        let d = qx.hypot(qy);
        if (d < best_d) {
            best_d = d;
            best = (j * 1.0) + tc;
        }
        j = j + 1;
    }
    best
}

function clip_outline(subject: Vec2[], clip: Vec2[]) -> Vec2[] {
    // Walk the subject boundary, keeping vertices outside the clip and
    // recording where it crosses in or out.
    let out: Vec2[] = [];
    let entry = Vec2 { x: 0.0, y: 0.0 };
    let exitp = Vec2 { x: 0.0, y: 0.0 };
    let entry_at = 0 - 1;
    let crossings = 0;
    let n = subject.length();
    let i = 0;
    while (i < n) {
        let a = vec_at(subject, i);
        let b = vec_at(subject, (i + 1) % n);
        if (!point_in_poly(clip, a)) {
            out.push(a);
        }
        // Crossings of this edge, ordered along it.
        let hits: Vec2[] = [];
        let m = clip.length();
        let j = 0;
        while (j < m) {
            if let x: Vec2 = seg_cross(a, b, vec_at(clip, j), vec_at(clip, (j + 1) % m)) {
                hits.push(x);
            }
            j = j + 1;
        }
        let sorted = hits.sort_by((p, q) -> {
            let dp = (p.x - a.x).hypot(p.y - a.y);
            let dq = (q.x - a.x).hypot(q.y - a.y);
            if (dp < dq) {
                0 - 1
            } else {
                1
            }
        });
        for (let x in sorted) {
            crossings = crossings + 1;
            if (point_in_poly(clip, b)) {
                // Heading in: remember where, and where in `out` to splice.
                entry = x;
                entry_at = out.length();
            } else {
                exitp = x;
            }
            out.push(x);
        }
        i = i + 1;
    }
    if (crossings != 2 || entry_at < 0) {
        return subject;
    }
    // Between entering and leaving the clip, follow the clip's own boundary.
    // Both crossings sit on that boundary; parametrise it (vertex k is at
    // position k, a crossing at fraction t along edge j is at j+t) and walk
    // from the entry parameter to the exit parameter -- in whichever of the
    // two directions keeps the walked vertices inside the subject. Ordering
    // the arc by distance from the entry instead zig-zags as soon as the
    // pocket is deeper than it is wide.
    let m = clip.length();
    let te = path_param(clip, entry);
    let tx = path_param(clip, exitp);
    let span = wrapf(tx - te, m * 1.0);
    let fwd_idx: int[] = [];
    let bwd_idx: int[] = [];
    let j = 0;
    while (j < m) {
        let d = wrapf((j * 1.0) - te, m * 1.0);
        if (d > 0.0 && d < span) {
            fwd_idx.push(j);
        } else if (d > span) {
            bwd_idx.push(j);
        }
        j = j + 1;
    }
    let fs = fwd_idx.sort_by((p, q) -> {
        if (wrapf((p * 1.0) - te, m * 1.0) < wrapf((q * 1.0) - te, m * 1.0)) {
            0 - 1
        } else {
            1
        }
    });
    let bs = bwd_idx.sort_by((p, q) -> {
        if (wrapf(te - (p * 1.0), m * 1.0) < wrapf(te - (q * 1.0), m * 1.0)) {
            0 - 1
        } else {
            1
        }
    });
    let fwd_ok = fs.reduce(
        (a, k) -> {
            a && point_in_poly(subject, vec_at(clip, k))
        },
        true,
    );
    let ordered = (
        if (fwd_ok) {
            fs
        } else {
            bs
        }
    )
        .map((k) -> {
            vec_at(clip, k)
        });
    // Splice: subject-outside points up to the entry, the arc, then the rest.
    let res: Vec2[] = [];
    let k = 0;
    while (k < out.length()) {
        res.push(vec_at(out, k));
        if (k == entry_at) {
            for (let v in ordered) {
                res.push(v);
            }
        }
        k = k + 1;
    }
    res
}

/// The x-extent of a polygon within a horizontal band, or a miss when the
/// polygon stays out of it. Corners inside the band count, and so do the
/// points where an edge crosses either boundary -- which also catches the
/// band passing clean through the polygon with no corner inside.
class XSpan {
    hit: bool,
    x1: float,
    x2: float,
}

function band_extent(poly: Vec2[], y1: float, y2: float) -> XSpan {
    let xs: float[] = [];
    let n = poly.length();
    let i = 0;
    while (i < n) {
        let a = poly.at(i) ?? Vec2 { x: 0.0, y: 0.0 };
        let b = poly.at(
            if (i + 1 < n) {
                i + 1
            } else {
                0
            },
        )
            ?? Vec2 { x: 0.0, y: 0.0 };
        if (a.y >= y1 && a.y <= y2) {
            xs.push(a.x);
        }
        for (let yy in [y1, y2]) {
            if ((a.y - yy) * (b.y - yy) < 0.0) {
                xs.push(a.x + (yy - a.y) / (b.y - a.y) * (b.x - a.x));
            }
        }
        i = i + 1;
    }
    if (xs.length() == 0) {
        return XSpan { hit: false, x1: 0.0, x2: 0.0 };
    }
    let lo = xs.reduce(
        (m, v) -> {
            if (v < m) {
                v
            } else {
                m
            }
        },
        1000000.0,
    );
    let hi = xs.reduce(
        (m, v) -> {
            if (v > m) {
                v
            } else {
                m
            }
        },
        0.0 - 1000000.0,
    );
    XSpan { hit: true, x1: lo, x2: hi }
}

// ------------------------------------------------------------------- angles

/// The direction of `v`, in degrees counter-clockwise from +x.
///
/// BAML's number methods stop at `sin`, `cos`, `sqrt` and `hypot` -- there is
/// no `atan2` to call -- so this brackets the answer by quadrant and bisects.
/// Inside a 90-degree bracket the cross product `cos(a)*vy - sin(a)*vx` falls
/// monotonically through zero exactly at the direction of `v`, which is all
/// bisection needs. Sixty halvings take a 90-degree bracket to 1e-16 degrees,
/// which is finer than a double can hold anyway.
///
/// Only the thumb cluster needs it: its frame is fixed by two key centres, and
/// the connector and diodes that stand in that frame need the angle itself
/// rather than the unit vector everything else is built from.
function angle_of(v: Vec2) -> float {
    if (v.x.abs() < 0.000000000001 && v.y.abs() < 0.000000000001) {
        return 0.0;
    }
    let lo = if (v.y >= 0.0) {
        if (v.x >= 0.0) {
            0.0
        } else {
            90.0
        }
    } else {
        if (v.x >= 0.0) {
            0.0 - 90.0
        } else {
            0.0 - 180.0
        }
    };
    let a = lo;
    let b = lo + 90.0;
    let i = 0;
    while (i < 60) {
        let m = (a + b) / 2.0;
        let t = deg_to_rad(m);
        if (t.cos() * v.y - t.sin() * v.x > 0.0) {
            a = m;
        } else {
            b = m;
        }
        i = i + 1;
    }
    (a + b) / 2.0
}

test "angle_of names the direction of a vector" {
    assert.approx_equal(angle_of(Vec2 { x: 1.0, y: 0.0 }), 0.0, 0.000001);
    assert.approx_equal(angle_of(Vec2 { x: 0.0, y: 2.0 }), 90.0, 0.000001);
    assert.approx_equal(angle_of(Vec2 { x: 0.0 - 1.0, y: 0.0 }), 180.0, 0.000001);
    assert.approx_equal(angle_of(Vec2 { x: 0.0, y: 0.0 - 3.0 }), 0.0 - 90.0, 0.000001);
    assert.approx_equal(angle_of(Vec2 { x: 1.0, y: 1.0 }), 45.0, 0.000001)
}

test "angle_of inverts a rotation" {
    // Round trip through the only other thing that knows what an angle means.
    let a = 0.0 - 28.5;
    let u = rotate_about(Vec2 { x: 1.0, y: 0.0 }, a, Vec2 { x: 0.0, y: 0.0 });
    assert.approx_equal(angle_of(u), a, 0.000001)
}

// -------------------------------------------------------------------- boxes

/// An axis-aligned rectangle, by opposite corners.
class Box {
    min: Vec2,
    max: Vec2,
}

/// The bounding box of a set of points.
function poly_box(poly: Vec2[]) -> Box {
    let big = 1000000.0;
    Box {
        min: Vec2 {
            x: poly.reduce(
                (a, p) -> {
                    if (p.x < a) {
                        p.x
                    } else {
                        a
                    }
                },
                big,
            ),
            y: poly.reduce(
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
            x: poly.reduce(
                (a, p) -> {
                    if (p.x > a) {
                        p.x
                    } else {
                        a
                    }
                },
                0.0 - big,
            ),
            y: poly.reduce(
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

function box_grow(b: Box, d: float) -> Box {
    Box {
        min: Vec2 { x: b.min.x - d, y: b.min.y - d },
        max: Vec2 { x: b.max.x + d, y: b.max.y + d },
    }
}

function box_union(a: Box, b: Box) -> Box {
    Box {
        min: Vec2 {
            x: if (a.min.x < b.min.x) {
                a.min.x
            } else {
                b.min.x
            },
            y: if (a.min.y < b.min.y) {
                a.min.y
            } else {
                b.min.y
            },
        },
        max: Vec2 {
            x: if (a.max.x > b.max.x) {
                a.max.x
            } else {
                b.max.x
            },
            y: if (a.max.y > b.max.y) {
                a.max.y
            } else {
                b.max.y
            },
        },
    }
}

function boxes_overlap(a: Box, b: Box) -> bool {
    a.min.x < b.max.x && b.min.x < a.max.x && a.min.y < b.max.y && b.min.y < a.max.y
}

function box_holds(b: Box, p: Vec2) -> bool {
    p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y
}
