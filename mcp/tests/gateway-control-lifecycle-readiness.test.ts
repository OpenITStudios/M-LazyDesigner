import { GatewayOperationQueue } from "@/gateway/runtime/operationQueue";
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildControlPacket } from "@/gateway/control";
import type { GatewayRuntimeStatus } from "@/gateway/backend";

function status(
  phase: "geometry" | "texturing" | "animation",
  projectUuid: string = "project-a"
): GatewayRuntimeStatus {
  return {
    gateway: "ready",
    affinity: { project_uuid: projectUuid, authoring_phase: phase },
    runtime: {
      online: true,
      endpoint: "http://127.0.0.1:3000/bb-mcp",
      mcp_client_ready: true,
      catalog_stale: false,
      runtime_signature: `runtime-${phase}`,
      connected_signature: `runtime-${phase}`,
      catalog_count: phase === "animation" ? 18 : 47,
      health: {
        build_identity: "sha256:build-a",
        product: { authoring_phase: phase },
        project_context: {
          active_project_uuid: projectUuid,
          requested_project_uuid: projectUuid,
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
}

async function workspace(gates: {
  geometry: string;
  uv: string;
  texturing: string;
  animation?: string;
}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lazydesigner-lifecycle-"));
  await writeFile(join(directory, "README.md"), `# Lifecycle Fixture\n\nCurrent Stage: TEXTURING\n\nGeometry: ${gates.geometry}\n\nUV Layout: ${gates.uv}\n\nTexturing: ${gates.texturing}\n\nAnimation: ${gates.animation ?? "NOT_STARTED"}\n\nCurrent next step: Continue current stage\n\nKnown blocker(s): None\n`);
  await writeFile(join(directory, "REFERENCE.json"), JSON.stringify({
    schema: "lazydesigner-reference-v1",
    asset: { name: "test-model", profile: "PROP_FURNITURE" },
    readiness: { geometry: "READY", texture: "READY", animation: "READY" },
  }));
  return directory;
}

describe("LazyDesigner Control lifecycle readiness", () => {
  test("Geometry does not require downstream workspace gates", async () => {
    const packet = await buildControlPacket(status("geometry"));
    expect(packet.readiness.reasons).not.toContain("GEOMETRY_APPROVAL_REQUIRED");
    expect(packet.readiness.reasons).not.toContain("UV_LAYOUT_PASS_REQUIRED");
  });

  test("Texturing blocks when Geometry approval or UV Layout PASS is missing", async () => {
    const directory = await workspace({ geometry: "IN_PROGRESS", uv: "NOT_STARTED", texturing: "NOT_STARTED" });
    const packet = await buildControlPacket(status("texturing"), { workspacePath: directory });

    expect(packet.readiness.modelling_start).toBe("BLOCKED");
    expect(packet.readiness.reasons).toContain("GEOMETRY_APPROVAL_REQUIRED");
    expect(packet.readiness.reasons).toContain("UV_LAYOUT_PASS_REQUIRED");
    expect(packet.blockers).toContain("GEOMETRY_APPROVAL_REQUIRED");
    expect(packet.blockers).toContain("UV_LAYOUT_PASS_REQUIRED");
  });

  test("Texturing becomes legal after Geometry APPROVED and UV Layout PASS", async () => {
    const directory = await workspace({ geometry: "APPROVED", uv: "PASS", texturing: "IN_PROGRESS" });
    const packet = await buildControlPacket(status("texturing"), {
      workspacePath: directory, referencePackagePath: directory,
    });

    expect(packet.readiness.modelling_start).toBe("READY");
    expect(packet.readiness.reasons).not.toContain("GEOMETRY_APPROVAL_REQUIRED");
    expect(packet.readiness.reasons).not.toContain("UV_LAYOUT_PASS_REQUIRED");
  });

  test("Animation additionally requires Texturing APPROVED", async () => {
    const directory = await workspace({ geometry: "APPROVED", uv: "PASS", texturing: "READY_FOR_USER_REVIEW" });
    const packet = await buildControlPacket(status("animation"), { workspacePath: directory });

    expect(packet.readiness.modelling_start).toBe("BLOCKED");
    expect(packet.readiness.reasons).toContain("TEXTURE_APPROVAL_REQUIRED");
  });

  test("Animation is lifecycle-ready when upstream persisted gates are approved", async () => {
    const directory = await workspace({ geometry: "APPROVED", uv: "PASS", texturing: "APPROVED", animation: "IN_PROGRESS" });
    const packet = await buildControlPacket(status("animation"), {
      workspacePath: directory, referencePackagePath: directory,
    });

    expect(packet.readiness.modelling_start).toBe("READY");
    expect(packet.readiness.reasons).not.toContain("TEXTURE_APPROVAL_REQUIRED");
  });

  test("Animation requirement mismatch is visible through real Control status without stopping Geometry", async () => {
    const directory = await workspace({
      geometry: "APPROVED", uv: "PASS", texturing: "APPROVED",
      animation: "NOT_STARTED",
    });
    await writeFile(join(directory, "README.md"), [
      "# Lifecycle Fixture", "Current Stage: ANIMATION",
      "Geometry: APPROVED", "UV Layout: PASS",
      "Texturing: APPROVED", "Animation: NOT_STARTED",
      "Animation Required: YES", "Known blocker(s): none",
    ].join("\n"));
    await writeFile(join(directory, "REFERENCE.json"), JSON.stringify({
      schema: "lazydesigner-reference-v1",
      asset: { name: "test-model", profile: "PROP_FURNITURE" },
      requirements: { animation_required: false },
      readiness: { overall: "READY", geometry: "READY",
        texture: "READY", animation: "READY" },
    }));
    const animation = await buildControlPacket(status("animation"), {
      workspacePath: directory, referencePackagePath: directory,
    });
    expect(animation.readiness.modelling_start).toBe("NEEDS_ORIENTATION");
    expect(animation.readiness.reasons).toContain("ANIMATION_REQUIREMENT_CONFLICT");
    expect(animation.stage_context?.asset_health.overall).toBe("REVIEW");
    expect(animation.stage_context?.asset_health.stages.animation).toBe("UNVERIFIED");

    const geometry = await buildControlPacket(status("geometry"), {
      workspacePath: directory, referencePackagePath: directory,
    });
    expect(geometry.readiness.reasons).not.toContain("ANIMATION_REQUIREMENT_CONFLICT");
    expect(geometry.readiness.modelling_start).toBe("READY");
  });

  test("actual Control status verifies FINALIZATION native checkpoint against bound project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lazydesigner-finalization-"));
    const native = join(dir, "fixture.bbmodel");
    const bytes = '{"native_revision":1}';
    const hash = "sha256:" + createHash("sha256").update(bytes).digest("hex");
    const final = [
      "# Lifecycle Fixture", "Current Stage: FINALIZATION",
      "Geometry: APPROVED", "UV Layout: PASS",
      "Texturing: APPROVED", "Animation: NOT_REQUIRED",
      "Animation Required: NO",
      "Finalization Checkpoint SHA256: " + hash,
      "Current next step: Finalize native outputs", "Known blocker(s): none",
    ].join("\n");
    const live = status("texturing");
    const projectHealth = (live.runtime.health as Record<string, unknown>)
      .project_context as Record<string, unknown>;
    projectHealth.requested_project = {
      uuid: "project-a", save_path: native, saved: true,
    };
    try {
      await writeFile(native, bytes);
      await writeFile(join(dir, "README.md"), final);
      await writeFile(join(dir, "REFERENCE.json"), JSON.stringify({
        schema: "lazydesigner-reference-v1",
        asset: { name: "test-model", profile: "PROP_FURNITURE" },
        requirements: { animation_required: false },
        readiness: {
          overall: "READY", geometry: "READY", texture: "READY",
          animation: "NOT_REQUIRED",
        },
      }));
      const matched = await buildControlPacket(live, {
        workspacePath: dir, referencePackagePath: dir,
      });
      expect(matched.workspace.finalization_native_revision?.state).toBe("MATCHED");
      expect(matched.stage_context?.asset_health.overall).toBe("READY");
      expect(matched.readiness.modelling_start).toBe("READY");
      await writeFile(native, '{"native_revision":2}');
      const stale = await buildControlPacket(live, {
        workspacePath: dir, referencePackagePath: dir,
      });
      expect(stale.workspace.finalization_native_revision?.state).toBe("STALE");
      expect(stale.workspace.fingerprint).not.toBe(matched.workspace.fingerprint);
      expect(stale.stage_context?.asset_health.overall).toBe("BLOCKED");
      expect(stale.readiness.modelling_start).toBe("BLOCKED");
      expect(stale.blockers).toContain("FINALIZATION_NATIVE_CHECKPOINT_STALE");
      expect(stale.stage_context?.asset_health.stages.geometry).toBe("PASS");

      // Matching current native bytes do not repair a missing Stage approval.
      await writeFile(native, bytes);
      const readme = join(dir, "README.md");
      await writeFile(readme, final.replace(
        "Texturing: APPROVED", "Texturing: IN_PROGRESS"
      ));
      const incomplete = await buildControlPacket(live, {
        workspacePath: dir, referencePackagePath: dir,
      });
      expect(incomplete.workspace.finalization_native_revision?.state).toBe("MATCHED");
      expect(incomplete.stage_context?.asset_health.overall).toBe("REVIEW");
      expect(incomplete.readiness.modelling_start).toBe("NEEDS_ORIENTATION");
      expect(incomplete.readiness.reasons).toContain("FINALIZATION_UPSTREAM_GATES_REQUIRE_REVIEW");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing Workspace asks for orientation instead of inventing downstream failure", async () => {
    const packet = await buildControlPacket(
      status("texturing", "project-without-workspace")
    );
    expect(packet.readiness.modelling_start).toBe("NEEDS_ORIENTATION");
    expect(packet.readiness.reasons).toContain("WORKSPACE_LIFECYCLE_UNAVAILABLE");
    expect(packet.blockers).not.toContain("GEOMETRY_APPROVAL_REQUIRED");
  });
});
