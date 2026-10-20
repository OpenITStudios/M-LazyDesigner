import { createHash } from "node:crypto";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import type { SemanticGeometryEditIntent } from "@/lib/authoringRecipe/semanticEdit";
import { rewriteAuthoringRecipeForSemanticEdit } from "@/lib/authoringRecipe/semanticRewrite";
import { planIncrementalRecipeRebuild } from "@/lib/authoringRecipe/incremental";
import {
  selectLowestCostCorrection,
  type CorrectionCandidate,
  type CorrectionSolverOptions,
} from "@/lib/correctionSolver";
import type { VerificationEvidenceRequest } from "@/lib/orchestration/evidencePlan";
import type { VerificationEvidenceHandle } from "@/lib/orchestration/evidenceRegistry";
import {
  assertUniqueDiscrepancyCodes,
  diagnoseMinecraftDiscrepancy,
  minecraftQualityFocus,
  prioritizeMinecraftDiscrepancies,
  type VerificationDiscrepancy,
} from "@/lib/orchestration/compactEvidence";
import type { ModelView } from "@/lib/reference/visualEvidence";
import {
  assessLandmarkCorrectionDelta,
  type LandmarkCaptureEvidence,
} from "@/lib/reference/landmarkEvidence";
import {
  compileStructuredVisualObservations,
  type StructuredVisualObservation,
} from "@/lib/orchestration/visualObservation";
import {
  correctionContinuationDelta,
  correctionContinuationId,
  type CorrectionContinuationDelivery,
  type CorrectionLoopContinuation,
  type CorrectionLoopHandle,
} from "@/lib/orchestration/correctionContinuation";

export type { CorrectionLoopHandle } from "@/lib/orchestration/correctionContinuation";

type ExecutableGeometryCorrectionFamily =
  | "TRANSLATE"
  | "RESIZE"
  | "ROTATE"
  | "LAYER_OFFSET";

type GeometryCorrectionPatch = {
  intent: SemanticGeometryEditIntent;
  correction_family?: ExecutableGeometryCorrectionFamily;
  target_discrepancy_codes?: readonly string[];
};

type CorrectionConvergenceState =
  | "UNASSESSED"
  | "PENDING_VERIFICATION"
  | "RESOLVED"
  | "IMPROVED"
  | "CAUSE_CHANGED"
  | "PLATEAU";

type CorrectionEvidenceUpdateOptions = {
  recovered_views?: readonly ModelView[];
  cleared_target_codes?: readonly string[];
  /** Optional measurement veto, never a visual approval or mutation trigger. */
  landmark_check?: {
    before: LandmarkCaptureEvidence;
    after: LandmarkCaptureEvidence;
  };
};

type CorrectionLoopRecord = {
  recipe_id: string;
  base_recipe: AuthoringRecipe;
  verification_request: VerificationEvidenceRequest;
  verification_evidence_handle: VerificationEvidenceHandle;
  discrepancies: VerificationDiscrepancy[];
  attempt: 0 | 1 | 2;
  evidence_fingerprint: string;
  last_attempt_evidence_fingerprint: string | null;
  last_attempt_target_snapshot: VerificationDiscrepancy[];
  convergence_state: CorrectionConvergenceState;
  convergence_target_codes: string[];
  view_evidence_handles: Partial<Record<ModelView, VerificationEvidenceHandle>>;
  pending_target_discrepancy_codes: string[];
  pending_stale_views: ModelView[];
  last_delivered_continuation: CorrectionLoopContinuation | null;
  continuation_group: {
    id: number;
    kind: "EXECUTION_COHORT" | "VERIFICATION_COHORT";
    base_mode: CorrectionLoopContinuation["mode"];
    base_state: CorrectionLoopContinuation["state"];
  } | null;
  next_continuation_group_id: number;
  evidence_recovery_required: boolean;
  evidence_recovery_reason:
    | "EVIDENCE_EXPIRED"
    | "RUNTIME_GENERATION_CHANGED"
    | null;
};

type CorrectionLoopDecision = {
  handle: CorrectionLoopHandle;
  continuation_mode?: "DECISION_SUMMARY";
  state: "CORRECTION_READY" | "BLOCKED";
  attempt: 0 | 1 | 2;
  decision_summary?: {
    selected_candidate_id: string;
    rejected_candidate_ids: string[];
    selected_metrics: {
      predicted_error: number;
      mutation_cost: number;
      risk: number;
    };
    solver_score: number;
    candidate_count: number;
    candidate_budget: 1 | 2 | 3;
  };
  next_recipe?: AuthoringRecipe;
  rebuild?: ReturnType<typeof planIncrementalRecipeRebuild>;
  verification_request: VerificationEvidenceRequest;
  reverification_discrepancies?: VerificationDiscrepancy[];
  evidence_reuse?: {
    source_handle: VerificationEvidenceHandle;
    stale_views: ModelView[];
    reusable_views: ModelView[];
    reusable_evidence: Array<{
      view: ModelView;
      handle: VerificationEvidenceHandle;
    }>;
    basis: "TARGETED_VIEW_PROVENANCE" | "CONSERVATIVE_ALL_VIEWS";
  };
  blocked_reason?:
    | "REPEATED_FAILURE_WITHOUT_NEW_EVIDENCE"
    | "CORRECTION_ATTEMPT_LIMIT"
    | "NO_ELIGIBLE_CORRECTION"
    | "CANDIDATE_BUDGET_EXCEEDED"
    | "CORRECTION_FAMILY_MISMATCH"
    | "CAUSAL_REPAIR_MISMATCH"
    | "CAUSE_REQUIRES_OWNER_ROUTE"
    | "QUALITY_PLATEAU_NO_GAIN"
    | "BLOCKING_PLATEAU_REQUIRES_NEW_EVIDENCE"
    | "EVIDENCE_RECOVERY_REQUIRED";
};

function candidateBudget(
  request: VerificationEvidenceRequest
): 1 | 2 | 3 {
  if (request.domain !== "GEOMETRY") return 1;
  if (request.verification_risk === "HIGH") return 3;
  if (request.verification_risk === "MEDIUM") return 2;
  return 1;
}

function correctionFamilyMatchesOperation(
  family: ExecutableGeometryCorrectionFamily,
  operation: SemanticGeometryEditIntent["operation"]
): boolean {
  if (family === "TRANSLATE") return operation.kind === "TRANSLATE";
  if (family === "RESIZE") return operation.kind === "RESIZE_AXIS";
  if (family === "ROTATE") return operation.kind === "ROTATE_AXIS";
  return (
    operation.kind === "TRANSLATE" ||
    operation.kind === "RESIZE_AXIS" ||
    operation.kind === "INFLATE"
  );
}

function fingerprintEvidence(
  handle: VerificationEvidenceHandle,
  discrepancies: readonly VerificationDiscrepancy[]
): string {
  return createHash("sha256")
    .update(JSON.stringify({ handle, discrepancies }))
    .digest("hex");
}

const CONVERGENCE_SEVERITY_RANK: Readonly<
  Record<VerificationDiscrepancy["severity"], number>
> = {
  INFO: 0,
  REVIEW: 1,
  BLOCKING: 2,
};

function discrepancyDiagnosisIdentity(
  item: VerificationDiscrepancy
): string {
  return JSON.stringify({
    quality_class: item.quality_class ?? null,
    owner: item.owner ?? null,
    cause_family: item.cause_family ?? null,
  });
}

function assessCorrectionConvergence(
  before: readonly VerificationDiscrepancy[],
  after: readonly VerificationDiscrepancy[],
  targetCodes: readonly string[]
): CorrectionConvergenceState {
  if (targetCodes.length === 0 || before.length === 0) return "UNASSESSED";

  const targets = new Set(targetCodes);
  const beforeByCode = new Map(
    before.filter((item) => targets.has(item.code)).map((item) => [item.code, item])
  );
  const afterByCode = new Map(
    after.filter((item) => targets.has(item.code)).map((item) => [item.code, item])
  );

  if (beforeByCode.size === 0) return "UNASSESSED";
  if ([...beforeByCode.keys()].every((code) => !afterByCode.has(code))) {
    return "RESOLVED";
  }

  let improved = false;
  let causeChanged = false;
  for (const [code, prior] of beforeByCode) {
    const current = afterByCode.get(code);
    if (!current) continue;
    if (
      CONVERGENCE_SEVERITY_RANK[current.severity] <
      CONVERGENCE_SEVERITY_RANK[prior.severity]
    ) {
      improved = true;
    }
    if (
      discrepancyDiagnosisIdentity(current) !==
      discrepancyDiagnosisIdentity(prior)
    ) {
      causeChanged = true;
    }
  }

  if (improved) return "IMPROVED";
  if (causeChanged) return "CAUSE_CHANGED";
  return "PLATEAU";
}

export class CorrectionLoopRegistry {
  private readonly entries = new Map<CorrectionLoopHandle, CorrectionLoopRecord>();
  private scopeIdentity = "unbound:0";

  constructor(private readonly maxEntries = 8) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 32) {
      throw new Error("Correction loop registry maxEntries must be 1..32.");
    }
  }


  startFromObservations(
    input: Omit<
      CorrectionLoopRecord,
      | "discrepancies"
      | "attempt"
      | "evidence_fingerprint"
      | "last_attempt_evidence_fingerprint"
      | "last_attempt_target_snapshot"
      | "convergence_state"
      | "convergence_target_codes"
      | "view_evidence_handles"
      | "pending_target_discrepancy_codes"
      | "pending_stale_views"
      | "last_delivered_continuation"
      | "continuation_group"
      | "next_continuation_group_id"
      | "evidence_recovery_required"
      | "evidence_recovery_reason"
    > & {
      observations: readonly StructuredVisualObservation[];
    }
  ): {
    handle: CorrectionLoopHandle | null;
    unverified: ReturnType<
      typeof compileStructuredVisualObservations
    >["unverified"];
  } {
    const compiled = compileStructuredVisualObservations(
      input.observations
    );
    if (compiled.supported.length === 0) {
      return { handle: null, unverified: compiled.unverified };
    }

    const { observations: _observations, ...recordInput } = input;
    return {
      handle: this.start({
        ...recordInput,
        discrepancies: compiled.supported,
      }),
      unverified: compiled.unverified,
    };
  }

  start(
    input: Omit<
      CorrectionLoopRecord,
      | "attempt"
      | "evidence_fingerprint"
      | "last_attempt_evidence_fingerprint"
      | "last_attempt_target_snapshot"
      | "convergence_state"
      | "convergence_target_codes"
      | "view_evidence_handles"
      | "pending_target_discrepancy_codes"
      | "pending_stale_views"
      | "last_delivered_continuation"
      | "continuation_group"
      | "next_continuation_group_id"
      | "evidence_recovery_required"
      | "evidence_recovery_reason"
    >
  ): CorrectionLoopHandle {
    if (input.verification_request.source === null) {
      throw new Error(
        "VERIFICATION_SOURCE_UNAVAILABLE: " + input.verification_request.reason
      );
    }
    assertUniqueDiscrepancyCodes(input.discrepancies);
    const viewEvidenceHandles: Partial<
      Record<ModelView, VerificationEvidenceHandle>
    > = {};
    for (const discrepancy of input.discrepancies) {
      for (const view of discrepancy.views ?? []) {
        viewEvidenceHandles[view] = input.verification_evidence_handle;
      }
    }

    const record: CorrectionLoopRecord = {
      ...structuredClone(input),
      attempt: 0,
      evidence_fingerprint: fingerprintEvidence(
        input.verification_evidence_handle,
        input.discrepancies
      ),
      last_attempt_evidence_fingerprint: null,
      last_attempt_target_snapshot: [],
      convergence_state: "UNASSESSED",
      convergence_target_codes: [],
      view_evidence_handles: viewEvidenceHandles,
      pending_target_discrepancy_codes: [],
      pending_stale_views: [],
      last_delivered_continuation: null,
      continuation_group: null,
      next_continuation_group_id: 1,
      evidence_recovery_required: false,
      evidence_recovery_reason: null,
    };
    const handle = (
      "correctionloop:" +
      createHash("sha256")
        .update(this.scopeIdentity)
        .update("\n")
        .update(JSON.stringify(record))
        .digest("hex")
    ) as CorrectionLoopHandle;
    this.entries.delete(handle);
    this.entries.set(handle, record);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
    return handle;
  }

  projectContinuation(handle: CorrectionLoopHandle): CorrectionLoopContinuation {
    const record = this.entries.get(handle);
    if (!record) {
      throw new Error(
        "CORRECTION_LOOP_NOT_FOUND: handle expired or belongs to a previous Gateway process, project epoch, or Runtime generation."
      );
    }

    const pendingStale = new Set(record.pending_stale_views);
    const freshViewEvidence = (Object.entries(record.view_evidence_handles) as Array<
      [ModelView, VerificationEvidenceHandle | undefined]
    >)
      .filter(
        (entry): entry is [ModelView, VerificationEvidenceHandle] =>
          entry[1] !== undefined && !pendingStale.has(entry[0])
      )
      .map(([view, evidenceHandle]) => ({
        view,
        handle: evidenceHandle,
      }))
      .sort((a, b) => a.view.localeCompare(b.view));

    const prioritizedDiscrepancies = prioritizeMinecraftDiscrepancies(
      record.discrepancies
    );
    const verificationRisk =
      record.verification_request.domain === "GEOMETRY"
        ? record.verification_request.verification_risk
        : "LOW";
    const qualityFocus = minecraftQualityFocus(
      prioritizedDiscrepancies,
      verificationRisk
    );
    const unresolved = prioritizedDiscrepancies.slice(0, 6).map((item) => ({
      code: item.code,
      severity: item.severity,
      summary:
        item.summary.length <= 160
          ? item.summary
          : item.summary.slice(0, 157) + "...",
      views: [...(item.views ?? [])],
      evidence_targets: [...(item.evidence_targets ?? [])],
      ...(item.quality_class ? { quality_class: item.quality_class } : {}),
      ...(item.owner ? { owner: item.owner } : {}),
      ...(item.cause_family ? { cause_family: item.cause_family } : {}),
    }));

    const pending =
      record.pending_stale_views.length > 0 || record.evidence_recovery_required;
    const plateau = record.convergence_state === "PLATEAU";
    const state: CorrectionLoopContinuation["state"] =
      pending
        ? "VERIFY_PENDING"
        : record.discrepancies.length === 0
          ? "CLEAR"
          : plateau || record.attempt >= 2
            ? "BLOCKED"
            : "READY";
    const mode: CorrectionLoopContinuation["mode"] =
      pending
        ? "VERIFY_PENDING"
        : record.discrepancies.length === 0
          ? "CLEAR"
          : plateau || record.attempt >= 2
            ? "BLOCKED"
            : record.attempt === 0
              ? "CANDIDATE_CONTEXT"
              : "PRUNED_READY";

    const payload: Omit<CorrectionLoopContinuation, "continuation_id"> = {
      protocol: "lazydesigner-correction-continuation-v1",
      mode,
      handle,
      recipe_id: record.recipe_id,
      attempt: record.attempt,
      state,
      unresolved_count: record.discrepancies.length,
      quality_focus: qualityFocus,
      convergence: {
        state: record.convergence_state,
        target_discrepancy_codes: [...record.convergence_target_codes],
      },
      unresolved,
      unresolved_truncated: record.discrepancies.length > unresolved.length,
      fresh_view_evidence: freshViewEvidence,
      verification: {
        pending,
        target_discrepancy_codes: [
          ...record.pending_target_discrepancy_codes,
        ],
        stale_views: [...record.pending_stale_views],
        domain: record.verification_request.domain,
        source: record.verification_request.source,
        risk:
          record.verification_request.domain === "GEOMETRY"
            ? record.verification_request.verification_risk
            : null,
        recovery_required: record.evidence_recovery_required,
        recovery_reason: record.evidence_recovery_reason,
      },
    };

    return {
      ...payload,
      continuation_id: correctionContinuationId(payload),
    };
  }

  beginContinuationGroup(
    handle: CorrectionLoopHandle,
    kind: "EXECUTION_COHORT" | "VERIFICATION_COHORT"
  ): { id: `correctiongroup:${number}`; kind: typeof kind } {
    const record = this.entries.get(handle);
    if (!record) {
      throw new Error(
        "CORRECTION_LOOP_NOT_FOUND: handle expired or belongs to a previous Gateway process, project epoch, or Runtime generation."
      );
    }
    if (record.continuation_group) {
      throw new Error("CORRECTION_CONTINUATION_GROUP_ALREADY_OPEN");
    }

    const id = record.next_continuation_group_id++;
    const base = this.projectContinuation(handle);
    record.continuation_group = {
      id,
      kind,
      base_mode: base.mode,
      base_state: base.state,
    };
    return { id: `correctiongroup:${id}`, kind };
  }

  abortContinuationGroup(handle: CorrectionLoopHandle): void {
    const record = this.entries.get(handle);
    if (!record) {
      throw new Error("CORRECTION_LOOP_NOT_FOUND: handle expired.");
    }
    record.continuation_group = null;
  }

  commitContinuationGroup(
    handle: CorrectionLoopHandle,
    knownContinuationIds: readonly string[] = []
  ): CorrectionContinuationDelivery {
    const record = this.entries.get(handle);
    if (!record) {
      throw new Error("CORRECTION_LOOP_NOT_FOUND: handle expired.");
    }
    if (!record.continuation_group) {
      throw new Error("CORRECTION_CONTINUATION_GROUP_NOT_OPEN");
    }
    record.continuation_group = null;
    return this.projectContinuationDelivery(handle, knownContinuationIds);
  }

  projectContinuationDelivery(
    handle: CorrectionLoopHandle,
    knownContinuationIds: readonly string[] = []
  ): CorrectionContinuationDelivery {
    const record = this.entries.get(handle);
    if (!record) {
      throw new Error(
        "CORRECTION_LOOP_NOT_FOUND: handle expired or belongs to a previous Gateway process, project epoch, or Runtime generation."
      );
    }

    const payload = this.projectContinuation(handle);
    if (record.continuation_group) {
      const group = record.continuation_group;
      const decisionBoundaryChanged =
        payload.mode !== group.base_mode || payload.state !== group.base_state;
      if (!decisionBoundaryChanged) {
        return {
          continuation_id: payload.continuation_id,
          delivery: "DEFERRED",
          payload: null,
          delta: null,
          group: {
            id: `correctiongroup:${group.id}`,
            kind: group.kind,
          },
        };
      }
      record.continuation_group = null;
    }
    if (knownContinuationIds.includes(payload.continuation_id)) {
      record.last_delivered_continuation = structuredClone(payload);
      return {
        continuation_id: payload.continuation_id,
        delivery: "CACHED",
        payload: null,
        delta: null,
        group: null,
      };
    }

    const previous = record.last_delivered_continuation;
    if (
      previous &&
      knownContinuationIds.includes(previous.continuation_id)
    ) {
      const delta = correctionContinuationDelta(previous, payload);
      record.last_delivered_continuation = structuredClone(payload);
      return {
        continuation_id: payload.continuation_id,
        delivery: "DELTA",
        payload: null,
        delta,
        group: null,
      };
    }

    record.last_delivered_continuation = structuredClone(payload);
    return {
      continuation_id: payload.continuation_id,
      delivery: "FULL",
      payload,
      delta: null,
      group: null,
    };
  }

  invalidateEvidenceHandles(
    handle: CorrectionLoopHandle,
    handles: readonly VerificationEvidenceHandle[],
    reason: "EVIDENCE_EXPIRED" | "RUNTIME_GENERATION_CHANGED"
  ): void {
    const record = this.entries.get(handle);
    if (!record) {
      throw new Error("CORRECTION_LOOP_NOT_FOUND: handle expired.");
    }

    const invalid = new Set(handles);
    const invalidatedViews: ModelView[] = [];
    for (const [view, evidenceHandle] of Object.entries(
      record.view_evidence_handles
    ) as Array<[ModelView, VerificationEvidenceHandle | undefined]>) {
      if (evidenceHandle && invalid.has(evidenceHandle)) {
        delete record.view_evidence_handles[view];
        invalidatedViews.push(view);
      }
    }

    const primaryInvalid = invalid.has(record.verification_evidence_handle);
    if (!primaryInvalid && invalidatedViews.length === 0) return;

    const fallbackViews =
      record.verification_request.domain === "GEOMETRY"
        ? record.verification_request.views
        : [];
    record.pending_stale_views = [
      ...new Set([
        ...record.pending_stale_views,
        ...invalidatedViews,
        ...(primaryInvalid ? fallbackViews : []),
      ]),
    ];
    record.pending_target_discrepancy_codes = [
      ...new Set([
        ...record.pending_target_discrepancy_codes,
        ...record.discrepancies.map((item) => item.code),
      ]),
    ];
    record.evidence_recovery_required = true;
    record.evidence_recovery_reason = reason;
    record.continuation_group = null;
  }

  invalidateRuntimeGeneration(): void {
    for (const [handle, record] of this.entries) {
      const handles = [
        record.verification_evidence_handle,
        ...Object.values(record.view_evidence_handles).filter(
          (value): value is VerificationEvidenceHandle => value !== undefined
        ),
      ];
      this.invalidateEvidenceHandles(
        handle,
        [...new Set(handles)],
        "RUNTIME_GENERATION_CHANGED"
      );
    }
  }


  updateEvidenceFromObservations(
    handle: CorrectionLoopHandle,
    evidenceHandle: VerificationEvidenceHandle,
    observations: readonly StructuredVisualObservation[],
    options: CorrectionEvidenceUpdateOptions = {}
  ): {
    applied: boolean;
    accepted_count: number;
    unverified: ReturnType<
      typeof compileStructuredVisualObservations
    >["unverified"];
  } {
    const record = this.entries.get(handle);
    if (!record) {
      throw new Error("CORRECTION_LOOP_NOT_FOUND: handle expired.");
    }

    const compiled = compileStructuredVisualObservations(observations);
    const pendingTargets = new Set(
      record.pending_target_discrepancy_codes
    );
    const unresolvedTargetClaim = compiled.unverified.some(
      (entry) => pendingTargets.has(entry.code)
    );

    if (unresolvedTargetClaim) {
      return {
        applied: false,
        accepted_count: compiled.supported.length,
        unverified: compiled.unverified,
      };
    }

    this.updateEvidence(
      handle,
      evidenceHandle,
      compiled.supported,
      options
    );
    return {
      applied: true,
      accepted_count: compiled.supported.length,
      unverified: compiled.unverified,
    };
  }

  updateEvidence(
    handle: CorrectionLoopHandle,
    evidenceHandle: VerificationEvidenceHandle,
    discrepancies: readonly VerificationDiscrepancy[],
    options: CorrectionEvidenceUpdateOptions = {}
  ): void {
    const record = this.entries.get(handle);
    if (!record) throw new Error("CORRECTION_LOOP_NOT_FOUND: handle expired.");

    if (record.evidence_recovery_required) {
      const recovered = new Set(options.recovered_views ?? []);
      const missingRecoveryViews = record.pending_stale_views.filter(
        (view) => !recovered.has(view)
      );
      if (missingRecoveryViews.length > 0) {
        throw new Error(
          "EVIDENCE_RECOVERY_INCOMPLETE: fresh evidence missing views " +
            missingRecoveryViews.join(", ") +
            "."
        );
      }
    }

    assertUniqueDiscrepancyCodes(discrepancies);
    // Missing findings are not proof of resolution. In a targeted correction,
    // only pending codes are in scope; otherwise the full current batch is.
    const incomingCodes = new Set(discrepancies.map((item) => item.code));
    const inScope = record.pending_target_discrepancy_codes.length
      ? record.pending_target_discrepancy_codes
      : record.discrepancies.map((item) => item.code);
    const absent = inScope.filter((code) => !incomingCodes.has(code));
    const declared = options.cleared_target_codes ?? [];
    const clearCodes = new Set(declared);
    if (clearCodes.size !== declared.length) {
      throw new Error("DUPLICATE_TARGET_CLEARANCE: declare each clear code once.");
    }
    if (declared.some((code) => !absent.includes(code))) {
      throw new Error("TARGET_CLEARANCE_CONTRADICTED: clear code is present or outside verification scope.");
    }
    const unchecked = absent.filter((code) => !clearCodes.has(code));
    if (unchecked.length) {
      throw new Error("TARGET_CLEARANCE_UNVERIFIED: missing claims require explicit clearance: " + unchecked.join(", "));
    }
    if (absent.length) {
      if (evidenceHandle === record.verification_evidence_handle) {
        throw new Error("TARGET_CLEARANCE_STALE_EVIDENCE: supply fresh evidence.");
      }
      const freshViews = new Set(options.recovered_views ?? []);
      const requiredViews = new Set<ModelView>();
      for (const code of absent) {
        const prior = record.last_attempt_target_snapshot.find((item) => item.code === code) ??
          record.discrepancies.find((item) => item.code === code);
        const views = prior?.views?.length
          ? prior.views
          : record.verification_request.domain === "GEOMETRY"
            ? record.verification_request.views
            : [];
        for (const view of views) requiredViews.add(view);
      }
      const missingViews = [...requiredViews].filter((view) => !freshViews.has(view));
      if (missingViews.length) {
        throw new Error("TARGET_CLEARANCE_VIEW_MISSING: recheck claim views " + missingViews.join(", "));
      }
    }
    // Keep the measurement guard before any correction record mutation.
    // Landmarks only veto unsafe convergence; they cannot diagnose a 3D cause,
    // authorize a candidate, certify visual PASS or perform native Undo.
    if (options.landmark_check) {
      const { before, after } = options.landmark_check;
      if (record.verification_request.domain !== "GEOMETRY" ||
          record.pending_target_discrepancy_codes.length === 0) {
        throw new Error("LANDMARK_CORRECTION_NOT_PENDING");
      }
      if (before.evidence_handle !== record.verification_evidence_handle ||
          after.evidence_handle !== evidenceHandle) {
        throw new Error("LANDMARK_CAPTURE_HANDLE_MISMATCH");
      }
      const recovered = new Set(options.recovered_views ?? []);
      if (after.landmarks.some((row) => !recovered.has(row.view))) {
        throw new Error("LANDMARK_CAPTURE_VIEW_UNVERIFIED");
      }
      const delta = assessLandmarkCorrectionDelta(before, after);
      if (delta.state === "UNCOMPARABLE") {
        throw new Error(
          "LANDMARK_CAMERA_OR_REFERENCE_MISMATCH: recapture matched source, Cube and camera evidence."
        );
      }
      if (delta.state === "REGRESSED") {
        throw new Error(
          "LANDMARK_CORRECTION_REGRESSED: do not accept convergence; revert the native edit in its execution owner and recapture."
        );
      }
      // No displacement is not proof that a discrepancy has disappeared.
      if (delta.state === "UNCHANGED" && absent.length > 0) {
        throw new Error("LANDMARK_CLEARANCE_UNSUPPORTED: measured targets did not improve.");
      }
    }

    const incoming = [...structuredClone(discrepancies)];
    const pendingTargetCodes = [...record.pending_target_discrepancy_codes];
    if (pendingTargetCodes.length > 0) {
      record.convergence_state = assessCorrectionConvergence(
        record.last_attempt_target_snapshot,
        incoming,
        pendingTargetCodes
      );
      record.convergence_target_codes = pendingTargetCodes;
    } else {
      record.convergence_state = "UNASSESSED";
      record.convergence_target_codes = [];
    }

    if (record.pending_target_discrepancy_codes.length > 0) {
      const replaced = new Set(record.pending_target_discrepancy_codes);
      const retained = record.discrepancies.filter(
        (item) => !replaced.has(item.code)
      );
      const incomingCodes = new Set(incoming.map((item) => item.code));
      record.discrepancies = [
        ...retained.filter((item) => !incomingCodes.has(item.code)),
        ...incoming,
      ];
    } else {
      record.discrepancies = incoming;
    }

    for (const view of record.pending_stale_views) {
      record.view_evidence_handles[view] = evidenceHandle;
    }
    for (const discrepancy of incoming) {
      for (const view of discrepancy.views ?? []) {
        record.view_evidence_handles[view] = evidenceHandle;
      }
    }

    record.verification_evidence_handle = evidenceHandle;
    record.evidence_fingerprint = fingerprintEvidence(
      evidenceHandle,
      record.discrepancies
    );
    record.pending_target_discrepancy_codes = [];
    record.pending_stale_views = [];
    record.evidence_recovery_required = false;
    record.evidence_recovery_reason = null;
  }

  planGeometryCorrection(
    handle: CorrectionLoopHandle,
    candidates: readonly CorrectionCandidate<GeometryCorrectionPatch>[],
    options: CorrectionSolverOptions = {}
  ): CorrectionLoopDecision {
    const record = this.entries.get(handle);
    if (!record) throw new Error("CORRECTION_LOOP_NOT_FOUND: handle expired.");

    if (record.evidence_recovery_required) {
      return {
        handle,
        state: "BLOCKED",
        attempt: record.attempt,
        verification_request: structuredClone(record.verification_request),
        blocked_reason: "EVIDENCE_RECOVERY_REQUIRED",
      };
    }

    if (record.convergence_state === "PLATEAU") {
      const plateauTargets = new Set(record.convergence_target_codes);
      const plateauHasBlocking = record.discrepancies.some(
        (item) => plateauTargets.has(item.code) && item.severity === "BLOCKING"
      );
      return {
        handle,
        state: "BLOCKED",
        attempt: record.attempt,
        verification_request: structuredClone(record.verification_request),
        blocked_reason: plateauHasBlocking
          ? "BLOCKING_PLATEAU_REQUIRES_NEW_EVIDENCE"
          : "QUALITY_PLATEAU_NO_GAIN",
      };
    }

    if (record.attempt >= 2) {
      return {
        handle,
        state: "BLOCKED",
        attempt: 2,
        verification_request: structuredClone(record.verification_request),
        blocked_reason: "CORRECTION_ATTEMPT_LIMIT",
      };
    }

    if (
      record.attempt > 0 &&
      record.last_attempt_evidence_fingerprint === record.evidence_fingerprint
    ) {
      return {
        handle,
        state: "BLOCKED",
        attempt: record.attempt as 1 | 2,
        verification_request: structuredClone(record.verification_request),
        blocked_reason: "REPEATED_FAILURE_WITHOUT_NEW_EVIDENCE",
      };
    }

    const prioritized = prioritizeMinecraftDiscrepancies(record.discrepancies);
    const focus = prioritized[0] ?? null;
    const diagnosis = focus ? diagnoseMinecraftDiscrepancy(focus) : null;

    const targetedFocus = (candidate: CorrectionCandidate<GeometryCorrectionPatch>) => {
      const codes = candidate.patch.target_discrepancy_codes;
      return focus !== null && codes !== undefined && codes.includes(focus.code);
    };

    if (diagnosis?.evidence_backed) {
      const executableRoute =
        diagnosis.repair_route === "TRANSLATE" ||
        diagnosis.repair_route === "RESIZE" ||
        diagnosis.repair_route === "ROTATE" ||
        diagnosis.repair_route === "LAYER_OFFSET";

      if (!executableRoute && candidates.some(targetedFocus)) {
        return {
          handle,
          state: "BLOCKED",
          attempt: record.attempt,
          verification_request: structuredClone(record.verification_request),
          blocked_reason: "CAUSE_REQUIRES_OWNER_ROUTE",
        };
      }

      if (
        executableRoute &&
        candidates.some(
          (candidate) =>
            targetedFocus(candidate) &&
            candidate.patch.correction_family !== diagnosis.repair_route
        )
      ) {
        return {
          handle,
          state: "BLOCKED",
          attempt: record.attempt,
          verification_request: structuredClone(record.verification_request),
          blocked_reason: "CAUSAL_REPAIR_MISMATCH",
        };
      }
    }

    const budget = candidateBudget(record.verification_request);
    if (candidates.length > budget) {
      return {
        handle,
        state: "BLOCKED",
        attempt: Math.min(2, record.attempt + 1) as 1 | 2,
        verification_request: structuredClone(record.verification_request),
        blocked_reason: "CANDIDATE_BUDGET_EXCEEDED",
      };
    }

    const familyMismatch = candidates.some((candidate) => {
      const family = candidate.patch.correction_family;
      return (
        family !== undefined &&
        !correctionFamilyMatchesOperation(family, candidate.patch.intent.operation)
      );
    });
    if (familyMismatch) {
      return {
        handle,
        state: "BLOCKED",
        attempt: Math.min(2, record.attempt + 1) as 1 | 2,
        verification_request: structuredClone(record.verification_request),
        blocked_reason: "CORRECTION_FAMILY_MISMATCH",
      };
    }

    let decision;
    try {
      decision = selectLowestCostCorrection(candidates, options);
    } catch {
      return {
        handle,
        state: "BLOCKED",
        attempt: Math.min(2, record.attempt + 1) as 1 | 2,
        verification_request: structuredClone(record.verification_request),
        blocked_reason: "NO_ELIGIBLE_CORRECTION",
      };
    }

    const requestedCodes = decision.selected.patch.target_discrepancy_codes;
    let reverificationDiscrepancies = [...record.discrepancies];
    if (requestedCodes !== undefined) {
      const uniqueCodes = [...new Set(requestedCodes)];
      if (uniqueCodes.length === 0) {
        return {
          handle,
          state: "BLOCKED",
          attempt: Math.min(2, record.attempt + 1) as 1 | 2,
          verification_request: structuredClone(record.verification_request),
          blocked_reason: "NO_ELIGIBLE_CORRECTION",
        };
      }
      const byCode = new Map(record.discrepancies.map((item) => [item.code, item]));
      const missing = uniqueCodes.filter((code) => !byCode.has(code));
      if (missing.length > 0) {
        return {
          handle,
          state: "BLOCKED",
          attempt: Math.min(2, record.attempt + 1) as 1 | 2,
          verification_request: structuredClone(record.verification_request),
          blocked_reason: "NO_ELIGIBLE_CORRECTION",
        };
      }
      reverificationDiscrepancies = uniqueCodes.map((code) => byCode.get(code)!);
    }

    const geometryRequest =
      record.verification_request.domain === "GEOMETRY"
        ? record.verification_request
        : null;
    const fallbackViews = geometryRequest?.views ?? [];
    const targetedViews = [
      ...new Set(
        reverificationDiscrepancies.flatMap((item) => item.views ?? [])
      ),
    ];
    const fullEvidenceHasViewProvenance =
      record.discrepancies.length > 0 &&
      record.discrepancies.every(
        (item) => Array.isArray(item.views) && item.views.length > 0
      );
    const targetedEvidenceHasViewProvenance =
      reverificationDiscrepancies.length > 0 &&
      reverificationDiscrepancies.every(
        (item) => Array.isArray(item.views) && item.views.length > 0
      );
    const knownEvidenceViews = fullEvidenceHasViewProvenance
      ? (Object.keys(record.view_evidence_handles) as ModelView[])
      : [];
    const canReuseViews =
      fullEvidenceHasViewProvenance && targetedEvidenceHasViewProvenance;
    const staleViews = canReuseViews ? targetedViews : [...fallbackViews];
    const reusableViews = canReuseViews
      ? knownEvidenceViews.filter((view) => !staleViews.includes(view))
      : [];
    const reusableEvidence = reusableViews.flatMap((view) => {
      const evidenceHandle = record.view_evidence_handles[view];
      return evidenceHandle ? [{ view, handle: evidenceHandle }] : [];
    });

    const nextRecipe = rewriteAuthoringRecipeForSemanticEdit(
      record.base_recipe,
      decision.selected.patch.intent
    );
    const rebuild = planIncrementalRecipeRebuild(record.base_recipe, nextRecipe);
    record.base_recipe = structuredClone(nextRecipe);
    record.attempt = (record.attempt + 1) as 1 | 2;
    record.last_attempt_evidence_fingerprint = record.evidence_fingerprint;
    record.last_attempt_target_snapshot = structuredClone(
      reverificationDiscrepancies
    );
    record.pending_target_discrepancy_codes = reverificationDiscrepancies.map(
      (item) => item.code
    );
    record.convergence_state = "PENDING_VERIFICATION";
    record.convergence_target_codes = [
      ...record.pending_target_discrepancy_codes,
    ];
    record.pending_stale_views = [...staleViews];

    return {
      handle,
      continuation_mode: "DECISION_SUMMARY",
      state: "CORRECTION_READY",
      attempt: record.attempt,
      decision_summary: {
        selected_candidate_id: decision.selected.id,
        rejected_candidate_ids: [...decision.rejected_ids],
        selected_metrics: {
          predicted_error: decision.selected.predicted_error,
          mutation_cost: decision.selected.mutation_cost,
          risk: decision.selected.risk,
        },
        solver_score: decision.score,
        candidate_count: candidates.length,
        candidate_budget: budget,
      },
      next_recipe: nextRecipe,
      rebuild,
      verification_request: structuredClone(record.verification_request),
      reverification_discrepancies: structuredClone(reverificationDiscrepancies),
      evidence_reuse: {
        source_handle: record.verification_evidence_handle,
        stale_views: [...staleViews],
        reusable_views: [...reusableViews],
        reusable_evidence: structuredClone(reusableEvidence),
        basis: canReuseViews
          ? "TARGETED_VIEW_PROVENANCE"
          : "CONSERVATIVE_ALL_VIEWS",
      },
    };
  }

  setScopeIdentity(scopeIdentity: string): void {
    if (!scopeIdentity) {
      throw new Error("Correction loop scope identity must be non-empty.");
    }
    if (scopeIdentity === this.scopeIdentity) return;
    this.entries.clear();
    this.scopeIdentity = scopeIdentity;
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}
