import { clamp } from "../core/math";
import type { DifferentialMode, VehicleSetup } from "./types";
import { WHEEL_INERTIA } from "./Tyre";

export function splitAxleTorque(
  torque: number,
  leftOmega: number,
  rightOmega: number,
  mode: DifferentialMode,
  locking: number,
  dt: number,
): [number, number] {
  if (mode === "open") return [torque / 2, torque / 2];
  const speedDifference = rightOmega - leftOmega;
  const equalizingLimit =
    (Math.abs(speedDifference) * WHEEL_INERTIA) / (2 * dt);
  const capacity =
    mode === "locked"
      ? equalizingLimit
      : (Math.abs(torque) * 0.5 + 70) * locking;
  const transfer = clamp(
    speedDifference * (mode === "locked" ? WHEEL_INERTIA / (2 * dt) : 18),
    -Math.min(capacity, equalizingLimit),
    Math.min(capacity, equalizingLimit),
  );
  return [torque / 2 + transfer, torque / 2 - transfer];
}

export function distributeDriveTorque(
  torque: number,
  omega: number[],
  setup: VehicleSetup,
  dt: number,
) {
  let front =
    setup.drive === "fwd"
      ? torque
      : setup.drive === "awd"
        ? torque * setup.awdFrontSplit
        : 0;
  let rear = torque - front;
  if (setup.drive === "awd" && setup.centreDiff !== "open") {
    const speedDifference = (omega[2] + omega[3] - omega[0] - omega[1]) / 2;
    const capacity =
      (Math.abs(torque) * 0.45 + 70) *
      (setup.centreDiff === "locked" ? 1 : setup.diffLock);
    const limit = (Math.abs(speedDifference) * WHEEL_INERTIA) / dt;
    const transfer = clamp(
      speedDifference * 24,
      -Math.min(capacity, limit),
      Math.min(capacity, limit),
    );
    front += transfer;
    rear -= transfer;
  }
  const f =
    setup.drive !== "rwd"
      ? splitAxleTorque(
          front,
          omega[0],
          omega[1],
          setup.frontDiff,
          setup.diffLock,
          dt,
        )
      : [0, 0];
  const r =
    setup.drive !== "fwd"
      ? splitAxleTorque(
          rear,
          omega[2],
          omega[3],
          setup.rearDiff,
          setup.diffLock,
          dt,
        )
      : [0, 0];
  return [...f, ...r];
}
