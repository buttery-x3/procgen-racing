import type { ProfileKey, SurfaceId } from "../types";
import type { Vec3 } from "../../vehicle/types";

export type VenueTheme = "club" | "traditional" | "modern" | "desert";
export interface VenueSettings {
  version: 1;
  enabled: boolean;
  theme: VenueTheme;
  kerb: "low" | "raised";
  pits: boolean;
  scenery: "sparse" | "standard" | "dense";
  scenerySeed: string;
}
export const DEFAULT_VENUE: VenueSettings = {
  version: 1,
  enabled: true,
  theme: "traditional",
  kerb: "low",
  pits: true,
  scenery: "standard",
  scenerySeed: "scenery-1",
};
export function normalizeVenue(
  input: Partial<VenueSettings> = {},
): VenueSettings {
  if (input.version !== undefined && input.version !== 1)
    throw new Error("Unsupported venue recipe version.");
  return {
    version: 1,
    enabled: input.enabled !== false,
    theme: ["club", "traditional", "modern", "desert"].includes(
      input.theme ?? "",
    )
      ? input.theme!
      : DEFAULT_VENUE.theme,
    kerb: input.kerb === "raised" ? "raised" : "low",
    pits: input.pits !== false,
    scenery:
      input.scenery === "sparse" || input.scenery === "dense"
        ? input.scenery
        : "standard",
    scenerySeed:
      String(input.scenerySeed ?? "scenery-1")
        .trim()
        .slice(0, 64) || "scenery-1",
  };
}
export function venueGeometrySettings(settings: VenueSettings) {
  const { scenery, scenerySeed, ...geometry } = normalizeVenue(settings);
  return geometry;
}
export interface EscapeFan {
  at: number;
  side: "left" | "right";
  approachSpeed: number;
  designSpeed: number;
  terminalSpeed: number;
  spaceLimited: boolean;
  paths: Vec3[][];
  available: number;
  surface: SurfaceId;
}
export interface BarrierPath {
  id: string;
  kind: "guardrail" | "wall" | "tyres" | "impact";
  points: Vec3[];
  width: number;
  height: number;
  closed: boolean;
}
export interface PitLane {
  side: 1 | -1;
  entry: number;
  exit: number;
  mergeLength: number;
  offset: number;
  joinOffset: number;
  width: number;
  speedLimit: number;
  points: Vec3[];
  apronStart: number;
  apronEnd: number;
}
export interface ServiceRoad {
  points: Vec3[];
  width: number;
}
export interface VenueProp {
  kind:
    | "garage"
    | "stand"
    | "marshal"
    | "tree"
    | "bush"
    | "board"
    | "marker"
    | "light";
  position: Vec3;
  heading: number;
  scale: number;
  label?: string;
  solid?: boolean;
}
export interface VenueDefinition {
  version: 1;
  settings: VenueSettings;
  baseFingerprint: string;
  geometryFingerprint: string;
  sceneryFingerprint: string;
  leftRunoff: ProfileKey[];
  rightRunoff: ProfileKey[];
  leftMaterial: SurfaceId[];
  rightMaterial: SurfaceId[];
  fans: EscapeFan[];
  barriers: BarrierPath[];
  pit?: PitLane;
  access?: ServiceRoad;
  props: VenueProp[];
  report: {
    kerbs: number;
    kerbCoverage: number;
    maxRunoff: number;
    spaceLimited: number;
    revisions?: string[];
    checks: { name: string; status: "pass" | "fail"; detail: string }[];
  };
}
