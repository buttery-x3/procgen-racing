import { beforeAll, describe, it, expect } from "vitest";
import { DEFAULT_SETUP } from "../src/vehicle/setup";
import {
  generateCar,
  DEFAULT_CAR_RECIPE,
  ARCHETYPES,
} from "../src/vehicle/generateCar";
import {
  CAR_FAMILIES,
  mechanicsFingerprint,
} from "../src/vehicle/CarDefinition";
import {
  decodeGarage,
  exportGarage,
  exportSetup,
  createEntry,
  SetupHistory,
} from "../src/storage/GarageStorage";
import { decodeSetupRecord } from "../src/storage/SetupStorage";
import {
  DEFAULT_INPUT,
  sanitizeInput,
  responseAxis,
} from "../src/input/settings";
import { TraceBuffer, tracePlot } from "../src/workbench/TelemetryTrace";
import { runSetupTest } from "../src/workbench/runComparison";
import { initializePhysics } from "../src/physics/SuspensionRig";
beforeAll(initializePhysics);
describe("M6 saved cars, history, controls and repeatable comparisons", () => {
  it("measures a smaller roll response with a firmer tune under the same steering inputs", async () => {
    const base = generateCar(DEFAULT_CAR_RECIPE).setup,
      soft = {
        ...base,
        frontSpring: base.frontSpring * 0.75,
        rearSpring: base.rearSpring * 0.75,
        frontAntiRoll: base.frontAntiRoll * 0.65,
        rearAntiRoll: base.rearAntiRoll * 0.65,
      },
      firm = {
        ...base,
        frontSpring: base.frontSpring * 1.4,
        rearSpring: base.rearSpring * 1.4,
        frontAntiRoll: base.frontAntiRoll * 1.4,
        rearAntiRoll: base.rearAntiRoll * 1.4,
      };
    const a = await runSetupTest(soft, "slalom", "Soft"),
      b = await runSetupTest(firm, "slalom", "Firm");
    expect(a.samples.map((s) => s.steer)).toEqual(
      b.samples.map((s) => s.steer),
    );
    expect(b.metrics!.peakRoll).toBeLessThan(a.metrics!.peakRoll * 0.9);
    expect(a.metrics!.groundedFraction).toBeGreaterThan(0.97);
    expect(b.metrics!.groundedFraction).toBeGreaterThan(0.97);
  });
  it("round-trips full generated cars and imports legacy saves without replacing entries", () => {
    const car = generateCar(DEFAULT_CAR_RECIPE).setup,
      entry = createEntry("My coupe", car),
      json = exportGarage({ version: 1, entries: [entry] });
    const restored = decodeGarage(json, false);
    expect(restored.entries[0]).toEqual(entry);
    const imported = decodeGarage(json);
    expect(imported.entries[0].id).not.toBe(entry.id);
    expect(imported.entries[0].setup).toEqual(car);
    expect(decodeGarage(exportSetup("My coupe", car)).entries[0].setup).toEqual(
      car,
    );
    expect(
      decodeSetupRecord(JSON.stringify({ version: 3, setup: car })),
    ).toEqual(car);
    expect(
      decodeGarage(JSON.stringify({ version: 2, setup: DEFAULT_SETUP }))
        .entries[0].setup,
    ).toEqual(DEFAULT_SETUP);
    expect(() =>
      decodeGarage(
        JSON.stringify({
          format: "procgen-racing/setup",
          version: 99,
          setup: car,
        }),
      ),
    ).toThrow();
    expect(() =>
      decodeGarage(
        JSON.stringify({
          format: "procgen-racing/setup",
          version: 3,
          setup: { ...car, vehicle: { ...car.vehicle, version: 99 } },
        }),
      ),
    ).toThrow();
    expect(() => decodeGarage("{")).toThrow();
  });
  it("coalesces slider gestures, restores nested construction, and clears redo on a new edit", () => {
    const a = generateCar(DEFAULT_CAR_RECIPE).setup,
      b = { ...a, frontSpring: a.frontSpring + 1000 },
      c = { ...b, frontSpring: b.frontSpring + 1000 },
      history = new SetupHistory();
    history.record(a, "frontSpring", 100);
    history.record(b, "frontSpring", 200);
    expect(history.undo(c)).toEqual(a);
    expect(history.redo(a)).toEqual(c);
    history.undo(c);
    history.record(a, "rearSpring", 400);
    expect(history.canRedo).toBe(false);
    const recovered = history.undo({ ...a, rearSpring: a.rearSpring + 1000 })!;
    recovered.vehicle!.appearance.paint = 0;
    expect(a.vehicle!.appearance.paint).not.toBe(0);
  });
  it("bounds input response and rejects conflicting keys or gamepad buttons", () => {
    expect(sanitizeInput(DEFAULT_INPUT)).toEqual(DEFAULT_INPUT);
    expect(responseAxis(0.1, DEFAULT_INPUT)).toBe(0);
    expect(responseAxis(1, DEFAULT_INPUT)).toBe(1);
    expect(responseAxis(-1, DEFAULT_INPUT)).toBe(-1);
    const strong = { ...DEFAULT_INPUT, curve: 2 };
    expect(responseAxis(0.6, strong)).toBeLessThan(
      responseAxis(0.6, DEFAULT_INPUT),
    );
    expect(() =>
      sanitizeInput({
        ...DEFAULT_INPUT,
        keys: { ...DEFAULT_INPUT.keys, brake: ["KeyW"] },
      }),
    ).toThrow();
    expect(() =>
      sanitizeInput({
        ...DEFAULT_INPUT,
        pad: { ...DEFAULT_INPUT.pad, reset: DEFAULT_INPUT.pad.pause },
      }),
    ).toThrow();
    expect(() => sanitizeInput({ version: 99 })).toThrow();
  });
  it("keeps the trace ordered through wrap and detects simulation resets", async () => {
    const run = await runSetupTest(DEFAULT_SETUP, "drop", "Drop"),
      buffer = new TraceBuffer(3);
    run.samples.slice(0, 7).forEach((s) => buffer.push(s));
    expect(buffer.snapshot().map((s) => s.time)).toEqual(
      run.samples.slice(4, 7).map((s) => s.time),
    );
    buffer.push(run.samples[0]);
    expect(buffer.snapshot()).toEqual([run.samples[0]]);
    const plot = tracePlot([run], "load-fl");
    expect(plot.paths[0]).not.toContain("NaN");
    expect(plot.duration).toBeGreaterThan(5);
  });
  it("repeats the same A/B inputs and physical response for an identical setup", async () => {
    const setup = generateCar(DEFAULT_CAR_RECIPE).setup,
      a = await runSetupTest(setup, "launch-brake", "A"),
      b = await runSetupTest(setup, "launch-brake", "B");
    expect(a.samples).toEqual(b.samples);
    expect(a.metrics).toEqual(b.metrics);
    expect(a.condition).toBe(b.condition);
    expect(a.mechanics).toBe(mechanicsFingerprint(setup));
    expect(a.metrics!.stopDistance).toBeGreaterThan(3);
    expect(a.samples.at(-1)!.speed).toBeLessThan(0.6);
  });
  it.each(CAR_FAMILIES)(
    "%s launches, brakes and remains finite in the shared test",
    async (family) => {
      const setup = generateCar({
          ...DEFAULT_CAR_RECIPE,
          family,
          layout: ARCHETYPES[family].layouts[0],
        }).setup,
        run = await runSetupTest(setup, "launch-brake", family);
      expect(
        run.samples.every(
          (s) =>
            Number.isFinite(s.speed) &&
            Number.isFinite(s.roll) &&
            Number.isFinite(s.pitch),
        ),
      ).toBe(true);
      // This is a 65% throttle diagnostic; even the retained M2 FF reference
      // reaches only ~17 km/h before its 4.5 s braking trigger.
      expect(run.metrics!.maxSpeed).toBeGreaterThan(10);
      expect(run.metrics!.maxSpeed).toBeLessThan(200);
      expect(run.metrics!.stopDistance).not.toBeNull();
      expect(run.samples.at(-1)!.speed).toBeLessThan(0.6);
      expect(run.metrics!.groundedFraction).toBeGreaterThan(0.97);
    },
  );
});
