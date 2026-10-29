import type { AuthoringRecipe, RecipeFeatureIntent } from "@/lib/authoringRecipe/contracts";
import {
  AUTHORING_RECIPE_MAX_INSTANCES,
  countRecipePatternInstances,
  expandRecipePattern,
} from "@/lib/authoringRecipe/patterns";

const MAX_RELATIONS_FOR_REVIEW = 128;
const MAX_RELATION_EXAMPLES = 8;
const MAX_FEATURES_FOR_REVIEW = 8;
const MAX_GROUP_EXAMPLES = 8;

type Member = { feature_id: string | null; group: string | null };
export type DeclaredAssemblyRelation = {
  kind: "ANCHOR" | "SYMMETRY";
  id: string;
  source_instance_id: string;
  target_instance_id: string;
  source_feature_id: string | null;
  target_feature_id: string | null;
  /** A positional dependency is NOT a bone-parent relationship. */
  anchor_axes?: Array<"X" | "Y" | "Z">;
  /** Mirrored geometry does not imply mirrored UVs, textures or rig. */
  symmetry_policies?: {
    uv: "SHARE" | "UNIQUE";
    texture: "MIRROR" | "UNIQUE";
    rig: "MIRROR" | "INDEPENDENT";
  };
  evidence: "RECIPE_DECLARATION_ONLY_NOT_VISUAL_OR_NATIVE_PROOF";
};

export type GeometryAssemblyReview = {
  feature_id: string;
  scope: "DECLARED_RECIPE_RELATIONS_ONLY";
  state: "DECLARED_RELATIONS_UNVERIFIED" | "NO_DECLARED_RELATIONS" |
    "SOURCE_IDENTITY_REVIEW_REQUIRED";
  relation_count: number;
  relation_examples: DeclaredAssemblyRelation[];
  relation_examples_truncated: boolean;
  /** Semantic group labels are not verified Blockbench bones. */
  semantic_group_labels: string[];
  source_identity_issues: string[];
  reference_checks: string[];
  native_parent_verified: false;
  native_mutation_executed: false;
};

function emptyReview(
  feature: RecipeFeatureIntent,
  issue: string | null = null
): GeometryAssemblyReview {
  return {
    feature_id: feature.id,
    scope: "DECLARED_RECIPE_RELATIONS_ONLY",
    state: issue ? "SOURCE_IDENTITY_REVIEW_REQUIRED" : "NO_DECLARED_RELATIONS",
    relation_count: 0,
    relation_examples: [],
    relation_examples_truncated: false,
    semantic_group_labels: [],
    source_identity_issues: issue ? [issue] : [],
    reference_checks: [
      "Confirm part identity, attachment and transform requirements against the approved reference.",
    ],
    native_parent_verified: false,
    native_mutation_executed: false,
  };
}

/**
 * Source-only R2 structural projection BEFORE Recipe compilation.
 * Derive instance IDs with the existing pattern expander, not display names or
 * a parallel graph store. Actual constraints/symmetry remain compiler-owned.
 * This is NOT a validator, hierarchy builder, or native mutation permission.
 */
export function reviewDeclaredRecipeAssembly(
  recipe: AuthoringRecipe,
  featureIds: readonly string[]
): GeometryAssemblyReview[] {
  if (featureIds.length > MAX_FEATURES_FOR_REVIEW ||
      new Set(featureIds).size !== featureIds.length) {
    throw new Error("RECIPE_ASSEMBLY_FEATURE_SCOPE_INVALID");
  }
  const features = new Map((recipe.feature_intents ?? []).map(f => [f.id, f] as const));
  if (featureIds.some(id => !features.has(id))) {
    throw new Error("RECIPE_ASSEMBLY_FEATURE_UNKNOWN");
  }
  if (featureIds.length === 0) return [];

  const selected = featureIds.map(id => features.get(id)!);
  const countRelations = (recipe.constraints?.length ?? 0) +
    (recipe.symmetry?.length ?? 0);
  if (countRelations > MAX_RELATIONS_FOR_REVIEW) {
    return selected.map(feature => emptyReview(feature,
      "REVIEW_RELATION_BUDGET_EXCEEDED"));
  }

  const members = new Map<string, Member>();
  const groupsByFeature = new Map<string, Set<string>>();
  const issuesByFeature = new Map<string, Set<string>>();
  const markIssue = (code: string, ...owners: Array<string | null | undefined>) => {
    for (const owner of owners) {
      if (!owner || !features.has(owner)) continue;
      const issues = issuesByFeature.get(owner) ?? new Set<string>();
      issues.add(code);
      issuesByFeature.set(owner, issues);
    }
  };
  try {
    let total = recipe.symmetry?.length ?? 0;
    for (const pattern of recipe.patterns) {
      const count = countRecipePatternInstances(pattern);
      total += count;
      if (total > AUTHORING_RECIPE_MAX_INSTANCES) {
        throw new Error("REVIEW_INSTANCE_BUDGET_EXCEEDED");
      }
    }
    for (const pattern of recipe.patterns) {
      for (const instance of expandRecipePattern(pattern)) {
        if (members.has(instance.id)) {
          throw new Error("DUPLICATE_INSTANCE_ID");
        }
        const group = instance.semantic_group ?? null;
        members.set(instance.id, {
          feature_id: pattern.feature_id ?? null, group,
        });
        if (pattern.feature_id && group) {
          const names = groupsByFeature.get(pattern.feature_id) ?? new Set<string>();
          names.add(group);
          groupsByFeature.set(pattern.feature_id, names);
        }
      }
    }
  } catch {
    return selected.map(feature => emptyReview(feature,
      "RECIPE_PATTERN_IDENTITY_UNAVAILABLE"));
  }

  // The Recipe compiler processes anchors BEFORE generating symmetry targets.
  const rows: DeclaredAssemblyRelation[] = [];
  for (const constraint of recipe.constraints ?? []) {
    const source = members.get(constraint.source_instance_id);
    const target = members.get(constraint.target_instance_id);
    if (constraint.kind !== "ANCHOR" || !source || !target ||
        !source.feature_id || !target.feature_id) {
      markIssue("ANCHOR_ENDPOINT_IDENTITY_UNVERIFIED",
        source?.feature_id, target?.feature_id);
      continue;
    }
    rows.push({
      kind: "ANCHOR", id: constraint.id,
      source_instance_id: constraint.source_instance_id,
      target_instance_id: constraint.target_instance_id,
      source_feature_id: source.feature_id,
      target_feature_id: target.feature_id,
      anchor_axes: [...constraint.axes],
      evidence: "RECIPE_DECLARATION_ONLY_NOT_VISUAL_OR_NATIVE_PROOF",
    });
  }
  for (const relation of recipe.symmetry ?? []) {
    const source = members.get(relation.source_instance_id);
    if (!source || !source.feature_id ||
        members.has(relation.target_instance_id)) {
      markIssue("SYMMETRY_ENDPOINT_IDENTITY_UNVERIFIED",
        source?.feature_id,
        members.get(relation.target_instance_id)?.feature_id);
      continue;
    }
    members.set(relation.target_instance_id, {
      feature_id: source.feature_id,
      group: source.group,
    });
    rows.push({
      kind: "SYMMETRY", id: relation.id,
      source_instance_id: relation.source_instance_id,
      target_instance_id: relation.target_instance_id,
      source_feature_id: source.feature_id,
      target_feature_id: source.feature_id,
      symmetry_policies: {
        uv: relation.uv_policy,
        texture: relation.texture_policy,
        rig: relation.rig_policy,
      },
      evidence: "RECIPE_DECLARATION_ONLY_NOT_VISUAL_OR_NATIVE_PROOF",
    });
  }

  return selected.map(feature => {
    const relevant = rows.filter(row =>
      row.source_feature_id === feature.id ||
      row.target_feature_id === feature.id
    ).sort((a, b) =>
      a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)
    );
    const refs = feature.evidence === "SUPPORTED" &&
      (feature.evidence_refs?.length ?? 0) > 0;
    const identityIssues = [
      ...(issuesByFeature.get(feature.id) ?? []),
      ...(!refs ? ["FEATURE_REFERENCE_EVIDENCE_UNVERIFIED"] : []),
    ];
    const checks = [
      "Confirm the actual relationship and contact/clearance in relevant approved reference views.",
      ...(relevant.some(row => row.kind === "ANCHOR")
        ? ["ANCHOR alignment is positional only; establish Bone parenting and joint pivot separately."] : []),
      ...(relevant.some(row => row.kind === "SYMMETRY")
        ? ["For SYMMETRY, check intentional asymmetry and UV/texture/rig policies independently."] : []),
    ];
    return {
      feature_id: feature.id,
      scope: "DECLARED_RECIPE_RELATIONS_ONLY" as const,
      state: identityIssues.length > 0
        ? "SOURCE_IDENTITY_REVIEW_REQUIRED" as const
        : relevant.length > 0
          ? "DECLARED_RELATIONS_UNVERIFIED" as const
          : "NO_DECLARED_RELATIONS" as const,
      relation_count: relevant.length,
      relation_examples: relevant.slice(0, MAX_RELATION_EXAMPLES),
      relation_examples_truncated: relevant.length > MAX_RELATION_EXAMPLES,
      semantic_group_labels:
        [...(groupsByFeature.get(feature.id) ?? [])].sort()
          .slice(0, MAX_GROUP_EXAMPLES),
      source_identity_issues: [...new Set(identityIssues)].sort(),
      reference_checks: checks,
      native_parent_verified: false as const,
      native_mutation_executed: false as const,
    };
  });
}
