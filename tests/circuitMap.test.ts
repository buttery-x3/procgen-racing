import { describe, it, expect } from "vitest";
import { Quaternion, Vector3 } from "three";
import { mapProjection } from "../src/workbench/CircuitMap";
import { getTestCircuit } from "../src/track/testCircuit";

describe("driving-map handedness", () => {
  it("keeps physical left on the left of the forward heading in every orientation", () => {
    const projection = mapProjection(getTestCircuit(), 220, 150);
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.73]) {
      const rotation = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        angle,
      );
      const f = new Vector3(0, 0, 1).applyQuaternion(rotation),
        l = new Vector3(1, 0, 0).applyQuaternion(rotation);
      const forward = projection.direction(f.x, f.z),
        left = projection.direction(l.x, l.z);
      // In screen coordinates (Y down), a physical left turn has negative cross product.
      expect(forward.x * left.y - forward.y * left.x).toBeLessThan(0);
    }
  });
  it("projects terrain, overlays and vehicle markers through one invertible map", () => {
    const projection = mapProjection(getTestCircuit(), 1000, 430, 65);
    for (const p of [
      { x: 0, z: 0 },
      { x: 120, z: -90 },
      { x: -14.2, z: 53.6 },
    ]) {
      const screen = projection.point(p.x, p.z),
        world = projection.world(screen.x, screen.y);
      expect(world.x).toBeCloseTo(p.x, 10);
      expect(world.z).toBeCloseTo(p.z, 10);
    }
  });
});
