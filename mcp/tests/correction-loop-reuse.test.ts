import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import type { AuthoringRecipeApplyReceipt } from "@/lib/authoringRecipe/transaction";
import { AuthoringEvidenceRegistry } from "@/lib/authoringRecipe/evidenceRegistry";
import type { SemanticGeometryOperation } from "@/lib/authoringRecipe/semanticEdit";
import { correctionContinuationDelta, correctionContinuationId } from "@/lib/orchestration/correctionContinuation";
import { CorrectionLoopRegistry } from "@/lib/orchestration/correctionLoop";

function recipe(): AuthoringRecipe {
  return {
    schema: 1,
    compiler_version: 1,
    id: "asset",
    name: "asset",
    prototypes: [{ id: "arm", name: "arm", size: [4, 8, 4], semantic_group: "upper_arm" }],
    patterns: [{
      kind: "LINEAR",
      id: "arms",
      prototype_id: "arm",
      count: 2,
      axis: "X",
      spacing: 8,
      semantic_group: "upper_arm",
    }],
  };
}


/**
 * Legacy convergence tests model a successfully committed native edit. They
 * must synthesize that receipt explicitly, rather than let a planning call
 * impersonate execution. These fixtures never establish live Blockbench proof.
 */
function syntheticRecipeApplyReceipt(
  decision: ReturnType<CorrectionLoopRegistry["planGeometryCorrection"]>,
  before: string,
  after: string,
  undoIndex: number
): AuthoringRecipeApplyReceipt {
  const plan = decision.rebuild;
  if (decision.state !== "CORRECTION_READY" || !plan || !decision.next_recipe) {
    throw new Error("Expected an eligible synthetic Recipe Apply plan.");
  }
  const ids = (reason: "ADDED" | "CHANGED") =>
    plan.reasons.filter((item) => item.reason === reason).map((item) => item.instance_id);
  return {
    schema: 1, execution: "applied", recipe_id: decision.next_recipe.id,
    previous_recipe_fingerprint: plan.previous_recipe_fingerprint,
    next_recipe_fingerprint: plan.next_recipe_fingerprint,
    native_source_fingerprint_before: before,
    native_source_fingerprint_after: after,
    native_undo_provenance: {
      token: "synthetic-recipe-undo-" + undoIndex,
      project_uuid: "synthetic-project",
      undo_index: undoIndex,
    },
    created_instance_ids: ids("ADDED"),
    updated_instance_ids: ids("CHANGED"),
    removed_instance_ids: [...plan.remove_instance_ids],
    preserved_instance_ids: [...plan.preserved_instance_ids],
    metadata_only_instance_ids: [...plan.metadata_only_instance_ids],
    symmetry_changed_relation_ids: [...plan.symmetry_changed_relation_ids],
    affected_count: plan.metrics.native_affected_count,
    recipe_affected_count: plan.metrics.affected_count,
    invalidates: {
      geometry_structure: true, uv_mapping: true,
      texture_appearance: true, animation_motion: true,
    },
  };
}

class SyntheticAppliedCorrectionLoopRegistry extends CorrectionLoopRegistry {
  private readonly receipts: AuthoringEvidenceRegistry;
  private readonly lastNativeByHandle = new Map<string, string>();
  private applySequence = 0;

  constructor() {
    const receipts = new AuthoringEvidenceRegistry();
    super(8, { readEvidence: (handle) => receipts.get(handle) });
    this.receipts = receipts;
  }

  override planGeometryCorrection(
    ...args: Parameters<CorrectionLoopRegistry["planGeometryCorrection"]>
  ): ReturnType<CorrectionLoopRegistry["planGeometryCorrection"]> {
    const decision = super.planGeometryCorrection(...args);
    if (decision.state !== "CORRECTION_READY") return decision;
    const sequence = ++this.applySequence;
    const before = this.lastNativeByHandle.get(args[0]) ?? "sha256:" + "0".repeat(64);
    const after = "sha256:" + sequence.toString(16).padStart(64, "0");
    const receiptHandle = this.receipts.put({
      kind: "APPLY_RECEIPT",
      value: syntheticRecipeApplyReceipt(decision, before, after, sequence),
    });
    this.acknowledgeAppliedGeometryCorrection(args[0], receiptHandle);
    this.lastNativeByHandle.set(args[0], after);
    return decision;
  }
}

describe("zero-waste correction loop reuse", () => {

  test("planning preserves active Recipe and attempts until a matching native Apply receipt", () => {
    const receiptOwner = new AuthoringEvidenceRegistry();
    const registry = new CorrectionLoopRegistry(8, {
      readEvidence: (handle) => receiptOwner.get(handle),
    });
    const handle = registry.start({
      recipe_id: "asset",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY", source: "capture_model_views",
        verification_risk: "LOW", views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256, size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:receipt-before",
      discrepancies: [{
        code: "WIDTH", severity: "REVIEW", summary: "Width is incorrect.",
        quality_class: "PRIMARY_FORM", owner: "GEOMETRY",
        cause_family: "SIZE_MISMATCH", views: ["front"],
      }],
    });
    const candidate = {
      id: "resize", predicted_error: 0.1, mutation_cost: 0.1, risk: 0.1,
      patch: {
        target_discrepancy_codes: ["WIDTH"],
        correction_family: "RESIZE" as const,
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: { kind: "RESIZE_AXIS" as const, axis: "X" as const,
            mode: "ADD" as const, value: 1, anchor: "MIN" as const },
        },
      },
    };
    const firstPlan = registry.planGeometryCorrection(handle, [candidate]);
    expect(firstPlan.state).toBe("CORRECTION_READY");
    expect(firstPlan.attempt).toBe(1); // projected, not an executed attempt
    const pending = registry.projectContinuation(handle);
    expect(pending).toMatchObject({
      attempt: 0,
      state: "VERIFY_PENDING",
      verification: {
        awaiting_native_apply_receipt: true, pending: true,
        target_discrepancy_codes: ["WIDTH"], stale_views: [],
      },
    });
    expect(pending.fresh_view_evidence).toEqual([{
      view: "front", handle: "verificationevidence:receipt-before",
    }]);
    expect(registry.planGeometryCorrection(handle, [candidate])).toMatchObject({
      state: "BLOCKED", attempt: 0, blocked_reason: "CORRECTION_APPLY_PENDING",
    });
    expect(() => registry.updateEvidence(handle, "verificationevidence:fake-after", [{
      code: "WIDTH", severity: "INFO", summary: "Fabricated improvement.",
    }])).toThrow("CORRECTION_APPLY_RECEIPT_REQUIRED");
    expect(registry.projectContinuation(handle)).toEqual(pending);

    const before = "sha256:" + "1".repeat(64);
    const after = "sha256:" + "2".repeat(64);
    const valid = syntheticRecipeApplyReceipt(firstPlan, before, after, 1);
    expect(() => registry.acknowledgeAppliedGeometryCorrection(
      handle, "authoringevidence:" + "f".repeat(64)
    )).toThrow("AUTHORING_EVIDENCE_NOT_FOUND");
    expect(() => registry.acknowledgeAppliedGeometryCorrection(
      handle, valid as unknown as `authoringevidence:${string}`
    )).toThrow("CORRECTION_APPLY_EVIDENCE_HANDLE_INVALID");
    const wrongKind = receiptOwner.put({
      kind: "SEMANTIC_IDENTITY",
      value: { recipe_id: "asset", selected_by: "INSTANCE_IDS",
        count: 0, identities: [] },
    });
    expect(() => registry.acknowledgeAppliedGeometryCorrection(handle, wrongKind))
      .toThrow("CORRECTION_APPLY_EVIDENCE_KIND_MISMATCH");
    for (const mismatched of [
      { ...valid, execution: "unchanged" as const },
      { ...valid, recipe_id: "different-recipe" },
      { ...valid, next_recipe_fingerprint: "sha256:" + "3".repeat(64) },
      { ...valid, updated_instance_ids: ["not-the-target"] },
      { ...valid, native_undo_provenance: undefined },
      { ...valid, native_source_fingerprint_after: before },
    ]) {
      const mismatchHandle = receiptOwner.put({
        kind: "APPLY_RECEIPT", value: mismatched,
      });
      expect(() => registry.acknowledgeAppliedGeometryCorrection(handle, mismatchHandle))
        .toThrow("CORRECTION_APPLY_RECEIPT_MISMATCH");
      expect(registry.projectContinuation(handle)).toEqual(pending);
    }

    const validHandle = receiptOwner.put({ kind: "APPLY_RECEIPT", value: valid });
    expect(registry.acknowledgeAppliedGeometryCorrection(handle, validHandle)).toEqual({
      state: "VERIFY_PENDING", attempt: 1,
    });
    const afterAck = registry.projectContinuation(handle);
    expect(afterAck).toMatchObject({
      attempt: 1, state: "VERIFY_PENDING",
      verification: {
        pending: true, target_discrepancy_codes: ["WIDTH"],
        stale_views: ["front"],
      },
    });
    expect(afterAck.verification.awaiting_native_apply_receipt).toBeUndefined();
    expect(() => registry.acknowledgeAppliedGeometryCorrection(handle, validHandle))
      .toThrow("CORRECTION_APPLY_NOT_PENDING");
    registry.updateEvidence(handle, "verificationevidence:receipt-after", [{
      code: "WIDTH", severity: "INFO", summary: "Width residual improved.",
      quality_class: "PRIMARY_FORM", owner: "GEOMETRY",
      cause_family: "SIZE_MISMATCH", views: ["front"],
    }], { recovered_views: ["front"] });
    expect(registry.projectContinuation(handle).convergence.state).toBe("IMPROVED");
  });

  test("runtime change blocks pending Apply acknowledgement without advancing the Recipe", () => {
    const receiptOwner = new AuthoringEvidenceRegistry();
    const registry = new CorrectionLoopRegistry(8, {
      readEvidence: (handle) => receiptOwner.get(handle),
    });
    const handle = registry.start({
      recipe_id: "asset", base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY", source: "capture_model_views",
        verification_risk: "LOW", views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256, size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:runtime-before",
      discrepancies: [{
        code: "WIDTH", severity: "REVIEW", summary: "Width mismatch.",
        views: ["front"],
      }],
    });
    const plan = registry.planGeometryCorrection(handle, [{
      id: "resize", predicted_error: 0.1, mutation_cost: 0.1, risk: 0.1,
      patch: {
        target_discrepancy_codes: ["WIDTH"],
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: { kind: "RESIZE_AXIS", axis: "X",
            mode: "ADD", value: 1, anchor: "MIN" },
        },
      },
    }]);
    expect(plan.state).toBe("CORRECTION_READY");
    registry.invalidateRuntimeGeneration();
    const receiptHandle = receiptOwner.put({ kind: "APPLY_RECEIPT",
      value: syntheticRecipeApplyReceipt(
        plan, "sha256:" + "1".repeat(64), "sha256:" + "2".repeat(64), 1
      ),
    });
    expect(() => registry.acknowledgeAppliedGeometryCorrection(handle, receiptHandle))
      .toThrow("CORRECTION_APPLY_SOURCE_STALE");
    expect(registry.projectContinuation(handle)).toMatchObject({
      attempt: 0,
      verification: { pending: true, recovery_required: true },
    });
  });


  test("ineffective geometry correction never spends an attempt or makes evidence stale", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY", source: "capture_model_views",
        verification_risk: "LOW", views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256, size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:unchanged",
      discrepancies: [{
        code: "WIDTH_LOW", severity: "REVIEW",
        summary: "Upper arm width needs correction.",
      }],
    });
    const original = registry.projectContinuation(handle);
    const noOps: SemanticGeometryOperation[] = [
      { kind: "RESIZE_AXIS", axis: "X", mode: "ADD", value: 0, anchor: "MIN" },
      { kind: "TRANSLATE", delta: [0, 0, 0] },
      { kind: "ROTATE_AXIS", axis: "Y", delta_degrees: 0 },
      { kind: "INFLATE", mode: "ADD", value: 0 },
    ];
    for (const [index, operation] of noOps.entries()) {
      const decision = registry.planGeometryCorrection(handle, [{
        id: "ineffective-" + index, predicted_error: 0.1,
        mutation_cost: 0.1, risk: 0.1,
        patch: { intent: { target: { semantic_group: "upper_arm" }, operation } },
      }]);
      expect(decision).toMatchObject({
        state: "BLOCKED", attempt: 0,
        blocked_reason: "CORRECTION_NO_GEOMETRY_CHANGE",
      });
      expect(registry.projectContinuation(handle)).toEqual(original);
    }

    // Refusing repeated no-ops cannot consume the limited two valid
    // correction attempts or poison the reference evidence for a real edit.
    const effective = registry.planGeometryCorrection(handle, [{
      id: "actual-resize", predicted_error: 0.1, mutation_cost: 0.1, risk: 0.1,
      patch: { intent: {
        target: { semantic_group: "upper_arm" },
        operation: { kind: "RESIZE_AXIS", axis: "X", mode: "ADD",
          value: 1, anchor: "MIN" },
      } },
    }]);
    expect(effective.state).toBe("CORRECTION_READY");
    expect(effective.attempt).toBe(1);
    expect(effective.rebuild?.metrics.native_affected_count).toBe(2);
  });

  test("unavailable UV evidence cannot create a correction loop or disturb an existing continuation", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const input: Parameters<CorrectionLoopRegistry["start"]>[0] = {
      recipe_id: "uv-unavailable",
      base_recipe: recipe(),
      verification_request: {
        domain: "UV", source: null, availability: "UNAVAILABLE",
        reason: "UV_CAPABILITY_UNREGISTERED", island_ids: ["arms:0:north"], full_replan: false,
      },
      verification_evidence_handle: "verificationevidence:uv-unavailable",
      discrepancies: [],
    };
    expect(() => registry.start(input)).toThrow("VERIFICATION_SOURCE_UNAVAILABLE: UV_CAPABILITY_UNREGISTERED");
    expect(registry.size()).toBe(0);
    const handle = registry.start({
      ...input,
      verification_request: {
        domain: "GEOMETRY", source: "capture_model_views", verification_risk: "LOW",
        views: ["front"], views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256, size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS", scope_instance_ids: ["arms:0"],
      },
    });
    const before = registry.projectContinuation(handle);
    expect(() => registry.start(input)).toThrow("VERIFICATION_SOURCE_UNAVAILABLE");
    expect(registry.size()).toBe(1);
    expect(registry.projectContinuation(handle)).toEqual(before);
  });

  test("raw correction entrypoints reject duplicate identity without changing continuation", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const input: Parameters<CorrectionLoopRegistry["start"]>[0] = {
      recipe_id: "identity-boundary",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0"],
      },
      verification_evidence_handle: "verificationevidence:identity-start",
      discrepancies: [{ code: "WIDTH", severity: "REVIEW", summary: "Width mismatch." }],
    };
    expect(() => registry.start({
      ...input,
      discrepancies: [
        { code: "WIDTH", severity: "REVIEW", summary: "Width mismatch." },
        { code: "WIDTH", severity: "BLOCKING", summary: "Different diagnosis." },
      ],
    })).toThrow("DUPLICATE_DISCREPANCY_CODE");
    expect(() => registry.start({
      ...input,
      discrepancies: [{ code: " WIDTH ", severity: "REVIEW", summary: "Ambiguous identity." }],
    })).toThrow("INVALID_DISCREPANCY_CODE");
    const handle = registry.start(input);
    const before = registry.projectContinuation(handle).continuation_id;
    expect(() => registry.updateEvidence(handle, "verificationevidence:identity-next", [
      { code: "WIDTH", severity: "REVIEW", summary: "Updated width." },
      { code: "WIDTH", severity: "BLOCKING", summary: "Conflicting update." },
    ])).toThrow("DUPLICATE_DISCREPANCY_CODE");
    expect(registry.projectContinuation(handle).continuation_id).toBe(before);
  });

  test("missing targeted discrepancy cannot be cleared without fresh complete view evidence", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "clearance",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY", source: "capture_model_views",
        verification_risk: "HIGH", views: ["front", "left"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 512, size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0"],
      },
      verification_evidence_handle: "verificationevidence:clear-0",
      discrepancies: [
        {code: "WIDTH_LOW", severity: "REVIEW", summary: "Width too small",
          quality_class: "PRIMARY_FORM", owner: "GEOMETRY",
          cause_family: "SIZE_MISMATCH", views: ["front"], evidence_targets: ["width"]},
        {code: "CONTACT", severity: "REVIEW", summary: "Contact gap",
          views: ["left"], evidence_targets: ["attachment"]},
      ],
    });
    const plan = registry.planGeometryCorrection(handle, [{
      id: "resize", predicted_error: 0.1, mutation_cost: 0.1, risk: 0.1,
      patch: {
        target_discrepancy_codes: ["WIDTH_LOW"],
        correction_family: "RESIZE",
        intent: {
          target: {semantic_group: "upper_arm"},
          operation: {kind: "RESIZE_AXIS", axis: "X",
            mode: "MULTIPLY", value: 1.05, anchor: "MIN"},
        },
      },
    }]);
    expect(plan.state).toBe("CORRECTION_READY");
    const before = registry.projectContinuation(handle).continuation_id;
    expect(() => registry.updateEvidence(handle, "verificationevidence:clear-1", []))
      .toThrow("TARGET_CLEARANCE_UNVERIFIED");
    expect(() => registry.updateEvidence(handle, "verificationevidence:clear-1", [], {
      cleared_target_codes: ["WIDTH_LOW"], recovered_views: ["left"],
    })).toThrow("TARGET_CLEARANCE_VIEW_MISSING");
    expect(() => registry.updateEvidence(handle, "verificationevidence:clear-0", [], {
      cleared_target_codes: ["WIDTH_LOW"], recovered_views: ["front"],
    })).toThrow("TARGET_CLEARANCE_STALE_EVIDENCE");
    expect(() => registry.updateEvidence(handle, "verificationevidence:clear-1", [], {
      cleared_target_codes: ["CONTACT"], recovered_views: ["front"],
    })).toThrow("TARGET_CLEARANCE_CONTRADICTED");
    expect(registry.projectContinuation(handle).continuation_id).toBe(before);

    registry.updateEvidence(handle, "verificationevidence:clear-1", [], {
      cleared_target_codes: ["WIDTH_LOW"], recovered_views: ["front"],
    });
    const after = registry.projectContinuation(handle);
    expect(after.convergence.state).toBe("RESOLVED");
    expect(after.unresolved.map((item) => item.code)).toEqual(["CONTACT"]);
    expect(after.fresh_view_evidence).toContainEqual({
      view: "left", handle: "verificationevidence:clear-0",
    });
    expect(after.fresh_view_evidence).toContainEqual({
      view: "front", handle: "verificationevidence:clear-1",
    });
  });

  test("full-batch clearance needs every relevant camera, not disappearance alone", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "full-clear",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY", source: "capture_model_views",
        verification_risk: "MEDIUM", views: ["front", "left"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256, size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0"],
      },
      verification_evidence_handle: "verificationevidence:full-0",
      discrepancies: [{code: "FORM", severity: "REVIEW", summary: "Form wrong",
        views: ["front", "left"]}],
    });
    expect(() => registry.updateEvidence(handle, "verificationevidence:full-1", [], {
      cleared_target_codes: ["FORM"], recovered_views: ["front"],
    })).toThrow("TARGET_CLEARANCE_VIEW_MISSING");
    expect(registry.projectContinuation(handle).unresolved_count).toBe(1);
    registry.updateEvidence(handle, "verificationevidence:full-1", [], {
      cleared_target_codes: ["FORM"], recovered_views: ["front", "left"],
    });
    expect(registry.projectContinuation(handle).state).toBe("CLEAR");
  });

  test("reuses the same verification scope for a bounded correction", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:first",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
      }],
    });

    const decision = registry.planGeometryCorrection(handle, [{
      id: "widen-arms",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS",
            axis: "X",
            mode: "MULTIPLY",
            value: 1.05,
            anchor: "MIN",
          },
        },
      },
    }]);

    expect(decision.state).toBe("CORRECTION_READY");
    expect(decision.attempt).toBe(1);
    expect(decision.decision_summary?.selected_candidate_id).toBe("widen-arms");
    expect(decision.verification_request).toEqual({
      domain: "GEOMETRY",
      source: "capture_model_views",
      verification_risk: "LOW",
      views: ["front"],
      views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
      size: 256,
      size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
      scope_instance_ids: ["arms:0", "arms:1"],
    });
    expect(decision.rebuild?.metrics.native_affected_count).toBe(2);
  });

  test("reverification carries only the discrepancy targeted by the selected correction", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "MEDIUM",
        views: ["front", "left"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:first",
      discrepancies: [
        {
          code: "WIDTH_LOW",
          severity: "REVIEW",
          summary: "Upper arms are slightly too narrow.",
          views: ["front"],
          evidence_targets: ["width", "silhouette"],
        },
        {
          code: "SHOULDER_CONTACT",
          severity: "REVIEW",
          summary: "Shoulder contact requires separate review.",
          views: ["left"],
          evidence_targets: ["attachment"],
        },
      ],
    });

    const decision = registry.planGeometryCorrection(handle, [{
      id: "widen-arms",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        target_discrepancy_codes: ["WIDTH_LOW"],
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS",
            axis: "X",
            mode: "MULTIPLY",
            value: 1.05,
            anchor: "MIN",
          },
        },
      },
    }]);

    expect(decision.state).toBe("CORRECTION_READY");
    expect(decision.reverification_discrepancies).toEqual([
      {
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
        views: ["front"],
        evidence_targets: ["width", "silhouette"],
      },
    ]);
    expect(decision.evidence_reuse).toEqual({
      source_handle: "verificationevidence:first",
      stale_views: ["front"],
      reusable_views: ["left"],
      reusable_evidence: [
        { view: "left", handle: "verificationevidence:first" },
      ],
      basis: "TARGETED_VIEW_PROVENANCE",
    });
  });

  test("bounds correction candidate count by verification risk", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const lowHandle = registry.start({
      recipe_id: "asset",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:first",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
      }],
    });

    const twoCandidates = [1.03, 1.05].map((value, index) => ({
      id: "resize-" + index,
      predicted_error: 0.1 + index * 0.01,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        correction_family: "RESIZE" as const,
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS" as const,
            axis: "X" as const,
            mode: "MULTIPLY" as const,
            value,
            anchor: "MIN" as const,
          },
        },
      },
    }));

    const low = registry.planGeometryCorrection(lowHandle, twoCandidates);
    expect(low.state).toBe("BLOCKED");
    expect(low.blocked_reason).toBe("CANDIDATE_BUDGET_EXCEEDED");

    const mediumHandle = registry.start({
      recipe_id: "asset-medium",
      base_recipe: { ...recipe(), id: "asset-medium", name: "asset-medium" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "MEDIUM",
        views: ["front", "left"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:medium",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
      }],
    });
    expect(registry.planGeometryCorrection(mediumHandle, twoCandidates).state).toBe(
      "CORRECTION_READY"
    );
  });

  test("allows three candidates at HIGH risk but rejects a fourth", () => {
    const makeHandle = (suffix: string) => {
      const registry = new SyntheticAppliedCorrectionLoopRegistry();
      const handle = registry.start({
        recipe_id: "asset-" + suffix,
        base_recipe: { ...recipe(), id: "asset-" + suffix, name: "asset-" + suffix },
        verification_request: {
          domain: "GEOMETRY",
          source: "capture_model_views",
          verification_risk: "HIGH",
          views: ["front", "left", "top"],
          views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
          size: 512,
          size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
          scope_instance_ids: ["arms:0", "arms:1"],
        },
        verification_evidence_handle: "verificationevidence:" + suffix as any,
        discrepancies: [{
          code: "WIDTH_LOW",
          severity: "REVIEW",
          summary: "Upper arms are slightly too narrow.",
        }],
      });
      return { registry, handle };
    };
    const candidates = [1.02, 1.04, 1.06, 1.08].map((value, index) => ({
      id: "resize-" + index,
      predicted_error: 0.1 + index * 0.01,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        correction_family: "RESIZE" as const,
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS" as const,
            axis: "X" as const,
            mode: "MULTIPLY" as const,
            value,
            anchor: "MIN" as const,
          },
        },
      },
    }));
    const allowed = makeHandle("high-three");
    expect(
      allowed.registry.planGeometryCorrection(allowed.handle, candidates.slice(0, 3)).state
    ).toBe("CORRECTION_READY");
    const blocked = makeHandle("high-four");
    expect(
      blocked.registry.planGeometryCorrection(blocked.handle, candidates).blocked_reason
    ).toBe("CANDIDATE_BUDGET_EXCEEDED");
  });

  test("rejects correction family and semantic operation mismatch", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:first",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
      }],
    });

    const decision = registry.planGeometryCorrection(handle, [{
      id: "wrong-family",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        correction_family: "ROTATE",
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS",
            axis: "X",
            mode: "MULTIPLY",
            value: 1.05,
            anchor: "MIN",
          },
        },
      },
    }]);

    expect(decision.state).toBe("BLOCKED");
    expect(decision.blocked_reason).toBe("CORRECTION_FAMILY_MISMATCH");
  });

  test("selects DECISION_SUMMARY automatically for the immediate post-solver handoff", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-mode",
      base_recipe: { ...recipe(), id: "asset-mode", name: "asset-mode" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:mode",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
      }],
    });

    const decision = registry.planGeometryCorrection(handle, [{
      id: "resize",
      predicted_error: 0.05,
      mutation_cost: 0.08,
      risk: 0.09,
      patch: {
        correction_family: "RESIZE",
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS",
            axis: "X",
            mode: "MULTIPLY",
            value: 1.05,
            anchor: "MIN",
          },
        },
      },
    }]);

    expect(decision.continuation_mode).toBe("DECISION_SUMMARY");
    expect(registry.projectContinuation(handle).mode).toBe("VERIFY_PENDING");
  });


  test("blocking visual focus wins over cheaper nonblocking corrections without spending a rejected attempt", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-priority",
      base_recipe: { ...recipe(), id: "asset-priority", name: "asset-priority" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "HIGH",
        views: ["front", "left", "front_left_3q"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 512,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:priority-0",
      discrepancies: [
        {
          code: "SILHOUETTE_BLOCKING",
          severity: "BLOCKING",
          summary: "Primary mass is visibly too narrow.",
          quality_class: "PRIMARY_FORM",
          owner: "GEOMETRY",
          cause_family: "SIZE_MISMATCH",
          views: ["front"],
          evidence_targets: ["silhouette", "width"],
        },
        {
          code: "TRIM_MINOR",
          severity: "REVIEW",
          summary: "Trim alignment could be improved.",
          quality_class: "SECONDARY_DETAIL",
          owner: "GEOMETRY",
          cause_family: "POSITION_MISMATCH",
          views: ["left"],
          evidence_targets: ["attachment"],
        },
      ],
    });
    const minor = {
      id: "cheap-trim",
      predicted_error: 0.001,
      mutation_cost: 0.001,
      risk: 0.001,
      patch: {
        target_discrepancy_codes: ["TRIM_MINOR"],
        correction_family: "TRANSLATE" as const,
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: { kind: "TRANSLATE" as const, delta: [0.25, 0, 0] as [number, number, number] },
        },
      },
    };
    const silhouette = {
      id: "primary-resize",
      predicted_error: 0.35,
      mutation_cost: 0.2,
      risk: 0.2,
      patch: {
        target_discrepancy_codes: ["SILHOUETTE_BLOCKING"],
        correction_family: "RESIZE" as const,
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS" as const,
            axis: "X" as const,
            mode: "ADD" as const,
            value: 1,
            anchor: "MIN" as const,
          },
        },
      },
    };

    const original = registry.projectContinuation(handle);
    expect(registry.planGeometryCorrection(handle, [minor])).toMatchObject({
      state: "BLOCKED",
      attempt: 0,
      blocked_reason: "BLOCKING_FOCUS_REQUIRES_TARGET",
    });
    expect(registry.projectContinuation(handle)).toEqual(original);

    const decision = registry.planGeometryCorrection(handle, [minor, silhouette]);
    expect(decision).toMatchObject({
      state: "CORRECTION_READY",
      attempt: 1,
      decision_summary: {
        selected_candidate_id: "primary-resize",
        rejected_candidate_ids: ["cheap-trim"],
        candidate_count: 2,
      },
    });
    expect(decision.reverification_discrepancies?.map((item) => item.code)).toEqual([
      "SILHOUETTE_BLOCKING",
    ]);
  });

  test("nonblocking geometry reviews retain existing caller-cost ranking", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-nonblocking",
      base_recipe: { ...recipe(), id: "asset-nonblocking", name: "asset-nonblocking" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "MEDIUM",
        views: ["front", "left"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:review-0",
      discrepancies: [
        { code: "WIDTH_REVIEW", severity: "REVIEW", summary: "Width may need adjustment." },
        { code: "TRIM_REVIEW", severity: "INFO", summary: "Trim may need adjustment." },
      ],
    });
    const cheap = {
      id: "cheap",
      predicted_error: 0.01,
      mutation_cost: 0.01,
      risk: 0.01,
      patch: {
        target_discrepancy_codes: ["TRIM_REVIEW"],
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: { kind: "TRANSLATE" as const, delta: [0.25, 0, 0] as [number, number, number] },
        },
      },
    };
    const expensive = {
      id: "expensive",
      predicted_error: 0.3,
      mutation_cost: 0.2,
      risk: 0.1,
      patch: {
        target_discrepancy_codes: ["WIDTH_REVIEW"],
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS" as const,
            axis: "X" as const,
            mode: "ADD" as const,
            value: 1,
            anchor: "MIN" as const,
          },
        },
      },
    };
    const decision = registry.planGeometryCorrection(handle, [expensive, cheap]);
    expect(decision).toMatchObject({
      state: "CORRECTION_READY",
      decision_summary: {
        selected_candidate_id: "cheap",
        rejected_candidate_ids: ["expensive"],
      },
    });
  });

  test("returns only compact solver decision metadata instead of candidate payloads", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-summary",
      base_recipe: { ...recipe(), id: "asset-summary", name: "asset-summary" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "MEDIUM",
        views: ["front", "left"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:summary",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
      }],
    });

    const decision = registry.planGeometryCorrection(handle, [
      {
        id: "resize-a",
        predicted_error: 0.08,
        mutation_cost: 0.1,
        risk: 0.12,
        patch: {
          correction_family: "RESIZE",
          intent: {
            target: { semantic_group: "upper_arm" },
            operation: {
              kind: "RESIZE_AXIS",
              axis: "X",
              mode: "MULTIPLY",
              value: 1.03,
            anchor: "MIN",
            },
          },
        },
      },
      {
        id: "resize-b",
        predicted_error: 0.04,
        mutation_cost: 0.08,
        risk: 0.09,
        patch: {
          correction_family: "RESIZE",
          intent: {
            target: { semantic_group: "upper_arm" },
            operation: {
              kind: "RESIZE_AXIS",
              axis: "X",
              mode: "MULTIPLY",
              value: 1.05,
            anchor: "MIN",
            },
          },
        },
      },
    ]);

    expect(decision.state).toBe("CORRECTION_READY");
    expect(decision.decision_summary).toEqual({
      selected_candidate_id: "resize-b",
      rejected_candidate_ids: ["resize-a"],
      selected_metrics: {
        predicted_error: 0.04,
        mutation_cost: 0.08,
        risk: 0.09,
      },
      solver_score: expect.any(Number),
      candidate_count: 2,
      candidate_budget: 2,
    });
    expect(JSON.stringify(decision.decision_summary)).not.toContain("geometry_operations");
    expect(JSON.stringify(decision.decision_summary)).not.toContain("semantic_group");
  });

  test("deduplicates unchanged continuation payloads by deterministic identity", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-dedup",
      base_recipe: { ...recipe(), id: "asset-dedup", name: "asset-dedup" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:dedup",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });

    const first = registry.projectContinuationDelivery(handle);
     expect(first.delivery).toBe("FULL");
    expect(first.group).toBeNull();
    expect(first.payload?.continuation_id).toBe(first.continuation_id);
    expect(first.delta).toBeNull();
    const payload = first.payload!;
    const equivalent = {
      ...payload,
      verification: Object.fromEntries(Object.entries(payload.verification).reverse()) as typeof payload.verification,
    };
    expect(correctionContinuationId(equivalent)).toBe(correctionContinuationId(payload));
    expect(correctionContinuationDelta(payload, equivalent)).toEqual({
      protocol: "lazydesigner-correction-continuation-delta-v1",
      from_continuation_id: payload.continuation_id,
      to_continuation_id: payload.continuation_id,
    });

    const second = registry.projectContinuationDelivery(handle, [
      first.continuation_id,
    ]);
    expect(second).toEqual({
      continuation_id: first.continuation_id,
       delivery: "CACHED",
      payload: null,
      delta: null,
      group: null,
    });

    registry.planGeometryCorrection(handle, [{
      id: "resize",
      predicted_error: 0.05,
      mutation_cost: 0.08,
      risk: 0.09,
      patch: {
        target_discrepancy_codes: ["WIDTH_LOW"],
        correction_family: "RESIZE",
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS",
            axis: "X",
            mode: "MULTIPLY",
            value: 1.05,
            anchor: "MIN",
          },
        },
      },
    }]);

    const changed = registry.projectContinuationDelivery(handle, [
      first.continuation_id,
    ]);
     expect(changed.delivery).toBe("DELTA");
    expect(changed.continuation_id).not.toBe(first.continuation_id);
    expect(changed.payload).toBeNull();
    expect(changed.delta).toMatchObject({
      from_continuation_id: first.continuation_id,
      to_continuation_id: changed.continuation_id,
      mode: "VERIFY_PENDING",
      state: "VERIFY_PENDING",
      attempt: 1,
      verification: {
        pending: true,
        target_discrepancy_codes: ["WIDTH_LOW"],
        stale_views: ["front"],
      },
    });
  });

  test("never defers decision-changing continuation boundaries", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-group-boundary",
      base_recipe: { ...recipe(), id: "asset-group-boundary", name: "asset-group-boundary" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:group-boundary",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });

    const first = registry.projectContinuationDelivery(handle);
    registry.beginContinuationGroup(handle, "EXECUTION_COHORT");
    registry.planGeometryCorrection(handle, [{
      id: "resize",
      predicted_error: 0.05,
      mutation_cost: 0.08,
      risk: 0.09,
      patch: {
        target_discrepancy_codes: ["WIDTH_LOW"],
        correction_family: "RESIZE",
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS",
            axis: "X",
            mode: "MULTIPLY",
            value: 1.05,
            anchor: "MIN",
          },
        },
      },
    }]);

    const boundary = registry.projectContinuationDelivery(handle, [
      first.continuation_id,
    ]);
    expect(boundary.delivery).toBe("DELTA");
    expect(boundary.delta?.mode).toBe("VERIFY_PENDING");
    expect(boundary.group).toBeNull();
  });

  test("groups same-boundary continuation churn into one final delivery", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-group-same-boundary",
      base_recipe: { ...recipe(), id: "asset-group-same-boundary", name: "asset-group-same-boundary" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:group-same",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });

    const first = registry.projectContinuationDelivery(handle);
    const group = registry.beginContinuationGroup(handle, "VERIFICATION_COHORT");
    expect(
      registry.projectContinuationDelivery(handle, [first.continuation_id]).delivery
    ).toBe("DEFERRED");
    expect(
      registry.projectContinuationDelivery(handle, [first.continuation_id]).delivery
    ).toBe("DEFERRED");
    const committed = registry.commitContinuationGroup(handle, [
      first.continuation_id,
    ]);
    expect(committed.delivery).toBe("CACHED");
    expect(committed.group).toBeNull();
    expect(group.kind).toBe("VERIFICATION_COHORT");
  });

  test("aborting a continuation group restores normal delivery without publishing intermediate state", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-group-abort",
      base_recipe: { ...recipe(), id: "asset-group-abort", name: "asset-group-abort" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:abort",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });

    const first = registry.projectContinuationDelivery(handle);
    registry.beginContinuationGroup(handle, "EXECUTION_COHORT");
    expect(
      registry.projectContinuationDelivery(handle, [first.continuation_id]).delivery
    ).toBe("DEFERRED");
    registry.abortContinuationGroup(handle);
    expect(
      registry.projectContinuationDelivery(handle, [first.continuation_id]).delivery
    ).toBe("CACHED");
  });

  test("sends only changed view evidence and resolved discrepancy codes as continuation delta", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-delta",
      base_recipe: { ...recipe(), id: "asset-delta", name: "asset-delta" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "MEDIUM",
        views: ["front", "left"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:initial",
      discrepancies: [
        {
          code: "WIDTH_LOW",
          severity: "REVIEW",
          summary: "Upper arms are slightly too narrow.",
          views: ["front"],
          evidence_targets: ["width"],
        },
        {
          code: "SHOULDER_CONTACT",
          severity: "REVIEW",
          summary: "Shoulder contact requires separate review.",
          views: ["left"],
          evidence_targets: ["attachment"],
        },
      ],
    });

    const first = registry.projectContinuationDelivery(handle);
    registry.planGeometryCorrection(handle, [{
      id: "resize",
      predicted_error: 0.05,
      mutation_cost: 0.08,
      risk: 0.09,
      patch: {
        target_discrepancy_codes: ["WIDTH_LOW"],
        correction_family: "RESIZE",
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS",
            axis: "X",
            mode: "MULTIPLY",
            value: 1.05,
            anchor: "MIN",
          },
        },
      },
    }]);
    const pending = registry.projectContinuationDelivery(handle, [
      first.continuation_id,
    ]);
    expect(pending.delivery).toBe("DELTA");

    registry.updateEvidence(handle, "verificationevidence:front-fresh", [], {
      cleared_target_codes: ["WIDTH_LOW"],
      recovered_views: ["front"],
    });
    const ready = registry.projectContinuationDelivery(handle, [
      pending.continuation_id,
    ]);
    expect(ready.delivery).toBe("DELTA");
    expect(ready.payload).toBeNull();
    expect(ready.delta).toMatchObject({
      resolved_discrepancy_codes: ["WIDTH_LOW"],
      fresh_view_evidence_upsert: [
        { view: "front", handle: "verificationevidence:front-fresh" },
      ],
      mode: "PRUNED_READY",
      state: "READY",
      unresolved_count: 1,
      verification: {
        pending: false,
        target_discrepancy_codes: [],
        stale_views: [],
      },
    });
    expect(ready.delta?.fresh_view_evidence_upsert).not.toContainEqual({
      view: "left",
      handle: "verificationevidence:initial",
    });
  });

  test("projects a pruned correction continuation without internal recipe or solver history", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-continuation",
      base_recipe: { ...recipe(), id: "asset-continuation", name: "asset-continuation" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "MEDIUM",
        views: ["front", "left"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:continuation",
      discrepancies: [
        {
          code: "WIDTH_LOW",
          severity: "REVIEW",
          summary: "Upper arms are slightly too narrow.",
          views: ["front"],
          evidence_targets: ["width"],
        },
        {
          code: "SHOULDER_CONTACT",
          severity: "REVIEW",
          summary: "Shoulder contact requires separate review.",
          views: ["left"],
          evidence_targets: ["attachment"],
        },
      ],
    });

    const before = registry.projectContinuation(handle);
    expect(before).toMatchObject({
      protocol: "lazydesigner-correction-continuation-v1",
      mode: "CANDIDATE_CONTEXT",
      state: "READY",
      unresolved_count: 2,
      verification: { pending: false, risk: "MEDIUM" },
    });
    expect(before.fresh_view_evidence).toEqual([
      { view: "front", handle: "verificationevidence:continuation" },
      { view: "left", handle: "verificationevidence:continuation" },
    ]);

    registry.planGeometryCorrection(handle, [{
      id: "widen-arms",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        target_discrepancy_codes: ["WIDTH_LOW"],
        correction_family: "RESIZE",
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS",
            axis: "X",
            mode: "MULTIPLY",
            value: 1.05,
            anchor: "MIN",
          },
        },
      },
    }]);

    const pending = registry.projectContinuation(handle);
    expect(pending.state).toBe("VERIFY_PENDING");
    expect(pending.mode).toBe("VERIFY_PENDING");
    expect(pending.verification.target_discrepancy_codes).toEqual(["WIDTH_LOW"]);
    expect(pending.verification.stale_views).toEqual(["front"]);
    expect(pending.fresh_view_evidence).toEqual([
      { view: "left", handle: "verificationevidence:continuation" },
    ]);
    expect(JSON.stringify(pending)).not.toContain("base_recipe");
    expect(JSON.stringify(pending)).not.toContain("evidence_fingerprint");
    expect(JSON.stringify(pending)).not.toContain("selected_candidate_id");
    expect(JSON.stringify(pending)).not.toContain("rejected_candidate_ids");
    expect(JSON.stringify(pending)).not.toContain("scope_instance_ids");

    registry.updateEvidence(handle, "verificationevidence:front-fresh", [], {
      cleared_target_codes: ["WIDTH_LOW"],
      recovered_views: ["front"],
    });
    const after = registry.projectContinuation(handle);
    expect(after.state).toBe("READY");
    expect(after.mode).toBe("PRUNED_READY");
    expect(after.unresolved.map((item) => item.code)).toEqual([
      "SHOULDER_CONTACT",
    ]);
    expect(after.fresh_view_evidence).toEqual([
      { view: "front", handle: "verificationevidence:front-fresh" },
      { view: "left", handle: "verificationevidence:continuation" },
    ]);
    expect(after.verification.pending).toBe(false);
  });

  test("second correction remains VERIFY_PENDING until its fresh evidence arrives", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-second-pending",
      base_recipe: { ...recipe(), id: "asset-second-pending", name: "asset-second-pending" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:first",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms remain too narrow.",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });

    const candidate = {
      id: "widen",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        target_discrepancy_codes: ["WIDTH_LOW"],
        correction_family: "RESIZE" as const,
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS" as const,
            axis: "X" as const,
            mode: "MULTIPLY" as const,
            value: 1.02,
            anchor: "MIN" as const,
          },
        },
      },
    };

    expect(registry.planGeometryCorrection(handle, [candidate]).attempt).toBe(1);
    registry.updateEvidence(
      handle,
      "verificationevidence:second",
      [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Width still differs after the first correction.",
        views: ["front"],
        evidence_targets: ["width"],
      }]
    );
    const plateau = registry.planGeometryCorrection(handle, [candidate]);
    expect(plateau.state).toBe("BLOCKED");
    expect(plateau.blocked_reason).toBe("QUALITY_PLATEAU_NO_GAIN");
    expect(registry.projectContinuation(handle)).toMatchObject({
      state: "BLOCKED",
      mode: "BLOCKED",
      convergence: {
        state: "PLATEAU",
        target_discrepancy_codes: ["WIDTH_LOW"],
      },
    });
  });

  test("targeted evidence update preserves unrelated discrepancies and tracks per-view handles across rounds", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "MEDIUM",
        views: ["front", "left"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:first",
      discrepancies: [
        {
          code: "WIDTH_LOW",
          severity: "REVIEW",
          summary: "Upper arms are slightly too narrow.",
          views: ["front"],
          evidence_targets: ["width"],
        },
        {
          code: "SHOULDER_CONTACT",
          severity: "REVIEW",
          summary: "Shoulder contact requires separate review.",
          views: ["left"],
          evidence_targets: ["attachment"],
        },
      ],
    });

    const first = registry.planGeometryCorrection(handle, [{
      id: "widen-arms",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        target_discrepancy_codes: ["WIDTH_LOW"],
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS",
            axis: "X",
            mode: "MULTIPLY",
            value: 1.05,
            anchor: "MIN",
          },
        },
      },
    }]);
    expect(first.evidence_reuse?.reusable_evidence).toEqual([
      { view: "left", handle: "verificationevidence:first" },
    ]);

    registry.updateEvidence(handle, "verificationevidence:front-second", [], {
      cleared_target_codes: ["WIDTH_LOW"],
      recovered_views: ["front"],
    });

    const afterUpdate = registry.projectContinuation(handle);
    expect(afterUpdate.unresolved).toEqual([
      {
        code: "SHOULDER_CONTACT",
        severity: "REVIEW",
        summary: "Shoulder contact requires separate review.",
        views: ["left"],
        evidence_targets: ["attachment"],
      },
    ]);
    expect(afterUpdate.fresh_view_evidence).toEqual([
      { view: "front", handle: "verificationevidence:front-second" },
      { view: "left", handle: "verificationevidence:first" },
    ]);

    const second = registry.planGeometryCorrection(handle, [{
      id: "fix-contact",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        target_discrepancy_codes: ["SHOULDER_CONTACT"],
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "TRANSLATE",
            delta: [0, 0, 0.25],
          },
        },
      },
    }]);

    expect(second.evidence_reuse).toMatchObject({
      stale_views: ["left"],
      reusable_views: ["front"],
      reusable_evidence: [
        { view: "front", handle: "verificationevidence:front-second" },
      ],
      basis: "TARGETED_VIEW_PROVENANCE",
    });
  });

  test("falls back to recapturing all request views when discrepancy view provenance is missing", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "MEDIUM",
        views: ["front", "left"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:first",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
      }],
    });

    const decision = registry.planGeometryCorrection(handle, [{
      id: "widen-arms",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        target_discrepancy_codes: ["WIDTH_LOW"],
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS",
            axis: "X",
            mode: "MULTIPLY",
            value: 1.05,
            anchor: "MIN",
          },
        },
      },
    }]);

    expect(decision.evidence_reuse).toEqual({
      source_handle: "verificationevidence:first",
      stale_views: ["front", "left"],
      reusable_views: [],
      reusable_evidence: [],
      basis: "CONSERVATIVE_ALL_VIEWS",
    });
  });

  test("expired evidence fails closed until fresh verification arrives without consuming an attempt", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-recovery",
      base_recipe: { ...recipe(), id: "asset-recovery", name: "asset-recovery" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "MEDIUM",
        views: ["front", "left"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:old",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Width needs review.",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });

    registry.invalidateEvidenceHandles(
      handle,
      ["verificationevidence:old"],
      "EVIDENCE_EXPIRED"
    );

    const continuation = registry.projectContinuation(handle);
    expect(continuation.mode).toBe("VERIFY_PENDING");
    expect(continuation.attempt).toBe(0);
    expect(continuation.verification).toMatchObject({
      pending: true,
      recovery_required: true,
      recovery_reason: "EVIDENCE_EXPIRED",
      stale_views: ["front", "left"],
    });
    expect(continuation.fresh_view_evidence).toEqual([]);

    const blocked = registry.planGeometryCorrection(handle, [{
      id: "resize",
      predicted_error: 0.05,
      mutation_cost: 0.08,
      risk: 0.09,
      patch: {
        correction_family: "RESIZE",
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS",
            axis: "X",
            mode: "MULTIPLY",
            value: 1.05,
            anchor: "MIN",
          },
        },
      },
    }]);
    expect(blocked.blocked_reason).toBe("EVIDENCE_RECOVERY_REQUIRED");
    expect(blocked.attempt).toBe(0);
    expect(registry.projectContinuation(handle).attempt).toBe(0);

    expect(() =>
      registry.updateEvidence(
        handle,
        "verificationevidence:partial",
        [{
          code: "WIDTH_LOW",
          severity: "REVIEW",
          summary: "Partial recovery.",
          views: ["front"],
          evidence_targets: ["width"],
        }],
        { recovered_views: ["front"] }
      )
    ).toThrow("EVIDENCE_RECOVERY_INCOMPLETE");
    expect(
      registry.projectContinuation(handle).verification.recovery_required
    ).toBe(true);

    registry.updateEvidence(
      handle,
      "verificationevidence:fresh",
      [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Width still needs review.",
        views: ["front"],
        evidence_targets: ["width"],
      }],
      { recovered_views: ["front", "left"] }
    );
    const recovered = registry.projectContinuation(handle);
    expect(recovered.verification.recovery_required).toBe(false);
    expect(recovered.verification.recovery_reason).toBeNull();
    expect(recovered.mode).toBe("CANDIDATE_CONTEXT");
  });

  test("runtime generation invalidation marks every active loop for evidence recovery", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handles = ["a", "b"].map((suffix) =>
      registry.start({
        recipe_id: "asset-" + suffix,
        base_recipe: { ...recipe(), id: "asset-" + suffix, name: "asset-" + suffix },
        verification_request: {
          domain: "GEOMETRY",
          source: "capture_model_views",
          verification_risk: "LOW",
          views: ["front"],
          views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
          size: 256,
          size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
          scope_instance_ids: ["arms:0", "arms:1"],
        },
        verification_evidence_handle:
          ("verificationevidence:generation-" + suffix) as any,
        discrepancies: [{
          code: "WIDTH_LOW_" + suffix,
          severity: "REVIEW",
          summary: "Width needs review.",
          views: ["front"],
          evidence_targets: ["width"],
        }],
      })
    );

    registry.invalidateRuntimeGeneration();

    for (const handle of handles) {
      expect(registry.projectContinuation(handle).verification).toMatchObject({
        pending: true,
        recovery_required: true,
        recovery_reason: "RUNTIME_GENERATION_CHANGED",
      });
    }
  });

  test("runtime generation invalidation aborts an open continuation group", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-generation",
      base_recipe: { ...recipe(), id: "asset-generation", name: "asset-generation" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:generation-a",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Width needs review.",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });

    registry.beginContinuationGroup(handle, "VERIFICATION_COHORT");
    registry.invalidateEvidenceHandles(
      handle,
      ["verificationevidence:generation-a"],
      "RUNTIME_GENERATION_CHANGED"
    );

    const delivery = registry.projectContinuationDelivery(handle);
    expect(delivery.delivery).not.toBe("DEFERRED");
    expect(delivery.payload?.verification).toMatchObject({
      recovery_required: true,
      recovery_reason: "RUNTIME_GENERATION_CHANGED",
    });
  });

  test("rejects a correction that targets a discrepancy absent from current evidence", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:first",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
      }],
    });

    const decision = registry.planGeometryCorrection(handle, [{
      id: "wrong-target",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        target_discrepancy_codes: ["UNKNOWN_CODE"],
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS",
            axis: "X",
            mode: "MULTIPLY",
            value: 1.05,
            anchor: "MIN",
          },
        },
      },
    }]);

    expect(decision.state).toBe("BLOCKED");
    expect(decision.blocked_reason).toBe("NO_ELIGIBLE_CORRECTION");
  });


  test("reverification and Runtime recovery cannot claim new quality evidence from the same handle", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-freshness",
      base_recipe: { ...recipe(), id: "asset-freshness", name: "asset-freshness" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:pre-correction",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "The arm appears too narrow.",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });
    const decision = registry.planGeometryCorrection(handle, [{
      id: "resize",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        target_discrepancy_codes: ["WIDTH_LOW"],
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: { kind: "RESIZE_AXIS", axis: "X", mode: "ADD", value: 1, anchor: "MIN" },
        },
      },
    }]);
    expect(decision.state).toBe("CORRECTION_READY");
    const before = registry.projectContinuation(handle);
    const revised = [{
      code: "WIDTH_LOW",
      severity: "INFO" as const,
      summary: "Claimed width improvement with no fresh capture.",
      views: ["front" as const],
      evidence_targets: ["width" as const],
    }];
    expect(() =>
      registry.updateEvidence(handle, "verificationevidence:pre-correction", revised)
    ).toThrow("CORRECTION_FRESH_EVIDENCE_REQUIRED");
    expect(registry.projectContinuation(handle)).toEqual(before);

    registry.updateEvidence(handle, "verificationevidence:new-observation", revised);
    expect(registry.projectContinuation(handle).convergence.state).toBe("IMPROVED");

    registry.invalidateEvidenceHandles(
      handle,
      ["verificationevidence:new-observation"],
      "RUNTIME_GENERATION_CHANGED"
    );
    const pendingRecovery = registry.projectContinuation(handle);
    expect(() =>
      registry.updateEvidence(handle, "verificationevidence:new-observation", revised, {
        recovered_views: ["front"],
      })
    ).toThrow("CORRECTION_FRESH_EVIDENCE_REQUIRED");
    expect(registry.projectContinuation(handle)).toEqual(pendingRecovery);
  });

  test("blocks a second correction when no new evidence exists", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:first",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
      }],
    });

    const candidates = [{
      id: "widen-arms",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS" as const,
            axis: "X" as const,
            mode: "MULTIPLY" as const,
            value: 1.05,
            anchor: "MIN" as const,
          },
        },
      },
    }];

    expect(registry.planGeometryCorrection(handle, candidates).state).toBe("CORRECTION_READY");
    const second = registry.planGeometryCorrection(handle, candidates);
    expect(second.state).toBe("BLOCKED");
    expect(second.blocked_reason).toBe("REPEATED_FAILURE_WITHOUT_NEW_EVIDENCE");
  });

  test("allows a second bounded correction only after fresh verification evidence", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:first",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are slightly too narrow.",
      }],
    });
    const candidates = [{
      id: "widen-arms",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS" as const,
            axis: "X" as const,
            mode: "MULTIPLY" as const,
            value: 1.02,
            anchor: "MIN" as const,
          },
        },
      },
    }];

    expect(registry.planGeometryCorrection(handle, candidates).attempt).toBe(1);
    registry.updateEvidence(
      handle,
      "verificationevidence:second",
      [{
        code: "WIDTH_LOW",
        severity: "INFO",
        summary: "Width improved but remains slightly low.",
      }]
    );
    const second = registry.planGeometryCorrection(handle, candidates);
    expect(second.state).toBe("CORRECTION_READY");
    expect(second.attempt).toBe(2);
  });

  test("evidence-backed cause rejects a mismatched repair family", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-causal",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:causal",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Upper arms are too narrow.",
        quality_class: "PRIMARY_FORM",
        owner: "GEOMETRY",
        cause_family: "SIZE_MISMATCH",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });

    const decision = registry.planGeometryCorrection(handle, [{
      id: "translate-wrong-cause",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        target_discrepancy_codes: ["WIDTH_LOW"],
        correction_family: "TRANSLATE",
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: { kind: "TRANSLATE", delta: [0.5, 0, 0] },
        },
      },
    }]);

    expect(decision.state).toBe("BLOCKED");
    expect(decision.blocked_reason).toBe("CAUSAL_REPAIR_MISMATCH");
    expect(decision.attempt).toBe(0);
  });

  test("structural causes stay on their owning route instead of being disguised as numeric edits", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-structural",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0"],
      },
      verification_evidence_handle: "verificationevidence:structural",
      discrepancies: [{
        code: "MISSING_HAND",
        severity: "REVIEW",
        summary: "Required hand is missing.",
        quality_class: "REQUIRED_PART",
        owner: "GEOMETRY",
        cause_family: "MISSING_REQUIRED_PART",
        views: ["front"],
        evidence_targets: ["silhouette"],
      }],
    });

    const decision = registry.planGeometryCorrection(handle, [{
      id: "inflate-placeholder",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        target_discrepancy_codes: ["MISSING_HAND"],
        correction_family: "LAYER_OFFSET",
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: { kind: "INFLATE", mode: "ADD", value: 0.25 },
        },
      },
    }]);

    expect(decision.state).toBe("BLOCKED");
    expect(decision.blocked_reason).toBe("CAUSE_REQUIRES_OWNER_ROUTE");
    expect(decision.attempt).toBe(0);
  });


  test("same-cause same-severity re-verification stops low-value repeat correction", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-plateau",
      base_recipe: { ...recipe(), id: "asset-plateau", name: "asset-plateau" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:plateau-0",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Arms are too narrow.",
        quality_class: "PRIMARY_FORM",
        owner: "GEOMETRY",
        cause_family: "SIZE_MISMATCH",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });
    const candidate = {
      id: "resize",
      predicted_error: 0.05,
      mutation_cost: 0.08,
      risk: 0.08,
      patch: {
        target_discrepancy_codes: ["WIDTH_LOW"],
        correction_family: "RESIZE" as const,
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS" as const,
            axis: "X" as const,
            mode: "MULTIPLY" as const,
            value: 1.03,
            anchor: "MIN" as const,
          },
        },
      },
    };

    expect(registry.planGeometryCorrection(handle, [candidate]).state).toBe(
      "CORRECTION_READY"
    );
    registry.updateEvidence(handle, "verificationevidence:plateau-1", [{
      code: "WIDTH_LOW",
      severity: "REVIEW",
      summary: "Arms remain too narrow.",
      quality_class: "PRIMARY_FORM",
      owner: "GEOMETRY",
      cause_family: "SIZE_MISMATCH",
      views: ["front"],
      evidence_targets: ["width"],
    }]);

    const continuation = registry.projectContinuation(handle);
    expect(continuation.convergence).toEqual({
      state: "PLATEAU",
      target_discrepancy_codes: ["WIDTH_LOW"],
    });
    expect(continuation.state).toBe("BLOCKED");
    const retry = registry.planGeometryCorrection(handle, [candidate]);
    expect(retry.blocked_reason).toBe("QUALITY_PLATEAU_NO_GAIN");
    expect(retry.attempt).toBe(1);
  });


  test("a worsened targeted defect cannot be masked by improvement of another target", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-mixed-convergence",
      base_recipe: { ...recipe(), id: "asset-mixed-convergence", name: "asset-mixed-convergence" },
      verification_request: {
        domain: "GEOMETRY", source: "capture_model_views",
        verification_risk: "MEDIUM", views: ["front", "left"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256, size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:mixed-before",
      discrepancies: [
        {
          code: "MAIN_FORM", severity: "BLOCKING",
          summary: "Primary mass is wrong.",
          quality_class: "PRIMARY_FORM", owner: "GEOMETRY",
          cause_family: "SIZE_MISMATCH", views: ["front"],
        },
        {
          code: "SIDE_CONTACT", severity: "INFO",
          summary: "Small contact gap remains.",
          quality_class: "NEGATIVE_SPACE_CONTACT", owner: "GEOMETRY",
          cause_family: "SIZE_MISMATCH", views: ["left"],
        },
      ],
    });
    const candidate = {
      id: "widen-arms", predicted_error: 0.1, mutation_cost: 0.1, risk: 0.1,
      patch: {
        target_discrepancy_codes: ["MAIN_FORM", "SIDE_CONTACT"],
        correction_family: "RESIZE" as const,
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: { kind: "RESIZE_AXIS" as const, axis: "X" as const,
            mode: "ADD" as const, value: 1, anchor: "MIN" as const },
        },
      },
    };
    expect(registry.planGeometryCorrection(handle, [candidate]).state).toBe("CORRECTION_READY");
    registry.updateEvidence(handle, "verificationevidence:mixed-after", [
      {
        code: "MAIN_FORM", severity: "REVIEW",
        summary: "Primary mass appears improved.",
        quality_class: "PRIMARY_FORM", owner: "GEOMETRY",
        cause_family: "SIZE_MISMATCH", views: ["front"],
      },
      {
        code: "SIDE_CONTACT", severity: "BLOCKING",
        summary: "Contact is now severely wrong.",
        quality_class: "NEGATIVE_SPACE_CONTACT", owner: "GEOMETRY",
        cause_family: "SIZE_MISMATCH", views: ["left"],
      },
    ], { recovered_views: ["front", "left"] });

    const continuation = registry.projectContinuation(handle);
    expect(continuation).toMatchObject({
      state: "BLOCKED",
      convergence: {
        state: "PLATEAU",
        target_discrepancy_codes: ["MAIN_FORM", "SIDE_CONTACT"],
      },
      quality_focus: { code: "SIDE_CONTACT", severity: "BLOCKING" },
    });
    expect(registry.planGeometryCorrection(handle, [candidate])).toMatchObject({
      state: "BLOCKED",
      attempt: 1,
      blocked_reason: "BLOCKING_PLATEAU_REQUIRES_NEW_EVIDENCE",
    });
  });

  test("severity reduction counts as demonstrated gain and permits one bounded continuation", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-improved",
      base_recipe: { ...recipe(), id: "asset-improved", name: "asset-improved" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:improved-0",
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "BLOCKING",
        summary: "Primary width is materially wrong.",
        quality_class: "PRIMARY_FORM",
        owner: "GEOMETRY",
        cause_family: "SIZE_MISMATCH",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });
    const candidate = {
      id: "resize",
      predicted_error: 0.05,
      mutation_cost: 0.08,
      risk: 0.08,
      patch: {
        target_discrepancy_codes: ["WIDTH_LOW"],
        correction_family: "RESIZE" as const,
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS" as const,
            axis: "X" as const,
            mode: "MULTIPLY" as const,
            value: 1.03,
            anchor: "MIN" as const,
          },
        },
      },
    };

    registry.planGeometryCorrection(handle, [candidate]);
    registry.updateEvidence(handle, "verificationevidence:improved-1", [{
      code: "WIDTH_LOW",
      severity: "REVIEW",
      summary: "Width improved; small mismatch remains.",
      quality_class: "PRIMARY_FORM",
      owner: "GEOMETRY",
      cause_family: "SIZE_MISMATCH",
      views: ["front"],
      evidence_targets: ["width"],
    }]);

    expect(registry.projectContinuation(handle).convergence.state).toBe(
      "IMPROVED"
    );
    expect(registry.planGeometryCorrection(handle, [candidate]).state).toBe(
      "CORRECTION_READY"
    );
  });

  test("new evidence changing the diagnosed cause breaks plateau and allows a new route", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-cause-change",
      base_recipe: { ...recipe(), id: "asset-cause-change", name: "asset-cause-change" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "MEDIUM",
        views: ["front", "left"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0"],
      },
      verification_evidence_handle: "verificationevidence:cause-0",
      discrepancies: [{
        code: "ARM_MISMATCH",
        severity: "REVIEW",
        summary: "Arm position/form mismatch.",
        quality_class: "PRIMARY_FORM",
        owner: "GEOMETRY",
        cause_family: "SIZE_MISMATCH",
        views: ["front", "left"],
        evidence_targets: ["width", "attachment"],
      }],
    });
    const resizeCandidate = {
      id: "resize",
      predicted_error: 0.08,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        target_discrepancy_codes: ["ARM_MISMATCH"],
        correction_family: "RESIZE" as const,
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS" as const,
            axis: "X" as const,
            mode: "MULTIPLY" as const,
            value: 1.03,
            anchor: "MIN" as const,
          },
        },
      },
    };
    registry.planGeometryCorrection(handle, [resizeCandidate]);
    registry.updateEvidence(handle, "verificationevidence:cause-1", [{
      code: "ARM_MISMATCH",
      severity: "REVIEW",
      summary: "Fresh side evidence shows position, not size, owns the mismatch.",
      quality_class: "PRIMARY_FORM",
      owner: "GEOMETRY",
      cause_family: "POSITION_MISMATCH",
      views: ["left"],
      evidence_targets: ["attachment"],
    }]);

    expect(registry.projectContinuation(handle).convergence.state).toBe(
      "CAUSE_CHANGED"
    );
    const translate = registry.planGeometryCorrection(handle, [{
      id: "translate",
      predicted_error: 0.06,
      mutation_cost: 0.08,
      risk: 0.08,
      patch: {
        target_discrepancy_codes: ["ARM_MISMATCH"],
        correction_family: "TRANSLATE",
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: { kind: "TRANSLATE", delta: [0.25, 0, 0] },
        },
      },
    }]);
    expect(translate.state).toBe("CORRECTION_READY");
  });

  test("blocking plateau never becomes acceptance and requires new evidence", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const handle = registry.start({
      recipe_id: "asset-blocking-plateau",
      base_recipe: { ...recipe(), id: "asset-blocking-plateau", name: "asset-blocking-plateau" },
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "HIGH",
        views: ["front", "left", "front_left_3q"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 512,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0"],
      },
      verification_evidence_handle: "verificationevidence:block-0",
      discrepancies: [{
        code: "ATTACHMENT_BROKEN",
        severity: "BLOCKING",
        summary: "Arm attachment is broken.",
        quality_class: "TOPOLOGY_ATTACHMENT",
        owner: "GEOMETRY",
        cause_family: "POSITION_MISMATCH",
        views: ["front", "left"],
        evidence_targets: ["attachment"],
      }],
    });
    const candidate = {
      id: "translate",
      predicted_error: 0.05,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        target_discrepancy_codes: ["ATTACHMENT_BROKEN"],
        correction_family: "TRANSLATE" as const,
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: { kind: "TRANSLATE" as const, delta: [0.25, 0, 0] as [number, number, number] },
        },
      },
    };
    registry.planGeometryCorrection(handle, [candidate]);
    registry.updateEvidence(handle, "verificationevidence:block-1", [{
      code: "ATTACHMENT_BROKEN",
      severity: "BLOCKING",
      summary: "Attachment remains broken after correction.",
      quality_class: "TOPOLOGY_ATTACHMENT",
      owner: "GEOMETRY",
      cause_family: "POSITION_MISMATCH",
      views: ["front", "left"],
      evidence_targets: ["attachment"],
    }]);

    expect(registry.projectContinuation(handle)).toMatchObject({
      state: "BLOCKED",
      convergence: { state: "PLATEAU" },
    });
    expect(
      registry.planGeometryCorrection(handle, [candidate]).blocked_reason
    ).toBe("BLOCKING_PLATEAU_REQUIRES_NEW_EVIDENCE");
  });


  test("structured observations enter correction only after evidence compilation", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const result = registry.startFromObservations({
      recipe_id: "asset-observed",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0", "arms:1"],
      },
      verification_evidence_handle: "verificationevidence:observed",
      observations: [
        {
          code: "WIDTH_LOW",
          criterion: "SILHOUETTE_PROPORTION",
          severity: "REVIEW",
          summary: "Upper arms read too narrow.",
          evidence: {
            current_evidence_ref: "visual:front:2",
            reference_evidence_ref: "IMG_FRONT",
            views: ["front"],
            evidence_targets: ["width", "silhouette"],
          },
          cause_family: "SIZE_MISMATCH",
        },
        {
          code: "UNVERIFIED_DETAIL",
          criterion: "SECONDARY_GEOMETRY_DETAIL",
          severity: "INFO",
          summary: "Small trim may differ.",
          evidence: {
            current_evidence_ref: "visual:front:2",
          },
        },
      ],
    });

    expect(result.handle).not.toBeNull();
    expect(result.unverified).toEqual([
      {
        code: "UNVERIFIED_DETAIL",
        reason: "REFERENCE_EVIDENCE_REQUIRED",
      },
    ]);

    const continuation = registry.projectContinuation(result.handle!);
    expect(continuation.unresolved).toHaveLength(1);
    expect(continuation.unresolved[0]).toMatchObject({
      code: "WIDTH_LOW",
      quality_class: "PRIMARY_FORM",
      owner: "GEOMETRY",
      cause_family: "SIZE_MISMATCH",
    });
  });

  test("structured visual correction only plans a grounded Geometry target and preserves existing raw corrections", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const request = {
      domain: "GEOMETRY" as const,
      source: "capture_model_views" as const,
      verification_risk: "LOW" as const,
      views: ["front" as const],
      views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS" as const,
      size: 256 as const,
      size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS" as const,
      scope_instance_ids: ["arms:0", "arms:1"],
    };
    const observed = {
      code: "FOCAL_WIDTH",
      criterion: "SILHOUETTE_PROPORTION" as const,
      severity: "REVIEW" as const,
      summary: "The focal mass is narrower than the paired source view.",
      evidence: {
        current_evidence_ref: "model:front:revision-1",
        reference_evidence_ref: "source:front:approved",
        views: ["front" as const],
        evidence_targets: ["width" as const, "silhouette" as const],
      },
    };
    const candidate = {
      id: "resize-focal-mass", predicted_error: 0.1, mutation_cost: 0.1, risk: 0.1,
      patch: {
        target_discrepancy_codes: ["FOCAL_WIDTH"],
        correction_family: "RESIZE" as const,
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS" as const, axis: "X" as const,
            mode: "ADD" as const, value: 1, anchor: "MIN" as const,
          },
        },
      },
    };
    const started = registry.startFromObservations({
      recipe_id: "asset", base_recipe: recipe(),
      verification_request: request,
      verification_evidence_handle: "verificationevidence:focal-before",
      observations: [{ ...observed, cause_family: "UNKNOWN" }],
    });
    expect(started.unverified).toEqual([]);
    const handle = started.handle!;
    expect(registry.planGeometryCorrection(handle, [candidate])).toMatchObject({
      state: "BLOCKED", attempt: 0, blocked_reason: "VISUAL_CAUSE_UNVERIFIED",
    });
    expect(registry.projectContinuation(handle)).toMatchObject({ attempt: 0 });

    // Fresh observation can classify the cause; a guessed target or an
    // incompatible edit family still cannot consume the visual correction.
    const updated = registry.updateEvidenceFromObservations(
      handle, "verificationevidence:focal-classified",
      [{ ...observed, cause_family: "SIZE_MISMATCH",
        evidence: { ...observed.evidence, current_evidence_ref: "model:front:revision-2" } }]
    );
    expect(updated).toMatchObject({ applied: true, accepted_count: 1, unverified: [] });
    expect(registry.planGeometryCorrection(handle, [{
      ...candidate, patch: { ...candidate.patch, target_discrepancy_codes: ["UNRELATED"] },
    }])).toMatchObject({
      state: "BLOCKED", attempt: 0, blocked_reason: "VISUAL_CANDIDATE_UNGROUNDED",
    });
    expect(registry.planGeometryCorrection(handle, [{
      ...candidate, patch: { ...candidate.patch, correction_family: "ROTATE" as const },
    }])).toMatchObject({
      state: "BLOCKED", attempt: 0, blocked_reason: "VISUAL_CANDIDATE_UNGROUNDED",
    });
    // An independently diagnosed but lower-priority detail is not a
    // substitute for the current focal-form problem just because it is cheap.
    const second = registry.startFromObservations({
      recipe_id: "asset", base_recipe: recipe(),
      verification_request: request,
      verification_evidence_handle: "verificationevidence:focus-before",
      observations: [
        { ...observed, cause_family: "SIZE_MISMATCH" },
        {
          code: "TRIM_LOCATION", criterion: "SECONDARY_GEOMETRY_DETAIL",
          severity: "INFO", summary: "A small trim is slightly displaced.",
          evidence: {
            current_evidence_ref: "model:front:revision-1",
            reference_evidence_ref: "source:trim:approved", views: ["front"],
          },
          cause_family: "POSITION_MISMATCH",
        },
      ],
    });
    expect(second.unverified).toEqual([]);
    expect(registry.planGeometryCorrection(second.handle!, [{
      ...candidate, id: "cheap-trim",
      patch: {
        ...candidate.patch, target_discrepancy_codes: ["TRIM_LOCATION"],
        correction_family: "TRANSLATE",
        intent: { target: { semantic_group: "upper_arm" },
          operation: { kind: "TRANSLATE", delta: [0.25, 0, 0] } },
      },
    }])).toMatchObject({
      state: "BLOCKED", attempt: 0, blocked_reason: "VISUAL_CANDIDATE_UNGROUNDED",
    });
    expect(registry.projectContinuation(second.handle!)).toMatchObject({ attempt: 0 });

    expect(registry.planGeometryCorrection(handle, [candidate])).toMatchObject({
      state: "CORRECTION_READY", attempt: 1,
      decision_summary: { selected_candidate_id: "resize-focal-mass" },
    });

    // A more severe material discrepancy must remain with Texturing, even
    // when a cheaper valid Geometry candidate is available in the same batch.
    const mixed = registry.startFromObservations({
      recipe_id: "asset", base_recipe: recipe(),
      verification_request: request,
      verification_evidence_handle: "verificationevidence:mixed",
      observations: [
        { ...observed, cause_family: "SIZE_MISMATCH" },
        {
          code: "METAL_REGION", criterion: "TEXTURE_MATERIAL_REGION",
          severity: "BLOCKING", summary: "Material differs from the approved image.",
          evidence: {
            current_evidence_ref: "model:mapped:revision-2",
            reference_evidence_ref: "source:metal:approved",
            views: ["front"],
          },
          cause_family: "MATERIAL_MISMATCH",
        },
      ],
    });
    expect(mixed.unverified).toEqual([]);
    expect(registry.planGeometryCorrection(mixed.handle!, [candidate])).toMatchObject({
      state: "BLOCKED", attempt: 0, blocked_reason: "VISUAL_GEOMETRY_OWNER_MISMATCH",
    });
    expect(registry.projectContinuation(mixed.handle!)).toMatchObject({ attempt: 0 });
  });

  test("observation update excludes unsupported claims from fresh correction evidence", () => {
    const registry = new SyntheticAppliedCorrectionLoopRegistry();
    const started = registry.startFromObservations({
      recipe_id: "asset",
      base_recipe: recipe(),
      verification_request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["arms:0"],
      },
      verification_evidence_handle: "verificationevidence:obs-0",
      observations: [{
        code: "WIDTH_LOW",
        criterion: "SILHOUETTE_PROPORTION",
        severity: "REVIEW",
        summary: "Arm width differs.",
        evidence: {
          current_evidence_ref: "visual:front:0",
          reference_evidence_ref: "IMG_FRONT",
          views: ["front"],
          evidence_targets: ["width"],
        },
        cause_family: "SIZE_MISMATCH",
      }],
    });
    const handle = started.handle!;
    registry.planGeometryCorrection(handle, [{
      id: "resize",
      predicted_error: 0.1,
      mutation_cost: 0.1,
      risk: 0.1,
      patch: {
        target_discrepancy_codes: ["WIDTH_LOW"],
        correction_family: "RESIZE",
        intent: {
          target: { semantic_group: "upper_arm" },
          operation: {
            kind: "RESIZE_AXIS",
            axis: "X",
            mode: "MULTIPLY",
            value: 1.05,
            anchor: "MIN",
          },
        },
      },
    }]);

    const update = registry.updateEvidenceFromObservations(
      handle,
      "verificationevidence:obs-1",
      [{
        code: "WIDTH_LOW",
        criterion: "SILHOUETTE_PROPORTION",
        severity: "REVIEW",
        summary: "Width still differs but current comparison lacks reference pairing.",
        evidence: {
          current_evidence_ref: "visual:front:1",
          views: ["front"],
          evidence_targets: ["width"],
        },
      }]
    );

    expect(update.applied).toBe(false);
    expect(update.accepted_count).toBe(0);
    expect(update.unverified).toEqual([
      { code: "WIDTH_LOW", reason: "REFERENCE_EVIDENCE_REQUIRED" },
    ]);
    expect(registry.projectContinuation(handle)).toMatchObject({
      state: "VERIFY_PENDING",
      convergence: {
        state: "PENDING_VERIFICATION",
        target_discrepancy_codes: ["WIDTH_LOW"],
      },
      verification: {
        pending: true,
        target_discrepancy_codes: ["WIDTH_LOW"],
      },
    });
  });

});
