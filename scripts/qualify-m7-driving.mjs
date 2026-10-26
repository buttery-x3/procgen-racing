import { Worker } from "node:worker_threads";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
const families = {
    street: 3600,
    rural: 7200,
    mountain: 5400,
    airfield: 4200,
    oval: 4400,
    hybrid: 4400,
    endurance: 24000,
  },
  jobs = Object.entries(families).map(([family, targetLength]) => ({
    recipe: {
      version: 3,
      seed: "m7-driving-101",
      family,
      targetLength,
      relief: "rolling",
      character: "mixed",
      envelope: family === "mountain" ? "terrain" : "comfortable",
      layout: 0,
      variant: "full",
      oval: family === "oval" ? "asymmetric" : "oval",
      banking: "fast",
      endurance: family === "endurance",
    },
  })),
  records = [];
const hash = createHash("sha256");
for (const f of (await readdir("src", { recursive: true }))
  .filter((f) => /\.(ts|css)$/.test(f))
  .sort())
  hash.update(await readFile(`src/${f}`));
hash.update(await readFile("package-lock.json"));
const sourceHash = hash.digest("hex").slice(0, 16),
  start = performance.now();
let next = 0;
await mkdir("artifacts/m7", { recursive: true });
await Promise.all(
  Array.from(
    { length: 3 },
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL("./m7-driving.worker.mjs", import.meta.url),
          ),
          send = () => {
            if (next < jobs.length) worker.postMessage(jobs[next++]);
            else {
              worker.postMessage({ close: true });
              resolve();
            }
          };
        worker.on("error", reject);
        worker.on("message", (r) => {
          if (r.ready) {
            send();
            return;
          }
          records.push(r);
          console.log(JSON.stringify(r));
          send();
        });
      }),
  ),
);
const report = {
  sourceHash,
  workers: 3,
  cpu: os.cpus()[0]?.model,
  node: process.version,
  elapsedSeconds: (performance.now() - start) / 1000,
  scope:
    "Four FF/FR/MR/AWD reference cars complete conservative centreline laps on all seven families, including a 24 km endurance circuit. A procedural FR stock car also completes low/middle/high oval lanes. Pure pursuit, 120 Hz; capped speeds in each record are not maximum-performance lap claims.",
  attempted: records.flatMap((r) => r.results).length,
  passed: records.flatMap((r) => r.results).filter((r) => r.pass).length,
  failed: records.flatMap((r) => r.results).filter((r) => !r.pass).length,
  records,
};
await writeFile("artifacts/m7/driving.json", JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    sourceHash,
    attempted: report.attempted,
    passed: report.passed,
    failed: report.failed,
    elapsedSeconds: report.elapsedSeconds,
  }),
);
if (records.some((r) => !r.ok)) process.exitCode = 1;
