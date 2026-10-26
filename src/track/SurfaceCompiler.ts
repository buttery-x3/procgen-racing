import { Matrix4, Quaternion, ShapeUtils, Vector2, Vector3 } from "three";
import { Alignment, smooth, wrap } from "./Alignment";
import { SURFACES } from "./types";
import { terrainHeight } from "./Terrain";
import { compileTerrain } from "./TerrainMesh";
import type {
  CircuitDefinition,
  CircuitLocation,
  RoadSample,
  SurfaceChunk,
  SurfaceId,
} from "./types";
import type { Vec3 } from "../vehicle/types";

export const KERB_WIDTH = 0.9;
export const KERB_HEIGHT = 0.055;
const OUTER_TERRAIN = [1, 0.65, 0.35, 0.12, 0.03];
const SEEDED_TERRAIN = [1, 0.8, 0.6, 0.42, 0.28, 0.18, 0.11, 0.06, 0.03, 0.012];
const terrainFractions = (definition: CircuitDefinition) =>
  definition.site.terrain ? SEEDED_TERRAIN : OUTER_TERRAIN;

/** Structured-cloneable worker result. Rendering and collision consume these same buffers. */
export interface CircuitBake {
  definition: CircuitDefinition;
  rows: RoadSample[];
  chunks: SurfaceChunk[];
  length: number;
  distance: number;
  triangleCount: number;
}

export interface CompiledCircuit extends CircuitBake {
  alignment: Alignment;
  locate(position: Vec3): CircuitLocation;
  frame(
    station: number,
    lateral?: number,
  ): {
    position: Vector3;
    forward: Vector3;
    normal: Vector3;
    rotation: Quaternion;
  };
}

function grassColor(definition: CircuitDefinition, height: number) {
  const terrain = definition.site.terrain;
  if (!terrain) return SURFACES.grass.color;
  const t = Math.max(
    0,
    Math.min(
      1,
      0.5 + (height - terrain.baseHeight) / (terrain.amplitude * 2.5),
    ),
  );
  const channel = (a: number, b: number) => Math.round(a + (b - a) * t);
  return (
    (channel(0x50, 0x7c) << 16) |
    (channel(0x70, 0x8e) << 8) |
    channel(0x4f, 0x5c)
  );
}

export function roadPoint(sample: RoadSample, lateral: number) {
  const width = lateral >= 0 ? sample.leftWidth : sample.rightWidth;
  const sign = Math.sign(lateral),
    outside = Math.max(0, Math.abs(lateral) - width);
  // Continue road crossfall at the edge, then flatten the run-off over four metres.
  const effective = outside
    ? sign * (width + Math.min(outside, 4) - Math.min(outside, 4) ** 2 / 8)
    : lateral;
  const crown = outside ? 0 : sample.crown * (1 - (lateral / width) ** 2);
  const kerb =
    outside > 0 && outside < KERB_WIDTH
      ? Math.sin((outside / KERB_WIDTH) * Math.PI) ** 2 *
        (sample.kerbHeight ?? KERB_HEIGHT) *
        (lateral > 0 ? sample.kerbLeft : sample.kerbRight)
      : 0;
  return new Vector3(
    sample.position.x + sample.left.x * lateral,
    sample.position.y + effective * Math.tan(sample.bank) + crown + kerb,
    sample.position.z + sample.left.z * lateral,
  );
}

function limits(sample: RoadSample) {
  if (sample.runoffLeft !== undefined && sample.runoffRight !== undefined)
    return { left: sample.runoffLeft, right: sample.runoffRight };
  const inside = 0.7 / Math.max(Math.abs(sample.curvature), 0.001);
  return {
    left:
      sample.curvature > 0
        ? Math.max(3.2, Math.min(10.4, inside - sample.leftWidth))
        : 10.4,
    right:
      sample.curvature < 0
        ? Math.max(3.2, Math.min(10.4, inside - sample.rightWidth))
        : 10.4,
  };
}
function laterals(sample: RoadSample) {
  const { left, right } = limits(sample),
    l = sample.leftWidth,
    r = sample.rightWidth;
  return [
    -r - right,
    -r - (right + 2.4) / 2,
    -r - 2.4,
    -r - 0.9,
    -r - 0.65,
    -r - 0.3,
    -r,
    -r + 0.13,
    -r / 2,
    0,
    l / 2,
    l - 0.13,
    l,
    l + 0.3,
    l + 0.65,
    l + 0.9,
    l + 2.4,
    l + (left + 2.4) / 2,
    l + left,
  ];
}
export function terrainPoint(
  definition: CircuitDefinition,
  sample: RoadSample,
  side: "left" | "right",
  fraction: number,
) {
  const end = limits(sample)[side];
  const edge = roadPoint(
    sample,
    side === "left" ? sample.leftWidth + end : -sample.rightWidth - end,
  );
  const centre = new Vector3(
    definition.site.centre.x,
    0,
    definition.site.centre.z,
  );
  const destination = edge
    .clone()
    .sub(centre)
    .setY(0)
    .normalize()
    .multiplyScalar(definition.site.radius)
    .add(centre);
  const point = edge.clone().lerp(destination, fraction);
  const undulation = terrainHeight(definition.site, point.x, point.z);
  const blend = definition.site.terrain
    ? smooth(point.clone().sub(edge).setY(0).length() / 80)
    : smooth(fraction);
  point.y = edge.y * (1 - blend) + undulation * blend;
  return point;
}

function rowPoints(
  definition: CircuitDefinition,
  sample: RoadSample,
  insideLeft: boolean,
) {
  const road = laterals(sample).map((v) => roadPoint(sample, v));
  if (definition.site.mesh === "corridor") return road;
  const fractions = terrainFractions(definition);
  return insideLeft
    ? [
        ...fractions.map((t) => terrainPoint(definition, sample, "right", t)),
        ...road,
      ]
    : [
        ...road,
        ...[...fractions]
          .reverse()
          .map((t) => terrainPoint(definition, sample, "left", t)),
      ];
}

function bandMaterial(
  sample: RoadSample,
  column: number,
  insideLeft: boolean,
  outerCount: number,
): { surface: SurfaceId; color: number } {
  const band = column - (insideLeft ? outerCount : 0);
  let surface: SurfaceId = "grass",
    color: number;
  if (sample.runoffLeft !== undefined) {
    if (band >= 6 && band <= 11) surface = "asphalt";
    else if (band >= 3 && band <= 5)
      surface = sample.kerbRight > 0.001 ? "kerb" : "runoff";
    else if (band >= 12 && band <= 14)
      surface = sample.kerbLeft > 0.001 ? "kerb" : "runoff";
    else
      surface =
        band < 6
          ? (sample.materialRight ?? "grass")
          : (sample.materialLeft ?? "grass");
    if (
      (sample.pitSide === 1 && band >= 12) ||
      (sample.pitSide === -1 && band < 6)
    )
      surface = "runoff";
    const edgePaint =
      surface === "asphalt" &&
      ((band === 6 && sample.pitSide !== -1) ||
        (band === 11 && sample.pitSide !== 1));
    return {
      surface,
      color:
        surface === "kerb"
          ? Math.floor(sample.station / 1.5) % 2
            ? 0xf0ece0
            : 0xc84737
          : edgePaint
            ? 0xe8e8d7
            : SURFACES[surface].color,
    };
  }
  if (band >= 0 && band < 18) {
    if (band >= 6 && band <= 11) surface = "asphalt";
    else if (band >= 3 && band <= 5)
      surface = sample.kerbRight > 0.001 ? "kerb" : "runoff";
    else if (band >= 12 && band <= 14)
      surface = sample.kerbLeft > 0.001 ? "kerb" : "runoff";
    else if (band <= 1 || band >= 16) {
      const outside = sample.curvature >= 0 ? band <= 1 : band >= 16;
      surface =
        outside || Math.abs(sample.curvature) < 0.004
          ? sample.section.runoff
          : "grass";
    }
    // The gravel diagnostic shoulder abuts asphalt, allowing split-wheel contact.
    if (sample.section.rightShoulder && band < 6 && sample.kerbRight < 0.001)
      surface = sample.section.rightShoulder;
    if (sample.section.leftShoulder && band >= 12 && sample.kerbLeft < 0.001)
      surface = sample.section.leftShoulder;
  }
  color =
    surface === "kerb"
      ? Math.floor(sample.station / 1.5) % 2
        ? 0xf0ece0
        : 0xc84737
      : SURFACES[surface].color;
  if (surface === "asphalt" && (band === 6 || band === 11)) color = 0xe8e8d7;
  // Fine, deterministic tonal variation makes loose surfaces readable without textures.
  if (surface === "gravel" || surface === "sand") {
    if (Math.floor(sample.station * 2) % 3 === 0)
      color = surface === "gravel" ? 0xb8ab96 : 0xd5c28d;
  }
  return { surface, color };
}

export function compileCircuit(definition: CircuitDefinition): CompiledCircuit {
  const alignment = new Alignment(definition);
  const rows: RoadSample[] = [];
  const append = (a: number, b: number, depth = 0) => {
    const first = alignment.sample(a),
      last = alignment.sample(b),
      middle = alignment.sample((a + b) / 2);
    let error = 0;
    for (const v of definition.venue ? [-2, -1, 0, 1, 2] : [-1, 0, 1]) {
      const point = (r: RoadSample) =>
        roadPoint(
          r,
          v === -2
            ? -r.rightWidth - r.runoffRight!
            : v === 2
              ? r.leftWidth + r.runoffLeft!
              : v < 0
                ? -r.rightWidth
                : v * r.leftWidth,
        );
      error = Math.max(
        error,
        point(middle).distanceTo(point(first).lerp(point(last), 0.5)),
      );
    }
    if (
      depth < 12 &&
      (b - a > 1.5 || error > 0.012 || Math.abs(last.bank - first.bank) > 0.018)
    ) {
      append(a, (a + b) / 2, depth + 1);
      append((a + b) / 2, b, depth + 1);
    } else rows.push(first);
  };
  const intervalCount = Math.ceil(alignment.length / 12);
  for (let i = 0; i < intervalCount; i++)
    append(
      (i * alignment.length) / intervalCount,
      ((i + 1) * alignment.length) / intervalCount,
    );
  rows.push({ ...alignment.sample(0), station: alignment.length });
  let distance = 0;
  rows.forEach((row, i) => {
    if (i)
      distance += new Vector3()
        .copy(row.position)
        .distanceTo(rows[i - 1].position);
    row.distance = distance;
  });
  for (const row of rows) {
    if (row.leftWidth < 3 || row.rightWidth < 3 || Math.abs(row.grade) > 0.25)
      throw new Error(
        "Road width/grade exceeds the compiler's driving bounds.",
      );
    if (
      Math.max(row.leftWidth, row.rightWidth) * Math.abs(row.curvature) >
      0.75
    )
      throw new Error(
        "Offset road edge folds inside a corner. Increase the corner radius.",
      );
  }
  const chunks: SurfaceChunk[] = [];
  const area = rows
    .slice(1)
    .reduce(
      (sum, row, i) =>
        sum +
        rows[i].position.x * row.position.z -
        row.position.x * rows[i].position.z,
      0,
    );
  const insideLeft = area < 0;
  const points = rows.map((row) => rowPoints(definition, row, insideLeft));
  const width = points[0].length;
  for (let start = 0; start < rows.length - 1; start += 48) {
    const end = Math.min(start + 48, rows.length - 1),
      vertices: number[] = [],
      indices: number[] = [],
      surfaces: SurfaceId[] = [],
      colors: number[] = [];
    for (let i = start; i <= end; i++)
      for (const point of points[i]) vertices.push(point.x, point.y, point.z);
    const triangle = (
      a: number,
      b: number,
      c: number,
      surface: SurfaceId,
      color: number,
    ) => {
      const p = (i: number) =>
        new Vector3(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
      const origin = p(a),
        normal = p(b).sub(origin).cross(p(c).sub(origin));
      if (!Number.isFinite(normal.lengthSq()) || normal.y <= 0.000001)
        throw new Error(
          `Surface mesh folds at station ${rows[Math.min(rows.length - 1, start + Math.floor(a / width))].station.toFixed(1)}, band ${a % width} (${normal.y.toFixed(5)}).`,
        );
      indices.push(a, b, c);
      surfaces.push(surface);
      colors.push(
        surface === "grass"
          ? grassColor(
              definition,
              (vertices[a * 3 + 1] +
                vertices[b * 3 + 1] +
                vertices[c * 3 + 1]) /
                3,
            )
          : color,
      );
    };
    for (let i = start; i < end; i++) {
      const sample = alignment.sample(
        (rows[i].station + rows[i + 1].station) / 2,
      );
      for (let j = 0; j < width - 1; j++) {
        const a = (i - start) * width + j,
          b = a + width,
          c = a + 1,
          d = b + 1;
        const material = bandMaterial(
          sample,
          j,
          insideLeft,
          definition.site.mesh === "corridor"
            ? 0
            : terrainFractions(definition).length,
        );
        triangle(a, b, c, material.surface, material.color);
        triangle(b, d, c, material.surface, material.color);
      }
    }
    chunks.push({
      kind: definition.site.mesh === "corridor" ? "road" : undefined,
      vertices: new Float32Array(vertices),
      indices: new Uint32Array(indices),
      surfaces,
      colors: new Uint32Array(colors),
    });
  }
  // Constrained infield triangulation closes the inner corridor without radial folds
  // at concave corners. Its boundary reuses the exact graded verge vertices.
  const boundary = points
    .slice(0, -1)
    .map((row) => (insideLeft ? row.at(-1)! : row[0]));
  if (definition.site.mesh === "corridor") {
    chunks.push(
      ...compileTerrain(
        definition,
        points.map((row) => row.at(-1)!),
        points.map((row) => row[0]),
      ),
    );
  } else if (definition.site.terrain) {
    // Generated layouts reserve a star-shaped site. Radial rings give its infield
    // real terrain detail while reusing the corridor boundary without cracks.
    const centre = definition.site.centre;
    const sign = insideLeft ? 1 : -1;
    for (let i = 0; i < boundary.length; i++) {
      const a = boundary[i],
        b = boundary[(i + 1) % boundary.length];
      const cross =
        (b.x - centre.x) * (a.z - centre.z) -
        (b.z - centre.z) * (a.x - centre.x);
      if (cross * sign <= 0.000001)
        throw new Error(
          "Infield terrain folds: the layout exceeds its reserved radial site.",
        );
    }
    const fractions = [0, 0.08, 0.2, 0.4, 0.65, 0.85, 0.96];
    for (let start = 0; start < boundary.length; start += 96) {
      const end = Math.min(start + 96, boundary.length),
        vertices: number[] = [],
        indices: number[] = [];
      for (let i = start; i <= end; i++) {
        const edge = boundary[i % boundary.length];
        for (const fraction of fractions) {
          const x = edge.x + (centre.x - edge.x) * fraction,
            z = edge.z + (centre.z - edge.z) * fraction,
            blend = smooth(Math.hypot(x - edge.x, z - edge.z) / 80);
          vertices.push(
            x,
            edge.y * (1 - blend) + terrainHeight(definition.site, x, z) * blend,
            z,
          );
        }
      }
      const middle = vertices.length / 3;
      vertices.push(
        centre.x,
        terrainHeight(definition.site, centre.x, centre.z),
        centre.z,
      );
      const triangle = (a: number, b: number, c: number) =>
        indices.push(...(insideLeft ? [a, b, c] : [a, c, b]));
      for (let i = 0; i < end - start; i++) {
        const a = i * fractions.length,
          b = a + fractions.length;
        for (let j = 0; j < fractions.length - 1; j++) {
          triangle(a + j, b + j, a + j + 1);
          triangle(b + j, b + j + 1, a + j + 1);
        }
        triangle(a + fractions.length - 1, b + fractions.length - 1, middle);
      }
      chunks.push({
        vertices: new Float32Array(vertices),
        indices: new Uint32Array(indices),
        surfaces: Array.from(
          { length: indices.length / 3 },
          () => "grass" as const,
        ),
        colors: Uint32Array.from({ length: indices.length / 3 }, (_, i) =>
          grassColor(
            definition,
            (vertices[indices[i * 3] * 3 + 1] +
              vertices[indices[i * 3 + 1] * 3 + 1] +
              vertices[indices[i * 3 + 2] * 3 + 1]) /
              3,
          ),
        ),
      });
    }
  } else {
    const infieldIndices = ShapeUtils.triangulateShape(
      boundary.map((p) => new Vector2(p.x, p.z)),
      [],
    ).flatMap((face) => {
      const [a, b, c] = face;
      return boundary[b]
        .clone()
        .sub(boundary[a])
        .cross(boundary[c].clone().sub(boundary[a])).y > 0
        ? [a, b, c]
        : [a, c, b];
    });
    chunks.push({
      vertices: new Float32Array(boundary.flatMap((p) => [p.x, p.y, p.z])),
      indices: new Uint32Array(infieldIndices),
      surfaces: Array.from(
        { length: infieldIndices.length / 3 },
        () => "grass" as const,
      ),
      colors: new Uint32Array(infieldIndices.length / 3).fill(
        SURFACES.grass.color,
      ),
    });
  }
  return hydrateCircuit(
    {
      definition,
      rows,
      chunks,
      length: alignment.length,
      distance,
      triangleCount: chunks.reduce((n, c) => n + c.surfaces.length, 0),
    },
    alignment,
  );
}

export function bakeCircuit(circuit: CompiledCircuit): CircuitBake {
  const { definition, rows, chunks, length, distance, triangleCount } = circuit;
  return { definition, rows, chunks, length, distance, triangleCount };
}

export function hydrateCircuit(
  data: CircuitBake,
  alignment = new Alignment(data.definition),
): CompiledCircuit {
  const { rows } = data;
  // Exact nearest-segment search on a coarse grid; distant off-track queries
  // fall back to all rows. This keeps GP telemetry cheap at 120 Hz.
  const cellSize = 48,
    grid = new Map<string, number[]>();
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i].position,
      b = rows[i + 1].position;
    for (
      let x = Math.floor(Math.min(a.x, b.x) / cellSize);
      x <= Math.floor(Math.max(a.x, b.x) / cellSize);
      x++
    )
      for (
        let z = Math.floor(Math.min(a.z, b.z) / cellSize);
        z <= Math.floor(Math.max(a.z, b.z) / cellSize);
        z++
      ) {
        const key = `${x},${z}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(i);
      }
  }
  const result: CompiledCircuit = {
    ...data,
    alignment,
    locate(position) {
      let best = Infinity,
        station = 0,
        lateral = 0,
        travel = 0;
      const cx = Math.floor(position.x / cellSize),
        cz = Math.floor(position.z / cellSize),
        candidates = new Set<number>();
      for (let x = cx - 1; x <= cx + 1; x++)
        for (let z = cz - 1; z <= cz + 1; z++)
          grid.get(`${x},${z}`)?.forEach((i) => candidates.add(i));
      const check = (i: number) => {
        const a = rows[i],
          b = rows[i + 1],
          dx = b.position.x - a.position.x,
          dz = b.position.z - a.position.z;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((position.x - a.position.x) * dx +
              (position.z - a.position.z) * dz) /
              (dx * dx + dz * dz),
          ),
        );
        const x = a.position.x + dx * t,
          z = a.position.z + dz * t,
          d = (position.x - x) ** 2 + (position.z - z) ** 2;
        if (d < best) {
          best = d;
          station = a.station + (b.station - a.station) * t;
          travel = a.distance + (b.distance - a.distance) * t;
          lateral = (position.x - x) * a.left.x + (position.z - z) * a.left.z;
        }
      };
      candidates.forEach(check);
      if (best >= cellSize ** 2)
        for (let i = 0; i < rows.length - 1; i++) check(i);
      return {
        station: wrap(station, alignment.length),
        distance: travel,
        lateral,
        sample: alignment.sample(station),
      };
    },
    frame(station, lateral = 0) {
      const sample = alignment.sample(station),
        position = roadPoint(sample, lateral);
      const forward = roadPoint(alignment.sample(station + 0.1), lateral)
        .sub(roadPoint(alignment.sample(station - 0.1), lateral))
        .normalize();
      const left = roadPoint(sample, lateral + 0.02)
        .sub(roadPoint(sample, lateral - 0.02))
        .normalize();
      const normal = forward.clone().cross(left).normalize();
      left.copy(normal).cross(forward).normalize();
      return {
        position,
        forward,
        normal,
        rotation: new Quaternion().setFromRotationMatrix(
          new Matrix4().makeBasis(left, normal, forward),
        ),
      };
    },
  };
  return result;
}
