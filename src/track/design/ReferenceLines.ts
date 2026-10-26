import { Alignment, wrap } from "../Alignment";
import { roadPoint } from "../SurfaceCompiler";
import type { CircuitDefinition } from "../types";
import type { DesignReport } from "../generationTypes";

/** A bounded minimum-curvature line, then separate vehicle speed envelopes.
 * These are design estimates, not AI control or claimed racing lap times. */
export function referenceLines(
  definition: CircuitDefinition,
): NonNullable<DesignReport["referenceLines"]> {
  const path = new Alignment(definition),
    n = Math.ceil(path.length / 18),
    ds = path.length / n;
  const rows = Array.from({ length: n }, (_, i) => path.sample(i * ds));
  const lateral = Array.from({ length: n }, () => 0);
  const positions = rows.map((r) => roadPoint(r, 0));
  const curvature = (i: number) => {
    const a = positions[wrap(i - 1, n)],
      b = positions[i],
      c = positions[(i + 1) % n];
    const ab = Math.hypot(b.x - a.x, b.z - a.z),
      bc = Math.hypot(c.x - b.x, c.z - b.z),
      ca = Math.hypot(a.x - c.x, a.z - c.z);
    return (
      (2 * Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x))) /
      Math.max(1e-6, ab * bc * ca)
    );
  };
  const energy = (i: number) =>
    [wrap(i - 1, n), i, (i + 1) % n].reduce(
      (s, j) => s + curvature(j) ** 2,
      0,
    ) +
    lateral[i] ** 2 * 0.00000001;
  for (const step of [0.6, 0.3, 0.15])
    for (let pass = 0; pass < 12; pass++)
      for (let i = 0; i < n; i++) {
        if (Math.min(i * ds, path.length - i * ds) < 170) continue;
        const current = lateral[i];
        let best = current,
          cost = energy(i);
        for (const offset of [-step, step]) {
          const proposed = Math.max(
            -rows[i].rightWidth + 2,
            Math.min(rows[i].leftWidth - 2, current + offset),
          );
          lateral[i] = proposed;
          positions[i] = roadPoint(rows[i], proposed);
          const score = energy(i);
          if (score < cost) {
            cost = score;
            best = proposed;
          }
        }
        lateral[i] = best;
        positions[i] = roadPoint(rows[i], best);
      }
  // Bound lateral slope across short complexes, preserving a usable tyre margin.
  for (let pass = 0; pass < 4; pass++)
    for (let i = 0; i < n; i++) {
      const previous = wrap(i - 1, n);
      lateral[i] = Math.max(
        lateral[previous] - 0.045 * ds,
        Math.min(lateral[previous] + 0.045 * ds, lateral[i]),
      );
      positions[i] = roadPoint(rows[i], lateral[i]);
    }
  return (
    [
      { vehicle: "touring", cap: 42, grip: 0.8, accel: 3.5, brake: 7, aero: 0 },
      { vehicle: "gt", cap: 62, grip: 1, accel: 5, brake: 9, aero: 0.000035 },
      {
        vehicle: "prototype",
        cap: 78,
        grip: 1.1,
        accel: 7,
        brake: 11,
        aero: 0.00006,
      },
    ] as const
  ).map((config) => {
    const speeds = rows.map((r, i) => {
      const k = Math.max(0.00003, curvature(i));
      let v = Math.min(config.cap, Math.sqrt((config.grip * 9.81) / k));
      for (let pass = 0; pass < 3; pass++)
        v = Math.min(
          config.cap,
          Math.sqrt(
            (config.grip *
              9.81 *
              (1 + config.aero * v * v + Math.abs(r.bank))) /
              k,
          ),
        );
      for (const track of [-0.9, 0.9]) {
        const p = roadPoint(r, lateral[i] + track),
          prev = roadPoint(
            rows[wrap(i - 1, n)],
            lateral[wrap(i - 1, n)] + track,
          ),
          next = roadPoint(rows[(i + 1) % n], lateral[(i + 1) % n] + track);
        const second = (next.y - 2 * p.y + prev.y) / (ds * ds);
        if (second < 0) v = Math.min(v, Math.sqrt((0.3 * 9.81) / -second));
        else if (second > 0) v = Math.min(v, Math.sqrt((0.5 * 9.81) / second));
      }
      return v;
    });
    for (let pass = 0; pass < 5; pass++) {
      for (let i = 0; i < n; i++) {
        const prev = wrap(i - 1, n);
        speeds[i] = Math.min(
          speeds[i],
          Math.sqrt(
            speeds[prev] ** 2 +
              2 * Math.max(0.8, config.accel - rows[i].grade * 9.81) * ds,
          ),
        );
      }
      for (let i = n - 1; i >= 0; i--) {
        const next = (i + 1) % n;
        speeds[i] = Math.min(
          speeds[i],
          Math.sqrt(
            speeds[next] ** 2 +
              2 * Math.max(2, config.brake + rows[i].grade * 9.81) * ds,
          ),
        );
      }
    }
    return {
      vehicle: config.vehicle,
      points: lateral.map((lateral, i) => ({
        at: i / n,
        lateral,
        speed: speeds[i],
      })),
    };
  });
}
