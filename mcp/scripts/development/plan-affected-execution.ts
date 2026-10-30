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
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";


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


/**
 * Read-only audit of graph branches that require an explicit discriminator.
 * Without a branch, manifestEntryForBranch has no graph for these entries,
 * so search-time readiness can default to READY even when an operation is
 * unknown. This diagnosis never changes Runtime eligibility or source hashes.
 */
function graphBranchReadinessReview(changedPaths: readonly string[]) {
  const changed = new Set(changedPaths.map((path) =>
    path.replaceAll("\\", "/").replace(/^\.\//, "")
  ));
  if (!changed.has("mcp/gateway/capabilities/graph.ts") &&
      !changed.has("mcp/gateway/capabilities/manifest.ts")) return null;

  const byCapability = new Map<
    string, typeof CAPABILITY_BRANCH_MANIFEST[number][]
  >();
  for (const entry of CAPABILITY_BRANCH_MANIFEST) {
    const entries = byCapability.get(entry.capability) ?? [];
    entries.push(entry);
    byCapability.set(entry.capability, entries);
  }

  const candidates = [...byCapability].flatMap(([capability, entries]) => {
    // Do not invent ambiguity for registered extensions, a truly branchless
    // graph, or a single explicitly supported operation.
    const variants = entries.filter((entry) => entry.branch && entry.graph);
    if (variants.length < 2 || entries.some((entry) => !entry.branch && entry.graph)) {
      return [];
    }
    const prerequisites = [...new Set(variants.flatMap(
      (entry) => [...(entry.graph?.requires ?? [])]
    ))].sort();
    if (prerequisites.length === 0) return [];
    return [{
      capability,
      branch_count: variants.length,
      possible_branches: variants.map((entry) => entry.branch!),
      prerequisites,
    }];
  }).sort((a, b) => a.capability.localeCompare(b.capability));
  return {
    status: "OPEN_BRANCH_SELECTION_REVIEW" as const,
    source_only: true,
    candidates: candidates.slice(0, 12),
    omitted_count: Math.max(0, candidates.length - 12),
    // Generation and native execution have not been performed.
    next_action: "Resolve branchless readiness in the canonical graph, synchronize semantic/API revisions, and verify matching source",
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
  const graphReview = graphBranchReadinessReview(changedPaths);

  return {
    semantic_impact: semanticImpact,
    ...(graphReview ? { graph_branch_readiness_review: graphReview } : {}),
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

/** Git-aware entry to the existing affected planner; no new task runner. */
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
function gitText(args: readonly string[]): string {
  try {
    return execFileSync("git", [...args], {
      cwd: REPOSITORY_ROOT, encoding: "utf8", windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error("Affected Git selection unavailable: " +
      (error instanceof Error ? error.message : String(error)));
  }
}

/** Git -z lists must not be split on whitespace/newlines. */
export function parseGitNameOnlyPaths(output: string): string[] {
  if (output !== "" && !output.endsWith("\0")) {
    throw new Error("Incomplete NUL-delimited Git path listing.");
  }
  return output.split("\0").filter(Boolean);
}

/** Dirty checkout: all tracked + nonignored untracked changes.
 * Clean checkout: first-parent HEAD changes, or the initial tracked tree.
 * --no-renames retains both removed and added owner paths.
 */
export function discoverAffectedGitPaths(): string[] {
  const dirty = [
    ...parseGitNameOnlyPaths(gitText(["diff", "--no-renames", "--name-only", "-z", "HEAD", "--"])),
    ...parseGitNameOnlyPaths(gitText(["ls-files", "--others", "--exclude-standard", "-z", "--"])),
  ];
  if (dirty.length) return [...new Set(dirty)].sort();
  const [head, parent] = gitText(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/);
  if (!head || !/^[a-f0-9]{40}$/i.test(head)) {
    throw new Error("Cannot identify Git HEAD for affected selection.");
  }
  const changed = parent
    ? gitText(["diff", "--no-renames", "--name-only", "-z", parent, head, "--"])
    : gitText(["ls-tree", "-r", "--name-only", "-z", head]);
  return [...new Set(parseGitNameOnlyPaths(changed))].sort();
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
  if (args[0] === "--") args.shift();
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

  const expectedIndex = args.indexOf("--expect-sha");
  let expectedSha: string | undefined;
  if (expectedIndex >= 0) {
    const sha = args[expectedIndex + 1];
    if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) {
      throw new Error("--expect-sha requires an exact 40-hex commit SHA.");
    }
    expectedSha = sha;
    args.splice(expectedIndex, 2);
  }
  const autoIndex = args.indexOf("--auto");
  const auto = autoIndex >= 0;
  if (auto) args.splice(autoIndex, 1);
  if (args.some(path => path.startsWith("--"))) {
    throw new Error("Unknown affected-selection option.");
  }
  if (auto && args.length > 0) {
    throw new Error("--auto cannot be mixed with explicit changed paths.");
  }
  if (expectedSha) {
    const actual = gitText(["rev-parse", "--verify", "HEAD"]).trim();
    if (actual.toLowerCase() !== expectedSha.toLowerCase()) {
      throw new Error("Expected source SHA does not match current Git HEAD; no verifier started.");
    }
  }
  return {
    changedPaths: auto ? discoverAffectedGitPaths() : args.filter(Boolean),
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