import { describe, expect, test } from "bun:test";
import { GatewaySessionState } from "./state";
import { gatewayOrchestrationRecoveryState } from "./orchestrationRecoveryState";

describe("Gateway Runtime-generation session recovery", () => {
  test("observed Runtime loss revokes facts and pending Control execution only once", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("project-a");
    session.replaceFacts({
      ...session.facts,
      geometry_available: true,
      texture_available: true,
      animation_available: true,
    });
    session.controlExecutionState = { revision: 3 } as never;
    const before = gatewayOrchestrationRecoveryState.snapshot().invalidation_count;

    session.onRuntimeUnavailable();
    expect(session.projectUuid).toBe("project-a");
    expect(session.facts).toEqual({ project_bound: "unknown" });
    expect(session.controlExecutionState).toBeNull();
    expect(gatewayOrchestrationRecoveryState.snapshot().invalidation_count).toBe(before + 1);

    session.onRuntimeUnavailable();
    expect(gatewayOrchestrationRecoveryState.snapshot().invalidation_count).toBe(before + 1);
  });

  test("a second outage revokes facts learned after a first unverified status", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("project-a");
    session.onRuntimeUnavailable();
    const initialCount = gatewayOrchestrationRecoveryState.snapshot().invalidation_count;

    // A fresh first MCP handshake can execute a tool without the existing
    // reconnect generation-change callback.
    session.replaceFacts({ ...session.facts, geometry_available: true });
    session.onRuntimeUnavailable();

    expect(session.facts).toEqual({ project_bound: "unknown" });
    expect(gatewayOrchestrationRecoveryState.snapshot().invalidation_count)
      .toBe(initialCount + 1);
    session.onRuntimeUnavailable();
    expect(gatewayOrchestrationRecoveryState.snapshot().invalidation_count)
      .toBe(initialCount + 1);
  });

  test("a later outage retires new visual evidence even when capability facts stay unknown", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("project-outage-evidence");
    session.onRuntimeUnavailable();
    const initialCount =
      gatewayOrchestrationRecoveryState.snapshot().invalidation_count;

    // Control/visual evidence can be produced independently of the graph
    // facts. Repeating the outage must not return early with stale handles.
    const handle = gatewayOrchestrationRecoveryState.evidence.put({
      request: {
        domain: "GEOMETRY",
        source: "capture_model_views",
        verification_risk: "LOW",
        views: ["front"],
        views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        size: 256,
        size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
        scope_instance_ids: ["outage:test"],
      },
      result: { revision: 1 },
    });
    expect(session.facts).toEqual({ project_bound: "unknown" });
    expect(session.controlExecutionState).toBeNull();

    session.onRuntimeUnavailable();
    expect(gatewayOrchestrationRecoveryState.snapshot()).toMatchObject({
      invalidation_count: initialCount + 1,
      evidence_entries: 0,
    });
    expect(() => gatewayOrchestrationRecoveryState.evidence.get(handle))
      .toThrow("VERIFICATION_EVIDENCE_NOT_FOUND");

    session.onRuntimeUnavailable();
    expect(gatewayOrchestrationRecoveryState.snapshot().invalidation_count)
      .toBe(initialCount + 1);
  });

  test("verified status re-establishes binding but not old geometry or texture evidence", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("project-a");
    session.replaceFacts({ ...session.facts, geometry_available: true });
    session.onRuntimeUnavailable();
    session.onVerifiedRuntimeStatus("project-a");

    expect(session.facts).toEqual({ project_bound: true });
    expect(session.facts.geometry_available).toBeUndefined();

    session.replaceFacts({ ...session.facts, texture_available: true });
    session.onVerifiedRuntimeStatus("project-a");
    expect(session.facts.texture_available).toBe(true);
    session.onRuntimeUnavailable();
    expect(session.facts).toEqual({ project_bound: "unknown" });
  });

  test("verified changed project replaces remembered UUID after Runtime loss", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("project-old");
    session.onRuntimeUnavailable();
    session.onVerifiedRuntimeStatus("project-new");

    expect(session.projectUuid).toBe("project-new");
    expect(session.facts).toEqual({ project_bound: true });
  });

  test("verified same-project reconnect retains only the proven binding fact", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("project-a");
    session.replaceFacts({
      ...session.facts,
      geometry_available: true,
      texture_available: true,
      uv_layout_current: true,
      animation_available: true,
    });
    session.controlExecutionState = { revision: 41 } as never;

    session.onRuntimeGenerationChange("project-a");

    expect(session.projectUuid).toBe("project-a");
    expect(session.facts).toEqual({ project_bound: true });
    expect(session.controlExecutionState).toBeNull();
  });

  test("replacement Runtime's different verified project replaces old Control binding", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("project-old");
    session.replaceFacts({ ...session.facts, geometry_available: true });

    session.onRuntimeGenerationChange("project-new");

    expect(session.projectUuid).toBe("project-new");
    expect(session.facts).toEqual({ project_bound: true });
    expect(session.facts.geometry_available).toBeUndefined();
  });

  test("lost or unbound project is not treated as verified after reload", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("project-closed");
    session.replaceFacts({ ...session.facts, animation_available: true });

    session.onRuntimeGenerationChange(null);

    expect(session.projectUuid).toBeNull();
    expect(session.facts).toEqual({ project_bound: "unknown" });
    expect(session.facts.animation_available).toBeUndefined();
  });

  test("subsequent bound status preserves fresh Runtime facts without repeating project reset", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("project-a");
    session.onRuntimeGenerationChange("project-a");
    session.replaceFacts({ ...session.facts, geometry_available: true });

    session.synchronizeProject("project-a");

    expect(session.facts).toEqual({
      project_bound: true,
      geometry_available: true,
    });
  });
});
