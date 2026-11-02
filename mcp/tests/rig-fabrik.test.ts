import { describe, expect, test } from "bun:test";
import { solveFabrikChain, planTwoBonePoleSwing } from "@/lib/rig/fabrik";

describe("FABRIK solver", () => {
  test("reaches a reachable target while preserving segment lengths", () => {
    const result = solveFabrikChain([[0,0,0],[1,0,0],[2,0,0]], [1,1,0]);
    expect(result.reached).toBe(true);
    const d0 = Math.hypot(...result.points[1].map((v,i) => v - result.points[0][i]) as [number,number,number]);
    const d1 = Math.hypot(...result.points[2].map((v,i) => v - result.points[1][i]) as [number,number,number]);
    expect(Math.abs(d0 - 1)).toBeLessThan(1e-6);
    expect(Math.abs(d1 - 1)).toBeLessThan(1e-6);
  });
});


describe("source-only FABRIK pole-guided joint swing hints", () => {
  const observed = () => [
    [0, 0.8, 0], [0, 0.4, 0.3], [0, 0, 0],
  ] as const;

  test("explicit pole preserves knee side, bone lengths, and normalized world quaternions", () => {
    const original = observed();
    const target = [0.2, 0, 0] as const;
    const candidate = solveFabrikChain(original, target);
    expect(candidate.reached).toBe(true);
    const plan = planTwoBonePoleSwing(
      original, candidate.points, [0, 0, 1]
    );
    expect(plan.state).toBe("SOURCE_ONLY_POLE_SWING_HINT");
    if (plan.state !== "SOURCE_ONLY_POLE_SWING_HINT") throw new Error(plan.reason);
    expect(plan.corrected_points[1][2]).toBeGreaterThan(0);
    expect(plan.corrected_points[2][0]).toBeCloseTo(0.2, 6);
    expect(plan.source_bend_pole_alignment).toBeGreaterThan(0.9);
    for (const i of [0, 1]) {
      const dist = (a: readonly number[], b: readonly number[]) =>
        Math.hypot(...a.map((v,j) => v - b[j]));
      expect(dist(plan.corrected_points[i], plan.corrected_points[i+1]))
        .toBeCloseTo(dist(original[i], original[i+1]), 6);
      const hint = plan.segment_swings[i];
      expect(hint.segment_index).toBe(i);
      expect(Math.hypot(...hint.world_delta_quaternion_xyzw)).toBeCloseTo(1, 9);
      expect(hint.angle_degrees).toBeLessThan(120);
      expect(hint.world_delta_quaternion_xyzw[3]).toBeGreaterThanOrEqual(0);
    }
    expect(plan.native_rotation_authorized).toBe(false);
    expect(plan.local_euler_attested).toBe(false);
    expect(plan.visual_verdict).toBe("not_evaluated");
  });

  test("pole definition rejects backwards knee and a pole parallel to the hip-to-ankle axis", () => {
    const straight = observed();
    const uncorrected = solveFabrikChain(straight, [0.2, 0, 0]);
    expect(planTwoBonePoleSwing(straight, uncorrected.points, [0, 0, -1]))
      .toMatchObject({ state: "unavailable",
        reason: "FABRIK_POLE_SOURCE_BEND_OPPOSITE_OR_AMBIGUOUS" });
    expect(planTwoBonePoleSwing(straight, uncorrected.points, [0, 0.8, 0]))
      .toMatchObject({ state: "unavailable",
        reason: "FABRIK_POLE_BEND_PLANE_AMBIGUOUS" });
  });

  test("degenerate straight-legged and unreachable pole solutions do not claim rotation", () => {
    const straight = [
      [0, 2, 0], [0, 1, 0], [0, 0, 0],
    ] as const;
    expect(planTwoBonePoleSwing(straight, straight, [0, 1, 1]))
      .toMatchObject({ state: "unavailable",
        reason: "FABRIK_POLE_TARGET_SINGULAR_OR_UNREACHABLE" });
    const normal = observed();
    const unreachable = solveFabrikChain(normal, [5, 0, 0]);
    expect(unreachable.reached).toBe(false);
    expect(planTwoBonePoleSwing(normal, unreachable.points, [0, 0, 1]))
      .toMatchObject({ state: "unavailable" });
  });

  test("tiny swing limits reject a large correction without inventing a native keyframe", () => {
    const input = observed();
    const candidate = solveFabrikChain(input, [0.2, 0, 0]);
    expect(planTwoBonePoleSwing(input, candidate.points, [0, 0, 1], {
      max_swing_degrees: 1,
    })).toMatchObject({
      state: "unavailable", reason: "FABRIK_SWING_LIMIT_EXCEEDED",
      native_rotation_authorized: false,
    });
    expect(planTwoBonePoleSwing(input, candidate.points, [0, 0, 1], {
      max_swing_degrees: 180,
    })).toMatchObject({
      state: "unavailable", reason: "FABRIK_POLE_INPUT_INVALID",
    });
  });
});
