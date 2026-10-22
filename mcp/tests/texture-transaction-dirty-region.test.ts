import { describe, expect, test } from "bun:test";
import {
  cropRgbaRect,
  requireUnchangedTextureBitmap,
} from "@/lib/textureBitmapRuntime";
import {
  commitTexturePngWrite,
  prepareTexturePngWrite,
  rollbackTexturePngWrite,
} from "@/server/tools/paint/textureTransaction";

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
        original_bytes: Buffer.from("original authored PNG"),
        temp_created: true,
        published_bytes: committed ? Buffer.from("new authored PNG") : null,
      };
      const fs = {
        existsSync: (path: string) => files.has(path),
        readFileSync: (path: string) => Buffer.from(files.get(path) ?? "", "utf8"),
        writeFileSync: (_path: string, _bytes: Uint8Array) => {},
        lstatSync: (_path: string) => ({ isFile: () => true, size: 123 }),
        linkSync: (_from: string, _to: string) => {},
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


  function fakePngFilesystem(initial: Record<string, Uint8Array> = {}) {
    const files = new Map<string, Uint8Array>(
      Object.entries(initial).map(([path, bytes]) => [path, bytes.slice()])
    );
    const fs = {
      existsSync: (path: string) => files.has(path),
      readFileSync: (path: string) => {
        const data = files.get(path);
        if (!data) throw new Error("ENOENT: " + path);
        return data.slice();
      },
      writeFileSync: (path: string, bytes: Uint8Array, options?: { flag: "wx" }) => {
        if (options?.flag === "wx" && files.has(path)) {
          throw new Error("EEXIST: exclusive write refused");
        }
        files.set(path, bytes.slice());
      },
      lstatSync: (path: string) => {
        const data = files.get(path);
        if (!data) throw new Error("ENOENT: " + path);
        return { isFile: () => true, size: data.byteLength };
      },
      linkSync: (from: string, to: string) => {
        if (files.has(to)) throw new Error("EEXIST: exclusive link refused");
        const data = files.get(from);
        if (!data) throw new Error("ENOENT: " + from);
        files.set(to, data);
      },
      renameSync: (from: string, to: string) => {
        const data = files.get(from);
        if (!data) throw new Error("ENOENT: " + from);
        files.delete(from);
        files.set(to, data);
      },
      unlinkSync: (path: string) => {
        if (!files.delete(path)) throw new Error("ENOENT: " + path);
      },
    };
    return { files, fs };
  }

  test("new PNG output never replaces a concurrent creator or someone else's temp", () => {
    const path = "/fixtures/new.png";
    const bytes = new Uint8Array([137, 80, 78, 71, 10]);
    const foreign = new Uint8Array([1, 2, 3, 4, 5]);
    const { fs, files } = fakePngFilesystem();
    const { state } = prepareTexturePngWrite(path, false, bytes.length, fs);
    files.set(path, foreign);
    expect(() => commitTexturePngWrite(fs, state, bytes))
      .toThrow("EEXIST");
    rollbackTexturePngWrite(fs, state);
    expect(files.get(path)).toEqual(foreign);
    expect(files.has(state.temp_path)).toBe(false);
    expect(state.committed).toBe(false);

    const clean = fakePngFilesystem();
    const fresh = prepareTexturePngWrite(path, false, bytes.length, clean.fs);
    const foreignTemp = new Uint8Array([40, 41, 42]);
    clean.files.set(fresh.state.temp_path, foreignTemp);
    expect(() => commitTexturePngWrite(clean.fs, fresh.state, bytes))
      .toThrow("EEXIST");
    rollbackTexturePngWrite(clean.fs, fresh.state);
    expect(clean.files.get(fresh.state.temp_path)).toEqual(foreignTemp);
    expect(clean.files.has(path)).toBe(false);

    const success = fakePngFilesystem();
    const newOutput = prepareTexturePngWrite(path, false, bytes.length, success.fs);
    commitTexturePngWrite(success.fs, newOutput.state, bytes);
    expect(success.files.get(path)).toEqual(bytes);
    expect(success.files.has(newOutput.state.temp_path)).toBe(false);
    expect(newOutput.state.committed).toBe(true);
  });

  test("overwrite revalidates original file bytes and restores only its own published PNG", () => {
    const path = "/fixtures/existing.png";
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    const changed = new Uint8Array([1, 2, 3, 4, 6]);
    const output = new Uint8Array([137, 80, 78, 71, 10]);
    const before = fakePngFilesystem({ [path]: original });
    expect(() => prepareTexturePngWrite(path, false, output.length, before.fs))
      .toThrow("without overwrite=true");
    const { state } = prepareTexturePngWrite(path, true, output.length, before.fs);
    before.files.set(path, changed);
    expect(() => commitTexturePngWrite(before.fs, state, output))
      .toThrow("changed since output preflight");
    rollbackTexturePngWrite(before.fs, state);
    expect(before.files.get(path)).toEqual(changed);
    expect(before.files.has(state.temp_path)).toBe(false);

    const good = fakePngFilesystem({ [path]: original });
    const prepared = prepareTexturePngWrite(path, true, output.length, good.fs);
    commitTexturePngWrite(good.fs, prepared.state, output);
    expect(good.files.get(path)).toEqual(output);
    expect(prepared.state.backup_moved).toBe(true);
    rollbackTexturePngWrite(good.fs, prepared.state);
    expect(good.files.get(path)).toEqual(original);
    expect(good.files.has(prepared.state.backup_path!)).toBe(false);
  });

  test("a new writer after backup move cannot be overwritten even during rollback", () => {
    const path = "/fixtures/replace.png";
    const original = new Uint8Array([1, 2, 3, 4]);
    const foreign = new Uint8Array([7, 8, 9, 0]);
    const output = new Uint8Array([137, 80, 78, 71]);
    const { fs, files } = fakePngFilesystem({ [path]: original });
    const { state } = prepareTexturePngWrite(path, true, output.length, fs);
    const rename = fs.renameSync;
    fs.renameSync = (from: string, to: string) => {
      rename(from, to);
      if (from === path && to === state.backup_path) {
        files.set(path, foreign);
      }
    };
    expect(() => commitTexturePngWrite(fs, state, output))
      .toThrow("EEXIST");
    expect(() => rollbackTexturePngWrite(fs, state))
      .toThrow("destination was recreated concurrently");
    expect(files.get(path)).toEqual(foreign);
    expect(files.get(state.backup_path!)).toEqual(original);
    expect(state.committed).toBe(false);
  });

  test("rollback refuses to delete a published PNG modified by another writer", () => {
    const path = "/fixtures/published.png";
    const original = new Uint8Array([1, 2, 3]);
    const output = new Uint8Array([4, 5, 6]);
    const newer = new Uint8Array([9, 8, 7]);
    const { fs, files } = fakePngFilesystem({ [path]: original });
    const { state } = prepareTexturePngWrite(path, true, output.length, fs);
    commitTexturePngWrite(fs, state, output);
    files.set(path, newer);
    expect(() => rollbackTexturePngWrite(fs, state))
      .toThrow("destination changed after publication");
    expect(files.get(path)).toEqual(newer);
    expect(files.get(state.backup_path!)).toEqual(original);
  });

  test("deterministic transaction remains selection-neutral", async () => {
    const src = await source("server/tools/paint/textureTransaction.ts");

    expect(src).toContain("resolvePaintTexture(texture_id)");
    expect(src).not.toContain("getAndActivateTexture(texture_id)");
    expect(src).not.toContain("selected_texture: true");
  });
});
