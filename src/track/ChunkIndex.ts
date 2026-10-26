import type { Vec3 } from "../vehicle/types";

export interface Bounds2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export function meshBounds(vertices: Float32Array): Bounds2 {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    minX = Math.min(minX, vertices[i]);
    maxX = Math.max(maxX, vertices[i]);
    minZ = Math.min(minZ, vertices[i + 2]);
    maxZ = Math.max(maxZ, vertices[i + 2]);
  }
  return { minX, maxX, minZ, maxZ };
}
export function boundsDistance(bounds: Bounds2, p: Pick<Vec3, "x" | "z">) {
  return Math.hypot(
    Math.max(bounds.minX - p.x, 0, p.x - bounds.maxX),
    Math.max(bounds.minZ - p.z, 0, p.z - bounds.maxZ),
  );
}
interface BoundsNode {
  bounds: Bounds2;
  ids?: number[];
  children?: [BoundsNode, BoundsNode];
}
/** Exact distant localization without a full-lap row scan. Near-road telemetry
 * retains its small grid; this hierarchy also bounds work for infield queries. */
export class BoundsTree {
  private root: BoundsNode;
  constructor(bounds: Bounds2[]) {
    const build = (ids: number[]): BoundsNode => {
      const box = {
        minX: Infinity,
        maxX: -Infinity,
        minZ: Infinity,
        maxZ: -Infinity,
      };
      for (const i of ids) {
        const b = bounds[i];
        box.minX = Math.min(box.minX, b.minX);
        box.maxX = Math.max(box.maxX, b.maxX);
        box.minZ = Math.min(box.minZ, b.minZ);
        box.maxZ = Math.max(box.maxZ, b.maxZ);
      }
      if (ids.length <= 8) return { bounds: box, ids };
      const x = box.maxX - box.minX > box.maxZ - box.minZ;
      ids.sort((a, b) =>
        x
          ? bounds[a].minX + bounds[a].maxX - (bounds[b].minX + bounds[b].maxX)
          : bounds[a].minZ + bounds[a].maxZ - (bounds[b].minZ + bounds[b].maxZ),
      );
      const mid = ids.length >> 1;
      return {
        bounds: box,
        children: [build(ids.slice(0, mid)), build(ids.slice(mid))],
      };
    };
    this.root = build(bounds.map((_, i) => i));
  }
  nearest(
    p: Pick<Vec3, "x" | "z">,
    visit: (id: number) => number,
    best = Infinity,
  ) {
    let tested = 0;
    const search = (node: BoundsNode) => {
      if (boundsDistance(node.bounds, p) ** 2 > best) return;
      if (node.ids) {
        for (const id of node.ids) {
          best = Math.min(best, visit(id));
          tested++;
        }
        return;
      }
      const [a, b] = node.children!,
        first =
          boundsDistance(a.bounds, p) <= boundsDistance(b.bounds, p) ? a : b,
        second = first === a ? b : a;
      search(first);
      search(second);
    };
    search(this.root);
    return tested;
  }
}
/** A world-space broad phase shared by rendering and collision residency. It
 * indexes true bounds, including long triangles, rather than chunk centres. */
export class ChunkIndex {
  private cells = new Map<string, number[]>();
  constructor(
    readonly bounds: Bounds2[],
    readonly size = 128,
  ) {
    bounds.forEach((b, i) => {
      for (
        let x = Math.floor(b.minX / size);
        x <= Math.floor(b.maxX / size);
        x++
      )
        for (
          let z = Math.floor(b.minZ / size);
          z <= Math.floor(b.maxZ / size);
          z++
        ) {
          const key = `${x},${z}`;
          if (!this.cells.has(key)) this.cells.set(key, []);
          this.cells.get(key)!.push(i);
        }
    });
  }
  query(p: Pick<Vec3, "x" | "z">, radius: number, limit = Infinity) {
    const found = new Set<number>();
    for (
      let x = Math.floor((p.x - radius) / this.size);
      x <= Math.floor((p.x + radius) / this.size);
      x++
    )
      for (
        let z = Math.floor((p.z - radius) / this.size);
        z <= Math.floor((p.z + radius) / this.size);
        z++
      )
        for (const i of this.cells.get(`${x},${z}`) ?? [])
          if (boundsDistance(this.bounds[i], p) <= radius) found.add(i);
    return [...found]
      .sort(
        (a, b) =>
          boundsDistance(this.bounds[a], p) -
            boundsDistance(this.bounds[b], p) || a - b,
      )
      .slice(0, limit);
  }
}
/** Split a welded obstacle without recomputing its side offsets at tile seams. */
export function tileMesh(
  mesh: { vertices: Float32Array; indices: Uint32Array },
  size = 128,
) {
  const tiles = new Map<
    string,
    { vertices: number[]; indices: number[]; map: Map<number, number> }
  >();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]],
      x = ids.reduce((s, id) => s + mesh.vertices[id * 3], 0) / 3,
      z = ids.reduce((s, id) => s + mesh.vertices[id * 3 + 2], 0) / 3,
      key = `${Math.floor(x / size)},${Math.floor(z / size)}`;
    if (!tiles.has(key))
      tiles.set(key, { vertices: [], indices: [], map: new Map() });
    const t = tiles.get(key)!;
    for (const id of ids) {
      if (!t.map.has(id)) {
        t.map.set(id, t.vertices.length / 3);
        t.vertices.push(
          mesh.vertices[id * 3],
          mesh.vertices[id * 3 + 1],
          mesh.vertices[id * 3 + 2],
        );
      }
      t.indices.push(t.map.get(id)!);
    }
  }
  return [...tiles.values()].map((t) => ({
    vertices: new Float32Array(t.vertices),
    indices: new Uint32Array(t.indices),
  }));
}
