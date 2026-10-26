import { WHEEL_IDS } from "../vehicle/types";
import type { WheelId } from "../vehicle/types";
import type { AudioControlFrame, TyreAudioControl } from "./types";

export function silentTyre(id: WheelId): TyreAudioControl {
  return { id, grounded: false, warning: 0, slip: 0, rolling: 0, speed: 0, slipSpeed: 0, demand: 0, load: 0, kerb: 0, gravel: 0, sand: 0, grass: 0, tarmac: 1, roughness: 0, absActive: false, tractionActive: false };
}
export function auditionFrame(ids: readonly WheelId[], time = 0, engine = false, intensity = 0.65): AudioControlFrame {
  return {
    time,
    engine: { rpm: engine ? 4200 : 1000, load: engine ? 0.75 : 0, driveLoad: engine ? 0.65 : 0, shifting: false, gear: engine ? 3 : 0, overrun: 0 },
    wheels: WHEEL_IDS.map((id) => ids.includes(id) ? { ...silentTyre(id), grounded: true, warning: intensity, slip: intensity, rolling: 0.25, speed: 22, slipSpeed: 3, demand: 1.4, load: 1 } : silentTyre(id)),
    impact: 0,
  };
}
