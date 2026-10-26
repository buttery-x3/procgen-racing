import type { Vec3 } from "../../vehicle/types";
import type { BarrierPath, ServiceRoad, PitLane } from "./types";
import { smooth, wrap } from "../Alignment";

export function pitOffset(pit: PitLane, station: number, length: number) {
  const s = wrap(station + length / 2, length) - length / 2;
  if (s < pit.entry || s > pit.exit) return 0;
  return (
    pit.joinOffset +
    (pit.offset - pit.joinOffset) *
      Math.min(
        smooth((s - pit.entry) / pit.mergeLength),
        smooth((pit.exit - s) / pit.mergeLength),
      )
  );
}
export function roadDistance(road: ServiceRoad, x: number, z: number) {
  let best = Infinity,
    height = 0;
  for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1],
      b = road.points[i],
      dx = b.x - a.x,
      dz = b.z - a.z;
    const t = Math.max(
      0,
      Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)),
    );
    const d = Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
    if (d < best) {
      best = d;
      height = a.y + (b.y - a.y) * t;
    }
  }
  return { distance: best, height };
}
/** Welded solid extrusion. Adjacent panels share vertices and have capped ends;
 * chassis collision and rendering use these exact positions/triangles. */
export function barrierGeometry(path: BarrierPath) {
  const points = path.closed ? path.points.slice(0, -1) : path.points,
    n = points.length,
    vertices: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)],
      b = points[i],
      c = points[Math.min(n - 1, i + 1)];
    const previous = path.closed ? points[(i - 1 + n) % n] : a,
      next = path.closed ? points[(i + 1) % n] : c;
    let dx = next.x - previous.x,
      dz = next.z - previous.z,
      d = Math.hypot(dx, dz);
    dx /= d;
    dz /= d;
    const half = path.width / 2;
    for (const h of [-0.16, path.height])
      for (const side of [-1, 1])
        vertices.push(b.x + dz * half * side, b.y + h, b.z - dx * half * side);
  }
  const add = (a: number, b: number, c: number, d: number) =>
    indices.push(a, b, c, b, d, c);
  for (let i = 0; i < (path.closed ? n : n - 1); i++) {
    const a = i * 4,
      b = ((i + 1) % n) * 4;
    add(a, b, a + 2, b + 2);
    add(a + 1, a + 3, b + 1, b + 3);
    add(a + 2, b + 2, a + 3, b + 3);
    add(a, a + 1, b, b + 1);
  }
  if (!path.closed) {
    add(0, 2, 1, 3);
    const a = (n - 1) * 4;
    add(a, a + 1, a + 2, a + 3);
  }
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
  };
}
export function pointInPad(
  point: { x: number; z: number },
  pad: {
    centre: { x: number; z: number };
    forward: { x: number; z: number };
    width: number;
    length: number;
  },
  margin = 0,
) {
  const dx = point.x - pad.centre.x,
    dz = point.z - pad.centre.z;
  return (
    Math.abs(dx * pad.forward.x + dz * pad.forward.z) <
      pad.length / 2 + margin &&
    Math.abs(dx * pad.forward.z - dz * pad.forward.x) < pad.width / 2 + margin
  );
}
export const vec = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });
