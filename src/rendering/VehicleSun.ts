import { DirectionalLight, Vector3 } from "three";
import type { Vec3 } from "../vehicle/types";

const SUN_OFFSET = new Vector3(-18, 32, 16);
const BACK = SUN_OFFSET.clone().normalize();
const RIGHT = new Vector3(0, 1, 0).cross(BACK).normalize();
const UP = BACK.clone().cross(RIGHT);

/** A local shadow volume follows the car; its light-space texel grid stays world-aligned. */
export class VehicleSun {
  readonly light = new DirectionalLight(0xffeed8, 4.1);
  private readonly anchor = new Vector3();

  constructor() {
    const { light } = this;
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, {
      left: -18,
      right: 18,
      top: 18,
      bottom: -18,
      near: 0.5,
      far: 90,
    });
    light.shadow.camera.updateProjectionMatrix();
    light.shadow.normalBias = 0.025;
    light.shadow.bias = -0.00012;
    this.update(new Vector3());
  }

  update(position: Vec3) {
    const { light } = this;
    const camera = light.shadow.camera;
    const texelX = (camera.right - camera.left) / light.shadow.mapSize.x;
    const texelY = (camera.top - camera.bottom) / light.shadow.mapSize.y;
    this.anchor.copy(position);
    const x = this.anchor.dot(RIGHT),
      y = this.anchor.dot(UP),
      z = this.anchor.dot(BACK);
    this.anchor
      .copy(RIGHT)
      .multiplyScalar(Math.round(x / texelX) * texelX)
      .addScaledVector(UP, Math.round(y / texelY) * texelY)
      .addScaledVector(BACK, z);
    light.target.position.copy(this.anchor);
    light.position.copy(this.anchor).add(SUN_OFFSET);
  }

  dispose() {
    this.light.shadow.dispose();
  }
}
