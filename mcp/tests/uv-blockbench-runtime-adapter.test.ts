import { describe, expect, test } from "bun:test";

describe("Blockbench UV runtime adapter ownership", () => {
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
