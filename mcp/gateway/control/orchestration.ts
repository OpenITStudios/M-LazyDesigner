import type {
  ControlAuthoringDomain,
  ControlDelta,
  ControlFreshnessScope,
  ControlVerificationScope,
} from "./types";

export type ControlNextActionKind =
  | "CONTINUE"
  | "STATUS"
  | "RECOVER"
  | "HANDOFF"
  | "VERIFY_FOCUSED"
  | "VERIFY_VISUAL"
  | "REVIEW_RETURNED_EVIDENCE";

export type ControlNextAction = {
  kind: ControlNextActionKind;
  reason: string;
  recommended_capability: string | null;
  target_domain: ControlAuthoringDomain | null;
  verification_scope: ControlVerificationScope | null;
};

export type ControlCohortBoundary = "CONTINUE" | "COMPLETE";

export type ControlPendingVerification = {
  verification_class: ControlDelta["verification_class"];
  verification_scope: ControlVerificationScope | null;
  freshness_basis: ControlDelta["freshness"]["basis"];
  stale: ControlFreshnessScope[];
  unknown: ControlFreshnessScope[];
};

export type ControlContinuation = {
  protocol: "lazydesigner-continuation-action-v1";
  state_revision: number;
  project_uuid: string | null;
  owner: ControlAuthoringDomain;
  next_action: ControlNextAction;
  context: {
    preserve_current: boolean;
    reorient_required: boolean;
  };
  freshness: {
    basis: ControlDelta["freshness"]["basis"];
    stale: ControlFreshnessScope[];
    unknown: ControlFreshnessScope[];
  };
  cohort?: {
    task_context_id: string;
    boundary: ControlCohortBoundary;
    deferred: boolean;
    pending_verification_class: ControlDelta["verification_class"];
  };
};

export type ControlExecutionState = {
  protocol: "lazydesigner-execution-v1";
  revision: number;
  project_uuid: string | null;
  phase: ControlDelta["phase_after"];
  owner: ControlAuthoringDomain;
  last_capability: string;
  last_freshness: ControlDelta["freshness"];
  pending_action: ControlNextAction;
  task_context_id: string | null;
  pending_verification: ControlPendingVerification | null;
};

function visualRecommendedCapability(
  scope: ControlVerificationScope | null
): string | null {
  if (!scope) return null;
  if (scope.kind === "CUBE_TARGETS") return "capture_model_views";
  if (scope.kind === "TEXTURE_REGION") {
    return scope.evidence_source === "follow_up_read" ? "get_texture" : null;
  }
  return null;
}

export function nextActionForControlDelta(delta: ControlDelta): ControlNextAction {
  if (delta.freshness.basis === "UNKNOWN_OUTCOME") {
    return {
      kind: "RECOVER",
      reason: "mutation outcome is uncertain; do not auto-retry",
      recommended_capability: null,
      target_domain: delta.authoring_domain,
      verification_scope: delta.verification_scope,
    };
  }

  if (delta.requires_status_refresh) {
    return {
      kind: "STATUS",
      reason: "project or authoring authority changed",
      recommended_capability: "status",
      target_domain: delta.authoring_domain,
      verification_scope: null,
    };
  }

  if (delta.next_intent === "AUTHOR_PARTICLE_TEXTURE_THEN_RESUME") {
    return {
      kind: "HANDOFF",
      reason: "particle texture dependency requires Texturing before Animation resumes",
      recommended_capability: null,
      target_domain: "TEXTURING",
      verification_scope: null,
    };
  }

  if (delta.verification_class === "focused_read") {
    return {
      kind: "VERIFY_FOCUSED",
      reason: "mutation receipt is insufficient for the affected state",
      recommended_capability: null,
      target_domain: delta.authoring_domain,
      verification_scope: delta.verification_scope,
    };
  }

  if (delta.verification_class === "visual") {
    if (
      delta.verification_scope?.kind === "TEXTURE_REGION" &&
      delta.verification_scope.evidence_source === "mutation_response"
    ) {
      return {
        kind: "REVIEW_RETURNED_EVIDENCE",
        reason: "decision-changing visual evidence is already present in the mutation receipt",
        recommended_capability: null,
        target_domain: delta.authoring_domain,
        verification_scope: delta.verification_scope,
      };
    }

    return {
      kind: "VERIFY_VISUAL",
      reason: "decision-changing visual evidence is required",
      recommended_capability: visualRecommendedCapability(delta.verification_scope),
      target_domain: delta.authoring_domain,
      verification_scope: delta.verification_scope,
    };
  }

  return {
    kind: "CONTINUE",
    reason:
      delta.verification_class === "receipt_only"
        ? "authoritative receipt is sufficient"
        : "no additional verification is required",
    recommended_capability: null,
    target_domain: delta.authoring_domain,
    verification_scope: null,
  };
}

const VERIFICATION_RANK: Readonly<
  Record<ControlDelta["verification_class"], number>
> = {
  not_applicable: 0,
  receipt_only: 1,
  focused_read: 2,
  visual: 3,
};

function strongerVerificationClass(
  left: ControlDelta["verification_class"],
  right: ControlDelta["verification_class"]
): ControlDelta["verification_class"] {
  return VERIFICATION_RANK[right] > VERIFICATION_RANK[left] ? right : left;
}

function mergeVerificationScope(
  left: ControlVerificationScope | null,
  right: ControlVerificationScope | null
): ControlVerificationScope | null {
  if (!left) return right;
  if (!right) return left;
  if (left.kind !== right.kind) return null;

  if (left.kind === "CUBE_TARGETS" && right.kind === "CUBE_TARGETS") {
    return {
      kind: "CUBE_TARGETS",
      cube_uuids: [...new Set([...left.cube_uuids, ...right.cube_uuids])],
      framing: {
        min: [
          Math.min(left.framing.min[0], right.framing.min[0]),
          Math.min(left.framing.min[1], right.framing.min[1]),
          Math.min(left.framing.min[2], right.framing.min[2]),
        ],
        max: [
          Math.max(left.framing.max[0], right.framing.max[0]),
          Math.max(left.framing.max[1], right.framing.max[1]),
          Math.max(left.framing.max[2], right.framing.max[2]),
        ],
      },
    };
  }

  if (left.kind === "TEXTURE_REGION" && right.kind === "TEXTURE_REGION") {
    if (left.texture_uuid !== right.texture_uuid) return null;
    // A cohort's latest source revision wins, but two cropped PNGs from
    // different revisions are NOT one current image of their union.
    const union: [number, number, number, number] = [
      Math.min(left.affected_rect[0], right.affected_rect[0]),
      Math.min(left.affected_rect[1], right.affected_rect[1]),
      Math.max(left.affected_rect[2], right.affected_rect[2]),
      Math.max(left.affected_rect[3], right.affected_rect[3]),
    ];
    const latestReturnedImageCoversUnion =
      right.evidence_source === "mutation_response" &&
      right.affected_rect[0] <= union[0] &&
      right.affected_rect[1] <= union[1] &&
      right.affected_rect[2] >= union[2] &&
      right.affected_rect[3] >= union[3];
    return {
      kind: "TEXTURE_REGION",
      texture_uuid: right.texture_uuid,
      affected_rect: union,
      revision: right.revision,
      evidence_source: latestReturnedImageCoversUnion
        ? "mutation_response"
        : "follow_up_read",
    };
  }

  if (left.kind === "ANIMATION_RANGE" && right.kind === "ANIMATION_RANGE") {
    if (
      left.animation_uuid !== right.animation_uuid ||
      left.bone_uuid !== right.bone_uuid ||
      left.channel !== right.channel
    ) {
      return null;
    }
    const start = Math.min(left.time_range[0], right.time_range[0]);
    const end = Math.max(left.time_range[1], right.time_range[1]);
    // Each edit window has meaningful start/impact/end samples. Taking only
    // the midpoint of their union can miss two separate changed intervals.
    const sampleTimes = [...new Set([
      ...left.review.sample_times,
      ...right.review.sample_times,
      start,
      end,
    ])].sort((a, b) => a - b);
    // Beyond a bounded review budget, do not drop sampled events silently.
    // The caller must use broader review or split the editing cohort.
    if (sampleTimes.length > 12) return null;
    return {
      kind: "ANIMATION_RANGE",
      animation_uuid: right.animation_uuid,
      bone_uuid: right.bone_uuid,
      channel: right.channel,
      time_range: [start, end],
      review: {
        bone_ids: [...new Set([...left.review.bone_ids, ...right.review.bone_ids])],
        range: { start, end },
        sample_times: sampleTimes,
      },
    };
  }

  return null;
}

const FRESHNESS_RANK: Readonly<
  Record<ControlDelta["freshness"]["basis"], number>
> = {
  NO_CHANGE: 0,
  PRECISE_EFFECT: 1,
  CONSERVATIVE_EFFECT: 2,
  UNKNOWN_OUTCOME: 3,
};

function strongerFreshnessBasis(
  left: ControlDelta["freshness"]["basis"],
  right: ControlDelta["freshness"]["basis"]
): ControlDelta["freshness"]["basis"] {
  return FRESHNESS_RANK[right] > FRESHNESS_RANK[left] ? right : left;
}

function pendingVerificationFromDelta(delta: ControlDelta): ControlPendingVerification {
  return {
    verification_class: delta.verification_class,
    verification_scope: delta.verification_scope,
    freshness_basis: delta.freshness.basis,
    stale: [...delta.freshness.stale],
    unknown: [...delta.freshness.unknown],
  };
}

function mergePendingVerification(
  left: ControlPendingVerification | null,
  right: ControlPendingVerification
): ControlPendingVerification {
  if (!left) return right;
  // An earlier or later visual mutation with unknown affected scope must
  // remain broad. Inheriting the other call's precise scope would silently
  // omit the unbounded mutation at cohort completion.
  const unboundedVisual =
    (left.verification_class === "visual" && left.verification_scope === null) ||
    (right.verification_class === "visual" && right.verification_scope === null);
  return {
    verification_class: strongerVerificationClass(
      left.verification_class,
      right.verification_class
    ),
    verification_scope: unboundedVisual ? null : mergeVerificationScope(
      left.verification_scope,
      right.verification_scope
    ),
    freshness_basis: strongerFreshnessBasis(
      left.freshness_basis,
      right.freshness_basis
    ),
    stale: [...new Set([...left.stale, ...right.stale])],
    unknown: [...new Set([...left.unknown, ...right.unknown])],
  };
}

function cohortCompletionAction(
  delta: ControlDelta,
  pending: ControlPendingVerification
): ControlNextAction {
  return nextActionForControlDelta({
    ...delta,
    verification_class: pending.verification_class,
    verification_scope: pending.verification_scope,
    freshness: {
      ...delta.freshness,
      stale: pending.stale,
      unknown: pending.unknown,
    },
  });
}

/**
 * Ephemeral deterministic reducer for the Gateway process.
 *
 * It intentionally stores only current execution/cohort state. Durable asset
 * truth stays in Workspace/Runtime and conversation history stays client-owned.
 *
 * Cohort metadata is opt-in. Without a task_context_id, or with the default
 * COMPLETE boundary, behavior remains equivalent to one-call continuation.
 */
export function reduceControlExecutionState(
  previous: ControlExecutionState | null,
  delta: ControlDelta,
  options: {
    taskContextId?: string | null;
    cohortBoundary?: ControlCohortBoundary;
  } = {}
): {
  state: ControlExecutionState;
  continuation: ControlContinuation;
} {
  const taskContextId = options.taskContextId?.trim() || null;
  const cohortBoundary = options.cohortBoundary ?? "COMPLETE";
  const sameProject =
    previous !== null &&
    previous.project_uuid !== null &&
    previous.project_uuid === delta.project_uuid;
  const sameCohort =
    sameProject &&
    taskContextId !== null &&
    previous?.task_context_id === taskContextId;
  const revision = sameProject ? previous.revision + 1 : 1;

  const immediateAction = nextActionForControlDelta(delta);
  const hardBoundary =
    immediateAction.kind === "RECOVER" ||
    immediateAction.kind === "STATUS" ||
    immediateAction.kind === "HANDOFF";

  const currentPending = pendingVerificationFromDelta(delta);
  const mergedPending = mergePendingVerification(
    sameCohort ? previous?.pending_verification ?? null : null,
    currentPending
  );

  const defer =
    taskContextId !== null &&
    cohortBoundary === "CONTINUE" &&
    !hardBoundary;

  const pendingAction = defer
    ? {
        kind: "CONTINUE" as const,
        reason:
          "verification deferred to the explicit end of this task context cohort",
        recommended_capability: null,
        target_domain: delta.authoring_domain,
        verification_scope: null,
      }
    : hardBoundary
      ? immediateAction
      : cohortCompletionAction(delta, mergedPending);

  const state: ControlExecutionState = {
    protocol: "lazydesigner-execution-v1",
    revision,
    project_uuid: delta.project_uuid,
    phase: delta.phase_after,
    owner: delta.authoring_domain,
    last_capability: delta.capability,
    last_freshness: delta.freshness,
    pending_action: pendingAction,
    task_context_id: taskContextId,
    pending_verification: defer ? mergedPending : null,
  };

  return {
    state,
    continuation: {
      protocol: "lazydesigner-continuation-action-v1",
      state_revision: revision,
      project_uuid: delta.project_uuid,
      owner: delta.authoring_domain,
      next_action: pendingAction,
      context: {
        preserve_current: !delta.requires_status_refresh,
        reorient_required: delta.requires_status_refresh,
      },
      freshness: {
        basis: mergedPending.freshness_basis,
        stale: [...mergedPending.stale],
        unknown: [...mergedPending.unknown],
      },
      ...(taskContextId
        ? {
            cohort: {
              task_context_id: taskContextId,
              boundary: cohortBoundary,
              deferred: defer,
              pending_verification_class: mergedPending.verification_class,
            },
          }
        : {}),
    },
  };
}
