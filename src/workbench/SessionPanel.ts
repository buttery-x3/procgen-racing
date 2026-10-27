import type { SessionSnapshot } from "../race/types";
import type { SessionIdentity } from "../race/identity";
import { escapeHTML as esc, downloadJSON, textError } from "./ui";
import type { PresentationSettings } from "../rendering/settings";

export { lapTime } from "./display";
import { lapTime } from "./display";
import { PreferencesPanel } from "./PreferencesPanel";
import { TimingReadout } from "./TimingReadout";
export class SessionPanel {
  readonly dialog: HTMLDialogElement;
  readonly preferences: PreferencesPanel;
  private timing: TimingReadout;
  get settings() { return this.preferences.settings; }
  private snapshot?: SessionSnapshot;
  private abort = new AbortController();
  constructor(
    root: HTMLElement,
    strip: HTMLElement,
    private callbacks: {
      action: (action: string) => void;
      export: () => Promise<string>;
      import: (raw: string) => void;
      presentation: (settings: PresentationSettings) => void;
    },
  ) {
    this.preferences = new PreferencesPanel(root, callbacks.presentation);
    this.timing = new TimingReadout(strip);
    const dialog = document.createElement("dialog");
    this.dialog = dialog;
    dialog.id = "session-dialog";
    dialog.className = "m6-dialog session-dialog";
    dialog.setAttribute("aria-labelledby", "session-title");
    dialog.innerHTML = `<header class="m6-dialog-header"><div><span class="eyebrow">DRIVE / SOLO SESSIONS</span><h2 id="session-title">Find your next tenth.</h2></div><button class="icon-button" data-session="close" aria-label="Close sessions">×</button></header><div class="session-body"><section><div class="session-mode-buttons"><button class="button subtle" data-session="practice">Practice</button><button class="button save-button" data-session="trial">Start time trial →</button></div><p class="m6-muted">Time trials reset to the grid. The clock starts as you cross the chequered line ahead. Practice records lap information without setting a personal best.</p><div class="session-record-metrics"><div><span>PERSONAL BEST / THIS SETUP</span><strong id="session-record-best">—</strong></div><div><span>REFERENCE GHOST</span><strong id="session-reference-kind">No ghost yet</strong></div></div><div class="session-ghost-controls"><label><input type="checkbox" id="ghost-visible" ${this.settings.ghostVisible ? "checked" : ""}/> Show non-colliding ghost</label><label>Ghost opacity<input id="ghost-opacity" type="range" min="15" max="65" value="${this.settings.ghostOpacity * 100}"/></label><button class="button subtle" data-session="local-reference">Use personal-best ghost</button></div><h3>Recent laps</h3><div id="session-laps" class="session-laps"></div><details class="m6-details"><summary>Import / export a ghost reference</summary><p>Imported references must match the complete active session. They never replace your locally earned personal best. Poses and controls are recorded; this is not a physics replay.</p><button class="button subtle" data-session="export">Export best / reference JSON</button><label for="session-file">Import session JSON</label><input id="session-file" type="file" accept=".json,application/json"/><label for="session-import">Or paste session JSON</label><textarea id="session-import" spellcheck="false" placeholder="Paste an exported session"></textarea><button class="button subtle" data-session="import">Use imported ghost reference</button></details></section><aside><span class="eyebrow">LOCAL SOLO RULES / V1</span><ol class="session-rules"><li>Pass every directional checkpoint in order, including three sector boundaries. Gates have road-width and height bounds.</li><li>Keep at least one tyre centre inside the white racing edge. Kerbs, tarmac run-off and the oval apron are outside that edge; 10 cm numerical tolerance applies.</li><li>All four tyres off, skipped gates, wrong direction, pit use, resets, impulses, pauses and tuning edits invalidate the lap.</li><li>Respect the signed pit limit. A blue pit flag and yellow off-track/wrong-way warnings guide a safe return. There are no AI competitors or timed penalties.</li><li>Finish an invalid lap to begin a clean one. Start time trial begins a new attempt at the grid.</li></ol><details class="m6-details"><summary>Result compatibility</summary><p>Track, route variant, car, mechanical tune, assists, rules and physics are keyed separately. Paint and non-solid scenery do not change result compatibility.</p><dl id="session-identity" class="session-identity"></dl><p>Results stay in this browser. Up to 80 result groups and 12 ghosts within 64 MiB are retained; older best times remain when their ghost is retired.</p></details></aside></div><footer class="m6-dialog-footer"><p id="session-status" role="status">Drive a clean timed lap to set a best and record its ghost.</p></footer>`;
    root.append(dialog);
    dialog.addEventListener("click", this.click, { signal: this.abort.signal });
    dialog.addEventListener("change", this.change, {
      signal: this.abort.signal,
    });
  }
  private node<T extends HTMLElement = HTMLElement>(id: string) {
    return this.dialog.querySelector<T>(`#${id}`)!;
  }
  open() {
    this.render();
    this.dialog.showModal();
  }
  setStatus(message: string) {
    this.node("session-status").textContent = message;
  }
  private click = async (event: Event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-session]",
    )?.dataset.session;
    if (!action) return;
    try {
      if (action === "close") this.dialog.close();
      else if (action === "trial" || action === "practice") {
        this.dialog.close();
        this.callbacks.action(`session:${action}`);
      } else if (action === "audio-settings") {
        this.dialog.close();
        this.callbacks.action("audio-settings");
      } else if (action === "local-reference")
        this.callbacks.action("session:local-reference");
      else if (action === "export") {
        const raw = await this.callbacks.export();
        downloadJSON("procgen-racing-session.json", raw);
        this.setStatus("Session and ghost exported.");
      } else if (action === "import")
        this.callbacks.import(
          this.node<HTMLTextAreaElement>("session-import").value,
        );
    } catch (error) {
      this.setStatus(textError(error));
    }
  };
  private change = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    try {
      if (input.id === "session-file" && input.files?.[0]) {
        if (input.files[0].size > 32 * 1024 * 1024)
          throw new Error("Session file exceeds 32 MiB.");
        this.callbacks.import(await input.files[0].text());
        input.value = "";
        return;
      }
      if (input.id === "ghost-visible")
        this.settings.ghostVisible = input.checked;
      else if (input.id === "ghost-opacity")
        this.settings.ghostOpacity = Number(input.value) / 100;
      else return;
      this.preferences.apply();
    } catch (error) {
      this.setStatus(textError(error));
    }
  };
  update(snapshot: SessionSnapshot, onCircuit: boolean) {
    this.snapshot = snapshot;
    this.timing.update(snapshot, onCircuit);
    if (this.dialog.open) this.render();
  }
  private render() {
    const s = this.snapshot;
    if (!s) return;
    this.node("session-record-best").textContent = lapTime(s.best?.duration);
    this.node("session-reference-kind").textContent = s.imported
      ? "Imported reference"
      : s.referenceAvailable
        ? "Personal-best reference"
        : s.best
          ? "Best saved · ghost retired"
          : "No ghost yet";
    this.node("session-laps").innerHTML = s.recent.length
      ? `<table><thead><tr><th>Lap</th><th>Time</th><th>S1 / S2 / S3</th><th>Status</th></tr></thead><tbody>${s.recent.map((l) => `<tr><td>${l.lap}</td><td>${lapTime(l.duration)}</td><td>${l.sectors.map((t) => t.toFixed(3)).join(" / ")}</td><td>${l.valid ? (l.mode === "practice" ? "Practice" : "Valid") : esc(l.reasons.join(" · "))}</td></tr>`).join("")}</tbody></table>`
      : '<p class="m6-muted">No completed laps in this session.</p>';
    this.node("session-identity").innerHTML = Object.entries(s.identity)
      .filter(([key]) => key !== "key")
      .map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`)
      .join("");
  }
  get identity(): SessionIdentity | undefined {
    return this.snapshot?.identity;
  }
  dispose() {
    this.preferences.dispose();
    this.abort.abort();
    this.dialog.remove();
  }
}
