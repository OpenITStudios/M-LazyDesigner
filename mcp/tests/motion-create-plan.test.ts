import { describe, expect, test } from "bun:test";
import { compileMotionRecipe } from "@/lib/animation/motionRecipe";
import {
  compileMotionToCreateAnimation,
  compileMotionToCreateAnimationPlan,
  compileMotionWithLocalContactsToCreateAnimationPlan,
  compileSemanticMotionToCreateAnimationPlan,
} from "@/lib/animation/toolCompiler";

describe("motion create plan",()=>{
  test("does not silently drop interpolation unsupported by create_animation",()=>{
    const recipe=compileMotionRecipe({name:"clip",poses:[
      {id:"a",time:0,bones:{arm:{rotation:[0,0,0],interpolation:"step"}}},
      {id:"b",time:1,bones:{arm:{rotation:[10,0,0],interpolation:"linear"}}},
    ]});
    expect(()=>compileMotionToCreateAnimation(recipe)).toThrow("does not author interpolation");
    const plan=compileMotionToCreateAnimationPlan(recipe);
    expect(plan.post_create_keyframe_edits).toHaveLength(1);
    expect(plan.post_create_keyframe_edits[0].action).toBe("edit");
  });
});


describe("semantic motion and source-declared contact compilation", () => {
  const source = () => ({
    name: "hammer_action",
    duration: 1,
    poses: [
      { id: "ready", time: 0, bones: {
        body: { rotation: [0, 0, 0] as [number, number, number] },
        foot: { position: [0, 0, 0] as [number, number, number] },
      } },
      { id: "impact", time: 0.5, bones: {
        body: { rotation: [10, 0, 0] as [number, number, number] },
        foot: { position: [1, 0, 0] as [number, number, number] },
      } },
      { id: "recover", time: 1, bones: {
        body: { rotation: [0, 0, 0] as [number, number, number] },
        foot: { position: [2, 0, 0] as [number, number, number] },
      } },
    ],
  });

  test("compiles explicit pose identities and preserves local source anchors without snapped writes", () => {
    const plan = compileSemanticMotionToCreateAnimationPlan(source(), {
      archetype: "ACTION",
      activation: "PREVIEW_ONLY",
      primary_bones: ["body"],
      pose_roles: [
        { pose_id: "recover", role: "RECOVERY" },
        { pose_id: "ready", role: "ANTICIPATION" },
        { pose_id: "impact", role: "CONTACT" },
      ],
      local_contacts: [
        { bone: "foot", channel: "position", start: 0.2, end: 0.8, value: [0, 0, 0] },
      ],
    });
    expect(plan.semantic_motion_contract.pose_roles.map((record) => record.pose_id))
      .toEqual(["ready", "impact", "recover"]);
    expect(plan.create_animation.bones.foot.map((frame) => frame.time))
      .toEqual([0, 0.2, 0.5, 0.8, 1]);
    // The new clip carries exact authored source anchors. No automatic
    // post-create native writes may snap them to a different live grid.
    expect(plan.post_create_keyframe_edits).toHaveLength(0);
    expect(plan.local_contact_contract).toMatchObject({
      source_boundary_count: 2,
      post_create_anchor_writes_authorized: false,
      native_snap_grid_verified: false,
    });
    expect(plan.local_contact_contract).toMatchObject({
      state: "SOURCE_ONLY_LOCAL_HOLD",
      physical_contact_verified: false,
      native_pose_sampling_performed: false,
      world_space_foot_locking_authorized: false,
    });
    expect(plan.semantic_motion_contract).toMatchObject({
      activation: "PREVIEW_ONLY",
      motion_fidelity_verified: false,
      gameplay_activation_assumed: false,
    });
  });

  test("rejects unspecified primary bone, duplicate pose roles and invented pose IDs", () => {
    const intent = {
      archetype: "ACTION" as const,
      activation: "UNRESOLVED" as const,
      primary_bones: ["body"],
      pose_roles: [{ pose_id: "impact", role: "ACTION" as const }],
    };
    expect(() => compileSemanticMotionToCreateAnimationPlan(source(), {
      ...intent, primary_bones: ["unknown"],
    })).toThrow("distinct authored bone");
    expect(() => compileSemanticMotionToCreateAnimationPlan(source(), {
      ...intent, pose_roles: [{ pose_id: "unknown", role: "ACTION" }],
    })).toThrow("exact, unique authored");
    expect(() => compileSemanticMotionToCreateAnimationPlan(source(), {
      ...intent,
      pose_roles: [
        { pose_id: "impact", role: "ACTION" },
        { pose_id: "impact", role: "CONTACT" },
      ],
    })).toThrow("exact, unique authored");
  });

  test("declared local contact never claims world-space or physical contact proof", () => {
    const plan = compileMotionWithLocalContactsToCreateAnimationPlan(source(), [
      { bone: "foot", channel: "position", start: 0.2, end: 0.8, value: [0, 0, 0] },
    ]);
    expect(plan.local_contact_contract.physical_contact_verified).toBe(false);
    expect(plan.local_contact_contract.source_boundary_count).toBe(2);
    expect(plan.local_contact_contract.post_create_anchor_writes_authorized).toBe(false);
    expect(plan.post_create_keyframe_edits.every((row) =>
      row.action === "create" || row.action === "edit"
    )).toBe(true);
  });
});


describe("native compaction and interpolation preservation", () => {
  const rot = (id: string, time: number, degrees: number, interpolation?: "linear" | "catmullrom" | "bezier" | "step") => ({
    id, time, bones: { arm: {
      rotation: [degrees, 0, 0] as [number, number, number],
      ...(interpolation ? { interpolation } : {}),
    } },
  });

  test("rejects explicit edited key lost to native collinear compaction", () => {
    const recipe = compileMotionRecipe({
      name: "lost_step",
      poses: [
        rot("start", 0, 0),
        rot("middle", 0.5, 5, "step"),
        rot("end", 1, 10),
      ],
    });
    expect(() => compileMotionToCreateAnimationPlan(recipe))
      .toThrow("MOTION_INTERPOLATION_COMPACTION_CONFLICT");
  });

  test("rejects nonlinear endpoint interpolation if native removed intervening keys", () => {
    const recipe = compileMotionRecipe({
      name: "curve_shape",
      poses: [
        rot("start", 0, 0),
        rot("middle", 0.5, 5),
        rot("end", 1, 10, "catmullrom"),
      ],
    });
    expect(() => compileMotionToCreateAnimationPlan(recipe))
      .toThrow("MOTION_INTERPOLATION_COMPACTION_CONFLICT");
  });

  test("preserves a noncollinear authored curve with exact post-create target", () => {
    const recipe = compileMotionRecipe({
      name: "preserved_curve",
      poses: [
        rot("start", 0, 0),
        rot("middle", 0.5, 7, "catmullrom"),
        rot("end", 1, 10),
      ],
    });
    const plan = compileMotionToCreateAnimationPlan(recipe);
    expect(plan.create_animation.bones.arm).toHaveLength(3);
    expect(plan.post_create_keyframe_edits[0]).toMatchObject({
      action: "edit", channel: "rotation",
      keyframes: [{ time: 0.5, interpolation: "catmullrom" }],
    });
  });

  test("does not block linear-compacted unedited channels of the same bone", () => {
    const recipe = compileMotionRecipe({
      name: "channel_independence",
      poses: [
        { id: "a", time: 0, bones: { arm: {
          rotation: [0, 0, 0], position: [0, 0, 0],
        } } },
        { id: "b", time: 0.5, bones: { arm: {
          rotation: [7, 0, 0], position: [5, 0, 0],
          interpolation: "catmullrom",
        } } },
        { id: "c", time: 1, bones: { arm: {
          rotation: [10, 0, 0], position: [10, 0, 0],
        } } },
      ],
    });
    // The interpolation belongs to both authored channels at time 0.5.
    // Even though rotation is noncollinear, compacting position would
    // change its intended Catmull-Rom curve, so the plan must fail closed.
    expect(() => compileMotionToCreateAnimationPlan(recipe))
      .toThrow("MOTION_INTERPOLATION_COMPACTION_CONFLICT");
  });

  test("preserves legacy compaction-friendly numeric creation with no interpolation edits", () => {
    const recipe = compileMotionRecipe({
      name: "numeric_linear",
      poses: [
        rot("a", 0, 0), rot("b", 0.5, 5), rot("c", 1, 10),
      ],
    });
    const plan = compileMotionToCreateAnimationPlan(recipe);
    expect(plan.create_animation.bones.arm).toHaveLength(3);
    expect(plan.post_create_keyframe_edits).toHaveLength(0);
  });
});
