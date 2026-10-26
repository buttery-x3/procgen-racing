import type { VehicleTelemetry } from "../vehicle/types";
import { clamp } from "../core/math";
import { tyreSlipPower } from "../core/tyreFeedback";

export function drivingFeedback(
  t: VehicleTelemetry,
  previous?: VehicleTelemetry,
) {
  let energy = 0,
    slidingEnergy = 0;
  for (const w of t.wheels) {
    const power = tyreSlipPower(w),
      // Keep ordinary grip feedback at 20% sensitivity, then smoothly recover
      // the existing peak for wheelspin/lockup or a large sideways slide.
      slip = Math.hypot(w.slipRatio / 0.8, w.slipAngle / (Math.PI / 6)),
      slide = clamp((slip - 0.25) / 0.75, 0, 1);
    energy += power;
    slidingEnergy += power * slide * slide * (3 - 2 * slide);
  }
  const scrub =
    Math.min(1, Math.sqrt(energy / 40000)) *
    Math.min(1, t.speed / 8) *
    (energy > 0 ? 0.2 + (0.8 * slidingEnergy) / energy : 0);
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
