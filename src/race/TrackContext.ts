import type { CompiledCircuit } from "../track/SurfaceCompiler";
import type { VehicleTelemetry } from "../vehicle/types";

/** Geometry classification shared by lap rules and presentation. No timed rules here. */
export function trackContext(circuit: CompiledCircuit, t: VehicleTelemetry) {
  const location = circuit.locate(t.position, { station: t.track?.station });
  const outside = location.lateral > location.sample.leftWidth + 0.1 || location.lateral < -location.sample.rightWidth - 0.1;
  const lane = circuit.definition.venue?.pit;
  let nearPit = false;
  if (lane && outside) for (let i = 1; i < lane.points.length; i++) {
    const a = lane.points[i - 1], b = lane.points[i], p = t.position;
    const dx = b.x - a.x, dz = b.z - a.z;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / Math.max(1e-9, dx * dx + dz * dz)));
    if (Math.hypot(p.x - a.x - dx * u, p.z - a.z - dz * u) < lane.width / 2 && Math.abs(p.y - a.y - (b.y - a.y) * u) < 2.5) { nearPit = true; break; }
  }
  const pit = outside && (t.track?.branchId === "pit" || location.branchId === "pit" || nearPit);
  let onRoad = false;
  for (const wheel of t.wheels) {
    const contact = wheel.grounded ? wheel.contact : wheel.hub;
    const loc = circuit.locate(contact, { station: location.station, branchId: "main" });
    if (loc.lateral <= loc.sample.leftWidth + 0.1 && loc.lateral >= -loc.sample.rightWidth - 0.1 && Math.hypot(contact.x - loc.sample.position.x, contact.z - loc.sample.position.z) < Math.max(loc.sample.leftWidth, loc.sample.rightWidth) + 4) { onRoad = true; break; }
  }
  const limit = lane?.speedLimit ?? 60 / 3.6;
  return { location, pit, onRoad, limit, overspeed: pit && t.speed > limit + 1 };
}
