import { describe, expect, test } from "bun:test";
import {
  summarizeAppliedGeometryEdit,
  reviewCurrentGeometryEdit,
  requireCurrentGeometryEditReview,
} from "@/ui/geometryChangeReview";
import { locateExactGeometryTarget } from "@/ui/authoringTools";

function cube(uuid: string, from: number[], to: number[], more = {}) {
  return {
    uuid, name: "Cube " + uuid, from, to, origin: [0, 0, 0],
    rotation: [0, 0, 0], inflate: 0, box_uv: false,
    uv_offset: [0, 0], mirror_uv: false, autouv: 0,
    visibility: true,
    faces: { north: { uv: [0, 0, 2, 2], texture: "base", enabled: true, rotation: 0 } },
    ...more,
  };
}

function edit(before: Record<string, unknown>, post: Record<string, unknown>, action = "Agent modified cubes") {
  return {
    action, type: "edit" as const, time: 20261103,
    before: { elements: before }, post: { elements: post },
  };
}

describe("Geometry Change Review uses authoritative Blockbench Undo entries", () => {
  test("reports exact before/after transforms only from a real applied edit", () => {
    const src = cube("body", [0, 0, 0], [2, 2, 2]);
    const next = cube("body", [0, 0, 0], [3, 2, 2]);
    const h = [edit({ body: src }, { body: next })];
    const review = summarizeAppliedGeometryEdit(h, 1);
    expect(review.action).toBe("Agent modified cubes");
    expect(review.affectedCount).toBe(1);
    expect(review.cubes).toHaveLength(1);
    expect(review.cubes[0]?.uuid).toBe("body");
    expect(review.cubes[0]?.kind).toBe("modified");
    expect(review.cubes[0]?.fields).toEqual([
      { field: "to", before: "[2,2,2]", after: "[3,2,2]" },
    ]);
    expect(review.note).toContain("does not identify AI versus manual origin");
    expect(src.to).toEqual([2, 2, 2]);
    expect(next.to).toEqual([3, 2, 2]);
  });

  test("skips native selection history but never skips a non-Geometry edit", () => {
    const oldCube = cube("body", [0, 0, 0], [1, 2, 2]);
    const newCube = cube("body", [0, 0, 0], [2, 2, 2]);
    const geometry = edit({ body: oldCube }, { body: newCube });
    const selection = { type: "selection", action: "Selected Cube", time: 3 };
    expect(summarizeAppliedGeometryEdit([geometry, selection], 2).affectedCount).toBe(1);
    const textureEdit = { type: "edit", action: "Paint texture", time: 4,
      before: { textures: { t1: {} } }, post: { textures: { t1: {} } } };
    const unrelated = summarizeAppliedGeometryEdit([geometry, textureEdit], 2);
    expect(unrelated.affectedCount).toBe(0);
    expect(unrelated.summary).toContain("latest edit has no inspectable Cube changes");
  });

  test("native Cube rename is a real change, not a static model inventory", () => {
    const before = cube("named", [0, 0, 0], [2, 2, 2], { name: "Old" });
    const after = cube("named", [0, 0, 0], [2, 2, 2], { name: "New" });
    const review = summarizeAppliedGeometryEdit([edit({ named: before }, { named: after })], 1);
    expect(review.cubes[0]?.fields).toMatchObject([
      { field: "name", before: "Old", after: "New" },
    ]);
  });

  test("does not treat captured-but-unchanged Cubes as edited", () => {
    const c = cube("same", [0, 0, 0], [2, 2, 2]);
    expect(summarizeAppliedGeometryEdit([edit({ same: c }, { same: { ...c } })], 1).affectedCount)
      .toBe(0);
  });

  test("reports new/deleted Cube snapshots with the correct locate boundary", () => {
    const c = cube("created", [0, 0, 0], [1, 1, 1]);
    const add = summarizeAppliedGeometryEdit([edit({}, { created: c }, "Placed Cube")], 1);
    expect(add.cubes).toMatchObject([{ uuid: "created", kind: "added", canLocate: true }]);
    const removed = summarizeAppliedGeometryEdit([edit({ created: c }, {}, "Removed Cube")], 1);
    expect(removed.cubes).toMatchObject([{ uuid: "created", kind: "removed", canLocate: false }]);
  });

  test("captures UV mapping changes as changed, without claiming visual fidelity", () => {
    const c = cube("a", [0, 0, 0], [2, 2, 2]);
    const changed = cube("a", [0, 0, 0], [2, 2, 2], {
      faces: { north: { uv: [1, 1, 3, 3], texture: "base", enabled: true, rotation: 0 } },
    });
    const review = summarizeAppliedGeometryEdit([edit({ a: c }, { a: changed })], 1);
    expect(review.cubes[0]?.fields[0]?.field).toBe("faces");
    expect(review.cubes[0]?.fields[0]?.before).toContain('"uv":[0,0,2,2]');
    expect(review.cubes[0]?.fields[0]?.after).toContain('"uv":[1,1,3,3]');
    expect(review.cubes[0]?.fields[0]?.before).not.toBe(review.cubes[0]?.fields[0]?.after);
    expect(review.note).toContain("Native Undo evidence only");
  });

  test("bounded visibility and hidden-target changes alter the revision identity", () => {
    const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
    for (let i = 0; i < 15; i++) {
      before["c" + i] = cube("c" + i, [0, 0, 0], [1, 1, 1]);
      after["c" + i] = cube("c" + i, [0, 0, 0], [2, 1, 1]);
    }
    const first = summarizeAppliedGeometryEdit([edit(before, after)], 1);
    expect(first.truncated).toBe(true);
    expect(first.affectedCount).toBe(15);
    expect(first.cubes).toHaveLength(8);
    after.c9 = cube("c9", [0, 0, 0], [4, 1, 1]);
    const revised = summarizeAppliedGeometryEdit([edit(before, after)], 1);
    expect(revised.sourceSignature).not.toBe(first.sourceSignature);
  });

  test("malformed or incomplete history refuses to invent changes", () => {
    expect(() => summarizeAppliedGeometryEdit([], 0)).toThrow("no applied model edit");
    expect(() => summarizeAppliedGeometryEdit([], 1)).toThrow("invalid");
    expect(() => summarizeAppliedGeometryEdit([
      { type: "edit", action: "Invalid", before: null, post: null },
    ], 1)).not.toThrow();
    const partial = summarizeAppliedGeometryEdit([
      edit({ cube: { uuid: "cube", name: "cube", to: [1, 1, 1] } },
           { cube: { uuid: "cube", name: "cube", to: null } }),
    ], 1);
    expect(partial.affectedCount).toBe(0);
  });

  test("real editor wrapper blocks absent project/active edits and stale native review", () => {
    const g = globalThis as any;
    const priorProject = Object.getOwnPropertyDescriptor(g, "Project");
    const priorUndo = Object.getOwnPropertyDescriptor(g, "Undo");
    const before = cube("one", [0, 0, 0], [1, 1, 1]);
    const after = cube("one", [0, 0, 0], [2, 1, 1]);
    try {
      Object.defineProperty(g, "Project", { configurable: true, value: {
        uuid: "fixture-project", format: { id: "bedrock" },
      } });
      Object.defineProperty(g, "Undo", { configurable: true, value: {
        history: [edit({ one: before }, { one: after })], index: 1, current_save: null,
      } });
      const review = reviewCurrentGeometryEdit();
      expect(() => requireCurrentGeometryEditReview(review)).not.toThrow();
      g.Undo.history[0].post.elements.one.to = [3, 1, 1];
      expect(() => requireCurrentGeometryEditReview(review)).toThrow("history changed");
      g.Undo.current_save = {};
      expect(() => reviewCurrentGeometryEdit()).toThrow("Finish any active");
      g.Undo.current_save = null;
      g.Project.format.id = "java_block";
      expect(() => reviewCurrentGeometryEdit()).toThrow("Bedrock Model projects only");
    } finally {
      if (priorProject) Object.defineProperty(g, "Project", priorProject);
      else delete g.Project;
      if (priorUndo) Object.defineProperty(g, "Undo", priorUndo);
      else delete g.Undo;
    }
  });

  test("reviewed native Cube UUID locates the current object without authored mutation", () => {
    const g = globalThis as any;
    const originalProject = Object.getOwnPropertyDescriptor(g, "Project");
    const originalCube = Object.getOwnPropertyDescriptor(g, "Cube");
    const originalUndo = Object.getOwnPropertyDescriptor(g, "Undo");
    const before = cube("reviewed", [0, 0, 0], [2, 2, 2]);
    const after = cube("reviewed", [0, 0, 0], [3, 2, 2]);
    const live = { uuid: "reviewed", name: "Cube reviewed", selected: false, focused: 0,
      select() { this.selected = true; return this; },
      showInOutliner() { this.focused++; },
    };
    try {
      Object.defineProperty(g, "Project", { configurable: true,
        value: { uuid: "fixture", format: { id: "bedrock" } } });
      Object.defineProperty(g, "Cube", { configurable: true, value: { all: [live] } });
      Object.defineProperty(g, "Undo", { configurable: true,
        value: { history: [edit({ reviewed: before }, { reviewed: after })],
          index: 1, current_save: null } });
      const reviewed = reviewCurrentGeometryEdit();
      const name = locateExactGeometryTarget("cube", reviewed.cubes[0]!.uuid, g.Project);
      expect(name).toBe("Cube reviewed");
      expect(live.selected).toBe(true);
      expect(live.focused).toBe(1);
      expect(g.Undo.index).toBe(1);
      expect(g.Undo.history).toHaveLength(1);
      expect(before.to).toEqual([2, 2, 2]);
      expect(after.to).toEqual([3, 2, 2]);
    } finally {
      if (originalProject) Object.defineProperty(g, "Project", originalProject);
      else delete g.Project;
      if (originalCube) Object.defineProperty(g, "Cube", originalCube);
      else delete g.Cube;
      if (originalUndo) Object.defineProperty(g, "Undo", originalUndo);
      else delete g.Undo;
    }
  });

  test("UI exposes real review navigation and no fake AI receipt/progress", async () => {
    const [ui, html, service] = await Promise.all([
      Bun.file(new URL("../ui/index.ts", import.meta.url)).text(),
      Bun.file(new URL("../ui/panel.html", import.meta.url)).text(),
      Bun.file(new URL("../ui/geometryChangeReview.ts", import.meta.url)).text(),
    ]);
    expect(html).toContain("Review Latest Edit");
    expect(html).toContain("Locate Cube");
    expect(service).toContain('heading: "Latest Geometry Edit"');
    expect(html).not.toContain("AI task complete");
    expect(ui).toContain("reviewCurrentGeometryEdit()");
    expect(ui).toContain("requireCurrentGeometryEditReview(reviewed)");
    expect(ui).toContain('locateExactGeometryTarget("cube", change.uuid, project)');
    expect(ui).toContain("runRuntimeOperationExclusive(generation");
    expect(service).toContain("Undo.history");
    expect(service).not.toContain("Undo.initEdit");
    expect(service).not.toContain("Undo.undo");
  });
});
