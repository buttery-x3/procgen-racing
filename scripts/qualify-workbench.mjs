import { createServer } from "vite";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";

const hash = createHash("sha256");
for (const f of (await readdir("src", { recursive: true })).filter((f) => /\.(ts|css)$/.test(f)).sort()) hash.update(await readFile(`src/${f}`));
hash.update(await readFile("package-lock.json"));
const sourceHash = hash.digest("hex").slice(0, 16);
const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: "custom", logLevel: "error" });
const report = { sourceHash, date: new Date().toISOString(), cpu: os.cpus()[0].model,
  scope: "Catalog v1: at least ten accepted pairs per category, every offered car family/band and track branch/length endpoint. Production car static/12-second physical validation, circuit construction, isolated collider settling, archive replay and conservative physical laps on representatives. Does not certify arbitrary tunes or all combinations.",
  categories: [], attempts: [], laps: [], failures: [] };
const started = performance.now();
try {
  const load = (name) => server.ssrLoadModule(`/src/${name}.ts`);
  const [{ CATEGORIES, CATEGORY_PRESETS, explorationRecipe }, { generateCar }, { mechanicsFingerprint }, { generateVenueCircuit }, { hydrateCircuit }, { validateCarPhysics }, { initializePhysics, SuspensionRig }, { referenceControls }, { RaceSession }, { sessionIdentity }, { circuitArchive, restoreCircuitArchive }] = await Promise.all([
    load("exploration/catalog"), load("vehicle/generateCar"), load("vehicle/CarDefinition"), load("track/venue/constructVenue"), load("track/SurfaceCompiler"), load("vehicle/validateCarPhysics"), load("physics/SuspensionRig"), load("diagnostics/ReferenceDriver"), load("race/RaceSession"), load("race/identity"), load("storage/CircuitStorage"),
  ]);
  await initializePhysics();
  const drivenTracks = new Set(), drivenCars = new Set();
  for (const category of CATEGORIES) {
    const preset = CATEGORY_PRESETS[category], required = new Set();
    for (const car of preset.cars) for (const band of preset.bands) required.add(`car:${car}:${band}`);
    for (const t of preset.tracks) { required.add(`track:${t.version}:${t.family}`); required.add(`min:${t.family}`); required.add(`max:${t.family}`); }
    const coverage = (r) => {
      const t = preset.tracks.find((t) => t.version === r.track.version && t.family === r.track.family);
      return [`car:${r.car.family}:${r.car.band}`, `track:${r.track.version}:${r.track.family}`, ...(r.track.targetLength === t.min ? [`min:${t.family}`] : []), ...(r.track.targetLength === t.max ? [`max:${t.family}`] : [])];
    };
    const pool = Array.from({ length: 3000 }, (_, i) => explorationRecipe(category, `workbench-v1-${i}`));
    const pending = [], planned = new Set();
    while ([...required].some((k) => !planned.has(k))) {
      pool.sort((a, b) => coverage(b).filter((k) => !planned.has(k)).length - coverage(a).filter((k) => !planned.has(k)).length);
      const r = pool.shift(); if (!r || !coverage(r).some((k) => !planned.has(k))) throw new Error(`No coverage seed for ${category}`);
      pending.push(r); coverage(r).forEach((k) => planned.add(k));
    }
    while (pending.length < 10) pending.push(pool.shift());
    const accepted = [], covered = new Set();
    let extra = 0;
    while (pending.length || (accepted.length < 10 || [...required].some((k) => !covered.has(k)))) {
      if (extra++ > 45) throw new Error(`Category acceptance exhausted: ${category}`);
      const missing = [...required].filter((k) => !covered.has(k));
      if (!pending.length) {
        pool.sort((a, b) => coverage(b).filter((k) => missing.includes(k)).length - coverage(a).filter((k) => missing.includes(k)).length);
        pending.push(pool.shift());
      }
      const requested = pending.shift();
      let success = false;
      for (let attempt = 0; attempt < 3 && !success; attempt++) {
        const r = explorationRecipe(category, requested.seed, attempt), start = performance.now();
        let rig;
        try {
          const car = generateCar(r.car);
          if (!car.valid) throw new Error(`Car static: ${car.checks.filter((c) => !c.passed).map((c) => c.detail).join("; ")}`);
          const physical = await validateCarPhysics(car.setup);
          if (!physical.valid) throw new Error(`Car physical: ${physical.detail}`);
          const result = generateVenueCircuit(r.track, r.venue);
          if (!result.report.valid || result.fallback || result.report.checks.some((c) => c.status === "fail")) throw new Error(`Circuit acceptance: ${JSON.stringify(result.report.checks.filter((c) => c.status === "fail"))}`);
          const c = hydrateCircuit(result.circuit), archive = circuitArchive(result);
          const restored = restoreCircuitArchive(archive);
          if (restored.fingerprint !== result.fingerprint) throw new Error("Accepted archive fingerprint changed on replay.");
          rig = new SuspensionRig(car.setup); rig.setCircuit(c);
          for (let i = 0; i < 360; i++) rig.step();
          if (!rig.telemetry.groundedCount || !Number.isFinite(rig.telemetry.position.y)) throw new Error("Unsettled/non-finite grid start.");
          const record = { category, seed: r.seed, attempt, car: r.car, track: r.track, venue: r.venue, fingerprint: result.fingerprint, mechanics: mechanicsFingerprint(car.setup), actualLength: c.distance, acceptedMs: performance.now() - start, physical, grounded: rig.telemetry.groundedCount, coverage: coverage(r) };
          accepted.push(record); record.coverage.forEach((k) => covered.add(k));
          report.attempts.push({ category, seed: r.seed, attempt, ok: true, ms: record.acceptedMs });
          success = true;
          const trackBranch = `${r.track.version}:${r.track.family}`;
          if (!drivenTracks.has(trackBranch) || !drivenCars.has(r.car.family)) {
            const laps = [], session = new RaceSession(c, sessionIdentity(c, car.setup), (l) => laps.push(l));
            session.restart("time-trial", rig.telemetry);
            const cap = 12, maxSteps = Math.ceil((c.length / 10 + 300) * 120);
            let steps = 0, peakLateral = 0, finite = true;
            while (!laps.length && steps < maxSteps) {
              rig.step(referenceControls(rig.telemetry, car.setup, c, cap)); session.step(rig.telemetry); steps++;
              peakLateral = Math.max(peakLateral, Math.abs(rig.telemetry.track.lateral));
              finite &&= [rig.telemetry.position.x, rig.telemetry.position.y, rig.telemetry.position.z, rig.telemetry.speed].every(Number.isFinite);
              if (!finite || peakLateral > 12) break;
            }
            const lap = { category, seed: r.seed, car: r.car.family, track: trackBranch, length: c.distance, steps, finite, peakLateral, valid: !!laps[0]?.result.valid, duration: laps[0]?.result.duration, reasons: laps[0]?.result.reasons ?? session.snapshot().message };
            report.laps.push(lap);
            if (!lap.valid || !finite) report.failures.push({ phase: "driving", ...lap });
            drivenTracks.add(trackBranch); drivenCars.add(r.car.family);
          }
          console.log(JSON.stringify({ category, accepted: accepted.length, attempt, car: r.car.family, track: r.track.family, length: c.distance, missing: [...required].filter((k) => !covered.has(k)).length }));
        } catch (e) {
          report.attempts.push({ category, seed: r.seed, attempt, ok: false, ms: performance.now() - start, error: String(e) });
          console.log(JSON.stringify(report.attempts.at(-1)));
        } finally { rig?.dispose(); }
      }
      if (!success) report.failures.push({ phase: "acceptance", category, seed: requested.seed });
    }
    report.categories.push({ category, accepted: accepted.length, coverage: [...covered], required: [...required], records: accepted });
  }
} catch (error) { report.failures.push({ phase: "campaign", error: String(error) }); }
finally {
  report.elapsedSeconds = (performance.now() - started) / 1000;
  report.accepted = report.categories.reduce((n, c) => n + c.accepted, 0);
  report.rejectedAttempts = report.attempts.filter((a) => !a.ok).length;
  report.failed = report.failures.length;
  await mkdir("artifacts/ui-first-pass", { recursive: true });
  await writeFile("artifacts/ui-first-pass/category-qualification.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ sourceHash, accepted: report.accepted, rejectedAttempts: report.rejectedAttempts, laps: report.laps.length, failed: report.failed, elapsedSeconds: report.elapsedSeconds }));
  await server.close();
  if (report.failed) process.exitCode = 1;
}
