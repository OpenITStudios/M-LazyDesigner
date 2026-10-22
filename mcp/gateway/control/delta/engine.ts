import {
  authoringDomainForCapability,
  sourceOwnerForCapability,
} from "../../development/sourceOwners";
import type { ControlDelta } from "../types";
import type { BlockitAuthoringPhaseAffinity } from "../../../lib/runtime/affinity";
import type { CapabilityBranchHint } from "../../capabilities/types";
import {
  analyzeMutationEvidence,
  authoritativeRevisionEvidence,
  mutationFreshness,
  mutationInvalidation,
} from "./freshness";
import {
  verificationClassForResult,
  verificationScopeForResult,
} from "./verification";
import { resultCandidates } from "./receipts";
import { downstreamRechecksForFreshness } from "./recheck";

export function buildControlDelta(input: {
  capability: string;
  branch?: CapabilityBranchHint;
  phaseBefore: BlockitAuthoringPhaseAffinity | null;
  phaseAfter: BlockitAuthoringPhaseAffinity | null;
  projectUuid: string | null;
  succeeded: boolean;
  result?: unknown;
}): ControlDelta {
  const changed: string[] = [];
  if (input.succeeded && input.phaseBefore !== input.phaseAfter) changed.push("authoring_phase");
  if (input.capability === "create_project" && input.succeeded) changed.push("project_affinity");
  if (input.capability === "export_model" && input.succeeded) {
    const receipt = resultCandidates(input.result)[0];
    const metadataKeys = new Set(["name", "uuid", "save_path", "export_path", "export_codec", "saved"]);
    const reported = receipt?.project_lifecycle_changes;
    if (Array.isArray(reported)) {
      for (const field of reported) {
        if (typeof field === "string" && metadataKeys.has(field)) {
          changed.push(`project.${field}`);
        }
      }
    }
  }

  const authoringDomain = authoringDomainForCapability(input.capability);
  // Interpret mutation/no-op and geometry receipt scope once for this single
  // Control Delta. Other direct API callers remain backward-compatible.
  const mutationAnalysis = analyzeMutationEvidence(
    input.capability,
    authoringDomain,
    input.succeeded,
    input.result,
    input.branch
  );
  const invalidates = mutationInvalidation(
    input.capability,
    authoringDomain,
    input.succeeded,
    input.result,
    input.branch,
    mutationAnalysis
  );
  const freshness = mutationFreshness(
    input.capability,
    authoringDomain,
    input.succeeded,
    input.result,
    input.branch,
    mutationAnalysis
  );
  const revisionEvidence = input.succeeded
    ? authoritativeRevisionEvidence(input.capability, input.result)
    : {};
  const verificationClass = verificationClassForResult(
    input.capability,
    input.branch,
    input.succeeded,
    freshness,
    input.result
  );
  const verificationScope = verificationScopeForResult(
    input.capability,
    verificationClass,
    input.result
  );
  const downstreamRecheck = downstreamRechecksForFreshness({
    stale:
      freshness.basis === "UNKNOWN_OUTCOME"
        ? freshness.unknown
        : freshness.stale,
    currentDomain: authoringDomain,
    result: input.result,
  });
  const particleTextureHandoff = mutationAnalysis.particleTextureHandoff === true;
  const nextIntent = !input.succeeded
    ? "RECOVER_CURRENT_OPERATION"
    : particleTextureHandoff
      ? "AUTHOR_PARTICLE_TEXTURE_THEN_RESUME"
      : input.capability === "switch_authoring_phase"
        ? "CONTINUE_NEW_AUTHORING_PHASE"
        : authoringDomain === "GEOMETRY"
          ? "VERIFY_OR_CONTINUE_GEOMETRY"
          : authoringDomain === "TEXTURING"
            ? "VERIFY_OR_CONTINUE_TEXTURING"
            : authoringDomain === "ANIMATION"
              ? "VERIFY_OR_CONTINUE_ANIMATION"
              : "CONTINUE_CURRENT_TASK";

  return {
    protocol: "lazydesigner-control-v1",
    capability: input.capability,
    authoring_domain: authoringDomain,
    source_owner: sourceOwnerForCapability(input.capability),
    phase_before: input.phaseBefore,
    phase_after: input.phaseAfter,
    project_uuid: input.projectUuid,
    changed,
    invalidates,
    freshness,
    revision_evidence: revisionEvidence,
    next_intent: nextIntent,
    verification_class: verificationClass,
    verification_scope: verificationScope,
    downstream_recheck: downstreamRecheck,
    requires_status_refresh: changed.length > 0,
  };
}
