// PROTOTYPE. Question: Which wall design should the Skeletyl have? Variants
// switchable via ?walls= on the editor.
//
// ?walls=flare (bell skirt): one continuous skirt down each outer side, from
// the rib's outer edge to the rail, leaving the rib straight down and flaring
// out to the rail like a trumpet's mouth. The reference variant: it shows how
// a WallSide is used.
//
// The skirt is swept along the side through one cross-section per side point,
// each in the upright plane across the side through the point's top edge. A
// section runs from the plate's top edge (a chamfer out to the wall's outer
// face), down the inner face from the plate's underside to the rail, and back
// up the outer face, a wall's thickness out. The inner face goes out t² of the
// way to the rail as it goes down (t from 0 at the plate to 1 on the rail), and
// further where a key needs the room. The skirt runs on over the ends' lips
// and rounds as far as they carry on along the side, so at a drop it ends
// flush with the drop's outer face. Sections too low to stand over the rail,
// or that would hit a key, are left out, the skirt parting there.
import type { Manifold } from 'manifold-3d';
import { add, dot, scale, sub, type V3 } from '../geometry';
import type { WallKit, WallSide } from '../skeletyl-walls.prototype';

/** Steps down each section's faces; how far (mm) it reaches into the rib and the rail; the least height (mm) over the rail a section needs. */
const STEPS = 12;
const INTO = 0.3;
const LEAST = 4;

export function flare(kit: WallKit, side: WallSide): Manifold[] {
  const { points, keys } = side;
  const up: V3 = [0, 0, 1];
  // Whether the next point's top is on along the side from point i's.
  const sense = Math.sign(dot(sub(points.at(-1)!.top, points[0].top), along(points[0].out)));
  const onward = (i: number) =>
    sense * dot(sub(points[i + 1].top, points[i].top), along(points[i].out)) > 0.05;
  // From where the first end starts carrying on along the side (the bottom of
  // its round, at a drop) to where the last stops.
  let [a, b] = [keys[0].from, keys.at(-1)!.to];
  while (a > 0 && onward(a - 1)) a--;
  while (b < points.length - 1 && onward(b)) b++;
  // Each section stands in the upright plane through its top point, across
  // the side: its base is under there (under's offset along the side dropped).
  const bases = points.map((p) =>
    sub(p.under, scale(along(p.out), dot(sub(p.under, p.top), along(p.out)))),
  );
  const sections = points.map((p, i): V3[] | undefined => {
    if (i < a || i > b) return undefined;
    const base = bases[i];
    const z0 = base[2] + INTO;
    const drop = z0 - side.railHeight / 2;
    // Out to the rail's inner edge (and a little into the rail); where the
    // rail is closer in than that, the wall comes straight down onto it.
    const reach = Math.max(0, dot(sub(p.rail.inner, base), p.out) + INTO);
    if (drop < LEAST) return undefined;
    // Heights down the inner face, closer near the plate.
    const zs = Array.from({ length: STEPS + 1 }, (_, j) => z0 - drop * (j / STEPS) ** 1.5);
    const inner = zs.map((z, j) => {
      const t = (z0 - z) / drop;
      // The most room the keys need between the neighbouring steps' heights,
      // here and at the neighbouring points, so the faces between them clear too.
      let room = 0;
      for (let y = zs[Math.min(STEPS, j + 1)]; y <= zs[Math.max(0, j - 1)]; y += 0.25)
        for (const k of [i - 1, i, i + 1])
          if (points[k])
            room = Math.max(room, side.room([bases[k][0], bases[k][1], y], points[k].out));
      const x = Math.max(-INTO + (reach + INTO) * t * t, j || room ? room + 0.1 : -INTO);
      return add([base[0], base[1], z], scale(p.out, x));
    });
    // The outer face: a wall's thickness out from the inner, square to it.
    const outer = inner.map((q, j) => {
      const [m, n] = [inner[Math.max(0, j - 1)], inner[Math.min(STEPS, j + 1)]];
      const [dx, dz] = [dot(sub(n, m), p.out), n[2] - m[2]];
      const l = Math.hypot(dx, dz);
      return add(q, add(scale(p.out, (-dz / l) * side.wall), scale(up, (dx / l) * side.wall)));
    });
    // It must land on the rail, at least INTO in from its outer edge.
    if (dot(sub(inner[STEPS], p.rail.outer), p.out) > -INTO) return undefined;
    const top = sub(p.top, add(scale(p.out, INTO), scale(up, 2 * INTO)));
    return [top, ...inner, ...outer.reverse()];
  });
  // The skirt: one sweep through each run of sections whose faces clear the
  // keys, tested at points over them.
  const over = (s: V3[], t: V3[]) =>
    s.flatMap((q, j) => {
      const k = (j + 1) % s.length;
      const [r, q2, r2] = [s[k], t[j], t[k]];
      return GRID.flatMap((f) => GRID.map((g) => lerp(lerp(q, r, f), lerp(q2, r2, f), g)));
    });
  const runs: V3[][][] = [];
  let prev: V3[] | undefined;
  for (const s of sections) {
    const ok = s && side.clear(over(s, s));
    if (ok && prev && side.clear(over(prev, s))) runs.at(-1)!.push(s);
    else if (ok) runs.push([s]);
    prev = ok ? s : undefined;
  }
  return runs.filter((r) => r.length > 1).map((r) => kit.sweep(r));
}

const lerp = (p: V3, q: V3, f: number) => add(p, scale(sub(q, p), f));
const GRID = [0, 0.25, 0.5, 0.75];
/** Along the side, in plan, given its outward direction. */
const along = (out: V3): V3 => [-out[1], out[0], 0];
