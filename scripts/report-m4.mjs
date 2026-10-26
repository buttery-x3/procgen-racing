import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "vite";
const { summary, records } = JSON.parse(
  await readFile("artifacts/m4-v2/qualification.json", "utf8"),
);
if (summary.presets.some((p) => p.attempted < 1000) || records.length < 4000)
  throw new Error("A complete 1,000-case-per-preset campaign is required.");
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const path = (points, x, y, w, h) => {
  const xs = points.map((p) => p.x),
    zs = points.map((p) => p.z),
    cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const scale = Math.min(
    w / (Math.max(...xs) - Math.min(...xs)),
    h / (Math.max(...zs) - Math.min(...zs)),
  );
  return (
    points
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${(x + w / 2 + (p.x - cx) * scale).toFixed(2)},${(y + h / 2 - (p.z - cz) * scale).toFixed(2)}`,
      )
      .join(" ") + "Z"
  );
};
// Fixed disjoint seed ranges: 32 distinct seeds, eight cases per preset. Do not
// accidentally count the same eight seed strings in four terrain/style presets
// as the approved thirty-seed visual design review.
const portfolio = summary.presets.flatMap((p, presetIndex) =>
  records
    .filter((r) => r.recipe.family === p.family && r.recipe.relief === p.relief)
    .slice(presetIndex * 8, presetIndex * 8 + 8),
);
const server = await createServer({
  server: { middlewareMode: true, ws: false, watch: null },
  appType: "custom",
  logLevel: "error",
});
try {
  const { generateCircuit } = await server.ssrLoadModule(
    "/src/track/generateCircuit.ts",
  );
  const { Alignment } = await server.ssrLoadModule("/src/track/Alignment.ts");
  for (const record of portfolio)
    if (record.ok && !record.points) {
      const result = generateCircuit(record.recipe);
      if (result.fingerprint !== record.fingerprint)
        throw new Error(`Qualified geometry changed for ${record.id}.`);
      const route = new Alignment(result.circuit.definition);
      record.points = Array.from({ length: 300 }, (_, i) => {
        const r = route.sample((i * route.length) / 300);
        return { x: r.position.x, z: r.position.z };
      });
    }
} finally {
  await server.close();
}
// Compare outlines independently of translation, scale, rotation, circulation and
// reflection. This is descriptive evidence, not a quality score to maximize.
const normalizedOutline = (points) => {
  const centre = points.reduce(
    (s, p) => ({ x: s.x + p.x / points.length, z: s.z + p.z / points.length }),
    { x: 0, z: 0 },
  );
  const scale = Math.sqrt(
    points.reduce(
      (s, p) => s + (p.x - centre.x) ** 2 + (p.z - centre.z) ** 2,
      0,
    ) / points.length,
  );
  return points.map((p) => ({
    x: (p.x - centre.x) / scale,
    z: (p.z - centre.z) / scale,
  }));
};
const outlineDistance = (a, b) => {
  let correlation = 0;
  for (const direction of [-1, 1])
    for (const mirror of [-1, 1])
      for (let phase = 0; phase < a.length; phase += 6) {
        let dot = 0,
          cross = 0;
        for (let i = 0; i < a.length; i++) {
          const q = b[(phase + direction * i + b.length) % b.length],
            x = q.x * mirror;
          dot += a[i].x * x + a[i].z * q.z;
          cross += a[i].x * q.z - a[i].z * x;
        }
        correlation = Math.max(correlation, Math.hypot(dot, cross) / a.length);
      }
  return Math.sqrt(Math.max(0, 2 - 2 * correlation));
};
const outlines = portfolio
    .filter((r) => r.ok)
    .map((r) => ({ record: r, points: normalizedOutline(r.points) })),
  pairs = [];
for (let i = 0; i < outlines.length; i++)
  for (let j = i + 1; j < outlines.length; j++)
    pairs.push({
      a: outlines[i].record.id,
      b: outlines[j].record.id,
      distance: outlineDistance(outlines[i].points, outlines[j].points),
    });
pairs.sort((a, b) => a.distance - b.distance);
const enriched = {
  ...summary,
  node: process.version,
  generatedAt: new Date().toISOString(),
  portfolioDiversity: {
    cases: outlines.length,
    distinctSeeds: new Set(portfolio.map((r) => r.recipe.seed)).size,
    selection:
      "Fixed disjoint index ranges: touring/gentle 0–7, touring/rolling 8–15, GP/gentle 16–23, GP/rolling 24–31. No selection by shape.",
    method:
      "RMS outline distance after centering, RMS-radius normalization and best rotation/reflection/circulation, with cyclic starts sampled every 2% of lap. Zero means the same outline; distance is not a quality score.",
    closestPairs: pairs.slice(0, 5),
    pairDistance: {
      min: pairs[0]?.distance,
      median: pairs[Math.floor(pairs.length / 2)]?.distance,
      max: pairs.at(-1)?.distance,
    },
  },
  presets: summary.presets.map((p) => {
    const cases = records.filter(
        (r) => r.recipe.family === p.family && r.recipe.relief === p.relief,
      ),
      good = cases.filter((r) => r.ok);
    return {
      ...p,
      maxGrade: Math.max(...good.map((r) => r.metrics.maxGrade)),
      challengeAboveSixPercent: good.filter(
        (r) => r.recipe.envelope === "terrain" && r.metrics.maxGrade > 0.06,
      ).length,
      largestMesh: Math.max(...good.map((r) => r.triangles)),
      uniqueFingerprints: new Set(good.map((r) => r.fingerprint)).size,
      rejectedCandidates: good.reduce((s, r) => s + r.attempts.length, 0),
      extremes: Object.fromEntries(
        [
          ["slowest", (r) => r.ms],
          ["tightest", (r) => -r.metrics.minRadius],
          ["steepest", (r) => r.metrics.maxGrade],
          ["mostFolded", (r) => -r.design.hull],
          ["largestRelief", (r) => r.metrics.elevationRange],
          ["largestMesh", (r) => r.triangles],
        ].map(([role, score]) => {
          const r = [...good].sort((a, b) => score(b) - score(a))[0];
          return [
            role,
            {
              id: r.id,
              recipe: r.recipe,
              fingerprint: r.fingerprint,
              ms: r.ms,
              metrics: r.metrics,
              design: r.design,
              triangles: r.triangles,
            },
          ];
        }),
      ),
    };
  }),
};
await mkdir("docs/research", { recursive: true });
await writeFile(
  "docs/research/m4-v2-qualification.json",
  JSON.stringify(enriched, null, 2),
);
const cards = portfolio.map((r, i) => {
  const col = Math.floor(i / 8),
    row = i % 8,
    x = 20 + col * 390,
    y = 160 + row * 270;
  if (!r.ok)
    return `<g><rect x="${x}" y="${y}" width="370" height="250" fill="#34251e"/><text x="${x + 15}" y="${y + 35}" fill="#f1c19e">FAILED / ${esc(r.recipe.seed)}</text></g>`;
  return `<g><rect x="${x}" y="${y}" width="370" height="250" rx="7" fill="#202a22" stroke="#3d4b3a"/><text x="${x + 16}" y="${y + 24}" fill="#a9bb9b" font-size="10">${esc(r.recipe.seed)} / ${r.recipe.character} / ${r.recipe.targetLength / 1000} km</text><path d="${path(r.points, x + 22, y + 42, 326, 150)}" fill="none" stroke="${r.design.mode === "anchors" ? "#a6d0d6" : "#d9ed9a"}" stroke-width="2.5"/><text x="${x + 16}" y="${y + 216}" fill="#dce7ce" font-size="11">${r.metrics.elevationRange.toFixed(0)} m relief · ${(r.metrics.maxGrade * 100).toFixed(1)}% grade · ${r.design.straights} straights</text><text x="${x + 16}" y="${y + 236}" fill="#93a584" font-size="10">${r.fallback ? "FALLBACK" : r.design.mode.toUpperCase()} · ${r.triangles.toLocaleString("en-US")} shared triangles</text></g>`;
});
const titles = summary.presets
  .map(
    (p, i) =>
      `<text x="${35 + i * 390}" y="140" fill="#dce7ce" font-size="15">${p.family.toUpperCase()} / ${p.relief.toUpperCase()}</text>`,
  )
  .join("");
await writeFile(
  "docs/research/m4-v2-portfolio.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1590" height="2360" viewBox="0 0 1590 2360"><rect width="1590" height="2360" fill="#141b17"/><g font-family="Segoe UI,Arial,sans-serif"><text x="20" y="40" fill="#a8ba98" font-size="13" letter-spacing="2">PROCGEN RACING / M4 V2</text><text x="20" y="82" fill="#ecf3e4" font-size="31">A portfolio of driveable circuits.</text><text x="20" y="108" fill="#a8ba98" font-size="12">32 distinct seeds in fixed disjoint ranges. Cyan: anchor-led. Lime: sequence-led. Each map fits its own bounds. Source ${summary.codeHash}.</text>${titles}${cards.join("")}<text x="20" y="2340" fill="#9aad8b" font-size="11">All results shown; no shape selection. See the qualification report for native/fallback/failure rates and recipe coverage.</text></g></svg>`,
);
const data = JSON.stringify(portfolio).replaceAll(
  "<",
  String.fromCharCode(92) + "u003c",
);
await writeFile(
  "docs/research/m4-v2-portfolio.html",
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M4 v2 — circuit portfolio</title><style>body{margin:0;background:#141b17;color:#e3edd9;font:14px system-ui}main{max-width:1450px;margin:auto;padding:30px}a{color:#d1e9a1}h1{font-weight:500;font-size:36px}p{color:#a5b69a;line-height:1.7}select,button{background:#253222;color:inherit;border:1px solid #526248;padding:10px;border-radius:5px}nav{display:flex;gap:12px;align-items:center;margin:25px 0}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{display:flex;flex-direction:column;cursor:pointer;text-align:left}.card:hover{border-color:#d5eba4}.card svg{width:100%;height:190px}.card small{color:#a5b69a}.card strong{margin:8px 0}dialog{background:#1d281e;color:inherit;border:1px solid #617255;border-radius:8px;width:min(1000px,90vw);max-height:90vh;overflow:auto}dialog::backdrop{background:#000a}#detail{display:grid;grid-template-columns:2fr 1fr;gap:20px}#detail svg{width:100%;height:450px}pre{font-size:11px;overflow:auto;max-height:460px}dialog>button{float:right}@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}#detail{display:block}}</style><main><a href="/">← Driving workbench</a><h1>M4 v2 / circuit portfolio</h1>
<p>Baseline: <code>main</code> / <code>v0.1.0</code> (M0–M5). Future milestones use separate branches from <code>development</code>, then merge and push to remote <code>development</code> for testing. <a href="../workflow.md" style="color:#d5eba4">Release and branch workflow</a>.</p><p>Eight recipes per preset in disjoint seed ranges, without shape selection. Each successful entry was generated, validated and compiled. Maps fit independently; lengths are shown.</p><nav><label for="family">Style</label><select id="family"><option value="all">All styles</option><option>touring</option><option>gp</option></select><label for="relief">Land</label><select id="relief"><option value="all">All terrain</option><option>gentle</option><option>rolling</option></select><span>32 fixed recipes · source ${summary.codeHash}</span></nav><section class="grid" id="cards"></section><p>Complete campaign: ${summary.presets.map((p) => `${p.family}/${p.relief} ${p.native}/${p.attempted} native, ${p.fallback} fallback, ${p.failed} failed`).join(" · ")}.</p></main><dialog id="dialog"><button id="close">Close ×</button><h2 id="title"></h2><div id="detail"></div></dialog><script type="module">const data=${data};const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');const paths=data.map(r=>r.ok?(${path.toString()})(r.points,20,20,560,370):'');function draw(){document.querySelector('#cards').innerHTML=data.map((r,i)=>{if(document.querySelector('#family').value!=='all'&&r.recipe.family!==document.querySelector('#family').value||document.querySelector('#relief').value!=='all'&&r.recipe.relief!==document.querySelector('#relief').value)return '';return '<button class="card" data-index="'+i+'"><small>'+r.recipe.family+' / '+r.recipe.relief+'</small>'+(r.ok?'<svg viewBox="0 0 600 410"><path d="'+paths[i]+'" fill="none" stroke="'+(r.design.mode==='anchors'?'#a6d0d6':'#d9ed9a')+'" stroke-width="3"/></svg>':'<p>GENERATION FAILED</p>')+'<strong>'+esc(r.recipe.seed)+'</strong><small>'+r.recipe.character+' · '+r.recipe.targetLength/1000+' km'+(r.ok?' · '+r.metrics.elevationRange.toFixed(0)+' m relief':'')+'</small></button>';}).join('');}document.querySelectorAll('select').forEach(s=>s.addEventListener('change',draw));document.querySelector('#cards').addEventListener('click',e=>{const b=e.target.closest('[data-index]');if(!b)return;const i=Number(b.dataset.index),r=data[i];document.querySelector('#title').textContent=r.recipe.seed+' / '+r.recipe.family+' / '+r.recipe.relief;document.querySelector('#detail').innerHTML=(r.ok?'<svg viewBox="0 0 600 410"><path d="'+paths[i]+'" fill="none" stroke="#d9ed9a" stroke-width="3"/></svg>':'')+'<pre>'+esc(JSON.stringify({...r,points:undefined},null,2))+'</pre>';document.querySelector('#dialog').showModal();});document.querySelector('#close').addEventListener('click',()=>document.querySelector('#dialog').close());draw();</script></html>`,
);
console.log(
  JSON.stringify({
    report: "docs/research/m4-v2-qualification.json",
    portfolio: "docs/research/m4-v2-portfolio.html",
    cases: portfolio.length,
    codeHash: summary.codeHash,
  }),
);
