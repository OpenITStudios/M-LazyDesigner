import { describe, expect, test } from "bun:test";
import {
  resolveGatewayCapabilityEffects,
  validateGatewayCapabilityEffectReceipt,
} from "./effects";
import { deriveControlReceipt } from "../control/receipt";

describe("resolveGatewayCapabilityEffects", () => {
  test("adopts created project through metadata", () => {
    const resolved = resolveGatewayCapabilityEffects(
      "create_project",
      {
        project: {
          uuid: "project-123",
          name: "Asset",
          save_path: null,
          export_path: null,
          export_codec: null,
          saved: false,
        },
        format: { id: "bedrock" },
        resolution: { texture_width: 128, texture_height: 128 },
      },
      "geometry"
    );

    expect(resolved.effects.projectAffinity).toBe("adopt_created_project");
    expect(resolved.effects.invalidateCatalog).toBe(true);
    expect(resolved.projectUuid).toBe("project-123");
    expect(resolved.authoringPhase).toBeNull();
  });

  test("updates authoring phase while surface change stays result-driven", () => {
    const resolved = resolveGatewayCapabilityEffects(
      "switch_authoring_phase",
      {
        phase: "animation",
        runtime_surface: "ANIMATION",
        reason: "handoff",
        resume_from: "geometry-ready",
        readiness_summary: null,
        surface_changed: true,
        reload_required: false,
        action: "continue",
      },
      "geometry"
    );

    expect(resolved.effects.phaseAffinity).toBe("update_from_result");
    expect(resolved.effects.invalidateCatalog).toBe(true);
    expect(resolved.authoringPhase).toBe("animation");
    expect(resolved.surfaceChanged).toBe(true);
  });

  test("same AUTHORING surface focus change does not report a surface change", () => {
    const resolved = resolveGatewayCapabilityEffects(
      "switch_authoring_phase",
      {
        phase: "texturing",
        runtime_surface: "AUTHORING",
        reason: "texture",
        resume_from: "geometry",
        readiness_summary: null,
        surface_changed: false,
        reload_required: false,
        action: "continue",
      },
      "geometry"
    );

    expect(resolved.effects.invalidateCatalog).toBe(true);
    expect(resolved.authoringPhase).toBe("texturing");
    expect(resolved.surfaceChanged).toBe(false);
  });

  test("ordinary capabilities preserve affinity", () => {
    const resolved = resolveGatewayCapabilityEffects(
      "manage_cubes",
      { changed: true },
      "geometry"
    );

    expect(resolved.effects.projectAffinity).toBe("preserve");
    expect(resolved.effects.phaseAffinity).toBe("preserve");
    expect(resolved.effects.invalidateCatalog).toBe(false);
    expect(resolved.projectUuid).toBeNull();
    expect(resolved.authoringPhase).toBeNull();
  });
  test("fails closed when project-affinity metadata requires a missing UUID", () => {
    const resolved = resolveGatewayCapabilityEffects(
      "create_project",
      { project: {} },
      null
    );

    expect(validateGatewayCapabilityEffectReceipt(resolved, true)).toEqual({
      code: "MISSING_PROJECT_UUID",
      message: expect.stringContaining("project UUID"),
    });
    expect(validateGatewayCapabilityEffectReceipt(resolved, false)).toBeNull();
  });

  test("fails closed when phase-affinity metadata requires a missing phase", () => {
    const resolved = resolveGatewayCapabilityEffects(
      "switch_authoring_phase",
      { surface_changed: true },
      "geometry"
    );

    expect(validateGatewayCapabilityEffectReceipt(resolved, true)).toEqual({
      code: "MISSING_AUTHORING_PHASE",
      message: expect.stringContaining("authoring-phase"),
    });
  });

  test("Backend-validated Project Authority is reused by Control without another receipt parse", () => {
    let reads = 0;
    const project = {
      get project() {
        reads++;
        return {
          uuid: "project-123",
          name: "asset",
          save_path: null,
          export_path: null,
          export_codec: null,
          saved: false,
        };
      },
      format: { id: "bedrock" },
      resolution: { texture_width: 32, texture_height: 32 },
    };
    const validated = resolveGatewayCapabilityEffects("create_project", project, null);
    const afterBackend = reads;
    expect(afterBackend).toBeGreaterThan(0);
    const reused = deriveControlReceipt(
      "create_project", project, true, null, validated
    );
    expect(reused.projectUuid).toBe("project-123");
    expect(reused.phaseAfter).toBeNull();
    expect(reads).toBe(afterBackend);
    expect(deriveControlReceipt("create_project", project, true, null))
      .toEqual(reused);
    expect(reads).toBeGreaterThan(afterBackend);
  });

  test("validated phase-transition metadata preserves original Control receipt contract", () => {
    const phase = {
      phase: "animation",
      runtime_surface: "ANIMATION",
      reason: "handoff",
      resume_from: "geometry-ready",
      readiness_summary: null,
      surface_changed: true,
      reload_required: false,
      action: "continue",
    };
    const validated = resolveGatewayCapabilityEffects(
      "switch_authoring_phase", phase, "geometry"
    );
    const expected = deriveControlReceipt(
      "switch_authoring_phase", phase, true, "geometry"
    );
    const shared = deriveControlReceipt(
      "switch_authoring_phase", phase, true, "geometry", validated
    );
    expect(shared).toEqual(expected);
    expect(shared.phaseBefore).toBe("geometry");
    expect(shared.phaseAfter).toBe("animation");
    expect(shared.projectUuid).toBeNull();
    expect(deriveControlReceipt(
      "switch_authoring_phase", phase, false, "geometry", validated
    )).toEqual({
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: null,
    });
  });

  test("malformed direct/local affinity receipts continue to fail closed", () => {
    for (const [capability, payload] of [
      ["create_project", { project: { name: "missing UUID" } }],
      ["switch_authoring_phase", { phase: "unknown" }],
    ] as const) {
      const application = resolveGatewayCapabilityEffects(capability, payload, null);
      expect(validateGatewayCapabilityEffectReceipt(application, true)).not.toBeNull();
      expect(deriveControlReceipt(capability, payload, true, null))
        .toEqual({
          phaseBefore: null,
          phaseAfter: null,
          projectUuid: null,
        });
    }
  });

  test("accepts complete affinity receipts", () => {
    const created = resolveGatewayCapabilityEffects(
      "create_project",
      { project: { uuid: "project-123", name: "fixture", save_path: null, export_path: null, export_codec: null, saved: false }, format: { id: "bedrock" }, resolution: { texture_width: 128, texture_height: 128 } },
      null
    );
    const switched = resolveGatewayCapabilityEffects(
      "switch_authoring_phase",
      { phase: "animation", surface_changed: true, runtime_surface: "ANIMATION", reason: "fixture", resume_from: "animation", readiness_summary: null, reload_required: false, action: "handoff" },
      "geometry"
    );

    expect(validateGatewayCapabilityEffectReceipt(created, true)).toBeNull();
    expect(validateGatewayCapabilityEffectReceipt(switched, true)).toBeNull();
  });
});
