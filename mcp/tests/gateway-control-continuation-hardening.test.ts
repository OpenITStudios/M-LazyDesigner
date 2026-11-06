import { describe, expect, test } from "bun:test";
import { buildControlDelta, projectControlDeltaForGateway } from "@/gateway/control";
import { CAPABILITY_CORE_MANIFEST } from "@/lib/capabilities/manifest";
import { STATE_MUTATIONS } from "@/gateway/control/delta/policy";

function cubeEffect(changedFields: string[]) {
  return {
    changed_fields: changedFields,
    center_delta: [0, 0, 0],
    size_delta: [0, 0, 0],
    origin_delta: [0, 0, 0],
    rotation_delta: [0, 0, 0],
    inflate_delta: 0,
    uv_offset_delta: [0, 0],
    mirror_uv_changed: false,
    autouv_changed: false,
    visibility_changed: false,
    faces_changed: false,
  };
}

describe("LazyDesigner Control continuation hardening", () => {
  test("capability manifest and Control mutation policy cannot silently drift apart", () => {
    const manifestNames = new Set(CAPABILITY_CORE_MANIFEST.keys());

    for (const capability of STATE_MUTATIONS) {
      expect(manifestNames.has(capability), capability).toBe(true);
      const entry = CAPABILITY_CORE_MANIFEST.get(capability);
      expect(entry?.stage, capability).toBeDefined();
      expect(entry?.verificationClass, capability).not.toBeUndefined();
      expect(entry?.verificationClass, capability).not.toBe("not_applicable");
    }

    const nonAuthoredVerificationExceptions = new Set([
      "capture_model_views",
      "switch_authoring_phase",
      "save_material_config",
    ]);

    for (const [capability, entry] of CAPABILITY_CORE_MANIFEST) {
      if (
        entry.stage == null ||
        entry.verificationClass == null ||
        entry.verificationClass === "not_applicable" ||
        nonAuthoredVerificationExceptions.has(capability)
      ) {
        continue;
      }
      expect(STATE_MUTATIONS.has(capability), capability).toBe(true);
    }
  });

  test("authority transitions require complete shared receipts for receipt-only verification", () => {
    const badProject = buildControlDelta({
      capability: "create_project",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: null,
      succeeded: true,
      result: { project: { uuid: "project-a" } },
    });
    expect(badProject.verification_class).toBe("focused_read");

    const goodProject = buildControlDelta({
      capability: "create_project",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        project: {
          uuid: "project-a",
          name: "demo",
          save_path: null,
          export_path: null,
          export_codec: null,
          saved: false,
        },
        format: { id: "bedrock" },
        resolution: { texture_width: 128, texture_height: 128 },
      },
    });
    expect(goodProject.verification_class).toBe("receipt_only");

    const badPhase = buildControlDelta({
      capability: "switch_authoring_phase",
      phaseBefore: "geometry",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: { phase: "animation" },
    });
    expect(badPhase.verification_class).toBe("focused_read");

    const goodPhase = buildControlDelta({
      capability: "switch_authoring_phase",
      phaseBefore: "geometry",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        phase: "animation",
        runtime_surface: "ANIMATION",
        reason: "animate",
        resume_from: "geometry-ready",
        readiness_summary: null,
        surface_changed: true,
        reload_required: false,
        action: "continue through Gateway",
      },
    });
    expect(goodPhase.verification_class).toBe("receipt_only");
  });

  test("successful phase handoff records the real transition and requests one refresh", () => {
    const delta = buildControlDelta({
      capability: "switch_authoring_phase",
      phaseBefore: "texturing",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
    });
    expect(delta.phase_before).toBe("texturing");
    expect(delta.phase_after).toBe("animation");
    expect(delta.changed).toEqual(["authoring_phase"]);
    expect(delta.requires_status_refresh).toBe(true);
    expect(delta.next_intent).toBe("CONTINUE_NEW_AUTHORING_PHASE");
  });

  test("failed phase handoff is state-neutral and does not invent a refresh", () => {
    const delta = buildControlDelta({
      capability: "switch_authoring_phase",
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: false,
    });
    expect(delta.changed).toEqual([]);
    expect(delta.requires_status_refresh).toBe(false);
    expect(delta.next_intent).toBe("RECOVER_CURRENT_OPERATION");
  });

  test("actual visual mutations keep visual verification even with complete structural receipts", () => {
    const delta = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        visual_verdict: "not_evaluated",
        modified: 1,
        before: { uuid: "cube-a" },
        after: { uuid: "cube-a" },
        geometry_effect: cubeEffect(["rotation"]),
        visual_scope: {
          cube_uuids: ["cube-a"],
          framing: { min: [-1, 0, -1], max: [1, 2, 1] },
        },
      },
    });
    expect(delta.verification_class).toBe("visual");
    expect(delta.verification_scope).toEqual({
      kind: "CUBE_TARGETS",
      cube_uuids: ["cube-a"],
      framing: { min: [-1, 0, -1], max: [1, 2, 1] },
    });
  });

  test("Control never narrows visual review to Cube IDs contradicted by applied receipts", () => {
    const result = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        modified: 1,
        id: "cube-a",
        before: { uuid: "cube-a" },
        after: { uuid: "cube-a" },
        geometry_effect: cubeEffect(["from"]),
        visual_scope: {
          // Valid numerical framing cannot compensate for a target mismatch.
          cube_uuids: ["cube-b"],
          framing: { min: [-1, 0, -1], max: [1, 2, 1] },
        },
      },
    });
    expect(result.freshness).toMatchObject({ basis: "PRECISE_EFFECT" });
    expect(result.verification_class).toBe("visual");
    expect(result.verification_scope).toBeNull();
    expect(result.freshness.stale).toContain("GEOMETRY_STRUCTURE");
  });

  test("Cube pivot and rotation changes invalidate animation motion readiness", () => {
    for (const field of ["origin", "rotation"] as const) {
      const delta = buildControlDelta({
        capability: "manage_cubes",
        phaseBefore: "geometry",
        phaseAfter: "geometry",
        projectUuid: "project-a",
        succeeded: true,
        result: {
          execution: "applied",
          geometry_effect: cubeEffect([field]),
        },
      });
      expect(delta.freshness.stale, field).toEqual([
        "GEOMETRY_STRUCTURE",
        "ANIMATION_MOTION",
      ]);
    }

    const visibility = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        geometry_effect: cubeEffect(["visibility"]),
      },
    });
    expect(visibility.freshness.stale).toEqual([
      "GEOMETRY_STRUCTURE",
    ]);
  });

  test("visual animation verification scopes to affected bone and keyframe range", () => {
    const delta = buildControlDelta({
      capability: "manage_animation_timeline",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        action: "edit",
        animation: { uuid: "anim-a", name: "walk" },
        bone: { uuid: "bone-a", name: "arm" },
        channel: "rotation",
        affected_count: 2,
        affected_keyframes: [
          { uuid: "kf-a", time: 0.25, interpolation: "linear" },
          { uuid: "kf-b", time: 0.75, interpolation: "linear" },
        ],
      },
    });
    expect(delta.verification_class).toBe("visual");
    expect(delta.verification_scope).toEqual({
      kind: "ANIMATION_RANGE",
      animation_uuid: "anim-a",
      bone_uuid: "bone-a",
      channel: "rotation",
      time_range: [0.25, 0.75],
      review: {
        bone_ids: ["bone-a"],
        range: { start: 0.25, end: 0.75 },
        sample_times: [0.25, 0.5, 0.75],
      },
    });
  });

  test("direct keyframe mutations reuse bounded animation visual scope", () => {
    const delta = buildControlDelta({
      capability: "manage_keyframes",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        action: "edit",
        animation: { uuid: "anim-a", name: "walk" },
        bone: { uuid: "bone-a", name: "arm" },
        channel: "rotation",
        affected_count: 2,
        affected_keyframes: [
          { uuid: "kf-a", time: 0.2 },
          { uuid: "kf-b", time: 0.8 },
        ],
      },
    });

    expect(delta.verification_class).toBe("visual");
    expect(delta.verification_scope).toEqual({
      kind: "ANIMATION_RANGE",
      animation_uuid: "anim-a",
      bone_uuid: "bone-a",
      channel: "rotation",
      time_range: [0.2, 0.8],
      review: {
        bone_ids: ["bone-a"],
        range: { start: 0.2, end: 0.8 },
        sample_times: [0.2, 0.5, 0.8],
      },
    });
  });

  test("graph-editor mutations emit bounded animation verification evidence", () => {
    const delta = buildControlDelta({
      capability: "animation_graph_editor",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        action: "ease_in",
        animation: { uuid: "anim-a", name: "walk" },
        bone: { uuid: "bone-a", name: "arm" },
        channel: "rotation",
        axis: "x",
        affected_count: 3,
        affected_keyframes: [
          { uuid: "kf-a", time: 0.1, interpolation: "bezier" },
          { uuid: "kf-b", time: 0.4, interpolation: "bezier" },
          { uuid: "kf-c", time: 0.7, interpolation: "bezier" },
        ],
      },
    });

    expect(delta.verification_class).toBe("visual");
    expect(delta.verification_scope).toEqual({
      kind: "ANIMATION_RANGE",
      animation_uuid: "anim-a",
      bone_uuid: "bone-a",
      channel: "rotation",
      time_range: [0.1, 0.7],
      review: {
        bone_ids: ["bone-a"],
        range: { start: 0.1, end: 0.7 },
        sample_times: [0.1, 0.4, 0.7],
      },
    });
  });

  test("direct canonical mutation capabilities never preserve stale evidence as NO_CHANGE", () => {
    const cases = [
      ["apply_texture", "TEXTURE_APPEARANCE"],
      ["configure_material", "MATERIAL_RENDER"],
      ["assign_texture_channel", "MATERIAL_RENDER"],
      ["set_face_material_instance", "MATERIAL_RENDER"],
      ["bulk_set_material_instances", "MATERIAL_RENDER"],
      ["clear_material_instances", "MATERIAL_RENDER"],
      ["manage_keyframes", "ANIMATION_MOTION"],
      ["animation_graph_editor", "ANIMATION_MOTION"],
      ["animation_timeline", "ANIMATION_MOTION"],
      ["batch_keyframe_operations", "ANIMATION_MOTION"],
      ["animation_copy_paste", "ANIMATION_MOTION"],
    ] as const;

    for (const [capability, staleScope] of cases) {
      const delta = buildControlDelta({
        capability,
        phaseBefore: null,
        phaseAfter: null,
        projectUuid: "project-a",
        succeeded: true,
        result: { execution: "applied" },
      });

      expect(delta.freshness.basis, capability).not.toBe("NO_CHANGE");
      expect(delta.freshness.stale, capability).toContain(staleScope);
      expect(delta.invalidates.workspace_projection, capability).toBe(true);
      expect(delta.invalidates.acceptance_gates, capability).toBe(true);
      expect(delta.verification_class, capability).not.toBe("not_applicable");
    }
  });

  test("incomplete animation receipts never downgrade verification to receipt-only", () => {
    const controller = buildControlDelta({
      capability: "manage_animation_controller",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        action: "updated",
        operation_count: 1,
        controller: {
          uuid: "controller-a",
          name: "controller.animation.test",
          initial_state: null,
          state_count: 1,
        },
        affected_states: [],
        created: {},
        removed: {},
      },
    });
    expect(controller.verification_class).toBe("focused_read");

    const malformedCreatedIdentity = buildControlDelta({
      capability: "manage_animation_controller",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        operation_count: 1,
        controller: {
          uuid: "controller-a",
          name: "controller.animation.test",
          initial_state: null,
          state_count: 1,
        },
        affected_states: [],
        created: {
          states: [{ uuid: "", name: "broken" }],
          transitions: [],
          animation_links: [],
          sounds: [],
          particles: [],
        },
        removed: {
          states: [],
          transitions: [],
          animation_links: [],
          sounds: [],
          particles: [],
        },
      },
    });
    expect(malformedCreatedIdentity.verification_class).toBe("focused_read");

    const effects = buildControlDelta({
      capability: "manage_animation_effects",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        animation: { uuid: "anim-a", name: "walk" },
        operation_count: 2,
        results: [
          {
            channel: "sound",
            keyframe_uuid: "kf-a",
            time: 0.5,
            data_point_index: 0,
            effect: "step",
            locator: null,
          },
        ],
      },
    });
    expect(effects.verification_class).toBe("focused_read");
  });

  test("complete animation receipts retain receipt-only continuation", () => {
    const controller = buildControlDelta({
      capability: "manage_animation_controller",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        action: "updated",
        operation_count: 1,
        controller: {
          uuid: "controller-a",
          name: "controller.animation.test",
          initial_state: { uuid: "state-a", name: "idle" },
          state_count: 1,
        },
        affected_states: [
          {
            uuid: "state-a",
            name: "idle",
            on_entry: null,
            on_exit: null,
            blend_transition: 0,
            blend_transition_curve: null,
            blend_via_shortest_path: false,
            animations: [],
            transitions: [],
            sounds: [],
            particles: [],
          },
        ],
        created: {
          states: [],
          transitions: [],
          animation_links: [],
          sounds: [],
          particles: [],
        },
        removed: {
          states: [],
          transitions: [],
          animation_links: [],
          sounds: [],
          particles: [],
        },
      },
    });
    expect(controller.verification_class).toBe("receipt_only");

    const effects = buildControlDelta({
      capability: "manage_animation_effects",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        animation: { uuid: "anim-a", name: "walk" },
        operation_count: 1,
        results: [
          {
            channel: "particle",
            keyframe_uuid: "kf-a",
            time: 0.5,
            data_point_index: 0,
            effect: "minecraft:spark",
            locator: null,
            bind_to_actor: null,
            pre_effect_script: null,
          },
        ],
      },
    });
    expect(effects.verification_class).toBe("receipt_only");
  });

  test("UV, history, and project-boundary mutations invalidate the evidence they can make stale", () => {
    const uv = buildControlDelta({
      capability: "manage_uv_layout",
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: { execution: "applied" },
    });
    expect(uv.freshness.basis).toBe("PRECISE_EFFECT");
    expect(uv.freshness.stale).toEqual([
      "UV_MAPPING",
      "TEXTURE_APPEARANCE",
    ]);
    expect(uv.freshness.fresh).toContain("MATERIAL_RENDER");
    expect(uv.invalidates.authoring_domains).toEqual(["TEXTURING"]);
    expect(uv.invalidates.acceptance_gates).toBe(true);

    for (const capability of ["undo", "redo", "create_project"] as const) {
      const delta = buildControlDelta({
        capability,
        phaseBefore: "geometry",
        phaseAfter: "geometry",
        projectUuid: "project-a",
        succeeded: true,
        result: {},
      });
      expect(delta.freshness.basis, capability).toBe("CONSERVATIVE_EFFECT");
      expect(delta.freshness.stale, capability).toHaveLength(8);
      expect(delta.invalidates.authoring_domains, capability).toEqual([
        "GEOMETRY",
        "TEXTURING",
        "ANIMATION",
      ]);
      expect(delta.invalidates.workspace_projection, capability).toBe(true);
      expect(delta.invalidates.acceptance_gates, capability).toBe(true);
    }
  });

  test("Locator mutations invalidate attachment effects rather than animation motion", () => {
    const locator = buildControlDelta({
      capability: "manage_locator",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        action: "update",
        id: "locator-a",
        name: "muzzle",
        type: "locator",
        parent: { uuid: "bone-a", name: "arm" },
        changed_fields: ["position"],
        state: {
          uuid: "locator-a",
          name: "muzzle",
          type: "locator",
          parent: { uuid: "bone-a", name: "arm" },
          position: [1, 2, 3],
          rotation: [0, 0, 0],
          ignore_inherited_scale: false,
          visibility: true,
        },
      },
    });

    expect(locator.freshness.stale.sort()).toEqual([
      "ANIMATION_EFFECTS",
      "GEOMETRY_STRUCTURE",
    ]);
    expect(locator.freshness.stale).not.toContain("ANIMATION_MOTION");

    const nullObject = buildControlDelta({
      capability: "manage_null_object",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        action: "update",
        id: "null-a",
        name: "ik_controller",
        type: "null_object",
        parent: { uuid: "bone-a", name: "arm" },
        changed_fields: ["position"],
        state: {
          uuid: "null-a",
          name: "ik_controller",
          type: "null_object",
          parent: { uuid: "bone-a", name: "arm" },
          position: [1, 2, 3],
          ik_target: null,
          ik_source: null,
          ik_pole: null,
          lock_ik_target_rotation: false,
          visibility: true,
        },
      },
    });
    expect(nullObject.freshness.stale.sort()).toEqual([
      "ANIMATION_MOTION",
      "GEOMETRY_STRUCTURE",
    ]);
  });

  test("remove_element scopes by final removed target type when receipt proves it", () => {
    const locator = buildControlDelta({
      capability: "remove_element",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        removed_root: {
          uuid: "locator-a",
          name: "muzzle",
          type: "locator",
          parent: "bone-a",
        },
        removed_counts: { groups: 0, elements: 1, total_nodes: 1 },
        affected_animations: 0,
      },
    });
    expect(locator.freshness.stale.sort()).toEqual([
      "ANIMATION_EFFECTS",
      "GEOMETRY_STRUCTURE",
    ]);
    expect(locator.invalidates.authoring_domains.sort()).toEqual([
      "ANIMATION",
      "GEOMETRY",
    ]);

    const nullObject = buildControlDelta({
      capability: "remove_element",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        removed_root: {
          uuid: "null-a",
          name: "ik_controller",
          type: "null_object",
          parent: "bone-a",
        },
        removed_counts: { groups: 0, elements: 1, total_nodes: 1 },
        affected_animations: 0,
      },
    });
    expect(nullObject.freshness.stale.sort()).toEqual([
      "ANIMATION_MOTION",
      "GEOMETRY_STRUCTURE",
    ]);
    expect(nullObject.freshness.stale).not.toContain("UV_MAPPING");
    expect(nullObject.freshness.stale).not.toContain("TEXTURE_APPEARANCE");
  });

  test("rename_element scopes by renamed target type when receipt proves it", () => {
    const cube = buildControlDelta({
      capability: "rename_element",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        element: {
          uuid: "cube-a",
          name: "body_renamed",
          type: "cube",
          parent: "root",
        },
      },
    });
    expect(cube.freshness.stale).toEqual(["GEOMETRY_STRUCTURE"]);

    const locator = buildControlDelta({
      capability: "rename_element",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        element: {
          uuid: "locator-a",
          name: "muzzle_renamed",
          type: "locator",
          parent: "bone-a",
        },
      },
    });
    expect(locator.freshness.stale.sort()).toEqual([
      "ANIMATION_EFFECTS",
      "GEOMETRY_STRUCTURE",
    ]);

    const groups = buildControlDelta({
      capability: "rename_element",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        changes: [
          { id: "group-a", old_name: "arm", new_name: "arm_new" },
        ],
        affected_animations: 1,
      },
    });
    expect(groups.freshness.stale.sort()).toEqual([
      "ANIMATION_MOTION",
      "GEOMETRY_STRUCTURE",
    ]);
  });

  test("applied rename requires a complete shared receipt before receipt-only continuation", () => {
    const malformed = buildControlDelta({
      capability: "rename_element",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        element: {
          uuid: "",
          name: "broken",
          type: "cube",
          parent: "root",
        },
      },
    });
    expect(malformed.verification_class).toBe("focused_read");

    const complete = buildControlDelta({
      capability: "rename_element",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        element: {
          uuid: "cube-a",
          name: "body_new",
          type: "cube",
          parent: "root",
        },
      },
    });
    expect(complete.verification_class).toBe("receipt_only");

    const planned = buildControlDelta({
      capability: "rename_element",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "planned",
        changes: [{ id: "group-a", old_name: "arm", new_name: "arm_new" }],
        affected_animations: 1,
      },
    });
    expect(planned.freshness.basis).toBe("NO_CHANGE");
    expect(planned.verification_class).toBe("receipt_only");
  });

  test("semantic Undo/Redo narrows freshness and domain invalidation when history evidence is complete", () => {
    const materialUndo = buildControlDelta({
      capability: "undo",
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        semantic_effect: {
          stale: ["MATERIAL_RENDER"],
          workspace_projection: true,
          acceptance_gates: true,
        },
      },
    });
    expect(materialUndo.freshness).toMatchObject({
      basis: "PRECISE_EFFECT",
      stale: ["MATERIAL_RENDER"],
    });
    expect(materialUndo.invalidates.authoring_domains).toEqual(["TEXTURING"]);

    const geometryRedo = buildControlDelta({
      capability: "redo",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        semantic_effect: {
          stale: ["GEOMETRY_STRUCTURE", "ANIMATION_MOTION"],
          workspace_projection: true,
          acceptance_gates: true,
        },
      },
    });
    expect(geometryRedo.freshness.basis).toBe("PRECISE_EFFECT");
    expect(geometryRedo.invalidates.authoring_domains).toEqual([
      "GEOMETRY",
      "ANIMATION",
    ]);

    const unknownUndo = buildControlDelta({
      capability: "undo",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: { semantic_effect: null },
    });
    expect(unknownUndo.freshness.basis).toBe("CONSERVATIVE_EFFECT");
    expect(unknownUndo.invalidates.authoring_domains).toEqual([
      "GEOMETRY",
      "TEXTURING",
      "ANIMATION",
    ]);
  });

  test("known metadata-only Undo preserves authored freshness and acceptance gates", () => {
    const delta = buildControlDelta({
      capability: "undo",
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        semantic_effect: {
          stale: [],
          workspace_projection: true,
          acceptance_gates: false,
        },
      },
    });

    expect(delta.freshness.basis).toBe("NO_CHANGE");
    expect(delta.freshness.stale).toEqual([]);
    expect(delta.invalidates.authoring_domains).toEqual([]);
    expect(delta.invalidates.workspace_projection).toBe(true);
    expect(delta.invalidates.acceptance_gates).toBe(false);
    expect(delta.verification_class).toBe("receipt_only");
  });

  test("receipt-proven direct animation read/view actions preserve authored freshness", () => {
    const cases = [
      {
        capability: "manage_keyframes",
        result: {
          action: "select",
          animation: { uuid: "anim-a", name: "walk" },
          bone: { uuid: "bone-a", name: "arm" },
          channel: "rotation",
          affected_count: 1,
          affected_keyframes: [{ uuid: "kf-a", time: 0.5 }],
        },
      },
      {
        capability: "animation_copy_paste",
        result: {
          action: "copy",
          scope: "animation_clipboard_only",
          copied_keyframes: 3,
        },
      },
      {
        capability: "animation_timeline",
        result: {
          action: "set_time",
          scope: "timeline_view_only",
        },
      },
    ] as const;

    for (const { capability, result } of cases) {
      const delta = buildControlDelta({
        capability,
        phaseBefore: "animation",
        phaseAfter: "animation",
        projectUuid: "project-a",
        succeeded: true,
        result,
      });
      expect(delta.freshness.basis, capability).toBe("NO_CHANGE");
      expect(delta.invalidates.authoring_domains, capability).toEqual([]);
      expect(delta.invalidates.workspace_projection, capability).toBe(false);
      expect(delta.invalidates.acceptance_gates, capability).toBe(false);
      expect(delta.verification_class, capability).toBe("receipt_only");
    }
  });

  test("ordinary successful mutation continues without status reread", () => {
    const delta = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: null,
      phaseAfter: null,
      projectUuid: null,
      succeeded: true,
    });
    expect(delta.changed).toEqual([]);
    expect(delta.requires_status_refresh).toBe(false);
    expect(delta.next_intent).toBe("VERIFY_OR_CONTINUE_GEOMETRY");
  });

  test("Gateway continuation projection removes only static or derivable delta fields", () => {
    const full = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        geometry_effect: cubeEffect(["rotation"]),
      },
    });
    const projected = projectControlDeltaForGateway(full);

    expect(projected).toMatchObject({
      authoring_domain: "GEOMETRY",
      project_uuid: "project-a",
      freshness: {
        basis: "PRECISE_EFFECT",
        stale: ["GEOMETRY_STRUCTURE", "ANIMATION_MOTION"],
      },
      next_intent: "VERIFY_OR_CONTINUE_GEOMETRY",
      requires_status_refresh: false,
    });
    expect(projected).not.toHaveProperty("protocol");
    expect(projected).not.toHaveProperty("capability");
    expect(projected).not.toHaveProperty("source_owner");
    expect(projected).not.toHaveProperty("phase_before");
    expect(projected).not.toHaveProperty("phase_after");
    expect(projected.freshness).not.toHaveProperty("fresh");
    expect(projected.verification_class).toBe(full.verification_class);
    expect(projected.invalidates).toEqual(full.invalidates);
  });

  test("Gateway continuation projection keeps failure uncertainty fail-closed", () => {
    const full = buildControlDelta({
      capability: "manage_animation_timeline",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: false,
    });
    const projected = projectControlDeltaForGateway(full);

    expect(projected.freshness).toEqual({
      basis: "UNKNOWN_OUTCOME",
      unknown: full.freshness.unknown,
    });
    expect(projected.next_intent).toBe("RECOVER_CURRENT_OPERATION");
  });

  test("Gateway continuation projection preserves real phase transitions", () => {
    const full = buildControlDelta({
      capability: "switch_authoring_phase",
      phaseBefore: "texturing",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
    });
    const projected = projectControlDeltaForGateway(full);

    expect(projected.phase_before).toBe("texturing");
    expect(projected.phase_after).toBe("animation");
    expect(projected.changed).toEqual(["authoring_phase"]);
    expect(projected.requires_status_refresh).toBe(true);
  });

  test("gateway captures phase-before only when the canonical receipt owner requires it", async () => {
    const source = await Bun.file(
      "gateway/execution/capabilityExecutor.ts"
    ).text();
    expect(source).toContain("capabilityNeedsPhaseSnapshot(capability)");
    expect(source).toContain("deriveControlReceipt");
    expect(source).toContain("phaseBefore,");
    expect(source).toContain("phaseAfter,");
    expect(source).toContain("buildControlDelta");
    expect(source).toContain("projectControlDeltaForGateway");
  });
});
