import {
  ARCHETYPES,
  DEFAULT_CAR_RECIPE,
  generateCar,
  carDerived,
  retainCarTuning,
} from "../vehicle/generateCar";
import type { CarResult } from "../vehicle/generateCar";
import {
  mechanicsFingerprint,
  bodyShape,
  resolveCar,
} from "../vehicle/CarDefinition";
import type { BodyShape } from "../vehicle/CarDefinition";
import type { CarPhysicsValidation } from "../vehicle/validateCarPhysics";
import type {
  CarRecipe,
  CarFamily,
  CarDimensions,
} from "../vehicle/CarDefinition";
import type { VehicleSetup } from "../vehicle/types";
import { CarPreview } from "../rendering/CarPreview";
import { copySetup, exportSetup } from "../storage/GarageStorage";
import { escapeHTML as esc, downloadJSON, textError } from "./ui";

export class CarWorkshopPanel {
  private dialog: HTMLDialogElement;
  private recipe: CarRecipe = { ...DEFAULT_CAR_RECIPE };
  private result?: CarResult;
  private preview?: CarPreview;
  private current!: VehicleSetup;
  private locks = { mechanics: false, proportions: false, appearance: false };
  private abort = new AbortController();
  private validationWorker?: Worker;
  private validationId = 0;
  private validationTimer = 0;
  private validationCache = new Map<string, CarPhysicsValidation>();
  constructor(
    root: HTMLElement,
    private apply: (setup: VehicleSetup, rebuild: boolean) => void,
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "m6-dialog car-workshop";
    this.dialog.id = "car-workshop";
    this.dialog.setAttribute("aria-labelledby", "car-workshop-title");
    this.dialog.innerHTML = `<header class="m6-dialog-header"><div><span class="eyebrow">CAR WORKSHOP / M6</span><h2 id="car-workshop-title">Build a character.</h2></div><button class="icon-button" data-car="close" aria-label="Close car workshop">×</button></header>
      <div class="car-workshop-body"><aside class="car-recipe-controls"><p class="m6-intro">Start with a family, shape its proportions, then take it out.</p>
      <label for="car-seed">CAR SEED</label><input id="car-seed" maxlength="64" value="apex-01"/>
      <label for="car-family">VEHICLE FAMILY</label><select id="car-family">${Object.entries(
        ARCHETYPES,
      )
        .map(([id, a]) => `<option value="${id}">${a.name}</option>`)
        .join("")}</select>
      <label for="car-layout">ENGINE / DRIVEN WHEELS</label><select id="car-layout"></select>
      <label for="car-band">PERFORMANCE BAND</label><select id="car-band"><option value="road">Road · forgiving</option><option value="sport">Sport · responsive</option><option value="race">Race · focused</option></select>
      <fieldset class="car-locks"><legend>KEEP WHEN SHUFFLING</legend><label><input type="checkbox" data-lock="mechanics"/>Mass, drivetrain & tuning</label><label><input type="checkbox" data-lock="proportions"/>Dimensions & proportions</label><label><input type="checkbox" data-lock="appearance"/>Paint & trim</label></fieldset>
      <button class="button save-button" data-car="shuffle">Shuffle unlocked ↗</button><button class="button subtle" data-car="generate">Preview this seed</button>
      <details class="m6-details"><summary>Dimensions & packaging</summary><p>Override selected dimensions. Checks update before you apply.</p><div id="car-dimensions"></div><button class="button subtle" data-car="clear-dimensions">Reset dimension overrides</button></details>
      <details class="m6-details"><summary>Appearance & seed streams</summary><label for="car-paint">Body paint</label><input type="color" id="car-paint" value="#e49156"/><label><input type="checkbox" id="car-stripe"/>Accent stripes</label><label><input type="checkbox" id="car-wing"/>Rear wing (visual)</label>${["mechanics", "proportions", "appearance"].map((id) => `<label for="car-${id}-seed">${id.toUpperCase()} SEED</label><input id="car-${id}-seed" maxlength="64"/>`).join("")}</details></aside>
      <section class="car-preview-content"><header><div><span class="eyebrow" id="car-fingerprint">CAR / PREVIEW</span><h3 id="car-preview-name">Procedural car</h3></div><label class="packaging-toggle"><input type="checkbox" id="car-packaging" checked/>Packaging overlay</label></header><div id="car-preview-canvas"></div><div class="car-preview-legend"><span>● Centre of mass</span><span>□ Engine</span><span id="car-axle-dimensions"></span><small>Drag to orbit · scroll to zoom</small></div><div class="car-derived-grid" id="car-derived"></div><div id="car-checks" class="car-checks" aria-live="polite"></div><div class="car-export" id="car-export" hidden><label for="car-export-json">Car & setup JSON</label><textarea id="car-export-json" readonly spellcheck="false"></textarea><button class="button subtle" data-car="download">Download car JSON ↓</button></div></section></div>
      <footer class="m6-dialog-footer"><p id="car-message" role="status">Preview the car, then apply it to your current test.</p><button class="button subtle" data-car="export">Export preview</button><button class="button save-button" data-car="apply" id="car-apply">Apply car & reset →</button></footer>`;
    root.append(this.dialog);
    const opts = { signal: this.abort.signal };
    this.dialog.addEventListener("click", this.click, opts);
    this.dialog.addEventListener("change", this.change, opts);
    this.dialog.addEventListener("input", this.input, opts);
    this.dialog.addEventListener(
      "close",
      () => {
        this.validationId++;
        clearTimeout(this.validationTimer);
        this.validationWorker?.terminate();
        this.validationWorker = undefined;
      },
      opts,
    );
  }
  private node<T extends HTMLElement = HTMLElement>(id: string) {
    return this.dialog.querySelector<T>(`#${id}`)!;
  }
  open(setup: VehicleSetup) {
    this.current = copySetup(setup);
    this.recipe = JSON.parse(
      JSON.stringify(setup.vehicle?.recipe ?? DEFAULT_CAR_RECIPE),
    );
    this.syncControls();
    this.dialog.showModal();
    this.generate(true);
  }
  private syncControls() {
    this.node<HTMLInputElement>("car-seed").value = this.recipe.seed;
    this.node<HTMLSelectElement>("car-family").value = this.recipe.family;
    this.layouts();
    this.node<HTMLSelectElement>("car-band").value = this.recipe.band;
    for (const key of ["mechanics", "proportions", "appearance"] as const)
      this.node<HTMLInputElement>(`car-${key}-seed`).value =
        this.recipe[`${key}Seed`];
  }
  private layouts() {
    this.node("car-layout").innerHTML = ARCHETYPES[this.recipe.family].layouts
      .map(
        (l) =>
          `<option value="${l}" ${l === this.recipe.layout ? "selected" : ""}>${{ FF: "FF · front / front", FR: "FR · front / rear", MR: "MR · mid / rear", RR: "RR · rear / rear", "F-AWD": "Front engine / AWD", "M-AWD": "Mid engine / AWD" }[l]}</option>`,
      )
      .join("");
  }
  private dimensionControls() {
    const d = resolveCar(this.result!.setup).dimensions;
    const fields: [keyof CarDimensions, string, number, number, number][] = [
      ["wheelbase", "Wheelbase", 2.05, 3.45, 0.01],
      ["frontTrack", "Front track", 1.3, 2.1, 0.01],
      ["rearTrack", "Rear track", 1.3, 2.15, 0.01],
      ["bodyWidth", "Body width", 0.5, 2.35, 0.01],
      ["bodyHeight", "Body / cabin height", 0.7, 1.8, 0.01],
      ["wheelRadius", "Wheel radius", 0.25, 0.4, 0.005],
      ["frontTyreWidth", "Front tyre width", 0.16, 0.4, 0.005],
      ["rearTyreWidth", "Rear tyre width", 0.16, 0.44, 0.005],
      ["clearance", "Floor clearance", 0.065, 0.24, 0.005],
      ["frontOverhang", "Front overhang", 0.35, 1.2, 0.01],
      ["rearOverhang", "Rear overhang", 0.35, 1.3, 0.01],
      ["cabinCentre", "Cabin position", -0.8, 0.8, 0.01],
      ["cabinLength", "Cabin length", 0.65, 2.9, 0.01],
    ];
    this.node("car-dimensions").innerHTML = fields
      .map(
        ([id, label, min, max, step]) =>
          `<div class="car-dimension"><label for="car-dimension-${id}">${label}<span>m</span></label><input type="number" id="car-dimension-${id}" data-dimension="${id}" min="${min}" max="${max}" step="${step}" value="${d[id]}"/><input type="range" aria-label="${label}" data-dimension="${id}" min="${min}" max="${max}" step="${step}" value="${d[id]}"/></div>`,
      )
      .join("");
  }
  private shapeControls() {
    const profile =
      this.result?.definition.shape ??
      bodyShape(this.recipe.family, this.recipe.bodyShape);
    this.node("car-dimensions").innerHTML +=
      '<h4 class="eyebrow">BODY SECTIONS</h4>' +
      (
        [
          ["noseWidth", "Nose width", 30, 100, 0.01],
          ["rearWidth", "Rear width", 30, 100, 0.01],
          ["shoulderHeight", "Shoulder height", 0.24, 0.68, 1],
          ["roofWidth", "Roof width", 24, 85, 0.01],
        ] as const
      )
        .map(
          ([key, label, min, max, scale]) =>
            `<div class="car-dimension"><label for="car-shape-${key}">${label}<span>${scale === 1 ? "m" : "%"}</span></label><input id="car-shape-${key}" type="number" data-shape="${key}" min="${min}" max="${max}" step="${scale === 1 ? 0.005 : 1}" value="${Number((profile[key] / scale).toFixed(scale === 1 ? 3 : 0))}"/><input type="range" data-shape="${key}" aria-label="${label}" min="${min}" max="${max}" step="${scale === 1 ? 0.005 : 1}" value="${Number((profile[key] / scale).toFixed(scale === 1 ? 3 : 0))}"/></div>`,
        )
        .join("");
  }
  private generate(dimensions = false) {
    this.dialog.querySelector<HTMLButtonElement>(
      '[data-car="export"]',
    )!.disabled = true;
    try {
      const result = retainCarTuning(generateCar(this.recipe), this.current);
      this.result = result;
      if (!this.preview)
        this.preview = new CarPreview(this.node("car-preview-canvas"));
      this.preview.update(
        result.setup,
        this.node<HTMLInputElement>("car-packaging").checked,
      );
      this.node("car-preview-name").textContent = result.definition.name;
      this.node("car-fingerprint").textContent =
        `${result.fingerprint} · ${result.mechanics}`;
      const d = resolveCar(result.setup).dimensions,
        derived = carDerived(result.setup);
      this.node("car-axle-dimensions").textContent =
        `${d.wheelbase.toFixed(2)} m wheelbase · ${d.frontTrack.toFixed(2)} / ${d.rearTrack.toFixed(2)} m track`;
      this.node("car-derived").innerHTML = [
        ["MASS", `${Math.round(result.setup.mass)} kg`],
        ["POWER", `${Math.round(derived.power)} kW`],
        ["POWER / TONNE", `${Math.round(derived.powerToWeight)} kW/t`],
        [
          "FRONT / REAR",
          `${Math.round(result.setup.frontWeight * 100)} / ${Math.round(100 - result.setup.frontWeight * 100)}%`,
        ],
        [
          "LENGTH × WIDTH",
          `${derived.length.toFixed(2)} × ${d.bodyWidth.toFixed(2)} m`,
        ],
        ["COM ABOVE FLOOR", `${Math.round((derived.com.y + 0.14) * 1000)} mm`],
      ]
        .map(
          ([label, value]) =>
            `<div><span>${label}</span><strong>${value}</strong></div>`,
        )
        .join("");
      this.node("car-checks").innerHTML = result.checks
        .map(
          (c) =>
            `<div class="${c.passed ? "passed" : "failed"}"><strong>${c.passed ? "✓" : "!"} ${c.name}</strong><span>${esc(c.detail)}</span></div>`,
        )
        .join("");
      this.node<HTMLButtonElement>("car-apply").disabled = !result.valid;
      this.dialog.querySelector<HTMLButtonElement>(
        '[data-car="export"]',
      )!.disabled = !result.valid;
      this.node("car-message").textContent = result.valid
        ? "Validated. Apply to rebuild on your selected test; your circuit is retained."
        : "Adjust the highlighted packaging constraints before applying.";
      this.node<HTMLInputElement>("car-paint").value =
        `#${result.definition.appearance.paint.toString(16).padStart(6, "0")}`;
      this.node<HTMLInputElement>("car-stripe").checked =
        result.definition.appearance.stripe;
      this.node<HTMLInputElement>("car-wing").checked =
        result.definition.appearance.wing;
      this.node("car-export").hidden = true;
      if (dimensions) {
        this.dimensionControls();
        this.shapeControls();
      }
      this.validatePhysics(result);
    } catch (error) {
      this.result = undefined;
      this.node("car-message").textContent = textError(error);
      this.node<HTMLButtonElement>("car-apply").disabled = true;
      this.node("car-checks").innerHTML =
        `<div class="failed"><strong>! Preview out of date</strong><span>${esc(textError(error))}</span></div>`;
    }
  }
  private input = (event: Event) => {
    const input = event.target as HTMLInputElement,
      key = input.dataset.dimension as keyof CarDimensions | undefined;
    if (
      input.id === "car-seed" ||
      ["mechanics", "proportions", "appearance"].some(
        (id) => input.id === `car-${id}-seed`,
      )
    ) {
      if (input.id === "car-seed") {
        this.recipe.seed = input.value;
        for (const id of ["mechanics", "proportions", "appearance"] as const)
          if (!this.locks[id]) {
            this.recipe[`${id}Seed`] = input.value;
            this.node<HTMLInputElement>(`car-${id}-seed`).value = input.value;
          }
      } else {
        for (const id of ["mechanics", "proportions", "appearance"] as const)
          if (input.id === `car-${id}-seed`)
            this.recipe[`${id}Seed`] = input.value;
      }
      this.result = undefined;
      this.validationId++;
      clearTimeout(this.validationTimer);
      this.node<HTMLButtonElement>("car-apply").disabled = true;
      this.dialog.querySelector<HTMLButtonElement>(
        '[data-car="export"]',
      )!.disabled = true;
      this.node("car-export").hidden = true;
      this.node("car-message").textContent =
        "Seed changed. Preview this seed to validate the new car.";
      return;
    }
    if ((key || input.dataset.shape) && !Number.isFinite(input.valueAsNumber)) {
      this.result = undefined;
      this.node<HTMLButtonElement>("car-apply").disabled = true;
      this.dialog.querySelector<HTMLButtonElement>(
        '[data-car="export"]',
      )!.disabled = true;
      this.node("car-message").textContent =
        "Enter a finite value before applying this car.";
      return;
    }
    if (input.dataset.shape && Number.isFinite(input.valueAsNumber)) {
      const key = input.dataset.shape as keyof BodyShape,
        scale = key === "shoulderHeight" ? 1 : 0.01;
      this.recipe.bodyShape = {
        ...this.recipe.bodyShape,
        [key]: input.valueAsNumber * scale,
      };
      this.dialog
        .querySelectorAll<HTMLInputElement>(`[data-shape="${key}"]`)
        .forEach((el) => {
          if (el !== input) el.value = input.value;
        });
      this.generate();
      return;
    }
    if (key && Number.isFinite(input.valueAsNumber)) {
      this.recipe.overrides = {
        ...this.recipe.overrides,
        [key]: input.valueAsNumber,
      };
      this.dialog
        .querySelectorAll<HTMLInputElement>(`[data-dimension="${key}"]`)
        .forEach((el) => {
          if (el !== input) el.value = input.value;
        });
      this.generate();
    }
    if (input.id === "car-paint") {
      this.recipe.paint = parseInt(input.value.slice(1), 16);
      this.generate();
    }
  };
  private showPhysics(
    result: CarResult,
    check?: CarPhysicsValidation,
    error?: string,
  ) {
    if (this.result !== result) return;
    const valid = !!check?.valid,
      detail =
        error ??
        check?.detail ??
        "Running a fixed-step launch, brake and equilibrium check…";
    result.checks = result.checks.filter((c) => c.id !== "physics");
    result.checks.push({
      id: "physics",
      name: "Driving & equilibrium",
      passed: valid,
      detail,
    });
    result.valid = result.checks.every((c) => c.passed);
    this.node("car-checks").innerHTML = result.checks
      .map(
        (c) =>
          `<div class="${c.id === "physics" && !check && !error ? "pending" : c.passed ? "passed" : "failed"}"><strong>${c.id === "physics" && !check && !error ? "◌" : c.passed ? "✓" : "!"} ${c.name}</strong><span>${esc(c.detail)}</span></div>`,
      )
      .join("");
    this.node<HTMLButtonElement>("car-apply").disabled = !result.valid;
    this.dialog.querySelector<HTMLButtonElement>(
      '[data-car="export"]',
    )!.disabled = !result.valid;
    this.node("car-apply").textContent =
      mechanicsFingerprint(result.setup) === mechanicsFingerprint(this.current)
        ? "Apply without reset →"
        : "Apply car & reset →";
    this.node("car-message").textContent =
      !check && !error
        ? "Checking the car’s physical response…"
        : result.valid
          ? "Validated in the driving simulator. Apply to your selected test."
          : `Adjust the construction or tune before applying. ${detail}`;
  }
  private validatePhysics(result: CarResult) {
    const id = ++this.validationId;
    clearTimeout(this.validationTimer);
    if (!result.valid) return;
    const key = mechanicsFingerprint(result.setup),
      cached = this.validationCache.get(key);
    if (cached) {
      this.showPhysics(result, cached);
      return;
    }
    this.showPhysics(result);
    this.validationTimer = window.setTimeout(() => {
      if (!this.validationWorker) {
        this.validationWorker = new Worker(
          new URL("../vehicle/carValidation.worker.ts", import.meta.url),
          { type: "module" },
        );
        this.validationWorker.onmessage = (e) => {
          if (e.data.id !== this.validationId || !this.result) return;
          if (e.data.error) {
            this.showPhysics(this.result, undefined, e.data.error);
            return;
          }
          const data = e.data.result as CarPhysicsValidation;
          this.validationCache.set(
            mechanicsFingerprint(this.result.setup),
            data,
          );
          while (this.validationCache.size > 24)
            this.validationCache.delete(
              this.validationCache.keys().next().value!,
            );
          this.showPhysics(this.result, data);
        };
        this.validationWorker.onerror = (e) => {
          if (this.result)
            this.showPhysics(
              this.result,
              undefined,
              `Physical check unavailable: ${e.message}`,
            );
          this.validationWorker?.terminate();
          this.validationWorker = undefined;
        };
      }
      this.validationWorker.postMessage({ id, setup: result.setup });
    }, 160);
  }
  private change = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.dimension || input.dataset.shape) {
      if (!Number.isFinite(input.valueAsNumber)) this.generate(true);
      return;
    }
    if (input.dataset.lock) {
      this.locks[input.dataset.lock as keyof typeof this.locks] = input.checked;
      return;
    }
    if (input.id === "car-family") {
      this.recipe.family = input.value as CarFamily;
      this.recipe.layout = ARCHETYPES[this.recipe.family].layouts[0];
      this.recipe.overrides = undefined;
      this.layouts();
    } else if (input.id === "car-layout")
      this.recipe.layout = input.value as CarRecipe["layout"];
    else if (input.id === "car-band")
      this.recipe.band = input.value as CarRecipe["band"];
    else if (input.id === "car-seed") {
      this.recipe.seed = input.value;
      for (const key of ["mechanics", "proportions", "appearance"] as const)
        if (!this.locks[key]) this.recipe[`${key}Seed`] = input.value;
      this.syncControls();
    } else if (input.id === "car-stripe") this.recipe.stripe = input.checked;
    else if (input.id === "car-wing") this.recipe.wing = input.checked;
    else if (input.id === "car-packaging") {
      if (this.result) this.preview?.update(this.result.setup, input.checked);
      return;
    } else if (input.id.endsWith("-seed")) {
      for (const key of ["mechanics", "proportions", "appearance"] as const)
        if (input.id === `car-${key}-seed`)
          this.recipe[`${key}Seed`] = input.value;
    } else return;
    this.generate(true);
  };
  private click = (event: Event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-car]",
    )?.dataset.car;
    if (action === "close") this.dialog.close();
    if (action === "shuffle") {
      const seed = `${this.recipe.family}-${crypto.randomUUID().slice(0, 8)}`;
      this.recipe.seed = seed;
      for (const key of ["mechanics", "proportions", "appearance"] as const)
        if (!this.locks[key]) this.recipe[`${key}Seed`] = seed;
      if (!this.locks.proportions) this.recipe.overrides = undefined;
      if (!this.locks.proportions) this.recipe.bodyShape = undefined;
      if (!this.locks.appearance) {
        delete this.recipe.paint;
        delete this.recipe.stripe;
        delete this.recipe.wing;
      }
      this.syncControls();
      this.generate(true);
    }
    if (action === "generate") this.generate(true);
    if (action === "clear-dimensions") {
      this.recipe.overrides = undefined;
      this.recipe.bodyShape = undefined;
      this.generate(true);
    }
    if (action === "apply" && this.result?.valid) {
      const setup = copySetup(this.result.setup);
      this.apply(
        setup,
        mechanicsFingerprint(setup) !== mechanicsFingerprint(this.current),
      );
      this.dialog.close();
    }
    if (action === "export" && this.result?.valid) {
      this.node<HTMLTextAreaElement>("car-export-json").value =
        this.exportText();
      this.node("car-export").hidden = false;
    }
    if (action === "download" && this.result?.valid)
      downloadJSON(`${this.result.fingerprint}.json`, this.exportText());
  };
  private exportText() {
    if (!this.result) return "";
    const data = JSON.parse(
      exportSetup(this.result.definition.name, this.result.setup),
    );
    data.validation = {
      checks: this.result.checks,
      physics: this.validationCache.get(
        mechanicsFingerprint(this.result.setup),
      ),
    };
    return JSON.stringify(data, null, 2);
  }
  dispose() {
    clearTimeout(this.validationTimer);
    this.validationWorker?.terminate();
    this.abort.abort();
    this.preview?.dispose();
    this.dialog.remove();
  }
}
