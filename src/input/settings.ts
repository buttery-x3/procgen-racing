import { clamp } from "../core/math";
export const KEY_ACTIONS = [
  "throttle",
  "brake",
  "left",
  "right",
  "handbrake",
  "reset",
  "pause",
  "camera",
  "reverse",
  "shiftDown",
  "shiftUp",
] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];
export interface InputSettings {
  version: 1;
  keys: Record<KeyAction, string[]>;
  deadZone: number;
  curve: number;
  response: number;
  steerAxis: number;
  pad: Record<
    | "throttle"
    | "brake"
    | "handbrake"
    | "reset"
    | "pause"
    | "camera"
    | "drive"
    | "reverse"
    | "shiftDown"
    | "shiftUp",
    number
  >;
}
export const DEFAULT_INPUT: InputSettings = {
  version: 1,
  keys: {
    throttle: ["KeyW", "ArrowUp"],
    brake: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    handbrake: ["ShiftLeft", "ShiftRight"],
    reset: ["KeyR"],
    pause: ["Space"],
    camera: ["KeyC"],
    reverse: ["KeyV"],
    shiftDown: ["KeyQ"],
    shiftUp: ["KeyE"],
  },
  deadZone: 0.12,
  curve: 1,
  response: 10,
  steerAxis: 0,
  pad: {
    throttle: 7,
    brake: 6,
    handbrake: 0,
    reset: 3,
    pause: 9,
    camera: 2,
    drive: 12,
    reverse: 13,
    shiftDown: 4,
    shiftUp: 5,
  },
};
export function sanitizeInput(value: unknown): InputSettings {
  const source = (value ?? {}) as Partial<InputSettings>,
    result: InputSettings = JSON.parse(JSON.stringify(DEFAULT_INPUT));
  if (source.version !== undefined && source.version !== 1)
    throw new Error("Unsupported input-settings version.");
  for (const [key, min, max] of [
    ["deadZone", 0, 0.35],
    ["curve", 0.5, 3],
    ["response", 2, 25],
    ["steerAxis", 0, 3],
  ] as const)
    if (typeof source[key] === "number" && Number.isFinite(source[key]))
      result[key] = clamp(source[key]!, min, max);
  result.steerAxis = Math.round(result.steerAxis);
  if (source.keys)
    for (const action of KEY_ACTIONS) {
      const codes = source.keys[action];
      if (
        !Array.isArray(codes) ||
        codes.length < 1 ||
        codes.length > 2 ||
        !codes.every(
          (c) => typeof c === "string" && /^[A-Za-z][A-Za-z0-9]{0,24}$/.test(c),
        )
      )
        throw new Error(`Invalid key binding for ${action}.`);
      result.keys[action] = [...codes];
    }
  const used = new Set<string>();
  for (const action of KEY_ACTIONS)
    for (const code of result.keys[action]) {
      if (used.has(code))
        throw new Error(`${code} is assigned to more than one action.`);
      used.add(code);
    }
  if (source.pad)
    for (const key of Object.keys(
      result.pad,
    ) as (keyof InputSettings["pad"])[]) {
      const n = source.pad[key];
      if (!Number.isInteger(n) || n < 0 || n > 15)
        throw new Error("Choose gamepad buttons 0–15.");
      result.pad[key] = n;
    }
  const buttons = Object.values(result.pad);
  if (new Set(buttons).size !== buttons.length)
    throw new Error("Each gamepad action needs a distinct button.");
  return result;
}
export function responseAxis(
  axis: number,
  settings: Pick<InputSettings, "deadZone" | "curve">,
) {
  const x = clamp(axis, -1, 1),
    magnitude = Math.max(
      0,
      (Math.abs(x) - settings.deadZone) / (1 - settings.deadZone),
    );
  return Math.sign(x) * magnitude ** settings.curve;
}
const KEY = "procgen-racing:input:v1";
export function loadInputSettings() {
  try {
    return sanitizeInput(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return sanitizeInput(null);
  }
}
export function saveInputSettings(settings: InputSettings) {
  localStorage.setItem(KEY, JSON.stringify(sanitizeInput(settings)));
}
