export type WorldAxis = "x" | "y" | "z";

export type ReferencePartObservation = {
  view: string;
  part_id: string;
  dimensions?: Partial<Record<WorldAxis, number>>;
  attachment_parent?: string | null;
  required?: boolean;
};

export type CrossViewIssue =
  | {
      kind: "dimension_conflict";
      part_id: string;
      axis: WorldAxis;
      observations: Array<{ view: string; value: number }>;
      relative_spread: number;
    }
  | {
      kind: "attachment_conflict";
      part_id: string;
      observations: Array<{ view: string; parent: string | null }>;
    };

const DEFAULT_RELATIVE_TOLERANCE = 0.08;
const MAX_EXAMPLES = 12;

function finiteDimension(value: unknown): value is number {
  // A physically intentional planar span may be exactly zero. It is still
  // a real constraint and must participate in cross-view comparison.
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function canonicalParent(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * Deterministic cross-view consistency evidence for semantic reference facts.
 * Inputs must already represent world-space constraints inferred from a view;
 * this function never guesses 3D dimensions from image pixels.
 */
export function analyzeReferenceCrossViewEvidence(input: {
  observations: readonly ReferencePartObservation[];
  relativeTolerance?: number;
  exampleLimit?: number;
}) {
  const relativeTolerance = input.relativeTolerance ?? DEFAULT_RELATIVE_TOLERANCE;
  const exampleLimit = input.exampleLimit ?? MAX_EXAMPLES;
  if (!Number.isFinite(relativeTolerance) || relativeTolerance < 0 || relativeTolerance > 1) {
    return { state: "unavailable" as const, reason: "relative_tolerance_invalid" as const };
  }
  if (!Number.isInteger(exampleLimit) || exampleLimit < 1 || exampleLimit > 100) {
    return { state: "unavailable" as const, reason: "example_limit_invalid" as const };
  }
  if (!Array.isArray(input.observations)) {
    return { state: "unavailable" as const, reason: "observations_invalid" as const };
  }
  // An explicit invalid world-space measurement must never be silently
  // discarded while another axis makes the same part look cross-view
  // consistent. Missing axes are fine; malformed supplied facts are not.
  for (const observation of input.observations) {
    if (!observation || typeof observation !== "object" ||
        typeof observation.view !== "string" ||
        typeof observation.part_id !== "string" ||
        (observation.required !== undefined &&
          typeof observation.required !== "boolean") ||
        (observation.attachment_parent !== undefined &&
          observation.attachment_parent !== null &&
          typeof observation.attachment_parent !== "string")) {
      return { state: "unavailable" as const, reason: "observation_identity_invalid" as const };
    }
    const dimensions = observation.dimensions;
    if (dimensions === undefined) continue;
    if (!dimensions || typeof dimensions !== "object" ||
        Array.isArray(dimensions) ||
        Object.entries(dimensions).some(([axis, value]) =>
          !["x", "y", "z"].includes(axis) ||
          (value !== undefined && !finiteDimension(value))
        )) {
      return { state: "unavailable" as const, reason: "dimension_constraint_invalid" as const };
    }
  }

  const usable = input.observations
    .filter((entry) => entry.view.trim().length > 0 && entry.part_id.trim().length > 0)
    .map((entry) => ({
      ...entry,
      view: entry.view.trim().toLowerCase(),
      part_id: entry.part_id.trim(),
    }));
  const byPart = new Map<string, ReferencePartObservation[]>();
  for (const observation of usable) {
    const entries = byPart.get(observation.part_id) ?? [];
    entries.push(observation);
    byPart.set(observation.part_id, entries);
  }

  const issues: CrossViewIssue[] = [];
  let comparableDimensionCount = 0;
  let attachmentComparisonCount = 0;

  for (const [partId, observations] of byPart) {
    for (const axis of ["x", "y", "z"] as const) {
      const values = observations
        .map((entry) => ({ view: entry.view, value: entry.dimensions?.[axis] }))
        .filter((entry): entry is { view: string; value: number } => finiteDimension(entry.value));
      if (values.length < 2) continue;
      // Repeated claims from one view can reveal contradictions but never
      // establish independent cross-view support.
      if (new Set(values.map((entry) => entry.view)).size >= 2) comparableDimensionCount += 1;
      const min = Math.min(...values.map((entry) => entry.value));
      const max = Math.max(...values.map((entry) => entry.value));
      const basis = Math.max(max, Number.EPSILON);
      const relativeSpread = (max - min) / basis;
      if (relativeSpread > relativeTolerance) {
        issues.push({
          kind: "dimension_conflict",
          part_id: partId,
          axis,
          observations: values,
          relative_spread: Number(relativeSpread.toFixed(4)),
        });
      }
    }

    const parents = observations
      .filter((entry) => entry.attachment_parent !== undefined)
      .map((entry) => ({ view: entry.view, parent: canonicalParent(entry.attachment_parent) }));
    if (parents.length >= 2) {
      if (new Set(parents.map((entry) => entry.view)).size >= 2) attachmentComparisonCount += 1;
      if (new Set(parents.map((entry) => entry.parent ?? "<root>")).size > 1) {
        issues.push({ kind: "attachment_conflict", part_id: partId, observations: parents });
      }
    }
  }

  const requiredParts = [...byPart.entries()]
    .filter(([, observations]) => observations.some((entry) => entry.required === true))
    .map(([partId]) => partId)
    .sort();

  return {
    state: "available" as const,
    visual_verdict: "not_evaluated" as const,
    observation_count: usable.length,
    part_count: byPart.size,
    required_parts: requiredParts,
    comparable_dimension_count: comparableDimensionCount,
    attachment_comparison_count: attachmentComparisonCount,
    conflict_count: issues.length,
    conflict_examples: issues.slice(0, exampleLimit),
    conflict_examples_truncated: issues.length > exampleLimit,
    readiness:
      issues.length > 0
        ? ("conflicting" as const)
        : comparableDimensionCount + attachmentComparisonCount > 0
          ? ("consistent_with_available_constraints" as const)
          : ("insufficient_comparable_constraints" as const),
    note: "This evidence compares only explicit semantic/world-space constraints that multiple views claim about the same part. It never infers scale from pixels, never treats occlusion as absence, and never creates visual approval. Repeated claims from one view do not establish cross-view consistency, although contradictions remain reportable.",
  };
}
