import { createServer } from "vite";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
const hash = createHash("sha256");
for (const f of (await readdir("src", { recursive: true }))
  .filter((f) => /\.(ts|css)$/.test(f))
  .sort())
  hash.update(await readFile(`src/${f}`));
hash.update(await readFile("package-lock.json"));
const sourceHash = hash.digest("hex").slice(0, 16),
  server = await createServer({
    server: { middlewareMode: true, ws: false, watch: null },
    appType: "custom",
    logLevel: "error",
  }),
  rigs = [];
try {
  const { initializePhysics, SuspensionRig } = await server.ssrLoadModule(
      "/src/physics/SuspensionRig.ts",
    ),
    { REFERENCE_CARS } = await server.ssrLoadModule(
      "/src/vehicle/referenceCars.ts",
    ),
    { referenceControls } = await server.ssrLoadModule(
      "/src/diagnostics/ReferenceDriver.ts",
    ),
    { getTestCircuit } = await server.ssrLoadModule(
      "/src/track/testCircuit.ts",
    );
  await initializePhysics();
  const circuit = getTestCircuit();
  for (const id of ["ff", "fr", "awd"]) {
    const rig = new SuspensionRig(REFERENCE_CARS[id].setup);
    rig.setCircuit(circuit);
    rigs.push(rig);
  }
  const times = [];
  for (let frame = 0; frame < 660; frame++) {
    const start = performance.now();
    for (const rig of rigs)
      for (let step = 0; step < 2; step++)
        rig.step(referenceControls(rig.telemetry, rig.setup, circuit, 14));
    if (frame >= 60) times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const report = {
    version: 1,
    sourceHash,
    date: new Date().toISOString(),
    cpu: os.cpus()[0]?.model,
    node: process.version,
    scope:
      "Node CPU-only future-AI stress sample: three independent Rapier worlds/vehicle rigs sharing the authored circuit definition. Ordinary scripted VehicleControls, two 120 Hz steps per measured 60 Hz frame. 60 warm-up frames plus 600 measured frames. No renderer, inter-car contacts or shared-world broad phase; not an AI grid-size or browser FPS promise.",
    cars: 3,
    measuredFrames: 600,
    simulationPerFrameMs: {
      p50: times[300],
      p95: times[570],
      max: times.at(-1),
    },
    finite: rigs.every((r) => Number.isFinite(r.telemetry.position.y)),
  };
  await mkdir("artifacts/m8", { recursive: true });
  await writeFile("artifacts/m8/stress.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  rigs.forEach((r) => r.dispose());
  await server.close();
}
