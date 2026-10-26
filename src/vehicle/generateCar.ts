import { seededRandom, clamp } from "../core/math";
import { DEFAULT_SETUP, sanitizeSetup } from "./setup";
import {
  componentMassProperties,
  resolveCar,
  fingerprint,
  mechanicsFingerprint,
  decodeCarDefinition,
  bodyShape,
} from "./CarDefinition";
import type {
  CarFamily,
  CarLayout,
  CarRecipe,
  CarDefinition,
  CarDimensions,
  MassComponent,
} from "./CarDefinition";
import type { VehicleSetup } from "./types";
import { engineTorqueAtRpm } from "./Powertrain";

interface Archetype {
  name: string;
  layouts: CarLayout[];
  mass: number;
  wheelbase: number;
  track: number;
  height: number;
  torque: number;
  rpm: number;
  cabin: number;
  length: number;
  rear: number;
  aero: number;
  clearance: number;
  tyre: number;
}
export const ARCHETYPES: Record<CarFamily, Archetype> = {
  hatch: {
    name: "Touring hatch",
    layouts: ["FF", "F-AWD", "FR"],
    mass: 1100,
    wheelbase: 2.48,
    track: 1.54,
    height: 1.45,
    torque: 190,
    rpm: 6800,
    cabin: -0.18,
    length: 2.25,
    rear: 0.64,
    aero: 0,
    clearance: 0.16,
    tyre: 0.205,
  },
  coupe: {
    name: "Grand touring coupe",
    layouts: ["FR", "F-AWD"],
    mass: 1310,
    wheelbase: 2.67,
    track: 1.62,
    height: 1.3,
    torque: 330,
    rpm: 7200,
    cabin: -0.35,
    length: 1.9,
    rear: 0.86,
    aero: 0.15,
    clearance: 0.145,
    tyre: 0.245,
  },
  sedan: {
    name: "Sport sedan",
    layouts: ["FR", "F-AWD", "FF"],
    mass: 1480,
    wheelbase: 2.82,
    track: 1.64,
    height: 1.44,
    torque: 360,
    rpm: 6900,
    cabin: -0.2,
    length: 2.35,
    rear: 0.94,
    aero: 0.05,
    clearance: 0.16,
    tyre: 0.235,
  },
  sports: {
    name: "Mid-engine sport",
    layouts: ["MR", "M-AWD"],
    mass: 1160,
    wheelbase: 2.56,
    track: 1.7,
    height: 1.16,
    torque: 390,
    rpm: 8200,
    cabin: 0.32,
    length: 1.6,
    rear: 0.79,
    aero: 0.45,
    clearance: 0.13,
    tyre: 0.265,
  },
  hypercar: {
    name: "Road hypercar",
    layouts: ["MR", "M-AWD"],
    mass: 1390,
    wheelbase: 2.72,
    track: 1.78,
    height: 1.1,
    torque: 680,
    rpm: 8700,
    cabin: 0.33,
    length: 1.58,
    rear: 0.92,
    aero: 1.25,
    clearance: 0.12,
    tyre: 0.295,
  },
  "rear-coupe": {
    name: "Rear-engine coupe",
    layouts: ["RR"],
    mass: 1290,
    wheelbase: 2.48,
    track: 1.62,
    height: 1.28,
    torque: 380,
    rpm: 7800,
    cabin: 0.16,
    length: 1.92,
    rear: 1.02,
    aero: 0.25,
    clearance: 0.14,
    tyre: 0.255,
  },
  awd: {
    name: "All-wheel sport",
    layouts: ["F-AWD", "M-AWD"],
    mass: 1500,
    wheelbase: 2.75,
    track: 1.68,
    height: 1.4,
    torque: 430,
    rpm: 7400,
    cabin: -0.15,
    length: 2.15,
    rear: 0.85,
    aero: 0.25,
    clearance: 0.16,
    tyre: 0.255,
  },
  gt: {
    name: "GT endurance",
    layouts: ["FR", "MR"],
    mass: 1270,
    wheelbase: 2.75,
    track: 1.85,
    height: 1.15,
    torque: 590,
    rpm: 8300,
    cabin: -0.15,
    length: 1.7,
    rear: 1.01,
    aero: 2.1,
    clearance: 0.095,
    tyre: 0.315,
  },
  prototype: {
    name: "Endurance prototype",
    layouts: ["MR", "M-AWD"],
    mass: 950,
    wheelbase: 2.95,
    track: 1.83,
    height: 0.96,
    torque: 560,
    rpm: 9500,
    cabin: 0.36,
    length: 1.6,
    rear: 0.94,
    aero: 3.3,
    clearance: 0.085,
    tyre: 0.325,
  },
  "open-wheel": {
    name: "Open-wheel formula",
    layouts: ["MR"],
    mass: 650,
    wheelbase: 3.22,
    track: 1.83,
    height: 0.87,
    torque: 380,
    rpm: 12000,
    cabin: 0.22,
    length: 0.95,
    rear: 0.73,
    aero: 4.1,
    clearance: 0.08,
    tyre: 0.31,
  },
  stock: {
    name: "Stock car",
    layouts: ["FR"],
    mass: 1600,
    wheelbase: 2.9,
    track: 1.82,
    height: 1.32,
    torque: 660,
    rpm: 8800,
    cabin: -0.1,
    length: 2.1,
    rear: 1.12,
    aero: 0.6,
    clearance: 0.115,
    tyre: 0.285,
  },
};
export const DEFAULT_CAR_RECIPE: CarRecipe = {
  version: 1,
  seed: "apex-01",
  family: "coupe",
  band: "sport",
  layout: "FR",
  mechanicsSeed: "apex-01",
  proportionsSeed: "apex-01",
  appearanceSeed: "apex-01",
};
export interface CarCheck {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}
export interface CarResult {
  recipe: CarRecipe;
  setup: VehicleSetup;
  definition: CarDefinition;
  checks: CarCheck[];
  valid: boolean;
  fingerprint: string;
  mechanics: string;
  appearance: string;
}
const rng = (seed: string) => seededRandom(parseInt(fingerprint(seed), 16));
const round = (n: number) => Math.round(n * 1e5) / 1e5;
const snap = (n: number, step: number) => round(Math.round(n / step) * step);

export function carChecks(setup: VehicleSetup): CarCheck[] {
  const car = resolveCar(setup),
    d = car.dimensions,
    length = d.wheelbase + d.frontOverhang + d.rearOverhang;
  const frontSag =
      (setup.mass * 9.81 * setup.frontWeight) / (2 * setup.frontSpring),
    rearSag =
      (setup.mass * 9.81 * (1 - setup.frontWeight)) / (2 * setup.rearSpring);
  const clearance =
    d.wheelRadius +
    setup.restLength -
    (frontSag + rearSag) / 2 -
    d.mountY -
    car.halfHeight;
  const check = (
    id: string,
    name: string,
    passed: boolean,
    detail: string,
  ): CarCheck => ({ id, name, passed, detail });
  return [
    check(
      "dimensions",
      "Axles & packaging",
      d.wheelbase >= 2.05 &&
        d.wheelbase <= 3.45 &&
        d.frontTrack >= 1.3 &&
        d.frontTrack <= 2.1 &&
        d.rearTrack >= 1.3 &&
        d.rearTrack <= 2.15 &&
        d.frontOverhang > d.wheelRadius + 0.08 &&
        d.rearOverhang > d.wheelRadius + 0.08,
      `${d.wheelbase.toFixed(2)} m wheelbase · ${length.toFixed(2)} m overall`,
    ),
    check(
      "arches",
      "Wheel clearance",
      setup.vehicle?.family === "open-wheel"
        ? d.bodyWidth <
            Math.min(
              d.frontTrack - d.frontTyreWidth,
              d.rearTrack - d.rearTyreWidth,
            )
        : d.bodyWidth >=
            Math.max(
              d.frontTrack + d.frontTyreWidth * 0.7,
              d.rearTrack + d.rearTyreWidth * 0.7,
            ),
      `${Math.round(d.frontTyreWidth * 1000)}/${Math.round(d.rearTyreWidth * 1000)} mm tyres · swept arch openings`,
    ),
    check(
      "mass",
      "Component mass & centre",
      Math.abs(car.mass - setup.mass) < 0.01 &&
        Math.abs(0.5 + car.com.z / d.wheelbase - setup.frontWeight) < 0.002 &&
        setup.frontWeight >= 0.3 &&
        setup.frontWeight <= 0.68,
      `${Math.round(car.mass)} kg · ${(setup.frontWeight * 100).toFixed(1)}% front · component total matches`,
    ),
    check(
      "inertia",
      "Component inertia",
      Object.values(car.inertia).every((n) => Number.isFinite(n) && n > 30),
      `Principal inertia ${Object.values(car.inertia)
        .map((n) => Math.round(n))
        .join(" / ")} kg·m²`,
    ),
    check(
      "suspension",
      "Static support & clearance",
      Math.max(frontSag, rearSag) < setup.travel * 0.85 &&
        clearance > 0.055 &&
        clearance < 0.3,
      `${Math.round(clearance * 1000)} mm floor clearance · ${Math.round(frontSag * 1000)}/${Math.round(rearSag * 1000)} mm static spring sag`,
    ),
    check(
      "cabin",
      "Body proportions",
      (setup.vehicle?.family === "open-wheel" ||
        d.bodyHeight >
          d.clearance +
            0.14 +
            (setup.vehicle?.shape ?? bodyShape("coupe")).shoulderHeight +
            0.18) &&
        d.cabinLength < length * 0.7 &&
        d.bodyHeight > d.clearance + 0.45 &&
        Math.abs(d.cabinCentre) + d.cabinLength / 2 < length / 2,
      `${d.bodyHeight.toFixed(2)} m tall · ${setup.enginePosition} engine · ${setup.drive.toUpperCase()}`,
    ),
  ];
}

export function generateCar(recipe: CarRecipe): CarResult {
  if (recipe.version !== 1 || !ARCHETYPES[recipe.family])
    throw new Error("Unsupported vehicle recipe version or family.");
  const a = ARCHETYPES[recipe.family];
  if (!a.layouts.includes(recipe.layout))
    throw new Error(`${a.name} supports ${a.layouts.join(", ")}.`);
  if (
    ![
      recipe.seed,
      recipe.mechanicsSeed,
      recipe.proportionsSeed,
      recipe.appearanceSeed,
    ].every((s) => typeof s === "string" && s.length > 0 && s.length <= 64)
  )
    throw new Error("Use 1–64 characters for each car seed.");
  if (!["road", "sport", "race"].includes(recipe.band))
    throw new Error("Unknown performance band.");
  const p = rng(recipe.proportionsSeed + recipe.family),
    m = rng(recipe.mechanicsSeed + recipe.family),
    v = rng(recipe.appearanceSeed),
    variation = (r: () => number, n: number) => 1 + (r() - 0.5) * n;
  const enginePosition =
    recipe.layout === "RR"
      ? "rear"
      : recipe.layout.startsWith("M")
        ? "mid"
        : "front";
  const racing = ["gt", "prototype", "open-wheel", "stock"].includes(
      recipe.family,
    ),
    band = recipe.band === "race" ? 1.16 : recipe.band === "road" ? 0.86 : 1;
  const scale = variation(p, 0.08),
    wheelbase = clamp(a.wheelbase * scale, 2.05, 3.45),
    frontTrack = a.track * variation(p, 0.04),
    rearTrack =
      frontTrack *
      (enginePosition === "front" ? variation(p, 0.02) : 1.015 + p() * 0.02),
    wheelRadius = (racing ? 0.33 : 0.315) * variation(p, 0.08);
  const nominalRest = racing ? 0.28 : 0.36,
    frequency =
      (racing
        ? 2.6
        : recipe.band === "road"
          ? 1.55
          : recipe.band === "race"
            ? 2.25
            : 1.85) * variation(m, 0.1);
  const d: CarDimensions = {
    wheelbase,
    frontTrack,
    rearTrack,
    frontOverhang: (recipe.family === "open-wheel" ? 0.86 : 0.73) * scale,
    rearOverhang: a.rear * scale,
    bodyWidth:
      recipe.family === "open-wheel"
        ? 0.68
        : Math.max(frontTrack, rearTrack) + a.tyre * 0.86 + 0.065,
    bodyHeight: a.height * variation(p, 0.04),
    wheelRadius,
    frontTyreWidth: a.tyre * variation(p, 0.04),
    rearTyreWidth: a.tyre * (enginePosition === "front" ? 1 : 1.1),
    clearance: a.clearance,
    mountY: 0,
    cabinCentre:
      enginePosition === "mid"
        ? 0.32
        : enginePosition === "rear"
          ? 0.16
          : a.cabin,
    cabinLength: a.length * scale,
    cabinHeight: 0.7,
  };
  for (const key of Object.keys(d) as (keyof CarDimensions)[]) {
    if (key !== "mountY" && key !== "cabinHeight")
      d[key] = snap(
        d[key],
        [
          "wheelRadius",
          "frontTyreWidth",
          "rearTyreWidth",
          "clearance",
        ].includes(key)
          ? 0.005
          : 0.01,
      );
  }
  for (const [key, value] of Object.entries(recipe.overrides ?? {})) {
    if (!(key in d) || key === "mountY" || !Number.isFinite(value))
      throw new Error(`Invalid dimension override: ${key}.`);
    (d as unknown as Record<string, number>)[key] = value!;
  }
  // Overall height is measured from the road; bodies and cabin share chassis axes.
  d.cabinHeight =
    recipe.overrides?.cabinHeight ?? d.bodyHeight - d.clearance - 0.14;
  d.mountY =
    d.wheelRadius +
    nominalRest -
    9.81 / (2 * Math.PI * frequency) ** 2 -
    (d.clearance + 0.14);
  Object.keys(d).forEach(
    (k) => (d[k as keyof CarDimensions] = round(d[k as keyof CarDimensions])),
  );
  const mass = Math.round(a.mass * variation(m, 0.12)),
    wb = d.wheelbase,
    engineZ =
      enginePosition === "front"
        ? wb * 0.39
        : enginePosition === "rear"
          ? -wb * 0.66
          : -wb * 0.25;
  const components: MassComponent[] = [];
  const component = (
    name: string,
    fraction: number,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    l: number,
  ) =>
    components.push({
      name,
      mass: round(mass * fraction),
      position: { x, y, z },
      size: { x: w, y: h, z: l },
    });
  const bw = recipe.family === "open-wheel" ? 0.58 : d.bodyWidth;
  const basic = bodyShape(recipe.family),
    sections = {
      noseWidth: snap(
        clamp(basic.noseWidth + (p() - 0.5) * 0.08, 0.3, 1),
        0.01,
      ),
      rearWidth: snap(
        clamp(basic.rearWidth + (p() - 0.5) * 0.08, 0.3, 1),
        0.01,
      ),
      shoulderHeight: snap(basic.shoulderHeight + (p() - 0.5) * 0.04, 0.005),
      roofWidth: snap(basic.roofWidth + (p() - 0.5) * 0.03, 0.01),
      ...recipe.bodyShape,
    },
    shellWidth =
      bw * (0.7 + 0.15 * sections.noseWidth + 0.15 * sections.rearWidth);
  component("Floor & structure", 0.38, 0, 0, 0, bw * 0.84, 0.16, wb + 0.5);
  component(
    "Body panels",
    0.2,
    0,
    (sections.shoulderHeight - 0.14) / 2,
    (enginePosition === "rear" ? -wb * 0.1 : 0) +
      wb * (sections.noseWidth - sections.rearWidth) * 0.06,
    shellWidth,
    sections.shoulderHeight + 0.14,
    wb + 0.7,
  );
  component("Engine", 0.18, 0, 0.13, engineZ, 0.65, 0.46, 0.64);
  component("Transmission", 0.05, 0, 0.02, engineZ * 0.8, 0.4, 0.3, 0.45);
  component(
    "Driver & cockpit",
    0.06,
    0,
    Math.min(0.4, d.cabinHeight * 0.52),
    d.cabinCentre,
    0.5,
    0.55,
    0.65,
  );
  component(
    "Cabin & seats",
    0.04,
    0,
    (sections.shoulderHeight + d.cabinHeight) / 2,
    d.cabinCentre,
    bw * sections.roofWidth,
    Math.max(0.2, d.cabinHeight - sections.shoulderHeight),
    d.cabinLength * 0.65,
  );
  for (const [z, track] of [
    [wb / 2, d.frontTrack],
    [-wb / 2, d.rearTrack],
  ])
    for (const side of [-1, 1])
      component(
        z > 0 ? "Front wheel assembly" : "Rear wheel assembly",
        0.0175,
        (side * track) / 2,
        0.02,
        z,
        0.22,
        d.wheelRadius * 1.4,
        0.35,
      );
  component("Fuel & ancillaries", 0.02, 0, 0.02, -wb * 0.34, 0.5, 0.2, 0.5);
  const massProps = componentMassProperties(components);
  const paint = [
    0xe49156, 0x9bbfc3, 0xc25748, 0xb4be78, 0x9aabcf, 0xd7d9cd, 0xd3b765,
    0x4d8277,
  ][Math.floor(v() * 8)];
  const definition: CarDefinition = {
    version: 1,
    name: `${a.name} / ${recipe.seed.slice(0, 18)}`,
    family: recipe.family,
    recipe: JSON.parse(JSON.stringify(recipe)),
    dimensions: d,
    shape: sections,
    components,
    appearance: {
      paint: recipe.paint ?? paint,
      accent: v() > 0.5 ? 0xe6edcf : 0x263935,
      stripe: recipe.stripe ?? v() > 0.45,
      wing: recipe.wing ?? (racing || a.aero > 0.8),
      number: 1 + Math.floor(v() * 99),
    },
  };
  if (!decodeCarDefinition(definition))
    throw new Error(
      "These dimensions exceed the supported construction envelope. Reduce the override or regenerate.",
    );
  const frontWeight = 0.5 + massProps.com.z / wb,
    rearFrequency = frequency * (enginePosition === "front" ? 0.98 : 1.05),
    kf = ((massProps.mass * frontWeight) / 2) * (2 * Math.PI * frequency) ** 2,
    kr =
      ((massProps.mass * (1 - frontWeight)) / 2) *
      (2 * Math.PI * rearFrequency) ** 2;
  const setup = sanitizeSetup({
    ...DEFAULT_SETUP,
    vehicle: definition,
    mass: massProps.mass,
    wheelbase: wb,
    trackWidth: d.frontTrack,
    frontWeight: snap(frontWeight, 0.001),
    enginePosition,
    referenceCar:
      recipe.layout === "FF"
        ? "ff"
        : recipe.layout.endsWith("AWD")
          ? "awd"
          : enginePosition === "front"
            ? "fr"
            : "mr",
    drive:
      recipe.layout === "FF"
        ? "fwd"
        : recipe.layout.endsWith("AWD")
          ? "awd"
          : "rwd",
    peakTorque: Math.round(a.torque * band * variation(m, 0.14)),
    redline: Math.round((a.rpm * variation(m, 0.05)) / 100) * 100,
    frontSpring: snap(kf, 500),
    rearSpring: snap(kr, 500),
    frontDamping: snap(
      2 * 0.68 * Math.sqrt((kf * massProps.mass * frontWeight) / 2),
      100,
    ),
    rearDamping: snap(
      2 * 0.7 * Math.sqrt((kr * massProps.mass * (1 - frontWeight)) / 2),
      100,
    ),
    frontAntiRoll: snap(kf * 0.22, 500),
    rearAntiRoll: snap(kr * 0.18, 500),
    restLength: nominalRest,
    travel: racing ? 0.18 : 0.26,
    grip: snap(
      racing
        ? 1.5 + Math.min(0.25, (band - 1) * 0.9)
        : 1.0 + (band - 0.86) * 0.65,
      0.01,
    ),
    gearing: racing ? "close" : "road",
    finalDrive: snap(
      recipe.family === "open-wheel" ? 3.6 : 3.5 + m() * 0.6,
      0.01,
    ),
    brakeTorque: snap(massProps.mass * 1.9, 100),
    brakeBias: snap(clamp(frontWeight + 0.08, 0.48, 0.7), 0.01),
    frontDiff: recipe.layout === "FF" ? "lsd" : "open",
    rearDiff: "lsd",
    awdFrontSplit: enginePosition === "mid" ? 0.3 : 0.44,
    downforceArea: snap(a.aero * band, 0.1),
    dragArea: snap(
      recipe.family === "open-wheel" ? 1.05 : 0.6 + (d.bodyHeight - 1) * 0.2,
      0.01,
    ),
    steeringLimit: recipe.family === "open-wheel" ? 0.38 : 0.5,
  });
  const checks = carChecks(setup),
    result: CarResult = {
      recipe: definition.recipe,
      definition,
      setup,
      checks,
      valid: checks.every((c) => c.passed),
      fingerprint: `car1-${fingerprint({ definition, setup })}`,
      mechanics: `mech-${mechanicsFingerprint(setup)}`,
      appearance: `paint-${fingerprint(definition.appearance)}`,
    };
  return result;
}

export function carDerived(setup: VehicleSetup) {
  const car = resolveCar(setup),
    power =
      (engineTorqueAtRpm(setup.redline * 0.8, setup) *
        setup.redline *
        0.8 *
        Math.PI) /
      30 /
      1000;
  return {
    power,
    powerToWeight: (power / setup.mass) * 1000,
    com: car.com,
    inertia: car.inertia,
    length:
      setup.wheelbase +
      car.dimensions.frontOverhang +
      car.dimensions.rearOverhang,
    clearance:
      car.dimensions.wheelRadius +
      setup.restLength -
      ((setup.mass * 9.81 * setup.frontWeight) / (2 * setup.frontSpring) +
        (setup.mass * 9.81 * (1 - setup.frontWeight)) /
          (2 * setup.rearSpring)) /
        2 -
      car.dimensions.mountY -
      car.halfHeight,
  };
}

/** Preserve an existing tune while editing its design. Cosmetic edits retain
 * every physical setting; a new mechanics stream deliberately creates a new base. */
export function retainCarTuning(
  result: CarResult,
  current: VehicleSetup,
): CarResult {
  if (!current.vehicle) return result;
  const before = current.vehicle.recipe,
    after = result.recipe;
  const mechanics = (r: CarRecipe) =>
    fingerprint({
      family: r.family,
      band: r.band,
      layout: r.layout,
      mechanicsSeed: r.mechanicsSeed,
    });
  if (mechanics(before) !== mechanics(after)) return result;
  const design = (r: CarRecipe) =>
    fingerprint({
      mechanics: mechanics(r),
      proportionsSeed: r.proportionsSeed,
      overrides: r.overrides,
      bodyShape: r.bodyShape,
    });
  let setup: VehicleSetup;
  if (design(before) === design(after))
    setup = {
      ...JSON.parse(JSON.stringify(current)),
      vehicle: result.definition,
    };
  else {
    setup = { ...result.setup };
    const original = generateCar(before).setup;
    for (const key of Object.keys(original) as (keyof VehicleSetup)[])
      if (
        !["vehicle", "wheelbase", "trackWidth", "corners"].includes(key) &&
        JSON.stringify(current[key]) !== JSON.stringify(original[key])
      )
        Object.assign(setup, { [key]: current[key] });
    if (current.corners)
      setup.corners = JSON.parse(JSON.stringify(current.corners));
    setup = sanitizeSetup(setup);
  }
  const checks = carChecks(setup);
  return {
    ...result,
    setup,
    checks,
    valid: checks.every((c) => c.passed),
    mechanics: `mech-${mechanicsFingerprint(setup)}`,
    fingerprint: `car1-${fingerprint({ definition: result.definition, setup })}`,
  };
}
