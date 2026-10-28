import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { planIncrementalRecipeRebuild } from "@/lib/authoringRecipe/incremental";
import {
  assertAuthoringRecipeNativeMatchesCompiled,
  fingerprintAuthoringRecipeNativeSnapshot,
  type AuthoringRecipeNativeSnapshot,
} from "@/lib/authoringRecipe/nativeState";
import {
  applyAuthoringRecipeIncrementalAtomic,
  revertLastAuthoringRecipeApply,
  type AuthoringRecipeApplyAdapter,
} from "@/lib/authoringRecipe/transaction";
import { AuthoringRecipePlanRegistry } from "@/lib/authoringRecipe/planRegistry";
import { resolveSemanticIdentity } from "@/lib/authoringRecipe/semanticIdentity";
import type { SemanticGeometryTarget } from "@/lib/authoringRecipe/semanticEdit";
import { AuthoringEvidenceRegistry, type AuthoringEvidenceHandle } from "@/lib/authoringRecipe/evidenceRegistry";
import { compactAuthoringApplyReceipt, compactSemanticIdentityResolution } from "@/lib/authoringRecipe/compactReceipt";
import {
  planRecipeFeatureRepresentations,
  assessRecipeNativeCoincidence,
  selectRecipeRebuildExecutionStrategy,
  summarizeAuthoringRecipeRebuild,
} from "@/lib/authoringRecipe/planning";

export {
  chooseBoundedGeometryCorrection,
  assessRecipeFeatureOptimization,
  assessRecipeNativeCoincidence,
  composeReusableAuthoringAssets,
  evaluateSemanticGeometryStack,
  planReferenceGeometryCorrections,
  planSemanticGeometryEdit,
  planRecipeFeatureRepresentations,
  rewriteSemanticGeometryRecipe,
  summarizeAuthoringRecipeRebuild,
} from "@/lib/authoringRecipe/planning";

export type AuthoringRecipeServiceDependencies = {
  readOwned(recipeId: string): Promise<AuthoringRecipeNativeSnapshot> | AuthoringRecipeNativeSnapshot;
  readStoredRecipe?(recipeId: string): Promise<AuthoringRecipe | null> | AuthoringRecipe | null;
  createApplyAdapter(recipeId: string): AuthoringRecipeApplyAdapter;
};
export function createAuthoringRecipeService(
  dependencies: AuthoringRecipeServiceDependencies,
  registry = new AuthoringRecipePlanRegistry(),
  evidenceRegistry = new AuthoringEvidenceRegistry()
) {
  const planPair = async (previousRecipe: AuthoringRecipe, nextRecipe: AuthoringRecipe) => {
    if (previousRecipe.id !== nextRecipe.id) throw new Error("Parametric authoring plan requires stable recipe identity.");
    const native = await dependencies.readOwned(previousRecipe.id);
    assertAuthoringRecipeNativeMatchesCompiled(native, previousRecipe);
    const nativeFingerprint = fingerprintAuthoringRecipeNativeSnapshot(native);
    const rebuild = planIncrementalRecipeRebuild(previousRecipe, nextRecipe);
    const featurePlan = nextRecipe.feature_intents !== undefined
      ? planRecipeFeatureRepresentations(nextRecipe.feature_intents).summary
      : undefined;
    const stored = registry.put({ native_source_fingerprint: nativeFingerprint, previous_recipe: previousRecipe, next_recipe: nextRecipe, rebuild });
    return {
      plan_id: stored.plan_id,
      native_source_fingerprint: nativeFingerprint,
      execution_strategy: selectRecipeRebuildExecutionStrategy(rebuild),
      summary: summarizeAuthoringRecipeRebuild(rebuild),
      ...(featurePlan ? { feature_plan: featurePlan } : {}),
    };
  };
  return {
    plan: planPair,
    async planStored(nextRecipe: AuthoringRecipe) {
      if (!dependencies.readStoredRecipe) throw new Error("RECIPE_STORE_UNAVAILABLE: Runtime did not provide project recipe persistence.");
      const previousRecipe = await dependencies.readStoredRecipe(nextRecipe.id);
      if (!previousRecipe) throw new Error("RECIPE_NOT_STORED: no previous recipe source exists for " + nextRecipe.id + "; use explicit previous/next planning for first adoption.");
      return planPair(previousRecipe, nextRecipe);
    },
    /**
     * Read-only native coincidence scan. Requires current saved Recipe and
     * the same native owned-snapshot reader as ordinary Recipe planning.
     * Does not create an MCP route, start Undo or modify an asset.
     */
    async inspectStoredGeometryCoincidence(input: { recipe_id: string }) {
      if (!dependencies.readStoredRecipe) {
        throw new Error("RECIPE_STORE_UNAVAILABLE: native Geometry inspection requires saved Recipe ownership.");
      }
      const recipe = await dependencies.readStoredRecipe(input.recipe_id);
      if (!recipe) {
        throw new Error("RECIPE_NOT_STORED: no saved Recipe exists for " + input.recipe_id + ".");
      }
      const native = await dependencies.readOwned(input.recipe_id);
      return assessRecipeNativeCoincidence(recipe, native);
    },
    async resolveIdentity(input: { recipe_id: string; target: SemanticGeometryTarget }) {
      if (!dependencies.readStoredRecipe) {
        throw new Error("RECIPE_STORE_UNAVAILABLE: Runtime did not provide project recipe persistence.");
      }
      const recipe = await dependencies.readStoredRecipe(input.recipe_id);
      if (!recipe) {
        throw new Error("RECIPE_NOT_STORED: no recipe source exists for " + input.recipe_id + ".");
      }
      const native = await dependencies.readOwned(input.recipe_id);
      return resolveSemanticIdentity(recipe, native, input.target);
    },
    async resolveIdentityCompact(input: { recipe_id: string; target: SemanticGeometryTarget }) {
      if (!dependencies.readStoredRecipe) {
        throw new Error("RECIPE_STORE_UNAVAILABLE: Runtime did not provide project recipe persistence.");
      }
      const recipe = await dependencies.readStoredRecipe(input.recipe_id);
      if (!recipe) {
        throw new Error("RECIPE_NOT_STORED: no recipe source exists for " + input.recipe_id + ".");
      }
      const native = await dependencies.readOwned(input.recipe_id);
      const resolution = resolveSemanticIdentity(recipe, native, input.target);
      const handle = evidenceRegistry.put({ kind: "SEMANTIC_IDENTITY", value: resolution });
      return compactSemanticIdentityResolution(resolution, handle);
    },
    readEvidence(handle: AuthoringEvidenceHandle) {
      return evidenceRegistry.get(handle);
    },
    /**
     * Explicit, receipt-scoped recovery only. Uses the same bounded authoring
     * evidence registry already populated by applyCompact; never searches
     * Blockbench Undo history by recipe name.
     */
    async revertApplied(input: {
      evidence_handle: AuthoringEvidenceHandle;
      expected_native_source_fingerprint_after: string;
    }) {
      const recorded = evidenceRegistry.get(input.evidence_handle);
      if (recorded.kind !== "APPLY_RECEIPT") {
        throw new Error("RECIPE_POSTCOMMIT_RECEIPT_REQUIRED: use an exact apply evidence handle.");
      }
      return revertLastAuthoringRecipeApply(
        recorded.value,
        input.expected_native_source_fingerprint_after,
        dependencies.createApplyAdapter(recorded.value.recipe_id)
      );
    },
    async apply(input: { plan_id: string; expected_native_source_fingerprint: string }) {
      const stored = registry.get(input.plan_id);
      if (stored.native_source_fingerprint !== input.expected_native_source_fingerprint) throw new Error("STALE_RECIPE_PLAN: supplied native fingerprint does not match the stored plan.");
      return applyAuthoringRecipeIncrementalAtomic(stored.previous_recipe, stored.next_recipe, stored.native_source_fingerprint, dependencies.createApplyAdapter(stored.next_recipe.id));
    },
    async applyCompact(input: { plan_id: string; expected_native_source_fingerprint: string }) {
      const stored = registry.get(input.plan_id);
      if (stored.native_source_fingerprint !== input.expected_native_source_fingerprint) {
        throw new Error("STALE_RECIPE_PLAN: supplied native fingerprint does not match the stored plan.");
      }
      const receipt = await applyAuthoringRecipeIncrementalAtomic(
        stored.previous_recipe,
        stored.next_recipe,
        stored.native_source_fingerprint,
        dependencies.createApplyAdapter(stored.next_recipe.id)
      );
      const handle = evidenceRegistry.put({ kind: "APPLY_RECEIPT", value: receipt });
      return compactAuthoringApplyReceipt(receipt, handle);
    },
    registrySize() { return registry.size(); },
    evidenceRegistrySize() { return evidenceRegistry.size(); },
  };
}