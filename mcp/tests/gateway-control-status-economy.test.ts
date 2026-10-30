import { GatewayOperationQueue } from "@/gateway/runtime/operationQueue";
import { describe, expect, test } from "bun:test";
import {
  buildControlPacket,
  decorateCapabilities,
  projectControlPacketForGateway,
  projectControlPacketForGatewayWithDiagnostics,
} from "@/gateway/control";
import type { GatewayRuntimeStatus } from "@/gateway/backend";
import { projectGatewayStatus } from "@/gateway/statusProjection";

describe("LazyDesigner Control status economy", () => {
  test("capability decoration stays useful without a status-only current domain", () => {
    const [capability] = decorateCapabilities([
      {
        capability_id: "paint_with_brush",
        description: "Paint texture pixels.",
        tier: "primary",
        read_only: false,
        destructive: true,
        idempotent: false,
      },
    ]);

    expect(capability.control.authoring_domain).toBe("TEXTURING");
    expect(capability.control.current_domain).toBe(false);
    expect(capability.control.eligibility).toBe("AVAILABLE");
  });

  test("search and describe do not perform metadata-only status rereads", async () => {
    const source = await Bun.file(
      "gateway/handlers/registerCoreTools.ts"
    ).text();
    const searchStart = source.indexOf("GATEWAY_TOOLS.searchCapabilities");
    const describeStart = source.indexOf("GATEWAY_TOOLS.describeCapability");
    const invokeStart = source.indexOf("GATEWAY_TOOLS.invokeCapability");

    const searchBlock = source.slice(searchStart, describeStart);
    const describeBlock = source.slice(describeStart, invokeStart);

    expect(searchBlock).toContain("backend.searchCapabilities");
    expect(searchBlock).not.toContain("backend.getStatus()");
    expect(describeBlock).toContain("backend.describeCapability");
    expect(describeBlock).not.toContain("backend.getStatus()");
    expect(describeBlock).not.toContain("current_phase:");
  });

  test("explicit orientation uses status, while handoff reuses the queued Runtime phase", async () => {
    const [registration, executor] = await Promise.all([
      Bun.file("gateway/handlers/registerCoreTools.ts").text(),
      Bun.file("gateway/execution/capabilityExecutor.ts").text(),
    ]);
    expect(registration).toContain("await backend.getStatus()");
    expect(executor).toContain("capabilityNeedsPhaseSnapshot(capability)");
    expect(executor).toContain("runtimeInvocation?.phaseBefore");
    expect(executor).not.toContain("(await this.backend.getStatus())");
  });
});


const projectionStatus: GatewayRuntimeStatus = {
  gateway: "ready",
  affinity: { project_uuid: "project-a", authoring_phase: "geometry" },
  runtime: {
    online: true,
    endpoint: "http://127.0.0.1:3000/bb-mcp",
    mcp_client_ready: true,
    catalog_stale: false,
    runtime_signature: "runtime-a",
    connected_signature: "runtime-a",
    catalog_count: 47,
    health: {
      build_identity: "sha256:build-a",
      product: { authoring_phase: "geometry" },
      project_context: {
        active_project_uuid: "project-a",
        requested_project_uuid: "project-a",
        requested_project_available: true,
        open_project_count: 1,
      },
    },
  },
  connection: {
    state: "ready", generation: 1, reconnect_count: 0, catalog_refresh_count: 1,
    last_ready_at: "2026-09-20T00:00:00.000Z", last_transition_at: "2026-09-20T00:00:00.000Z",
    reconnect: { failures: 0, retry_after_ms: 0 },
  },
  operations: {
    ...new GatewayOperationQueue(8).snapshot(),
    active: 0, queued: 0, max_queue_depth: 8, completed: 0,
    failed: 0, timed_out: 0, rejected_busy: 0,
  },
  last_error: null,
};

describe("LazyDesigner Control status projection economy", () => {
  test("Gateway projection removes duplicated orientation while preserving unique Control decisions", async () => {
    const full = await buildControlPacket(projectionStatus);
    const projected = projectControlPacketForGateway(full);

    expect(full.project.affinity_uuid).toBe("project-a");
    expect(full.authoring.phase).toBe("geometry");
    expect(full.runtime.online).toBe(true);
    expect(full.runtime.build_identity).toBe("sha256:build-a");
    expect(full.runtime.catalog_count).toBe(47);

    expect(projected).not.toHaveProperty("protocol");
    expect(projected).not.toHaveProperty("mode");
    expect(projected).not.toHaveProperty("development");
    expect(projected).not.toHaveProperty("blockers");
    expect(projected.project).not.toHaveProperty("affinity_uuid");
    expect(projected.authoring).not.toHaveProperty("phase");
    expect(projected.runtime).not.toHaveProperty("online");
    expect(projected.runtime).not.toHaveProperty("build_identity");
    expect(projected.runtime).not.toHaveProperty("catalog_count");
    expect(projected.runtime).not.toHaveProperty("catalog_stale");

    expect(projected.project.binding).toBe(full.project.binding);
    expect(projected.authoring.domain).toBe(full.authoring.domain);
    expect(projected.authoring.next_intent).toBe(full.authoring.next_intent);
    expect(projected.runtime.runtime_signature).toBe(full.runtime.runtime_signature);
    expect(projected.readiness).toEqual(full.readiness);
    expect(projected.context).toEqual({
      required: full.context.required,
    });
    expect(projected.context).not.toHaveProperty("cached_ids");
    expect(projected.context).not.toHaveProperty("optional");
    expect(projected.context).not.toHaveProperty("invalidated_ids");
    if (full.stage_context === null) {
      expect(projected).not.toHaveProperty("stage_context");
    } else {
      expect(projected.stage_context).toMatchObject({
        context_type: full.stage_context.context_type,
        context_hash: full.stage_context.context_hash,
        original_user_intent: full.stage_context.original_user_intent,
        current_user_delta: full.stage_context.current_user_delta,
        selected_profile: full.stage_context.selected_profile,
        reference_package_id_or_hash:
          full.stage_context.reference_package_id_or_hash,
        workspace_revision_or_hash:
          full.stage_context.workspace_revision_or_hash,
        stage_readiness: full.stage_context.stage_readiness,
        blocking_unknowns: full.stage_context.blocking_unknowns,
        requirements: full.stage_context.requirements,
      });
      expect(projected.stage_context?.workspace.gates).toEqual(
        full.stage_context.workspace.gates
      );
    }

    expect(JSON.stringify(projected).length).toBeLessThan(JSON.stringify(full).length);
  });

  test("Gateway Control headroom reserves continuation space at the whole-envelope boundary", async () => {
    const full = await buildControlPacket(projectionStatus);
    const result = projectControlPacketForGatewayWithDiagnostics(full, {
      envelope_bytes: 4096,
      continuation_reserve_bytes: 1024,
    });

    expect(result.diagnostics.envelope_budget_bytes).toBe(4096);
    expect(result.diagnostics.continuation_reserve_bytes).toBe(1024);
    expect(result.diagnostics.fixed_envelope_bytes).toBeGreaterThan(0);
    expect(result.diagnostics.stage_allowance_bytes).toBeGreaterThan(0);
    expect(result.diagnostics.stage?.required_over_budget).toBe(false);
    expect(result.packet.stage_context?.reference_image_ids).toEqual(
      full.stage_context?.reference_image_ids
    );
  });

  test("cached context IDs are not echoed back to the AI client", async () => {
    const first = await buildControlPacket(projectionStatus);
    const known = first.context.required.map((entry) => entry.id);
    const cached = await buildControlPacket(projectionStatus, {
      knownContextIds: known,
    });
    const projected = projectControlPacketForGateway(cached);

    expect(cached.context.cached_ids).toEqual(known);
    expect(cached.context.required).toEqual([]);
    expect(projected.context).toEqual({});
  });

  test("Gateway source uses the compact Control projection only at the AI-client boundary", async () => {
    const source = await Bun.file(
      "gateway/handlers/registerCoreTools.ts"
    ).text();
    expect(source).toContain("control: projectControlPacketForGateway(control)");
    expect(source).not.toContain("structuredContent: { control }");
  });
});


describe("Gateway status telemetry projection", () => {
  test("ready idle status omits historical counters and timestamps", () => {
    const projected = projectGatewayStatus(projectionStatus);
    expect(projected.connection).toEqual({ state: "ready" });
    expect(projected.operations).toEqual({ active: 0, queued: 0 });
    expect(projected).not.toHaveProperty("last_error");
    expect(projected.connection).not.toHaveProperty("generation");
    expect(projected.connection).not.toHaveProperty("last_ready_at");
    expect(projected.operations).not.toHaveProperty("completed");
    expect(projected.operations).not.toHaveProperty("failed");
    expect(projected.operations).not.toHaveProperty("timed_out");
    expect(projected.operations).not.toHaveProperty("rejected_busy");
  });

  test("non-ready or busy state keeps decision-changing recovery data", () => {
    const projected = projectGatewayStatus({
      ...projectionStatus,
      connection: {
        ...projectionStatus.connection,
        state: "degraded",
        reconnect_count: 3,
        reconnect: { failures: 2, retry_after_ms: 750 },
      },
      operations: {
        ...projectionStatus.operations,
        active: 1,
        queued: 2,
      },
      last_error: "BACKEND_UNAVAILABLE",
    } as GatewayRuntimeStatus);

    expect(projected.connection).toEqual({
      state: "degraded",
      reconnect_count: 3,
      reconnect: { failures: 2, retry_after_ms: 750 },
    });
    expect(projected.operations).toEqual({
      active: 1,
      queued: 2,
      max_queue_depth: 8,
    });
    expect(projected.last_error).toBe("BACKEND_UNAVAILABLE");
  });
});
