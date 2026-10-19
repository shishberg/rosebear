import { Matrix4 } from 'three';
import { gluePosts, postAxes } from './chassis';
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
  /** A box's corners (along its z axis) are notched: a round of this radius centred on each is cut out. */
  notch?: number;
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
  const axes = postAxes(cfg, nodes);
  const glue = [0, 1].map((axis) => gluePosts(cfg, axis).glue);
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
      parts[parts.length - 1].notch = tile.corner_notch_radius_mm;
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
      // The glue between the tile and its glue posts: under their shelves and
      // between its edges and their legs.
      for (const b of glue[axes[name]]) add(name + ': glue', 'glue', b.size, b.center, m);
    }
  parts.push(...adapterParts(cfg, nodes, panel), ...padParts(cfg, nodes));
  return parts;
}
