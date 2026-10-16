// Handle positions, drag rules and the number fields behind them. No DOM or
// scene, so node tests can reach it. A key handle ignores sideways movement;
// the X offset field moves a column.
import * as T from 'three';
import {
  clone,
  componentFrames,
  tentFrame,
  ROWS,
  type Project,
  type V3,
  type Cluster,
} from './geometry';

export type Cfg = Project['config'];
type ClusterKey = 'thumb' | 'thumb_extra';
const clusterOf = (c: Cfg, k: ClusterKey) =>
  (c.geometry as unknown as Record<ClusterKey, Cluster | undefined>)[k];
export const clusters = (c: Cfg) =>
  (['thumb', 'thumb_extra'] as ClusterKey[]).filter((k) => clusterOf(c, k));
const tentRotation = (c: Cfg) => {
  const t = tentFrame(c);
  t.setPosition(0, 0, 0);
  return t;
};
const toLayout = (c: Cfg, d: T.Vector3) => d.clone().applyMatrix4(tentRotation(c).invert());
const world = (c: Cfg, p: number[]) => new T.Vector3(...(p as V3)).applyMatrix4(tentFrame(c));
const TURN = 40;
export function handles(p: Project) {
  const c = p.config,
    frames = componentFrames(c),
    out: { id: string; kind: 'key' | 'cluster' | 'turn'; at: T.Vector3 }[] = [];
  for (const [n, m] of Object.entries(frames))
    if (n.startsWith('matrix_'))
      out.push({ id: 'key:' + n, kind: 'key', at: new T.Vector3().setFromMatrixPosition(m) });
  for (const k of clusters(c)) {
    const cl = clusterOf(c, k)!,
      root = new T.Vector3(...(cl.position_mm as V3)),
      a = (cl.rotation_deg[2] * Math.PI) / 180;
    out.push({ id: 'cluster:' + k, kind: 'cluster', at: world(c, root.toArray()) });
    // In front of the cluster centre, in layout plan, along the cluster's own -Y.
    out.push({
      id: 'turn:' + k,
      kind: 'turn',
      at: world(c, [root.x + Math.sin(a) * TURN, root.y - Math.cos(a) * TURN, root.z]),
    });
  }
  return out;
}
// The layout axis nearest the view direction is left unchanged, so a drag in
// the top view never changes a height, whatever the tent.
export function dragTo(
  base: Project,
  id: string,
  delta: T.Vector3,
  start: T.Vector3,
  view: T.Vector3,
): Project {
  const p = clone(base),
    c = p.config,
    d = toLayout(c, delta),
    v = toLayout(c, view),
    axis = [0, 1, 2].reduce(
      (a, i) => (Math.abs(v.getComponent(i)) > Math.abs(v.getComponent(a)) ? i : a),
      0,
    );
  d.setComponent(axis, 0);
  if (id.startsWith('key:')) {
    const [, col, row] = id.slice(4).split('_'),
      column = c.geometry.columns.find((x) => x.name === col)!;
    column.heights_mm[ROWS.indexOf(row as (typeof ROWS)[number])] += d.z;
    column.offset_mm[1] += d.y;
  } else if (id.startsWith('cluster:')) {
    const cl = clusterOf(c, id.slice(8) as ClusterKey)!;
    cl.position_mm = cl.position_mm.map((x, i) => x + d.getComponent(i));
  } else if (id.startsWith('turn:')) {
    const cl = clusterOf(c, id.slice(5) as ClusterKey)!,
      o = world(c, cl.position_mm),
      s = toLayout(c, start.clone().sub(o)),
      e = toLayout(c, start.clone().add(delta).sub(o));
    cl.rotation_deg[2] += ((Math.atan2(e.y, e.x) - Math.atan2(s.y, s.x)) * 180) / Math.PI;
  }
  return p;
}
// Number fields for the selected handle: [label, path into the config].
export type Field = [string, (string | number)[]];
export function fields(id: string, config: Cfg): { title: string; list: Field[] } {
  if (id.startsWith('key:')) {
    const [, col] = id.slice(4).split('_'),
      i = config.geometry.columns.findIndex((x) => x.name === col),
      b = ['geometry', 'columns', i];
    return {
      title: `${col} column`,
      list: [
        ['X offset mm', [...b, 'offset_mm', 0]],
        ['Stagger mm', [...b, 'offset_mm', 1]],
        ...ROWS.map((r, j) => [`${r} key height mm`, [...b, 'heights_mm', j]] as Field),
        ['Sideways tilt °', [...b, 'roll_deg']],
        ['Splay °', [...b, 'rotation_deg', 2]],
      ],
    };
  }
  if (id.startsWith('cluster:') || id.startsWith('turn:')) {
    const k = id.split(':')[1],
      b = ['geometry', k];
    return {
      title: k === 'thumb' ? 'thumb cluster' : 'extra thumb row',
      list: [
        ['Centre X mm', [...b, 'position_mm', 0]],
        ['Centre Y mm', [...b, 'position_mm', 1]],
        ['Centre Z mm', [...b, 'position_mm', 2]],
        ['Angle °', [...b, 'rotation_deg', 2]],
        ['Tilt about X °', [...b, 'rotation_deg', 0]],
        ['Tilt about Y °', [...b, 'rotation_deg', 1]],
        ['Arc radius mm', [...b, 'arc', 'radius_mm']],
        ['Key spacing °', [...b, 'arc', 'step_deg']],
        ['Well ° per key', [...b, 'arc', 'well_deg']],
      ],
    };
  }
  return { title: '', list: [] };
}
export const getAt = (o: unknown, path: (string | number)[]) =>
  path.reduce((x: any, k) => x?.[k], o) as number;
export const setAt = (o: unknown, path: (string | number)[], v: number) => {
  const last = path.at(-1)!;
  (path.slice(0, -1).reduce((x: any, k) => x[k], o) as any)[last] = v;
};
