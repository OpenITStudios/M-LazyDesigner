import { analyzeSemanticImpact } from "../../gateway/development/impact";
import { planAffectedExecution } from "../../gateway/development/affectedExecution";
import { CAPABILITY_BRANCH_MANIFEST } from "../../gateway/capabilities/manifest";
import { listExplicitSourceOwners } from "../../gateway/development/sourceOwners";
import {
  CAPABILITY_SEMANTIC_REGISTRY,
  diffCapabilitySemanticRegistry,
  type CapabilitySemanticRecord,
  type SemanticRevisionDimension,
} from "../../gateway/capabilities/semanticRegistry";
import { planSemanticInvalidation } from "../../gateway/development/semanticInvalidation";
import { readFile } from "node:fs/promises";


/**
 * The registry fingerprints manifest semantics/synonyms; it does not hash the
 * Gateway's executable ranking and graph implementations. Record the minimum
 * generator-sync risk in the existing read-only impact plan, never invent a
 * replacement fingerprint or claim that current docs were regenerated.
 */
const SEMANTIC_IMPLEMENTATION_DIMENSIONS: Readonly<
  Record<string, SemanticRevisionDimension>
> = {
  "mcp/gateway/capabilities/catalog.ts": "routing",
  "mcp/gateway/capabilities/intelligence.ts": "routing",
  "mcp/gateway/capabilities/graph.ts": "graph",
  "mcp/gateway/capabilities/schemaProjection.ts": "schema_projection",
};

function semanticSourceRevisionAlignment(
  paths: readonly string[],
  previous: readonly CapabilitySemanticRecord[] | undefined,
  diffs: ReturnType<typeof diffCapabilitySemanticRegistry>
) {
  const owners = [...new Set(paths.map((path) =>
    path.replaceAll("\\", "/").replace(/^\.\//, "")
  ))].filter((path) => SEMANTIC_IMPLEMENTATION_DIMENSIONS[path]);
  if (owners.length === 0) return null;

  const impacted = [...new Set(owners.map(
    (path) => SEMANTIC_IMPLEMENTATION_DIMENSIONS[path]!
  ))].sort();
  const changed = new Set<SemanticRevisionDimension>();
  for (const diff of diffs) {
    if (diff.change !== "CHANGED") {
      changed.add("routing");
      changed.add("graph");
      changed.add("schema_projection");
    } else {
      for (const dimension of diff.dimensions) {
        changed.add(dimension.toLowerCase() as SemanticRevisionDimension);
      }
    }
  }
  const untracked = impacted.filter((dimension) => !changed.has(dimension));
  return {
    changed_implementation_paths: owners.sort(),
    impacted_dimensions: impacted,
    status: !previous
      ? "SNAPSHOT_REQUIRED" as const
      : untracked.length > 0
        ? "IMPLEMENTATION_REVISION_GAP" as const
        : "MANIFEST_REVISION_CHANGED" as const,
    untracked_dimensions: !previous ? impacted : untracked,
    // Even a changed revision still needs generator-owned API artifacts.
    generator_sync_required: true,
    // This is advice only; no generator, verification, or source mutation.
    next_action: "Review semantic revision inputs, regenerate canonical API artifacts, and verify exact-SHA freshness before rollout",
  };
}

export function buildAffectedExecutionPlan(
  changedPaths: readonly string[],
  previousSemanticRegistry?: readonly CapabilitySemanticRecord[]
) {
  const semanticImpact = analyzeSemanticImpact({
    changedPaths,
    sourceOwners: listExplicitSourceOwners(),
    manifest: CAPABILITY_BRANCH_MANIFEST,
  });
  const semanticDiff = previousSemanticRegistry
    ? diffCapabilitySemanticRegistry(
        previousSemanticRegistry,
        CAPABILITY_SEMANTIC_REGISTRY
      )
    : [];
  const semanticInvalidation = previousSemanticRegistry
    ? planSemanticInvalidation(semanticDiff)
    : undefined;

  const sourceAlignment = semanticSourceRevisionAlignment(
    changedPaths, previousSemanticRegistry, semanticDiff
  );

  return {
    semantic_impact: semanticImpact,
    ...(sourceAlignment ? { semantic_source_alignment: sourceAlignment } : {}),
    ...(semanticInvalidation
      ? {
          semantic_diff: semanticDiff,
          semantic_invalidation: semanticInvalidation,
        }
      : {}),
    execution: planAffectedExecution({
      changedPaths,
      semanticImpact,
      ...(semanticInvalidation ? { semanticInvalidation } : {}),
      ...(sourceAlignment ? { semanticSourceAlignment: sourceAlignment } : {}),
    }),
  };
}

/**
 * Share the same snapshot input contract across plan-only and run CLIs.
 * Source comparisons are read-only and never refresh Runtime state.
 */
export async function parseAffectedExecutionArguments(
  rawArgs: readonly string[]
): Promise<{
  changedPaths: string[];
  previousSemanticRegistry?: CapabilitySemanticRecord[];
}> {
  const args = [...rawArgs];
  const index = args.indexOf("--previous-semantic-snapshot");
  let previousSemanticRegistry: CapabilitySemanticRecord[] | undefined;
  if (index >= 0) {
    const path = args[index + 1];
    if (!path || path.startsWith("--")) {
      throw new Error("--previous-semantic-snapshot requires a JSON file path.");
    }
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error("Previous semantic registry snapshot must be a JSON array.");
    }
    previousSemanticRegistry = parsed as CapabilitySemanticRecord[];
    args.splice(index, 2);
  }
  return {
    changedPaths: args.filter(Boolean),
    ...(previousSemanticRegistry ? { previousSemanticRegistry } : {}),
  };
}

async function main() {
  const { changedPaths, previousSemanticRegistry } =
    await parseAffectedExecutionArguments(process.argv.slice(2));
  const plan = buildAffectedExecutionPlan(changedPaths, previousSemanticRegistry);
  console.log(JSON.stringify(plan, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}