import type {
  GenerationRecipe,
  GenerationResult,
  GenerationProgress,
} from "./generationTypes";
import type { VenueSettings } from "./venue/types";
import type { CircuitArchive } from "../storage/CircuitStorage";

export interface VenueGenerationRequest {
  recipe: GenerationRecipe;
  venue: VenueSettings;
  cached?: GenerationResult;
  archive?: CircuitArchive;
}

export interface GenerationWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(value: GenerationRecipe | VenueGenerationRequest): void;
  terminate(): void;
}

/** One worker per job makes cancellation immediate, even during synchronous mesh
 * compilation. Terminated/stale jobs cannot replace a newer preview. */
export class GenerationClient {
  private pending?: {
    worker: GenerationWorker;
    reject: (reason: Error) => void;
  };
  constructor(
    private factory: () => GenerationWorker = () =>
      new Worker(new URL("./generation.worker.ts", import.meta.url), {
        type: "module",
      }),
  ) {}

  generate(
    recipe: GenerationRecipe,
    progress: (value: GenerationProgress) => void = () => {},
    venue?: VenueSettings,
    cached?: GenerationResult,
    archive?: CircuitArchive,
  ) {
    this.cancel();
    return new Promise<GenerationResult>((resolve, reject) => {
      const worker = this.factory(),
        job = { worker, reject };
      this.pending = job;
      const finish = () => {
        worker.terminate();
        if (this.pending === job) this.pending = undefined;
      };
      worker.onmessage = (event) => {
        if (this.pending !== job) return;
        const data = event.data;
        if (data.type === "progress") progress(data.value);
        else if (data.type === "ready") {
          finish();
          resolve(data.result);
        } else if (data.type === "error") {
          finish();
          reject(new Error(data.message));
        }
      };
      worker.onerror = (event) => {
        if (this.pending !== job) return;
        finish();
        reject(new Error(event.message || "Circuit generation worker failed."));
      };
      try {
        worker.postMessage(venue ? { recipe, venue, cached, archive } : recipe);
      } catch (error) {
        finish();
        reject(error);
      }
    });
  }
  cancel() {
    if (!this.pending) return;
    const { worker, reject } = this.pending;
    this.pending = undefined;
    worker.terminate();
    reject(new DOMException("Circuit generation cancelled.", "AbortError"));
  }
  dispose() {
    this.cancel();
  }
}
