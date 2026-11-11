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

  test("contradictory successful Stage receipts require state inspection, never retry", () => {
    const valid = {
      phase: "texturing",
      runtime_surface: "AUTHORING",
      reason: "continue authoring",
      resume_from: "current project",
      readiness_summary: null,
      surface_changed: false,
      reload_required: false,
      action: "continue",
    };
    for (const [nativeReceipt, requestedTarget, expectedCode] of [
      [{ ...valid, runtime_surface: "ANIMATION" }, "texturing", "RUNTIME_SURFACE_MISMATCH"],
      [{ ...valid, surface_changed: true }, "texturing", "SURFACE_CHANGE_MISMATCH"],
      [valid, "animation", "AUTHORING_TARGET_MISMATCH"],
    ] as const) {
      const application = resolveGatewayCapabilityEffects(
        "switch_authoring_phase", nativeReceipt, "geometry"
      );
      const issue = validateGatewayCapabilityEffectReceipt(
        application, true, { target_phase: requestedTarget }
      );
      expect(issue?.code).toBe(expectedCode);

      const output = gatewayErrorResult(new GatewayBackendError(
        "BACKEND_UNAVAILABLE", issue!.message, false,
        { capability: "switch_authoring_phase", receipt_issue: issue!.code }
      ));
      expect(output).toMatchObject({
        isError: true,
        structuredContent: {
          code: "BACKEND_UNAVAILABLE",
          receipt_issue: expectedCode,
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
      expect(recoveryForGatewayError("BACKEND_UNAVAILABLE", true, {
        receipt_issue: expectedCode,
      }).safe_to_retry).toBe(false);
    }
  });

  test("unknown native receipt codes also require inspection, never replay", () => {
    expect(recoveryForGatewayError("BACKEND_UNAVAILABLE", true)).toMatchObject({
      category: "AVAILABILITY",
      safe_to_retry: true,
      state_uncertain: false,
      requires_status_refresh: true,
    });

    // A receipt issue is a post-invocation authority failure even if the
    // producer has added a new reason or returned malformed diagnostics.
    for (const receiptIssue of ["FUTURE_NATIVE_RECEIPT_CODE", "", null]) {
      const recovery = recoveryForGatewayError("BACKEND_UNAVAILABLE", true, {
        receipt_issue: receiptIssue,
      });
      expect(recovery).toMatchObject({
        category: "AFFINITY",
        safe_to_retry: false,
        state_uncertain: true,
        requires_status_refresh: true,
        requires_user_action: false,
      });
      expect(recovery.action).toContain("never replay the mutation");
    }

    // The AI-facing Gateway error must not inherit the producer's optimistic
    // retry hint when a native receipt is rejected.
    const output = gatewayErrorResult(new GatewayBackendError(
      "BACKEND_UNAVAILABLE",
      "An unknown native receipt validation error followed execution.",
      true,
      { capability: "manage_cubes", receipt_issue: "FUTURE_NATIVE_RECEIPT_CODE" }
    ));
    expect(output.structuredContent).toMatchObject({
      code: "BACKEND_UNAVAILABLE",
      receipt_issue: "FUTURE_NATIVE_RECEIPT_CODE",
      recovery: {
        category: "AFFINITY",
        safe_to_retry: false,
        state_uncertain: true,
        requires_status_refresh: true,
      },
    });

    // An ordinary, pre-execution availability report remains retryable.
    expect(recoveryForGatewayError("BACKEND_UNAVAILABLE", true, {
      capability: "manage_cubes",
      retry_after_ms: 100,
    })).toMatchObject({
      category: "AVAILABILITY",
      safe_to_retry: true,
      state_uncertain: false,
    });
  });

  test("diagnostic details cannot impersonate the canonical error identity", () => {
    const output = gatewayErrorResult(new GatewayBackendError(
      "OUTCOME_UNKNOWN",
      "Native mutation outcome cannot be confirmed.",
      false,
      {
        code: "BACKEND_CALL_INTERRUPTED",
        message: "Safe to retry immediately.",
        recovery: {
          category: "TRANSPORT",
          safe_to_retry: true,
          state_uncertain: false,
        },
        capability: "manage_cubes",
        receipt_issue: "DIAGNOSTIC_ONLY",
      }
    ));

    expect(output.isError).toBe(true);
    expect(output.content[0]).toEqual({
      type: "text",
      text: "OUTCOME_UNKNOWN: Native mutation outcome cannot be confirmed.",
    });
    expect(output.structuredContent).toMatchObject({
      code: "OUTCOME_UNKNOWN",
      message: "Native mutation outcome cannot be confirmed.",
      capability: "manage_cubes",
      receipt_issue: "DIAGNOSTIC_ONLY",
      recovery: {
        category: "TRANSPORT",
        safe_to_retry: false,
        state_uncertain: true,
        requires_status_refresh: true,
      },
    });
    expect(output.structuredContent.recovery.action).toContain(
      "inspect current Blockbench state"
    );

    // Preserve the strict native-affinity receipt recovery even when a
    // diagnostic payload carries conflicting top-level fields.
    const affinity = gatewayErrorResult(new GatewayBackendError(
      "BACKEND_UNAVAILABLE",
      "Native phase receipt is incomplete.",
      false,
      {
        code: "CAPABILITY_NOT_FOUND",
        message: "This capability is not installed.",
        receipt_issue: "MISSING_AUTHORING_PHASE",
        capability: "switch_authoring_phase",
      }
    ));
    expect(affinity.structuredContent).toMatchObject({
      code: "BACKEND_UNAVAILABLE",
      message: "Native phase receipt is incomplete.",
      receipt_issue: "MISSING_AUTHORING_PHASE",
      recovery: {
        category: "AFFINITY",
        safe_to_retry: false,
        state_uncertain: true,
      },
    });
  });

  test("keeps read-only transport interruption retryable", () => {
    const recovery = recoveryForGatewayError("BACKEND_CALL_INTERRUPTED", true);
    expect(recovery.safe_to_retry).toBe(true);
    expect(recovery.state_uncertain).toBe(false);
  });
});
