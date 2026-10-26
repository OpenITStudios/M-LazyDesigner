import { afterEach, describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import {
  emptyAuthoringRecipeStore,
  serializeAuthoringRecipeStore,
  upsertAuthoringRecipeStore,
} from "@/lib/authoringRecipe/store";
import { readRecipePartCaptureScope } from "@/server/runtime/recipes/authoring/service";

const runtime = globalThis as unknown as {
  Project: unknown;
  Cube: unknown;
  Group: unknown;
};
const previousProject = runtime.Project;
const previousCube = runtime.Cube;
const previousGroup = runtime.Group;

class MockGroup {
  origin = [0, 0, 0];
  rotation = [0, 0, 0];
  visibility = true;
  parent: unknown = "root";
  constructor(public uuid: string, public name: string) {}
}

function recipe(): AuthoringRecipe {
  return {
    schema: 1, compiler_version: 1,
    id: "reference-seats", name: "Reference Seats",
    prototypes: [{
      id: "seat", name: "Seat", size: [3, 1, 3], semantic_group: "seat",
    }],
    patterns: [{
      kind: "LINEAR", id: "seats", prototype_id: "seat",
      count: 2, axis: "X", spacing: 3, semantic_group: "seat",
    }],
  };
}

function setNativeScene() {
  const source = recipe();
  const cubes = compileAuthoringRecipe(source).placements.map((placement, index) => ({
    uuid: "native-cube-" + index,
    name: placement.name,
    from: [...placement.from], to: [...placement.to],
    origin: [...placement.origin], rotation: [...placement.rotation],
    inflate: placement.inflate,
    parent: "root" as string | MockGroup,
    lazydesigner_recipe_id: source.id,
    lazydesigner_recipe_instance_id: placement.id,
  }));
  const serialized = serializeAuthoringRecipeStore(
    upsertAuthoringRecipeStore(emptyAuthoringRecipeStore(), source)
  );
  runtime.Project = {
    uuid: "editor-project-1",
    lazydesigner_authoring_recipe_store: serialized,
    textures: [],
  };
  runtime.Cube = { all: cubes };
  runtime.Group = MockGroup;
  return { source, cubes };
}

afterEach(() => {
  runtime.Project = previousProject;
  runtime.Cube = previousCube;
  runtime.Group = previousGroup;
});

describe("current recipe-owned part evidence uses one native identity owner", () => {
  test("resolves exact native Cube UUIDs to independently compiled instance IDs", () => {
    const { source } = setNativeScene();
    const result = readRecipePartCaptureScope(source.id, ["native-cube-0", "native-cube-1"]);
    expect(result.project_uuid).toBe("editor-project-1");
    expect(result.recipe_id).toBe("reference-seats");
    expect(result.native_scope).toBe("RECIPE_OWNED_CUBES_ONLY");
    expect(result.requested_count).toBe(2);
    expect(result.verified_count).toBe(2);
    expect(result.native_snapshot_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.capture_dependency_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.identities.identities.map((item) => ({
      native_uuid: item.native_uuid, instance_id: item.instance_id,
    }))).toEqual([
      { native_uuid: "native-cube-0", instance_id: "seats:0" },
      { native_uuid: "native-cube-1", instance_id: "seats:1" },
    ]);
  });

  test("unknown native UUIDs are not invented or mistaken for missing geometry", () => {
    const { source } = setNativeScene();
    const subset = readRecipePartCaptureScope(source.id, ["native-cube-0", "foreign-cube"]);
    expect(subset.verified_count).toBe(1);
    expect(subset.identities.identities.map((item) => item.native_uuid))
      .toEqual(["native-cube-0"]);
    const none = readRecipePartCaptureScope(source.id, []);
    expect(none.verified_count).toBe(0);
    expect(none.identities.count).toBe(0);
  });


  test("parent group changes invalidate capture without changing recipe/Undo identity", () => {
    const { source, cubes } = setNativeScene();
    const original = readRecipePartCaptureScope(source.id, ["native-cube-0"]);
    const group = new MockGroup("hinge-group", "Hinge");
    (cubes[0] as typeof cubes[number] & { parent?: unknown }).parent = group;
    const attached = readRecipePartCaptureScope(source.id, ["native-cube-0"]);
    expect(attached.native_snapshot_fingerprint).not.toBe(original.native_snapshot_fingerprint);
    expect(attached.capture_dependency_fingerprint).not.toBe(original.capture_dependency_fingerprint);
    group.rotation[1] = 45;
    const turned = readRecipePartCaptureScope(source.id, ["native-cube-0"]);
    expect(turned.capture_dependency_fingerprint).not.toBe(attached.capture_dependency_fingerprint);
    group.origin[0] = 2;
    const pivot = readRecipePartCaptureScope(source.id, ["native-cube-0"]);
    expect(pivot.capture_dependency_fingerprint).not.toBe(turned.capture_dependency_fingerprint);
    group.visibility = false;
    const hidden = readRecipePartCaptureScope(source.id, ["native-cube-0"]);
    expect(hidden.capture_dependency_fingerprint).not.toBe(pivot.capture_dependency_fingerprint);
    expect(hidden.native_snapshot_fingerprint).not.toBe(original.native_snapshot_fingerprint);
  });

  test("atlas pixels and UV edits invalidate capture dependency fingerprints", () => {
    const { source, cubes } = setNativeScene();
    let bitmap = "pixels-before";
    const project = runtime.Project as { textures: Array<Record<string, unknown>> };
    project.textures = [{
      uuid: "atlas", width: 128, height: 128,
      getDataURL: () => "data:image/png;base64," + Buffer.from(bitmap).toString("base64"),
    }];
    const before = readRecipePartCaptureScope(source.id, ["native-cube-0"]);
    bitmap = "pixels-after";
    const after = readRecipePartCaptureScope(source.id, ["native-cube-0"]);
    expect(after.capture_dependency_fingerprint).not.toBe(before.capture_dependency_fingerprint);
    expect(after.native_snapshot_fingerprint).toBe(before.native_snapshot_fingerprint);
    (cubes[0] as typeof cubes[number] & { uv_offset?: number[] }).uv_offset = [8, 4];
    expect(readRecipePartCaptureScope(source.id, ["native-cube-0"])
      .capture_dependency_fingerprint).not.toBe(after.capture_dependency_fingerprint);
    project.textures = [{ uuid: "atlas", width: 128, height: 128 }];
    expect(() => readRecipePartCaptureScope(source.id, []))
      .toThrow("PART_CORRESPONDENCE_TEXTURE_UNREADABLE");
  });

  test("invalid hierarchy and ambiguous texture identities fail closed", () => {
    const { source, cubes } = setNativeScene();
    const loop = new MockGroup("loop", "Loop");
    loop.parent = loop;
    (cubes[0] as typeof cubes[number] & { parent?: unknown }).parent = loop;
    expect(() => readRecipePartCaptureScope(source.id, []))
      .toThrow("RECIPE_NATIVE_PARENT_UNKNOWN");
    loop.parent = "root";
    const project = runtime.Project as { textures: Array<Record<string, unknown>> };
    const same = { uuid: "duplicate", width: 1, height: 1,
      getDataURL: () => "data:image/png;base64," + Buffer.from("pixel").toString("base64") };
    project.textures = [same, same];
    expect(() => readRecipePartCaptureScope(source.id, []))
      .toThrow("PART_CORRESPONDENCE_TEXTURE_IDENTITY_AMBIGUOUS");
  });

  test("integrated scene evidence invalidates after unrelated obstruction, correction and parent movement", () => {
    const { source } = setNativeScene();
    const first = readRecipePartCaptureScope(source.id, ["native-cube-0"]);
    const unrelated = {
      uuid: "foreign", name: "obstruction",
      from: [0, 0, 0], to: [2, 4, 2],
      origin: [1, 2, 1], rotation: [0, 0, 0], inflate: 0,
    };
    (runtime.Cube as { all: unknown[] }).all.push(unrelated);
    const obstructed = readRecipePartCaptureScope(source.id, ["native-cube-0"]);
    expect(obstructed.native_snapshot_fingerprint).toBe(first.native_snapshot_fingerprint);
    expect(obstructed.capture_dependency_fingerprint).not.toBe(first.capture_dependency_fingerprint);
    unrelated.from[0] = 4;
    const corrected = readRecipePartCaptureScope(source.id, ["native-cube-0"]);
    expect(corrected.capture_dependency_fingerprint).not.toBe(obstructed.capture_dependency_fingerprint);
    const group = new MockGroup("foreign-parent", "Foreign");
    (unrelated as typeof unrelated & { parent?: unknown }).parent = group;
    const parented = readRecipePartCaptureScope(source.id, ["native-cube-0"]);
    group.rotation[1] = 45;
    const moved = readRecipePartCaptureScope(source.id, ["native-cube-0"]);
    expect(moved.capture_dependency_fingerprint).not.toBe(parented.capture_dependency_fingerprint);
    expect(moved.native_snapshot_fingerprint).toBe(first.native_snapshot_fingerprint);
  });

  test("stale native geometry and missing persisted recipe fail before image capture", () => {
    const { source, cubes } = setNativeScene();
    cubes[0]!.from[0] += 1;
    expect(() => readRecipePartCaptureScope(source.id, ["native-cube-0"]))
      .toThrow("RECIPE_NATIVE_STATE_MISMATCH");
    setNativeScene();
    runtime.Project = { uuid: "editor-project-1" };
    expect(() => readRecipePartCaptureScope(source.id, ["native-cube-0"]))
      .toThrow("PART_CORRESPONDENCE_RECIPE_NOT_STORED");
  });
});
