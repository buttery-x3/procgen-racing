import { parentPort } from "node:worker_threads";
import { createServer } from "vite";
import { Quaternion, Vector3 } from "three";
const server = await createServer({
  server: { middlewareMode: true, ws: false, watch: null },
  appType: "custom",
  logLevel: "error",
});
const { generateVenueCircuit } = await server.ssrLoadModule(
    "/src/track/venue/constructVenue.ts",
  ),
  { DEFAULT_VENUE } = await server.ssrLoadModule("/src/track/venue/types.ts"),
  { hydrateCircuit } = await server.ssrLoadModule(
    "/src/track/SurfaceCompiler.ts",
  ),
  { smooth } = await server.ssrLoadModule("/src/track/Alignment.ts"),
  { initializePhysics, SuspensionRig } = await server.ssrLoadModule(
    "/src/physics/SuspensionRig.ts",
  ),
  { REFERENCE_CARS } = await server.ssrLoadModule(
    "/src/vehicle/referenceCars.ts",
  ),
  { generateCar, DEFAULT_CAR_RECIPE } = await server.ssrLoadModule(
    "/src/vehicle/generateCar.ts",
  );
await initializePhysics();
parentPort.on("message", async (job) => {
  if (job.close) {
    await server.close();
    parentPort.close();
    return;
  }
  const results = [],
    start = performance.now();
  try {
    const generated = generateVenueCircuit(job.recipe, {
        ...DEFAULT_VENUE,
        theme: "modern",
      }),
      c = hydrateCircuit(generated.circuit),
      cases = [
        ...Object.entries(REFERENCE_CARS).map(([id, car]) => ({
          id,
          setup: car.setup,
          cap: {
            ff: 17,
            fr: 21,
            mr: job.recipe.family === "mountain" ? 18 : 20,
            awd: 21,
          }[id],
          lane: "racing",
        })),
        ...(job.recipe.family === "oval"
          ? ["low", "middle", "high"].map((lane) => ({
              id: "stock",
              setup: generateCar({
                ...DEFAULT_CAR_RECIPE,
                seed: "m7-stock",
                family: "stock",
                layout: "FR",
              }).setup,
              cap: 34,
              lane,
            }))
          : []),
      ];
    for (const item of cases) {
      const rig = new SuspensionRig(item.setup);
      try {
        rig.setCircuit(c);
        for (let i = 0; i < 360; i++) rig.step();
        let previous = rig.telemetry.track.station,
          travel = 0,
          steps = 0,
          contacts = 0,
          load = 0,
          error = 0,
          peakSurface = 0,
          peakObstacle = 0;
        const lat = (s) => {
          const r = c.alignment.sample(s),
            o = r.oval;
          if (!o || item.lane === "racing") return 0;
          const f =
              item.lane === "low" ? 0.58 : item.lane === "high" ? -0.58 : 0,
            width = f * o.inside > 0 ? r.leftWidth : r.rightWidth,
            g = smooth((Math.min(r.station, c.length - r.station) - 150) / 100);
          return f * o.inside * width * o.blend * g;
        };
        for (
          ;
          steps < Math.ceil((c.length / item.cap + 300) * 120) &&
          travel < c.length + 12;
          steps++
        ) {
          const t = rig.telemetry,
            look = 6 + t.speed * 0.4,
            aim = c
              .frame(t.track.station + look, lat(t.track.station + look))
              .position.sub(new Vector3().copy(t.position)),
            q = new Quaternion().copy(t.rotation),
            angle = Math.atan2(
              aim.dot(new Vector3(-1, 0, 0).applyQuaternion(q)),
              aim.dot(new Vector3(0, 0, 1).applyQuaternion(q)),
            ),
            steer =
              (Math.atan2(2 * rig.setup.wheelbase * Math.sin(angle), look) /
                rig.setup.steeringLimit) *
              (1 + (rig.setup.speedSteering * t.speed) / 18),
            k = Math.max(
              ...[0, 12, 30, 60].map((d) =>
                Math.abs(c.alignment.sample(t.track.station + d).curvature),
              ),
            ),
            speed = Math.min(
              item.cap,
              Math.sqrt(
                ((item.id === "mr"
                  ? job.recipe.family === "mountain"
                    ? 0.3
                    : 0.35
                  : 0.5) *
                  9.81) /
                  Math.max(0.0001, k),
              ),
            );
          rig.step({
            steer: Math.max(-1, Math.min(1, steer)),
            throttle: Math.max(0, Math.min(1, (speed - t.speed) * 0.5)),
            brake: Math.max(0, Math.min(1, (t.speed - speed) * 0.4)),
          });
          const nt = rig.telemetry,
            delta = nt.track.station - previous;
          travel += delta < -c.length / 2 ? delta + c.length : delta;
          previous = nt.track.station;
          if (nt.groundedCount === 4) contacts++;
          load = Math.max(load, nt.totalLoad / (rig.setup.mass * 9.81));
          error = Math.max(
            error,
            Math.abs(nt.track.lateral - lat(nt.track.station)),
          );
          peakSurface = Math.max(peakSurface, rig.streamingStats.surfaceChunks);
          peakObstacle = Math.max(
            peakObstacle,
            rig.streamingStats.obstacleChunks,
          );
          if (!Number.isFinite(nt.position.y) || error > 10) break;
        }
        results.push({
          car: item.id,
          lane: item.lane,
          cap: item.cap,
          travelled: travel,
          length: c.length,
          simulationSeconds: steps / 120,
          fourContactFraction: contacts / Math.max(1, steps),
          peakLoad: load,
          maxLineError: error,
          peakSurfaceChunks: peakSurface,
          peakObstacleChunks: peakObstacle,
          streaming: rig.streamingStats,
          pass:
            travel > c.length &&
            error < 2.5 &&
            load < 2.2 &&
            contacts / Math.max(1, steps) > 0.985,
        });
      } finally {
        rig.dispose();
      }
    }
    parentPort.postMessage({
      ...job,
      ok: results.every((r) => r.pass),
      ms: performance.now() - start,
      fingerprint: generated.fingerprint,
      results,
    });
  } catch (error) {
    parentPort.postMessage({
      ...job,
      ok: false,
      error: String(error.message ?? error),
      results,
    });
  }
});
parentPort.postMessage({ ready: true });
