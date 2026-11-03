import { describe, expect, test } from "bun:test";
import {
  inspectGeometryIssues,
  locateGeometryIssue,
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
    uuid: string;
    name: string;
    origin = [0, 0, 0];
    rotation = [0, 0, 0];
    visibility = true;
    selected = false;
    parent: unknown = "root";
    visited = 0;
    constructor(uuid = "root", name = "root") {
      this.uuid = uuid;
      this.name = name;
    }
    select() { this.selected = true; return this; }
    showInOutliner() { this.visited++; }
    static all = [new NativeGroup()];
  }
  class NativeCube {
    uuid: string;
    name: string;
    from = [0, 0, 0];
    to = [2, 2, 2];
    origin = [1, 1, 1];
    rotation = [0, 0, 0];
    inflate = 0;
    box_uv = false;
    parent: unknown = "root";
    uv_offset = [0, 0];
    mirror_uv = false;
    autouv = 0;
    visibility = true;
    selected = false;
    visited = 0;
    faces = {
      north: { uv: [0, 0, 2, 2], texture: "atlas", rotation: 0, enabled: true, material_name: "" },
    };
    constructor(uuid = "body", name = "body") { this.uuid = uuid; this.name = name; }
    select() { this.selected = true; return this; }
    showInOutliner() { this.visited++; }
    static all = [new NativeCube()];
    static selected = NativeCube.all;
  }
  class NativeTexture { static all = [{ uuid: "atlas", name: "atlas.png" }]; }
  class NativeTextureGroup { static all: unknown[] = []; }
  class NativeController { name = "controller"; }
  class NativeAnimationItem {
    static all = [{ name: "idle", uuid: "clip" }, new NativeController()];
    static selected = NativeAnimationItem.all[0];
  }
  try {
    define("Project", { uuid: "fixture-project", format: { id: "bedrock" }, texture_width: 64, texture_height: 64 });
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

describe("LazyDesigner native Geometry Issue Navigator", () => {
  test("clean bounded geometry does not manufacture a warning or a quality PASS", () => {
    withNativeFixtures(() => {
      const review = inspectGeometryIssues();
      expect(review.heading).toBe("Geometry Issues");
      expect(review.issues).toHaveLength(0);
      expect(review.summary).toContain("does not certify visual quality");
      expect(review.note).toContain("not automatic fixes");
    });
  });

  test("a degenerate Cube is identified by UUID and can be selected in the native Outliner", () => {
    withNativeFixtures(() => {
      const g = globalThis as any;
      const cube = g.Cube.all[0];
      cube.to = [0, 0, 2];
      const before = JSON.stringify({ from: cube.from, to: cube.to, uv: cube.faces.north.uv });
      const issue = inspectGeometryIssues().issues.find(item => item.code === "degenerate_cube");
      expect(issue).toMatchObject({ kind: "cube", uuid: "body", name: "body" });
      expect(locateGeometryIssue(issue!, g.Project)).toBe("body");
      expect(cube.selected).toBe(true);
      expect(cube.visited).toBe(1);
      expect(JSON.stringify({ from: cube.from, to: cube.to, uv: cube.faces.north.uv })).toBe(before);
    });
  });

  test("duplicate Group names identify each Group by UUID and locate the correct instance", () => {
    withNativeFixtures(() => {
      const g = globalThis as any;
      const second = new g.Group("second-group", "root");
      g.Group.all.push(second);
      const review = inspectGeometryIssues();
      const entries = review.issues.filter(item => item.code === "duplicate_group_name");
      expect(entries.map(item => item.uuid)).toEqual(["root", "second-group"]);
      locateGeometryIssue(entries[1]!, g.Project);
      expect(second.visited).toBe(1);
      expect(g.Group.all[0].visited).toBe(0);
    });
  });

  test("sub-unit Box UV is an advisory target and not an automatic resize", () => {
    withNativeFixtures(() => {
      const g = globalThis as any;
      const cube = g.Cube.all[0];
      cube.box_uv = true;
      cube.to = [0.5, 2, 2];
      const review = inspectGeometryIssues();
      expect(review.issues.some(issue => issue.code === "box_uv_subunit" && issue.uuid === "body")).toBe(true);
      expect(cube.to).toEqual([0.5, 2, 2]);
    });
  });

  test("limited diagnostics disclose truncation; no invented UUIDs or global PASS", () => {
    withNativeFixtures(() => {
      const g = globalThis as any;
      g.Cube.all = Array.from({ length: 15 }, (_unused, i) =>
        Object.assign(new g.Cube("issue-" + i), { to: [0, 0, 1] }));
      const review = inspectGeometryIssues();
      expect(review.truncated).toBe(true);
      expect(review.issues.length).toBeLessThanOrEqual(8);
      expect(review.issues.every(issue => g.Cube.all.some((cube: any) => cube.uuid === issue.uuid))).toBe(true);
    });
  });

  test("stale project, missing or ambiguous UUID cannot navigate a different object", () => {
    withNativeFixtures(() => {
      const g = globalThis as any;
      const cube = g.Cube.all[0];
      cube.to = [0, 0, 2];
      const issue = inspectGeometryIssues().issues[0]!;
      expect(() => locateGeometryIssue(issue, {})).toThrow("project changed");
      expect(cube.visited).toBe(0);
      g.Cube.all.push(new g.Cube("body", "another cube"));
      expect(() => locateGeometryIssue(issue, g.Project)).toThrow("unique UUID");
      expect(cube.visited).toBe(0);
      g.Cube.all.pop();
      cube.select = () => false;
      expect(() => locateGeometryIssue(issue, g.Project)).toThrow("could not select");
      expect(cube.visited).toBe(0);
    });
  });

  test("unsupported format is rejected before diagnosis or navigation", () => {
    withNativeFixtures(() => {
      const g = globalThis as any;
      const issue = { kind: "cube", uuid: "body", name: "body", code: "degenerate_cube", description: "test" } as const;
      g.Project.format.id = "java_block";
      expect(() => requireBedrockEditorProject()).toThrow("Bedrock Model projects only");
      expect(() => inspectGeometryIssues()).toThrow();
      expect(() => locateGeometryIssue(issue, g.Project)).toThrow();
    });
  });

  test("cleanup review fingerprints include ancestry, native UV and project settings", () => {
    withNativeFixtures(() => {
      const g = globalThis as any;
      const cube = g.Cube.all[0];
      const parent = g.Group.all[0];
      const original = captureCubeCleanupSource(["body"]);
      expect(captureCubeCleanupSource(["body"])).toBe(original);
      cube.parent = parent;
      const reparented = captureCubeCleanupSource(["body"]);
      expect(reparented).not.toBe(original);
      parent.origin[1] = 4;
      const movedGroup = captureCubeCleanupSource(["body"]);
      expect(movedGroup).not.toBe(reparented);
      g.Project.texture_width = 128;
      const resizedUv = captureCubeCleanupSource(["body"]);
      expect(resizedUv).not.toBe(movedGroup);
      cube.faces.north.uv[0] = 1;
      expect(captureCubeCleanupSource(["body"])).not.toBe(resizedUv);
      expect(() => captureCubeCleanupSource(["missing"])).toThrow("Cube identity changed");
      g.Cube.all.push(new g.Cube("body", "another cube"));
      expect(() => captureCubeCleanupSource(["body"])).toThrow("Cube identity changed");
    });
  });

  test("missing/invalid native Cube fidelity evidence fails closed", () => {
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
    ]) {
      expect(() => requireCleanupFidelity(value)).toThrow();
    }
  });

  test("UI wires native issue navigation while retaining AI Gateway and lifecycle boundaries", async () => {
    const [ui, panel, cleanup, validation] = await Promise.all([
      Bun.file(new URL("../ui/index.ts", import.meta.url)).text(),
      Bun.file(new URL("../ui/panel.html", import.meta.url)).text(),
      Bun.file(new URL("../ui/geometryCleanupDialog.ts", import.meta.url)).text(),
      Bun.file(new URL("../server/tools/validation/qualityIntelligence.ts", import.meta.url)).text(),
    ]);
    expect(ui).toContain('MenuBar.addAction(toolsMenuAction, "tools")');
    expect(ui).toContain("locateGeometryIssue(issue, project)");
    expect(ui).toContain("runRuntimeOperationExclusive(generation");
    expect(ui).not.toContain("setActiveMcpAuthoringStage(");
    expect(ui).toContain("event === \"update_selection\"");
    expect(panel).toContain("Find Geometry Issues");
    expect(panel).toContain("Locate in Outliner");
    expect(panel).toContain("Safe Cube Cleanup");
    expect(panel).not.toContain("Inspect Textures");
    expect(panel).not.toContain("Preview Palette");
    expect(panel).not.toContain("Inspect Animations");
    expect(panel).not.toContain("Tool catalog");
    expect(validation).toContain("export function geometryHygieneRuntime()");
    expect(validation).toContain("export function rigGraphRuntime()");
    expect(cleanup).toContain("const epoch = ++dialogEpoch");
    expect(cleanup).toContain("captureParentChain");
    expect(cleanup).toContain("requireCleanupFidelity(current)");
  });
});
