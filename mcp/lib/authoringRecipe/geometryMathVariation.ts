import type { AdvancedGeometryFeature } from "./geometrySchema";
import {
  geometryMathProgramSchema,
  type GeometryMathProgram,
} from "./geometryMathLanguage";

/**
 * One pure owner for opt-in source-declared variation safety.
 * No second constraint solver, generative randomness, mutable registry,
 * native Blockbench globals, or implicit artistic/visual approval.
 *
 * All existing geometry/scale/anchor constraints continue to run when the
 * varied feature is recompiled through the existing Recipe engine.
 */
type VariationProgram = Extract<GeometryMathProgram, { version: 14 }>;

function canonical(value: unknown): string {
  const ordered = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
          .map(([key, part]) => [key, ordered(part)])
      );
    }
    return item;
  };
  return JSON.stringify(ordered(value));
}

/** Claims are source references, not authenticated observations. */
export function requireGeometryVariationEvidence(
  program: VariationProgram,
  refs: readonly string[]
): void {
  const declared = new Set(refs);
  for (const bound of program.variation_bounds) {
    if (bound.evidence.kind === "REFERENCE_CLAIM" &&
      !declared.has(bound.evidence.source_ref)) {
      throw new Error(
        "GEOMETRY_VARIATION_UNBOUND_REFERENCE_CLAIM: " + bound.id
      );
    }
  }
}

/**
 * Once v14 is authored, its existing variation envelope owns subsequent
 * revisions. A new feature can opt in; an established v14 feature cannot
 * loosen/replace limits by re-submitting a different program, style,
 * geometry kind, reference, station path or relation policy.
 *
 * The only allowed delta is one or more explicitly listed scalar slots,
 * each inside its *original stored* interval. The canonical compiler then
 * checks the complete next model; this function does not assert visual
 * identity or authorize re-texturing.
 */
export function requireGeometryBoundedRevision(
  previous: AdvancedGeometryFeature | undefined,
  proposed: AdvancedGeometryFeature
): void {
  if (previous?.kind !== "program" || previous.program.version !== 14) return;
  if (proposed.kind !== "program" || proposed.program.version !== 14) {
    throw new Error("GEOMETRY_VARIATION_SOURCE_VERSION_LOCKED");
  }
  const before = geometryMathProgramSchema.parse(previous.program);
  const after = geometryMathProgramSchema.parse(proposed.program);
  if (before.version !== 14 || after.version !== 14) {
    throw new Error("GEOMETRY_VARIATION_SOURCE_VERSION_LOCKED");
  }
  const expected = structuredClone(before);
  for (const bound of before.variation_bounds) {
    const sourcePart = expected.parts.find(part => part.id === bound.part_id);
    const targetPart = after.parts.find(part => part.id === bound.part_id);
    if (sourcePart?.method !== "PROFILE_SWEEP" ||
      targetPart?.method !== "PROFILE_SWEEP" ||
      !sourcePart.stations[bound.station_index] ||
      !targetPart.stations[bound.station_index]) {
      throw new Error("GEOMETRY_VARIATION_STATION_OWNER_DRIFT: " + bound.id);
    }
    const amount = targetPart.stations[bound.station_index]![bound.parameter];
    if (!Number.isFinite(amount) || amount < bound.min_value ||
      amount > bound.max_value) {
      throw new Error("GEOMETRY_VARIATION_OUT_OF_BOUNDS: " + bound.id);
    }
    sourcePart.stations[bound.station_index]![bound.parameter] = amount;
  }
  // Source parameter classes, constraints, identities, authored station
  // positions, initial up axis and bounded policy must be unchanged.
  if (canonical(expected) !== canonical(after)) {
    throw new Error("GEOMETRY_VARIATION_UNDECLARED_SOURCE_CHANGE");
  }
  const withoutProgram = (feature: AdvancedGeometryFeature) => {
    const { replace_generated: _permission, ...record } = feature;
    if (record.kind !== "program") return record;
    const { program: _program, ...identity } = record;
    return identity;
  };
  if (canonical(withoutProgram(previous)) !==
    canonical(withoutProgram(proposed))) {
    throw new Error("GEOMETRY_VARIATION_FEATURE_IDENTITY_LOCKED");
  }
}
