import type { Manifold, ManifoldToplevel, Mat4 } from 'manifold-3d';
import { Matrix4 } from 'three';
import { seatSettings } from './seats';
import { buildChassis, capSize, isKey, trackpadPart, type WallWindow } from './chassis';
import { componentFrames, validateProject, type V3, type MeshData, type Project } from './geometry';
export { capSize, isKey };
/** Sizes and limits for the seats and the clearance checks, in mm (volumes in mm³, areas in mm²). */
const CHECKS = {
  /** Overlap volume below which a collision is ignored. */
  overlap: 0.05,
  /** Volume below which a cut or probe counts as empty. */
  empty: 0.001,
  /** Volume the tile pockets may remove before the check fails. */
  pocketCut: 0.01,
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
  /** Pieces smaller than this are ignored when counting pieces. */
  minPiece: 50,
  /** The footprint check's section height above z = 0, and the smallest area it counts. */
  footprintHeight: 1.5,
  minFootprint: 1,
  /** Keycap groups further apart than this are not listed. */
  capGapSearch: 40,
  /** A hole through a wall smaller than this area is ignored. */
  wallGap: 0.01,
  /** A blind slot is highlighted by a rod this radius through its centre. */
  blindSlotMarker: 1.5,
} as const;
export interface Part {
  name: string;
  group: string;
  size: V3;
  center: V3;
  matrix: number[];
  cylinder?: number;
}
export function hardware(project: Project, nodes = componentFrames(project.config)): Part[] {
  const cfg = project.config;
  const parts: Part[] = [];
  const tile = cfg.tile;
  const sw = cfg.switch;
  // The tile's top, below the plate top.
  const tileTop = -tile.plate_top_to_pcb_top_mm;
  const add = (
    name: string,
    group: string,
    size: number[],
    center: number[],
    m: Matrix4,
    cylinder?: number,
  ) =>
    parts.push({
      name,
      group,
      size: size as V3,
      center: center as V3,
      matrix: m.elements.slice(),
      cylinder,
    });
  for (const [name, m] of Object.entries(nodes))
    if (isKey(name)) {
      add(name, 'pcb', tile.size_mm, [0, 0, tileTop - tile.size_mm[2] / 2], m);
      for (const c of tile.components)
        add(
          name + ': ' + c.name,
          'components',
          c.size_mm,
          [c.center_mm[0], c.center_mm[1], c.center_mm[2] + tileTop],
          m,
        );
      add(name, 'switch', sw.body_mm, [0, 0, sw.body_mm[2] / 2 - sw.body_below_plate_mm], m);
      const cap = capSize(cfg, name);
      add(name, 'keycaps', cap, [0, 0, sw.keycap_bottom_above_plate_mm + cap[2] / 2], m);
    }
  const pad = cfg.trackpad;
  add(
    'Trackpad',
    'trackpad',
    [pad.diameter_mm, pad.diameter_mm, pad.thickness_mm],
    [0, 0, -pad.top_below_rim_mm - pad.thickness_mm / 2 + 0.01],
    nodes.trackpad,
    pad.diameter_mm / 2,
  );
  const adapter = cfg.adapter;
  add('FFC PCB', 'adapter', adapter.board_mm, [0, 0, -adapter.board_mm[2] / 2], nodes.adapter);
  add(
    'FFC connector',
    'adapter',
    [adapter.board_mm[0] - 4, adapter.board_mm[1] / 2, adapter.component_height_mm],
    [0, 0, adapter.component_height_mm / 2],
    nodes.adapter,
  );
  return parts;
}
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
  pocketCut: number;
  hardware: { name: string; group: string; volume: number }[];
  openings: { name: string; removed: number; covered: number; blocked: number }[];
  walls: WallCheck[];
  volume: number;
  triangles: number;
  milliseconds: number;
  notes: string[];
}
/** One wall window: the areas of holes through it that are not slots, and slots that don't go through. */
export interface WallCheck {
  name: string;
  gaps: number[];
  blindSlots: number;
  passed: boolean;
}
export interface Highlight {
  name: string;
  kind: 'rest' | 'travel' | 'hardware' | 'opening' | 'seat' | 'loose' | 'wall';
  mesh: MeshData;
}
export interface BuildResult {
  mesh: MeshData;
  base: MeshData;
  trackpad: MeshData;
  report: Report;
  highlights: Highlight[];
}
function meshData(solid: Manifold): MeshData {
  const raw = solid.getMesh();
  const positions = new Float32Array((raw.vertProperties.length / raw.numProp) * 3);
  for (let i = 0; i < positions.length / 3; i++)
    for (let j = 0; j < 3; j++) positions[i * 3 + j] = raw.vertProperties[i * raw.numProp + j];
  return { positions, indices: new Uint32Array(raw.triVerts) };
}
const signedArea = (p: number[][]) =>
  p.reduce((t, q, i) => {
    const r = p[(i + 1) % p.length];
    return t + q[0] * r[1] - r[0] * q[1];
  }, 0) / 2;
const contains = (p: number[][], [x, y]: number[]) => {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    if (
      p[i][1] > y !== p[j][1] > y &&
      x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]
    )
      inside = !inside;
  return inside;
};
/**
 * Look through each wall window along its normal: the solid's outline there,
 * projected onto the wall, must have a hole at each slot centre and no other
 * hole. A hole that is not a slot is a gap through the wall; a slot with no
 * hole is blind. Gaps are returned as solids for highlighting.
 */
export function checkWalls(wasm: ManifoldToplevel, solid: Manifold, windows: WallWindow[]) {
  const checks: WallCheck[] = [];
  const gapSolids: { name: string; mesh: MeshData }[] = [];
  for (const w of windows) {
    const [nx, ny] = w.normal;
    // World to (along, z, across) and back; column-major rotations.
    const toWall = [-ny, 0, nx, 0, nx, 0, ny, 0, 0, 1, 0, 0, 0, 0, 0, 1] as Mat4;
    const fromWall = [-ny, nx, 0, 0, 0, 0, 1, 0, nx, ny, 0, 0, 0, 0, 0, 1] as Mat4;
    const depth = w.across[1] - w.across[0];
    const made: { delete(): void }[] = [];
    const keep = <T extends { delete(): void }>(m: T) => (made.push(m), m);
    try {
      const turned = keep(solid.transform(toWall));
      const window = keep(
        keep(wasm.Manifold.cube([w.along[1] - w.along[0], 1000, depth], true)).translate([
          (w.along[0] + w.along[1]) / 2,
          0,
          (w.across[0] + w.across[1]) / 2,
        ]),
      );
      const outline = keep(keep(turned.intersect(window)).project());
      // Holes are the outline's clockwise loops.
      const holes = outline
        .toPolygons()
        .map((p) => p as number[][])
        .filter((p) => -signedArea(p) > CHECKS.wallGap);
      const gaps = holes.filter((h) => !w.slots.some((c) => contains(h, c)));
      const blind = w.slots.filter((c) => !holes.some((h) => contains(h, c)));
      for (const c of blind) {
        const marker = keep(
          keep(
            keep(
              wasm.Manifold.cylinder(depth, CHECKS.blindSlotMarker, CHECKS.blindSlotMarker, 24),
            ).translate([c[0], c[1], w.across[0]]),
          ).transform(fromWall),
        );
        gapSolids.push({ name: w.name, mesh: meshData(marker) });
      }
      for (const g of gaps) {
        const gap = keep(
          keep(keep(new wasm.CrossSection([[...g].reverse() as [number, number][]])).extrude(depth))
            .translate([0, 0, w.across[0]])
            .transform(fromWall),
        );
        gapSolids.push({ name: w.name, mesh: meshData(gap) });
      }
      checks.push({
        name: w.name,
        gaps: gaps.map((g) => -signedArea(g)),
        blindSlots: blind.length,
        passed: gaps.length === 0 && blind.length === 0,
      });
    } finally {
      for (const m of made.reverse()) m.delete();
    }
  }
  return { checks, gapSolids };
}
export function buildSolid(wasm: ManifoldToplevel, project: Project): BuildResult {
  validateProject(project);
  const start = performance.now();
  const cfg = project.config;
  const sw = cfg.switch;
  const nodes = componentFrames(cfg);
  const keyNodes = Object.entries(nodes).filter(([name]) => isKey(name));
  const M = wasm.Manifold;
  // Every Manifold made here, deleted at the end to free WebAssembly memory.
  const all = new Set<Manifold>();
  const keep = (m: Manifold) => {
    all.add(m);
    return m;
  };
  // The switch hole, and the clip reliefs either side of it in y.
  const hole = sw.cutout_mm.map((x) => x + sw.cutout_clearance_mm);
  const clipDepth =
    sw.clip_relief_depth_mm + CHECKS.clipReliefIntoHole + CHECKS.clipReliefPastDepth;
  const clipY = hole[1] / 2 - CHECKS.clipReliefIntoHole + clipDepth / 2;
  const highlights: Highlight[] = [];
  const collision = (body: Manifold, envelope: Manifold, name: string, kind: Highlight['kind']) => {
    const hit = body.intersect(envelope);
    try {
      const v = Math.max(0, hit.volume());
      if (v > CHECKS.overlap) highlights.push({ name, kind, mesh: meshData(hit) });
      return v;
    } finally {
      hit.delete();
    }
  };
  const box = (size: number[], center: number[] = [0, 0, 0]) =>
    keep(keep(M.cube(size as V3, true)).translate(center as V3));
  const place = (m: Manifold, pose: Matrix4) => keep(m.transform(pose.elements as Mat4));
  const volume = (a: Manifold, b: Manifold) => {
    const hit = a.intersect(b);
    try {
      return Math.max(0, hit.volume());
    } finally {
      hit.delete();
    }
  };
  try {
    const chassis = buildChassis(wasm, cfg, nodes);
    keep(chassis.body);
    keep(chassis.base);
    keep(chassis.pod);
    keep(chassis.pocketCut);
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
    // Crisp flat seats: trim the plate above and below each mounting footprint,
    // then fill it so the switch lip is continuously supported.
    body = keep(keep(body.subtract(keep(M.union(seatTrims)))).add(keep(M.union(seatPlates))));
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
          const hit = keep(body.intersect(probe));
          if (hit.volume() > CHECKS.empty) {
            covered++;
            const punch = place(box([0.4, 0.4, top - bottom], [x, y, (top + bottom) / 2]), pose);
            const rest = keep(hit.subtract(punch));
            if (rest.volume() > CHECKS.empty) blocked++;
          }
        }
      const removed = volume(body, cutter);
      if (covered < 9 || blocked || removed <= CHECKS.empty)
        highlights.push({ name, kind: 'opening', mesh: meshData(cutter) });
      openings.push({ name, removed, covered, blocked });
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
    const cut = keep(body.subtract(keep(M.union(cuts))));
    if (cut.status() !== 'NoError' || cut.volume() <= 0)
      throw Error('Cutouts produced an invalid solid: ' + cut.status());
    // The base plate is a separate print, so every piece above it must hold together.
    const pieces = cut
      .decompose()
      .map(keep)
      .filter((p) => p.volume() > CHECKS.minPiece)
      .sort((a, b) => b.volume() - a.volume());
    pieces
      .slice(1)
      .forEach((p, i) =>
        highlights.push({ name: `loose piece ${i + 1}`, kind: 'loose', mesh: meshData(p) }),
      );
    // Without the bottom plate the walls must also meet each other along the base:
    // a section just above the plate must be one connected area.
    const section = cut.slice(CHECKS.footprintHeight);
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
        mesh: meshData(keep(x.c.extrude(3))),
      }),
    );
    // Material the tile pockets had to remove: a wall or other part built into a tile's space.
    const pocketCut = chassis.pocketCut.volume();
    if (pocketCut > CHECKS.pocketCut)
      highlights.push({
        name: 'tile pocket cut',
        kind: 'hardware',
        mesh: meshData(chassis.pocketCut),
      });
    const result = keep(cut.add(chassis.base));
    // Every wall is solid apart from its slots, and every slot goes through.
    const walls = checkWalls(wasm, cut, chassis.wallWindows);
    for (const g of walls.gapSolids) highlights.push({ name: g.name, kind: 'wall', mesh: g.mesh });
    const seats: SeatCheck[] = [];
    for (const [name, m] of keyNodes) {
      // The seat must be a complete ring around the hole, with nothing outside its plane.
      const ring = keep(
        place(box([...outer, thickness], [0, 0, -thickness / 2]), m).subtract(
          place(box([...hole, 10]), m),
        ),
      );
      const missingSolid = keep(ring.subtract(result));
      const missing = Math.max(0, missingSolid.volume());
      const outside = keep(
        place(
          box([outer[0] - 0.02, outer[1] - 0.02, thickness + 1], [0, 0, -thickness / 2]),
          m,
        ).subtract(place(box([...outer, thickness + 0.02], [0, 0, -thickness / 2]), m)),
      );
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
    for (const p of hardware(project, nodes))
      if (['pcb', 'components', 'trackpad', 'adapter'].includes(p.group)) {
        const shape = p.cylinder
          ? keep(keep(M.cylinder(p.size[2], p.cylinder, p.cylinder, 64, true)).translate(p.center))
          : box(p.size, p.center);
        const v = collision(
          result,
          place(shape, new Matrix4().fromArray(p.matrix)),
          p.name,
          'hardware',
        );
        if (v > CHECKS.overlap) overlaps.push({ name: p.name, group: p.group, volume: v });
      }
    const keycaps: Clearance[] = [];
    const rests: Record<string, Manifold> = {};
    for (const [name, m] of keyNodes) {
      const size = capSize(cfg, name);
      const margin =
        (sw.keycap_clearance_overrides_mm as Record<string, number>)[name] ??
        sw.keycap_clearance_mm;
      const pressedBottom = sw.keycap_bottom_above_plate_mm - sw.travel_mm;
      const rest = (rests[name] = place(
        box(size, [0, 0, sw.keycap_bottom_above_plate_mm + size[2] / 2]),
        m,
      ));
      // The keycap over its full travel, grown by its clearance.
      const sweep = place(
        box(
          [size[0] + 2 * margin, size[1] + 2 * margin, size[2] + sw.travel_mm],
          [0, 0, pressedBottom + (size[2] + sw.travel_mm) / 2],
        ),
        m,
      );
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
    const layout = cfg.geometry;
    const extra = (
      (layout as { thumb_extra?: { keys: { name: string }[] } }).thumb_extra?.keys ?? []
    ).map((k) => 'thumb_' + k.name);
    const groups: [string, string[]][] = [
      ['fingers', Object.keys(rests).filter((n) => n.startsWith('matrix_'))],
      ['thumbs', layout.thumb.keys.map((k) => 'thumb_' + k.name)],
      ['extra thumbs', extra],
    ];
    const unions = groups
      .filter(([, ns]) => ns.length)
      .map(([label, ns]) => [label, keep(M.union(ns.map((n) => rests[n])))] as const);
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
      pocketCut <= CHECKS.pocketCut &&
      walls.checks.every((w) => w.passed) &&
      capGaps.every((c) => c.gap > 0) &&
      openings.every((o) => o.removed > CHECKS.empty && o.covered === 9 && o.blocked === 0);
    return {
      mesh,
      base: meshData(chassis.base),
      trackpad: meshData(keep(trackpadPart(wasm, cfg, nodes))),
      highlights,
      report: {
        seats,
        passed,
        keycaps,
        capGaps,
        pieces: pieces.map((p) => p.volume()),
        footprint: footprint.map((x) => x.a),
        pocketCut,
        hardware: overlaps,
        openings,
        walls: walls.checks,
        volume: result.volume(),
        triangles: mesh.indices.length / 3,
        milliseconds: performance.now() - start,
        notes: [
          'Component/keycap envelopes are conservative boxes.',
          'Flat seats and clip reliefs are generated. PCB retainers remain unimplemented. Minimum thickness and global self-intersections are not certified.',
        ],
      },
    };
  } finally {
    for (const m of [...all].reverse()) m.delete();
  }
}
