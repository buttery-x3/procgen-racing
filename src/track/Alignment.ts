import { Vector3 } from "three";
import type { CircuitDefinition, ProfileKey, RoadSample } from "./types";

export const wrap = (value: number, length: number) =>
  ((value % length) + length) % length;
export const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * t * (10 + t * (-15 + t * 6));
};
export function profile(keys: ProfileKey[], fraction: number) {
  const u = wrap(fraction, 1);
  let low = 0,
    high = keys.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (keys[mid].at > u) high = mid;
    else low = mid + 1;
  }
  const next = low === keys.length ? -1 : low;
  const b = keys[next < 0 ? keys.length - 1 : next],
    a = keys[Math.max(0, (next < 0 ? keys.length - 1 : next) - 1)];
  const t = (u - a.at) / (b.at - a.at || 1);
  if (a.slope !== undefined && b.slope !== undefined) {
    const ds = b.at - a.at,
      d0 = a.slope * ds,
      d1 = b.slope * ds,
      c0 = (a.second ?? 0) * ds * ds,
      c1 = (b.second ?? 0) * ds * ds,
      e = b.value - a.value - d0 - c0 / 2,
      f = d1 - d0 - c0,
      g = c1 - c0,
      A = 10 * e - 4 * f + g / 2,
      B = -15 * e + 7 * f - g,
      C = 6 * e - 3 * f + g / 2;
    return {
      value:
        a.value +
        d0 * t +
        (c0 * t * t) / 2 +
        A * t ** 3 +
        B * t ** 4 +
        C * t ** 5,
      derivative:
        (d0 + c0 * t + 3 * A * t * t + 4 * B * t ** 3 + 5 * C * t ** 4) / ds,
    };
  }
  return {
    value: a.value + (b.value - a.value) * smooth(t),
    derivative:
      ((b.value - a.value) * 30 * t * t * (1 - t) ** 2) / (b.at - a.at || 1),
  };
}

/** Periodic uniform cubic B-spline: C2 joins, including the closing seam. */
export class Alignment {
  readonly length: number;
  private readonly arc: { t: number; s: number }[] = [{ t: 0, s: 0 }];
  constructor(readonly definition: CircuitDefinition) {
    if (definition.controlPoints.length < 6)
      throw new Error("A closed circuit requires at least six control points.");
    for (const p of definition.controlPoints)
      if (!Number.isFinite(p.x + p.z))
        throw new Error("Circuit coordinates must be finite.");
    for (const keys of [
      definition.elevation,
      definition.leftWidth,
      definition.rightWidth,
      definition.bankStrength,
      definition.crown,
      ...(definition.bank ? [definition.bank] : []),
    ]) {
      if (
        keys.length < 2 ||
        keys[0].at !== 0 ||
        keys.at(-1)!.at !== 1 ||
        keys[0].value !== keys.at(-1)!.value
      )
        throw new Error("Profiles must close at 0/1 with matching values.");
      keys.forEach((key, i) => {
        if (
          !Number.isFinite(key.at + key.value) ||
          (i > 0 && key.at <= keys[i - 1].at)
        )
          throw new Error("Profile keys must be finite and strictly ordered.");
      });
    }
    const count = definition.controlPoints.length * 128;
    let previous = this.curve(0).position,
      total = 0;
    for (let i = 1; i <= count; i++) {
      const t = (i / count) * definition.controlPoints.length;
      const point = this.curve(t).position;
      total += point.distanceTo(previous);
      this.arc.push({ t, s: total });
      previous = point;
    }
    this.length = total;
    if (total < 100)
      throw new Error("Circuit alignment is too short for the test venue.");
  }

  private curve(parameter: number) {
    const n = this.definition.controlPoints.length,
      t = wrap(parameter, n),
      i = Math.floor(t),
      f = t - i;
    const points = [-1, 0, 1, 2].map(
      (offset) => this.definition.controlPoints[wrap(i + offset, n)],
    );
    const b = [
      (1 - f) ** 3 / 6,
      (3 * f ** 3 - 6 * f * f + 4) / 6,
      (-3 * f ** 3 + 3 * f * f + 3 * f + 1) / 6,
      f ** 3 / 6,
    ];
    const d = [
      -((1 - f) ** 2) / 2,
      1.5 * f * f - 2 * f,
      -1.5 * f * f + f + 0.5,
      (f * f) / 2,
    ];
    const dd = [1 - f, 3 * f - 2, 1 - 3 * f, f];
    const combine = (weights: number[]) =>
      new Vector3(
        points.reduce((sum, p, j) => sum + p.x * weights[j], 0),
        0,
        points.reduce((sum, p, j) => sum + p.z * weights[j], 0),
      );
    return {
      position: combine(b),
      derivative: combine(d),
      second: combine(dd),
    };
  }

  sample(station: number): RoadSample {
    const s = wrap(station, this.length),
      fraction = s / this.length;
    let low = 0,
      high = this.arc.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (this.arc[mid].s < s) low = mid;
      else high = mid;
    }
    const a = this.arc[low],
      b = this.arc[high];
    const curve = this.curve(a.t + ((b.t - a.t) * (s - a.s)) / (b.s - a.s));
    const horizontalSpeed = curve.derivative.length();
    if (horizontalSpeed < 0.001)
      throw new Error("Circuit has a degenerate tangent.");
    const curvature =
      (curve.derivative.z * curve.second.x -
        curve.derivative.x * curve.second.z) /
      horizontalSpeed ** 3;
    const elevation = profile(this.definition.elevation, fraction);
    curve.position.y = elevation.value;
    const tangent = curve.derivative.clone().normalize();
    const left = new Vector3(tangent.z, 0, -tangent.x);
    const grade = elevation.derivative / this.length;
    const forward = tangent.clone().setY(grade).normalize();
    const strength = profile(this.definition.bankStrength, fraction).value;
    const explicitBank = this.definition.bank
      ? profile(this.definition.bank, fraction).value
      : 0;
    const bank = this.definition.bank
      ? explicitBank * curvature <= 0
        ? explicitBank * smooth((Math.abs(curvature) - 0.0005) / 0.001)
        : 0
      : ((-Math.tanh(curvature * 55) * strength * Math.PI) / 180) *
        smooth((Math.abs(curvature) - 0.002) / 0.006);
    const kerb = (side: "left" | "right") =>
      this.definition.kerbs.reduce((value, zone) => {
        if (
          zone.side !== side ||
          fraction <= zone.start ||
          fraction >= zone.end
        )
          return value;
        return Math.max(
          value,
          smooth(((fraction - zone.start) * this.length) / 8) *
            smooth(((zone.end - fraction) * this.length) / 8),
        );
      }, 0);
    const section = this.definition.sections.reduce(
      (selected, section) => (fraction >= section.start ? section : selected),
      this.definition.sections[0],
    );
    return {
      station: s,
      distance: 0,
      position: curve.position,
      forward,
      left,
      grade,
      curvature,
      bank,
      crown: profile(this.definition.crown, fraction).value,
      leftWidth: profile(this.definition.leftWidth, fraction).value,
      rightWidth: profile(this.definition.rightWidth, fraction).value,
      kerbLeft: kerb("left"),
      kerbRight: kerb("right"),
      section,
      ...(this.definition.venue
        ? {
            kerbHeight:
              this.definition.venue.settings.kerb === "raised" ? 0.075 : 0.035,
            runoffLeft: profile(this.definition.venue.leftRunoff, fraction)
              .value,
            runoffRight: profile(this.definition.venue.rightRunoff, fraction)
              .value,
            materialLeft:
              this.definition.venue.leftMaterial[
                Math.min(
                  this.definition.venue.leftMaterial.length - 1,
                  Math.floor(
                    fraction * this.definition.venue.leftMaterial.length,
                  ),
                )
              ],
            materialRight:
              this.definition.venue.rightMaterial[
                Math.min(
                  this.definition.venue.rightMaterial.length - 1,
                  Math.floor(
                    fraction * this.definition.venue.rightMaterial.length,
                  ),
                )
              ],
            pitSide:
              this.definition.venue.pit &&
              (s < this.definition.venue.pit.exit ||
                s > this.length + this.definition.venue.pit.entry)
                ? this.definition.venue.pit.side
                : undefined,
          }
        : {}),
    };
  }
}
