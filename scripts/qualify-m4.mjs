import { Worker } from "node:worker_threads";
import os from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ??
  fallback;
const count = Number(arg("count", "1000")),
  workers = Number(
    arg("workers", String(Math.min(8, os.availableParallelism()))),
  ),
  compile = arg("compile", "all");
const presets = [
  ["touring", "gentle"],
  ["touring", "rolling"],
  ["gp", "gentle"],
  ["gp", "rolling"],
];
const jobs = [];
for (const [family, relief] of presets)
  for (let i = 0; i < count; i++) {
    const length =
      family === "gp" ? [4000, 5200, 7500][i % 3] : [2000, 3200, 4500][i % 3];
    jobs.push({
      id: jobs.length,
      recipe: {
        version: 2,
        seed: `qualification-${i}`,
        family,
        relief,
        targetLength: length,
        character: ["mixed", "flowing", "technical"][Math.floor(i / 3) % 3],
        envelope: i % 10 === 9 ? "terrain" : "comfortable",
        layout: i % 3,
      },
      compile: compile === "all" || (compile === "sample" && i % 50 === 0),
      portfolio: i < 8,
    });
  }
const files = [
  "package-lock.json",
  "src/track/generationTypes.ts",
  "src/track/types.ts",
  "src/track/Terrain.ts",
  "src/track/design/ReferenceLines.ts",
  "src/track/design/primitives.ts",
  "src/track/generateDesignedCircuit.ts",
  "src/track/design/LayoutProposal.ts",
  "src/track/design/RoadProfiles.ts",
  "src/track/design/SiteGraph.ts",
  "src/track/SurfaceCompiler.ts",
  "src/track/TerrainMesh.ts",
  "src/track/improveTerrain.ts",
  "src/track/validateCircuit.ts",
  "src/track/Alignment.ts",
];
const hash = createHash("sha256");
for (const file of files) hash.update(await readFile(file));
const codeHash = hash.digest("hex").slice(0, 16);
const records = [];
let next = 0,
  done = 0;
const start = performance.now();
await mkdir("artifacts/m4-v2", { recursive: true });
console.log(
  JSON.stringify({
    phase: "start",
    count: jobs.length,
    workers,
    compile,
    codeHash,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.availableParallelism(),
    memoryGiB: Math.round(os.totalmem() / 2 ** 30),
  }),
);
await Promise.all(
  Array.from(
    { length: workers },
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker(
          new URL("./m4-qualification.worker.mjs", import.meta.url),
        );
        const send = () => {
          if (next < jobs.length) worker.postMessage(jobs[next++]);
          else {
            worker.postMessage({ close: true });
            resolve();
          }
        };
        worker.on("error", reject);
        worker.on("message", async (result) => {
          if (result.ready) {
            send();
            return;
          }
          records.push(result);
          done++;
          if (done % 25 === 0) {
            console.log(
              JSON.stringify({
                done,
                total: jobs.length,
                fail: records.filter((r) => !r.ok).length,
                fallback: records.filter((r) => r.ok && r.fallback).length,
                elapsedS: Math.round((performance.now() - start) / 1000),
              }),
            );
            await writeFile(
              "artifacts/m4-v2/checkpoint.json",
              JSON.stringify({ codeHash, records }),
            );
          }
          send();
        });
      }),
  ),
);
records.sort((a, b) => a.id - b.id);
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * p))
  ];
const summary = {
  codeHash,
  compile,
  cpu: os.cpus()[0]?.model,
  logicalCpus: os.availableParallelism(),
  memoryGiB: Math.round(os.totalmem() / 2 ** 30),
  elapsedSeconds: (performance.now() - start) / 1000,
  presets: presets.map(([family, relief]) => {
    const rs = records.filter(
        (r) => r.recipe.family === family && r.recipe.relief === relief,
      ),
      success = rs.filter((r) => r.ok),
      native = success.filter((r) => !r.fallback);
    const range = (f) => [
      Math.min(...success.map(f)),
      Math.max(...success.map(f)),
    ];
    return {
      family,
      relief,
      attempted: rs.length,
      native: native.length,
      fallback: success.length - native.length,
      failed: rs.length - success.length,
      nativeRate: native.length / rs.length,
      compiled: success.filter((r) => r.compiled).length,
      timeMs: {
        p50: percentile(
          rs.map((r) => r.ms),
          0.5,
        ),
        p95: percentile(
          rs.map((r) => r.ms),
          0.95,
        ),
        max: Math.max(...rs.map((r) => r.ms)),
      },
      hull: range((r) => r.design.hull),
      directionChanges: range((r) => r.design.changes),
      longStraights: range((r) => r.design.straights),
      elevationRange: range((r) => r.metrics.elevationRange),
      retainedRelief: range((r) => r.design.retained),
      modes: [...new Set(native.map((r) => r.design.mode))],
    };
  }),
};
await writeFile(
  "artifacts/m4-v2/qualification.json",
  JSON.stringify({ summary, records }, null, 2),
);
await writeFile(
  "artifacts/m4-v2/summary.json",
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary));
if (summary.presets.some((p) => p.nativeRate < 0.99 || p.failed))
  process.exitCode = 1;
