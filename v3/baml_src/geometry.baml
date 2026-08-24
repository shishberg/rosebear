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
    // Between entering and leaving the clip, follow the clip's own boundary
    // -- the vertices of it that lie inside the subject, walked in the
    // direction that joins entry to exit.
    let inner: Vec2[] = [];
    let m = clip.length();
    // Nearest clip vertex index after the entry point, walking each way.
    let path_a: Vec2[] = [];
    let path_b: Vec2[] = [];
    let j = 0;
    while (j < m) {
        let v = vec_at(clip, j);
        if (point_in_poly(subject, v)) {
            path_a.push(v);
        }
        j = j + 1;
    }
    // Order the inside vertices by distance from the entry point; with a
    // single notch they form one arc, and walking it from the entry end is
    // the join we need.
    let ordered = path_a.sort_by((p, q) -> {
        let dp = (p.x - entry.x).hypot(p.y - entry.y);
        let dq = (q.x - entry.x).hypot(q.y - entry.y);
        if (dp < dq) {
            0 - 1
        } else {
            1
        }
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
