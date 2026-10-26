import type { WheelId } from "../vehicle/types";
import type { AudioSettings, TyreAudioControl } from "./types";
import { clampAudio, createNoise, smoothParam, stopAndDisconnect } from "./nodes";

export const WHEEL_AUDIO_SEEDS: Record<WheelId, number> = {
  fl: 0x71d3b209, fr: 0x29a65d17, rl: 0x6234f901, rr: 0x4af18b65,
};

/** The established rolling/loose-material/kerb branch, independent of squeal timbre. */
export class SurfaceVoice {
  private readonly noise: AudioBufferSourceNode;
  private readonly pulse: OscillatorNode;
  private readonly filter: BiquadFilterNode;
  private readonly level: GainNode;
  private readonly kerb: GainNode;
  private readonly nodes: AudioNode[];
  private lastActivity = 0;
  private disposed = false;
  constructor(context: BaseAudioContext, private readonly id: WheelId, output: AudioNode) {
    this.noise = createNoise(context, WHEEL_AUDIO_SEEDS[id] ^ 0x3a72681d);
    const highpass = context.createBiquadFilter(); highpass.type = "highpass"; highpass.frequency.value = 65; highpass.Q.value = 0.55;
    this.filter = context.createBiquadFilter(); this.filter.type = "lowpass"; this.filter.frequency.value = 1900; this.filter.Q.value = 0.55;
    this.level = context.createGain(); this.level.gain.value = 0;
    this.noise.connect(highpass).connect(this.filter).connect(this.level).connect(output);
    const kerbFilter = context.createBiquadFilter(); kerbFilter.type = "lowpass"; kerbFilter.frequency.value = 190; kerbFilter.Q.value = 0.55;
    const rough = context.createGain(); rough.gain.value = 0.7;
    this.kerb = context.createGain(); this.kerb.gain.value = 0;
    this.noise.connect(kerbFilter).connect(rough).connect(this.kerb).connect(output);
    this.pulse = context.createOscillator(); this.pulse.type = "triangle"; this.pulse.frequency.value = 20;
    const depth = context.createGain(); depth.gain.value = 0.25;
    this.pulse.connect(depth).connect(rough.gain);
    this.nodes = [highpass, this.filter, this.level, kerbFilter, rough, this.kerb, depth];
    this.noise.start(); this.pulse.start();
  }
  update(control: TyreAudioControl, settings: AudioSettings, time: number) {
    if (this.disposed) return;
    const speed = clampAudio(control.speed, 0, 150), slipSpeed = clampAudio(control.slipSpeed, 0, 150);
    const contact = control.grounded && control.load > 0.001 && (speed > 0.2 || slipSpeed > 0.15);
    const warning = contact ? clampAudio(control.warning) : 0, slip = contact ? clampAudio(control.slip) : 0;
    const rolling = contact ? clampAudio(control.rolling) : 0, loose = clampAudio(control.gravel + control.sand + control.grass);
    const activity = warning + slip + rolling;
    const envelope = !contact ? 0.004 : activity > this.lastActivity ? 0.014 : 0.105;
    this.lastActivity = activity;
    smoothParam(this.level.gain, rolling * (0.004 + 0.012 * loose + 0.004 * clampAudio(control.roughness)) + slip * loose * 0.01, time, envelope);
    smoothParam(this.kerb.gain, rolling * clampAudio(control.kerb) * 0.025, time, contact ? 0.018 : 0.004);
    smoothParam(this.filter.frequency, 1300 + 1300 * loose + clampAudio(settings.axleCue) * (this.id[0] === "f" ? 350 : -250), time, 0.05);
    smoothParam(this.pulse.frequency, clampAudio(speed * 2.6, 8, 100), time, 0.025);
  }
  reset(time: number) {
    if (this.disposed) return;
    this.lastActivity = 0;
    smoothParam(this.level.gain, 0, time, 0.002); smoothParam(this.kerb.gain, 0, time, 0.002);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    stopAndDisconnect([this.noise, this.pulse], this.nodes);
  }
}
