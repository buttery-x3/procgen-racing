import cdt2d from "cdt2d";
import { smooth } from "./Alignment";
import { terrainHeight } from "./Terrain";
import { SURFACES } from "./types";
import type { CircuitDefinition, SurfaceChunk } from "./types";
import type { Vector3 } from "three";
import { improveTerrain } from "./improveTerrain";
import { pointInPad, roadDistance } from "./venue/geometry";

interface Edge {
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
}

/** World-space constrained terrain. Three nested boundaries classify the world
 * outside the road ribbon AND every infield bay as terrain, with the ribbon cut
 * out. cdt2d preserves all corridor edges; no terrain faces lie under the road.
 * Coordinates are quantised before triangulation to match the road's Float32 seam.
 */
export function compileTerrain(
  definition: CircuitDefinition,
  left: Vector3[],
  right: Vector3[],
): SurfaceChunk[] {
  const positions: number[][] = [],
    heights: number[] = [],
    constraints: number[][] = [];
  const edgeGrid = new Map<string, Edge[]>(),
    cell = 64;
  const addLoop = (loop: number[][], values: number[]) => {
    const start = positions.length;
    loop.forEach((p, i) => {
      positions.push(p);
      heights.push(values[i]);
    });
    for (let i = 0; i < loop.length; i++)
      constraints.push([start + i, start + ((i + 1) % loop.length)]);
  };
  const f32 = Math.fround;
  for (const boundary of [left, right]) {
    const ring = boundary.slice(0, -1);
    addLoop(
      ring.map((p) => [f32(p.x), f32(p.z)]),
      ring.map((p) => f32(p.y)),
    );
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length];
      const edge: Edge = {
        ax: a.x,
        az: a.z,
        ay: a.y,
        bx: b.x,
        bz: b.z,
        by: b.y,
      };
      for (
        let x = Math.floor(Math.min(a.x, b.x) / cell);
        x <= Math.floor(Math.max(a.x, b.x) / cell);
        x++
      )
        for (
          let z = Math.floor(Math.min(a.z, b.z) / cell);
          z <= Math.floor(Math.max(a.z, b.z) / cell);
          z++
        ) {
          const key = `${x},${z}`;
          if (!edgeGrid.has(key)) edgeGrid.set(key, []);
          edgeGrid.get(key)!.push(edge);
        }
    }
  }
  const xs = positions.map((p) => p[0]),
    zs = positions.map((p) => p[1]);
  const accessBounds = definition.venue?.access?.points ?? [];
  const minX =
    Math.floor(
      Math.min(Math.min(...xs) - 180, ...accessBounds.map((p) => p.x - 20)) /
        24,
    ) *
      24 -
    3.25;
  const maxX =
    Math.ceil(
      Math.max(Math.max(...xs) + 180, ...accessBounds.map((p) => p.x + 20)) /
        24,
    ) *
      24 +
    3.25;
  const minZ =
    Math.floor(
      Math.min(Math.min(...zs) - 180, ...accessBounds.map((p) => p.z - 20)) /
        24,
    ) *
      24 -
    3.25;
  const maxZ =
    Math.ceil(
      Math.max(Math.max(...zs) + 180, ...accessBounds.map((p) => p.z + 20)) /
        24,
    ) *
      24 +
    3.25;
  const corners = [
      [minX, minZ],
      [maxX, minZ],
      [maxX, maxZ],
      [minX, maxZ],
    ],
    outer: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i],
      b = corners[(i + 1) % 4],
      steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 24);
    for (let j = 0; j < steps; j++)
      outer.push([
        f32(a[0] + ((b[0] - a[0]) * j) / steps),
        f32(a[1] + ((b[1] - a[1]) * j) / steps),
      ]);
  }
  addLoop(
    outer,
    outer.map(([x, z]) => terrainHeight(definition.site, x, z)),
  );
  // A deterministic local grading field intersects allowable cut/fill slopes from
  // nearby legs. Conflicting opposite-leg heights are an error, never a hidden ridge.
  const grade = (x: number, z: number) => {
    let best = Infinity,
      target = 0,
      lower = -Infinity,
      upper = Infinity;
    const cx = Math.floor(x / cell),
      cz = Math.floor(z / cell);
    for (let gx = cx - 2; gx <= cx + 2; gx++)
      for (let gz = cz - 2; gz <= cz + 2; gz++)
        for (const e of edgeGrid.get(`${gx},${gz}`) || []) {
          const dx = e.bx - e.ax,
            dz = e.bz - e.az;
          const t = Math.max(
            0,
            Math.min(
              1,
              ((x - e.ax) * dx + (z - e.az) * dz) / (dx * dx + dz * dz),
            ),
          );
          const d = Math.hypot(x - e.ax - t * dx, z - e.az - t * dz);
          if (d > 90) continue;
          const y = e.ay + (e.by - e.ay) * t;
          lower = Math.max(lower, y - 0.45 * d);
          upper = Math.min(upper, y + 0.45 * d);
          if (d < best) {
            best = d;
            target = y;
          }
        }
    if (lower > upper + 0.02)
      throw new Error(
        "Neighbouring corridor heights require incompatible terrain grading.",
      );
    const natural = terrainHeight(definition.site, x, z);
    let height =
      best < 90 ? target + (natural - target) * smooth(best / 90) : natural;
    const access = definition.venue?.access;
    if (access) {
      const road = roadDistance(access, x, z),
        blend = smooth((road.distance - access.width / 2) / 8);
      height = road.height * (1 - blend) + height * blend;
    }
    return { distance: best, height: Math.max(lower, Math.min(upper, height)) };
  };
  // Interior grid points are allowed in the input PSLG; parity removes road faces.
  // Avoid points close to constraints so no grid vertex can create a T-junction.
  for (let gx = minX + 12.17, ix = 0; gx < maxX - 1; gx += 18, ix++)
    for (let gz = minZ + 12.31, iz = 0; gz < maxZ - 1; gz += 18, iz++) {
      // Perfect grid squares are cocircular, forcing expensive exact in-circle
      // predicates on almost every flip. A sub-metre deterministic jitter removes
      // that degeneracy without affecting the road seam or natural height field.
      const hash =
        (Math.imul(ix + 17, 73856093) ^ Math.imul(iz + 31, 19349663)) >>> 0;
      const x = gx + ((hash & 1023) / 1023 - 0.5) * 0.6,
        z = gz + (((hash >>> 10) & 1023) / 1023 - 0.5) * 0.6;
      const value = grade(x, z);
      if (value.distance < 0.3) continue;
      positions.push([f32(x), f32(z)]);
      heights.push(f32(value.height));
    }
  // Small construction detail grids resolve the service-road edges and level
  // apron without adding an overlapping second collision plane.
  const access = definition.venue?.access;
  if (access) {
    const used = new Set(positions.map((p) => `${p[0]},${p[1]}`));
    for (let i = 1; i < access.points.length; i++) {
      const a = access.points[i - 1],
        b = access.points[i],
        dx = b.x - a.x,
        dz = b.z - a.z,
        d = Math.hypot(dx, dz),
        steps = Math.ceil(d / 3);
      for (let j = 0; j < steps; j++)
        for (const offset of [-5, -3, -1, 1, 3, 5]) {
          const x = f32(a.x + (dx * j) / steps + (dz / d) * offset),
            z = f32(a.z + (dz * j) / steps - (dx / d) * offset),
            key = `${x},${z}`,
            value = grade(x, z);
          if (value.distance < 0.35 || used.has(key)) continue;
          used.add(key);
          positions.push([x, z]);
          heights.push(f32(value.height));
        }
    }
  }
  const faces = improveTerrain(
    positions,
    cdt2d(positions, constraints, { exterior: false, delaunay: false }),
  );
  // Spatial tiles bound draw calls, collider size and tree-query work. All seams
  // reuse identical coordinates even when a vertex appears in adjacent chunks.
  const tiles = new Map<
    string,
    { vertices: number[]; indices: number[]; map: Map<number, number> }
  >();
  for (const face of faces) {
    const [a, b, c] = face,
      pa = positions[a],
      pb = positions[b],
      pc = positions[c];
    const up =
      (pb[1] - pa[1]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[1] - pa[1]);
    if (!Number.isFinite(up) || Math.abs(up) < 1e-8)
      throw new Error(
        "Constrained terrain contains a degenerate Float32 triangle.",
      );
    const key = `${Math.floor((pa[0] + pb[0] + pc[0]) / 3 / 192)},${Math.floor((pa[1] + pb[1] + pc[1]) / 3 / 192)}`;
    if (!tiles.has(key))
      tiles.set(key, { vertices: [], indices: [], map: new Map() });
    const tile = tiles.get(key)!;
    for (const index of up > 0 ? [a, b, c] : [a, c, b]) {
      if (!tile.map.has(index)) {
        tile.map.set(index, tile.vertices.length / 3);
        tile.vertices.push(
          positions[index][0],
          heights[index],
          positions[index][1],
        );
      }
      tile.indices.push(tile.map.get(index)!);
    }
  }
  return [...tiles.values()].map((tile) => {
    const surfaces: import("./types").SurfaceId[] = [];
    const colors: number[] = [];
    for (let i = 0; i < tile.indices.length; i += 3) {
      const [a, b, c] = tile.indices.slice(i, i + 3).map((p) => p * 3),
        v = tile.vertices,
        x = (v[a] + v[b] + v[c]) / 3,
        z = (v[a + 2] + v[b + 2] + v[c + 2]) / 3;
      let surface: import("./types").SurfaceId =
        definition.venue?.settings.theme === "desert" ? "sand" : "grass";
      if (
        definition.venue &&
        ((definition.site.paddock &&
          pointInPad({ x, z }, definition.site.paddock, 8)) ||
          (access && roadDistance(access, x, z).distance < access.width / 2))
      )
        surface = "runoff";
      surfaces.push(surface);
      colors.push(SURFACES[surface].color);
    }
    return {
      kind: "terrain",
      vertices: new Float32Array(tile.vertices),
      indices: new Uint32Array(tile.indices),
      surfaces,
      colors: new Uint32Array(colors),
    };
  });
}
