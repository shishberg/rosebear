import type { Manifold, ManifoldToplevel, Mat4 } from 'manifold-3d';
import { Matrix4 } from 'three';
import { seatSettings } from './seats';
import { buildChassis, capSize, gluePads, isKey } from './chassis';
import { adapterParts, crossings, padParts, wiring, type Wiring } from './wiring';
import { componentFrames, validateProject, type V3, type MeshData, type Project } from './geometry';
export { capSize, isKey };
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
} as const;
export interface Part {
  name: string;
  group: string;
  size: V3;
  center: V3;
  matrix: number[];
  cylinder?: number;
  /** Round holes through a box along its z axis: centres in its x and y. */
  holes?: { at: number[]; diameter: number }[];
}
export function hardware(project: Project, nodes = componentFrames(project.config)): Part[] {
  const cfg = project.config;
  const parts: Part[] = [];
  const tile = cfg.tile;
  const sw = cfg.switch;
  // The tile's top, below the plate top.
  const tileTop = -tile.plate_top_to_pcb_top_mm;
  const glue = gluePads(cfg);
  const glueLayer = glue.bottom - tileTop;
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
      // The glue between the tile's top and the pads under the plate's corners.
      for (const b of glue.boxes)
        add(
          name + ': glue',
          'glue',
          [b.size[0], b.size[1], glueLayer],
          [b.center[0], b.center[1], glue.bottom - glueLayer / 2],
          m,
        );
    }
  parts.push(...adapterParts(cfg, nodes), ...padParts(cfg, nodes));
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
  openings: { name: string; removed: number; covered: number; blocked: number }[];
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
  trim: MeshData;
  report: Report;
  highlights: Highlight[];
  /** The routed wiring, which the editor draws with the chassis it was checked against. */
  wiring: Wiring;
}
function meshData(solid: Manifold): MeshData {
  const raw = solid.getMesh();
  const positions = new Float32Array((raw.vertProperties.length / raw.numProp) * 3);
  for (let i = 0; i < positions.length / 3; i++)
    for (let j = 0; j < 3; j++) positions[i * 3 + j] = raw.vertProperties[i * raw.numProp + j];
  return { positions, indices: new Uint32Array(raw.triVerts) };
}
// Every Manifold and CrossSection the chassis code makes during a build, so the
// build can free them all at the end. Unfreed, a build leaks most of a gigabyte
// of WebAssembly memory and the fourth one aborts.
type Handle = { delete(): void; isDeleted(): boolean };
let made: Set<Handle> | undefined;
const watched = new WeakSet<object>();
function watch(wasm: ManifoldToplevel) {
  if (watched.has(wasm)) return;
  watched.add(wasm);
  // wasm.Manifold wraps the real constructor, so its prototype isn't the one
  // the objects have; take that from an object of each kind.
  const samples = [wasm.Manifold.cube([1, 1, 1]), wasm.CrossSection.square([1, 1])];
  const protos = samples.map((x) => Object.getPrototypeOf(x) as Record<string, unknown>);
  for (const x of samples) x.delete();
  const ours = (x: unknown): boolean =>
    typeof x === 'object' && x !== null && protos.includes(Object.getPrototypeOf(x));
  const record = (x: unknown) => {
    if (!made) return;
    if (ours(x)) made.add(x as Handle);
    else if (Array.isArray(x)) for (const y of x) if (ours(y)) made.add(y as Handle);
  };
  const wrap = (o: Record<string, unknown>) => {
    for (const name of Object.getOwnPropertyNames(o)) {
      const f = o[name];
      if (
        typeof f !== 'function' ||
        name === 'constructor' ||
        name === 'delete' ||
        name === 'isDeleted'
      )
        continue;
      o[name] = function (this: unknown, ...args: unknown[]) {
        const r = f.apply(this, args);
        record(r);
        return r;
      };
    }
  };
  for (const c of [wasm.Manifold, wasm.CrossSection] as unknown as Record<string, unknown>[])
    wrap(c);
  for (const p of protos) wrap(p);
}
export function buildSolid(wasm: ManifoldToplevel, project: Project): BuildResult {
  watch(wasm);
  made = new Set();
  try {
    return build(wasm, project);
  } finally {
    for (const m of made) if (!m.isDeleted()) m.delete();
    made = undefined;
  }
}
function build(wasm: ManifoldToplevel, project: Project): BuildResult {
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
    keep(chassis.trim);
    for (const r of chassis.roomCuts) keep(r.cut);
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
    body = keep(keep(body.add(keep(M.union(seatPlates)))).subtract(keep(M.union(seatTrims))));
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
        mesh: meshData(keep(x.c.extrude(3))),
      }),
    );
    // Chassis built where a keycap goes, which its room had to remove.
    const roomCuts = chassis.roomCuts
      .map((r) => ({ name: r.name, volume: r.cut.volume(), cut: r.cut }))
      .filter((r) => r.volume > CHECKS.roomCut);
    for (const r of roomCuts)
      highlights.push({ name: `${r.name} keycap room`, kind: 'room', mesh: meshData(r.cut) });
    const result = keep(cut.add(chassis.base));
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
    // Hardware is checked against the chassis and its bottom section.
    const against: Record<string, Manifold> = {
      pcb: result,
      components: result,
      adapter: result,
      ribbon: result,
    };
    for (const p of hardware(project, nodes))
      if (against[p.group]) {
        let shape = p.cylinder
          ? keep(keep(M.cylinder(p.size[2], p.cylinder, p.cylinder, 64, true)).translate(p.center))
          : box(p.size, p.center);
        for (const h of p.holes ?? [])
          shape = keep(
            shape.subtract(
              keep(
                keep(M.cylinder(p.size[2] + 2, h.diameter / 2, h.diameter / 2, 32, true)).translate(
                  [h.at[0], h.at[1], p.center[2]],
                ),
              ),
            ),
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
    const wired = wiring(cfg, nodes);
    const tube = (points: number[][], d: number) =>
      keep(
        M.union(
          points
            .slice(1)
            .map((q, i) =>
              keep(
                M.hull(
                  [points[i], q].map((c) =>
                    keep(keep(M.sphere(d / 2, CHECKS.wireSides)).translate(c as V3)),
                  ),
                ),
              ),
            ),
        ),
      );
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
      if (
        !shapes.length ||
        volume(keep(M.union(shapes.map((x) => x.solid))), target) <= CHECKS.overlap
      )
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
    const padZ = -(cfg.tile.plate_top_to_pcb_top_mm + cfg.tile.size_mm[2]);
    const solder = misses(
      keyNodes.flatMap(([name, m]) =>
        cfg.tile.pads.list.map((p) => ({
          name: `${name}: ${p.name} pad, ${p.at_mm[1] > 0 ? 'back' : 'front'} edge`,
          solid: place(
            keep(
              keep(M.cylinder(reach, access / 2, access / 2, 24)).translate([
                p.at_mm[0],
                p.at_mm[1],
                padZ - reach - 0.01,
              ]),
            ),
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
      roomCuts.length === 0 &&
      capGaps.every((c) => c.gap > 0) &&
      openings.every((o) => o.removed > CHECKS.empty && o.covered === 9 && o.blocked === 0) &&
      wires.length === 0 &&
      crossed.length === 0 &&
      solder.length === 0;
    return {
      mesh,
      base: meshData(chassis.base),
      trim: meshData(chassis.trim),
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
  } finally {
    for (const m of [...all].reverse()) m.delete();
  }
}
