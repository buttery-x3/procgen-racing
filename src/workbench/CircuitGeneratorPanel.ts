import {
  DEFAULT_DESIGN_RECIPE,
  normalizeRecipe,
} from "../track/generationTypes";
import type {
  GenerationRecipe,
  GenerationResult,
  GenerationProgress,
} from "../track/generationTypes";
import { terrainHeight } from "../track/Terrain";
import { elevationPath, mapProjection } from "./CircuitMap";
import { DEFAULT_VENUE, normalizeVenue } from "../track/venue/types";
import type { VenueSettings } from "../track/venue/types";
import { SURFACES } from "../track/types";
import { FAMILY_PRESETS } from "../track/families/types";
import type { ExpandedFamily } from "../track/families/types";
import { Alignment } from "../track/Alignment";
import { roadPoint } from "../track/SurfaceCompiler";
import {
  circuitArchive,
  decodeCircuitArchive,
  loadLastCircuit,
  saveLastCircuit,
} from "../storage/CircuitStorage";
import type { CircuitArchive } from "../storage/CircuitStorage";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const STORAGE_KEY = "procgen-racing:circuit-recipe:v3";
const PREVIOUS_STORAGE_KEY = "procgen-racing:circuit-recipe:v2";
const VENUE_KEY = "procgen-racing:venue:v1";

export class CircuitGeneratorPanel {
  readonly dialog = document.createElement("dialog");
  private readonly exportDialog = document.createElement("dialog");
  private result?: GenerationResult;
  private busy = false;
  private previewAlignment?: Alignment;
  private readonly abort = new AbortController();
  constructor(
    root: HTMLElement,
    private callbacks: {
      generate: (recipe: GenerationRecipe, archive?: CircuitArchive) => void;
      action: (action: string) => void;
    },
  ) {
    this.dialog.id = "circuit-generator";
    this.dialog.setAttribute("aria-labelledby", "generator-title");
    this.dialog.innerHTML = `<div class="generator-top"><div><span class="eyebrow">CIRCUIT WORKSHOP / M7</span><h2 id="generator-title">A new place to drive<span>.</span></h2></div><button type="button" class="icon-button" data-generator="close" aria-label="Close circuit workshop">×</button></div>
      <div class="generator-layout"><form id="generator-form" class="generator-form">
        <p class="generator-intro">Design a lap through the landscape. Compare routes on the same land, then take your car out.</p>
        <label for="generator-seed">WORLD SEED</label><div class="seed-field"><input id="generator-seed" name="seed" maxlength="64" required spellcheck="false" autocomplete="off"><button type="button" data-generator="shuffle" title="Choose a new seed" aria-label="Shuffle seed">↻</button></div>
        <label for="generator-family">CIRCUIT STYLE</label><select id="generator-family" name="family"><option value="touring">Touring circuit</option><option value="gp">Grand Prix circuit</option><optgroup label="M7 · network & speedway venues">${Object.entries(
          FAMILY_PRESETS,
        )
          .map(([id, p]) => `<option value="${id}">${p.name}</option>`)
          .join("")}</optgroup></select>
        <p id="generator-style-note" class="generator-field-note"></p>
        <label for="generator-relief">LANDSCAPE</label><select id="generator-relief" name="relief"><option value="gentle">Gentle terrain</option><option value="rolling">Rolling hills</option></select>
        <label for="generator-character">CORNER RHYTHM</label><select id="generator-character"><option value="mixed">Mixed circuit</option><option value="flowing">Fast & flowing</option><option value="technical">Technical complexes</option></select>
        <label for="generator-layout">ROUTE ALTERNATIVE · SAME LAND</label><select id="generator-layout"><option value="0">Route A</option><option value="1">Route B</option><option value="2">Route C</option></select>
        <div id="generator-family-controls" class="generator-family-controls" hidden><label for="generator-variant">VENUE LAYOUT</label><select id="generator-variant"><option value="full">Full venue</option><option value="club">Club / infield sprint</option><option value="speedway">Speedway oval</option></select><div id="generator-oval-settings"><label for="generator-oval">SPEEDWAY SHAPE</label><select id="generator-oval"><option value="oval">Oval</option><option value="tri-oval">Tri-oval</option><option value="asymmetric">Asymmetric ends</option></select><label for="generator-banking">LANE BANKING</label><select id="generator-banking"><option value="mild">Progressive · moderate</option><option value="fast">Progressive · high speed</option></select></div><label class="venue-check"><input type="checkbox" id="generator-endurance">Endurance pit facilities</label></div><div class="generator-range-label"><label for="generator-length">LAP LENGTH</label><output id="generator-length-value" for="generator-length"></output></div><input id="generator-length" name="length" type="range" step="100">
        <details class="generator-advanced generator-venue"><summary>Venue & surroundings · M5</summary><label class="venue-check"><input type="checkbox" id="venue-enabled" checked>Build circuit facilities</label><label for="venue-theme">VENUE THEME</label><select id="venue-theme"><option value="club">Club · grass & gravel</option><option value="traditional">Traditional · gravel traps</option><option value="modern">Modern · paved escapes</option><option value="desert">Desert · tarmac & sand</option></select><label for="venue-kerb">KERB PROFILE</label><select id="venue-kerb"><option value="low">Forgiving · 35 mm</option><option value="raised">Raised · 75 mm</option></select><label class="venue-check"><input type="checkbox" id="venue-pits" checked>Pit lane & service access</label><label for="venue-scenery">SCENERY DENSITY</label><select id="venue-scenery"><option value="sparse">Sparse</option><option value="standard">Standard</option><option value="dense">Dense</option></select><label for="venue-seed">SCENERY SEED</label><input id="venue-seed" maxlength="64" spellcheck="false" autocomplete="off"><p class="generator-field-note">Scenery has its own seed. The circuit and collision layout stay fixed when only its surroundings change.</p></details>
        <details class="generator-advanced"><summary>Advanced design settings</summary><label for="generator-envelope">TERRAIN ENVELOPE</label><select id="generator-envelope"><option value="comfortable">Comfortable · grades up to 6%</option><option value="terrain">Terrain challenge · grades up to 10%</option></select><label for="generator-version">GENERATOR VERSION</label><select id="generator-version"><option value="3">V3 · network / oval design</option><option value="2">V2 · circuit design</option><option value="1">V1 · legacy recipes</option></select><p class="generator-field-note">Challenge routes retain tyre-load and crest checks. V1 reproduces the original radial layouts.</p></details>
        <details class="generator-advanced"><summary>Restore / import a circuit</summary><p class="generator-field-note">The last loaded definition and route variant are saved in this browser. JSON keeps the accepted design with its recipe.</p><button type="button" class="button subtle" data-generator="restore">Restore saved circuit</button><label for="generator-file">IMPORT CIRCUIT JSON</label><input id="generator-file" type="file" accept=".json,application/json"><label for="generator-import">OR PASTE CIRCUIT JSON</label><textarea id="generator-import" spellcheck="false" rows="3"></textarea><button type="button" class="button subtle" data-generator="import">Preview imported circuit</button></details><button type="submit" class="button save-button generator-preview-button" id="generator-preview-button">Preview seed <span>↗</span></button>
        <button type="button" class="button subtle" id="generator-cancel-button" data-generator="cancel" hidden>Cancel generation</button>
        <div class="generator-progress"><p id="generator-status" role="status" aria-live="polite">Ready to explore.</p><progress id="generator-progress" max="1" value="0" hidden></progress></div>
        <div class="generator-current"><span class="eyebrow">CURRENT CIRCUIT</span><strong id="generator-active-name">Ridge proving circuit</strong><small>Previewing pauses driving. Your car and setup stay in place until you load a circuit.</small><button type="button" class="generator-authored" data-generator="authored">Load M3 proving circuit ↗</button></div>
      </form><section class="generator-preview" aria-label="Seed preview and validation"><div class="generator-preview-heading"><span class="eyebrow">SITE / LAYOUT PREVIEW</span><span id="generator-fingerprint">VERSION 2</span></div>
        <div class="generator-overlays" aria-label="Map overlays"><label><input type="checkbox" data-overlay="motifs" checked>Sections</label><label><input type="checkbox" data-overlay="speed">Speed</label><label><input type="checkbox" data-overlay="line">Reference line</label><label><input type="checkbox" data-overlay="earthwork">Cut/fill</label><label><input type="checkbox" data-overlay="clearance">Corridors</label><label><input type="checkbox" data-overlay="runoff" checked>Run-off</label><label><input type="checkbox" data-overlay="barriers" checked>Barriers</label><label><input type="checkbox" data-overlay="escapes">Escapes</label><label><input type="checkbox" data-overlay="facilities" checked>Facilities</label><label><input type="checkbox" data-overlay="land">Site survey</label><label><input type="checkbox" data-overlay="network" checked>Road network</label><label><input type="checkbox" data-overlay="properties">Properties</label></div>
        <div class="generator-map-wrap"><canvas id="generator-map" width="1000" height="430" role="img" aria-label="Seeded terrain and circuit layout preview"></canvas><div class="generator-empty" id="generator-empty"><span>01 / FIND YOUR RHYTHM</span><strong>A landscape.<br>A lap to learn.</strong><p>Terrain, corners and elevation, from one repeatable seed.</p></div><div class="generator-map-key"><i></i> TARMAC <i></i> LEVEL PADDOCK <span>N ↑</span></div></div>
        <div class="generator-elevation"><span>ELEVATION</span><svg viewBox="0 0 600 48" role="img" aria-label="Road and natural terrain elevation"><path id="generator-natural-path" style="stroke:#7c8a72"/><path id="generator-elevation-path"/><line x1="0" y1="47" x2="600" y2="47"/></svg><span id="generator-height-range">—</span></div>
        <div class="generator-diagnostics" id="generator-diagnostics" hidden><label for="generator-model">SPEED MODEL</label><select id="generator-model"><option value="touring">Touring / road</option><option value="gt">GT / hypercar</option><option value="prototype">Prototype / open-wheel</option><option value="stock">Oval stock car</option></select><label for="generator-trace">INSPECT ALONG LAP</label><select id="generator-trace"><option value="speed">Reference speed (km/h)</option><option value="grade">Grade (%)</option><option value="bank">Corner banking (degrees)</option><option value="width">Road width (m)</option><option value="curvature">Signed curvature (1/km)</option><option value="cutFill">Centreline cut / fill (m)</option></select><svg viewBox="0 0 600 60" role="img" aria-label="Circuit design diagnostic trace"><path id="generator-trace-path"/><text id="generator-trace-range" x="4" y="12"/></svg></div>
        <section id="generator-cross-section" class="generator-cross-section" hidden><header><span class="eyebrow">ROAD CROSS-SECTION</span><label>Station<input id="generator-cross-station" type="range" min="0" max="1000" value="250" aria-label="Cross-section station"></label></header><svg viewBox="0 0 600 140" role="img" aria-label="Road banking, lanes and apron cross-section"><path id="generator-cross-ground" fill="none" stroke="#cad2b2" stroke-width="3"/><g id="generator-cross-lanes"></g></svg><p id="generator-cross-readout"></p></section><div id="generator-family-evidence" class="generator-family-evidence" hidden></div><div class="generator-metrics" id="generator-metrics"><p>Generate a preview to see circuit dimensions and validation.</p></div>
        <div class="generator-validation" id="generator-validation"></div>
      </section></div>
      <div class="generator-footer"><p id="generator-drive-note">Only a validated preview can be loaded.</p><div><button type="button" class="button subtle" id="generator-copy" data-generator="copy" disabled>Export recipe</button><button type="button" class="button save-button" id="generator-drive" data-generator="drive" disabled>Drive circuit <span>→</span></button></div></div>`;
    this.node("generator-model").insertAdjacentHTML(
      "afterend",
      '<label for="generator-lane">SPEEDWAY LINE</label><select id="generator-lane"><option value="racing">Class racing line</option><option value="low">Stock · low lane</option><option value="middle">Stock · middle lane</option><option value="high">Stock · high lane</option></select>',
    );
    root.append(this.dialog);
    this.exportDialog.className = "generator-export";
    this.exportDialog.setAttribute("aria-labelledby", "generator-export-title");
    this.exportDialog.innerHTML = `<div class="generator-top"><div><span class="eyebrow">CIRCUIT RECIPE</span><h2 id="generator-export-title">Keep this circuit<span>.</span></h2></div><button type="button" class="icon-button" data-export="close" aria-label="Close recipe export">×</button></div><p class="generator-export-intro">The recipe, accepted geometry and validation report travel together. Save the JSON file or select and copy its contents.</p><textarea id="generator-export-json" aria-label="Circuit recipe JSON" readonly spellcheck="false"></textarea><div class="generator-footer"><p id="generator-export-status" role="status" aria-live="polite"></p><div><button type="button" class="button subtle" data-export="copy">Copy JSON</button><button type="button" class="button save-button" data-export="download">Download JSON ↓</button></div></div>`;
    root.append(this.exportDialog);
    let recipe: GenerationRecipe = DEFAULT_DESIGN_RECIPE;
    try {
      const saved = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ??
          localStorage.getItem(PREVIOUS_STORAGE_KEY) ??
          "null",
      );
      if (saved) recipe = normalizeRecipe(saved);
    } catch {
      /* optional browser storage */
    }
    this.field("generator-seed").value = recipe.seed;
    this.field("generator-family").value = recipe.family;
    this.field("generator-relief").value = recipe.relief;
    this.field("generator-version").value = String(recipe.version);
    this.field("generator-character").value =
      recipe.version !== 1 ? recipe.character : "mixed";
    this.field("generator-envelope").value =
      recipe.version !== 1 ? recipe.envelope : "comfortable";
    this.setRouteAlternative(recipe.version !== 1 ? recipe.layout : 0);
    this.field("generator-variant").value =
      recipe.version === 3 ? recipe.variant : "full";
    this.field("generator-oval").value =
      recipe.version === 3 ? recipe.oval : "oval";
    this.field("generator-banking").value =
      recipe.version === 3 ? recipe.banking : "mild";
    this.node<HTMLInputElement>("generator-endurance").checked =
      recipe.version === 3 && recipe.endurance;
    let venue = DEFAULT_VENUE;
    try {
      venue = normalizeVenue(
        JSON.parse(localStorage.getItem(VENUE_KEY) || "{}"),
      );
    } catch {
      /* optional storage */
    }
    this.node<HTMLInputElement>("venue-enabled").checked = venue.enabled;
    this.node<HTMLInputElement>("venue-pits").checked = venue.pits;
    this.field("venue-theme").value = venue.theme;
    this.field("venue-kerb").value = venue.kerb;
    this.field("venue-scenery").value = venue.scenery;
    this.field("venue-seed").value = venue.scenerySeed;
    this.updateFamily(recipe.targetLength);
    const options = { signal: this.abort.signal };
    this.exportDialog.addEventListener(
      "click",
      (event) => {
        const action = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-export]",
        )?.dataset.export;
        const text =
          this.exportDialog.querySelector<HTMLTextAreaElement>("textarea")!;
        const status = this.exportDialog.querySelector<HTMLElement>(
          "#generator-export-status",
        )!;
        if (action === "close") this.exportDialog.close();
        if (action === "copy") {
          text.focus();
          text.select();
          void (async () => {
            try {
              await navigator.clipboard.writeText(text.value);
              status.textContent =
                "JSON copied. The complete export remains selected.";
            } catch {
              status.textContent =
                "Export selected. Press Ctrl+C / Cmd+C, or download the JSON file.";
            }
          })();
        }
        if (action === "download") {
          const url = URL.createObjectURL(
            new Blob([text.value], { type: "application/json" }),
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = `circuit-${(this.result?.fingerprint ?? "recipe").replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          status.textContent = "JSON download prepared.";
        }
      },
      options,
    );
    this.dialog.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        this.generate();
      },
      options,
    );
    this.dialog.addEventListener(
      "input",
      (event) => {
        const field = event.target as HTMLInputElement;
        if (field.id === "generator-file" || field.id === "generator-import")
          return;
        if (field.id === "generator-cross-station") {
          this.drawCrossSection();
          return;
        }
        if (field.dataset.overlay) {
          if (this.result) this.drawMap(this.result);
          return;
        }
        if (
          field.id === "generator-trace" ||
          field.id === "generator-model" ||
          field.id === "generator-lane"
        ) {
          this.drawTrace();
          if (this.result) this.drawMap(this.result);
          return;
        }
        if (field.id === "generator-family") {
          const preset = FAMILY_PRESETS[field.value as ExpandedFamily];
          this.field("generator-version").value = preset
            ? "3"
            : this.field("generator-version").value === "1"
              ? "1"
              : "2";
          this.updateFamily(
            preset?.length ?? (field.value === "gp" ? 4000 : 2400),
          );
        }
        if (field.id === "generator-version") {
          const expanded =
            this.field("generator-family").value in FAMILY_PRESETS;
          if (field.value === "3" && !expanded)
            this.field("generator-family").value = "street";
          if (field.value !== "3" && expanded)
            this.field("generator-family").value = "touring";
          this.updateFamily(Number(this.field("generator-length").value));
        }
        if (field.id === "generator-variant")
          this.updateFamily(Number(this.field("generator-length").value));
        this.updateLength();
        this.invalidate();
      },
      options,
    );
    this.dialog.addEventListener(
      "change",
      (event) => {
        const input = event.target as HTMLInputElement;
        if (input.id === "generator-file" && input.files?.[0])
          void (async () => {
            try {
              if (input.files![0].size > 4_000_000)
                throw new Error("Circuit files must be smaller than 4 MB.");
              this.importArchive(
                decodeCircuitArchive(await input.files![0].text()),
              );
              input.value = "";
            } catch (error) {
              this.error(
                error instanceof Error ? error.message : String(error),
              );
            }
          })();
      },
      options,
    );
    this.dialog.addEventListener(
      "close",
      () => {
        if (this.busy) this.cancel();
      },
      options,
    );
    this.dialog.addEventListener(
      "click",
      (event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-generator]",
        );
        if (!button) return;
        switch (button.dataset.generator) {
          case "close":
            this.dialog.close();
            break;
          case "shuffle":
            this.field("generator-seed").value =
              `ridge-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
            this.invalidate();
            this.generate();
            break;
          case "cancel":
            this.cancel();
            break;
          case "drive":
            if (this.result && this.isCurrent(this.result))
              this.callbacks.action("generator:drive");
            break;
          case "authored":
            this.callbacks.action("generator:authored");
            break;
          case "import":
            try {
              this.importArchive(
                decodeCircuitArchive(
                  this.node<HTMLTextAreaElement>("generator-import").value,
                ),
              );
            } catch (error) {
              this.error(
                error instanceof Error ? error.message : String(error),
              );
            }
            break;
          case "restore":
            void loadLastCircuit()
              .then((archive) => {
                if (!archive)
                  throw new Error("Load a circuit once before restoring it.");
                this.importArchive(archive);
              })
              .catch((error) =>
                this.error(
                  error instanceof Error ? error.message : String(error),
                ),
              );
            break;
          case "copy":
            this.exportRecipe();
            break;
        }
      },
      options,
    );
  }
  private node<T extends HTMLElement = HTMLElement>(id: string) {
    return this.dialog.querySelector<T>(`#${id}`)!;
  }
  private field(id: string) {
    return this.node<HTMLInputElement | HTMLSelectElement>(id);
  }
  private setRouteAlternative(layout: number) {
    const field = this.field("generator-layout") as HTMLSelectElement;
    if (
      layout > 2 &&
      !Array.from(field.options).some((o) => o.value === String(layout))
    )
      field.add(new Option(`Route ${layout + 1}`, String(layout)));
    field.value = String(layout);
  }
  private updateFamily(length: number) {
    const gp = this.field("generator-family").value === "gp",
      field = this.field("generator-length") as HTMLInputElement;
    const kind = this.field("generator-family").value as ExpandedFamily,
      preset = FAMILY_PRESETS[kind],
      expanded = !!preset;
    const legacy = this.field("generator-version").value === "1";
    this.dialog.querySelector('label[for="generator-length"]')!.textContent =
      expanded && this.field("generator-variant").value !== "full"
        ? "FULL VENUE TARGET"
        : "LAP LENGTH";
    this.node("generator-family-controls").hidden = !expanded;
    this.node("generator-oval-settings").hidden =
      !expanded || !["oval", "hybrid"].includes(kind);
    this.field("generator-variant").disabled = kind === "oval";
    for (const id of [
      "generator-character",
      "generator-layout",
      "generator-envelope",
    ])
      this.field(id).disabled = legacy;
    for (const id of [
      "venue-enabled",
      "venue-pits",
      "venue-theme",
      "venue-kerb",
      "venue-scenery",
      "venue-seed",
    ])
      this.field(id).disabled = legacy;
    const speedwayOption = this.dialog.querySelector<HTMLOptionElement>(
      '#generator-variant option[value="speedway"]',
    )!;
    speedwayOption.disabled = kind !== "hybrid";
    if (
      kind === "oval" ||
      (kind !== "hybrid" &&
        this.field("generator-variant").value === "speedway")
    )
      this.field("generator-variant").value = "full";
    this.node<HTMLInputElement>("generator-endurance").disabled =
      kind === "endurance";
    if (kind === "endurance")
      this.node<HTMLInputElement>("generator-endurance").checked = true;
    field.min = expanded
      ? String(preset.min)
      : legacy
        ? gp
          ? "3200"
          : "1800"
        : gp
          ? "4000"
          : "2000";
    field.max = expanded
      ? String(preset.max)
      : legacy
        ? gp
          ? "5200"
          : "3200"
        : gp
          ? "7500"
          : "4500";
    field.value = String(length);
    this.node("generator-style-note").textContent = expanded
      ? `${preset.note}${this.field("generator-variant").value !== "full" ? " Variants reuse the same site; the actual lap length appears after preview." : ""}`
      : gp
        ? "Longer straights, faster sweepers and a wider racing surface."
        : "Compact straights, technical bends and a tighter corner rhythm.";
    this.updateLength();
  }
  private updateLength() {
    this.node("generator-length-value").textContent =
      `${(Number(this.field("generator-length").value) / 1000).toFixed(1)} km`;
  }
  recipe() {
    return normalizeRecipe({
      version: Number(this.field("generator-version").value),
      seed: this.field("generator-seed").value,
      family: this.field("generator-family")
        .value as GenerationRecipe["family"],
      relief: this.field("generator-relief")
        .value as GenerationRecipe["relief"],
      targetLength: Number(this.field("generator-length").value),
      character: this.field("generator-character").value,
      envelope: this.field("generator-envelope").value,
      layout: Number(this.field("generator-layout").value),
      variant: this.field("generator-variant").value,
      oval: this.field("generator-oval").value,
      banking: this.field("generator-banking").value,
      endurance: this.node<HTMLInputElement>("generator-endurance").checked,
    } as GenerationRecipe);
  }
  isCurrent(result: GenerationResult) {
    return (
      !!this.result &&
      JSON.stringify(result.recipe) === JSON.stringify(this.recipe()) &&
      (result.recipe.version === 1 ||
        JSON.stringify(
          result.circuit.definition.venue?.settings ?? {
            ...this.venueSettings(),
            enabled: false,
          },
        ) === JSON.stringify(this.venueSettings())) &&
      this.result.fingerprint === result.fingerprint
    );
  }
  open() {
    this.dialog.showModal();

  }
  close() {
    this.dialog.close();
  }
  setActive(name: string) {
    this.node("generator-active-name").textContent = name;
  }
  private setBusy(busy: boolean) {
    this.busy = busy;
    this.node<HTMLButtonElement>("generator-preview-button").disabled = busy;
    this.node("generator-cancel-button").hidden = !busy;
    this.node("generator-progress").hidden = !busy;
    this.dialog.classList.toggle("generating", busy);
  }
  private invalidate() {
    if (this.busy) this.cancel();
    this.result = undefined;
    this.callbacks.action("generator:invalidate");
    this.node<HTMLButtonElement>("generator-drive").disabled = true;
    this.node<HTMLButtonElement>("generator-copy").disabled = true;
    this.node("generator-status").textContent =
      "Settings changed. Preview this seed to validate it.";
    this.node("generator-drive-note").textContent =
      "The displayed preview is inactive. Generate your new settings.";
    this.dialog.classList.add("preview-stale");
    this.node("generator-fingerprint").textContent = "PREVIEW OUT OF DATE";
  }
  private generate(archive?: CircuitArchive) {
    if (!this.node<HTMLFormElement>("generator-form").reportValidity()) return;
    const recipe = this.recipe();
    this.field("generator-seed").value = recipe.seed;
    this.invalidate();
    this.setBusy(true);
    this.progress({ stage: "Preparing terrain", fraction: 0.01 });
    this.callbacks.generate(recipe, archive);
  }
  private importArchive(archive: CircuitArchive) {
    const recipe = archive.recipe,
      venue = archive.definition.venue?.settings ?? {
        ...DEFAULT_VENUE,
        enabled: false,
      };
    this.field("generator-version").value = String(recipe.version);
    this.field("generator-family").value = recipe.family;
    this.field("generator-seed").value = recipe.seed;
    this.field("generator-relief").value = recipe.relief;
    this.field("generator-character").value =
      recipe.version === 1 ? "mixed" : recipe.character;
    this.field("generator-envelope").value =
      recipe.version === 1 ? "comfortable" : recipe.envelope;
    this.setRouteAlternative(recipe.version === 1 ? 0 : recipe.layout);
    this.field("generator-variant").value =
      recipe.version === 3 ? recipe.variant : "full";
    this.field("generator-oval").value =
      recipe.version === 3 ? recipe.oval : "oval";
    this.field("generator-banking").value =
      recipe.version === 3 ? recipe.banking : "mild";
    this.node<HTMLInputElement>("generator-endurance").checked =
      recipe.version === 3 && recipe.endurance;
    this.node<HTMLInputElement>("venue-enabled").checked = venue.enabled;
    this.node<HTMLInputElement>("venue-pits").checked = venue.pits;
    this.field("venue-theme").value = venue.theme;
    this.field("venue-kerb").value = venue.kerb;
    this.field("venue-scenery").value = venue.scenery;
    this.field("venue-seed").value = venue.scenerySeed;
    this.updateFamily(recipe.targetLength);
    this.generate(archive);
  }
  setSelection(recipe: GenerationRecipe, venue: VenueSettings, result: GenerationResult) {
    this.field("generator-version").value = String(recipe.version);
    this.field("generator-family").value = recipe.family;
    this.field("generator-seed").value = recipe.seed;
    this.field("generator-relief").value = recipe.relief;
    this.field("generator-character").value = recipe.version === 1 ? "mixed" : recipe.character;
    this.field("generator-envelope").value = recipe.version === 1 ? "comfortable" : recipe.envelope;
    this.setRouteAlternative(recipe.version === 1 ? 0 : recipe.layout);
    this.field("generator-variant").value = recipe.version === 3 ? recipe.variant : "full";
    this.field("generator-oval").value = recipe.version === 3 ? recipe.oval : "oval";
    this.field("generator-banking").value = recipe.version === 3 ? recipe.banking : "mild";
    this.node<HTMLInputElement>("generator-endurance").checked = recipe.version === 3 && recipe.endurance;
    this.node<HTMLInputElement>("venue-enabled").checked = venue.enabled;
    this.node<HTMLInputElement>("venue-pits").checked = venue.pits;
    this.field("venue-theme").value = venue.theme;
    this.field("venue-kerb").value = venue.kerb;
    this.field("venue-scenery").value = venue.scenery;
    this.field("venue-seed").value = venue.scenerySeed;
    this.updateFamily(recipe.targetLength);
    this.ready(result);
  }
  private cancel() {
    this.callbacks.action("generator:cancel");
    this.setBusy(false);
    this.node("generator-status").textContent =
      "Generation cancelled. The active circuit is unchanged.";
  }
  progress(value: GenerationProgress) {
    this.node("generator-status").textContent = value.stage;
    this.node<HTMLProgressElement>("generator-progress").value = value.fraction;
  }
  ready(result: GenerationResult) {
    this.result = result;
    this.previewAlignment =
      result.recipe.version === 3
        ? new Alignment(result.circuit.definition)
        : undefined;
    this.setBusy(false);
    this.dialog.classList.remove("preview-stale");
    this.node("generator-empty").hidden = true;
    this.node<HTMLButtonElement>("generator-drive").disabled =
      !result.report.valid;
    this.node<HTMLButtonElement>("generator-copy").disabled = false;
    this.node("generator-status").textContent = result.fallback
      ? "Validated conservative fallback."
      : `Validated · candidate ${result.attempts.length + 1}.`;
    this.node("generator-fingerprint").textContent =
      result.fingerprint.toUpperCase();
    const m = result.report.metrics;
    const metrics = [
      ["LAP LENGTH", `${(result.circuit.distance / 1000).toFixed(2)} km`],
      ["ELEVATION RANGE", `${m.elevationRange.toFixed(1)} m`],
      ["WIDTH", `${m.minWidth.toFixed(1)}–${m.maxWidth.toFixed(0)} m`],
      ["PEAK GRADE", `${(m.maxGrade * 100).toFixed(1)}%`],
      ["MAX BANK", `${((m.maxBank * 180) / Math.PI).toFixed(1)}°`],
      ["TIGHTEST RADIUS", `${m.minRadius.toFixed(0)} m`],
    ];
    this.node("generator-metrics").innerHTML = metrics
      .map(
        ([label, value]) =>
          `<div><span>${label}</span><strong>${value}</strong></div>`,
      )
      .join("");
    this.node("generator-validation").innerHTML =
      `<details open><summary><span class="validation-dot"></span>${result.report.checks.length} checks passed <span>VIEW REPORT</span></summary><ul>${result.report.checks.map((check) => `<li class="${check.status}"><span>✓</span><div><strong>${escape(check.name)}</strong><p>${escape(check.detail)}</p></div></li>`).join("")}</ul></details>${result.attempts.length ? `<details class="generation-attempts"><summary>${result.fallback ? "Conservative fallback used" : "Rejected candidates"} · ${result.attempts.length} attempts</summary><p>${result.fallback ? "The requested seed is retained. Its initial layouts failed validation, so a conservative layout for this family was used on the same seeded terrain." : "The requested seed deterministically tried these candidates before accepting this layout."}</p>${result.attempts.map((attempt) => `<p><strong>Candidate ${attempt.attempt}</strong><br>${attempt.reasons.map(escape).join("<br>")}</p>`).join("")}</details>` : ""}`;
    this.node("generator-height-range").textContent =
      `Δ ${m.elevationRange.toFixed(1)} m`;
    this.node("generator-elevation-path").setAttribute(
      "d",
      elevationPath(result.circuit, 600, 48),
    );
    this.node("generator-drive-note").textContent =
      `${result.recipe.seed} · ${result.recipe.version === 3 ? FAMILY_PRESETS[result.recipe.family].name : result.recipe.family === "gp" ? "Grand Prix" : "Touring"} · ${result.fallback ? "FALLBACK · " : ""}Ready to load. Your vehicle setup will be retained.`;
    this.node("generator-diagnostics").hidden = !result.design;
    const meta = result.circuit.definition.familyDesign;
    this.node("generator-family-evidence").hidden = !meta;
    this.node("generator-cross-section").hidden = !meta;
    const stock = this.dialog.querySelector<HTMLOptionElement>(
      '#generator-model option[value="stock"]',
    )!;
    stock.disabled = !meta;
    if (!meta && this.field("generator-model").value === "stock")
      this.field("generator-model").value = "touring";
    this.drawTrace();
    this.drawMap(result);
    if (meta && result.family) {
      const f = result.family,
        peak = result.design?.diagnostics.reduce((a, b) =>
          Math.abs(a.bank) > Math.abs(b.bank) ? a : b,
        );
      this.field("generator-cross-station").value = String(
        Math.round((peak?.at ?? 0.25) * 1000),
      );
      this.node("generator-family-evidence").innerHTML =
        `<div><span>ROAD PROVENANCE</span><strong>${Math.round(f.inheritedShare * 100)}% inherited / ${100 - Math.round(f.inheritedShare * 100)}% new connector</strong></div><div><span>VENUE LAYOUTS</span><strong>${meta.variants.map((v) => `${escape(v.name)} ${(v.length / 1000).toFixed(2)} km`).join(" · ")}</strong></div><details><summary>Construction & streaming budget</summary><p>${f.networkNodes} graph nodes · ${f.networkEdges} road edges · ${f.junctions} fitted junction spans · branch IDs ${f.branchIds.join(" / ")}</p><p>${f.surfaceChunks} surface tiles · ${(f.transferBytes / 1048576).toFixed(1)} MiB shared geometry buffers · local collision window ${meta.streaming.radius} m with ${meta.streaming.maxSurfaceChunks} surface tiles maximum. The full-venue camera uses a coarse overview.</p><p>Natural terrain is retained independently of the fitted road. Layer 0; no racing overpasses.</p></details>`;
      this.drawCrossSection();
    }
    if (result.design) {
      const d = result.design;
      this.node("generator-validation").insertAdjacentHTML(
        "beforeend",
        `<details><summary>Design evidence · ${escape(d.mode)} route</summary><p>${d.proposalCount} proposals · ${d.feasibleCount} feasible routes · ${d.directionChanges} direction changes · ${d.longStraights} straight spans over 150 m</p>${meta ? "" : `<p>${(d.closureShare * 100).toFixed(0)}% closing section · ${d.fittingDeviation.toFixed(1)} m curve-fit deviation · ${(d.hullOccupancy * 100).toFixed(0)}% hull occupancy</p>`}<p>${d.cutFillRms.toFixed(1)} m centre/corridor cut/fill RMS · ${(d.retainedRelief * 100).toFixed(0)}% natural relief retained. ${result.circuit.definition.venue ? "Run-off and facilities fit the accepted road." : "Facility and escape regions reserve construction space."} Reference speeds are estimates.</p></details>`,
      );
    }
    const venue = result.circuit.definition.venue;
    if (venue)
      this.node("generator-validation").insertAdjacentHTML(
        "beforeend",
        `<details class="venue-evidence"><summary>Venue evidence · ${escape(venue.settings.theme)}</summary><p>${venue.props.filter((p) => p.kind === "tree" || p.kind === "bush").length} vegetation instances · ${venue.props.filter((p) => p.kind === "garage").length} garage blocks · ${venue.props.filter((p) => p.kind === "stand").length} grandstands</p><p>Escape guidance allows 0.5 s reaction, recovery braking on the selected surface and up to 43 km/h remaining at the perimeter. It is a design aid; it does not limit the car’s power.</p><p>${
          venue.fans
            .filter((f) => f.spaceLimited)
            .map(
              (f) =>
                `${Math.round(f.at * 100)}% lap: ${Math.round(f.approachSpeed * 3.6)} → ${Math.round(f.designSpeed * 3.6)} km/h`,
            )
            .join(" · ") || "All approaches fit their estimated speeds."
        }</p>${venue.report.revisions?.map((r) => `<p>Construction revision: ${escape(r)}</p>`).join("") ?? ""}<p>Scenery ${escape(venue.sceneryFingerprint)}. Changing its seed leaves the road and barriers fixed.</p></details>`,
      );
  }
  error(message: string) {
    this.setBusy(false);
    this.result = undefined;
    this.node<HTMLButtonElement>("generator-drive").disabled = true;
    this.node("generator-status").textContent = message;
    this.node("generator-drive-note").textContent =
      "Generation failed. The active circuit is unchanged. Try a different seed or length.";
  }
  rememberRecipe(recipe: GenerationRecipe) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recipe));
      localStorage.setItem(VENUE_KEY, JSON.stringify(this.venueSettings()));
    } catch {
      /* optional */
    }
    if (this.result)
      void saveLastCircuit(circuitArchive(this.result))
        .then(() => {
          this.node("generator-status").textContent =
            "Accepted circuit and active variant saved in this browser.";
        })
        .catch(() => {
          this.node("generator-status").textContent =
            "Browser circuit storage is unavailable. Export JSON to keep this venue.";
        });
  }
  venueSettings(): VenueSettings {
    return normalizeVenue({
      enabled: this.node<HTMLInputElement>("venue-enabled").checked,
      pits: this.node<HTMLInputElement>("venue-pits").checked,
      theme: this.field("venue-theme").value as VenueSettings["theme"],
      kerb: this.field("venue-kerb").value as VenueSettings["kerb"],
      scenery: this.field("venue-scenery").value as VenueSettings["scenery"],
      scenerySeed: this.field("venue-seed").value,
    });
  }
  private exportRecipe() {
    if (!this.result) return;
    const { recipe, fingerprint, report, attempts, fallback, design, circuit } =
      this.result;
    const pretty = JSON.stringify(
      {
        ...circuitArchive(this.result),
        venue: circuit.definition.venue?.settings,
        fingerprint,
        fallback,
        report,
        attempts,
        design,
      },
      null,
      2,
    );
    // A 24 km accepted definition can be several megabytes when indented.
    // Keep our own export inside the same import budget without dropping data.
    this.exportDialog.querySelector<HTMLTextAreaElement>("textarea")!.value =
      pretty.length > 3_800_000 ? JSON.stringify(JSON.parse(pretty)) : pretty;
    this.exportDialog.querySelector<HTMLElement>(
      "#generator-export-status",
    )!.textContent =
      `V${recipe.version} · ${fingerprint.toUpperCase()} · accepted circuit definition included.`;
    this.exportDialog.showModal();
  }
  private drawTrace() {
    const result = this.result;
    if (!result?.design) return;
    const lane = this.field("generator-lane");
    lane.disabled = !(
      result.circuit.definition.familyDesign?.oval &&
      this.field("generator-model").value === "stock"
    );
    if (lane.disabled) lane.value = "racing";
    const data = result.design.diagnostics,
      key = this.field("generator-trace").value as
        | "speed"
        | "grade"
        | "bank"
        | "width"
        | "curvature"
        | "cutFill";
    const factor =
      key === "speed"
        ? 3.6
        : key === "grade"
          ? 100
          : key === "bank"
            ? 180 / Math.PI
            : key === "curvature"
              ? 1000
              : 1;
    const line = result.design.referenceLines?.find(
      (l) =>
        l.vehicle === this.field("generator-model").value &&
        (l.lane ?? "racing") === this.field("generator-lane").value,
    );
    const values =
        key === "speed" && line
          ? line.points.map((p) => p.speed * 3.6)
          : data.map((d) => d[key] * factor),
      min = Math.min(...values),
      max = Math.max(...values);
    const plot = (
      values: number[],
      low: number,
      high: number,
      height: number,
    ) =>
      [...values, values[0]]
        .map(
          (v, i) =>
            `${i ? "L" : "M"}${((i / values.length) * 600).toFixed(2)},${(height - 4 - ((v - low) / Math.max(0.01, high - low)) * (height - 12)).toFixed(2)}`,
        )
        .join(" ");
    this.node("generator-trace-path").setAttribute(
      "d",
      plot(values, min, max, 60),
    );
    this.node("generator-trace-range").textContent =
      `${min.toFixed(1)} → ${max.toFixed(1)}`;
    const ground = data.map((d) => d.natural),
      road = data.map((d) => d.road),
      low = Math.min(...ground, ...road),
      high = Math.max(...ground, ...road);
    this.node("generator-natural-path").setAttribute(
      "d",
      plot(ground, low, high, 48),
    );
    this.node("generator-elevation-path").setAttribute(
      "d",
      plot(road, low, high, 48),
    );
  }
  private drawCrossSection() {
    const path = this.previewAlignment;
    if (!path) return;
    const station =
        (Number(this.field("generator-cross-station").value) / 1000) *
        path.length,
      row = path.sample(station),
      low = -row.rightWidth - 9,
      high = row.leftWidth + 9,
      points = Array.from({ length: 121 }, (_, i) => {
        const lateral = low + ((high - low) * i) / 120;
        return { lateral, y: roadPoint(row, lateral).y - row.position.y };
      }),
      min = Math.min(...points.map((p) => p.y)),
      max = Math.max(...points.map((p) => p.y)),
      x = (l: number) => 30 + ((high - l) / (high - low)) * 540,
      y = (v: number) => 112 - ((v - min) / Math.max(2, max - min)) * 85;
    this.node("generator-cross-ground").setAttribute(
      "d",
      points
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${x(p.lateral).toFixed(1)},${y(p.y).toFixed(1)}`,
        )
        .join(" "),
    );
    const lanes = [
      -row.rightWidth + 0.8,
      -row.rightWidth * 0.5,
      0,
      row.leftWidth * 0.5,
      row.leftWidth - 0.8,
    ];
    const banks = lanes.map(
      (l) =>
        (Math.atan(
          (roadPoint(row, l + 0.05).y - roadPoint(row, l - 0.05).y) / 0.1,
        ) *
          180) /
        Math.PI,
    );
    this.node("generator-cross-lanes").innerHTML =
      lanes
        .map(
          (l, i) =>
            `<circle cx="${x(l)}" cy="${y(roadPoint(row, l).y - row.position.y)}" r="4" fill="#ddedae"/><text x="${x(l)}" y="132" text-anchor="middle" fill="#bdc9b2" font-size="11">${banks[i].toFixed(1)}°</text>`,
        )
        .join("") +
      `<text x="22" y="16" fill="#bdc9b2" font-size="11">LEFT</text><text x="540" y="16" fill="#bdc9b2" font-size="11">RIGHT</text>`;
    this.node("generator-cross-readout").textContent =
      `${(station / 1000).toFixed(2)} km · ${(row.leftWidth + row.rightWidth).toFixed(1)} m racing width · ${row.oval ? "Progressive banking with a blended inner apron" : "Designed crossfall and crown"}. Vertical scale expanded for inspection.`;
  }
  private drawMap(result: GenerationResult) {
    const canvas = this.node<HTMLCanvasElement>("generator-map"),
      ctx = canvas.getContext("2d")!;
    const { width: w, height: h } = canvas,
      circuit = result.circuit,
      projection = mapProjection(circuit, w, h, 65),
      site = circuit.definition.site;
    const centre = site.centre,
      origin = projection.point(centre.x, centre.z),
      scale = projection.scale;
    const overlay = (name: string) =>
      !!this.dialog.querySelector<HTMLInputElement>(`[data-overlay="${name}"]`)
        ?.checked;
    let min = Infinity,
      max = -Infinity;
    for (let y = 0; y < h; y += 12)
      for (let x = 0; x < w; x += 12) {
        const height = terrainHeight(
          site,
          centre.x - (x - origin.x) / scale,
          centre.z - (y - origin.y) / scale,
        );
        min = Math.min(min, height);
        max = Math.max(max, height);
      }
    // Quantised height colours read as topographic bands; subtle gradient shading
    // makes the preview's broad terrain shapes visible at every seed/scale.
    for (let y = 0; y < h; y += 5)
      for (let x = 0; x < w; x += 5) {
        const wx = centre.x - (x - origin.x) / scale,
          wz = centre.z - (y - origin.y) / scale,
          height = terrainHeight(site, wx, wz),
          level =
            Math.floor(((height - min) / Math.max(1, max - min)) * 11) / 11,
          slope = (terrainHeight(site, wx + 8, wz + 8) - height) * 0.45;
        ctx.fillStyle = `hsl(${82 - level * 9} 15% ${30 + level * 24 + slope}%)`;
        ctx.fillRect(x, y, 5, 5);
      }
    ctx.fillStyle = "#1b2b2460";
    ctx.fillRect(0, 0, w, h);
    const network = circuit.definition.familyDesign?.network;
    if (network && overlay("properties"))
      for (const lot of network.lots) {
        const c = Math.cos(lot.heading),
          s = Math.sin(lot.heading);
        ctx.beginPath();
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].forEach(([a, b], i) => {
          const p = projection.point(
            lot.centre.x + (a * c * lot.width) / 2 + (b * s * lot.length) / 2,
            lot.centre.z - (a * s * lot.width) / 2 + (b * c * lot.length) / 2,
          );
          if (i) ctx.lineTo(p.x, p.y);
          else ctx.moveTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.fillStyle =
          lot.use === "exclusion"
            ? "#cfa38228"
            : lot.use === "road-easement"
              ? "#8cb5c320"
              : "#b9c3ab16";
        ctx.fill();
        ctx.strokeStyle = "#bdc6b640";
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    if (network && overlay("network"))
      for (const edge of network.edges) {
        ctx.beginPath();
        edge.points.forEach((p, i) => {
          const q = projection.point(p.x, p.z);
          if (i) ctx.lineTo(q.x, q.y);
          else ctx.moveTo(q.x, q.y);
        });
        ctx.strokeStyle =
          edge.origin === "new-connector"
            ? "#d6a57fb0"
            : edge.origin === "speedway"
              ? "#9ac4c0a0"
              : "#b9c3b778";
        ctx.lineWidth = Math.max(0.8, edge.width * scale);
        ctx.stroke();
      }
    const venue = circuit.definition.venue;
    if (venue && overlay("runoff"))
      for (let i = 0; i < circuit.rows.length - 1; i += 8) {
        const a = circuit.rows[i],
          b = circuit.rows[Math.min(circuit.rows.length - 1, i + 8)];
        for (const side of [1, -1]) {
          const wa = side > 0 ? a.leftWidth : a.rightWidth,
            wb = side > 0 ? b.leftWidth : b.rightWidth,
            ra = side > 0 ? a.runoffLeft! : a.runoffRight!,
            rb = side > 0 ? b.runoffLeft! : b.runoffRight!;
          ctx.beginPath();
          for (const [j, [row, lat]] of [
            [a, side * wa],
            [b, side * wb],
            [b, side * (wb + rb)],
            [a, side * (wa + ra)],
          ].entries()) {
            const r = row as typeof a,
              l = lat as number,
              p = projection.point(
                r.position.x + r.left.x * l,
                r.position.z + r.left.z * l,
              );
            if (j) ctx.lineTo(p.x, p.y);
            else ctx.moveTo(p.x, p.y);
          }
          ctx.closePath();
          const surface = side > 0 ? a.materialLeft! : a.materialRight!;
          ctx.fillStyle = `#${SURFACES[surface].color.toString(16).padStart(6, "0")}d0`;
          ctx.fill();
        }
      }
    const path = () => {
      ctx.beginPath();
      circuit.rows.forEach((row, i) => {
        const p = projection.point(row.position.x, row.position.z);
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      });
      ctx.closePath();
    };
    path();
    ctx.strokeStyle = "#182b25a0";
    ctx.lineWidth = 22;
    ctx.lineJoin = "round";
    ctx.stroke();
    path();
    ctx.strokeStyle = "#c5cdb1";
    ctx.lineWidth = 12;
    ctx.stroke();
    path();
    ctx.strokeStyle = "#34443c";
    ctx.lineWidth = 8;
    ctx.stroke();
    path();
    ctx.strokeStyle = "#a5b58a";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 10]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (venue && overlay("barriers"))
      for (const barrier of venue.barriers) {
        ctx.beginPath();
        barrier.points.forEach((p, i) => {
          const q = projection.point(p.x, p.z);
          if (i) ctx.lineTo(q.x, q.y);
          else ctx.moveTo(q.x, q.y);
        });
        ctx.strokeStyle = barrier.kind === "tyres" ? "#27362b" : "#e6dcc0";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    if (venue && overlay("escapes"))
      for (const fan of venue.fans)
        for (const path of fan.paths) {
          ctx.beginPath();
          path.forEach((p, i) => {
            const q = projection.point(p.x, p.z);
            if (i) ctx.lineTo(q.x, q.y);
            else ctx.moveTo(q.x, q.y);
          });
          ctx.strokeStyle = fan.spaceLimited ? "#e7b987" : "#a5cdbc";
          ctx.lineWidth = 1.2;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
    if (venue && overlay("facilities")) {
      for (const [points, color] of [
        [venue.pit?.points, "#e7cf87"],
        [venue.access?.points, "#a5bec3"],
      ] as const)
        if (points) {
          ctx.beginPath();
          points.forEach((p, i) => {
            const q = projection.point(p.x, p.z);
            if (i) ctx.lineTo(q.x, q.y);
            else ctx.moveTo(q.x, q.y);
          });
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      for (const prop of venue.props.filter(
        (p) =>
          p.kind === "garage" || p.kind === "stand" || p.kind === "marshal",
      )) {
        const p = projection.point(prop.position.x, prop.position.z);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(-prop.heading);
        ctx.fillStyle = prop.kind === "garage" ? "#d4d7b8" : "#94ac9a";
        ctx.fillRect(-5 * scale, -6 * scale, 10 * scale, 12 * scale);
        ctx.restore();
      }
    }
    const design = result.design;
    if (design) {
      const rowAt = (at: number) => {
        const target = at * circuit.length;
        let low = 0,
          high = circuit.rows.length - 1;
        while (high - low > 1) {
          const mid = (low + high) >> 1;
          if (circuit.rows[mid].station < target) low = mid;
          else high = mid;
        }
        return circuit.rows[low];
      };
      const reference = design.referenceLines?.find(
        (l) =>
          l.vehicle === this.field("generator-model").value &&
          (l.lane ?? "racing") === this.field("generator-lane").value,
      );
      if (overlay("line") && reference) {
        ctx.beginPath();
        reference.points.forEach((p, i) => {
          const r = rowAt(p.at),
            q = projection.point(
              r.position.x + r.left.x * p.lateral,
              r.position.z + r.left.z * p.lateral,
            );
          if (i) ctx.lineTo(q.x, q.y);
          else ctx.moveTo(q.x, q.y);
        });
        ctx.closePath();
        ctx.strokeStyle = "#a5d4ef";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (overlay("clearance")) {
        path();
        ctx.strokeStyle = "#e9ba6b30";
        ctx.lineWidth = (result.report.metrics.maxWidth + 20.8) * scale;
        ctx.stroke();
      }
      if (overlay("motifs") || overlay("speed"))
        for (let i = 0; i < design.diagnostics.length; i++) {
          const d = design.diagnostics[i],
            next = design.diagnostics[(i + 1) % design.diagnostics.length],
            a = rowAt(d.at),
            b = rowAt(next.at);
          const pa = projection.point(a.position.x, a.position.z),
            pb = projection.point(b.position.x, b.position.z);
          const motif = design.motifs.reduce(
            (m, c) => (d.at >= c.at ? c : m),
            design.motifs.at(-1)!,
          );
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.strokeStyle = overlay("speed")
            ? `hsl(${15 + Math.min(1, (reference?.points[Math.floor(d.at * reference.points.length)]?.speed ?? d.speed) / 55) * 135} 65% 64%)`
            : (
                {
                  grid: "#e4f3bd",
                  acceleration: "#a6c9cc",
                  hairpin: "#e0ad79",
                  esses: "#c3a3ce",
                  tightening: "#e0c179",
                  chicane: "#e0a39a",
                } as Record<string, string>
              )[motif.role] || "#adca8d";
          ctx.lineWidth = 4;
          ctx.stroke();
        }
      if (overlay("earthwork"))
        for (let i = 0; i < design.diagnostics.length; i += 3) {
          const d = design.diagnostics[i],
            r = rowAt(d.at),
            p = projection.point(r.position.x, r.position.z);
          ctx.beginPath();
          ctx.arc(
            p.x,
            p.y,
            2 + Math.min(6, Math.abs(d.cutFill) * 1.5),
            0,
            Math.PI * 2,
          );
          ctx.fillStyle = d.cutFill > 0 ? "#e3a578b0" : "#8eb9d8b0";
          ctx.fill();
        }
      if (overlay("land"))
        for (const feature of design.siteFeatures) {
          const p = projection.point(feature.x, feature.z);
          ctx.fillStyle = {
            flat: "#d4e9ab",
            ridge: "#d2ac7d",
            valley: "#8ebbd1",
            slope: "#9aa58c",
          }[feature.kind];
          ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
        }
      if (overlay("facilities") && !venue)
        for (const reservation of design.reservations.filter(
          (r) => r.kind !== "paddock",
        )) {
          const { x, z, width, length, heading } = reservation,
            c = Math.cos(heading),
            s = Math.sin(heading);
          ctx.beginPath();
          for (const [i, [a, b]] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].entries()) {
            const p = projection.point(
              x + (a * c * length) / 2 - (b * s * width) / 2,
              z + (a * s * length) / 2 + (b * c * width) / 2,
            );
            if (i) ctx.lineTo(p.x, p.y);
            else ctx.moveTo(p.x, p.y);
          }
          ctx.closePath();
          ctx.fillStyle =
            reservation.kind === "escape" ? "#d8a06d35" : "#cbd6ac30";
          ctx.fill();
          ctx.strokeStyle = "#d8c197";
          ctx.stroke();
        }
    }
    const pad = site.paddock;
    if (pad && overlay("facilities")) {
      const left = { x: pad.forward.z, z: -pad.forward.x };
      ctx.beginPath();
      for (const [i, [a, b]] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].entries()) {
        const p = projection.point(
          pad.centre.x +
            (a * pad.forward.x * pad.length) / 2 +
            (b * left.x * pad.width) / 2,
          pad.centre.z +
            (a * pad.forward.z * pad.length) / 2 +
            (b * left.z * pad.width) / 2,
        );
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = "#cad4b015";
      ctx.fill();
      ctx.strokeStyle = "#d3dfb3";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const start =
        circuit.rows[Math.max(0, Math.floor(circuit.rows.length * 0.012))],
      p = projection.point(start.position.x, start.position.z);
    ctx.fillStyle = "#dae6a8";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#26372a";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "500 17px monospace";
    ctx.fillStyle = "#e4ead2";
    ctx.fillText("START / FINISH", p.x + 17, p.y - 13);
    ctx.font = "14px monospace";
    ctx.fillStyle = "#d6dfc7a0";
    ctx.fillText(
      `${result.recipe.family.toUpperCase()}  /  ${result.recipe.seed}`,
      24,
      34,
    );
    const barMetres = circuit.length > 3500 ? 200 : 100;
    ctx.strokeStyle = "#e1e8d1a0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(25, h - 35);
    ctx.lineTo(25 + barMetres * scale, h - 35);
    ctx.stroke();
    ctx.fillText(`${barMetres} m`, 25, h - 47);
  }
  dispose() {
    this.abort.abort();
    this.exportDialog.remove();
    this.dialog.remove();
  }
}
