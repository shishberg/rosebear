import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { Matrix4 } from 'three';
import { openingSpan, seatBox, seatSettings, seatSwitches, clipBox, switchHole } from './seats';
import { RegionIndex, type Region } from './regions';
import { buildChassis } from './chassis';
import { hardware } from './parts';
import {
  box,
  capsule,
  freeAfter,
  freeAfterAsync,
  keycapSolid,
  meshData,
  place,
  type Factory,
} from './manifold-util';
import { shell } from './shell';
import { crossings, wiring, type Wiring } from './wiring';
import {
  capClearance,
  capSize,
  keycapEnvelope,
  isKey,
  keyGroups,
  tileUnderside,
  componentFrames,
  validateProject,
  type V3,
  type MeshData,
  type Project,
} from './geometry';
/** Sizes and limits for the clearance checks, in mm (volumes in mm³, areas in mm²). */
const CHECKS = {
  /** Overlap volume below which a collision is ignored. */
  overlap: 0.05,
  /** Volume below which a cut or probe counts as empty. */
  empty: 0.001,
  /** Volume a keycap's room may remove from the chassis before the check fails. */
  roomCut: 0.05,
  /** Opening probes: nine, this far inside the opening's edges, each this wide and this tall. */
  probeInset: 0.25,
  probeSize: 0.3,
  probeHeight: 24,
  /** The punch that clears a probe's column of the opening is this wide. */
  punchSize: 0.4,
  /** The seat's ring check leaves out the hole, this tall. */
  ringHoleHeight: 10,
  /** Seat checks test a shape this far inside the faces they must not touch, so those faces don't count. */
  faceSkip: 0.01,
  /** The seat's outside is tested this far above and below its plane. */
  outsideReach: 1,
  /** Pieces smaller than this (mm³) are ignored when counting pieces: slivers left by boolean operations. */
  minPiece: 0.5,
  /** The footprint check's section height above the parting line, and the smallest area it counts. */
  footprintHeight: 1.5,
  minFootprint: 1,
  /** Highlighted footprints are extruded this tall. */
  footprintShow: 3,
  /** Keycap groups further apart than this are not listed. */
  capGapSearch: 40,
  /** Wire tubes: sides per segment's end sphere. */
  wireSides: 8,
  /**
   * The chassis round each key that its checks test against: past the
   * largest of its keycap with clearance, tile and seat by this much, and this
   * far above and below the plate.
   */
  regionMargin: 3,
  regionHeight: 30,
  /** The regions' shared chunks reach this far past their corners. */
  regionPad: 0.1,
} as const;
export interface Clearance {
  name: string;
  size: V3;
  margin: number;
  atRest: number;
  swept: number;
  passed: boolean;
}
export interface SeatCheck {
  name: string;
  missing: number;
  excess: number;
  clipBlocked: number;
  passed: boolean;
}
export interface Report {
  seats: SeatCheck[];
  passed: boolean;
  keycaps: Clearance[];
  capGaps: { between: string; gap: number }[];
  pieces: number[];
  footprint: number[];
  /** Keys whose keycap room had to remove chassis, and how much (mm³). */
  roomCuts: { name: string; volume: number }[];
  hardware: { name: string; group: string; volume: number }[];
  /** Wires that run into the chassis or its bottom section, and how far (mm³). */
  wires: { name: string; volume: number }[];
  /** Pads a soldering iron cannot reach straight from below. */
  solder: { name: string; volume: number }[];
  /** The whole hand's wiring: wire count, solder joints and cut length (mm). */
  wiring: { wires: number; joints: number; length: number };
  /** Pairs of wires that run into each other, named together. */
  crossings: string[];
  openings: {
    name: string;
    removed: number;
    covered: number;
    blocked: number;
    passed: boolean;
  }[];
  volume: number;
  triangles: number;
  milliseconds: number;
}
export interface Highlight {
  name: string;
  kind: 'rest' | 'travel' | 'room' | 'hardware' | 'opening' | 'seat' | 'loose' | 'wire' | 'solder';
  mesh: MeshData;
}
export interface BuildResult {
  mesh: MeshData;
  base: MeshData;
  /** The port panel's dark insert, with the ribbon's landing. */
  trim: MeshData;
  /** The port panel's end face in world x, where the ribbon leaves. */
  panel: number;
  report: Report;
  highlights: Highlight[];
  /** The routed wiring, which the editor draws with the chassis it was checked against. */
  wiring: Wiring;
}
export function buildSolid(wasm: ManifoldToplevel, project: Project): BuildResult {
  return freeAfter(wasm, () => build(wasm, project));
}
/**
 * The same build, with the wires routed elsewhere (`route`, in another worker)
 * while the case's shell is lofted here: the two are a second or so each, and
 * neither needs the other.
 */
export async function buildSolidAsync(
  wasm: ManifoldToplevel,
  project: Project,
  route: (cfg: Project['config']) => Promise<Wiring>,
): Promise<BuildResult> {
  return freeAfterAsync(wasm, async () => {
    validateProject(project);
    const start = performance.now();
    const cfg = project.config;
    const routed = route(cfg);
    // If shell() throws, nothing awaits `routed`; its rejection must not go unhandled.
    routed.catch(() => {});
    const built = shell({ wasm, cfg, frames: componentFrames(cfg) });
    for (const m of [built.body, built.inside, built.slot]) m.status();
    return build(wasm, project, { wired: await routed, built, start });
  });
}
export type Keys = [string, Matrix4][];

/** The chassis tests a check makes: a shape against the chassis, near the key it belongs to. */
interface Probe {
  M: Factory;
  regions: RegionIndex;
  /** Volume of `envelope` that `body` fills. */
  volume(body: Manifold, envelope: Manifold): number;
  /** The same, recording where it exceeds the overlap limit. */
  collision(
    body: Manifold,
    envelope: Manifold,
    name: string,
    kind: Highlight['kind'],
    out: Highlight[],
  ): number;
}

export function makeProbe(M: Factory, regions: RegionIndex): Probe {
  const volume = (body: Manifold, envelope: Manifold) => {
    const hit = regions.within(body, envelope).intersect(envelope);
    try {
      return Math.max(0, hit.volume());
    } finally {
      hit.delete();
    }
  };
  const collision = (
    body: Manifold,
    envelope: Manifold,
    name: string,
    kind: Highlight['kind'],
    out: Highlight[],
  ) => {
    const hit = regions.within(body, envelope).intersect(envelope);
    try {
      const v = Math.max(0, hit.volume());
      if (v > CHECKS.overlap) out.push({ name, kind, mesh: meshData(hit) });
      return v;
    } finally {
      hit.delete();
    }
  };
  return { M, regions, volume, collision };
}

/** Each key's region: its keycap with clearance, tile and seat, and a margin. */
export function keyRegions(cfg: Project['config'], keys: Keys): Region[] {
  const extraThumbs = new Set(keyGroups(cfg).extra);
  const { outer } = seatSettings(cfg);
  return keys.map(([name, frame]) => {
    const cap = capSize(cfg, name);
    const margin = capClearance(cfg, name);
    const half = [0, 1].map(
      (k) =>
        Math.max(cap[k] / 2 + margin, cfg.tile.size_mm[k] / 2, outer[k] / 2) + CHECKS.regionMargin,
    );
    // Regions of a column or thumb row share a chunk.
    const group = name.startsWith('matrix_')
      ? name.slice(0, name.lastIndexOf('_'))
      : extraThumbs.has(name)
        ? 'extra thumbs'
        : 'thumbs';
    return { frame, half, group };
  });
}

/**
 * Probes each opening at nine points: covered if the chassis is there at all,
 * blocked if any of it is left once the opening's height is punched out.
 */
export function checkOpenings(
  p: Probe,
  cfg: Project['config'],
  keys: Keys,
  body: Manifold,
  cutters: Manifold[],
) {
  const hole = switchHole(cfg);
  const { bottom, top } = openingSpan(cfg);
  const highlights: Highlight[] = [];
  const openings: Report['openings'] = [];
  for (const [i, [name, m]] of keys.entries()) {
    const cutter = cutters[i];
    let covered = 0;
    let blocked = 0;
    const inset = CHECKS.probeInset;
    for (const x of [-hole[0] / 2 + inset, 0, hole[0] / 2 - inset])
      for (const y of [-hole[1] / 2 + inset, 0, hole[1] / 2 - inset]) {
        const probe = place(
          box(p.M, [CHECKS.probeSize, CHECKS.probeSize, CHECKS.probeHeight], [x, y, 0]),
          m,
        );
        const hit = p.regions.within(body, probe).intersect(probe);
        if (hit.volume() > CHECKS.empty) {
          covered++;
          const punch = place(
            box(
              p.M,
              [CHECKS.punchSize, CHECKS.punchSize, top - bottom],
              [x, y, (top + bottom) / 2],
            ),
            m,
          );
          const rest = hit.subtract(punch);
          if (rest.volume() > CHECKS.empty) blocked++;
        }
      }
    const removed = p.volume(body, cutter);
    const passed = covered === 9 && blocked === 0 && removed > CHECKS.empty;
    if (!passed) highlights.push({ name, kind: 'opening', mesh: meshData(cutter) });
    openings.push({ name, removed, covered, blocked, passed });
  }
  return { openings, highlights };
}

/** The bottom section is a separate print, so everything above it must be one piece. */
function checkPieces(cut: Manifold) {
  const pieces = cut
    .decompose()
    .filter((p) => p.volume() > CHECKS.minPiece)
    .sort((a, b) => b.volume() - a.volume());
  const highlights = pieces
    .slice(1)
    .map((p, i): Highlight => ({ name: `loose piece ${i + 1}`, kind: 'loose', mesh: meshData(p) }));
  return { pieces: pieces.map((p) => p.volume()), highlights };
}

/**
 * Without the bottom section the case must also hold together along its
 * edge: a section just above the parting line must be one connected area.
 */
function checkFootprint(cut: Manifold, split: number) {
  const footprint = cut
    .slice(split + CHECKS.footprintHeight)
    .decompose()
    .map((c) => ({ a: c.area(), c }))
    .filter((x) => x.a > CHECKS.minFootprint)
    .sort((x, y) => y.a - x.a);
  const highlights = footprint.slice(1).map((x, i): Highlight => ({
    name: `separate footprint ${i + 1}`,
    kind: 'loose',
    mesh: meshData(x.c.extrude(CHECKS.footprintShow)),
  }));
  return { footprint: footprint.map((x) => x.a), highlights };
}

/** Chassis built where a keycap goes, which its room had to remove. */
function checkRooms(roomCuts: { name: string; cut: Manifold }[]) {
  const rooms = roomCuts
    .map((r) => ({ name: r.name, volume: r.cut.volume(), cut: r.cut }))
    .filter((r) => r.volume > CHECKS.roomCut);
  const highlights = rooms.map((r): Highlight => ({
    name: `${r.name} keycap room`,
    kind: 'room',
    mesh: meshData(r.cut),
  }));
  return { roomCuts: rooms.map(({ name, volume }) => ({ name, volume })), highlights };
}

/** Each seat must be a complete ring around the hole, with nothing outside its plane or in its clip reliefs. */
export function checkSeats(p: Probe, cfg: Project['config'], keys: Keys, result: Manifold) {
  const hole = switchHole(cfg);
  const skip = CHECKS.faceSkip;
  const highlights: Highlight[] = [];
  const seats: SeatCheck[] = [];
  for (const [name, m] of keys) {
    const ring = seatBox(p.M, cfg, m).subtract(
      place(box(p.M, [...hole, CHECKS.ringHoleHeight]), m),
    );
    const missingSolid = ring.subtract(p.regions.within(result, ring));
    const missing = Math.max(0, missingSolid.volume());
    const outside = seatBox(p.M, cfg, m, { xy: -2 * skip, z: CHECKS.outsideReach }).subtract(
      seatBox(p.M, cfg, m, { z: 2 * skip }),
    );
    const excess = p.collision(result, outside, name, 'seat', highlights);
    let clipBlocked = 0;
    for (const sign of [-1, 1])
      clipBlocked += p.collision(
        result,
        clipBox(p.M, cfg, m, sign, skip),
        name,
        'seat',
        highlights,
      );
    if (missing > CHECKS.overlap)
      highlights.push({ name, kind: 'seat', mesh: meshData(missingSolid) });
    seats.push({
      name,
      missing,
      excess,
      clipBlocked,
      passed:
        missing <= CHECKS.overlap && excess <= CHECKS.overlap && clipBlocked <= CHECKS.overlap,
    });
  }
  return { seats, highlights };
}

/**
 * Hardware against the chassis and its bottom section, and the adapter and
 * ribbon against the port insert, which carries the landing.
 */
function checkHardware(
  p: Probe,
  project: Project,
  nodes: ReturnType<typeof componentFrames>,
  chassis: ReturnType<typeof buildChassis>,
  result: Manifold,
) {
  const withTrim = result.add(chassis.trim);
  const against: Record<string, Manifold> = {
    pcb: result,
    components: result,
    adapter: withTrim,
    ribbon: withTrim,
  };
  const highlights: Highlight[] = [];
  const overlaps: Report['hardware'] = [];
  for (const part of hardware(project, nodes, chassis.panel))
    if (against[part.group]) {
      let shape = part.cylinder
        ? p.M.cylinder(part.size[2], part.cylinder, part.cylinder, 64, true).translate(part.center)
        : box(p.M, part.size, part.center);
      for (const h of part.holes ?? [])
        shape = shape.subtract(
          p.M.cylinder(part.size[2] + 2, h.diameter / 2, h.diameter / 2, 32, true).translate([
            h.at[0],
            h.at[1],
            part.center[2],
          ]),
        );
      const v = p.collision(
        against[part.group],
        place(shape, new Matrix4().fromArray(part.matrix)),
        part.name,
        'hardware',
        highlights,
      );
      if (v > CHECKS.overlap) overlaps.push({ name: part.name, group: part.group, volume: v });
    }
  return { hardware: overlaps, highlights };
}

/**
 * Shapes that must miss `target`: intersect their union with it once, and
 * only when that hits, find which of them do.
 */
function misses(
  p: Probe,
  shapes: { name: string; solid: Manifold }[],
  target: Manifold,
  kind: Highlight['kind'],
  highlights: Highlight[],
) {
  const out: { name: string; volume: number }[] = [];
  if (!shapes.length || p.volume(p.M.union(shapes.map((x) => x.solid)), target) <= CHECKS.overlap)
    return out;
  for (const x of shapes) {
    const v = p.collision(target, x.solid, x.name, kind, highlights);
    if (v > CHECKS.overlap) out.push({ name: x.name, volume: v });
  }
  return out;
}

/** Every wire, as a tube of its diameter, must miss the chassis and its bottom section, and every other wire. */
function checkWires(p: Probe, wired: Wiring, result: Manifold) {
  const tube = (points: number[][], d: number) =>
    p.M.union(points.slice(1).map((q, i) => capsule(p.M, points[i], q, d / 2, CHECKS.wireSides)));
  const wireName = (w: Wiring['wires'][number]) =>
    `${w.net}: ${w.from.replace(/^(matrix|thumb)_/, '')} to ${w.to.replace(/^(matrix|thumb)_/, '')}`;
  const highlights: Highlight[] = [];
  const wires = misses(
    p,
    wired.wires.map((w) => ({ name: wireName(w), solid: tube(w.points, w.diameter) })),
    result,
    'wire',
    highlights,
  );
  const crossed = crossings(wired.wires).map(([a, b]) => {
    const [x, y] = [wired.wires[a], wired.wires[b]];
    const name = `${wireName(x)} and ${wireName(y)}`;
    p.collision(tube(x.points, x.diameter), tube(y.points, y.diameter), name, 'wire', highlights);
    return name;
  });
  return { wires, crossings: crossed, highlights };
}

/**
 * A soldering iron's way to each pad, with the bottom section off: straight
 * down from it along its key's normal, through the open bottom of the tile
 * pocket.
 */
function checkSolder(p: Probe, cfg: Project['config'], keys: Keys, cut: Manifold) {
  const [access, reach] = cfg.wiring.solder_access_mm;
  const padZ = tileUnderside(cfg);
  const highlights: Highlight[] = [];
  const solder = misses(
    p,
    keys.flatMap(([name, m]) =>
      cfg.tile.pads.list.map((pad) => ({
        name: `${name}: ${pad.name} pad, ${pad.at_mm[1] > 0 ? 'back' : 'front'} edge`,
        solid: place(
          p.M.cylinder(reach, access / 2, access / 2, 24).translate([
            pad.at_mm[0],
            pad.at_mm[1],
            padZ - reach - 0.01,
          ]),
          m,
        ),
      })),
    ),
    cut,
    'solder',
    highlights,
  );
  return { solder, highlights };
}

/** Each keycap, at rest and over its full travel grown by its clearance, must miss the chassis. */
function checkKeycaps(p: Probe, cfg: Project['config'], keys: Keys, result: Manifold) {
  const highlights: Highlight[] = [];
  const keycaps: Clearance[] = [];
  const rests: Record<string, Manifold> = {};
  for (const [name, m] of keys) {
    const rest = (rests[name] = place(
      keycapSolid(p.M, keycapEnvelope(cfg, name, { clearance: 0 }), false),
      m,
    ));
    const sweep = place(keycapSolid(p.M, keycapEnvelope(cfg, name)), m);
    const atRest = p.collision(result, rest, name, 'rest', highlights);
    const swept = p.collision(result, sweep, name, 'travel', highlights);
    keycaps.push({
      name,
      size: capSize(cfg, name),
      margin: capClearance(cfg, name),
      atRest,
      swept,
      passed: atRest <= CHECKS.overlap && swept <= CHECKS.overlap,
    });
  }
  return { keycaps, rests, highlights };
}

/** Closest distance between the resting keycaps of the finger columns, the thumb row and the extra thumb row. */
function checkCapGaps(M: Factory, cfg: Project['config'], rests: Record<string, Manifold>) {
  const groups = keyGroups(cfg);
  const unions = (
    [
      ['fingers', groups.fingers],
      ['thumbs', groups.thumbs],
      ['extra thumbs', groups.extra],
    ] as [string, string[]][]
  )
    .filter(([, ns]) => ns.length)
    .map(([label, ns]) => [label, M.union(ns.map((n) => rests[n]))] as const);
  const capGaps: Report['capGaps'] = [];
  for (let i = 0; i < unions.length; i++)
    for (let j = i + 1; j < unions.length; j++) {
      const gap = unions[i][1].minGap(unions[j][1], CHECKS.capGapSearch);
      if (gap < CHECKS.capGapSearch)
        capGaps.push({ between: `${unions[i][0]} – ${unions[j][0]}`, gap });
    }
  return capGaps;
}

function build(
  wasm: ManifoldToplevel,
  project: Project,
  given: { wired?: Wiring; built?: ReturnType<typeof shell>; start?: number } = {},
): BuildResult {
  validateProject(project);
  const start = given.start ?? performance.now();
  const cfg = project.config;
  const nodes = componentFrames(cfg);
  const keys: Keys = Object.entries(nodes).filter(([name]) => isKey(name));
  const wired = given.wired ?? wiring(cfg, nodes);
  const chassis = buildChassis(wasm, cfg, nodes, wired, given.built);
  if (chassis.body.status() !== 'NoError') throw Error('Invalid chassis: ' + chassis.body.status());
  const M = wasm.Manifold;
  const probe = makeProbe(
    M,
    new RegionIndex(M, keyRegions(cfg, keys), CHECKS.regionHeight, CHECKS.regionPad),
  );

  const seated = seatSwitches(
    M,
    cfg,
    chassis.body,
    keys.map(([, m]) => m),
  );
  const opened = checkOpenings(probe, cfg, keys, seated.body, seated.openings);
  const cut = seated.body.subtract(M.union([...seated.reliefs, ...seated.openings]));
  if (cut.status() !== 'NoError' || cut.volume() <= 0)
    throw Error('Cutouts produced an invalid solid: ' + cut.status());
  const loose = checkPieces(cut);
  const footprint = checkFootprint(cut, chassis.split);
  const rooms = checkRooms(chassis.roomCuts);
  // Checked as one solid; the case and its bottom section are still returned
  // (and printed) separately.
  const result = cut.add(chassis.base);
  const seats = checkSeats(probe, cfg, keys, result);
  const hw = checkHardware(probe, project, nodes, chassis, result);
  const wireChecks = checkWires(probe, wired, result);
  const solder = checkSolder(probe, cfg, keys, cut);
  const caps = checkKeycaps(probe, cfg, keys, result);
  const capGaps = checkCapGaps(M, cfg, caps.rests);

  const mesh = meshData(cut);
  const passed =
    seats.seats.every((s) => s.passed) &&
    caps.keycaps.every((k) => k.passed) &&
    hw.hardware.length === 0 &&
    loose.pieces.length === 1 &&
    footprint.footprint.length === 1 &&
    rooms.roomCuts.length === 0 &&
    capGaps.every((c) => c.gap > 0) &&
    opened.openings.every((o) => o.passed) &&
    wireChecks.wires.length === 0 &&
    wireChecks.crossings.length === 0 &&
    solder.solder.length === 0;
  return {
    mesh,
    base: meshData(chassis.base),
    trim: meshData(chassis.trim),
    panel: chassis.panel,
    highlights: [
      ...opened.highlights,
      ...loose.highlights,
      ...footprint.highlights,
      ...rooms.highlights,
      ...seats.highlights,
      ...hw.highlights,
      ...wireChecks.highlights,
      ...solder.highlights,
      ...caps.highlights,
    ],
    wiring: wired,
    report: {
      seats: seats.seats,
      passed,
      keycaps: caps.keycaps,
      capGaps,
      pieces: loose.pieces,
      footprint: footprint.footprint,
      roomCuts: rooms.roomCuts,
      hardware: hw.hardware,
      wires: wireChecks.wires,
      solder: solder.solder,
      wiring: {
        wires: wired.wires.length,
        joints: wired.nets.reduce((t, n) => t + n.joints, 0),
        length: wired.nets.reduce((t, n) => t + n.length, 0),
      },
      crossings: wireChecks.crossings,
      openings: opened.openings,
      volume: result.volume(),
      triangles: mesh.indices.length / 3,
      milliseconds: performance.now() - start,
    },
  };
}
