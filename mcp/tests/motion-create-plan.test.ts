import { describe, expect, test } from "bun:test";
import { compileMotionRecipe } from "@/lib/animation/motionRecipe";
import { compileSpringSecondaryMotion } from "@/lib/animation/springMotion";
import { createAnimationParameters } from "@/server/tools/animation";
import { GATEWAY_TOOLS } from "@/gateway/contracts/protocol";
import {
  compileMotionToCreateAnimation,
  compileMotionToCreateAnimationPlan,
  compileMotionWithSpringToCreateAnimationPlan,
  compileMotionWithLocalContactsToCreateAnimationPlan,
  compileSemanticMotionToCreateAnimationPlan,
  compileSemanticMotionToGatewayInvocation,
  compileSemanticMotionWithPchipToGatewayInvocation,
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


describe("semantic motion -> existing Gateway create_animation route", () => {
  const recipe = () => ({
    name: "animation.test.impact",
    duration: 1,
    poses: [
      { id: "windup", time: 0, bones: {
        body: { rotation: [0, 0, 0] as [number, number, number] },
        foot: { position: [0, 0, 0] as [number, number, number] },
      } },
      { id: "strike", time: 0.5, bones: {
        body: { rotation: [15, 0, 0] as [number, number, number] },
        foot: { position: [1, 0, 0] as [number, number, number] },
      } },
      { id: "reset", time: 1, bones: {
        body: { rotation: [0, 0, 0] as [number, number, number] },
        foot: { position: [2, 0, 0] as [number, number, number] },
      } },
    ],
  });
  const intent = () => ({
    archetype: "ACTION" as const,
    activation: "PREVIEW_ONLY" as const,
    primary_bones: ["body"],
    pose_roles: [
      { pose_id: "strike", role: "CONTACT" as const },
      { pose_id: "windup", role: "ANTICIPATION" as const },
      { pose_id: "reset", role: "RECOVERY" as const },
    ],
    local_contacts: [{
      bone: "foot", channel: "position" as const,
      start: 0.2, end: 0.8,
      value: [0, 0, 0] as [number, number, number],
    }],
  });

  test("produces a native schema-valid invoke_capability envelope without extra tool parameters", () => {
    const input = recipe(), declared = intent();
    const before = JSON.stringify({ input, declared });
    const bridge = compileSemanticMotionToGatewayInvocation(input, declared);
    expect(bridge.gateway_tool).toBe(GATEWAY_TOOLS.invokeCapability);
    expect(bridge).toMatchObject({
      gateway_tool: "invoke_capability",
      gateway_arguments: {
        capability: "create_animation",
        cohort_boundary: "COMPLETE",
        arguments: {
          name: "animation.test.impact", loop: false, animation_length: 1,
        },
      },
      semantic_context: {
        archetype: "ACTION", activation: "PREVIEW_ONLY",
        local_contact: {
          state: "SOURCE_ONLY_LOCAL_HOLD",
          world_space_foot_locking_authorized: false,
        },
      },
      execution_evidence: {
        state: "SOURCE_PLAN_NOT_EXECUTED",
        native_runtime_attested: false,
        playback_attested: false,
        contact_attested: false,
        controller_activation_attested: false,
        native_interpolation_post_edits_required: false,
      },
    });
    const nativeArgs = bridge.gateway_arguments.arguments;
    expect(Object.keys(nativeArgs).sort())
      .toEqual(["animation_length", "bones", "loop", "name"]);
    expect(createAnimationParameters.safeParse(nativeArgs).success).toBe(true);
    expect(nativeArgs.bones.foot.map((key) => key.time))
      .toEqual([0, 0.2, 0.5, 0.8, 1]);
    expect(JSON.stringify({ input, declared })).toBe(before);
    expect(compileSemanticMotionToGatewayInvocation(input, declared)).toEqual(bridge);
  });

  test("permits explicit linear interpolation because native create_animation is linear", () => {
    const input = recipe();
    Object.assign(input.poses[1]!.bones.body, { interpolation: "linear" });
    const bridge = compileSemanticMotionToGatewayInvocation(input, intent());
    expect(createAnimationParameters.safeParse(
      bridge.gateway_arguments.arguments
    ).success).toBe(true);
    expect(bridge.execution_evidence.native_interpolation_post_edits_required)
      .toBe(false);
  });

  test("refuses nonlinear interpolation that would require an unsafe native grid edit", () => {
    const input = recipe();
    Object.assign(input.poses[1]!.bones.body, { interpolation: "catmullrom" });
    expect(() => compileSemanticMotionToGatewayInvocation(input, intent()))
      .toThrow("SEMANTIC_MOTION_NATIVE_CLOCK_REQUIRED");
  });

  test("refuses colliding case-insensitive Bedrock identities before Gateway invocation", () => {
    const input = recipe();
    Object.assign(input.poses[1]!.bones, { BODY: { rotation: [4, 0, 0] } });
    expect(() => compileSemanticMotionToGatewayInvocation(input, intent()))
      .toThrow("SEMANTIC_MOTION_BONE_IDENTITY_COLLISION");
  });

  test("refuses whitespace-padded bone identities and preserves native project targeting", () => {
    const input = recipe();
    Object.assign(input.poses[0]!.bones, { " foot ": { position: [0, 0, 0] } });
    expect(() => compileSemanticMotionToGatewayInvocation(input, intent()))
      .toThrow("SEMANTIC_MOTION_BONE_IDENTITY_INVALID");

    const controllerIntent = {
      ...intent(), activation: "CONTROLLER_STATE" as const,
    };
    const bridge = compileSemanticMotionToGatewayInvocation(recipe(), controllerIntent);
    expect(bridge.semantic_context.activation).toBe("CONTROLLER_STATE");
    expect(bridge.execution_evidence.controller_activation_attested).toBe(false);
    expect(bridge.gateway_arguments).not.toHaveProperty("task_context_id");
  });


  test("rejects a critical CONTACT role with no authored key on its primary bone", () => {
    const clip = recipe();
    Reflect.deleteProperty(clip.poses[1]!.bones, "body");
    const userIntent = intent();
    const before = JSON.stringify({ clip, userIntent });
    expect(() => compileSemanticMotionToGatewayInvocation(clip, userIntent))
      .toThrow("SEMANTIC_MOTION_PRIMARY_ROLE_UNKEYED");
    expect(JSON.stringify({ clip, userIntent })).toBe(before);
  });

  test("rejects a CONTACT primary pose deleted by native linear compaction", () => {
    const clip = recipe();
    Object.assign(clip.poses[2]!.bones.body, { rotation: [30, 0, 0] });
    // Body rotation becomes [0,15,30] at [0,0.5,1]; native create
    // removes the exact middle key even though semantic CONTACT names it.
    expect(() => compileSemanticMotionToGatewayInvocation(clip, intent()))
      .toThrow("SEMANTIC_MOTION_PRIMARY_ROLE_COMPACTED");
  });

  test("reports source-only retained primary poses without native quality claims", () => {
    const bridge = compileSemanticMotionToGatewayInvocation(recipe(), intent());
    expect(bridge.semantic_context.primary_role_key_retention).toMatchObject({
      state: "SOURCE_ONLY_PRIMARY_KEYS_RETAINED",
      checked_role_count: 3,
      native_import_attested: false,
      visual_verdict: "not_evaluated",
    });
    expect(bridge.execution_evidence).toMatchObject({
      state: "SOURCE_PLAN_NOT_EXECUTED",
      native_runtime_attested: false,
      contact_attested: false,
    });
    expect(bridge.gateway_arguments.arguments).not.toHaveProperty("primary_role_key_retention");
  });

  test("supports a declared secondary primary bone when it retains the critical key", () => {
    const clip = recipe();
    Object.assign(clip.poses[2]!.bones.body, { rotation: [30, 0, 0] });
    for (const [index, frame] of clip.poses.entries()) {
      Object.assign(frame.bones, {
        hand: { rotation: [index === 1 ? 7 : 0, 0, 0] },
      });
    }
    const userIntent = { ...intent(), primary_bones: ["body", "hand"] };
    const bridge = compileSemanticMotionToGatewayInvocation(clip, userIntent);
    expect(bridge.semantic_context.primary_role_key_retention.checked_role_count).toBe(3);
  });

  test("does not invent primary movement for a passive HOLD phase", () => {
    const clip = recipe();
    Reflect.deleteProperty(clip.poses[1]!.bones, "body");
    const userIntent = {
      ...intent(),
      pose_roles: [
        { pose_id: "windup", role: "ANTICIPATION" as const },
        { pose_id: "strike", role: "HOLD" as const },
        { pose_id: "reset", role: "RECOVERY" as const },
      ],
    };
    const bridge = compileSemanticMotionToGatewayInvocation(clip, userIntent);
    expect(bridge.semantic_context.primary_role_key_retention.checked_role_count).toBe(2);
  });
});


describe("native-safe spring follow-through and semantic Gateway plans", () => {
  const source = () => ({
    name: "animation.test.spring",
    duration: 1,
    poses: [
      { id: "ready", time: 0, bones: { body: { rotation: [20, 0, 0] as [number, number, number] } } },
      { id: "contact", time: 0.5, bones: { body: { rotation: [50, 0, 0] as [number, number, number] } } },
      { id: "recover", time: 1, bones: { body: { rotation: [20, 0, 0] as [number, number, number] } } },
    ],
  });
  const spring = () => ({
    parent_bone: "body", child_bone: "cape", channel: "rotation" as const,
    drive_mode: "parent_delta" as const, sample_rate: 24,
  });
  const intent = () => ({
    archetype: "ACTION" as const, activation: "PREVIEW_ONLY" as const,
    primary_bones: ["body"],
    pose_roles: [
      { pose_id: "ready", role: "ANTICIPATION" as const },
      { pose_id: "contact", role: "CONTACT" as const },
      { pose_id: "recover", role: "RECOVERY" as const },
    ],
  });

  test("neutral relative spring lags parent and uses linear native-safe sampled keys", () => {
    const clip = source(), before = JSON.stringify(clip);
    const sampled = compileMotionRecipe(compileSpringSecondaryMotion(clip, [spring()]));
    const follower = sampled.bones.cape;
    expect(follower[0]).toMatchObject({ time: 0, rotation: [0, 0, 0] });
    expect(follower.at(-1)?.time).toBe(1);
    expect(follower.some((frame) => frame.time > 0.5 && (frame.rotation?.[0] ?? 0) > 0.01))
      .toBe(true);
    expect(follower.every((frame) => frame.interpolation === undefined)).toBe(true);
    expect(JSON.stringify(clip)).toBe(before);
    const plan = compileMotionWithSpringToCreateAnimationPlan(clip, [spring()]);
    expect(plan.post_create_keyframe_edits).toHaveLength(0);
    expect(createAnimationParameters.safeParse(plan.create_animation).success).toBe(true);
  });

  test("semantic gateway bridge includes secondary follow-through without new native arguments", () => {
    const input = source(), declared = { ...intent(), spring_links: [spring()] };
    const before = JSON.stringify({ input, declared });
    const bridge = compileSemanticMotionToGatewayInvocation(input, declared);
    expect(bridge.gateway_tool).toBe("invoke_capability");
    expect(bridge.gateway_arguments.capability).toBe("create_animation");
    expect(Object.keys(bridge.gateway_arguments.arguments).sort())
      .toEqual(["animation_length", "bones", "loop", "name"]);
    expect(bridge.gateway_arguments.arguments.bones.cape.length).toBeGreaterThan(3);
    expect(createAnimationParameters.safeParse(bridge.gateway_arguments.arguments).success)
      .toBe(true);
    expect(bridge.semantic_context.spring_follow_through).toMatchObject({
      state: "SOURCE_ONLY_LINEAR_BAKE",
      requested_link_count: 1,
      relative_drive_count: 1,
      native_playback_attested: false,
      visual_verdict: "not_evaluated",
    });
    expect(bridge.execution_evidence).toMatchObject({
      state: "SOURCE_PLAN_NOT_EXECUTED", playback_attested: false,
    });
    expect(JSON.stringify({ input, declared })).toBe(before);
    expect(compileSemanticMotionToGatewayInvocation(input, declared)).toEqual(bridge);
  });

  test("legacy absolute follower still works without requiring spring drive mode", () => {
    const legacy = compileMotionRecipe(compileSpringSecondaryMotion(source(), [{
      parent_bone: "body", child_bone: "cape", channel: "rotation",
    }]));
    expect((legacy.bones.cape[0].rotation?.[0] ?? 0)).toBeGreaterThan(0);
    expect(legacy.bones.cape.every((frame) => frame.interpolation === undefined)).toBe(true);
  });

  test("protects primary/contact bones and refuses existing or duplicate follower ownership", () => {
    expect(() => compileSemanticMotionToGatewayInvocation(source(), {
      ...intent(), spring_links: [{ ...spring(), child_bone: "body" }],
    })).toThrow("SEMANTIC_MOTION_SPRING_PROTECTED_BONE");
    expect(() => compileSemanticMotionToGatewayInvocation(source(), {
      ...intent(),
      local_contacts: [{ bone: "cape", channel: "position", start: 0.2, end: 0.8, value: [0, 0, 0] }],
      spring_links: [spring()],
    })).toThrow("SEMANTIC_MOTION_SPRING_PROTECTED_BONE");
    const authored = source();
    Object.assign(authored.poses[1]!.bones, { cape: { rotation: [2, 0, 0] } });
    expect(() => compileSpringSecondaryMotion(authored, [spring()]))
      .toThrow("SPRING_CHILD_TRACK_ALREADY_AUTHORED");
    expect(() => compileSpringSecondaryMotion(source(), [spring(), spring()]))
      .toThrow("SPRING_CHILD_OWNERSHIP_DUPLICATE");
  });

  test("refuses ambiguous Euler wrap and invalid sample sequences before native plan", () => {
    const turning = source();
    Object.assign(turning.poses[0]!.bones.body, { rotation: [179, 0, 0] });
    Object.assign(turning.poses[1]!.bones.body, { rotation: [-179, 0, 0] });
    expect(() => compileSpringSecondaryMotion(turning, [spring()]))
      .toThrow("SPRING_ROTATION_WRAP_UNRESOLVED");
    const duplicate = source();
    duplicate.poses[1]!.time = 0;
    expect(() => compileSpringSecondaryMotion(duplicate, [spring()]))
      .toThrow("SPRING_PARENT_SAMPLES_INVALID");
  });

  test("includes an exact final key when sampled duration is off the selected rate grid", () => {
    const baked = compileMotionRecipe(compileSpringSecondaryMotion(source(), [{
      ...spring(), max_duration: 0.7,
    }]));
    expect(baked.bones.cape.at(-1)?.time).toBe(0.7);
  });
});


describe("periodic spring source-cycle continuity", () => {
  const cyclic = () => ({
    name: "animation.test.cyclic_cape", loop: true, duration: 1,
    poses: [
      { id: "start", time: 0, bones: { body: { rotation: [20, 0, 0] as [number,number,number] } } },
      { id: "peak", time: 0.5, bones: { body: { rotation: [50, 0, 0] as [number,number,number] } } },
      { id: "seam", time: 1, bones: { body: { rotation: [20, 0, 0] as [number,number,number] } } },
    ],
  });
  const follower = () => ({
    parent_bone: "body", child_bone: "cape", channel: "rotation" as const,
    drive_mode: "parent_delta" as const, loop_strategy: "periodic" as const,
    sample_rate: 24, damping: 10, stiffness: 36,
  });

  test("converged cyclic spring starts at its steady-state response, not a zeroed transient", () => {
    const input = cyclic(), before = JSON.stringify(input);
    const result = compileMotionRecipe(compileSpringSecondaryMotion(input, [follower()]));
    const frames = result.bones.cape;
    expect(frames[0].time).toBe(0);
    expect(frames.at(-1)?.time).toBe(1);
    expect(Math.abs(frames[0].rotation![0])).toBeGreaterThan(0.01);
    expect(frames.at(-1)?.rotation).toEqual(frames[0].rotation);
    expect(frames.every((frame) => frame.interpolation === undefined)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
    expect(compileSpringSecondaryMotion(input, [follower()]))
      .toEqual(compileSpringSecondaryMotion(input, [follower()]));
  });

  test("the existing semantic Gateway bridge accepts cyclic linear-baked followers", () => {
    const plan = compileSemanticMotionToGatewayInvocation(cyclic(), {
      archetype: "IDLE", activation: "PREVIEW_ONLY", primary_bones: ["body"],
      pose_roles: [
        { pose_id: "peak", role: "ACTION" },
        { pose_id: "seam", role: "LOOP_SEAM" },
      ],
      spring_links: [follower()],
    });
    const nativeArgs = plan.gateway_arguments.arguments;
    expect(createAnimationParameters.safeParse(nativeArgs).success).toBe(true);
    expect(nativeArgs.loop).toBe(true);
    expect(nativeArgs.bones.cape[0].rotation)
      .toEqual(nativeArgs.bones.cape.at(-1)?.rotation);
    expect(plan.semantic_context.spring_follow_through)
      .toMatchObject({ state: "SOURCE_ONLY_LINEAR_BAKE", native_playback_attested: false });
    expect(plan.execution_evidence.playback_attested).toBe(false);
  });

  test("missing or different parent loop endpoints are not silently glued", () => {
    const open = cyclic();
    Object.assign(open.poses[2]!.bones.body, { rotation: [25, 0, 0] });
    expect(() => compileSpringSecondaryMotion(open, [follower()]))
      .toThrow("SPRING_PERIODIC_SOURCE_SEAM_UNVERIFIED");
    const missing = cyclic();
    Reflect.deleteProperty(missing.poses[2]!.bones, "body");
    expect(() => compileSpringSecondaryMotion(missing, [follower()]))
      .toThrow("SPRING_PERIODIC_SOURCE_SEAM_UNVERIFIED");
  });

  test("periodic requires a full authored loop and integer sampling clock", () => {
    expect(() => compileSpringSecondaryMotion({ ...cyclic(), loop: false }, [follower()]))
      .toThrow("SPRING_PERIODIC_REQUIRES_AUTHORED_LOOP");
    expect(() => compileSpringSecondaryMotion(cyclic(), [
      { ...follower(), max_duration: 0.7 },
    ])).toThrow("SPRING_PERIODIC_SOURCE_SEAM_UNVERIFIED");
    expect(() => compileSpringSecondaryMotion(cyclic(), [
      { ...follower(), sample_rate: 24.5 },
    ])).toThrow("SPRING_PERIODIC_SOURCE_SEAM_UNVERIFIED");
  });

  test("undamped/nonconvergent cyclic spring refuses to claim a seamless bake", () => {
    expect(() => compileSpringSecondaryMotion(cyclic(), [
      { ...follower(), damping: 0 },
    ])).toThrow("SPRING_PERIODIC_STATE_NOT_CONVERGED");
  });

  test("periodic absolute followers also reject ambiguous Euler wraps", () => {
    const wrapping = cyclic();
    Object.assign(wrapping.poses[0]!.bones.body, { rotation: [179, 0, 0] });
    Object.assign(wrapping.poses[1]!.bones.body, { rotation: [-179, 0, 0] });
    Object.assign(wrapping.poses[2]!.bones.body, { rotation: [179, 0, 0] });
    expect(() => compileSpringSecondaryMotion(wrapping, [
      { ...follower(), drive_mode: "absolute" },
    ])).toThrow("SPRING_ROTATION_WRAP_UNRESOLVED");
  });

  test("legacy reset behavior remains the default and does not imply periodic proof", () => {
    const legacy = compileMotionRecipe(compileSpringSecondaryMotion(cyclic(), [
      { parent_bone: "body", child_bone: "cape", channel: "rotation" },
    ]));
    expect(legacy.bones.cape[0].time).toBe(0);
    expect(legacy.bones.cape.every((frame) => frame.interpolation === undefined)).toBe(true);
    expect(legacy.bones.cape[0].rotation).not.toEqual(legacy.bones.cape.at(-1)?.rotation);
  });
});


describe("semantic motion source-to-native clock preflight", () => {
  const origin = () => ({
    name: "animation.test.clock",
    duration: 1,
    poses: [
      { id: "ready", time: 0, bones: { body: { rotation: [0, 0, 0] as [number,number,number] } } },
      { id: "contact", time: 0.5, bones: { body: { rotation: [15, 0, 0] as [number,number,number] } } },
      { id: "recover", time: 1, bones: { body: { rotation: [0, 0, 0] as [number,number,number] } } },
    ],
  });
  const spring = (fps: number, child: string) => ({
    parent_bone: "body", child_bone: child, channel: "rotation" as const,
    drive_mode: "parent_delta" as const, sample_rate: fps,
  });
  const intent = () => ({
    archetype: "ACTION" as const,
    activation: "PREVIEW_ONLY" as const,
    primary_bones: ["body"],
    pose_roles: [
      { pose_id: "ready", role: "ANTICIPATION" as const },
      { pose_id: "contact", role: "CONTACT" as const },
      { pose_id: "recover", role: "RECOVERY" as const },
    ],
  });

  test("rejects incompatible independent spring frame rates before any Gateway request", () => {
    const recipe = origin(), declared = {
      ...intent(), spring_links: [spring(24, "cape"), spring(25, "tail")],
    };
    const original = JSON.stringify({ recipe, declared });
    expect(() => compileSemanticMotionToGatewayInvocation(recipe, declared))
      .toThrow("ANIMATION_NATIVE_SNAPPING_UNREPRESENTABLE");
    expect(JSON.stringify({ recipe, declared })).toBe(original);
  });

  test("accepts two follower clocks sharing one supported 120 FPS grid", () => {
    const recipe = origin(), declared = {
      ...intent(), spring_links: [spring(24, "cape"), spring(30, "tail")],
    };
    const planned = compileSemanticMotionToGatewayInvocation(recipe, declared);
    expect(planned.semantic_context.source_frame_grid_preflight).toMatchObject({
      state: "SOURCE_ONLY_GRID_REPRESENTABLE",
      candidate_effective_fps: 120,
      imported_native_snapping_observed: false,
      native_snapping_applied: false,
      native_export_timecodes_verified: false,
      native_playback_attested: false,
    });
    expect(planned.semantic_context.source_frame_grid_preflight.retained_source_channel_key_count)
      .toBeGreaterThan(5);
    expect(createAnimationParameters.safeParse(planned.gateway_arguments.arguments).success)
      .toBe(true);
    expect(planned.gateway_arguments.arguments).not.toHaveProperty("source_frame_grid_preflight");
    expect(planned.execution_evidence.state).toBe("SOURCE_PLAN_NOT_EXECUTED");
    expect(planned.execution_evidence.playback_attested).toBe(false);
  });

  test("ordinary pose and source-held contact clocks retain a valid grid plan", () => {
    const src = origin();
    for (const pose of src.poses) {
      Object.assign(pose.bones.body, { position: [0, 0, 0] });
    }
    const planned = compileSemanticMotionToGatewayInvocation(src, {
      ...intent(),
      local_contacts: [{
        bone: "body", channel: "position" as const, start: 0.2, end: 0.8,
        value: [0, 0, 0] as [number, number, number],
      }],
    });
    expect(planned.semantic_context.source_frame_grid_preflight).toMatchObject({
      state: "SOURCE_ONLY_GRID_REPRESENTABLE",
      candidate_effective_fps: 10,
      native_export_timecodes_verified: false,
    });
  });

  test("two explicit sub-frame channel clocks remain unsafe even without springs", () => {
    const src = origin();
    src.poses.push(
      { id: "clock24", time: 1 / 24, bones: { body: { rotation: [1, 0, 0] } } },
      { id: "clock25", time: 1 / 25, bones: { body: { rotation: [2, 0, 0] } } },
    );
    // Different values on the SAME channel are still source-valid, but
    // their clocks cannot be faithfully exported on any 10..120 FPS grid.
    expect(() => compileSemanticMotionToGatewayInvocation(src, {
      ...intent(),
      pose_roles: [{ pose_id: "contact", role: "CONTACT" }],
    })).toThrow("ANIMATION_NATIVE_SNAPPING_UNREPRESENTABLE");
  });
});


describe("source-only PCHIP baked motion through the existing Gateway bridge",()=>{
  const clip=()=>({
    name:"eased_attack",duration:1,loop:false,
    poses:[
      {id:"ready",time:0,bones:{body:{rotation:[0,0,0] as [number,number,number]}}},
      {id:"impact",time:.5,bones:{body:{rotation:[15,0,0] as [number,number,number]}}},
      {id:"recover",time:1,bones:{body:{rotation:[0,0,0] as [number,number,number]}}},
    ],
  });
  const intent=()=>({
    archetype:"ACTION" as const,
    activation:"PREVIEW_ONLY" as const,
    primary_bones:["body"],
    pose_roles:[
      {pose_id:"ready",role:"ANTICIPATION" as const},
      {pose_id:"impact",role:"CONTACT" as const},
      {pose_id:"recover",role:"RECOVERY" as const},
    ],
  });

  test("explicit smooth curve is native linear payload with all semantic roles retained",()=>{
    const source=clip(),before=JSON.stringify({source,intent:intent()});
    const invocation=compileSemanticMotionWithPchipToGatewayInvocation(
      source,intent(),[{bone:"body",channel:"rotation"}],
      {sample_fps:30,boundary_tangent:"rest_endpoints"}
    );
    expect(createAnimationParameters.safeParse(invocation.gateway_arguments.arguments).success)
      .toBe(true);
    expect(invocation.gateway_tool).toBe("invoke_capability");
    expect(invocation.gateway_arguments.capability).toBe("create_animation");
    expect(invocation.semantic_context.pose_roles.map(role=>role.pose_id))
      .toEqual(["ready","impact","recover"]);
    expect(invocation.semantic_context.primary_role_key_retention.state)
      .toBe("SOURCE_ONLY_PRIMARY_KEYS_RETAINED");
    expect(invocation.semantic_context.source_frame_grid_preflight)
      .toMatchObject({state:"SOURCE_ONLY_GRID_REPRESENTABLE",
        native_playback_attested:false});
    expect(invocation.semantic_context.shape_preserving_linear_bake).toMatchObject({
      state:"SOURCE_ONLY_SHAPE_PRESERVING_LINEAR_BAKE",
      source_sample_fps:30,
      generated_channel_key_count:28,
      native_playback_attested:false,
    });
    expect(invocation.gateway_arguments.arguments)
      .not.toHaveProperty("shape_preserving_linear_bake");
    expect(invocation.execution_evidence.state).toBe("SOURCE_PLAN_NOT_EXECUTED");
    expect(invocation.execution_evidence.playback_attested).toBe(false);
    expect(JSON.stringify({source,intent:intent()})).toBe(before);
  });

  test("authoritative contact bones and spring-owned followers cannot be silently smoothed",()=>{
    const source=clip();
    expect(()=>compileSemanticMotionWithPchipToGatewayInvocation(source,{
      ...intent(),
      local_contacts:[{bone:"body",channel:"position" as const,start:.25,end:.75,
        value:[0,0,0] as [number,number,number]}],
    },[{bone:"body",channel:"rotation"}],{sample_fps:30}))
      .toThrow("SEMANTIC_PCHIP_CONTACT_BONE_PROTECTED");
    expect(()=>compileSemanticMotionWithPchipToGatewayInvocation(source,{
      ...intent(),
      spring_links:[{parent_bone:"root",child_bone:"body",channel:"rotation" as const}],
    },[{bone:"body",channel:"rotation"}],{sample_fps:30}))
      .toThrow("SEMANTIC_PCHIP_SPRING_CHILD_PROTECTED");
  });
});
