import { smooth } from "../Alignment";
import type { RoadSample } from "../types";

/** Integral of the quintic smoothstep, clamped with its linear continuation. */
const integral = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? t - 0.5 : 2.5 * t ** 4 - 3 * t ** 5 + t ** 6;
/** Height relative to the racing centreline. Integrating the slope gives C2
 * cross-track joins; each lane has its own normal and apron transition. */
export function ovalHeight(sample: RoadSample, lateral: number) {
  const o = sample.oval!;
  const inner = o.inside === 1 ? sample.leftWidth : sample.rightWidth,
    outer = o.inside === 1 ? sample.rightWidth : sample.leftWidth,
    u = -o.inside * lateral,
    w = inner + outer,
    lo = Math.tan(o.innerBank),
    hi = Math.tan(o.outerBank),
    apron = Math.tan(o.apronBank);
  const racing = (x: number) =>
    lo * x + (hi - lo) * w * (integral((x + inner) / w) - integral(inner / w));
  if (u >= -inner && u <= outer) return racing(u);
  if (u > outer) return racing(outer) + hi * (u - outer);
  const d = -inner - u,
    T = o.apronBlend;
  const slopeIntegral = (x: number) =>
    lo * x - (lo - apron) * T * integral(x / T);
  if (d <= o.apronWidth) return racing(-inner) - slopeIntegral(d);
  const beyond = d - o.apronWidth,
    flatten = 3;
  return (
    racing(-inner) -
    slopeIntegral(o.apronWidth) -
    apron * (beyond - flatten * integral(beyond / flatten))
  );
}
export function laneBank(sample: RoadSample, lateral: number) {
  const delta = 0.02;
  return Math.atan(
    (ovalHeight(sample, lateral + delta) -
      ovalHeight(sample, lateral - delta)) /
      (2 * delta),
  );
}
/** A broad bank envelope based on distance, not a GP corner-strength multiplier. */
export function bankEnvelope(
  curvature: number,
  straight: number,
  turn: number,
) {
  return (
    straight +
    (turn - straight) * smooth((Math.abs(curvature) - 0.00012) / 0.0015)
  );
}
