import { createHash } from "node:crypto";
import { normalizeBedrockGeometryIdentifier } from "./projectIdentity";
import {
  assessBedrockBlockVisualCompatibility,
  type BedrockBlockVisualCompatibilityAssessment,
  type BedrockBlockVisualCompatibilityInput,
} from "./blockVisualCompatibility";

/**
 * B1 bounded source-side visual planner for authored custom-block geometry.
 * Does not read native Blockbench, edit the Resource/Behavior Pack, or prove
 * culling, transparency, physical collision, or in-game performance.
 *
 * Numeric bounds are Cube-local only: a rotated Cube or changed Group
 * hierarchy needs rendered-world measurement from the existing native owner.
 */
export type BlockVisualCube = {
  uuid: string;
  bone_name: string;
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  inflate?: number;
  box_uv: boolean;
  visible?: boolean;
  export?: boolean;
};

export type BlockVisualMaterial = {
  key: string;
  texture_key: string;
  /** Block render method, never an entity material-profile alias. */
  render_method: string;
};

export type BlockCullingRuleClaim = {
  identifier: string;
  rules: readonly { bone_name: string; direction: string }[];
};

export type BlockVisualPlanningInput = {
  expected_project_uuid: string;
  block_identifier: string;
  /** Only authored geometry.<name> is handled in B1, not built-in geometry. */
  geometry_identifier: string;
  compatibility: BedrockBlockVisualCompatibilityInput;
  cubes: readonly BlockVisualCube[];
  materials: readonly BlockVisualMaterial[];
  /** A declared rule inventory, not an authenticated resource file. */
  culling_rule?: BlockCullingRuleClaim;
  /** The state name is a caller claim, not proof of a gameplay block state. */
  n_way_rotation_state?: string;
  placement_intent: "UNIQUE" | "SPARSE" | "REPEATED";
};

export type BlockVisualPlanningIssue = {
  code:
    | "CUSTOM_GEOMETRY_SOURCE_MISSING"
    | "EXPORTABLE_GEOMETRY_SOURCE_MISSING"
    | "MATERIAL_DECLARATION_MISSING"
    | "MATERIAL_DECLARATION_UNEXPECTED"
    | "CULLING_RULE_REFERENCE_MISSING"
    | "CULLING_DECLARATION_UNEXPECTED"
    | "CULLING_BONE_NOT_FOUND"
    | "ROTATION_STATE_NOT_DECLARED";
  detail?: string;
};

export type BlockVisualPlanningWarning =
  | "COMPLEX_BLOCK_GEOMETRY_REVIEW"
  | "REPEATED_BLOCK_PERFORMANCE_REVIEW"
  | "NON_OPAQUE_RENDER_DISTANCE_REVIEW"
  | "RENDER_METHOD_UNKNOWN_REVIEW"
  | "UV_LOCK_BOX_UV_NON_SQUARE_FACE_REVIEW"
  | "ZERO_THICKNESS_CUBE_REVIEW"
  | "LARGE_LOCAL_ENVELOPE_REVIEW"
  | "SOURCE_BLOCK_SPAN_OVER_30_REVIEW"
  | "SOURCE_BLOCK_POSITION_OUTSIDE_30_REVIEW"
  | "SOURCE_BLOCK_BASE_OVERLAP_REVIEW"
  | "ROTATED_OR_INFLATED_BOUNDS_NOT_WORLD_ATTESTED"
  | "CULLING_RESOURCE_NOT_VERIFIED"
  | "MATERIAL_TEXTURE_RESOURCE_NOT_VERIFIED"
  | "N_WAY_ROTATION_NOT_PHYSICAL_INTERACTION"
  | "CUBE_PARENT_HIERARCHY_NOT_VERIFIED";

export type BlockVisualPlanningReview = {
  state: "BLOCKED_BY_DECLARED_COMPATIBILITY" | "SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED";
  source_fingerprint: string;
  project_uuid: string;
  block_identifier: string;
  geometry_identifier: string;
  compatibility: BedrockBlockVisualCompatibilityAssessment;
  issues: BlockVisualPlanningIssue[];
  warnings: BlockVisualPlanningWarning[];
  geometry_summary: {
    source_cube_count: number;
    exported_cube_count: number;
    visible_exported_cube_count: number;
    local_bounds: { min: [number, number, number]; max: [number, number, number] } | null;
    /** Meaningful only for an unrotated/local Cube inventory; not world AABB. */
    local_span: [number, number, number] | null;
  };
  material_summary: {
    declarations: number;
    non_opaque_methods: string[];
  };
  native_verified: false;
  visual_verified: false;
  minecraft_verified: false;
  performance_verified: false;
};

const BLOCK_ID = /^[a-z0-9_][a-z0-9_.-]{0,63}:[a-z0-9_][a-z0-9_./-]{0,127}$/;
const BONE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const FACE_DIRECTIONS = new Set(["north", "south", "east", "west", "up", "down"]);
const KNOWN_RENDER_METHODS = new Set([
  "opaque", "double_sided", "blend", "alpha_test",
  "alpha_test_single_sided",
  "blend_to_opaque", "alpha_test_to_opaque",
  "alpha_test_single_sided_to_opaque",
]);
const MAX_CUBES = 4096;
const MAX_MATERIALS = 64;
const MAX_CULLING_RULES = 256;
// Mojang custom block source guidance: 30 px extent/placement and 1 px base overlap.
// These are only local-source review thresholds until bone transforms are resolved.
const CUSTOM_BLOCK_MAX_LOCAL_SPAN = 30;
const CUSTOM_BLOCK_MAX_LOCAL_POSITION = 30;
const BASE_BLOCK_MIN = [-8, 0, -8] as const;
const BASE_BLOCK_MAX = [8, 16, 8] as const;

function exact(value: unknown, label: string, max = 160): string {
  if (typeof value !== "string" || value.length === 0 ||
      value.length > max || value.trim() !== value) {
    throw new Error("BLOCK_VISUAL_SOURCE_IDENTITY_INVALID: " + label);
  }
  return value;
}

function requireBlockId(value: unknown, label: string): string {
  const id = exact(value, label, 192);
  if (!BLOCK_ID.test(id) || id.includes("//") ||
      id.split(":")[1]!.split("/").some(part => part === "." || part === "..")) {
    throw new Error("BLOCK_VISUAL_IDENTIFIER_INVALID: " + label);
  }
  return id;
}

function vector(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 ||
      value.some(coordinate => typeof coordinate !== "number" ||
        !Number.isFinite(coordinate))) {
    throw new Error("BLOCK_VISUAL_GEOMETRY_VECTOR_INVALID: " + label);
  }
  return [value[0], value[1], value[2]];
}

/** Pure consumer of the F0 version/feature gate: no second version table. */
export function planBedrockBlockVisual(
  input: BlockVisualPlanningInput
): BlockVisualPlanningReview {
  if (!input || typeof input !== "object") {
    throw new Error("BLOCK_VISUAL_SOURCE_INVALID");
  }
  const project = exact(input.expected_project_uuid, "expected_project_uuid", 128);
  const block = requireBlockId(input.block_identifier, "block_identifier");
  const geometry = exact(input.geometry_identifier, "geometry_identifier", 192);
  // The shared Bedrock identifier owner can itself throw for malformed
  // names. Normalize every unsupported authored-Geometry target to the
  // same B1 refusal; never reinterpret Vanilla geometry as model Cubes.
  try {
    if (normalizeBedrockGeometryIdentifier(geometry) !== geometry) {
      throw new Error("BLOCK_VISUAL_GEOMETRY_IDENTIFIER_NOT_AUTHORED");
    }
  } catch {
    throw new Error("BLOCK_VISUAL_GEOMETRY_IDENTIFIER_NOT_AUTHORED");
  }
  if (!["UNIQUE", "SPARSE", "REPEATED"].includes(input.placement_intent)) {
    throw new Error("BLOCK_VISUAL_PLACEMENT_INTENT_INVALID");
  }
  const compatibility = assessBedrockBlockVisualCompatibility(input.compatibility);
  if (!Array.isArray(input.cubes) || input.cubes.length > MAX_CUBES ||
      !Array.isArray(input.materials) || input.materials.length > MAX_MATERIALS) {
    throw new Error("BLOCK_VISUAL_SOURCE_BUDGET_INVALID");
  }

  const seenCubes = new Set<string>();
  const seenBones = new Set<string>();
  const canonicalCubes = input.cubes.map(cube => {
    if (!cube || typeof cube !== "object") {
      throw new Error("BLOCK_VISUAL_CUBE_INVALID");
    }
    const uuid = exact(cube.uuid, "cube.uuid", 128);
    const bone = exact(cube.bone_name, "cube.bone_name", 128);
    if (!BONE_NAME.test(bone) || seenCubes.has(uuid) ||
        typeof cube.box_uv !== "boolean" ||
        (cube.visible !== undefined && typeof cube.visible !== "boolean") ||
        (cube.export !== undefined && typeof cube.export !== "boolean")) {
      throw new Error("BLOCK_VISUAL_CUBE_INVALID_OR_DUPLICATE");
    }
    seenCubes.add(uuid);
    seenBones.add(bone);
    const from = vector(cube.from, "cube.from");
    const to = vector(cube.to, "cube.to");
    if (from.some((coordinate, axis) => coordinate > to[axis]!)) {
      throw new Error("BLOCK_VISUAL_CUBE_REVERSED_BOUNDS");
    }
    const rotation = cube.rotation === undefined
      ? [0, 0, 0] as [number, number, number]
      : vector(cube.rotation, "cube.rotation");
    if (cube.inflate !== undefined &&
        (typeof cube.inflate !== "number" || !Number.isFinite(cube.inflate))) {
      throw new Error("BLOCK_VISUAL_CUBE_INFLATE_INVALID");
    }
    return {
      uuid, bone_name: bone, from, to, rotation,
      inflate: cube.inflate ?? 0,
      box_uv: cube.box_uv, visible: cube.visible !== false,
      export: cube.export !== false,
    };
  }).sort((a, b) => a.uuid.localeCompare(b.uuid));

  const seenMaterials = new Set<string>();
  const canonicalMaterials = input.materials.map(material => {
    if (!material || typeof material !== "object") {
      throw new Error("BLOCK_VISUAL_MATERIAL_INVALID");
    }
    const key = exact(material.key, "material.key");
    const texture_key = exact(material.texture_key, "material.texture_key");
    const render_method = exact(material.render_method, "material.render_method");
    if (seenMaterials.has(key)) {
      throw new Error("BLOCK_VISUAL_MATERIAL_DUPLICATE");
    }
    seenMaterials.add(key);
    return { key, texture_key, render_method };
  }).sort((a, b) => a.key.localeCompare(b.key));

  const hasCulling = input.compatibility.features.includes("culling");
  let culling: BlockCullingRuleClaim | null = null;
  if (input.culling_rule !== undefined) {
    const claim = input.culling_rule;
    if (!claim || typeof claim !== "object" ||
        !Array.isArray(claim.rules) || claim.rules.length > MAX_CULLING_RULES) {
      throw new Error("BLOCK_VISUAL_CULLING_DECLARATION_INVALID");
    }
    const identifier = requireBlockId(claim.identifier, "culling.identifier");
    const rules = claim.rules.map(rule => {
      if (!rule || typeof rule !== "object" ||
          typeof rule.bone_name !== "string" ||
          !BONE_NAME.test(rule.bone_name) ||
          typeof rule.direction !== "string" ||
          !FACE_DIRECTIONS.has(rule.direction)) {
        throw new Error("BLOCK_VISUAL_CULLING_RULE_INVALID");
      }
      return { bone_name: rule.bone_name, direction: rule.direction };
    }).sort((a, b) => a.bone_name.localeCompare(b.bone_name) ||
      a.direction.localeCompare(b.direction));
    culling = { identifier, rules };
  }
  let rotationState: string | null = null;
  if (input.n_way_rotation_state !== undefined) {
    rotationState = exact(input.n_way_rotation_state, "n_way_rotation_state", 192);
  }

  const exportCubes = canonicalCubes.filter(cube => cube.export);
  const visibleCubes = exportCubes.filter(cube => cube.visible);
  const issues: BlockVisualPlanningIssue[] = [];
  const warnings = new Set<BlockVisualPlanningWarning>();
  const addIssue = (code: BlockVisualPlanningIssue["code"], detail?: string) => {
    issues.push({ code, ...(detail ? { detail } : {}) });
  };
  if (!canonicalCubes.length) {
    addIssue("CUSTOM_GEOMETRY_SOURCE_MISSING");
  } else if (!exportCubes.length) {
    addIssue("EXPORTABLE_GEOMETRY_SOURCE_MISSING");
  }
  if (input.compatibility.has_material_instances_component &&
      !canonicalMaterials.length) {
    addIssue("MATERIAL_DECLARATION_MISSING");
  }
  if (!input.compatibility.has_material_instances_component &&
      canonicalMaterials.length) {
    addIssue("MATERIAL_DECLARATION_UNEXPECTED");
  }
  if (hasCulling && (!culling || !culling.rules.length)) {
    addIssue("CULLING_RULE_REFERENCE_MISSING");
  }
  if (!hasCulling && culling) {
    addIssue("CULLING_DECLARATION_UNEXPECTED");
  }
  for (const rule of culling?.rules ?? []) {
    if (!seenBones.has(rule.bone_name)) {
      addIssue("CULLING_BONE_NOT_FOUND", rule.bone_name);
    }
  }
  if (culling) warnings.add("CULLING_RESOURCE_NOT_VERIFIED");
  if (input.compatibility.features.includes("n_way_visual_rotation") &&
      !rotationState) {
    addIssue("ROTATION_STATE_NOT_DECLARED");
  }
  if (input.compatibility.features.includes("n_way_visual_rotation")) {
    warnings.add("N_WAY_ROTATION_NOT_PHYSICAL_INTERACTION");
  }

  const min = [Infinity, Infinity, Infinity] as [number, number, number];
  const max = [-Infinity, -Infinity, -Infinity] as [number, number, number];
  for (const cube of visibleCubes) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], cube.from[axis]!);
      max[axis] = Math.max(max[axis], cube.to[axis]!);
    }
    const size = cube.to.map((coordinate, axis) =>
      coordinate - cube.from[axis]!) as [number, number, number];
    if (size.some(span => !Number.isFinite(span))) {
      throw new Error("BLOCK_VISUAL_GEOMETRY_SPAN_UNREPRESENTABLE");
    }
    if (size.some(span => span === 0)) {
      warnings.add("ZERO_THICKNESS_CUBE_REVIEW");
    }
    if (input.compatibility.features.includes("uv_lock") && cube.box_uv &&
        (size[0] !== size[1] || size[1] !== size[2])) {
      // uv_lock on non-square Box-UV faces is not supported. This is an
      // advisory source review: face enablement and native UV are unobserved.
      warnings.add("UV_LOCK_BOX_UV_NON_SQUARE_FACE_REVIEW");
    }
    if (cube.inflate !== 0 || cube.rotation.some(angle => angle !== 0)) {
      warnings.add("ROTATED_OR_INFLATED_BOUNDS_NOT_WORLD_ATTESTED");
    }
  }
  const local_bounds = visibleCubes.length ? { min, max } : null;
  const local_span = local_bounds
    ? [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
      as [number, number, number]
    : null;
  if (local_span?.some(span => !Number.isFinite(span))) {
    throw new Error("BLOCK_VISUAL_GEOMETRY_SPAN_UNREPRESENTABLE");
  }
  if (local_span?.some(span => span > 16)) {
    warnings.add("LARGE_LOCAL_ENVELOPE_REVIEW");
  }
  // The editor may contain hidden-but-exported Cubes. Review all exported
  // source geometry; never present local coordinates as transformed world AABB.
  if (exportCubes.length) {
    const exportedMin = [Infinity, Infinity, Infinity];
    const exportedMax = [-Infinity, -Infinity, -Infinity];
    const touchesBaseAxis = [false, false, false];
    for (const cube of exportCubes) {
      for (let axis = 0; axis < 3; axis++) {
        exportedMin[axis] = Math.min(exportedMin[axis]!, cube.from[axis]!);
        exportedMax[axis] = Math.max(exportedMax[axis]!, cube.to[axis]!);
        if (Math.min(cube.to[axis]!, BASE_BLOCK_MAX[axis]!) -
            Math.max(cube.from[axis]!, BASE_BLOCK_MIN[axis]!) >= 1) {
          touchesBaseAxis[axis] = true;
        }
      }
    }
    if (exportedMin.some((v, axis) =>
      !Number.isFinite(exportedMax[axis]! - v))) {
      throw new Error("BLOCK_VISUAL_GEOMETRY_SPAN_UNREPRESENTABLE");
    }
    if (exportedMin.some((v, axis) =>
      exportedMax[axis]! - v > CUSTOM_BLOCK_MAX_LOCAL_SPAN)) {
      warnings.add("SOURCE_BLOCK_SPAN_OVER_30_REVIEW");
    }
    if (exportedMin.some((v, axis) =>
      v < -CUSTOM_BLOCK_MAX_LOCAL_POSITION ||
      exportedMax[axis]! > CUSTOM_BLOCK_MAX_LOCAL_POSITION)) {
      warnings.add("SOURCE_BLOCK_POSITION_OUTSIDE_30_REVIEW");
    }
    if (touchesBaseAxis.some(touches => !touches)) {
      warnings.add("SOURCE_BLOCK_BASE_OVERLAP_REVIEW");
    }
  }
  if (exportCubes.length > 50) {
    warnings.add("COMPLEX_BLOCK_GEOMETRY_REVIEW");
  }
  if (input.placement_intent === "REPEATED" && exportCubes.length > 50) {
    warnings.add("REPEATED_BLOCK_PERFORMANCE_REVIEW");
  }
  if (canonicalCubes.length) {
    warnings.add("CUBE_PARENT_HIERARCHY_NOT_VERIFIED");
  }
  if (canonicalMaterials.length) {
    warnings.add("MATERIAL_TEXTURE_RESOURCE_NOT_VERIFIED");
  }
  const nonOpaque = new Set<string>();
  for (const material of canonicalMaterials) {
    if (!KNOWN_RENDER_METHODS.has(material.render_method)) {
      warnings.add("RENDER_METHOD_UNKNOWN_REVIEW");
    } else if (material.render_method !== "opaque") {
      nonOpaque.add(material.render_method);
      warnings.add("NON_OPAQUE_RENDER_DISTANCE_REVIEW");
    }
  }

  const normalizedSource = {
    project, block, geometry, placement_intent: input.placement_intent,
    compatibility: {
      format_version: compatibility.format_version,
      has_geometry_component: input.compatibility.has_geometry_component,
      has_material_instances_component:
        input.compatibility.has_material_instances_component,
      features: [...input.compatibility.features].sort(),
    },
    cubes: canonicalCubes, materials: canonicalMaterials, culling, rotationState,
  };
  const source_fingerprint = "sha256:" + createHash("sha256")
    .update(JSON.stringify(["block-visual-b1-v1", normalizedSource]))
    .digest("hex");

  return {
    state: compatibility.issues.length || issues.length
      ? "BLOCKED_BY_DECLARED_COMPATIBILITY"
      : "SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED",
    source_fingerprint,
    project_uuid: project,
    block_identifier: block,
    geometry_identifier: geometry,
    compatibility,
    issues,
    warnings: [...warnings],
    geometry_summary: {
      source_cube_count: canonicalCubes.length,
      exported_cube_count: exportCubes.length,
      visible_exported_cube_count: visibleCubes.length,
      local_bounds, local_span,
    },
    material_summary: {
      declarations: canonicalMaterials.length,
      non_opaque_methods: [...nonOpaque].sort(),
    },
    native_verified: false,
    visual_verified: false,
    minecraft_verified: false,
    performance_verified: false,
  };
}
