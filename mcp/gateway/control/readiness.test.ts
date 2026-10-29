import { describe, expect, test } from "bun:test";
import {
  buildReadiness,
  lifecycleForDomain,
  NOT_REQUIRED_LIFECYCLE,
} from "./readiness";
import { emptyReference, parseReferencePackage } from "./referenceParser";
import { emptyWorkspace } from "./packetData";
import { workspaceSemanticState } from "./workspace";
import type { ControlSnapshot } from "./types";
import type { ControlReferenceProjection } from "./referenceTypes";

const baseSnapshot = (): ControlSnapshot => ({
  protocol: "lazydesigner-control-v1",
  system: "READY",
  mode: "ASSET_AUTHORING",
  project: {
    affinity_uuid: "project-1",
    active_uuid: "project-1",
    open_project_count: 1,
    binding: "BOUND",
  },
  authoring: {
    phase: "geometry",
    domain: "GEOMETRY",
    next_intent: "CONTINUE_GEOMETRY_OR_UV",
  },
  runtime: {
    online: true,
    mcp_client_ready: true,
    build_identity: "build",
    runtime_signature: "runtime",
    catalog_count: 54,
    catalog_stale: false,
  },
  context: {
    required: [{
      id: "ctx:skill/modelling@abc.def",
      path: "skill",
      sha256: "a".repeat(64),
      semantic_dependencies: ["routing", "graph"],
      semantic_revision: "b".repeat(64),
    }],
    optional: [],
  },
  blockers: [],
});

describe("Control readiness policy", () => {
  test("Geometry is lifecycle-ready without downstream approvals", () => {
    const lifecycle = lifecycleForDomain("GEOMETRY", emptyWorkspace());
    expect(lifecycle).toMatchObject({
      ready: true,
      blocked: false,
      orientation_required: false,
    });
  });

  test("Texturing requires Geometry approval and UV pass when workspace is available", () => {
    const workspace = {
      ...emptyWorkspace(),
      available: true,
      unavailable_reason: undefined,
      gates: {
        geometry: "APPROVED",
        uv_layout: "PASS",
        texturing: null,
        animation: null,
      },
    };
    expect(lifecycleForDomain("TEXTURING", workspace).blocked).toBe(false);

    workspace.gates.uv_layout = "PENDING";
    expect(lifecycleForDomain("TEXTURING", workspace).reasons).toContain(
      "UV_LAYOUT_PASS_REQUIRED"
    );
  });

  test("workspace blockers and invalid lifecycle notes prevent false READY without losing Runtime", () => {
    const reference = {
      ...emptyReference("REFERENCE_PATH_UNAVAILABLE"), available: true,
    };
    for (const [text, reason] of [
      ["# Turret\nCurrent Stage: TEXTURING\nKnown blockers: visual acceptance pending",
       "WORKSPACE_BLOCKERS_REQUIRE_REVIEW"],
      ["# Drake\nCurrent Stage: GEOMETRY CORRECTION READY_FOR_USER_REVIEW",
       "WORKSPACE_CURRENT_STAGE_INVALID"],
      ["# Sentinel\nCurrent authority: saved model\n",
       "WORKSPACE_CURRENT_STAGE_MISSING"],
      ["# Lift\nCurrent Stage: COMPLETE\nKnown blocker(s): None for the delivered asset. Native reopen unverified",
       "WORKSPACE_BLOCKER_STATUS_AMBIGUOUS"],
    ] as const) {
      const workspace = {
        ...emptyWorkspace(), ...workspaceSemanticState(text),
        available: true, unavailable_reason: undefined,
      };
      const result = buildReadiness(
        baseSnapshot(), workspace, reference, "ASSET_AUTHORING",
        lifecycleForDomain("GEOMETRY", workspace), "READY"
      );
      expect(result.modelling_start, reason).toBe("NEEDS_ORIENTATION");
      expect(result.reasons, reason).toContain(reason);
      expect(result.runtime_ready).toBe(true);
    }
    const cleared = {
      ...emptyWorkspace(),
      ...workspaceSemanticState("# Clean\nCurrent Stage: GEOMETRY\nKnown blocker(s): none"),
      available: true, unavailable_reason: undefined,
    };
    expect(buildReadiness(
      baseSnapshot(), cleared, reference, "ASSET_AUTHORING",
      lifecycleForDomain("GEOMETRY", cleared), "READY"
    ).modelling_start).toBe("READY");
  });

  test("explicit current-stage reference review or unexpected status cannot advertise READY", () => {
    const reference = {
      ...emptyReference("REFERENCE_PATH_UNAVAILABLE"), available: true,
    };
    for (const [declared, reason] of [
      ["NEEDS_REVIEW", "REFERENCE_STAGE_NEEDS_REVIEW"],
      ["NOT_REQUIRED", "REFERENCE_STAGE_NOT_REQUIRED"],
      ["PASS", "REFERENCE_STAGE_READINESS_INVALID"],
      ["invalid", "REFERENCE_STAGE_READINESS_INVALID"],
    ] as const) {
      const state = buildReadiness(
        baseSnapshot(), emptyWorkspace(), reference,
        "ASSET_AUTHORING", NOT_REQUIRED_LIFECYCLE, declared
      );
      expect(state.modelling_start, declared).toBe("NEEDS_ORIENTATION");
      expect(state.reasons, declared).toContain(reason);
      expect(state.runtime_ready).toBe(true);
    }
    const blocked = buildReadiness(
      baseSnapshot(), emptyWorkspace(), reference,
      "ASSET_AUTHORING", NOT_REQUIRED_LIFECYCLE, "  blocked  "
    );
    expect(blocked.modelling_start).toBe("BLOCKED");
    expect(blocked.reasons).toContain("REFERENCE_STAGE_BLOCKED");
    expect(buildReadiness(
      baseSnapshot(), emptyWorkspace(), reference,
      "ASSET_AUTHORING", NOT_REQUIRED_LIFECYCLE, "ready"
    ).modelling_start).toBe("READY");
  });

  test("missing reference asks for orientation, never signals modelling READY", () => {
    const snapshot = baseSnapshot();
    const missing = buildReadiness(
      snapshot, emptyWorkspace(), emptyReference("REFERENCE_PATH_UNAVAILABLE"),
      "ASSET_AUTHORING", NOT_REQUIRED_LIFECYCLE, null
    );
    expect(missing.modelling_start).toBe("NEEDS_ORIENTATION");
    expect(missing.reasons).toContain("REFERENCE_PACKAGE_UNAVAILABLE");
    const present = buildReadiness(
      snapshot, emptyWorkspace(),
      { ...emptyReference("REFERENCE_PATH_UNAVAILABLE"), available: true },
      "ASSET_AUTHORING", NOT_REQUIRED_LIFECYCLE, null
    );
    expect(present.modelling_start).toBe("READY");
  });

  test("incomplete reference projection requires orientation without blocking the Runtime", () => {
    const truncated = buildReadiness(
      baseSnapshot(), emptyWorkspace(),
      { ...emptyReference("REFERENCE_PATH_UNAVAILABLE"), available: true,
        truncated_sections: ["parts"] },
      "ASSET_AUTHORING", NOT_REQUIRED_LIFECYCLE, null
    );
    expect(truncated.modelling_start).toBe("NEEDS_ORIENTATION");
    expect(truncated.runtime_ready).toBe(true);
    expect(truncated.reasons).toContain("REFERENCE_PROJECTION_INCOMPLETE");
  });

  test("unrelated future-stage omissions do not block an otherwise ready Geometry decision", () => {
    const reference = {
      ...emptyReference("REFERENCE_PATH_UNAVAILABLE"),
      available: true,
      truncated_sections: ["materials"] as NonNullable<ControlReferenceProjection["truncated_sections"]>,
    };
    const readiness = buildReadiness(
      baseSnapshot(), emptyWorkspace(), reference,
      "ASSET_AUTHORING", NOT_REQUIRED_LIFECYCLE, "READY"
    );
    expect(readiness.modelling_start).toBe("READY");
    expect(readiness.reasons).not.toContain("REFERENCE_PROJECTION_INCOMPLETE");

    const textureSnapshot = baseSnapshot();
    textureSnapshot.authoring.domain = "TEXTURING";
    textureSnapshot.authoring.phase = "texturing";
    const textureReadiness = buildReadiness(
      textureSnapshot, emptyWorkspace(), reference,
      "ASSET_AUTHORING", NOT_REQUIRED_LIFECYCLE, "READY"
    );
    expect(textureReadiness.reasons).toContain("REFERENCE_PROJECTION_INCOMPLETE");
  });

  test("a ninth hidden workspace blocker requires orientation without claiming Runtime failure", () => {
    const workspace = {
      ...emptyWorkspace(),
      available: true,
      blockers: Array.from({ length: 8 }, (_, i) => `blocker ${i}`),
      blockers_omitted_count: 1,
      blockers_omitted_sha256: "a".repeat(64),
    };
    const reference = {
      ...emptyReference("REFERENCE_PATH_UNAVAILABLE"), available: true,
    };
    const readiness = buildReadiness(
      baseSnapshot(), workspace, reference,
      "ASSET_AUTHORING", NOT_REQUIRED_LIFECYCLE, "READY"
    );
    expect(readiness.modelling_start).toBe("NEEDS_ORIENTATION");
    expect(readiness.runtime_ready).toBe(true);
    expect(readiness.reasons).toContain("WORKSPACE_PROJECTION_INCOMPLETE");
  });

  test("hidden structured-fact omissions cannot produce a false READY stage", () => {
    const reference = parseReferencePackage(JSON.stringify({
      schema: "lazydesigner-reference-v1",
      parts: [{ id: "body", components: Array.from({ length: 13 }, (_, i) => `part_${i}`) }],
    }), "/pkg/REFERENCE.json", "/pkg");
    expect(reference?.truncated_sections).toEqual(["parts"]);
    const readiness = buildReadiness(
      baseSnapshot(), emptyWorkspace(), reference!,
      "ASSET_AUTHORING", NOT_REQUIRED_LIFECYCLE, "READY"
    );
    expect(readiness.modelling_start).toBe("NEEDS_ORIENTATION");
    expect(readiness.runtime_ready).toBe(true);
    expect(readiness.reasons).toContain("REFERENCE_PROJECTION_INCOMPLETE");
  });

  test("first HTTP-only Runtime probe is orientation rather than MCP execution-ready", () => {
    const baseline = baseSnapshot();
    const cold = {
      ...baseline,
      runtime: { ...baseline.runtime, mcp_client_ready: false },
    };
    const reference = {
      ...emptyReference("REFERENCE_PATH_UNAVAILABLE"),
      available: true,
    };
    const asset = buildReadiness(
      cold, emptyWorkspace(), reference,
      "ASSET_AUTHORING", NOT_REQUIRED_LIFECYCLE, "READY"
    );
    expect(asset.runtime_ready).toBe(false);
    expect(asset.modelling_start).toBe("NEEDS_ORIENTATION");
    expect(asset.reasons).toContain("RUNTIME_HANDSHAKE_PENDING");
    expect(asset.reasons).not.toContain("RUNTIME_CLIENT_NOT_READY");

    const dev = buildReadiness(
      cold, emptyWorkspace(), emptyReference("REFERENCE_PATH_UNAVAILABLE"),
      "SYSTEM_DEVELOPMENT", NOT_REQUIRED_LIFECYCLE, null
    );
    expect(dev.runtime_ready).toBe(false);
    expect(dev.context_ready).toBe(true);
    expect(dev.reasons).toContain("RUNTIME_HANDSHAKE_PENDING");

    const warm = buildReadiness(
      baseline, emptyWorkspace(), reference,
      "ASSET_AUTHORING", NOT_REQUIRED_LIFECYCLE, "READY"
    );
    expect(warm.runtime_ready).toBe(true);
    expect(warm.modelling_start).toBe("READY");
  });


  test("missing MCP readiness evidence cannot be treated as a successful handshake", () => {
    const baseline = baseSnapshot();
    const unknown = {
      ...baseline,
      runtime: { ...baseline.runtime, mcp_client_ready: undefined },
    };
    const reference = {
      ...emptyReference("REFERENCE_PATH_UNAVAILABLE"),
      available: true,
    };
    const asset = buildReadiness(
      unknown, emptyWorkspace(), reference,
      "ASSET_AUTHORING", NOT_REQUIRED_LIFECYCLE, "READY"
    );
    expect(asset.runtime_ready).toBe(false);
    expect(asset.modelling_start).toBe("BLOCKED");
    expect(asset.reasons).not.toContain("RUNTIME_HANDSHAKE_PENDING");
    expect(asset.reasons).toContain("RUNTIME_CLIENT_STATE_UNKNOWN");

    const dev = buildReadiness(
      unknown, emptyWorkspace(), emptyReference("REFERENCE_PATH_UNAVAILABLE"),
      "SYSTEM_DEVELOPMENT", NOT_REQUIRED_LIFECYCLE, null
    );
    expect(dev.runtime_ready).toBe(false);
    expect(dev.modelling_start).toBe("NEEDS_ORIENTATION");
    expect(dev.context_ready).toBe(true);
    expect(dev.reasons).toContain("RUNTIME_CLIENT_STATE_UNKNOWN");
    // Explicitly confirmed MCP readiness still works in the next request.
    expect(buildReadiness(
      baseline, emptyWorkspace(), reference,
      "ASSET_AUTHORING", NOT_REQUIRED_LIFECYCLE, "READY"
    ).runtime_ready).toBe(true);
  });

  test("system development does not report Runtime ready when the MCP client is lost", () => {
    const disconnected = {
      ...baseSnapshot(),
      blockers: ["RUNTIME_CLIENT_NOT_READY"],
    };
    const readiness = buildReadiness(
      disconnected,
      emptyWorkspace(),
      emptyReference("REFERENCE_PATH_UNAVAILABLE"),
      "SYSTEM_DEVELOPMENT",
      NOT_REQUIRED_LIFECYCLE,
      null
    );
    expect(readiness.runtime_ready).toBe(false);
    expect(readiness.context_ready).toBe(true);
    expect(readiness.modelling_start).toBe("NEEDS_ORIENTATION");
    expect(readiness.reasons).toContain("RUNTIME_CLIENT_NOT_READY");
    expect(readiness.reasons).toContain("SYSTEM_DEVELOPMENT_MODE");
  });

  test("system development readiness does not require asset context", () => {
    const readiness = buildReadiness(
      baseSnapshot(),
      emptyWorkspace(),
      emptyReference("REFERENCE_PATH_UNAVAILABLE"),
      "SYSTEM_DEVELOPMENT",
      NOT_REQUIRED_LIFECYCLE,
      null
    );
    expect(readiness).toMatchObject({
      modelling_start: "NEEDS_ORIENTATION",
      runtime_ready: true,
      context_ready: true,
      workspace_state: "NOT_REQUIRED",
      reasons: ["SYSTEM_DEVELOPMENT_MODE"],
    });
  });
});
