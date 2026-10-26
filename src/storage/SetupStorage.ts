import { sanitizeSetup } from "../vehicle/setup";
import type { VehicleSetup } from "../vehicle/types";

const KEY = "procgen-racing:setup:v2";
const LEGACY_KEY = "procgen-racing:setup:v1";
export function decodeSetupRecord(raw: string): VehicleSetup | null {
  try {
    const saved: unknown = JSON.parse(raw);
    if (
      !saved ||
      typeof saved !== "object" ||
      !("version" in saved) ||
      (saved.version !== 1 && saved.version !== 2) ||
      !("setup" in saved)
    )
      return null;
    return sanitizeSetup(saved.setup);
  } catch {
    return null;
  }
}
export function loadSetup(): VehicleSetup | null {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    return decodeSetupRecord(raw);
  } catch {
    return null;
  }
}
export function saveSetup(setup: VehicleSetup) {
  localStorage.setItem(
    KEY,
    JSON.stringify({ version: 2, setup: sanitizeSetup(setup) }),
  );
}
