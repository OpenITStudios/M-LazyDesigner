import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import {
  assertAuthoringRecipeNativeMatchesCompiled,
  fingerprintAuthoringRecipeNativeSnapshot,
  type AuthoringRecipeNativeSnapshot,
} from "@/lib/authoringRecipe/nativeState";
import {
  analyzeStaticCubeContainment,
  analyzeStaticCubeMergeCandidates,
  analyzeStaticMarginalProjection,
  type SurfaceEvidenceCube,
} from "@/lib/geometry/surfaceEvidence";

const MAX_NATIVE_CUBES = 256; // Inspection resource guard, NOT a style Cube quota.
const MAX_TARGETS = 16;
const MAX_EXAMPLES = 8;

// Static source diagnostics cannot certify any model-quality dimension.
const UNKNOWN_QUALITY = {
  silhouette: "UNVERIFIED",
  cross_view_proportion: "UNVERIFIED",
  negative_space: "UNVERIFIED",
  attachment_contact: "UNVERIFIED",
  material_uv_visibility: "UNVERIFIED",
  hierarchy_motion_clearance: "UNVERIFIED",
  bedrock_export: "UNVERIFIED",
} as const;

export type RecipeGeometryFidelityFinding = {
  kind: "FACE_ADJACENT_MERGE" | "STRICT_REST_CONTAINMENT" |
    "NO_NEW_ORTHOGRAPHIC_OUTLINE";
  native_cube_uuids: string[];
  recipe_instance_ids: string[];
  status: "RETAIN_DECLARED_RELATION" | "REFERENCE_AND_NATIVE_REVIEW_REQUIRED";
  /** Geometry-only evidence, not a predicted Cube saving or visual approval. */
  source_scope: "SAME_PARENT_STATIC_GEOMETRY_ONLY";
  required_checks: string[];
};

export type RecipeGeometryFidelityReview = {
  feature_id: string;
  state: "SOURCE_EVIDENCE_INCOMPLETE" | "REVIEW_CANDIDATES" |
    "NO_CANDIDATES_OBSERVED";
  native_source_fingerprint: string;
  checked_instance_count: number;
  total_feature_instances: number;
  diagnostics: {
    merge_candidate_count: number | null;
    contained_candidate_count: number | null;
    no_new_projected_outline_count: number | null;
    complete: false; // Partial geometry cannot be accepted as visual proof.
  };
  findings: RecipeGeometryFidelityFinding[];
  findings_truncated: boolean;
  blockers: string[];
  /** No quality dimension is marked PASS from static geometry diagnostics. */
  quality_dimensions: typeof UNKNOWN_QUALITY;
  quality_verdict: "UNVERIFIED";
  safe_to_merge_or_delete: false;
  native_mutation_executed: false;
  visual_verdict: "NOT_EVALUATED";
};

/** One source-only composition of EXISTING geometry diagnostics.
 * Never invent parent owners, infer visual approval or recompute a 3D scorer.
 * Caller/native service already owns complete source identity and rereads.
 */
export function reviewRecipeGeometryFidelity(
  recipe: AuthoringRecipe,
  native: AuthoringRecipeNativeSnapshot,
  featureId: string
): RecipeGeometryFidelityReview {
  assertAuthoringRecipeNativeMatchesCompiled(native, recipe);
  const nativeSource = fingerprintAuthoringRecipeNativeSnapshot(native);
  const empty = (reason: string): RecipeGeometryFidelityReview => ({
    feature_id: featureId,
    state: "SOURCE_EVIDENCE_INCOMPLETE",
    native_source_fingerprint: nativeSource,
    checked_instance_count: 0,
    total_feature_instances: 0,
    diagnostics: {
      merge_candidate_count: null,
      contained_candidate_count: null,
      no_new_projected_outline_count: null,
      complete: false,
    },
    findings: [],
    findings_truncated: false,
    blockers: [reason],
    quality_dimensions: { ...UNKNOWN_QUALITY },
    quality_verdict: "UNVERIFIED",
    safe_to_merge_or_delete: false,
    native_mutation_executed: false,
    visual_verdict: "NOT_EVALUATED",
  });
  const feature = recipe.feature_intents?.find(item => item.id === featureId);
  if (!feature) return empty("FEATURE_IDENTITY_UNAVAILABLE");
  if (feature.visual_role !== "THREE_DIMENSIONAL" ||
      feature.evidence !== "SUPPORTED" ||
      (feature.evidence_refs?.length ?? 0) === 0) {
    return empty("FEATURE_REFERENCE_REVIEW_REQUIRED");
  }
  if (native.cubes.length > MAX_NATIVE_CUBES) {
    return empty("NATIVE_DIAGNOSTIC_SCOPE_EXCEEDED");
  }
  if (native.cubes.some(cube =>
    !Array.isArray(cube.parent_path) ||
    !Array.isArray(cube.parent_authored_state) ||
    cube.parent_authored_state.length !== cube.parent_path.length ||
    cube.parent_path.some((id, i) =>
      typeof id !== "string" || !id.trim() ||
      cube.parent_authored_state![i]?.uuid !== id)
  )) return empty("NATIVE_PARENT_OWNERSHIP_UNAVAILABLE");

  const compiled = compileAuthoringRecipe(recipe);
  const owners = new Map<string, string>();
  const byPattern = new Map(recipe.patterns.map(item =>
    [item.id, item.feature_id] as const
  ));
  for (const placement of compiled.placements) {
    const owner = byPattern.get(placement.source_pattern_id);
    if (owner) owners.set(placement.id, owner);
  }
  // The compiler emits symmetry relationships after their original owners.
  for (const relation of compiled.symmetry_relationships) {
    const sourceOwner = owners.get(relation.source_instance_id);
    if (sourceOwner) owners.set(relation.target_instance_id, sourceOwner);
  }
  if (native.cubes.some(cube => !owners.has(cube.instance_id))) {
    return empty("NATIVE_FEATURE_OWNERSHIP_UNAVAILABLE");
  }
  const nativeByUuid = new Map(native.cubes.map(cube => [cube.uuid, cube] as const));
  if (nativeByUuid.size !== native.cubes.length ||
      native.cubes.some(cube => typeof cube.uuid !== "string" || !cube.uuid.trim())) {
    return empty("NATIVE_UUID_IDENTITY_UNAVAILABLE");
  }
  const featureCubes = native.cubes.filter(cube =>
    owners.get(cube.instance_id) === featureId
  ).sort((a, b) => a.instance_id.localeCompare(b.instance_id));
  if (!featureCubes.length) return empty("NO_AUTHORED_FEATURE_GEOMETRY");
  const selected = featureCubes.slice(0, MAX_TARGETS);
  const selectedUuids = selected.map(cube => cube.uuid);
  // Parent identity must come from the complete native path, never a group
  // label, display name, guessed "root", or absent optional legacy field.
  const cubes: SurfaceEvidenceCube[] = native.cubes.map(cube => ({
    uuid: cube.uuid, name: cube.name, from: cube.from, to: cube.to,
    origin: cube.origin, rotation: cube.rotation, inflate: cube.inflate,
    parent_id: JSON.stringify({
      root: cube.parent_path!.length === 0,
      path: cube.parent_path,
    }),
  }));
  const options = { target_cube_ids: selectedUuids, exampleLimit: MAX_EXAMPLES };
  const merge = analyzeStaticCubeMergeCandidates(cubes, options);
  const containment = analyzeStaticCubeContainment(cubes, options);
  const projection = analyzeStaticMarginalProjection(cubes, options);

  const dependencyIds = new Set([
    ...(recipe.constraints ?? []).flatMap(c =>
      [c.source_instance_id, c.target_instance_id]),
    ...(recipe.symmetry ?? []).flatMap(s =>
      [s.source_instance_id, s.target_instance_id]),
  ]);
  const findings: RecipeGeometryFidelityFinding[] = [];
  const known = new Set<string>();
  const pushFinding = (
    kind: RecipeGeometryFidelityFinding["kind"],
    uuids: readonly string[]
  ) => {
    const members = uuids.map(uuid => nativeByUuid.get(uuid));
    if (members.some(cube => !cube)) return;
    const ids = members.map(cube => cube!.instance_id).sort();
    const key = JSON.stringify([kind, ids]);
    if (known.has(key)) return;
    known.add(key);
    const crossFeature = ids.some(id => owners.get(id) !== featureId);
    const protectedOwner = crossFeature ||
      ids.some(id => dependencyIds.has(id)) ||
      feature.geometry_reasons?.some(reason =>
        ["TRANSFORM", "MOTION", "CONTACT", "NEGATIVE_SPACE"].includes(reason)
      ) === true;
    findings.push({
      kind,
      native_cube_uuids: [...uuids].sort(),
      recipe_instance_ids: ids,
      status: protectedOwner
        ? "RETAIN_DECLARED_RELATION"
        : "REFERENCE_AND_NATIVE_REVIEW_REQUIRED",
      source_scope: "SAME_PARENT_STATIC_GEOMETRY_ONLY",
      required_checks: [
        "Reference-matched silhouette, depth, contact and negative space",
        "Mapped UV, material, alpha and visibility variants",
        "Bone ownership, motion/pose clearance and export behavior",
        ...(crossFeature ? ["Different semantic feature owner: do not merge"] : []),
        ...(ids.some(id => dependencyIds.has(id))
          ? ["Declared ANCHOR/SYMMETRY dependency: preserve relation"] : []),
      ],
    });
  };
  for (const example of containment.examples) {
    pushFinding("STRICT_REST_CONTAINMENT",
      [example.cube_uuid, example.containing_cube_uuid]);
  }
  for (const example of merge.examples) {
    pushFinding("FACE_ADJACENT_MERGE", example.cube_uuids);
  }
  for (const example of projection.examples) {
    if (example.outcome === "NO_ADDITIONAL_PROJECTED_OUTLINE") {
      pushFinding("NO_NEW_ORTHOGRAPHIC_OUTLINE", [example.cube_uuid]);
    }
  }
  findings.sort((a, b) =>
    a.kind.localeCompare(b.kind) ||
    a.recipe_instance_ids.join("|").localeCompare(b.recipe_instance_ids.join("|"))
  );
  const blockers = [
    ...(featureCubes.length > MAX_TARGETS
      ? ["TARGET_SCOPE_TRUNCATED"] : []),
    ...(merge.state !== "available"
      ? ["MERGE_SOURCE_PARTIAL"] : []),
    ...(containment.state !== "available"
      ? ["CONTAINMENT_SOURCE_PARTIAL"] : []),
    ...(projection.state !== "available"
      ? ["PROJECTION_SOURCE_PARTIAL"] : []),
  ];
  return {
    feature_id: featureId,
    state: blockers.length > 0 ? "SOURCE_EVIDENCE_INCOMPLETE" :
      findings.length > 0 ? "REVIEW_CANDIDATES" : "NO_CANDIDATES_OBSERVED",
    native_source_fingerprint: nativeSource,
    checked_instance_count: selected.length,
    total_feature_instances: featureCubes.length,
    diagnostics: {
      merge_candidate_count: merge.merge_candidate_count,
      contained_candidate_count: containment.contained_candidate_count,
      no_new_projected_outline_count: projection.no_new_projected_outline_count,
      complete: false,
    },
    findings: findings.slice(0, MAX_EXAMPLES),
    findings_truncated: findings.length > MAX_EXAMPLES ||
      merge.examples_truncated || containment.examples_truncated ||
      projection.examples_truncated,
    blockers,
    quality_dimensions: { ...UNKNOWN_QUALITY },
    quality_verdict: "UNVERIFIED",
    safe_to_merge_or_delete: false,
    native_mutation_executed: false,
    visual_verdict: "NOT_EVALUATED",
  };
}
