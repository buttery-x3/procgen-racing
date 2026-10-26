import { generateDesignStudy } from "../track/design/DesignStudy";
import type { DesignBrief } from "../track/design/DesignStudy";
import { generateCircuit } from "../track/generateCircuit";
import { Alignment } from "../track/Alignment";
import { DEFAULT_RECIPE } from "../track/generationTypes";

self.onmessage = (event: MessageEvent<{ seed: string }>) => {
  let index = 0;
  for (const brief of ["club", "grand-prix", "terrain"] as DesignBrief[])
    for (let i = 0; i < 3; i++) {
      const seed = i === 0 ? event.data.seed : `${event.data.seed}-${i + 1}`;
      self.postMessage({ type: "progress", index, seed, brief });
      try {
        const result = generateDesignStudy(seed, brief);
        // An actual v1 result, not a hand-drawn caricature of the old generator.
        const legacy = generateCircuit({
          ...DEFAULT_RECIPE,
          seed,
          family: brief === "club" ? "touring" : "gp",
          targetLength: brief === "club" ? 3200 : 5200,
        });
        const path = new Alignment(legacy.circuit.definition);
        const comparison = {
          length: path.length,
          fingerprint: legacy.fingerprint,
          fallback: legacy.fallback,
          points: Array.from({ length: 300 }, (_, j) => {
            const p = path.sample((j / 300) * path.length).position;
            return { x: p.x, z: p.z };
          }),
        };
        self.postMessage({ type: "result", result, comparison, index });
      } catch (error) {
        self.postMessage({
          type: "failure",
          seed,
          brief,
          index,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      index++;
    }
  self.postMessage({ type: "complete" });
};
