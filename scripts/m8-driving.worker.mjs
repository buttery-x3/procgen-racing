import { parentPort } from "node:worker_threads";
import { createServer } from "vite";
import { writeFile } from "node:fs/promises";
const server = await createServer({
  server: { middlewareMode: true, ws: false, watch: null },
  appType: "custom",
  logLevel: "error",
});
const modules = await Promise.all(
  [
    "/src/physics/SuspensionRig.ts",
    "/src/track/testCircuit.ts",
    "/src/track/venue/constructVenue.ts",
    "/src/track/SurfaceCompiler.ts",
    "/src/track/families/types.ts",
    "/src/track/venue/types.ts",
    "/src/vehicle/referenceCars.ts",
    "/src/vehicle/generateCar.ts",
    "/src/race/RaceSession.ts",
    "/src/race/identity.ts",
    "/src/diagnostics/ReferenceDriver.ts",
    "/src/storage/SoloStorage.ts",
    "/src/race/Ghost.ts",
  ].map((p) => server.ssrLoadModule(p)),
);
const [
  { initializePhysics, SuspensionRig },
  { getTestCircuit },
  { generateVenueCircuit },
  { hydrateCircuit },
  { DEFAULT_FAMILY_RECIPE },
  { DEFAULT_VENUE },
  { REFERENCE_CARS },
  { generateCar, ARCHETYPES, DEFAULT_CAR_RECIPE },
  { RaceSession },
  { sessionIdentity, PHYSICS_VERSION },
  { referenceControls },
  { mergeLap, exportSession, decodeSession },
  { GhostPlayer },
] = modules;
await initializePhysics();
parentPort.on("message", async (job) => {
  if (job.close) {
    await server.close();
    parentPort.close();
    return;
  }
  const started = performance.now();
  let rig;
  try {
    const recipe = job.family
      ? {
          ...DEFAULT_FAMILY_RECIPE,
          seed: "m8-driving-101",
          family: job.family,
          targetLength: job.length,
          relief: "rolling",
          banking: "fast",
          endurance: job.family === "endurance",
        }
      : undefined;
    const c = recipe
      ? hydrateCircuit(generateVenueCircuit(recipe, DEFAULT_VENUE).circuit)
      : getTestCircuit();
    const setup = job.carFamily
      ? generateCar({
          ...DEFAULT_CAR_RECIPE,
          seed: "m8-car-101",
          family: job.carFamily,
          layout: ARCHETYPES[job.carFamily].layouts[0],
        }).setup
      : REFERENCE_CARS[job.car ?? "fr"].setup;
    rig = new SuspensionRig(setup);
    rig.setCircuit(c);
    for (let i = 0; i < 360; i++) rig.step();
    const laps = [],
      identity = sessionIdentity(c, setup),
      session = new RaceSession(c, identity, (l) => laps.push(l));
    session.restart("time-trial", rig.telemetry);
    const cap = job.cap ?? (job.carFamily ? 14 : 18),
      lat = (s) => {
        if (!job.lane) return 0;
        const r = c.alignment.sample(s),
          o = r.oval;
        if (!o) return 0;
        const f = job.lane === "low" ? 0.58 : job.lane === "high" ? -0.58 : 0;
        const blend = Math.max(
          0,
          Math.min(1, (Math.min(r.station, c.length - r.station) - 150) / 100),
        );
        return (
          f *
          o.inside *
          (f * o.inside > 0 ? r.leftWidth : r.rightWidth) *
          o.blend *
          blend *
          blend *
          (3 - 2 * blend)
        );
      };
    let steps = 0,
      contacts = 0,
      peakError = 0,
      peakSurface = 0;
    while (
      laps.length === 0 &&
      steps < Math.ceil((c.length / Math.max(10, cap) + 300) * 120)
    ) {
      rig.step(referenceControls(rig.telemetry, setup, c, cap, lat));
      session.step(rig.telemetry);
      steps++;
      if (rig.telemetry.groundedCount === 4) contacts++;
      peakError = Math.max(
        peakError,
        Math.abs(
          rig.telemetry.track.lateral - lat(rig.telemetry.track.station),
        ),
      );
      peakSurface = Math.max(
        peakSurface,
        rig.streamingStats?.surfaceChunks ?? 0,
      );
      if (peakError > 10) break;
    }
    const completed = laps[0];
    if (!completed?.result.valid || !completed.ghost)
      throw new Error(
        `No valid timed lap: ${JSON.stringify(completed?.result ?? session.snapshot())}`,
      );
    const saved = mergeLap(
        undefined,
        completed,
        c.definition.name,
        setup.vehicle?.name ?? job.car ?? "fr",
      ),
      raw = exportSession(saved, completed.ghost),
      restored = decodeSession(raw, identity),
      player = new GhostPlayer(restored.ghost);
    if (job.exportReference)
      await writeFile("artifacts/m8/reference-session.json", raw);
    for (const part of [0, 0.1, 0.25, 0.5, 0.75, 0.99, 1]) {
      const pose = player.sample(restored.ghost.duration * part);
      if (
        !pose ||
        !Number.isFinite(pose.position.y) ||
        Math.abs(pose.rotation.length() - 1) > 1e-5
      )
        throw new Error("Ghost playback is incomplete or non-finite.");
    }
    parentPort.postMessage({
      ...job,
      ok: true,
      physicsVersion: PHYSICS_VERSION,
      recipe,
      identity,
      result: completed.result,
      ghost: {
        samples: completed.ghost.samples.length / 24,
        bytes: completed.ghost.samples.byteLength,
        archiveBytes: new TextEncoder().encode(raw).byteLength,
        roundTrip: true,
      },
      recordingBytes: session.recordingBytes,
      steps,
      fourContactFraction: contacts / steps,
      maxLineError: peakError,
      peakSurfaceChunks: peakSurface,
      ms: performance.now() - started,
    });
  } catch (error) {
    parentPort.postMessage({
      ...job,
      ok: false,
      error: String(error.stack ?? error),
      ms: performance.now() - started,
    });
  } finally {
    rig?.dispose();
  }
});
parentPort.postMessage({ ready: true });
