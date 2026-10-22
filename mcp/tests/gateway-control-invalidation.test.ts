import { describe, expect, test } from "bun:test";
import { buildControlDelta } from "@/gateway/control";
import { authoringDomainForCapability } from "@/gateway/development/sourceOwners";
import {
  analyzeMutationEvidence,
  mutationFreshness,
  mutationInvalidation,
} from "@/gateway/control/delta/freshness";
import type { CapabilityBranchHint } from "@/gateway/capabilities/types";

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

describe("LazyDesigner Control minimum invalidation", () => {
  test("call-local receipt analysis matches direct invalidation and freshness for all branch outcomes", () => {
    const cases: Array<{
      capability: string;
      succeeded: boolean;
      result?: unknown;
      branch?: CapabilityBranchHint;
    }> = [
      {
        capability: "manage_cubes", succeeded: true,
        result: { geometry_effect: cubeEffect(["from", "to"]) },
      },
      {
        capability: "manage_cubes", succeeded: true,
        result: { execution: "planned", updates: [] },
        branch: { field: "operation", value: "simplify" },
      },
      {
        capability: "manage_cubes", succeeded: false,
        result: { execution: "applied" },
      },
      {
        capability: "modify_group", succeeded: true,
        result: {
          execution: "applied", id: "group-a", name: "arm",
          changed_fields: ["rotation"],
          group: {
            uuid: "group-a", name: "arm", origin: [0, 0, 0],
            rotation: [0, 10, 0], visibility: true, parent: "root",
          },
        },
      },
      {
        capability: "remove_element", succeeded: true,
        result: {
          removed_root: { uuid: "arm", name: "arm", type: "group", parent: "root" },
          removed_counts: { groups: 1, elements: 2, total_nodes: 3 },
          affected_animations: 1,
        },
      },
      {
        capability: "rename_element", succeeded: true,
        result: {
          execution: "unchanged", changes: [], affected_animations: 0,
        },
      },
      {
        capability: "rename_element", succeeded: true,
        result: { execution: "planned", changes: [{ id: "arm" }] },
      },
      {
        capability: "save_material_config", succeeded: true,
        result: {
          operation: "save", scope: "material_persistence_only",
          material: { uuid: "m1", name: "material" },
          saved: true, file_exists: true,
          file_path: "/tmp/asset.texture_set.json",
        },
      },
      {
        capability: "manage_particle", succeeded: true,
        result: { wrote_to_path: null, preview_path: null, artifact_ready: true },
      },
      {
        capability: "undo", succeeded: true,
        result: { semantic_effect: { stale: ["UV_MAPPING"], workspace_projection: true, acceptance_gates: true } },
      },
    ];
    for (const { capability, succeeded, result, branch } of cases) {
      const domain = authoringDomainForCapability(capability);
      const prepared = analyzeMutationEvidence(
        capability, domain, succeeded, result, branch
      );
      expect(
        mutationInvalidation(capability, domain, succeeded, result, branch, prepared),
        capability
      ).toEqual(
        mutationInvalidation(capability, domain, succeeded, result, branch)
      );
      expect(
        mutationFreshness(capability, domain, succeeded, result, branch, prepared),
        capability
      ).toEqual(
        mutationFreshness(capability, domain, succeeded, result, branch)
      );
      const actual = buildControlDelta({
        capability, branch, phaseBefore: null, phaseAfter: null,
        projectUuid: "project-a", succeeded, result,
      });
      expect(actual.invalidates, capability).toEqual(
        mutationInvalidation(capability, domain, succeeded, result, branch)
      );
      expect(actual.freshness, capability).toEqual(
        mutationFreshness(capability, domain, succeeded, result, branch)
      );
    }
  });

  test("material, layer and particle receipt decisions agree across both Control projections", () => {
    const persisted = {
      operation: "save", scope: "material_persistence_only",
      material: { uuid: "material-a", name: "metal" },
      file_path: "/tmp/metal.texture_set.json",
      saved: true, file_exists: true,
    };
    const cases: Array<{
      capability: string;
      result: unknown;
      succeeded: boolean;
      branch?: CapabilityBranchHint;
      expected: {
        mutates: boolean;
        materialPersistenceOnly?: boolean;
        textureLayerMetadataOnly?: boolean;
        particleTextureHandoff?: boolean;
      };
    }> = [
      {
        capability: "save_material_config", result: persisted, succeeded: true,
        expected: { mutates: false, materialPersistenceOnly: true },
      },
      {
        capability: "save_material_config",
        result: { ...persisted, file_exists: false }, succeeded: true,
        expected: { mutates: true, materialPersistenceOnly: false },
      },
      {
        capability: "manage_material", result: persisted, succeeded: true,
        branch: { field: "operation", value: "save" },
        expected: { mutates: false, materialPersistenceOnly: true },
      },
      {
        capability: "manage_material", result: persisted, succeeded: true,
        branch: { field: "operation", value: "configure" },
        expected: { mutates: true },
      },
      {
        capability: "texture_layer_management",
        result: { operation: "rename_layer" }, succeeded: true,
        expected: { mutates: false, textureLayerMetadataOnly: true },
      },
      {
        capability: "texture_layer_management",
        result: { operation: "batch_metadata", recomposed: false }, succeeded: true,
        expected: { mutates: false, textureLayerMetadataOnly: true },
      },
      {
        capability: "texture_layer_management",
        result: { operation: "batch_metadata", recomposed: true }, succeeded: true,
        expected: { mutates: true, textureLayerMetadataOnly: false },
      },
      {
        capability: "manage_particle",
        result: {
          texture_dependency: { status: "REQUIRES_TEXTURING" },
          wrote_to_path: null, preview_path: null,
        },
        succeeded: true,
        expected: { mutates: false, particleTextureHandoff: true },
      },
      {
        capability: "manage_particle",
        result: { wrote_to_path: null, preview_path: null },
        succeeded: true,
        expected: { mutates: false, particleTextureHandoff: false },
      },
      {
        capability: "manage_particle",
        result: { wrote_to_path: "/resource/particle.json", preview_path: null },
        succeeded: true,
        expected: { mutates: true, particleTextureHandoff: false },
      },
      {
        capability: "manage_particle",
        result: { texture_dependency: { status: "REQUIRES_TEXTURING" } },
        succeeded: false,
        expected: { mutates: false },
      },
    ];
    for (const { capability, result, succeeded, branch, expected } of cases) {
      const domain = authoringDomainForCapability(capability);
      const prepared = analyzeMutationEvidence(capability, domain, succeeded, result, branch);
      expect(prepared, capability).toMatchObject(expected);
      const invalidates = mutationInvalidation(
        capability, domain, succeeded, result, branch, prepared
      );
      const freshness = mutationFreshness(
        capability, domain, succeeded, result, branch, prepared
      );
      expect(invalidates, capability).toEqual(
        mutationInvalidation(capability, domain, succeeded, result, branch)
      );
      expect(freshness, capability).toEqual(
        mutationFreshness(capability, domain, succeeded, result, branch)
      );
      const delta = buildControlDelta({
        capability, branch, phaseBefore: null, phaseAfter: null,
        projectUuid: "project-a", succeeded, result,
      });
      expect(delta.invalidates, capability).toEqual(invalidates);
      expect(delta.freshness, capability).toEqual(freshness);
      if (expected.particleTextureHandoff) {
        expect(delta.next_intent).toBe("AUTHOR_PARTICLE_TEXTURE_THEN_RESUME");
      } else if (capability === "manage_particle" && succeeded) {
        expect(delta.next_intent).toBe("VERIFY_OR_CONTINUE_ANIMATION");
      }
    }
  });

  test("request-local receipt classifications do not persist across successive operations", () => {
    const domain = authoringDomainForCapability("manage_particle");
    const handoff = analyzeMutationEvidence(
      "manage_particle", domain, true,
      { texture_dependency: { status: "REQUIRES_TEXTURING" } }
    );
    const write = analyzeMutationEvidence(
      "manage_particle", domain, true,
      { wrote_to_path: "/resource/particle.json", preview_path: null }
    );
    expect(handoff.particleTextureHandoff).toBe(true);
    expect(handoff.mutates).toBe(false);
    expect(write.particleTextureHandoff).toBe(false);
    expect(write.mutates).toBe(true);
  });

  test("cached geometry scope stays call-local and never reuses a prior changed receipt", () => {
    const domain = authoringDomainForCapability("manage_cubes");
    const first = { geometry_effect: cubeEffect(["rotation"]) };
    const second = { geometry_effect: cubeEffect(["faces"]) };
    const rotation = analyzeMutationEvidence("manage_cubes", domain, true, first);
    const uv = analyzeMutationEvidence("manage_cubes", domain, true, second);
    expect(rotation.geometryScopes?.stale).toEqual([
      "GEOMETRY_STRUCTURE", "ANIMATION_MOTION",
    ]);
    expect(uv.geometryScopes?.stale).toContain("UV_MAPPING");
    expect(uv.geometryScopes?.stale).toContain("TEXTURE_APPEARANCE");
    expect(rotation.geometryScopes?.stale).not.toContain("TEXTURE_APPEARANCE");
  });

  test("local cube transform does not reset unrelated Texture or Animation", () => {
    const delta = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: null,
      phaseAfter: null,
      projectUuid: "project-a",
      succeeded: true,
      result: {
        geometry_effect: cubeEffect(["rotation", "origin"]),
      },
    });

    expect(delta.invalidates.authoring_domains).toEqual([
      "GEOMETRY",
      "ANIMATION",
    ]);
    expect(delta.freshness.basis).toBe("PRECISE_EFFECT");
    expect(delta.freshness.stale).toEqual([
      "GEOMETRY_STRUCTURE",
      "ANIMATION_MOTION",
    ]);
    expect(delta.freshness.fresh).toContain("TEXTURE_APPEARANCE");
    expect(delta.downstream_recheck.required.map((entry) => entry.action)).toEqual([
      "REVERIFY_ANIMATION_MOTION",
      "REVERIFY_GEOMETRY",
    ]);
    expect(delta.downstream_recheck.preserved_domains).toEqual(["TEXTURING"]);
  });

  test("shape or UV-sensitive cube changes invalidate dependent Texture and Animation knowledge", () => {
    const delta = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: null,
      phaseAfter: null,
      projectUuid: "project-a",
      succeeded: true,
      result: {
        effects: [
          {
            geometry_effect: cubeEffect(["from", "to"]),
          },
        ],
      },
    });

    expect(delta.invalidates.authoring_domains).toEqual([
      "GEOMETRY",
      "TEXTURING",
      "ANIMATION",
    ]);
    expect(delta.freshness.stale).toEqual([
      "GEOMETRY_STRUCTURE",
      "UV_MAPPING",
      "TEXTURE_APPEARANCE",
      "ANIMATION_MOTION",
    ]);
    expect(delta.freshness.fresh).toContain("MATERIAL_RENDER");
    expect(delta.freshness.fresh).toContain("ANIMATION_CONTROLLER");
    expect(delta.downstream_recheck.required.map((entry) => entry.action)).toEqual([
      "REVERIFY_ANIMATION_MOTION",
      "REVERIFY_GEOMETRY",
      "REVERIFY_MAPPED_TEXTURE",
      "REVERIFY_UV_LAYOUT",
    ]);
    expect(delta.downstream_recheck.preserved_domains).toEqual([]);
  });

  test("hierarchy changes invalidate Geometry and Animation but preserve Texture by default", () => {
    const delta = buildControlDelta({
      capability: "reparent_element",
      phaseBefore: null,
      phaseAfter: null,
      projectUuid: "project-a",
      succeeded: true,
    });

    expect(delta.invalidates.authoring_domains).toEqual([
      "GEOMETRY",
      "ANIMATION",
    ]);
    expect(delta.freshness.stale).toEqual([
      "GEOMETRY_STRUCTURE",
      "ANIMATION_MOTION",
    ]);
    expect(delta.freshness.fresh).toContain("UV_MAPPING");
    expect(delta.freshness.fresh).toContain("TEXTURE_APPEARANCE");
    expect(delta.downstream_recheck.required.map((entry) => entry.action)).toEqual([
      "REVERIFY_ANIMATION_MOTION",
      "REVERIFY_GEOMETRY",
    ]);
    expect(delta.downstream_recheck.preserved_domains).toEqual(["TEXTURING"]);
  });

  test("duplicated geometry invalidates Geometry plus dependent Texture and Animation evidence", () => {
    const delta = buildControlDelta({
      capability: "duplicate_element",
      phaseBefore: null,
      phaseAfter: null,
      projectUuid: "project-a",
      succeeded: true,
    });

    expect(delta.invalidates.authoring_domains).toEqual([
      "GEOMETRY",
      "TEXTURING",
      "ANIMATION",
    ]);
    expect(delta.invalidates.workspace_projection).toBe(true);
    expect(delta.invalidates.acceptance_gates).toBe(true);
  });

  test("direct material persistence requires typed save evidence before declaring NO_CHANGE", () => {
    const base = {
      capability: "save_material_config",
      phaseBefore: "texturing" as const,
      phaseAfter: "texturing" as const,
      projectUuid: "project-a",
      succeeded: true,
    };
    const save = {
      operation: "save",
      scope: "material_persistence_only",
      material: { uuid: "material-a", name: "metal" },
      file_path: "/tmp/material.texture_set.json",
      saved: true,
      file_exists: true,
    };
    const verified = buildControlDelta({ ...base, result: save });
    expect(verified.invalidates.authoring_domains).toEqual([]);
    expect(verified.invalidates.workspace_projection).toBe(true);
    expect(verified.invalidates.acceptance_gates).toBe(false);
    expect(verified.freshness.basis).toBe("NO_CHANGE");
    expect(verified.verification_class).toBe("receipt_only");

    for (const result of [
      undefined,
      { operation: "save", scope: "material_persistence_only" },
      { ...save, file_exists: false },
      { ...save, saved: false },
    ]) {
      const unverified = buildControlDelta({ ...base, result });
      expect(unverified.freshness.basis).toBe("CONSERVATIVE_EFFECT");
      expect(unverified.freshness.stale).toEqual([
        "TEXTURE_APPEARANCE", "MATERIAL_RENDER",
      ]);
      expect(unverified.invalidates.authoring_domains).toEqual(["TEXTURING"]);
      expect(unverified.invalidates.workspace_projection).toBe(true);
      expect(unverified.invalidates.acceptance_gates).toBe(true);
      expect(unverified.verification_class).toBe("focused_read");
    }
  });

  test("unverified material save cannot suppress Texture invalidation", () => {
    const malformed = buildControlDelta({
      capability: "manage_material",
      branch: { field: "operation", value: "save" },
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: { operation: "save", scope: "material_persistence_only" },
    });
    expect(malformed.invalidates.authoring_domains).toContain("TEXTURING");
    expect(malformed.freshness.basis).not.toBe("NO_CHANGE");
    expect(malformed.verification_class).not.toBe("receipt_only");

    const verified = buildControlDelta({
      capability: "manage_material",
      branch: { field: "operation", value: "save" },
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        operation: "save", scope: "material_persistence_only",
        material: {uuid:"material-a",name:"metal"},
        file_path:"/tmp/material.texture_set.json", saved:true, file_exists:true,
      },
    });
    expect(verified.invalidates.authoring_domains).toEqual([]);
    expect(verified.verification_class).toBe("receipt_only");
  });

  test("a complete material-save receipt cannot launder a different consolidated branch", () => {
    const result = {
      operation: "save",
      scope: "material_persistence_only",
      material: { uuid: "material-a", name: "metal" },
      file_path: "/tmp/material.texture_set.json",
      saved: true,
      file_exists: true,
    };
    for (const operation of ["create", "configure", "assign_channel"] as const) {
      const mismatched = buildControlDelta({
        capability: "manage_material",
        branch: { field: "operation", value: operation },
        phaseBefore: "texturing",
        phaseAfter: "texturing",
        projectUuid: "project-a",
        succeeded: true,
        result,
      });
      expect(mismatched.freshness.basis, operation).not.toBe("NO_CHANGE");
      expect(mismatched.invalidates.authoring_domains).toContain("TEXTURING");
      expect(mismatched.invalidates.acceptance_gates).toBe(true);
    }

    const missingBranch = buildControlDelta({
      capability: "manage_material",
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result,
    });
    expect(missingBranch.freshness.basis).not.toBe("NO_CHANGE");
    expect(missingBranch.invalidates.authoring_domains).toContain("TEXTURING");

    const realSave = buildControlDelta({
      capability: "manage_material",
      branch: { field: "operation", value: "save" },
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result,
    });
    expect(realSave.freshness.basis).toBe("NO_CHANGE");
    expect(realSave.invalidates.authoring_domains).toEqual([]);
    expect(realSave.verification_class).toBe("receipt_only");
  });

  test("paint/material changes invalidate only Texture knowledge", () => {
    for (const capability of ["paint_with_brush", "manage_material"] as const) {
      const delta = buildControlDelta({
        capability,
        phaseBefore: null,
        phaseAfter: null,
        projectUuid: "project-a",
        succeeded: true,
      });
      expect(delta.invalidates.authoring_domains, capability).toEqual(["TEXTURING"]);
      expect(delta.downstream_recheck.preserved_domains).toEqual([
        "GEOMETRY",
        "ANIMATION",
      ]);
    }
  });

  test("contradictory MCP envelope cannot suppress Geometry invalidation", () => {
    const delta = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "unchanged", // Non-authoritative envelope metadata.
        structuredContent: {
          execution: "applied",
          geometry_effect: cubeEffect(["from", "to"]),
        },
      },
    });
    expect(delta.freshness.basis).not.toBe("NO_CHANGE");
    expect(delta.invalidates.authoring_domains).toContain("GEOMETRY");
    expect(delta.invalidates.authoring_domains).toContain("TEXTURING");
  });

  test("malformed inner MCP receipt fails closed rather than trusting outer no-op", () => {
    const delta = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: { execution: "unchanged", structuredContent: null },
    });
    expect(delta.freshness.basis).not.toBe("NO_CHANGE");
    expect(delta.invalidates.authoring_domains).toContain("GEOMETRY");
  });

  test("a Cube no-op label with actual effect evidence must not keep downstream proof fresh", () => {
    for (const execution of ["planned", "unchanged"] as const) {
      const delta = buildControlDelta({
        capability: "manage_cubes",
        phaseBefore: "geometry",
        phaseAfter: "geometry",
        projectUuid: "project-a",
        succeeded: true,
        result: {
          execution,
          geometry_effect: cubeEffect(["from", "to"]),
        },
      });
      expect(delta.freshness.basis).not.toBe("NO_CHANGE");
      expect(delta.freshness.stale).toContain("UV_MAPPING");
      expect(delta.freshness.stale).toContain("ANIMATION_MOTION");
    }
  });

  test("incomplete Cube preview receipts cannot suppress invalidation", () => {
    const malformed = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: "geometry", phaseAfter: "geometry",
      projectUuid: "project-a", succeeded: true,
      result: { execution: "planned" }, // Native preview must report updates.
    });
    expect(malformed.freshness.basis).not.toBe("NO_CHANGE");
    expect(malformed.freshness.stale).toContain("UV_MAPPING");

    const contradictory = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: "geometry", phaseAfter: "geometry",
      projectUuid: "project-a", succeeded: true,
      result: { execution: "unchanged", updates: [{id:"cube-a"}] },
    });
    expect(contradictory.freshness.basis).not.toBe("NO_CHANGE");
  });

  test("Cube previews do not suppress create/update/batch_update invalidation", () => {
    for (const operation of ["create", "update", "batch_update"] as const) {
      for (const execution of ["planned", "unchanged"] as const) {
        const delta = buildControlDelta({
          capability: "manage_cubes",
          branch: { field: "operation", value: operation },
          phaseBefore: "geometry",
          phaseAfter: "geometry",
          projectUuid: "project-a",
          succeeded: true,
          result: { execution, updates: [] },
        });
        expect(delta.freshness.basis, operation).not.toBe("NO_CHANGE");
        expect(delta.freshness.stale).toContain("GEOMETRY_STRUCTURE");
        expect(delta.freshness.stale).toContain("UV_MAPPING");
        expect(delta.invalidates.authoring_domains).toContain("GEOMETRY");
        expect(delta.invalidates.authoring_domains).toContain("TEXTURING");
        expect(delta.invalidates.acceptance_gates).toBe(true);
      }
    }
    const noBranch = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: { execution: "unchanged", updates: [] },
    });
    expect(noBranch.freshness.basis).not.toBe("NO_CHANGE");
  });

  test("planned or unchanged cube simplify operations preserve state and skip visual verification", () => {
    for (const execution of ["planned", "unchanged"] as const) {
      const delta = buildControlDelta({
        capability: "manage_cubes",
        branch: { field: "operation", value: "simplify" },
        phaseBefore: "geometry",
        phaseAfter: "geometry",
        projectUuid: "project-a",
        succeeded: true,
        result: { execution, updates: [] },
      });
      expect(delta.invalidates.authoring_domains).toEqual([]);
      expect(delta.freshness.basis).toBe("NO_CHANGE");
      expect(delta.verification_class).toBe("receipt_only");
      expect(delta.downstream_recheck.required).toEqual([]);
      expect(delta.downstream_recheck.preserved_domains).toEqual([
        "TEXTURING",
        "ANIMATION",
      ]);
    }
  });

  test("a partial rename preview cannot certify a no-op", () => {
    const delta = buildControlDelta({
      capability: "rename_element",
      phaseBefore: "geometry", phaseAfter: "geometry",
      projectUuid: "project-a", succeeded: true,
      result: {
        execution: "planned",
        changes: [{ id: "group-a", old_name: "a", new_name: "b" }],
        // Required affected_animations is absent; do not trust execution label.
      },
    });
    expect(delta.freshness.basis).not.toBe("NO_CHANGE");
    expect(delta.invalidates.authoring_domains).toContain("ANIMATION");
  });

  test("planned or unchanged Group rename previews preserve state", () => {
    for (const execution of ["planned", "unchanged"] as const) {
      const delta = buildControlDelta({
        capability: "rename_element",
        phaseBefore: "geometry",
        phaseAfter: "geometry",
        projectUuid: "project-a",
        succeeded: true,
        result: {
          execution,
          changes: execution === "planned"
            ? [{ id: "group-a", old_name: "arm", new_name: "arm_new" }]
            : [],
          affected_animations: 0,
        },
      });

      expect(delta.invalidates.authoring_domains).toEqual([]);
      expect(delta.invalidates.workspace_projection).toBe(false);
      expect(delta.invalidates.acceptance_gates).toBe(false);
      expect(delta.freshness.basis).toBe("NO_CHANGE");
      expect(delta.verification_class).toBe("receipt_only");
    }
  });

  test("complete texture-group receipt avoids redundant focused read", () => {
    const delta = buildControlDelta({
      capability: "add_texture_group",
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        operation: "create_group",
        texture_group: {
          uuid: "group-a",
          name: "variant_group",
          is_material: false,
        },
        textures: [
          {
            uuid: "texture-a",
            id: "texture_0",
            name: "base.png",
            group: "group-a",
            pbr_channel: "color",
          },
        ],
      },
    });

    expect(delta.invalidates.authoring_domains).toEqual(["TEXTURING"]);
    expect(delta.freshness.basis).toBe("PRECISE_EFFECT");
    expect(delta.verification_class).toBe("receipt_only");
  });

  test("complete locator and hierarchy receipts avoid redundant focused reads", () => {
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
        name: "hand",
        type: "locator",
        parent: { uuid: "bone-a", name: "arm" },
        changed_fields: ["position"],
        state: {
          uuid: "locator-a",
          name: "hand",
          type: "locator",
          parent: { uuid: "bone-a", name: "arm" },
          position: [1,2,3],
          rotation: [0,0,0],
          ignore_inherited_scale: false,
          visibility: true,
        },
      },
    });
    expect(locator.verification_class).toBe("receipt_only");

    const addGroup = buildControlDelta({
      capability: "add_group",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        groups: [{
          uuid: "group-a",
          name: "arm",
          origin: [0,0,0],
          rotation: [0,0,0],
          visibility: true,
          parent: "root",
        }],
      },
    });
    expect(addGroup.verification_class).toBe("receipt_only");

    const modifyGroup = buildControlDelta({
      capability: "modify_group",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        id: "group-a",
        name: "arm",
        changed_fields: ["rotation"],
        group: {
          uuid: "group-a",
          name: "arm",
          origin: [0,0,0],
          rotation: [0,10,0],
          visibility: true,
          parent: "root",
        },
      },
    });
    expect(modifyGroup.verification_class).toBe("receipt_only");

    const reparent = buildControlDelta({
      capability: "reparent_element",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        id: "group-a",
        name: "arm",
        previous_parent: "root",
        parent: "group-b",
        transform_policy: "preserve_local",
      },
    });
    expect(reparent.verification_class).toBe("receipt_only");
  });

  test("complete element removal receipt avoids redundant focused reread", () => {
    const delta = buildControlDelta({
      capability: "remove_element",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        removed_root: {
          uuid: "group-a",
          name: "arm",
          type: "group",
          parent: "root",
        },
        removed_counts: {
          groups: 2,
          elements: 3,
          total_nodes: 5,
        },
        affected_animations: 1,
      },
    });

    expect(delta.verification_class).toBe("receipt_only");
    expect(delta.freshness.stale).toEqual([
      "GEOMETRY_STRUCTURE",
      "UV_MAPPING",
      "TEXTURE_APPEARANCE",
      "ANIMATION_MOTION",
    ]);
  });

  test("inconsistent element removal receipt stays focused-read", () => {
    const delta = buildControlDelta({
      capability: "remove_element",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        removed_root: {
          uuid: "group-a",
          name: "arm",
          type: "group",
          parent: "root",
        },
        removed_counts: {
          groups: 2,
          elements: 3,
          total_nodes: 4,
        },
        affected_animations: 1,
      },
    });

    expect(delta.verification_class).toBe("focused_read");
  });

  test("complete legacy bone rigging state receipt avoids redundant focused reread", () => {
    const delta = buildControlDelta({
      capability: "bone_rigging",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        action: "set_ik",
        bone: {
          uuid: "bone-a",
          name: "leg",
          parent: "root",
          origin: [0, 8, 0],
          rotation: [0, 0, 0],
          ik_enabled: true,
          ik_target: "target-a",
        },
      },
    });

    expect(delta.verification_class).toBe("receipt_only");
    expect(delta.freshness.stale).toEqual([
      "GEOMETRY_STRUCTURE",
      "ANIMATION_MOTION",
    ]);
  });

  test("complete bone-rigging deletion receipt avoids redundant focused reread", () => {
    const delta = buildControlDelta({
      capability: "bone_rigging",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        action: "delete",
        removed_root: {
          uuid: "bone-a",
          name: "leg",
          parent: "root",
        },
        removed_counts: {
          groups: 2,
          elements: 1,
          total_nodes: 3,
        },
        affected_animations: 1,
      },
    });

    expect(delta.verification_class).toBe("receipt_only");
  });

  test("incomplete bone rigging receipt retains focused-read verification", () => {
    const delta = buildControlDelta({
      capability: "bone_rigging",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        action: "set_ik",
        bone: {
          uuid: "bone-a",
          name: "leg",
        },
      },
    });

    expect(delta.verification_class).toBe("focused_read");
  });

  test("complete Blockbench 5.2 native IK receipt avoids redundant focused read", () => {
    const delta = buildControlDelta({
      capability: "bone_rigging",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        action: "set_ik_controller",
        controller: {
          uuid: "null-a",
          name: "leg_ik",
          ik_target: "foot",
          ik_source: "upper_leg",
          ik_pole: "knee_pole",
          lock_ik_target_rotation: false,
        },
      },
    });

    expect(delta.invalidates.authoring_domains).toEqual([
      "GEOMETRY",
      "ANIMATION",
    ]);
    expect(delta.freshness.stale).toEqual([
      "GEOMETRY_STRUCTURE",
      "ANIMATION_MOTION",
    ]);
    expect(delta.verification_class).toBe("receipt_only");
  });

  test("incomplete native IK receipt retains focused-read verification", () => {
    const delta = buildControlDelta({
      capability: "bone_rigging",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        action: "set_ik_controller",
        controller: {
          uuid: "null-a",
          name: "leg_ik",
        },
      },
    });

    expect(delta.verification_class).toBe("focused_read");
  });

  test("subtree translation receipt remains focused-read because descendants are summarized only", () => {
    const delta = buildControlDelta({
      capability: "modify_group",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        id: "group-a",
        offset: [1,0,0],
        origin: [1,0,0],
        groups: 3,
        elements: 8,
        coordinate_space: "authored_model",
      },
    });
    expect(delta.verification_class).toBe("focused_read");
  });

  test("animation changes invalidate only Animation knowledge", () => {
    const delta = buildControlDelta({
      capability: "manage_animation_timeline",
      phaseBefore: null,
      phaseAfter: null,
      projectUuid: "project-a",
      succeeded: true,
    });
    expect(delta.invalidates.authoring_domains).toEqual(["ANIMATION"]);
    expect(delta.freshness.stale).toEqual(["ANIMATION_MOTION"]);
    expect(delta.freshness.fresh).toContain("ANIMATION_CONTROLLER");
    expect(delta.freshness.fresh).toContain("ANIMATION_EFFECTS");
    expect(delta.freshness.fresh).toContain("PARTICLE_SYSTEM");
  });

  test("selection, playback, and clipboard-only animation operations preserve authored freshness", () => {
    for (const result of [
      { action: "select", animation: { uuid: "a", name: "A" } },
      { action: "play", animation: { uuid: "a", name: "A" } },
      { action: "set_time", timeline_time: 0.5 },
      { action: "expand_bones", scope: "timeline_view_only" },
      { action: "copy", scope: "animation_clipboard_only", copied_keyframes: 4 },
      { action: "loop", changed: false, loop_mode: "loop" },
    ]) {
      const delta = buildControlDelta({
        capability: "manage_animation_timeline",
        phaseBefore: "animation",
        phaseAfter: "animation",
        projectUuid: "project-a",
        succeeded: true,
        result,
      });

      expect(delta.invalidates.authoring_domains).toEqual([]);
      expect(delta.invalidates.workspace_projection).toBe(false);
      expect(delta.freshness.basis).toBe("NO_CHANGE");
      expect(delta.freshness.stale).toEqual([]);
      expect(delta.freshness.fresh).toHaveLength(8);
      expect(delta.verification_class).toBe("receipt_only");
    }
  });

  test("particle preparation without write or preview preserves authored freshness", () => {
    const delta = buildControlDelta({
      capability: "manage_particle",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        valid: true,
        artifact_ready: true,
        wrote_to_path: null,
        preview_path: null,
        texture_dependency: null,
      },
    });

    expect(delta.invalidates.authoring_domains).toEqual([]);
    expect(delta.invalidates.workspace_projection).toBe(false);
    expect(delta.freshness.basis).toBe("NO_CHANGE");
    expect(delta.freshness.fresh).toHaveLength(8);
    expect(delta.verification_class).toBe("receipt_only");
  });

  test("particle write remains a Particle-scoped authored mutation", () => {
    const delta = buildControlDelta({
      capability: "manage_particle",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        valid: true,
        artifact_ready: true,
        wrote_to_path: "/rp/example.particle.json",
        preview_path: null,
        texture_dependency: null,
      },
    });

    expect(delta.invalidates.authoring_domains).toEqual(["ANIMATION"]);
    expect(delta.freshness.stale).toEqual(["PARTICLE_SYSTEM"]);
    expect(delta.verification_class).toBe("focused_read");
  });

  test("complete imported material receipt avoids redundant focused read", () => {
    const delta = buildControlDelta({
      capability: "import_texture_set",
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        operation: "import_texture_set",
        source_path: "/rp/entity.texture_set.json",
        material: {
          uuid: "material-a",
          name: "entity",
          is_material: true,
          channels: {
            color: null,
            normal: null,
            height: null,
            mer: null,
          },
          config: {
            color_value: [1, 1, 1, 1],
            mer_value: [0, 0, 0],
            subsurface_value: 0,
            saved: true,
          },
        },
      },
    });

    expect(delta.invalidates.authoring_domains).toEqual(["TEXTURING"]);
    expect(delta.freshness.stale).toEqual(["TEXTURE_APPEARANCE", "MATERIAL_RENDER"]);
    expect(delta.verification_class).toBe("receipt_only");
  });

  test("verified particle write receipt avoids redundant focused reread", () => {
    const delta = buildControlDelta({
      capability: "manage_particle",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        valid: true,
        artifact_ready: true,
        source_path: null,
        wrote_to_path: "/rp/particles/mivubi_dust.particle.json",
        preview_path: null,
        preview_error: null,
        byte_length: 512,
        operation_count: 1,
        writes: [
          {
            kind: "particle",
            path: "/rp/particles/mivubi_dust.particle.json",
            byte_length: 512,
            replaced_existing: true,
          },
        ],
        summary: {
          identifier: "mivubi:dust",
          component_count: 4,
          diagnostics: [],
        },
      },
    });

    expect(delta.freshness.stale).toEqual(["PARTICLE_SYSTEM"]);
    expect(delta.verification_class).toBe("receipt_only");
  });

  test("incomplete particle write receipt remains focused-read", () => {
    const delta = buildControlDelta({
      capability: "manage_particle",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        valid: true,
        artifact_ready: true,
        wrote_to_path: "/rp/particles/mivubi_dust.particle.json",
        writes: [],
        summary: {
          identifier: "mivubi:dust",
          component_count: 4,
          diagnostics: [],
        },
      },
    });

    expect(delta.verification_class).toBe("focused_read");
  });

  test("complete animation-effects receipt is sufficient for continuation without reread", () => {
    const delta = buildControlDelta({
      capability: "manage_animation_effects",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        animation: { uuid: "anim-a", name: "idle" },
        operation_count: 2,
        results: [
          {
            channel: "particle",
            keyframe_uuid: "kf-a",
            time: 0.25,
            data_point_index: 0,
            effect: "mivubi:dust",
            locator: "hand",
            bind_to_actor: null,
            pre_effect_script: null,
          },
          {
            channel: "sound",
            removed: {
              keyframe_uuid: "kf-b",
              data_point_index: 0,
              remaining: [],
            },
          },
        ],
      },
    });

    expect(delta.freshness.stale).toEqual(["ANIMATION_EFFECTS"]);
    expect(delta.verification_class).toBe("receipt_only");
  });

  test("incomplete animation-effects receipt retains focused-read verification", () => {
    const delta = buildControlDelta({
      capability: "manage_animation_effects",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        animation: { uuid: "anim-a", name: "idle" },
        operation_count: 1,
        results: [{ channel: "particle" }],
      },
    });

    expect(delta.verification_class).toBe("focused_read");
  });

  test("complete animation-controller receipt replaces focused reread", () => {
    const delta = buildControlDelta({
      capability: "manage_animation_controller",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        action: "updated",
        operation_count: 2,
        controller: {
          uuid: "controller-a",
          name: "controller.animation.mob",
          initial_state: { uuid: "state-a", name: "default" },
          state_count: 2,
        },
        affected_states: [
          {
            uuid: "state-a",
            name: "default",
            on_entry: null,
            on_exit: null,
            blend_transition: 0,
            blend_transition_curve: null,
            blend_via_shortest_path: false,
            animations: [],
            transitions: [
              { uuid: "transition-a", target_uuid: "state-b", condition: "query.is_moving" },
            ],
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

    expect(delta.freshness.stale).toEqual(["ANIMATION_CONTROLLER"]);
    expect(delta.verification_class).toBe("receipt_only");
  });

  test("animation controller and particle mutations remain change-scoped", () => {
    const cases = [
      ["manage_particle", "PARTICLE_SYSTEM"],
    ] as const;

    for (const [capability, staleScope] of cases) {
      const delta = buildControlDelta({
        capability,
        phaseBefore: "animation",
        phaseAfter: "animation",
        projectUuid: "project-a",
        succeeded: true,
      });
      expect(delta.invalidates.authoring_domains, capability).toEqual(["ANIMATION"]);
      expect(delta.freshness.basis, capability).toBe("PRECISE_EFFECT");
      expect(delta.freshness.stale, capability).toEqual([staleScope]);
      expect(delta.freshness.fresh, capability).not.toContain(staleScope);
    }
  });

  test("failed mutation does not make freshness claims", () => {
    const delta = buildControlDelta({
      capability: "manage_animation_timeline",
      phaseBefore: "animation",
      phaseAfter: "animation",
      projectUuid: "project-a",
      succeeded: false,
    });

    expect(delta.freshness.basis).toBe("UNKNOWN_OUTCOME");
    expect(delta.freshness.stale).toEqual([]);
    expect(delta.freshness.fresh).toEqual([]);
    expect(delta.freshness.unknown).toHaveLength(8);
  });

  test("unknown Geometry mutation receipt fails safe instead of pretending precision", () => {
    const delta = buildControlDelta({
      capability: "manage_cubes",
      phaseBefore: null,
      phaseAfter: null,
      projectUuid: "project-a",
      succeeded: true,
    });
    expect(delta.invalidates.authoring_domains).toEqual([
      "GEOMETRY",
      "TEXTURING",
      "ANIMATION",
    ]);
    expect(delta.freshness.basis).toBe("CONSERVATIVE_EFFECT");
    expect(delta.freshness.stale).toEqual([
      "GEOMETRY_STRUCTURE",
      "UV_MAPPING",
      "TEXTURE_APPEARANCE",
      "ANIMATION_MOTION",
    ]);
  });
});
