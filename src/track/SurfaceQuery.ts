import type { CircuitBake } from "./SurfaceCompiler";
import type { SurfaceId } from "./types";

/** Construction/scenery query against the compiler's actual triangles. Runtime
 * tyre contacts still use Rapier. A grid keeps repeated placements off O(n²). */
export function surfaceQuery(circuit: CircuitBake) {
  const cells = new Map<string, { chunk: number; triangle: number }[]>(),
    size = 24;
  circuit.chunks.forEach((chunk, c) => {
    const v = chunk.vertices,
      ids = chunk.indices;
    for (let t = 0; t < ids.length; t += 3) {
      const a = ids[t] * 3,
        b = ids[t + 1] * 3,
        d = ids[t + 2] * 3;
      for (
        let x = Math.floor(Math.min(v[a], v[b], v[d]) / size);
        x <= Math.floor(Math.max(v[a], v[b], v[d]) / size);
        x++
      )
        for (
          let z = Math.floor(Math.min(v[a + 2], v[b + 2], v[d + 2]) / size);
          z <= Math.floor(Math.max(v[a + 2], v[b + 2], v[d + 2]) / size);
          z++
        ) {
          const key = `${x},${z}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key)!.push({ chunk: c, triangle: t });
        }
    }
  });
  return (
    x: number,
    z: number,
  ): { height: number; surface: SurfaceId } | undefined => {
    let result: { height: number; surface: SurfaceId } | undefined;
    for (const { chunk: c, triangle: t } of cells.get(
      `${Math.floor(x / size)},${Math.floor(z / size)}`,
    ) ?? []) {
      const chunk = circuit.chunks[c],
        v = chunk.vertices,
        a = chunk.indices[t] * 3,
        b = chunk.indices[t + 1] * 3,
        d = chunk.indices[t + 2] * 3;
      const den =
        (v[b + 2] - v[d + 2]) * (v[a] - v[d]) +
        (v[d] - v[b]) * (v[a + 2] - v[d + 2]);
      const u =
        ((v[b + 2] - v[d + 2]) * (x - v[d]) + (v[d] - v[b]) * (z - v[d + 2])) /
        den;
      const w =
        ((v[d + 2] - v[a + 2]) * (x - v[d]) + (v[a] - v[d]) * (z - v[d + 2])) /
        den;
      if (u < -1e-6 || w < -1e-6 || u + w > 1 + 1e-6) continue;
      const height = u * v[a + 1] + w * v[b + 1] + (1 - u - w) * v[d + 1];
      if (!result || height > result.height)
        result = { height, surface: chunk.surfaces[t / 3] };
    }
    return result;
  };
}
