import { Quaternion, Vector3 } from "three";
import type { SessionIdentity } from "./identity";
import type { VehicleTelemetry } from "../vehicle/types";

export const GHOST_HZ = 20,
  GHOST_STRIDE = 24,
  MAX_LAP_SECONDS = 3600,
  MAX_GHOST_SAMPLES = MAX_LAP_SECONDS * GHOST_HZ + 2;
export interface GhostData {
  version: 1;
  identity: SessionIdentity;
  duration: number;
  stride: 24;
  samples: Float32Array;
}
export interface GhostPose {
  position: Vector3;
  rotation: Quaternion;
  lengths: number[];
  steers: number[];
  spins: number[];
}
export function packPose(
  t: VehicleTelemetry,
  time: number,
  distance: number,
): number[] {
  return [
    time,
    distance,
    t.position.x,
    t.position.y,
    t.position.z,
    t.rotation.x,
    t.rotation.y,
    t.rotation.z,
    t.rotation.w,
    ...t.wheels.map((w) => w.length),
    t.wheels[0].steer,
    t.wheels[1].steer,
    ...t.wheels.map((w) => w.spin),
    t.controls.throttle,
    t.controls.brake,
    t.controls.steer,
    t.controls.handbrake ?? 0,
    t.powertrain.gear,
  ];
}
function mixPose(
  a: number[],
  b: number[],
  alpha: number,
  time: number,
  distance?: number,
) {
  const values = a.map((v, i) => v + (b[i] - v) * alpha);
  const q = new Quaternion(a[5], a[6], a[7], a[8]).slerp(
    new Quaternion(b[5], b[6], b[7], b[8]),
    alpha,
  );
  values[0] = time;
  if (distance !== undefined) values[1] = distance;
  values[5] = q.x;
  values[6] = q.y;
  values[7] = q.z;
  values[8] = q.w;
  // Controls and the selected gear are held until the next captured input.
  for (let i = 19; i < GHOST_STRIDE; i++) values[i] = a[i];
  return values;
}
export class GhostRecorder {
  private buffer = new Float32Array(MAX_GHOST_SAMPLES * GHOST_STRIDE);
  private count = 0;
  private next = 0;
  private previous?: number[];
  reset(first: number[]) {
    this.count = 0;
    this.next = 1 / GHOST_HZ;
    this.previous = first.slice();
    this.append(first);
  }
  private append(sample: number[]) {
    if (this.count < MAX_GHOST_SAMPLES)
      this.buffer.set(sample, this.count++ * GHOST_STRIDE);
  }
  record(sample: number[]) {
    const previous = this.previous;
    if (!previous) {
      this.reset(sample);
      return;
    }
    const end = Math.min(MAX_LAP_SECONDS, sample[0]);
    while (this.next <= end + 1e-7) {
      const alpha = Math.max(
        0,
        Math.min(
          1,
          (this.next - previous[0]) / Math.max(1e-9, sample[0] - previous[0]),
        ),
      );
      this.append(mixPose(previous, sample, alpha, this.next));
      this.next += 1 / GHOST_HZ;
    }
    this.previous = sample;
  }
  finish(last: number[], identity: SessionIdentity): GhostData {
    this.record(last);
    const finalIndex = (this.count - 1) * GHOST_STRIDE;
    if (Math.abs(this.buffer[finalIndex] - last[0]) < 0.001)
      this.buffer.set(last, finalIndex);
    else this.append(last);
    return {
      version: 1,
      identity: { ...identity },
      stride: 24,
      duration: last[0],
      samples: this.buffer.slice(0, this.count * GHOST_STRIDE),
    };
  }
  get bytes() {
    return this.buffer.byteLength;
  }
}
export class GhostPlayer {
  readonly pose: GhostPose = {
    position: new Vector3(),
    rotation: new Quaternion(),
    lengths: [0, 0, 0, 0],
    steers: [0, 0],
    spins: [0, 0, 0, 0],
  };
  constructor(readonly data: GhostData) {}
  sample(time: number): GhostPose | null {
    if (time < 0 || time > this.data.duration) return null;
    const s = this.data.samples,
      n = s.length / GHOST_STRIDE;
    let lo = 0,
      hi = n - 1;
    while (lo + 1 < hi) {
      const m = (lo + hi) >> 1;
      if (s[m * 24] <= time) lo = m;
      else hi = m;
    }
    const a = lo * 24,
      b = hi * 24,
      alpha = Math.max(
        0,
        Math.min(1, (time - s[a]) / Math.max(1e-9, s[b] - s[a])),
      ),
      mix = (i: number) => s[a + i] + (s[b + i] - s[a + i]) * alpha;
    this.pose.position.set(mix(2), mix(3), mix(4));
    this.pose.rotation
      .set(s[a + 5], s[a + 6], s[a + 7], s[a + 8])
      .slerp(new Quaternion(s[b + 5], s[b + 6], s[b + 7], s[b + 8]), alpha);
    for (let i = 0; i < 4; i++) {
      this.pose.lengths[i] = mix(9 + i);
      this.pose.spins[i] = mix(15 + i);
    }
    this.pose.steers[0] = mix(13);
    this.pose.steers[1] = mix(14);
    return this.pose;
  }
  timeAtDistance(distance: number): number | null {
    const s = this.data.samples,
      n = s.length / 24;
    if (distance < 0 || distance > s[(n - 1) * 24 + 1]) return null;
    let lo = 0,
      hi = n - 1;
    while (lo + 1 < hi) {
      const m = (lo + hi) >> 1;
      if (s[m * 24 + 1] < distance) lo = m;
      else hi = m;
    }
    const a = lo * 24,
      b = hi * 24,
      t = (distance - s[a + 1]) / Math.max(1e-9, s[b + 1] - s[a + 1]);
    return s[a] + (s[b] - s[a]) * Math.max(0, Math.min(1, t));
  }
}
export function interpolatePose(
  a: VehicleTelemetry,
  b: VehicleTelemetry,
  alpha: number,
  time: number,
  distance: number,
) {
  return mixPose(
    packPose(a, time, 0),
    packPose(b, time, 0),
    alpha,
    time,
    distance,
  );
}
