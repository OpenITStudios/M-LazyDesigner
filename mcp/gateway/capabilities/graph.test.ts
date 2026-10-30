import { describe, expect, test } from "bun:test";
import {
  applyCapabilityGraphOutcome,
  evaluateCapabilityPreconditions,
  seedCapabilityFacts,
} from "./graph";
import { searchCapabilityCatalog } from "./catalog";
import type { BackendTool } from "../contracts/protocol";

const tool = (name: string, description = ""): BackendTool => ({
  name,
  description,
  annotations: {},
});

describe("capability dependency graph", () => {
  test("uses three-state prerequisites instead of false blocking unknown state", () => {
    const unknown = evaluateCapabilityPreconditions(
      "manage_uv_layout",
      { field: "operation", value: "apply" },
      seedCapabilityFacts({ projectBound: true })
    );

    expect(unknown.eligibility).toBe("UNKNOWN");
    expect(unknown.unknown).toContain("uv_plan_available");
    expect(unknown.missing).toEqual([]);
    expect(unknown.predecessor).toEqual({
      capability: "manage_uv_layout",
      branch: { field: "operation", value: "plan" },
    });
  });

  test("marks authoritative missing prerequisites as blocked", () => {
    const blocked = evaluateCapabilityPreconditions(
      "create_texture",
      { field: "type", value: "variant" },
      {
        project_bound: true,
        texture_available: false,
      }
    );

    expect(blocked.eligibility).toBe("BLOCKED");
    expect(blocked.missing).toEqual(["texture_available"]);
  });

  test("successful outcomes produce and invalidate only graph-owned ephemeral facts", () => {
    let facts = seedCapabilityFacts({ projectBound: true });
    facts = applyCapabilityGraphOutcome(
      facts,
      "manage_cubes",
      { operation: "create" },
      true,
      {
        execution: "applied",
        added: 1,
        cubes: [{ uuid: "cube-a", name: "body", from: [0, 0, 0], to: [2, 2, 2] }],
        visual_scope: null,
      }
    );
    expect(facts.geometry_available).toBe(true);
    expect(facts.uv_layout_current).toBe(false);

    facts = applyCapabilityGraphOutcome(
      facts,
      "manage_uv_layout",
      { operation: "plan" },
      true,
      {
        plan_id: "uvplan:" + "a".repeat(64),
        source_fingerprint: "sha256:" + "b".repeat(64),
        report: {
          schema: 1, execution: "planned",
          apply_allowed: true, hard_violations: [],
        },
      }
    );
    expect(facts.uv_plan_available).toBe(true);

    const ready = evaluateCapabilityPreconditions(
      "manage_uv_layout",
      { field: "operation", value: "apply" },
      facts
    );
    expect(ready.eligibility).toBe("READY");

    facts = applyCapabilityGraphOutcome(
      facts,
      "manage_uv_layout",
      { operation: "apply",
        plan_id: "uvplan:" + "a".repeat(64),
        expected_source_fingerprint: "sha256:" + "b".repeat(64) },
      true,
      {
        receipt: {
          schema: 1,
          source_fingerprint_before: "sha256:" + "b".repeat(64),
          source_fingerprint_after: "sha256:" + "c".repeat(64),
          changed_island_ids: ["cube-a:north"],
          changed_cube_ids: ["cube-a"],
          moved: [{ island_id: "cube-a:north" }],
        },
      }
    );
    expect(facts.uv_layout_current).toBe(true);
    expect(facts.texture_alignment_current).toBe(false);
    expect(facts.uv_plan_available).toBe(false);
    const repeatApply = evaluateCapabilityPreconditions(
      "manage_uv_layout",
      { field: "operation", value: "apply" },
      facts
    );
    expect(repeatApply.eligibility).toBe("BLOCKED");
    expect(repeatApply.missing).toContain("uv_plan_available");
    // Replanning restores graph readiness without changing accepted UV.
    facts = applyCapabilityGraphOutcome(
      facts, "manage_uv_layout", { operation: "plan" }, true,
      {
        plan_id: "uvplan:" + "d".repeat(64),
        source_fingerprint: "sha256:" + "c".repeat(64),
        report: {
          schema: 1, execution: "planned",
          apply_allowed: true, hard_violations: [],
        },
      }
    );
    expect(facts.uv_plan_available).toBe(true);
    expect(evaluateCapabilityPreconditions(
      "manage_uv_layout", { field: "operation", value: "apply" }, facts
    ).eligibility).toBe("READY");
  });

  test("UV apply requires an outcome receipt bound to the requested plan source", () => {
    const prior = {
      ...seedCapabilityFacts({ projectBound: true }),
      geometry_available: true,
      uv_plan_available: true,
      uv_layout_current: true,
    };
    const args = {
      operation: "apply",
      plan_id: "uvplan:" + "a".repeat(64),
      expected_source_fingerprint: "sha256:" + "b".repeat(64),
    };
    const valid = {
      receipt: {
        schema: 1,
        source_fingerprint_before: args.expected_source_fingerprint,
        source_fingerprint_after: "sha256:" + "c".repeat(64),
        changed_island_ids: ["cube-a:north"],
        changed_cube_ids: ["cube-a"],
        changed_faces: [{ cube_uuid: "cube-a", face: "north" }],
        moved: [{
          island_id: "cube-a:north",
          before: { x: 0, y: 0, width: 2, height: 2 },
          after: { x: 2, y: 0, width: 2, height: 2 },
          rotated_90: false,
        }],
      },
    };
    expect(applyCapabilityGraphOutcome(
      prior, "manage_uv_layout", args, true, valid
    ).uv_layout_current).toBe(true);

    for (const evidence of [
      undefined,
      { receipt: { changed_island_ids: ["cube-a:north"] } },
      { receipt: { ...valid.receipt, source_fingerprint_before: "sha256:" + "d".repeat(64) } },
      { receipt: { ...valid.receipt, changed_cube_ids: ["cube-b"] } },
      { receipt: { ...valid.receipt, changed_faces: [] } },
      { receipt: { ...valid.receipt, moved: [{
        ...valid.receipt.moved[0], island_id: "cube-b:south",
      }] } },
      { receipt: { ...valid.receipt, moved: [{
        ...valid.receipt.moved[0], after: valid.receipt.moved[0].before,
      }] } },
    ]) {
      const next = applyCapabilityGraphOutcome(
        prior, "manage_uv_layout", args, true, evidence
      );
      expect(next.uv_layout_current).toBe("unknown");
      expect(next.uv_plan_available).toBe(false);
      expect(next.texture_alignment_current).toBe(false);
    }
    expect(applyCapabilityGraphOutcome(
      prior, "manage_uv_layout", args, false, valid
    )).toEqual(prior);
  });

  test("UV planning only promotes an available, applicable source-bound plan", () => {
    const prior = {
      ...seedCapabilityFacts({ projectBound: true }),
      geometry_available: true,
    };
    const valid = {
      plan_id: "uvplan:" + "a".repeat(64),
      source_fingerprint: "sha256:" + "b".repeat(64),
      report: {
        schema: 1, execution: "planned", apply_allowed: true,
        hard_violations: [] as string[],
      },
    };
    expect(applyCapabilityGraphOutcome(
      prior, "manage_uv_layout", {operation:"plan"}, true, valid
    ).uv_plan_available).toBe(true);

    for (const result of [
      undefined,
      { ...valid, plan_id: "not-content-addressed" },
      { ...valid, source_fingerprint: "unbound" },
      { ...valid, report: {...valid.report, apply_allowed: false} },
      { ...valid, report: {...valid.report, hard_violations: ["overlap"]} },
    ]) {
      const unresolved = applyCapabilityGraphOutcome(
        prior, "manage_uv_layout", {operation:"plan"}, true, result
      );
      expect(unresolved.uv_plan_available).toBe("unknown");
      expect(applyCapabilityGraphOutcome(
        { ...prior, uv_plan_available: true },
        "manage_uv_layout", {operation:"plan"}, true, result
      ).uv_plan_available).toBe(true);
    }
    expect(applyCapabilityGraphOutcome(
      prior, "manage_uv_layout", {operation:"plan"}, false, valid
    )).toEqual(prior);
  });

  test("create_animation only promotes a native clip with a coherent codec receipt", () => {
    const original = {
      ...seedCapabilityFacts({ projectBound: true }),
      geometry_available: true,
    };
    const createdClip = {
      animation: { uuid: "clip-a", name: "animation.model.walk" },
      requested_name: "animation.model.walk",
      requested_bone_count: 1,
      requested_particle_effect_count: 0,
      requested_sound_effect_count: 0,
    };
    expect(applyCapabilityGraphOutcome(
      original, "create_animation", { name: "model.walk" }, true, createdClip
    ).animation_available).toBe(true);

    for (const candidate of [
      undefined,
      { animation: { name: "animation.model.walk" } },
      { ...createdClip, requested_bone_count: -1 },
      { ...createdClip, animation: {uuid:"",name:"animation.model.walk"} },
    ]) {
      expect(applyCapabilityGraphOutcome(
        original, "create_animation", { name: "model.walk" }, true, candidate
      ).animation_available).toBe("unknown");
      expect(applyCapabilityGraphOutcome(
        { ...original, animation_available: true },
        "create_animation", { name: "model.walk" }, true, candidate
      ).animation_available).toBe(true);
      expect(applyCapabilityGraphOutcome(
        { ...original, animation_available: false },
        "create_animation", { name: "model.walk" }, true, candidate
      ).animation_available).toBe("unknown");
    }
    expect(applyCapabilityGraphOutcome(
      original, "create_animation", { name: "model.walk" }, false, createdClip
    )).toEqual(original);
  });

  test("create_texture variant preserves readiness from the Runtime extension's actual result shape", () => {
    const prior = seedCapabilityFacts({ projectBound: true });
    const variant = {
      texture: {
        uuid: "variant-1", name: "body_alt.png",
        width: 64, height: 64, group: "variants",
        pbr_channel: "color",
      },
      variant_creation: {
        source_texture_uuid: "atlas-1",
        source_texture_name: "atlas.png",
        requested_name: "body_alt.png",
        target_group_uuid: "variants",
        target_group_name: "Variants",
        bitmap: { width: 64, height: 64 },
        resulting_role: "explicit_variant",
        preserves_base_role: true,
        mapping_contract: "same_bitmap_dimensions_and_existing_uv_mapping",
      },
    };
    const succeeded = applyCapabilityGraphOutcome(
      prior, "create_texture", { type: "variant" }, true, variant
    );
    expect(succeeded.texture_available).toBe(true);

    const wrongBranch = applyCapabilityGraphOutcome(
      prior, "create_texture", { type: "blank" }, true, variant
    );
    expect(wrongBranch.texture_available).toBe("unknown");

    const mismatchedDimensions = applyCapabilityGraphOutcome(
      prior, "create_texture", { type: "variant" }, true,
      { ...variant, texture: { ...variant.texture, height: 32 } }
    );
    expect(mismatchedDimensions.texture_available).toBe("unknown");
  });

  test("create_texture only promotes existence from its actual native inventory receipt", () => {
    const baseline = seedCapabilityFacts({ projectBound: true });
    const reported = {
      texture: {
        uuid: "texture-a",
        name: "base.png",
        bitmap: { width: 64, height: 64 },
      },
    };

    for (const type of ["blank", "template"] as const) {
      const created = applyCapabilityGraphOutcome(
        baseline, "create_texture", { type }, true, reported
      );
      expect(created.texture_available).toBe(true);
      expect(created.visual_evidence_current).toBe(false);

      for (const partial of [
        undefined,
        { success: true },
        { texture: { name: "base.png" } },
        { texture: { uuid: "texture-a", name: "base.png",
          bitmap: { width: 0, height: 64 } } },
      ]) {
        const unresolved = applyCapabilityGraphOutcome(
          baseline, "create_texture", { type }, true, partial
        );
        expect(unresolved.texture_available).toBe("unknown");
        expect(unresolved.visual_evidence_current).toBe(false);

        const priorAbsent = applyCapabilityGraphOutcome(
          { ...baseline, texture_available: false },
          "create_texture", { type }, true, partial
        );
        expect(priorAbsent.texture_available).toBe("unknown");

        const priorPresent = applyCapabilityGraphOutcome(
          { ...baseline, texture_available: true },
          "create_texture", { type }, true, partial
        );
        expect(priorPresent.texture_available).toBe(true);
      }
      expect(applyCapabilityGraphOutcome(
        baseline, "create_texture", { type }, false, reported
      )).toEqual(baseline);
    }
  });

  test("Cube creation never promotes missing or contradictory receipts to Geometry READY", () => {
    const previous = seedCapabilityFacts({ projectBound: true });
    const valid = {
      execution: "applied",
      added: 1,
      cubes: [{ uuid: "cube-a", name: "body", from: [0, 0, 0], to: [1, 1, 1] }],
      visual_scope: null, // Capture availability is not native existence proof.
    };
    const created = applyCapabilityGraphOutcome(
      previous, "manage_cubes", { operation: "create" }, true, valid
    );
    expect(created.geometry_available).toBe(true);
    expect(created.uv_layout_current).toBe(false);

    for (const result of [
      undefined,
      { execution: "applied", added: 1, cubes: [] },
      { execution: "applied", added: 2, cubes: valid.cubes },
      { execution: "applied", added: 2, cubes: [valid.cubes[0], valid.cubes[0]] },
    ]) {
      const unresolved = applyCapabilityGraphOutcome(
        previous, "manage_cubes", { operation: "create" }, true, result
      );
      expect(unresolved.geometry_available).toBe("unknown");
      expect(unresolved.uv_layout_current).toBe(false);
      const knownAbsent = applyCapabilityGraphOutcome(
        { ...previous, geometry_available: false },
        "manage_cubes", { operation: "create" }, true, result
      );
      expect(knownAbsent.geometry_available).toBe("unknown");
      const knownPresent = applyCapabilityGraphOutcome(
        { ...previous, geometry_available: true },
        "manage_cubes", { operation: "create" }, true, result
      );
      expect(knownPresent.geometry_available).toBe(true);
    }
    expect(applyCapabilityGraphOutcome(
      previous, "manage_cubes", { operation: "create" }, false, valid
    )).toEqual(previous);
  });

  test("Cube simplify dry runs preserve existing readiness facts", () => {
    const original = {
      ...seedCapabilityFacts({ projectBound: true }),
      geometry_available: true,
      uv_plan_available: true,
      uv_layout_current: true,
      texture_alignment_current: true,
      visual_evidence_current: true,
    };
    for (const execution of ["planned", "unchanged"] as const) {
      expect(applyCapabilityGraphOutcome(
        original, "manage_cubes", {operation:"simplify"}, true,
        {execution, updates: execution === "planned"
          ? [{id:"cube-a",from:[0,0,0]}] : []}
      )).toEqual(original);
    }
    expect(applyCapabilityGraphOutcome(
      original, "manage_cubes", {operation:"simplify"}, true,
      {execution:"unchanged", updates:[{id:"cube-a",from:[0,0,0]}]}
    ).uv_layout_current).toBe(false);
    expect(applyCapabilityGraphOutcome(
      original, "manage_cubes", {operation:"simplify"}, true,
      {execution:"applied",modified:1}
    ).uv_layout_current).toBe(false);
    expect(applyCapabilityGraphOutcome(
      original, "manage_cubes", {operation:"simplify"}, true,
      {execution:"unchanged",effects:[{geometry_effect:{changed_fields:["from"]}}]}
    ).uv_layout_current).toBe(false);
  });

  test("Cube effects preserve unrelated UV/Texture graph facts", () => {
    const original = {
      ...seedCapabilityFacts({ projectBound: true }),
      geometry_available: true,
      uv_plan_available: true,
      uv_layout_current: true,
      texture_alignment_current: true,
      visual_evidence_current: true,
    };
    const receipt = (fields: string[]) => ({
      geometry_effect: {
        changed_fields: fields,
        center_delta: [0, 0, 0], size_delta: [0, 0, 0],
        origin_delta: [0, 0, 0], rotation_delta: [0, 0, 0],
        inflate_delta: 0, uv_offset_delta: [0, 0],
        mirror_uv_changed: false, autouv_changed: false,
        visibility_changed: false, faces_changed: false,
      },
    });
    const position = applyCapabilityGraphOutcome(
      original, "manage_cubes", { operation: "update" }, true,
      receipt(["rotation"])
    );
    expect(position.geometry_available).toBe(true);
    expect(position.uv_plan_available).toBe(false);
    expect(position.uv_layout_current).toBe(true);
    expect(position.texture_alignment_current).toBe(true);
    expect(position.visual_evidence_current).toBe(false);

    const shape = applyCapabilityGraphOutcome(
      original, "manage_cubes", { operation: "update" }, true,
      receipt(["from", "to"])
    );
    expect(shape.uv_layout_current).toBe(false);
    expect(shape.texture_alignment_current).toBe(false);

    const uv = applyCapabilityGraphOutcome(
      original, "manage_cubes", { operation: "batch_update" }, true,
      receipt(["uv_offset"])
    );
    expect(uv.uv_layout_current).toBe(false);
    expect(uv.texture_alignment_current).toBe(false);

    for (const [operation, result] of [
      ["update", null], ["create", receipt(["rotation"])],
      ["simplify", receipt(["rotation"])],
    ] as const) {
      const conservative = applyCapabilityGraphOutcome(
        original, "manage_cubes", { operation }, true, result
      );
      expect(conservative.uv_layout_current).toBe(false);
      expect(conservative.texture_alignment_current).toBe(false);
    }
    expect(applyCapabilityGraphOutcome(
      original, "manage_cubes", { operation: "update" }, false,
      receipt(["from"])
    )).toEqual(original);
  });

  test("Undo and Redo invalidate inferred facts without declaring authored state missing", () => {
    const observed = {
      ...seedCapabilityFacts({ projectBound: true }),
      geometry_available: true,
      uv_plan_available: true,
      uv_layout_current: false,
      texture_available: true,
      animation_available: true,
      visual_evidence_current: true,
    };
    for (const capability of ["undo", "redo"]) {
      const after = applyCapabilityGraphOutcome(observed, capability, {}, true);
      expect(after).toEqual({ project_bound: true });
      expect(evaluateCapabilityPreconditions(
        "manage_uv_layout", { field: "operation", value: "apply" }, after
      ).eligibility).toBe("UNKNOWN");
      expect(applyCapabilityGraphOutcome(observed, capability, {}, false))
        .toEqual(observed);
    }
  });

  test("real Animation timeline branches share native readiness requirements", () => {
    const incomplete = {
      project_bound: true as const, animation_available: false as const,
    };
    for (const operation of [
      "keyframes", "graph", "timeline", "batch", "copy_paste", "properties",
    ]) {
      const blocked = evaluateCapabilityPreconditions(
        "manage_animation_timeline",
        { field: "operation", value: operation },
        incomplete
      );
      expect(blocked.eligibility, operation).toBe("BLOCKED");
      expect(blocked.missing, operation).toContain("animation_available");
    }
  });

  test("native Animation timeline mutations invalidate old visual proof but controls do not", () => {
    const prior = {
      ...seedCapabilityFacts({ projectBound: true }),
      animation_available: true,
      visual_evidence_current: true,
    };
    for (const args of [
      { operation: "keyframes", action: "create" },
      { operation: "graph", action: "smooth" },
      { operation: "batch", batch_operation: "offset" },
      { operation: "timeline", action: "set_length" },
      { operation: "copy_paste", action: "paste" },
      { operation: "properties", length: 2 },
    ]) {
      const updated = applyCapabilityGraphOutcome(
        prior, "manage_animation_timeline", args, true,
        { action: args.action ?? "properties" }
      );
      expect(updated.visual_evidence_current, args.operation).toBe(false);
      expect(updated.animation_available).toBe(true);
      expect(applyCapabilityGraphOutcome(
        prior, "manage_animation_timeline", args, false
      )).toEqual(prior);
    }

    for (const args of [
      { operation: "timeline", action: "play" },
      { operation: "timeline", action: "select_range" },
      { operation: "timeline", action: "expand_bones" },
      { operation: "copy_paste", action: "copy" },
      { operation: "keyframes", action: "select" },
    ]) {
      expect(applyCapabilityGraphOutcome(
        prior, "manage_animation_timeline", args, true,
        { action: args.action }
      )).toEqual(prior);
    }

    const loop = { operation: "timeline", action: "loop", loop_mode: "loop" };
    const unchanged = {
      action: "loop", changed: false,
      animation: { uuid: "clip-a", name: "walk" }, loop_mode: "loop",
    };
    expect(applyCapabilityGraphOutcome(
      prior, "manage_animation_timeline", loop, true, unchanged
    )).toEqual(prior);
    expect(applyCapabilityGraphOutcome(
      prior, "manage_animation_timeline",
      { ...loop, loop_mode: "once" }, true, unchanged
    ).visual_evidence_current).toBe(false);
    expect(applyCapabilityGraphOutcome(
      prior, "manage_animation_timeline", loop, true,
      { ...unchanged, action: "set_length" }
    ).visual_evidence_current).toBe(false);
  });

  test("animation timeline, effects and controllers invalidate previous visual evidence", () => {
    for (const capability of [
      "manage_animation_timeline",
      "manage_animation_effects",
      "manage_animation_controller",
    ]) {
      const prior = {
        ...seedCapabilityFacts({ projectBound: true }),
        animation_available: true,
        visual_evidence_current: true,
      };
      const args = capability === "manage_animation_timeline"
        ? { operation: "keyframes", action: "create" }
        : {};
      const next = applyCapabilityGraphOutcome(prior, capability, args, true);
      expect(next.animation_available).toBe(true);
      expect(next.visual_evidence_current).toBe(false);
      expect(prior.visual_evidence_current).toBe(true);
      expect(applyCapabilityGraphOutcome(prior, capability, args, false)).toEqual(prior);
      if (capability === "manage_animation_timeline") {
        // A branchless "successful mutation" is not a valid native timeline
        // invocation and cannot establish any authored visual effect.
        expect(applyCapabilityGraphOutcome(prior, capability, {}, true))
          .toEqual(prior);
      }
    }
  });

  test("blocked candidates are demoted but remain discoverable for recovery", () => {
    const tools = [
      tool("create_texture", "Create a texture."),
      tool("paint_with_brush", "Paint an existing texture with a brush."),
    ];
    const results = searchCapabilityCatalog(
      tools,
      "paint texture with brush",
      4,
      {
        authoringPhase: "texturing",
        facts: {
          project_bound: true,
          texture_available: false,
        },
      }
    );

    const brush = results.find(
      (result) => result.capability_id === "paint_with_brush"
    );
    expect(brush?.eligibility).toBe("BLOCKED");
    expect(brush?.requires).toEqual(["texture_available"]);
  });
});
