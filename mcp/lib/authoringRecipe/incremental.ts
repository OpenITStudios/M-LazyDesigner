import { createHash } from "node:crypto";
import type { AuthoringRecipe, CompiledCubePlacement } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { planRecipeFeatureRepresentations } from "@/lib/authoringRecipe/featureDecision";

export type IncrementalRecipeReason =
  | "ADDED"
  | "REMOVED"
  | "CHANGED"
  | "METADATA_CHANGED";

export type IncrementalRecipeRebuildPlan = {
  schema: 1;
  previous_recipe_fingerprint: string;
  next_recipe_fingerprint: string;
  upserts: CompiledCubePlacement[];
  remove_instance_ids: string[];
  metadata_only_instance_ids: string[];
  preserved_instance_ids: string[];
  symmetry_changed_relation_ids: string[];
  constraint_propagated_instance_ids: string[];
  metadata_fields_changed: Array<{
    instance_id: string;
    fields: string[];
  }>;
  semantic_invalidation: {
    uv_mapping: boolean;
    texture_appearance: boolean;
    animation_motion: boolean;
  };
  reasons: Array<{ instance_id: string; reason: IncrementalRecipeReason }>;
  metrics: {
    previous_cube_count: number;
    next_cube_count: number;
    upsert_count: number;
    remove_count: number;
    preserved_count: number;
    metadata_only_count: number;
    symmetry_change_count: number;
    constraint_propagated_count: number;
    native_affected_count: number;
    native_affected_ratio_of_next: number;
    affected_count: number;
    affected_ratio_of_next: number;
  };
};

function fingerprint(value: unknown): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function nativePlacementEqual(
  left: CompiledCubePlacement,
  right: CompiledCubePlacement
): boolean {
  return JSON.stringify({
    name: left.name,
    from: left.from,
    to: left.to,
    origin: left.origin,
    rotation: left.rotation,
    inflate: left.inflate,
  }) === JSON.stringify({
    name: right.name,
    from: right.from,
    to: right.to,
    origin: right.origin,
    rotation: right.rotation,
    inflate: right.inflate,
  });
}

function placementMetadataChanges(
  left: CompiledCubePlacement,
  right: CompiledCubePlacement
): string[] {
  const fields: string[] = [];
  for (const field of [
    "prototype_id",
    "semantic_group",
    "source_pattern_id",
    "instance_index",
  ] as const) {
    if (JSON.stringify(left[field]) !== JSON.stringify(right[field])) {
      fields.push(field);
    }
  }
  return fields;
}


function constraintPropagationChanges(
  previousRecipe: AuthoringRecipe,
  nextRecipe: AuthoringRecipe,
  changedNativeIds: readonly string[]
): string[] {
  const changed = new Set(changedNativeIds);
  const constrainedSources = new Set(
    (nextRecipe.constraints ?? [])
      .filter((constraint) => constraint.kind === "ANCHOR")
      .map((constraint) => constraint.source_instance_id)
  );
  if (constrainedSources.size === 0) return [];

  const previousPrototypeById = new Map(
    previousRecipe.prototypes.map((entry) => [entry.id, entry])
  );
  const nextPrototypeById = new Map(
    nextRecipe.prototypes.map((entry) => [entry.id, entry])
  );
  const previousPatternById = new Map(
    previousRecipe.patterns.map((entry) => [entry.id, entry])
  );
  const nextPatternById = new Map(
    nextRecipe.patterns.map((entry) => [entry.id, entry])
  );

  const nextCompiled = compileAuthoringRecipe(nextRecipe);
  const propagated: string[] = [];

  for (const instanceId of constrainedSources) {
    if (!changed.has(instanceId)) continue;
    const placement = nextCompiled.placements.find(
      (entry) => entry.id === instanceId
    );
    if (!placement || placement.source_pattern_id.startsWith("symmetry:")) {
      continue;
    }

    const previousPrototype = previousPrototypeById.get(
      placement.prototype_id
    );
    const nextPrototype = nextPrototypeById.get(placement.prototype_id);
    const previousPattern = previousPatternById.get(
      placement.source_pattern_id
    );
    const nextPattern = nextPatternById.get(placement.source_pattern_id);

    const ownPrototypeChanged =
      JSON.stringify(previousPrototype) !== JSON.stringify(nextPrototype);
    const ownPatternChanged =
      JSON.stringify(previousPattern) !== JSON.stringify(nextPattern);

    if (!ownPrototypeChanged && !ownPatternChanged) {
      propagated.push(instanceId);
    }
  }

  return propagated.sort();
}

function symmetryChanges(
  previous: ReturnType<typeof compileAuthoringRecipe>["symmetry_relationships"],
  next: ReturnType<typeof compileAuthoringRecipe>["symmetry_relationships"]
) {
  const previousById = new Map(previous.map((relation) => [relation.id, relation]));
  const nextById = new Map(next.map((relation) => [relation.id, relation]));
  const changedIds = new Set<string>();
  let uv = false;
  let texture = false;
  let animation = false;
  for (const id of new Set([...previousById.keys(), ...nextById.keys()])) {
    const before = previousById.get(id);
    const after = nextById.get(id);
    if (!before || !after) {
      changedIds.add(id);
      uv = true;
      texture = true;
      animation = true;
      continue;
    }
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changedIds.add(id);
    if (
      before.uv_policy !== after.uv_policy ||
      JSON.stringify(before.semantic_pair) !== JSON.stringify(after.semantic_pair)
    ) {
      uv = true;
      texture = true;
    }
    if (
      before.texture_policy !== after.texture_policy ||
      JSON.stringify(before.semantic_pair) !== JSON.stringify(after.semantic_pair)
    ) {
      texture = true;
    }
    if (
      before.rig_policy !== after.rig_policy ||
      JSON.stringify(before.semantic_pair) !== JSON.stringify(after.semantic_pair)
    ) {
      animation = true;
    }
  }
  return {
    changed_relation_ids: [...changedIds].sort(),
    uv_mapping: uv,
    texture_appearance: texture,
    animation_motion: animation,
  };
}

export function planIncrementalRecipeRebuild(
  previousRecipe: AuthoringRecipe,
  nextRecipe: AuthoringRecipe
): IncrementalRecipeRebuildPlan {
  if (previousRecipe.id !== nextRecipe.id) {
    throw new Error("Incremental recipe rebuild requires stable recipe identity.");
  }
  if (previousRecipe.feature_intents !== undefined &&
      nextRecipe.feature_intents === undefined) {
    throw new Error(
      "FEATURE_PLAN_DOWNGRADE_REFUSED: once a recipe declares feature evidence, " +
      "do not silently remove its representation guard during native reconciliation."
    );
  }
  const previous = compileAuthoringRecipe(previousRecipe);
  const next = compileAuthoringRecipe(nextRecipe);
  // A source recipe must not silently remove an already-authored 3D feature
  // merely by relabeling it Texture/Omit; painting or approval is not atomic
  // with native Cube deletion in this authoring transaction.
  if (previousRecipe.feature_intents && nextRecipe.feature_intents) {
    const nextRoutes = new Map(
      planRecipeFeatureRepresentations(nextRecipe.feature_intents).decisions
        .map((entry) => [entry.id, entry.route])
    );
    const previousFeatureByPattern = new Map(
      previousRecipe.patterns.map((pattern) => [pattern.id, pattern.feature_id])
    );
    const nextIds = new Set(next.placements.map((placement) => placement.id));
    for (const placement of previous.placements) {
      if (nextIds.has(placement.id)) continue;
      const featureId = previousFeatureByPattern.get(placement.source_pattern_id);
      if (!featureId) continue;
      const nextRoute = nextRoutes.get(featureId);
      if (nextRoute === "TEXTURE" || nextRoute === "OMIT") {
        throw new Error(
          "RECIPE_REPRESENTATION_HANDOFF_REQUIRED: " + featureId +
          " still has authored Cube " + placement.id + ". Verify the replacement " +
          "texture/visibility decision before separately removing Geometry."
        );
      }
    }
  }
  const previousById = new Map(previous.placements.map((placement) => [placement.id, placement]));
  const nextById = new Map(next.placements.map((placement) => [placement.id, placement]));
  const upserts: CompiledCubePlacement[] = [];
  const removals: string[] = [];
  const metadataOnly: string[] = [];
  const metadataFieldsChanged: IncrementalRecipeRebuildPlan["metadata_fields_changed"] = [];
  const preserved: string[] = [];
  const reasons: IncrementalRecipeRebuildPlan["reasons"] = [];

  for (const placement of next.placements) {
    const before = previousById.get(placement.id);
    if (!before) {
      upserts.push(placement);
      reasons.push({ instance_id: placement.id, reason: "ADDED" });
    } else if (!nativePlacementEqual(before, placement)) {
      upserts.push(placement);
      reasons.push({ instance_id: placement.id, reason: "CHANGED" });
    } else {
      const metadataChanges = placementMetadataChanges(before, placement);
      if (metadataChanges.length > 0) {
        metadataOnly.push(placement.id);
        metadataFieldsChanged.push({
          instance_id: placement.id,
          fields: metadataChanges,
        });
        reasons.push({
          instance_id: placement.id,
          reason: "METADATA_CHANGED",
        });
      } else {
        preserved.push(placement.id);
      }
    }
  }
  for (const placement of previous.placements) {
    if (!nextById.has(placement.id)) {
      removals.push(placement.id);
      reasons.push({ instance_id: placement.id, reason: "REMOVED" });
    }
  }

  upserts.sort((a,b) => a.id.localeCompare(b.id));
  removals.sort();
  metadataOnly.sort();
  metadataFieldsChanged.sort((a,b) =>
    a.instance_id.localeCompare(b.instance_id)
  );
  preserved.sort();
  reasons.sort((a,b) => a.instance_id.localeCompare(b.instance_id));
  const symmetry = symmetryChanges(
    previous.symmetry_relationships,
    next.symmetry_relationships
  );
  const semanticGroupChanged = metadataFieldsChanged.some((entry) =>
    entry.fields.includes("semantic_group")
  );
  const constraintPropagated = constraintPropagationChanges(
    previousRecipe,
    nextRecipe,
    upserts.map((entry) => entry.id)
  );
  const nativeAffectedCount = upserts.length + removals.length;
  const affectedCount =
    nativeAffectedCount +
    metadataOnly.length +
    symmetry.changed_relation_ids.length;
  return {
    schema: 1,
    previous_recipe_fingerprint: fingerprint(previousRecipe),
    next_recipe_fingerprint: fingerprint(nextRecipe),
    upserts,
    remove_instance_ids: removals,
    metadata_only_instance_ids: metadataOnly,
    preserved_instance_ids: preserved,
    symmetry_changed_relation_ids: symmetry.changed_relation_ids,
    constraint_propagated_instance_ids: constraintPropagated,
    metadata_fields_changed: metadataFieldsChanged,
    semantic_invalidation: {
      uv_mapping: semanticGroupChanged || symmetry.uv_mapping,
      texture_appearance:
        semanticGroupChanged || symmetry.texture_appearance,
      animation_motion:
        semanticGroupChanged || symmetry.animation_motion,
    },
    reasons,
    metrics: {
      previous_cube_count: previous.placements.length,
      next_cube_count: next.placements.length,
      upsert_count: upserts.length,
      remove_count: removals.length,
      preserved_count: preserved.length,
      metadata_only_count: metadataOnly.length,
      symmetry_change_count: symmetry.changed_relation_ids.length,
      constraint_propagated_count: constraintPropagated.length,
      native_affected_count: nativeAffectedCount,
      native_affected_ratio_of_next:
        next.placements.length === 0
          ? (nativeAffectedCount === 0 ? 0 : 1)
          : nativeAffectedCount / next.placements.length,
      affected_count: affectedCount,
      affected_ratio_of_next:
        next.placements.length === 0
          ? (affectedCount === 0 ? 0 : 1)
          : affectedCount / next.placements.length,
    },
  };
}
