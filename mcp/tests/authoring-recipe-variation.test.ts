import { describe, expect, test } from "bun:test";
import type { AdvancedGeometryFeature } from "@/lib/authoringRecipe/geometrySchema";
import { geometryMathProgramSchema } from "@/lib/authoringRecipe/geometryMathLanguage";
import { requireGeometryBoundedRevision } from "@/lib/authoringRecipe/geometryMathVariation";
import {
  buildAdvancedGeometryRecipeCandidate,
  reviewStoredAdvancedGeometrySource,
  requireStoredAdvancedGeometryRevisionSource,
} from "@/lib/authoringRecipe/geometryComposition";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { projectRecipeFormSignatures } from "@/lib/authoringRecipe/formSignature";

function seed(): AdvancedGeometryFeature {
  return {
    id: "organic-horn", kind: "program", label: "authored horn",
    evidence_refs: ["approved:side"],
    geometry_reasons: ["SILHOUETTE", "CONTACT"],
    program: {
      version: 14,
      scale_context: { model_units_per_block: 16 },
      parts: [{
        method: "PROFILE_SWEEP", id: "shaft",
        at: [0, 0, 0], cross_section: "RECTANGLE", up_axis: "Y",
        stations: [
          { position: [0, 0, 0], half_width: 3, half_height: 2, twist_degrees: 0 },
          { position: [7, 0, 0], half_width: 2, half_height: 1, twist_degrees: 0 },
        ],
      }],
      variation_bounds: [
        {
          id: "root-width", part_id: "shaft", station_index: 0,
          parameter: "half_width", min_value: 2, max_value: 4,
          evidence: { kind: "REFERENCE_CLAIM", source_ref: "approved:side" },
        },
        {
          id: "tip-width", part_id: "shaft", station_index: 1,
          parameter: "half_width", min_value: 1, max_value: 3,
          evidence: { kind: "DECLARED_SPEC" },
        },
      ],
      variation_invariants: [{
        kind: "MONOTONIC_STATIONS",
        id: "taper", part_id: "shaft", parameter: "half_width",
        direction: "NON_INCREASING",
      }],
    },
  };
}
type ProgramFeature = Extract<AdvancedGeometryFeature, { kind: "program" }>;

function edit(
  source: AdvancedGeometryFeature,
  apply: (feature: ProgramFeature) => void
): AdvancedGeometryFeature {
  const next = structuredClone(source);
  if (next.kind !== "program") throw new Error("test fixture");
  apply(next);
  return next;
}

function create(source = seed()) {
  return buildAdvancedGeometryRecipeCandidate({
    schema: 1, compiler_version: 1, id: "variation-recipe",
    name: "variation-recipe", prototypes: [], patterns: [],
  }, [source]).next_recipe;
}
function revise(source: AdvancedGeometryFeature, before = create()) {
  return buildAdvancedGeometryRecipeCandidate(before, [
    { ...source, replace_generated: true },
  ]).next_recipe;
}

describe("native Advanced Geometry revision source authority (pure gate)", () => {
  test("source-matched feature may revise without changing the stored Recipe", () => {
    const original = create();
    const before = structuredClone(original);
    expect(() => requireStoredAdvancedGeometryRevisionSource(
      original, ["organic-horn"]
    )).not.toThrow();
    expect(original).toEqual(before);
  });

  test("legacy Recipe with feature intent but no saved parameters cannot be overwritten", () => {
    const legacy = create();
    delete legacy.advanced_geometry_source;
    expect(legacy.feature_intents?.map(feature => feature.id))
      .toContain("organic-horn");
    expect(reviewStoredAdvancedGeometrySource(legacy).state)
      .toBe("LEGACY_SOURCE_UNAVAILABLE");
    expect(() => requireStoredAdvancedGeometryRevisionSource(
      legacy, ["organic-horn"]
    )).toThrow("ADVANCED_GEOMETRY_SAVED_SOURCE_REQUIRED");
  });

  test("drifted saved geometry sources fail before any native apply plan", () => {
    const drifted = create();
    drifted.feature_intents![0]!.label = "modified without source revision";
    expect(reviewStoredAdvancedGeometrySource(drifted).state)
      .toBe("SOURCE_RECIPE_MISMATCH");
    expect(() => requireStoredAdvancedGeometryRevisionSource(
      drifted, ["organic-horn"]
    )).toThrow("ADVANCED_GEOMETRY_SAVED_SOURCE_DRIFT");
  });

  test("unrelated feature intents cannot borrow Advanced Geometry source ownership", () => {
    const source = create();
    source.feature_intents!.push({
      id: "manual-detail",
      label: "separate authored surface detail",
      visual_role: "SURFACE_DETAIL",
      evidence: "SUPPORTED",
      evidence_refs: ["approved:side"],
    });
    // Review may legitimately match the existing horn source while the
    // Recipe contains unrelated semantic features. That is NOT ownership.
    expect(reviewStoredAdvancedGeometrySource(source).state)
      .toBe("AVAILABLE_MATCHED_SOURCE");
    expect(() => requireStoredAdvancedGeometryRevisionSource(
      source, ["manual-detail"]
    )).toThrow("ADVANCED_GEOMETRY_REVISION_FEATURE_NOT_OWNED");
    expect(() => requireStoredAdvancedGeometryRevisionSource(
      source, ["organic-horn", "manual-detail"]
    )).toThrow("ADVANCED_GEOMETRY_REVISION_FEATURE_NOT_OWNED");
    expect(() => requireStoredAdvancedGeometryRevisionSource(
      source, ["organic-horn"]
    )).not.toThrow();
  });
});

describe("R3aa v14 source-constrained feature variation", () => {
  test("v14 opt-in validates and projects only declared editable slots", () => {
    const initial = seed();
    if (initial.kind !== "program") throw new Error("test fixture");
    expect(geometryMathProgramSchema.parse(initial.program).version).toBe(14);
    const recipe = create(initial);
    expect(reviewStoredAdvancedGeometrySource(recipe).state)
      .toBe("AVAILABLE_MATCHED_SOURCE");
    const signatures = projectRecipeFormSignatures(recipe, {
      source_cohorts: recipe.advanced_geometry_source,
    });
    const entry = signatures.signatures[0]!;
    expect(entry.variation_policy).toBe("SOURCE_DECLARED_BOUNDS_UNVERIFIED");
    expect(entry.parameter_source?.variation_bounds).toEqual([
      { id: "root-width", part_id: "shaft", station_index: 0,
        parameter: "half_width", min_value: 2, max_value: 4,
        evidence: "REFERENCE_CLAIM" },
      { id: "tip-width", part_id: "shaft", station_index: 1,
        parameter: "half_width", min_value: 1, max_value: 3,
        evidence: "DECLARED_SPEC" },
    ]);
    expect(signatures.reference_content_attested).toBe(false);
    expect(signatures.visual_verdict).toBe("NOT_EVALUATED");
  });

  test("bounded taper change uses the existing Recipe edit without unrelated rewrites", () => {
    const original = create();
    const old = original.advanced_geometry_source![0]!;
    const allowed = edit(old, feature => {
      if (feature.program.version !== 14) throw new Error("test fixture");
      const part = feature.program.parts[0]!;
      if (part.method !== "PROFILE_SWEEP") throw new Error("test fixture");
      part.stations[0]!.half_width = 3.5;
      part.stations[1]!.half_width = 1.5;
    });
    const updated = revise(allowed, original);
    expect(updated.advanced_geometry_source?.[0]).toMatchObject(allowed);
    expect(compileAuthoringRecipe(updated).metrics.realized_cube_count)
      .toBeGreaterThan(0);
    expect(reviewStoredAdvancedGeometrySource(updated).state)
      .toBe("AVAILABLE_MATCHED_SOURCE");
    expect(original.advanced_geometry_source?.[0]).toEqual(old);
  });

  test("undocumented parameter, centerline, profile, label and policy changes fail closed", () => {
    const previous = seed();
    const stationEdit = (change: (part: Extract<
      Extract<ProgramFeature["program"], {version:14}>["parts"][number],
      {method:"PROFILE_SWEEP"}>) => void) =>
      edit(previous, feature => {
        if (feature.program.version !== 14) throw new Error("fixture");
        const part = feature.program.parts[0]!;
        if (part.method !== "PROFILE_SWEEP") throw new Error("fixture");
        change(part);
      });
    expect(() => requireGeometryBoundedRevision(previous,
      stationEdit(part => { part.stations[0]!.half_height = 3; })))
      .toThrow("GEOMETRY_VARIATION_UNDECLARED_SOURCE_CHANGE");
    expect(() => requireGeometryBoundedRevision(previous,
      stationEdit(part => { part.stations[0]!.position[0] = 1; })))
      .toThrow("GEOMETRY_VARIATION_UNDECLARED_SOURCE_CHANGE");
    expect(() => requireGeometryBoundedRevision(previous,
      stationEdit(part => { part.cross_section = "ELLIPSE"; })))
      .toThrow("GEOMETRY_VARIATION_UNDECLARED_SOURCE_CHANGE");
    expect(() => requireGeometryBoundedRevision(previous,
      edit(previous, feature => { feature.label = "randomized horn"; })))
      .toThrow("GEOMETRY_VARIATION_FEATURE_IDENTITY_LOCKED");
    expect(() => requireGeometryBoundedRevision(previous,
      edit(previous, feature => {
        if (feature.program.version !== 14) throw new Error("fixture");
        feature.program.variation_bounds[0]!.max_value = 8;
      })))
      .toThrow("GEOMETRY_VARIATION_UNDECLARED_SOURCE_CHANGE");
  });

  test("v14 source cannot downgrade to bypass its variation authority", () => {
    const old = seed();
    const lower = edit(old, feature => {
      feature.program = {
        ...(feature.program as Extract<ProgramFeature["program"], { version:14 }>),
        version: 13,
      };
    });
    expect(() => requireGeometryBoundedRevision(old, lower))
      .toThrow("GEOMETRY_VARIATION_SOURCE_VERSION_LOCKED");
  });

  test("outside bounds, reversed taper and invented targets are rejected", () => {
    const old = seed();
    const beyond = edit(old, feature => {
      if (feature.program.version !== 14) throw new Error("fixture");
      const part = feature.program.parts[0]!;
      if (part.method === "PROFILE_SWEEP") part.stations[0]!.half_width = 5;
    });
    expect(() => requireGeometryBoundedRevision(old, beyond)).toThrow();
    const reverse = edit(old, feature => {
      if (feature.program.version !== 14) throw new Error("fixture");
      const part = feature.program.parts[0]!;
      if (part.method === "PROFILE_SWEEP") {
        part.stations[0]!.half_width = 2;
        part.stations[1]!.half_width = 3;
      }
    });
    expect(() => requireGeometryBoundedRevision(old, reverse)).toThrow();
    const invalidOwner = edit(old, feature => {
      if (feature.program.version !== 14) throw new Error("fixture");
      feature.program.variation_bounds[0]!.part_id = "missing";
    });
    expect(() => create(invalidOwner)).toThrow();
    const duplicate = edit(old, feature => {
      if (feature.program.version !== 14) throw new Error("fixture");
      feature.program.variation_bounds.push(
        structuredClone(feature.program.variation_bounds[0]!)
      );
    });
    expect(() => create(duplicate)).toThrow();
  });

  test("unbound reference claims fail; claims never become visual evidence", () => {
    const bad = edit(seed(), feature => {
      if (feature.program.version !== 14) throw new Error("fixture");
      feature.program.variation_bounds[0]!.evidence = {
        kind: "REFERENCE_CLAIM", source_ref: "not-approved",
      };
    });
    expect(() => create(bad)).toThrow(
      "GEOMETRY_VARIATION_UNBOUND_REFERENCE_CLAIM"
    );
    expect(projectRecipeFormSignatures(create()).native_geometry_attested)
      .toBe(false);
  });

  test("existing dimension acceptance still blocks an allowed but oversized taper", () => {
    const start = seed();
    if (start.kind !== "program" || start.program.version !== 14) {
      throw new Error("fixture");
    }
    start.program.dimension_constraints = [{
      kind: "SPAN_BOUNDS", id: "preserve-height",
      part_id: "shaft", axis: "Y", min_span: 0, max_span: 6,
    }];
    const original = create(start);
    const varied = edit(original.advanced_geometry_source![0]!, feature => {
      if (feature.program.version !== 14) throw new Error("fixture");
      const shaft = feature.program.parts[0]!;
      if (shaft.method !== "PROFILE_SWEEP") throw new Error("fixture");
      shaft.stations[0]!.half_width = 4; // allowed interval, prohibited full span
    });
    expect(() => revise(varied, original))
      .toThrow("GEOMETRY_MATH_SPAN_BOUNDS_VIOLATION");
  });

  test("v13 frozen sources still compile and cannot declare v14 variation metadata", () => {
    const legacy = edit(seed(), feature => {
      feature.program = {
        version: 13,
        scale_context: { model_units_per_block: 16 },
        parts: [{
          method: "PROFILE_SWEEP", id: "shaft",
          at: [0, 0, 0], cross_section: "RECTANGLE", up_axis: "Y",
          stations: [
            { position: [0, 0, 0], half_width: 3, half_height: 2, twist_degrees: 0 },
            { position: [7, 0, 0], half_width: 2, half_height: 1, twist_degrees: 0 },
          ],
        }],
      };
    });
    expect(compileAuthoringRecipe(create(legacy)).metrics.realized_cube_count)
      .toBeGreaterThan(0);
    if (legacy.kind !== "program") throw new Error("fixture");
    expect(() => geometryMathProgramSchema.parse({
      ...legacy.program,
      variation_bounds: [{ id: "x" }],
    })).toThrow();
  });
});
