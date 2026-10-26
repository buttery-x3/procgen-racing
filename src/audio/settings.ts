import type { AudioSettings } from "./types";

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = Object.freeze({
  version: 1,
  enabled: true,
  master: 0.6,
  engine: 0.75,
  tyres: 1,
  surface: 0.65,
  output: "headphones",
  axleCue: 0.8,
  width: 0.75,
  softSqueal: false,
});

const STORAGE_KEY = "procgen-racing:audio:v1";
const LEGACY_KEY = "procgen-racing:presentation";

/** Invalid or old browser preferences never stop the driving simulation. */
export function normalizeAudioSettings(value: unknown): AudioSettings {
  const source =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<AudioSettings>)
      : {};
  if (source.version !== undefined && source.version !== 1)
    return { ...DEFAULT_AUDIO_SETTINGS };
  const level = (key: "master" | "engine" | "tyres" | "surface" | "axleCue" | "width") => {
    const n = source[key];
    return typeof n === "number" && Number.isFinite(n)
      ? Math.max(0, Math.min(1, n))
      : DEFAULT_AUDIO_SETTINGS[key];
  };
  return {
    version: 1,
    enabled:
      typeof source.enabled === "boolean"
        ? source.enabled
        : DEFAULT_AUDIO_SETTINGS.enabled,
    master: level("master"),
    engine: level("engine"),
    tyres: level("tyres"),
    surface: level("surface"),
    output:
      source.output === "headphones" ||
      source.output === "stereo" ||
      source.output === "mono"
        ? source.output
        : DEFAULT_AUDIO_SETTINGS.output,
    axleCue: level("axleCue"),
    width: level("width"),
    softSqueal:
      typeof source.softSqueal === "boolean"
        ? source.softSqueal
        : DEFAULT_AUDIO_SETTINGS.softSqueal,
  };
}

export function loadAudioSettings(): AudioSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    // An existing audio preference, including mute or a corrupt record, takes
    // precedence over the obsolete presentation slider.
    if (saved !== null) return normalizeAudioSettings(JSON.parse(saved));
    const legacy: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "null");
    if (legacy !== null && typeof legacy === "object" && "volume" in legacy) {
      const master = (legacy as { volume: unknown }).volume;
      if (typeof master === "number" && Number.isFinite(master)) {
        const migrated = normalizeAudioSettings({ master });
        saveAudioSettings(migrated);
        return migrated;
      }
    }
  } catch {
    // Storage may be unavailable or contain data from an interrupted save.
  }
  return { ...DEFAULT_AUDIO_SETTINGS };
}

/** Changes still apply for this visit when browser storage is unavailable. */
export function saveAudioSettings(settings: AudioSettings): boolean {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizeAudioSettings(settings)),
    );
    return true;
  } catch {
    return false;
  }
}
