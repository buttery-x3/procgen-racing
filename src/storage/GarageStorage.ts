import { sanitizeSetup, DEFAULT_SETUP } from "../vehicle/setup";
import {
  decodeCarDefinition,
  mechanicsFingerprint,
} from "../vehicle/CarDefinition";
import type { VehicleSetup } from "../vehicle/types";
import { decodeSetupRecord } from "./SetupStorage";
import { carChecks } from "../vehicle/generateCar";

export interface GarageEntry {
  id: string;
  name: string;
  createdAt: string;
  setup: VehicleSetup;
}
export interface Garage {
  version: 1;
  entries: GarageEntry[];
}
const KEY = "procgen-racing:garage:v1";
export const copySetup = (setup: VehicleSetup): VehicleSetup =>
  JSON.parse(JSON.stringify(setup));
export const cleanName = (name: string) =>
  name
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 60) || "Untitled setup";
export const createEntry = (
  name: string,
  setup: VehicleSetup,
): GarageEntry => ({
  id: crypto.randomUUID(),
  name: cleanName(name),
  createdAt: new Date().toISOString(),
  setup: copySetup(setup),
});
export function loadGarage(legacy?: VehicleSetup | null): Garage {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return decodeGarage(raw, false);
  } catch {
    /* A damaged library must not prevent driving. */
  }
  return {
    version: 1,
    entries: legacy ? [createEntry("Saved baseline setup", legacy)] : [],
  };
}
export function saveGarage(garage: Garage) {
  if (garage.entries.length > 24)
    throw new Error(
      "The garage holds 24 setups. Export a backup or replace an existing slot.",
    );
  localStorage.setItem(KEY, JSON.stringify(garage));
}
function importedSetup(input: unknown): VehicleSetup {
  if (
    !input ||
    typeof input !== "object" ||
    !Number.isFinite((input as VehicleSetup).mass)
  )
    throw new Error("This file does not contain a complete vehicle setup.");
  const value = input as VehicleSetup;
  for (const key of Object.keys(DEFAULT_SETUP) as (keyof VehicleSetup)[]) {
    if (
      typeof value[key] !== typeof DEFAULT_SETUP[key] ||
      (typeof value[key] === "number" && !Number.isFinite(value[key]))
    )
      throw new Error(`Invalid or missing setup field: ${key}.`);
  }
  if (value.vehicle && !decodeCarDefinition(value.vehicle))
    throw new Error("Unsupported or invalid generated-car definition.");
  const normalized = sanitizeSetup(value);
  for (const key of Object.keys(DEFAULT_SETUP) as (keyof VehicleSetup)[])
    if (value[key] !== normalized[key])
      throw new Error(`Setup field outside the supported range: ${key}.`);
  if (normalized.vehicle) {
    const failed = carChecks(normalized).filter((c) => !c.passed);
    if (failed.length)
      throw new Error(
        `Invalid generated-car setup: ${failed.map((c) => c.name).join(", ")}.`,
      );
  }
  return normalized;
}
export function decodeGarage(raw: string, newIds = true): Garage {
  if (raw.length > 2_000_000)
    throw new Error("Setup files must be smaller than 2 MB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const input = parsed as {
    format?: string;
    version?: number;
    entries?: GarageEntry[];
    setup?: unknown;
    name?: string;
  };
  if (!input || typeof input !== "object") throw new Error("No setup found.");
  if (
    input.format === "procgen-racing/setup" &&
    input.version === 3 &&
    input.setup
  )
    return {
      version: 1,
      entries: [
        createEntry(input.name ?? "Imported setup", importedSetup(input.setup)),
      ],
    };
  if (
    (input.format === "procgen-racing/garage" || !input.format) &&
    input.version === 1 &&
    Array.isArray(input.entries) &&
    input.entries.length <= 24
  )
    return {
      version: 1,
      entries: input.entries.map((e) => {
        const entry = createEntry(
          typeof e.name === "string" ? e.name : "Imported setup",
          importedSetup(e.setup),
        );
        if (
          !newIds &&
          typeof e.id === "string" &&
          /^[a-zA-Z0-9-]{1,64}$/.test(e.id)
        ) {
          entry.id = e.id;
          if (
            typeof e.createdAt === "string" &&
            !Number.isNaN(Date.parse(e.createdAt))
          )
            entry.createdAt = e.createdAt;
        }
        return entry;
      }),
    };
  if (
    !input.format &&
    (input.version === 1 || input.version === 2 || input.version === 3) &&
    input.setup
  ) {
    const setup = decodeSetupRecord(raw);
    if (setup)
      return {
        version: 1,
        entries: [createEntry("Imported legacy setup", setup)],
      };
  }
  throw new Error("Unsupported setup/garage file version.");
}
export const exportSetup = (name: string, setup: VehicleSetup) =>
  JSON.stringify(
    {
      format: "procgen-racing/setup",
      version: 3,
      name: cleanName(name),
      physicsVersion: "m6-1",
      mechanics: mechanicsFingerprint(setup),
      setup: copySetup(setup),
    },
    null,
    2,
  );
export const exportGarage = (garage: Garage) =>
  JSON.stringify({ format: "procgen-racing/garage", ...garage }, null, 2);

/** Coalesce one slider gesture, retain deep snapshots, and invalidate redo on edits. */
export class SetupHistory {
  private past: VehicleSetup[] = [];
  private future: VehicleSetup[] = [];
  private group = "";
  private time = 0;
  record(previous: VehicleSetup, group = "", now = performance.now()) {
    if (!group || group !== this.group || now - this.time > 500)
      this.past.push(copySetup(previous));
    this.past = this.past.slice(-50);
    this.future = [];
    this.group = group;
    this.time = now;
  }
  undo(current: VehicleSetup) {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(copySetup(current));
    this.group = "";
    return previous;
  }
  redo(current: VehicleSetup) {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(copySetup(current));
    this.group = "";
    return next;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
}
