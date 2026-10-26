import { describe, expect, it } from "vitest";
import { EngineVoice } from "../src/audio/EngineVoice";
import { SpatialAudio, wheelAudioPosition } from "../src/audio/SpatialAudio";
import { TyreVoice } from "../src/audio/TyreVoice";
import { smoothParam } from "../src/audio/nodes";
import type { AudioSettings, EngineAudioControl, TyreAudioControl } from "../src/audio/types";
import type { WheelId } from "../src/vehicle/types";

class Param {
  value = 0;
  events: { value: number; time: number; tau: number }[] = [];
  cancelScheduledValues(time: number): void {
    this.events = this.events.filter((event) => event.time < time);
  }
  setTargetAtTime(value: number, time: number, tau: number): void {
    this.events.push({ value, time, tau });
  }
  get target(): number {
    return this.events.at(-1)?.value ?? this.value;
  }
}

class Node {
  gain = new Param();
  frequency = new Param();
  detune = new Param();
  Q = new Param();
  pan = new Param();
  positionX = new Param();
  positionY = new Param();
  positionZ = new Param();
  connections: { destination: Node | Param; output?: number; input?: number }[] = [];
  starts: number[] = [];
  stops = 0;
  disconnects = 0;
  type = "sine";
  channelCount = 2;
  channelCountMode = "max";
  panningModel = "equalpower";
  rolloffFactor = 1;
  refDistance = 1;
  maxDistance = 10000;
  coneInnerAngle = 360;
  coneOuterAngle = 360;
  coneOuterGain = 0;
  buffer?: unknown;
  loop = false;
  wave?: unknown;
  constructor(readonly kind: string) {}
  connect(destination: Node | Param, output?: number, input?: number): Node | Param {
    this.connections.push({ destination, output, input });
    return destination;
  }
  disconnect(): void { this.disconnects++; }
  start(time = 0): void { this.starts.push(time); }
  stop(): void { this.stops++; }
  setPeriodicWave(wave: unknown): void { this.wave = wave; }
}

class Context {
  currentTime = 0;
  sampleRate = 48000;
  nodes: Node[] = [];
  buffers: Float32Array[] = [];
  noHrtf = false;
  noStereo = false;
  node(kind: string): Node {
    const node = new Node(kind);
    this.nodes.push(node);
    return node;
  }
  createGain(): Node { return this.node("gain"); }
  createOscillator(): Node { return this.node("oscillator"); }
  createBiquadFilter(): Node { return this.node("filter"); }
  createBufferSource(): Node { return this.node("buffer-source"); }
  createPanner(): Node {
    if (this.noHrtf) throw new Error("HRTF unavailable");
    return this.node("hrtf");
  }
  createStereoPanner(): Node {
    if (this.noStereo) throw new Error("StereoPanner unavailable");
    return this.node("stereo");
  }
  createChannelMerger(): Node { return this.node("merger"); }
  createPeriodicWave(real: Float32Array, imaginary: Float32Array): unknown {
    return { real, imaginary };
  }
  createBuffer(_channels: number, length: number): unknown {
    const samples = new Float32Array(length);
    this.buffers.push(samples);
    return { getChannelData: () => samples };
  }
  get audio(): BaseAudioContext { return this as unknown as BaseAudioContext; }
}

const settings: AudioSettings = {
  version: 1, enabled: true, master: 1, engine: 1, tyres: 1, surface: 1,
  output: "headphones", axleCue: 1, width: 0.75, softSqueal: false,
};
const engine: EngineAudioControl = {
  rpm: 3000, load: 0.9, driveLoad: 0.9, shifting: false, gear: 2, overrun: 0,
};
function wheel(id: WheelId): TyreAudioControl {
  return {
    id, grounded: true, warning: 0.8, slip: 1, rolling: 0.5,
    speed: 20, slipSpeed: 10, demand: 2, load: 0.8, kerb: 0, gravel: 0,
    sand: 0, grass: 0, tarmac: 1, roughness: 0.2, absActive: false,
    tractionActive: false,
  };
}
function connected(node: Node, index = 0): Node {
  return node.connections[index].destination as Node;
}
function directGains(context: Context, output: Node): Node[] {
  return context.nodes.filter((node) => node.kind === "gain" && node.connections.some((connection) => connection.destination === output));
}

describe("native driving voices", () => {
  it("keeps continuous RPM-driven oscillators and body while cutting the shift load layer", () => {
    const context = new Context();
    const output = new Node("output");
    const voice = new EngineVoice(context.audio, output as unknown as AudioNode, {
      id: "compact", cylinders: 4, body: 1, brightness: 1, irregularity: 0.4, seed: 42,
    }, 0.1);
    const periodic = context.nodes.filter((node) => node.wave);
    const bodyGain = connected(connected(periodic[0]));
    const growlGain = connected(connected(periodic[1]));
    const count = context.nodes.length;
    voice.update(engine, 0.2);
    const fullLoad = growlGain.gain.target;
    const lowerPitch = periodic[0].frequency.target;
    voice.update({ ...engine, rpm: 6000, shifting: true }, 0.4);
    expect(periodic[0].frequency.target).toBeGreaterThan(lowerPitch);
    expect(growlGain.gain.target).toBeLessThan(fullLoad / 2);
    expect(bodyGain.gain.target).toBeGreaterThan(0);
    voice.update({ ...engine, rpm: 4500 }, 0.6);
    expect(growlGain.gain.target).toBeGreaterThan(fullLoad / 2);
    expect(periodic[0].frequency.events).toHaveLength(3);
    expect(context.nodes).toHaveLength(count);
    expect(context.nodes.filter((node) => node.starts.length).every((node) => node.starts.length === 1)).toBe(true);
    voice.dispose();
    voice.dispose();
    expect(context.nodes.every((node) => node.disconnects === 1)).toBe(true);
    expect(context.nodes.filter((node) => node.starts.length).every((node) => node.stops === 1)).toBe(true);
    expect(output.disconnects).toBe(0);
  });

  it("retains stationary burnout sound and promptly silences airborne or held contact", () => {
    const context = new Context();
    const tyreOutput = new Node("tyre-output");
    const surfaceOutput = new Node("surface-output");
    const voice = new TyreVoice(context.audio, "rl", tyreOutput as unknown as AudioNode, surfaceOutput as unknown as AudioNode);
    const tyreGains = directGains(context, tyreOutput);
    const surfaceGains = directGains(context, surfaceOutput);
    voice.update({ ...wheel("rl"), speed: 0 }, settings, 0.1);
    expect(tyreGains.some((node) => node.gain.target > 0)).toBe(true);
    voice.update({ ...wheel("rl"), grounded: false }, settings, 0.2);
    expect([...tyreGains, ...surfaceGains].every((node) => node.gain.target === 0)).toBe(true);
    expect(tyreGains.every((node) => node.gain.events.at(-1)!.tau < 0.01)).toBe(true);
    voice.update({ ...wheel("rl"), speed: 0, slipSpeed: 0 }, settings, 0.3);
    expect([...tyreGains, ...surfaceGains].every((node) => node.gain.target === 0)).toBe(true);
    voice.dispose();
    voice.dispose();
    expect(context.nodes.every((node) => node.disconnects === 1)).toBe(true);
    expect(context.nodes.filter((node) => node.starts.length).every((node) => node.stops === 1)).toBe(true);
  });

  it("uses decorrelated wheel streams and keeps rear tone below front through severity and softer squeal", () => {
    const context = new Context();
    const output = new Node("output") as unknown as AudioNode;
    const front = new TyreVoice(context.audio, "fl", output, output);
    const frontTone = context.nodes.find((node) => node.wave)!;
    const frontNoise = context.buffers[0];
    const rear = new TyreVoice(context.audio, "rl", output, output);
    const rearTone = context.nodes.filter((node) => node.wave).at(-1)!;
    const rearNoise = context.buffers[2];
    let product = 0, frontPower = 0, rearPower = 0;
    for (let i = 0; i < 4096; i++) {
      product += frontNoise[i] * rearNoise[i];
      frontPower += frontNoise[i] ** 2;
      rearPower += rearNoise[i] ** 2;
    }
    expect(Math.abs(product / Math.sqrt(frontPower * rearPower))).toBeLessThan(0.05);
    front.update({ ...wheel("fl"), slip: 0.1 }, settings, 0.1);
    rear.update(wheel("rl"), { ...settings, softSqueal: true }, 0.1);
    expect(rearTone.frequency.target).toBeLessThan(frontTone.frequency.target * 0.7);
    front.dispose();
    rear.dispose();
  });
});

describe("spatial audio routing", () => {
  it("maps all wheel IDs to the intended equal-distance driver-relative quadrants", () => {
    for (const id of ["fl", "fr", "rl", "rr"] as const) {
      const position = wheelAudioPosition(id);
      expect(Math.hypot(position.x, position.y, position.z)).toBeCloseTo(1);
      expect(position.x < 0).toBe(id[1] === "l");
      expect(position.z < 0).toBe(id[0] === "f");
      expect(Math.abs(position.x)).toBeCloseTo(Math.SQRT1_2);
    }
  });

  it("selects separate paths and reaches exact side separation without repanning HRTF", () => {
    const context = new Context();
    const output = new Node("output");
    const spatial = new SpatialAudio(context.audio, "fl", output as unknown as AudioNode);
    const hrtf = context.nodes.find((node) => node.kind === "hrtf")!;
    const stereo = context.nodes.find((node) => node.kind === "stereo")!;
    const mixes = directGains(context, output);
    expect(hrtf.panningModel).toBe("HRTF");
    expect(hrtf.rolloffFactor).toBe(0);
    expect(connected(connected(hrtf))).toBe(output);
    expect(connected(connected(stereo))).toBe(output);
    expect(mixes.filter((node) => node.gain.target > 0)).toHaveLength(1);
    spatial.configure({ ...settings, output: "stereo", width: 1 }, 0.5);
    expect(stereo.pan.target).toBe(-1);
    expect(connected(hrtf).gain.target).toBe(0);
    expect(mixes.filter((node) => node.gain.target > 0)).toHaveLength(1);
    spatial.configure({ ...settings, output: "mono" }, 1);
    expect(connected(stereo).gain.target).toBe(0);
    expect(mixes.filter((node) => node.gain.target > 0)).toHaveLength(1);
    spatial.dispose();
    spatial.dispose();
    expect(context.nodes.every((node) => node.disconnects === 1)).toBe(true);
    expect(output.disconnects).toBe(0);
  });

  it("falls back to equal-power stereo and channel gains when optional panners fail", () => {
    const context = new Context();
    context.noHrtf = true;
    context.noStereo = true;
    const output = new Node("output");
    const spatial = new SpatialAudio(context.audio, "fr", output as unknown as AudioNode);
    spatial.configure({ ...settings, width: 1 }, 0.1);
    const merger = context.nodes.find((node) => node.kind === "merger")!;
    const channels = context.nodes.filter((node) => node.connections.some((connection) => connection.destination === merger));
    const left = channels.find((node) => node.connections[0].input === 0)!;
    const right = channels.find((node) => node.connections[0].input === 1)!;
    expect(left.gain.target).toBeCloseTo(0);
    expect(right.gain.target).toBeCloseTo(1);
    expect(directGains(context, output).filter((node) => node.gain.target > 0)).toHaveLength(1);
    spatial.dispose();
  });

  it("keeps earlier future controls intact when scheduling an offline sequence", () => {
    const param = new Param();
    smoothParam(param as unknown as AudioParam, 1, 0.1);
    smoothParam(param as unknown as AudioParam, 0.3, 0.4);
    smoothParam(param as unknown as AudioParam, 0.7, 0.8);
    expect(param.events.map((event) => event.time)).toEqual([0.1, 0.4, 0.8]);
    expect(param.events.every((event) => Number.isFinite(event.value))).toBe(true);
  });
});
