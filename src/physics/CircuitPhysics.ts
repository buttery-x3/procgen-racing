import RAPIER from "@dimforge/rapier3d-compat";
import type { CompiledCircuit } from "../track/SurfaceCompiler";
import type { SurfaceId } from "../track/types";
import { barrierGeometry } from "../track/venue/geometry";

export class CircuitPhysics {
  readonly body: RAPIER.RigidBody;
  private readonly materials = new Map<number, SurfaceId>();
  private readonly obstacles = new Set<number>();

  constructor(
    readonly world: RAPIER.World,
    readonly circuit: CompiledCircuit,
  ) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    try {
      for (const chunk of circuit.chunks) {
        // Group the compiler's exact triangles by material. This avoids relying on
        // triangle feature IDs (0.21.0 returns zero on these mesh ray queries).
        for (const surface of new Set(chunk.surfaces)) {
          const indices: number[] = [];
          chunk.surfaces.forEach((id, i) => {
            if (id === surface)
              indices.push(
                chunk.indices[i * 3],
                chunk.indices[i * 3 + 1],
                chunk.indices[i * 3 + 2],
              );
          });
          const collider = world.createCollider(
            RAPIER.ColliderDesc.trimesh(
              chunk.vertices,
              new Uint32Array(indices),
              RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
            ).setFriction(0.7),
            this.body,
          );
          this.materials.set(collider.handle, surface);
        }
      }
      for (const path of circuit.definition.venue?.barriers ?? []) {
        const mesh = barrierGeometry(path);
        const collider = world.createCollider(
          RAPIER.ColliderDesc.trimesh(
            mesh.vertices,
            mesh.indices,
            RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
          )
            .setFriction(0.45)
            .setRestitution(0.025),
          this.body,
        );
        this.obstacles.add(collider.handle);
      }
      for (const prop of circuit.definition.venue?.props.filter(
        (p) => p.solid,
      ) ?? []) {
        const collider = world.createCollider(
          RAPIER.ColliderDesc.cuboid(5.5, 3, 6)
            .setTranslation(
              prop.position.x,
              prop.position.y + 3,
              prop.position.z,
            )
            .setRotation({
              x: 0,
              y: Math.sin(prop.heading / 2),
              z: 0,
              w: Math.cos(prop.heading / 2),
            })
            .setFriction(0.5)
            .setRestitution(0.025),
          this.body,
        );
        this.obstacles.add(collider.handle);
      }
    } catch (error) {
      world.removeRigidBody(this.body);
      throw error;
    }
  }

  surface(hit: RAPIER.RayColliderIntersection): SurfaceId | undefined {
    return this.materials.get(hit.collider.handle);
  }
  isObstacle(collider: RAPIER.Collider) {
    return this.obstacles.has(collider.handle);
  }
  dispose() {
    this.world.removeRigidBody(this.body);
    this.materials.clear();
    this.obstacles.clear();
  }
}
