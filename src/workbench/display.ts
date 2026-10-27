import type { InputSettings } from "../input/settings";
export const INPUT_LABELS = { throttle: "Throttle", brake: "Brake", left: "Steer left", right: "Steer right", handbrake: "Handbrake", reset: "Reset vehicle", pause: "Pause", camera: "Cycle camera", reverse: "Reverse / drive", shiftDown: "Shift down", shiftUp: "Shift up" };
export const bindingName = (settings: InputSettings, action: keyof InputSettings["keys"]) => settings.keys[action].map((key) => key.replace(/^Key|^Digit/, "").replace("ArrowUp", "↑").replace("ArrowDown", "↓").replace("ArrowLeft", "←").replace("ArrowRight", "→")).join(" / ");
export function lapTime(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "—:—.———";
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
export const deltaTime = (seconds: number | null) => seconds === null ? "—" : `${seconds >= 0 ? "+" : "−"}${Math.abs(seconds).toFixed(3)}`;
export const splitTime = (time: number | undefined, best?: number) => time === undefined ? "—" : `${time.toFixed(3)}${best === undefined ? "" : ` (${deltaTime(time - best)})`}`;
