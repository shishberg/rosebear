import type { CrossSection, Manifold } from 'manifold-3d';
import { Matrix4, Vector3 } from 'three';
import type { MeshData } from './geometry';

/**
 * How well each key's seat is held: the smallest cross-section of solid (mm²)
 * between the seat and the case's outside wall at the parting line, found as a
 * minimum cut through the solid on a voxel grid. A key hanging off a thin
 * strip shows that strip's section, however far from the key it is.
 *
 * The count stops at `need`: a key held by at least that much reports `need`.
 * A key held by less reports its cut, and the cut's faces to draw.
 */
export function supportCuts(
  solid: Manifold,
  /** The case's outside wall at the parting line, as a ring in plan. */
  edge: CrossSection,
  /** Voxels below this height, within the ring, are the case's wall. */
  wallTop: number,
  keys: { name: string; pose: Matrix4; half: number[]; thickness: number }[],
  need: number,
  voxel: number,
): { name: string; area: number; cut?: MeshData }[] {
  const b = solid.boundingBox();
  const n = [0, 1, 2].map((k) => Math.ceil((b.max[k] - b.min[k]) / voxel));
  const [nx, ny] = n;
  const at = (k: number, i: number) => b.min[k] + (i + 0.5) * voxel;
  // Each row's runs inside the polygons (nonzero winding), as a mask.
  const raster = (polys: number[][][] | [number, number][][], mask: Uint8Array) => {
    mask.fill(0);
    for (let j = 0; j < ny; j++) {
      const y = at(1, j);
      const xs: [number, number][] = [];
      for (const p of polys)
        for (let i = 0; i < p.length; i++) {
          const [x0, y0] = p[i];
          const [x1, y1] = p[(i + 1) % p.length];
          if (y0 <= y !== y1 <= y) xs.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1]);
        }
      xs.sort((p, q) => p[0] - q[0]);
      let w = 0;
      for (let s = 0; s < xs.length - 1; s++) {
        w += xs[s][1];
        if (!w) continue;
        const i0 = Math.max(0, Math.ceil((xs[s][0] - b.min[0]) / voxel - 0.5));
        const i1 = Math.min(nx - 1, Math.floor((xs[s + 1][0] - b.min[0]) / voxel - 0.5));
        for (let i = i0; i <= i1; i++) mask[j * nx + i] = 1;
      }
    }
  };
  const ring = new Uint8Array(nx * ny);
  raster(edge.toPolygons(), ring);
  // Solid voxels, numbered layer by layer, with their six neighbours
  // (-x, +x, -y, +y, -z, +z) and where they are.
  const nbr: number[] = [];
  const pos: number[] = [];
  const wall: number[] = [];
  const layer = new Uint8Array(nx * ny);
  let below = new Int32Array(nx * ny).fill(-1);
  let here = new Int32Array(nx * ny);
  let count = 0;
  for (let k = 0; k < n[2]; k++) {
    const z = at(2, k);
    raster(solid.slice(z).toPolygons(), layer);
    here.fill(-1);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (!layer[c]) continue;
        const id = (here[c] = count++);
        nbr.push(-1, -1, -1, -1, -1, -1);
        pos.push(i, j, k);
        const link = (other: number, d: number) => {
          if (other < 0) return;
          nbr[6 * id + d] = other;
          nbr[6 * other + (d ^ 1)] = id;
        };
        if (i) link(here[c - 1], 0);
        if (j) link(here[c - nx], 2);
        link(below[c], 4);
        if (z < wallTop && ring[c]) wall.push(id);
      }
    [below, here] = [here, below];
  }
  const N = count;
  const next = Int32Array.from(nbr);
  const isWall = new Uint8Array(N);
  for (const id of wall) isWall[id] = 1;
  const p = new Vector3();
  return keys.map(({ name, pose, half, thickness }) => {
    // The seat's voxels, found from the seat's corners' bounds.
    const inverse = pose.clone().invert();
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      p.set(c & 1 ? half[0] : -half[0], c & 2 ? half[1] : -half[1], c & 4 ? 0 : -thickness).applyMatrix4(pose);
      p.toArray().forEach((v, k) => {
        lo[k] = Math.min(lo[k], v);
        hi[k] = Math.max(hi[k], v);
      });
    }
    const sources: number[] = [];
    for (let id = 0; id < N; id++) {
      const x = at(0, pos[3 * id]);
      const y = at(1, pos[3 * id + 1]);
      const z = at(2, pos[3 * id + 2]);
      if (x < lo[0] || x > hi[0] || y < lo[1] || y > hi[1] || z < lo[2] || z > hi[2]) continue;
      p.set(x, y, z).applyMatrix4(inverse);
      if (Math.abs(p.x) <= half[0] && Math.abs(p.y) <= half[1] && p.z <= 0 && p.z >= -thickness)
        sources.push(id);
    }
    const units = Math.ceil(need / voxel ** 2);
    if (sources.some((id) => isWall[id])) return { name, area: need };
    // Dinic's max flow, one unit per voxel face.
    const flow = new Int8Array(6 * N);
    const level = new Int32Array(N);
    const arc = new Uint8Array(N);
    const queue = new Int32Array(N);
    const bfs = () => {
      level.fill(-1);
      let head = 0;
      let tail = 0;
      for (const s of sources) {
        level[s] = 0;
        queue[tail++] = s;
      }
      let reached = false;
      while (head < tail) {
        const u = queue[head++];
        if (isWall[u]) {
          reached = true;
          continue;
        }
        for (let d = 0; d < 6; d++) {
          const v = next[6 * u + d];
          if (v >= 0 && level[v] < 0 && flow[6 * u + d] < 1) {
            level[v] = level[u] + 1;
            queue[tail++] = v;
          }
        }
      }
      return reached;
    };
    let total = 0;
    const path = new Int32Array(N);
    while (total < units && bfs()) {
      arc.fill(0);
      for (const s of sources) {
        while (total < units && level[s] === 0) {
          // One unit along level-increasing faces with room, from s to the wall.
          let depth = 0;
          path[0] = s;
          let u = s;
          while (!isWall[u]) {
            let moved = false;
            for (; arc[u] < 6; arc[u]++) {
              const v = next[6 * u + arc[u]];
              if (v >= 0 && level[v] === level[u] + 1 && flow[6 * u + arc[u]] < 1) {
                path[++depth] = v;
                u = v;
                moved = true;
                break;
              }
            }
            if (moved) continue;
            // A dead end: drop it and step back.
            level[u] = -1;
            if (!depth) break;
            u = path[--depth];
            arc[u]++;
          }
          if (!isWall[u]) break;
          for (let i = 0; i < depth; i++) {
            const a = path[i];
            const d = arc[a];
            flow[6 * a + d]++;
            flow[6 * path[i + 1] + (d ^ 1)]--;
          }
          total++;
        }
      }
    }
    if (total >= units) return { name, area: need };
    // The cut: faces from what the seat still reaches to what it doesn't.
    const positions: number[] = [];
    const indices: number[] = [];
    for (let u = 0; u < N; u++) {
      if (level[u] < 0) continue;
      for (let d = 0; d < 6; d++) {
        const v = next[6 * u + d];
        if (v < 0 || level[v] >= 0 || flow[6 * u + d] < 1) continue;
        const axis = d >> 1;
        const c = [0, 1, 2].map((k) => at(k, pos[3 * u + k]));
        c[axis] += (d & 1 ? 0.5 : -0.5) * voxel;
        const [s, t] = [0, 1, 2].filter((k) => k !== axis);
        const base = positions.length / 3;
        for (const [ds, dt] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          const q = c.slice();
          q[s] += (ds * voxel) / 2;
          q[t] += (dt * voxel) / 2;
          positions.push(...q);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
    return {
      name,
      area: total * voxel ** 2,
      cut: { positions: new Float32Array(positions), indices: new Uint32Array(indices) },
    };
  });
}
