import type { SurfaceId } from "../track/types";
import type { CarDefinition } from "./CarDefinition";
/** Metres, kilograms, seconds, radians, newtons. +Y up, +Z forward, +X LEFT. */
export type WheelId = "fl" | "fr" | "rl" | "rr";
export const WHEEL_IDS: readonly WheelId[] = ["fl", "fr", "rl", "rr"];
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Rotation {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface VehicleSetup {
  mass: number;
  wheelbase: number;
  trackWidth: number;
  frontWeight: number;
  frontSpring: number;
  rearSpring: number;
  frontDamping: number;
  rearDamping: number;
  frontAntiRoll: number;
  rearAntiRoll: number;
  restLength: number;
  travel: number;
  grip: number;
  drive: "rwd" | "fwd" | "awd";
  enginePosition: "front" | "mid" | "rear";
  referenceCar: "ff" | "fr" | "mr" | "awd";
  peakTorque: number;
  redline: number;
  finalDrive: number;
  gearing: "road" | "close" | "long";
  transmission: "automatic" | "manual";
  frontDiff: DifferentialMode;
  rearDiff: DifferentialMode;
  centreDiff: DifferentialMode;
  diffLock: number;
  awdFrontSplit: number;
  brakeTorque: number;
  brakeBias: number;
  engineBraking: number;
  longitudinalPeak: number;
  lateralPeak: number;
  slideGrip: number;
  loadSensitivity: number;
  tractionControl: number;
  abs: number;
  stabilityAssist: number;
  countersteerAssist: number;
  steeringLimit: number;
  speedSteering: number;
  autoHold: number;
  dragArea: number;
  downforceArea: number;
  vehicle?: CarDefinition;
  corners?: Partial<
    Record<
      WheelId,
      { springScale: number; dampingScale: number; rideOffset: number }
    >
  >;
}
export type DifferentialMode = "open" | "lsd" | "locked";
export type NumericSetupKey = {
  [K in keyof VehicleSetup]-?: VehicleSetup[K] extends number ? K : never;
}[keyof VehicleSetup];

export interface VehicleControls {
  throttle: number;
  brake: number;
  steer: number;
  handbrake?: number;
}
export const NO_CONTROLS: VehicleControls = { throttle: 0, brake: 0, steer: 0 };

export interface WheelTelemetry {
  id: WheelId;
  grounded: boolean;
  length: number;
  compression: number;
  compressionRatio: number;
  load: number;
  lateralSpeed: number;
  longitudinalSpeed: number;
  slipAngle: number;
  steer: number;
  spin: number;
  angularSpeed: number;
  slipRatio: number;
  longitudinalForce: number;
  lateralForce: number;
  driveTorque: number;
  brakeTorque: number;
  surfaceGrip: number;
  surface: SurfaceId;
  surfaceBlend?: { surface: SurfaceId; weight: number }[];
  surfaceRoughness?: number;
  absActive: boolean;
  tractionActive: boolean;
  mount: Vec3;
  hub: Vec3;
  contact: Vec3;
  normal: Vec3;
}

export interface VehicleTelemetry {
  time: number;
  position: Vec3;
  rotation: Rotation;
  velocity: Vec3;
  speed: number;
  /** Display telemetry angles in degrees; simulation and setup angles use radians. */
  pitch: number;
  roll: number;
  worldPitch: number;
  worldRoll: number;
  roadPitch: number;
  roadRoll: number;
  roadReferenceValid: boolean;
  groundedCount: number;
  totalLoad: number;
  frontLoadFraction: number;
  wheels: WheelTelemetry[];
  controls: VehicleControls;
  powertrain: PowertrainTelemetry;
  assists: {
    traction: number;
    abs: number;
    stability: number;
    countersteer: number;
    hold: boolean;
  };
  track?: {
    station: number;
    distance: number;
    length: number;
    lapDistance: number;
    lateral: number;
    grade: number;
    bank: number;
    width: number;
    section: string;
  };
}
export interface PowertrainTelemetry {
  rpm: number;
  gear: number;
  ratio: number;
  engineTorque: number;
  clutchTorque: number;
  shifting: boolean;
}

export type Experiment =
  | "level"
  | "bump"
  | "pitch"
  | "bank"
  | "handling"
  | "split"
  | "comparison"
  | "circuit";
export const WHEEL_RADIUS = 0.32;
export const GRAVITY = 9.81;
export const FIXED_STEP = 1 / 120;
