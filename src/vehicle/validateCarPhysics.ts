import type { VehicleSetup } from "./types";
import { runSetupTest } from "../workbench/runComparison";
import type { RunMetrics } from "../workbench/TelemetryTrace";
export interface CarPhysicsValidation {
  valid: boolean;
  detail: string;
  metrics: RunMetrics;
  loadRatio: number;
  frontFraction: number;
}
/** Same fixed-step simulator as driving, on an isolated level asphalt fixture. */
export async function validateCarPhysics(
  setup: VehicleSetup,
): Promise<CarPhysicsValidation> {
  const run = await runSetupTest(setup, "launch-brake", "Construction check"),
    tail = run.samples.slice(-240),
    m = run.metrics!;
  const total =
      tail.reduce((sum, s) => sum + s.loads.reduce((n, v) => n + v, 0), 0) /
      tail.length,
    front =
      tail.reduce((sum, s) => sum + s.loads[0] + s.loads[1], 0) / tail.length;
  const loadRatio = total / (setup.mass * 9.81),
    frontFraction = front / total;
  const failures: string[] = [];
  if (
    !run.samples.every((s) =>
      [s.speed, s.roll, s.pitch, ...s.loads, ...s.slip].every(Number.isFinite),
    )
  )
    failures.push("non-finite response");
  if (
    Math.abs(loadRatio - 1) > 0.025 ||
    Math.abs(frontFraction - setup.frontWeight) > 0.025
  )
    failures.push("static axle support does not match the component mass");
  if (
    m.maxSpeed < 2 ||
    m.stopDistance === null ||
    run.samples.at(-1)!.speed > 0.6
  )
    failures.push("launch or braking did not complete");
  if (
    m.groundedFraction < 0.97 ||
    m.peakLoad > 3.5 ||
    m.peakRoll > 18 ||
    m.peakPitch > 18
  )
    failures.push("unstable wheel support");
  return {
    valid: failures.length === 0,
    detail: failures.length
      ? failures.join("; ")
      : `12 s launch/brake check · ${(loadRatio * 100).toFixed(1)}% weight supported · ${(frontFraction * 100).toFixed(1)}% front at rest`,
    metrics: m,
    loadRatio,
    frontFraction,
  };
}
