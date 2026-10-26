import type { EngineAudioControl, EngineAudioProfile } from "./types";
import { clampAudio, createNoise, smoothParam, stopAndDisconnect } from "./nodes";

/** Continuous periodic engine orders, with independently controlled load texture. */
export class EngineVoice {
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private readonly body: OscillatorNode;
  private readonly growl: OscillatorNode;
  private readonly bodyFilter: BiquadFilterNode;
  private readonly growlFilter: BiquadFilterNode;
  private readonly mechanicalFilter: BiquadFilterNode;
  private readonly bodyGain: GainNode;
  private readonly growlGain: GainNode;
  private readonly mechanicalGain: GainNode;
  private readonly overrunGain: GainNode;
  private readonly wobbleDepth: GainNode;
  private readonly cylinders: number;
  private readonly bodyWeight: number;
  private readonly brightness: number;
  private readonly irregularity: number;
  private disposed = false;

  constructor(
    private readonly context: BaseAudioContext,
    output: AudioNode,
    profile: EngineAudioProfile,
    startTime = context.currentTime,
  ) {
    const start = Math.max(context.currentTime, startTime);
    this.cylinders = clampAudio(profile.cylinders, 2, 12);
    this.bodyWeight = clampAudio(profile.body, 0.5, 1.5);
    this.brightness = clampAudio(profile.brightness, 0.5, 1.5);
    this.irregularity = clampAudio(profile.irregularity);
    const noise = createNoise(context, profile.seed ^ 0x4b1d3a71);
    const overrun = createNoise(context, profile.seed ^ 0x392c9ab5);
    this.body = context.createOscillator();
    this.growl = context.createOscillator();
    this.body.setPeriodicWave(this.wave(false, profile.seed));
    this.growl.setPeriodicWave(this.wave(true, profile.seed));
    this.body.frequency.value = (900 * this.cylinders) / 120;
    this.growl.frequency.value = this.body.frequency.value;
    this.bodyFilter = this.filter("lowpass", 650);
    this.bodyFilter.Q.value = 0.6;
    this.growlFilter = this.filter("lowpass", 1800);
    this.growlFilter.Q.value = 0.55;
    this.mechanicalFilter = this.filter("bandpass", 850);
    this.mechanicalFilter.Q.value = 0.65;
    const overrunFilter = this.filter("lowpass", 210);
    overrunFilter.Q.value = 0.55;
    this.bodyGain = this.gain(0.028 * this.bodyWeight);
    this.growlGain = this.gain(0.003);
    this.mechanicalGain = this.gain(0.003);
    this.overrunGain = this.gain(0);
    this.body.connect(this.bodyFilter).connect(this.bodyGain).connect(output);
    this.growl.connect(this.growlFilter).connect(this.growlGain).connect(output);
    noise.connect(this.mechanicalFilter).connect(this.mechanicalGain).connect(output);
    overrun.connect(overrunFilter).connect(this.overrunGain).connect(output);

    // Mild cycle irregularity adds idle rumble without retriggering oscillator phase.
    const wobble = context.createOscillator();
    wobble.frequency.value = 6.1 + ((profile.seed >>> 0) % 13) / 10;
    this.wobbleDepth = this.gain(2 + 5 * this.irregularity);
    wobble.connect(this.wobbleDepth);
    this.wobbleDepth.connect(this.body.detune);
    this.wobbleDepth.connect(this.growl.detune);
    this.sources.push(this.body, this.growl, noise, overrun, wobble);
    for (const source of this.sources) source.start(start);
  }

  update(control: EngineAudioControl, time: number): void {
    if (this.disposed) return;
    const at = Number.isFinite(time) ? Math.max(0, time) : this.context.currentTime;
    const rpm = clampAudio(control.rpm, 250, 15000);
    const load = clampAudio(control.load);
    const drive = clampAudio(control.driveLoad);
    const overrun = clampAudio(control.overrun);
    const effort = 0.7 * load + 0.3 * drive;
    const firing = (rpm * this.cylinders) / 120;
    smoothParam(this.body.frequency, firing, at, 0.018);
    smoothParam(this.growl.frequency, firing, at, 0.018);
    smoothParam(this.bodyGain.gain, (0.027 + 0.018 * load) * this.bodyWeight, at, 0.025);
    // Only the load layer is cut. Pitch always follows actual RPM, including a flare.
    const shiftCut = control.shifting ? 0.32 : 1;
    smoothParam(
      this.growlGain.gain,
      (0.003 + 0.057 * effort) * shiftCut,
      at,
      control.shifting ? 0.012 : 0.075,
    );
    smoothParam(this.bodyFilter.frequency, 430 + firing * 3 + load * 250, at);
    smoothParam(
      this.growlFilter.frequency,
      clampAudio((800 + firing * 13 + effort * 2300) * this.brightness, 500, 8500),
      at,
      0.025,
    );
    smoothParam(this.mechanicalFilter.frequency, 650 + rpm * 0.13, at, 0.035);
    smoothParam(
      this.mechanicalGain.gain,
      0.003 + 0.01 * load * shiftCut + 0.002 * overrun,
      at,
      0.03,
    );
    smoothParam(this.overrunGain.gain, 0.007 * overrun, at, 0.045);
    smoothParam(this.wobbleDepth.gain, (2 + 5 * this.irregularity) / (1 + rpm / 1700), at);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    stopAndDisconnect(this.sources, this.nodes);
  }

  private gain(value: number): GainNode {
    const node = this.context.createGain();
    node.gain.value = value;
    this.nodes.push(node);
    return node;
  }

  private filter(type: BiquadFilterType, frequency: number): BiquadFilterNode {
    const node = this.context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    this.nodes.push(node);
    return node;
  }

  private wave(loaded: boolean, seed: number): PeriodicWave {
    const real = new Float32Array(49);
    const imaginary = new Float32Array(49);
    for (let harmonic = 1; harmonic < imaginary.length; harmonic++) {
      const decay = loaded ? 1.13 : 1.7;
      const amplitude = 1 / harmonic ** decay;
      // A small stable phase variation gives each seeded profile a pulse character.
      const phase = Math.sin(harmonic * 12.9898 + seed) * this.irregularity * 0.18;
      imaginary[harmonic] = amplitude * Math.cos(phase);
      real[harmonic] = amplitude * Math.sin(phase);
    }
    return this.context.createPeriodicWave(real, imaginary);
  }
}
