import { clamp } from "../core/math";
import { WHEEL_RADIUS } from "./types";
import type { VehicleSetup } from "./types";

export const WHEEL_INERTIA = 1.45;
export interface TyreState {
  omega: number;
  spin: number;
  fx: number;
  fy: number;
}
export const createTyreState = (): TyreState => ({
  omega: 0,
  spin: 0,
  fx: 0,
  fy: 0,
});
export function slipRatio(
  omega: number,
  velocity: number,
  radius = WHEEL_RADIUS,
) {
  return (
    (omega * radius - velocity) /
    Math.max(Math.abs(velocity), Math.abs(omega * radius), 1.5)
  );
}
export function gripCapacity(
  load: number,
  restLoad: number,
  surface: number,
  setup: VehicleSetup,
) {
  return (
    Math.max(0, load) *
    setup.grip *
    surface *
    clamp(
      Math.pow(Math.max(load, 1) / restLoad, -setup.loadSensitivity),
      0.65,
      1.35,
    )
  );
}

/** Combined-slip brush-like curve: linear near zero, a peak, then a broad sliding plateau. */
export function tyreForces(
  ratio: number,
  angle: number,
  capacity: number,
  setup: VehicleSetup,
) {
  const x = ratio / setup.longitudinalPeak;
  const y = -Math.tan(angle) / Math.tan(setup.lateralPeak);
  const q = Math.hypot(x, y);
  if (q < 1e-9 || capacity <= 0) return { fx: 0, fy: 0 };
  const response =
    q <= 1
      ? Math.sin((q * Math.PI) / 2)
      : setup.slideGrip + (1 - setup.slideGrip) * Math.exp(-(q - 1) * 0.7);
  return {
    fx: (capacity * response * x) / q,
    fy: (capacity * response * y) / q,
  };
}

export function integrateTyre(
  state: TyreState,
  longitudinal: number,
  lateral: number,
  driveTorque: number,
  brakeTorque: number,
  capacity: number,
  cornerMass: number,
  setup: VehicleSetup,
  dt: number,
  radius = WHEEL_RADIUS,
  inertia = WHEEL_INERTIA,
) {
  const freeOmega = state.omega + (driveTorque * dt) / inertia;
  const brakeDelta = (Math.max(0, brakeTorque) * dt) / inertia;
  const predictedOmega =
    Math.sign(freeOmega) * Math.max(0, Math.abs(freeOmega) - brakeDelta);
  const ratio = slipRatio(predictedOmega, longitudinal, radius);
  const angle = Math.atan2(lateral, Math.max(Math.abs(longitudinal), 1.5));
  const force = tyreForces(ratio, angle, capacity, setup);
  const relaxation =
    1 - Math.exp((-Math.max(Math.abs(longitudinal), 3) * dt) / 0.12);
  let fx = state.fx + (force.fx - state.fx) * relaxation;
  let fy = state.fy + (force.fy - state.fy) * relaxation;
  // Contact impulse must not reverse the wheel/road relative velocity in a single step.
  // This avoids stiff low-speed wheel oscillation without overriding chassis velocity.
  const relative = predictedOmega * radius - longitudinal;
  const maximumFx = relative / ((radius ** 2 * dt) / inertia + dt / cornerMass);
  fx =
    relative >= 0
      ? clamp(fx, 0, Math.max(0, maximumFx))
      : clamp(fx, Math.min(0, maximumFx), 0);
  const lateralLimit = (Math.abs(lateral) * cornerMass) / dt;
  fy = clamp(fy, -lateralLimit, lateralLimit);
  const utilization = Math.hypot(fx, fy) / Math.max(capacity, 1e-6);
  if (utilization > 1) {
    fx /= utilization;
    fy /= utilization;
  }
  const unbrakedOmega = freeOmega - (fx * radius * dt) / inertia;
  state.omega =
    Math.sign(unbrakedOmega) *
    Math.max(0, Math.abs(unbrakedOmega) - brakeDelta);
  state.spin += state.omega * dt;
  state.fx = fx;
  state.fy = fy;
  return { fx, fy, ratio: slipRatio(state.omega, longitudinal, radius), angle };
}
