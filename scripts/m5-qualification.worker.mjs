import { parentPort } from "node:worker_threads";
import { createServer } from "vite";
const server = await createServer({
  server: { middlewareMode: true, ws: false, watch: null },
  appType: "custom",
  logLevel: "error",
});
const { generateVenueCircuit } = await server.ssrLoadModule(
  "/src/track/venue/constructVenue.ts",
);
parentPort.on("message", async (job) => {
  if (job.close) {
    await server.close();
    parentPort.close();
    return;
  }
  const start = performance.now();
  try {
    const r = generateVenueCircuit(job.recipe, job.settings),
      v = r.circuit.definition.venue;
    parentPort.postMessage({
      ...job,
      ok: true,
      ms: performance.now() - start,
      baseFingerprint: v.baseFingerprint,
      fingerprint: r.fingerprint,
      triangles: r.circuit.triangleCount,
      props: v.props.length,
      barrierPoints: v.barriers.reduce((s, p) => s + p.points.length, 0),
      pits: !!v.pit,
      report: v.report,
      fallback: r.fallback,
      attempts: r.attempts,
    });
  } catch (e) {
    parentPort.postMessage({
      ...job,
      ok: false,
      ms: performance.now() - start,
      error: String(e.message ?? e),
    });
  }
});
parentPort.postMessage({ ready: true });
