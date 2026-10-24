import { describe, expect, test } from "bun:test";
import { buildUvLayoutSnapshot } from "@/lib/uv/islands";
import { planUvPacking } from "@/lib/uv/packing/planner";
import {
  buildUvNativeSourceSnapshot,
  fingerprintUvNativeSource,
} from "@/lib/uv/adapters/blockbenchCubeUv";
import {
  prepareUvPixelMigration,
  type UvMigrationAtlas,
} from "@/lib/uv/pixelMigration";

type SourceCube = {
  uuid: string; name: string;
  from: number[]; to: number[];
  box_uv: boolean; autouv: number; mirror_uv: boolean;
  faces: Array<{
    face: "north"; uv: [number, number, number, number];
    rotation: number;
  }>;
};

function fixture(
  definitions: Array<{
    id: string;
    uv: [number, number, number, number];
    rotation?: number;
  }>,
  bitmapWidth = 16,
  bitmapHeight = 16
) {
  const cubes: SourceCube[] = definitions.map(({ id, uv, rotation = 0 }) => ({
    uuid: id, name: id,
    from: [0, 0, 0], to: [2, 2, 1],
    box_uv: false, autouv: 0, mirror_uv: false,
    faces: [{ face: "north", uv, rotation }],
  }));
  const native = buildUvNativeSourceSnapshot(cubes, 16, 16, "migration-project");
  const snapshot = buildUvLayoutSnapshot(cubes, 16, 16,
    () => ({ padding_pixels: 0 })
  );
  const plan = planUvPacking(snapshot, {
    bitmap_width: bitmapWidth,
    bitmap_height: bitmapHeight,
    mode: "REPACK_ALL",
  });
  return { native, plan, fingerprint: fingerprintUvNativeSource(native) };
}
function atlas(uuid: string, width = 16, height = 16): UvMigrationAtlas {
  return {
    texture_uuid: uuid,
    width, height,
    layers_enabled: false,
    frame_count: 1,
    pixels: new Uint8ClampedArray(width * height * 4),
  };
}
function put(
  a: UvMigrationAtlas, x: number, y: number,
  value: [number, number, number, number]
): void {
  a.pixels.set(value, (y * a.width + x) * 4);
}
function read(bytes: Uint8ClampedArray, width: number, x: number, y: number) {
  return Array.from(bytes.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
}
const planFor = (
  source: ReturnType<typeof fixture>,
  atlases: readonly UvMigrationAtlas[]
) => prepareUvPixelMigration({
  plan: source.plan,
  native_before: source.native,
  expected_source_fingerprint: source.fingerprint,
  atlases,
});

describe("lossless UV bitmap migration candidates (no native mutation)", () => {
  test("translates complete signed face RGBA and preserves unrelated pixels", () => {
    const source = fixture([{ id: "panel", uv: [8, 2, 10, 4] }]);
    const before = atlas("color");
    put(before, 8, 2, [10, 20, 30, 255]);
    put(before, 9, 2, [60, 70, 80, 128]);
    put(before, 8, 3, [100, 50, 25, 0]); // hidden RGB
    put(before, 9, 3, [15, 90, 200, 255]);
    put(before, 15, 15, [9, 9, 9, 255]); // unowned pixel must survive
    const snapshot = before.pixels.slice();
    const result = planFor(source, [before]);
    expect(result.state).toBe("candidate_only");
    expect(result.native_apply_attested).toBe(false);
    expect(result.scene_ownership_attested).toBe(false);
    expect(result.visual_verdict).toBe("not_evaluated");
    expect(result.relocated_pixel_count).toBe(4);
    const target = source.plan.proposed.islands[0].rect;
    const migrated = result.candidates[0].pixels;
    expect(read(migrated, 16, target.x, target.y)).toEqual([10, 20, 30, 255]);
    expect(read(migrated, 16, target.x + 1, target.y)).toEqual([60, 70, 80, 128]);
    expect(read(migrated, 16, target.x, target.y + 1)).toEqual([100, 50, 25, 0]);
    expect(read(migrated, 16, 8, 2)).toEqual([0, 0, 0, 0]);
    expect(read(migrated, 16, 15, 15)).toEqual([9, 9, 9, 255]);
    expect(before.pixels).toEqual(snapshot);
    expect(result.candidates[0].changed_pixels).toBeGreaterThan(0);
    expect(result.candidates[0].affected_rect).not.toBeNull();
  });

  test("swaps two authored regions from one snapshot without sequential overwrite", () => {
    const source = fixture([
      { id: "left", uv: [0, 0, 2, 2] },
      { id: "right", uv: [2, 0, 4, 2] },
    ]);
    const beforeRects = source.plan.before.islands.map(i => ({ ...i.rect }));
    source.plan.proposed.islands[0].rect = beforeRects[1];
    source.plan.proposed.islands[1].rect = beforeRects[0];
    source.plan.moved_island_ids = source.plan.before.islands.map(i => i.id);
    const color = atlas("color"), mer = atlas("mer");
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      put(color, x, y, [10, 30, 50, 255]);
      put(color, x + 2, y, [70, 90, 110, 255]);
      put(mer, x, y, [0, 10, 0, 255]);
      put(mer, x + 2, y, [0, 50, 0, 255]);
    }
    const result = planFor(source, [color, mer]);
    expect(result.candidates.map(c => c.texture_uuid)).toEqual(["color", "mer"]);
    expect(read(result.candidates[0].pixels, 16, 0, 0)).toEqual([70, 90, 110, 255]);
    expect(read(result.candidates[0].pixels, 16, 2, 0)).toEqual([10, 30, 50, 255]);
    expect(read(result.candidates[1].pixels, 16, 0, 0)).toEqual([0, 50, 0, 255]);
    expect(read(result.candidates[1].pixels, 16, 2, 0)).toEqual([0, 10, 0, 255]);
    expect(read(color.pixels, 16, 0, 0)).toEqual([10, 30, 50, 255]);
  });

  test("keeps native signed flips and 270-to-0 quarter-turn orientation", () => {
    const source = fixture([{ id: "flipped", uv: [7, 1, 5, 2], rotation: 270 }]);
    source.plan.proposed.islands[0].rect = { x: 0, y: 0, width: 1, height: 2 };
    source.plan.placement_transforms[0].rotated_90 = true;
    const color = atlas("color");
    put(color, 5, 1, [10, 0, 0, 255]);
    put(color, 6, 1, [20, 0, 0, 255]);
    const result = planFor(source, [color]);
    expect(result.relocated_pixel_count).toBe(2);
    expect(read(result.candidates[0].pixels, 16, 0, 0)).toEqual([10, 0, 0, 255]);
    expect(read(result.candidates[0].pixels, 16, 0, 1)).toEqual([20, 0, 0, 255]);
  });

  test("preserves V-flipped faces when the native 90-degree rotation becomes 180", () => {
    const source = fixture([{ id: "v-flip", uv: [5, 2, 7, 1], rotation: 90 }]);
    source.plan.proposed.islands[0].rect = { x: 0, y: 0, width: 1, height: 2 };
    source.plan.placement_transforms[0].rotated_90 = true;
    const color = atlas("color");
    put(color, 5, 1, [91, 0, 0, 255]);
    put(color, 6, 1, [92, 0, 0, 255]);
    const prepared = planFor(source, [color]);
    expect(read(prepared.candidates[0].pixels, 16, 0, 0))
      .toEqual([91, 0, 0, 255]);
    expect(read(prepared.candidates[0].pixels, 16, 0, 1))
      .toEqual([92, 0, 0, 255]);
  });

  test("preserves both signed UV axes when the native 180-degree rotation becomes 270", () => {
    const source = fixture([{ id: "uv-flip", uv: [7, 2, 5, 1], rotation: 180 }]);
    source.plan.proposed.islands[0].rect = { x: 0, y: 0, width: 1, height: 2 };
    source.plan.placement_transforms[0].rotated_90 = true;
    const color = atlas("color");
    put(color, 5, 1, [31, 0, 0, 255]);
    put(color, 6, 1, [32, 0, 0, 255]);
    const prepared = planFor(source, [color]);
    expect(read(prepared.candidates[0].pixels, 16, 0, 0))
      .toEqual([32, 0, 0, 255]);
    expect(read(prepared.candidates[0].pixels, 16, 0, 1))
      .toEqual([31, 0, 0, 255]);
  });

  test("refuses destination artwork that was never owned by a moved island", () => {
    const source = fixture([{ id: "panel", uv: [8, 2, 10, 4] }]);
    const color = atlas("color");
    const target = source.plan.proposed.islands[0].rect;
    put(color, 8, 2, [10, 20, 30, 255]);
    put(color, target.x, target.y, [250, 12, 12, 0]); // hidden RGB
    expect(() => planFor(source, [color]))
      .toThrow("UV_PIXEL_MIGRATION_OCCUPIED_TARGET");
    expect(read(color.pixels, 16, target.x, target.y)).toEqual([250, 12, 12, 0]);
  });

  test("refuses a density or axis change requiring resampling", () => {
    const source = fixture([{ id: "panel", uv: [8, 2, 10, 4] }]);
    source.plan.proposed.islands[0].rect.width = 3;
    expect(() => planFor(source, [atlas("color")]))
      .toThrow("UV_PIXEL_MIGRATION_RESAMPLE_REQUIRED");
  });

  test("rejects anisotropic pixel axes when a turn would change local texel counts", () => {
    const source = fixture([
      { id: "panel", uv: [8, 2, 10, 3], rotation: 0 },
    ], 32, 64);
    source.plan.proposed.islands[0].rect = { x: 0, y: 0, width: 1, height: 2 };
    source.plan.placement_transforms[0].rotated_90 = true;
    expect(() => planFor(source, [atlas("color", 32, 64)]))
      .toThrow("UV_PIXEL_MIGRATION_RESAMPLE_REQUIRED");
  });

  test("moves a complete native Box UV net without rotating or guessing six face pixels", () => {
    const box = {
      uuid: "box", name: "box", from: [0, 0, 0], to: [2, 2, 1],
      box_uv: true, uv_offset: [8, 8], autouv: 0, mirror_uv: false,
      faces: [],
    };
    const native = buildUvNativeSourceSnapshot([box], 16, 16, "migration-project");
    const snapshot = buildUvLayoutSnapshot([box], 16, 16, () => ({
      padding_pixels: 0,
    }));
    const plan = planUvPacking(snapshot, { bitmap_width: 16, bitmap_height: 16 });
    const bitmap = atlas("color");
    put(bitmap, 8, 8, [42, 77, 99, 255]);
    const preview = prepareUvPixelMigration({
      plan, native_before: native,
      expected_source_fingerprint: fingerprintUvNativeSource(native),
      atlases: [bitmap],
    });
    const region = plan.proposed.islands[0].rect;
    expect(region).toMatchObject({ width: 6, height: 3 });
    expect(read(preview.candidates[0].pixels, 16, region.x, region.y))
      .toEqual([42, 77, 99, 255]);
    expect(read(preview.candidates[0].pixels, 16, 8, 8))
      .toEqual([0, 0, 0, 0]);
    expect(preview.relocated_pixel_count).toBe(6 * 3);
  });

  test("explicit shared region coalesces identical pixel-source writes only", () => {
    const cubes = ["left", "right"].map(uuid => ({
      uuid, name: uuid, from: [0, 0, 0], to: [2, 2, 1],
      box_uv: false, autouv: 0, mirror_uv: false,
      faces: [{
        face: "north" as const,
        uv: [8, 2, 10, 4] as [number, number, number, number],
        rotation: 0,
      }],
    }));
    const native = buildUvNativeSourceSnapshot(cubes, 16, 16, "migration-project");
    const snapshot = buildUvLayoutSnapshot(cubes, 16, 16,
      () => ({ padding_pixels: 0, stack_group: "paired" })
    );
    const plan = planUvPacking(snapshot, { bitmap_width: 16, bitmap_height: 16 });
    const bitmap = atlas("color");
    put(bitmap, 8, 2, [17, 37, 57, 255]);
    const preview = prepareUvPixelMigration({
      plan, native_before: native,
      expected_source_fingerprint: fingerprintUvNativeSource(native),
      atlases: [bitmap],
    });
    expect(preview.relocated_pixel_count).toBe(4);
    expect(preview.coalesced_shared_writes).toBe(4);
    expect(read(preview.candidates[0].pixels, 16,
      plan.proposed.islands[0].rect.x, plan.proposed.islands[0].rect.y))
      .toEqual([17, 37, 57, 255]);
  });

  test("new shared destination cannot merge independently authored source texels", () => {
    const cubes = [
      { uuid: "left", uv: [8, 2, 10, 4] as [number, number, number, number] },
      { uuid: "right", uv: [10, 2, 12, 4] as [number, number, number, number] },
    ].map(({ uuid, uv }) => ({
      uuid, name: uuid, from: [0, 0, 0], to: [2, 2, 1],
      box_uv: false, autouv: 0, mirror_uv: false,
      faces: [{ face: "north" as const, uv, rotation: 0 }],
    }));
    const native = buildUvNativeSourceSnapshot(cubes, 16, 16, "migration-project");
    const snapshot = buildUvLayoutSnapshot(cubes, 16, 16,
      () => ({ padding_pixels: 0, stack_group: "pair" })
    );
    const plan = planUvPacking(snapshot, { bitmap_width: 16, bitmap_height: 16 });
    plan.proposed.islands[1].rect = { ...plan.proposed.islands[0].rect };
    const bitmap = atlas("color");
    put(bitmap, 8, 2, [10, 10, 10, 255]);
    put(bitmap, 10, 2, [200, 200, 200, 255]);
    expect(() => prepareUvPixelMigration({
      plan, native_before: native,
      expected_source_fingerprint: fingerprintUvNativeSource(native),
      atlases: [bitmap],
    })).toThrow("UV_PIXEL_MIGRATION_WRITE_CONFLICT");
    expect(read(bitmap.pixels, 16, 10, 2)).toEqual([200, 200, 200, 255]);
  });

  test("existing unselected UV reuse is protected even when its pixels are transparent", () => {
    const cubes = ["moving", "fixed"].map(uuid => ({
      uuid, name: uuid, from: [0, 0, 0], to: [2, 2, 1],
      box_uv: false, autouv: 0, mirror_uv: false,
      faces: [{
        face: "north" as const,
        uv: [8, 2, 10, 4] as [number, number, number, number],
        rotation: 0,
      }],
    }));
    const native = buildUvNativeSourceSnapshot(cubes, 16, 16, "migration-project");
    const snapshot = buildUvLayoutSnapshot(cubes, 16, 16,
      () => ({ padding_pixels: 0 })
    );
    const plan = planUvPacking(snapshot, {
      bitmap_width: 16, bitmap_height: 16,
      mode: "REPACK_SELECTED", island_ids: ["face:moving:north"],
    });
    expect(() => prepareUvPixelMigration({
      plan, native_before: native,
      expected_source_fingerprint: fingerprintUvNativeSource(native),
      atlases: [atlas("color")],
    })).toThrow("UV_PIXEL_MIGRATION_SHARED_SCOPE");
  });

  test("a dependent PBR conflict rejects the entire candidate set without modifying the base RGBA", () => {
    const source = fixture([{ id: "panel", uv: [8, 2, 10, 4] }]);
    const color = atlas("color");
    const mer = atlas("mer");
    const target = source.plan.proposed.islands[0].rect;
    put(color, 8, 2, [11, 22, 33, 255]);
    put(mer, target.x, target.y, [200, 0, 0, 0]);
    const original = color.pixels.slice();
    expect(() => planFor(source, [color, mer]))
      .toThrow("UV_PIXEL_MIGRATION_OCCUPIED_TARGET");
    expect(color.pixels).toEqual(original);
    expect(read(mer.pixels, 16, target.x, target.y)).toEqual([200, 0, 0, 0]);
  });

  test("fails closed for changed source snapshot or unmatched dependent atlas state", () => {
    const source = fixture([{ id: "panel", uv: [8, 2, 10, 4] }]);
    const color = atlas("color");
    expect(() => prepareUvPixelMigration({
      plan: source.plan, native_before: source.native,
      expected_source_fingerprint: "sha256:stale", atlases: [color],
    })).toThrow("STALE_UV_PLAN");
    expect(() => planFor(source, [])).toThrow("UV_PIXEL_MIGRATION_ATLAS_SCOPE");
    expect(() => planFor(source, [color, color])).toThrow("UV_PIXEL_MIGRATION_ATLAS_SCOPE");
    const different = atlas("mer", 32, 16);
    expect(() => planFor(source, [color, different]))
      .toThrow("UV_PIXEL_MIGRATION_ATLAS_SCOPE");
    const animated = { ...color, frame_count: 2 as const };
    expect(() => planFor(source, [animated as never]))
      .toThrow("UV_PIXEL_MIGRATION_ATLAS_SCOPE");
    const layered = { ...color, layers_enabled: true as const };
    expect(() => planFor(source, [layered as never]))
      .toThrow("UV_PIXEL_MIGRATION_ATLAS_SCOPE");
    const malformed = { ...color, pixels: new Uint8ClampedArray(3) };
    expect(() => planFor(source, [malformed]))
      .toThrow("UV_PIXEL_MIGRATION_ATLAS_SCOPE");
  });
});
