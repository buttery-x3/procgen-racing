import { describe, expect, it } from "vitest";
import { DEFAULT_SETUP, sanitizeSetup } from "../src/vehicle/setup";
import { seededRandom } from "../src/core/math";
import { decodeSetupRecord } from "../src/storage/SetupStorage";

describe("imported setup validation", () => {
  it("migrates M1 saved setups and preserves M2 drivetrain and assist settings", () => {
    const old = decodeSetupRecord(
      JSON.stringify({
        version: 1,
        setup: { mass: 1370, drive: "fwd", frontSpring: 43000 },
      }),
    );
    expect(old?.mass).toBe(1370);
    expect(old?.drive).toBe("fwd");
    expect(old?.peakTorque).toBe(DEFAULT_SETUP.peakTorque);
    const current = {
      ...DEFAULT_SETUP,
      rearDiff: "locked",
      tractionControl: 0,
      gearing: "close",
    };
    expect(
      decodeSetupRecord(JSON.stringify({ version: 2, setup: current })),
    ).toEqual(current);
    expect(decodeSetupRecord('{"version":99,"setup":{}}')).toBeNull();
    expect(decodeSetupRecord("{invalid")).toBeNull();
  });
  it("rejects non-finite and wrong-typed values while keeping valid tuning", () => {
    const result = sanitizeSetup({
      mass: NaN,
      wheelbase: "300",
      frontSpring: 50000,
      drive: "hovercraft",
    });
    expect(result.mass).toBe(DEFAULT_SETUP.mass);
    expect(result.wheelbase).toBe(DEFAULT_SETUP.wheelbase);
    expect(result.frontSpring).toBe(50000);
    expect(result.drive).toBe("rwd");
  });
  it("bounds unsafe values and accepts empty or corrupt data", () => {
    expect(
      sanitizeSetup({ mass: -100, frontDamping: Infinity, frontWeight: 20 })
        .mass,
    ).toBe(700);
    expect(sanitizeSetup({ frontWeight: 20 }).frontWeight).toBe(0.65);
    expect(sanitizeSetup(null)).toEqual(DEFAULT_SETUP);
    expect(sanitizeSetup("<bad data>")).toEqual(DEFAULT_SETUP);
  });
  it("keeps scenery reproducible with an independent seeded stream", () => {
    const a = seededRandom(719),
      b = seededRandom(719),
      c = seededRandom(720);
    const first = Array.from({ length: 10 }, a);
    expect(first).toEqual(Array.from({ length: 10 }, b));
    expect(first).not.toEqual(Array.from({ length: 10 }, c));
  });
});
