// Draws the hand (capsules and a palm hull) into a three.js group.
import * as T from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import {
  type Chain,
  FINGERS,
  type Finger,
  type Pose,
  Z,
  arcPoint,
  printAngle,
  thumb,
} from './model';
import { fingerPart, palmPoints, thumbPart } from './check';

const skin = new T.MeshStandardMaterial({
  color: 0xe8b48f,
  roughness: 0.7,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
});
const palmSkin = skin.clone();
palmSkin.opacity = 0.25;
function capsule(a: T.Vector3, b: T.Vector3, r: number) {
  const m = new T.Mesh(new T.CapsuleGeometry(r, Math.max(a.distanceTo(b), 0.01), 4, 12), skin);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}
export function drawHand(
  group: T.Group,
  chains: Record<Finger, Chain>,
  th: ReturnType<typeof thumb>,
) {
  // Redrawn every frame while the thumb presses, so the old shapes go.
  group.traverse((o) => {
    if (o instanceof T.Mesh || o instanceof T.Line) {
      o.geometry.dispose();
      if (o.material !== skin && o.material !== palmSkin) (o.material as T.Material).dispose();
    }
  });
  group.clear();
  // The same shapes the check uses.
  for (const part of [
    ...FINGERS.map((f) => fingerPart(f, { chain: chains[f], n: Z } as Pose, [])),
    thumbPart(th, []),
  ])
    for (const [a, b, r] of part.segs) group.add(capsule(a, b, r));
  const mcp = Object.fromEntries(FINGERS.map((f) => [f, chains[f].mcp])) as Record<
    Finger,
    T.Vector3
  >;
  group.add(new T.Mesh(new ConvexGeometry(palmPoints(mcp, th)), palmSkin));
  const from = printAngle('2') - 15,
    to = printAngle('4') + 15,
    pts = Array.from({ length: 41 }, (_, i) => arcPoint(from + ((to - from) * i) / 40));
  group.add(
    new T.Line(
      new T.BufferGeometry().setFromPoints(pts),
      new T.LineDashedMaterial({
        color: 0xffd060,
        dashSize: 3,
        gapSize: 2,
        transparent: true,
        depthTest: false,
      }),
    ).computeLineDistances(),
  );
}
