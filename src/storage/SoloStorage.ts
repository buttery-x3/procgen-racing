import { decodeCircuitArchive } from "./CircuitStorage";
import type { CircuitArchive } from "./CircuitStorage";
import { checksum, RULES_VERSION } from "../race/identity";
import type { SessionIdentity } from "../race/identity";
import type { CompletedLap, LapResult, SavedSession } from "../race/types";
import {
  GHOST_STRIDE,
  MAX_GHOST_SAMPLES,
  MAX_LAP_SECONDS,
} from "../race/Ghost";
import type { GhostData } from "../race/Ghost";

export const LIBRARY_LIMIT = 24,
  LIBRARY_BYTES = 32 * 1024 * 1024,
  GHOST_BYTES = 64 * 1024 * 1024;
export interface CircuitEntry {
  version: 1;
  id: string;
  name: string;
  favourite: boolean;
  trashed: boolean;
  createdAt: string;
  updatedAt: string;
  length: number;
  archive: CircuitArchive;
}
function cleanName(value: string) {
  return (
    value
      .trim()
      .replace(/[\u0000-\u001f]/g, "")
      .slice(0, 60) || "Untitled circuit"
  );
}
function date(value: unknown) {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  );
}
export function validIdentity(value: unknown): value is SessionIdentity {
  if (!value || typeof value !== "object") return false;
  const v = value as SessionIdentity;
  if (
    ![v.key, v.track, v.car, v.setup, v.assists].every(
      (s) => typeof s === "string" && /^[a-f0-9]{16}$/.test(s),
    ) ||
    typeof v.physics !== "string" ||
    v.physics.length > 80 ||
    typeof v.rules !== "string" ||
    v.rules.length > 40 ||
    typeof v.variant !== "string" ||
    v.variant.length > 80
  )
    return false;
  const { key, ...rest } = v;
  return checksum(rest) === key;
}
export function validateLap(
  value: LapResult,
  identity: SessionIdentity,
): LapResult {
  const v = value;
  if (
    !v ||
    !validIdentity(v.identity) ||
    v.identity.key !== identity.key ||
    typeof v.id !== "string" ||
    v.id.length > 80 ||
    !Number.isInteger(v.lap) ||
    v.lap < 1 ||
    !Number.isFinite(v.duration) ||
    v.duration <= 0 ||
    v.duration > 86400 ||
    !Array.isArray(v.sectors) ||
    v.sectors.length > 4 ||
    v.sectors.some((s) => !Number.isFinite(s) || s <= 0) ||
    !Array.isArray(v.reasons) ||
    v.reasons.length > 12 ||
    v.reasons.some((s) => typeof s !== "string" || s.length > 160) ||
    !date(v.finishedAt) ||
    !["practice", "time-trial"].includes(v.mode) ||
    typeof v.valid !== "boolean"
  )
    throw new Error("Invalid lap record.");
  if (
    v.valid &&
    (v.reasons.length ||
      v.sectors.length !== 3 ||
      Math.abs(v.sectors.reduce((a, b) => a + b, 0) - v.duration) > 0.01 ||
      v.duration > MAX_LAP_SECONDS)
  )
    throw new Error("Invalid lap timing or sector totals.");
  return structuredClone(v);
}
export function validateGhost(
  value: GhostData,
  identity: SessionIdentity,
): GhostData {
  if (
    !value ||
    value.version !== 1 ||
    value.stride !== GHOST_STRIDE ||
    !validIdentity(value.identity) ||
    value.identity.key !== identity.key ||
    !Number.isFinite(value.duration) ||
    value.duration <= 1 ||
    value.duration > MAX_LAP_SECONDS
  )
    throw new Error("Incompatible or unsupported ghost.");
  if (!(value.samples instanceof Float32Array) && !Array.isArray(value.samples))
    throw new Error("The ghost has no pose samples.");
  const source = value.samples;
  if (
    source.length % 24 ||
    source.length < 48 ||
    source.length > MAX_GHOST_SAMPLES * 24
  )
    throw new Error("Ghost sample bounds exceeded.");
  let prior = -1,
    progress = -1;
  for (let i = 0; i < source.length; i += 24) {
    const s = Array.from(source.slice(i, i + 24));
    if (
      s.some((n) => !Number.isFinite(n)) ||
      s[0] <= prior ||
      s[0] > value.duration + 0.002 ||
      s[1] < progress - 0.005 ||
      s[1] < 0 ||
      s[1] > 27000 ||
      s.slice(2, 5).some((n) => Math.abs(n) > 50000) ||
      Math.abs(Math.hypot(...s.slice(5, 9)) - 1) > 0.01 ||
      s.slice(9, 13).some((n) => n < 0 || n > 2) ||
      s.slice(13, 15).some((n) => Math.abs(n) > 1) ||
      s.slice(15, 19).some((n) => Math.abs(n) > 1e8) ||
      s.slice(19, 23).some((n) => Math.abs(n) > 1) ||
      !Number.isInteger(s[23]) ||
      s[23] < -1 ||
      s[23] > 10
    )
      throw new Error("The ghost contains invalid or unordered poses.");
    if (i && s[0] - prior > 0.151)
      throw new Error("The ghost recording contains a time gap.");
    prior = s[0];
    progress = s[1];
  }
  if (
    Math.abs(source[0]) > 1e-6 ||
    Math.abs(source[1]) > 0.01 ||
    Math.abs(prior - value.duration) > 0.002
  )
    throw new Error("The ghost does not cover the complete lap.");
  return {
    ...value,
    identity: { ...identity },
    samples: new Float32Array(source),
  };
}
export function exportSession(record: SavedSession, ghost?: GhostData) {
  const data = {
    format: "procgen-racing/session",
    version: 1,
    record,
    ghost: ghost && { ...ghost, samples: Array.from(ghost.samples) },
  };
  return JSON.stringify({ ...data, checksum: checksum(data) });
}
export function decodeSession(
  raw: string,
  identity: SessionIdentity,
): { record: SavedSession; ghost: GhostData } {
  if (raw.length > 32 * 1024 * 1024)
    throw new Error("Session import exceeds 32 MiB.");
  const data = JSON.parse(raw);
  if (data?.format !== "procgen-racing/session" || data.version !== 1)
    throw new Error("Unsupported session archive.");
  const { checksum: expected, ...payload } = data;
  if (checksum(payload) !== expected)
    throw new Error("Session archive checksum does not match.");
  const record = data.record as SavedSession;
  if (
    !record ||
    record.version !== 1 ||
    !validIdentity(record.identity) ||
    record.identity.key !== identity.key ||
    record.identity.rules !== RULES_VERSION
  )
    throw new Error(
      "This reference uses a different circuit, variant, car, setup, assists or physics version.",
    );
  if (!record.best || !record.best.valid || record.best.mode !== "time-trial")
    throw new Error("The archive has no complete valid time-trial lap.");
  validateLap(record.best, identity);
  if (
    !Array.isArray(record.recent) ||
    record.recent.length > 8 ||
    typeof record.trackName !== "string" ||
    record.trackName.length > 160 ||
    typeof record.carName !== "string" ||
    record.carName.length > 160 ||
    !date(record.updatedAt)
  )
    throw new Error("Invalid session metadata.");
  record.recent.forEach((r) => validateLap(r, identity));
  const ghost = validateGhost(data.ghost, identity);
  if (Math.abs(ghost.duration - record.best.duration) > 0.002)
    throw new Error("The ghost and best time disagree.");
  return { record, ghost };
}
export function mergeLap(
  previous: SavedSession | undefined,
  lap: CompletedLap,
  trackName: string,
  carName: string,
): SavedSession {
  const result = validateLap(lap.result, lap.result.identity);
  if (previous && previous.identity.key !== result.identity.key)
    throw new Error("Cannot combine incompatible session records.");
  const better =
    result.valid &&
    result.mode === "time-trial" &&
    (!previous?.best || result.duration < previous.best.duration);
  return {
    version: 1,
    identity: { ...result.identity },
    trackName: trackName.slice(0, 160),
    carName: carName.slice(0, 160),
    best: better ? result : (previous?.best ?? null),
    recent: [
      result,
      ...(previous?.recent.filter((r) => r.id !== result.id) ?? []),
    ].slice(0, 8),
    updatedAt: new Date().toISOString(),
    ghostAvailable: better ? !!lap.ghost : (previous?.ghostAvailable ?? false),
  };
}
export function upsertCircuit(
  entries: CircuitEntry[],
  archive: CircuitArchive,
  name: string,
  length: number,
): CircuitEntry[] {
  const safe = decodeCircuitArchive(JSON.stringify(archive)),
    now = new Date().toISOString(),
    id = `circuit-${checksum({ hash: safe.definitionHash, recipe: safe.recipe })}`;
  const existing = entries.find((e) => e.id === id);
  const entry: CircuitEntry = {
    version: 1,
    id,
    name: cleanName(name),
    favourite: existing?.favourite ?? false,
    trashed: false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    length,
    archive: safe,
  };
  if (!Number.isFinite(length) || length < 100 || length > 27000)
    throw new Error("Invalid saved circuit length.");
  const next = [entry, ...entries.filter((e) => e.id !== id)];
  checkLibrary(next);
  return next;
}
export function checkLibrary(entries: CircuitEntry[]) {
  if (
    entries.filter((e) => !e.trashed).length > LIBRARY_LIMIT ||
    entries.filter((e) => e.trashed).length > LIBRARY_LIMIT
  )
    throw new Error(
      "The library holds 24 circuits and 24 recoverable removed entries.",
    );
  if (
    new TextEncoder().encode(JSON.stringify(entries)).byteLength > LIBRARY_BYTES
  )
    throw new Error(
      "The circuit library exceeds its 32 MiB budget. Export a backup before adding more.",
    );
}
export function exportCircuitLibrary(entries: CircuitEntry[]) {
  return JSON.stringify({
    format: "procgen-racing/library",
    version: 1,
    entries: entries.filter((e) => !e.trashed),
  });
}
export function decodeCircuitLibrary(raw: string): CircuitEntry[] {
  if (raw.length > 40 * 1024 * 1024)
    throw new Error("Circuit library import exceeds 40 MiB.");
  const data = JSON.parse(raw);
  if (
    data?.format !== "procgen-racing/library" ||
    data.version !== 1 ||
    !Array.isArray(data.entries) ||
    data.entries.length > 24
  )
    throw new Error("Unsupported circuit library.");
  let entries: CircuitEntry[] = [];
  for (const e of data.entries) {
    if (typeof e.name !== "string" || typeof e.favourite !== "boolean")
      throw new Error("Invalid library entry.");
    entries = upsertCircuit(entries, e.archive, e.name, e.length);
    entries[0].favourite = e.favourite;
  }
  return entries;
}

function database(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      for (const name of ["circuits", "records", "ghosts"])
        r.result.createObjectStore(name, {
          keyPath: name === "circuits" ? "id" : "key",
        });
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => r.result.close();
      resolve(r.result);
    };
    r.onerror = () =>
      reject(r.error ?? new Error("Browser storage is unavailable."));
    r.onblocked = () =>
      reject(new Error("Close older tabs to upgrade local racing storage."));
  });
}
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const committed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("Browser storage transaction was aborted."));
    tx.onerror = () => reject(tx.error);
  });
export class SoloStorage {
  constructor(private name = "procgen-racing:solo") {}
  async library(): Promise<CircuitEntry[]> {
    const db = await database(this.name);
    try {
      return await request(
        db.transaction("circuits").objectStore("circuits").getAll(),
      );
    } finally {
      db.close();
    }
  }
  async changeLibrary(change: (entries: CircuitEntry[]) => CircuitEntry[]) {
    const db = await database(this.name);
    try {
      const tx = db.transaction("circuits", "readwrite"),
        done = committed(tx),
        store = tx.objectStore("circuits");
      try {
        const next = change(await request<CircuitEntry[]>(store.getAll()));
        checkLibrary(next);
        store.clear();
        next.forEach((e) => store.put(e));
        await done;
        return next;
      } catch (error) {
        try {
          tx.abort();
        } catch {}
        await done.catch(() => {});
        throw error;
      }
    } finally {
      db.close();
    }
  }
  async load(
    identity: SessionIdentity,
  ): Promise<{ record?: SavedSession; ghost?: GhostData }> {
    const db = await database(this.name);
    try {
      const tx = db.transaction(["records", "ghosts"]),
        [r, g] = await Promise.all([
          request(tx.objectStore("records").get(identity.key)),
          request(tx.objectStore("ghosts").get(identity.key)),
        ]);
      if (!r) return {};
      const record = r.record as SavedSession;
      if (
        !validIdentity(record.identity) ||
        record.identity.key !== identity.key
      )
        throw new Error("Saved session identity is invalid.");
      if (record.best) validateLap(record.best, identity);
      return { record, ghost: g ? validateGhost(g.data, identity) : undefined };
    } finally {
      db.close();
    }
  }
  async save(lap: CompletedLap, trackName: string, carName: string) {
    const db = await database(this.name);
    try {
      const tx = db.transaction(["records", "ghosts"], "readwrite"),
        done = committed(tx),
        records = tx.objectStore("records"),
        ghosts = tx.objectStore("ghosts"),
        key = lap.result.identity.key;
      try {
        const all = await request<{ key: string; record: SavedSession }[]>(
            records.getAll(),
          ),
          prior = all.find((r) => r.key === key)?.record,
          next = mergeLap(prior, lap, trackName, carName);
        records.put({ key, record: next });
        if (next.best?.id === lap.result.id && lap.ghost)
          ghosts.put({
            key,
            updatedAt: next.updatedAt,
            data: validateGhost(lap.ghost, next.identity),
          });
        for (const old of all
          .filter((r) => r.key !== key)
          .sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt))
          .slice(79)) {
          records.delete(old.key);
          ghosts.delete(old.key);
        }
        const allGhosts = await request<
          { key: string; updatedAt: string; data: GhostData }[]
        >(ghosts.getAll());
        let bytes = 0,
          count = 0;
        for (const item of allGhosts.sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        )) {
          bytes += item.data.samples.byteLength;
          count++;
          if (bytes > GHOST_BYTES || count > 12) {
            ghosts.delete(item.key);
            const old = all.find((r) => r.key === item.key);
            if (old)
              records.put({
                key: old.key,
                record: { ...old.record, ghostAvailable: false },
              });
          }
        }
        await done;
        return next;
      } catch (error) {
        try {
          tx.abort();
        } catch {}
        await done.catch(() => {});
        throw error;
      }
    } finally {
      db.close();
    }
  }
}
