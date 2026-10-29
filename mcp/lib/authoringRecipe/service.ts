import { createHash } from "node:crypto";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import type { KnowledgeIndexSnapshot } from "@/lib/semantic/knowledge";
import { collectRecipeKnowledge, featureIdForRecipeInstance } from "@/lib/authoringRecipe/knowledgePlanning";
import { planIncrementalRecipeRebuild } from "@/lib/authoringRecipe/incremental";
import {
  assertAuthoringRecipeNativeMatchesCompiled,
  fingerprintAuthoringRecipeNativeSnapshot,
  type AuthoringRecipeNativeSnapshot,
  type RecipeNativeSurfaceSnapshot,
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
  fingerprintRecipeRiskReviewScope,
  type RecipeOptimizationReviewSourceIdentity,
  type RecipeRiskReviewEvidenceReference,
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
export { prepareKnowledgeAwareRecipe } from "@/lib/authoringRecipe/knowledgePlanning";
export { suggestRecipeKnowledge } from "@/lib/authoringRecipe/knowledgeSelection";
export { bindRecipeKnowledge, resolveRecipeKnowledgeLinks } from "@/lib/authoringRecipe/knowledge";

export type AuthoringRecipeServiceDependencies = {
  readOwned(recipeId: string): Promise<AuthoringRecipeNativeSnapshot> | AuthoringRecipeNativeSnapshot;
  readStoredRecipe?(recipeId: string): Promise<AuthoringRecipe | null> | AuthoringRecipe | null;
  /** Lazy advisory source; never read by ordinary native authoring operations. */
  readKnowledgeIndex?(): Promise<KnowledgeIndexSnapshot | null> | KnowledgeIndexSnapshot | null;
  createApplyAdapter(recipeId: string): AuthoringRecipeApplyAdapter;
  /** Opt-in native visual-surface read, entirely separate from Undo state. */
  readCoincidenceSurface?(
    recipeId: string,
    native: AuthoringRecipeNativeSnapshot
  ): Promise<RecipeNativeSurfaceSnapshot> | RecipeNativeSurfaceSnapshot;
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
    const recipeKnowledge = await collectRecipeKnowledge(nextRecipe, dependencies.readKnowledgeIndex);
    const stored = registry.put({ native_source_fingerprint: nativeFingerprint, previous_recipe: previousRecipe, next_recipe: nextRecipe, rebuild });
    return {
      plan_id: stored.plan_id,
      native_source_fingerprint: nativeFingerprint,
      execution_strategy: selectRecipeRebuildExecutionStrategy(rebuild),
      summary: summarizeAuthoringRecipeRebuild(rebuild),
      ...(featurePlan ? { feature_plan: featurePlan } : {}),
      ...(recipeKnowledge ? { recipe_knowledge: recipeKnowledge } : {}),
    };
  };

  /**
   * The saved Recipe itself is a review dependency: ANCHOR, symmetry and
   * feature metadata can change without any native Cube fingerprint change.
   * Re-read it after the opt-in UV/material/animation capture.
   */
  const inspectStoredGeometryCoincidence = async (input: {
    recipe_id: string; selected_instance_id?: string;
  }) => {
    if (!dependencies.readStoredRecipe) {
      throw new Error("RECIPE_STORE_UNAVAILABLE: native Geometry inspection requires saved Recipe ownership.");
    }
    const stored = await dependencies.readStoredRecipe(input.recipe_id);
    if (!stored) {
      throw new Error("RECIPE_NOT_STORED: no saved Recipe exists for " + input.recipe_id + ".");
    }
    const recipe = structuredClone(stored);
    const native = structuredClone(await dependencies.readOwned(input.recipe_id));
    assertAuthoringRecipeNativeMatchesCompiled(native, recipe);
    const provided = dependencies.readCoincidenceSurface
      ? await dependencies.readCoincidenceSurface(input.recipe_id, native)
      : undefined;
    const surface = provided ? structuredClone(provided) : undefined;
    if (input.selected_instance_id !== undefined &&
        !native.cubes.some(cube => cube.instance_id === input.selected_instance_id)) {
      throw new Error("RECIPE_KNOWLEDGE_SELECTED_INSTANCE_NOT_OWNED");
    }
    const selectedFeature = input.selected_instance_id !== undefined &&
      (recipe.feature_intents?.length ?? 0) > 0
      ? featureIdForRecipeInstance(recipe, input.selected_instance_id)
      : undefined;
    const recipeKnowledge = await collectRecipeKnowledge(
      recipe, dependencies.readKnowledgeIndex,
      input.selected_instance_id !== undefined
        ? (selectedFeature ? [selectedFeature] : [])
        : undefined
    );
    // The owned native source must be stable for BOTH opt-in surfaces and
    // source-only callers. A missing UV/material snapshot is not permission
    // to return a stale Geometry/parent baseline without re-reading it.
    const currentNative = await dependencies.readOwned(input.recipe_id);
    if (fingerprintAuthoringRecipeNativeSnapshot(currentNative) !==
        fingerprintAuthoringRecipeNativeSnapshot(native)) {
      throw new Error("RECIPE_OPTIMIZATION_NATIVE_CHANGED_DURING_INSPECTION");
    }
    const report = assessRecipeNativeCoincidence(recipe, native, surface);
    const reread = await dependencies.readStoredRecipe(input.recipe_id);
    if (!reread || ("sha256:" + createHash("sha256")
      .update(JSON.stringify(reread)).digest("hex")) !==
        report.review_source_identity.recipe_source_fingerprint) {
      throw new Error("RECIPE_OPTIMIZATION_RECIPE_CHANGED_DURING_INSPECTION");
    }
    return {
      ...report,
      ...(recipeKnowledge ? { recipe_knowledge: recipeKnowledge } : {}),
    };
  };

  /**
   * Compare a caller-supplied prior report identity to a NEW read from the
   * same existing Recipe Service. This validates only source freshness and
   * source-field completeness, not native review execution or visual PASS.
   * Unknown/malformed baselines fail closed; no receipt store is created.
   */
  const checkStoredGeometryOptimizationReviewFreshness = async (input: {
    recipe_id: string;
    expected_review_source_identity: RecipeOptimizationReviewSourceIdentity;
  }) => {
    const expected = input.expected_review_source_identity;
    const sha = /^sha256:[a-f0-9]{64}$/;
    const fingerprintFields = [
      expected?.recipe_source_fingerprint,
      expected?.native_source_fingerprint,
      expected?.review_plan_fingerprint,
      expected?.source_binding_fingerprint,
    ];
    const fields = {
      schema: 1 as const,
      recipe_id: expected?.recipe_id,
      recipe_source_fingerprint: expected?.recipe_source_fingerprint,
      native_source_fingerprint: expected?.native_source_fingerprint,
      surface_source_fingerprint: expected?.surface_source_fingerprint,
      project_uuid: expected?.project_uuid,
      review_plan_fingerprint: expected?.review_plan_fingerprint,
    };
    const bound = "sha256:" + createHash("sha256")
      .update(JSON.stringify(fields)).digest("hex");
    if (!expected || expected.schema !== 1 ||
        typeof input.recipe_id !== "string" || !input.recipe_id.trim() ||
        expected.recipe_id !== input.recipe_id ||
        fingerprintFields.some(value => typeof value !== "string" || !sha.test(value)) ||
        !(expected.surface_source_fingerprint === null ||
          typeof expected.surface_source_fingerprint === "string" &&
          sha.test(expected.surface_source_fingerprint)) ||
        !(expected.project_uuid === null ||
          typeof expected.project_uuid === "string" &&
          expected.project_uuid.trim().length > 0 &&
          expected.project_uuid === expected.project_uuid.trim()) ||
        (expected.project_uuid === null) !== (expected.surface_source_fingerprint === null) ||
        expected.source_binding_fingerprint !== bound) {
      throw new Error(
        "RECIPE_OPTIMIZATION_REVIEW_BASELINE_INVALID: supply the complete prior source identity."
      );
    }
    const current = await inspectStoredGeometryCoincidence({
      recipe_id: input.recipe_id,
    });
    const actual = current.review_source_identity;
    const changed_source_parts: Array<
      "RECIPE" | "NATIVE_GEOMETRY" | "UV_MATERIAL_ANIMATION" | "PROJECT" | "REVIEW_PLAN"
    > = [];
    if (expected.recipe_source_fingerprint !== actual.recipe_source_fingerprint) {
      changed_source_parts.push("RECIPE");
    }
    if (expected.native_source_fingerprint !== actual.native_source_fingerprint) {
      changed_source_parts.push("NATIVE_GEOMETRY");
    }
    if (expected.surface_source_fingerprint !== actual.surface_source_fingerprint) {
      changed_source_parts.push("UV_MATERIAL_ANIMATION");
    }
    if (expected.project_uuid !== actual.project_uuid) {
      changed_source_parts.push("PROJECT");
    }
    if (expected.review_plan_fingerprint !== actual.review_plan_fingerprint) {
      changed_source_parts.push("REVIEW_PLAN");
    }
    const complete = actual.surface_source_fingerprint !== null &&
      current.optimization_review_plan.source_readiness.state !== "SOURCE_INCOMPLETE";
    return {
      state: changed_source_parts.length
        ? ("SOURCE_STALE" as const)
        : complete
          ? ("SOURCE_CURRENT" as const)
          : ("SOURCE_INCOMPLETE" as const),
      comparison_scope: "CALLER_SUPPLIED_REVIEW_SOURCE_DRIFT_ONLY" as const,
      changed_source_parts,
      current_review_source_identity: actual,
      current_review_plan: current.optimization_review_plan,
      native_verification_executed: false as const,
      visual_verdict: "NOT_EVALUATED" as const,
      native_mutation_authorized: false as const,
    };
  };


  /**
   * Issue bounded same-service source observations only for saved Recipe
   * Anchor/Symmetry dependencies. The canonical stored-Recipe reader is
   * available here; independent UV/material/animation/visual review receipts
   * are not. Source observation is NEVER review approval.
   */
  const captureStoredRecipeOptimizationSourceObservations = async (input: {
    recipe_id: string;
    expected_review_source_identity: RecipeOptimizationReviewSourceIdentity;
  }) => {
    const freshness = await checkStoredGeometryOptimizationReviewFreshness(input);
    if (freshness.state === "SOURCE_STALE") {
      throw new Error(
        "RECIPE_OPTIMIZATION_REVIEW_SOURCE_STALE: re-inspect current Recipe before issuing observations."
      );
    }
    const ownerBatches = freshness.current_review_plan.batches.filter(batch =>
      batch.evidence_owner === "SAVED_RECIPE" &&
      (batch.check_id === "RECIPE_ANCHOR_RELATION" ||
       batch.check_id === "RECIPE_SYMMETRY_RELATION") &&
      batch.source_readiness === "SOURCE_FIELDS_PRESENT"
    );
    // Avoid partial issuance and never displace pending Apply/identity
    // evidence from the shared bounded registry.
    evidenceRegistry.assertCanAddReviewSourceObservations(ownerBatches.length);
    const observations = ownerBatches.map(batch => {
      if (batch.check_id !== "RECIPE_ANCHOR_RELATION" &&
          batch.check_id !== "RECIPE_SYMMETRY_RELATION") {
        throw new Error("RECIPE_OPTIMIZATION_REVIEW_OWNER_INVALID");
      }
      return {
        check_id: batch.check_id,
        evidence_owner: "SAVED_RECIPE" as const,
        full_scope_fingerprint: batch.full_scope_fingerprint,
        evidence_handle: evidenceRegistry.put({
          kind: "RECIPE_REVIEW_SOURCE_OBSERVATION",
          value: {
            recipe_id: input.recipe_id,
            check_id: batch.check_id,
            evidence_owner: "SAVED_RECIPE" as const,
            source_binding_fingerprint:
              freshness.current_review_source_identity.source_binding_fingerprint,
            full_scope_fingerprint: batch.full_scope_fingerprint,
            source_observation: "SAVED_RECIPE_CURRENT_SOURCE_ONLY" as const,
          },
        }),
      };
    });
    return {
      state: observations.length
        ? ("RECIPE_SOURCE_OBSERVATIONS_CAPTURED" as const)
        : ("NO_SAVED_RECIPE_OWNER_CHECKS" as const),
      source_freshness_state: freshness.state,
      source_binding_fingerprint:
        freshness.current_review_source_identity.source_binding_fingerprint,
      observations,
      source_observation_count: observations.length,
      source_observation_only: true as const,
      independent_owner_review_executed: false as const,
      owner_visual_verified: false as const,
      native_mutation_authorized: false as const,
    };
  };

  /**
   * Match caller-supplied review references to the exact NEW owner review
   * plan only after re-reading and comparing its full source identity.
   *
   * A matching opaque reference is NOT verified owner evidence: this service
   * has no authenticated UV/material/animation/visual receipt resolver.
   * Thus no caller-provided "PASS" or link can clear a risk or authorize Apply.
   */
  const reconcileStoredGeometryOptimizationReviewEvidence = async (input: {
    recipe_id: string;
    expected_review_source_identity: RecipeOptimizationReviewSourceIdentity;
    references: readonly RecipeRiskReviewEvidenceReference[];
  }) => {
    if (!Array.isArray(input?.references) || input.references.length > 6) {
      throw new Error("RECIPE_OPTIMIZATION_REVIEW_REFERENCES_INVALID");
    }
    const references = new Map<string, {
      claim: RecipeRiskReviewEvidenceReference;
      full_scope_fingerprint: string;
    }>();
    const sha = /^sha256:[a-f0-9]{64}$/;
    for (const claim of input.references) {
      if (!claim || typeof claim.check_id !== "string" ||
          references.has(claim.check_id) ||
          typeof claim.evidence_owner !== "string" ||
          typeof claim.source_binding_fingerprint !== "string" ||
          !sha.test(claim.source_binding_fingerprint) ||
          typeof claim.evidence_ref !== "string" ||
          claim.evidence_ref.length < 1 || claim.evidence_ref.length > 160 ||
          claim.evidence_ref !== claim.evidence_ref.trim() ||
          !(claim.owner_source_observation_handle === undefined ||
            /^authoringevidence:[a-f0-9]{64}$/.test(
              claim.owner_source_observation_handle
            )) ||
          claim.full_scope?.check_id !== claim.check_id ||
          claim.full_scope?.evidence_owner !== claim.evidence_owner) {
        throw new Error("RECIPE_OPTIMIZATION_REVIEW_REFERENCES_INVALID");
      }
      // The canonical planner validates every complete ID set and computes
      // the same digest for the full batch before examples are truncated.
      references.set(claim.check_id, {
        claim,
        full_scope_fingerprint: fingerprintRecipeRiskReviewScope(claim.full_scope),
      });
    }
    const freshness = await checkStoredGeometryOptimizationReviewFreshness({
      recipe_id: input.recipe_id,
      expected_review_source_identity: input.expected_review_source_identity,
    });
    const plan = freshness.current_review_plan;
    const expectedChecks = new Set(plan.batches.map(batch => batch.check_id));
    if (freshness.state !== "SOURCE_STALE" &&
        [...references.keys()].some(checkId => !expectedChecks.has(checkId))) {
      throw new Error(
        "RECIPE_OPTIMIZATION_REVIEW_CHECK_NOT_PLANNED: reference targets an unrequested owner review."
      );
    }
    const checks = plan.batches.map(batch => {
      const reference = references.get(batch.check_id);
      let recipeSourceObservationConfirmed = false;
      let observationRejected = false;
      const sourceAndScopeMatch =
        freshness.state !== "SOURCE_STALE" && reference !== undefined &&
        reference.claim.source_binding_fingerprint ===
          freshness.current_review_source_identity.source_binding_fingerprint &&
        reference.full_scope_fingerprint === batch.full_scope_fingerprint;
      if (sourceAndScopeMatch && reference !== undefined &&
          reference.claim.owner_source_observation_handle !== undefined) {
        const handle = reference.claim.owner_source_observation_handle;
        let issued: ReturnType<typeof evidenceRegistry.get> | null = null;
        try {
          issued = evidenceRegistry.get(handle);
        } catch {
          // A guessed, expired or foreign Runtime handle has no authority.
        }
        if (batch.evidence_owner === "SAVED_RECIPE" &&
            issued?.kind === "RECIPE_REVIEW_SOURCE_OBSERVATION" &&
            issued.value.recipe_id === input.recipe_id &&
            issued.value.evidence_owner === batch.evidence_owner &&
            issued.value.check_id === batch.check_id &&
            issued.value.source_binding_fingerprint ===
              freshness.current_review_source_identity.source_binding_fingerprint &&
            issued.value.full_scope_fingerprint === batch.full_scope_fingerprint &&
            issued.value.source_observation === "SAVED_RECIPE_CURRENT_SOURCE_ONLY") {
          recipeSourceObservationConfirmed = true;
        } else {
          observationRejected = true;
        }
      }
      const state = freshness.state === "SOURCE_STALE"
        ? ("SOURCE_STALE" as const)
        : !reference
          ? ("REFERENCE_MISSING" as const)
          : reference.claim.source_binding_fingerprint !==
              freshness.current_review_source_identity.source_binding_fingerprint
            ? ("SOURCE_BINDING_MISMATCH" as const)
            : reference.full_scope_fingerprint !== batch.full_scope_fingerprint
              ? ("SCOPE_MISMATCH" as const)
              : batch.source_readiness === "SOURCE_FIELDS_INCOMPLETE"
                ? ("SOURCE_INCOMPLETE" as const)
                : observationRejected
                  ? ("OWNER_SOURCE_OBSERVATION_REJECTED" as const)
                  : recipeSourceObservationConfirmed
                    ? ("RECIPE_SOURCE_OBSERVED_NOT_REVIEWED" as const)
                    : ("REFERENCE_BOUND_UNATTESTED" as const);
      return {
        check_id: batch.check_id,
        evidence_owner: batch.evidence_owner,
        state,
        source_readiness: batch.source_readiness,
        expected_full_scope_fingerprint: batch.full_scope_fingerprint,
        reference_submitted: Boolean(reference),
        recipe_source_observation_confirmed: recipeSourceObservationConfirmed,
        // A verified Recipe-source registry lookup is still NOT independent
        // UV/material/animation/visual provenance or review approval.
        owner_provenance_verified: false as const,
        native_check_executed: false as const,
      };
    });
    const mismatched = checks.some(check =>
      check.state === "SOURCE_BINDING_MISMATCH" ||
      check.state === "SCOPE_MISMATCH" ||
      check.state === "OWNER_SOURCE_OBSERVATION_REJECTED"
    );
    const missing = checks.some(check => check.state === "REFERENCE_MISSING");
    const incomplete = checks.some(check => check.state === "SOURCE_INCOMPLETE");
    const matchedReferenceCount = checks.filter(check =>
      check.state === "REFERENCE_BOUND_UNATTESTED" ||
      check.state === "RECIPE_SOURCE_OBSERVED_NOT_REVIEWED"
    ).length;
    const recipeSourceObservationCount = checks.filter(check =>
      check.state === "RECIPE_SOURCE_OBSERVED_NOT_REVIEWED"
    ).length;
    return {
      state: freshness.state === "SOURCE_STALE"
        ? ("SOURCE_STALE" as const)
        : mismatched
          ? ("REFERENCES_MISMATCHED" as const)
          : missing
            ? ("REFERENCES_MISSING" as const)
            : incomplete
              ? ("SOURCE_INCOMPLETE" as const)
              : checks.length === 0
                ? ("NO_REVIEW_CANDIDATES" as const)
                : ("REFERENCES_BOUND_UNATTESTED" as const),
      reconciliation_scope: "CALLER_SUPPLIED_REFERENCE_SCOPE_MATCH_ONLY" as const,
      source_freshness_state: freshness.state,
      changed_source_parts: freshness.changed_source_parts,
      current_review_source_identity: freshness.current_review_source_identity,
      check_count: checks.length,
      submitted_reference_count: references.size,
      matched_unattested_reference_count: matchedReferenceCount,
      recipe_source_observation_count: recipeSourceObservationCount,
      checks,
      owner_provenance_verified: false as const,
      verified_evidence_count: 0 as const,
      native_review_executed: false as const,
      review_approved: false as const,
      safe_to_delete: false as const,
      native_mutation_authorized: false as const,
      visual_verdict: "NOT_EVALUATED" as const,
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
    inspectStoredGeometryCoincidence,
    checkStoredGeometryOptimizationReviewFreshness,
    captureStoredRecipeOptimizationSourceObservations,
    reconcileStoredGeometryOptimizationReviewEvidence,
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