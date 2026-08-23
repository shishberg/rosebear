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
