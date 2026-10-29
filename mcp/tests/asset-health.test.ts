import { describe, expect, test } from "bun:test";
import { buildAssetHealthSummary } from "@/lib/assetHealth";
import { buildControlStageContext } from "@/gateway/control/contextProjection";
import { workspaceSemanticState } from "@/gateway/control/workspace";
import type { ControlReferenceProjection } from "@/gateway/control/referenceTypes";
import type { ControlWorkspaceProjection } from "@/gateway/control/workspace";

function reference(animationRequired: boolean | null = true): ControlReferenceProjection {
  return {
    available: true,
    source_path: null,
    package_root: null,
    fingerprint: "ref",
    schema: "lazydesigner-reference-v1",
    asset_name: "asset",
    asset_kind: "MODEL",
    intent: "build asset",
    selected_profile: "GENERIC",
    requirements: {
      dimensions_blocks: null,
      player_relative_scale: null,
      animation_required: animationRequired,
    },
    readiness: {
      overall: "READY",
      geometry: "READY",
      texture: "READY",
      animation: animationRequired ? "READY" : "UNKNOWN",
    },
    particle: null,
    blocking_unknowns: [],
    non_blocking_unknowns: [],
    documents: {},
    images: [],
  };
}

function workspace(): ControlWorkspaceProjection {
  return {
    available: true,
    source_path: null,
    fingerprint: "workspace",
    asset: "asset",
    current_stage: "Animation",
    gates: {
      geometry: "APPROVED",
      uv_layout: "PASS",
      texturing: "APPROVED",
      animation: "APPROVED",
    },
    next_step: null,
    blockers: [],
  };
}

describe("asset health summary", () => {
  test("reports ready only when every required authoritative gate passes", () => {
    const result = buildAssetHealthSummary({
      domain: "ANIMATION",
      reference: reference(true),
      workspace: workspace(),
    });
    expect(result.overall).toBe("READY");
    expect(result.stages).toEqual({
      reference: "PASS",
      geometry: "PASS",
      uv_layout: "PASS",
      texturing: "PASS",
      animation: "PASS",
    });
  });

  test("does not invent an animation requirement for static assets", () => {
    const ws = workspace();
    ws.gates.animation = "NOT_STARTED";
    const result = buildAssetHealthSummary({
      domain: "TEXTURING",
      reference: reference(false),
      workspace: ws,
    });
    expect(result.stages.animation).toBe("NOT_REQUIRED");
    expect(result.overall).toBe("READY");
  });

  test("technical PASS never promotes Geometry, Texture, Animation or UV to a finalized approval", () => {
    for (const [gate, state] of [
      ["geometry", "PASS"],
      ["uv_layout", "APPROVED"],
      ["texturing", "PASS"],
      ["animation", "PASS"],
    ] as const) {
      const ws = workspace();
      ws.gates[gate] = state;
      const result = buildAssetHealthSummary({
        domain: "ANIMATION", reference: reference(true), workspace: ws,
      });
      expect(result.stages[gate], gate).toBe("REVIEW");
      expect(result.overall, gate).toBe("REVIEW");
      expect(result.blockers).toEqual([]);
    }
  });

  test("unknown Animation requirement stays visible, including in the actual Control Stage Context", () => {
    const ws = workspace();
    ws.gates.animation = "NOT_STARTED";
    const ref = reference(null);
    const unknown = buildControlStageContext({
      domain: "TEXTURING", workspace: ws, reference: ref,
    }).asset_health;
    expect(unknown.stages.animation).toBe("UNVERIFIED");
    expect(unknown.overall).toBe("INCOMPLETE");

    ws.gates.animation = "NOT_REQUIRED";
    const unconfirmed = buildAssetHealthSummary({
      domain: "TEXTURING", workspace: ws, reference: ref,
    });
    expect(unconfirmed.stages.animation).toBe("REVIEW");
    expect(unconfirmed.overall).toBe("REVIEW");

    ws.gates.animation = "APPROVED";
    const alreadyApproved = buildAssetHealthSummary({
      domain: "TEXTURING", workspace: ws, reference: ref,
    });
    expect(alreadyApproved.stages.animation).toBe("PASS");
    expect(alreadyApproved.overall).toBe("READY");
  });

  test("explicit animation requirement cannot be overridden by NOT_REQUIRED or validator PASS", () => {
    const ws = workspace();
    for (const value of ["NOT_REQUIRED", "PASS"]) {
      ws.gates.animation = value;
      const result = buildAssetHealthSummary({
        domain: "ANIMATION", workspace: ws, reference: reference(true),
      });
      expect(result.stages.animation).toBe("REVIEW");
      expect(result.overall).toBe("REVIEW");
    }
  });

  test("a reference-side technical PASS is not a valid READY assertion", () => {
    const ref = reference(true);
    ref.readiness.animation = "PASS";
    const result = buildAssetHealthSummary({
      domain: "ANIMATION", workspace: workspace(), reference: ref,
    });
    expect(result.stages.reference).toBe("REVIEW");
    expect(result.overall).toBe("REVIEW");
  });

  test("overall Reference review prevents whole-asset READY without blocking an unrelated Stage", () => {
    const ref = reference(false);
    ref.readiness.overall = "NEEDS_REVIEW";
    ref.readiness.geometry = "READY";
    ref.readiness.texture = "BLOCKED";
    const ws = workspace();
    ws.gates.animation = "NOT_STARTED";
    const stage = buildControlStageContext({
      domain: "GEOMETRY", reference: ref, workspace: ws,
    });
    expect(stage.stage_readiness).toBe("READY");
    expect(stage.asset_health.stages.reference).toBe("PASS");
    expect(stage.asset_health.overall).toBe("REVIEW");
    expect(stage.asset_health.blockers).toEqual([]);
  });

  test("overall Reference blocker persists in asset health but not the active Geometry gate", () => {
    const ref = reference(false);
    ref.readiness.overall = "BLOCKED";
    ref.readiness.geometry = "READY";
    ref.readiness.texture = "BLOCKED";
    const result = buildAssetHealthSummary({
      domain: "GEOMETRY", reference: ref, workspace: workspace(),
    });
    expect(result.stages.reference).toBe("PASS");
    expect(result.stages.geometry).toBe("PASS");
    expect(result.overall).toBe("BLOCKED");
    expect(result.blockers).toContain("REFERENCE_PACKAGE_OVERALL_BLOCKED");
    expect(result.blockers).not.toContain("REFERENCE_STAGE_BLOCKED");
  });

  test("missing overall Reference status is not evidence that the full asset is READY", () => {
    const ref = reference(false);
    ref.readiness.overall = null;
    const result = buildAssetHealthSummary({
      domain: "GEOMETRY", reference: ref, workspace: workspace(),
    });
    expect(result.stages.reference).toBe("PASS");
    expect(result.overall).toBe("INCOMPLETE");
  });

  test("in-progress stages remain review instead of becoming PASS", () => {
    const ws = workspace();
    ws.gates.texturing = "IN_PROGRESS";
    const result = buildAssetHealthSummary({
      domain: "TEXTURING",
      reference: reference(false),
      workspace: ws,
    });
    expect(result.stages.texturing).toBe("REVIEW");
    expect(result.overall).toBe("REVIEW");
  });

  test("reference blocker blocks health without inventing downstream failures", () => {
    const ref = reference(true);
    ref.readiness.animation = "BLOCKED";
    const result = buildAssetHealthSummary({
      domain: "ANIMATION",
      reference: ref,
      workspace: workspace(),
    });
    expect(result.overall).toBe("BLOCKED");
    expect(result.blockers).toContain("REFERENCE_STAGE_BLOCKED");
    expect(result.stages.geometry).toBe("PASS");
  });

  test("conflicting workspace declarations cannot create whole-asset READY through a first APPROVED value", () => {
    const text = [
      "# Chair", "Current Stage: ANIMATION",
      "Geometry: APPROVED", "Geometry: INVALIDATED",
      "UV Layout: PASS", "Texturing: APPROVED", "Animation: APPROVED",
      "Known blocker(s): none",
    ].join("\n");
    const actual = workspaceSemanticState(text);
    expect(actual.gates.geometry).toBe("APPROVED");
    expect(actual.workspace_issues).toContain("WORKSPACE_LIFECYCLE_FIELD_CONFLICT");

    const ws = { ...workspace(), ...actual };
    const stage = buildControlStageContext({
      domain: "ANIMATION", reference: reference(true), workspace: ws,
    });
    expect(stage.asset_health.stages.geometry).toBe("PASS");
    expect(stage.asset_health.overall).toBe("REVIEW");
    expect(stage.asset_health.blockers).toEqual([]);
    // The underlying readiness owner still provides the exact orientation
    // reason; an ambiguous README is not a fabricated technical failure.
  });

  test("an incomplete workspace blocker projection cannot advertise full readiness", () => {
    const ws = workspace();
    ws.blockers_omitted_count = 1;
    ws.blockers_omitted_sha256 = "a".repeat(64);
    const result = buildAssetHealthSummary({
      domain: "ANIMATION", reference: reference(true), workspace: ws,
    });
    expect(result.overall).toBe("REVIEW");
    expect(result.blockers).toEqual([]);
    ws.blockers = ["critical geometry attachment unresolved"];
    expect(buildAssetHealthSummary({
      domain: "ANIMATION", reference: reference(true), workspace: ws,
    }).overall).toBe("BLOCKED");
  });

  test("contradictory Animation Required cannot silently omit an unfinished stage", () => {
    const ws = workspace();
    ws.animation_required = true;
    ws.gates.animation = "NOT_STARTED";
    const ref = reference(false);
    const stage = buildControlStageContext({
      domain: "GEOMETRY", reference: ref, workspace: ws,
    });
    expect(stage.asset_health.stages.animation).toBe("UNVERIFIED");
    expect(stage.asset_health.overall).toBe("REVIEW");

    ws.animation_required = false;
    expect(buildAssetHealthSummary({
      domain: "GEOMETRY", reference: ref, workspace: ws,
    })).toMatchObject({
      overall: "READY", stages: { animation: "NOT_REQUIRED" },
    });
  });

  test("malformed Workspace requirement cannot inherit a false NOT_REQUIRED", () => {
    const ws = workspace();
    ws.workspace_issues = ["WORKSPACE_ANIMATION_REQUIREMENT_INVALID"];
    ws.gates.animation = "NOT_STARTED";
    const result = buildAssetHealthSummary({
      domain: "TEXTURING", reference: reference(false), workspace: ws,
    });
    expect(result.overall).toBe("REVIEW");
    expect(result.stages.animation).toBe("UNVERIFIED");
  });

  test("Finalization health requires a matching saved native revision even with APPROVED stages", () => {
    const ws = workspace();
    ws.current_stage = "FINALIZATION";
    const ref = reference(true);
    const result = () => buildAssetHealthSummary({
      domain: "ANIMATION", workspace: ws, reference: ref,
    });
    expect(result().overall).toBe("REVIEW");
    ws.finalization_native_revision = {
      state: "UNVERIFIED", reason: "FINALIZATION_ACCEPTED_CHECKPOINT_MISSING",
      accepted_sha256: null, observed_sha256: null,
    };
    expect(result().overall).toBe("REVIEW");
    ws.finalization_native_revision = {
      state: "STALE", reason: "FINALIZATION_NATIVE_CHECKPOINT_MISMATCH",
      accepted_sha256: "sha256:" + "a".repeat(64),
      observed_sha256: "sha256:" + "b".repeat(64),
    };
    expect(result().overall).toBe("BLOCKED");
    expect(result().blockers).toContain("FINALIZATION_NATIVE_CHECKPOINT_STALE");
    ws.finalization_native_revision = {
      ...ws.finalization_native_revision,
      state: "MATCHED", reason: "FINALIZATION_NATIVE_CHECKPOINT_MATCHED",
    };
    expect(result().overall).toBe("READY");
    ws.current_stage = "TEXTURING";
    ws.finalization_native_revision = undefined;
    expect(result().overall).toBe("READY");
  });

  test("missing workspace is incomplete rather than failed", () => {
    const ws = workspace();
    ws.available = false;
    const result = buildAssetHealthSummary({
      domain: "GEOMETRY",
      reference: reference(false),
      workspace: ws,
    });
    expect(result.overall).toBe("INCOMPLETE");
    expect(result.stages.geometry).toBe("UNVERIFIED");
  });
});
