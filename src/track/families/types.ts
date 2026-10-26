import type { ProfileKey } from "../types";
import type { Vec3 } from "../../vehicle/types";

export const FAMILY_PRESETS = {
  street: {
    name: "Urban street circuit",
    min: 2200,
    max: 6000,
    length: 3600,
    width: 11,
    note: "A closed cycle through city blocks and arterials, with junction escapes and close walls.",
  },
  rural: {
    name: "Inherited road / endurance",
    min: 4000,
    max: 14000,
    length: 7200,
    width: 11.5,
    note: "Fast inherited roads linked by a purpose-built technical section. A closed road-racing venue.",
  },
  mountain: {
    name: "Mountain road circuit",
    min: 3500,
    max: 7500,
    length: 5400,
    width: 10.5,
    note: "A closed climb, ridge and valley loop, with protected edges. No open stage or cliff road.",
  },
  airfield: {
    name: "Airfield circuit",
    min: 2800,
    max: 7000,
    length: 4200,
    width: 14,
    note: "Runway and taxiway axes connected by technical apron corners on a low-relief site.",
  },
  oval: {
    name: "Oval speedway",
    min: 800,
    max: 4400,
    length: 2400,
    width: 21,
    note: "Dedicated oval grammar, progressive lane banking, paved apron and continuous outer wall.",
  },
  hybrid: {
    name: "Road / oval hybrid",
    min: 2800,
    max: 6800,
    length: 4400,
    width: 15,
    note: "A banked speedway sector and a purpose-built infield loop, joined by designed transitions.",
  },
  endurance: {
    name: "Extended endurance circuit",
    min: 8000,
    max: 24000,
    length: 12000,
    width: 12.5,
    note: "A full-scale inherited-road venue with fast sectors, technical connectors and long-lap streaming.",
  },
} as const;
export type ExpandedFamily = keyof typeof FAMILY_PRESETS;
export type RoadOrigin =
  | "urban-road"
  | "rural-road"
  | "runway"
  | "taxiway"
  | "new-connector"
  | "speedway";
export interface FamilyRecipe {
  version: 3;
  seed: string;
  family: ExpandedFamily;
  relief: "gentle" | "rolling";
  targetLength: number;
  character: "mixed" | "flowing" | "technical";
  envelope: "comfortable" | "terrain";
  layout: number;
  variant: "full" | "club" | "speedway";
  oval: "oval" | "tri-oval" | "asymmetric";
  banking: "mild" | "fast";
  endurance: boolean;
}
export const DEFAULT_FAMILY_RECIPE: FamilyRecipe = {
  version: 3,
  seed: "city-101",
  family: "street",
  relief: "gentle",
  targetLength: 3600,
  character: "mixed",
  envelope: "comfortable",
  layout: 0,
  variant: "full",
  oval: "oval",
  banking: "mild",
  endurance: false,
};
export function normalizeFamilyRecipe(input: FamilyRecipe): FamilyRecipe {
  const family = input.family in FAMILY_PRESETS ? input.family : "street",
    p = FAMILY_PRESETS[family];
  return {
    version: 3,
    seed:
      String(input.seed ?? "city-101")
        .trim()
        .slice(0, 64) || "city-101",
    family,
    relief: input.relief === "rolling" ? "rolling" : "gentle",
    targetLength:
      Math.round(
        Math.max(
          p.min,
          Math.min(p.max, Number(input.targetLength) || p.length),
        ) / 100,
      ) * 100,
    character:
      input.character === "flowing" || input.character === "technical"
        ? input.character
        : "mixed",
    envelope: input.envelope === "terrain" ? "terrain" : "comfortable",
    layout: Math.max(0, Math.min(99, Math.floor(Number(input.layout) || 0))),
    variant:
      input.variant === "speedway" && family === "hybrid"
        ? "speedway"
        : input.variant === "club" && family !== "oval"
          ? "club"
          : "full",
    oval:
      input.oval === "tri-oval" || input.oval === "asymmetric"
        ? input.oval
        : "oval",
    banking: input.banking === "fast" ? "fast" : "mild",
    endurance: input.endurance === true || family === "endurance",
  };
}
export interface NetworkNode {
  id: string;
  x: number;
  z: number;
  height: number;
  role: "junction" | "pass" | "connector";
  layer: 0;
}
export interface NetworkEdge {
  id: string;
  from: string;
  to: string;
  origin: RoadOrigin;
  width: number;
  points: { x: number; z: number }[];
  layer: 0;
}
export interface PropertyLot {
  id: string;
  centre: { x: number; z: number };
  width: number;
  length: number;
  heading: number;
  use: "building" | "paddock" | "exclusion" | "road-easement";
}
export interface SiteNetwork {
  version: 1;
  kind: "urban" | "rural" | "mountain" | "airfield" | "speedway";
  seed: string;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  lots: PropertyLot[];
}
export interface RouteVariant {
  id: string;
  name: string;
  edgeIds: string[];
  nodeIds: string[];
  length: number;
  branchId: "main";
  layer: 0;
}
export interface OvalSurface {
  inside: 1 | -1;
  /** Signed banking is independent of GP curvature banking. Angles are radians. */
  innerBank: ProfileKey[];
  outerBank: ProfileKey[];
  blend: ProfileKey[];
  apronBank: number;
  apronWidth: number;
  apronBlend: number;
}
export interface OvalSample {
  inside: 1 | -1;
  innerBank: number;
  outerBank: number;
  blend: number;
  apronBank: number;
  apronWidth: number;
  apronBlend: number;
}
export interface FamilyDesign {
  version: 1;
  generator: "circuit-v3.1";
  family: ExpandedFamily;
  siteOrigin: SiteNetwork["kind"];
  network: SiteNetwork;
  variants: RouteVariant[];
  activeVariant: string;
  /** Horizontal station, including separate provenance through a fitted junction. */
  route: {
    at: number;
    end: number;
    edgeId: string;
    origin: RoadOrigin;
    role: string;
  }[];
  oval?: OvalSurface;
  layer: 0;
  streaming: {
    cellSize: number;
    radius: number;
    retireRadius: number;
    maxSurfaceChunks: number;
    maxBarrierChunks: number;
    terrainSpacing: number;
    roadStep: number;
  };
  compatibility?: {
    vehicle: "touring" | "gt" | "prototype" | "stock";
    peakSpeed: number;
    minimumRadius: number;
    notes: string;
  }[];
}
export interface FamilyDiagnostics {
  inheritedShare: number;
  connectorShare: number;
  networkNodes: number;
  networkEdges: number;
  junctions: number;
  variants: number;
  laneBankRange: [number, number];
  maxLaneBankRate: number;
  branchIds: string[];
  transferBytes: number;
  surfaceChunks: number;
  triangles: number;
}
export interface CircuitHint {
  station?: number;
  forward?: Vec3;
  branchId?: string;
}
