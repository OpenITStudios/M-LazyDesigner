import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { reviewDeclaredRecipeAssembly } from "@/lib/authoringRecipe/geometryAssembly";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { createAuthoringRecipeService } from "@/lib/authoringRecipe/service";
import { reviewRecipeKnowledge } from "@/lib/authoringRecipe/knowledgePlanning";
import { readBundledRecipeKnowledgeIndex } from "@/server/runtime/recipes/authoring/knowledgeRuntime";

function assemblyRecipe(): AuthoringRecipe {
  return {
    schema: 1, compiler_version: 1,
    id: "r2-assembly", name: "R2 hinged panels",
    prototypes: [
      { id: "frame-shape", name: "frame", size: [4, 4, 2] },
      { id: "panel-shape", name: "panel", size: [2, 4, 1] },
    ],
    patterns: [
      {
        kind: "LINEAR", id: "frame", prototype_id: "frame-shape",
        feature_id: "frame-feature", count: 1, axis: "X", spacing: 0,
        semantic_group: "frame-group",
      },
      {
        kind: "LINEAR", id: "panel", prototype_id: "panel-shape",
        feature_id: "hinge-feature", count: 1, axis: "X", spacing: 0,
        semantic_group: "panel-group",
      },
    ],
    feature_intents: [
      {
        id: "frame-feature", label: "primary silhouette mass",
        visual_role: "THREE_DIMENSIONAL", evidence: "SUPPORTED",
        evidence_refs: ["reference:frame-front"],
        geometry_reasons: ["SILHOUETTE", "CONTACT"],
      },
      {
        id: "hinge-feature", label: "joint pivot bone parenting",
        visual_role: "THREE_DIMENSIONAL", evidence: "SUPPORTED",
        evidence_refs: ["reference:hinge-side"],
        geometry_reasons: ["MOTION", "CONTACT"],
      },
    ],
    constraints: [{
      kind: "ANCHOR", id: "panel-attachment",
      source_instance_id: "panel:0",
      target_instance_id: "frame:0",
      axes: ["X"],
      source_anchor: ["MIN", "CENTER", "CENTER"],
      target_anchor: ["MAX", "CENTER", "CENTER"],
    }],
    symmetry: [{
      id: "paired-panel",
      source_instance_id: "panel:0",
      target_instance_id: "panel:right",
      plane: { axis: "X", position: 0 },
      uv_policy: "UNIQUE", texture_policy: "MIRROR",
      rig_policy: "INDEPENDENT",
    }],
  };
}

describe("R2 explicit semantic assembly inside existing Recipe", () => {
  test("traces anchor and symmetry to exact feature/instance IDs, not display names", () => {
    const recipe = assemblyRecipe();
    const original = structuredClone(recipe);
    const output = reviewDeclaredRecipeAssembly(recipe, [
      "hinge-feature", "frame-feature",
    ]);
    const hinge = output[0]!;
    const frame = output[1]!;
    expect(hinge).toMatchObject({
      feature_id: "hinge-feature",
      scope: "DECLARED_RECIPE_RELATIONS_ONLY",
      state: "DECLARED_RELATIONS_UNVERIFIED",
      relation_count: 2,
      relation_examples_truncated: false,
      semantic_group_labels: ["panel-group"],
      native_parent_verified: false,
      native_mutation_executed: false,
    });
    expect(hinge.relation_examples).toEqual([
      {
        kind: "ANCHOR", id: "panel-attachment",
        source_instance_id: "panel:0", target_instance_id: "frame:0",
        source_feature_id: "hinge-feature",
        target_feature_id: "frame-feature",
        anchor_axes: ["X"],
        evidence: "RECIPE_DECLARATION_ONLY_NOT_VISUAL_OR_NATIVE_PROOF",
      },
      {
        kind: "SYMMETRY", id: "paired-panel",
        source_instance_id: "panel:0", target_instance_id: "panel:right",
        source_feature_id: "hinge-feature",
        target_feature_id: "hinge-feature",
        symmetry_policies: {
          uv: "UNIQUE", texture: "MIRROR", rig: "INDEPENDENT",
        },
        evidence: "RECIPE_DECLARATION_ONLY_NOT_VISUAL_OR_NATIVE_PROOF",
      },
    ]);
    expect(frame.relation_count).toBe(1);
    expect(frame.relation_examples[0]?.kind).toBe("ANCHOR");
    expect(frame.semantic_group_labels).toEqual(["frame-group"]);
    expect(hinge.reference_checks.some(x =>
      x.includes("does not create") || x.includes("positional only")
    )).toBe(true);
    expect(recipe).toEqual(original);
  });

  test("motion-ready group label never certifies bone parenting or invents mirror/anchor", () => {
    const recipe = assemblyRecipe();
    recipe.constraints = [];
    recipe.symmetry = [];
    const output = reviewDeclaredRecipeAssembly(recipe, ["hinge-feature"])[0]!;
    expect(output).toMatchObject({
      state: "NO_DECLARED_RELATIONS",
      relation_count: 0,
      semantic_group_labels: ["panel-group"],
      native_parent_verified: false,
      native_mutation_executed: false,
    });
    const knowledge = reviewRecipeKnowledge(recipe, readBundledRecipeKnowledgeIndex()!, {
      feature_ids: ["hinge-feature"],
    });
    expect(knowledge.geometry_proposals).toHaveLength(1);
    expect(knowledge.geometry_proposals[0]?.options[0]?.strategy)
      .toBe("G-P05 Joint Pivot And Bone Parenting");
    expect(knowledge.geometry_proposals[0]?.assembly).toMatchObject({
      state: "NO_DECLARED_RELATIONS",
      native_parent_verified: false,
    });
    expect(knowledge.geometry_proposals[0]?.mutation_authorized).toBe(false);
    expect(recipe.symmetry).toEqual([]);
    expect(recipe.constraints).toEqual([]);
  });

  test("bad endpoints, delayed symmetry and unverified references fail closed for affected feature", () => {
    const input = assemblyRecipe();
    input.constraints![0]!.source_instance_id = "panel:right"; // emitted after ANCHOR solver
    const review = reviewDeclaredRecipeAssembly(input, [
      "frame-feature", "hinge-feature",
    ]);
    expect(review[0]).toMatchObject({
      state: "SOURCE_IDENTITY_REVIEW_REQUIRED",
      source_identity_issues: ["ANCHOR_ENDPOINT_IDENTITY_UNVERIFIED"],
    });
    expect(review[1]?.source_identity_issues).toEqual([]);

    const missingPeer = assemblyRecipe();
    missingPeer.constraints![0]!.target_instance_id = "unknown:42";
    const missing = reviewDeclaredRecipeAssembly(missingPeer, [
      "hinge-feature", "frame-feature",
    ]);
    expect(missing[0]?.source_identity_issues).toContain(
      "ANCHOR_ENDPOINT_IDENTITY_UNVERIFIED"
    );
    expect(missing[1]?.source_identity_issues).toEqual([]);

    const unverified = assemblyRecipe();
    unverified.feature_intents![1]!.evidence = "PROVISIONAL";
    const uncertain = reviewDeclaredRecipeAssembly(unverified, ["hinge-feature"])[0]!;
    expect(uncertain.state).toBe("SOURCE_IDENTITY_REVIEW_REQUIRED");
    expect(uncertain.source_identity_issues).toContain(
      "FEATURE_REFERENCE_EVIDENCE_UNVERIFIED"
    );
    const invalid = assemblyRecipe();
    invalid.patterns.push({ ...invalid.patterns[0]! });
    expect(reviewDeclaredRecipeAssembly(invalid, ["hinge-feature"])[0]?.state)
      .toBe("SOURCE_IDENTITY_REVIEW_REQUIRED");
  });

  test("large relation inventories remain bounded without blocking native compilation paths", () => {
    const recipe = assemblyRecipe();
    recipe.constraints = Array.from({ length: 129 }, (_, i) => ({
      ...recipe.constraints![0]!, id: "anchor:" + i,
    }));
    const scope = reviewDeclaredRecipeAssembly(recipe, ["hinge-feature"])[0]!;
    expect(scope).toMatchObject({
      state: "SOURCE_IDENTITY_REVIEW_REQUIRED",
      relation_examples: [],
      source_identity_issues: ["REVIEW_RELATION_BUDGET_EXCEEDED"],
      native_mutation_executed: false,
    });
    expect(() => reviewDeclaredRecipeAssembly(recipe,
      ["hinge-feature", "hinge-feature"])).toThrow("RECIPE_ASSEMBLY_FEATURE_SCOPE_INVALID");
    expect(() => reviewDeclaredRecipeAssembly(recipe,
      ["unknown-feature"])).toThrow("RECIPE_ASSEMBLY_FEATURE_UNKNOWN");
  });

  test("actual plan/planStored caller exposes R2 evidence before compilation without native Undo", async () => {
    const next = assemblyRecipe();
    const previous = structuredClone(next);
    previous.constraints = [];
    previous.symmetry = [];
    const state = compileAuthoringRecipe(previous);
    const native = {
      schema: 1 as const, recipe_id: previous.id,
      cubes: state.placements.map((item, i) => ({
        uuid: "native:" + i, recipe_id: previous.id, instance_id: item.id,
        name: item.name, from: item.from, to: item.to,
        origin: item.origin, rotation: item.rotation, inflate: item.inflate,
      })),
    };
    const original = structuredClone(next);
    let reads = 0;
    const service = createAuthoringRecipeService({
      readOwned: () => native,
      readStoredRecipe: () => previous,
      readKnowledgeIndex: () => {
        reads += 1;
        return readBundledRecipeKnowledgeIndex();
      },
      createApplyAdapter: () => {
        throw new Error("R2_ASSEMBLY_MUST_NOT_MUTATE");
      },
    });
    const plan = await service.planStored(next);
    const hinge = plan.recipe_knowledge?.geometry_proposals.find(p =>
      p.feature_id === "hinge-feature"
    );
    expect(reads).toBe(1);
    expect(hinge?.assembly).toMatchObject({
      state: "DECLARED_RELATIONS_UNVERIFIED",
      relation_count: 2,
      native_parent_verified: false,
      native_mutation_executed: false,
    });
    expect(hinge?.mutation_authorized).toBe(false);
    expect(plan.summary).toBeDefined();
    expect(next).toEqual(original);
  });
});
