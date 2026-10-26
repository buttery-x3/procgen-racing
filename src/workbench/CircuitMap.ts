import type { CircuitBake } from "../track/SurfaceCompiler";

export function mapProjection(
  circuit: CircuitBake,
  width: number,
  height: number,
  padding = 14,
) {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const row of circuit.rows) {
    minX = Math.min(minX, row.position.x);
    maxX = Math.max(maxX, row.position.x);
    minZ = Math.min(minZ, row.position.z);
    maxZ = Math.max(maxZ, row.position.z);
  }
  const scale = Math.min(
      (width - padding * 2) / (maxX - minX),
      (height - padding * 2) / (maxZ - minZ),
    ),
    cx = (minX + maxX) / 2,
    cz = (minZ + maxZ) / 2;
  return {
    scale,
    // +Z is forward and +X is the vehicle's physical left. Looking down from
    // +Y with +Z at the top therefore puts +X on screen-left, as in chase view.
    point: (x: number, z: number) => ({
      x: width / 2 - (x - cx) * scale,
      y: height / 2 - (z - cz) * scale,
    }),
    world: (x: number, y: number) => ({
      x: cx - (x - width / 2) / scale,
      z: cz - (y - height / 2) / scale,
    }),
    direction: (x: number, z: number) => ({ x: -x * scale, y: -z * scale }),
  };
}
export function routePath(circuit: CircuitBake, width: number, height: number) {
  const map = mapProjection(circuit, width, height);
  return (
    circuit.rows
      .map((row, i) => {
        const p = map.point(row.position.x, row.position.z);
        return `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
      })
      .join(" ") + "Z"
  );
}
export function elevationPath(
  circuit: CircuitBake,
  width: number,
  height: number,
) {
  const heights = circuit.rows.map((row) => row.position.y),
    min = Math.min(...heights),
    max = Math.max(...heights);
  return circuit.rows
    .map(
      (row, i) =>
        `${i ? "L" : "M"}${((row.station / circuit.length) * width).toFixed(2)},${(height - 4 - ((row.position.y - min) / Math.max(1, max - min)) * (height - 8)).toFixed(2)}`,
    )
    .join(" ");
}
