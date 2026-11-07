import {
  ASSET_OUTPUT_CONTRACTS,
  type AssetOutputPlan,
  type AssetOutputRequirement,
} from "../product/assetOutputContracts";
import { getAssetProfileContract } from "../product/assetProfiles";
import { isVerifiedParticleWriteReceipt } from "./particleMutation";

/**
 * Source-only bridge between existing native structuredContent receipts and
 * the canonical Asset Output Plan. It never authenticates its caller, reads
 * filesystem bytes, persists receipts, or grants Finalization/visual PASS.
 */
export type AssetOutputReceiptObservation = Readonly<{
  deliverable_id: string;
  capability: string;
  /** Exact structuredContent from a real invocation, NOT content.text. */
  structured_content: unknown;
}>;

export type AssetOutputReceiptState =
  | "NOT_OBSERVED"
  | "NATIVE_ROUTE_UNAVAILABLE"
  | "RECEIPT_REJECTED"
  | "COMPILE_ONLY_REPORTED"
  | "WRITE_SIZE_ONLY_REPORTED"
  | "FILE_READBACK_REPORTED"
  | "PARTICLE_WRITE_REPORTED";

export type AssetOutputReceiptRow = Readonly<{
  deliverable_id: string;
  expected_evidence_class: AssetOutputRequirement["evidence_class"];
  state: AssetOutputReceiptState;
  reason: string;
  /** This review cannot authenticate a supplied structuredContent payload. */
  receipt_provenance: "CALLER_SUPPLIED_NOT_AUTHENTICATED";
  current_asset_revision_verified: false;
  visual_approved: false;
  finalization_approved: false;
}>;

export type AssetOutputReceiptReview = Readonly<{
  state: "RECEIPT_REVIEW_ONLY";
  asset_profile_id: AssetOutputPlan["asset_profile_id"];
  output_contract: AssetOutputPlan["output_contract"];
  rows: readonly AssetOutputReceiptRow[];
  unresolved_conditionals: readonly string[];
  finalization_ready: false;
  source_revision_verified: false;
  minecraft_verified: false;
}>;

type NativeRoute =
  | { capability: "export_model"; codec: "project" | "bedrock" | "bedrock_animation" }
  | { capability: "manage_particle" };

function routeForDeliverable(id: string): NativeRoute | null {
  switch (id) {
    case "editable_bbmodel": return { capability: "export_model", codec: "project" };
    case "entity_geometry_json": return { capability: "export_model", codec: "bedrock" };
    case "entity_animation_json": return { capability: "export_model", codec: "bedrock_animation" };
    case "particle_definition_json": return { capability: "manage_particle" };
    default: return null;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/;
function sha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function result(state: AssetOutputReceiptState, reason: string) {
  return { state, reason };
}

function reviewExportReceipt(
  codecId: "project" | "bedrock" | "bedrock_animation",
  value: unknown,
  expectedProjectUuid: string | undefined
): { state: AssetOutputReceiptState; reason: string } {
  const receipt = object(value);
  const project = object(receipt?.project);
  const codec = object(receipt?.codec);
  if (!receipt || receipt.project_format !== "bedrock" ||
      codec?.id !== codecId || !project ||
      !expectedProjectUuid || project.uuid !== expectedProjectUuid) {
    return result("RECEIPT_REJECTED", "EXPORT_PROJECT_OR_CODEC_IDENTITY_UNVERIFIED");
  }
  if (!Number.isSafeInteger(receipt.byte_length) ||
      (receipt.byte_length as number) <= 0 ||
      !sha256(receipt.compiled_payload_sha256) ||
      receipt.compiled_payload_sha256_scope !== "NATIVE_CODEC_OUTPUT_BYTES") {
    return result("RECEIPT_REJECTED", "EXPORT_COMPILED_BYTES_UNVERIFIED");
  }
  if (codecId === "bedrock") {
    const identity = object(receipt.geometry_export_identity);
    if (identity?.state !== "COMPILED_GEOMETRY_IDENTITIES_VALIDATED" ||
        !Number.isSafeInteger(identity.geometry_count) ||
        (identity.geometry_count as number) < 1) {
      return result("RECEIPT_REJECTED", "EXPORT_GEOMETRY_IDENTITY_UNVERIFIED");
    }
  } else if (codecId === "bedrock_animation") {
    const identity = object(receipt.animation_export_identity);
    if (identity?.state !== "SOURCE_CLIP_IDENTITIES_MATCHED" ||
        !Number.isSafeInteger(identity.source_clip_count) ||
        (identity.source_clip_count as number) < 1 ||
        identity.compiled_clip_count !== identity.source_clip_count) {
      return result("RECEIPT_REJECTED", "EXPORT_ANIMATION_IDENTITY_UNVERIFIED");
    }
  }

  // Existing AnimationCodec output is content-only. A compiled animation
  // cannot satisfy the requested separate exported animation FILE.
  if (codecId === "bedrock_animation") {
    return receipt.save_behavior === "COMPILE_ONLY" &&
        receipt.wrote_to_path === null &&
        receipt.file_integrity_state === "NOT_WRITTEN" &&
        receipt.truncated === false &&
        typeof receipt.content === "string" && receipt.content.length > 0
      ? result("COMPILE_ONLY_REPORTED", "ANIMATION_FILE_PERSISTENCE_REQUIRED")
      : result("RECEIPT_REJECTED", "ANIMATION_COMPILE_CONTENT_INCOMPLETE");
  }

  if (receipt.wrote_to_path === null) {
    return receipt.save_behavior === "COMPILE_ONLY" &&
        receipt.file_integrity_state === "NOT_WRITTEN" &&
        receipt.truncated === false &&
        typeof receipt.content === "string" && receipt.content.length > 0
      ? result("COMPILE_ONLY_REPORTED", "OUTPUT_FILE_NOT_WRITTEN")
      : result("RECEIPT_REJECTED", "EXPORT_COMPILE_CONTENT_INCOMPLETE");
  }

  const path = receipt.wrote_to_path;
  const projectSaved = project.saved === true;
  const lifecycleMatches = codecId === "project"
    ? (receipt.save_behavior === "NATIVE_PROJECT_SAVE" ||
        receipt.save_behavior === "NATIVE_PROJECT_SAVE_AS") &&
      typeof path === "string" && /\.bbmodel$/i.test(path) &&
      project.save_path === path && projectSaved
    : receipt.save_behavior === "NATIVE_BEDROCK_EXPORT" &&
      typeof path === "string" && /\.json$/i.test(path) &&
      project.export_path === path &&
      project.export_codec === "bedrock" && projectSaved;
  if (!lifecycleMatches) {
    return result("RECEIPT_REJECTED", "EXPORT_WRITTEN_PATH_OR_LIFECYCLE_UNVERIFIED");
  }

  if (receipt.file_integrity_state === "SIZE_ONLY" &&
      receipt.written_file_sha256 === null) {
    return result("WRITE_SIZE_ONLY_REPORTED", "FILE_BYTES_NOT_READ_BACK");
  }
  if (receipt.file_integrity_state === "READBACK_MATCHED" &&
      sha256(receipt.written_file_sha256) &&
      receipt.written_file_sha256 === receipt.compiled_payload_sha256) {
    return result("FILE_READBACK_REPORTED", "CURRENT_SOURCE_REVISION_AND_APPROVAL_UNVERIFIED");
  }
  return result("RECEIPT_REJECTED", "EXPORT_FILE_READBACK_UNVERIFIED");
}

function assertPlanIdentity(plan: AssetOutputPlan): void {
  const profile = getAssetProfileContract(plan.asset_profile_id);
  if (plan.output_contract !== profile.output_contract ||
      !Array.isArray(plan.deliverables)) {
    throw new Error("ASSET_OUTPUT_RECEIPT_PLAN_IDENTITY_INVALID");
  }
  const canonical: readonly AssetOutputRequirement[] =
    ASSET_OUTPUT_CONTRACTS[profile.output_contract];
  const byId = new Map(canonical.map((entry) => [entry.id, entry] as const));
  const seen = new Set<string>();
  for (const entry of plan.deliverables) {
    const expected = byId.get(entry.id);
    if (!expected || seen.has(entry.id) ||
        expected.trigger !== entry.trigger ||
        expected.delivery_kind !== entry.delivery_kind ||
        expected.evidence_class !== entry.evidence_class) {
      throw new Error("ASSET_OUTPUT_RECEIPT_PLAN_DELIVERABLE_INVALID");
    }
    seen.add(entry.id);
  }
  if (canonical.some((entry) => entry.trigger === "REQUIRED" && !seen.has(entry.id))) {
    throw new Error("ASSET_OUTPUT_RECEIPT_PLAN_REQUIRED_MISSING");
  }
  if (!Array.isArray(plan.unresolved_conditionals) ||
      plan.native_verified !== false || plan.files_written !== false ||
      plan.minecraft_verified !== false) {
    throw new Error("ASSET_OUTPUT_RECEIPT_PLAN_STATE_INVALID");
  }
  const unresolved = new Set<string>();
  for (const id of plan.unresolved_conditionals) {
    const entry = byId.get(id);
    if (!entry || entry.trigger !== "WHEN_REFERENCED" ||
        seen.has(id) || unresolved.has(id)) {
      throw new Error("ASSET_OUTPUT_RECEIPT_PLAN_CONDITIONAL_INVALID");
    }
    unresolved.add(id);
  }
  if ((unresolved.size > 0) !==
      (plan.state === "CONDITIONAL_REFERENCE_UNRESOLVED")) {
    throw new Error("ASSET_OUTPUT_RECEIPT_PLAN_STATE_INVALID");
  }
}

/**
 * Match observed native receipts to *planned* deliverables only.
 * The existing Runtime owns all actual writes. Receipts are caller-supplied
 * observations; structural consistency is not authenticity, freshness or PASS.
 */
export function reviewAssetOutputReceipts(input: {
  plan: AssetOutputPlan;
  expected_project_uuid?: string;
  observations: readonly AssetOutputReceiptObservation[];
}): AssetOutputReceiptReview {
  assertPlanIdentity(input.plan);
  if (!Array.isArray(input.observations)) {
    throw new Error("ASSET_OUTPUT_RECEIPT_OBSERVATIONS_INVALID");
  }
  const planned = new Set(input.plan.deliverables.map((entry) => entry.id));
  const byId = new Map<string, AssetOutputReceiptObservation>();
  for (const observation of input.observations) {
    if (!observation || typeof observation.deliverable_id !== "string" ||
        !planned.has(observation.deliverable_id)) {
      throw new Error("ASSET_OUTPUT_RECEIPT_UNPLANNED_OBSERVATION");
    }
    if (byId.has(observation.deliverable_id)) {
      throw new Error("ASSET_OUTPUT_RECEIPT_DUPLICATE_OBSERVATION");
    }
    byId.set(observation.deliverable_id, observation);
  }

  const rows = input.plan.deliverables.map((entry): AssetOutputReceiptRow => {
    const route = routeForDeliverable(entry.id);
    const observed = byId.get(entry.id);
    let evidence: { state: AssetOutputReceiptState; reason: string };
    if (!route) {
      evidence = result("NATIVE_ROUTE_UNAVAILABLE", "OUTPUT_ADAPTER_NOT_REGISTERED");
    } else if (!observed) {
      evidence = result("NOT_OBSERVED", "NO_NATIVE_RECEIPT_SUPPLIED");
    } else if (observed.capability !== route.capability) {
      evidence = result("RECEIPT_REJECTED", "RECEIPT_WRONG_NATIVE_CAPABILITY");
    } else if (route.capability === "export_model") {
      evidence = reviewExportReceipt(
        route.codec, observed.structured_content, input.expected_project_uuid
      );
    } else {
      evidence = isVerifiedParticleWriteReceipt(observed.structured_content)
        ? result("PARTICLE_WRITE_REPORTED", "PARTICLE_BYTES_READBACK_AND_CURRENT_REVISION_UNVERIFIED")
        : result("RECEIPT_REJECTED", "PARTICLE_WRITE_RECEIPT_UNVERIFIED");
    }

    return {
      deliverable_id: entry.id,
      expected_evidence_class: entry.evidence_class,
      ...evidence,
      receipt_provenance: "CALLER_SUPPLIED_NOT_AUTHENTICATED",
      current_asset_revision_verified: false,
      visual_approved: false,
      finalization_approved: false,
    };
  });

  return {
    state: "RECEIPT_REVIEW_ONLY",
    asset_profile_id: input.plan.asset_profile_id,
    output_contract: input.plan.output_contract,
    rows,
    unresolved_conditionals: input.plan.unresolved_conditionals,
    finalization_ready: false,
    source_revision_verified: false,
    minecraft_verified: false,
  };
}
