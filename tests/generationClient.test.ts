import { describe, expect, it } from "vitest";
import { GenerationClient } from "../src/track/GenerationClient";
import type { GenerationWorker } from "../src/track/GenerationClient";
import { DEFAULT_RECIPE } from "../src/track/generationTypes";
import type {
  GenerationRecipe,
  GenerationResult,
} from "../src/track/generationTypes";

class WorkerStub implements GenerationWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  recipe?: GenerationRecipe;
  postMessage(recipe: GenerationRecipe) {
    this.recipe = recipe;
  }
  terminate() {
    this.terminated = true;
  }
  send(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}
const ready = {
  recipe: DEFAULT_RECIPE,
  fingerprint: "v1-test",
} as GenerationResult;

describe("generation job lifecycle", () => {
  it("terminates cancelled jobs and ignores late results from an older seed", async () => {
    const workers: WorkerStub[] = [],
      client = new GenerationClient(() => {
        const w = new WorkerStub();
        workers.push(w);
        return w;
      });
    const first = client.generate(DEFAULT_RECIPE),
      firstRejection = expect(first).rejects.toMatchObject({
        name: "AbortError",
      });
    const second = client.generate({ ...DEFAULT_RECIPE, seed: "new-seed" });
    expect(workers[0].terminated).toBe(true);
    workers[0].send({
      type: "ready",
      result: { ...ready, fingerprint: "stale" },
    });
    workers[1].send({ type: "ready", result: ready });
    await firstRejection;
    await expect(second).resolves.toBe(ready);
    expect(workers[1].terminated).toBe(true);
    client.dispose();
  });
  it("reports progress, surfaces worker failures and can start a fresh job afterwards", async () => {
    const workers: WorkerStub[] = [],
      progress: string[] = [],
      client = new GenerationClient(() => {
        const w = new WorkerStub();
        workers.push(w);
        return w;
      });
    const failed = client.generate(DEFAULT_RECIPE, (p) =>
        progress.push(p.stage),
      ),
      rejection = expect(failed).rejects.toThrow("bad geometry");
    workers[0].send({
      type: "progress",
      value: { stage: "Compiling", fraction: 0.8 },
    });
    workers[0].send({ type: "error", message: "bad geometry" });
    await rejection;
    expect(progress).toEqual(["Compiling"]);
    expect(workers[0].terminated).toBe(true);
    const next = client.generate(DEFAULT_RECIPE);
    workers[1].send({ type: "ready", result: ready });
    await expect(next).resolves.toBe(ready);
  });
  it("cancels computation on disposal and releases workers after runtime errors", async () => {
    const worker = new WorkerStub(),
      client = new GenerationClient(() => worker),
      pending = client.generate(DEFAULT_RECIPE),
      rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    client.dispose();
    await rejection;
    expect(worker.terminated).toBe(true);
    const another = new WorkerStub(),
      otherClient = new GenerationClient(() => another),
      failure = otherClient.generate(DEFAULT_RECIPE),
      failureCheck = expect(failure).rejects.toThrow("worker crashed");
    another.onerror?.({ message: "worker crashed" } as ErrorEvent);
    await failureCheck;
    expect(another.terminated).toBe(true);
  });
});
