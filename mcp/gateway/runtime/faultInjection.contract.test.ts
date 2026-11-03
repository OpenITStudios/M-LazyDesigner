import { describe, expect, test } from "bun:test";
import { classifyInterruptedCall } from "./interruptionPolicy";
import { recoveryForGatewayError } from "./recovery";
import { resolveProjectAffinity } from "./affinityPolicy";
import { GatewayOperationQueue } from "./operationQueue";
import { GatewayBackendError } from "./backendContract";
import type { BackendTool } from "../contracts/protocol";

function tool(readOnly: boolean): BackendTool {
  return {
    name: readOnly ? "inspect_elements" : "manage_cubes",
    description: "test",
    inputSchema: {},
    annotations: { readOnlyHint: readOnly },
  };
}

describe("Gateway remote fault-injection contract", () => {
  test("interrupted reads are retryable but interrupted mutations remain outcome-unknown", () => {
    expect(classifyInterruptedCall(tool(true))).toEqual({
      code: "BACKEND_CALL_INTERRUPTED",
      safe_to_retry: true,
    });
    expect(classifyInterruptedCall(tool(false))).toEqual({
      code: "OUTCOME_UNKNOWN",
      safe_to_retry: false,
    });

    const renderTool: BackendTool = {
      ...tool(false), name: "render_publication",
    };
    for (const operation of ["status", "preview"]) {
      expect(classifyInterruptedCall(renderTool, { operation })).toEqual({
        code: "BACKEND_CALL_INTERRUPTED", safe_to_retry: true,
      });
    }
    for (const operation of ["start", "cancel", "unknown"]) {
      expect(classifyInterruptedCall(renderTool, { operation })).toEqual({
        code: "OUTCOME_UNKNOWN", safe_to_retry: false,
      });
    }

    expect(recoveryForGatewayError("BACKEND_CALL_INTERRUPTED", true)).toMatchObject({
      category: "TRANSPORT",
      safe_to_retry: true,
      state_uncertain: false,
      requires_status_refresh: false,
    });
    expect(recoveryForGatewayError("OUTCOME_UNKNOWN", false)).toMatchObject({
      category: "TRANSPORT",
      safe_to_retry: false,
      state_uncertain: true,
      requires_status_refresh: true,
    });
  });

  test("pre-execution queue expiry and cancellation are conclusive, not OUTCOME_UNKNOWN", () => {
    for (const code of ["GATEWAY_QUEUE_EXPIRED", "GATEWAY_QUEUE_CANCELLED"]) {
      expect(recoveryForGatewayError(code, true)).toMatchObject({
        safe_to_retry: true,
        state_uncertain: false,
        requires_status_refresh: false,
      });
    }
    expect(recoveryForGatewayError("OUTCOME_UNKNOWN", false)).toMatchObject({
      safe_to_retry: false,
      state_uncertain: true,
    });
  });

  test("lost bound project fails closed and requires explicit rebind", () => {
    expect(() =>
      resolveProjectAffinity(
        "project-a",
        {
          project_context: {
            active_project_uuid: "project-b",
            requested_project_uuid: "project-a",
            requested_project_available: false,
            open_project_count: 2,
          },
        },
        false
      )
    ).toThrow(GatewayBackendError);

    try {
      resolveProjectAffinity(
        "project-a",
        {
          project_context: {
            active_project_uuid: "project-b",
            requested_project_uuid: "project-a",
            requested_project_available: false,
            open_project_count: 2,
          },
        },
        false
      );
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayBackendError);
      const gatewayError = error as GatewayBackendError;
      expect(gatewayError.code).toBe("PROJECT_CONTEXT_LOST");
      expect(gatewayError.safeToRetry).toBe(false);
      expect(gatewayError.details.action).toContain("adopt_active_project=true");
    }
  });

  test("queue saturation rejects excess work without executing it", async () => {
    const queue = new GatewayOperationQueue(1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: string[] = [];

    const first = queue.run(async () => {
      started.push("first");
      await gate;
      return "first";
    });
    const second = queue.run(async () => {
      started.push("second");
      return "second";
    });

    const rejected = queue.run(async () => {
      started.push("third");
      return "third";
    });

    await expect(rejected).rejects.toMatchObject({
      code: "GATEWAY_BUSY",
      safeToRetry: true,
    });
    expect(started).toEqual(["first"]);

    release();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(started).toEqual(["first", "second"]);
    expect(queue.snapshot().rejected_busy).toBe(1);
  });

  test("timeout-classified failures are counted without poisoning subsequent queue work", async () => {
    const queue = new GatewayOperationQueue(1);
    await expect(
      queue.run(async () => {
        throw new GatewayBackendError(
          "OUTCOME_UNKNOWN",
          "simulated timeout",
          false,
          { timeout_ms: 1000 }
        );
      })
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });

    await expect(queue.run(async () => "recovered")).resolves.toBe("recovered");
    expect(queue.snapshot()).toMatchObject({
      active: 0,
      queued: 0,
      failed: 1,
      timed_out: 1,
      completed: 1,
    });
  });
});
