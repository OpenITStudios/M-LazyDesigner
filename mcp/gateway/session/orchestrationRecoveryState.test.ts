import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import type { VerificationEvidenceRequest } from "@/lib/orchestration/evidencePlan";
import { GatewayOrchestrationRecoveryState } from "./orchestrationRecoveryState";

function recipe(): AuthoringRecipe {
  return {
    schema: 1,
    compiler_version: 1,
    id: "recovery-asset",
    name: "recovery-asset",
    prototypes: [
      {
        id: "arm",
        name: "arm",
        size: [4, 8, 4],
        semantic_group: "upper_arm",
      },
    ],
    patterns: [
      {
        kind: "LINEAR",
        id: "arms",
        prototype_id: "arm",
        count: 2,
        axis: "X",
        spacing: 8,
        semantic_group: "upper_arm",
      },
    ],
  };
}

function geometryRequest(): VerificationEvidenceRequest {
  return {
    domain: "GEOMETRY",
    source: "capture_model_views",
    verification_risk: "LOW",
    views: ["front"],
    views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
    size: 256,
    size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
    scope_instance_ids: ["arms:0", "arms:1"],
  };
}

describe("Gateway orchestration recovery state", () => {
  test("runtime generation invalidation clears evidence and marks active corrections for recovery", () => {
    const state = new GatewayOrchestrationRecoveryState();
    const request = geometryRequest();
    const evidenceHandle = state.evidence.put({
      request,
      result: { revision: 1 },
    });
    const correctionHandle = state.corrections.start({
      recipe_id: "recovery-asset",
      base_recipe: recipe(),
      verification_request: request,
      verification_evidence_handle: evidenceHandle,
      discrepancies: [
        {
          code: "WIDTH_LOW",
          severity: "REVIEW",
          summary: "Width needs review.",
          views: ["front"],
          evidence_targets: ["width"],
        },
      ],
    });

    expect(state.snapshot()).toEqual({
      invalidation_count: 0,
      project_reset_count: 0,
      project_uuid: null,
      project_epoch: 0,
      evidence_entries: 1,
      correction_loops: 1,
    });

    state.invalidateRuntimeGeneration();

    expect(state.snapshot()).toEqual({
      invalidation_count: 1,
      project_reset_count: 0,
      project_uuid: null,
      project_epoch: 0,
      evidence_entries: 0,
      correction_loops: 1,
    });
    expect(state.corrections.projectContinuation(correctionHandle).verification)
      .toMatchObject({
        pending: true,
        recovery_required: true,
        recovery_reason: "RUNTIME_GENERATION_CHANGED",
      });
    expect(() => state.evidence.get(evidenceHandle)).toThrow(
      "VERIFICATION_EVIDENCE_NOT_FOUND"
    );
  });
  test("identical visual evidence gets a new handle after every Runtime generation", () => {
    const state = new GatewayOrchestrationRecoveryState("runtime-evidence-handle-test");
    state.synchronizeProjectAffinity("project-a");
    const record = {
      request: geometryRequest(),
      result: { revision: 1 },
    };
    const originalEvidence = state.evidence.put(record);
    const correctionInput = {
      recipe_id: "recovery-asset",
      base_recipe: recipe(),
      verification_request: record.request,
      verification_evidence_handle: originalEvidence,
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW" as const,
        summary: "Width needs review.",
        views: ["front"] as Array<"front">,
        evidence_targets: ["width"],
      }],
    };
    const originalCorrection = state.corrections.start(correctionInput);

    state.invalidateRuntimeGeneration();
    expect(() => state.evidence.get(originalEvidence))
      .toThrow("VERIFICATION_EVIDENCE_NOT_FOUND");
    const recoveredEvidence = state.evidence.put(record);
    expect(recoveredEvidence).not.toBe(originalEvidence);
    expect(() => state.evidence.get(originalEvidence))
      .toThrow("VERIFICATION_EVIDENCE_NOT_FOUND");
    expect(state.evidence.get(recoveredEvidence)).toEqual(record);
    expect(state.corrections.projectContinuation(originalCorrection).verification)
      .toMatchObject({
        recovery_required: true,
        recovery_reason: "RUNTIME_GENERATION_CHANGED",
      });
    const newCorrection = state.corrections.start({
      ...correctionInput,
      verification_evidence_handle: recoveredEvidence,
    });
    expect(newCorrection).not.toBe(originalCorrection);

    state.invalidateRuntimeGeneration();
    expect(() => state.evidence.get(recoveredEvidence))
      .toThrow("VERIFICATION_EVIDENCE_NOT_FOUND");
    const nextEvidence = state.evidence.put(record);
    expect(nextEvidence).not.toBe(recoveredEvidence);
    expect(nextEvidence).not.toBe(originalEvidence);
  });

  test("same project affinity does not reset active orchestration state", () => {
    const state = new GatewayOrchestrationRecoveryState();
    expect(state.synchronizeProjectAffinity("project-a")).toBe(false);

    const before = state.snapshot();
    expect(state.synchronizeProjectAffinity("project-a")).toBe(false);
    expect(state.snapshot()).toEqual(before);
  });

  test("project affinity switch hard-resets all orchestration state and scopes new identities", () => {
    const state = new GatewayOrchestrationRecoveryState();
    const request = geometryRequest();

    expect(state.synchronizeProjectAffinity("project-a")).toBe(false);

    const evidenceA = state.evidence.put({
      request,
      result: { revision: 1 },
    });
    const correctionA = state.corrections.start({
      recipe_id: "same-asset",
      base_recipe: { ...recipe(), id: "same-asset", name: "same-asset" },
      verification_request: request,
      verification_evidence_handle: evidenceA,
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Width needs review.",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });
    const continuationA = state.corrections.projectContinuation(correctionA);
    state.corrections.beginContinuationGroup(
      correctionA,
      "VERIFICATION_COHORT"
    );

    expect(state.synchronizeProjectAffinity("project-b")).toBe(true);
    expect(state.snapshot()).toMatchObject({
      project_reset_count: 1,
      project_uuid: "project-b",
      project_epoch: 2,
      evidence_entries: 0,
      correction_loops: 0,
    });
    expect(() => state.evidence.get(evidenceA)).toThrow(
      "VERIFICATION_EVIDENCE_NOT_FOUND"
    );
    expect(() => state.corrections.projectContinuation(correctionA)).toThrow(
      "CORRECTION_LOOP_NOT_FOUND"
    );

    const evidenceB = state.evidence.put({
      request,
      result: { revision: 1 },
    });
    const correctionB = state.corrections.start({
      recipe_id: "same-asset",
      base_recipe: { ...recipe(), id: "same-asset", name: "same-asset" },
      verification_request: request,
      verification_evidence_handle: evidenceB,
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Width needs review.",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });
    const continuationB = state.corrections.projectContinuation(correctionB);

    expect(evidenceB).not.toBe(evidenceA);
    expect(correctionB).not.toBe(correctionA);
    expect(continuationB.continuation_id).not.toBe(
      continuationA.continuation_id
    );

    expect(state.synchronizeProjectAffinity("project-a")).toBe(true);
    const evidenceA2 = state.evidence.put({
      request,
      result: { revision: 1 },
    });
    expect(evidenceA2).not.toBe(evidenceA);
    expect(state.snapshot()).toMatchObject({
      project_reset_count: 2,
      project_uuid: "project-a",
      project_epoch: 3,
    });
  });

  test("process restart creates a new handle namespace even for the same project and payload", () => {
    const request = geometryRequest();

    const firstProcess = new GatewayOrchestrationRecoveryState("process-a");
    const secondProcess = new GatewayOrchestrationRecoveryState("process-b");

    expect(firstProcess.synchronizeProjectAffinity("project-a")).toBe(false);
    expect(secondProcess.synchronizeProjectAffinity("project-a")).toBe(false);

    const evidenceA = firstProcess.evidence.put({
      request,
      result: { revision: 1 },
    });
    const evidenceB = secondProcess.evidence.put({
      request,
      result: { revision: 1 },
    });

    const correctionA = firstProcess.corrections.start({
      recipe_id: "same-asset",
      base_recipe: { ...recipe(), id: "same-asset", name: "same-asset" },
      verification_request: request,
      verification_evidence_handle: evidenceA,
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Width needs review.",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });
    const correctionB = secondProcess.corrections.start({
      recipe_id: "same-asset",
      base_recipe: { ...recipe(), id: "same-asset", name: "same-asset" },
      verification_request: request,
      verification_evidence_handle: evidenceB,
      discrepancies: [{
        code: "WIDTH_LOW",
        severity: "REVIEW",
        summary: "Width needs review.",
        views: ["front"],
        evidence_targets: ["width"],
      }],
    });

    expect(evidenceB).not.toBe(evidenceA);
    expect(correctionB).not.toBe(correctionA);
    expect(
      secondProcess.corrections.projectContinuation(correctionB).continuation_id
    ).not.toBe(
      firstProcess.corrections.projectContinuation(correctionA).continuation_id
    );

    expect(() => secondProcess.evidence.get(evidenceA)).toThrow(
      "VERIFICATION_EVIDENCE_NOT_FOUND"
    );
    expect(() =>
      secondProcess.corrections.projectContinuation(correctionA)
    ).toThrow("CORRECTION_LOOP_NOT_FOUND");
  });

});
