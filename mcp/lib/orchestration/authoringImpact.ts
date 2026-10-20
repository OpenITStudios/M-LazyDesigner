import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { planIncrementalRecipeRebuild } from "@/lib/authoringRecipe/incremental";
import { expandAffectedUvIds } from "@/lib/uv/authoringRecipeUv";

export type DownstreamAuthoringOwnership = {
  rig_instance_ids?: readonly string[];
  animation_instance_ids?: readonly string[];
};

export type AuthoringImpactPlan = {
  geometry: {
    upsert_instance_ids: string[];
    remove_instance_ids: string[];
    metadata_only_instance_ids: string[];
    preserved_instance_ids: string[];
  };
  uv: {
    stale: boolean;
    affected_island_ids: string[];
    scope: "AFFECTED_ONLY" | "FULL_SEMANTIC_REPLAN" | "UNCHANGED";
  };
  rig: {
    stale: boolean;
    affected_instance_ids: string[];
    scope: "AFFECTED_ONLY" | "FULL_SEMANTIC_REPLAN" | "UNCHANGED";
  };
  animation: {
    stale: boolean;
    affected_instance_ids: string[];
    scope: "AFFECTED_ONLY" | "FULL_SEMANTIC_REVIEW" | "UNCHANGED";
  };
  texture: {
    stale: boolean;
    reason: "UV_CHANGED" | "SEMANTIC_MATERIAL_CHANGED" | "SYMMETRY_POLICY_CHANGED" | "UNCHANGED";
    scope: "AFFECTED_SURFACES" | "SEMANTIC_REVIEW" | "UNCHANGED";
  };
  symmetry_changed_relation_ids: string[];
};

function exactAffected(
  semanticAffected: readonly string[],
  ownership: readonly string[] | undefined
): string[] | null {
  // Preserve unknown ownership (null) separately from a known empty affected set ([]).
  if (!ownership) return null;
  const owned = new Set(ownership);
  return semanticAffected.filter((id) => owned.has(id)).sort();
}

export function planAuthoringImpact(
  previousRecipe: AuthoringRecipe,
  nextRecipe: AuthoringRecipe,
  ownership: DownstreamAuthoringOwnership = {}
): AuthoringImpactPlan {
  const diff = planIncrementalRecipeRebuild(previousRecipe, nextRecipe);
  const next = compileAuthoringRecipe(nextRecipe);
  const nextIds = new Set(next.placements.map((placement) => placement.id));
  const upsertIds = diff.upserts.map((placement) => placement.id);
  const nativeAffected = [...upsertIds, ...diff.remove_instance_ids].sort();
  const semanticAffected = [...new Set([...nativeAffected, ...diff.metadata_only_instance_ids])].sort();
  const uvAffected = nativeAffected.length > 0
    ? expandAffectedUvIds(next, nativeAffected.filter((id) => nextIds.has(id)))
    : [];
  const semanticGroupChanged = diff.metadata_fields_changed.some(
    (entry) => entry.fields.includes("semantic_group")
  );
  const removalRequiresUvReplan = diff.remove_instance_ids.length > 0;
  const motionChanged = diff.semantic_invalidation.animation_motion;
  const motionPotentiallyStale = semanticAffected.length > 0 || motionChanged;

  let uvScope: AuthoringImpactPlan["uv"]["scope"] = "UNCHANGED";
  if (uvAffected.length > 0) {
    uvScope = "AFFECTED_ONLY";
  } else if (diff.semantic_invalidation.uv_mapping || removalRequiresUvReplan) {
    uvScope = "FULL_SEMANTIC_REPLAN";
  }

  const rigAffected = exactAffected(semanticAffected, ownership.rig_instance_ids);
  let rigScope: AuthoringImpactPlan["rig"]["scope"] = "UNCHANGED";
  if (motionPotentiallyStale) {
    if (rigAffected === null) {
      rigScope = "FULL_SEMANTIC_REPLAN";
    } else if (rigAffected.length > 0) {
      rigScope = "AFFECTED_ONLY";
    } else if (motionChanged) {
      rigScope = "FULL_SEMANTIC_REPLAN";
    }
  }

  const animationAffected = exactAffected(semanticAffected, ownership.animation_instance_ids);
  let animationScope: AuthoringImpactPlan["animation"]["scope"] = "UNCHANGED";
  if (motionPotentiallyStale) {
    if (animationAffected === null) {
      animationScope = "FULL_SEMANTIC_REVIEW";
    } else if (animationAffected.length > 0) {
      animationScope = "AFFECTED_ONLY";
    } else if (motionChanged) {
      animationScope = "FULL_SEMANTIC_REVIEW";
    }
  }

  let textureReason: AuthoringImpactPlan["texture"]["reason"] = "UNCHANGED";
  if (semanticGroupChanged) {
    textureReason = "SEMANTIC_MATERIAL_CHANGED";
  } else if (diff.semantic_invalidation.texture_appearance && diff.symmetry_changed_relation_ids.length > 0) {
    textureReason = "SYMMETRY_POLICY_CHANGED";
  } else if (uvScope !== "UNCHANGED") {
    textureReason = "UV_CHANGED";
  }

  let textureScope: AuthoringImpactPlan["texture"]["scope"] = "UNCHANGED";
  if (textureReason === "UV_CHANGED") {
    textureScope = "AFFECTED_SURFACES";
  } else if (textureReason !== "UNCHANGED") {
    textureScope = "SEMANTIC_REVIEW";
  }

  return {
    geometry: {
      upsert_instance_ids: upsertIds,
      remove_instance_ids: diff.remove_instance_ids,
      metadata_only_instance_ids: diff.metadata_only_instance_ids,
      preserved_instance_ids: diff.preserved_instance_ids,
    },
    uv: { stale: uvScope !== "UNCHANGED", affected_island_ids: uvAffected, scope: uvScope },
    rig: { stale: rigScope !== "UNCHANGED", affected_instance_ids: rigAffected ?? [], scope: rigScope },
    animation: { stale: animationScope !== "UNCHANGED", affected_instance_ids: animationAffected ?? [], scope: animationScope },
    texture: { stale: textureReason !== "UNCHANGED", reason: textureReason, scope: textureScope },
    symmetry_changed_relation_ids: diff.symmetry_changed_relation_ids,
  };
}
