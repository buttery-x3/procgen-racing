// Reproduce the uncurated research portfolio. Run from the repository root.
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { generateDesignStudy, BRIEFS } = await server.ssrLoadModule(
    "/src/track/design/DesignStudy.ts",
  );
  const { generateCircuit } = await server.ssrLoadModule(
    "/src/track/generateCircuit.ts",
  );
  const { Alignment } = await server.ssrLoadModule("/src/track/Alignment.ts");
  const { DEFAULT_RECIPE } = await server.ssrLoadModule(
    "/src/track/generationTypes.ts",
  );
  const records = [],
    failures = [],
    timings = [];
  const path = (points, x, y, w, h) => {
    const xs = points.map((p) => p.x),
      zs = points.map((p) => p.z),
      cx = (Math.max(...xs) + Math.min(...xs)) / 2,
      cz = (Math.max(...zs) + Math.min(...zs)) / 2;
    const scale = Math.min(
      w / (Math.max(...xs) - Math.min(...xs)),
      h / (Math.max(...zs) - Math.min(...zs)),
    );
    return (
      points
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${(x + w / 2 + (p.x - cx) * scale).toFixed(1)},${(y + h / 2 + (p.z - cz) * scale).toFixed(1)}`,
        )
        .join(" ") + "Z"
    );
  };
  const cards = [];
  for (const [brief, config] of Object.entries(BRIEFS)) {
    for (let i = 0; i < 8; i++) {
      const seed = i === 0 ? "ridge-104" : `ridge-104-${i + 1}`,
        start = performance.now();
      try {
        const r = generateDesignStudy(seed, brief);
        const ms = Math.round(performance.now() - start);
        timings.push(ms);
        records.push({ ...r, elapsedMs: ms });
        if (i < 3) {
          const legacy = generateCircuit({
            ...DEFAULT_RECIPE,
            seed,
            family: brief === "club" ? "touring" : "gp",
            targetLength: brief === "club" ? 3200 : 5200,
          });
          const a = new Alignment(legacy.circuit.definition),
            points = Array.from(
              { length: 300 },
              (_, j) => a.sample((j / 300) * a.length).position,
            );
          const row = Object.keys(BRIEFS).indexOf(brief),
            x = 26 + i * 460,
            y = 145 + row * 365;
          cards.push(
            `<g><rect x="${x}" y="${y}" width="440" height="345" rx="9" fill="#202a22" stroke="#43503e"/><text x="${x + 20}" y="${y + 28}" fill="#b1c2a4" font-size="11">${config.label.toUpperCase().replaceAll("&", "&amp;")} / ${seed}</text><path d="${path(r.points, x + 20, y + 52, 280, 220)}" fill="none" stroke="#d9f68b" stroke-width="3"/><path d="${path(points, x + 320, y + 70, 95, 160)}" fill="none" stroke="#89978a" stroke-width="2"/><text x="${x + 321}" y="${y + 252}" fill="#89978a" font-size="10">v1 / ${(a.length / 1000).toFixed(1)} km</text><text x="${x + 20}" y="${y + 303}" fill="#e7ede1" font-size="13">${(r.metrics.length / 1000).toFixed(2)} km · ${r.metrics.longStraights} straights · ${(r.metrics.hullOccupancy * 100).toFixed(0)}% hull occupancy</text><text x="${x + 20}" y="${y + 324}" fill="#a9b29c" font-size="11">${r.metrics.elevationRange.toFixed(0)} m relief · ${(r.metrics.maxGrade * 100).toFixed(1)}% peak estimated grade · PREVIEW ONLY</text></g>`,
          );
        }
      } catch (error) {
        failures.push({ brief, seed, message: String(error) });
      }
    }
  }
  const range = (key) => [
    Math.min(...records.map((r) => r.metrics[key])),
    Math.max(...records.map((r) => r.metrics[key])),
  ];
  const summary = {
    version: "m4-study-1",
    attempted: 24,
    found: records.length,
    failures,
    gradeOverSixPercent: records.filter((r) => r.metrics.maxGrade > 0.06)
      .length,
    locallyRefined: records.filter((r) => r.metrics.deformation > 0).length,
    hullOccupancy: range("hullOccupancy"),
    directionChanges: range("directionChanges"),
    longStraights: range("longStraights"),
    elevationRange: range("elevationRange"),
    peakGrade: range("maxGrade"),
    ms: [Math.min(...timings), Math.max(...timings)],
    validity: "Plan-view screening only. No physics certification.",
  };
  await mkdir("artifacts/design-study", { recursive: true });
  await writeFile(
    "artifacts/design-study/portfolio.json",
    JSON.stringify({ summary, records }, null, 2),
  );
  await writeFile(
    "artifacts/design-study/summary.json",
    JSON.stringify(summary, null, 2),
  );
  await mkdir("docs/research", { recursive: true });
  await writeFile(
    "docs/research/circuit-portfolio.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" width="1410" height="1280" viewBox="0 0 1410 1280"><rect width="1410" height="1280" fill="#141a18"/><g font-family="Segoe UI,Arial,sans-serif"><text x="26" y="42" fill="#a8bc9b" font-size="13" letter-spacing="2">M4 / CIRCUIT DESIGN STUDY 01</text><text x="26" y="88" fill="#ecf1e6" font-size="34">Signed sequences. Different silhouettes.</text><text x="26" y="118" fill="#a8b59e" font-size="13">First three seeds per brief, uncurated. Lime: experiment. Grey: actual v1, same seed. Maps fit independently; lengths shown.</text>${cards.join("")}<text x="26" y="1260" fill="#a8b59e" font-size="12">Research previews, not driveable circuits. Elevation, road edges, runoff and wheel-path loads still require coupled design.</text></g></svg>`,
  );
  console.log(JSON.stringify(summary));
} finally {
  await server.close();
}
