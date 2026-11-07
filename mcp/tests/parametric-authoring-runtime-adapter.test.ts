import { describe, expect, test } from "bun:test";
import {
  classifyAdvancedGeometryRevisionSurface,
  requireFiniteAdvancedGeometrySceneSurface,
} from "../server/runtime/recipes/authoring/advancedConstruction";

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

  test("native adapter uses one pure Group hierarchy owner without reparenting existing Cubes", async () => {
    const [source, nativeState] = await Promise.all([
      Bun.file("server/runtime/recipes/authoring/runtime.ts").text(),
      Bun.file("lib/authoringRecipe/nativeState.ts").text(),
    ]);
    const first = source.indexOf("function cubeState(");
    const last = source.indexOf("function resolveOwnedCube", first);
    const snapshot = source.slice(first, last);
    expect(snapshot).toContain("snapshotRecipeNativeParentHierarchy(");
    expect(snapshot).toContain("cube.parent");
    expect(snapshot).toContain("value instanceof Group");
    expect(snapshot).toContain("...parentState");
    expect(source).not.toContain("function readRecipeCubeParentPath(");
    for (const key of [
      "parent_path", "parent_authored_state", "group.origin",
      "group.rotation", "group.name", "group.visibility", "group.export",
      "group.mirror_uv", "group.reset", "group.bedrock_binding",
      "RECIPE_NATIVE_PARENT_UNKNOWN", "RECIPE_NATIVE_PARENT_TRANSFORM_INVALID",
      "depth < 64",
    ]) expect(nativeState).toContain(key);
    const begin = source.indexOf("upsert: (placement, existingUuid");
    const upsert = source.slice(begin, source.indexOf("remove: (instanceId", begin));
    expect(upsert.slice(upsert.indexOf("if (existingUuid)"),
      upsert.indexOf("const cube = new Cube({"))).not.toContain("addTo(");
    expect(upsert).toContain("cube.addTo(cubeParent)");
    expect(upsert).toContain('createParentGroupUuid === undefined');
    expect(snapshot).not.toContain("Undo.initEdit");
  });

  test("native Undo snapshots retain updated elements and encode deletions", async () => {
    const source = await Bun.file("server/runtime/recipes/authoring/runtime.ts").text();
    const before = source.indexOf("Undo.initEdit(aspects)");
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

const FACE_KEYS = ["north", "south", "east", "west", "up", "down"] as const;

function automaticUntexturedCubeSurface() {
  return {
    autouv: 1,
    mirror_uv: false,
    uv_offset: [0, 0],
    faces: Object.fromEntries(FACE_KEYS.map(key => [key, {
      enabled: true, texture: false as false | string, material_name: "", rotation: 0,
    }])),
  };
}

describe("advanced Geometry revision native surface preflight", () => {
  test("unpainted automatic UV stays revisable without claiming visual correctness", () => {
    expect(classifyAdvancedGeometryRevisionSurface(
      automaticUntexturedCubeSurface()
    )).toBe("AUTO_UV_UNTEXTURED");
    expect(classifyAdvancedGeometryRevisionSurface({
      ...automaticUntexturedCubeSurface(), uv_offset: undefined,
    })).toBe("AUTO_UV_UNTEXTURED");
  });

  test("texture and per-face material ownership refuse a geometry-only revision", () => {
    const textured = automaticUntexturedCubeSurface();
    textured.faces.north!.texture = "atlas-uuid";
    expect(classifyAdvancedGeometryRevisionSurface(textured))
      .toBe("TEXTURE_OR_MATERIAL_OWNED");
    const material = automaticUntexturedCubeSurface();
    material.faces.down!.material_name = "emissive";
    expect(classifyAdvancedGeometryRevisionSurface(material))
      .toBe("TEXTURE_OR_MATERIAL_OWNED");
    const disabledTextured = automaticUntexturedCubeSurface();
    disabledTextured.faces.east!.enabled = false;
    disabledTextured.faces.east!.texture = "atlas-uuid";
    expect(classifyAdvancedGeometryRevisionSurface(disabledTextured))
      .toBe("TEXTURE_OR_MATERIAL_OWNED");
  });

  test("manual modes and explicit UV controls cannot silently survive a resize", () => {
    for (const autouv of [0, 2, undefined]) {
      expect(classifyAdvancedGeometryRevisionSurface({
        ...automaticUntexturedCubeSurface(), autouv,
      })).toBe("CUSTOM_OR_UNVERIFIED_UV");
    }
    for (const override of [
      { mirror_uv: true },
      { uv_offset: [4, 0] },
      { uv_offset: [Number.NaN, 0] },
      { uv_offset: [0] },
    ]) {
      expect(classifyAdvancedGeometryRevisionSurface({
        ...automaticUntexturedCubeSurface(), ...override,
      })).toBe("CUSTOM_OR_UNVERIFIED_UV");
    }
    const rotated = automaticUntexturedCubeSurface();
    rotated.faces.west!.rotation = 90;
    expect(classifyAdvancedGeometryRevisionSurface(rotated))
      .toBe("CUSTOM_OR_UNVERIFIED_UV");
    const hidden = automaticUntexturedCubeSurface();
    hidden.faces.up!.enabled = false;
    expect(classifyAdvancedGeometryRevisionSurface(hidden))
      .toBe("CUSTOM_OR_UNVERIFIED_UV");
  });

  test("partial native face inventories do not count as safe automatic UV", () => {
    const partial = automaticUntexturedCubeSurface();
    delete partial.faces.north;
    expect(classifyAdvancedGeometryRevisionSurface(partial))
      .toBe("CUSTOM_OR_UNVERIFIED_UV");
    expect(classifyAdvancedGeometryRevisionSurface({
      ...automaticUntexturedCubeSurface(), faces: null,
    })).toBe("CUSTOM_OR_UNVERIFIED_UV");
  });

  test("revision path checks the affected native Cube surface before applying Undo", async () => {
    const source = await Bun.file(
      "server/runtime/recipes/authoring/advancedConstruction.ts"
    ).text();
    const prepare = source.slice(source.indexOf("function prepareNativeConstruction("),
      source.indexOf("function boundPlan("));
    expect(prepare).toContain("classifyAdvancedGeometryRevisionSurface(cube)");
    expect(prepare).toContain("ADVANCED_GEOMETRY_TEXTURED_REVISION_REQUIRES_UV_REMAP");
    expect(source.indexOf("function prepareNativeConstruction("))
      .toBeLessThan(source.indexOf("export async function createAdvancedGeometryNative("));
  });
});

describe("advanced Geometry scene fingerprint finite numeric identity", () => {
  const safe = () => ({
    inflate: 0,
    autouv: 1,
    uv_offset: [0, 0],
    faces: Object.fromEntries(FACE_KEYS.map(key => [key, {
      uv: [0, 0, 16, 16],
      rotation: 0,
    }])),
  });
  test("finite native geometry UV values allow the existing scene digest", () => {
    expect(() => requireFiniteAdvancedGeometrySceneSurface(safe()))
      .not.toThrow();
    expect(() => requireFiniteAdvancedGeometrySceneSurface({
      ...safe(), uv_offset: null, inflate: undefined,
    })).not.toThrow();
    expect(() => requireFiniteAdvancedGeometrySceneSurface({
      ...safe(), faces: undefined,
    })).not.toThrow();
  });

  test("JSON-nonfinite Cube scalars and UV offsets fail before a plan hash", () => {
    for (const scalar of [Number.NaN, Infinity, -Infinity]) {
      for (const surface of [
        { ...safe(), inflate: scalar },
        { ...safe(), autouv: scalar },
        { ...safe(), uv_offset: [0, scalar] },
      ]) {
        expect(() => requireFiniteAdvancedGeometrySceneSurface(surface))
          .toThrow("ADVANCED_GEOMETRY_NATIVE_SCENE_INVALID");
      }
    }
    for (const offset of [[], [0], [0, 1, 2], ["0", 1]]) {
      expect(() => requireFiniteAdvancedGeometrySceneSurface({
        ...safe(), uv_offset: offset,
      })).toThrow("ADVANCED_GEOMETRY_NATIVE_SCENE_INVALID");
    }
  });

  test("all six face UV coordinates and rotation remain finite", () => {
    for (const faceKey of FACE_KEYS) {
      for (const change of [
        { uv: [0, Number.NaN, 16, 16], rotation: 0 },
        { uv: [0, 0, 16, 16], rotation: Infinity },
        { uv: [0, 0, 16], rotation: 0 },
      ]) {
        const surface = safe();
        surface.faces[faceKey] = change;
        expect(() => requireFiniteAdvancedGeometrySceneSurface(surface))
          .toThrow("ADVANCED_GEOMETRY_NATIVE_SCENE_INVALID");
      }
    }
  });

  test("scene digest call guards projected Cube and project dimensions", async () => {
    const source = await Bun.file(
      "server/runtime/recipes/authoring/advancedConstruction.ts"
    ).text();
    const scene = source.slice(
      source.indexOf("function sceneFingerprint("),
      source.indexOf("function requireRecipeParentScope(")
    );
    expect(scene).toContain("requireFiniteAdvancedGeometrySceneSurface(cube)");
    expect(scene).toContain('["Project texture_width", Project.texture_width]');
    expect(scene).toContain('["Project texture_height", Project.texture_height]');
    expect(scene.indexOf("requireFiniteAdvancedGeometrySceneSurface(cube)"))
      .toBeLessThan(scene.indexOf('createHash("sha256")'));
  });
});
