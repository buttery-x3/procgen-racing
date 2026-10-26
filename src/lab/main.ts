import "./style.css";
import { BRIEFS } from "../track/design/DesignStudy";
import type { StudyResult } from "../track/design/DesignStudy";
import type { Point } from "../track/design/primitives";
import { naturalHeight } from "../track/Terrain";

interface Entry {
  result: StudyResult;
  comparison: {
    points: Point[];
    length: number;
    fingerprint: string;
    fallback: boolean;
  };
  index: number;
}
const root = document.querySelector<HTMLDivElement>("#design-lab")!;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
root.innerHTML = `<header><a href="/">PR / DYNAMICS LAB</a><span>M4 / DESIGN STUDY 01</span><a href="/">Return to driving ↗</a></header>
<section class="intro"><div><p class="eyebrow">FROM GEOMETRY TO GEOGRAPHY</p><h1>A circuit needs<br>more than a loop<span>.</span></h1><p class="lede">Explore signed corner sequences, folded routes and terrain-aware placement. Compare nine seeded designs with the current generator.</p></div>
<form id="study-form"><label for="study-seed">PORTFOLIO SEED</label><input id="study-seed" value="ridge-104" maxlength="48" required autocomplete="off" spellcheck="false"><button type="submit">Generate portfolio <span>↗</span></button><button id="cancel" type="button" hidden>Cancel search</button><p id="status" role="status" aria-live="polite">Ready.</p></form></section>
<p class="notice"><strong>Research preview.</strong> These layouts are not yet driveable. Geometry screening does not certify elevation, runoff, banking or wheel contact.</p>
<section id="detail" hidden><div class="section-heading"><div><p class="eyebrow" id="brief"></p><h2 id="selected-title"></h2></div><button id="export" type="button">Export study JSON ↓</button></div>
<div class="comparison"><div class="new-map"><canvas id="selected-map" width="1100" height="600" role="img" aria-label="Experimental circuit on seeded terrain"></canvas><div class="map-key"><span>● PROPOSED ROUTE</span><span>┄ ORIGINAL ARC CHAIN</span><span>N ↑</span></div></div><aside><p class="eyebrow">CURRENT M4 / VERSION 1</p><svg id="legacy-map" viewBox="0 0 300 260" role="img" aria-label="Current radial generator comparison"></svg><p id="legacy-caption"></p><p>Each map fits its own bounds. The comparison uses the same seed; v1 caps GP length at 5.2 km.</p><p class="eyebrow">WHAT CHANGES</p><p>Signed corners can double back. Multiple acceleration zones and compound sequences replace the radial perimeter constraint.</p></aside></div>
<div id="metrics" class="metrics"></div><div class="traces"><div><p class="eyebrow">ELEVATION / LIME ROAD ESTIMATE · GREY NATURAL GROUND</p><svg id="height-trace" viewBox="0 0 800 100" role="img" aria-label="Proposed elevation and natural terrain along the lap"></svg></div><div><p class="eyebrow">REFERENCE SPEED / DIAGNOSTIC ESTIMATE</p><svg id="speed-trace" viewBox="0 0 800 100" role="img" aria-label="Estimated speed along the lap"></svg></div></div><p id="assessment" class="notice"></p><details><summary>Search evidence and remaining checks</summary><pre id="evidence"></pre></details></section>
<section class="portfolio"><div class="section-heading"><div><p class="eyebrow">THREE BRIEFS / THREE SEEDS EACH</p><h2>Judge the range.</h2></div><span>Every result shown, including failures.</span></div><div id="cards" class="cards"></div></section>
<footer>Experimental generator <code>m4-study-1</code> · No changes to saved v1 recipes or vehicle tuning.</footer>`;
const node = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id)! as T;
let worker: Worker | undefined, selected: Entry | undefined;
const entries = new Map<number, Entry>();
function project(points: Point[], width: number, height: number, pad = 25) {
  const xs = points.map((p) => p.x),
    zs = points.map((p) => p.z),
    minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minZ = Math.min(...zs),
    maxZ = Math.max(...zs);
  const scale = Math.min(
    (width - pad * 2) / (maxX - minX || 1),
    (height - pad * 2) / (maxZ - minZ || 1),
  );
  const cx = (minX + maxX) / 2,
    cz = (minZ + maxZ) / 2;
  return {
    to: (p: Point) => ({
      x: width / 2 + (p.x - cx) * scale,
      z: height / 2 + (p.z - cz) * scale,
    }),
    from: (x: number, z: number) => ({
      x: (x - width / 2) / scale + cx,
      z: (z - height / 2) / scale + cz,
    }),
  };
}
function svgPath(points: Point[], width: number, height: number) {
  const projection = project(points, width, height);
  return (
    points
      .map((p, i) => {
        const q = projection.to(p);
        return `${i ? "L" : "M"}${q.x.toFixed(1)},${q.z.toFixed(1)}`;
      })
      .join(" ") + "Z"
  );
}
function drawMap(entry: Entry) {
  const canvas = node<HTMLCanvasElement>("selected-map"),
    ctx = canvas.getContext("2d")!;
  const { result } = entry,
    projection = project(result.points, canvas.width, canvas.height, 55),
    terrain = result.definition.site.terrain!;
  const cell = 6;
  for (let z = 0; z < canvas.height; z += cell)
    for (let x = 0; x < canvas.width; x += cell) {
      const p = projection.from(x, z),
        h = naturalHeight(terrain, p.x, p.z),
        normalized = Math.max(
          0,
          Math.min(1, (h - 100) / (terrain.amplitude * 1.8) + 0.5),
        );
      const contour = h / 5 - Math.floor(h / 5) < 0.1;
      ctx.fillStyle = `hsl(${105 - normalized * 35} 14% ${17 + normalized * 16 - (contour ? 4 : 0)}%)`;
      ctx.fillRect(x, z, cell, cell);
    }
  const trace = (
    points: Point[],
    color: string,
    width: number,
    dash: number[] = [],
  ) => {
    ctx.beginPath();
    points.forEach((p, i) => {
      const q = projection.to(p);
      if (i === 0) ctx.moveTo(q.x, q.z);
      else ctx.lineTo(q.x, q.z);
    });
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.setLineDash([]);
  };
  trace(result.points, "#101a16", 11);
  trace(result.proposal, "#e5c69a", 2, [5, 5]);
  trace(result.points, "#d9f68b", 4);
  const start = projection.to(result.points[0]);
  ctx.fillStyle = "#fff";
  ctx.fillRect(start.x - 5, start.z - 5, 10, 10);
  ctx.font = "bold 14px system-ui";
  ctx.fillText("GRID", start.x + 12, start.z - 10);
  // A local terrain scale, independent of map fit and circuit length.
  const a = projection.from(40, 0),
    b = projection.from(160, 0);
  ctx.strokeStyle = "#e1e6d5";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, canvas.height - 25);
  ctx.lineTo(160, canvas.height - 25);
  ctx.stroke();
  ctx.fillText(`${Math.round(b.x - a.x)} m`, 40, canvas.height - 35);
}
function trace(values: number[], low: number, high: number) {
  return [...values, values[0]]
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${((i / values.length) * 800).toFixed(1)},${(90 - ((v - low) / (high - low || 1)) * 75).toFixed(1)}`,
    )
    .join(" ");
}
function select(entry: Entry) {
  selected = entry;
  node("detail").hidden = false;
  const r = entry.result,
    m = r.metrics;
  node("brief").textContent = BRIEFS[r.brief].label;
  node("selected-title").textContent = r.seed;
  drawMap(entry);
  node("legacy-map").innerHTML =
    `<path d="${svgPath(entry.comparison.points, 300, 260)}" fill="none" stroke="#aeb7b2" stroke-width="4"/>`;
  node("legacy-caption").textContent =
    `${(entry.comparison.length / 1000).toFixed(2)} km · ${entry.comparison.fingerprint}${entry.comparison.fallback ? " · fallback" : ""}`;
  const metrics = [
    ["LAP LENGTH", `${(m.length / 1000).toFixed(2)} km`],
    ["DIRECTION CHANGES", String(m.directionChanges)],
    ["STRAIGHTS >150 M", String(m.longStraights)],
    ["MINIMUM RADIUS", `${m.minRadius.toFixed(0)} m`],
    ["HULL OCCUPANCY", `${(m.hullOccupancy * 100).toFixed(0)}%`],
    ["ELEVATION RANGE", `${m.elevationRange.toFixed(0)} m`],
    ["PEAK EST. GRADE", `${(m.maxGrade * 100).toFixed(1)}%`],
    ["CENTRELINE CUT/FILL RMS", `${m.earthworkRms.toFixed(1)} m`],
  ];
  node("metrics").innerHTML = metrics
    .map(
      ([label, value]) =>
        `<div><span>${label}</span><strong>${value}</strong></div>`,
    )
    .join("");
  const ground = r.points.map((p) => p.ground),
    heights = r.points.map((p) => p.y),
    min = Math.min(...ground, ...heights),
    max = Math.max(...ground, ...heights);
  node("height-trace").innerHTML =
    `<path d="${trace(ground, min, max)}" stroke="#82908b"/><path d="${trace(heights, min, max)}" stroke="#d9f68b"/><text x="3" y="12">${max.toFixed(0)} m</text><text x="3" y="99">${min.toFixed(0)} m</text>`;
  node("speed-trace").innerHTML = `<path d="${trace(
    r.points.map((p) => p.speed * 3.6),
    0,
    270,
  )}" stroke="#e6bb82"/><text x="3" y="12">270 km/h</text><text x="3" y="99">0 · lap start → finish</text>`;
  node("assessment").textContent =
    `Plan-view screening passed. ${m.maxGrade > 0.06 ? "Elevation exceeds the current 6% driving envelope; vertical redesign is required." : "Elevation still needs wheel-path crest/compression checks."} Closure ${(m.closureShare * 100).toFixed(0)}% of proposal; estimated road-edge separation ${m.edgeClearance.toFixed(0)} m. Hull occupancy describes folding, not quality.`;
  node("evidence").textContent = JSON.stringify(
    {
      fingerprint: r.fingerprint,
      proposalsTried: r.attempts,
      feasibleProposals: r.feasibleProposals,
      rejections: r.rejections,
      terrainRefinement: {
        before: m.terrainCostBefore,
        after: m.terrainCostAfter,
        maxMoveMetres: m.deformation,
      },
      limitations: r.limitations,
    },
    null,
    2,
  );
  for (const button of node("cards").querySelectorAll("button"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.index === String(entry.index)),
    );
}
function stop() {
  worker?.terminate();
  worker = undefined;
  node("cancel").hidden = true;
}
function generate() {
  stop();
  entries.clear();
  selected = undefined;
  node("detail").hidden = true;
  const seed = node<HTMLInputElement>("study-seed").value.trim();
  if (!seed) {
    node("status").textContent = "Enter a seed first.";
    return;
  }
  node("cards").innerHTML = Array.from(
    { length: 9 },
    (_, i) =>
      `<article id="card-${i}" class="pending">${String(i + 1).padStart(2, "0")} / Waiting for proposal</article>`,
  ).join("");
  node("cancel").hidden = false;
  const job = new Worker(new URL("./study.worker.ts", import.meta.url), {
    type: "module",
  });
  worker = job;
  job.onmessage = (event) => {
    if (worker !== job) return;
    const message = event.data;
    if (message.type === "progress")
      node("status").textContent =
        `${message.index + 1}/9 · Searching ${BRIEFS[message.brief as keyof typeof BRIEFS].label} / ${message.seed}`;
    if (message.type === "result") {
      const entry = message as Entry;
      entries.set(entry.index, entry);
      const r = entry.result;
      const card = node(`card-${entry.index}`);
      card.className = "";
      card.innerHTML = `<button type="button" data-index="${entry.index}" aria-pressed="false"><span class="eyebrow">${BRIEFS[r.brief].label}</span><svg viewBox="0 0 440 240" aria-hidden="true"><path d="${svgPath(r.points, 440, 240)}" fill="none" stroke="currentColor" stroke-width="3"/></svg><strong>${escape(r.seed)}</strong><span>${(r.metrics.length / 1000).toFixed(2)} km · ${r.metrics.longStraights} straights · ${(r.metrics.hullOccupancy * 100).toFixed(0)}% hull</span></button>`;
      if (!selected) select(entry);
    }
    if (message.type === "failure") {
      const card = node(`card-${message.index}`);
      card.className = "failure";
      card.textContent = `${message.brief} / ${message.seed}: ${message.message}`;
    }
    if (message.type === "complete") {
      node("status").textContent =
        `${entries.size}/9 proposals found. Select a layout to inspect it.`;
      stop();
    }
  };
  job.onerror = () => {
    node("status").textContent =
      "The study worker failed. Generate again to retry.";
    stop();
  };
  job.postMessage({ seed });
}
node("study-form").addEventListener("submit", (event) => {
  event.preventDefault();
  generate();
});
node("cancel").addEventListener("click", () => {
  stop();
  node("status").textContent =
    "Search cancelled. Completed proposals remain available.";
  for (const card of root.querySelectorAll(".pending"))
    card.textContent = "Not generated · cancelled";
});
node("cards").addEventListener("click", (event) => {
  const index = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-index]",
  )?.dataset.index;
  if (index !== undefined && entries.has(+index)) select(entries.get(+index)!);
});
node("export").addEventListener("click", () => {
  if (!selected) return;
  const blob = new Blob([JSON.stringify(selected, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `circuit-study-${selected.result.fingerprint}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener("pagehide", stop);
generate();
