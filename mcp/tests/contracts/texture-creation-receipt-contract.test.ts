import { describe, expect, test } from "bun:test";
import {
  isTextureCreationReceipt,
  textureCreationReceiptSchema,
  textureVariantCreationReceiptSchema,
} from "@/lib/receipts/textureCreation";
import {
  planTextureVariantFromBase,
  textureVariantPlanReceiptSchema,
} from "@/lib/texture/variantPlan";

describe("create_texture native identity receipt", () => {
  const observed = {
    texture: {
      uuid: "texture-a",
      name: "base.png",
      bitmap: { width: 64, height: 64, display_height: 64 },
      logical_uv: { width: 64, height: 64 },
    },
  };

  test("accepts blank/template producer's texture inventory shape", () => {
    expect(isTextureCreationReceipt(observed)).toBe(true);
    expect(textureCreationReceiptSchema.parse(observed).texture.uuid)
      .toBe("texture-a");
  });

  test("Runtime variant has a different, explicitly validated result shape", () => {
    const plan = planTextureVariantFromBase({
      source: {
        uuid: "base-uuid", name: "atlas.png", width: 64,
        height: 64, role: "base_color_candidate",
      },
      base_color_candidates: [{
        uuid: "base-uuid", name: "atlas.png", width: 64,
        height: 64, role: "base_color_candidate",
      }],
      target_group: {
        uuid: "variants", name: "Variants", is_material: false,
      },
      requested_name: "body_alt.png",
      existing_texture_names: ["atlas.png"],
    });
    expect(textureVariantPlanReceiptSchema.safeParse(plan).success).toBe(true);

    const variant = {
      texture: {
        uuid: "variant-uuid", name: "body_alt.png",
        width: 64, height: 64, group: "variants", pbr_channel: "color",
      },
      variant_creation: plan,
    };
    expect(isTextureCreationReceipt(variant, "variant")).toBe(true);
    expect(textureVariantCreationReceiptSchema.safeParse(variant).success).toBe(true);
    // Backward compatible for previous runtime receipts lacking the optional
    // native precommit reconciliation; never force a fabricated PASS field.
    expect(textureVariantCreationReceiptSchema.parse(variant)
      .variant_native_continuity).toBeUndefined();
    expect(isTextureCreationReceipt(variant, "template")).toBe(false);
    expect(isTextureCreationReceipt(observed, "variant")).toBe(false);
    for (const changed of [
      { ...variant, texture: { ...variant.texture, uuid: "base-uuid" } },
      { ...variant, texture: { ...variant.texture, height: 32 } },
      { ...variant, texture: { ...variant.texture, group: "wrong-group" } },
      { ...variant, texture: { ...variant.texture, name: "wrong-name" } },
      { ...variant, variant_creation: { ...plan, resulting_role: "pbr_support" } },
      { ...variant, variant_creation: { ...plan, preserves_base_role: false } },
    ]) {
      expect(isTextureCreationReceipt(changed, "variant")).toBe(false);
    }
    expect(isTextureCreationReceipt({
      ...observed, variant_creation: {invalid: true},
    }, "blank")).toBe(false);
  });

  test("rejects a success label, absent native identity or unreadable bitmap", () => {
    for (const value of [
      undefined,
      { status: "success" },
      { texture: { name: "base.png", bitmap: { width: 64, height: 64 } } },
      { texture: { uuid: "texture-a", name: "", bitmap: { width: 64, height: 64 } } },
      { texture: { uuid: "texture-a", name: "base.png" } },
      { texture: { uuid: "texture-a", name: "base.png", bitmap: { width: 0, height: 64 } } },
      { texture: { uuid: "texture-a", name: "base.png", bitmap: { width: Infinity, height: 64 } } },
    ]) {
      expect(isTextureCreationReceipt(value)).toBe(false);
    }
  });

  test("native blank and template paths both report textureInventoryEntry", async () => {
    const producer = await Bun.file("server/tools/texture/create.ts").text();
    expect(producer).toContain("textureInventoryEntry(templateTexture)");
    expect(producer).toContain("textureInventoryEntry(texture)");
    const extension = await Bun.file("server/runtime/contracts/texture.ts").text();
    expect(extension).toContain("createDefinition.parameterSchema = wiredCreateTextureParameters");
    expect(extension).toContain("variant_creation: plan");
  });
});
