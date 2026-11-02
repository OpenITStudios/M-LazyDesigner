import {
  compileMotionRecipe,
  type CompiledMotionRecipe,
  type MotionChannel,
  type MotionRecipe,
} from "@/lib/animation/motionRecipe";
import { compileSecondaryMotion, type SecondaryMotionLink } from "@/lib/animation/secondaryMotion";
import { applyContactConstraints, type ContactConstraint } from "@/lib/animation/contactConstraints";
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
