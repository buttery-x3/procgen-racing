import { beforeAll, describe, it, expect } from "vitest";
import {
  Mesh,
  MeshStandardMaterial,
  Matrix3,
  Quaternion,
  Matrix4,
  Vector3,
} from "three";
import {
  CAR_FAMILIES,
  resolveCar,
  mechanicsFingerprint,
  decodeCarDefinition,
} from "../src/vehicle/CarDefinition";
import {
  generateCar,
  ARCHETYPES,
  DEFAULT_CAR_RECIPE,
  retainCarTuning,
} from "../src/vehicle/generateCar";
import { createCarBody, sectionGeometry } from "../src/rendering/CarGeometry";
import { validateCarPhysics } from "../src/vehicle/validateCarPhysics";
import { initializePhysics, SuspensionRig } from "../src/physics/SuspensionRig";
import { DEFAULT_SETUP, sanitizeSetup } from "../src/vehicle/setup";

beforeAll(initializePhysics);
describe("M6 coherent procedural vehicles", () => {
  it("closes lofts with outward faces and gives independent corner changes physical effect", () => {
    const geometry = sectionGeometry([
        { z: -1, halfWidth: 1, bottom: -1, top: 1 },
        { z: 1, halfWidth: 1, bottom: -1, top: 1 },
      ]),
      p = geometry.getAttribute("position"),
      index = geometry.index!;
    let volume = 0;
    for (let i = 0; i < index.count; i += 3) {
      const points = [0, 1, 2].map((j) =>
        new Vector3().fromBufferAttribute(p, index.getX(i + j)),
      );
      volume += points[0].dot(points[1].clone().cross(points[2])) / 6;
    }
    expect(volume).toBeCloseTo(8, 5);
    geometry.dispose();
    const setup = generateCar(DEFAULT_CAR_RECIPE).setup,
      rig = new SuspensionRig({
        ...setup,
        corners: { fl: { springScale: 1, dampingScale: 1, rideOffset: 0.02 } },
      });
    try {
      for (let i = 0; i < 720; i++) rig.step();
      expect(Math.abs(rig.telemetry.roll)).toBeGreaterThan(0.1);
      expect(rig.telemetry.totalLoad / (setup.mass * 9.81)).toBeCloseTo(1, 1);
      expect(rig.telemetry.groundedCount).toBe(4);
    } finally {
      rig.dispose();
    }
  });
  it("runs the same physical acceptance check used by the car workshop", async () => {
    const setup = generateCar({
        ...DEFAULT_CAR_RECIPE,
        family: "rear-coupe",
        layout: "RR",
      }).setup,
      result = await validateCarPhysics(setup);
    expect(result.valid, result.detail).toBe(true);
    expect(result.loadRatio).toBeCloseTo(1, 2);
    expect(result.frontFraction).toBeCloseTo(setup.frontWeight, 2);
  });
  it("reproduces every family and rejects invalid packaging", () => {
    for (const family of CAR_FAMILIES)
      for (let i = 0; i < 12; i++) {
        const recipe = {
          ...DEFAULT_CAR_RECIPE,
          family,
          layout:
            ARCHETYPES[family].layouts[i % ARCHETYPES[family].layouts.length],
          seed: `check-${i}`,
          mechanicsSeed: `m-${i}`,
          proportionsSeed: `p-${i}`,
        };
        const car = generateCar(recipe);
        expect(
          car.checks.filter((c) => !c.passed),
          family,
        ).toEqual([]);
        expect(car).toEqual(generateCar(recipe));
        expect(decodeCarDefinition(car.definition)).toEqual(car.definition);
      }
    expect(
      generateCar({ ...DEFAULT_CAR_RECIPE, overrides: { bodyWidth: 1.35 } })
        .valid,
    ).toBe(false);
    expect(() =>
      generateCar({ ...DEFAULT_CAR_RECIPE, overrides: { wheelbase: 20 } }),
    ).toThrow();
    expect(() =>
      generateCar({ ...DEFAULT_CAR_RECIPE, layout: "RR" }),
    ).toThrow();
  });
  it("keeps cosmetic seeds independent of mechanics and supports rear engines", () => {
    const a = generateCar(DEFAULT_CAR_RECIPE),
      b = generateCar({ ...DEFAULT_CAR_RECIPE, appearanceSeed: "other-paint" });
    expect(a.mechanics).toBe(b.mechanics);
    expect(a.appearance).not.toBe(b.appearance);
    expect(resolveCar(a.setup)).toEqual(resolveCar(b.setup));
    const rr = generateCar({
      ...DEFAULT_CAR_RECIPE,
      family: "rear-coupe",
      layout: "RR",
    });
    expect(rr.setup.enginePosition).toBe("rear");
    expect(rr.setup.frontWeight).toBeLessThan(0.45);
    expect(mechanicsFingerprint(a.setup)).not.toBe(
      mechanicsFingerprint(rr.setup),
    );
  });
  it("retains generated construction and corner tuning through sanitization", () => {
    const car = generateCar(DEFAULT_CAR_RECIPE),
      setup = sanitizeSetup({
        ...car.setup,
        corners: {
          fl: { springScale: 1.15, dampingScale: 0.9, rideOffset: 0.01 },
        },
      });
    expect(sanitizeSetup(setup)).toEqual(setup);
    expect(setup.vehicle).toEqual(car.definition);
    expect(
      sanitizeSetup({ ...setup, vehicle: { ...car.definition, version: 99 } })
        .vehicle,
    ).toBeUndefined();
    expect(sanitizeSetup(DEFAULT_SETUP)).toEqual(DEFAULT_SETUP);
  });
  it("keeps a custom tune and mass properties unchanged when only paint changes", () => {
    const base = generateCar(DEFAULT_CAR_RECIPE),
      current = {
        ...base.setup,
        frontSpring: base.setup.frontSpring * 1.15,
        grip: 1.2,
        wheelbase: base.setup.wheelbase + 0.08,
        corners: {
          fl: { springScale: 1.1, dampingScale: 0.9, rideOffset: 0.005 },
        },
      };
    const repainted = retainCarTuning(
      generateCar({
        ...DEFAULT_CAR_RECIPE,
        paint: 0xcd4a32,
        appearanceSeed: "new-look",
      }),
      current,
    );
    expect(mechanicsFingerprint(repainted.setup)).toBe(
      mechanicsFingerprint(current),
    );
    expect(resolveCar(repainted.setup)).toEqual(resolveCar(current));
    expect(repainted.definition.appearance.paint).toBe(0xcd4a32);
    const taller = generateCar({
        ...DEFAULT_CAR_RECIPE,
        overrides: { bodyHeight: 1.55 },
      }),
      reshaped = generateCar({
        ...DEFAULT_CAR_RECIPE,
        bodyShape: { shoulderHeight: 0.6, roofWidth: 0.72 },
      });
    expect(resolveCar(taller.setup).com.y).toBeGreaterThan(
      resolveCar(base.setup).com.y,
    );
    expect(resolveCar(reshaped.setup).inertia).not.toEqual(
      resolveCar(base.setup).inertia,
    );
  });
  it("supports a generated car on its cabin when inverted without adding mass", () => {
    const setup = generateCar(DEFAULT_CAR_RECIPE).setup,
      rig = new SuspensionRig(setup);
    try {
      rig.body.setRotation(
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI),
        true,
      );
      rig.body.setTranslation({ x: 0, y: 1.8, z: 0 }, true);
      for (let i = 0; i < 600; i++) rig.step();
      const q = new Quaternion().copy(rig.body.rotation()),
        roof = new Vector3(
          0,
          setup.vehicle!.dimensions.cabinHeight,
          setup.vehicle!.dimensions.cabinCentre,
        )
          .applyQuaternion(q)
          .add(new Vector3().copy(rig.body.translation()));
      expect(roof.y).toBeGreaterThan(-0.025);
      expect(rig.body.mass()).toBeCloseTo(setup.mass, 1);
      expect(rig.body.translation().y).toBeGreaterThan(0.7);
    } finally {
      rig.dispose();
    }
  });
  it.each(CAR_FAMILIES)(
    "%s settles at its physical component mass and axle balance",
    (family) => {
      const car = generateCar({
        ...DEFAULT_CAR_RECIPE,
        family,
        layout: ARCHETYPES[family].layouts[0],
      });
      const rig = new SuspensionRig(car.setup);
      try {
        for (let i = 0; i < 720; i++) rig.step();
        const t = rig.telemetry,
          spec = resolveCar(car.setup);
        expect(rig.body.mass()).toBeCloseTo(car.setup.mass, 1);
        expect(t.groundedCount).toBe(4);
        expect(t.totalLoad / (car.setup.mass * 9.81)).toBeCloseTo(1, 1);
        expect(
          Math.abs(t.frontLoadFraction - car.setup.frontWeight),
        ).toBeLessThan(0.025);
        expect(Math.abs(t.roll)).toBeLessThan(0.5);
        expect(Math.abs(t.pitch)).toBeLessThan(2);
        expect(rig.body.translation().y - spec.halfHeight).toBeGreaterThan(
          0.055,
        );
        const q = new Quaternion().copy(spec.inertiaFrame),
          r = new Matrix3().setFromMatrix4(
            new Matrix4().makeRotationFromQuaternion(q),
          );
        const d = new Matrix3().set(
            spec.inertia.x,
            0,
            0,
            0,
            spec.inertia.y,
            0,
            0,
            0,
            spec.inertia.z,
          ),
          reconstructed = r
            .clone()
            .multiply(d)
            .multiply(r.clone().transpose()).elements;
        for (let row = 0; row < 3; row++)
          for (let col = 0; col < 3; col++)
            expect(reconstructed[col * 3 + row]).toBeCloseTo(
              spec.tensor[row][col],
              4,
            );
      } finally {
        rig.dispose();
      }
    },
  );
  it.each(CAR_FAMILIES)(
    "%s builds finite, symmetric sectioned body geometry",
    (family) => {
      const car = generateCar({
          ...DEFAULT_CAR_RECIPE,
          family,
          layout: ARCHETYPES[family].layouts[0],
        }),
        mat = new MeshStandardMaterial(),
        body = createCarBody(car.setup, {
          body: mat,
          dark: mat,
          glass: mat,
          headlight: mat,
          taillight: mat,
          accent: mat,
        });
      let meshes = 0;
      body.traverse((o) => {
        if (o instanceof Mesh) {
          meshes++;
          const p = o.geometry.getAttribute("position");
          for (let i = 0; i < p.count; i++)
            expect(
              [p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite),
            ).toBe(true);
          o.geometry.dispose();
        }
      });
      expect(meshes).toBeGreaterThan(8);
      mat.dispose();
    },
  );
});
