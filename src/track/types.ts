import type { Vec3 } from "../vehicle/types";
import type { VenueDefinition } from "./venue/types";
import type { FamilyDesign, OvalSample } from "./families/types";

export type SurfaceId =
  | "asphalt"
  | "kerb"
  | "runoff"
  | "grass"
  | "gravel"
  | "sand";
export interface SurfaceMaterial {
  name: string;
  color: number;
  grip: number;
  rollingResistance: number;
  /** Soil displacement is separate from rubber grip and rolling torque. */
  ploughing?: number;
  roughness?: number;
}
export const SURFACES: Record<SurfaceId, SurfaceMaterial> = {
  asphalt: {
    name: "Asphalt",
    color: 0x515d60,
    grip: 1,
    rollingResistance: 0.006,
  },
  kerb: {
    name: "Kerb",
    color: 0xc84737,
    grip: 0.88,
    rollingResistance: 0.012,
    roughness: 1,
  },
  runoff: {
    name: "Tarmac run-off",
    color: 0x707d7b,
    grip: 0.96,
    rollingResistance: 0.008,
  },
  grass: {
    name: "Grass",
    color: 0x71875b,
    grip: 0.55,
    rollingResistance: 0.035,
    roughness: 0.25,
  },
  gravel: {
    name: "Gravel",
    color: 0xaa9c88,
    grip: 0.48,
    rollingResistance: 0.065,
    ploughing: 0.14,
    roughness: 0.7,
  },
  sand: {
    name: "Sand",
    color: 0xccb77e,
    grip: 0.38,
    rollingResistance: 0.1,
    ploughing: 0.24,
    roughness: 0.45,
  },
};
export interface ProfileKey {
  at: number;
  value: number;
  /** Derivatives with respect to normalised station, for C2 Hermite profiles. */
  slope?: number;
  second?: number;
}
export interface CircuitSection {
  start: number;
  name: string;
  runoff: SurfaceId;
  leftShoulder?: SurfaceId;
  rightShoulder?: SurfaceId;
}
export interface KerbZone {
  start: number;
  end: number;
  side: "left" | "right";
  role?: "entry" | "apex" | "exit" | "chicane";
}
export interface CircuitStart {
  id: string;
  name: string;
  at: number;
  lateral?: "kerb-left" | "kerb-right" | "edge-right" | number;
  description: string;
}
export interface TerrainSpec {
  seed: number;
  amplitude: number;
  wavelength: number;
  baseHeight: number;
}
export interface SiteReservation {
  centre: { x: number; z: number };
  forward: { x: number; z: number };
  width: number;
  length: number;
  height: number;
}
export interface CircuitDefinition {
  id: string;
  name: string;
  controlPoints: { x: number; z: number }[];
  elevation: ProfileKey[];
  leftWidth: ProfileKey[];
  rightWidth: ProfileKey[];
  /** Positive banking raises the left edge; corner banking is derived from curvature. */
  bankStrength: ProfileKey[];
  /** Explicit designed bank in radians (v2); legacy strength remains reproducible. */
  bank?: ProfileKey[];
  crown: ProfileKey[];
  kerbs: KerbZone[];
  sections: CircuitSection[];
  starts: CircuitStart[];
  venue?: VenueDefinition;
  familyDesign?: FamilyDesign;
  site: {
    centre: { x: number; z: number };
    radius: number;
    terrain?: TerrainSpec;
    /** v1 keeps its radial mesh; v2 cuts an arbitrary corridor from world terrain. */
    mesh?: "corridor";
    /** A level footprint reserved beside the grid for future pits and paddock. */
    paddock?: SiteReservation;
  };
}
export interface RoadSample {
  station: number;
  distance: number;
  position: Vec3;
  forward: Vec3;
  left: Vec3;
  grade: number;
  curvature: number;
  bank: number;
  crown: number;
  leftWidth: number;
  rightWidth: number;
  kerbLeft: number;
  kerbRight: number;
  kerbHeight?: number;
  runoffLeft?: number;
  runoffRight?: number;
  materialLeft?: SurfaceId;
  materialRight?: SurfaceId;
  pitSide?: 1 | -1;
  oval?: OvalSample;
  section: CircuitSection;
}
export interface SurfaceChunk {
  kind?: "road" | "terrain";
  vertices: Float32Array;
  indices: Uint32Array;
  /** Exactly one material ID per collision triangle. */
  surfaces: SurfaceId[];
  /** Display paint (kerb stripes / edge lines) per triangle; geometry stays identical. */
  colors: Uint32Array;
}
export interface CircuitLocation {
  station: number;
  distance: number;
  lateral: number;
  sample: RoadSample;
  branchId?: "main" | "pit";
  variantId?: string;
  layer?: 0;
}
