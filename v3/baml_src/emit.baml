// .kicad_pcb emission.
//
// Footprints are read from the installed KiCad libraries and spliced in, rather
// than hand-written -- so pads, courtyards and 3D models are the real ones.
//
// Format is version 20260206 (KiCad 10), matching the on-disk libraries. In
// this format pads carry `(net "NAME")` directly and there is no separate net
// table, so the netlist is implied by the pads.

function KICAD_FOOTPRINT_ROOT() -> string {
    "/Applications/KiCad/KiCad.app/Contents/SharedSupport/footprints"
}

/// Footprints this project generates rather than borrows, relative to `v3/`.
///
/// Only one library lives here: KiCad ships no Kailh hotswap land pattern, so
/// `footprints/gen_hotswap.py` builds one from ergogen's own `mx.js` (vendored
/// in this repo) on top of KiCad's outlines.
function LOCAL_FOOTPRINT_ROOT() -> string {
    "footprints"
}

function LOCAL_FOOTPRINT_LIB() -> string {
    "rosebear"
}

/// "Lib:Name" -> path to the .kicad_mod on disk.
function footprint_file(lib_id: string) -> string throws baml.errors.InvalidArgument {
    let parts = lib_id.split(":");
    let lib = parts.at(0)
        ?? throw baml.errors.InvalidArgument {
        message: `malformed footprint id '${lib_id}'`
    };
    let name = parts.at(1)
        ?? throw baml.errors.InvalidArgument {
        message: `footprint id '${lib_id}' is missing a library prefix`
    };
    let root = if (lib == LOCAL_FOOTPRINT_LIB()) {
        LOCAL_FOOTPRINT_ROOT()
    } else {
        KICAD_FOOTPRINT_ROOT()
    };
    `${root}/${lib}.pretty/${name}.kicad_mod`
}

/// Deterministic UUIDs keep the build reproducible: the same config emits a
/// byte-identical board.
function det_uuid(n: int) -> string {
    let s = `${n}`;
    let zeros = "000000000000";
    let pad = zeros.slice(0, 12 - s.length());
    `00000000-0000-4000-8000-${pad}${s}`
}

function fmt(v: float) -> string {
    // Six decimals is KiCad's nanometre resolution at millimetre scale.
    let r = (v * 1000000.0).round() / 1000000.0;
    let s = `${r}`;
    // KiCad writes whole numbers without a fractional part, and footprint
    // files are compared against this by `netlist_test.baml`.
    if (s.ends_with(".0")) {
        s.slice(0, s.length() - 2)
    } else {
        s
    }
}

/// Rewrite a footprint's layer names for placement on the back of the board.
/// Reverse-mount LEDs live under the switch and shine through, so they must sit
/// on B.Cu or they collide with the switch they light.
function flip_layers(line: string) -> string {
    line.replace("F.Cu", "B.Cu")
        .replace("F.SilkS", "B.SilkS")
        .replace("F.Mask", "B.Mask")
        .replace("F.Paste", "B.Paste")
        .replace("F.Fab", "B.Fab")
        .replace("F.CrtYd", "B.CrtYd")
        .replace("F.Adhes", "B.Adhes")
}

/// Negate a number written as text.
///
/// BAML has no float parser, and it does not need one here: the sign of a
/// decimal literal is the first character of it.
function neg_num(s: string) -> string {
    if (s == "0" || s == "0.0" || s == "-0" || s == "-0.0" || s == "") {
        "0"
    } else if (s.starts_with("-")) {
        s.slice(1, s.length())
    } else {
        `-${s}`
    }
}

/// Negate a coordinate token, which may carry the closing parens of its group.
function neg_token(s: string) -> string {
    let close: string[] = [];
    let core = s;
    while (core.ends_with(")")) {
        close.push(")");
        core = core.slice(0, core.length() - 1);
    }
    `${neg_num(core)}${close.join("")}`
}

/// s-expression heads whose first two arguments are an (x, y) pair.
function COORD_HEADS() -> string[] {
    ["at", "start", "end", "center", "mid", "xy"]
}

/// The head this token opens a coordinate group with, or "" if it does not.
function coord_head(tok: string) -> string {
    // The first token on a line carries its indentation.
    let t = tok.split("(");
    let bare = t.at(1) ?? "";
    if (t.length() != 2 || bare == "") {
        ""
    } else {
        let name = bare;
        if (contains_str(COORD_HEADS(), name)) {
            name
        } else {
            ""
        }
    }
}

/// Mirror one line of a footprint about the x axis.
///
/// Placing a footprint on the back of the board is not a rename. KiCad's own
/// flip mirrors every coordinate in the footprint and negates its angle; a
/// board file that renames the layers and leaves the geometry alone describes a
/// part with its pads in mirror image of the real one, which will not solder.
///
/// Done as text because it has to reach graphics as well as pads: the
/// courtyard, the silkscreen and -- for the reverse-mount LED -- the Edge.Cuts
/// window it shines through.
function mirror_line(line: string) -> string {
    let out: string[] = [];
    // Position within the coordinate group currently open, or -1 outside one.
    let since = 0 - 1;
    let is_at = false;
    for (let tok in line.split(" ")) {
        let head = coord_head(tok);
        if (head != "") {
            since = 0;
            is_at = head == "at";
            out.push(tok);
        } else if (since >= 0) {
            since = since + 1;
            if (since == 2 || (is_at && since == 3)) {
                out.push(neg_token(tok));
            } else {
                out.push(tok);
            }
            if (since >= 3) {
                since = 0 - 1;
            }
        } else {
            out.push(tok);
        }
    }
    out.join(" ")
}

/// Lines of a 3D model block, which is not board geometry and must be left
/// alone: mirroring its offset would move the model off the footprint.
function is_model_line(line: string) -> bool {
    let t = line.trim();
    t.starts_with("(model ")
        || t.starts_with("(offset")
        || t.starts_with("(scale")
        || t.starts_with("(rotate")
        || t.starts_with("(xyz ")
}

function net_for_pad(c: Component, pad_name: string) -> string? {
    c.pads
        .find((p) -> {
            p.pad == pad_name
        })
        ?.net
}

/// Read a library footprint and rewrite it for placement on a board:
/// strip the standalone-file header, stamp in position and reference, and
/// attach a net to each pad.
function embed_footprint(
    c: Component,
    uuid_base: int,
) -> string throws baml.errors.InvalidArgument | baml.errors.Io | baml.errors.ParseError {
    let text = baml.fs.read(footprint_file(c.footprint));
    let out: string[] = [];
    let placed = false;
    let in_pad = false;
    let pad_net: string? = null;
    let uid = uuid_base;
    // Every element inside the footprint needs its own UUID. Copying the
    // library file verbatim would give all 15 switches identical internal
    // UUIDs, which is invalid in a board file.
    let elem = uuid_base * 10000;
    // Reference designators go on F.Fab, not silkscreen: auto-placed refdes on
    // a dense key grid collides with the footprint outlines, and the text is
    // only useful for assembly anyway. The generated hotswap footprints say so
    // themselves; this covers the library parts, at the price of two
    // `lib_footprint_mismatch` warnings on the pod's buttons, whose library
    // copy keeps its reference on silk.
    let in_ref = false;
    // The footprint's own angle, which every pad has to repeat.
    let pad_angle = 0.0;

    let back = c.layer == "B.Cu";
    for (let raw_line in text.split("\n")) {
        let line = if (back && !is_model_line(raw_line)) {
            mirror_line(flip_layers(raw_line))
        } else if (back) {
            flip_layers(raw_line)
        } else {
            raw_line
        };
        let is_header = line.starts_with("\t(version ")
            || line.starts_with("\t(generator ")
            || line.starts_with("\t(generator_version ");

        if (is_header) {
            // dropped: only meaningful in a standalone .kicad_mod
        } else if (line.starts_with("(footprint ")) {
            out.push(`\t(footprint "${c.footprint}"`);
        } else if (!placed && line.starts_with("\t(layer ")) {
            out.push(`\t${line}`);
            out.push(`\t\t(uuid "${det_uuid(uid)}")`);
            // Mirroring the footprint's own geometry reverses the sense of its
            // rotation, so the stored angle is negated to match.
            pad_angle
                = if (back) {
                    0.0 - c.r
                } else {
                    c.r
                };
            out.push(`\t\t(at ${fmt(c.x)} ${fmt(c.y)} ${fmt(pad_angle)})`);
            placed = true;
        } else if (line.starts_with("\t(property \"Reference\"")) {
            in_ref = true;
            out.push(`\t\t(property "Reference" "${c.ref}"`);
        } else if (in_ref && line.trim().starts_with("(layer ")) {
            out.push(
                if (back) {
                    "\t\t\t(layer \"B.Fab\")"
                } else {
                    "\t\t\t(layer \"F.Fab\")"
                },
            );
        } else if (in_ref && line == "\t)") {
            in_ref = false;
            out.push(`\t${line}`);
        } else if (line.starts_with("\t(pad ")) {
            in_pad = true;
            let quoted = line.split("\"");
            pad_net = net_for_pad(c, quoted.at(1) ?? "");
            out.push(`\t${line}`);
        } else if (
            in_pad
                && pad_angle != 0.0
                && line.trim().starts_with("(at ")
                && line.split(" ").length() == 3
        ) {
            // A pad's stored angle is ABSOLUTE, not relative to its footprint.
            // A library file written flat leaves it off, so a rotated
            // footprint emitted without it keeps every pad in its original
            // orientation while the pad POSITIONS turn -- which on a 1.00mm
            // FFC connector turned on its side lays each contact across its
            // neighbours.
            out.push(`\t${line.slice(0, line.length() - 1)} ${fmt(pad_angle)})`);
        } else if (in_pad && line == "\t)") {
            if let n: string = pad_net {
                out.push(`\t\t\t(net "${n}")`);
            }
            in_pad = false;
            pad_net = null;
            out.push(`\t${line}`);
        } else if (back && line.trim() == "(effects") {
            // Text on the back is read through the board, so KiCad wants it
            // mirrored; without this every field on a back footprint is a DRC
            // warning and unreadable on the plot.
            out.push(`\t${line}`);
            out.push(`\t${line.replace("(effects", "\t(justify mirror)")}`);
        } else if (line.trim() == "") {
            // drop blank lines
        } else if (line.trim().starts_with("(uuid ")) {
            let indent = "\t\t";
            elem = elem + 1;
            out.push(`\t${indent}(uuid "${det_uuid(elem)}")`);
        } else {
            out.push(`\t${line}`);
        }
    }
    out.join("\n")
}

function edge_cuts(outline: Vec2[], uuid_base: int) -> string {
    let out: string[] = [];
    let n = outline.length();
    let i = 0;
    while (i < n) {
        let a = vec_at(outline, i);
        let b = vec_at(outline, (i + 1) % n);
        out.push(`\t(gr_line`);
        out.push(`\t\t(start ${fmt(a.x)} ${fmt(a.y)})`);
        out.push(`\t\t(end ${fmt(b.x)} ${fmt(b.y)})`);
        out.push(`\t\t(stroke`);
        out.push(`\t\t\t(width 0.1)`);
        out.push(`\t\t\t(type default)`);
        out.push(`\t\t)`);
        out.push(`\t\t(layer "Edge.Cuts")`);
        out.push(`\t\t(uuid "${det_uuid(uuid_base + i)}")`);
        out.push(`\t)`);
        i = i + 1;
    }
    out.join("\n")
}

function board_layers() -> string {
    let rows = [
        "(0 \"F.Cu\" signal)",
        "(2 \"B.Cu\" signal)",
        "(9 \"F.Adhes\" user \"F.Adhesive\")",
        "(11 \"B.Adhes\" user \"B.Adhesive\")",
        "(13 \"F.Paste\" user)",
        "(15 \"B.Paste\" user)",
        "(5 \"F.SilkS\" user \"F.Silkscreen\")",
        "(7 \"B.SilkS\" user \"B.Silkscreen\")",
        "(1 \"F.Mask\" user)",
        "(3 \"B.Mask\" user)",
        "(17 \"Dwgs.User\" user \"User.Drawings\")",
        "(19 \"Cmts.User\" user \"User.Comments\")",
        "(21 \"Eco1.User\" user \"User.Eco1\")",
        "(23 \"Eco2.User\" user \"User.Eco2\")",
        "(25 \"Edge.Cuts\" user)",
        "(27 \"Margin\" user)",
        "(31 \"F.CrtYd\" user \"F.Courtyard\")",
        "(29 \"B.CrtYd\" user \"B.Courtyard\")",
        "(35 \"F.Fab\" user)",
        "(33 \"B.Fab\" user)",
    ];
    rows
        .map((r) -> {
            `\t\t${r}`
        })
        .join("\n")
}

/// Every net on the board, in a stable order, with net 0 reserved for "no net".
///
/// Pads carry their net by name, but tracks and zones reference it by index, so
/// a board with copper needs the table that maps one to the other.
function net_names(b: Board) -> string[] {
    let names: string[] = [""];
    for (let c in b.components) {
        for (let p in c.pads) {
            if (!contains_str(names, p.net)) {
                names.push(p.net);
            }
        }
    }
    for (let t in b.tracks) {
        if (!contains_str(names, t.net)) {
            names.push(t.net);
        }
    }
    for (let v in b.vias) {
        if (!contains_str(names, v.net)) {
            names.push(v.net);
        }
    }
    for (let z in b.zones) {
        if (!contains_str(names, z.net)) {
            names.push(z.net);
        }
    }
    names
}

function net_index(names: string[], net: string) -> int {
    let i = 0;
    for (let n in names) {
        if (n == net) {
            return i;
        }
        i = i + 1;
    }
    0
}

function net_table(names: string[]) -> string {
    let out: string[] = [];
    let i = 0;
    for (let n in names) {
        out.push(`\t(net ${i} "${n}")`);
        i = i + 1;
    }
    out.join("\n")
}

function emit_tracks(b: Board, names: string[], uuid_base: int) -> string {
    let out: string[] = [];
    let i = 0;
    for (let t in b.tracks) {
        out.push("\t(segment");
        out.push(`\t\t(start ${fmt(t.start.x)} ${fmt(t.start.y)})`);
        out.push(`\t\t(end ${fmt(t.end.x)} ${fmt(t.end.y)})`);
        out.push(`\t\t(width ${fmt(t.width)})`);
        out.push(`\t\t(layer "${t.layer}")`);
        out.push(`\t\t(net ${net_index(names, t.net)})`);
        out.push(`\t\t(uuid "${det_uuid(uuid_base + i)}")`);
        out.push("\t)");
        i = i + 1;
    }
    out.join("\n")
}

function emit_vias(b: Board, names: string[], uuid_base: int) -> string {
    let out: string[] = [];
    let i = 0;
    for (let v in b.vias) {
        out.push("\t(via");
        out.push(`\t\t(at ${fmt(v.at.x)} ${fmt(v.at.y)})`);
        out.push(`\t\t(size ${fmt(VIA_DIA())})`);
        out.push("\t\t(drill 0.3)");
        out.push("\t\t(layers \"F.Cu\" \"B.Cu\")");
        out.push(`\t\t(net ${net_index(names, v.net)})`);
        out.push(`\t\t(uuid "${det_uuid(uuid_base + i)}")`);
        out.push("\t)");
        i = i + 1;
    }
    out.join("\n")
}

/// A zone outline. KiCad computes the fill itself; emitting no `filled_polygon`
/// leaves the zone unfilled until a refill, which `kicad-cli` does as part of
/// DRC.
function emit_zones(b: Board, names: string[], uuid_base: int) -> string {
    let out: string[] = [];
    let i = 0;
    for (let z in b.zones) {
        out.push("\t(zone");
        out.push(`\t\t(net ${net_index(names, z.net)})`);
        out.push(`\t\t(net_name "${z.net}")`);
        out.push(`\t\t(layer "${z.layer}")`);
        out.push(`\t\t(uuid "${det_uuid(uuid_base + i)}")`);
        out.push("\t\t(hatch edge 0.5)");
        // Solid, not thermal. An SK6812MINI-E supply pad is under a millimetre
        // across; four thermal spokes off it are narrower than the zone's own
        // minimum thickness, so KiCad fills none of them and the pad ends up
        // connected to nothing.
        out.push("\t\t(connect_pads yes");
        out.push("\t\t\t(clearance 0.3)");
        out.push("\t\t)");
        out.push("\t\t(min_thickness 0.25)");
        out.push("\t\t(filled_areas_thickness no)");
        out.push("\t\t(fill");
        out.push("\t\t\t(thermal_gap 0.4)");
        out.push("\t\t\t(thermal_bridge_width 0.5)");
        out.push("\t\t)");
        out.push("\t\t(polygon");
        out.push("\t\t\t(pts");
        for (let p in z.outline) {
            out.push(`\t\t\t\t(xy ${fmt(p.x)} ${fmt(p.y)})`);
        }
        out.push("\t\t\t)");
        out.push("\t\t)");
        out.push("\t)");
        i = i + 1;
    }
    out.join("\n")
}

function emit_board(
    b: Board,
) -> string throws baml.errors.InvalidArgument | baml.errors.Io | baml.errors.ParseError {
    let out: string[] = [];
    out.push("(kicad_pcb");
    out.push("\t(version 20260206)");
    out.push("\t(generator \"rosebear-v3\")");
    out.push("\t(generator_version \"10.0\")");
    out.push("\t(general");
    out.push("\t\t(thickness 1.6)");
    out.push("\t\t(legacy_teardrops no)");
    out.push("\t)");
    out.push("\t(paper \"A4\")");
    out.push("\t(title_block");
    out.push(`\t\t(title "rosebear ${b.id}")`);
    out.push("\t)");
    out.push("\t(layers");
    out.push(board_layers());
    out.push("\t)");
    out.push("\t(setup");
    out.push("\t\t(pad_to_mask_clearance 0)");
    out.push("\t)");

    let names = net_names(b);
    out.push(net_table(names));

    let uid = 1000;
    for (let c in b.components) {
        out.push(embed_footprint(c, uid));
        uid = uid + 1;
    }
    out.push(edge_cuts(b.outline, 90000));
    out.push(emit_tracks(b, names, 200000));
    out.push(emit_vias(b, names, 250000));
    out.push(emit_zones(b, names, 300000));
    out.push(")");
    out.join("\n")
}
