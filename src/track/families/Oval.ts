import { Alignment } from "../Alignment";
import { hashSeed } from "../Terrain";
import { seededRandom } from "../../core/math";
import {
  emptyDefinition,
  roundedControls,
  rotateControls,
  distance,
  lerp,
} from "./curves";
import type { Point2 } from "./curves";
import type { FamilyDesign, FamilyRecipe, NetworkEdge } from "./types";
import { FAMILY_PRESETS } from "./types";

interface Section {
  points: Point2[];
  origin: NetworkEdge["origin"];
  role: string;
}
function line(a: Point2, b: Point2, step = 10) {
  return Array.from(
    { length: Math.max(2, Math.ceil(distance(a, b) / step)) + 1 },
    (_, i) => lerp(a, b, i / Math.max(2, Math.ceil(distance(a, b) / step))),
  );
}
function stadium(recipe: FamilyRecipe, scale: number, club = false): Section[] {
  const random = seededRandom(
      hashSeed(`${recipe.seed}/speedway/${recipe.layout}`),
    ),
    R = scale,
    S = R * (2.2 + random() * 0.8),
    leftR = recipe.oval === "asymmetric" ? R * 0.78 : R,
    rightR = recipe.oval === "asymmetric" ? R * 1.12 : R,
    delta = (rightR - leftR) / S,
    vertical = Math.sqrt(1 - delta * delta),
    left = { x: -S / 2, z: 0 },
    right = { x: S / 2, z: 0 },
    a = { x: left.x - leftR * delta, z: -leftR * vertical },
    b = { x: right.x - rightR * delta, z: -rightR * vertical },
    c = { x: left.x - leftR * delta, z: leftR * vertical },
    d = { x: right.x - rightR * delta, z: rightR * vertical },
    mid = lerp(a, b, 0.5),
    low = Math.atan2(-vertical, -delta),
    high = Math.atan2(vertical, -delta);
  const arc = (centre: Point2, radius: number, start: number, end: number) =>
    Array.from(
      { length: Math.ceil(((start - end) * radius) / 8) + 1 },
      (_, i) => {
        const t =
          start + ((end - start) * i) / Math.ceil(((start - end) * radius) / 8);
        return { x: centre.x + Math.cos(t) * radius, z: Math.sin(t) * radius };
      },
    );
  const sections: Section[] = [
    { points: line(mid, a), origin: "speedway", role: "Back straight" },
    {
      points: arc(left, leftR, low, high - 2 * Math.PI),
      origin: "speedway",
      role: "Turn 1 / banked sweep",
    },
  ];
  if (recipe.family === "hybrid") {
    const M = Math.min(140, S * 0.18),
      ix0 = c.x + M,
      ix1 = d.x - M,
      middle0 = ix0 + (ix1 - ix0) / 3,
      middle1 = ix0 + ((ix1 - ix0) * 2) / 3,
      p = club
        ? [
            c,
            { x: c.x + M, z: c.z },
            { x: c.x + M, z: R * 0.32 },
            { x: d.x - M, z: R * 0.32 },
            { x: d.x - M, z: d.z },
            d,
          ]
        : [
            c,
            { x: c.x + M, z: c.z },
            { x: c.x + M, z: R * 0.32 },
            { x: middle0, z: R * 0.32 },
            { x: middle0, z: -R * 0.3 },
            { x: middle1, z: -R * 0.3 },
            { x: middle1, z: R * 0.54 },
            { x: d.x - M, z: R * 0.54 },
            { x: d.x - M, z: d.z },
            d,
          ];
    sections.push({
      points: p,
      origin: "new-connector",
      role: club ? "Infield sprint" : "Infield esses & braking complex",
    });
  } else if (recipe.oval === "tri-oval") {
    const steps = Math.ceil(S / 8),
      points = Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps,
          p = lerp(c, d, t);
        p.z += R * 0.52 * Math.sin(Math.PI * t) ** 2;
        return p;
      });
    sections.push({
      points,
      origin: "speedway",
      role: "Tri-oval front stretch",
    });
  } else
    sections.push({
      points: line(c, d),
      origin: "speedway",
      role: "Front stretch",
    });
  sections.push(
    {
      points: arc(right, rightR, high, low),
      origin: "speedway",
      role: "Turn 3 / banked sweep",
    },
    { points: line(b, mid), origin: "speedway", role: "Grid straight" },
  );
  return sections;
}
export function ovalDefinition(recipe: FamilyRecipe) {
  const meta: FamilyDesign = {
    version: 1,
    generator: "circuit-v3.1",
    family: recipe.family,
    siteOrigin: "speedway",
    network: {
      version: 1,
      kind: "speedway",
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
      terrainSpacing: 20,
      roadStep: 2,
    },
  };
  const make = (scale: number, club = false) => {
    const sections = stadium(recipe, scale, club),
      raw = sections.flatMap((s) => s.points.slice(0, -1)),
      grid = sections[0].points[0],
      controls = rotateControls(
        roundedControls(
          raw,
          recipe.family === "hybrid" ? Math.min(88, scale * 0.36) : scale * 0.8,
          10,
        ),
        grid,
      );
    return { sections, controls };
  };
  let scale = recipe.targetLength / (recipe.family === "hybrid" ? 17 : 11.7);
  for (let i = 0; i < 3; i++) {
    const r = make(scale);
    scale *=
      recipe.targetLength /
      new Alignment(emptyDefinition("scale", "scale", r.controls, meta)).length;
  }
  const full = make(scale),
    club = make(scale, true),
    speedwaySections = stadium({ ...recipe, family: "oval" }, scale),
    speedway = {
      sections: speedwaySections,
      controls: rotateControls(
        roundedControls(
          speedwaySections.flatMap((s) => s.points.slice(0, -1)),
          scale * 0.8,
          10,
        ),
        speedwaySections[0].points[0],
      ),
    },
    chosen =
      recipe.variant === "speedway"
        ? speedway
        : recipe.variant === "club" && recipe.family === "hybrid"
          ? club
          : full;
  const makeEdges = (sections: Section[], suffix: string) =>
    sections.map((s, i) => {
      const from = `${suffix}-${i}`,
        to = `${suffix}-${(i + 1) % sections.length}`,
        p = s.points[0];
      meta.network.nodes.push({
        id: from,
        ...p,
        height: 3,
        role: s.origin === "speedway" ? "junction" : "connector",
        layer: 0,
      });
      const e: NetworkEdge = {
        id: `${suffix}-section-${i}`,
        from,
        to,
        origin: s.origin,
        width: s.origin === "speedway" ? 21 : 13.5,
        points: s.points,
        layer: 0,
      };
      meta.network.edges.push(e);
      return e;
    });
  const fullEdges = makeEdges(full.sections, "full"),
    clubEdges =
      recipe.family === "hybrid" ? makeEdges(club.sections, "club") : fullEdges;
  const speedwayEdges =
    recipe.family === "hybrid"
      ? makeEdges(speedway.sections, "speedway")
      : fullEdges;
  meta.variants = [
    {
      id: "full",
      name: recipe.family === "hybrid" ? "Full infield road/oval" : "Speedway",
      edgeIds: fullEdges.map((e) => e.id),
      nodeIds: fullEdges.map((e) => e.from),
      length: new Alignment(
        emptyDefinition("full", "full", full.controls, meta),
      ).length,
      branchId: "main",
      layer: 0,
    },
  ];
  if (recipe.family === "hybrid")
    meta.variants.push({
      id: "club",
      name: "Infield sprint",
      edgeIds: clubEdges.map((e) => e.id),
      nodeIds: clubEdges.map((e) => e.from),
      length: new Alignment(
        emptyDefinition("club", "club", club.controls, meta),
      ).length,
      branchId: "main",
      layer: 0,
    });
  if (recipe.family === "hybrid")
    meta.variants.push({
      id: "speedway",
      name: "Speedway oval",
      edgeIds: speedwayEdges.map((e) => e.id),
      nodeIds: speedwayEdges.map((e) => e.from),
      length: new Alignment(
        emptyDefinition("speedway", "speedway", speedway.controls, meta),
      ).length,
      branchId: "main",
      layer: 0,
    });
  const def = emptyDefinition(
    `v3-${recipe.family}-${hashSeed(JSON.stringify(recipe)).toString(16)}`,
    `${FAMILY_PRESETS[recipe.family].name} / ${recipe.seed.slice(0, 22)}${recipe.variant === "club" ? " / Sprint" : ""}`,
    chosen.controls,
    meta,
  );
  def.site.terrain = {
    seed: hashSeed(`${recipe.seed}/speedway-land`),
    amplitude: 1.2,
    wavelength: 800,
    baseHeight: 0,
  };
  def.elevation = [
    { at: 0, value: 3 },
    { at: 1, value: 3 },
  ];
  const path = new Alignment(def),
    edges =
      recipe.variant === "speedway"
        ? speedwayEdges
        : recipe.variant === "club" && recipe.family === "hybrid"
          ? clubEdges
          : fullEdges,
    count = Math.ceil(path.length / 8);
  const near = (p: Point2, e: NetworkEdge) => {
    let best = Infinity;
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
      best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
    }
    return best;
  };
  for (let i = 0; i < count; i++) {
    const p = path.sample((i * path.length) / count),
      e = edges.reduce((a, b) =>
        near(p.position, a) < near(p.position, b) ? a : b,
      ),
      role = chosen.sections[edges.indexOf(e)].role,
      previous = meta.route.at(-1);
    if (previous?.edgeId === e.id) previous.end = (i + 1) / count;
    else
      meta.route.push({
        at: i / count,
        end: (i + 1) / count,
        edgeId: e.id,
        origin: e.origin,
        role,
      });
  }
  return def;
}
