/**
 * Read-only eligibility and impact preview for Blockbench's native
 * bake_ik_animation action. Its sampleIK()/rotation correction/Undo logic
 * belongs to Blockbench 5.2.2; do not replace it with numeric interpolation.
 *
 * This source assessment is NOT installed/native verification, a pose sample,
 * an authorization to mutate assets, or a second IK engine.
 */
export const IK_BAKE_MAX_GROUPS = 4096;
export const IK_BAKE_MAX_CONTROLLERS = 64;
export const IK_BAKE_MAX_WORK_UNITS = 16_384;
const MAX_EXAMPLES = 12;

export type IkBakeGroupSnapshot = Readonly<{
  uuid: string;
  parent_uuid: string | null;
  rotation: readonly number[];
  transform_available: boolean;
  native_fix_rotation_available: boolean;
}>;

export type IkBakeControllerSnapshot = Readonly<{
  uuid: string;
  target_uuid: string | null;
  source_uuid: string | null;
  parent_group_uuid: string | null;
  pole_uuid: string | null;
  /** Native target-rotation lock may emit an extra target-bone sample. */
  lock_target_rotation: boolean;
  position_keyframes: number;
  total_keyframes: number;
  /** Ordered UUIDs of all authored IK-controller keys at the inspected state. */
  keyframe_uuids: readonly string[];
  /** Canonical Blockbench Keyframe.getUndoCopy(true) snapshots, no UI mutation. */
  keyframe_undo_copies: readonly unknown[];
}>;

export type NativeIkBakeReadinessInput = Readonly<{
  blockbench_version: string;
  format_id: string;
  animate_mode: boolean;
  selected_clip_uuid: string | null;
  animation_uuid: string;
  duration_seconds: number;
  snapping_fps: number;
  anim_time_update?: string | null;
  blend_weight?: string | null;
  groups: readonly IkBakeGroupSnapshot[];
  locator_uuids: readonly string[];
  controllers: readonly IkBakeControllerSnapshot[];
  /** Required; unknown ArmatureBone inventory is not proof of absence. */
  unsupported_armature_count: number | null;
}>;

function nonEmptyId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= 160 && value === value.trim();
}

function supportedIkBakingVersion(value: string): boolean {
  // The 5.2.2 patch fixed pre-rotated bone IK baking and the associated
  // native Undo keyframe identities. 5.3+ needs its own source review.
  const version = /^5\.2\.(\d+)$/.exec(value);
  return version !== null && Number(version[1]) >= 2;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}


/**
 * Stable, non-cryptographic drift detector for the complete SOURCE inventory.
 * Not authentication, not a solver sample proof, and not user approval.
 * Include pose topology, native IK pole/lock settings, and controller key IDs
 * even when their counts remain unchanged. Both readers use this same owner.
 */
function sourceStateRevision(input: NativeIkBakeReadinessInput): string {
  if (!input || typeof input !== "object") return "invalid";
  const encoded = JSON.stringify([
    input.blockbench_version, input.format_id, input.animate_mode,
    input.selected_clip_uuid, input.animation_uuid,
    input.duration_seconds, input.snapping_fps,
    input.anim_time_update ?? null, input.blend_weight ?? null,
    Array.isArray(input.groups)
      ? input.groups.map((g) => [
          g?.uuid, g?.parent_uuid, g?.rotation,
          g?.transform_available, g?.native_fix_rotation_available,
        ])
      : null,
    Array.isArray(input.locator_uuids) ? input.locator_uuids : null,
    Array.isArray(input.controllers)
      ? input.controllers.map((c) => [
          c?.uuid, c?.target_uuid, c?.source_uuid, c?.parent_group_uuid,
          c?.pole_uuid, c?.lock_target_rotation, c?.position_keyframes,
          c?.total_keyframes, c?.keyframe_uuids, c?.keyframe_undo_copies,
        ])
      : null,
    input.unsupported_armature_count,
  ]);
  let a = 2166136261, b = 0x9e3779b9;
  for (let i = 0; i < encoded.length; i++) {
    const ch = encoded.charCodeAt(i);
    a = Math.imul(a ^ ch, 16777619);
    b = Math.imul(b ^ (ch + (i & 0xff)), 2246822519);
  }
  return "drift-v1:" + encoded.length + ":" +
    (a >>> 0).toString(16).padStart(8, "0") + ":" +
    (b >>> 0).toString(16).padStart(8, "0");
}

export function analyzeNativeIkBakeReadiness(input: NativeIkBakeReadinessInput) {
  const reasons = new Set<string>();
  const fail = (reason: string) => { reasons.add(reason); };
  const basic = {
    kind: "native_ik_bake_source_preflight" as const,
    upstream_action: "bake_ik_animation" as const,
    sample_authority: "BLOCKBENCH_NATIVE_SAMPLE_IK" as const,
    source_baseline: "BLOCKBENCH_5_2_2" as const,
    source_state_revision: sourceStateRevision(input),
    source_revision_kind: "NON_CRYPTOGRAPHIC_DRIFT_DETECTOR_ONLY" as const,
    animation_uuid: input?.animation_uuid ?? null,
    duration_seconds: input?.duration_seconds ?? null,
    snapping_fps: input?.snapping_fps ?? null,
    native_ik_baked: false as const,
    native_undo_verified: false as const,
    native_preview_restored: false as const,
    visual_verdict: "not_evaluated" as const,
  };

  if (!input || !nonEmptyId(input.animation_uuid)) fail("IK_BAKE_CLIP_ID_UNVERIFIED");
  if (input?.format_id !== "bedrock") fail("IK_BAKE_BEDROCK_ENTITY_REQUIRED");
  if (!supportedIkBakingVersion(input?.blockbench_version ?? "")) {
    fail("IK_BAKE_NATIVE_VERSION_REVIEW_REQUIRED");
  }
  if (!input?.animate_mode ||
      input.selected_clip_uuid !== input.animation_uuid) {
    fail("IK_BAKE_SELECTED_ANIMATION_REQUIRED");
  }
  if (!Number.isFinite(input?.duration_seconds) || input.duration_seconds <= 0 ||
      input.duration_seconds > 200) {
    fail("IK_BAKE_DURATION_OUT_OF_NATIVE_RANGE");
  }
  if (Number.isFinite(input?.duration_seconds) &&
      Number.isSafeInteger(input?.snapping_fps) &&
      input.duration_seconds * input.snapping_fps < 1) {
    fail("IK_BAKE_NATIVE_SAMPLE_SPAN_TOO_SHORT");
  }
  if (!Number.isSafeInteger(input?.snapping_fps) ||
      input.snapping_fps < 1 || input.snapping_fps > 144) {
    // Native sampleIK clamps FPS at 144 while the baking action derives
    // keyframe times from animation.snapping; higher values drift apart.
    fail("IK_BAKE_NATIVE_SAMPLING_FPS_MISMATCH");
  }
  if (input.anim_time_update?.trim() || input.blend_weight?.trim()) {
    fail("IK_BAKE_MOLANG_SAMPLING_SEMANTICS_UNVERIFIED");
  }
  if (!Array.isArray(input.groups) || input.groups.length > IK_BAKE_MAX_GROUPS ||
      !Array.isArray(input.controllers) ||
      input.controllers.length > IK_BAKE_MAX_CONTROLLERS ||
      !Array.isArray(input.locator_uuids) ||
      !Number.isSafeInteger(input.unsupported_armature_count) ||
      input.unsupported_armature_count !== 0) {
    fail("IK_BAKE_NATIVE_INVENTORY_INCOMPLETE");
  }

  const groups = Array.isArray(input.groups) ? input.groups.slice(0, IK_BAKE_MAX_GROUPS) : [];
  const controllers = Array.isArray(input.controllers)
    ? input.controllers.slice(0, IK_BAKE_MAX_CONTROLLERS) : [];
  const locators = Array.isArray(input.locator_uuids) ? input.locator_uuids : [];
  const groupIds = groups.map((group) => group?.uuid);
  const controllerIds = controllers.map((controller) => controller?.uuid);
  if (groupIds.some((id) => !nonEmptyId(id)) || !unique(groupIds) ||
      controllerIds.some((id) => !nonEmptyId(id)) || !unique(controllerIds) ||
      locators.some((id) => !nonEmptyId(id)) || !unique(locators) ||
      !unique([...groupIds, ...controllerIds, ...locators])) {
    fail("IK_BAKE_NATIVE_IDENTITY_AMBIGUOUS");
  }
  const groupMap = new Map(groups.map((group) => [group.uuid, group]));
  const poleIds = new Set([...groupIds, ...locators, ...controllerIds]);
  const activeControllers = controllers.filter((controller) =>
    Boolean(controller?.target_uuid) && controller?.position_keyframes > 0
  );
  if (!activeControllers.length) fail("IK_BAKE_NO_KEYED_NATIVE_CONTROLLER");
  // Blockbench's bake_ik_animation removes *all* keyframes on each
  // controller with a resolved IK target, even if that controller did not
  // contribute position samples. This must be surfaced before any native
  // action, or an unsampled rotation/scale/effect track could be deleted.
  for (const controller of controllers) {
    if (!controller || typeof controller !== "object") {
      fail("IK_BAKE_CONTROLLER_KEYFRAME_INVENTORY_INVALID");
      continue;
    }
    if (!Array.isArray(controller.keyframe_uuids) ||
        controller.keyframe_uuids.length !== controller.total_keyframes ||
        controller.keyframe_uuids.some((id) => !nonEmptyId(id)) ||
        !unique(controller.keyframe_uuids)) {
      fail("IK_BAKE_CONTROLLER_KEYFRAME_IDENTITY_INVALID");
    }
    if (!Array.isArray(controller.keyframe_uuids) ||
        !Array.isArray(controller.keyframe_undo_copies) ||
        controller.keyframe_undo_copies.length !== controller.total_keyframes ||
        controller.keyframe_undo_copies.some((row, index) =>
          !row || typeof row !== "object" || Array.isArray(row) ||
          (row as { uuid?: unknown }).uuid !== controller.keyframe_uuids[index]
        )) {
      fail("IK_BAKE_CONTROLLER_KEYFRAME_SOURCE_UNVERIFIED");
    }
    if (!controller.target_uuid) continue;
    if (typeof controller.lock_target_rotation !== "boolean") {
      fail("IK_BAKE_TARGET_ROTATION_LOCK_UNVERIFIED");
    }
    if (!Number.isSafeInteger(controller.position_keyframes) ||
        !Number.isSafeInteger(controller.total_keyframes) ||
        controller.position_keyframes < 0 ||
        controller.total_keyframes < controller.position_keyframes) {
      fail("IK_BAKE_CONTROLLER_KEYFRAME_INVENTORY_INVALID");
    } else if (controller.position_keyframes === 0 &&
               controller.total_keyframes > 0) {
      fail("IK_BAKE_UNSAMPLED_CONTROLLER_KEYS_AT_RISK");
    }
  }

  const affected = new Set<string>();
  const chainExamples: Array<{
    controller_uuid: string;
    target_uuid: string;
    source_uuid: string;
    affected_group_uuids: string[];
    pre_rotated_group_count: number;
  }> = [];
  let estimatedNativeWork = 0;
  let expectedControllerKeysRemoved = 0;
  let affectedPreRotatedGroups = 0;

  const frames = Number.isFinite(input.duration_seconds) &&
    input.duration_seconds > 0 && Number.isSafeInteger(input.snapping_fps) &&
    input.snapping_fps >= 1 && input.snapping_fps <= 144
    ? Math.ceil(input.duration_seconds * input.snapping_fps) + 1 : 0;

  for (const controller of activeControllers) {
    if (!nonEmptyId(controller.uuid) || !nonEmptyId(controller.target_uuid) ||
        !Number.isSafeInteger(controller.position_keyframes) ||
        !Number.isSafeInteger(controller.total_keyframes) ||
        controller.position_keyframes < 1 ||
        controller.total_keyframes < controller.position_keyframes) {
      fail("IK_BAKE_CONTROLLER_KEYFRAME_INVENTORY_INVALID");
      continue;
    }
    const sourceId = controller.source_uuid || controller.parent_group_uuid;
    if (!nonEmptyId(sourceId)) {
      fail("IK_BAKE_IK_SOURCE_UNRESOLVED");
      continue;
    }
    const target = groupMap.get(controller.target_uuid);
    const source = groupMap.get(sourceId);
    if (!target || !source) {
      fail("IK_BAKE_CHAIN_TARGET_OR_SOURCE_UNRESOLVED");
      continue;
    }
    if (controller.pole_uuid &&
        (!poleIds.has(controller.pole_uuid) ||
          controller.pole_uuid === controller.uuid ||
          controller.pole_uuid === controller.target_uuid)) {
      fail("IK_BAKE_POLE_UNRESOLVED_OR_DEGENERATE");
    }
    const chain: IkBakeGroupSnapshot[] = [];
    const visited = new Set<string>();
    let current: IkBakeGroupSnapshot | undefined = target;
    while (current && !visited.has(current.uuid) &&
           chain.length <= IK_BAKE_MAX_GROUPS) {
      visited.add(current.uuid);
      chain.push(current);
      if (current.uuid === source.uuid) break;
      current = current.parent_uuid ? groupMap.get(current.parent_uuid) : undefined;
    }
    if (!current || current.uuid !== source.uuid || chain.length < 2) {
      fail("IK_BAKE_CHAIN_NOT_ANCESTOR");
      continue;
    }
    // sampleIK() excludes the implicit source from its fitted bones but
    // includes an explicit ik_source. A one-bone chain cannot generate
    // rotation keyframes through its bone-references loop.
    const fitted = controller.source_uuid ? chain : chain.slice(0, -1);
    if (fitted.length < 2) {
      fail("IK_BAKE_CHAIN_HAS_NO_ROTATION_REFERENCE");
      continue;
    }
    // Blockbench displayIK() reverses the source->target chain and emits a
    // rotation for every bone EXCEPT its final target. With an explicit
    // ik_source, that source is included; with an implicit parent, it is not.
    // The target receives its own rotation sample only when native
    // lock_ik_target_rotation is explicitly enabled.
    const emitted = fitted.slice(1);
    if (controller.lock_target_rotation === true) emitted.push(target);
    const invalid = emitted.some((group) =>
      !Array.isArray(group.rotation) || group.rotation.length !== 3 ||
      !group.rotation.every((v) => Number.isFinite(v)) ||
      !group.transform_available ||
      (group.rotation.some((v) => Math.abs(v) > 1e-6) &&
        !group.native_fix_rotation_available)
    );
    if (invalid) {
      fail("IK_BAKE_PRE_ROTATION_OR_TRANSFORM_UNVERIFIED");
      continue;
    }
    if (emitted.some((group) => affected.has(group.uuid))) {
      fail("IK_BAKE_OVERLAPPING_CHAINS_UNVERIFIED");
      continue;
    }
    for (const group of emitted) affected.add(group.uuid);
    const rotated = emitted.filter((group) =>
      group.rotation.some((v) => Math.abs(v) > 1e-6)
    ).length;
    affectedPreRotatedGroups += rotated;
    const units = frames * emitted.length;
    estimatedNativeWork += units;
    expectedControllerKeysRemoved += controller.total_keyframes;
    if (chainExamples.length < MAX_EXAMPLES) {
      chainExamples.push({
        controller_uuid: controller.uuid,
        target_uuid: target.uuid,
        source_uuid: source.uuid,
        affected_group_uuids: emitted.map((group) => group.uuid).slice(0, 24),
        pre_rotated_group_count: rotated,
      });
    }
  }
  if (!Number.isSafeInteger(estimatedNativeWork) ||
      estimatedNativeWork > IK_BAKE_MAX_WORK_UNITS) {
    fail("IK_BAKE_NATIVE_SAMPLING_BUDGET_EXCEEDED");
  }
  return {
    ...basic,
    state: reasons.size ? ("blocked" as const) : ("candidate_source_only" as const),
    blocking_reasons: [...reasons].sort(),
    active_controller_count: activeControllers.length,
    evaluated_chain_count: chainExamples.length,
    estimated_native_frame_count: frames,
    estimated_native_work_units: estimatedNativeWork,
    native_work_unit_limit: IK_BAKE_MAX_WORK_UNITS,
    expected_controller_keyframes_removed: expectedControllerKeysRemoved,
    affected_group_count: affected.size,
    /** Exact expected sample keys for a future native sample validator. */
    expected_sampled_group_uuids: [...affected].sort(),
    pre_rotated_group_count: affectedPreRotatedGroups,
    examples: chainExamples,
    examples_truncated: affected.size > 24 || activeControllers.length > MAX_EXAMPLES,
    note:
      "Source-only eligibility and estimated mutation impact. No IK pose samples, " +
      "no keyframes removed/created, and no native Undo, restoration, preview or " +
      "Bedrock export validation. The native action must be separately validated " +
      "on a matching Blockbench build; numeric batch bake is not a substitute.",
  };
}
