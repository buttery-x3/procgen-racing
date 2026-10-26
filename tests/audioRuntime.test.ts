import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VehicleAudio } from "../src/audio/VehicleAudio";
import { DEFAULT_AUDIO_SETTINGS } from "../src/audio/settings";
import { DEFAULT_SETUP } from "../src/vehicle/setup";
import type { AudioControlFrame, AudioSettings } from "../src/audio/types";
import type { VehicleTelemetry } from "../src/vehicle/types";

interface GraphRecord {
  settings: AudioSettings;
  updates: AudioControlFrame[];
  configurations: AudioSettings[];
  silenceCount: number;
  preparations: number;
  disposals: number;
  audible: boolean;
}

const graphMock = vi.hoisted(() => ({
  graphs: [] as GraphRecord[],
  failConstruction: false,
  events: [] as string[],
}));

// Exercise the real runtime/collector. The graph fake records only its public
// lifecycle boundary; DSP and routing have separate rendered/voice tests.
vi.mock("../src/audio/VehicleAudioGraph", () => ({
  VehicleAudioGraph: class {
    readonly record: GraphRecord;
    constructor(_context: unknown, _destination: unknown, settings: AudioSettings) {
      if (graphMock.failConstruction) {
        graphMock.failConstruction = false;
        throw new Error("Graph initialization failed");
      }
      this.record = {
        settings: { ...settings }, updates: [], configurations: [],
        silenceCount: 0, preparations: 0, disposals: 0, audible: false,
      };
      graphMock.graphs.push(this.record);
    }
    configure(settings: AudioSettings) {
      this.record.settings = { ...settings };
      this.record.configurations.push({ ...settings });
      if (!settings.enabled || settings.master === 0) this.record.audible = false;
    }
    update(frame: AudioControlFrame) {
      if (this.record.disposals) throw new Error("Updating disposed graph");
      this.record.updates.push(frame);
      this.record.audible = this.record.settings.enabled && this.record.settings.master > 0;
    }
    silence() { this.record.silenceCount++; this.record.audible = false; }
    prepareResume() {
      graphMock.events.push("prepareResume");
      this.record.preparations++;
      this.record.audible = false;
    }
    dispose() { this.record.disposals++; this.record.audible = false; }
  },
}));

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

class Context {
  static instances: Context[] = [];
  state: AudioContextState = "suspended";
  currentTime = 0;
  sampleRate = 48000;
  baseLatency = 0.01;
  destination = {};
  onstatechange: (() => void) | null = null;
  holdSuspend = false;
  resumes: ReturnType<typeof deferred>[] = [];
  suspends: ReturnType<typeof deferred>[] = [];
  constructor(readonly options: AudioContextOptions) { Context.instances.push(this); }
  resume = vi.fn(() => {
    graphMock.events.push("resume");
    const request = deferred();
    this.resumes.push(request);
    return request.promise.then(() => {
      if (this.state === "closed") throw new Error("Context closed");
      this.state = "running";
      this.onstatechange?.();
    });
  });
  suspend = vi.fn(() => {
    if (!this.holdSuspend) {
      this.state = "suspended";
      this.onstatechange?.();
      return Promise.resolve();
    }
    const request = deferred();
    this.suspends.push(request);
    return request.promise.then(() => {
      if (this.state !== "closed") {
        this.state = "suspended";
        this.onstatechange?.();
      }
    });
  });
  close = vi.fn(() => {
    this.state = "closed";
    this.onstatechange?.();
    return Promise.resolve();
  });
}

class GestureWindow {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.get(type)?.delete(listener);
  }
  gesture(type: string, trusted: boolean) {
    for (const listener of this.listeners.get(type) ?? []) {
      const event = { isTrusted: trusted } as Event;
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }
  count(type: string) { return this.listeners.get(type)?.size ?? 0; }
}

const active: VehicleAudio[] = [];
let gestures: GestureWindow;
function audio(settings?: AudioSettings) {
  const instance = new VehicleAudio(settings);
  active.push(instance);
  return instance;
}
async function settled() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}
async function start(instance: VehicleAudio) {
  instance.unlock();
  const context = Context.instances.at(-1)!;
  context.resumes.at(-1)!.resolve();
  await settled();
  return context;
}
// Only fields consumed by the audio adapter are needed in this runtime fixture.
function telemetry(time = 1): VehicleTelemetry {
  return {
    time, speed: 20, velocity: { x: 0, y: 0, z: 20 }, wheels: [],
    powertrain: { rpm: 4000, gear: 2, ratio: 8, engineTorque: 200, clutchTorque: 180, shifting: false },
  } as unknown as VehicleTelemetry;
}

beforeEach(() => {
  vi.useFakeTimers();
  graphMock.graphs = [];
  graphMock.failConstruction = false;
  graphMock.events = [];
  Context.instances = [];
  gestures = new GestureWindow();
  vi.stubGlobal("window", gestures);
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
afterEach(async () => {
  active.splice(0).forEach((instance) => instance.dispose());
  await settled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("audio runtime activation and mute lifecycle", () => {
  it("defaults sound on while deferring the context until a trusted gesture", async () => {
    const instance = audio();
    expect(instance.enabled).toBe(true);
    expect(instance.settings.output).toBe("headphones");
    expect(instance.state).toBe("ready");
    instance.attach();
    instance.attach();
    expect(gestures.count("pointerdown")).toBe(1);
    expect(gestures.count("keydown")).toBe(1);
    instance.capture(telemetry(), DEFAULT_SETUP);
    instance.update(false);
    gestures.gesture("pointerdown", false);
    expect(Context.instances).toHaveLength(0);
    gestures.gesture("keydown", true);
    expect(Context.instances).toHaveLength(1);
    const context = Context.instances[0];
    expect(context.options.latencyHint).toBe("interactive");
    context.resumes[0].resolve();
    await settled();
    expect(instance.state).toBe("running");
    expect(graphMock.graphs).toHaveLength(1);
  });

  it("preserves an explicit mute and prevents demo/context creation while muted", () => {
    const instance = audio({ ...DEFAULT_AUDIO_SETTINGS, enabled: false });
    instance.attach();
    gestures.gesture("keydown", true);
    instance.unlock();
    expect(instance.demo("fl")).toBe(false);
    expect(Context.instances).toHaveLength(0);
    expect(instance.state).toBe("muted");
    const zero = audio({ ...DEFAULT_AUDIO_SETTINGS, master: 0 });
    expect(zero.demo("rr", true)).toBe(false);
    expect(Context.instances).toHaveLength(0);
  });

  it("keeps a late pending resume muted and suspends its context", async () => {
    const instance = audio();
    instance.unlock();
    const context = Context.instances[0];
    instance.configure({ ...instance.settings, enabled: false });
    context.resumes[0].resolve();
    await settled();
    expect(instance.state).toBe("muted");
    expect(context.state).toBe("running");
    vi.advanceTimersByTime(50);
    await settled();
    expect(context.state).toBe("suspended");
    expect(graphMock.graphs[0].audible).toBe(false);
    expect(graphMock.graphs[0].settings.enabled).toBe(false);
  });

  it("re-enables after a pending suspend without needing another gesture", async () => {
    const instance = audio(), context = await start(instance);
    context.holdSuspend = true;
    instance.configure({ ...instance.settings, enabled: false });
    vi.advanceTimersByTime(50);
    await settled();
    expect(context.suspends).toHaveLength(1);
    instance.configure({ ...instance.settings, enabled: true });
    expect(context.resumes.length).toBeGreaterThan(1);
    context.suspends[0].resolve();
    await settled();
    context.resumes.at(-1)!.resolve();
    await settled();
    expect(instance.state).toBe("running");
    expect(Context.instances).toHaveLength(1);
    expect(graphMock.graphs).toHaveLength(1);
    context.currentTime += 0.05;
    instance.capture(telemetry(), DEFAULT_SETUP);
    instance.update(false);
    expect(graphMock.graphs[0].audible).toBe(true);
  });

  it("lets the mute fade finish before suspending the audio clock", async () => {
    const instance = audio(), context = await start(instance), graph = graphMock.graphs[0];
    instance.capture(telemetry(), DEFAULT_SETUP);
    instance.update(false);
    expect(graph.audible).toBe(true);
    instance.configure({ ...instance.settings, enabled: false });
    expect(instance.state).toBe("muted");
    expect(context.state).toBe("running");
    expect(context.suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(49);
    expect(context.state).toBe("running");
    expect(context.suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await settled();
    expect(context.state).toBe("suspended");
    expect(context.suspend).toHaveBeenCalledTimes(1);
    expect(graph.audible).toBe(false);
  });

  it("cancels scheduled suspension when sound is quickly re-enabled", async () => {
    const instance = audio(), context = await start(instance), graph = graphMock.graphs[0];
    instance.configure({ ...instance.settings, enabled: false });
    vi.advanceTimersByTime(25);
    instance.configure({ ...instance.settings, enabled: true });
    vi.advanceTimersByTime(100);
    await settled();
    expect(context.suspend).not.toHaveBeenCalled();
    expect(context.state).toBe("running");
    context.currentTime = 0.06;
    instance.capture(telemetry(2), DEFAULT_SETUP);
    instance.update(false);
    expect(graph.audible).toBe(true);
  });

  it("prepares a silent graph before resuming a suspended audio clock", async () => {
    const instance = audio(), context = await start(instance), graph = graphMock.graphs[0];
    instance.capture(telemetry(), DEFAULT_SETUP);
    instance.update(false);
    instance.configure({ ...instance.settings, enabled: false });
    vi.advanceTimersByTime(50);
    await settled();
    expect(context.state).toBe("suspended");
    const preparations = graph.preparations;
    graphMock.events = [];
    instance.configure({ ...instance.settings, enabled: true });
    expect(graph.preparations).toBe(preparations + 1);
    expect(graphMock.events).toEqual(["prepareResume", "resume"]);
    expect(graph.audible).toBe(false);
    context.resumes.at(-1)!.resolve();
    await settled();
    context.currentTime = 0.06;
    instance.update(false);
    expect(graph.updates).toHaveLength(1);
    expect(graph.audible).toBe(false);
    instance.capture(telemetry(3), DEFAULT_SETUP);
    instance.update(false);
    expect(graph.updates).toHaveLength(2);
    expect(graph.audible).toBe(true);
  });

  it("ignores a stale resume rejection after a newer retry succeeds", async () => {
    const instance = audio();
    instance.unlock();
    const context = Context.instances[0];
    instance.unlock();
    context.resumes[1].resolve();
    await settled();
    context.resumes[0].reject(new Error("Old resume attempt blocked"));
    await settled();
    expect(instance.state).toBe("running");
    expect(instance.diagnostics().error).toBeNull();
    expect(graphMock.graphs).toHaveLength(1);
  });

  it("surfaces a current resume failure and retries the same context/graph", async () => {
    const instance = audio();
    instance.unlock();
    const context = Context.instances[0];
    context.resumes[0].reject(new Error("Output device unavailable"));
    await settled();
    expect(instance.state).toBe("unavailable");
    expect(instance.diagnostics().error).toContain("Output device unavailable");
    instance.unlock();
    context.resumes[1].resolve();
    await settled();
    expect(instance.state).toBe("running");
    expect(instance.diagnostics().error).toBeNull();
    expect(Context.instances).toHaveLength(1);
    expect(graphMock.graphs).toHaveLength(1);
  });

  it("clears pending controls on silence/pause and resumes only after a new capture", async () => {
    const instance = audio(), context = await start(instance);
    const graph = graphMock.graphs[0];
    instance.capture(telemetry(), DEFAULT_SETUP);
    instance.silence();
    instance.update(false);
    expect(graph.updates).toHaveLength(0);
    context.currentTime += 0.05;
    instance.capture(telemetry(2), DEFAULT_SETUP);
    instance.update(true);
    instance.update(false);
    expect(graph.updates).toHaveLength(0);
    instance.capture(telemetry(3), DEFAULT_SETUP);
    instance.update(false);
    expect(graph.updates).toHaveLength(1);
    expect(graph.updates[0].time).toBe(3);
    expect(graph.silenceCount).toBeGreaterThan(0);
  });

  it("keeps demo routing temporary and restores preferences on expiry or mute", async () => {
    const instance = audio(), context = await start(instance), graph = graphMock.graphs[0];
    expect(instance.demo("fr", true)).toBe(true);
    expect(graph.settings.output).toBe("stereo");
    expect(graph.settings.width).toBe(1);
    expect(graph.settings.engine).toBe(0);
    expect(graph.settings.surface).toBe(0);
    expect(graph.updates).toHaveLength(0);
    context.currentTime += 0.05;
    instance.update(true);
    expect(graph.updates.at(-1)!.wheels.find((wheel) => wheel.id === "fr")!.slip).toBeGreaterThan(0);
    expect(graph.updates.at(-1)!.wheels.filter((wheel) => wheel.id !== "fr").every((wheel) => wheel.slip === 0)).toBe(true);
    context.currentTime = 1.5;
    instance.update(false);
    expect(graph.settings).toEqual(instance.settings);
    expect(graph.audible).toBe(false);
    instance.demo("rl");
    instance.configure({ ...instance.settings, enabled: false });
    const updates = graph.updates.length;
    instance.update(false);
    expect(instance.demo("fl")).toBe(false);
    expect(graph.updates).toHaveLength(updates);
    expect(graph.audible).toBe(false);
  });

  it("clears the old audition during the quiet window before a new wheel sounds", async () => {
    const instance = audio(), context = await start(instance), graph = graphMock.graphs[0];
    instance.demo("fl");
    context.currentTime = 0.05;
    instance.update(true);
    expect(graph.audible).toBe(true);
    expect(graph.updates).toHaveLength(1);
    expect(graph.updates[0].wheels.find((wheel) => wheel.id === "fl")!.slip).toBeGreaterThan(0);
    instance.demo("rr");
    expect(graph.audible).toBe(false);
    context.currentTime = 0.07;
    instance.update(true);
    expect(graph.audible).toBe(false);
    expect(graph.updates).toHaveLength(1);
    context.currentTime = 0.1;
    instance.update(true);
    expect(graph.updates).toHaveLength(2);
    expect(graph.updates[1].wheels.find((wheel) => wheel.id === "rr")!.slip).toBeGreaterThan(0);
    expect(graph.updates[1].wheels.find((wheel) => wheel.id === "fl")!.slip).toBe(0);
    instance.stopAudition();
    instance.capture(telemetry(2), DEFAULT_SETUP);
    instance.update(false);
    expect(graph.audible).toBe(false);
    expect(graph.updates).toHaveLength(2);
    context.currentTime = 0.15;
    instance.update(false);
    expect(graph.updates).toHaveLength(3);
    expect(graph.updates[2].wheels.every((wheel) => wheel.slip === 0)).toBe(true);
  });

  it("reports optional latency as unavailable when the browser lacks it", async () => {
    const instance = audio();
    expect(instance.diagnostics().sampleRate).toBeNull();
    await start(instance);
    expect(instance.diagnostics().sampleRate).toBe(48000);
    expect(instance.diagnostics().baseLatencySeconds).toBe(0.01);
    expect(instance.diagnostics().outputLatencySeconds).toBeNull();
  });
});

describe("bounded graph ownership and recovery", () => {
  it("bounds profile replacements and disposes each retired graph exactly once", async () => {
    const instance = audio();
    await start(instance);
    for (let index = 0; index < 12; index++) {
      instance.setSetup({ ...DEFAULT_SETUP, referenceCar: index % 2 ? "ff" : "awd" });
      const d = instance.diagnostics();
      expect(d.liveGraphs).toBe(1);
      expect(d.retiringGraphs).toBeLessThanOrEqual(2);
      expect(graphMock.graphs.filter((graph) => graph.disposals === 0).length).toBeLessThanOrEqual(3);
    }
    vi.advanceTimersByTime(100);
    expect(instance.diagnostics().retiringGraphs).toBe(0);
    expect(graphMock.graphs.filter((graph) => graph.disposals === 0)).toHaveLength(1);
    instance.dispose();
    instance.dispose();
    graphMock.graphs.forEach((graph) => expect(graph.disposals).toBe(1));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the graph for a mechanics tune with the same sound profile", async () => {
    const instance = audio();
    await start(instance);
    instance.capture(telemetry(), DEFAULT_SETUP);
    instance.setSetup({ ...DEFAULT_SETUP, mass: 1500, peakTorque: 450 });
    instance.update(false);
    expect(graphMock.graphs).toHaveLength(1);
    expect(graphMock.graphs[0].updates).toHaveLength(0);
    expect(instance.diagnostics().retiringGraphs).toBe(0);
  });

  it("releases listeners/timers/context and ignores late async completions after disposal", async () => {
    const instance = audio();
    instance.attach();
    instance.unlock();
    const context = Context.instances[0];
    instance.setSetup({ ...DEFAULT_SETUP, referenceCar: "ff" });
    const status = vi.fn();
    instance.onStatus = status;
    instance.dispose();
    instance.dispose();
    const statusCount = status.mock.calls.length;
    context.resumes[0].resolve();
    await settled();
    vi.advanceTimersByTime(200);
    expect(status).toHaveBeenCalledTimes(statusCount);
    expect(gestures.count("pointerdown")).toBe(0);
    expect(gestures.count("keydown")).toBe(0);
    expect(context.close).toHaveBeenCalledTimes(1);
    graphMock.graphs.forEach((graph) => expect(graph.disposals).toBe(1));
    expect(vi.getTimerCount()).toBe(0);
    instance.attach();
    instance.unlock();
    instance.capture(telemetry(), DEFAULT_SETUP);
    instance.update(false);
    expect(instance.demo("fl")).toBe(false);
    expect(Context.instances).toHaveLength(1);
    expect(instance.diagnostics().liveGraphs).toBe(0);
  });

  it("cleans up a failed initial graph and can retry activation", async () => {
    const instance = audio();
    graphMock.failConstruction = true;
    expect(() => instance.unlock()).not.toThrow();
    expect(instance.state).toBe("unavailable");
    expect(Context.instances[0].close).toHaveBeenCalledTimes(1);
    expect(instance.diagnostics().liveGraphs).toBe(0);
    await start(instance);
    expect(instance.state).toBe("running");
    expect(graphMock.graphs).toHaveLength(1);
  });

  it("contains failed profile replacement and recovers through the next unlock", async () => {
    const instance = audio();
    await start(instance);
    graphMock.failConstruction = true;
    expect(() => instance.setSetup({ ...DEFAULT_SETUP, referenceCar: "ff" })).not.toThrow();
    expect(instance.state).toBe("unavailable");
    expect(instance.diagnostics().error).toContain("Graph initialization failed");
    const context = await start(instance);
    expect(instance.state).toBe("running");
    vi.advanceTimersByTime(100);
    context.currentTime += 0.05;
    instance.capture(telemetry(), DEFAULT_SETUP);
    expect(() => instance.update(false)).not.toThrow();
    expect(graphMock.graphs.at(-1)!.updates).toHaveLength(1);
  });

  it.each(["profile failure", "closed context"])(
    "uses the replacement context clock and clears stale controls after %s",
    async (reason) => {
      const instance = audio(), oldContext = await start(instance);
      oldContext.currentTime = 40;
      instance.capture(telemetry(1), DEFAULT_SETUP);
      instance.update(false);
      expect(graphMock.graphs[0].audible).toBe(true);
      // Leave a quiet deadline on the old audio clock and a pending sample.
      instance.silence();
      instance.capture(telemetry(2), DEFAULT_SETUP);
      if (reason === "profile failure") {
        graphMock.failConstruction = true;
        instance.setSetup({ ...DEFAULT_SETUP, referenceCar: "ff" });
        expect(instance.state).toBe("unavailable");
      } else oldContext.state = "closed";
      const replacement = await start(instance), graph = graphMock.graphs.at(-1)!;
      expect(replacement).not.toBe(oldContext);
      expect(replacement.currentTime).toBe(0);
      replacement.currentTime = 0.05;
      instance.update(false);
      expect(graph.updates).toHaveLength(0);
      expect(graph.audible).toBe(false);
      instance.capture(telemetry(3), DEFAULT_SETUP);
      instance.update(false);
      expect(graph.updates).toHaveLength(1);
      expect(graph.updates[0].time).toBe(3);
      expect(graph.audible).toBe(true);
    },
  );
});
