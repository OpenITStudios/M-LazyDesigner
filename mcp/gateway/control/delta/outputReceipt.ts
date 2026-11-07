import {
  planAssetOutputRequirements,
  type AssetOutputPlan,
} from "../../../lib/product/assetOutputContracts";
import {
  reviewAssetOutputReceipts,
  type AssetOutputReceiptState,
} from "../../../lib/receipts/assetOutput";

/**
 * A call-local Control consumer of the existing native receipt owner.
 * This does not read the filesystem, verify a current source revision,
 * retain receipt history, or change the Gateway response contract.
 */
export type NativeOutputReceiptDecision = Readonly<{
  deliverable_id: string;
  receipt_state: AssetOutputReceiptState;
  verification_class: "receipt_only" | "focused_read";
  next_intent: string;
}>;

/**
 * Only source-proven Runtime invocation results with Backend-verified project
 * affinity can sharpen output verification. Session facts, a local provider,
 * an unbound tab, or a caller-supplied result alone are insufficient.
 */
export function assessNativeOutputInvocation(input: {
  capability: string;
  arguments?: Readonly<Record<string, unknown>>;
  succeeded: boolean;
  native_invocation_verified: boolean;
  verified_project_uuid: string | null;
  structured_content?: unknown;
}): NativeOutputReceiptDecision | null {
  if (!input.succeeded || !input.native_invocation_verified ||
      typeof input.verified_project_uuid !== "string" ||
      input.verified_project_uuid.trim().length === 0) return null;

  let plan: AssetOutputPlan;
  let id: string;
  if (input.capability === "export_model") {
    // The existing native export schema defaults omitted codec_id to bedrock.
    const codec = input.arguments?.codec_id ?? "bedrock";
    if (codec === "project") {
      id = "editable_bbmodel";
      plan = planAssetOutputRequirements({ asset_profile_id: "entity" });
    } else if (codec === "bedrock") {
      id = "entity_geometry_json";
      plan = planAssetOutputRequirements({
        asset_profile_id: "entity", requested: [id],
      });
    } else if (codec === "bedrock_animation") {
      id = "entity_animation_json";
      plan = planAssetOutputRequirements({
        asset_profile_id: "entity", requested: [id],
      });
    } else {
      // Let Runtime's existing schema own unexpected codec branches.
      return null;
    }
  } else if (input.capability === "manage_particle") {
    id = "particle_definition_json";
    plan = planAssetOutputRequirements({ asset_profile_id: "particle" });
  } else {
    return null;
  }

  const review = reviewAssetOutputReceipts({
    plan,
    expected_project_uuid: input.verified_project_uuid,
    observations: [{
      deliverable_id: id,
      capability: input.capability,
      structured_content: input.structured_content,
    }],
  });
  const row = review.rows.find((entry) => entry.deliverable_id === id);
  if (!row) return null;

  switch (row.state) {
    case "FILE_READBACK_REPORTED":
      return {
        deliverable_id: id, receipt_state: row.state,
        verification_class: "receipt_only",
        next_intent: "VERIFY_REQUESTED_OUTPUT_SET_AND_APPROVALS",
      };
    case "PARTICLE_WRITE_REPORTED":
      return {
        deliverable_id: id, receipt_state: row.state,
        verification_class: "receipt_only",
        next_intent: "REVIEW_PARTICLE_RESOURCE_DEPENDENCIES",
      };
    case "COMPILE_ONLY_REPORTED":
      return {
        deliverable_id: id, receipt_state: row.state,
        verification_class: "focused_read",
        next_intent: id === "entity_animation_json"
          ? "REVIEW_COMPILED_ANIMATION_OR_PERSIST_IF_REQUESTED"
          : "REVIEW_COMPILED_OUTPUT_OR_PERSIST_IF_REQUESTED",
      };
    case "WRITE_SIZE_ONLY_REPORTED":
      return {
        deliverable_id: id, receipt_state: row.state,
        verification_class: "focused_read",
        next_intent: "VERIFY_EXPORTED_FILE_READBACK",
      };
    default:
      // An uncertain write may already have occurred. Do not automatically
      // retry/rollback; inspect actual output and current native lifecycle.
      return {
        deliverable_id: id, receipt_state: row.state,
        verification_class: "focused_read",
        next_intent: "INSPECT_OUTPUT_WRITE_OUTCOME_BEFORE_RETRY",
      };
  }
}
