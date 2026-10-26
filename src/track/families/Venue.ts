import { Alignment, smooth, wrap } from "../Alignment";
import { periodicProfile, smoothSamples } from "../design/RoadProfiles";
import {
  bakeCircuit,
  compileCircuit,
  hydrateCircuit,
  roadPoint,
} from "../SurfaceCompiler";
import { surfaceQuery } from "../SurfaceQuery";
import { hashSeed } from "../Terrain";
import { seededRandom } from "../../core/math";
import { normalizeVenue, venueGeometrySettings } from "../venue/types";
import { populateVegetation } from "../venue/VenuePlanner";
import { pitOffset, pointInPad, vec } from "../venue/geometry";
import type {
  VenueSettings,
  VenueDefinition,
  PitLane,
  BarrierPath,
} from "../venue/types";
import type { GenerationResult, GenerationProgress } from "../generationTypes";
import type { SurfaceId } from "../types";
import type { PropertyLot } from "./types";
import type { CompiledCircuit } from "../SurfaceCompiler";
import { Vector3 } from "three";

function inLot(p: { x: number; z: number }, lot: PropertyLot, margin = 0) {
  const dx = p.x - lot.centre.x,
    dz = p.z - lot.centre.z,
    c = Math.cos(lot.heading),
    s = Math.sin(lot.heading);
  return (
    Math.abs(dx * c - dz * s) < lot.width / 2 + margin &&
    Math.abs(dx * s + dz * c) < lot.length / 2 + margin
  );
}
export function clearFamilyVegetation(
  circuit: Pick<CompiledCircuit, "definition">,
) {
  const meta = circuit.definition.familyDesign,
    venue = circuit.definition.venue;
  if (meta?.family === "street" && venue)
    venue.props = venue.props.filter(
      (p) =>
        !["tree", "bush"].includes(p.kind) ||
        !meta.network.lots.some(
          (l) => l.use === "building" && inLot(p.position, l),
        ),
    );
}
export function checkFamilyConstruction(compiled: CompiledCircuit) {
  const venue = compiled.definition.venue;
  if (!venue) return [];
  const ground = surfaceQuery(compiled);
  for (const p of venue.pit?.points ?? []) {
    const hit = ground(p.x, p.z);
    if (!hit || !["asphalt", "runoff"].includes(hit.surface))
      throw new Error("The pit branch crosses a non-paved surface.");
  }
  for (const barrier of venue.barriers)
    for (const p of barrier.points) {
      const r = compiled.locate(p),
        width = r.lateral >= 0 ? r.sample.leftWidth : r.sample.rightWidth;
      if (Math.abs(r.lateral) < width + 1)
        throw new Error("A family barrier overlaps another racing leg.");
    }
  return [
    {
      name: "Restored venue & branch surfaces",
      status: "pass" as const,
      detail:
        "Accepted barrier paths clear the racing ribbon; the complete saved pit route is paved.",
    },
  ];
}
function taper(values: number[], ds: number, rate = 0.16) {
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

/** Family-specific construction. An inherited road retains constrained escapes;
 * an oval gets an apron and wall instead of GP apex kerbs/run-off policy. */
export function constructFamilyVenue(
  base: GenerationResult,
  input: VenueSettings,
  progress: (p: GenerationProgress) => void = () => {},
): GenerationResult {
  const settings = normalizeVenue(input);
  if (!settings.enabled) return base;
  const result = structuredClone(base),
    def = result.circuit.definition,
    meta = def.familyDesign!,
    recipe = result.recipe;
  if (recipe.version !== 3)
    throw new Error("M7 construction requires a v3 design.");
  const path = new Alignment(def),
    length = path.length,
    n = Math.ceil(length / 12),
    ds = length / n,
    rows = Array.from({ length: n }, (_, i) => path.sample(i * ds)),
    street = meta.family === "street",
    airfield = meta.family === "airfield",
    mountain = meta.family === "mountain",
    oval = !!meta.oval,
    widths: [number[], number[]] = [[], []],
    materials: [SurfaceId[], SurfaceId[]] = [[], []],
    random = seededRandom(hashSeed(`${recipe.seed}/construction-v3`));
  progress({
    stage: "Fitting walls, aprons, inherited junction escapes and pit branches",
    fraction: 0.82,
  });
  rows.forEach((r, i) => {
    for (const side of [1, -1] as const) {
      const index = side === 1 ? 0 : 1,
        inside = side * r.curvature > 0,
        edge = side > 0 ? r.leftWidth : r.rightWidth,
        speedway = (r.oval?.blend ?? 0) > 0.5;
      let extent = speedway
        ? side === r.oval!.inside
          ? 9.5
          : 3.5
        : street
          ? 3.5
          : mountain
            ? inside
              ? 5
              : 12
            : airfield
              ? inside
                ? 9
                : 32
              : inside
                ? 9
                : 44;
      // Existing side roads supply a paved escape pocket at a fitted city junction.
      if (street && Math.abs(r.curvature) > 0.007 && !inside) extent = 18;
      if (inside && Math.abs(r.curvature) > 0.0001)
        extent = Math.min(extent, 0.68 / Math.abs(r.curvature) - edge);
      for (const lot of meta.network.lots.filter(
        (l) => l.use === "exclusion",
      )) {
        const p = roadPoint(r, side * (edge + extent));
        if (inLot(p, lot, 5)) {
          let lo = 3.5,
            hi = extent;
          for (let k = 0; k < 8; k++) {
            const m = (lo + hi) / 2;
            if (inLot(roadPoint(r, side * (edge + m)), lot, 5)) hi = m;
            else lo = m;
          }
          extent = lo;
        }
      }
      widths[index].push(Math.max(3.5, extent));
      materials[index].push(
        speedway
          ? side === r.oval!.inside
            ? "grass"
            : "runoff"
          : street || airfield
            ? "runoff"
            : inside
              ? "grass"
              : settings.theme === "desert"
                ? "sand"
                : settings.theme === "modern"
                  ? "runoff"
                  : i % 4 === 0
                    ? "grass"
                    : "gravel",
      );
    }
  });
  for (let side = 0; side < 2; side++) {
    const smoothed = smoothSamples(widths[side], 38, ds);
    widths[side] = widths[side].map((cap, i) =>
      Math.max(3.5, Math.min(cap, smoothed[i])),
    );
    taper(widths[side], ds);
  }
  let pit: PitLane | undefined;
  const grid = path.sample(0),
    pad = def.site.paddock!;
  if (settings.pits) {
    const side = Math.sign(
        (pad.centre.x - grid.position.x) * grid.left.x +
          (pad.centre.z - grid.position.z) * grid.left.z,
      ) as 1 | -1,
      extent = Math.min(145, base.report.metrics.startStraight / 2 - 14),
      width = recipe.endurance ? 5.2 : 4.5;
    if (extent < 36)
      throw new Error("The site has no usable straight pit approach.");
    pit = {
      side,
      entry: -extent,
      exit: extent,
      mergeLength: Math.min(50, extent * 0.4),
      offset: (side === 1 ? grid.leftWidth : grid.rightWidth) + 8,
      joinOffset:
        (side === 1 ? grid.leftWidth : grid.rightWidth) - width / 2 - 0.25,
      width,
      speedLimit: 50 / 3.6,
      points: [],
      apronStart: -Math.max(12, extent - Math.min(50, extent * 0.4) - 8),
      apronEnd: Math.max(12, extent - Math.min(50, extent * 0.4) - 8),
    };
    for (let s = pit.entry; s <= pit.exit + 0.01; s += 2)
      pit.points.push(
        vec(roadPoint(path.sample(s), side * pitOffset(pit, s, length))),
      );
    const index = side === 1 ? 0 : 1;
    for (let i = 0; i < n; i++) {
      const d = Math.min(i * ds, length - i * ds);
      if (d < extent + 35) {
        widths[index][i] = Math.max(
          widths[index][i],
          22 * (1 - smooth((d - extent) / 35)),
        );
        materials[index][i] = "runoff";
      }
    }
  }
  const venue: VenueDefinition = {
    version: 1,
    settings,
    baseFingerprint: base.fingerprint,
    geometryFingerprint: "",
    sceneryFingerprint: "",
    leftRunoff: periodicProfile(widths[0]),
    rightRunoff: periodicProfile(widths[1]),
    leftMaterial: materials[0],
    rightMaterial: materials[1],
    fans: [],
    barriers: [],
    props: [],
    ...(pit
      ? {
          pit,
          branches: [
            {
              id: "pit",
              name: "Pit lane",
              points: pit.points,
              width: pit.width,
              entryAt: wrap(pit.entry, length) / length,
              exitAt: pit.exit / length,
              layer: 0,
            },
          ],
        }
      : {}),
    report: {
      kerbs: def.kerbs.length,
      kerbCoverage: def.kerbs.reduce((s, k) => s + k.end - k.start, 0),
      maxRunoff: Math.max(...widths.flat()),
      spaceLimited: 0,
      checks: [],
    },
  };
  def.venue = venue;
  const final = new Alignment(def),
    point = (s: number, lateral: number) =>
      vec(roadPoint(final.sample(s), lateral)),
    makeBarrier = (side: 1 | -1) => {
      const points: ReturnType<typeof vec>[] = [],
        skip = pit?.side === side ? pit.exit + 6 : 0;
      const start = skip,
        end = skip ? length + pit!.entry - 6 : length;
      const count = Math.ceil((end - start) / 6);
      for (let i = 0; i <= count; i++) {
        const s = start + ((end - start) * i) / count,
          r = final.sample(s),
          edge =
            side === 1
              ? r.leftWidth + r.runoffLeft!
              : -r.rightWidth - r.runoffRight!;
        points.push(point(s, edge - side * 0.55));
      }
      const barrier: BarrierPath = {
        id: `m7-perimeter-${side}`,
        kind: street || oval ? "wall" : "guardrail",
        points,
        width: street || oval ? 0.55 : 0.45,
        height: street || oval ? 1.15 : 0.85,
        closed: !skip,
      };
      venue.barriers.push(barrier);
    };
  makeBarrier(1);
  makeBarrier(-1);
  if (pit) {
    const points = [];
    for (
      let s = pit.entry + pit.mergeLength;
      s <= pit.exit - pit.mergeLength;
      s += 4
    ) {
      const r = final.sample(s);
      points.push(
        point(
          s,
          pit.side * ((pit.side === 1 ? r.leftWidth : r.rightWidth) + 1.25),
        ),
      );
    }
    venue.barriers.push({
      id: "m7-pit-separator",
      kind: "wall",
      points,
      width: 0.4,
      height: 0.95,
      closed: false,
    });
    const count = Math.max(
      3,
      Math.min(
        recipe.endurance ? 16 : 8,
        Math.floor((pit.apronEnd - pit.apronStart) / 13),
      ),
    );
    for (let i = 0; i < count; i++) {
      const s =
        pit.apronStart + ((pit.apronEnd - pit.apronStart) * (i + 0.5)) / count;
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
    venue.access = {
      width: 6,
      points: [
        {
          x: pad.centre.x - grid.left.x * pit.side * 10,
          y: pad.height,
          z: pad.centre.z - grid.left.z * pit.side * 10,
        },
        {
          x: pad.centre.x + grid.left.x * pit.side * 52,
          y: pad.height,
          z: pad.centre.z + grid.left.z * pit.side * 52,
        },
        {
          x: pad.centre.x + grid.left.x * pit.side * 52 + pad.forward.x * 90,
          y: pad.height,
          z: pad.centre.z + grid.left.z * pit.side * 52 + pad.forward.z * 90,
        },
      ],
    };
    def.starts.push({
      id: "pit",
      name: "Pit lane branch",
      at: 0,
      lateral: pit.side * pit.offset,
      description:
        "Separate pit branch and paved merge. Speed guidance is advisory; M8 supplies timing and rules.",
    });
  }
  // Escape paths follow the actual straight-ahead trajectory, stopping at the
  // available envelope. A constrained road reports a reduced design guide.
  const bare = hydrateCircuit(base.circuit),
    turns = meta.route.filter(
      (r) => r.role.includes("junction") || r.origin === "new-connector",
    );
  for (const segment of turns) {
    const s = ((segment.at + segment.end) / 2) * length,
      r = final.sample(s);
    if (Math.abs(r.curvature) < 0.004) continue;
    const side = r.curvature > 0 ? -1 : 1,
      points: ReturnType<typeof vec>[] = [],
      origin = roadPoint(
        r,
        side * (side === 1 ? r.leftWidth : r.rightWidth) * 0.65,
      ),
      direction = new Vector3(r.forward.x, 0, r.forward.z).normalize();
    for (let d = 0; d <= 130; d += 4) {
      const p = origin.clone().addScaledVector(direction, d),
        q = bare.locate(p),
        row = final.sample(q.station),
        edge =
          q.lateral >= 0
            ? row.leftWidth + row.runoffLeft!
            : row.rightWidth + row.runoffRight!;
      if (Math.abs(q.lateral) > edge - 1.5) break;
      points.push(vec(p));
    }
    if (points.length < 3) continue;
    const available = (points.length - 1) * 4,
      approach = Math.min(
        48,
        Math.sqrt((0.75 * 9.81) / Math.max(Math.abs(r.curvature), 0.0001)),
      ),
      designSpeed = Math.min(
        approach,
        Math.sqrt(
          12 ** 2 +
            2 * (street ? 4.5 : 3.2) * Math.max(0, available - approach * 0.5),
        ),
      ),
      surface = (side === 1 ? materials[0] : materials[1])[
        Math.floor((s / length) * n)
      ];
    venue.fans.push({
      at: s / length,
      side: side === 1 ? "left" : "right",
      approachSpeed: approach,
      designSpeed,
      terminalSpeed: 12,
      spaceLimited: designSpeed < approach - 0.5,
      paths: [points],
      available,
      surface,
    });
    venue.props.push({
      kind: "board",
      position: point(
        s - 55,
        side * ((side === 1 ? r.leftWidth : r.rightWidth) + 2),
      ),
      heading: Math.atan2(-r.forward.x, -r.forward.z),
      scale: 1,
      label: String(Math.floor((designSpeed * 3.6) / 5) * 5),
    });
  }
  venue.report.spaceLimited = venue.fans.filter((f) => f.spaceLimited).length;
  progress({
    stage: "Compiling local terrain tiles and shared collision surfaces",
    fraction: 0.88,
  });
  const compiled = compileCircuit(def),
    ground = surfaceQuery(compiled);
  for (const fan of venue.fans)
    for (const p of fan.paths[0]) {
      const hit = ground(p.x, p.z);
      if (hit) p.y = hit.height;
    }
  // Primitive buildings occupy retained blocks, never the racing ribbon or the
  // reserved paddock. Corner checks account for the whole footprint.
  if (street || airfield)
    for (const lot of meta.network.lots) {
      if (lot.use !== "building") continue;
      const size = {
          x: Math.max(12, Math.min(street ? 65 : 80, lot.width * 0.68)),
          y: street ? 7 + random() * 30 : 9 + random() * 8,
          z: Math.max(12, Math.min(street ? 55 : 50, lot.length * 0.65)),
        },
        c = Math.cos(lot.heading),
        s = Math.sin(lot.heading);
      let allowed = true,
        maxHeight = -Infinity;
      for (const x of [-size.x / 2, size.x / 2])
        for (const z of [-size.z / 2, size.z / 2]) {
          const p = {
              x: lot.centre.x + x * c + z * s,
              y: 0,
              z: lot.centre.z - x * s + z * c,
            },
            hit = ground(p.x, p.z),
            near = compiled.locate(p);
          if (
            !hit ||
            Math.abs(near.lateral) <
              Math.max(near.sample.leftWidth, near.sample.rightWidth) + 9 ||
            pointInPad(p, pad, 10)
          )
            allowed = false;
          if (hit) maxHeight = Math.max(maxHeight, hit.height);
        }
      if (allowed)
        venue.props.push({
          kind: "building",
          position: { x: lot.centre.x, y: maxHeight, z: lot.centre.z },
          size,
          heading: lot.heading,
          scale: 1,
          label: airfield ? "AIRFIELD" : undefined,
        });
    }
  for (const prop of venue.props) {
    const hit = ground(prop.position.x, prop.position.z);
    if (!hit && prop.solid)
      throw new Error("A pit garage has no compiled ground.");
    if (hit && prop.kind !== "building") prop.position.y = hit.height;
  }
  for (let i = 0; i < Math.min(18, Math.ceil(length / 450)); i++) {
    const s = ((i + 0.35) * length) / Math.min(18, Math.ceil(length / 450)),
      r = final.sample(s),
      side = (i % 2 ? 1 : -1) as 1 | -1,
      edge =
        side === 1
          ? r.leftWidth + r.runoffLeft!
          : -r.rightWidth - r.runoffRight!,
      p = roadPoint(r, edge + side * 17),
      hit = ground(p.x, p.z);
    if (!hit || pointInPad(p, pad, 20)) continue;
    venue.props.push({
      kind: i % 3 ? "stand" : "marshal",
      position: { x: p.x, y: hit.height, z: p.z },
      heading: Math.atan2(-side * r.left.x, -side * r.left.z),
      scale: i % 3 ? 0.8 : 1,
      label: String(i + 1),
    });
  }
  populateVegetation(compiled, ground);
  // Vegetation in occupied city lots is suppressed, preserving readable streets.
  clearFamilyVegetation(compiled);
  if (pit)
    for (const p of pit.points) {
      const hit = ground(p.x, p.z);
      if (!hit || !["asphalt", "runoff"].includes(hit.surface))
        throw new Error("The pit branch crosses a non-paved surface.");
    }
  for (const barrier of venue.barriers)
    for (const p of barrier.points) {
      const r = compiled.locate(p),
        width = r.lateral >= 0 ? r.sample.leftWidth : r.sample.rightWidth;
      if (Math.abs(r.lateral) < width + 1)
        throw new Error("A family barrier overlaps another racing leg.");
    }
  venue.report.checks = [
    {
      name: "Family construction & shared surfaces",
      status: "pass",
      detail: `${street ? "Urban walls and paved junction escapes" : oval ? "Progressive racing lanes, apron and perimeter wall" : "Inherited verges, fitted run-off and protected edges"}; ${compiled.triangleCount.toLocaleString()} exact shared triangles`,
    },
    {
      name: "Pit branch & property reservations",
      status: "pass",
      detail: `${pit ? "Paved pit route, separate branch ID and merge" : "Pits disabled"}; ${meta.network.lots.filter((l) => l.use === "exclusion").length} retained exclusion lots; buildings clear the road footprint`,
    },
  ];
  venue.geometryFingerprint = `m7-venue-${hashSeed(JSON.stringify({ settings: venueGeometrySettings(settings), left: venue.leftRunoff, right: venue.rightRunoff, barriers: venue.barriers, pit: venue.pit })).toString(16)}`;
  result.circuit = bakeCircuit(compiled);
  result.fingerprint = `${base.fingerprint}/${venue.geometryFingerprint}`;
  result.report.checks.push(...venue.report.checks);
  if (result.family)
    Object.assign(result.family, {
      surfaceChunks: compiled.chunks.length,
      triangles: compiled.triangleCount,
      transferBytes: compiled.chunks.reduce(
        (s, c) =>
          s +
          c.vertices.byteLength +
          c.indices.byteLength +
          c.colors.byteLength,
        0,
      ),
      branchIds: pit ? ["main", "pit"] : ["main"],
    });
  progress({
    stage: "Venue construction and branch validation complete",
    fraction: 1,
  });
  return result;
}
