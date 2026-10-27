import type { VehicleSetup } from "./types";
import type { CarPhysicsValidation } from "./validateCarPhysics";
import { mechanicsFingerprint } from "./CarDefinition";
import { PHYSICS_VERSION } from "../race/identity";

export interface CarValidationWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(value: unknown): void;
  terminate(): void;
}
/** Same acceptance path for manual construction and category generation. */
export class CarValidationClient {
  private cache = new Map<string, CarPhysicsValidation>();
  private pending?: { worker: CarValidationWorker; reject: (error: Error) => void };
  constructor(private factory: () => CarValidationWorker = () => new Worker(new URL("./carValidation.worker.ts", import.meta.url), { type: "module" })) {}
  validate(setup: VehicleSetup) {
    this.cancel();
    const key = `${PHYSICS_VERSION}:${mechanicsFingerprint(setup)}`;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    return new Promise<CarPhysicsValidation>((resolve, reject) => {
      const worker = this.factory(), job = { worker, reject };
      this.pending = job;
      const finish = () => { worker.terminate(); if (this.pending === job) this.pending = undefined; };
      worker.onmessage = (e) => {
        if (this.pending !== job) return;
        finish();
        if (e.data.error) { reject(new Error(e.data.error)); return; }
        const result = e.data.result as CarPhysicsValidation;
        this.cache.set(key, result);
        while (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
        resolve(result);
      };
      worker.onerror = (e) => { if (this.pending !== job) return; finish(); reject(new Error(e.message || "Car physical validation failed.")); };
      try { worker.postMessage({ id: 1, setup }); } catch (error) { finish(); reject(error); }
    });
  }
  cancel() {
    const job = this.pending;
    if (!job) return;
    this.pending = undefined;
    job.worker.terminate();
    job.reject(new DOMException("Car validation cancelled.", "AbortError"));
  }
  dispose() { this.cancel(); this.cache.clear(); }
}
