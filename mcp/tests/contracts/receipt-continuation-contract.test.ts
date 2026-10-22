import { describe, expect, test } from "bun:test";
import { CAPABILITY_CORE_MANIFEST } from "@/lib/capabilities/manifest";
import {
  CONTINUATION_RECEIPT_CAPABILITIES,
  receiptSupportsContinuation,
  resultCandidates,
  cubeStateNeutral,
  boneRiggingDeletionReceiptComplete,
  boneRiggingStateReceiptComplete,
  nativeIkControllerReceiptComplete,
  particleTextureHandoffRequired,
  animationTimelineStateNeutral,
  directAnimationStateNeutral,
  materialPersistenceReceiptComplete,
  createProjectReceiptComplete,
  phaseTransitionReceiptComplete,
} from "@/gateway/control/delta/receipts";

describe("continuation receipt registry", () => {
  test("MCP wrapper has one authoritative structuredContent candidate", () => {
    const contradictory = {
      execution: "unchanged",
      structuredContent: { execution: "applied", name: "new-model" },
    };
    expect(resultCandidates(contradictory)).toEqual([
      { execution: "applied", name: "new-model" },
    ]);
    expect(cubeStateNeutral(contradictory)).toBe(false);
    expect(resultCandidates({
      execution: "applied",
      structuredContent: { execution: "unchanged" },
    })).toEqual([{ execution: "unchanged" }]);
    expect(cubeStateNeutral({
      execution: "applied", structuredContent: { execution: "unchanged", updates: [] },
    })).toBe(true);
    expect(resultCandidates({ execution: "unchanged", structuredContent: null }))
      .toEqual([]);
    expect(cubeStateNeutral({ execution: "unchanged", structuredContent: null }))
      .toBe(false);
    expect(resultCandidates({ execution: "unchanged" }))
      .toEqual([{ execution: "unchanged" }]);
  });

  test("direct scalar receipt selection matches the historical zero-or-one candidate contract", () => {
    const authoritative = { execution: "applied", uuid: "real-a" };
    const envelope = {
      execution: "unchanged",
      structuredContent: authoritative,
    };
    expect(resultCandidates(authoritative)).toEqual([authoritative]);
    expect(resultCandidates(authoritative)[0]).toBe(authoritative);
    expect(resultCandidates(envelope)).toEqual([authoritative]);
    expect(resultCandidates(envelope)[0]).toBe(authoritative);
    for (const value of [
      null, [], "text", { structuredContent: null },
      { structuredContent: [] }, { structuredContent: "not-object" },
    ]) {
      expect(resultCandidates(value)).toEqual([]);
    }
  });

  test("each receipt validator reads its canonical MCP envelope once", () => {
    const cases: Array<[string, (value: unknown) => boolean, object]> = [
      ["cube-neutral", cubeStateNeutral, { execution: "unchanged", updates: [] }],
      ["particle-handoff", particleTextureHandoffRequired,
        { texture_dependency: { status: "REQUIRES_TEXTURING" } }],
      ["timeline-view", animationTimelineStateNeutral,
        { action: "set_time", scope: "timeline_view_only" }],
      ["keyframe-select", value => directAnimationStateNeutral("manage_keyframes", value),
        { action: "select" }],
      ["material-persistence", materialPersistenceReceiptComplete, {
        operation: "save", scope: "material_persistence_only",
        material: { uuid: "m-a", name: "steel" },
        file_path: "/tmp/steel.texture_set.json", saved: true, file_exists: true,
      }],
      ["create-project", createProjectReceiptComplete, {
        project: {
          uuid: "p-1", name: "test", save_path: null,
          export_path: null, export_codec: null, saved: false,
        },
        format: { id: "bedrock" },
        resolution: { texture_width: 16, texture_height: 16 },
      }],
      ["phase-transition", phaseTransitionReceiptComplete, {
        phase: "animation", runtime_surface: "ANIMATION", reason: "handoff",
        resume_from: "geometry", readiness_summary: null,
        surface_changed: true, reload_required: false, action: "continue",
      }],
      ["bone-rigging", value => receiptSupportsContinuation("bone_rigging", value), {
        action: "set_ik_controller",
        controller: {
          uuid: "controller-a", name: "leg_ik", ik_target: "foot",
          ik_source: "leg", ik_pole: "knee",
          lock_ik_target_rotation: false,
        },
      }],
    ];
    for (const [name, validate, authoritative] of cases) {
      let reads = 0;
      const envelope = {
        // Contradictory display metadata must not count as authoritative.
        execution: "unchanged",
        get structuredContent() {
          reads++;
          return authoritative;
        },
      };
      expect(validate(envelope), name).toBe(validate(authoritative));
      expect(validate(authoritative), name).toBe(true);
      expect(reads, name).toBe(1);
    }
  });

  test("malformed inner receipts fail closed without using apparently valid outer fields", () => {
    const project = {
      project: { uuid: "p-1", name: "test", save_path: null,
        export_path: null, export_codec: null, saved: false },
      format: { id: "bedrock" },
      resolution: { texture_width: 16, texture_height: 16 },
    };
    expect(createProjectReceiptComplete(project)).toBe(true);
    expect(createProjectReceiptComplete({
      ...project, structuredContent: null,
    })).toBe(false);
    expect(createProjectReceiptComplete({
      ...project, structuredContent: { project: { uuid: "p-1" } },
    })).toBe(false);
    expect(receiptSupportsContinuation("future_unknown_tool", {
      structuredContent: project,
    })).toBe(false);
  });

  test("registry capabilities are canonical and verification-relevant", () => {
    expect(CONTINUATION_RECEIPT_CAPABILITIES.length).toBeGreaterThan(0);

    for (const capability of CONTINUATION_RECEIPT_CAPABILITIES) {
      const entry = CAPABILITY_CORE_MANIFEST.get(capability);
      expect(entry, capability).toBeDefined();
      expect(entry?.stage, capability).toBeDefined();
      expect(entry?.verificationClass, capability).not.toBe("not_applicable");
    }
  });

  test("Bone Rigging one-candidate validator matches independent native/state/delete guards", () => {
    const cases: unknown[] = [
      {
        action: "set_ik", bone: {
          uuid: "bone-a", name: "leg", parent: "root",
          origin: [0, 8, 0], rotation: [0, 0, 0],
          ik_enabled: true, ik_target: "target-a",
        },
      },
      {
        action: "delete",
        removed_root: { uuid: "bone-a", name: "leg", parent: "root" },
        removed_counts: { groups: 2, elements: 1, total_nodes: 3 },
        affected_animations: 1,
      },
      {
        action: "set_ik_controller", controller: {
          uuid: "null-a", name: "leg_ik", ik_target: "foot",
          ik_source: "upper_leg", ik_pole: "knee",
          lock_ik_target_rotation: false,
        },
      },
      { action: "set_ik", bone: { uuid: "bone-a", name: "leg" } },
      { action: "delete", removed_counts: { groups: 2, elements: 1, total_nodes: 99 } },
      { action: "set_ik_controller", controller: { uuid: "null-a", name: "leg_ik" } },
      null,
      { structuredContent: null, action: "set_ik_controller" },
    ];
    for (const value of cases) {
      const previous =
        nativeIkControllerReceiptComplete(value) ||
        boneRiggingStateReceiptComplete(value) ||
        boneRiggingDeletionReceiptComplete(value);
      expect(receiptSupportsContinuation("bone_rigging", value)).toBe(previous);
    }
    for (const valid of cases.slice(0, 3)) {
      expect(receiptSupportsContinuation("bone_rigging", {
        structuredContent: valid, action: "delete",
        removed_counts: { groups: 1, elements: 999 },
      })).toBe(true);
    }
    expect(receiptSupportsContinuation("bone_rigging", {
      structuredContent: null, ...(cases[0] as Record<string, unknown>),
    })).toBe(false);
  });

  test("unknown capabilities fail closed instead of inheriting a receipt validator", () => {
    expect(
      receiptSupportsContinuation("future_unknown_tool", {
        execution: "applied",
      })
    ).toBe(false);
  });

  test("representative shared contracts are discoverable through one registry", () => {
    expect(CONTINUATION_RECEIPT_CAPABILITIES).toEqual(
      expect.arrayContaining([
        "create_project",
        "manage_material",
        "manage_animation_controller",
        "manage_particle",
        "manage_render_profile",
        "remove_element",
        "bone_rigging",
      ])
    );
  });

  test("registry declaration replaces capability switch routing", async () => {
    const source = await Bun.file("gateway/control/delta/receipts.ts").text();
    const receiptSection = source.slice(
      source.indexOf("const CONTINUATION_RECEIPT_VALIDATORS")
    );

    expect(receiptSection).not.toContain("switch (capability)");
    expect(receiptSection).toContain(
      "CONTINUATION_RECEIPT_VALIDATORS[capability]"
    );
  });
});