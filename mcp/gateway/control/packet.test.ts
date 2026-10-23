import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildControlPacket } from "./packet";
import { emptyWorkspace, workspaceSummary } from "./packetData";
import { workspaceSemanticState } from "./workspace";
import { projectControlPacketForGateway } from "./gatewayProjection";
import type { GatewayRuntimeStatus } from "../runtime/backend";
import type { ControlContextHandle } from "./types";
import { semanticRevisionForDependencies } from "../development/semanticDependencies";

const status = {
  affinity: { project_uuid: "project-1", authoring_phase: "geometry" },
  runtime: {
    online: true,
    mcp_client_ready: true,
    catalog_stale: false,
    catalog_count: 54,
    runtime_signature: "fixture-runtime",
    health: null,
  },
} as unknown as GatewayRuntimeStatus;

const path = "docs/03-authoring/modelling/profiles/humanoid.md";
const contextId = "ctx:skill/modelling@old.old";
const profileId = "ctx:profile/humanoid@old.old";
function handle(path: string): ControlContextHandle {
  return {
    id: "ctx:skill/modelling@new.new",
    path,
    sha256: "a".repeat(64),
    semantic_dependencies: ["routing"],
    semantic_revision: semanticRevisionForDependencies(["routing"]),
  };
}

describe("Control packet missing context boundary", () => {
  test("missing selected profile never masks online Runtime or declares authoring ready", async () => {
    const packet = await buildControlPacket(status, {
      knownContextIds: [contextId, profileId],
      contextResolver: async () => ({
        required: [handle("modelling")],
        optional: [],
        unavailable: [{ path, code: "CONTEXT_FILE_MISSING" }],
      }),
    });
    expect(packet.runtime.online).toBe(true);
    expect(packet.system).toBe("DEGRADED");
    expect(packet.readiness).toMatchObject({
      runtime_ready: true, context_ready: false, modelling_start: "BLOCKED",
    });
    expect(packet.readiness.reasons).toContain("REQUIRED_CONTEXT_UNAVAILABLE");
    expect(packet.blockers).toContain("REQUIRED_CONTEXT_UNAVAILABLE");
    expect(packet.context.invalidated_ids).toEqual([contextId, profileId]);
    expect(packet.context.required).toHaveLength(1);
    const projected = projectControlPacketForGateway(packet);
    expect(projected.context.unavailable).toEqual([
      { path, code: "CONTEXT_FILE_MISSING" },
    ]);
    expect(projected.context.invalidated_ids).toEqual([contextId, profileId]);
  });

  test("healthy resolver preserves normal cached context behavior", async () => {
    const packet = await buildControlPacket(status, {
      knownContextIds: [handle("modelling").id],
      contextResolver: async () => ({
        required: [handle("modelling")], optional: [], unavailable: [],
      }),
    });
    expect(packet.context.cached_ids).toEqual([handle("modelling").id]);
    expect(packet.context.invalidated_ids).toEqual([]);
    expect(packet.context.unavailable).toBeUndefined();
    expect(packet.readiness.runtime_ready).toBe(true);
    expect(packet.readiness.context_ready).toBe(true);
  });

  test("Runtime offline remains OFFLINE despite a separate context failure", async () => {
    const offline = {
      ...status,
      runtime: { ...status.runtime, online: false },
    } as GatewayRuntimeStatus;
    const packet = await buildControlPacket(offline, {
      contextResolver: async () => ({
        required: [], optional: [],
        unavailable: [{ path, code: "CONTEXT_FILE_MISSING" }],
      }),
    });
    expect(packet.system).toBe("OFFLINE");
    expect(packet.readiness.runtime_ready).toBe(false);
    expect(packet.readiness.context_ready).toBe(false);
  });

  test("malformed workspace Stage and real blockers degrade the Control packet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lazydesigner-lifecycle-"));
    try {
      await writeFile(join(dir, "README.md"), [
        "# Reference asset", "Current Stage: GEOMETRY CORRECTION READY_FOR_USER_REVIEW",
        "Known blockers: visual review pending; broken attachment",
      ].join("\n"));
      const unboundStatus = {
        ...status, affinity: { ...status.affinity, project_uuid: null },
      } as GatewayRuntimeStatus;
      const packet = await buildControlPacket(unboundStatus, {
        workspacePath: dir,
        contextResolver: async () => ({
          required: [handle("modelling")], optional: [], unavailable: [],
        }),
      });
      expect(packet.blockers).toContain("WORKSPACE_BLOCKER_1");
      expect(packet.blockers).toContain("WORKSPACE_BLOCKER_2");
      expect(packet.blockers).toContain("WORKSPACE_CURRENT_STAGE_INVALID");
      expect(packet.readiness.reasons).toContain("WORKSPACE_BLOCKERS_REQUIRE_REVIEW");
      expect(packet.readiness.reasons).toContain("WORKSPACE_CURRENT_STAGE_INVALID");
      expect(packet.readiness.modelling_start).not.toBe("READY");
      expect(packet.readiness.runtime_ready).toBe(true);
      expect(packet.workspace.blocker_recovery).toEqual({
        source_path: join(dir, "README.md"), omitted_count: 0,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("clean workspace summary has no unnecessary recovery path", () => {
    const clean = {
      ...emptyWorkspace(),
      ...workspaceSemanticState("# Chair\nCurrent Stage: GEOMETRY\nKnown blocker(s): none"),
      available: true, source_path: "/projects/chair/README.md",
    };
    expect(workspaceSummary(clean)).not.toHaveProperty("blocker_recovery");
  });

  test("system development routing ignores authoring context failures", async () => {
    const packet = await buildControlPacket(status, {
      taskMode: "SYSTEM_DEVELOPMENT",
      contextResolver: async () => { throw new Error("must not load asset context"); },
    });
    expect(packet.readiness.context_ready).toBe(true);
    expect(packet.context.unavailable).toBeUndefined();
  });
});
