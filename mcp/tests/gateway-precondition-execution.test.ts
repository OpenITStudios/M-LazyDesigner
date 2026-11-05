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

  test("unselected, unrecognized and graphless operations reach Runtime validation", async () => {
    // P0 may change implicit READY to UNKNOWN for these cases. Neither state
    // can safely become a Gateway-level BLOCKED result without a proven
    // missing prerequisite on the exact operation. Runtime owns schema and
    // installed tool availability, not this metadata-only Graph.
    for (const { capability, args } of [
      { capability: "manage_cubes", args: {} },
      { capability: "manage_cubes", args: { operation: "unknown_future_branch" } },
      { capability: "manage_material", args: { operation: "assign_channel" } },
      { capability: "manage_material_instances", args: { operation: "list" } },
    ]) {
      const session = new GatewaySessionState();
      session.replaceFacts(seedCapabilityFacts({ projectBound: false }));
      let runtimeCalls = 0;
      const executor = new GatewayCapabilityExecutor(
        {
          invokeCapabilityWithMetadata: async () => {
            runtimeCalls++;
            throw new Error("Runtime owns exact tool and branch validation.");
          },
        } as any,
        { invoke: async () => null } as any,
        session
      );
      const response = await executor.invoke(capability, args) as any;
      expect(runtimeCalls, `${capability} ${JSON.stringify(args)}`).toBe(1);
      expect(response?.structuredContent?.code)
        .not.toBe("CAPABILITY_PRECONDITION_BLOCKED");
      expect(session.facts.project_bound).toBe(false);
    }
  });

  test("unselected or unsupported branches cannot borrow a shared Graph BLOCKED result", async () => {
    // The timeline has a generic Graph fallback even though native execution
    // requires an operation. An invented/missing operation belongs to Runtime
    // schema validation, not the fallback's project/animation prerequisites.
    // A non-branch discriminator must not invent an exact branch either.
    for (const { capability, args } of [
      { capability: "manage_animation_timeline", args: {} },
      { capability: "manage_animation_timeline", args: { operation: "future_unsupported" } },
      { capability: "manage_animation_controller", args: {
        action: "edit", resource_kind: "client_entity",
      } },
    ]) {
      const session = new GatewaySessionState();
      session.replaceFacts({
        ...seedCapabilityFacts({ projectBound: false }),
        animation_available: false,
      });
      let nativeCalls = 0;
      const executor = new GatewayCapabilityExecutor(
        {
          invokeCapabilityWithMetadata: async () => {
            nativeCalls++;
            throw new Error("Runtime decides exact native schema and catalog.");
          },
        } as any,
        { invoke: async () => null } as any,
        session
      );
      const response = await executor.invoke(capability, args) as any;
      expect(nativeCalls, `${capability} ${JSON.stringify(args)}`).toBe(1);
      expect(response?.structuredContent?.code)
        .not.toBe("CAPABILITY_PRECONDITION_BLOCKED");
      expect(session.facts.project_bound).toBe(false);
    }
  });

  test("declared timeline operations and branch-independent facts still block when proven false", async () => {
    for (const { capability, args } of [
      { capability: "manage_animation_timeline", args: { operation: "keyframes" } },
      { capability: "manage_animation_timeline", args: { operation: "timeline", action: "play" } },
      { capability: "create_animation", args: { name: "model.walk" } },
    ]) {
      const session = new GatewaySessionState();
      session.replaceFacts({
        ...seedCapabilityFacts({ projectBound: false }),
        animation_available: false,
        geometry_available: false,
      });
      let calls = 0;
      const executor = new GatewayCapabilityExecutor(
        {
          invokeCapabilityWithMetadata: async () => {
            calls++;
            throw new Error("Known missing prerequisites must block early.");
          },
        } as any,
        { invoke: async () => { calls++; return null; } } as any,
        session
      );
      const response = await executor.invoke(capability, args) as any;
      expect(response?.structuredContent?.code)
        .toBe("CAPABILITY_PRECONDITION_BLOCKED");
      expect(response?.structuredContent?.requires).toContain("project_bound");
      expect(calls).toBe(0);
    }
  });

  test("confirmed false prerequisites still block a known exact branch", async () => {
    let invocations = 0;
    const session = new GatewaySessionState();
    session.replaceFacts({
      ...seedCapabilityFacts({ projectBound: false }),
      geometry_available: "unknown",
    });
    const executor = new GatewayCapabilityExecutor(
      {
        invokeCapabilityWithMetadata: async () => {
          invocations++;
          throw new Error("Blocked request must not reach Runtime.");
        },
      } as any,
      { invoke: async () => { invocations++; return null; } } as any,
      session
    );
    const response = await executor.invoke(
      "manage_cubes", { operation: "update" }
    ) as any;
    expect(response?.structuredContent?.code)
      .toBe("CAPABILITY_PRECONDITION_BLOCKED");
    expect(response?.structuredContent?.requires).toContain("project_bound");
    expect(invocations).toBe(0);
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
