/** Bounded soil displacement drag, separate from tyre friction and rolling
 * torque. The force always dissipates energy, fades at rest and cannot consume
 * more than a quarter of a contact's velocity in one step. */
export function looseSurfaceDrag(
  longitudinal: number,
  lateral: number,
  load: number,
  coefficient: number,
  cornerMass: number,
  dt: number,
) {
  const speed = Math.hypot(longitudinal, lateral);
  if (speed < 1e-8 || coefficient <= 0 || load <= 0) return { fx: 0, fy: 0 };
  const force = Math.min(
    load * coefficient * Math.tanh(speed / 3),
    ((cornerMass * speed) / dt) * 0.25,
  );
  return {
    fx: (-longitudinal / speed) * force,
    fy: (-lateral / speed) * force,
  };
}
