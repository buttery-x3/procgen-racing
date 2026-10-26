import type { CompiledCircuit } from "../track/SurfaceCompiler";
import type { VehicleSetup } from "../vehicle/types";
import { sanitizeSetup } from "../vehicle/setup";

declare const __PHYSICS_VERSION__: string;
export const PHYSICS_VERSION =
  typeof __PHYSICS_VERSION__ === "string" ? __PHYSICS_VERSION__ : "unbundled";
export const RULES_VERSION = "solo-1";

/** Stable local compatibility checksums, not signatures or an anti-cheat service. */
export function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJSON(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function checksum(value: unknown): string {
  let a = 2166136261,
    b = 0x9e3779b9;
  for (const c of stableJSON(value)) {
    a = Math.imul(a ^ c.charCodeAt(0), 16777619);
    b = Math.imul(b ^ c.charCodeAt(0), 0x85ebca6b);
  }
  return (
    (a >>> 0).toString(16).padStart(8, "0") +
    (b >>> 0).toString(16).padStart(8, "0")
  );
}
export interface SessionIdentity {
  key: string;
  track: string;
  car: string;
  setup: string;
  assists: string;
  physics: string;
  rules: string;
  variant: string;
}
const ASSISTS = [
  "tractionControl",
  "abs",
  "stabilityAssist",
  "countersteerAssist",
  "speedSteering",
  "autoHold",
  "steeringLimit",
] as const;
const trackHashes = new WeakMap<CompiledCircuit, string>();
export function sessionIdentity(
  circuit: CompiledCircuit,
  source: VehicleSetup,
  physics = PHYSICS_VERSION,
): SessionIdentity {
  const tune = sanitizeSetup(source),
    { vehicle, ...settings } = tune;
  const assists = Object.fromEntries(ASSISTS.map((k) => [k, settings[k]]));
  const mechanical = Object.fromEntries(
    Object.entries(settings).filter(
      ([k]) => !ASSISTS.includes(k as (typeof ASSISTS)[number]),
    ),
  );
  const definition = circuit.definition,
    venue = definition.venue;
  const track =
    trackHashes.get(circuit) ??
    checksum({
      ...definition,
      name: undefined,
      id: undefined,
      starts: definition.starts.map((s) => ({
        id: s.id,
        at: s.at,
        lateral: s.lateral,
      })),
      venue: venue && {
        ...venue,
        props: venue.props.filter((p) => p.solid),
        report: undefined,
        baseFingerprint: undefined,
        geometryFingerprint: undefined,
        sceneryFingerprint: undefined,
        settings: {
          ...venue.settings,
          scenery: undefined,
          scenerySeed: undefined,
          theme: undefined,
        },
      },
    });
  trackHashes.set(circuit, track);
  const car = checksum(
    vehicle
      ? {
          family: vehicle.family,
          dimensions: vehicle.dimensions,
          shape: vehicle.shape,
          components: vehicle.components,
        }
      : { reference: settings.referenceCar },
  );
  const context = {
    track,
    car,
    setup: checksum(mechanical),
    assists: checksum(assists),
    physics,
    rules: RULES_VERSION,
    variant: definition.familyDesign?.activeVariant ?? "full",
  };
  return { ...context, key: checksum(context) };
}
