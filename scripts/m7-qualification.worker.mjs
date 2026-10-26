import { parentPort } from "node:worker_threads";
import { createServer } from "vite";
const server = await createServer({
  server: { middlewareMode: true, ws: false, watch: null },
  appType: "custom",
  logLevel: "error",
});
const { designFamilyCircuit } = await server.ssrLoadModule(
  "/src/track/families/generateFamilyCircuit.ts",
);
const { generateVenueCircuit } = await server.ssrLoadModule(
  "/src/track/venue/constructVenue.ts",
);
const { hydrateCircuit } = await server.ssrLoadModule(
  "/src/track/SurfaceCompiler.ts",
);
const { hashSeed } = await server.ssrLoadModule("/src/track/Terrain.ts");
const { circuitArchive, decodeCircuitArchive } = await server.ssrLoadModule(
  "/src/storage/CircuitStorage.ts",
);
parentPort.on("message", async (job) => {
  if (job.close) {
    await server.close();
    parentPort.close();
    return;
  }
  const start = performance.now();
  try {
    const r =
        job.phase === "planning"
          ? designFamilyCircuit(job.recipe, { reference: false })
          : generateVenueCircuit(job.recipe, job.settings),
      definition =
        job.phase === "planning" ? r.definition : r.circuit.definition;
    const record = {
      ...job,
      ok: true,
      ms: performance.now() - start,
      metrics: r.report.metrics,
      provenance: r.family,
      definitionHash: hashSeed(JSON.stringify(definition)).toString(16),
    };
    if (job.phase === "construction") {
      const circuit = hydrateCircuit(r.circuit);
      let maxQueries = 0;
      for (let s = 0; s < circuit.length; s += 41) {
        const row = circuit.alignment.sample(s),
          loc = circuit.locate({ ...row.position, y: 0 });
        const delta = Math.abs(loc.station - s);
        if (Math.min(delta, circuit.length - delta) > 1.1)
          throw new Error(`Incorrect nearby-leg localization at ${s} m`);
        maxQueries = Math.max(
          maxQueries,
          circuit.queryStats?.maxCandidates ?? 0,
        );
      }
      let bad = 0,
        down = 0,
        minArea = Infinity;
      const materials = new Set();
      for (const c of circuit.chunks) {
        if (
          c.surfaces.length !== c.indices.length / 3 ||
          c.colors.length !== c.surfaces.length
        )
          throw new Error("Incomplete shared triangle material data.");
        for (const v of c.vertices) if (!Number.isFinite(v)) bad++;
        for (let i = 0; i < c.indices.length; i += 3) {
          const a = c.indices[i] * 3,
            b = c.indices[i + 1] * 3,
            d = c.indices[i + 2] * 3,
            v = c.vertices,
            area =
              (v[b + 2] - v[a + 2]) * (v[d] - v[a]) -
              (v[b] - v[a]) * (v[d + 2] - v[a + 2]);
          minArea = Math.min(minArea, Math.abs(area));
          if (area < -1e-6) down++;
          materials.add(c.surfaces[i / 3]);
        }
      }
      if (bad || down || minArea < 1e-10)
        throw new Error(
          `Shared mesh has ${bad} nonfinite, ${down} reversed, minimum area ${minArea}.`,
        );
      const archive = circuitArchive(r),
        decoded = decodeCircuitArchive(JSON.stringify(archive));
      if (decoded.definitionHash !== archive.definitionHash)
        throw new Error("Archive checksum roundtrip failed.");
      Object.assign(record, {
        fingerprint: r.fingerprint,
        triangles: circuit.triangleCount,
        chunks: circuit.chunks.length,
        bytes: r.family.transferBytes,
        props: definition.venue.props.length,
        pits: !!definition.venue.pit,
        maxQueryCandidates: maxQueries,
        minArea,
        materials: [...materials],
        archiveBytes: JSON.stringify(archive).length,
        classes: r.design.referenceLines.map((l) => ({
          vehicle: l.vehicle,
          lane: l.lane,
          lapSeconds:
            (circuit.length / l.points.length) *
            l.points.reduce((s, p) => s + 1 / p.speed, 0),
          peakSpeed: Math.max(...l.points.map((p) => p.speed)),
        })),
      });
    }
    parentPort.postMessage(record);
  } catch (error) {
    parentPort.postMessage({
      ...job,
      ok: false,
      ms: performance.now() - start,
      error: String(error.message ?? error),
    });
  }
});
parentPort.postMessage({ ready: true });
