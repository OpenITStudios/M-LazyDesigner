import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/semantic/canonical";
import type { VerificationEvidenceRequest } from "@/lib/orchestration/evidencePlan";
import type { VerificationEvidenceHandle } from "@/lib/orchestration/evidenceRegistry";
import type {
  MinecraftCauseFamily,
  MinecraftEvidenceNeed,
  MinecraftQualityClass,
  MinecraftQualityOwner,
  MinecraftRepairRoute,
  VerificationDiscrepancy,
} from "@/lib/orchestration/compactEvidence";
import type { ModelView, VisualEvidenceTarget } from "@/lib/reference/visualEvidence";

export type CorrectionLoopHandle = `correctionloop:${string}`;

export type CorrectionContinuationMode =
  | "CANDIDATE_CONTEXT"
  | "DECISION_SUMMARY"
  | "VERIFY_PENDING"
  | "PRUNED_READY"
  | "CLEAR"
  | "BLOCKED";

export type CorrectionLoopContinuation = {
  protocol: "lazydesigner-correction-continuation-v1";
  continuation_id: `correctionctx:${string}`;
  mode: Exclude<CorrectionContinuationMode, "DECISION_SUMMARY">;
  handle: CorrectionLoopHandle;
  recipe_id: string;
  attempt: 0 | 1 | 2;
  state: "CLEAR" | "READY" | "VERIFY_PENDING" | "BLOCKED";
  unresolved_count: number;
  quality_focus: {
    code: string;
    severity: VerificationDiscrepancy["severity"];
    quality_class: MinecraftQualityClass;
    owner: MinecraftQualityOwner;
    cause_family: MinecraftCauseFamily;
    repair_route: MinecraftRepairRoute;
    evidence_backed_cause: boolean;
    evidence_need: MinecraftEvidenceNeed;
    views: ModelView[];
    evidence_targets: VisualEvidenceTarget[];
  } | null;
  convergence: {
    state:
      | "UNASSESSED"
      | "PENDING_VERIFICATION"
      | "RESOLVED"
      | "IMPROVED"
      | "CAUSE_CHANGED"
      | "PLATEAU";
    target_discrepancy_codes: string[];
  };
  unresolved: Array<{
    code: string;
    severity: VerificationDiscrepancy["severity"];
    summary: string;
    views: ModelView[];
    evidence_targets: VisualEvidenceTarget[];
    quality_class?: MinecraftQualityClass;
    owner?: MinecraftQualityOwner;
    cause_family?: MinecraftCauseFamily;
  }>;
  unresolved_truncated: boolean;
  fresh_view_evidence: Array<{
    view: ModelView;
    handle: VerificationEvidenceHandle;
  }>;
  verification: {
    pending: boolean;
    /** Present only while a plan awaits a matching native Recipe Apply receipt. */
    awaiting_native_apply_receipt?: true;
    target_discrepancy_codes: string[];
    stale_views: ModelView[];
    domain: VerificationEvidenceRequest["domain"];
    source: VerificationEvidenceRequest["source"];
    risk: "LOW" | "MEDIUM" | "HIGH" | null;
    recovery_required: boolean;
    recovery_reason: "EVIDENCE_EXPIRED" | "RUNTIME_GENERATION_CHANGED" | null;
  };
};

export type CorrectionContinuationDelta = {
  protocol: "lazydesigner-correction-continuation-delta-v1";
  from_continuation_id: CorrectionLoopContinuation["continuation_id"];
  to_continuation_id: CorrectionLoopContinuation["continuation_id"];
  mode?: CorrectionLoopContinuation["mode"];
  state?: CorrectionLoopContinuation["state"];
  attempt?: CorrectionLoopContinuation["attempt"];
  unresolved_count?: number;
  quality_focus?: CorrectionLoopContinuation["quality_focus"];
  convergence?: CorrectionLoopContinuation["convergence"];
  unresolved_upsert?: CorrectionLoopContinuation["unresolved"];
  resolved_discrepancy_codes?: string[];
  unresolved_truncated?: boolean;
  fresh_view_evidence_upsert?: CorrectionLoopContinuation["fresh_view_evidence"];
  invalidated_evidence_handles?: VerificationEvidenceHandle[];
  verification?: CorrectionLoopContinuation["verification"];
};

export type CorrectionContinuationDelivery = {
  continuation_id: CorrectionLoopContinuation["continuation_id"];
  delivery: "FULL" | "DELTA" | "CACHED" | "DEFERRED";
  payload: CorrectionLoopContinuation | null;
  delta: CorrectionContinuationDelta | null;
  group: {
    id: `correctiongroup:${number}`;
    kind: "EXECUTION_COHORT" | "VERIFICATION_COHORT";
  } | null;
};

function canonicalEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

export function correctionContinuationDelta(
  previous: CorrectionLoopContinuation,
  current: CorrectionLoopContinuation
): CorrectionContinuationDelta {
  const previousByCode = new Map(
    previous.unresolved.map((item) => [item.code, item])
  );
  const currentByCode = new Map(
    current.unresolved.map((item) => [item.code, item])
  );
  const unresolvedUpsert = current.unresolved.filter((item) => {
    const prior = previousByCode.get(item.code);
    return prior === undefined || !canonicalEqual(prior, item);
  });
  const resolvedCodes = previous.unresolved
    .map((item) => item.code)
    .filter((code) => !currentByCode.has(code));

  const previousByView = new Map(
    previous.fresh_view_evidence.map((item) => [item.view, item])
  );
  const evidenceUpsert = current.fresh_view_evidence.filter((item) => {
    const prior = previousByView.get(item.view);
    return prior === undefined || prior.handle !== item.handle;
  });
  const currentEvidenceHandles = new Set(
    current.fresh_view_evidence.map((item) => item.handle)
  );
  const invalidatedEvidenceHandles = [
    ...new Set(
      previous.fresh_view_evidence
        .map((item) => item.handle)
        .filter((evidenceHandle) => !currentEvidenceHandles.has(evidenceHandle))
    ),
  ];

  return {
    protocol: "lazydesigner-correction-continuation-delta-v1",
    from_continuation_id: previous.continuation_id,
    to_continuation_id: current.continuation_id,
    ...(previous.mode !== current.mode ? { mode: current.mode } : {}),
    ...(previous.state !== current.state ? { state: current.state } : {}),
    ...(previous.attempt !== current.attempt ? { attempt: current.attempt } : {}),
    ...(previous.unresolved_count !== current.unresolved_count
      ? { unresolved_count: current.unresolved_count }
      : {}),
    ...(!canonicalEqual(previous.quality_focus, current.quality_focus)
      ? { quality_focus: current.quality_focus }
      : {}),
    ...(!canonicalEqual(previous.convergence, current.convergence)
      ? { convergence: current.convergence }
      : {}),
    ...(unresolvedUpsert.length > 0 ? { unresolved_upsert: unresolvedUpsert } : {}),
    ...(resolvedCodes.length > 0
      ? { resolved_discrepancy_codes: resolvedCodes }
      : {}),
    ...(previous.unresolved_truncated !== current.unresolved_truncated
      ? { unresolved_truncated: current.unresolved_truncated }
      : {}),
    ...(evidenceUpsert.length > 0
      ? { fresh_view_evidence_upsert: evidenceUpsert }
      : {}),
    ...(invalidatedEvidenceHandles.length > 0
      ? { invalidated_evidence_handles: invalidatedEvidenceHandles }
      : {}),
    ...(!canonicalEqual(previous.verification, current.verification)
      ? { verification: current.verification }
      : {}),
  };
}

export function correctionContinuationId(
  payload: Omit<CorrectionLoopContinuation, "continuation_id">
): CorrectionLoopContinuation["continuation_id"] {
  return (
    "correctionctx:" +
    createHash("sha256").update(canonicalJson(payload)).digest("hex").slice(0, 20)
  ) as CorrectionLoopContinuation["continuation_id"];
}
