import { normalizeRecipe } from "./generationTypes";
import type { GenerationRecipe, GenerationProgress } from "./generationTypes";
import { generateLegacyCircuit } from "./generateLegacyCircuit";
import { generateDesignedCircuit } from "./generateDesignedCircuit";

/** Saved v1 recipes keep the exact original generator and surface strategy. */
export function generateCircuit(
  input: GenerationRecipe,
  options: {
    maxAttempts?: number;
    progress?: (value: GenerationProgress) => void;
  } = {},
) {
  const recipe = normalizeRecipe(input);
  return recipe.version === 1
    ? generateLegacyCircuit(recipe, options)
    : generateDesignedCircuit(recipe, options);
}
