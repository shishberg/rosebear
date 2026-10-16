// The wire port and the tile edges wires leave by.
import type { Matrix4 } from 'three';
import { componentFrames, point, type Config, type V3 } from '../geometry';
import { plateHalfWidths } from '../plates';
import { WIRING, distance, mid, type Edge, type Pad, type Port, type PortGrid } from './common';

/** The plate edge of a key's frame that faces a plan direction. */
const facing = (m: Matrix4, dir: number[]): Edge => {
  const e = m.elements;
  const options: Edge[] = [
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
  ];
  const score = ([axis, sign]: Edge) => sign * (e[axis * 4] * dir[0] + e[axis * 4 + 1] * dir[1]);
  return options.reduce((a, b) => (score(b) > score(a) ? b : a));
};

/** The edge of a key's tile that faces a world point, in plan. */
export const edgeToward = (frames: Record<string, Matrix4>, key: string, to: V3): Edge => {
  const c = point(frames[key], [0, 0, 0]);
  return facing(frames[key], [to[0] - c[0], to[1] - c[1]]);
};

/** A pad's own edge: the one it sits beside. */
export const ownEdge = (p: Pick<Pad, 'xy'>): Edge => [1, Math.sign(p.xy[1]) || 1];

/**
 * The wire port from under the thumb row to under the finger columns: a
 * straight round way out in front of the gap between the inner and index
 * columns' bottom keys, below them.
 */
export function wirePort(cfg: Config, frames = componentFrames(cfg)): Port {
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
  const halfWidth = Math.max(WIRING.portMinHalfWidth, Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) / 2);
  const foot = WIRING.portFoot;
  const z = foot + (Math.min(pa[2], pb[2]) - WIRING.portBelow - foot) / 2 + halfWidth;
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

/**
 * The places wires can take across a port: a hexagonal grid of the given
 * pitch inside a circle of radius `room`, nearest the axis first.
 */
export function portGrid(port: Port, room: number, pitch = WIRING.portPitch): PortGrid {
  const axis = [port.inside[0] - port.outside[0], port.inside[1] - port.outside[1]];
  const axisLength = Math.hypot(axis[0], axis[1]);
  const side = [-axis[1] / axisLength, axis[0] / axisLength];
  // Enough rows and columns to reach the circle's edge (rows are closer than columns), and never fewer than 4.
  const span = Math.max(4, Math.ceil(room / (pitch * Math.sqrt(0.75))) + 1);
  const places: V3[] = [];
  for (let row = -span; row <= span; row++)
    for (let col = -span; col <= span; col++) {
      const u = (col + (row % 2 ? 0.5 : 0)) * pitch;
      const v = row * pitch * Math.sqrt(0.75);
      if (Math.hypot(u, v) <= room + 1e-9) places.push([side[0] * u, side[1] * u, v]);
    }
  places.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  return { axis, axisLength, side, places };
}
