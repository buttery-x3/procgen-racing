import type { VehicleTelemetry } from "../vehicle/types";
export function drivingFeedback(
  t: VehicleTelemetry,
  previous?: VehicleTelemetry,
) {
  let energy = 0;
  for (const w of t.wheels)
    if (w.grounded)
      energy +=
        Math.abs(w.longitudinalForce * w.longitudinalSpeed * w.slipRatio) +
        Math.abs(w.lateralForce * w.lateralSpeed);
  const scrub =
    Math.min(1, Math.sqrt(energy / 40000)) * Math.min(1, t.speed / 8);
  const dt = previous ? t.time - previous.time : 0,
    dv = previous
      ? Math.hypot(
          t.velocity.x - previous.velocity.x,
          t.velocity.y - previous.velocity.y,
          t.velocity.z - previous.velocity.z,
        )
      : 0;
  return {
    engineFrequency: Math.max(25, Math.min(420, t.powertrain.rpm / 30)),
    engineLoad: 0.25 + Math.max(0, Math.min(1, t.controls.throttle)) * 0.75,
    scrub,
    impact:
      previous && dt > 0 && dt < 0.1 && previous.speed > 4
        ? Math.max(0, Math.min(1, (dv - 2.5) / 9))
        : 0,
  };
}
