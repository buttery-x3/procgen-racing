import { seededRandom } from "../../core/math";
import { Alignment } from "../Alignment";
import { hashSeed } from "../Terrain";
import type { CircuitDefinition } from "../types";
import type { DesignRecipe } from "../generationTypes";
import {
  biarc,
  corner,
  pointSegmentDistance,
  sampleChain,
  straight,
} from "./primitives";
import type { Piece, Point, Pose } from "./primitives";

const flat = (value: number) => [
  { at: 0, value },
  { at: 1, value },
];
export function emptyDefinition(
  points: Point[],
  width: number,
): CircuitDefinition {
  return {
    id: "candidate-v2",
    name: "Circuit design",
    controlPoints: points,
    elevation: flat(24),
    leftWidth: flat(width / 2),
    rightWidth: flat(width / 2),
    bankStrength: flat(0),
    crown: flat(0.025),
    kerbs: [],
    sections: [{ start: 0, name: "Grid", runoff: "grass" }],
    starts: [],
    site: { centre: { x: 0, z: 0 }, radius: 1800, mesh: "corridor" },
  };
}

/** Spatial broad phase; crossings include every nonadjacent pair. Opposing
 * hairpin legs are checked outside a width-dependent local chord neighbourhood. */
export function inspectLayout(
  points: Point[],
  length: number,
  width: number,
  margin = 28,
) {
  const n = points.length,
    ds = length / n,
    cell = 64,
    reach = width + margin + 2;
  const grid = new Map<string, number[]>(),
    seen = new Set<number>();
  let clearance = 128;
  const orient = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (let i = 0; i < n; i++) {
    const a = points[i],
      b = points[(i + 1) % n];
    for (
      let x = Math.floor((Math.min(a.x, b.x) - reach) / cell);
      x <= Math.floor((Math.max(a.x, b.x) + reach) / cell);
      x++
    )
      for (
        let z = Math.floor((Math.min(a.z, b.z) - reach) / cell);
        z <= Math.floor((Math.max(a.z, b.z) + reach) / cell);
        z++
      ) {
        const key = `${x},${z}`,
          bucket = grid.get(key) || [];
        for (const j of bucket) {
          const pair = j * n + i;
          if (seen.has(pair)) continue;
          seen.add(pair);
          const gap = Math.min(i - j, n - (i - j));
          if (gap <= 1) continue;
          const c = points[j],
            d = points[(j + 1) % n];
          if (
            Math.max(a.x, b.x) >= Math.min(c.x, d.x) - 1e-7 &&
            Math.max(c.x, d.x) >= Math.min(a.x, b.x) - 1e-7 &&
            Math.max(a.z, b.z) >= Math.min(c.z, d.z) - 1e-7 &&
            Math.max(c.z, d.z) >= Math.min(a.z, b.z) - 1e-7 &&
            orient(a, b, c) * orient(a, b, d) < 0 &&
            orient(c, d, a) * orient(c, d, b) < 0
          )
            return { valid: false, clearance: -width, reason: "Crossing" };
          if (gap * ds < (width + margin) * 1.6) continue;
          const dist = Math.min(
            pointSegmentDistance(a, c, d),
            pointSegmentDistance(b, c, d),
            pointSegmentDistance(c, a, b),
            pointSegmentDistance(d, a, b),
          );
          clearance = Math.min(clearance, dist - width);
          if (dist < width + margin)
            return { valid: false, clearance, reason: "Corridor clearance" };
        }
        bucket.push(i);
        grid.set(key, bucket);
      }
  }
  return { valid: true, clearance, reason: "" };
}

function chain(
  recipe: DesignRecipe,
  random: () => number,
  mode: "sequence" | "anchors",
) {
  const base = recipe.family === "gp" ? 10 : 8;
  const count =
    base +
    (recipe.character === "technical"
      ? 2
      : recipe.character === "flowing"
        ? -2
        : 0) +
    Math.floor(random() * 3);
  const winding = random() < 0.5 ? -1 : 1,
    start: Pose = { x: 0, z: 0, heading: 0 },
    pieces: Piece[] = [];
  let pose = start,
    turn = 0;
  const slots = new Set([0, 2 + Math.floor(random() * (count - 3))]);
  if (recipe.targetLength > 5500 && random() < 0.65) slots.add(count - 2);
  const add = (p: Piece) => {
    pieces.push(p);
    pose = p.end;
    turn += p.sweep;
  };
  for (let i = 0; i < count; i++) {
    const major = slots.has(i),
      choice = random();
    const straightLength =
      i === 0
        ? 330 + random() * 150
        : major
          ? 160 + random() * 180
          : (mode === "anchors" ? 35 : 8) + random() * 65;
    add(
      straight(
        pose,
        straightLength,
        i === 0 ? "grid" : major ? "acceleration" : "link",
      ),
    );
    const primary = Math.sign(winding * Math.PI * 2 - turn) || winding;
    const sign = random() < 0.67 + (0.22 * i) / count ? primary : -primary;
    let radius = major ? 32 + random() * 30 : 40 + random() * 95;
    if (recipe.character === "flowing" && !major) radius *= 1.35;
    const sweep =
      (((major ? 100 + random() * 65 : 30 + random() * 90) * Math.PI) / 180) *
      sign;
    if (!major && choice < 0.18) {
      add(corner(pose, radius, sign * (0.4 + random() * 0.4), "esses"));
      add(corner(pose, radius, -sign * (0.6 + random() * 0.45), "esses"));
    } else if (!major && choice < 0.31) {
      add(corner(pose, radius * 1.25, sweep * 0.52, "tightening"));
      add(corner(pose, radius * 0.8, sweep * 0.48, "tightening"));
    } else if (!major && choice < 0.39 && recipe.character !== "flowing") {
      add(corner(pose, radius * 0.72, sign * 0.65, "chicane"));
      add(straight(pose, 15, "chicane"));
      add(corner(pose, radius * 0.72, -sign * 0.8, "chicane"));
    } else
      add(
        corner(
          pose,
          radius,
          sweep,
          Math.abs(sweep) > 2.2
            ? "hairpin"
            : radius > 90
              ? "sweeper"
              : "corner",
        ),
      );
  }
  const close = biarc(pose, start);
  if (!close || close.some((p) => p.radius < 24 || Math.abs(p.sweep) > 3.5))
    return;
  const total =
    pieces.reduce((s, p) => s + p.length, 0) +
    close.reduce((s, p) => s + p.length, 0);
  const sumTurn = turn + close.reduce((s, p) => s + p.sweep, 0);
  if (
    Math.abs(Math.abs(sumTurn) - Math.PI * 2) > 0.001 ||
    close.reduce((s, p) => s + p.length, 0) / total > 0.23
  )
    return;
  return [...pieces, ...close];
}

/** Reserve complete straight entry/exit poses before fitting the connecting
 * complexes. Anchors are free in the site plane (no angular/perimeter ordering).
 * Signed biarcs make S-bends or compound corners between those reservations. */
function anchorChain(
  recipe: DesignRecipe,
  random: () => number,
): Piece[] | undefined {
  const count =
    (recipe.character === "technical" ? 4 : 3) + (random() < 0.2 ? 1 : 0);
  const anchors: Pose[] = [{ x: 0, z: 0, heading: 0 }];
  for (let i = 1; i < count; i++)
    anchors.push({
      x: (random() - 0.5) * 1050,
      z: (random() - 0.5) * 1050,
      heading: random() * Math.PI * 2,
    });
  const pieces: Piece[] = [];
  for (let i = 0; i < count; i++) {
    const leg = straight(
      anchors[i],
      i === 0 ? 360 + random() * 150 : 150 + random() * 190,
      i === 0 ? "grid" : "acceleration",
    );
    pieces.push(leg);
    const connectors = biarc(leg.end, anchors[(i + 1) % count]);
    if (
      !connectors ||
      connectors.some(
        (p) => p.radius < 30 || p.radius > 850 || Math.abs(p.sweep) > 3.35,
      )
    )
      return;
    const role =
      Math.sign(connectors[0].sweep) === Math.sign(connectors[1].sweep)
        ? "tightening"
        : "esses";
    for (const p of connectors) {
      p.closing = i === count - 1;
      p.role = p.closing
        ? "closure"
        : p.radius < 50 && Math.abs(p.sweep) > 2
          ? "hairpin"
          : role;
      pieces.push(p);
    }
  }
  const turn = pieces.reduce((s, p) => s + p.sweep, 0),
    length = pieces.reduce((s, p) => s + p.length, 0),
    closure = pieces.filter((p) => p.closing).reduce((s, p) => s + p.length, 0);
  if (Math.abs(Math.abs(turn) - Math.PI * 2) > 0.001 || closure / length > 0.23)
    return;
  return pieces;
}

/** Redistribute a shorter closing connector over six upstream lengths/radii.
 * Signed sweeps remain fixed, so total turn stays exactly one winding. A damped
 * minimum-norm solve handles endpoint x/z while keeping each edit bounded. */
function distributeClosure(source: Piece[]) {
  const indices = source
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => !p.closing && i > 1)
    .filter((_, i) => i % 2 === 0)
    .slice(-6)
    .map((v) => v.i);
  const factors: number[] = source.map((p) => (p.closing ? 0.9 : 1));
  const build = (values: number[]) => {
    let pose: Pose = { x: 0, z: 0, heading: 0 };
    return source.map((p, i) => {
      const q = p.radius
        ? corner(pose, p.radius * values[i], p.sweep, p.role, p.closing)
        : straight(pose, p.length * values[i], p.role);
      pose = q.end;
      return q;
    });
  };
  for (let pass = 0; pass < 12; pass++) {
    const current = build(factors),
      end = current.at(-1)!.end;
    if (Math.hypot(end.x, end.z) < 1e-5)
      return {
        pieces: current,
        adjustment: Math.max(...factors.map((v) => Math.abs(v - 1))),
      };
    const derivatives = indices.map((index) => {
      const v = [...factors];
      v[index] += 0.0001;
      const e = build(v).at(-1)!.end;
      return { x: (e.x - end.x) / 0.0001, z: (e.z - end.z) / 0.0001 };
    });
    const xx = derivatives.reduce((s, d) => s + d.x * d.x, 0) + 0.01,
      zz = derivatives.reduce((s, d) => s + d.z * d.z, 0) + 0.01,
      xz = derivatives.reduce((s, d) => s + d.x * d.z, 0),
      det = xx * zz - xz * xz;
    if (det < 1e-6) break;
    const a = (-end.x * zz + end.z * xz) / det,
      b = (-end.z * xx + end.x * xz) / det;
    derivatives.forEach((d, j) => {
      const i = indices[j];
      factors[i] = Math.max(
        0.78,
        Math.min(1.22, factors[i] + d.x * a + d.z * b),
      );
    });
  }
  return undefined;
}
export interface LayoutProposal {
  definition: CircuitDefinition;
  motifs: { at: number; end: number; role: string }[];
  mode: "sequence" | "anchors";
  closureShare: number;
  adjustment: number;
  deviation: number;
  clearance: number;
}
export function measureRhythm(
  samples: { curvature: number }[],
  length: number,
) {
  const ds = length / samples.length,
    runs: { sign: number; turn: number; length: number }[] = [];
  for (const sample of samples) {
    const sign =
      Math.abs(sample.curvature) > 0.0008 ? Math.sign(sample.curvature) : 0;
    let run = runs.at(-1);
    if (!run || run.sign !== sign) {
      run = { sign, turn: 0, length: 0 };
      runs.push(run);
    }
    run.turn += Math.abs(sample.curvature) * ds;
    run.length += ds;
  }
  if (runs.length > 1 && runs[0].sign === runs.at(-1)!.sign) {
    const last = runs.pop()!;
    runs[0].turn += last.turn;
    runs[0].length += last.length;
  }
  const corners = runs.filter(
    (r) => r.sign && r.turn >= Math.PI / 9 && r.length >= 15,
  );
  const changes = corners.reduce(
    (sum, r, i) =>
      sum + Number(r.sign !== corners[(i + 1) % corners.length].sign),
    0,
  );
  return { corners: corners.length, changes };
}
export function rhythmFits(
  recipe: DesignRecipe,
  rhythm: ReturnType<typeof measureRhythm>,
) {
  return recipe.character === "technical"
    ? rhythm.changes >= 4 && rhythm.corners >= (recipe.family === "gp" ? 8 : 6)
    : recipe.character === "mixed"
      ? rhythm.changes >= 2 &&
        rhythm.corners >= (recipe.family === "gp" ? 5 : 4)
      : rhythm.corners >= 3;
}
export function proposeLayout(
  recipe: DesignRecipe,
  attempt: number,
): LayoutProposal | undefined {
  const random = seededRandom(
    hashSeed(`${recipe.seed}/v2/layout/${recipe.layout}/${attempt}`),
  );
  const mode = (attempt + recipe.layout) % 2 === 0 ? "sequence" : "anchors";
  const raw =
    mode === "anchors"
      ? anchorChain(recipe, random)
      : chain(recipe, random, mode);
  if (!raw) return;
  const closed = distributeClosure(raw);
  if (!closed) return;
  const pieces = closed.pieces,
    total = pieces.reduce((s, p) => s + p.length, 0),
    scale = recipe.targetLength / total;
  const width = recipe.family === "gp" ? 14 : 11.5;
  const coarse = sampleChain(pieces, Math.ceil(recipe.targetLength / 18)).map(
    (p) => ({ x: p.x * scale, z: p.z * scale }),
  );
  if (!inspectLayout(coarse, recipe.targetLength, width + 8, 28).valid) return;
  const count = Math.ceil(recipe.targetLength / 28),
    phase = Math.round(((pieces[0].length / total) * count) / 2);
  let points = sampleChain(pieces, count).map((p) => ({
    x: p.x * scale,
    z: p.z * scale,
  }));
  points = [...points.slice(phase), ...points.slice(0, phase)];
  let def = emptyDefinition(points, width),
    path = new Alignment(def);
  const correction = recipe.targetLength / path.length;
  points = points.map((p) => ({ x: p.x * correction, z: p.z * correction }));
  def = emptyDefinition(points, width);
  path = new Alignment(def);
  const rows = Array.from({ length: Math.ceil(path.length / 8) }, (_, i) =>
    path.sample((i * path.length) / Math.ceil(path.length / 8)),
  );
  if (
    rows.some(
      (r) => Math.abs(r.curvature) > 1 / (recipe.family === "gp" ? 48 : 30),
    )
  )
    return;
  if (!rhythmFits(recipe, measureRhythm(rows, path.length))) return;
  const check = inspectLayout(
    rows.map((r) => r.position),
    path.length,
    width + 8,
    28,
  );
  if (!check.valid) return;
  // Actual grid interior must survive the fit. No cosmetic "straight" label.
  let grid = 0;
  for (let s = -path.length * 0.16; s < path.length * 0.16; s += 4) {
    if (Math.abs(path.sample(s).curvature) < 0.00025) grid += 4;
    else if (s > 0) break;
    else grid = 0;
  }
  if (grid < (recipe.family === "gp" ? 260 : 175)) return;
  const rawScaled = coarse.map((p) => ({
    x: p.x * correction,
    z: p.z * correction,
  }));
  const deviation = Math.max(
    ...rows
      .filter((_, i) => i % 4 === 0)
      .map((r) =>
        Math.min(
          ...rawScaled.map((p, i) =>
            pointSegmentDistance(
              r.position,
              p,
              rawScaled[(i + 1) % rawScaled.length],
            ),
          ),
        ),
      ),
  );
  if (deviation > 8) return;
  let at = 0;
  const motifs = pieces
    .map((p) => {
      const begin = (((at / total - phase / count) % 1) + 1) % 1;
      at += p.length;
      return {
        at: begin,
        end: (((at / total - phase / count) % 1) + 1) % 1,
        role: p.role,
      };
    })
    .sort((a, b) => a.at - b.at);
  return {
    definition: def,
    motifs,
    mode,
    closureShare:
      pieces.filter((p) => p.closing).reduce((s, p) => s + p.length, 0) / total,
    adjustment: closed.adjustment,
    deviation,
    clearance: check.clearance,
  };
}

export function transformLayout(
  proposal: LayoutProposal,
  angle: number,
  x: number,
  z: number,
) {
  const c = Math.cos(angle),
    s = Math.sin(angle),
    origin = new Alignment(proposal.definition).sample(0).position;
  return {
    ...proposal.definition,
    controlPoints: proposal.definition.controlPoints.map((p) => ({
      x: (p.x - origin.x) * c - (p.z - origin.z) * s + x,
      z: (p.x - origin.x) * s + (p.z - origin.z) * c + z,
    })),
  };
}

/** Explicit conservative delivery path, counted separately from native success. */
export function conservativeLayout(recipe: DesignRecipe): LayoutProposal {
  const random = seededRandom(hashSeed(`${recipe.seed}/v2/fallback`));
  const width = recipe.family === "gp" ? 14 : 11.5,
    w = 720 + random() * 160,
    h = 220 + random() * 140,
    r = 125 + random() * 35;
  let pose: Pose = { x: 0, z: 0, heading: 0 };
  const pieces: Piece[] = [];
  const add = (p: Piece) => {
    pieces.push(p);
    pose = p.end;
  };
  add(straight(pose, w / 2, "grid"));
  add(corner(pose, r, Math.PI / 2, "sweeper"));
  add(straight(pose, h, "link"));
  add(corner(pose, r, Math.PI / 2, "sweeper"));
  add(straight(pose, w, "acceleration"));
  add(corner(pose, r, Math.PI / 2, "sweeper"));
  add(straight(pose, h, "link"));
  add(corner(pose, r, Math.PI / 2, "sweeper"));
  add(straight(pose, w / 2, "grid"));
  const total = pieces.reduce((s, p) => s + p.length, 0),
    scale = recipe.targetLength / total;
  let definition = emptyDefinition(
    sampleChain(pieces, Math.ceil(recipe.targetLength / 28)).map((p) => ({
      x: p.x * scale,
      z: p.z * scale,
    })),
    width,
  );
  const path = new Alignment(definition),
    factor = recipe.targetLength / path.length;
  definition = {
    ...definition,
    controlPoints: definition.controlPoints.map((p) => ({
      x: p.x * factor,
      z: p.z * factor,
    })),
  };
  let station = 0;
  const motifs = pieces.map((p) => {
    const m = {
      at: station / total,
      end: (station + p.length) / total,
      role: p.role,
    };
    station += p.length;
    return m;
  });
  return {
    definition,
    motifs,
    mode: "anchors",
    closureShare: 0,
    adjustment: 0,
    deviation: 2,
    clearance: 100,
  };
}
