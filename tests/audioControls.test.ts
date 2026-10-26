import { describe, expect, it } from "vitest";
import {
  AudioControlCollector,
  deriveAudioControls,
} from "../src/audio/AudioControls";
import { engineAudioProfile } from "../src/audio/profiles";
import { engineTorqueAtRpm } from "../src/vehicle/Powertrain";
import { DEFAULT_SETUP } from "../src/vehicle/setup";
import { DEFAULT_CAR_RECIPE, generateCar } from "../src/vehicle/generateCar";
import { GRAVITY, WHEEL_IDS, WHEEL_RADIUS } from "../src/vehicle/types";
import type {
  VehicleSetup,
  VehicleTelemetry,
  WheelTelemetry,
} from "../src/vehicle/types";
import type { SurfaceId } from "../src/track/types";

function telemetry(time = 1, speed = 20): VehicleTelemetry {
  const v = { x: 0, y: 0, z: 0 };
  return {
    time,
    position: { ...v },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { ...v, z: speed },
    speed,
    pitch: 0,
    roll: 0,
    worldPitch: 0,
    worldRoll: 0,
    roadPitch: 0,
    roadRoll: 0,
    roadReferenceValid: true,
    groundedCount: 4,
    totalLoad: DEFAULT_SETUP.mass * GRAVITY,
    frontLoadFraction: DEFAULT_SETUP.frontWeight,
    controls: { throttle: 1, brake: 0, steer: 0 },
    powertrain: {
      rpm: 4000,
      gear: 2,
      ratio: 8,
      engineTorque: engineTorqueAtRpm(4000, DEFAULT_SETUP),
      clutchTorque: 240,
      shifting: false,
    },
    assists: { traction: 0, abs: 0, stability: 0, countersteer: 0, hold: false },
    wheels: WHEEL_IDS.map((id) => ({
      id,
      grounded: true,
      load:
        (DEFAULT_SETUP.mass *
          GRAVITY *
          (id[0] === "f" ? DEFAULT_SETUP.frontWeight : 1 - DEFAULT_SETUP.frontWeight)) /
        2,
      length: 0.3,
      compression: 0.1,
      compressionRatio: 0.3,
      lateralSpeed: 0,
      longitudinalSpeed: speed,
      slipAngle: 0,
      steer: 0,
      spin: 0,
      angularSpeed: speed / WHEEL_RADIUS,
      slipRatio: 0,
      longitudinalForce: 0,
      lateralForce: 0,
      driveTorque: 0,
      brakeTorque: 0,
      surfaceGrip: 1,
      surface: "asphalt",
      absActive: false,
      tractionActive: false,
      mount: { ...v },
      hub: { ...v },
      contact: { ...v },
      normal: { ...v, y: 1 },
    })),
  };
}

function lateralDemand(wheel: WheelTelemetry, q: number, setup = DEFAULT_SETUP) {
  wheel.slipAngle = Math.atan(Math.tan(setup.lateralPeak) * q);
  wheel.lateralSpeed = Math.tan(wheel.slipAngle) * Math.max(Math.abs(wheel.longitudinalSpeed), 1.5);
  wheel.lateralForce = 2500;
}

function expectFinite(value: unknown): void {
  if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  else if (value && typeof value === "object")
    Object.values(value).forEach(expectFinite);
}

describe("per-wheel procedural audio controls", () => {
  it("keeps distinct wheel identities even when telemetry is shuffled", () => {
    const t = telemetry();
    lateralDemand(t.wheels[0], 0.85);
    t.wheels[1].angularSpeed = 0;
    t.wheels[1].absActive = true;
    t.wheels[2].surface = "grass";
    t.wheels[3].surface = "gravel";
    t.wheels.reverse();
    const frame = deriveAudioControls(t, DEFAULT_SETUP);
    expect(frame.wheels.map((wheel) => wheel.id)).toEqual(WHEEL_IDS);
    expect(frame.wheels[0].warning).toBeGreaterThan(0);
    expect(frame.wheels[0].slip).toBe(0);
    expect(frame.wheels[1].slip).toBeGreaterThan(0.5);
    expect(frame.wheels[1].absActive).toBe(true);
    expect(frame.wheels[2].grass).toBe(1);
    expect(frame.wheels[3].gravel).toBe(1);
    expect(frame.wheels[2].warning).toBe(0);
  });

  it("warns before the combined-slip peak and retains slip after force drops", () => {
    const t = telemetry();
    const frames = [0.5, 0.7, 0.9, 1, 1.2, 4].map((q) => {
      lateralDemand(t.wheels[0], q);
      if (q > 1) t.wheels[0].lateralForce = 0;
      return deriveAudioControls(t, DEFAULT_SETUP).wheels[0];
    });
    expect(frames[0].warning).toBe(0);
    expect(frames[1].warning).toBeGreaterThan(0);
    expect(frames[2].warning).toBeGreaterThan(frames[1].warning);
    expect(frames[2].slip).toBe(0);
    expect(frames[3].slip).toBeGreaterThan(0);
    expect(frames[4].slip).toBeGreaterThan(frames[3].slip);
    expect(frames[5].slip).toBeGreaterThan(0.5);
  });

  it("combines sub-threshold longitudinal and lateral demand", () => {
    const t = telemetry(), wheel = t.wheels[0];
    lateralDemand(wheel, 0.6);
    expect(deriveAudioControls(t, DEFAULT_SETUP).wheels[0].warning).toBe(0);
    wheel.angularSpeed = 20 / (1 - DEFAULT_SETUP.longitudinalPeak * 0.6) / WHEEL_RADIUS;
    const combined = deriveAudioControls(t, DEFAULT_SETUP).wheels[0];
    expect(combined.demand).toBeCloseTo(Math.hypot(0.6, 0.6), 8);
    expect(combined.warning).toBeGreaterThan(0.3);
  });

  it("preserves the same wheel intensities when motion reverses", () => {
    const t = telemetry();
    lateralDemand(t.wheels[0], 1.5);
    t.wheels[2].angularSpeed *= 1.3;
    const forward = deriveAudioControls(t, DEFAULT_SETUP);
    for (const wheel of t.wheels) {
      wheel.longitudinalSpeed *= -1;
      wheel.lateralSpeed *= -1;
      wheel.angularSpeed *= -1;
      wheel.slipAngle *= -1;
    }
    t.powertrain.gear = -1;
    const reverse = deriveAudioControls(t, DEFAULT_SETUP);
    expect(reverse.wheels).toEqual(forward.wheels);
  });

  it.each([0.25, 0.4])("uses generated %.2f m radius instead of incorrect reported slip", (radius) => {
    const setup = generateCar({ ...DEFAULT_CAR_RECIPE, overrides: { wheelRadius: radius } }).setup;
    const t = telemetry();
    for (const wheel of t.wheels) {
      wheel.angularSpeed = wheel.longitudinalSpeed / radius;
      wheel.slipRatio = 1; // Audio must not inherit final telemetry's 0.32 m fallback.
    }
    const frame = deriveAudioControls(t, setup);
    frame.wheels.forEach((wheel) => {
      expect(wheel.demand).toBeCloseTo(0, 8);
      expect(wheel.slip).toBe(0);
      expect(wheel.warning).toBe(0);
    });
  });

  it("sounds a stationary burnout and brake lock while silencing rest/hold", () => {
    const t = telemetry(1, 0);
    t.controls.brake = 1;
    t.assists.hold = true;
    expect(deriveAudioControls(t, DEFAULT_SETUP).wheels.every((wheel) => wheel.slip === 0 && wheel.warning === 0 && wheel.rolling === 0)).toBe(true);
    t.wheels[2].angularSpeed = 100;
    t.wheels[2].driveTorque = 1500;
    t.wheels[2].tractionActive = true;
    const burnout = deriveAudioControls(t, DEFAULT_SETUP).wheels[2];
    expect(burnout.slip).toBeGreaterThan(0.8);
    expect(burnout.tractionActive).toBe(true);
    const moving = telemetry();
    moving.wheels[1].angularSpeed = 0;
    moving.wheels[1].brakeTorque = 1000;
    expect(deriveAudioControls(moving, DEFAULT_SETUP).wheels[1].slip).toBeGreaterThan(0.8);
  });

  it("silences airborne/zero-load spin and weights lightly loaded contact once", () => {
    const t = telemetry();
    t.wheels.forEach((wheel) => lateralDemand(wheel, 2));
    t.wheels[0].grounded = false;
    t.wheels[1].load = 0;
    t.wheels[2].load *= 0.01;
    const controls = deriveAudioControls(t, DEFAULT_SETUP).wheels;
    for (const wheel of controls.slice(0, 2)) {
      expect(wheel.grounded).toBe(false);
      expect(wheel.warning).toBe(0);
      expect(wheel.slip).toBe(0);
      expect(wheel.rolling).toBe(0);
    }
    expect(controls[2].warning).toBeCloseTo(controls[3].warning * 0.1, 8);
    expect(controls[2].slip).toBeLessThanOrEqual(0.1);
  });

  it("normalizes material blends, includes runoff and falls back for invalid blends", () => {
    const t = telemetry();
    t.wheels[0].surfaceBlend = [
      { surface: "kerb", weight: 0.25 },
      { surface: "runoff", weight: 0.75 },
    ];
    t.wheels[1].surfaceBlend = [
      { surface: "gravel", weight: 0.5 },
      { surface: "sand", weight: 0.5 },
      { surface: "grass", weight: -4 },
      { surface: "asphalt", weight: NaN },
      { surface: "water" as SurfaceId, weight: 1 },
    ];
    t.wheels[2].surface = "grass";
    t.wheels[2].surfaceBlend = [{ surface: "sand", weight: NaN }];
    const [kerb, loose, grass] = deriveAudioControls(t, DEFAULT_SETUP).wheels;
    expect(kerb.kerb).toBe(0.25);
    expect(kerb.tarmac).toBe(0.75);
    expect(kerb.roughness).toBe(0.25);
    expect(loose.gravel).toBe(0.5);
    expect(loose.sand).toBe(0.5);
    expect(loose.grass).toBe(0);
    expect(loose.roughness).toBeCloseTo(0.575, 8);
    expect(grass.grass).toBe(1);
  });

  it("produces four silent controls for missing wheels", () => {
    const t = telemetry();
    t.wheels = [];
    expect(deriveAudioControls(t, DEFAULT_SETUP).wheels).toHaveLength(4);
    deriveAudioControls(t, DEFAULT_SETUP).wheels.forEach((wheel) => {
      expect(wheel.grounded).toBe(false);
      expect(wheel.slip).toBe(0);
    });
  });

  it("guards invalid telemetry and setup without a manufactured wheel lock", () => {
    const t = telemetry();
    t.time = NaN;
    t.powertrain.rpm = Infinity;
    t.powertrain.engineTorque = NaN;
    t.powertrain.clutchTorque = Infinity;
    t.powertrain.gear = NaN;
    Object.assign(t.wheels[0], {
      load: NaN,
      lateralSpeed: Infinity,
      longitudinalSpeed: NaN,
      angularSpeed: Infinity,
      slipAngle: NaN,
      surfaceRoughness: Infinity,
    });
    t.wheels[1].angularSpeed = NaN;
    const setup = { ...DEFAULT_SETUP, longitudinalPeak: 0, lateralPeak: NaN, peakTorque: NaN, redline: 0 };
    const controls = deriveAudioControls(t, setup);
    expectFinite(controls);
    expect(controls.wheels[0].slip).toBe(0);
    expect(controls.wheels[1].slip).toBe(0);
    expect(controls.engine.load).toBe(0);
    expect(controls.engine.driveLoad).toBe(0);
  });

  it("remains finite and bounded for extreme input", () => {
    const t = telemetry();
    for (const wheel of t.wheels) {
      wheel.angularSpeed = 1e100;
      wheel.load = 1e100;
      wheel.lateralSpeed = -1e100;
      wheel.slipAngle = 1e100;
      wheel.longitudinalForce = 1e100;
      wheel.lateralForce = -1e100;
      wheel.surfaceRoughness = 1e100;
    }
    const frame = deriveAudioControls(t, DEFAULT_SETUP);
    expectFinite(frame);
    frame.wheels.forEach((wheel) => {
      for (const key of ["warning", "slip", "rolling", "load", "roughness"] as const) {
        expect(wheel[key]).toBeGreaterThanOrEqual(0);
        expect(wheel[key]).toBeLessThanOrEqual(1);
      }
      expect(wheel.demand).toBeLessThanOrEqual(16);
      expect(wheel.slipSpeed).toBeLessThanOrEqual(150);
    });
  });
});

describe("engine effort and transient capture", () => {
  it("normalizes actual effective engine torque at current RPM, including TC", () => {
    const t = telemetry();
    t.controls.throttle = 1;
    t.powertrain.engineTorque *= 0.2;
    const controlled = deriveAudioControls(t, DEFAULT_SETUP).engine;
    expect(controlled.load).toBeCloseTo(0.2, 8);
    t.controls.throttle = 0;
    t.powertrain.engineTorque = engineTorqueAtRpm(t.powertrain.rpm, DEFAULT_SETUP);
    expect(deriveAudioControls(t, DEFAULT_SETUP).engine.load).toBeCloseTo(1, 8);
  });

  it("preserves a real RPM flare through shifts, neutral revs and reverse drive", () => {
    const t = telemetry();
    t.powertrain.shifting = true;
    t.powertrain.rpm = 7300;
    const shifted = deriveAudioControls(t, DEFAULT_SETUP).engine;
    expect(shifted.rpm).toBe(7300);
    expect(shifted.shifting).toBe(true);
    expect(shifted.driveLoad).toBe(0);
    t.powertrain.shifting = false;
    t.powertrain.gear = 0;
    expect(deriveAudioControls(t, DEFAULT_SETUP).engine.driveLoad).toBe(0);
    expect(deriveAudioControls(t, DEFAULT_SETUP).engine.load).toBeGreaterThan(0);
    t.powertrain.gear = -1;
    t.powertrain.ratio = -12;
    expect(deriveAudioControls(t, DEFAULT_SETUP).engine.driveLoad).toBeGreaterThan(0);
  });

  it("uses back-driven clutch torque for lift-off overrun in either direction", () => {
    const t = telemetry();
    t.powertrain.engineTorque = 0;
    t.powertrain.clutchTorque = -150;
    const forward = deriveAudioControls(t, DEFAULT_SETUP).engine;
    expect(forward.overrun).toBeGreaterThan(0.4);
    expect(forward.driveLoad).toBe(0);
    t.powertrain.gear = -1;
    expect(deriveAudioControls(t, DEFAULT_SETUP).engine.overrun).toBe(forward.overrun);
    t.powertrain.gear = 0;
    expect(deriveAudioControls(t, DEFAULT_SETUP).engine.overrun).toBe(0);
  });

  it("retains brief slip/assist/shift events while publishing current RPM and gear", () => {
    const collector = new AudioControlCollector(), peak = telemetry(1);
    lateralDemand(peak.wheels[0], 2);
    peak.wheels[0].absActive = true;
    peak.wheels[0].tractionActive = true;
    peak.powertrain.shifting = true;
    collector.capture(peak, DEFAULT_SETUP);
    const quiet = telemetry(1 + 1 / 120);
    quiet.powertrain.rpm = 3100;
    quiet.powertrain.gear = 3;
    collector.capture(quiet, DEFAULT_SETUP);
    const frame = collector.flush()!;
    expect(frame.wheels[0].slip).toBeGreaterThan(0.3);
    expect(frame.wheels[0].warning).toBeGreaterThan(0.8);
    expect(frame.wheels[0].absActive).toBe(true);
    expect(frame.wheels[0].tractionActive).toBe(true);
    expect(frame.engine.shifting).toBe(true);
    expect(frame.engine.rpm).toBe(3100);
    expect(frame.engine.gear).toBe(3);
    expect(collector.flush()).toBeUndefined();
    collector.capture(telemetry(1 + 2 / 120), DEFAULT_SETUP);
    expect(collector.flush()!.wheels[0].slip).toBe(0);
  });

  it.each(["airborne", "zero-load"])("latest %s state overrides retained slip", (state) => {
    const collector = new AudioControlCollector(), peak = telemetry(1);
    lateralDemand(peak.wheels[0], 2);
    collector.capture(peak, DEFAULT_SETUP);
    const quiet = telemetry(1 + 1 / 120);
    if (state === "airborne") quiet.wheels[0].grounded = false;
    else quiet.wheels[0].load = 0;
    collector.capture(quiet, DEFAULT_SETUP);
    const wheel = collector.flush()!.wheels[0];
    expect(wheel.slip).toBe(0);
    expect(wheel.warning).toBe(0);
    expect(wheel.rolling).toBe(0);
  });

  it("caps retained peaks by a still-grounded wheel's latest reduced load", () => {
    const collector = new AudioControlCollector(), peak = telemetry(1);
    lateralDemand(peak.wheels[0], 2);
    collector.capture(peak, DEFAULT_SETUP);
    const unloaded = telemetry(1 + 1 / 120);
    unloaded.wheels[0].load *= 0.01;
    collector.capture(unloaded, DEFAULT_SETUP);
    const wheel = collector.flush()!.wheels[0];
    expect(wheel.grounded).toBe(true);
    expect(wheel.load).toBeCloseTo(0.1, 8);
    expect(wheel.warning).toBeCloseTo(wheel.load, 8);
    expect(wheel.slip).toBeCloseTo(wheel.load, 8);
  });

  it.each([0.5, 1, 2])("clears old events across reset/equal time/gap to %s", (time) => {
    const collector = new AudioControlCollector(), peak = telemetry(1);
    lateralDemand(peak.wheels[0], 2);
    peak.powertrain.shifting = true;
    collector.capture(peak, DEFAULT_SETUP);
    collector.capture(telemetry(time), DEFAULT_SETUP);
    const frame = collector.flush()!;
    expect(frame.wheels[0].slip).toBe(0);
    expect(frame.engine.shifting).toBe(false);
    expect(frame.impact).toBe(0);
  });

  it("bounds a long catch-up history and reset removes pending/impact history", () => {
    const collector = new AudioControlCollector(), peak = telemetry(1);
    lateralDemand(peak.wheels[0], 2);
    collector.capture(peak, DEFAULT_SETUP);
    for (let index = 1; index <= 100; index++)
      collector.capture(telemetry(1 + index / 120), DEFAULT_SETUP);
    expect(collector.flush()!.wheels[0].slip).toBe(0);
    collector.capture(peak, DEFAULT_SETUP);
    collector.reset();
    expect(collector.flush()).toBeUndefined();
    collector.capture(telemetry(1 + 1 / 120, 0), DEFAULT_SETUP);
    expect(collector.flush()!.impact).toBe(0);
  });

  it("retains bounded impacts and snapshots vectors from a caller reusing telemetry", () => {
    const collector = new AudioControlCollector(), t = telemetry(1, 20);
    collector.capture(t, DEFAULT_SETUP);
    t.time += 1 / 120;
    t.velocity.z = 0;
    t.speed = 0;
    collector.capture(t, DEFAULT_SETUP);
    expect(collector.flush()!.impact).toBe(1);
    const invalid = telemetry(2);
    invalid.velocity.z = NaN;
    expect(deriveAudioControls(invalid, DEFAULT_SETUP, telemetry(2 - 1 / 120)).impact).toBe(0);
  });
});

describe("cosmetic engine profiles", () => {
  it("supplies compact/sport/deep profiles without altering setup or mechanics", () => {
    const setup: VehicleSetup = { ...DEFAULT_SETUP }, before = JSON.stringify(setup);
    const compact = engineAudioProfile({ ...setup, referenceCar: "ff" });
    const sport = engineAudioProfile({ ...setup, referenceCar: "mr" });
    const deep = engineAudioProfile({ ...setup, referenceCar: "awd" });
    expect(compact.id).toBe("compact");
    expect(sport.id).toBe("sport");
    expect(deep.id).toBe("deep");
    expect(compact.cylinders).toBeLessThan(deep.cylinders);
    expect(compact.brightness).toBeGreaterThan(deep.brightness);
    expect(deep.body).toBeGreaterThan(compact.body);
    for (const profile of [compact, sport, deep]) {
      for (const key of ["body", "brightness"] as const) {
        expect(profile[key]).toBeGreaterThan(0.5);
        expect(profile[key]).toBeLessThan(1.5);
      }
      expect(profile.irregularity).toBeGreaterThanOrEqual(0);
      expect(profile.irregularity).toBeLessThanOrEqual(1);
    }
    expect(JSON.stringify(setup)).toBe(before);
  });

  it("is deterministic from family/seed and stable through mechanics or paint edits", () => {
    const setup = generateCar({ ...DEFAULT_CAR_RECIPE, seed: "audio-profile" }).setup;
    const profile = engineAudioProfile(setup);
    expect(engineAudioProfile(structuredClone(setup))).toEqual(profile);
    const tuned = structuredClone(setup);
    tuned.peakTorque += 120;
    tuned.redline -= 1000;
    tuned.vehicle!.appearance.paint = 0xff0000;
    expect(engineAudioProfile(tuned)).toEqual(profile);
    tuned.vehicle!.recipe.seed = "another-audio-seed";
    expect(engineAudioProfile(tuned).seed).not.toBe(profile.seed);
    expect(engineAudioProfile(tuned).id).toBe(profile.id);
    expectFinite(profile);
  });
});
