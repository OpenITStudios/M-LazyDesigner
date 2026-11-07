import { createHash } from "node:crypto";
import {
  planBedrockAttachableBinding,
  type AttachableBindingInput,
  type AttachableBindingReview,
} from "./attachableBinding";

/**
 * A2 pure preview-evidence planner. The existing capture_model_views tool
 * renders an isolated model, not a holder + equipment composite. This module
 * never claims it can synthesize a native holder scene or camera pose.
 * Runtime/visual capture remains owned by the existing Blockbench camera.
 */
export const ATTACHABLE_CONTEXT_VIEWS = [
  "FIRST_PERSON",
  "THIRD_PERSON_FRONT",
  "THIRD_PERSON_SIDE",
] as const;

export type AttachableContextView = typeof ATTACHABLE_CONTEXT_VIEWS[number];
type PreviewDependency = {
  /** Exact expected source identity, caller-supplied until native observed. */
  asset_fingerprint: string;
  holder_fingerprint: string;
  holder_pose_fingerprint: string;
  runtime_build_fingerprint: string;
  reference_image_fingerprint: string;
  /** Explicit pose reference, never a guessed animation or head rotation. */
  holder_pose_label: string;
};

export type AttachableContextPreviewInput = {
  binding: AttachableBindingInput;
  expected: PreviewDependency;
};
export type AttachableContextPreviewPlan = {
  state: "SOURCE_PLAN_WAITING_FOR_NATIVE_HOLDER_CAPTURE";
  plan_id: string;
  project_uuid: string;
  attachable_identifier: string;
  item_identifier: string;
  geometry_identifier: string;
  holder_entity_identifier: string;
  target_model_bone_uuid: string;
  binding_strategy: AttachableBindingReview["binding_strategy"];
  item_slot: "main_hand" | "off_hand" | null;
  expected: PreviewDependency;
  required_views: readonly AttachableContextView[];
  /** These are distinct from native model-only orthographic camera views. */
  capture_route: "NATIVE_HOLDER_COMPOSITE_REQUIRED";
  existing_capture_route: "capture_model_views";
  review_gates: readonly (
    | "NATIVE_HOLDER_POSE_UNVERIFIED"
    | "FIRST_PERSON_AND_THIRD_PERSON_ALIGNMENT_UNVERIFIED"
    | "HAND_GRIP_AND_CLIPPING_UNVERIFIED"
    | "DIRECT_BONE_HOLDER_RIG_REVIEW_REQUIRED"
    | "WEARABLE_NON_HAND_FIT_NOT_COVERED"
    | "RESOURCE_BINDINGS_NOT_COMPILED"
  )[];
  native_verified: false;
  visual_verified: false;
  minecraft_verified: false;
};

export type AttachableContextCaptureClaim = {
  perspective: AttachableContextView;
  image_sha256: string;
  /** Opaque ID returned by a future native holder-composite capture. */
  evidence_handle: string;
};
export type AttachableContextCaptureEvidence = {
  plan_id: string;
  project_uuid: string;
  attachable_identifier: string;
  holder_entity_identifier: string;
  geometry_identifier: string;
  target_model_bone_uuid: string;
  item_slot: "main_hand" | "off_hand" | null;
  expected: PreviewDependency;
  captures: readonly AttachableContextCaptureClaim[];
};
export type AttachableContextCaptureReview = {
  state:
    | "CAPTURE_NOT_PROVIDED"
    | "STALE_CAPTURE_SOURCE"
    | "CAPTURE_SET_INCOMPLETE"
    | "CLAIMS_READY_FOR_HUMAN_VISUAL_REVIEW";
  missing_views: AttachableContextView[];
  reason: "SOURCE_IDENTITY_CHANGED" | null;
  duplicate_pixel_views: AttachableContextView[];
  /** Identical hashes are possible for symmetric views, not automatic PASS. */
  review_gates: readonly (
    | "CALLER_CAPTURE_NOT_NATIVELY_ATTESTED"
    | "VISUAL_ALIGNMENT_REVIEW_REQUIRED"
    | "CLIPPING_REVIEW_REQUIRED"
    | "DIRECT_BONE_RIG_REVIEW_REQUIRED"
    | "SAME_IMAGE_BYTES_REQUIRE_INDEPENDENT_REVIEW"
  )[];
  native_verified: false;
  visual_verified: false;
  minecraft_verified: false;
};

const SHA = /^sha256:[a-f0-9]{64}$/;
const MAX_LABEL = 128;
function exactString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value ||
      value.length > MAX_LABEL || value.trim() !== value) {
    throw new Error("ATTACHABLE_CONTEXT_SOURCE_INVALID: " + label);
  }
  return value;
}
function requireFingerprint(value: unknown, label: string): string {
  const fingerprint = exactString(value, label);
  if (!SHA.test(fingerprint)) {
    throw new Error("ATTACHABLE_CONTEXT_FINGERPRINT_INVALID: " + label);
  }
  return fingerprint;
}
function validateDependencies(input: PreviewDependency): PreviewDependency {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("ATTACHABLE_CONTEXT_SOURCE_INVALID: expected");
  }
  return {
    asset_fingerprint: requireFingerprint(input.asset_fingerprint, "asset"),
    holder_fingerprint: requireFingerprint(input.holder_fingerprint, "holder"),
    holder_pose_fingerprint: requireFingerprint(input.holder_pose_fingerprint, "pose"),
    runtime_build_fingerprint: requireFingerprint(input.runtime_build_fingerprint, "build"),
    reference_image_fingerprint: requireFingerprint(
      input.reference_image_fingerprint, "reference"
    ),
    holder_pose_label: exactString(input.holder_pose_label, "holder_pose_label"),
  };
}

/** Recompute the A1 source guard; do not trust a caller-provided A1 receipt. */
export function planBedrockAttachableContextPreview(
  input: AttachableContextPreviewInput
): AttachableContextPreviewPlan {
  if (!input || typeof input !== "object" || !input.binding) {
    throw new Error("ATTACHABLE_CONTEXT_INPUT_INVALID");
  }
  const binding = planBedrockAttachableBinding(input.binding);
  const expected = validateDependencies(input.expected);
  const itemSlot = binding.preview_slot;
  // A1 has already validated identifiers, uniqueness, bone ancestry and the
  // holder inventory. Preserve every material source identity while making
  // order-insensitive inventories and object key order hash identically.
  const canonicalSource = {
    project_uuid: binding.project_uuid,
    attachable_identifier: binding.attachable_identifier,
    item_identifier: binding.item_identifier,
    explicit_item_mapping_required: binding.explicit_item_mapping_required,
    geometry_identifier: binding.geometry_identifier,
    target_model_bone_uuid: binding.selected_model_bone.uuid,
    model_bones: input.binding.model_bones
      .map(bone => [bone.uuid, bone.name, bone.parent_uuid] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
    holder_entity_identifier: binding.holder_entity_identifier,
    holder_bone_names: [...input.binding.holder.bone_names].sort(),
    binding_strategy: binding.binding_strategy,
    target_holder_bone: input.binding.binding.strategy === "DIRECT_BONE"
      ? input.binding.binding.holder_bone_name : null,
    item_slot: itemSlot,
    source_refs: [...input.binding.source_refs].sort(),
  };
  // Version bump deliberately invalidates pre-canonicalization source claims.
  const plan_id = "attachable-context:" + createHash("sha256")
    .update(JSON.stringify([
      "attachable-context-a2-v2",
      canonicalSource,
      binding,
      expected,
      ATTACHABLE_CONTEXT_VIEWS,
    ]))
    .digest("hex");

  return {
    state: "SOURCE_PLAN_WAITING_FOR_NATIVE_HOLDER_CAPTURE",
    plan_id,
    project_uuid: binding.project_uuid,
    attachable_identifier: binding.attachable_identifier,
    item_identifier: binding.item_identifier,
    geometry_identifier: binding.geometry_identifier,
    holder_entity_identifier: binding.holder_entity_identifier,
    target_model_bone_uuid: binding.selected_model_bone.uuid,
    binding_strategy: binding.binding_strategy,
    item_slot: itemSlot,
    expected,
    required_views: [...ATTACHABLE_CONTEXT_VIEWS],
    capture_route: "NATIVE_HOLDER_COMPOSITE_REQUIRED",
    existing_capture_route: "capture_model_views",
    review_gates: [
      "NATIVE_HOLDER_POSE_UNVERIFIED",
      "FIRST_PERSON_AND_THIRD_PERSON_ALIGNMENT_UNVERIFIED",
      "HAND_GRIP_AND_CLIPPING_UNVERIFIED",
      ...(binding.binding_strategy === "DIRECT_BONE"
        ? ["DIRECT_BONE_HOLDER_RIG_REVIEW_REQUIRED" as const] : []),
      "WEARABLE_NON_HAND_FIT_NOT_COVERED",
      "RESOURCE_BINDINGS_NOT_COMPILED",
    ],
    native_verified: false,
    visual_verified: false,
    minecraft_verified: false,
  };
}

/**
 * Pure capture-claim cross-check. Comparing reported hashes/handles can
 * detect stale or missing evidence, NOT authenticate live editor capture,
 * prove that a holder was rendered, inspect pixels, or pass Minecraft QA.
 */
export function reviewBedrockAttachableContextCapture(
  input: AttachableContextPreviewInput,
  evidence: AttachableContextCaptureEvidence | null
): AttachableContextCaptureReview {
  const plan = planBedrockAttachableContextPreview(input);
  const pending = [
    "CALLER_CAPTURE_NOT_NATIVELY_ATTESTED",
    "VISUAL_ALIGNMENT_REVIEW_REQUIRED",
    "CLIPPING_REVIEW_REQUIRED",
    ...(plan.binding_strategy === "DIRECT_BONE"
      ? ["DIRECT_BONE_RIG_REVIEW_REQUIRED" as const] : []),
  ] as AttachableContextCaptureReview["review_gates"][number][];
  const result = (
    state: AttachableContextCaptureReview["state"],
    missing_views: AttachableContextView[],
    reason: AttachableContextCaptureReview["reason"],
    duplicate_pixel_views: AttachableContextView[] = []
  ): AttachableContextCaptureReview => ({
    state, missing_views, reason, duplicate_pixel_views,
    review_gates: [
      ...pending,
      ...(duplicate_pixel_views.length
        ? ["SAME_IMAGE_BYTES_REQUIRE_INDEPENDENT_REVIEW" as const] : []),
    ],
    native_verified: false, visual_verified: false, minecraft_verified: false,
  });
  if (evidence === null) {
    return result("CAPTURE_NOT_PROVIDED", [...plan.required_views], null);
  }
  if (!evidence || typeof evidence !== "object" ||
      !Array.isArray(evidence.captures) ||
      evidence.captures.length > plan.required_views.length) {
    throw new Error("ATTACHABLE_CONTEXT_CAPTURE_CLAIM_INVALID");
  }
  const claimed = validateDependencies(evidence.expected);
  const stale =
    evidence.plan_id !== plan.plan_id ||
    evidence.project_uuid !== plan.project_uuid ||
    evidence.attachable_identifier !== plan.attachable_identifier ||
    evidence.holder_entity_identifier !== plan.holder_entity_identifier ||
    evidence.geometry_identifier !== plan.geometry_identifier ||
    evidence.target_model_bone_uuid !== plan.target_model_bone_uuid ||
    evidence.item_slot !== plan.item_slot ||
    (Object.keys(plan.expected) as Array<keyof PreviewDependency>)
      .some(key => plan.expected[key] !== claimed[key]);
  if (stale) {
    return result("STALE_CAPTURE_SOURCE", [...plan.required_views],
      "SOURCE_IDENTITY_CHANGED");
  }
  const captured = new Set<AttachableContextView>();
  const hashToView = new Map<string, AttachableContextView>();
  const duplicates: AttachableContextView[] = [];
  for (const entry of evidence.captures) {
    if (!entry || typeof entry !== "object" ||
        !ATTACHABLE_CONTEXT_VIEWS.includes(entry.perspective) ||
        captured.has(entry.perspective)) {
      throw new Error("ATTACHABLE_CONTEXT_CAPTURE_VIEW_INVALID_OR_DUPLICATE");
    }
    captured.add(entry.perspective);
    requireFingerprint(entry.image_sha256, "capture_image");
    exactString(entry.evidence_handle, "capture_handle");
    if (hashToView.has(entry.image_sha256)) duplicates.push(entry.perspective);
    hashToView.set(entry.image_sha256, entry.perspective);
  }
  const missing = plan.required_views.filter(view => !captured.has(view));
  return result(missing.length
    ? "CAPTURE_SET_INCOMPLETE"
    : "CLAIMS_READY_FOR_HUMAN_VISUAL_REVIEW",
    missing, null, duplicates);
}
