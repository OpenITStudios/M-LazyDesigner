import { describe, expect, test } from "bun:test";
import { createBlockbenchUvApplyAdapter } from "@/server/runtime/uv/layoutRuntime";
import { UvTransactionOutcomeUnknownError } from "@/lib/uv/transaction";

describe("Blockbench UV runtime adapter ownership", () => {
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
