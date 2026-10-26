import type { CircuitDefinition } from "./types";

/** Authored non-star-shaped compiler fixture. Opposing infield legs are separated
 * by real land, with two deep bays and a hill on the far side. No generator used. */
export const FOLDED_CIRCUIT: CircuitDefinition = {
  id: "folded-proving-circuit",
  name: "Folded terrain proving circuit",
  controlPoints: [
    [0, -400],
    [250, -400],
    [500, -400],
    [600, -300],
    [600, 100],
    [600, 350],
    [480, 400],
    [300, 400],
    [200, 300],
    [200, 100],
    [160, -100],
    [0, -150],
    [-160, -100],
    [-200, 100],
    [-200, 300],
    [-300, 400],
    [-500, 400],
    [-600, 250],
    [-600, 0],
    [-600, -300],
    [-450, -400],
    [-200, -400],
  ].map(([x, z]) => ({ x, z })),
  elevation: [
    { at: 0, value: 24 },
    { at: 0.1, value: 24 },
    { at: 0.3, value: 36 },
    { at: 0.5, value: 42 },
    { at: 0.7, value: 35 },
    { at: 0.9, value: 24 },
    { at: 1, value: 24 },
  ],
  leftWidth: [
    { at: 0, value: 6 },
    { at: 1, value: 6 },
  ],
  rightWidth: [
    { at: 0, value: 6 },
    { at: 1, value: 6 },
  ],
  bankStrength: [
    { at: 0, value: 1.5 },
    { at: 1, value: 1.5 },
  ],
  crown: [
    { at: 0, value: 0.025 },
    { at: 1, value: 0.025 },
  ],
  kerbs: [],
  sections: [{ start: 0, name: "Authored folded fixture", runoff: "gravel" }],
  starts: [
    {
      id: "start",
      name: "Grid",
      at: 0.015,
      description: "Folded compiler fixture",
    },
  ],
  site: {
    centre: { x: 0, z: 0 },
    radius: 1100,
    mesh: "corridor",
    terrain: { seed: 2741, amplitude: 12, wavelength: 1300, baseHeight: 30 },
  },
};
