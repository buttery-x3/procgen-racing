import { SURFACES } from "../track/types";
import type { SurfaceId } from "../track/types";
import { engineTorqueAtRpm } from "../vehicle/Powertrain";
import { GRAVITY, WHEEL_IDS, WHEEL_RADIUS } from "../vehicle/types";
import type {
  VehicleSetup,
  VehicleTelemetry,
  WheelId,
  WheelTelemetry,
} from "../vehicle/types";
import type { AudioControlFrame, TyreAudioControl } from "./types";

const finite = (value: number, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;
const bounded = (value: number, low = 0, high = 1) =>
  Math.max(low, Math.min(high, finite(value)));
const positive = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback;
const smooth = (low: number, high: number, value: number) => {
  const x = bounded((value - low) / (high - low));
  return x * x * (3 - 2 * x);
};

function surfaceWeights(wheel: WheelTelemetry | undefined) {
  const weights: Record<SurfaceId, number> = {
    asphalt: 0,
    runoff: 0,
    kerb: 0,
    gravel: 0,
    sand: 0,
    grass: 0,
  };
  let total = 0;
  for (const blend of wheel?.surfaceBlend ?? []) {
    if (!Object.hasOwn(weights, blend.surface)) continue;
    const weight = bounded(blend.weight);
    weights[blend.surface] += weight;
    total += weight;
  }
  if (total > 0) {
    for (const material of Object.keys(weights) as SurfaceId[])
      weights[material] /= total;
  } else if (wheel && Object.hasOwn(weights, wheel.surface))
    weights[wheel.surface] = 1;
  else weights.asphalt = 1;
  return weights;
}

function tyreControl(
  id: WheelId,
  wheel: WheelTelemetry | undefined,
  setup: VehicleSetup,
  radius: number,
): TyreAudioControl {
  const restLoad =
      (bounded(setup.mass, 100, 5000) *
        GRAVITY *
        (id[0] === "f"
          ? bounded(setup.frontWeight, 0.1, 0.9)
          : 1 - bounded(setup.frontWeight, 0.1, 0.9))) /
      2,
    loadNewtons = bounded(wheel?.load ?? 0, 0, restLoad * 8),
    grounded = Boolean(wheel?.grounded && loadNewtons > 1),
    load = grounded ? bounded(Math.sqrt(loadNewtons / restLoad)) : 0,
    longitudinal = bounded(wheel?.longitudinalSpeed ?? 0, -150, 150),
    lateral = bounded(wheel?.lateralSpeed ?? 0, -150, 150),
    // Missing angular telemetry must not manufacture a locked wheel.
    peripheral = bounded(
      finite(wheel?.angularSpeed ?? NaN, longitudinal / radius) * radius,
      -150,
      150,
    ),
    relative = peripheral - longitudinal,
    ratio = relative / Math.max(Math.abs(longitudinal), Math.abs(peripheral), 1.5),
    angle = bounded(
      finite(
        wheel?.slipAngle ?? NaN,
        Math.atan2(lateral, Math.max(Math.abs(longitudinal), 1.5)),
      ),
      -1.5,
      1.5,
    ),
    demand = grounded
      ? bounded(
          Math.hypot(
            ratio / bounded(positive(setup.longitudinalPeak, 0.12), 0.01, 1),
            Math.tan(angle) /
              Math.tan(bounded(positive(setup.lateralPeak, 0.14), 0.01, 1)),
          ),
          0,
          16,
        )
      : 0,
    speed = grounded ? Math.min(150, Math.hypot(longitudinal, lateral)) : 0,
    slipSpeed = grounded ? Math.min(150, Math.hypot(relative, lateral)) : 0,
    // Wheel-relative motion makes a stationary burnout audible. Auto-hold at
    // rest has neither contact nor peripheral motion and stays silent.
    motion = grounded ? smooth(0.15, 1.5, Math.max(speed, Math.abs(peripheral))) : 0,
    power =
      Math.abs(bounded(wheel?.longitudinalForce ?? 0, -100000, 100000) * relative) +
      Math.abs(bounded(wheel?.lateralForce ?? 0, -100000, 100000) * lateral),
    energy = bounded(Math.sqrt(power / (restLoad * 10))),
    // Power already contains force/load. Blend it with a once-load-weighted
    // speed proxy rather than multiplying both by load again. The speed proxy
    // retains a sliding sound past peak force, including low-force wheelspin.
    sliding = Math.min(
      load,
      Math.max(load * (0.25 + 0.75 * smooth(0.2, 8, slipSpeed)), energy),
    ),
    surfaces = surfaceWeights(wheel),
    roughness = finite(
      wheel?.surfaceRoughness ?? NaN,
      (Object.keys(surfaces) as SurfaceId[]).reduce(
        (sum, material) => sum + surfaces[material] * (SURFACES[material].roughness ?? 0),
        0,
      ),
    );
  return {
    id,
    grounded,
    warning: smooth(0.65, 0.95, demand) * motion * load,
    slip: grounded ? smooth(0.95, 1.2, demand) * motion * sliding : 0,
    rolling: smooth(0.15, 25, speed) * load,
    speed,
    slipSpeed,
    demand,
    load,
    kerb: grounded ? surfaces.kerb : 0,
    gravel: grounded ? surfaces.gravel : 0,
    sand: grounded ? surfaces.sand : 0,
    grass: grounded ? surfaces.grass : 0,
    tarmac: grounded ? surfaces.asphalt + surfaces.runoff : 0,
    roughness: grounded ? bounded(roughness) : 0,
    absActive: grounded && Boolean(wheel?.absActive),
    tractionActive: grounded && Boolean(wheel?.tractionActive),
  };
}

/** Cosmetic controls only. q is model demand, never a measured grip percentage. */
export function deriveAudioControls(
  telemetry: VehicleTelemetry,
  setup: VehicleSetup,
  previous?: VehicleTelemetry,
): AudioControlFrame {
  const radius = bounded(
      positive(setup.vehicle?.dimensions.wheelRadius ?? WHEEL_RADIUS, WHEEL_RADIUS),
      0.1,
      1,
    ),
    rpm = bounded(finite(telemetry.powertrain.rpm, 1000), 0, 16000),
    availableTorque = bounded(
      finite(engineTorqueAtRpm(rpm, setup), positive(setup.peakTorque, 300)),
      1,
      3000,
    ),
    load = bounded(telemetry.powertrain.engineTorque / availableTorque),
    shifting = Boolean(telemetry.powertrain.shifting),
    gear = Number.isInteger(telemetry.powertrain.gear)
      ? bounded(telemetry.powertrain.gear, -1, 6)
      : 0,
    engaged = gear !== 0 && !shifting,
    dt = previous ? telemetry.time - previous.time : 0,
    dv = previous
      ? Math.hypot(
          finite(telemetry.velocity.x) - finite(previous.velocity.x),
          finite(telemetry.velocity.y) - finite(previous.velocity.y),
          finite(telemetry.velocity.z) - finite(previous.velocity.z),
        )
      : 0;
  return {
    time: finite(telemetry.time),
    engine: {
      rpm,
      load,
      driveLoad: engaged ? bounded(telemetry.powertrain.clutchTorque / availableTorque) : 0,
      shifting,
      gear,
      overrun: engaged
        ? bounded(-telemetry.powertrain.clutchTorque / availableTorque) * (1 - load)
        : 0,
    },
    wheels: WHEEL_IDS.map((id) =>
      tyreControl(id, telemetry.wheels.find((wheel) => wheel.id === id), setup, radius),
    ),
    impact:
      previous &&
      dt > 0 &&
      dt < 0.1 &&
      finite(previous.speed) > 4 &&
      [telemetry.velocity, previous.velocity].every((velocity) =>
        [velocity.x, velocity.y, velocity.z].every(Number.isFinite),
      )
        ? bounded((dv - 2.5) / 9)
        : 0,
  };
}

/** Retain brief 120 Hz events until the render frame consumes them. */
export class AudioControlCollector {
  private previous?: VehicleTelemetry;
  private pending?: AudioControlFrame;
  private pendingSince = 0;

  capture(telemetry: VehicleTelemetry, setup: VehicleSetup): void {
    const dt = this.previous ? telemetry.time - this.previous.time : 0;
    if (
      !Number.isFinite(telemetry.time) ||
      (this.previous && (!Number.isFinite(dt) || dt <= 0 || dt > 0.25))
    )
      this.reset();
    // Never queue a long catch-up interval as future sound.
    if (this.pending && telemetry.time - this.pendingSince > 0.1)
      this.pending = undefined;
    const frame = deriveAudioControls(telemetry, setup, this.previous);
    if (this.pending) {
      frame.engine.shifting ||= this.pending.engine.shifting;
      frame.impact = Math.max(frame.impact, this.pending.impact);
      frame.wheels.forEach((wheel, index) => {
        // Contact loss (or a zero-load contact) always wins over retained peaks.
        if (!wheel.grounded) return;
        const peak = this.pending!.wheels[index];
        wheel.warning = Math.min(wheel.load, Math.max(wheel.warning, peak.warning));
        wheel.slip = Math.min(wheel.load, Math.max(wheel.slip, peak.slip));
        wheel.absActive ||= peak.absActive;
        wheel.tractionActive ||= peak.tractionActive;
      });
    } else this.pendingSince = frame.time;
    this.pending = frame;
    // Only the velocity snapshot is used by impact extraction. Copy it so a
    // caller reusing a telemetry vector cannot change the previous sample.
    this.previous = { ...telemetry, velocity: { ...telemetry.velocity } };
  }

  flush(): AudioControlFrame | undefined {
    const frame = this.pending;
    this.pending = undefined;
    return frame;
  }

  reset(): void {
    this.previous = undefined;
    this.pending = undefined;
    this.pendingSince = 0;
  }
}
