import { GatewayOperationQueue } from "@/gateway/runtime/operationQueue";
import { describe, expect, test } from "bun:test";
import {
  CONTROL_ROUTING_POLICY,
  buildControlDelta,
  buildControlPacket,
  buildControlSnapshot,
  decorateCapabilities,
  resolveDevelopmentIntent,
} from "@/gateway/control";
import type { GatewayRuntimeStatus } from "@/gateway/backend";

const status: GatewayRuntimeStatus = {
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
    last_ready_at: "2026-09-12T00:00:00.000Z", last_transition_at: "2026-09-12T00:00:00.000Z",
    reconnect: { failures: 0, retry_after_ms: 0 },
  },
  operations: {
    ...new GatewayOperationQueue(8).snapshot(),
    active: 0,
    queued: 0,
    max_queue_depth: 8,
    completed: 0,
    failed: 0,
    timed_out: 0,
    rejected_busy: 0,
  },
  last_error: null,
};

describe("LazyDesigner Control active contract", () => {
  test("authoring domain and source owner are distinct canonical concepts", () => {
    const snapshot = buildControlSnapshot(status);
    expect(snapshot.protocol).toBe("lazydesigner-control-v1");
    expect(snapshot.authoring.domain).toBe("GEOMETRY");
    expect(snapshot.authoring).not.toHaveProperty("owner");

    const [capability] = decorateCapabilities(
      [{ capability_id: "manage_cubes", description: "Create or update Bedrock cubes.", tier: "primary", read_only: false, destructive: true, idempotent: false }],
      "GEOMETRY"
    );

    expect(capability.control.authoring_domain).toBe("GEOMETRY");
    expect(capability.control.current_domain).toBe(true);
    expect(capability.control.source_owner.source).toBe("mcp/server/tools/geometry/cubes.ts");
    expect(capability.control).not.toHaveProperty("owner");
    expect(capability.control).not.toHaveProperty("current_owner");

    const delta = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
    });
    expect(delta.protocol).toBe("lazydesigner-control-v1");
    expect(delta.authoring_domain).toBe("GEOMETRY");
    expect(delta.invalidates.authoring_domains).toEqual(["GEOMETRY", "TEXTURING", "ANIMATION"]);
  });

  test("Gateway bootstrap states client Skill-content and quality boundaries", async () => {
    const source = await Bun.file("gateway/index.ts").text();
    expect(source).toContain("Load active Skill/profile via Control handles");
    expect(source).toContain("content survives compaction");
    expect(source).toContain("Sample before bulk visual edits");
    expect(source).toContain("paged status(reference_fact_request) with fingerprint");
    const handler = await Bun.file("gateway/handlers/registerCoreTools.ts").text();
    expect(handler).toContain("reference_fact_request");
    expect(handler).toContain("readReferenceFactPage");
    expect(handler).toContain("REFERENCE_FACT_REVISION_CHANGED");
    expect(handler).toContain("REFERENCE_FACT_NOT_OMITTED");
    expect(handler).toContain("contents still present in the client's active context");
    expect(handler).toContain("compaction/restart");
    expect(source).toContain("mutation success is not visual approval");
  });

  test("routing policy remains direct-first and bounded without being retransmitted in every packet", async () => {
    expect(CONTROL_ROUTING_POLICY.strategy).toBe("DIRECT_FIRST");
    expect(CONTROL_ROUTING_POLICY.known_capability).toBe("INVOKE_CAPABILITY");
    expect(CONTROL_ROUTING_POLICY.unknown_capability).toBe("SEARCH_CAPABILITIES");
    expect(CONTROL_ROUTING_POLICY.schema_uncertain).toBe("DESCRIBE_CAPABILITY");
    expect(CONTROL_ROUTING_POLICY.stale_or_lost_context).toBe("STATUS");
    expect(CONTROL_ROUTING_POLICY.development_unresolved).toBe("BOUNDED_CONTEXT_THEN_TARGETED_SEARCH");
    expect(CONTROL_ROUTING_POLICY.search_limit).toBe(4);

    const packet = await buildControlPacket(status);
    expect(packet.protocol).toBe("lazydesigner-control-v1");
    expect(packet).not.toHaveProperty("control_protocol");
    expect(packet).not.toHaveProperty("routing");
    expect(JSON.stringify(packet).length).toBeLessThan(6700);
  });

  test("system-development task identity ignores unrelated asset affinity and authoring phase", async () => {
    const first = await buildControlPacket(status, {
      taskMode: "SYSTEM_DEVELOPMENT",
      taskIntent: "animation keyframe terlalu kaku",
    });
    const second = await buildControlPacket(
      { ...status, affinity: { project_uuid: "project-b", authoring_phase: "texturing" } },
      { taskMode: "SYSTEM_DEVELOPMENT", taskIntent: "animation keyframe terlalu kaku" }
    );
    expect(second.task_context_id).toBe(first.task_context_id);
  });

  test("same-build Runtime replacement changes asset task identity", async () => {
    const options = { currentUserDelta: "resize the same cube" };
    const first = await buildControlPacket(status, options);
    const refreshed = await buildControlPacket({
      ...status,
      connection: {
        ...status.connection, generation: 2, catalog_refresh_count: 2,
      },
    }, options);
    const replacement = await buildControlPacket({
      ...status,
      runtime: {
        ...status.runtime,
        runtime_signature: "runtime-restarted",
        connected_signature: "runtime-restarted",
      },
    }, options);

    expect(first.task_context_id).toMatch(/^task:[a-f0-9]{20}$/);
    expect(refreshed.task_context_id).toBe(first.task_context_id);
    expect(replacement.task_context_id).not.toBe(first.task_context_id);
  });

  test("development task identity also distinguishes Runtime instances", async () => {
    const options = {
      taskMode: "SYSTEM_DEVELOPMENT" as const,
      taskIntent: "fix animation keyframe constraints",
    };
    const first = await buildControlPacket(status, options);
    const replacement = await buildControlPacket({
      ...status,
      runtime: {
        ...status.runtime,
        runtime_signature: "runtime-second-instance",
        connected_signature: "runtime-second-instance",
      },
    }, options);
    expect(replacement.task_context_id).not.toBe(first.task_context_id);
  });

  test("unresolved development routing remains bounded and fail-closed", () => {
    const result = resolveDevelopmentIntent("something unusual elsewhere");
    expect(result.task_class).toBe("SYSTEM_DEVELOPMENT");
    expect(result.domain).toBe("UNRESOLVED");
    expect(result.confidence).toBe("UNRESOLVED");
    expect(result.source_owners).toEqual([]);
    expect(result.required_context_paths).toEqual(["AGENTS.md", "mcp/AGENTS.md"]);
  });
});
