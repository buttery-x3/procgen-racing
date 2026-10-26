import { describe, expect, it } from "vitest";
import { Alignment } from "../src/track/Alignment";
import {
  BRIEFS,
  generateDesignStudy,
  inspectRoute,
} from "../src/track/design/DesignStudy";
import {
  biarc,
  corner,
  distance,
  straight,
  wrapAngle,
} from "../src/track/design/primitives";

describe("experimental circuit design proposals", () => {
  it("closes signed chains in position and tangent, with both turn directions", () => {
    const start = { x: 0, z: 0, heading: 0 };
    const a = straight(start, 230),
      b = corner(a.end, 65, 1.3),
      c = corner(b.end, 80, -0.7);
    const closure = biarc(c.end, start)!;
    expect(closure).toHaveLength(2);
    expect(distance(c.end, closure[0].start)).toBeLessThan(1e-6);
    expect(distance(closure[0].end, closure[1].start)).toBeLessThan(1e-6);
    expect(distance(closure[1].end, start)).toBeLessThan(1e-6);
    expect(
      Math.abs(wrapAngle(closure[0].end.heading - closure[1].start.heading)),
    ).toBeLessThan(1e-6);
    expect(
      Math.abs(wrapAngle(closure[1].end.heading - start.heading)),
    ).toBeLessThan(1e-6);
  });
  it("rejects a crossing regardless of the local clearance exclusion", () => {
    expect(
      inspectRoute(
        [
          { x: 0, z: 0 },
          { x: 100, z: 100 },
          { x: 0, z: 100 },
          { x: 100, z: 0 },
        ],
        484,
        12,
      ).valid,
    ).toBe(false);
  });
  it("rejects opposing legs that leave insufficient corridor clearance", () => {
    expect(
      inspectRoute(
        [
          { x: 0, z: 0 },
          { x: 500, z: 0 },
          { x: 500, z: 20 },
          { x: 0, z: 20 },
        ],
        1040,
        12,
      ).valid,
    ).toBe(false);
  });
  it("keeps seeds reproducible across unrelated generation and reports no fallback", () => {
    const a = generateDesignStudy("ridge-104", "club");
    generateDesignStudy("elsewhere", "club");
    const b = generateDesignStudy("ridge-104", "club");
    expect(b).toEqual(a);
    expect(a.version).toBe("m4-study-1");
    expect(a.limitations.some((s) => s.includes("no compiled road"))).toBe(
      true,
    );
  });
  it.each(["club", "grand-prix", "terrain"] as const)(
    "screens final smoothed %s routes and exposes unresolved elevation",
    (brief) => {
      const r = generateDesignStudy("ridge-104", brief),
        config = BRIEFS[brief];
      expect(r.metrics.minRadius).toBeGreaterThanOrEqual(config.radius);
      expect(r.metrics.edgeClearance).toBeGreaterThanOrEqual(24);
      expect(r.metrics.longStraights).toBeGreaterThanOrEqual(2);
      expect(r.metrics.closureShare).toBeLessThanOrEqual(0.24);
      expect(r.metrics.terrainCostAfter).toBeLessThanOrEqual(
        r.metrics.terrainCostBefore,
      );
      expect(
        r.points.every((p) => Object.values(p).every(Number.isFinite)),
      ).toBe(true);
      expect(r.points.every((p) => p.speed > 0 && p.speed <= 75)).toBe(true);
      // The study must expose, not silently erase, this known vertical-envelope failure.
      expect(r.metrics.maxGrade).toBeGreaterThan(0.06);
      const alignment = new Alignment(r.definition);
      const first = alignment.sample(0),
        last = alignment.sample(alignment.length - 0.0001);
      expect(distance(first.position, last.position)).toBeLessThan(0.001);
      expect(distance(first.forward, last.forward)).toBeLessThan(0.001);
      expect(Math.abs(first.curvature - last.curvature)).toBeLessThan(0.00001);
    },
  );
  it("escapes the radial perimeter family with a reproducible deeply folded GP layout", () => {
    const r = generateDesignStudy("ridge-104", "grand-prix");
    expect(r.metrics.hullOccupancy).toBeLessThan(0.75);
    expect(r.metrics.directionChanges).toBeGreaterThan(4);
  });
  it("fails explicitly when a search budget cannot produce a route", () => {
    expect(() => generateDesignStudy("ridge-104", "club", 1)).toThrow(
      /No feasible proposal/,
    );
    expect(() => generateDesignStudy("", "club")).toThrow(/Invalid/);
  });
});
