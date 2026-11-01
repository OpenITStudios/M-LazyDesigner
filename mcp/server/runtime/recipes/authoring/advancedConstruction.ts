/// <reference types="blockbench-types" />

import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import {
  buildAdvancedGeometryRecipeCandidate,
  type AdvancedGeometryFeature,
} from "@/lib/authoringRecipe/geometryComposition";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { getAllToolDefinitions } from "@/lib/factories";

const MAX_SINGLE_NATIVE_BATCH = 64;

export type AdvancedNativeConstructionInput = {
  /** Live Project identity from the existing Control/Project tool. */
  expected_project_uuid: string;
  /** Exact existing Group UUID. Never fall back to selected/first Group. */
  parent_group_uuid: string;
  features: AdvancedGeometryFeature[];
};

function requireBedrockProject(input: AdvancedNativeConstructionInput): void {
  if (!Project || typeof Project.uuid !== "string" ||
    Project.uuid !== input.expected_project_uuid) {
    throw new Error(
      "ADVANCED_GEOMETRY_PROJECT_MISMATCH: resolve the actual target project before authoring."
    );
  }
  if (typeof Format === "undefined" || Format?.id !== "bedrock") {
    throw new Error(
      "ADVANCED_GEOMETRY_FORMAT_UNSUPPORTED: only Minecraft Bedrock Entity is supported."
    );
  }
  if (typeof Group === "undefined" ||
    !Array.isArray(Group.all) ||
    !Group.all.some(group => group.uuid === input.parent_group_uuid)) {
    throw new Error(
      "ADVANCED_GEOMETRY_PARENT_BONE_REQUIRED: provide an exact existing Group UUID."
    );
  }
}

function prepareNativeConstruction(input: AdvancedNativeConstructionInput) {
  requireBedrockProject(input);
  if (input.features.some(feature => feature.replace_generated === true)) {
    throw new Error(
      "ADVANCED_GEOMETRY_CREATE_ONLY: replace existing geometry through a separately verified Recipe revision."
    );
  }
  const source: AuthoringRecipe = {
    schema: 1,
    compiler_version: 1,
    id: "native-advanced-" + input.expected_project_uuid.slice(0, 36),
    name: "Advanced geometry construction candidate",
    prototypes: [],
    patterns: [],
  };
  const planned = buildAdvancedGeometryRecipeCandidate(source, input.features);
  const compiled = compileAuthoringRecipe(planned.next_recipe);
  if (compiled.placements.length < 1 ||
    compiled.placements.length > MAX_SINGLE_NATIVE_BATCH) {
    throw new Error(
      "ADVANCED_GEOMETRY_NATIVE_BATCH_BUDGET: compose at most 64 Cubes per atomic create."
    );
  }
  const featureByPattern = new Map(
    planned.next_recipe.patterns.map(pattern =>
      [pattern.id, pattern.feature_id] as const
    )
  );
  const elements = compiled.placements.map(placement => {
    const featureId = featureByPattern.get(placement.source_pattern_id);
    if (!featureId) {
      throw new Error("ADVANCED_GEOMETRY_SOURCE_OWNER_MISSING");
    }
    return {
      name: featureId + "_" + placement.name,
      from: placement.from,
      to: placement.to,
      origin: placement.origin,
      rotation: placement.rotation,
      inflate: placement.inflate,
      feature_id: featureId,
      instance_id: placement.id,
    };
  });
  const names = new Set(elements.map(element => element.name));
  if (names.size !== elements.length) {
    throw new Error("ADVANCED_GEOMETRY_DUPLICATE_NATIVE_NAME");
  }
  return { elements, summary: planned.summary };
}

/** Source-only plan with read-only Project/Group identity checks; no Undo. */
export function previewAdvancedGeometryNative(input: AdvancedNativeConstructionInput) {
  const planned = prepareNativeConstruction(input);
  return {
    status: "SOURCE_PLAN_NOT_VISUALLY_VERIFIED" as const,
    project_uuid: input.expected_project_uuid,
    parent_group_uuid: input.parent_group_uuid,
    summary: planned.summary,
    cubes: planned.elements,
    applied: false as const,
  };
}

/**
 * One existing manage_cubes(create) execution and one native Undo.
 * No second project store, no new public tool and no unscoped retries.
 * Native receipt is passed through; visual/Bedrock export need later review.
 */
export async function createAdvancedGeometryNative(input: AdvancedNativeConstructionInput) {
  const planned = prepareNativeConstruction(input);
  if (typeof Undo === "undefined" || Undo.current_save) {
    throw new Error(
      "ADVANCED_GEOMETRY_EDIT_IN_PROGRESS: finish the active native edit before construction."
    );
  }
  const group = Group.all.find(item => item.uuid === input.parent_group_uuid);
  if (!group) {
    throw new Error("ADVANCED_GEOMETRY_PARENT_CHANGED");
  }
  // Collision checks are a create-only idempotence guard, not a substitute
  // for verifying a previously uncertain successful native mutation.
  const existingNames = new Set((Cube.all ?? [])
    .filter(cube => cube.parent === group)
    .map(cube => cube.name));
  if (planned.elements.some(element => existingNames.has(element.name))) {
    throw new Error(
      "ADVANCED_GEOMETRY_NATIVE_NAME_EXISTS: inspect current Cube UUIDs instead of replaying a create."
    );
  }
  const executor = getAllToolDefinitions().manage_cubes;
  if (!executor || typeof executor.execute !== "function") {
    throw new Error("ADVANCED_GEOMETRY_NATIVE_EXECUTOR_UNAVAILABLE");
  }
  // The original executor validates Cube schemas, parent identity,
  // Box UV preflight and Undo before performing a single atomic placement.
  // Re-check Project immediately before invoking the serialized executor.
  requireBedrockProject(input);
  const nativeInput = {
    operation: "create" as const,
    group: input.parent_group_uuid,
    faces: true as const,
    elements: planned.elements.map(({ feature_id, instance_id, ...cube }) => cube),
  };
  const validatedNativeInput = executor.parameterSchema.parse(nativeInput);
  const nativeReceipt = await executor.execute(validatedNativeInput);
  // Do not throw after a potentially committed native edit: an unexpected
  // receipt must be reported as uncertain, not retried automatically.
  return {
    status: "NATIVE_CREATE_RETURNED_VISUAL_NOT_EVALUATED" as const,
    project_uuid: input.expected_project_uuid,
    group_uuid: input.parent_group_uuid,
    summary: planned.summary,
    ordered_source_instances: planned.elements.map(element => ({
      feature_id: element.feature_id,
      instance_id: element.instance_id,
      authored_name: element.name,
    })),
    native_receipt: nativeReceipt,
    visual_verdict: "NOT_EVALUATED" as const,
    bedrock_export_verified: false as const,
  };
}
