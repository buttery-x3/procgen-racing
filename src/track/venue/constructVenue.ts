import { bakeCircuit, compileCircuit } from "../SurfaceCompiler";
import type {
  GenerationResult,
  GenerationProgress,
  GenerationRecipe,
} from "../generationTypes";
import { generateCircuit } from "../generateCircuit";
import { hashSeed } from "../Terrain";
import { surfaceQuery } from "../SurfaceQuery";
import { planVenue, populateVegetation } from "./VenuePlanner";
import { normalizeVenue, venueGeometrySettings } from "./types";
export { venueGeometrySettings } from "./types";
import type { VenueSettings } from "./types";

function solidFingerprint(result: GenerationResult) {
  const venue = result.circuit.definition.venue!;
  const { props, sceneryFingerprint, geometryFingerprint, settings, ...rest } =
    venue;
  return `m5-${hashSeed(
    JSON.stringify({
      ...rest,
      settings: venueGeometrySettings(settings),
      props: props.filter((p) => p.solid),
    }),
  )
    .toString(16)
    .padStart(8, "0")}`;
}

export function constructVenue(
  base: GenerationResult,
  input: VenueSettings,
  progress: (p: GenerationProgress) => void = () => {},
): GenerationResult {
  const settings = normalizeVenue(input);
  if (!settings.enabled || base.recipe.version === 1) return base;
  const failures: string[] = [];
  for (const budget of [44, 34, 26])
    try {
      progress({
        stage: "Fitting kerbs, escape fans and pit merges",
        fraction: 0.83,
      });
      const def = planVenue(base, settings, budget),
        venue = def.venue!;
      progress({
        stage: "Compiling run-off, access and collision surfaces",
        fraction: 0.88,
      });
      const compiled = compileCircuit(def),
        ground = surfaceQuery(compiled);
      for (const chunk of compiled.chunks) {
        const v = chunk.vertices,
          id = chunk.indices;
        for (let i = 0; i < id.length; i += 3) {
          const a = id[i] * 3,
            b = id[i + 1] * 3,
            c = id[i + 2] * 3,
            up =
              (v[b + 2] - v[a + 2]) * (v[c] - v[a]) -
              (v[b] - v[a]) * (v[c + 2] - v[a + 2]);
          if (!(up > 0))
            throw new Error(
              "Venue surface contains a folded Float32 triangle.",
            );
        }
      }
      let minimumClearance = Infinity;
      for (const path of venue.barriers)
        for (const p of path.points) {
          const near = compiled.locate(p),
            distance = Math.hypot(
              p.x - near.sample.position.x,
              p.z - near.sample.position.z,
            ),
            width =
              near.lateral >= 0
                ? near.sample.leftWidth
                : near.sample.rightWidth;
          const clearance = distance - width - path.width / 2;
          if (clearance < 1.1)
            throw new Error(
              "A constructed barrier enters another racing corridor.",
            );
          minimumClearance = Math.min(minimumClearance, clearance);
        }
      // Exact shared-mesh heights anchor every structure. Decoration can be skipped
      // on unavailable land; a solid garage cannot silently float or intersect road.
      venue.props = venue.props.filter((p) => {
        const hit = ground(p.position.x, p.position.z);
        if (!hit) {
          if (p.solid)
            throw new Error("A garage has no compiled ground support.");
          return false;
        }
        p.position.y = hit.height;
        if (p.kind === "stand") {
          const samples: number[] = [];
          for (const x of [-10, 10])
            for (const z of [-6, 6]) {
              const c = Math.cos(p.heading),
                s = Math.sin(p.heading),
                corner = ground(
                  p.position.x + x * c + z * s,
                  p.position.z - x * s + z * c,
                );
              if (!corner) return false;
              samples.push(corner.height);
            }
          if (Math.max(...samples) - Math.min(...samples) > 1.4) return false;
          p.position.y = Math.max(...samples) + 0.02;
        }
        if (!p.solid) {
          const near = compiled.locate(p.position),
            width =
              near.lateral >= 0
                ? near.sample.leftWidth
                : near.sample.rightWidth;
          if (
            Math.abs(near.lateral) <
            width + (p.kind === "stand" ? 16 : p.kind === "marshal" ? 4 : 2)
          )
            return false;
        }
        if (p.solid) {
          const near = compiled.locate(p.position);
          if (
            Math.abs(near.lateral) <
            Math.max(near.sample.leftWidth, near.sample.rightWidth) + 12
          )
            throw new Error("A garage overlaps another road.");
        }
        return true;
      });
      for (const fan of venue.fans)
        for (const path of fan.paths)
          for (const p of path) {
            const hit = ground(p.x, p.z);
            if (!hit || Math.abs(hit.height - p.y) > 0.12)
              throw new Error(
                "An escape trajectory leaves the constructed run-off surface.",
              );
            const r = compiled.locate(p),
              width = r.lateral >= 0 ? r.sample.leftWidth : r.sample.rightWidth,
              extent =
                r.lateral >= 0 ? r.sample.runoffLeft! : r.sample.runoffRight!;
            if (Math.abs(r.lateral) > width + extent - 1.2)
              throw new Error(
                "An escape trajectory reaches the perimeter barrier too early.",
              );
          }
      if (venue.pit)
        for (const p of venue.pit.points) {
          const hit = ground(p.x, p.z);
          if (!hit || !["asphalt", "runoff"].includes(hit.surface))
            throw new Error(
              "Pit entry, lane or exit crosses a loose-surface gap.",
            );
        }
      const kerb = def.kerbs.find(
        (z) => z.role === "apex" && (z.end - z.start) * compiled.length > 15,
      );
      if (kerb)
        def.starts.push({
          id: "venue-kerb",
          name: "Apex kerb",
          at: (kerb.start + kerb.end) / 2,
          lateral: kerb.side === "left" ? "kerb-left" : "kerb-right",
          description: `One side on the ${settings.kerb} apex kerb. Compare each wheel’s contact and suspension travel.`,
        });
      let looseAdded = false;
      for (const fan of venue.fans) {
        if (looseAdded) break;
        for (const path of fan.paths) {
          if (looseAdded) break;
          for (const p of [...path].reverse()) {
            const hit = ground(p.x, p.z),
              near = compiled.locate(p),
              width =
                near.lateral >= 0
                  ? near.sample.leftWidth
                  : near.sample.rightWidth,
              extent =
                near.lateral >= 0
                  ? near.sample.runoffLeft!
                  : near.sample.runoffRight!;
            if (
              hit &&
              ["gravel", "sand", "grass"].includes(hit.surface) &&
              Math.abs(near.lateral) > width + 3 &&
              Math.abs(near.lateral) < width + extent - 3
            ) {
              def.starts.push({
                id: "venue-runoff",
                name: `${hit.surface[0].toUpperCase() + hit.surface.slice(1)} run-off`,
                at: near.station / compiled.length,
                lateral: near.lateral,
                description:
                  "Loose-surface recovery test. Compare the four contact patches; R returns to this start.",
              });
              looseAdded = true;
              break;
            }
          }
        }
      }
      let accessGrade = 0;
      if (venue.access)
        for (let i = 1; i < venue.access.points.length; i++) {
          const a = venue.access.points[i - 1],
            b = venue.access.points[i];
          accessGrade = Math.max(
            accessGrade,
            Math.abs(b.y - a.y) / Math.hypot(b.x - a.x, b.z - a.z),
          );
          const hit = ground(b.x, b.z);
          if (!hit || Math.abs(hit.height - b.y) > 0.35)
            throw new Error(
              "Service access has a gap or incompatible ground grading.",
            );
        }
      if (accessGrade > 0.16)
        throw new Error(
          "Service-road grading exceeds its construction envelope.",
        );
      venue.report.checks = [
        {
          name: "Semantic kerbs",
          status: "pass",
          detail: `${venue.report.kerbs} tapered entry/apex/exit regions · ${settings.kerb === "low" ? "35" : "75"} mm profile · world-distance red/white stripes`,
        },
        {
          name: "Run-off & escapes",
          status: "pass",
          detail: `${venue.fans.length} three-ray escape fans · up to ${venue.report.maxRunoff.toFixed(1)} m run-off · ${venue.report.spaceLimited} approaches receive space-limited speed advisories`,
        },
        {
          name: "Continuous barriers",
          status: "pass",
          detail: `${venue.barriers.length} welded barrier paths · ${minimumClearance.toFixed(1)} m minimum clearance from racing asphalt`,
        },
        {
          name: "Pit lane & service",
          status: "pass",
          detail: venue.pit
            ? `${venue.pit.width.toFixed(1)} m lane · 50 km/h limit · separate entry/exit tapers · ${(accessGrade * 100).toFixed(1)}% peak access grade`
            : "Facilities disabled for this recipe",
        },
        {
          name: "Venue construction mesh",
          status: "pass",
          detail: `${compiled.triangleCount.toLocaleString("en-US")} shared upward triangles · no second road/terrain contact plane`,
        },
      ];
      progress({
        stage: "Placing facilities and seeded surroundings",
        fraction: 0.96,
      });
      populateVegetation(compiled, ground);
      const result: GenerationResult = {
        ...base,
        circuit: bakeCircuit(compiled),
        design: base.design ? structuredClone(base.design) : undefined,
        report: structuredClone(base.report),
      };
      if (result.design) {
        for (const line of result.design.referenceLines ?? []) {
          for (const p of line.points)
            for (const fan of venue.fans) {
              let d = (p.at - fan.at) * compiled.length;
              d =
                ((((d + compiled.length / 2) % compiled.length) +
                  compiled.length) %
                  compiled.length) -
                compiled.length / 2;
              if (d >= -65 && d <= 110)
                p.speed = Math.min(p.speed, fan.designSpeed);
            }
          const points = line.points,
            n = points.length,
            ds = compiled.length / n;
          for (let pass = 0; pass < 3; pass++) {
            for (let i = 0; i < n * 2; i++) {
              const a = i % n,
                b = (a + 1) % n;
              points[b].speed = Math.min(
                points[b].speed,
                Math.sqrt(points[a].speed ** 2 + 2 * 4 * ds),
              );
            }
            for (let i = n * 2 - 1; i >= 0; i--) {
              const a = i % n,
                b = (a + n - 1) % n;
              points[b].speed = Math.min(
                points[b].speed,
                Math.sqrt(points[a].speed ** 2 + 2 * 5.5 * ds),
              );
            }
          }
        }
        const reference = result.design.referenceLines?.find(
          (l) => l.vehicle === (base.recipe.family === "gp" ? "gt" : "touring"),
        );
        if (reference)
          for (const d of result.design.diagnostics)
            d.speed =
              reference.points[
                Math.floor(d.at * reference.points.length) %
                  reference.points.length
              ].speed;
      }
      venue.geometryFingerprint = solidFingerprint(result);
      result.fingerprint = `${base.fingerprint}/${venue.geometryFingerprint}`;
      result.report.checks = result.report.checks.filter(
        (c) => c.name !== "Shared surface mesh",
      );
      result.report.checks.push(...venue.report.checks);
      if (failures.length) venue.report.revisions = failures;
      return result;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  throw new Error(
    `Venue could not fit the accepted circuit: ${[...new Set(failures)].join("; ")}`,
  );
}

export function restyleScenery(
  cached: GenerationResult,
  settings: VenueSettings,
): GenerationResult {
  const result = structuredClone(cached),
    venue = result.circuit.definition.venue!;
  venue.settings = {
    ...venue.settings,
    scenery: settings.scenery,
    scenerySeed: settings.scenerySeed,
  };
  populateVegetation(result.circuit, surfaceQuery(result.circuit));
  return result;
}
export function generateVenueCircuit(
  recipe: GenerationRecipe,
  settings: VenueSettings,
  progress: (p: GenerationProgress) => void = () => {},
) {
  return constructVenue(
    generateCircuit(recipe, { progress }),
    settings,
    progress,
  );
}
