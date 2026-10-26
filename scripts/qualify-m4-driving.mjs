import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";
const { records, summary } = JSON.parse(
  await readFile("artifacts/m4-v2/qualification.json", "utf8"),
);
if (summary.presets.some((p) => p.attempted < 1000))
  throw new Error("Run the full geometry campaign first.");
const good = records.filter((r) => r.ok && !r.fallback),
  selected = [];
for (const family of ["touring", "gp"]) {
  const cases = good.filter((r) => r.recipe.family === family);
  for (const [role, score] of [
    ["tightest", (r) => -r.metrics.minRadius],
    ["steepest", (r) => r.metrics.maxGrade],
    ["largest_relief", (r) => r.metrics.elevationRange],
  ]) {
    const record = [...cases].sort((a, b) => score(b) - score(a))[0];
    selected.push({
      role,
      record,
      car:
        family === "touring"
          ? role === "steepest"
            ? "fr"
            : "ff"
          : role === "steepest"
            ? "awd"
            : "mr",
    });
  }
}
const server = await createServer({
  server: { middlewareMode: true, ws: false, watch: null },
  appType: "custom",
  logLevel: "error",
});
try {
  const { generateCircuit } = await server.ssrLoadModule(
    "/src/track/generateCircuit.ts",
  );
  const { hydrateCircuit } = await server.ssrLoadModule(
    "/src/track/SurfaceCompiler.ts",
  );
  const { initializePhysics, SuspensionRig } = await server.ssrLoadModule(
    "/src/physics/SuspensionRig.ts",
  );
  const { REFERENCE_CARS } = await server.ssrLoadModule(
    "/src/vehicle/referenceCars.ts",
  );
  const { Vector3, Quaternion } = await import("three");
  await initializePhysics();
  const results = [];
  for (const { record, role, car } of selected) {
    const generated = generateCircuit(record.recipe);
    if (generated.fingerprint !== record.fingerprint)
      throw new Error("Qualified recipe fingerprint changed.");
    const circuit = hydrateCircuit(generated.circuit),
      r = new SuspensionRig(REFERENCE_CARS[car].setup),
      cap = { ff: 16, fr: 18, mr: 21, awd: 20 }[car];
    try {
      r.setCircuit(circuit);
      for (let i = 0; i < 360; i++) r.step();
      let previous = r.telemetry.track.station,
        travelled = 0,
        steps = 0,
        contacts = 0,
        maxLateral = 0,
        peakLoad = 0;
      for (
        ;
        steps < Math.ceil((circuit.length / cap + 150) * 120) &&
        travelled < circuit.length + 10;
        steps++
      ) {
        const t = r.telemetry,
          lookahead = 6 + t.speed * 0.4,
          q = new Quaternion().copy(t.rotation),
          aim = circuit
            .frame(t.track.station + lookahead)
            .position.sub(new Vector3().copy(t.position));
        const angle = Math.atan2(
          aim.dot(new Vector3(-1, 0, 0).applyQuaternion(q)),
          aim.dot(new Vector3(0, 0, 1).applyQuaternion(q)),
        );
        const steer =
          (Math.atan2(2 * r.setup.wheelbase * Math.sin(angle), lookahead) /
            r.setup.steeringLimit) *
          (1 + (r.setup.speedSteering * t.speed) / 18);
        const k = Math.max(
            ...[0, 10, 25, 45].map((d) =>
              Math.abs(circuit.alignment.sample(t.track.station + d).curvature),
            ),
          ),
          speed = Math.min(cap, Math.sqrt((0.55 * 9.81) / Math.max(0.0001, k)));
        r.step({
          steer: Math.max(-1, Math.min(1, steer)),
          throttle: Math.max(0, Math.min(1, (speed - t.speed) * 0.5)),
          brake: Math.max(0, Math.min(1, (t.speed - speed) * 0.4)),
        });
        const delta = r.telemetry.track.station - previous;
        travelled +=
          delta < -circuit.length / 2 ? delta + circuit.length : delta;
        previous = r.telemetry.track.station;
        maxLateral = Math.max(maxLateral, Math.abs(r.telemetry.track.lateral));
        peakLoad = Math.max(
          peakLoad,
          r.telemetry.totalLoad / (r.setup.mass * 9.81),
        );
        if (r.telemetry.groundedCount === 4) contacts++;
      }
      const result = {
        role,
        car,
        recipe: record.recipe,
        fingerprint: generated.fingerprint,
        length: circuit.length,
        travelled,
        maxLateral,
        peakLoad,
        fourContactFraction: contacts / steps,
        simulationSeconds: steps / 120,
        pass:
          travelled > circuit.length &&
          maxLateral < 1.5 &&
          peakLoad < 1.9 &&
          contacts / steps > 0.99,
      };
      results.push(result);
      console.log(JSON.stringify(result));
    } finally {
      r.dispose();
    }
  }
  const report = {
    sourceHash: summary.codeHash,
    description:
      "Full laps at 120 Hz on each family’s tightest, steepest and largest-relief qualified cases. Reference drivers cap speed at 16–21 m/s and brake for .55 g cornering.",
    results,
  };
  await writeFile(
    "artifacts/m4-v2/driving.json",
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    "docs/research/m4-v2-driving.json",
    JSON.stringify(report, null, 2),
  );
  if (results.some((r) => !r.pass)) process.exitCode = 1;
} finally {
  await server.close();
}
