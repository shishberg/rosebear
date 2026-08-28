function probe() -> string throws baml.errors.InvalidArgument {
    let f = features_flex();
    let mods = partition_modules(layout_keys(f));
    let ribbons = build_ribbons(mods, f);
    let out: string[] = [];
    for (let r in ribbons) {
        out.push(`${r.id}: ${r.signals.map((s) -> { s.name }).join(", ")}`);
    }
    let bs = build_flex_boards(f);
    let b = find_board(bs, "finger_l");
    for (let c in b.components) {
        if (is_connector(c)) {
            let ps: string[] = [];
            let i = 1;
            for (let q in c.pads) {
                let g = comp_to_global(c, ffc_pad_local(i, c.pads.length()));
                ps.push(`${q.pad}:${q.net}@${g.x.round()},${g.y.round()}`);
                i = i + 1;
            }
            out.push(`${c.ref} at ${c.x.round()},${c.y.round()} r${c.r} : ${ps.join(" ")}`);
        }
    }
    let w = ROSEBEAR_WELL();
    let p = flex_defaults();
    let m = find_module(mods, "finger_l");
    for (let s in flex_strips(m, w, p)) {
        out.push(
            `strip ${s.column} cx=${s.cx.round()} y0=${s.y0.round()} y1=${s.y1.round()} keys=${s.key_ys.map((y) -> { y.round() }).join(",")} band=${strip_neck_y(s, w).round()}`,
        );
    }
    out.join("\n")
}
