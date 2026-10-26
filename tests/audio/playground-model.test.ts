import { describe, expect, it } from "vitest";
import { DEFAULT_PRESET, LEGACY_PRESET, FIXTURES, fixtureControls, parsePreset } from "../../src/audio/playground-model";

describe("audio playground fixtures and presets", () => {
  it("has bounded, finite controls through every short synthetic example", () => {
    for (const [id, fixture] of Object.entries(FIXTURES)) {
      if (!Number.isFinite(fixture.duration)) continue;
      for (let tenth = 0; tenth <= fixture.duration * 10; tenth++) {
        const { engine, tyre } = fixtureControls(id as keyof typeof FIXTURES, tenth / 10);
        expect(engine.rpm).toBeGreaterThanOrEqual(250);
        expect(engine.rpm).toBeLessThanOrEqual(15000);
        for (const value of [engine.load, engine.driveLoad, engine.overrun, tyre.warning, tyre.slip, tyre.rolling, tyre.load]) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("holds a shift window while RPM falls and keeps sliding separate from the warning", () => {
    const before = fixtureControls("engine-shift", 4.2).engine;
    const during = fixtureControls("engine-shift", 4.7).engine;
    const after = fixtureControls("engine-shift", 5.5).engine;
    expect(before.shifting).toBe(false);
    expect(during.shifting).toBe(true);
    expect(during.rpm).toBeLessThan(before.rpm);
    expect(after.shifting).toBe(false);
    expect(fixtureControls("tyre-scrub", 3).tyre.slip).toBeLessThan(fixtureControls("tyre-slide", 3).tyre.slip);
  });

  it("round trips both sound backends without reinterpreting first-generation controls", () => {
    expect(parsePreset(JSON.parse(JSON.stringify(DEFAULT_PRESET)))).toEqual(DEFAULT_PRESET);
    expect(parsePreset(JSON.parse(JSON.stringify(LEGACY_PRESET)))).toEqual(LEGACY_PRESET);
    expect(parsePreset({ ...LEGACY_PRESET, tuning: { ...LEGACY_PRESET.tuning, scrape: 0 } }).tuning.scrape).toBe(0);
    expect(() => parsePreset({ ...LEGACY_PRESET, backend: DEFAULT_PRESET.backend })).toThrow(/tone/);
    expect(() => parsePreset({ ...DEFAULT_PRESET, backend: LEGACY_PRESET.backend })).toThrow(/screech/);
    expect(() => parsePreset({ ...DEFAULT_PRESET, version: 2 })).toThrow(/Unsupported/);
    expect(() => parsePreset({ ...DEFAULT_PRESET, tuning: { ...DEFAULT_PRESET.tuning, body: Infinity } })).toThrow(/body/);
    expect(() => parsePreset({ ...DEFAULT_PRESET, tuning: { ...DEFAULT_PRESET.tuning, pitch: -0.1 } })).toThrow(/pitch/);
    expect(() => parsePreset({ ...DEFAULT_PRESET, bTrim: -1 })).toThrow(/trims/);
    expect(() => parsePreset({ ...DEFAULT_PRESET, manual: { ...DEFAULT_PRESET.manual, rpm: Infinity } })).toThrow(/rpm/);
  });
});
