// Keyboard key placement engine.
//
// Port of ergogen's zone-walk algorithm (points.js `render_zone`), with an
// explicit flat config schema instead of ergogen's five-level key inheritance.
//
// The layout order is load-bearing and matches ergogen exactly:
//   per column:  spread (x) -> stagger (y) -> splay (cumulative rotation)
//   per key:     orient -> shift -> rotate, then advance by padding
// Splay pushes onto a rotation stack that applies to all *subsequent* columns,
// which is what produces a fanned layout.
//
// Everything here is float. BAML's `int / int` truncates, so an int leaking
// into this math would silently bend the board.

class Rotation {
    angle: float,
    origin: Vec2,
}

class Point {
    x: float,
    y: float,
    r: float,
    mirrored: bool,

    function pos(self) -> Vec2 {
        Vec2 { x: self.x, y: self.y }
    }

    function with_r(self, r: float) -> Point {
        Point { x: self.x, y: self.y, r: r, mirrored: self.mirrored }
    }

    function moved(self, x: float, y: float) -> Point {
        Point { x: x, y: y, r: self.r, mirrored: self.mirrored }
    }

    /// Translate by `s`, returning a new point. When `relative`, `s` is first
    /// rotated into this point's own frame (so "advance one row" follows the
    /// key's rotation).
    function shifted(self, s: Vec2, relative: bool) -> Point {
        let sx = if (self.mirrored) {
            0.0 - s.x
        } else {
            s.x
        };
        let raw = Vec2 { x: sx, y: s.y };
        let v = if (relative) {
            rotate_about(raw, self.r, Vec2 { x: 0.0, y: 0.0 })
        } else {
            raw
        };
        Point { x: self.x + v.x, y: self.y + v.y, r: self.r, mirrored: self.mirrored }
    }

    function rotated(self, angle: float, origin: Vec2) -> Point {
        let a = if (self.mirrored) {
            0.0 - angle
        } else {
            angle
        };
        let p = rotate_about(self.pos(), a, origin);
        Point { x: p.x, y: p.y, r: self.r + a, mirrored: self.mirrored }
    }

    function turned(self, angle: float) -> Point {
        let a = if (self.mirrored) {
            0.0 - angle
        } else {
            angle
        };
        Point { x: self.x, y: self.y, r: self.r + a, mirrored: self.mirrored }
    }
}

/// Append a rotation, mapping its origin through all rotations already staged.
function push_rotation(list: Rotation[], angle: float, origin: Vec2) -> void {
    let candidate = origin;
    for (let r in list) {
        candidate = rotate_about(candidate, r.angle, r.origin);
    }
    list.push(Rotation { angle: angle, origin: candidate })
}

// ---------------------------------------------------------------- config

/// A single key within a column. This is the per-key spec: ergogen's
/// five-level inheritance chain collapses to explicit values here.
class RowSpec {
    name: string,
    /// Distance to the next row, along the column's local +y.
    padding: float,
    /// Rotation applied to this key only (ergogen's `key.rotate`).
    rotate: float,
    /// Keycap footprint size, used for outlines and collision checks.
    width: float,
    height: float,
}

class ColumnSpec {
    name: string,
    /// x-offset from the previous column. Ignored for the first column.
    spread: float,
    /// y-offset applied cumulatively as columns advance.
    stagger: float,
    /// Rotation applied to this and all subsequent columns.
    splay: float,
    origin: Vec2,
    rows: RowSpec[],
}

/// Where a zone starts. `ref` names an already-placed key to hang off; null
/// anchors absolutely. This is how the thumb cluster attaches to the matrix.
class AnchorSpec {
    ref: string?,
    shift: Vec2,
    rotate: float,
}

class ZoneSpec {
    name: string,
    anchor: AnchorSpec,
    columns: ColumnSpec[],
}

class PlacedKey {
    /// Unique key name, e.g. "matrix_pinky_top" or "mirror_thumb_far_thumb".
    name: string,
    zone: string,
    column: string,
    row: string,
    x: float,
    y: float,
    r: float,
    width: float,
    height: float,
    mirrored: bool,

    function pos(self) -> Vec2 {
        Vec2 { x: self.x, y: self.y }
    }
}

// ---------------------------------------------------------------- engine

function find_placed(
    keys: PlacedKey[],
    name: string,
) -> PlacedKey throws baml.errors.InvalidArgument {
    keys.find((k) -> {
        k.name == name
    })
        ?? throw baml.errors.InvalidArgument { message: `no placed key named '${name}'` }
}

/// Resolve a zone anchor against the keys placed so far.
function resolve_anchor(
    a: AnchorSpec,
    placed: PlacedKey[],
    mirrored: bool,
) -> Point throws baml.errors.InvalidArgument {
    let base = if let ref_name: string = a.ref {
        let k = find_placed(placed, ref_name);
        Point { x: k.x, y: k.y, r: k.r, mirrored: mirrored }
    } else {
        Point { x: 0.0, y: 0.0, r: 0.0, mirrored: mirrored }
    };
    base.shifted(a.shift, true).turned(a.rotate)
}

function render_zone_at(zone: ZoneSpec, anchor: Point, name_prefix: string) -> PlacedKey[] {
    let out: PlacedKey[] = [];
    let rotations: Rotation[] = [];

    let zone_anchor = anchor;
    // Transfer the anchor's own rotation into the rotation stack, then clear it
    // so it is not applied twice.
    rotations.push(Rotation { angle: zone_anchor.r, origin: zone_anchor.pos() });
    zone_anchor = zone_anchor.with_r(0.0);

    let first_col = true;
    for (let col in zone.columns) {
        let next_x = if (first_col) {
            zone_anchor.x
        } else {
            zone_anchor.x + col.spread
        };
        zone_anchor = zone_anchor.moved(next_x, zone_anchor.y + col.stagger);
        let col_anchor = zone_anchor;

        if (col.splay != 0.0) {
            push_rotation(rotations, col.splay, col_anchor.shifted(col.origin, false).pos());
        }

        let running = col_anchor;
        for (let rot in rotations) {
            running = running.rotated(rot.angle, rot.origin);
        }

        for (let row in col.rows) {
            let placed = running.turned(row.rotate);
            out.push(
                PlacedKey {
                    name: `${name_prefix}${zone.name}_${col.name}_${row.name}`,
                    zone: zone.name,
                    column: col.name,
                    row: row.name,
                    x: placed.x,
                    y: placed.y,
                    r: placed.r,
                    width: row.width,
                    height: row.height,
                    mirrored: placed.mirrored,
                },
            );
            // The running anchor carries the per-key rotation forward, matching
            // ergogen: `running_anchor = point.clone()` before the padding step.
            running = placed.shifted(Vec2 { x: 0.0, y: row.padding }, true);
        }

        first_col = false;
    }
    out
}

/// Render zones in order, so a later zone can anchor to an earlier zone's keys.
function render_zones(
    zones: ZoneSpec[],
    mirrored: bool,
    name_prefix: string,
) -> PlacedKey[] throws baml.errors.InvalidArgument {
    let all: PlacedKey[] = [];
    for (let z in zones) {
        let anchor = resolve_anchor(z.anchor, all, mirrored);
        for (let k in render_zone_at(z, anchor, name_prefix)) {
            all.push(k);
        }
    }
    all
}
