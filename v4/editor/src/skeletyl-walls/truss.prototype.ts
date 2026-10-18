// PROTOTYPE. Question: Which wall design should the Skeletyl have? Variants
// switchable via ?walls= on the editor.
//
// ?walls=truss (triangulated): a Warren truss down each outer side. The rib
// is its top chord and the rail its bottom chord; straight struts zig-zag
// between them, so the side is open triangles, like a bridge's. The top nodes
// are on the rib's outer edge, at the plate corner nearest each end and the
// middle of each web; the bottom nodes are on the rail, under the middle of
// each key, and at a drop's foot (the drop is the truss's end post: a strut
// from its foot to the end key's corner closes the end triangle). A hanging or
// flush end starts with a strut from its last point.
//
// Each strut is the hull of two square sections, a wall thick: across the
// side it stands just outside the plate's edge at the top and on the rail at
// the bottom. Each node has a gusset: the hull of the struts' ends there and a
// pad on the rib (its outer edge, chamfered from the top) or on the rail.
// Where a key needs the room (a tilted key's tile hanging out past its plate)
// a top node moves out, its struts leaning out from their feet, as far as the
// most any point down them needs, and on half a mm at a time until they and
// its gusset clear the keys (tested at points over their faces, 1 mm apart);
// failing that, the node keeps one strut, or none.
import type { Manifold } from 'manifold-3d';
import { add, cross, scale, sub, unit, type V3 } from '../geometry';
import type { WallKit, WallSide } from '../skeletyl-walls.prototype';

/** How far (mm) members reach into the rib and the rail; the struts' width in the side's plane; how far along each strut a gusset reaches, and its pad each way along the side; the most a node may move out; the least height of a top node over the rail. */
const INTO = 0.3;
const WIDTH = 2.4;
const GUSSET = 5;
const PAD = 3;
const PUSH = 8;
const LEAST = 5;

/** A node: at side point i, on the rail (low) or the rib, moved d out. */
type Node = { i: number; low: boolean; d: number };

export function truss(kit: WallKit, side: WallSide): Manifold[] {
  const { points: P, keys, wall } = side;
  const H = side.railHeight;
  const hull = (pts: V3[]) => kit.wasm.Manifold.hull(pts);
  const mid = (a: number, b: number) => Math.round((a + b) / 2);
  // A drop's foot: the point down the end (from a to b) nearest the rail's top.
  const foot = (a: number, b: number) => {
    let f = a;
    for (let i = a; i < b; i++) if (Math.abs(P[i].top[2] - H) < Math.abs(P[f].top[2] - H)) f = i;
    return f;
  };
  // The nodes, in order along the side, alternating bottom and top.
  const [first, last] = [keys[0].from, keys.at(-1)!.to];
  const seq: Node[] = [];
  const node = (i: number, low: boolean) => seq.push({ i, low, d: 0 });
  if (side.ends[0] === 'drop') node(foot(0, first), true);
  node(side.ends[0] === 'drop' ? first : 0, false);
  keys.forEach((k, n) => {
    node(mid(k.from, k.to), true);
    if (keys[n + 1]) node(mid(k.to, keys[n + 1].from), false);
  });
  node(side.ends[1] === 'drop' ? last : P.length - 1, false);
  if (side.ends[1] === 'drop') node(foot(last + 1, P.length), true);
  // A node's centre: a top node half a wall out from the plate's edge (and d
  // further), a bottom one on the rail's centreline at its top.
  const centre = (n: Node): V3 =>
    n.low
      ? [P[n.i].rail.centre[0], P[n.i].rail.centre[1], H]
      : add(P[n.i].under, scale(P[n.i].out, wall / 2 - INTO + n.d));
  // A strut's square section at s along it (0 at its top node, 1 at its
  // bottom), or the inner face's edges only.
  const section = ([t, b]: Node[], s: number, across = [-1, 1]) => {
    const [ct, cb] = [centre(t), centre(b)];
    const o = unit(add(P[t.i].out, P[b.i].out));
    const n = unit(cross(sub(cb, ct), o));
    const c = add(ct, scale(sub(cb, ct), s));
    return across.flatMap((a) =>
      [-1, 1].map((w) => add(c, add(scale(o, (a * wall) / 2), scale(n, (w * WIDTH) / 2)))),
    );
  };
  const len = ([t, b]: Node[]) => Math.hypot(...sub(centre(b), centre(t)));
  const floor = (pts: V3[]) => pts.map((p): V3 => [p[0], p[1], H - INTO]);
  // The struts, top node first, but none from a top node too low.
  const struts = seq
    .slice(1)
    .map((n, k) => (n.low ? [seq[k], n] : [n, seq[k]]))
    .filter(([t]) => P[t.i].under[2] - H >= LEAST);
  // How far a strut's top must move out for its inner face to clear, its foot
  // staying put; its top node moves out as far as its struts need.
  const need = new Map(
    struts.map((m) => {
      let d = 0;
      for (let s = 0.05; s < 0.95; s += 0.5 / len(m))
        for (const p of section(m, s, [-1])) {
          const r = side.room(p, P[m[0].i].out);
          if (r > 0) d = Math.max(d, (r + 0.1) / (1 - s));
        }
      return [m, d];
    }),
  );
  // Whether a member clears the keys, at points over its faces 1 mm apart.
  const fits = (m: Manifold) => {
    const { vertProperties: v, triVerts: tv, numProp } = m.getMesh();
    const at = (k: number): V3 => [v[k * numProp], v[k * numProp + 1], v[k * numProp + 2]];
    const pts: V3[] = [];
    for (let f = 0; f < tv.length; f += 3) {
      const [a, b, c] = [at(tv[f]), at(tv[f + 1]), at(tv[f + 2])];
      const n = Math.ceil(Math.max(Math.hypot(...sub(b, a)), Math.hypot(...sub(c, a))));
      for (let i = 0; i <= n; i++)
        for (let j = 0; i + j <= n; j++)
          pts.push(add(a, add(scale(sub(b, a), i / n), scale(sub(c, a), j / n))));
    }
    return side.clear(pts);
  };
  const strut = (m: Node[]) => hull([...section(m, 0), ...section(m, 1), ...floor(section(m, 1))]);
  // A node's gusset: its struts' ends and a pad, on the rib's outer edge (from
  // just inside its top edge down and out to the struts' outer face) or on
  // the rail's top.
  const gusset = (n: Node, ms: Node[][]) => {
    const on = (p: (typeof P)[number]) => (n.low ? p.rail.centre : p.under);
    const near = P.filter((p) => Math.hypot(...sub(on(p), on(P[n.i]))) <= PAD);
    const pad = near.flatMap(({ top, under, out: o, rail }): V3[] =>
      n.low
        ? [rail.inner, rail.outer].flatMap((r): V3[] => [
            [r[0], r[1], H],
            [r[0], r[1], H - INTO],
          ])
        : [
            add(top, scale(add(o, [0, 0, 2]), -INTO)),
            add(under, scale(o, n.d - INTO)),
            add(under, scale(o, wall - INTO + n.d)),
          ],
    );
    const ends = ms.flatMap((m) => {
      const s = GUSSET / len(m);
      return n.low
        ? [...section(m, 1 - s), ...floor(section(m, 1))]
        : [...section(m, 0), ...section(m, s)];
    });
    return hull([...pad, ...ends]);
  };
  // Each top node, moved out until its struts (both if they can, else one)
  // and its gusset clear; then the bottom nodes' gussets.
  const solids = new Map<Node[], Manifold>();
  const gussets: Manifold[] = [];
  for (const t of seq.filter((n) => !n.low)) {
    const ms = struts.filter((m) => m[0] === t && need.get(m)! <= PUSH);
    const d0 = Math.max(0, ...ms.map((m) => need.get(m)!));
    search: for (const want of new Set([ms.length, 1].slice(0, ms.length)))
      for (t.d = d0; t.d <= PUSH; t.d += 0.5) {
        const kept = new Map(ms.map((m) => [m, strut(m)] as const).filter(([, s]) => fits(s)));
        const g = kept.size >= want && gusset(t, [...kept.keys()]);
        if (g && fits(g)) {
          kept.forEach((s, m) => solids.set(m, s));
          gussets.push(g);
          break search;
        }
      }
  }
  for (const b of seq.filter((n) => n.low)) {
    const ms = [...solids.keys()].filter((m) => m[1] === b);
    const g = ms.length && gusset(b, ms);
    if (g && fits(g)) gussets.push(g);
  }
  return [...gussets, ...solids.values()];
}
