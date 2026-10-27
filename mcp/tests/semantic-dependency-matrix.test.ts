import { describe, expect, test } from "bun:test";
import {
  SEMANTIC_DEPENDENCY_MATRIX,
  semanticDependenciesForSurface,
  semanticSurfacesAffectedByDimensions,
} from "../gateway/development/semanticDependencyMatrix";
import {
  buildAffectedExecutionPlan,
  parseAffectedExecutionArguments,
} from "../scripts/development/plan-affected-execution";
import { assertSemanticSourceAlignedForAffectedRun } from
  "../scripts/development/run-affected-execution";
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
    expect(planned.execution.checks).toContain("DOCS_FRESHNESS");
    expect(() => assertSemanticSourceAlignedForAffectedRun(planned))
      .toThrow("SEMANTIC_REVISION_UNVERIFIED: SNAPSHOT_REQUIRED");
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
    expect(planned.execution.checks).toContain("DOCS_FRESHNESS");
    expect(() => assertSemanticSourceAlignedForAffectedRun(planned))
      .toThrow("SEMANTIC_REVISION_UNVERIFIED: IMPLEMENTATION_REVISION_GAP");
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
    expect(planned.execution.checks).toContain("DOCS_FRESHNESS");
    expect(planned.execution.commands.some(
      (command) => command === "bun run docs:check" ||
        command === "bun run verify:full"
    )).toBe(true);
    // An observed manifest change is not a code-implementation fingerprint.
    expect(() => assertSemanticSourceAlignedForAffectedRun(planned))
      .toThrow("SEMANTIC_REVISION_UNVERIFIED: MANIFEST_REVISION_CHANGED");
  });

  test("schema-only manifest changes do not qualify executable routing code", () => {
    const baseline = CAPABILITY_SEMANTIC_REGISTRY.map((entry, i) =>
      i === 0 ? {
        ...entry,
        semanticFingerprint: "0".repeat(64),
        fingerprints: {
          ...entry.fingerprints,
          schema_projection: "0".repeat(64),
          aggregate: "0".repeat(64),
        },
      } : entry
    );
    const planned = buildAffectedExecutionPlan(
      ["mcp/gateway/capabilities/intelligence.ts"], baseline
    );
    expect(planned.semantic_diff?.some((diff) =>
      diff.dimensions.includes("SCHEMA_PROJECTION")
    )).toBe(true);
    expect(planned.semantic_source_alignment).toMatchObject({
      status: "IMPLEMENTATION_REVISION_GAP",
      untracked_dimensions: ["routing"],
    });
    expect(() => assertSemanticSourceAlignedForAffectedRun(planned))
      .toThrow("SEMANTIC_REVISION_UNVERIFIED: IMPLEMENTATION_REVISION_GAP");
  });

  test("does not demand generator sync for an unrelated authoring regression", () => {
    const planned = buildAffectedExecutionPlan([
      "mcp/tests/semantic-dependency-matrix.test.ts",
    ]);
    expect(planned.semantic_source_alignment).toBeUndefined();
    expect(() => assertSemanticSourceAlignedForAffectedRun(planned))
      .not.toThrow();
  });

  test("both CLI parsers fail closed when a snapshot path is missing", async () => {
    await expect(parseAffectedExecutionArguments([
      "mcp/gateway/capabilities/catalog.ts",
      "--previous-semantic-snapshot",
    ])).rejects.toThrow("--previous-semantic-snapshot requires a JSON file path.");
  });
  test("source-only graph review identifies branchless readiness risks from canonical manifest", () => {
    const plan = buildAffectedExecutionPlan([
      "./mcp\\gateway\\capabilities\\graph.ts",
    ]);
    const review = plan.graph_branch_readiness_review;
    expect(review).toMatchObject({
      status: "OPEN_BRANCH_SELECTION_REVIEW",
      source_only: true,
      omitted_count: 0,
    });
    const texture = review?.candidates.find((entry) =>
      entry.capability === "create_texture"
    );
    expect(texture?.branch_count).toBeGreaterThanOrEqual(2);
    expect(texture?.prerequisites).toEqual(
      expect.arrayContaining(["project_bound", "geometry_available", "texture_available"])
    );
    const uv = review?.candidates.find((entry) =>
      entry.capability === "manage_uv_layout"
    );
    expect(uv?.possible_branches).toContainEqual({
      field: "operation", value: "apply",
    });
    // A diagnostic does not remove source revision or generated API gates.
    expect(plan.semantic_source_alignment?.generator_sync_required).toBe(true);
    expect(() => assertSemanticSourceAlignedForAffectedRun(plan))
      .toThrow("SEMANTIC_REVISION_UNVERIFIED");
  });

  test("branchless review is scoped to graph or manifest source, not unrelated work", () => {
    const unrelated = buildAffectedExecutionPlan([
      "mcp/tests/semantic-dependency-matrix.test.ts",
    ]);
    expect(unrelated.graph_branch_readiness_review).toBeUndefined();

    const manifest = buildAffectedExecutionPlan([
      "mcp/gateway/capabilities/manifest.ts",
    ]);
    expect(manifest.graph_branch_readiness_review?.candidates.some(
      (entry) => entry.capability === "manage_cubes"
    )).toBe(true);
    expect(manifest.graph_branch_readiness_review?.candidates.length).toBeLessThanOrEqual(12);
  });

  test.each([
    "mcp/gateway/capabilities/manifest.ts",
    "mcp/gateway/capabilities/semanticRegistry.ts",
    "mcp/gateway/development/semanticArtifact.ts",
    "mcp/scripts/generate/generate-docs.ts",
    "mcp/scripts/generate/internal/docs-manifest.ts",
    "mcp/scripts/generate/generate-hybrid4-schemas.ts",
    "mcp/docs/llms/install.md",
    "mcp/docs/api.json",
    "mcp/docs/index.html",
    "mcp/prompts/manifest.json",
    "mcp/gateway/experimental/generated/hybrid4Schemas.ts",
  ])("generator-owned source or output %s requires docs freshness", (path) => {
    const plan = buildAffectedExecutionPlan([path]);
    expect(plan.execution.checks).toContain("DOCS_FRESHNESS");
    expect(plan.execution.commands.some(
      (command) => command === "bun run docs:check" ||
        command === "bun run verify:full"
    )).toBe(true);
  });

  test("unrelated Gateway session source does not trigger generated-doc checks", () => {
    const plan = buildAffectedExecutionPlan([
      "mcp/gateway/session/state.ts",
    ]);
    expect(plan.execution.checks).not.toContain("DOCS_FRESHNESS");
    expect(plan.execution.commands).not.toContain("bun run docs:check");
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
