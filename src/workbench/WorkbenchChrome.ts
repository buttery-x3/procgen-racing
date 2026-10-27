import { CATEGORIES, categoryName } from "../exploration/catalog";
import type { Category } from "../exploration/catalog";
import { loadLayout, saveLayout } from "./LayoutState";
import type { LayoutState } from "./LayoutState";

/** Arranges existing live components; never clones measurement DOM or simulation state. */
export class WorkbenchChrome {
  readonly state = loadLayout();
  private abort = new AbortController();
  private observer: ResizeObserver;
  private category?: Category;
  private returnFocus?: HTMLElement;
  constructor(private root: HTMLElement, private inputBoundary: () => void) {
    const node = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
    root.classList.add("workbench-first-pass");
    const brand = root.querySelector<HTMLElement>(".brand")!;
    brand.removeAttribute("data-action"); brand.removeAttribute("href"); brand.setAttribute("aria-label", "Procgen Racing dynamics lab");
    root.querySelectorAll(".tool-rail > [data-action='input-settings'],.header-workshop,.header-right .audio-settings-open,.rail-tools [data-action='home'],.rail-tools [data-action='generator'],.rail-tools [data-action='car-workshop'],.status-controls,.powertrain-hud small").forEach((e) => e.remove());
    const header = document.createElement("div"); header.className = "active-context";
    header.innerHTML = `<details data-ui-menu><summary id="active-car">Car</summary><div class="context-popup"><strong>Vehicle & setup</strong><p id="active-car-detail"></p><button data-action="car-workshop">Car workshop</button><button data-action="load-baseline">Load saved baseline</button><button data-action="garage">Save to garage / compare…</button><p>Reference vehicles remain in Setup.</p></div></details><details data-ui-menu><summary id="active-track">Track</summary><div class="context-popup"><strong>Track & pairing</strong><p id="pairing-detail">Authored proving circuit</p><button data-action="circuit-library">Circuit library</button><button data-action="generator">Circuit workshop</button><button data-action="explore:repeat">Repeat this pairing</button><button data-action="explore:restore">Restore last pairing</button><button data-action="explore:export">Export pairing JSON</button><label>Import pairing JSON<input type="file" id="pairing-import" accept=".json,application/json"/></label></div></details><span id="active-setup-state" role="status"></span>`;
    root.querySelector(".header-title")!.replaceWith(header);
    const rail = root.querySelector<HTMLElement>(".rail-tools")!;
    const settings = document.createElement("button"); settings.className = "rail-button"; settings.dataset.action = "preferences"; settings.textContent = "⚙"; settings.title = "Settings"; settings.setAttribute("aria-label", "Settings"); rail.append(settings);
    const inspector = root.querySelector<HTMLElement>(".inspector")!; inspector.id = "setup-inspector";
    const localToggle = document.createElement("button"); localToggle.className = "icon-button"; localToggle.dataset.layout = "inspector"; localToggle.textContent = "›"; localToggle.title = "Collapse setup"; localToggle.setAttribute("aria-label", "Collapse setup"); inspector.querySelector(".inspector-heading")!.prepend(localToggle);
    const reopen = document.createElement("button"); reopen.className = "setup-reopen button subtle"; reopen.dataset.layout = "inspector"; reopen.textContent = "‹ Setup"; reopen.id = "setup-reopen";
    root.querySelector(".scene-stage")!.append(reopen);
    root.querySelectorAll<HTMLElement>('[data-action="inspector"], [data-action="telemetry"]').forEach((e) => {
      const kind = e.dataset.action === "inspector" ? "inspector" : "recorder";
      delete e.dataset.action; e.dataset.layout = kind;
      if (kind === "recorder") { e.title = "Recordings / response recorder"; e.setAttribute("aria-label", e.title); }
    });
    const instruments = root.querySelector<HTMLElement>(".instruments")!; instruments.id = "live-instruments";
    const collapse = document.createElement("button"); collapse.className = "datum-button"; collapse.dataset.layout = "instruments"; collapse.id = "instruments-toggle"; instruments.querySelector(".instruments-heading")!.prepend(collapse);
    const toolbar = root.querySelector<HTMLElement>(".scene-toolbar")!;
    const experiments = toolbar.querySelector<HTMLElement>(".experiment-selector")!;
    toolbar.replaceChildren(); toolbar.className = "scene-toolbar working-toolbar";
    const left = document.createElement("div"); left.className = "working-left";
    left.innerHTML = `<div class="category-buttons" role="group" aria-label="Exploration category">${CATEGORIES.map((id) => `<button data-action="category:${id}" data-category="${id}" aria-pressed="false">${categoryName(id)}</button>`).join("")}</div><select class="category-select" id="category-select" aria-label="Exploration category"><option value="">Choose category…</option>${CATEGORIES.map((id) => `<option value="${id}">${categoryName(id)}</option>`).join("")}</select><details data-ui-menu><summary title="New pairing">↻</summary><div class="context-popup"><button data-action="explore:new">New pairing</button><button data-action="explore:random">Random category + pairing</button><button data-action="explore:cancel">Cancel preparation</button></div></details><details id="tests-menu" data-ui-menu><summary>Tests</summary><div class="context-popup tests-popup"><strong>Environment</strong><div id="test-environments"></div><button data-action="track:return">Return to selected track</button><div id="circuit-controls"></div><strong>Actions</strong><button data-action="drop">Drop test · 0.6 m</button><button data-action="roll-pulse">Roll pulse</button><button data-action="pitch-pulse">Pitch pulse</button></div></details>`;
    // Move the original select/description, preserving IDs and handlers.
    const original = node("circuit-controls"); // the original precedes the new toolbar contents until appended
    const controls = Array.from(original.children);
    original.remove();
    left.querySelector("#test-environments")!.append(...Array.from(experiments.children));
    const proving = left.querySelector<HTMLElement>('[data-action="experiment:circuit"]')!; proving.textContent = "3D circuit — proving ground";
    const destination = left.querySelector<HTMLElement>("#circuit-controls")!;
    destination.append(...controls);
    destination.querySelectorAll("[data-action]").forEach((e) => e.remove());
    destination.querySelector("#circuit-name")?.remove();
    const trackName = document.createElement("span"); trackName.id = "circuit-name"; trackName.hidden = true; header.append(trackName);
    const right = document.createElement("div"); right.className = "working-right";
    right.innerHTML = `<span id="test-context" hidden>Test</span><button class="icon-button" data-action="reset" title="Reset vehicle" aria-label="Reset vehicle">↺</button><button class="button save-button" data-action="session:trial">Time trial</button><button class="button subtle" data-action="sessions">Records</button>`;
    toolbar.append(left, node("session-strip"), right);
    const overview = document.createElement("button"); overview.className = "view-button"; overview.dataset.action = "camera:overview"; overview.dataset.camera = "overview"; overview.textContent = "Overview"; root.querySelector(".scene-view-controls")!.append(overview);
    root.querySelector(".test-controls")?.remove();
    const options = { signal: this.abort.signal };
    root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const toggle = target.closest<HTMLElement>("[data-layout]");
      if (toggle) this.toggle(toggle.dataset.layout as keyof LayoutState);
      if (target.closest("[data-trace='close']")) { this.state.recorder = false; this.refresh(); }
      if (target.closest("[data-action]")) this.closeMenus();
    }, options);
    root.addEventListener("keydown", (event) => { if (event.key === "Escape") this.closeMenus(true); }, options);
    root.querySelectorAll<HTMLDetailsElement>("[data-ui-menu]").forEach((menu) => {
      menu.addEventListener("toggle", () => {
        menu.querySelector("summary")?.setAttribute("aria-expanded", String(menu.open));
        if (menu.open) {
          this.closeMenus(false, menu); this.returnFocus = menu.querySelector("summary")!;
          this.inputBoundary();
        } else this.inputBoundary();
      }, options);
    });
    document.addEventListener("pointerdown", (event) => { if (!(event.target as Element).closest("[data-ui-menu]")) this.closeMenus(); }, options);
    this.observer = new ResizeObserver(([entry]) => toolbar.classList.toggle("compact-categories", entry.contentRect.width < 1080));
    this.observer.observe(toolbar);
    this.refresh();
  }
  closeMenus(focus = false, except?: HTMLDetailsElement) {
    let closed = false;
    let containedFocus = false;
    this.root.querySelectorAll<HTMLDetailsElement>("[data-ui-menu][open]").forEach((e) => { if (e !== except) { containedFocus ||= e.contains(document.activeElement); e.open = false; closed = true; } });
    if (closed) { this.inputBoundary(); if ((focus || containedFocus) && !this.root.querySelector("dialog[open]")) this.returnFocus?.focus(); }
  }
  toggle(key: keyof LayoutState) { this.state[key] = !this.state[key]; this.refresh(); }
  refresh() {
    const s = this.state;
    const active = document.activeElement as HTMLElement | null;
    this.root.querySelector<HTMLElement>("#setup-reopen")!.hidden = s.inspector;
    if (!s.inspector && active?.closest(".inspector")) this.root.querySelector<HTMLElement>("#setup-reopen")!.focus();
    if (!s.instruments && active?.closest(".diagram-grid-layout")) this.root.querySelector<HTMLElement>("#instruments-toggle")!.focus();
    this.root.classList.toggle("inspector-collapsed", !s.inspector);
    this.root.classList.toggle("instruments-collapsed", !s.instruments);
    this.root.querySelector<HTMLElement>("#setup-reopen")!.hidden = s.inspector;
    this.root.querySelector<HTMLElement>("#response-panel")!.hidden = !s.recorder;
    this.root.querySelectorAll<HTMLElement>("[data-layout]").forEach((e) => {
      const key = e.dataset.layout as keyof LayoutState;
      e.setAttribute("aria-expanded", String(s[key]));
      e.setAttribute("aria-controls", key === "inspector" ? "setup-inspector" : key === "instruments" ? "live-instruments" : "response-panel");
    });
    this.root.querySelector("#instruments-toggle")!.textContent = s.instruments ? "⌄ Collapse" : "⌃ Live chassis telemetry";
    saveLayout(s);
  }
  setCategory(category?: Category, pending?: Category) {
    this.category = category;
    this.root.querySelectorAll<HTMLElement>("[data-category]").forEach((e) => {
      e.setAttribute("aria-pressed", String(e.dataset.category === category));
      e.classList.toggle("pending", e.dataset.category === pending);
    });
    (this.root.querySelector("#category-select") as HTMLSelectElement).value = category ?? "";
  }
  get selectedCategory() { return this.category; }
  dispose() { this.abort.abort(); this.observer.disconnect(); }
}
