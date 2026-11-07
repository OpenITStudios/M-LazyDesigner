import { describe, expect, test } from "bun:test";
import {
  planBedrockClassicSkin,
  type ClassicSkinPlanningInput,
} from "@/lib/texture/classicSkinPlanning";

function blank(): Uint8Array {
  return new Uint8Array(64 * 64 * 4);
}
function pixel(bytes: Uint8Array, x: number, y: number,
  rgba: [number, number, number, number] = [120, 80, 60, 255]) {
  bytes.set(rgba, (y * 64 + x) * 4);
  return bytes;
}
function painted(): Uint8Array {
  const out = blank();
  // Actual head front (not the entire 32x16 UV envelope).
  for (let y = 8; y < 16; y++) {
    for (let x = 8; x < 16; x++) pixel(out, x, y);
  }
  // Torso front face.
  for (let y = 20; y < 32; y++) {
    for (let x = 20; x < 28; x++) pixel(out, x, y);
  }
  return out;
}
function sample(change: Partial<ClassicSkinPlanningInput> = {}):
  ClassicSkinPlanningInput {
  return {
    body_profile: "STEVE_WIDE",
    pack_localization_name: "AdventureSkins",
    skin_localization_name: "RunicGolem",
    texture_filename: "runic_golem.png",
    skin_type: "free",
    width: 64,
    height: 64,
    rgba: painted(),
    existing_skins: [],
    source_refs: ["approved:front"],
    ...change,
  };
}
const plan = (v: ClassicSkinPlanningInput) => planBedrockClassicSkin(v);

describe("S1 classic player 64x64 source-only skin authoring", () => {
  test("modern Steve model uses exact root PNG and skins.json candidate, no pack PASS", () => {
    const input = sample();
    const before = Uint8Array.from(input.rgba);
    const r = plan(input);
    expect(r.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(r.arm_width_pixels).toBe(4);
    expect(r.model_geometry).toBe("geometry.humanoid.custom");
    expect(r.candidate_skins_json_entry).toEqual({
      localization_name: "RunicGolem",
      geometry: "geometry.humanoid.custom",
      texture: "runic_golem.png",
      type: "free",
    });
    expect(r.candidate_localization_key)
      .toBe("skin.AdventureSkins.RunicGolem");
    expect(r.canvas.mapped_visible_pixels).toBe(64 + 96);
    expect(r.pixel_craft.state).toBe("available");
    expect(r.native_verified).toBe(false);
    expect(r.visual_verified).toBe(false);
    expect(r.minecraft_verified).toBe(false);
    expect(r.png_encoded).toBe(false);
    expect(r.skin_pack_written).toBe(false);
    expect(input.rgba).toEqual(before);
  });

  test("Alex is a 3px arm geometry, not a guessed image-only conversion", () => {
    const a = plan(sample({ body_profile: "ALEX_SLIM" }));
    expect(a.model_geometry).toBe("geometry.humanoid.customSlim");
    expect(a.arm_width_pixels).toBe(3);
    expect(a.canvas.slim_unused_arm_visible_pixels).toBe(0);
    const colored = painted();
    pixel(colored, 54, 20); // wide arm last two columns, unused in slim
    const slim = plan(sample({ body_profile: "ALEX_SLIM", rgba: colored }));
    expect(slim.canvas.slim_unused_arm_visible_pixels).toBe(1);
    expect(slim.warnings).toContain("SLIM_ARM_UNUSED_COLUMNS_REVIEW");
    const wide = plan(sample({ rgba: colored }));
    expect(wide.canvas.slim_unused_arm_visible_pixels).toBe(0);
    expect(slim.source_fingerprint).not.toBe(wide.source_fingerprint);
  });

  test("base face and corresponding overlay face are separately accounted", () => {
    const skin = painted();
    pixel(skin, 40, 8, [80, 220, 80, 127]); // hat front
    const r = plan(sample({ rgba: skin }));
    const head = r.parts.find(p => p.part === "head")!;
    expect(head.base_visible_pixels).toBe(64);
    expect(head.overlay_visible_pixels).toBe(1);
    expect(head.overlay_partial_alpha_pixels).toBe(1);
    expect(r.canvas.overlay_visible_pixels).toBe(1);
    expect(r.warnings).toContain("PARTIAL_ALPHA_BEDROCK_RENDER_REVIEW");
  });

  test("UV masks include six body parts, not whole rectangles of unused texels", () => {
    const allOpaque = new Uint8Array(64 * 64 * 4);
    for (let i = 3; i < allOpaque.length; i += 4) allOpaque[i] = 255;
    const steve = plan(sample({ rgba: allOpaque }));
    expect(steve.parts.map(p => p.part)).toEqual([
      "head", "body", "right_arm", "left_arm", "right_leg", "left_leg",
    ]);
    expect(steve.parts.every(p => p.base_visible_pixels > 0)).toBe(true);
    expect(steve.parts.every(p => p.overlay_visible_pixels > 0)).toBe(true);
    expect(steve.canvas.unused_visible_pixels).toBeGreaterThan(0);
    expect(steve.warnings).toContain("UNUSED_TEMPLATE_PIXEL_REVIEW");
    const alex = plan(sample({ body_profile: "ALEX_SLIM", rgba: allOpaque }));
    expect(alex.canvas.base_mapped_pixels)
      .toBeLessThan(steve.canvas.base_mapped_pixels);
  });

  test("base and overlay transparency are reviewed, not Java-specific hard-blocked", () => {
    const skin = blank();
    pixel(skin, 8, 8, [60, 40, 200, 80]);
    pixel(skin, 40, 8, [200, 60, 90, 200]);
    const r = plan(sample({ rgba: skin }));
    expect(r.warnings).toContain("BASE_SURFACE_TRANSPARENCY_REVIEW");
    expect(r.warnings).toContain("BASE_PART_COMPLETELY_TRANSPARENT_REVIEW");
    expect(r.warnings).toContain("PARTIAL_ALPHA_BEDROCK_RENDER_REVIEW");
    expect(r.issues).toEqual([]);
    expect(r.visual_verified).toBe(false);
  });

  test("all-mapped-transparent bitmap cannot become an authored skin PASS", () => {
    const out = plan(sample({ rgba: blank() }));
    expect(out.state).toBe("BLOCKED_BY_DECLARED_SOURCE");
    expect(out.issues).toContain("SKIN_HAS_NO_MAPPED_VISIBLE_PIXELS");
    const unusedOnly = blank();
    pixel(unusedOnly, 1, 1); // unused top corner of head UV
    expect(plan(sample({ rgba: unusedOnly })).issues)
      .toContain("SKIN_HAS_NO_MAPPED_VISIBLE_PIXELS");
  });

  test("legacy 64x32 and HD 128x128 must use separate future profile", () => {
    for (const size of [[64, 32], [128, 128], [32, 64], [0, 64]]) {
      expect(() => plan(sample({ width: size[0]!, height: size[1]! })))
        .toThrow("CLASSIC_SKIN_MODERN_64_ONLY");
    }
    expect(() => plan(sample({ body_profile: "persona" as "STEVE_WIDE" })))
      .toThrow("CLASSIC_SKIN_PROFILE_UNSUPPORTED");
  });

  test("RGBA length, component and missing source data fail closed", () => {
    expect(() => plan(sample({ rgba: new Uint8Array(4) })))
      .toThrow("CLASSIC_SKIN_RGBA_LENGTH_INVALID");
    for (const value of [-1, 256, NaN, Infinity, 1.5]) {
      const arr = [...painted()];
      arr[0] = value;
      expect(() => plan(sample({ rgba: arr })))
        .toThrow("CLASSIC_SKIN_RGBA_COMPONENT_INVALID");
    }
    expect(() => plan(sample({ rgba: null as unknown as Uint8Array })))
      .toThrow("CLASSIC_SKIN_RGBA_LENGTH_INVALID");
  });

  test("root PNG filename and localization identity have no path/alias fallbacks", () => {
    for (const texture_filename of [
      "../skin.png", "folder/skin.png", "Skin.PNG",
      "skin.jpg", "skin.png.png", " skin.png", "a\\b.png",
    ]) {
      expect(() => plan(sample({ texture_filename }))).toThrow();
    }
    expect(() => plan(sample({ pack_localization_name: "Pack Name" })))
      .toThrow("CLASSIC_SKIN_LOCALIZATION_INVALID");
    expect(() => plan(sample({ skin_type: "premium" as "free" })))
      .toThrow("CLASSIC_SKIN_TYPE_INVALID");
    expect(plan(sample({ skin_type: "paid" }))
      .candidate_skins_json_entry.type).toBe("paid");
  });

  test("skin localization collision is blocked, filename reuse is a review", () => {
    const prior = [{
      localization_name: "OtherSkin",
      texture: "runic_golem.png",
      geometry: "geometry.humanoid.custom",
    }];
    const a = plan(sample({ existing_skins: prior }));
    expect(a.warnings).toContain("SHARED_TEXTURE_FILENAME_REVIEW");
    expect(a.issues).toEqual([]);
    const duplicate = plan(sample({
      existing_skins: [{ ...prior[0]!, localization_name: "RunicGolem" }],
    }));
    expect(duplicate.issues).toContain("SKIN_LOCALIZATION_NAME_ALREADY_PRESENT");
    expect(() => plan(sample({
      existing_skins: [prior[0]!, prior[0]!],
    }))).toThrow("CLASSIC_SKIN_INVENTORY_AMBIGUOUS");
  });

  test("PixelCraft remains the single bounded pixel analyzer, never a visual verdict", () => {
    const r = plan(sample());
    expect(r.pixel_craft.state).toBe("available");
    if (r.pixel_craft.state !== "available") throw Error("Expected PixelCraft");
    expect(r.pixel_craft.visual_verdict).toBe("not_evaluated");
    expect(r.warnings).toContain("UV_FACE_ORIENTATION_NOT_ATTESTED");
    expect(r.warnings).toContain("BODY_PROFILE_NATIVE_PREVIEW_REQUIRED");
    expect(r.visual_verified).toBe(false);
  });

  test("fingerprints bind actual pixels, slim geometry and metadata, not inventory order", () => {
    const base = sample({ source_refs: ["front", "side"],
      existing_skins: [
        { localization_name: "First", texture: "first.png",
          geometry: "geometry.humanoid.custom" },
        { localization_name: "Second", texture: "second.png",
          geometry: "geometry.humanoid.customSlim" },
      ],
    });
    const a = plan(base);
    const rearranged = plan({
      ...base, source_refs: [...base.source_refs].reverse(),
      existing_skins: [...base.existing_skins].reverse(),
    });
    expect(rearranged.source_fingerprint).toBe(a.source_fingerprint);
    const newPixels = Uint8Array.from(base.rgba);
    pixel(newPixels, 8, 8, [1, 2, 3, 255]);
    expect(plan({ ...base, rgba: newPixels }).bitmap_sha256)
      .not.toBe(a.bitmap_sha256);
    expect(plan({ ...base, body_profile: "ALEX_SLIM" })
      .source_fingerprint).not.toBe(a.source_fingerprint);
    expect(plan({ ...base, skin_localization_name: "OtherGolem" })
      .source_fingerprint).not.toBe(a.source_fingerprint);
  });

  test("source-only classic skin tool never writes packs or creates a second stage", async () => {
    const src = await Bun.file("lib/texture/classicSkinPlanning.ts").text();
    expect(src).toContain("analyzeTexturePixelCraft(bitmap, SIZE, SIZE)");
    expect(src).toContain("candidate_skins_json_entry");
    expect(src).not.toContain("createTool(");
    expect(src).not.toContain("Undo.");
    expect(src).not.toContain("writeFile");
  });
});
