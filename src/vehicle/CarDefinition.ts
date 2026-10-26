import { Quaternion, Matrix4 } from "three";
import type { VehicleSetup, Vec3 } from "./types";

export const CAR_FAMILIES = [
  "hatch",
  "coupe",
  "sedan",
  "sports",
  "hypercar",
  "rear-coupe",
  "awd",
  "gt",
  "prototype",
  "open-wheel",
  "stock",
] as const;
export type CarFamily = (typeof CAR_FAMILIES)[number];
export type CarLayout = "FF" | "FR" | "MR" | "RR" | "F-AWD" | "M-AWD";
export interface BodyShape {
  noseWidth: number;
  rearWidth: number;
  shoulderHeight: number;
  roofWidth: number;
}
export function bodyShape(
  family: CarFamily,
  override?: Partial<BodyShape>,
): BodyShape {
  return {
    noseWidth: family === "open-wheel" ? 0.38 : family === "stock" ? 0.9 : 0.8,
    rearWidth: family === "stock" ? 0.94 : 0.86,
    shoulderHeight:
      family === "open-wheel"
        ? 0.3
        : ["sports", "hypercar", "prototype", "gt"].includes(family)
          ? 0.43
          : family === "hatch"
            ? 0.56
            : 0.49,
    roofWidth: family === "prototype" ? 0.29 : 0.65,
    ...override,
  };
}
export interface CarDimensions {
  wheelbase: number;
  frontTrack: number;
  rearTrack: number;
  frontOverhang: number;
  rearOverhang: number;
  bodyWidth: number;
  bodyHeight: number;
  wheelRadius: number;
  frontTyreWidth: number;
  rearTyreWidth: number;
  clearance: number;
  mountY: number;
  cabinCentre: number;
  cabinLength: number;
  cabinHeight: number;
}
export interface MassComponent {
  name: string;
  mass: number;
  position: Vec3;
  size: Vec3;
}
export interface CarRecipe {
  version: 1;
  seed: string;
  family: CarFamily;
  band: "road" | "sport" | "race";
  layout: CarLayout;
  mechanicsSeed: string;
  proportionsSeed: string;
  appearanceSeed: string;
  overrides?: Partial<Omit<CarDimensions, "mountY">>;
  bodyShape?: Partial<BodyShape>;
  paint?: number;
  stripe?: boolean;
  wing?: boolean;
}
export interface CarDefinition {
  version: 1;
  name: string;
  family: CarFamily;
  recipe: CarRecipe;
  dimensions: CarDimensions;
  shape: BodyShape;
  components: MassComponent[];
  appearance: {
    paint: number;
    accent: number;
    stripe: boolean;
    wing: boolean;
    number: number;
  };
}
export interface ResolvedCar {
  dimensions: CarDimensions;
  components: MassComponent[];
  mass: number;
  com: Vec3;
  inertia: Vec3;
  inertiaFrame: { x: number; y: number; z: number; w: number };
  tensor: number[][];
  bodyCentreZ: number;
  halfHeight: number;
  generated: boolean;
}
export const fingerprint = (value: unknown) => {
  let h = 2166136261;
  for (const c of JSON.stringify(value))
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
};
export function mechanicsFingerprint(setup: VehicleSetup) {
  const { vehicle, ...tune } = setup;
  return fingerprint({
    tune,
    vehicle: vehicle && {
      family: vehicle.family,
      dimensions: vehicle.dimensions,
      shape: vehicle.shape,
      components: vehicle.components,
    },
  });
}

/** Principal axes of a symmetric positive inertia tensor, with Jacobi rotations. */
export function principalInertia(tensor: number[][]) {
  const a = tensor.map((r) => [...r]),
    v = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  for (let pass = 0; pass < 24; pass++) {
    let p = 0,
      q = 1;
    for (const [i, j] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ])
      if (Math.abs(a[i][j]) > Math.abs(a[p][q])) {
        p = i;
        q = j;
      }
    if (Math.abs(a[p][q]) < 1e-9) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]),
      c = Math.cos(angle),
      s = Math.sin(angle);
    const rot = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    rot[p][p] = c;
    rot[q][q] = c;
    rot[p][q] = s;
    rot[q][p] = -s;
    const mul = (x: number[][], y: number[][]) =>
      x.map((row) =>
        row.map((_, j) => row.reduce((sum, n, k) => sum + n * y[k][j], 0)),
      );
    const next = mul(
        mul(
          rot[0].map((_, i) => rot.map((row) => row[i])),
          a,
        ),
        rot,
      ),
      vectors = mul(v, rot);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        a[i][j] = next[i][j];
        v[i][j] = vectors[i][j];
      }
  }
  const matrix = new Matrix4().set(
    v[0][0],
    v[0][1],
    v[0][2],
    0,
    v[1][0],
    v[1][1],
    v[1][2],
    0,
    v[2][0],
    v[2][1],
    v[2][2],
    0,
    0,
    0,
    0,
    1,
  );
  const q = new Quaternion().setFromRotationMatrix(matrix).normalize();
  return {
    inertia: { x: a[0][0], y: a[1][1], z: a[2][2] },
    inertiaFrame: { x: q.x, y: q.y, z: q.z, w: q.w },
  };
}

export function componentMassProperties(components: MassComponent[]) {
  const mass = components.reduce((s, c) => s + c.mass, 0),
    com = { x: 0, y: 0, z: 0 };
  for (const c of components)
    for (const axis of ["x", "y", "z"] as const)
      com[axis] += (c.position[axis] * c.mass) / mass;
  const tensor = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const c of components) {
    const d = [
        c.position.x - com.x,
        c.position.y - com.y,
        c.position.z - com.z,
      ],
      size = [c.size.x, c.size.y, c.size.z];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        tensor[i][j] +=
          c.mass *
          (i === j
            ? (size[(i + 1) % 3] ** 2 + size[(i + 2) % 3] ** 2) / 12 +
              d[(i + 1) % 3] ** 2 +
              d[(i + 2) % 3] ** 2
            : -d[i] * d[j]);
  }
  return { mass, com, tensor, ...principalInertia(tensor) };
}

/** One resolved definition for meshes, wheel contacts, colliders and explicit mass. */
export function resolveCar(setup: VehicleSetup): ResolvedCar {
  const base = setup.vehicle;
  if (!base) {
    const width = setup.trackWidth + 0.18,
      length = setup.wheelbase + 1.28;
    return {
      generated: false,
      mass: setup.mass,
      components: [],
      com: { x: 0, y: 0.04, z: (setup.frontWeight - 0.5) * setup.wheelbase },
      inertia: {
        x: (setup.mass * (length ** 2 + 0.75 ** 2)) / 12,
        y: (setup.mass * (length ** 2 + width ** 2)) / 12,
        z: (setup.mass * (width ** 2 + 0.75 ** 2)) / 12,
      },
      inertiaFrame: { x: 0, y: 0, z: 0, w: 1 },
      tensor: [],
      halfHeight: 0.21,
      bodyCentreZ: 0,
      dimensions: {
        wheelbase: setup.wheelbase,
        frontTrack: setup.trackWidth,
        rearTrack: setup.trackWidth,
        frontOverhang: 0.64,
        rearOverhang: 0.64,
        bodyWidth: width,
        bodyHeight: 1.25,
        wheelRadius: 0.32,
        frontTyreWidth: 0.23,
        rearTyreWidth: 0.23,
        clearance: 0.3,
        mountY: 0.05,
        cabinCentre: 0,
        cabinLength: 2,
        cabinHeight: 0.6,
      },
    };
  }
  const original = base.dimensions,
    sx = setup.trackWidth / original.frontTrack,
    sz = setup.wheelbase / original.wheelbase;
  const dimensions = {
    ...original,
    wheelbase: setup.wheelbase,
    frontTrack: setup.trackWidth,
    rearTrack: original.rearTrack * sx,
    bodyWidth: original.bodyWidth * sx,
    frontOverhang: original.frontOverhang * sz,
    rearOverhang: original.rearOverhang * sz,
    cabinCentre: original.cabinCentre * sz,
    cabinLength: original.cabinLength * sz,
  };
  const components = base.components.map((c) => ({
    ...c,
    position: { x: c.position.x * sx, y: c.position.y, z: c.position.z * sz },
    size: { x: c.size.x * sx, y: c.size.y, z: c.size.z * sz },
  }));
  // Bias adjustment redistributes component masses inside their packaging, rather
  // than translating a COM marker independently of the component model.
  const target = (setup.frontWeight - 0.5) * setup.wheelbase;
  const weights = (lambda: number) =>
    components.map(
      (c) => c.mass * Math.exp((lambda * c.position.z) / setup.wheelbase),
    );
  let lo = -18,
    hi = 18;
  for (let i = 0; i < 36; i++) {
    const mid = (lo + hi) / 2,
      w = weights(mid),
      m = w.reduce((s, n) => s + n, 0),
      z = w.reduce((s, n, j) => s + n * components[j].position.z, 0) / m;
    if (z < target) lo = mid;
    else hi = mid;
  }
  const w = weights((lo + hi) / 2),
    total = w.reduce((s, n) => s + n, 0);
  components.forEach((c, i) => (c.mass = (setup.mass * w[i]) / total));
  return {
    ...componentMassProperties(components),
    dimensions,
    components,
    generated: true,
    halfHeight: 0.14,
    bodyCentreZ: (dimensions.frontOverhang - dimensions.rearOverhang) / 2,
  };
}

export const cornerSetup = (setup: VehicleSetup, index: number) => {
  const id = (["fl", "fr", "rl", "rr"] as const)[index],
    c = setup.corners?.[id];
  return {
    spring:
      (index < 2 ? setup.frontSpring : setup.rearSpring) *
      (c?.springScale ?? 1),
    damping:
      (index < 2 ? setup.frontDamping : setup.rearDamping) *
      (c?.dampingScale ?? 1),
    restLength: setup.restLength + (c?.rideOffset ?? 0),
  };
};
export const wheelInertia = (car: ResolvedCar, index: number) =>
  1.45 *
  (car.dimensions.wheelRadius / 0.32) ** 2 *
  ((index < 2 ? car.dimensions.frontTyreWidth : car.dimensions.rearTyreWidth) /
    0.23);

/** Untrusted imports are bounded and reconstructed; unknown versions are rejected. */
export function decodeCarDefinition(input: unknown): CarDefinition | undefined {
  if (!input || typeof input !== "object") return;
  const v = input as CarDefinition;
  if (
    v.version !== 1 ||
    !CAR_FAMILIES.includes(v.family) ||
    typeof v.name !== "string" ||
    v.name.length > 80 ||
    !v.recipe ||
    v.recipe.version !== 1 ||
    !v.dimensions ||
    !Array.isArray(v.components) ||
    v.components.length < 4 ||
    v.components.length > 24 ||
    !v.appearance
  )
    return;
  const bounds: Record<keyof CarDimensions, [number, number]> = {
    wheelbase: [2.05, 3.45],
    frontTrack: [1.3, 2.1],
    rearTrack: [1.3, 2.15],
    frontOverhang: [0.25, 1.2],
    rearOverhang: [0.3, 1.3],
    bodyWidth: [0.5, 2.35],
    bodyHeight: [0.7, 1.8],
    wheelRadius: [0.25, 0.4],
    frontTyreWidth: [0.16, 0.4],
    rearTyreWidth: [0.16, 0.44],
    clearance: [0.065, 0.24],
    mountY: [-0.05, 0.65],
    cabinCentre: [-0.8, 0.8],
    cabinLength: [0.65, 2.9],
    cabinHeight: [0.25, 1.6],
  };
  const d = {} as CarDimensions;
  for (const key of Object.keys(bounds) as (keyof CarDimensions)[]) {
    const n = v.dimensions[key];
    if (!Number.isFinite(n) || n < bounds[key][0] || n > bounds[key][1]) return;
    d[key] = n;
  }
  const vec = (p: Vec3, min: number, max: number) =>
    p &&
    [p.x, p.y, p.z].every((n) => Number.isFinite(n) && n >= min && n <= max);
  for (const c of v.components)
    if (
      typeof c.name !== "string" ||
      c.name.length > 40 ||
      !Number.isFinite(c.mass) ||
      c.mass <= 0 ||
      c.mass > 2200 ||
      !vec(c.position, -6, 6) ||
      !vec(c.size, 0.02, 6)
    )
      return;
  const mass = v.components.reduce((s, c) => s + c.mass, 0);
  if (mass < 450 || mass > 2600) return;
  if (v.components.filter((c) => c.name === "Engine").length !== 1) return;
  const a = v.appearance;
  if (
    ![a.paint, a.accent].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffff,
    ) ||
    typeof a.stripe !== "boolean" ||
    typeof a.wing !== "boolean" ||
    !Number.isInteger(a.number) ||
    a.number < 1 ||
    a.number > 99
  )
    return;
  const r = v.recipe;
  const shapeLimits: Record<keyof BodyShape, [number, number]> = {
    noseWidth: [0.3, 1],
    rearWidth: [0.3, 1],
    shoulderHeight: [0.24, 0.68],
    roofWidth: [0.24, 0.85],
  };
  if (
    !v.shape ||
    Object.entries(shapeLimits).some(
      ([key, [min, max]]) =>
        !Number.isFinite(v.shape[key as keyof BodyShape]) ||
        v.shape[key as keyof BodyShape] < min ||
        v.shape[key as keyof BodyShape] > max,
    )
  )
    return;
  if (
    ![r.seed, r.mechanicsSeed, r.proportionsSeed, r.appearanceSeed].every(
      (s) => typeof s === "string" && s.length > 0 && s.length <= 64,
    ) ||
    !["road", "sport", "race"].includes(r.band) ||
    !["FF", "FR", "MR", "RR", "F-AWD", "M-AWD"].includes(r.layout) ||
    r.family !== v.family
  )
    return;
  if (
    r.paint !== undefined &&
    (!Number.isInteger(r.paint) || r.paint < 0 || r.paint > 0xffffff)
  )
    return;
  if (
    (r.stripe !== undefined && typeof r.stripe !== "boolean") ||
    (r.wing !== undefined && typeof r.wing !== "boolean")
  )
    return;
  if (r.overrides) {
    if (typeof r.overrides !== "object" || Array.isArray(r.overrides)) return;
    for (const [key, n] of Object.entries(r.overrides)) {
      if (key === "mountY" || !(key in bounds) || !Number.isFinite(n)) return;
    }
  }
  if (r.bodyShape) {
    const limits: Record<keyof BodyShape, [number, number]> = {
      noseWidth: [0.3, 1],
      rearWidth: [0.3, 1],
      shoulderHeight: [0.24, 0.68],
      roofWidth: [0.24, 0.85],
    };
    for (const [key, n] of Object.entries(r.bodyShape)) {
      if (
        !(key in limits) ||
        !Number.isFinite(n) ||
        n < limits[key as keyof BodyShape][0] ||
        n > limits[key as keyof BodyShape][1]
      )
        return;
    }
  }
  return JSON.parse(
    JSON.stringify({
      version: 1,
      name: v.name,
      family: v.family,
      recipe: r,
      dimensions: d,
      shape: {
        noseWidth: v.shape.noseWidth,
        rearWidth: v.shape.rearWidth,
        shoulderHeight: v.shape.shoulderHeight,
        roofWidth: v.shape.roofWidth,
      },
      components: v.components,
      appearance: a,
    }),
  ) as CarDefinition;
}
