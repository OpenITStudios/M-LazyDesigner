import { describe, expect, test } from "bun:test";
import { toolManifest } from "../scripts/generate/internal/docs-manifest";
import { z } from "zod";
import { wiredCreateTextureParameters } from "../server/runtime/contracts/texture";
import { getAllToolDefinitions } from "../lib/factories";
import { manifestEntriesForCapability } from "../gateway/capabilities/manifest";

describe("branch schema and semantic manifest consistency", () => {
  test("registered Runtime definitions actually retain extension-owned variant and native properties", async () => {
    // Import-safe default Runtime registration composes the actual executor
    // schemas; exported union constants alone do not prove tool availability.
    await import("../server/tools");
    const definitions = getAllToolDefinitions();
    const texture = definitions.create_texture;
    const timeline = definitions.manage_animation_timeline;
    expect(texture).toBeDefined();
    expect(timeline).toBeDefined();

    const variant = {
      type: "variant", name: "body_alt.png",
      source_texture_id: "base-uuid", group: "variants",
    };
    expect(texture.parameterSchema.safeParse(variant).success).toBe(true);
    expect(texture.parameterSchema.safeParse({
      ...variant, group: undefined,
    }).success).toBe(false);
    expect(texture.parameterSchema.safeParse({
      ...variant, type: "unsupported",
    }).success).toBe(false);

    expect(timeline.parameterSchema.safeParse({
      operation: "properties", length: 2,
    }).success).toBe(true);
    expect(timeline.parameterSchema.safeParse({
      operation: "properties",
    }).success).toBe(false);

    // Runtime extensions compose after consolidated registration; the base
    // route table is not the final capability schema.
    for (const operation of [
      "keyframes", "graph", "timeline", "batch", "copy_paste", "properties",
    ]) {
      expect(
        timeline.inputSchema.operation.safeParse(operation).success,
        operation
      ).toBe(true);
    }
    expect(
      timeline.inputSchema.operation.safeParse("future_unsupported").success
    ).toBe(false);
  });

  test("composed create_texture schema preserves all semantic type branches, including variant", () => {
    const runtime = z.toJSONSchema(wiredCreateTextureParameters, {
      io: "input",
      target: "draft-2020-12",
      unrepresentable: "any",
      reused: "inline",
    }) as Record<string, unknown>;
    function enumValues(node: unknown): string[] {
      if (!node || typeof node !== "object" || Array.isArray(node)) return [];
      const item = node as Record<string, unknown>;
      const properties = item.properties as Record<string, unknown> | undefined;
      const type = properties?.type as Record<string, unknown> | undefined;
      const direct = [
        ...(typeof type?.const === "string" ? [type.const] : []),
        ...(Array.isArray(type?.enum)
          ? type.enum.filter((value): value is string => typeof value === "string")
          : []),
      ];
      return [
        ...direct,
        ...["anyOf", "oneOf", "allOf"].flatMap((key) =>
          Array.isArray(item[key])
            ? (item[key] as unknown[]).flatMap(enumValues)
            : []
        ),
      ];
    }
    const supported = [...new Set(enumValues(runtime))].sort();
    const advertised = manifestEntriesForCapability("create_texture")
      .filter((entry) => entry.branch?.field === "type")
      .map((entry) => entry.branch!.value)
      .sort();
    expect(supported).toEqual(["blank", "template", "variant"]);
    expect(advertised).toEqual(supported);
    for (const input of [
      { type: "blank", name: "base.png" },
      { type: "template", name: "atlas.png" },
      { type: "variant", name: "variant.png", source_texture_id: "base",
        group: "variants" },
    ]) {
      expect(wiredCreateTextureParameters.safeParse(input).success, input.type).toBe(true);
    }
    expect(wiredCreateTextureParameters.safeParse({
      type: "missing-branch", name: "x",
    }).success).toBe(false);
  });

  test("first-class runtime branches have matching semantic branch identities", () => {
    const tools = toolManifest.flatMap((group) => group.tools);

    for (const tool of tools) {
      if (!tool.branches) continue;

      const manifest = manifestEntriesForCapability(tool.name);
      const expectedValues = Object.keys(tool.branches.schemas).sort();
      const actualValues = manifest
        .filter(
          (entry) =>
            entry.branch?.field === tool.branches!.discriminator
        )
        .map((entry) => entry.branch!.value)
        .sort();

      for (const value of expectedValues) {
        expect(
          manifest.some(
            (entry) =>
              entry.branch?.field === tool.branches!.discriminator &&
              entry.branch.value === value
          ),
          `${tool.name} branch ${tool.branches.discriminator}=${value}`
        ).toBe(true);
      }

      expect(actualValues).toEqual(expectedValues);
    }
  });
});
