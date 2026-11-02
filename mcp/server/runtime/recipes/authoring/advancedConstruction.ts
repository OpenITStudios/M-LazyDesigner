/// <reference types="blockbench-types" />

import { createHash } from "node:crypto";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import {
  buildAdvancedGeometryRecipeCandidate,
  reviewStoredAdvancedGeometrySource,
  type AdvancedGeometryFeature,
} from "@/lib/authoringRecipe/geometryComposition";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { requireAdvancedGeometryChangeScope } from "@/lib/authoringRecipe/geometryComposition";
import {
  planIncrementalRecipeRebuild,
  type IncrementalRecipeRebuildPlan,
} from "@/lib/authoringRecipe/incremental";
import { assertAuthoringRecipeNativeMatchesCompiled } from "@/lib/authoringRecipe/nativeState";
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
import {
  readAuthoringRecipeCubeOwnership,
  readAuthoringRecipeStoreProperty,
} from "./ownership";
import {
  advancedGeometryNativeInputSchema,
  advancedGeometryApplyInputSchema,
  advancedGeometryInspectionSchema,
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
const SOURCE_CONTRACT = 2;

export type AdvancedNativeConstructionInput = {
  /** Exact UUID returned by the current Project tool; never inferred. */
  expected_project_uuid: string;
  /** Existing Blockbench Group/Bone UUID; create one using the native tool first. */
  parent_group_uuid: string;
  /** Revise reuses the saved Recipe and preserves unrelated features. */
  mode?: "create" | "revise";
  target_recipe_id?: string;
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

export type AdvancedGeometryImpactSummary = {
  state: "SOURCE_DELTA_NOT_VISUALLY_VERIFIED";
  before_cube_count: number;
  after_cube_count: number;
  created_cube_count: number;
  updated_cube_count: number;
  removed_cube_count: number;
  preserved_cube_count: number;
  metadata_only_cube_count: number;
  affected_cube_count: number;
  affected_feature_ids: string[];
  created_examples: string[];
  updated_examples: string[];
  removed_examples: string[];
  examples_truncated: boolean;
  /** These are invalidations, NOT independent visual/UV/rig PASS findings. */
  invalidates: {
    geometry_structure: true;
    uv_mapping: true;
    texture_appearance: true;
    animation_motion: true;
  };
  visual_verdict: "NOT_EVALUATED";
  reference_content_attested: false;
};

type NativeConstructionPlan = {
  mode: "create" | "revise";
  recipe: AuthoringRecipe;
  previous_recipe: AuthoringRecipe;
  elements: AuthoredCube[];
  removed_instance_ids: string[];
  impact: AdvancedGeometryImpactSummary;
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
  // A UUID must identify exactly one native parent, not merely the first
  // matching Group in an ambiguous scene. Never guess a mutation target.
  const matchingGroups = Group.all.filter(item =>
    item.uuid === input.parent_group_uuid
  );
  if (matchingGroups.length === 0) {
    throw new Error(
      "ADVANCED_GEOMETRY_PARENT_BONE_REQUIRED: inspect or create the exact Group."
    );
  }
  if (matchingGroups.length !== 1) {
    throw new Error("ADVANCED_GEOMETRY_PARENT_UUID_AMBIGUOUS");
  }
  const group = matchingGroups[0]!;
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
  // A scene SHA cannot establish stable identity if multiple native objects
  // claim the same UUID. Fail before planning/applying to the wrong object.
  const groupUuids = Group.all.map(group => group.uuid);
  const cubeUuids = Cube.all.map(cube => cube.uuid);
  if (groupUuids.some(id => typeof id !== "string" || !id.trim()) ||
    cubeUuids.some(id => typeof id !== "string" || !id.trim()) ||
    new Set(groupUuids).size !== groupUuids.length ||
    new Set(cubeUuids).size !== cubeUuids.length) {
    throw new Error("ADVANCED_GEOMETRY_SCENE_UUID_AMBIGUOUS");
  }
  const groupIdentity = (value: unknown) =>
    value instanceof Group ? value.uuid : value === "root" ? "root" : null;
  const groups = Group.all.map(group => {
    // The native parent hierarchy snapshots these authored properties.
    // Include them in the plan revision so UV/rig changes cannot hide
    // behind otherwise identical Group coordinates and identities.
    const authored = group as unknown as {
      mirror_uv?: unknown; reset?: unknown; bedrock_binding?: unknown;
    };
    return {
      uuid: group.uuid,
      name: group.name,
      parent: groupIdentity(group.parent),
      origin: readFiniteVector(group.origin, "Group origin"),
      rotation: readFiniteVector(group.rotation, "Group rotation"),
      visible: group.visibility !== false,
      export: group.export !== false,
      mirror_uv: authored.mirror_uv === true,
      reset: authored.reset === true,
      bedrock_binding: typeof authored.bedrock_binding === "string"
        ? authored.bedrock_binding : null,
    };
  }).sort((a, b) => a.uuid.localeCompare(b.uuid));
  const faces = ["north", "south", "east", "west", "up", "down"] as const;
  const cubes = Cube.all.map(cube => ({
    uuid: cube.uuid,
    // UUID and geometry alone cannot detect a Recipe ownership reassignment.
    ownership: readAuthoringRecipeCubeOwnership(cube),
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
    autouv: cube.autouv ?? null,
    mirror_uv: cube.mirror_uv === true,
    uv_offset: cube.uv_offset ?? null,
    mapped_faces: faces.map(key => {
      const face = cube.faces?.[key];
      return face ? [
        key, face.enabled !== false, face.texture ?? null,
        face.uv ?? null, face.rotation ?? 0,
        face.material_name ?? "",
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

function requireRecipeParentScope(
  recipeId: string,
  parentGroupUuid: string,
  previousRecipe: AuthoringRecipe
): void {
  const native = readBlockbenchAuthoringRecipeOwnedState(recipeId);
  assertAuthoringRecipeNativeMatchesCompiled(native, previousRecipe);
  for (const cube of native.cubes) {
    const path = cube.parent_path;
    if (!Array.isArray(path) || path.at(-1) !== parentGroupUuid) {
      throw new Error(
        "ADVANCED_GEOMETRY_NATIVE_PARENT_CHANGED: Recipe-owned Cube moved outside its original Group."
      );
    }
  }
}

/**
 * Project the exact existing incremental rebuild into one bounded summary
 * suitable for an AI to decide whether to apply the current plan.
 * Counts are derived from Recipe instance identity, not guessed from
 * Cube names, visual similarity or assumed operation success.
 */
function summarizeAdvancedGeometryImpact(
  rebuild: IncrementalRecipeRebuildPlan,
  features: readonly AdvancedGeometryFeature[]
): AdvancedGeometryImpactSummary {
  const byReason = (reason: "ADDED" | "CHANGED" | "REMOVED") =>
    rebuild.reasons.filter(item => item.reason === reason)
      .map(item => item.instance_id);
  const created = byReason("ADDED");
  const updated = byReason("CHANGED");
  const removed = byReason("REMOVED");
  const maxExamples = 8;
  return {
    state: "SOURCE_DELTA_NOT_VISUALLY_VERIFIED",
    before_cube_count: rebuild.metrics.previous_cube_count,
    after_cube_count: rebuild.metrics.next_cube_count,
    created_cube_count: created.length,
    updated_cube_count: updated.length,
    removed_cube_count: removed.length,
    preserved_cube_count: rebuild.metrics.preserved_count,
    metadata_only_cube_count: rebuild.metrics.metadata_only_count,
    affected_cube_count: rebuild.metrics.native_affected_count,
    affected_feature_ids: features.map(feature => feature.id).sort(),
    created_examples: created.slice(0, maxExamples),
    updated_examples: updated.slice(0, maxExamples),
    removed_examples: removed.slice(0, maxExamples),
    examples_truncated:
      created.length > maxExamples || updated.length > maxExamples ||
      removed.length > maxExamples,
    invalidates: {
      geometry_structure: true,
      uv_mapping: true,
      texture_appearance: true,
      animation_motion: true,
    },
    visual_verdict: "NOT_EVALUATED",
    reference_content_attested: false,
  };
}

/**
 * Revisions are feature-scoped: a Recipe can contain many features, but the
 * request must name its exact stored ID and select only existing feature IDs.
 * No semantic-name matching, renaming or cross-owner replacement.
 */
function prepareNativeConstruction(input: AdvancedNativeConstructionInput): NativeConstructionPlan {
  requireBedrockProject(input);
  const mode = input.mode ?? "create";
  const storedDocument = parseAuthoringRecipeStore(
    readAuthoringRecipeStoreProperty(Project)
  );
  let previous_recipe: AuthoringRecipe;
  let features: AdvancedGeometryFeature[];
  if (mode === "revise") {
    const recipeId = input.target_recipe_id;
    if (!recipeId) {
      throw new Error("ADVANCED_GEOMETRY_REVISION_ID_REQUIRED");
    }
    const stored = findAuthoringRecipeInStore(storedDocument, recipeId);
    if (!stored) {
      throw new Error("ADVANCED_GEOMETRY_RECIPE_NOT_STORED: inspect the exact Recipe ID.");
    }
    const sourceReview = reviewStoredAdvancedGeometrySource(stored);
    if (sourceReview.state === "SOURCE_RECIPE_MISMATCH") {
      throw new Error(
        "ADVANCED_GEOMETRY_SAVED_SOURCE_DRIFT: do not revise until the stored parameters and Cube Recipe agree."
      );
    }
    const selected = new Set((stored.feature_intents ?? []).map(feature => feature.id));
    if (input.features.some(feature => !selected.has(feature.id))) {
      throw new Error(
        "ADVANCED_GEOMETRY_REVISION_FEATURE_NOT_OWNED: add new features in a separately planned cohort."
      );
    }
    requireRecipeParentScope(stored.id, input.parent_group_uuid, stored);
    previous_recipe = stored;
    features = input.features.map(feature => ({...feature, replace_generated: true}));
  } else {
    if (input.target_recipe_id !== undefined ||
      input.features.some(feature => feature.replace_generated === true)) {
      throw new Error("ADVANCED_GEOMETRY_CREATE_ONLY: use revise for existing features.");
    }
    const recipeId = "advgeo:" + createHash("sha256").update(JSON.stringify({
      project_uuid: input.expected_project_uuid,
      parent_group_uuid: input.parent_group_uuid,
      features: input.features.map(feature => feature.id).sort(),
    })).digest("hex").slice(0, 48);
    if (findAuthoringRecipeInStore(storedDocument, recipeId)) {
      throw new Error("ADVANCED_GEOMETRY_RECIPE_EXISTS: use revise, never replay create.");
    }
    previous_recipe = {
      schema: 1, compiler_version: 1,
      id: recipeId, name: "Advanced geometry create candidate",
      prototypes: [], patterns: [],
    };
    features = input.features;
  }

  const planned = buildAdvancedGeometryRecipeCandidate(previous_recipe, features);
  if (mode === "revise") {
    requireAdvancedGeometryChangeScope(previous_recipe, planned.next_recipe, features);
  }
  const rebuild = planIncrementalRecipeRebuild(previous_recipe, planned.next_recipe);
  const nativeAffected = rebuild.upserts.length + rebuild.remove_instance_ids.length;
  if (nativeAffected < 1) {
    throw new Error(
      "ADVANCED_GEOMETRY_NO_GEOMETRY_DELTA: an unchanged feature needs no native Undo."
    );
  }
  if (nativeAffected > MAX_SINGLE_NATIVE_BATCH) {
    throw new Error("ADVANCED_GEOMETRY_NATIVE_BATCH_BUDGET: max 64 changed Cubes.");
  }

  if (mode === "revise") {
    // Changing textured/material-bound or manually UV-mapped Geometry
    // without a remap could silently damage Texture or a future visible
    // face. Disabled faces still own authored Texture state; only genuinely
    // untextured, non-manually mapped cohorts may take this revision path.
    const modifiedIds = new Set([
      ...rebuild.upserts.map(placement => placement.id),
      ...rebuild.remove_instance_ids,
    ]);
    const authored = readBlockbenchAuthoringRecipeOwnedState(previous_recipe.id);
    const affectedNativeIds = new Set(authored.cubes
      .filter(cube => modifiedIds.has(cube.instance_id))
      .map(cube => cube.uuid));
    for (const cube of Cube.all ?? []) {
      if (!affectedNativeIds.has(cube.uuid)) continue;
      const faces = cube.faces ?? {};
      const hasOwnedSurface = Object.values(faces).some(face =>
        face && (
          (face.texture !== null && face.texture !== undefined &&
            face.texture !== false) ||
          (face.material_name !== null && face.material_name !== undefined &&
            face.material_name !== "")
        )
      );
      if (hasOwnedSurface || cube.autouv === 0) {
        throw new Error(
          "ADVANCED_GEOMETRY_TEXTURED_REVISION_REQUIRES_UV_REMAP: preserve existing Texture/material/UV ownership; revise before UV/paint."
        );
      }
    }
  }

  const patternOwner = new Map(planned.next_recipe.patterns.map(pattern =>
    [pattern.id, pattern.feature_id] as const
  ));
  const elements: AuthoredCube[] = rebuild.upserts.map(placement => {
    const featureId = patternOwner.get(placement.source_pattern_id);
    if (!featureId) throw new Error("ADVANCED_GEOMETRY_FEATURE_OWNER_UNRESOLVED");
    return {
      name: placement.name,
      from: placement.from, to: placement.to,
      origin: placement.origin, rotation: placement.rotation,
      inflate: placement.inflate,
      feature_id: featureId,
      instance_id: placement.id,
    };
  });
  if (new Set(elements.map(element => element.name)).size !== elements.length) {
    throw new Error("ADVANCED_GEOMETRY_DUPLICATE_NATIVE_NAME");
  }
  return {
    mode,
    recipe: planned.next_recipe,
    previous_recipe,
    elements,
    removed_instance_ids: [...rebuild.remove_instance_ids],
    impact: summarizeAdvancedGeometryImpact(rebuild, features),
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
    mode: prepared.mode,
    features: input.features,
    recipe_id: prepared.recipe.id,
    elements: prepared.elements,
    removed_instance_ids: prepared.removed_instance_ids,
  })).digest("hex");
  return { plan_id, scene_revision };
}

/**
 * AI-first discovery of exact saved Advanced Geometry Recipe identities.
 * Structural matching is not a visual or exporter proof. This returns only
 * selected owner state and the feature IDs needed for a precise revision.
 */
export function inspectAdvancedGeometryNative(input: {
  expected_project_uuid: string;
  target_recipe_id?: string;
}) {
  const request = advancedGeometryInspectionSchema.parse({
    operation: "inspect",
    ...input,
  });
  if (typeof Project === "undefined" || !Project ||
    Project.uuid !== request.expected_project_uuid ||
    typeof Format === "undefined" || Format.id !== "bedrock") {
    throw new Error("ADVANCED_GEOMETRY_INSPECT_PROJECT_MISMATCH");
  }
  if (typeof Undo === "undefined" || Undo.current_save) {
    throw new Error("ADVANCED_GEOMETRY_INSPECT_EDIT_IN_PROGRESS");
  }
  const store = parseAuthoringRecipeStore(readAuthoringRecipeStoreProperty(Project));
  const candidates = store.recipes.filter(recipe =>
    recipe.id.startsWith("advgeo:") &&
    (request.target_recipe_id === undefined ||
     recipe.id === request.target_recipe_id)
  );
  if (request.target_recipe_id !== undefined && candidates.length !== 1) {
    throw new Error("ADVANCED_GEOMETRY_RECIPE_NOT_STORED");
  }
  const recipes = candidates.map(recipe => {
    const native = readBlockbenchAuthoringRecipeOwnedState(recipe.id);
    const parameterReview = reviewStoredAdvancedGeometrySource(recipe);
    // Native/Recipe equality cannot reconstruct missing legacy parameters.
    // Only an actual verified source/Recipe match may claim MATCHED_SOURCE_ONLY.
    let structural_state: "MATCHED_SOURCE_ONLY" | "REVIEW_REQUIRED" =
      parameterReview.state === "AVAILABLE_MATCHED_SOURCE"
        ? "MATCHED_SOURCE_ONLY" : "REVIEW_REQUIRED";
    try {
      assertAuthoringRecipeNativeMatchesCompiled(native, recipe);
      if (native.cubes.length === 0) {
        structural_state = "REVIEW_REQUIRED";
      }
    } catch {
      structural_state = "REVIEW_REQUIRED";
    }
    const parents = [...new Set(native.cubes.map(cube =>
      cube.parent_path?.at(-1) ?? null
    ))];
    const parent_group_uuid = parents.length === 1 && parents[0] !== null
      ? parents[0] : null;
    if (!parent_group_uuid) structural_state = "REVIEW_REQUIRED";
    return {
      recipe_id: recipe.id,
      name: recipe.name,
      feature_ids: (recipe.feature_intents ?? []).map(feature => feature.id),
      feature_labels: (recipe.feature_intents ?? []).map(feature => feature.label),
      source_parameter_state: parameterReview.state,
      // Exact original parametric inputs are provided only when they still
      // reproduce the stored Recipe. AI can revise without asking the user to
      // reconstruct the initial Curve path or hollow wall dimensions.
      source_features: parameterReview.source_features,
      cube_count: native.cubes.length,
      parent_group_uuid,
      structural_state,
      // Matching source and native geometry does not attest visual fidelity.
      visual_verdict: "NOT_EVALUATED" as const,
    };
  });
  return {
    project_uuid: request.expected_project_uuid,
    recipes,
    count: recipes.length,
    operation: "inspect" as const,
    reference_content_attested: false as const,
  };
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
    mode: prepared.mode,
    summary: prepared.summary,
    impact: prepared.impact,
    recipe_id: prepared.recipe.id,
    affected_cubes: prepared.elements,
    remove_instance_ids: prepared.removed_instance_ids,
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
  const projectAtPlan = Project;
  const beforeNative = readBlockbenchAuthoringRecipeOwnedState(prepared.recipe.id);
  if (prepared.mode === "create" && beforeNative.cubes.length !== 0) {
    throw new Error(
      "ADVANCED_GEOMETRY_EXISTING_RECIPE_OWNERSHIP: inspect before constructing."
    );
  }
  const ownedByInstance = new Map(beforeNative.cubes.map(cube =>
    [cube.instance_id, cube.uuid] as const
  ));
  const modifiedOrRemoved = new Set([
    ...prepared.elements.map(element => element.instance_id),
    ...prepared.removed_instance_ids,
  ]);
  const replaceableUuids = new Set([...modifiedOrRemoved]
    .map(id => ownedByInstance.get(id))
    .filter((uuid): uuid is string => typeof uuid === "string"));
  const existingNames = new Set((Cube.all ?? [])
    .filter(cube => cube.parent === group && !replaceableUuids.has(cube.uuid))
    .map(cube => cube.name));
  if (prepared.elements.some(element => existingNames.has(element.name))) {
    throw new Error(
      "ADVANCED_GEOMETRY_NATIVE_NAME_EXISTS: another element owns this name."
    );
  }
  // Reuse the ONE canonical parametric Recipe transaction, including its
  // native Cube identity, scoped Undo and Undo-coherent Project Recipe source.
  // No separate manage_cubes write or after-the-fact metadata stamping.
  const native_receipt = await applyAuthoringRecipeIncrementalAtomic(
    prepared.previous_recipe,
    prepared.recipe,
    fingerprintAuthoringRecipeNativeSnapshot(beforeNative),
    createBlockbenchAuthoringRecipeApplyAdapter(
      prepared.recipe.id, group.uuid,
      () => {
        // Recipe preflights may yield before beginUndo. Recheck in the
        // same synchronous turn immediately preceding native Undo.initEdit.
        // The identical UUID alone cannot prove the Project/Group object
        // was not replaced while the plan was pending.
        if (Project !== projectAtPlan || typeof Group === "undefined" ||
            !Array.isArray(Group.all) || !Group.all.includes(group)) {
          throw new Error("ADVANCED_GEOMETRY_NATIVE_IDENTITY_CHANGED_BEFORE_UNDO");
        }
        if (sceneFingerprint(normalized) !== scene_revision) {
          throw new Error(
            "ADVANCED_GEOMETRY_SCENE_CHANGED_BEFORE_UNDO: inspect current scene and plan again."
          );
        }
      }
    )
  );
  const execution = native_receipt.execution;
  // Never assume that returning a receipt proves visual/Bedrock acceptance.
  return {
    status: execution === "applied"
      ? ("RECIPE_NATIVE_APPLY_REPORTED_VISUAL_UNVERIFIED" as const)
      : ("RECIPE_NATIVE_RESULT_UNCERTAIN_DO_NOT_RETRY" as const),
    mode: prepared.mode,
    project_uuid: input.expected_project_uuid,
    group_uuid: group.uuid,
    source_plan_id: current.plan_id,
    recipe_id: prepared.recipe.id,
    summary: prepared.summary,
    impact: prepared.impact,
    source_instance_order: prepared.elements.map(element => ({
      feature_id: element.feature_id,
      instance_id: element.instance_id,
      authored_name: element.name,
    })),
    removed_instance_ids: prepared.removed_instance_ids,
    native_receipt,
    visual_verdict: "NOT_EVALUATED" as const,
    bedrock_export_verified: false as const,
  };
}
