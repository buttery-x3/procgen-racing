import { BoxGeometry } from "three";
import type { VehicleSetup } from "../vehicle/types";

export function cabinDimensions(setup: VehicleSetup) {
  const width = setup.trackWidth + 0.2;
  const length = setup.wheelbase + 1.28;
  const compact = setup.referenceCar === "ff";
  const midEngine = setup.enginePosition === "mid";
  return {
    baseWidth: width * 0.86,
    baseLength: length * (compact ? 0.62 : 0.54),
    roofWidth: width * 0.66,
    roofLength: length * (compact ? 0.4 : 0.29),
    bottom: 0.22,
    top: midEngine ? 0.54 : 0.665,
    centreZ: midEngine ? 0.28 : compact ? -0.05 : -0.27,
    roofThickness: 0.055,
  };
}

/** Taper a box in chassis axes, keeping each window planar and left/right symmetric. */
export function cabinGeometry(shape: ReturnType<typeof cabinDimensions>) {
  const geometry = new BoxGeometry(1, 1, 1);
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const top = positions.getY(i) > 0;
    positions.setXYZ(
      i,
      positions.getX(i) * (top ? shape.roofWidth : shape.baseWidth),
      top ? shape.top : shape.bottom,
      shape.centreZ +
        positions.getZ(i) * (top ? shape.roofLength : shape.baseLength),
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}
