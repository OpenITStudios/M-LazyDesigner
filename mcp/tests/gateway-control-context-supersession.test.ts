import { GatewayOperationQueue } from "@/gateway/runtime/operationQueue";
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildControlPacket,
  projectControlPacketForGateway,
} from "@/gateway/control";
import type { GatewayRuntimeStatus } from "@/gateway/backend";

const baseStatus: GatewayRuntimeStatus = {
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
    state: "ready",
    generation: 1,
    reconnect_count: 0,
    catalog_refresh_count: 1,
    last_ready_at: "2026-09-20T00:00:00.000Z",
    last_transition_at: "2026-09-20T00:00:00.000Z",
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

async function referenceDir(profile: "HUMANOID" | "VEHICLE") {
  const directory = await mkdtemp(join(tmpdir(), "lazydesigner-supersession-"));
  await writeFile(
    join(directory, "REFERENCE.json"),
    JSON.stringify({
      schema: "lazydesigner-reference-v1",
      asset: {
        name: "fixture",
        kind: "MODEL",
        profile,
        intent: "Supersession fixture",
      },
      requirements: {
        dimensions_blocks: { width: null, height: null, length: null },
        player_relative_scale: null,
        animation_required: false,
      },
      readiness: {
        overall: "READY",
        geometry: "READY",
        texture: "READY",
        animation: "READY",
      },
      unknowns: { blocking: [], non_blocking: [] },
      documents: {},
      images: [],
    })
  );
  return directory;
}

describe("Control superseded context non-repetition", () => {
  test("profile reclassification invalidates the old profile instead of keeping two profile authorities", async () => {
    const humanoidDir = await referenceDir("HUMANOID");
    const vehicleDir = await referenceDir("VEHICLE");

    const humanoid = await buildControlPacket(baseStatus, {
      referencePackagePath: humanoidDir,
    });
    const known = humanoid.context.required.map((entry) => entry.id);
    const humanoidProfile = humanoid.context.required.find((entry) =>
      entry.id.startsWith("ctx:profile/")
    )!;
    const modellingSkill = humanoid.context.required.find((entry) =>
      entry.id.startsWith("ctx:skill/")
    )!;

    const vehicle = await buildControlPacket(baseStatus, {
      referencePackagePath: vehicleDir,
      knownContextIds: known,
    });

    expect(vehicle.context.required.map((entry) => entry.id)).toHaveLength(1);
    expect(vehicle.context.required[0]?.id).toStartWith("ctx:profile/vehicle@");
    expect(vehicle.context.invalidated_ids).toContain(humanoidProfile.id);
    expect(vehicle.context.invalidated_ids).not.toContain(modellingSkill.id);
    expect(vehicle.context.cached_ids).toContain(modellingSkill.id);
  });

  test("leaving Geometry invalidates both the old modelling skill and its profile", async () => {
    const humanoidDir = await referenceDir("HUMANOID");
    const geometry = await buildControlPacket(baseStatus, {
      referencePackagePath: humanoidDir,
    });
    const activeIds = geometry.context.required.map((handle) => handle.id);
    expect(activeIds).toHaveLength(2);

    const texturingStatus: GatewayRuntimeStatus = {
      ...baseStatus,
      affinity: { ...baseStatus.affinity, authoring_phase: "texturing" },
      runtime: {
        ...baseStatus.runtime,
        health: {
          ...baseStatus.runtime.health,
          product: { authoring_phase: "texturing" },
        },
      },
    };
    const known = [...activeIds, "ctx:doc/reference@older.version"];
    const texture = await buildControlPacket(texturingStatus, {
      referencePackagePath: humanoidDir,
      knownContextIds: known,
    });

    expect(texture.context.required).toHaveLength(1);
    expect(texture.context.required[0]?.id).toStartWith("ctx:skill/texturing@");
    expect(texture.context.invalidated_ids).toEqual(expect.arrayContaining(activeIds));
    expect(texture.context.invalidated_ids).not.toContain(known[2]);
    expect(texture.context.cached_ids).not.toContain(activeIds[0]);
    expect(texture.context.cached_ids).not.toContain(activeIds[1]);
  });

  test("authoring-to-development handoff withdraws old specialist at Gateway boundary", async () => {
    const authoring = await buildControlPacket(baseStatus);
    const skill = authoring.context.required.find((entry) =>
      entry.id.startsWith("ctx:skill/")
    )!;
    const development = await buildControlPacket(baseStatus, {
      taskMode: "SYSTEM_DEVELOPMENT",
      taskIntent: "repair routing code",
      knownContextIds: [skill.id, "ctx:doc/reference@older.version"],
    });
    const projected = projectControlPacketForGateway(development);

    expect(development.context.required).toEqual([]);
    expect(development.context.invalidated_ids).toEqual([skill.id]);
    expect(projected.context).toEqual({ invalidated_ids: [skill.id] });
    expect(development.task_context_id).toMatch(/^task:[a-f0-9]{20}$/);
  });

  test("authoring-stage change invalidates the previous specialist family", async () => {
    const geometry = await buildControlPacket(baseStatus);
    const known = geometry.context.required.map((entry) => entry.id);
    const modellingSkill = geometry.context.required.find((entry) =>
      entry.id.startsWith("ctx:skill/modelling@")
    )!;

    const animationStatus: GatewayRuntimeStatus = {
      ...baseStatus,
      affinity: { project_uuid: "project-a", authoring_phase: "animation" },
      runtime: {
        ...baseStatus.runtime,
        health: {
          ...baseStatus.runtime.health,
          product: { authoring_phase: "animation" },
        },
      },
    };

    const animation = await buildControlPacket(animationStatus, {
      knownContextIds: known,
    });

    expect(animation.context.required).toHaveLength(1);
    expect(animation.context.required[0]?.id).toStartWith(
      "ctx:skill/animation@"
    );
    expect(animation.context.invalidated_ids).toContain(modellingSkill.id);
    expect(animation.context.cached_ids).not.toContain(modellingSkill.id);
  });
});
