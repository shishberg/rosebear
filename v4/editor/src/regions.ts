import type { Manifold } from 'manifold-3d';
import { Matrix4, Vector3 } from 'three';
import { box, place, type Factory } from './manifold-util';

/** A box about a key in its frame: `half` wide and deep either side of it, and
 * the RegionIndex's height either side of its plane. */
export interface Region {
  frame: Matrix4;
  half: number[];
  /** Regions of one group share a chunk. */
  group: string;
}

/**
 * Cuts each region's surroundings out of a large shape once, so a test of a
 * small shape inside it runs against a fraction of the mesh: a boolean costs
 * as much as its larger mesh, however small the other is. The result is the
 * same as testing against the whole. Each key's piece is cut from its group's
 * chunk (a column or thumb row), itself cut from the whole once: cutting costs
 * as much as what is cut from.
 */
export class RegionIndex {
  private readonly regions: (Omit<Region, 'group'> & {
    inverse: Matrix4;
    group: { lo: number[]; hi: number[]; chunks: Map<Manifold, Manifold> };
    pieces: Map<Manifold, Manifold>;
  })[];
  private readonly groups = new Map<
    string,
    { lo: number[]; hi: number[]; chunks: Map<Manifold, Manifold> }
  >();

  /** `pad` grows each group's chunk past its regions' corners. */
  constructor(
    private readonly M: Factory,
    regions: Region[],
    private readonly height: number,
    pad: number,
  ) {
    this.regions = regions.map((r) => {
      let group = this.groups.get(r.group);
      if (!group)
        this.groups.set(
          r.group,
          (group = {
            lo: [Infinity, Infinity, Infinity],
            hi: [-Infinity, -Infinity, -Infinity],
            chunks: new Map(),
          }),
        );
      for (let i = 0; i < 8; i++) {
        const c = new Vector3(
          i & 1 ? r.half[0] : -r.half[0],
          i & 2 ? r.half[1] : -r.half[1],
          i & 4 ? height : -height,
        ).applyMatrix4(r.frame);
        c.toArray().forEach((x, k) => {
          group.lo[k] = Math.min(group.lo[k], x - pad);
          group.hi[k] = Math.max(group.hi[k], x + pad);
        });
      }
      return {
        ...r,
        inverse: r.frame.clone().invert(),
        group,
        pieces: new Map<Manifold, Manifold>(),
      };
    });
  }

  /**
   * `target` cut down to the first region that holds all of `envelope`, or
   * `target` itself when none does.
   */
  within(target: Manifold, envelope: Manifold): Manifold {
    // The envelope's corners, not its bounding box's: a tilted key's shapes are tilted too.
    const { vertProperties: v, numProp } = envelope.getMesh();
    const p = new Vector3();
    for (const r of this.regions) {
      let inside = true;
      for (let i = 0; inside && i < v.length; i += numProp) {
        p.set(v[i], v[i + 1], v[i + 2]).applyMatrix4(r.inverse);
        inside =
          Math.abs(p.x) <= r.half[0] && Math.abs(p.y) <= r.half[1] && Math.abs(p.z) <= this.height;
      }
      if (!inside) continue;
      let piece = r.pieces.get(target);
      if (!piece) {
        let chunk = r.group.chunks.get(target);
        if (!chunk) {
          const size = r.group.hi.map((h, k) => h - r.group.lo[k]);
          chunk = this.cut(
            target,
            box(
              this.M,
              size,
              r.group.lo.map((l, k) => l + size[k] / 2),
            ),
          );
          r.group.chunks.set(target, chunk);
        }
        const region = place(box(this.M, [...r.half.map((h) => 2 * h), 2 * this.height]), r.frame);
        r.pieces.set(target, (piece = this.cut(chunk, region)));
      }
      return piece;
    }
    return target;
  }

  /** Cut at once: left lazy, each test's intersect would fold into it and run against the whole again. */
  private cut = (target: Manifold, region: Manifold) => target.intersect(region).asOriginal();
}
