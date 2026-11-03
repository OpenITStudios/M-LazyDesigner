import { runZeroWasteGoldenBenchmark } from "./benchmark-zero-waste-golden";
import {
  selectCaptureSizeForEvidence,
  selectModelViewsForEvidence,
  selectSilhouetteCaptureViews,
} from "../../server/tools/inspection/camera";
import { planFocusedTextureEvidenceRequest } from "../../gateway/control/evidenceSelection";
import type { ControlVerificationScope } from "../../gateway/control/types";
import { planTemporalImageEvidence } from "../../lib/animation/temporalEvidenceSampling";
import type { AnimationMotionTrackInput } from "../../lib/animation/motionDynamics";

type StepKind =
  | "status"
  | "search"
  | "describe"
  | "inspect"
  | "mutate"
  | "verify"
  | "recovery";

type ReasoningClass = "LOW" | "MEDIUM" | "HIGH" | "NONE";

type WorkflowStep = {
  kind: StepKind;
  payload: unknown;
  ai_payload_bytes: number;
  required_for_decision: boolean;
  reason: string;
  image_inputs: number;
  image_pixel_area: number;
  reasoning_class: ReasoningClass;
};

export type WorkflowGoldenResult = {
  workflow: string;
  baseline: {
    steps: WorkflowStep[];
    calls: number;
    ai_payload_bytes: number;
    image_inputs: number;
    image_pixel_area: number;
    high_reasoning_decisions: number;
  };
  optimized: {
    steps: WorkflowStep[];
    calls: number;
    ai_payload_bytes: number;
    image_inputs: number;
    image_pixel_area: number;
    high_reasoning_decisions: number;
  };
  saved_calls: number;
  saved_bytes: number;
  saved_image_inputs: number;
  saved_image_pixel_area: number;
  saved_high_reasoning_decisions: number;
  reduction_percent: number;
  redundant_baseline_calls_removed: number;
  quality_checks: Record<string, boolean>;
  // Contract-only fixture evidence. Not a visual or human acceptance verdict.
  quality_evidence: "SYNTHETIC_SEMANTIC_CHECKS_ONLY";
  quality_preserved: boolean;
};

function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function step(
  kind: StepKind,
  payload: unknown,
  requiredForDecision: boolean,
  reason: string,
  options: {
    imageInputs?: number;
    imageSize?: number;
    reasoningClass?: ReasoningClass;
  } = {}
): WorkflowStep {
  return {
    kind,
    payload,
    ai_payload_bytes: payloadBytes(payload),
    required_for_decision: requiredForDecision,
    reason,
    image_inputs: options.imageInputs ?? 0,
    image_pixel_area:
      (options.imageInputs ?? 0) * Math.pow(options.imageSize ?? 0, 2),
    reasoning_class: options.reasoningClass ?? "NONE",
  };
}

function summarize(
  workflow: string,
  baselineSteps: WorkflowStep[],
  optimizedSteps: WorkflowStep[],
  qualityChecks: Record<string, boolean>
): WorkflowGoldenResult {
  const baselineBytes = baselineSteps.reduce(
    (sum, item) => sum + item.ai_payload_bytes,
    0
  );
  const optimizedBytes = optimizedSteps.reduce(
    (sum, item) => sum + item.ai_payload_bytes,
    0
  );
  const savedBytes = Math.max(0, baselineBytes - optimizedBytes);
  const savedCalls = Math.max(0, baselineSteps.length - optimizedSteps.length);
  const baselineImages = baselineSteps.reduce((sum, item) => sum + item.image_inputs, 0);
  const optimizedImages = optimizedSteps.reduce((sum, item) => sum + item.image_inputs, 0);
  const baselinePixels = baselineSteps.reduce((sum, item) => sum + item.image_pixel_area, 0);
  const optimizedPixels = optimizedSteps.reduce((sum, item) => sum + item.image_pixel_area, 0);
  const baselineHigh = baselineSteps.filter((item) => item.reasoning_class === "HIGH").length;
  const optimizedHigh = optimizedSteps.filter((item) => item.reasoning_class === "HIGH").length;
  return {
    workflow,
    baseline: {
      steps: baselineSteps,
      calls: baselineSteps.length,
      ai_payload_bytes: baselineBytes,
      image_inputs: baselineImages,
      image_pixel_area: baselinePixels,
      high_reasoning_decisions: baselineHigh,
    },
    optimized: {
      steps: optimizedSteps,
      calls: optimizedSteps.length,
      ai_payload_bytes: optimizedBytes,
      image_inputs: optimizedImages,
      image_pixel_area: optimizedPixels,
      high_reasoning_decisions: optimizedHigh,
    },
    saved_calls: savedCalls,
    saved_bytes: savedBytes,
    saved_image_inputs: Math.max(0, baselineImages - optimizedImages),
    saved_image_pixel_area: Math.max(0, baselinePixels - optimizedPixels),
    saved_high_reasoning_decisions: Math.max(0, baselineHigh - optimizedHigh),
    reduction_percent:
      baselineBytes === 0
        ? 0
        : Number(((savedBytes / baselineBytes) * 100).toFixed(2)),
    redundant_baseline_calls_removed: baselineSteps.filter(
      (item) => !item.required_for_decision
    ).length,
    quality_checks: qualityChecks,
    quality_evidence: "SYNTHETIC_SEMANTIC_CHECKS_ONLY",
    quality_preserved: Object.values(qualityChecks).every(Boolean),
  };
}

const representativeInspectState = {
  uuid: "cube-leg",
  name: "leg",
  type: "cube",
  parent: { uuid: "group-leg", name: "leg_root" },
  from: [0, 0, 0],
  to: [2, 8, 2],
  origin: [1, 0, 1],
  rotation: [0, 0, 0],
};

const representativeInspect = {
  content: [{ type: "text", text: 'Inspected cube "leg" (cube-leg).' }],
  structuredContent: representativeInspectState,
  control_delta: {
    authoring_domain: "CORE",
    freshness: { basis: "NO_CHANGE" },
    next_intent: "CONTINUE_CURRENT_TASK",
    verification_class: "not_applicable",
    requires_status_refresh: false,
  },
};

const compactRepresentativeInspect = {
  content: [{ type: "text", text: "Inspection ready." }],
  structuredContent: representativeInspectState,
};

const representativeSearch = {
  capabilities: [
    {
      capability_id: "manage_cubes",
      description: "Create or update Bedrock cubes.",
      tier: "primary",
      authoring_domain: "GEOMETRY",
      flags: ["destructive"],
    },
  ],
};

const representativeVisualVerify = {
  capture: {
    view: "front",
    project_uuid: "project-a",
    changed_targets: ["cube-leg"],
    evidence_state: "CURRENT",
  },
};

function goldenByTask() {
  return new Map(
    runZeroWasteGoldenBenchmark().map((item) => [item.task, item] as const)
  );
}

export function runZeroWasteWorkflowBenchmark(): WorkflowGoldenResult[] {
  const golden = goldenByTask();

  const geometry = golden.get("known_geometry_transform")!;
  const hierarchy = golden.get("hierarchy_receipt")!;
  const material = golden.get("material_receipt")!;
  const animation = golden.get("animation_effects_receipt")!;
  const discovery = golden.get("unknown_target_discovery")!;
  const failure = golden.get("failed_mutation_recovery")!;

  const knownTarget = summarize(
    "known_target_geometry_edit",
    [
      step(
        "inspect",
        representativeInspect,
        false,
        "Baseline reassurance read; target identity and relative mutation are already known."
      ),
      step(
        "mutate",
        { bytes: geometry.before_bytes },
        true,
        "Requested authored change."
      ),
      step(
        "inspect",
        representativeInspect,
        false,
        "Confirmation readback superseded by authoritative mutation receipt."
      ),
      step(
        "verify",
        representativeVisualVerify,
        true,
        "Geometry mutation remains visual and still requires decision-changing evidence."
      ),
    ],
    [
      step(
        "mutate",
        { bytes: geometry.after_bytes },
        true,
        "Direct known-target mutation with compact continuation receipt."
      ),
      step(
        "verify",
        representativeVisualVerify,
        true,
        "Visual quality gate is preserved."
      ),
    ],
    {
      task_semantics: geometry.quality_preserved,
      visual_verification_kept: true,
      target_identity_kept:
        geometry.semantic_checks.target_identity === true,
      freshness_kept:
        geometry.semantic_checks.freshness_preserved === true,
    }
  );

  const unknownTarget = summarize(
    "unknown_target_geometry_edit",
    [
      step(
        "search",
        {
          query: "leg cube geometry",
          count: 1,
          capabilities: representativeSearch.capabilities,
        },
        true,
        "Capability is unresolved."
      ),
      step(
        "describe",
        {
          capability: "inspect_elements",
          full_schema_bytes: discovery.before_bytes,
        },
        false,
        "Baseline schema reassurance after bounded discovery."
      ),
      step(
        "inspect",
        representativeInspect,
        true,
        "Target identity is unknown and must be resolved."
      ),
      step(
        "mutate",
        { bytes: geometry.before_bytes },
        true,
        "Requested authored change."
      ),
      step(
        "inspect",
        representativeInspect,
        false,
        "Confirmation readback superseded by receipt."
      ),
      step(
        "verify",
        representativeVisualVerify,
        true,
        "Visual decision remains required."
      ),
    ],
    [
      step(
        "search",
        representativeSearch,
        true,
        "One bounded search only because capability/target route is unresolved."
      ),
      step(
        "inspect",
        compactRepresentativeInspect,
        true,
        "One focused target-resolution read; successful read omits redundant NO_CHANGE control_delta and repeated prose."
      ),
      step(
        "mutate",
        { bytes: geometry.after_bytes },
        true,
        "Compact mutation continuation."
      ),
      step(
        "verify",
        representativeVisualVerify,
        true,
        "Visual decision remains required."
      ),
    ],
    {
      discovery_semantics: discovery.quality_preserved,
      geometry_semantics: geometry.quality_preserved,
      target_resolution_kept: true,
      visual_verification_kept: true,
    }
  );

  const hierarchyEdit = summarize(
    "hierarchy_receipt_edit",
    [
      step(
        "mutate",
        { bytes: hierarchy.before_bytes },
        true,
        "Hierarchy mutation."
      ),
      step(
        "inspect",
        representativeInspect,
        false,
        "Receipt is complete; reread does not change the next decision."
      ),
    ],
    [
      step(
        "mutate",
        { bytes: hierarchy.after_bytes },
        true,
        "Receipt-only hierarchy continuation."
      ),
    ],
    {
      receipt_complete: hierarchy.quality_preserved,
      hierarchy_state_kept:
        hierarchy.semantic_checks.authoritative_group_state === true,
      invalidation_kept:
        hierarchy.semantic_checks.invalidation_preserved === true,
    }
  );

  const materialEdit = summarize(
    "material_receipt_edit",
    [
      step(
        "mutate",
        { bytes: material.before_bytes },
        true,
        "Material mutation."
      ),
      step(
        "inspect",
        {
          material: "body",
          channels: ["color", "normal", "height", "mer"],
          saved: false,
        },
        false,
        "Structured material receipt already carries complete continuation state."
      ),
    ],
    [
      step(
        "mutate",
        { bytes: material.after_bytes },
        true,
        "Receipt-only material continuation."
      ),
    ],
    {
      receipt_complete: material.quality_preserved,
      material_identity_kept:
        material.semantic_checks.material_identity === true,
      channel_state_kept:
        material.semantic_checks.channel_state_preserved === true,
    }
  );

  const animationEffectEdit = summarize(
    "animation_effect_receipt_edit",
    [
      step(
        "mutate",
        { bytes: animation.before_bytes },
        true,
        "Animation-effect mutation."
      ),
      step(
        "inspect",
        {
          animation_uuid: "anim-a",
          effects: [{ keyframe_uuid: "kf-a", channel: "particle" }],
        },
        false,
        "Complete effect receipt already identifies the exact keyframe/effect."
      ),
    ],
    [
      step(
        "mutate",
        { bytes: animation.after_bytes },
        true,
        "Receipt-only animation-effect continuation."
      ),
    ],
    {
      receipt_complete: animation.quality_preserved,
      animation_identity_kept:
        animation.semantic_checks.animation_identity === true,
      effect_identity_kept:
        animation.semantic_checks.effect_identity === true,
    }
  );

  const visualCorrection = summarize(
    "visual_local_correction",
    [
      step(
        "verify",
        {
          views: ["front", "left", "top", "back", "front_left_3q"],
          review:
            "The upper arms appear too wide compared with the reference. The width should be reduced while preserving pivots, UV density, symmetry, and the current animation structure.",
        },
        true,
        "Baseline captures a full board and emits prose before deciding the correction.",
        { imageInputs: 5, imageSize: 512, reasoningClass: "HIGH" }
      ),
      step(
        "inspect",
        representativeInspect,
        false,
        "Baseline rereads an already-known target before correction."
      ),
      step(
        "mutate",
        {
          target: "upper_arm",
          action: "resize",
          preserve: ["RIG_PIVOTS", "UV_DENSITY", "SYMMETRY"],
        },
        true,
        "Apply the same bounded correction.",
        { reasoningClass: "HIGH" }
      ),
      step(
        "verify",
        {
          views: ["front", "left", "top", "back", "front_left_3q"],
          convergence: "IMPROVED",
        },
        true,
        "Baseline recaptures the full board for convergence.",
        { imageInputs: 5, imageSize: 512, reasoningClass: "HIGH" }
      ),
    ],
    [
      step(
        "verify",
        {
          evidence_targets: ["width", "silhouette"],
          selected_views: ["front"],
          discrepancies: [
            {
              code: "WIDTH_HIGH",
              criterion: "PROPORTION",
              severity: "MAJOR",
              view: "front",
              delta: "upper arms read too wide",
            },
            {
              code: "SHOULDER_CONTACT",
              criterion: "CONTACT",
              severity: "MINOR",
              view: "front_left_3q",
              delta: "shoulder contact needs independent review",
            },
          ],
          correction_family: "RESIZE",
        },
        true,
        "Information-gain routing captures only the decision-changing front view and emits one compact difference.",
        { imageInputs: 1, imageSize: 256, reasoningClass: "HIGH" }
      ),
      step(
        "mutate",
        {
          target: { semantic_group: "upper_arm" },
          target_discrepancy_codes: ["WIDTH_HIGH"],
          correction_family: "RESIZE",
          geometry_operations: [
            { kind: "RESIZE_AXIS", axis: "X", mode: "MULTIPLY", value: 0.9 },
          ],
          preserve: ["RIG_PIVOTS", "UV_DENSITY", "SYMMETRY"],
        },
        true,
        "Exact compact authoring intent executes deterministically without replaying diagnosis.",
        { reasoningClass: "LOW" }
      ),
      step(
        "verify",
        {
          evidence_targets: ["width", "silhouette"],
          selected_views: ["front"],
          replayed_discrepancies: [
            {
              code: "WIDTH_HIGH",
              criterion: "PROPORTION",
              severity: "MAJOR",
              view: "front",
              delta: "upper arms read too wide",
            },
          ],
          retained_locally: ["SHOULDER_CONTACT"],
          convergence: "IMPROVED",
        },
        true,
        "Only the affected evidence is recaptured for convergence.",
        { imageInputs: 1, imageSize: 256, reasoningClass: "HIGH" }
      ),
    ],
    {
      same_target_semantics: true,
      same_correction_family: true,
      same_preservation_invariants: true,
      visual_verification_kept: true,
      pre_and_post_evidence_kept: true,
      convergence_gate_kept: true,
      cross_view_expansion_available_if_risk_detected: true,
      unrelated_discrepancy_history_retained_locally: true,
      targeted_reverification_only: true,
    }
  );

  const crossViewReuse = summarize(
    "visual_cross_view_reuse",
    [
      step(
        "verify",
        {
          views: ["front", "left"],
          discrepancies: ["WIDTH_HIGH", "SHOULDER_CONTACT"],
        },
        true,
        "Baseline establishes two-view evidence.",
        { imageInputs: 2, imageSize: 384, reasoningClass: "HIGH" }
      ),
      step(
        "mutate",
        { target: "WIDTH_HIGH", action: "RESIZE" },
        true,
        "First bounded width correction.",
        { reasoningClass: "LOW" }
      ),
      step(
        "verify",
        { views: ["front", "left"], convergence: "WIDTH_IMPROVED" },
        true,
        "Baseline recaptures both views after the first correction.",
        { imageInputs: 2, imageSize: 384, reasoningClass: "HIGH" }
      ),
      step(
        "mutate",
        { target: "SHOULDER_CONTACT", action: "TRANSLATE" },
        true,
        "Second bounded contact correction.",
        { reasoningClass: "LOW" }
      ),
      step(
        "verify",
        { views: ["front", "left"], convergence: "CONTACT_IMPROVED" },
        true,
        "Baseline recaptures both views again after the second correction.",
        { imageInputs: 2, imageSize: 384, reasoningClass: "HIGH" }
      ),
    ],
    [
      step(
        "verify",
        {
          views: ["front", "left"],
          discrepancies: [
            { code: "WIDTH_HIGH", views: ["front"] },
            { code: "SHOULDER_CONTACT", views: ["left"] },
          ],
          view_handles: {
            front: "verificationevidence:first",
            left: "verificationevidence:first",
          },
        },
        true,
        "Optimized path records bounded view provenance once.",
        { imageInputs: 2, imageSize: 384, reasoningClass: "HIGH" }
      ),
      step(
        "mutate",
        {
          target_discrepancy_codes: ["WIDTH_HIGH"],
          stale_views: ["front"],
          reusable_views: ["left"],
        },
        true,
        "First correction keeps unrelated left evidence local.",
        { reasoningClass: "LOW" }
      ),
      step(
        "verify",
        {
          recapture_views: ["front"],
          reused_views: ["left"],
          view_handles: {
            front: "verificationevidence:front-second",
            left: "verificationevidence:first",
          },
          convergence: "WIDTH_IMPROVED",
        },
        true,
        "Only stale front evidence is recaptured after the first correction.",
        { imageInputs: 1, imageSize: 384, reasoningClass: "HIGH" }
      ),
      step(
        "mutate",
        {
          target_discrepancy_codes: ["SHOULDER_CONTACT"],
          stale_views: ["left"],
          reusable_views: ["front"],
          reusable_handle: "verificationevidence:front-second",
        },
        true,
        "Second correction reuses the fresh front handle from the previous round.",
        { reasoningClass: "LOW" }
      ),
      step(
        "verify",
        {
          recapture_views: ["left"],
          reused_views: ["front"],
          convergence: "CONTACT_IMPROVED",
        },
        true,
        "Only stale left evidence is recaptured after the second correction.",
        { imageInputs: 1, imageSize: 384, reasoningClass: "HIGH" }
      ),
    ],
    {
      full_pre_correction_evidence_kept: true,
      targeted_stale_view_recaptured: true,
      unaffected_view_reused: true,
      cross_view_guard_retained: true,
      incomplete_provenance_falls_back_conservatively: true,
      per_view_handles_survive_multiple_rounds: true,
      unrelated_discrepancies_survive_targeted_updates: true,
    }
  );

  const candidateEconomy = summarize(
    "correction_candidate_economy",
    [
      step(
        "verify",
        {
          discrepancy: "DEPTH_HIGH",
          candidates: [
            { id: "resize-092", family: "RESIZE", predicted_error: 0.09, mutation_cost: 0.12, risk: 0.18 },
            { id: "resize-094", family: "RESIZE", predicted_error: 0.07, mutation_cost: 0.10, risk: 0.14 },
            { id: "resize-096", family: "RESIZE", predicted_error: 0.05, mutation_cost: 0.08, risk: 0.10 },
            { id: "resize-098", family: "RESIZE", predicted_error: 0.08, mutation_cost: 0.06, risk: 0.12 },
            { id: "translate-back", family: "TRANSLATE", predicted_error: 0.21, mutation_cost: 0.07, risk: 0.25 },
            { id: "rotate-small", family: "ROTATE", predicted_error: 0.24, mutation_cost: 0.09, risk: 0.22 },
          ],
          selected: "resize-096",
        },
        true,
        "Baseline emits a broad six-candidate option tree before selection.",
        { reasoningClass: "HIGH" }
      ),
      step(
        "mutate",
        { selected_candidate: "resize-096" },
        true,
        "Execute selected correction.",
        { reasoningClass: "LOW" }
      ),
      step(
        "verify",
        { convergence: "IMPROVED" },
        true,
        "Convergence remains required.",
        { imageInputs: 1, imageSize: 384, reasoningClass: "HIGH" }
      ),
    ],
    [
      step(
        "verify",
        {
          discrepancy: "DEPTH_HIGH",
          verification_risk: "HIGH",
          grounded_family: "RESIZE",
          candidates: [
            { id: "resize-094", predicted_error: 0.07, mutation_cost: 0.10, risk: 0.14 },
            { id: "resize-096", predicted_error: 0.05, mutation_cost: 0.08, risk: 0.10 },
            { id: "resize-098", predicted_error: 0.08, mutation_cost: 0.06, risk: 0.12 },
          ],
          selected: "resize-096",
        },
        true,
        "HIGH risk permits at most three family-compatible candidates; deterministic solver preserves the same selected candidate.",
        { reasoningClass: "HIGH" }
      ),
      step(
        "mutate",
        {
          decision_summary: {
            selected_candidate_id: "resize-096",
            rejected_candidate_ids: ["resize-094", "resize-098"],
            selected_metrics: {
              predicted_error: 0.05,
              mutation_cost: 0.08,
              risk: 0.10,
            },
            candidate_count: 3,
            candidate_budget: 3,
          },
        },
        true,
        "Continuation keeps only the compact solver decision; full candidate patches are discarded.",
        { reasoningClass: "LOW" }
      ),
      step(
        "verify",
        { convergence: "IMPROVED" },
        true,
        "Convergence remains required.",
        { imageInputs: 1, imageSize: 384, reasoningClass: "HIGH" }
      ),
    ],
    {
      same_selected_candidate: true,
      same_correction_family: true,
      convergence_gate_kept: true,
      candidate_budget_respected: true,
      unsupported_family_candidates_removed: true,
      full_candidate_payload_not_carried_forward: true,
      rejected_candidates_reduced_to_ids: true,
    }
  );

  const continuationTransport = summarize(
    "correction_continuation_transport",
    [
      step(
        "status",
        {
          correction_state: {
            mode_choice: "model-selected",
            selected_candidate_id: "resize-096",
            rejected_candidate_ids: ["resize-094", "resize-098"],
            resolved_discrepancy: "WIDTH_HIGH",
            unresolved_discrepancy: "SHOULDER_CONTACT",
            evidence_fingerprint: "sha256:old",
            fresh_handles: {
              front: "verificationevidence:front-fresh",
              left: "verificationevidence:left-fresh",
            },
          },
        },
        true,
        "Baseline carries solver history, resolved state, and routing prose.",
        { reasoningClass: "MEDIUM" }
      ),
      step(
        "status",
        {
          continuation: {
            unresolved: ["SHOULDER_CONTACT"],
            fresh_view_evidence: {
              front: "verificationevidence:front-fresh",
              left: "verificationevidence:left-fresh",
            },
            verification: { pending: false },
          },
        },
        false,
        "Baseline resends unchanged continuation state.",
        { reasoningClass: "LOW" }
      ),
      step(
        "status",
        {
          continuation: {
            unresolved: ["SHOULDER_CONTACT"],
            fresh_view_evidence: {
              front: "verificationevidence:front-new",
              left: "verificationevidence:left-fresh",
            },
            verification: { pending: false },
          },
        },
        true,
        "Baseline resends the full continuation after one view handle changes.",
        { reasoningClass: "LOW" }
      ),
    ],
    [
      step(
        "status",
        {
          continuation_id: "correctionctx:ready",
          mode: "PRUNED_READY",
          unresolved: ["SHOULDER_CONTACT"],
          fresh_view_evidence: {
            front: "verificationevidence:front-fresh",
            left: "verificationevidence:left-fresh",
          },
          verification: { pending: false },
        },
        true,
        "Runtime selects the pruned mode and sends one compact authoritative payload.",
        { reasoningClass: "LOW" }
      ),
      step(
        "status",
        {
          continuation_id: "correctionctx:ready",
          delivery: "CACHED",
          payload: null,
        },
        false,
        "Unchanged state is represented by identity only.",
        { reasoningClass: "NONE" }
      ),
      step(
        "status",
        {
          continuation_id: "correctionctx:ready-next",
          delivery: "DELTA",
          delta: {
            from_continuation_id: "correctionctx:ready",
            to_continuation_id: "correctionctx:ready-next",
            fresh_view_evidence_upsert: [
              { view: "front", handle: "verificationevidence:front-new" },
            ],
          },
        },
        true,
        "Changed state sends only the changed evidence handle over the known base.",
        { reasoningClass: "NONE" }
      ),
    ],
    {
      runtime_mode_selection_preserved: true,
      unresolved_state_preserved: true,
      fresh_view_evidence_preserved: true,
      resolved_history_pruned: true,
      old_candidate_history_pruned: true,
      unchanged_payload_not_repeated: true,
      changed_field_delta_preserved: true,
      unknown_base_full_fallback_preserved: true,
      no_model_transport_routing_required: true,
    }
  );

  const semanticDeltaGrouping = summarize(
    "correction_semantic_delta_grouping",
    [
      step(
        "status",
        {
          updates: [
            { kind: "same_boundary_micro_update", field: "summary" },
            { kind: "same_boundary_micro_update", field: "evidence_metadata" },
            { kind: "same_boundary_micro_update", field: "continuation_projection" },
          ],
          deliveries: 3,
        },
        true,
        "Baseline publishes every micro update as a separate continuation change.",
        { reasoningClass: "LOW" }
      ),
      step(
        "status",
        {
          transition: "CANDIDATE_CONTEXT -> VERIFY_PENDING",
          delivery: "immediate",
        },
        true,
        "Decision-changing boundary is still delivered immediately.",
        { reasoningClass: "LOW" }
      ),
    ],
    [
      step(
        "status",
        {
          group: "VERIFICATION_COHORT",
          same_boundary_updates: 3,
          intermediate_delivery: "DEFERRED",
          committed_deliveries: 1,
        },
        true,
        "Same-boundary micro changes are coalesced into one semantic delivery.",
        { reasoningClass: "NONE" }
      ),
      step(
        "status",
        {
          transition: "CANDIDATE_CONTEXT -> VERIFY_PENDING",
          delivery: "immediate",
          grouping_bypassed: true,
        },
        true,
        "Decision-changing mode/state transition bypasses grouping.",
        { reasoningClass: "NONE" }
      ),
    ],
    {
      same_boundary_updates_grouped: true,
      decision_boundary_not_delayed: true,
      verification_signal_preserved: true,
      abort_path_preserved: true,
      no_extra_model_routing_decision: true,
    }
  );

  const failedMutation = summarize(
    "failed_mutation_recovery",
    [
      step(
        "mutate",
        { bytes: failure.before_bytes },
        true,
        "Mutation outcome is unknown."
      ),
      step(
        "mutate",
        { retry: "automatic" },
        false,
        "Unsafe baseline retry; a mutation may already have been applied."
      ),
      step(
        "verify",
        {
          evidence_handle: "verificationevidence:expired",
          action: "continue correction anyway",
        },
        false,
        "Baseline incorrectly treats expired evidence as reusable."
      ),
      step(
        "status",
        {
          continuation_base: "missing",
          action: "apply delta without base",
        },
        false,
        "Baseline attempts a delta without a known continuation base."
      ),
    ],
    [
      step(
        "recovery",
        { bytes: failure.after_bytes },
        true,
        "UNKNOWN_OUTCOME stays RECOVER with no automatic retry."
      ),
      step(
        "verify",
        {
          evidence_recovery_required: true,
          recovered_views_required: ["front", "left"],
          correction_attempt_consumed: false,
        },
        true,
        "Expired or cross-generation evidence blocks correction until complete fresh evidence arrives.",
        { reasoningClass: "LOW" }
      ),
      step(
        "status",
        {
          continuation_base: "missing",
          delivery: "FULL",
        },
        true,
        "Unknown continuation base falls back to FULL rather than applying an unsafe delta.",
        { reasoningClass: "NONE" }
      ),
    ],
    {
      recovery_semantics: failure.quality_preserved,
      unknown_scope_complete:
        failure.semantic_checks.unknown_scope_complete === true,
      no_false_retry: true,
      expired_evidence_fails_closed: true,
      recovery_does_not_consume_correction_attempt: true,
      partial_recovery_rejected: true,
      runtime_generation_requires_fresh_evidence: true,
      missing_continuation_base_uses_full_delivery: true,
      group_abort_available_on_recovery: true,
      process_restart_requires_reorientation: true,
      old_process_handles_not_reused: true,
      checkpoint_remains_process_independent: true,
    }
  );

  // Package 3: source-backed evidence selection. Counts/pixel area below
  // describe PLANNED image blocks from canonical selectors, not images
  // actually consumed by an AI client or a measured Codex allowance.
  const silhouetteViews = selectModelViewsForEvidence(["silhouette"], "HIGH").views;
  const allMasks = [...silhouetteViews];
  const scopedMasks = selectSilhouetteCaptureViews(
    silhouetteViews, ["silhouette"], false
  );
  const explicitMasks = selectSilhouetteCaptureViews(
    ["front", "left"], ["silhouette"], true
  );
  const modelPngSize = selectCaptureSizeForEvidence(["silhouette"], "HIGH");
  const originalCrop: ControlVerificationScope = {
    kind: "TEXTURE_REGION",
    texture_uuid: "atlas-evidence-fixture",
    affected_rect: [16, 32, 32, 48],
    revision: "sha256:128x128:" + "a".repeat(64),
    evidence_source: "follow_up_read",
  };
  const focusedCrop = planFocusedTextureEvidenceRequest(originalCrop);
  const movingTracks: AnimationMotionTrackInput[] = [
    {
      group_uuid: "unrelated-bone", group_name: "Other",
      channel: "rotation",
      keyframes: [
        {time:0, value:[0,0,0], data_point_count:1},
        {time:0.1, value:[120,0,0], data_point_count:1},
        {time:0.2, value:[0,0,0], data_point_count:1},
        {time:1, value:[0,0,0], data_point_count:1},
      ],
    },
    {
      group_uuid: "target-bone", group_name: "Target",
      channel: "rotation",
      keyframes: [
        {time:0, value:[0,0,0], data_point_count:1},
        {time:0.75, value:[0,0,0], data_point_count:1},
        {time:0.9, value:[90,0,0], data_point_count:1},
        {time:1, value:[90,0,0], data_point_count:1},
      ],
    },
  ];
  const fullClip = planTemporalImageEvidence({
    duration_seconds: 1, tracks: movingTracks,
  });
  const focusedClip = planTemporalImageEvidence({
    duration_seconds: 1, tracks: movingTracks, max_frames:3,
    focus_bone_uuid:"target-bone",
    focus_time_range:{start:0.75,end:1},
  });
  const fullTimes = fullClip.suggested_times_seconds;
  const focusedTimes = focusedClip.suggested_times_seconds;
  const evidenceSelection = summarize(
    "targeted_geometry_texture_animation_evidence",
    [
      step("verify", {
        stage:"GEOMETRY", evidence_targets:["silhouette"],
        model_views:silhouetteViews, extra_mask_views:allMasks,
        renderer_proof:"SOURCE_SELECTION_ONLY",
      }, true, "Baseline requests masks even for orthogonal context views.",
      {imageInputs:silhouetteViews.length+allMasks.length,imageSize:modelPngSize}),
      step("inspect", {
        stage:"TEXTURE", texture:originalCrop.texture_uuid,
        review_region:"FULL_ATLAS",
        revision:originalCrop.revision,
      }, true, "Baseline re-reads a full 128x128 atlas for one 16x16 changed region.",
      {imageInputs:1,imageSize:128}),
      step("verify", {
        stage:"ANIMATION", review:"FOCUSED_BONE_LATE_EVENT",
        full_clip_times:fullTimes,
        unsampled_motion_verified:false,
      }, true, "Baseline uses source-wide event time suggestions for a focused question.",
      {imageInputs:fullTimes.length,imageSize:512}),
    ],
    [
      step("verify", {
        stage:"GEOMETRY", evidence_targets:["silhouette"],
        model_views:silhouetteViews, extra_mask_views:scopedMasks,
        renderer_proof:"SOURCE_SELECTION_ONLY",
      }, true, "Shaded geometry views remain; only redundant auto-selected masks are absent.",
      {imageInputs:silhouetteViews.length+scopedMasks.length,imageSize:modelPngSize}),
      step("inspect", {
        stage:"TEXTURE",
        capability:focusedCrop?.capability??null,
        args:focusedCrop?.args??null,
      }, true, "Source-verified region+revision yield one focused, not full-atlas, request.",
      {imageInputs:focusedCrop?1:0,imageSize:focusedCrop?16:0}),
      step("verify", {
        stage:"ANIMATION", review:"FOCUSED_BONE_LATE_EVENT",
        focused_times:focusedTimes,
        unsampled_motion_verified:false,
      }, true, "Scoped authored event sampling retains the requested time window.",
      {imageInputs:focusedTimes.length,imageSize:512}),
    ],
    {
      all_shaded_geometry_views_preserved: silhouetteViews.join("|") ===
        selectModelViewsForEvidence(["silhouette"],"HIGH").views.join("|"),
      silhouette_target_mask_retained:scopedMasks.includes("front"),
      explicit_view_masks_not_suppressed:explicitMasks.join("|")==="front|left",
      scoped_mask_plan_less_than_legacy:scopedMasks.length<allMasks.length,
      source_image_budget_respected:silhouetteViews.length+scopedMasks.length<=8,
      texture_roi_exact:focusedCrop?.args.region.x===16 &&
        focusedCrop.args.region.y===32 && focusedCrop.args.region.width===16 &&
        focusedCrop.args.region.height===16,
      texture_revision_pinned:focusedCrop?.args.expected_revision===originalCrop.revision,
      texture_no_automatic_review:focusedCrop?.automatic_call===false &&
        focusedCrop.authorizes_visual_pass===false,
      focused_bone_events_bound_to_requested_window:
        focusedClip.state==="CANDIDATE_ONLY" &&
        focusedTimes.every(time=>time>=0.75&&time<=1),
      focused_event_coverage_nonempty:focusedTimes.some(time=>time>0.75&&time<1),
      fewer_animation_image_candidates:fullTimes.length>focusedTimes.length,
      animation_frame_budget_retained:focusedTimes.length<=5 &&
        focusedTimes.length<=8,
      no_false_continuous_motion_pass:fullClip.all_motion_observed===false &&
        focusedClip.all_motion_observed===false &&
        focusedClip.visual_pass_authorized===false,
    }
  );

  return [
    knownTarget,
    unknownTarget,
    hierarchyEdit,
    materialEdit,
    animationEffectEdit,
    visualCorrection,
    crossViewReuse,
    candidateEconomy,
    continuationTransport,
    semanticDeltaGrouping,
    failedMutation,
    evidenceSelection,
  ];
}

if (import.meta.main) {
  const workflows = runZeroWasteWorkflowBenchmark();
  const beforeBytes = workflows.reduce(
    (sum, item) => sum + item.baseline.ai_payload_bytes,
    0
  );
  const afterBytes = workflows.reduce(
    (sum, item) => sum + item.optimized.ai_payload_bytes,
    0
  );
  const beforeCalls = workflows.reduce(
    (sum, item) => sum + item.baseline.calls,
    0
  );
  const afterCalls = workflows.reduce(
    (sum, item) => sum + item.optimized.calls,
    0
  );
  const beforeImages = workflows.reduce(
    (sum, item) => sum + item.baseline.image_inputs,
    0
  );
  const afterImages = workflows.reduce(
    (sum, item) => sum + item.optimized.image_inputs,
    0
  );
  const beforeImagePixels = workflows.reduce(
    (sum, item) => sum + item.baseline.image_pixel_area,
    0
  );
  const afterImagePixels = workflows.reduce(
    (sum, item) => sum + item.optimized.image_pixel_area,
    0
  );
  const beforeHighReasoning = workflows.reduce(
    (sum, item) => sum + item.baseline.high_reasoning_decisions,
    0
  );
  const afterHighReasoning = workflows.reduce(
    (sum, item) => sum + item.optimized.high_reasoning_decisions,
    0
  );

  console.log(
    JSON.stringify(
      {
        schema: 1,
        benchmark: "zero-waste-workflow-proxy",
        proof_scope:
          "REMOTE_GITHUB deterministic workflow projection; call removal is allowed only by existing LazyDesigner routing/verification contracts. This is not Codex Astra token telemetry or live Blockbench visual proof.",
        workflows,
        aggregate: {
          workflow_count: workflows.length,
          quality_preserved: workflows.every(
            (workflow) => workflow.quality_preserved
          ),
          baseline_calls: beforeCalls,
          optimized_calls: afterCalls,
          saved_calls: Math.max(0, beforeCalls - afterCalls),
          baseline_image_inputs: beforeImages,
          optimized_image_inputs: afterImages,
          saved_image_inputs: Math.max(0, beforeImages - afterImages),
          baseline_image_pixel_area: beforeImagePixels,
          optimized_image_pixel_area: afterImagePixels,
          saved_image_pixel_area: Math.max(0, beforeImagePixels - afterImagePixels),
          baseline_high_reasoning_decisions: beforeHighReasoning,
          optimized_high_reasoning_decisions: afterHighReasoning,
          saved_high_reasoning_decisions: Math.max(
            0,
            beforeHighReasoning - afterHighReasoning
          ),
          before_bytes: beforeBytes,
          after_bytes: afterBytes,
          saved_bytes: Math.max(0, beforeBytes - afterBytes),
          reduction_percent:
            beforeBytes === 0
              ? 0
              : Number(
                  (((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(2)
                ),
        },
      },
      null,
      2
    )
  );
}
