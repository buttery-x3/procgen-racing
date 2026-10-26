import { Worker } from "node:worker_threads";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
const arg = (name, fallback) =>
    Number(
      process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ??
        fallback,
    ),
  count = arg("count", 1000),
  construction = arg("construction", 32),
  workers = arg("workers", 4);
const presets = {
  street: [2200, 3600, 6000],
  rural: [4000, 7200, 14000],
  mountain: [3500, 5400, 7500],
  airfield: [2800, 4200, 7000],
  oval: [800, 2400, 4400],
  hybrid: [2800, 4400, 6800],
  endurance: [8000, 12000, 24000],
};
const jobs = [];
for (const phase of ["planning", "construction"])
  for (const [family, lengths] of Object.entries(presets))
    for (let i = 0; i < (phase === "planning" ? count : construction); i++) {
      const recipe = {
        version: 3,
        seed: `m7-${i}`,
        family,
        relief: Math.floor(i / 3) % 2 ? "rolling" : "gentle",
        targetLength: lengths[i % 3],
        character: ["mixed", "flowing", "technical"][Math.floor(i / 2) % 3],
        envelope: i % 5 === 4 ? "terrain" : "comfortable",
        layout: Math.floor(i / 7) % 3,
        variant:
          family === "hybrid" && i % 11 === 10
            ? "speedway"
            : family !== "oval" && i % 7 === 6
              ? "club"
              : "full",
        oval: ["oval", "tri-oval", "asymmetric"][Math.floor(i / 3) % 3],
        banking: i % 2 ? "fast" : "mild",
        endurance: family === "endurance" || i % 9 === 8,
      };
      jobs.push({
        id: jobs.length,
        phase,
        recipe,
        ...(phase === "construction"
          ? {
              settings: {
                version: 1,
                enabled: true,
                theme: ["club", "traditional", "modern", "desert"][i % 4],
                kerb: i % 2 ? "raised" : "low",
                pits: i % 8 !== 7,
                scenery: i % 10 === 0 ? "dense" : "standard",
                scenerySeed: `m7-scenery-${i}`,
              },
            }
          : {}),
      });
    }
const hash = createHash("sha256");
for (const f of (await readdir("src", { recursive: true }))
  .filter((f) => /\.(ts|css)$/.test(f))
  .sort())
  hash.update(await readFile(`src/${f}`));
hash.update(await readFile("package-lock.json"));
const sourceHash = hash.digest("hex").slice(0, 16),
  records = [],
  start = performance.now();
let next = 0;
await mkdir("artifacts/m7", { recursive: true });
console.log(
  JSON.stringify({
    phase: "start",
    sourceHash,
    planningPerFamily: count,
    constructionPerFamily: construction,
    workers,
  }),
);
await Promise.all(
  Array.from(
    { length: workers },
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL("./m7-qualification.worker.mjs", import.meta.url),
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
          if (records.length % 100 === 0 || !r.ok)
            console.log(
              JSON.stringify({
                done: records.length,
                total: jobs.length,
                failed: records.filter((r) => !r.ok).length,
                ...(!r.ok ? { recipe: r.recipe, error: r.error } : {}),
              }),
            );
          send();
        });
      }),
  ),
);
records.sort((a, b) => a.id - b.id);
const summary = {
  sourceHash,
  workers,
  cpu: os.cpus()[0]?.model,
  memoryGiB: Math.round(os.totalmem() / 2 ** 30),
  node: process.version,
  elapsedSeconds: (performance.now() - start) / 1000,
  planningPerFamily: count,
  constructionPerFamily: construction,
  attempted: records.length,
  passed: records.filter((r) => r.ok).length,
  failed: records.filter((r) => !r.ok).length,
  families: Object.keys(presets).map((family) => ({
    family,
    phases: ["planning", "construction"].map((phase) => {
      const a = records.filter(
          (r) => r.recipe.family === family && r.phase === phase,
        ),
        good = a.filter((r) => r.ok),
        times = good.map((r) => r.ms).sort((a, b) => a - b);
      return {
        phase,
        attempted: a.length,
        passed: good.length,
        failed: a.length - good.length,
        p50Ms: times[Math.floor(times.length * 0.5)],
        p95Ms: times[Math.floor(times.length * 0.95)],
        maxMs: Math.max(...times),
        ...(phase === "construction"
          ? {
              maxTriangles: Math.max(...good.map((r) => r.triangles)),
              maxBytes: Math.max(...good.map((r) => r.bytes)),
              maxQueryCandidates: Math.max(
                ...good.map((r) => r.maxQueryCandidates),
              ),
              maxArchiveBytes: Math.max(...good.map((r) => r.archiveBytes)),
            }
          : {}),
      };
    }),
  })),
};
await writeFile(
  "artifacts/m7/qualification.json",
  JSON.stringify({ summary, records }, null, 2),
);
console.log(JSON.stringify(summary));
if (summary.failed) process.exitCode = 1;
