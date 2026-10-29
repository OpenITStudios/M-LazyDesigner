import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { reviewRecipeGeometryFidelity } from "@/lib/authoringRecipe/geometryFidelity";
import { createAuthoringRecipeService } from "@/lib/authoringRecipe/service";
import type { AuthoringRecipeNativeSnapshot } from "@/lib/authoringRecipe/nativeState";

function joinedRecipe(): AuthoringRecipe {
  return {
    schema: 1, compiler_version: 1, id: "r4-prop",
    name: "Static rectangular pieces",
    prototypes: [
      { id: "left-cube", name: "left", size: [2, 2, 2], origin: [0, 0, 0] },
      { id: "right-cube", name: "right", size: [2, 2, 2], origin: [-2, 0, 0] },
    ],
    patterns: [
      { kind: "LINEAR", id: "left", prototype_id: "left-cube", feature_id: "shape",
        count: 1, axis: "X", spacing: 0 },
      { kind: "LINEAR", id: "right", prototype_id: "right-cube", feature_id: "shape",
        count: 1, axis: "X", spacing: 0, start: [2, 0, 0] },
    ],
    feature_intents: [{
      id: "shape", label: "primary silhouette mass",
      visual_role: "THREE_DIMENSIONAL", evidence: "SUPPORTED",
      evidence_refs: ["reference:front", "reference:side"],
      geometry_reasons: ["SILHOUETTE"],
    }],
  };
}
function nativeOf(recipe: AuthoringRecipe): AuthoringRecipeNativeSnapshot {
  const compiled = compileAuthoringRecipe(recipe);
  return {
    schema: 1, recipe_id: recipe.id,
    cubes: compiled.placements.map((cube, i) => ({
      uuid: "native:" + i, recipe_id: recipe.id,
      instance_id: cube.id, name: cube.name,
      from: [...cube.from], to: [...cube.to],
      origin: [...cube.origin], rotation: [...cube.rotation],
      inflate: cube.inflate,
      // The exact native adapter supplies these, including empty root paths.
      parent_path: [], parent_authored_state: [],
    })),
  };
}
function findingKinds(result: ReturnType<typeof reviewRecipeGeometryFidelity>) {
  return result.findings.map(finding => finding.kind);
}

describe("R4 fidelity-preserving Geometry optimization via existing source diagnostics", () => {
  test("face-adjacent rectangular pieces receive merge REVIEW only, never automatic deletion", () => {
    const recipe = joinedRecipe();
    const native = nativeOf(recipe);
    const originalRecipe = structuredClone(recipe);
    const originalNative = structuredClone(native);
    const report = reviewRecipeGeometryFidelity(recipe, native, "shape");
    expect(report).toMatchObject({
      feature_id: "shape", state: "REVIEW_CANDIDATES",
      checked_instance_count: 2, total_feature_instances: 2,
      diagnostics: { merge_candidate_count: 1, complete: false },
      quality_verdict: "UNVERIFIED", safe_to_merge_or_delete: false,
      native_mutation_executed: false, visual_verdict: "NOT_EVALUATED",
    });
    const merge = report.findings.find(
      finding => finding.kind === "FACE_ADJACENT_MERGE"
    );
    expect(merge).toMatchObject({
      recipe_instance_ids: ["left:0", "right:0"],
      status: "REFERENCE_AND_NATIVE_REVIEW_REQUIRED",
      source_scope: "SAME_PARENT_STATIC_GEOMETRY_ONLY",
    });
    expect(merge?.required_checks).toContain(
      "Mapped UV, material, alpha and visibility variants"
    );
    expect(report.native_source_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.values(report.quality_dimensions)).toEqual(
      Array(7).fill("UNVERIFIED")
    );
    expect(recipe).toEqual(originalRecipe);
    expect(native).toEqual(originalNative);
  });

  test("a feature crossing a different part owner is RETAIN, not an inferred same-part merge", () => {
    const recipe = joinedRecipe();
    recipe.patterns[1]!.feature_id = "other-feature";
    recipe.feature_intents!.push({
      id: "other-feature", label: "distinct attached part",
      visual_role: "THREE_DIMENSIONAL", evidence: "SUPPORTED",
      evidence_refs: ["reference:front"], geometry_reasons: ["CONTACT"],
    });
    const report = reviewRecipeGeometryFidelity(recipe, nativeOf(recipe), "shape");
    const merge = report.findings.find(
      finding => finding.kind === "FACE_ADJACENT_MERGE"
    );
    expect(merge?.status).toBe("RETAIN_DECLARED_RELATION");
    expect(merge?.required_checks).toContain(
      "Different semantic feature owner: do not merge"
    );
    expect(report.safe_to_merge_or_delete).toBe(false);
  });

  test("ANCHOR and motion semantics protect apparently redundant shapes", () => {
    const recipe = joinedRecipe();
    recipe.constraints = [{
      kind: "ANCHOR", id: "join", source_instance_id: "right:0",
      target_instance_id: "left:0", axes: ["X"],
      source_anchor: ["MIN", "MIN", "MIN"],
      target_anchor: ["MAX", "MIN", "MIN"],
    }];
    recipe.feature_intents![0]!.geometry_reasons = ["SILHOUETTE", "MOTION"];
    const review = reviewRecipeGeometryFidelity(recipe, nativeOf(recipe), "shape");
    expect(review.findings.some(item =>
      item.status === "RETAIN_DECLARED_RELATION"
    )).toBe(true);
    expect(review.findings.some(item =>
      item.required_checks.some(check => check.includes("ANCHOR/SYMMETRY"))
    )).toBe(true);
    expect(review.safe_to_merge_or_delete).toBe(false);
    expect(review.quality_verdict).toBe("UNVERIFIED");
  });

  test("a strictly enclosed Cube remains a containment REVIEW, never deletion proof", () => {
    const recipe = joinedRecipe();
    recipe.prototypes[0] = {
      id: "left-cube", name: "outer", size: [8, 8, 8], origin: [0, 0, 0],
    };
    recipe.prototypes[1] = {
      id: "right-cube", name: "inner", size: [2, 2, 2], origin: [0, 0, 0],
    };
    const innerPattern = recipe.patterns[1];
    if (!innerPattern || innerPattern.kind !== "LINEAR") {
      throw new Error("Invalid R4 containment fixture.");
    }
    innerPattern.start = [3, 3, 3];
    const report = reviewRecipeGeometryFidelity(recipe, nativeOf(recipe), "shape");
    expect(report.diagnostics.contained_candidate_count).toBeGreaterThanOrEqual(1);
    expect(findingKinds(report)).toContain("STRICT_REST_CONTAINMENT");
    expect(report.findings.find(item =>
      item.kind === "STRICT_REST_CONTAINMENT"
    )?.status).toBe("REFERENCE_AND_NATIVE_REVIEW_REQUIRED");
    expect(report.safe_to_merge_or_delete).toBe(false);
  });

  test("unverified native parenting, uncertain reference or geometric rotations fail closed", () => {
    const recipe = joinedRecipe();
    const native = nativeOf(recipe);
    delete native.cubes[0]!.parent_path;
    expect(reviewRecipeGeometryFidelity(recipe, native, "shape"))
      .toMatchObject({
        state: "SOURCE_EVIDENCE_INCOMPLETE",
        blockers: ["NATIVE_PARENT_OWNERSHIP_UNAVAILABLE"],
        findings: [], safe_to_merge_or_delete: false,
      });
    const provisional = joinedRecipe();
    provisional.feature_intents![0]!.evidence = "PROVISIONAL";
    expect(reviewRecipeGeometryFidelity(provisional, nativeOf(provisional), "shape"))
      .toMatchObject({
        state: "SOURCE_EVIDENCE_INCOMPLETE",
        blockers: ["FEATURE_REFERENCE_REVIEW_REQUIRED"],
        findings: [],
      });
    const rotated = joinedRecipe();
    rotated.prototypes[1]!.rotation = [0, 25, 0];
    const partial = reviewRecipeGeometryFidelity(rotated, nativeOf(rotated), "shape");
    expect(partial.state).toBe("SOURCE_EVIDENCE_INCOMPLETE");
    expect(partial.blockers).toContain("PROJECTION_SOURCE_PARTIAL");
    expect(partial.safe_to_merge_or_delete).toBe(false);
    expect(reviewRecipeGeometryFidelity(recipe, nativeOf(recipe), "unknown"))
      .toMatchObject({
        state: "SOURCE_EVIDENCE_INCOMPLETE",
        blockers: ["FEATURE_IDENTITY_UNAVAILABLE"],
      });
  });

  test("registered opt-in Recipe inspection reports findings without invoking native Apply", async () => {
    const recipe = joinedRecipe();
    const native = nativeOf(recipe);
    let readCount = 0;
    let changed = false;
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => { readCount++; return native; },
      createApplyAdapter: () => {
        changed = true;
        throw new Error("R4_REVIEW_MUST_NOT_MUTATE");
      },
    });
    const inspected = await service.inspectStoredGeometryCoincidence({
      recipe_id: recipe.id, selected_instance_id: "left:0",
    });
    expect(inspected.geometry_fidelity_review).toMatchObject({
      feature_id: "shape",
      state: "REVIEW_CANDIDATES",
      quality_verdict: "UNVERIFIED",
      safe_to_merge_or_delete: false,
      native_mutation_executed: false,
      diagnostics: { merge_candidate_count: 1 },
    });
    expect(inspected.geometry_fidelity_review?.findings[0]).toBeDefined();
    expect(readCount).toBeGreaterThanOrEqual(2);
    expect(changed).toBe(false);
    const whole = await service.inspectStoredGeometryCoincidence({
      recipe_id: recipe.id,
    });
    expect(whole).not.toHaveProperty("geometry_fidelity_review");
    expect(changed).toBe(false);
  });
});
