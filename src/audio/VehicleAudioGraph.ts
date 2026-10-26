import { EngineVoice } from "./EngineVoice";
import { TyreVoice } from "./TyreVoice";
import { SpatialAudio } from "./SpatialAudio";
import { createNoise, smoothParam, stopAndDisconnect } from "./nodes";
import { WHEEL_IDS } from "../vehicle/types";
import type { AudioControlFrame, AudioSettings, EngineAudioProfile } from "./types";
import type { AudioSourceFactory, EngineAudioSource, WheelAudioSource } from "./source-types";

export interface AudioSignalMeasurement {
  finite: boolean;
  rms: number;
  peak: number;
}

export interface VehicleAudioSignalSample {
  warmedUp: boolean;
  audioTime: number;
  outputGain: number;
  engineGain: number;
  output: AudioSignalMeasurement;
  engine: AudioSignalMeasurement;
  mix: AudioSignalMeasurement;
  ceiling: AudioSignalMeasurement;
  impact: AudioSignalMeasurement;
  wheels: { id: string; signals: Record<string, AudioSignalMeasurement> }[];
}

/** Established buses/spatial paths; driving supplies accepted sources, legacy QA keeps its native sources. */
export class VehicleAudioGraph {
  readonly output: GainNode;
  readonly ready: Promise<void>;
  isReady = false;
  onError?: (error: Error) => void;
  private readonly mix: GainNode;
  private readonly ceiling: WaveShaperNode;
  private readonly engineBus: GainNode;
  private engine?: EngineAudioSource;
  private readonly wheels: { voice?: WheelAudioSource; spatial: SpatialAudio; tyre: GainNode; surface: GainNode }[];
  private readonly impact: AudioBufferSourceNode;
  private readonly impactFilter: BiquadFilterNode;
  private readonly impactGain: GainNode;
  private settings: AudioSettings;
  private stopped = false;
  private quiet = true;
  private meters?: { output: AnalyserNode; engine: AnalyserNode; mix: AnalyserNode; ceiling: AnalyserNode; impact: AnalyserNode; pcm: Float32Array<ArrayBuffer>; started: number };
  constructor(
    readonly context: BaseAudioContext,
    destination: AudioNode,
    settings: AudioSettings,
    profile: EngineAudioProfile,
    startTime = context.currentTime,
    sources?: Promise<AudioSourceFactory>,
  ) {
    this.settings = { ...settings };
    this.mix = context.createGain();
    this.ceiling = context.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 1.3) * 0.9;
    // A static symmetric ceiling reserves digital headroom without a delayed compressor.
    // This bounds digital samples; it is not a calibrated acoustic or true-peak limit.
    this.ceiling.curve = curve;
    this.ceiling.oversample = "none";
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.mix.connect(this.ceiling).connect(this.output).connect(destination);
    this.engineBus = context.createGain();
    this.engineBus.connect(this.mix);
    this.wheels = WHEEL_IDS.map((id) => {
      const spatial = new SpatialAudio(context, id, this.mix);
      const tyre = context.createGain(), surface = context.createGain();
      tyre.connect(spatial.input);
      surface.connect(spatial.input);
      return { spatial, tyre, surface };
    });
    this.impact = createNoise(context, 0x7c31, 2.17);
    this.impactFilter = context.createBiquadFilter();
    this.impactFilter.type = "lowpass";
    this.impactFilter.frequency.value = 750;
    this.impactGain = context.createGain();
    this.impactGain.gain.value = 0;
    this.impact.connect(this.impactFilter).connect(this.impactGain).connect(this.mix);
    this.impact.start(startTime);
    this.configure(settings, startTime);
    if (sources) {
      this.ready = sources.then(async (factory) => {
        if (this.stopped) return;
        const onError = (error: Error) => { if (!this.stopped) this.onError?.(error); };
        this.engine = factory.engine(this.engineBus, profile, onError);
        for (const [index, wheel] of this.wheels.entries())
          wheel.voice = factory.wheel(WHEEL_IDS[index], wheel.tyre, wheel.surface, onError);
        await Promise.all(this.wheels.map((wheel) => wheel.voice?.ready));
        if (!this.stopped) this.isReady = true;
        // Never reopen from a frame received during loading. The next fresh
        // telemetry publication is the only thing that opens the output gate.
      });
    } else {
      // Retained for the original native/offline diagnostic and A/B foundation.
      this.engine = new EngineVoice(context, this.engineBus, profile, startTime);
      this.wheels.forEach((wheel, index) => { wheel.voice = new TyreVoice(context, WHEEL_IDS[index], wheel.tyre, wheel.surface, startTime); });
      this.isReady = true;
      this.ready = Promise.resolve();
    }
  }
  configure(settings: AudioSettings, time = this.context.currentTime) {
    if (this.stopped) return;
    this.settings = { ...settings };
    for (const wheel of this.wheels) {
      smoothParam(wheel.tyre.gain, settings.tyres, time, 0.015);
      smoothParam(wheel.surface.gain, settings.surface, time, 0.015);
      wheel.spatial.configure(settings, time);
    }
    if (!settings.enabled) this.silence(time);
  }
  prepareResume(time = this.context.currentTime) {
    if (this.stopped) return;
    this.silence(time);
    this.output.gain.cancelScheduledValues(time);
    this.output.gain.setValueAtTime(0, time);
  }
  update(frame: AudioControlFrame, time = this.context.currentTime) {
    if (this.stopped || !this.isReady) return;
    this.quiet = false;
    const s = this.settings;
    this.engine?.update(frame.engine, time);
    let warning = 0;
    this.wheels.forEach((wheel, index) => {
      const control = frame.wheels.find((w) => w.id === WHEEL_IDS[index]);
      if (!control) return;
      wheel.voice?.update(control, s, time);
      warning = Math.max(warning, control.warning, control.slip);
    });
    const duck = Math.pow(10, (-3 * warning * s.tyres) / 20);
    smoothParam(this.engineBus.gain, s.engine * duck, time, 0.025);
    smoothParam(this.impactGain.gain, Math.min(1, Math.max(0, frame.impact)) * s.surface * 0.06, time, 0.015);
    smoothParam(this.output.gain, s.enabled ? s.master : 0, time, 0.008);
    // Refreshed from the audio clock. A blocked main thread cannot sustain stale sound.
    this.output.gain.setTargetAtTime(0, time + 0.2, 0.02);
  }
  silence(time = this.context.currentTime) {
    if (this.stopped) return;
    smoothParam(this.output.gain, 0, time, 0.008);
    smoothParam(this.impactGain.gain, 0, time, 0.002);
    if (!this.quiet) for (const wheel of this.wheels) wheel.voice?.reset(time);
    this.quiet = true;
  }
  /** Explicit diagnostics only: the normal graph has no analyser allocation or sampling. */
  sampleSignals(): VehicleAudioSignalSample | undefined {
    if (this.stopped) return undefined;
    if (!this.meters) {
      const output = this.context.createAnalyser(), engine = this.context.createAnalyser(), mix = this.context.createAnalyser(), ceiling = this.context.createAnalyser(), impact = this.context.createAnalyser();
      output.fftSize = engine.fftSize = mix.fftSize = ceiling.fftSize = impact.fftSize = 2048;
      this.output.connect(output);
      this.engineBus.connect(engine);
      this.mix.connect(mix);
      this.ceiling.connect(ceiling);
      this.impactGain.connect(impact);
      this.meters = { output, engine, mix, ceiling, impact, pcm: new Float32Array(2048), started: this.context.currentTime };
    }
    const meters = this.meters;
    const measure = (analyser: AnalyserNode): AudioSignalMeasurement => {
      analyser.getFloatTimeDomainData(meters.pcm);
      let finite = true, energy = 0, peak = 0;
      for (const value of meters.pcm) {
        finite &&= Number.isFinite(value);
        if (Number.isFinite(value)) { energy += value * value; peak = Math.max(peak, Math.abs(value)); }
      }
      return { finite, rms: Math.sqrt(energy / meters.pcm.length), peak };
    };
    return {
      warmedUp: this.context.currentTime - meters.started >= 0.15,
      audioTime: this.context.currentTime,
      outputGain: this.output.gain.value,
      engineGain: this.engineBus.gain.value,
      output: measure(meters.output), engine: measure(meters.engine),
      mix: measure(meters.mix), ceiling: measure(meters.ceiling), impact: measure(meters.impact),
      wheels: this.wheels.map((wheel, index) => ({ id: WHEEL_IDS[index], signals: wheel.spatial.sampleSignals() })),
    };
  }
  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    this.meters?.output.disconnect();
    this.meters?.engine.disconnect();
    this.meters?.mix.disconnect();
    this.meters?.ceiling.disconnect();
    this.meters?.impact.disconnect();
    this.meters = undefined;
    this.onError = undefined;
    this.engine?.dispose();
    for (const w of this.wheels) {
      w.voice?.dispose(); w.spatial.dispose(); w.tyre.disconnect(); w.surface.disconnect();
    }
    stopAndDisconnect([this.impact], []);
    for (const node of [this.impactFilter, this.impactGain, this.engineBus, this.mix, this.ceiling, this.output]) node.disconnect();
  }
}
