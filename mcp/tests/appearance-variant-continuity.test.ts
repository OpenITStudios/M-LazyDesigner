import { describe, expect, test } from "bun:test";
import {
  reviewBedrockAppearanceVariantContinuity,
  type AppearanceVariantContinuityInput,
  type AppearanceVariantSnapshot,
} from "@/lib/texture/appearanceVariantContinuity";

const h = (c: string) => "sha256:" + c.repeat(64);
function rig() {
  return [
    { uuid: "root", name: "body", parent_uuid: null, pivot: [0, 0, 0] as [number,number,number] },
    { uuid: "head", name: "head", parent_uuid: "root", pivot: [0, 12, 0] as [number,number,number] },
  ];
}
function snap(): AppearanceVariantSnapshot {
  return {
    geometry_identifier: "geometry.golem",
    uv_mapping_sha256: h("a"),
    bones: rig(),
    material_code: "entity",
  };
}
function sample(
  change: Partial<AppearanceVariantContinuityInput> = {}
): AppearanceVariantContinuityInput {
  const texture = {
    uuid: "base-tex", name: "base", width: 64, height: 64,
    role: "base_color_candidate" as const,
  };
  return {
    expected_project_uuid: "golem-project",
    entity_identifier: "demo:golem",
    texture_create: {
      source: texture,
      base_color_candidates: [texture],
      target_group: { uuid: "variants", name: "Color Variants", is_material: false },
      requested_name: "crimson_golem",
      existing_texture_names: ["base"],
    },
    mode: "TEXTURE_ONLY",
    baseline: snap(),
    proposed: { ...snap(), bitmap_width: 64, bitmap_height: 64 },
    render: {
      controller_identifier: "controller.render.golem",
      base_texture_slot: "default",
      variant_texture_slot: "crimson",
      base_geometry_slot: "default",
      base_material_slot: "default",
    },
    source_refs: ["approved:golem"],
    ...change,
  };
}
const review = (v: AppearanceVariantContinuityInput) =>
  reviewBedrockAppearanceVariantContinuity(v);

describe("V1 source appearance variant continuity", () => {
  test("texture-only variant reuses the canonical base-atlas planner without native PASS", () => {
    const input = sample();
    const before = structuredClone(input);
    const result = review(input);
    expect(result.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(result.texture_creation).toMatchObject({
      source_texture_uuid: "base-tex",
      target_group_uuid: "variants",
      bitmap: { width: 64, height: 64 },
      resulting_role: "explicit_variant",
      preserves_base_role: true,
      mapping_contract: "same_bitmap_dimensions_and_existing_uv_mapping",
    });
    expect(result.changed).toEqual({
      geometry: false, uv_mapping: false, rig: false, material: false,
    });
    expect(result.candidate_render_references).toMatchObject({
      base_texture: "Texture.default", variant_texture: "Texture.crimson",
      base_geometry: "Geometry.default", variant_geometry: null,
      base_material: "Material.default", variant_material: null,
    });
    expect(result.issues).toEqual([]);
    expect(result.native_verified).toBe(false);
    expect(result.visual_verified).toBe(false);
    expect(result.minecraft_verified).toBe(false);
    expect(result.resource_pack_written).toBe(false);
    expect(input).toEqual(before);
  });

  test("texture-only variant refuses changed Geometry, UV, rig or material", () => {
    const changes = [
      { proposed: { ...snap(), geometry_identifier: "geometry.golem_alt",
        bitmap_width: 64, bitmap_height: 64 }, issue: "TEXTURE_ONLY_GEOMETRY_CHANGED" },
      { proposed: { ...snap(), uv_mapping_sha256: h("b"),
        bitmap_width: 64, bitmap_height: 64 }, issue: "TEXTURE_ONLY_UV_CHANGED" },
      { proposed: { ...snap(), bones: [
        rig()[0]!, { ...rig()[1]!, pivot: [0, 13, 0] as [number,number,number] },
      ], bitmap_width: 64, bitmap_height: 64 }, issue: "TEXTURE_ONLY_RIG_CHANGED" },
      { proposed: { ...snap(), material_code: "entity_alphatest",
        bitmap_width: 64, bitmap_height: 64 }, issue: "TEXTURE_ONLY_MATERIAL_CHANGED" },
    ];
    for (const { proposed, issue } of changes) {
      const result = review(sample({ proposed }));
      expect(result.state).toBe("BLOCKED_BY_DECLARED_CONTINUITY");
      expect(result.issues).toContain(issue);
      expect(result.visual_verified).toBe(false);
    }
  });

  test("material variants require deliberate changed material and distinct render slot", () => {
    const input = sample({
      mode: "MATERIAL_CHANGE",
      proposed: { ...snap(), material_code: "entity_alphatest",
        bitmap_width: 64, bitmap_height: 64 },
      render: { ...sample().render, variant_material_slot: "cutout" },
    });
    const result = review(input);
    expect(result.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(result.changed.material).toBe(true);
    expect(result.candidate_render_references.variant_material).toBe("Material.cutout");
    expect(result.warnings).toContain("MATERIAL_CHANGE_RENDER_REVIEW");
    expect(review(sample({ ...input, render: sample().render })).issues)
      .toContain("MATERIAL_VARIANT_RENDER_SLOT_REQUIRED");
    expect(review(sample({ mode: "MATERIAL_CHANGE" })).issues)
      .toContain("MATERIAL_VARIANT_NO_MATERIAL_CHANGE");
  });

  test("material-only variant cannot disguise Geometry/UV/rig changes", () => {
    const base = sample({
      mode: "MATERIAL_CHANGE",
      proposed: { ...snap(), material_code: "entity_alphatest",
        uv_mapping_sha256: h("b"),
        bitmap_width: 64, bitmap_height: 64 },
      render: { ...sample().render, variant_material_slot: "cutout" },
    });
    expect(review(base).issues).toContain("MATERIAL_VARIANT_UV_CHANGED");
    expect(review({
      ...base,
      proposed: { ...base.proposed,
        geometry_identifier: "geometry.other" },
    }).issues).toContain("MATERIAL_VARIANT_GEOMETRY_CHANGED");
    expect(review({
      ...base,
      proposed: { ...base.proposed, bones: [rig()[0]!] },
    }).issues).toContain("MATERIAL_VARIANT_RIG_CHANGED");
  });

  test("explicit geometry variant requires new Geometry id and distinct render slot", () => {
    const variant = sample({
      mode: "GEOMETRY_OVERRIDE",
      proposed: { ...snap(), geometry_identifier: "geometry.golem_damaged",
        bones: [rig()[0]!], uv_mapping_sha256: h("9"),
        bitmap_width: 64, bitmap_height: 64 },
      render: { ...sample().render, variant_geometry_slot: "damaged" },
    });
    const result = review(variant);
    expect(result.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(result.changed).toMatchObject({
      geometry: true, uv_mapping: true, rig: true,
    });
    expect(result.candidate_render_references.variant_geometry)
      .toBe("Geometry.damaged");
    expect(result.warnings).toContain("GEOMETRY_CHANGE_RIG_AND_UV_REVIEW");
    expect(result.native_verified).toBe(false);
    expect(review({ ...variant, render: sample().render }).issues)
      .toContain("GEOMETRY_VARIANT_RENDER_SLOT_REQUIRED");
    expect(review(sample({ mode: "GEOMETRY_OVERRIDE" })).issues)
      .toContain("GEOMETRY_VARIANT_REQUIRES_NEW_GEOMETRY_IDENTIFIER");
  });

  test("no silent texture bitmap rescale even when the declared geometry is unchanged", () => {
    const result = review(sample({
      proposed: { ...snap(), bitmap_width: 128, bitmap_height: 64 },
    }));
    expect(result.issues).toContain("VARIANT_BITMAP_DIMENSIONS_CHANGED");
    expect(result.state).toBe("BLOCKED_BY_DECLARED_CONTINUITY");
  });

  test("custom render material stays unverified instead of treated as vanilla", () => {
    const proposed = { ...snap(), material_code: "custom:glow",
      bitmap_width: 64, bitmap_height: 64 };
    const result = review(sample({
      mode: "MATERIAL_CHANGE", proposed,
      render: { ...sample().render, variant_material_slot: "glow" },
    }));
    expect(result.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(result.warnings).toContain("CUSTOM_RENDER_MATERIAL_UNVERIFIED");
    expect(result.minecraft_verified).toBe(false);
  });

  test("rig inventory rejects duplicate, orphaned, cyclic and nonfinite authored pivots", () => {
    for (const bones of [
      [rig()[0]!, { ...rig()[0]!, uuid: "another" }],
      [rig()[0]!, { ...rig()[1]!, parent_uuid: "missing" }],
      [{ ...rig()[0]!, parent_uuid: "head" }, rig()[1]!],
      [rig()[0]!, { ...rig()[1]!, pivot: [0, NaN, 0] as [number,number,number] }],
    ]) {
      expect(() => review(sample({
        baseline: { ...snap(), bones },
      }))).toThrow(/APPEARANCE_VARIANT_RIG/);
    }
  });

  test("reuses canonical texture creation guards against extra base and material group", () => {
    const original = sample().texture_create;
    expect(() => review(sample({
      texture_create: { ...original,
        base_color_candidates: [original.source, original.source] },
    }))).toThrow("exactly one established base-color");
    expect(() => review(sample({
      texture_create: { ...original,
        target_group: { ...original.target_group, is_material: true } },
    }))).toThrow("non-material TextureGroup");
    expect(() => review(sample({
      texture_create: { ...original, requested_name: "bad name " },
    }))).toThrow("APPEARANCE_VARIANT_TEXTURE_SOURCE_INVALID");
  });

  test("render slots and identifiers cannot be ambiguous or silently normalized", () => {
    expect(() => review(sample({
      render: { ...sample().render, variant_texture_slot: "default" },
    }))).toThrow("APPEARANCE_VARIANT_TEXTURE_SLOT_AMBIGUOUS");
    expect(() => review(sample({
      render: { ...sample().render, controller_identifier: "not_controller" },
    }))).toThrow("APPEARANCE_VARIANT_RENDER_CONTROLLER_INVALID");
    expect(() => review(sample({
      proposed: { ...snap(), geometry_identifier: "geometry.bad name",
        bitmap_width: 64, bitmap_height: 64 },
    }))).toThrow("APPEARANCE_VARIANT_GEOMETRY_IDENTIFIER_INVALID");
    expect(() => review(sample({
      baseline: { ...snap(), uv_mapping_sha256: "not-a-hash" },
    }))).toThrow("APPEARANCE_VARIANT_FINGERPRINT_INVALID");
    expect(() => review(sample({
      source_refs: ["same", "same"],
    }))).toThrow("APPEARANCE_VARIANT_SOURCE_REFS_INVALID");
  });

  test("fingerprint is order-independent for equivalent rig rows but changes on source edits", () => {
    const input = sample();
    const first = review(input).source_fingerprint;
    const reversed = review({
      ...input,
      baseline: { ...input.baseline, bones: [...input.baseline.bones].reverse() },
      proposed: { ...input.proposed, bones: [...input.proposed.bones].reverse() },
    });
    expect(reversed.source_fingerprint).toBe(first);
    expect(review({
      ...input,
      proposed: { ...input.proposed, bones: [
        rig()[0]!, { ...rig()[1]!, pivot: [1, 12, 0] },
      ] },
    }).source_fingerprint).not.toBe(first);
    expect(review({
      ...input,
      texture_create: { ...input.texture_create,
        requested_name: "azure_golem" },
    }).source_fingerprint).not.toBe(first);
  });

  test("V1 is a review-only consumer, not a new texture variant or render writer", async () => {
    const src = await Bun.file("lib/texture/appearanceVariantContinuity.ts").text();
    expect(src).toContain("planTextureVariantFromBase(input.texture_create)");
    expect(src).toContain("inspectEntityRenderMaterialCode(");
    expect(src).not.toContain("createTool(");
    expect(src).not.toContain("Undo.");
    expect(src).not.toContain("writeFile");
  });
});
