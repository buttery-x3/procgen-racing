import { VehicleAudioGraph } from "../audio/VehicleAudioGraph";
import { VehicleAudio } from "../audio/VehicleAudio";
import { auditionFrame } from "../audio/audition";
import { deriveAudioControls } from "../audio/AudioControls";
import { DEFAULT_AUDIO_SETTINGS, normalizeAudioSettings } from "../audio/settings";
import { engineAudioProfile } from "../audio/profiles";
import type { AudioControlFrame, AudioSettings } from "../audio/types";
import { DEFAULT_SETUP } from "../vehicle/setup";
import { FIXED_STEP, WHEEL_IDS } from "../vehicle/types";
import type { WheelId } from "../vehicle/types";
import { initializePhysics, SuspensionRig } from "../physics/SuspensionRig";
import { SceneView } from "../rendering/SceneView";
import { DEFAULT_PRESENTATION } from "../rendering/settings";
import { getTestCircuit } from "../track/testCircuit";
import { referenceControls } from "./ReferenceDriver";
import { createAudioReport, runAudioQualification } from "./audioQualification";
import type { AudioQualificationReport } from "./audioQualification";

declare const __AUDIO_VERSION__: string;

/** Fixed storage, all samples counted; 0.1 ms histogram resolution up to 500 ms. */
class TimingMetric {
  private readonly buckets = new Uint32Array(5001);
  private count = 0;
  private total = 0;
  private maximum = 0;
  record(value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    this.count++; this.total += value; this.maximum = Math.max(this.maximum, value);
    this.buckets[Math.min(5000, Math.floor(value * 10))]++;
  }
  result() {
    let seen = 0, p95 = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      seen += this.buckets[i];
      if (seen >= Math.ceil(this.count * 0.95)) { p95 = i / 10; break; }
    }
    return { samples: this.count, meanMs: this.count ? this.total / this.count : 0, p95Ms: p95, maxMs: this.maximum, histogramResolutionMs: 0.1 };
  }
}

interface StressState {
  target: number;
  start: number;
  last: number;
  accumulator: number;
  lastStatus: number;
  lastReport: number;
  frames: number;
  steps: number;
  droppedSimulationSeconds: number;
  finite: boolean;
  maxPeak: number;
  analyserFrames: number;
  analyserSamples: number;
  silentFrames: number;
  contextNotRunningFrames: number;
  audioOnSeconds: number;
  hiddenMs: number;
  hiddenStarted: number | null;
  visibilityEvents: { elapsedSeconds: number; state: DocumentVisibilityState }[];
  heapStart: number | null;
  heapMax: number | null;
  frame: TimingMetric;
  audio: TimingMetric;
  capture: TimingMetric;
  controls: TimingMetric;
  off: TimingMetric;
  on: TimingMetric;
  rig: SuspensionRig;
  view: SceneView;
  settings: AudioSettings;
  resolve: (report: AudioQualificationReport) => void;
}

type MemoryPerformance = Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } };
const heap = () => (performance as MemoryPerformance).memory?.usedJSHeapSize ?? null;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class AudioLab {
  private context?: AudioContext;
  private graph?: VehicleAudioGraph;
  private analyser?: AnalyserNode;
  private readonly pcm = new Float32Array(2048);
  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private audition?: { ids: WheelId[]; start: number; end: number; engine: boolean; ramp: boolean };
  private operation?: AbortController;
  private smokeRuntime?: VehicleAudio;
  private frameId = 0;
  private stressState?: StressState;
  private listening?: { order: WheelId[]; index: number; waiting: boolean; matrix: number[][]; output: AudioSettings["output"]; masked: boolean };
  report = createAudioReport(__AUDIO_VERSION__);

  constructor() {
    this.node("audio-source").textContent = `SOURCE ${__AUDIO_VERSION__}`;
    this.node("report-source").textContent = `Audio fingerprint: ${__AUDIO_VERSION__}`;
    this.node("lab-enable").addEventListener("click", () => this.guard(() => this.begin()));
    this.node("lab-stop").addEventListener("click", () => { this.stop(); this.status("Stopped. Live output is silent."); });
    this.node("lab-run").addEventListener("click", () => this.guard(() => this.run()));
    this.node("lab-runtime").addEventListener("click", () => this.guard(() => this.runtimeSmoke()));
    this.node("lab-engine").addEventListener("click", () => this.guard(() => this.play([], true, true)));
    this.node("lab-stress").addEventListener("click", () => this.guard(() => this.stress()));
    this.node("lab-download").addEventListener("click", () => this.download());
    this.node("lab-copy").addEventListener("click", () => this.guard(async () => {
      await navigator.clipboard.writeText(JSON.stringify(this.report, null, 2));
      this.status("Evidence report copied.");
    }));
    this.node("listen-start").addEventListener("click", () => this.startListening());
    this.node("listen-play").addEventListener("click", () => this.guard(() => this.playListening()));
    document.querySelectorAll<HTMLElement>("[data-wheels]").forEach((button) => button.addEventListener("click", () => this.guard(() => this.play(button.dataset.wheels!.split(",") as WheelId[]))));
    document.querySelectorAll<HTMLElement>("[data-channel]").forEach((button) => button.addEventListener("click", () => this.guard(() => this.play([button.dataset.channel as WheelId], false, false, true))));
    document.querySelectorAll<HTMLElement>("[data-answer]").forEach((button) => button.addEventListener("click", () => this.answer(button.dataset.answer as WheelId)));
    for (const id of ["lab-output", "lab-master", "lab-engine-mask"])
      this.node(id).addEventListener(id === "lab-master" ? "input" : "change", () => this.configure());
    document.addEventListener("visibilitychange", this.visibility);
    window.addEventListener("pagehide", () => this.dispose(), { once: true });
    this.publish();
    this.frameId = requestAnimationFrame(this.tick);
  }

  private node<T extends HTMLElement = HTMLElement>(id: string) { return document.getElementById(id)! as T; }
  private status(message: string) { this.node("lab-status").textContent = message; }
  private guard(action: () => unknown | Promise<unknown>) {
    try { Promise.resolve(action()).catch((error: unknown) => this.status(error instanceof Error ? error.message : String(error))); }
    catch (error) { this.status(error instanceof Error ? error.message : String(error)); }
  }

  private async begin() {
    await this.ensureContext();
    this.status(`Live audio ready · ${this.context!.sampleRate.toLocaleString()} Hz · ${this.settings.output}. Choose a wheel or the engine ramp.`);
  }

  private async ensureContext() {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = this.pcm.length;
      this.analyser.connect(this.context.destination);
    }
    if (this.context.state !== "running") await this.context.resume();
    if (this.context.state !== "running") throw new Error("Select Begin live audio to enable this browser's audio output.");
  }

  private createGraph(settings = this.settings) {
    if (!this.context || !this.analyser) throw new Error("Begin live audio first.");
    this.graph?.dispose();
    this.graph = new VehicleAudioGraph(this.context, this.analyser, settings, engineAudioProfile(DEFAULT_SETUP));
  }

  private configure() {
    if (this.stressState) { this.status("Stress settings are frozen until this run finishes."); return; }
    this.settings = normalizeAudioSettings({ ...this.settings,
      master: this.node<HTMLInputElement>("lab-master").valueAsNumber / 100,
      output: this.node<HTMLSelectElement>("lab-output").value,
    });
    this.node("lab-master-value").textContent = `${Math.round(this.settings.master * 100)}%`;
    if (this.audition) this.graph?.configure({ ...this.settings, surface: 0, engine: this.audition.engine ? this.settings.engine : 0 });
    const test = this.listening;
    if (test && test.index < 32 && (test.output !== this.settings.output || test.masked !== this.node<HTMLInputElement>("lab-engine-mask").checked)) {
      test.waiting = false; this.answersEnabled(false);
      this.node<HTMLButtonElement>("listen-play").disabled = true;
      this.node("listen-status").textContent = "Listening conditions changed. Restart the 32-trial check to keep the conditions consistent; earlier recorded responses remain in the report.";
    }
  }

  private async play(ids: WheelId[], engine = false, ramp = false, channel = false) {
    if (this.stressState) throw new Error("Stop the stress run before starting an audition.");
    await this.ensureContext();
    const masked = engine || (!channel && this.node<HTMLInputElement>("lab-engine-mask").checked);
    this.createGraph({ ...this.settings, surface: 0, engine: masked ? this.settings.engine : 0,
      ...(channel ? { output: "stereo" as const, width: 1 } : {}),
    });
    const now = this.context!.currentTime;
    this.audition = { ids, start: now, end: now + (ramp ? 60 : 1.6), engine: masked, ramp };
    this.status(ramp ? "Engine ramp: idle → power → shift interruption → lower RPM. Stop / silence ends it." : `Audition · ${ids.map((id) => id.toUpperCase()).join(" + ")}${channel ? " · isolated stereo channel" : ""}${masked ? " · engine included" : " · tyres only"}`);
  }

  private tick = (wallTime: number) => {
    try {
      if (this.stressState) this.stressFrame(wallTime);
      else if (this.context && this.graph && this.audition) {
        const time = this.context.currentTime;
        if (document.hidden || time >= this.audition.end) { this.graph.silence(); this.audition = undefined; }
        else {
          const frame = auditionFrame(this.audition.ids, time, this.audition.engine);
          if (this.audition.ramp) {
            const cycle = (time - this.audition.start) % 8;
            frame.engine = {
              rpm: cycle < 4 ? 1000 + cycle * 1500 : 4100 + (cycle - 4) * 650,
              load: cycle < 0.6 ? 0.1 : 0.9, driveLoad: cycle < 0.6 ? 0 : 0.85,
              shifting: cycle >= 4 && cycle < 4.22, gear: cycle < 4 ? 2 : 3,
              overrun: cycle > 7.5 ? 0.65 : 0,
            };
          }
          this.graph.update(frame);
        }
      }
    } catch (error) {
      this.status(error instanceof Error ? error.message : String(error));
      if (this.stressState) { this.stressState.finite = false; this.finishStress(false); }
      this.graph?.silence();
    }
    this.frameId = requestAnimationFrame(this.tick);
  };

  async run() {
    this.stop();
    const operation = new AbortController(); this.operation = operation;
    this.status("Starting offline graph qualification. No sound is sent to the output device.");
    const result = await runAudioQualification({ sourceHash: __AUDIO_VERSION__, signal: operation.signal, progress: (message) => this.status(`Rendering ${message}…`) });
    if (operation.signal.aborted) throw new DOMException("Qualification stopped.", "AbortError");
    Object.assign(result, { stress: this.report.stress, runtimeSmoke: this.report.runtimeSmoke, humanListening: this.report.humanListening, listening: this.report.listening });
    this.report = result;
    this.operation = undefined;
    this.publish();
    this.status(`Offline qualification finished · ${result.offline.passed} passed · ${result.offline.failed} failed · ${result.offline.renders.length} rendered cases.`);
    return this.report;
  }

  async stress(seconds = 1200): Promise<AudioQualificationReport> {
    if (!Number.isFinite(seconds) || seconds < 16 || seconds > 7200) throw new Error("Stress duration must be 16–7200 seconds; publication requires 1200 seconds.");
    this.stop();
    const operation = new AbortController(); this.operation = operation;
    await this.ensureContext();
    await initializePhysics();
    if (operation.signal.aborted) throw new DOMException("Stress initialization stopped.", "AbortError");
    this.node("stress-scene").hidden = false;
    const container = this.node("stress-viewport"); container.replaceChildren();
    const rig = new SuspensionRig(DEFAULT_SETUP);
    rig.setExperiment("circuit");
    let view: SceneView;
    try {
      view = new SceneView(container, DEFAULT_SETUP, getTestCircuit());
      view.configure({ ...DEFAULT_PRESENTATION, quality: "balanced" });
      view.renderer.setPixelRatio(1); view.renderer.setSize(1920, 1080);
      view.setCamera("chase"); view.remember(rig.telemetry, true);
    } catch (error) { rig.dispose(); throw error; }
    this.graph?.dispose(); this.graph = undefined;
    const now = performance.now();
    const promise = new Promise<AudioQualificationReport>((resolve) => {
      this.stressState = {
        target: seconds, start: now, last: now, accumulator: 0, lastStatus: 0, lastReport: 0,
        frames: 0, steps: 0, droppedSimulationSeconds: 0, finite: true, maxPeak: 0,
        analyserFrames: 0, analyserSamples: 0, silentFrames: 0, contextNotRunningFrames: 0,
        audioOnSeconds: 0, hiddenMs: 0, hiddenStarted: document.hidden ? now : null,
        visibilityEvents: [{ elapsedSeconds: 0, state: document.visibilityState }],
        heapStart: heap(), heapMax: heap(), frame: new TimingMetric(), audio: new TimingMetric(), capture: new TimingMetric(),
        off: new TimingMetric(), on: new TimingMetric(), controls: new TimingMetric(), rig, view, settings: { ...this.settings }, resolve,
      };
    });
    this.node<HTMLProgressElement>("stress-progress").max = seconds + 8;
    this.status("Stress started · 8 seconds without an audio graph, then 8 paired seconds with the maximum audio workload. Keep the tab visible.");
    this.publishStress(false);
    return promise;
  }

  private stressFrame(now: number) {
    const state = this.stressState!;
    const elapsed = (now - state.start) / 1000, rawDt = Math.max(0, (now - state.last) / 1000), dt = Math.min(rawDt, 0.1);
    state.last = now; state.frames++; state.frame.record(rawDt * 1000);
    const audioOn = elapsed >= 8;
    if (elapsed < 8) state.off.record(rawDt * 1000);
    else if (elapsed < 16) state.on.record(rawDt * 1000);
    if (audioOn && !this.graph) this.createGraph(state.settings);
    state.accumulator += dt;
    let steps = 0, captureMs = 0;
    while (state.accumulator >= FIXED_STEP && steps < 8) {
      state.rig.step(referenceControls(state.rig.telemetry, DEFAULT_SETUP, getTestCircuit(), 16), FIXED_STEP);
      state.view.remember(state.rig.telemetry); state.steps++; steps++; state.accumulator -= FIXED_STEP;
      if (audioOn) {
        const captureStart = performance.now();
        const control = deriveAudioControls(state.rig.telemetry, DEFAULT_SETUP);
        const duration = performance.now() - captureStart;
        state.capture.record(duration);
        captureMs += duration;
        state.finite &&= [control.engine.rpm, ...control.wheels.flatMap((wheel) => [wheel.warning, wheel.slip, wheel.load, wheel.demand])].every(Number.isFinite);
      }
    }
    if (state.accumulator >= FIXED_STEP) { state.droppedSimulationSeconds += state.accumulator; state.accumulator = 0; }
    if (rawDt > dt) state.droppedSimulationSeconds += rawDt - dt;
    state.finite &&= [state.rig.telemetry.position.x, state.rig.telemetry.position.y, state.rig.telemetry.position.z, state.rig.telemetry.speed].every(Number.isFinite);
    if (audioOn && this.graph && this.context) {
      const updateStart = performance.now();
      const frame: AudioControlFrame = auditionFrame(WHEEL_IDS, this.context.currentTime, true, 1);
      frame.engine = { rpm: 12000, load: 1, driveLoad: 1, shifting: false, gear: 5, overrun: 0.2 };
      frame.impact = 0.5;
      this.graph.update(frame);
      const publishMs = performance.now() - updateStart;
      state.audio.record(publishMs);
      state.controls.record(captureMs + publishMs);
      state.audioOnSeconds += rawDt;
      if (this.context.state !== "running") state.contextNotRunningFrames++;
      this.analyser!.getFloatTimeDomainData(this.pcm);
      let energy = 0;
      for (const value of this.pcm) { state.finite &&= Number.isFinite(value); state.maxPeak = Math.max(state.maxPeak, Math.abs(value)); energy += value * value; }
      if (elapsed > 9 && energy / this.pcm.length < 1e-12) state.silentFrames++;
      state.analyserFrames++; state.analyserSamples += this.pcm.length;
    }
    state.view.render(state.rig, state.accumulator / FIXED_STEP, dt);
    const currentHeap = heap(); if (currentHeap !== null) state.heapMax = Math.max(state.heapMax ?? 0, currentHeap);
    if (elapsed - state.lastStatus >= 1) {
      state.lastStatus = elapsed;
      this.node<HTMLProgressElement>("stress-progress").value = elapsed;
      this.node("stress-status").textContent = `${Math.floor(elapsed)} / ${state.target} s · ${state.frames.toLocaleString()} frames · frame p95 ${state.frame.result().p95Ms.toFixed(1)} ms · audio update p95 ${state.audio.result().p95Ms.toFixed(1)} ms · ${document.visibilityState}`;
    }
    if (elapsed - state.lastReport >= 10) { state.lastReport = elapsed; this.publishStress(false); }
    if (elapsed >= state.target + 8) this.finishStress(true);
  }

  private publishStress(completed: boolean) {
    const state = this.stressState!;
    const now = performance.now(), elapsed = (now - state.start) / 1000;
    const hiddenMs = state.hiddenMs + (state.hiddenStarted === null ? 0 : now - state.hiddenStarted);
    const off = state.off.result(), on = state.on.result();
    this.report.stress = {
      completed, targetSeconds: state.target, elapsedSeconds: elapsed,
      scope: "One reference car, production SuspensionRig at 120 Hz and SceneView on the reference circuit at fixed 1920×1080 balanced rendering; conservative reference controller capped at 16 m/s. Audio graph receives intentional synthetic simultaneous four-wheel full slip, 12000 RPM/full load and impact 0.5, independent of the actual physics telemetry. Captured real telemetry is separately derived for adapter cost/finite checks.",
      drawingBuffer: { width: state.view.renderer.domElement.width, height: state.view.renderer.domElement.height },
      settings: state.settings, frames: state.frames, physicsSteps: state.steps,
      droppedSimulationSeconds: state.droppedSimulationSeconds, finite: state.finite,
      frameTiming: state.frame.result(), audioUpdateTiming: state.audio.result(), physicsAudioCaptureTiming: state.capture.result(), totalAudioControlTiming: state.controls.result(),
      pairedFrames: { scope: "Initial sequential 8-second audio-off then 8-second audio-on periods on the same driving/rendering workload; includes graph activation; no statistical claim of isolation from GPU/OS variation.", audioOff: off, audioOn: on, meanFramePenaltyPercent: off.meanMs ? ((on.meanMs - off.meanMs) / off.meanMs) * 100 : null },
      audioOnSeconds: state.audioOnSeconds,
      analyser: { frames: state.analyserFrames, sampledValues: state.analyserSamples, maximumSamplePeak: state.maxPeak, silentFramesAfterWarmup: state.silentFrames, contextNotRunningFrames: state.contextNotRunningFrames, scope: "2048 mono-downmixed PCM values observed per render frame. Windows can overlap; sampledValues is not a count of unique audio samples. This is not a hardware-underrun detector." },
      visibleFraction: Math.max(0, 1 - hiddenMs / Math.max(1, now - state.start)), hiddenSeconds: hiddenMs / 1000, visibility: state.visibilityEvents,
      device: this.device(), heap: { supported: state.heapStart !== null, startBytes: state.heapStart, endBytes: heap(), maximumObservedBytes: state.heapMax },
      performanceTargets: { totalAudioControlP95BelowHalfMs: state.controls.result().p95Ms < 0.5, pairedMeanFramePenaltyBelow5Percent: off.meanMs ? (on.meanMs - off.meanMs) / off.meanMs < 0.05 : null },
    };
    this.publish();
  }

  private finishStress(completed: boolean) {
    if (!this.stressState) return;
    const state = this.stressState;
    this.publishStress(completed);
    this.stressState = undefined;
    this.graph?.silence(); this.graph?.dispose(); this.graph = undefined;
    state.view.dispose(); state.rig.dispose();
    this.status(completed ? "Stress run completed. The report contains measured frame/audio statistics and visibility scope." : "Stress run stopped. The partial result is preserved and is not a completed qualification.");
    state.resolve(this.report);
  }

  private visibility = () => {
    if (document.hidden) { this.graph?.silence(); this.audition = undefined; }
    const state = this.stressState;
    if (!state) return;
    const now = performance.now();
    if (document.hidden && state.hiddenStarted === null) state.hiddenStarted = now;
    else if (!document.hidden && state.hiddenStarted !== null) { state.hiddenMs += now - state.hiddenStarted; state.hiddenStarted = null; }
    if (state.visibilityEvents.length < 100) state.visibilityEvents.push({ elapsedSeconds: (now - state.start) / 1000, state: document.visibilityState });
  };

  private device() {
    return {
      userAgent: navigator.userAgent, sampleRate: this.context?.sampleRate ?? null,
      contextState: this.context?.state ?? "not-created", baseLatencySeconds: this.context?.baseLatency ?? null,
      outputLatencySeconds: this.context && "outputLatency" in this.context ? this.context.outputLatency : null,
      endToEndLatency: null, visibility: document.visibilityState,
    };
  }

  private async runtimeSmoke() {
    if (this.stressState) throw new Error("Stop the stress run before lifecycle checks.");
    this.stop();
    const operation = new AbortController(); this.operation = operation;
    const runtime = new VehicleAudio({ ...this.settings, enabled: true });
    this.smokeRuntime = runtime;
    const states: Record<string, unknown> = { beforeGesture: runtime.diagnostics() };
    const checks: { name: string; passed: boolean }[] = [];
    runtime.unlock();
    await delay(100);
    if (operation.signal.aborted) throw new DOMException("Lifecycle check stopped.", "AbortError");
    states.unlocked = runtime.diagnostics();
    checks.push({ name: "User gesture creates one running graph", passed: runtime.diagnostics().contextState === "running" && runtime.diagnostics().liveGraphs === 1 });
    runtime.configure({ ...this.settings, enabled: false }); await delay(70);
    if (operation.signal.aborted) throw new DOMException("Lifecycle check stopped.", "AbortError");
    states.muted = runtime.diagnostics();
    checks.push({ name: "Mute suspends output", passed: runtime.diagnostics().state === "muted" && runtime.diagnostics().contextState !== "running" });
    runtime.configure({ ...this.settings, enabled: true }); await delay(70);
    if (operation.signal.aborted) throw new DOMException("Lifecycle check stopped.", "AbortError");
    runtime.demo("fl"); runtime.update(true); runtime.stopAudition(); runtime.silence();
    states.reset = runtime.diagnostics();
    runtime.setSetup({ ...DEFAULT_SETUP, referenceCar: "awd" });
    runtime.setSetup(DEFAULT_SETUP); await delay(110);
    if (operation.signal.aborted) throw new DOMException("Lifecycle check stopped.", "AbortError");
    states.rebuilt = runtime.diagnostics();
    checks.push({ name: "Rebuild retires old graphs", passed: runtime.diagnostics().liveGraphs === 1 && runtime.diagnostics().retiringGraphs === 0 });
    runtime.dispose(); runtime.dispose(); states.disposed = runtime.diagnostics();
    this.smokeRuntime = undefined; this.operation = undefined;
    checks.push({ name: "Repeated disposal releases graph/context", passed: runtime.diagnostics().liveGraphs === 0 && runtime.diagnostics().retiringGraphs === 0 && runtime.diagnostics().contextState === "not-created" });
    this.report.runtimeSmoke = { scope: "Actual VehicleAudio wrapper created from this button gesture; state/resource checks for unlock, mute, reset/audition-stop, profile rebuild and idempotent disposal. Acoustic silence is covered separately by offline renders.", device: this.device(), checks, failed: checks.filter((check) => !check.passed).length, states };
    this.publish(); this.status(`Live lifecycle check finished · ${checks.filter((check) => check.passed).length}/${checks.length} passed.`);
    return this.report;
  }

  private startListening() {
    if (this.stressState) { this.status("Stop the stress run before the listening test."); return; }
    const order = Array.from({ length: 8 }, () => [...WHEEL_IDS]).flat();
    const random = crypto.getRandomValues(new Uint32Array(order.length));
    for (let i = order.length - 1; i > 0; i--) { const j = random[i] % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    this.listening = { order, index: 0, waiting: false, matrix: Array.from({ length: 4 }, () => [0, 0, 0, 0]), output: this.settings.output, masked: this.node<HTMLInputElement>("lab-engine-mask").checked };
    this.node<HTMLButtonElement>("listen-play").disabled = false;
    this.answersEnabled(false);
    this.node("listen-status").textContent = "Trial 1 / 32 ready. Play the tyre, then choose the wheel you hear. Responses stay hidden until the test finishes.";
  }

  private async playListening() {
    const test = this.listening;
    if (!test || test.index >= test.order.length) return;
    if (test.output !== this.settings.output || test.masked !== this.node<HTMLInputElement>("lab-engine-mask").checked) throw new Error("Listening mode or engine masking changed. Restart the 32-trial test to keep its conditions consistent.");
    await this.play([test.order[test.index]]);
    test.waiting = true; this.answersEnabled(true);
    this.node("listen-status").textContent = `Trial ${test.index + 1} / 32 · choose the wheel you hear. Play next tyre repeats the current trial until you answer.`;
  }

  private answer(answer: WheelId) {
    const test = this.listening;
    if (!test?.waiting || test.index >= test.order.length) return;
    const target = test.order[test.index];
    test.matrix[WHEEL_IDS.indexOf(target)][WHEEL_IDS.indexOf(answer)]++;
    test.index++; test.waiting = false; this.answersEnabled(false);
    this.graph?.silence(); this.audition = undefined;
    let correct = 0, side = 0, axle = 0;
    test.matrix.forEach((row, actual) => row.forEach((count, response) => {
      if (actual === response) correct += count;
      if (WHEEL_IDS[actual][1] === WHEEL_IDS[response][1]) side += count;
      if (WHEEL_IDS[actual][0] === WHEEL_IDS[response][0]) axle += count;
    }));
    const complete = test.index === 32;
    this.report.humanListening = complete ? "completed" : "in progress";
    this.report.listening = {
      sourceHash: __AUDIO_VERSION__, trialsPlanned: 32, actualResponses: test.index, complete,
      scope: "Actual button responses to a balanced randomized wheel sequence. Rows are presented wheels; columns are human responses. Replays are allowed. This is one uncalibrated local listening session, not a population study.",
      output: test.output, engineMasking: test.masked, order: WHEEL_IDS, confusionMatrix: test.matrix.map((row) => [...row]),
      correct, sideCorrect: side, axleCorrect: axle, quadrantAccuracy: correct / test.index, sideAccuracy: side / test.index, axleAccuracy: axle / test.index,
      targetsMet: complete ? { sideAtLeast90Percent: side / 32 >= 0.9, axleAtLeast75Percent: axle / 32 >= 0.75, quadrantAtLeast70Percent: correct / 32 >= 0.7 } : null,
    };
    this.node<HTMLButtonElement>("listen-play").disabled = complete;
    this.node("listen-status").textContent = complete ? `32 responses complete · ${correct}/32 exact · ${side}/32 left/right · ${axle}/32 front/rear. Counts and confusion matrix are in the report.` : `${test.index} / 32 responses recorded. Play the next tyre when ready.`;
    this.publish();
  }

  private answersEnabled(enabled: boolean) { document.querySelectorAll<HTMLButtonElement>("[data-answer]").forEach((button) => { button.disabled = !enabled; }); }

  private publish() {
    const serialized = JSON.stringify(this.report, null, 2);
    this.node<HTMLTextAreaElement>("audio-report").value = serialized;
    // Optional localhost-only Vite evidence sink; file download remains available.
    if (import.meta.env.DEV)
      void fetch("/__audio-evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: serialized }).catch(() => {});
    this.node("qa-passed").textContent = String(this.report.offline.passed);
    this.node("qa-failed").textContent = String(this.report.offline.failed);
    this.node("qa-renders").textContent = String(this.report.offline.renders.length);
    this.node("qa-checks").replaceChildren(...this.report.offline.checks.map((check) => {
      const li = document.createElement("li"); li.className = check.passed ? "pass" : "fail";
      li.textContent = `${check.passed ? "PASS" : "FAIL"} ${check.name} · ${check.detail}`;
      return li;
    }));
  }

  private download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(this.report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `audio-qualification-${__AUDIO_VERSION__}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  stop() {
    this.operation?.abort(); this.operation = undefined;
    this.smokeRuntime?.dispose(); this.smokeRuntime = undefined;
    this.audition = undefined; this.graph?.silence();
    if (this.stressState) this.finishStress(false);
    else { this.graph?.dispose(); this.graph = undefined; }
  }

  private dispose() {
    this.stop(); cancelAnimationFrame(this.frameId);
    document.removeEventListener("visibilitychange", this.visibility);
    this.graph?.dispose(); this.analyser?.disconnect();
    if (this.context && this.context.state !== "closed") void this.context.close().catch(() => {});
  }
}

const lab = new AudioLab();
declare global {
  interface Window {
    __audioLab: {
      run: () => Promise<AudioQualificationReport>;
      stress: (seconds?: number) => Promise<AudioQualificationReport>;
      stop: () => void;
      readonly report: AudioQualificationReport;
    };
  }
}
window.__audioLab = { run: () => lab.run(), stress: (seconds) => lab.stress(seconds), stop: () => lab.stop(), get report() { return lab.report; } };
