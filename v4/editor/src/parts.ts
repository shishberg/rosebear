import { Matrix4 } from 'three';
import { gluePads } from './chassis';
import { adapterParts, padParts } from './wiring';
import {
  capSize,
  capTop,
  componentFrames,
  isKey,
  tilePartCentre,
  tileTop as tileTopOf,
  type Project,
  type V3,
} from './geometry';

/** A hardware box (or cylinder) in a key's or the board's frame, for the collision checks and the parts list. */
export interface Part {
  name: string;
  group: string;
  size: V3;
  center: V3;
  matrix: number[];
  cylinder?: number;
  /** A tapered box's top face (x, y): it narrows from size at its bottom. */
  top?: [number, number];
  /** Round holes through a box along its z axis: centres in its x and y. */
  holes?: { at: number[]; diameter: number }[];
}
export function hardware(
  project: Project,
  nodes = componentFrames(project.config),
  /** The port panel's end face in world x, from a build. */
  panel?: number,
): Part[] {
  const cfg = project.config;
  const parts: Part[] = [];
  const tile = cfg.tile;
  const sw = cfg.switch;
  // The tile's top, below the plate top.
  const tileTop = tileTopOf(cfg);
  const glue = gluePads(cfg);
  const glueLayer = glue.bottom - tileTop;
  const add = (
    name: string,
    group: string,
    size: number[],
    center: number[],
    m: Matrix4,
    cylinder?: number,
    top?: [number, number],
  ) =>
    parts.push({
      name,
      group,
      top,
      size: size as V3,
      center: center as V3,
      matrix: m.elements.slice(),
      cylinder,
    });
  for (const [name, m] of Object.entries(nodes))
    if (isKey(name)) {
      add(name, 'pcb', tile.size_mm, [0, 0, tileTop - tile.size_mm[2] / 2], m);
      for (const c of tile.components)
        add(name + ': ' + c.name, 'components', c.size_mm, tilePartCentre(cfg, c), m);
      add(name, 'switch', sw.body_mm, [0, 0, sw.body_mm[2] / 2 - sw.body_below_plate_mm], m);
      const cap = capSize(cfg, name);
      add(
        name,
        'keycaps',
        cap,
        [0, 0, sw.keycap_bottom_above_plate_mm + cap[2] / 2],
        m,
        undefined,
        capTop(cfg, name),
      );
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
  parts.push(...adapterParts(cfg, nodes, panel), ...padParts(cfg, nodes));
  return parts;
}
