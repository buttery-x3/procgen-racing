import RAPIER from "@dimforge/rapier3d-compat";
import type { CompiledCircuit } from "../track/SurfaceCompiler";
import type { SurfaceId } from "../track/types";
import { barrierGeometry } from "../track/venue/geometry";
import {
  ChunkIndex,
  meshBounds,
  boundsDistance,
  tileMesh,
} from "../track/ChunkIndex";
import type { SurfaceChunk } from "../track/types";
import type { VenueProp } from "../track/venue/types";
import type { Vec3 } from "../vehicle/types";

export interface StreamingStats {
  surfaceChunks: number;
  obstacleChunks: number;
  materialColliders: number;
  obstacleColliders: number;
  peakSurfaceChunks: number;
  peakObstacleChunks: number;
  created: number;
  retired: number;
}
type Obstacle =
  | { vertices: Float32Array; indices: Uint32Array }
  | { prop: VenueProp };

export class CircuitPhysics {
  readonly body: RAPIER.RigidBody;
  private readonly materials = new Map<number, SurfaceId>();
  private readonly obstacles = new Set<number>();
  private surfaceIndex?: ChunkIndex;
  private obstacleIndex?: ChunkIndex;
  private obstacleData: Obstacle[] = [];
  private activeSurface = new Map<number, RAPIER.Collider[]>();
  private activeObstacles = new Map<number, RAPIER.Collider[]>();
  private lastPosition = { x: Infinity, y: 0, z: Infinity };
  readonly stats: StreamingStats = {
    surfaceChunks: 0,
    obstacleChunks: 0,
    materialColliders: 0,
    obstacleColliders: 0,
    peakSurfaceChunks: 0,
    peakObstacleChunks: 0,
    created: 0,
    retired: 0,
  };

  constructor(
    readonly world: RAPIER.World,
    readonly circuit: CompiledCircuit,
  ) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    try {
      if (circuit.definition.familyDesign) {
        this.surfaceIndex = new ChunkIndex(
          circuit.chunks.map((c) => meshBounds(c.vertices)),
        );
        for (const path of circuit.definition.venue?.barriers ?? [])
          this.obstacleData.push(...tileMesh(barrierGeometry(path)));
        this.obstacleData.push(
          ...(circuit.definition.venue?.props
            .filter((p) => p.solid)
            .map((prop) => ({ prop })) ?? []),
        );
        this.obstacleIndex = new ChunkIndex(
          this.obstacleData.map((d) =>
            "prop" in d
              ? {
                  minX: d.prop.position.x - 10,
                  maxX: d.prop.position.x + 10,
                  minZ: d.prop.position.z - 10,
                  maxZ: d.prop.position.z + 10,
                }
              : meshBounds(d.vertices),
          ),
        );
        this.update(circuit.rows[0].position, true);
        return;
      }
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

  private createSurface(chunk: SurfaceChunk) {
    const colliders: RAPIER.Collider[] = [];
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
      const c = this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(
          chunk.vertices,
          new Uint32Array(indices),
          RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
        ).setFriction(0.7),
        this.body,
      );
      this.materials.set(c.handle, surface);
      colliders.push(c);
    }
    return colliders;
  }
  private createObstacle(data: Obstacle) {
    let desc: RAPIER.ColliderDesc;
    if ("prop" in data) {
      const p = data.prop;
      desc = RAPIER.ColliderDesc.cuboid(5.5, 3, 6)
        .setTranslation(p.position.x, p.position.y + 3, p.position.z)
        .setRotation({
          x: 0,
          y: Math.sin(p.heading / 2),
          z: 0,
          w: Math.cos(p.heading / 2),
        });
    } else
      desc = RAPIER.ColliderDesc.trimesh(
        data.vertices,
        data.indices,
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
      );
    const c = this.world.createCollider(
      desc.setFriction(0.45).setRestitution(0.025),
      this.body,
    );
    this.obstacles.add(c.handle);
    return [c];
  }
  /** Load well ahead of the car and retire behind it. Teleport/reset forces a
   * synchronous residency update before Rapier refreshes its scene queries. */
  update(position: Vec3, force = false) {
    if (!this.surfaceIndex || !this.obstacleIndex) return;
    if (
      !force &&
      Math.hypot(
        position.x - this.lastPosition.x,
        position.z - this.lastPosition.z,
      ) < 12
    )
      return;
    this.lastPosition = { ...position };
    const policy = this.circuit.definition.familyDesign!.streaming;
    const sync = (
      index: ChunkIndex,
      active: Map<number, RAPIER.Collider[]>,
      limit: number,
      make: (i: number) => RAPIER.Collider[],
    ) => {
      const needed = new Set(index.query(position, policy.radius, limit));
      // Retain only within the wider hysteresis band, while respecting the cap.
      for (const i of [...active.keys()].sort(
        (a, b) =>
          boundsDistance(index.bounds[a], position) -
          boundsDistance(index.bounds[b], position),
      ))
        if (
          needed.size < limit &&
          boundsDistance(index.bounds[i], position) < policy.retireRadius
        )
          needed.add(i);
      for (const [id, colliders] of active)
        if (!needed.has(id)) {
          for (const c of colliders) {
            this.materials.delete(c.handle);
            this.obstacles.delete(c.handle);
            this.world.removeCollider(c, true);
            this.stats.retired++;
          }
          active.delete(id);
        }
      for (const i of needed)
        if (!active.has(i)) {
          const cs = make(i);
          active.set(i, cs);
          this.stats.created += cs.length;
        }
    };
    sync(this.surfaceIndex, this.activeSurface, policy.maxSurfaceChunks, (i) =>
      this.createSurface(this.circuit.chunks[i]),
    );
    sync(
      this.obstacleIndex,
      this.activeObstacles,
      policy.maxBarrierChunks,
      (i) => this.createObstacle(this.obstacleData[i]),
    );
    Object.assign(this.stats, {
      surfaceChunks: this.activeSurface.size,
      obstacleChunks: this.activeObstacles.size,
      materialColliders: this.materials.size,
      obstacleColliders: this.obstacles.size,
      peakSurfaceChunks: Math.max(
        this.stats.peakSurfaceChunks,
        this.activeSurface.size,
      ),
      peakObstacleChunks: Math.max(
        this.stats.peakObstacleChunks,
        this.activeObstacles.size,
      ),
    });
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
    this.activeSurface.clear();
    this.activeObstacles.clear();
    this.obstacleData = [];
  }
}
