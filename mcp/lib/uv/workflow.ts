import type { CompiledAuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import type { AtlasPlacement } from "@/lib/uv/maxRectsPlanner";
import {
  deriveAuthoringRecipeUvIslands,
  expandAffectedUvIds,
  type AuthoringRecipeUvOptions,
} from "@/lib/uv/authoringRecipeUv";
import { compileNativeUvApplyPlan, type NativeUvTarget } from "@/lib/uv/nativeApplyPlan";
import { nativeUvSnapshotFingerprint, type NativeUvCubeSnapshot } from "@/lib/uv/nativeState";
import { planSemanticUv, type SemanticUvPlanOptions } from "@/lib/uv/semanticPlanner";
import { diffSemanticUv } from "@/lib/uv/semanticDiff";
import type { NativeUvTransactionPlan } from "@/lib/uv/nativeTransaction";

export type CompileSemanticUvWorkflowOptions = AuthoringRecipeUvOptions &
  Omit<SemanticUvPlanOptions, "affected_ids" | "previous_placements"> & {
    logical_width: number;
    logical_height: number;
    previous_placements?: readonly AtlasPlacement[];
    previous_semantic_placements?: ReturnType<typeof planSemanticUv>["placements"];
    affected_instance_ids?: readonly string[];
  };

export function compileAuthoringRecipeSemanticUvWorkflow(
  compiled: CompiledAuthoringRecipe,
  nativeSnapshots: readonly NativeUvCubeSnapshot[],
  nativeTargets: readonly NativeUvTarget[],
  options: CompileSemanticUvWorkflowOptions
) {
  const islands = deriveAuthoringRecipeUvIslands(compiled, options);
  const affectedIds = options.affected_instance_ids
    ? expandAffectedUvIds(compiled, options.affected_instance_ids)
    : undefined;

  const semantic = planSemanticUv(islands, {
    atlas_width: options.atlas_width,
    atlas_height: options.atlas_height,
    default_texel_density: options.default_texel_density,
    padding: options.padding,
    allow_rotation: options.allow_rotation,
    cohort_texel_density: options.cohort_texel_density,
    previous_placements: options.previous_placements,
    affected_ids: affectedIds,
  });

  const nativePlan = compileNativeUvApplyPlan(semantic.placements, nativeTargets, {
    bitmap_width: options.atlas_width,
    bitmap_height: options.atlas_height,
    logical_width: options.logical_width,
    logical_height: options.logical_height,
  });
  if (!nativePlan.complete) {
    throw new Error(
      "Semantic UV native target mapping is incomplete. Missing targets: " +
        nativePlan.unresolved.join(", ")
    );
  }
  const affectedCubeUuids = new Set(nativePlan.operations.map((operation) => operation.cube_uuid));
  const fingerprintSnapshots = nativeSnapshots.filter((snapshot) =>
    affectedCubeUuids.has(snapshot.cube_uuid)
  );
  if (fingerprintSnapshots.length !== affectedCubeUuids.size) {
    throw new Error("Semantic UV workflow is missing native snapshots for one or more affected Cubes.");
  }
  const transaction: NativeUvTransactionPlan = {
    expected_fingerprint: nativeUvSnapshotFingerprint(fingerprintSnapshots),
    operations: nativePlan.operations,
  };

  return {
    islands,
    semantic,
    diff: options.previous_semantic_placements
      ? diffSemanticUv(options.previous_semantic_placements, semantic.placements)
      : null,
    native_plan: nativePlan,
    transaction,
  };
}
