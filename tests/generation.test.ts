import { afterEach, beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { generateCircuit } from "../src/track/generateCircuit";
import { DEFAULT_RECIPE, normalizeRecipe } from "../src/track/generationTypes";
import type { GenerationRecipe } from "../src/track/generationTypes";
import { hydrateCircuit, roadPoint } from "../src/track/SurfaceCompiler";
import { terrainHeight } from "../src/track/Terrain";
import { validateCircuit } from "../src/track/validateCircuit";
import { initializePhysics, SuspensionRig } from "../src/physics/SuspensionRig";
import { REFERENCE_CARS } from "../src/vehicle/referenceCars";
import { getTestCircuit } from "../src/track/testCircuit";
import { CircuitView } from "../src/rendering/CircuitView";
import { Mesh } from "three";
import type { BufferGeometry, Material } from "three";

const generated = generateCircuit(DEFAULT_RECIPE);
const touring = hydrateCircuit(generated.circuit);
const gp = hydrateCircuit(
  generateCircuit({
    ...DEFAULT_RECIPE,
    family: "gp",
    targetLength: 4000,
    seed: "silver-63",
  }).circuit,
);
const rigs: SuspensionRig[] = [];
beforeAll(initializePhysics);
afterEach(() => rigs.splice(0).forEach((r) => r.dispose()));

describe("seeded circuit recipes", () => {
  it("repeats the same geometry, terrain and report without shared random state", () => {
    const repeated = generateCircuit({
      ...DEFAULT_RECIPE,
      seed: "  ridge-104  ",
    });
    expect(repeated.recipe).toEqual(DEFAULT_RECIPE);
    expect(repeated.fingerprint).toBe(generated.fingerprint);
    expect(repeated.report).toEqual(generated.report);
    expect(repeated.circuit.definition).toEqual(generated.circuit.definition);
    repeated.circuit.chunks.forEach((chunk, i) => {
      expect(
        chunk.vertices.every(
          (value, j) => value === generated.circuit.chunks[i].vertices[j],
        ),
      ).toBe(true);
      expect(
        chunk.indices.every(
          (value, j) => value === generated.circuit.chunks[i].indices[j],
        ),
      ).toBe(true);
    });
  });
  it("changes topology, terrain and profiles for different seeds", () => {
    const results = [
      generated,
      ...["hello", "42", "long-corner", "銀の丘"].map((seed) =>
        generateCircuit({ ...DEFAULT_RECIPE, seed }),
      ),
    ];
    expect(new Set(results.map((r) => r.fingerprint)).size).toBe(
      results.length,
    );
    expect(
      new Set(results.map((r) => r.circuit.definition.controlPoints.length))
        .size,
    ).toBeGreaterThan(1);
    expect(
      new Set(
        results.map((r) =>
          terrainHeight(r.circuit.definition.site, 120, -45).toFixed(4),
        ),
      ).size,
    ).toBe(results.length);
    expect(results.every((r) => r.report.metrics.elevationRange > 2)).toBe(
      true,
    );
  });
  it("bounds untrusted recipe inputs and rejects unsupported recipe versions", () => {
    const normalized = normalizeRecipe({
      ...DEFAULT_RECIPE,
      seed: " ",
      targetLength: Infinity,
    });
    expect(normalized.seed).toBe(DEFAULT_RECIPE.seed);
    expect(normalized.targetLength).toBe(3200);
    expect(() =>
      normalizeRecipe({ ...DEFAULT_RECIPE, version: 99 as 1 }),
    ).toThrow(/version/);
  });
  it.each([
    ["touring", "gentle", 1800],
    ["touring", "rolling", 1800],
    ["touring", "gentle", 3200],
    ["touring", "rolling", 3200],
    ["gp", "gentle", 3200],
    ["gp", "rolling", 3200],
    ["gp", "gentle", 5200],
    ["gp", "rolling", 5200],
  ] as const)(
    "validates %s / %s / %i m across seeds",
    (family, relief, targetLength) => {
      for (const seed of ["seam-0", "valley-93", "fast-204"]) {
        const result = generateCircuit({
            ...DEFAULT_RECIPE,
            family,
            relief,
            targetLength,
            seed,
          }),
          m = result.report.metrics;
        expect(result.report.valid, JSON.stringify(result.attempts)).toBe(true);
        expect(result.report.checks.every((c) => c.status === "pass")).toBe(
          true,
        );
        expect(result.attempts.length).toBeLessThanOrEqual(4);
        expect(m.length).toBeCloseTo(targetLength, 5);
        expect(m.maxGrade).toBeLessThanOrEqual(0.06001);
        expect(m.minWidth).toBeGreaterThanOrEqual(family === "gp" ? 12 : 10);
        expect(m.clearance).toBeGreaterThanOrEqual(18);
        expect(m.crestG).toBeLessThanOrEqual(0.4);
        expect(m.compressionG).toBeLessThanOrEqual(0.65);
        const circuit = hydrateCircuit(result.circuit);
        expect(circuit.rows.at(-1)!.position).toEqual(circuit.rows[0].position);
        expect(circuit.rows.every((r) => r.bank * r.curvature <= 1e-8)).toBe(
          true,
        );
        expect(
          circuit.rows
            .filter((r) => Math.abs(r.curvature) < 0.002)
            .every((r) => Math.abs(r.bank) < 1e-8),
        ).toBe(true);
        expect(
          circuit.frame(-0.001).position.distanceTo(circuit.frame(0).position),
        ).toBeLessThan(0.002);
      }
    },
    20000,
  );
  it.each(["touring", "gp"] as const)(
    "provides a reproducible, validated %s fallback without replacing the requested seed",
    (family) => {
      const recipe: GenerationRecipe = {
        ...DEFAULT_RECIPE,
        seed: "original-seed",
        family,
        targetLength: family === "gp" ? 3200 : 1800,
      };
      const a = generateCircuit(recipe, { maxAttempts: 0 }),
        b = generateCircuit(recipe, { maxAttempts: 0 });
      expect(a.fallback).toBe(true);
      expect(a.recipe.seed).toBe("original-seed");
      expect(a.circuit.definition.id).toContain("fallback");
      expect(a.report.valid).toBe(true);
      expect(a.fingerprint).toBe(b.fingerprint);
      expect(a.circuit.definition.site.terrain).toEqual(
        b.circuit.definition.site.terrain,
      );
    },
  );
  it("bounds retries and retains the failing seed and rejection reasons with a safe fallback", () => {
    const recipe = { ...DEFAULT_RECIPE, seed: "sweep-0", targetLength: 1800 };
    const result = generateCircuit(recipe);
    expect(result.fallback).toBe(true);
    expect(result.recipe).toEqual(recipe);
    expect(result.attempts).toHaveLength(4);
    expect(
      result.attempts.every((attempt) =>
        attempt.reasons.some((reason) => reason.includes("Corner radii")),
      ),
    ).toBe(true);
    expect(result.report.valid).toBe(true);
    expect(generateCircuit(recipe).fingerprint).toBe(result.fingerprint);
  });
  it("reports specific reasons for unsafe road geometry", () => {
    const unsafe = structuredClone(generated.circuit.definition);
    unsafe.elevation[3].value += 150;
    const report = validateCircuit(unsafe, DEFAULT_RECIPE);
    expect(report.valid).toBe(false);
    expect(report.checks.find((c) => c.name === "Gentle grades")!.status).toBe(
      "fail",
    );
    expect(
      report.checks.find((c) => c.name === "Crests & compressions")!.status,
    ).toBe("fail");
  });
  it("hydrates transferred buffers into a usable alignment and spatial lookup", () => {
    const result = generateCircuit({
      ...DEFAULT_RECIPE,
      seed: "transfer-proof",
    });
    const buffers = result.circuit.chunks.flatMap((c) => [
      c.vertices.buffer,
      c.indices.buffer,
      c.colors.buffer,
    ]);
    const copy = structuredClone(result.circuit, { transfer: buffers });
    expect(result.circuit.chunks[0].vertices.byteLength).toBe(0);
    const circuit = hydrateCircuit(copy);
    for (const at of [0.001, 0.1, 0.28, 0.43, 0.7, 0.92, 0.999]) {
      const s = circuit.length * at,
        p = circuit.frame(s, 2).position,
        location = circuit.locate(p);
      expect(Math.abs(location.station - s)).toBeLessThan(0.04);
      expect(location.lateral).toBeCloseTo(2, 2);
    }
    // A query well outside the grid still finds the global closest station.
    const point = { x: 10000, y: 0, z: -10000 },
      location = circuit.locate(point);
    const nearest = Math.min(
      ...circuit.rows.map((r) =>
        Math.hypot(point.x - r.position.x, point.z - r.position.z),
      ),
    );
    expect(
      Math.hypot(
        point.x - location.sample.position.x,
        point.z - location.sample.position.z,
      ),
    ).toBeLessThan(nearest + 0.1);
  });
});

describe("generated circuits in the four-wheel world", () => {
  it("matches mesh heights/materials on both tyre paths, joints and the closing seam", () => {
    const r = new SuspensionRig();
    rigs.push(r);
    r.setCircuit(gp);
    for (let i = 0; i < 240; i++) r.step();
    let maxError = 0;
    const stations = [
      -0.02,
      0.02,
      gp.length - 0.02,
      ...gp.rows.filter((_, i) => i % 9 === 0).map((row) => row.station),
    ];
    for (const station of stations)
      for (const lateral of [-1, 1]) {
        const p = roadPoint(gp.alignment.sample(station), lateral);
        const hit = r.world.castRayAndGetNormal(
          new RAPIER.Ray({ x: p.x, y: p.y + 3, z: p.z }, { x: 0, y: -1, z: 0 }),
          5,
          true,
          undefined,
          undefined,
          undefined,
          r.body,
        );
        expect(hit).not.toBeNull();
        expect(r.circuitPhysics!.surface(hit!)).toBe("asphalt");
        maxError = Math.max(maxError, Math.abs(3 - hit!.timeOfImpact));
      }
    expect(maxError).toBeLessThan(0.015);
  });
  it("replaces colliders, retains setups and supports resets, rebuilds and the original pads", () => {
    const r = new SuspensionRig(REFERENCE_CARS.mr.setup);
    rigs.push(r);
    r.setCircuit(gp);
    const count = r.world.colliders.len(),
      old = r.circuitPhysics!.body;
    r.setCircuitStart("corner");
    r.updateSetup({ ...r.setup, wheelbase: 2.8 }, true);
    expect(r.circuitStart).toBe("corner");
    expect(r.circuit).toBe(gp);
    r.setExperiment("bank");
    expect(r.telemetry.track).toBeUndefined();
    r.setExperiment("circuit");
    expect(r.telemetry.track!.length).toBe(gp.length);
    r.setCircuit(touring);
    expect(old.isValid()).toBe(false);
    expect(r.setup.referenceCar).toBe("mr");
    expect(r.setup.wheelbase).toBe(2.8);
    for (let i = 0; i < 3; i++) {
      r.setCircuit(gp);
      expect(r.world.colliders.len()).toBe(count);
      r.setCircuit(getTestCircuit());
    }
    r.setCircuit(gp);
    expect(r.world.colliders.len()).toBe(count);
  });
  it("keeps the existing circuit and removes partial colliders if a replacement cannot be built", () => {
    const r = new SuspensionRig();
    rigs.push(r);
    r.setCircuit(touring);
    const count = r.world.colliders.len(),
      bodyCount = r.world.bodies.len();
    const broken = {
      ...gp,
      chunks: [
        gp.chunks[0],
        { ...gp.chunks[0], indices: undefined as unknown as Uint32Array },
      ],
    };
    expect(() => r.setCircuit(broken)).toThrow();
    expect(r.circuit).toBe(touring);
    expect(r.world.colliders.len()).toBe(count);
    expect(r.world.bodies.len()).toBe(bodyCount);
    r.reset();
    expect(r.telemetry.track!.length).toBe(touring.length);
  });
  it.each([
    ["ff", touring, 15],
    ["fr", touring, 18],
    ["mr", gp, 22],
    ["awd", gp, 22],
  ] as const)(
    "completes a generated lap in the %s reference car",
    (car, circuit, target) => {
      const r = new SuspensionRig(REFERENCE_CARS[car].setup);
      rigs.push(r);
      r.setCircuit(circuit);
      for (let i = 0; i < 360; i++) r.step();
      let travelled = 0,
        previous = r.telemetry.track!.station,
        peakLoad = 0,
        maxLateral = 0,
        contacts = 0,
        steps = 0;
      const maxSteps = Math.ceil((circuit.length / target + 30) * 120);
      for (; steps < maxSteps && travelled < circuit.length + 10; steps++) {
        const t = r.telemetry,
          lookahead = 6 + t.speed * 0.4;
        const aim = circuit
          .frame(t.track!.station + lookahead)
          .position.sub(new Vector3().copy(t.position));
        const q = new Quaternion().copy(t.rotation),
          angle = Math.atan2(
            aim.dot(new Vector3(-1, 0, 0).applyQuaternion(q)),
            aim.dot(new Vector3(0, 0, 1).applyQuaternion(q)),
          );
        const steer =
          (Math.atan2(2 * r.setup.wheelbase * Math.sin(angle), lookahead) /
            r.setup.steeringLimit) *
          (1 + (r.setup.speedSteering * t.speed) / 18);
        r.step({
          throttle: Math.max(0, Math.min(1, (target - t.speed) * 0.5)),
          brake: Math.max(0, Math.min(1, (t.speed - target) * 0.4)),
          steer: Math.max(-1, Math.min(1, steer)),
        });
        const delta = r.telemetry.track!.station - previous;
        travelled +=
          delta < -circuit.length / 2 ? delta + circuit.length : delta;
        previous = r.telemetry.track!.station;
        maxLateral = Math.max(maxLateral, Math.abs(r.telemetry.track!.lateral));
        peakLoad = Math.max(
          peakLoad,
          r.telemetry.totalLoad / (r.setup.mass * 9.81),
        );
        if (r.telemetry.groundedCount === 4) contacts++;
      }
      expect(travelled).toBeGreaterThan(circuit.length);
      expect(maxLateral).toBeLessThan(1);
      expect(contacts / steps).toBeGreaterThan(0.995);
      expect(peakLoad).toBeLessThan(1.8);
    },
    30000,
  );
});

it("releases the previous circuit's GPU resources exactly once on disposal", () => {
  const view = new CircuitView(touring),
    geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>();
  // Road markings and trees stay batched as lap length/feature count grows.
  expect(view.group.children.length).toBeLessThan(touring.chunks.length + 10);
  view.group.traverse((o) => {
    if (o instanceof Mesh) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        materials.add(m);
    }
  });
  let disposedGeometry = 0,
    disposedMaterial = 0;
  geometries.forEach((g) =>
    g.addEventListener("dispose", () => disposedGeometry++),
  );
  materials.forEach((m) =>
    m.addEventListener("dispose", () => disposedMaterial++),
  );
  view.dispose();
  view.dispose();
  expect(view.group.children.length).toBe(0);
  expect(disposedGeometry).toBe(geometries.size);
  expect(disposedMaterial).toBe(materials.size);
});
