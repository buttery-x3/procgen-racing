import type { CircuitBake } from "./SurfaceCompiler";

export type CircuitFamily = "touring" | "gp";
export interface LegacyRecipe {
  version: 1;
  seed: string;
  family: CircuitFamily;
  relief: "gentle" | "rolling";
  targetLength: number;
}
export interface DesignRecipe {
  version: 2;
  seed: string;
  family: CircuitFamily;
  relief: "gentle" | "rolling";
  targetLength: number;
  character: "mixed" | "flowing" | "technical";
  envelope: "comfortable" | "terrain";
  /** Separate deterministic alternatives on the same land. */
  layout: number;
}
export type GenerationRecipe = LegacyRecipe | DesignRecipe;
export const DEFAULT_RECIPE: LegacyRecipe = {
  version: 1,
  seed: "ridge-104",
  family: "touring",
  relief: "rolling",
  targetLength: 2400,
};
export const DEFAULT_DESIGN_RECIPE: DesignRecipe = {
  version: 2,
  seed: "ridge-104",
  family: "touring",
  relief: "rolling",
  targetLength: 3200,
  character: "mixed",
  envelope: "comfortable",
  layout: 0,
};
export function normalizeRecipe(input: GenerationRecipe): GenerationRecipe {
  if (input.version !== 1 && input.version !== 2)
    throw new Error("Unsupported circuit recipe version.");
  const family = input.family === "gp" ? "gp" : "touring";
  const base = {
    version: input.version,
    seed: String(input.seed).trim().slice(0, 64) || "ridge-104",
    family,
    relief: input.relief === "gentle" ? "gentle" : "rolling",
    targetLength:
      Math.round(
        Math.max(
          input.version === 1
            ? family === "gp"
              ? 3200
              : 1800
            : family === "gp"
              ? 4000
              : 2000,
          Math.min(
            input.version === 1
              ? family === "gp"
                ? 5200
                : 3200
              : family === "gp"
                ? 7500
                : 4500,
            Number(input.targetLength) || (family === "gp" ? 4000 : 2400),
          ),
        ) / 100,
      ) * 100,
  };
  if (input.version === 1) return { ...base, version: 1 } as LegacyRecipe;
  return {
    ...base,
    version: 2,
    character:
      input.character === "flowing" || input.character === "technical"
        ? input.character
        : "mixed",
    envelope: input.envelope === "terrain" ? "terrain" : "comfortable",
    layout: Math.max(0, Math.min(99, Math.floor(Number(input.layout) || 0))),
  } as DesignRecipe;
}
export interface ValidationCheck {
  name: string;
  status: "pass" | "fail";
  detail: string;
}
export interface CircuitMetrics {
  length: number;
  elevationRange: number;
  maxGrade: number;
  maxBank: number;
  minWidth: number;
  maxWidth: number;
  minRadius: number;
  clearance: number;
  maxWidthRate: number;
  maxBankRate: number;
  crestG: number;
  compressionG: number;
  startStraight: number;
  earthworkRms: number;
  designSpeed: number;
}
export interface ValidationReport {
  valid: boolean;
  checks: ValidationCheck[];
  metrics: CircuitMetrics;
  rhythm?: { corners: number; changes: number };
}
export interface GenerationAttempt {
  attempt: number;
  reasons: string[];
}
export interface GenerationResult {
  recipe: GenerationRecipe;
  circuit: CircuitBake;
  report: ValidationReport;
  attempts: GenerationAttempt[];
  fallback: boolean;
  fingerprint: string;
  design?: DesignReport;
}
export interface SiteFeature {
  id: string;
  x: number;
  z: number;
  height: number;
  slope: number;
  kind: "flat" | "ridge" | "valley" | "slope";
}
export interface DesignReport {
  referenceLines?: {
    vehicle: "touring" | "gt" | "prototype";
    points: { at: number; lateral: number; speed: number }[];
  }[];
  generator: string;
  mode: "sequence" | "anchors";
  proposalCount: number;
  feasibleCount: number;
  closureShare: number;
  closureAdjustment: number;
  fittingDeviation: number;
  directionChanges: number;
  longStraights: number;
  hullOccupancy: number;
  cutFillRms: number;
  cutFillMax: number;
  earthworkVolume: number;
  retainedRelief: number;
  siteFeatures: SiteFeature[];
  siteRoute?: SiteFeature[];
  motifs: { at: number; end: number; role: string; speed: number }[];
  diagnostics: {
    at: number;
    natural: number;
    road: number;
    speed: number;
    grade: number;
    bank: number;
    width: number;
    curvature: number;
    clearance: number;
    cutFill: number;
  }[];
  reservations: {
    kind: "paddock" | "access" | "escape";
    x: number;
    z: number;
    width: number;
    length: number;
    heading: number;
  }[];
  candidateScores: {
    earthwork: number | null;
    rhythm: number;
    site: number;
    accepted: boolean;
  }[];
  rejections: Record<string, number>;
}
export interface GenerationProgress {
  stage: string;
  fraction: number;
}
