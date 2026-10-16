// The wires' ends: which pads and holes each net's wires join, and where on a
// shared pad or hole each sits.
import { point, type V3 } from '../geometry';
import { WIRING, distance, nets, type Env, type NetSpec, type Pad } from './common';

export interface Spec {
  net: NetSpec;
  from: string;
  to: string;
  /** A feed's `a` is its adapter hole (the ribbon pin). */
  a: Pad | number;
  b: Pad;
}

/** The tiles' pads, the wires' specs, and each spec's ends shifted to share their pads and holes. */
export function specsOf(env: Env, keys: string[]) {
  const { cfg, frames, hole, padZ } = env;
  const tile = cfg.tile;
  const downOf = (key: string): V3 => {
    const e = frames[key].elements;
    return [-e[8], -e[9], -e[10]];
  };
  const pads: Pad[] = keys.flatMap((key) =>
    tile.pads.list.map((p) => ({
      key,
      name: p.name,
      at: point(frames[key], [p.at_mm[0], p.at_mm[1], padZ]),
      xy: [p.at_mm[0], p.at_mm[1]] as [number, number],
      down: downOf(key),
    })),
  );
  const padsOf = (key: string, name: string) =>
    pads.filter((p) => p.key === key && p.name === name);
  const nearest = (options: Pad[], to: V3) =>
    options.reduce((a, b) => (distance(a.at, to) <= distance(b.at, to) ? a : b));

  const specs: Spec[] = [];
  for (const net of nets(cfg)) {
    for (const listed of net.chains ?? [cfg.wiring.led_order]) {
      const chain = listed.filter((k) => frames[k]);
      if (!chain.length) continue;
      // An undirected chain is fed from whichever end is nearer its hole.
      const first = (k: string) => padsOf(k, net.pads[0])[0]?.at ?? point(frames[k], [0, 0, 0]);
      if (
        !net.directed &&
        distance(first(chain.at(-1)!), hole[net.pin]) < distance(first(chain[0]), hole[net.pin])
      )
        chain.reverse();
      let from = hole[net.pin];
      let previous: Pad | undefined;
      chain.forEach((key, i) => {
        const options = padsOf(key, net.pads[0]);
        if (!options.length) throw Error(`Tile has no ${net.pads[0]} pad for ${net.name}`);
        const arrive = nearest(options, from);
        specs.push(
          previous
            ? { net, from: previous.key, to: key, a: previous, b: arrive }
            : { net, from: `hole ${net.pin}`, to: key, a: net.pin, b: arrive },
        );
        // Leave from a different pad of the same name, if the tile has one,
        // nearest the next key.
        const next = chain[i + 1];
        const outs = padsOf(key, net.pads[1]);
        const others = outs.filter((p) => p !== arrive);
        previous = next
          ? nearest(others.length ? others : outs, point(frames[next], [0, 0, 0]))
          : undefined;
        from = previous?.at ?? from;
      });
    }
  }

  // Two wires on one pad sit side by side along it, the one heading further
  // along the pad on that side; two on one hole sit side by side across the
  // hole row.
  const otherEnd = (s: Spec, end: Pad | number): V3 => {
    const e = end === s.b ? s.a : s.b;
    return typeof e === 'number' ? hole[e] : e.at;
  };
  const users = new Map<Pad | number, Spec[]>();
  for (const s of specs) for (const e of [s.a, s.b]) users.set(e, [...(users.get(e) ?? []), s]);
  const alongOf = (end: Pad | number): V3 => {
    const e = typeof end === 'number' ? frames.adapter.elements : frames[end.key].elements;
    return [e[4], e[5], e[6]];
  };
  const shift = (s: Spec, end: Pad | number) => {
    const list = users.get(end)!;
    if (list.length < 2) return 0;
    const along = alongOf(end);
    const at = typeof end === 'number' ? hole[end] : end.at;
    const reach = (x: Spec) => {
      const o = otherEnd(x, end);
      return (o[0] - at[0]) * along[0] + (o[1] - at[1]) * along[1] + (o[2] - at[2]) * along[2];
    };
    const sorted = [...list].sort((x, y) => reach(x) - reach(y));
    const share = typeof end === 'number' ? WIRING.holeShare : WIRING.padShare;
    return (sorted.indexOf(s) - (list.length - 1) / 2) * share;
  };
  const moved = (p: V3, along: V3, by: number): V3 => [
    p[0] + along[0] * by,
    p[1] + along[1] * by,
    p[2] + along[2] * by,
  ];
  const shiftedPad = (p: Pad, by: number): Pad => ({
    ...p,
    at: moved(p.at, alongOf(p), by),
    xy: [p.xy[0], p.xy[1] + by],
  });
  const ends = specs.map((s) => ({
    a:
      typeof s.a === 'number'
        ? moved(hole[s.a], alongOf(s.a), shift(s, s.a))
        : shiftedPad(s.a, shift(s, s.a)),
    b: shiftedPad(s.b, shift(s, s.b)),
  }));
  return { pads, padsOf, specs, ends };
}
