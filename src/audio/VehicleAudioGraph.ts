import { EngineVoice } from "./EngineVoice";
import { TyreVoice } from "./TyreVoice";
import { SpatialAudio } from "./SpatialAudio";
import { createNoise, smoothParam, stopAndDisconnect } from "./nodes";
import { WHEEL_IDS } from "../vehicle/types";
import type { AudioControlFrame, AudioSettings, EngineAudioProfile } from "./types";

/** The same bounded native graph is used live and by OfflineAudioContext QA. */
export class VehicleAudioGraph {
  readonly output: GainNode;
  private readonly mix: GainNode;
  private readonly ceiling: WaveShaperNode;
  private readonly engineBus: GainNode;
  private readonly engine: EngineVoice;
  private readonly wheels: { voice: TyreVoice; spatial: SpatialAudio; tyre: GainNode; surface: GainNode }[];
  private readonly impact: AudioBufferSourceNode;
  private readonly impactFilter: BiquadFilterNode;
  private readonly impactGain: GainNode;
  private settings: AudioSettings;
  private stopped = false;
  constructor(
    readonly context: BaseAudioContext,
    destination: AudioNode,
    settings: AudioSettings,
    profile: EngineAudioProfile,
    startTime = context.currentTime,
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
    this.engine = new EngineVoice(context, this.engineBus, profile, startTime);
    this.wheels = WHEEL_IDS.map((id) => {
      const spatial = new SpatialAudio(context, id, this.mix);
      const tyre = context.createGain(), surface = context.createGain();
      tyre.connect(spatial.input);
      surface.connect(spatial.input);
      return { voice: new TyreVoice(context, id, tyre, surface, startTime), spatial, tyre, surface };
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
    if (this.stopped) return;
    const s = this.settings;
    this.engine.update(frame.engine, time);
    let warning = 0;
    this.wheels.forEach((wheel, index) => {
      const control = frame.wheels.find((w) => w.id === WHEEL_IDS[index]);
      if (!control) return;
      wheel.voice.update(control, s, time);
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
    for (const wheel of this.wheels) wheel.voice.reset(time);
  }
  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    this.engine.dispose();
    for (const w of this.wheels) {
      w.voice.dispose(); w.spatial.dispose(); w.tyre.disconnect(); w.surface.disconnect();
    }
    stopAndDisconnect([this.impact], []);
    for (const node of [this.impactFilter, this.impactGain, this.engineBus, this.mix, this.ceiling, this.output]) node.disconnect();
  }
}
