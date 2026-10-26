import { EngineVoice } from "../audio/EngineVoice";
import { TyreVoice } from "../audio/TyreVoice";
import { SpatialAudio } from "../audio/SpatialAudio";
import { smoothParam } from "../audio/nodes";
import type { AudioSettings } from "../audio/types";
import { DEFAULT_PRESET, LEGACY_PRESET, FIXTURES, ENGINE_TUNING_KEYS, LEGACY_TYRE_TUNING_KEYS, TONAL_TYRE_TUNING_KEYS,
  fixtureControls, parsePreset,
  type FixtureId, type ManualControls, type PlaygroundPreset, type RouteMode } from "../audio/playground-model";

const element = <T extends HTMLElement>(id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing playground element: ${id}`);
  return found as T;
};
const playButton = element<HTMLButtonElement>("play"), stopButton = element<HTMLButtonElement>("stop");
const status = element<HTMLParagraphElement>("status");
const aButton = element<HTMLButtonElement>("candidate-a"), bButton = element<HTMLButtonElement>("candidate-b");
const fixtureSelect = element<HTMLSelectElement>("fixture"), soloSelect = element<HTMLSelectElement>("solo");
const routeSelect = element<HTMLSelectElement>("route"), wheelSelect = element<HTMLSelectElement>("wheel");
const loopCheckbox = element<HTMLInputElement>("loop");
const savedSelect = element<HTMLSelectElement>("saved-presets");
const presetName = element<HTMLInputElement>("preset-name");
const storageKey = "procgen-racing:audio-playground-presets:v1";
let preset: PlaygroundPreset = structuredClone(DEFAULT_PRESET);
let committed: PlaygroundPreset = structuredClone(DEFAULT_PRESET);
let choice: "a" | "b" = "b";
let graph: Graph | undefined;
let opening = 0;

interface Graph {
  context: AudioContext;
  nodes: AudioNode[];
  engineA: EngineVoice;
  tyreA: TyreVoice;
  engineB: AudioWorkletNode;
  tyreB: AudioWorkletNode;
  spatial: SpatialAudio[];
  dry: GainNode[];
  feeds: GainNode[];
  engineGains: [GainNode, GainNode];
  tyreGains: [GainNode, GainNode];
  surfaceGains: [GainNode, GainNode];
  trim: [GainNode, GainNode];
  gate: [GainNode, GainNode];
  meter: [AnalyserNode, AnalyserNode];
  pcm: Float32Array<ArrayBuffer>;
  startTime: number;
  timer: number;
  meterTimer: number;
  lastRms: [number, number];
}

const settings = (route: RouteMode): AudioSettings => ({
  version: 1, enabled: true, master: 0.6, engine: 0.75, tyres: 1, surface: 0.65,
  output: route === "dry" ? "mono" : route, axleCue: 0.8, width: 0.75, softSqueal: false,
});
const setStatus = (message: string) => { status.textContent = message; };
const gain = (context: AudioContext, nodes: AudioNode[], value = 1): GainNode => {
  const node = context.createGain(); node.gain.value = value; nodes.push(node); return node;
};
const range = (parent: HTMLElement, label: string, key: string, min: number, max: number, step: number, value: number, change: (v: number) => void) => {
  const row = document.createElement("label"); row.className = "slider";
  const title = document.createElement("span"); title.textContent = label;
  const input = document.createElement("input"); input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value); input.id = `control-${key}`;
  const output = document.createElement("output"); output.htmlFor = input.id; output.textContent = String(value);
  input.addEventListener("input", () => { const v = Number(input.value); output.textContent = String(v); change(v); });
  row.append(title, input, output); parent.append(row);
};

for (const [id, definition] of Object.entries(FIXTURES)) {
  const option = document.createElement("option"); option.value = id; option.textContent = definition.label;
  fixtureSelect.append(option);
}
const engineLabels: Record<string, string> = { body: "Body / low rumble", openness: "Exhaust openness", rasp: "Exhaust rasp", unevenness: "Pulse unevenness", mechanical: "Intake / mechanical" };
const legacyTyreLabels: Record<string, string> = { scrape: "Broad scrape", screech: "Modal resonance", roughness: "Roughness", brightness: "Brightness", onset: "Onset time", release: "Release time" };
const tonalTyreLabels: Record<string, string> = { tone: "Squeal strength", edge: "Harmonic edge", pitch: "Pitch character", roughness: "Irregular roughness", scrape: "Optional scrape", onset: "Onset time", release: "Release time" };
function renderTuningControls(): void {
  const engine = element("engine-controls"), tyre = element("tyre-controls");
  engine.replaceChildren(); tyre.replaceChildren();
  const legacy = preset.backend === "pulse-exhaust-friction-v1";
  const tuning = preset.tuning as unknown as Record<string, number>;
  for (const key of ENGINE_TUNING_KEYS) {
    range(engine, engineLabels[key], key, 0, 1, 0.01, tuning[key], (v) => {
      (preset.tuning as unknown as Record<string, number>)[key] = v;
      graph?.engineB.port.postMessage({ type: "tuning", value: preset.tuning });
    });
  }
  for (const key of legacy ? LEGACY_TYRE_TUNING_KEYS : TONAL_TYRE_TUNING_KEYS) {
    range(tyre, (legacy ? legacyTyreLabels : tonalTyreLabels)[key], key, 0, 1, 0.01, tuning[key], (v) => {
      (preset.tuning as unknown as Record<string, number>)[key] = v;
      graph?.tyreB.port.postMessage({ type: "tuning", value: preset.tuning });
    });
  }
  element("tyre-description").textContent = legacy
    ? "First prototype: broadband scrape and noise-excited resonances. Kept for saved preset comparisons."
    : "A sustained tonal squeal with a rough harmonic edge. Scrape starts at zero and can be added separately.";
  bButton.textContent = legacy ? "B · First tyre prototype" : "B · Tonal squeal";
  element("meter-b-label").textContent = legacy ? "B · first" : "B · tonal";
}
const manualControls: { key: keyof ManualControls; label: string; min: number; max: number; step: number }[] = [
  { key: "rpm", label: "RPM", min: 700, max: 7500, step: 25 },
  { key: "load", label: "Engine load", min: 0, max: 1, step: 0.01 },
  { key: "slip", label: "Tyre slip", min: 0, max: 1, step: 0.01 },
  { key: "slipSpeed", label: "Sliding speed", min: 0, max: 30, step: 0.1 },
  { key: "wheelLoad", label: "Wheel load", min: 0, max: 1, step: 0.01 },
];
for (const item of manualControls) range(element("manual-controls"), item.label, item.key, item.min, item.max, item.step, preset.manual[item.key], (v) => { preset.manual[item.key] = v; tick(); });
range(element("trim-controls"), "A trim", "aTrim", 0.25, 4, 0.01, preset.aTrim, (v) => { preset.aTrim = v; applyMix(); });
range(element("trim-controls"), "B trim", "bTrim", 0.25, 4, 0.01, preset.bTrim, (v) => { preset.bTrim = v; applyMix(); });

function syncRange(key: string, value: number): void {
  const input = element<HTMLInputElement>(`control-${key}`); input.value = String(value);
  const output = input.nextElementSibling; if (output) output.textContent = String(value);
}
function syncForm(): void {
  fixtureSelect.value = preset.fixture; soloSelect.value = preset.solo; routeSelect.value = preset.route; wheelSelect.value = preset.wheel;
  presetName.value = preset.name;
  syncManualAvailability();
  renderTuningControls();
  for (const item of manualControls) syncRange(item.key, preset.manual[item.key]);
  syncRange("aTrim", preset.aTrim); syncRange("bTrim", preset.bTrim);
  graph?.engineB.port.postMessage({ type: "tuning", value: preset.tuning });
  graph?.tyreB.port.postMessage({ type: "tuning", value: preset.tuning });
  applyMix(); applyRoute();
}

function syncManualAvailability(): void {
  const active = preset.fixture === "manual";
  const container = element("manual-controls");
  container.classList.toggle("inactive", !active);
  for (const input of container.querySelectorAll("input")) input.disabled = !active;
}

function applyRoute(): void {
  const g = graph; if (!g) return;
  const dry = preset.route === "dry";
  for (const node of g.dry) smoothParam(node.gain, dry ? 1 : 0, g.context.currentTime, 0.012);
  for (const node of g.feeds) smoothParam(node.gain, dry ? 0 : 1, g.context.currentTime, 0.012);
  for (const spatial of g.spatial) spatial.configure(settings(preset.route));
}

function applyMix(): void {
  aButton.classList.toggle("selected", choice === "a"); bButton.classList.toggle("selected", choice === "b");
  aButton.setAttribute("aria-pressed", String(choice === "a")); bButton.setAttribute("aria-pressed", String(choice === "b"));
  const g = graph; if (!g) return;
  const at = g.context.currentTime;
  const kind = FIXTURES[preset.fixture].kind;
  const engine = preset.solo === "engine" || preset.solo === "mix";
  const tyre = preset.solo === "tyre" || preset.solo === "mix";
  const surface = preset.solo === "surface" || preset.solo === "mix";
  const supportsEngine = kind !== "tyre" || preset.fixture === "manual";
  const supportsTyre = kind !== "engine" || preset.fixture === "manual";
  for (const n of g.engineGains) smoothParam(n.gain, engine && supportsEngine ? 1 : 0, at, 0.02);
  for (const n of g.tyreGains) smoothParam(n.gain, tyre && supportsTyre ? 1 : 0, at, 0.02);
  for (const n of g.surfaceGains) smoothParam(n.gain, surface && supportsTyre ? 1 : 0, at, 0.02);
  smoothParam(g.trim[0].gain, preset.aTrim, at, 0.02);
  smoothParam(g.trim[1].gain, preset.bTrim, at, 0.02);
  smoothParam(g.gate[0].gain, choice === "a" ? 1 : 0, at, 0.06);
  smoothParam(g.gate[1].gain, choice === "b" ? 1 : 0, at, 0.06);
}

async function start(): Promise<void> {
  stop();
  const generation = ++opening;
  playButton.disabled = true; setStatus("Opening the audition voices…");
  let context: AudioContext | undefined;
  try {
    context = new AudioContext({ latencyHint: "interactive" });
    await context.resume();
    await context.audioWorklet.addModule("/audio/playground-voices.js");
    if (generation !== opening) { await context.close(); return; }
    const nodes: AudioNode[] = [];
    const aBus = gain(context, nodes), bBus = gain(context, nodes);
    const aMeter = context.createAnalyser(), bMeter = context.createAnalyser();
    aMeter.fftSize = bMeter.fftSize = 2048; nodes.push(aMeter, bMeter);
    const aTrim = gain(context, nodes, preset.aTrim), bTrim = gain(context, nodes, preset.bTrim);
    const aGate = gain(context, nodes, 0), bGate = gain(context, nodes, 0);
    const master = gain(context, nodes, 0.55);
    const limiter = context.createDynamicsCompressor(); limiter.threshold.value = -5; limiter.knee.value = 0;
    limiter.ratio.value = 12; limiter.attack.value = 0.002; limiter.release.value = 0.08; nodes.push(limiter);
    aBus.connect(aMeter).connect(aTrim).connect(aGate).connect(master);
    bBus.connect(bMeter).connect(bTrim).connect(bGate).connect(master);
    master.connect(limiter).connect(context.destination);
    const aEngine = gain(context, nodes), aTyre = gain(context, nodes), aSurface = gain(context, nodes);
    const bEngine = gain(context, nodes), bTyre = gain(context, nodes), bSurface = gain(context, nodes);
    aEngine.connect(aBus); bEngine.connect(bBus);
    const spatial: SpatialAudio[] = [], dry: GainNode[] = [], feeds: GainNode[] = [];
    for (const [input, bus] of [[aTyre, aBus], [aSurface, aBus], [bTyre, bBus], [bSurface, bBus]] as const) {
      const direct = gain(context, nodes, 1); input.connect(direct).connect(bus); dry.push(direct);
      const feed = gain(context, nodes, 0); input.connect(feed); feeds.push(feed);
      const route = new SpatialAudio(context, preset.wheel, bus); feed.connect(route.input); spatial.push(route);
    }
    const startTime = context.currentTime;
    const engineA = new EngineVoice(context, aEngine, { id: "deep", cylinders: 8, body: 1.15, brightness: 0.85, irregularity: 0.28, seed: preset.seed }, startTime);
    const tyreA = new TyreVoice(context, preset.wheel, aTyre, aSurface, startTime);
    const engineB = new AudioWorkletNode(context, "playground-pulse-exhaust", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    const tyreProcessor = preset.backend === "pulse-exhaust-tonal-v2" ? "playground-tonal-tyre" : "playground-friction-tyre";
    const tyreB = new AudioWorkletNode(context, tyreProcessor, { numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [1, 1] });
    engineB.connect(bEngine); tyreB.connect(bTyre, 0, 0); tyreB.connect(bSurface, 1, 0); nodes.push(engineB, tyreB);
    const failure = () => { setStatus("The candidate audio processor stopped. Stop and replay to retry."); stop(); };
    engineB.onprocessorerror = failure; tyreB.onprocessorerror = failure;
    engineB.port.postMessage({ type: "reset", seed: preset.seed }); tyreB.port.postMessage({ type: "reset", seed: preset.seed ^ 0x4af18b65 });
    engineB.port.postMessage({ type: "tuning", value: preset.tuning }); tyreB.port.postMessage({ type: "tuning", value: preset.tuning });
    graph = { context, nodes, engineA, tyreA, engineB, tyreB, spatial, dry, feeds,
      engineGains: [aEngine, bEngine], tyreGains: [aTyre, bTyre], surfaceGains: [aSurface, bSurface],
      trim: [aTrim, bTrim], gate: [aGate, bGate], meter: [aMeter, bMeter], pcm: new Float32Array(2048),
      startTime, timer: 0, meterTimer: 0, lastRms: [0, 0] };
    applyRoute(); applyMix(); tick();
    graph.timer = window.setInterval(tick, 25);
    graph.meterTimer = window.setInterval(measure, 100);
    playButton.disabled = false; stopButton.disabled = false;
    setStatus(`Playing ${FIXTURES[preset.fixture].label} · ${choice.toUpperCase()}. Switch A/B at any time.`);
  } catch (error) {
    if (context && context.state !== "closed") void context.close();
    graph = undefined; playButton.disabled = false; stopButton.disabled = true;
    setStatus(`Could not start audio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stop(): void {
  opening++;
  const g = graph; graph = undefined;
  if (g) {
    window.clearInterval(g.timer); window.clearInterval(g.meterTimer);
    g.engineA.dispose(); g.tyreA.dispose();
    for (const route of g.spatial) route.dispose();
    for (const node of g.nodes) { try { node.disconnect(); } catch { /* already disconnected */ } }
    void g.context.close();
  }
  stopButton.disabled = true; playButton.disabled = false;
  for (const id of ["meter-a", "meter-b"]) element<HTMLMeterElement>(id).value = 0;
  element("rms-a").textContent = element("rms-b").textContent = "—";
}

function tick(): void {
  const g = graph; if (!g) return;
  const definition = FIXTURES[preset.fixture];
  let seconds = g.context.currentTime - g.startTime;
  if (seconds >= definition.duration) {
    if (!loopCheckbox.checked) { stop(); setStatus("Example finished. Press Play to hear it again."); return; }
    g.startTime = g.context.currentTime; seconds = 0;
    g.engineB.port.postMessage({ type: "reset", seed: preset.seed });
    g.tyreB.port.postMessage({ type: "reset", seed: preset.seed ^ 0x4af18b65 });
    g.tyreA.reset();
  }
  const controls = fixtureControls(preset.fixture, seconds, preset.manual);
  controls.tyre.id = preset.wheel;
  const time = g.context.currentTime;
  g.engineA.update(controls.engine, time);
  g.tyreA.update(controls.tyre, settings(preset.route), time);
  g.engineB.port.postMessage({ type: "control", value: controls.engine });
  g.tyreB.port.postMessage({ type: "control", value: controls.tyre });
}

function measure(): void {
  const g = graph; if (!g) return;
  g.meter.forEach((analyser, index) => {
    analyser.getFloatTimeDomainData(g.pcm);
    let energy = 0;
    for (const value of g.pcm) {
      if (!Number.isFinite(value)) { setStatus("Non-finite audio sample detected. Playback stopped."); stop(); return; }
      energy += value * value;
    }
    const rms = Math.sqrt(energy / g.pcm.length);
    g.lastRms[index] = rms;
    element<HTMLMeterElement>(index === 0 ? "meter-a" : "meter-b").value = Math.min(0.2, rms);
    element(index === 0 ? "rms-a" : "rms-b").textContent = rms.toFixed(4);
  });
}

function stored(): PlaygroundPreset[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const values: unknown = JSON.parse(raw);
    return Array.isArray(values) ? values.flatMap((item) => { try { return [parsePreset(item)]; } catch { return []; } }).slice(0, 40) : [];
  } catch { return []; }
}
function refreshSaved(): void {
  savedSelect.replaceChildren(new Option("Choose a saved preset", ""));
  for (const item of stored()) savedSelect.add(new Option(item.name, item.name));
}
function persist(items: PlaygroundPreset[]): void {
  localStorage.setItem(storageKey, JSON.stringify(items.slice(-40))); refreshSaved();
}
function saveAs(suggested: string): void {
  try {
    const valid = parsePreset({ ...preset, name: suggested });
    const items = stored().filter((item) => item.name !== valid.name);
    items.push(valid); persist(items); savedSelect.value = valid.name;
    committed = structuredClone(valid); preset = structuredClone(valid);
    presetName.value = valid.name;
    setStatus(`Saved “${valid.name}” in this browser.`);
  } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
}

playButton.addEventListener("click", () => { void start(); });
stopButton.addEventListener("click", () => { stop(); setStatus("Playback stopped."); });
aButton.addEventListener("click", () => { choice = "a"; applyMix(); setStatus("A · original production voice."); });
bButton.addEventListener("click", () => { choice = "b"; applyMix(); setStatus(preset.backend === "pulse-exhaust-tonal-v2" ? "B · tonal tyre and pulse/exhaust engine." : "B · first noise-driven tyre and pulse/exhaust engine."); });
fixtureSelect.addEventListener("change", () => {
  preset.fixture = fixtureSelect.value as FixtureId;
  preset.solo = FIXTURES[preset.fixture].kind === "tyre" ? "tyre" : "engine"; soloSelect.value = preset.solo;
  syncManualAvailability();
  if (graph) void start(); else setStatus(`${FIXTURES[preset.fixture].label} selected. Press Play.`);
});
soloSelect.addEventListener("change", () => { preset.solo = soloSelect.value as PlaygroundPreset["solo"]; applyMix(); });
routeSelect.addEventListener("change", () => { preset.route = routeSelect.value as RouteMode; applyRoute(); });
wheelSelect.addEventListener("change", () => { preset.wheel = wheelSelect.value as PlaygroundPreset["wheel"]; if (graph) void start(); });
element("match-level").addEventListener("click", () => {
  const rms = graph?.lastRms;
  if (!rms || rms[0] < 0.00001 || rms[1] < 0.00001) { setStatus("Play a steady example with an active source before matching level."); return; }
  preset.bTrim = Math.min(4, Math.max(0.25, Math.round(preset.aTrim * rms[0] / rms[1] * 100) / 100));
  syncRange("bTrim", preset.bTrim); applyMix();
  setStatus(`B trim set to ${preset.bTrim.toFixed(2)}. Keep it fixed while comparing load or slip changes.`);
});
element("save-preset").addEventListener("click", () => saveAs(presetName.value));
element("duplicate-preset").addEventListener("click", () => saveAs(`${presetName.value.trim()} copy`));
function loadBuiltIn(builtIn: PlaygroundPreset): void {
  preset = structuredClone(builtIn); committed = structuredClone(builtIn); syncForm();
  if (graph) void start(); else setStatus(`Loaded “${builtIn.name}”. Press Play.`);
}
element("load-tonal-default").addEventListener("click", () => loadBuiltIn(DEFAULT_PRESET));
element("load-first-prototype").addEventListener("click", () => loadBuiltIn(LEGACY_PRESET));
element("load-preset").addEventListener("click", () => {
  const found = stored().find((item) => item.name === savedSelect.value);
  if (!found) { setStatus("Select a saved preset to load."); return; }
  preset = structuredClone(found); committed = structuredClone(found); syncForm();
  if (graph) void start(); else setStatus(`Loaded “${found.name}”.`);
});
element("revert-preset").addEventListener("click", () => { preset = structuredClone(committed); syncForm(); if (graph) void start(); else setStatus("Reverted to the last loaded or saved preset."); });
element("export-preset").addEventListener("click", () => {
  const valid = parsePreset(preset);
  const url = URL.createObjectURL(new Blob([JSON.stringify(valid, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `audio-preset-${valid.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
element("import-preset").addEventListener("click", () => {
  try {
    const input = element<HTMLTextAreaElement>("import-json").value;
    if (input.length > 20_000) throw new Error("Preset JSON is too large.");
    const valid = parsePreset(JSON.parse(input));
    preset = valid; committed = structuredClone(valid); syncForm();
    if (graph) void start(); else setStatus(`Imported “${valid.name}”. Save it to retain it in this browser.`);
  } catch (error) { setStatus(`Import failed: ${error instanceof Error ? error.message : String(error)}`); }
});
document.addEventListener("visibilitychange", () => { if (document.hidden && graph) { stop(); setStatus("Playback stopped because the page is hidden."); } });
window.addEventListener("pagehide", stop);
refreshSaved(); syncForm();
