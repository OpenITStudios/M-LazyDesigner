/// <reference types="blockbench-types" />

import { createHash } from "node:crypto";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import {
  buildAdvancedGeometryRecipeCandidate,
  type AdvancedGeometryFeature,
} from "@/lib/authoringRecipe/geometryComposition";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import {
  applyAuthoringRecipeIncrementalAtomic,
} from "@/lib/authoringRecipe/transaction";
import {
  fingerprintAuthoringRecipeNativeSnapshot,
} from "@/lib/authoringRecipe/nativeState";
import {
  parseAuthoringRecipeStore,
  findAuthoringRecipeInStore,
} from "@/lib/authoringRecipe/store";
import {
  createBlockbenchAuthoringRecipeApplyAdapter,
  readBlockbenchAuthoringRecipeOwnedState,
} from "./runtime";
import { readAuthoringRecipeStoreProperty } from "./ownership";
import {
  advancedGeometryNativeInputSchema,
  advancedGeometryApplyInputSchema,
} from "@/lib/authoringRecipe/geometrySchema";
import { getActiveMcpAuthoringStage } from
  "@/lib/capabilities/authoringStage";

/**
 * Native construction runs through the canonical Authoring Recipe compiler
 * and native Blockbench Undo adapter, including Project Recipe persistence.
 * No second MCP server, Scene registry or parallel mutation engine is created.
 */
const MAX_SINGLE_NATIVE_BATCH = 64;
const MAX_SCENE_CUBES = 4096;
const MAX_SCENE_GROUPS = 1024;
const SOURCE_CONTRACT = 1;

export type AdvancedNativeConstructionInput = {
  /** Exact UUID returned by the current Project tool; never inferred. */
  expected_project_uuid: string;
  /** Existing Blockbench Group/Bone UUID; create one using the native tool first. */
  parent_group_uuid: string;
  features: AdvancedGeometryFeature[];
};

export type AdvancedNativeApplyInput = AdvancedNativeConstructionInput & {
  /** Returned by previewAdvancedGeometryNative for the same feature batch. */
  expected_plan_id: string;
  expected_scene_revision: string;
};

type AuthoredCube = {
  name: string;
  from: [number, number, number];
  to: [number, number, number];
  origin: [number, number, number];
  rotation: [number, number, number];
  inflate: number;
  feature_id: string;
  instance_id: string;
};

type NativeConstructionPlan = {
  recipe: AuthoringRecipe;
  previous_recipe: AuthoringRecipe;
  elements: AuthoredCube[];
  summary: ReturnType<typeof buildAdvancedGeometryRecipeCandidate>["summary"];
};

function requireBedrockProject(input: AdvancedNativeConstructionInput): Group {
  if (typeof Project === "undefined" || !Project ||
    typeof Project.uuid !== "string" ||
    Project.uuid !== input.expected_project_uuid) {
    throw new Error("ADVANCED_GEOMETRY_PROJECT_MISMATCH: inspect the current Project UUID.");
  }
  if (typeof Format === "undefined" || Format?.id !== "bedrock") {
    throw new Error("ADVANCED_GEOMETRY_FORMAT_UNSUPPORTED: Bedrock Entity only.");
  }
  if (typeof Undo === "undefined" || Undo.current_save ||
    !Number.isSafeInteger(Undo.index)) {
    throw new Error("ADVANCED_GEOMETRY_NATIVE_EDIT_IN_PROGRESS");
  }
  if (getActiveMcpAuthoringStage() !== "geometry") {
    throw new Error(
      "ADVANCED_GEOMETRY_STAGE_REQUIRED: switch to the existing Geometry specialist."
    );
  }
  if (typeof Group === "undefined" || !Array.isArray(Group.all)) {
    throw new Error("ADVANCED_GEOMETRY_GROUP_INVENTORY_UNAVAILABLE");
  }
  if (typeof input.parent_group_uuid !== "string" ||
    !input.parent_group_uuid.trim()) {
    throw new Error("ADVANCED_GEOMETRY_EXACT_PARENT_UUID_REQUIRED");
  }
  const group = Group.all.find(item => item.uuid === input.parent_group_uuid);
  if (!group) {
    throw new Error(
      "ADVANCED_GEOMETRY_PARENT_BONE_REQUIRED: inspect or create the exact Group."
    );
  }
  if (group.export === false || group.visibility === false) {
    throw new Error("ADVANCED_GEOMETRY_PARENT_NOT_EXPORTABLE");
  }
  return group;
}

function readFiniteVector(value: readonly number[], label: string): number[] {
  if (!Array.isArray(value) || value.length !== 3 ||
    value.some(v => typeof v !== "number" || !Number.isFinite(v))) {
    throw new Error("ADVANCED_GEOMETRY_NATIVE_SCENE_INVALID: " + label);
  }
  return [...value];
}

function sceneFingerprint(input: AdvancedNativeConstructionInput): string {
  const target = requireBedrockProject(input);
  if (typeof Cube === "undefined" ||
    !Array.isArray(Cube.all) ||
    Cube.all.length > MAX_SCENE_CUBES ||
    Group.all.length > MAX_SCENE_GROUPS) {
    throw new Error("ADVANCED_GEOMETRY_SCENE_INVENTORY_BUDGET");
  }
  const groupIdentity = (value: unknown) =>
    value instanceof Group ? value.uuid : value === "root" ? "root" : null;
  const groups = Group.all.map(group => ({
    uuid: group.uuid,
    name: group.name,
    parent: groupIdentity(group.parent),
    origin: readFiniteVector(group.origin, "Group origin"),
    rotation: readFiniteVector(group.rotation, "Group rotation"),
    visible: group.visibility !== false,
    export: group.export !== false,
  })).sort((a, b) => a.uuid.localeCompare(b.uuid));
  const faces = ["north", "south", "east", "west", "up", "down"] as const;
  const cubes = Cube.all.map(cube => ({
    uuid: cube.uuid,
    name: cube.name,
    parent: groupIdentity(cube.parent),
    from: readFiniteVector(cube.from, "Cube from"),
    to: readFiniteVector(cube.to, "Cube to"),
    origin: readFiniteVector(cube.origin, "Cube origin"),
    rotation: readFiniteVector(cube.rotation, "Cube rotation"),
    inflate: cube.inflate ?? 0,
    visible: cube.visibility !== false,
    export: cube.export !== false,
    box_uv: cube.box_uv === true,
    uv_offset: cube.uv_offset ?? null,
    mapped_faces: faces.map(key => {
      const face = cube.faces?.[key];
      return face ? [
        key, face.enabled !== false, face.texture ?? null,
        face.uv ?? null, face.rotation ?? 0,
      ] : [key, "missing"];
    }),
  })).sort((a, b) => a.uuid.localeCompare(b.uuid));
  const digest = createHash("sha256").update(JSON.stringify({
    contract: SOURCE_CONTRACT,
    project: Project.uuid,
    format: Format.id,
    target: target.uuid,
    recipe_store: readAuthoringRecipeStoreProperty(Project) ?? "",
    box_uv: Project.box_uv,
    texture_width: Project.texture_width,
    texture_height: Project.texture_height,
    undo_index: Undo.index,
    groups, cubes,
  })).digest("hex");
  return "sha256:" + digest;
}

function prepareNativeConstruction(input: AdvancedNativeConstructionInput): NativeConstructionPlan {
  requireBedrockProject(input);
  if (input.features.some(feature => feature.replace_generated === true)) {
    throw new Error(
      "ADVANCED_GEOMETRY_CREATE_ONLY: use a separately verified Recipe revision to replace geometry."
    );
  }
  // A cohort identity depends on the Project, native parent and semantic
  // feature IDs, not their current dimensions. It is stable across revisions.
  const recipe_id = "advgeo:" + createHash("sha256").update(JSON.stringify({
    project_uuid: input.expected_project_uuid,
    parent_group_uuid: input.parent_group_uuid,
    features: input.features.map(feature => feature.id).sort(),
  })).digest("hex").slice(0, 48);
  const storedDocument = parseAuthoringRecipeStore(
    readAuthoringRecipeStoreProperty(Project)
  );
  if (findAuthoringRecipeInStore(storedDocument, recipe_id)) {
    throw new Error(
      "ADVANCED_GEOMETRY_RECIPE_EXISTS: use the existing Recipe revision path, not create."
    );
  }
  const source: AuthoringRecipe = {
    schema: 1, compiler_version: 1,
    id: recipe_id,
    name: "Advanced geometry create candidate",
    prototypes: [], patterns: [],
  };
  const planned = buildAdvancedGeometryRecipeCandidate(source, input.features);
  const compiled = compileAuthoringRecipe(planned.next_recipe);
  if (compiled.placements.length < 1 ||
    compiled.placements.length > MAX_SINGLE_NATIVE_BATCH) {
    throw new Error("ADVANCED_GEOMETRY_NATIVE_BATCH_BUDGET: max 64 new Cubes.");
  }
  const featureByPattern = new Map(
    planned.next_recipe.patterns.map(pattern =>
      [pattern.id, pattern.feature_id] as const
    )
  );
  const elements: AuthoredCube[] = compiled.placements.map(placement => {
    const feature_id = featureByPattern.get(placement.source_pattern_id);
    if (!feature_id) throw new Error("ADVANCED_GEOMETRY_FEATURE_OWNER_UNRESOLVED");
    return {
      name: placement.name,
      from: placement.from, to: placement.to,
      origin: placement.origin, rotation: placement.rotation,
      inflate: placement.inflate,
      feature_id,
      instance_id: placement.id,
    };
  });
  if (new Set(elements.map(element => element.name)).size !== elements.length) {
    throw new Error("ADVANCED_GEOMETRY_DUPLICATE_NATIVE_NAME");
  }
  return {
    recipe: planned.next_recipe,
    previous_recipe: source,
    elements,
    summary: planned.summary,
  };
}

function boundPlan(
  input: AdvancedNativeConstructionInput,
  prepared: NativeConstructionPlan,
  scene_revision: string
) {
  const plan_id = "geometryplan:" + createHash("sha256").update(JSON.stringify({
    version: SOURCE_CONTRACT,
    project_uuid: input.expected_project_uuid,
    parent_group_uuid: input.parent_group_uuid,
    scene_revision,
    features: input.features,
    recipe_id: prepared.recipe.id,
    elements: prepared.elements,
  })).digest("hex");
  return { plan_id, scene_revision };
}

/**
 * Read-only planning. The client retains its own features and the two exact
 * returned handles; no second persistent registry, background job or user UI.
 */
export function previewAdvancedGeometryNative(input: AdvancedNativeConstructionInput) {
  const normalized = advancedGeometryNativeInputSchema.parse(input);
  const prepared = prepareNativeConstruction(normalized);
  const scene_revision = sceneFingerprint(normalized);
  const plan = boundPlan(normalized, prepared, scene_revision);
  return {
    status: "PLAN_READY_NATIVE_NOT_MUTATED" as const,
    project_uuid: input.expected_project_uuid,
    parent_group_uuid: input.parent_group_uuid,
    ...plan,
    summary: prepared.summary,
    recipe_id: prepared.recipe.id,
    cubes: prepared.elements,
    applied: false as const,
    reference_content_attested: false as const,
    visual_verdict: "NOT_EVALUATED" as const,
  };
}

/**
 * Recompute plan and compare a fresh scene snapshot before the only native
 * mutation. Never retry an uncertain committed operation. Existing Recipe
 * compiler, bounded store and native Undo own Cube creation and metadata.
 */
export async function createAdvancedGeometryNative(input: AdvancedNativeApplyInput) {
  const normalized = advancedGeometryApplyInputSchema.parse(input);
  const prepared = prepareNativeConstruction(normalized);
  const scene_revision = sceneFingerprint(normalized);
  const current = boundPlan(normalized, prepared, scene_revision);
  if (typeof input.expected_scene_revision !== "string" ||
    input.expected_scene_revision !== scene_revision ||
    typeof input.expected_plan_id !== "string" ||
    input.expected_plan_id !== current.plan_id) {
    throw new Error(
      "ADVANCED_GEOMETRY_STALE_PLAN: inspect current scene and request a fresh plan."
    );
  }
  const group = requireBedrockProject(input);
  const existingNames = new Set((Cube.all ?? [])
    .filter(cube => cube.parent === group)
    .map(cube => cube.name));
  if (prepared.elements.some(element => existingNames.has(element.name))) {
    throw new Error(
      "ADVANCED_GEOMETRY_NATIVE_NAME_EXISTS: inspect current UUIDs before another create."
    );
  }
  const beforeNative = readBlockbenchAuthoringRecipeOwnedState(prepared.recipe.id);
  if (beforeNative.cubes.length !== 0) {
    throw new Error(
      "ADVANCED_GEOMETRY_EXISTING_RECIPE_OWNERSHIP: inspect before constructing."
    );
  }
  // Reuse the ONE canonical parametric Recipe transaction, including its
  // native Cube identity, scoped Undo and Undo-coherent Project Recipe source.
  // No separate manage_cubes write or after-the-fact metadata stamping.
  const native_receipt = await applyAuthoringRecipeIncrementalAtomic(
    prepared.previous_recipe,
    prepared.recipe,
    fingerprintAuthoringRecipeNativeSnapshot(beforeNative),
    createBlockbenchAuthoringRecipeApplyAdapter(prepared.recipe.id, group.uuid)
  );
  const execution = native_receipt.execution;
  // Never assume that returning a receipt proves visual/Bedrock acceptance.
  return {
    status: execution === "applied"
      ? ("RECIPE_NATIVE_APPLY_REPORTED_VISUAL_UNVERIFIED" as const)
      : ("RECIPE_NATIVE_RESULT_UNCERTAIN_DO_NOT_RETRY" as const),
    project_uuid: input.expected_project_uuid,
    group_uuid: group.uuid,
    source_plan_id: current.plan_id,
    recipe_id: prepared.recipe.id,
    summary: prepared.summary,
    source_instance_order: prepared.elements.map(element => ({
      feature_id: element.feature_id,
      instance_id: element.instance_id,
      authored_name: element.name,
    })),
    native_receipt,
    visual_verdict: "NOT_EVALUATED" as const,
    bedrock_export_verified: false as const,
  };
}
