/** Shared accepted listening defaults. Vehicle-family voicing remains a later tuning pass. */
export const REFERENCE_MODEL_ID = "local:tyre-spectrum-v1:2941a61b863996e39695905bf50e6fd07e55fca54ea51941901711317804fdf0";
export const ACCEPTED_ENGINE_TUNING = Object.freeze({
  body: 0.78, openness: 0.35, rasp: 0.28, unevenness: 0.35, mechanical: 0.16,
});
export const ACCEPTED_TYRE_TUNING = Object.freeze({
  character: 0.5, texture: 0.5, pitch: 0.5, movement: 0.65, onset: 0.22, release: 0.36,
});
