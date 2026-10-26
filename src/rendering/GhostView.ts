import { Group, Mesh, MeshBasicMaterial } from "three";
import type { GhostPose } from "../race/Ghost";
import type { ResolvedCar } from "../vehicle/CarDefinition";

/** Shares the active car's geometry only; never creates a physics body. */
export class GhostView {
  readonly group = new Group();
  readonly material = new MeshBasicMaterial({
    color: 0xa0dce2,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  private model?: Group;
  private wheels: Group[] = [];
  private spinners: Group[] = [];
  private spec?: ResolvedCar;
  constructor() {
    this.group.visible = false;
  }
  build(source: Group, spec: ResolvedCar) {
    this.group.clear();
    this.spec = spec;
    this.model = source.clone(true);
    this.model.position.set(0, 0, 0);
    this.model.quaternion.identity();
    this.model.traverse((o) => {
      if (o instanceof Mesh) {
        o.material = this.material;
        o.castShadow = false;
        o.receiveShadow = false;
        o.renderOrder = 3;
      }
    });
    this.wheels = Array.from(
      { length: 4 },
      (_, i) => this.model!.getObjectByName(`wheel-${i}`) as Group,
    );
    this.spinners = Array.from(
      { length: 4 },
      (_, i) => this.model!.getObjectByName(`spinner-${i}`) as Group,
    );
    this.group.add(this.model);
  }
  update(pose: GhostPose | null) {
    this.group.visible = !!pose;
    if (!pose || !this.model || !this.spec) return;
    this.group.position.copy(pose.position);
    this.group.quaternion.copy(pose.rotation);
    for (let i = 0; i < 4; i++) {
      this.wheels[i].position.y = this.spec.dimensions.mountY - pose.lengths[i];
      this.wheels[i].rotation.y = i < 2 ? -pose.steers[i] : 0;
      this.spinners[i].rotation.x = pose.spins[i];
    }
  }
  dispose() {
    this.group.clear();
    this.group.removeFromParent();
    this.material.dispose();
    this.wheels = [];
    this.spinners = [];
  }
}
