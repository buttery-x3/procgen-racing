import { loadPresentation, savePresentation } from "../rendering/settings";
import type { PresentationSettings } from "../rendering/settings";

export class PreferencesPanel {
  readonly settings = loadPresentation();
  private dialog: HTMLDialogElement;
  private abort = new AbortController();
  constructor(root: HTMLElement, private changed: (settings: PresentationSettings) => void) {
    const s = this.settings;
    this.dialog = document.createElement("dialog");
    this.dialog.id = "preferences-dialog";
    this.dialog.className = "m6-dialog preferences-dialog";
    this.dialog.setAttribute("aria-labelledby", "preferences-title");
    this.dialog.innerHTML = `<header class="m6-dialog-header"><h2 id="preferences-title">Settings</h2><button class="icon-button" data-preferences-close aria-label="Close settings">×</button></header><div class="preferences-body"><label for="presentation-quality">Rendering quality</label><select id="presentation-quality"><option value="high">High · up to 2× resolution</option><option value="balanced">Balanced · native resolution</option><option value="economy">Economy · shadows off</option></select><label for="presentation-lookahead">Chase look-ahead (metres)</label><input id="presentation-lookahead" type="range" min="0" max="20" value="${s.lookAhead}"/><label for="presentation-roll">Bonnet camera body-roll influence</label><input id="presentation-roll" type="range" min="0" max="100" value="${s.cameraRoll * 100}"/><label><input id="presentation-effects" type="checkbox" ${s.effects ? "checked" : ""}/> Tyre smoke, dust and skid marks</label><button class="button subtle" data-action="audio-settings">Sound settings</button><button class="button subtle" data-action="input-settings">Controls / keyboard & gamepad</button></div>`;
    this.dialog.querySelector<HTMLSelectElement>("#presentation-quality")!.value = s.quality;
    root.append(this.dialog);
    this.dialog.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("[data-preferences-close], [data-action]")) this.dialog.close();
    }, { signal: this.abort.signal });
    this.dialog.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.id === "presentation-quality") s.quality = input.value as PresentationSettings["quality"];
      else if (input.id === "presentation-lookahead") s.lookAhead = Number(input.value);
      else if (input.id === "presentation-roll") s.cameraRoll = Number(input.value) / 100;
      else if (input.id === "presentation-effects") s.effects = input.checked;
      else return;
      this.apply();
    }, { signal: this.abort.signal });
  }
  apply() { this.changed(this.settings); try { savePresentation(this.settings); } catch { /* Settings still work in memory. */ } }
  open() { this.dialog.showModal(); }
  dispose() { this.abort.abort(); this.dialog.remove(); }
}
