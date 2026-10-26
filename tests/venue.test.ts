import { afterEach, beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  Vector3,
  Quaternion,
  Mesh,
  Texture,
  MeshStandardMaterial,
} from "three";
import { generateCircuit } from "../src/track/generateCircuit";
import { DEFAULT_DESIGN_RECIPE } from "../src/track/generationTypes";
import type { GenerationResult } from "../src/track/generationTypes";
import {
  constructVenue,
  restyleScenery,
} from "../src/track/venue/constructVenue";
import { DEFAULT_VENUE } from "../src/track/venue/types";
import { barrierGeometry, pitOffset } from "../src/track/venue/geometry";
import { hydrateCircuit, roadPoint } from "../src/track/SurfaceCompiler";
import type { CompiledCircuit } from "../src/track/SurfaceCompiler";
import { surfaceQuery } from "../src/track/SurfaceQuery";
import { SuspensionRig, initializePhysics } from "../src/physics/SuspensionRig";
import { CircuitPhysics } from "../src/physics/CircuitPhysics";
import { REFERENCE_CARS } from "../src/vehicle/referenceCars";
import { looseSurfaceDrag } from "../src/vehicle/SurfaceResponse";
import { FIXED_STEP, WHEEL_RADIUS } from "../src/vehicle/types";
import { CircuitView } from "../src/rendering/CircuitView";

let base: GenerationResult,
  touring: GenerationResult,
  gp: GenerationResult,
  tour: CompiledCircuit,
  grand: CompiledCircuit;
const rigs: SuspensionRig[] = [];
beforeAll(async () => {
  await initializePhysics();
  base = generateCircuit(DEFAULT_DESIGN_RECIPE);
  touring = constructVenue(base, DEFAULT_VENUE);
  tour = hydrateCircuit(touring.circuit);
  gp = constructVenue(
    generateCircuit({
      ...DEFAULT_DESIGN_RECIPE,
      seed: "silver-63",
      family: "gp",
      targetLength: 5200,
    }),
    { ...DEFAULT_VENUE, theme: "modern" },
  );
  grand = hydrateCircuit(gp.circuit);
}, 45000);
afterEach(() => rigs.splice(0).forEach((r) => r.dispose()));

describe("M5 construction and compatibility", () => {
  it("keeps the qualified M4 layout and vertical road unchanged", () => {
    const a = base.circuit.definition,
      b = touring.circuit.definition;
    for (const key of [
      "controlPoints",
      "elevation",
      "leftWidth",
      "rightWidth",
      "bank",
      "crown",
    ] as const)
      expect(b[key]).toEqual(a[key]);
    expect(b.venue!.baseFingerprint).toBe(base.fingerprint);
    expect(a.venue).toBeUndefined();
    expect(touring.report.valid).toBe(true);
  });
  it("preserves two known qualified M4 fingerprints", () => {
    const compact = generateCircuit({
      ...DEFAULT_DESIGN_RECIPE,
      seed: "qualification-348",
      relief: "gentle",
      targetLength: 2000,
      character: "technical",
    });
    expect(compact.fingerprint).toBe("v2-9c21c33f");
    const terrain = generateCircuit({
      ...DEFAULT_DESIGN_RECIPE,
      seed: "qualification-949",
      family: "gp",
      targetLength: 5200,
      character: "flowing",
      envelope: "terrain",
      layout: 1,
    });
    expect(terrain.fingerprint).toBe("v2-d08f85dd");
  }, 20000);
  it("repeats construction and preserves geometry when only scenery changes", () => {
    const repeat = constructVenue(base, DEFAULT_VENUE);
    expect(repeat.fingerprint).toBe(touring.fingerprint);
    const changed = restyleScenery(touring, {
      ...DEFAULT_VENUE,
      scenery: "dense",
      scenerySeed: "different-forest",
    });
    expect(changed.circuit.chunks).toEqual(touring.circuit.chunks);
    expect(changed.fingerprint).toBe(touring.fingerprint);
    expect(
      changed.circuit.definition.venue!.props.filter((p) => p.solid),
    ).toEqual(touring.circuit.definition.venue!.props.filter((p) => p.solid));
    expect(changed.circuit.definition.venue!.sceneryFingerprint).not.toBe(
      touring.circuit.definition.venue!.sceneryFingerprint,
    );
  }, 20000);
  it("leaves explicit undressed recipes available", () => {
    expect(constructVenue(base, { ...DEFAULT_VENUE, enabled: false })).toBe(
      base,
    );
  });
  it("fits finite escape fans within the actual compiled surface and outside barriers", () => {
    const ground = surfaceQuery(tour),
      v = tour.definition.venue!;
    expect(v.fans.length).toBeGreaterThan(3);
    expect(v.report.maxRunoff).toBeGreaterThan(18);
    expect(v.leftRunoff[0].value).toBe(v.leftRunoff.at(-1)!.value);
    expect(v.rightRunoff[0].value).toBe(v.rightRunoff.at(-1)!.value);
    for (const f of v.fans) {
      expect(f.designSpeed).toBeLessThanOrEqual(f.approachSpeed);
      expect(f.designSpeed).toBeGreaterThan(10);
      expect(f.terminalSpeed).toBeLessThanOrEqual(12);
      for (const path of f.paths)
        for (const p of path) {
          expect(ground(p.x, p.z)?.height).toBeCloseTo(p.y, 0);
          const near = tour.locate(p),
            r = near.sample;
          expect(Math.abs(near.lateral)).toBeLessThan(
            (near.lateral > 0
              ? r.leftWidth + r.runoffLeft!
              : r.rightWidth + r.runoffRight!) - 1,
          );
        }
    }
    const roles = new Set(tour.definition.kerbs.map((k) => k.role));
    expect(roles.has("entry") && roles.has("apex") && roles.has("exit")).toBe(
      true,
    );
    expect(v.report.kerbCoverage).toBeLessThan(0.8);
  });
  it("joins a paved pit lane at the edge with separate merges and real service access", () => {
    const v = tour.definition.venue!,
      pit = v.pit!,
      ground = surfaceQuery(tour);
    expect(pit.width).toBeGreaterThanOrEqual(4);
    expect(pit.entry).toBeLessThan(-60);
    expect(pit.exit).toBeGreaterThan(60);
    expect(pitOffset(pit, pit.entry, tour.length)).toBeCloseTo(pit.joinOffset);
    expect(pitOffset(pit, 0, tour.length)).toBeCloseTo(pit.offset);
    for (const p of pit.points)
      expect(["asphalt", "runoff"]).toContain(ground(p.x, p.z)?.surface);
    expect(v.access!.points.length).toBeGreaterThan(20);
    for (const p of v.access!.points.slice(2, -2))
      expect(ground(p.x, p.z)?.height).toBeCloseTo(p.y, 0);
    expect(
      v.props.filter((p) => p.solid && p.kind === "garage").length,
    ).toBeGreaterThanOrEqual(5);
  });
  it("builds welded, capped barrier meshes without exposed internal panel ends", () => {
    for (const path of tour.definition.venue!.barriers) {
      const mesh = barrierGeometry(path),
        edges = new Map<string, number>();
      for (let i = 0; i < mesh.indices.length; i += 3)
        for (let j = 0; j < 3; j++) {
          const a = mesh.indices[i + j],
            b = mesh.indices[i + ((j + 1) % 3)],
            key = a < b ? `${a},${b}` : `${b},${a}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      expect([...edges.values()].every((n) => n === 2)).toBe(true);
      expect([...mesh.vertices].every(Number.isFinite)).toBe(true);
    }
  });
  it("keeps the road/terrain surface manifold through widened bays and service grading", () => {
    const edges = new Map<
        string,
        { count: number; a: number[]; b: number[] }
      >(),
      bounds = {
        minX: Infinity,
        maxX: -Infinity,
        minZ: Infinity,
        maxZ: -Infinity,
      };
    for (const chunk of tour.chunks) {
      const v = chunk.vertices;
      const key = (i: number) => `${v[i * 3]},${v[i * 3 + 1]},${v[i * 3 + 2]}`;
      for (let i = 0; i < v.length; i += 3) {
        bounds.minX = Math.min(bounds.minX, v[i]);
        bounds.maxX = Math.max(bounds.maxX, v[i]);
        bounds.minZ = Math.min(bounds.minZ, v[i + 2]);
        bounds.maxZ = Math.max(bounds.maxZ, v[i + 2]);
      }
      for (let i = 0; i < chunk.indices.length; i += 3)
        for (let j = 0; j < 3; j++) {
          const a = chunk.indices[i + j],
            b = chunk.indices[i + ((j + 1) % 3)],
            ak = key(a),
            bk = key(b),
            edge = ak < bk ? `${ak}/${bk}` : `${bk}/${ak}`;
          const old = edges.get(edge);
          if (old) old.count++;
          else
            edges.set(edge, {
              count: 1,
              a: [v[a * 3], v[a * 3 + 2]],
              b: [v[b * 3], v[b * 3 + 2]],
            });
        }
    }
    let open = 0;
    for (const e of edges.values()) {
      expect(e.count).toBeLessThanOrEqual(2);
      if (e.count === 1) {
        open++;
        expect(
          (e.a[0] === bounds.minX && e.b[0] === bounds.minX) ||
            (e.a[0] === bounds.maxX && e.b[0] === bounds.maxX) ||
            (e.a[1] === bounds.minZ && e.b[1] === bounds.minZ) ||
            (e.a[1] === bounds.maxZ && e.b[1] === bounds.maxZ),
        ).toBe(true);
      }
    }
    expect(open).toBeGreaterThan(4);
  }, 15000);
  it("disposes instanced resources and generated sign textures once on replacement", () => {
    const view = new CircuitView(tour),
      geometries = new Set<import("three").BufferGeometry>(),
      materials = new Set<import("three").Material>();
    view.group.traverse((o) => {
      if (o instanceof Mesh) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          materials.add(m);
      }
    });
    const material = [...materials].find(
      (m) => m instanceof MeshStandardMaterial,
    ) as MeshStandardMaterial;
    const texture = new Texture();
    material.map = texture;
    let textures = 0,
      geometryCount = 0,
      materialCount = 0;
    texture.addEventListener("dispose", () => textures++);
    geometries.forEach((g) =>
      g.addEventListener("dispose", () => geometryCount++),
    );
    materials.forEach((m) =>
      m.addEventListener("dispose", () => materialCount++),
    );
    view.dispose();
    view.dispose();
    expect(textures).toBe(1);
    expect(geometryCount).toBe(geometries.size);
    expect(materialCount).toBe(materials.size);
  });
});

describe("M5 contact and collision", () => {
  it("blends boundary materials at each wheel without multiplying suspension load", () => {
    const setup = REFERENCE_CARS.fr.setup,
      definition = structuredClone(tour.definition),
      row = tour.alignment.sample(0);
    definition.starts.push({
      id: "blend",
      name: "Boundary",
      at: 0,
      lateral: row.leftWidth - setup.trackWidth / 2 + 0.01,
      description: "test",
    });
    const rig = new SuspensionRig(setup);
    rigs.push(rig);
    rig.setCircuit(hydrateCircuit({ ...touring.circuit, definition }));
    rig.setCircuitStart("blend");
    for (let i = 0; i < 480; i++) rig.step();
    expect(rig.telemetry.groundedCount).toBe(4);
    expect(rig.telemetry.totalLoad / (setup.mass * 9.81)).toBeCloseTo(1, 1);
    expect(
      rig.telemetry.wheels.some((w) => (w.surfaceBlend?.length ?? 0) > 1),
    ).toBe(true);
    for (const w of rig.telemetry.wheels)
      expect(w.surfaceBlend!.reduce((s, m) => s + m.weight, 0)).toBeCloseTo(
        1,
        8,
      );
  });
  it("never uses a barrier roof as a suspension support surface", () => {
    const rig = new SuspensionRig(REFERENCE_CARS.fr.setup);
    rigs.push(rig);
    rig.setCircuit(tour);
    const path = tour.definition.venue!.barriers.find((b) =>
        b.id.startsWith("perimeter"),
      )!,
      index = Math.floor(path.points.length / 3),
      p = path.points[index],
      next = path.points[index + 1];
    const forward = new Vector3(next.x - p.x, 0, next.z - p.z).normalize(),
      left = new Vector3(forward.z, 0, -forward.x),
      heading = Math.atan2(forward.x, forward.z);
    const position = new Vector3(
      p.x,
      p.y + path.height + 0.45,
      p.z,
    ).addScaledVector(left, -rig.setup.trackWidth / 2);
    rig.body.setTranslation(position, true);
    rig.body.setRotation(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading),
      true,
    );
    rig.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rig.step();
    expect(rig.telemetry.groundedCount).toBe(0);
  });
  it("contains a fast chassis impact with low rebound", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = FIXED_STEP;
    const physics = new CircuitPhysics(world, tour);
    try {
      const path = tour.definition.venue!.barriers.find((b) =>
          b.id.startsWith("perimeter"),
        )!,
        p = path.points[Math.floor(path.points.length / 2)],
        near = tour.locate(p);
      const normal = new Vector3(
          p.x - near.sample.position.x,
          0,
          p.z - near.sample.position.z,
        ).normalize(),
        start = new Vector3(p.x, p.y + 0.55, p.z).addScaledVector(normal, -4);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(start.x, start.y, start.z)
          .setCcdEnabled(true),
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.6, 0.25, 0.6).setRestitution(0.025),
        body,
      );
      body.setLinvel(normal.clone().multiplyScalar(20), true);
      for (let i = 0; i < 120; i++) world.step();
      expect(
        new Vector3()
          .copy(body.translation())
          .sub(new Vector3(p.x, p.y, p.z))
          .dot(normal),
      ).toBeLessThan(0.2);
      expect(new Vector3().copy(body.linvel()).length()).toBeLessThan(4);
    } finally {
      physics.dispose();
      world.free();
    }
  });
  it("makes soil displacement dissipative and bounded even near rest", () => {
    for (const speed of [0.001, 0.05, 1, 18, 55])
      for (const coefficient of [0, 0.14, 0.24, 20]) {
        const force = looseSurfaceDrag(
          speed,
          speed * 0.3,
          4000,
          coefficient,
          350,
          FIXED_STEP,
        );
        expect(force.fx * speed + force.fy * speed * 0.3).toBeLessThanOrEqual(
          0,
        );
        expect(
          (Math.hypot(force.fx, force.fy) * FIXED_STEP) / 350,
        ).toBeLessThanOrEqual(Math.hypot(speed, speed * 0.3) * 0.25000001);
      }
  });
  it("coasts progressively shorter on gravel and sand without a material impulse", () => {
    const distances: number[] = [];
    for (const surface of ["asphalt", "gravel", "sand"] as const) {
      const rig = new SuspensionRig(REFERENCE_CARS.fr.setup);
      rigs.push(rig);
      const circuit = hydrateCircuit({
        ...touring.circuit,
        chunks: touring.circuit.chunks.map((c) => ({
          ...c,
          surfaces: c.surfaces.map(() => surface),
        })),
      });
      rig.setCircuit(circuit);
      for (let i = 0; i < 360; i++) rig.step();
      rig.powertrain.requestGear(0, 0);
      const forward = tour.frame(24).forward,
        origin = new Vector3().copy(rig.telemetry.position);
      rig.body.setLinvel(forward.clone().multiplyScalar(12), true);
      rig.tyres.forEach((t) => (t.omega = 12 / WHEEL_RADIUS));
      let previous = 12;
      for (let i = 0; i < 120; i++) {
        rig.step();
        const speed = new Vector3().copy(rig.telemetry.velocity).dot(forward);
        expect(speed).toBeGreaterThan(-0.03);
        expect(previous - speed).toBeLessThan(0.25);
        previous = speed;
      }
      distances.push(
        new Vector3().copy(rig.telemetry.position).sub(origin).dot(forward),
      );
    }
    expect(distances[0]).toBeGreaterThan(distances[1] + 0.3);
    expect(distances[1]).toBeGreaterThan(distances[2] + 0.2);
  });
  it("drives the pit entry, lane and exit without touching the pit wall", () => {
    const pit = tour.definition.venue!.pit!,
      definition = structuredClone(tour.definition),
      setup = REFERENCE_CARS.ff.setup;
    const start = pit.entry - 16,
      at = (((start % tour.length) + tour.length) % tour.length) / tour.length;
    definition.starts.push({
      id: "pit-entry-test",
      name: "Pit entry",
      at,
      lateral: pit.side * pit.joinOffset,
      description: "test",
    });
    const circuit = hydrateCircuit({ ...touring.circuit, definition }),
      rig = new SuspensionRig(setup);
    rigs.push(rig);
    rig.setCircuit(circuit);
    rig.setCircuitStart("pit-entry-test");
    for (let i = 0; i < 360; i++) rig.step();
    const points: Vector3[] = [];
    for (let s = start; s < pit.entry; s += 2)
      points.push(
        roadPoint(circuit.alignment.sample(s), pit.side * pit.joinOffset),
      );
    points.push(...pit.points.map((p) => new Vector3().copy(p)));
    for (let s = pit.exit; s <= pit.exit + 55; s += 2)
      points.push(
        roadPoint(
          circuit.alignment.sample(s),
          pit.side * pit.joinOffset * (1 - Math.min(1, (s - pit.exit) / 45)),
        ),
      );
    let cursor = 0,
      maxError = 0,
      contacts = 0,
      steps = 0,
      peak = 0;
    for (; steps < 7000 && cursor < points.length - 5; steps++) {
      const t = rig.telemetry,
        p = new Vector3().copy(t.position);
      for (let i = cursor + 1; i < Math.min(points.length, cursor + 14); i++)
        if (
          p.distanceToSquared(points[i]) < p.distanceToSquared(points[cursor])
        )
          cursor = i;
      maxError = Math.max(
        maxError,
        p.clone().setY(0).distanceTo(points[cursor].clone().setY(0)),
      );
      const aim = points[Math.min(points.length - 1, cursor + 5)]
          .clone()
          .sub(p),
        q = new Quaternion().copy(t.rotation),
        angle = Math.atan2(
          aim.dot(new Vector3(-1, 0, 0).applyQuaternion(q)),
          aim.dot(new Vector3(0, 0, 1).applyQuaternion(q)),
        ),
        look = Math.max(4, Math.hypot(aim.x, aim.z));
      const steer =
        (Math.atan2(2 * setup.wheelbase * Math.sin(angle), look) /
          setup.steeringLimit) *
        (1 + (setup.speedSteering * t.speed) / 18);
      rig.step({
        steer: Math.max(-1, Math.min(1, steer)),
        throttle: Math.max(0, Math.min(1, (13.3 - t.speed) * 0.5)),
        brake: Math.max(0, Math.min(1, (t.speed - 13.3) * 0.4)),
      });
      if (rig.telemetry.groundedCount === 4) contacts++;
      peak = Math.max(peak, rig.telemetry.totalLoad / (setup.mass * 9.81));
    }
    expect(cursor).toBeGreaterThanOrEqual(points.length - 5);
    expect(maxError).toBeLessThan(1.6);
    expect(contacts / steps).toBeGreaterThan(0.99);
    expect(peak).toBeLessThan(1.6);
  }, 30000);
  it.each([
    ["low", 8],
    ["low", 20],
    ["raised", 8],
    ["raised", 20],
  ] as const)(
    "traverses a %s kerb obliquely at %s m/s without a launch",
    (kerb, speed) => {
      const result =
          kerb === "low"
            ? touring
            : constructVenue(base, { ...DEFAULT_VENUE, kerb: "raised" }),
        definition = structuredClone(result.circuit.definition);
      const zone = definition.kerbs.find(
          (k) => k.role === "apex" && (k.end - k.start) * tour.length > 20,
        )!,
        at = (zone.start + zone.end) / 2;
      definition.starts.push({
        id: "kerb-cross",
        name: "Kerb cross",
        at,
        lateral: zone.side === "left" ? "kerb-left" : "kerb-right",
        description: "test",
      });
      const circuit = hydrateCircuit({ ...result.circuit, definition }),
        rig = new SuspensionRig(REFERENCE_CARS.fr.setup);
      rigs.push(rig);
      rig.setCircuit(circuit);
      rig.setCircuitStart("kerb-cross");
      for (let i = 0; i < 360; i++) rig.step();
      const forward = circuit.frame(at * circuit.length).forward;
      rig.body.setLinvel(forward.clone().multiplyScalar(speed), true);
      rig.tyres.forEach((t) => (t.omega = speed / WHEEL_RADIUS));
      let peak = 0,
        height = 0,
        rollDegrees = 0,
        kerbContact = false;
      for (let i = 0; i < 100; i++) {
        rig.step({
          steer: zone.side === "left" ? -0.22 : 0.22,
          throttle: 0,
          brake: 0,
        });
        const t = rig.telemetry;
        peak = Math.max(peak, t.totalLoad / (rig.setup.mass * 9.81));
        rollDegrees = Math.max(rollDegrees, Math.abs(t.roll));
        height = Math.max(
          height,
          t.position.y - circuit.alignment.sample(t.track!.station).position.y,
        );
        kerbContact ||= t.wheels.some((w) =>
          w.surfaceBlend?.some((s) => s.surface === "kerb" && s.weight > 0),
        );
      }
      expect(kerbContact).toBe(true);
      expect(peak).toBeLessThan(3.5);
      expect(rollDegrees).toBeLessThan(12);
      expect(height).toBeLessThan(1.2);
    },
    30000,
  );
  it.each(["ff", "fr", "mr", "awd"] as const)(
    "drives a full dressed lap in the %s car",
    (car) => {
      const circuit = car === "ff" || car === "fr" ? tour : grand,
        cap = circuit === tour ? 17 : 21;
      const rig = new SuspensionRig(REFERENCE_CARS[car].setup);
      rigs.push(rig);
      rig.setCircuit(circuit);
      for (let i = 0; i < 360; i++) rig.step();
      let previous = rig.telemetry.track!.station,
        travel = 0,
        steps = 0,
        contacts = 0,
        peak = 0,
        maxLateral = 0;
      for (
        ;
        steps < Math.ceil((circuit.length / cap + 150) * 120) &&
        travel < circuit.length + 8;
        steps++
      ) {
        const t = rig.telemetry,
          look = 6 + t.speed * 0.4,
          q = new Quaternion().copy(t.rotation),
          aim = circuit
            .frame(t.track!.station + look)
            .position.sub(new Vector3().copy(t.position));
        const angle = Math.atan2(
          aim.dot(new Vector3(-1, 0, 0).applyQuaternion(q)),
          aim.dot(new Vector3(0, 0, 1).applyQuaternion(q)),
        );
        const steer =
          (Math.atan2(2 * rig.setup.wheelbase * Math.sin(angle), look) /
            rig.setup.steeringLimit) *
          (1 + (rig.setup.speedSteering * t.speed) / 18);
        const k = Math.max(
            ...[0, 10, 25, 45].map((d) =>
              Math.abs(
                circuit.alignment.sample(t.track!.station + d).curvature,
              ),
            ),
          ),
          speed = Math.min(cap, Math.sqrt((0.55 * 9.81) / Math.max(0.0001, k)));
        rig.step({
          steer: Math.max(-1, Math.min(1, steer)),
          throttle: Math.max(0, Math.min(1, (speed - t.speed) * 0.5)),
          brake: Math.max(0, Math.min(1, (t.speed - speed) * 0.4)),
        });
        const delta = rig.telemetry.track!.station - previous;
        travel += delta < -circuit.length / 2 ? delta + circuit.length : delta;
        previous = rig.telemetry.track!.station;
        maxLateral = Math.max(
          maxLateral,
          Math.abs(rig.telemetry.track!.lateral),
        );
        peak = Math.max(
          peak,
          rig.telemetry.totalLoad / (rig.setup.mass * 9.81),
        );
        if (rig.telemetry.groundedCount === 4) contacts++;
      }
      expect(travel).toBeGreaterThan(circuit.length);
      expect(maxLateral).toBeLessThan(1.5);
      expect(contacts / steps).toBeGreaterThan(0.99);
      expect(peak).toBeLessThan(1.9);
    },
    60000,
  );
});
