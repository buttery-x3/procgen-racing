import { GenerationClient } from "./GenerationClient";
import type { GenerationRecipe, GenerationResult, GenerationProgress } from "./generationTypes";
import type { VenueSettings } from "./venue/types";
import type { CircuitArchive } from "../storage/CircuitStorage";

export function acceptedCircuit(result: GenerationResult) {
  if (!result.report.valid || result.report.checks.some((c) => c.status === "fail"))
    throw new Error("Circuit failed current construction validation.");
  return result;
}
/** A single job owner across previews, archives and exploration. */
export class CircuitPreparation {
  private revision = 0;
  constructor(private client = new GenerationClient()) {}
  cancel() { this.revision++; this.client.cancel(); }
  async prepare(recipe: GenerationRecipe, venue: VenueSettings, progress: (p: GenerationProgress) => void, archive?: CircuitArchive, cached?: GenerationResult) {
    const token = ++this.revision;
    const result = await this.client.generate(recipe, (p) => { if (token === this.revision) progress(p); }, venue, cached, archive);
    if (token !== this.revision) throw new DOMException("Superseded preparation.", "AbortError");
    return acceptedCircuit(result);
  }
  dispose() { this.cancel(); this.client.dispose(); }
}
