import { describe, expect, test } from "bun:test";
import {
  inspectAuthoringCategory,
  previewAuthoringPalette,
  requireBedrockEditorProject,
} from "@/ui/authoringTools";
import {
  captureCubeCleanupSource,
  requireCleanupFidelity,
} from "@/ui/geometryCleanupDialog";

type NativeKey = "Project" | "Cube" | "Group" | "Texture" | "TextureGroup" | "AnimationItem" | "AnimationController";

function withNativeFixtures(run: () => void) {
  const keys: NativeKey[] = [
    "Project", "Cube", "Group", "Texture", "TextureGroup", "AnimationItem", "AnimationController",
  ];
  const originals = new Map<NativeKey, PropertyDescriptor | undefined>(
    keys.map((key): [NativeKey, PropertyDescriptor | undefined] =>
      [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );
  const define = (key: NativeKey, value: unknown) => Object.defineProperty(globalThis, key, {
    configurable: true, writable: true, value,
  });
  class NativeGroup {
    uuid = "root";
    name = "root";
    origin = [0, 0, 0];
    rotation = [0, 0, 0];
    visibility = true;
    parent: unknown = "root";
    static all = [new NativeGroup()];
    static selected: unknown[] = [];
  }
  class NativeCube {
    static all = [{
      uuid: "body", name: "body", from: [0, 0, 0], to: [2, 2, 2],
      origin: [1, 1, 1], rotation: [0, 0, 0], inflate: 0, box_uv: false,
      parent: "root" as unknown, uv_offset: [0, 0], mirror_uv: false,
      autouv: 0, visibility: true,
      faces: {
        north: { uv: [0, 0, 2, 2], texture: "atlas", rotation: 0, enabled: true, material_name: "" },
      },
    }];
    static selected = NativeCube.all;
  }
  class NativeTexture {
    static all = [{ uuid: "atlas", name: "atlas.png" }];
  }
  class NativeTextureGroup { static all: unknown[] = []; }
  class NativeController { name = "controller"; }
  class NativeAnimationItem {
    static all = [{ name: "idle", uuid: "clip" }, new NativeController()];
    static selected = NativeAnimationItem.all[0];
  }
  try {
    define("Project", { format: { id: "bedrock" }, texture_width: 64, texture_height: 64 });
    define("Cube", NativeCube);
    define("Group", NativeGroup);
    define("Texture", NativeTexture);
    define("TextureGroup", NativeTextureGroup);
    define("AnimationItem", NativeAnimationItem);
    define("AnimationController", NativeController);
    run();
  } finally {
    for (const key of keys) {
      const previous = originals.get(key);
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

describe("LazyDesigner AI-first Blockbench panel", () => {
  test("three categories use existing read-only analyzers and native inventories", () => {
    withNativeFixtures(() => {
      const geometry = inspectAuthoringCategory("geometry");
      expect(geometry.heading).toBe("Model Inspector");
      expect(geometry.rows.find((row) => row.label === "Cubes")?.value).toBe("1");
      expect(geometry.note).toContain("not a visual-quality PASS");

      const texture = inspectAuthoringCategory("texture");
      expect(texture.rows.find((row) => row.label === "Textures")?.value).toBe("1");
      expect(texture.note).toContain("not been evaluated");

      const animation = inspectAuthoringCategory("animation");
      expect(animation.rows.find((row) => row.label === "Animation clips")?.value).toBe("1");
      expect(animation.rows.find((row) => row.label === "Controllers")?.value).toBe("1");
      expect(animation.note).toContain("not been evaluated");
    });
  });

  test("unsupported format is rejected, rather than applying Bedrock checks to an unrelated model", () => {
    withNativeFixtures(() => {
      const globals = globalThis as any;
      globals.Project.format.id = "java_block";
      expect(() => requireBedrockEditorProject()).toThrow("Bedrock Model projects only");
      expect(() => inspectAuthoringCategory("geometry")).toThrow();
    });
  });

  test("palette preview derives colors without native mutation or an AI client", () => {
    const result = previewAuthoringPalette("#886644");
    expect(result.swatches).toHaveLength(7);
    expect(result.swatches?.[3]).toBe("#886644");
    expect(result.note).toContain("No palette, texture bitmap, or material was changed.");
    expect(() => previewAuthoringPalette("not-a-color")).toThrow();
  });

  test("cleanup review fingerprints include ancestry, native UV and project settings", () => {
    withNativeFixtures(() => {
      const globals = globalThis as any;
      const cube = globals.Cube.all[0];
      const parent = globals.Group.all[0];
      const original = captureCubeCleanupSource(["body"]);
      expect(captureCubeCleanupSource(["body"])).toBe(original);

      cube.parent = parent;
      const reparented = captureCubeCleanupSource(["body"]);
      expect(reparented).not.toBe(original);
      parent.origin[1] = 4;
      const movedGroup = captureCubeCleanupSource(["body"]);
      expect(movedGroup).not.toBe(reparented);

      globals.Project.texture_width = 128;
      const resizedUv = captureCubeCleanupSource(["body"]);
      expect(resizedUv).not.toBe(movedGroup);
      cube.faces.north.uv[0] = 1;
      expect(captureCubeCleanupSource(["body"])).not.toBe(resizedUv);

      expect(() => captureCubeCleanupSource(["missing"])).toThrow("Cube identity changed");
      globals.Cube.all.push({ ...cube });
      expect(() => captureCubeCleanupSource(["body"])).toThrow("Cube identity changed");
    });
  });

  test("missing/invalid fidelity risk evidence fails closed before any Apply", () => {
    const safe = {
      simplification_fidelity: {
        mapped_texture_stretch_risk_count: 0,
        incomplete_face_inventory_count: 0,
        box_uv_template_review_count: 0,
      },
    };
    expect(requireCleanupFidelity(safe)).toEqual(safe.simplification_fidelity);
    for (const value of [
      {},
      { simplification_fidelity: {} },
      { simplification_fidelity: { ...safe.simplification_fidelity, incomplete_face_inventory_count: -1 } },
      { simplification_fidelity: { ...safe.simplification_fidelity, mapped_texture_stretch_risk_count: "0" } },
      { simplification_fidelity: { ...safe.simplification_fidelity, mapped_texture_stretch_risk_count: NaN } },
      { simplification_fidelity: { ...safe.simplification_fidelity, box_uv_template_review_count: undefined } },
    ]) {
      expect(() => requireCleanupFidelity(value)).toThrow();
    }
  });

  test("UI never changes AI Stage, opens only one Tools entry, and disposes its dialogs", async () => {
    const [ui, panel, cleanup, validation] = await Promise.all([
      Bun.file(new URL("../ui/index.ts", import.meta.url)).text(),
      Bun.file(new URL("../ui/panel.html", import.meta.url)).text(),
      Bun.file(new URL("../ui/geometryCleanupDialog.ts", import.meta.url)).text(),
      Bun.file(new URL("../server/tools/validation/qualityIntelligence.ts", import.meta.url)).text(),
    ]);
    expect(ui).toContain('new Action("lazydesigner_tools_panel"');
    expect(ui).toContain('MenuBar.addAction(toolsMenuAction, "tools")');
    expect(ui).toContain("toolsMenuAction?.delete()");
    expect(ui).toContain("uiEpoch += 1");
    expect(ui).toContain("inspectionVersion");
    // Native Group selection is stored on each Group, never a Group.selected static.
    expect(ui).toContain("Group.all.filter((group) => group.selected === true)");
    expect(ui).not.toContain("Group.selected?.length");
    expect(ui).toContain('uiEpoch += 1');
    expect(ui).toContain('"finished_edit"');
    expect(ui).toContain('"undo"');
    expect(ui).toContain('"redo"');
    expect(ui).toContain('cycleCategory(');
    expect(panel).toContain('@keydown.left.prevent="cycleCategory(-1)"');
    expect(panel).toContain('@keydown.right.prevent="cycleCategory(1)"');
    expect(panel).toContain(':tabindex="activeCategory === category ? 0 : -1"');
    expect(ui).toContain("cubeCleanupDialogTeardown()");
    expect(ui).toContain("runRuntimeOperationExclusive(generation");
    expect(ui).not.toContain("setActiveMcpAuthoringStage(");
    expect(panel).toContain("Safe Cube Cleanup");
    expect(panel).toContain("Switching tabs does not change its authoring stage.");
    expect(panel).not.toContain("Tool catalog");
    expect(validation).toContain("export function geometryHygieneRuntime()");
    expect(validation).toContain("export function rigGraphRuntime()");
    expect(cleanup).toContain("captureTargetSource(plan.request.ids) !== plan.source");
    expect(cleanup).toContain('runRuntimeOperationExclusive(generation');
    expect(cleanup).toContain("dry_run: false");
    expect(cleanup).toContain("Native dry-run did not return");
    expect(cleanup).toContain("Cube cleanup applied. Use Blockbench Undo");
    expect(cleanup).toContain("const epoch = ++dialogEpoch");
    expect(cleanup).toContain("submitted = true");
    expect(cleanup).toContain("onCancel()");
    expect(cleanup).toContain("captureParentChain");
    expect(cleanup).toContain("requireCleanupFidelity(current)");
  });
});
