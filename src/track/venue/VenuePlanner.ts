import { Vector3 } from "three";
import { Alignment, smooth, wrap } from "../Alignment";
import { roadPoint, hydrateCircuit } from "../SurfaceCompiler";
import type { CircuitBake } from "../SurfaceCompiler";
import type {
  CircuitDefinition,
  ProfileKey,
  SurfaceId,
  KerbZone,
  RoadSample,
} from "../types";
import type { GenerationResult } from "../generationTypes";
import { hashSeed, terrainHeight } from "../Terrain";
import { seededRandom } from "../../core/math";
import type { Vec3 } from "../../vehicle/types";
import { pitOffset, pointInPad, roadDistance, vec } from "./geometry";
import { normalizeVenue } from "./types";
import type {
  VenueSettings,
  VenueDefinition,
  EscapeFan,
  PitLane,
} from "./types";

const circular = (a: number, b: number, length: number) =>
  Math.abs(wrap(a - b + length / 2, length) - length / 2);
interface Corner {
  start: number;
  end: number;
  apex: number;
  sign: number;
  radius: number;
}
function corners(rows: RoadSample[], ds: number) {
  const groups: Corner[] = [];
  let start = 0,
    sign = 0,
    angle = 0,
    peak = 0,
    apex = 0;
  const finish = (end: number) => {
    if (sign && angle > 0.3 && end - start > 15)
      groups.push({ start, end, apex, sign, radius: 1 / peak });
  };
  rows.forEach((r, i) => {
    const s = Math.abs(r.curvature) > 0.0014 ? Math.sign(r.curvature) : 0;
    if (s !== sign) {
      finish(i * ds);
      start = i * ds;
      angle = 0;
      peak = 0;
      sign = s;
    }
    angle += Math.abs(r.curvature) * ds;
    if (Math.abs(r.curvature) > peak) {
      peak = Math.abs(r.curvature);
      apex = i * ds;
    }
  });
  finish(rows.length * ds);
  return groups;
}
function keys(values: number[]): ProfileKey[] {
  return [
    ...values.map((value, i) => ({ at: i / values.length, value })),
    { at: 1, value: values[0] },
  ];
}
function capEnvelope(values: number[], ds: number, rate = 0.22) {
  const n = values.length;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n * 2; i++) {
      const a = i % n,
        b = (a + 1) % n;
      values[b] = Math.min(values[b], values[a] + ds * rate);
    }
    for (let i = n * 2 - 1; i >= 0; i--) {
      const a = i % n,
        b = (a + n - 1) % n;
      values[b] = Math.min(values[b], values[a] + ds * rate);
    }
  }
}
function expandEnvelope(values: number[], caps: number[], ds: number) {
  const n = values.length;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n * 2; i++) {
      const a = i % n,
        b = (a + 1) % n;
      values[b] = Math.min(caps[b], Math.max(values[b], values[a] - ds * 0.2));
    }
    for (let i = n * 2 - 1; i >= 0; i--) {
      const a = i % n,
        b = (a + n - 1) % n;
      values[b] = Math.min(caps[b], Math.max(values[b], values[a] - ds * 0.2));
    }
  }
}
function material(
  settings: VenueSettings,
  inside: boolean,
  index: number,
): SurfaceId {
  if (inside) return settings.theme === "desert" ? "sand" : "grass";
  if (settings.theme === "modern") return index % 5 === 4 ? "grass" : "runoff";
  if (settings.theme === "desert") return index % 3 === 2 ? "sand" : "runoff";
  if (settings.theme === "club") return index % 3 === 1 ? "gravel" : "grass";
  return index % 4 === 2 ? "runoff" : index % 4 === 3 ? "grass" : "gravel";
}
const recoveryDecel = (surface: SurfaceId) =>
  ({ runoff: 5, gravel: 3.3, sand: 2.6, grass: 1.65, asphalt: 5, kerb: 4 })[
    surface
  ];

/** M5 is a separately versioned construction pass. The accepted M4 alignment and
 * vertical road remain immutable; constrained run-off and facilities occupy its
 * reserved space. No substitute seed or unseen undressed fallback is allowed. */
export function planVenue(
  base: GenerationResult,
  input: VenueSettings,
  maxRunoff = 44,
): CircuitDefinition {
  if (
    base.recipe.version !== 2 ||
    base.circuit.definition.site.mesh !== "corridor"
  )
    throw new Error("Venue construction requires a v2 corridor circuit.");
  const settings = normalizeVenue(input),
    def = structuredClone(base.circuit.definition);
  delete def.venue;
  const circuit = hydrateCircuit(base.circuit),
    alignment = circuit.alignment,
    length = alignment.length;
  const n = Math.ceil(length / 8),
    ds = length / n,
    rows = Array.from({ length: n }, (_, i) => alignment.sample(i * ds)),
    turns = corners(rows, ds);
  const caps: [number[], number[]] = [[], []],
    widths: [number[], number[]] = [[], []],
    materials: [SurfaceId[], SurfaceId[]] = [[], []];
  for (let i = 0; i < n; i++)
    for (let side = 0; side < 2; side++) {
      const r = rows[i],
        sign = side === 0 ? 1 : -1,
        w = sign > 0 ? r.leftWidth : r.rightWidth;
      let cap = Math.min(
        maxRunoff,
        r.curvature * sign > 0
          ? 0.7 / Math.max(0.00001, Math.abs(r.curvature)) - w
          : maxRunoff,
      );
      for (let d = 4; d < cap; d += 3) {
        const p = roadPoint(r, sign * (w + d)),
          near = circuit.locate(p);
        if (
          circular(near.station, r.station, length) > Math.max(22, w * 3) &&
          Math.hypot(
            p.x - near.sample.position.x,
            p.z - near.sample.position.z,
          ) <
            w + d
        ) {
          cap = Math.max(4, d - 4);
          break;
        }
      }
      caps[side][i] = Math.max(4, cap);
      widths[side][i] = Math.min(
        caps[side][i],
        settings.theme === "modern" ? 8 : settings.theme === "club" ? 5 : 6,
      );
      const cornerIndex = turns.findIndex(
        (c) => r.station >= c.start - 60 && r.station <= c.end + 40,
      );
      materials[side][i] = material(
        settings,
        r.curvature * sign > 0.001 || cornerIndex < 0,
        Math.max(0, cornerIndex),
      );
    }
  caps.forEach((c) => capEnvelope(c, ds));
  widths.forEach((v, s) =>
    v.forEach((w, i) => (v[i] = Math.min(w, caps[s][i]))),
  );
  let pit: PitLane | undefined;
  const pad = def.site.paddock,
    grid = alignment.sample(0);
  if (settings.pits && pad) {
    let back = 0,
      front = 0;
    for (const direction of [-1, 1]) {
      let distance = 0;
      for (; distance < 230; distance += 4) {
        const r = alignment.sample(distance * direction);
        if (
          Math.abs(r.curvature) > 0.0015 ||
          Math.abs(r.grade) > 0.012 ||
          Math.abs(r.bank) > 0.012
        )
          break;
      }
      if (direction < 0) back = distance;
      else front = distance;
    }
    const extent = Math.min(back, front, pad.length / 2 + 42) - 10,
      merge = Math.min(52, extent * 0.38),
      side = Math.sign(
        (pad.centre.x - grid.position.x) * grid.left.x +
          (pad.centre.z - grid.position.z) * grid.left.z,
      ) as 1 | -1;
    if (extent < 65)
      throw new Error("Pit entry and exit need more level grid approach.");
    const width = base.recipe.family === "gp" ? 5 : 4.2,
      roadWidth = side > 0 ? grid.leftWidth : grid.rightWidth;
    pit = {
      side,
      entry: -extent,
      exit: extent,
      mergeLength: merge,
      offset: roadWidth + 8,
      joinOffset: roadWidth - width / 2 - 0.3,
      width,
      speedLimit: 50 / 3.6,
      points: [],
      apronStart: -Math.min(extent - merge, pad.length / 2),
      apronEnd: Math.min(extent - merge, pad.length / 2),
    };
    for (let s = pit.entry; s <= pit.exit + 0.1; s += 2) {
      const r = alignment.sample(s);
      pit.points.push(vec(roadPoint(r, side * pitOffset(pit, s, length))));
    }
    for (let i = 0; i < n; i++)
      if (circular(rows[i].station, 0, length) < extent + 8) {
        const offset = pitOffset(pit, rows[i].station, length),
          need = Math.max(5, offset - roadWidth + width / 2 + 3);
        if (caps[side > 0 ? 0 : 1][i] < need)
          throw new Error(
            "Pit merge conflicts with a nearby road or inner offset.",
          );
        widths[side > 0 ? 0 : 1][i] = Math.min(
          caps[side > 0 ? 0 : 1][i],
          Math.max(20, need),
        );
      }
  }
  const fans: EscapeFan[] = [];
  for (let index = 0; index < turns.length; index++) {
    const corner = turns[index],
      station = corner.start + Math.min(12, (corner.end - corner.start) * 0.12),
      r = alignment.sample(station),
      side = corner.sign > 0 ? "right" : "left",
      sideIndex = side === "left" ? 0 : 1,
      sign = sideIndex === 0 ? 1 : -1;
    const surface = material(settings, false, index),
      w = sign > 0 ? r.leftWidth : r.rightWidth;
    const start = roadPoint(r, sign * (w - 1));
    const paths: {
      point: Vec3;
      station: number;
      lateral: number;
      distance: number;
    }[][] = [];
    for (const angle of [-0.045, 0, 0.045]) {
      const heading = new Vector3(r.forward.x, 0, r.forward.z)
          .normalize()
          .applyAxisAngle(new Vector3(0, 1, 0), angle),
        path = [];
      for (let distance = 0; distance <= 120; distance += 3) {
        const p = start.clone().addScaledVector(heading, distance),
          near = circuit.locate(p),
          i = Math.floor(near.station / ds) % n;
        if (circular(near.station, station, length) > distance + 28) break;
        const outside =
            Math.abs(near.lateral) -
            (near.lateral >= 0
              ? near.sample.leftWidth
              : near.sample.rightWidth),
          which = near.lateral >= 0 ? 0 : 1;
        if (outside > caps[which][i] - 3) break;
        p.y = roadPoint(near.sample, near.lateral).y;
        path.push({
          point: vec(p),
          station: near.station,
          lateral: near.lateral,
          distance,
        });
      }
      paths.push(path);
    }
    const available = Math.min(...paths.map((p) => p.at(-1)?.distance ?? 0));
    if (available < 9) continue;
    const line = base.design?.referenceLines?.find(
      (l) => l.vehicle === (base.recipe.family === "gp" ? "gt" : "touring"),
    );
    const raw = Math.min(
      base.report.metrics.designSpeed,
      line?.points[Math.floor((station / length) * line.points.length)]
        ?.speed ?? Math.sqrt(0.85 * 9.81 * corner.radius),
    );
    const decel = Math.max(1, recoveryDecel(surface) + 9.81 * r.grade),
      reaction = 0.5,
      target = 12;
    const safe =
      -decel * reaction +
      Math.sqrt(
        (decel * reaction) ** 2 +
          target * target +
          2 * decel * Math.max(0, available - 3),
      );
    const designSpeed = Math.min(raw, safe),
      distance = Math.min(
        available - 2,
        designSpeed * reaction +
          Math.max(0, designSpeed * designSpeed - target * target) /
            (2 * decel),
      );
    const chosen = paths.map((path) =>
      path.filter((p) => p.distance <= distance),
    );
    for (let i = 0; i < n; i++)
      if (
        rows[i].station >= corner.start - 60 &&
        rows[i].station <= corner.end + 40 &&
        recoveryDecel(materials[sideIndex][i]) < recoveryDecel(surface)
      )
        materials[sideIndex][i] = surface;
    for (const path of chosen)
      for (const p of path) {
        const i = Math.floor(p.station / ds) % n,
          row = rows[i],
          s = p.lateral >= 0 ? 0 : 1,
          width = s === 0 ? row.leftWidth : row.rightWidth;
        widths[s][i] = Math.min(
          caps[s][i],
          Math.max(widths[s][i], Math.abs(p.lateral) - width + 3),
        );
        if (
          Math.abs(p.lateral) > width + 0.9 &&
          recoveryDecel(materials[s][i]) < recoveryDecel(surface)
        )
          materials[s][i] = surface;
      }
    fans.push({
      at: station / length,
      side,
      approachSpeed: raw,
      designSpeed,
      terminalSpeed: Math.min(designSpeed, target),
      spaceLimited: safe < raw - 0.5,
      paths: chosen.map((p) => p.map((q) => q.point)),
      available,
      surface,
    });
  }
  widths.forEach((v, i) => expandEnvelope(v, caps[i], ds));
  const zones: KerbZone[] = [];
  const addZone = (
    a: number,
    b: number,
    side: "left" | "right",
    role: KerbZone["role"],
  ) => {
    if (b - a < 12) return;
    const first = wrap(a, length),
      last = wrap(b, length);
    if (first < last)
      zones.push({ start: first / length, end: last / length, side, role });
    else {
      zones.push(
        { start: 0, end: last / length, side, role },
        { start: first / length, end: 1, side, role },
      );
    }
  };
  for (const corner of turns) {
    const span = corner.end - corner.start,
      inside = corner.sign > 0 ? "left" : "right",
      outside = inside === "left" ? "right" : "left";
    addZone(
      Math.max(corner.start, corner.apex - Math.min(30, span * 0.32)),
      Math.min(corner.end, corner.apex + Math.min(36, span * 0.35)),
      inside,
      "apex",
    );
    if (span > 38)
      addZone(corner.start - 18, corner.start + 10, outside, "entry");
    addZone(corner.end - 10, corner.end + 22, outside, "exit");
  }
  def.kerbs = zones.filter(
    (z) =>
      !pit ||
      (z.side === "left" ? 1 : -1) !== pit.side ||
      circular(((z.start + z.end) * length) / 2, 0, length) > pit.exit + 30,
  );
  const venue: VenueDefinition = {
    version: 1,
    settings,
    baseFingerprint: base.fingerprint,
    geometryFingerprint: "",
    sceneryFingerprint: "",
    leftRunoff: keys(widths[0]),
    rightRunoff: keys(widths[1]),
    leftMaterial: materials[0],
    rightMaterial: materials[1],
    fans,
    barriers: [],
    pit,
    props: [],
    report: {
      kerbs: def.kerbs.length,
      kerbCoverage: def.kerbs.reduce((s, z) => s + z.end - z.start, 0),
      maxRunoff: Math.max(...widths[0], ...widths[1]),
      spaceLimited: fans.filter((f) => f.spaceLimited).length,
      checks: [],
    },
  };
  def.venue = venue;
  def.starts[0] = {
    ...def.starts[0],
    at: 24 / length,
    description:
      "Starting grid. The chequered line is 12 metres ahead; follow the circuit and use the pit merge at the edge.",
  };
  const built = new Alignment(def),
    barrierKind = (
      {
        club: "guardrail",
        traditional: "tyres",
        modern: "impact",
        desert: "wall",
      } as const
    )[settings.theme];
  const count = Math.ceil(length / 4);
  for (const side of [1, -1] as const) {
    const groups: Vec3[][] = [[]];
    for (let i = 0; i <= count; i++) {
      const s = (i / count) * length,
        r = built.sample(s),
        skip =
          pit && pit.side === side && circular(s, 0, length) < pit.exit + 8;
      if (skip) {
        if (groups.at(-1)!.length) groups.push([]);
        continue;
      }
      const edge =
        side > 0 ? r.leftWidth + r.runoffLeft! : -r.rightWidth - r.runoffRight!;
      groups.at(-1)!.push(vec(roadPoint(r, edge - side * 0.7)));
    }
    for (const points of groups.filter((g) => g.length > 2))
      venue.barriers.push({
        id: `perimeter-${side}-${venue.barriers.length}`,
        kind: barrierKind,
        points,
        width: barrierKind === "tyres" ? 1.1 : 0.6,
        height: barrierKind === "tyres" ? 0.95 : 1.05,
        closed: !pit || pit.side !== side,
      });
  }
  if (pit) {
    const points: Vec3[] = [];
    for (
      let s = pit.entry + pit.mergeLength + 3;
      s <= pit.exit - pit.mergeLength - 3;
      s += 2
    ) {
      const r = built.sample(s);
      points.push(
        vec(
          roadPoint(
            r,
            pit.side * ((pit.side > 0 ? r.leftWidth : r.rightWidth) + 3.0),
          ),
        ),
      );
    }
    if (points.length > 2)
      venue.barriers.push({
        id: "pit-wall",
        kind: "wall",
        points,
        width: 0.55,
        height: 0.9,
        closed: false,
      });
    def.starts.push({
      id: "pit",
      name: "Pit lane",
      at: wrap(pit.entry + pit.mergeLength + 12, length) / length,
      lateral: pit.side * pit.offset,
      description:
        "50 km/h pit lane. Follow the white merge line back onto the circuit.",
    });
  }
  if (pad && pit) {
    const outward = new Vector3(
        grid.left.x * pit.side,
        0,
        grid.left.z * pit.side,
      ),
      start = new Vector3(
        pad.centre.x,
        pad.height,
        pad.centre.z,
      ).addScaledVector(outward, 20);
    let distance = 90,
      finish = start.clone().addScaledVector(outward, distance);
    finish.y = terrainHeight(def.site, finish.x, finish.z);
    for (let pass = 0; pass < 5; pass++) {
      const required = Math.max(
        90,
        (Math.abs(finish.y - start.y) * 1.875) / 0.12,
      );
      if (required <= distance) break;
      distance = required + 8;
      finish = start.clone().addScaledVector(outward, distance);
      finish.y = terrainHeight(def.site, finish.x, finish.z);
    }
    venue.access = {
      width: 6,
      points: Array.from({ length: 31 }, (_, i) => {
        const t = i / 30,
          p = start.clone().lerp(finish, t);
        p.y = start.y + (finish.y - start.y) * smooth(t);
        return vec(p);
      }),
    };
  }
  for (const fan of fans)
    for (const distance of [150, 100, 50]) {
      if (distance === 150 && base.recipe.family === "touring") continue;
      const s = wrap(fan.at * length - distance, length),
        r = built.sample(s),
        side = fan.side === "left" ? 1 : -1,
        extent =
          side > 0
            ? r.leftWidth + r.runoffLeft!
            : -r.rightWidth - r.runoffRight!;
      if (pit && circular(s, 0, length) < pit.exit + 20) continue;
      venue.props.push({
        kind: "board",
        position: vec(roadPoint(r, extent + side * 1.8)),
        heading: Math.atan2(-r.forward.x, -r.forward.z),
        scale: 1,
        label: String(distance),
      });
    }
  for (let i = 0; i < turns.length; i++) {
    const r = built.sample(turns[i].start),
      side = turns[i].sign > 0 ? -1 : 1,
      extent =
        side > 0 ? r.leftWidth + r.runoffLeft! : -r.rightWidth - r.runoffRight!;
    venue.props.push({
      kind: "marshal",
      position: vec(roadPoint(r, extent + side * 3)),
      heading: Math.atan2(-side * r.left.x, -side * r.left.z),
      scale: 1,
      label: `${i + 1}`,
    });
  }
  if (pad && pit) {
    const count =
      settings.theme === "club" ? 5 : base.recipe.family === "gp" ? 12 : 8;
    for (let i = 0; i < count; i++) {
      const s = (i - (count - 1) / 2) * 12;
      venue.props.push({
        kind: "garage",
        position: {
          x: pad.centre.x + pad.forward.x * s,
          y: pad.height,
          z: pad.centre.z + pad.forward.z * s,
        },
        heading: Math.atan2(-pit.side * grid.left.x, -pit.side * grid.left.z),
        scale: 1,
        label: String(i + 1).padStart(2, "0"),
        solid: true,
      });
    }
  }
  for (let i = 0; i < (settings.theme === "club" ? 2 : 6); i++) {
    const r = built.sample(((i + 0.37) / 6) * length),
      side = i % 2 ? 1 : -1,
      extent =
        side > 0 ? r.leftWidth + r.runoffLeft! : -r.rightWidth - r.runoffRight!,
      p = roadPoint(r, extent + side * 17);
    if (pad && pointInPad(p, pad, 22)) continue;
    const nearest = circuit.locate(p);
    if (
      Math.abs(nearest.lateral) <
      Math.max(nearest.sample.leftWidth, nearest.sample.rightWidth) + 14
    )
      continue;
    venue.props.push({
      kind: "stand",
      position: vec(p),
      heading: Math.atan2(-side * r.left.x, -side * r.left.z),
      scale: settings.theme === "club" ? 0.65 : 1,
    });
  }
  for (let i = 0; i < Math.ceil(length / 300); i++) {
    const r = built.sample(i * 300),
      side = i % 2 ? 1 : -1,
      extent =
        side > 0 ? r.leftWidth + r.runoffLeft! : -r.rightWidth - r.runoffRight!;
    venue.props.push({
      kind: "marker",
      position: vec(roadPoint(r, extent + side * 1.5)),
      heading: Math.atan2(-r.forward.x, -r.forward.z),
      scale: 1,
      label: `${Math.round(i * 0.3 * 10) / 10} km`,
    });
  }
  return def;
}

/** Decoration uses only its own stream and the final shared surface. It cannot
 * change run-off, barriers, pits, colliders or the vehicle's setup. */
export function populateVegetation(
  circuit: CircuitBake,
  ground: (
    x: number,
    z: number,
  ) => { height: number; surface: SurfaceId } | undefined,
) {
  const venue = circuit.definition.venue!;
  venue.props = venue.props.filter(
    (p) => p.kind !== "tree" && p.kind !== "bush",
  );
  const random = seededRandom(
    hashSeed(`${venue.baseFingerprint}/${venue.settings.scenerySeed}`),
  );
  const terrain = circuit.chunks.filter((c) => c.kind === "terrain"),
    length = circuit.length,
    pad = circuit.definition.site.paddock,
    near = hydrateCircuit(circuit);
  const count = Math.round(
    length *
      (venue.settings.scenery === "sparse"
        ? 0.06
        : venue.settings.scenery === "dense"
          ? 0.25
          : 0.13),
  );
  const sight = Array.from({ length: Math.ceil(length / 30) }, (_, i) => {
    const a = near.alignment.sample(i * 30),
      b = near.alignment.sample(i * 30 + 60);
    return { points: [vec(a.position), vec(b.position)], width: 12 };
  });
  for (
    let attempt = 0, placed = 0;
    attempt < count * 5 && placed < count;
    attempt++
  ) {
    const chunk = terrain[Math.floor(random() * terrain.length)];
    if (!chunk) break;
    const t = Math.floor((random() * chunk.indices.length) / 3) * 3,
      a = chunk.indices[t] * 3,
      b = chunk.indices[t + 1] * 3,
      c = chunk.indices[t + 2] * 3,
      v = chunk.vertices;
    let u = random(),
      w = random();
    if (u + w > 1) {
      u = 1 - u;
      w = 1 - w;
    }
    const x = v[a] + u * (v[b] - v[a]) + w * (v[c] - v[a]),
      z = v[a + 2] + u * (v[b + 2] - v[a + 2]) + w * (v[c + 2] - v[a + 2]),
      height = ground(x, z);
    if (!height || !["grass", "sand"].includes(height.surface)) continue;
    if (pad && pointInPad({ x, z }, pad, 14)) continue;
    if (
      venue.access &&
      roadDistance(venue.access, x, z).distance < venue.access.width / 2 + 10
    )
      continue;
    const r = near.locate({ x, y: height.height, z }),
      side = r.lateral >= 0 ? 1 : -1,
      edge =
        side > 0
          ? r.sample.leftWidth + r.sample.runoffLeft!
          : r.sample.rightWidth + r.sample.runoffRight!;
    if (Math.abs(r.lateral) < edge + 10) continue;
    if (sight.some((line) => roadDistance(line, x, z).distance < 8)) continue;
    if (
      venue.props.some(
        (p) =>
          p.kind !== "tree" &&
          p.kind !== "bush" &&
          Math.hypot(p.position.x - x, p.position.z - z) < 18,
      )
    )
      continue;
    const kind =
      venue.settings.theme === "desert" || random() < 0.3 ? "bush" : "tree";
    venue.props.push({
      kind,
      position: { x, y: height.height, z },
      heading: random() * Math.PI * 2,
      scale: 0.7 + random() * 0.8,
    });
    placed++;
  }
  venue.sceneryFingerprint = `scenery-${hashSeed(JSON.stringify(venue.props.filter((p) => p.kind === "tree" || p.kind === "bush"))).toString(16)}`;
}
