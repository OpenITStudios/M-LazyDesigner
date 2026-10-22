import { describe, expect, test } from "bun:test";
import {
  GATEWAY_TOOL_NAMES,
  type BackendTool,
} from "@/gateway/contracts/protocol";
import {
  classifyCapabilityTier,
  searchCapabilityCatalog,
} from "@/gateway/capabilities/catalog";
import { classifyInterruptedCall } from "@/gateway/runtime/interruptionPolicy";
import {
  compactGatewayCapabilityStructuredContent,
  compactGatewayCapabilityContent,
  shouldAttachGatewayControlDelta,
} from "@/gateway/presentation/resultCompaction";
import {
  createRuntimeSignature,
  normalizeRuntimeUrl,
} from "@/gateway/runtime/identity";
import { decorateCapabilities, projectCapabilitiesForSearch } from "@/gateway/control/capabilities";
import {
  getCapabilityBranchFields,
  projectCapabilityInputSchema,
} from "@/gateway/capabilities/schemaProjection";

describe("BlockIT Gateway contract", () => {

  test("search and describe omit echoed or derivable request metadata", async () => {
    const source = await Bun.file(
      "gateway/handlers/registerCoreTools.ts"
    ).text();
    const searchStart = source.indexOf("GATEWAY_TOOLS.searchCapabilities");
    const describeStart = source.indexOf("GATEWAY_TOOLS.describeCapability");
    const invokeStart = source.indexOf("GATEWAY_TOOLS.invokeCapability");
    const searchBlock = source.slice(searchStart, describeStart);
    const describeBlock = source.slice(describeStart, invokeStart);

    expect(searchBlock).toContain("structuredContent: { capabilities }");
    expect(searchBlock).not.toContain("structuredContent: { count:");
    expect(describeBlock).toContain('text: "Schema ready."');
    expect(describeBlock).not.toContain("name: tool.name");
    expect(describeBlock).not.toContain("schema_projection:");
    expect(describeBlock).toContain("inputSchema: projection.inputSchema");
    expect(describeBlock).toContain("semantic_revision:");
    // Only full detail should load metadata, while input-only retains
    // content-addressed branch identity and the same schema payload.
    const fullBranch = describeBlock.indexOf('if (detail === "full")');
    const metadataLookup = describeBlock.indexOf(
      "const metadata = getCapabilityMetadata(capability)"
    );
    const inputOnlyBranch = describeBlock.indexOf(
      "capabilityPayload = { inputSchema: projection.inputSchema }"
    );
    expect(fullBranch).toBeGreaterThanOrEqual(0);
    expect(metadataLookup).toBeGreaterThan(fullBranch);
    expect(inputOnlyBranch).toBeGreaterThan(metadataLookup);
    expect(describeBlock).toContain("semantic_id:");
    expect(describeBlock).toMatch(/verification_class:\s*semanticRecord\?\.verificationClass \?\? metadata.verificationClass/);
    expect(describeBlock).toMatch(/source_owner:\s*sourceOwnerForCapability\(capability\)/);
  });

  test("timeline discovery retains AI-callable easing and bone visibility arguments",()=>{
    const schema={type:"object",properties:{operation:{enum:["timeline","batch"]},action:{type:"string"},easing:{type:"object"},bone_ids:{type:"array"},parameters:{type:"object"}}};
    const result=projectCapabilityInputSchema("manage_animation_timeline",schema,{field:"operation",value:"timeline"});
    const projected=result.inputSchema as typeof schema;
    expect(projected.properties).toHaveProperty("easing");
    expect(projected.properties).toHaveProperty("bone_ids");
    expect(projected.properties).not.toHaveProperty("parameters");
  });
  test("client-facing MCP surface stays deliberately small and fixed", () => {
    expect(GATEWAY_TOOL_NAMES).toEqual([
      "status",
      "search_capabilities",
      "describe_capability",
      "invoke_capability",
    ]);
  });

  test("capability discovery ranks primary authoring tools ahead of comparable support tools", () => {
    const tools: BackendTool[] = [
      {
        name: "create_texture",
        description: "Create a texture atlas for BlockIT authoring.",
      },
      {
        name: "create_brush_preset",
        description: "Create a texture brush preset.",
      },
      {
        name: "manage_geometry_reference",
        description: "Load an approved GLB as optional 3D Evidence.",
      },
      {
        name: "emulate_clicks",
        description: "Emulate Blockbench UI clicks for maintenance.",
      },
    ];

    expect(searchCapabilityCatalog(tools, "create texture", 10)[0]?.capability_id).toBe(
      "create_texture"
    );
    expect(classifyCapabilityTier(tools[0]!)).toBe("primary");
    expect(classifyCapabilityTier(tools[1]!)).toBe("support");
    expect(classifyCapabilityTier(tools[2]!)).toBe("support");
    expect(classifyCapabilityTier(tools[3]!)).toBe("maintenance");
  });

  test("fallback discovery recognizes current high-value authoring terminology without broad search", () => {
    const tools: BackendTool[] = [
      {
        name: "paint_texture_transaction",
        description: "Apply a bounded texture transaction.",
      },
      {
        name: "paint_with_brush",
        description: "Paint texture pixels with the native brush.",
      },
      {
        name: "manage_render_profile",
        description: "Manage Bedrock entity rendering bindings.",
      },
      {
        name: "manage_material",
        description: "Manage a Bedrock PBR material.",
      },
      {
        name: "manage_animation_timeline",
        description: "Manage authored animation timeline data.",
      },
      {
        name: "manage_animation_controller",
        description: "Manage animation controller state composition.",
      },
    ];

    expect(
      searchCapabilityCatalog(tools, "exact pixel paint", 4)[0]?.capability_id
    ).toBe("paint_texture_transaction");
    expect(
      searchCapabilityCatalog(tools, "alpha cutout render material", 4)[0]
        ?.capability_id
    ).toBe("manage_render_profile");
    expect(
      searchCapabilityCatalog(tools, "native animation properties molang", 4)[0]
        ?.capability_id
    ).toBe("manage_animation_timeline");
    expect(
      searchCapabilityCatalog(tools, "nested controller blend curve", 4)[0]
        ?.capability_id
    ).toBe("manage_animation_controller");

    expect(classifyCapabilityTier(tools[0]!)).toBe("primary");
    expect(classifyCapabilityTier(tools[2]!)).toBe("primary");
    expect(classifyCapabilityTier(tools[4]!)).toBe("primary");
    expect(classifyCapabilityTier(tools[5]!)).toBe("primary");
  });

  test("maintenance fallbacks stay out of empty discovery but remain explicitly discoverable", () => {
    const tools: BackendTool[] = [
      { name: "manage_cubes", description: "Create Bedrock cubes." },
      { name: "emulate_clicks", description: "Emulate Blockbench UI clicks." },
    ];

    expect(searchCapabilityCatalog(tools, "", 10).map((tool) => tool.capability_id))
      .toEqual(["manage_cubes"]);
    expect(searchCapabilityCatalog(tools, "emulate clicks", 10)[0]).toMatchObject({
      capability_id: "emulate_clicks",
      tier: "maintenance",
    });
  });

  test("3D Evidence support remains discoverable only when relevant", () => {
    const tools: BackendTool[] = [
      {
        name: "manage_geometry_reference",
        description: "Load update or remove approved local GLB 3D Evidence.",
      },
      {
        name: "manage_cubes",
        description: "Create and update Bedrock cubes.",
      },
    ];

    expect(searchCapabilityCatalog(tools, "approved GLB evidence", 10)[0]).toMatchObject({
      capability_id: "manage_geometry_reference",
      tier: "support",
    });
  });

  test("search projection removes orientation constants but keeps routing ownership", () => {
    const [projected] = projectCapabilitiesForSearch([{
      capability_id: "manage_cubes",
      description: "Create or update cubes.",
      tier: "primary",
      read_only: false,
      destructive: true,
      idempotent: false,
      control: {
        authoring_domain: "GEOMETRY",
        current_domain: false,
        eligibility: "AVAILABLE",
        source_owner: {
          source: "mcp/server/tools/geometry/cubes.ts",
          specialist: ".agents/skills/lazydesigner-modelling/SKILL.md",
          anchor_test: "mcp/tests/model-effectiveness-correction-accuracy.test.ts",
        },
      },
    }]);

    expect(projected.authoring_domain).toBe("GEOMETRY");
    expect(projected.flags).toEqual(["destructive"]);
    expect(projected).not.toHaveProperty("control");
    expect(projected).not.toHaveProperty("read_only");
    expect(projected).not.toHaveProperty("destructive");
    expect(projected).not.toHaveProperty("idempotent");
  });

  test("raw search projection matches enriched Control search without owner bytes", () => {
    const raw = [{
      capability_id: "manage_cubes",
      description: "Create or update cubes.",
      tier: "primary" as const,
      read_only: false,
      destructive: true,
      idempotent: false,
    }];
    const projected = projectCapabilitiesForSearch(raw);
    expect(projected).toEqual(projectCapabilitiesForSearch(decorateCapabilities(raw)));
    expect(projected[0]).toMatchObject({
      capability_id: "manage_cubes",
      authoring_domain: "GEOMETRY",
      flags: ["destructive"],
    });
    expect(projected[0]).not.toHaveProperty("source_owner");
    expect(projected[0]).not.toHaveProperty("control");
  });

  test("describe capability exposes lifecycle semantics only on demand", async () => {
    const source = await Bun.file(
      "gateway/handlers/registerCoreTools.ts"
    ).text();

    expect(source).toContain("const metadata = getCapabilityMetadata(capability)");
    expect(source).toContain('detail === "full"');
    expect(source).toContain("lifecycle: metadata.lifecycle");
    expect(source).toMatch(/execution_class:\s*semanticRecord\?\.executionClass \?\? metadata.executionClass/);
    expect(source).toMatch(/verification_class:\s*semanticRecord\?\.verificationClass \?\? metadata.verificationClass/);
    expect(source).toMatch(/source_owner:\s*sourceOwnerForCapability\(capability\)/);

    const searchBlock = source.slice(
      source.indexOf("GATEWAY_TOOLS.searchCapabilities"),
      source.indexOf("GATEWAY_TOOLS.describeCapability")
    );
    expect(searchBlock).not.toContain("execution_class");
    expect(searchBlock).not.toContain("verification_class");
    expect(searchBlock).not.toContain("lifecycle:");
    expect(searchBlock).not.toContain("source_owner: sourceOwnerForCapability");
  });

  test("manage_render_profile describe projection selects one canonical operation branch", async () => {
    const { manageRenderProfileParameters } = await import(
      "@/server/tools/render-profile"
    );
    const { z } = await import("zod");
    const schema = z.toJSONSchema(manageRenderProfileParameters, {
      io: "input",
      target: "draft-2020-12",
      unrepresentable: "any",
      reused: "inline",
    }) as any;

    const fullBytes = JSON.stringify(schema).length;
    for (const operation of [
      "inspect",
      "bind",
      "set_slot",
      "assign",
      "unassign",
    ]) {
      const projected = projectCapabilityInputSchema(
        "manage_render_profile",
        schema,
        { field: "operation", value: operation }
      );
      expect(projected.projected).toBe(true);
      const branch = projected.inputSchema as any;
      expect(branch.properties.operation.const).toBe(operation);
      expect(branch.required).toContain("operation");
      expect(JSON.stringify(branch).length).toBeLessThan(fullBytes);
    }
  });

  test("manage_cubes describe projection selects one canonical operation branch", async () => {
    const { cubeToolDocs } = await import("@/server/tools/cubes");
    const { z } = await import("zod");
    const manageCubes = cubeToolDocs.find(
      (tool) => tool.name === "manage_cubes"
    );
    expect(manageCubes).toBeDefined();
    if (!manageCubes) throw new Error("manage_cubes tool docs missing.");
    const schema = z.toJSONSchema(manageCubes.parameters, {
      io: "input",
      target: "draft-2020-12",
      unrepresentable: "any",
      reused: "inline",
    }) as any;

    const fullBytes = JSON.stringify(schema).length;
    for (const operation of [
      "create",
      "update",
      "batch_update",
      "simplify",
    ]) {
      const projected = projectCapabilityInputSchema(
        "manage_cubes",
        schema,
        { field: "operation", value: operation }
      );
      expect(projected.projected).toBe(true);
      const branch = projected.inputSchema as any;
      expect(branch.properties.operation.const).toBe(operation);
      expect(branch.required).toContain("operation");
      expect(JSON.stringify(branch).length).toBeLessThan(fullBytes);
    }
  });

  test("branch projection keeps only continuation-relevant consolidated Animation fields", () => {
    const inputSchema = {
      type: "object",
      properties: {
        operation: { type: "string" },
        animation_id: { type: "string" },
        action: { type: "string" },
        bone_name: { type: "string" },
        channel: { type: "string" },
        keyframes: { type: "array" },
        batch_operation: { type: "string" },
        selection: { type: "string" },
        range: { type: "object" },
        pattern: { type: "object" },
        parameters: { type: "object" },
        custom_curve: { type: "object" },
      },
      required: ["operation"],
    };

    const keyframes = projectCapabilityInputSchema(
      "manage_animation_timeline",
      inputSchema,
      { field: "operation", value: "keyframes" }
    );
    expect(keyframes.projected).toBe(true);
    expect(Object.keys((keyframes.inputSchema as any).properties).sort()).toEqual([
      "action",
      "animation_id",
      "bone_name",
      "channel",
      "keyframes",
      "operation",
    ]);
    expect((keyframes.inputSchema as any).properties.operation.const).toBe("keyframes");

    const batchFields = getCapabilityBranchFields("manage_animation_timeline", {
      field: "operation",
      value: "batch",
    });
    expect(batchFields).toContain("animation_id");
    expect(batchFields).toContain("batch_operation");
    expect(batchFields).not.toContain("keyframes");

    expect(() =>
      projectCapabilityInputSchema(
        "manage_animation_timeline",
        inputSchema,
        { field: "operation", value: "unknown" }
      )
    ).toThrow(/does not expose a describe projection/);
  });

  test("branch projection slims high-frequency authoring capability descriptions", () => {
    const allFields = [
      "mode",
      "include_cubes",
      "max_depth",
      "max_nodes",
      "name_pattern",
      "name_contains",
      "type",
      "parent_group",
      "min_size",
      "max_size",
      "selected_only",
      "limit",
      "id",
      "detail",
      "operation",
      "name",
      "material",
      "texture",
      "channel",
      "color_texture",
      "normal_texture",
      "height_texture",
      "mer_texture",
      "color_value",
      "mer_value",
      "subsurface_value",
      "cube_id",
      "faces",
      "material_name",
      "assignments",
      "all_cubes",
      "include_usages",
      "usage_limit_per_instance",
      "source_texture_id",
      "group",
      "width",
      "height",
      "data",
      "fill_color",
      "layer_name",
      "pbr_channel",
      "render_mode",
      "render_sides",
      "texture_id",
      "pixel_density",
      "rearrange_uv",
      "power_of_two",
      "keep_multi_texture_occupancy",
      "padding",
    ];
    const inputSchema = {
      type: "object",
      properties: Object.fromEntries(
        allFields.map((field) => [field, { type: "string" }])
      ),
      required: ["mode", "operation", "type"],
    };

    const detail = projectCapabilityInputSchema("inspect_elements", inputSchema, {
      field: "mode",
      value: "detail",
    });
    expect(Object.keys((detail.inputSchema as any).properties).sort()).toEqual([
      "detail",
      "id",
      "mode",
    ]);

    const assignChannel = projectCapabilityInputSchema(
      "manage_material",
      inputSchema,
      { field: "operation", value: "assign_channel" }
    );
    expect(Object.keys((assignChannel.inputSchema as any).properties).sort()).toEqual([
      "channel",
      "material",
      "operation",
      "texture",
    ]);

    const materialList = projectCapabilityInputSchema(
      "manage_material_instances",
      inputSchema,
      { field: "operation", value: "list" }
    );
    expect(Object.keys((materialList.inputSchema as any).properties).sort()).toEqual([
      "include_usages",
      "operation",
      "usage_limit_per_instance",
    ]);

    const variant = projectCapabilityInputSchema("create_texture", inputSchema, {
      field: "type",
      value: "variant",
    });
    expect(Object.keys((variant.inputSchema as any).properties).sort()).toEqual([
      "group",
      "name",
      "source_texture_id",
      "type",
    ]);

    for (const projection of [detail, assignChannel, materialList, variant]) {
      expect(
        Object.keys((projection.inputSchema as any).properties).length
      ).toBeLessThan(allFields.length / 4);
    }
  });

  test("runtime signature ignores changing health timestamps but detects surface identity changes", () => {
    const base = {
      timestamp: "2026-09-04T09:00:00Z",
      build_identity: `sha256:${"a".repeat(64)}`,
      instance_id: "runtime-a",
      startup_time: "2026-09-04T08:00:00Z",
      exposed_tool_count: 25,
      product: {
        id: "blockit-bedrock-entity-mcp",
        version: "0.1.0",
        profile: "bedrock_entity",
        authoring_phase: "geometry",
      },
    };

    expect(
      createRuntimeSignature({ ...base, timestamp: "2026-09-04T09:01:00Z" })
    ).toBe(createRuntimeSignature(base));
    expect(
      createRuntimeSignature({
        ...base,
        product: { ...base.product, authoring_phase: "texturing" },
        exposed_tool_count: 35,
      })
    ).not.toBe(createRuntimeSignature(base));
  });

  test("Gateway runtime URL is loopback-only", () => {
    expect(normalizeRuntimeUrl("http://127.0.0.1:3000/bb-mcp/"))
      .toBe("http://127.0.0.1:3000/bb-mcp");
    expect(() => normalizeRuntimeUrl("https://example.com/bb-mcp")).toThrow(
      /loopback/
    );
  });

  test("interrupted mutations are never classified as safe automatic retries", () => {
    expect(
      classifyInterruptedCall({
        name: "inspect_elements",
        annotations: { readOnlyHint: true },
      })
    ).toEqual({ code: "BACKEND_CALL_INTERRUPTED", safe_to_retry: true });

    expect(classifyInterruptedCall({ name: "manage_cubes" })).toEqual({
      code: "OUTCOME_UNKNOWN",
      safe_to_retry: false,
    });
  });

  test("Gateway compacts audited read-only summaries while preserving non-text evidence", () => {
    const summary = [{ type: "text", text: "Project fixture: 4 Cubes, 2 Groups, 1 Texture." }];
    const structured = {
      project: { uuid: "project-a", name: "fixture" },
      counts: { cubes: 4, groups: 2, textures: 1 },
    };

    for (const capability of [
      "get_project_info",
      "list_textures",
      "inspect_animation",
      "inspect_particle",
    ]) {
      expect(
        compactGatewayCapabilityContent(
          capability,
          structured,
          summary,
          "not_applicable",
          true
        ),
        capability
      ).toEqual([{ type: "text", text: "Read complete." }]);
    }

    const image = [{ type: "image", data: "fixture", mimeType: "image/png" }];
    expect(
      compactGatewayCapabilityContent(
        "get_texture",
        structured,
        image,
        "not_applicable",
        true
      )
    ).toBe(image);

    expect(
      compactGatewayCapabilityContent(
        "get_project_info",
        undefined,
        summary,
        "not_applicable",
        true
      )
    ).toBe(summary);
  });

  test("Gateway read-only prose compaction is annotation-driven and preserves decision signals", () => {
    const structured = {
      item: { uuid: "fixture-a", name: "fixture" },
      count: 1,
    };
    const summary = [{ type: "text", text: "Found one fixture item." }];

    expect(
      compactGatewayCapabilityContent(
        "future_read_capability",
        structured,
        summary,
        "not_applicable",
        true
      )
    ).toEqual([{ type: "text", text: "Read complete." }]);

    expect(
      compactGatewayCapabilityContent(
        "future_read_capability",
        structured,
        summary,
        "not_applicable",
        false
      )
    ).toBe(summary);

    const warning = [{
      type: "text",
      text: "Warning: texture state is stale; refresh before mutation.",
    }];
    expect(
      compactGatewayCapabilityContent(
        "future_read_capability",
        structured,
        warning,
        "not_applicable",
        true
      )
    ).toBe(warning);

    const path = [{
      type: "text",
      text: "Read model from C:\\workspace\\asset.bbmodel.",
    }];
    expect(
      compactGatewayCapabilityContent(
        "future_read_capability",
        structured,
        path,
        "not_applicable",
        true
      )
    ).toBe(path);
  });

  test("successful read-only capabilities omit redundant Control continuation but failures remain fail-closed", () => {
    expect(shouldAttachGatewayControlDelta(true, true)).toBe(false);
    expect(shouldAttachGatewayControlDelta(false, true)).toBe(true);
    expect(shouldAttachGatewayControlDelta(true, false)).toBe(true);
    expect(shouldAttachGatewayControlDelta(false, false)).toBe(true);

    const verbose = [{
      type: "text",
      text: 'Inspected cube "leg" (cube-leg).',
    }];
    expect(
      compactGatewayCapabilityContent(
        "inspect_elements",
        {
          uuid: "cube-leg",
          name: "leg",
          type: "cube",
          from: [0, 0, 0],
          to: [2, 8, 2],
        },
        verbose,
        "not_applicable"
      )
    ).toEqual([{ type: "text", text: "Inspection ready." }]);

    expect(
      compactGatewayCapabilityContent(
        "inspect_elements",
        { name: "leg" },
        verbose,
        "not_applicable"
      )
    ).toBe(verbose);
  });

  test("Gateway compacts only audited receipt-only prose and preserves non-receipt or path-bearing text", () => {
    const verbose = [{ type: "text", text: "Updated locator hand (locator-a); changed: position." }];

    expect(
      compactGatewayCapabilityContent(
        "manage_locator",
        {
          execution: "applied",
          action: "update",
          id: "locator-a",
          changed_fields: ["position"],
          state: {
            uuid: "locator-a",
            name: "hand",
            type: "locator",
            position: [1, 2, 3],
            rotation: [0, 0, 0],
            ignore_inherited_scale: false,
          },
        },
        verbose,
        "receipt_only"
      )
    ).toEqual([{ type: "text", text: "Receipt complete." }]);

    expect(
      compactGatewayCapabilityContent(
        "manage_locator",
        { execution: "applied", id: "locator-a" },
        verbose,
        "focused_read"
      )
    ).toBe(verbose);

    const saved = [{ type: "text", text: "Saved material config to C:/asset/material.json." }];
    expect(
      compactGatewayCapabilityContent(
        "manage_material",
        { operation: "save", scope: "material_persistence_only" },
        saved,
        "receipt_only"
      )
    ).toBe(saved);
  });

  test("Gateway receipt-only text compaction is semantic rather than capability-name based", () => {
    const authoritative = {
      execution: "applied",
      after: {
        uuid: "fixture-a",
        name: "updated",
      },
      changed_fields: ["name"],
    };
    const verbose = [{
      type: "text",
      text: "Updated fixture-a from old to updated.",
    }];

    expect(
      compactGatewayCapabilityContent(
        "future_mutation_capability",
        authoritative,
        verbose,
        "receipt_only"
      )
    ).toEqual([{ type: "text", text: "Receipt complete." }]);

    expect(
      compactGatewayCapabilityContent(
        "future_mutation_capability",
        { execution: "applied" },
        verbose,
        "receipt_only"
      )
    ).toBe(verbose);

    const pathBearing = [{
      type: "text",
      text: "Saved result to C:\\asset\\output\\fixture.json.",
    }];
    expect(
      compactGatewayCapabilityContent(
        "future_mutation_capability",
        authoritative,
        pathBearing,
        "receipt_only"
      )
    ).toBe(pathBearing);

    const urlBearing = [{
      type: "text",
      text: "Published receipt at https://example.invalid/receipt/1.",
    }];
    expect(
      compactGatewayCapabilityContent(
        "future_mutation_capability",
        authoritative,
        urlBearing,
        "receipt_only"
      )
    ).toBe(urlBearing);
  });

  test("Gateway compacts applied cube mutation prose only when structured receipt is authoritative", () => {
    const verbose = [{
      type: "text",
      text: "Applied authored update to Cube leg. Structural effect recorded; reference fidelity was not evaluated.",
    }];

    expect(
      compactGatewayCapabilityContent(
        "manage_cubes",
        { execution: "applied", modified: 1, after: { uuid: "cube-a" } },
        verbose
      )
    ).toEqual([
      { type: "text", text: "Cube mutation applied; use structured receipt." },
    ]);

    expect(
      compactGatewayCapabilityContent(
        "manage_cubes",
        { execution: "applied", added: 4, cubes: [{ uuid: "cube-a" }] },
        verbose
      )
    ).toBe(verbose);

    expect(
      compactGatewayCapabilityContent(
        "manage_cubes",
        { execution: "planned", updates: [] },
        verbose
      )
    ).toBe(verbose);
  });

  test("Gateway generically removes redundant before snapshots only for receipt-only continuation", () => {
    const applied = {
      execution: "applied",
      before: {
        uuid: "locator-a",
        name: "old",
        position: [0, 0, 0],
      },
      after: {
        uuid: "locator-a",
        name: "new",
        position: [1, 2, 3],
      },
      changed_fields: ["name", "position"],
      verification: {
        revision: "fixture-revision",
      },
    };

    expect(
      compactGatewayCapabilityStructuredContent(
        "manage_locator",
        applied,
        "receipt_only"
      )
    ).toEqual({
      execution: "applied",
      after: applied.after,
      changed_fields: applied.changed_fields,
      verification: applied.verification,
    });

    expect(
      compactGatewayCapabilityStructuredContent(
        "manage_locator",
        applied,
        "focused_read"
      )
    ).toBe(applied);

    const incomplete = {
      execution: "applied",
      before: { uuid: "locator-a" },
      changed_fields: ["name"],
    };
    expect(
      compactGatewayCapabilityStructuredContent(
        "manage_locator",
        incomplete,
        "receipt_only"
      )
    ).toBe(incomplete);

    const batch = {
      execution: "applied",
      effects: [
        {
          before: { uuid: "a", name: "old-a" },
          after: { uuid: "a", name: "new-a" },
          changed_fields: ["name"],
        },
        {
          after: { uuid: "b", name: "new-b" },
          changed_fields: ["name"],
        },
      ],
      recovery: { safe_to_retry: false },
    };
    expect(
      compactGatewayCapabilityStructuredContent(
        "manage_locator",
        batch,
        "receipt_only"
      )
    ).toEqual({
      execution: "applied",
      effects: [
        {
          after: { uuid: "a", name: "new-a" },
          changed_fields: ["name"],
        },
        batch.effects[1],
      ],
      recovery: batch.recovery,
    });
  });

  test("Gateway compacts manage_cubes continuation receipts without dropping UV-changing state", () => {
    const geometryBatch = compactGatewayCapabilityStructuredContent(
      "manage_cubes",
      {
        modified: 1,
        effects: [
          {
            before: {
              uuid: "cube-a",
              from: [0, 0, 0],
              face_uvs: { north: [0, 0, 4, 4] },
            },
            after: {
              uuid: "cube-a",
              from: [1, 0, 0],
              box_uv_region: { logical_rect: [0, 0, 4, 4] },
              face_uvs: { north: [0, 0, 4, 4] },
            },
            geometry_effect: {
              changed_fields: ["from"],
              center_delta: [1, 0, 0],
            },
          },
        ],
      }
    );
    const geometryJson = JSON.stringify(geometryBatch);
    expect(geometryJson).not.toContain('"before"');
    expect(geometryJson).not.toContain('"face_uvs"');
    expect(geometryJson).toContain('"box_uv_region"');
    expect(geometryJson).toContain('"center_delta"');
    expect(geometryJson).not.toContain('"rotation"');
    expect(geometryJson).not.toContain('"origin"');

    const batchProjection = compactGatewayCapabilityStructuredContent(
      "manage_cubes",
      {
        modified: 1,
        effects: [
          {
            before: {
              uuid: "cube-transform",
              name: "leg",
              from: [0, 0, 0],
              to: [2, 8, 2],
              size: [2, 8, 2],
              origin: [1, 0, 1],
              rotation: [0, 0, 0],
              inflate: 0,
              box_uv: true,
              uv_offset: [0, 0],
              box_uv_region: { logical_rect: [0, 0, 8, 12] },
              mirror_uv: false,
              autouv: 1,
              visibility: true,
            },
            after: {
              uuid: "cube-transform",
              name: "leg",
              from: [1, 0, 0],
              to: [3, 8, 2],
              size: [2, 8, 2],
              origin: [1, 0, 1],
              rotation: [0, 0, 0],
              inflate: 0,
              box_uv: true,
              uv_offset: [0, 0],
              box_uv_region: { logical_rect: [0, 0, 8, 12] },
              mirror_uv: false,
              autouv: 1,
              visibility: true,
            },
            geometry_effect: {
              changed_fields: ["from", "to"],
              center_delta: [1, 0, 0],
              size_delta: [0, 0, 0],
            },
          },
        ],
      }
    ) as any;
    expect(batchProjection.effects[0].after).toEqual({
      uuid: "cube-transform",
      name: "leg",
      from: [1, 0, 0],
      to: [3, 8, 2],
      size: [2, 8, 2],
      box_uv_region: { logical_rect: [0, 0, 8, 12] },
    });

    const uvUpdate = compactGatewayCapabilityStructuredContent(
      "manage_cubes",
      {
        before: {
          uuid: "cube-b",
          face_uvs: { north: [0, 0, 4, 4] },
        },
        after: {
          uuid: "cube-b",
          face_uvs: { north: [4, 0, 8, 4] },
        },
        geometry_effect: {
          changed_fields: ["faces"],
          faces_changed: true,
        },
      }
    );
    const uvJson = JSON.stringify(uvUpdate);
    expect(uvJson).not.toContain('"before"');
    expect(uvJson).toContain('"face_uvs"');
    expect(uvJson).toContain('"faces_changed"');

    const unrelated = { detail: { uuid: "cube-a" } };
    expect(
      compactGatewayCapabilityStructuredContent("inspect_elements", unrelated)
    ).toBe(unrelated);
  });

  test("search projection preserves safety semantics with compact true-only flags", async () => {
    const { projectCapabilitiesForSearch } = await import("@/gateway/control/capabilities");
    const projected = projectCapabilitiesForSearch([
      {
        capability_id: "manage_cubes",
        description: "Create or update Bedrock cubes.",
        tier: "primary",
        read_only: false,
        destructive: true,
        idempotent: false,
        control: {
          authoring_domain: "GEOMETRY",
          current_domain: false,
          eligibility: "AVAILABLE",
          source_owner: { source: "x", specialist: null, anchor_test: null },
        },
      },
      {
        capability_id: "inspect_elements",
        description: "Inspect model elements.",
        tier: "primary",
        read_only: true,
        destructive: false,
        idempotent: true,
        control: {
          authoring_domain: "CORE",
          current_domain: false,
          eligibility: "AVAILABLE",
          source_owner: { source: "y", specialist: null, anchor_test: null },
        },
      },
    ] as any);

    expect(projected[0]).toEqual({
      capability_id: "manage_cubes",
      hint: "Create or update Bedrock cubes.",
      tier: "primary",
      authoring_domain: "GEOMETRY",
      operation_class: "MUTATION",
      verification_class: "visual",
      flags: ["destructive"],
    });
    expect(projected[1]).toEqual({
      capability_id: "inspect_elements",
      hint: "Inspect model elements.",
      tier: "primary",
      authoring_domain: "CORE",
      operation_class: "QUERY",
      execution_class: "fast",
      flags: ["read_only", "idempotent"],
    });

    const decode = (item: any) => ({
      read_only: item.flags?.includes("read_only") ?? false,
      destructive: item.flags?.includes("destructive") ?? false,
      idempotent: item.flags?.includes("idempotent") ?? false,
    });
    expect(decode(projected[0])).toEqual({
      read_only: false, destructive: true, idempotent: false,
    });
    expect(decode(projected[1])).toEqual({
      read_only: true, destructive: false, idempotent: true,
    });
  });

  test("phase handoff invalidates only backend state and explicitly keeps the client task alive", async () => {
    const backendSource = await Bun.file("gateway/runtime/backend.ts").text();
    const backendContract = await Bun.file(
      "gateway/runtime/backendContract.ts"
    ).text();

    expect(backendSource).toContain("resolveGatewayCapabilityEffects");
    expect(backendSource).toContain(
      'application.effects.phaseAffinity === "update_from_result"'
    );
    expect(backendSource).toContain(
      "application.effects.invalidateCatalog || affinityChanged"
    );
    expect(backendSource).toContain("await this.closeConnectionUnsafe()");
    expect(backendContract).toContain("gateway_catalog_invalidated: true");
    expect(backendContract).toContain("client_reconnect_required: false");
    expect(backendContract).toContain("new_chat_required: false");
    expect(backendContract).toContain("continue same task through Gateway");
  });

  test("stdio Gateway keeps discovery bounded and does not advertise unproxied Runtime surfaces", async () => {
    const packageJson = await Bun.file("package.json").json();
    const [source, registration, executorSource, backendSource] =
      await Promise.all([
        Bun.file("gateway/index.ts").text(),
        Bun.file("gateway/handlers/registerCoreTools.ts").text(),
        Bun.file("gateway/execution/capabilityExecutor.ts").text(),
        Bun.file("gateway/runtime/backend.ts").text(),
      ]);

    expect(packageJson.scripts.gateway).toBe("bun run ./gateway/index.ts");
    expect(source).toContain("serveStdio(() => buildGatewayServer(experimentalRegistrar)");
    expect(source).toContain("function buildGatewayServer(");
    expect(source).toContain("experimentalRegistrar: ExperimentalHybridRegistrar | null");
    expect(source).not.toContain("new StdioServerTransport()");
    expect(source.indexOf("const backend = new BlockitRuntimeBackend(")).toBeLessThan(
      source.indexOf("function buildGatewayServer(")
    );
    expect(executorSource).toContain(
      "compactGatewayCapabilityStructuredContent"
    );
    expect(registration).toContain("projectCapabilityInputSchema");
    expect(registration).toContain("inputSchema: projection.inputSchema");
    expect(registration).toContain("tool.outputSchema !== undefined");
    expect(registration).toContain("{ outputSchema: tool.outputSchema }");
    expect(registration).toContain(
      ".default(CONTROL_ROUTING_POLICY.search_limit)"
    );
    expect(backendSource).toMatch(/searchCapabilities\(\s*query: string,\s*limit: number = 4/);
    expect(source).toContain("Runtime resources and prompts are not proxied");
    expect(registration).not.toContain(
      "structuredContent: { capability: tool }"
    );
    expect(source).not.toContain("registerResource(");
    expect(source).not.toContain("registerPrompt(");
    expect(source).not.toContain("console.log");
    expect(backendSource).toContain("new StreamableHTTPClientTransport");
    expect(backendSource.match(/\.callTool\(/g)?.length ?? 0).toBe(1);
  });
});
