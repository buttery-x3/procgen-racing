import { Alignment, smooth } from "../Alignment";
import {
  periodicProfile,
  smoothSamples,
  fitRoadProfiles,
} from "../design/RoadProfiles";
import { bankEnvelope } from "./OvalSurface";
import type { CircuitDefinition } from "../types";
import type { FamilyRecipe } from "./types";
import { FAMILY_PRESETS } from "./types";

export function fitFamilyProfiles(
  def: CircuitDefinition,
  recipe: FamilyRecipe,
) {
  const meta = def.familyDesign!,
    oval = recipe.family === "oval" || recipe.family === "hybrid";
  if (!oval) {
    fitRoadProfiles(def, {
      version: 2,
      seed: recipe.seed,
      family: ["rural", "endurance", "airfield"].includes(recipe.family)
        ? "gp"
        : "touring",
      relief: recipe.relief,
      targetLength: recipe.targetLength,
      character: recipe.character,
      envelope: recipe.envelope,
      layout: recipe.layout,
    });
    // Fit a smooth periodic derivative, with a locked grid, bounded grades and
    // zero net climb. Integration closes the height profile without a closing
    // ramp or global relief multiplier. C2 derivatives travel with every key.
    const source = def.elevation.slice(0, -1).map((k) => k.value),
      L = new Alignment(def).length,
      N = source.length,
      step = L / N,
      maxGrade = recipe.envelope === "terrain" ? 0.078 : 0.046,
      clipped = source.map((_, i) =>
        Math.max(
          -maxGrade,
          Math.min(
            maxGrade,
            (source[(i + 1) % N] - source[(i + N - 1) % N]) / (2 * step),
          ),
        ),
      ),
      filtered = smoothSamples(clipped, 110, step),
      gate = source.map((_, i) =>
        smooth((Math.min(i * step, L - i * step) - 155) / 120),
      );
    let lo = -maxGrade * 2,
      hi = maxGrade * 2;
    for (let pass = 0; pass < 52; pass++) {
      const offset = (lo + hi) / 2,
        sum = filtered.reduce(
          (s, g, i) =>
            s + gate[i] * Math.max(-maxGrade, Math.min(maxGrade, g - offset)),
          0,
        );
      if (sum > 0) lo = offset;
      else hi = offset;
    }
    const offset = (lo + hi) / 2,
      gradients = filtered.map(
        (g, i) => gate[i] * Math.max(-maxGrade, Math.min(maxGrade, g - offset)),
      ),
      heights = [source[0]];
    for (let i = 1; i < N; i++)
      heights.push(
        heights[i - 1] + ((gradients[i - 1] + gradients[i]) * step) / 2,
      );
    const keys = heights.map((value, i) => ({
      at: i / N,
      value,
      slope: gradients[i] * L,
      second:
        ((gradients[(i + 1) % N] - gradients[(i + N - 1) % N]) / (2 * step)) *
        L *
        L,
    }));
    def.elevation = [...keys, { ...keys[0], at: 1 }];
  }
  const path = new Alignment(def),
    n = Math.ceil(path.length / 12),
    ds = path.length / n,
    rows = Array.from({ length: n }, (_, i) => path.sample(i * ds)),
    base = FAMILY_PRESETS[recipe.family].width;
  const routeAt = (at: number) =>
    meta.route.find((r) => at >= r.at && at < r.end) ?? meta.route[0];
  let widths: number[];
  if (oval) {
    const blend =
      recipe.family === "oval"
        ? rows.map(() => 1)
        : smoothSamples(
            rows.map((_, i) => (routeAt(i / n).origin === "speedway" ? 1 : 0)),
            65,
            ds,
          );
    widths = blend.map((b) => 13.5 + (21 - 13.5) * b);
    const inside = (rows.reduce((s, r) => s + r.curvature, 0) > 0 ? 1 : -1) as
        | 1
        | -1,
      sizeScale = 0.4 + 0.6 * smooth((path.length - 600) / 1000),
      turnInner =
        (((recipe.banking === "fast" ? 14 : 8) * Math.PI) / 180) * sizeScale,
      turnOuter =
        (((recipe.banking === "fast" ? 23 : 15) * Math.PI) / 180) * sizeScale,
      bank = (angle: number) =>
        smoothSamples(
          rows.map((r, i) => {
            const d = Math.min(i * ds, path.length - i * ds),
              grid = smooth(
                (d - Math.min(90, path.length * 0.08)) /
                  Math.max(40, Math.min(100, path.length * 0.055)),
              );
            return bankEnvelope(r.curvature, 0, angle) * grid;
          }),
          Math.max(24, Math.min(75, path.length * 0.035)),
          ds,
        );
    const inner = bank(turnInner),
      outer = bank(turnOuter);
    // The locked flat grid is also a usable pit merge, including on short ovals.
    for (let i = 0; i < n; i++) {
      const d = Math.min(i * ds, path.length - i * ds),
        grid = smooth((d - Math.min(70, path.length * 0.07)) / 60);
      inner[i] *= grid;
      outer[i] *= grid;
    }
    meta.oval = {
      inside,
      innerBank: periodicProfile(inner),
      outerBank: periodicProfile(outer),
      blend: periodicProfile(blend),
      apronBank: (2 * Math.PI) / 180,
      apronWidth: 7,
      apronBlend: 3,
    };
    def.bank = periodicProfile(
      inner.map((b, i) => -inside * (b + outer[i]) * 0.5 * blend[i]),
    );
    def.crown = [
      { at: 0, value: 0.012 },
      { at: 1, value: 0.012 },
    ];
  } else {
    // Shape physical crossfall over each same-direction bend. A curvature mask
    // applied after interpolation would introduce rapid normal changes at small
    // inherited-road kinks, especially on broad airfield pavement.
    const signs = rows.map((r) =>
        Math.abs(r.curvature) > 0.0007 ? Math.sign(r.curvature) : 0,
      ),
      magnitudes = smoothSamples(
        rows.map((r) => Math.min(0.04, Math.abs(r.curvature) * 3)),
        35,
        ds,
      );
    def.bank = periodicProfile(
      rows.map((_, i) => {
        if (!signs[i]) return 0;
        let distance = 110;
        for (let j = 1; j <= Math.ceil(110 / ds); j++)
          if (
            signs[(i - j + n) % n] !== signs[i] ||
            signs[(i + j) % n] !== signs[i]
          ) {
            distance = Math.max(0, (j - 1) * ds);
            break;
          }
        const grid = smooth(
          (Math.min(i * ds, path.length - i * ds) - 150) / 90,
        );
        return -signs[i] * magnitudes[i] * smooth(distance / 70) * grid;
      }),
    );
    widths = rows.map((r, i) => {
      const at = i / n,
        role = routeAt(at),
        edge = meta.network.edges.find((e) => e.id === role.edgeId),
        naturalWidth =
          recipe.family === "airfield"
            ? Math.min(18, edge?.width ?? base)
            : recipe.family === "street"
              ? (edge?.width ?? base)
              : base,
        grid = 1 - smooth((Math.min(i * ds, path.length - i * ds) - 100) / 85),
        junction = smooth((Math.abs(r.curvature) - 0.004) / 0.012);
      return (
        Math.max(9.5, naturalWidth) +
        grid * (recipe.family === "street" ? 2 : 2.5) +
        junction * 0.8
      );
    });
    widths = smoothSamples(widths, 65, ds);
  }
  def.leftWidth = periodicProfile(widths.map((w) => w / 2));
  def.rightWidth = periodicProfile(widths.map((w) => w / 2));
  def.sections = meta.route.map((r, i) => ({
    start: r.at,
    name: `${String(i + 1).padStart(2, "0")} / ${r.role}`,
    runoff:
      recipe.family === "street" || recipe.family === "airfield"
        ? "runoff"
        : i % 3 === 1
          ? "gravel"
          : "grass",
  }));
  const final = new Alignment(def),
    sample = final.sample(0),
    area = rows.reduce(
      (s, r, i) =>
        s +
        r.position.x * rows[(i + 1) % n].position.z -
        rows[(i + 1) % n].position.x * r.position.z,
      0,
    ),
    side = meta.oval?.inside ?? (area < 0 ? 1 : -1),
    padLength = Math.max(70, Math.min(210, path.length * 0.12));
  def.site.paddock = {
    centre: {
      x: sample.position.x + sample.left.x * side * 52,
      z: sample.position.z + sample.left.z * side * 52,
    },
    forward: { x: sample.forward.x, z: sample.forward.z },
    width: 58,
    length: padLength,
    height: sample.position.y,
  };
  for (const lot of meta.network.lots) {
    const dx = lot.centre.x - def.site.paddock.centre.x,
      dz = lot.centre.z - def.site.paddock.centre.z;
    if (
      Math.abs(dx * sample.left.x + dz * sample.left.z) < lot.width / 2 + 40 &&
      Math.abs(dx * sample.forward.x + dz * sample.forward.z) <
        lot.length / 2 + padLength / 2
    )
      lot.use = "paddock";
  }
  const peak = rows.reduce((a, b) => (a.position.y > b.position.y ? a : b)),
    corner = rows.reduce((a, b) =>
      Math.abs(a.curvature) > Math.abs(b.curvature) ? a : b,
    );
  def.starts = [
    {
      id: "start",
      name: "Starting grid",
      at: Math.min(0.015, 16 / path.length),
      description:
        "Closed venue. W / right trigger to drive; R resets to this start.",
    },
    {
      id: "sector",
      name: "Far sector",
      at: 0.45,
      description: "Inspect the inherited-road or infield sequence.",
    },
    {
      id: "summit",
      name: oval ? "Banked turn" : "Summit",
      at: oval
        ? rows
            .map((r) => final.sample(r.station))
            .reduce((a, b) => (Math.abs(a.bank) > Math.abs(b.bank) ? a : b))
            .station / path.length
        : peak.station / path.length,
      description: oval
        ? "Inspect the local road normal and independent wheel loads."
        : "Compare crest loading and retained terrain.",
    },
    {
      id: "corner",
      name: "Technical corner",
      at: corner.station / path.length,
      description: "Inspect the slowest geometric corner.",
    },
  ];
  if (meta.oval)
    for (const [label, factor] of [
      ["Low", 0.58],
      ["Middle", 0],
      ["High", -0.58],
    ] as const) {
      const at = def.starts.find((s) => s.id === "summit")!.at,
        r = final.sample(at * path.length);
      def.starts.push({
        id: `lane-${label.toLowerCase()}`,
        name: `${label} speedway lane`,
        at,
        lateral:
          meta.oval.inside *
          factor *
          (factor >= 0 ? r.leftWidth : r.rightWidth),
        description: `Start on the ${label.toLowerCase()} lane. Banking changes across the racing surface; the paved apron is separate.`,
      });
    }
  // Semantic kerbs stay off banked speedway sectors. Detailed placement is a
  // construction policy, not a repeating decoration around the whole lap.
  def.kerbs = [];
  let start = 0,
    sign = 0;
  for (let i = 0; i <= n; i++) {
    const r = rows[i % n],
      s =
        i === n
          ? 0
          : Math.abs(r.curvature) > 0.004 &&
              (!meta.oval || routeAt(i / n).origin !== "speedway")
            ? Math.sign(r.curvature)
            : 0;
    if (s !== sign) {
      if (sign && (i - start) * ds > 24)
        def.kerbs.push({
          start: start / n,
          end: i / n,
          side: sign > 0 ? "left" : "right",
          role: "apex",
        });
      start = i;
      sign = s;
    }
  }
}
