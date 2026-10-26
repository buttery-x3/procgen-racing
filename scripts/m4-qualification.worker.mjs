import { parentPort } from "node:worker_threads";
import { createServer } from "vite";
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  logLevel: "error",
});
const { designCircuit, generateDesignedCircuit } = await server.ssrLoadModule(
  "/src/track/generateDesignedCircuit.ts",
);
const { Alignment } = await server.ssrLoadModule("/src/track/Alignment.ts");
parentPort.on("message", async (job) => {
  if (job.close) {
    await server.close();
    parentPort.close();
    return;
  }
  const start = performance.now();
  try {
    const r = job.compile
      ? generateDesignedCircuit(job.recipe)
      : designCircuit(job.recipe);
    const route = job.portfolio
      ? new Alignment(r.circuit?.definition ?? r.definition)
      : undefined;
    parentPort.postMessage({
      id: job.id,
      recipe: job.recipe,
      ok: true,
      fallback: r.fallback,
      fingerprint: r.fingerprint,
      ms: performance.now() - start,
      metrics: r.report.metrics,
      design: {
        mode: r.design.mode,
        proposals: r.design.proposalCount,
        feasible: r.design.feasibleCount,
        hull: r.design.hullOccupancy,
        changes: r.design.directionChanges,
        straights: r.design.longStraights,
        cutFill: r.design.cutFillRms,
        retained: r.design.retainedRelief,
        closure: r.design.closureShare,
      },
      attempts: r.attempts,
      compiled: !!job.compile,
      triangles: r.circuit?.triangleCount,
      points: route
        ? Array.from({ length: 300 }, (_, i) => {
            const r = route.sample((i * route.length) / 300);
            return { x: r.position.x, z: r.position.z };
          })
        : undefined,
    });
  } catch (error) {
    parentPort.postMessage({
      id: job.id,
      recipe: job.recipe,
      ok: false,
      ms: performance.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
parentPort.postMessage({ ready: true });
