// Adapter to the existing, tested footprint and cut-geometry library.
// Executed in an isolated generated BAML project with a chassis-derived Well.
class SeedFinger {
    id: string,
    keys: PlacedKey[],
    strips: Strip[],
    cuts: Vec2[][],
    neck: Copper,
    thumb_fan: Copper,
    wire_feet: Vec2[],
}
class SeedExport {
    fingers: SeedFinger[],
    well: Well,
    pinout: string,
}
function seed_export() -> SeedExport throws baml.errors.InvalidArgument | baml.errors.Io | baml.errors.ParseError {
    let f = features_flex();
    let w = ROSEBEAR_WELL();
    let mods = partition_modules(layout_keys(f));
    let rs = build_ribbons(mods, f);
    baml.fs.mkdir("seed", baml.fs.MkdirOptions { recursive: true });
    write_lib_table("seed", "../../../../v3/");
    let fingers: SeedFinger[] = [];
    for (let m in mods) {
        if (m.id.starts_with("finger")) {
            let b = flex_board(m, rs, f);
            let ss = flex_strips(m, w, flex_defaults());
            let s = find_strip(ss, inner_column());
            baml.fs.write(`seed/${b.id}.kicad_pcb`, emit_board(b));
            write_project("seed", b.id, f);
            fingers.push(SeedFinger {
                id: b.id, keys: m.keys, strips: ss, cuts: b.cuts,
                neck: route_flex_necks(b, ss, w),
                thumb_fan: route_thumb_fan(b, s, hand_dir(ss)),
                wire_feet: [9,6,5,4].map((rank) -> { at_u(s, hand_dir(ss), shelf_lane_u(rank), shelf_via_y(s, rank)) }),
            });
        }
    }
    let pod = build_pod_board(rs, f);
    baml.fs.write("seed/pod.kicad_pcb", emit_board(pod));
    write_project("seed", "pod", f);
    SeedExport { fingers: fingers, well: w, pinout: pod_pinout(f) }
}

