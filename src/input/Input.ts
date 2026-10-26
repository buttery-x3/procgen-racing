import { clamp } from "../core/math";
import type { VehicleControls } from "../vehicle/types";

export class Input {
  private keys = new Set<string>();
  private steering = 0;
  private previousPadButtons: boolean[] = [];
  gamepadName: string | null = null;
  enabled = true;
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
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
        event.code,
      )
    )
      event.preventDefault();
    this.keys.add(event.code);
    if (
      !event.repeat &&
      ["KeyR", "Space", "KeyC", "KeyV", "KeyQ", "KeyE"].includes(event.code)
    )
      this.onAction(event.code);
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
    const padActions: Record<number, string> = {
      9: "pause",
      3: "reset",
      2: "cycle-camera",
      12: "gear:drive",
      13: "gear:reverse",
      4: "shift:down",
      5: "shift:up",
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
    const axis = pad?.axes[0] ?? 0;
    const padSteer =
      Math.abs(axis) > 0.12
        ? ((Math.abs(axis) - 0.12) / 0.88) * Math.sign(axis)
        : 0;
    const target =
      padSteer ||
      Number(pressed("KeyD", "ArrowRight")) -
        Number(pressed("KeyA", "ArrowLeft"));
    this.steering += (target - this.steering) * (1 - Math.exp(-10 * dt));
    return {
      throttle: clamp(
        Math.max(
          Number(pressed("KeyW", "ArrowUp")),
          pad?.buttons[7]?.value ?? 0,
        ),
        0,
        1,
      ),
      brake: clamp(
        Math.max(
          Number(pressed("KeyS", "ArrowDown")),
          pad?.buttons[6]?.value ?? 0,
        ),
        0,
        1,
      ),
      steer: clamp(this.steering, -1, 1),
      handbrake: Math.max(
        Number(pressed("ShiftLeft", "ShiftRight")),
        pad?.buttons[0]?.value ?? 0,
      ),
    };
  }
  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clear);
  }
}
