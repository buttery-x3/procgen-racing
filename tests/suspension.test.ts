import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { initializePhysics, SuspensionRig } from "../src/physics/SuspensionRig";
import { DEFAULT_SETUP } from "../src/vehicle/setup";
import { FIXED_STEP, GRAVITY } from "../src/vehicle/types";

const rigs: SuspensionRig[] = [];
beforeAll(async () => {
  await initializePhysics();
});
afterEach(() => {
  rigs.splice(0).forEach((rig) => rig.dispose());
});
function rig() {
  const r = new SuspensionRig();
  rigs.push(r);
  return r;
}
function advance(r: SuspensionRig, seconds: number) {
  for (let i = 0; i < seconds / FIXED_STEP; i++) r.step();
}

describe("four-wheel suspension integration", () => {
  it("supports the full chassis weight at four contacts with the intended axle split", () => {
    const r = rig();
    advance(r, 5);
    expect(r.telemetry.groundedCount).toBe(4);
    expect(r.body.mass()).toBeCloseTo(DEFAULT_SETUP.mass, 1);
    expect(r.telemetry.totalLoad / (r.setup.mass * GRAVITY)).toBeCloseTo(1, 2);
    expect(r.telemetry.frontLoadFraction).toBeCloseTo(r.setup.frontWeight, 2);
    expect(r.telemetry.wheels[0].load).toBeCloseTo(
      r.telemetry.wheels[1].load,
      1,
    );
    expect(r.telemetry.wheels[2].load).toBeCloseTo(
      r.telemetry.wheels[3].load,
      1,
    );
  });

  it("settles a 0.6 metre drop without energy growth or persistent bouncing", () => {
    const r = rig();
    r.drop();
    let peakLoad = 0;
    for (let i = 0; i < 720; i++) {
      r.step();
      peakLoad = Math.max(peakLoad, r.telemetry.totalLoad);
    }
    expect(peakLoad).toBeGreaterThan(r.setup.mass * GRAVITY * 1.4);
    expect(r.telemetry.groundedCount).toBe(4);
    expect(Math.abs(r.body.linvel().y)).toBeLessThan(0.015);
    expect(r.telemetry.position.y).toBeGreaterThan(0.35);
    expect(r.telemetry.position.y).toBeLessThan(0.8);
  });

  it("responds independently to a front-left bump and produces actual chassis roll", () => {
    const r = rig();
    advance(r, 3);
    r.triggerBump();
    advance(r, 3);
    const [fl, fr, rl] = r.telemetry.wheels;
    expect(fl.contact.y - fr.contact.y).toBeGreaterThan(0.1);
    expect(Math.abs(fl.compression - fr.compression)).toBeGreaterThan(0.01);
    expect(Math.abs(r.telemetry.roll)).toBeGreaterThan(0.5);
    expect(rl.contact.y).toBeCloseTo(0, 2);
    expect(r.telemetry.wheels.every((w) => w.load >= 0)).toBe(true);
  });

  it("distinguishes a banked road from suspension roll and holds at rest", () => {
    const r = rig();
    r.setExperiment("bank");
    advance(r, 5);
    expect(r.telemetry.groundedCount).toBe(4);
    expect(r.telemetry.roadReferenceValid).toBe(true);
    expect(Math.abs(r.telemetry.worldRoll)).toBeGreaterThan(5);
    expect(Math.abs(r.telemetry.roll)).toBeLessThan(1.6);
    expect(r.telemetry.speed).toBeLessThan(0.06);
  });

  it("distinguishes road grade from body pitch", () => {
    const r = rig();
    r.setExperiment("pitch");
    advance(r, 5);
    expect(r.telemetry.groundedCount).toBe(4);
    expect(r.telemetry.worldPitch).toBeGreaterThan(5);
    expect(Math.abs(r.telemetry.pitch)).toBeLessThan(1.6);
    expect(r.telemetry.speed).toBeLessThan(0.06);
  });

  it("generates no wheel support or traction while airborne", () => {
    const r = rig();
    r.reset(4);
    const vx = r.body.linvel().x,
      vz = r.body.linvel().z;
    r.step({ throttle: 1, brake: 0, steer: 1 });
    expect(r.telemetry.groundedCount).toBe(0);
    expect(r.telemetry.totalLoad).toBe(0);
    expect(r.body.linvel().x).toBeCloseTo(vx, 6);
    expect(r.body.linvel().z).toBeCloseTo(vz, 6);
    expect(r.telemetry.roadReferenceValid).toBe(false);
  });

  it("applies chassis geometry and mass changes without double-counting collider mass", () => {
    const r = rig();
    r.updateSetup(
      {
        ...r.setup,
        mass: 1700,
        frontWeight: 0.6,
        wheelbase: 3,
        trackWidth: 1.85,
      },
      true,
    );
    advance(r, 5);
    expect(r.body.mass()).toBeCloseTo(1700, 1);
    expect(r.telemetry.frontLoadFraction).toBeCloseTo(0.6, 2);
    expect(r.telemetry.wheels[0].mount.x).toBeCloseTo(0.925, 2);
    expect(
      r.telemetry.wheels[0].mount.z - r.telemetry.wheels[2].mount.z,
    ).toBeCloseTo(3, 2);
  });

  it("responds to live spring tuning with a new physical ride height", () => {
    const r = rig();
    advance(r, 4);
    const previous = r.telemetry.position.y;
    r.updateSetup({ ...r.setup, frontSpring: 70000, rearSpring: 64000 });
    advance(r, 4);
    expect(r.telemetry.position.y).toBeGreaterThan(previous + 0.035);
    expect(r.telemetry.groundedCount).toBe(4);
    expect(Math.abs(r.body.linvel().y)).toBeLessThan(0.01);
  });

  it("lets pitch and roll respond freely to impulses and then settle", () => {
    const r = rig();
    advance(r, 3);
    r.impulse("roll");
    let peakRoll = 0;
    for (let i = 0; i < 120; i++) {
      r.step();
      peakRoll = Math.max(peakRoll, Math.abs(r.telemetry.roll));
    }
    expect(peakRoll).toBeGreaterThan(1);
    advance(r, 4);
    expect(Math.abs(r.telemetry.roll)).toBeLessThan(0.2);
    r.impulse("pitch");
    let peakPitch = 0;
    for (let i = 0; i < 120; i++) {
      r.step();
      peakPitch = Math.max(peakPitch, Math.abs(r.telemetry.pitch));
    }
    expect(peakPitch).toBeGreaterThan(0.5);
  });

  it("drives through tire contacts and brakes to rest", () => {
    const r = rig();
    advance(r, 3);
    for (let i = 0; i < 120; i++) r.step({ throttle: 1, brake: 0, steer: 0 });
    expect(r.telemetry.speed).toBeGreaterThan(1.8);
    expect(r.telemetry.position.z).toBeGreaterThan(0.7);
    for (let i = 0; i < 240; i++) r.step({ throttle: 0, brake: 1, steer: 0 });
    expect(r.telemetry.speed).toBeLessThan(0.08);
    expect(Number.isFinite(r.telemetry.pitch)).toBe(true);
  });

  it("preserves the selected bump surface after a chassis rebuild or reset", () => {
    const r = rig();
    r.setExperiment("bump");
    advance(r, 3);
    expect(r.telemetry.wheels[0].contact.y).toBeGreaterThan(0.12);
    r.updateSetup({ ...r.setup, mass: 1500 }, true);
    advance(r, 3);
    expect(r.telemetry.wheels[0].contact.y).toBeGreaterThan(0.12);
    expect(r.telemetry.wheels[1].contact.y).toBeCloseTo(0, 2);
  });

  it("steers right for a positive command without directly setting body velocity", () => {
    const r = rig();
    advance(r, 3);
    for (let i = 0; i < 168; i++)
      r.step({ throttle: 1, brake: 0, steer: 0.65 });
    // +Z-forward, +Y-up: physical right is -X when viewed from behind.
    expect(r.telemetry.position.x).toBeLessThan(-0.15);
    expect(r.body.rotation().y).toBeLessThan(-0.05);
    expect(r.telemetry.wheels[0].steer).toBeGreaterThan(0.2);
  });
});
