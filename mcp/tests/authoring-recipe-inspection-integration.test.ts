import { afterEach, describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import {
  emptyAuthoringRecipeStore,
  serializeAuthoringRecipeStore,
  upsertAuthoringRecipeStore,
} from "@/lib/authoringRecipe/store";
import {
  inspectElementParameters,
  inspectElementSource,
} from "@/server/tools/element/inspection";
import {
  consolidatedInspectionBranches,
} from "@/server/runtime/consolidatedTools";
import { getConsolidatedExecutor } from "@/server/runtime/consolidatedRoutes";

type NativeMockGlobals = {
  Project: unknown;
  ModelProject: unknown;
  Cube: unknown;
  Group: unknown;
  Locator: unknown;
  NullObject: unknown;
  Texture: unknown;
  TextureGroup: unknown;
  AnimationItem: unknown;
  AnimationController: unknown;
  BoneAnimator: unknown;
};
const runtime = globalThis as unknown as NativeMockGlobals;
const globals: (keyof NativeMockGlobals)[] = [
  "Project", "ModelProject", "Cube", "Group", "Locator", "NullObject",
  "Texture", "TextureGroup", "AnimationItem", "AnimationController", "BoneAnimator",
];
const originals = Object.fromEntries(globals.map(key => [key, runtime[key]])) as NativeMockGlobals;
const FACE_KEYS = ["north", "south", "east", "west", "up", "down"] as const;

class NativeCube {
  static all: NativeCube[] = [];
  uuid!: string;
  name!: string;
  from!: number[];
  to!: number[];
  origin!: number[];
  rotation!: number[];
  inflate!: number;
  parent: unknown = "root";
  box_uv = true;
  autouv = 1;
  mirror_uv = false;
  uv_offset = [0, 0];
  export = true;
  visibility = true;
  lazydesigner_recipe_id!: string;
  lazydesigner_recipe_instance_id!: string;
  faces: Record<string, {
    uv: number[];
    rotation: number;
    enabled: boolean;
    texture: false;
    material_name: string;
  }> = {};
  constructor(value: Record<string, unknown>) {
    Object.assign(this, value);
    this.faces = Object.fromEntries(FACE_KEYS.map(face => [face, {
      uv: [0, 0, 2, 2],
      rotation: 0,
      enabled: true,
      texture: false as const,
      material_name: "",
    }]));
  }
  extend(): never { throw new Error("Recipe inspection must not update Cubes."); }
  remove(): never { throw new Error("Recipe inspection must not remove Cubes."); }
}
class NativeGroup {
  static all: NativeGroup[] = [];
  parent: unknown = "root";
  origin = [0, 0, 0];
  rotation = [0, 0, 0];
  constructor(public uuid: string, public name: string) {}
}
class NativeLocator { static all: NativeLocator[] = []; }
class NativeNullObject { static all: NativeNullObject[] = []; }

function fixtureRecipe(): AuthoringRecipe {
  return {
    schema: 1, compiler_version: 1,
    id: "recipe-inspection-integration",
    name: "Recipe Inspection Integration",
    prototypes: [{
      id: "part", name: "Coincident part", size: [2, 2, 2],
    }],
    patterns: [{
      kind: "LINEAR", id: "pair", prototype_id: "part",
      count: 2, axis: "X", spacing: 0, start: [0, 0, 0],
    }],
  };
}

function setupNativeRecipe() {
  const recipe = fixtureRecipe();
  const compiled = compileAuthoringRecipe(recipe);
  NativeCube.all = compiled.placements.map((placement, index) => new NativeCube({
    uuid: "native-pair-" + index,
    name: placement.name,
    from: [...placement.from],
    to: [...placement.to],
    origin: [...placement.origin],
    rotation: [...placement.rotation],
    inflate: placement.inflate,
    parent: "root",
    lazydesigner_recipe_id: recipe.id,
    lazydesigner_recipe_instance_id: placement.id,
  }));
  NativeGroup.all = [];
  const project = {
    uuid: "recipe-inspection-project",
    texture_width: 32,
    texture_height: 32,
    textures: [],
    lazydesigner_authoring_recipe_store: serializeAuthoringRecipeStore(
      upsertAuthoringRecipeStore(emptyAuthoringRecipeStore(), recipe)
    ),
  };
  runtime.Project = project;
  runtime.ModelProject = { all: [project] };
  runtime.Cube = NativeCube;
  runtime.Group = NativeGroup;
  runtime.Locator = NativeLocator;
  runtime.NullObject = NativeNullObject;
  runtime.Texture = { all: [] };
  runtime.TextureGroup = { all: [] };
  runtime.AnimationItem = undefined;
  runtime.AnimationController = undefined;
  runtime.BoneAnimator = undefined;
  return { recipe, project, cubes: NativeCube.all };
}
afterEach(() => {
  for (const key of globals) runtime[key] = originals[key];
  NativeCube.all = [];
  NativeGroup.all = [];
});

describe("B12 existing inspect_elements detail → Recipe optimization source integration", () => {
  test("public detail schema inherits opt-in Recipe review without adding a new consolidated branch", () => {
    expect(inspectElementParameters.safeParse({
      id: "native-pair-0", detail: "geometry",
      recipe_optimization_review: true,
    }).success).toBe(true);
    expect(consolidatedInspectionBranches.detail.safeParse({
      mode: "detail", id: "native-pair-0",
      recipe_optimization_review: true,
    }).success).toBe(true);
    expect(inspectElementParameters.safeParse({
      id: "native-pair-0", recipe_optimization_review: "yes",
    }).success).toBe(false);
    expect(Object.keys(consolidatedInspectionBranches).sort())
      .toEqual(["detail", "outline", "search"]);
    expect(getConsolidatedExecutor("inspect_elements", "detail"))
      .toBe("inspect_element");
    expect(inspectElementParameters.parse({ id: "native-pair-0" }))
      .toMatchObject({ id: "native-pair-0", detail: "geometry" });
  });

  test("ordinary detail remains unchanged; explicit Recipe review reaches the existing native service", async () => {
    const { recipe, cubes } = setupNativeRecipe();
    const id = cubes[0]!.uuid;
    const ordinary = await inspectElementSource({ id });
    expect(ordinary.structuredContent).toMatchObject({
      uuid: id, type: "cube", authored_space: "blockbench_model",
    });
    expect(ordinary.structuredContent).not.toHaveProperty("recipe_optimization_review");
    expect(ordinary.content[0]!.text).toBe(
      `Inspected cube "${cubes[0]!.name}" (${id}).`
    );
    const inspected = await inspectElementSource({
      id, recipe_optimization_review: true,
    });
    expect(inspected.structuredContent).toMatchObject({
      uuid: id, type: "cube",
      recipe_optimization_review: {
        selected_cube_uuid: id,
        selected_recipe_id: recipe.id,
        selected_instance_id: "pair:0",
        state: "REVIEW_ONLY",
        scope: "EXACT_RECIPE_OWNED_NATIVE_AUTHORED_GEOMETRY",
        inspected_native_cube_count: 2,
        coincident_group_count: 1,
        surface_evidence_state: "SNAPSHOT_BOUND",
        optimization_review_plan: {
          state: "PREPARED_SOURCE_ONLY",
          native_review_executed: false,
          native_mutation_authorized: false,
        },
        native_mutation_executed: false,
        visual_verdict: "NOT_EVALUATED",
        estimated_removable_cube_count: null,
      },
    });
    expect(inspected.content[0]!.text).toContain("no native review or deletion executed");
    expect(cubes).toHaveLength(2);
    expect(cubes[0]!.from).toEqual([0, 0, 0]);
  });

  test("opt-in review rejects a unique name instead of trusting name-based Recipe identity", async () => {
    const { cubes } = setupNativeRecipe();
    await expect(inspectElementSource({
      id: cubes[0]!.name, recipe_optimization_review: true,
    })).rejects.toThrow("RECIPE_OPTIMIZATION_UUID_REQUIRED");
    const ordinary = await inspectElementSource({ id: cubes[0]!.name });
    expect(ordinary.structuredContent).not.toHaveProperty("recipe_optimization_review");
  });

  test("opt-in review rejects a Cube without saved Recipe ownership", async () => {
    const { cubes } = setupNativeRecipe();
    cubes[0]!.lazydesigner_recipe_id = "";
    cubes[0]!.lazydesigner_recipe_instance_id = "";
    await expect(inspectElementSource({
      id: cubes[0]!.uuid, recipe_optimization_review: true,
    })).rejects.toThrow("RECIPE_OPTIMIZATION_OWNERSHIP_REQUIRED");
    const ordinary = await inspectElementSource({ id: cubes[0]!.uuid });
    expect(ordinary.structuredContent).toMatchObject({ type: "cube" });
  });

  test("opt-in review refuses Group targets without calling Recipe source inspection", async () => {
    setupNativeRecipe();
    NativeGroup.all = [new NativeGroup("group-excluded", "Unowned Group")];
    await expect(inspectElementSource({
      id: "group-excluded", recipe_optimization_review: true,
    })).rejects.toThrow("RECIPE_OPTIMIZATION_CUBE_REQUIRED");
  });

  test("stale source geometry fails closed instead of inventing a redundant Cube candidate", async () => {
    const { cubes } = setupNativeRecipe();
    cubes[0]!.from[0] = 5;
    await expect(inspectElementSource({
      id: cubes[0]!.uuid, recipe_optimization_review: true,
    })).rejects.toThrow("RECIPE_NATIVE_STATE_MISMATCH");
  });

  test("missing saved Recipe fails explicitly and ordinary inspection stays functional", async () => {
    const { project, cubes } = setupNativeRecipe();
    project.lazydesigner_authoring_recipe_store = serializeAuthoringRecipeStore(
      emptyAuthoringRecipeStore()
    );
    await expect(inspectElementSource({
      id: cubes[0]!.uuid, recipe_optimization_review: true,
    })).rejects.toThrow("RECIPE_NOT_STORED");
    const ordinary = await inspectElementSource({ id: cubes[0]!.uuid });
    expect(ordinary.structuredContent).toMatchObject({ type: "cube" });
  });
});
