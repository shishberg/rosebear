// Board variants, and what each key contributes to the wiring.
//
// The point of this file: nothing downstream hardcodes a conductor count. Turn
// `per_key_leds` on and the ribbons widen, the connectors change part, the
// pass-through grows and the power conductors are recomputed -- because every
// one of those reads from the functions here.

class Features {
    /// Per-key addressable RGB. v2-p4-pod.md rules this out as drawn (it
    /// conflicts with keeping fast signals off the ribbons), so enabling it
    /// also pulls in the grounded-neighbour rule below.
    per_key_leds: bool,
    /// Budgeted current per LED in milliamps. SK6812MINI-E draws ~60mA at full
    /// white; firmware normally caps well below that. Drives conductor count.
    led_ma_per_key: float,
}

function features_base() -> Features {
    Features { per_key_leds: false, led_ma_per_key: 0.0 }
}

function features_leds() -> Features {
    Features { per_key_leds: true, led_ma_per_key: 20.0 }
}

// ------------------------------------------------------------------ signals

enum SignalKind {
    Key,
    Ground,
    Power,
    LedData,
    Spare,
}

class Signal {
    name: string,
    kind: SignalKind,
}

/// The LED supply rail. One net however many conductors carry it.
function LED_VDD_NET() -> string {
    "LED_VDD"
}

/// Net name for a key's switch line. Direct-wired: one GPIO per key, no matrix,
/// no diode.
function key_net(k: PlacedKey) -> string {
    `KEY_${k.name.to_upper_case()}`
}

// ------------------------------------------------------------------ modules

class Module {
    id: string,
    /// Which physical half this belongs to, for naming and mirroring.
    hand: string,
    keys: PlacedKey[],
}

function module_of(k: PlacedKey) -> string {
    let hand = if (k.mirrored) {
        "r"
    } else {
        "l"
    };
    if (k.zone == "thumb") {
        `thumb_${hand}`
    } else {
        `finger_${hand}`
    }
}

function partition_modules(keys: PlacedKey[]) -> Module[] {
    let ids = ["finger_l", "thumb_l", "finger_r", "thumb_r"];
    ids.map((id) -> {
        Module {
            id: id,
            hand: if (id.ends_with("_l")) {
                "l"
            } else {
                "r"
            },
            keys: keys.filter((k) -> {
                module_of(k) == id
            }),
        }
    })
}

function find_module(mods: Module[], id: string) -> Module throws baml.errors.InvalidArgument {
    mods.find((m) -> {
        m.id == id
    })
        ?? throw baml.errors.InvalidArgument { message: `no module '${id}'` }
}

// -------------------------------------------------------------- LED chaining

/// Serpentine order through the finger matrix, then out to the thumb cluster.
/// Boustrophedon by column keeps the din/dout hops short: the chain runs up one
/// column and back down the next.
function COLUMN_ORDER() -> string[] {
    ["pinky", "ring", "middle", "index", "inner"]
}

function ROW_ORDER() -> string[] {
    ["bottom", "home", "top"]
}

function THUMB_ORDER() -> string[] {
    ["near", "home", "far"]
}

/// Order a module's keys along the LED data chain.
function led_chain(m: Module) -> PlacedKey[] {
    let ordered: PlacedKey[] = [];
    if (m.keys.length() == 0) {
        return ordered;
    }
    let is_thumb = m.keys.at(0)?.zone == "thumb";
    if (is_thumb) {
        // Far key first: the thumb link stands just beyond the far key, so
        // starting there lets the head enter the chain without crossing the
        // cluster, and the chain walks away from the connector.
        for (let cname in THUMB_ORDER().reverse()) {
            for (let k in m.keys) {
                if (k.column == cname) {
                    ordered.push(k);
                }
            }
        }
        return ordered;
    }
    let col_i = 0;
    for (let cname in COLUMN_ORDER()) {
        // Alternate direction per column so the chain snakes rather than
        // jumping back to the bottom of every column.
        let rows = if (col_i % 2 == 0) {
            ROW_ORDER()
        } else {
            ROW_ORDER().reverse()
        };
        for (let rname in rows) {
            for (let k in m.keys) {
                if (k.column == cname && k.row == rname) {
                    ordered.push(k);
                }
            }
        }
        col_i = col_i + 1;
    }
    ordered
}
