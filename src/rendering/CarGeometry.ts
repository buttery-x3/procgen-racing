import * as THREE from "three";
import { resolveCar } from "../vehicle/CarDefinition";
import type { ResolvedCar } from "../vehicle/CarDefinition";
import type { VehicleSetup } from "../vehicle/types";
import { cabinGeometry } from "./CabinGeometry";

export interface CarMaterials {
  body: THREE.Material;
  glass: THREE.Material;
  dark: THREE.Material;
  headlight: THREE.Material;
  taillight: THREE.Material;
  accent: THREE.Material;
}
export interface BodySection {
  z: number;
  halfWidth: number;
  bottom: number;
  top: number;
}
/** Closed, symmetric sectioned primitives; normals face outwards at both caps. */
export function sectionGeometry(sections: BodySection[]) {
  const positions: number[] = [],
    indices: number[] = [];
  for (const s of sections)
    positions.push(
      -s.halfWidth,
      s.bottom,
      s.z,
      s.halfWidth,
      s.bottom,
      s.z,
      s.halfWidth,
      s.top,
      s.z,
      -s.halfWidth,
      s.top,
      s.z,
    );
  for (let i = 0; i < sections.length - 1; i++)
    for (let j = 0; j < 4; j++) {
      const a = i * 4 + j,
        b = i * 4 + ((j + 1) % 4);
      indices.push(a, b, a + 4, b, b + 4, a + 4);
    }
  const end = (sections.length - 1) * 4;
  indices.push(0, 2, 1, 0, 3, 2, end, end + 1, end + 2, end, end + 2, end + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export function createCarBody(setup: VehicleSetup, materials: CarMaterials) {
  const definition = setup.vehicle!,
    car = resolveCar(setup),
    d = car.dimensions,
    family = definition.family,
    group = new THREE.Group(),
    front = d.wheelbase / 2 + d.frontOverhang,
    rear = -d.wheelbase / 2 - d.rearOverhang,
    formula = family === "open-wheel",
    half = d.bodyWidth / 2,
    profile = definition.shape,
    top = profile.shoulderHeight,
    staticSag =
      (setup.mass * 9.81) / (2 * (setup.frontSpring + setup.rearSpring)),
    hubY = d.mountY - setup.restLength + staticSag,
    archRadius = d.wheelRadius + 0.08,
    inner = formula
      ? half
      : Math.min(
          half - 0.04,
          d.frontTrack / 2 -
            d.wheelRadius * Math.sin(setup.steeringLimit) -
            (d.frontTyreWidth / 2) * Math.cos(setup.steeringLimit) -
            0.04,
          d.rearTrack / 2 - d.rearTyreWidth / 2 - 0.04,
        );
  const mesh = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
  ) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const box = (
    w: number,
    h: number,
    l: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => mesh(new THREE.BoxGeometry(w, h, l), material, x, y, z);
  const loft = (sections: BodySection[], material = materials.body) =>
    mesh(sectionGeometry(sections), material);
  const shape = (z: number) => {
    const tip = (z - rear) / (front - rear);
    return {
      width:
        tip < 0.12
          ? profile.rearWidth + ((1 - profile.rearWidth) * tip) / 0.12
          : tip > 0.88
            ? 1 - ((1 - profile.noseWidth) * (tip - 0.88)) / 0.12
            : 1,
      height:
        tip > 0.85
          ? top - (tip - 0.85) * (formula ? 2.1 : 1.3)
          : tip < 0.12
            ? top - 0.08
            : top,
    };
  };
  const stations = new Set([
    rear,
    rear + 0.18,
    front - 0.2,
    front,
    -d.wheelbase * 0.12,
    d.wheelbase * 0.12,
  ]);
  for (const z of [-d.wheelbase / 2, d.wheelbase / 2])
    for (let j = 0; j <= 12; j++)
      stations.add(z + Math.cos((j / 12) * Math.PI) * archRadius);
  const zs = [...stations]
    .filter((z) => z >= rear && z <= front)
    .sort((a, b) => a - b);
  loft(
    zs.map((z) => ({
      z,
      halfWidth: inner * shape(z).width,
      bottom: -car.halfHeight,
      top: Math.max(0.18, shape(z).height),
    })),
  );
  if (!formula)
    for (const side of [-1, 1]) {
      // Side sills rise over the tyre's swept envelope. The central spine remains
      // intact while outboard panels form actual wheel-arch openings.
      const positions: number[] = [],
        indices: number[] = [];
      for (const z of zs) {
        const nearest = Math.min(
            Math.abs(z - d.wheelbase / 2),
            Math.abs(z + d.wheelbase / 2),
          ),
          bottom =
            nearest < archRadius
              ? Math.max(
                  -car.halfHeight,
                  hubY + Math.sqrt(Math.max(0, archRadius ** 2 - nearest ** 2)),
                )
              : -car.halfHeight,
          outer = half * shape(z).width,
          roof = Math.max(bottom + 0.045, shape(z).height);
        positions.push(
          side * inner * shape(z).width,
          bottom,
          z,
          side * outer,
          bottom,
          z,
          side * outer,
          roof,
          z,
          side * inner * shape(z).width,
          roof,
          z,
        );
      }
      for (let i = 0; i < zs.length - 1; i++)
        for (let j = 0; j < 4; j++) {
          const a = i * 4 + j,
            b = i * 4 + ((j + 1) % 4);
          const face = [a, b, a + 4, b, b + 4, a + 4];
          indices.push(...(side > 0 ? face : face.reverse()));
        }
      const e = (zs.length - 1) * 4,
        cap = [0, 2, 1, 0, 3, 2, e, e + 1, e + 2, e, e + 2, e + 3];
      indices.push(...(side > 0 ? cap : cap.reverse()));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      mesh(geometry, materials.body);
      box(
        0.045,
        0.07,
        (front - rear) * 0.76,
        materials.dark,
        side * (half - 0.025),
        -0.12,
        (front + rear) / 2,
      );
    }
  const cabinBottom = top - 0.025,
    cabinTop = Math.max(cabinBottom + 0.18, d.cabinHeight - 0.045);
  if (formula) {
    box(0.48, 0.12, 0.8, materials.dark, 0, 0.42, d.cabinCentre);
    mesh(
      new THREE.SphereGeometry(0.13, 8, 6),
      materials.accent,
      0,
      Math.min(0.56, d.cabinHeight - 0.13),
      d.cabinCentre - 0.12,
    );
    loft([
      { z: -d.wheelbase * 0.42, halfWidth: 0.25, bottom: 0.2, top: 0.38 },
      {
        z: -0.45,
        halfWidth: 0.26,
        bottom: 0.2,
        top: Math.min(0.7, d.cabinHeight),
      },
      {
        z: d.cabinCentre - 0.35,
        halfWidth: 0.16,
        bottom: 0.2,
        top: Math.min(0.67, d.cabinHeight),
      },
    ]);
    for (const side of [-1, 1])
      box(0.24, 0.26, 1.25, materials.body, side * 0.51, 0.08, -0.36);
  } else {
    const cabinShape = {
      baseWidth: d.bodyWidth * (family === "prototype" ? 0.45 : 0.84),
      baseLength: d.cabinLength,
      roofWidth: d.bodyWidth * profile.roofWidth,
      roofLength: d.cabinLength * (family === "hatch" ? 0.72 : 0.5),
      bottom: cabinBottom,
      top: cabinTop,
      centreZ: d.cabinCentre,
      roofThickness: 0.045,
    };
    mesh(cabinGeometry(cabinShape), materials.glass);
    box(
      cabinShape.roofWidth,
      0.045,
      cabinShape.roofLength,
      materials.body,
      0,
      cabinTop + 0.022,
      d.cabinCentre,
    );
    // Pillars and a waist band keep the cabin readable as glass panels.
    box(
      cabinShape.roofWidth + 0.03,
      0.035,
      cabinShape.roofLength + 0.04,
      materials.accent,
      0,
      cabinTop - 0.06,
      d.cabinCentre,
    );
    if (["hatch", "sedan", "awd", "stock"].includes(family))
      for (const side of [-1, 1])
        box(
          0.035,
          cabinTop - cabinBottom,
          0.05,
          materials.body,
          side * d.bodyWidth * 0.365,
          (cabinTop + cabinBottom) / 2,
          d.cabinCentre,
        );
  }
  for (const side of [-1, 1]) {
    if (!formula) {
      box(
        d.bodyWidth * 0.19,
        0.065,
        0.035,
        materials.headlight,
        side * d.bodyWidth * 0.31,
        0.21,
        front + 0.018,
      );
      box(
        d.bodyWidth * 0.16,
        0.065,
        0.035,
        materials.taillight,
        side * d.bodyWidth * 0.33,
        0.28,
        rear - 0.018,
      );
    }
    if (setup.enginePosition !== "front" && !formula)
      for (let i = 0; i < 5; i++)
        box(
          0.23,
          0.013,
          0.035,
          materials.dark,
          side * 0.3,
          top + 0.012,
          -d.wheelbase * 0.3 - i * 0.075,
        );
    if (!formula)
      box(
        0.14,
        0.08,
        0.18,
        materials.dark,
        side * (half + 0.06),
        cabinBottom + 0.15,
        d.cabinCentre + d.cabinLength * 0.24,
      );
  }
  if (definition.appearance.stripe && !formula)
    for (const z of [
      front - d.frontOverhang * 0.45,
      rear + d.rearOverhang * 0.4,
    ])
      box(0.14, 0.014, 0.45, materials.accent, 0, shape(z).height + 0.012, z);
  if (definition.appearance.wing) {
    const width = formula ? d.rearTrack + d.rearTyreWidth : d.bodyWidth * 0.94,
      z = rear + 0.12,
      y = top + (formula ? 0.4 : 0.35);
    box(width, 0.065, 0.3, materials.accent, 0, y, z);
    for (const side of [-1, 1]) {
      box(0.045, 0.32, 0.045, materials.dark, side * width * 0.28, y - 0.16, z);
      box(0.035, 0.18, 0.34, materials.body, side * width * 0.5, y + 0.04, z);
    }
  }
  if (formula || family === "prototype")
    box(
      formula ? d.frontTrack + d.frontTyreWidth : d.bodyWidth,
      0.05,
      0.28,
      materials.accent,
      0,
      0,
      front - 0.04,
    );
  return group;
}

export function createControlArms(
  parent: THREE.Group,
  spec: ResolvedCar,
  material: THREE.Material,
) {
  if (!spec.generated) return [];
  const arms = Array.from(
    { length: 8 },
    () =>
      new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6), material),
  );
  arms.forEach((arm) => {
    arm.castShadow = true;
    parent.add(arm);
  });
  return arms;
}
export function updateControlArms(
  arms: THREE.Mesh[],
  spec: ResolvedCar,
  hubs: THREE.Vector3[],
) {
  const up = new THREE.Vector3(0, 1, 0);
  arms.forEach((arm, index) => {
    const wheel = Math.floor(index / 2),
      hub = hubs[wheel],
      side = wheel % 2 === 0 ? 1 : -1,
      root = new THREE.Vector3(
        side * Math.min(0.3, spec.dimensions.bodyWidth * 0.4),
        spec.dimensions.mountY - 0.22,
        ((wheel < 2 ? 1 : -1) * spec.dimensions.wheelbase) / 2 +
          (index % 2 === 0 ? -0.28 : 0.28),
      ),
      delta = hub.clone().sub(root);
    arm.position.copy(root).lerp(hub, 0.5);
    arm.scale.y = delta.length();
    arm.quaternion.setFromUnitVectors(up, delta.normalize());
  });
}
