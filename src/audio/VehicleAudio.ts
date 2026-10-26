import type { VehicleSetup, VehicleTelemetry, WheelId } from "../vehicle/types";
import { DEFAULT_SETUP } from "../vehicle/setup";
import { AudioControlCollector } from "./AudioControls";
import { engineAudioProfile } from "./profiles";
import { VehicleAudioGraph } from "./VehicleAudioGraph";
import { loadDrivingAudio } from "./ReferenceAudio";
import { REFERENCE_MODEL_ID } from "./reference-tuning";
import { loadAudioSettings, normalizeAudioSettings } from "./settings";
import { auditionFrame } from "./audition";
import type { AudioSettings, EngineAudioProfile } from "./types";

/** Desired sound state is enabled by default; output unlock follows a trusted gesture. */
export class VehicleAudio {
  settings: AudioSettings;
  onStatus?: () => void;
  private context?: AudioContext;
  private graph?: VehicleAudioGraph;
  private profile: EngineAudioProfile = engineAudioProfile(DEFAULT_SETUP);
  private collector = new AudioControlCollector();
  private retired: { graph: VehicleAudioGraph; timer: ReturnType<typeof setTimeout> }[] = [];
  private error = "";
  private disposed = false;
  private attached = false;
  private auditionUntil = 0;
  private quietUntil = 0;
  private audition?: WheelId;
  private samples = new Float32Array(2048);
  private sampleCount = 0;
  private frames = 0;
  private captureMs = 0;
  private resumeRevision = 0;
  private suspendPending = 0;
  private suspendTimer?: ReturnType<typeof setTimeout>;

  constructor(settings: AudioSettings = loadAudioSettings()) {
    this.settings = normalizeAudioSettings(settings);
  }
  get enabled() { return this.settings.enabled; }
  get state() {
    if (!this.enabled) return "muted";
    if (this.error) return "unavailable";
    if (this.graph?.isReady === false) return "loading";
    return this.context?.state === "running" ? "running" : "ready";
  }
  attach() {
    if (this.attached || this.disposed) return;
    this.attached = true;
    window.addEventListener("pointerdown", this.gesture, { capture: true });
    window.addEventListener("keydown", this.gesture, { capture: true });
  }
  private gesture = (event: Event) => {
    if (event.isTrusted && this.enabled) this.unlock();
  };
  private suspend(context: AudioContext) {
    if (context.state === "closed") return;
    this.suspendPending++;
    void context.suspend().catch(() => {}).finally(() => {
      if (context === this.context) this.suspendPending--;
    });
  }
  private scheduleSuspend(context: AudioContext) {
    if (this.suspendTimer !== undefined) clearTimeout(this.suspendTimer);
    // Let the native fade finish before freezing its audio clock.
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = undefined;
      if (!this.disposed && !this.enabled && context === this.context) this.suspend(context);
    }, 50);
  }
  private fail(error: unknown) {
    this.resumeRevision++;
    this.error = error instanceof Error ? error.message : "Audio output unavailable";
    this.releaseGraph();
    this.onStatus?.();
  }
  private releaseGraph() {
    if (this.suspendTimer !== undefined) clearTimeout(this.suspendTimer);
    this.suspendTimer = undefined;
    this.suspendPending = 0;
    // A replacement context starts its clock at zero.
    this.quietUntil = 0;
    this.auditionUntil = 0;
    this.audition = undefined;
    this.collector.reset();
    this.captureMs = 0;
    for (const item of this.retired) { clearTimeout(item.timer); item.graph.dispose(); }
    this.retired = [];
    this.graph?.dispose();
    this.graph = undefined;
    if (this.context) {
      this.context.onstatechange = null;
      if (this.context.state !== "closed") void this.context.close().catch(() => {});
    }
    this.context = undefined;
  }
  private createGraph(context: AudioContext, startTime = context.currentTime) {
    const graph = new VehicleAudioGraph(context, context.destination, this.settings, this.profile, startTime, loadDrivingAudio(context));
    const failCurrent = (error: unknown) => {
      if (!this.disposed && this.context === context && this.graph === graph) this.fail(error);
    };
    graph.onError = failCurrent;
    void graph.ready?.then(() => {
      if (this.disposed || this.graph !== graph || context !== this.context) return;
      this.collector.reset();
      if (this.audition) this.auditionUntil = context.currentTime + 1.44;
      this.onStatus?.();
    }, failCurrent);
    return graph;
  }
  unlock() {
    if (this.disposed || !this.enabled) return;
    if (this.suspendTimer !== undefined) clearTimeout(this.suspendTimer);
    this.suspendTimer = undefined;
    try {
      let created = false;
      if (this.context?.state === "closed") this.releaseGraph();
      if (!this.context) {
        this.context = new AudioContext({ latencyHint: "interactive" });
        created = true;
        this.context.onstatechange = () => this.onStatus?.();
        this.graph = this.createGraph(this.context);
      }
      if (this.context.state === "running" && this.suspendPending === 0 && !this.error) {
        if (created) this.onStatus?.();
        return;
      }
      this.error = "";
      const context = this.context, revision = ++this.resumeRevision;
      // If the device/browser interrupted a fade, zero the gate before its clock
      // resumes. Fresh telemetry opens it later, never an old engine state.
      if (context.state !== "running" || this.suspendPending > 0) this.graph?.prepareResume();
      // Invoke in the gesture stack, including when an earlier suspend is pending.
      // A pending resume never prevents the next trusted gesture from retrying.
      void context.resume().then(() => {
        if (this.disposed || context !== this.context) return;
        if (!this.enabled) {
          this.graph?.silence();
          this.scheduleSuspend(context);
        } else if (revision === this.resumeRevision) {
          this.error = "";
          this.onStatus?.();
        }
      }).catch((error: unknown) => {
        if (this.disposed || context !== this.context || revision !== this.resumeRevision || !this.enabled) return;
        this.error = error instanceof Error ? error.message : "Audio output unavailable";
        this.onStatus?.();
      });
      this.onStatus?.();
    } catch (error) { this.fail(error); }
  }
  configure(settings: AudioSettings) {
    if (this.disposed) return;
    const wasEnabled = this.enabled;
    this.settings = normalizeAudioSettings(settings);
    this.stopAudition();
    this.graph?.configure(this.settings);
    if (!this.enabled) {
      this.resumeRevision++;
      this.silence();
      // Also request suspension while resume is pending; its eventual completion
      // checks desired state again, covering browsers that resolve suspend early.
      if (this.context) this.scheduleSuspend(this.context);
    } else if (!wasEnabled) this.unlock();
    this.onStatus?.();
  }
  setSetup(setup: VehicleSetup) {
    if (this.disposed) return;
    const next = engineAudioProfile(setup);
    const changed = JSON.stringify(next) !== JSON.stringify(this.profile);
    this.profile = next;
    this.silence();
    if (changed && this.context && this.graph) {
      try {
        const old = this.graph, time = this.context.currentTime;
        const replacement = this.createGraph(this.context, time + 0.025);
        this.graph = replacement;
        old.silence(time);
        const retired = { graph: old, timer: setTimeout(() => {
          old.dispose();
          this.retired = this.retired.filter((item) => item !== retired);
        }, 70) };
        this.retired.push(retired);
        if (this.retired.length > 2) {
          const first = this.retired.shift()!;
          clearTimeout(first.timer); first.graph.dispose();
        }
      } catch (error) { this.fail(error); }
    }
  }
  capture(t: VehicleTelemetry, setup: VehicleSetup) {
    if (!this.enabled || this.disposed) return;
    const start = performance.now();
    this.collector.capture(t, setup);
    this.captureMs += performance.now() - start;
  }
  update(paused: boolean) {
    if (this.disposed) return;
    const start = performance.now();
    const now = this.context?.currentTime ?? 0;
    if (this.audition && this.graph?.isReady !== false && now >= this.auditionUntil) this.stopAudition();
    if (this.context && now < this.quietUntil) {
      this.graph?.silence();
      if (paused) this.collector.reset();
    } else if (this.enabled && this.graph && this.context?.state === "running" && this.audition) {
      this.graph.update(auditionFrame([this.audition], this.context.currentTime));
      this.collector.reset();
    } else {
      if (!this.enabled || paused) {
        this.collector.reset();
        this.graph?.silence();
      } else {
        const frame = this.collector.flush();
        if (frame) this.graph?.update(frame);
      }
    }
    this.samples[this.sampleCount++ % this.samples.length] = this.captureMs + performance.now() - start;
    this.captureMs = 0;
    this.frames++;
  }
  demo(id: WheelId, strict = false) {
    if (!this.enabled || this.settings.master === 0 || this.settings.tyres === 0) return false;
    this.unlock();
    if (!this.context || !this.graph) return false;
    this.silence();
    this.audition = id;
    this.auditionUntil = this.context.currentTime + 1.44;
    this.graph.configure({ ...this.settings, engine: 0, surface: 0, ...(strict ? { output: "stereo" as const, width: 1 } : {}) });
    return true;
  }
  stopAudition() {
    if (!this.audition) return;
    this.audition = undefined;
    this.auditionUntil = 0;
    this.quietUntil = (this.context?.currentTime ?? 0) + 0.04;
    this.graph?.silence();
    this.graph?.configure(this.settings);
    this.collector.reset();
  }
  silence() {
    this.stopAudition();
    this.collector.reset();
    this.captureMs = 0;
    this.quietUntil = (this.context?.currentTime ?? 0) + 0.04;
    if (this.context && this.context.state !== "running") this.graph?.prepareResume();
    else this.graph?.silence();
  }
  diagnostics() {
    const recent = Array.from(this.samples.slice(0, Math.min(this.sampleCount, this.samples.length))).sort((a, b) => a - b);
    return {
      enabled: this.enabled, state: this.state, contextState: this.context?.state ?? "not-created",
      error: this.error || null, profile: this.profile.id, output: this.settings.output,
      sourceBackend: "pulse-exhaust-reference-v3", sourceReady: this.graph?.isReady ?? false, tyreModelId: REFERENCE_MODEL_ID,
      liveGraphs: this.graph ? 1 : 0, retiringGraphs: this.retired.length, updates: this.frames,
      controlP95Ms: recent.length ? recent[Math.floor((recent.length - 1) * 0.95)] : 0,
      controlTimingScope: "All captures plus graph publication per animation frame; excludes browser audio rendering",
      sampleRate: this.context?.sampleRate ?? null, baseLatencySeconds: this.context?.baseLatency ?? null,
      outputLatencySeconds: this.context && "outputLatency" in this.context ? this.context.outputLatency : null,
    };
  }
  /** Opt-in native PCM observation for the driving diagnostic; never used by normal play. */
  signalDiagnostics() {
    try {
      return { ...this.diagnostics(), settings: { ...this.settings }, signal: this.graph?.sampleSignals() ?? null, meterError: null as string | null };
    } catch (error) {
      return { ...this.diagnostics(), settings: { ...this.settings }, signal: null, meterError: error instanceof Error ? error.message : String(error) };
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resumeRevision++;
    this.onStatus = undefined;
    window.removeEventListener("pointerdown", this.gesture, { capture: true });
    window.removeEventListener("keydown", this.gesture, { capture: true });
    this.attached = false;
    this.collector.reset();
    this.releaseGraph();
  }
}
