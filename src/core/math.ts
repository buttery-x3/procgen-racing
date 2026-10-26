export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const radians = (degrees: number) => (degrees * Math.PI) / 180;
export const degrees = (radians: number) => (radians * 180) / Math.PI;

/** Independent seeded streams keep cosmetic changes from changing physics. */
export function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
