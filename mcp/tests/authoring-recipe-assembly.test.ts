import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { reviewDeclaredRecipeAssembly } from "@/lib/authoringRecipe/geometryAssembly";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { createAuthoringRecipeService } from "@/lib/authoringRecipe/service";
import { reviewRecipeKnowledge } from "@/lib/authoringRecipe/knowledgePlanning";
import type { AdvancedGeometryFeature } from "@/lib/authoringRecipe/geometrySchema";
import {
  buildAdvancedGeometryRecipeCandidate,
  reviewStoredAdvancedGeometrySource,
} from "@/lib/authoringRecipe/geometryComposition";
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


  test("anchor dependency cycles are flagged before canonical compiler rejects them", () => {
    const recipe = assemblyRecipe();
    recipe.symmetry = [];
    recipe.constraints!.push({
      ...recipe.constraints![0]!,
      id: "reverse-attachment",
      source_instance_id: "frame:0",
      target_instance_id: "panel:0",
    });
    const review = reviewDeclaredRecipeAssembly(recipe, ["frame-feature", "hinge-feature"]);
    for (const feature of review) {
      expect(feature.state).toBe("SOURCE_IDENTITY_REVIEW_REQUIRED");
      expect(feature.source_identity_issues).toContain("ANCHOR_DEPENDENCY_CYCLE");
      expect(feature.native_mutation_executed).toBe(false);
    }
    expect(() => compileAuthoringRecipe(recipe)).toThrow(/cycle detected/i);
  });

  test("self-anchor is rejected in review without mislabelling native bone hierarchy", () => {
    const recipe = assemblyRecipe();
    recipe.constraints![0]!.target_instance_id = "panel:0";
    const review = reviewDeclaredRecipeAssembly(recipe, ["hinge-feature", "frame-feature"]);
    expect(review[0]?.source_identity_issues).toContain("ANCHOR_DEPENDENCY_CYCLE");
    expect(review[1]?.source_identity_issues).not.toContain("ANCHOR_DEPENDENCY_CYCLE");
    expect(() => compileAuthoringRecipe(recipe)).toThrow(/cannot target the same instance/i);
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

describe("Structure-first initial Recipe batch using declared form reasons", () => {
  const blank = (): AuthoringRecipe => ({
    schema: 1, compiler_version: 1, id: "shape-first-batch",
    name: "Editable modular prop", prototypes: [], patterns: [],
  });
  const detail: AdvancedGeometryFeature = {
    kind: "cuboid", id: "a-detail", label: "raised side trim",
    evidence_refs: ["reference:side"], geometry_reasons: ["LAYERING"],
    from: [8, 0, 0], to: [9, 2, 1],
  };
  const body: AdvancedGeometryFeature = {
    kind: "cuboid", id: "z-body", label: "principal body mass",
    evidence_refs: ["reference:front"], geometry_reasons: ["SILHOUETTE", "VOLUME"],
    from: [0, 0, 0], to: [4, 4, 4],
  };

  test("new blank batch builds principal form first without deleting or reshaping detail", () => {
    const seed = blank();
    const original = structuredClone(seed);
    const features = [detail, body];
    const unchanged = structuredClone(features);
    const planned = buildAdvancedGeometryRecipeCandidate(seed, features);
    expect(planned.next_recipe.patterns.map(pattern => pattern.feature_id))
      .toEqual(["z-body", "a-detail"]);
    expect(planned.summary.shape_families.map(row => row.feature_id))
      .toEqual(["z-body", "a-detail"]);
    expect(planned.next_recipe.advanced_geometry_source?.map(feature => feature.id))
      .toEqual(["a-detail", "z-body"]);
    expect(compileAuthoringRecipe(planned.next_recipe).placements).toHaveLength(2);
    expect(reviewStoredAdvancedGeometrySource(planned.next_recipe).state)
      .toBe("AVAILABLE_MATCHED_SOURCE");
    expect(planned.summary.native_mutation_executed).toBe(false);
    expect(planned.summary.visual_verdict).toBe("NOT_EVALUATED");
    expect(seed).toEqual(original);
    expect(features).toEqual(unchanged);
  });

  test("initial primary-first batch compiles after later dependent anchor endpoints exist", () => {
    const seed = blank();
    seed.constraints = [{
      kind: "ANCHOR", id: "detail-attaches-to-body",
      source_instance_id: "shape:cuboid:a-detail:0",
      target_instance_id: "shape:cuboid:z-body:0",
      axes: ["X"],
      source_anchor: ["MIN", "CENTER", "CENTER"],
      target_anchor: ["MAX", "CENTER", "CENTER"],
    }];
    const original = structuredClone(seed);
    const planned = buildAdvancedGeometryRecipeCandidate(seed, [detail, body]);
    expect(planned.next_recipe.patterns.map(pattern => pattern.feature_id))
      .toEqual(["z-body", "a-detail"]);
    expect(planned.summary.shape_families.map(row => row.native_cube_candidates))
      .toEqual([1, 1]);
    expect(compileAuthoringRecipe(planned.next_recipe).placements).toHaveLength(2);
    expect(planned.summary.native_mutation_executed).toBe(false);
    expect(seed).toEqual(original);
  });

  test("persisted source remains matched after source-owned anchor placement", () => {
    const seed = blank();
    seed.constraints = [{
      kind: "ANCHOR", id: "detail-attaches-to-body",
      source_instance_id: "shape:cuboid:a-detail:0",
      target_instance_id: "shape:cuboid:z-body:0",
      axes: ["X"],
      source_anchor: ["MIN", "CENTER", "CENTER"],
      target_anchor: ["MAX", "CENTER", "CENTER"],
    }];
    const planned = buildAdvancedGeometryRecipeCandidate(seed, [detail, body]);
    expect(reviewStoredAdvancedGeometrySource(planned.next_recipe).state)
      .toBe("AVAILABLE_MATCHED_SOURCE");
    const tampered = structuredClone(planned.next_recipe);
    tampered.constraints![0]!.target_instance_id = "external:0";
    expect(reviewStoredAdvancedGeometrySource(tampered).state)
      .toBe("SOURCE_RECIPE_MISMATCH");
  });

  test("source-owned chained symmetry remains verifiable in compiler dependency order", () => {
    const seed = blank();
    seed.symmetry = [
      {
        id: "mirror-primary",
        source_instance_id: "shape:cuboid:z-body:0",
        target_instance_id: "body:mirror-1",
        plane: { axis: "X", position: 8 },
        uv_policy: "UNIQUE", texture_policy: "MIRROR", rig_policy: "INDEPENDENT",
      },
      {
        id: "mirror-secondary",
        source_instance_id: "body:mirror-1",
        target_instance_id: "body:mirror-2",
        plane: { axis: "X", position: 16 },
        uv_policy: "UNIQUE", texture_policy: "MIRROR", rig_policy: "INDEPENDENT",
      },
    ];
    const planned = buildAdvancedGeometryRecipeCandidate(seed, [body]);
    expect(compileAuthoringRecipe(planned.next_recipe).placements).toHaveLength(3);
    expect(reviewStoredAdvancedGeometrySource(planned.next_recipe).state)
      .toBe("AVAILABLE_MATCHED_SOURCE");
    const broken = structuredClone(planned.next_recipe);
    broken.symmetry!.reverse();
    expect(reviewStoredAdvancedGeometrySource(broken).state)
      .toBe("SOURCE_RECIPE_MISMATCH");
  });

  test("unresolvable initial batch anchor still fails at canonical final compilation", () => {
    const seed = blank();
    seed.constraints = [{
      kind: "ANCHOR", id: "missing-support",
      source_instance_id: "shape:cuboid:a-detail:0",
      target_instance_id: "absent:0",
      axes: ["X"],
      source_anchor: ["MIN", "CENTER", "CENTER"],
      target_anchor: ["MAX", "CENTER", "CENTER"],
    }];
    expect(() => buildAdvancedGeometryRecipeCandidate(seed, [detail, body]))
      .toThrow(/missing target instance/i);
  });

  test("existing Recipe revisions keep their supplied feature order", () => {
    const seed = blank();
    seed.prototypes.push({ id: "owned-cube", name: "existing", size: [2, 2, 2] });
    seed.patterns.push({
      kind: "LINEAR", id: "owned-pattern", prototype_id: "owned-cube",
      feature_id: "owned", count: 1, axis: "Z", spacing: 0,
      start: [12, 0, 0],
    });
    seed.feature_intents = [{
      id: "owned", label: "existing structure", visual_role: "THREE_DIMENSIONAL",
      evidence: "SUPPORTED", evidence_refs: ["reference:rear"],
      geometry_reasons: ["VOLUME"],
    }];
    const untouched = structuredClone(seed);
    const planned = buildAdvancedGeometryRecipeCandidate(seed, [detail, body]);
    expect(planned.next_recipe.patterns.map(pattern => pattern.feature_id))
      .toEqual(["owned", "a-detail", "z-body"]);
    expect(compileAuthoringRecipe(planned.next_recipe).placements).toHaveLength(3);
    expect(seed).toEqual(untouched);
    expect(planned.summary.native_mutation_executed).toBe(false);
  });

  test("no declared form reason does not invent a primary Cube priority", () => {
    const unlabeled: AdvancedGeometryFeature = {
      ...body, geometry_reasons: undefined,
    };
    const planned = buildAdvancedGeometryRecipeCandidate(blank(), [detail, unlabeled]);
    expect(planned.next_recipe.patterns.map(pattern => pattern.feature_id))
      .toEqual(["a-detail", "z-body"]);
    expect(planned.summary.visual_verdict).toBe("NOT_EVALUATED");
  });
});
