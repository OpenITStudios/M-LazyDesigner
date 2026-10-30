import { describe, expect, test } from "bun:test";
import { buildUvLayoutSnapshot } from "@/lib/uv/islands";
import { planUvPacking } from "@/lib/uv/packing/planner";
import {
  buildUvNativeSourceSnapshot,
  fingerprintUvNativeSource,
  type UvNativeMutationInstruction,
} from "@/lib/uv/adapters/blockbenchCubeUv";
import type { UvLayoutPlan } from "@/lib/uv/contracts";
import {
  applyUvPixelMigrationAtomic,
  UvPixelMigrationOutcomeUnknownError,
  type UvPixelMigrationAtomicAdapter,
  type UvPixelMigrationScopedState,
} from "@/lib/uv/pixelMigrationTransaction";
import { computeTextureRevision } from "@/lib/texture/revision";

function fixture(includeDisabledFace = false) {
  const cube = {
    uuid: "panel", name: "panel",
    from: [0, 0, 0], to: [2, 2, 1],
    box_uv: false, autouv: 0, mirror_uv: false,
    faces: [{
      face: "north" as const,
      uv: [8, 2, 10, 4] as [number, number, number, number],
      rotation: 0,
    }, ...(includeDisabledFace ? [{
      face: "south" as const,
      uv: [0, 0, 1, 1] as [number, number, number, number],
      rotation: 0,
      enabled: false,
    }] : [])],
  };
  const plan = planUvPacking(buildUvLayoutSnapshot(
    [cube], 16, 16, () => ({ padding_pixels: 0 })
  ), { bitmap_width: 16, bitmap_height: 16 });
  const uv = buildUvNativeSourceSnapshot(
    [cube], 16, 16, "uv-migration-project"
  );
  const makeAtlas = (uuid: string) => ({
    texture_uuid: uuid,
    width: 16,
    height: 16,
    frame_count: 1 as const,
    layers_enabled: false as const,
    pixels: new Uint8ClampedArray(16 * 16 * 4),
  });
  const base = makeAtlas("base");
  const mer = makeAtlas("mer");
  base.pixels.set([11, 22, 33, 255], (2 * 16 + 8) * 4);
  mer.pixels.set([0, 55, 0, 255], (2 * 16 + 8) * 4);
  const initial: UvPixelMigrationScopedState = {
    uv,
    atlases: [base, mer],
    scope: {
      project_uuid: uv.project_uuid!,
      all_cube_uuids: ["panel"],
      all_texture_uuids: ["base", "mer"],
      face_texture_bindings: [
        { cube_uuid: "panel", face: "north", texture_uuid: "base" },
        ...(includeDisabledFace ? [
          { cube_uuid: "panel", face: "south", texture_uuid: null },
        ] : []),
      ],
      uv_owner_scope: "complete_cube_only",
      unsupported_uv_owner_count: 0,
    },
  };
  const harness: {
    state: UvPixelMigrationScopedState;
    calls: string[];
    adapter: UvPixelMigrationAtomicAdapter;
  } = {
    state: structuredClone(initial),
    calls: [],
    adapter: null as never,
  };
  harness.adapter = {
    readState: () => {
      harness.calls.push("read");
      return structuredClone(harness.state);
    },
    beginUndo: (instructions, textureUuids) => {
      harness.calls.push("begin");
      expect(instructions).toHaveLength(1);
      expect(textureUuids).toEqual(["base", "mer"]);
    },
    applyAtlases: (candidates) => {
      harness.calls.push("textures");
      harness.state.atlases = harness.state.atlases.map(atlas => {
        const candidate = candidates.find(x => x.texture_uuid === atlas.texture_uuid)!;
        return { ...atlas, pixels: new Uint8ClampedArray(candidate.pixels) };
      });
    },
    applyUv: (instructions: readonly UvNativeMutationInstruction[]) => {
      harness.calls.push("uv");
      for (const instruction of instructions) {
        const cube = harness.state.uv.cubes.find(cube =>
          cube.uuid === instruction.cube_uuid
        )!;
        if (instruction.kind === "BOX_UV_OFFSET") {
          cube.uv_offset = [...instruction.uv_offset];
        } else {
          const face = cube.faces.find(face => face.face === instruction.face)!;
          face.uv = [...instruction.uv];
          face.rotation = instruction.rotation;
        }
      }
    },
    restoreAll: before => {
      harness.calls.push("restore");
      harness.state = structuredClone(before);
    },
    cancelUndo: () => {
      harness.calls.push("cancel");
    },
    finishUndo: () => {
      harness.calls.push("commit");
    },
  };
  return { harness, plan, initial };
}

async function request(h: ReturnType<typeof fixture>, plan: UvLayoutPlan = h.plan) {
  const expected_atlas_revisions: Record<string, string> = {};
  for (const atlas of h.harness.state.atlases) {
    expected_atlas_revisions[atlas.texture_uuid] = await computeTextureRevision(
      atlas.pixels, atlas.width, atlas.height
    );
  }
  return {
    plan,
    adapter: h.harness.adapter,
    expected_source_fingerprint: fingerprintUvNativeSource(h.initial.uv),
    expected_atlas_revisions,
  };
}

function rgbaAt(bytes: Uint8ClampedArray, x: number, y: number) {
  return Array.from(bytes.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4));
}

describe("atomic Texture + UV source transaction contract (adapter-only)", () => {
  test("one bounded Undo unit commits UV and every dependent bitmap after exact readback", async () => {
    const f = fixture();
    const r = await applyUvPixelMigrationAtomic(await request(f));
    expect(r.execution).toBe("committed_by_adapter");
    expect(r.native_runtime_attested).toBe(false);
    expect(r.saved_model_attested).toBe(false);
    expect(r.visual_verdict).toBe("not_evaluated");
    expect(r.moved_island_ids).toEqual(["face:panel:north"]);
    expect(r.texture_revisions.map(t => t.texture_uuid)).toEqual(["base", "mer"]);
    expect(r.texture_revisions.every(t => t.before_revision !== t.after_revision)).toBe(true);
    expect(f.harness.calls).toEqual([
      "read", "read", "begin", "textures", "uv", "read", "read", "commit",
    ]);
    const rect = f.plan.proposed.islands[0].rect;
    expect(rgbaAt(f.harness.state.atlases[0].pixels, rect.x, rect.y))
      .toEqual([11, 22, 33, 255]);
    expect(rgbaAt(f.harness.state.atlases[1].pixels, rect.x, rect.y))
      .toEqual([0, 55, 0, 255]);
    expect(rgbaAt(f.initial.atlases[0].pixels, 8, 2))
      .toEqual([11, 22, 33, 255]);
  });

  test("oversized or non-flat atlas inventory fails before cloning bitmap snapshots", async () => {
    for (const problem of ["oversized", "layered"] as const) {
      const f = fixture();
      const input = await request(f);
      if (problem === "oversized") f.harness.state.atlases[0] = {
        ...f.harness.state.atlases[0], width: 9_000_000,
      };
      else f.harness.state.atlases[0] = {
        ...f.harness.state.atlases[0], layers_enabled: true as never,
      };
      await expect(applyUvPixelMigrationAtomic(input))
        .rejects.toThrow(problem === "oversized"
          ? "UV_PIXEL_MIGRATION_BITMAP_BUDGET"
          : "UV_PIXEL_MIGRATION_ATLAS_SCOPE");
      expect(f.harness.calls).toEqual(["read"]);
    }
  });

  test("missing dependent atlas or non-Cube UV owner is rejected before Undo", async () => {
    const omitted = fixture();
    omitted.harness.state.atlases.pop();
    await expect(applyUvPixelMigrationAtomic(await request(omitted)))
      .rejects.toThrow("UV_PIXEL_MIGRATION_SCOPE_INCOMPLETE");
    expect(omitted.harness.calls).toEqual(["read"]);

    const mesh = fixture();
    mesh.harness.state.scope = {
      ...mesh.harness.state.scope,
      unsupported_uv_owner_count: 1 as never,
    };
    await expect(applyUvPixelMigrationAtomic(await request(mesh)))
      .rejects.toThrow("UV_PIXEL_MIGRATION_SCOPE_INCOMPLETE");
    expect(mesh.harness.calls).toEqual(["read"]);
  });

  test("wrong caller revision and missing revision entry reject before Undo", async () => {
    const f = fixture();
    const stale = await request(f);
    stale.expected_atlas_revisions.base = "sha256:16x16:" + "a".repeat(64);
    await expect(applyUvPixelMigrationAtomic(stale)).rejects.toThrow(
      "changed since the caller observed it"
    );
    expect(f.harness.calls).toEqual(["read"]);
    f.harness.calls.length = 0;
    const missing = await request(f);
    delete missing.expected_atlas_revisions.mer;
    await expect(applyUvPixelMigrationAtomic(missing))
      .rejects.toThrow("UV_PIXEL_MIGRATION_REVISION_SCOPE");
    expect(f.harness.calls).toEqual(["read"]);
  });

  test("same-UUID source repaint during asynchronous planning rejects before Undo", async () => {
    const f = fixture();
    const originalRead = f.harness.adapter.readState;
    let reads = 0;
    f.harness.adapter.readState = () => {
      reads++;
      if (reads === 2) f.harness.state.atlases[0].pixels[0] = 99;
      return originalRead();
    };
    await expect(applyUvPixelMigrationAtomic(await request(f)))
      .rejects.toThrow("UV_PIXEL_MIGRATION_STALE_BITMAP");
    expect(f.harness.calls).toEqual(["read", "read"]);
  });

  test("failure after bitmap write restores all RGBA and UV before canceling Undo", async () => {
    const f = fixture();
    const before = structuredClone(f.harness.state);
    const originalApply = f.harness.adapter.applyUv;
    f.harness.adapter.applyUv = async commands => {
      await originalApply(commands);
      throw new Error("native UV writer failed");
    };
    await expect(applyUvPixelMigrationAtomic(await request(f)))
      .rejects.toThrow("native UV writer failed");
    expect(f.harness.calls).toEqual([
      "read", "read", "begin", "textures", "uv", "restore", "cancel", "read",
    ]);
    expect(f.harness.state).toEqual(before);
  });

  test("out-of-scope native bitmap paint fails postcondition and performs verified rollback", async () => {
    const f = fixture();
    const before = structuredClone(f.harness.state);
    const original = f.harness.adapter.applyAtlases;
    f.harness.adapter.applyAtlases = async candidates => {
      await original(candidates);
      f.harness.state.atlases[0].pixels[0] = 215;
    };
    await expect(applyUvPixelMigrationAtomic(await request(f)))
      .rejects.toThrow("UV_PIXEL_MIGRATION_STALE_BITMAP");
    expect(f.harness.calls).not.toContain("commit");
    expect(f.harness.calls).toContain("restore");
    expect(f.harness.state).toEqual(before);
  });

  test("candidate object mutation by native writer cannot launder the expected digest", async () => {
    const f = fixture();
    const original = f.harness.adapter.applyAtlases;
    f.harness.adapter.applyAtlases = async candidates => {
      candidates[0].pixels[0] = 201;
      await original(candidates);
    };
    await expect(applyUvPixelMigrationAtomic(await request(f)))
      .rejects.toThrow("UV_PIXEL_MIGRATION_STALE_BITMAP");
    expect(f.harness.calls).not.toContain("commit");
    expect(f.harness.calls).toContain("restore");
  });

  test("failed restoration or mismatch after cancel becomes OUTCOME_UNKNOWN", async () => {
    for (const breakRestore of ["throws", "wrong_bytes"] as const) {
      const f = fixture();
      f.harness.adapter.applyUv = () => {
        throw new Error("native fault");
      };
      const original = f.harness.adapter.restoreAll;
      f.harness.adapter.restoreAll = async before => {
        if (breakRestore === "throws") throw new Error("restore unavailable");
        await original(before);
        f.harness.state.atlases[0].pixels[0] = 55;
      };
      let caught: unknown;
      try {
        await applyUvPixelMigrationAtomic(await request(f));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UvPixelMigrationOutcomeUnknownError);
      const unknown = caught as UvPixelMigrationOutcomeUnknownError;
      expect(unknown.outcomeUnknown).toBe(true);
      expect(unknown.recoveryFailures.length).toBeGreaterThan(0);
      expect(f.harness.calls).not.toContain("commit");
    }
  });

  test("uncertain beginUndo cannot cancel an edit whose ownership is unproven", async () => {
    const f = fixture();
    f.harness.adapter.beginUndo = () => {
      f.harness.calls.push("begin");
      throw new Error("partial native Undo open");
    };
    await expect(applyUvPixelMigrationAtomic(await request(f)))
      .rejects.toBeInstanceOf(UvPixelMigrationOutcomeUnknownError);
    expect(f.harness.calls).toEqual(["read", "read", "begin"]);
  });

  test("finishUndo failure is never blindly rolled back or retried", async () => {
    const f = fixture();
    f.harness.adapter.finishUndo = () => {
      f.harness.calls.push("commit");
      throw new Error("native Undo outcome uncertain");
    };
    const initial = structuredClone(f.harness.state);
    await expect(applyUvPixelMigrationAtomic(await request(f)))
      .rejects.toBeInstanceOf(UvPixelMigrationOutcomeUnknownError);
    expect(f.harness.calls).not.toContain("restore");
    expect(f.harness.calls).not.toContain("cancel");
    expect(f.harness.state).not.toEqual(initial);
  });

  test("fresh UV/bitmap read after digest catches late native changes before commit", async () => {
    const f = fixture();
    const originalRead = f.harness.adapter.readState;
    let reads = 0;
    f.harness.adapter.readState = () => {
      reads++;
      if (reads === 4) f.harness.state.atlases[1].pixels[0] = 207;
      return originalRead();
    };
    const original = structuredClone(f.harness.state);
    await expect(applyUvPixelMigrationAtomic(await request(f)))
      .rejects.toThrow("UV_PIXEL_MIGRATION_STALE_BITMAP");
    expect(f.harness.calls).not.toContain("commit");
    expect(f.harness.calls).toContain("restore");
    expect(f.harness.state).toEqual(original);
  });

  test("unexpected geometry edits cannot hide behind correct UV and bitmap writes", async () => {
    const f = fixture();
    const initial = structuredClone(f.harness.state);
    const apply = f.harness.adapter.applyUv;
    f.harness.adapter.applyUv = async commands => {
      await apply(commands);
      f.harness.state.uv.cubes[0].from[0] += 1;
    };
    await expect(applyUvPixelMigrationAtomic(await request(f)))
      .rejects.toThrow("UV_APPLY_SCOPE_VIOLATION");
    expect(f.harness.calls).toContain("restore");
    expect(f.harness.state).toEqual(initial);
  });

  test("foreign Cube/Texture inventory appearing after planning prevents Undo", async () => {
    const f = fixture();
    const read = f.harness.adapter.readState;
    let reads = 0;
    f.harness.adapter.readState = () => {
      if (++reads === 2) {
        f.harness.state.scope.all_texture_uuids.push("late-variant");
      }
      return read();
    };
    await expect(applyUvPixelMigrationAtomic(await request(f)))
      .rejects.toThrow("UV_PIXEL_MIGRATION_SCOPE_INCOMPLETE");
    expect(f.harness.calls).not.toContain("begin");
  });

  test("async beginUndo is forbidden because edit ownership is not synchronized", async () => {
    const f = fixture();
    f.harness.adapter.beginUndo = (() => Promise.resolve()) as never;
    await expect(applyUvPixelMigrationAtomic(await request(f)))
      .rejects.toBeInstanceOf(UvPixelMigrationOutcomeUnknownError);
    expect(f.harness.calls).toEqual(["read", "read"]);
  });

  test("async finishUndo is an uncertain commit, never a rollback permission", async () => {
    const f = fixture();
    f.harness.adapter.finishUndo = (() => Promise.resolve()) as never;
    await expect(applyUvPixelMigrationAtomic(await request(f)))
      .rejects.toBeInstanceOf(UvPixelMigrationOutcomeUnknownError);
    expect(f.harness.calls).not.toContain("restore");
    expect(f.harness.calls).not.toContain("cancel");
  });

  test("face-to-texture reassignment is refused before committing even when UV and RGBA match", async () => {
    const f = fixture();
    const read = f.harness.adapter.readState;
    let reads = 0;
    f.harness.adapter.readState = () => {
      reads++;
      if (reads === 2) {
        f.harness.state.scope.face_texture_bindings[0].texture_uuid = "mer";
      }
      return read();
    };
    await expect(applyUvPixelMigrationAtomic(await request(f)))
      .rejects.toThrow("UV_PIXEL_MIGRATION_SCENE_CHANGED");
    expect(f.harness.calls).toEqual(["read", "read"]);
  });

  test("missing or unknown face texture ownership fails the preflight without Undo", async () => {
    for (const mutation of ["missing", "unknown"] as const) {
      const f = fixture();
      if (mutation === "missing") f.harness.state.scope.face_texture_bindings = [];
      else f.harness.state.scope.face_texture_bindings[0].texture_uuid = "foreign-texture";
      await expect(applyUvPixelMigrationAtomic(await request(f)))
        .rejects.toThrow("UV_PIXEL_MIGRATION_SCOPE_INCOMPLETE");
      expect(f.harness.calls).toEqual(["read"]);
    }
  });

  test("moved active UV face with null Texture owner refuses migration before Undo", async () => {
    const f = fixture();
    f.harness.state.scope.face_texture_bindings[0].texture_uuid = null;
    const before = structuredClone(f.harness.state);
    await expect(applyUvPixelMigrationAtomic(await request(f)))
      .rejects.toThrow("moved active face");
    expect(f.harness.calls).toEqual(["read"]);
    expect(f.harness.state).toEqual(before);
  });

  test("disabled untextured face outside moved UV scope remains eligible", async () => {
    const f = fixture(true);
    expect(f.plan.before.islands).toHaveLength(1);
    expect(f.harness.state.scope.face_texture_bindings).toHaveLength(2);
    const result = await applyUvPixelMigrationAtomic(await request(f));
    expect(result.execution).toBe("committed_by_adapter");
    expect(f.harness.calls).toEqual([
      "read", "read", "begin", "textures", "uv", "read", "read", "commit",
    ]);
    expect(f.harness.state.scope.face_texture_bindings[1].texture_uuid).toBeNull();
    expect(f.harness.state.uv.cubes[0].faces.find(face =>
      face.face === "south"
    )?.enabled).toBe(false);
  });

  test("zero-delta plans refuse before native source reads or Undo", async () => {
    const f = fixture();
    const noMovement = { ...f.plan, moved_island_ids: [] };
    await expect(applyUvPixelMigrationAtomic(await request(f, noMovement)))
      .rejects.toThrow("UV_PIXEL_MIGRATION_NO_OP");
    expect(f.harness.calls).toEqual([]);
  });
});
