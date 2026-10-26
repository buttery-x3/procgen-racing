import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { initializePhysics, SuspensionRig } from "../src/physics/SuspensionRig";
import { DEFAULT_SETUP } from "../src/vehicle/setup";
import { REFERENCE_CARS } from "../src/vehicle/referenceCars";
import { FIXED_STEP, WHEEL_RADIUS } from "../src/vehicle/types";
import { gripCapacity, tyreForces, slipRatio } from "../src/vehicle/Tyre";
import {
  splitAxleTorque,
  distributeDriveTorque,
} from "../src/vehicle/Differential";
import { chasePose, steeringAngles } from "../src/vehicle/coordinates";
import type { VehicleSetup } from "../src/vehicle/types";

const rigs: SuspensionRig[] = [];
beforeAll(initializePhysics);
afterEach(() => rigs.splice(0).forEach((r) => r.dispose()));
function create(setup = DEFAULT_SETUP) {
  const r = new SuspensionRig(setup);
  rigs.push(r);
  r.setExperiment("handling");
  for (let i = 0; i < 360; i++) r.step();
  return r;
}
function run(
  r: SuspensionRig,
  seconds: number,
  throttle = 1,
  brake = 0,
  steer = 0,
) {
  for (let i = 0; i < seconds / FIXED_STEP; i++)
    r.step({ throttle, brake, steer });
}

describe("tyre contact model", () => {
  it("uses the wheel's own speed for signed drive and braking slip, including reverse", () => {
    expect(slipRatio(20 / WHEEL_RADIUS, 20)).toBeCloseTo(0, 8);
    expect(slipRatio(0, 20)).toBe(-1);
    expect(slipRatio(80, 10)).toBeGreaterThan(0.5);
    expect(slipRatio(-80, -10)).toBeLessThan(-0.5);
  });
  it("shares one grip budget between longitudinal and lateral force", () => {
    const pure = tyreForces(0, 0.14, 4000, DEFAULT_SETUP);
    const combined = tyreForces(0.12, 0.14, 4000, DEFAULT_SETUP);
    expect(Math.abs(combined.fy)).toBeLessThan(Math.abs(pure.fy));
    expect(combined.fx).toBeGreaterThan(0);
    expect(Math.hypot(combined.fx, combined.fy)).toBeLessThanOrEqual(4000.001);
    expect(tyreForces(0, 0, 0, DEFAULT_SETUP)).toEqual({ fx: 0, fy: 0 });
  });
  it("has load sensitivity and a gradual post-peak sliding region", () => {
    const base = gripCapacity(3000, 3000, 1, DEFAULT_SETUP);
    expect(gripCapacity(6000, 3000, 1, DEFAULT_SETUP)).toBeLessThan(base * 2);
    const peak = tyreForces(0.12, 0, base, DEFAULT_SETUP).fx;
    const slide = tyreForces(0.9, 0, base, DEFAULT_SETUP).fx;
    expect(slide).toBeLessThan(peak);
    expect(slide).toBeGreaterThan(peak * 0.7);
  });
});

describe("differentials", () => {
  it("keeps equal open-diff torque when wheel speeds differ", () => {
    expect(splitAxleTorque(1000, 0, 80, "open", 1, FIXED_STEP)).toEqual([
      500, 500,
    ]);
  });
  it("transfers limited-slip torque toward the slower wheel and conserves input torque", () => {
    const [slow, fast] = splitAxleTorque(1000, 0, 80, "lsd", 0.8, FIXED_STEP);
    expect(slow).toBeGreaterThan(fast);
    expect(slow + fast).toBeCloseTo(1000, 8);
  });
  it("allocates AWD torque according to the centre split", () => {
    const torques = distributeDriveTorque(
      1000,
      [0, 0, 0, 0],
      { ...DEFAULT_SETUP, drive: "awd", awdFrontSplit: 0.3 },
      FIXED_STEP,
    );
    expect(torques[0] + torques[1]).toBeCloseTo(300, 8);
    expect(torques.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 8);
  });
});

describe("M1 control corrections", () => {
  it("makes physical right turns toward -X and left turns toward +X", () => {
    const right = create(),
      left = create();
    run(right, 1.6, 1, 0, 0.65);
    run(left, 1.6, 1, 0, -0.65);
    expect(right.telemetry.position.x).toBeLessThan(-0.3);
    expect(left.telemetry.position.x).toBeGreaterThan(0.3);
    expect(right.telemetry.wheels[1].steer).toBeGreaterThan(
      right.telemetry.wheels[0].steer,
    );
    expect(steeringAngles(-0.4, 2.6, 1.6)[0]).toBeLessThan(
      steeringAngles(-0.4, 2.6, 1.6)[1],
    );
  });
  it("centres chase behind heading without a lateral offset or body-roll offset", () => {
    const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      1.1,
    );
    rotation.multiply(
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.2),
    );
    const p = { x: 11, y: 2, z: -7 },
      pose = chasePose(p, rotation);
    const forward = new Vector3(0, 0, 1)
      .applyQuaternion(rotation)
      .setY(0)
      .normalize();
    const lateral = forward.clone().cross(new Vector3(0, 1, 0));
    expect(
      pose.position
        .clone()
        .sub(new Vector3(p.x, p.y, p.z))
        .dot(lateral),
    ).toBeCloseTo(0, 8);
    expect(
      pose.position
        .clone()
        .sub(new Vector3(p.x, p.y, p.z))
        .dot(forward),
    ).toBeLessThan(-7);
  });
});

describe("engine, gears and wheel dynamics", () => {
  it.each(["ff", "fr", "mr", "awd"] as const)(
    "drives the %s reference car through the correct wheels",
    (id) => {
      const r = create(REFERENCE_CARS[id].setup);
      run(r, 3);
      expect(r.telemetry.speed).toBeGreaterThan(3);
      expect(r.telemetry.powertrain.rpm).toBeGreaterThan(900);
      expect(
        r.telemetry.wheels.every((w) => Number.isFinite(w.slipRatio)),
      ).toBe(true);
      const front = r.telemetry.wheels
        .slice(0, 2)
        .some((w) => Math.abs(w.driveTorque) > 1);
      const rear = r.telemetry.wheels
        .slice(2)
        .some((w) => Math.abs(w.driveTorque) > 1);
      expect(front).toBe(id === "ff" || id === "awd");
      expect(rear).toBe(id !== "ff");
    },
  );
  it("reverses with negative gearing and refuses a direction change at speed", () => {
    const r = create();
    expect(r.powertrain.requestGear(-1, 0)).toBe(true);
    run(r, 2);
    expect(r.body.linvel().z).toBeLessThan(-2);
    expect(r.telemetry.powertrain.ratio).toBeLessThan(0);
    expect(r.powertrain.requestGear(1, r.body.linvel().z)).toBe(false);
    expect(r.powertrain.requestGear(0, r.body.linvel().z)).toBe(true);
    expect(r.powertrain.requestGear(1, r.body.linvel().z)).toBe(false);
  });
  it("free-revs in neutral without propelling the chassis", () => {
    const r = create();
    r.powertrain.requestGear(0, 0);
    run(r, 2);
    expect(r.telemetry.powertrain.rpm).toBeGreaterThan(4000);
    expect(r.telemetry.speed).toBeLessThan(0.1);
    expect(
      r.telemetry.wheels.every((w) => Math.abs(w.driveTorque) < 0.01),
    ).toBe(true);
  });
  it("shifts automatically, cuts torque during a shift, and supports sequential manual shifting", () => {
    const r = create({ ...DEFAULT_SETUP, tractionControl: 1 });
    let shifted = false,
      cut = false;
    for (let i = 0; i < 1440; i++) {
      r.step({ throttle: 1, brake: 0, steer: 0 });
      shifted ||= r.powertrain.gear > 1;
      cut ||=
        r.telemetry.powertrain.shifting &&
        r.telemetry.wheels.every((w) => Math.abs(w.driveTorque) < 0.01);
    }
    expect(shifted).toBe(true);
    expect(cut).toBe(true);
    r.updateSetup({ ...r.setup, transmission: "manual" });
    const gear = r.powertrain.gear;
    expect(r.powertrain.shift(-1, r.telemetry.speed)).toBe(true);
    expect(r.powertrain.gear).toBe(gear - 1);
  });
  it("spins unloaded driven wheels without producing airborne chassis traction", () => {
    const r = create();
    r.reset(6);
    run(r, 0.3);
    expect(r.telemetry.groundedCount).toBe(0);
    expect(r.telemetry.speed).toBeCloseTo(0, 5);
    expect(r.tyres[2].omega).toBeGreaterThan(5);
    expect(r.tyres[0].omega).toBeCloseTo(0, 5);
  });
  it("lets split grip produce independent wheel slip and constrains a locked axle", () => {
    const r = create({
      ...REFERENCE_CARS.ff.setup,
      tractionControl: 0,
      peakTorque: 400,
    });
    r.wheelSurfaceGrip = [0.12, 1, 1, 1];
    run(r, 2);
    expect(Math.abs(r.tyres[0].omega - r.tyres[1].omega)).toBeGreaterThan(5);
    r.updateSetup({ ...r.setup, frontDiff: "locked" });
    run(r, 0.5);
    expect(r.tyres[0].omega).toBeCloseTo(r.tyres[1].omega, 6);
  });
  it("locks centre axle averages while conserving wheel angular momentum", () => {
    const r = create({ ...REFERENCE_CARS.awd.setup, centreDiff: "locked" });
    r.reset(6);
    r.powertrain.requestGear(0, 0);
    [80, 80, 20, 20].forEach((omega, i) => (r.tyres[i].omega = omega));
    const before = r.tyres.reduce((n, t) => n + t.omega, 0),
      energyBefore = r.tyres.reduce((n, t) => n + t.omega ** 2, 0);
    r.step();
    expect((r.tyres[0].omega + r.tyres[1].omega) / 2).toBeCloseTo(
      (r.tyres[2].omega + r.tyres[3].omega) / 2,
      6,
    );
    expect(r.tyres.reduce((n, t) => n + t.omega, 0)).toBeCloseTo(before, 5);
    expect(r.tyres.reduce((n, t) => n + t.omega ** 2, 0)).toBeLessThan(
      energyBefore,
    );
  });
});

describe("brakes and driving assists", () => {
  it("applies bounded ground yaw correction and limited countersteering", () => {
    const r = create({
      ...DEFAULT_SETUP,
      stabilityAssist: 1,
      countersteerAssist: 1,
      autoHold: 0,
    });
    r.body.setLinvel({ x: -4, y: 0, z: 15 }, true);
    r.body.setAngvel({ x: 0, y: 0.8, z: 0 }, true);
    r.tyres.forEach((t) => (t.omega = 15 / WHEEL_RADIUS));
    r.step();
    expect(r.telemetry.assists.stability).toBeGreaterThan(0);
    expect(r.telemetry.assists.stability).toBeLessThanOrEqual(1);
    expect(r.telemetry.assists.countersteer).toBeGreaterThan(0);
    expect(r.telemetry.assists.countersteer).toBeLessThanOrEqual(0.2);
    r.updateSetup({ ...r.setup, stabilityAssist: 0, countersteerAssist: 0 });
    r.step();
    expect(r.telemetry.assists.stability).toBe(0);
    expect(r.telemetry.assists.countersteer).toBe(0);
  });
  function brakeTest(abs: number) {
    const r = create({ ...DEFAULT_SETUP, abs, autoHold: 0 });
    r.body.setLinvel({ x: 0, y: 0, z: 18 }, true);
    r.tyres.forEach((t) => (t.omega = 18 / WHEEL_RADIUS));
    let locked = 0,
      intervention = 0;
    for (let i = 0; i < 96; i++) {
      r.step({ throttle: 0, brake: 1, steer: 0 });
      if (Math.abs(r.telemetry.wheels[0].slipRatio) > 0.8) locked++;
      intervention = Math.max(intervention, r.telemetry.assists.abs);
    }
    return { r, locked, intervention };
  }
  it("allows wheel locking with ABS off and modulates individual brakes with ABS on", () => {
    const off = brakeTest(0),
      on = brakeTest(1);
    expect(off.locked).toBeGreaterThan(10);
    expect(on.locked).toBeLessThan(off.locked);
    expect(on.intervention).toBeGreaterThan(0.1);
    expect(on.r.telemetry.speed).toBeLessThan(18);
  });
  it("reduces excess wheelspin with traction control instead of overwriting velocity", () => {
    const setup: VehicleSetup = {
      ...DEFAULT_SETUP,
      peakTorque: 650,
      rearDiff: "open",
    };
    const off = create({ ...setup, tractionControl: 0 }),
      on = create({ ...setup, tractionControl: 1 });
    let offSlip = 0,
      onSlip = 0,
      cut = 0;
    for (let i = 0; i < 360; i++) {
      for (const r of [off, on]) r.step({ throttle: 1, brake: 0, steer: 0 });
      offSlip += Math.abs(off.telemetry.wheels[2].slipRatio);
      onSlip += Math.abs(on.telemetry.wheels[2].slipRatio);
      cut = Math.max(cut, on.telemetry.assists.traction);
    }
    expect(cut).toBeGreaterThan(0.1);
    expect(onSlip).toBeLessThan(offSlip);
  });
  it("applies a rear handbrake and disables ground-dependent yaw assist in the air", () => {
    const r = create();
    run(r, 1.8);
    r.step({ throttle: 0, brake: 0, steer: 0, handbrake: 1 });
    expect(r.telemetry.wheels[2].brakeTorque).toBeGreaterThan(0);
    expect(r.telemetry.wheels[0].brakeTorque).toBe(0);
    r.reset(6);
    r.body.setLinvel({ x: 5, y: 0, z: 10 }, true);
    r.body.setAngvel({ x: 0, y: 1, z: 0 }, true);
    r.step();
    expect(r.telemetry.assists.stability).toBe(0);
    expect(r.telemetry.assists.countersteer).toBe(0);
  });
});
