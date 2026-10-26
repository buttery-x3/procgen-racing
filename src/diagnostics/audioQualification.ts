import { VehicleAudioGraph } from "../audio/VehicleAudioGraph";
import { auditionFrame } from "../audio/audition";
import { DEFAULT_AUDIO_SETTINGS } from "../audio/settings";
import { engineAudioProfile } from "../audio/profiles";
import { deriveAudioControls } from "../audio/AudioControls";
import type { AudioControlFrame, AudioSettings, EngineAudioControl } from "../audio/types";
import { DEFAULT_SETUP } from "../vehicle/setup";
import { WHEEL_IDS, WHEEL_RADIUS, GRAVITY } from "../vehicle/types";
import type { WheelId, VehicleTelemetry } from "../vehicle/types";
import { initializePhysics, SuspensionRig } from "../physics/SuspensionRig";

export interface AudioCheck {
  name: string;
  passed: boolean;
  detail: string;
}
export interface RenderMeasurement {
  name: string;
  sampleRate: number;
  output: AudioSettings["output"];
  finite: boolean;
  peak: number;
  leftRms: number;
  rightRms: number;
  monoRms: number;
  centroidHz: number;
  dominantHz: number;
  tailRms: number;
  resumeGateRms: number;
  comparison?: {
    baseline: string;
    differenceRms: number;
    differenceRelativeDb: number;
    minimumRelativeDb: number;
    windowSeconds: [number, number];
  };
}
export interface AudioQualificationReport {
  format: "procgen-racing:audio-qualification";
  version: 1;
  sourceHash: string;
  recordedAt: string;
  scope: string;
  browser: { userAgent: string; devicePixelRatio: number; hardwareConcurrency: number | null };
  sampleRates: number[];
  offline: { checks: AudioCheck[]; renders: RenderMeasurement[]; passed: number; failed: number };
  controls: Record<string, unknown>;
  stress: Record<string, unknown> | null;
  runtimeSmoke: Record<string, unknown> | null;
  humanListening: "not performed" | "in progress" | "completed";
  listening: Record<string, unknown> | null;
  endToEndLatency: null;
  limitations: string[];
}

export function createAudioReport(sourceHash: string): AudioQualificationReport {
  return {
    format: "procgen-racing:audio-qualification", version: 1, sourceHash,
    recordedAt: new Date().toISOString(),
    scope: "Standalone audio feature qualification. Native Web Audio graph renders at 44.1/48 kHz; stereo, HRTF and mono measurements. No listening result is inferred from signal measurements.",
    browser: { userAgent: navigator.userAgent, devicePixelRatio, hardwareConcurrency: navigator.hardwareConcurrency || null },
    sampleRates: [44100, 48000],
    offline: { checks: [], renders: [], passed: 0, failed: 0 },
    controls: {}, stress: null, runtimeSmoke: null,
    humanListening: "not performed", listening: null, endToEndLatency: null,
    limitations: [
      "Digital sample peaks are not acoustic levels or true-peak measurements.",
      "HRTF channel balance and axle spectral differences do not establish human front/rear recognition.",
      "Browser base/output latency is a device estimate. Acoustic end-to-end latency has not been measured.",
      "A browser analyser can find invalid samples and sustained silence; it cannot prove an absence of output-device underruns.",
    ],
  };
}

function rms(samples: Float32Array, start: number, end: number) {
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, end - start));
}

/** Windowed radix-2 FFT, used only for descriptive audio QA measurements. */
function spectrum(samples: Float32Array, sampleRate: number) {
  const size = 4096, real = new Float64Array(size), imaginary = new Float64Array(size);
  const offset = Math.min(Math.floor(sampleRate * 0.35), Math.max(0, samples.length - size));
  for (let i = 0; i < size; i++) real[i] = (samples[offset + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const value = real[i]; real[i] = real[j]; real[j] = value; }
  }
  for (let length = 2; length <= size; length *= 2) {
    const angle = (-2 * Math.PI) / length;
    for (let start = 0; start < size; start += length)
      for (let j = 0; j < length / 2; j++) {
        const c = Math.cos(angle * j), s = Math.sin(angle * j), a = start + j, b = a + length / 2;
        const x = real[b] * c - imaginary[b] * s, y = real[b] * s + imaginary[b] * c;
        real[b] = real[a] - x; imaginary[b] = imaginary[a] - y;
        real[a] += x; imaginary[a] += y;
      }
  }
  let energy = 0, weighted = 0, peakEnergy = 0, dominant = 0;
  for (let bin = 1; bin < size / 2; bin++) {
    const power = real[bin] ** 2 + imaginary[bin] ** 2, hz = (bin * sampleRate) / size;
    energy += power; weighted += power * hz;
    if (power > peakEnergy) { peakEnergy = power; dominant = hz; }
  }
  return { centroidHz: energy ? weighted / energy : 0, dominantHz: dominant };
}

type FrameSource = (time: number) => AudioControlFrame;
interface RenderOptions {
  name: string;
  sampleRate: number;
  settings: AudioSettings;
  frame: FrameSource;
  silenceAt?: number;
  stopUpdatesAt?: number;
  prepareResumeAt?: number;
  captureMono?: (samples: Float32Array) => void;
}

async function render(options: RenderOptions): Promise<RenderMeasurement> {
  const duration = 0.85;
  const context = new OfflineAudioContext(2, Math.ceil(duration * options.sampleRate), options.sampleRate);
  const graph = new VehicleAudioGraph(context, context.destination, options.settings, engineAudioProfile(DEFAULT_SETUP), 0);
  try {
    for (let time = 0; time < duration; time += 1 / 60) {
      if (time >= (options.stopUpdatesAt ?? Infinity) || time >= (options.silenceAt ?? Infinity) || time >= (options.prepareResumeAt ?? Infinity)) break;
      graph.update(options.frame(time), time);
    }
    if (options.silenceAt !== undefined) graph.silence(options.silenceAt);
    if (options.prepareResumeAt !== undefined) graph.prepareResume(options.prepareResumeAt);
    const buffer = await context.startRendering();
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1), mono = new Float32Array(buffer.length);
    let finite = true, peak = 0;
    for (let i = 0; i < buffer.length; i++) {
      finite &&= Number.isFinite(left[i]) && Number.isFinite(right[i]);
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      mono[i] = (left[i] + right[i]) / 2;
    }
    const start = Math.floor(options.sampleRate * 0.3), end = Math.floor(options.sampleRate * 0.6);
    options.captureMono?.(mono);
    return {
      name: options.name, sampleRate: options.sampleRate, output: options.settings.output, finite, peak,
      leftRms: rms(left, start, end), rightRms: rms(right, start, end), monoRms: rms(mono, start, end),
      ...spectrum(mono, options.sampleRate), resumeGateRms: rms(mono, Math.floor(options.sampleRate * 0.27), Math.floor(options.sampleRate * 0.37)), tailRms: rms(mono, Math.floor(options.sampleRate * 0.72), buffer.length),
    };
  } finally { graph.dispose(); }
}

function controlFixtures(base: VehicleTelemetry) {
  const fixture = (demand: number, moving = true, grounded = true) => {
    const speed = moving ? 20 : 0, angle = Math.atan(demand * Math.tan(DEFAULT_SETUP.lateralPeak));
    return deriveAudioControls({
      ...base, speed, wheels: base.wheels.map((wheel) => ({
        ...wheel, grounded, longitudinalSpeed: speed, angularSpeed: speed / WHEEL_RADIUS,
        lateralSpeed: moving ? Math.tan(angle) * speed : 0, slipAngle: angle,
        load: (DEFAULT_SETUP.mass * GRAVITY * (wheel.id[0] === "f" ? DEFAULT_SETUP.frontWeight : 1 - DEFAULT_SETUP.frontWeight)) / 2,
        longitudinalForce: 0, lateralForce: moving ? 2000 : 0,
      })),
    }, DEFAULT_SETUP);
  };
  return { low: fixture(0.2), warning: fixture(0.82), sliding: fixture(1.6), stopped: fixture(2, false), airborne: fixture(2, true, false) };
}

export async function runAudioQualification(options: {
  sourceHash: string;
  signal?: AbortSignal;
  progress?: (message: string) => void;
}): Promise<AudioQualificationReport> {
  const report = createAudioReport(options.sourceHash);
  const check = (name: string, passed: boolean, detail: string) => report.offline.checks.push({ name, passed, detail });
  const next = async (renderOptions: RenderOptions) => {
    if (options.signal?.aborted) throw new DOMException("Audio qualification stopped.", "AbortError");
    options.progress?.(`${renderOptions.sampleRate / 1000} kHz · ${renderOptions.name}`);
    const measurement = await render(renderOptions);
    report.offline.renders.push(measurement);
    check(`${renderOptions.sampleRate}/${renderOptions.name}: finite and bounded`, measurement.finite && measurement.peak <= 0.901, `peak ${measurement.peak.toFixed(5)}; finite ${measurement.finite}`);
    return measurement;
  };
  await initializePhysics();
  const rig = new SuspensionRig(DEFAULT_SETUP);
  const fixtures = controlFixtures(rig.telemetry);
  rig.dispose();
  report.controls = Object.fromEntries(Object.entries(fixtures).map(([key, frame]) => [key, frame.wheels.map(({ id, warning, slip, demand }) => ({ id, warning, slip, demand }))]));
  check("Control mapping warns before sliding", fixtures.warning.wheels.every((wheel) => wheel.warning > 0.1 && wheel.slip === 0), "Controlled contact kinematics at 0.82 normalized model demand.");
  check("Control mapping reports a slide beyond the peak", fixtures.sliding.wheels.every((wheel) => wheel.slip > 0.1), "Controlled contact kinematics at 1.6 normalized model demand.");
  check("Stopped and airborne tyres suppress grip cues", [fixtures.stopped, fixtures.airborne].every((frame) => frame.wheels.every((wheel) => wheel.warning === 0 && wheel.slip === 0)), "No cue is inferred from load alone or an airborne wheel.");

  for (const sampleRate of report.sampleRates) {
    for (const output of ["stereo", "headphones"] as const) {
      for (const id of WHEEL_IDS) {
        const measurement = await next({ name: `${output}/${id}`, sampleRate, settings: { ...DEFAULT_AUDIO_SETTINGS, engine: 0, surface: 0, output }, frame: () => auditionFrame([id]) });
        const intended = id[1] === "l" ? measurement.leftRms : measurement.rightRms;
        const opposite = id[1] === "l" ? measurement.rightRms : measurement.leftRms;
        check(`${sampleRate}/${output}/${id}: side dominance`, intended > opposite * 1.05 && intended > 0.0001, `intended/opposite ${intended.toFixed(6)}/${opposite.toFixed(6)} RMS`);
        check(`${sampleRate}/${output}/${id}: mono fold-down`, measurement.monoRms > 0.2 * Math.max(measurement.leftRms, measurement.rightRms), `fold-down ${measurement.monoRms.toFixed(6)} RMS`);
      }
    }
    const axle = async (id: WheelId) => next({ name: `mono/${id}-axle-tone`, sampleRate, settings: { ...DEFAULT_AUDIO_SETTINGS, engine: 0, surface: 0, output: "mono", axleCue: 1 }, frame: () => auditionFrame([id]) });
    const front = await axle("fl"), rear = await axle("rl");
    check(`${sampleRate}: front/rear spectral distinction`, front.centroidHz > rear.centroidHz * 1.08, `front/rear energy centroids ${front.centroidHz.toFixed(1)}/${rear.centroidHz.toFixed(1)} Hz; engine and road muted`);
    const mono = await next({ name: "mono/four-wheel", sampleRate, settings: { ...DEFAULT_AUDIO_SETTINGS, output: "mono" }, frame: () => auditionFrame(WHEEL_IDS, 0, true, 1) });
    check(`${sampleRate}: mono channels agree`, Math.abs(mono.leftRms - mono.rightRms) < 0.00001 && mono.monoRms > 0.001, `left/right ${mono.leftRms.toFixed(6)}/${mono.rightRms.toFixed(6)}`);
    const engine = async (name: string, control: Partial<EngineAudioControl>, captureMono?: RenderOptions["captureMono"]) => next({ name: `engine/${name}`, sampleRate, settings: { ...DEFAULT_AUDIO_SETTINGS, tyres: 0, surface: 0 }, frame: () => ({ ...auditionFrame([]), engine: { rpm: 4000, load: 0.85, driveLoad: 0.8, shifting: false, gear: 3, overrun: 0, ...control } }), captureMono });
    let coastWave: Float32Array | undefined, overrunWave: Float32Array | undefined;
    const idle = await engine("idle", { rpm: 1000, load: 0, driveLoad: 0 });
    const low = await engine("same-rpm-low-load", { load: 0, driveLoad: 0 }, (samples) => { coastWave = samples; });
    const loaded = await engine("loaded", {});
    const shifted = await engine("shift-cut", { shifting: true, driveLoad: 0 });
    const high = await engine("high-rpm", { rpm: 7000 });
    const neutral = await engine("neutral-free-rev", { rpm: 6000, gear: 0, driveLoad: 0, load: 0.35 });
    const overrun = await engine("overrun", { load: 0, driveLoad: 0, overrun: 1 }, (samples) => { overrunWave = samples; });
    check(`${sampleRate}: idle is audible`, idle.monoRms > 0.0005, `${idle.monoRms.toFixed(6)} RMS`);
    check(`${sampleRate}: power increases level`, loaded.monoRms > low.monoRms * 1.1, `loaded/low-load ${loaded.monoRms.toFixed(6)}/${low.monoRms.toFixed(6)} at 4000 RPM`);
    check(`${sampleRate}: shift cuts load texture`, shifted.monoRms < loaded.monoRms * 0.95, `shift/loaded ${shifted.monoRms.toFixed(6)}/${loaded.monoRms.toFixed(6)} at identical RPM`);
    check(`${sampleRate}: pitch rises with RPM`, high.dominantHz > idle.dominantHz * 3, `dominant bins idle/high ${idle.dominantHz.toFixed(1)}/${high.dominantHz.toFixed(1)} Hz`);
    check(`${sampleRate}: neutral revs remain audible`, neutral.monoRms > 0.0005 && neutral.dominantHz > idle.dominantHz * 2, `neutral ${neutral.monoRms.toFixed(6)} RMS; dominant ${neutral.dominantHz.toFixed(1)} Hz`);
    // The same seeded graph starts at time zero in both renders. Subtracting
    // phase-aligned samples measures the actual added texture even when noise
    // cross-terms make its total RMS slightly smaller than the coast baseline.
    const windowStart = Math.floor(sampleRate * 0.3), windowEnd = Math.floor(sampleRate * 0.6);
    let deltaEnergy = 0;
    if (coastWave && overrunWave)
      for (let i = windowStart; i < windowEnd; i++)
        deltaEnergy += (overrunWave[i] - coastWave[i]) ** 2;
    const differenceRms = Math.sqrt(deltaEnergy / (windowEnd - windowStart));
    const differenceRelativeDb = 20 * Math.log10(Math.max(1e-12, differenceRms) / Math.max(1e-12, low.monoRms));
    // This authored minimum contribution is a signal-design target, not proof
    // of human audibility under masking; the listening check remains separate.
    const minimumRelativeDb = -35;
    overrun.comparison = { baseline: low.name, differenceRms, differenceRelativeDb, minimumRelativeDb, windowSeconds: [0.3, 0.6] };
    check(`${sampleRate}: overrun contributes a distinct rendered layer`, differenceRms > 0.00001 && differenceRelativeDb >= minimumRelativeDb, `phase-aligned difference ${differenceRms.toExponential(4)} RMS / ${differenceRelativeDb.toFixed(2)} dB relative to coast; design minimum ${minimumRelativeDb} dB and RMS > 1e-5; human audibility unmeasured`);
    const resumeGate = await next({ name: "lifecycle/interrupted-resume", sampleRate, settings: { ...DEFAULT_AUDIO_SETTINGS }, frame: () => auditionFrame(WHEEL_IDS, 0, true, 1), prepareResumeAt: 0.25 });
    check(`${sampleRate}: interrupted resume waits silently for fresh controls`, resumeGate.resumeGateRms < 0.000001, `270–370 ms gate RMS ${resumeGate.resumeGateRms.toExponential(3)}; original watchdog would still be open`);
    const warning = await next({ name: "warning/near-limit", sampleRate, settings: { ...DEFAULT_AUDIO_SETTINGS, engine: 0, surface: 0 }, frame: () => fixtures.warning });
    const sliding = await next({ name: "warning/full-slip", sampleRate, settings: { ...DEFAULT_AUDIO_SETTINGS, engine: 0, surface: 0 }, frame: () => fixtures.sliding });
    check(`${sampleRate}: warning and slip are audible with escalation`, warning.monoRms > 0.0001 && sliding.monoRms > warning.monoRms * 1.2, `near-limit/slip ${warning.monoRms.toFixed(6)}/${sliding.monoRms.toFixed(6)} RMS`);
    const stress = await next({ name: "maximum/four-wheels-engine-impact", sampleRate, settings: { ...DEFAULT_AUDIO_SETTINGS, master: 1, engine: 1, surface: 1, tyres: 1 }, frame: () => ({ ...auditionFrame(WHEEL_IDS, 0, true, 1), engine: { rpm: 14500, load: 1, driveLoad: 1, shifting: false, gear: 5, overrun: 1 }, impact: 1 }) });
    check(`${sampleRate}: worst-case sum retains digital headroom`, stress.peak < 0.9, `peak ${stress.peak.toFixed(6)}`);
    for (const kind of ["pause", "watchdog", "mute"] as const) {
      const measured = await next({ name: `lifecycle/${kind}`, sampleRate, settings: { ...DEFAULT_AUDIO_SETTINGS, enabled: kind !== "mute" }, frame: () => auditionFrame(WHEEL_IDS, 0, true, 1), ...(kind === "pause" ? { silenceAt: 0.25 } : kind === "watchdog" ? { stopUpdatesAt: 0.15 } : {}) });
      check(`${sampleRate}: ${kind} reaches silence`, measured.tailRms < 0.00001, `tail 720–850 ms ${measured.tailRms.toExponential(3)} RMS`);
    }
  }
  report.offline.failed = report.offline.checks.filter((entry) => !entry.passed).length;
  report.offline.passed = report.offline.checks.length - report.offline.failed;
  return report;
}
