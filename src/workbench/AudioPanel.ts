import {
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  normalizeAudioSettings,
  saveAudioSettings,
} from "../audio/settings";
import type { AudioSettings } from "../audio/types";

type LevelSetting = "master" | "engine" | "tyres" | "surface" | "axleCue" | "width";

function slider(key: LevelSetting, label: string, hint?: string) {
  return `<div class="audio-slider"><div><label for="audio-${key}">${label}</label><output id="audio-${key}-value" for="audio-${key}"></output></div><input id="audio-${key}" data-audio-level="${key}" type="range" min="0" max="100" step="1"${hint ? ` aria-describedby="audio-${key}-hint"` : ""}/>${hint ? `<p id="audio-${key}-hint" class="audio-hint">${hint}</p>` : ""}</div>`;
}

/** Sound preferences apply immediately and are independent of lap identities. */
export class AudioPanel {
  readonly settings: AudioSettings = loadAudioSettings();
  private readonly dialog: HTMLDialogElement;
  private readonly abort = new AbortController();
  private runtimeState = "ready";

  constructor(
    root: HTMLElement,
    private readonly callbacks: {
      change: (settings: AudioSettings) => void;
      action: (action: string) => void;
    },
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.id = "audio-dialog";
    this.dialog.className = "m6-dialog audio-dialog";
    this.dialog.setAttribute("aria-labelledby", "audio-title");
    this.dialog.setAttribute("aria-describedby", "audio-description");
    this.dialog.innerHTML = `
      <header class="m6-dialog-header audio-header"><div><span class="eyebrow">SOUND / DRIVING FEEDBACK</span><h2 id="audio-title">Hear the grip.</h2><p id="audio-description">Front tyres are brighter; rear tyres are rougher. Sound starts with your first interaction.</p></div><button class="icon-button" data-audio="close" aria-label="Close sound settings">×</button></header>
      <div class="audio-body">
        <section class="audio-mixer" aria-labelledby="audio-mixer-title"><div class="audio-section-heading"><h3 id="audio-mixer-title">Mix</h3><label class="audio-toggle" for="audio-enabled"><input id="audio-enabled" type="checkbox"/> Sound enabled</label></div>
          ${slider("master", "Master volume")}
          ${slider("engine", "Engine")}
          ${slider("tyres", "Tyre feedback", "Scrub warns near the grip limit; squeal marks sliding, wheelspin and lock-up.")}
          ${slider("surface", "Road & impacts")}
          <label class="audio-toggle audio-soft" for="audio-softSqueal"><input id="audio-softSqueal" type="checkbox"/> Softer tyre squeal</label><p class="audio-hint">Tames high frequencies while keeping the grip warning.</p>
        </section>
        <section class="audio-spatial" aria-labelledby="audio-spatial-title"><h3 id="audio-spatial-title">Position & recognition</h3><label for="audio-output" class="audio-select-label">Listening mode</label><select id="audio-output" aria-describedby="audio-output-hint"><option value="headphones">Headphones · spatial wheel positions</option><option value="stereo">Stereo speakers · left / right balance</option><option value="mono">Mono · axle tone cues</option></select><p id="audio-output-hint" class="audio-hint">Wheel positions follow the car, so the left side stays on your left as the camera moves.</p>
          ${slider("width", "Left / right separation")}
          ${slider("axleCue", "Front / rear tone difference", "Increase this if front and rear are hard to tell apart.")}
          <div class="audio-wheel-checks" role="group" aria-labelledby="audio-check-title"><div class="audio-check-heading"><h3 id="audio-check-title">Try each tyre</h3><span>FRONT ↑</span></div><div class="audio-wheel-grid"><button class="button subtle" data-audio-demo="fl"><span>FL</span>Front left</button><button class="button subtle" data-audio-demo="fr"><span>FR</span>Front right</button><button class="button subtle" data-audio-demo="rl"><span>RL</span>Rear left</button><button class="button subtle" data-audio-demo="rr"><span>RR</span>Rear right</button></div><div class="audio-channel-checks" role="group" aria-label="Stereo channel checks"><button class="button subtle" data-audio-channel="fl">Left channel only</button><button class="button subtle" data-audio-channel="fr">Right channel only</button></div><p class="audio-hint">Tyre tests use the selected listening mode. Channel checks isolate one stereo channel.</p><button class="button subtle audio-stop-check" data-audio="stop">Stop check</button></div>
        </section>
      </div>
      <footer class="m6-dialog-footer audio-footer"><p id="audio-status" role="status">Changes apply immediately and stay in this browser.</p><a class="audio-lab-link" href="audio-lab.html" target="_blank" rel="noopener">Audio lab ↗</a><button class="button subtle" data-audio="defaults">Restore defaults</button><button class="button save-button" data-audio="close">Done</button></footer>`;
    root.append(this.dialog);
    const options = { signal: this.abort.signal };
    this.dialog.addEventListener("click", this.click, options);
    this.dialog.addEventListener("input", this.input, options);
    this.dialog.addEventListener("change", this.change, options);
    this.dialog.addEventListener("close", () => this.callbacks.action("audio:stop"), options);
    this.sync();
  }

  private node<T extends HTMLElement = HTMLElement>(id: string) {
    return this.dialog.querySelector<T>(`#${id}`)!;
  }

  open() {
    this.sync();
    if (!this.dialog.open) this.dialog.showModal();
  }

  setRuntimeStatus(state: string) {
    this.runtimeState = state;
    if (state === "unavailable") this.node("audio-status").textContent = "Audio is unavailable. Toggle sound to retry.";
  }

  setEnabled(enabled: boolean) {
    this.apply({ ...this.settings, enabled });
  }

  private apply(settings: AudioSettings) {
    Object.assign(this.settings, normalizeAudioSettings(settings));
    const saved = saveAudioSettings(this.settings);
    this.sync();
    this.callbacks.change({ ...this.settings });
    this.node("audio-status").textContent = saved
      ? "Sound preferences saved in this browser."
      : "Sound preferences apply for this visit; browser storage is unavailable.";
  }

  private sync() {
    for (const key of ["master", "engine", "tyres", "surface", "axleCue", "width"] as const) {
      const percent = Math.round(this.settings[key] * 100);
      this.node<HTMLInputElement>(`audio-${key}`).value = String(percent);
      this.node(`audio-${key}-value`).textContent = `${percent}%`;
    }
    this.node<HTMLInputElement>("audio-enabled").checked = this.settings.enabled;
    this.node<HTMLInputElement>("audio-softSqueal").checked = this.settings.softSqueal;
    this.node<HTMLSelectElement>("audio-output").value = this.settings.output;
  }

  private click = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-audio],[data-audio-demo],[data-audio-channel]",
    );
    if (!button) return;
    if (button.dataset.audio === "close") this.dialog.close();
    else if (button.dataset.audio === "stop") {
      this.callbacks.action("audio:stop");
      this.node("audio-status").textContent = "Listening check stopped.";
    }
    else if (button.dataset.audio === "defaults")
      this.apply({ ...DEFAULT_AUDIO_SETTINGS });
    else if (button.dataset.audioDemo || button.dataset.audioChannel) {
      this.callbacks.action(
        button.dataset.audioDemo
          ? `audio:demo:${button.dataset.audioDemo}`
          : `audio:channel:${button.dataset.audioChannel}`,
      );
      this.node("audio-status").textContent =
        !this.settings.enabled || this.settings.master === 0 || this.settings.tyres === 0
          ? "Turn on sound and raise the master and tyre levels to hear the checks."
          : this.runtimeState === "unavailable" ? "Audio is unavailable. Toggle sound to retry."
          : this.runtimeState === "ready" ? "Audio is starting. Try the check again if it stays silent."
          : `${button.textContent?.trim()} · listening check.`;
    }
  };

  private input = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const key = input.dataset.audioLevel as LevelSetting | undefined;
    if (key) this.apply({ ...this.settings, [key]: input.valueAsNumber / 100 });
  };

  private change = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === "audio-enabled") this.setEnabled(input.checked);
    else if (input.id === "audio-softSqueal")
      this.apply({ ...this.settings, softSqueal: input.checked });
    else if (input.id === "audio-output")
      this.apply({ ...this.settings, output: input.value as AudioSettings["output"] });
  };

  dispose() {
    this.abort.abort();
    this.dialog.remove();
  }
}
