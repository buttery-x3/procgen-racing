import { seededRandom } from "../../core/math";
import { hashSeed, naturalHeight } from "../Terrain";
import { Alignment } from "../Alignment";
import {
  emptyDefinition,
  roundedControls,
  rotateControls,
  distance,
} from "./curves";
import type { Point2 } from "./curves";
import type {
  FamilyRecipe,
  SiteNetwork,
  NetworkEdge,
  RouteVariant,
  FamilyDesign,
} from "./types";
import { FAMILY_PRESETS } from "./types";
import type { TerrainSpec } from "../types";

type Cell = [number, number];
const key = (x: number, z: number) => `${x}:${z}`;
const parse = (s: string) => s.split(":").map(Number) as Cell;
const edgeId = (a: string, b: string) => [a, b].sort().join("/");
/** Boundary of a connected union of road blocks. A single traced boundary is a
 * simple directed graph cycle; holes, diagonal kisses and repeated nodes fail. */
function boundary(cells: Set<string>): string[] | undefined {
  const edges = new Map<string, [string, string]>();
  for (const cell of cells) {
    const [x, z] = parse(cell),
      ring = [
        [x, z],
        [x + 1, z],
        [x + 1, z + 1],
        [x, z + 1],
      ];
    for (let i = 0; i < 4; i++) {
      const a = key(...(ring[i] as Cell)),
        b = key(...(ring[(i + 1) % 4] as Cell)),
        id = edgeId(a, b);
      if (edges.has(id)) edges.delete(id);
      else edges.set(id, [a, b]);
    }
  }
  const next = new Map<string, string>();
  for (const [a, b] of edges.values()) {
    if (next.has(a)) return;
    next.set(a, b);
  }
  const first = next.keys().next().value;
  if (!first) return;
  const cycle: string[] = [];
  let node = first;
  do {
    if (cycle.includes(node) || !next.has(node)) return;
    cycle.push(node);
    node = next.get(node)!;
  } while (node !== first);
  return cycle.length === edges.size ? cycle : undefined;
}
function region(
  seed: string,
  kind: FamilyRecipe["family"],
  variant: "full" | "club",
  layout: number,
) {
  const rand = seededRandom(hashSeed(`${seed}/cycle/${layout}`)),
    cells = new Set<string>();
  for (let x = 1; x <= 3; x++)
    for (let z = 1; z <= 2; z++) cells.add(key(x, z));
  const target =
    variant === "club"
      ? 6
      : kind === "mountain"
        ? 13
        : kind === "street"
          ? 11
          : kind === "airfield"
            ? 10
            : 15;
  for (let attempt = 0; attempt < 240 && cells.size < target; attempt++) {
    const options: Cell[] = [];
    for (const s of cells) {
      const [x, z] = parse(s);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const a = x + dx,
          b = z + dz;
        if (a < 0 || a >= 7 || b < 2 || b >= 6 || cells.has(key(a, b)))
          continue;
        options.push([a, b]);
      }
    }
    if (!options.length) break;
    const [x, z] = options[Math.floor(rand() * options.length)],
      trial = new Set(cells);
    trial.add(key(x, z));
    if (boundary(trial)) {
      cells.add(key(x, z));
    }
  }
  return { cells, cycle: boundary(cells)! };
}
function baseGrid(
  seed: string,
  scale: number,
  kind: FamilyRecipe["family"],
  terrain: TerrainSpec,
): SiteNetwork {
  const r = seededRandom(hashSeed(`${seed}/fixed-roads`)),
    xs = [0],
    zs = [0];
  for (let i = 0; i < 7; i++) xs.push(xs.at(-1)! + (0.82 + r() * 0.36) * scale);
  for (let i = 0; i < 6; i++)
    zs.push(
      zs.at(-1)! + (0.8 + r() * 0.4) * scale * (kind === "airfield" ? 0.68 : 1),
    );
  const angle = (r() - 0.5) * Math.PI,
    c = Math.cos(angle),
    s = Math.sin(angle),
    urban = kind === "street",
    airfield = kind === "airfield";
  const phase = r() * Math.PI * 2;
  const transform = (x: number, z: number) => {
    let u = x - xs[4],
      v = z - zs[3];
    if (!urban && !airfield) {
      const amount = kind === "mountain" ? 0.48 : 0.24,
        gridBlend = Math.min(1, Math.abs(z - zs[1]) / (scale * 1.4));
      u += scale * amount * Math.sin(v / (scale * 1.5) + phase) * gridBlend;
      v +=
        scale *
        amount *
        0.7 *
        Math.sin((x - xs[4]) / (scale * 1.8) + phase) *
        gridBlend;
    }
    return { x: u * c + v * s, z: -u * s + v * c };
  };
  const nodes: SiteNetwork["nodes"] = [];
  for (let z = 0; z <= 6; z++)
    for (let x = 0; x <= 7; x++) {
      // One inherited arterial is protected as an exact, buildable grid corridor.
      const fixed = z === 1 && x >= 1 && x <= 4,
        jitter = urban || airfield ? 0 : 0.13 * scale,
        p = transform(
          xs[x] + (fixed ? 0 : (r() - 0.5) * jitter),
          zs[z] + (fixed ? 0 : (r() - 0.5) * jitter),
        );
      nodes.push({
        id: key(x, z),
        ...p,
        height: naturalHeight(terrain, p.x, p.z),
        role: kind === "mountain" && z >= 4 ? "pass" : "junction",
        layer: 0,
      });
    }
  const byId = new Map(nodes.map((n) => [n.id, n])),
    edges: NetworkEdge[] = [];
  const add = (a: string, b: string, horizontal: boolean) => {
    const p = byId.get(a)!,
      q = byId.get(b)!,
      fixed = a.endsWith(":1") && b.endsWith(":1"),
      points: Point2[] = [{ x: p.x, z: p.z }],
      len = distance(p, q),
      nx = (q.z - p.z) / len,
      nz = -(q.x - p.x) / len;
    if (!urban && !airfield && !fixed)
      for (const t of [0.25, 0.5, 0.75]) {
        const amplitude = Math.sin(t * Math.PI) * len * 0.035;
        let best = { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t },
          score = Infinity;
        for (const offset of [-1, 0, 1]) {
          const point = {
              x: best.x + nx * amplitude * offset,
              z: best.z + nz * amplitude * offset,
            },
            cost = Math.abs(
              naturalHeight(terrain, point.x, point.z) -
                (p.height + (q.height - p.height) * t),
            );
          if (cost < score) {
            score = cost;
            best = point;
          }
        }
        points.push(best);
      }
    points.push({ x: q.x, z: q.z });
    edges.push({
      id: edgeId(a, b),
      from: a,
      to: b,
      origin: urban
        ? "urban-road"
        : airfield
          ? horizontal
            ? "runway"
            : "taxiway"
          : "rural-road",
      width: airfield
        ? horizontal
          ? 22
          : 15
        : urban
          ? 10 + (r() > 0.7 ? 3 : 0)
          : 10 + r() * 2,
      points,
      layer: 0,
    });
  };
  for (let z = 0; z <= 6; z++)
    for (let x = 0; x <= 7; x++) {
      if (x < 7) add(key(x, z), key(x + 1, z), true);
      if (z < 6) add(key(x, z), key(x, z + 1), false);
    }
  const easements = new Set<string>();
  if (urban)
    for (let z = 2; z < 6; z++)
      for (let x = 0; x < 7; x++)
        if ((x + z * 2 + (hashSeed(seed) % 4)) % 4 === 0) {
          const a = byId.get(key(x, z))!,
            b = byId.get(key(x + 1, z + 1))!;
          edges.push({
            id: edgeId(a.id, b.id),
            from: a.id,
            to: b.id,
            origin: "urban-road",
            width: 14,
            points: [
              { x: a.x, z: a.z },
              { x: b.x, z: b.z },
            ],
            layer: 0,
          });
          easements.add(`block-${x}-${z}`);
        }
  const lots: SiteNetwork["lots"] = [];
  for (let z = 0; z < 6; z++)
    for (let x = 0; x < 7; x++) {
      const p = transform((xs[x] + xs[x + 1]) / 2, (zs[z] + zs[z + 1]) / 2);
      lots.push({
        id: `block-${x}-${z}`,
        centre: p,
        width: (xs[x + 1] - xs[x]) * 0.6,
        length: (zs[z + 1] - zs[z]) * 0.6,
        heading: angle,
        use: easements.has(`block-${x}-${z}`)
          ? "road-easement"
          : urban
            ? "building"
            : r() > 0.87
              ? "exclusion"
              : "building",
      });
    }
  return {
    version: 1,
    kind: urban
      ? "urban"
      : airfield
        ? "airfield"
        : kind === "mountain"
          ? "mountain"
          : "rural",
    seed,
    nodes,
    edges,
    lots,
  };
}
function arterialCycle(network: SiteNetwork, input: string[]) {
  const cycle = [...input],
    ids = new Set(network.edges.map((e) => e.id));
  let count = 0;
  for (let pass = 0; pass < 2 && count < 4; pass++)
    for (let i = 1; i < cycle.length - 1 && count < 4; i++) {
      const a = cycle[i - 1],
        b = cycle[i],
        c = cycle[i + 1];
      if (!b.endsWith(":1") && ids.has(edgeId(a, c))) {
        cycle.splice(i, 1);
        count++;
        i++;
      }
    }
  return cycle;
}
function routePoints(
  network: SiteNetwork,
  cycle: string[],
  connector: boolean,
  seed: string,
) {
  const edges = new Map(network.edges.map((e) => [e.id, e])),
    points: Point2[] = [],
    ids: string[] = [];
  let connectorUsed = false;
  for (let i = 0; i < cycle.length; i++) {
    const from = cycle[i],
      to = cycle[(i + 1) % cycle.length],
      original = edges.get(edgeId(from, to))!,
      forward = original.from === from,
      path = (forward ? original.points : [...original.points].reverse()).map(
        (p) => ({ ...p }),
      );
    let id = original.id;
    if (
      connector &&
      !connectorUsed &&
      i > cycle.length * 0.35 &&
      !from.endsWith(":1") &&
      !to.endsWith(":1") &&
      distance(path[0], path.at(-1)!) > 380
    ) {
      const a = path[0],
        b = path.at(-1)!,
        len = distance(a, b),
        nx = (b.z - a.z) / len,
        nz = -(b.x - a.x) / len,
        offset = Math.min(70, len * 0.045 + Math.max(0, len - 600) * 0.04),
        sign = hashSeed(seed) % 2 ? 1 : -1;
      const extra: NetworkEdge = {
        ...original,
        id: `connector-${original.id}`,
        from,
        to,
        origin: "new-connector",
        width: 13,
        points: [
          a,
          { x: a.x + (b.x - a.x) * 0.3, z: a.z + (b.z - a.z) * 0.3 },
          {
            x: a.x + (b.x - a.x) * 0.45 + nx * offset * sign,
            z: a.z + (b.z - a.z) * 0.45 + nz * offset * sign,
          },
          {
            x: a.x + (b.x - a.x) * 0.6 - nx * offset * sign,
            z: a.z + (b.z - a.z) * 0.6 - nz * offset * sign,
          },
          { x: a.x + (b.x - a.x) * 0.75, z: a.z + (b.z - a.z) * 0.75 },
          b,
        ],
      };
      path.splice(0, path.length, ...extra.points);
      network.edges.push(extra);
      id = extra.id;
      connectorUsed = true;
    }
    ids.push(id);
    points.push(...path.slice(0, -1));
  }
  return { points, ids };
}
function junctionFootprints(points: Point2[], radius: number) {
  const n = points.length,
    lengths = [0];
  for (let i = 0; i < n; i++)
    lengths.push(lengths.at(-1)! + distance(points[i], points[(i + 1) % n]));
  const total = lengths.at(-1)!;
  const junctions = points.map((p, i) => {
    const a = points[(i + n - 1) % n],
      b = points[(i + 1) % n],
      u = distance(a, p),
      v = distance(p, b);
    return (
      Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            ((p.x - a.x) * (b.x - p.x) + (p.z - a.z) * (b.z - p.z)) / (u * v),
          ),
        ),
      ) > 0.48
    );
  });
  return points.filter(
    (_, i) =>
      junctions[i] ||
      !junctions.some(
        (hard, j) =>
          hard &&
          Math.min(
            Math.abs(lengths[i] - lengths[j]),
            total - Math.abs(lengths[i] - lengths[j]),
          ) <
            radius * 1.5,
      ),
  );
}
export function networkDefinition(recipe: FamilyRecipe) {
  const descriptor = FAMILY_PRESETS[recipe.family],
    full = region(recipe.seed, recipe.family, "full", 0),
    club = region(recipe.seed, recipe.family, "club", 0),
    land: TerrainSpec = {
      seed: hashSeed(`${recipe.seed}/land-v3`),
      amplitude:
        recipe.family === "mountain"
          ? recipe.relief === "rolling"
            ? 130
            : 70
          : recipe.family === "street"
            ? 4
            : recipe.family === "airfield"
              ? 2
              : recipe.relief === "rolling"
                ? 65
                : 24,
      wavelength:
        recipe.family === "mountain" ? 1200 : recipe.targetLength * 0.28,
      baseHeight: 5,
    },
    meta: FamilyDesign = {
      version: 1,
      generator: "circuit-v3.1",
      family: recipe.family,
      siteOrigin: "rural",
      network: {
        version: 1,
        kind: "rural",
        seed: recipe.seed,
        nodes: [],
        edges: [],
        lots: [],
      },
      variants: [],
      activeVariant: recipe.variant,
      route: [],
      layer: 0,
      streaming: {
        cellSize: 128,
        radius: 260,
        retireRadius: 360,
        maxSurfaceChunks: 112,
        maxBarrierChunks: 112,
        terrainSpacing:
          recipe.targetLength > 14000
            ? 38
            : recipe.targetLength > 8000
              ? 28
              : 20,
        roadStep: recipe.targetLength > 8000 ? 3 : 2,
      },
    };
  const radius =
      recipe.family === "street"
        ? 68
        : recipe.family === "mountain"
          ? 90
          : recipe.family === "airfield"
            ? 92
            : 110,
    spacing = recipe.targetLength > 8000 ? 18 : 12;
  let scale = recipe.targetLength / (full.cycle.length * 0.94),
    network!: SiteNetwork;
  const build = (cycle: string[], connectors: boolean) => {
    const routed =
      recipe.family === "street" ? arterialCycle(network, cycle) : cycle;
    const route = routePoints(network, routed, connectors, recipe.seed),
      nodes = new Map(network.nodes.map((n) => [n.id, n])),
      a = nodes.get("1:1")!,
      b = nodes.get("4:1")!,
      grid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    return {
      ...route,
      cycle: routed,
      controls: rotateControls(
        roundedControls(
          junctionFootprints(route.points, radius),
          radius,
          spacing,
        ),
        grid,
      ),
    };
  };
  // Land/road scale is fixed from Route A, before selecting alternatives. Alternate
  // cycles and the club variant reuse those exact same roads, not scaled silhouettes.
  for (let pass = 0; pass < 2; pass++) {
    network = baseGrid(recipe.seed, scale, recipe.family, land);
    const r = build(full.cycle, false),
      def = emptyDefinition("scale", "scale", r.controls, meta),
      length = new Alignment(def).length;
    scale *= recipe.targetLength / length;
  }
  network = baseGrid(recipe.seed, scale, recipe.family, land);
  let selected = recipe.variant === "club" ? club : full;
  const routeChoice =
    recipe.layout +
    (recipe.character === "flowing"
      ? 23
      : recipe.character === "technical"
        ? 47
        : 0);
  if (routeChoice && recipe.variant !== "club") {
    let best = Infinity;
    for (let i = 0; i < 18; i++) {
      const candidate = region(
          recipe.seed,
          recipe.family,
          "full",
          routeChoice * 19 + i,
        ),
        r = build(candidate.cycle, false),
        d = emptyDefinition("alternative", "alternative", r.controls, meta),
        score = Math.abs(new Alignment(d).length - recipe.targetLength);
      if (score < best) {
        selected = candidate;
        best = score;
      }
    }
  }
  const main = build(
      selected.cycle,
      ["rural", "endurance", "mountain"].includes(recipe.family),
    ),
    short = build(club.cycle, false),
    base = build(full.cycle, false);
  meta.network = network;
  meta.siteOrigin = network.kind;
  const variants: [string, string, ReturnType<typeof build>, string[]][] = [
    ["full", "Full venue", base, base.cycle],
    ["club", "Club loop", short, short.cycle],
  ];
  meta.variants = variants.map(([id, name, r, nodeIds]) => ({
    id,
    name,
    edgeIds: r.ids,
    nodeIds,
    length: new Alignment(emptyDefinition(id, name, r.controls, meta)).length,
    branchId: "main",
    layer: 0,
  }));
  const active: RouteVariant = {
    id: recipe.variant,
    name:
      recipe.variant === "club"
        ? "Club loop"
        : `Full venue / Route ${recipe.layout + 1}`,
    edgeIds: main.ids,
    nodeIds: main.cycle,
    length: 0,
    branchId: "main",
    layer: 0,
  };
  meta.variants = meta.variants.map((v) => (v.id === active.id ? active : v));
  const def = emptyDefinition(
    `v3-${recipe.family}-${hashSeed(JSON.stringify(recipe)).toString(16)}`,
    `${descriptor.name} / ${recipe.seed.slice(0, 22)}${recipe.variant === "club" ? " / Club" : ""}`,
    main.controls,
    meta,
  );
  def.site.terrain = land;
  const path = new Alignment(def);
  active.length = path.length;
  // Project each actual road edge onto the fitted loop, preserving provenance.
  const rows = Array.from({ length: Math.ceil(path.length / 12) }, (_, i) =>
      path.sample((i * path.length) / Math.ceil(path.length / 12)),
    ),
    used = main.ids.map((id) => network.edges.find((e) => e.id === id)!);
  const nearEdge = (p: Point2, e: NetworkEdge) => {
    let d = Infinity;
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1],
        b = e.points[i],
        dx = b.x - a.x,
        dz = b.z - a.z,
        t = Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz),
          ),
        );
      d = Math.min(d, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
    }
    return d;
  };
  rows.forEach((row, i) => {
    const edge = used.reduce((a, b) =>
        nearEdge(row.position, a) < nearEdge(row.position, b) ? a : b,
      ),
      role =
        Math.abs(row.curvature) > 0.004
          ? edge.origin === "new-connector"
            ? "Technical connector"
            : "Fitted junction"
          : edge.origin === "runway"
            ? "Runway acceleration"
            : Math.abs(row.curvature) < 0.0004
              ? "Inherited straight"
              : "Contour road",
      previous = meta.route.at(-1);
    if (previous?.edgeId === edge.id && previous.role === role)
      previous.end = (i + 1) / rows.length;
    else
      meta.route.push({
        at: i / rows.length,
        end: (i + 1) / rows.length,
        edgeId: edge.id,
        origin: edge.origin,
        role,
      });
  });
  return def;
}
