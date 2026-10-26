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
  const curvature = (i: number, points = positions) => {
    const a = points[wrap(i - 1, n)],
      b = points[i],
      c = points[(i + 1) % n];
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
      ...(definition.familyDesign
        ? [
            {
              vehicle: "stock",
              cap: 65,
              grip: 0.95,
              accel: 4.2,
              brake: 7.5,
              aero: 0.000012,
            } as const,
          ]
        : []),
    ] as const
  )
    .flatMap((config) => [
      { ...config, lane: "racing" as const },
      ...(definition.familyDesign?.oval && config.vehicle === "stock"
        ? ["low", "middle", "high"].map((lane) => ({
            ...config,
            lane: lane as "low" | "middle" | "high",
          }))
        : []),
    ])
    .map((config) => {
      // The original v2 line is kept byte-for-byte. Network venues add class width
      // margins; speedways also evaluate usable low, middle and high tyre paths.
      const classLateral = definition.familyDesign
        ? rows.map((r, i) => {
            let l =
              lateral[i] *
              (config.vehicle === "touring"
                ? 0.82
                : config.vehicle === "prototype"
                  ? 0.95
                  : 1);
            if (
              r.oval &&
              (config.lane !== "racing" || config.vehicle === "stock")
            ) {
              const factor =
                  config.lane === "low"
                    ? 0.58
                    : config.lane === "middle"
                      ? 0
                      : config.lane === "high"
                        ? -0.58
                        : -0.4,
                blend = r.oval.blend,
                width = factor * r.oval.inside > 0 ? r.leftWidth : r.rightWidth;
              l = l * (1 - blend) + factor * r.oval.inside * width * blend;
            }
            return l;
          })
        : lateral;
      if (definition.familyDesign) {
        const original = [...classLateral];
        for (let i = 0; i < n; i++) {
          let sum = 0,
            weight = 0;
          for (let j = -5; j <= 5; j++) {
            const w = Math.exp(-((j * ds) ** 2) / (2 * 45 ** 2));
            sum += original[wrap(i + j, n)] * w;
            weight += w;
          }
          classLateral[i] = sum / weight;
        }
      }
      const classPositions = definition.familyDesign
        ? rows.map((r, i) => roadPoint(r, classLateral[i]))
        : positions;
      const speeds = rows.map((r, i) => {
        const k = Math.max(0.00003, curvature(i, classPositions));
        let v = Math.min(config.cap, Math.sqrt((config.grip * 9.81) / k));
        if (r.oval) {
          const beta =
              -Math.sign(r.curvature || r.oval.inside) *
              Math.atan(
                (roadPoint(r, classLateral[i] + 0.02).y -
                  roadPoint(r, classLateral[i] - 0.02).y) /
                  0.04,
              ),
            c = Math.cos(beta),
            s = Math.sin(beta),
            a =
              (9.81 * (config.grip * c + s)) /
              Math.max(0.15, c - config.grip * s);
          v = Math.min(config.cap, Math.sqrt(Math.max(0, a) / k));
        }
        for (let pass = 0; pass < 3; pass++)
          v = r.oval
            ? v
            : Math.min(
                config.cap,
                Math.sqrt(
                  (config.grip *
                    9.81 *
                    (1 + config.aero * v * v + Math.abs(r.bank))) /
                    k,
                ),
              );
        for (const track of [-0.9, 0.9]) {
          const p = roadPoint(r, classLateral[i] + track),
            prev = roadPoint(
              rows[wrap(i - 1, n)],
              classLateral[wrap(i - 1, n)] + track,
            ),
            next = roadPoint(
              rows[(i + 1) % n],
              classLateral[(i + 1) % n] + track,
            );
          const second = (next.y - 2 * p.y + prev.y) / (ds * ds);
          if (second < 0) v = Math.min(v, Math.sqrt((0.3 * 9.81) / -second));
          else if (second > 0)
            v = Math.min(v, Math.sqrt((0.5 * 9.81) / second));
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
        ...(definition.familyDesign ? { lane: config.lane } : {}),
        points: classLateral.map((lateral, i) => ({
          at: i / n,
          lateral,
          speed: speeds[i],
        })),
      };
    });
}
