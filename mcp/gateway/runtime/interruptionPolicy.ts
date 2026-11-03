import type { BackendTool } from "../contracts/protocol";
import { nestedOperationClassForArguments } from "../capabilities/manifest";

export type InterruptedCallClassification = {
  code: "BACKEND_CALL_INTERRUPTED" | "OUTCOME_UNKNOWN";
  safe_to_retry: boolean;
};

export function classifyInterruptedCall(
  tool: BackendTool,
  args: Record<string, unknown> = {},
): InterruptedCallClassification {
  // A mixed start/status/preview/cancel tool is not globally read-only,
  // but branch-level QUERY operations cannot create a Blender render.
  if (tool.annotations?.readOnlyHint === true ||
      nestedOperationClassForArguments(tool.name, args) === "QUERY") {
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
