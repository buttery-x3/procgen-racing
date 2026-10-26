import { Worker } from "node:worker_threads";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
const arg = (key, fallback) =>
  Number(
    process.argv.find((a) => a.startsWith(`--${key}=`))?.split("=")[1] ??
      fallback,
  );
const count = arg("count", 128),
  workers = arg("workers", 4),
  themes = ["club", "traditional", "modern", "desert"],
  jobs = [];
for (let i = 0; i < count; i++) {
  const family = i % 2 ? "gp" : "touring";
  jobs.push({
    id: i,
    recipe: {
      version: 2,
      seed: `m5-${i}`,
      family,
      relief: Math.floor(i / 8) % 2 ? "rolling" : "gentle",
      targetLength: (family === "gp" ? [4000, 5200, 7500] : [2000, 3200, 4500])[
        i % 3
      ],
      character: ["mixed", "flowing", "technical"][Math.floor(i / 3) % 3],
      envelope: i % 9 === 8 ? "terrain" : "comfortable",
      layout: Math.floor(i / 5) % 3,
    },
    settings: {
      version: 1,
      enabled: true,
      theme: themes[Math.floor(i / 2) % 4],
      kerb: Math.floor(i / 16) % 2 ? "raised" : "low",
      pits: i % 11 !== 10,
      scenery: i % 17 === 0 ? "dense" : "standard",
      scenerySeed: `foliage-${i}`,
    },
  });
}
const hash = createHash("sha256");
for (const file of (await readdir("src", { recursive: true }))
  .filter((f) => /\.(ts|css)$/.test(f))
  .sort())
  hash.update(await readFile(`src/${file}`));
hash.update(await readFile("package-lock.json"));
const sourceHash = hash.digest("hex").slice(0, 16),
  records = [];
let next = 0;
const start = performance.now();
await mkdir("artifacts/m5", { recursive: true });
console.log(JSON.stringify({ phase: "start", count, workers, sourceHash }));
await Promise.all(
  Array.from(
    { length: workers },
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker(
          new URL("./m5-qualification.worker.mjs", import.meta.url),
        );
        const send = () => {
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
          if (records.length % 8 === 0 || !r.ok)
            console.log(
              JSON.stringify({
                done: records.length,
                total: count,
                fail: records.filter((r) => !r.ok).length,
                ...(!r.ok ? { failedRecipe: r.recipe, error: r.error } : {}),
              }),
            );
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
  sourceHash,
  cpu: os.cpus()[0]?.model,
  memoryGiB: Math.round(os.totalmem() / 2 ** 30),
  elapsedSeconds: (performance.now() - start) / 1000,
  attempted: records.length,
  passed: records.filter((r) => r.ok).length,
  failed: records.filter((r) => !r.ok).length,
  baseFallbacks: records.filter((r) => r.fallback).length,
  themes: themes.map((theme) => {
    const a = records.filter((r) => r.settings.theme === theme),
      good = a.filter((r) => r.ok);
    return {
      theme,
      attempted: a.length,
      passed: good.length,
      failed: a.length - good.length,
      timeMs: {
        p50: percentile(
          a.map((r) => r.ms),
          0.5,
        ),
        p95: percentile(
          a.map((r) => r.ms),
          0.95,
        ),
        max: Math.max(...a.map((r) => r.ms)),
      },
      largestMesh: Math.max(...good.map((r) => r.triangles)),
      mostProps: Math.max(...good.map((r) => r.props)),
      maxRunoff: Math.max(...good.map((r) => r.report.maxRunoff)),
    };
  }),
};
await writeFile(
  "artifacts/m5/qualification.json",
  JSON.stringify({ summary, records }, null, 2),
);
console.log(JSON.stringify(summary));
if (summary.failed) process.exitCode = 1;
