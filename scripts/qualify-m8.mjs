import { Worker } from "node:worker_threads";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import { physicsVersion } from "./physics-version.mjs";
const hash = createHash("sha256");
for (const f of (await readdir("src", { recursive: true }))
  .filter((f) => /\.(ts|css)$/.test(f))
  .sort())
  hash.update(await readFile(`src/${f}`));
hash.update(await readFile("package-lock.json"));
const sourceHash = hash.digest("hex").slice(0, 16),
  start = performance.now();
const jobs = [
  ...Object.entries({
    street: 3600,
    rural: 7200,
    mountain: 5400,
    airfield: 4200,
    oval: 2400,
    hybrid: 4400,
    endurance: 24000,
  }).map(([family, length]) => ({ family, length, car: "fr", cap: 18 })),
  ...["ff", "fr", "mr", "awd"].map((car) => ({ car, cap: 14 })),
  ...[
    "hatch",
    "coupe",
    "sedan",
    "sports",
    "hypercar",
    "rear-coupe",
    "awd",
    "gt",
    "prototype",
    "open-wheel",
    "stock",
  ].map((carFamily) => ({ carFamily, cap: 14 })),
  ...["low", "middle", "high"].map((lane) => ({
    family: "oval",
    length: 4400,
    carFamily: "stock",
    cap: 30,
    lane,
  })),
].map((job, id) => ({ ...job, id }));
const records = [];
let next = 0;
if (process.argv.includes("--quick"))
  jobs.splice(
    0,
    jobs.length,
    ...jobs.filter((j) => !j.family || j.family === "oval"),
  );
await mkdir("artifacts/m8", { recursive: true });
console.log(
  JSON.stringify({
    sourceHash,
    physicsVersion: physicsVersion(),
    attempted: jobs.length,
  }),
);
await Promise.all(
  Array.from(
    { length: 3 },
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker(
          new URL("./m8-driving.worker.mjs", import.meta.url),
        );
        const send = () => {
          if (next < jobs.length) worker.postMessage(jobs[next++]);
          else {
            worker.postMessage({ close: true });
            resolve();
          }
        };
        worker.on("error", reject);
        worker.on("message", (result) => {
          if (result.ready) {
            send();
            return;
          }
          records.push(result);
          console.log(
            JSON.stringify({
              done: records.length,
              total: jobs.length,
              ...result,
            }),
          );
          send();
        });
      }),
  ),
);
const report = {
  version: 1,
  sourceHash,
  physicsVersion: physicsVersion(),
  date: new Date().toISOString(),
  cpu: os.cpus()[0]?.model,
  memoryGiB: Math.round(os.totalmem() / 2 ** 30),
  workers: 3,
  elapsedSeconds: (performance.now() - start) / 1000,
  scope:
    "25 real 120 Hz four-wheel timed laps: FR on all seven expanded circuit families (including 24 km), four references and all eleven procedural archetypes on the authored proving circuit, plus stock low/middle/high oval lanes. Each lap must pass production gate order and tyre-centre limits, create a keyed PB/ghost and round-trip its poses and controls. Conservative caps, not maximum-speed or every car/track combination certification. Generation itself is unchanged; M7/M6 campaign reports remain historical evidence.",
  attempted: records.length,
  passed: records.filter((r) => r.ok).length,
  failed: records.filter((r) => !r.ok).length,
  records: records.sort((a, b) => a.id - b.id),
};
await writeFile(
  "artifacts/m8/qualification.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    sourceHash,
    attempted: report.attempted,
    passed: report.passed,
    failed: report.failed,
    elapsedSeconds: report.elapsedSeconds,
  }),
);
if (report.failed) process.exitCode = 1;
