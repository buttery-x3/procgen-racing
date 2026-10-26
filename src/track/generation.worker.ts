import { generateCircuit } from "./generateCircuit";
import type { GenerationRecipe } from "./generationTypes";
import type { VenueGenerationRequest } from "./GenerationClient";
import {
  constructVenue,
  restyleScenery,
  venueGeometrySettings,
} from "./venue/constructVenue";

self.onmessage = (
  event: MessageEvent<GenerationRecipe | VenueGenerationRequest>,
) => {
  try {
    const request = "recipe" in event.data ? event.data : undefined,
      recipe = request?.recipe ?? (event.data as GenerationRecipe);
    const progress = (value: import("./generationTypes").GenerationProgress) =>
      self.postMessage({ type: "progress", value });
    const cached = request?.cached,
      previous = cached?.circuit.definition.venue;
    const sceneryOnly = !!(
      request &&
      cached &&
      previous &&
      JSON.stringify(cached.recipe) === JSON.stringify(recipe) &&
      JSON.stringify(venueGeometrySettings(previous.settings)) ===
        JSON.stringify(venueGeometrySettings(request.venue))
    );
    const base = sceneryOnly
      ? cached!
      : generateCircuit(recipe, {
          progress: (value) =>
            progress(
              request?.venue.enabled
                ? {
                    ...value,
                    fraction: value.fraction * 0.8,
                    stage:
                      value.fraction === 1
                        ? "Road design complete"
                        : value.stage,
                  }
                : value,
            ),
        });
    const result = sceneryOnly
      ? restyleScenery(base, request!.venue)
      : request?.venue
        ? constructVenue(base, request.venue, progress)
        : base;
    const buffers = result.circuit.chunks.flatMap((chunk) => [
      chunk.vertices.buffer,
      chunk.indices.buffer,
      chunk.colors.buffer,
    ]);
    self.postMessage({ type: "ready", result }, { transfer: buffers });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
