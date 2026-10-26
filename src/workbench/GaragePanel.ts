import {
  loadGarage,
  saveGarage,
  createEntry,
  copySetup,
  cleanName,
  decodeGarage,
  exportGarage,
  exportSetup,
} from "../storage/GarageStorage";
import type { Garage, GarageEntry } from "../storage/GarageStorage";
import type { VehicleSetup } from "../vehicle/types";
import { carDerived } from "../vehicle/generateCar";
import { mechanicsFingerprint } from "../vehicle/CarDefinition";
import { SCENARIOS } from "./runComparison";
import type { ComparisonScenario } from "./runComparison";
import {
  TRACE_METRICS,
  tracePlot,
  traceValue,
  loadRuns,
  saveRuns,
} from "./TelemetryTrace";
import type { TraceMetric, TraceRun } from "./TelemetryTrace";
import { escapeHTML as esc, downloadJSON, textError } from "./ui";

export class GaragePanel {
  private dialog: HTMLDialogElement;
  private garage: Garage;
  private persisted: Garage = { version: 1, entries: [] };
  private current!: VehicleSetup;
  private selected = "";
  private runs: TraceRun[] = [];
  private worker?: Worker;
  private timer = 0;
  private abort = new AbortController();
  constructor(
    root: HTMLElement,
    saved: VehicleSetup | null,
    private apply: (setup: VehicleSetup) => void,
  ) {
    this.garage = loadGarage(saved);
    this.persisted = JSON.parse(JSON.stringify(this.garage));
    this.selected = this.garage.entries[0]?.id ?? "";
    this.dialog = document.createElement("dialog");
    this.dialog.id = "garage-dialog";
    this.dialog.className = "m6-dialog garage-dialog";
    this.dialog.setAttribute("aria-labelledby", "garage-title");
    this.dialog.innerHTML = `<header class="m6-dialog-header"><div><span class="eyebrow">GARAGE / SETUPS & COMPARISON</span><h2 id="garage-title">Keep what works.</h2></div><button class="icon-button" data-garage="close" aria-label="Close garage">×</button></header>
    <div class="garage-body"><aside class="garage-library"><span class="eyebrow">SAVED SETUPS</span><div id="garage-entries"></div><label for="garage-name">SETUP NAME</label><input id="garage-name" maxlength="60" placeholder="Weekend setup"/><button class="button save-button" data-garage="save">Save working setup as new</button><div class="garage-row"><button class="button subtle" data-garage="rename">Rename</button><button class="button subtle" data-garage="duplicate">Duplicate</button></div><button class="button subtle" data-garage="replace">Replace selected with working</button><button class="button subtle" data-garage="load">Load selected & reset →</button><details class="m6-details"><summary>Import / export</summary><p>Back up the garage or share one car and setup.</p><button class="button subtle" data-garage="export-one">Export selected</button><button class="button subtle" data-garage="export-all">Export garage</button><label for="garage-file">Import JSON file</label><input id="garage-file" type="file" accept=".json,application/json"/><label for="garage-import">Or paste setup JSON</label><textarea id="garage-import" spellcheck="false" placeholder="Paste a car/setup or garage export"></textarea><button class="button subtle" data-garage="import">Import as new entries</button></details><p class="m6-muted">Up to 24 setups in this browser. Export a backup to keep them outside this browser.</p></aside>
    <section class="garage-comparison"><header><div><span class="eyebrow">A / B · MATCHED CONDITIONS</span><h3>Feel the difference.</h3></div><button class="button subtle" data-garage="cancel" id="comparison-cancel" hidden>Cancel test</button></header><div class="comparison-selectors"><label>A · Reference<select id="comparison-a" aria-label="Comparison A"></select></label><label>B · Candidate<select id="comparison-b" aria-label="Comparison B"></select></label></div><div id="setup-differences" class="setup-differences"></div><div class="comparison-test-controls"><label for="comparison-scenario">REPEATABLE TEST</label><select id="comparison-scenario">${Object.entries(
      SCENARIOS,
    )
      .map(([id, s]) => `<option value="${id}">${s.name}</option>`)
      .join(
        "",
      )}</select><button class="button save-button" data-garage="run" id="comparison-run">Run A / B test ↗</button></div><p id="comparison-conditions" class="m6-muted"></p><progress id="comparison-progress" max="1" value="0" hidden></progress><div id="comparison-metrics" class="comparison-metrics"></div><div class="comparison-chart"><header><span><i class="axis-dot amber"></i>A <i class="axis-dot blue"></i>B</span><select id="comparison-channel" aria-label="Comparison channel">${Object.entries(
      TRACE_METRICS,
    )
      .map(([id, m]) => `<option value="${id}">${m.name} (${m.unit})</option>`)
      .join(
        "",
      )}</select></header><svg viewBox="0 0 760 185" preserveAspectRatio="none" role="img" aria-label="A and B telemetry comparison"><path class="trace-grid" d="M10 20H750M10 92H750M10 165H750"/><path id="comparison-trace-a" class="roll-trace" fill="none"/><path id="comparison-trace-b" class="pitch-trace" fill="none"/><line id="comparison-cursor" y1="15" y2="170" x1="10" x2="10"/></svg><label class="comparison-scrub">Scrub the comparison<input type="range" id="comparison-scrub" min="0" max="1000" value="0"/></label><p id="comparison-readout">Run a test to inspect both recorded responses.</p></div><div class="garage-row"><button class="button subtle" data-garage="save-runs">Save comparison runs</button><button class="button subtle" data-garage="export-runs">Export comparison</button></div><details class="m6-details"><summary>Compare saved recordings</summary><div class="comparison-selectors"><label>Recorded A<select id="recorded-a"></select></label><label>Recorded B<select id="recorded-b"></select></label></div><button class="button subtle" data-garage="load-runs">Overlay selected runs</button><p>Manual runs may have different inputs. Matched tests use the same scripted conditions. Six recent runs are kept within 2 MB; export to archive.</p></details></section></div>
    <footer class="m6-dialog-footer"><p id="garage-status" role="status">Save, compare and export without replacing your working car.</p><span id="garage-capacity"></span></footer>`;
    root.append(this.dialog);
    const opts = { signal: this.abort.signal };
    this.dialog.addEventListener("click", this.click, opts);
    this.dialog.addEventListener("change", this.change, opts);
    this.dialog.addEventListener(
      "input",
      (event) => {
        if ((event.target as HTMLInputElement).id === "comparison-scrub")
          this.draw();
      },
      opts,
    );
    this.dialog.addEventListener("close", () => this.cancel(), opts);
  }
  private node<T extends HTMLElement = HTMLElement>(id: string) {
    return this.dialog.querySelector<T>(`#${id}`)!;
  }
  open(setup: VehicleSetup) {
    if (
      this.current &&
      mechanicsFingerprint(this.current) !== mechanicsFingerprint(setup)
    )
      this.invalidateResults();
    this.current = copySetup(setup);
    this.renderLibrary();
    this.dialog.showModal();
    this.draw();
  }
  private entry(): GarageEntry | undefined {
    return this.garage.entries.find((e) => e.id === this.selected);
  }
  private persist() {
    try {
      saveGarage(this.garage);
    } catch (error) {
      this.garage = JSON.parse(JSON.stringify(this.persisted));
      if (!this.entry()) this.selected = this.garage.entries[0]?.id ?? "";
      this.renderLibrary();
      throw error;
    }
    this.persisted = JSON.parse(JSON.stringify(this.garage));
    this.invalidateResults();
    this.renderLibrary();
  }
  private renderLibrary() {
    this.node("garage-entries").innerHTML =
      this.garage.entries
        .map(
          (e) =>
            `<button class="garage-entry ${e.id === this.selected ? "selected" : ""}" data-entry="${esc(e.id)}"><strong>${esc(e.name)}</strong><small>${esc(e.setup.vehicle?.name ?? e.setup.referenceCar.toUpperCase())} · ${Math.round(e.setup.mass)} kg</small></button>`,
        )
        .join("") || '<p class="m6-muted">Save your first setup here.</p>';
    const beforeA = this.node<HTMLSelectElement>("comparison-a").value,
      beforeB = this.node<HTMLSelectElement>("comparison-b").value;
    const opts =
      '<option value="working">Working setup</option>' +
      this.garage.entries
        .map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`)
        .join("");
    this.node("comparison-a").innerHTML = opts;
    this.node("comparison-b").innerHTML = opts;
    this.node<HTMLSelectElement>("comparison-a").value =
      this.garage.entries.some((e) => e.id === beforeA)
        ? beforeA
        : (this.garage.entries[0]?.id ?? "working");
    this.node<HTMLSelectElement>("comparison-b").value =
      this.garage.entries.some((e) => e.id === beforeB) ? beforeB : "working";
    this.node("garage-capacity").textContent =
      `${this.garage.entries.length} / 24 setups`;
    const runs = loadRuns(),
      options = runs
        .map(
          (r, i) =>
            `<option value="${i}">${esc(r.name)} · ${esc(r.condition.split(" · ")[0])}</option>`,
        )
        .join("");
    this.node("recorded-a").innerHTML = options;
    this.node("recorded-b").innerHTML = options;
    this.node<HTMLSelectElement>("recorded-b").value = String(
      Math.max(0, runs.length - 1),
    );
    this.differences();
  }
  private slot(id: string) {
    const selected = this.node<HTMLSelectElement>(id).value,
      e = this.garage.entries.find((e) => e.id === selected);
    return {
      name: e?.name ?? "Working setup",
      setup: copySetup(e?.setup ?? this.current),
    };
  }
  private differences() {
    const a = this.slot("comparison-a").setup,
      b = this.slot("comparison-b").setup,
      da = carDerived(a),
      db = carDerived(b);
    const rows: [string, string, string][] = [
      [
        "Car",
        a.vehicle?.name ?? a.referenceCar,
        b.vehicle?.name ?? b.referenceCar,
      ],
      [
        "Layout",
        `${a.enginePosition} / ${a.drive.toUpperCase()}`,
        `${b.enginePosition} / ${b.drive.toUpperCase()}`,
      ],
      ["Mass", `${Math.round(a.mass)} kg`, `${Math.round(b.mass)} kg`],
      [
        "Power / tonne",
        `${Math.round(da.powerToWeight)} kW/t`,
        `${Math.round(db.powerToWeight)} kW/t`,
      ],
      [
        "Wheelbase",
        `${a.wheelbase.toFixed(2)} m`,
        `${b.wheelbase.toFixed(2)} m`,
      ],
      [
        "Front weight",
        `${(a.frontWeight * 100).toFixed(1)}%`,
        `${(b.frontWeight * 100).toFixed(1)}%`,
      ],
      [
        "Front / rear springs",
        `${(a.frontSpring / 1000).toFixed(1)} / ${(a.rearSpring / 1000).toFixed(1)} kN/m`,
        `${(b.frontSpring / 1000).toFixed(1)} / ${(b.rearSpring / 1000).toFixed(1)} kN/m`,
      ],
      [
        "Assists TC / ABS / ESC",
        `${a.tractionControl} / ${a.abs} / ${a.stabilityAssist}`,
        `${b.tractionControl} / ${b.abs} / ${b.stabilityAssist}`,
      ],
    ];
    this.node("setup-differences").innerHTML =
      `<table><thead><tr><th>Setup</th><th>A · Reference</th><th>B · Candidate</th></tr></thead><tbody>${rows.map(([name, x, y]) => `<tr class="${x !== y ? "changed" : ""}"><th>${name}</th><td>${esc(x)}</td><td>${esc(y)}</td></tr>`).join("")}</tbody></table><p class="m6-muted">${mechanicsFingerprint(a) === mechanicsFingerprint(b) ? "Both slots have the same mechanics." : "Highlighted rows differ between the two setups."}</p>`;
    this.node("comparison-conditions").textContent =
      SCENARIOS[
        this.node<HTMLSelectElement>("comparison-scenario")
          .value as ComparisonScenario
      ].description +
      ". Both cars start from the same settled spawn. Your driving session is paused while this window is open.";
  }
  private cancel() {
    this.worker?.terminate();
    this.worker = undefined;
    clearTimeout(this.timer);
    this.node<HTMLButtonElement>("comparison-run").disabled = false;
    this.node("comparison-cancel").hidden = true;
    this.node("comparison-progress").hidden = true;
  }
  private invalidateResults() {
    this.cancel();
    this.runs = [];
    this.node("comparison-metrics").innerHTML = "";
    this.node("comparison-readout").textContent =
      "Selection changed. Run a new test for these setups.";
    this.draw();
  }
  private run() {
    this.cancel();
    const a = this.slot("comparison-a"),
      b = this.slot("comparison-b");
    this.worker = new Worker(
      new URL("./comparison.worker.ts", import.meta.url),
      { type: "module" },
    );
    this.node<HTMLButtonElement>("comparison-run").disabled = true;
    this.node("comparison-cancel").hidden = false;
    this.node("comparison-progress").hidden = false;
    this.node<HTMLProgressElement>("comparison-progress").value = 0;
    this.node("garage-status").textContent = "Preparing the two test cars…";
    this.timer = window.setTimeout(() => {
      this.cancel();
      this.node("garage-status").textContent =
        "The comparison exceeded its time budget. Try again or choose another test.";
    }, 60000);
    this.worker.onerror = (e) => {
      this.cancel();
      this.node("garage-status").textContent =
        `Comparison failed: ${e.message}`;
    };
    this.worker.onmessage = (e) => {
      const message = e.data;
      if (message.type === "progress") {
        this.node<HTMLProgressElement>("comparison-progress").value =
          message.value;
        this.node("garage-status").textContent =
          `${message.label} · ${Math.round(message.value * 100)}%`;
        return;
      }
      this.cancel();
      if (message.type === "error") {
        this.node("garage-status").textContent = message.message;
        return;
      }
      this.runs = message.runs;
      this.node("garage-status").textContent =
        "A / B test complete. Both runs use the same spawn, surface, controls and timestep.";
      this.draw();
    };
    this.worker.postMessage({
      a: a.setup,
      b: b.setup,
      nameA: a.name,
      nameB: b.name,
      scenario: this.node<HTMLSelectElement>("comparison-scenario").value,
    });
  }
  private draw() {
    const metric = this.node<HTMLSelectElement>("comparison-channel")
        .value as TraceMetric,
      plot = tracePlot(this.runs, metric),
      cursor =
        this.node<HTMLInputElement>("comparison-scrub").valueAsNumber / 1000;
    this.node("comparison-trace-a").setAttribute("d", plot.paths[0] ?? "");
    this.node("comparison-trace-b").setAttribute("d", plot.paths[1] ?? "");
    this.node("comparison-cursor").setAttribute(
      "x1",
      String(10 + 740 * cursor),
    );
    this.node("comparison-cursor").setAttribute(
      "x2",
      String(10 + 740 * cursor),
    );
    if (this.runs.length) {
      const values = this.runs.map((r) => {
        const s =
          r.samples[
            Math.min(
              r.samples.length - 1,
              Math.round(cursor * (r.samples.length - 1)),
            )
          ];
        return s ? traceValue(s, metric).toFixed(2) : "—";
      });
      this.node("comparison-readout").textContent =
        `t ${(plot.duration * cursor).toFixed(2)} s · A ${values[0]} / B ${values[1] ?? "—"} ${TRACE_METRICS[metric].unit} · ${this.runs[0].condition === this.runs[1]?.condition ? "Same recorded conditions" : "Different conditions; diagnostic overlay"}${this.runs[0].condition.startsWith("Manual") ? " · Manual inputs may differ" : ""}`;
      this.node("comparison-readout").textContent +=
        ` · A: ${this.runs[0].name} / B: ${this.runs[1]?.name ?? "—"}`;
      const rows: [string, (r: TraceRun) => string][] = [
        [
          "0–60 km/h",
          (r) =>
            r.metrics?.zeroTo60 !== null && r.metrics?.zeroTo60 !== undefined
              ? `${r.metrics.zeroTo60.toFixed(2)} s`
              : "Not reached",
        ],
        [
          "Braking distance",
          (r) =>
            r.metrics?.stopDistance !== null &&
            r.metrics?.stopDistance !== undefined
              ? `${r.metrics.stopDistance.toFixed(1)} m`
              : "—",
        ],
        [
          "Peak speed",
          (r) =>
            `${(r.metrics?.maxSpeed ?? Math.max(...r.samples.map((s) => s.speed * 3.6))).toFixed(1)} km/h`,
        ],
        [
          "Peak roll",
          (r) =>
            `${(r.metrics?.peakRoll ?? Math.max(...r.samples.map((s) => Math.abs(s.roll)))).toFixed(2)}°`,
        ],
        [
          "Peak pitch",
          (r) =>
            `${(r.metrics?.peakPitch ?? Math.max(...r.samples.map((s) => Math.abs(s.pitch)))).toFixed(2)}°`,
        ],
      ];
      this.node("comparison-metrics").innerHTML = rows
        .map(
          ([name, value]) =>
            `<div><span>${name}</span><strong>A ${esc(value(this.runs[0]))}</strong><strong>B ${esc(this.runs[1] ? value(this.runs[1]) : "—")}</strong></div>`,
        )
        .join("");
    }
  }
  private import(raw: string) {
    const incoming = decodeGarage(raw);
    if (this.garage.entries.length + incoming.entries.length > 24)
      throw new Error("Import would exceed the 24-setup garage limit.");
    this.garage.entries.push(...incoming.entries);
    this.selected = incoming.entries[0]?.id ?? this.selected;
    this.persist();
    this.node("garage-status").textContent =
      `Imported ${incoming.entries.length} setup(s) as new entries.`;
  }
  private change = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    try {
      if (input.id === "garage-file" && input.files?.[0]) {
        if (input.files[0].size > 2_000_000)
          throw new Error("Setup files must be smaller than 2 MB.");
        this.import(await input.files[0].text());
        input.value = "";
      }
      if (
        ["comparison-a", "comparison-b", "comparison-scenario"].includes(
          input.id,
        )
      ) {
        this.invalidateResults();
        this.differences();
      }
      if (input.id === "comparison-channel") this.draw();
    } catch (error) {
      this.node("garage-status").textContent = textError(error);
    }
  };
  private click = (event: Event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-garage],[data-entry]",
    );
    if (!target) return;
    if (target.dataset.entry) {
      this.selected = target.dataset.entry;
      this.node<HTMLInputElement>("garage-name").value =
        this.entry()?.name ?? "";
      this.renderLibrary();
      return;
    }
    const action = target.dataset.garage;
    try {
      if (action === "close") this.dialog.close();
      if (action === "save") {
        const e = createEntry(
          this.node<HTMLInputElement>("garage-name").value ||
            this.current.vehicle?.name ||
            "Working setup",
          this.current,
        );
        this.garage.entries.push(e);
        this.selected = e.id;
        this.persist();
        this.node("garage-status").textContent =
          "Working setup saved as a new garage entry.";
      }
      if (action === "rename" && this.entry()) {
        this.entry()!.name = cleanName(
          this.node<HTMLInputElement>("garage-name").value,
        );
        this.persist();
      }
      if (action === "duplicate" && this.entry()) {
        const e = createEntry(
          `${this.entry()!.name} copy`,
          this.entry()!.setup,
        );
        this.garage.entries.push(e);
        this.selected = e.id;
        this.persist();
      }
      if (action === "replace" && this.entry()) {
        this.entry()!.setup = copySetup(this.current);
        this.persist();
        this.node("garage-status").textContent =
          "Selected garage entry now contains the working setup.";
      }
      if (action === "load" && this.entry()) {
        this.apply(copySetup(this.entry()!.setup));
        this.dialog.close();
      }
      if (action === "export-one" && this.entry())
        downloadJSON(
          "car-setup.json",
          exportSetup(this.entry()!.name, this.entry()!.setup),
        );
      if (action === "export-all")
        downloadJSON("procgen-garage.json", exportGarage(this.garage));
      if (action === "import")
        this.import(this.node<HTMLTextAreaElement>("garage-import").value);
      if (action === "run") this.run();
      if (action === "cancel") {
        this.cancel();
        this.node("garage-status").textContent =
          "Comparison cancelled. Your working car is retained.";
      }
      if (action === "save-runs") {
        if (!this.runs.length) throw new Error("Run a comparison first.");
        saveRuns([...loadRuns(), ...this.runs]);
        this.renderLibrary();
        this.node("garage-status").textContent =
          "Comparison recordings saved in this browser.";
      }
      if (action === "export-runs") {
        if (!this.runs.length) throw new Error("Run a comparison first.");
        downloadJSON(
          "setup-comparison.json",
          JSON.stringify(
            {
              format: "procgen-racing/comparison",
              version: 1,
              runs: this.runs,
            },
            null,
            2,
          ),
        );
      }
      if (action === "load-runs") {
        const saved = loadRuns(),
          a = saved[Number(this.node<HTMLSelectElement>("recorded-a").value)],
          b = saved[Number(this.node<HTMLSelectElement>("recorded-b").value)];
        if (!a || !b)
          throw new Error("Save recordings before loading an overlay.");
        this.runs = [a, b];
        this.draw();
      }
    } catch (error) {
      this.node("garage-status").textContent = textError(error);
    }
  };
  dispose() {
    this.cancel();
    this.abort.abort();
    this.dialog.remove();
  }
}
