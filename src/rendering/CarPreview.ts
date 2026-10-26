import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  createCarBody,
  createControlArms,
  updateControlArms,
} from "./CarGeometry";
import { resolveCar, cornerSetup } from "../vehicle/CarDefinition";
import type { VehicleSetup } from "../vehicle/types";

/** Event-driven workshop preview: renders on edits/orbit/resize, not a second game loop. */
export class CarPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.05, 50);
  private controls: OrbitControls;
  private car = new THREE.Group();
  private overlay = new THREE.Group();
  private resize: ResizeObserver;
  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Generated car preview. Drag to orbit and scroll to zoom.",
    );
    container.append(this.renderer.domElement);
    this.camera.position.set(3.5, 1.9, 3.9);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.25, 0);
    this.controls.minDistance = 3;
    this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.addEventListener("change", this.render);
    this.scene.add(new THREE.HemisphereLight(0xecf3e0, 0x50654c, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(4, 6, 3);
    this.scene.add(light);
    this.resize = new ResizeObserver(this.render);
    this.resize.observe(container);
  }
  private release() {
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    this.car.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        geometries.add(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
          materials.add(m),
        );
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.scene.remove(this.car);
  }
  update(setup: VehicleSetup, showPackaging: boolean) {
    this.release();
    this.car = new THREE.Group();
    this.overlay = new THREE.Group();
    const spec = resolveCar(setup),
      d = spec.dimensions,
      a = setup.vehicle!.appearance;
    const mat = (color: number) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.65,
        metalness: 0.12,
      });
    const body = mat(a.paint),
      accent = mat(a.accent),
      dark = mat(0x253336),
      glass = mat(0x304b50),
      headlight = mat(0xf2f2da),
      taillight = mat(0xbe4835),
      tyre = mat(0x202826),
      rim = mat(0xb1bbb0);
    this.car.add(
      createCarBody(setup, { body, accent, dark, glass, headlight, taillight }),
    );
    for (let i = 0; i < 4; i++) {
      const corner = cornerSetup(setup, i),
        sag =
          (setup.mass *
            9.81 *
            (i < 2 ? setup.frontWeight : 1 - setup.frontWeight)) /
          (2 * corner.spring),
        radius = d.wheelRadius,
        width = i < 2 ? d.frontTyreWidth : d.rearTyreWidth;
      for (const [r, w, m] of [
        [radius, width, tyre],
        [radius * 0.64, width + 0.01, rim],
      ] as const) {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 16), m);
        mesh.rotation.z = Math.PI / 2;
        mesh.position.set(
          ((i % 2 === 0 ? 1 : -1) * (i < 2 ? d.frontTrack : d.rearTrack)) / 2,
          d.mountY - corner.restLength + sag,
          ((i < 2 ? 1 : -1) * d.wheelbase) / 2,
        );
        this.car.add(mesh);
      }
    }
    if (setup.vehicle!.family === "open-wheel") {
      const hubs = Array.from({ length: 4 }, (_, i) => {
        const c = cornerSetup(setup, i),
          sag =
            (setup.mass *
              9.81 *
              (i < 2 ? setup.frontWeight : 1 - setup.frontWeight)) /
            (2 * c.spring);
        return new THREE.Vector3(
          ((i % 2 === 0 ? 1 : -1) * (i < 2 ? d.frontTrack : d.rearTrack)) / 2,
          d.mountY - c.restLength + sag,
          ((i < 2 ? 1 : -1) * d.wheelbase) / 2,
        );
      });
      updateControlArms(createControlArms(this.car, spec, dark), spec, hubs);
    }
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(3.8, 3.8, 0.035, 48),
      mat(0x293b2c),
    );
    floor.position.y = -spec.halfHeight - d.clearance - 0.025;
    this.car.add(floor);
    const engine = spec.components.find((c) => c.name === "Engine")!;
    const wire = new THREE.MeshBasicMaterial({
      color: 0xe7b87e,
      wireframe: true,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    });
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(engine.size.x, engine.size.y, engine.size.z),
      wire,
    );
    block.position.copy(engine.position);
    block.renderOrder = 8;
    this.overlay.add(block);
    const com = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xd5f595, depthTest: false }),
    );
    com.position.copy(spec.com);
    com.renderOrder = 10;
    this.overlay.add(com);
    const lineMaterial = new THREE.LineBasicMaterial({
        color: 0xc2d793,
        depthTest: false,
        transparent: true,
        opacity: 0.75,
      }),
      y = -spec.halfHeight - d.clearance + 0.018;
    const line = (points: THREE.Vector3[]) => {
      const l = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        lineMaterial,
      );
      l.renderOrder = 9;
      this.overlay.add(l);
    };
    for (const [z, track] of [
      [d.wheelbase / 2, d.frontTrack],
      [-d.wheelbase / 2, d.rearTrack],
    ])
      line([
        new THREE.Vector3(-track / 2, y, z),
        new THREE.Vector3(track / 2, y, z),
      ]);
    line([
      new THREE.Vector3(d.frontTrack / 2 + 0.3, y, d.wheelbase / 2),
      new THREE.Vector3(d.frontTrack / 2 + 0.3, y, -d.wheelbase / 2),
    ]);
    this.overlay.visible = showPackaging;
    this.car.add(this.overlay);
    this.scene.add(this.car);
    this.render();
  }
  render = () => {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    if (w < 4 || h < 4) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  };
  dispose() {
    this.resize.disconnect();
    this.controls.dispose();
    this.release();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
