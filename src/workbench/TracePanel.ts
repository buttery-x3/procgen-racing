import {
  TraceBuffer,
  TRACE_METRICS,
  traceSample,
  makeTrace,
  tracePlot,
  traceValue,
  loadRuns,
  saveRuns,
} from "./TelemetryTrace";
import type { TraceRun, TraceMetric } from "./TelemetryTrace";
import type { VehicleSetup, VehicleTelemetry } from "../vehicle/types";
import { mechanicsFingerprint } from "../vehicle/CarDefinition";
import { copySetup } from "../storage/GarageStorage";
import { escapeHTML as esc, downloadJSON, textError } from "./ui";

export class TracePanel {
  private buffer = new TraceBuffer();
  private frozen?: TraceRun;
  private setup: VehicleSetup;
  private condition = "Manual / proving circuit";
  private metric: TraceMetric = "speed";
  private cursor = 1;
  private lastTime = -1;
  private abort = new AbortController();
  constructor(
    private root: HTMLElement,
    setup: VehicleSetup,
  ) {
    this.setup = copySetup(setup);
    root.innerHTML = `<header><span class="eyebrow">RESPONSE RECORDER / 120 HZ</span><select aria-label="Trace channel" id="trace-channel">${Object.entries(
      TRACE_METRICS,
    )
      .map(([id, m]) => `<option value="${id}">${m.name} (${m.unit})</option>`)
      .join(
        "",
      )}</select><button class="button subtle" data-trace="freeze">Freeze</button><button class="button subtle" data-trace="save" title="Keep up to six recent recordings within 2 MB. Export for an archive.">Save run</button><button class="button subtle" data-trace="export">Export</button><button class="icon-button" data-trace="close" aria-label="Close response trace">×</button></header><div class="trace-plot"><svg viewBox="0 0 760 185" preserveAspectRatio="none" role="img" aria-label="Recorded telemetry"><path d="M10 20H750M10 92H750M10 165H750" class="trace-grid"/><path id="trace-line" class="roll-trace" fill="none"/><line id="trace-cursor" y1="15" y2="170" x1="750" x2="750"/></svg><span id="trace-axis"></span></div><div class="trace-tools"><label>Scrub<input type="range" id="trace-scrub" min="0" max="1000" value="1000"/></label><input id="trace-name" aria-label="Recording name" placeholder="Name this run" maxlength="60"/><select id="trace-saved" aria-label="Saved recording"><option value="">Saved runs…</option></select><button class="button subtle" data-trace="load">Load run</button></div><p id="trace-readout" role="status">Drive to capture the last 20 seconds. Freeze and scrub without pausing the car.</p>`;
    root.addEventListener("click", this.click, { signal: this.abort.signal });
    root.addEventListener("input", this.input, { signal: this.abort.signal });
    this.savedOptions();
  }
  private node<T extends HTMLElement = HTMLElement>(id: string) {
    return this.root.querySelector<T>(`#${id}`)!;
  }
  setSetup(setup: VehicleSetup) {
    if (mechanicsFingerprint(setup) !== mechanicsFingerprint(this.setup))
      this.clear();
    this.setup = copySetup(setup);
  }
  setContext(setup: VehicleSetup, condition: string) {
    this.clear(); this.setup = copySetup(setup); this.condition = condition;
  }
  get captureSize() { return this.buffer.snapshot().length; }
  setCondition(condition: string) {
    if (condition !== this.condition) this.clear();
    this.condition = condition;
  }
  private clear() {
    this.buffer.clear();
    this.lastTime = -1;
  }
  capture(t: VehicleTelemetry, yaw: number) {
    if (t.time < this.lastTime) this.clear();
    this.lastTime = t.time;
    this.buffer.push(traceSample(t, yaw));
  }
  private active() {
    return (
      this.frozen ??
      makeTrace(
        this.node<HTMLInputElement>("trace-name").value || "Manual run",
        this.setup,
        this.condition,
        this.buffer.snapshot(),
      )
    );
  }
  private savedOptions() {
    const select = this.node("trace-saved");
    select.innerHTML =
      '<option value="">Saved runs…</option>' +
      loadRuns()
        .map((r, i) => `<option value="${i}">${esc(r.name)}</option>`)
        .join("");
  }
  refreshRecordings() {
    this.savedOptions();
  }
  update() {
    if (this.root.hidden) return;
    const run = this.active(),
      plot = tracePlot([run], this.metric);
    this.node("trace-line").setAttribute("d", plot.paths[0] ?? "");
    this.node("trace-axis").textContent =
      `${plot.min.toFixed(1)} – ${plot.max.toFixed(1)} ${TRACE_METRICS[this.metric].unit} · ${plot.duration.toFixed(1)} s`;
    const sample =
      run.samples[
        Math.min(
          run.samples.length - 1,
          Math.round((run.samples.length - 1) * this.cursor),
        )
      ];
    this.node("trace-cursor").setAttribute(
      "x1",
      String(10 + 740 * this.cursor),
    );
    this.node("trace-cursor").setAttribute(
      "x2",
      String(10 + 740 * this.cursor),
    );
    if (sample)
      this.node("trace-readout").textContent =
        `${this.frozen ? "FROZEN" : "LIVE"} · t ${sample.time.toFixed(2)} s · ${traceValue(sample, this.metric).toFixed(2)} ${TRACE_METRICS[this.metric].unit} · ${sample.grounded}/4 contacts · ${run.condition}`;
  }
  private input = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === "trace-channel") this.metric = input.value as TraceMetric;
    if (input.id === "trace-scrub") {
      if (!this.frozen) this.frozen = this.active();
      this.cursor = input.valueAsNumber / 1000;
      this.root.querySelector('[data-trace="freeze"]')!.textContent =
        "Resume live";
    }
    this.update();
  };
  private click = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-trace]",
      ),
      action = button?.dataset.trace;
    if (!action) return;
    try {
      if (action === "close") this.root.hidden = true;
      if (action === "freeze") {
        this.frozen = this.frozen ? undefined : this.active();
        this.cursor = 1;
        this.node<HTMLInputElement>("trace-scrub").value = "1000";
        button!.textContent = this.frozen ? "Resume live" : "Freeze";
      }
      if (action === "save") {
        const run = this.active();
        if (!run.samples.length)
          throw new Error("Drive or run a test before saving a trace.");
        run.name = this.node<HTMLInputElement>("trace-name").value || run.name;
        saveRuns([...loadRuns(), run]);
        this.savedOptions();
        this.node("trace-readout").textContent =
          "Recording saved in this browser.";
        return;
      }
      if (action === "export")
        downloadJSON(
          "telemetry-run.json",
          JSON.stringify(
            { format: "procgen-racing/run", ...this.active() },
            null,
            2,
          ),
        );
      if (action === "load") {
        const index = Number(this.node<HTMLSelectElement>("trace-saved").value);
        if (this.node<HTMLSelectElement>("trace-saved").value !== "")
          this.frozen = loadRuns()[index];
        this.cursor = 1;
        this.root.querySelector('[data-trace="freeze"]')!.textContent =
          "Resume live";
      }
      this.update();
    } catch (error) {
      this.node("trace-readout").textContent = textError(error);
    }
  };
  dispose() {
    this.abort.abort();
  }
}
