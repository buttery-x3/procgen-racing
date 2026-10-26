import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  normalizeAudioSettings,
  saveAudioSettings,
} from "../src/audio/settings";

const AUDIO_KEY = "procgen-racing:audio:v1";
const LEGACY_KEY = "procgen-racing:presentation";
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("independent driving audio preferences", () => {
  it("enables headphone sound by default and returns independent values", () => {
    const settings = loadAudioSettings();
    expect(settings).toEqual({
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
    settings.enabled = false;
    expect(loadAudioSettings().enabled).toBe(true);
    expect(DEFAULT_AUDIO_SETTINGS.enabled).toBe(true);
  });

  it("bounds finite levels and rejects misleading booleans, modes and values", () => {
    expect(
      normalizeAudioSettings({
        enabled: "false",
        softSqueal: 1,
        master: -5,
        engine: 10,
        tyres: Number.NaN,
        surface: Number.POSITIVE_INFINITY,
        width: "0.2",
        axleCue: 0.25,
        output: "surround",
      }),
    ).toEqual({
      ...DEFAULT_AUDIO_SETTINGS,
      master: 0,
      engine: 1,
      axleCue: 0.25,
    });
    for (const invalid of [undefined, null, false, "mute", 12, [], { version: 2 }])
      expect(normalizeAudioSettings(invalid)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it("round-trips an explicit mute without restoring the legacy level", () => {
    values.set(LEGACY_KEY, JSON.stringify({ volume: 0.9 }));
    const settings = normalizeAudioSettings({
      enabled: false,
      master: 0,
      output: "mono",
      softSqueal: true,
    });
    expect(saveAudioSettings(settings)).toBe(true);
    expect(loadAudioSettings()).toEqual(settings);
    expect(JSON.parse(values.get(LEGACY_KEY)!)).toEqual({ volume: 0.9 });
  });

  it("migrates the old volume once while keeping sound enabled", () => {
    values.set(LEGACY_KEY, JSON.stringify({ volume: 0.24, quality: "economy" }));
    expect(loadAudioSettings()).toEqual({ ...DEFAULT_AUDIO_SETTINGS, master: 0.24 });
    expect(JSON.parse(values.get(AUDIO_KEY)!)).toEqual({
      ...DEFAULT_AUDIO_SETTINGS,
      master: 0.24,
    });
    values.set(LEGACY_KEY, JSON.stringify({ volume: 0.8 }));
    expect(loadAudioSettings().master).toBe(0.24);
  });

  it("preserves a zero legacy volume and normalizes out-of-range migration", () => {
    values.set(LEGACY_KEY, JSON.stringify({ volume: 0 }));
    expect(loadAudioSettings()).toEqual({ ...DEFAULT_AUDIO_SETTINGS, master: 0 });
    values.delete(AUDIO_KEY);
    values.set(LEGACY_KEY, JSON.stringify({ volume: 25 }));
    expect(loadAudioSettings().master).toBe(1);
  });

  it("recovers from corrupt audio storage without reimporting legacy preferences", () => {
    values.set(LEGACY_KEY, JSON.stringify({ volume: 0.15 }));
    for (const raw of ["{broken", "null", "[]", "17", '{"version":99}']) {
      values.set(AUDIO_KEY, raw);
      expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
    }
  });

  it("ignores corrupt or nonnumeric legacy volume", () => {
    for (const raw of ["{broken", "null", '"hi"', '{"volume":"0.2"}', "[]"] ) {
      values.set(LEGACY_KEY, raw);
      expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
      expect(values.has(AUDIO_KEY)).toBe(false);
    }
  });

  it("remains usable when storage reads and writes are blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("Access denied"); },
      setItem: () => { throw new Error("Quota exceeded"); },
    });
    expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(saveAudioSettings({ ...DEFAULT_AUDIO_SETTINGS, enabled: false })).toBe(false);
    expect(normalizeAudioSettings({ enabled: false }).enabled).toBe(false);
  });
});
