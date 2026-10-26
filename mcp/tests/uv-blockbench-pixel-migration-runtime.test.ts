import { describe, expect, test } from "bun:test";
import {
  createBlockbenchUvPixelMigrationAdapter,
} from "@/server/runtime/uv/pixelMigrationRuntime";
import { applyUvPixelMigrationAtomic } from "@/lib/uv/pixelMigrationTransaction";
import { computeTextureRevision } from "@/lib/texture/revision";
import { buildUvLayoutSnapshot } from "@/lib/uv/islands";
import { planUvPacking } from "@/lib/uv/packing/planner";
import { fingerprintUvNativeSource } from "@/lib/uv/adapters/blockbenchCubeUv";

type FakeTexture = {
  uuid: string;
  name: string;
  width: number;
  height: number;
  display_height: number;
  frameCount: number;
  layers_enabled: boolean;
  canvas: { width: number; height: number };
  ctx: {
    canvas: { width: number; height: number };
    getImageData: (x: number, y: number, width: number, height: number) =>
      { data: Uint8ClampedArray };
    createImageData: (width: number, height: number) =>
      { data: Uint8ClampedArray };
    putImageData: (image: { data: Uint8ClampedArray }, x: number, y: number) => void;
  };
  pixels: Uint8ClampedArray;
  edit(callback: (...args: unknown[]) => void, options: { no_undo: boolean }): void;
  getUVWidth(): number;
  getUVHeight(): number;
};

function fakeTexture(uuid: string): FakeTexture {
  const pixels = new Uint8ClampedArray(16 * 16 * 4);
  const ctx = {
    canvas: { width: 16, height: 16 },
    getImageData(x: number, y: number, width: number, height: number) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row++) {
        const start = ((y + row) * 16 + x) * 4;
        data.set(pixels.subarray(start, start + width * 4), row * width * 4);
      }
      return { data };
    },
    createImageData(width: number, height: number) {
      return { data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData(image: { data: Uint8ClampedArray }, x: number, y: number) {
      for (let row = 0; row < 16; row++) {
        const start = (row * 16) * 4;
        pixels.set(image.data.subarray(start, start + 16 * 4),
          ((y + row) * 16 + x) * 4);
      }
    },
  };
  return {
    uuid, name: uuid, width: 16, height: 16, display_height: 16,
    frameCount: 1, layers_enabled: false,
    canvas: { width: 16, height: 16 }, ctx, pixels,
    edit(callback, options) {
      if (options.no_undo !== true) throw Error("foreign Undo request");
      callback(ctx.canvas, { ctx, offset: [0, 0] });
    },
    getUVWidth: () => 16,
    getUVHeight: () => 16,
  };
}
function pixel(t: FakeTexture, x: number, y: number) {
  return Array.from(t.pixels.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4));
}

function fakeCube(primary: FakeTexture) {
  const keys = ["north", "south", "east", "west", "up", "down"] as const;
  const cube: {
    uuid: string; name: string;
    from: [number, number, number]; to: [number, number, number];
    box_uv: boolean; uv_offset: [number, number]; autouv: number;
    mirror_uv: boolean;
    faces: Record<string, {
      uv: [number, number, number, number];
      rotation: number; enabled: boolean; texture: string | false;
      getTexture: () => FakeTexture | null;
      extend: (patch: { uv: [number, number, number, number]; rotation: number }) => void;
    }>;
    extend: (patch: { uv_offset?: [number, number] }) => void;
  } = {
    uuid: "panel", name: "panel",
    from: [0, 0, 0], to: [2, 2, 1],
    box_uv: false, uv_offset: [0, 0],
    autouv: 0, mirror_uv: false,
    faces: {},
    extend(patch) {
      if (patch.uv_offset) this.uv_offset = [...patch.uv_offset];
    },
  };
  for (const key of keys) {
    cube.faces[key] = {
      uv: key === "north" ? [8, 2, 10, 4] : [0, 0, 0, 0],
      rotation: 0, enabled: key === "north",
      texture: key === "north" ? primary.uuid : false,
      getTexture: () => key === "north" ? primary : null,
      extend(patch) {
        this.uv = [...patch.uv];
        this.rotation = patch.rotation;
      },
    };
  }
  return cube;
}

async function withBlockbench<T>(
  run: (fixture: {
    base: FakeTexture;
    mer: FakeTexture;
    cube: ReturnType<typeof fakeCube>;
    history: string[];
    project: { uuid: string; textures: FakeTexture[]; texture_width: number; texture_height: number };
    outliner: { elements: unknown[] };
    undo: { current_save: object | null; initEdit: (aspects: unknown) => void;
      cancelEdit: (flag: boolean) => void; finishEdit: (label: string) => void };
  }) => Promise<T>
): Promise<T> {
  const names = [
    "Project", "ModelProject", "Cube", "Outliner", "Texture", "Undo", "Canvas",
  ];
  const originals = names.map(name =>
    Object.getOwnPropertyDescriptor(globalThis, name)
  );
  const base = fakeTexture("base"), mer = fakeTexture("mer");
  base.pixels.set([17, 35, 53, 255], (2 * 16 + 8) * 4);
  mer.pixels.set([0, 77, 0, 255], (2 * 16 + 8) * 4);
  const cube = fakeCube(base);
  const project = {
    uuid: "migration-native-test", textures: [base, mer],
    texture_width: 16, texture_height: 16,
  };
  const history: string[] = [];
  const undo = {
    current_save: null as object | null,
    initEdit(aspects: unknown) {
      const input = aspects as Record<string, unknown>;
      expect(input.bitmap).toBe(true);
      expect(input.uv_only).toBe(true);
      expect(input.textures).toEqual([base, mer]);
      expect(input.elements).toEqual([cube]);
      history.push("begin");
      undo.current_save = {};
    },
    cancelEdit(flag: boolean) {
      history.push("cancel:" + flag);
      undo.current_save = null;
    },
    finishEdit(label: string) {
      expect(label).toBe("LazyDesigner Texture + UV migration");
      history.push("commit");
      undo.current_save = null;
    },
  };
  const outliner = { elements: [cube] as unknown[] };
  const values = [
    project, { all: [project] }, { all: [cube] },
    outliner, { all: [base, mer] }, undo, { updateAll: () => {} },
  ];
  try {
    names.forEach((name, index) => Object.defineProperty(globalThis, name, {
      configurable: true, writable: true, value: values[index],
    }));
    return await run({ base, mer, cube, history, project, outliner, undo });
  } finally {
    names.forEach((name, index) => {
      const descriptor = originals[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}

function planFromNative(cube: ReturnType<typeof fakeCube>) {
  const source = [{
    uuid: cube.uuid, name: cube.name, from: cube.from, to: cube.to,
    box_uv: cube.box_uv, uv_offset: cube.uv_offset,
    mirror_uv: cube.mirror_uv, autouv: cube.autouv,
    faces: [{
      face: "north" as const, uv: cube.faces.north.uv,
      rotation: cube.faces.north.rotation, enabled: true,
    }],
  }];
  return planUvPacking(buildUvLayoutSnapshot(
    source, 16, 16, () => ({ padding_pixels: 0 })
  ), { bitmap_width: 16, bitmap_height: 16 });
}

describe("unregistered native Texture + UV migration adapter harness", () => {
  test("reads all native Cube faces and Texture UUIDs before exposing candidate scope", async () => {
    await withBlockbench(async ({ base, mer }) => {
      const adapter = createBlockbenchUvPixelMigrationAdapter();
      const state = await adapter.readState();
      expect(state.scope.uv_owner_scope).toBe("complete_cube_only");
      expect(state.scope.all_cube_uuids).toEqual(["panel"]);
      expect(state.scope.all_texture_uuids).toEqual(["base", "mer"]);
      expect(state.scope.face_texture_bindings).toHaveLength(6);
      expect(state.scope.face_texture_bindings.find(x => x.face === "north"))
        .toEqual({ cube_uuid: "panel", face: "north", texture_uuid: "base" });
      expect(state.atlases[0].pixels).not.toBe(base.pixels);
      expect(state.atlases[1].pixels).not.toBe(mer.pixels);
    });
  });

  test("native image+UV adapter integrates with the pure atomic port in one simulated Undo", async () => {
    await withBlockbench(async ({ base, mer, cube, history }) => {
      const adapter = createBlockbenchUvPixelMigrationAdapter();
      const state = await adapter.readState();
      const revisions: Record<string, string> = {};
      for (const atlas of state.atlases) {
        revisions[atlas.texture_uuid] = await computeTextureRevision(
          atlas.pixels, atlas.width, atlas.height
        );
      }
      const plan = planFromNative(cube);
      const mapped = await applyUvPixelMigrationAtomic({
        plan, adapter,
        expected_source_fingerprint: fingerprintUvNativeSource(state.uv),
        expected_atlas_revisions: revisions,
      });
      const target = plan.proposed.islands[0].rect;
      expect(history).toEqual(["begin", "commit"]);
      expect(pixel(base, target.x, target.y)).toEqual([17, 35, 53, 255]);
      expect(pixel(mer, target.x, target.y)).toEqual([0, 77, 0, 255]);
      expect(pixel(base, 8, 2)).toEqual([0, 0, 0, 0]);
      expect(cube.faces.north.uv).toEqual([
        target.x, target.y, target.x + target.width, target.y + target.height,
      ]);
      expect(mapped.native_runtime_attested).toBe(false);
      expect(mapped.visual_verdict).toBe("not_evaluated");
    });
  });

  test("non-Cube Outliner owners and foreign texture collections fail closed", async () => {
    await withBlockbench(async ({ outliner, project }) => {
      outliner.elements.push({ uuid: "mesh-owner" });
      expect(() => createBlockbenchUvPixelMigrationAdapter().readState())
        .toThrow("UV_PIXEL_MIGRATION_SCENE_UNSUPPORTED");
      outliner.elements.pop();
      project.textures.pop();
      expect(() => createBlockbenchUvPixelMigrationAdapter().readState())
        .toThrow("UV_PIXEL_MIGRATION_TEXTURE_SCOPE_INCOMPLETE");
    });
  });

  test("same-project texture reassignment after initial read cannot commit", async () => {
    await withBlockbench(async ({ cube, history }) => {
      const adapter = createBlockbenchUvPixelMigrationAdapter();
      const before = await adapter.readState();
      const plan = planFromNative(cube);
      const revisions: Record<string, string> = {};
      for (const atlas of before.atlases) {
        revisions[atlas.texture_uuid] = await computeTextureRevision(
          atlas.pixels, atlas.width, atlas.height
        );
      }
      const getOld = cube.faces.north.getTexture;
      let reads = 0;
      const oldRead = adapter.readState;
      adapter.readState = () => {
        reads += 1;
        if (reads === 2) cube.faces.north.getTexture = () => null;
        return oldRead();
      };
      await expect(applyUvPixelMigrationAtomic({
        adapter, plan,
        expected_source_fingerprint: fingerprintUvNativeSource(before.uv),
        expected_atlas_revisions: revisions,
      })).rejects.toThrow("UV_PIXEL_MIGRATION_SCENE_CHANGED");
      expect(history).toEqual([]);
      cube.faces.north.getTexture = getOld;
    });
  });

  test("synchronous Undo handoff detects last-moment pixel changes after async freshness read", async () => {
    await withBlockbench(async ({ base, cube, history }) => {
      const adapter = createBlockbenchUvPixelMigrationAdapter();
      const before = await adapter.readState();
      const revisions: Record<string, string> = {};
      for (const atlas of before.atlases) {
        revisions[atlas.texture_uuid] = await computeTextureRevision(
          atlas.pixels, atlas.width, atlas.height
        );
      }
      const begin = adapter.beginUndo;
      adapter.beginUndo = (commands, uuids) => {
        // Simulates a foreign edit in the last synchronous scheduling gap.
        base.pixels[4] = 241;
        return begin(commands, uuids);
      };
      await expect(applyUvPixelMigrationAtomic({
        plan: planFromNative(cube), adapter,
        expected_source_fingerprint: fingerprintUvNativeSource(before.uv),
        expected_atlas_revisions: revisions,
      })).rejects.toThrow("UV_PIXEL_MIGRATION_OUTCOME_UNKNOWN");
      expect(history).toEqual([]);
      expect(base.pixels[4]).toBe(241);
    });
  });

  test("native Undo preflight never steals or cancels an existing foreign edit", async () => {
    await withBlockbench(async ({ undo, history }) => {
      const adapter = createBlockbenchUvPixelMigrationAdapter();
      undo.current_save = { foreign: true };
      expect(() => adapter.beginUndo([], ["base", "mer"]))
        .toThrow("UV_PIXEL_MIGRATION_UNDO_BUSY");
      expect(history).toEqual([]);
      expect(undo.current_save).toEqual({ foreign: true });
    });
  });

  test("unexpected native callback canvas or missing write callback triggers verified recovery", async () => {
    await withBlockbench(async ({ base, cube, history }) => {
      const adapter = createBlockbenchUvPixelMigrationAdapter();
      const before = await adapter.readState();
      const plan = planFromNative(cube);
      const expected_atlas_revisions: Record<string, string> = {};
      for (const atlas of before.atlases) {
        expected_atlas_revisions[atlas.texture_uuid] = await computeTextureRevision(
          atlas.pixels, atlas.width, atlas.height
        );
      }
      const write = base.edit;
      let skipOnce = true;
      base.edit = (callback, options) => {
        if (skipOnce) { skipOnce = false; return; }
        write.call(base, callback, options);
      };
      const original = base.pixels.slice();
      await expect(applyUvPixelMigrationAtomic({
        plan, adapter,
        expected_source_fingerprint: fingerprintUvNativeSource(before.uv),
        expected_atlas_revisions,
      })).rejects.toThrow("UV_PIXEL_MIGRATION_NATIVE_WRITE_UNVERIFIED");
      expect(history).toEqual(["begin", "cancel:false"]);
      expect(base.pixels).toEqual(original);
    });
  });

  test("missing Outliner Cube or foreign Cube face texture refuses to attest full scene", async () => {
    await withBlockbench(async ({ outliner, cube, history }) => {
      const adapter = createBlockbenchUvPixelMigrationAdapter();
      outliner.elements.length = 0;
      expect(() => adapter.readState()).toThrow("UV_PIXEL_MIGRATION_SCENE_UNSUPPORTED");
      outliner.elements.push(cube);
      cube.faces.north.texture = "missing-texture";
      expect(() => adapter.readState()).toThrow("UV_PIXEL_MIGRATION_TEXTURE_SCOPE_INCOMPLETE");
      expect(history).toEqual([]);
    });
  });

  test("Bitmap write failure restores both atlas buffers and UV using owned Undo", async () => {
    await withBlockbench(async ({ base, mer, cube, history }) => {
      const adapter = createBlockbenchUvPixelMigrationAdapter();
      const state = await adapter.readState();
      const plan = planFromNative(cube);
      const revisions: Record<string, string> = {};
      for (const atlas of state.atlases) {
        revisions[atlas.texture_uuid] = await computeTextureRevision(
          atlas.pixels, atlas.width, atlas.height
        );
      }
      const original = mer.edit;
      let failOnce = true;
      mer.edit = (callback, options) => {
        if (failOnce) { failOnce = false; throw Error("second atlas paint failed"); }
        original.call(mer, callback, options);
      };
      const origColor = base.pixels.slice();
      await expect(applyUvPixelMigrationAtomic({
        plan, adapter,
        expected_source_fingerprint: fingerprintUvNativeSource(state.uv),
        expected_atlas_revisions: revisions,
      })).rejects.toThrow("second atlas paint failed");
      expect(history).toEqual(["begin", "cancel:false"]);
      expect(base.pixels).toEqual(origColor);
      expect(cube.faces.north.uv).toEqual([8, 2, 10, 4]);
    });
  });
});
