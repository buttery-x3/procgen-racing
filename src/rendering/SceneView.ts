import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { seededRandom } from "../core/math";
import { resolveCar } from "../vehicle/CarDefinition";
import type { ResolvedCar } from "../vehicle/CarDefinition";
import {
  createCarBody,
  createControlArms,
  updateControlArms,
} from "./CarGeometry";
import type { SuspensionRig } from "../physics/SuspensionRig";
import type { VehicleSetup, VehicleTelemetry } from "../vehicle/types";
import { wheelSide } from "../vehicle/coordinates";
import { REFERENCE_CARS } from "../vehicle/referenceCars";
import { cabinDimensions, cabinGeometry } from "./CabinGeometry";
import { VehiclePresentation } from "./VehiclePresentation";
import { VehicleSun } from "./VehicleSun";
import { ChaseCamera } from "./ChaseCamera";
import { CircuitView } from "./CircuitView";
import type { CompiledCircuit } from "../track/SurfaceCompiler";

const materials = {
  body: new THREE.MeshStandardMaterial({
    color: 0xe49156,
    metalness: 0.2,
    roughness: 0.43,
  }),
  dark: new THREE.MeshStandardMaterial({ color: 0x253336, roughness: 0.58 }),
  glass: new THREE.MeshStandardMaterial({
    color: 0x344e54,
    metalness: 0.35,
    roughness: 0.22,
  }),
  tire: new THREE.MeshStandardMaterial({ color: 0x202526, roughness: 0.96 }),
  rim: new THREE.MeshStandardMaterial({
    color: 0xa7b5b2,
    metalness: 0.7,
    roughness: 0.3,
  }),
  lime: new THREE.MeshStandardMaterial({ color: 0xc9e98b, roughness: 0.5 }),
  headlight: new THREE.MeshStandardMaterial({
    color: 0xececcb,
    emissive: 0xd6dda3,
    emissiveIntensity: 0.25,
  }),
  taillight: new THREE.MeshStandardMaterial({
    color: 0xc5412d,
    emissive: 0x711d18,
    emissiveIntensity: 0.25,
  }),
};

function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A longitudinal sectioned body gives a clear coupe silhouette with few polygons. */
function bodyGeometry(width: number, length: number) {
  const sections = [
    [-0.5, 0.85, -0.1, 0.14],
    [-0.38, 1, -0.16, 0.27],
    [0.16, 1, -0.16, 0.26],
    [0.4, 0.96, -0.1, 0.16],
    [0.5, 0.84, -0.06, 0.08],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [z, scale, bottom, top] of sections) {
    const x = (width / 2) * scale;
    positions.push(
      -x,
      bottom,
      z * length,
      x,
      bottom,
      z * length,
      x,
      top,
      z * length,
      -x,
      top,
      z * length,
    );
  }
  for (let i = 0; i < sections.length - 1; i++)
    for (let j = 0; j < 4; j++) {
      const a = i * 4 + j,
        b = i * 4 + ((j + 1) % 4),
        c = a + 4,
        d = b + 4;
      indices.push(a, b, c, b, d, c);
    }
  indices.push(0, 2, 1, 0, 3, 2, 16, 17, 18, 16, 18, 19);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function markTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#eef0dc";
  ctx.font = "700 90px Arial";
  ctx.textAlign = "center";
  ctx.fillText("DYNAMICS / 01", 512, 122);
  ctx.font = "400 27px Arial";
  ctx.fillText("VEHICLE DEVELOPMENT FACILITY", 512, 182);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 250);
  readonly controls: OrbitControls;
  private platform = new THREE.Group();
  private bump: THREE.Mesh;
  private car = new THREE.Group();
  private drivingGround = new THREE.Group();
  private labScenery = new THREE.Group();
  private baseGround: THREE.Mesh;
  private circuitView: CircuitView;
  private wheelGroups: THREE.Group[] = [];
  private wheelSpinners: THREE.Group[] = [];
  private suspensionLines: THREE.Line[] = [];
  private contactLines: THREE.Line[] = [];
  private readonly sun = new VehicleSun();
  private readonly presentation = new VehiclePresentation();
  private readonly chaseCamera = new ChaseCamera();
  private grid: THREE.GridHelper;
  private resizeObserver: ResizeObserver;
  private physicsPosition = new THREE.Vector3();
  private lastRenderPosition = new THREE.Vector3();
  private cameraTarget = new THREE.Vector3();
  private cameraDelta = new THREE.Vector3();
  private positioned = false;
  forcesVisible = false;
  cameraMode: "orbit" | "chase" | "top" | "overview" = "orbit";
  private setup: VehicleSetup;
  private carSpec!: ResolvedCar;
  private carArms: THREE.Mesh[] = [];

  constructor(
    private container: HTMLElement,
    setup: VehicleSetup,
    circuit: CompiledCircuit,
  ) {
    this.setup = setup;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D suspension rig. Drag to orbit; scroll to zoom.",
    );
    this.container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(0xc1cbbd);
    this.scene.fog = new THREE.Fog(0xc1cbbd, 40, 120);
    this.scene.add(new THREE.HemisphereLight(0xe5f0f2, 0x6c7963, 2.5));
    this.scene.add(this.sun.light, this.sun.light.target);

    const grass = box(
      1000,
      0.2,
      1000,
      new THREE.MeshStandardMaterial({ color: 0x76836c, roughness: 1 }),
      0,
      -0.43,
      0,
    );
    grass.receiveShadow = true;
    this.baseGround = grass;
    this.scene.add(grass);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x969e96,
      roughness: 0.93,
    });
    this.platform.add(box(14, 0.36, 18, padMat, 0, -0.18, 0));
    this.grid = new THREE.GridHelper(14, 14, 0x78867f, 0x88958c);
    this.grid.position.y = 0.004;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.28;
    this.platform.add(this.grid);
    const paint = new THREE.MeshStandardMaterial({
      color: 0xe7ead5,
      roughness: 0.9,
    });
    for (const x of [-5.8, 5.8])
      this.platform.add(box(0.06, 0.008, 15.6, paint, x, 0.007, 0));
    for (const z of [-7.8, 7.8])
      this.platform.add(box(11.6, 0.008, 0.06, paint, 0, 0.007, z));
    // Alignment marks and corner chevrons give the platform a workshop identity.
    for (const x of [-1.4, 1.4])
      for (const z of [-2.3, 2.3]) {
        this.platform.add(box(0.65, 0.008, 0.045, paint, x, 0.009, z));
        this.platform.add(
          box(
            0.045,
            0.008,
            0.5,
            paint,
            x + Math.sign(x) * 0.3,
            0.009,
            z - Math.sign(z) * 0.23,
          ),
        );
      }
    const marking = new THREE.Mesh(
      new THREE.PlaneGeometry(5.8, 1.45),
      new THREE.MeshStandardMaterial({
        map: markTexture(),
        transparent: true,
        depthWrite: false,
        roughness: 1,
      }),
    );
    marking.rotation.x = -Math.PI / 2;
    marking.position.set(0, 0.015, 5.5);
    this.platform.add(marking);
    this.scene.add(this.platform);
    this.bump = box(0.9, 0.11, 1, materials.dark);
    this.scene.add(this.bump);
    this.addScenery();
    this.scene.add(this.labScenery);
    this.addDrivingGround();
    this.circuitView = new CircuitView(circuit);
    this.scene.add(this.circuitView.group);
    this.buildCar(setup);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 4.5;
    this.controls.maxDistance = 32;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.homeCamera();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  buildCar(setup: VehicleSetup) {
    this.setup = setup;
    this.carSpec = resolveCar(setup);
    materials.body.color.setHex(
      setup.vehicle?.appearance.paint ??
        REFERENCE_CARS[setup.referenceCar].color,
    );
    materials.lime.color.setHex(setup.vehicle?.appearance.accent ?? 0xc9e98b);
    for (const line of [...this.suspensionLines, ...this.contactLines]) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.car.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line)
        object.geometry.dispose();
    });
    this.scene.remove(this.car);
    this.car = new THREE.Group();
    this.wheelGroups = [];
    this.wheelSpinners = [];
    this.suspensionLines = [];
    this.contactLines = [];
    const width = setup.trackWidth + 0.2,
      length = setup.wheelbase + 1.28;
    if (setup.vehicle)
      this.car.add(
        createCarBody(setup, { ...materials, accent: materials.lime }),
      );
    else {
      const body = new THREE.Mesh(bodyGeometry(width, length), materials.body);
      body.castShadow = body.receiveShadow = true;
      this.car.add(body);
      this.car.add(
        box(width * 0.91, 0.16, length * 0.95, materials.dark, 0, -0.14, -0.01),
      );
      const cabinShape = cabinDimensions(setup);
      const cabin = new THREE.Mesh(cabinGeometry(cabinShape), materials.glass);
      cabin.castShadow = true;
      cabin.receiveShadow = true;
      this.car.add(cabin);
      this.car.add(
        box(
          cabinShape.roofWidth,
          cabinShape.roofThickness,
          cabinShape.roofLength,
          materials.body,
          0,
          cabinShape.top + cabinShape.roofThickness / 2,
          cabinShape.centreZ,
        ),
      );
      for (const x of [-width * 0.3, width * 0.3]) {
        this.car.add(
          box(0.31, 0.075, 0.06, materials.headlight, x, 0.095, length * 0.49),
        );
        this.car.add(
          box(0.3, 0.07, 0.035, materials.taillight, x, 0.15, -length * 0.49),
        );
      }
      this.car.add(
        box(
          0.11,
          0.015,
          length * 0.24,
          materials.dark,
          -0.17,
          0.185,
          length * 0.34,
        ),
      );
      this.car.add(
        box(
          0.035,
          0.015,
          length * 0.24,
          materials.dark,
          -0.28,
          0.185,
          length * 0.34,
        ),
      );
    }
    for (let i = 0; i < 4; i++) {
      const radius = this.carSpec.dimensions.wheelRadius,
        tyreWidth =
          i < 2
            ? this.carSpec.dimensions.frontTyreWidth
            : this.carSpec.dimensions.rearTyreWidth;
      const wheel = new THREE.Group();
      const spinner = new THREE.Group();
      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, tyreWidth, 20),
        materials.tire,
      );
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      spinner.add(tire);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(
          radius * 0.64,
          radius * 0.64,
          tyreWidth + 0.01,
          10,
        ),
        materials.rim,
      );
      hub.rotation.z = Math.PI / 2;
      spinner.add(hub);
      const marker = box(0.245, 0.04, 0.11, materials.dark, 0, 0.13, 0);
      spinner.add(marker);
      wheel.add(spinner);
      this.car.add(wheel);
      this.wheelGroups.push(wheel);
      this.wheelSpinners.push(spinner);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(),
          new THREE.Vector3(),
        ]),
        new THREE.LineBasicMaterial({ color: 0xf5e89b, depthTest: false }),
      );
      line.renderOrder = 5;
      line.frustumCulled = false;
      this.scene.add(line);
      this.suspensionLines.push(line);
      const contactLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(),
          new THREE.Vector3(),
        ]),
        new THREE.LineBasicMaterial({ color: 0xd9efac, depthTest: false }),
      );
      contactLine.renderOrder = 5;
      contactLine.frustumCulled = false;
      this.scene.add(contactLine);
      this.contactLines.push(contactLine);
    }
    this.carArms =
      setup.vehicle?.family === "open-wheel"
        ? createControlArms(this.car, this.carSpec, materials.dark)
        : [];
    this.scene.add(this.car);
  }

  setCircuit(next: CircuitView) {
    const previous = this.circuitView;
    this.circuitView = next;
    this.scene.add(next.group);
    this.scene.remove(previous.group);
    previous.dispose();
    if (this.cameraMode === "overview") this.setCamera("overview");
  }

  private addDrivingGround() {
    const asphalt = new THREE.MeshStandardMaterial({
      color: 0x77817c,
      roughness: 0.96,
    });
    this.drivingGround.add(box(100, 0.01, 120, asphalt, 0, -0.325, 0));
    const paint = new THREE.LineBasicMaterial({
      color: 0xdce1cc,
      transparent: true,
      opacity: 0.65,
    });
    for (const radius of [14, 18, 30]) {
      const points = Array.from(
        { length: 129 },
        (_, i) =>
          new THREE.Vector3(
            Math.sin((i / 128) * Math.PI * 2) * radius,
            -0.312,
            Math.cos((i / 128) * Math.PI * 2) * radius,
          ),
      );
      this.drivingGround.add(
        new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), paint),
      );
    }
    for (const x of [-7, 7])
      this.drivingGround.add(box(0.06, 0.008, 90, materials.lime, x, -0.31, 0));
    const split = box(
      50,
      0.006,
      120,
      new THREE.MeshStandardMaterial({ color: 0x8d9ea1, roughness: 0.8 }),
      25,
      -0.316,
      0,
    );
    split.name = "split-grip-lane";
    this.drivingGround.add(split);
    this.drivingGround.visible = false;
    this.scene.add(this.drivingGround);
  }

  private addScenery() {
    const random = seededRandom(719);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x675c4b,
      roughness: 1,
    });
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x4e6950,
      roughness: 1,
      flatShading: true,
    });
    const trees = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      canopyMat,
      42,
    );
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.13, 0.18, 1.6, 5),
      trunkMat,
      42,
    );
    const transform = new THREE.Object3D();
    for (let i = 0; i < 42; i++) {
      const angle = random() * Math.PI * 2,
        distance = 85 + random() * 47,
        scale = 1.3 + random() * 1.7;
      const x = Math.sin(angle) * distance,
        z = Math.cos(angle) * distance;
      transform.position.set(x, scale * 1.1, z);
      transform.scale.set(scale, scale * 1.25, scale);
      transform.rotation.y = random() * Math.PI;
      transform.updateMatrix();
      trees.setMatrixAt(i, transform.matrix);
      transform.position.y = 0.5;
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      trunks.setMatrixAt(i, transform.matrix);
    }
    trees.castShadow = true;
    trunks.castShadow = true;
    this.labScenery.add(trees, trunks);
    const structure = new THREE.MeshStandardMaterial({
      color: 0x78837a,
      roughness: 0.9,
    });
    const roof = new THREE.MeshStandardMaterial({
      color: 0x4b5b57,
      roughness: 0.8,
    });
    const stand = new THREE.Group();
    for (let i = 0; i < 5; i++)
      stand.add(box(12, 0.45, 0.8, structure, 0, i * 0.45, -i * 0.8));
    stand.add(box(13, 0.14, 5, roof, 0, 4.1, -1.5));
    for (const x of [-5.5, 5.5])
      stand.add(box(0.13, 4, 0.13, roof, x, 2, -3.3));
    stand.position.set(-61, 0, -47);
    stand.rotation.y = 0.4;
    this.labScenery.add(stand);
    for (const x of [-6.4, 6.4])
      for (const z of [-8.4, 8.4]) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.17, 0.46, 6),
          materials.body,
        );
        cone.position.set(x, 0.23, z);
        cone.castShadow = true;
        this.platform.add(cone);
        this.platform.add(box(0.34, 0.035, 0.34, materials.dark, x, 0.025, z));
      }
    const kerbMat = new THREE.MeshStandardMaterial({
      color: 0xc16650,
      roughness: 1,
    });
    const white = new THREE.MeshStandardMaterial({
      color: 0xd6d8c7,
      roughness: 1,
    });
    for (let i = 0; i < 30; i++)
      this.labScenery.add(
        box(0.8, 0.06, 0.6, i % 2 ? white : kerbMat, 10.6, -0.27, i * 0.6 - 9),
      );
  }

  remember(telemetry: VehicleTelemetry, snap = false) {
    this.physicsPosition.copy(telemetry.position);
    this.presentation.remember(telemetry);
    if (snap) {
      this.car.position.copy(telemetry.position);
      this.car.quaternion.copy(telemetry.rotation);
      if (this.cameraMode === "chase")
        this.chaseCamera.reset(telemetry.position, telemetry.rotation);
    }
    if (!this.positioned) {
      this.car.position.copy(telemetry.position);
      this.car.quaternion.copy(telemetry.rotation);
      this.homeCamera();
      this.positioned = true;
    }
  }

  render(rig: SuspensionRig, alpha: number, dt: number) {
    const telemetry = rig.telemetry;
    const pose = this.presentation.sample(telemetry, alpha);
    const driving = rig.experiment === "handling" || rig.experiment === "split";
    const onCircuit = rig.experiment === "circuit";
    this.circuitView.group.visible = onCircuit;
    this.baseGround.visible = !onCircuit;
    this.labScenery.visible = !onCircuit;
    const fog = this.scene.fog as THREE.Fog;
    const siteRadius = this.circuitView.circuit.definition.site.radius;
    fog.near =
      this.cameraMode === "overview" ? siteRadius * 2 : onCircuit ? 140 : 40;
    fog.far =
      this.cameraMode === "overview" ? siteRadius * 7 : onCircuit ? 450 : 120;
    this.drivingGround.visible = driving;
    this.platform.visible = !driving && !onCircuit;
    this.bump.visible = rig.experiment === "bump";
    this.drivingGround.getObjectByName("split-grip-lane")!.visible =
      rig.experiment === "split";
    this.car.position.copy(pose.position);
    this.car.quaternion.copy(pose.rotation);
    this.platform.quaternion.copy(rig.platform.rotation());
    this.bump.position.copy(rig.bumpPlatform.translation());
    telemetry.wheels.forEach((wheel, i) => {
      const visual = pose.wheels[i];
      this.wheelGroups[i].position.set(
        (wheelSide(i) *
          (i < 2
            ? this.carSpec.dimensions.frontTrack
            : this.carSpec.dimensions.rearTrack)) /
          2,
        this.carSpec.dimensions.mountY - visual.length,
        ((i < 2 ? 1 : -1) * this.setup.wheelbase) / 2,
      );
      this.wheelGroups[i].rotation.y = -visual.steer;
      this.wheelSpinners[i].rotation.x = visual.spin;
      const line = this.suspensionLines[i];
      line.visible = this.forcesVisible;
      if (line.visible) this.updateLine(line, visual.mount, visual.hub);
      const forceLine = this.contactLines[i];
      forceLine.visible = this.forcesVisible && wheel.grounded;
      if (forceLine.visible)
        this.updateLine(forceLine, visual.contact, visual.forceEnd);
    });
    updateControlArms(
      this.carArms,
      this.carSpec,
      this.wheelGroups.map((w) => w.position),
    );
    const target = this.cameraTarget.copy(pose.position);
    target.y += 0.3;
    if (this.cameraMode === "chase") {
      const cameraPose = this.chaseCamera.update(
        pose.position,
        pose.rotation,
        dt,
      );
      this.camera.position.copy(cameraPose.position);
      this.controls.target.copy(cameraPose.target);
      this.camera.lookAt(cameraPose.target);
    } else if (this.cameraMode === "top") {
      this.camera.position.copy(target);
      this.camera.position.y += 13;
      this.camera.position.z -= 0.01;
      this.controls.target.copy(target);
      this.camera.lookAt(target);
    } else if (this.cameraMode === "orbit") {
      const delta = this.cameraDelta
        .copy(pose.position)
        .sub(this.lastRenderPosition);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
      this.controls.update();
    } else this.controls.update();
    this.lastRenderPosition.copy(pose.position);
    this.sun.update(pose.position);
    this.renderer.render(this.scene, this.camera);
  }

  private updateLine(line: THREE.Line, from: THREE.Vector3, to: THREE.Vector3) {
    const points = line.geometry.getAttribute("position");
    points.setXYZ(0, from.x, from.y, from.z);
    points.setXYZ(1, to.x, to.y, to.z);
    points.needsUpdate = true;
  }

  homeCamera() {
    this.cameraMode = "orbit";
    this.controls.enabled = true;
    this.controls.maxDistance = 32;
    this.controls.target
      .copy(this.physicsPosition)
      .add(new THREE.Vector3(0, 0.15, 0));
    this.camera.position
      .copy(this.controls.target)
      .add(new THREE.Vector3(6.2, 4.35, 7.0));
    this.controls.update();
    this.lastRenderPosition.copy(this.physicsPosition);
  }
  setCamera(mode: "orbit" | "chase" | "top" | "overview") {
    this.camera.far = mode === "overview" ? 1800 : 650;
    this.camera.updateProjectionMatrix();
    if (mode !== "overview") this.controls.maxDistance = 32;
    if (mode === "orbit") this.homeCamera();
    else {
      this.cameraMode = mode;
      this.controls.enabled = false;
      if (mode === "chase") {
        this.chaseCamera.reset(this.car.position, this.car.quaternion);
        const pose = this.chaseCamera;
        this.camera.position.copy(pose.position);
        this.controls.target.copy(pose.target);
        this.camera.lookAt(pose.target);
      } else if (mode === "overview") {
        this.controls.enabled = true;
        const rows = this.circuitView.circuit.rows,
          bounds = new THREE.Box3();
        rows.forEach((row) =>
          bounds.expandByPoint(new THREE.Vector3().copy(row.position)),
        );
        const centre = bounds.getCenter(new THREE.Vector3()),
          size = bounds.getSize(new THREE.Vector3());
        const distance =
          (Math.max(size.x / this.camera.aspect, size.z) * 0.85) /
          Math.tan((this.camera.fov * Math.PI) / 360);
        this.controls.maxDistance = distance * 2.5;
        this.camera.far = Math.max(
          1800,
          distance + this.circuitView.circuit.definition.site.radius * 4,
        );
        this.camera.updateProjectionMatrix();
        this.controls.target.copy(centre);
        this.camera.position
          .copy(centre)
          .addScaledVector(
            new THREE.Vector3(0.65, 1.2, 1).normalize(),
            distance,
          );
        this.controls.update();
      }
    }
  }
  toggleGrid() {
    this.grid.visible = !this.grid.visible;
    return this.grid.visible;
  }
  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
  dispose() {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.sun.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          mats.add(m);
      }
    });
    geometries.forEach((g) => g.dispose());
    mats.forEach((m) => {
      if (m instanceof THREE.MeshStandardMaterial) m.map?.dispose();
      m.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
