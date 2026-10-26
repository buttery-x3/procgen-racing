import { clamp } from "../core/math";
import type { VehicleControls } from "../vehicle/types";
import { loadInputSettings, sanitizeInput, responseAxis } from "./settings";
import type { InputSettings, KeyAction } from "./settings";

export class Input {
  private keys = new Set<string>();
  private steering = 0;
  private previousPadButtons: boolean[] = [];
  gamepadName: string | null = null;
  enabled = true;
  private settings = loadInputSettings();
  configure(settings: InputSettings) {
    this.settings = sanitizeInput(settings);
    this.clear();
    this.previousPadButtons = [];
  }
  constructor(private onAction: (action: string) => void) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clear);
  }
  private editing() {
    const target = document.activeElement;
    return (
      !!document.querySelector("dialog[open]") ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }
  private onKeyDown = (event: KeyboardEvent) => {
    if (this.editing()) return;
    if (
      (event.ctrlKey || event.metaKey) &&
      (event.code === "KeyZ" || event.code === "KeyY")
    ) {
      event.preventDefault();
      this.onAction(event.code === "KeyY" || event.shiftKey ? "redo" : "undo");
      return;
    }
    if (
      (event.code === "Space" || event.code === "Enter") &&
      document.activeElement instanceof HTMLButtonElement
    )
      return;
    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
        event.code,
      )
    )
      event.preventDefault();
    this.keys.add(event.code);
    if (
      !event.repeat &&
      Object.entries(this.settings.keys).some(
        ([key, codes]) =>
          [
            "reset",
            "pause",
            "camera",
            "reverse",
            "shiftDown",
            "shiftUp",
          ].includes(key) && codes.includes(event.code),
      )
    ) {
      const map: Partial<Record<KeyAction, string>> = {
        reset: "reset",
        pause: "pause",
        camera: "cycle-camera",
        reverse: "gear:toggle",
        shiftDown: "shift:down",
        shiftUp: "shift:up",
      };
      for (const [key, action] of Object.entries(map))
        if (this.settings.keys[key as KeyAction].includes(event.code))
          this.onAction(action!);
    }
  };
  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };
  private clear = () => {
    this.keys.clear();
    this.steering = 0;
  };
  read(dt: number): VehicleControls {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = Array.from(pads).find(
      (p) => p?.connected && p.mapping === "standard",
    );
    this.gamepadName = pad?.id ?? null;
    if (pad && this.editing()) this.navigateUI(pad);
    const padActions: Record<number, string> = {
      [this.settings.pad.pause]: "pause",
      [this.settings.pad.reset]: "reset",
      [this.settings.pad.camera]: "cycle-camera",
      [this.settings.pad.drive]: "gear:drive",
      [this.settings.pad.reverse]: "gear:reverse",
      [this.settings.pad.shiftDown]: "shift:down",
      [this.settings.pad.shiftUp]: "shift:up",
    };
    if (!this.editing())
      for (const [index, action] of Object.entries(padActions)) {
        if (
          pad?.buttons[Number(index)]?.pressed &&
          !this.previousPadButtons[Number(index)]
        )
          this.onAction(action);
      }
    this.previousPadButtons =
      pad?.buttons.map((button) => button.pressed) ?? [];
    if (!this.enabled || this.editing()) {
      this.clear();
      return { throttle: 0, brake: 0, steer: 0 };
    }
    const pressed = (...keys: string[]) =>
      keys.some((key) => this.keys.has(key));
    const axis = pad?.axes[this.settings.steerAxis] ?? 0;
    const padSteer = responseAxis(axis, this.settings);
    const target =
      padSteer ||
      Number(pressed(...this.settings.keys.right)) -
        Number(pressed(...this.settings.keys.left));
    this.steering +=
      (target - this.steering) * (1 - Math.exp(-this.settings.response * dt));
    return {
      throttle: clamp(
        Math.max(
          Number(pressed(...this.settings.keys.throttle)),
          pad?.buttons[this.settings.pad.throttle]?.value ?? 0,
        ),
        0,
        1,
      ),
      brake: clamp(
        Math.max(
          Number(pressed(...this.settings.keys.brake)),
          pad?.buttons[this.settings.pad.brake]?.value ?? 0,
        ),
        0,
        1,
      ),
      steer: clamp(this.steering, -1, 1),
      handbrake: Math.max(
        Number(pressed(...this.settings.keys.handbrake)),
        pad?.buttons[this.settings.pad.handbrake]?.value ?? 0,
      ),
    };
  }
  private navigateUI(pad: Gamepad) {
    const pressed = (index: number) =>
      !!pad.buttons[index]?.pressed && !this.previousPadButtons[index];
    const dialog = Array.from(
      document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
    ).at(-1);
    const scope = dialog ?? document.querySelector(".inspector") ?? document;
    const controls = Array.from(
      scope.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([type="hidden"]):not([disabled]),select:not([disabled]),summary,textarea',
      ),
    ).filter((e) => e.getClientRects().length > 0);
    const active = document.activeElement as HTMLElement | null;
    if (pressed(1) && dialog) {
      dialog.close();
      return;
    }
    if (pressed(0) && active) {
      if (active instanceof HTMLInputElement && active.type === "checkbox") {
        active.checked = !active.checked;
        active.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (
        active instanceof HTMLButtonElement ||
        active.tagName === "SUMMARY"
      )
        active.click();
    }
    const delta =
      pressed(13) || pressed(15) ? 1 : pressed(12) || pressed(14) ? -1 : 0;
    if (!delta || !controls.length) return;
    if (
      active instanceof HTMLInputElement &&
      ["range", "number"].includes(active.type) &&
      (pressed(14) || pressed(15))
    ) {
      const step = Number(active.step) || 1,
        min = Number(active.min) || 0,
        max = Number(active.max) || 100;
      active.value = String(
        Math.max(min, Math.min(max, active.valueAsNumber + delta * step)),
      );
      active.dispatchEvent(new Event("input", { bubbles: true }));
      active.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (
      (active instanceof HTMLSelectElement && pressed(14)) ||
      (active instanceof HTMLSelectElement && pressed(15))
    ) {
      const indices = Array.from(active.options)
          .map((o, i) => (o.disabled ? -1 : i))
          .filter((i) => i >= 0),
        index = indices.indexOf(active.selectedIndex);
      active.selectedIndex =
        indices[Math.max(0, Math.min(indices.length - 1, index + delta))];
      active.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const index = controls.indexOf(active!);
    controls[(index + delta + controls.length) % controls.length].focus();
  }
  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clear);
  }
}
