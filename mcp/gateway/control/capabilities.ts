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
 * Search is orientation, not native availability. Unselected/unsupported
 * branch identities are not a READY operation. A declared mutation with no
 * branch graph also lacks proved prerequisites, even if its schema is valid.
 * Read-only graphless branches remain discoverable without extra ceremony.
 */
function searchBranchReadinessHint(
  capability: CapabilitySummary,
  operationClass: string
): "UNRESOLVED_OPERATION" | "UNDECLARED_MUTATION_GRAPH" | null {
  const branches = manifestEntriesForCapability(capability.capability_id)
    .filter((entry) => entry.branch);
  if (branches.length === 0) return null;
  if (!capability.branch) return "UNRESOLVED_OPERATION";
  const exact = branches.find((entry) =>
    entry.branch?.field === capability.branch?.field &&
    entry.branch.value === capability.branch?.value
  );
  if (!exact) return "UNRESOLVED_OPERATION";
  return !exact.graph && operationClass === "MUTATION"
    ? "UNDECLARED_MUTATION_GRAPH"
    : null;
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
    const branchHint = searchBranchReadinessHint(capability, operationClass);
    // Preserve a confirmed BLOCKED verdict. UNKNOWN is AI-facing guidance,
    // not an early rejection or a change to Runtime schema/Graph authority.
    const eligibility = branchHint && capability.eligibility !== "BLOCKED"
      ? "UNKNOWN" as const
      : capability.eligibility;
    const why = branchHint
      ? [
          capability.why,
          branchHint === "UNRESOLVED_OPERATION"
            ? "Operation branch not resolved; describe the exact operation before invoking."
            : "Mutation prerequisites are not declared in the Graph; Runtime validates the operation.",
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
