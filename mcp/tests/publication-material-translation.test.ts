import { describe, expect, test } from "bun:test";
import {
  expectedPublicationGltfMaterial,
  inspectPublicationPbrPlan,
  requirePublicationTexturePreviewMode,
} from "@/lib/publication/materialContract";

describe("MCP PBR -> glTF publication material contract", () => {
  test("plain color atlas carries explicit opaque defaults, never invented PBR", () => {
    expect(expectedPublicationGltfMaterial(null)).toEqual({
      alpha_mode: "OPAQUE", double_sided: true,
      metallic_factor: 0, roughness_factor: 0.85, emissive_factor: 0,
      metallic_roughness_texture: false, normal_texture: false,
      emissive_texture: false, sampler: "NEAREST",
    });
  });

  test("authored uniform MER and normal map retain exact source factors", () => {
    const plan = inspectPublicationPbrPlan(
      "color-uuid",
      [
        { uuid: "color-uuid", pbr_channel: "color" },
        { uuid: "normal-uuid", pbr_channel: "normal" },
      ],
      { mer_value: [128, 64, 255], subsurface_value: 0 },
    );
    expect(plan).toMatchObject({
      color_uuid: "color-uuid", mer_uuid: null, normal_uuid: "normal-uuid",
      uniform_mer: [128, 64, 255],
    });
    const gltf = expectedPublicationGltfMaterial(plan);
    expect(gltf.metallic_factor).toBeCloseTo(128 / 255, 8);
    expect(gltf.roughness_factor).toBe(1);
    expect(gltf.emissive_factor).toBeCloseTo(64 / 255, 8);
    expect(gltf.normal_texture).toBe(true);
    expect(gltf.emissive_texture).toBe(true);
    expect(gltf.metallic_roughness_texture).toBe(false);
  });

  test("authored MER map maps metallic/roughness/emission without uniform substitution", () => {
    const plan = inspectPublicationPbrPlan(
      "color-uuid",
      [
        { uuid: "color-uuid", pbr_channel: "color" },
        { uuid: "mer-uuid", pbr_channel: "mer" },
        { uuid: "normal-uuid", pbr_channel: "normal" },
      ],
      { mer_value: [30, 30, 30] }, // Unused by Blockbench when MER atlas exists.
    );
    expect(plan).toMatchObject({ mer_uuid: "mer-uuid", uniform_mer: null });
    expect(expectedPublicationGltfMaterial(plan)).toMatchObject({
      metallic_factor: 1, roughness_factor: 1, emissive_factor: 1,
      metallic_roughness_texture: true, normal_texture: true,
      emissive_texture: true,
    });
  });

  test("unknown, duplicate, absent source channels and unhandled maps fail closed", () => {
    const color = { uuid: "color", pbr_channel: "color" };
    const baseline = { mer_value: [0, 0, 255] };
    const invalid = [
      { channels: [], contract: baseline },
      { channels: [color, color], contract: baseline },
      { channels: [color, { uuid: "height", pbr_channel: "height" }], contract: baseline },
      { channels: [color, { uuid: "rough", pbr_channel: "rough" }], contract: baseline },
      { channels: [color, { uuid: "normal", pbr_channel: "normal" },
        { uuid: "normal2", pbr_channel: "normal" }], contract: baseline },
      { channels: [color], contract: { mer_value: [0, -1, 255] } },
      { channels: [color], contract: { mer_value: [0, 0, 255], subsurface_value: 80 } },
      { channels: [color], contract: { mer_value: [0, 0, 255], subsurface_value: NaN } },
    ];
    for (const item of invalid) {
      expect(() => inspectPublicationPbrPlan("color", item.channels, item.contract)).toThrow();
    }
    expect(() => inspectPublicationPbrPlan("color", [
      color, { uuid: "rough", pbr_channel: "rough" },
    ], baseline)).toThrow("PUBLICATION_PBR_UNKNOWN_CHANNEL");
    expect(() => inspectPublicationPbrPlan("color", [
      color, { uuid: "normal", pbr_channel: "normal" },
    ], { mer_value: [0, 0, 255], subsurface_value: 20 }))
      .toThrow("PUBLICATION_PBR_SUBSURFACE_UNSUPPORTED");
    expect(() => inspectPublicationPbrPlan(
      "wrong-color",
      [color],
      baseline,
    )).toThrow("COLOR_SOURCE_MISMATCH");
  });

  test("Blockbench preview mode cannot impersonate Bedrock authored shader", () => {
    expect(() => requirePublicationTexturePreviewMode("color", undefined)).not.toThrow();
    expect(() => requirePublicationTexturePreviewMode("color", "default")).not.toThrow();
    for (const mode of ["emissive", "additive", "layered", "custom"]) {
      expect(() => requirePublicationTexturePreviewMode("color", mode))
        .toThrow("PUBLICATION_TEXTURE_PREVIEW_MODE_UNSUPPORTED");
    }
  });
});
