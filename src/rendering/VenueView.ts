import * as THREE from "three";
import type { CompiledCircuit } from "../track/SurfaceCompiler";
import { roadPoint } from "../track/SurfaceCompiler";
import { barrierGeometry, pitOffset } from "../track/venue/geometry";
import type { BarrierPath, VenueProp } from "../track/venue/types";

interface Instance {
  p: THREE.Vector3;
  s: THREE.Vector3;
  heading: number;
  pitch: number;
}
interface Batch {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  instances: Instance[];
  far: boolean;
  tile: string;
}

/** Primitive circuit dressing in spatially culled instance batches. Distant
 * vegetation/stands use proxies; decoration has no physics bodies. */
export class VenueView {
  readonly group = new THREE.Group();
  private readonly batches = new Map<string, Batch>();
  private readonly cube = new THREE.BoxGeometry(1, 1, 1);
  private readonly cone = new THREE.ConeGeometry(1, 1, 6);
  private readonly lowCone = new THREE.ConeGeometry(1, 1, 4);
  private readonly cylinder = new THREE.CylinderGeometry(1, 1, 1, 6);
  private readonly bush = new THREE.IcosahedronGeometry(1, 0);
  private readonly plane = new THREE.PlaneGeometry(1, 1);
  private readonly materials = new Map<number, THREE.MeshStandardMaterial>();
  private readonly labels = new Map<string, THREE.Material>();
  constructor(readonly circuit: CompiledCircuit) {
    const venue = circuit.definition.venue!;
    for (const barrier of venue.barriers) {
      const data = barrierGeometry(barrier),
        geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(data.vertices, 3),
      );
      geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
      geometry.computeVertexNormals();
      const material = this.mat(
        {
          guardrail: 0x89928a,
          wall: 0xc9cebc,
          tyres: 0x303833,
          impact: 0xd2d6c3,
        }[barrier.kind],
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      if (barrier.kind === "tyres")
        for (let i = 1; i < barrier.points.length; i++) {
          const a = barrier.points[i - 1],
            b = barrier.points[i],
            distance = Math.hypot(b.x - a.x, b.z - a.z),
            heading = Math.atan2(b.x - a.x, b.z - a.z),
            steps = Math.ceil(distance / 1.15);
          for (let j = 0; j < steps; j++)
            for (const y of [0.24, 0.7]) {
              const p = new THREE.Vector3()
                .copy(a)
                .lerp(new THREE.Vector3().copy(b), j / steps);
              p.y += y;
              this.add(
                this.cylinder,
                this.mat(i % 24 < 8 ? 0xbec5b1 : 0x3d453d),
                p,
                new THREE.Vector3(0.49, 0.45, 0.49),
                heading,
              );
            }
        }
      for (let i = 1; i < barrier.points.length; i += 2) {
        const a = barrier.points[i - 1],
          b = barrier.points[i],
          heading = Math.atan2(b.x - a.x, b.z - a.z),
          p = new THREE.Vector3().copy(b);
        if (barrier.kind === "impact" && i % 4 === 1)
          this.add(
            this.cube,
            this.mat(0xb85845),
            p.clone().add(new THREE.Vector3(0, 0.55, 0)),
            new THREE.Vector3(0.72, 0.96, 2.5),
            heading,
          );
      }
      this.fence(barrier);
    }
    for (const prop of venue.props) this.prop(prop);
    this.paint();
    this.flush();
  }
  private fence(barrier: BarrierPath) {
    const points = barrier.closed
        ? barrier.points.slice(0, -1)
        : barrier.points,
      n = points.length,
      posts = points.map((p, i) => {
        const before =
            points[barrier.closed ? (i - 1 + n) % n : Math.max(0, i - 1)],
          after = points[barrier.closed ? (i + 1) % n : Math.min(n - 1, i + 1)],
          side = new THREE.Vector3(
            after.z - before.z,
            0,
            before.x - after.x,
          ).normalize();
        return new THREE.Vector3()
          .copy(p)
          .addScaledVector(side, barrier.width / 2 + 0.12);
      }),
      material = this.mat(0x697a6a);
    for (const post of posts)
      this.add(
        this.cube,
        material,
        post.clone().add(new THREE.Vector3(0, 1.9, 0)),
        new THREE.Vector3(0.065, 3.2, 0.065),
      );
    // Join actual adjacent posts, including the closing seam. Both rail length
    // and pitch follow the constructed perimeter rather than a nominal spacing.
    for (let i = 0; i < (barrier.closed ? n : n - 1); i++) {
      const a = posts[i],
        b = posts[(i + 1) % n],
        delta = b.clone().sub(a),
        heading = Math.atan2(delta.x, delta.z),
        pitch = -Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
      for (const y of [1.3, 2.8])
        this.add(
          this.cube,
          material,
          a
            .clone()
            .lerp(b, 0.5)
            .add(new THREE.Vector3(0, y, 0)),
          new THREE.Vector3(0.035, 0.035, delta.length()),
          heading,
          false,
          pitch,
        );
    }
  }
  private mat(color: number) {
    let material = this.materials.get(color);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.9,
        flatShading: true,
      });
      this.materials.set(color, material);
    }
    return material;
  }
  private add(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    p: THREE.Vector3,
    s: THREE.Vector3,
    heading = 0,
    far = false,
    pitch = 0,
  ) {
    const tile = `${Math.floor(p.x / 128)},${Math.floor(p.z / 128)}`,
      key = `${tile}/${geometry.uuid}/${material.uuid}/${far}`;
    if (!this.batches.has(key))
      this.batches.set(key, { geometry, material, instances: [], far, tile });
    this.batches.get(key)!.instances.push({ p, s, heading, pitch });
  }
  private local(prop: VenueProp, x: number, y: number, z: number) {
    const c = Math.cos(prop.heading),
      s = Math.sin(prop.heading),
      q = prop.scale;
    return new THREE.Vector3(
      prop.position.x + (x * c + z * s) * q,
      prop.position.y + y * q,
      prop.position.z + (-x * s + z * c) * q,
    );
  }
  private box(
    prop: VenueProp,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    far = false,
  ) {
    this.add(
      this.cube,
      this.mat(color),
      this.local(prop, x, y, z),
      new THREE.Vector3(w, h, d).multiplyScalar(prop.scale),
      prop.heading,
      far,
    );
  }
  private label(
    prop: VenueProp,
    text: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
  ) {
    let material = this.labels.get(text);
    if (!material) {
      if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#f0efdf";
        ctx.fillRect(0, 0, 256, 128);
        ctx.fillStyle = "#26382d";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `700 ${text.length > 4 ? 42 : 88}px system-ui`;
        ctx.fillText(text, 128, 67, 240);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        material = new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.DoubleSide,
        });
      } else material = this.mat(0xefefdd);
      this.labels.set(text, material);
    }
    this.add(
      this.plane,
      material,
      this.local(prop, x, y, z),
      new THREE.Vector3(w, h, 1).multiplyScalar(prop.scale),
      prop.heading,
    );
  }
  private prop(prop: VenueProp) {
    if (prop.kind === "tree") {
      const green =
        this.circuit.definition.venue!.settings.theme === "club"
          ? 0x466b4b
          : 0x476452;
      this.add(
        this.cylinder,
        this.mat(0x766550),
        this.local(prop, 0, 1, 0),
        new THREE.Vector3(0.19, 2, 0.19).multiplyScalar(prop.scale),
        prop.heading,
      );
      this.add(
        this.cone,
        this.mat(green),
        this.local(prop, 0, 3.8, 0),
        new THREE.Vector3(2, 5.3, 2).multiplyScalar(prop.scale),
        prop.heading,
      );
      this.add(
        this.lowCone,
        this.mat(green),
        this.local(prop, 0, 3.4, 0),
        new THREE.Vector3(2, 6, 2).multiplyScalar(prop.scale),
        prop.heading,
        true,
      );
    } else if (prop.kind === "bush") {
      const color =
        this.circuit.definition.venue!.settings.theme === "desert"
          ? 0x89905c
          : 0x62794e;
      this.add(
        this.bush,
        this.mat(color),
        this.local(prop, 0, 0.65, 0),
        new THREE.Vector3(1.3, 0.9, 1).multiplyScalar(prop.scale),
        prop.heading,
      );
      this.add(
        this.bush,
        this.mat(color),
        this.local(prop, 0.7, 0.45, 0.4),
        new THREE.Vector3(0.8, 0.6, 0.7).multiplyScalar(prop.scale),
        prop.heading,
      );
      this.add(
        this.lowCone,
        this.mat(color),
        this.local(prop, 0, 0.6, 0),
        new THREE.Vector3(1.3, 1.5, 1.3).multiplyScalar(prop.scale),
        prop.heading,
        true,
      );
    } else if (prop.kind === "garage") {
      this.box(prop, 0, 3, 0, 11, 6, 12, 0xb4b8a4);
      this.box(prop, 0, 6.15, 0, 11.8, 0.3, 12.5, 0x7c8a7b);
      this.box(prop, 0, 2.1, 6.035, 8, 4, 0.09, 0x4c5d57);
      this.box(prop, 0, 4.7, 6.09, 9, 0.55, 0.12, 0xd4dfb6);
      this.label(prop, prop.label ?? "PIT", 0, 5.35, 6.11, 2.5, 1.0);
      this.box(prop, 0, 3, 0, 11, 6, 12, 0xb4b8a4, true);
      if (prop.label === "01") {
        this.box(prop, -2, 8.1, 0, 4.2, 4, 5, 0xc4c9b5);
        this.box(prop, -2, 9.1, 0, 4.3, 1.8, 5.1, 0x435c5a);
        this.box(prop, -2, 10.2, 0, 4.9, 0.3, 5.8, 0x7c8a7b);
      }
    } else if (prop.kind === "stand") {
      this.box(prop, 0, -0.65, 0, 20, 1.6, 11, 0x7a8376);
      for (let i = 0; i < 5; i++)
        this.box(
          prop,
          0,
          0.45 + i * 0.75,
          4.2 - i * 1.8,
          18,
          0.8,
          1.85,
          i % 2 ? 0x8c9a7b : 0xb3bf98,
        );
      this.box(prop, 0, 6, 0, 21, 0.3, 12, 0xaab49b);
      for (const x of [-9, 9])
        for (const z of [-4.7, 4.7])
          this.box(prop, x, 2.7, z, 0.17, 6, 0.17, 0x536358);
      this.box(prop, 0, 2, 0, 19, 4, 10, 0x8c9a7b, true);
    } else if (prop.kind === "marshal") {
      this.box(prop, 0, 0.4, 0, 2.7, 0.8, 2.6, 0xa6aa91);
      this.box(prop, 0, 1.5, 0, 2.4, 1.8, 2.1, 0x839174);
      this.box(prop, 0, 2.6, 0, 2.9, 0.25, 2.8, 0xadaf91);
      this.label(prop, `M${prop.label}`, 0, 1.9, 1.07, 1.2, 0.6);
      this.box(prop, 0, 1.4, 0, 2.6, 2.8, 2.3, 0x839174, true);
    } else if (prop.kind === "board" || prop.kind === "marker") {
      this.box(prop, 0, 0.7, 0, 0.1, 1.4, 0.1, 0x65765e);
      this.box(
        prop,
        0,
        1.55,
        0,
        prop.kind === "board" ? 1.2 : 1.5,
        0.85,
        0.15,
        0xefefdd,
      );
      this.label(
        prop,
        prop.label ?? "",
        0,
        1.55,
        0.085,
        prop.kind === "board" ? 1.15 : 1.45,
        0.8,
      );
    }
  }
  private flush() {
    const tiles = new Map<string, { near: THREE.Group; far: THREE.Group }>(),
      object = new THREE.Object3D();
    for (const batch of this.batches.values()) {
      if (!tiles.has(batch.tile))
        tiles.set(batch.tile, {
          near: new THREE.Group(),
          far: new THREE.Group(),
        });
      const mesh = new THREE.InstancedMesh(
        batch.geometry,
        batch.material,
        batch.instances.length,
      );
      batch.instances.forEach((i, index) => {
        object.position.copy(i.p);
        object.scale.copy(i.s);
        object.rotation.set(i.pitch, i.heading, 0, "YXZ");
        object.updateMatrix();
        mesh.setMatrixAt(index, object.matrix);
      });
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      mesh.castShadow = !batch.far;
      mesh.receiveShadow = true;
      (batch.far
        ? tiles.get(batch.tile)!.far
        : tiles.get(batch.tile)!.near
      ).add(mesh);
    }
    for (const [key, tile] of tiles) {
      const [x, z] = key.split(",").map(Number),
        lod = new THREE.LOD(),
        origin = new THREE.Vector3(x * 128 + 64, 0, z * 128 + 64);
      // Instance matrices retain world coordinates; group translation is cancelled
      // locally so LOD distance is measured at the tile, not world origin.
      tile.near.position.copy(origin).negate();
      tile.far.position.copy(origin).negate();
      lod.position.copy(origin);
      lod.addLevel(tile.near, 0);
      lod.addLevel(tile.far, 160);
      lod.addLevel(new THREE.Group(), 800);
      this.group.add(lod);
    }
    this.batches.clear();
  }
  private paint() {
    const positions: number[] = [],
      yellow: number[] = [],
      c = this.circuit;
    const point = (s: number, l: number) => {
      const p = roadPoint(c.alignment.sample(s), l);
      p.y += 0.013;
      return p;
    };
    const quad = (
      s0: number,
      s1: number,
      l0: number,
      l1: number,
      out = positions,
    ) => {
      const a = point(s0, l0),
        b = point(s1, l0),
        d = point(s0, l1),
        e = point(s1, l1);
      for (const p of [a, b, d, b, e, d]) out.push(p.x, p.y, p.z);
    };
    const carCount = c.definition.id.startsWith("gp") ? 20 : 12;
    for (let i = 0; i < carCount; i++) {
      const s = 36 - 14 - Math.floor(i / 2) * 9,
        l = (i % 2 ? 1 : -1) * 2.7;
      quad(s - 2.7, s + 2.7, l - 1.1, l - 1);
      quad(s - 2.7, s + 2.7, l + 1, l + 1.1);
      quad(s - 2.7, s - 2.6, l - 1.1, l + 1.1);
    }
    const pit = c.definition.venue!.pit;
    if (pit) {
      for (let s = pit.entry; s < pit.exit; s += 2) {
        const t = Math.min(s + 2, pit.exit);
        for (const side of [-1, 1]) {
          const a =
              pit.side * pitOffset(pit, s, c.length) + (side * pit.width) / 2,
            b = pit.side * pitOffset(pit, t, c.length) + (side * pit.width) / 2;
          const p = [
            point(s, a - 0.06),
            point(t, b - 0.06),
            point(s, a + 0.06),
            point(t, b + 0.06),
          ];
          for (const q of [p[0], p[1], p[2], p[1], p[3], p[2]])
            positions.push(q.x, q.y, q.z);
        }
      }
      const speedLine = pit.entry + pit.mergeLength + 2;
      quad(
        speedLine - 0.12,
        speedLine + 0.12,
        pit.side * pit.offset - pit.width / 2,
        pit.side * pit.offset + pit.width / 2,
        yellow,
      );
      for (let s = pit.apronStart + 6; s < pit.apronEnd - 4; s += 12) {
        const l = pit.side * (pit.offset + pit.width / 2 + 2.2);
        quad(s - 3, s + 3, l - 1.1, l - 1);
        quad(s - 3, s + 3, l + 1, l + 1.1);
        quad(s - 3, s - 2.9, l - 1.1, l + 1.1);
      }
    }
    for (const [vertices, color] of [
      [positions, 0xe7e8d1],
      [yellow, 0xe2bf69],
    ] as const) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }
}
