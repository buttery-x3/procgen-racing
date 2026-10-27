import { INPUT_LABELS } from "./display";
import {
  DEFAULT_INPUT,
  KEY_ACTIONS,
  loadInputSettings,
  sanitizeInput,
  saveInputSettings,
  responseAxis,
} from "../input/settings";
import type { InputSettings, KeyAction } from "../input/settings";
import type { VehicleControls } from "../vehicle/types";
import { escapeHTML as esc, textError } from "./ui";
export class InputPanel {
  private dialog: HTMLDialogElement;
  private draft = loadInputSettings();
  private capture?: KeyAction;
  private abort = new AbortController();
  constructor(
    root: HTMLElement,
    private apply: (settings: InputSettings) => void,
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "m6-dialog input-dialog";
    this.dialog.setAttribute("aria-labelledby", "input-title");
    this.dialog.id = "input-dialog";
    this.dialog.innerHTML = `<header class="m6-dialog-header"><div><span class="eyebrow">CONTROLS / KEYBOARD & GAMEPAD</span><h2 id="input-title">Make control feel natural.</h2></div><button class="icon-button" data-input="close" aria-label="Close input settings">×</button></header><div class="input-panel-body"><section><h3>Keyboard bindings</h3><p>Choose an action, then press the new key. Arrow-key alternatives are retained where available.</p><div id="input-key-bindings"></div></section><section><h3>Gamepad response</h3><p>Standard mapped gamepads are supported. Tuning is stored in this browser.</p><label for="input-deadZone">Steering dead zone</label><input type="range" id="input-deadZone" min="0" max="35" step="1"/><output id="input-deadZone-value"></output><label for="input-curve">Steering response curve</label><input type="range" id="input-curve" min="50" max="300" step="5"/><output id="input-curve-value"></output><label for="input-response">Steering response rate</label><input type="range" id="input-response" min="2" max="25" step="1"/><output id="input-response-value"></output><svg viewBox="0 0 300 100" role="img" aria-label="Gamepad steering response curve"><path id="input-curve-path" fill="none" stroke="#d6ed9d" stroke-width="2"/></svg><label for="input-axis">Steering axis</label><select id="input-axis">${[0, 1, 2, 3].map((n) => `<option value="${n}">Axis ${n}</option>`).join("")}</select><details class="m6-details"><summary>Gamepad button mapping</summary><div id="input-pad-bindings"></div></details><div class="input-live"><span id="input-pad-name">No standard gamepad connected</span><p>Gamepad preview · driving paused</p><label>Throttle <meter id="input-meter-throttle" min="0" max="1" value="0"></meter></label><label>Brake <meter id="input-meter-brake" min="0" max="1" value="0"></meter></label><label>Steer <meter id="input-meter-steer" min="-1" max="1" value="0"></meter></label></div></section></div><footer class="m6-dialog-footer"><p id="input-message" role="status">Typing and open dialogs suppress driving input.</p><button class="button subtle" data-input="defaults">Restore defaults</button><button class="button save-button" data-input="apply">Apply controls</button></footer>`;
    root.append(this.dialog);
    const opts = { signal: this.abort.signal };
    this.dialog.addEventListener("click", this.click, opts);
    this.dialog.addEventListener("input", this.input, opts);
    this.dialog.addEventListener("change", this.change, opts);
    this.dialog.addEventListener("keydown", this.key, opts);
  }
  private node<T extends HTMLElement = HTMLElement>(id: string) {
    return this.dialog.querySelector<T>(`#${id}`)!;
  }
  open() {
    this.capture = undefined;
    this.draft = loadInputSettings();
    this.render();
    this.dialog.showModal();
  }
  private render() {
    this.node("input-key-bindings").innerHTML = KEY_ACTIONS.map(
      (action) =>
        `<div class="input-binding"><span>${INPUT_LABELS[action]}</span><button class="button subtle" data-bind="${action}">${esc(this.draft.keys[action].join(" / "))}</button></div>`,
    ).join("");
    this.node("input-pad-bindings").innerHTML = Object.entries(this.draft.pad)
      .map(
        ([key, value]) =>
          `<label class="input-binding">${esc(key)}<select data-pad="${key}" aria-label="Gamepad ${key}">${Array.from({ length: 16 }, (_, i) => `<option value="${i}" ${value === i ? "selected" : ""}>Button ${i}</option>`).join("")}</select></label>`,
      )
      .join("");
    this.node<HTMLInputElement>("input-deadZone").value = String(
      this.draft.deadZone * 100,
    );
    this.node<HTMLInputElement>("input-curve").value = String(
      this.draft.curve * 100,
    );
    this.node<HTMLInputElement>("input-response").value = String(
      this.draft.response,
    );
    this.node<HTMLSelectElement>("input-axis").value = String(
      this.draft.steerAxis,
    );
    this.curve();
  }
  private curve() {
    this.node("input-deadZone-value").textContent =
      `${Math.round(this.draft.deadZone * 100)}%`;
    this.node("input-curve-value").textContent = this.draft.curve.toFixed(2);
    this.node("input-response-value").textContent =
      `${this.draft.response.toFixed(0)} /s`;
    this.node("input-curve-path").setAttribute(
      "d",
      Array.from(
        { length: 81 },
        (_, i) =>
          `${i ? "L" : "M"}${(i / 80) * 280 + 10},${90 - responseAxis(i / 80, this.draft) * 80}`,
      ).join(" "),
    );
  }
  update(controls: VehicleControls, pad: string | null) {
    if (!this.dialog.open) return;
    this.node("input-pad-name").textContent =
      pad ?? "No standard gamepad connected";
    const gamepad = Array.from(navigator.getGamepads?.() ?? []).find(
      (p) => p?.connected && p.mapping === "standard",
    );
    const preview = gamepad
      ? {
          throttle: gamepad.buttons[this.draft.pad.throttle]?.value ?? 0,
          brake: gamepad.buttons[this.draft.pad.brake]?.value ?? 0,
          steer: responseAxis(
            gamepad.axes[this.draft.steerAxis] ?? 0,
            this.draft,
          ),
        }
      : controls;
    for (const key of ["throttle", "brake", "steer"] as const)
      this.node<HTMLMeterElement>(`input-meter-${key}`).value = preview[key];
  }
  private key = (event: KeyboardEvent) => {
    if (!this.capture) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.code === "Escape") {
      this.capture = undefined;
      this.render();
      this.node("input-message").textContent = "Rebinding cancelled.";
      return;
    }
    try {
      const keys = JSON.parse(JSON.stringify(this.draft.keys));
      keys[this.capture] = [
        event.code,
        ...keys[this.capture].slice(1).filter((c: string) => c !== event.code),
      ];
      this.draft = sanitizeInput({ ...this.draft, keys });
      this.capture = undefined;
      this.render();
      this.node("input-message").textContent =
        "Key binding staged. Apply controls to use it.";
    } catch (error) {
      this.node("input-message").textContent = textError(error);
    }
  };
  private click = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-input],[data-bind]",
    );
    if (!button) return;
    if (button.dataset.bind) {
      this.capture = button.dataset.bind as KeyAction;
      button.textContent = "Press a key…";
      this.node("input-message").textContent =
        "Press the physical key to assign. Escape cancels.";
      return;
    }
    if (button.dataset.input === "close") this.dialog.close();
    if (button.dataset.input === "defaults") {
      this.draft = sanitizeInput(DEFAULT_INPUT);
      this.render();
    }
    if (button.dataset.input === "apply") {
      try {
        this.draft = sanitizeInput(this.draft);
        saveInputSettings(this.draft);
        this.apply(this.draft);
        this.node("input-message").textContent = "Controls applied and saved.";
      } catch (error) {
        this.node("input-message").textContent = textError(error);
      }
    }
  };
  private input = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === "input-deadZone")
      this.draft.deadZone = input.valueAsNumber / 100;
    if (input.id === "input-curve")
      this.draft.curve = input.valueAsNumber / 100;
    if (input.id === "input-response")
      this.draft.response = input.valueAsNumber;
    this.curve();
  };
  private change = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === "input-axis") this.draft.steerAxis = Number(input.value);
    if (input.dataset.pad)
      this.draft.pad[input.dataset.pad as keyof InputSettings["pad"]] = Number(
        input.value,
      );
  };
  dispose() {
    this.abort.abort();
    this.dialog.remove();
  }
}
