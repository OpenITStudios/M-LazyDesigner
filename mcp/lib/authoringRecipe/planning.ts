import type { AuthoringRecipe, RecipeFeatureIntent } from "@/lib/authoringRecipe/contracts";
import { assessCompiledRecipeFeatureOptimization } from "@/lib/authoringRecipe/featureDecision";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import {
  assertAuthoringRecipeNativeMatchesCompiled,
  fingerprintAuthoringRecipeNativeSnapshot,
  type AuthoringRecipeNativeSnapshot,
  type RecipeParentAuthoredState,
} from "@/lib/authoringRecipe/nativeState";
import { planIncrementalRecipeRebuild } from "@/lib/authoringRecipe/incremental";
import {
  compileSemanticGeometryEdit,
  type SemanticGeometryEditIntent,
} from "@/lib/authoringRecipe/semanticEdit";
import { rewriteAuthoringRecipeForSemanticEdit } from "@/lib/authoringRecipe/semanticRewrite";
import {
  evaluateSemanticOperationStack,
  type SemanticOperationStack,
} from "@/lib/authoringRecipe/operationStack";
import {
  instantiateAuthoringAssets,
  type AuthoringAssetDefinition,
  type AuthoringAssetInstance,
} from "@/lib/authoringRecipe/assets";
import {
  compileReferenceCorrectionsToGeometryIntents,
  deriveReferenceCorrectionVectors,
  type ReferenceDeviation,
} from "@/lib/reference/correction";
import {
  selectLowestCostCorrection,
  type CorrectionCandidate,
  type CorrectionSolverOptions,
} from "@/lib/reference/correctionSolver";

export { planRecipeFeatureRepresentations } from "@/lib/authoringRecipe/featureDecision";

const EXAMPLE_LIMIT = 12;

function bounded(values: readonly string[]) {
  return {
    count: values.length,
    examples: values.slice(0, EXAMPLE_LIMIT),
    examples_truncated: values.length > EXAMPLE_LIMIT,
  };
}

/** Read-only compiled Recipe geometry-to-texture/omit candidate analysis. */
export function assessRecipeFeatureOptimization(
  recipe: AuthoringRecipe,
  proposedFeatures: readonly RecipeFeatureIntent[]
) {
  return assessCompiledRecipeFeatureOptimization(
    recipe, compileAuthoringRecipe(recipe), proposedFeatures
  );
}

/**
 * Read-only exact authored-geometry coincidence report, scoped to a saved
 * Recipe's verified native Cube inventory. This deliberately does NOT infer
 * duplicates from Recipe coordinates alone: identical local coordinates under
 * distinct Bones have different world transforms. Even same-parent geometry
 * may use different UVs, textures, visibility, animation or render materials.
 */
export function assessRecipeNativeCoincidence(
  recipe: AuthoringRecipe,
  native: AuthoringRecipeNativeSnapshot
) {
  assertAuthoringRecipeNativeMatchesCompiled(native, recipe);
  const nativeUuidSet = new Set<string>();
  const ancestorStates = new Map<string, string>();
  const sameShape = new Map<string, typeof native.cubes>();

  for (const cube of native.cubes) {
    if (typeof cube.uuid !== "string" || !cube.uuid.trim() ||
        cube.uuid !== cube.uuid.trim() || nativeUuidSet.has(cube.uuid)) {
      throw new Error("RECIPE_OPTIMIZATION_NATIVE_UUID_AMBIGUOUS");
    }
    nativeUuidSet.add(cube.uuid);
    const path = cube.parent_path;
    const parents = cube.parent_authored_state;
    if (!Array.isArray(path) || !Array.isArray(parents) ||
        path.length !== parents.length || path.length > 64 ||
        new Set(path).size !== path.length ||
        path.some(value => typeof value !== "string" ||
          !value.trim() || value !== value.trim())) {
      throw new Error("RECIPE_OPTIMIZATION_PARENT_EVIDENCE_REQUIRED");
    }
    for (const [index, group] of parents.entries()) {
      if (!group || group.uuid !== path[index] ||
          typeof group.name !== "string" || !group.name.trim() ||
          !Array.isArray(group.origin) || group.origin.length !== 3 ||
          !Array.isArray(group.rotation) || group.rotation.length !== 3 ||
          [...group.origin, ...group.rotation].some(value => !Number.isFinite(value)) ||
          !["visibility", "export", "mirror_uv", "reset"].every(
            field => typeof group[field as keyof RecipeParentAuthoredState] === "boolean"
          ) ||
          !(group.bedrock_binding === null || typeof group.bedrock_binding === "string")) {
        throw new Error("RECIPE_OPTIMIZATION_PARENT_EVIDENCE_REQUIRED");
      }
      const identity = JSON.stringify([
        path.slice(0, index + 1), parents.slice(0, index + 1),
      ]);
      const previous = ancestorStates.get(group.uuid);
      if (previous !== undefined && previous !== identity) {
        throw new Error("RECIPE_OPTIMIZATION_PARENT_STATE_CONFLICT");
      }
      ancestorStates.set(group.uuid, identity);
    }
    const identity = JSON.stringify([
      path, cube.from, cube.to, cube.origin, cube.rotation, cube.inflate,
    ]);
    const peers = sameShape.get(identity) ?? [];
    peers.push(cube);
    sameShape.set(identity, peers);
  }

  const constraintsByInstance = new Map<string, Set<string>>();
  const symmetryByInstance = new Map<string, Set<string>>();
  const link = (index: Map<string, Set<string>>, id: string, relationId: string) => {
    const list = index.get(id) ?? new Set<string>();
    list.add(relationId);
    index.set(id, list);
  };
  for (const constraint of recipe.constraints ?? []) {
    link(constraintsByInstance, constraint.source_instance_id, constraint.id);
    link(constraintsByInstance, constraint.target_instance_id, constraint.id);
  }
  for (const relation of recipe.symmetry ?? []) {
    link(symmetryByInstance, relation.source_instance_id, relation.id);
    link(symmetryByInstance, relation.target_instance_id, relation.id);
  }

  const candidates = [...sameShape.values()]
    .filter(group => group.length > 1)
    .map(group => {
      const ordered = [...group].sort((a, b) => a.instance_id.localeCompare(b.instance_id));
      const anchorIds = [...new Set(ordered.flatMap(cube =>
        [...(constraintsByInstance.get(cube.instance_id) ?? [])]
      ))].sort();
      const symmetryIds = [...new Set(ordered.flatMap(cube =>
        [...(symmetryByInstance.get(cube.instance_id) ?? [])]
      ))].sort();
      return {
        group_size: ordered.length,
        parent_path: [...ordered[0].parent_path!],
        instance_id_examples: ordered.slice(0, 8).map(cube => cube.instance_id),
        native_uuid_examples: ordered.slice(0, 8).map(cube => cube.uuid),
        examples_truncated: ordered.length > 8,
        anchor_constraint_count: anchorIds.length,
        anchor_constraint_examples: anchorIds.slice(0, 8),
        symmetry_relation_count: symmetryIds.length,
        symmetry_relation_examples: symmetryIds.slice(0, 8),
        relation_examples_truncated: anchorIds.length > 8 || symmetryIds.length > 8,
        safe_to_delete: false as const,
      };
    })
    .sort((a, b) => a.instance_id_examples[0]!.localeCompare(b.instance_id_examples[0]!));

  return {
    state: "REVIEW_ONLY" as const,
    scope: "EXACT_RECIPE_OWNED_NATIVE_AUTHORED_GEOMETRY" as const,
    native_snapshot_fingerprint: fingerprintAuthoringRecipeNativeSnapshot(native),
    inspected_native_cube_count: native.cubes.length,
    coincident_group_count: candidates.length,
    coincident_native_cube_count: candidates.reduce((sum, c) => sum + c.group_size, 0),
    candidate_examples: candidates.slice(0, 8),
    candidate_examples_truncated: candidates.length > 8,
    estimated_removable_cube_count: null,
    native_mutation_executed: false as const,
    visual_verdict: "NOT_EVALUATED" as const,
    note: "Exact Recipe-owned authored Cube transforms and full native parent state matched. " +
      "UV/texture/material, per-Cube visibility, animation binding, unrelated geometry, " +
      "rendered overlap and Bedrock export remain UNVERIFIED. These are review candidates only.",
  };
}

export function summarizeAuthoringRecipeRebuild(
  rebuild: ReturnType<typeof planIncrementalRecipeRebuild>
) {
  return {
    previous_cube_count: rebuild.metrics.previous_cube_count,
    next_cube_count: rebuild.metrics.next_cube_count,
    native_affected_count: rebuild.metrics.native_affected_count,
    native_affected_ratio_of_next: rebuild.metrics.native_affected_ratio_of_next,
    recipe_affected_count: rebuild.metrics.affected_count,
    upserts: bounded(rebuild.upserts.map((placement) => placement.id)),
    removals: bounded(rebuild.remove_instance_ids),
    metadata_only: bounded(rebuild.metadata_only_instance_ids),
    symmetry_changes: bounded(rebuild.symmetry_changed_relation_ids),
    preserved_count: rebuild.preserved_instance_ids.length,
    semantic_invalidation: { ...rebuild.semantic_invalidation },
  };
}

export function planSemanticGeometryEdit(
  recipe: AuthoringRecipe,
  intent: SemanticGeometryEditIntent
) {
  return compileSemanticGeometryEdit(compileAuthoringRecipe(recipe), intent);
}

export function rewriteSemanticGeometryRecipe(
  recipe: AuthoringRecipe,
  intent: SemanticGeometryEditIntent
) {
  const nextRecipe = rewriteAuthoringRecipeForSemanticEdit(recipe, intent);
  return {
    next_recipe: nextRecipe,
    rebuild: planIncrementalRecipeRebuild(recipe, nextRecipe),
  };
}

export function evaluateSemanticGeometryStack(
  recipe: AuthoringRecipe,
  stack: SemanticOperationStack
) {
  return evaluateSemanticOperationStack(recipe, stack);
}

export function composeReusableAuthoringAssets(
  root: Pick<AuthoringRecipe, "schema" | "compiler_version" | "id" | "name">,
  definitions: readonly AuthoringAssetDefinition[],
  instances: readonly AuthoringAssetInstance[]
) {
  return instantiateAuthoringAssets(root, definitions, instances);
}

export function planReferenceGeometryCorrections(
  recipe: AuthoringRecipe,
  deviations: readonly ReferenceDeviation[]
) {
  const compiled = compileAuthoringRecipe(recipe);
  const corrections = deriveReferenceCorrectionVectors(deviations);
  const intents = compileReferenceCorrectionsToGeometryIntents(corrections);
  const plans = intents.map((intent) =>
    compileSemanticGeometryEdit(compiled, intent)
  );
  return { corrections, intents, plans };
}

export function chooseBoundedGeometryCorrection<T>(
  candidates: readonly CorrectionCandidate<T>[],
  options?: CorrectionSolverOptions
) {
  return selectLowestCostCorrection(candidates, options);
}


export function selectRecipeRebuildExecutionStrategy(
  rebuild: ReturnType<typeof planIncrementalRecipeRebuild>
) {
  const affected = rebuild.metrics.native_affected_count;
  const ratio = rebuild.metrics.native_affected_ratio_of_next;

  if (affected > 0) {
    return {
      strategy: "RECIPE" as const,
      affected_native_instances: affected,
      affected_ratio: ratio,
      reason: "RECIPE_OWNED_INCREMENTAL" as const,
    };
  }

  if (
    rebuild.metrics.metadata_only_count > 0 ||
    rebuild.metrics.symmetry_change_count > 0
  ) {
    return {
      strategy: "METADATA_ONLY" as const,
      affected_native_instances: 0,
      affected_ratio: 0,
      reason: "SEMANTIC_METADATA_ONLY" as const,
    };
  }

  return {
    strategy: "UNCHANGED" as const,
    affected_native_instances: 0,
    affected_ratio: 0,
    reason: "NO_CHANGE" as const,
  };
}
