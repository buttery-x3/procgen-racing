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
  private pitBounds?: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  constructor(
    circuit: CompiledCircuit,
    readonly identity: SessionIdentity,
    private completed: (lap: CompletedLap) => void = () => {},
    course?: TimingCourse,
  ) {
    this.course =
      course?.circuit === circuit ? course : new TimingCourse(circuit);
    const pit = circuit.definition.venue?.pit;
    if (pit)
      this.pitBounds = {
        minX: Math.min(...pit.points.map((p) => p.x)) - pit.width,
        maxX: Math.max(...pit.points.map((p) => p.x)) + pit.width,
        minZ: Math.min(...pit.points.map((p) => p.z)) - pit.width,
        maxZ: Math.max(...pit.points.map((p) => p.z)) + pit.width,
      };
  }
  private inPit(t: VehicleTelemetry) {
    const bounds = this.pitBounds,
      p = t.position,
      pit = this.course.circuit.definition.venue?.pit;
    if (
      !pit ||
      !bounds ||
      p.x < bounds.minX ||
      p.x > bounds.maxX ||
      p.z < bounds.minZ ||
      p.z > bounds.maxZ
    )
      return false;
    for (let i = 1; i < pit.points.length; i++) {
      const a = pit.points[i - 1],
        b = pit.points[i],
        dx = b.x - a.x,
        dz = b.z - a.z,
        u = Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * dx + (p.z - a.z) * dz) /
              Math.max(1e-9, dx * dx + dz * dz),
          ),
        );
      if (
        Math.hypot(p.x - a.x - dx * u, p.z - a.z - dz * u) < pit.width / 2 &&
        Math.abs(p.y - a.y - (b.y - a.y) * u) < 2.5
      )
        return true;
    }
    return false;
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
    const circuit = this.course.circuit,
      location = circuit.locate(t.position, { station: t.track?.station });
    const progress = this.course.progress(location.distance),
      forward = location.sample.forward;
    const along =
      t.velocity.x * forward.x +
      t.velocity.y * forward.y +
      t.velocity.z * forward.z;
    this.wrongWayTime = along < -2 ? this.wrongWayTime + dt : 0;
    // Merge triangles can overlap the racing surface. Pit limits start only once
    // the chassis centre is beyond the racing edge on the separate pit branch.
    const outside =
      location.lateral > location.sample.leftWidth + 0.1 ||
      location.lateral < -location.sample.rightWidth - 0.1;
    const pit =
      outside &&
      (t.track?.branchId === "pit" ||
        location.branchId === "pit" ||
        this.inPit(t));
    let onRoad = false;
    // The rule concerns the four tyre-centre projections, not a chassis box or
    // surface colour: tarmac run-off and the oval apron are outside the race road.
    for (const wheel of t.wheels) {
      const contact = wheel.grounded ? wheel.contact : wheel.hub;
      const loc = circuit.locate(contact, {
        station: location.station,
        branchId: "main",
      });
      if (
        loc.lateral <= loc.sample.leftWidth + 0.1 &&
        loc.lateral >= -loc.sample.rightWidth - 0.1
      ) {
        const dx = contact.x - loc.sample.position.x,
          dz = contact.z - loc.sample.position.z;
        if (
          Math.hypot(dx, dz) <
          Math.max(loc.sample.leftWidth, loc.sample.rightWidth) + 4
        )
          onRoad = true;
      }
    }
    const limit = circuit.definition.venue?.pit?.speedLimit ?? 60 / 3.6;
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
