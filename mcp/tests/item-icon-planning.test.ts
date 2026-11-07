import { describe, expect, test } from "bun:test";
import {
  planBedrockItemIcon,
  type ItemIconPlanningInput,
} from "@/lib/texture/itemIconPlanning";

function bitmap(
  width: number, height: number,
  pixel: (x: number, y: number) => [number, number, number, number]
): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return data;
}
function sample(change: Partial<ItemIconPlanningInput> = {}): ItemIconPlanningInput {
  const rgba = bitmap(16, 16, (x, y) =>
    x >= 4 && x < 12 && y >= 3 && y < 13
      ? [80, 160, 245, 255] : [0, 0, 0, 0]
  );
  return {
    item_identifier: "demo:runic_gem",
    atlas_key: "demo:runic_gem",
    texture_path: "textures/items/runic_gem",
    existing_atlas_entries: [],
    target_mode: "MINECRAFT_NATIVE",
    alpha_intent: "TRANSPARENT",
    width: 16,
    height: 16,
    rgba,
    source_refs: ["approved:front"],
    ...change,
  };
}

describe("I1 Item Icon / Sprite source-only handoff", () => {
  test("valid transparent item icon returns bounded atlas hint but not production PASS", () => {
    const input = sample();
    const originalPixels = [...input.rgba];
    const result = planBedrockItemIcon(input);
    expect(result.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(result.atlas_entry).toEqual({
      key: "demo:runic_gem", texture_path: "textures/items/runic_gem",
    });
    expect(result.minecraft_icon_candidate).toEqual({
      textures: { default: "demo:runic_gem" },
    });
    expect(result.proposed_png_path).toBe("textures/items/runic_gem.png");
    expect(result.canvas).toMatchObject({
      width: 16, height: 16, pixel_count: 256,
      visible_pixels: 80, transparent_pixels: 176, partial_alpha_pixels: 0,
      unique_visible_rgb_colors: 1,
      visible_bounds: { min_x: 4, min_y: 3, max_x: 11, max_y: 12 },
    });
    expect(result.pixel_craft.state).toBe("available");
    expect(result.visual_verified).toBe(false);
    expect(result.minecraft_verified).toBe(false);
    expect(result.png_encoded).toBe(false);
    expect(result.atlas_writes_performed).toBe(false);
    expect(input.rgba).toEqual(Uint8Array.from(originalPixels));
  });

  test("atlas identity accepts exact namespaced keys but rejects already owned keys", () => {
    const collision = planBedrockItemIcon(sample({
      existing_atlas_entries: [
        { key: "demo:runic_gem", texture_path: "textures/items/previous_gem" },
      ],
    }));
    expect(collision.state).toBe("BLOCKED_BY_DECLARED_SOURCE");
    expect(collision.issues).toContain("ATLAS_KEY_ALREADY_OWNED");
    expect(collision.warnings).toContain("ATLAS_INVENTORY_NATIVE_UNVERIFIED");
    expect(() => planBedrockItemIcon(sample({
      existing_atlas_entries: [
        { key: "other:key", texture_path: "textures/items/a" },
        { key: "other:key", texture_path: "textures/items/b" },
      ],
    }))).toThrow("ITEM_ICON_ATLAS_INVENTORY_AMBIGUOUS");
  });

  test("new PNG path cannot overwrite an incumbent atlas path under another key", () => {
    for (const occupied of [
      "textures/items/runic_gem", "textures/items/runic_gem.png",
    ]) {
      const input = sample({ existing_atlas_entries: [
        { key: "other:shared_key", texture_path: occupied },
      ] });
      const original = structuredClone({ ...input, rgba: Array.from(input.rgba) });
      const planned = planBedrockItemIcon(input);
      expect(planned.state).toBe("BLOCKED_BY_DECLARED_SOURCE");
      expect(planned.issues).toContain("TEXTURE_PATH_ALREADY_OWNED");
      expect(planned.issues).not.toContain("ATLAS_KEY_ALREADY_OWNED");
      expect(planned.atlas_writes_performed).toBe(false);
      expect({ ...input, rgba: Array.from(input.rgba) }).toEqual(original);
    }
    // Preexisting aliases are legitimate; do not reject an unrelated new path.
    const unrelated = planBedrockItemIcon(sample({ existing_atlas_entries: [
      { key: "other:icon_a", texture_path: "textures/items/shared" },
      { key: "other:icon_b", texture_path: "textures/items/shared" },
    ] }));
    expect(unrelated.issues).toEqual([]);
    expect(unrelated.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
  });

  test("relative texture path must remain under items, with no traversal or extension", () => {
    for (const texture_path of [
      "/textures/items/a",
      "textures/entity/a",
      "textures/items/../other",
      "textures/items/a.png",
      "textures/items//a",
      "textures/items/a\\b",
    ]) {
      expect(() => planBedrockItemIcon(sample({ texture_path }))).toThrow();
    }
    expect(() => planBedrockItemIcon(sample({
      texture_path: "textures/items/weapons/blue_sword",
    }))).not.toThrow();
    expect(() => planBedrockItemIcon(sample({
      item_identifier: "demo:../unsafe",
    }))).toThrow("ITEM_ICON_ITEM_IDENTIFIER_INVALID");
    expect(() => planBedrockItemIcon(sample({
      atlas_key: "demo:../icon",
    }))).toThrow("ITEM_ICON_ATLAS_KEY_INVALID");
  });

  test("RGBA dimensions must be exact and pixels strictly byte-valued", () => {
    expect(() => planBedrockItemIcon(sample({
      rgba: new Uint8Array(16 * 16 * 4 - 1),
    }))).toThrow("ITEM_ICON_RGBA_BUFFER_SIZE_INVALID");
    expect(() => planBedrockItemIcon(sample({
      width: 0,
    }))).toThrow("ITEM_ICON_CANVAS_INVALID_OR_OVER_BUDGET");
    expect(() => planBedrockItemIcon(sample({
      width: 257,
    }))).toThrow("ITEM_ICON_CANVAS_INVALID_OR_OVER_BUDGET");
    for (const broken of [256, -1, 1.5, Number.NaN, Infinity]) {
      const rgba = [...sample().rgba];
      rgba[0] = broken;
      expect(() => planBedrockItemIcon(sample({ rgba })))
        .toThrow("ITEM_ICON_RGBA_COMPONENT_INVALID");
    }
  });

  test("fully transparent bitmap cannot masquerade as an authored icon", () => {
    const result = planBedrockItemIcon(sample({
      rgba: new Uint8Array(16 * 16 * 4),
    }));
    expect(result.state).toBe("BLOCKED_BY_DECLARED_SOURCE");
    expect(result.issues).toContain("ITEM_ICON_EMPTY_BITMAP");
    expect(result.canvas.visible_bounds).toBeNull();
  });

  test("explicit alpha policy cannot be silently contradicted", () => {
    const opaque = bitmap(16, 16, () => [120, 90, 40, 255]);
    expect(planBedrockItemIcon(sample({ rgba: opaque })).issues)
      .toContain("ALPHA_INTENT_CONFLICT");
    expect(planBedrockItemIcon(sample({
      alpha_intent: "OPAQUE",
    })).issues).toContain("ALPHA_INTENT_CONFLICT");
    expect(planBedrockItemIcon(sample({
      alpha_intent: "OPAQUE", rgba: opaque,
    })).issues).toEqual([]);
    expect(planBedrockItemIcon(sample({
      alpha_intent: "FLEXIBLE", rgba: opaque,
    })).issues).toEqual([]);
  });

  test("half-alpha edges and hidden RGB are review warnings, not automatic pixel deletion", () => {
    const rgba = bitmap(16, 16, (x,y) =>
      x === 0 && y === 0 ? [240, 20, 20, 127] :
      x === 1 && y === 0 ? [255, 0, 0, 0] : [0,0,0,0]
    );
    const result = planBedrockItemIcon(sample({ rgba }));
    expect(result.warnings).toContain("ALPHA_FRINGE_REVIEW");
    expect(result.warnings).toContain("HIDDEN_RGB_ON_TRANSPARENT_PIXELS_REVIEW");
    expect(result.warnings).toContain("VISIBLE_PIXELS_TOUCH_CANVAS_EDGE");
    expect(result.canvas.partial_alpha_pixels).toBe(1);
    expect(result.canvas.hidden_rgb_transparent_pixels).toBe(1);
    expect(result.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(rgba[3]).toBe(127);
  });

  test("reuses PixelCraft cluster diagnostics instead of manufacturing a style score", () => {
    const noisy = bitmap(16, 16, (x, y) =>
      (x + y) % 2 ? [0, 0, 220, 255] : [220, 0, 0, 255]
    );
    const result = planBedrockItemIcon(sample({
      rgba: noisy, alpha_intent: "FLEXIBLE",
    }));
    expect(result.pixel_craft.state).toBe("available");
    if (result.pixel_craft.state !== "available") throw Error("expected PixelCraft");
    expect(result.pixel_craft.review_hints).toContain(
      "HIGH_TINY_CLUSTER_FRAGMENTATION"
    );
    expect(result.pixel_craft.visual_verdict).toBe("not_evaluated");
    expect(result.visual_verified).toBe(false);
  });

  test("larger images retain honest PixelCraft unavailable status", () => {
    const larger = planBedrockItemIcon(sample({
      width: 256, height: 256,
      rgba: bitmap(256, 256, (x,y) =>
        x >= 20 && x < 236 && y >= 20 && y < 236
          ? [120, 40, 100, 255] : [0,0,0,0]
      ),
    }));
    expect(larger.pixel_craft.state).toBe("unavailable");
    expect(larger.warnings).toContain("PIXEL_CRAFT_FOCUSED_REGION_REQUIRED");
    expect(larger.visual_verified).toBe(false);
  });

  test("source fingerprint changes with pixels and keys, not inventory input order", () => {
    const source = sample({
      existing_atlas_entries: [
        { key: "old_a", texture_path: "textures/items/a" },
        { key: "old_b", texture_path: "textures/items/b" },
      ],
    });
    const first = planBedrockItemIcon(source);
    const same = planBedrockItemIcon({
      ...source, existing_atlas_entries: [...source.existing_atlas_entries].reverse(),
      source_refs: [...source.source_refs].reverse(),
    });
    expect(same.source_fingerprint).toBe(first.source_fingerprint);
    const pixels = Uint8Array.from(source.rgba);
    pixels[(4 * 16 + 4) * 4] = 240;
    const edited = planBedrockItemIcon({ ...source, rgba: pixels });
    expect(edited.bitmap_sha256).not.toBe(first.bitmap_sha256);
    expect(edited.source_fingerprint).not.toBe(first.source_fingerprint);
    expect(planBedrockItemIcon({
      ...source, atlas_key: "demo:other_gem",
    }).source_fingerprint).not.toBe(first.source_fingerprint);
  });

  test("source refs and style lock remain caller assertions, not artistic approval", () => {
    expect(() => planBedrockItemIcon(sample({
      source_refs: [],
    }))).toThrow("ITEM_ICON_SOURCE_REFS_INVALID");
    expect(() => planBedrockItemIcon(sample({
      source_refs: ["same", "same"],
    }))).toThrow("ITEM_ICON_SOURCE_REFS_INVALID");
    const result = planBedrockItemIcon(sample({
      style_lock_id: "series:gem_items",
    }));
    expect(result.warnings).toContain("STYLE_LOCK_VISUAL_COMPARISON_REQUIRED");
    expect(result.warnings).toContain("PIXEL_GRID_AUTHORING_NOT_ATTESTED");
    expect(result.warnings).toContain("NATIVE_SIZE_READABILITY_REVIEW_REQUIRED");
  });
});
