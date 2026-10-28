import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import type { AuthoringRecipeApplyReceipt } from "@/lib/authoringRecipe/transaction";
import { CorrectionLoopRegistry } from "@/lib/orchestration/correctionLoop";
import {
  compareReferenceLandmarkProjection,
  type LandmarkCaptureEvidence,
} from "@/lib/reference/landmarkEvidence";

function recipe(): AuthoringRecipe {
  return {
    schema: 1, compiler_version: 1, id: "landmark-asset", name: "landmark-asset",
    prototypes: [{ id: "body", name: "body", size: [4, 8, 4], semantic_group: "body" }],
    patterns: [{
      kind: "LINEAR", id: "body-instance", prototype_id: "body",
      count: 1, axis: "X", spacing: 8, semantic_group: "body",
    }],
  };
}

function capture(handle: string, x: number): LandmarkCaptureEvidence {
  return {
    evidence_handle: handle, project_uuid: "bedrock-project-1",
    front_direction: "+z", width: 512, height: 512,
    framing_bounds: { min: [-5, 0, -5], max: [5, 12, 5] },
    cameras: [{
      view: "front", projection: "orthographic",
      position: [0, 6, 30], target: [0, 6, 0], up: [0, 1, 0],
      zoom: 12, fov: null,
    }],
    landmarks: [compareReferenceLandmarkProjection({
      reference_image_id: "IMG_FRONT", reference_sha256: "a".repeat(64),
      view: "front", landmark_id: "body_center",
      model_cube_uuid: "uuid-body", model_anchor: "CUBE_CENTER",
      model_world_point: [0, 6, 0], reference_uv: [0.4, 0.5],
      projected_uv: [x, 0.5], ndc_depth: 0,
    })],
  };
}

function startWithPendingCorrection() {
  const registry = new CorrectionLoopRegistry();
  const handle = registry.start({
    recipe_id: "landmark-asset",
    base_recipe: recipe(),
    verification_request: {
      domain: "GEOMETRY", source: "capture_model_views",
      verification_risk: "LOW", views: ["front"],
      views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
      size: 512, size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
      scope_instance_ids: ["body-instance:0"],
    },
    verification_evidence_handle: "verificationevidence:landmark-before",
    discrepancies: [{
      code: "BODY_SIZE", severity: "REVIEW", summary: "Body size is wrong.",
      quality_class: "PRIMARY_FORM", owner: "GEOMETRY",
      cause_family: "SIZE_MISMATCH",
      views: ["front"], evidence_targets: ["width"],
    }],
  });
  const decision = registry.planGeometryCorrection(handle, [{
    id: "body-resize",
    predicted_error: 0.1, mutation_cost: 0.1, risk: 0.1,
    patch: {
      target_discrepancy_codes: ["BODY_SIZE"],
      correction_family: "RESIZE",
      intent: {
        target: { semantic_group: "body" },
        operation: {
          kind: "RESIZE_AXIS", axis: "X",
          mode: "MULTIPLY", value: 1.05, anchor: "MIN",
        },
      },
    },
  }]);
  expect(decision.state).toBe("CORRECTION_READY");
  // This synthetic receipt represents the prior native edit; the pure
  // landmark tests start from a committed correction, not a raw plan.
  const rebuild = decision.rebuild!;
  const receipt: AuthoringRecipeApplyReceipt = {
    schema: 1, execution: "applied", recipe_id: decision.next_recipe!.id,
    previous_recipe_fingerprint: rebuild.previous_recipe_fingerprint,
    next_recipe_fingerprint: rebuild.next_recipe_fingerprint,
    native_source_fingerprint_before: "sha256:" + "1".repeat(64),
    native_source_fingerprint_after: "sha256:" + "2".repeat(64),
    native_undo_provenance: {
      token: "synthetic-landmark-undo",
      project_uuid: "bedrock-project-1", undo_index: 1,
    },
    created_instance_ids: rebuild.reasons
      .filter((row) => row.reason === "ADDED").map((row) => row.instance_id),
    updated_instance_ids: rebuild.reasons
      .filter((row) => row.reason === "CHANGED").map((row) => row.instance_id),
    removed_instance_ids: [...rebuild.remove_instance_ids],
    preserved_instance_ids: [...rebuild.preserved_instance_ids],
    metadata_only_instance_ids: [...rebuild.metadata_only_instance_ids],
    symmetry_changed_relation_ids: [...rebuild.symmetry_changed_relation_ids],
    affected_count: rebuild.metrics.native_affected_count,
    recipe_affected_count: rebuild.metrics.affected_count,
    invalidates: {
      geometry_structure: true, uv_mapping: true,
      texture_appearance: true, animation_motion: true,
    },
  };
  registry.acknowledgeAppliedGeometryCorrection(handle, receipt);
  return { registry, handle };
}

describe("landmark measurement guarding existing correction convergence", () => {
  test("regression cannot advance the correction or consume pending review evidence", () => {
    const { registry, handle } = startWithPendingCorrection();
    const previous = registry.projectContinuation(handle);
    const before = capture("verificationevidence:landmark-before", 0.6);
    const after = capture("verificationevidence:landmark-after", 0.7);
    expect(() => registry.updateEvidence(
      handle, "verificationevidence:landmark-after",
      [{ code: "BODY_SIZE", severity: "INFO", summary: "Appears improved." }],
      { recovered_views: ["front"], landmark_check: { before, after } }
    )).toThrow("LANDMARK_CORRECTION_REGRESSED");
    expect(registry.projectContinuation(handle).continuation_id)
      .toBe(previous.continuation_id);
    expect(registry.projectContinuation(handle).convergence.state)
      .toBe("PENDING_VERIFICATION");
  });

  test("camera drift and handle spoof are rejected before convergence changes", () => {
    const { registry, handle } = startWithPendingCorrection();
    const before = capture("verificationevidence:landmark-before", 0.6);
    const after = capture("verificationevidence:landmark-after", 0.5);
    expect(() => registry.updateEvidence(handle, "verificationevidence:landmark-after",
      [{ code: "BODY_SIZE", severity: "INFO", summary: "Improved." }],
      { recovered_views: ["front"], landmark_check: {
        before, after: { ...after, cameras: [{
          ...after.cameras[0]!, position: [0, 6, 31],
        }] },
      } }
    )).toThrow("LANDMARK_CAMERA_OR_REFERENCE_MISMATCH");
    expect(() => registry.updateEvidence(handle, "verificationevidence:landmark-after",
      [{ code: "BODY_SIZE", severity: "INFO", summary: "Improved." }],
      { recovered_views: ["left"], landmark_check: { before, after } }
    )).toThrow("LANDMARK_CAPTURE_VIEW_UNVERIFIED");
    expect(() => registry.updateEvidence(handle, "verificationevidence:landmark-after",
      [{ code: "BODY_SIZE", severity: "INFO", summary: "Improved." }],
      { recovered_views: ["front"], landmark_check: {
        before: { ...before, evidence_handle: "verificationevidence:wrong" },
        after,
      } }
    )).toThrow("LANDMARK_CAPTURE_HANDLE_MISMATCH");
    expect(registry.projectContinuation(handle).verification.pending).toBe(true);
  });

  test("an independent severity reduction may proceed when the measured direction improves", () => {
    const { registry, handle } = startWithPendingCorrection();
    const before = capture("verificationevidence:landmark-before", 0.6);
    const after = capture("verificationevidence:landmark-after", 0.5);
    registry.updateEvidence(handle, "verificationevidence:landmark-after",
      [{
        code: "BODY_SIZE", severity: "INFO", summary: "Visible residual is smaller.",
        quality_class: "PRIMARY_FORM", owner: "GEOMETRY",
        cause_family: "SIZE_MISMATCH",
        views: ["front"], evidence_targets: ["width"],
      }],
      { recovered_views: ["front"], landmark_check: { before, after } }
    );
    const continuation = registry.projectContinuation(handle);
    expect(continuation.convergence.state).toBe("IMPROVED");
    expect(continuation.unresolved.map((item) => item.code)).toEqual(["BODY_SIZE"]);
  });

  test("unchanged numeric evidence cannot clear a vanished discrepancy", () => {
    const { registry, handle } = startWithPendingCorrection();
    const before = capture("verificationevidence:landmark-before", 0.6);
    const after = capture("verificationevidence:landmark-after", 0.6);
    expect(() => registry.updateEvidence(handle, "verificationevidence:landmark-after",
      [],
      {
        recovered_views: ["front"], cleared_target_codes: ["BODY_SIZE"],
        landmark_check: { before, after },
      }
    )).toThrow("LANDMARK_CLEARANCE_UNSUPPORTED");
    expect(registry.projectContinuation(handle).unresolved_count).toBe(1);
  });
});
