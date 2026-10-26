import { Quaternion, Vector3 } from "three";
import type {
  VehicleControls,
  VehicleSetup,
  VehicleTelemetry,
} from "../vehicle/types";
import type { CompiledCircuit } from "../track/SurfaceCompiler";
/** Conservative qualification controller, not a racing AI or product assist. */
export function referenceControls(
  t: VehicleTelemetry,
  setup: VehicleSetup,
  circuit: CompiledCircuit,
  cap = 18,
  lateral: (station: number) => number = () => 0,
): VehicleControls {
  const station = t.track?.station ?? circuit.locate(t.position).station,
    look = 6 + t.speed * 0.4,
    q = new Quaternion().copy(t.rotation);
  const aim = circuit
    .frame(station + look, lateral(station + look))
    .position.sub(new Vector3().copy(t.position));
  const angle = Math.atan2(
    aim.dot(new Vector3(-1, 0, 0).applyQuaternion(q)),
    aim.dot(new Vector3(0, 0, 1).applyQuaternion(q)),
  );
  const k = Math.max(
    ...[0, 12, 30, 60].map((d) =>
      Math.abs(circuit.alignment.sample(station + d).curvature),
    ),
  );
  const target = Math.min(cap, Math.sqrt((0.3 * 9.81) / Math.max(0.0001, k)));
  const steer =
    (Math.atan2(2 * setup.wheelbase * Math.sin(angle), look) /
      setup.steeringLimit) *
    (1 + (setup.speedSteering * t.speed) / 18);
  return {
    steer: Math.max(-1, Math.min(1, steer)),
    throttle: Math.max(0, Math.min(1, (target - t.speed) * 0.5)),
    brake: Math.max(0, Math.min(1, (t.speed - target) * 0.4)),
  };
}
