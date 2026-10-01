// Hand wiring, adapter and ribbons: plain geometry from the key frames, with no
// geometry engine, so the editor can redraw it while a handle is dragged.
//
// Terms:
//  pad      a solder pad on a tile's underside (tile.pads);
//  hole     one of the adapter's 24 through holes; hole n carries ribbon pin n;
//  drop     the point drop_mm straight below a pad, in the key's frame, where a
//           wire turns; it is below the tile's components;
//  chain    keys joined one to the next by a net's wires (wiring.nets[].chains);
//  feed     the wire from a chain's end to its adapter hole;
//  loom     the height above the bottom plate at which feeds run to the adapter;
//  wire port  a round hole thumb wires pass through into the finger columns:
//           through the thumb row's back wall and the slot between the inner
//           and index columns' front swept ends;
//  slack loop  the arch the ribbon makes between the connector and the landing,
//           so a pull held by the ties never reaches the connector.
import { Matrix4, Vector3 } from 'three';
import { componentFrames, point, type Config, type V3 } from './geometry';
import { seatSettings } from './seats';
import type { Part } from './solid';

export interface NetSpec {
  name: string;
  pin: number;
  group: string;
  /** The pad a wire arrives at on each key, and the pad the next wire leaves from. */
  pads: string[];
  /** Keys in wiring order; each chain has its own feed. Default: [led_order]. */
  chains?: string[][];
  /** The feed goes to the first key of each chain (LED data flows DI to DO). */
  directed?: boolean;
}
export interface Pad {
  key: string;
  name: string;
  /** World points: on the pad, and drop_mm below it. */
  at: V3;
  drop: V3;
}
export interface Wire {
  net: string;
  group: string;
  from: string;
  to: string;
  points: V3[];
  diameter: number;
  /** Cut length: along the path, plus end allowances and, on a feed, the service loop. */
  length: number;
  feed: boolean;
}
export interface NetSummary {
  name: string;
  pin: number;
  group: string;
  wires: number;
  joints: number;
  length: number;
}
export interface Wiring {
  pads: Pad[];
  wires: Wire[];
  nets: NetSummary[];
  /** Each key's row and column net, and their pins. */
  matrix: { key: string; row: string; column: string }[];
}

/** Extra sizes for the wiring, in mm, that are not in the config. */
export const WIRING = {
  /** Below its drop point, a wire turns this much lower again before running across to another key. */
  laneDrop: 1,
  /** The wire port's inside end is this far inside the plate corners. */
  slotInside: 3,
  /** Ribbon segments per half turn of the slack loop. */
  loopSteps: 8,
} as const;

const length = (ps: V3[]) =>
  ps.reduce((t, p, i) => (i ? t + Math.hypot(...p.map((x, j) => x - ps[i - 1][j])) : t), 0);
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mid = (a: number[], b: number[]): V3 => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  (a[2] + b[2]) / 2,
];

export const nets = (cfg: Config) => cfg.wiring.nets as NetSpec[];
export const isThumb = (key: string) => key.startsWith('thumb_');

/** The adapter's holes, in world coordinates on the board's top: hole n carries ribbon pin n. */
export function holes(cfg: Config, frames = componentFrames(cfg)) {
  const a = cfg.adapter;
  const [bx, , bz] = a.board_mm;
  const out: Record<number, V3> = {};
  for (let pin = 1; pin <= 24; pin++) {
    // Pins pair across the two rows, even pins on the row nearest the edge.
    const j = Math.floor((pin - 1) / 2);
    const x = bx / 2 - a.hole_rows_from_edge_mm[pin % 2 ? 1 : 0];
    out[pin] = point(frames.adapter, [x, (j - 5.5) * a.hole_pitch_mm, bz]);
  }
  return out;
}

/**
 * The plate edge of a key's frame that faces a plan direction: the key axis
 * (0 for x, 1 for y) and its sign.
 */
const facing = (m: Matrix4, dir: number[]) => {
  const e = m.elements;
  const options: [0 | 1, number][] = [
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
  ];
  const score = ([axis, sign]: [0 | 1, number]) =>
    sign * (e[axis * 4] * dir[0] + e[axis * 4 + 1] * dir[1]);
  return options.reduce((a, b) => (score(b) > score(a) ? b : a));
};

/**
 * The wire port from the thumb rows into the finger columns: a straight round
 * hole along the axis of the slot between the inner and index columns' front
 * swept ends, at the height of the slot's round bottom, and on through the
 * thumb row's back wall. `outside` is its end under the thumb tiles, `inside`
 * its end inside the finger columns, `centre` where it crosses the line
 * between the two keys' plate corners.
 */
export function wirePort(cfg: Config, frames = componentFrames(cfg)) {
  const plateHalf = plateHalfWidths(cfg);
  const [a, b] = ['inner', 'index'].map((c) => `matrix_${c}_bottom`);
  const corner = (n: string, other: string) => {
    const m = frames[n];
    const [axis, sign] = facing(m, [0, -1]);
    const toward = point(frames[other], [0, 0, 0]);
    const options = [-1, 1].map((s) => {
      const v = [0, 0, 0];
      v[axis] = sign * plateHalf[axis];
      v[1 - axis] = s * plateHalf[1 - axis];
      return point(m, v);
    });
    return options.sort((p, q) => distance(p, toward) - distance(q, toward))[0];
  };
  const [pa, pb] = [corner(a, b), corner(b, a)];
  const centre = mid(pa, pb);
  const halfWidth = Math.max(1.5, Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) / 2);
  const foot = 1;
  const z = foot + (Math.min(pa[2], pb[2]) - cfg.chassis.end_radius_mm - foot) / 2 + halfWidth;
  // Outward: the mean of the two keys' front edge directions, in plan.
  const out = [a, b]
    .map((n) => {
      const [axis, sign] = facing(frames[n], [0, -1]);
      const e = frames[n].elements;
      return [sign * e[axis * 4], sign * e[axis * 4 + 1]];
    })
    .reduce((s, d) => [s[0] + d[0], s[1] + d[1]], [0, 0]);
  const l = Math.hypot(out[0], out[1]);
  const at = (d: number): V3 => [centre[0] + (out[0] / l) * d, centre[1] + (out[1] / l) * d, z];
  return {
    centre: at(0),
    outside: at(cfg.wiring.port_length_mm),
    inside: at(-WIRING.slotInside),
    diameter: cfg.wiring.port_diameter_mm,
  };
}

/** The plates' half-widths, as the chassis builds them. */
const plateHalfWidths = (cfg: Config) => {
  const seat = seatSettings(cfg).outer;
  const tile = cfg.tile;
  return [0, 1].map((i) =>
    Math.max(seat[i] / 2 + cfg.chassis.plate_margin_mm, tile.size_mm[i] / 2 + tile.clearance_mm),
  );
};

export function wiring(cfg: Config, frames = componentFrames(cfg)): Wiring {
  const w = cfg.wiring;
  const tile = cfg.tile;
  const padZ = -(tile.plate_top_to_pcb_top_mm + tile.size_mm[2]);
  const loomZ = cfg.chassis.base_thickness_mm + w.loom_height_mm;
  const keys = Object.keys(frames).filter((n) => n.startsWith('matrix_') || isThumb(n));
  const pads: Pad[] = keys.flatMap((key) =>
    tile.pads.list.map((p) => ({
      key,
      name: p.name,
      at: point(frames[key], [p.at_mm[0], p.at_mm[1], padZ]),
      drop: point(frames[key], [p.at_mm[0], p.at_mm[1], padZ - w.drop_mm]),
    })),
  );
  const hole = holes(cfg, frames);

  const port = wirePort(cfg, frames);
  /**
   * From the last point of path `a` to the last point of path `b`: across at
   * the lower one's height, so the higher one is reached from straight below.
   */
  const join = (a: V3[], b: V3[]): V3[] => {
    const p = a.at(-1)!;
    const q = b.at(-1)!;
    const z = Math.min(p[2], q[2]);
    const points = [...a, [p[0], p[1], z] as V3, [q[0], q[1], z] as V3, ...[...b].reverse()];
    return points.filter((x, i) => !i || distance(x, points[i - 1]) > 1e-6);
  };
  /** A pad's way down: to its drop point, then lower, to a port below the pocket. */
  const stem = (p: Pad): V3[] => [
    p.at,
    p.drop,
    [p.drop[0], p.drop[1], p.drop[2] - WIRING.laneDrop],
  ];
  /** A pad's way into the finger columns: for a thumb, under the thumb tiles to the wire port, and through it. */
  const toFingers = (p: Pad): V3[] =>
    isThumb(p.key) ? [...join(stem(p), [port.outside]), port.inside] : stem(p);
  const between = (a: Pad, b: Pad): V3[] =>
    isThumb(a.key) === isThumb(b.key) ? join(stem(a), stem(b)) : join(toFingers(a), toFingers(b));
  const feed = (p: Pad, pin: number): V3[] => {
    const path = toFingers(p);
    const end = path.at(-1)!;
    const z = Math.min(loomZ, end[2]);
    return join([...path, [end[0], end[1], z]], [hole[pin], [hole[pin][0], hole[pin][1], z]]);
  };

  const wires: Wire[] = [];
  const summaries: NetSummary[] = [];
  const padsOf = (key: string, name: string) =>
    pads.filter((p) => p.key === key && p.name === name);
  const nearest = (options: Pad[], to: V3) =>
    options.reduce((a, b) => (distance(a.at, to) <= distance(b.at, to) ? a : b));
  for (const net of nets(cfg)) {
    const diameter = ['power', 'ground'].includes(net.group) ? w.power_wire_mm : w.signal_wire_mm;
    const add = (from: string, to: string, points: V3[], isFeed: boolean) =>
      wires.push({
        net: net.name,
        group: net.group,
        from,
        to,
        points,
        diameter,
        length: length(points) + 2 * w.end_allowance_mm + (isFeed ? w.service_loop_mm : 0),
        feed: isFeed,
      });
    const before = wires.length;
    for (const listed of net.chains ?? [w.led_order]) {
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
        if (previous) add(previous.key, key, between(previous, arrive), false);
        else add(`hole ${net.pin}`, key, feed(arrive, net.pin).reverse(), true);
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
    const own = wires.slice(before);
    summaries.push({
      name: net.name,
      pin: net.pin,
      group: net.group,
      wires: own.length,
      joints: 2 * own.length,
      length: own.reduce((t, x) => t + x.length, 0),
    });
  }
  const netFor = (key: string, group: string) =>
    nets(cfg).find((n) => n.group === group && (n.chains ?? []).some((c) => c.includes(key)))
      ?.name ?? '';
  return {
    pads,
    wires,
    nets: summaries,
    matrix: keys.map((key) => ({ key, row: netFor(key, 'row'), column: netFor(key, 'column') })),
  };
}

/** A box part along a segment: x along it, y along `across`, z the cross product. */
const segmentPart = (
  name: string,
  group: string,
  a: V3,
  b: V3,
  across: V3,
  width: number,
  thickness: number,
): Part => {
  const x = new Vector3(...b).sub(new Vector3(...a));
  const len = x.length();
  x.normalize();
  const z = new Vector3().crossVectors(x, new Vector3(...across)).normalize();
  const y = new Vector3().crossVectors(z, x);
  const m = new Matrix4().makeBasis(x, y, z).setPosition(...mid(a, b));
  return {
    name,
    group,
    size: [len, width, thickness],
    center: [0, 0, 0],
    matrix: m.elements.slice(),
  };
};

/**
 * The ribbon's centre line, in the adapter's frame: out of the connector's
 * mouth, over the slack loop, down onto the landing and out through the wall.
 */
export function ribbonPath(cfg: Config) {
  const a = cfg.adapter;
  const r = cfg.ribbon;
  const [bx, , bz] = a.board_mm;
  const mouthX = -bx / 2 + a.connector_inset_mm;
  const mouthZ = bz + a.connector_mm[2] / 2;
  const loopFrom = mouthX - 2;
  const loopTo = loopFrom - 2 * r.loop_radius_mm;
  const landing = landingBox(cfg);
  const onLanding = landing.top + r.thickness_mm / 2 + 0.05;
  const points: V3[] = [[mouthX, 0, mouthZ]];
  // The loop: a half turn up and over, from loopFrom to loopTo.
  for (let i = 0; i <= WIRING.loopSteps; i++) {
    const t = (i / WIRING.loopSteps) * Math.PI;
    points.push([
      (loopFrom + loopTo) / 2 + r.loop_radius_mm * Math.cos(t),
      0,
      mouthZ + r.loop_radius_mm * Math.sin(t),
    ]);
  }
  points.push(
    [landing.from + 0.5, 0, onLanding],
    [landing.to, 0, onLanding],
    [landing.to - r.outside_mm, 0, onLanding],
  );
  return points;
}

/**
 * The landing on the bottom plate, in the adapter's frame (x from `from` down
 * to `to`, z from the plate's top down to `bottom` up to `top`).
 */
export function landingBox(cfg: Config) {
  const a = cfg.adapter;
  const r = cfg.ribbon;
  const from = -a.board_mm[0] / 2 + a.connector_inset_mm - 3 - 2 * r.loop_radius_mm;
  return {
    from,
    to: from - r.landing_mm[0],
    width: r.landing_mm[1],
    bottom: -a.standoff_mm,
    top: -a.standoff_mm + r.landing_mm[2],
  };
}

/** The adapter, its connector, the ribbon and the trackpad's cable, as parts for display and the checks. */
export function adapterParts(cfg: Config, frames = componentFrames(cfg)): Part[] {
  const a = cfg.adapter;
  const r = cfg.ribbon;
  const f = frames.adapter;
  const parts: Part[] = [];
  const [bx, by, bz] = a.board_mm;
  const box = (name: string, group: string, size: V3, center: V3, m: Matrix4 = f) =>
    parts.push({ name, group, size, center, matrix: m.elements.slice() });
  parts.push({
    name: 'Adapter board',
    group: 'adapter',
    size: [bx, by, bz],
    center: [0, 0, bz / 2],
    matrix: f.elements.slice(),
    holes: a.mounting_holes_mm.map((h) => ({ at: h, diameter: a.mounting_hole_diameter_mm })),
  });
  const c = a.connector_mm;
  const cx = -bx / 2 + a.connector_inset_mm + c[0] / 2;
  box('Adapter connector', 'adapter', [c[0], c[1], c[2]], [cx, 0, bz + c[2] / 2]);
  box(
    'Adapter connector latch room',
    'adapter',
    [c[0], c[1], a.latch_room_mm],
    [cx, 0, bz + c[2] + a.latch_room_mm / 2],
  );
  const path = ribbonPath(cfg).map((p) => point(f, p));
  const across = point(f, [0, 1, 0]).map((x, i) => x - f.elements[12 + i]) as V3;
  for (let i = 0; i + 1 < path.length; i++)
    parts.push(
      segmentPart(
        `Ribbon ${i + 1}`,
        'ribbon',
        path[i],
        path[i + 1],
        across,
        r.width_mm,
        r.thickness_mm,
      ),
    );
  // The trackpad's own cable: straight down out of its connector, through the
  // housing's floor, then away from the mount.
  const t = cfg.trackpad;
  const tf = frames.trackpad;
  const cableX = -t.connector_from_centre_mm;
  const bottom = -t.pod_depth_mm - 1.5;
  const top = -t.top_below_rim_mm - t.thickness_mm - t.connector_mm[2];
  const cable = [
    [cableX, 0, top],
    [cableX, 0, bottom],
    [cableX - 3, 0, bottom - 3],
    [cableX - 18, 0, bottom - 3],
  ].map((p) => point(tf, p));
  const tAcross = point(tf, [0, 1, 0]).map((x, i) => x - tf.elements[12 + i]) as V3;
  for (let i = 0; i + 1 < cable.length; i++)
    parts.push(
      segmentPart(
        `Trackpad cable ${i + 1}`,
        'trackpad cable',
        cable[i],
        cable[i + 1],
        tAcross,
        t.cable_width_mm,
        0.12,
      ),
    );
  return parts;
}

/** The pads on every tile, as thin boxes on the tile's underside. */
export function padParts(cfg: Config, frames = componentFrames(cfg)): Part[] {
  const tile = cfg.tile;
  const z = -(tile.plate_top_to_pcb_top_mm + tile.size_mm[2]) - 0.05;
  return Object.keys(frames)
    .filter((n) => n.startsWith('matrix_') || isThumb(n))
    .flatMap((key) =>
      tile.pads.list.map((p) => ({
        name: `${key}: ${p.name} pad`,
        group: 'pads',
        size: [...tile.pads.size_mm, 0.1] as V3,
        center: [p.at_mm[0], p.at_mm[1], z] as V3,
        matrix: frames[key].elements.slice(),
      })),
    );
}
