import { describe, expect, it } from "vitest";
import { referenceTyreRenderer, renderReferenceTyre } from "../../scripts/reference-tyre-render.mjs";

function modelFixture() {
  const frames = 48, slots = 2, noiseBins = 100, partials = [], residual = [];
  for (let frame = 0; frame < frames; frame++) {
    partials.push(1, 850 + frame * 5, .035, 2, 1750 + frame * 7, .018);
    for (let bin = 0; bin < noiseBins; bin++) residual.push(.003 * Math.exp(-(((bin * 93.75 - 1100 - frame * 3) / 220) ** 2)));
  }
  return { format: "procgen-racing:tyre-control-model", version: 1, id: "local:tyre-spectrum-v1:fixture",
    frames, slots, noiseBins, frequencyStepHz: 93.75, partials, residual, initialPhases: [0, .3, 1.1] };
}
const active = { id: "fl", grounded: true, speed: 22, slipSpeed: 15, load: .8, slip: .85, warning: .32, rolling: 0 };
const rms = (samples) => Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length);

describe("continuous reference tyre worklet", () => {
  it("uses the driving level once while retaining independent spectral character", () => {
    const a = referenceTyreRenderer(modelFixture()), b = referenceTyreRenderer(modelFixture());
    for (let block = 0; block < 350; block++) {
      a.block({ ...active, load: 1, level: .8 });
      b.block({ ...active, load: .25, level: .2 });
    }
    expect(a.processor.position).toBe(b.processor.position);
    expect(b.processor.level).toBeCloseTo(a.processor.level * .25, 6);
  });

  it("skips spectral transforms at rest, wakes on slip and retires explicitly", () => {
    const renderer = referenceTyreRenderer(modelFixture(), 48000, {}, 27, { sleepWhenQuiet: true, reportState: false });
    const original = renderer.processor.spectralNoise.bind(renderer.processor);
    let grains = 0;
    renderer.processor.spectralNoise = (...args) => { grains++; original(...args); };
    for (let block = 0; block < 50; block++) renderer.block({ ...active, slip: 0, warning: 0 });
    expect(grains).toBe(0);
    let audible;
    for (let block = 0; block < 150; block++) audible = renderer.block(active);
    expect(grains).toBeGreaterThan(0); expect(rms(audible)).toBeGreaterThan(.001);
    for (let block = 0; block < 100; block++) renderer.block({ ...active, grounded: false });
    const afterRelease = grains;
    for (let block = 0; block < 30; block++) renderer.block({ ...active, grounded: false });
    expect(grains).toBe(afterRelease);
    renderer.send("dispose");
    expect(renderer.processor.process([], [[new Float32Array(128)], [new Float32Array(128)]])).toBe(false);
    expect(renderer.messages.some((message) => message.type === "state")).toBe(false);
  });

  it.each([44100,48000])("continues rendering beyond the reference phrase at %i Hz", (rate) => {
    const { pcm } = renderReferenceTyre(modelFixture(), rate, 5, () => active);
    expect(pcm.every(n => Number.isFinite(n) && Math.abs(n) < .5)).toBe(true);
    for (const start of [.8,2.5,4.5]) expect(rms(pcm.slice(Math.round(start*rate),Math.round((start+.2)*rate)))).toBeGreaterThan(.001);
    expect(pcm.slice(rate,rate+1000)).not.toEqual(pcm.slice(rate*3,rate*3+1000));
  });

  it("uses history at the same slip and releases promptly when contact is lost", () => {
    const renderer = referenceTyreRenderer(modelFixture());
    for (let block=0;block<160;block++) renderer.block({ ...active, slip: .3 });
    const rising = renderer.processor.position;
    for (let block=0;block<200;block++) renderer.block(active);
    const beforeBriefLoss = renderer.processor.position;
    renderer.block({ ...active, grounded: false }); renderer.block(active);
    expect(Math.abs(renderer.processor.position-beforeBriefLoss)).toBeLessThan(.05);
    for (let block=0;block<40;block++) renderer.block({ ...active, slip: .3 });
    expect(renderer.processor.state).toBe("recovering");
    expect(renderer.processor.position).toBeGreaterThan(rising+.15);
    let tail;
    for (let block=0;block<70;block++) tail = renderer.block({ ...active, grounded: false });
    expect(rms(tail)).toBeLessThan(.000001);
    expect(renderer.processor.state).toBe("quiet");
  });

  it("resets deterministically and rejects malformed model data", () => {
    const renderer = referenceTyreRenderer(modelFixture());
    const initial = [];
    for (let block=0;block<80;block++) initial.push(...renderer.block(active));
    renderer.processor.port.onmessage({ data: { type: "reset", seed: 0x51a3d207 } });
    const repeated = [];
    for (let block=0;block<80;block++) repeated.push(...renderer.block(active));
    expect(repeated).toEqual(initial);
    renderer.send("profile", { ...modelFixture(), residual: [NaN] });
    expect(renderer.messages.at(-1)?.type).toBe("profile-error");
  });

  it("recognizes recovery under both block-rate and 25 ms control updates", () => {
    const result = (quantize) => {
      const renderer = referenceTyreRenderer(modelFixture());
      for (let block=0;block<640;block++) {
        let seconds=block*128/48000;
        if (quantize) seconds=Math.floor(seconds/.025)*.025;
        const slip=.85-.5*Math.min(1,Math.max(0,(seconds-.8)/.8));
        renderer.block({ ...active, slip });
      }
      expect(renderer.processor.state).toBe("recovering");
      return renderer.processor.position;
    };
    expect(Math.abs(result(false)-result(true))).toBeLessThan(.05);
  });
});
