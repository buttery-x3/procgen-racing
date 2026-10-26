import { Vector3, Quaternion } from "three";
import type { Rotation, Vec3 } from "./types";

/** Right-handed renderer coordinates: +Z forward, +Y up means physical right is -X. */
export const wheelSide = (index: number) => (index % 2 === 0 ? 1 : -1);
export function signedForwardSpeed(velocity: Vec3, rotation: Rotation) {
  return new Vector3(velocity.x, velocity.y, velocity.z).dot(
    new Vector3(0, 0, 1).applyQuaternion(
      new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    ),
  );
}
export function steeringAngles(
  command: number,
  wheelbase: number,
  track: number,
): [number, number] {
  if (Math.abs(command) < 0.0001) return [0, 0];
  const radius = wheelbase / Math.tan(Math.abs(command));
  const inner = Math.atan(wheelbase / Math.max(radius - track / 2, 0.5));
  const outer = Math.atan(wheelbase / (radius + track / 2));
  return command > 0 ? [outer, inner] : [-inner, -outer];
}
export function chasePose(position: Vec3, rotation: Rotation) {
  const forward = new Vector3(0, 0, 1).applyQuaternion(
    new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
  );
  forward.y = 0;
  forward.normalize();
  const origin = new Vector3(position.x, position.y, position.z);
  return {
    position: origin
      .clone()
      .addScaledVector(forward, -7.8)
      .add(new Vector3(0, 3.1, 0)),
    target: origin
      .clone()
      .addScaledVector(forward, 1.7)
      .add(new Vector3(0, 0.45, 0)),
  };
}
