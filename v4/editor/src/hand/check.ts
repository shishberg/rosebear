// The ?hand check: keycaps, tiles and the hand's parts against the keyboard and the
// test frame (caps, boxes, SAT), and the readout's problems.
import * as T from 'three';
import {
  capSize,
  capTop,
  componentFrames,
  frame,
  ROWS,
  tilePartCentre,
  tileUnderside,
  type Config,
  type MeshData,
} from '../geometry';
import { label } from './frame';
import {
  BACK_OF_THUMB,
  C,
  EXTRA_LIFT,
  FINGERS,
  type Finger,
  type Pose,
  SCALE,
  THUMB_EDGE,
  THUMB_R,
  TIP_R,
  TOL,
  pastJoints,
  pressed,
  rowPose,
  thumb,
} from './model';
import {
  type Settings,
  type Solved,
  capFrame,
  keyTurn,
  mixFor,
  rowDistance,
  solveHand,
  thumbKeysOf,
  turnOf,
  twoOf,
  wayOf,
} from './layout';

/** A keycap: its top's centre and frame (z out of the cap), its size at the
 * base, and its top face (x, y), smaller: it tapers. */
type Cap = { name: string; top: T.Matrix4; size: number[]; face: number[] };
/** Every keycap in the hand frame. A finger key's y runs up its column. */
export function capsOf(c: Config, h: Solved, two: boolean): Cap[] {
  const out: Cap[] = [];
  for (const col of Object.keys(h.poses)) {
    const P = h.poses[col],
      d = P[0].chain.pad.clone().sub(P[2].chain.pad);
    P.forEach((p, ri) => {
      const name = `matrix_${col}_${ROWS[ri]}`;
      out.push({
        name,
        top: capFrame(p.chain.pad, p.n, d),
        size: capSize(c, name),
        face: capTop(c, name),
      });
    });
  }
  thumbKeysOf(h).forEach(({ name: n, k }) => {
    const name = `thumb_${n}`;
    out.push({
      name,
      top: k.frame.clone().multiply(frame([0, 0, 0], keyTurn(n, two))),
      size: capSize(c, name),
      face: capTop(c, name),
    });
  });
  return out;
}
/** A box: centre, unit axes, half-sizes. */
type Box = { c: T.Vector3; u: T.Vector3[]; e: number[] };
/** A keycap's half-size (x, y) `z` mm down from its top: the taper. */
const halfAt = (k: Cap, z: number) => {
  const t = Math.min(Math.max(z / k.size[2], 0), 1);
  return [0, 1].map((i) => (k.face[i] + (k.size[i] - k.face[i]) * t) / 2);
};
/** Slices the taper is checked in (each as wide as at its middle: within 0.15 mm). */
const SLICES = 8;
/** A keycap's room as boxes, `grow` mm bigger all round: the tapered cap, in
 * slices, and below it its base's footprint on down `below` mm (the travel). */
function capBoxes(k: Cap, grow: number, below = 0): Box[] {
  const u = [0, 1, 2].map((i) => new T.Vector3().setFromMatrixColumn(k.top, i)),
    box = (top: number, depth: number, half: number[]) => ({
      c: new T.Vector3(0, 0, -top - depth / 2).applyMatrix4(k.top),
      u,
      e: [half[0] + grow, half[1] + grow, depth / 2],
    }),
    h = k.size[2] / SLICES,
    out = Array.from({ length: SLICES }, (_, i) => box(i * h, h, halfAt(k, (i + 0.5) * h)));
  if (below > 0) out.push(box(k.size[2], below, halfAt(k, k.size[2])));
  return out;
}
export const overlap = (a: Box[], b: Box[]) =>
  Math.max(...a.flatMap((x) => b.map((y) => boxOverlap(x, y))));
/** How far two boxes overlap (mm, along the axis that separates them best;
 * 0 when apart), by separating axes. */
function boxOverlap(a: Box, b: Box) {
  const d = b.c.clone().sub(a.c),
    axes = [...a.u, ...b.u];
  for (const p of a.u) for (const q of b.u) axes.push(p.clone().cross(q));
  let least = Infinity;
  for (const ax of axes) {
    if (ax.lengthSq() < TOL.degenerate) continue;
    ax.normalize();
    const r = (x: Box) => x.u.reduce((s, u, i) => s + x.e[i] * Math.abs(u.dot(ax)), 0);
    least = Math.min(least, r(a) + r(b) - Math.abs(d.dot(ax)));
    if (least <= 0) return 0;
  }
  return least;
}
type Hit = { a: string; b: string; depth: number };
/** Keycaps that hit each other: either pressed to the bottom (plus the
 * keycap clearance, not the per-key overrides, which are the case's bigger room
 * round the 1.5u) against the other at rest. */
export function capHits(c: Config, caps: Cap[]) {
  const sw = c.switch,
    rest = caps.map((k) => capBoxes(k, 0)),
    pressed = caps.map((k) => capBoxes(k, sw.keycap_clearance_mm, sw.travel_mm)),
    out: Hit[] = [];
  for (let i = 0; i < caps.length; i++)
    for (let j = i + 1; j < caps.length; j++) {
      const depth = Math.max(overlap(pressed[i], rest[j]), overlap(rest[i], pressed[j]));
      if (depth > 0) out.push({ a: caps[i].name, b: caps[j].name, depth });
    }
  return out;
}
/** A key's tile (the board under its switch, and the parts hanging under
 * the board: hotswap socket, LED, diode) as boxes, `m` the key's frame. */
function tileBoxes(c: Config, m: T.Matrix4): Box[] {
  const t = c.tile,
    under = tileUnderside(c),
    u = [0, 1, 2].map((i) => new T.Vector3().setFromMatrixColumn(m, i).normalize()),
    box = (at: number[], size: number[]) => ({
      c: new T.Vector3(...at).applyMatrix4(m),
      u,
      e: size.map((v) => v / 2),
    });
  return [
    box([0, 0, under + t.size_mm[2] / 2], t.size_mm),
    ...t.components.map((p) => box(tilePartCentre(c, p), p.size_mm)),
  ];
}
/** mm two tiles may overlap: edge to edge, as the layout rounds the keys' places (0.01 mm). */
const TILE_TOUCH = 0.05;
/** The keys' tiles that hit each other (the keys as laid out in `c`). */
function tileHits(c: Config, keys: string[]) {
  const f = componentFrames(c),
    tiles = keys.map((k) => tileBoxes(c, f[k])),
    out: Hit[] = [];
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const depth = overlap(tiles[i], tiles[j]);
      if (depth > TILE_TOUCH) out.push({ a: keys[i], b: keys[j], depth });
    }
  return out;
}
// ---------------------------------------------------------------- the hand against the keyboard
/** A part of the hand: capsules (segments of a radius) or a convex hull (the
 * palm), and the keys it may touch. */
type Part = {
  who: string;
  segs: [a: T.Vector3, b: T.Vector3, r: number][];
  hull?: T.Vector3[];
  may: string[];
};
/** Finger f, `down` mm along -n (pressing), moved by `by`. */
export const fingerPart = (
  f: Finger,
  p: Pose,
  may: string[],
  down = 0,
  by = new T.Vector3(),
): Part => {
  const c = p.chain,
    s = SCALE[f],
    v = (x: T.Vector3) => x.clone().addScaledVector(p.n, -down).add(by);
  return {
    who: f,
    segs: [
      [v(c.mcp), v(c.pip), 9.5 * s],
      [v(c.pip), v(c.dip), 8 * s],
      [v(c.dip), v(c.ball), TIP_R(f)],
    ],
    may,
  };
};
export type Thumb = ReturnType<typeof thumb>;
export const thumbPart = (th: Thumb, may: string[], by = new T.Vector3()): Part => {
  const v = (x: T.Vector3) => x.clone().add(by);
  return {
    who: 'thumb',
    segs: [
      [v(C), v(th.M), 11],
      [v(th.M), v(th.I), 10.5],
      // The last section's two round edges (with the flat between them).
      ...[-1, 1].map(
        (k) =>
          [
            v(th.I).addScaledVector(th.side, k * THUMB_EDGE),
            v(th.end).addScaledVector(th.side, k * THUMB_EDGE),
            THUMB_R,
          ] as [T.Vector3, T.Vector3, number],
      ),
    ],
    may,
  };
};
/** The palm (a sketch): a hull over the thumb's CMC and metacarpal head, the
 * knuckles and the wrist. */
export function palmPoints(mcp: Record<Finger, T.Vector3>, th: Thumb) {
  const wrist = mcp.middle.clone().add(new T.Vector3(-8, -85, -12)),
    out: T.Vector3[] = [C.clone(), th.M.clone()];
  for (const f of FINGERS) {
    const k = mcp[f];
    out.push(k.clone().setZ(k.z + 8 * SCALE[f]), k.clone().setZ(k.z - 14 * SCALE[f]));
  }
  for (const dx of [-28, 28])
    for (const dz of [-14, 14]) out.push(wrist.clone().add(new T.Vector3(dx, 0, dz)));
  return out;
}
/** The keyboard in the hand frame: the keycaps at rest, and the printed
 * frame's faces (each with its bounds). */
type Tri = { t: T.Triangle; box: T.Box3 };
type Board = { caps: Cap[]; tris: Tri[] };
/** A mesh's faces, carried into the hand frame by `m`. */
export function trisOf(mesh: MeshData, m: T.Matrix4): Tri[] {
  const p = mesh.positions,
    v = (i: number) => new T.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).applyMatrix4(m),
    out: Tri[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const t = new T.Triangle(v(mesh.indices[i]), v(mesh.indices[i + 1]), v(mesh.indices[i + 2]));
    out.push({ t, box: new T.Box3().setFromPoints([t.a, t.b, t.c]) });
  }
  return out;
}
/** How far a point is outside a tapered keycap (0 inside; near enough,
 * measured square to its axis at the nearest height). */
function outsideOf(k: Cap) {
  const inv = k.top.clone().invert();
  return (p: T.Vector3) => {
    const l = p.clone().applyMatrix4(inv),
      down = Math.min(Math.max(-l.z, 0), k.size[2]),
      half = halfAt(k, down);
    return Math.hypot(
      Math.max(0, Math.abs(l.x) - half[0]),
      Math.max(0, Math.abs(l.y) - half[1]),
      -l.z - down,
    );
  };
}
const corners = (b: Box) =>
  [-1, 1].flatMap((i) =>
    [-1, 1].flatMap((j) =>
      [-1, 1].map((k) =>
        b.c
          .clone()
          .addScaledVector(b.u[0], i * b.e[0])
          .addScaledVector(b.u[1], j * b.e[1])
          .addScaledVector(b.u[2], k * b.e[2]),
      ),
    ),
  );
/** The palm's face normals and edge directions (every pair of points: more
 * axes than it needs, which only costs time). */
function hullAxes(ps: T.Vector3[]) {
  const faces: T.Vector3[] = [],
    edges: T.Vector3[] = [];
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      edges.push(ps[j].clone().sub(ps[i]).normalize());
      for (let k = j + 1; k < ps.length; k++) {
        const n = ps[j].clone().sub(ps[i]).cross(ps[k].clone().sub(ps[i]));
        if (n.lengthSq() < TOL.degenerate) continue;
        n.normalize();
        const d = ps.map((p) => n.dot(p.clone().sub(ps[i])));
        if (Math.max(...d) < TOL.coplanar || Math.min(...d) > -TOL.coplanar) faces.push(n);
      }
    }
  return { faces, edges };
}
/** How far two convex point sets overlap (mm, along the best of `axes`; 0 when apart). */
function convexOverlap(a: T.Vector3[], b: T.Vector3[], axes: T.Vector3[]) {
  let least = Infinity;
  for (const ax of axes) {
    let a0 = Infinity,
      a1 = -Infinity,
      b0 = Infinity,
      b1 = -Infinity;
    for (const p of a) {
      const d = ax.dot(p);
      a0 = Math.min(a0, d);
      a1 = Math.max(a1, d);
    }
    for (const p of b) {
      const d = ax.dot(p);
      b0 = Math.min(b0, d);
      b1 = Math.max(b1, d);
    }
    least = Math.min(least, a1 - b0, b1 - a0);
    if (least <= 0) return 0;
  }
  return least;
}
/** The palm against a convex piece with face normals `n` and edge directions `e`. */
function palmOverlap(
  palm: T.Vector3[],
  ax: ReturnType<typeof hullAxes>,
  piece: T.Vector3[],
  n: T.Vector3[],
  e: T.Vector3[],
) {
  const axes = [...ax.faces, ...n];
  for (const p of ax.edges)
    for (const q of e) {
      const x = p.clone().cross(q);
      if (x.lengthSq() > TOL.degenerate) axes.push(x.normalize());
    }
  return convexOverlap(palm, piece, axes);
}
/** What a part passes into, deepest first per thing: keycaps it may not
 * touch, and the frame (named by the keycap nearest the spot). */
export function partHits(board: Board, part: Part): Hit[] {
  const deepest: Record<string, number> = {},
    hit = (b: string, d: number) => {
      if (d > TOL.mm && !(deepest[b] >= d)) deepest[b] = d;
    },
    centre = (k: Cap) => new T.Vector3().setFromMatrixPosition(k.top),
    frameAt = (p: T.Vector3) =>
      `the frame by ${label(
        board.caps.reduce((a, b) =>
          p.distanceToSquared(centre(b)) < p.distanceToSquared(centre(a)) ? b : a,
        ).name,
      )}`;
  // Each capsule, sampled at least every mm along its length.
  for (const [a, b, r] of part.segs) {
    const n = Math.max(2, Math.ceil(a.distanceTo(b))),
      pts = Array.from({ length: n + 1 }, (_, i) => a.clone().lerp(b, i / n)),
      reach = new T.Box3().setFromPoints([a, b]).expandByScalar(r);
    for (const k of board.caps) {
      if (part.may.includes(k.name)) continue;
      const c = new T.Vector3().setFromMatrixPosition(k.top),
        far = Math.hypot(...k.size) / 2 + r;
      if (new T.Line3(a, b).closestPointToPoint(c, true, new T.Vector3()).distanceTo(c) > far)
        continue;
      const out = outsideOf(k);
      for (const p of pts) hit(label(k.name), r - out(p));
    }
    const q = new T.Vector3();
    for (const { t, box } of board.tris) {
      if (!box.intersectsBox(reach)) continue;
      for (const p of pts) {
        const d = r - t.closestPointToPoint(p, q).distanceTo(p);
        if (d > TOL.mm) hit(frameAt(q), d);
      }
    }
  }
  if (part.hull) {
    const palm = part.hull,
      ax = hullAxes(palm),
      bounds = new T.Box3().setFromPoints(palm);
    for (const k of board.caps) {
      if (part.may.includes(k.name)) continue;
      for (const b of capBoxes(k, 0)) {
        const cs = corners(b);
        if (!bounds.intersectsBox(new T.Box3().setFromPoints(cs))) continue;
        hit(label(k.name), palmOverlap(palm, ax, cs, b.u, b.u));
      }
    }
    for (const { t, box } of board.tris) {
      if (!box.intersectsBox(bounds)) continue;
      const n = t.getNormal(new T.Vector3());
      if (n.lengthSq() < 0.5) continue;
      const e = [t.b.clone().sub(t.a), t.c.clone().sub(t.b), t.a.clone().sub(t.c)].map((x) =>
          x.normalize(),
        ),
        d = palmOverlap(palm, ax, [t.a, t.b, t.c], [n], e);
      if (d > TOL.mm) hit(frameAt(t.getMidpoint(new T.Vector3())), d);
    }
  }
  return Object.entries(deepest).map(([b, depth]) => ({ a: part.who, b, depth }));
}
/** How tall the board stands, hand frame turned onto the desk by `R`: from the
 * highest keycap corner down to the lowest switch body's bottom, plus the base. */
function heightOf(c: Config, caps: Cap[], R: T.Matrix4) {
  const sw = c.switch,
    base = c.chassis.skin_mm;
  let high = -Infinity,
    low = Infinity;
  for (const k of caps) {
    const m = R.clone().multiply(k.top),
      seat = -k.size[2] - sw.keycap_bottom_above_plate_mm - sw.body_below_plate_mm;
    for (const [w, h] of [
      [k.size, -k.size[2]],
      [k.face, 0],
    ] as const)
      for (const x of [-w[0] / 2, w[0] / 2])
        for (const y of [-w[1] / 2, w[1] / 2])
          high = Math.max(high, new T.Vector3(x, y, h).applyMatrix4(m).z);
    for (const x of [-sw.body_mm[0] / 2, sw.body_mm[0] / 2])
      for (const y of [-sw.body_mm[1] / 2, sw.body_mm[1] / 2])
        low = Math.min(low, new T.Vector3(x, y, seat).applyMatrix4(m).z);
  }
  return high - low + base;
}
/** The hand frame onto the desk (rotation only): the tent, then the hand's turn. */
const deskOf = (s: Settings) => frame([0, 0, 0], [0, s.tent, 0]).multiply(turnOf(s));
/** A hit, and what the hand was doing. */
type Reach = Hit & { during: string };
/** How far the reaching digit moves between looks, mm. */
const STEP = 2;
/** The hand reaching each key in turn: no part of it may pass into the
 * keyboard (the keycaps at rest, the printed frame) except the key it reaches
 * for (and the key it leaves, on the way). The other digits rest on their
 * home keys; reaching the inner column the arm carries the index sideways,
 * so they're checked only at home. Pressing, the thumb's last two bones move
 * with the key. */
function reachHits(c: Config, s: Settings, h: Solved, board: Board) {
  const travel = c.switch.travel_mm,
    way = wayOf(s),
    homes = Object.fromEntries(FINGERS.map((f) => [f, h.poses[f][1]])) as Record<Finger, Pose>,
    mcps = Object.fromEntries(FINGERS.map((f) => [f, homes[f].chain.mcp])) as Record<
      Finger,
      T.Vector3
    >,
    thHome = thumb(h.row[1].q),
    found: Record<string, Reach> = {},
    add = (part: Part, during: string) => {
      for (const x of partHits(board, part))
        if (!(found[x.a + x.b]?.depth >= x.depth)) found[x.a + x.b] = { ...x, during };
    },
    palm = (th: Thumb, by = new T.Vector3()): Part => ({
      who: 'palm',
      segs: [],
      hull: palmPoints(mcps, th).map((p) => p.add(by)),
      may: [],
    }),
    /** Every digit resting, and the palm. */
    rest = (during: string) => {
      for (const f of FINGERS) add(fingerPart(f, homes[f], [`matrix_${f}_home`]), during);
      add(thumbPart(thHome, ['thumb_home']), during);
      add(palm(thHome), during);
    },
    /** The reaching digit on the way (`at(t)`, 0 < t < 1, `len` mm in all), then on the key and pressing it. */
    reach = (key: string, len: number, at: (t: number) => Part, onKey: (down: number) => Part) => {
      const n = Math.ceil(len / STEP),
        name = label(key);
      for (let i = 1; i < n; i++) add(at(i / n), `reaching for ${name}`);
      add(onKey(0), `on ${name}`);
      add(onKey(travel), `pressing ${name}`);
    };
  rest('at home');
  // The finger keys, each finger with the rest of the hand at home.
  for (const f of FINGERS)
    ROWS.forEach((r, ri) => {
      const key = `matrix_${f}_${r}`,
        dist = rowDistance(s, r);
      reach(
        key,
        Math.abs(dist),
        (t) => fingerPart(f, rowPose(f, s.curl[f], 0, dist * t, way), [`matrix_${f}_home`, key]),
        (down) => fingerPart(f, h.poses[f][ri], [key], down),
      );
    });
  // The inner column: the arm carries the index toward it; the other digits stay home.
  ROWS.forEach((r, ri) => {
    const key = `matrix_inner_${r}`,
      dist = rowDistance(s, r),
      index = (t: number) => h.inner.placeAt(rowPose('index', s.curl.index, 0, dist * t, way), t),
      may = ['matrix_index_home', key],
      len = homes.index.chain.pad.distanceTo(h.poses.inner[ri].chain.pad);
    reach(
      key,
      len,
      (t) => fingerPart('index', index(t), may),
      (down) => fingerPart('index', h.poses.inner[ri], [key], down),
    );
  });
  // The thumb keys: the thumb's joints move evenly from home to the key; to
  // an extra key, off the row and down again on the way (backing off the
  // press, EXTRA_LIFT mm halfway), as it moves over the row.
  thumbKeysOf(h).forEach(({ name, k }) => {
    const key = `thumb_${name}`,
      lift = name.startsWith('x') ? EXTRA_LIFT : 0,
      qs = (t: number) =>
        pressed(
          h.row[1].q.map((v, j) => v + (k.q[j] - v) * t),
          -lift * Math.sin(Math.PI * t),
          h.row[1].press.map((v, j) => v + (k.press[j] - v) * t),
        );
    reach(
      key,
      k.at.distanceTo(h.row[1].at),
      (t) => {
        const th = thumb(qs(t));
        add(palm(th), `while the thumb reaches for ${label(key)}`);
        return thumbPart(th, ['thumb_home', key]);
      },
      (down) => {
        const th = thumb(pressed(k.q, down, k.press));
        if (!down) add(palm(th), `while the thumb is on ${label(key)}`);
        return thumbPart(th, [key]);
      },
    );
  });
  return Object.values(found);
}
/** What's wrong with a layout: keycaps hitting, the hand through the
 * keyboard (the printed frame too, given its mesh and its way into the hand
 * frame), rows out of reach, the thumb past its joints, and the board's height. */
export function check(
  c: Config,
  s: Settings,
  h = solveHand(s),
  built?: { mesh: MeshData; toHand: T.Matrix4 },
) {
  const two = !!twoOf(s),
    caps = capsOf(c, h, two),
    thumbs = thumbKeysOf(h).map(({ name, k }) => ({ key: `thumb ${name}`, k }));
  return {
    h,
    caps,
    capHits: capHits(c, caps),
    tileHits: tileHits(
      c,
      caps.map((k) => k.name),
    ),
    handHits: reachHits(c, s, h, {
      caps,
      tris: built ? trisOf(built.mesh, built.toHand) : [],
    }),
    frameChecked: !!built,
    short: [
      ...FINGERS.flatMap((f) => ROWS.map((r, ri) => [`${f} ${r}`, h.poses[f][ri].short] as const)),
      ...thumbs.map(({ key, k }) => [key, k.miss] as const),
    ].filter(([, m]) => m > 0.5),
    /** Thumb keys where the MCP or IP goes past its range (degrees), on the
     * key or pressing it to the bottom (unless the press moves off it). */
    pastJoints: thumbs
      .map(({ key, k }) => ({
        key,
        past: Math.max(
          pastJoints(k.q),
          k.away ? 0 : pastJoints(pressed(k.q, c.switch.travel_mm, k.press)),
        ),
      }))
      .filter((x) => x.past > 0.5),
    /** Thumb keys met with the back of the thumb: on its side past
     * BACK_OF_THUMB (in the photos it lay at about 100–107° on the paper).
     * Not the extra keys: the model presses with the thumb's tip, and those
     * are pressed with its side or base, which it doesn't model. */
    backOfThumb: thumbs.flatMap(({ key, k }) =>
      !key.startsWith('thumb x') && Math.abs(k.roll) > BACK_OF_THUMB
        ? [{ key, roll: Math.abs(k.roll) }]
        : [],
    ),
    /** Thumb keys the press moves the thumb off. */
    pressAway: thumbs.flatMap(({ key, k }) => (k.away ? [key] : [])),
    /** The arm can't carry the hand far enough sideways for the inner column. */
    innerShort: h.inner.limited,
    /** mm the wrist height is past what any reach gives at this curl. */
    wristOff: s.from === 'reach' ? mixFor(s.curl.middle, s.wristHeight).off : 0,
    height: heightOf(c, caps, deskOf(s)),
  };
}

export const TRAY = 66;
/** Why a checked layout isn't valid, as the readout says it (none: valid). */
export const problems = (r: ReturnType<typeof check>) => [
  ...r.capHits.map((x) => `${label(x.a)} hits ${label(x.b)} (${x.depth.toFixed(1)} mm)`),
  ...r.tileHits.map((x) => `${label(x.a)}'s tile hits ${label(x.b)}'s (${x.depth.toFixed(1)} mm)`),
  ...r.handHits.map((x) => `${x.a} ${x.during}: into ${x.b} (${x.depth.toFixed(1)} mm)`),
  ...r.short.map(([k, m]) => `${k} out of reach (${m.toFixed(0)} mm)`),
  ...r.pressAway.map((k) => `pressing ${k}, the thumb moves off it`),
  ...r.backOfThumb.map(
    (x) => `${x.key} meets the back of the thumb (on its side by ${x.roll.toFixed(0)}°)`,
  ),
  ...r.pastJoints.map(
    (x) => `${x.key}: the thumb's MCP or IP ${x.past.toFixed(0)}° past its range`,
  ),
  ...(r.innerShort ? ['inner column out of reach'] : []),
  ...(Math.abs(r.wristOff) > 0.5
    ? [
        `wrist ${Math.abs(r.wristOff).toFixed(0)} mm too ${r.wristOff > 0 ? 'high' : 'low'} for this curl`,
      ]
    : []),
  ...(r.height > TRAY ? [`${r.height.toFixed(1)} mm tall (tray ${TRAY} mm)`] : []),
];
