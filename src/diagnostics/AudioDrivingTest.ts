import "../style.css";
import "../workbench/m6.css";
import "../workbench/first-pass.css";
import { App } from "../app/App";
import { DEFAULT_SETUP } from "../vehicle/setup";
import { SoloStorage } from "../storage/SoloStorage";
import type { VehicleControls, VehicleTelemetry } from "../vehicle/types";

declare const __AUDIO_VERSION__: string;

type Stage = "ready" | "idle" | "launch" | "shift recovery" | "braking" | "stopped idle" | "relaunch" | "final braking" | "manual" | "finished";
type Snapshot = ReturnType<App["audioDrivingDiagnostics"]>;
interface StageSummary {
  stage: Stage;
  beganSeconds: number;
  endedSeconds: number | null;
  samples: number;
  eligibleSamples: number;
  minimumEngineRms: number | null;
  minimumOutputRms: number | null;
  maximumRpm: number;
  maximumSpeed: number;
  engineSilentSamples: number;
  outputSilentSamples: number;
  nonFiniteSamples: number;
  contextNotRunningSamples: number;
  appStalledSamples: number;
}
interface EventRecord { seconds: number; stage: Stage; kind: string; detail: string }
const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const zero: VehicleControls = { throttle: 0, brake: 0, steer: 0 };
let stage: Stage = "ready", running = false, initialized = false, runStarted = 0, stageStarted = 0;
let firstShift = false, initialGear = 1, stoppedSince = 0, samples = 0;
let engineSilenceStreak = 0, outputSilenceStreak = 0, appStallStreak = 0;
let summaries: StageSummary[] = [], events: EventRecord[] = [], rolling: Record<string, unknown>[] = [];
let last: Snapshot | undefined, timer: ReturnType<typeof setInterval> | undefined;
let recordedAt: string | null = null, completed = false;
let previousInvalidNodes = "";
let nodeHealth: Record<string, { samples: number; nonFiniteSamples: number; minimumRms: number; maximumRms: number }> = {};
const errors: { at: string; message: string }[] = [];
function recordError(message: string) {
  errors.push({ at: new Date().toISOString(), message });
  if (errors.length > 40) errors.shift();
}
window.addEventListener("error", (event) => recordError(event.message));
window.addEventListener("unhandledrejection", (event) => recordError(String(event.reason)));
const seconds = () => running || recordedAt ? (performance.now() - runStarted) / 1000 : 0;
function addEvent(kind: string, detail: string) {
  events.push({ seconds: seconds(), stage, kind, detail });
  if (events.length > 100) events.shift();
}
function setStage(next: Stage) {
  const elapsed = seconds();
  if (summaries.length) summaries.at(-1)!.endedSeconds = elapsed;
  stage = next; stageStarted = performance.now(); stoppedSince = 0;
  engineSilenceStreak = outputSilenceStreak = appStallStreak = 0;
  summaries.push({ stage, beganSeconds: elapsed, endedSeconds: null, samples: 0, eligibleSamples: 0,
    minimumEngineRms: null, minimumOutputRms: null, maximumRpm: 0, maximumSpeed: 0,
    engineSilentSamples: 0, outputSilentSamples: 0, nonFiniteSamples: 0, contextNotRunningSamples: 0, appStalledSamples: 0 });
  node("driving-status").textContent = `${stage.toUpperCase()} · recording actual driving audio`;
}
function finish(normal: boolean) {
  if (!running) return;
  completed = normal; running = false;
  if (summaries.length) summaries.at(-1)!.endedSeconds = seconds();
  stage = "finished";
  node("driving-status").textContent = normal ? "Sequence finished · inspect measurements and failures below" : "Recording ended · partial/manual result retained";
  publish();
}
function driver(t: VehicleTelemetry): VehicleControls | undefined {
  if (stage === "manual") return undefined;
  if (!running) return { ...zero, brake: 1 };
  // A transition below can enter the next branch in this same call. Read its
  // own clock rather than reusing the previous stage's elapsed duration.
  const elapsed = () => (performance.now() - stageStarted) / 1000;
  if (stage === "idle") {
    if (elapsed() >= 2.5) { initialGear = t.powertrain.gear; setStage("launch"); }
    else return { ...zero, brake: 1 };
  }
  if (stage === "launch") {
    if (t.powertrain.gear > initialGear) {
      firstShift = true;
      addEvent("first-upshift", `Actual gear ${initialGear} → ${t.powertrain.gear} at ${t.powertrain.rpm.toFixed(0)} RPM`);
      setStage("shift recovery");
    } else if (elapsed() >= 14) {
      addEvent("missing-first-upshift", "No actual first upshift within the 14-second launch cap.");
      setStage("braking");
    }
    return { ...zero, throttle: 1 };
  }
  if (stage === "shift recovery") {
    if (elapsed() >= 2) setStage("braking");
    else return { ...zero, throttle: 1 };
  }
  if (stage === "braking" || stage === "final braking") {
    if (t.speed < 0.15) {
      if (!stoppedSince) stoppedSince = performance.now();
      if (performance.now() - stoppedSince >= 350) {
        if (stage === "final braking") finish(true);
        else setStage("stopped idle");
        return { ...zero, brake: 1 };
      }
    } else stoppedSince = 0;
    if (elapsed() >= 12) {
      addEvent("stop-timeout", `Car did not settle below 0.15 m/s within 12 seconds; actual speed ${t.speed.toFixed(2)} m/s.`);
      if (stage === "final braking") finish(false);
      else setStage("stopped idle");
    }
    return { ...zero, brake: 1 };
  }
  if (stage === "stopped idle") {
    if (elapsed() >= 3) setStage("relaunch");
    else return { ...zero, brake: 1 };
  }
  if (stage === "relaunch") {
    if (elapsed() >= 3) setStage("final braking");
    else return { ...zero, throttle: 1 };
  }
  return { ...zero, brake: 1 };
}

const app = new App({ deterministic: true, setup: { ...DEFAULT_SETUP }, experiment: "handling", driver,
  storage: new SoloStorage("procgen-racing:audio-driving-diagnostic") });

function report() {
  return {
    format: "procgen-racing:audio-driving-diagnostic", version: 1, sourceHash: __AUDIO_VERSION__,
    recordedAt, completed, firstActualUpshiftObserved: firstShift,
    scope: "Production App RAF, SuspensionRig, VehicleAudio collector and native graph. Automatic default reference car on existing handling pad, or explicit manual controls. Lazy analyser taps on engine bus, impact, mix before ceiling, ceiling, final output, plus each wheel's input/raw panners/routed outputs. Sampled every 100 ms; 2048 samples can overlap. Diagnostic taps can add processing cost. Not a hardware-underrun or human-listening test.",
    browser: navigator.userAgent, sampleIntervalMs: 100, meterWarmupSeconds: 0.15, stageWarmupSeconds: 0.35,
    silenceRmsThreshold: 0.000001, consecutiveSamplesForSilenceEvent: 3,
    stage, samples, summaries, nodeHealth, events, errors, rolling, latest: last ?? null,
    limitations: ["No pass is inferred when muted, paused, hidden, warming up or without a running context.", "Silence events describe sampled digital signals only. They do not establish speaker/headphone behavior.", "A completed sequence can contain recorded failures; completion is not a pass."]
  };
}
function compactReport() {
  const { rolling: _rolling, ...result } = report();
  return result;
}
function publish() {
  const serialized = JSON.stringify(compactReport(), null, 2);
  node<HTMLTextAreaElement>("driving-report").value = serialized;
  if (import.meta.env.DEV && recordedAt)
    void fetch("/__audio-evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: serialized }).catch(() => {});
  const failures = events.filter((event) => event.kind !== "first-upshift");
  node("driving-failures").textContent = `${samples} samples · ${failures.length} recorded failures/events · ${errors.length} uncaught errors · first upshift ${firstShift ? "observed" : "not observed"}`;
}
function sample() {
  if (!initialized) return;
  try {
    last = app.audioDrivingDiagnostics();
    const { audio, telemetry: t } = last, signal = audio.signal;
    const reading = (point: { finite: boolean; rms: number } | undefined) => point ? `${point.finite ? "OK" : "BAD"} ${point.rms.toExponential(2)}` : "—";
    node("driving-live").textContent = [
      `Stage ${stage} · ${t.speed.toFixed(2)} m/s · ${t.rpm.toFixed(0)} RPM · gear ${t.gear}${t.shifting ? " SHIFTING" : ""}`,
      `Context ${audio.contextState} / ${audio.state} · ${last.paused ? "paused/hidden" : "active"} · frame age ${last.frameAgeMs?.toFixed(0) ?? "—"} ms`,
      `Engine ${reading(signal?.engine)} · Impact ${reading(signal?.impact)}`,
      `Mix ${reading(signal?.mix)} · Ceiling ${reading(signal?.ceiling)} · Output ${reading(signal?.output)}`,
      `Gain engine ${signal?.engineGain.toFixed(4) ?? "—"} / master ${signal?.outputGain.toFixed(4) ?? "—"} · ${signal?.warmedUp ? "meter ready" : "meter warming / absent"}`,
      `Error ${audio.error ?? audio.meterError ?? "none"} · app updates ${audio.updates}`,
      ...(signal?.wheels.map((wheel) => `${wheel.id.toUpperCase()} ${Object.entries(wheel.signals).map(([name, point]) => `${name}:${reading(point)}`).join(" | ")}`) ?? []),
    ].join("\n");
    if (!running) return;
    if (stage !== "manual" && last.paused) {
      addEvent("sequence-interrupted", "The actual app paused or lost visibility/focus. Restart the sequence for complete driving evidence.");
      finish(false);
      return;
    }
    samples++;
    const summary = summaries.at(-1)!;
    summary.samples++; summary.maximumRpm = Math.max(summary.maximumRpm, t.rpm); summary.maximumSpeed = Math.max(summary.maximumSpeed, t.speed);
    const eligible = Boolean(signal?.warmedUp && audio.sourceReady && !last.paused && audio.contextState === "running" && audio.enabled && audio.settings.master > 0.01 && audio.settings.engine > 0.01 && performance.now() - stageStarted >= 350);
    if (audio.enabled && !last.paused && audio.contextState !== "running") summary.contextNotRunningSamples++;
    if (signal?.warmedUp) {
      const points = { engine: signal.engine, impact: signal.impact, mix: signal.mix, ceiling: signal.ceiling, output: signal.output,
        ...Object.fromEntries(signal.wheels.flatMap((wheel) => Object.entries(wheel.signals).map(([name, point]) => [`${wheel.id}/${name}`, point]))) };
      const invalid: string[] = [];
      for (const [name, point] of Object.entries(points)) {
        const health = nodeHealth[name] ??= { samples: 0, nonFiniteSamples: 0, minimumRms: Infinity, maximumRms: 0 };
        health.samples++;
        if (!point.finite) { health.nonFiniteSamples++; invalid.push(name); }
        else { health.minimumRms = Math.min(health.minimumRms, point.rms); health.maximumRms = Math.max(health.maximumRms, point.rms); }
      }
      const invalidKey = invalid.join(", ");
      if (invalid.length) {
        summary.nonFiniteSamples++;
        if (invalidKey !== previousInvalidNodes) addEvent("non-finite-signal", `Invalid native signal nodes: ${invalidKey}`);
      }
      previousInvalidNodes = invalidKey;
    }
    if (eligible && signal) {
      summary.eligibleSamples++;
      summary.minimumEngineRms = Math.min(summary.minimumEngineRms ?? Infinity, signal.engine.rms);
      summary.minimumOutputRms = Math.min(summary.minimumOutputRms ?? Infinity, signal.output.rms);
      const engineSilent = signal.engine.rms < 0.000001, outputSilent = signal.output.rms < 0.000001;
      if (engineSilent) summary.engineSilentSamples++;
      if (outputSilent) summary.outputSilentSamples++;
      engineSilenceStreak = engineSilent ? engineSilenceStreak + 1 : 0;
      outputSilenceStreak = outputSilent ? outputSilenceStreak + 1 : 0;
      if (engineSilenceStreak === 3) addEvent("engine-silence", "Three consecutive eligible native engine-bus windows below 1e-6 RMS.");
      if (outputSilenceStreak === 3) addEvent("output-silence", "Three consecutive eligible native final-output windows below 1e-6 RMS.");
    } else engineSilenceStreak = outputSilenceStreak = 0;
    const stalled = !last.paused && (last.frameAgeMs ?? 0) > 250;
    if (stalled) summary.appStalledSamples++;
    appStallStreak = stalled ? appStallStreak + 1 : 0;
    if (appStallStreak === 3) addEvent("app-raf-stalled", "Production RAF has not advanced for three diagnostic samples.");
    rolling.push({ seconds: seconds(), stage, eligible, ...last });
    if (rolling.length > 600) rolling.shift();
    if (seconds() > 90 && stage !== "manual") { addEvent("sequence-timeout", "Automatic sequence exceeded 90 seconds of wall time."); finish(false); }
    if (samples % 10 === 0) publish();
  } catch (error) { recordError(error instanceof Error ? error.stack ?? error.message : String(error)); publish(); }
}
function start(manual: boolean) {
  document.querySelector<HTMLButtonElement>('[data-action="experiment:handling"]')?.click();
  recordedAt = new Date().toISOString(); runStarted = performance.now(); running = true; completed = false;
  firstShift = false; samples = 0; summaries = []; events = []; rolling = []; errors.length = 0; nodeHealth = {}; previousInvalidNodes = "";
  setStage(manual ? "manual" : "idle");
  node<HTMLButtonElement>("driving-stop").disabled = false;
  publish();
}
node("driving-start").addEventListener("click", () => start(false));
node("driving-manual").addEventListener("click", () => start(true));
node("driving-stop").addEventListener("click", () => finish(false));
node("driving-copy").addEventListener("click", () => {
  publish();
  void navigator.clipboard.writeText(JSON.stringify(compactReport(), null, 2)).then(() => { node("driving-status").textContent = "Report copied."; }).catch(() => { node("driving-status").textContent = "Copy unavailable; use the report text or Download report."; });
});
node("driving-copy-readout").addEventListener("click", () => {
  void navigator.clipboard.writeText(node("driving-live").textContent ?? "").catch(() => {});
});
node("driving-download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report(), null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "audio-driving-diagnostic.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
await app.initialize(node("app"));
initialized = true;
node<HTMLButtonElement>("driving-start").disabled = false;
node<HTMLButtonElement>("driving-manual").disabled = false;
node("driving-status").textContent = "Ready · choose automatic sequence or manual driving";
timer = setInterval(sample, 100);
window.addEventListener("pagehide", () => { if (timer) clearInterval(timer); app.dispose(); }, { once: true });

declare global {
  interface Window { __audioDriving: { readonly report: ReturnType<typeof report>; sample: () => Snapshot } }
}
window.__audioDriving = { get report() { return report(); }, sample: () => app.audioDrivingDiagnostics() };
