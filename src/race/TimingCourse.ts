import { Vector3 } from "three";
import type { Vec3 } from "../vehicle/types";
import type { CompiledCircuit } from "../track/SurfaceCompiler";

export interface TimingGate {
  index: number;
  station: number;
  distance: number;
  position: Vector3;
  forward: Vector3;
  left: Vector3;
  up: Vector3;
  leftWidth: number;
  rightWidth: number;
  sector: number | null;
}
export interface Crossing {
  gate: TimingGate;
  alpha: number;
  forward: boolean;
}
const wrap = (v: number, n: number) => ((v % n) + n) % n;
export class TimingCourse {
  readonly gates: TimingGate[];
  readonly length: number;
  readonly finishDistance: number;
  private cells = new Map<string, TimingGate[]>();
  readonly cellSize = 96;
  constructor(readonly circuit: CompiledCircuit) {
    this.length = circuit.distance;
    // Place the visible line ahead of the existing starting grid, so a standing
    // launch is an out-lap and the timer begins at a real forward crossing.
    const finishStation = wrap(
      circuit.definition.starts[0].at * circuit.length + 22,
      circuit.length,
    );
    this.finishDistance = this.distanceAt(finishStation);
    const count = Math.max(12, Math.ceil(this.length / 120 / 3) * 3);
    this.gates = Array.from({ length: count }, (_, index) => {
      const distance = wrap(
          this.finishDistance + (this.length * index) / count,
          this.length,
        ),
        station = this.stationAt(distance);
      const r = circuit.alignment.sample(station),
        frame = circuit.frame(station);
      const forward = frame.forward.clone().normalize(),
        up = frame.normal.clone().normalize(),
        left = new Vector3().copy(r.left);
      return {
        index,
        distance,
        station,
        position: frame.position.clone(),
        forward,
        up,
        left,
        leftWidth: r.leftWidth,
        rightWidth: r.rightWidth,
        sector:
          index === 0
            ? 3
            : index === count / 3
              ? 1
              : index === (count * 2) / 3
                ? 2
                : null,
      };
    });
    for (const gate of this.gates) {
      const radius = Math.max(gate.leftWidth, gate.rightWidth) + 3;
      for (
        let x = Math.floor((gate.position.x - radius) / this.cellSize);
        x <= Math.floor((gate.position.x + radius) / this.cellSize);
        x++
      )
        for (
          let z = Math.floor((gate.position.z - radius) / this.cellSize);
          z <= Math.floor((gate.position.z + radius) / this.cellSize);
          z++
        ) {
          const key = `${x}:${z}`,
            list = this.cells.get(key) ?? [];
          list.push(gate);
          this.cells.set(key, list);
        }
    }
  }
  distanceAt(station: number) {
    const rows = this.circuit.rows;
    let lo = 0,
      hi = rows.length - 1;
    while (lo + 1 < hi) {
      const m = (lo + hi) >> 1;
      if (rows[m].station <= station) lo = m;
      else hi = m;
    }
    const a = rows[lo],
      b = rows[hi],
      t = (station - a.station) / Math.max(1e-9, b.station - a.station);
    return a.distance + (b.distance - a.distance) * t;
  }
  stationAt(distance: number) {
    const rows = this.circuit.rows;
    let lo = 0,
      hi = rows.length - 1;
    while (lo + 1 < hi) {
      const m = (lo + hi) >> 1;
      if (rows[m].distance <= distance) lo = m;
      else hi = m;
    }
    const a = rows[lo],
      b = rows[hi],
      t = (distance - a.distance) / Math.max(1e-9, b.distance - a.distance);
    return a.station + (b.station - a.station) * t;
  }
  progress(distance: number) {
    return wrap(distance - this.finishDistance, this.length);
  }
  crossings(a: Vec3, b: Vec3): Crossing[] {
    if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > 25) return [];
    const candidates = new Set<TimingGate>();
    for (
      let x = Math.floor(Math.min(a.x, b.x) / this.cellSize);
      x <= Math.floor(Math.max(a.x, b.x) / this.cellSize);
      x++
    )
      for (
        let z = Math.floor(Math.min(a.z, b.z) / this.cellSize);
        z <= Math.floor(Math.max(a.z, b.z) / this.cellSize);
        z++
      )
        for (const g of this.cells.get(`${x}:${z}`) ?? []) candidates.add(g);
    const result: Crossing[] = [];
    for (const gate of candidates) {
      const signed = (p: Vec3) =>
        (p.x - gate.position.x) * gate.forward.x +
        (p.y - gate.position.y) * gate.forward.y +
        (p.z - gate.position.z) * gate.forward.z;
      const d0 = signed(a),
        d1 = signed(b),
        forward = d0 < 0 && d1 >= 0,
        reverse = d0 > 0 && d1 <= 0;
      if (!forward && !reverse) continue;
      const alpha = d0 / (d0 - d1),
        offset = new Vector3(
          a.x + (b.x - a.x) * alpha,
          a.y + (b.y - a.y) * alpha,
          a.z + (b.z - a.z) * alpha,
        ).sub(gate.position);
      const lateral = offset.dot(gate.left),
        height = offset.dot(gate.up);
      if (
        lateral > gate.leftWidth + 0.1 ||
        lateral < -gate.rightWidth - 0.1 ||
        Math.abs(height) > 2.5
      )
        continue;
      result.push({ gate, alpha, forward });
    }
    return result.sort((a, b) => a.alpha - b.alpha);
  }
}
