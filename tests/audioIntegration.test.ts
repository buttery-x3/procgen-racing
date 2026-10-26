import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDrivingAudio, referenceTyreControl } from "../src/audio/ReferenceAudio";
import { VehicleAudioGraph } from "../src/audio/VehicleAudioGraph";
import { DEFAULT_AUDIO_SETTINGS } from "../src/audio/settings";
import { REFERENCE_MODEL_ID } from "../src/audio/reference-tuning";
import { auditionFrame } from "../src/audio/audition";
import { engineAudioProfile } from "../src/audio/profiles";
import { DEFAULT_SETUP } from "../src/vehicle/setup";
import type { AudioSourceFactory } from "../src/audio/source-types";

class Param {
  value = 0;
  events: { value: number; time: number }[] = [];
  cancelScheduledValues(time: number) { this.events = this.events.filter((event) => event.time < time); }
  setTargetAtTime(value: number, time: number) { this.events.push({ value, time }); }
  setValueAtTime(value: number, time: number) { this.value = value; this.events.push({ value, time }); }
}
class Node {
  gain = new Param(); frequency = new Param(); Q = new Param(); pan = new Param();
  positionX = new Param(); positionY = new Param(); positionZ = new Param();
  connections: { target: unknown; output?: number }[] = [];
  disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
  connect(target: unknown, output?: number) { this.connections.push({ target, output }); return target; }
}
class Worklet extends Node {
  static nodes: Worklet[] = [];
  onprocessorerror?: () => void;
  port = { postMessage: vi.fn(), close: vi.fn(), onmessage: null as ((event: { data: unknown }) => void) | null };
  constructor(_context: unknown, readonly name: string, readonly options: AudioWorkletNodeOptions) {
    super(); Worklet.nodes.push(this);
  }
  acknowledge() { this.port.onmessage?.({ data: { type: "profile-ready" } }); }
}
class Context {
  currentTime = 1; sampleRate = 48000; state = "running";
  destination = new Node(); nodes: Node[] = [];
  audioWorklet = { addModule: vi.fn(async () => {}) };
  createGain() { const node = new Node(); this.nodes.push(node); return node; }
  createBiquadFilter() { return this.createGain(); }
  createBufferSource() { return this.createGain(); }
  createOscillator() { return this.createGain(); }
  createPanner() { return this.createGain(); }
  createStereoPanner() { return this.createGain(); }
  createWaveShaper() { return this.createGain(); }
  createBuffer(_channels: number, size: number) { return { getChannelData: () => new Float32Array(size) }; }
  get audio() { return this as unknown as AudioContext; }
}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const profile = engineAudioProfile(DEFAULT_SETUP), settings = { ...DEFAULT_AUDIO_SETTINGS };
const frame = auditionFrame(["fl", "fr", "rl", "rr"], 1, true);
afterEach(() => { vi.unstubAllGlobals(); Worklet.nodes = []; });

describe("accepted sounds in the driving graph", () => {
  it("keeps spectral character separate from the collector's once-weighted level", () => {
    const full = { ...frame.wheels[0], slip: 0.8, warning: 0.5, load: 1 };
    const light = { ...full, slip: 0.2, warning: 0.125, load: 0.25 };
    const a = referenceTyreControl(full, settings), b = referenceTyreControl(light, settings);
    expect(b.slip).toBe(a.slip); expect(b.warning).toBe(a.warning);
    expect(b.level).toBeCloseTo(a.level * 0.25);
    expect(b.rolling).toBe(0); // Existing road branch owns rolling sound.
    const unloaded = referenceTyreControl({ ...light, load: 0, slip: 0, warning: 0 }, settings);
    expect([unloaded.slip, unloaded.warning, unloaded.level]).toEqual([0, 0, 0]);
    expect(referenceTyreControl(full, { ...settings, axleCue: 0 }).rearPitch).toBe(1);
  });

  it("loads once per context and creates independent wheels alongside the preserved surface paths", async () => {
    vi.stubGlobal("AudioWorkletNode", Worklet);
    const fetchModel = vi.fn(async () => ({ ok: true, json: async () => ({ id: REFERENCE_MODEL_ID }) }));
    vi.stubGlobal("fetch", fetchModel);
    const context = new Context();
    const first = loadDrivingAudio(context.audio);
    expect(loadDrivingAudio(context.audio)).toBe(first);
    const factory = await first;
    const output = new Node() as unknown as AudioNode;
    const engine = factory.engine(output, profile, vi.fn());
    const wheels = frame.wheels.map((wheel) => factory.wheel(wheel.id, output, output, vi.fn()));
    Worklet.nodes.forEach((node) => node.acknowledge());
    await Promise.all(wheels.map((wheel) => wheel.ready));
    expect(fetchModel).toHaveBeenCalledTimes(1);
    expect(context.audioWorklet.addModule).toHaveBeenCalledTimes(2);
    expect(Worklet.nodes.filter((node) => node.name === "playground-reference-tyre")).toHaveLength(4);
    const seeds = Worklet.nodes.slice(1).map((node) => node.port.postMessage.mock.calls.find(([message]) => message.type === "reset")![0].seed);
    expect(new Set(seeds).size).toBe(4);
    for (const [index, wheel] of wheels.entries()) wheel.update(frame.wheels[index], settings, 1);
    expect(Worklet.nodes.slice(1).every((node) => node.connections.length === 1 && node.connections[0].output === 0)).toBe(true);
    // Native surface noise and kerb pulses remain active independently of tyre output 1.
    expect(context.nodes.filter((node) => node.start.mock.calls.length)).toHaveLength(8);
    engine.dispose(); wheels.forEach((wheel) => { wheel.dispose(); wheel.dispose(); });
    expect(Worklet.nodes.every((node) => node.disconnect.mock.calls.length === 1 && node.port.close.mock.calls.length === 1)).toBe(true);
    expect(context.nodes.filter((node) => node.start.mock.calls.length).every((node) => node.stop.mock.calls.length === 1)).toBe(true);
  });

  it("reports missing or mismatched local profiles without substituting the rejected source", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    await expect(loadDrivingAudio(new Context().audio)).rejects.toThrow("profile unavailable");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id: "other-profile" }) })));
    await expect(loadDrivingAudio(new Context().audio)).rejects.toThrow("does not match");
  });

  it("drops frames during loading and honors mute changes before readiness", async () => {
    const context = new Context(), pending = deferred();
    const engine = { update: vi.fn(), dispose: vi.fn() };
    const wheels = frame.wheels.map(() => ({ ready: pending.promise, update: vi.fn(), reset: vi.fn(), dispose: vi.fn() }));
    let index = 0;
    const factory: AudioSourceFactory = { engine: () => engine, wheel: () => wheels[index++] };
    const graph = new VehicleAudioGraph(context.audio, context.audio.destination, settings, profile, 1, Promise.resolve(factory));
    await Promise.resolve();
    graph.update(frame);
    expect(engine.update).not.toHaveBeenCalled();
    graph.configure({ ...settings, enabled: false });
    pending.resolve(); await graph.ready;
    expect(graph.isReady).toBe(true);
    expect(engine.update).not.toHaveBeenCalled();
    graph.update(frame);
    expect(engine.update).toHaveBeenCalledTimes(1);
    expect((graph.output.gain as unknown as Param).events.every((event) => event.value === 0)).toBe(true);
    graph.silence(); graph.silence();
    expect(wheels.every((wheel) => wheel.reset.mock.calls.length === 1)).toBe(true);
    graph.dispose(); graph.dispose();
    expect(wheels.every((wheel) => wheel.dispose.mock.calls.length === 1)).toBe(true);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not create voices after disposal while preparation is pending", async () => {
    const context = new Context();
    let resolve!: (factory: AudioSourceFactory) => void;
    const pending = new Promise<AudioSourceFactory>((done) => { resolve = done; });
    const factory = { engine: vi.fn(), wheel: vi.fn() };
    const graph = new VehicleAudioGraph(context.audio, context.audio.destination, settings, profile, 1, pending);
    graph.dispose(); resolve(factory); await graph.ready;
    expect(factory.engine).not.toHaveBeenCalled(); expect(factory.wheel).not.toHaveBeenCalled();
    expect(graph.isReady).toBe(false);
  });
});
