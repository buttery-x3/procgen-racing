export interface PresentationSettings {
  quality: "high" | "balanced" | "economy";
  lookAhead: number;
  cameraRoll: number;
  effects: boolean;
  ghostVisible: boolean;
  ghostOpacity: number;
  volume: number;
}
export const DEFAULT_PRESENTATION: PresentationSettings = {
  quality: "balanced",
  lookAhead: 4,
  cameraRoll: 0.12,
  effects: true,
  ghostVisible: true,
  ghostOpacity: 0.32,
  volume: 0.6,
};
export function normalizePresentation(
  source: Partial<PresentationSettings>,
): PresentationSettings {
  const number = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(min, Math.min(max, v))
      : fallback;
  return {
    quality: ["high", "balanced", "economy"].includes(source.quality ?? "")
      ? source.quality!
      : "balanced",
    lookAhead: number(source.lookAhead, 4, 0, 20),
    cameraRoll: number(source.cameraRoll, 0.12, 0, 1),
    effects: source.effects !== false,
    ghostVisible: source.ghostVisible !== false,
    ghostOpacity: number(source.ghostOpacity, 0.32, 0.15, 0.65),
    volume: number(source.volume, 0.6, 0, 1),
  };
}
export function loadPresentation() {
  try {
    return normalizePresentation(
      JSON.parse(localStorage.getItem("procgen-racing:presentation") ?? "{}"),
    );
  } catch {
    return { ...DEFAULT_PRESENTATION };
  }
}
export function savePresentation(settings: PresentationSettings) {
  localStorage.setItem(
    "procgen-racing:presentation",
    JSON.stringify(normalizePresentation(settings)),
  );
}
