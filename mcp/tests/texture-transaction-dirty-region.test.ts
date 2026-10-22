import { describe, expect, test } from "bun:test";
import {
  cropRgbaRect,
  requireUnchangedTextureBitmap,
} from "@/lib/textureBitmapRuntime";
import { rollbackTexturePngWrite } from "@/server/tools/paint/textureTransaction";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("texture transaction dirty-region path", () => {
  test("cropRgbaRect returns the exact bounded RGBA window", () => {
    const pixels = new Uint8ClampedArray(
      Array.from({ length: 4 * 3 * 4 }, (_, index) => index)
    );
    const crop = cropRgbaRect(pixels, 4, 3, [1, 1, 3, 3]);

    expect(crop).toMatchObject({
      width: 2,
      height: 2,
      left: 1,
      top: 1,
    });
    expect(Array.from(crop.pixels)).toEqual([
      20, 21, 22, 23, 24, 25, 26, 27,
      36, 37, 38, 39, 40, 41, 42, 43,
    ]);
  });

  test("transaction applies only the dirty canvas region but keeps full postcondition proof", async () => {
    const src = await source("server/tools/paint/textureTransaction.ts");

    expect(src).toContain("const dirtyRegion = cropRgbaRect(");
    expect(src).toContain("env.ctx.createImageData(");
    expect(src).toContain("dirtyRegion.width");
    expect(src).toContain("dirtyRegion.height");
    expect(src).toContain("env.ctx.putImageData(imageData, localX, localY)");
    expect(src).toContain("const actualAfter = fullTextureRgba(texture)");
    expect(src).toContain("actualAfterRevision");
    expect(src).toContain("rgbaToPngDataUrl(");
    expect(src).toContain("dirtyRegion.pixels");
    expect(src).not.toContain("rgbaRectToPngDataUrl(");
  });


  test("rejects a changed paint source after async planning but before Undo", async () => {
    const original = {
      pixels: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]),
      width: 2, height: 1,
    };
    const untouched = { ...original, pixels: original.pixels.slice() };
    expect(() => requireUnchangedTextureBitmap(original, untouched)).not.toThrow();

    const changed = { ...original, pixels: original.pixels.slice() };
    changed.pixels[4] += 1; // Outside a possible 1-pixel dirty rectangle.
    expect(() => requireUnchangedTextureBitmap(original, changed)).toThrow(
      "Texture bitmap changed during paint transaction planning"
    );
    expect(() => requireUnchangedTextureBitmap(original, {
      ...untouched, width: 1, height: 2,
    })).toThrow("Texture bitmap changed");
    expect(() => requireUnchangedTextureBitmap(original, {
      ...untouched, pixels: new Uint8ClampedArray(4),
    })).toThrow("Texture bitmap changed");

    const src = await source("server/tools/paint/textureTransaction.ts");
    const guard = src.indexOf(
      "requireUnchangedTextureBitmap(before, fullTextureRgba(texture))"
    );
    const undo = src.indexOf("Undo.initEdit(undoAspects)");
    const write = src.indexOf("texture.edit(", undo);
    expect(guard).toBeGreaterThan(0);
    expect(undo).toBeGreaterThan(guard);
    expect(write).toBeGreaterThan(undo);
  });

  test("PNG rollback restores original backup before failed temporary cleanup", () => {
    const output = "/fixtures/atlas.png";
    const temp = output + ".tmp";
    const backup = output + ".bak";
    for (const committed of [false, true]) {
      const files = new Map<string, string>([
        [temp, "uncommitted bytes"],
        [backup, "original authored PNG"],
        ...(committed ? [[output, "new authored PNG"] as [string, string]] : []),
      ]);
      const state = {
        path: output,
        overwrite: true,
        existed: true,
        temp_path: temp,
        backup_path: backup,
        committed,
        backup_moved: true,
        byte_length: 123,
      };
      const fs = {
        existsSync: (path: string) => files.has(path),
        writeFileSync: (_path: string, _bytes: Uint8Array) => {},
        statSync: (_path: string) => ({ isFile: () => true, size: 123 }),
        renameSync: (from: string, to: string) => {
          const data = files.get(from);
          if (data === undefined) throw new Error("Missing source PNG");
          files.delete(from);
          files.set(to, data);
        },
        unlinkSync: (path: string) => {
          if (path === temp) throw new Error("temporary file is locked");
          if (!files.delete(path)) throw new Error("Missing file to delete");
        },
      };

      expect(() => rollbackTexturePngWrite(fs, state)).toThrow(
        "temporary file is locked"
      );
      expect(files.get(output)).toBe("original authored PNG");
      expect(files.has(backup)).toBe(false);
      expect(files.has(temp)).toBe(true); // Cleanup issue remains observable.
      expect(state.backup_moved).toBe(false);
    }
  });

  test("deterministic transaction remains selection-neutral", async () => {
    const src = await source("server/tools/paint/textureTransaction.ts");

    expect(src).toContain("resolvePaintTexture(texture_id)");
    expect(src).not.toContain("getAndActivateTexture(texture_id)");
    expect(src).not.toContain("selected_texture: true");
  });
});
