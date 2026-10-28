import { createHash } from "node:crypto";
import type { AuthoringRecipeApplyReceipt } from "@/lib/authoringRecipe/transaction";
import type { SemanticIdentityResolution } from "@/lib/authoringRecipe/semanticIdentity";
import type { RecipeRiskReviewCheckId } from "@/lib/authoringRecipe/planning";

/**
 * Bounded canonical-Recipe source observation, issued by the same Recipe
 * Service instance that owns the saved Recipe reader. Not a native UV,
 * material, animation, export or visual acceptance receipt.
 *
 * A SHA-256 handle only identifies this entry inside the owning service's
 * existing registry. It is not a signature or proof of external execution.
 */
export type RecipeOwnerSourceObservation = {
  recipe_id: string;
  check_id: Extract<
    RecipeRiskReviewCheckId,
    "RECIPE_ANCHOR_RELATION" | "RECIPE_SYMMETRY_RELATION"
  >;
  evidence_owner: "SAVED_RECIPE";
  source_binding_fingerprint: string;
  full_scope_fingerprint: string;
  source_observation: "SAVED_RECIPE_CURRENT_SOURCE_ONLY";
};

export type AuthoringEvidence =
  | { kind: "SEMANTIC_IDENTITY"; value: SemanticIdentityResolution }
  | { kind: "APPLY_RECEIPT"; value: AuthoringRecipeApplyReceipt }
  | { kind: "RECIPE_REVIEW_SOURCE_OBSERVATION"; value: RecipeOwnerSourceObservation };

export type AuthoringEvidenceHandle = `authoringevidence:${string}`;

export class AuthoringEvidenceRegistry {
  private readonly entries = new Map<AuthoringEvidenceHandle, AuthoringEvidence>();

  constructor(private readonly maxEntries = 16) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 64) {
      throw new Error("Authoring evidence registry maxEntries must be 1..64.");
    }
  }

  /**
   * Preflight the ENTIRE opt-in review source batch before issuing handles:
   * source observations may displace old source observations, but never
   * evict Apply receipts or semantic identity evidence.
   */
  assertCanAddReviewSourceObservations(count: number): void {
    const protectedCount = [...this.entries.values()].filter(entry =>
      entry.kind !== "RECIPE_REVIEW_SOURCE_OBSERVATION"
    ).length;
    if (!Number.isInteger(count) || count < 0 || count > this.maxEntries ||
        protectedCount + count > this.maxEntries) {
      throw new Error(
        "AUTHORING_REVIEW_SOURCE_OBSERVATION_CAPACITY: source review cannot evict protected Recipe evidence."
      );
    }
  }

  private evictOldestReviewSourceObservation(): boolean {
    for (const [handle, entry] of this.entries) {
      if (entry.kind === "RECIPE_REVIEW_SOURCE_OBSERVATION") {
        this.entries.delete(handle);
        return true;
      }
    }
    return false;
  }

  put(evidence: AuthoringEvidence): AuthoringEvidenceHandle {
    const handle = (
      "authoringevidence:" +
      createHash("sha256").update(JSON.stringify(evidence)).digest("hex")
    ) as AuthoringEvidenceHandle;
    this.entries.delete(handle);
    if (evidence.kind === "RECIPE_REVIEW_SOURCE_OBSERVATION" &&
        this.entries.size >= this.maxEntries &&
        !this.evictOldestReviewSourceObservation()) {
      throw new Error(
        "AUTHORING_REVIEW_SOURCE_OBSERVATION_CAPACITY: source review cannot evict protected Recipe evidence."
      );
    }
    this.entries.set(handle, structuredClone(evidence));
    while (this.entries.size > this.maxEntries) {
      if (this.evictOldestReviewSourceObservation()) continue;
      const oldest = this.entries.keys().next().value;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
    return handle;
  }

  get(handle: AuthoringEvidenceHandle): AuthoringEvidence {
    const evidence = this.entries.get(handle);
    if (!evidence) {
      throw new Error(
        "AUTHORING_EVIDENCE_NOT_FOUND: handle expired or belongs to a previous Runtime generation."
      );
    }
    this.entries.delete(handle);
    this.entries.set(handle, evidence);
    return structuredClone(evidence);
  }

  size(): number {
    return this.entries.size;
  }
}
