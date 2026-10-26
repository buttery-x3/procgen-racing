import { clamp } from "../core/math";
import type { PowertrainTelemetry, VehicleSetup } from "./types";

export const GEAR_SETS = {
  road: [3.3, 2.16, 1.57, 1.22, 0.98, 0.8],
  close: [3.1, 2.28, 1.78, 1.44, 1.2, 1.02],
  long: [2.8, 1.85, 1.34, 1.03, 0.82, 0.67],
};
const RPM = 60 / (2 * Math.PI);
export function engineTorqueAtRpm(rpm: number, setup: VehicleSetup) {
  const ratio = rpm / setup.redline;
  const curve =
    ratio < 0.55
      ? 0.57 + (ratio / 0.55) * 0.43
      : 1 - (Math.max(0, ratio - 0.55) / 0.45) * 0.26;
  return setup.peakTorque * clamp(curve, 0.35, 1);
}

export class Powertrain {
  gear = 1;
  engineOmega = 1000 / RPM;
  private shiftTimer = 0;
  private shiftCooldown = 0;
  telemetry: PowertrainTelemetry = {
    rpm: 1000,
    gear: 1,
    ratio: 0,
    engineTorque: 0,
    clutchTorque: 0,
    shifting: false,
  };
  reset() {
    this.gear = 1;
    this.engineOmega = 1000 / RPM;
    this.shiftTimer = 0;
    this.shiftCooldown = 0;
  }
  requestGear(gear: number, speed: number) {
    if (!Number.isInteger(gear) || gear < -1 || gear > 6) return false;
    if (gear === this.gear) return true;
    if ((gear < 0 && speed > 0.5) || (gear > 0 && speed < -0.5)) return false;
    this.gear = gear;
    this.shiftTimer = 0.16;
    this.shiftCooldown = 0.7;
    return true;
  }
  shift(direction: number, speed: number) {
    return this.requestGear(clamp(this.gear + direction, -1, 6), speed);
  }
  step(
    throttle: number,
    signedSpeed: number,
    omega: number[],
    setup: VehicleSetup,
    dt: number,
  ) {
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    if (
      setup.transmission === "automatic" &&
      this.gear > 0 &&
      this.shiftCooldown === 0
    ) {
      if (
        this.engineOmega * RPM > setup.redline * 0.89 &&
        Math.abs(signedSpeed) > 4 &&
        this.gear < 6
      )
        this.requestGear(this.gear + 1, signedSpeed);
      else if (this.engineOmega * RPM < setup.redline * 0.34 && this.gear > 1)
        this.requestGear(this.gear - 1, signedSpeed);
    }
    const ratio =
      this.gear < 0
        ? -3.15 * setup.finalDrive
        : this.gear === 0
          ? 0
          : GEAR_SETS[setup.gearing][this.gear - 1] * setup.finalDrive;
    const axleOmega =
      setup.drive === "fwd"
        ? (omega[0] + omega[1]) / 2
        : setup.drive === "rwd"
          ? (omega[2] + omega[3]) / 2
          : ((omega[0] + omega[1]) / 2) * setup.awdFrontSplit +
            ((omega[2] + omega[3]) / 2) * (1 - setup.awdFrontSplit);
    const engineTorque =
      engineTorqueAtRpm(this.engineOmega * RPM, setup) *
      throttle *
      (this.engineOmega * RPM < setup.redline ? 1 : 0);
    const engaging = clamp(Math.abs(signedSpeed) / 5 + throttle * 0.8, 0, 1);
    const capacity = setup.peakTorque * 1.4 * engaging;
    const clutchTorque =
      ratio && this.shiftTimer === 0
        ? clamp((this.engineOmega - axleOmega * ratio) * 5, -capacity, capacity)
        : 0;
    const engineDrag =
      12 +
      this.engineOmega * 0.04 +
      (1 - throttle) *
        setup.engineBraking *
        setup.peakTorque *
        clamp((this.engineOmega * RPM) / setup.redline, 0, 1);
    const idleControl = Math.max(0, 1000 / RPM - this.engineOmega) * 7;
    this.engineOmega = clamp(
      this.engineOmega +
        ((engineTorque + idleControl - engineDrag - clutchTorque) * dt) / 0.38,
      700 / RPM,
      (setup.redline * 1.04) / RPM,
    );
    this.telemetry = {
      rpm: this.engineOmega * RPM,
      gear: this.gear,
      ratio,
      engineTorque,
      clutchTorque,
      shifting: this.shiftTimer > 0,
    };
    return clutchTorque * ratio * 0.91;
  }
}
