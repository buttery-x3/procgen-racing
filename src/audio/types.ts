import type { WheelId } from "../vehicle/types";

/** Audio control values are cosmetic, bounded estimates; they never feed physics. */
export interface EngineAudioControl {
  rpm: number;
  load: number;
  driveLoad: number;
  shifting: boolean;
  gear: number;
  overrun: number;
}
export interface TyreAudioControl {
  id: WheelId;
  grounded: boolean;
  warning: number;
  slip: number;
  rolling: number;
  speed: number;
  slipSpeed: number;
  demand: number;
  load: number;
  kerb: number;
  gravel: number;
  sand: number;
  grass: number;
  tarmac: number;
  roughness: number;
  absActive: boolean;
  tractionActive: boolean;
}
export interface AudioControlFrame {
  time: number;
  engine: EngineAudioControl;
  wheels: TyreAudioControl[];
  impact: number;
}
export type AudioOutputMode = "headphones" | "stereo" | "mono";
export interface AudioSettings {
  version: 1;
  enabled: boolean;
  master: number;
  engine: number;
  tyres: number;
  surface: number;
  output: AudioOutputMode;
  axleCue: number;
  width: number;
  softSqueal: boolean;
}
export type EngineProfileId = "compact" | "sport" | "deep";
export interface EngineAudioProfile {
  id: EngineProfileId;
  cylinders: number;
  body: number;
  brightness: number;
  irregularity: number;
  seed: number;
}
