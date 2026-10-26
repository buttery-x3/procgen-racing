import { Vector3 } from "three";
import { chasePose } from "../vehicle/coordinates";
import type { Rotation, Vec3 } from "../vehicle/types";

export class ChaseCamera {
  lookAhead = 1.7;
  readonly position = new Vector3();
  readonly target = new Vector3();
  private readonly offset = new Vector3();
  private readonly desiredOffset = new Vector3();

  reset(position: Vec3, rotation: Rotation) {
    const pose = chasePose(position, rotation);
    pose.target.addScaledVector(
      new Vector3(
        pose.target.x - position.x,
        0,
        pose.target.z - position.z,
      ).normalize(),
      this.lookAhead - 1.7,
    );
    this.position.copy(pose.position);
    this.target.copy(pose.target);
    this.offset.copy(pose.position).sub(position);
  }

  update(position: Vec3, rotation: Rotation, dt: number) {
    const pose = chasePose(position, rotation);
    pose.target.addScaledVector(
      new Vector3(
        pose.target.x - position.x,
        0,
        pose.target.z - position.z,
      ).normalize(),
      this.lookAhead - 1.7,
    );
    this.desiredOffset.copy(pose.position).sub(position);
    // Dampen heading changes, but follow translation exactly. Smoothing world positions
    // makes the car-camera distance depend on frame duration even at a constant speed.
    this.offset.lerp(this.desiredOffset, 1 - Math.exp(-9 * dt));
    this.position.copy(position).add(this.offset);
    this.target.copy(pose.target);
    return this;
  }
}
