/// <reference lib="webworker" />
import { runSetupTest } from "./runComparison";
import type { ComparisonScenario } from "./runComparison";
import type { VehicleSetup } from "../vehicle/types";
self.onmessage = async (
  event: MessageEvent<{
    a: VehicleSetup;
    b: VehicleSetup;
    nameA: string;
    nameB: string;
    scenario: ComparisonScenario;
  }>,
) => {
  const { a, b, nameA, nameB, scenario } = event.data;
  try {
    const runA = await runSetupTest(a, scenario, nameA, (p) =>
      self.postMessage({
        type: "progress",
        value: p * 0.5,
        label: "Running A",
      }),
    );
    const runB = await runSetupTest(b, scenario, nameB, (p) =>
      self.postMessage({
        type: "progress",
        value: 0.5 + p * 0.5,
        label: "Running B",
      }),
    );
    self.postMessage({ type: "result", runs: [runA, runB] });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
