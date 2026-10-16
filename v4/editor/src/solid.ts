import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { Matrix4, Vector3 } from 'three';
import { seatSettings } from './seats';
import { buildChassis } from './chassis';
import { hardware } from './parts';
import { capsule, freeAfter, freeAfterAsync, keycapSolid, meshData, place } from './manifold-util';
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
/** Sizes and limits for the seats and the clearance checks, in mm (volumes in mm³, areas in mm²). */
const CHECKS = {
  /** Overlap volume below which a collision is ignored. */
  overlap: 0.05,
  /** Volume below which a cut or probe counts as empty. */
  empty: 0.001,
  /** Volume a keycap's room may remove from the chassis before the check fails. */
  roomCut: 0.05,
  /** Each seat is trimmed flat this far above and below its plane. */
  seatTrim: 7,
  /** Clip reliefs: this tall below the seat, reaching this far into the switch hole and this far past clip_relief_depth_mm. */
  clipReliefHeight: 3,
  clipReliefIntoHole: 0.15,
  clipReliefPastDepth: 0.05,
  /** Opening probes: nine, this far inside the opening's edges. */
  probeInset: 0.25,
  /** Each opening must be clear from this far below the switch body to this height above the plate. */
  openingBelowBody: 0.5,
  openingTop: 12,
  /** Pieces smaller than this (mm³) are ignored when counting pieces: slivers left by boolean operations. */
  minPiece: 0.5,
  /** The footprint check's section height above the parting line, and the smallest area it counts. */
  footprintHeight: 1.5,
  minFootprint: 1,
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
} as const;
export interface Clearance {
  name: string;
  size: V3;
  margin: number;
  travel: number;
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
  notes: string[];
}
export interface Highlight {
  name: string;
  kind: 'rest' | 'travel' | 'room' | 'hardware' | 'opening' | 'seat' | 'loose' | 'wire' | 'solder';
  mesh: MeshData;
}
export interface BuildResult {
  mesh: MeshData;
  base: MeshData;
  /** The port panel's dark insert. */
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
function build(
  wasm: ManifoldToplevel,
  project: Project,
  given: { wired?: Wiring; built?: ReturnType<typeof shell>; start?: number } = {},
): BuildResult {
  validateProject(project);
  const start = given.start ?? performance.now();
  const cfg = project.config;
  const sw = cfg.switch;
  const nodes = componentFrames(cfg);
  const keyNodes = Object.entries(nodes).filter(([name]) => isKey(name));
  const M = wasm.Manifold;
  // The switch hole, and the clip reliefs either side of it in y.
  const hole = sw.cutout_mm.map((x) => x + sw.cutout_clearance_mm);
  const clipDepth =
    sw.clip_relief_depth_mm + CHECKS.clipReliefIntoHole + CHECKS.clipReliefPastDepth;
  const clipY = hole[1] / 2 - CHECKS.clipReliefIntoHole + clipDepth / 2;
  const highlights: Highlight[] = [];
  // A boolean costs as much as its larger mesh, however small the other is,
  // and most checks test a small shape against the whole chassis. So each
  // key's surroundings are cut from the chassis once, and a shape that lies
  // within them is tested against that piece: the same result, from a mesh a
  // fraction of the size.
  const keyGroup = keyGroups(cfg);
  const extraThumbs = new Set(keyGroup.extra);
  const groups = new Map<string, { lo: number[]; hi: number[]; pieces: Map<Manifold, Manifold> }>();
  const regions = keyNodes.map(([name, m]) => {
    const cap = capSize(cfg, name);
    const margin = capClearance(cfg, name);
    const half = [0, 1].map(
      (k) =>
        Math.max(cap[k] / 2 + margin, cfg.tile.size_mm[k] / 2, seatSettings(cfg).outer[k] / 2) +
        CHECKS.regionMargin,
    );
    // Cutting a piece costs as much as what it is cut from, so each key's is
    // cut from its column's (or thumb row's), cut from the whole once.
    const id = name.startsWith('matrix_')
      ? name.slice(0, name.lastIndexOf('_'))
      : extraThumbs.has(name)
        ? 'extra thumbs'
        : 'thumbs';
    let group = groups.get(id);
    if (!group)
      groups.set(
        id,
        (group = {
          lo: [Infinity, Infinity, Infinity],
          hi: [-Infinity, -Infinity, -Infinity],
          pieces: new Map(),
        }),
      );
    for (let i = 0; i < 8; i++) {
      const c = new Vector3(
        i & 1 ? half[0] : -half[0],
        i & 2 ? half[1] : -half[1],
        i & 4 ? CHECKS.regionHeight : -CHECKS.regionHeight,
      ).applyMatrix4(m);
      c.toArray().forEach((x, k) => {
        group.lo[k] = Math.min(group.lo[k], x - 0.1);
        group.hi[k] = Math.max(group.hi[k], x + 0.1);
      });
    }
    return { m, inverse: m.clone().invert(), half, group, pieces: new Map<Manifold, Manifold>() };
  });
  // Cut now: left lazy, each test's intersect would fold into this one and
  // run against the whole chassis again.
  const cutOut = (target: Manifold, region: Manifold) => target.intersect(region).asOriginal();
  const within = (target: Manifold, envelope: Manifold) => {
    // Its corners, not its bounding box's: a tilted key's shapes are tilted too.
    const { vertProperties: v, numProp } = envelope.getMesh();
    const p = new Vector3();
    for (const r of regions) {
      let inside = true;
      for (let i = 0; inside && i < v.length; i += numProp) {
        p.set(v[i], v[i + 1], v[i + 2]).applyMatrix4(r.inverse);
        inside =
          Math.abs(p.x) <= r.half[0] &&
          Math.abs(p.y) <= r.half[1] &&
          Math.abs(p.z) <= CHECKS.regionHeight;
      }
      if (!inside) continue;
      let piece = r.pieces.get(target);
      if (!piece) {
        const g = r.group;
        let chunk = g.pieces.get(target);
        if (!chunk) {
          const size = g.hi.map((h, k) => h - g.lo[k]);
          chunk = cutOut(
            target,
            box(
              size,
              g.lo.map((l, k) => l + size[k] / 2),
            ),
          );
          g.pieces.set(target, chunk);
        }
        const region = place(box([...r.half.map((h) => 2 * h), 2 * CHECKS.regionHeight]), r.m);
        r.pieces.set(target, (piece = cutOut(chunk, region)));
      }
      return piece;
    }
    return target;
  };
  const collision = (body: Manifold, envelope: Manifold, name: string, kind: Highlight['kind']) => {
    const hit = within(body, envelope).intersect(envelope);
    try {
      const v = Math.max(0, hit.volume());
      if (v > CHECKS.overlap) highlights.push({ name, kind, mesh: meshData(hit) });
      return v;
    } finally {
      hit.delete();
    }
  };
  const box = (size: number[], center: number[] = [0, 0, 0]) =>
    M.cube(size as V3, true).translate(center as V3);
  const volume = (a: Manifold, b: Manifold) => {
    const hit = within(a, b).intersect(b);
    try {
      return Math.max(0, hit.volume());
    } finally {
      hit.delete();
    }
  };
  const wired = given.wired ?? wiring(cfg, nodes);
  const chassis = buildChassis(wasm, cfg, nodes, wired, given.built);
  let body = chassis.body;
  if (body.status() !== 'NoError') throw Error('Invalid chassis: ' + body.status());
  const { outer, thickness } = seatSettings(cfg);
  const seatPlates: Manifold[] = [];
  const seatTrims: Manifold[] = [];
  const clipCuts: Manifold[] = [];
  for (const [, m] of keyNodes) {
    seatPlates.push(place(box([...outer, thickness], [0, 0, -thickness / 2]), m));
    seatTrims.push(
      place(box([...outer, CHECKS.seatTrim], [0, 0, CHECKS.seatTrim / 2]), m),
      place(
        box([...outer, CHECKS.seatTrim - thickness], [0, 0, (-CHECKS.seatTrim - thickness) / 2]),
        m,
      ),
    );
    for (const sign of [-1, 1])
      clipCuts.push(
        place(
          box(
            [sw.clip_width_mm, clipDepth, CHECKS.clipReliefHeight],
            [0, sign * clipY, -thickness - CHECKS.clipReliefHeight / 2],
          ),
          m,
        ),
      );
  }
  // Crisp flat seats: fill each mounting footprint so the switch lip is
  // continuously supported, then trim the plate above and below it. (Trimming
  // first and then filling put the trimmed faces exactly on the fill's faces,
  // and Manifold's union then dropped material elsewhere: it cut a wedge from
  // the index home plate's edge.)
  body = body.add(M.union(seatPlates)).subtract(M.union(seatTrims));
  const cuts: Manifold[] = [...clipCuts];
  const openings: Report['openings'] = [];
  const record = (
    name: string,
    cutter: Manifold,
    size: number[],
    pose: Matrix4,
    bottom: number,
    top: number,
  ) => {
    // Nine probes across the opening: covered if the chassis is there at all,
    // blocked if any of it is left once the opening's height is punched out.
    let covered = 0;
    let blocked = 0;
    const inset = CHECKS.probeInset;
    for (const x of [-size[0] / 2 + inset, 0, size[0] / 2 - inset])
      for (const y of [-size[1] / 2 + inset, 0, size[1] / 2 - inset]) {
        const probe = place(box([0.3, 0.3, 24], [x, y, 0]), pose);
        const hit = within(body, probe).intersect(probe);
        if (hit.volume() > CHECKS.empty) {
          covered++;
          const punch = place(box([0.4, 0.4, top - bottom], [x, y, (top + bottom) / 2]), pose);
          const rest = hit.subtract(punch);
          if (rest.volume() > CHECKS.empty) blocked++;
        }
      }
    const removed = volume(body, cutter);
    const passed = covered === 9 && blocked === 0 && removed > CHECKS.empty;
    if (!passed) highlights.push({ name, kind: 'opening', mesh: meshData(cutter) });
    openings.push({ name, removed, covered, blocked, passed });
    cuts.push(cutter);
  };
  for (const [name, m] of keyNodes) {
    const bottom = -sw.body_below_plate_mm - CHECKS.openingBelowBody;
    const top = CHECKS.openingTop;
    record(
      name,
      place(box([...hole, top - bottom], [0, 0, (top + bottom) / 2]), m),
      hole,
      m,
      bottom,
      top,
    );
  }
  const cut = body.subtract(M.union(cuts));
  if (cut.status() !== 'NoError' || cut.volume() <= 0)
    throw Error('Cutouts produced an invalid solid: ' + cut.status());
  // The base plate is a separate print, so every piece above it must hold together.
  const pieces = cut
    .decompose()
    .filter((p) => p.volume() > CHECKS.minPiece)
    .sort((a, b) => b.volume() - a.volume());
  pieces
    .slice(1)
    .forEach((p, i) =>
      highlights.push({ name: `loose piece ${i + 1}`, kind: 'loose', mesh: meshData(p) }),
    );
  // Without the bottom section the case must also hold together along its
  // edge: a section just above the parting line must be one connected area.
  const section = cut.slice(chassis.split + CHECKS.footprintHeight);
  const footprint = section
    .decompose()
    .map((c) => {
      const a = c.area();
      return { a, c };
    })
    .filter((x) => x.a > CHECKS.minFootprint)
    .sort((x, y) => y.a - x.a);
  footprint.slice(1).forEach((x, i) =>
    highlights.push({
      name: `separate footprint ${i + 1}`,
      kind: 'loose',
      mesh: meshData(x.c.extrude(3)),
    }),
  );
  // Chassis built where a keycap goes, which its room had to remove.
  const roomCuts = chassis.roomCuts
    .map((r) => ({ name: r.name, volume: r.cut.volume(), cut: r.cut }))
    .filter((r) => r.volume > CHECKS.roomCut);
  for (const r of roomCuts)
    highlights.push({ name: `${r.name} keycap room`, kind: 'room', mesh: meshData(r.cut) });
  const result = cut.add(chassis.base);
  const seats: SeatCheck[] = [];
  for (const [name, m] of keyNodes) {
    // The seat must be a complete ring around the hole, with nothing outside its plane.
    const ring = place(box([...outer, thickness], [0, 0, -thickness / 2]), m).subtract(
      place(box([...hole, 10]), m),
    );
    const missingSolid = ring.subtract(within(result, ring));
    const missing = Math.max(0, missingSolid.volume());
    const outside = place(
      box([outer[0] - 0.02, outer[1] - 0.02, thickness + 1], [0, 0, -thickness / 2]),
      m,
    ).subtract(place(box([...outer, thickness + 0.02], [0, 0, -thickness / 2]), m));
    const excess = collision(result, outside, name, 'seat');
    let clipBlocked = 0;
    for (const sign of [-1, 1])
      clipBlocked += collision(
        result,
        place(
          box(
            // Just inside the relief, so its own faces don't count.
            [sw.clip_width_mm, clipDepth - 0.02, CHECKS.clipReliefHeight - 0.01],
            [0, sign * clipY, -thickness - CHECKS.clipReliefHeight / 2 - 0.005],
          ),
          m,
        ),
        name,
        'seat',
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
  const overlaps: Report['hardware'] = [];
  // Hardware is checked against the chassis and its bottom section, and the
  // adapter and ribbon against the port insert, which carries the landing.
  const withTrim = result.add(chassis.trim);
  const against: Record<string, Manifold> = {
    pcb: result,
    components: result,
    adapter: withTrim,
    ribbon: withTrim,
  };
  for (const p of hardware(project, nodes, chassis.panel))
    if (against[p.group]) {
      let shape = p.cylinder
        ? M.cylinder(p.size[2], p.cylinder, p.cylinder, 64, true).translate(p.center)
        : box(p.size, p.center);
      for (const h of p.holes ?? [])
        shape = shape.subtract(
          M.cylinder(p.size[2] + 2, h.diameter / 2, h.diameter / 2, 32, true).translate([
            h.at[0],
            h.at[1],
            p.center[2],
          ]),
        );
      const v = collision(
        against[p.group],
        place(shape, new Matrix4().fromArray(p.matrix)),
        p.name,
        'hardware',
      );
      if (v > CHECKS.overlap) overlaps.push({ name: p.name, group: p.group, volume: v });
    }
  // Every wire as a tube, against the chassis and its bottom section.
  const tube = (points: number[][], d: number) =>
    M.union(points.slice(1).map((q, i) => capsule(M, points[i], q, d / 2, CHECKS.wireSides)));
  /**
   * Shapes that must miss `target`: intersect their union with it once, and
   * only when that hits, find which of them do.
   */
  const misses = (
    shapes: { name: string; solid: Manifold }[],
    target: Manifold,
    kind: Highlight['kind'],
  ) => {
    const out: { name: string; volume: number }[] = [];
    if (!shapes.length || volume(M.union(shapes.map((x) => x.solid)), target) <= CHECKS.overlap)
      return out;
    for (const x of shapes) {
      const v = collision(target, x.solid, x.name, kind);
      if (v > CHECKS.overlap) out.push({ name: x.name, volume: v });
    }
    return out;
  };
  const wireName = (w: (typeof wired.wires)[number]) =>
    `${w.net}: ${w.from.replace(/^(matrix|thumb)_/, '')} to ${w.to.replace(/^(matrix|thumb)_/, '')}`;
  const wires = misses(
    wired.wires.map((w) => ({ name: wireName(w), solid: tube(w.points, w.diameter) })),
    result,
    'wire',
  );
  // Wires that run into each other, shown where they overlap.
  const crossed = crossings(wired.wires).map(([a, b]) => {
    const [x, y] = [wired.wires[a], wired.wires[b]];
    const name = `${wireName(x)} and ${wireName(y)}`;
    collision(tube(x.points, x.diameter), tube(y.points, y.diameter), name, 'wire');
    return name;
  });
  // A soldering iron's way to each pad, with the bottom plate off: straight
  // down from it along its key's normal, through the open bottom of the tile
  // pocket.
  const [access, reach] = cfg.wiring.solder_access_mm;
  const padZ = tileUnderside(cfg);
  const solder = misses(
    keyNodes.flatMap(([name, m]) =>
      cfg.tile.pads.list.map((p) => ({
        name: `${name}: ${p.name} pad, ${p.at_mm[1] > 0 ? 'back' : 'front'} edge`,
        solid: place(
          M.cylinder(reach, access / 2, access / 2, 24).translate([
            p.at_mm[0],
            p.at_mm[1],
            padZ - reach - 0.01,
          ]),
          m,
        ),
      })),
    ),
    cut,
    'solder',
  );
  const keycaps: Clearance[] = [];
  const rests: Record<string, Manifold> = {};
  for (const [name, m] of keyNodes) {
    const size = capSize(cfg, name);
    const margin = capClearance(cfg, name);
    const rest = (rests[name] = place(
      keycapSolid(M, keycapEnvelope(cfg, name, { clearance: 0 }), false),
      m,
    ));
    // The keycap over its full travel, grown by its clearance.
    const sweep = place(keycapSolid(M, keycapEnvelope(cfg, name)), m);
    const atRest = collision(result, rest, name, 'rest');
    const swept = collision(result, sweep, name, 'travel');
    keycaps.push({
      name,
      size,
      margin,
      travel: sw.travel_mm,
      atRest,
      swept,
      passed: atRest <= CHECKS.overlap && swept <= CHECKS.overlap,
    });
  }
  // Closest distance between the resting keycaps of the finger columns, the thumb row and the extra thumb row.
  const unions = (
    [
      ['fingers', keyGroup.fingers],
      ['thumbs', keyGroup.thumbs],
      ['extra thumbs', keyGroup.extra],
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
  // The chassis and its bottom plate are separate prints, sent separately.
  const mesh = meshData(cut);
  const passed =
    seats.every((s) => s.passed) &&
    keycaps.every((k) => k.passed) &&
    overlaps.length === 0 &&
    pieces.length === 1 &&
    footprint.length === 1 &&
    roomCuts.length === 0 &&
    capGaps.every((c) => c.gap > 0) &&
    openings.every((o) => o.passed) &&
    wires.length === 0 &&
    crossed.length === 0 &&
    solder.length === 0;
  return {
    mesh,
    base: meshData(chassis.base),
    trim: meshData(chassis.trim),
    panel: chassis.panel,
    highlights,
    wiring: wired,
    report: {
      seats,
      passed,
      keycaps,
      capGaps,
      pieces: pieces.map((p) => p.volume()),
      footprint: footprint.map((x) => x.a),
      roomCuts: roomCuts.map(({ name, volume }) => ({ name, volume })),
      hardware: overlaps,
      wires,
      solder,
      wiring: {
        wires: wired.wires.length,
        joints: wired.nets.reduce((t, n) => t + n.joints, 0),
        length: wired.nets.reduce((t, n) => t + n.length, 0),
      },
      crossings: crossed,
      openings,
      volume: result.volume(),
      triangles: mesh.indices.length / 3,
      milliseconds: performance.now() - start,
      notes: [
        'Component/keycap envelopes are conservative boxes.',
        'Flat seats and clip reliefs are generated. PCB retainers remain unimplemented. Minimum thickness and global self-intersections are not certified.',
      ],
    },
  };
}
