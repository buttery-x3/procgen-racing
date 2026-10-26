import { clamp } from "../core/math";
import type { VehicleSetup, NumericSetupKey } from "./types";
import { decodeCarDefinition } from "./CarDefinition";

export const DEFAULT_SETUP: VehicleSetup = {
  mass: 1250,
  wheelbase: 2.65,
  trackWidth: 1.62,
  frontWeight: 0.54,
  frontSpring: 35000,
  rearSpring: 32000,
  frontDamping: 3600,
  rearDamping: 3300,
  frontAntiRoll: 9000,
  rearAntiRoll: 6500,
  restLength: 0.43,
  travel: 0.28,
  grip: 1.05,
  drive: "rwd",
  enginePosition: "front",
  referenceCar: "fr",
  peakTorque: 300,
  redline: 7000,
  finalDrive: 3.7,
  gearing: "road",
  transmission: "automatic",
  frontDiff: "open",
  rearDiff: "lsd",
  centreDiff: "lsd",
  diffLock: 0.45,
  awdFrontSplit: 0.45,
  brakeTorque: 2400,
  brakeBias: 0.62,
  engineBraking: 0.18,
  longitudinalPeak: 0.12,
  lateralPeak: 0.14,
  slideGrip: 0.78,
  loadSensitivity: 0.1,
  tractionControl: 0.65,
  abs: 1,
  stabilityAssist: 0.45,
  countersteerAssist: 0.3,
  steeringLimit: 0.5,
  speedSteering: 0.65,
  autoHold: 1,
  dragArea: 0.68,
  downforceArea: 0,
};

export const PRESETS: Record<
  string,
  { label: string; description: string; setup: VehicleSetup }
> = {
  balanced: {
    label: "Balanced",
    description: "A composed road-car baseline.",
    setup: { ...DEFAULT_SETUP },
  },
  comfort: {
    label: "Comfort",
    description: "Softer springs. More body movement.",
    setup: {
      ...DEFAULT_SETUP,
      frontSpring: 26000,
      rearSpring: 24000,
      frontDamping: 2500,
      rearDamping: 2300,
      frontAntiRoll: 4000,
      rearAntiRoll: 3000,
    },
  },
  track: {
    label: "Track",
    description: "Firm support. Quicker settling.",
    setup: {
      ...DEFAULT_SETUP,
      frontSpring: 58000,
      rearSpring: 52000,
      frontDamping: 5300,
      rearDamping: 4800,
      frontAntiRoll: 17000,
      rearAntiRoll: 13000,
    },
  },
};

const BOUNDS: Record<NumericSetupKey, readonly [number, number]> = {
  mass: [450, 2600],
  wheelbase: [2.05, 3.45],
  trackWidth: [1.3, 2.1],
  frontWeight: [0.3, 0.68],
  frontSpring: [12000, 180000],
  rearSpring: [12000, 180000],
  frontDamping: [1200, 10000],
  rearDamping: [1200, 10000],
  frontAntiRoll: [0, 30000],
  rearAntiRoll: [0, 30000],
  restLength: [0.18, 0.58],
  travel: [0.1, 0.36],
  grip: [0.5, 2.1],
  peakTorque: [80, 1100],
  redline: [4500, 14000],
  finalDrive: [2.5, 5.5],
  diffLock: [0, 1],
  awdFrontSplit: [0.1, 0.9],
  brakeTorque: [800, 4500],
  brakeBias: [0.4, 0.8],
  engineBraking: [0, 0.5],
  longitudinalPeak: [0.06, 0.25],
  lateralPeak: [0.07, 0.25],
  slideGrip: [0.55, 1],
  loadSensitivity: [0, 0.25],
  tractionControl: [0, 1],
  abs: [0, 1],
  stabilityAssist: [0, 1],
  countersteerAssist: [0, 1],
  steeringLimit: [0.25, 0.65],
  speedSteering: [0, 1],
  autoHold: [0, 1],
  dragArea: [0.3, 1.3],
  downforceArea: [0, 6],
};

export function sanitizeSetup(input: unknown): VehicleSetup {
  const candidate =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const result = { ...DEFAULT_SETUP };
  for (const key of Object.keys(BOUNDS) as (keyof typeof BOUNDS)[]) {
    const value = candidate[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = clamp(value, ...BOUNDS[key]);
    }
  }
  const enums = {
    drive: ["fwd", "rwd", "awd"],
    enginePosition: ["front", "mid", "rear"],
    referenceCar: ["ff", "fr", "mr", "awd"],
    gearing: ["road", "close", "long"],
    transmission: ["automatic", "manual"],
    frontDiff: ["open", "lsd", "locked"],
    rearDiff: ["open", "lsd", "locked"],
    centreDiff: ["open", "lsd", "locked"],
  } as const;
  for (const key of Object.keys(enums) as (keyof typeof enums)[]) {
    if ((enums[key] as readonly unknown[]).includes(candidate[key]))
      Object.assign(result, { [key]: candidate[key] });
  }
  const vehicle = decodeCarDefinition(candidate.vehicle);
  if (vehicle) {
    result.vehicle = vehicle;
    result.enginePosition =
      vehicle.recipe.layout === "RR"
        ? "rear"
        : vehicle.recipe.layout.startsWith("M")
          ? "mid"
          : "front";
  }
  if (candidate.corners && typeof candidate.corners === "object") {
    result.corners = {};
    for (const id of ["fl", "fr", "rl", "rr"] as const) {
      const c = (candidate.corners as VehicleSetup["corners"])?.[id];
      if (
        c &&
        [c.springScale, c.dampingScale, c.rideOffset].every(Number.isFinite)
      )
        result.corners[id] = {
          springScale: clamp(c.springScale, 0.65, 1.4),
          dampingScale: clamp(c.dampingScale, 0.65, 1.4),
          rideOffset: clamp(c.rideOffset, -0.03, 0.03),
        };
    }
  }
  return result;
}

export const STRUCTURAL_KEYS = new Set<keyof VehicleSetup>([
  "mass",
  "wheelbase",
  "trackWidth",
  "frontWeight",
  "enginePosition",
  "referenceCar",
]);

export function rideFrequency(setup: VehicleSetup, front: boolean) {
  const cornerMass =
    (setup.mass * (front ? setup.frontWeight : 1 - setup.frontWeight)) / 2;
  return (
    Math.sqrt((front ? setup.frontSpring : setup.rearSpring) / cornerMass) /
    (2 * Math.PI)
  );
}
