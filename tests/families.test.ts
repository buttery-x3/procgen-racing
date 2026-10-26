import { beforeAll, describe, expect, it } from "vitest";
import { Alignment } from "../src/track/Alignment";
import { designFamilyCircuit } from "../src/track/families/generateFamilyCircuit";
import {
  DEFAULT_FAMILY_RECIPE,
  FAMILY_PRESETS,
} from "../src/track/families/types";
import type { ExpandedFamily, FamilyRecipe } from "../src/track/families/types";
import { ovalHeight, laneBank } from "../src/track/families/OvalSurface";
import { hydrateCircuit } from "../src/track/SurfaceCompiler";
import { generateVenueCircuit } from "../src/track/venue/constructVenue";
import { DEFAULT_VENUE } from "../src/track/venue/types";
import { CircuitPhysics } from "../src/physics/CircuitPhysics";
import RAPIER from "@dimforge/rapier3d-compat";
import { initializePhysics, SuspensionRig } from "../src/physics/SuspensionRig";
import { REFERENCE_CARS } from "../src/vehicle/referenceCars";
import { CircuitView } from "../src/rendering/CircuitView";
import {
  circuitArchive,
  decodeCircuitArchive,
  restoreCircuitArchive,
} from "../src/storage/CircuitStorage";
import { ChunkIndex, tileMesh } from "../src/track/ChunkIndex";
const recipe = (
  family: ExpandedFamily,
  extra: Partial<FamilyRecipe> = {},
): FamilyRecipe => ({
  ...DEFAULT_FAMILY_RECIPE,
  family,
  seed: "m7-test-42",
  targetLength: FAMILY_PRESETS[family].length,
  ...extra,
});
const plans = new Map<ExpandedFamily, ReturnType<typeof designFamilyCircuit>>();
let oval: ReturnType<typeof hydrateCircuit>,
  long: ReturnType<typeof hydrateCircuit>,
  longResult: ReturnType<typeof generateVenueCircuit>;
beforeAll(async () => {
  await initializePhysics();
  for (const family of Object.keys(FAMILY_PRESETS) as ExpandedFamily[])
    plans.set(family, designFamilyCircuit(recipe(family)));
  oval = hydrateCircuit(
    generateVenueCircuit(recipe("oval", { banking: "fast" }), DEFAULT_VENUE)
      .circuit,
  );
  longResult = generateVenueCircuit(
    recipe("endurance", {
      targetLength: 24000,
      relief: "rolling",
      envelope: "terrain",
    }),
    DEFAULT_VENUE,
  );
  long = hydrateCircuit(longResult.circuit);
}, 120000);
describe("M7 closed road networks and dedicated oval grammar", () => {
  it.each(["street", "airfield", "mountain"] as const)(
    "keeps short-kink bank transitions smooth on %s",
    (family) => {
      for (const seed of [3, 150, 231, 357, 453, 562, 795])
        expect(
          designFamilyCircuit(
            recipe(family, {
              seed: `m7-${seed}`,
              targetLength: FAMILY_PRESETS[family].min,
              character: "flowing",
              layout: 1,
            }),
          ).report.valid,
        ).toBe(true);
    },
  );
  it("canonicalises axis round-off before triangulating an oval pit access", () => {
    const r = generateVenueCircuit(
      recipe("hybrid", {
        seed: "m7-21",
        targetLength: 2800,
        variant: "speedway",
        oval: "tri-oval",
        character: "flowing",
        relief: "rolling",
        banking: "fast",
      }),
      DEFAULT_VENUE,
    );
    expect(r.report.valid).toBe(true);
    expect(r.circuit.triangleCount).toBeGreaterThan(10000);
  });
  it.each(Object.keys(FAMILY_PRESETS) as ExpandedFamily[])(
    "constructs a qualified %s with real provenance and route cycles",
    (family) => {
      const p = plans.get(family)!,
        m = p.definition.familyDesign!,
        v = m.variants.find((v) => v.id === m.activeVariant)!;
      expect(p.report.valid).toBe(true);
      expect(m.layer).toBe(0);
      expect(v.length).toBeGreaterThan(750);
      const edges = new Map(m.network.edges.map((e) => [e.id, e]));
      expect(new Set(v.nodeIds).size).toBe(v.nodeIds.length);
      v.edgeIds.forEach((id, i) => {
        const e = edges.get(id)!;
        expect([e.from, e.to]).toContain(v.nodeIds[i]);
        expect([e.from, e.to]).toContain(v.nodeIds[(i + 1) % v.nodeIds.length]);
      });
      expect(m.route[0].at).toBe(0);
      expect(m.route.at(-1)!.end).toBe(1);
      m.route.forEach((span, i) => {
        expect(edges.has(span.edgeId)).toBe(true);
        if (i) expect(span.at).toBe(m.route[i - 1].end);
      });
    },
  );
  it("is deterministic and selects alternatives/club layouts on the exact same inherited roads", () => {
    const a = plans.get("rural")!,
      b = designFamilyCircuit(recipe("rural", { layout: 2 })),
      club = designFamilyCircuit(recipe("rural", { variant: "club" }));
    expect(designFamilyCircuit(recipe("rural")).definition).toEqual(
      a.definition,
    );
    expect(b.definition.controlPoints).not.toEqual(a.definition.controlPoints);
    expect(club.report.metrics.length).toBeLessThan(a.report.metrics.length);
    const fixed = (d: typeof a) =>
      d.definition.familyDesign!.network.edges.filter(
        (e) => e.origin !== "new-connector",
      );
    expect(fixed(a)).toEqual(fixed(b));
    expect(fixed(a)).toEqual(fixed(club));
  });
  it("keeps urban blocks/arterials, contour roads and airfield axes distinct", () => {
    const urban = plans.get("street")!.definition.familyDesign!,
      rural = plans.get("rural")!.definition.familyDesign!,
      air = plans.get("airfield")!.definition.familyDesign!;
    expect(
      urban.network.edges.some((e) => {
        const [a, b] = [e.from, e.to].map((s) => s.split(":").map(Number));
        return a[0] !== b[0] && a[1] !== b[1];
      }),
    ).toBe(true);
    expect(urban.network.lots.some((l) => l.use === "road-easement")).toBe(
      true,
    );
    expect(rural.route.some((r) => r.origin === "new-connector")).toBe(true);
    expect(
      air.network.edges.some((e) => e.origin === "runway" && e.width === 22),
    ).toBe(true);
    expect(air.network.edges.some((e) => e.origin === "taxiway")).toBe(true);
  });
  it.each(["oval", "tri-oval", "asymmetric"] as const)(
    "qualifies minimum/maximum %s speedways without the GP camber mask",
    (shape) => {
      for (const length of [800, 4400]) {
        const d = designFamilyCircuit(
          recipe("oval", {
            oval: shape,
            targetLength: length,
            banking: "fast",
          }),
        );
        expect(d.report.valid).toBe(true);
        expect(d.report.metrics.maxBank).toBeGreaterThan(0.1);
        expect(d.definition.kerbs).toHaveLength(0);
      }
    },
  );
  it("uses the same speedway facility for full, sprint and oval hybrid variants", () => {
    const full = plans.get("hybrid")!,
      short = designFamilyCircuit(recipe("hybrid", { variant: "club" })),
      speedway = designFamilyCircuit(recipe("hybrid", { variant: "speedway" }));
    expect(short.report.metrics.length).toBeLessThan(
      full.report.metrics.length,
    );
    expect(
      speedway.definition.familyDesign!.route.every(
        (r) => r.origin === "speedway",
      ),
    ).toBe(true);
    expect(full.definition.familyDesign!.network).toEqual(
      short.definition.familyDesign!.network,
    );
    expect(full.definition.familyDesign!.network).toEqual(
      speedway.definition.familyDesign!.network,
    );
    expect(
      full.report.metrics.maxWidth - full.report.metrics.minWidth,
    ).toBeGreaterThan(4);
  });
});
describe("M7 progressive bank, apron and contact", () => {
  it("places hybrid lane starts on the speedway bank instead of the tighter infield", () => {
    const p = plans.get("hybrid")!,
      path = new Alignment(p.definition);
    for (const id of ["summit", "lane-low", "lane-middle", "lane-high"]) {
      const start = p.definition.starts.find((s) => s.id === id)!,
        row = path.sample(start.at * path.length);
      expect(row.oval!.blend).toBeGreaterThan(0.9);
      expect(Math.abs(row.bank)).toBeGreaterThan(0.1);
      expect(row.leftWidth + row.rightWidth).toBeGreaterThan(20);
    }
  });
  it("has different low/high lane normals and C2 height joins at the apron edges", () => {
    const s = oval.rows.reduce((a, b) =>
        Math.abs(a.bank) > Math.abs(b.bank) ? a : b,
      ),
      o = s.oval!,
      inner = o.inside > 0 ? s.leftWidth : s.rightWidth;
    expect(Math.abs(laneBank(s, -o.inside * 7))).toBeGreaterThan(
      Math.abs(laneBank(s, o.inside * 7)) + 0.05,
    );
    for (const l of [o.inside * inner, o.inside * (inner + o.apronWidth)]) {
      const e = 0.001,
        d = (x: number) =>
          (ovalHeight(s, x + e) - ovalHeight(s, x - e)) / (2 * e);
      expect(Math.abs(d(l - e) - d(l + e))).toBeLessThan(0.002);
    }
    const frame = oval.frame(s.station, -o.inside * 7);
    expect(frame.normal.y).toBeLessThan(0.99);
    expect(frame.normal.y).toBeGreaterThan(0.9);
  });
  it.each(["lane-low", "lane-middle", "lane-high"])(
    "settles all four wheels on the %s banked lane",
    (start) => {
      const rig = new SuspensionRig(REFERENCE_CARS.fr.setup);
      try {
        rig.setCircuit(oval);
        rig.setCircuitStart(start);
        for (let i = 0; i < 480; i++)
          rig.step({ steer: 0, throttle: 0, brake: 1 });
        expect(rig.telemetry.groundedCount).toBe(4);
        expect(
          rig.telemetry.totalLoad / (rig.setup.mass * 9.81),
        ).toBeGreaterThan(0.8);
        expect(rig.telemetry.totalLoad / (rig.setup.mass * 9.81)).toBeLessThan(
          1.3,
        );
      } finally {
        rig.dispose();
      }
    },
  );
});
describe("M7 24 km streaming, progress and durable circuits", () => {
  it("bounds collision residency, retires old tiles and reloads exact distant surfaces", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }),
      physics = new CircuitPhysics(world, long);
    try {
      for (let s = 0; s < long.length; s += 350) {
        const row = long.alignment.sample(s);
        physics.update(row.position, true);
        world.step();
        const ray = new RAPIER.Ray(
            { ...row.position, y: row.position.y + 10 },
            { x: 0, y: -1, z: 0 },
          ),
          hit = world.castRay(ray, 30, true);
        expect(hit).not.toBeNull();
        expect(physics.stats.surfaceChunks).toBeLessThanOrEqual(112);
        expect(physics.stats.obstacleChunks).toBeLessThanOrEqual(112);
      }
      expect(physics.stats.retired).toBeGreaterThan(100);
      expect(physics.stats.created).toBeGreaterThan(
        physics.stats.materialColliders + physics.stats.obstacleColliders,
      );
      physics.update(long.rows[0].position, true);
      expect(physics.stats.surfaceChunks).toBeGreaterThan(0);
    } finally {
      physics.dispose();
      world.free();
    }
  });
  it("localizes nearby legs and ignores arbitrary height on the single supported layer", () => {
    for (let s = 0; s < long.length; s += 31) {
      const row = long.alignment.sample(s),
        location = long.locate({ ...row.position, y: -500 });
      const error = Math.abs(location.station - s);
      expect(Math.min(error, long.length - error)).toBeLessThan(0.7);
      expect(location.variantId).toBe("full");
      expect(location.layer).toBe(0);
    }
    expect(long.queryStats!.maxCandidates).toBeLessThan(300);
    const pit = long.definition.venue!.pit!,
      p = pit.points[Math.floor(pit.points.length / 2)];
    expect(long.locate(p).branchId).toBe("pit");
  });
  it("limits GPU surface residency and disposes retired resources only once", () => {
    const view = new CircuitView(long);
    view.update(long.rows[0].position, true);
    expect(view.streamStats.overviewTriangles).toBeGreaterThan(0);
    let disposed = 0;
    view.group.traverse((object) => {
      const mesh = object as import("three").Mesh;
      if (mesh.geometry)
        mesh.geometry.addEventListener("dispose", () => disposed++);
    });
    for (let s = 0; s < long.length; s += 500)
      view.update(long.alignment.sample(s).position, false);
    expect(view.streamStats.surfaceMeshes).toBeLessThanOrEqual(112);
    expect(view.streamStats.retired).toBeGreaterThan(0);
    view.dispose();
    const once = disposed;
    view.dispose();
    expect(disposed).toBe(once);
  });
  it("exports and restores an accepted long circuit without regenerating its definition", () => {
    const archive = circuitArchive(longResult),
      raw = JSON.stringify(archive);
    expect(raw.length).toBeLessThan(4_000_000);
    const restored = restoreCircuitArchive(decodeCircuitArchive(raw));
    expect(JSON.stringify(restored.circuit.definition)).toBe(
      JSON.stringify(longResult.circuit.definition),
    );
    expect(restored.fingerprint).toBe(longResult.fingerprint);
    expect(restored.circuit.triangleCount).toBe(
      longResult.circuit.triangleCount,
    );
  }, 30000);
  it("rejects unknown versions, bad checksums, unbounded widths and unordered oval profiles", () => {
    const a = circuitArchive(longResult);
    expect(() =>
      decodeCircuitArchive(JSON.stringify({ ...a, version: 99 })),
    ).toThrow(/version/);
    expect(() =>
      decodeCircuitArchive(JSON.stringify({ ...a, definitionHash: "wrong" })),
    ).toThrow(/checksum/);
    const width = structuredClone(a);
    delete (width as Partial<typeof width>).definitionHash;
    width.definition.leftWidth[0].value = 1000;
    expect(() => decodeCircuitArchive(JSON.stringify(width))).toThrow(
      /width|profile/,
    );
    const bank = circuitArchive({
      ...longResult,
      circuit: { ...longResult.circuit, definition: oval.definition },
    });
    bank.recipe = recipe("oval", { banking: "fast" });
    delete (bank as Partial<typeof bank>).definitionHash;
    bank.definition.familyDesign!.oval!.innerBank[1].at = 0;
    expect(() => decodeCircuitArchive(JSON.stringify(bank))).toThrow(
      /profile/i,
    );
  });
  it("uses real bounds for chunk queries and keeps split triangles bit-identical", () => {
    const index = new ChunkIndex([
      { minX: -500, maxX: 500, minZ: -1, maxZ: 1 },
      { minX: 800, maxX: 900, minZ: 800, maxZ: 900 },
    ]);
    expect(index.query({ x: 490, z: 0 }, 5)).toEqual([0]);
    const vertices = new Float32Array([127, 0, 0, 130, 0, 0, 127, 0, 5]),
      indices = new Uint32Array([0, 2, 1]),
      tiles = tileMesh({ vertices, indices });
    expect([...tiles[0].vertices].sort()).toEqual([...vertices].sort());
    expect(tiles[0].indices.length).toBe(3);
  });
});
