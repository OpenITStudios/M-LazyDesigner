import type { BackendTool } from "../contracts/protocol";
import { capabilityOperationClassByName, type CapabilityOperationClass } from "../../lib/capabilities/manifest";
import { manifestEntriesForCapability } from "../capabilities/manifest";

export type InterruptedCallClassification = {
  code: "BACKEND_CALL_INTERRUPTED" | "OUTCOME_UNKNOWN";
  safe_to_retry: boolean;
};

/**
 * Only internally declared QUERY, PREVIEW and VALIDATION operations are
 * observational for retry purposes. EXPORT, CONTROL, MUTATION and unknown
 * operations must not be replayed on a transport interruption.
 */
function isObservationalClass(value: CapabilityOperationClass): boolean {
  return value === "QUERY" || value === "PREVIEW" || value === "VALIDATION";
}

/**
 * Runtime ToolAnnotations are descriptive hints, not proof of the operation's
 * effects. Retry safety requires the annotation AND a known observational
 * LazyDesigner contract for the exact branch.
 */
function contractProvesObservation(
  tool: BackendTool,
  args: Readonly<Record<string, unknown>>
): boolean {
  const coreClass = capabilityOperationClassByName(tool.name);
  if (coreClass === "UNKNOWN") return false;

  const branches = manifestEntriesForCapability(tool.name).filter(
    (entry) => entry.branch !== undefined
  );
  if (branches.length === 0) return isObservationalClass(coreClass);

  const matching = branches.filter((entry) =>
    entry.branch && args[entry.branch.field] === entry.branch.value
  );
  // Ambiguous matches or an explicit unsupported branch cannot borrow
  // another branch's read-only semantics.
  if (matching.length > 1) return false;
  if (matching.length === 1) {
    const selected = matching[0]!;
    let operationClass = selected.operationClass ?? coreClass;
    if (selected.nestedActions) {
      const action = args.action;
      if (typeof action !== "string") return false;
      const nestedClass = selected.nestedActions[action];
      if (!nestedClass) return false;
      operationClass = nestedClass;
    }
    return isObservationalClass(operationClass);
  }

  // A missing selector is acceptable only for an observation-only capability with
  // no mutating or nested branch. Preserve inspect_elements' normal default
  // query flow; a wrong explicit mode must fail closed instead.
  if (branches.some((entry) =>
    entry.branch && typeof args[entry.branch.field] === "string"
  )) return false;
  return isObservationalClass(coreClass) && branches.every((entry) =>
    isObservationalClass(entry.operationClass ?? coreClass) &&
    entry.nestedActions === undefined
  );
}

export function classifyInterruptedCall(
  tool: BackendTool,
  args: Readonly<Record<string, unknown>> = {}
): InterruptedCallClassification {
  if (tool.annotations?.readOnlyHint === true &&
      contractProvesObservation(tool, args)) {
    return {
      code: "BACKEND_CALL_INTERRUPTED",
      safe_to_retry: true,
    };
  }
  return {
    code: "OUTCOME_UNKNOWN",
    safe_to_retry: false,
  };
}
