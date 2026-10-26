import { smooth } from "./Alignment";
import type { CircuitDefinition, TerrainSpec } from "./types";

/** Stable UTF-16 seed hashing; no wall clock or shared random state. */
export function hashSeed(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function lattice(x: number, z: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483647.5 - 1;
}

/** Quintic value noise: a smooth, deterministic alternative to Perlin noise. */
function noise(x: number, z: number, seed: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    u = smooth(x - ix),
    v = smooth(z - iz);
  const a = lattice(ix, iz, seed),
    b = lattice(ix + 1, iz, seed),
    c = lattice(ix, iz + 1, seed),
    d = lattice(ix + 1, iz + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

export function naturalHeight(spec: TerrainSpec, x: number, z: number) {
  const u = x / spec.wavelength + 7.13,
    v = z / spec.wavelength - 4.79;
  return (
    spec.baseHeight +
    spec.amplitude *
      (noise(u, v, spec.seed) +
        0.32 * noise(u * 2, v * 2, spec.seed ^ 0x72ad) +
        0.09 * noise(u * 4, v * 4, spec.seed ^ 0x8317))
  );
}

export function terrainHeight(
  site: CircuitDefinition["site"],
  x: number,
  z: number,
) {
  const natural = site.terrain
    ? naturalHeight(site.terrain, x, z)
    : 0.6 + Math.sin(x * 0.023) * Math.cos(z * 0.019) * 0.8;
  const pad = site.paddock;
  if (!pad) return natural;
  const dx = x - pad.centre.x,
    dz = z - pad.centre.z;
  const along = dx * pad.forward.x + dz * pad.forward.z,
    across = dx * pad.forward.z - dz * pad.forward.x;
  const outside = Math.max(
    Math.abs(along) - pad.length / 2,
    Math.abs(across) - pad.width / 2,
  );
  const blend = smooth(outside / 24);
  return pad.height * (1 - blend) + natural * blend;
}
