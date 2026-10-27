import { CATEGORIES, explorationRecipe } from "./catalog";
import type { ExplorationRecipe } from "./catalog";
import type { VehicleSetup } from "../vehicle/types";
import { generateCar } from "../vehicle/generateCar";
import { mechanicsFingerprint } from "../vehicle/CarDefinition";
import { decodeCircuitArchive } from "../storage/CircuitStorage";
import type { CircuitArchive } from "../storage/CircuitStorage";

export interface ExplorationSelection extends ExplorationRecipe {
  format: "procgen-racing/exploration";
  archive: CircuitArchive;
  factory: VehicleSetup;
  mechanics: string;
  circuitFingerprint: string;
}
const KEY = "procgen-racing:exploration:v1";
export function decodeSelection(raw: string): ExplorationSelection {
  if (raw.length > 8_000_000) throw new Error("Exploration descriptor exceeds 8 MB.");
  const value = JSON.parse(raw) as ExplorationSelection;
  if (value.format !== "procgen-racing/exploration" || value.version !== 1 || value.catalog !== 1 || !CATEGORIES.includes(value.category))
    throw new Error("Unsupported exploration descriptor.");
  const recipe = explorationRecipe(value.category, value.seed, value.attempt);
  if (JSON.stringify(value.car) !== JSON.stringify(recipe.car) || JSON.stringify(value.track) !== JSON.stringify(recipe.track) || JSON.stringify(value.venue) !== JSON.stringify(recipe.venue))
    throw new Error("Exploration recipes do not match their recorded seed/catalog.");
  const factory = generateCar(recipe.car).setup;
  const archive = decodeCircuitArchive(JSON.stringify(value.archive));
  if (mechanicsFingerprint(factory) !== value.mechanics || archive.fingerprint !== value.circuitFingerprint || JSON.stringify(archive.recipe) !== JSON.stringify(recipe.track))
    throw new Error("Exploration fingerprints or archive recipe do not match.");
  return { ...recipe, format: value.format, factory, archive, mechanics: value.mechanics, circuitFingerprint: value.circuitFingerprint };
}
export function loadSelection(): ExplorationSelection | undefined {
  try { const raw = localStorage.getItem(KEY); return raw ? decodeSelection(raw) : undefined; } catch { return undefined; }
}
export function saveSelection(selection: ExplorationSelection) {
  try { localStorage.setItem(KEY, JSON.stringify(selection)); return true; } catch { return false; }
}
