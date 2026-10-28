import { describe, test, expect } from "bun:test";
import {
  analyzeNativeIkBakeReadiness,
  IK_BAKE_MAX_WORK_UNITS,
  type NativeIkBakeReadinessInput,
} from "@/lib/animation/ikBakeReadiness";

const group = (
  uuid: string, parent_uuid: string | null,
  rotation: readonly number[] = [0, 0, 0],
  native_fix_rotation_available = true
) => ({
  uuid, parent_uuid, rotation,
  transform_available: true, native_fix_rotation_available,
});

const baseline = (): NativeIkBakeReadinessInput => ({
  blockbench_version: "5.2.2",
  format_id: "bedrock",
  animate_mode: true,
  selected_clip_uuid: "walk",
  animation_uuid: "walk",
  duration_seconds: 1,
  snapping_fps: 20,
  anim_time_update: "",
  blend_weight: "",
  unsupported_armature_count: 0,
  groups: [
    group("body", null),
    group("upper", "body", [0, 15, 0]),
    group("lower", "upper"),
    group("foot", "lower"),
  ],
  locator_uuids: ["knee_pole"],
  controllers: [{
    uuid: "ik_foot", target_uuid: "foot",
    source_uuid: "body", parent_group_uuid: "body",
    pole_uuid: "knee_pole", lock_target_rotation: false,
    position_keyframes: 4,
    total_keyframes: 6,
    keyframe_uuids: ["k0","k1","k2","k3","k4","k5"],
    keyframe_undo_copies: Array.from({length:6},(_,i)=>({
      uuid:"k"+i,time:i/10,channel:"position",
      data_points:[{x:i,y:0,z:0}],
    })),
  }],
});

describe("Blockbench native IK bake source eligibility", () => {
  test("derives a bounded real IK chain and pre-rotation risk without executing native baking", () => {
    const input=baseline();
    const before=JSON.stringify(input);
    const r=analyzeNativeIkBakeReadiness(input);
    expect(r).toMatchObject({
      state: "candidate_source_only",
      source_baseline: "BLOCKBENCH_5_2_2",
      native_ik_baked: false,
      native_undo_verified: false,
      native_preview_restored: false,
      visual_verdict: "not_evaluated",
      active_controller_count: 1,
      evaluated_chain_count: 1,
      estimated_native_frame_count: 21,
      estimated_native_work_units: 63,
      expected_controller_keyframes_removed: 6,
      affected_group_count: 3,
      pre_rotated_group_count: 1,
      blocking_reasons: [],
    });
    expect(r.examples[0]?.affected_group_uuids)
      .toEqual(["lower", "upper", "body"]);
    expect(r.expected_sampled_group_uuids).toEqual(["body","lower","upper"]);
    expect(JSON.stringify(input)).toBe(before);
  });


  test("native IK emits source/hinge rotations, not an implicit end-effector rotation", () => {
    const unlocked=analyzeNativeIkBakeReadiness(baseline());
    expect(unlocked.expected_sampled_group_uuids).toEqual(["body","lower","upper"]);
    const input=baseline();
    const locked=analyzeNativeIkBakeReadiness({
      ...input,
      controllers: [{...input.controllers[0]!,lock_target_rotation:true}],
    });
    expect(locked.state).toBe("candidate_source_only");
    expect(locked.expected_sampled_group_uuids).toEqual(["body","foot","lower","upper"]);
    expect(locked.affected_group_count).toBe(4);
    expect(locked.estimated_native_work_units).toBe(84);
    // A direct, incomplete snapshot must not silently assume the target lock is off.
    const missingLock = {...input.controllers[0]!} as Record<string,unknown>;
    delete missingLock.lock_target_rotation;
    const incomplete=analyzeNativeIkBakeReadiness({
      ...input,
      controllers:[missingLock as unknown as typeof input.controllers[number]],
    });
    expect(incomplete.blocking_reasons).toContain("IK_BAKE_TARGET_ROTATION_LOCK_UNVERIFIED");
  });

  test("unpatched, prerelease and unknown post-review editor versions cannot claim eligibility", () => {
    for (const version of ["5.2.1", "5.2.2-beta.1", "5.3.0", "unknown"]) {
      const r=analyzeNativeIkBakeReadiness({
        ...baseline(), blockbench_version:version,
      });
      expect(r.state).toBe("blocked");
      expect(r.blocking_reasons).toContain("IK_BAKE_NATIVE_VERSION_REVIEW_REQUIRED");
    }
  });

  test("too-short native sample spans are not valid IK coverage", () => {
    const result=analyzeNativeIkBakeReadiness({
      ...baseline(),duration_seconds:0.1,snapping_fps:1,
    });
    expect(result.state).toBe("blocked");
    expect(result.blocking_reasons).toContain("IK_BAKE_NATIVE_SAMPLE_SPAN_TOO_SHORT");
  });

  test("native 144 FPS clamp, maximum duration and total work budget fail closed", () => {
    const overrate=analyzeNativeIkBakeReadiness({...baseline(),snapping_fps:200});
    expect(overrate.blocking_reasons).toContain("IK_BAKE_NATIVE_SAMPLING_FPS_MISMATCH");
    const long=analyzeNativeIkBakeReadiness({...baseline(),duration_seconds:201});
    expect(long.blocking_reasons).toContain("IK_BAKE_DURATION_OUT_OF_NATIVE_RANGE");
    const budget=analyzeNativeIkBakeReadiness({
      ...baseline(),duration_seconds:200,snapping_fps:144,
    });
    expect(budget.estimated_native_work_units).toBeGreaterThan(IK_BAKE_MAX_WORK_UNITS);
    expect(budget.blocking_reasons).toContain("IK_BAKE_NATIVE_SAMPLING_BUDGET_EXCEEDED");
  });

  test("unknown ArmatureBone runtime inventory never silently becomes zero", () => {
    const input=baseline();
    const missing=analyzeNativeIkBakeReadiness({
      ...input,unsupported_armature_count:undefined as unknown as number,
    });
    const nonzero=analyzeNativeIkBakeReadiness({
      ...input,unsupported_armature_count:2,
    });
    expect(missing.blocking_reasons).toContain("IK_BAKE_NATIVE_INVENTORY_INCOMPLETE");
    expect(nonzero.blocking_reasons).toContain("IK_BAKE_NATIVE_INVENTORY_INCOMPLETE");
  });

  test("same-count replacements of IK controller keys change the source revision", () => {
    const input=baseline();
    const before=analyzeNativeIkBakeReadiness(input);
    const modified=analyzeNativeIkBakeReadiness({
      ...input,controllers:[{
        ...input.controllers[0]!,
        keyframe_uuids:["other",...input.controllers[0]!.keyframe_uuids.slice(1)],
        keyframe_undo_copies:[
          {...(input.controllers[0]!.keyframe_undo_copies[0] as object),uuid:"other"},
          ...input.controllers[0]!.keyframe_undo_copies.slice(1),
        ],
      }],
    });
    expect(before.state).toBe("candidate_source_only");
    expect(modified.state).toBe("candidate_source_only");
    expect(modified.source_state_revision).not.toBe(before.source_state_revision);
    const collision=analyzeNativeIkBakeReadiness({
      ...input,controllers:[{
        ...input.controllers[0]!,
        keyframe_uuids:["k0","k0","k2","k3","k4","k5"],
      }],
    });
    expect(collision.blocking_reasons)
      .toContain("IK_BAKE_CONTROLLER_KEYFRAME_IDENTITY_INVALID");
  });

  test("missing controller key UUID inventory fails closed without a parser crash",()=>{
    const input=baseline();
    const malformed=analyzeNativeIkBakeReadiness({
      ...input,controllers:[{
        ...input.controllers[0]!,
        keyframe_uuids:undefined as unknown as string[],
      }],
    });
    expect(malformed.state).toBe("blocked");
    expect(malformed.blocking_reasons).toContain(
      "IK_BAKE_CONTROLLER_KEYFRAME_IDENTITY_INVALID"
    );
    expect(malformed.blocking_reasons).toContain(
      "IK_BAKE_CONTROLLER_KEYFRAME_SOURCE_UNVERIFIED"
    );
  });

  test("same-UUID native interpolation/value changes invalidate previous IK samples",()=>{
    const input=baseline();
    const before=analyzeNativeIkBakeReadiness(input);
    const edited=analyzeNativeIkBakeReadiness({
      ...input,controllers:[{
        ...input.controllers[0]!,
        keyframe_undo_copies: input.controllers[0]!.keyframe_undo_copies.map(
          (copy,i)=>i===0
            ? {...(copy as object),data_points:[{x:99,y:0,z:0}]}
            : copy
        ),
      }],
    });
    expect(before.state).toBe("candidate_source_only");
    expect(edited.state).toBe("candidate_source_only");
    expect(edited.source_state_revision).not.toBe(before.source_state_revision);
    const missing=analyzeNativeIkBakeReadiness({
      ...input,controllers:[{
        ...input.controllers[0]!,keyframe_undo_copies:[null],
      }],
    });
    expect(missing.blocking_reasons).toContain(
      "IK_BAKE_CONTROLLER_KEYFRAME_SOURCE_UNVERIFIED"
    );
  });

  test("unkeyed controllers with other authored keys cannot be silently deleted by native bake", () => {
    const candidate = baseline();
    const source = candidate.controllers[0]!;
    const result = analyzeNativeIkBakeReadiness({
      ...candidate,
      controllers: [
        source,
        {
          ...source,
          uuid: "inactive_ik_controller",
          target_uuid: "lower",
          position_keyframes: 0,
          total_keyframes: 2,
          keyframe_uuids: ["new-0","new-1"],
          keyframe_undo_copies:[
            {uuid:"new-0",channel:"position",time:0},
            {uuid:"new-1",channel:"position",time:0.5},
          ],
        },
      ],
    });
    expect(result.state).toBe("blocked");
    expect(result.blocking_reasons).toContain(
      "IK_BAKE_UNSAMPLED_CONTROLLER_KEYS_AT_RISK"
    );
    expect(result.active_controller_count).toBe(1);
    expect(result.native_ik_baked).toBe(false);
  });

  test("unkeyed controller and modified Molang cannot prove native IK coverage", () => {
    const empty=baseline().controllers[0]!;
    const unkeyed=analyzeNativeIkBakeReadiness({
      ...baseline(), controllers:[{...empty,position_keyframes:0}],
    });
    expect(unkeyed.blocking_reasons).toContain("IK_BAKE_NO_KEYED_NATIVE_CONTROLLER");
    const molang=analyzeNativeIkBakeReadiness({
      ...baseline(),anim_time_update:"q.anim_time*2",
    });
    expect(molang.blocking_reasons)
      .toContain("IK_BAKE_MOLANG_SAMPLING_SEMANTICS_UNVERIFIED");
    const selection=analyzeNativeIkBakeReadiness({
      ...baseline(),selected_clip_uuid:"other",
    });
    expect(selection.blocking_reasons).toContain("IK_BAKE_SELECTED_ANIMATION_REQUIRED");
  });

  test("missing target, unsupported pole and missing native pre-rotation data are explicit blockers", () => {
    const controller=baseline().controllers[0]!;
    const missing=analyzeNativeIkBakeReadiness({
      ...baseline(),controllers:[{...controller,target_uuid:"missing"}],
    });
    expect(missing.blocking_reasons)
      .toContain("IK_BAKE_CHAIN_TARGET_OR_SOURCE_UNRESOLVED");
    const pole=analyzeNativeIkBakeReadiness({
      ...baseline(),controllers:[{...controller,pole_uuid:"unknown"}],
    });
    expect(pole.blocking_reasons).toContain("IK_BAKE_POLE_UNRESOLVED_OR_DEGENERATE");
    const transforms=analyzeNativeIkBakeReadiness({
      ...baseline(),groups:baseline().groups.map((g) =>
        g.uuid==="upper" ? {...g,native_fix_rotation_available:false} : g
      ),
    });
    expect(transforms.blocking_reasons)
      .toContain("IK_BAKE_PRE_ROTATION_OR_TRANSFORM_UNVERIFIED");
  });

  test("duplicate ids, invalid ancestry and overlapping IK chains cannot silently merge baked keys", () => {
    const same=baseline();
    const dup=analyzeNativeIkBakeReadiness({
      ...same,groups:[...same.groups,same.groups[0]!],
    });
    expect(dup.blocking_reasons).toContain("IK_BAKE_NATIVE_IDENTITY_AMBIGUOUS");
    const controller=same.controllers[0]!;
    const unrelated=analyzeNativeIkBakeReadiness({
      ...same,controllers:[{...controller,source_uuid:"unrelated"}],
    });
    expect(unrelated.blocking_reasons)
      .toContain("IK_BAKE_CHAIN_TARGET_OR_SOURCE_UNRESOLVED");
    const overlap=analyzeNativeIkBakeReadiness({
      ...same,controllers:[controller,{...controller,uuid:"ik_other"}],
    });
    expect(overlap.blocking_reasons).toContain("IK_BAKE_OVERLAPPING_CHAINS_UNVERIFIED");
  });

  test("implicit parent source that produces no rotation reference remains blocked", () => {
    const r=analyzeNativeIkBakeReadiness({
      ...baseline(),
      groups:[group("body",null),group("foot","body")],
      controllers:[{
        uuid:"ik_foot",target_uuid:"foot",source_uuid:null,
        parent_group_uuid:"body",pole_uuid:null,lock_target_rotation:false,
        position_keyframes:2,total_keyframes:2,
        keyframe_uuids:["ik-0","ik-1"],
        keyframe_undo_copies:[
          {uuid:"ik-0",channel:"position",time:0},
          {uuid:"ik-1",channel:"position",time:0.5},
        ],
      }],
    });
    expect(r.blocking_reasons).toContain("IK_BAKE_CHAIN_HAS_NO_ROTATION_REFERENCE");
  });
});
