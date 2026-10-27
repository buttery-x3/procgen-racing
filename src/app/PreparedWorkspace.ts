import type { VehicleSetup, Experiment } from "../vehicle/types";
import type { CompiledCircuit } from "../track/SurfaceCompiler";
import { SuspensionRig } from "../physics/SuspensionRig";
import { CircuitView } from "../rendering/CircuitView";
import type { SceneView } from "../rendering/SceneView";
import { TimingCourse } from "../race/TimingCourse";

/** Staging allocates an isolated world and off-scene resources. The live world
 * remains owned by App until every constructor and equilibrium step succeeds. */
export function prepareWorkspace(view: Pick<SceneView, "prepareCar"> & Partial<Pick<SceneView, "prepareTimingCourse">>, setup: VehicleSetup, circuit: CompiledCircuit, experiment: Experiment = "circuit", start?: string) {
  let rig: SuspensionRig | undefined;
  let road: CircuitView | undefined;
  let car: ReturnType<SceneView["prepareCar"]> | undefined;
  let timing: ReturnType<SceneView["prepareTimingCourse"]> | undefined;
  try {
    rig = new SuspensionRig(setup);
    rig.setCircuit(circuit);
    if (start) rig.setCircuitStart(start);
    if (experiment !== "circuit") rig.setExperiment(experiment);
    for (let i = 0; i < 360; i++) rig.step();
    const t = rig.telemetry;
    if (![t.position.x, t.position.y, t.position.z, t.roll, t.pitch, t.totalLoad].every(Number.isFinite) || t.groundedCount === 0)
      throw new Error("The candidate vehicle did not settle on its selected start.");
    road = new CircuitView(circuit);
    car = view.prepareCar(setup);
    const course = new TimingCourse(circuit);
    timing = view.prepareTimingCourse?.(course);
    let released = false;
    return { rig, road, car, course, timing, release: () => { released = true; }, dispose: () => {
      if (released) return;
      rig?.dispose(); road?.dispose(); car?.dispose(); timing?.dispose(); released = true;
    } };
  } catch (error) { rig?.dispose(); road?.dispose(); car?.dispose(); timing?.dispose(); throw error; }
}
