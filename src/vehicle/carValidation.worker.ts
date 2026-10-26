/// <reference lib="webworker" />
import { validateCarPhysics } from "./validateCarPhysics";
import type { VehicleSetup } from "./types";
self.onmessage = async (
  e: MessageEvent<{ id: number; setup: VehicleSetup }>,
) => {
  try {
    self.postMessage({
      id: e.data.id,
      result: await validateCarPhysics(e.data.setup),
    });
  } catch (error) {
    self.postMessage({
      id: e.data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
