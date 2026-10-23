import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { planIncrementalRecipeRebuild } from "@/lib/authoringRecipe/incremental";
import { composeAuthoringComponents, type RecipeComponentDefinition } from "@/lib/authoringRecipe/components";

describe("Parametric Authoring G5 compiled-diff incremental rebuild", () => {
  test("isolated pattern change mutates only the affected instances", () => {
    const previous: AuthoringRecipe = {
      schema: 1, compiler_version: 1, id: "shelf", name: "Shelf",
      prototypes: [
        { id: "board", name: "board", size: [10,1,3] },
        { id: "post", name: "post", size: [1,20,1] },
      ],
      patterns: [
        { kind: "LINEAR", id: "boards", prototype_id: "board", count: 10, axis: "Y", spacing: 2 },
        { kind: "LINEAR", id: "posts", prototype_id: "post", count: 2, axis: "X", spacing: 9 },
      ],
    };
    const next = structuredClone(previous);
    const boards = next.patterns.find((pattern) => pattern.id === "boards")!;
    if (boards.kind !== "LINEAR") throw new Error("fixture");
    boards.spacing = 2.5;
    const plan = planIncrementalRecipeRebuild(previous, next);
    expect(plan.metrics.previous_cube_count).toBe(12);
    expect(plan.metrics.next_cube_count).toBe(12);
    expect(plan.metrics.upsert_count).toBe(9);
    expect(plan.metrics.remove_count).toBe(0);
    expect(plan.preserved_instance_ids).toContain("posts:0");
    expect(plan.preserved_instance_ids).toContain("posts:1");
    expect(plan.preserved_instance_ids).toContain("boards:0");
  });

  test("incremental authoring cannot silently delete an existing Cube when switching to Texture", () => {
    const previous: AuthoringRecipe = {
      schema: 1, compiler_version: 1, id: "horn", name: "Horn",
      prototypes: [{ id: "horn_proto", name: "horn", size: [2, 4, 2] }],
      feature_intents: [{ id: "horn", label: "horn", visual_role: "THREE_DIMENSIONAL",
        evidence: "SUPPORTED", evidence_refs: ["fixture:approved_reference_view"], geometry_reasons: ["SILHOUETTE"] }],
      patterns: [{ kind: "LINEAR", id: "horns", prototype_id: "horn_proto",
        feature_id: "horn", count: 1, axis: "X", spacing: 0 }],
    };
    const next = structuredClone(previous);
    next.patterns = [];
    next.feature_intents![0] = {
      ...next.feature_intents![0],
      visual_role: "SURFACE_DETAIL",
      geometry_reasons: [],
    };
    expect(() => planIncrementalRecipeRebuild(previous, next))
      .toThrow("RECIPE_REPRESENTATION_HANDOFF_REQUIRED");
    const downgrade = structuredClone(previous);
    delete downgrade.feature_intents;
    expect(() => planIncrementalRecipeRebuild(previous, downgrade))
      .toThrow("FEATURE_PLAN_DOWNGRADE_REFUSED");
  });

  test("component-local parameter change preserves unrelated component output", () => {
    const wheel: RecipeComponentDefinition = {
      id: "wheel", name: "Wheel",
      recipe: { schema: 1, compiler_version: 1, id: "component:wheel", name: "Wheel", prototypes: [{ id: "spoke", name: "spoke", size: [1,1,4] }], patterns: [{ kind: "RADIAL", id: "spokes", prototype_id: "spoke", count: 8, axis: "Z", radius: 4 }] },
    };
    const previous = composeAuthoringComponents(
      { schema: 1, compiler_version: 1, id: "vehicle", name: "Vehicle" }, [wheel],
      [{ id: "left", component_id: "wheel", translation: [-6,0,0] }, { id: "right", component_id: "wheel", translation: [6,0,0] }]
    );
    const next = composeAuthoringComponents(
      { schema: 1, compiler_version: 1, id: "vehicle", name: "Vehicle" }, [wheel],
      [{ id: "left", component_id: "wheel", translation: [-6,0,0], pattern_overrides: [{ pattern_id: "spokes", radius: 5 }] }, { id: "right", component_id: "wheel", translation: [6,0,0] }]
    );
    const plan = planIncrementalRecipeRebuild(previous, next);
    expect(plan.metrics.next_cube_count).toBe(16);
    expect(plan.metrics.upsert_count).toBe(8);
    expect(plan.metrics.affected_ratio_of_next).toBe(0.5);
    expect(plan.preserved_instance_ids.every((id) => id.startsWith("right/"))).toBe(true);
  });

  test("constraint propagation is reflected without maintaining a second dependency database", () => {
    const previous: AuthoringRecipe = {
      schema: 1, compiler_version: 1, id: "cabinet", name: "Cabinet",
      prototypes: [{ id: "body", name: "body", size: [10,10,10] }, { id: "handle", name: "handle", size: [2,4,2] }],
      patterns: [{ kind: "LINEAR", id: "body", prototype_id: "body", count: 1, axis: "X", spacing: 0 }, { kind: "LINEAR", id: "handle", prototype_id: "handle", count: 1, axis: "X", spacing: 0 }],
      constraints: [{ kind: "ANCHOR", id: "attach", source_instance_id: "handle:0", target_instance_id: "body:0", axes: ["X"], source_anchor: ["MIN","CENTER","CENTER"], target_anchor: ["MAX","CENTER","CENTER"] }],
    };
    const next = structuredClone(previous);
    next.prototypes[0].size = [12,10,10];
    const plan = planIncrementalRecipeRebuild(previous, next);
    expect(plan.reasons).toEqual([
      { instance_id: "body:0", reason: "CHANGED" },
      { instance_id: "handle:0", reason: "CHANGED" },
    ]);
  });

  test("removed pattern instances produce explicit removals rather than global rebuild", () => {
    const previous: AuthoringRecipe = { schema: 1, compiler_version: 1, id: "line", name: "Line", prototypes: [{ id: "cube", name: "cube", size: [1,1,1] }], patterns: [{ kind: "LINEAR", id: "line", prototype_id: "cube", count: 5, axis: "X", spacing: 2 }] };
    const next = structuredClone(previous);
    const pattern = next.patterns[0];
    if (pattern.kind !== "LINEAR") throw new Error("fixture");
    pattern.count = 3;
    const plan = planIncrementalRecipeRebuild(previous, next);
    expect(plan.remove_instance_ids).toEqual(["line:3","line:4"]);
    expect(plan.metrics.upsert_count).toBe(0);
    expect(plan.preserved_instance_ids).toEqual(["line:0","line:1","line:2"]);
  });

  test("metadata-only placement changes do not become native Cube upserts", () => {
    const previous: AuthoringRecipe = {
      schema: 1,
      compiler_version: 1,
      id: "meta",
      name: "Meta",
      prototypes: [{
        id: "part",
        name: "part",
        size: [2,2,2],
        semantic_group: "LEFT",
      }],
      patterns: [{
        kind: "LINEAR",
        id: "part",
        prototype_id: "part",
        count: 1,
        axis: "X",
        spacing: 0,
      }],
    };
    const next = structuredClone(previous);
    next.prototypes[0].semantic_group = "IDENTITY";
    const plan = planIncrementalRecipeRebuild(previous, next);
    expect(plan.upserts).toEqual([]);
    expect(plan.metadata_only_instance_ids).toEqual(["part:0"]);
    expect(plan.metadata_fields_changed).toEqual([
      { instance_id: "part:0", fields: ["semantic_group"] },
    ]);
    expect(plan.semantic_invalidation).toEqual({
      uv_mapping: true,
      texture_appearance: true,
      animation_motion: true,
    });
    expect(plan.metrics.native_affected_count).toBe(0);
  });

  test("symmetry policy changes invalidate only downstream semantics, not Cube geometry", () => {
    const previous: AuthoringRecipe = {
      schema: 1,
      compiler_version: 1,
      id: "symmetry",
      name: "Symmetry",
      prototypes: [{ id: "arm", name: "arm", size: [2,4,2] }],
      patterns: [{
        kind: "LINEAR",
        id: "left",
        prototype_id: "arm",
        count: 1,
        axis: "X",
        spacing: 0,
        start: [-4,0,0],
      }],
      symmetry: [{
        id: "arms",
        source_instance_id: "left:0",
        target_instance_id: "right:0",
        plane: { axis: "X", position: 0 },
        uv_policy: "SHARE",
        texture_policy: "MIRROR",
        rig_policy: "MIRROR",
      }],
    };
    const next = structuredClone(previous);
    next.symmetry![0].uv_policy = "UNIQUE";
    const plan = planIncrementalRecipeRebuild(previous, next);
    expect(plan.upserts).toEqual([]);
    expect(plan.symmetry_changed_relation_ids).toEqual(["arms"]);
    expect(plan.semantic_invalidation).toEqual({
      uv_mapping: true,
      texture_appearance: true,
      animation_motion: false,
    });
    expect(plan.metrics.native_affected_count).toBe(0);
  });

  test("recipe identity change refuses incremental reconciliation", () => {
    const base: AuthoringRecipe = { schema: 1, compiler_version: 1, id: "a", name: "A", prototypes: [], patterns: [] };
    expect(() => planIncrementalRecipeRebuild(base, { ...base, id: "b" })).toThrow(/stable recipe identity/);
  });
});
