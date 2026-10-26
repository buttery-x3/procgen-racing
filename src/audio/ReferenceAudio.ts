import type { WheelId } from "../vehicle/types";
import type { AudioSettings, EngineAudioControl, EngineAudioProfile, TyreAudioControl } from "./types";
import type { AudioSourceFactory } from "./source-types";
import { ACCEPTED_ENGINE_TUNING, ACCEPTED_TYRE_TUNING, REFERENCE_MODEL_ID, TYRE_MODEL_URL } from "./reference-tuning";
import { SurfaceVoice, WHEEL_AUDIO_SEEDS } from "./SurfaceVoice";
import { clampAudio, smoothParam } from "./nodes";

const preparations = new WeakMap<BaseAudioContext, Promise<AudioSourceFactory>>();

/** Convert once-load-weighted collector levels into independent character and level inputs. */
export function referenceTyreControl(control: TyreAudioControl, settings: AudioSettings) {
  const load = clampAudio(control.load), slip = clampAudio(control.slip), warning = clampAudio(control.warning);
  return {
    ...control, load,
    slip: load > 0.001 ? clampAudio(slip / load) : 0,
    warning: load > 0.001 ? clampAudio(warning / load) : 0,
    level: clampAudio(0.88 * slip + 0.12 * warning),
    rearPitch: 1 - 0.075 * clampAudio(settings.axleCue),
    // Production surfaces have their own existing bus; do not mix prototype road noise.
    rolling: 0,
  };
}

class EngineSource {
  private readonly node: AudioWorkletNode;
  private disposed = false;
  constructor(context: BaseAudioContext, output: AudioNode, profile: EngineAudioProfile, onError: (error: Error) => void) {
    this.node = new AudioWorkletNode(context, "playground-pulse-exhaust", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    this.node.onprocessorerror = () => onError(new Error("Engine sound processor stopped. Toggle sound to retry."));
    this.node.port.postMessage({ type: "reset", seed: profile.seed });
    // Preserve the accepted base for every car until vehicle-family tuning is heard.
    this.node.port.postMessage({ type: "tuning", value: ACCEPTED_ENGINE_TUNING });
    this.node.connect(output);
  }
  update(control: EngineAudioControl) {
    if (!this.disposed) this.node.port.postMessage({ type: "control", value: control });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.node.onprocessorerror = null;
    this.node.port.postMessage({ type: "dispose" }); this.node.port.close(); this.node.disconnect();
  }
}

class WheelSource {
  readonly ready: Promise<void>;
  private readonly node: AudioWorkletNode;
  private readonly surface: SurfaceVoice;
  private readonly filter: BiquadFilterNode;
  private readonly material: GainNode;
  private cancelReady?: () => void;
  private disposed = false;
  constructor(private readonly context: BaseAudioContext, private readonly id: WheelId, tyre: AudioNode, surface: AudioNode, model: unknown, onError: (error: Error) => void) {
    this.node = new AudioWorkletNode(context, "playground-reference-tyre", {
      numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [1, 1],
      processorOptions: { sleepWhenQuiet: true, reportState: false },
    });
    this.filter = context.createBiquadFilter(); this.filter.type = "lowpass"; this.filter.Q.value = 0.55;
    this.filter.frequency.value = Math.min(20000, context.sampleRate * 0.45);
    this.material = context.createGain();
    this.node.connect(this.filter, 0); this.filter.connect(this.material).connect(tyre);
    this.surface = new SurfaceVoice(context, id, surface);
    this.ready = new Promise<void>((resolve, reject) => {
      // A muted/suspended audio thread may not acknowledge its profile yet.
      const check = () => {
        if (context.state === "running") finish(new Error("Tyre sound profile did not initialize."));
        else timeout = setTimeout(check, 8000);
      };
      let timeout = setTimeout(check, 8000);
      const finish = (error?: Error) => { clearTimeout(timeout); this.cancelReady = undefined; error ? reject(error) : resolve(); };
      this.cancelReady = () => finish();
      this.node.port.onmessage = ({ data }) => {
        if (data?.type === "profile-ready") finish();
        else if (data?.type === "profile-error") finish(new Error(String(data.message)));
      };
      this.node.onprocessorerror = () => {
        const error = new Error(`Tyre sound processor ${id.toUpperCase()} stopped. Toggle sound to retry.`);
        finish(error); onError(error);
      };
    });
    this.node.port.postMessage({ type: "profile", value: model });
    this.node.port.postMessage({ type: "reset", seed: WHEEL_AUDIO_SEEDS[id] });
    this.node.port.postMessage({ type: "tuning", value: ACCEPTED_TYRE_TUNING });
  }
  update(control: TyreAudioControl, settings: AudioSettings, time: number) {
    if (this.disposed) return;
    this.node.port.postMessage({ type: "control", value: referenceTyreControl(control, settings) });
    smoothParam(this.material.gain, (0.2 + 0.8 * clampAudio(control.tarmac)) * (settings.softSqueal ? 0.7 : 1), time, 0.02);
    smoothParam(this.filter.frequency, settings.softSqueal ? 2800 : Math.min(20000, this.context.sampleRate * 0.45), time, 0.04);
    this.surface.update(control, settings, time);
  }
  reset(time: number) {
    if (this.disposed) return;
    this.node.port.postMessage({ type: "control", value: {} });
    this.node.port.postMessage({ type: "reset", seed: WHEEL_AUDIO_SEEDS[this.id] });
    this.surface.reset(time);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelReady?.();
    this.node.onprocessorerror = null; this.node.port.onmessage = null;
    this.node.port.postMessage({ type: "dispose" }); this.node.port.close(); this.node.disconnect();
    this.surface.dispose(); this.filter.disconnect(); this.material.disconnect();
  }
}

/** One preparation per context, shared by setup replacements. No PCM recordings are loaded. */
export function loadDrivingAudio(context: BaseAudioContext): Promise<AudioSourceFactory> {
  const existing = preparations.get(context);
  if (existing) return existing;
  const preparation = Promise.resolve().then(async () => {
    if (!context.audioWorklet) throw new Error("This browser does not support the driving sound processors.");
    const [, , model] = await Promise.all([
      context.audioWorklet.addModule("/audio/playground-voices.js"),
      context.audioWorklet.addModule("/audio/reference-tyre.js"),
      fetch(TYRE_MODEL_URL, { signal: AbortSignal.timeout(8000) }).then(async (response) => {
        if (!response.ok) throw new Error("Tyre sound profile unavailable. Reload to retry.");
        const value = await response.json() as { id?: unknown };
        if (value.id !== REFERENCE_MODEL_ID) throw new Error("The driving tyre sound profile does not match the accepted reference.");
        return value;
      }),
    ]);
    return {
      engine: (output: AudioNode, profile: EngineAudioProfile, onError: (error: Error) => void) => new EngineSource(context, output, profile, onError),
      wheel: (id: WheelId, tyre: AudioNode, surface: AudioNode, onError: (error: Error) => void) => new WheelSource(context, id, tyre, surface, model, onError),
    };
  });
  preparations.set(context, preparation);
  void preparation.catch(() => { if (preparations.get(context) === preparation) preparations.delete(context); });
  return preparation;
}
