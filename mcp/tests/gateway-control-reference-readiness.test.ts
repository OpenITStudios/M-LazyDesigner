import { GatewayOperationQueue } from "@/gateway/runtime/operationQueue";
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildControlPacket } from "@/gateway/control";
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
    ...new GatewayOperationQueue(8).snapshot(), active: 0, queued: 0, max_queue_depth: 8, completed: 0, failed: 0, timed_out: 0, rejected_busy: 0 },
  last_error: null,
};

describe("LazyDesigner Control reference readiness", () => {
  test("a blocker owned by another stage does not block READY Geometry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lazydesigner-stage-ready-"));
    await writeFile(join(directory, "REFERENCE.json"), JSON.stringify({
      schema: "lazydesigner-reference-v1",
      asset: {
        name: "test_asset",
        profile: "PROP_FURNITURE",
        task: "NEW_ASSET",
        intent: "Build the approved test asset",
      },
      requirements: {
        dimensions_blocks: { width: null, height: null, length: null },
        player_relative_scale: "WAIST_HEIGHT",
        animation_required: false,
      },
      unknowns: {
        blocking: ["exact emissive color is unresolved"],
        non_blocking: [],
      },
      readiness: {
        overall: "NEEDS_REVIEW",
        geometry: "READY",
        texture: "BLOCKED",
        animation: "NOT_REQUIRED",
      },
    }));

    const packet = await buildControlPacket(status, {
      referencePackagePath: directory,
    });

    expect(packet.stage_context?.stage_readiness).toBe("READY");
    expect(packet.stage_context?.blocking_unknowns).toEqual([]);
    expect(packet.blockers).not.toContain("REFERENCE_STAGE_BLOCKED");
    expect(packet.readiness.reasons).not.toContain("REFERENCE_STAGE_BLOCKED");
  });

  test("current-stage NEEDS_REVIEW remains visible through the actual Control packet", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lazydesigner-stage-review-"));
    await writeFile(join(directory, "REFERENCE.json"), JSON.stringify({
      schema: "lazydesigner-reference-v1",
      asset: { name: "review_target", profile: "PROP_FURNITURE" },
      readiness: {
        overall: "NEEDS_REVIEW", geometry: "NEEDS_REVIEW",
        texture: "BLOCKED", animation: "NOT_REQUIRED",
      },
    }));
    const packet = await buildControlPacket(status, { referencePackagePath: directory });
    expect(packet.stage_context?.stage_readiness).toBe("NEEDS_REVIEW");
    expect(packet.readiness.modelling_start).toBe("NEEDS_ORIENTATION");
    expect(packet.readiness.reasons).toContain("REFERENCE_STAGE_NEEDS_REVIEW");
    expect(packet.blockers).not.toContain("REFERENCE_STAGE_BLOCKED");
    expect(packet.readiness.runtime_ready).toBe(true);
  });

  test("normalized lowercase reference BLOCKED cannot hide its source blocker", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lazydesigner-stage-lower-block-"));
    await writeFile(join(directory, "REFERENCE.json"), JSON.stringify({
      schema: "lazydesigner-reference-v1",
      asset: { name: "blocked_target", profile: "PROP_FURNITURE" },
      unknowns: { blocking: ["required side view unresolved"], non_blocking: [] },
      readiness: { overall: "BLOCKED", geometry: " blocked " },
    }));
    const packet = await buildControlPacket(status, { referencePackagePath: directory });
    expect(packet.stage_context?.stage_readiness).toBe("BLOCKED");
    expect(packet.stage_context?.blocking_unknowns).toContain("required side view unresolved");
    expect(packet.blockers).toContain("REFERENCE_STAGE_BLOCKED");
    expect(packet.readiness.modelling_start).toBe("BLOCKED");
  });

  test("BLOCKED active stage projects blocking evidence and fails closed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lazydesigner-stage-blocked-"));
    await writeFile(join(directory, "REFERENCE.json"), JSON.stringify({
      schema: "lazydesigner-reference-v1",
      asset: {
        name: "test_asset",
        profile: "PROP_FURNITURE",
        task: "NEW_ASSET",
        intent: "Build the approved test asset",
      },
      requirements: { animation_required: false },
      unknowns: {
        blocking: ["front/rear attachment conflicts"],
        non_blocking: [],
      },
      readiness: {
        overall: "BLOCKED",
        geometry: "BLOCKED",
        texture: "NEEDS_REVIEW",
        animation: "NOT_REQUIRED",
      },
    }));

    const packet = await buildControlPacket(status, {
      referencePackagePath: directory,
    });

    expect(packet.stage_context?.stage_readiness).toBe("BLOCKED");
    expect(packet.stage_context?.blocking_unknowns).toEqual([
      "front/rear attachment conflicts",
    ]);
    expect(packet.blockers).toContain("REFERENCE_STAGE_BLOCKED");
    expect(packet.readiness.modelling_start).toBe("BLOCKED");
  });
});
