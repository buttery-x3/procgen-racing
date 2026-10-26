import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { FOLDED_CIRCUIT } from "../src/track/foldedCircuit";
import {
  compileCircuit,
  hydrateCircuit,
  roadPoint,
} from "../src/track/SurfaceCompiler";
import { generateCircuit } from "../src/track/generateCircuit";
import { designCircuit } from "../src/track/generateDesignedCircuit";
import {
  DEFAULT_DESIGN_RECIPE,
  normalizeRecipe,
} from "../src/track/generationTypes";
import { initializePhysics, SuspensionRig } from "../src/physics/SuspensionRig";
import { REFERENCE_CARS } from "../src/vehicle/referenceCars";
import { periodicProfile } from "../src/track/design/RoadProfiles";
import { profile } from "../src/track/Alignment";
import { validateCircuit } from "../src/track/validateCircuit";

const touring = hydrateCircuit(generateCircuit(DEFAULT_DESIGN_RECIPE).circuit);
const gpRecipe = {
  ...DEFAULT_DESIGN_RECIPE,
  seed: "silver-63",
  family: "gp" as const,
  targetLength: 5200,
};
const gpResult = generateCircuit(gpRecipe),
  gp = hydrateCircuit(gpResult.circuit);
const rigs: SuspensionRig[] = [];
beforeAll(initializePhysics);
afterEach(() => rigs.splice(0).forEach((r) => r.dispose()));

describe("non-radial terrain compiler", () => {
  it("closes every road/terrain seam on an authored folded hill circuit without terrain under the road", () => {
    const c = compileCircuit(FOLDED_CIRCUIT),
      edgeCounts = new Map<string, number>();
    const key = (v: Float32Array, i: number) =>
      `${v[i * 3]},${v[i * 3 + 1]},${v[i * 3 + 2]}`;
    for (const chunk of c.chunks)
      for (let i = 0; i < chunk.indices.length; i += 3) {
        const indices = Array.from(chunk.indices.slice(i, i + 3)),
          points = indices.map((j) => key(chunk.vertices, j));
        for (let j = 0; j < 3; j++) {
          const a = points[j],
            b = points[(j + 1) % 3],
            k = a < b ? `${a}|${b}` : `${b}|${a}`;
          edgeCounts.set(k, (edgeCounts.get(k) || 0) + 1);
        }
      }
    expect([...edgeCounts.values()].every((n) => n === 1 || n === 2)).toBe(
      true,
    );
    // Only the subdivided outer rectangle may remain open; every road and
    // chunk seam must have two incident triangles, including the infield bays.
    const boundary = [...edgeCounts]
      .filter(([, count]) => count === 1)
      .map(([key]) => key.split("|").map((p) => p.split(",").map(Number)));
    const xs = boundary.flatMap((edge) => edge.map((p) => p[0])),
      zs = boundary.flatMap((edge) => edge.map((p) => p[2]));
    const bounds = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...zs),
      Math.max(...zs),
    ];
    expect(boundary.length).toBeGreaterThan(4);
    expect(
      boundary.every(
        ([a, b]) =>
          (a[0] === b[0] && (a[0] === bounds[0] || a[0] === bounds[1])) ||
          (a[2] === b[2] && (a[2] === bounds[2] || a[2] === bounds[3])),
      ),
    ).toBe(true);
    for (const at of [0.04, 0.25, 0.43, 0.51, 0.67, 0.85]) {
      const r = c.alignment.sample(at * c.length),
        p = roadPoint(r, 2);
      for (const chunk of c.chunks.filter((c) => c.kind === "terrain"))
        for (let i = 0; i < chunk.indices.length; i += 3) {
          const [a, b, d] = Array.from(chunk.indices.slice(i, i + 3)).map(
            (j) => ({ x: chunk.vertices[j * 3], z: chunk.vertices[j * 3 + 2] }),
          );
          const cross = (
            a: { x: number; z: number },
            b: { x: number; z: number },
          ) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
          const signs = [cross(a, b), cross(b, d), cross(d, a)];
          expect(
            signs.every((s) => s > 1e-6) || signs.every((s) => s < -1e-6),
          ).toBe(false);
        }
    }
  }, 30000);
  it("preserves periodic value, slope and curvature in fitted elevation profiles", () => {
    const values = Array.from(
        { length: 32 },
        (_, i) => 10 + Math.sin((i / 32) * Math.PI * 2) * 3,
      ),
      keys = periodicProfile(values);
    const h = 1e-7,
      a = profile(keys, h),
      b = profile(keys, 1 - h);
    expect(Math.abs(a.value - b.value)).toBeLessThan(1e-5);
    expect(Math.abs(a.derivative - b.derivative)).toBeLessThan(1e-4);
    const second = (u: number) =>
      (profile(keys, u + h).derivative - profile(keys, u - h).derivative) /
      (2 * h);
    expect(Math.abs(second(h) - second(1 - h))).toBeLessThan(0.01);
  });
});

describe("production v2 circuit design", () => {
  it("rejects a numerically valid simple loop for a technical brief", () => {
    const recipe = {
      ...DEFAULT_DESIGN_RECIPE,
      character: "technical" as const,
    };
    const conservative = designCircuit(recipe, { maxAttempts: 0 });
    expect(conservative.fallback).toBe(true);
    const definition = structuredClone(conservative.definition);
    definition.id = "simple-loop-rhythm-fixture";
    const report = validateCircuit(definition, recipe);
    expect(report.checks.find((c) => c.name === "Design rhythm")!.status).toBe(
      "fail",
    );
    expect(
      report.checks
        .filter((c) => c.name !== "Design rhythm")
        .every((c) => c.status === "pass"),
    ).toBe(true);
  }, 20000);
  it("returns actual folded, varied, terrain-fitted routes and a portable definition", () => {
    const r = gpResult;
    expect(r.recipe.version).toBe(2);
    expect(r.fallback).toBe(false);
    expect(r.report.valid).toBe(true);
    expect(r.circuit.definition.site.mesh).toBe("corridor");
    expect(r.design!.closureShare).toBeLessThan(0.23);
    expect(r.design!.closureAdjustment).toBeGreaterThan(0);
    expect(r.design!.directionChanges).toBeGreaterThan(3);
    expect(r.design!.longStraights).toBeGreaterThanOrEqual(2);
    expect(r.design!.retainedRelief).toBeGreaterThan(0.42);
    expect(r.design!.cutFillRms).toBeLessThan(6);
    expect(r.report.metrics.maxGrade).toBeLessThan(0.06001);
    expect(r.design!.reservations.some((r) => r.kind === "paddock")).toBe(true);
    expect(
      r.design!.siteFeatures.some(
        (f) => f.kind === "valley" || f.kind === "ridge",
      ),
    ).toBe(true);
    expect(r.circuit.chunks.some((c) => c.kind === "terrain")).toBe(true);
    expect(r.design!.referenceLines!.map((l) => l.vehicle)).toEqual([
      "touring",
      "gt",
      "prototype",
    ]);
    for (const line of r.design!.referenceLines!)
      for (const point of line.points) {
        const row = gp.alignment.sample(point.at * gp.length);
        expect(point.lateral).toBeGreaterThanOrEqual(-row.rightWidth + 1.9);
        expect(point.lateral).toBeLessThanOrEqual(row.leftWidth - 1.9);
        expect(Number.isFinite(point.speed) && point.speed > 0).toBe(true);
      }
  });
  it("repeats a recipe and changes route alternatives on the same terrain", () => {
    const a = designCircuit(DEFAULT_DESIGN_RECIPE),
      b = designCircuit({ ...DEFAULT_DESIGN_RECIPE, layout: 1 }),
      repeat = designCircuit(DEFAULT_DESIGN_RECIPE);
    expect(repeat).toEqual(a);
    expect(b.fingerprint).not.toBe(a.fingerprint);
    expect(b.definition.site.terrain).toEqual(a.definition.site.terrain);
  }, 20000);
  it("bounds v2 controls and distinguishes its explicit conservative fallback", () => {
    expect(
      normalizeRecipe({
        ...DEFAULT_DESIGN_RECIPE,
        targetLength: 99999,
        layout: 900,
      }).targetLength,
    ).toBe(4500);
    const r = designCircuit(DEFAULT_DESIGN_RECIPE, { maxAttempts: 0 });
    expect(r.fallback).toBe(true);
    expect(r.recipe.seed).toBe(DEFAULT_DESIGN_RECIPE.seed);
    expect(r.definition.id).toContain("fallback");
    expect(r.report.valid).toBe(true);
  }, 20000);
  it.each(["ff", "fr", "mr", "awd"] as const)(
    "drives a full v2 lap with stable contact in the %s car",
    (car) => {
      const c = car === "ff" || car === "fr" ? touring : gp,
        target = c === gp ? 22 : 17;
      const r = new SuspensionRig(REFERENCE_CARS[car].setup);
      rigs.push(r);
      r.setCircuit(c);
      for (let i = 0; i < 360; i++) r.step();
      let travelled = 0,
        previous = r.telemetry.track!.station,
        maxLateral = 0,
        peakLoad = 0,
        contacts = 0,
        steps = 0;
      for (
        ;
        steps < Math.ceil((c.length / target + 100) * 120) &&
        travelled < c.length + 10;
        steps++
      ) {
        const t = r.telemetry,
          lookahead = 6 + t.speed * 0.4,
          aim = c
            .frame(t.track!.station + lookahead)
            .position.sub(new Vector3().copy(t.position)),
          q = new Quaternion().copy(t.rotation);
        const angle = Math.atan2(
          aim.dot(new Vector3(-1, 0, 0).applyQuaternion(q)),
          aim.dot(new Vector3(0, 0, 1).applyQuaternion(q)),
        );
        const steer =
          (Math.atan2(2 * r.setup.wheelbase * Math.sin(angle), lookahead) /
            r.setup.steeringLimit) *
          (1 + (r.setup.speedSteering * t.speed) / 18);
        const k = Math.max(
            ...[0, 10, 25, 45].map((a) =>
              Math.abs(c.alignment.sample(t.track!.station + a).curvature),
            ),
          ),
          cornerSpeed = Math.min(
            target,
            Math.sqrt((0.55 * 9.81) / Math.max(0.0001, k)),
          );
        r.step({
          throttle: Math.max(0, Math.min(1, (cornerSpeed - t.speed) * 0.5)),
          brake: Math.max(0, Math.min(1, (t.speed - cornerSpeed) * 0.4)),
          steer: Math.max(-1, Math.min(1, steer)),
        });
        const delta = r.telemetry.track!.station - previous;
        travelled += delta < -c.length / 2 ? delta + c.length : delta;
        previous = r.telemetry.track!.station;
        maxLateral = Math.max(maxLateral, Math.abs(r.telemetry.track!.lateral));
        peakLoad = Math.max(
          peakLoad,
          r.telemetry.totalLoad / (r.setup.mass * 9.81),
        );
        if (r.telemetry.groundedCount === 4) contacts++;
      }
      expect(travelled).toBeGreaterThan(c.length);
      expect(maxLateral).toBeLessThan(1.5);
      expect(contacts / steps).toBeGreaterThan(0.99);
      expect(peakLoad).toBeLessThan(1.9);
    },
    45000,
  );
});
