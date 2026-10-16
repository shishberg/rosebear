// Types and constants shared by the wiring modules.
import type { Matrix4 } from 'three';
import type { Config, V3 } from '../geometry';

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
  /** The pad's world point, its point in its key's frame (x, y), and its key's downward normal. */
  at: V3;
  xy: [number, number];
  down: V3;
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

/** A tile edge: the key axis (0 for x, 1 for y) and its sign. */
export type Edge = [0 | 1, number];

/** How a wire runs. */
export interface Lane {
  /** Depths below the first and second tiles. */
  da: number;
  db: number;
  /** Shift along the tile edge a wire crosses, or in plan for a feed's run to the adapter. */
  aside: number;
  /** Between tiles: the shift along the second tile's edge. */
  asideB?: number;
  /**
   * The edge a leg leaves its tile by, if not the usual one: for a feed, its
   * finger pad's leg; through the port, its thumb pad's leg.
   */
  edge?: Edge;
  /** For a feed: its level in the loom, in steps of loomStep from loom_height_mm. */
  level?: number;
}

/** The wire port: a straight round way from under the thumb tiles to inside the finger columns. */
export interface Port {
  /** Where it crosses the line between the two keys' plate corners. */
  centre: V3;
  /** Its end under the thumb tiles. */
  outside: V3;
  /** Its end inside the finger columns. */
  inside: V3;
  diameter: number;
}

/** The port's cross-section: the places a wire can take, and the directions across it. */
export interface PortGrid {
  /** The port's direction in plan, and its length. */
  axis: number[];
  axisLength: number;
  /** The horizontal direction across the port, in plan. */
  side: number[];
  /** Offsets from the port's axis (along `side` in plan, then up), nearest the axis first. */
  places: V3[];
}

/** What the routing modules share about the build. */
export interface Env {
  cfg: Config;
  frames: Record<string, Matrix4>;
  /** Height of a tile's underside in its key's frame. */
  padZ: number;
  /** Height of the loom's bottom level in world z. */
  loomZ: number;
  /** The tile pocket's half-widths. */
  half: [number, number];
  /** How far below a tile's underside its tallest part reaches, with clearance. */
  componentDepth: number;
  hole: Record<number, V3>;
  port: Port;
  grid: PortGrid;
}

/** Extra sizes for the wiring, in mm unless noted, that are not in the config. */
export const WIRING = {
  /** The wire port's inside end is this far inside the plate corners. */
  slotInside: 3,
  /** The wire port runs halfway down from this far under the lower of its two plate corners to the base. */
  portBelow: 9,
  /** The wire port is at least this wide in half-width, whatever the gap between its keys. */
  portMinHalfWidth: 1.5,
  /** The wire port's floor is this high above the bottom section. */
  portFoot: 1,
  /** A thumb's wires through the port gather this far out from its edge facing the port. */
  gatherOut: 2,
  /** A thumb's wires through the port gather this far below the tile, each offset as its place in the port. */
  gatherDepth: 4,
  /** On the finger side, wires turn this much further on from the port per row of places. */
  beyondStep: 1,
  /** A hop over the pad's own edge runs this far below the tile's underside, at the shallowest. */
  hopDepth: 0.6,
  /** A run along the pads' strip (under the other pads' drops) starts this far below the tile. */
  stripDepth: 2.7,
  /** A run along the pads' strip goes this much deeper for each pad it passes under. */
  stripStep: 0.9,
  /** How many depths each leg tries. */
  depthChoices: 4,
  /** Spacing of a leg's depth choices. */
  depthStep: 0.7,
  /** A wire clears the tile's parts, and its own radius, by this much more. */
  depthMargin: 0.1,
  /** Between keys at different heights, how far in under the higher tile a wire may step back to find its way down. */
  climbBack: 12,
  /** Spacing of the steps back in under the higher tile. */
  climbBackStep: 1,
  /** Spacing, as a fraction of the leg's run, of the points a climb down is tried from. */
  climbRunStep: 0.05,
  /** Failing that, how far below the lower of the two legs' ends a wire may run across under both. */
  climbUnder: 6,
  /** Spacing of the depths a run across under both legs' ends is tried at. */
  climbUnderStep: 1,
  /** Feeds run to the adapter at their own levels in the loom, this far apart. */
  loomStep: 1,
  /** The levels, in loomStep from the loom's height, nearest first. */
  loomLevels: [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, 6, 7, 8],
  /** Feeds through the port try only this many of the first loomLevels. */
  portLoomLevels: 7,
  /** Sideways shifts of a feed's run to the adapter, in plan, to get past other wires. */
  asides: [0, 1, -1, 2, -2],
  /** Shifts along the tile edge a wire crosses to the next tile. */
  edgeAsides: [0, 0.9, -0.9, 1.6, -1.6, 0.45, -0.45],
  /** Shifts of a leg through the port: the first of edgeAsides. */
  portAsides: 3,
  /** The most rounds of negotiating the routes. */
  rounds: 150,
  /** Negotiating stops when the number of wires meeting has not fallen for this many rounds. */
  stall: 60,
  /** The cost of meeting another wire, against 1 per step of rank away from the nearest option. */
  penalty: 4,
  /** The factor the cost of meeting another wire grows by each round. */
  penaltyGrowth: 1.3,
  /** The cost added to an option for each round it met another wire. */
  historyCost: 1,
  /** How many of its cheapest options a meeting wire clears the way for. */
  blockerOptions: 24,
  /** The cost added to each wire in the way of a meeting wire's cheapest options. */
  blockerCost: 0.5,
  /** A wire keeps at most this many options. */
  optionLimit: 3000,
  /** When a wire has no option clear of the tiles, the rank added to each of its options. */
  blockedRank: 100,
  /** The most passes of repairing meeting wires in small groups. */
  repairPasses: 6,
  /** How many of the wires most in a meeting pair's way join it in a repair group. */
  repairBlockers: 4,
  /** The search steps each repaired group may take. */
  repairWork: 5000000,
  /** If any still meet when routing with every choice, negotiating starts again this many times. */
  restarts: 3,
  /** The cost of ending a wire on the tile's other pad of the same name. */
  otherPad: 2,
  /** Wires may touch: they count as passing into each other only past this much. */
  touch: 0.02,
  /** Centre spacing of two wires on one pad, along it. */
  padShare: 0.9,
  /** Centre spacing of two wires on one adapter hole, across the row. */
  holeShare: 1,
  /** Centre spacing of the wires through the wire port. */
  portPitch: 1.02,
  /** How many places nearest its own a wire through the port tries. */
  placeChoices: 13,
  /** Feeds and wires through the port try only this many of the depths. */
  longDepths: 2,
  /** Wires are checked against the tiles and their parts every this many mm along. */
  sample: 0.3,
  /** The obstacles are indexed in square cells in plan of this size. */
  gridCell: 6,
  /** Ribbon segments per half turn of the slack loop. */
  loopSteps: 8,
  /** The ribbon's slack loop starts this far past the connector's mouth. */
  loopGap: 2,
  /** The landing stops this far short of the slack loop. */
  landingGap: 3,
  /** The ribbon leaves the landing's end this far on. */
  landingLead: 0.5,
  /** The ribbon lies this far above the landing. */
  ribbonLift: 0.05,
  /** Before a build places the port panel, it is this far past the landing. */
  panelGap: 2,
  /** A pad's drawn box is this thick. */
  padThickness: 0.1,
  /** A pad's drawn box sits this far under the tile's underside. */
  padLift: 0.05,
} as const;

export const length = (ps: V3[]) =>
  ps.reduce((t, p, i) => (i ? t + Math.hypot(...p.map((x, j) => x - ps[i - 1][j])) : t), 0);
export const distance = (a: number[], b: number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const mid = (a: number[], b: number[]): V3 => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  (a[2] + b[2]) / 2,
];

export const nets = (cfg: Config) => cfg.wiring.nets as NetSpec[];
