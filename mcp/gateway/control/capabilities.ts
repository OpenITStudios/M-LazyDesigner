import type { CapabilitySummary } from "../contracts/protocol";
import { getCapabilityMetadata } from "../../lib/capabilities/metadata";
import { manifestEntryForBranch } from "../capabilities/manifest";
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
    return {
      capability_id: capability.capability_id,
      ...(hint ? { hint } : {}),
      ...(capability.branch ? { branch: capability.branch } : {}),
      ...(capability.why ? { why: capability.why } : {}),
      ...(capability.eligibility && capability.eligibility !== "READY"
        ? { eligibility: capability.eligibility }
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
