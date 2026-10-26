import { Alignment } from "../Alignment";
import { compileCircuit, bakeCircuit } from "../SurfaceCompiler";
import { hashSeed, naturalHeight } from "../Terrain";
import { networkDefinition } from "./Network";
import { ovalDefinition } from "./Oval";
import { fitFamilyProfiles } from "./Profiles";
import { validateFamily } from "./validateFamily";
import { normalizeFamilyRecipe } from "./types";
import type { FamilyRecipe } from "./types";
import type {
  DesignReport,
  GenerationProgress,
  GenerationResult,
} from "../generationTypes";
import { referenceLines } from "../design/ReferenceLines";
import type { CircuitDefinition } from "../types";

export function designFamilyCircuit(
  input: FamilyRecipe,
  options: {
    progress?: (p: GenerationProgress) => void;
    reference?: boolean;
  } = {},
) {
  const recipe = normalizeFamilyRecipe(input);
  options.progress?.({
    stage: "Surveying the inherited road network and selecting a closed cycle",
    fraction: 0.06,
  });
  const definition =
    recipe.family === "oval" || recipe.family === "hybrid"
      ? ovalDefinition(recipe)
      : networkDefinition(recipe);
  options.progress?.({
    stage: "Fitting junctions, lane banking, elevation and width",
    fraction: 0.25,
  });
  fitFamilyProfiles(definition, recipe);
  return inspectFamilyDefinition(
    definition,
    recipe,
    options.reference !== false,
  );
}

export function inspectFamilyDefinition(
  definition: CircuitDefinition,
  recipe: FamilyRecipe,
  withReference = true,
) {
  const report = validateFamily(definition, recipe),
    meta = definition.familyDesign!,
    path = new Alignment(definition);
  if (!report.valid)
    throw new Error(
      `M7 ${recipe.family} seed ${recipe.seed}: ${report.checks
        .filter((c) => c.status === "fail")
        .map((c) => `${c.name}: ${c.detail}`)
        .join("; ")}`,
    );
  const samples = Array.from({ length: Math.ceil(path.length / 20) }, (_, i) =>
      path.sample((i * path.length) / Math.ceil(path.length / 20)),
    ),
    inheritedShare = meta.route.reduce(
      (s, r) => s + (r.origin === "new-connector" ? 0 : r.end - r.at),
      0,
    ),
    lines = withReference ? referenceLines(definition) : [];
  const design: DesignReport = {
    generator: "circuit-v3.1",
    mode:
      recipe.family === "oval"
        ? "oval"
        : recipe.family === "hybrid"
          ? "hybrid"
          : "network",
    proposalCount: 1,
    feasibleCount: 1,
    closureShare: 0,
    closureAdjustment: 0,
    fittingDeviation: 0,
    directionChanges: samples.reduce(
      (s, r, i) =>
        s +
        (i &&
        Math.sign(r.curvature) !== Math.sign(samples[i - 1].curvature) &&
        Math.abs(r.curvature) > 0.002
          ? 1
          : 0),
      0,
    ),
    longStraights: meta.route.filter(
      (r) =>
        r.role.toLowerCase().includes("straight") &&
        (r.end - r.at) * path.length > 150,
    ).length,
    hullOccupancy: 0,
    cutFillRms: report.metrics.earthworkRms,
    cutFillMax: Math.max(
      ...samples.map((r) =>
        Math.abs(
          r.position.y -
            naturalHeight(definition.site.terrain!, r.position.x, r.position.z),
        ),
      ),
    ),
    earthworkVolume:
      report.metrics.earthworkRms * report.metrics.maxWidth * path.length,
    retainedRelief:
      report.metrics.elevationRange /
      Math.max(
        1,
        Math.max(
          ...samples.map((r) =>
            naturalHeight(definition.site.terrain!, r.position.x, r.position.z),
          ),
        ) -
          Math.min(
            ...samples.map((r) =>
              naturalHeight(
                definition.site.terrain!,
                r.position.x,
                r.position.z,
              ),
            ),
          ),
      ),
    siteFeatures: meta.network.nodes
      .filter((_, i) => i % 3 === 0)
      .map((n) => ({
        id: n.id,
        x: n.x,
        z: n.z,
        height: n.height,
        slope: 0,
        kind: n.role === "pass" ? "ridge" : "flat",
      })),
    motifs: meta.route.map((r) => ({
      at: r.at,
      end: r.end,
      role: r.role,
      speed: report.metrics.designSpeed,
    })),
    diagnostics: samples.map((r, i) => ({
      at: i / samples.length,
      natural: naturalHeight(
        definition.site.terrain!,
        r.position.x,
        r.position.z,
      ),
      road: r.position.y,
      speed:
        lines[0]?.points[
          Math.floor((i / samples.length) * lines[0].points.length)
        ]?.speed ?? report.metrics.designSpeed,
      grade: r.grade,
      bank: r.bank,
      width: r.leftWidth + r.rightWidth,
      curvature: r.curvature,
      clearance: report.metrics.clearance,
      cutFill:
        r.position.y -
        naturalHeight(definition.site.terrain!, r.position.x, r.position.z),
    })),
    reservations: definition.site.paddock
      ? [
          {
            kind: "paddock",
            x: definition.site.paddock.centre.x,
            z: definition.site.paddock.centre.z,
            width: definition.site.paddock.width,
            length: definition.site.paddock.length,
            heading: Math.atan2(
              definition.site.paddock.forward.x,
              definition.site.paddock.forward.z,
            ),
          },
        ]
      : [],
    candidateScores: [
      {
        earthwork: report.metrics.earthworkRms,
        rhythm: 1,
        site: inheritedShare,
        accepted: true,
      },
    ],
    rejections: {},
    referenceLines: lines,
  };
  meta.compatibility = lines.map((l) => ({
    vehicle: l.vehicle,
    peakSpeed: Math.max(...l.points.map((p) => p.speed)),
    minimumRadius: report.metrics.minRadius,
    notes:
      "Curvature, lane banking, grade and crest-limited estimate; no lap-time or race-control claim.",
  }));
  return {
    recipe,
    definition,
    report,
    design,
    attempts: [],
    fallback: false,
    fingerprint: `v3-${hashSeed(JSON.stringify({ recipe, definition })).toString(16)}`,
    family: {
      inheritedShare,
      connectorShare: 1 - inheritedShare,
      networkNodes: meta.network.nodes.length,
      networkEdges: meta.network.edges.length,
      junctions: meta.route.filter((r) => r.role.includes("junction")).length,
      variants: meta.variants.length,
      laneBankRange: [0, report.metrics.maxBank] as [number, number],
      maxLaneBankRate: report.metrics.maxBankRate,
      branchIds: ["main"],
      transferBytes: 0,
      surfaceChunks: 0,
      triangles: 0,
    },
  };
}
export function generateFamilyCircuit(
  recipe: FamilyRecipe,
  options: { progress?: (p: GenerationProgress) => void } = {},
): GenerationResult {
  const result = designFamilyCircuit(recipe, options);
  options.progress?.({
    stage: "Compiling the shared road, apron and terrain surfaces",
    fraction: 0.5,
  });
  const circuit = compileCircuit(result.definition),
    family = {
      ...result.family,
      surfaceChunks: circuit.chunks.length,
      triangles: circuit.triangleCount,
      transferBytes: circuit.chunks.reduce(
        (n, c) =>
          n +
          c.vertices.byteLength +
          c.indices.byteLength +
          c.colors.byteLength,
        0,
      ),
    };
  options.progress?.({ stage: "Closed venue design ready", fraction: 1 });
  const { definition: _, ...metadata } = result;
  return { ...metadata, circuit: bakeCircuit(circuit), family };
}
