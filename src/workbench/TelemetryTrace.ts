import type { VehicleTelemetry, VehicleSetup } from "../vehicle/types";
import { mechanicsFingerprint } from "../vehicle/CarDefinition";
import { copySetup } from "../storage/GarageStorage";

export interface TraceSample {
  time: number;
  speed: number;
  throttle: number;
  brake: number;
  steer: number;
  yaw: number;
  roll: number;
  pitch: number;
  loads: number[];
  travel: number[];
  slip: number[];
  grounded: number;
  rpm: number;
}
export interface TraceRun {
  version: 1;
  name: string;
  physics: "m6-1";
  setup: VehicleSetup;
  mechanics: string;
  condition: string;
  sampleHz: 120;
  /** Legacy v1 traces also contain road-relative angles. */
  angleDatum?: "road";
  samples: TraceSample[];
  metrics?: RunMetrics;
}
export interface RunMetrics {
  distance: number;
  maxSpeed: number;
  zeroTo60: number | null;
  stopDistance: number | null;
  peakRoll: number;
  peakPitch: number;
  groundedFraction: number;
  peakLoad: number;
}
export type TraceMetric =
  | "speed"
  | "roll"
  | "pitch"
  | "yaw"
  | "throttle"
  | "brake"
  | "steer"
  | "load-fl"
  | "load-fr"
  | "load-rl"
  | "load-rr"
  | "travel-fl"
  | "travel-fr"
  | "travel-rl"
  | "travel-rr"
  | "slip-fl"
  | "slip-fr"
  | "slip-rl"
  | "slip-rr"
  | "rpm";
export const TRACE_METRICS: Record<
  TraceMetric,
  { name: string; unit: string }
> = {
  speed: { name: "Speed", unit: "km/h" },
  roll: { name: "Roll · road", unit: "°" },
  pitch: { name: "Pitch · road", unit: "°" },
  yaw: { name: "Yaw rate", unit: "°/s" },
  throttle: { name: "Throttle", unit: "%" },
  brake: { name: "Brake", unit: "%" },
  steer: { name: "Steering input", unit: "%" },
  "load-fl": { name: "FL load", unit: "kN" },
  "load-fr": { name: "FR load", unit: "kN" },
  "load-rl": { name: "RL load", unit: "kN" },
  "load-rr": { name: "RR load", unit: "kN" },
  "travel-fl": { name: "FL compression", unit: "mm" },
  "travel-fr": { name: "FR compression", unit: "mm" },
  "travel-rl": { name: "RL compression", unit: "mm" },
  "travel-rr": { name: "RR compression", unit: "mm" },
  "slip-fl": { name: "FL slip", unit: "%" },
  "slip-fr": { name: "FR slip", unit: "%" },
  "slip-rl": { name: "RL slip", unit: "%" },
  "slip-rr": { name: "RR slip", unit: "%" },
  rpm: { name: "Engine speed", unit: "rpm" },
};
export function traceValue(s: TraceSample, key: TraceMetric): number {
  if (key.startsWith("load-"))
    return s.loads[["fl", "fr", "rl", "rr"].indexOf(key.slice(5))] / 1000;
  if (key.startsWith("travel-"))
    return s.travel[["fl", "fr", "rl", "rr"].indexOf(key.slice(7))] * 1000;
  if (key.startsWith("slip-"))
    return s.slip[["fl", "fr", "rl", "rr"].indexOf(key.slice(5))] * 100;
  if (key === "rpm") return s.rpm;
  if (key === "speed") return s.speed * 3.6;
  if (key === "throttle" || key === "brake" || key === "steer")
    return s[key] * 100;
  return s[key as "roll" | "pitch" | "yaw"];
}
export function traceSample(t: VehicleTelemetry, yaw: number): TraceSample {
  return {
    time: t.time,
    speed: t.speed,
    throttle: t.controls.throttle,
    brake: t.controls.brake,
    steer: t.controls.steer,
    yaw: (yaw * 180) / Math.PI,
    roll: t.roll,
    pitch: t.pitch,
    loads: t.wheels.map((w) => w.load),
    travel: t.wheels.map((w) => w.compression),
    slip: t.wheels.map((w) => w.slipRatio),
    grounded: t.groundedCount,
    rpm: t.powertrain.rpm,
  };
}
export class TraceBuffer {
  private data: TraceSample[] = [];
  private cursor = 0;
  constructor(readonly capacity = 2400) {}
  push(sample: TraceSample) {
    if (
      this.data.length &&
      sample.time <
        this.data[(this.cursor + this.data.length - 1) % this.data.length].time
    )
      this.clear();
    if (this.data.length < this.capacity) {
      this.data.push(sample);
      this.cursor = 0;
    } else {
      this.data[this.cursor] = sample;
      this.cursor = (this.cursor + 1) % this.capacity;
    }
  }
  snapshot() {
    return this.data.length < this.capacity
      ? [...this.data]
      : [...this.data.slice(this.cursor), ...this.data.slice(0, this.cursor)];
  }
  clear() {
    this.data = [];
    this.cursor = 0;
  }
}
export function makeTrace(
  name: string,
  setup: VehicleSetup,
  condition: string,
  samples: TraceSample[],
): TraceRun {
  return {
    version: 1,
    name: name.trim().slice(0, 60) || "Recorded run",
    physics: "m6-1",
    setup: copySetup(setup),
    mechanics: mechanicsFingerprint(setup),
    condition,
    sampleHz: 120,
    angleDatum: "road",
    samples,
  };
}
export function tracePlot(runs: TraceRun[], metric: TraceMetric) {
  const values = runs.flatMap((r) =>
      r.samples.map((s) => traceValue(s, metric)),
    ),
    lo = Math.min(0, ...values),
    max = Math.max(1, ...values),
    range = Math.max(1, max - lo),
    duration = Math.max(
      1,
      ...runs.map(
        (r) => (r.samples.at(-1)?.time ?? 0) - (r.samples[0]?.time ?? 0),
      ),
    );
  const paths = runs.map((r) => {
    const step = Math.max(1, Math.floor(r.samples.length / 360)),
      start = r.samples[0]?.time ?? 0;
    return r.samples
      .filter((_, i) => i % step === 0 || i === r.samples.length - 1)
      .map(
        (s, i) =>
          `${i ? "L" : "M"}${(((s.time - start) / duration) * 740 + 10).toFixed(2)},${(165 - ((traceValue(s, metric) - lo) / range) * 145).toFixed(2)}`,
      )
      .join(" ");
  });
  return { paths, min: lo, max, duration };
}
const RUN_KEY = "procgen-racing:runs:v1";
export function loadRuns(): TraceRun[] {
  try {
    const data = JSON.parse(localStorage.getItem(RUN_KEY) ?? "[]");
    return Array.isArray(data)
      ? data
          .filter(
            (r) =>
              r.version === 1 &&
              r.physics === "m6-1" &&
              Array.isArray(r.samples) &&
              r.samples.length <= 6000 &&
              r.sampleHz === 120,
          )
          .slice(-6)
      : [];
  } catch {
    return [];
  }
}
export function saveRuns(runs: TraceRun[]) {
  const retained = runs.slice(-6);
  let json = JSON.stringify(retained);
  while (json.length > 2_000_000 && retained.length > 1) {
    retained.shift();
    json = JSON.stringify(retained);
  }
  if (json.length > 2_000_000)
    throw new Error(
      "This recording exceeds the 2 MB recent-run budget. Export it as JSON instead.",
    );
  localStorage.setItem(RUN_KEY, json);
}
