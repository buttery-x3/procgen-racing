import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  BoxGeometry,
} from "three";
import { roadPoint } from "../track/SurfaceCompiler";
import type { TimingCourse } from "../race/TimingCourse";

export class TimingView {
  readonly group = new Group();
  constructor(readonly course: TimingCourse) {
    const positions: number[] = [],
      colors: number[] = [];
    for (const gate of course.gates.filter((g) => g.sector !== null)) {
      const road = course.circuit.alignment,
        n = 48;
      for (let row = 0; row < 2; row++)
        for (let lane = 0; lane < n; lane++) {
          const a =
              (lane / n) * (gate.leftWidth + gate.rightWidth) - gate.rightWidth,
            b =
              ((lane + 1) / n) * (gate.leftWidth + gate.rightWidth) -
              gate.rightWidth;
          const before = road.sample(gate.station + (row - 1) * 0.65),
            after = road.sample(gate.station + row * 0.65);
          const points = [
            roadPoint(before, a),
            roadPoint(before, b),
            roadPoint(after, b),
            roadPoint(after, a),
          ];
          const color =
            gate.index === 0 ? ((row + lane) % 2 ? 0.94 : 0.1) : 0.83;
          for (const i of [0, 2, 1, 0, 3, 2]) {
            const p = points[i];
            positions.push(p.x, p.y + 0.025, p.z);
            colors.push(
              color,
              gate.index === 0 ? color : 0.73,
              gate.index === 0 ? color : 0.4,
            );
          }
        }
      for (const lateral of [-gate.rightWidth - 1, gate.leftWidth + 1]) {
        const p = roadPoint(road.sample(gate.station), lateral),
          post = new Mesh(
            new BoxGeometry(0.16, 1.7, 0.16),
            new MeshBasicMaterial({
              color: gate.index === 0 ? 0xcfe792 : 0xd2b372,
            }),
          );
        post.position.copy(p);
        post.position.y += 0.85;
        this.group.add(post);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({ vertexColors: true }),
    );
    this.group.add(mesh);
  }
  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        (o.material as MeshBasicMaterial).dispose();
      }
    });
    this.group.clear();
  }
}
