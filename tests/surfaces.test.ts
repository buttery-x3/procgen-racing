import { afterEach, beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { initializePhysics, SuspensionRig } from "../src/physics/SuspensionRig";
import { compileCircuit, roadPoint } from "../src/track/SurfaceCompiler";
import { AUTHORED_CIRCUIT } from "../src/track/authoredCircuit";
import { getTestCircuit } from "../src/track/testCircuit";
import { SURFACES } from "../src/track/types";
import { REFERENCE_CARS } from "../src/vehicle/referenceCars";
import { WHEEL_RADIUS } from "../src/vehicle/types";
import type { VehicleSetup } from "../src/vehicle/types";

const circuit = getTestCircuit();
const rigs: SuspensionRig[] = [];
beforeAll(initializePhysics);
afterEach(() => rigs.splice(0).forEach((r) => r.dispose()));
function rig(start = "start", setup?: VehicleSetup) {
  const r = new SuspensionRig(setup);
  rigs.push(r);
  r.setCircuitStart(start);
  for (let i = 0; i < 480; i++) r.step();
  return r;
}
function follow(r: SuspensionRig, target = 11, lateral = 0) {
  const t = r.telemetry,
    station = t.track!.station,
    lookahead = 6 + t.speed * 0.4;
  const aim = circuit
    .frame(station + lookahead, lateral)
    .position.sub(new Vector3().copy(t.position));
  const q = new Quaternion().copy(t.rotation);
  const forward = new Vector3(0, 0, 1).applyQuaternion(q),
    right = new Vector3(-1, 0, 0).applyQuaternion(q);
  const angle = Math.atan2(aim.dot(right), aim.dot(forward));
  const steer =
    (Math.atan2(2 * r.setup.wheelbase * Math.sin(angle), lookahead) /
      r.setup.steeringLimit) *
    (1 + (r.setup.speedSteering * t.speed) / 18);
  r.step({
    throttle: Math.max(0, Math.min(1, (target - t.speed) * 0.5)),
    brake: Math.max(0, Math.min(1, (t.speed - target) * 0.4)),
    steer: Math.max(-1, Math.min(1, steer)),
  });
}

describe("3D surface compilation", () => {
  it("closes position, tangent, width, elevation and banking continuously", () => {
    const first = circuit.alignment.sample(0),
      end = circuit.alignment.sample(circuit.length - 0.0001);
    expect(
      new Vector3().copy(first.position).distanceTo(end.position),
    ).toBeLessThan(0.00011);
    expect(
      new Vector3().copy(first.forward).distanceTo(end.forward),
    ).toBeLessThan(0.00001);
    expect(end.leftWidth).toBeCloseTo(first.leftWidth, 6);
    expect(end.bank).toBeCloseTo(first.bank, 6);
    expect(circuit.rows.at(-1)!.position).toEqual(circuit.rows[0].position);
    expect(circuit.distance).toBeGreaterThan(circuit.length);
  });
  it("compiles finite, upward-facing triangles with one material and paint ID per face", () => {
    const materials = new Set<string>();
    for (const chunk of circuit.chunks) {
      expect(chunk.surfaces.length).toBe(chunk.indices.length / 3);
      expect(chunk.colors.length).toBe(chunk.surfaces.length);
      expect(Array.from(chunk.vertices).every(Number.isFinite)).toBe(true);
      for (let i = 0; i < chunk.indices.length; i += 3) {
        const vertex = (j: number) =>
          new Vector3().fromArray(chunk.vertices, chunk.indices[i + j] * 3);
        const a = vertex(0),
          normal = vertex(1).sub(a).cross(vertex(2).sub(a));
        if (normal.y <= 0)
          throw new Error(`Inverted/degenerate triangle ${i / 3}`);
      }
      chunk.surfaces.forEach((s) => materials.add(s));
    }
    expect([...materials].sort()).toEqual(Object.keys(SURFACES).sort());
  });
  it("adapts sampling while retaining varying width, useful elevation and beneficial banking", () => {
    const widths = circuit.rows.map((r) => r.leftWidth + r.rightWidth),
      heights = circuit.rows.map((r) => r.position.y);
    expect(Math.max(...widths)).toBeCloseTo(15, 2);
    expect(Math.min(...widths)).toBeLessThan(9.6);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(7);
    const lengths = circuit.rows
      .slice(1)
      .map((r, i) => r.station - circuit.rows[i].station);
    expect(Math.min(...lengths)).toBeLessThan(Math.max(...lengths) * 0.75);
    expect(
      Math.max(...circuit.rows.map((r) => Math.abs(r.bank))),
    ).toBeGreaterThan(0.1);
    expect(circuit.rows.every((r) => r.bank * r.curvature <= 0.000001)).toBe(
      true,
    );
    expect(
      circuit.rows
        .filter((r) => Math.abs(r.curvature) < 0.002)
        .every((r) => Math.abs(r.bank) < 0.00001),
    ).toBe(true);
  });
  it("rejects open profiles and road offsets which fold through a tight corner", () => {
    const open = structuredClone(AUTHORED_CIRCUIT);
    open.elevation.at(-1)!.value = 2;
    expect(() => compileCircuit(open)).toThrow(/Profiles must close/);
    const folded = structuredClone(AUTHORED_CIRCUIT);
    folded.leftWidth.forEach((k) => (k.value = 40));
    folded.rightWidth.forEach((k) => (k.value = 40));
    expect(() => compileCircuit(folded)).toThrow(/Offset road edge/);
  });
  it("compiles the opposite circuit direction with the infield on the other side", () => {
    const reversed = structuredClone(AUTHORED_CIRCUIT);
    reversed.controlPoints.reverse();
    const result = compileCircuit(reversed);
    expect(result.length).toBeCloseTo(circuit.length, 4);
    expect(
      result.chunks.every((c) => c.surfaces.length === c.indices.length / 3),
    ).toBe(true);
    expect(result.rows.some((r) => r.curvature < -0.02)).toBe(true);
  });
});

describe("compiled mesh wheel contacts", () => {
  it("agrees with the designed road through every row, chunk join and closing seam", () => {
    const r = rig();
    let maxHeightError = 0;
    const stations = [
      ...circuit.rows.map((row) => row.station),
      ...circuit.rows
        .slice(1)
        .map((row, i) => (row.station + circuit.rows[i].station) / 2),
      -0.02,
      0.02,
      circuit.length - 0.02,
    ];
    for (const station of stations)
      for (const lateral of [-1, 1]) {
        const point = roadPoint(circuit.alignment.sample(station), lateral);
        const hit = r.world.castRayAndGetNormal(
          new RAPIER.Ray(
            { x: point.x, y: point.y + 3, z: point.z },
            { x: 0, y: -1, z: 0 },
          ),
          5,
          true,
          undefined,
          undefined,
          undefined,
          r.body,
        );
        expect(hit).not.toBeNull();
        expect(r.circuitPhysics!.surface(hit!)).toBe("asphalt");
        expect(hit!.normal.y).toBeGreaterThan(0.95);
        maxHeightError = Math.max(
          maxHeightError,
          Math.abs(3 - hit!.timeOfImpact),
        );
      }
    expect(maxHeightError).toBeLessThan(0.015);
  });
  it.each(["climb", "bank", "compound"])(
    "supports a stationary car on %s with valid road-relative attitude",
    (start) => {
      const r = rig(start),
        t = r.telemetry;
      expect(t.groundedCount).toBe(4);
      expect(t.roadReferenceValid).toBe(true);
      expect(t.totalLoad / (r.setup.mass * 9.81)).toBeGreaterThan(0.95);
      expect(t.speed).toBeLessThan(0.03);
      expect(Math.abs(t.pitch)).toBeLessThan(1.6);
      expect(Math.abs(t.roll)).toBeLessThan(1.6);
      if (start === "climb") expect(t.worldPitch).toBeGreaterThan(4);
      if (start === "bank") expect(Math.abs(t.worldRoll)).toBeGreaterThan(5);
    },
  );
  it("keeps crowned-road brake hold stable instead of alternating wheel loads", () => {
    const r = rig();
    for (let i = 0; i < 480; i++) r.step();
    const positions: Vector3[] = [],
      loads: number[] = [];
    for (let i = 0; i < 240; i++) {
      r.step();
      positions.push(new Vector3().copy(r.telemetry.position));
      loads.push(r.telemetry.wheels[0].load);
    }
    expect(
      Math.max(...positions.map((p) => p.distanceTo(positions[0]))),
    ).toBeLessThan(0.0001);
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThan(1);
  });
  it("gives the left wheels raised kerb contacts independently of the right wheels", () => {
    const r = rig("kerb");
    expect(r.telemetry.wheels.map((w) => w.surface)).toEqual([
      "kerb",
      "asphalt",
      "kerb",
      "asphalt",
    ]);
    for (const i of [0, 2]) {
      const wheel = r.telemetry.wheels[i],
        location = circuit.locate(wheel.contact);
      const base = roadPoint(
        { ...location.sample, kerbLeft: 0, kerbRight: 0 },
        location.lateral,
      );
      expect(wheel.contact.y - base.y).toBeGreaterThan(0.025);
      expect(wheel.contact.y - base.y).toBeLessThan(0.07);
    }
  });
  it.each(["ff", "fr", "mr", "awd"] as const)(
    "assigns asphalt/gravel grip to the actual %s wheel contacts",
    (id) => {
      const r = rig("mixed", REFERENCE_CARS[id].setup);
      expect(r.telemetry.wheels.map((w) => w.surface)).toEqual([
        "asphalt",
        "gravel",
        "asphalt",
        "gravel",
      ]);
      expect(r.telemetry.wheels.map((w) => w.surfaceGrip)).toEqual([
        1, 0.48, 1, 0.48,
      ]);
    },
  );
  it("lets sand resistance slow a coasting car more than asphalt", () => {
    const road = rig(),
      sand = rig("sand");
    for (const r of [road, sand]) {
      r.powertrain.requestGear(0, 0);
      const forward = new Vector3(0, 0, 1).applyQuaternion(
        new Quaternion().copy(r.telemetry.rotation),
      );
      r.body.setLinvel(forward.multiplyScalar(10), true);
      r.tyres.forEach((t) => (t.omega = 10 / WHEEL_RADIUS));
      for (let i = 0; i < 60; i++) r.step();
    }
    expect(sand.telemetry.wheels.every((w) => w.surface === "sand")).toBe(true);
    expect(sand.telemetry.speed).toBeLessThan(road.telemetry.speed - 0.2);
  });
  it("restores the selected circuit start after a drop, car rebuild and experiment switch", () => {
    const r = rig("bank");
    const expected = new Vector3().copy(r.telemetry.position);
    r.drop();
    for (let i = 0; i < 480; i++) r.step();
    expect(
      new Vector3().copy(r.telemetry.position).distanceTo(expected),
    ).toBeLessThan(0.1);
    r.updateSetup(REFERENCE_CARS.awd.setup, true);
    for (let i = 0; i < 480; i++) r.step();
    expect(r.telemetry.groundedCount).toBe(4);
    expect(r.circuitStart).toBe("bank");
    r.setExperiment("level");
    for (let i = 0; i < 480; i++) r.step();
    expect(r.telemetry.position.y).toBeLessThan(1);
    expect(r.telemetry.track).toBeUndefined();
    r.setExperiment("circuit");
    for (let i = 0; i < 480; i++) r.step();
    expect(r.telemetry.position.y).toBeGreaterThan(8);
    expect(r.telemetry.groundedCount).toBe(4);
  });
});

describe("four-wheel driving validation", () => {
  it.each(["ff", "fr", "mr", "awd"] as const)(
    "drives a full %s lap through hills, banking and the seam",
    (id) => {
      const r = rig("start", REFERENCE_CARS[id].setup);
      let progress = 0,
        previous = r.telemetry.track!.station,
        maxLateral = 0,
        minContacts = 4,
        peakLoad = 0,
        maxPitch = 0,
        maxRoll = 0;
      for (
        let step = 0;
        step < 14000 && progress < circuit.length + 5;
        step++
      ) {
        follow(r);
        const t = r.telemetry,
          next = t.track!.station;
        let delta = next - previous;
        if (delta < -circuit.length / 2) delta += circuit.length;
        if (delta > circuit.length / 2) delta -= circuit.length;
        progress += delta;
        previous = next;
        maxLateral = Math.max(maxLateral, Math.abs(t.track!.lateral));
        minContacts = Math.min(minContacts, t.groundedCount);
        peakLoad = Math.max(peakLoad, t.totalLoad / (r.setup.mass * 9.81));
        maxPitch = Math.max(maxPitch, Math.abs(t.worldPitch));
        maxRoll = Math.max(maxRoll, Math.abs(t.worldRoll));
        if (maxLateral > 5) break;
      }
      expect(progress).toBeGreaterThan(circuit.length);
      expect(maxLateral).toBeLessThan(0.7);
      expect(minContacts).toBe(4);
      expect(peakLoad).toBeLessThan(1.5);
      expect(maxPitch).toBeGreaterThan(6);
      expect(maxRoll).toBeGreaterThan(5);
    },
    15000,
  );
  it.each([8, 20])(
    "rides the kerb and its taper at %i m/s without missed contacts or impact spikes",
    (speed) => {
      const r = rig("kerb");
      let minContacts = 4,
        peakLoad = 0,
        kerbContacts = 0;
      const forward = new Vector3(0, 0, 1).applyQuaternion(
        new Quaternion().copy(r.telemetry.rotation),
      );
      r.body.setLinvel(forward.multiplyScalar(speed), true);
      r.tyres.forEach((t) => (t.omega = speed / WHEEL_RADIUS));
      for (let i = 0; i < 720; i++) {
        const sample = circuit.alignment.sample(r.telemetry.track!.station);
        follow(r, speed, sample.leftWidth + 0.4 - r.setup.trackWidth / 2);
        minContacts = Math.min(minContacts, r.telemetry.groundedCount);
        peakLoad = Math.max(
          peakLoad,
          r.telemetry.totalLoad / (r.setup.mass * 9.81),
        );
        kerbContacts += r.telemetry.wheels.filter(
          (w) => w.surface === "kerb",
        ).length;
      }
      expect(minContacts).toBe(4);
      expect(peakLoad).toBeLessThan(1.8);
      expect(kerbContacts).toBeGreaterThan(300);
    },
  );
});
