import type {
  AuthoringRecipe,
  RecipeCubePrototype,
  RecipeFeatureIntent,
  RecipeGeometryReason,
  RecipePattern,
  RecipeVec3,
} from "./contracts";
import type { GeometryCurveObservation } from "./geometryCurves";
import { buildPlanarCurveRecipeCandidate } from "./geometryCurveConstruction";
import { compileAuthoringRecipe } from "./compiler";
import {
  requireBoxUvRepresentableSpan,
  validateCubeGeometrySpan,
} from "@/lib/geometry/cubeSpan";

type CubeInput = {
  kind: "cuboid";
  from: RecipeVec3;
  to: RecipeVec3;
  pivot?: RecipeVec3;
  rotation?: RecipeVec3;
};
type FrameInput = {
  kind: "frame";
  center: RecipeVec3;
  size: RecipeVec3;
  /** Thickness of the four border members, in Blockbench model units. */
  border: number;
  /** Direction perpendicular to the frame's open face. */
  normal_axis: "X" | "Y" | "Z";
};
type RepeatInput = {
  kind: "repeat";
  size: RecipeVec3;
  rotation?: RecipeVec3;
  pattern:
    | { kind: "LINEAR"; axis: "X" | "Y" | "Z"; start: RecipeVec3; spacing: number; count: number }
    | { kind: "GRID"; axes: ["X" | "Y" | "Z", "X" | "Y" | "Z"]; start: RecipeVec3; spacing: [number, number]; counts: [number, number] }
    | { kind: "RADIAL"; axis: "X" | "Y" | "Z"; center: RecipeVec3; radius: number; count: number };
};
type CurveInput = {
  kind: "curve";
  samples: GeometryCurveObservation["samples"];
};

type GeometryFeatureBase = {
  id: string;
  label: string;
  /** IDs of actual caller-supplied reference/view/user requirement claims. */
  evidence_refs: string[];
  geometry_reasons?: RecipeGeometryReason[];
  /** Explicit replacement only for generated, unlinked pattern cohorts. */
  replace_generated?: boolean;
};

export type AdvancedGeometryFeature =
  | (GeometryFeatureBase & CubeInput)
  | (GeometryFeatureBase & FrameInput)
  | (GeometryFeatureBase & RepeatInput)
  | (GeometryFeatureBase & CurveInput);

export type AdvancedGeometrySummary = {
  scope: "SOURCE_ONLY_NOT_VISUALLY_ATTESTED";
  feature_count: number;
  instance_count: number;
  shape_families: Array<{
    feature_id: string;
    kind: AdvancedGeometryFeature["kind"];
    native_cube_candidates: number;
    rig_review_required: boolean;
  }>;
  reference_content_attested: false;
  native_mutation_executed: false;
  visual_verdict: "NOT_EVALUATED";
};

const AXES = ["X", "Y", "Z"] as const;
const MAX_FEATURES = 8;
const MAX_FEATURE_CUBES = 128;
const MAX_TOTAL_CUBES = 256;

function requireFiniteVector(value: readonly number[], label: string): RecipeVec3 {
  if (!Array.isArray(value) || value.length !== 3 ||
    value.some(item => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error("ADVANCED_GEOMETRY_VECTOR_INVALID: " + label);
  }
  return [value[0]!, value[1]!, value[2]!];
}

function requirePositiveSize(value: readonly number[], label: string): RecipeVec3 {
  const vector = requireFiniteVector(value, label);
  if (vector.some(item => item < 1)) {
    throw new Error("ADVANCED_GEOMETRY_BOX_UV_SIZE_REVIEW: " +
      label + " requires positive axes >= 1 for inherited Box UV.");
  }
  return vector;
}

function requireRotation(value: readonly number[] | undefined): RecipeVec3 {
  const rotation = requireFiniteVector(value ?? [0, 0, 0], "rotation");
  if (rotation.some(item => Math.abs(item) > 45) ||
    rotation.filter(item => item !== 0).length > 1) {
    throw new Error("ADVANCED_GEOMETRY_ROTATION_REVIEW: use at most one native axis within ±45 degrees.");
  }
  return rotation;
}

function requireIdentity(value: string, label: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
    throw new Error("ADVANCED_GEOMETRY_ID_INVALID: " + label);
  }
  return value;
}

function requireCount(count: number, label: string): number {
  if (!Number.isInteger(count) || count < 1 || count > MAX_FEATURE_CUBES) {
    throw new Error("ADVANCED_GEOMETRY_COUNT_INVALID: " + label);
  }
  return count;
}

type Pieces = {
  prototypes: RecipeCubePrototype[];
  patterns: RecipePattern[];
};

function makeBox(
  id: string,
  name: string,
  featureId: string,
  fromRaw: RecipeVec3,
  toRaw: RecipeVec3,
  rotationRaw?: RecipeVec3,
  pivotRaw?: RecipeVec3
): Pieces {
  const from = requireFiniteVector(fromRaw, "from");
  const to = requireFiniteVector(toRaw, "to");
  validateCubeGeometrySpan(from, to, 0, id);
  requireBoxUvRepresentableSpan(from, to, id);
  const size = requirePositiveSize(to.map((value, index) =>
    value - from[index]!) as RecipeVec3, "size");
  const rotation = requireRotation(rotationRaw);
  const pivot = pivotRaw === undefined
    ? from.map((value, index) => value + size[index]! / 2) as RecipeVec3
    : requireFiniteVector(pivotRaw, "pivot");
  const relativeOrigin = pivot.map((value, index) =>
    value - from[index]!) as RecipeVec3;
  return {
    prototypes: [{ id, name, size, rotation, origin: relativeOrigin }],
    patterns: [{
      kind: "LINEAR", id, feature_id: featureId,
      prototype_id: id, count: 1, axis: "Z", spacing: 0, start: from,
    }],
  };
}

function buildFrame(feature: Extract<AdvancedGeometryFeature, { kind: "frame" }>): Pieces {
  const center = requireFiniteVector(feature.center, "frame center");
  const size = requirePositiveSize(feature.size, "frame size");
  const border = feature.border;
  if (!Number.isFinite(border) || border < 1) {
    throw new Error("ADVANCED_GEOMETRY_FRAME_BORDER_INVALID");
  }
  const normal = AXES.indexOf(feature.normal_axis);
  if (normal < 0) throw new Error("ADVANCED_GEOMETRY_FRAME_AXIS_INVALID");
  const [a, b] = [0, 1, 2].filter(axis => axis !== normal);
  if (size[a!]! <= 2 * border || size[b!]! <= 2 * border) {
    throw new Error("ADVANCED_GEOMETRY_FRAME_OPENING_REQUIRED");
  }
  const low = center.map((value, index) => value - size[index]! / 2);
  const high = center.map((value, index) => value + size[index]! / 2);
  const piece = (label: string, aMin: number, aMax: number, bMin: number, bMax: number) => {
    const from = [...low] as RecipeVec3;
    const to = [...high] as RecipeVec3;
    from[a!] = aMin; to[a!] = aMax;
    from[b!] = bMin; to[b!] = bMax;
    return makeBox("shape:frame:" + feature.id + ":" + label,
      feature.label + "_" + label, feature.id, from, to);
  };
  const parts = [
    piece("left", low[a!]!, low[a!]! + border, low[b!]!, high[b!]!),
    piece("right", high[a!]! - border, high[a!]!, low[b!]!, high[b!]!),
    piece("bottom", low[a!]! + border, high[a!]! - border, low[b!]!, low[b!]! + border),
    piece("top", low[a!]! + border, high[a!]! - border, high[b!]! - border, high[b!]!),
  ];
  return {
    prototypes: parts.flatMap(part => part.prototypes),
    patterns: parts.flatMap(part => part.patterns),
  };
}

function buildRepeat(feature: Extract<AdvancedGeometryFeature, { kind: "repeat" }>): Pieces {
  const size = requirePositiveSize(feature.size, "repeated size");
  const rotation = requireRotation(feature.rotation);
  const id = "shape:repeat:" + feature.id;
  const shape = feature.pattern;
  let pattern: RecipePattern;
  switch (shape.kind) {
    case "LINEAR": {
      requireCount(shape.count, "linear count");
      if (!Number.isFinite(shape.spacing)) {
        throw new Error("ADVANCED_GEOMETRY_SPACING_INVALID");
      }
      pattern = {
        kind: "LINEAR", id, prototype_id: id, feature_id: feature.id,
        count: shape.count, axis: shape.axis, spacing: shape.spacing,
        start: requireFiniteVector(shape.start, "linear start"),
      };
      break;
    }
    case "GRID": {
      const count = requireCount(shape.counts[0] * shape.counts[1], "grid count");
      if (!Number.isInteger(shape.counts[0]) || !Number.isInteger(shape.counts[1]) ||
        count !== shape.counts[0] * shape.counts[1] ||
        shape.axes[0] === shape.axes[1] ||
        shape.spacing.some(value => !Number.isFinite(value))) {
        throw new Error("ADVANCED_GEOMETRY_GRID_INVALID");
      }
      pattern = {
        kind: "GRID", id, prototype_id: id, feature_id: feature.id,
        counts: [...shape.counts], axes: [...shape.axes],
        spacing: [...shape.spacing],
        start: requireFiniteVector(shape.start, "grid start"),
      };
      break;
    }
    case "RADIAL": {
      requireCount(shape.count, "radial count");
      if (!Number.isFinite(shape.radius) || shape.radius <= 0) {
        throw new Error("ADVANCED_GEOMETRY_RADIUS_INVALID");
      }
      pattern = {
        kind: "RADIAL", id, prototype_id: id, feature_id: feature.id,
        count: shape.count, axis: shape.axis, radius: shape.radius,
        center: requireFiniteVector(shape.center, "radial center").map(
          (value, index) => value - size[index]! / 2
        ) as RecipeVec3,
        rotate_with_pattern: false,
      };
      break;
    }
  }
  return {
    prototypes: [{
      id, name: feature.label, size, rotation,
      origin: size.map(value => value / 2) as RecipeVec3,
    }],
    patterns: [pattern],
  };
}

function protectCurrentFeature(
  recipe: AuthoringRecipe,
  feature: AdvancedGeometryFeature
): AuthoringRecipe {
  const prefix = feature.kind === "curve"
    ? "curve:" + feature.id + ":"
    : "shape:" + feature.kind + ":" + feature.id + ":";
  const existing = recipe.patterns.filter(pattern => pattern.feature_id === feature.id);
  const isOwnedId = (id: string) =>
    feature.kind === "curve" || feature.kind === "frame"
      ? id.startsWith(prefix)
      : id === prefix.slice(0, -1);
  if (existing.some(pattern =>
    !isOwnedId(pattern.id) ||
    (feature.kind !== "curve" && pattern.prototype_id !== pattern.id))) {
    throw new Error("ADVANCED_GEOMETRY_FOREIGN_FEATURE_PROTECTED: " + feature.id);
  }
  if (existing.length && feature.replace_generated !== true) {
    throw new Error("ADVANCED_GEOMETRY_EXPLICIT_REPLACEMENT_REQUIRED: " + feature.id);
  }
  const ids = new Set(existing.map(pattern => pattern.id));
  const instances = new Set(existing.flatMap(pattern =>
    pattern.kind === "LINEAR" ? Array.from({length: pattern.count}, (_, n) =>
      pattern.id + ":" + n) :
    pattern.kind === "GRID" ? Array.from({length: pattern.counts[0] * pattern.counts[1]}, (_, n) =>
      pattern.id + ":" + n) :
    Array.from({length: pattern.count}, (_, n) => pattern.id + ":" + n)
  ));
  if ((recipe.constraints ?? []).some(relation =>
    instances.has(relation.source_instance_id) ||
    instances.has(relation.target_instance_id)) ||
    (recipe.symmetry ?? []).some(relation =>
      instances.has(relation.source_instance_id) ||
      instances.has(relation.target_instance_id))) {
    throw new Error("ADVANCED_GEOMETRY_LINKED_FEATURE_PROTECTED: " + feature.id);
  }
  if (recipe.patterns.some(pattern =>
    pattern.feature_id !== feature.id &&
    (ids.has(pattern.prototype_id) || isOwnedId(pattern.id)))) {
    throw new Error("ADVANCED_GEOMETRY_CROSS_FEATURE_OWNER_PROTECTED");
  }
  const remainingPatterns = recipe.patterns.filter(pattern => !ids.has(pattern.id));
  const remainingPrototypes = recipe.prototypes.filter(prototype => !ids.has(prototype.id));
  const before = recipe.feature_intents ?? [];
  const prior = before.find(entry => entry.id === feature.id);
  const newFeature: RecipeFeatureIntent = {
    id: feature.id,
    label: feature.label,
    visual_role: "THREE_DIMENSIONAL",
    evidence: "SUPPORTED",
    evidence_refs: [...feature.evidence_refs],
    geometry_reasons: feature.geometry_reasons?.length
      ? [...feature.geometry_reasons] : ["VOLUME", "SILHOUETTE"],
  };
  if (prior && prior.visual_role !== "THREE_DIMENSIONAL") {
    throw new Error("ADVANCED_GEOMETRY_FEATURE_REPRESENTATION_PROTECTED");
  }
  return {
    ...recipe,
    prototypes: remainingPrototypes,
    patterns: remainingPatterns,
    feature_intents: [...before.filter(entry => entry.id !== feature.id), newFeature],
  };
}

/**
 * Source-scope isolation for the existing Recipe plan/apply service.
 * An advanced feature command never carries permission to rewrite unrelated
 * geometry, constraints, symmetry, source bindings or saved model identity.
 */
export function requireAdvancedGeometryChangeScope(
  previous: AuthoringRecipe,
  candidate: AuthoringRecipe,
  features: readonly AdvancedGeometryFeature[]
): void {
  if (previous.id !== candidate.id ||
    previous.schema !== candidate.schema ||
    previous.compiler_version !== candidate.compiler_version ||
    previous.name !== candidate.name ||
    JSON.stringify(previous.constraints ?? []) !== JSON.stringify(candidate.constraints ?? []) ||
    JSON.stringify(previous.symmetry ?? []) !== JSON.stringify(candidate.symmetry ?? []) ||
    JSON.stringify(previous.knowledge_links ?? []) !== JSON.stringify(candidate.knowledge_links ?? [])) {
    throw new Error("ADVANCED_GEOMETRY_OUT_OF_SCOPE_RECIPE_CHANGE");
  }
  const selected = new Set(features.map(feature => feature.id));
  const sortById = <T extends {id: string}>(items: readonly T[]): T[] =>
    [...items].sort((left, right) => left.id.localeCompare(right.id));
  const owned = (recipe: AuthoringRecipe) => new Set(
    recipe.patterns.filter(pattern => selected.has(pattern.feature_id ?? ""))
      .map(pattern => pattern.prototype_id)
  );
  const previousSelectedPrototypes = owned(previous);
  const candidateSelectedPrototypes = owned(candidate);
  const unchanged = (before: unknown, after: unknown) =>
    JSON.stringify(before) === JSON.stringify(after);
  if (!unchanged(
    sortById(previous.patterns.filter(pattern => !selected.has(pattern.feature_id ?? ""))),
    sortById(candidate.patterns.filter(pattern => !selected.has(pattern.feature_id ?? "")))
  ) || !unchanged(
    sortById(previous.prototypes.filter(proto => !previousSelectedPrototypes.has(proto.id))),
    sortById(candidate.prototypes.filter(proto => !candidateSelectedPrototypes.has(proto.id)))
  ) || !unchanged(
    sortById((previous.feature_intents ?? []).filter(feature => !selected.has(feature.id))),
    sortById((candidate.feature_intents ?? []).filter(feature => !selected.has(feature.id)))
  )) {
    throw new Error("ADVANCED_GEOMETRY_UNRELATED_FEATURE_CHANGED");
  }
}

/**
 * One feature-level planner, not a new Recipe engine or Blockbench mutation
 * path. All shapes become existing Recipe v1 prototypes and patterns.
 * Previous unrelated feature structure and native identifiers are preserved.
 */
export function buildAdvancedGeometryRecipeCandidate(
  source: AuthoringRecipe,
  features: readonly AdvancedGeometryFeature[]
): { next_recipe: AuthoringRecipe; summary: AdvancedGeometrySummary } {
  if (!Array.isArray(features) || features.length < 1 || features.length > MAX_FEATURES) {
    throw new Error("ADVANCED_GEOMETRY_FEATURE_BUDGET_INVALID");
  }
  const ids = features.map(feature => requireIdentity(feature.id, "feature"));
  if (new Set(ids).size !== ids.length) {
    throw new Error("ADVANCED_GEOMETRY_FEATURE_DUPLICATE");
  }
  let next = structuredClone(source);
  const rows: AdvancedGeometrySummary["shape_families"] = [];
  for (const feature of features) {
    if (typeof feature.label !== "string" || !feature.label.trim() ||
      feature.label.length > 128 ||
      !Array.isArray(feature.evidence_refs) ||
      feature.evidence_refs.length < 1 || feature.evidence_refs.length > 8 ||
      feature.evidence_refs.some(ref => typeof ref !== "string" || !ref.trim())) {
      throw new Error("ADVANCED_GEOMETRY_SOURCE_OR_LABEL_REQUIRED: " + feature.id);
    }
    if (feature.kind === "curve") {
      if (feature.samples.some(sample =>
        !sample || !/^[a-zA-Z0-9_-]{1,64}$/.test(sample.id))) {
        throw new Error("ADVANCED_GEOMETRY_CURVE_SAMPLE_ID_INVALID");
      }
      // Curve owns its own exact generated-feature safety rules; feature data
      // are supplied explicitly before invoking the existing R3a constructor.
      const previous = next.feature_intents?.find(entry => entry.id === feature.id);
      const intention: RecipeFeatureIntent = {
        id: feature.id, label: feature.label, visual_role: "THREE_DIMENSIONAL",
        evidence: "SUPPORTED", evidence_refs: [...feature.evidence_refs],
        geometry_reasons: feature.geometry_reasons?.length
          ? [...feature.geometry_reasons] : ["SILHOUETTE"],
      };
      next.feature_intents = [
        ...(next.feature_intents ?? []).filter(entry => entry.id !== feature.id),
        intention,
      ];
      if (previous && previous.visual_role !== "THREE_DIMENSIONAL") {
        throw new Error("ADVANCED_GEOMETRY_FEATURE_REPRESENTATION_PROTECTED");
      }
      const result = buildPlanarCurveRecipeCandidate(next,
        { feature_id: feature.id, samples: feature.samples },
        { replace_generated: feature.replace_generated });
      next = result.next_recipe;
      rows.push({
        feature_id: feature.id, kind: "curve",
        native_cube_candidates: result.summary.segment_count,
        rig_review_required: result.summary.rig_review_required,
      });
      continue;
    }
    next = protectCurrentFeature(next, feature);
    const before = next.patterns.length;
    let pieces: Pieces;
    if (feature.kind === "cuboid") {
      pieces = makeBox("shape:cuboid:" + feature.id, feature.label,
        feature.id, feature.from, feature.to, feature.rotation, feature.pivot);
    } else if (feature.kind === "frame") {
      pieces = buildFrame(feature);
    } else {
      pieces = buildRepeat(feature);
    }
    next.prototypes.push(...pieces.prototypes);
    next.patterns.push(...pieces.patterns);
    const compiled = compileAuthoringRecipe(next);
    const count = compiled.placements.filter(placement =>
      pieces.patterns.some(pattern => placement.source_pattern_id === pattern.id)
    ).length;
    if (next.patterns.length <= before || count < 1 || count > MAX_FEATURE_CUBES) {
      throw new Error("ADVANCED_GEOMETRY_FEATURE_SIZE_INVALID");
    }
    rows.push({
      feature_id: feature.id, kind: feature.kind,
      native_cube_candidates: count,
      rig_review_required: (feature.geometry_reasons ?? []).includes("MOTION"),
    });
  }
  const compiled = compileAuthoringRecipe(next);
  // Compare only newly requested feature cohorts. Other authored Cubes
  // can legitimately have coincident coordinates under distinct Bones.
  // Native parent-aware placement guards retain final authority on apply.
  const selected = new Set(features.map(feature => feature.id));
  const featureByPattern = new Map(next.patterns.map(pattern =>
    [pattern.id, pattern.feature_id] as const
  ));
  const occupied = new Set<string>();
  for (const placement of compiled.placements) {
    const owner = featureByPattern.get(placement.source_pattern_id);
    if (!owner || !selected.has(owner)) continue;
    const key = JSON.stringify([
      owner, placement.semantic_group ?? null,
      placement.from, placement.to, placement.origin,
      placement.rotation, placement.inflate,
    ]);
    if (occupied.has(key)) {
      throw new Error("ADVANCED_GEOMETRY_DUPLICATE_CUBE_PLACEMENT");
    }
    occupied.add(key);
  }
  if (compiled.placements.length > MAX_TOTAL_CUBES) {
    throw new Error("ADVANCED_GEOMETRY_TOTAL_CUBE_BUDGET_EXCEEDED");
  }
  return {
    next_recipe: next,
    summary: {
      scope: "SOURCE_ONLY_NOT_VISUALLY_ATTESTED",
      feature_count: rows.length,
      instance_count: compiled.placements.length,
      shape_families: rows,
      reference_content_attested: false,
      native_mutation_executed: false,
      visual_verdict: "NOT_EVALUATED",
    },
  };
}
