// Chassis: the C64-styled shell (shell/) with the key plates in its wells,
// built from the key poses.
// The shell is a hollow case parted along a groove all round: the case above
// it, and the bottom section below, which is the base the adapter stands on.
// In each well the plates make one sheet: each key's plate, joined to its
// neighbours' edge to edge, and reaching out on its other edges to the wall
// round the well. Under every plate a tile pocket is kept clear, open below
// to the hollow, so the tiles can be soldered from below with the base off.
// Each tile is glued up against four L-shaped pads under its plate's corners,
// outside the switch's seat; the pads set its height, and the glue holds it
// when a switch is pressed into its socket. The ribbon leaves through the port
// panel on the finger bin's inner end.
//
// Terms:
//  tile         the small bought PCB under each switch (hotswap socket, LED, diode);
//  tile pocket  the space under a plate kept clear for the tile and its parts;
//  plate        the square a switch clips into, plate_thickness_mm thick and
//               plate_margin_mm past the switch seat on each side, or further if
//               needed to cover the tile and its clearance;
//  glue pad     an L under a plate corner that a tile's top is glued to;
//  well         an opening through the shell's deck that a group of keys sits in.
//
// Coordinates: "key coordinates" are a key's own frame, with the origin at the
// plate top's centre, x and y across the plate and z along its normal (up is
// positive). A "half-width" is a distance from the key's centre along its x or y
// axis. "Plan" means the world XY plane.
import type { Manifold, ManifoldToplevel, Vec3 } from 'manifold-3d';
import { Matrix4 } from 'three';
import { keycapEnvelope, isKey, isThumb, point, tileUnderside, type Config } from './geometry';
import { seatSettings } from './seats';
import { facetFloor, narrowPlates, sheet, tilePocketHalf } from './plates';
import { capsule, down, keycapSolid, place, slab } from './manifold-util';
import { shell } from './shell';
import { wiring, type Wiring } from './wiring';

export interface ChassisResult {
  /** The case above the parting line, with the plates. */
  body: Manifold;
  /** The bottom section, below the parting line, with the adapter's mount. */
  base: Manifold;
  /** The port panel's dark insert, a separate part, with the ribbon's landing. */
  trim: Manifold;
  /** The port panel's end face, in world x. */
  panel: number;
  /** Where the case and the bottom section part. */
  split: number;
  /** For each key, the chassis its keycap's room (and the switch rim's) had to remove. */
  roomCuts: { name: string; cut: Manifold }[];
}

/**
 * Construction sizes that are not in the config, in mm. Distances are in key
 * coordinates unless noted.
 */
const SIZES = {
  /** Skirts stop this far above the parting line, as the walls round the wells do. */
  skirtFoot: 3.6,
  /** A wire's notch in a skirt has a radius this much more than the wire's. */
  skirtWireClear: 0.3,
  /** A skirt piece the notches leave is kept only if it overlaps the sheets or the case by this much (mm³). */
  skirtPiece: 0.5,
  /** Skirts keep this far clear of a tile's edge (plan): its edge pads, and a soldering iron's way up to them. */
  skirtClear: 1.5,
  /** The switch body and pins below the plate top: kept clear under the switch hole. */
  switchBelowPlate: 13,
  /** The keycap's room is this much wider than the cap plus its clearance, in total. */
  keycapRoomExtra: 0.2,
  /** The keycap room's height above the cap's lowest point. */
  keycapRoomHeight: 60,
  /** Glue pads: each leg of the L runs in from the tile's edge to this far from the centre along it. */
  glueFrom: 4,
  /** Glue pads stay this far outside the switch seat, so nothing stands in its trim. */
  glueSeatGap: 0.1,
  /** Glue pads reach this far up into the plate. */
  glueInto: 0.3,
  /** The glue between a pad and the tile's top. */
  glueLayer: 0.15,
  /** The adapter's rests stand this far in from its hole edge. */
  adapterRestIn: 7,
} as const;

/**
 * The glue pads under a key's plate, in key coordinates: four Ls, one under
 * each corner, from the plate's underside down to the glue on the tile's top.
 * Each is two boxes, [centre, size].
 */
export function gluePads(cfg: Config) {
  const tile = cfg.tile;
  const seat = seatSettings(cfg).outer;
  const plate = cfg.chassis.plate_thickness_mm;
  const top = -plate + SIZES.glueInto;
  const bottom = -tile.plate_top_to_pcb_top_mm + SIZES.glueLayer;
  const boxes: { center: Vec3; size: Vec3 }[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const axis of [0, 1]) {
        // One leg runs along the tile's edge facing axis, from glueFrom out to the edge.
        const edge = tile.size_mm[axis] / 2;
        const inner = seat[axis] / 2 + SIZES.glueSeatGap;
        const along = tile.size_mm[1 - axis] / 2;
        const lo: number[] = [];
        const hi: number[] = [];
        lo[axis] = inner;
        hi[axis] = edge;
        lo[1 - axis] = SIZES.glueFrom;
        hi[1 - axis] = along;
        const s = [sx, sy];
        boxes.push({
          center: [(s[0] * (lo[0] + hi[0])) / 2, (s[1] * (lo[1] + hi[1])) / 2, (top + bottom) / 2],
          size: [hi[0] - lo[0], hi[1] - lo[1], top - bottom],
        });
      }
  return { boxes, top, bottom };
}

/** The space under every plate for its tile and the switch body: cut out of the case. */
function pockets(
  M: ManifoldToplevel['Manifold'],
  cfg: Config,
  frames: Record<string, Matrix4>,
  keyNames: string[],
) {
  const plateThickness = cfg.chassis.plate_thickness_mm;
  const tile = cfg.tile;
  const sw = cfg.switch;
  // The tile, its components and the switch body, below the plate.
  const pocketDepth =
    -tileUnderside(cfg) +
    Math.max(0, ...tile.components.map((c) => c.size_mm[2] / 2 - c.center_mm[2])) +
    tile.component_clearance_mm;
  const pocketHalf = tilePocketHalf(cfg);
  return M.union(
    keyNames.flatMap((n) => [
      place(
        M.cube(
          [2 * pocketHalf[0], 2 * pocketHalf[1], pocketDepth - plateThickness],
          true,
        ).translate([0, 0, -(pocketDepth + plateThickness) / 2]),
        frames[n],
      ),
      place(
        M.cube(
          [
            sw.cutout_mm[0] + sw.cutout_clearance_mm,
            sw.cutout_mm[1] + sw.cutout_clearance_mm,
            SIZES.switchBelowPlate - plateThickness,
          ],
          true,
        ).translate([0, 0, -(SIZES.switchBelowPlate + plateThickness) / 2]),
        frames[n],
      ),
    ]),
  );
}

/**
 * The skirts round both wells' edges, under their plates. Each stops on the
 * other sheet, is notched where the wires pass, and drops any piece the
 * notches leave standing on its own.
 */
function skirts(
  M: ManifoldToplevel['Manifold'],
  cfg: Config,
  frames: Record<string, Matrix4>,
  keyNames: string[],
  fingers: ReturnType<typeof sheet>,
  thumbs: ReturnType<typeof sheet>,
  case_: Manifold,
  split: number,
  wired: Wiring,
) {
  const plateThickness = cfg.chassis.plate_thickness_mm;
  // Each tile, its edge pads and a soldering iron's way up to them (along the
  // key's axis) stay clear.
  const tileBottom = tileUnderside(cfg);
  const [hx, hy] = tilePocketHalf(cfg).map((h) => h + SIZES.skirtClear);
  const keepClear = M.union(
    keyNames.map((n) => {
      return M.hull(
        down(
          [-plateThickness, tileBottom, tileBottom - cfg.wiring.solder_access_mm[1]].flatMap((z) =>
            [-hx, hx].flatMap((x) => [-hy, hy].map((y) => point(frames[n], [x, y, z]))),
          ),
        ),
      );
    }),
  );
  const aboveFoot = M.cube([1000, 1000, 400]).translate([-500, -500, split + SIZES.skirtFoot]);
  const unnotched = M.union([
    fingers.skirt.subtract(thumbs.top),
    thumbs.skirt.subtract(fingers.top),
  ])
    .intersect(aboveFoot)
    .subtract(keepClear);
  // Only the wires' segments that come near a skirt notch it: a union of every
  // segment would cost more than everything else here.
  const near = unnotched.decompose().map((p) => p.boundingBox());
  const wireWays = M.union(
    wired.wires.flatMap((w) => {
      const r = w.diameter / 2 + SIZES.skirtWireClear;
      return w.points.slice(1).flatMap((q, i) => {
        const p = w.points[i];
        const reaches = near.some((b) =>
          [0, 1, 2].every(
            (k) => Math.min(p[k], q[k]) - r <= b.max[k] && Math.max(p[k], q[k]) + r >= b.min[k],
          ),
        );
        return reaches ? [capsule(M, p, q, r, 8)] : [];
      });
    }),
  );
  const sheetsAndCase = M.union([fingers.cores, thumbs.cores, fingers.rest, thumbs.rest, case_]);
  return M.union(
    unnotched
      .subtract(wireWays)
      .decompose()
      .filter((p) => p.intersect(sheetsAndCase).volume() > SIZES.skirtPiece),
  );
}

/**
 * Room above each plate: the switch hole, the switch housing's rim up to the
 * keycap's lowest point, and the keycap with its clearance above that (a box,
 * the cap's base wide, well above it). cutters removes it; roomCuts is what it
 * removes from where the rim and the keycap go (tapered as measured, from
 * pressed to rest, with its clearance), for the checks: chassis that was built
 * where a keycap goes. (The box's corners above the cap's taper are not.)
 */
function keycapRooms(
  M: ManifoldToplevel['Manifold'],
  cfg: Config,
  frames: Record<string, Matrix4>,
  keyNames: string[],
  uncarved: Manifold,
) {
  const sw = cfg.switch;
  const seat = seatSettings(cfg).outer;
  const capLowest = Math.max(0, sw.keycap_bottom_above_plate_mm - sw.travel_mm);
  const roomCuts: { name: string; cut: Manifold }[] = [];
  const cutters: Manifold[] = [];
  for (const n of keyNames) {
    const env = keycapEnvelope(cfg, n, { clampFloor: true });
    const room = place(
      M.cube(
        [
          env.base[0] + SIZES.keycapRoomExtra,
          env.base[1] + SIZES.keycapRoomExtra,
          SIZES.keycapRoomHeight,
        ],
        true,
      ).translate([0, 0, capLowest + SIZES.keycapRoomHeight / 2]),
      frames[n],
    );
    const rim =
      capLowest > 0.1
        ? place(
            M.cube([seat[0], seat[1], capLowest], true).translate([0, 0, capLowest / 2]),
            frames[n],
          )
        : undefined;
    const capGoes = place(keycapSolid(M, env), frames[n]);
    roomCuts.push({ name: n, cut: uncarved.intersect(rim ? capGoes.add(rim) : capGoes) });
    cutters.push(rim ? room.add(rim) : room);
  }
  return { cutters, roomCuts };
}

export function buildChassis(
  wasm: ManifoldToplevel,
  cfg: Config,
  frames: Record<string, Matrix4>,
  // The wires and the shell, when the caller has made them already.
  wired: Wiring = wiring(cfg, frames),
  built = shell({ wasm, cfg, frames }),
): ChassisResult {
  const M = wasm.Manifold;
  const keyNames = Object.keys(frames).filter(isKey);
  const [fingerWell, thumbWell] = built.wells;
  const fingers = sheet(
    M,
    cfg,
    frames,
    keyNames.filter((n) => n.startsWith('matrix_')),
    fingerWell,
    narrowPlates(cfg),
    facetFloor(cfg),
  );
  const thumbs = sheet(M, cfg, frames, keyNames.filter(isThumb), thumbWell);
  const bounds = built.body.boundingBox();
  const aboveSplit = M.cube([1000, 1000, bounds.max[2] - built.split + 1]).translate([
    -500,
    -500,
    built.split,
  ]);
  // The case, open under the plates.
  const case_ = built.body.subtract(
    M.union([fingers.rooms, thumbs.rooms]).intersect(aboveSplit).intersect(built.inside),
  );
  // Neither well's reaches and joins run on in under the other's sheet.
  const plates = M.union([
    fingers.cores,
    thumbs.cores,
    fingers.rest.subtract(thumbs.below),
    thumbs.rest.subtract(fingers.below),
    skirts(M, cfg, frames, keyNames, fingers, thumbs, case_, built.split, wired),
  ]);
  const solid = case_.add(plates);
  const glue = gluePads(cfg);
  const pads = M.union(
    keyNames.flatMap((n) =>
      glue.boxes.map((b) => place(M.cube(b.size, true).translate(b.center), frames[n])),
    ),
  );
  const uncarved = solid.subtract(pockets(M, cfg, frames, keyNames)).add(pads);
  const { cutters, roomCuts } = keycapRooms(M, cfg, frames, keyNames, uncarved);
  // All at once: one boolean against the whole case, not two per key.
  const whole = uncarved.subtract(M.union(cutters));
  // The case above the parting groove's bottom, and the bottom section below
  // it with the adapter's mount, less the ribbon's slot.
  const below = slab(M, whole.boundingBox(), 20, -1, built.split + 1);
  const base = whole
    .intersect(below)
    .add(adapterMount(wasm, cfg, frames))
    .subtract(built.slot);
  return {
    body: whole.subtract(below),
    base,
    trim: built.trim,
    panel: built.panel,
    split: built.split,
    roomCuts,
  };
}

/**
 * The adapter's mount on the bottom section: a boss with a peg through each of
 * its mounting holes and two rests under its other end. Each reaches half a
 * millimetre into the floor.
 */
function adapterMount(wasm: ManifoldToplevel, cfg: Config, frames: Record<string, Matrix4>) {
  const M = wasm.Manifold;
  const a = cfg.adapter;
  const [bx, by, bz] = a.board_mm;
  const into = 0.5;
  const post = (x: number, y: number, d: number, top: number) =>
    M.cylinder(top + a.standoff_mm + into, d / 2, d / 2, 32).translate([
      x,
      y,
      -a.standoff_mm - into,
    ]);
  return place(
    M.union([
      ...a.mounting_holes_mm.flatMap(([x, y]) => [
        post(x, y, a.boss_diameter_mm, 0),
        post(x, y, a.peg_diameter_mm, bz + a.peg_above_mm),
      ]),
      ...[-1, 1].map((s) =>
        post(bx / 2 - SIZES.adapterRestIn, s * (by / 2 - 2), a.rest_diameter_mm, 0),
      ),
    ]),
    frames.adapter,
  );
}
