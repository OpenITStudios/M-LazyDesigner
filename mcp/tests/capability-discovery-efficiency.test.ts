import { describe, expect, test } from "bun:test";
import {
  CAPABILITY_LIFECYCLE_SEARCH_PENALTY,
  getCapabilityMetadata,
} from "../lib/capabilityMetadata";
import { getMcpSurfaceToolNames } from "../server/tools";
import { getAllToolDefinitions } from "../lib/factories";
import { searchCapabilityCatalog, type BackendTool } from "../gateway/contract";
import {
  classifyMcpToolPhase,
  isMcpToolExposedForPhase,
} from "../lib/authoringPhase";

describe("capability discovery efficiency", () => {
  test("capability metadata separates lifecycle, execution cost, and verification semantics", () => {
    expect(getCapabilityMetadata("create_project")).toMatchObject({
      lifecycle: { stage: "active", replacement: null },
      executionClass: "normal",
      verificationClass: "focused_read",
    });
    expect(getCapabilityMetadata("get_project_info")).toMatchObject({
      lifecycle: { stage: "active", replacement: null },
      executionClass: "fast",
      verificationClass: "not_applicable",
    });
    expect(getCapabilityMetadata("capture_model_views")).toMatchObject({
      executionClass: "heavy",
      verificationClass: "visual",
    });
    expect(getCapabilityMetadata("modify_group").verificationClass).toBe(
      "focused_read"
    );
    expect(getCapabilityMetadata("duplicate_element").verificationClass).toBe("visual");
    expect(getCapabilityMetadata("bone_rigging").verificationClass).toBe("focused_read");
    expect(getCapabilityMetadata("add_texture_group").verificationClass).toBe("focused_read");
    expect(getCapabilityMetadata("import_texture_set").verificationClass).toBe("focused_read");
    for (const capability of ["gradient_tool", "copy_brush_tool", "texture_layer_management"]) {
      expect(getCapabilityMetadata(capability).verificationClass, capability).toBe("visual");
    }
    expect(CAPABILITY_LIFECYCLE_SEARCH_PENALTY.deprecated).toBeLessThan(
      CAPABILITY_LIFECYCLE_SEARCH_PENALTY.active
    );
  });

  test("Gateway discovery handles representative Indonesian authoring language", () => {
    const tools = getAllToolDefinitions();
    const catalog = [...new Set(
      (["geometry", "animation"] as const).flatMap((phase) =>
        getMcpSurfaceToolNames("bedrock_entity", phase)
      )
    )].map(
      (name) => ({
        name,
        description: tools[name].description,
        annotations: tools[name].annotations,
      })
    ) as BackendTool[];

    const cases = [
      ["buat kubus baru untuk badan model", "manage_cubes"],
      ["ubah ukuran kubus yang ini", "manage_cubes"],
      ["ubah pivot tulang pintu", "modify_group"],
      ["geser posisi bone ini", "modify_group"],
      ["buat titik pegangan di tangan", "manage_locator"],
      ["edit pixel ini secara presisi", "paint_texture_transaction"],
      ["tambah keyframe rotasi tangan", "manage_animation_timeline"],
      ["atur timeline animasi jadi loop", "manage_animation_timeline"],
      ["buat controller animasi dengan beberapa state", "manage_animation_controller"],
      ["tambahkan particle ke animasi", "manage_animation_effects"],
      ["buat particle asap", "manage_particle"],
      ["ubah particle emitter ini", "manage_particle"],
    ] as const;

    for (const [query, expected] of cases) {
      const results = searchCapabilityCatalog(catalog, query, 3);
      expect(
        results.map((result) => result.capability_id),
        query
      ).toContain(expected);
    }
  });

  test("prewired metadata cannot advertise unregistered native capabilities", () => {
    const definitions = getAllToolDefinitions();
    const stages = ["geometry", "texturing", "animation"] as const;
    const exposed = new Set(stages.flatMap((stage) =>
      getMcpSurfaceToolNames("bedrock_entity", stage)
    ));

    // Manifest entries and planning code alone never publish a Runtime tool.
    // These are intentionally unregistered until generator/native acceptance.
    for (const planned of ["construct_geometry", "manage_uv_layout"]) {
      expect(exposed.has(planned), planned).toBe(false);
      expect(Object.hasOwn(definitions, planned), planned).toBe(false);
    }
    expect(getCapabilityMetadata("manage_uv_layout").tier).toBe("primary");
    expect(exposed.has("manage_cubes")).toBe(true);
    expect(exposed.has("paint_texture_transaction")).toBe(true);

    const catalog = [...exposed].map((name) => ({
      name,
      description: definitions[name]!.description,
      annotations: definitions[name]!.annotations,
    })) as BackendTool[];
    const names = new Set(catalog.map((item) => item.name));

    // Exact missing capability identity must never resolve to a different
    // executor merely because semantic aliases exist in the manifest.
    expect(searchCapabilityCatalog(catalog, "manage_uv_layout", 8)).toEqual([]);
    for (const intent of ["pack uv islands", "construct_geometry"]) {
      const results = searchCapabilityCatalog(catalog, intent, 8);
      expect(results.every((entry) => names.has(entry.capability_id)), intent)
        .toBe(true);
      expect(results.map((entry) => entry.capability_id), intent)
        .not.toContain("manage_uv_layout");
      expect(results.map((entry) => entry.capability_id), intent)
        .not.toContain("construct_geometry");
    }
  });

  test("registered IK discovery retains short domain vocabulary", () => {
    const definitions = getAllToolDefinitions();
    const catalog = getMcpSurfaceToolNames("bedrock_entity", "geometry")
      .map((name) => ({
        name,
        description: definitions[name].description,
        annotations: definitions[name].annotations,
      })) as BackendTool[];
    // This checks a capability actually exposed by the current Runtime surface,
    // unlike prewired but unregistered manage_uv_layout.
    expect(catalog.some((item) => item.name === "bone_rigging")).toBe(true);
    expect(searchCapabilityCatalog(catalog, "IK", 8)
      .map((item) => item.capability_id)).toContain("bone_rigging");
  });

  test("canonical semantic geometry capabilities outrank overlapping rig helper", () => {
    for (const capability of [
      "add_group",
      "modify_group",
      "reparent_element",
      "remove_element",
      "rename_element",
    ]) {
      expect(getCapabilityMetadata(capability).tier).toBe("primary");
    }

    expect(getCapabilityMetadata("add_group").searchAliases).toEqual(
      expect.arrayContaining(["create bone", "bone batch"])
    );
    expect(getCapabilityMetadata("modify_group").searchAliases).toEqual(
      expect.arrayContaining(["set pivot", "bone pivot"])
    );
    expect(getCapabilityMetadata("reparent_element").searchAliases).toEqual(
      expect.arrayContaining(["parent bone", "unparent bone"])
    );

    expect(getCapabilityMetadata("bone_rigging").tier).toBe("support");
    expect(getCapabilityMetadata("bone_rigging").searchAliases).toEqual(
      expect.arrayContaining(["inverse kinematics", "ik target", "mirror bone"])
    );

    const tools = getAllToolDefinitions();
    const catalog = getMcpSurfaceToolNames("bedrock_entity", "geometry").map(
      (name) => ({
        name,
        description: tools[name].description,
        annotations: tools[name].annotations,
      })
    ) as BackendTool[];

    expect(searchCapabilityCatalog(catalog, "reparent this bone under another bone", 3)[0]?.capability_id)
      .toBe("reparent_element");
    expect(searchCapabilityCatalog(catalog, "set the pivot of this animation bone", 3)[0]?.capability_id)
      .toBe("modify_group");
    expect(searchCapabilityCatalog(catalog, "enable ik on this bone and set its target", 3)[0])
      .toMatchObject({
        capability_id: "bone_rigging",
        branch: { field: "action", value: "set_ik" },
      });
    expect(searchCapabilityCatalog(catalog, "mirror this bone across the x axis", 3)[0])
      .toMatchObject({
        capability_id: "bone_rigging",
        branch: { field: "action", value: "mirror" },
      });
  });

  test("texture state and legacy helpers stay below semantic authoring tools", () => {
    expect(getCapabilityMetadata("activate_texture").tier).toBe("support");
    expect(getCapabilityMetadata("apply_texture").tier).toBe("support");

    for (const capability of [
      "create_texture",
      "paint_texture_transaction",
      "paint_with_brush",
      "manage_material",
    ]) {
      expect(getCapabilityMetadata(capability).tier).toBe("primary");
    }
  });

  test("consolidated legacy executors are exact-name-only in intent discovery", () => {
    const exactOnly = [
      "animation_copy_paste",
      "animation_graph_editor",
      "animation_timeline",
      "manage_keyframes",
      "batch_keyframe_operations",
      "configure_material",
      "create_pbr_material",
      "assign_texture_channel",
      "save_material_config",
      "bulk_set_material_instances",
      "clear_material_instances",
      "set_face_material_instance",
      "get_face_material_instances",
      "list_material_instances",
      "apply_texture",
    ] as const;

    for (const capability of exactOnly) {
      expect(getCapabilityMetadata(capability).discoveryMode, capability)
        .toBe("exact_only");
    }

    const definitions = getAllToolDefinitions();
    const catalog = [...new Set(
      (["geometry", "texturing", "animation"] as const).flatMap((phase) =>
        getMcpSurfaceToolNames("bedrock_entity", phase)
      )
    )].map((name) => ({
      name,
      description: definitions[name].description,
      annotations: definitions[name].annotations,
    })) as BackendTool[];

    expect(
      searchCapabilityCatalog(catalog, "edit animation timeline keyframes", 8)
        .map((entry) => entry.capability_id)
    ).toContain("manage_animation_timeline");
    expect(
      searchCapabilityCatalog(catalog, "edit animation timeline keyframes", 8)
        .map((entry) => entry.capability_id)
    ).not.toContain("animation_timeline");

    expect(
      searchCapabilityCatalog(catalog, "configure pbr material", 8)
        .map((entry) => entry.capability_id)
    ).toContain("manage_material");
    expect(
      searchCapabilityCatalog(catalog, "configure pbr material", 8)
        .map((entry) => entry.capability_id)
    ).not.toContain("configure_material");

    const legacyCatalog = [...catalog, {
      name: "configure_material",
      description: definitions.configure_material.description,
      annotations: definitions.configure_material.annotations,
    }];
    expect(searchCapabilityCatalog(legacyCatalog, "configure_material", 8)[0]?.capability_id)
      .toBe("configure_material");
  });

  test("selection helpers remain authoring support instead of animation surface", () => {
    for (const capability of ["select_all_of_type", "get_selection"]) {
      expect(classifyMcpToolPhase(capability, "elements")).toBe("geometry");
      expect(isMcpToolExposedForPhase(capability, "elements", "geometry")).toBe(true);
      expect(isMcpToolExposedForPhase(capability, "elements", "texturing")).toBe(true);
      expect(isMcpToolExposedForPhase(capability, "elements", "animation")).toBe(false);
    }
  });
});

// Exercise the real catalog: unrelated Paint metadata must not outrank creation.
test("texture creation intent wins over pixel editing in the registered catalog", () => {
  const catalog = Object.entries(getAllToolDefinitions()).filter(([name]) => getMcpSurfaceToolNames("bedrock_entity", "texturing").includes(name)).map(([name, definition]) => ({ name, description: definition.description, annotations: definition.annotations }));
  for (const [query, type] of [["create a blank texture", "blank"], ["create texture from model template", "template"], ["make a texture variant from the source texture", "variant"]]) {
    const [result] = searchCapabilityCatalog(catalog, query!, 4, { authoringPhase: "texturing", facts: { project_bound: true } });
    expect(result?.capability_id, query).toBe("create_texture");
    expect(result?.branch, query).toEqual({ field: "type", value: type });
  }
});

test("lexical metadata does not override explicit transform or gradient intent", () => {
  const catalog = Object.entries(getAllToolDefinitions()).filter(([name]) => getMcpSurfaceToolNames("bedrock_entity", "texturing").includes(name)).map(([name, definition]) => ({ name, description: definition.description, annotations: definition.annotations }));
  for (const [query, expected] of [["move this cube slightly forward without changing its parent", "manage_cubes"], ["paint a smooth gradient across the existing texture", "gradient_tool"]]) {
    const [result] = searchCapabilityCatalog(catalog, query!, 4, { facts: { project_bound: true, geometry_available: true, texture_available: true } });
    expect(result?.capability_id, query).toBe(expected);
  }
});
