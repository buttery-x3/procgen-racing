import { seededRandom } from "../core/math";
import { hashSeed } from "../track/Terrain";
import { DEFAULT_DESIGN_RECIPE, normalizeRecipe } from "../track/generationTypes";
import type { GenerationRecipe } from "../track/generationTypes";
import { DEFAULT_FAMILY_RECIPE } from "../track/families/types";
import { DEFAULT_VENUE } from "../track/venue/types";
import type { VenueSettings } from "../track/venue/types";
import { ARCHETYPES, DEFAULT_CAR_RECIPE } from "../vehicle/generateCar";
import type { CarFamily, CarRecipe } from "../vehicle/CarDefinition";

export const CATEGORIES = ["club", "touring", "endurance", "prototype", "formula", "stock"] as const;
export type Category = typeof CATEGORIES[number];
export const categoryName = (id: Category) => id[0].toUpperCase() + id.slice(1);
interface TrackChoice { version: 2 | 3; family: GenerationRecipe["family"]; min: number; max: number }
interface CategoryPreset { cars: CarFamily[]; bands: CarRecipe["band"][]; tracks: TrackChoice[] }
export const CATEGORY_PRESETS: Record<Category, CategoryPreset> = {
  club: { cars: ["hatch", "coupe"], bands: ["road", "sport"], tracks: [{ version: 2, family: "touring", min: 2000, max: 3200 }] },
  touring: { cars: ["hatch", "sedan", "coupe"], bands: ["sport", "race"], tracks: [{ version: 2, family: "touring", min: 2800, max: 4500 }, { version: 3, family: "street", min: 2800, max: 4500 }, { version: 3, family: "airfield", min: 2800, max: 4500 }] },
  endurance: { cars: ["gt", "prototype"], bands: ["race"], tracks: [{ version: 3, family: "rural", min: 6000, max: 10000 }, { version: 3, family: "endurance", min: 8000, max: 12000 }] },
  prototype: { cars: ["prototype"], bands: ["race"], tracks: [{ version: 2, family: "gp", min: 4000, max: 6000 }, { version: 3, family: "endurance", min: 8000, max: 12000 }] },
  formula: { cars: ["open-wheel"], bands: ["race"], tracks: [{ version: 2, family: "gp", min: 4000, max: 6000 }, { version: 3, family: "airfield", min: 3500, max: 5500 }] },
  stock: { cars: ["stock"], bands: ["race"], tracks: [{ version: 3, family: "oval", min: 1600, max: 3200 }, { version: 3, family: "hybrid", min: 3200, max: 5200 }] },
};
export interface ExplorationRecipe {
  version: 1;
  catalog: 1;
  category: Category;
  seed: string;
  attempt: number;
  car: CarRecipe;
  track: GenerationRecipe;
  venue: VenueSettings;
}
export function randomCategory(random = Math.random): Category {
  return CATEGORIES[Math.min(CATEGORIES.length - 1, Math.floor(random() * CATEGORIES.length))];
}
export function explorationRecipe(category: Category, seed: string, attempt = 0): ExplorationRecipe {
  if (!CATEGORIES.includes(category) || !seed.trim() || seed.length > 64 || !Number.isInteger(attempt) || attempt < 0 || attempt > 2)
    throw new Error("Invalid exploration category, seed or attempt.");
  const stream = (name: string) => hashSeed(`${seed}:${attempt}:${name}`).toString(16);
  const cr = seededRandom(hashSeed(stream("car"))), tr = seededRandom(hashSeed(stream("track")));
  const pick = <T>(list: readonly T[], rng: () => number) => list[Math.floor(rng() * list.length)];
  const preset = CATEGORY_PRESETS[category], family = pick(preset.cars, cr), track = pick(preset.tracks, tr);
  const targetLength = track.min + Math.floor(tr() * ((track.max - track.min) / 100 + 1)) * 100;
  const recipe = normalizeRecipe({ ...(track.version === 2 ? DEFAULT_DESIGN_RECIPE : DEFAULT_FAMILY_RECIPE),
    version: track.version, family: track.family, seed: stream("track-geometry"), targetLength,
    relief: category === "formula" ? "gentle" : pick(["gentle", "rolling"] as const, tr),
    character: category === "club" ? pick(["mixed", "technical"] as const, tr) : "mixed",
    envelope: "comfortable", endurance: category === "endurance" || track.family === "endurance",
  } as GenerationRecipe);
  return { version: 1, catalog: 1, category, seed, attempt,
    car: { ...DEFAULT_CAR_RECIPE, family, band: pick(preset.bands, cr), layout: pick(ARCHETYPES[family].layouts, cr),
      seed: stream("car"), mechanicsSeed: stream("mechanics"), proportionsSeed: stream("proportions"), appearanceSeed: stream("appearance") },
    track: recipe, venue: { ...DEFAULT_VENUE, theme: category === "club" ? "club" : "traditional", kerb: "low", scenerySeed: stream("scenery") } };
}
