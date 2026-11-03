import { describe, expect, test } from "bun:test";
import { solveFabrikChain, planTwoBonePoleSwing, planWorldSwingToParentLocal, inspectObservedAdditiveEulerPose } from "@/lib/rig/fabrik";

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
    const sourceBefore = JSON.stringify({ original, candidate });
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

      // Verify that this quaternion actually rotates the observed
      // world-space bone direction onto the pole-corrected direction.
      const direction = original[i+1].map((v,j) => v-original[i][j]);
      const intended = plan.corrected_points[i+1].map(
        (v,j) => v-plan.corrected_points[i][j]
      );
      const [qx,qy,qz,qw] = hint.world_delta_quaternion_xyzw;
      const cross = (a: readonly number[],b: readonly number[]) => [
        a[1]*b[2]-a[2]*b[1],
        a[2]*b[0]-a[0]*b[2],
        a[0]*b[1]-a[1]*b[0],
      ];
      const t = cross([qx,qy,qz],direction).map((v)=>2*v);
      const corrective = cross([qx,qy,qz],t);
      const rotated = direction.map((v,j)=>v+qw*t[j]+corrective[j]);
      expect(Math.hypot(...rotated.map((v,j)=>v-intended[j])))
        .toBeLessThan(1e-6);
    }
    expect(JSON.stringify({ original, candidate })).toBe(sourceBefore);
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


describe("parent-local quaternion projection from observed world swings", () => {
  const identity=[0,0,0,1] as const;
  const z90=[0,0,Math.SQRT1_2,Math.SQRT1_2] as const;
  const x90=[Math.SQRT1_2,0,0,Math.SQRT1_2] as const;
  const apply = (q:readonly number[], v:readonly number[]) => {
    const [x,y,z,w]=q;
    const cross=(a:readonly number[],b:readonly number[]) => [
      a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]
    ];
    const t=cross([x,y,z],v).map(n=>2*n);
    const v2=cross([x,y,z],t);
    return v.map((n,i)=>n+w*t[i]+v2[i]);
  };

  test("world swing is reprojected with explicit observed/updated parent orientation", () => {
    const p=planWorldSwingToParentLocal({
      source_world_quaternion_xyzw:z90,
      source_parent_world_quaternion_xyzw:z90,
      corrected_parent_world_quaternion_xyzw:z90,
      world_delta_quaternion_xyzw:x90,
    });
    expect(p.state).toBe("SOURCE_ONLY_PARENT_LOCAL_QUATERNION_HINT");
    if (p.state!=="SOURCE_ONLY_PARENT_LOCAL_QUATERNION_HINT")
      throw new Error(p.reason);
    expect(Math.hypot(...p.local_delta_quaternion_xyzw)).toBeCloseTo(1,10);
    const rotated=apply(p.local_delta_quaternion_xyzw,[1,0,0]);
    expect(rotated[0]).toBeCloseTo(0,10);
    expect(rotated[1]).toBeCloseTo(0,10);
    expect(rotated[2]).toBeCloseTo(1,10);
    expect(p.parent_change_accounted_for).toBe(true);
    expect(p.native_euler_authorized).toBe(false);
    expect(p.native_keyframe_authorized).toBe(false);
  });

  test("updated parent must be used when a corrected thigh rotates under the knee", () => {
    const unchanged=planWorldSwingToParentLocal({
      source_world_quaternion_xyzw:identity,
      source_parent_world_quaternion_xyzw:identity,
      corrected_parent_world_quaternion_xyzw:identity,
      world_delta_quaternion_xyzw:identity,
    });
    const rotatedParent=planWorldSwingToParentLocal({
      source_world_quaternion_xyzw:identity,
      source_parent_world_quaternion_xyzw:identity,
      corrected_parent_world_quaternion_xyzw:z90,
      world_delta_quaternion_xyzw:identity,
    });
    expect(unchanged.state).toBe("SOURCE_ONLY_PARENT_LOCAL_QUATERNION_HINT");
    expect(rotatedParent.state).toBe("SOURCE_ONLY_PARENT_LOCAL_QUATERNION_HINT");
    if (unchanged.state!=="SOURCE_ONLY_PARENT_LOCAL_QUATERNION_HINT"||
        rotatedParent.state!=="SOURCE_ONLY_PARENT_LOCAL_QUATERNION_HINT")
      throw new Error("parent projection unavailable");
    expect(unchanged.local_delta_quaternion_xyzw).toEqual([0,0,0,1]);
    expect(rotatedParent.local_delta_quaternion_xyzw).not.toEqual([0,0,0,1]);
    expect(rotatedParent.corrected_world_quaternion_xyzw).toEqual([0,0,0,1]);
  });

  test("malformed, nonunit and unobserved parent quaternions are rejected", () => {
    const source={
      source_world_quaternion_xyzw:identity,
      source_parent_world_quaternion_xyzw:identity,
      corrected_parent_world_quaternion_xyzw:identity,
      world_delta_quaternion_xyzw:identity,
    };
    for (const replacement of [[0,0,0,0],[0,0,0,2],[NaN,0,0,1]]) {
      expect(planWorldSwingToParentLocal({
        ...source,corrected_parent_world_quaternion_xyzw:
          replacement as [number,number,number,number],
      })).toMatchObject({
        state:"unavailable",reason:"IK_LOCAL_QUATERNION_UNVERIFIED",
        native_keyframe_authorized:false,
      });
    }
  });
});


describe("native additive Euler preview context, source only", () => {
  const source = () => ({
    mesh_rotation_radians:[0.1,0.3,-0.2] as [number,number,number],
    pre_animation_rotation_radians:[0.1,0.1,-0.2] as [number,number,number],
    fix_rotation_radians:[0.1,0.1,-0.2] as [number,number,number],
    format_euler_order:"XYZ",mesh_euler_order:"XYZ",
    pre_animation_euler_order:"XYZ",fix_euler_order:"XYZ",
    rotation_global:false,animation_override:false,
    quaternion_interpolation:false,single_clip_blend_literal_one:true,
  });

  test("source mesh rotation delta in degrees is not a native Euler keyframe", () => {
    const input=source(),before=JSON.stringify(input);
    const result=inspectObservedAdditiveEulerPose(input);
    expect(result.state).toBe("SOURCE_ONLY_OBSERVED_ADDITIVE_EULER_DELTA");
    if (result.state!=="SOURCE_ONLY_OBSERVED_ADDITIVE_EULER_DELTA")
      throw new Error(result.reason);
    expect(result.euler_order).toBe("XYZ");
    expect(result.mesh_delta_euler_degrees[0]).toBeCloseTo(0,10);
    expect(result.mesh_delta_euler_degrees[1]).toBeCloseTo(0.2*180/Math.PI,10);
    expect(result.mesh_delta_euler_degrees[2]).toBeCloseTo(0,10);
    expect(result.native_euler_authorized).toBe(false);
    expect(result.native_keyframe_authorized).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  });

  test("global rotation, override, nonunit blending and quaternion interpolation fail closed", () => {
    const cases=[
      [{rotation_global:true},"IK_EULER_ROTATION_GLOBAL_UNSUPPORTED"],
      [{animation_override:true},"IK_EULER_ANIMATION_OVERRIDE_UNSUPPORTED"],
      [{single_clip_blend_literal_one:false},"IK_EULER_BLEND_OR_EXPRESSION_UNVERIFIED"],
      [{quaternion_interpolation:true},"IK_EULER_QUATERNION_INTERPOLATION_UNSUPPORTED"],
    ] as const;
    for (const [change,reason] of cases) {
      expect(inspectObservedAdditiveEulerPose({...source(),...change}))
        .toMatchObject({state:"unavailable",reason,
          native_keyframe_authorized:false});
    }
  });

  test("Euler order mismatch, modified pre-stack rest pose and gimbal lock are refused", () => {
    expect(inspectObservedAdditiveEulerPose({
      ...source(),mesh_euler_order:"ZYX",
    })).toMatchObject({state:"unavailable",reason:"IK_EULER_ORDER_UNVERIFIED"});
    expect(inspectObservedAdditiveEulerPose({
      ...source(),pre_animation_rotation_radians:[0.2,0.1,-0.2],
    })).toMatchObject({state:"unavailable",reason:"IK_EULER_PRE_ROTATION_NOT_BASELINE"});
    expect(inspectObservedAdditiveEulerPose({
      ...source(),mesh_rotation_radians:[0.1,Math.PI/2,-0.2],
    })).toMatchObject({state:"unavailable",reason:"IK_EULER_GIMBAL_SINGULARITY"});
    expect(inspectObservedAdditiveEulerPose({
      ...source(),mesh_rotation_radians:[0.1,Math.PI+0.3,-0.2],
    })).toMatchObject({state:"unavailable",reason:"IK_EULER_DELTA_WRAP_OR_EXTREME"});
  });
});
