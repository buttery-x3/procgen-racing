import { Alignment } from "../Alignment";
import { roadPoint } from "../SurfaceCompiler";
import { inspectLayout } from "../design/LayoutProposal";
import { naturalHeight } from "../Terrain";
import type { CircuitDefinition } from "../types";
import type { ValidationReport } from "../generationTypes";
import type { FamilyRecipe } from "./types";

export function validateFamily(
  def: CircuitDefinition,
  recipe: FamilyRecipe,
): ValidationReport {
  const path = new Alignment(def),
    n = Math.ceil(path.length / 6),
    ds = path.length / n,
    rows = Array.from({ length: n }, (_, i) => path.sample(i * ds)),
    oval = !!def.familyDesign?.oval;
  let maxGrade = 0,
    maxBank = 0,
    minWidth = Infinity,
    maxWidth = 0,
    minRadius = Infinity,
    maxWidthRate = 0,
    maxBankRate = 0,
    crestG = 0,
    compressionG = 0,
    minY = Infinity,
    maxY = -Infinity,
    earthwork = 0;
  const speed =
    recipe.family === "street"
      ? 38
      : recipe.family === "mountain"
        ? 40
        : oval
          ? 54
          : 58;
  rows.forEach((r, i) => {
    const next = rows[(i + 1) % n],
      previous = rows[(i + n - 1) % n],
      v = Math.min(
        speed,
        Math.sqrt((0.7 * 9.81) / Math.max(Math.abs(r.curvature), 0.00001)),
      );
    maxGrade = Math.max(maxGrade, Math.abs(r.grade));
    minWidth = Math.min(minWidth, r.leftWidth + r.rightWidth);
    maxWidth = Math.max(maxWidth, r.leftWidth + r.rightWidth);
    minRadius = Math.min(minRadius, 1 / Math.max(Math.abs(r.curvature), 1e-9));
    minY = Math.min(minY, r.position.y);
    maxY = Math.max(maxY, r.position.y);
    maxWidthRate = Math.max(
      maxWidthRate,
      Math.abs(next.leftWidth - r.leftWidth) / ds,
      Math.abs(next.rightWidth - r.rightWidth) / ds,
    );
    if (def.site.terrain)
      earthwork +=
        (r.position.y -
          naturalHeight(def.site.terrain, r.position.x, r.position.z)) **
        2;
    for (const l of [
      -r.rightWidth + 1,
      -r.rightWidth * 0.5,
      0,
      r.leftWidth * 0.5,
      r.leftWidth - 1,
    ]) {
      const bank = oval
        ? Math.atan(
            (roadPoint(r, l + 0.02).y - roadPoint(r, l - 0.02).y) / 0.04,
          )
        : r.bank;
      const nextBank = oval
        ? Math.atan(
            (roadPoint(next, l + 0.02).y - roadPoint(next, l - 0.02).y) / 0.04,
          )
        : next.bank;
      maxBank = Math.max(maxBank, Math.abs(bank));
      maxBankRate = Math.max(maxBankRate, Math.abs(nextBank - bank) / ds);
      const second =
          (roadPoint(next, l).y -
            2 * roadPoint(r, l).y +
            roadPoint(previous, l).y) /
          (ds * ds),
        g = (second * v * v) / 9.81;
      crestG = Math.max(crestG, -g);
      compressionG = Math.max(compressionG, g);
    }
  });
  const clearance = inspectLayout(
    rows.map((r) => r.position),
    path.length,
    maxWidth,
    oval ? 8 : recipe.family === "street" ? 10 : 16,
  );
  let startStraight = 0;
  for (
    let s = -Math.min(300, path.length * 0.2);
    s < Math.min(300, path.length * 0.2);
    s += 2
  ) {
    const r = path.sample(s);
    if (
      Math.abs(r.curvature) < 0.0003 &&
      Math.abs(r.grade) < 0.002 &&
      Math.abs(r.bank) < 0.004
    )
      startStraight += 2;
    else if (s > 0) break;
    else startStraight = 0;
  }
  const first = path.sample(0),
    last = path.sample(path.length - 0.001),
    checks: ValidationReport["checks"] = [],
    check = (name: string, pass: boolean, detail: string) =>
      checks.push({ name, status: pass ? "pass" : "fail", detail });
  check(
    "Closed graph cycle & corridor",
    clearance.valid,
    `${clearance.reason || "No crossings"} · ${clearance.clearance.toFixed(1)} m non-local edge clearance · layer 0`,
  );
  check(
    "Fitted corner radii",
    minRadius >=
      (recipe.family === "hybrid"
        ? 18
        : recipe.family === "street"
          ? 22
          : oval
            ? 34
            : recipe.family === "mountain"
              ? 24
              : 26),
    `${minRadius.toFixed(1)} m minimum radius; junctions are rounded before C2 fitting`,
  );
  check(
    "Widths & functional tapers",
    minWidth >= 9.4 && maxWidthRate < 0.05,
    `${minWidth.toFixed(1)}–${maxWidth.toFixed(1)} m · ${(maxWidthRate * 100).toFixed(2)} cm/m edge taper`,
  );
  check(
    "Grade envelope",
    maxGrade <= (recipe.envelope === "terrain" ? 0.101 : 0.061),
    `${(maxGrade * 100).toFixed(2)}% maximum; retained natural terrain is recorded separately`,
  );
  check(
    oval ? "Progressive lane banking" : "Beneficial camber",
    maxBank <= ((oval ? 25 : 7) * Math.PI) / 180 &&
      maxBankRate < (oval ? 0.006 : 0.003),
    `${((maxBank * 180) / Math.PI).toFixed(1)}° peak lane bank · ${((maxBankRate * 180) / Math.PI).toFixed(3)}°/m maximum transition`,
  );
  check(
    "Tyre-path crest & compression",
    crestG < 0.6 && compressionG < 0.9,
    `${crestG.toFixed(3)} g unloading / ${compressionG.toFixed(3)} g compression at a curvature-limited reference speed`,
  );
  check(
    "Grid & pit approach",
    startStraight >=
      (recipe.family === "oval" && path.length < 1400 ? 100 : 150),
    `${startStraight.toFixed(0)} m straight, level and unbanked grid corridor`,
  );
  check(
    "Periodic position & profiles",
    Math.hypot(
      first.position.x - last.position.x,
      first.position.z - last.position.z,
    ) < 0.002 &&
      Math.abs(first.position.y - last.position.y) < 0.0001 &&
      Math.abs(first.bank - last.bank) < 0.00002 &&
      Math.hypot(
        first.forward.x - last.forward.x,
        first.forward.y - last.forward.y,
        first.forward.z - last.forward.z,
      ) < 0.0001 &&
      Math.abs(first.leftWidth - last.leftWidth) < 0.0001 &&
      Math.abs(first.rightWidth - last.rightWidth) < 0.0001 &&
      [-first.rightWidth, 0, first.leftWidth].every(
        (l) => Math.abs(roadPoint(first, l).y - roadPoint(last, l).y) < 0.0001,
      ),
    "Position, tangent, elevation, width and lane-bank profiles close across station zero",
  );
  if (def.familyDesign) {
    const m = def.familyDesign,
      variant = m.variants.find((v) => v.id === m.activeVariant),
      edges = new Map(m.network.edges.map((e) => [e.id, e]));
    check(
      "Road provenance & variant",
      !!variant &&
        variant.edgeIds.length > 2 &&
        variant.edgeIds.length === variant.nodeIds.length &&
        variant.edgeIds.every((id, i) => {
          const e = edges.get(id);
          return (
            e &&
            [e.from, e.to].includes(variant.nodeIds[i]) &&
            [e.from, e.to].includes(
              variant.nodeIds[(i + 1) % variant.nodeIds.length],
            )
          );
        }) &&
        new Set(variant.nodeIds).size === variant.nodeIds.length,
      `${m.network.kind} graph · ${m.network.nodes.length} nodes / ${m.network.edges.length} edges · ${m.variants.length} variants · active ${m.activeVariant}`,
    );
  }
  return {
    valid: checks.every((c) => c.status === "pass"),
    checks,
    metrics: {
      length: path.length,
      elevationRange: maxY - minY,
      maxGrade,
      maxBank,
      minWidth,
      maxWidth,
      minRadius,
      clearance: clearance.clearance,
      maxWidthRate,
      maxBankRate,
      crestG,
      compressionG,
      startStraight,
      earthworkRms: Math.sqrt(earthwork / n),
      designSpeed: speed,
    },
  };
}
