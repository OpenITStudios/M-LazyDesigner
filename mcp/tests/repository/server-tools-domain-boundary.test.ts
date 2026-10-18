import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const MIGRATED_TOOL_WRAPPERS: Readonly<Record<string, string>> = {
  "locators.ts": 'export * from "./geometry/locators";\n',
  "export.ts": 'export * from "./io/export";\n',
  "import.ts": 'export * from "./io/import";\n',
  "history.ts": 'export * from "./state/history";\n',
  "ui.ts": 'export * from "./interaction/ui";\n',
  "element-inspection.ts": 'export * from "./element/inspection";\n',
  "animation-effects.ts": 'export * from "./animation/effects";\n',
  "animation-native-intelligence.ts":
    'export * from "../runtime/extensions/animation/nativeIntelligence";\n',
  "animation-controller-native-intelligence.ts":
    'export * from "../runtime/extensions/animation/controllerNativeIntelligence";\n',
  "animation-runtime-resource-intelligence.ts":
    'export * from "../runtime/extensions/animation/runtimeResourceIntelligence";\n',
  "texture-authoring-runtime.ts":
    'export * from "../runtime/extensions/texture/authoring";\n',
  "texture-quality-runtime.ts":
    'export * from "../runtime/extensions/texture/quality";\n',
  "texture-alpha-runtime.ts":
    'export * from "../runtime/extensions/texture/alpha";\n',
  "animation-inspection.ts": 'export * from "./animation/inspection";\n',
  "material-instances.ts": 'export * from "./texture/materialInstances";\n',
  "paint-texture-transaction.ts": 'export * from "./paint/textureTransaction";\n',
  "texture-material-validation.ts": 'export * from "./texture/materialValidation";\n',
  "camera.ts": 'export * from "./inspection/camera";\n',
  "render-profile.ts": 'export * from "./texture/renderProfile";\n',
  "quality-intelligence.ts": 'export * from "./validation/qualityIntelligence";\n',
  "quality-evidence-runtime.ts": 'export * from "./validation/qualityEvidenceRuntime";\n',
  "cubes.ts": 'export * from "./geometry/cubes";\n',
  "project.ts": 'export * from "./project/project";\n',
  "particle.ts": 'export * from "./particle/manage";\n',
  "particle-inspection.ts": 'export * from "./particle/inspection";\n',
  "particle-file-transaction.ts": 'export * from "./particle/fileTransaction";\n',
  "element-shared.ts": 'export * from "./element/shared";\n',
  "element-discovery.ts": 'export * from "./element/discovery";\n',
  "element-hierarchy.ts": 'export * from "./element/hierarchy";\n',
  "element-mutation.ts": 'export * from "./element/mutation";\n',
  "animation-rigging.ts": 'export * from "./animation/rigging";\n',
  "animation-batch.ts": 'export * from "./animation/batch";\n',
  "texture-atlas.ts": 'export * from "./texture/atlas";\n',
  "paint-primitives.ts": 'export * from "./paint/primitives";\n',
  "paint-brush.ts": 'export * from "./paint/brush";\n',
  "paint-settings.ts": 'export * from "./paint/settings";\n',
  "paint-selection-layers.ts": 'export * from "./paint/selectionLayers";\n',
  "animation-controller.ts": 'export * from "./animation/controller";\n',
  "animation-create.ts": 'export * from "./animation/create";\n',
  "animation-keyframes.ts": 'export * from "./animation/keyframes";\n',
  "animation-timeline.ts": 'export * from "./animation/timeline";\n',
  "texture-create.ts": 'export * from "./texture/create";\n',
  "texture-materials.ts": 'export * from "./texture/materials";\n',
  "texture-read.ts": 'export * from "./texture/read";\n',
  "texture-assignment.ts": 'export * from "./texture/assignment";\n',
  "animation-shared.ts": 'export * from "./animation/shared";\n',
  "animation-controller-state.ts":
    'export * from "./animation/controllerState";\n',
  "animation-effect-state.ts":
    'export * from "./animation/effectState";\n',
  "paint-shared.ts": 'export * from "./paint/shared";\n',
  "paint-layer-state.ts": 'export * from "./paint/layerState";\n',
};

const MIGRATED_TOOL_IMPORTS = new Set(
  Object.keys(MIGRATED_TOOL_WRAPPERS).map(
    (name) => `@/server/tools/${name.replace(/\.ts$/, "")}`
  )
);

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if (entry.isFile() && path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

function importsOf(source: string): string[] {
  return [...source.matchAll(
    /(?:import[\s\S]*?from\s*|export\s+(?:\*|\{[\s\S]*?\})\s+from\s*)["']([^"']+)["']/g
  )].map((match) => match[1]!);
}

describe("server tool domain ownership", () => {

  test("tools root contains only registrar facades or registered compatibility wrappers", async () => {
    const allowedRegistrars = new Set([
      "animation.ts",
      "texture.ts",
      "paint.ts",
      "element.ts",
    ]);
    const rootFiles = (await readdir("server/tools", { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => entry.name)
      .sort();

    const unexpected = rootFiles.filter(
      (name) =>
        !allowedRegistrars.has(name) &&
        !Object.prototype.hasOwnProperty.call(MIGRATED_TOOL_WRAPPERS, name)
    );

    expect(unexpected).toEqual([]);
  });

  test("migrated root tool paths remain compatibility-only wrappers", async () => {
    for (const [name, expected] of Object.entries(MIGRATED_TOOL_WRAPPERS)) {
      expect(await Bun.file(`server/tools/${name}`).text()).toBe(expected);
    }
  });

  test("production server code bypasses migrated tool wrappers", async () => {
    const files = await sourceFiles("server");
    const violations: string[] = [];

    for (const file of files) {
      const normalizedFile = file.replace(/\\/g, "/");
      if (
        normalizedFile.startsWith("server/tools/") &&
        MIGRATED_TOOL_WRAPPERS.hasOwnProperty(
          normalizedFile.slice("server/tools/".length)
        )
      ) {
        continue;
      }

      const source = await Bun.file(file).text();
      for (const request of importsOf(source)) {
        const aliasMatch = request.match(/^@\/server\/tools\/([^/]+)$/);
        if (
          aliasMatch &&
          MIGRATED_TOOL_WRAPPERS.hasOwnProperty(`${aliasMatch[1]}.ts`)
        ) {
          violations.push(
            `${relative("server", file).replace(/\\/g, "/")} -> ${request}`
          );
          continue;
        }

        const relativeMatch = request.match(
          /^(?:\.\/|\.\.\/tools\/)([^/]+)$/
        );
        if (
          relativeMatch &&
          MIGRATED_TOOL_WRAPPERS.hasOwnProperty(
            `${relativeMatch[1]}.ts`
          )
        ) {
          violations.push(
            `${relative("server", file).replace(/\\/g, "/")} -> ${request}`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("registrar facades import canonical domain owners directly", async () => {
    const facades = [
      "server/tools/animation.ts",
      "server/tools/texture.ts",
      "server/tools/paint.ts",
      "server/tools/element.ts",
    ];

    const violations: string[] = [];
    for (const file of facades) {
      const source = await Bun.file(file).text();
      for (const request of importsOf(source)) {
        if (
          request.startsWith("./") &&
          MIGRATED_TOOL_WRAPPERS.hasOwnProperty(
            `${request.slice(2)}.ts`
          )
        ) {
          violations.push(`${file} -> ${request}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("animation production modules do not depend on migrated root wrappers", async () => {
    const files = await sourceFiles("server/tools");
    const violations: string[] = [];

    for (const file of files) {
      if (file.endsWith("animation-shared.ts")) continue;
      const source = await Bun.file(file).text();
      for (const request of importsOf(source)) {
        const relativeLegacy =
          request === "./animation-shared" ||
          request === "./animation-controller-state" ||
          request === "./animation-effect-state" ||
          request === "./paint-shared" ||
          request === "./paint-layer-state";
        if (
          relativeLegacy ||
          MIGRATED_TOOL_IMPORTS.has(request)
        ) {
          violations.push(
            `${relative("server/tools", file).replace(/\\/g, "/")} -> ${request}`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("animation controller schema stays separate from executor/runtime wiring", async () => {
    const schema = await Bun.file(
      "server/tools/animation/controllerSchema.ts"
    ).text();
    const executor = await Bun.file("server/tools/animation/controller.ts").text();
    const runtimeExtension = await Bun.file(
      "server/runtime/extensions/animation/controllerNativeIntelligence.ts"
    ).text();

    expect(schema).toContain("manageAnimationControllerParameters");
    expect(schema).toContain("ControllerMutationOperation");
    expect(schema).not.toContain("createTool(");
    expect(schema).not.toContain("Undo.");
    expect(schema).not.toContain("/server/runtime");
    expect(schema).not.toContain("/gateway/");

    expect(executor).toContain(
      'from "./controllerSchema"'
    );
    expect(runtimeExtension).toContain(
      'from "../../../tools/animation/controllerSchema"'
    );
    expect(runtimeExtension).not.toContain(
      'from "../../../tools/animation-controller"'
    );
  });

  test("animation batch planning stays pure and executor-owned side effects stay outside", async () => {
    const planner = await Bun.file(
      "lib/animation/batchPlanning.ts"
    ).text();
    const executor = await Bun.file(
      "server/tools/animation/batch.ts"
    ).text();

    expect(planner).toContain("selectBatchKeyframes");
    expect(planner).toContain("planMirroredBatchKeyframes");
    expect(planner).toContain("planSmoothedBatchKeyframes");
    expect(planner).toContain("reverseBatchTimeBounds");
    expect(planner).not.toContain("Undo.");
    expect(planner).not.toContain("Timeline.");
    // Ban actual global API use, not local byAnimator.get.
    expect(planner).not.toMatch(/(^|[^\w])Animator\./m);
    expect(planner).not.toContain("createTool(");
    expect(planner).not.toContain("/server/");
    expect(planner).not.toContain("/gateway/");

    expect(executor).toContain("selectBatchKeyframes(");
    expect(executor).toContain("Undo.initEdit");
    expect(executor.length).toBeLessThan(28000);
  });

  test("animation batch/keyframe/timeline schemas stay contract-only", async () => {
    for (const path of [
      "server/tools/animation/batchSchema.ts",
      "server/tools/animation/keyframeSchema.ts",
      "server/tools/animation/timelineSchema.ts",
    ]) {
      const schema = await Bun.file(path).text();
      expect(schema).not.toContain("createTool(");
      expect(schema).not.toContain("Undo.");
      expect(schema).not.toContain("/server/runtime");
      expect(schema).not.toContain("/gateway/");
    }

    const runtimeContract = await Bun.file(
      "server/runtime/contracts/animation.ts"
    ).text();
    expect(runtimeContract).toContain(
      'from "../../tools/animation/batchSchema"'
    );
    expect(runtimeContract).toContain(
      'from "../../tools/animation/keyframeSchema"'
    );
    expect(runtimeContract).toContain(
      'from "../../tools/animation/timelineSchema"'
    );
    expect(runtimeContract).not.toContain(
      'from "../tools/animation-keyframes"'
    );
    expect(runtimeContract).not.toContain(
      'from "../tools/animation-timeline"'
    );
  });

  test("animation controller planner stays runtime-independent", async () => {
    const planner = await Bun.file(
      "server/tools/animation/controllerPlanner.ts"
    ).text();
    const executor = await Bun.file(
      "server/tools/animation/controller.ts"
    ).text();

    expect(planner).toContain("ControllerPlanningEnvironment");
    expect(planner).toContain("applyOperationToPlan");
    expect(planner).not.toContain("AnimationItem");
    expect(planner).not.toContain("Undo.");
    expect(planner).not.toContain("createTool(");
    expect(planner).not.toContain("guid()");
    expect(planner).not.toContain("/server/runtime");
    expect(planner).not.toContain("/gateway/");

    expect(executor).toContain(
      'from "./controllerPlanner"'
    );
    expect(executor).toContain("resolveAnimation: resolveAuthoredAnimation");
    expect(executor).toContain("createId: () => guid()");
    expect(executor.length).toBeLessThan(12000);
  });

  test("animation inspection schema stays separate from executor/runtime wiring", async () => {
    const schema = await Bun.file(
      "server/tools/animation/inspectionSchema.ts"
    ).text();
    const executor = await Bun.file("server/tools/animation/inspection.ts").text();
    const runtimeContract = await Bun.file(
      "server/runtime/contracts/animation.ts"
    ).text();

    expect(schema).toContain("inspectAnimationParameters");
    expect(schema).not.toContain("createTool(");
    expect(schema).not.toContain("Undo.");
    expect(schema).not.toContain("/server/runtime");
    expect(schema).not.toContain("/gateway/");

    expect(executor).toContain(
      'from "./inspectionSchema"'
    );
    expect(runtimeContract).toContain(
      'from "../../tools/animation/inspectionSchema"'
    );
    expect(runtimeContract).not.toContain(
      'from "../tools/animation-inspection"'
    );
  });

  test("texture selection geometry planning stays pure", async () => {
    const planner = await Bun.file(
      "lib/texture/selectionPlanning.ts"
    ).text();
    const executor = await Bun.file(
      "server/tools/paint/selectionLayers.ts"
    ).text();

    expect(planner).toContain("rectangleSelectionPredicate");
    expect(planner).toContain("ellipseSelectionPredicate");
    expect(planner).not.toContain("Undo.");
    expect(planner).not.toContain("Texture.");
    expect(planner).not.toContain("UVEditor.");
    expect(planner).not.toContain("createTool(");
    expect(planner).not.toContain("/server/");
    expect(planner).not.toContain("/gateway/");

    expect(executor).toContain("rectangleSelectionPredicate(");
    expect(executor).toContain("ellipseSelectionPredicate(");
  });

  test("paint selection/layer schema stays separate from executor", async () => {
    const schema = await Bun.file(
      "server/tools/paint/selectionLayerSchema.ts"
    ).text();
    const executor = await Bun.file(
      "server/tools/paint/selectionLayers.ts"
    ).text();

    expect(schema).toContain("textureSelectionParameters");
    expect(schema).toContain("textureLayerManagementParameters");
    expect(schema).not.toContain("createTool(");
    expect(schema).not.toContain("Undo.");
    expect(schema).not.toContain("/server/runtime");
    expect(schema).not.toContain("/gateway/");

    expect(executor).toContain(
      'from "./selectionLayerSchema"'
    );
    expect(executor.length).toBeLessThan(28000);
  });

  test("canonical material state helpers stay transaction-free", async () => {
    const state = await Bun.file(
      "server/tools/texture/materialState.ts"
    ).text();
    const executor = await Bun.file(
      "server/tools/texture/materials.ts"
    ).text();

    expect(state).toContain("runtimePbrTextureStates");
    expect(state).toContain("resolveRuntimeTextureByUuid");
    expect(state).toContain("materialGroupsByUuid");
    expect(state).toContain("applyPbrMembershipChanges");
    expect(state).not.toContain("planMaterialChannelAssignment");
    expect(state).not.toContain("applyMaterialChannelAssignment");
    expect(state).not.toContain("Undo.");
    expect(state).not.toContain("Canvas.");
    expect(state).not.toContain("updateMaterial()");
    expect(state).not.toContain("createTool(");

    expect(executor).toContain("applyPbrMembershipChanges(");
    expect(executor).toContain("runtimePbrTextureStates()");
    expect(executor).toContain("Undo.initEdit");
  });

  test("texture material state stays separate from executor", async () => {
    const state = await Bun.file(
      "server/tools/texture/materialState.ts"
    ).text();
    const executor = await Bun.file(
      "server/tools/texture/materials.ts"
    ).text();
    const creator = await Bun.file(
      "server/tools/texture/create.ts"
    ).text();

    expect(state).toContain("resolveTextureToolMaterial");
    expect(state).toContain("materialContinuationState");
    expect(state).not.toContain("createTool(");
    expect(state).not.toContain("Undo.");
    expect(state).not.toContain("/server/runtime");
    expect(state).not.toContain("/gateway/");

    expect(executor).toContain(
      'from "./materialState"'
    );
    expect(creator).toContain(
      'from "./materialState"'
    );
    expect(creator).not.toContain(
      'from "./texture-materials"'
    );
  });

  test("texture material schemas stay separate from executor", async () => {
    const schema = await Bun.file(
      "server/tools/texture/materialSchema.ts"
    ).text();
    const executor = await Bun.file(
      "server/tools/texture/materials.ts"
    ).text();

    expect(schema).toContain("createPbrMaterialParameters");
    expect(schema).toContain("configureMaterialParameters");
    expect(schema).toContain("assignTextureChannelParameters");
    expect(schema).not.toContain("createTool(");
    expect(schema).not.toContain("Undo.");
    expect(schema).not.toContain("/server/runtime");
    expect(schema).not.toContain("/gateway/");

    expect(executor).toContain(
      'from "./materialSchema"'
    );
    expect(executor.length).toBeLessThan(26000);
  });

  test("create texture schema stays separate from executor/runtime wiring", async () => {
    const schema = await Bun.file(
      "server/tools/texture/createSchema.ts"
    ).text();
    const executor = await Bun.file("server/tools/texture/create.ts").text();
    const runtimeContract = await Bun.file(
      "server/runtime/contracts/texture.ts"
    ).text();

    expect(schema).toContain("createTextureParameters");
    expect(schema).toContain("isDeterministicTextureSource");
    expect(schema).not.toContain("createTool(");
    expect(schema).not.toContain("Undo.");
    expect(schema).not.toContain("/server/runtime");
    expect(schema).not.toContain("/gateway/");

    expect(executor).toContain(
      'from "./createSchema"'
    );
    expect(runtimeContract).toContain(
      'from "../../tools/texture/createSchema"'
    );
    expect(runtimeContract).not.toContain(
      'from "../tools/texture"'
    );
  });

  test("tool domain owners do not depend on higher Runtime composition", async () => {
    for (const domain of ["animation", "paint", "texture"] as const) {
      for (const file of await sourceFiles(`server/tools/${domain}`)) {
        const source = await Bun.file(file).text();
        for (const request of importsOf(source)) {
          expect(request).not.toContain("/server/runtime");
          expect(request).not.toContain("/gateway/");
        }
      }
    }
  });
});