import { describe, expect, test } from "bun:test";
import {
  applyBlockbenchUvInstructions,
  createBlockbenchUvApplyAdapter,
  readBlockbenchUvNativeSource,
  restoreBlockbenchUvNativeSource,
} from "@/server/runtime/uv/layoutRuntime";
import type { UvNativeSourceSnapshot } from "@/lib/uv/adapters/blockbenchCubeUv";
import { UvTransactionOutcomeUnknownError } from "@/lib/uv/transaction";

describe("Blockbench UV runtime adapter ownership", () => {
  function withNativeGlobals(cubes: unknown[], operation: () => void): void {
    const names = ["Project", "ModelProject", "Cube", "Canvas"];
    const originals = names.map(name =>
      Object.getOwnPropertyDescriptor(globalThis, name)
    );
    const project = {
      uuid: "native-uv-project",
      texture_width: 32,
      texture_height: 32,
    };
    const values = [project, { all: [project] }, { all: cubes }, { updateAll: () => {} }];
    try {
      names.forEach((name, index) => Object.defineProperty(globalThis, name, {
        configurable: true, writable: true, value: values[index],
      }));
      operation();
    } finally {
      names.forEach((name, index) => {
        const descriptor = originals[index];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      });
    }
  }

  test("duplicate or blank native Cube UUIDs refuse reads and mutations", () => {
    let writes = 0;
    const fake = (uuid: string) => ({
      uuid, box_uv: true, faces: {},
      extend: () => { writes++; },
    });
    withNativeGlobals([fake("duplicate"), fake("duplicate")], () => {
      expect(() => readBlockbenchUvNativeSource()).toThrow(/UV_CUBE_ID_AMBIGUOUS/);
      expect(() => applyBlockbenchUvInstructions([{
        kind: "BOX_UV_OFFSET",
        island_id: "box:duplicate",
        cube_uuid: "duplicate",
        uv_offset: [4, 4],
      }])).toThrow(/UV_CUBE_ID_AMBIGUOUS/);
    });
    withNativeGlobals([fake("")], () => {
      expect(() => readBlockbenchUvNativeSource()).toThrow(/UV_CUBE_ID_REQUIRED/);
    });
    expect(writes).toBe(0);
  });

  test("UV batch checks later Cube mode before extending the first Cube", () => {
    let writes = 0;
    const first = {
      uuid: "first", box_uv: true, faces: {},
      extend: () => { writes++; },
    };
    const second = {
      uuid: "second", box_uv: true, faces: {},
      extend: () => { writes++; },
    };
    withNativeGlobals([first, second], () => {
      expect(() => applyBlockbenchUvInstructions([
        {
          kind: "BOX_UV_OFFSET",
          island_id: "box:first",
          cube_uuid: "first",
          uv_offset: [4, 4],
        },
        {
          kind: "FACE_UV",
          island_id: "face:second:north",
          cube_uuid: "second",
          face: "north",
          uv: [0, 0, 4, 4],
          rotation: 0,
        },
      ])).toThrow(/expected per-face UV/);
    });
    expect(writes).toBe(0);
  });

  test("UV rollback validates later faces before restoring any Cube", () => {
    let writes = 0;
    const first = {
      uuid: "first", box_uv: true, faces: {},
      extend: () => { writes++; },
    };
    const second = {
      uuid: "second", box_uv: false, faces: {},
      extend: () => { writes++; },
    };
    const snapshot = {
      schema: 1,
      project_uuid: "native-uv-project",
      logical_width: 32,
      logical_height: 32,
      cubes: [
        {
          uuid: "first", box_uv: true, uv_offset: [0, 0],
          autouv: 0, mirror_uv: false, faces: [],
        },
        {
          uuid: "second", box_uv: false, uv_offset: null,
          autouv: 0, mirror_uv: false,
          faces: [{
            face: "north", uv: [0, 0, 4, 4],
            rotation: 0, enabled: true,
          }],
        },
      ],
    } as unknown as UvNativeSourceSnapshot;
    withNativeGlobals([first, second], () => {
      expect(() => restoreBlockbenchUvNativeSource(snapshot))
        .toThrow(/could not find face north/);
    });
    expect(writes).toBe(0);
  });


  test("partial native Undo initialization cancels only its own edit and preserves the first fault", async () => {
    const original = ["Project", "ModelProject", "Undo"].map(name =>
      Object.getOwnPropertyDescriptor(globalThis, name)
    );
    const project = { uuid: "uv-fixture-project" };
    const failure = new Error("native Undo initialization failed");
    let cancelled = 0;
    const undo = {
      current_save: null as Record<string, never> | null,
      initEdit: () => { undo.current_save = {}; throw failure; },
      cancelEdit: () => { cancelled++; undo.current_save = null; },
    };
    const mock = (name: string, value: unknown) =>
      Object.defineProperty(globalThis, name, {
        configurable: true, writable: true, value,
      });
    try {
      mock("Project", project);
      mock("ModelProject", { all: [project] });
      mock("Undo", undo);
      const adapter = createBlockbenchUvApplyAdapter();
      let caught: unknown;
      try { await adapter.beginUndo?.([]); }
      catch (error) { caught = error; }
      expect(caught).toBe(failure);
      expect(cancelled).toBe(1);
      expect(undo.current_save).toBeNull();

      // A pre-existing edit is not owned by LazyDesigner and must never be
      // cancelled when the native preflight refuses a new transaction.
      undo.current_save = {};
      await expect(Promise.resolve().then(() => adapter.beginUndo?.([])))
        .rejects.toThrow("Finish the current Blockbench edit");
      expect(cancelled).toBe(1);

      undo.current_save = null;
      undo.cancelEdit = () => { throw new Error("native cancellation failed"); };
      let unknown: unknown;
      try { await adapter.beginUndo?.([]); }
      catch (error) { unknown = error; }
      expect(unknown).toBeInstanceOf(UvTransactionOutcomeUnknownError);
      expect((unknown as UvTransactionOutcomeUnknownError).cause).toBe(failure);
      expect((unknown as UvTransactionOutcomeUnknownError).outcomeUnknown).toBe(true);
    } finally {
      ["Project", "ModelProject", "Undo"].forEach((name, index) => {
        const descriptor = original[index];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      });
    }
  });


  test("UV native pre-Undo guard protects painted atlases even with explicit bitmap scale", async () => {
    const names = ["Project", "ModelProject", "Texture", "Cube", "Undo", "Canvas"];
    const original = names.map(name =>
      Object.getOwnPropertyDescriptor(globalThis, name)
    );
    const pixels = new Uint8ClampedArray(2 * 2 * 4);
    pixels[0] = 42;
    const texture = {
      name: "authored", width: 2, height: 2, display_height: 2,
      frameCount: 1, layers_enabled: false,
      canvas: { width: 2, height: 2 },
      ctx: { getImageData: () => ({ data: pixels }) },
    };
    const project = { uuid: "repack-guard-project", textures: [texture] };
    let undoCalls = 0;
    const undo = {
      current_save: null,
      initEdit: () => { undoCalls++; },
    };
    const values = [
      project, { all: [project] }, { all: [texture] },
      { all: [] }, undo, { updateAll: () => {} },
    ];
    try {
      names.forEach((name, index) => Object.defineProperty(globalThis, name, {
        configurable: true, writable: true, value: values[index],
      }));
      const adapter = createBlockbenchUvApplyAdapter();
      await expect(Promise.resolve().then(() => adapter.beginUndo?.([])))
        .rejects.toThrow("UV_PAINTED_ATLAS_REPACK_BLOCKED");
      expect(undoCalls).toBe(0);

      // A truly empty, flattened bitmap can enter the unchanged native
      // transaction path; this is not an assertion about live Blockbench.
      pixels[0] = 0;
      await adapter.beginUndo?.([]);
      expect(undoCalls).toBe(1);
    } finally {
      names.forEach((name, index) => {
        const descriptor = original[index];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      });
    }
  });

  test("native adapter stays a narrow translation/Undo boundary", async () => {
    const source = await Bun.file(
      "server/runtime/uv/layoutRuntime.ts"
    ).text();

    for (const marker of [
      "readBlockbenchUvNativeSource",
      "applyBlockbenchUvInstructions",
      "restoreBlockbenchUvNativeSource",
      "createBlockbenchUvApplyAdapter",
      "project_uuid",
      "UV_PROJECT_AFFINITY_LOST",
      "UV_PROJECT_AFFINITY_AMBIGUOUS",
      "ModelProject.all",
      "requireUniqueCurrentUvProject",
      "requireBoundProject",
      "Undo.initEdit",
      'Undo.finishEdit("LazyDesigner UV layout")',
      "uv_only: true",
      "Canvas.updateAll()",
    ]) {
      expect(source).toContain(marker);
    }

    for (const forbidden of [
      "packMaxRects",
      "planUvPacking",
      "scoreUvPacking",
      "discoverUvStackProposals",
      "planUvDensity",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test("existing production UV owners are not silently replaced", async () => {
    const [cubes, textureCreate] = await Promise.all([
      Bun.file("server/tools/geometry/cubes.ts").text(),
      Bun.file("server/tools/texture/create.ts").text(),
    ]);
    expect(cubes).toContain("packBoxUvOffsets");
    expect(textureCreate).toContain(
      "await generator.generateTemplate({"
    );
    expect(cubes).not.toContain("createBlockbenchUvApplyAdapter");
    expect(textureCreate).not.toContain(
      "createBlockbenchUvApplyAdapter"
    );
  });
});
