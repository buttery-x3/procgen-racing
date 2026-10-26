import { seededRandom } from "../core/math";
import { Alignment } from "./Alignment";
import { bakeCircuit, compileCircuit } from "./SurfaceCompiler";
import { hashSeed, naturalHeight } from "./Terrain";
import { normalizeRecipe } from "./generationTypes";
import type {
  GenerationRecipe,
  GenerationResult,
  GenerationProgress,
} from "./generationTypes";
import type { CircuitDefinition, ProfileKey, SurfaceId } from "./types";
import { validateCircuit } from "./validateCircuit";

const flat = (value: number): ProfileKey[] => [
  { at: 0, value },
  { at: 1, value },
];
function shell(points: CircuitDefinition["controlPoints"]): CircuitDefinition {
  return {
    id: "candidate",
    name: "Candidate",
    controlPoints: points,
    elevation: flat(24),
    leftWidth: flat(7),
    rightWidth: flat(7),
    bankStrength: flat(0),
    crown: flat(0.025),
    kerbs: [],
    sections: [{ start: 0, name: "01 / Start straight", runoff: "runoff" }],
    starts: [
      {
        id: "start",
        name: "Starting grid",
        at: 0.012,
        description: "Level starting straight. W / right trigger to drive.",
      },
    ],
    site: { centre: { x: 0, z: 0 }, radius: 1400 },
  };
}

/** Compose ordered sectors around a reserved site, with a long collinear grid.
 * Sector motifs alter point count, radii and curvature sign, rather than jittering
 * the authored M3 circuit. Periodic B-splines distribute closure through the loop.
 */
function candidate(
  recipe: GenerationRecipe,
  attempt: number,
  fallback: boolean,
) {
  const random = seededRandom(hashSeed(`${recipe.seed}/layout/v1/${attempt}`));
  const w = fallback ? 360 : 310 + random() * 110,
    h = fallback ? (recipe.family === "gp" ? 300 : 250) : 220 + random() * 120;
  const points = [
    { x: 0, z: -h },
    { x: w * 0.42, z: -h },
    { x: w * 0.84, z: -h },
  ];
  const sectors = fallback ? 7 : 6 + Math.floor(random() * 3);
  const complex = 1 + Math.floor(random() * (sectors - 2)),
    secondComplex = (complex + Math.floor(sectors / 2)) % sectors;
  const phase = random() * Math.PI * 2,
    rhythm = 2 + Math.floor(random() * 2);
  for (let i = 0; i < sectors; i++) {
    const angle =
      ((60 +
        (i * 240) / (sectors - 1) +
        (i > 0 && i < sectors - 1 ? (random() - 0.5) * 9 : 0)) *
        Math.PI) /
      180;
    const radius = fallback
      ? 1
      : 0.98 + 0.09 * Math.sin(angle * rhythm + phase) + (random() - 0.5) * 0.1;
    const emit = (offset: number, r: number) =>
      points.push({
        x: Math.sin(angle + offset) * w * r,
        z: -Math.cos(angle + offset) * h * r,
      });
    if (!fallback && i === complex && i > 0 && i < sectors - 1) {
      // A tightening double apex or short left/right complex; gentler on GP layouts.
      const pinch = recipe.family === "gp" ? 0.68 : 0.62;
      emit(-0.3, radius);
      emit(0, radius * pinch);
      emit(0.3, radius);
    } else emit(0, radius * (!fallback && i === secondComplex ? 0.91 : 1));
  }
  points.push({ x: -w * 0.84, z: -h }, { x: -w * 0.42, z: -h });
  const definition = shell(points),
    original = new Alignment(definition),
    scale = recipe.targetLength / original.length;
  points.forEach((p) => {
    p.x *= scale;
    p.z *= scale;
  });
  const terrain = {
    seed: hashSeed(`${recipe.seed}/terrain/v1`),
    amplitude: recipe.relief === "rolling" ? 32 : 12,
    wavelength: recipe.targetLength * 0.24,
    baseHeight: 24,
  };
  definition.site.terrain = terrain;
  // Choose the site's heading by grading cost, including the level grid. Each
  // candidate sees the same terrain; rotations cannot change its seed.
  let best = Infinity,
    bestPoints = points;
  const heading = random() * Math.PI * 2;
  for (let option = 0; option < 6; option++) {
    const angle = heading + (option * Math.PI) / 3,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const rotated = points.map((p) => ({
      x: p.x * c - p.z * s,
      z: p.x * s + p.z * c,
    }));
    const path = new Alignment({ ...definition, controlPoints: rotated }),
      heights = Array.from({ length: 48 }, (_, i) => {
        const p = path.sample((i * path.length) / 48).position;
        return naturalHeight(terrain, p.x, p.z);
      });
    const grid = (heights[0] + heights[1] + heights[47]) / 3;
    const cost =
      heights.reduce((sum, y, i) => sum + (y - heights[(i + 1) % 48]) ** 2, 0) +
      5 *
        ((heights[0] - grid) ** 2 +
          (heights[1] - grid) ** 2 +
          (heights[47] - grid) ** 2);
    if (cost < best) {
      best = cost;
      bestPoints = rotated;
    }
  }
  definition.controlPoints = bestPoints;
  let alignment = new Alignment(definition);
  const levels = [
    0, 0.06, 0.14, 0.23, 0.32, 0.41, 0.5, 0.59, 0.68, 0.77, 0.86, 0.94, 1,
  ];
  let heights = levels.map((at) => {
    const p = alignment.sample(at * alignment.length).position;
    return naturalHeight(terrain, p.x, p.z);
  });
  const grid = (heights[0] + heights[1] + heights.at(-2)!) / 3;
  for (let pass = 0; pass < 2; pass++)
    heights = heights.map((y, i) =>
      i < 2 || i >= heights.length - 2
        ? grid
        : (heights[i - 1] + 2 * y + heights[i + 1]) / 4,
    );
  let verticalScale = 1;
  for (let i = 1; i < levels.length; i++) {
    const ds = (levels[i] - levels[i - 1]) * alignment.length,
      dy = Math.abs(heights[i] - heights[i - 1]);
    if (dy > 0)
      verticalScale = Math.min(
        verticalScale,
        (0.05 * ds) / (1.875 * dy),
        (0.0007 * ds * ds) / (5.78 * dy),
      );
  }
  definition.elevation = levels.map((at, i) => ({
    at,
    value: grid + (heights[i] - grid) * verticalScale,
  }));
  const widthKeys = [
      0, 0.07, 0.16, 0.27, 0.39, 0.51, 0.63, 0.75, 0.86, 0.93, 1,
    ],
    gridWidth = recipe.family === "gp" ? 16 : 15;
  const widths = widthKeys.map((_, i) =>
    i < 2 || i >= widthKeys.length - 2
      ? gridWidth
      : (recipe.family === "gp" ? 12.3 : 10.5) + random() * 2.5,
  );
  const shifts = widthKeys.map((_, i) =>
    i < 2 || i >= widthKeys.length - 2 ? 0 : (random() - 0.5) * 0.5,
  );
  definition.leftWidth = widthKeys.map((at, i) => ({
    at,
    value: widths[i] / 2 + shifts[i],
  }));
  definition.rightWidth = widthKeys.map((at, i) => ({
    at,
    value: widths[i] / 2 - shifts[i],
  }));
  definition.bankStrength = [
    { at: 0, value: 0 },
    { at: 0.08, value: 0 },
    { at: 0.2, value: 8 },
    { at: 0.8, value: 8 },
    { at: 0.92, value: 0 },
    { at: 1, value: 0 },
  ];
  alignment = new Alignment(definition);
  // Read back actual curvature for kerb placement and meaningful sector labels.
  const count = 128,
    threshold = recipe.family === "gp" ? 0.0025 : 0.0035;
  const categories = Array.from({ length: count }, (_, i) => {
    const k = alignment.sample(
      ((i + 0.5) / count) * alignment.length,
    ).curvature;
    return Math.abs(k) < threshold ? 0 : Math.sign(k);
  });
  for (let i = 1; i < count - 1; i++)
    if (categories[i - 1] === categories[i + 1])
      categories[i] = categories[i - 1];
  const runs: { start: number; end: number; kind: number }[] = [];
  for (let i = 0; i < count; i++) {
    if (!runs.length || runs.at(-1)!.kind !== categories[i])
      runs.push({
        start: i / count,
        end: (i + 1) / count,
        kind: categories[i],
      });
    else runs.at(-1)!.end = (i + 1) / count;
  }
  const surfaces: SurfaceId[] = ["gravel", "runoff", "grass", "sand"];
  definition.sections = runs.map((run, i) => {
    const k = Math.abs(
      alignment.sample(((run.start + run.end) / 2) * alignment.length)
        .curvature,
    );
    return {
      start: run.start,
      name: `${String(i + 1).padStart(2, "0")} / ${i === 0 ? "Start straight" : !run.kind ? "Link straight" : k > 0.012 ? "Tightening corner" : k > 0.005 ? "Technical bend" : "Fast sweeper"}`,
      runoff:
        i === 0 || i === runs.length - 1
          ? "runoff"
          : surfaces[Math.floor(random() * surfaces.length)],
    };
  });
  for (const run of runs.filter(
    (r) => r.kind && (r.end - r.start) * alignment.length > 25,
  )) {
    const side = run.kind > 0 ? "left" : "right",
      outside = run.kind > 0 ? "right" : "left",
      trim = 6 / alignment.length;
    definition.kerbs.push({
      start: run.start + trim,
      end: run.end - trim,
      side,
    });
    const length = (run.end - run.start) * alignment.length;
    if (length > 65) {
      definition.kerbs.push({
        start: run.start,
        end: run.start + Math.min(28, length * 0.25) / alignment.length,
        side: outside,
      });
      definition.kerbs.push({
        start: run.end - Math.min(32, length * 0.25) / alignment.length,
        end: run.end,
        side: outside,
      });
    }
  }
  const samples = Array.from({ length: 256 }, (_, i) =>
    alignment.sample((i * alignment.length) / 256),
  );
  const summit = samples.reduce((a, b) =>
      a.position.y > b.position.y ? a : b,
    ),
    tightest = samples.reduce((a, b) =>
      Math.abs(a.curvature) > Math.abs(b.curvature) ? a : b,
    );
  definition.starts.push(
    {
      id: "sector",
      name: "Middle sector",
      at: 0.4,
      description:
        "Start in the middle sector to compare elevation and corner balance.",
    },
    {
      id: "summit",
      name: "Highest point",
      at: summit.station / alignment.length,
      description:
        "The highest point of this seed. Check road-relative pitch and roll.",
    },
    {
      id: "corner",
      name: "Tightest corner",
      at: tightest.station / alignment.length,
      description:
        "The tightest bend. Compare the four wheel loads and tyre slip.",
    },
  );
  const start = alignment.sample(0),
    padSide = 1; // grid's physical left is outside this winding
  definition.site.paddock = {
    centre: {
      x: start.position.x + start.left.x * padSide * 58,
      z: start.position.z + start.left.z * padSide * 58,
    },
    forward: { x: start.forward.x, z: start.forward.z },
    length: Math.min(240, recipe.targetLength * 0.095),
    width: 70,
    height: grid,
  };
  definition.site.radius =
    Math.max(...bestPoints.map((p) => Math.hypot(p.x, p.z))) +
    Math.max(250, recipe.targetLength * 0.12);
  definition.id = `${recipe.family}-v1-${hashSeed(JSON.stringify(recipe)).toString(16)}-${fallback ? "fallback" : attempt}`;
  definition.name = `${recipe.family === "gp" ? "Grand Prix" : "Touring"} / ${recipe.seed}`;
  // Quantise authored data, not runtime physics, to keep recipes/fingerprints
  // insensitive to sub-micrometre transcendental differences between engines.
  return JSON.parse(
    JSON.stringify(definition, (_key, value) =>
      typeof value === "number" && !Number.isInteger(value)
        ? Number(value.toFixed(8))
        : value,
    ),
  ) as CircuitDefinition;
}

export function generateLegacyCircuit(
  input: GenerationRecipe,
  options: {
    maxAttempts?: number;
    progress?: (value: GenerationProgress) => void;
  } = {},
): GenerationResult {
  const recipe = normalizeRecipe(input),
    attempts: GenerationResult["attempts"] = [],
    limit = Math.max(0, Math.min(6, options.maxAttempts ?? 4));
  for (let index = 0; index <= limit; index++) {
    const fallback = index === limit;
    options.progress?.({
      stage: fallback
        ? "Checking conservative fallback"
        : "Fitting terrain & composing sectors",
      fraction: 0.05 + (index / (limit + 1)) * 0.7,
    });
    try {
      const definition = candidate(recipe, index, fallback);
      let report = validateCircuit(definition, recipe);
      // Fit banking to the measured transition/vertical budget, instead of
      // retaining abrupt camber in a short complex or reducing road clearance.
      for (
        let pass = 0;
        pass < 4 &&
        (report.metrics.maxBankRate > 0.0024 ||
          report.metrics.crestG > 0.36 ||
          report.metrics.compressionG > 0.6);
        pass++
      ) {
        definition.bankStrength.forEach((k) => (k.value *= 0.6));
        report = validateCircuit(definition, recipe);
      }
      if (!report.valid) {
        const reasons = report.checks
          .filter((c) => c.status === "fail")
          .map((c) => `${c.name}: ${c.detail}`);
        attempts.push({ attempt: index + 1, reasons });
        if (fallback)
          throw new Error(`Fallback validation failed: ${reasons.join("; ")}`);
        continue;
      }
      options.progress?.({
        stage: "Compiling shared road & terrain surfaces",
        fraction: 0.8,
      });
      const circuit = compileCircuit(definition);
      // Validate the transferred Float32 mesh too, including infield terrain.
      for (const chunk of circuit.chunks)
        for (let i = 0; i < chunk.indices.length; i += 3) {
          const a = chunk.indices[i] * 3,
            b = chunk.indices[i + 1] * 3,
            c = chunk.indices[i + 2] * 3,
            v = chunk.vertices;
          const up =
            (v[b + 2] - v[a + 2]) * (v[c] - v[a]) -
            (v[b] - v[a]) * (v[c + 2] - v[a + 2]);
          if (!Number.isFinite(up) || up <= 0)
            throw new Error(
              "Compiled mesh contains folded or degenerate terrain triangles.",
            );
        }
      report.checks.push({
        name: "Shared surface mesh",
        status: "pass",
        detail: `${circuit.triangleCount.toLocaleString("en-US")} upward-facing triangles · visual and collision geometry identical`,
      });
      options.progress?.({ stage: "Preview ready", fraction: 1 });
      return {
        recipe,
        circuit: bakeCircuit(circuit),
        report,
        attempts,
        fallback,
        fingerprint: `v1-${hashSeed(JSON.stringify(definition)).toString(16).padStart(8, "0")}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (fallback)
        throw new Error(
          `Could not generate ${recipe.family} seed “${recipe.seed}”: ${message}`,
        );
      attempts.push({ attempt: index + 1, reasons: [message] });
    }
  }
  throw new Error("Generation exhausted its bounded candidate budget.");
}
