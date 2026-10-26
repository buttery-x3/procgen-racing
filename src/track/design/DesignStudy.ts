import { Alignment } from "../Alignment";
import { hashSeed, naturalHeight } from "../Terrain";
import { seededRandom } from "../../core/math";
import type { CircuitDefinition, TerrainSpec } from "../types";
import {
  biarc,
  corner,
  distance,
  intersects,
  pointSegmentDistance,
  sampleChain,
  straight,
} from "./primitives";
import type { Piece, Point, Pose } from "./primitives";

export const STUDY_VERSION = "m4-study-1";
export type DesignBrief = "club" | "grand-prix" | "terrain";
export const BRIEFS = {
  club: {
    label: "Club & touring",
    length: 3200,
    corners: 9,
    radius: 28,
    width: 11,
    relief: 50,
    elevation: 28,
  },
  "grand-prix": {
    label: "Modern GP",
    length: 5200,
    corners: 12,
    radius: 40,
    width: 14,
    relief: 65,
    elevation: 38,
  },
  terrain: {
    label: "Landscape endurance",
    length: 6800,
    corners: 14,
    radius: 32,
    width: 12,
    relief: 110,
    elevation: 65,
  },
} as const;
export interface StudyMetrics {
  length: number;
  minRadius: number;
  edgeClearance: number;
  directionChanges: number;
  longStraights: number;
  longestStraight: number;
  closureShare: number;
  hullOccupancy: number;
  elevationRange: number;
  maxGrade: number;
  earthworkRms: number;
  terrainCostBefore: number;
  terrainCostAfter: number;
  deformation: number;
  smoothingDeviation: number;
}
export interface StudyResult {
  version: typeof STUDY_VERSION;
  seed: string;
  brief: DesignBrief;
  definition: CircuitDefinition;
  points: {
    x: number;
    z: number;
    s: number;
    curvature: number;
    y: number;
    ground: number;
    speed: number;
  }[];
  proposal: Point[];
  metrics: StudyMetrics;
  fingerprint: string;
  attempts: number;
  feasibleProposals: number;
  rejections: Record<string, number>;
  motifs: { role: string; at: number; length: number }[];
  limitations: string[];
}
const flat = (value: number) => [
  { at: 0, value },
  { at: 1, value },
];
function definition(points: Point[], width: number): CircuitDefinition {
  return {
    id: "design-study",
    name: "Design study — not driveable",
    controlPoints: points,
    elevation: flat(0),
    leftWidth: flat(width / 2),
    rightWidth: flat(width / 2),
    bankStrength: flat(0),
    crown: flat(0),
    sections: [{ start: 0, name: "Design study", runoff: "grass" }],
    kerbs: [],
    starts: [],
    site: { centre: { x: 0, z: 0 }, radius: 2500 },
  };
}

/** Signed semantic chains retain the reference generator's ability to double back.
 * No angular sector order, convex hull, radial clearance or fixed control polygon.
 * Biarc closure is only a bounded proposal; the sampled periodic spline supplies C2.
 */
function propose(
  random: () => number,
  brief: DesignBrief,
): Piece[] | undefined {
  const count = BRIEFS[brief].corners + Math.floor(random() * 4) - 1;
  const winding = random() < 0.5 ? -1 : 1,
    pieces: Piece[] = [];
  const start: Pose = { x: 0, z: 0, heading: 0 };
  let pose = start,
    turn = 0;
  const longSlots = new Set([0, 2 + Math.floor(random() * (count - 4))]);
  if (brief === "terrain") longSlots.add(count - 3);
  const add = (p: Piece) => {
    pieces.push(p);
    pose = p.end;
    turn += p.sweep;
  };
  for (let i = 0; i < count; i++) {
    const long = longSlots.has(i),
      s = random();
    add(
      straight(
        pose,
        long ? 135 + random() * 180 : 12 + random() * 65,
        i === 0 ? "grid" : long ? "acceleration" : "link",
      ),
    );
    const primary = Math.sign(winding * Math.PI * 2 - turn) || winding;
    const sign = random() < 0.69 + (0.2 * i) / count ? primary : -primary;
    const radius = long ? 24 + random() * 24 : 30 + random() * 85;
    const sweep =
      (((long ? 85 + random() * 85 : 30 + random() * 95) * Math.PI) / 180) *
      sign;
    if (!long && s < 0.22) {
      add(corner(pose, radius, sign * (0.4 + random() * 0.4), "esses"));
      add(
        corner(
          pose,
          radius * (1 + random() * 0.3),
          -sign * (0.55 + random() * 0.55),
          "esses",
        ),
      );
    } else if (!long && s < 0.4) {
      add(corner(pose, radius * 1.3, sweep * 0.5, "tightening"));
      add(corner(pose, radius * 0.8, sweep * 0.5, "tightening"));
    } else
      add(
        corner(
          pose,
          radius,
          sweep,
          Math.abs(sweep) > 2.2 ? "hairpin" : radius > 70 ? "sweeper" : "bend",
        ),
      );
  }
  const closing = biarc(pose, start);
  if (!closing || closing.some((p) => p.radius < 20 || Math.abs(p.sweep) > 3.5))
    return;
  if (
    Math.abs(
      Math.abs(turn + closing.reduce((n, p) => n + p.sweep, 0)) - Math.PI * 2,
    ) > 0.001
  )
    return;
  const length = pieces.reduce((n, p) => n + p.length, 0),
    closureLength = closing.reduce((n, p) => n + p.length, 0);
  if (closureLength / (length + closureLength) > 0.24) return;
  return [...pieces, ...closing];
}

/** All non-adjacent segments are checked for crossings. Clearance uses a local
 * arc-distance window proportional to the corridor, never the old fixed 100 m.
 * This remains a sampled preview test, not polygon/mesh certification.
 */
export function inspectRoute(points: Point[], length: number, width: number) {
  let clearance = Infinity;
  const n = points.length,
    ds = length / n,
    local = Math.ceil(((width + 28) * 1.6) / ds);
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      const gap = Math.min(j - i, n - (j - i));
      if (gap <= 1) continue;
      const a = points[i],
        b = points[(i + 1) % n],
        c = points[j],
        d = points[(j + 1) % n];
      if (intersects(a, b, c, d))
        return { valid: false, clearance: -width, reason: "crossing" };
      if (gap <= local) continue;
      const separation =
        Math.min(
          pointSegmentDistance(a, c, d),
          pointSegmentDistance(b, c, d),
          pointSegmentDistance(c, a, b),
          pointSegmentDistance(d, a, b),
        ) - width;
      clearance = Math.min(clearance, separation);
      if (separation < 24)
        return { valid: false, clearance, reason: "clearance" };
    }
  return { valid: true, clearance, reason: "" };
}
function samples(path: Alignment, step = 8) {
  const count = Math.ceil(path.length / step);
  return Array.from({ length: count }, (_, i) =>
    path.sample((i * path.length) / count),
  );
}
function fitHeights(
  points: Point[],
  terrain: TerrainSpec,
  gridFraction: number,
  length: number,
) {
  const ground = points.map((p) => naturalHeight(terrain, p.x, p.z));
  const gridCount = Math.max(2, Math.floor(points.length * gridFraction));
  const grid =
    ground.slice(0, gridCount).reduce((a, b) => a + b, 0) / gridCount;
  let heights = [...ground];
  // Periodic low-pass with a level grid anchor. Grade/vertical acceleration are
  // measured later; this deliberately does not shrink all relief to pass a check.
  const ds = length / points.length,
    passes = Math.min(160, Math.max(8, Math.ceil((65 / ds) ** 2)));
  for (let pass = 0; pass < passes; pass++)
    heights = heights.map(
      (h, i) =>
        0.5 * h +
        0.25 *
          (heights[(i + heights.length - 1) % heights.length] +
            heights[(i + 1) % heights.length]),
    );
  heights = heights.map((h, i) => {
    const outside =
      i < gridCount ? 0 : Math.min(i - gridCount, points.length - i) * ds;
    const t = Math.min(1, outside / 220),
      blend = t * t * t * (10 + t * (-15 + 6 * t));
    return grid + (h - grid) * blend;
  });
  const rms = Math.sqrt(
    heights.reduce((s, h, i) => s + (h - ground[i]) ** 2, 0) / heights.length,
  );
  return { ground, heights, rms };
}
function siteCost(
  points: Point[],
  terrain: TerrainSpec,
  length: number,
  elevation: number,
  gridFraction: number,
) {
  const fit = fitHeights(points, terrain, gridFraction, length),
    ds = length / points.length;
  const grades = fit.heights.map(
    (h, i) => Math.abs(h - fit.heights[(i + 1) % points.length]) / ds,
  );
  const range = Math.max(...fit.heights) - Math.min(...fit.heights);
  return (
    fit.rms +
    (grades.reduce((s, g) => s + Math.max(0, g - 0.065) ** 2, 0) * 400) /
      points.length +
    Math.abs(range - elevation) * 0.025
  );
}
function transform(points: Point[], angle: number, dx: number, dz: number) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return points.map((p) => ({
    x: c * p.x - s * p.z + dx,
    z: s * p.x + c * p.z + dz,
  }));
}
function polygonArea(points: Point[]) {
  return (
    Math.abs(
      points.reduce((a, p, i) => {
        const q = points[(i + 1) % points.length];
        return a + p.x * q.z - q.x * p.z;
      }, 0),
    ) / 2
  );
}
export function hullOccupancy(points: Point[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const half = (p: Point[]) => {
    const h: Point[] = [];
    for (const v of p) {
      while (h.length >= 2 && cross(h.at(-2)!, h.at(-1)!, v) <= 0) h.pop();
      h.push(v);
    }
    return h.slice(0, -1);
  };
  return (
    polygonArea(points) /
    polygonArea([...half(sorted), ...half([...sorted].reverse())])
  );
}

/** Experimental proposal search. Intentionally separate from generateCircuit v1:
 * no road mesh, collision, kerb, runoff, bank or driving-validity claims are made.
 */
export function generateDesignStudy(
  seed: string,
  brief: DesignBrief,
  budget = 2400,
): StudyResult {
  if (
    !Object.hasOwn(BRIEFS, brief) ||
    !seed.trim() ||
    !Number.isInteger(budget) ||
    budget < 1 ||
    budget > 10000
  )
    throw new Error("Invalid design-study recipe.");
  seed = seed.trim().slice(0, 64);
  const config = BRIEFS[brief],
    random = seededRandom(hashSeed(`${STUDY_VERSION}/${seed}/${brief}`));
  const terrain: TerrainSpec = {
    seed: hashSeed(`${STUDY_VERSION}/${seed}/terrain`),
    amplitude: config.relief,
    wavelength: config.length * 0.18,
    baseHeight: 100,
  };
  const rejections: Record<string, number> = {};
  const reject = (key: string) => {
    rejections[key] = (rejections[key] ?? 0) + 1;
  };
  let best:
    | {
        def: CircuitDefinition;
        pieces: Piece[];
        raw: Point[];
        cost: number;
        gridFraction: number;
        closure: number;
      }
    | undefined;
  let feasible = 0,
    attempts = 0;
  for (let attempt = 0; attempt < budget; attempt++) {
    attempts++;
    const pieces = propose(random, brief);
    if (!pieces) {
      reject("closure");
      continue;
    }
    const rawLength = pieces.reduce((n, p) => n + p.length, 0),
      scale = config.length / rawLength;
    const raw = sampleChain(pieces, Math.ceil(config.length / 14)).map((p) => ({
      x: p.x * scale,
      z: p.z * scale,
    }));
    const coarse = inspectRoute(raw, config.length, config.width);
    if (!coarse.valid) {
      reject(coarse.reason);
      continue;
    }
    const cps = sampleChain(pieces, Math.ceil(config.length / 38)).map((p) => ({
      x: p.x * scale,
      z: p.z * scale,
    }));
    let def = definition(cps, config.width),
      path = new Alignment(def);
    const correction = config.length / path.length;
    def.controlPoints = cps.map((p) => ({
      x: p.x * correction,
      z: p.z * correction,
    }));
    path = new Alignment(def);
    const rows = samples(path, 12),
      radius = 1 / Math.max(...rows.map((r) => Math.abs(r.curvature)));
    if (radius < config.radius) {
      reject("radius-after-smoothing");
      continue;
    }
    const smoothCheck = inspectRoute(
      rows.map((r) => r.position),
      path.length,
      config.width,
    );
    if (!smoothCheck.valid) {
      reject(`smoothed-${smoothCheck.reason}`);
      continue;
    }
    feasible++;
    const centre = def.controlPoints.reduce(
      (a, p) => ({ x: a.x + p.x / cps.length, z: a.z + p.z / cps.length }),
      { x: 0, z: 0 },
    );
    const centred = def.controlPoints.map((p) => ({
      x: p.x - centre.x,
      z: p.z - centre.z,
    }));
    const gridFraction = (pieces[0].length / rawLength) * 0.7;
    const closure =
      pieces.filter((p) => p.closing).reduce((n, p) => n + p.length, 0) /
      rawLength;
    for (let placement = 0; placement < 18; placement++) {
      const angle = random() * Math.PI * 2,
        dx = (random() - 0.5) * config.length * 0.28,
        dz = (random() - 0.5) * config.length * 0.28;
      const positioned = transform(centred, angle, dx, dz);
      const cost =
        siteCost(
          positioned,
          terrain,
          config.length,
          config.elevation,
          gridFraction,
        ) +
        closure * 3;
      if (!best || cost < best.cost) {
        def = {
          ...def,
          controlPoints: positioned,
          site: {
            centre: { x: dx, z: dz },
            radius: config.length * 0.45,
            terrain,
          },
        };
        const rawCentred = raw.map((p) => ({
          x: p.x * correction - centre.x,
          z: p.z * correction - centre.z,
        }));
        best = {
          def,
          pieces,
          raw: transform(rawCentred, angle, dx, dz),
          cost,
          gridFraction,
          closure,
        };
      }
    }
    if (feasible >= 10) break;
  }
  if (!best)
    throw new Error(
      `No feasible proposal for ${brief}/${seed} in ${attempts} attempts (${JSON.stringify(rejections)}). No substitute layout returned.`,
    );
  const winner = best,
    source = winner.def.controlPoints.map((p) => ({ ...p }));
  const proposalLength = winner.pieces.reduce((sum, p) => sum + p.length, 0);
  let pieceStation = 0;
  const protectedSpans = winner.pieces.flatMap((p) => {
    const start = pieceStation / proposalLength;
    pieceStation += p.length;
    return p.radius === 0
      ? [{ start, end: pieceStation / proposalLength }]
      : [];
  });
  const locked = source.map((_, i) =>
    protectedSpans.some(
      (span) =>
        i / source.length >= span.start - 1 / source.length &&
        i / source.length <= span.end + 1 / source.length,
    ),
  );
  let points = source.map((p) => ({ ...p }));
  const beforeCost = siteCost(
    source,
    terrain,
    config.length,
    config.elevation,
    winner.gridFraction,
  );
  let cost = beforeCost;
  const gridEnd = Math.ceil(points.length * winner.gridFraction) + 4;
  // Local contour-aware editing, not just rotating the entire circuit. A bounded
  // Gaussian displacement edits a bend neighbourhood; the reserved grid is fixed.
  // Full post-fit radius/crossing/clearance tests can reject the entire refinement.
  for (const step of [14, 7])
    for (let i = gridEnd + 4; i < points.length - 5; i += 5) {
      if (locked[i]) continue;
      const prev = points[i - 1],
        next = points[i + 1],
        d = distance(prev, next);
      for (const sign of [-1, 1]) {
        const edited = points.map((p, j) => {
          if (j < gridEnd || j > points.length - 4 || locked[j])
            return { ...p };
          const w = Math.exp(-(((j - i) / 2) ** 2)) * sign * step;
          return {
            x: p.x - ((next.z - prev.z) / d) * w,
            z: p.z + ((next.x - prev.x) / d) * w,
          };
        });
        const displacement = Math.max(
          ...edited.map((p, j) => distance(p, source[j])),
        );
        if (displacement > 30) continue;
        const candidateCost =
          siteCost(
            edited,
            terrain,
            config.length,
            config.elevation,
            winner.gridFraction,
          ) +
          displacement * 0.002;
        if (candidateCost < cost) {
          points = edited;
          cost = candidateCost;
        }
      }
    }
  let def = { ...winner.def, controlPoints: points },
    path = new Alignment(def),
    rows = samples(path, 8);
  let check = inspectRoute(
    rows.map((r) => r.position),
    path.length,
    config.width,
  );
  if (
    !check.valid ||
    rows.some((r) => Math.abs(r.curvature) > 1 / config.radius)
  ) {
    reject("terrain-refinement-reverted");
    points = source;
    cost = beforeCost;
    def = { ...def, controlPoints: source };
    path = new Alignment(def);
    rows = samples(path, 8);
    check = inspectRoute(
      rows.map((r) => r.position),
      path.length,
      config.width,
    );
  }
  if (
    !check.valid ||
    rows.some((r) => Math.abs(r.curvature) > 1 / config.radius)
  )
    throw new Error(
      "Final fine-sampled route failed clearance or radius; proposal withheld.",
    );
  const fit = fitHeights(
    rows.map((r) => r.position),
    terrain,
    winner.gridFraction,
    path.length,
  );
  const ds = path.length / rows.length;
  const out = rows.map((r, i) => ({
    x: r.position.x,
    z: r.position.z,
    s: i * ds,
    curvature: r.curvature,
    y: fit.heights[i],
    ground: fit.ground[i],
    speed: Math.min(
      75,
      Math.sqrt((9.81 * 0.85) / Math.max(0.0001, Math.abs(r.curvature))),
    ),
  }));
  // Forward acceleration/backward braking envelope, periodic across the seam.
  // Diagnostic only: no aero, banking, tyre load sensitivity or racing line yet.
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i + out.length - 1) % out.length];
      out[i].speed = Math.min(
        out[i].speed,
        Math.sqrt(prev.speed ** 2 + 2 * 3.5 * ds),
      );
    }
    for (let i = out.length - 1; i >= 0; i--) {
      const next = out[(i + 1) % out.length];
      out[i].speed = Math.min(
        out[i].speed,
        Math.sqrt(next.speed ** 2 + 2 * 8 * ds),
      );
    }
  }
  let signs: number[] = [],
    runs: number[] = [],
    run = 0;
  for (const row of rows) {
    if (Math.abs(row.curvature) < 0.0006) run += ds;
    else {
      if (run > 0) runs.push(run);
      run = 0;
    }
    if (
      Math.abs(row.curvature) > 0.0025 &&
      signs.at(-1) !== Math.sign(row.curvature)
    )
      signs.push(Math.sign(row.curvature));
  }
  if (run > 0) {
    if (Math.abs(rows[0].curvature) < 0.0006 && runs.length) runs[0] += run;
    else runs.push(run);
  }
  const rawLength = winner.pieces.reduce((s, p) => s + p.length, 0);
  let station = 0;
  const motifs = winner.pieces.map((p) => {
    const m = {
      role: p.role,
      at: station / rawLength,
      length: (p.length / rawLength) * path.length,
    };
    station += p.length;
    return m;
  });
  const deviation = Math.max(
    ...out.map((p) =>
      Math.min(
        ...winner.raw.map((a, i) =>
          pointSegmentDistance(p, a, winner.raw[(i + 1) % winner.raw.length]),
        ),
      ),
    ),
  );
  const metrics: StudyMetrics = {
    length: path.length,
    minRadius: 1 / Math.max(...rows.map((r) => Math.abs(r.curvature))),
    edgeClearance: check.clearance,
    directionChanges: signs.length - (signs[0] === signs.at(-1) ? 1 : 0),
    longStraights: runs.filter((r) => r > 150).length,
    longestStraight: Math.max(0, ...runs),
    closureShare: winner.closure,
    hullOccupancy: hullOccupancy(out),
    elevationRange: Math.max(...fit.heights) - Math.min(...fit.heights),
    maxGrade: Math.max(
      ...fit.heights.map(
        (h, i) => Math.abs(h - fit.heights[(i + 1) % fit.heights.length]) / ds,
      ),
    ),
    earthworkRms: fit.rms,
    terrainCostBefore: beforeCost,
    terrainCostAfter: cost,
    deformation: Math.max(...points.map((p, i) => distance(p, source[i]))),
    smoothingDeviation: deviation,
  };
  // Elevation in `points` is a study profile, not a certified CircuitDefinition.
  // Keep the definition flat so nobody accidentally treats it as drive-ready.
  return {
    version: STUDY_VERSION,
    seed,
    brief,
    definition: def,
    points: out,
    proposal: winner.raw,
    motifs,
    metrics,
    attempts,
    feasibleProposals: feasible,
    rejections,
    fingerprint: `${STUDY_VERSION}-${hashSeed(JSON.stringify({ seed, brief, points })).toString(16)}`,
    limitations: [
      "Preview only; no compiled road or physics validation.",
      "Width, banking, runoff and pits still require coupled fitting.",
      "Elevation and speed traces are estimates, not a validated driving surface.",
      "Biarc closure remains a proposal bias; distributed closure is next.",
      "No existing-road graph, bridges or oval support in this experiment.",
    ],
  };
}
