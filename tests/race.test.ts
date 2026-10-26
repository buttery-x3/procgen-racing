import { beforeAll, describe, expect, it } from "vitest";
import {
  Vector3,
  Quaternion,
  Group,
  Mesh,
  BoxGeometry,
  MeshBasicMaterial,
} from "three";
import { getTestCircuit } from "../src/track/testCircuit";
import { roadPoint } from "../src/track/SurfaceCompiler";
import { TimingCourse } from "../src/race/TimingCourse";
import { RaceSession } from "../src/race/RaceSession";
import { checksum, sessionIdentity } from "../src/race/identity";
import {
  GhostPlayer,
  MAX_GHOST_SAMPLES,
  GHOST_STRIDE,
} from "../src/race/Ghost";
import type { GhostData } from "../src/race/Ghost";
import type { CompletedLap } from "../src/race/types";
import type { VehicleTelemetry } from "../src/vehicle/types";
import { REFERENCE_CARS } from "../src/vehicle/referenceCars";
import {
  decodeSession,
  exportSession,
  mergeLap,
  upsertCircuit,
  exportCircuitLibrary,
  decodeCircuitLibrary,
  validateGhost,
  checkLibrary,
} from "../src/storage/SoloStorage";
import { generateVenueCircuit } from "../src/track/venue/constructVenue";
import { DEFAULT_FAMILY_RECIPE } from "../src/track/families/types";
import { DEFAULT_VENUE } from "../src/track/venue/types";
import { circuitArchive } from "../src/storage/CircuitStorage";
import { safeCamera } from "../src/rendering/CameraSafety";
import { drivingFeedback } from "../src/audio/feedback";
import { DrivingEffects } from "../src/rendering/DrivingEffects";
import { GhostView } from "../src/rendering/GhostView";
import { resolveCar } from "../src/vehicle/CarDefinition";

const circuit = getTestCircuit(),
  course = new TimingCourse(circuit),
  setup = REFERENCE_CARS.fr.setup;
const identity = sessionIdentity(circuit, setup, "test-physics-1");
let clean: CompletedLap, archive: ReturnType<typeof circuitArchive>;
const wrap = (v: number, n: number) => ((v % n) + n) % n;
function telemetry(
  time: number,
  progress: number,
  lateral = 0,
): VehicleTelemetry {
  const distance = wrap(course.finishDistance + progress, course.length),
    station = course.stationAt(distance),
    f = circuit.frame(station, lateral),
    position = f.position.clone().addScaledVector(f.normal, 0.6);
  const wheels = (["fl", "fr", "rl", "rr"] as const).map((id, i) => {
    const sample = circuit.alignment.sample(station + (i < 2 ? 1.3 : -1.3)),
      contact = roadPoint(sample, lateral + (i % 2 === 0 ? 0.8 : -0.8)),
      hub = contact.clone().addScaledVector(f.normal, 0.32);
    return {
      id,
      grounded: true,
      length: 0.35,
      compression: 0.08,
      compressionRatio: 0.3,
      load: 3000,
      lateralSpeed: 0,
      longitudinalSpeed: 30,
      slipAngle: 0,
      steer: 0,
      spin: time * 70,
      angularSpeed: 70,
      slipRatio: 0,
      longitudinalForce: 0,
      lateralForce: 0,
      driveTorque: 0,
      brakeTorque: 0,
      surfaceGrip: 1,
      surface: "asphalt" as const,
      absActive: false,
      tractionActive: false,
      mount: position,
      hub,
      contact,
      normal: f.normal,
    };
  });
  return {
    time,
    position,
    rotation: f.rotation,
    velocity: f.forward.clone().multiplyScalar(30),
    speed: 30,
    pitch: 0,
    roll: 0,
    worldPitch: 0,
    worldRoll: 0,
    roadPitch: 0,
    roadRoll: 0,
    roadReferenceValid: true,
    groundedCount: 4,
    totalLoad: 12000,
    frontLoadFraction: 0.5,
    wheels,
    controls: { throttle: 0.3, brake: 0, steer: 0 },
    powertrain: {
      rpm: 4000,
      gear: 3,
      ratio: 4,
      engineTorque: 100,
      clutchTorque: 100,
      shifting: false,
    },
    assists: {
      traction: 0,
      abs: 0,
      stability: 0,
      countersteer: 0,
      hold: false,
    },
    track: {
      station,
      distance,
      length: circuit.length,
      lapDistance: circuit.distance,
      lateral,
      grade: 0,
      bank: 0,
      width: 14,
      section: "fixture",
    },
  };
}
function drive(
  options: {
    hook?: (s: RaceSession, t: VehicleTelemetry, p: number) => void;
    lateral?: (p: number) => number;
    mode?: "practice" | "time-trial";
  } = {},
) {
  const laps: CompletedLap[] = [],
    session = new RaceSession(circuit, identity, (l) => laps.push(l));
  const speed = 30,
    dt = 1 / 120;
  let time = 0,
    progress = -10;
  session.restart(options.mode ?? "time-trial", telemetry(time, progress));
  while (progress < course.length + 3) {
    time += dt;
    progress += speed * dt;
    const t = telemetry(time, progress, options.lateral?.(progress) ?? 0);
    options.hook?.(session, t, progress);
    session.step(t);
  }
  return { session, laps };
}
beforeAll(() => {
  clean = drive().laps[0];
  archive = circuitArchive(
    generateVenueCircuit(
      {
        ...DEFAULT_FAMILY_RECIPE,
        family: "oval",
        seed: "m8-library-fixture",
        targetLength: 800,
      },
      DEFAULT_VENUE,
    ),
  );
}, 30000);
describe("M8 timing, directional gates and lap validity", () => {
  it("times a complete elevated lap from interpolated crossings with three sectors", () => {
    expect(clean.result.valid).toBe(true);
    expect(clean.personalBest).toBe(true);
    expect(clean.result.sectors).toHaveLength(3);
    expect(clean.result.sectors.reduce((a, b) => a + b, 0)).toBeCloseTo(
      clean.result.duration,
      8,
    );
    expect(clean.result.duration).toBeCloseTo(course.length / 30, 2);
    expect(clean.ghost).toBeDefined();
  });
  it("uses road-width and 3D gate bounds and preserves crossing direction", () => {
    const gate = course.gates[0],
      a = gate.position.clone().addScaledVector(gate.forward, -2),
      b = gate.position.clone().addScaledVector(gate.forward, 3);
    const hits = course.crossings(a, b);
    expect(hits[0].alpha).toBeCloseTo(0.4, 7);
    expect(hits[0].forward).toBe(true);
    expect(course.crossings(b, a)[0].forward).toBe(false);
    expect(
      course.crossings(
        a.clone().addScaledVector(gate.up, 6),
        b.clone().addScaledVector(gate.up, 6),
      ),
    ).toHaveLength(0);
    expect(
      course.crossings(
        a.clone().addScaledVector(gate.left, gate.leftWidth + 8),
        b.clone().addScaledVector(gate.left, gate.leftWidth + 8),
      ),
    ).toHaveLength(0);
  });
  it.each([
    "Session paused",
    "Window focus lost",
    "Car or setup changed",
    "Test impulse used",
  ])("cannot earn a false valid lap after %s", (reason) => {
    let applied = false;
    const { laps } = drive({
      hook: (s, _t, p) => {
        if (!applied && p > course.length * 0.4) {
          s.invalidate(reason);
          applied = true;
        }
      },
    });
    expect(laps[0].result.valid).toBe(false);
    expect(laps[0].result.reasons).toContain(reason);
    expect(laps[0].ghost).toBeUndefined();
  });
  it("rejects cuts across run-off and missing checkpoints", () => {
    const { laps } = drive({
      lateral: (p) =>
        18 *
        Math.max(
          0,
          Math.min(
            1,
            (p - course.length * 0.3) / 30,
            (course.length * 0.5 - p) / 30,
          ),
        ),
    });
    expect(laps[0].result.valid).toBe(false);
    expect(laps[0].result.reasons.some((r) => r.includes("Track limits"))).toBe(
      true,
    );
    expect(laps[0].result.reasons.some((r) => r.includes("checkpoint"))).toBe(
      true,
    );
  });
  it("does not promote practice laps to personal bests", () => {
    const { laps, session } = drive({ mode: "practice" });
    expect(laps[0].result.valid).toBe(true);
    expect(laps[0].personalBest).toBe(false);
    expect(session.best).toBeNull();
    expect(laps[0].ghost).toBeUndefined();
  });
  it("does not enforce pit rules on shared merge pavement inside the racing edge", () => {
    const { laps } = drive({
      hook: (_s, t, p) => {
        if (p > course.length * 0.2 && p < course.length * 0.4)
          t.track!.branchId = "pit";
      },
    });
    expect(laps[0].result.valid).toBe(true);
    expect(laps[0].result.reasons).toEqual([]);
  });
  it("enforces pit use and overspeed after the car leaves the racing edge", () => {
    const s = new RaceSession(circuit, identity);
    s.restart("time-trial", telemetry(0, -1));
    s.step(telemetry(1 / 120, 1));
    for (let i = 2; i < 90; i++) {
      const t = telemetry(i / 120, 1 + i * 0.25, Math.min(18, i * 0.4));
      t.track!.branchId = "pit";
      s.step(t);
    }
    expect(s.snapshot().flag).toBe("pit");
    expect(s.snapshot().reasons.some((r) => r.startsWith("Pit lane"))).toBe(
      true,
    );
    expect(s.snapshot().reasons).toContain("Pit speed limit exceeded");
  });
  it("abandons teleports and reset simulation clocks instead of crediting the finish", () => {
    const s = new RaceSession(circuit, identity);
    s.restart("time-trial", telemetry(0, -1));
    s.step(telemetry(1 / 120, 1));
    s.step(telemetry(2 / 120, course.length * 0.6));
    expect(s.snapshot().state).toBe("out-lap");
    expect(s.best).toBeNull();
    s.step(telemetry(0, 0));
    expect(s.best).toBeNull();
  });
  it("invalidates a reverse finish crossing and starts a clean following lap", () => {
    const s = new RaceSession(circuit, identity);
    s.restart("time-trial", telemetry(0, -1));
    s.step(telemetry(1 / 120, 1));
    s.step(telemetry(2 / 120, -1));
    expect(s.snapshot().reasons).toContain("Reverse timing-gate crossing");
    expect(s.best).toBeNull();
  });
});
describe("M8 keyed results, durable ghosts and bounded libraries", () => {
  it("separates car, tune, assist, physics and circuit compatibility", () => {
    for (const next of [
      REFERENCE_CARS.ff.setup,
      { ...setup, grip: setup.grip + 0.1 },
      { ...setup, tractionControl: 0 },
    ])
      expect(sessionIdentity(circuit, next, "test-physics-1").key).not.toBe(
        identity.key,
      );
    expect(sessionIdentity(circuit, setup, "test-physics-2").key).not.toBe(
      identity.key,
    );
    const changed = {
      ...circuit,
      definition: {
        ...circuit.definition,
        leftWidth: [
          { at: 0, value: 10 },
          { at: 1, value: 10 },
        ],
      },
    };
    expect(sessionIdentity(changed, setup, "test-physics-1").key).not.toBe(
      identity.key,
    );
    expect(checksum({ b: 2, a: 1 })).toBe(checksum({ a: 1, b: 2 }));
  });
  it("captures complete bounded poses/controls and interpolates playback without a physics replay", () => {
    const ghost = validateGhost(clean.ghost!, identity),
      player = new GhostPlayer(ghost),
      pose = player.sample(ghost.duration * 0.3)!;
    expect(ghost.samples.length).toBeLessThanOrEqual(
      MAX_GHOST_SAMPLES * GHOST_STRIDE,
    );
    expect(pose.position.length()).toBeGreaterThan(10);
    expect(pose.rotation.length()).toBeCloseTo(1, 5);
    expect(pose.lengths).toHaveLength(4);
    expect(player.sample(-1)).toBeNull();
    expect(player.sample(ghost.duration + 1)).toBeNull();
    expect(player.timeAtDistance(course.length * 0.5)).toBeCloseTo(
      ghost.duration * 0.5,
      1,
    );
    expect(ghost.samples[19]).toBeCloseTo(0.3, 6);
    expect(ghost.samples[23]).toBe(3);
  });
  it("round-trips a checksummed ghost but cannot merge incompatible results", () => {
    const record = mergeLap(undefined, clean, "Proving", "FR"),
      raw = exportSession(record, clean.ghost),
      decoded = decodeSession(raw, identity);
    expect(decoded.ghost.samples).toEqual(clean.ghost!.samples);
    expect(decoded.record.best?.duration).toBe(clean.result.duration);
    const other = sessionIdentity(
      circuit,
      REFERENCE_CARS.ff.setup,
      "test-physics-1",
    );
    expect(() => decodeSession(raw, other)).toThrow(/different/);
    const broken = JSON.parse(raw);
    broken.record.best.duration = 1;
    expect(() => decodeSession(JSON.stringify(broken), identity)).toThrow(
      /checksum/,
    );
    expect(() =>
      mergeLap({ ...record, identity: other }, clean, "x", "y"),
    ).toThrow(/incompatible/);
  });
  it("rejects malformed ghost poses, gaps and non-monotonic progress", () => {
    for (const modify of [
      (g: GhostData) => {
        g.samples[24] = 0;
      },
      (g: GhostData) => {
        g.samples[5] = NaN;
      },
      (g: GhostData) => {
        g.samples[25] = -1;
      },
      (g: GhostData) => {
        g.samples[9] = 20;
      },
    ]) {
      const g = { ...clean.ghost!, samples: clean.ghost!.samples.slice() };
      modify(g);
      expect(() => validateGhost(g, identity)).toThrow();
    }
  });
  it("retains an earned best when a slower or invalid lap is saved", () => {
    const record = mergeLap(undefined, clean, "Proving", "FR"),
      invalid = {
        ...clean,
        result: {
          ...clean.result,
          id: "invalid",
          valid: false,
          reasons: ["Track limits"],
          duration: 3,
          sectors: [],
        },
        ghost: undefined,
        personalBest: false,
      };
    const next = mergeLap(record, invalid, "Proving", "FR");
    expect(next.best).toEqual(record.best);
    expect(next.recent[0].valid).toBe(false);
  });
  it("saves, deduplicates and exports accepted circuits with recoverable removal", () => {
    let entries = upsertCircuit([], archive, "My oval", 800);
    entries[0].favourite = true;
    entries = upsertCircuit(entries, archive, "Renamed", 800);
    expect(entries).toHaveLength(1);
    expect(entries[0].favourite).toBe(true);
    expect(
      JSON.stringify(
        decodeCircuitLibrary(exportCircuitLibrary(entries))[0].archive
          .definition,
      ),
    ).toEqual(JSON.stringify(archive.definition));
    entries[0].trashed = true;
    checkLibrary(entries);
    expect(entries[0].archive.definitionHash).toBe(archive.definitionHash);
    entries = upsertCircuit(entries, archive, "Restored", 800);
    expect(entries[0].trashed).toBe(false);
    const full = Array.from({ length: 25 }, (_, i) => ({
      ...entries[0],
      id: `entry-${i}`,
    }));
    expect(() => checkLibrary(full)).toThrow(/24/);
    const bad = JSON.parse(exportCircuitLibrary(entries));
    bad.entries[0].archive.definitionHash = "wrong";
    expect(() => decodeCircuitLibrary(JSON.stringify(bad))).toThrow(/checksum/);
  });
});
describe("M8 bounded presentation feedback", () => {
  it("shortens an obstructed camera boom and keeps it above terrain", () => {
    let calls = 0;
    const position = safeCamera(
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 3, z: -8 },
      () => (++calls === 1 ? 3 : 2),
    );
    expect(position.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(6);
    expect(position.y).toBeGreaterThan(3);
  });
  it("uses contact slip power for scrub and bounded impact/load audio", () => {
    const t = telemetry(1, 20),
      normal = drivingFeedback(t);
    t.wheels[0].longitudinalForce = 3000;
    t.wheels[0].slipRatio = 0.8;
    expect(drivingFeedback(t).scrub).toBeGreaterThan(normal.scrub);
    t.wheels[0].grounded = false;
    expect(drivingFeedback(t).scrub).toBe(0);
    const next = { ...t, time: 1.01, velocity: { x: 0, y: 0, z: 0 } };
    expect(drivingFeedback(next, t).impact).toBeLessThanOrEqual(1);
    expect(drivingFeedback(next, t).impact).toBeGreaterThan(0);
  });
  it("bounds effect pools and ghost rendering creates no collision object", () => {
    const effects = new DrivingEffects();
    expect(effects.capacity).toEqual({ marks: 1800, particles: 80 });
    const source = new Group();
    source.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
    for (let i = 0; i < 4; i++) {
      const wheel = new Group(),
        spinner = new Group();
      wheel.name = `wheel-${i}`;
      spinner.name = `spinner-${i}`;
      wheel.add(spinner);
      source.add(wheel);
    }
    const ghost = new GhostView();
    ghost.build(source, resolveCar(setup));
    ghost.update({
      position: new Vector3(1, 2, 3),
      rotation: new Quaternion(),
      lengths: [0.3, 0.3, 0.3, 0.3],
      steers: [0.1, 0.1],
      spins: [1, 1, 1, 1],
    });
    expect(ghost.group.position.x).toBe(1);
    expect(ghost.group.visible).toBe(true);
    ghost.update(null);
    expect(ghost.group.visible).toBe(false);
    ghost.dispose();
    effects.dispose();
    source.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        (o.material as MeshBasicMaterial).dispose();
      }
    });
  });
});
