import type { WheelId } from "../vehicle/types";
import type { AudioSettings, EngineAudioControl, EngineAudioProfile, TyreAudioControl } from "./types";

export interface EngineAudioSource {
  update(control: EngineAudioControl, time: number): void;
  dispose(): void;
}
export interface WheelAudioSource {
  readonly ready?: Promise<void>;
  update(control: TyreAudioControl, settings: AudioSettings, time: number): void;
  reset(time: number): void;
  dispose(): void;
}
export interface AudioSourceFactory {
  engine(output: AudioNode, profile: EngineAudioProfile, onError: (error: Error) => void): EngineAudioSource;
  wheel(id: WheelId, tyre: AudioNode, surface: AudioNode, onError: (error: Error) => void): WheelAudioSource;
}
