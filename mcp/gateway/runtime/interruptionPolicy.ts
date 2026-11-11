import type { BackendTool } from "../contracts/protocol";
import { capabilityOperationClassByName } from "../../lib/capabilities/manifest";
import { manifestEntriesForCapability } from "../capabilities/manifest";

export type InterruptedCallClassification = {
  code: "BACKEND_CALL_INTERRUPTED" | "OUTCOME_UNKNOWN";
  safe_to_retry: boolean;
};

/**
 * Runtime ToolAnnotations are descriptive hints, not proof of the operation's
 * effects. Safe transport retry requires BOTH a read-only hint and a known,
 * query-only LazyDesigner contract for the exact selected branch.
 */
function contractProvesQuery(
  tool: BackendTool,
  args: Readonly<Record<string, unknown>>
): boolean {
  const coreClass = capabilityOperationClassByName(tool.name);
  if (coreClass === "UNKNOWN") return false;

  const branches = manifestEntriesForCapability(tool.name).filter(
    (entry) => entry.branch !== undefined
  );
  if (branches.length === 0) return coreClass === "QUERY";

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
    return operationClass === "QUERY";
  }

  // A missing selector is acceptable only for a query-only capability with
  // no mutating or nested branch. Preserve inspect_elements' normal default
  // query flow; a wrong explicit mode must fail closed instead.
  if (branches.some((entry) =>
    entry.branch && typeof args[entry.branch.field] === "string"
  )) return false;
  return coreClass === "QUERY" && branches.every((entry) =>
    (entry.operationClass ?? coreClass) === "QUERY" &&
    entry.nestedActions === undefined
  );
}

export function classifyInterruptedCall(
  tool: BackendTool,
  args: Readonly<Record<string, unknown>> = {}
): InterruptedCallClassification {
  if (tool.annotations?.readOnlyHint === true &&
      contractProvesQuery(tool, args)) {
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
