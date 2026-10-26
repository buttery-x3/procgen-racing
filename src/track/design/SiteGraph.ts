import { naturalHeight, hashSeed } from "../Terrain";
import type { TerrainSpec } from "../types";
import type { DesignRecipe, SiteFeature } from "../generationTypes";

export interface SiteGraph {
  terrain: TerrainSpec;
  features: SiteFeature[];
  links: { a: string; b: string; cost: number }[];
  facilities: SiteFeature[];
  itineraries: Map<string, SiteFeature[]>;
}
export function createSite(recipe: DesignRecipe): SiteGraph {
  const terrain: TerrainSpec = {
    seed: hashSeed(`${recipe.seed}/site/v2`),
    amplitude:
      (recipe.relief === "gentle" ? 14 : 36) *
      Math.sqrt(recipe.targetLength / 4000),
    wavelength: recipe.targetLength * 0.36,
    baseHeight: 24,
  };
  const nodes: SiteFeature[] = [];
  const spacing = recipe.targetLength * 0.055;
  for (let ix = -4; ix <= 4; ix++)
    for (let iz = -4; iz <= 4; iz++) {
      const x = ix * spacing,
        z = iz * spacing,
        y = naturalHeight(terrain, x, z);
      const dx =
          (naturalHeight(terrain, x + 25, z) -
            naturalHeight(terrain, x - 25, z)) /
          50,
        dz =
          (naturalHeight(terrain, x, z + 25) -
            naturalHeight(terrain, x, z - 25)) /
          50;
      nodes.push({
        id: `${ix}:${iz}`,
        x,
        z,
        height: y,
        slope: Math.hypot(dx, dz),
        kind: "slope",
      });
    }
  const sorted = [...nodes].sort((a, b) => a.height - b.height),
    low = sorted[Math.floor(nodes.length * 0.2)].height,
    high = sorted[Math.floor(nodes.length * 0.8)].height;
  for (const node of nodes)
    node.kind =
      node.slope < 0.018
        ? "flat"
        : node.height < low
          ? "valley"
          : node.height > high
            ? "ridge"
            : "slope";
  const facilities = [...nodes]
    .sort(
      (a, b) =>
        a.slope - b.slope || Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z),
    )
    .slice(0, 12);
  const links: SiteGraph["links"] = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i],
        b = nodes[j],
        d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < spacing * 1.5)
        links.push({
          a: a.id,
          b: b.id,
          cost: d + Math.abs(a.height - b.height) * 15,
        });
    }
  const neighbours = new Map(
    nodes.map((n) => [n.id, [] as { id: string; cost: number }[]]),
  );
  for (const edge of links) {
    neighbours.get(edge.a)!.push({ id: edge.b, cost: edge.cost });
    neighbours.get(edge.b)!.push({ id: edge.a, cost: edge.cost });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const shortest = (from: SiteFeature, to: SiteFeature) => {
    const costs = new Map<string, number>([[from.id, 0]]),
      previous = new Map<string, string>(),
      open = new Set(nodes.map((n) => n.id));
    while (open.size) {
      const current = [...open].reduce((a, b) =>
        (costs.get(a) ?? Infinity) < (costs.get(b) ?? Infinity) ? a : b,
      );
      open.delete(current);
      if (current === to.id) break;
      for (const edge of neighbours.get(current)!) {
        const cost = (costs.get(current) ?? Infinity) + edge.cost;
        if (cost < (costs.get(edge.id) ?? Infinity)) {
          costs.set(edge.id, cost);
          previous.set(edge.id, current);
        }
      }
    }
    const path = [to];
    let id = to.id;
    while (previous.has(id)) {
      id = previous.get(id)!;
      path.unshift(byId.get(id)!);
    }
    return path;
  };
  const itineraries = new Map<string, SiteFeature[]>();
  for (const root of facilities) {
    const possible = nodes.filter(
      (n) =>
        Math.hypot(n.x - root.x, n.z - root.z) > recipe.targetLength * 0.08,
    );
    const peak = [...possible].sort((a, b) => b.height - a.height)[
      Math.min(3, possible.length - 1)
    ];
    const valley = [...possible]
      .filter((n) => Math.hypot(n.x - peak.x, n.z - peak.z) > spacing * 2)
      .sort((a, b) => a.height - b.height)[0];
    itineraries.set(root.id, [
      ...shortest(root, peak),
      ...shortest(peak, valley).slice(1),
      ...shortest(valley, root).slice(1),
    ]);
  }
  return { terrain, features: nodes, links, facilities, itineraries };
}
