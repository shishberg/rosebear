// PROTOTYPE. Question: Which wall design should the Skeletyl have? Variants
// switchable via ?walls= on the editor.
//
// ?walls=arches (viaduct): a row of arches down each outer side, like a Roman
// aqueduct. A pier stands on the rail under each web between neighbouring
// keys, and an abutment under each end (from the bottom of its round, flush
// with a drop's outer face, to the end key; half a pier at a flush end). Over
// each key an arch springs from pier to pier, its crown a band just under the
// plate's outer edge, so the tiles show through. The crown runs parallel to
// the plate's underside, so the arches follow the column, their springings
// and jambs taller where the keys are higher. An arch is semicircular where
// there is height for it over jambs JAMB tall, else segmental, as flat as the
// height leaves; under a key too low for even that, the wall is solid.
//
// Piers and arches lie on one skirt, as flare's: swept along the side through
// upright sections across it, from a chamfer at the plate's edge down the
// inner face (going out t² of the way to the rail) and back up the outer face,
// a wall's thickness out. Where a key's socket or tile stands out past the
// plate's edge the skirt swells smoothly out round it. A pier's sections run to
// the rail; an arch's stop at its intrados, and run on a little into the piers
// at the springings so the union joins them. Each pier and arch is built whole
// or not at all: a part arch would look broken.
import type { Manifold } from 'manifold-3d';
import { add, dot, scale, sub, unit, type V3 } from '../geometry';
import type { WallKit, WallSide } from '../skeletyl-walls.prototype';

/** Sizes in mm: a pier's width along the side; the band's depth at a crown; the least jamb under a springing; how far pieces reach into the rib, the rail and each other; the least height over the rail a section needs. Then the steps down each section's faces, the chamfer's depths to try (fractions of the plate's edge, highest first), and how fast the skirt eases back in from a swell (mm per mm). */
const [PIER, BAND, JAMB, INTO, LEAST] = [5, 2, 3, 0.3, 4];
const [STEPS, CHAMFER, EASE] = [12, [0.2, 0.5, 0.8], 0.5];

export function arches(kit: WallKit, side: WallSide): Manifold[] {
  const { points, keys } = side;
  const up: V3 = [0, 0, 1];
  // From where the first end starts carrying on along the side to where the
  // last stops (as flare), and the distance along it (in plan) of each point.
  const sense = Math.sign(dot(sub(points.at(-1)!.top, points[0].top), along(points[0].out)));
  const onward = (i: number) =>
    sense * dot(sub(points[i + 1].top, points[i].top), along(points[i].out)) > 0.05;
  let [a, b] = [keys[0].from, keys.at(-1)!.to];
  while (a > 0 && onward(a - 1)) a--;
  while (b < points.length - 1 && onward(b)) b++;
  const bases = points.map((p) =>
    sub(p.under, scale(along(p.out), dot(sub(p.under, p.top), along(p.out)))),
  );
  const s: number[] = [];
  for (let i = a; i <= b; i++)
    s[i] =
      i === a ? 0 : s[i - 1] + Math.hypot(...sub(points[i].top, points[i - 1].top).slice(0, 2));

  // The side at distance d along it, between points i and i + 1.
  const at = (d: number) => {
    let i = a;
    while (i < b - 1 && s[i + 1] < d) i++;
    const u = Math.min(1, Math.max(0, (d - s[i]) / (s[i + 1] - s[i])));
    const [p, q] = [points[i], points[i + 1]];
    const mix = (v: V3, w: V3) => add(v, scale(sub(w, v), u));
    const out = unit(mix(p.out, q.out));
    return { out, top: mix(p.top, q.top), base: mix(bases[i], bases[i + 1]), rail: mix(p.rail.inner, q.rail.inner), edge: mix(p.rail.outer, q.rail.outer) }; // prettier-ignore
  };
  // How far out the inner face must stand at d: the most room the keys need
  // anywhere down the side (sampled every 0.5 mm along it, as a socket can
  // stand out between two points), eased off to either side at EASE so the
  // wall swells smoothly round what stands out rather than jutting.
  const needs = new Map<number, number>();
  const need = (g: number) => {
    if (!needs.has(g)) {
      const { base, out } = at(g / 2);
      let room = 0;
      for (let z = base[2] + INTO; z > side.railHeight; z -= 0.25)
        room = Math.max(room, side.room([base[0], base[1], z], out));
      needs.set(g, room);
    }
    return needs.get(g)!;
  };
  const setback = (d: number) => {
    let x = 0;
    for (let g = Math.floor(d * 2) - 16; g <= Math.ceil(d * 2) + 16; g++)
      x = Math.max(x, need(g) - EASE * Math.max(0, Math.abs(g / 2 - d) - 1));
    return x + 0.1;
  };

  // The section at d, down to height zb (or the rail), with its chamfer from
  // each of CHAMFER's depths down the plate's outer edge: undefined if too low.
  const section = (d: number, zb = -Infinity): V3[][] | undefined => {
    const { out, top, base, rail, edge } = at(d);
    const z0 = base[2] + INTO;
    const drop = z0 - side.railHeight / 2;
    const reach = Math.max(0, dot(sub(rail, base), out) + INTO);
    if (drop < LEAST) return undefined;
    const end = Math.max(zb, z0 - drop);
    const zs = Array.from({ length: STEPS + 1 }, (_, j) => z0 - (z0 - end) * (j / STEPS) ** 1.2);
    const x0 = setback(d);
    if (x0 === Infinity) return undefined;
    const inner = zs.map((z, j) => {
      const t = (z0 - z) / drop;
      return add(
        [base[0], base[1], z],
        scale(out, Math.max(-INTO + (reach + INTO) * t * t, j ? x0 : -INTO)),
      );
    });
    const outer = inner.map((q, j) => {
      const [m, n] = [inner[Math.max(0, j - 1)], inner[Math.min(STEPS, j + 1)]];
      const [dx, dz] = [dot(sub(n, m), out), n[2] - m[2]];
      const l = Math.hypot(dx, dz);
      return add(q, add(scale(out, (-dz / l) * side.wall), scale(up, (dx / l) * side.wall)));
    });
    // A pier must land on the rail, at least INTO in from its outer edge.
    if (zb === -Infinity && dot(sub(inner[STEPS], edge), out) > -INTO) return undefined;
    const body = [...inner, ...outer.reverse()];
    return CHAMFER.map((f) => [sub(lerp(top, base, f), scale(out, INTO)), ...body]);
  };

  // The piers: an abutment at each end, one centred on each web.
  const [first, last] = [s[keys[0].from], s[keys.at(-1)!.to]];
  const piers: [number, number][] = [
    side.ends[0] === 'flush' ? [first, first + PIER / 2] : [0, first],
    ...keys.slice(1).map((k, n) => {
      const m = (s[keys[n].to] + s[k.from]) / 2;
      return [m - PIER / 2, m + PIER / 2] as [number, number];
    }),
    side.ends[1] === 'flush' ? [last - PIER / 2, last] : [last, s[b]],
  ];
  // A solid stretch of wall down to the rail from l to r, a section a millimetre.
  const spaced = (l: number, r: number) => {
    const n = Math.max(2, Math.ceil(r - l) + 1);
    return Array.from({ length: n }, (_, j) => l + ((r - l) * j) / (n - 1));
  };
  // An arch over each key, from the pier before it to the pier after; where
  // the key is too low for one, a solid wall. The solid walls and the piers
  // they join are one sweep, through each one's own sections in turn, so no
  // two sweeps meet there: two that shared sections would overlap face to
  // face, and two that ran into each other would cross at a graze (chords of
  // one skirt taken at different places), either of which the union can
  // leave specks of no volume along.
  const crown = (d: number) => at(d).base[2] + INTO - BAND;
  const rises = piers.slice(1).map(([r], n) => {
    const l = piers[n][1];
    return Math.min((r - l) / 2, Math.min(crown(l), crown(r)) - side.railHeight - JAMB);
  });
  const pieces: (V3[][] | undefined)[][] = [];
  piers.forEach(([l, r], n) => {
    const ds = spaced(l, r);
    if (n && rises[n - 1] < 1) {
      const run = pieces.at(-1)!;
      run.push(...[...spaced(piers[n - 1][1], l).slice(1), ...ds.slice(1)].map((d) => section(d)));
    } else pieces.push(ds.map((d) => section(d)));
  });
  piers.slice(1).forEach(([r], n) => {
    const l = piers[n][1];
    const half = (r - l) / 2;
    const h = rises[n];
    if (h < 1) return;
    // A segment of a circle of radius R, rise h over span 2·half, sheared to
    // follow the crown; past the springings, the springing's height.
    const R = (half * half + h * h) / (2 * h);
    const phi = Math.asin(half / R);
    const ds = [l - INTO * 2, ...Array.from({ length: 33 }, (_, j) => l + half + R * Math.sin(phi * (j / 16 - 1))), r + INTO * 2]; // prettier-ignore
    const rise = (d: number) =>
      Math.max(0, Math.sqrt(Math.max(0, R * R - (d - l - half) ** 2)) - (R - h));
    pieces.push(ds.map((d) => section(d, crown(d) - h + rise(d))));
  });

  // Each pier (or run of piers and solid walls) and arch is built whole or
  // not at all: only if every section, and the faces between them, clear the
  // keys (tested at points over them), each chamfered as high up the plate's
  // edge as clears.
  const over = (p: V3[], q: V3[]) =>
    p.flatMap((v, j) => {
      const k = (j + 1) % p.length;
      return GRID.flatMap((f) => GRID.map((g) => lerp(lerp(v, p[k], f), lerp(q[j], q[k], f), g)));
    });
  return pieces.flatMap((secs) => {
    const chosen: V3[][] = [];
    for (const options of secs) {
      const prev = chosen.at(-1);
      const sec = options?.find(
        (c) => side.clear(over(c, c)) && (!prev || side.clear(over(prev, c))),
      );
      if (!sec) return [];
      chosen.push(sec);
    }
    return [kit.sweep(chosen)];
  });
}

const lerp = (p: V3, q: V3, f: number) => add(p, scale(sub(q, p), f));
const GRID = [0, 0.25, 0.5, 0.75];
/** Along the side, in plan, given its outward direction. */
const along = (out: V3): V3 => [-out[1], out[0], 0];
