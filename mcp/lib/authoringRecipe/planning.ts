import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
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
