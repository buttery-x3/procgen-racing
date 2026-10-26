import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import { cabinDimensions, cabinGeometry } from "../src/rendering/CabinGeometry";
import { ChaseCamera } from "../src/rendering/ChaseCamera";
import { VehiclePresentation } from "../src/rendering/VehiclePresentation";
import { VehicleSun } from "../src/rendering/VehicleSun";
import { REFERENCE_CARS } from "../src/vehicle/referenceCars";
import { FIXED_STEP, WHEEL_IDS } from "../src/vehicle/types";
import type { VehicleTelemetry } from "../src/vehicle/types";

describe("cabin geometry", () => {
  it.each(Object.keys(REFERENCE_CARS) as (keyof typeof REFERENCE_CARS)[])(
    "keeps the %s windows symmetric and the roof aligned as dimensions change",
    (id) => {
      for (const dimensions of [
        { wheelbase: 2.1, trackWidth: 1.35 },
        { wheelbase: 3.3, trackWidth: 1.95 },
        {},
      ]) {
        const setup = { ...REFERENCE_CARS[id].setup, ...dimensions };
        const shape = cabinDimensions(setup);
        const geometry = cabinGeometry(shape);
        const positions = geometry.getAttribute("position");
        const vertices = Array.from({ length: positions.count }, (_, i) =>
          new Vector3().fromBufferAttribute(positions, i),
        );
        for (const point of vertices) {
          // A diagonal, stretched diamond fails this reflection check.
          expect(
            vertices.some(
              (v) =>
                v.distanceTo(new Vector3(-point.x, point.y, point.z)) < 1e-6,
            ),
          ).toBe(true);
          const top = Math.abs(point.y - shape.top) < 1e-6;
          expect(Math.abs(point.x)).toBeCloseTo(
            (top ? shape.roofWidth : shape.baseWidth) / 2,
            6,
          );
          expect(Math.abs(point.z - shape.centreZ)).toBeCloseTo(
            (top ? shape.roofLength : shape.baseLength) / 2,
            6,
          );
        }
        // Each four-vertex window is planar; its two triangles cannot form a twisted quad.
        for (let face = 0; face < 6; face++) {
          const [a, b, c, d] = vertices.slice(face * 4, face * 4 + 4);
          const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
          expect(Math.abs(d.clone().sub(a).dot(normal))).toBeLessThan(1e-6);
        }
        geometry.dispose();
      }
    },
  );
});

function frameAt(
  time: number,
): Pick<VehicleTelemetry, "position" | "rotation" | "wheels"> {
  return {
    position: { x: 0, y: 0.4, z: time * 20 },
    rotation: new Quaternion(),
    wheels: WHEEL_IDS.map((id, i) => ({
      id,
      grounded: true,
      length: 0.4 + time * 0.01,
      compression: 0.03,
      compressionRatio: 0.1,
      load: 3000,
      lateralSpeed: 0,
      longitudinalSpeed: 20,
      slipAngle: 0,
      steer: time * 0.03,
      spin: time * 80,
      angularSpeed: 80,
      slipRatio: 0,
      longitudinalForce: 0,
      lateralForce: 0,
      driveTorque: 0,
      brakeTorque: 0,
      surfaceGrip: 1,
      surface: "asphalt",
      absActive: false,
      tractionActive: false,
      mount: { x: i % 2 ? -0.8 : 0.8, y: 0.45, z: time * 20 },
      hub: { x: i % 2 ? -0.8 : 0.8, y: 0.05 - time * 0.01, z: time * 20 },
      contact: { x: i % 2 ? -0.8 : 0.8, y: 0, z: time * 20 },
      normal: { x: 0, y: 1, z: 0 },
    })),
  };
}

describe("render timing", () => {
  it.each([60, 100, 144])(
    "keeps wheels and chase view continuous at %i fps with 120 Hz physics",
    (fps) => {
      const visual = new VehiclePresentation();
      const chase = new ChaseCamera();
      const camera = new PerspectiveCamera(42, 16 / 9, 0.1, 250);
      const first = frameAt(0);
      chase.reset(first.position, first.rotation);
      const screenPositions: number[] = [];
      let wallTime = 0;
      for (let i = 0; i < 240; i++) {
        // Alternate frame lengths as well as the non-matching display/physics rates.
        const dt = (1 + ((i % 3) - 1) * 0.15) / fps;
        wallTime += dt;
        const tick = Math.floor(wallTime / FIXED_STEP);
        visual.remember(frameAt((tick - 1) * FIXED_STEP));
        const pose = visual.sample(
          frameAt(tick * FIXED_STEP),
          (wallTime - tick * FIXED_STEP) / FIXED_STEP,
        );
        const renderTime = wallTime - FIXED_STEP;
        expect(pose.position.z).toBeCloseTo(renderTime * 20, 8);
        expect(pose.wheels[0].length).toBeCloseTo(0.4 + renderTime * 0.01, 8);
        expect(pose.wheels[0].steer).toBeCloseTo(renderTime * 0.03, 8);
        expect(pose.wheels[0].spin).toBeCloseTo(renderTime * 80, 8);
        expect(pose.wheels[0].hub.z).toBeCloseTo(pose.position.z, 8);
        chase.update(pose.position, pose.rotation, dt);
        camera.position.copy(chase.position);
        camera.lookAt(chase.target);
        camera.updateMatrixWorld();
        const screen = pose.position
          .clone()
          .add(new Vector3(0, 0.7, 0))
          .project(camera);
        screenPositions.push((screen.y * 1080) / 2);
      }
      // A fixed point on a steadily translating car stays at the same screen pixel.
      expect(
        Math.max(...screenPositions) - Math.min(...screenPositions),
      ).toBeLessThan(0.001);
    },
  );

  it("resets interpolation history cleanly and preserves unwrapped wheel spin", () => {
    const visual = new VehiclePresentation();
    const before = frameAt(1),
      after = frameAt(1.1);
    visual.remember(before);
    expect(visual.sample(after, 0.5).wheels[0].spin).toBeCloseTo(84, 8);
    const reset = frameAt(0);
    visual.remember(reset);
    expect(visual.sample(reset, 0).position.z).toBe(0);
    expect(visual.sample(reset, 1).wheels[0].spin).toBe(0);
  });
});

function updateShadow(sun: VehicleSun, position: Vector3) {
  sun.update(position);
  sun.light.updateMatrixWorld();
  sun.light.target.updateMatrixWorld();
  sun.light.shadow.updateMatrices(sun.light);
}

describe("vehicle-following shadows", () => {
  it("contains the car and nearby ground far from the origin and at elevation", () => {
    const sun = new VehicleSun();
    for (const position of [
      new Vector3(0, 0.4, -22),
      new Vector3(320, 0.4, -400),
      new Vector3(-1500, 80, 2300),
    ]) {
      updateShadow(sun, position);
      for (const x of [-4, 4])
        for (const y of [-1, 3])
          for (const z of [-5, 5]) {
            expect(
              sun.light.shadow
                .getFrustum()
                .containsPoint(position.clone().add(new Vector3(x, y, z))),
            ).toBe(true);
          }
      expect(
        sun.light.position
          .clone()
          .sub(sun.light.target.position)
          .distanceTo(new Vector3(-18, 32, 16)),
      ).toBeLessThan(1e-9);
    }
    sun.dispose();
  });

  it("moves the shadow grid in whole texels to avoid subpixel swimming", () => {
    const sun = new VehicleSun();
    updateShadow(sun, new Vector3());
    const point = new Vector3(3, 0, 4);
    const before = point.clone().applyMatrix4(sun.light.shadow.matrix);
    for (const position of [
      new Vector3(0.005, 0, 0.01),
      new Vector3(2.123, 0.003, 5.789),
    ]) {
      updateShadow(sun, position);
      const after = point.clone().applyMatrix4(sun.light.shadow.matrix);
      const x = (after.x - before.x) * sun.light.shadow.mapSize.x;
      const y = (after.y - before.y) * sun.light.shadow.mapSize.y;
      expect(x).toBeCloseTo(Math.round(x), 7);
      expect(y).toBeCloseTo(Math.round(y), 7);
    }
    sun.dispose();
  });
});
