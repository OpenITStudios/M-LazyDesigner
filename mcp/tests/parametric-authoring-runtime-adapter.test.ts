import { describe, expect, test } from "bun:test";

describe("Blockbench parametric recipe adapter ownership", () => {
  test("runtime adapter is a narrow native boundary, not another planner or MCP surface", async () => {
    const source = await Bun.file("server/runtime/recipes/authoring/runtime.ts").text();
    for (const marker of [
      "readBlockbenchAuthoringRecipeOwnedState",
      "createBlockbenchAuthoringRecipeApplyAdapter",
      "Undo.initEdit",
      "Undo.finishEdit(\"LazyDesigner parametric recipe\"",
      "Undo.cancelEdit(true)",
      "requireOwnedUndo()",
      "activeUndoSave = Undo.current_save",
      "verifyBeforeCommit:",
      "preflightUpserts:",
      "requireBoxUvRepresentableSpan(",
      "validateCubeGeometrySpan(",
      "RECIPE_NATIVE_UNDO_OWNERSHIP_LOST",
      "RECIPE_NATIVE_PRECOMMIT_OWNERSHIP_MISMATCH",
      "authoringRecipeOwnershipPatch",
      "cube.mapAutoUV()",
    ]) expect(source).toContain(marker);
    for (const forbidden of [
      "createTool(",
      "compileAuthoringRecipe(",
      "planIncrementalRecipeRebuild(",
      "search_capabilities",
      "invoke_capability",
    ]) expect(source).not.toContain(forbidden);
    // Native undo is allowed only in the receipt-guarded recovery branch.
    const revert = source.slice(source.indexOf("revertCommittedUndo:"));
    expect(revert).toContain("Undo.index !== Undo.history.length");
    expect(revert).toContain("Undo.index !== binding.provenance.undo_index");
    expect(revert).toContain("RECIPE_UNDO_PROVENANCE");
    expect(revert).toContain("RECIPE_NATIVE_UNDO_STATE_CHANGED");
    expect(revert).toContain("Undo.undo()");
    expect(source.slice(0, source.indexOf("revertCommittedUndo:"))).not.toContain("Undo.undo()");
    expect(source).not.toContain("Undo.redo()");
    const commit = source.slice(
      source.indexOf("commitUndo:"),
      source.indexOf("cancelUndo:")
    );
    expect(commit.indexOf("Object.defineProperty(Undo.current_save"))
      .toBeLessThan(commit.indexOf('Undo.finishEdit("LazyDesigner parametric recipe"'));
  });

  test("native owned Cube snapshot fingerprints bounded ancestor identity, not inferred root", async () => {
    const source = await Bun.file("server/runtime/recipes/authoring/runtime.ts").text();
    const start = source.indexOf("function readRecipeCubeParentPath(");
    const end = source.indexOf("function cubeState(", start);
    const reader = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(reader).toContain('cube.parent === "root"');
    expect(reader).toContain("current instanceof Group");
    expect(reader).toContain("ancestor === null");
    expect(reader).toContain("seen.has(current)");
    expect(reader).toContain("ids.reverse()");
    expect(reader).toContain("RECIPE_NATIVE_PARENT_UNKNOWN");

    const snapshot = source.slice(end, source.indexOf("function resolveOwnedCube", end));
    expect(snapshot).toContain("parent_path: readRecipeCubeParentPath(cube)");
    expect(snapshot).toContain("readBlockbenchAuthoringRecipeOwnedState(recipeId)");
    const upsert = source.slice(source.indexOf("upsert: (placement, existingUuid"),
      source.indexOf("remove: (instanceId", source.indexOf("upsert: (placement, existingUuid")));
    const existing = upsert.slice(upsert.indexOf("if (existingUuid)"),
      upsert.indexOf("const cube = new Cube({"));
    expect(existing).not.toContain("addTo(");
    expect(upsert).toContain('cube.addTo("root")');
    expect(reader).toContain("depth < 64");
  });

  test("native Undo snapshots retain updated elements and encode deletions", async () => {
    const source = await Bun.file("server/runtime/recipes/authoring/runtime.ts").text();
    const before = source.indexOf("Undo.initEdit({");
    const post = source.indexOf('Undo.finishEdit("LazyDesigner parametric recipe"');
    expect(before).toBeGreaterThanOrEqual(0);
    expect(post).toBeGreaterThan(before);
    expect(source).toContain("elements: existing,");
    expect(source).toContain("const surviving = existingAtBegin.filter");
    expect(source).toContain("elements: [...surviving, ...created],");
    expect(source).toContain("outliner: true,");
    expect(source).toContain("Undo.cancelEdit(true)");
    expect(source).toContain("Undo.current_save !== activeUndoSave");
  });

  test("existing manage_cubes remains the public primitive owner", async () => {
    const cubes = await Bun.file("server/tools/geometry/cubes.ts").text();
    expect(cubes).toContain('name: "manage_cubes"');
    expect(cubes).not.toContain("createBlockbenchAuthoringRecipeApplyAdapter");
  });
});
