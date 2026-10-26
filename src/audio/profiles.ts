import type { VehicleSetup } from "../vehicle/types";
import type { EngineAudioProfile, EngineProfileId } from "./types";

/** Independent cosmetic version: changes never alter car/session mechanics. */
export const ENGINE_AUDIO_PROFILE_VERSION = 1;

const templates: Record<EngineProfileId, Omit<EngineAudioProfile, "id" | "seed">> = {
  compact: { cylinders: 4, body: 0.65, brightness: 1.25, irregularity: 0.24 },
  sport: { cylinders: 6, body: 0.95, brightness: 1.05, irregularity: 0.12 },
  deep: { cylinders: 8, body: 1.25, brightness: 0.75, irregularity: 0.3 },
};

function hash(value: string) {
  let seed = 2166136261;
  for (let index = 0; index < value.length; index++)
    seed = Math.imul(seed ^ value.charCodeAt(index), 16777619);
  return seed >>> 0;
}

/** Cylinder count is authored sound design; the physics simulates no cylinders. */
export function engineAudioProfile(setup: VehicleSetup): EngineAudioProfile {
  const family = setup.vehicle?.family,
    id: EngineProfileId = family
      ? family === "hatch"
        ? "compact"
        : ["sedan", "gt", "stock", "awd"].includes(family)
          ? "deep"
          : "sport"
      : setup.referenceCar === "ff"
        ? "compact"
        : setup.referenceCar === "awd"
          ? "deep"
          : "sport",
    seed = hash(
      `${ENGINE_AUDIO_PROFILE_VERSION}:${family ?? setup.referenceCar}:${setup.vehicle?.recipe.seed ?? "reference"}`,
    ),
    template = templates[id],
    vary = (value: number, shift: number, low: number, high: number) =>
      Math.max(low, Math.min(high, value + (((seed >>> shift) & 255) / 255 - 0.5) * 0.06));
  return {
    id,
    cylinders: template.cylinders,
    body: vary(template.body, 0, 0.5, 1.5),
    brightness: vary(template.brightness, 8, 0.5, 1.5),
    irregularity: vary(template.irregularity, 16, 0, 1),
    seed,
  };
}
