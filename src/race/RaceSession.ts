import { trackContext } from "./TrackContext";
import type { VehicleTelemetry } from "../vehicle/types";
import type { CompiledCircuit } from "../track/SurfaceCompiler";
import type { SessionIdentity } from "./identity";
import { TimingCourse } from "./TimingCourse";
import {
  GhostPlayer,
  GhostRecorder,
  MAX_LAP_SECONDS,
  packPose,
  interpolatePose,
} from "./Ghost";
import type { GhostData } from "./Ghost";
import type {
  CompletedLap,
  LapResult,
  SessionMode,
  SessionSnapshot,
} from "./types";

/** Simulation-owned session state. Rendering, storage and vehicle ownership stay outside it. */
export class RaceSession {
  readonly course: TimingCourse;
  mode: SessionMode = "practice";
  best: LapResult | null = null;
  recent: LapResult[] = [];
  reference?: GhostPlayer;
  private bestReference?: GhostPlayer;
  imported = false;
  private previous?: VehicleTelemetry;
  private running = false;
  private startTime = 0;
  private nextGate = 1;
  private lap = 0;
  private reasons: string[] = [];
  private sectorTimes: number[] = [];
  private lastSectorTime = 0;
  private progress = 0;
  private peakProgress = 0;
  private wrongWayTime = 0;
  private pitSpeedTime = 0;
  private flag: "green" | "yellow" | "pit" = "green";
  private message = "Practice · cross the chequered line to start a lap.";
  private recorder?: GhostRecorder;
  constructor(
    circuit: CompiledCircuit,
    readonly identity: SessionIdentity,
    private completed: (lap: CompletedLap) => void = () => {},
    course?: TimingCourse,
  ) {
    this.course =
      course?.circuit === circuit ? course : new TimingCourse(circuit);
  }
  setReference(best: LapResult | null, ghost?: GhostData, imported = false) {
    if (best && best.identity.key !== this.identity.key)
      throw new Error(
        "This best lap belongs to a different circuit, car or setup.",
      );
    if (ghost && ghost.identity.key !== this.identity.key)
      throw new Error(
        "The ghost is incompatible with this circuit, car, setup, assists or physics.",
      );
    if (!imported) {
      this.best = best;
      if (ghost) this.bestReference = new GhostPlayer(ghost);
      else if (!best || this.bestReference?.data.duration !== best.duration)
        this.bestReference = undefined;
      this.reference = this.bestReference;
    } else this.reference = ghost ? new GhostPlayer(ghost) : undefined;
    this.imported = imported;
  }
  restart(
    mode: SessionMode,
    current: VehicleTelemetry,
    reason = "Session restarted",
  ) {
    this.abandon(reason);
    this.mode = mode;
    this.previous = current;
    this.running = false;
    this.reasons = [];
    this.sectorTimes = [];
    this.progress = 0;
    this.peakProgress = 0;
    this.wrongWayTime = 0;
    this.pitSpeedTime = 0;
    this.flag = "green";
    this.message =
      mode === "practice"
        ? "Practice · cross the chequered line to start a lap."
        : "Out-lap · cross the chequered line ahead to start the clock.";
  }
  invalidate(reason: string) {
    if (
      this.running &&
      !this.reasons.includes(reason) &&
      this.reasons.length < 12
    )
      this.reasons.push(reason);
    if (this.running)
      this.message = reason + " · finish this lap to start a clean one.";
  }
  abandon(reason: string) {
    if (this.running && this.previous) {
      this.invalidate(reason);
      const elapsed = this.previous.time - this.startTime;
      if (elapsed > 0.2) this.finish(elapsed, this.previous, false);
    }
    this.running = false;
  }
  private begin(
    a: VehicleTelemetry,
    b: VehicleTelemetry,
    alpha: number,
    time: number,
  ) {
    this.running = true;
    this.startTime = time;
    this.nextGate = 1;
    this.lap++;
    this.reasons = [];
    this.sectorTimes = [];
    this.lastSectorTime = time;
    this.progress = 0;
    this.peakProgress = 0;
    this.message =
      "Lap running · keep at least one tyre centre inside the white edge.";
    if (this.mode === "time-trial") {
      this.recorder ??= new GhostRecorder();
      this.recorder.reset(interpolatePose(a, b, alpha, 0, 0));
    }
  }
  private finish(
    duration: number,
    t: VehicleTelemetry,
    complete: boolean,
    pose?: number[],
  ) {
    const valid =
      complete &&
      this.reasons.length === 0 &&
      this.sectorTimes.length === 3 &&
      duration > 1;
    const result: LapResult = {
      id: `${Date.now().toString(36)}-${this.lap}`,
      lap: this.lap,
      duration,
      sectors: this.sectorTimes.slice(0, 3),
      valid,
      reasons: valid
        ? []
        : [...(this.reasons.length ? this.reasons : ["Incomplete lap"])],
      mode: this.mode,
      identity: { ...this.identity },
      finishedAt: new Date().toISOString(),
    };
    const personalBest =
      valid &&
      this.mode === "time-trial" &&
      (!this.best || duration < this.best.duration - 1e-6);
    let ghost: GhostData | undefined;
    if (personalBest && this.recorder) {
      ghost = this.recorder.finish(
        pose ?? packPose(t, duration, this.course.length),
        this.identity,
      );
      this.best = result;
      this.bestReference = new GhostPlayer(ghost);
      if (!this.imported) this.reference = this.bestReference;
    }
    this.recent = [result, ...this.recent].slice(0, 8);
    this.completed({ result, ghost, personalBest });
  }
  step(t: VehicleTelemetry) {
    const previous = this.previous;
    this.previous = t;
    if (!previous) return;
    const dt = t.time - previous.time,
      travel = Math.hypot(
        t.position.x - previous.position.x,
        t.position.y - previous.position.y,
        t.position.z - previous.position.z,
      );
    if (
      dt <= 0 ||
      dt > 0.05 ||
      travel > Math.max(8, (t.speed + previous.speed) * dt + 2)
    ) {
      this.invalidate("Vehicle reset or time discontinuity");
      this.abandon("Vehicle reset or time discontinuity");
      this.message = "Out-lap · cross the line after the reset.";
      return;
    }
    const circuit = this.course.circuit;
    const { location, pit, onRoad, limit } = trackContext(circuit, t);
    const progress = this.course.progress(location.distance),
      forward = location.sample.forward;
    const along =
      t.velocity.x * forward.x +
      t.velocity.y * forward.y +
      t.velocity.z * forward.z;
    this.wrongWayTime = along < -2 ? this.wrongWayTime + dt : 0;
    this.pitSpeedTime = pit && t.speed > limit + 1 ? this.pitSpeedTime + dt : 0;
    if (!onRoad && !pit)
      this.invalidate("Track limits · all four tyres outside the white edge");
    if (pit) this.invalidate("Pit lane used · out-lap required");
    if (this.wrongWayTime > 0.4) this.invalidate("Wrong direction");
    if (this.pitSpeedTime > 0.2) this.invalidate("Pit speed limit exceeded");
    this.flag = pit
      ? "pit"
      : !onRoad || this.wrongWayTime > 0.2
        ? "yellow"
        : "green";
    if (pit)
      this.message =
        t.speed > limit + 1
          ? `Pit overspeed · limit ${Math.round(limit * 3.6)} km/h`
          : `Pit lane · ${Math.round(limit * 3.6)} km/h maximum`;
    else if (!onRoad)
      this.message = "Off circuit · slow down and rejoin safely.";
    else if (this.wrongWayTime > 0.2)
      this.message = "Wrong way · turn around safely.";
    else if (this.running)
      this.message = this.reasons.length
        ? `${this.reasons[0]} · finish this lap to start a clean one.`
        : "Lap running · keep at least one tyre centre inside the white edge.";
    if (this.running) {
      let advance = progress - this.progress;
      if (advance < -this.course.length / 2) advance += this.course.length;
      if (advance > this.course.length / 2) advance -= this.course.length;
      if (Math.abs(advance) > Math.max(12, travel * 2 + 3))
        this.invalidate("Progress discontinuity or skipped road section");
    }
    for (const crossing of this.course.crossings(
      previous.position,
      t.position,
    )) {
      const time = previous.time + dt * crossing.alpha,
        gate = crossing.gate;
      if (!crossing.forward) {
        this.invalidate("Reverse timing-gate crossing");
        continue;
      }
      if (pit || !onRoad) continue;
      if (!this.running) {
        if (gate.index === 0) this.begin(previous, t, crossing.alpha, time);
        continue;
      }
      if (gate.index !== this.nextGate)
        this.invalidate("Skipped or out-of-order checkpoint");
      if (gate.index === 0) {
        this.sectorTimes.push(time - this.lastSectorTime);
        const duration = time - this.startTime;
        this.finish(
          duration,
          t,
          true,
          interpolatePose(
            previous,
            t,
            crossing.alpha,
            duration,
            this.course.length,
          ),
        );
        this.begin(previous, t, crossing.alpha, time);
      } else {
        this.nextGate = (gate.index + 1) % this.course.gates.length;
        if (gate.sector !== null) {
          this.sectorTimes.push(time - this.lastSectorTime);
          this.lastSectorTime = time;
        }
      }
    }
    this.progress = progress;
    if (this.running) {
      this.peakProgress = Math.max(this.peakProgress, progress);
      const elapsed = t.time - this.startTime;
      if (elapsed > MAX_LAP_SECONDS)
        this.invalidate("Lap exceeds the 60 minute recording limit");
      if (this.mode === "time-trial" && elapsed <= MAX_LAP_SECONDS)
        this.recorder?.record(packPose(t, elapsed, this.peakProgress));
    }
  }
  snapshot(): SessionSnapshot {
    const elapsed =
      this.running && this.previous
        ? Math.max(0, this.previous.time - this.startTime)
        : 0;
    const referenceTime = this.reference?.timeAtDistance(this.progress);
    return {
      mode: this.mode,
      state: this.running
        ? this.reasons.length
          ? "invalid"
          : "running"
        : "out-lap",
      lap: this.lap,
      elapsed,
      sectors: [...this.sectorTimes],
      nextSector: Math.min(3, this.sectorTimes.length + 1),
      progress: this.progress,
      delta:
        this.running && referenceTime != null ? elapsed - referenceTime : null,
      reasons: [...this.reasons],
      flag: this.flag,
      message: this.message,
      best: this.best,
      recent: this.recent,
      identity: this.identity,
      imported: this.imported,
      referenceAvailable: !!this.reference,
    };
  }
  ghostPose(alpha = 1) {
    if (!this.running || !this.previous || !this.reference) return null;
    return this.reference.sample(
      Math.max(0, this.previous.time - this.startTime - (1 - alpha) / 120),
    );
  }
  get recordingBytes() {
    return this.recorder?.bytes ?? 0;
  }
}
