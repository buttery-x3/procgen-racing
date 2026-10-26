import { AUTHORED_CIRCUIT } from "./authoredCircuit";
import { compileCircuit } from "./SurfaceCompiler";
import type { CompiledCircuit } from "./SurfaceCompiler";

let circuit: CompiledCircuit | undefined;
export const getTestCircuit = () =>
  (circuit ??= compileCircuit(AUTHORED_CIRCUIT));
