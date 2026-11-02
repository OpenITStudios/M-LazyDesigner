import {
  compileMotionRecipe,
  type CompiledMotionRecipe,
  type MotionChannel,
  type MotionRecipe,
} from "@/lib/animation/motionRecipe";
import { compileSecondaryMotion, type SecondaryMotionLink } from "@/lib/animation/secondaryMotion";
import { applyContactConstraints, type ContactConstraint } from "@/lib/animation/contactConstraints";
import { compactLinearCreationKeyframes } from "@/lib/animation/quality";
import { compileSpringSecondaryMotion, type SpringMotionLink } from "@/lib/animation/springMotion";

function createAnimationPayload(recipe:CompiledMotionRecipe){
  return {name:recipe.name,loop:recipe.loop,animation_length:recipe.duration,bones:Object.fromEntries(
    Object.entries(recipe.bones).map(([bone,keyframes])=>[bone,keyframes.map((keyframe)=>({
      time:keyframe.time,
      ...(keyframe.position?{position:keyframe.position}:{}),
      ...(keyframe.rotation?{rotation:keyframe.rotation}:{}),
      ...(keyframe.scale!==undefined?{scale:keyframe.scale}:{}),
    }))])
  )};
}
export function compileMotionToCreateAnimation(recipe: CompiledMotionRecipe) {
  if(Object.values(recipe.bones).some(frames=>frames.some(frame=>frame.interpolation!==undefined))){
    throw new Error("create_animation does not author interpolation metadata. Use compileMotionToCreateAnimationPlan so interpolation is applied through bounded post-create manage_keyframes edits.");
  }
  return createAnimationPayload(recipe);
}
export type KeyframeToolRequest={animation_id?:string;action:"create"|"edit";bone_name:string;channel:MotionChannel;keyframes:Array<{time:number;values?:number|string|Array<number|string>;interpolation?:string}>};
export function compileMotionToKeyframeRequests(recipe:CompiledMotionRecipe,affectedBones?:readonly string[]):KeyframeToolRequest[]{
  const filter=affectedBones?new Set(affectedBones):null;
  const requests:KeyframeToolRequest[]=[];
  for(const [bone,frames] of Object.entries(recipe.bones)){
    if(filter&&!filter.has(bone)) continue;
    for(const channel of ["position","rotation","scale"] as const){
      const keyframes=frames.flatMap(frame=>{
        const value=frame[channel];
        return value===undefined?[]:[{time:frame.time,values:value as number|Array<number|string>,...(frame.interpolation?{interpolation:frame.interpolation}:{})}];
      });
      if(keyframes.length) requests.push({action:"create",bone_name:bone,channel,keyframes});
    }
  }
  return requests;
}
export function compileMotionToCreateAnimationPlan(recipe:CompiledMotionRecipe){
  // The native create_animation implementation strictly compacts numeric
  // linear keys before codec import. A later interpolation edit must not
  // target an eliminated key or change a curve after adjacent keys vanished.
  for (const [bone, frames] of Object.entries(recipe.bones)) {
    const compacted = compactLinearCreationKeyframes(frames);
    for (const channel of ["position", "rotation", "scale"] as const) {
      if (compacted.removed_by_channel[channel] === 0) continue;
      const edited = frames.filter((frame) =>
        frame[channel] !== undefined && frame.interpolation !== undefined
      );
      if (edited.length === 0) continue;
      const survivingTimes = new Set(compacted.frames
        .filter((frame) => frame[channel] !== undefined)
        .map((frame) => frame.time));
      const missingEditTarget = edited.some((frame) =>
        !survivingTimes.has(frame.time)
      );
      const nonlinearEdit = edited.some((frame) =>
        frame.interpolation !== "linear"
      );
      if (missingEditTarget || nonlinearEdit) {
        throw new Error(
          "MOTION_INTERPOLATION_COMPACTION_CONFLICT: create_animation may " +
          "remove source " + bone + "." + channel +
          " keys needed for interpolation edits. No unsafe native plan was produced."
        );
      }
    }
  }
  const postCreateEdits:KeyframeToolRequest[]=[];
  for(const [bone,frames] of Object.entries(recipe.bones)){
    for(const channel of ["position","rotation","scale"] as const){
      const edits=frames.flatMap(frame=>frame[channel]!==undefined&&frame.interpolation!==undefined?[{time:frame.time,interpolation:frame.interpolation}]:[]);
      if(edits.length) postCreateEdits.push({action:"edit",bone_name:bone,channel,keyframes:edits});
    }
  }
  return {create_animation:createAnimationPayload(recipe),post_create_keyframe_edits:postCreateEdits};
}
export function compileMotionWithSecondaryToCreateAnimationPlan(recipe:MotionRecipe,links:readonly SecondaryMotionLink[]){
  return compileMotionToCreateAnimationPlan(compileMotionRecipe(compileSecondaryMotion(recipe,links)));
}
export function compileMotionWithSpringToCreateAnimationPlan(recipe:MotionRecipe,links:readonly SpringMotionLink[]){
  return compileMotionToCreateAnimationPlan(compileMotionRecipe(compileSpringSecondaryMotion(recipe,links)));
}


/**
 * Compiles an explicit BONE-LOCAL position hold into the existing native
 * create_animation plan. Native create may compact exactly redundant keys
 * while preserving numeric linear motion. The compiler DOES NOT issue
 * post-create writes: manage_keyframes snaps to the live animation grid
 * and cannot promise exact source times without a verified native clock.
 * World-space contact, IK, native sampling and visual fidelity are unproven.
 */
export function compileMotionWithLocalContactsToCreateAnimationPlan(
  recipe: MotionRecipe,
  contacts: readonly ContactConstraint[]
) {
  const constrained = applyContactConstraints(compileMotionRecipe(recipe), contacts);
  const plan = compileMotionToCreateAnimationPlan(constrained);
  const anchorsByBone = new Map<string, Set<number>>();
  for (const contact of contacts) {
    const anchors = anchorsByBone.get(contact.bone) ?? new Set<number>();
    anchors.add(contact.start);
    anchors.add(contact.end);
    anchorsByBone.set(contact.bone, anchors);
  }
  return {
    ...plan,
    local_contact_contract: {
      state: "SOURCE_ONLY_LOCAL_HOLD" as const,
      contact_constraint_count: contacts.length,
      source_boundary_count: [...anchorsByBone.values()].reduce((n, times) => n + times.size, 0),
      post_create_anchor_writes_authorized: false as const,
      native_snap_grid_verified: false as const,
      physical_contact_verified: false as const,
      native_pose_sampling_performed: false as const,
      world_space_foot_locking_authorized: false as const,
    },
  };
}

export type SemanticMotionPoseRole =
  | "SETUP" | "ANTICIPATION" | "ACTION" | "CONTACT"
  | "FOLLOW_THROUGH" | "RECOVERY" | "STANCE" | "SWING"
  | "HOLD" | "LOOP_SEAM";

export type SemanticMotionIntent = {
  archetype: "ACTION" | "LOCOMOTION" | "IDLE" | "MECHANICAL" | "ORGANIC";
  activation: "DIRECT" | "CONTROLLER_STATE" | "EXTERNAL_CALLER" |
    "PREVIEW_ONLY" | "UNRESOLVED";
  primary_bones: readonly string[];
  pose_roles: readonly { pose_id: string; role: SemanticMotionPoseRole }[];
  local_contacts?: readonly ContactConstraint[];
};

/**
 * An explicit semantic motion plan, not an action or duration preset.
 * Primary bones, pose roles, contact intervals and activation are supplied
 * by the caller and validated before the existing native tool plan is made.
 */
export function compileSemanticMotionToCreateAnimationPlan(
  recipe: MotionRecipe,
  intent: SemanticMotionIntent
) {
  const compiled = compileMotionRecipe(recipe);
  const archetypes = ["ACTION", "LOCOMOTION", "IDLE", "MECHANICAL", "ORGANIC"];
  const activations = [
    "DIRECT", "CONTROLLER_STATE", "EXTERNAL_CALLER",
    "PREVIEW_ONLY", "UNRESOLVED",
  ];
  if (!intent || !archetypes.includes(intent.archetype) ||
      !activations.includes(intent.activation)) {
    throw new Error("Semantic motion requires an explicit archetype and activation intent.");
  }
  if (!Array.isArray(intent.primary_bones) ||
      intent.primary_bones.length === 0 ||
      new Set(intent.primary_bones).size !== intent.primary_bones.length ||
      intent.primary_bones.some((bone) =>
        typeof bone !== "string" || !bone.trim() ||
        !compiled.bones[bone]?.length
      )) {
    throw new Error(
      "Semantic motion primary_bones must be distinct authored bone identities."
    );
  }
  if (!Array.isArray(intent.pose_roles) ||
      intent.pose_roles.length === 0 ||
      intent.pose_roles.length > recipe.poses.length) {
    throw new Error("Semantic motion requires bounded, source-declared pose roles.");
  }
  const poseTimes = new Map(recipe.poses.map((pose) => [pose.id, pose.time]));
  const allowedRoles: readonly string[] = [
    "SETUP", "ANTICIPATION", "ACTION", "CONTACT", "FOLLOW_THROUGH",
    "RECOVERY", "STANCE", "SWING", "HOLD", "LOOP_SEAM",
  ];
  const usedRoles = new Set<string>();
  const roles = intent.pose_roles.map((record) => {
    if (!record || typeof record.pose_id !== "string" ||
        !poseTimes.has(record.pose_id) ||
        usedRoles.has(record.pose_id) ||
        !allowedRoles.includes(record.role)) {
      throw new Error("Semantic motion pose roles require exact, unique authored pose IDs.");
    }
    usedRoles.add(record.pose_id);
    return {
      pose_id: record.pose_id,
      role: record.role,
      time: poseTimes.get(record.pose_id)!,
    };
  }).sort((a, b) => a.time - b.time);

  const plan = compileMotionWithLocalContactsToCreateAnimationPlan(
    recipe, intent.local_contacts ?? []
  );
  return {
    ...plan,
    semantic_motion_contract: {
      state: "AUTHOR_DECLARED_SOURCE_PLAN" as const,
      archetype: intent.archetype,
      activation: intent.activation,
      primary_bones: [...intent.primary_bones],
      pose_roles: roles,
      source_pose_count: recipe.poses.length,
      physical_contact_verified: false as const,
      motion_fidelity_verified: false as const,
      gameplay_activation_assumed: false as const,
    },
  };
}


/**
 * Source-only bridge to the existing stable-four Gateway invocation contract.
 *
 * A concrete declared semantic motion can be transmitted using the already
 * registered create_animation capability with no new Runtime/schema surface.
 * This helper does not invoke the Gateway, inspect native state, attest the
 * project/stage, or authorize an external controller/gameplay transition.
 *
 * Explicit non-linear interpolation requires native clock-aware post-create
 * mutation and is deliberately withheld from this single-call route.
 */
export function compileSemanticMotionToGatewayInvocation(
  recipe: MotionRecipe,
  intent: SemanticMotionIntent
) {
  const plan = compileSemanticMotionToCreateAnimationPlan(recipe, intent);

  const requiresNonlinearEdits = plan.post_create_keyframe_edits.some((request) =>
    request.keyframes.some((keyframe) =>
      keyframe.interpolation !== undefined &&
      keyframe.interpolation !== "linear"
    )
  );
  if (requiresNonlinearEdits) {
    throw new Error(
      "SEMANTIC_MOTION_NATIVE_CLOCK_REQUIRED: non-linear interpolation " +
      "needs a verified native animation UUID, snapping grid, and " +
      "explicit manage_animation_timeline edit after clip creation."
    );
  }

  // Native Bedrock import matches bone names case-insensitively. Never
  // return an executable candidate with ambiguous authored identities.
  const bones = Object.keys(plan.create_animation.bones);
  const names = new Set<string>();
  for (const bone of bones) {
    if (!bone || bone !== bone.trim()) {
      throw new Error("SEMANTIC_MOTION_BONE_IDENTITY_INVALID: trim or correct the authored bone identity.");
    }
    const key = bone.toLowerCase();
    if (names.has(key)) {
      throw new Error("SEMANTIC_MOTION_BONE_IDENTITY_COLLISION: Bedrock bone identity is case-insensitive.");
    }
    names.add(key);
  }

  if (bones.length === 0) {
    throw new Error("SEMANTIC_MOTION_EMPTY_CLIP: at least one keyed bone is required.");
  }

  // Native create_animation compactLinearCreationKeyframes() is applied
  // before Bedrock import. A labelled action/contact/locomotion pose must
  // not silently lose every explicitly keyed primary-bone anchor. This
  // check observes SOURCE key retention only, never playback or fidelity.
  const criticalRoles = new Set<SemanticMotionPoseRole>([
    "ANTICIPATION", "ACTION", "CONTACT", "FOLLOW_THROUGH",
    "RECOVERY", "STANCE", "SWING",
  ]);
  const retainedTimeByPrimaryBone = new Map<string, ReadonlySet<number>>();
  for (const bone of plan.semantic_motion_contract.primary_bones) {
    const frames = plan.create_animation.bones[bone] ?? [];
    const retained = compactLinearCreationKeyframes(frames).frames;
    retainedTimeByPrimaryBone.set(
      bone, new Set(retained.map((frame) => frame.time))
    );
  }
  let checkedPrimaryRoleCount = 0;
  for (const { pose_id, role, time } of plan.semantic_motion_contract.pose_roles) {
    if (!criticalRoles.has(role)) continue;
    const primaryWithKeys = plan.semantic_motion_contract.primary_bones.filter(
      (bone) => (plan.create_animation.bones[bone] ?? []).some(
        (frame) => frame.time === time &&
          (frame.position !== undefined ||
           frame.rotation !== undefined ||
           frame.scale !== undefined)
      )
    );
    if (primaryWithKeys.length === 0) {
      throw new Error(
        "SEMANTIC_MOTION_PRIMARY_ROLE_UNKEYED: " + role + " pose " +
        pose_id + " at " + time +
        " has no authored primary-bone transform at that time."
      );
    }
    if (!primaryWithKeys.some(
      (bone) => retainedTimeByPrimaryBone.get(bone)?.has(time)
    )) {
      throw new Error(
        "SEMANTIC_MOTION_PRIMARY_ROLE_COMPACTED: " + role + " pose " +
        pose_id + " at " + time +
        " would lose all primary-bone keys during native linear compaction."
      );
    }
    checkedPrimaryRoleCount += 1;
  }

  const args = plan.create_animation;
  return {
    gateway_tool: "invoke_capability" as const,
    gateway_arguments: {
      capability: "create_animation" as const,
      arguments: args,
      cohort_boundary: "COMPLETE" as const,
    },
    // Do not place unverified planner context or contact claims inside native
    // arguments: the existing create_animation schema remains unchanged.
    semantic_context: {
      ...plan.semantic_motion_contract,
      local_contact: plan.local_contact_contract,
      primary_role_key_retention: {
        state: "SOURCE_ONLY_PRIMARY_KEYS_RETAINED" as const,
        checked_role_count: checkedPrimaryRoleCount,
        native_import_attested: false as const,
        visual_verdict: "not_evaluated" as const,
      },
    },
    execution_evidence: {
      state: "SOURCE_PLAN_NOT_EXECUTED" as const,
      native_runtime_attested: false as const,
      playback_attested: false as const,
      contact_attested: false as const,
      controller_activation_attested: false as const,
      native_interpolation_post_edits_required: false as const,
    },
  };
}
