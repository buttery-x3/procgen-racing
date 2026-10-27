import { beforeAll, describe, expect, it, vi } from "vitest";
import { CATEGORIES, CATEGORY_PRESETS, explorationRecipe, randomCategory } from "../src/exploration/catalog";
import { decodeSelection } from "../src/exploration/selection";
import { ARCHETYPES, generateCar } from "../src/vehicle/generateCar";
import { carIdentity, mechanicsFingerprint } from "../src/vehicle/CarDefinition";
import { CarValidationClient } from "../src/vehicle/CarValidationClient";
import type { CarValidationWorker } from "../src/vehicle/CarValidationClient";
import { allowCommand, nextCamera } from "../src/workbench/commands";
import { loadLayout, saveLayout } from "../src/workbench/LayoutState";
import { CircuitPreparation } from "../src/track/Preparation";
import { GenerationClient } from "../src/track/GenerationClient";
import { DEFAULT_DESIGN_RECIPE } from "../src/track/generationTypes";
import { DEFAULT_VENUE } from "../src/track/venue/types";
import { generateVenueCircuit } from "../src/track/venue/constructVenue";
import { circuitArchive } from "../src/storage/CircuitStorage";
import { DEFAULT_SETUP } from "../src/vehicle/setup";
import { prepareWorkspace } from "../src/app/PreparedWorkspace";
import { initializePhysics, SuspensionRig } from "../src/physics/SuspensionRig";
import { CircuitView } from "../src/rendering/CircuitView";
import { getTestCircuit } from "../src/track/testCircuit";
import { bindingName } from "../src/workbench/display";
import { DEFAULT_INPUT } from "../src/input/settings";
import { makeTrace } from "../src/workbench/TelemetryTrace";
import { trackContext } from "../src/race/TrackContext";
import type { VehicleTelemetry } from "../src/vehicle/types";

describe("category recipes and reproducible exploration", () => {
  it("covers catalog branches, valid layouts, bounded lengths and independent streams", () => {
    for (const category of CATEGORIES) {
      const seen = new Set<string>();
      for (let i = 0; i < 150; i++) {
        const r = explorationRecipe(category, `coverage-${i}`);
        expect(r).toEqual(explorationRecipe(category, `coverage-${i}`));
        const preset = CATEGORY_PRESETS[category];
        expect(preset.cars).toContain(r.car.family);
        expect(preset.bands).toContain(r.car.band);
        expect(ARCHETYPES[r.car.family].layouts).toContain(r.car.layout);
        const track = preset.tracks.find((t) => t.version === r.track.version && t.family === r.track.family)!;
        expect(r.track.targetLength).toBeGreaterThanOrEqual(track.min);
        expect(r.track.targetLength).toBeLessThanOrEqual(track.max);
        expect(r.track.targetLength % 100).toBe(0);
        expect(new Set([r.car.mechanicsSeed, r.car.proportionsSeed, r.car.appearanceSeed, r.track.seed, r.venue.scenerySeed]).size).toBe(5);
        seen.add(`${r.track.version}:${r.track.family}`);
      }
      expect(seen.size).toBe(CATEGORY_PRESETS[category].tracks.length);
    }
    expect(randomCategory(() => 0)).toBe("club");
    expect(randomCategory(() => 0.9999)).toBe("stock");
    expect(explorationRecipe("club", "retry", 1)).not.toEqual(explorationRecipe("club", "retry", 0));
  });
  it("round-trips accepted definitions and rejects changed catalog recipes/fingerprints", () => {
    const recipe = explorationRecipe("club", "descriptor-test"), car = generateCar(recipe.car);
    const result = generateVenueCircuit(recipe.track, recipe.venue);
    const selection = { ...recipe, format: "procgen-racing/exploration", archive: circuitArchive(result), factory: car.setup, mechanics: mechanicsFingerprint(car.setup), circuitFingerprint: result.fingerprint };
    expect(decodeSelection(JSON.stringify(selection))).toEqual(selection);
    expect(() => decodeSelection(JSON.stringify({ ...selection, catalog: 2 }))).toThrow("Unsupported");
    expect(() => decodeSelection(JSON.stringify({ ...selection, mechanics: "wrong" }))).toThrow("fingerprints");
    expect(() => decodeSelection(JSON.stringify({ ...selection, car: { ...selection.car, mechanicsSeed: "different" } }))).toThrow("seed/catalog");
  });
});

describe("workbench command and view policy", () => {
  it("guards every replacement route but preserves view/reset access with pending drafts", () => {
    for (const action of ["category:club", "explore:new", "experiment:bank", "track:return", "circuit-start:grid", "generator:drive", "save", "compare", "load-baseline", "session:trial", "drop", "undo"])
      expect(allowCommand(action, true), action).toBe(false);
    for (const action of ["camera:top", "reset", "preferences", "datum", "inspector", "telemetry"])
      expect(allowCommand(action, true), action).toBe(true);
    expect([nextCamera("chase"), nextCamera("bonnet"), nextCamera("top"), nextCamera("orbit")]).toEqual(["bonnet", "top", "orbit", "chase"]);
  });
  it("keeps optional UI preferences separate and tolerates unavailable/malformed storage", () => {
    const fail = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadLayout(fail)).toEqual({ inspector: true, instruments: true, recorder: false });
    expect(() => saveLayout({ inspector: false, instruments: false, recorder: true }, fail)).not.toThrow();
    expect(loadLayout({ getItem: () => '{"version":1,"inspector":false,"instruments":"false"}' })).toEqual({ inspector: false, instruments: true, recorder: false });
    expect(bindingName({ ...DEFAULT_INPUT, keys: { ...DEFAULT_INPUT.keys, reset: ["KeyT"] } }, "reset")).toBe("T");
    expect(makeTrace("datum", DEFAULT_SETUP, "level", []).angleDatum).toBe("road");
    expect(carIdentity({ ...DEFAULT_SETUP, frontSpring: 42000 })).toBe(carIdentity(DEFAULT_SETUP));
  });
});

class WorkerStub implements CarValidationWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage() {}
  terminate() { this.terminated = true; }
  send(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}
describe("shared asynchronous preparation", () => {
  it("cancels car validation, ignores stale replies, caches matching mechanics and frees errored workers", async () => {
    const workers: WorkerStub[] = [], client = new CarValidationClient(() => { const w = new WorkerStub(); workers.push(w); return w; });
    const first = client.validate(DEFAULT_SETUP), rejection = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = client.validate(DEFAULT_SETUP);
    workers[0].send({ result: { valid: false } });
    workers[1].send({ result: { valid: true } });
    await rejection; await expect(second).resolves.toEqual({ valid: true });
    expect(workers.every((w) => w.terminated)).toBe(true);
    await expect(client.validate(DEFAULT_SETUP)).resolves.toEqual({ valid: true });
    expect(workers.length).toBe(2);
    const third = client.validate({ ...DEFAULT_SETUP, frontSpring: 42000 });
    workers[2].onerror?.({ message: "crashed" } as ErrorEvent);
    await expect(third).rejects.toThrow("crashed");
    expect(workers[2].terminated).toBe(true);
    client.dispose();
  });
  it("enforces construction acceptance on every circuit destination", async () => {
    const workers: WorkerStub[] = [], service = new CircuitPreparation(new GenerationClient(() => { const w = new WorkerStub(); workers.push(w); return w; }));
    const pending = service.prepare(DEFAULT_DESIGN_RECIPE, DEFAULT_VENUE, () => {});
    workers[0].send({ type: "ready", result: { report: { valid: false, checks: [] } } });
    await expect(pending).rejects.toThrow("construction validation");
    const stale = service.prepare(DEFAULT_DESIGN_RECIPE, DEFAULT_VENUE, () => {});
    const rejection = expect(stale).rejects.toMatchObject({ name: "AbortError" });
    service.cancel(); workers[1].send({ type: "ready", result: { report: { valid: true, checks: [] } } });
    await rejection; expect(workers[1].terminated).toBe(true);
    service.dispose();
  });
});

describe("isolated workspace staging", () => {
  beforeAll(async () => { await initializePhysics(); });
  it("leaves the active world unchanged and releases staged resources on success/cancel", () => {
    const current = new SuspensionRig(DEFAULT_SETUP), before = current.telemetry.time;
    const commit = vi.fn(), dispose = vi.fn();
    const next = prepareWorkspace({ prepareCar: () => ({ commit, dispose }) }, { ...DEFAULT_SETUP, frontSpring: 42000 }, getTestCircuit());
    expect(current.setup.frontSpring).toBe(DEFAULT_SETUP.frontSpring);
    expect(current.telemetry.time).toBe(before);
    expect(commit).not.toHaveBeenCalled();
    expect(next.rig.telemetry.groundedCount).toBeGreaterThan(0);
    next.dispose(); next.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    current.dispose();
  });
  it("releases the candidate world and road after car-view preparation fails", () => {
    const rigDispose = vi.spyOn(SuspensionRig.prototype, "dispose"), roadDispose = vi.spyOn(CircuitView.prototype, "dispose");
    expect(() => prepareWorkspace({ prepareCar: () => { throw new Error("view allocation failed"); } }, DEFAULT_SETUP, getTestCircuit())).toThrow("view allocation");
    expect(rigDispose).toHaveBeenCalledTimes(1); expect(roadDispose).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
  it("releases the candidate world when collision preparation fails", () => {
    vi.spyOn(SuspensionRig.prototype, "setCircuit").mockImplementation(() => { throw new Error("collision failed"); });
    const dispose = vi.spyOn(SuspensionRig.prototype, "dispose"), car = vi.fn();
    expect(() => prepareWorkspace({ prepareCar: car }, DEFAULT_SETUP, getTestCircuit())).toThrow("collision failed");
    expect(dispose).toHaveBeenCalledTimes(1); expect(car).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("releases car, road and world if timing-view staging fails", () => {
    const rigDispose = vi.spyOn(SuspensionRig.prototype, "dispose"), dispose = vi.fn();
    expect(() => prepareWorkspace({ prepareCar: () => ({ commit: vi.fn(), dispose }), prepareTimingCourse: () => { throw new Error("timing allocation failed"); } }, DEFAULT_SETUP, getTestCircuit())).toThrow("timing allocation");
    expect(dispose).toHaveBeenCalledTimes(1); expect(rigDispose).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
  it("shares pit geometry and actual limits without classifying racing-edge overlap as pit", () => {
    const c = getTestCircuit(), base = c.locate(c.frame(20).position);
    const lane = { points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }], width: 6, speedLimit: 30 / 3.6 };
    let lateral = 20;
    const circuit = { ...c, definition: { ...c.definition, venue: { pit: lane } }, locate: () => ({ ...base, lateral, branchId: "main" }) } as unknown as typeof c;
    const t = { position: { x: 0, y: 0, z: 5 }, speed: 12, wheels: [], track: { station: 20, branchId: "main" } } as unknown as VehicleTelemetry;
    expect(trackContext(circuit, t)).toMatchObject({ pit: true, overspeed: true, limit: 30 / 3.6 });
    lateral = 0;
    expect(trackContext(circuit, t).pit).toBe(false);
    const noPit = { ...circuit, definition: { ...c.definition, venue: undefined } };
    expect(trackContext(noPit, t)).toMatchObject({ pit: false, overspeed: false, limit: 60 / 3.6 });
  });
});
