import type { VehicleTelemetry } from "../vehicle/types";
import { drivingFeedback } from "./feedback";

/** Optional synthesized contact feedback. No files, microphone or network are
 * used; the AudioContext starts only from the user's sound button. */
export class SurfaceAudio {
  enabled = false;
  volume = 0.6;
  private context?: AudioContext;
  private noise?: AudioBufferSourceNode;
  private rumble?: OscillatorNode;
  private noiseGain?: GainNode;
  private rumbleGain?: GainNode;
  private filter?: BiquadFilterNode;
  private engine?: OscillatorNode;
  private engineGain?: GainNode;
  private squeal?: OscillatorNode;
  private squealGain?: GainNode;
  private engineFilter?: BiquadFilterNode;
  private previous?: VehicleTelemetry;
  async toggle() {
    if (!this.context) {
      const context = new AudioContext();
      this.context = context;
      const buffer = context.createBuffer(
          1,
          context.sampleRate,
          context.sampleRate,
        ),
        data = buffer.getChannelData(0);
      let seed = 19477;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = seed / 2147483648 - 1;
      }
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 600;
      filter.Q.value = 0.5;
      const noiseGain = context.createGain();
      noiseGain.gain.value = 0;
      noise.connect(filter).connect(noiseGain).connect(context.destination);
      noise.start();
      const rumble = context.createOscillator();
      rumble.type = "triangle";
      rumble.frequency.value = 40;
      const rumbleGain = context.createGain();
      rumbleGain.gain.value = 0;
      rumble.connect(rumbleGain).connect(context.destination);
      rumble.start();
      this.noise = noise;
      this.rumble = rumble;
      this.noiseGain = noiseGain;
      this.rumbleGain = rumbleGain;
      this.filter = filter;
      const engine = context.createOscillator(),
        engineGain = context.createGain(),
        engineFilter = context.createBiquadFilter();
      engine.type = "sawtooth";
      engine.frequency.value = 35;
      engineFilter.type = "lowpass";
      engineFilter.frequency.value = 700;
      engineGain.gain.value = 0;
      engine
        .connect(engineFilter)
        .connect(engineGain)
        .connect(context.destination);
      engine.start();
      const squeal = context.createOscillator(),
        squealGain = context.createGain();
      squeal.type = "sine";
      squeal.frequency.value = 780;
      squealGain.gain.value = 0;
      squeal.connect(squealGain).connect(context.destination);
      squeal.start();
      this.engine = engine;
      this.engineGain = engineGain;
      this.engineFilter = engineFilter;
      this.squeal = squeal;
      this.squealGain = squealGain;
    }
    const next = !this.enabled;
    if (next) await this.context.resume();
    else this.silence();
    this.enabled = next;
    return this.enabled;
  }
  update(telemetry: VehicleTelemetry, paused: boolean) {
    const feedback = drivingFeedback(telemetry, this.previous);
    this.previous = telemetry;
    if (!this.context || !this.enabled || paused) {
      this.silence();
      return;
    }
    let kerb = 0,
      gravel = 0,
      sand = 0,
      grass = 0,
      contact = 0,
      roughness = 0;
    for (const wheel of telemetry.wheels)
      if (wheel.grounded) {
        contact += 0.25;
        roughness += (wheel.surfaceRoughness ?? 0) * 0.25;
        for (const s of wheel.surfaceBlend ?? [
          { surface: wheel.surface, weight: 1 },
        ]) {
          const value = s.weight * 0.25;
          if (s.surface === "kerb") kerb += value;
          if (s.surface === "gravel") gravel += value;
          if (s.surface === "sand") sand += value;
          if (s.surface === "grass") grass += value;
        }
      }
    const speed = Math.min(1, telemetry.speed / 22),
      time = this.context.currentTime;
    this.noiseGain!.gain.setTargetAtTime(
      this.volume *
        speed *
        (contact * 0.005 +
          gravel * 0.075 +
          sand * 0.045 +
          grass * 0.025 +
          kerb * 0.035 +
          roughness * 0.01) +
        this.volume * feedback.impact * 0.13,
      time,
      0.06,
    );
    this.rumbleGain!.gain.setTargetAtTime(
      this.volume * (speed * kerb * 0.055 + feedback.impact * 0.05),
      time,
      0.045,
    );
    this.engine!.frequency.setTargetAtTime(
      feedback.engineFrequency,
      time,
      0.035,
    );
    this.engineGain!.gain.setTargetAtTime(
      this.volume * 0.025 * feedback.engineLoad,
      time,
      0.04,
    );
    this.engineFilter!.frequency.setTargetAtTime(
      450 + feedback.engineLoad * 900 + telemetry.powertrain.rpm * 0.08,
      time,
      0.08,
    );
    this.squeal!.frequency.setTargetAtTime(
      650 + feedback.scrub * 350,
      time,
      0.08,
    );
    this.squealGain!.gain.setTargetAtTime(
      this.volume * feedback.scrub * 0.025,
      time,
      0.055,
    );
    this.rumble!.frequency.setTargetAtTime(
      Math.max(22, telemetry.speed * 4.5),
      time,
      0.07,
    );
    this.filter!.frequency.setTargetAtTime(
      sand > gravel ? 360 : gravel > 0 ? 1100 : 650,
      time,
      0.1,
    );
  }
  silence() {
    if (this.context) {
      const t = this.context.currentTime;
      this.noiseGain?.gain.setTargetAtTime(0, t, 0.04);
      this.rumbleGain?.gain.setTargetAtTime(0, t, 0.04);
      this.engineGain?.gain.setTargetAtTime(0, t, 0.04);
      this.squealGain?.gain.setTargetAtTime(0, t, 0.04);
    }
  }
  dispose() {
    this.noise?.stop();
    this.rumble?.stop();
    this.engine?.stop();
    this.squeal?.stop();
    if (this.context && this.context.state !== "closed")
      void this.context.close();
    this.context = undefined;
    this.noise = undefined;
    this.rumble = undefined;
    this.engine = undefined;
    this.squeal = undefined;
    this.engineGain = undefined;
    this.squealGain = undefined;
    this.engineFilter = undefined;
    this.previous = undefined;
    this.enabled = false;
  }
}
