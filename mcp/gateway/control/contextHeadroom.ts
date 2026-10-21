import { createHash } from "node:crypto";
import type { ControlStageContext } from "./contextProjection";

export const CONTROL_GATEWAY_ENVELOPE_PROXY_BYTES = 8192;
export const CONTROL_CONTINUATION_RESERVE_PROXY_BYTES = 2048;
// Compatibility/export convenience: maximum stage allowance when the rest of
// the envelope is empty. Real allowance is computed from the current envelope.
export const CONTROL_STAGE_CONTEXT_HEADROOM_BYTES =
  CONTROL_GATEWAY_ENVELOPE_PROXY_BYTES -
  CONTROL_CONTINUATION_RESERVE_PROXY_BYTES;

export type ControlStageContextHeadroomState =
  | "WITHIN_BUDGET"
  | "BOUNDED"
  | "REQUIRED_OVER_BUDGET";

export type ControlHeadroomPolicy = {
  envelope_bytes: number;
  continuation_reserve_bytes: number;
};

export const DEFAULT_CONTROL_HEADROOM_POLICY: ControlHeadroomPolicy = {
  envelope_bytes: CONTROL_GATEWAY_ENVELOPE_PROXY_BYTES,
  continuation_reserve_bytes: CONTROL_CONTINUATION_RESERVE_PROXY_BYTES,
};

export type ProjectedControlStageContext = {
  context_type: ControlStageContext["context_type"];
  context_hash: string;
  original_user_intent: string | null;
  current_user_delta: string | null;
  selected_profile: string | null;
  reference_package_id_or_hash: string | null;
  workspace_revision_or_hash: string | null;
  stage_readiness: string | null;
  blocking_unknowns: string[];
  requirements: ControlStageContext["requirements"];
  decision_packet?: ControlStageContext["decision_packet"];
  asset_health: ControlStageContext["asset_health"];
  reference_recovery?: ControlStageContext["reference_recovery"];
  reference_image_ids: string[];
  workspace: {
    asset: string | null;
    current_stage: string | null;
    gates: ControlStageContext["workspace"]["gates"];
    next_step?: string | null;
  };
  non_blocking_unknowns_relevant_to_stage?: string[];
  reference_document?: string | null;
  headroom_state?: "REQUIRED_OVER_BUDGET";
};

export type ControlStageContextHeadroomDiagnostics = {
  budget_bytes: number;
  before_bytes: number;
  after_bytes: number;
  required_bytes: number;
  useful_bytes: number;
  non_required_bytes: number;
  dropped_fields: string[];
  dropped_useful_items: number;
  required_over_budget: boolean;
  state: ControlStageContextHeadroomState;
  projection_hash: string;
};

export type ControlEnvelopeHeadroomDiagnostics = {
  envelope_budget_bytes: number;
  continuation_reserve_bytes: number;
  fixed_envelope_bytes: number;
  stage_allowance_bytes: number;
  final_envelope_bytes: number;
  envelope_over_budget: boolean;
  stage: ControlStageContextHeadroomDiagnostics | null;
};

export function serializedUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function projectionHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hasDecisionPacket(
  packet: ControlStageContext["decision_packet"]
): boolean {
  return Object.keys(packet).length > 0;
}

function requiredProjection(
  context: ControlStageContext
): ProjectedControlStageContext {
  return {
    context_type: context.context_type,
    context_hash: context.context_hash,
    original_user_intent: context.original_user_intent,
    current_user_delta: context.current_user_delta,
    selected_profile: context.selected_profile,
    reference_package_id_or_hash: context.reference_package_id_or_hash,
    workspace_revision_or_hash: context.workspace_revision_or_hash,
    stage_readiness: context.stage_readiness,
    blocking_unknowns: [...context.blocking_unknowns],
    requirements: context.requirements,
    ...(hasDecisionPacket(context.decision_packet)
      ? { decision_packet: context.decision_packet }
      : {}),
    asset_health: context.asset_health,
    // Never hide a relevant source-recovery route to satisfy the byte proxy.
    ...(context.reference_recovery
      ? { reference_recovery: context.reference_recovery }
      : {}),
    // These IDs identify the stage-approved visual evidence set. Dropping them
    // based only on size can silently reduce reference fidelity.
    reference_image_ids: [...context.reference_image_ids],
    workspace: {
      asset: context.workspace.asset,
      current_stage: context.workspace.current_stage,
      gates: context.workspace.gates,
    },
  };
}

function fitsBudget(value: unknown, budgetBytes: number): boolean {
  return serializedUtf8Bytes(value) <= budgetBytes;
}

function addStringItemsWithinBudget(
  base: ProjectedControlStageContext,
  field: "non_blocking_unknowns_relevant_to_stage",
  values: readonly string[],
  budgetBytes: number
): { context: ProjectedControlStageContext; dropped: number } {
  if (values.length === 0) return { context: base, dropped: 0 };
  // This field is absent from requiredProjection. JSON adds a single field
  // before the closing object brace; measure its exact UTF-8 JSON overhead
  // once instead of serializing the growing entire context for every item.
  const fieldOverhead = new TextEncoder().encode(
    `,${JSON.stringify(field)}:[]`
  ).byteLength;
  let currentBytes = serializedUtf8Bytes(base);
  const accepted: string[] = [];
  for (const value of values) {
    const itemBytes = serializedUtf8Bytes(value);
    const addedBytes = itemBytes + (accepted.length === 0 ? fieldOverhead : 1);
    // A long optional item must not prevent later, shorter useful items from
    // fitting. Preserve original order among accepted items.
    if (currentBytes + addedBytes > budgetBytes) continue;
    currentBytes += addedBytes;
    accepted.push(value);
  }
  return {
    context: accepted.length > 0 ? { ...base, [field]: accepted } : base,
    dropped: values.length - accepted.length,
  };
}

export function normalizeControlHeadroomPolicy(
  policy: Partial<ControlHeadroomPolicy> = {}
): ControlHeadroomPolicy {
  const envelope = Number.isFinite(policy.envelope_bytes)
    ? Math.max(1024, Math.trunc(policy.envelope_bytes!))
    : DEFAULT_CONTROL_HEADROOM_POLICY.envelope_bytes;
  const requestedReserve = Number.isFinite(policy.continuation_reserve_bytes)
    ? Math.max(0, Math.trunc(policy.continuation_reserve_bytes!))
    : DEFAULT_CONTROL_HEADROOM_POLICY.continuation_reserve_bytes;
  return {
    envelope_bytes: envelope,
    continuation_reserve_bytes: Math.min(
      requestedReserve,
      Math.max(0, envelope - 1)
    ),
  };
}

/**
 * Bounds only the dynamic stage projection. REQUIRED decision evidence always
 * wins over the proxy budget. This is a byte regression proxy, never a token
 * or model-context-window claim.
 */
export function projectControlStageContextWithHeadroom(
  context: ControlStageContext,
  budgetBytes: number = CONTROL_STAGE_CONTEXT_HEADROOM_BYTES
): {
  context: ProjectedControlStageContext;
  diagnostics: ControlStageContextHeadroomDiagnostics;
} {
  const normalizedBudget = Number.isFinite(budgetBytes)
    ? Math.max(1, Math.trunc(budgetBytes))
    : CONTROL_STAGE_CONTEXT_HEADROOM_BYTES;
  const beforeBytes = serializedUtf8Bytes(context);
  const required = requiredProjection(context);
  const requiredBytes = serializedUtf8Bytes(required);

  if (requiredBytes > normalizedBudget) {
    const projected = {
      ...required,
      headroom_state: "REQUIRED_OVER_BUDGET" as const,
    };
    return {
      context: projected,
      diagnostics: {
        budget_bytes: normalizedBudget,
        before_bytes: beforeBytes,
        after_bytes: serializedUtf8Bytes(projected),
        required_bytes: requiredBytes,
        useful_bytes: 0,
        non_required_bytes: Math.max(0, beforeBytes - requiredBytes),
        dropped_fields: [
          "non_blocking_unknowns_relevant_to_stage",
          "reference_document",
          "workspace.next_step",
        ],
        dropped_useful_items:
          context.non_blocking_unknowns_relevant_to_stage.length +
          (context.reference_document ? 1 : 0) +
          (context.workspace.next_step ? 1 : 0),
        required_over_budget: true,
        state: "REQUIRED_OVER_BUDGET",
        projection_hash: projectionHash(projected),
      },
    };
  }

  let projected = required;
  let droppedUsefulItems = 0;
  const droppedFields: string[] = [];

  const unknowns = addStringItemsWithinBudget(
    projected,
    "non_blocking_unknowns_relevant_to_stage",
    context.non_blocking_unknowns_relevant_to_stage,
    normalizedBudget
  );
  projected = unknowns.context;
  droppedUsefulItems += unknowns.dropped;
  if (unknowns.dropped > 0) {
    droppedFields.push("non_blocking_unknowns_relevant_to_stage");
  }

  if (context.reference_document) {
    const candidate = { ...projected, reference_document: context.reference_document };
    if (fitsBudget(candidate, normalizedBudget)) projected = candidate;
    else {
      droppedUsefulItems += 1;
      droppedFields.push("reference_document");
    }
  }

  if (context.workspace.next_step) {
    const candidate = {
      ...projected,
      workspace: { ...projected.workspace, next_step: context.workspace.next_step },
    };
    if (fitsBudget(candidate, normalizedBudget)) projected = candidate;
    else {
      droppedUsefulItems += 1;
      droppedFields.push("workspace.next_step");
    }
  }

  const afterBytes = serializedUtf8Bytes(projected);
  return {
    context: projected,
    diagnostics: {
      budget_bytes: normalizedBudget,
      before_bytes: beforeBytes,
      after_bytes: afterBytes,
      required_bytes: requiredBytes,
      useful_bytes: Math.max(0, afterBytes - requiredBytes),
      non_required_bytes: Math.max(0, beforeBytes - requiredBytes),
      dropped_fields: droppedFields,
      dropped_useful_items: droppedUsefulItems,
      required_over_budget: false,
      state:
        droppedUsefulItems > 0 || beforeBytes > afterBytes
          ? "BOUNDED"
          : "WITHIN_BUDGET",
      projection_hash: projectionHash(projected),
    },
  };
}
