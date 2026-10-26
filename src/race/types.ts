import type { SessionIdentity } from "./identity";
import type { GhostData } from "./Ghost";
export type SessionMode = "practice" | "time-trial";
export interface LapResult {
  id: string;
  lap: number;
  duration: number;
  sectors: number[];
  valid: boolean;
  reasons: string[];
  mode: SessionMode;
  identity: SessionIdentity;
  finishedAt: string;
}
export interface SavedSession {
  version: 1;
  identity: SessionIdentity;
  trackName: string;
  carName: string;
  best: LapResult | null;
  recent: LapResult[];
  updatedAt: string;
  ghostAvailable: boolean;
}
export interface SessionSnapshot {
  mode: SessionMode;
  state: "out-lap" | "running" | "invalid";
  lap: number;
  elapsed: number;
  sectors: number[];
  nextSector: number;
  progress: number;
  delta: number | null;
  reasons: string[];
  flag: "green" | "yellow" | "pit";
  message: string;
  best: LapResult | null;
  recent: LapResult[];
  identity: SessionIdentity;
  imported: boolean;
  referenceAvailable: boolean;
}
export interface CompletedLap {
  result: LapResult;
  ghost?: GhostData;
  personalBest: boolean;
}
