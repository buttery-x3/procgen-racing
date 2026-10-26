import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Vector3,
} from "three";
import type { VehicleTelemetry } from "../vehicle/types";
import { tyreSlipPower } from "../core/tyreFeedback";

const MARKS = 1800,
  PARTICLES = 80,
  // Twice the original onset power: half the sensitivity, with unchanged marks.
  SKID_MARK_POWER = 2800;
export class DrivingEffects {
  readonly group = new Group();
  private markPositions = new Float32Array(MARKS * 18);
  private markGeometry = new BufferGeometry();
  private particlePositions = new Float32Array(PARTICLES * 3);
  private particleColors = new Float32Array(PARTICLES * 3);
  private particleGeometry = new BufferGeometry();
  private particles = Array.from({ length: PARTICLES }, () => ({
    position: new Vector3(0, -10000, 0),
    velocity: new Vector3(),
    life: 0,
  }));
  private lastContacts: (Vector3 | null)[] = [null, null, null, null];
  private cursor = 0;
  private particleCursor = 0;
  private count = 0;
  private time = 0;
  private emission = 0;
  constructor() {
    this.markGeometry.setAttribute(
      "position",
      new BufferAttribute(this.markPositions, 3),
    );
    this.markGeometry.setDrawRange(0, 0);
    const marks = new Mesh(
      this.markGeometry,
      new MeshBasicMaterial({
        color: 0x283031,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    marks.frustumCulled = false;
    this.group.add(marks);
    this.particleGeometry.setAttribute(
      "position",
      new BufferAttribute(this.particlePositions, 3),
    );
    this.particleGeometry.setAttribute(
      "color",
      new BufferAttribute(this.particleColors, 3),
    );
    const particles = new Points(
      this.particleGeometry,
      new PointsMaterial({
        vertexColors: true,
        size: 0.48,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    particles.frustumCulled = false;
    this.group.add(particles);
  }
  clear() {
    this.count = 0;
    this.cursor = 0;
    this.markGeometry.setDrawRange(0, 0);
    this.lastContacts.fill(null);
    for (const p of this.particles) p.life = 0;
  }
  update(t: VehicleTelemetry, enabled: boolean) {
    this.group.visible = enabled;
    if (t.time < this.time) this.clear();
    const dt = Math.max(0, Math.min(0.06, t.time - this.time));
    this.time = t.time;
    if (!enabled || !dt) return;
    this.emission += dt;
    const emit = this.emission >= 0.035;
    if (emit) this.emission = 0;
    let dirty = false;
    for (let i = 0; i < 4; i++) {
      const w = t.wheels[i];
      const slipping = t.speed > 3 && tyreSlipPower(w) > SKID_MARK_POWER,
        loose =
          w.surface === "sand" ||
          w.surface === "gravel" ||
          w.surface === "grass";
      if (slipping && !loose) {
        const point = new Vector3()
            .copy(w.contact)
            .addScaledVector(w.normal, 0.025),
          previous = this.lastContacts[i];
        if (
          previous &&
          point.distanceTo(previous) > 0.12 &&
          point.distanceTo(previous) < 4
        ) {
          const direction = point.clone().sub(previous).normalize(),
            side = direction
              .clone()
              .cross(w.normal)
              .normalize()
              .multiplyScalar(0.09);
          const corners = [
              previous.clone().add(side),
              previous.clone().sub(side),
              point.clone().sub(side),
              point.clone().add(side),
            ],
            offset = this.cursor * 18;
          [0, 2, 1, 0, 3, 2].forEach((index, j) =>
            corners[index].toArray(this.markPositions, offset + j * 3),
          );
          this.cursor = (this.cursor + 1) % MARKS;
          this.count = Math.min(MARKS, this.count + 1);
          dirty = true;
          this.lastContacts[i] = point;
        } else if (!previous) this.lastContacts[i] = point;
      } else this.lastContacts[i] = null;
      if (emit && w.grounded && t.speed > 4 && (slipping || loose)) {
        const index = this.particleCursor++ % PARTICLES,
          p = this.particles[index];
        p.position.copy(w.contact).addScaledVector(w.normal, 0.12);
        p.life = 0.8;
        p.velocity
          .set(
            Math.sin(this.particleCursor * 7.3) * 0.45,
            0.8,
            Math.cos(this.particleCursor * 3.1) * 0.45,
          )
          .addScaledVector(t.velocity, 0.07);
        const color = loose
          ? w.surface === "sand"
            ? [0.78, 0.67, 0.44]
            : [0.6, 0.55, 0.43]
          : [0.76, 0.81, 0.8];
        this.particleColors.set(color, index * 3);
      }
    }
    if (dirty) {
      this.markGeometry.getAttribute("position").needsUpdate = true;
      this.markGeometry.setDrawRange(0, this.count * 6);
    }
    for (let i = 0; i < PARTICLES; i++) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life > 0) {
        p.position.addScaledVector(p.velocity, dt);
        this.particlePositions.set(
          [p.position.x, p.position.y, p.position.z],
          i * 3,
        );
      } else this.particlePositions.set([0, -10000, 0], i * 3);
    }
    this.particleGeometry.getAttribute("position").needsUpdate = true;
    this.particleGeometry.getAttribute("color").needsUpdate = true;
  }
  get capacity() {
    return { marks: MARKS, particles: PARTICLES };
  }
  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof Mesh || o instanceof Points) {
        o.geometry.dispose();
        (o.material as MeshBasicMaterial).dispose();
      }
    });
    this.group.clear();
  }
}
