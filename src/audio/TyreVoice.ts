import type { WheelId } from "../vehicle/types";
import type { AudioSettings, TyreAudioControl } from "./types";
import { clampAudio, createNoise, smoothParam, stopAndDisconnect } from "./nodes";

const WHEEL_SEEDS: Record<WheelId, number> = {
  fl: 0x71d3b209,
  fr: 0x29a65d17,
  rl: 0x6234f901,
  rr: 0x4af18b65,
};

/** One mono wheel source; the caller supplies its tyre and surface spatial paths. */
export class TyreVoice {
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private readonly front: boolean;
  private readonly broadbandFilter: BiquadFilterNode;
  private readonly resonance: BiquadFilterNode;
  private readonly toneFilter: BiquadFilterNode;
  private readonly surfaceFilter: BiquadFilterNode;
  private readonly broadbandGain: GainNode;
  private readonly resonanceGain: GainNode;
  private readonly toneGain: GainNode;
  private readonly surfaceGain: GainNode;
  private readonly kerbGain: GainNode;
  private readonly roughDepth: GainNode;
  private readonly detuneDepth: GainNode;
  private readonly tone: OscillatorNode;
  private readonly pulse: OscillatorNode;
  private lastActivity = 0;
  private disposed = false;

  constructor(
    private readonly context: BaseAudioContext,
    id: WheelId,
    tyreOutput: AudioNode,
    surfaceOutput: AudioNode,
    startTime = context.currentTime,
  ) {
    const start = Math.max(context.currentTime, startTime);
    this.front = id[0] === "f";
    const noise = createNoise(context, WHEEL_SEEDS[id]);
    const surfaceNoise = createNoise(context, WHEEL_SEEDS[id] ^ 0x3a72681d);
    const highpass = this.filter("highpass", 180, 0.55);
    this.broadbandFilter = this.filter("lowpass", this.front ? 3900 : 2900, 0.55);
    this.resonance = this.filter("bandpass", this.front ? 1900 : 950, 0.8);
    this.broadbandGain = this.gain(0);
    this.resonanceGain = this.gain(0);
    noise.connect(highpass).connect(this.broadbandFilter).connect(this.broadbandGain).connect(tyreOutput);
    highpass.connect(this.resonance).connect(this.resonanceGain).connect(tyreOutput);

    this.tone = context.createOscillator();
    const real = new Float32Array(5);
    const imaginary = new Float32Array([0, 1, 0.14, 0.07, 0.025]);
    this.tone.setPeriodicWave(context.createPeriodicWave(real, imaginary));
    this.tone.frequency.value = this.front ? 1900 : 950;
    this.toneFilter = this.filter("lowpass", 4300, 0.55);
    const roughGain = this.gain(0.84);
    this.toneGain = this.gain(0);
    this.tone.connect(this.toneFilter).connect(roughGain).connect(this.toneGain).connect(tyreOutput);
    const rough = context.createOscillator();
    rough.type = "triangle";
    rough.frequency.value = 21 + (WHEEL_SEEDS[id] % 71) / 10;
    this.roughDepth = this.gain(this.front ? 0.025 : 0.13);
    this.detuneDepth = this.gain(this.front ? 4 : 12);
    rough.connect(this.roughDepth).connect(roughGain.gain);
    rough.connect(this.detuneDepth).connect(this.tone.detune);

    const surfaceHighpass = this.filter("highpass", 65, 0.55);
    this.surfaceFilter = this.filter("lowpass", 1900, 0.55);
    this.surfaceGain = this.gain(0);
    surfaceNoise.connect(surfaceHighpass).connect(this.surfaceFilter).connect(this.surfaceGain).connect(surfaceOutput);
    const kerbFilter = this.filter("lowpass", 190, 0.55);
    const kerbRoughGain = this.gain(0.7);
    this.kerbGain = this.gain(0);
    surfaceNoise.connect(kerbFilter).connect(kerbRoughGain).connect(this.kerbGain).connect(surfaceOutput);
    this.pulse = context.createOscillator();
    this.pulse.type = "triangle";
    this.pulse.frequency.value = 20;
    const pulseDepth = this.gain(0.25);
    this.pulse.connect(pulseDepth).connect(kerbRoughGain.gain);
    this.sources.push(noise, surfaceNoise, this.tone, rough, this.pulse);
    for (const source of this.sources) source.start(start);
  }

  update(control: TyreAudioControl, settings: AudioSettings, time: number): void {
    if (this.disposed) return;
    const at = Number.isFinite(time) ? Math.max(0, time) : this.context.currentTime;
    const speed = clampAudio(control.speed, 0, 150);
    const slipSpeed = clampAudio(control.slipSpeed, 0, 150);
    const contact = control.grounded && control.load > 0.001 && (speed > 0.2 || slipSpeed > 0.15);
    const warning = contact ? clampAudio(control.warning) : 0;
    const slip = contact ? clampAudio(control.slip) : 0;
    const rolling = contact ? clampAudio(control.rolling) : 0;
    // The adapter already load-weights these envelopes. Do not load-weight twice.
    const tarmac = clampAudio(control.tarmac);
    const loose = clampAudio(control.gravel + control.sand + control.grass);
    const material = 0.2 + 0.8 * tarmac;
    const cue = clampAudio(settings.axleCue);
    const axleFrequency = 1350 + cue * (this.front ? 550 : -400);
    const soft = settings.softSqueal;
    const activity = warning + slip + rolling;
    const envelope = !contact ? 0.004 : activity > this.lastActivity ? 0.014 : 0.105;
    this.lastActivity = activity;
    smoothParam(this.broadbandGain.gain, (0.014 * warning + 0.024 * slip) * material, at, envelope);
    smoothParam(this.resonanceGain.gain, (0.006 * warning + 0.008 * slip) * material, at, envelope);
    smoothParam(this.toneGain.gain, 0.014 * slip * material * (soft ? 0.55 : 1), at, envelope);
    smoothParam(this.resonance.frequency, axleFrequency, at, 0.035);
    // Severity changes level/roughness, keeping each axle in its learned region.
    smoothParam(this.tone.frequency, axleFrequency * (1 + 0.025 * slip), at, 0.035);
    const commonCutoff = soft ? 2800 : 3600;
    smoothParam(this.broadbandFilter.frequency, commonCutoff + cue * (this.front ? 450 : -550), at, 0.04);
    smoothParam(this.toneFilter.frequency, soft ? 2800 : 4500, at, 0.04);
    smoothParam(this.roughDepth.gain, 0.04 + cue * (this.front ? -0.015 : 0.09), at, 0.04);
    smoothParam(this.detuneDepth.gain, 5 + cue * (this.front ? -1 : 7), at, 0.04);

    const roughness = clampAudio(control.roughness);
    smoothParam(
      this.surfaceGain.gain,
      rolling * (0.004 + 0.012 * loose + 0.004 * roughness) + slip * loose * 0.01,
      at,
      envelope,
    );
    smoothParam(this.kerbGain.gain, rolling * clampAudio(control.kerb) * 0.025, at, contact ? 0.018 : 0.004);
    smoothParam(
      this.surfaceFilter.frequency,
      1300 + 1300 * loose + cue * (this.front ? 350 : -250),
      at,
      0.05,
    );
    smoothParam(this.pulse.frequency, clampAudio(speed * 2.6, 8, 100), at, 0.025);
  }

  /** Clear contact memory during pause/reset/audition changes, before live output returns. */
  reset(time = this.context.currentTime): void {
    if (this.disposed) return;
    this.lastActivity = 0;
    for (const gain of [this.broadbandGain, this.resonanceGain, this.toneGain, this.surfaceGain, this.kerbGain])
      smoothParam(gain.gain, 0, time, 0.002);
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

  private filter(type: BiquadFilterType, frequency: number, q: number): BiquadFilterNode {
    const node = this.context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    this.nodes.push(node);
    return node;
  }
}
