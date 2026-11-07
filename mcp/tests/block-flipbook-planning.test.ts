import { describe, expect, test } from "bun:test";
import {
  planBedrockBlockFlipbook,
  type BlockFlipbookPlanningInput,
} from "@/lib/texture/blockFlipbookPlanning";

function strip(size = 16, frames = 3): Uint8Array {
  const data = new Uint8Array(size * size * frames * 4);
  for (let frame = 0; frame < frames; frame++) {
    for (let pixel = 0; pixel < size * size; pixel++) {
      const offset = (frame * size * size + pixel) * 4;
      data.set([30 + frame * 50, 80 + frame * 20, 200 - frame * 50, 255], offset);
    }
  }
  return data;
}

function sample(
  changes: Partial<BlockFlipbookPlanningInput> = {}
): BlockFlipbookPlanningInput {
  return {
    target_bedrock_version: "1.21.100",
    flipbook_texture: "textures/blocks/runic_rune",
    frame_size: 16,
    strip_width: 16,
    strip_height: 48,
    rgba: strip(),
    frame_order: [2, 1, 0, 1],
    ticks_per_frame: 5,
    blend_frames: false,
    target: { atlas_tile: "runic_rune" },
    terrain_tiles: [{
      atlas_tile: "runic_rune",
      texture_paths: ["textures/blocks/runic_rune"],
    }],
    existing_flipbooks: [],
    source_refs: ["approved:rune"],
    ...changes,
  };
}

describe("T1 Bedrock animated block texture strip/flipbook handoff", () => {
  test("vertical strip, explicit reverse/repeat playback and timing are source review only", () => {
    const input = sample();
    const sourceBefore = Uint8Array.from(input.rgba);
    const result = planBedrockBlockFlipbook(input);
    expect(result.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
    expect(result.proposed_json_path).toBe("textures/flipbook_textures.json");
    expect(result.candidate_flipbook_entry).toEqual({
      flipbook_texture: "textures/blocks/runic_rune",
      atlas_tile: "runic_rune",
      frames: [2, 1, 0, 1],
      ticks_per_frame: 5,
      blend_frames: false,
    });
    expect(result.strip.physical_frame_count).toBe(3);
    expect(result.strip.frame_sha256).toHaveLength(3);
    expect(result.playback.duration_ticks).toBe(20);
    expect(result.playback.duration_seconds).toBe(1);
    expect(result.playback.distinct_frame_count).toBe(3);
    expect(result.playback.loop_wrap.from_frame).toBe(1);
    expect(result.playback.loop_wrap.to_frame).toBe(2);
    expect(result.playback.loop_wrap.changed_visible_pixel_count).toBe(256);
    expect(result.native_verified).toBe(false);
    expect(result.visual_verified).toBe(false);
    expect(result.minecraft_verified).toBe(false);
    expect(result.png_encoded).toBe(false);
    expect(result.resource_pack_written).toBe(false);
    expect(input.rgba).toEqual(sourceBefore);
  });

  test("source strip must contain complete vertical square frames, not a grid", () => {
    for (const changes of [
      { strip_width: 32 },
      { strip_height: 50 },
      { frame_size: 32 },
      { strip_height: 16 },
    ]) {
      expect(() => planBedrockBlockFlipbook(sample(changes))).toThrow();
    }
    expect(() => planBedrockBlockFlipbook(sample({
      strip_width: 128, frame_size: 128,
      strip_height: 128 * 17,
    }))).toThrow("BLOCK_FLIPBOOK_STRIP_BUDGET_INVALID");
  });

  test("frame order accepts holds/reverse, but never out-of-range indices", () => {
    const held = planBedrockBlockFlipbook(sample({
      frame_order: [0, 0, 2, 1, 2, 1],
    }));
    expect(held.warnings).toContain("REPEATED_ADJACENT_FRAMES_REVIEW");
    expect(held.candidate_flipbook_entry.frames).toEqual([0, 0, 2, 1, 2, 1]);
    const still = planBedrockBlockFlipbook(sample({
      frame_order: [1, 1, 1],
    }));
    expect(still.warnings).toContain("ONE_DISTINCT_PLAYBACK_FRAME_REVIEW");
    expect(still.warnings).toContain("UNREFERENCED_STRIP_FRAMES");
    for (const order of [[], [0, 3], [2, -1], [0, 1.5], [NaN], [Infinity]]) {
      expect(() => planBedrockBlockFlipbook(sample({
        frame_order: order,
      }))).toThrow();
    }
  });

  test("ticks are integer 20 Hz and blend is deliberate, not an inferred default", () => {
    for (const ticks_per_frame of [0, -1, 1.5, Infinity, NaN, 1201]) {
      expect(() => planBedrockBlockFlipbook(sample({
        ticks_per_frame,
      }))).toThrow("BLOCK_FLIPBOOK_NUMBER_INVALID");
    }
    expect(() => planBedrockBlockFlipbook(sample({
      blend_frames: undefined as unknown as boolean,
    }))).toThrow("BLOCK_FLIPBOOK_BLEND_MODE_INVALID");
    const blended = planBedrockBlockFlipbook(sample({
      blend_frames: true, replicate: 2,
    }));
    expect(blended.candidate_flipbook_entry).toMatchObject({
      blend_frames: true, replicate: 2,
    });
    expect(blended.warnings).toContain("BLENDED_PIXEL_FRAMES_REVIEW");
    expect(() => planBedrockBlockFlipbook(sample({
      replicate: 0,
    }))).toThrow("BLOCK_FLIPBOOK_NUMBER_INVALID");
  });

  test("terrain atlas requires exact tile and selected texture path", () => {
    expect(planBedrockBlockFlipbook(sample({
      terrain_tiles: [],
    })).issues).toContain("TERRAIN_ATLAS_TILE_NOT_FOUND");
    expect(planBedrockBlockFlipbook(sample({
      terrain_tiles: [{
        atlas_tile: "runic_rune", texture_paths: ["textures/blocks/other"],
      }],
    })).issues).toContain("TERRAIN_ATLAS_TEXTURE_MISMATCH");
    const ambiguousSelection = sample({
      terrain_tiles: [{
        atlas_tile: "runic_rune",
        texture_paths: ["textures/blocks/other", "textures/blocks/runic_rune"],
      }],
    });
    expect(planBedrockBlockFlipbook(ambiguousSelection).issues)
      .toContain("TERRAIN_ATLAS_INDEX_REQUIRED");
    const precise = planBedrockBlockFlipbook({
      ...ambiguousSelection,
      target: { atlas_tile: "runic_rune", atlas_index: 1 },
    });
    expect(precise.issues).toEqual([]);
    expect(precise.candidate_flipbook_entry.atlas_index).toBe(1);
    expect(planBedrockBlockFlipbook({
      ...ambiguousSelection,
      target: { atlas_tile: "runic_rune", atlas_index: 2 },
    }).issues).toContain("TERRAIN_ATLAS_INDEX_OUT_OF_RANGE");
  });

  test("atlas variants remain unverified rather than assumed to match flat texture array", () => {
    const input = sample({
      target: { atlas_tile: "runic_rune", atlas_index: 0, atlas_tile_variant: 2 },
    });
    const r = planBedrockBlockFlipbook(input);
    expect(r.candidate_flipbook_entry.atlas_tile_variant).toBe(2);
    expect(r.warnings).toContain("ATLAS_VARIANT_SOURCE_REVIEW_REQUIRED");
    expect(r.minecraft_verified).toBe(false);
    expect(planBedrockBlockFlipbook(sample({
      target: { atlas_tile: "runic_rune", atlas_tile_variant: 1 },
    })).issues).toContain("ATLAS_INDEX_REQUIRED_FOR_VARIANT");
  });

  test("duplicate target definitions fail source admission without rewriting existing flipbook", () => {
    const claimed = sample({
      existing_flipbooks: [{
        atlas_tile: "runic_rune",
        flipbook_texture: "textures/blocks/previous_rune",
      }],
    });
    expect(planBedrockBlockFlipbook(claimed).issues)
      .toContain("FLIPBOOK_TARGET_ALREADY_CLAIMED");
    expect(() => planBedrockBlockFlipbook(sample({
      terrain_tiles: [...sample().terrain_tiles, ...sample().terrain_tiles],
    }))).toThrow("BLOCK_FLIPBOOK_TERRAIN_INVENTORY_AMBIGUOUS");
    expect(() => planBedrockBlockFlipbook(sample({
      existing_flipbooks: [
        { atlas_tile: "runic_rune", flipbook_texture: "textures/blocks/a" },
        { atlas_tile: "runic_rune", atlas_index: 0,
          flipbook_texture: "textures/blocks/b" },
      ],
    }))).toThrow("BLOCK_FLIPBOOK_EXISTING_TARGET_AMBIGUOUS");
  });

  test("RGBA8 strip length and sample values must be exact", () => {
    expect(() => planBedrockBlockFlipbook(sample({
      rgba: new Uint8Array(16 * 48 * 4 - 1),
    }))).toThrow("BLOCK_FLIPBOOK_RGBA_LENGTH_INVALID");
    for (const pixel of [-1, 256, NaN, Infinity, 1.5]) {
      const raw = [...strip()];
      raw[0] = pixel;
      expect(() => planBedrockBlockFlipbook(sample({ rgba: raw })))
        .toThrow("BLOCK_FLIPBOOK_RGBA_COMPONENT_INVALID");
    }
    expect(() => planBedrockBlockFlipbook(sample({
      flipbook_texture: "textures/blocks/../unsafe",
    }))).toThrow("BLOCK_FLIPBOOK_TEXTURE_PATH_INVALID");
    expect(() => planBedrockBlockFlipbook(sample({
      flipbook_texture: "textures/blocks/runic_rune.png",
    }))).toThrow("BLOCK_FLIPBOOK_TEXTURE_PATH_INVALID");
  });

  test("loop seam is raw visible pixel evidence, not automatic visual acceptance", () => {
    const bytes = strip();
    // Last playback frame 0, first playback frame 0: pixel-identical wrap.
    const r = planBedrockBlockFlipbook(sample({
      rgba: bytes, frame_order: [0, 1, 0],
    }));
    expect(r.playback.loop_wrap.same_visible_pixels).toBe(true);
    expect(r.playback.loop_wrap.changed_visible_pixel_count).toBe(0);
    expect(r.warnings).toContain("LOOP_WRAP_VISUAL_REVIEW_REQUIRED");
    expect(r.visual_verified).toBe(false);
    const blank = new Uint8Array(bytes.length);
    const absent = planBedrockBlockFlipbook(sample({ rgba: blank }));
    expect(absent.strip.transparent_frame_count).toBe(3);
    expect(absent.warnings).toContain("FULLY_TRANSPARENT_FRAME_REVIEW");
    expect(absent.state).toBe("SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED");
  });

  test("source identity is order-stable for inventories, varies for timing and pixels", () => {
    const input = sample({
      terrain_tiles: [
        { atlas_tile: "other", texture_paths: ["textures/blocks/other"] },
        ...sample().terrain_tiles,
      ],
      existing_flipbooks: [
        { atlas_tile: "other", flipbook_texture: "textures/blocks/other" },
        { atlas_tile: "other_two", flipbook_texture: "textures/blocks/other_two" },
      ],
      source_refs: ["approved:side", "approved:front"],
    });
    const a = planBedrockBlockFlipbook(input);
    const sorted = planBedrockBlockFlipbook({
      ...input,
      terrain_tiles: [...input.terrain_tiles].reverse(),
      existing_flipbooks: [...input.existing_flipbooks].reverse(),
      source_refs: [...input.source_refs].reverse(),
    });
    expect(sorted.source_fingerprint).toBe(a.source_fingerprint);
    const renamedIncumbent = planBedrockBlockFlipbook({
      ...input,
      existing_flipbooks: [
        { atlas_tile: "other", flipbook_texture: "textures/blocks/renamed_other" },
        input.existing_flipbooks[1]!,
      ],
    });
    expect(renamedIncumbent.source_fingerprint)
      .not.toBe(a.source_fingerprint);
    expect(planBedrockBlockFlipbook({
      ...input, ticks_per_frame: 6,
    }).source_fingerprint).not.toBe(a.source_fingerprint);
    const changed = Uint8Array.from(input.rgba);
    changed[0] = 250;
    expect(planBedrockBlockFlipbook({
      ...input, rgba: changed,
    }).strip_bitmap_sha256).not.toBe(a.strip_bitmap_sha256);
  });

  test("invalid paths, style/source claims, incomplete versions and invented atlas keys fail", () => {
    expect(() => planBedrockBlockFlipbook(sample({
      target_bedrock_version: "latest",
    }))).toThrow("BLOCK_FLIPBOOK_VERSION_INVALID");
    expect(() => planBedrockBlockFlipbook(sample({
      target: { atlas_tile: "../unsafe" },
    }))).toThrow("BLOCK_FLIPBOOK_ATLAS_TILE_INVALID");
    expect(() => planBedrockBlockFlipbook(sample({
      source_refs: ["approved:front", "approved:front"],
    }))).toThrow("BLOCK_FLIPBOOK_REFERENCE_IDENTITY_INVALID");
    expect(() => planBedrockBlockFlipbook(sample({
      style_lock_id: " ",
    }))).toThrow("BLOCK_FLIPBOOK_IDENTITY_INVALID");
    expect(() => planBedrockBlockFlipbook(sample({
      target: { atlas_tile: "runic_rune", atlas_index: -1 },
    }))).toThrow("BLOCK_FLIPBOOK_NUMBER_INVALID");
  });

  test("standalone block flipbook never calls Particle, bone Timeline or Pack writer", async () => {
    const src = await Bun.file("lib/texture/blockFlipbookPlanning.ts").text();
    expect(src).toContain("candidate_flipbook_entry");
    expect(src).toContain('proposed_json_path: "textures/flipbook_textures.json"');
    expect(src).not.toContain("createTool(");
    expect(src).not.toContain("Undo.");
    expect(src).not.toContain("registerParticle");
    expect(src).not.toContain("writeFile");
  });
});
