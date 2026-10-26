import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { TONAL_PRESET } from "../../src/audio/playground-model";

const source = readFileSync(new URL("../../public/audio/playground-voices.js", import.meta.url), "utf8");

function render(sampleRate, changes) {
  const registrations = new Map();
  class BaseProcessor { port = { onmessage: undefined }; }
  vm.runInNewContext(source, {
    AudioWorkletProcessor: BaseProcessor,
    registerProcessor: (name, type) => { registrations.set(name, type); },
    sampleRate, Float32Array, Math, Number,
  });
  expect(registrations.has("playground-friction-tyre")).toBe(true);
  const Type = registrations.get("playground-tonal-tyre");
  expect(Type).toBeDefined();
  const processor = new Type();
  const send = (type, value) => processor.port.onmessage?.({ data: { type, value } });
  processor.port.onmessage?.({ data: { type: "reset", seed: TONAL_PRESET.seed } });
  send("tuning", { ...TONAL_PRESET.tuning, ...changes, onset: 0, release: 0 });
  const active = { id: "fl", grounded: true, load: 0.8, speed: 22, slipSpeed: 15, warning: 0.32, slip: 0.85, rolling: 0 };
  send("control", active);
  const samples = [];
  for (let block = 0; block < Math.ceil(sampleRate / 128); block++) {
    if (changes.contactEnd !== undefined && block * 128 >= changes.contactEnd * sampleRate)
      send("control", { ...active, grounded: false });
    const tyre = new Float32Array(128), surface = new Float32Array(128);
    expect(processor.process([], [[tyre], [surface]])).toBe(true);
    samples.push(...tyre);
  }
  return samples;
}

function rms(values) {
  return Math.sqrt(values.reduce((energy, value) => energy + value * value, 0) / values.length);
}

describe("tonal playground tyre", () => {
  it.each([44100, 48000])("renders a finite, bounded, audible dry squeal at %i Hz", (rate) => {
    const dry = render(rate, { scrape: 0, roughness: 0 });
    const sustained = dry.slice(Math.floor(rate * 0.3), Math.floor(rate * 0.8));
    expect(sustained.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 0.25)).toBe(true);
    expect(rms(sustained)).toBeGreaterThan(0.01);
    const period = Math.round(rate / (1470 + 690 * TONAL_PRESET.tuning.pitch));
    const coherent = sustained.slice(period).reduce((sum, value, i) => sum + value * sustained[i], 0);
    const energy = sustained.reduce((sum, value) => sum + value * value, 0);
    expect(coherent / energy).toBeGreaterThan(0.7);
  });

  it("has a true zero scrape layer and falls silent after contact loss", () => {
    const quiet = render(48000, { tone: 0, scrape: 0, roughness: 0 });
    const scrape = render(48000, { tone: 0, scrape: 1, roughness: 0 });
    expect(rms(quiet.slice(24000))).toBeLessThan(1e-10);
    expect(rms(scrape.slice(24000))).toBeGreaterThan(0.002);
    const released = render(48000, { scrape: 0, contactEnd: 0.2 });
    expect(rms(released.slice(38400))).toBeLessThan(0.0001);
  });
});
