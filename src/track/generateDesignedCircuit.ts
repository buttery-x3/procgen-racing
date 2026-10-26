import { Alignment } from "./Alignment";
import { hashSeed, naturalHeight } from "./Terrain";
import { bakeCircuit, compileCircuit } from "./SurfaceCompiler";
import { validateCircuit } from "./validateCircuit";
import { createSite } from "./design/SiteGraph";
import { fitRoadProfiles } from "./design/RoadProfiles";
import {
  proposeLayout,
  transformLayout,
  conservativeLayout,
  inspectLayout,
} from "./design/LayoutProposal";
import { hullOccupancy } from "./design/DesignStudy";
import { referenceLines } from "./design/ReferenceLines";
import type { CompiledCircuit } from "./SurfaceCompiler";
import type { LayoutProposal } from "./design/LayoutProposal";
import type {
  DesignRecipe,
  DesignReport,
  GenerationResult,
  GenerationProgress,
} from "./generationTypes";
import type { CircuitDefinition, SurfaceId } from "./types";
import { seededRandom } from "../core/math";

export const DESIGN_VERSION = "circuit-v2.1";
export interface DesignOptions {
  maxAttempts?: number;
  progress?: (value: GenerationProgress) => void;
  compile?: boolean;
  accept?: (definition: CircuitDefinition) => void;
}
export interface DesignedDefinition {
  recipe: DesignRecipe;
  definition: CircuitDefinition;
  report: GenerationResult["report"];
  design: DesignReport;
  attempts: GenerationResult["attempts"];
  fallback: boolean;
  fingerprint: string;
}

function decorate(
  def: CircuitDefinition,
  proposal: LayoutProposal,
  recipe: DesignRecipe,
  fit: ReturnType<typeof fitRoadProfiles>,
) {
  const path = new Alignment(def),
    n = fit.road.length;
  const rows = Array.from({ length: n }, (_, i) =>
    path.sample((i * path.length) / n),
  );
  const threshold = 0.0005,
    signs = rows.map((r) =>
      Math.abs(r.curvature) > threshold ? Math.sign(r.curvature) : 0,
    );
  // Semantics from the proposed motifs remain attached; readback verifies their
  // actual curvature and places corner kerbs only where the road really bends.
  const runs: { start: number; end: number; sign: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (runs.length && runs.at(-1)!.sign === signs[i])
      runs.at(-1)!.end = (i + 1) / n;
    else runs.push({ start: i / n, end: (i + 1) / n, sign: signs[i] });
  }
  const materials: SurfaceId[] = ["gravel", "runoff", "grass", "sand"];
  const random = seededRandom(hashSeed(`${recipe.seed}/surface/v2`));
  const motifAt = (at: number) =>
    proposal.motifs.reduce(
      (selected, m) => (at >= m.at ? m : selected),
      proposal.motifs.at(-1)!,
    );
  def.sections = runs.map((run, i) => {
    const role = motifAt((run.start + run.end) / 2).role;
    return {
      start: run.start,
      name: `${String(i + 1).padStart(2, "0")} / ${run.sign === 0 ? "Straight" : role === "tightening" ? "Tightening complex" : role === "esses" ? "Linked esses" : role === "chicane" ? "Braking chicane" : role === "hairpin" ? "Hairpin" : role === "sweeper" ? "Fast sweep" : "Corner"}`,
      runoff: materials[Math.floor(random() * materials.length)],
    };
  });
  def.kerbs = [];
  for (const run of runs)
    if (run.sign && (run.end - run.start) * path.length > 32) {
      def.kerbs.push({
        start: run.start,
        end: run.end,
        side: run.sign > 0 ? "left" : "right",
      });
      if ((run.end - run.start) * path.length > 65) {
        const side = run.sign > 0 ? "right" : "left";
        const d = 18 / path.length;
        def.kerbs.push({
          start: Math.max(0, run.start - d),
          end: Math.min(1, run.start + d),
          side,
        });
        def.kerbs.push({
          start: Math.max(0, run.end - d),
          end: Math.min(1, run.end + d),
          side,
        });
      }
    }
  const peak = rows.reduce((a, b) => (a.position.y > b.position.y ? a : b)),
    corner = rows.reduce((a, b) =>
      Math.abs(a.curvature) > Math.abs(b.curvature) ? a : b,
    );
  def.starts = [
    {
      id: "start",
      name: "Starting grid",
      at: 0.015,
      description: "Level grid. W / right trigger to drive.",
    },
    {
      id: "sector",
      name: "Far sector",
      at: 0.42,
      description: "Inspect the linked corner sequence.",
    },
    {
      id: "summit",
      name: "Summit",
      at: peak.station / path.length,
      description: "Check suspension loads over the fitted terrain.",
    },
    {
      id: "corner",
      name: "Tightest corner",
      at: corner.station / path.length,
      description:
        "Compare slip and weight transfer through the tightest bend.",
    },
  ];
  const area = rows.reduce((sum, r, i) => {
    const b = rows[(i + 1) % n];
    return sum + r.position.x * b.position.z - b.position.x * r.position.z;
  }, 0);
  const grid = path.sample(0),
    side = area > 0 ? 1 : -1;
  def.site.paddock = {
    centre: {
      x: grid.position.x + grid.left.x * side * 58,
      z: grid.position.z + grid.left.z * side * 58,
    },
    forward: { x: grid.forward.x, z: grid.forward.z },
    width: 62,
    length: recipe.family === "gp" ? 230 : 180,
    height: grid.position.y,
  };
  // Reject land conflicts with other legs; road-local intervals are excluded by
  // geometry, not by a blanket lap-distance neighbourhood.
  const pad = def.site.paddock;
  for (const r of rows) {
    const dx = r.position.x - pad.centre.x,
      dz = r.position.z - pad.centre.z;
    const across = dx * pad.forward.z - dz * pad.forward.x,
      along = dx * pad.forward.x + dz * pad.forward.z;
    if (
      Math.abs(across) <
        pad.width / 2 + Math.max(r.leftWidth, r.rightWidth) + 8 &&
      Math.abs(along) < pad.length / 2 + 12
    )
      throw new Error(
        "Paddock reservation conflicts with another road section.",
      );
  }
  return { rows, runs, motifAt };
}

/** Definition-only mode supports a broad seed campaign without retaining meshes.
 * Production always compiles the exact accepted road and constrained terrain. */
export function designCircuit(
  recipe: DesignRecipe,
  options: DesignOptions = {},
): DesignedDefinition {
  const site = createSite(recipe),
    random = seededRandom(
      hashSeed(`${recipe.seed}/placements/${recipe.layout}`),
    );
  const attempts: GenerationResult["attempts"] = [],
    rejections: Record<string, number> = {};
  const budget = Math.max(
    0,
    Math.min(
      12000,
      options.maxAttempts === undefined ? 6400 : options.maxAttempts,
    ),
  );
  const candidates: {
    proposal: LayoutProposal;
    definition: CircuitDefinition;
    score: number;
    siteScore: number;
    fallback: boolean;
    earthwork: number;
    rhythm: number;
    itinerary: typeof site.features;
  }[] = [];
  let feasible = 0,
    tried = 0;
  options.progress?.({
    stage: "Surveying land and reserving facilities",
    fraction: 0.04,
  });
  for (let attempt = 0; attempt < budget; attempt++) {
    tried++;
    const p = proposeLayout(recipe, attempt);
    if (!p) {
      rejections["Closure / corridor / radius"] =
        (rejections["Closure / corridor / radius"] || 0) + 1;
      continue;
    }
    feasible++;
    for (let placement = 0; placement < 5; placement++) {
      const node =
        site.facilities[(feasible * 3 + placement) % site.facilities.length];
      const itinerary = site.itineraries.get(node.id)!;
      const dx =
        (naturalHeight(site.terrain, node.x + 25, node.z) -
          naturalHeight(site.terrain, node.x - 25, node.z)) /
        50;
      const dz =
        (naturalHeight(site.terrain, node.x, node.z + 25) -
          naturalHeight(site.terrain, node.x, node.z - 25)) /
        50;
      const first = itinerary[1],
        strategicHeading = Math.atan2(first.z - node.z, first.x - node.x);
      const angle =
        placement < 3
          ? (placement === 0 ? strategicHeading : Math.atan2(dx, -dz)) +
            (placement - 1) * 0.35
          : random() * Math.PI * 2;
      const def = transformLayout(p, angle, node.x, node.z);
      def.site.terrain = site.terrain;
      def.site.centre = { x: node.x, z: node.z };
      const path = new Alignment(def),
        heights: number[] = [];
      let gridVariance = 0,
        terrainGrade = 0,
        regionCost = 0;
      for (let i = 0; i < 64; i++) {
        const r = path.sample((i / 64) * path.length),
          height = naturalHeight(site.terrain, r.position.x, r.position.z);
        heights.push(height);
        if (i < 3 || i > 61) gridVariance += (height - node.height) ** 2;
        if (i) terrainGrade += (height - heights[i - 1]) ** 2;
        if (i % 8 === 0) {
          const nearest = site.features.reduce((a, b) =>
            Math.hypot(a.x - r.position.x, a.z - r.position.z) <
            Math.hypot(b.x - r.position.x, b.z - r.position.z)
              ? a
              : b,
          );
          regionCost += nearest.slope;
        }
      }
      const range = Math.max(...heights) - Math.min(...heights);
      const peak = itinerary.reduce((a, b) => (a.height > b.height ? a : b)),
        valley = itinerary.reduce((a, b) => (a.height < b.height ? a : b));
      const high = path.sample(path.length * 0.3).position,
        low = path.sample(path.length * 0.65).position;
      const strategicCost =
        12 *
        ((Math.hypot(high.x - peak.x, high.z - peak.z) / path.length) ** 2 +
          (Math.hypot(low.x - valley.x, low.z - valley.z) / path.length) ** 2);
      const siteScore =
        gridVariance * 0.04 +
        terrainGrade * 0.004 +
        regionCost * 2 +
        strategicCost -
        Math.min(range, recipe.relief === "rolling" ? 28 : 12) * 0.06;
      const score = siteScore + p.closureShare * 0.8;
      candidates.push({
        proposal: p,
        definition: def,
        score,
        siteScore,
        fallback: false,
        earthwork: gridVariance * 0.04 + terrainGrade * 0.004,
        rhythm: new Set(p.motifs.map((m) => m.role)).size,
        itinerary,
      });
    }
    if (feasible >= 8) break;
    if (feasible % 2 === 0)
      options.progress?.({
        stage: `Composing ${feasible} feasible routes`,
        fraction: 0.1 + Math.min(0.3, feasible * 0.035),
      });
  }
  candidates.sort((a, b) => a.score - b.score);
  const scores: DesignReport["candidateScores"] = [];
  const frontier = candidates.filter(
    (c) =>
      !candidates.some(
        (other) =>
          other.earthwork < c.earthwork &&
          other.rhythm >= c.rhythm &&
          other.siteScore <= c.siteScore,
      ),
  );
  // Keep alternatives from both proposal engines, rather than selecting solely on
  // a single earthwork score. Each gets full vertical/land-use validation.
  const shortlist: typeof candidates = [];
  for (const mode of ["sequence", "anchors"] as const) {
    const found = frontier.find((c) => c.proposal.mode === mode);
    if (found) shortlist.push(found);
  }
  for (const c of [...frontier, ...candidates])
    if (
      !shortlist.includes(c) &&
      !shortlist.some((s) => s.proposal === c.proposal)
    )
      shortlist.push(c);
  shortlist.sort((a, b) => a.score - b.score);
  const fallback = conservativeLayout(recipe);
  for (let i = 0; i < 6; i++) {
    const node = site.facilities[i],
      def = transformLayout(fallback, random() * Math.PI * 2, node.x, node.z);
    def.site.terrain = site.terrain;
    def.site.centre = { x: node.x, z: node.z };
    shortlist.push({
      proposal: fallback,
      definition: def,
      score: 1e6,
      siteScore: node.slope,
      fallback: true,
      earthwork: 0,
      rhythm: 0,
      itinerary: site.itineraries.get(node.id)!,
    });
  }
  for (let index = 0; index < shortlist.length; index++) {
    const c = shortlist[index];
    let def = structuredClone(c.definition);
    if (c.fallback) def.id = "candidate-fallback";
    options.progress?.({
      stage: "Fitting road, terrain and tyre paths",
      fraction: 0.42 + (index / Math.max(1, shortlist.length)) * 0.24,
    });
    try {
      let fit = fitRoadProfiles(def, recipe);
      let move = 0;
      // Route/elevation feedback is a bounded local edit, triggered by actual
      // earthwork. Protect straights and facilities, then re-fit and revalidate.
      if (!c.fallback && fit.rms > 2.5) {
        const source = new Alignment(def),
          n = def.controlPoints.length;
        let worst = -1,
          worstIndex = 0;
        for (let i = 0; i < n; i++) {
          const s = (i / n) * source.length,
            r = source.sample(s);
          if (
            Math.min(s, source.length - s) < 350 ||
            Math.abs(r.curvature) < 0.003
          )
            continue;
          const e = Math.abs(
            r.position.y -
              naturalHeight(site.terrain, r.position.x, r.position.z),
          );
          if (e > worst) {
            worst = e;
            worstIndex = i;
          }
        }
        for (const direction of [-1, 1])
          if (worst > 1) {
            const target = structuredClone(def),
              sample = source.sample((worstIndex / n) * source.length);
            target.controlPoints = target.controlPoints.map((p, i) => {
              const r = source.sample((i / n) * source.length);
              if (
                Math.abs(r.curvature) < 0.001 ||
                (Math.min(i, n - i) * source.length) / n < 300
              )
                return p;
              const weight =
                Math.exp(-0.5 * ((i - worstIndex) / 2) ** 2) * direction * 5;
              return {
                x: p.x + sample.left.x * weight,
                z: p.z + sample.left.z * weight,
              };
            });
            const trialPath = new Alignment(target),
              scale = recipe.targetLength / trialPath.length,
              origin = trialPath.sample(0).position;
            target.controlPoints = target.controlPoints.map((p) => ({
              x: origin.x + (p.x - origin.x) * scale,
              z: origin.z + (p.z - origin.z) * scale,
            }));
            const shape = new Alignment(target),
              points = Array.from(
                { length: Math.ceil(shape.length / 8) },
                (_, i) => shape.sample(i * 8).position,
              );
            if (
              !inspectLayout(
                points,
                shape.length,
                recipe.family === "gp" ? 24 : 21,
                28,
              ).valid
            )
              continue;
            const fitted = fitRoadProfiles(target, recipe);
            const displacement = Math.max(
              ...target.controlPoints.map((p, i) =>
                Math.hypot(
                  p.x - c.definition.controlPoints[i].x,
                  p.z - c.definition.controlPoints[i].z,
                ),
              ),
            );
            if (
              fitted.rms < fit.rms - 0.03 &&
              displacement + c.proposal.deviation <= 8 &&
              validateCircuit(target, recipe).valid
            ) {
              def = target;
              fit = fitted;
              move = displacement;
            }
          }
      }
      if (
        fit.rms > (recipe.relief === "gentle" ? 4 : 6) ||
        fit.max > 16 ||
        fit.retained < 0.42
      )
        throw new Error(
          `Earthwork/relief budget: RMS ${fit.rms.toFixed(1)} m, max ${fit.max.toFixed(1)} m, retained ${(fit.retained * 100).toFixed(0)}%.`,
        );
      const decorated = decorate(def, c.proposal, recipe, fit);
      const report = validateCircuit(def, recipe);
      if (!report.valid)
        throw new Error(
          report.checks
            .filter((c) => c.status === "fail")
            .map((c) => `${c.name}: ${c.detail}`)
            .join("; "),
        );
      const path = new Alignment(def),
        rows = decorated.rows,
        n = rows.length;
      let changes = 0,
        lastSign = 0;
      for (const run of decorated.runs)
        if (run.sign) {
          if (lastSign && lastSign !== run.sign) changes++;
          lastSign = run.sign;
        }
      const straightLengths = decorated.runs
        .filter((r) => !r.sign)
        .map((r) => (r.end - r.start) * path.length);
      if (
        decorated.runs[0].sign === 0 &&
        decorated.runs.at(-1)!.sign === 0 &&
        straightLengths.length > 1
      )
        straightLengths[0] += straightLengths.pop()!;
      const longStraights = straightLengths.filter(
        (length) => length > 150,
      ).length;
      const pad = def.site.paddock!,
        heading = Math.atan2(pad.forward.z, pad.forward.x);
      const reservations: DesignReport["reservations"] = [
        {
          kind: "paddock",
          x: pad.centre.x,
          z: pad.centre.z,
          width: pad.width,
          length: pad.length,
          heading,
        },
        {
          kind: "access",
          x: pad.centre.x + pad.forward.z * 55,
          z: pad.centre.z - pad.forward.x * 55,
          width: 12,
          length: 70,
          heading,
        },
      ];
      for (const motif of c.proposal.motifs)
        if (motif.role === "hairpin" || motif.role === "chicane") {
          const r = path.sample(motif.at * path.length);
          reservations.push({
            kind: "escape",
            x: r.position.x + r.forward.x * 25,
            z: r.position.z + r.forward.z * 25,
            width: 24,
            length: 45,
            heading: Math.atan2(r.forward.z, r.forward.x),
          });
        }
      def.id = `${recipe.family}-v2-${hashSeed(JSON.stringify(recipe)).toString(16)}${c.fallback ? "-fallback" : ""}`;
      def.name = `${recipe.family === "gp" ? "Grand Prix" : "Touring"} / ${recipe.seed} · ${recipe.layout + 1}${c.fallback ? " · fallback" : ""}`;
      def.site.radius =
        Math.max(
          ...def.controlPoints.map((p) =>
            Math.hypot(p.x - def.site.centre.x, p.z - def.site.centre.z),
          ),
        ) + 240;
      const design: DesignReport = {
        generator: DESIGN_VERSION,
        mode: c.proposal.mode,
        proposalCount: tried,
        feasibleCount: feasible,
        closureShare: c.proposal.closureShare,
        closureAdjustment: c.proposal.adjustment,
        fittingDeviation: c.proposal.deviation + move,
        directionChanges: report.rhythm!.changes,
        longStraights,
        hullOccupancy: hullOccupancy(rows.map((r) => r.position)),
        cutFillRms: fit.rms,
        cutFillMax: fit.max,
        earthworkVolume: fit.volume,
        retainedRelief: fit.retained,
        siteFeatures: site.features,
        siteRoute: c.itinerary,
        motifs: c.proposal.motifs.map((m) => ({
          ...m,
          speed: fit.speed[Math.floor(m.at * n) % n],
        })),
        diagnostics: rows.map((r, i) => ({
          at: i / n,
          natural: fit.ground[i],
          road: fit.road[i],
          speed: fit.speed[i],
          grade: r.grade,
          bank: r.bank,
          width: r.leftWidth + r.rightWidth,
          curvature: r.curvature,
          clearance: c.proposal.clearance,
          cutFill: fit.road[i] - fit.ground[i],
        })),
        reservations,
        candidateScores: scores,
        rejections,
      };
      report.checks.push({
        name: "Terrain & facilities",
        status: "pass",
        detail: `${fit.rms.toFixed(1)} m corridor cut/fill RMS · ${(fit.retained * 100).toFixed(0)}% relief retained · reserved paddock/access`,
      });
      const definition = JSON.parse(
        JSON.stringify(def, (_key, value) =>
          typeof value === "number" ? Number(value.toFixed(8)) : value,
        ),
      ) as CircuitDefinition;
      options.accept?.(definition);
      design.referenceLines = referenceLines(definition);
      scores.push({
        earthwork: fit.rms,
        rhythm: changes,
        site: c.siteScore,
        accepted: true,
      });
      return {
        recipe,
        definition,
        report,
        design,
        attempts,
        fallback: c.fallback,
        fingerprint: `v2-${hashSeed(JSON.stringify(definition)).toString(16).padStart(8, "0")}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ attempt: index + 1, reasons: [message] });
      rejections[message.split(":")[0]] =
        (rejections[message.split(":")[0]] || 0) + 1;
      scores.push({
        earthwork: null,
        rhythm: 0,
        site: c.siteScore,
        accepted: false,
      });
    }
  }
  throw new Error(
    `Could not design ${recipe.family} seed “${recipe.seed}” in ${tried} proposals: ${
      attempts
        .slice(-2)
        .flatMap((a) => a.reasons)
        .join("; ") || "No route met closure, grid and corridor constraints."
    }`,
  );
}

export function generateDesignedCircuit(
  recipe: DesignRecipe,
  options: DesignOptions = {},
): GenerationResult {
  let compiled: CompiledCircuit | undefined;
  const designed = designCircuit(recipe, {
    ...options,
    accept: (definition) => {
      options.progress?.({
        stage: "Compiling road and constrained terrain tiles",
        fraction: 0.78,
      });
      compiled = compileCircuit(definition);
      for (const chunk of compiled.chunks)
        for (let i = 0; i < chunk.indices.length; i += 3) {
          const [a, b, c] = [
              chunk.indices[i] * 3,
              chunk.indices[i + 1] * 3,
              chunk.indices[i + 2] * 3,
            ],
            v = chunk.vertices;
          const up =
            (v[b + 2] - v[a + 2]) * (v[c] - v[a]) -
            (v[b] - v[a]) * (v[c + 2] - v[a + 2]);
          if (!Number.isFinite(up) || up <= 0)
            throw new Error(
              "Compiled Float32 surface is folded or degenerate.",
            );
        }
    },
  });
  options.progress?.({
    stage: "Compiling road and constrained terrain tiles",
    fraction: 0.78,
  });
  if (!compiled) throw new Error("No compiled circuit was produced.");
  for (const chunk of compiled.chunks)
    for (let i = 0; i < chunk.indices.length; i += 3) {
      const [a, b, c] = [
          chunk.indices[i] * 3,
          chunk.indices[i + 1] * 3,
          chunk.indices[i + 2] * 3,
        ],
        v = chunk.vertices;
      const up =
        (v[b + 2] - v[a + 2]) * (v[c] - v[a]) -
        (v[b] - v[a]) * (v[c + 2] - v[a + 2]);
      if (!Number.isFinite(up) || up <= 0)
        throw new Error("Compiled Float32 surface is folded or degenerate.");
    }
  designed.report.checks.push({
    name: "Shared surface mesh",
    status: "pass",
    detail: `${compiled.triangleCount.toLocaleString("en-US")} upward triangles · constrained terrain cutout · shared render/collision`,
  });
  options.progress?.({ stage: "Circuit ready", fraction: 1 });
  return {
    recipe,
    circuit: bakeCircuit(compiled),
    report: designed.report,
    design: designed.design,
    attempts: designed.attempts,
    fallback: designed.fallback,
    fingerprint: designed.fingerprint,
  };
}
