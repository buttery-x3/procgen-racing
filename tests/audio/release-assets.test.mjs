import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { REFERENCE_MODEL_ID, TYRE_MODEL_URL } from "../../src/audio/reference-tuning";
import { referenceTyreRenderer } from "../../scripts/reference-tyre-render.mjs";

describe("standalone synthesized audio assets", () => {
  it("ships the accepted parameter model and renders it without local recordings", () => {
    const bytes = readFileSync(new URL(`../../public${TYRE_MODEL_URL}`, import.meta.url));
    const provenance = JSON.parse(readFileSync(new URL("../../docs/research/audio-model-provenance.json", import.meta.url), "utf8"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(provenance.sha256);
    const model = JSON.parse(bytes);
    expect(model.id).toBe(REFERENCE_MODEL_ID);
    const renderer = referenceTyreRenderer(model, 48000, {}, 27, { sleepWhenQuiet: true, reportState: false });
    let block;
    for (let index = 0; index < 160; index++)
      block = renderer.block({ id: "fl", grounded: true, load: .8, speed: 20, slipSpeed: 8, slip: .85, warning: .5, level: .65 });
    expect(block.every((value) => Number.isFinite(value) && Math.abs(value) < .9)).toBe(true);
    expect(Math.sqrt(block.reduce((sum, value) => sum + value * value, 0) / block.length)).toBeGreaterThan(.001);
  });

  it("includes no source or comparison recordings in public assets", () => {
    const files = readdirSync(new URL("../../public/", import.meta.url), { recursive: true });
    expect(files.filter((file) => /\.(wav|mp3|ogg|flac|m4a|aac|aiff?)$/i.test(file))).toEqual([]);
    expect(existsSync(new URL("../../audio-reference.html", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../../scripts/audio-reference.mjs", import.meta.url))).toBe(false);
  });
});
