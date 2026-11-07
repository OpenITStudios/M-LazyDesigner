import { describe, expect, test } from "bun:test";
import {
  assessBedrockBlockVisualCompatibility,
  type BedrockBlockVisualCompatibilityInput,
  type BedrockBlockVisualFeature,
} from "@/lib/bedrock/blockVisualCompatibility";

function sample(
  change: Partial<BedrockBlockVisualCompatibilityInput> = {}
): BedrockBlockVisualCompatibilityInput {
  return {
    format_version: "1.26.30",
    has_geometry_component: true,
    has_material_instances_component: true,
    features: [],
    ...change,
  };
}
const issueCodes = (input: BedrockBlockVisualCompatibilityInput) =>
  assessBedrockBlockVisualCompatibility(input).issues.map(issue => issue.code);
const featureIssue = (feature: BedrockBlockVisualFeature, version: string) =>
  assessBedrockBlockVisualCompatibility(sample({
    format_version: version, features: [feature],
  })).issues.find(issue => issue.feature === feature);

describe("Bedrock custom-block visual format policy (source only)", () => {
  test("keeps legacy geometry declaration separate from native acceptance", () => {
    const result = assessBedrockBlockVisualCompatibility(sample({
      format_version: "1.19.40",
      has_material_instances_component: false,
    }));
    expect(result.state).toBe("SOURCE_COMPATIBLE_NATIVE_UNVERIFIED");
    expect(result.native_verified).toBe(false);
    expect(result.minecraft_verified).toBe(false);
    expect(issueCodes(sample({
      format_version: "1.19.39",
      has_material_instances_component: false,
    }))).toContain("FORMAT_TOO_OLD");
    expect(issueCodes(sample({ has_geometry_component: false })))
      .toContain("GEOMETRY_REQUIRED");
  });

  test("1.21.80+ requires paired geometry and material instances", () => {
    expect(issueCodes(sample({
      format_version: "1.21.80",
      has_material_instances_component: false,
    }))).toContain("GEOMETRY_MATERIAL_PAIR_REQUIRED");
    expect(issueCodes(sample({
      format_version: "1.21.80",
      has_geometry_component: false,
    }))).toContain("GEOMETRY_MATERIAL_PAIR_REQUIRED");
    expect(issueCodes(sample({ format_version: "1.21.80" }))).toEqual([]);
  });

  test("uses numeric versions for UV lock instead of lexicographic strings", () => {
    expect(featureIssue("uv_lock", "1.21.99")?.minimum_format_version)
      .toBe("1.21.100");
    expect(featureIssue("uv_lock", "1.21.100")).toBeUndefined();
    expect(assessBedrockBlockVisualCompatibility(sample({
      format_version: "1.21.100", features: ["uv_lock"],
    })).review_notes).toContain("UV_LOCK_BOX_UV_SQUARE_FACE_REVIEW");
  });

  test("requires a declared culling rule as well as the culling-shape version", () => {
    expect(featureIssue("culling", "1.20.59")?.minimum_format_version)
      .toBe("1.20.60");
    expect(featureIssue("culling_shape", "1.26.29")?.minimum_format_version)
      .toBe("1.26.30");
    expect(issueCodes(sample({ features: ["culling_shape"] })))
      .toContain("CULLING_RULE_REQUIRED");
    expect(issueCodes(sample({ features: ["culling", "culling_shape"] })))
      .toEqual([]);
  });

  test("visual rotation is never claimed to rotate physical interaction", () => {
    expect(featureIssue("n_way_visual_rotation", "1.26.29")
      ?.minimum_format_version).toBe("1.26.30");
    const result = assessBedrockBlockVisualCompatibility(sample({
      features: ["n_way_visual_rotation"],
    }));
    expect(result.state).toBe("SOURCE_COMPATIBLE_NATIVE_UNVERIFIED");
    expect(result.review_notes).toContain(
      "VISUAL_ROTATION_DOES_NOT_ROTATE_COLLISION_OR_SELECTION"
    );
  });

  test("multi collision is retail-gated, while legacy selection/collision keep older floors", () => {
    expect(featureIssue("collision_box", "1.19.49")?.minimum_format_version)
      .toBe("1.19.50");
    expect(featureIssue("selection_box", "1.19.59")?.minimum_format_version)
      .toBe("1.19.60");
    expect(featureIssue("multi_collision_boxes", "1.25.99")
      ?.minimum_format_version).toBe("1.26.0");
    expect(featureIssue("multi_collision_boxes", "1.26.0")).toBeUndefined();
    expect(assessBedrockBlockVisualCompatibility(sample({
      features: ["multi_collision_boxes"],
    })).review_notes).toContain("COLLISION_PREVIEW_IS_NOT_GAMEPLAY_PROOF");
  });

  test("malformed or speculative inputs fail closed before claiming support", () => {
    for (const format_version of ["latest", "1.26", "1.26.30-preview",
      "1.26.030", "1.99999999.0", ""]) {
      expect(() => assessBedrockBlockVisualCompatibility(sample({
        format_version,
      }))).toThrow("BEDROCK_BLOCK_FORMAT_VERSION_INVALID");
    }
    expect(() => assessBedrockBlockVisualCompatibility(sample({
      features: ["uv_lock", "uv_lock"],
    }))).toThrow("BEDROCK_BLOCK_VISUAL_FEATURE_INVALID_OR_DUPLICATE");
    expect(() => assessBedrockBlockVisualCompatibility(sample({
      features: ["invented_feature" as BedrockBlockVisualFeature],
    }))).toThrow("BEDROCK_BLOCK_VISUAL_FEATURE_INVALID_OR_DUPLICATE");
    expect(() => assessBedrockBlockVisualCompatibility({
      ...sample(), has_geometry_component: null as unknown as boolean,
    })).toThrow("BEDROCK_BLOCK_VISUAL_DECLARATION_INVALID");
  });
});
