import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { clamp, degrees, radians } from "../core/math";
import { DEFAULT_SETUP, sanitizeSetup } from "../vehicle/setup";
import {
  createTyreState,
  integrateTyre,
  gripCapacity,
  slipRatio,
} from "../vehicle/Tyre";
import { Powertrain } from "../vehicle/Powertrain";
import { distributeDriveTorque } from "../vehicle/Differential";
import { steeringAngles, wheelSide } from "../vehicle/coordinates";
import { CircuitPhysics } from "./CircuitPhysics";
import { getTestCircuit } from "../track/testCircuit";
import type { CompiledCircuit } from "../track/SurfaceCompiler";
import { SURFACES } from "../track/types";
import type { SurfaceId } from "../track/types";
import { looseSurfaceDrag } from "../vehicle/SurfaceResponse";
import {
  resolveCar,
  cornerSetup,
  wheelInertia,
} from "../vehicle/CarDefinition";
import type { ResolvedCar } from "../vehicle/CarDefinition";
import { FIXED_STEP, GRAVITY, NO_CONTROLS, WHEEL_IDS } from "../vehicle/types";
import type {
  Experiment,
  VehicleControls,
  VehicleSetup,
  VehicleTelemetry,
  WheelTelemetry,
} from "../vehicle/types";

let initialization: Promise<void> | undefined;
export function initializePhysics() {
  return (initialization ??= RAPIER.init());
}

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);
const RIGHT = new Vector3(-1, 0, 0);

interface ContactState {
  telemetry: WheelTelemetry;
  hit: boolean;
  normal: Vector3;
  velocity: Vector3;
  support: number;
  material: {
    grip: number;
    rollingResistance: number;
    ploughing: number;
    roughness: number;
  };
}

/** A testable force-based suspension rig; no rendering or DOM dependencies. */
export class SuspensionRig {
  readonly world: RAPIER.World;
  body!: RAPIER.RigidBody;
  readonly platform: RAPIER.RigidBody;
  readonly bumpPlatform: RAPIER.RigidBody;
  private readonly ground: RAPIER.RigidBody;
  circuitPhysics?: CircuitPhysics;
  private activeCircuit?: CompiledCircuit;
  get circuit() {
    return this.activeCircuit ?? getTestCircuit();
  }
  circuitStart = "start";
  setup: VehicleSetup;
  experiment: Experiment = "level";
  time = 0;
  steering = 0;
  bumpHeight = 0;
  private bumpTarget = 0;
  readonly powertrain = new Powertrain();
  readonly tyres = Array.from({ length: 4 }, createTyreState);
  wheelSurfaceGrip = [1, 1, 1, 1];
  private tractionCut = 0;
  private countersteer = 0;
  private assistTelemetry = {
    traction: 0,
    abs: 0,
    stability: 0,
    countersteer: 0,
    hold: false,
  };
  private roadNormal = UP.clone();
  telemetry!: VehicleTelemetry;
  private car!: ResolvedCar;
  private get radius() {
    return this.car.dimensions.wheelRadius;
  }

  constructor(setup: VehicleSetup = DEFAULT_SETUP) {
    this.setup = sanitizeSetup(setup);
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = FIXED_STEP;
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.ground = ground;
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(500, 0.1, 500).setTranslation(0, -0.42, 0),
      ground,
    );
    this.platform = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased(),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(7, 0.18, 9)
        .setTranslation(0, -0.18, 0)
        .setFriction(0.7),
      this.platform,
    );
    this.bumpPlatform = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased(),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.45, 0.055, 0.5).setFriction(0.7),
      this.bumpPlatform,
    );
    this.createChassis();
    this.reset();
  }

  private createChassis() {
    if (this.body) this.world.removeRigidBody(this.body);
    this.car = resolveCar(this.setup);
    const { mass, com, inertia, inertiaFrame, dimensions: d } = this.car;
    const width = d.bodyWidth;
    const length = d.wheelbase + d.frontOverhang + d.rearOverhang;
    // Massless collision shape + explicit mass properties avoids double counting.
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setAdditionalMassProperties(mass, com, inertia, inertiaFrame)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(0.025)
      .setAngularDamping(0.12);
    this.body = this.world.createRigidBody(desc);
    this.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(
        width / 2 - 0.04,
        this.car.halfHeight - 0.04,
        length / 2 - 0.04,
        0.04,
      )
        .setTranslation(0, 0, this.car.bodyCentreZ)
        .setMass(0)
        .setFriction(0.35)
        .setRestitution(0.05),
      this.body,
    );
    if (this.setup.vehicle) {
      const definition = this.setup.vehicle,
        shape = definition.shape;
      if (definition.family !== "open-wheel") {
        const bottom = shape.shoulderHeight - 0.025,
          top = Math.max(bottom + 0.225, d.cabinHeight),
          vertices: number[] = [];
        for (const roof of [false, true])
          for (const x of [-1, 1])
            for (const z of [-1, 1])
              vertices.push(
                (x *
                  d.bodyWidth *
                  (roof
                    ? shape.roofWidth
                    : definition.family === "prototype"
                      ? 0.45
                      : 0.84)) /
                  2,
                roof ? top : bottom,
                d.cabinCentre +
                  (z *
                    d.cabinLength *
                    (roof ? (definition.family === "hatch" ? 0.72 : 0.5) : 1)) /
                    2,
              );
        const cabin = RAPIER.ColliderDesc.convexHull(
          new Float32Array(vertices),
        );
        if (cabin)
          this.world.createCollider(
            cabin.setMass(0).setFriction(0.35).setRestitution(0.03),
            this.body,
          );
      } else
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.16, 0.12, 0.16)
            .setTranslation(0, d.cabinHeight - 0.12, d.cabinCentre - 0.24)
            .setMass(0)
            .setFriction(0.35),
          this.body,
        );
    }
  }

  updateSetup(setup: VehicleSetup, rebuild = false) {
    this.setup = sanitizeSetup(setup);
    if (rebuild) {
      this.createChassis();
      this.reset();
    }
  }

  setExperiment(experiment: Experiment) {
    this.experiment = experiment;
    if (experiment === "circuit" && !this.circuitPhysics)
      this.circuitPhysics = new CircuitPhysics(this.world, this.circuit);
    this.reset();
  }

  setCircuitStart(id: string) {
    if (!this.circuit.definition.starts.some((start) => start.id === id))
      return;
    this.circuitStart = id;
    this.setExperiment("circuit");
  }

  /** Prepare new collision first; a failed build leaves the current circuit intact. */
  setCircuit(circuit: CompiledCircuit) {
    const next = new CircuitPhysics(this.world, circuit),
      previous = this.circuitPhysics;
    next.body.setEnabled(false);
    this.activeCircuit = circuit;
    this.circuitPhysics = next;
    this.circuitStart = circuit.definition.starts[0].id;
    previous?.dispose();
    this.setExperiment("circuit");
  }

  reset(dropHeight = 0) {
    this.time = 0;
    this.steering = 0;
    this.tyres.forEach((state) => Object.assign(state, createTyreState()));
    this.powertrain.reset();
    this.tractionCut = 0;
    this.bumpHeight = 0;
    this.bumpTarget = this.experiment === "bump" ? 0.13 : 0;
    const driving =
      this.experiment === "handling" ||
      this.experiment === "split" ||
      this.experiment === "comparison";
    const onCircuit = this.experiment === "circuit";
    this.platform.setEnabled(!driving && !onCircuit);
    this.ground.setEnabled(!onCircuit);
    this.bumpPlatform.setEnabled(!onCircuit);
    this.circuitPhysics?.body.setEnabled(onCircuit);
    const rotation = new Quaternion();
    if (this.experiment === "pitch")
      rotation.setFromAxisAngle(RIGHT, radians(7));
    if (this.experiment === "bank")
      rotation.setFromAxisAngle(FORWARD, radians(7));
    this.platform.setTranslation({ x: 0, y: 0, z: 0 }, false);
    this.platform.setRotation(rotation, false);
    this.platform.setNextKinematicRotation(rotation);
    this.bumpPlatform.setTranslation(
      { x: this.setup.trackWidth / 2, y: -1, z: this.setup.wheelbase / 2 },
      false,
    );
    this.bumpPlatform.setNextKinematicTranslation(
      this.bumpPlatform.translation(),
    );
    this.roadNormal.copy(UP).applyQuaternion(rotation);
    const equilibriumHeight =
      this.radius +
      this.setup.restLength -
      this.car.dimensions.mountY -
      (this.setup.mass * GRAVITY) /
        (2 * (this.setup.frontSpring + this.setup.rearSpring));
    let spawn = new Vector3(
      0,
      equilibriumHeight + 0.12 + dropHeight - (driving ? 0.32 : 0),
      driving ? -22 : 0,
    );
    if (onCircuit) {
      const circuit = this.circuit,
        start = circuit.definition.starts.find(
          (start) => start.id === this.circuitStart,
        )!;
      const station = start.at * circuit.length,
        sample = circuit.alignment.sample(station);
      const lateral =
        start.lateral === "kerb-left"
          ? sample.leftWidth + 0.4 - this.setup.trackWidth / 2
          : start.lateral === "kerb-right"
            ? -sample.rightWidth - 0.4 + this.setup.trackWidth / 2
            : start.lateral === "edge-right"
              ? -sample.rightWidth - 0.18
              : (start.lateral ?? 0);
      const frame = circuit.frame(station, lateral);
      spawn = frame.position
        .clone()
        .addScaledVector(frame.normal, equilibriumHeight + 0.08 + dropHeight);
      rotation.copy(frame.rotation);
      this.roadNormal.copy(frame.normal);
    }
    this.body.setTranslation(spawn, true);
    if (onCircuit) this.circuitPhysics?.update(spawn, true);
    this.body.setRotation(rotation, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.world.step();
    this.step();
  }

  drop() {
    this.reset(0.6);
  }
  triggerBump() {
    if (this.experiment !== "level" && this.experiment !== "bump")
      this.setExperiment("level");
    this.experiment = "bump";
    this.bumpTarget = this.bumpTarget > 0 ? 0 : 0.13;
  }

  impulse(axis: "roll" | "pitch") {
    const lever =
      axis === "roll"
        ? { x: 0, y: 0, z: this.setup.mass * 0.32 }
        : { x: this.setup.mass * 0.6, y: 0, z: 0 };
    this.body.applyTorqueImpulse(lever, true);
  }

  step(controls: VehicleControls = NO_CONTROLS, dt = FIXED_STEP) {
    if (this.experiment === "circuit")
      this.circuitPhysics?.update(this.body.translation());
    this.world.timestep = dt;
    this.time += dt;
    const localForward = FORWARD.clone().applyQuaternion(
      new Quaternion().copy(this.body.rotation()),
    );
    const localRight = RIGHT.clone().applyQuaternion(
      new Quaternion().copy(this.body.rotation()),
    );
    const speed = new Vector3().copy(this.body.linvel());
    const forwardSpeed = speed.dot(localForward);
    this.countersteer =
      forwardSpeed > 3 && this.telemetry?.groundedCount >= 2
        ? clamp(
            Math.atan2(speed.dot(localRight), Math.abs(forwardSpeed)) *
              this.setup.countersteerAssist *
              0.7,
            -0.2,
            0.2,
          )
        : 0;
    const steeringScale =
      1 / (1 + (this.setup.speedSteering * Math.abs(forwardSpeed)) / 18);
    const requestedSteer =
      clamp(controls.steer, -1, 1) * this.setup.steeringLimit * steeringScale +
      this.countersteer;
    this.steering += (requestedSteer - this.steering) * (1 - Math.exp(-9 * dt));
    this.bumpHeight +=
      (this.bumpTarget - this.bumpHeight) * (1 - Math.exp(-5 * dt));
    this.bumpPlatform.setNextKinematicTranslation({
      x: this.setup.trackWidth / 2,
      y: this.experiment === "bump" ? this.bumpHeight - 0.055 : -1,
      z: this.setup.wheelbase / 2,
    });
    this.body.resetForces(true);
    this.body.resetTorques(true);
    const rotation = new Quaternion().copy(this.body.rotation());
    const position = new Vector3().copy(this.body.translation());
    const up = UP.clone().applyQuaternion(rotation);
    const down = up.clone().negate();
    const com = new Vector3().copy(this.body.worldCom());
    const velocity = new Vector3().copy(this.body.linvel());
    const angularVelocity = new Vector3().copy(this.body.angvel());
    const contacts: ContactState[] = [];

    WHEEL_IDS.forEach((id, index) => {
      const front = index < 2;
      const corner = cornerSetup(this.setup, index);
      const localMount = new Vector3(
        (wheelSide(index) *
          (front
            ? this.car.dimensions.frontTrack
            : this.car.dimensions.rearTrack)) /
          2,
        this.car.dimensions.mountY,
        ((front ? 1 : -1) * this.setup.wheelbase) / 2,
      );
      const mount = localMount.applyQuaternion(rotation).add(position);
      const ray = new RAPIER.Ray(mount, down);
      const maxLength = corner.restLength + 0.08;
      const hit = this.world.castRayAndGetNormal(
        ray,
        maxLength + this.radius,
        true,
        undefined,
        undefined,
        undefined,
        this.body,
        (collider) => !this.circuitPhysics?.isObstacle(collider),
      );
      const valid =
        !!hit &&
        hit.normal.y > 0.25 &&
        new Vector3().copy(hit.normal).dot(up) > 0.3;
      const surface =
        this.experiment === "circuit" && hit
          ? (this.circuitPhysics!.surface(hit) ?? "grass")
          : "asphalt";
      const blend = new Map<SurfaceId, number>([[surface, 1]]);
      const footprint =
        this.experiment === "circuit" && !!this.circuit.definition.venue;
      if (footprint && valid) {
        blend.set(surface, 0.5);
        const steer = front
          ? steeringAngles(
              this.steering,
              this.setup.wheelbase,
              this.setup.trackWidth,
            )[index]
          : 0;
        const across = new Vector3(-1, 0, 0)
          .applyAxisAngle(UP, steer)
          .applyQuaternion(rotation);
        for (const side of [-1, 1]) {
          const width = front
            ? this.car.dimensions.frontTyreWidth
            : this.car.dimensions.rearTyreWidth;
          const origin = mount
            .clone()
            .addScaledVector(
              across,
              side * (this.setup.vehicle ? width * 0.456521739 : 0.105),
            );
          const probe = this.world.castRayAndGetNormal(
            new RAPIER.Ray(origin, down),
            maxLength + this.radius,
            true,
            undefined,
            undefined,
            undefined,
            this.body,
            (collider) => !this.circuitPhysics?.isObstacle(collider),
          );
          const id =
            probe && probe.normal.y > 0.25
              ? (this.circuitPhysics!.surface(probe) ?? surface)
              : surface;
          blend.set(id, (blend.get(id) ?? 0) + 0.25);
        }
      }
      const material = {
        grip: 0,
        rollingResistance: 0,
        ploughing: 0,
        roughness: 0,
      };
      for (const [id, weight] of blend) {
        const m = SURFACES[id];
        material.grip += m.grip * weight;
        material.rollingResistance += m.rollingResistance * weight;
        material.ploughing += (m.ploughing ?? 0) * weight;
        material.roughness += (m.roughness ?? 0) * weight;
      }
      const length = valid
        ? clamp(hit!.timeOfImpact - this.radius, 0.06, maxLength)
        : maxLength;
      const compression = Math.max(0, corner.restLength - length);
      const contact = valid
        ? mount.clone().addScaledVector(down, hit!.timeOfImpact)
        : mount.clone().addScaledVector(down, maxLength + this.radius);
      const normal = valid
        ? new Vector3().copy(hit!.normal).normalize()
        : up.clone();
      const groundBody = valid ? hit!.collider.parent() : null;
      const groundVelocity = groundBody
        ? new Vector3().copy(groundBody.velocityAtPoint(contact))
        : new Vector3();
      const pointVelocity = angularVelocity
        .clone()
        .cross(contact.clone().sub(com))
        .add(velocity)
        .sub(groundVelocity);
      const spring = corner.spring;
      const damping = corner.damping;
      const bumpCompression = Math.max(
        0,
        compression - this.setup.travel * 0.85,
      );
      const support = valid
        ? spring * compression -
          damping * pointVelocity.dot(up) +
          bumpCompression ** 2 * 1800000
        : 0;
      const telemetry: WheelTelemetry = {
        id,
        grounded: valid,
        length,
        compression,
        compressionRatio: compression / this.setup.travel,
        load: 0,
        lateralSpeed: 0,
        longitudinalSpeed: 0,
        slipAngle: 0,
        steer: front
          ? steeringAngles(
              this.steering,
              this.setup.wheelbase,
              this.setup.trackWidth,
            )[index]
          : 0,
        spin: this.tyres[index].spin,
        angularSpeed: this.tyres[index].omega,
        slipRatio: 0,
        longitudinalForce: 0,
        lateralForce: 0,
        driveTorque: 0,
        brakeTorque: 0,
        surfaceGrip: this.wheelSurfaceGrip[index],
        surface,
        ...(footprint
          ? {
              surfaceBlend: [...blend].map(([surface, weight]) => ({
                surface,
                weight,
              })),
              surfaceRoughness: material.roughness,
            }
          : {}),
        absActive: false,
        tractionActive: false,
        mount,
        hub: mount.clone().addScaledVector(down, length),
        contact,
        normal,
      };
      contacts.push({
        telemetry,
        hit: valid,
        normal,
        velocity: pointVelocity,
        support,
        material,
      });
    });

    // Equal/opposite axle coupling; unilateral road support is enforced below.
    for (const axle of [0, 2]) {
      const left = contacts[axle];
      const right = contacts[axle + 1];
      const stiffness =
        axle === 0 ? this.setup.frontAntiRoll : this.setup.rearAntiRoll;
      const difference =
        (left.telemetry.compression - right.telemetry.compression) * stiffness;
      if (left.hit) left.support += difference;
      if (right.hit) right.support -= difference;
    }

    const isDriven = (i: number) =>
      this.setup.drive === "awd" ||
      (this.setup.drive === "fwd" ? i < 2 : i >= 2);
    const chassisForward = FORWARD.clone().applyQuaternion(rotation);
    const signedSpeed = velocity.dot(chassisForward);
    let slipDemand = 0;
    contacts.forEach((c, i) => {
      const t = c.telemetry;
      if (c.hit) {
        t.load =
          clamp(c.support, 0, this.setup.mass * GRAVITY * 2) /
          Math.max(0.3, up.dot(c.normal));
        this.body.addForceAtPoint(
          c.normal.clone().multiplyScalar(t.load),
          t.contact,
          true,
        );
      }
      const forward = FORWARD.clone()
        .applyQuaternion(new Quaternion().setFromAxisAngle(UP, -t.steer))
        .applyQuaternion(rotation);
      forward.addScaledVector(c.normal, -forward.dot(c.normal)).normalize();
      t.longitudinalSpeed = c.velocity.dot(forward);
      if (c.hit && isDriven(i))
        slipDemand = Math.max(
          slipDemand,
          slipRatio(this.tyres[i].omega, t.longitudinalSpeed, this.radius) *
            (this.powertrain.gear < 0 ? -1 : 1),
        );
      t.surfaceGrip =
        this.wheelSurfaceGrip[i] *
        (this.experiment === "circuit"
          ? c.material.grip
          : this.experiment === "split" && t.contact.x > 0
            ? 0.22
            : 1);
      if (
        (this.experiment === "handling" || this.experiment === "split") &&
        (Math.abs(t.contact.x) > 50 || Math.abs(t.contact.z) > 60)
      ) {
        t.surfaceGrip *= 0.55;
        t.surface = "grass";
      }
    });
    const tcTarget =
      clamp((slipDemand - this.setup.longitudinalPeak) * 3, 0, 0.95) *
      this.setup.tractionControl;
    this.tractionCut +=
      (tcTarget - this.tractionCut) * (1 - Math.exp(-25 * dt));
    const torque = this.powertrain.step(
      controls.throttle * (1 - this.tractionCut),
      signedSpeed,
      this.tyres.map((t) => t.omega),
      this.setup,
      dt,
    );
    const torques = distributeDriveTorque(
      torque,
      this.tyres.map((t) => t.omega),
      this.setup,
      dt,
    );
    let absCut = 0;
    let hold = false;
    contacts.forEach((c, i) => {
      const t = c.telemetry;
      const forward = FORWARD.clone()
        .applyQuaternion(new Quaternion().setFromAxisAngle(UP, -t.steer))
        .applyQuaternion(rotation);
      forward.addScaledVector(c.normal, -forward.dot(c.normal)).normalize();
      const right = forward.clone().cross(c.normal).normalize();
      const longitudinal = t.longitudinalSpeed,
        lateral = c.velocity.dot(right);
      t.lateralSpeed = lateral;
      const restLoad =
        (this.setup.mass *
          GRAVITY *
          (i < 2 ? this.setup.frontWeight : 1 - this.setup.frontWeight)) /
        2;
      const capacity = gripCapacity(
        t.load,
        restLoad,
        t.surfaceGrip,
        this.setup,
      );
      const requestedBrake =
        controls.brake *
        this.setup.brakeTorque *
        2 *
        (i < 2 ? this.setup.brakeBias : 1 - this.setup.brakeBias);
      let brake = requestedBrake;
      if (
        this.setup.abs > 0 &&
        c.hit &&
        Math.abs(longitudinal) > 1.8 &&
        requestedBrake > 0
      ) {
        const targetOmega =
          (Math.abs(longitudinal) / this.radius) *
          (1 - this.setup.longitudinalPeak);
        const available = Math.sqrt(
          Math.max(
            0,
            capacity ** 2 - Math.min(capacity, Math.abs(this.tyres[i].fy)) ** 2,
          ),
        );
        let limit =
          available * this.radius * 0.9 +
          (Math.max(0, Math.abs(this.tyres[i].omega) - targetOmega) *
            wheelInertia(this.car, i)) /
            0.035;
        const brakingSlip =
          slipRatio(this.tyres[i].omega, longitudinal, this.radius) *
          Math.sign(longitudinal);
        if (brakingSlip < -this.setup.longitudinalPeak * 1.2)
          limit *= clamp(
            1 + (brakingSlip + this.setup.longitudinalPeak) * 3,
            0.12,
            1,
          );
        brake =
          requestedBrake +
          (Math.min(requestedBrake, limit) - requestedBrake) * this.setup.abs;
        absCut = Math.max(absCut, 1 - brake / requestedBrake);
      }
      brake +=
        i >= 2 ? (controls.handbrake ?? 0) * this.setup.brakeTorque * 1.4 : 0;
      t.driveTorque = torques[i];
      t.brakeTorque = brake;
      t.absActive = requestedBrake > 0 && brake < requestedBrake * 0.95;
      t.tractionActive = isDriven(i) && this.tractionCut > 0.05;
      const force = integrateTyre(
        this.tyres[i],
        longitudinal,
        lateral,
        torques[i],
        brake +
          (this.experiment === "circuit" && c.hit
            ? c.material.rollingResistance * t.load * this.radius
            : 0),
        capacity,
        this.setup.mass / 4,
        this.setup,
        dt,
        this.radius,
        wheelInertia(this.car, i),
      );
      let fx = force.fx,
        fy = force.fy;
      if (
        c.hit &&
        this.experiment === "circuit" &&
        this.circuit.definition.venue
      ) {
        const drag = looseSurfaceDrag(
          longitudinal,
          lateral,
          t.load,
          c.material.ploughing,
          this.setup.mass / 4,
          dt,
        );
        fx += drag.fx;
        fy += drag.fy;
        if (fx * longitudinal < 0)
          fx =
            Math.sign(fx) *
            Math.min(
              Math.abs(fx),
              ((Math.abs(longitudinal) * this.setup.mass) / 4 / dt) * 0.9,
            );
        if (fy * lateral < 0)
          fy =
            Math.sign(fy) *
            Math.min(
              Math.abs(fy),
              ((Math.abs(lateral) * this.setup.mass) / 4 / dt) * 0.9,
            );
      }
      const atRest =
        c.hit &&
        this.setup.autoHold > 0.5 &&
        controls.throttle === 0 &&
        Math.hypot(longitudinal, lateral) < 0.6 &&
        Math.abs(signedSpeed) < 0.6;
      if (atRest) {
        hold = true;
        const gravity = new Vector3(0, -GRAVITY, 0);
        // Contact-point velocities include yaw/roll. Cancelling each in one tick
        // over-corrects a crowned road; finite damping lets the four holds agree.
        const holdRate = 18;
        fx =
          ((-longitudinal * this.setup.mass) / 4) * holdRate -
          (gravity.dot(forward) * this.setup.mass) / 4;
        fy =
          ((-lateral * this.setup.mass) / 4) * holdRate -
          (gravity.dot(right) * this.setup.mass) / 4;
        const utilization = Math.hypot(fx, fy) / Math.max(1, capacity);
        if (utilization > 1) {
          fx /= utilization;
          fy /= utilization;
        }
        this.tyres[i].omega = longitudinal / this.radius;
        this.tyres[i].fx = fx;
        this.tyres[i].fy = fy;
      }
      t.spin = this.tyres[i].spin;
      t.angularSpeed = this.tyres[i].omega;
      t.slipRatio = atRest ? 0 : force.ratio;
      t.slipAngle = force.angle;
      t.longitudinalForce = fx;
      t.lateralForce = fy;
      if (c.hit)
        this.body.addForceAtPoint(
          forward.multiplyScalar(fx).addScaledVector(right, fy),
          t.contact,
          true,
        );
    });
    for (const axle of [0, 2]) {
      if (
        (axle === 0 ? this.setup.frontDiff : this.setup.rearDiff) ===
          "locked" &&
        isDriven(axle)
      ) {
        const average =
          (this.tyres[axle].omega + this.tyres[axle + 1].omega) / 2;
        this.tyres[axle].omega = this.tyres[axle + 1].omega = average;
        contacts[axle].telemetry.angularSpeed = contacts[
          axle + 1
        ].telemetry.angularSpeed = average;
      }
    }
    if (this.setup.drive === "awd" && this.setup.centreDiff === "locked") {
      const front = (this.tyres[0].omega + this.tyres[1].omega) / 2;
      const rear = (this.tyres[2].omega + this.tyres[3].omega) / 2;
      const average = (front + rear) / 2;
      this.tyres.forEach(
        (tyre, i) => (tyre.omega += average - (i < 2 ? front : rear)),
      );
    }
    contacts.forEach((c, i) => {
      c.telemetry.angularSpeed = this.tyres[i].omega;
      c.telemetry.slipRatio = slipRatio(
        this.tyres[i].omega,
        c.telemetry.longitudinalSpeed,
      );
    });
    const roadSpeed = Math.abs(signedSpeed),
      groundedCount = contacts.filter((c) => c.hit).length;
    const desiredYaw = clamp(
      (-signedSpeed / this.setup.wheelbase) * Math.tan(this.steering),
      (-this.setup.grip * GRAVITY) / Math.max(roadSpeed, 1),
      (this.setup.grip * GRAVITY) / Math.max(roadSpeed, 1),
    );
    const stabilityTorque =
      groundedCount >= 2 && roadSpeed > 3
        ? clamp(
            (desiredYaw - angularVelocity.y) * this.setup.mass * 1.8,
            -this.setup.mass * 2,
            this.setup.mass * 2,
          ) * this.setup.stabilityAssist
        : 0;
    this.body.addTorque({ x: 0, y: stabilityTorque, z: 0 }, true);
    this.assistTelemetry = {
      traction: this.tractionCut,
      abs: absCut,
      stability: Math.abs(stabilityTorque) / (this.setup.mass * 2),
      countersteer: this.countersteer,
      hold,
    };
    this.body.addForce(
      velocity
        .clone()
        .multiplyScalar(-0.5 * 1.225 * this.setup.dragArea * velocity.length()),
      true,
    );
    const aeroLoad = 0.5 * 1.225 * this.setup.downforceArea * roadSpeed ** 2;
    for (const sign of [-1, 1]) {
      const point = new Vector3(0, 0, sign * this.setup.wheelbase * 0.4)
        .applyQuaternion(rotation)
        .add(position);
      this.body.addForceAtPoint(
        up.clone().multiplyScalar(-aeroLoad / 2),
        point,
        true,
      );
    }
    this.world.step();
    this.updateTelemetry(
      contacts.map((c) => c.telemetry),
      controls,
    );
  }

  private updateTelemetry(wheels: WheelTelemetry[], controls: VehicleControls) {
    const rotation = new Quaternion().copy(this.body.rotation());
    const forward = FORWARD.clone().applyQuaternion(rotation);
    const right = RIGHT.clone().applyQuaternion(rotation);
    const up = UP.clone().applyQuaternion(rotation);
    const grounded = wheels.filter((w) => w.grounded);
    const referenceValid = grounded.length >= 2;
    if (referenceValid) {
      this.roadNormal.set(0, 0, 0);
      for (const wheel of grounded)
        this.roadNormal.add(new Vector3().copy(wheel.normal));
      this.roadNormal.normalize();
    }
    const velocity = this.body.linvel();
    const worldPitch = Math.atan2(forward.y, Math.hypot(forward.x, forward.z));
    const worldRoll = Math.atan2(-right.y, up.y);
    const totalLoad = wheels.reduce((sum, w) => sum + w.load, 0);
    this.telemetry = {
      time: this.time,
      position: { ...this.body.translation() },
      rotation: { ...this.body.rotation() },
      velocity: { ...velocity },
      speed: Math.hypot(velocity.x, velocity.z),
      pitch: degrees(Math.asin(clamp(forward.dot(this.roadNormal), -1, 1))),
      roll: degrees(
        Math.atan2(-right.dot(this.roadNormal), up.dot(this.roadNormal)),
      ),
      worldPitch: degrees(worldPitch),
      worldRoll: degrees(worldRoll),
      roadPitch: degrees(
        Math.atan2(
          -this.roadNormal.dot(forward.clone().setY(0).normalize()),
          this.roadNormal.y,
        ),
      ),
      roadRoll: degrees(
        Math.atan2(
          this.roadNormal.dot(right.clone().setY(0).normalize()),
          this.roadNormal.y,
        ),
      ),
      roadReferenceValid: referenceValid,
      groundedCount: grounded.length,
      totalLoad,
      frontLoadFraction:
        totalLoad > 1
          ? (wheels[0].load + wheels[1].load) / totalLoad
          : this.setup.frontWeight,
      wheels,
      controls: { ...controls },
      powertrain: { ...this.powertrain.telemetry },
      assists: { ...this.assistTelemetry },
      track:
        this.experiment === "circuit"
          ? (() => {
              const circuit = this.circuit,
                location = circuit.locate(this.body.translation(), {
                  station: this.telemetry?.track?.station,
                }),
                sample = location.sample;
              return {
                station: location.station,
                distance: location.distance,
                length: circuit.length,
                lapDistance: circuit.distance,
                lateral: location.lateral,
                grade: sample.grade,
                bank: sample.bank,
                width: sample.leftWidth + sample.rightWidth,
                section: sample.section.name,
                branchId: location.branchId,
                variantId: location.variantId,
                layer: location.layer,
              };
            })()
          : undefined,
    };
  }

  dispose() {
    this.world.free();
  }
  get streamingStats() {
    return this.circuitPhysics?.stats;
  }
}
