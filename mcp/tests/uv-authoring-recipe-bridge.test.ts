import { describe, expect, test } from "bun:test";
import { deriveAuthoringRecipeUvIslands, expandAffectedUvIds } from "@/lib/uv/authoringRecipeUv";
import type { CompiledAuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipeSemanticUvWorkflow } from "@/lib/uv/workflow";
import type { NativeUvCubeSnapshot } from "@/lib/uv/nativeState";

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
  test("workflow passes physical atlas and logical project dimensions to native compilation", () => {
    const compiled = fixture();
    const faces = ["north", "south", "east", "west", "up", "down"] as const;
    const nativeFace = { uv: [4, 6, 0, 0] as const, rotation: 270 };
    const snapshots: NativeUvCubeSnapshot[] = compiled.placements.map(placement => ({
      cube_uuid: placement.id, box_uv: false, autouv: 0,
      faces: { north: nativeFace, south: nativeFace, east: nativeFace,
        west: nativeFace, up: nativeFace, down: nativeFace },
    }));
    const targets = compiled.placements.flatMap(placement => faces.map(face => ({
      island_id: placement.id + ":" + face, cube_uuid: placement.id, face,
      current_uv: [4, 6, 0, 0] as const, current_rotation: 270,
    })));
    const options = { atlas_width: 256, atlas_height: 512,
      logical_width: 128, logical_height: 128, default_texel_density: 1 };
    const result = compileAuthoringRecipeSemanticUvWorkflow(compiled, snapshots, targets, options);
    expect(result.native_plan.complete).toBe(true);
    for (const operation of result.native_plan.operations) {
      const placement = result.semantic.placements.find(item => item.id === operation.island_id)!;
      expect(operation.uv).toEqual([
        (placement.x + placement.width) / 2, (placement.y + placement.height) / 4,
        placement.x / 2, placement.y / 4,
      ]);
      expect(operation.rotation).toBe(270);
    }
    expect(() => compileAuthoringRecipeSemanticUvWorkflow(
      compiled, snapshots, targets, { ...options, logical_width: 0 }
    )).toThrow("UV_NATIVE_ATLAS_MAPPING_REQUIRED");
  });

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
