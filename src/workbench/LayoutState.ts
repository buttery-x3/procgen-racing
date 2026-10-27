export interface LayoutState { inspector: boolean; instruments: boolean; recorder: boolean }
const KEY = "procgen-racing:layout:v1";
export function loadLayout(storage: Pick<Storage, "getItem"> = localStorage): LayoutState {
  const state = { inspector: true, instruments: true, recorder: false };
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? "null");
    if (raw?.version === 1) for (const key of ["inspector", "instruments", "recorder"] as const)
      if (typeof raw[key] === "boolean") state[key] = raw[key];
  } catch { /* Layout preferences are optional. */ }
  return state;
}
export function saveLayout(state: LayoutState, storage: Pick<Storage, "setItem"> = localStorage) {
  try { storage.setItem(KEY, JSON.stringify({ version: 1, ...state })); } catch { /* Optional. */ }
}
