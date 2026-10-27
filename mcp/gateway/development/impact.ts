import type { DevelopmentSourceOwner } from "./types";
import { anchorTestForSourceOwner } from "./sourceOwners";
import type { CapabilityBranchManifestEntry } from "../capabilities/manifest";

export type SemanticImpactReason =
  | "DIRECT_SOURCE"
  | "DIRECT_ANCHOR_TEST"
  | "DIRECT_SPECIALIST"
  | "REQUIRES_CHANGED_FACT"
  | "PREDECESSOR_CHANGED";

export type SemanticImpactEntry = {
  capability: string;
  semantic_ids: string[];
  reasons: SemanticImpactReason[];
  source_owner: DevelopmentSourceOwner | null;
};

export type SemanticImpactReport = {
  changed_paths: string[];
  direct_capabilities: string[];
  affected_capabilities: SemanticImpactEntry[];
  affected_sources: string[];
  affected_anchor_tests: string[];
  affected_specialists: string[];
  truncated: boolean;
};

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function semanticIdsForCapability(
  manifest: readonly CapabilityBranchManifestEntry[],
  capability: string
): string[] {
  return manifest
    .filter((entry) => entry.capability === capability)
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));
}

function addReason(
  reasons: Map<string, Set<SemanticImpactReason>>,
  capability: string,
  reason: SemanticImpactReason
): void {
  const existing = reasons.get(capability) ?? new Set<SemanticImpactReason>();
  existing.add(reason);
  reasons.set(capability, existing);
}

/**
 * Computes a bounded semantic blast radius from changed repository paths.
 *
 * The graph is intentionally derived from existing canonical owners:
 * - explicit capability source/test/specialist ownership;
 * - capability branch requires/produces/invalidates relationships;
 * - explicit predecessor relationships.
 *
 * No generated index is authoritative here.
 */
export function analyzeSemanticImpact(input: {
  changedPaths: readonly string[];
  sourceOwners: Readonly<Record<string, DevelopmentSourceOwner>>;
  manifest: readonly CapabilityBranchManifestEntry[];
  maxCapabilities?: number;
}): SemanticImpactReport {
  const changed = new Set(input.changedPaths.map(normalizePath));
  const maxCapabilities = Math.max(1, Math.trunc(input.maxCapabilities ?? 24));
  const reasons = new Map<string, Set<SemanticImpactReason>>();
  const direct = new Set<string>();

  for (const [capability, owner] of Object.entries(input.sourceOwners)) {
    if (changed.has(normalizePath(owner.source))) {
      direct.add(capability);
      addReason(reasons, capability, "DIRECT_SOURCE");
    }
    const anchorTest = anchorTestForSourceOwner(owner);
    if (anchorTest && changed.has(normalizePath(anchorTest))) {
      direct.add(capability);
      addReason(reasons, capability, "DIRECT_ANCHOR_TEST");
    }
    if (owner.specialist && changed.has(normalizePath(owner.specialist))) {
      direct.add(capability);
      addReason(reasons, capability, "DIRECT_SPECIALIST");
    }
  }

  const consumersByFact = new Map<string, Set<string>>();
  const predecessors = new Map<string, Set<string>>();

  for (const entry of input.manifest) {
    for (const fact of entry.graph?.requires ?? []) {
      const consumers = consumersByFact.get(fact) ?? new Set<string>();
      consumers.add(entry.capability);
      consumersByFact.set(fact, consumers);
    }
    if (entry.graph?.predecessor) {
      const dependents =
        predecessors.get(entry.graph.predecessor.capability) ?? new Set<string>();
      dependents.add(entry.capability);
      predecessors.set(entry.graph.predecessor.capability, dependents);
    }
  }

  const orderedDirect = [...direct].sort((a, b) => a.localeCompare(b));
  const queue = orderedDirect.slice(0, maxCapabilities);
  const visited = new Set(queue);
  // Visiting the last allowed capability is not itself truncation. Drain all
  // admitted nodes to see whether they actually lead beyond the budget.
  // Enqueuing additional capabilities remains capped by maxCapabilities.
  while (queue.length > 0) {
    const capability = queue.shift()!;
    // A source change may revoke a fact without producing a new one (e.g.
    // Cube edits invalidate a UV plan). Both effects can change downstream
    // prerequisite decisions and must reach their canonical regression owners.
    // This is impact planning only; no Runtime facts are mutated here.
    const changedFacts = input.manifest
      .filter((entry) => entry.capability === capability)
      .flatMap((entry) => [
        ...(entry.graph?.produces ?? []),
        ...(entry.graph?.invalidates ?? []),
      ]);

    for (const fact of uniqueSorted(changedFacts)) {
      for (const consumer of consumersByFact.get(fact) ?? []) {
        if (consumer === capability) continue;
        addReason(reasons, consumer, "REQUIRES_CHANGED_FACT");
        if (!visited.has(consumer) && visited.size < maxCapabilities) {
          visited.add(consumer);
          queue.push(consumer);
        }
      }
    }

    for (const dependent of predecessors.get(capability) ?? []) {
      addReason(reasons, dependent, "PREDECESSOR_CHANGED");
      if (!visited.has(dependent) && visited.size < maxCapabilities) {
        visited.add(dependent);
        queue.push(dependent);
      }
    }
  }

  const affectedCapabilities = [...visited]
    .sort((a, b) => a.localeCompare(b))
    .map((capability) => ({
      capability,
      semantic_ids: semanticIdsForCapability(input.manifest, capability),
      reasons: [...(reasons.get(capability) ?? [])].sort(),
      source_owner: input.sourceOwners[capability] ?? null,
    }));

  const owners = affectedCapabilities
    .map((entry) => entry.source_owner)
    .filter((owner): owner is DevelopmentSourceOwner => owner !== null);

  return {
    changed_paths: uniqueSorted(changed),
    direct_capabilities: uniqueSorted(direct),
    affected_capabilities: affectedCapabilities,
    affected_sources: uniqueSorted(owners.map((owner) => owner.source)),
    affected_anchor_tests: uniqueSorted(
      owners.flatMap((owner) => {
        const anchorTest = anchorTestForSourceOwner(owner);
        return anchorTest ? [anchorTest] : [];
      })
    ),
    affected_specialists: uniqueSorted(
      owners.flatMap((owner) => (owner.specialist ? [owner.specialist] : []))
    ),
    truncated:
      queue.length > 0 ||
      [...reasons.keys()].some((capability) => !visited.has(capability)),
  };
}
