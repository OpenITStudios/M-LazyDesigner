import { describe, expect, test } from "bun:test";
import { GatewayCapabilityExecutor } from "@/gateway/execution/capabilityExecutor";
import { GatewaySessionState } from "@/gateway/session/state";
import { seedCapabilityFacts } from "@/gateway/capabilities/graph";
import { resolveGatewayCapabilityEffects } from "@/gateway/capabilities/effects";
import { gatewayOrchestrationRecoveryState } from "@/gateway/session/orchestrationRecoveryState";

describe("stable Gateway invoke prerequisite enforcement", () => {
  test("known-absent prerequisites block before any Runtime or local mutation", async () => {
    let invoked = 0;
    const session = new GatewaySessionState();
    session.replaceFacts(seedCapabilityFacts({ projectBound: false }));
    const records: Array<{ kind: string; success: boolean; capability: string }> = [];
    const executor = new GatewayCapabilityExecutor(
      {
        invokeCapabilityWithMetadata: async () => {
          invoked++;
          throw new Error("Unexpected Runtime call");
        },
      } as any,
      { invoke: async () => { invoked++; return null; } } as any,
      session,
      {
        startedAt: () => Date.now(),
        record: (event: { kind: string; success: boolean; capability: string }) => {
          records.push(event);
        },
      } as any
    );
    const result = await executor.invoke("manage_cubes", { operation: "create" }) as any;
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe("CAPABILITY_PRECONDITION_BLOCKED");
    expect(result.structuredContent.requires).toContain("project_bound");
    expect(invoked).toBe(0);
    expect(records).toEqual([
      expect.objectContaining({
        kind: "recovery", success: false, capability: "manage_cubes",
      }),
    ]);
  });

  test("direct-first mutations preserve project across a Control cohort without status calls", async () => {
    const session = new GatewaySessionState();
    let calls = 0;
    let statusReads = 0;
    const executor = new GatewayCapabilityExecutor(
      {
        getStatus: async () => {
          statusReads++;
          throw new Error("No status required for ordinary mutations.");
        },
        invokeCapabilityWithMetadata: async () => {
          calls++;
          return {
            result: { content: [], structuredContent: { execution: "applied" } },
            readOnly: false,
            verifiedProjectUuid: "cohort-project",
          };
        },
      } as any,
      { invoke: async () => null } as any,
      session
    );
    const options = {
      taskContextId: "single-asset-batch",
      cohortBoundary: "CONTINUE" as const,
    };
    const first = await executor.invoke(
      "manage_cubes", { operation: "update" }, undefined, options
    ) as any;
    const second = await executor.invoke(
      "manage_cubes", { operation: "batch_update" }, undefined, options
    ) as any;
    expect(first.isError).not.toBe(true);
    expect(second.isError).not.toBe(true);
    expect(session.projectUuid).toBe("cohort-project");
    expect(session.facts.project_bound).toBe(true);
    expect(first.structuredContent.control_delta.project_uuid).toBe("cohort-project");
    expect(second.structuredContent.control_delta.project_uuid).toBe("cohort-project");
    expect(first.structuredContent.control_delta.continuation.state_revision).toBe(1);
    expect(second.structuredContent.control_delta.continuation.state_revision).toBe(2);
    expect(second.structuredContent.control_delta.continuation.cohort).toMatchObject({
      task_context_id: "single-asset-batch", deferred: true,
    });
    expect(session.controlExecutionState?.revision).toBe(2);
    expect(statusReads).toBe(0);
    expect(calls).toBe(2);
  });

  test("unverified backend project cannot borrow prior session identity for Control Delta", async () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("older-project");
    const executor = new GatewayCapabilityExecutor(
      {
        invokeCapabilityWithMetadata: async () => ({
          result: { content: [], structuredContent: { execution: "applied" } },
          readOnly: false,
          verifiedProjectUuid: null,
        }),
      } as any,
      { invoke: async () => null } as any,
      session
    );
    const response = await executor.invoke(
      "manage_cubes", { operation: "update" }
    ) as any;
    expect(response.structuredContent.control_delta.project_uuid).toBeNull();
    expect(session.controlExecutionState?.project_uuid).toBeNull();
  });

  test("a Runtime generation change invalidates stale prerequisite facts", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("active-model-a");
    expect(session.facts.project_bound).toBe(true);
    session.onRuntimeGenerationChange(null);
    expect(session.projectUuid).toBeNull();
    expect(session.facts.project_bound).toBe("unknown");
  });

  test("validated switch receipt invalidates session before a separate status lookup", async () => {
    const session = new GatewaySessionState();
    session.onVerifiedRuntimeStatus("bound-project", "geometry");
    session.replaceFacts({ ...session.facts, geometry_available: true, uv_plan_available: true });
    session.controlExecutionState = { revision: 65 } as never;
    const before = gatewayOrchestrationRecoveryState.snapshot().invalidation_count;
    const receipt = {
      phase: "animation",
      runtime_surface: "ANIMATION",
      reason: "confirmed handoff",
      resume_from: "AUTHORING",
      readiness_summary: null,
      surface_changed: true,
      reload_required: false,
      action: "switch",
    };
    let invoked = 0;
    const executor = new GatewayCapabilityExecutor(
      {
        getStatus: async () => {
          throw new Error("Handoff must not repeat a pre-execution status call.");
        },
        invokeCapabilityWithMetadata: async () => {
          invoked++;
          return {
            result: { content: [], structuredContent: receipt },
            readOnly: false,
            verifiedProjectUuid: "bound-project",
            phaseBefore: "geometry",
            effectApplication: resolveGatewayCapabilityEffects(
              "switch_authoring_phase", receipt, "geometry"
            ),
          };
        },
      } as any,
      { invoke: async () => null } as any,
      session
    );

    const result = await executor.invoke("switch_authoring_phase", {
      target_phase: "animation",
    }) as { isError?: boolean };

    expect(result.isError).not.toBe(true);
    expect(invoked).toBe(1);
    expect(session.facts).toEqual({ project_bound: true });
    expect(gatewayOrchestrationRecoveryState.snapshot().invalidation_count)
      .toBe(before + 1);
    session.onVerifiedRuntimeStatus("bound-project", "animation");
    expect(gatewayOrchestrationRecoveryState.snapshot().invalidation_count)
      .toBe(before + 1);
  });

  test("handoff derives phase-before from the queued Runtime, not an earlier snapshot", async () => {
    const session = new GatewaySessionState();
    session.onVerifiedRuntimeStatus("handoff-project", "texturing");
    session.replaceFacts({ ...session.facts, texture_available: true });
    let statusReads = 0;
    const handoff = {
      phase: "animation",
      runtime_surface: "ANIMATION",
      reason: "move into Animation",
      resume_from: "texturing checkpoint",
      readiness_summary: null,
      surface_changed: true,
      reload_required: false,
      action: "continue",
    };
    const executor = new GatewayCapabilityExecutor(
      {
        getStatus: async () => {
          statusReads++;
          throw new Error("Redundant status read");
        },
        invokeCapabilityWithMetadata: async () => ({
          result: { content: [], structuredContent: handoff },
          readOnly: false,
          verifiedProjectUuid: "handoff-project",
          phaseBefore: "texturing",
          effectApplication: resolveGatewayCapabilityEffects(
            "switch_authoring_phase", handoff, "texturing"
          ),
        }),
      } as any,
      { invoke: async () => null } as any,
      session
    );
    const response = await executor.invoke(
      "switch_authoring_phase", { target_phase: "animation" }
    ) as any;
    expect(response.isError).not.toBe(true);
    expect(statusReads).toBe(0);
    expect(session.projectUuid).toBe("handoff-project");
    expect(session.facts).toEqual({ project_bound: true });
    session.onVerifiedRuntimeStatus("handoff-project", "animation");
    expect(session.facts.project_bound).toBe(true);
  });

  test("failed switch does not retire proven facts", async () => {
    const session = new GatewaySessionState();
    session.onVerifiedRuntimeStatus("failed-switch-project", "geometry");
    session.replaceFacts({ ...session.facts, geometry_available: true });
    const before = gatewayOrchestrationRecoveryState.snapshot().invalidation_count;
    const executor = new GatewayCapabilityExecutor(
      {
        getStatus: async () => {
          throw new Error("Failed handoff must not perform a separate status read.");
        },
        invokeCapabilityWithMetadata: async () => ({
          result: {
            content: [{ type: "text", text: "phase refused" }],
            isError: true,
            structuredContent: { code: "PHASE_NOT_READY" },
          },
          readOnly: false,
          verifiedProjectUuid: null,
          phaseBefore: "geometry",
        }),
      } as any,
      { invoke: async () => null } as any,
      session
    );

    const response = await executor.invoke("switch_authoring_phase", {
      target_phase: "animation",
    }) as { isError?: boolean };

    expect(response.isError).toBe(true);
    expect(session.facts.geometry_available).toBe(true);
    expect(gatewayOrchestrationRecoveryState.snapshot().invalidation_count)
      .toBe(before);
  });

  test("unknown preconditions retain Runtime authority instead of false blocking", async () => {
    let called = false;
    const session = new GatewaySessionState();
    session.replaceFacts(seedCapabilityFacts({ projectBound: true }));
    const executor = new GatewayCapabilityExecutor(
      {
        invokeCapabilityWithMetadata: async () => {
          called = true;
          throw new Error("Runtime received request");
        },
      } as any,
      { invoke: async () => null } as any,
      session
    );
    await executor.invoke("manage_material", { operation: "configure" });
    expect(called).toBe(true);
  });
});
