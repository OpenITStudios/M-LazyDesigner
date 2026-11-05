import type { CapabilitySummary } from "../contracts/protocol";
import { getCapabilityMetadata } from "../../lib/capabilities/metadata";
import {
  manifestEntriesForCapability,
  manifestEntryForBranch,
} from "../capabilities/manifest";
import {
  authoringDomainForCapability,
  sourceOwnerForCapability,
} from "../development/sourceOwners";
import type {
  ControlAuthoringDomain,
  ControlCapabilitySummary,
} from "./types";

export function decorateCapabilities(
  capabilities: readonly CapabilitySummary[],
  currentDomain: ControlAuthoringDomain | null = null
): ControlCapabilitySummary[] {
  return capabilities.map((capability) => {
    const authoringDomain = authoringDomainForCapability(capability.capability_id);
    const domainKnown = currentDomain !== null;
    const current = domainKnown && (
      authoringDomain === "CORE" || authoringDomain === currentDomain
    );

    return {
      ...capability,
      control: {
        authoring_domain: authoringDomain,
        current_domain: current,
        eligibility: !domainKnown
          ? "AVAILABLE"
          : current
            ? authoringDomain === "CORE"
              ? "AVAILABLE"
              : "RECOMMENDED"
            : "FOREIGN_PHASE",
        source_owner: sourceOwnerForCapability(capability.capability_id),
      },
    };
  });
}


/**
 * Search runs without an orientation status read, so current_domain=false and
 * eligibility=AVAILABLE carry no decision signal. Keep the richer internal
 * decoration for policy/tests, but omit those constant fields at the AI-client
 * search boundary.
 */
function compactCapabilityHint(description: string): string | undefined {
  const normalized = description.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  const sentenceEnd = normalized.search(/[.!?](?:\s|$)/);
  const firstSentence =
    sentenceEnd >= 0 ? normalized.slice(0, sentenceEnd + 1) : normalized;
  const maxChars = 96;
  return firstSentence.length <= maxChars
    ? firstSentence
    : `${firstSentence.slice(0, maxChars - 1).trimEnd()}…`;
}

/**
 * Search is orientation, not a Runtime invocation. Where branch-qualified
 * prerequisites exist without a selected graph, a missing/unsupported
 * operation must not inherit implicit READY from the graph's no-entry path.
 * This uses the canonical branch manifest, not a duplicate capability table.
 */
function unresolvedSearchBranch(capability: CapabilitySummary): boolean {
  const entries = manifestEntriesForCapability(capability.capability_id);
  if (!entries.some((entry) =>
    entry.branch && (entry.graph?.requires?.length ?? 0) > 0
  )) return false;
  if (capability.branch) {
    return !entries.some((entry) =>
      entry.branch?.field === capability.branch?.field &&
      entry.branch.value === capability.branch?.value
    );
  }
  // A branchless graph can provide shared prerequisites, but it does not
  // choose an operation. Exact-name search skips graph evaluation, so an
  // unresolved qualified branch must not be presented as READY even when
  // shared fallback metadata exists (for example Animation timeline).
  return true;
}

/** AI-facing search only needs the canonical domain, not source-owner
 * enrichment discarded by the transport. Decorated callers remain supported. */
export function projectCapabilitiesForSearch(
  capabilities: readonly CapabilitySummary[]
) {
  return capabilities.map((capability) => {
    const metadata = getCapabilityMetadata(capability.capability_id);
    const branchMetadata = manifestEntryForBranch(
      capability.capability_id,
      capability.branch
    );
    const operationClass =
      branchMetadata?.operationClass ?? metadata.operationClass;
    const verificationClass =
      branchMetadata?.verificationClass ?? metadata.verificationClass;
    const executionClass =
      branchMetadata?.executionClass ?? metadata.executionClass;
    const flags = [
      ...(capability.read_only ? ["read_only" as const] : []),
      ...(capability.destructive ? ["destructive" as const] : []),
      ...(capability.idempotent ? ["idempotent" as const] : []),
    ];
    const hint = compactCapabilityHint(capability.description);
    const branchUnresolved = unresolvedSearchBranch(capability);
    // Preserve confirmed BLOCKED; otherwise mark unresolved branch routing
    // UNKNOWN only for the AI-facing search projection. Native executors and
    // graph facts are not modified by this presentation guard.
    const eligibility = branchUnresolved && capability.eligibility !== "BLOCKED"
      ? "UNKNOWN" as const
      : capability.eligibility;
    const why = branchUnresolved
      ? [
          capability.why,
          "Operation branch not resolved; describe the exact operation before invoking.",
        ].filter(Boolean).join(" ")
      : capability.why;
    return {
      capability_id: capability.capability_id,
      ...(hint ? { hint } : {}),
      ...(capability.branch ? { branch: capability.branch } : {}),
      ...(why ? { why } : {}),
      ...(eligibility && eligibility !== "READY"
        ? { eligibility }
        : {}),
      ...(capability.requires && capability.requires.length > 0
        ? { requires: capability.requires }
        : {}),
      ...(capability.predecessor
        ? { predecessor: capability.predecessor }
        : {}),
      tier: capability.tier,
      authoring_domain: authoringDomainForCapability(capability.capability_id),
      operation_class: operationClass,
      ...(verificationClass !== "not_applicable"
        ? { verification_class: verificationClass }
        : {}),
      ...(executionClass !== "normal"
        ? { execution_class: executionClass }
        : {}),
      ...(flags.length > 0 ? { flags } : {}),
    };
  });
}
