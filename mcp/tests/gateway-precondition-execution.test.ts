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
        getStatus: async () => ({ affinity: { authoring_phase: "geometry" } }),
        invokeCapabilityWithMetadata: async () => {
          invoked++;
          return {
            result: { content: [], structuredContent: receipt },
            readOnly: false,
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

  test("failed switch does not retire proven facts", async () => {
    const session = new GatewaySessionState();
    session.onVerifiedRuntimeStatus("failed-switch-project", "geometry");
    session.replaceFacts({ ...session.facts, geometry_available: true });
    const before = gatewayOrchestrationRecoveryState.snapshot().invalidation_count;
    const executor = new GatewayCapabilityExecutor(
      {
        getStatus: async () => ({ affinity: { authoring_phase: "geometry" } }),
        invokeCapabilityWithMetadata: async () => ({
          result: {
            content: [{ type: "text", text: "phase refused" }],
            isError: true,
            structuredContent: { code: "PHASE_NOT_READY" },
          },
          readOnly: false,
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
