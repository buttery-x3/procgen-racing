import { Alignment } from "./Alignment";
import { roadPoint } from "./SurfaceCompiler";
import { naturalHeight } from "./Terrain";
import { validateFamily } from "./families/validateFamily";
import type { CircuitDefinition } from "./types";
import type { GenerationRecipe, ValidationReport } from "./generationTypes";
import {
  inspectLayout,
  measureRhythm,
  rhythmFits,
} from "./design/LayoutProposal";

/** Engineering bounds for this game's road courses, not circuit homologation. */
export function validateCircuit(
  definition: CircuitDefinition,
  recipe: GenerationRecipe,
): ValidationReport {
  if (recipe.version === 3) return validateFamily(definition, recipe);
  const alignment = new Alignment(definition),
    step = alignment.length / Math.ceil(alignment.length / 4),
    count = Math.round(alignment.length / step),
    samples = Array.from({ length: count }, (_, i) =>
      alignment.sample(i * step),
    ),
    speed =
      recipe.version === 2
        ? recipe.family === "gp"
          ? 52
          : 40
        : recipe.family === "gp"
          ? 50
          : 38;
  let maxGrade = 0,
    maxBank = 0,
    minWidth = Infinity,
    maxWidth = 0,
    minRadius = Infinity,
    maxWidthRate = 0,
    maxBankRate = 0,
    crestG = 0,
    compressionG = 0,
    minHeight = Infinity,
    maxHeight = -Infinity,
    earthwork = 0,
    clearance = Infinity,
    intersections = 0;
  for (let i = 0; i < count; i++) {
    const row = samples[i],
      prev = samples[(i + count - 1) % count],
      next = samples[(i + 1) % count];
    maxGrade = Math.max(maxGrade, Math.abs(row.grade));
    maxBank = Math.max(maxBank, Math.abs(row.bank));
    minWidth = Math.min(minWidth, row.leftWidth + row.rightWidth);
    maxWidth = Math.max(maxWidth, row.leftWidth + row.rightWidth);
    minRadius = Math.min(
      minRadius,
      1 / Math.max(Math.abs(row.curvature), 1e-9),
    );
    maxWidthRate = Math.max(
      maxWidthRate,
      Math.abs(next.leftWidth - row.leftWidth) / step,
      Math.abs(next.rightWidth - row.rightWidth) / step,
    );
    maxBankRate = Math.max(maxBankRate, Math.abs(next.bank - row.bank) / step);
    minHeight = Math.min(minHeight, row.position.y);
    maxHeight = Math.max(maxHeight, row.position.y);
    if (definition.site.terrain)
      earthwork +=
        (row.position.y -
          naturalHeight(
            definition.site.terrain,
            row.position.x,
            row.position.z,
          )) **
        2;
    // Check both tyre paths as well as the centreline at a curvature-limited
    // reference speed (0.8 g cornering, capped per family).
    const localSpeed = Math.min(
      speed,
      Math.sqrt((0.8 * 9.81) / Math.max(Math.abs(row.curvature), 1e-6)),
    );
    for (const lateral of [-row.rightWidth + 1, -2, 0, 2, row.leftWidth - 1]) {
      const second =
        (roadPoint(next, lateral).y -
          2 * roadPoint(row, lateral).y +
          roadPoint(prev, lateral).y) /
        step ** 2;
      const g = (second * localSpeed ** 2) / 9.81;
      crestG = Math.max(crestG, -g);
      compressionG = Math.max(compressionG, g);
    }
  }
  const orientation = (
    a: { x: number; z: number },
    b: { x: number; z: number },
    c: { x: number; z: number },
  ) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const segmentDistance = (
    p: { x: number; z: number },
    a: { x: number; z: number },
    b: { x: number; z: number },
  ) => {
    const dx = b.x - a.x,
      dz = b.z - a.z,
      t = Math.max(
        0,
        Math.min(
          1,
          ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz),
        ),
      );
    return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
  };
  // Sampled segment crossing/clearance, with a 100 m local-neighbour exclusion.
  // Mesh compilation independently rejects folded corridor and terrain triangles.
  if (recipe.version === 2) {
    const check = inspectLayout(
      samples.map((r) => r.position),
      alignment.length,
      maxWidth + 8,
      28,
    );
    clearance = check.clearance + 8;
    intersections = check.reason === "Crossing" ? 1 : 0;
    if (!check.valid && intersections === 0)
      clearance = Math.min(clearance, 23);
  } else
    for (let i = 0; i < count; i++)
      for (let j = i + 1; j < count; j++) {
        const separation = Math.min(j - i, count - (j - i)) * step;
        if (j === i + 1 || (i === 0 && j === count - 1)) continue;
        const a = samples[i].position,
          b = samples[(i + 1) % count].position,
          c = samples[j].position,
          d = samples[(j + 1) % count].position;
        if (
          orientation(a, b, c) * orientation(a, b, d) < 0 &&
          orientation(c, d, a) * orientation(c, d, b) < 0
        )
          intersections++;
        if (separation < 100) continue;
        const distance = Math.min(
          segmentDistance(a, c, d),
          segmentDistance(b, c, d),
          segmentDistance(c, a, b),
          segmentDistance(d, a, b),
        );
        const widths =
          Math.max(samples[i].leftWidth, samples[i].rightWidth) +
          Math.max(samples[j].leftWidth, samples[j].rightWidth);
        clearance = Math.min(clearance, distance - widths);
      }
  let startStraight = 0;
  // The grid straddles the periodic seam, with level, unbanked road throughout.
  for (let s = -alignment.length * 0.12; s < alignment.length * 0.15; s += 2) {
    const row = alignment.sample(s);
    if (
      Math.abs(row.curvature) < 0.00025 &&
      Math.abs(row.grade) < 0.001 &&
      Math.abs(row.bank) < 0.0001
    )
      startStraight += 2;
    else if (s > 0) break;
    else startStraight = 0;
  }
  const first = alignment.sample(0),
    last = alignment.sample(alignment.length - 0.001);
  const checks: ValidationReport["checks"] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, status: pass ? "pass" : "fail", detail });
  check(
    "Closed, clear layout",
    intersections === 0 && clearance >= 24,
    `${intersections} crossings · ${clearance.toFixed(1)} m minimum road-edge clearance beyond local bends`,
  );
  check(
    "Corner radii",
    minRadius >=
      (recipe.version === 2
        ? recipe.family === "gp"
          ? 45
          : 28
        : recipe.family === "gp"
          ? 55
          : 32),
    `${minRadius.toFixed(0)} m tightest radius`,
  );
  check(
    "Gentle grades",
    maxGrade <=
      (recipe.version === 2 && recipe.envelope === "terrain"
        ? 0.10001
        : 0.06001),
    `${(maxGrade * 100).toFixed(1)}% peak · ${recipe.version === 2 && recipe.envelope === "terrain" ? 10 : 6}% limit`,
  );
  check(
    "Crests & compressions",
    crestG <= 0.4 && compressionG <= 0.65,
    `${crestG.toFixed(2)} g unloading / ${compressionG.toFixed(2)} g compression at up to ${Math.round(speed * 3.6)} km/h`,
  );
  check(
    "Corner banking",
    maxBank <= (7 * Math.PI) / 180 &&
      maxBankRate <= 0.0025 &&
      samples.every((r) => r.bank * r.curvature <= 1e-8),
    `${((maxBank * 180) / Math.PI).toFixed(1)}° maximum · ${((maxBankRate * 180) / Math.PI).toFixed(2)}°/m transition (0.14°/m limit) · beneficial camber`,
  );
  check(
    "Widths & tapers",
    minWidth >= (recipe.family === "gp" ? 12 : 10) && maxWidthRate <= 0.045,
    `${minWidth.toFixed(1)}–${maxWidth.toFixed(1)} m · ${(maxWidthRate * 100).toFixed(1)} cm/m fastest edge taper`,
  );
  check(
    "Level starting straight",
    startStraight >= (recipe.family === "gp" ? 250 : 160),
    `${startStraight.toFixed(0)} m level grid approach and departure · reserved paddock`,
  );
  check(
    "Smooth closing seam",
    Math.hypot(
      first.position.x - last.position.x,
      first.position.z - last.position.z,
    ) < 0.002 &&
      Math.abs(first.position.y - last.position.y) < 0.0001 &&
      Math.hypot(
        first.forward.x - last.forward.x,
        first.forward.y - last.forward.y,
        first.forward.z - last.forward.z,
      ) < 0.00001 &&
      Math.abs(first.leftWidth - last.leftWidth) < 0.0001 &&
      Math.abs(first.rightWidth - last.rightWidth) < 0.0001 &&
      Math.abs(first.grade - last.grade) < 1e-5 &&
      Math.abs(first.bank - last.bank) < 1e-5,
    "Position, tangent, elevation, banking and widths close periodically",
  );
  const rhythm =
    recipe.version === 2 ? measureRhythm(samples, alignment.length) : undefined;
  if (recipe.version === 2 && rhythm)
    check(
      "Design rhythm",
      definition.id.includes("-fallback") || rhythmFits(recipe, rhythm),
      definition.id.includes("-fallback")
        ? "Conservative fallback: the requested corner rhythm was not delivered."
        : `${rhythm.corners} meaningful corner groups · ${rhythm.changes} direction changes · ${recipe.character} brief`,
    );
  return {
    valid: checks.every((c) => c.status === "pass"),
    checks,
    ...(rhythm ? { rhythm } : {}),
    metrics: {
      length: alignment.length,
      elevationRange: maxHeight - minHeight,
      maxGrade,
      maxBank,
      minWidth,
      maxWidth,
      minRadius,
      clearance,
      maxWidthRate,
      maxBankRate,
      crestG,
      compressionG,
      startStraight,
      earthworkRms: Math.sqrt(earthwork / count),
      designSpeed: speed,
    },
  };
}
