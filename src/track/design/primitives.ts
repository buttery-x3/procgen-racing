/** Analytical proposal geometry, adapted from buttery-x3/drift-minigame
 * TrackGeometry.ts at 641ddddacc167f4d1ff4fbff3df93ca6d40dabb1.
 * x/z coordinates here use heading 0 along +x; positive sweep turns toward +z.
 * These G1 primitives propose a route; they are NOT the final driving alignment.
 */
export interface Point {
  x: number;
  z: number;
}
export interface Pose extends Point {
  heading: number;
}
export interface Piece {
  start: Pose;
  end: Pose;
  length: number;
  radius: number;
  sweep: number;
  centre?: Point;
  role: string;
  closing: boolean;
}
const tau = Math.PI * 2;
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.z - b.z);
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const forward = (h: number): Point => ({ x: Math.cos(h), z: Math.sin(h) });
const normal = (h: number): Point => ({ x: -Math.sin(h), z: Math.cos(h) });
const dot = (a: Point, b: Point) => a.x * b.x + a.z * b.z;

export function straight(start: Pose, length: number, role = "link"): Piece {
  const f = forward(start.heading);
  return {
    start: { ...start },
    end: {
      x: start.x + f.x * length,
      z: start.z + f.z * length,
      heading: start.heading,
    },
    length,
    radius: 0,
    sweep: 0,
    role,
    closing: false,
  };
}
export function corner(
  start: Pose,
  radius: number,
  sweep: number,
  role = "bend",
  closing = false,
): Piece {
  const signed = radius * Math.sign(sweep),
    n = normal(start.heading),
    heading = start.heading + sweep;
  const centre = { x: start.x + n.x * signed, z: start.z + n.z * signed },
    endNormal = normal(heading);
  return {
    start: { ...start },
    end: {
      x: centre.x - endNormal.x * signed,
      z: centre.z - endNormal.z * signed,
      heading,
    },
    length: radius * Math.abs(sweep),
    radius,
    sweep,
    centre,
    role,
    closing,
  };
}
function arcTo(start: Pose, end: Point): Piece | undefined {
  const d = { x: end.x - start.x, z: end.z - start.z },
    n = normal(start.heading),
    den = 2 * dot(d, n);
  if (Math.abs(den) < 1e-7) return;
  const r = dot(d, d) / den,
    centre = { x: start.x + n.x * r, z: start.z + n.z * r };
  const h = Math.atan2((end.x - centre.x) / r, -(end.z - centre.z) / r);
  let sweep = wrapAngle(h - start.heading);
  if (r > 0 && sweep <= 0) sweep += tau;
  if (r < 0 && sweep >= 0) sweep -= tau;
  return corner(start, Math.abs(r), sweep, "closure", true);
}
export function biarc(start: Pose, end: Pose): Piece[] | undefined {
  const a = forward(start.heading),
    b = forward(end.heading),
    d = { x: end.x - start.x, z: end.z - start.z };
  const ab = dot(a, b),
    db = dot(d, { x: a.x + b.x, z: a.z + b.z }),
    dd = dot(d, d);
  const t =
    Math.abs(1 - ab) < 1e-7
      ? dd / (2 * db)
      : (-db + Math.sqrt(db * db + 2 * (1 - ab) * dd)) / (2 * (1 - ab));
  if (!Number.isFinite(t) || t <= 1e-7) return;
  const join = {
    x: (start.x + end.x + (a.x - b.x) * t) / 2,
    z: (start.z + end.z + (a.z - b.z) * t) / 2,
  };
  const first = arcTo(start, join),
    reversed = arcTo({ ...end, heading: end.heading + Math.PI }, join);
  if (!first || !reversed) return;
  const second = corner(
    { ...join, heading: reversed.end.heading + Math.PI },
    reversed.radius,
    -reversed.sweep,
    "closure",
    true,
  );
  if (
    Math.abs(wrapAngle(first.end.heading - second.start.heading)) > 1e-5 ||
    distance(second.end, end) > 1e-4
  )
    return;
  return [first, second];
}
export function pointOn(piece: Piece, fraction: number): Pose {
  if (!piece.centre)
    return {
      x: piece.start.x + (piece.end.x - piece.start.x) * fraction,
      z: piece.start.z + (piece.end.z - piece.start.z) * fraction,
      heading: piece.start.heading,
    };
  const heading = piece.start.heading + piece.sweep * fraction,
    n = normal(heading),
    r = piece.radius * Math.sign(piece.sweep);
  return { x: piece.centre.x - n.x * r, z: piece.centre.z - n.z * r, heading };
}
export function sampleChain(pieces: Piece[], count: number): Point[] {
  const length = pieces.reduce((sum, p) => sum + p.length, 0);
  let index = 0,
    start = 0;
  return Array.from({ length: count }, (_, i) => {
    const s = (i * length) / count;
    while (index < pieces.length - 1 && start + pieces[index].length < s)
      start += pieces[index++].length;
    return pointOn(pieces[index], (s - start) / pieces[index].length);
  });
}
export function pointSegmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1),
    ),
  );
  return distance(p, { x: a.x + t * dx, z: a.z + t * dz });
}
export function intersects(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const ab = cross(a, b, c),
    ad = cross(a, b, d),
    cd = cross(c, d, a),
    cb = cross(c, d, b);
  if (ab * ad < 0 && cd * cb < 0) return true;
  return (
    Math.min(
      pointSegmentDistance(a, c, d),
      pointSegmentDistance(b, c, d),
      pointSegmentDistance(c, a, b),
      pointSegmentDistance(d, a, b),
    ) < 1e-7
  );
}
