import type { WheelId } from "../vehicle/types";
import type { AudioSettings } from "./types";
import { clampAudio, smoothParam, stopAndDisconnect } from "./nodes";

export interface SpatialSignalMeasurement { finite: boolean; rms: number; peak: number }

/** Audio coordinates: -X left, -Z forward; equal radius for every quadrant. */
export function wheelAudioPosition(id: WheelId, width = 0.75): { x: number; y: number; z: number } {
  const angle = (Math.PI / 4) * (clampAudio(width) / 0.75);
  return {
    x: (id[1] === "l" ? -1 : 1) * Math.sin(angle),
    y: 0,
    z: (id[0] === "f" ? -1 : 1) * Math.cos(angle),
  };
}

/** Exclusive mono -> HRTF, stereo, or mono paths. Never pan a binaural result. */
export class SpatialAudio {
  readonly input: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly hrtf?: PannerNode;
  private readonly stereo?: StereoPannerNode;
  private readonly hrtfMix?: GainNode;
  private readonly stereoMix?: GainNode;
  private readonly monoMix: GainNode;
  private readonly manualLeft?: GainNode;
  private readonly manualRight?: GainNode;
  private disposed = false;
  private meters?: { analysers: Record<string, AnalyserNode>; pcm: Float32Array<ArrayBuffer> };

  constructor(
    private readonly context: BaseAudioContext,
    private readonly id: WheelId,
    output: AudioNode,
  ) {
    this.input = this.gain(1);
    this.input.channelCount = 1;
    this.input.channelCountMode = "explicit";
    this.monoMix = this.gain(0);
    this.monoMix.channelCount = 2;
    this.monoMix.channelCountMode = "explicit";
    this.input.connect(this.monoMix).connect(output);
    let candidate: PannerNode | undefined;
    try {
      candidate = context.createPanner();
      candidate.panningModel = "HRTF";
      candidate.rolloffFactor = 0;
      candidate.refDistance = 1;
      candidate.maxDistance = 1;
      candidate.coneInnerAngle = 360;
      candidate.coneOuterAngle = 360;
      candidate.coneOuterGain = 1;
      this.hrtf = candidate;
      this.nodes.push(candidate);
      this.hrtfMix = this.gain(0);
      this.input.connect(candidate).connect(this.hrtfMix).connect(output);
    } catch {
      candidate?.disconnect();
    }
    try {
      this.stereo = context.createStereoPanner();
      this.stereo.channelCount = 1;
      this.stereo.channelCountMode = "explicit";
      this.nodes.push(this.stereo);
      this.stereoMix = this.gain(0);
      this.input.connect(this.stereo).connect(this.stereoMix).connect(output);
    } catch {
      // Equal-power channel gains also work in engines without StereoPannerNode.
      try {
        const merger = context.createChannelMerger(2);
        this.nodes.push(merger);
        this.manualLeft = this.gain(Math.SQRT1_2);
        this.manualRight = this.gain(Math.SQRT1_2);
        this.stereoMix = this.gain(0);
        this.input.connect(this.manualLeft).connect(merger, 0, 0);
        this.input.connect(this.manualRight).connect(merger, 0, 1);
        merger.connect(this.stereoMix).connect(output);
      } catch {
        // The mono path is always available as the final fallback.
      }
    }
    this.configure({ output: "headphones", width: 0.75 } as AudioSettings);
  }

  configure(settings: AudioSettings, time = this.context.currentTime): void {
    if (this.disposed) return;
    const at = Number.isFinite(time) ? Math.max(0, time) : this.context.currentTime;
    const width = clampAudio(settings.width);
    const headphone = settings.output === "headphones" && !!this.hrtf;
    const stereo = settings.output !== "mono" && !headphone && !!this.stereoMix;
    if (this.hrtfMix) smoothParam(this.hrtfMix.gain, headphone ? 1 : 0, at, 0.015);
    if (this.stereoMix) smoothParam(this.stereoMix.gain, stereo ? 1 : 0, at, 0.015);
    smoothParam(this.monoMix.gain, headphone || stereo ? 0 : Math.SQRT1_2, at, 0.015);
    const pan = (this.id[1] === "l" ? -1 : 1) * width;
    if (this.stereo) smoothParam(this.stereo.pan, pan, at, 0.015);
    if (this.manualLeft && this.manualRight) {
      const angle = ((pan + 1) * Math.PI) / 4;
      smoothParam(this.manualLeft.gain, Math.cos(angle), at, 0.015);
      smoothParam(this.manualRight.gain, Math.sin(angle), at, 0.015);
    }
    if (this.hrtf) {
      const position = wheelAudioPosition(this.id, width);
      smoothParam(this.hrtf.positionX, position.x, at, 0.015);
      smoothParam(this.hrtf.positionY, position.y, at, 0.015);
      smoothParam(this.hrtf.positionZ, position.z, at, 0.015);
    }
  }

  /** Explicit diagnostic taps only; no changes to the audible routing or panner controls. */
  sampleSignals(): Record<string, SpatialSignalMeasurement> {
    if (this.disposed) return {};
    if (!this.meters) {
      const analysers: Record<string, AnalyserNode> = {};
      const sources: [string, AudioNode | undefined][] = [
        ["input", this.input], ["hrtf", this.hrtf], ["hrtf-routed", this.hrtfMix],
        ["stereo", this.stereo], ["stereo-routed", this.stereoMix], ["mono-routed", this.monoMix],
      ];
      for (const [name, source] of sources) {
        if (!source) continue;
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        this.nodes.push(analyser);
        analysers[name] = analyser;
      }
      this.meters = { analysers, pcm: new Float32Array(2048) };
    }
    const result: Record<string, SpatialSignalMeasurement> = {}, { pcm, analysers } = this.meters;
    for (const [name, analyser] of Object.entries(analysers)) {
      analyser.getFloatTimeDomainData(pcm);
      let finite = true, energy = 0, peak = 0;
      for (const value of pcm) {
        finite &&= Number.isFinite(value);
        if (Number.isFinite(value)) { energy += value * value; peak = Math.max(peak, Math.abs(value)); }
      }
      result[name] = { finite, rms: Math.sqrt(energy / pcm.length), peak };
    }
    return result;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    stopAndDisconnect([], this.nodes);
    this.meters = undefined;
  }

  private gain(value: number): GainNode {
    const gain = this.context.createGain();
    gain.gain.value = value;
    this.nodes.push(gain);
    return gain;
  }
}
