import { describe, expect, test } from "bun:test";
import { deriveAuthoringRecipeUvIslands, expandAffectedUvIds } from "@/lib/uv/authoringRecipeUv";
import type { CompiledAuthoringRecipe } from "@/lib/authoringRecipe/contracts";

function fixture(): CompiledAuthoringRecipe {
  return {
    schema: 1,
    compiler_version: 1,
    recipe_id: "rig",
    placements: [
      { id: "left", name: "left", prototype_id: "arm", from: [-4,0,0], to: [-2,6,2], origin: [-3,3,1], rotation: [0,0,0], inflate: 0, semantic_group: "cloth", source_pattern_id: "p", instance_index: 0 },
      { id: "right", name: "right", prototype_id: "arm", from: [2,0,0], to: [4,6,2], origin: [3,3,1], rotation: [0,0,0], inflate: 0, semantic_group: "cloth", source_pattern_id: "symmetry:s", instance_index: 0 },
    ],
    symmetry_relationships: [
      { id: "s", source_instance_id: "left", target_instance_id: "right", plane: { axis: "X", position: 0 }, uv_policy: "SHARE", texture_policy: "MIRROR", rig_policy: "MIRROR" },
    ],
    metrics: { prototype_count: 1, pattern_count: 1, instance_count: 2, realized_cube_count: 2, unique_geometry_count: 1, repeated_instance_count: 1, symmetry_generated_count: 1 },
  };
}

describe("Authoring Recipe to semantic UV bridge", () => {
  test("maps mirrored face correspondence explicitly", () => {
    const islands = deriveAuthoringRecipeUvIslands(fixture(), { texel_density_by_cohort: { cloth: 2 } });
    const rightEast = islands.find((island) => island.id === "right:east")!;
    const rightNorth = islands.find((island) => island.id === "right:north")!;
    expect(rightEast.share_with).toBe("left:west");
    expect(rightNorth.share_with).toBe("left:north");
    expect(rightEast.texel_density).toBe(2);
  });

  test("symmetry cannot share atlas pixels when texture ownership is UNIQUE", () => {
    const conflicting = fixture();
    conflicting.symmetry_relationships[0] = {
      ...conflicting.symmetry_relationships[0],
      uv_policy: "SHARE",
      texture_policy: "UNIQUE",
    };
    expect(() => deriveAuthoringRecipeUvIslands(conflicting))
      .toThrow("UV SHARE conflicts with UNIQUE texture ownership");
    const safe = fixture();
    safe.symmetry_relationships[0] = {
      ...safe.symmetry_relationships[0],
      uv_policy: "UNIQUE", texture_policy: "UNIQUE",
    };
    const islands = deriveAuthoringRecipeUvIslands(safe);
    expect(islands.find((island) => island.id === "right:north")?.share_with)
      .toBeUndefined();
  });

  test("expands affected scope across shared symmetry", () => {
    const affected = expandAffectedUvIds(fixture(), ["left"]);
    expect(affected).toContain("left:north");
    expect(affected).toContain("right:north");
    expect(affected).toHaveLength(12);
  });
});
