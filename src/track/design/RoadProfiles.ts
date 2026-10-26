import { Alignment, profile, wrap, smooth } from "../Alignment";
import { naturalHeight } from "../Terrain";
import { roadPoint } from "../SurfaceCompiler";
import type { CircuitDefinition, ProfileKey } from "../types";
import type { DesignRecipe } from "../generationTypes";

/** Periodic C2 Hermite samples. All derivatives are physical-distance estimates
 * converted to normalised station. Legacy profiles still use their original blend. */
export function periodicProfile(values: number[]): ProfileKey[] {
  const n = values.length;
  const keys = values.map((value, i) => ({
    at: i / n,
    value,
    slope: ((values[(i + 1) % n] - values[(i + n - 1) % n]) * n) / 2,
    second: (values[(i + 1) % n] - 2 * value + values[(i + n - 1) % n]) * n * n,
  }));
  return [...keys, { ...keys[0], at: 1 }];
}
export function smoothSamples(values: number[], metres: number, ds: number) {
  const radius = Math.ceil((metres / ds) * 2.5),
    weights = Array.from({ length: radius * 2 + 1 }, (_, i) =>
      Math.exp(-0.5 * (((i - radius) * ds) / metres) ** 2),
    ),
    sum = weights.reduce((a, b) => a + b, 0);
  return values.map(
    (_, i) =>
      weights.reduce(
        (s, w, j) => s + w * values[wrap(i + j - radius, values.length)],
        0,
      ) / sum,
  );
}
export interface ProfileFit {
  rms: number;
  max: number;
  volume: number;
  retained: number;
  ground: number[];
  road: number[];
  speed: number[];
  grade: number[];
}

/** Alternating projections on a periodic vertical profile. Grid, grade and vertical
 * curvature are local constraints; no global relief scaling is used. The terrain
 * residual is retained and rejected by the caller if the earthworks are excessive. */
export function fitRoadProfiles(
  def: CircuitDefinition,
  recipe: DesignRecipe,
): ProfileFit {
  let path = new Alignment(def);
  const n = Math.ceil(path.length / 24),
    ds = path.length / n,
    rows = Array.from({ length: n }, (_, i) => path.sample(i * ds));
  const terrain = def.site.terrain!,
    baseWidth = recipe.family === "gp" ? 13.5 : 10.8;
  // Functional widening follows grid and braking/slow corner roles, not random keys.
  const widths = rows.map((r, i) => {
    const gridDistance = Math.min(i * ds, path.length - i * ds);
    const grid = 1 - smooth((gridDistance - 100) / 100);
    const braking = smooth((Math.abs(r.curvature) - 0.006) / 0.014);
    return (
      baseWidth + (recipe.family === "gp" ? 2.5 : 3.2) * grid + 1.1 * braking
    );
  });
  const filtered = smoothSamples(widths, 38, ds);
  def.leftWidth = periodicProfile(filtered.map((w) => w / 2));
  def.rightWidth = periodicProfile(filtered.map((w) => w / 2));
  const ground = rows.map((r, i) => {
    let sum = 0;
    for (const lateral of [-filtered[i] / 2 - 8, 0, filtered[i] / 2 + 8])
      sum += naturalHeight(
        terrain,
        r.position.x + r.left.x * lateral,
        r.position.z + r.left.z * lateral,
      );
    return sum / 3;
  });
  const gridSamples = rows
    .map((r, i) => ({ i, r, d: Math.min(i * ds, path.length - i * ds) }))
    .filter((v) => v.d < 115);
  const gridHeight =
    gridSamples.reduce((s, v) => s + ground[v.i], 0) / gridSamples.length;
  const maxGrade = recipe.envelope === "terrain" ? 0.082 : 0.047;
  const speed = rows.map((r) =>
    Math.min(
      recipe.family === "gp" ? 52 : 40,
      Math.sqrt((0.8 * 9.81) / Math.max(0.00005, Math.abs(r.curvature))),
    ),
  );
  let heights = smoothSamples(ground, 110, ds);
  const fixed = rows.map(
    (_, i) =>
      Math.min(i * ds, path.length - i * ds) <
      (recipe.family === "gp" ? 205 : 160),
  );
  // A soft 200 m facility blend supplies a good initial profile before projection.
  heights = heights.map((h, i) => {
    const d = Math.min(i * ds, path.length - i * ds);
    return gridHeight + (h - gridHeight) * smooth((d - 150) / 230);
  });
  const curvatureLimit =
    (0.11 * 9.81) / (recipe.family === "gp" ? 52 : 40) ** 2;
  for (let pass = 0; pass < 360; pass++) {
    for (let i = 0; i < n; i++) {
      if (fixed[i]) {
        heights[i] = gridHeight;
        continue;
      }
      const prev = (i + n - 1) % n,
        next = (i + 1) % n;
      // Bending regularization and a gentle pull toward the local terrain.
      if (pass < 60)
        heights[i] =
          0.94 * heights[i] +
          (0.045 * (heights[prev] + heights[next])) / 2 +
          0.015 * ground[i];
    }
    // Project each inequality over all free coordinates. A locked grid must
    // constrain its neighbours too; skipping its triples creates a sharp lip.
    for (let i = 0; i < n; i++) {
      const prev = (i + n - 1) % n,
        next = (i + 1) % n,
        second = heights[prev] - 2 * heights[i] + heights[next],
        bound = curvatureLimit * ds * ds;
      if (Math.abs(second) > bound) {
        const weights = [1, -2, 1],
          indices = [prev, i, next],
          norm = indices.reduce(
            (sum, j, k) => sum + (fixed[j] ? 0 : weights[k] ** 2),
            0,
          );
        if (norm) {
          const correction = (second - Math.sign(second) * bound) / norm;
          indices.forEach((j, k) => {
            if (!fixed[j]) heights[j] -= correction * weights[k];
          });
        }
      }
      const diff = heights[next] - heights[i],
        limit = maxGrade * ds;
      if (Math.abs(diff) > limit) {
        const free = Number(!fixed[i]) + Number(!fixed[next]),
          correction = (diff - Math.sign(diff) * limit) / Math.max(1, free);
        if (!fixed[i]) heights[i] += correction;
        if (!fixed[next]) heights[next] -= correction;
      }
    }
  }
  def.elevation = periodicProfile(heights);
  // Modest banking is confined to curved regions. Smooth each signed run with
  // quintic ramps; distance to the nearest straight/inflection sets the transition.
  const signs = rows.map((r) =>
    Math.abs(r.curvature) > 0.0015 ? Math.sign(r.curvature) : 0,
  );
  const banks = rows.map((r, i) => {
    if (!signs[i]) return 0;
    let transition = 100;
    for (let j = 1; j <= Math.ceil(110 / ds); j++)
      if (
        signs[wrap(i - j, n)] !== signs[i] ||
        signs[wrap(i + j, n)] !== signs[i]
      ) {
        transition = (j - 1) * ds;
        break;
      }
    return (
      -Math.sign(r.curvature) *
      Math.min(0.045, Math.abs(r.curvature) * 3) *
      smooth(transition / 80)
    );
  });
  def.bank = periodicProfile(banks);
  // Banking and the vertical profile share a tyre-path acceleration budget.
  // Repair only the neighbourhood that exceeds it, never scale the whole lap.
  for (let pass = 0; pass < 6; pass++) {
    path = new Alignment(def);
    let changed = false;
    const factors = Array.from({ length: n }, () => 1);
    for (let s = 0; s < path.length; s += 4) {
      const i = Math.floor(s / ds) % n,
        r = path.sample(s),
        v = Math.min(
          recipe.family === "gp" ? 52 : 40,
          Math.sqrt((0.8 * 9.81) / Math.max(0.00005, Math.abs(r.curvature))),
        );
      for (const lateral of [-r.rightWidth + 1, -2, 0, 2, r.leftWidth - 1]) {
        const second =
          (roadPoint(path.sample(s + 4), lateral).y -
            2 * roadPoint(r, lateral).y +
            roadPoint(path.sample(s - 4), lateral).y) /
          16;
        if ((second * v * v) / 9.81 < -0.34 || (second * v * v) / 9.81 > 0.55) {
          changed = true;
          for (let j = -3; j <= 3; j++)
            factors[wrap(i + j, n)] = Math.min(factors[wrap(i + j, n)], 0.65);
        }
      }
    }
    if (!changed) break;
    banks.forEach((_, i) => (banks[i] *= factors[i]));
    def.bank = periodicProfile(
      smoothSamples(banks, 18, ds).map((b, i) =>
        signs[i] && b * signs[i] < 0 ? b : 0,
      ),
    );
  }
  path = new Alignment(def);
  const road = rows.map((_, i) => path.sample(i * ds).position.y);
  const grade = rows.map((_, i) => path.sample(i * ds).grade);
  // Grade-aware acceleration/braking passes close periodically. Off-line vehicle
  // tests qualify the estimate; the workbench labels it as a reference envelope.
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < n; i++) {
      const prev = wrap(i - 1, n);
      speed[i] = Math.min(
        speed[i],
        Math.sqrt(
          Math.max(
            0,
            speed[prev] ** 2 + 2 * Math.max(0.8, 3.5 - grade[i] * 9.81) * ds,
          ),
        ),
      );
    }
    for (let i = n - 1; i >= 0; i--) {
      const next = wrap(i + 1, n);
      speed[i] = Math.min(
        speed[i],
        Math.sqrt(
          Math.max(
            0,
            speed[next] ** 2 + 2 * Math.max(2, 7.5 + grade[i] * 9.81) * ds,
          ),
        ),
      );
    }
  }
  let error = 0,
    max = 0,
    volume = 0;
  for (let i = 0; i < n; i++)
    for (const lateral of [-filtered[i] / 2 - 10, 0, filtered[i] / 2 + 10]) {
      const r = path.sample(i * ds),
        natural = naturalHeight(
          terrain,
          r.position.x + r.left.x * lateral,
          r.position.z + r.left.z * lateral,
        );
      const delta = Math.abs(roadPoint(r, lateral).y - natural);
      error += delta * delta;
      max = Math.max(max, delta);
      volume += ((delta * (filtered[i] + 20)) / 3) * ds;
    }
  const groundRange = Math.max(...ground) - Math.min(...ground);
  return {
    rms: Math.sqrt(error / (n * 3)),
    max,
    volume,
    retained:
      (Math.max(...road) - Math.min(...road)) / Math.max(0.001, groundRange),
    ground,
    road,
    speed,
    grade,
  };
}

export function sampleProfile(keys: ProfileKey[], at: number) {
  return profile(keys, at).value;
}
