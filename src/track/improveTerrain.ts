/** Improve only the retained terrain faces. Boundary edges cannot flip, and a
 * strictly convex quad is required. Near-cocircular decisions keep their current
 * diagonal, avoiding exact in-circle work for unused road-hole triangulation.
 * CDT supplies the valid constrained domain; these local flips preserve it. */
export function improveTerrain(points: number[][], input: number[][]) {
  const cross = (a: number, b: number, c: number) =>
    (points[b][0] - points[a][0]) * (points[c][1] - points[a][1]) -
    (points[b][1] - points[a][1]) * (points[c][0] - points[a][0]);
  const faces = input.map(([a, b, c]) =>
    cross(a, b, c) > 0 ? [a, b, c] : [a, c, b],
  );
  const size = points.length,
    edges = new Map<number, number[]>(),
    stack: number[] = [];
  const key = (a: number, b: number) => Math.min(a, b) * size + Math.max(a, b);
  const insert = (index: number) => {
    const f = faces[index];
    for (let i = 0; i < 3; i++) {
      const k = key(f[i], f[(i + 1) % 3]);
      let adjacent = edges.get(k);
      if (!adjacent) {
        adjacent = [];
        edges.set(k, adjacent);
      }
      adjacent.push(index);
      if (adjacent.length === 2) stack.push(k);
    }
  };
  const remove = (index: number) => {
    const f = faces[index];
    for (let i = 0; i < 3; i++) {
      const k = key(f[i], f[(i + 1) % 3]),
        adjacent = edges.get(k)!;
      adjacent.splice(adjacent.indexOf(index), 1);
      if (!adjacent.length) edges.delete(k);
    }
  };
  faces.forEach((_, i) => insert(i));
  let flips = 0;
  while (stack.length) {
    const k = stack.pop()!,
      adjacent = edges.get(k);
    if (adjacent?.length !== 2) continue;
    const [fi, gi] = adjacent,
      a = Math.floor(k / size),
      b = k % size,
      f = faces[fi],
      g = faces[gi];
    const c = f.find((i) => i !== a && i !== b)!,
      d = g.find((i) => i !== a && i !== b)!;
    if (c === d || edges.has(key(c, d))) continue;
    const ca = cross(c, d, a),
      cb = cross(c, d, b);
    if (ca * cb >= 0 || Math.min(Math.abs(ca), Math.abs(cb)) < 1e-8) continue;
    const [ia, ib, ic] = f.map((i) => [
      points[i][0] - points[d][0],
      points[i][1] - points[d][1],
    ]);
    const al = ia[0] ** 2 + ia[1] ** 2,
      bl = ib[0] ** 2 + ib[1] ** 2,
      cl = ic[0] ** 2 + ic[1] ** 2;
    const ab = ia[0] * ib[1] - ia[1] * ib[0],
      bc = ib[0] * ic[1] - ib[1] * ic[0],
      ac = ia[0] * ic[1] - ia[1] * ic[0];
    const determinant = al * bc - bl * ac + cl * ab;
    const tolerance =
      1e-12 * (Math.abs(al * bc) + Math.abs(bl * ac) + Math.abs(cl * ab)) +
      1e-8;
    if (determinant <= tolerance) continue;
    remove(fi);
    remove(gi);
    faces[fi] = cross(c, d, a) > 0 ? [c, d, a] : [c, a, d];
    faces[gi] = cross(d, c, b) > 0 ? [d, c, b] : [d, b, c];
    insert(fi);
    insert(gi);
    if (++flips > faces.length * 80)
      throw new Error("Terrain angle refinement exceeded its bounded budget.");
  }
  return faces;
}
