import { describe, expect, test } from "bun:test";
import { recoveryForGatewayError } from "./recovery";
import { GatewayBackendError } from "./backendContract";
import { gatewayErrorResult } from "../execution/gatewayErrors";
import {
  resolveGatewayCapabilityEffects,
  validateGatewayCapabilityEffectReceipt,
} from "../capabilities/effects";

describe("gateway recovery semantics", () => {
  test("marks interrupted mutations as uncertain and non-retriable", () => {
    expect(recoveryForGatewayError("OUTCOME_UNKNOWN", false)).toEqual({
      category: "TRANSPORT",
      safe_to_retry: false,
      state_uncertain: true,
      requires_status_refresh: true,
      requires_user_action: false,
      action: "inspect current Blockbench state before deciding whether to retry",
    });
  });

  test("requires explicit user action for lost project affinity", () => {
    const recovery = recoveryForGatewayError("PROJECT_CONTEXT_LOST", false, {
      action: "select intended tab",
    });
    expect(recovery.category).toBe("AFFINITY");
    expect(recovery.requires_user_action).toBe(true);
    expect(recovery.action).toBe("select intended tab");
  });

  test("successful native authority mutations with missing receipts remain uncertain", () => {
    for (const [capability, receipt, code] of [
      ["create_project", { project: {} }, "MISSING_PROJECT_UUID"],
      ["switch_authoring_phase", { surface_changed: true }, "MISSING_AUTHORING_PHASE"],
    ] as const) {
      const application = resolveGatewayCapabilityEffects(
        capability, receipt, "geometry"
      );
      const issue = validateGatewayCapabilityEffectReceipt(application, true);
      expect(issue?.code).toBe(code);

      const output = gatewayErrorResult(new GatewayBackendError(
        "BACKEND_UNAVAILABLE",
        issue!.message,
        false,
        { capability, receipt_issue: issue!.code }
      ));
      expect(output).toMatchObject({
        isError: true,
        structuredContent: {
          code: "BACKEND_UNAVAILABLE",
          receipt_issue: code,
          recovery: {
            category: "AFFINITY",
            safe_to_retry: false,
            state_uncertain: true,
            requires_status_refresh: true,
            requires_user_action: false,
          },
        },
      });
      expect(output.structuredContent.recovery.action).toContain(
        "never replay the mutation"
      );
    }
  });

  test("normal availability and unknown issue codes retain their own recovery", () => {
    expect(recoveryForGatewayError("BACKEND_UNAVAILABLE", true)).toMatchObject({
      category: "AVAILABILITY",
      safe_to_retry: true,
      state_uncertain: false,
      requires_status_refresh: true,
    });
    expect(recoveryForGatewayError("BACKEND_UNAVAILABLE", false, {
      receipt_issue: "SOMETHING_ELSE",
    })).toMatchObject({
      category: "AVAILABILITY",
      safe_to_retry: false,
      state_uncertain: false,
    });
  });

  test("keeps read-only transport interruption retryable", () => {
    const recovery = recoveryForGatewayError("BACKEND_CALL_INTERRUPTED", true);
    expect(recovery.safe_to_retry).toBe(true);
    expect(recovery.state_uncertain).toBe(false);
  });
});
