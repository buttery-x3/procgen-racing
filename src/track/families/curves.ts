import type { CircuitDefinition } from "../types";
import type { FamilyDesign } from "./types";

export interface Point2 {
  x: number;
  z: number;
}
export const distance = (a: Point2, b: Point2) =>
  Math.hypot(b.x - a.x, b.z - a.z);
export const lerp = (a: Point2, b: Point2, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});
/** Round each inherited junction within an explicit construction footprint,
 * then sample at physical spacing for the periodic C2 fitting backend. */
export function roundedControls(input: Point2[], radius: number, spacing = 12) {
  const p = input.filter((v, i) => !i || distance(v, input[i - 1]) > 0.01),
    dense: Point2[] = [];
  if (distance(p[0], p.at(-1)!) < 0.01) p.pop();
  for (let i = 0; i < p.length; i++) {
    const a = p[(i + p.length - 1) % p.length],
      b = p[i],
      c = p[(i + 1) % p.length],
      ab = distance(a, b),
      bc = distance(b, c),
      ux = (b.x - a.x) / ab,
      uz = (b.z - a.z) / ab,
      vx = (c.x - b.x) / bc,
      vz = (c.z - b.z) / bc,
      angle = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    if (angle < 0.015) {
      dense.push({ ...b });
      continue;
    }
    const trim = Math.min(radius * Math.tan(angle / 2), ab * 0.47, bc * 0.47),
      start = { x: b.x - ux * trim, z: b.z - uz * trim },
      actualRadius = trim / Math.tan(angle / 2),
      turn = Math.sign(ux * vz - uz * vx),
      centre = {
        x: start.x - uz * actualRadius * turn,
        z: start.z + ux * actualRadius * turn,
      },
      startAngle = Math.atan2(start.z - centre.z, start.x - centre.x),
      steps = Math.max(8, Math.ceil((actualRadius * angle) / 3));
    for (let j = 0; j <= steps; j++) {
      const theta = startAngle + (turn * angle * j) / steps;
      dense.push({
        x: centre.x + actualRadius * Math.cos(theta),
        z: centre.z + actualRadius * Math.sin(theta),
      });
    }
  }
  return resampleLoop(dense, spacing);
}
export function resampleLoop(points: Point2[], spacing: number) {
  const cumulative = [0];
  for (let i = 0; i < points.length; i++)
    cumulative.push(
      cumulative.at(-1)! + distance(points[i], points[(i + 1) % points.length]),
    );
  const length = cumulative.at(-1)!,
    n = Math.max(12, Math.ceil(length / spacing)),
    out: Point2[] = [];
  let edge = 0;
  for (let i = 0; i < n; i++) {
    const s = (i * length) / n;
    while (cumulative[edge + 1] < s) edge++;
    out.push(
      lerp(
        points[edge],
        points[(edge + 1) % points.length],
        (s - cumulative[edge]) / (cumulative[edge + 1] - cumulative[edge]),
      ),
    );
  }
  return out;
}
export function rotateControls(points: Point2[], grid: Point2) {
  let index = 0;
  for (let i = 1; i < points.length; i++)
    if (distance(points[i], grid) < distance(points[index], grid)) index = i;
  return [...points.slice(index), ...points.slice(0, index)];
}
const constant = (value: number) => [
  { at: 0, value },
  { at: 1, value },
];
export function emptyDefinition(
  id: string,
  name: string,
  controlPoints: Point2[],
  familyDesign: FamilyDesign,
): CircuitDefinition {
  return {
    id,
    name,
    controlPoints,
    elevation: constant(2),
    leftWidth: constant(7),
    rightWidth: constant(7),
    bankStrength: constant(0),
    bank: constant(0),
    crown: constant(0.025),
    kerbs: [],
    sections: [{ start: 0, name: "Starting straight", runoff: "grass" }],
    starts: [
      {
        id: "start",
        name: "Starting grid",
        at: 0.01,
        description:
          "Closed circuit. Follow the arrows; R returns to this start.",
      },
    ],
    familyDesign,
    site: {
      centre: { x: 0, z: 0 },
      radius: Math.max(...controlPoints.map((p) => Math.hypot(p.x, p.z))) + 250,
      mesh: "corridor",
    },
  };
}
