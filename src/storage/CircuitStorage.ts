import { Alignment } from "../track/Alignment";
import { bakeCircuit, compileCircuit } from "../track/SurfaceCompiler";
import { hashSeed } from "../track/Terrain";
import { validateCircuit } from "../track/validateCircuit";
import { normalizeRecipe } from "../track/generationTypes";
import type {
  GenerationRecipe,
  GenerationResult,
} from "../track/generationTypes";
import { SURFACES } from "../track/types";
import type { CircuitDefinition, ProfileKey } from "../track/types";
import { inspectFamilyDefinition } from "../track/families/generateFamilyCircuit";
import { FAMILY_PRESETS } from "../track/families/types";
import { checkFamilyConstruction } from "../track/families/Venue";

export interface CircuitArchive {
  format: "procgen-racing/circuit";
  version: 1;
  recipe: GenerationRecipe;
  definition: CircuitDefinition;
  definitionHash: string;
  fingerprint: string;
}
export function circuitArchive(result: GenerationResult): CircuitArchive {
  const definition = structuredClone(result.circuit.definition);
  return {
    format: "procgen-racing/circuit",
    version: 1,
    recipe: structuredClone(result.recipe),
    definition,
    definitionHash: hashSeed(JSON.stringify(definition)).toString(16),
    fingerprint: result.fingerprint,
  };
}
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
function validateProfiles(profiles: ProfileKey[][]) {
  for (const keys of profiles) {
    if (
      !Array.isArray(keys) ||
      keys.length < 2 ||
      keys.length > 12000 ||
      keys[0].at !== 0 ||
      keys.at(-1)!.at !== 1 ||
      keys[0].value !== keys.at(-1)!.value ||
      keys.some(
        (k, i) =>
          !finite(k.at) ||
          !finite(k.value) ||
          Math.abs(k.value) > 4000 ||
          k.at < 0 ||
          k.at > 1 ||
          (i > 0 && k.at <= keys[i - 1].at) ||
          (k.slope !== undefined &&
            (!finite(k.slope) || Math.abs(k.slope) > 1e6)) ||
          (k.second !== undefined &&
            (!finite(k.second) || Math.abs(k.second) > 1e9)),
      )
    )
      throw new Error("Invalid, unbounded or non-periodic circuit profile.");
  }
}
function validateDefinition(def: CircuitDefinition) {
  if (
    !def ||
    typeof def !== "object" ||
    typeof def.name !== "string" ||
    def.name.length > 160 ||
    typeof def.id !== "string" ||
    def.id.length > 160 ||
    !Array.isArray(def.controlPoints) ||
    def.controlPoints.length < 6 ||
    def.controlPoints.length > 4000 ||
    def.controlPoints.some(
      (p) =>
        !finite(p.x) ||
        !finite(p.z) ||
        Math.abs(p.x) > 30000 ||
        Math.abs(p.z) > 30000,
    )
  )
    throw new Error("Invalid or unsupported circuit geometry.");
  const profiles: ProfileKey[][] = [
    def.elevation,
    def.leftWidth,
    def.rightWidth,
    def.bankStrength,
    def.crown,
    ...(def.bank ? [def.bank] : []),
  ];
  const meta = def.familyDesign;
  if (meta) {
    if (
      meta.version !== 1 ||
      meta.generator !== "circuit-v3.1" ||
      !(meta.family in FAMILY_PRESETS) ||
      meta.layer !== 0 ||
      meta.network?.version !== 1 ||
      !Array.isArray(meta.network.nodes) ||
      !Array.isArray(meta.network.edges) ||
      meta.network.nodes.length > 2048 ||
      meta.network.edges.length > 4096 ||
      !Array.isArray(meta.network.lots) ||
      meta.network.lots.length > 256 ||
      !Array.isArray(meta.variants) ||
      meta.variants.length > 8 ||
      !Array.isArray(meta.route) ||
      meta.route.length > 12000
    )
      throw new Error("Unsupported network/variant definition.");
    for (const v of meta.variants)
      if (
        typeof v.id !== "string" ||
        !Array.isArray(v.edgeIds) ||
        !Array.isArray(v.nodeIds) ||
        !finite(v.length) ||
        v.length < 100 ||
        v.length > 26000 ||
        v.layer !== 0
      )
        throw new Error("Invalid route variant.");
    for (const span of meta.route)
      if (
        !finite(span.at) ||
        !finite(span.end) ||
        span.at < 0 ||
        span.end > 1 ||
        span.end <= span.at ||
        typeof span.edgeId !== "string" ||
        typeof span.role !== "string" ||
        ![
          "urban-road",
          "rural-road",
          "runway",
          "taxiway",
          "new-connector",
          "speedway",
        ].includes(span.origin)
      )
        throw new Error("Invalid road provenance.");
    for (const lot of meta.network.lots)
      if (
        !lot.centre ||
        !finite(lot.centre.x) ||
        !finite(lot.centre.z) ||
        !finite(lot.width) ||
        !finite(lot.length) ||
        lot.width < 1 ||
        lot.length < 1 ||
        lot.width > 6000 ||
        lot.length > 6000 ||
        !finite(lot.heading)
      )
        throw new Error("Invalid property reservation.");
    for (const node of meta.network.nodes)
      if (
        !finite(node.x) ||
        !finite(node.z) ||
        !finite(node.height) ||
        node.layer !== 0
      )
        throw new Error("Invalid road-network node.");
    let pointCount = 0;
    for (const edge of meta.network.edges) {
      if (
        !Array.isArray(edge.points) ||
        edge.points.length < 2 ||
        !finite(edge.width) ||
        edge.width < 3 ||
        edge.width > 30 ||
        edge.layer !== 0
      )
        throw new Error("Invalid inherited-road edge.");
      pointCount += edge.points.length;
      for (const p of edge.points)
        if (!finite(p.x) || !finite(p.z))
          throw new Error("Invalid road-network coordinate.");
    }
    if (pointCount > 40000)
      throw new Error("Road-network archive exceeds its bounds.");
    if (
      !meta.streaming ||
      meta.streaming.maxSurfaceChunks < 16 ||
      meta.streaming.maxSurfaceChunks > 160 ||
      meta.streaming.maxBarrierChunks < 16 ||
      meta.streaming.maxBarrierChunks > 160 ||
      meta.streaming.radius < 180 ||
      meta.streaming.radius > 400 ||
      meta.streaming.roadStep < 1 ||
      meta.streaming.roadStep > 3.1 ||
      meta.streaming.terrainSpacing < 16 ||
      meta.streaming.terrainSpacing > 48
    )
      throw new Error("Unsupported streaming policy.");
    if (meta.oval) {
      const o = meta.oval;
      if (
        ![1, -1].includes(o.inside) ||
        !finite(o.apronWidth) ||
        o.apronWidth < 3 ||
        o.apronWidth > 10 ||
        !finite(o.apronBank) ||
        Math.abs(o.apronBank) > 0.1 ||
        !finite(o.apronBlend) ||
        o.apronBlend < 1 ||
        o.apronBlend > 5
      )
        throw new Error("Invalid oval cross-section.");
      profiles.push(o.innerBank, o.outerBank, o.blend);
    }
  }
  for (const keys of profiles)
    if (
      !Array.isArray(keys) ||
      keys.length < 2 ||
      keys.length > 12000 ||
      keys.some(
        (k) =>
          !finite(k.at) ||
          !finite(k.value) ||
          k.at < 0 ||
          k.at > 1 ||
          (k.slope !== undefined && !finite(k.slope)) ||
          (k.second !== undefined && !finite(k.second)),
      )
    )
      throw new Error("Invalid circuit profile.");
  for (const keys of [def.leftWidth, def.rightWidth])
    if (keys.some((k) => k.value < 3 || k.value > 25))
      throw new Error("Unsupported racing width.");
  if (
    !Array.isArray(def.sections) ||
    !def.sections.length ||
    def.sections.length > 12000 ||
    def.sections.some(
      (s) =>
        !finite(s.start) ||
        typeof s.name !== "string" ||
        s.name.length > 160 ||
        !(s.runoff in SURFACES),
    )
  )
    throw new Error("Invalid circuit sections.");
  if (
    !Array.isArray(def.starts) ||
    !def.starts.length ||
    def.starts.length > 40 ||
    def.starts.some(
      (s) =>
        !finite(s.at) ||
        s.at < 0 ||
        s.at >= 1 ||
        typeof s.id !== "string" ||
        typeof s.name !== "string" ||
        (typeof s.lateral === "number" && !finite(s.lateral)),
    )
  )
    throw new Error("Invalid test starts.");
  if (
    !Array.isArray(def.kerbs) ||
    def.kerbs.length > 12000 ||
    def.kerbs.some(
      (k) =>
        !finite(k.start) ||
        !finite(k.end) ||
        k.start < 0 ||
        k.end > 1 ||
        k.start >= k.end ||
        !["left", "right"].includes(k.side),
    )
  )
    throw new Error("Invalid kerb zones.");
  if (
    !def.site ||
    !finite(def.site.radius) ||
    def.site.radius < 20 ||
    def.site.radius > 30000 ||
    !finite(def.site.centre.x) ||
    !finite(def.site.centre.z)
  )
    throw new Error("Invalid circuit site.");
  if (
    def.site.terrain &&
    (!finite(def.site.terrain.seed) ||
      !finite(def.site.terrain.amplitude) ||
      def.site.terrain.amplitude < 0 ||
      def.site.terrain.amplitude > 200 ||
      !finite(def.site.terrain.wavelength) ||
      def.site.terrain.wavelength < 100 ||
      !finite(def.site.terrain.baseHeight))
  )
    throw new Error("Invalid natural terrain.");
  const venue = def.venue;
  if (venue) {
    if (
      !venue.settings ||
      venue.settings.version !== 1 ||
      !["club", "traditional", "modern", "desert"].includes(
        venue.settings.theme,
      ) ||
      !["low", "raised"].includes(venue.settings.kerb) ||
      !["sparse", "standard", "dense"].includes(venue.settings.scenery) ||
      typeof venue.settings.scenerySeed !== "string"
    )
      throw new Error("Invalid venue settings.");
    if (
      venue.version !== 1 ||
      !Array.isArray(venue.barriers) ||
      venue.barriers.length > 4096 ||
      !Array.isArray(venue.props) ||
      venue.props.length > 12000
    )
      throw new Error("Unsupported venue archive.");
    let total = 0;
    for (const barrier of venue.barriers) {
      if (
        !["wall", "guardrail", "tyres", "impact"].includes(barrier.kind) ||
        !finite(barrier.width) ||
        barrier.width <= 0 ||
        barrier.width > 3 ||
        !finite(barrier.height) ||
        barrier.height < 0.2 ||
        barrier.height > 5 ||
        !Array.isArray(barrier.points) ||
        barrier.points.length < 2
      )
        throw new Error("Invalid barrier geometry.");
      total += barrier.points.length;
      if (
        barrier.points.some((p) => !finite(p.x) || !finite(p.y) || !finite(p.z))
      )
        throw new Error("Invalid barrier coordinate.");
    }
    if (total > 60000) throw new Error("Barrier archive exceeds its bounds.");
    for (const p of venue.props)
      if (
        ![
          "garage",
          "stand",
          "marshal",
          "tree",
          "bush",
          "board",
          "marker",
          "light",
          "building",
        ].includes(p.kind) ||
        !p.position ||
        !finite(p.position.x) ||
        !finite(p.position.y) ||
        !finite(p.position.z) ||
        !finite(p.scale) ||
        p.scale < 0.1 ||
        p.scale > 5 ||
        !finite(p.heading)
      )
        throw new Error("Invalid scenery instance.");
    profiles.push(venue.leftRunoff, venue.rightRunoff);
    if (
      !Array.isArray(venue.leftMaterial) ||
      !Array.isArray(venue.rightMaterial) ||
      [...venue.leftMaterial, ...venue.rightMaterial].some(
        (s) => !(s in SURFACES),
      ) ||
      !Array.isArray(venue.fans) ||
      venue.fans.length > 512
    )
      throw new Error("Invalid venue materials or escapes.");
    for (const points of [
      venue.pit?.points,
      venue.access?.points,
      ...venue.fans.flatMap((f) => f.paths),
    ].filter((p) => p !== undefined))
      if (
        !Array.isArray(points) ||
        points.length > 12000 ||
        points.some((p) => !finite(p.x) || !finite(p.y) || !finite(p.z))
      )
        throw new Error("Invalid venue branch geometry.");
    if (
      venue.pit &&
      (!finite(venue.pit.width) ||
        venue.pit.width < 3 ||
        venue.pit.width > 9 ||
        ![1, -1].includes(venue.pit.side) ||
        !finite(venue.pit.offset) ||
        Math.abs(venue.pit.offset) > 100)
    )
      throw new Error("Invalid pit lane.");
    if (
      venue.props.some(
        (p) =>
          p.size &&
          (!finite(p.size.x) ||
            !finite(p.size.y) ||
            !finite(p.size.z) ||
            Math.max(p.size.x, p.size.y, p.size.z) > 150),
      )
    )
      throw new Error("Invalid building dimensions.");
  }
  validateProfiles(profiles);
  const path = new Alignment(def);
  if (path.length > 26000)
    throw new Error(
      "The supported circuit limit is 26 km including fit tolerance.",
    );
}
export function decodeCircuitArchive(raw: string): CircuitArchive {
  if (raw.length > 4_000_000)
    throw new Error("Circuit archives must be smaller than 4 MB.");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("The circuit file is not valid JSON.");
  }
  if (!data || typeof data !== "object" || !data.recipe || !data.definition)
    throw new Error(
      "The file must contain a circuit recipe and accepted definition.",
    );
  if (
    data.format !== undefined &&
    (data.format !== "procgen-racing/circuit" || data.version !== 1)
  )
    throw new Error("Unsupported circuit archive version.");
  const candidate = data.recipe as GenerationRecipe;
  if (
    ![1, 2, 3].includes(candidate.version) ||
    (candidate.version === 3
      ? !(candidate.family in FAMILY_PRESETS)
      : !["gp", "touring"].includes(candidate.family))
  )
    throw new Error("Unsupported circuit recipe.");
  const recipe = normalizeRecipe(candidate),
    definition = data.definition as CircuitDefinition;
  validateDefinition(definition);
  if (
    recipe.version === 3 &&
    (!definition.familyDesign ||
      definition.familyDesign.family !== recipe.family ||
      definition.familyDesign.activeVariant !== recipe.variant)
  )
    throw new Error("The recipe and accepted route variant disagree.");
  const definitionHash = hashSeed(JSON.stringify(definition)).toString(16);
  if (
    data.definitionHash !== undefined &&
    data.definitionHash !== definitionHash
  )
    throw new Error("The accepted definition checksum does not match.");
  return {
    format: "procgen-racing/circuit",
    version: 1,
    recipe,
    definition,
    definitionHash,
    fingerprint:
      typeof data.fingerprint === "string" &&
      /^[a-zA-Z0-9/_-]{1,128}$/.test(data.fingerprint)
        ? data.fingerprint
        : `restored-${definitionHash}`,
  };
}
export function restoreCircuitArchive(
  archive: CircuitArchive,
): GenerationResult {
  // Treat stored reports as evidence, not authority. Recheck and compile the
  // accepted definition without running the route generator or changing its seed.
  const safe = decodeCircuitArchive(JSON.stringify(archive)),
    report = validateCircuit(safe.definition, safe.recipe);
  if (!report.valid)
    throw new Error(
      `Saved circuit failed current validation: ${report.checks
        .filter((c) => c.status === "fail")
        .map((c) => c.name)
        .join(", ")}`,
    );
  const circuit = compileCircuit(safe.definition);
  if (safe.recipe.version === 3)
    report.checks.push(...checkFamilyConstruction(circuit));
  const description =
    safe.recipe.version === 3
      ? inspectFamilyDefinition(safe.definition, safe.recipe)
      : undefined;
  return {
    recipe: safe.recipe,
    circuit: bakeCircuit(circuit),
    report,
    attempts: [],
    fallback: false,
    fingerprint: safe.fingerprint,
    ...(description
      ? {
          design: description.design,
          family: {
            ...description.family,
            surfaceChunks: circuit.chunks.length,
            triangles: circuit.triangleCount,
            transferBytes: circuit.chunks.reduce(
              (s, c) =>
                s +
                c.vertices.byteLength +
                c.indices.byteLength +
                c.colors.byteLength,
              0,
            ),
            branchIds: safe.definition.venue?.pit ? ["main", "pit"] : ["main"],
          },
        }
      : {}),
  };
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("procgen-racing:circuits", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("circuits");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Circuit storage unavailable."));
  });
}
export async function saveLastCircuit(archive: CircuitArchive) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("circuits", "readwrite");
      tx.objectStore("circuits").put(archive, "last");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function loadLastCircuit(): Promise<CircuitArchive | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const r = db
        .transaction("circuits", "readonly")
        .objectStore("circuits")
        .get("last");
      r.onsuccess = () =>
        resolve(
          r.result ? decodeCircuitArchive(JSON.stringify(r.result)) : null,
        );
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
