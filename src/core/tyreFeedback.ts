import type { WheelTelemetry } from "../vehicle/types";

/** Dissipated contact power for presentation only; airborne wheels leave no feedback. */
export function tyreSlipPower(wheel: WheelTelemetry) {
  return wheel.grounded
    ? Math.abs(
        wheel.longitudinalForce * wheel.longitudinalSpeed * wheel.slipRatio,
      ) + Math.abs(wheel.lateralForce * wheel.lateralSpeed)
    : 0;
}
