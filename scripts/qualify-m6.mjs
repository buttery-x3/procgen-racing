import { createServer } from "vite";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import { Vector3, Quaternion, Mesh, MeshStandardMaterial } from "three";
const count = Number(
    process.argv.find((a) => a.startsWith("--count="))?.split("=")[1] ?? 1000,
  ),
  driving = process.argv.includes("--driving");
if (!Number.isInteger(count) || count < 1 || count > 10000)
  throw new Error("Use --count=1..10000 per car family.");
const hash = createHash("sha256");
for (const f of (await readdir("src", { recursive: true }))
  .filter((f) => /\.(ts|css)$/.test(f))
  .sort())
  hash.update(await readFile(`src/${f}`));
hash.update(await readFile("package-lock.json"));
const sourceHash = hash.digest("hex").slice(0, 16),
  started = performance.now();
const server = await createServer({
  server: { middlewareMode: true, ws: false, watch: null },
  appType: "custom",
  logLevel: "error",
});
const report = {
  sourceHash,
  measuredAt: "2026-10-26",
  cpu: os.cpus()[0].model,
  memoryGiB: Math.round(os.totalmem() / 2 ** 30),
  countPerFamily: count,
  families: [],
  physical: [],
  laps: [],
  failures: [],
};
console.log(
  JSON.stringify({
    phase: "start",
    sourceHash,
    countPerFamily: count,
    driving,
  }),
);
try {
  const { generateCar, ARCHETYPES, DEFAULT_CAR_RECIPE } =
      await server.ssrLoadModule("/src/vehicle/generateCar.ts"),
    { CAR_FAMILIES, resolveCar } = await server.ssrLoadModule(
      "/src/vehicle/CarDefinition.ts",
    ),
    { createCarBody } = await server.ssrLoadModule(
      "/src/rendering/CarGeometry.ts",
    ),
    { validateCarPhysics } = await server.ssrLoadModule(
      "/src/vehicle/validateCarPhysics.ts",
    );
  const material = new MeshStandardMaterial();
  for (const family of CAR_FAMILIES) {
    const times = [],
      mechanics = new Set(),
      shapes = new Set(),
      paints = new Set(),
      ranges = {
        mass: [Infinity, -Infinity],
        wheelbase: [Infinity, -Infinity],
        frontWeight: [Infinity, -Infinity],
        yawInertia: [Infinity, -Infinity],
      };
    let passed = 0,
      meshes = 0;
    for (let i = 0; i < count; i++) {
      const seed = `m6-${family}-${i}`,
        recipe = {
          ...DEFAULT_CAR_RECIPE,
          family,
          layout:
            ARCHETYPES[family].layouts[i % ARCHETYPES[family].layouts.length],
          band: ["road", "sport", "race"][i % 3],
          seed,
          mechanicsSeed: seed,
          proportionsSeed: seed,
          appearanceSeed: seed,
        };
      try {
        const start = performance.now(),
          r = generateCar(recipe);
        times.push(performance.now() - start);
        if (!r.valid)
          throw new Error(
            r.checks
              .filter((c) => !c.passed)
              .map((c) => c.name + ": " + c.detail)
              .join("; "),
          );
        const car = resolveCar(r.setup);
        mechanics.add(r.mechanics);
        shapes.add(
          JSON.stringify({ d: car.dimensions, s: r.definition.shape }),
        );
        paints.add(r.definition.appearance.paint);
        for (const [key, n] of Object.entries({
          mass: r.setup.mass,
          wheelbase: r.setup.wheelbase,
          frontWeight: r.setup.frontWeight,
          yawInertia: car.tensor[1][1],
        })) {
          ranges[key][0] = Math.min(ranges[key][0], n);
          ranges[key][1] = Math.max(ranges[key][1], n);
        }
        if (i % 20 === 0) {
          const body = createCarBody(r.setup, {
            body: material,
            glass: material,
            dark: material,
            headlight: material,
            taillight: material,
            accent: material,
          });
          body.traverse((o) => {
            if (o instanceof Mesh || o.isMesh) {
              const p = o.geometry.getAttribute("position");
              for (let j = 0; j < p.count; j++)
                if (![p.getX(j), p.getY(j), p.getZ(j)].every(Number.isFinite))
                  throw new Error("Non-finite body mesh");
              o.geometry.dispose();
            }
          });
          meshes++;
        }
        passed++;
      } catch (error) {
        report.failures.push({
          family,
          recipe,
          error: String(error.message ?? error),
        });
      }
    }
    times.sort((a, b) => a - b);
    report.families.push({
      family,
      attempted: count,
      passed,
      failed: count - passed,
      meshChecked: meshes,
      uniqueMechanics: mechanics.size,
      uniqueProportions: shapes.size,
      paintColours: paints.size,
      ranges,
      timeMs: {
        p50: times[Math.floor(times.length * 0.5)],
        p95: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))],
        max: times.at(-1),
      },
    });
    for (const band of ["road", "sport", "race"]) {
      const recipe = {
          ...DEFAULT_CAR_RECIPE,
          family,
          layout: ARCHETYPES[family].layouts[0],
          band,
          seed: `physical-${family}-${band}`,
          mechanicsSeed: `physical-${family}-${band}`,
          proportionsSeed: `physical-${family}-${band}`,
          appearanceSeed: "qualification",
        },
        car = generateCar(recipe);
      const result = await validateCarPhysics(car.setup);
      report.physical.push({
        family,
        band,
        recipe,
        fingerprint: car.fingerprint,
        ...result,
      });
      if (!result.valid)
        report.failures.push({ family, recipe, error: result.detail });
    }
    console.log(
      JSON.stringify({
        family,
        passed,
        total: count,
        physical: report.physical.slice(-3).map((p) => p.valid),
      }),
    );
  }
  material.dispose();
  if (driving) {
    const { generateVenueCircuit } = await server.ssrLoadModule(
        "/src/track/venue/constructVenue.ts",
      ),
      { DEFAULT_DESIGN_RECIPE } = await server.ssrLoadModule(
        "/src/track/generationTypes.ts",
      ),
      { DEFAULT_VENUE } = await server.ssrLoadModule(
        "/src/track/venue/types.ts",
      ),
      { hydrateCircuit } = await server.ssrLoadModule(
        "/src/track/SurfaceCompiler.ts",
      ),
      { SuspensionRig, initializePhysics } = await server.ssrLoadModule(
        "/src/physics/SuspensionRig.ts",
      );
    await initializePhysics();
    for (const family of ["touring", "gp"]) {
      const generated = generateVenueCircuit(
          {
            ...DEFAULT_DESIGN_RECIPE,
            seed: family === "touring" ? "ridge-9zmsj6" : "silver-63",
            family,
            targetLength: family === "touring" ? 2400 : 5200,
          },
          {
            ...DEFAULT_VENUE,
            theme: family === "touring" ? "traditional" : "modern",
          },
        ),
        circuit = hydrateCircuit(generated.circuit),
        cap = family === "touring" ? 16 : 20;
      for (const carFamily of CAR_FAMILIES) {
        const recipe = {
            ...DEFAULT_CAR_RECIPE,
            family: carFamily,
            layout: ARCHETYPES[carFamily].layouts[0],
          },
          car = generateCar(recipe),
          rig = new SuspensionRig(car.setup);
        let travel = 0,
          steps = 0,
          grounded = 0,
          peakLoad = 0,
          maxLateral = 0;
        try {
          rig.setCircuit(circuit);
          for (let i = 0; i < 360; i++) rig.step();
          let previous = rig.telemetry.track.station;
          for (
            ;
            steps < Math.ceil((circuit.length / cap + 180) * 120) &&
            travel < circuit.length + 8;
            steps++
          ) {
            const t = rig.telemetry,
              look = 6 + t.speed * 0.4,
              q = new Quaternion().copy(t.rotation),
              aim = circuit
                .frame(t.track.station + look)
                .position.sub(new Vector3().copy(t.position)),
              angle = Math.atan2(
                aim.dot(new Vector3(-1, 0, 0).applyQuaternion(q)),
                aim.dot(new Vector3(0, 0, 1).applyQuaternion(q)),
              ),
              steer =
                (Math.atan2(2 * rig.setup.wheelbase * Math.sin(angle), look) /
                  rig.setup.steeringLimit) *
                (1 + (rig.setup.speedSteering * t.speed) / 18),
              k = Math.max(
                ...[0, 10, 25, 45].map((d) =>
                  Math.abs(
                    circuit.alignment.sample(t.track.station + d).curvature,
                  ),
                ),
              ),
              speed = Math.min(
                cap,
                Math.sqrt((0.55 * 9.81) / Math.max(0.0001, k)),
              );
            rig.step({
              steer: Math.max(-1, Math.min(1, steer)),
              throttle: Math.max(0, Math.min(1, (speed - t.speed) * 0.5)),
              brake: Math.max(0, Math.min(1, (t.speed - speed) * 0.4)),
            });
            const delta = rig.telemetry.track.station - previous;
            travel +=
              delta < -circuit.length / 2 ? delta + circuit.length : delta;
            previous = rig.telemetry.track.station;
            grounded += rig.telemetry.groundedCount === 4 ? 1 : 0;
            peakLoad = Math.max(
              peakLoad,
              rig.telemetry.totalLoad / (car.setup.mass * 9.81),
            );
            maxLateral = Math.max(
              maxLateral,
              Math.abs(rig.telemetry.track.lateral),
            );
          }
          const valid =
              travel >= circuit.length &&
              grounded / steps > 0.98 &&
              peakLoad < 2.5 &&
              maxLateral < 1.8,
            record = {
              carFamily,
              circuitFamily: family,
              recipe,
              carFingerprint: car.fingerprint,
              circuitFingerprint: generated.fingerprint,
              valid,
              lapMetres: travel,
              steps,
              groundedFraction: grounded / steps,
              peakLoad,
              maxLateral,
            };
          report.laps.push(record);
          if (!valid)
            report.failures.push({
              family: carFamily,
              recipe,
              error: "Full dressed lap failed",
              record,
            });
          console.log(
            JSON.stringify({ phase: "lap", ...record, recipe: undefined }),
          );
        } finally {
          rig.dispose();
        }
      }
    }
  }
} finally {
  await server.close();
}
report.elapsedSeconds = (performance.now() - started) / 1000;
report.attempted = report.families.reduce((s, f) => s + f.attempted, 0);
report.passed = report.families.reduce((s, f) => s + f.passed, 0);
report.valid = report.failures.length === 0;
await mkdir("artifacts/m6", { recursive: true });
await writeFile(
  "artifacts/m6/qualification.json",
  JSON.stringify(report, null, 2),
);
if (count >= 1000 && driving && report.valid)
  await writeFile(
    "docs/research/m6-qualification.json",
    JSON.stringify(report, null, 2),
  );
console.log(
  JSON.stringify({
    phase: "complete",
    sourceHash: report.sourceHash,
    valid: report.valid,
    attempted: report.attempted,
    passed: report.passed,
    physical: report.physical.length,
    laps: report.laps.length,
    failures: report.failures.length,
    elapsedSeconds: report.elapsedSeconds,
  }),
);
if (!report.valid) process.exitCode = 1;
