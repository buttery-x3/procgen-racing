import type { EngineAudioControl, TyreAudioControl } from "./types";

export type FixtureId = "engine-idle" | "engine-light" | "engine-full" | "engine-sweep" | "engine-shift" | "tyre-scrub" | "tyre-onset" | "tyre-slide" | "tyre-recovery" | "tyre-cycle" | "manual";
export type SoloMode = "engine" | "tyre" | "surface" | "mix";
export type RouteMode = "dry" | "headphones" | "stereo" | "mono";

export interface EnginePlaygroundTuning {
  body: number;
  openness: number;
  rasp: number;
  unevenness: number;
  mechanical: number;
}

export interface LegacyTyrePlaygroundTuning {
  scrape: number;
  screech: number;
  roughness: number;
  brightness: number;
  onset: number;
  release: number;
}

export interface TonalTyrePlaygroundTuning {
  tone: number;
  edge: number;
  pitch: number;
  scrape: number;
  roughness: number;
  onset: number;
  release: number;
}

export interface ReferenceTyrePlaygroundTuning {
  character: number;
  texture: number;
  pitch: number;
  movement: number;
  onset: number;
  release: number;
}
export const REFERENCE_MODEL_ID = "local:tyre-spectrum-v1:2941a61b863996e39695905bf50e6fd07e55fca54ea51941901711317804fdf0";

interface BasePlaygroundPreset {
  format: "procgen-racing:audio-playground-preset";
  version: 1;
  name: string;
  seed: number;
  assetIds: string[];
  fixture: FixtureId;
  solo: SoloMode;
  route: RouteMode;
  wheel: "fl" | "fr" | "rl" | "rr";
  aTrim: number;
  bTrim: number;
  manual: ManualControls;
}

export type PlaygroundPreset = BasePlaygroundPreset & (
  { backend: "pulse-exhaust-friction-v1"; tuning: EnginePlaygroundTuning & LegacyTyrePlaygroundTuning } |
  { backend: "pulse-exhaust-tonal-v2"; tuning: EnginePlaygroundTuning & TonalTyrePlaygroundTuning } |
  { backend: "pulse-exhaust-reference-v3"; tuning: EnginePlaygroundTuning & ReferenceTyrePlaygroundTuning }
);

export const ENGINE_TUNING_KEYS = ["body", "openness", "rasp", "unevenness", "mechanical"] as const;
export const LEGACY_TYRE_TUNING_KEYS = ["scrape", "screech", "roughness", "brightness", "onset", "release"] as const;
export const TONAL_TYRE_TUNING_KEYS = ["tone", "edge", "pitch", "roughness", "scrape", "onset", "release"] as const;
export const REFERENCE_TYRE_TUNING_KEYS = ["character", "texture", "pitch", "movement", "onset", "release"] as const;

export function tuningKeys(backend: PlaygroundPreset["backend"]): readonly string[] {
  return [...ENGINE_TUNING_KEYS, ...(backend === "pulse-exhaust-reference-v3" ? REFERENCE_TYRE_TUNING_KEYS
    : backend === "pulse-exhaust-tonal-v2" ? TONAL_TYRE_TUNING_KEYS : LEGACY_TYRE_TUNING_KEYS)];
}

export const TONAL_PRESET: PlaygroundPreset = {
  format: "procgen-racing:audio-playground-preset", version: 1, name: "Tonal tyre starting point",
  backend: "pulse-exhaust-tonal-v2", seed: 0x51a3d207, assetIds: [], fixture: "tyre-slide",
  solo: "tyre", route: "dry", wheel: "fl", aTrim: 1, bTrim: 1,
  manual: { rpm: 2400, load: 0.55, slip: 0.6, slipSpeed: 8, wheelLoad: 0.8 },
  tuning: { body: 0.78, openness: 0.35, rasp: 0.28, unevenness: 0.35, mechanical: 0.16,
    tone: 0.74, edge: 0.7, pitch: 0.47, roughness: 0.64, scrape: 0, onset: 0.22, release: 0.36 },
};

export const DEFAULT_PRESET: PlaygroundPreset = {
  ...TONAL_PRESET, name: "Accepted screech · live control", backend: "pulse-exhaust-reference-v3",
  assetIds: [REFERENCE_MODEL_ID], fixture: "tyre-cycle",
  tuning: { body: 0.78, openness: 0.35, rasp: 0.28, unevenness: 0.35, mechanical: 0.16,
    character: 0.5, texture: 0.5, pitch: 0.5, movement: 0.65, onset: 0.22, release: 0.36 },
};

export const LEGACY_PRESET: PlaygroundPreset = {
  ...TONAL_PRESET, name: "First noise tyre prototype", backend: "pulse-exhaust-friction-v1",
  tuning: { body: 0.78, openness: 0.35, rasp: 0.28, unevenness: 0.35, mechanical: 0.16,
    scrape: 0.78, screech: 0.42, roughness: 0.7, brightness: 0.5, onset: 0.22, release: 0.36 },
};

export function parsePreset(value: unknown): PlaygroundPreset {
  if (!value || typeof value !== "object") throw new Error("Preset must be a JSON object.");
  const v = value as Record<string, unknown>;
  if (v.format !== DEFAULT_PRESET.format || v.version !== 1 ||
    (v.backend !== "pulse-exhaust-friction-v1" && v.backend !== "pulse-exhaust-tonal-v2" && v.backend !== "pulse-exhaust-reference-v3"))
    throw new Error("Unsupported preset format, version or sound backend.");
  const fixture = v.fixture as FixtureId;
  if (!(fixture in FIXTURES)) throw new Error("Unknown fixture.");
  if (!["engine", "tyre", "surface", "mix"].includes(String(v.solo))) throw new Error("Unknown solo mode.");
  if (!["dry", "headphones", "stereo", "mono"].includes(String(v.route))) throw new Error("Unknown output route.");
  if (!["fl", "fr", "rl", "rr"].includes(String(v.wheel))) throw new Error("Unknown wheel.");
  if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 80) throw new Error("Preset name must be 1–80 characters.");
  if (!Number.isInteger(v.seed) || (v.seed as number) < 0 || (v.seed as number) > 0xffffffff) throw new Error("Invalid seed.");
  if (!Array.isArray(v.assetIds) || (v.backend === "pulse-exhaust-reference-v3"
    ? v.assetIds.length !== 1 || v.assetIds[0] !== REFERENCE_MODEL_ID : v.assetIds.length !== 0))
    throw new Error("Invalid assets or local reference model identity.");
  const trim = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0.25 && value <= 4;
  if (!trim(v.aTrim) || !trim(v.bTrim)) throw new Error("Audition trims must be between 0.25 and 4.");
  if (!v.manual || typeof v.manual !== "object") throw new Error("Missing manual controls.");
  const manual = v.manual as Record<string, unknown>;
  for (const [key, low, high] of [["rpm", 700, 7500], ["load", 0, 1], ["slip", 0, 1], ["slipSpeed", 0, 30], ["wheelLoad", 0, 1]] as const) {
    const n = manual[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < low || n > high) throw new Error(`Invalid manual ${key}.`);
  }
  if (!v.tuning || typeof v.tuning !== "object") throw new Error("Missing tuning.");
  const tuning = v.tuning as Record<string, unknown>;
  const backend = v.backend as PlaygroundPreset["backend"];
  for (const key of tuningKeys(backend)) {
    const n = tuning[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) throw new Error(`Invalid ${key} control.`);
  }
  const common: BasePlaygroundPreset = { format: DEFAULT_PRESET.format, version: 1, name: v.name.trim(),
    seed: v.seed as number, assetIds: [...v.assetIds] as string[], fixture, solo: v.solo as SoloMode, route: v.route as RouteMode,
    wheel: v.wheel as PlaygroundPreset["wheel"], aTrim: v.aTrim as number, bTrim: v.bTrim as number,
    manual: Object.fromEntries(["rpm", "load", "slip", "slipSpeed", "wheelLoad"].map((key) => [key, manual[key]])) as unknown as ManualControls };
  const selectedTuning = Object.fromEntries(tuningKeys(backend).map((key) => [key, tuning[key]]));
  return backend === "pulse-exhaust-reference-v3"
    ? { ...common, backend, tuning: selectedTuning as unknown as EnginePlaygroundTuning & ReferenceTyrePlaygroundTuning }
    : backend === "pulse-exhaust-tonal-v2"
    ? { ...common, backend, tuning: selectedTuning as unknown as EnginePlaygroundTuning & TonalTyrePlaygroundTuning }
    : { ...common, backend, tuning: selectedTuning as unknown as EnginePlaygroundTuning & LegacyTyrePlaygroundTuning };
}

type Fixture = { label: string; duration: number; kind: "engine" | "tyre" | "both" };
export const FIXTURES: Record<FixtureId, Fixture> = {
  "engine-idle": { label: "Idle", duration: 7, kind: "engine" },
  "engine-light": { label: "Steady · light load", duration: 7, kind: "engine" },
  "engine-full": { label: "Steady · full load", duration: 7, kind: "engine" },
  "engine-sweep": { label: "Rev and load sweep", duration: 9, kind: "engine" },
  "engine-shift": { label: "Acceleration and shift", duration: 9, kind: "engine" },
  "tyre-scrub": { label: "Early scrub", duration: 7, kind: "tyre" },
  "tyre-onset": { label: "Sliding onset", duration: 8, kind: "tyre" },
  "tyre-slide": { label: "Sustained slide", duration: 7, kind: "tyre" },
  "tyre-recovery": { label: "Slide and recovery", duration: 8, kind: "tyre" },
  "tyre-cycle": { label: "Build → slide → recover → slide", duration: 10.5, kind: "tyre" },
  manual: { label: "Manual controls", duration: Infinity, kind: "both" },
};

export interface ManualControls { rpm: number; load: number; slip: number; slipSpeed: number; wheelLoad: number }
export const DEFAULT_MANUAL: ManualControls = { rpm: 2400, load: 0.55, slip: 0.6, slipSpeed: 8, wheelLoad: 0.8 };

const ramp = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Synthetic repeatable audition controls, sampled on the audio clock. */
export function fixtureControls(id: FixtureId, seconds: number, manual = DEFAULT_MANUAL): { engine: EngineAudioControl; tyre: TyreAudioControl } {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  let rpm = 900, load = 0.12, shifting = false, overrun = 0;
  let slip = 0, warning = 0, speed = 0, slipSpeed = 0, wheelLoad = 0.8;
  switch (id) {
    case "engine-light": rpm = 2700; load = 0.27; break;
    case "engine-full": rpm = 3900; load = 0.9; break;
    case "engine-sweep": {
      const up = ramp(s, 0.8, 5.2), down = ramp(s, 5.5, 8.4);
      rpm = lerp(950, 6100, up) - 3900 * down;
      load = 0.2 + 0.7 * up * (1 - down);
      overrun = down;
      break;
    }
    case "engine-shift": {
      rpm = s < 4.4 ? lerp(1200, 5900, ramp(s, 0.6, 4.4)) : s < 5.1 ? lerp(5900, 3700, ramp(s, 4.4, 5.1)) : lerp(3700, 5200, ramp(s, 5.1, 8.7));
      load = 0.85; shifting = s >= 4.4 && s < 4.85; break;
    }
    case "tyre-scrub": speed = 17; warning = 0.48; slip = 0.1; slipSpeed = 1.2; break;
    case "tyre-onset": speed = 23; slip = 0.8 * ramp(s, 0.8, 4.7); warning = 0.4 * ramp(s, 0.4, 2.4); slipSpeed = 12 * ramp(s, 1.2, 5); break;
    case "tyre-slide": speed = 22; slip = 0.85; warning = 0.32; slipSpeed = 15; break;
    case "tyre-recovery": speed = 22; slip = 0.86 * ramp(s, 0.5, 2) * (1 - ramp(s, 4.5, 7.4)); warning = slip * 0.38; slipSpeed = slip * 15; break;
    case "tyre-cycle": {
      const first = ramp(s, .7, 2.1) * (1 - ramp(s, 4.2, 5.6));
      const second = ramp(s, 6.2, 7.3) * (1 - ramp(s, 9.1, 10.1));
      speed = 22; slip = .86 * Math.max(first, second); warning = slip * .38; slipSpeed = slip * 16;
      wheelLoad = s < 6 ? .8 : .6; break;
    }
    case "manual": rpm = manual.rpm; load = manual.load; slip = manual.slip; warning = Math.min(0.5, slip * 0.4); slipSpeed = manual.slipSpeed; speed = 20; wheelLoad = manual.wheelLoad; break;
  }
  return {
    engine: { rpm, load, driveLoad: load, shifting, gear: s < 4.4 ? 1 : 2, overrun },
    tyre: { id: "fl", grounded: true, warning, slip, rolling: speed > 0 ? 0.32 : 0, speed, slipSpeed,
      demand: slip, load: wheelLoad, kerb: 0, gravel: 0, sand: 0, grass: 0, tarmac: 1,
      roughness: 0.22, absActive: false, tractionActive: false },
  };
}
