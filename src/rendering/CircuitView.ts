import * as THREE from "three";
import { seededRandom } from "../core/math";
import { roadPoint, terrainPoint } from "../track/SurfaceCompiler";
import type { CompiledCircuit } from "../track/SurfaceCompiler";
import { hashSeed } from "../track/Terrain";
import { VenueView } from "./VenueView";

export class CircuitView {
  readonly group = new THREE.Group();
  constructor(readonly circuit: CompiledCircuit) {
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
    });
    const color = new THREE.Color();
    for (const chunk of circuit.chunks) {
      const indexed = new THREE.BufferGeometry();
      indexed.setAttribute(
        "position",
        new THREE.BufferAttribute(chunk.vertices, 3),
      );
      indexed.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
      indexed.computeVertexNormals();
      const geometry = indexed.toNonIndexed();
      indexed.dispose();
      const colors = new Float32Array(chunk.surfaces.length * 9);
      chunk.colors.forEach((hex, i) => {
        color.setHex(hex);
        for (let j = 0; j < 3; j++) color.toArray(colors, i * 9 + j * 3);
      });
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const paint = new THREE.MeshStandardMaterial({
      color: 0xdadfc8,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const markings = new Map<THREE.Material, number[]>();
    const triangle = (points: THREE.Vector3[], mat: THREE.Material) => {
      if (!markings.has(mat)) markings.set(mat, []);
      const positions = markings.get(mat)!;
      for (const point of points) positions.push(point.x, point.y, point.z);
    };
    const patch = (points: THREE.Vector3[], mat: THREE.Material) =>
      triangle(
        [points[0], points[1], points[2], points[0], points[2], points[3]],
        mat,
      );
    const samplePoint = (station: number, lateral: number) => {
      const p = roadPoint(circuit.alignment.sample(station), lateral);
      p.y += 0.008;
      return p;
    };
    const start = circuit.definition.venue ? 36 : circuit.length * 0.026,
      sample = circuit.alignment.sample(start),
      totalWidth = sample.leftWidth + sample.rightWidth;
    const dark = new THREE.MeshStandardMaterial({
      color: 0x243333,
      roughness: 1,
    });
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 16; col++) {
        const a = -sample.rightWidth + (col * totalWidth) / 16,
          b = a + totalWidth / 16,
          s = start + row * 0.7;
        patch(
          [
            samplePoint(s, a),
            samplePoint(s + 0.7, a),
            samplePoint(s + 0.7, b),
            samplePoint(s, b),
          ],
          (row + col) % 2 ? paint : dark,
        );
      }
    for (
      let s = 35;
      s <
      (circuit.definition.venue
        ? Math.min(125, circuit.length)
        : circuit.length);
      s += 42
    ) {
      patch(
        [
          samplePoint(s - 1.7, -0.15),
          samplePoint(s + 0.1, -0.15),
          samplePoint(s + 0.1, 0.15),
          samplePoint(s - 1.7, 0.15),
        ],
        paint,
      );
      triangle(
        [
          samplePoint(s + 1.5, 0),
          samplePoint(s - 0.1, 0.7),
          samplePoint(s - 0.1, -0.7),
        ],
        paint,
      );
    }
    // Two paint batches, independent of lap length or arrow count.
    for (const [mat, positions] of markings) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    if (circuit.definition.venue) this.group.add(new VenueView(circuit).group);
    else this.addTrees();
    this.group.visible = false;
  }

  private addTrees() {
    const random = seededRandom(
        hashSeed(`${this.circuit.definition.id}/trees`),
      ),
      count = this.circuit.definition.site.terrain ? 200 : 80;
    const rows = this.circuit.rows;
    const area = rows
      .slice(1)
      .reduce(
        (sum, row, i) =>
          sum +
          rows[i].position.x * row.position.z -
          row.position.x * rows[i].position.z,
        0,
      );
    const outside = area < 0 ? "right" : "left";
    const trees = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.6, 4.2, 5),
      new THREE.MeshStandardMaterial({
        color: 0x3f6550,
        roughness: 1,
        flatShading: true,
      }),
      count,
    );
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.16, 0.23, 2.1, 5),
      new THREE.MeshStandardMaterial({ color: 0x74604b, roughness: 1 }),
      count,
    );
    const object = new THREE.Object3D();
    let placed = 0;
    const terrainChunks = this.circuit.chunks.filter(
      (c) => c.kind === "terrain",
    );
    for (let i = 0; i < count; i++) {
      // Seeded trees sit on compiled terrain vertices, including the grading,
      // so coarse terrain facets cannot leave their trunks floating.
      const sample = rows[Math.floor(random() * (rows.length - 1))];
      let point = terrainPoint(
          this.circuit.definition,
          sample,
          outside,
          this.circuit.definition.site.terrain
            ? [0.03, 0.06, 0.11, 0.18][Math.floor(random() * 4)]
            : 0.04 + random() * 0.11,
        ),
        scale = 0.8 + random() * 0.7;
      if (terrainChunks.length) {
        const chunk =
          terrainChunks[Math.floor(random() * terrainChunks.length)];
        const offset = Math.floor((random() * chunk.vertices.length) / 3) * 3;
        point = new THREE.Vector3(
          chunk.vertices[offset],
          chunk.vertices[offset + 1],
          chunk.vertices[offset + 2],
        );
        const nearest = this.circuit.locate(point);
        if (
          Math.abs(nearest.lateral) <
          Math.max(nearest.sample.leftWidth, nearest.sample.rightWidth) + 20
        )
          continue;
      }
      const pad = this.circuit.definition.site.paddock;
      if (pad) {
        const dx = point.x - pad.centre.x,
          dz = point.z - pad.centre.z;
        const along = dx * pad.forward.x + dz * pad.forward.z,
          across = dx * pad.forward.z - dz * pad.forward.x;
        if (
          Math.abs(along) < pad.length / 2 + 8 &&
          Math.abs(across) < pad.width / 2 + 8
        )
          continue;
      }
      object.position.copy(point);
      object.position.y += scale * 2.9;
      object.scale.setScalar(scale);
      object.rotation.y = random() * Math.PI;
      object.updateMatrix();
      trees.setMatrixAt(placed, object.matrix);
      object.position.y = point.y + scale;
      object.updateMatrix();
      trunks.setMatrixAt(placed++, object.matrix);
    }
    trees.count = trunks.count = placed;
    trees.castShadow = true;
    trunks.castShadow = true;
    this.group.add(trees, trunks);
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materials.add(material);
        if (object instanceof THREE.InstancedMesh) object.dispose();
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => {
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    });
    textures.forEach((texture) => texture.dispose());
    this.group.clear();
  }
}
