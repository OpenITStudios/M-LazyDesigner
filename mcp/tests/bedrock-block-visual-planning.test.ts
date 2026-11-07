import { describe, expect, test } from "bun:test";
import {
  planBedrockBlockVisual,
  type BlockVisualPlanningInput,
} from "@/lib/bedrock/blockVisualPlanning";

function sample(change: Partial<BlockVisualPlanningInput> = {}): BlockVisualPlanningInput {
  return {
    expected_project_uuid: "project-block",
    block_identifier: "demo:lantern",
    geometry_identifier: "geometry.lantern",
    compatibility: {
      format_version: "1.26.30",
      has_geometry_component: true,
      has_material_instances_component: true,
      features: [],
    },
    cubes: [{
      uuid: "base",
      bone_name: "bb_main",
      from: [-8, 0, -8],
      to: [8, 16, 8],
      box_uv: true,
    }],
    materials: [{
      key: "*",
      texture_key: "demo_lantern",
      render_method: "opaque",
    }],
    placement_intent: "SPARSE",
    ...change,
  };
}
const codes = (input: BlockVisualPlanningInput) =>
  planBedrockBlockVisual(input).issues.map(issue => issue.code);

describe("B1 custom-block visual planner consumes F0 source constraints", () => {
  test("valid declared block remains source-review-only and inputs stay immutable", () => {
    const input = sample();
    const before = structuredClone(input);
    const result = planBedrockBlockVisual(input);
    expect(result.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(result.compatibility.state).toBe("SOURCE_COMPATIBLE_NATIVE_UNVERIFIED");
    expect(result.geometry_summary).toMatchObject({
      source_cube_count: 1,
      exported_cube_count: 1,
      visible_exported_cube_count: 1,
      local_span: [16, 16, 16],
    });
    expect(result.warnings).toContain("MATERIAL_TEXTURE_RESOURCE_NOT_VERIFIED");
    expect(result.native_verified).toBe(false);
    expect(result.minecraft_verified).toBe(false);
    expect(result.performance_verified).toBe(false);
    expect(result.source_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(input).toEqual(before);
  });

  test("F0 older version and unpaired geometry/material remain blocking", () => {
    const uv = planBedrockBlockVisual(sample({
      compatibility: {
        format_version: "1.21.99",
        has_geometry_component: true,
        has_material_instances_component: true,
        features: ["uv_lock"],
      },
    }));
    expect(uv.state).toBe("BLOCKED_BY_DECLARED_COMPATIBILITY");
    expect(uv.compatibility.issues).toContainEqual({
      code: "FORMAT_TOO_OLD", feature: "uv_lock",
      minimum_format_version: "1.21.100",
    });
    const mismatch = planBedrockBlockVisual(sample({
      compatibility: {
        format_version: "1.21.80",
        has_geometry_component: true,
        has_material_instances_component: false,
        features: [],
      },
    }));
    expect(mismatch.compatibility.issues.map(issue => issue.code))
      .toContain("GEOMETRY_MATERIAL_PAIR_REQUIRED");
    expect(mismatch.issues.map(issue => issue.code))
      .toContain("MATERIAL_DECLARATION_UNEXPECTED");
  });

  test("culling requires a declared rule and an exact modeled bone", () => {
    const withCulling = sample({
      compatibility: {
        format_version: "1.26.30",
        has_geometry_component: true,
        has_material_instances_component: true,
        features: ["culling", "culling_shape"],
      },
    });
    expect(codes(withCulling)).toContain("CULLING_RULE_REFERENCE_MISSING");
    expect(codes({
      ...withCulling,
      culling_rule: {
        identifier: "demo:lantern_culling",
        rules: [{ bone_name: "wrong", direction: "north" }],
      },
    })).toContain("CULLING_BONE_NOT_FOUND");
    const valid = planBedrockBlockVisual({
      ...withCulling,
      culling_rule: {
        identifier: "demo:lantern_culling",
        rules: [{ bone_name: "bb_main", direction: "north" }],
      },
    });
    expect(valid.issues).toEqual([]);
    expect(valid.warnings).toContain("CULLING_RESOURCE_NOT_VERIFIED");
    expect(valid.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(() => planBedrockBlockVisual({
      ...withCulling,
      culling_rule: {
        identifier: "demo:lantern_culling",
        rules: [{ bone_name: "bb_main", direction: "sky" }],
      },
    })).toThrow("BLOCK_VISUAL_CULLING_RULE_INVALID");
  });

  test("UV lock flags non-square Box UV Cube faces, not equivalent cube surfaces", () => {
    const withLock = sample({
      compatibility: {
        format_version: "1.21.100",
        has_geometry_component: true,
        has_material_instances_component: true,
        features: ["uv_lock"],
      },
    });
    expect(planBedrockBlockVisual(withLock).warnings)
      .not.toContain("UV_LOCK_BOX_UV_NON_SQUARE_FACE_REVIEW");
    expect(planBedrockBlockVisual({
      ...withLock,
      cubes: [{
        uuid: "side", bone_name: "bb_main",
        from: [0, 0, 0], to: [16, 8, 16], box_uv: true,
      }],
    }).warnings).toContain("UV_LOCK_BOX_UV_NON_SQUARE_FACE_REVIEW");
    expect(planBedrockBlockVisual({
      ...withLock,
      cubes: [{
        uuid: "per-face", bone_name: "bb_main",
        from: [0, 0, 0], to: [16, 8, 16], box_uv: false,
      }],
    }).warnings).not.toContain("UV_LOCK_BOX_UV_NON_SQUARE_FACE_REVIEW");
  });

  test("visual-only rotation does not pretend to rotate collision or selection", () => {
    const input = sample({
      compatibility: {
        format_version: "1.26.30",
        has_geometry_component: true,
        has_material_instances_component: true,
        features: ["n_way_visual_rotation"],
      },
    });
    expect(codes(input)).toContain("ROTATION_STATE_NOT_DECLARED");
    const planned = planBedrockBlockVisual({
      ...input, n_way_rotation_state: "minecraft:cardinal_direction",
    });
    expect(planned.issues).toEqual([]);
    expect(planned.warnings).toContain("N_WAY_ROTATION_NOT_PHYSICAL_INTERACTION");
    expect(planned.native_verified).toBe(false);
  });

  test("repeated geometry above 50 Cubes warns, never automatically simplifies", () => {
    const cubes = Array.from({ length: 51 }, (_, i) => ({
      uuid: "cube-" + i,
      bone_name: "bb_main",
      from: [0, 0, 0] as [number, number, number],
      to: [1, 1, 1] as [number, number, number],
      box_uv: false,
    }));
    const input = sample({ placement_intent: "REPEATED", cubes });
    const result = planBedrockBlockVisual(input);
    expect(result.geometry_summary.source_cube_count).toBe(51);
    expect(result.warnings).toContain("COMPLEX_BLOCK_GEOMETRY_REVIEW");
    expect(result.warnings).toContain("REPEATED_BLOCK_PERFORMANCE_REVIEW");
    expect(result.issues).toEqual([]);
    expect(input.cubes).toHaveLength(51);
    const unique = planBedrockBlockVisual({
      ...input, placement_intent: "UNIQUE",
    });
    expect(unique.warnings).not.toContain("REPEATED_BLOCK_PERFORMANCE_REVIEW");
  });

  test("block material methods are distinct from entity materials", () => {
    const input = sample({
      materials: [{ key: "*", texture_key: "glass", render_method: "blend" }],
    });
    const result = planBedrockBlockVisual(input);
    expect(result.material_summary.non_opaque_methods).toEqual(["blend"]);
    expect(result.warnings).toContain("NON_OPAQUE_RENDER_DISTANCE_REVIEW");
    const unknown = planBedrockBlockVisual(sample({
      materials: [{ key: "*", texture_key: "atlas",
        render_method: "custom_future_method" }],
    }));
    expect(unknown.warnings).toContain("RENDER_METHOD_UNKNOWN_REVIEW");
    expect(unknown.warnings).not.toContain("NON_OPAQUE_RENDER_DISTANCE_REVIEW");
  });

  test("rotated/inflated and oversized source bounds cannot claim a rendered AABB", () => {
    const result = planBedrockBlockVisual(sample({
      cubes: [{
        uuid: "rotated", bone_name: "bb_main",
        from: [-10, 0, -4], to: [10, 4, 4],
        rotation: [0, 45, 0], inflate: 0.2, box_uv: false,
      }],
    }));
    expect(result.geometry_summary.local_span).toEqual([20, 4, 8]);
    expect(result.warnings).toContain("LARGE_LOCAL_ENVELOPE_REVIEW");
    expect(result.warnings).toContain("ROTATED_OR_INFLATED_BOUNDS_NOT_WORLD_ATTESTED");
    expect(result.visual_verified).toBe(false);
  });

  test("identity, finite geometry and duplicate materials/cubes fail closed", () => {
    expect(() => planBedrockBlockVisual(sample({
      block_identifier: "not-namespaced",
    }))).toThrow("BLOCK_VISUAL_IDENTIFIER_INVALID");
    expect(() => planBedrockBlockVisual(sample({
      geometry_identifier: "minecraft:geometry.full_block",
    }))).toThrow("BLOCK_VISUAL_GEOMETRY_IDENTIFIER_NOT_AUTHORED");
    expect(() => planBedrockBlockVisual(sample({
      geometry_identifier: "geometry.bad name",
    }))).toThrow("BLOCK_VISUAL_GEOMETRY_IDENTIFIER_NOT_AUTHORED");
    for (const change of [
      { cubes: [sample().cubes[0]!, sample().cubes[0]!] },
      { cubes: [{ ...sample().cubes[0]!, to: [Infinity, 16, 16] }] },
      { cubes: [{ ...sample().cubes[0]!, from: [8, 0, 0], to: [0, 16, 16] }] },
      { materials: [sample().materials[0]!, sample().materials[0]!] },
    ]) {
      expect(() => planBedrockBlockVisual(sample(change)))
        .toThrow();
    }
  });

  test("source fingerprint changes with geometry/material and stays order-neutral", () => {
    const first = sample({
      cubes: [
        { uuid: "a", bone_name: "bb_main",
          from: [0, 0, 0], to: [1, 1, 1], box_uv: true },
        { uuid: "b", bone_name: "bb_main",
          from: [1, 0, 0], to: [2, 1, 1], box_uv: true },
      ],
    });
    const baseline = planBedrockBlockVisual(first).source_fingerprint;
    expect(planBedrockBlockVisual({
      ...first, cubes: [...first.cubes].reverse(),
    }).source_fingerprint).toBe(baseline);
    expect(planBedrockBlockVisual({
      ...first,
      cubes: [
        { ...first.cubes[0]!, to: [2, 1, 1] },
        first.cubes[1]!,
      ],
    }).source_fingerprint).not.toBe(baseline);
    expect(planBedrockBlockVisual({
      ...first,
      materials: [{ ...first.materials[0]!, texture_key: "different" }],
    }).source_fingerprint).not.toBe(baseline);
  });
});
