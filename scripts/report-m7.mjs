import { createServer } from "vite";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const campaign = JSON.parse(
    await readFile("artifacts/m7/qualification.json", "utf8"),
  ),
  driving = JSON.parse(await readFile("artifacts/m7/driving.json", "utf8")),
  benchmark = JSON.parse(
    await readFile("artifacts/m7/desktop-benchmark.json", "utf8"),
  );
const hash = createHash("sha256");
for (const f of (await readdir("src", { recursive: true }))
  .filter((f) => /\.(ts|css)$/.test(f))
  .sort())
  hash.update(await readFile(`src/${f}`));
hash.update(await readFile("package-lock.json"));
const sourceHash = hash.digest("hex").slice(0, 16);
if (
  campaign.summary.sourceHash !== sourceHash ||
  driving.sourceHash !== sourceHash ||
  benchmark.sourceHash !== sourceHash
)
  throw new Error(
    "Qualification evidence must match the frozen current source hash.",
  );
if (
  campaign.summary.failed ||
  driving.failed ||
  campaign.summary.planningPerFamily < 1000 ||
  campaign.summary.constructionPerFamily < 32 ||
  driving.attempted < 31 ||
  benchmark.results?.length !== 3
)
  throw new Error(
    "Finish and pass the complete M7 campaign before publishing its report.",
  );
const server = await createServer({
  server: { middlewareMode: true, ws: false, watch: null },
  appType: "custom",
  logLevel: "error",
});
try {
  const { designFamilyCircuit } = await server.ssrLoadModule(
      "/src/track/families/generateFamilyCircuit.ts",
    ),
    { FAMILY_PRESETS, DEFAULT_FAMILY_RECIPE } = await server.ssrLoadModule(
      "/src/track/families/types.ts",
    ),
    { Alignment } = await server.ssrLoadModule("/src/track/Alignment.ts");
  const escape = (s) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const cards = [],
    portfolio = [];
  for (const [family, preset] of Object.entries(FAMILY_PRESETS))
    for (let i = 0; i < 5; i++) {
      const qualified = campaign.records.find(
          (r) =>
            r.phase === "planning" &&
            r.recipe.family === family &&
            r.recipe.seed === `m7-${i}`,
        ),
        recipe = qualified.recipe,
        { definition, report } = designFamilyCircuit(recipe, {
          reference: false,
        }),
        path = new Alignment(definition),
        rows = Array.from({ length: Math.ceil(path.length / 8) }, (_, j) =>
          path.sample((j * path.length) / Math.ceil(path.length / 8)),
        ),
        xs = rows.map((r) => r.position.x),
        zs = rows.map((r) => r.position.z),
        minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minZ = Math.min(...zs),
        maxZ = Math.max(...zs),
        scale = Math.min(300 / (maxX - minX), 190 / (maxZ - minZ)),
        point = (p) =>
          `${(170 - (p.x - (minX + maxX) / 2) * scale).toFixed(1)},${(114 - (p.z - (minZ + maxZ) / 2) * scale).toFixed(1)}`,
        terrain = definition.site.terrain,
        m = report.metrics,
        network = definition.familyDesign.network,
        background = network.edges
          .map(
            (e) =>
              `<polyline points="${e.points.map(point).join(" ")}" fill="none" stroke="${e.origin === "new-connector" ? "#bb9a76" : "#607365"}" stroke-width="1"/>`,
          )
          .join(""),
        trace = rows
          .filter((_, i) => i % 3 === 0)
          .map(
            (r, j) =>
              `${(20 + (j / Math.ceil(rows.length / 3)) * 300).toFixed(1)},${(256 - Math.max(-1, Math.min(1, r.curvature * 75)) * 14).toFixed(1)}`,
          )
          .join(" ");
      cards.push(
        `<article><h2>${escape(preset.name)}</h2><p>${escape(recipe.seed)} · ${recipe.variant} · ${recipe.oval} · ${recipe.relief}</p><svg viewBox="0 0 340 282" role="img" aria-label="${escape(preset.name)} ${recipe.seed}"><defs><clipPath id="map-${family}-${i}"><rect x="6" y="6" width="328" height="225" rx="5"/></clipPath></defs><g clip-path="url(#map-${family}-${i})">${background}<polyline points="${[...rows, rows[0]].map((r) => point(r.position)).join(" ")}" fill="none" stroke="#d6e5b8" stroke-width="5" stroke-linejoin="round"/><circle cx="${point(rows[0].position).split(",")[0]}" cy="${point(rows[0].position).split(",")[1]}" r="5" fill="#e5b87b"/></g><path d="M20 256H320" stroke="#4c654d"/><polyline points="${trace}" fill="none" stroke="#b9c9a1" stroke-width="1"/></svg><p>${(path.length / 1000).toFixed(2)} km · radius ≥ ${m.minRadius.toFixed(0)} m · ${(m.maxGrade * 100).toFixed(1)}% grade · Δ ${m.elevationRange.toFixed(1)} m</p><small>${network.kind} · ${network.nodes.length} nodes / ${network.edges.length} edges · terrain amplitude ${terrain.amplitude} m</small></article>`,
      );
      portfolio.push({
        recipe,
        definitionHash: qualified.definitionHash,
        length: path.length,
        metrics: m,
        networkKind: network.kind,
      });
    }
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M7 uncurated circuit portfolio</title><style>body{margin:0;padding:32px;background:#14251c;color:#d7e4c5;font:14px/1.5 system-ui}h1{font-size:28px}header{max-width:1000px;margin-bottom:32px}p,small{color:#acbc9c}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}article{background:#21352a;border:1px solid #465e43;border-radius:10px;padding:18px}h2{margin:0;font-size:17px}svg{width:100%;background:#1b2f23;border-radius:6px}article p{margin:6px 0}small{font-size:11px}</style><header><small>M7 / ${sourceHash}</small><h1>Seven venue families. Thirty-five consecutive seeds.</h1><p>Seeds m7-0 through m7-4 for every family, without visual selection or rejected-image filtering. Length, shape, relief and alternative controls follow the qualification schedule. Orange marks the grid; pale lines show the accepted road and muted lines its inherited network. The trace under each map shows signed curvature. These fictional venues demonstrate composition and inherited road topology; they are not replicas or homologated designs.</p><p>Terrain interactions and collision are separately checked by the qualification and driving reports. Main racing routes remain on layer 0.</p></header><div class="grid">${cards.join("")}</div></html>`;
  await writeFile("docs/research/m7-portfolio.html", html);
  const planning = campaign.records.filter((r) => r.phase === "planning"),
    report = {
      ...campaign.summary,
      scope:
        "7,000 accepted-definition planning checks (1,000 per family) plus 224 full terrain/road/venue constructions (32 per family). Planning is not full-mesh qualification. No fallback or seed substitution. 35 consecutive portfolio seeds. Frame and full-lap tests are separate reports.",
      planningFingerprints: Object.fromEntries(
        Object.keys(FAMILY_PRESETS).map((f) => [
          f,
          planning
            .filter((r) => r.recipe.family === f)
            .map((r) => r.definitionHash),
        ]),
      ),
      construction: campaign.records.filter((r) => r.phase === "construction"),
      portfolio,
    };
  await writeFile(
    "docs/research/m7-qualification.json",
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    "docs/research/m7-driving.json",
    JSON.stringify(driving, null, 2),
  );
  await writeFile(
    "docs/research/m7-desktop-benchmark.json",
    JSON.stringify(benchmark, null, 2),
  );
  console.log(
    JSON.stringify({
      sourceHash,
      planning: planning.length,
      construction: report.construction.length,
      laps: driving.attempted,
      portfolio: portfolio.length,
    }),
  );
} finally {
  await server.close();
}
