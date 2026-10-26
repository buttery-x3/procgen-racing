import { Vector3 } from "three";
import type { Vec3 } from "../vehicle/types";
export type CameraCast = (
  origin: Vec3,
  direction: Vec3,
  distance: number,
) => number | null;
/** Static-world collision queries exclude the active chassis. */
export function safeCamera(target: Vec3, desired: Vec3, cast: CameraCast) {
  const position = new Vector3().copy(desired),
    direction = position.clone().sub(target),
    distance = direction.length();
  if (distance > 0.05) {
    direction.divideScalar(distance);
    const hit = cast(target, direction, distance + 0.3);
    if (hit !== null)
      position
        .copy(target)
        .addScaledVector(direction, Math.max(0.3, hit - 0.45));
  }
  const origin = position.clone();
  origin.y += 3;
  const ground = cast(origin, { x: 0, y: -1, z: 0 }, 8);
  if (ground !== null)
    position.y = Math.max(position.y, origin.y - ground + 0.4);
  return position;
}
