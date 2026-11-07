/**
 * Source-only retail-format compatibility assessment for authored custom
 * block visuals. This is NOT a Runtime registration, Bedrock pack compiler,
 * in-game test, or proof that the declared geometry actually renders.
 *
 * Microsoft block geometry, material, culling, collision and selection docs
 * own these thresholds. Do not infer the game version from the Blockbench
 * version, or enable experimental-only variants as retail-ready.
 */
const BLOCK_VISUAL_FEATURE_MIN_FORMAT = {
  collision_box: "1.19.50",
  selection_box: "1.19.60",
  culling: "1.20.60",
  uv_lock: "1.21.100",
  multi_collision_boxes: "1.26.0",
  // Height above 16 source units is independently introduced alongside
  // collision arrays. Keep it distinct from multi-box syntax.
  extended_collision_height: "1.26.0",
  culling_shape: "1.26.30",
  n_way_visual_rotation: "1.26.30",
} as const;

export type BedrockBlockVisualFeature =
  keyof typeof BLOCK_VISUAL_FEATURE_MIN_FORMAT;

export type BedrockBlockVisualCompatibilityInput = {
  /** minecraft:block JSON format_version, NOT the host Blockbench version. */
  format_version: string;
  /** Presence of minecraft:geometry on the target custom block. */
  has_geometry_component: boolean;
  /** Presence of minecraft:material_instances on the target custom block. */
  has_material_instances_component: boolean;
  /** Exact visual/interaction fields requested, not inferred capabilities. */
  features: readonly BedrockBlockVisualFeature[];
};

export type BedrockBlockVisualCompatibilityIssue = {
  code: "GEOMETRY_REQUIRED" | "FORMAT_TOO_OLD" |
    "GEOMETRY_MATERIAL_PAIR_REQUIRED" | "CULLING_RULE_REQUIRED";
  feature?: BedrockBlockVisualFeature | "geometry";
  minimum_format_version?: string;
};

export type BedrockBlockVisualCompatibilityAssessment = {
  state: "SOURCE_COMPATIBLE_NATIVE_UNVERIFIED" | "BLOCKED_BY_DECLARED_COMPATIBILITY";
  format_version: string;
  issues: BedrockBlockVisualCompatibilityIssue[];
  review_notes: Array<
    "UV_LOCK_BOX_UV_SQUARE_FACE_REVIEW" |
    "VISUAL_ROTATION_DOES_NOT_ROTATE_COLLISION_OR_SELECTION" |
    "COLLISION_PREVIEW_IS_NOT_GAMEPLAY_PROOF"
  >;
  native_verified: false;
  minecraft_verified: false;
};

function parseStableFormatVersion(value: unknown): [number, number, number] {
  if (typeof value !== "string") {
    throw new Error("BEDROCK_BLOCK_FORMAT_VERSION_INVALID");
  }
  // Reject latest/preview/ranges and ambiguous leading zeros. A future
  // version may be reviewed, but it never becomes native-verified here.
  const match = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/.exec(value);
  if (!match) throw new Error("BEDROCK_BLOCK_FORMAT_VERSION_INVALID");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function versionAtLeast(
  actual: readonly number[],
  threshold: string
): boolean {
  const minimum = parseStableFormatVersion(threshold);
  for (let index = 0; index < 3; index++) {
    if (actual[index]! > minimum[index]!) return true;
    if (actual[index]! < minimum[index]!) return false;
  }
  return true;
}

/**
 * Performs bounded declaration/format checks only. Missing exact identifiers,
 * actual culling-rule files, Box UV square faces, native surface state and
 * Minecraft rendering require their future dedicated owners.
 */
export function assessBedrockBlockVisualCompatibility(
  input: BedrockBlockVisualCompatibilityInput
): BedrockBlockVisualCompatibilityAssessment {
  const version = parseStableFormatVersion(input.format_version);
  if (typeof input.has_geometry_component !== "boolean" ||
      typeof input.has_material_instances_component !== "boolean" ||
      !Array.isArray(input.features) ||
      input.features.length > Object.keys(BLOCK_VISUAL_FEATURE_MIN_FORMAT).length) {
    throw new Error("BEDROCK_BLOCK_VISUAL_DECLARATION_INVALID");
  }
  const selected = new Set<BedrockBlockVisualFeature>();
  for (const feature of input.features) {
    if (typeof feature !== "string" ||
        !Object.prototype.hasOwnProperty.call(
          BLOCK_VISUAL_FEATURE_MIN_FORMAT, feature
        ) || selected.has(feature)) {
      throw new Error("BEDROCK_BLOCK_VISUAL_FEATURE_INVALID_OR_DUPLICATE");
    }
    selected.add(feature);
  }

  const issues: BedrockBlockVisualCompatibilityIssue[] = [];
  const review_notes: BedrockBlockVisualCompatibilityAssessment["review_notes"] = [];
  if (!input.has_geometry_component) {
    issues.push({ code: "GEOMETRY_REQUIRED", feature: "geometry" });
  } else if (!versionAtLeast(version, "1.19.40")) {
    issues.push({
      code: "FORMAT_TOO_OLD", feature: "geometry",
      minimum_format_version: "1.19.40",
    });
  }

  if (versionAtLeast(version, "1.21.80") &&
      input.has_geometry_component !== input.has_material_instances_component) {
    issues.push({ code: "GEOMETRY_MATERIAL_PAIR_REQUIRED" });
  }
  for (const feature of input.features) {
    const required = BLOCK_VISUAL_FEATURE_MIN_FORMAT[feature];
    if (!versionAtLeast(version, required)) {
      issues.push({
        code: "FORMAT_TOO_OLD",
        feature,
        minimum_format_version: required,
      });
    }
  }
  if (selected.has("culling_shape") && !selected.has("culling")) {
    // A culling shape cannot cause adjacent-face occlusion without the
    // geometry component's culling-rule reference.
    issues.push({ code: "CULLING_RULE_REQUIRED", feature: "culling_shape" });
  }

  if (selected.has("uv_lock")) {
    review_notes.push("UV_LOCK_BOX_UV_SQUARE_FACE_REVIEW");
  }
  if (selected.has("n_way_visual_rotation")) {
    review_notes.push("VISUAL_ROTATION_DOES_NOT_ROTATE_COLLISION_OR_SELECTION");
  }
  if (selected.has("collision_box") ||
      selected.has("multi_collision_boxes") ||
      selected.has("selection_box")) {
    review_notes.push("COLLISION_PREVIEW_IS_NOT_GAMEPLAY_PROOF");
  }

  return {
    state: issues.length > 0
      ? "BLOCKED_BY_DECLARED_COMPATIBILITY"
      : "SOURCE_COMPATIBLE_NATIVE_UNVERIFIED",
    format_version: input.format_version,
    issues,
    review_notes,
    native_verified: false,
    minecraft_verified: false,
  };
}
