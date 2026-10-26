import { SuspensionRig, initializePhysics } from "../physics/SuspensionRig";
import { FIXED_STEP } from "../vehicle/types";
import type { VehicleControls, VehicleSetup } from "../vehicle/types";
import { makeTrace, traceSample } from "./TelemetryTrace";
import type { RunMetrics } from "./TelemetryTrace";
export type ComparisonScenario = "launch-brake" | "slalom" | "drop";
export const SCENARIOS: Record<
  ComparisonScenario,
  { name: string; duration: number; description: string }
> = {
  "launch-brake": {
    name: "Launch & braking",
    duration: 12,
    description:
      "Flat asphalt · 65% throttle for 4.5 s, then full braking · 120 Hz",
  },
  slalom: {
    name: "Steering response",
    duration: 12,
    description:
      "Flat asphalt · fixed throttle and sinusoidal steering after 3 s · 120 Hz",
  },
  drop: {
    name: "Suspension settling",
    duration: 6,
    description: "Level test pad · 0.6 m drop, no driving inputs · 120 Hz",
  },
};
export function scenarioControls(
  scenario: ComparisonScenario,
  time: number,
): VehicleControls {
  if (scenario === "drop") return { throttle: 0, brake: 0, steer: 0 };
  if (scenario === "launch-brake")
    return {
      throttle: time < 4.5 ? 0.65 : 0,
      brake: time >= 4.5 ? 1 : 0,
      steer: 0,
    };
  return {
    throttle: time < 3 ? 0.48 : 0.27,
    brake: 0,
    steer: time < 3 ? 0 : Math.sin((time - 3) * 1.8) * 0.24,
  };
}
export async function runSetupTest(
  setup: VehicleSetup,
  scenario: ComparisonScenario,
  name: string,
  progress?: (t: number) => void,
) {
  await initializePhysics();
  const rig = new SuspensionRig(setup),
    s = SCENARIOS[scenario];
  try {
    rig.setExperiment(scenario === "drop" ? "level" : "comparison");
    for (let i = 0; i < 360; i++) rig.step();
    if (scenario === "drop") rig.drop();
    const samples = [],
      metrics: RunMetrics = {
        distance: 0,
        maxSpeed: 0,
        zeroTo60: null,
        stopDistance: null,
        peakRoll: 0,
        peakPitch: 0,
        groundedFraction: 0,
        peakLoad: 0,
      };
    let previous = { ...rig.body.translation() },
      brakeDistance = 0,
      braking = false,
      stopped = false;
    for (let i = 0; i < s.duration / FIXED_STEP; i++) {
      const time = i * FIXED_STEP,
        controls = scenarioControls(scenario, time);
      rig.step(controls);
      const t = rig.telemetry,
        p = t.position,
        dist = Math.hypot(p.x - previous.x, p.z - previous.z);
      previous = { ...p };
      metrics.distance += dist;
      metrics.maxSpeed = Math.max(metrics.maxSpeed, t.speed * 3.6);
      if (metrics.zeroTo60 === null && t.speed >= 60 / 3.6)
        metrics.zeroTo60 = (i + 1) * FIXED_STEP;
      if (controls.brake > 0) {
        if (!braking) {
          braking = true;
          brakeDistance = 0;
        }
        if (!stopped) brakeDistance += dist;
        if (!stopped && t.speed < 0.5) {
          metrics.stopDistance = brakeDistance;
          stopped = true;
        }
      }
      metrics.peakRoll = Math.max(metrics.peakRoll, Math.abs(t.roll));
      metrics.peakPitch = Math.max(metrics.peakPitch, Math.abs(t.pitch));
      metrics.groundedFraction +=
        t.groundedCount / 4 / (s.duration / FIXED_STEP);
      metrics.peakLoad = Math.max(
        metrics.peakLoad,
        t.totalLoad / (setup.mass * 9.81),
      );
      const sample = traceSample(t, rig.body.angvel().y);
      sample.time = (i + 1) * FIXED_STEP;
      samples.push(sample);
      if (i % 120 === 0) progress?.(time / s.duration);
    }
    const run = makeTrace(
      name,
      setup,
      `${scenario} · ${s.description}`,
      samples,
    );
    run.metrics = metrics;
    return run;
  } finally {
    rig.dispose();
  }
}
