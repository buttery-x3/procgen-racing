import { MathUtils, Quaternion, Vector3 } from "three";
import type { VehicleTelemetry } from "../vehicle/types";

function wheelPose() {
  return {
    length: 0,
    steer: 0,
    spin: 0,
    mount: new Vector3(),
    hub: new Vector3(),
    contact: new Vector3(),
    forceEnd: new Vector3(),
  };
}

type VehicleFrame = Pick<VehicleTelemetry, "position" | "rotation" | "wheels">;

/** One render timestamp for the chassis, wheels, overlays and camera to share. */
export class VehiclePresentation {
  readonly position = new Vector3();
  readonly rotation = new Quaternion();
  readonly wheels = Array.from({ length: 4 }, wheelPose);
  private readonly previousPosition = new Vector3();
  private readonly previousRotation = new Quaternion();
  private readonly previousWheels = Array.from({ length: 4 }, wheelPose);
  private readonly currentRotation = new Quaternion();
  private readonly forceEnd = new Vector3();

  remember(frame: VehicleFrame) {
    this.previousPosition.copy(frame.position);
    this.previousRotation.copy(frame.rotation);
    frame.wheels.forEach((wheel, i) => {
      const previous = this.previousWheels[i];
      previous.length = wheel.length;
      previous.steer = wheel.steer;
      previous.spin = wheel.spin;
      previous.mount.copy(wheel.mount);
      previous.hub.copy(wheel.hub);
      previous.contact.copy(wheel.contact);
      previous.forceEnd
        .copy(wheel.contact)
        .addScaledVector(wheel.normal, wheel.load / 5000);
    });
  }

  sample(frame: VehicleFrame, alpha: number) {
    const t = MathUtils.clamp(alpha, 0, 1);
    this.position.lerpVectors(this.previousPosition, frame.position, t);
    this.rotation
      .copy(this.previousRotation)
      .slerp(this.currentRotation.copy(frame.rotation), t);
    frame.wheels.forEach((wheel, i) => {
      const previous = this.previousWheels[i],
        result = this.wheels[i];
      result.length = MathUtils.lerp(previous.length, wheel.length, t);
      result.steer = MathUtils.lerp(previous.steer, wheel.steer, t);
      // Spin is deliberately unwrapped: fast wheels may cross several turns between samples.
      result.spin = MathUtils.lerp(previous.spin, wheel.spin, t);
      result.mount.lerpVectors(previous.mount, wheel.mount, t);
      result.hub.lerpVectors(previous.hub, wheel.hub, t);
      result.contact.lerpVectors(previous.contact, wheel.contact, t);
      this.forceEnd
        .copy(wheel.contact)
        .addScaledVector(wheel.normal, wheel.load / 5000);
      result.forceEnd.lerpVectors(previous.forceEnd, this.forceEnd, t);
    });
    return this;
  }
}
