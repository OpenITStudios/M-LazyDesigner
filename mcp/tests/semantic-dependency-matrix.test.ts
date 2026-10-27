import { describe, expect, test } from "bun:test";
import {
  SEMANTIC_DEPENDENCY_MATRIX,
  semanticDependenciesForSurface,
  semanticSurfacesAffectedByDimensions,
} from "../gateway/development/semanticDependencyMatrix";
import { buildAffectedExecutionPlan } from "../scripts/development/plan-affected-execution";
import { CAPABILITY_SEMANTIC_REGISTRY } from "../gateway/capabilities/semanticRegistry";

describe("semantic dependency matrix", () => {
  test("centralizes all semantic consumers", () => {
    expect(SEMANTIC_DEPENDENCY_MATRIX.AUTHORING_SPECIALIST).toEqual([
      "routing",
      "graph",
    ]);
    expect(SEMANTIC_DEPENDENCY_MATRIX.DESCRIBE_SCHEMA).toEqual([
      "schema_projection",
    ]);
    expect(SEMANTIC_DEPENDENCY_MATRIX.CAPABILITY_MANIFEST).toEqual([
      "routing",
      "graph",
      "schema_projection",
    ]);
  });

  test("reverse lookup scopes routing without schema-only consumers", () => {
    const surfaces = semanticSurfacesAffectedByDimensions(["routing"]);
    expect(surfaces).toContain("CAPABILITY_SEARCH");
    expect(surfaces).toContain("AI_CONTEXT");
    expect(surfaces).not.toContain("DESCRIBE_SCHEMA");
    expect(surfaces).not.toContain("DOCS_API");
  });


  test("flags routing-only source changes with no manifest baseline", () => {
    const planned = buildAffectedExecutionPlan([
      "./mcp\\gateway\\capabilities\\catalog.ts",
      "mcp/gateway/capabilities/intelligence.ts",
    ]);
    expect(planned.semantic_source_alignment).toMatchObject({
      status: "SNAPSHOT_REQUIRED",
      changed_implementation_paths: [
        "mcp/gateway/capabilities/catalog.ts",
        "mcp/gateway/capabilities/intelligence.ts",
      ],
      impacted_dimensions: ["routing"],
      untracked_dimensions: ["routing"],
      generator_sync_required: true,
    });
    expect(planned.execution.targeted_tests)
      .toContain("mcp/gateway/capabilities/intelligence.test.ts");
  });

  test("flags algorithm drift invisible to a manifest-only semantic snapshot", () => {
    const planned = buildAffectedExecutionPlan(
      ["mcp/gateway/capabilities/graph.ts"],
      CAPABILITY_SEMANTIC_REGISTRY
    );
    expect(planned.semantic_diff).toEqual([]);
    expect(planned.semantic_source_alignment).toMatchObject({
      status: "IMPLEMENTATION_REVISION_GAP",
      impacted_dimensions: ["graph"],
      untracked_dimensions: ["graph"],
      generator_sync_required: true,
    });
  });

  test("acknowledges a manifest revision without pretending API is regenerated", () => {
    const previous = CAPABILITY_SEMANTIC_REGISTRY.map((entry, i) =>
      i === 0 ? {
        ...entry,
        semanticFingerprint: "0".repeat(64),
        fingerprints: {
          ...entry.fingerprints,
          routing: "0".repeat(64),
          aggregate: "0".repeat(64),
        },
      } : entry
    );
    const planned = buildAffectedExecutionPlan(
      ["mcp/gateway/capabilities/intelligence.ts"], previous
    );
    expect(planned.semantic_diff?.some((diff) =>
      diff.dimensions.includes("ROUTING")
    )).toBe(true);
    expect(planned.semantic_source_alignment).toMatchObject({
      status: "MANIFEST_REVISION_CHANGED",
      untracked_dimensions: [],
      generator_sync_required: true,
    });
  });

  test("does not demand generator sync for an unrelated authoring regression", () => {
    const planned = buildAffectedExecutionPlan([
      "mcp/tests/semantic-dependency-matrix.test.ts",
    ]);
    expect(planned.semantic_source_alignment).toBeUndefined();
  });
  test("surface lookup returns defensive copies", () => {
    const first = semanticDependenciesForSurface("AI_CONTEXT");
    first.push("schema_projection");
    expect(semanticDependenciesForSurface("AI_CONTEXT")).toEqual([
      "routing",
      "graph",
    ]);
  });
});
